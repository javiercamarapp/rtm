-- pgTAP lane telegram-agente (verificacion independiente): clasificacion REAL en vista previa y resultado, candado del segundo socio en SQL (lote historico),
-- capital propio, resolver_toma verificado, privilegios por funcion y origen sin prefijo duplicado. Datos sinteticos.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5000001, 'angelo');
select agente.registrar_miembro(5000002, 'javier');
select agente.registrar_miembro(5000003, 'omar');

-- ------------------------------------------------------------------ ALTO-A: la tarjeta lee lo que la base registra (con o sin la funcion de cuadrar-cuentas)
create temp table _sim as select agente.simular('ejecutar', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"javier","autor":"javier","telegram_user_id":5000002,"origen":"pague 100 a Karen"}') as j;
select is(jsonb_array_length((select j -> 'clasificaciones' from _sim)), 1, 'la vista previa trae la clasificacion que dejaria la base (una aportacion)');
select is((select j -> 'clasificaciones' -> 0 ->> 'monto_cent' from _sim)::bigint, 10000::bigint, 'por el monto que la base separo como aportacion');
create temp table _real as select agente.ejecutar('s:pp0', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"javier","autor":"javier","telegram_user_id":5000002,"origen":"pague 100 a Karen"}') as j;
select is((select j -> 'clasificaciones' -> 0 ->> 'clasificacion' from _real), (select clasificacion from operacion.aportacion_socio order by id desc limit 1), 'el resultado dice la clasificacion de la fila REAL (nunca una plantilla)');
select is((select j -> 'clasificaciones' -> 0 ->> 'clasificacion' from _sim), (select j -> 'clasificaciones' -> 0 ->> 'clasificacion' from _real), 'vista previa y resultado coinciden');
select is((select count(*)::int from operacion.aportacion_socio), 1, 'la vista previa no dejo nada');

-- MEDIO-B: la vista previa refleja declara_capital igual que la ejecucion. Con la funcion REAL de 9 argumentos (lane/cuadrar-cuentas, migracion 20261113300000):
-- un pago de un socio a un proveedor SIN declaracion es REEMBOLSO y con declaracion EXPRESA es CAPITAL.
select is(to_regprocedure('operacion.pago_proveedor_de_socio(text,text,bigint,text,text,date,text,text,boolean)') is not null, true, 'la funcion real de 9 argumentos existe (cuadrar-cuentas va antes en la integracion)');
select is((select j -> 'clasificaciones' -> 0 ->> 'clasificacion' from _real), 'reembolsable', 'sin declarar capital el pago de un socio a un proveedor se registra como REEMBOLSO');
select is((agente.simular('ejecutar', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"javier","declara_capital":true,"autor":"javier","telegram_user_id":5000002,"origen":"x"}') -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'capital', 'la vista previa de la declaracion expresa muestra CAPITAL');
select is((select count(*)::int from operacion.aportacion_socio), 1, 'y la vista previa no dejo nada');
select is((agente.ejecutar('s:pp2', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"javier","declara_capital":true,"autor":"javier","telegram_user_id":5000002,"origen":"meti capital"}') -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'capital', 'con declaracion expresa la ejecucion registra CAPITAL (y trae las clasificaciones)');
select is((select clasificacion from operacion.aportacion_socio order by id desc limit 1), 'capital', 'la fila REAL queda como capital');

-- ------------------------------------------------------------------ BAJO-4: el capital lo declara cada socio por si mismo
select throws_ok($$ select agente.ejecutar('s:c1', 'aportacion', '{"socio":"angelo","monto_cent":100000,"intencion":"capital","autor":"javier","telegram_user_id":5000002,"origen":"x"}') $$, 'P0460', null, 'Javier no registra capital a nombre de Angelo');
select throws_ok($$ select agente.simular('ejecutar', 'aportacion', '{"socio":"angelo","monto_cent":100000,"intencion":"capital","autor":"javier","telegram_user_id":5000002,"origen":"x"}') $$, 'P0460', null, 'ni en la vista previa');
select is((agente.ejecutar('s:c2', 'aportacion', '{"socio":"javier","monto_cent":100000,"intencion":"capital","autor":"javier","telegram_user_id":5000002,"origen":"meti capital"}') -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'capital', 'cada quien declara su propio capital');
select is((agente.ejecutar('s:c3', 'aportacion', '{"socio":"angelo","monto_cent":100000,"autor":"javier","telegram_user_id":5000002,"origen":"Angelo puso 1000"}') -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'reembolsable', 'registrar el deposito del otro SIN capital es un reembolso (cuenta por pagar)');
select throws_ok($$ select agente.ejecutar('s:c4', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"angelo","declara_capital":true,"autor":"javier","telegram_user_id":5000002,"origen":"x"}') $$, 'P0460', null, 'capital en un pago que hizo el otro socio: rechazado');

-- ------------------------------------------------------------------ BAJO-3: lote historico, candado del otro socio en SQL
select catalogo.asegurar_cliente('Tg Cliente', 'Javier');
create function pg_temp.lote(p_tok text, p_cap boolean default false, p_socio text default 'javier') returns jsonb language sql as $$
  select jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'token_boton', p_tok, 'origen', 'lote', 'etiqueta', 'octubre', 'renglones', jsonb_build_array(
    jsonb_build_object('tipo', 'aportacion', 'fecha', (negocio.hoy() - 10)::text, 'monto_cent', 50000, 'socio', p_socio, 'concepto', 'x', 'intencion', case when p_cap then 'capital' else null end))) $$;
select throws_ok($$ select agente.ejecutar_ext('s:l0', 'lote_historico', pg_temp.lote(null)) $$, '42501', null, 'lote sin boton del otro socio: rechazado');
select agente.token_emitir('TokLoteAut1', 'confirmar_refuerzo', array['socio'], -100200, now() + interval '1 day', null, '{"claveIdem":"s:l1"}');
select agente.token_consumir('TokLoteAut1', 'socio', -100200, now(), 5000002);
select throws_ok($$ select agente.ejecutar_ext('s:l1', 'lote_historico', pg_temp.lote('TokLoteAut1')) $$, '42501', null, 'el boton del propio autor no basta: hace falta el OTRO socio');
select agente.token_emitir('TokLoteOtra', 'confirmar_refuerzo', array['socio'], -100200, now() + interval '1 day', null, '{"claveIdem":"s:otra"}');
select agente.token_consumir('TokLoteOtra', 'socio', -100200, now(), 5000001);
select throws_ok($$ select agente.ejecutar_ext('s:l1', 'lote_historico', pg_temp.lote('TokLoteOtra')) $$, '42501', null, 'el boton de Angelo era de otra indicacion: no vale');
select agente.token_emitir('TokLoteOk1', 'confirmar_resumen', array['socio'], -100200, now() + interval '1 day', null, '{"claveIdem":"s:l1"}');
select agente.token_consumir('TokLoteOk1', 'socio', -100200, now(), 5000001);
select throws_ok($$ select agente.ejecutar_ext('s:l1', 'lote_historico', pg_temp.lote('TokLoteOk1')) $$, '42501', null, 'tampoco el primer Confirmar: hace falta el boton reforzado');
select agente.token_emitir('TokLoteOk2', 'confirmar_refuerzo', array['socio'], -100200, now() + interval '1 day', null, '{"claveIdem":"s:l1"}');
select agente.token_consumir('TokLoteOk2', 'socio', -100200, now(), 5000001);
select is((agente.ejecutar_ext('s:l1', 'lote_historico', pg_temp.lote('TokLoteOk2')) ->> 'renglones')::int, 1, 'con el boton reforzado del otro socio, de esta indicacion, se registra');
select is((agente.ejecutar_ext('s:l1', 'lote_historico', pg_temp.lote('TokLoteOk2')) -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'reembolsable', 'y el resultado trae la clasificacion real del renglon');
select is(jsonb_array_length(agente.simular('ejecutar_ext', 'lote_historico', pg_temp.lote(null)) -> 'clasificaciones'), 1, 'la vista previa del lote trae la clasificacion que dejaria (no exige boton)');
select agente.token_emitir('TokLoteCap', 'confirmar_refuerzo', array['socio'], -100200, now() + interval '1 day', null, '{"claveIdem":"s:l2"}');
select agente.token_consumir('TokLoteCap', 'socio', -100200, now(), 5000001);
select throws_ok($$ select agente.ejecutar_ext('s:l2', 'lote_historico', pg_temp.lote('TokLoteCap', true, 'angelo')) $$, 'P0460', null, 'un renglon de capital de Angelo en un lote de Javier: rechazado');
select throws_ok($$ select agente.simular('ejecutar_ext', 'lote_historico', pg_temp.lote(null, true, 'angelo')) $$, 'P0460', null, 'tambien en la vista previa');

-- ------------------------------------------------------------------ MEDIO-E: resolver_toma verifica al socio
select throws_ok($$ select agente.resolver_toma('s:t1', 'T-9999999', 'autorizar', 'javier', 5000001) $$, '42501', null, 'resolver_toma con id ajeno rechazado');
select throws_ok($$ select agente.resolver_toma('s:t2', 'T-9999999', 'autorizar', 'javier', 5000003) $$, '42501', null, 'el id de Omar no resuelve tomas');
select throws_ok($$ select agente.resolver_toma('s:t3', 'T-9999999', 'autorizar', 'omar', 5000003) $$, 'P0460', null, 'omar no es un autor valido');
select throws_ok($$ select agente.resolver_toma('s:t4', 'T-9999999', 'autorizar', 'javier', null) $$, 'P0460', null, 'sin id verificado rechazado');
select is(agente.resolver_toma('s:t5', 'T-9999999', 'autorizar', 'javier', 5000002) ->> 'estado', 'no_encontrada', 'un socio verificado llega hasta la busqueda del folio');
select is(current_setting('rtm.actor'), 'javier', 'y actua como ese socio');

-- ------------------------------------------------------------------ BAJO-5: privilegios por funcion
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ninguna funcion de agente la ejecuta PUBLIC, anon o authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname like '\_%' and has_function_privilege('servidor', p.oid, 'execute')), 0, 'servidor no ejecuta ningun ayudante _*');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname not like '\_%' and not has_function_privilege('servidor', p.oid, 'execute')), 0, 'servidor ejecuta todas las puertas publicas');
select is(has_function_privilege('servidor', 'agente.resolver_toma(text,text,text,text,bigint)', 'execute'), true, 'la puerta nueva de tomas es de servidor');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname = 'resolver_toma'), 1, 'ya no existe la version sin verificar');

-- ------------------------------------------------------------------ BAJO-6: origen sin prefijo duplicado
select agente.ejecutar('s:g1', 'gasto', '{"pagado_por":"javier","monto_cent":9000,"categoria":"uber","origen":"pague 90 de uber","autor":"javier","telegram_user_id":5000002}');
select is((select mensaje_origen from operacion.evento where clave_idem = 's:g1'), 'telegram:javier: pague 90 de uber', 'el gasto guarda el origen con UN solo prefijo');
select is((select count(*)::int from operacion.evento where mensaje_origen like '%telegram:%telegram:%'), 0, 'ningun evento del agente trae el prefijo repetido');

select * from finish();
rollback;
