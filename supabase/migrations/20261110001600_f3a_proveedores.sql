-- F3a / 0016: cuenta con cada proveedor completa: hoja de tres bloques, liquidacion de los viernes con su comprobacion, conciliacion contra lo que dice el
-- proveedor, ajustes, pagos de la sociedad y filtro de ambito ("Solo de la sociedad" | "Todo, por dueno").
-- Falta por saldar = saldo anterior + costo total (mercancia + seguros + guias) - pagos - ajustes a favor.
-- La semana de liquidacion corre de sabado a viernes (lo enviado el fin de semana cae en la siguiente); cierra a partir del viernes.
-- Isaac y Karen nunca se mezclan: cada hoja es de un solo proveedor. Un pedido "Karen via Isaac" cuesta mercancia a Karen y seguro de reenvio (y la guia) a Isaac.

-- Lunes de la semana de liquidacion que contiene la fecha (la semana corre de sabado a viernes).
create function operacion.semana_liquidacion_ini(p_fecha date) returns date
language sql immutable parallel safe set search_path = ''
as $$ select operacion.semana_omar_ini(p_fecha + 2) $$;

create table operacion.proveedor_dicho (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references catalogo.proveedor (id),
  semana_ini date not null check (extract(isodow from semana_ini) = 1),
  ambito text not null check (ambito in ('sociedad', 'todo')),
  total_cent bigint not null,
  renglones jsonb not null default '[]'::jsonb,
  nota text,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);
create index proveedor_dicho_idx on operacion.proveedor_dicho (proveedor_id, semana_ini, ambito, id);

create table operacion.liquidacion_proveedor (
  id bigint generated always as identity primary key,
  folio text not null unique,
  proveedor_id bigint not null references catalogo.proveedor (id),
  semana_ini date not null check (extract(isodow from semana_ini) = 1),
  semana_fin date not null,
  ambito text not null check (ambito in ('sociedad', 'todo')),
  saldo_anterior_cent bigint not null,
  mercancia_cent bigint not null,
  seguros_cent bigint not null,
  guias_cent bigint not null,
  pagos_cent bigint not null,
  ajustes_cent bigint not null,
  falta_por_saldar_cent bigint not null,
  dicho_por_proveedor_cent bigint,
  diferencia_cent bigint,
  nota text,
  snapshot jsonb not null,
  fecha_cierre date not null,
  evento_id bigint not null references operacion.evento (id),
  unique (proveedor_id, semana_ini, ambito),
  check (semana_fin = semana_ini + 4)
);

do $$
declare t text;
begin
  foreach t in array array['proveedor_dicho', 'liquidacion_proveedor'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Capturas: ajuste, pago de la sociedad, deshacer, ambito del pedido y lo que dice el proveedor
-- ---------------------------------------------------------------------------
-- Monto con signo: > 0 a favor de la sociedad (el proveedor le debe o descuenta); < 0 la sociedad le debe mas.
create function operacion.registrar_ajuste_proveedor(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_tipo text, p_motivo text, p_fecha date default null,
                                                     p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_prov bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_ajuste_proveedor', 'p', p_proveedor, 'm', p_monto_cent, 't', p_tipo, 'mo', p_motivo, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent = 0 then raise exception 'el ajuste no puede ser cero' using errcode = '23514'; end if;
  if p_tipo not in ('error_bodega', 'seguro_reenvio', 'pago_de_mas', 'saldo_a_favor', 'descuento_proveedor') then raise exception 'tipo de ajuste invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'el ajuste exige motivo' using errcode = '23502'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || v_prov, 0));
  v_ev := operacion.crear_evento('ajuste_proveedor', v_fecha, p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'monto_cent', p_monto_cent, 'tipo', p_tipo), p_mensaje_origen);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
    values (v_prov, v_fecha, 'ajuste', p_monto_cent, replace(p_tipo, '_', ' ') || ': ' || btrim(p_motivo), v_ev) returning id into v_id;
  v_res := jsonb_build_object('movimiento_id', v_id, 'saldo_proveedor_cent', operacion.saldo_proveedor(v_prov));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Pago hecho con dinero de la sociedad (su cuenta o caja): sube el saldo a favor con el proveedor.
create function operacion.registrar_pago_proveedor_sociedad(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_fecha date default null, p_nota text default null,
                                                            p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_prov bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago_proveedor_sociedad', 'p', p_proveedor, 'm', p_monto_cent, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || v_prov, 0));
  v_ev := operacion.crear_evento('pago_proveedor_sociedad', v_fecha, p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'monto_cent', p_monto_cent), p_mensaje_origen);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
    values (v_prov, v_fecha, 'pago_sociedad', p_monto_cent, coalesce(p_nota, 'Pago de la sociedad a ' || p_proveedor), v_ev) returning id into v_id;
  v_res := jsonb_build_object('movimiento_id', v_id, 'saldo_proveedor_cent', operacion.saldo_proveedor(v_prov));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Deshace un ajuste o un pago de la sociedad con su movimiento contrario enlazado.
create function operacion.anular_movimiento_proveedor(p_clave_idem text, p_movimiento bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; m operacion.cuenta_proveedor_mov; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_movimiento_proveedor', 'm', p_movimiento, 'mo', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'deshacer exige motivo' using errcode = '23502'; end if;
  select * into m from operacion.cuenta_proveedor_mov where id = p_movimiento for update;
  if not found then raise exception 'movimiento desconocido' using errcode = '22023'; end if;
  if m.concepto not in ('ajuste', 'pago_sociedad') then raise exception 'solo se deshacen ajustes y pagos de la sociedad (esto es: %)', m.concepto using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.cuenta_proveedor_mov r where r.reversa_de = m.id) then raise exception 'ese movimiento ya esta deshecho' using errcode = 'P0428'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || m.proveedor_id, 0));
  v_ev := operacion.crear_evento('deshacer_movimiento_proveedor', negocio.hoy(), p_clave_idem, jsonb_build_object('movimiento', m.id), null, null, null);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id, reversa_de)
    values (m.proveedor_id, m.fecha_neg, 'reversa', -m.monto_cent, 'Se deshace: ' || p_motivo, v_ev, m.id);
  v_res := jsonb_build_object('deshecho', true, 'saldo_proveedor_cent', operacion.saldo_proveedor(m.proveedor_id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Un pedido propio de un socio (no de la sociedad) no entra a la hoja por omision: "Solo de la sociedad" lo deja fuera, "Todo, por dueno" lo incluye.
create function operacion.fijar_ambito_pedido(p_clave_idem text, p_pedido bigint, p_es_de_sociedad boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'fijar_ambito_pedido', 'p', p_pedido, 's', p_es_de_sociedad, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'cambiar el ambito exige motivo' using errcode = '23502'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('ambito_pedido', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'es_de_sociedad', p_es_de_sociedad, 'motivo', p_motivo));
  update operacion.pedido set es_de_sociedad = p_es_de_sociedad where id = ped.id;
  v_res := jsonb_build_object('pedido_id', ped.id, 'es_de_sociedad', p_es_de_sociedad);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Lo que dice el proveedor de la semana (total y, si lo trae, renglon por renglon por folio). No se toma por verdad: se compara con lo nuestro.
create function operacion.registrar_dicho_proveedor(p_clave_idem text, p_proveedor text, p_semana_ini date, p_ambito text, p_total_cent bigint, p_renglones jsonb default '[]'::jsonb,
                                                    p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_prov bigint; v_ini date := operacion.semana_omar_ini(p_semana_ini); v_ev bigint; v_res jsonb; v_hoja jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_dicho_proveedor', 'p', p_proveedor, 's', p_semana_ini, 'a', p_ambito, 't', p_total_cent, 'r', p_renglones, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_ambito not in ('sociedad', 'todo') then raise exception 'ambito invalido' using errcode = '22023'; end if;
  if p_total_cent is null or p_total_cent < 0 then raise exception 'el total que dice el proveedor no puede ser negativo' using errcode = '23514'; end if;
  if jsonb_typeof(p_renglones) <> 'array' then raise exception 'los renglones van en una lista' using errcode = '22023'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.liquidacion_proveedor where proveedor_id = v_prov and semana_ini = v_ini and ambito = p_ambito) then
    raise exception 'esa semana ya esta liquidada' using errcode = 'P0428';
  end if;
  v_ev := operacion.crear_evento('dicho_proveedor', negocio.hoy(), p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'semana_ini', v_ini, 'total_cent', p_total_cent));
  insert into operacion.proveedor_dicho (proveedor_id, semana_ini, ambito, total_cent, renglones, nota, evento_id) values (v_prov, v_ini, p_ambito, p_total_cent, p_renglones, p_nota, v_ev);
  v_hoja := operacion.hoja_proveedor(p_proveedor, v_ini, p_ambito);
  v_res := jsonb_build_object('dicho_cent', p_total_cent, 'falta_por_saldar_cent', (v_hoja->'totales'->>'falta_por_saldar_cent')::bigint, 'diferencia_cent', (v_hoja->'conciliacion'->>'diferencia_cent')::bigint);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Hoja de la semana (tres bloques) y su comprobacion
-- ---------------------------------------------------------------------------
create function operacion.hoja_proveedor(p_proveedor text, p_semana_ini date, p_ambito text default 'sociedad') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prov bigint; v_ini date := operacion.semana_omar_ini(p_semana_ini); v_fin date := operacion.semana_omar_ini(p_semana_ini) + 4; v_desde date := operacion.semana_omar_ini(p_semana_ini) - 2;
  v_origenes text[]; v_seguro bigint; v_rengs jsonb; v_abonos jsonb; v_ajustes jsonb; v_mercancia bigint; v_seguros bigint; v_guias bigint; v_pagos bigint; v_ajus bigint; v_ant bigint;
  v_m2 bigint; v_g2 bigint; v_s2 bigint; v_falta bigint; v_dicho operacion.proveedor_dicho; v_liq operacion.liquidacion_proveedor; v_pagos_conc jsonb; v_conc jsonb; v_dif bigint;
  v_cuadra_rengs boolean; v_cuadra_abonos boolean; v_pagos2 bigint;
begin
  if p_ambito not in ('sociedad', 'todo') then raise exception 'ambito invalido' using errcode = '22023'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_origenes := case p_proveedor when 'Isaac' then array['isaac_directo', 'karen_via_isaac'] else array['karen_directo', 'karen_via_isaac'] end;
  v_seguro := coalesce((catalogo.config_valor('seguro_reenvio_cent', v_fin))::text::bigint, 0);

  -- Bloque 1 y 3: una nota por pedido a costo (con su guia) y las ordenes de compra confirmadas en la semana.
  select coalesce(jsonb_agg(r order by r->>'fecha', r->>'tipo', (r->>'id')::bigint), '[]'::jsonb) into v_rengs from (
    select jsonb_build_object('tipo', 'pedido', 'id', p.id, 'folio', p.folio, 'fecha', p.fecha_envio, 'cliente', p.cliente, 'duenio', p.duenio, 'es_de_sociedad', p.es_de_sociedad, 'origen', p.origen,
      'piezas', p.piezas, 'mercancia_cent', p.mercancia, 'seguro_cent', p.seguro, 'guia_cent', p.guia, 'guia_pendiente', p.guia_pendiente,
      'costo_cent', p.mercancia + p.seguro + p.guia, 'detalle', p.detalle, 'detalle_cent', p.detalle_cent, 'cuadra', p.detalle_cent = p.mercancia + p.seguro) as r
    from (
      select pe.id, pe.folio, pe.fecha_envio, pe.origen, pe.es_de_sociedad, c.nombre_canonico as cliente, so.nombre as duenio,
             d.piezas,
             case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then d.bruto - v_seguro * d.piezas else 0 end) else d.bruto end as mercancia,
             case when pe.origen = 'karen_via_isaac' and p_proveedor = 'Isaac' then v_seguro * d.piezas else 0 end as seguro,
             case when (p_proveedor = 'Isaac' and pe.origen in ('isaac_directo', 'karen_via_isaac')) or (p_proveedor = 'Karen' and pe.origen = 'karen_directo') then g.guia else 0 end as guia,
             g.pendiente as guia_pendiente, d.detalle, d.detalle_cent
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio so on so.id = c.duenio_id
      join lateral (
        select sum(x.piezas)::int as piezas, sum(x.costo)::bigint as bruto,
               jsonb_agg(jsonb_build_object('modelo', x.modelo, 'piezas', x.piezas, 'costo_cent',
                   case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then x.costo - v_seguro * x.piezas else v_seguro * x.piezas end) else x.costo end,
                   'costo_unit_cent', negocio.redondear_medio_arriba(case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then x.costo - v_seguro * x.piezas else v_seguro * x.piezas end) else x.costo end, x.piezas))
                 order by x.modelo) as detalle,
               sum(case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then x.costo - v_seguro * x.piezas else v_seguro * x.piezas end) else x.costo end)::bigint as detalle_cent
        from (select m.nombre_canonico as modelo, sum(s.piezas)::int as piezas, sum(s.costo_valor_cent)::bigint as costo
              from operacion.pedido_linea l join operacion.pedido_surtido s on s.pedido_linea_id = l.id join catalogo.modelo m on m.id = l.modelo_id
              where l.pedido_id = pe.id group by m.nombre_canonico) x
      ) d on d.piezas is not null
      join lateral (
        select coalesce(sum(gu.costo_cent), 0)::bigint as guia, coalesce(bool_or(gu.costo_cent is null), false) as pendiente
        from operacion.guia gu where gu.pedido_id = pe.id and gu.sentido = 'salida' and gu.pagada_por_socio_id is null
      ) g on true
      where pe.estado = 'enviado' and pe.fecha_envio between v_desde and v_fin and pe.origen = any (v_origenes) and (p_ambito = 'todo' or pe.es_de_sociedad)
    ) p
    union all
    select jsonb_build_object('tipo', 'oc', 'id', co.id, 'folio', co.folio, 'fecha', negocio.fecha_neg(co.confirmada_at), 'cliente', null, 'duenio', null, 'es_de_sociedad', co.ambito = 'sociedad', 'origen', 'orden_de_compra',
      'piezas', d.piezas, 'mercancia_cent', co.mercancia_cent, 'seguro_cent', co.seguro_cent, 'guia_cent', case when co.guia_pagada_por_socio_id is null then co.guia_cent else 0 end, 'guia_pendiente', false,
      'costo_cent', co.mercancia_cent + co.seguro_cent + case when co.guia_pagada_por_socio_id is null then co.guia_cent else 0 end, 'detalle', d.detalle, 'detalle_cent', d.detalle_cent, 'cuadra', d.detalle_cent = co.mercancia_cent)
    from operacion.compra co
    join lateral (
      select sum(x.facturadas)::int as piezas, sum(x.costo)::bigint as detalle_cent,
             jsonb_agg(jsonb_build_object('modelo', x.modelo, 'piezas', x.facturadas, 'costo_cent', x.costo, 'costo_unit_cent', negocio.redondear_medio_arriba(x.costo, x.facturadas)) order by x.modelo) as detalle
      from (select m.nombre_canonico as modelo, sum(cl.piezas_facturadas)::int as facturadas, sum(cl.piezas_facturadas * cl.costo_unit_cent)::bigint as costo
            from operacion.compra_linea cl join catalogo.modelo m on m.id = cl.modelo_id where cl.compra_id = co.id group by m.nombre_canonico) x
    ) d on true
    where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null and negocio.fecha_neg(co.confirmada_at) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')
  ) q;

  select coalesce(sum((r->>'mercancia_cent')::bigint), 0), coalesce(sum((r->>'seguro_cent')::bigint), 0), coalesce(sum((r->>'guia_cent')::bigint), 0), coalesce(bool_and((r->>'cuadra')::boolean), true)
    into v_mercancia, v_seguros, v_guias, v_cuadra_rengs from jsonb_array_elements(v_rengs) r;

  -- Comprobacion independiente (otra consulta): mercancia, seguros y guias directo de los libros.
  select coalesce(sum(case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then s.costo_valor_cent - v_seguro * s.piezas else 0 end) else s.costo_valor_cent end), 0)::bigint,
         coalesce(sum(case when pe.origen = 'karen_via_isaac' and p_proveedor = 'Isaac' then v_seguro * s.piezas else 0 end), 0)::bigint
    into v_m2, v_s2
  from operacion.pedido pe join operacion.pedido_linea l on l.pedido_id = pe.id join operacion.pedido_surtido s on s.pedido_linea_id = l.id
  where pe.estado = 'enviado' and pe.fecha_envio between v_desde and v_fin and pe.origen = any (v_origenes) and (p_ambito = 'todo' or pe.es_de_sociedad);
  v_m2 := v_m2 + coalesce((select sum(co.mercancia_cent) from operacion.compra co where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null
                            and negocio.fecha_neg(co.confirmada_at) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')), 0);
  v_s2 := v_s2 + coalesce((select sum(co.seguro_cent) from operacion.compra co where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null
                            and negocio.fecha_neg(co.confirmada_at) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')), 0);
  select coalesce(sum(gu.costo_cent), 0)::bigint into v_g2
  from operacion.pedido pe join operacion.guia gu on gu.pedido_id = pe.id and gu.sentido = 'salida' and gu.pagada_por_socio_id is null
  where pe.estado = 'enviado' and pe.fecha_envio between v_desde and v_fin and pe.origen = any (v_origenes) and (p_ambito = 'todo' or pe.es_de_sociedad)
    and ((p_proveedor = 'Isaac' and pe.origen in ('isaac_directo', 'karen_via_isaac')) or (p_proveedor = 'Karen' and pe.origen = 'karen_directo'));
  v_g2 := v_g2 + coalesce((select sum(co.guia_cent) from operacion.compra co where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null and co.guia_pagada_por_socio_id is null
                            and negocio.fecha_neg(co.confirmada_at) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')), 0);

  -- Bloque 2: abonos (cada uno con su cliente aunque el proveedor lo vea sin nombre) y ajustes. Una reversa cuenta con el concepto de lo que deshace.
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', coalesce(o.concepto, m.concepto), 'monto_cent', m.monto_cent, 'cliente', c.nombre_canonico,
         'pedido', pe.folio, 'cuenta_origen', cd.nombre, 'nota', m.nota, 'deshecho', m.concepto = 'reversa') || operacion.evento_info(m.evento_id) order by m.fecha_neg, m.id), '[]'::jsonb),
         coalesce(sum(m.monto_cent), 0)::bigint
    into v_abonos, v_pagos
  from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
  left join catalogo.cliente c on c.id = m.cliente_id left join operacion.pedido pe on pe.id = m.pedido_id left join operacion.cuenta_dinero cd on cd.id = m.cuenta_origen_id
  where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad');
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_pagos_conc from (
    select coalesce(o.concepto, m.concepto) as k, sum(m.monto_cent)::bigint as v from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
    where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad') group by 1) z;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', coalesce(o.concepto, m.concepto), 'monto_cent', m.monto_cent, 'nota', m.nota, 'deshecho', m.concepto = 'reversa') || operacion.evento_info(m.evento_id) order by m.fecha_neg, m.id), '[]'::jsonb),
         coalesce(sum(m.monto_cent), 0)::bigint
    into v_ajustes, v_ajus
  from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
  where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('ajuste', 'reclamo_diferencia');
  select coalesce(sum(m.monto_cent), 0)::bigint into v_pagos2 from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
    where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad');
  v_cuadra_abonos := v_pagos = v_pagos2 and v_pagos = coalesce((select sum(e.value::bigint) from jsonb_each_text(v_pagos_conc) e), 0);

  select coalesce(l.falta_por_saldar_cent, 0) into v_ant from (select 1) u left join lateral (
    select falta_por_saldar_cent from operacion.liquidacion_proveedor where proveedor_id = v_prov and ambito = p_ambito and semana_ini < v_ini order by semana_ini desc limit 1) l on true;
  v_falta := v_ant + v_mercancia + v_seguros + v_guias - v_pagos - v_ajus;

  select * into v_dicho from operacion.proveedor_dicho where proveedor_id = v_prov and semana_ini = v_ini and ambito = p_ambito order by id desc limit 1;
  select * into v_liq from operacion.liquidacion_proveedor where proveedor_id = v_prov and semana_ini = v_ini and ambito = p_ambito;
  if v_dicho.id is not null then
    v_dif := v_dicho.total_cent - v_falta;
    select coalesce(jsonb_agg(jsonb_build_object('folio', x.folio, 'dice_cent', x.dice, 'nuestro_cent', x.nuestro, 'diferencia_cent', coalesce(x.dice, 0) - coalesce(x.nuestro, 0), 'en_nuestra_hoja', x.nuestro is not null) order by x.folio), '[]'::jsonb) into v_conc
    from (select coalesce(d.folio, n.folio) as folio, d.dice, n.nuestro
          from (select e->>'folio' as folio, (e->>'monto_cent')::bigint as dice from jsonb_array_elements(v_dicho.renglones) e) d
          full join (select r->>'folio' as folio, (r->>'costo_cent')::bigint as nuestro from jsonb_array_elements(v_rengs) r) n on n.folio = d.folio) x;
  else
    v_conc := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'proveedor', p_proveedor, 'modalidad', (select modalidad from catalogo.proveedor where id = v_prov), 'ambito', p_ambito, 'semana_ini', v_ini, 'semana_fin', v_fin, 'desde', v_desde, 'viernes_cerrado', negocio.hoy() >= v_fin,
    'renglones', v_rengs, 'abonos', v_abonos, 'ajustes', v_ajustes, 'pagos_por_concepto_cent', v_pagos_conc,
    'totales', jsonb_build_object('saldo_anterior_cent', v_ant, 'mercancia_cent', v_mercancia, 'seguros_cent', v_seguros, 'guias_cent', v_guias, 'costo_total_cent', v_mercancia + v_seguros + v_guias,
                                  'pagos_cent', v_pagos, 'ajustes_cent', v_ajus, 'falta_por_saldar_cent', v_falta),
    'comprobaciones', jsonb_build_object(
      'renglon_igual_detalle', v_cuadra_rengs,
      'renglones_igual_mercancia', v_mercancia = v_m2, 'mercancia_independiente_cent', v_m2,
      'renglones_igual_seguros', v_seguros = v_s2, 'seguros_independiente_cent', v_s2,
      'guias_igual_envios', v_guias = v_g2, 'guias_independiente_cent', v_g2,
      'abonos_igual_depositos', v_cuadra_abonos, 'depositos_independiente_cent', v_pagos2,
      'cuadra', v_cuadra_rengs and v_mercancia = v_m2 and v_seguros = v_s2 and v_guias = v_g2 and v_cuadra_abonos),
    'guias_pendientes', (select count(*)::int from jsonb_array_elements(v_rengs) r where (r->>'guia_pendiente')::boolean),
    'conciliacion', case when v_dicho.id is null then null else jsonb_build_object('dicho_cent', v_dicho.total_cent, 'nuestro_cent', v_falta, 'diferencia_cent', v_dif, 'nota', v_dicho.nota, 'renglones', v_conc) end,
    'cierre', case when v_liq.id is null then null else jsonb_build_object('folio', v_liq.folio, 'fecha_cierre', v_liq.fecha_cierre, 'falta_por_saldar_cent', v_liq.falta_por_saldar_cent, 'dicho_cent', v_liq.dicho_por_proveedor_cent, 'diferencia_cent', v_liq.diferencia_cent) end);
end $$;

-- Cierre del viernes: congela la hoja (con lo que dice el proveedor, si lo hay). A partir del viernes de esa semana.
create function operacion.cerrar_liquidacion_proveedor(p_clave_idem text, p_proveedor text, p_semana_ini date, p_ambito text default 'sociedad', p_nota text default null,
                                                       p_fecha_cierre date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_prov bigint; v_ini date := operacion.semana_omar_ini(p_semana_ini); v_cierre date := coalesce(p_fecha_cierre, negocio.hoy()); v_h jsonb; v_ev bigint; v_folio text; v_id bigint; v_res jsonb; v_t jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_liquidacion_proveedor', 'p', p_proveedor, 's', p_semana_ini, 'a', p_ambito, 'n', p_nota, 'f', p_fecha_cierre));
  if v_prev is not null then return v_prev; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  if v_cierre < v_ini + 4 then raise exception 'la semana del % al % se liquida a partir del viernes %', v_ini, v_ini + 4, v_ini + 4 using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.liquidacion_proveedor where proveedor_id = v_prov and semana_ini = v_ini and ambito = p_ambito) then raise exception 'esa semana ya esta liquidada' using errcode = 'P0428'; end if;
  v_h := operacion.hoja_proveedor(p_proveedor, v_ini, p_ambito);
  if not (v_h->'comprobaciones'->>'cuadra')::boolean then raise exception 'la hoja no cuadra: revisa las comprobaciones antes de liquidar' using errcode = 'P0428'; end if;
  v_t := v_h->'totales';
  v_ev := operacion.crear_evento('liquidacion_proveedor', v_cierre, p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'semana_ini', v_ini, 'ambito', p_ambito));
  v_folio := seguridad.siguiente_folio('L');
  insert into operacion.liquidacion_proveedor (folio, proveedor_id, semana_ini, semana_fin, ambito, saldo_anterior_cent, mercancia_cent, seguros_cent, guias_cent, pagos_cent, ajustes_cent,
                                               falta_por_saldar_cent, dicho_por_proveedor_cent, diferencia_cent, nota, snapshot, fecha_cierre, evento_id)
    values (v_folio, v_prov, v_ini, v_ini + 4, p_ambito, (v_t->>'saldo_anterior_cent')::bigint, (v_t->>'mercancia_cent')::bigint, (v_t->>'seguros_cent')::bigint, (v_t->>'guias_cent')::bigint,
            (v_t->>'pagos_cent')::bigint, (v_t->>'ajustes_cent')::bigint, (v_t->>'falta_por_saldar_cent')::bigint,
            (v_h->'conciliacion'->>'dicho_cent')::bigint, (v_h->'conciliacion'->>'diferencia_cent')::bigint, p_nota, v_h, v_cierre, v_ev) returning id into v_id;
  v_res := jsonb_build_object('liquidacion_id', v_id, 'folio', v_folio, 'falta_por_saldar_cent', (v_t->>'falta_por_saldar_cent')::bigint, 'guias_pendientes', (v_h->>'guias_pendientes')::int);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas para la web
-- ---------------------------------------------------------------------------
create function api.proveedor_hoja(p_proveedor text, p_semana_ini date default null, p_ambito text default 'sociedad') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.hoja_proveedor(p_proveedor, coalesce(p_semana_ini, operacion.semana_liquidacion_ini(negocio.hoy())), p_ambito);
end $$;

-- Texto para copiar y pegar al proveedor: totales por modelo, guias y falta por saldar. Sin nombres de clientes.
create function api.nota_proveedor(p_proveedor text, p_semana_ini date default null, p_ambito text default 'sociedad') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_h jsonb; v_texto text; l record;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_h := operacion.hoja_proveedor(p_proveedor, coalesce(p_semana_ini, operacion.semana_liquidacion_ini(negocio.hoy())), p_ambito);
  v_texto := 'Cuenta de la semana del ' || (v_h->>'semana_ini') || ' al ' || (v_h->>'semana_fin') || ' (' || p_proveedor || E')\n';
  for l in
    select d->>'modelo' as modelo, sum((d->>'piezas')::int)::int as piezas, sum((d->>'costo_cent')::bigint)::bigint as costo
    from jsonb_array_elements(v_h->'renglones') r, jsonb_array_elements(r->'detalle') d group by d->>'modelo' order by d->>'modelo'
  loop
    v_texto := v_texto || l.modelo || ': ' || l.piezas || ' pz = $' || operacion.fmt_pesos(l.costo) || E'\n';
  end loop;
  v_texto := v_texto || 'Mercancía y seguros: $' || operacion.fmt_pesos((v_h->'totales'->>'mercancia_cent')::bigint + (v_h->'totales'->>'seguros_cent')::bigint) || E'\n'
                     || 'Guías: $' || operacion.fmt_pesos((v_h->'totales'->>'guias_cent')::bigint) || E'\n'
                     || 'Total: $' || operacion.fmt_pesos((v_h->'totales'->>'costo_total_cent')::bigint) || E'\n'
                     || 'Pagos recibidos: $' || operacion.fmt_pesos((v_h->'totales'->>'pagos_cent')::bigint);
  if (v_h->'totales'->>'ajustes_cent')::bigint <> 0 then v_texto := v_texto || E'\nAjustes: $' || operacion.fmt_pesos((v_h->'totales'->>'ajustes_cent')::bigint); end if;
  if (v_h->'totales'->>'saldo_anterior_cent')::bigint <> 0 then v_texto := v_texto || E'\nSaldo anterior: $' || operacion.fmt_pesos((v_h->'totales'->>'saldo_anterior_cent')::bigint); end if;
  v_texto := v_texto || E'\nFalta por saldar: $' || operacion.fmt_pesos((v_h->'totales'->>'falta_por_saldar_cent')::bigint, true);
  return jsonb_build_object('texto', v_texto);
end $$;

create function api.liquidaciones_proveedor(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'folio', l.folio, 'semana_ini', l.semana_ini, 'semana_fin', l.semana_fin, 'ambito', l.ambito, 'saldo_anterior_cent', l.saldo_anterior_cent,
      'mercancia_cent', l.mercancia_cent, 'seguros_cent', l.seguros_cent, 'guias_cent', l.guias_cent, 'pagos_cent', l.pagos_cent, 'ajustes_cent', l.ajustes_cent,
      'falta_por_saldar_cent', l.falta_por_saldar_cent, 'dicho_cent', l.dicho_por_proveedor_cent, 'diferencia_cent', l.diferencia_cent, 'fecha_cierre', l.fecha_cierre, 'nota', l.nota) order by l.semana_ini desc, l.id desc)
    from operacion.liquidacion_proveedor l join catalogo.proveedor p on p.id = l.proveedor_id where p.nombre = p_proveedor), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* de escritura (rol socio) y permisos
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['registrar_ajuste_proveedor', 'registrar_pago_proveedor_sociedad', 'anular_movimiento_proveedor', 'fijar_ambito_pedido',
                                                              'registrar_dicho_proveedor', 'cerrar_liquidacion_proveedor'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;

grant execute on function api.proveedor_hoja(text, date, text), api.nota_proveedor(text, date, text), api.liquidaciones_proveedor(text) to authenticated;
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
