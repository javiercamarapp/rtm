-- Lane telegram-ampliacion (correcciones de la verificacion independiente). ADITIVA: create or replace de agente.recordatorio_reclamar (misma firma y privilegios).
-- * MEDIO-BAJO-1: la ventana unica de ds_recordatorio_log es (pedido, hora) SIN tipo. Si por_vencer y vence_hoy caen en la misma hora de reloj, ds_registrar devolvia la fila
--   existente y el reclamo decia true: el aviso salia dos veces. Ahora, si ya hay una fila de ese pedido en esa ventana, reclamado = false (el segundo aviso, que sigue pendiente,
--   se reclama en la hora siguiente).
-- * BAJO-5: defensa en profundidad: con el interruptor telegram_envio apagado el reclamo devuelve false y no registra nada (ademas del control de TypeScript).
create or replace function agente.recordatorio_reclamar(p_pedido bigint, p_tipo text, p_ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  if not coalesce((select i.activo from seguridad.interruptor i where i.clave = 'telegram_envio'), false) then
    return jsonb_build_object('reclamado', false, 'motivo', 'interruptor_apagado');
  end if;
  perform set_config('rtm.canal', 'telegram', true);
  perform pg_advisory_xact_lock(hashtextextended('agente.recordatorio:' || p_pedido::text, 0));
  if not exists (select 1 from jsonb_array_elements(operacion.ds_recordatorios_pago_menudeo(p_ahora) -> 'recordatorios') x
                  where (x ->> 'pedido_id')::bigint = p_pedido and x ->> 'tipo' = p_tipo) then
    return jsonb_build_object('reclamado', false);
  end if;
  if exists (select 1 from operacion.ds_recordatorio_log g where g.pedido_id = p_pedido and g.ventana = date_trunc('hour', p_ahora)) then
    return jsonb_build_object('reclamado', false, 'motivo', 'ya_hay_un_aviso_en_esta_hora');
  end if;
  v_res := operacion.ds_registrar_recordatorio_menudeo('rec:' || p_pedido::text || ':' || p_tipo || ':' || to_char(date_trunc('hour', p_ahora) at time zone 'UTC', 'YYYYMMDDHH24'), p_pedido, p_tipo, p_ahora, 'telegram');
  return jsonb_build_object('reclamado', true, 'enviados', v_res -> 'enviados');
end $$;

revoke all on function agente.recordatorio_reclamar(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function agente.recordatorio_reclamar(bigint, text, timestamptz) to servidor;
