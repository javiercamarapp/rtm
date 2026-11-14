-- Correccion de la campana E2E maestra (13-nov), MEDIO-3: api.registrar_pago aceptaba un cobro 100 veces mayor que el saldo (9,999,999.00 contra un pedido de 1,250.00): lo aplicado
-- era el saldo y el resto quedaba como saldo a favor y como efectivo de caja de ~10 millones, sin tope ni confirmacion (afectaba caja, cobertura y acta).
-- Ahora, con el MISMO patron que el pago de renta (api.registrar_pago_renta / operacion.validar_pago_renta):
--   * api.registrar_pago gana al final p_confirmo_exceso boolean default false. Un cobro de un cliente identificado, de tipo abono, que se aplica a pedidos y que es mayor que lo que
--     esos pedidos deben se RECHAZA (P0429, codigo propio para que la pantalla pida la confirmacion) salvo p_confirmo_exceso = true (el resto queda a favor del cliente, como cualquier anticipo).
--   * Un cobro marcado 'anticipo' o con p_aplicar = false ya es un anticipo explicito: no pide confirmacion. Un cobro sin cliente (sin identificar) no se aplica a nada: no hay saldo contra
--     el cual medirlo y no pide confirmacion.
--   * Tope absoluto de 10,000,000.00 MXN por cobro (1,000,000,000 centavos), igual que el pago de renta; ni confirmando se pasa.
--   * Una repeticion con la misma clave de idempotencia devuelve el resultado ya guardado sin volver a medir (el saldo ya cambio).
-- La funcion interna operacion.registrar_pago NO cambia: la usan el cargador (via api con montos que caben en el saldo), el agente de Telegram y las pruebas previas.
-- GRANT: solo EXECUTE a authenticated en la nueva firma (valida el rol socio dentro); se retira la firma anterior. Nada a anon ni PUBLIC.

drop function api.registrar_pago(text, text, bigint, bigint, jsonb, boolean, text, date, text, text, text, bigint);

create function api.registrar_pago(p_clave_idem text, p_cuenta text, p_monto_cent bigint, p_cliente_id bigint default null, p_pedidos jsonb default null, p_aplicar boolean default true,
                                   p_tipo text default 'abono', p_fecha date default null, p_comprobante_sha256 text default null, p_nota text default null, p_mensaje_origen text default null,
                                   p_pedido_destino bigint default null, p_confirmo_exceso boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c_tope constant bigint := 1000000000; v_aplicable bigint := 0; x record; v_saldo bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_monto_cent is not null and p_monto_cent > c_tope then raise exception 'un cobro no puede pasar de 10,000,000.00 MXN' using errcode = '23514'; end if;
  if p_monto_cent is not null and p_monto_cent > 0 and p_cliente_id is not null and p_aplicar and coalesce(p_tipo, 'abono') <> 'anticipo' and not coalesce(p_confirmo_exceso, false)
     and not exists (select 1 from seguridad.operacion o where o.clave = p_clave_idem and o.resultado is not null) then
    if p_pedidos is not null and jsonb_typeof(p_pedidos) = 'array' then
      for x in select (e ->> 'pedido_id')::bigint as pedido_id, (e ->> 'monto_cent')::bigint as monto from jsonb_array_elements(p_pedidos) e loop
        v_saldo := operacion.pedido_saldo(x.pedido_id);
        v_aplicable := v_aplicable + greatest(least(coalesce(x.monto, 0), coalesce(v_saldo, 0)), 0);
      end loop;
    else
      select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0)::bigint into v_aplicable from operacion.pedido pe where pe.cliente_id = p_cliente_id and pe.estado = 'enviado';
    end if;
    if p_monto_cent > v_aplicable then
      raise exception 'el cobro (% MXN) es mayor que lo que debe el cliente (% MXN). Confirma que el resto es un anticipo a su favor para registrarlo.',
        to_char(p_monto_cent / 100.0, 'FM999,999,999,990.00'), to_char(v_aplicable / 100.0, 'FM999,999,999,990.00') using errcode = 'P0429';
    end if;
  end if;
  return operacion.registrar_pago(p_clave_idem => p_clave_idem, p_cuenta => p_cuenta, p_monto_cent => p_monto_cent, p_cliente_id => p_cliente_id, p_pedidos => p_pedidos, p_aplicar => p_aplicar,
    p_tipo => p_tipo, p_fecha => p_fecha, p_comprobante_sha256 => p_comprobante_sha256, p_nota => p_nota, p_mensaje_origen => p_mensaje_origen, p_pedido_destino => p_pedido_destino);
end $$;
revoke execute on function api.registrar_pago(text, text, bigint, bigint, jsonb, boolean, text, date, text, text, text, bigint, boolean) from public, anon;
grant execute on function api.registrar_pago(text, text, bigint, bigint, jsonb, boolean, text, date, text, text, text, bigint, boolean) to authenticated;
