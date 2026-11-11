-- pgTAP: limite de intentos con VENTANA DESLIZANTE EXACTA (0014). Los esperados salen de la especificacion
-- (cuenta los intentos de la clave en los ultimos N segundos, incluyendo el actual), no de la salida del codigo.
-- El tiempo se controla moviendo las marcas de los eventos; no hay esperas. La concurrencia real (varias sesiones) no cabe
-- en pgTAP, que corre en una sola transaccion: la cubre test/integracion/limite_concurrencia.test.ts.
begin;
select plan(19);

select has_table('seguridad', 'limite_intento_evento', 'existe seguridad.limite_intento_evento');

-- 1. Intentos que cruzan una frontera fija antigua se cuentan juntos ------------------------------------------------------
-- B = ultimo multiplo de 600 s. Dos eventos justo antes de B y el intento actual (despues de B): con ventanas fijas de 600 s
-- el actual valdria 1; con ventana deslizante de 1200 s deben contar los tres.
select set_config('rtm.b', (floor(extract(epoch from clock_timestamp()) / 600)::bigint * 600)::text, true);
insert into seguridad.limite_intento_evento (clave, ts)
  select 'ip:fronteraaaaaaaa1', to_timestamp(current_setting('rtm.b')::bigint - 1 - g) from generate_series(0, 1) g;
select is(seguridad.registrar_intento_login('ip:fronteraaaaaaaa1', 1200), 3, 'los intentos a ambos lados de una frontera fija se cuentan juntos');

insert into seguridad.limite_intento_evento (clave, ts) values ('ip:fronterabbbbbbb2', clock_timestamp() - interval '599 seconds');
insert into seguridad.limite_intento_evento (clave, ts) values ('ip:fronterabbbbbbb2', clock_timestamp() - interval '300 seconds');
select is(seguridad.registrar_intento_login('ip:fronterabbbbbbb2', 600), 3, 'eventos de hace 599 y 300 s siguen dentro de 600 s');

-- 2. El tope por correo no se rebasa: 3 por 10 min; del cuarto en adelante el conteo supera el tope ---------------------------
select is(array(select seguridad.registrar_intento_login('correo:topecorreo0001', 600) from generate_series(1, 6)), array[1, 2, 3, 4, 5, 6],
  'el conteo crece 1..6 sin reiniciarse: solo los 3 primeros quedan dentro del tope de 3');
select is((select count(*)::int from seguridad.limite_intento_evento where clave = 'correo:topecorreo0001'), 6, 'cada intento deja un evento');

-- 3. Independencia por clave y por ventana --------------------------------------------------------------------------------
select is(seguridad.registrar_intento_login('correo:topecorreo0002', 600), 1, 'otra clave empieza en 1 aunque la anterior este llena');
insert into seguridad.limite_intento_evento (clave, ts) values ('ip:ventanasxxxxxxx1', clock_timestamp() - interval '400 seconds');
select is(seguridad.registrar_intento_login('ip:ventanasxxxxxxx1', 300), 1, 'ventana de 300 s: el evento de hace 400 s ya no cuenta');
select is(seguridad.registrar_intento_login('ip:ventanasxxxxxxx1', 600), 3, 'ventana de 600 s sobre la misma clave: cuenta el de hace 400 s y los dos intentos propios');
select is((select count(*)::int from seguridad.limite_intento_evento where clave = 'ip:ventanasxxxxxxx2'), 0, 'una clave ajena no tiene eventos (no hay arrastre entre claves)');

-- 4. Un evento sale de la ventana al pasar el tiempo (marcas movidas, sin esperas) -----------------------------------------
select seguridad.registrar_intento_login('ip:tiempoyyyyyyyy1', 600);
select seguridad.registrar_intento_login('ip:tiempoyyyyyyyy1', 600);
update seguridad.limite_intento_evento set ts = ts - interval '595 seconds' where clave = 'ip:tiempoyyyyyyyy1';
select is(seguridad.registrar_intento_login('ip:tiempoyyyyyyyy1', 600), 3, 'a 595 s los dos eventos siguen dentro');
update seguridad.limite_intento_evento set ts = ts - interval '10 seconds' where clave = 'ip:tiempoyyyyyyyy1' and ts < clock_timestamp() - interval '590 seconds';
select is(seguridad.registrar_intento_login('ip:tiempoyyyyyyyy1', 600), 2, 'pasados 600 s los dos eventos viejos salen; quedan el anterior y el actual');

-- 5. Validaciones de ventana y de clave (iguales que antes) ---------------------------------------------------------------
select throws_ok($$select seguridad.registrar_intento_login('ip:validaciones001', 0)$$, '22023', 'ventana invalida', 'ventana 0 rechazada');
select throws_ok($$select seguridad.registrar_intento_login('ip:validaciones001', 86401)$$, '22023', 'ventana invalida', 'ventana mayor a un dia rechazada');
select throws_ok($$select seguridad.registrar_intento_login('ip:validaciones001', null)$$, '22023', 'ventana invalida', 'ventana nula rechazada');
select throws_ok($$select seguridad.registrar_intento_login('mal formato', 300)$$, '23514', null, 'clave con formato invalido rechazada');
select throws_ok($$select seguridad.registrar_intento_login(null, 300)$$, '23502', null, 'clave nula rechazada');

-- 6. Limpieza oportunista de la propia clave: lo de mas de un dia se borra --------------------------------------------------
insert into seguridad.limite_intento_evento (clave, ts) values ('ip:limpiezaaaaaaa1', clock_timestamp() - interval '2 days');
select seguridad.registrar_intento_login('ip:limpiezaaaaaaa1', 300);
select is((select count(*)::int from seguridad.limite_intento_evento where clave = 'ip:limpiezaaaaaaa1' and ts < clock_timestamp() - interval '1 day'), 0, 'los eventos de mas de un dia de la clave se purgan');

-- 7. Privilegios: solo el rol servidor ------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'seguridad' and p.proname = 'registrar_intento_login'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'anon y authenticated no pueden ejecutar registrar_intento_login');
set local role anon;
select throws_ok($$select seguridad.registrar_intento_login('ip:privilegiosaaaa1', 300)$$, '42501', null, 'anon: ejecucion denegada');
reset role;

select * from finish();
rollback;
