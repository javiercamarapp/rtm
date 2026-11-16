-- Arreglo: la tarea `avisos-inventario` leia seguridad.interruptor directo con el rol `servidor` (sin permiso sobre la tabla) y fallaba cada 5 minutos con
-- "permission denied for table interruptor", lo que disparaba el aviso de tarea fallida al grupo. Se lee por una funcion SECURITY DEFINER propia, solo para el servidor.
-- Aditiva: una funcion de solo lectura.
create function agente.avisos_envio_permitido() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select i.activo from seguridad.interruptor i where i.clave = 'telegram_envio'), false)
     and not coalesce((select i.activo from seguridad.interruptor i where i.clave = 'cron_pausado'), false);
end $$;
revoke all on function agente.avisos_envio_permitido() from public, anon, authenticated;
grant execute on function agente.avisos_envio_permitido() to servidor;
