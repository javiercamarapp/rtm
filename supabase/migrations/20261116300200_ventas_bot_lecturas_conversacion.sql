-- Carril bot/ventas-compras, parte 3: lecturas de solo lectura que la conversacion usa para PREGUNTAR mejor (a que pedido se aplica un cobro, cuanto debe el cliente).
-- Sin telefonos ni destinatarios. Cifras de SQL.
create function agente.pedidos_abiertos_cliente(p_cliente bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('folio', pe.folio, 'saldo_cent', operacion.pedido_saldo(pe.id)) order by coalesce(pe.fecha_envio, pe.fecha_neg), pe.id)
                     from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0), '[]'::jsonb);
end $$;

create function agente.saldo_cliente_agente(p_cliente bigint) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return operacion.saldo_cliente(p_cliente);
end $$;

revoke all on function agente.pedidos_abiertos_cliente(bigint), agente.saldo_cliente_agente(bigint) from public, anon, authenticated;
grant execute on function agente.pedidos_abiertos_cliente(bigint), agente.saldo_cliente_agente(bigint) to servidor;
