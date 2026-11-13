-- Dropshipping / 0400: pedidos a costo de un socio para su menudeo ("Pedidos menudeo"): lista por socio con renglones, pagado y pendiente de pago, pago del pedido y "Explicar este numero".
-- ADITIVA. Reglas del dueno (13-nov):
--  * Un pedido a costo NO resta a la valuacion ni a la aportacion neta del socio, este pagado o pendiente (el libro lo registra como venta a costo contra cuenta por cobrar y cuenta por pagar al
--    proveedor: valuacion menos deudas no cambia). SOLO resta lo que se cobra en SU cuenta (fondos de la sociedad en su poder).
--  * "Pagado" = lo aplicado al pedido (pagos del socio como cliente: directo a la cuenta del proveedor o abono a la sociedad). "Pendiente de pago" = costo menos lo pagado. Cuentan como pendientes
--    los pedidos confirmados y enviados; un borrador aun no compromete nada y se muestra sin monto pendiente.
--  * Lenguaje: "pendiente de pago", nunca "deuda".

create function operacion.ds_menudeo_filas(p_socio text, p_desde date, p_hasta date, p_proveedor text, p_estado text) returns table (
  pedido_id bigint, folio text, fecha_neg date, fecha_envio date, estado text, proveedor text, cliente_id bigint, cliente text, piezas int, costo_cent bigint, pagado_cent bigint, pendiente_cent bigint, estado_pago text)
language sql stable security definer set search_path = ''
as $$
  select v.pedido_id, v.folio, v.fecha_neg, v.fecha_envio, v.estado, v.proveedor, v.cliente_id, v.cliente,
         (case when v.estado = 'enviado' then v.piezas_surtidas else v.piezas_pedidas end)::int,
         v.venta_cent,
         operacion.pedido_aplicado(v.pedido_id),
         case when v.estado in ('confirmado', 'enviado') then greatest(v.venta_cent - operacion.pedido_aplicado(v.pedido_id), 0) else 0 end::bigint,
         case when v.estado = 'borrador' then 'por_confirmar' when v.estado = 'confirmado' then 'no_pagado'
              when v.venta_cent - operacion.pedido_aplicado(v.pedido_id) <= 0 then 'pagado' else 'no_pagado' end
  from operacion.v_ds_pedido v join catalogo.socio s on s.id = v.socio_venta_id
  where v.tipo_venta = 'socio_a_costo' and s.nombre = p_socio and v.estado in ('borrador', 'confirmado', 'enviado')
    and (p_desde is null or v.fecha_neg >= p_desde) and (p_hasta is null or v.fecha_neg <= p_hasta) and (p_proveedor is null or v.proveedor = p_proveedor)
$$;

create function operacion.ds_menudeo_renglones(p_pedido bigint, p_enviado boolean) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', q.pz, 'costo_unit_cent', l.precio_cent, 'costo_cent', q.pz * l.precio_cent)
                            order by ma.nombre, m.nombre_canonico, sa.nombre_canonico), '[]'::jsonb)
  from operacion.pedido_linea l
  cross join lateral (select (case when p_enviado then l.piezas_surtidas else l.piezas_pedidas end)::bigint as pz) q
  join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
  where l.pedido_id = p_pedido and q.pz > 0
$$;

create function api.ds_menudeo(p_socio text, p_desde date default null, p_hasta date default null, p_proveedor text default null, p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_t jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if not exists (select 1 from catalogo.socio where nombre = p_socio) then raise exception 'socio desconocido' using errcode = '22023'; end if;
  if p_estado is not null and p_estado not in ('pagado', 'no_pagado', 'por_confirmar') then raise exception 'estado de pago invalido' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', f.pedido_id, 'folio', f.folio, 'fecha_neg', f.fecha_neg, 'fecha_envio', f.fecha_envio, 'estado', f.estado, 'proveedor', f.proveedor,
           'cliente_id', f.cliente_id, 'cliente', f.cliente, 'piezas', f.piezas, 'costo_cent', f.costo_cent, 'pagado_cent', f.pagado_cent, 'pendiente_cent', f.pendiente_cent, 'estado_pago', f.estado_pago,
           'renglones', operacion.ds_menudeo_renglones(f.pedido_id, f.estado = 'enviado')) order by f.fecha_neg desc, f.pedido_id desc), '[]'::jsonb),
         jsonb_build_object('pedidos', count(*), 'piezas', coalesce(sum(f.piezas), 0), 'costo_cent', coalesce(sum(f.costo_cent), 0), 'pagado_cent', coalesce(sum(f.pagado_cent), 0),
                            'pendiente_cent', coalesce(sum(f.pendiente_cent), 0), 'pedidos_pendientes', count(*) filter (where f.pendiente_cent > 0))
    into v_filas, v_t
    from operacion.ds_menudeo_filas(p_socio, p_desde, p_hasta, p_proveedor, p_estado) f where p_estado is null or f.estado_pago = p_estado;
  return jsonb_build_object('socio', p_socio, 'totales', v_t, 'filas', v_filas);
end $$;

-- Resumen para el Inicio: monto pendiente de pago de los pedidos a costo de cada socio y cuantos son.
create function api.ds_menudeo_pendientes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'pedidos', q.n, 'pendiente_cent', q.p) order by s.id)
                   from catalogo.socio s cross join lateral (select count(*) filter (where x.pendiente_cent > 0) as n, coalesce(sum(x.pendiente_cent), 0)::bigint as p from operacion.ds_menudeo_filas(s.nombre, null, null, null, null) x) q), '[]'::jsonb);
end $$;

-- Pago de un pedido a costo (el socio paga como cliente): 'proveedor' = directo a la cuenta del proveedor con su dinero; 'sociedad' = abono a la sociedad (efectivo de la empresa).
-- No toca su aportacion: no crea reembolso ni capital. Se aplica a ESE pedido y lo quita de pendientes cuando cubre el costo.
create function operacion.ds_pagar_pedido_menudeo(p_clave_idem text, p_pedido bigint, p_via text, p_monto_cent bigint default null, p_fecha date default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; r record; v_monto bigint; v_res jsonb; v_pago jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_pagar_pedido_menudeo', 'p', p_pedido, 'v', p_via, 'm', p_monto_cent, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_via not in ('proveedor', 'sociedad') then raise exception 'via de pago invalida' using errcode = '22023'; end if;
  select x.pedido_id, x.estado, x.tipo_venta, x.cliente_id, x.proveedor, x.venta_cent into r from operacion.v_ds_pedido x where x.pedido_id = p_pedido;
  if not found or r.tipo_venta is distinct from 'socio_a_costo' then raise exception 'no es un pedido a costo para un socio' using errcode = '22023'; end if;
  if r.estado <> 'enviado' then raise exception 'el pedido aun no esta enviado: no hay nada que pagar todavia' using errcode = 'P0428'; end if;
  v_monto := coalesce(p_monto_cent, greatest(operacion.pedido_saldo(p_pedido), 0));
  if v_monto <= 0 then raise exception 'el pedido ya esta pagado' using errcode = 'P0428'; end if;
  if v_monto > operacion.pedido_saldo(p_pedido) then raise exception 'el monto excede lo pendiente de pago del pedido' using errcode = '23514'; end if;
  if p_via = 'proveedor' then
    v_pago := operacion.ds_pagar_proveedor(p_clave_idem || ':pp', r.proveedor, v_monto, 'cliente_a_proveedor', null, r.cliente_id, p_pedido, p_fecha, p_nota);
  else
    v_pago := operacion.registrar_pago(p_clave_idem || ':ps', 'Efectivo', v_monto, r.cliente_id, jsonb_build_array(jsonb_build_object('pedido_id', p_pedido, 'monto_cent', v_monto)), true, 'abono', p_fecha, null, p_nota);
  end if;
  v_res := jsonb_build_object('pedido_id', p_pedido, 'pagado_cent', v_monto, 'via', p_via, 'pendiente_cent', greatest(operacion.pedido_saldo(p_pedido), 0));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- "Explicar este numero": dsm:<socio>:<pendiente|pagado|costo|piezas>:<desde|->:<hasta|->. Via 1 = suma por pedido; via 2 = suma por renglon (costo y piezas) o costo menos pagado (pendiente y pagado).
create function api.ds_explicar_menudeo(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p text[] := string_to_array(p_cifra, ':'); v_d date; v_h date; v1 bigint; v2 bigint; v_rengs jsonb; v_tit text; v_unidad text := 'mxn';
begin
  perform seguridad.exigir_rol(array['socio']);
  if array_length(p, 1) <> 5 or p[1] <> 'dsm' or p[3] not in ('pendiente', 'pagado', 'costo', 'piezas') or p[2] not in (select nombre from catalogo.socio) then raise exception 'cifra desconocida' using errcode = '22023'; end if;
  v_d := nullif(p[4], '-')::date; v_h := nullif(p[5], '-')::date;
  select coalesce(sum(case p[3] when 'pendiente' then x.pendiente_cent when 'pagado' then x.pagado_cent when 'costo' then x.costo_cent else x.piezas end), 0)::bigint into v1 from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x;
  select coalesce(sum(case p[3] when 'costo' then (case when x.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end) * l.precio_cent when 'piezas' then (case when x.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end)
                              else 0 end), 0)::bigint into v2
    from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x join operacion.pedido_linea l on l.pedido_id = x.pedido_id;
  if p[3] in ('pendiente', 'pagado') then
    select coalesce(sum(case p[3] when 'pendiente' then (case when x.estado in ('confirmado', 'enviado') then greatest(x.costo_cent - coalesce((select sum(pa.monto_cent) from operacion.pago_aplicacion pa where pa.pedido_id = x.pedido_id), 0), 0) else 0 end)
                                 else coalesce((select sum(pa.monto_cent) from operacion.pago_aplicacion pa where pa.pedido_id = x.pedido_id), 0) end), 0)::bigint into v2
      from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x;
  end if;
  if p[3] = 'piezas' then v_unidad := 'pz'; end if;
  v_tit := case p[3] when 'pendiente' then 'Pendiente de pago de pedidos a costo' when 'pagado' then 'Pagado de pedidos a costo' when 'costo' then 'Costo de pedidos a costo' else 'Piezas de pedidos a costo' end || ' (' || p[2] || ')';
  select coalesce(jsonb_agg(jsonb_build_object('concepto', x.folio || ' · ' || coalesce(x.proveedor, ''), 'fecha_neg', x.fecha_neg,
      'monto_cent', case p[3] when 'pendiente' then x.pendiente_cent when 'pagado' then x.pagado_cent else x.costo_cent end) order by x.pedido_id desc), '[]'::jsonb) into v_rengs
    from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x;
  if p[3] = 'piezas' then v_rengs := '[]'::jsonb; end if;
  return jsonb_build_object('cifra', p_cifra, 'titulo', v_tit, 'valor', v1, 'unidad', v_unidad,
    'comprobacion', jsonb_build_object('via1', 'Suma por pedido', 'via1_valor', v1, 'via2', case when p[3] in ('pendiente', 'pagado') then 'Costo menos pagos aplicados, por pedido' else 'Suma por renglon' end, 'via2_valor', v2, 'cuadra', v1 = v2),
    'renglones', v_rengs, 'movimientos', '[]'::jsonb);
end $$;

-- Escritura: envoltorio api.* (rol socio)
create function api.ds_pagar_pedido_menudeo(p_clave_idem text, p_pedido bigint, p_via text, p_monto_cent bigint default null, p_fecha date default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_pagar_pedido_menudeo(p_clave_idem => p_clave_idem, p_pedido => p_pedido, p_via => p_via, p_monto_cent => p_monto_cent, p_fecha => p_fecha, p_nota => p_nota); end $$;

revoke execute on function operacion.ds_menudeo_filas(text, date, date, text, text), operacion.ds_menudeo_renglones(bigint, boolean), operacion.ds_pagar_pedido_menudeo(text, bigint, text, bigint, date, text) from public, anon, authenticated;
revoke execute on function api.ds_menudeo(text, date, date, text, text), api.ds_menudeo_pendientes(), api.ds_explicar_menudeo(text), api.ds_pagar_pedido_menudeo(text, bigint, text, bigint, date, text) from public, anon;
-- GRANT a authenticated (cada una exige rol socio dentro):
grant execute on function api.ds_menudeo(text, date, date, text, text), api.ds_menudeo_pendientes(), api.ds_explicar_menudeo(text), api.ds_pagar_pedido_menudeo(text, bigint, text, bigint, date, text) to authenticated;
