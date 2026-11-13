-- Por pagar a Isaac (Inicio y barra superior): POSICION COMPLETA con el proveedor, la del Mayor (cuenta 2110 'Proveedor Isaac'), la misma cifra de Proveedores ('Falta por saldar') y de Capital por socio.
-- Antes mostraba solo el saldo de la cuenta corriente (pagos y ordenes), que no descuenta el costo de los pedidos directos enviados: con pedidos directos la cifra quedaba muy por debajo de lo que de verdad se debe.
-- Cambio ADITIVO (solo redefine lecturas, conserva firmas y permisos): api.proveedor_cuenta agrega la clave posicion_cent (positivo = a favor de la sociedad, negativo = se debe) y api.pulso toma la deuda del Mayor.

create or replace function api.proveedor_cuenta(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov catalogo.proveedor; v_saldo bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into v_prov from catalogo.proveedor where id = catalogo.proveedor_id(p_proveedor);
  if not found then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_saldo := operacion.saldo_proveedor(v_prov.id);
  return jsonb_build_object('id', v_prov.id, 'proveedor', v_prov.nombre, 'modalidad', v_prov.modalidad, 'saldo_cent', v_saldo,
    'etiqueta', case when v_saldo > 0 then 'A favor' when v_saldo < 0 then 'Se debe' else 'Saldo cero' end,
    'movimientos', coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
        select jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'monto_cent', m.monto_cent, 'saldo_corrido_cent', sum(m.monto_cent) over (order by m.id),
          'compra', (select folio from operacion.compra where id = m.compra_id), 'pago', (select folio from operacion.pago where id = m.pago_id), 'cliente', (select nombre_canonico from catalogo.cliente where id = m.cliente_id),
          'cuenta_origen', (select nombre from operacion.cuenta_dinero where id = m.cuenta_origen_id), 'nota', m.nota) || operacion.evento_info(m.evento_id) as x
        from (select c.id, c.fecha_neg, c.concepto, c.monto_cent, c.compra_id, c.pago_id, c.cliente_id, c.cuenta_origen_id, c.nota, c.evento_id from operacion.cuenta_proveedor_mov c where c.proveedor_id = v_prov.id
              union all
              select 0::bigint, se.fecha_corte, 'apertura', (-contabilidad.apertura_saldo(contabilidad.cta_proveedor(v_prov.id)))::bigint, null::bigint, null::bigint, null::bigint, null::bigint, 'Saldo de apertura', se.evento_id
                from apertura.sesion se where se.estado = 'firmada' and se.evento_id is not null and contabilidad.apertura_saldo(contabilidad.cta_proveedor(v_prov.id)) <> 0) m) q), '[]'::jsonb),
    'puente_cent', operacion.saldo_puente(),
    'posicion_cent', (-contabilidad.saldo(contabilidad.cta_proveedor(v_prov.id)))::bigint);
end $$;

create or replace function api.pulso() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_isaac bigint := catalogo.proveedor_id('Isaac'); v_cxc bigint; v_cxc_ap bigint; v_hay_ap boolean; v_pedidos int; v_neto_a bigint; v_neto_j bigint; v_ia bigint; v_ij bigint; v_val bigint; v_pz bigint; v_mov int; v_socios_hay boolean;
begin
  perform seguridad.exigir_rol(array['socio']);
  select count(*) into v_pedidos from operacion.pedido where estado = 'enviado';
  select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0) into v_cxc from operacion.pedido pe where pe.estado = 'enviado';
  select coalesce(sum(greatest(a.saldo_cent, 0)), 0), count(*) > 0 into v_cxc_ap, v_hay_ap from operacion.cxc_apertura() a;
  select id into v_ia from catalogo.socio where nombre = 'Angelo';
  select id into v_ij from catalogo.socio where nombre = 'Javier';
  v_neto_a := operacion.neto_socio(v_ia); v_neto_j := operacion.neto_socio(v_ij);
  v_socios_hay := exists (select 1 from operacion.aportacion_socio) or exists (select 1 from operacion.cuenta_socio_mov) or exists (select 1 from operacion.compra where estado not in ('borrador', 'anulada'));
  select coalesce(sum(piezas), 0), coalesce(sum(valor_cent), 0), count(*) into v_pz, v_val, v_mov from operacion.existencia_modelo;
  return jsonb_build_object(
    'por_pagar_isaac_cent', case when exists (select 1 from operacion.cuenta_proveedor_mov where proveedor_id = v_isaac) or exists (select 1 from operacion.compra where proveedor_id = v_isaac and estado not in ('borrador', 'anulada')) or contabilidad.saldo(contabilidad.cta_proveedor(v_isaac)) <> 0
                                 then greatest(contabilidad.saldo(contabilidad.cta_proveedor(v_isaac)), 0) end,
    'por_cobrar_cent', case when v_pedidos > 0 or v_hay_ap then v_cxc + v_cxc_ap end,
    'entre_socios', case when v_socios_hay then jsonb_build_object(
        'socio', case when v_neto_a >= v_neto_j then 'Angelo' else 'Javier' end,
        'diferencia_cent', greatest(v_neto_a, v_neto_j) - least(v_neto_a, v_neto_j)) end,
    'en_bodega', case when v_mov > 0 then jsonb_build_object('piezas', v_pz, 'valor_cent', v_val) end);
end $$;
