-- Devoluciones / 1: recepcion PARCIAL de compras.
-- Hasta ahora una compra se recibia de una sola vez (recibir_compra). En la practica llegan paquetes sueltos: se cuenta lo que llego, la compra queda
-- 'recibida_parcial' y cada nueva llegada suma al inventario por lo RECIBIDO, con su parte del costo puesto (mercancia, guia y seguro prorrateados por
-- piezas facturadas, con redondeo acumulado: la suma de las partes es EXACTAMENTE el costo puesto de lo facturado). Al llegar todo, o al cerrar la
-- recepcion con un motivo, lo que no llego se vuelve diferencia (faltante o sobrante) con el mismo tratamiento de siempre (cuenta puente 1340).
-- Solo ADITIVO: la recepcion total (recibir_compra) no cambia y sigue siendo valida para compras sin recepciones parciales.
-- Nada se edita: cada llegada es un lote nuevo y sus movimientos del kardex; el cierre es un evento aparte.

-- Estado nuevo de la compra.
alter table operacion.compra drop constraint compra_estado_check;
alter table operacion.compra add constraint compra_estado_check
  check (estado in ('borrador', 'confirmada', 'enviada', 'en_trayecto', 'llego_merida', 'recibida_parcial', 'recibida', 'cerrada', 'anulada'));

-- Un lote por llegada (antes: uno por linea). La numeracion de la llegada distingue los lotes de una misma linea.
alter table operacion.lote drop constraint lote_compra_linea_id_key;
alter table operacion.lote add column recepcion_n int not null default 1 check (recepcion_n >= 1);
alter table operacion.lote add constraint lote_linea_recepcion_uq unique (compra_linea_id, recepcion_n);

-- Lo contado hasta ahora de una linea (suma de las llegadas).
create function operacion.recibido_acumulado(p_linea bigint) returns int
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(piezas), 0)::int from operacion.compra_recepcion where compra_linea_id = p_linea $$;

-- Costo puesto de cada linea de una compra: mercancia, guia y seguro prorrateados por piezas facturadas; la ultima linea absorbe el residuo (misma regla que recibir_compra).
create function operacion.puesto_lineas_compra(p_compra bigint) returns table (linea_id bigint, mercancia_cent bigint, guia_cent bigint, seguro_cent bigint, puesto_cent bigint, facturadas int)
language plpgsql stable security definer set search_path = ''
as $$
declare c operacion.compra; ln operacion.compra_linea; v_total int; v_n int; v_i int := 0; v_g bigint; v_s bigint; v_ga bigint := 0; v_sa bigint := 0;
begin
  select * into c from operacion.compra where id = p_compra;
  select coalesce(sum(piezas_facturadas), 0), count(*) into v_total, v_n from operacion.compra_linea where compra_id = p_compra;
  for ln in select * from operacion.compra_linea where compra_id = p_compra order by id loop
    v_i := v_i + 1;
    if v_i = v_n then v_g := c.guia_cent - v_ga; v_s := c.seguro_cent - v_sa;
    else v_g := negocio.redondear_medio_arriba(c.guia_cent * ln.piezas_facturadas, v_total); v_s := negocio.redondear_medio_arriba(c.seguro_cent * ln.piezas_facturadas, v_total); end if;
    v_ga := v_ga + v_g; v_sa := v_sa + v_s;
    linea_id := ln.id; mercancia_cent := ln.piezas_facturadas * ln.costo_unit_cent; guia_cent := v_g; seguro_cent := v_s;
    puesto_cent := mercancia_cent + v_g + v_s; facturadas := ln.piezas_facturadas;
    return next;
  end loop;
end $$;

-- Recepcion parcial. p_recibido = [{linea_id, sku_id | sabor, piezas}] con lo que llego AHORA. Suma al inventario solo lo contado.
-- Si con esta llegada toda linea queda exactamente completa, la recepcion se cierra sola (sin diferencias).
create function operacion.recibir_compra_parcial(p_clave_idem text, p_compra bigint, p_recibido jsonb, p_contado_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.compra; v_ev bigint; v_at timestamptz := coalesce(p_contado_at, now()); v_fecha date; pl record; rr record;
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

-- Cierre de la recepcion: fija lo recibido por linea y convierte lo que falta o sobra en diferencia (con el costo puesto no reconocido).
create function operacion.cerrar_recepcion_interno(p_compra bigint, p_fecha date, p_clave text, p_motivo text) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  c operacion.compra; v_ev bigint; pl record; v_cum int; v_entrada bigint; v_dif bigint; v_n int := 0;
begin
  select * into c from operacion.compra where id = p_compra;
  v_ev := operacion.crear_evento('compra_recepcion_cerrada', p_fecha, p_clave, jsonb_build_object('compra', c.folio, 'motivo', p_motivo));
  for pl in select * from operacion.puesto_lineas_compra(c.id) order by linea_id loop
    v_cum := operacion.recibido_acumulado(pl.linea_id);
    update operacion.compra_linea set piezas_recibidas = v_cum where id = pl.linea_id;
    select coalesce(sum(valor_entrada_cent), 0) into v_entrada from operacion.lote where compra_linea_id = pl.linea_id;
    if v_cum <> pl.facturadas then
      insert into operacion.compra_diferencia (compra_id, compra_linea_id, tipo, piezas, valor_cent, evento_id)
        values (c.id, pl.linea_id, case when v_cum < pl.facturadas then 'faltante' else 'sobrante' end, abs(pl.facturadas - v_cum), abs(pl.puesto_cent - v_entrada), v_ev) returning id into v_dif;
      v_n := v_n + 1;
      perform operacion.avisar('diferencia_recepcion_abierta', 'NT-017', 'diferencia_recepcion:' || v_dif, 'I',
        'Recepcion de ' || c.folio || ' con diferencia: ' || abs(pl.facturadas - v_cum) || ' pz ' || case when v_cum < pl.facturadas then 'faltantes' else 'sobrantes' end,
        'compra_diferencia', v_dif, jsonb_build_object('folio', c.folio, 'piezas', abs(pl.facturadas - v_cum)), null, v_ev, false, array['software', 'telegram']);
    end if;
  end loop;
  update operacion.compra set estado = 'recibida', recibida_fecha = p_fecha where id = c.id;
  perform operacion.resolver_avisos('llegada_pendiente_confirmar', 'compra', c.id);
  return v_n;
end $$;

-- Cierre explicito: lo que no llego queda como faltante (y lo que sobra, como sobrante). Exige motivo si hay diferencia.
create function operacion.cerrar_recepcion_compra(p_clave_idem text, p_compra bigint, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.compra; v_hay_dif boolean; v_n int; v_res jsonb; v_fact int; v_cum int;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_recepcion_compra', 'c', p_compra, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado <> 'recibida_parcial' then raise exception 'la compra % esta %: solo una con recepcion parcial se cierra asi', c.folio, c.estado using errcode = 'P0428'; end if;
  select coalesce(sum(piezas_facturadas), 0)::int, coalesce(sum(operacion.recibido_acumulado(id)), 0)::int, bool_or(operacion.recibido_acumulado(id) <> piezas_facturadas)
    into v_fact, v_cum, v_hay_dif from operacion.compra_linea where compra_id = c.id;
  if v_hay_dif and nullif(btrim(p_motivo), '') is null then raise exception 'cerrar con diferencias exige motivo (llegaron % de % piezas)', v_cum, v_fact using errcode = '23502'; end if;
  v_n := operacion.cerrar_recepcion_interno(c.id, negocio.hoy(), p_clave_idem, nullif(btrim(p_motivo), ''));
  v_res := jsonb_build_object('compra_id', c.id, 'folio', c.folio, 'estado', 'recibida', 'piezas_recibidas', v_cum, 'piezas_facturadas', v_fact, 'diferencias', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Recepcion parcial en la lista cerrada de la web: se expone en la migracion de la API.
revoke execute on all functions in schema operacion from public, anon, authenticated;
