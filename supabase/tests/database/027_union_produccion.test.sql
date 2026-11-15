-- pgTAP: reconciliacion de la union de main con produccion (migraciones 20261112*).
begin;
-- Carril frenos: el interruptor agente_escritura nace apagado; esta prueba ejerce las puertas de escritura.
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select no_plan();

select is((select count(*)::int from notificacion.tipo where codigo in ('retiro_capital_por_confirmar', 'toma_pendiente')), 2, 'los dos codigos de aviso de produccion estan en el catalogo');
select is((select requiere_accion and canal = 'ST' from notificacion.tipo where codigo = 'toma_pendiente'), true, 'toma_pendiente pide accion y avisa por Telegram');

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('u27.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('27272727-2727-2727-2727-272727272701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'u27.javier@example.test');
select set_config('request.jwt.claim.sub', '27272727-2727-2727-2727-272727272701', true);

-- api.cuentas_por_cobrar conserva la clave 'apertura' (main) y devuelve la lista ordenada y estable (produccion).
select is((api.cuentas_por_cobrar() ? 'apertura'), true, 'cuentas por cobrar trae la lista de partidas de apertura');
select is(jsonb_typeof(api.cuentas_por_cobrar() -> 'apertura'), 'array', 'y es una lista');
select is((api.cuentas_por_cobrar() -> 'filas') = (api.cuentas_por_cobrar() -> 'filas'), true, 'dos lecturas seguidas dan las filas en el mismo orden');
select matches(pg_get_functiondef('api.cuentas_por_cobrar()'::regprocedure), 'pedido_id.*::bigint\), ''\[\]''', 'el orden se desempata por pedido_id');

-- Aportacion por Telegram: sin declarar capital es un reembolso (adenda 32).
select matches(pg_get_functiondef('agente._ejecutar_base(text,text,jsonb)'::regprocedure), 'else ''reembolso'' end', 'agente.ejecutar (base, tras la puerta que verifica al autor) pasa reembolso por omision y capital solo si se declara');

select * from finish();
rollback;
