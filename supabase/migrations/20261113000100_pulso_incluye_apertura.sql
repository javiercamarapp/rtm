-- El pulso decia "Por cobrar: Sin dato" con una apertura firmada, aunque la pantalla de Cuentas por cobrar mostraba el saldo inicial.
-- Cambio ADITIVO (solo redefine la lectura): por cobrar suma tambien las cuentas por cobrar de la apertura firmada.
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
    'por_pagar_isaac_cent', case when exists (select 1 from operacion.cuenta_proveedor_mov where proveedor_id = v_isaac) or exists (select 1 from operacion.compra where proveedor_id = v_isaac and estado not in ('borrador', 'anulada'))
                                 then greatest(-operacion.saldo_proveedor(v_isaac), 0) end,
    'por_cobrar_cent', case when v_pedidos > 0 or v_hay_ap then v_cxc + v_cxc_ap end,
    'entre_socios', case when v_socios_hay then jsonb_build_object(
        'socio', case when v_neto_a >= v_neto_j then 'Angelo' else 'Javier' end,
        'diferencia_cent', greatest(v_neto_a, v_neto_j) - least(v_neto_a, v_neto_j)) end,
    'en_bodega', case when v_mov > 0 then jsonb_build_object('piezas', v_pz, 'valor_cent', v_val) end);
end $$;
grant execute on function api.pulso() to authenticated;
