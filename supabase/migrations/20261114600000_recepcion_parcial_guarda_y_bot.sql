-- Recepcion parcial de compras: guarda de "no recibir mas de lo pedido" y recepcion parcial por Telegram.
-- La mecanica (llegadas sucesivas, saldo pendiente, cierre con faltante) ya vive en 20261113900100 y su API en 20261113900400. Esta migracion SOLO:
--   1. Rechaza una llegada que sume mas de lo facturado de la linea (P0435). Antes el exceso se aceptaba y quedaba como sobrante al cerrar; ahora no entra.
--   2. Hace que la indicacion `compra_recepcion` del bot use la recepcion PARCIAL cuando el socio dicta renglones (antes cerraba la compra con faltantes)
--      o cuando la compra ya esta recibida en parte y el socio dice "llego todo" (recibe el saldo).
--   3. Agrega al efecto que confirma el socio (hash de la vista previa) las piezas de esta llegada y las que quedan pendientes.
-- Solo ADITIVO: create or replace de recibir_compra_parcial (misma firma; la envoltura api.* no cambia) y rename+wrap de las funciones del bot.
-- Regla de costo (sin cambios): el costo puesto de una linea es (mercancia + guia + seguro) / piezas FACTURADAS; cada llegada reconoce su parte con redondeo
-- acumulado. Lo que no llega NO cambia el costo de lo ya recibido: su parte del costo puesto pasa, al cerrar, a la cuenta puente 1340 como faltante
-- (por reclamar al proveedor o por asignar), nunca a inventario.

-- 1. Guarda de exceso ---------------------------------------------------------------------------------------------------------------------------------
create or replace function operacion.recibir_compra_parcial(p_clave_idem text, p_compra bigint, p_recibido jsonb, p_contado_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.compra; v_ev bigint; v_at timestamptz := coalesce(p_contado_at, now()); v_fecha date; pl record; rr record; ex record;
  v_recib int; v_cum_antes int; v_cum_despues int; v_n int; v_lote bigint; v_mov bigint; v_valor bigint; v_acum bigint; v_val bigint; v_hecho int;
  v_dm bigint; v_dg bigint; v_ds bigint; v_pm bigint; v_pg bigint; v_ps bigint; v_total_ahora int := 0; v_valor_ahora bigint := 0; v_completa boolean; v_acum_total int; v_fact_total int; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'recibir_compra_parcial', 'c', p_compra, 'r', p_recibido, 'a', p_contado_at));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida', 'recibida_parcial') then raise exception 'la compra % esta %: no se puede recibir', c.folio, c.estado using errcode = 'P0428'; end if;
  if c.destino <> 'bodega' then raise exception 'una compra directa al cliente no entra al inventario' using errcode = 'P0428'; end if;
  if jsonb_typeof(p_recibido) <> 'array' or jsonb_array_length(p_recibido) = 0 then raise exception 'recepcion invalida: indica lo que llego' using errcode = '22023'; end if;
  v_fecha := negocio.fecha_neg(v_at);

  create temporary table if not exists _recep_parcial_tmp (linea_id bigint, sku_id bigint, piezas int) on commit drop;
  delete from _recep_parcial_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _recep_parcial_tmp
  select (x->>'linea_id')::bigint,
         case when x ? 'sku_id' then (x->>'sku_id')::bigint
              else (select s.id from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id join operacion.compra_linea cl on cl.modelo_id = s.modelo_id
                    where cl.id = (x->>'linea_id')::bigint and sa.nombre_norm = catalogo.normalizar(x->>'sabor')) end,
         (x->>'piezas')::int
  from jsonb_array_elements(p_recibido) x;
  if exists (select 1 from _recep_parcial_tmp where sku_id is null or piezas is null or piezas <= 0) then raise exception 'renglon de recepcion invalido (sabor desconocido o piezas no positivas)' using errcode = '22023'; end if;
  if exists (select 1 from _recep_parcial_tmp t left join operacion.compra_linea l on l.id = t.linea_id and l.compra_id = c.id where l.id is null) then raise exception 'una linea no pertenece a la compra' using errcode = '22023'; end if;
  if exists (select 1 from _recep_parcial_tmp t join operacion.compra_linea l on l.id = t.linea_id join catalogo.sku s on s.id = t.sku_id where s.modelo_id <> l.modelo_id) then raise exception 'el sabor no corresponde al modelo de la linea' using errcode = '22023'; end if;
  -- NUEVO: no se recibe mas de lo pedido. Lo ya contado mas esta llegada no puede pasar de lo facturado de la linea.
  select m.nombre_canonico || ' ' || sa.nombre_canonico as renglon, l.piezas_facturadas as facturadas, operacion.recibido_acumulado(l.id) as ya, x.n as ahora into ex
    from (select t.linea_id, sum(t.piezas)::int as n from _recep_parcial_tmp t group by t.linea_id) x
    join operacion.compra_linea l on l.id = x.linea_id join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = l.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
   where operacion.recibido_acumulado(l.id) + x.n > l.piezas_facturadas order by l.id limit 1;
  if found then
    raise exception 'no se recibe mas de lo pedido: % tiene % facturadas, ya llegaron % y esta llegada trae % (pendientes: %)', ex.renglon, ex.facturadas, ex.ya, ex.ahora, greatest(ex.facturadas - ex.ya, 0) using errcode = 'P0435';
  end if;

  v_ev := operacion.crear_evento('compra_recepcion_parcial', v_fecha, p_clave_idem, jsonb_build_object('compra', c.folio));
  for pl in select p.*, l.modelo_id from operacion.puesto_lineas_compra(c.id) p join operacion.compra_linea l on l.id = p.linea_id order by p.linea_id loop
    select coalesce(sum(piezas), 0)::int into v_recib from _recep_parcial_tmp where linea_id = pl.linea_id;
    continue when v_recib = 0;
    v_cum_antes := operacion.recibido_acumulado(pl.linea_id);
    v_cum_despues := v_cum_antes + v_recib;
    -- Parte del costo puesto que corresponde a lo contado en total, menos lo ya reconocido en llegadas anteriores (redondeo acumulado: sin residuo al completar).
    select coalesce(sum(costo_mercancia_cent), 0), coalesce(sum(guia_prorrateada_cent), 0), coalesce(sum(seguro_prorrateado_cent), 0) into v_pm, v_pg, v_ps from operacion.lote where compra_linea_id = pl.linea_id;
    v_dm := negocio.redondear_medio_arriba(pl.mercancia_cent * v_cum_despues, pl.facturadas) - v_pm;
    v_dg := negocio.redondear_medio_arriba(pl.guia_cent * v_cum_despues, pl.facturadas) - v_pg;
    v_ds := negocio.redondear_medio_arriba(pl.seguro_cent * v_cum_despues, pl.facturadas) - v_ps;
    v_valor := v_dm + v_dg + v_ds;
    select coalesce(max(recepcion_n), 0) + 1 into v_n from operacion.lote where compra_linea_id = pl.linea_id;
    insert into operacion.lote (compra_linea_id, modelo_id, piezas_facturadas, piezas_entrada, costo_mercancia_cent, guia_prorrateada_cent, seguro_prorrateado_cent, valor_entrada_cent, recepcion_n)
      values (pl.linea_id, pl.modelo_id, pl.facturadas, v_recib, v_dm, v_dg, v_ds, v_valor, v_n) returning id into v_lote;
    v_acum := 0; v_hecho := 0;
    for rr in select sku_id, sum(piezas)::int as piezas from _recep_parcial_tmp where linea_id = pl.linea_id group by sku_id order by sku_id loop
      v_hecho := v_hecho + rr.piezas;
      v_val := case when v_hecho = v_recib then v_valor - v_acum else negocio.redondear_medio_arriba(v_valor * rr.piezas, v_recib) end;
      v_acum := v_acum + v_val;
      insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, lote_id, valor_cent, evento_id)
        values (v_fecha, v_at, rr.sku_id, pl.modelo_id, 'bodega_omar', 'entrada_compra', rr.piezas, v_lote, v_val, v_ev) returning id into v_mov;
      insert into operacion.compra_recepcion (compra_id, compra_linea_id, sku_id, piezas, movimiento_id, contado_at) values (c.id, pl.linea_id, rr.sku_id, rr.piezas, v_mov, v_at);
    end loop;
    v_total_ahora := v_total_ahora + v_recib; v_valor_ahora := v_valor_ahora + v_valor;
  end loop;
  if v_total_ahora = 0 then raise exception 'ninguna linea recibio piezas' using errcode = '22023'; end if;

  select coalesce(sum(operacion.recibido_acumulado(l.id)), 0)::int, coalesce(sum(l.piezas_facturadas), 0)::int,
         bool_and(operacion.recibido_acumulado(l.id) = l.piezas_facturadas)
    into v_acum_total, v_fact_total, v_completa from operacion.compra_linea l where l.compra_id = c.id;
  update operacion.compra set estado = 'recibida_parcial' where id = c.id;
  if v_completa then
    perform operacion.cerrar_recepcion_interno(c.id, v_fecha, p_clave_idem || ':cierre', null);
  else
    perform operacion.avisar('llegada_pendiente_confirmar', 'NT-016', 'llegada_pendiente:' || c.id, 'I',
      'Recepcion parcial de ' || c.folio || ': llevan ' || v_acum_total || ' de ' || v_fact_total || ' piezas', 'compra', c.id,
      jsonb_build_object('folio', c.folio), null, v_ev, false, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('compra_id', c.id, 'folio', c.folio, 'piezas_ahora', v_total_ahora, 'valor_entrada_cent', v_valor_ahora, 'piezas_acumuladas', v_acum_total,
                              'piezas_facturadas', v_fact_total, 'pendientes', greatest(v_fact_total - v_acum_total, 0), 'completa', v_completa, 'estado', case when v_completa then 'recibida' else 'recibida_parcial' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- 2. Bot: la indicacion compra_recepcion (rename + wrap de la base de ejecutar_ext) -------------------------------------------------------------------
alter function agente._ejecutar_ext_base(text, text, jsonb) rename to _ejecutar_ext_base_sin_parcial;

create function agente._ejecutar_ext_base(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_existia boolean; v_id bigint; v_folio text; v_recib jsonb; v_res jsonb; v_estado text; v_pendiente jsonb;
begin
  if p_tipo <> 'compra_recepcion' then return agente._ejecutar_ext_base_sin_parcial(p_clave_idem, p_tipo, p_args); end if;
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
  v_id := agente._compra_id(p_args ->> 'compra_folio');
  if v_existia then
    -- Repeticion de la misma indicacion: se devuelve lo ya registrado, sea cual haya sido el camino de la primera vez.
    v_res := (select resultado from seguridad.operacion where clave = p_clave_idem);
  elsif jsonb_typeof(p_args -> 'lineas') = 'array' and jsonb_array_length(p_args -> 'lineas') > 0 then
    -- Recepcion PARCIAL: solo lo que el socio dicto; el servidor ubica el renglon de la compra por modelo y sabor. La compra sigue abierta hasta completar o cerrar.
    select coalesce(jsonb_agg(jsonb_build_object('linea_id', cl.id, 'sku_id', cl.sku_id, 'piezas', (x ->> 'piezas')::int)), '[]'::jsonb) into v_recib
      from jsonb_array_elements(p_args -> 'lineas') x
      join catalogo.sku k on k.modelo_id = (x ->> 'modelo_id')::bigint and k.sabor_id = nullif(x ->> 'sabor_id', '')::bigint
      join operacion.compra_linea cl on cl.compra_id = v_id and cl.sku_id = k.id;
    if jsonb_array_length(v_recib) <> jsonb_array_length(p_args -> 'lineas') then raise exception 'un renglon recibido no esta en la compra %', upper(p_args ->> 'compra_folio') using errcode = 'P0460'; end if;
    v_res := operacion.recibir_compra_parcial(p_clave_idem, v_id, v_recib, null);
  else
    select estado into v_estado from operacion.compra where id = v_id;
    if v_estado = 'recibida_parcial' then
      -- "Llego todo": se recibe el saldo pendiente de cada renglon (nunca mas de lo pedido).
      select coalesce(jsonb_agg(jsonb_build_object('linea_id', cl.id, 'sku_id', cl.sku_id, 'piezas', cl.piezas_facturadas - operacion.recibido_acumulado(cl.id)) order by cl.id), '[]'::jsonb) into v_pendiente
        from operacion.compra_linea cl where cl.compra_id = v_id and cl.piezas_facturadas > operacion.recibido_acumulado(cl.id);
      if jsonb_array_length(v_pendiente) = 0 then raise exception 'la compra % ya no tiene piezas pendientes', upper(p_args ->> 'compra_folio') using errcode = 'P0428'; end if;
      v_res := operacion.recibir_compra_parcial(p_clave_idem, v_id, v_pendiente, null);
    else
      select coalesce(jsonb_agg(jsonb_build_object('linea_id', cl.id, 'sku_id', cl.sku_id, 'piezas', cl.piezas_facturadas)), '[]'::jsonb) into v_recib from operacion.compra_linea cl where cl.compra_id = v_id;
      v_res := operacion.recibir_compra(p_clave_idem, v_id, v_recib, null);
    end if;
  end if;
  v_folio := agente._guardar_hecho2(p_clave_idem, 'compra_recepcion', 'compra', v_id, v_autor, null);
  v_res := v_res || jsonb_build_object('folio', v_folio, 'compra', upper(p_args ->> 'compra_folio'));
  -- La tarjeta muestra "Piezas": en una llegada parcial son las de ESTA llegada.
  if v_res ? 'piezas_ahora' then v_res := v_res || jsonb_build_object('piezas', v_res -> 'piezas_ahora'); end if;
  return v_res || jsonb_build_object('repetido', v_existia);
end $$;

-- 3. Efecto de la vista previa: incluye lo de ESTA llegada y lo pendiente (si cambian entre la vista previa y la ejecucion, el hash lo detecta) ------------
alter function agente._efecto(text, jsonb) rename to _efecto_sin_parcial;

create function agente._efecto(p_tipo text, p_res jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_tipo = 'compra_recepcion' then
    return jsonb_build_object('diferencias', coalesce(p_res -> 'diferencias', '[]'::jsonb), 'estado', p_res -> 'estado')
      || case when p_res ? 'piezas_ahora' then jsonb_build_object('piezas_ahora', p_res -> 'piezas_ahora', 'piezas_acumuladas', p_res -> 'piezas_acumuladas',
                                                                  'piezas_facturadas', p_res -> 'piezas_facturadas', 'pendientes', p_res -> 'pendientes') else '{}'::jsonb end;
  end if;
  return agente._efecto_sin_parcial(p_tipo, p_res);
end $$;

revoke all on function agente._ejecutar_ext_base(text, text, jsonb), agente._ejecutar_ext_base_sin_parcial(text, text, jsonb), agente._efecto(text, jsonb), agente._efecto_sin_parcial(text, jsonb) from public, anon, authenticated;
