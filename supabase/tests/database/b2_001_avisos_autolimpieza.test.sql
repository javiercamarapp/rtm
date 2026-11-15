-- pgTAP: autolimpieza de avisos. Un aviso solo sigue abierto mientras su causa exista; lo demas se resuelve solo, con motivo y sin borrar nada.
-- Los esperados salen del pedido del dueño (14-nov), no del codigo. Datos ficticios.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('av.auto.a@example.test', 'socio', 'Angelo', true), ('av.auto.b@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('75555555-5555-5555-5555-555555555551', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'av.auto.a@example.test'),
  ('75555555-5555-5555-5555-555555555552', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'av.auto.b@example.test');
select set_config('request.jwt.claim.sub', '75555555-5555-5555-5555-555555555551', true);
create function pg_temp.est(p_clave text) returns text language sql as $$ select estado from operacion.aviso where clave_dedupe = $1 $$;

-- Una causa que ya no existe: la entidad no esta (o ya no esta en ese estado) -> resuelto solo, con motivo y referencia.
select operacion.avisar('paquete_por_empacar', null, 'au:pe', 'I', 'Paquete por empacar: P-9999', 'pedido', 999999, '{}'::jsonb);
select operacion.avisar('llegada_pendiente_confirmar', null, 'au:ll', 'I', 'Llego a Merida C-9999', 'compra', 999999, '{}'::jsonb);
select operacion.avisar('paquete_enviado_con_guia', null, 'au:inf', 'F', 'Paquete enviado: P-9998', 'pedido', 999998, '{}'::jsonb);
select operacion.avisar('pago_posible_duplicado', null, 'au:dup', 'C', 'Posible pago duplicado', 'pago', null, '{"folio_existente": "PG-0001"}'::jsonb);

select is((select clase from notificacion.condicion((select a from operacion.aviso a where clave_dedupe = 'au:pe'))), 'condicion', 'paquete por empacar tiene regla');
select is((select vigente from notificacion.condicion((select a from operacion.aviso a where clave_dedupe = 'au:pe'))), false, 'sin pedido confirmado y sin empacar la causa no existe');
select is((select clase from notificacion.condicion((select a from operacion.aviso a where clave_dedupe = 'au:inf'))), 'informativo', 'paquete enviado es un hecho sin causa persistente');
select is((select clase from notificacion.condicion((select a from operacion.aviso a where clave_dedupe = 'au:dup'))), 'externo', 'un aviso con boton y sin entidad no lo toca el barrido');

-- Verificar no escribe.
select is(((notificacion.depurar(false)) ->> 'resueltos')::int, 2, 'verificar cuenta los dos avisos cuya causa ya no existe');
select is(pg_temp.est('au:pe'), 'abierta', 'verificar es solo lectura');

-- La bandeja ya no los cuenta aunque el barrido no haya corrido (la condicion se evalua en vivo).
select is((select (api.mis_notificaciones('todas', 0) -> 'notificaciones') @> '[{"codigo": "paquete_por_empacar"}]'::jsonb), false, 'la bandeja activa no muestra un aviso sin causa');
select is((select (api.mis_notificaciones('todas', 0) -> 'notificaciones') @> '[{"codigo": "pago_posible_duplicado"}]'::jsonb), true, 'lo que sigue vigente si se muestra');

-- Aplicar: resuelve solo, con motivo, referencia, fecha y canal sistema; no borra.
select is(((notificacion.depurar(true)) ->> 'resueltos')::int, 2, 'aplicar resuelve esos dos');
select is(pg_temp.est('au:pe'), 'resuelta', 'queda resuelto, no borrado');
select matches((select resuelto_motivo from operacion.aviso where clave_dedupe = 'au:pe'), '^resuelto solo: la causa desaparecio', 'con el motivo pedido');
select is((select resuelto_ref from operacion.aviso where clave_dedupe = 'au:pe'), 'pedido:999999', 'y la referencia a lo que lo resolvio');
select is((select resuelta_canal from operacion.aviso where clave_dedupe = 'au:pe'), 'sistema', 'canal sistema');
select isnt((select resuelto_at from operacion.aviso where clave_dedupe = 'au:pe'), null, 'con fecha');
select is(((notificacion.depurar(true)) ->> 'resueltos')::int, 0, 'idempotente: la segunda pasada no cambia nada');
select is((api.mis_notificaciones('resueltos', 0) -> 'notificaciones') @> '[{"codigo": "paquete_por_empacar"}]'::jsonb, true, 'Resueltos recientes los muestra');
select is(((api.mis_notificaciones('todas', 0) -> 'resumen') ->> 'resueltos_recientes')::int >= 2, true, 'el resumen cuenta los resueltos recientes');

-- Si la causa reaparece (misma huella), el aviso se reabre sin duplicar.
select operacion.avisar('paquete_por_empacar', null, 'au:pe', 'I', 'Paquete por empacar: P-9999', 'pedido', 999999, '{}'::jsonb);
select is(pg_temp.est('au:pe'), 'abierta', 'al reaparecer se reabre');
select is((select count(*)::int from operacion.aviso where clave_dedupe = 'au:pe'), 1, 'sin duplicar');
select is((select reabierto_n from operacion.aviso where clave_dedupe = 'au:pe'), 1, 'queda contado el reabrir');
select is((select resuelto_motivo from operacion.aviso where clave_dedupe = 'au:pe'), null, 'y sin motivo de resuelto');

-- Lo resuelto por una persona nunca se reabre solo.
update operacion.aviso set estado = 'descartada', resuelto_at = now() where clave_dedupe = 'au:ll';
select operacion.avisar('llegada_pendiente_confirmar', null, 'au:ll', 'I', 'Llego a Merida C-9999', 'compra', 999999, '{}'::jsonb);
select is(pg_temp.est('au:ll'), 'descartada', 'un descartado a mano se respeta');

-- Informativos sin causa: se retiran al leerse por todos los destinatarios o a los N dias (por omision 7).
select is(pg_temp.est('au:inf'), 'abierta', 'recien emitido y sin leer sigue');
update operacion.aviso set creado_at = now() - interval '8 days' where clave_dedupe = 'au:inf';
select is(((notificacion.depurar(true)) ->> 'retirados')::int, 1, 'a los 8 dias se retira');
select matches((select resuelto_motivo from operacion.aviso where clave_dedupe = 'au:inf'), '^retirado:', 'con motivo');
select operacion.avisar('guia_registrada_trayecto', null, 'au:inf2', 'F', 'Guia registrada', 'compra', 999997, '{}'::jsonb);
update notificacion.destinatario set leida_at = now() where aviso_id = (select id from operacion.aviso where clave_dedupe = 'au:inf2');
select is(((notificacion.depurar(true)) ->> 'retirados')::int, 1, 'leido por todos se retira antes de los 7 dias');

-- Tarea programada: sigue mientras su ultima corrida haya fallado.
insert into notificacion.programacion (tarea, expresion_local, expresion_utc, descripcion) values ('tarea_prueba_au', '0 7 * * *', '0 13 * * *', 'prueba');
insert into notificacion.ejecucion (tarea, ventana, estado, inicio) values ('tarea_prueba_au', 'v1', 'error', now() - interval '2 hours');
select operacion.avisar('tarea_falla', null, 'tarea_falla:tarea_prueba_au:v1', 'C', 'Una tarea programada fallo', 'tarea', null, '{"tarea": "tarea_prueba_au"}'::jsonb);
select is(pg_temp.est('tarea_falla:tarea_prueba_au:v1'), 'abierta', 'la tarea fallo: sigue');
insert into notificacion.ejecucion (tarea, ventana, estado, inicio) values ('tarea_prueba_au', 'v2', 'ok', now() - interval '1 hour');
select notificacion.depurar(true);
select is(pg_temp.est('tarea_falla:tarea_prueba_au:v1'), 'resuelta', 'la tarea volvio a correr bien: se resuelve sola');
select matches((select resuelto_ref from operacion.aviso where clave_dedupe = 'tarea_falla:tarea_prueba_au:v1'), '^ejecucion:', 'con referencia a la corrida buena');

-- Privilegios: la web no ejecuta el barrido interno ni la condicion.
select is(has_function_privilege('authenticated', 'notificacion.depurar(boolean)', 'execute'), false, 'authenticated no ejecuta notificacion.depurar');
select is(has_function_privilege('authenticated', 'api.depurar_avisos()', 'execute'), true, 'authenticated si ejecuta api.depurar_avisos');

select * from finish();
rollback;
