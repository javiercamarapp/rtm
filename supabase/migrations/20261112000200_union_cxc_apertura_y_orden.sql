-- Union: api.cuentas_por_cobrar lo redefinieron DOS migraciones independientes, y el resultado dependia del orden de aplicacion:
--  * 20261110002300_f3c_apertura (main): agrega 'apertura' (partidas de apertura) y las suma a totales, antiguedad y concentracion por cliente;
--  * 20261111007000_cxc_orden_estable (produccion): desempata por pedido_id para que dos lecturas seguidas vean el mismo orden.
-- En produccion (7000 ya aplicada, 2300 llega despues) se perderia el desempate; en una base nueva (orden de archivo) se perderia 'apertura'.
-- Esta definicion final conserva las dos cosas y es la que queda en ambos ordenes. Las migraciones anteriores no se editan.
create or replace function api.cuentas_por_cobrar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_ap jsonb; v_base jsonb; v_hoy date := negocio.hoy(); v_bp int := coalesce((catalogo.config_valor('recargo_credito_bp'))::text::int, 1000);
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(jsonb_agg(x order by (x->>'dias')::int desc, (x->>'pedido_id')::bigint), '[]'::jsonb) into v_filas from (
    select jsonb_build_object(
      'pedido_id', pe.id, 'folio', pe.folio, 'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'fecha_envio', pe.fecha_envio, 'plazo_dias', pe.plazo_dias,
      'vence', case when pe.plazo_dias is null then null else pe.fecha_envio + pe.plazo_dias end, 'original_cent', operacion.pedido_cobrado(pe.id), 'abonos_cent', operacion.pedido_aplicado(pe.id),
      'saldo_cent', operacion.pedido_saldo(pe.id), 'dias', v_hoy - pe.fecha_envio,
      'dias_atraso', case when pe.plazo_dias is null then null else greatest(v_hoy - (pe.fecha_envio + pe.plazo_dias), 0) end,
      'estado', case when operacion.pedido_saldo(pe.id) < 0 then 'saldo_a_favor' when pe.plazo_dias is null then 'sin_plazo' when v_hoy > pe.fecha_envio + pe.plazo_dias then 'vencido'
                     when v_hoy >= pe.fecha_envio + pe.plazo_dias - 2 then 'por_vencer' else 'al_corriente' end,
      'cubeta', case when v_hoy - pe.fecha_envio <= 7 then '0_7' when v_hoy - pe.fecha_envio <= 14 then '8_14' when v_hoy - pe.fecha_envio <= 30 then '15_30' else 'mas_30' end,
      'recargo_cent', coalesce((select (n.snapshot_cliente->>'recargo_cent')::bigint from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0),
      'recargo_sugerido_cent', coalesce((select ((n.snapshot_cliente->>'subtotal_cent')::bigint * v_bp + 9999) / 10000 from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0)) as x
    from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id
    where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) <> 0) q;
  -- Cuentas por cobrar de la apertura: una fila por partida con su fecha; entran a los totales, la antiguedad y la concentracion por cliente.
  select coalesce(jsonb_agg(jsonb_build_object('partida_id', a.partida_id, 'cliente_id', a.cliente_id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'fecha_ref', a.fecha_ref, 'original_cent', a.original_cent,
           'abonos_cent', a.abonos_cent, 'saldo_cent', a.saldo_cent, 'dias', v_hoy - a.fecha_ref) order by a.fecha_ref, a.partida_id), '[]'::jsonb) into v_ap
    from operacion.cxc_apertura() a join catalogo.cliente c on c.id = a.cliente_id join catalogo.socio s on s.id = c.duenio_id where a.saldo_cent <> 0;
  v_base := v_filas || coalesce((select jsonb_agg(jsonb_build_object('pedido_id', null, 'cliente_id', x->'cliente_id', 'cliente', x->'cliente', 'duenio', x->'duenio', 'saldo_cent', x->'saldo_cent',
                                    'estado', 'sin_plazo', 'dias', x->'dias', 'vence', null,
                                    'cubeta', case when (x->>'dias')::int <= 7 then '0_7' when (x->>'dias')::int <= 14 then '8_14' when (x->>'dias')::int <= 30 then '15_30' else 'mas_30' end)) from jsonb_array_elements(v_ap) x), '[]'::jsonb);
  return jsonb_build_object(
    'hoy', v_hoy, 'filas', v_filas, 'apertura', v_ap, 'recargo_bp', v_bp,
    'total_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) from jsonb_array_elements(v_base) f),
    'vencido_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) from jsonb_array_elements(v_base) f),
    'antiguedad_cent', (select jsonb_object_agg(k, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_base) f where f->>'cubeta' = k and (f->>'saldo_cent')::bigint > 0), 0)) from unnest(array['0_7', '8_14', '15_30', 'mas_30']) k),
    'por_duenio_cent', (select coalesce(jsonb_object_agg(d, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_base) f where f->>'duenio' = d and (f->>'saldo_cent')::bigint > 0), 0)), '{}'::jsonb) from unnest(array['Angelo', 'Javier']) d),
    'por_cliente', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', k.cid, 'cliente', k.cliente, 'duenio', k.duenio, 'saldo_cent', k.saldo, 'vencido_cent', k.vencido, 'pedidos', k.n, 'dias_max', k.dias_max,
                  'proximo_vence', k.vence) order by k.saldo desc, k.cliente)
      from (select (f->>'cliente_id')::bigint as cid, f->>'cliente' as cliente, f->>'duenio' as duenio,
                   sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0) as saldo,
                   coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) as vencido,
                   count(*) filter (where (f->>'saldo_cent')::bigint > 0)::int as n, max((f->>'dias')::int) as dias_max,
                   min((f->>'vence')::date) filter (where (f->>'saldo_cent')::bigint > 0) as vence
            from jsonb_array_elements(v_base) f group by 1, 2, 3 having coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) > 0) k), '[]'::jsonb),
    'saldos_a_favor', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'monto_cent', operacion.saldo_favor_cliente(c.id)) order by c.nombre_canonico)
      from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where operacion.saldo_favor_cliente(c.id) > 0), '[]'::jsonb),
    'pagos_sin_identificar', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha_neg', p.fecha_neg, 'monto_cent', p.monto_cent, 'cuenta', cd.nombre) order by p.id)
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id
      where p.identificacion = 'sin_identificar' and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id) and not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)), '[]'::jsonb),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'deuda_cent', operacion.saldo_socio(s.id), 'fondos_cent', operacion.saldo_socio(s.id, 'fondos'), 'diferencia_cent', operacion.saldo_socio(s.id, 'diferencia'),
        'dias_fondos', operacion.dias_fondos_en_poder(s.id),
        'alerta_fondos', coalesce(operacion.dias_fondos_en_poder(s.id) > (catalogo.config_valor('fondos_alerta_dias'))::text::int, false)) order by s.nombre) from catalogo.socio s), '[]'::jsonb));
end $$;
