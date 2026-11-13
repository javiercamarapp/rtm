-- Dropshipping / 0200: utilidad por pedido, reparto 50/50 por socio, utilidad REINVERTIDA en el proveedor y reporte mensual por socio.
-- ADITIVA y de solo lectura: NO crea asientos nuevos ni conceptos nuevos de libro (para no duplicar ni doble contar con el acta de corte).
--
-- Diseno contable (regla del dueno, 13-nov):
--   * Cuando el cliente paga y la venta se deposita completa en la cuenta del proveedor, el COSTO del pedido liquida el pedido y el EXCEDENTE (venta - costo) queda como saldo a favor
--     con el proveedor: es utilidad REINVERTIDA, mitad para cada socio. Los pagos parciales amortizan primero el costo (el excedente es lo depositado por encima del costo).
--   * Los pedidos "a costo" (venta interna del socio a su menudeo) no generan utilidad.
--   * El libro ya lo asienta todo: la venta (ingreso), el costo de venta, la cuenta por pagar al proveedor y, con el deposito del cliente al proveedor, el saldo a favor con el proveedor
--     (que la valuacion ya cuenta como activo). La utilidad entra al resultado del periodo. Se vuelve CAPITAL del socio (3110/3120) SOLO por el acta de corte: ahi cada socio declara
--     cuanto reinvierte (socio_libro 'reinversion' + aportacion de capital con ref_tipo 'reinversion'). Este modulo no asienta esa reinversion por su cuenta: calcula cuanto de la
--     utilidad esta fisicamente reinvertida en el proveedor y lo ofrece como SUGERENCIA para el acta. Asi no hay doble conteo con el acta.
--   * "Retirado": un retiro real solo existe por acta (por socio y por mes), no por pedido. Por pedido se muestra lo reinvertido y lo que quedo fuera del proveedor (por cobrar o en poder
--     de un socio); por mes se muestran los retiros y las reinversiones del acta.

-- Reparto de un monto entre los socios segun su participacion (50/50 hoy). El primer socio (por id) recibe el redondeo medio hacia arriba y el segundo el resto: la suma siempre cuadra.
create function operacion.ds_reparto(p_monto_cent bigint) returns table (socio_id bigint, socio text, monto_cent bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare s record; v_acum bigint := 0; v_n int; v_i int := 0; v_parte bigint; v_sign int := case when p_monto_cent < 0 then -1 else 1 end;
begin
  select count(*) into v_n from catalogo.socio;
  for s in select id, nombre, participacion_ppm from catalogo.socio order by id loop
    v_i := v_i + 1;
    v_parte := case when v_i = v_n then p_monto_cent - v_acum else v_sign * negocio.redondear_medio_arriba(abs(p_monto_cent) * s.participacion_ppm, 1000000) end;
    v_acum := v_acum + v_parte;
    socio_id := s.id; socio := s.nombre; monto_cent := v_parte;
    return next;
  end loop;
end $$;

create view operacion.v_ds_utilidad with (security_barrier = true) as
select v.pedido_id, v.folio, v.cliente_id, v.cliente, v.fecha_envio, v.tipo_venta, v.proveedor, v.piezas_surtidas,
       v.venta_cent, (v.costo_cent + v.seguro_cent)::bigint as costo_cent,
       case when v.tipo_venta = 'socio_a_costo' then 0 else (v.venta_cent - v.costo_cent - v.seguro_cent) end::bigint as utilidad_cent,
       d.depositado_cent,
       case when v.tipo_venta = 'socio_a_costo' or v.venta_cent - v.costo_cent - v.seguro_cent <= 0 then 0
            else least(v.venta_cent - v.costo_cent - v.seguro_cent, greatest(least(d.depositado_cent, v.venta_cent) - (v.costo_cent + v.seguro_cent), 0)) end::bigint as reinvertida_cent
from operacion.v_ds_pedido v
cross join lateral (
  select coalesce(sum(pa.monto_cent), 0)::bigint as depositado_cent
  from operacion.pago_aplicacion pa join operacion.pago p on p.id = pa.pago_id join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id
  where pa.pedido_id = v.pedido_id and cd.titular_tipo = 'proveedor') d
where v.origen_surtido = 'dropshipping' and v.estado = 'enviado';
revoke all on operacion.v_ds_utilidad from public, anon, authenticated;

create function operacion.ds_utilidad_fila(u operacion.v_ds_utilidad) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('pedido_id', u.pedido_id, 'folio', u.folio, 'cliente', u.cliente, 'fecha_envio', u.fecha_envio, 'tipo_venta', u.tipo_venta, 'proveedor', u.proveedor,
    'costo_cent', u.costo_cent, 'venta_cent', u.venta_cent, 'utilidad_cent', u.utilidad_cent, 'depositado_proveedor_cent', u.depositado_cent, 'reinvertida_cent', u.reinvertida_cent,
    'fuera_proveedor_cent', u.utilidad_cent - u.reinvertida_cent,
    'socios', (select jsonb_agg(jsonb_build_object('socio', a.socio, 'utilidad_cent', a.monto_cent, 'reinvertida_cent', b.monto_cent) order by a.socio_id)
               from operacion.ds_reparto(u.utilidad_cent) a join operacion.ds_reparto(u.reinvertida_cent) b on b.socio_id = a.socio_id))
$$;

-- Desglose por pedido y totales del periodo (por fecha de envio).
create function api.ds_utilidad(p_desde date default null, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_tot record;
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(sum(u.venta_cent), 0)::bigint venta, coalesce(sum(u.costo_cent), 0)::bigint costo, coalesce(sum(u.utilidad_cent), 0)::bigint util, coalesce(sum(u.reinvertida_cent), 0)::bigint reinv, count(*)::int n
    into v_tot from operacion.v_ds_utilidad u where (p_desde is null or u.fecha_envio >= p_desde) and (p_hasta is null or u.fecha_envio <= p_hasta);
  return jsonb_build_object('desde', p_desde, 'hasta', p_hasta,
    'filas', coalesce((select jsonb_agg(operacion.ds_utilidad_fila(u) order by u.pedido_id desc) from operacion.v_ds_utilidad u where (p_desde is null or u.fecha_envio >= p_desde) and (p_hasta is null or u.fecha_envio <= p_hasta)), '[]'::jsonb),
    'totales', jsonb_build_object('pedidos', v_tot.n, 'venta_cent', v_tot.venta, 'costo_cent', v_tot.costo, 'utilidad_cent', v_tot.util, 'reinvertida_cent', v_tot.reinv, 'fuera_proveedor_cent', v_tot.util - v_tot.reinv,
      'socios', (select jsonb_agg(jsonb_build_object('socio', a.socio, 'utilidad_cent', a.monto_cent, 'reinvertida_cent', b.monto_cent) order by a.socio_id)
                 from operacion.ds_reparto(v_tot.util) a join operacion.ds_reparto(v_tot.reinv) b on b.socio_id = a.socio_id)));
end $$;

-- Reporte mensual por socio: utilidad de dropshipping del mes y acumulada, reinvertida en el proveedor (mes y acumulada), lo que el acta ya registro como reinversion y como retiro,
-- inversion del socio al cierre del mes (capital declarado + utilidades reinvertidas por acta) y su participacion en la valuacion (valuacion menos deudas x participacion).
create function api.ds_reporte_mensual(p_meses int default 12) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_n int := least(greatest(coalesce(p_meses, 12), 1), 36); v_mes date; v_fin date; v_ini date; v_filas jsonb := '[]'::jsonb; v_util bigint; v_reinv bigint; v_acum_util bigint; v_acum_reinv bigint;
        v_socios jsonb; v_val jsonb; v_v03 bigint; i int;
begin
  perform seguridad.exigir_rol(array['socio']);
  for i in reverse (v_n - 1)..0 loop
    v_mes := (date_trunc('month', negocio.hoy()) - make_interval(months => i))::date;
    v_ini := v_mes; v_fin := (v_mes + interval '1 month - 1 day')::date;
    select coalesce(sum(utilidad_cent), 0), coalesce(sum(reinvertida_cent), 0) into v_util, v_reinv from operacion.v_ds_utilidad where fecha_envio between v_ini and v_fin;
    select coalesce(sum(utilidad_cent), 0), coalesce(sum(reinvertida_cent), 0) into v_acum_util, v_acum_reinv from operacion.v_ds_utilidad where fecha_envio <= v_fin;
    begin v_val := contabilidad.valuacion(v_fin); v_v03 := (v_val->>'v03_diferencia_cent')::bigint; exception when others then v_v03 := null; end;
    select jsonb_agg(jsonb_build_object(
        'socio', s.nombre,
        'utilidad_mes_cent', m.monto_cent, 'reinvertida_mes_cent', r.monto_cent, 'utilidad_acum_cent', ma.monto_cent, 'reinvertida_acum_cent', ra.monto_cent,
        'reinvertida_por_acta_mes_cent', coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a where a.socio_id = s.id and a.ref_tipo = 'reinversion' and a.fecha_neg between v_ini and v_fin), 0),
        'retirado_por_acta_mes_cent', coalesce((select -sum(l.monto_cent) from operacion.socio_libro l where l.socio_id = s.id and l.concepto in ('retiro', 'pago_utilidad') and l.fecha_neg between v_ini and v_fin), 0),
        'capital_declarado_cent', coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a where a.socio_id = s.id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion' and a.fecha_neg <= v_fin), 0),
        'reinvertida_por_acta_acum_cent', coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a where a.socio_id = s.id and a.ref_tipo = 'reinversion' and a.fecha_neg <= v_fin), 0),
        'sugerido_acta_cent', r.monto_cent,
        'participacion_ppm', s.participacion_ppm,
        'valuacion_cent', case when v_v03 is null then null else negocio.redondear_medio_arriba(greatest(v_v03, 0) * s.participacion_ppm, 1000000) end) order by s.id)
      into v_socios
    from catalogo.socio s
    join operacion.ds_reparto(v_util) m on m.socio_id = s.id join operacion.ds_reparto(v_reinv) r on r.socio_id = s.id
    join operacion.ds_reparto(v_acum_util) ma on ma.socio_id = s.id join operacion.ds_reparto(v_acum_reinv) ra on ra.socio_id = s.id;
    v_filas := v_filas || jsonb_build_array(jsonb_build_object('mes', to_char(v_mes, 'YYYY-MM'), 'utilidad_cent', v_util, 'reinvertida_cent', v_reinv, 'utilidad_acum_cent', v_acum_util, 'reinvertida_acum_cent', v_acum_reinv,
      'valuacion_neta_cent', v_v03, 'socios', v_socios));
  end loop;
  return jsonb_build_object('meses', v_filas);
end $$;

-- "Explicar este numero" de utilidad: dsu:<utilidad|reinvertida|costo|venta>:<desde|->:<hasta|->. Via 1 = suma por pedido; via 2 = suma de las partes de cada socio (o venta - costo).
create function api.ds_explicar_utilidad(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p text[] := string_to_array(p_cifra, ':'); v_met text; v_d date; v_h date; v1 bigint; v2 bigint; v_rengs jsonb; v_t jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if array_length(p, 1) <> 4 or p[1] <> 'dsu' or p[2] not in ('utilidad', 'reinvertida', 'costo', 'venta') then raise exception 'cifra desconocida' using errcode = '22023'; end if;
  v_met := p[2]; v_d := nullif(p[3], '-')::date; v_h := nullif(p[4], '-')::date;
  v_t := api.ds_utilidad(v_d, v_h);
  v1 := (v_t->'totales'->>case v_met when 'utilidad' then 'utilidad_cent' when 'reinvertida' then 'reinvertida_cent' when 'costo' then 'costo_cent' else 'venta_cent' end)::bigint;
  v2 := case v_met when 'utilidad' then (select coalesce(sum((x->>'utilidad_cent')::bigint), 0) from jsonb_array_elements(v_t->'totales'->'socios') x)
                   when 'reinvertida' then (select coalesce(sum((x->>'reinvertida_cent')::bigint), 0) from jsonb_array_elements(v_t->'totales'->'socios') x)
                   when 'costo' then (v_t->'totales'->>'venta_cent')::bigint - (v_t->'totales'->>'utilidad_cent')::bigint
                   else (v_t->'totales'->>'costo_cent')::bigint + (v_t->'totales'->>'utilidad_cent')::bigint end;
  select coalesce(jsonb_agg(jsonb_build_object('concepto', f->>'folio' || ' · ' || (f->>'cliente'), 'monto_cent', (f->>case v_met when 'utilidad' then 'utilidad_cent' when 'reinvertida' then 'reinvertida_cent' when 'costo' then 'costo_cent' else 'venta_cent' end)::bigint,
                                                'fecha_neg', f->>'fecha_envio')), '[]'::jsonb) into v_rengs from jsonb_array_elements(v_t->'filas') f;
  return jsonb_build_object('cifra', p_cifra, 'titulo', case v_met when 'utilidad' then 'Utilidad de dropshipping' when 'reinvertida' then 'Utilidad reinvertida en el proveedor' when 'costo' then 'Costo de los pedidos' else 'Venta de los pedidos' end,
    'valor', v1, 'unidad', 'mxn',
    'comprobacion', jsonb_build_object('via1', 'Suma por pedido', 'via1_valor', v1,
      'via2', case v_met when 'utilidad' then 'Suma de la parte de cada socio' when 'reinvertida' then 'Suma de la parte reinvertida de cada socio' when 'costo' then 'Venta menos utilidad' else 'Costo mas utilidad' end, 'via2_valor', v2, 'cuadra', v1 = v2),
    'renglones', v_rengs, 'movimientos', '[]'::jsonb);
end $$;

revoke execute on function operacion.ds_reparto(bigint), operacion.ds_utilidad_fila(operacion.v_ds_utilidad) from public, anon, authenticated;
revoke execute on function api.ds_utilidad(date, date), api.ds_reporte_mensual(int), api.ds_explicar_utilidad(text) from public, anon;
-- GRANT a authenticated (cada una exige rol socio dentro):
grant execute on function api.ds_utilidad(date, date), api.ds_reporte_mensual(int), api.ds_explicar_utilidad(text) to authenticated;
