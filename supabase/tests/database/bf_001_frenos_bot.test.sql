-- pgTAP carril FRENOS del bot de Telegram: interruptor agente_escritura (nace apagado; apagado NADA escribe), antiduplicado por huella, guarda de sobrepago,
-- eco rico, deshacer 10 minutos para todos, lease de updates y migracion de chat. Datos sinteticos; no se envia nada.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5000001, 'angelo');
select agente.registrar_miembro(5000002, 'javier');
select agente.registrar_miembro(5000003, 'omar');
select agente.registrar_chat('grupo_socios', -4000001);
select catalogo.asegurar_cliente('Bf Cliente', 'Javier');
select catalogo.asegurar_cliente('Bf Omar Persona', 'Javier'); select catalogo.asegurar_persona_bodega('Bf Omar Persona', 'Bf Omar Persona');
select catalogo.asegurar_modelo('Bf Marca', 'Bf Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('Bf Modelo', 'Uva');
select catalogo.fijar_costo('bf:k', 'Karen', 'Bf Modelo', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_costo('bf:k2', 'Isaac', 'Bf Modelo', 11000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('bf:p', 'Bf Cliente', 'Bf Modelo', 25000, negocio.hoy() - 30, 'chat');
select catalogo.asegurar_cliente('Bf Cliente Dos', 'Javier'); select catalogo.fijar_precio('bf:p2', 'Bf Cliente Dos', 'Bf Modelo', 25000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('bf:m1', 'Bf Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 40, 400000, negocio.hoy() - 5);
select costos.registrar_tipo_cambio('bf:tc0', negocio.hoy() - 1, 18500000, 'manual');
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'Bf Modelo' $$;
create function pg_temp.sid() returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = 'Uva' $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'Bf Cliente' $$;
create function pg_temp.cid2() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'Bf Cliente Dos' $$;
create function pg_temp.ang(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x') || $1 $$;
create function pg_temp.jav(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x') || $1 $$;

-- ------------------------------------------------------------------ 1. el interruptor NACE apagado y apagado nada escribe
select is((select activo from seguridad.interruptor where clave = 'agente_escritura'), false, 'agente_escritura nace APAGADO (solo lectura)');
select is((agente.escritura_estado() ->> 'activa')::boolean, false, 'escritura_estado dice solo lectura');
select throws_ok($$ select agente.ejecutar('bf:g0', 'gasto', pg_temp.ang('{"pagado_por":"angelo","monto_cent":50000,"categoria":"uber"}')) $$, 'P0463', null, 'ejecutar no escribe con el interruptor apagado');
select throws_ok($$ select agente.ejecutar_ext('bf:p0', 'cliente_alta', pg_temp.ang('{"nombre":"Cliente Nuevo"}')) $$, 'P0463', null, 'ejecutar_ext no escribe con el interruptor apagado');
select throws_ok($$ select agente.resolver_toma('bf:t0', 'T-0001', 'autorizar', 'angelo', 5000001) $$, 'P0463', null, 'autorizar una toma de Omar tampoco escribe apagado');
select throws_ok($$ select agente.sabor_responder('bf:s0', pg_temp.ang('{"pregunta_id":1,"respuesta":"si"}')) $$, 'P0463', null, 'ni responder una union de sabores');
select is((select count(*)::int from operacion.gasto), 0, 'apagado: ningun gasto quedo');
select is(jsonb_typeof(agente.consulta('inventario', pg_temp.mid(), null) -> 'lineas'), 'array', 'las consultas siguen funcionando apagado');

-- ------------------------------------------------------------------ 2. /escritura y /lectura: solo socios verificados
select throws_ok($$ select agente.fijar_escritura(true, 'omar', 5000003, 'x') $$, 'P0460', null, 'Omar no enciende la escritura');
select throws_ok($$ select agente.fijar_escritura(true, 'angelo', 5000002, 'x') $$, '42501', null, 'el id de Telegram debe ser el del socio indicado');
select throws_ok($$ select agente.fijar_escritura(true, 'angelo', 9999999, 'x') $$, '42501', null, 'un desconocido tampoco');
select is((agente.fijar_escritura(true, 'angelo', 5000001, 'prueba') ->> 'cambio')::boolean, true, 'Angelo enciende la escritura');
select is((agente.escritura_estado() ->> 'por'), 'angelo', 'queda registrado quien lo cambio');
select is((agente.fijar_escritura(true, 'angelo', 5000001, 'prueba') ->> 'cambio')::boolean, false, 'repetir el mismo estado no cambia nada');
select is((select count(*)::int from agente.escritura_cambio where por = 'angelo'), 1, 'un solo cambio en el registro');

-- ------------------------------------------------------------------ 3. antiduplicado por huella de contenido
create temp table _a as select agente.ejecutar('bf:a1', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":100000,"intencion":"reembolso"}')) as j;
select ok((select j ->> 'folio' from _a) is not null, 'la aportacion se registra y trae folio');
select ok(((select j from _a) -> 'eco_rico' ->> 'socio') = 'Angelo', 'eco rico: a que socio se aplico');
create temp table _d as select agente.ejecutar('bf:a2', 'aportacion', pg_temp.jav('{"socio":"angelo","monto_cent":100000,"intencion":"reembolso"}')) as j;
select is((select (j ->> 'posible_duplicado')::boolean from _d), true, 'el mismo hecho de OTRO socio dentro de 10 minutos es posible duplicado');
select is((select j ->> 'folio_previo' from _d), (select j ->> 'folio' from _a), 'dice cual es el folio previo');
select is((select j ->> 'autor_previo' from _d), 'angelo', 'y quien lo registro');
select is((select count(*)::int from operacion.aportacion_socio), 1, 'el duplicado no escribio nada');
select is((select count(*)::int from agente.evento where tipo = 'duplicado_bloqueado'), 1, 'el bloqueo queda en el registro');
select is((agente.ejecutar('bf:a1', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":100000,"intencion":"reembolso"}')) ->> 'repetido')::boolean, true, 'la misma clave (reintento) NO es duplicado: devuelve lo ya aplicado');
select ok((agente.ejecutar('bf:a3', 'aportacion', pg_temp.jav('{"socio":"angelo","monto_cent":100000,"intencion":"reembolso","permitir_duplicado":true}')) ->> 'folio') is not null, 'si el socio dice que es otro, se registra');
select is((select count(*)::int from operacion.aportacion_socio), 2, 'ahora hay dos');
select ok((agente.ejecutar('bf:a4', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":100001,"intencion":"reembolso"}')) ->> 'folio') is not null, 'otro monto no es duplicado');
update agente.huella set creada_at = now() - interval '11 minutes' where clave_idem in ('bf:a1', 'bf:a3');
select ok((agente.ejecutar('bf:a5', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":100000,"intencion":"reembolso"}')) ->> 'folio') is not null, 'pasados 10 minutos ya no es duplicado');

-- ------------------------------------------------------------------ 4. guarda de sobrepago del cobro (pregunta, no tope)
create temp table _e as select agente.ejecutar('bf:c1', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 700000, 'cliente_id', pg_temp.cid()))) as j;
select is((select (j ->> 'pregunta_exceso')::boolean from _e), true, 'un cobro mayor a lo que debe el cliente se pregunta');
select is((select (j ->> 'debe_cent')::bigint from _e), 0::bigint, 'dice cuanto debe el cliente (cifra de SQL)');
select is((select count(*)::int from operacion.pago), 0, 'sin respuesta afirmativa no se registra nada');
create temp table _f as select agente.ejecutar('bf:c2', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 700000, 'cliente_id', pg_temp.cid(), 'confirmo_exceso', true))) as j;
select ok((select j ->> 'folio' from _f) is not null, 'con la confirmacion del socio (anticipo) se registra');
select is((select j -> 'eco_rico' ->> 'cliente' from _f), 'Bf Cliente', 'eco rico: cliente canonico');
select is((select j -> 'eco_rico' ->> 'cuenta' from _f), 'Efectivo', 'eco rico: cuenta');
select is((select (j -> 'eco_rico' ->> 'a_favor_cent')::bigint from _f), 700000::bigint, 'eco rico: lo que queda a favor del cliente, de la base');
select is((select (j -> 'eco_rico' ->> 'saldo_antes_cent')::bigint from _f), 0::bigint, 'eco rico: saldo antes');
-- un pedido enviado y un cobro que SI cabe: se registra sin preguntar
create temp table _p as select agente.ejecutar_ext('bf:ped', 'pedido_crear', pg_temp.ang(jsonb_build_object('plazo_dias', 7, 'cliente_id', pg_temp.cid2(),
  'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid(), 'piezas', 10))))) as j;
select ok((select j ->> 'folio' from _p) is not null, 'el pedido se crea con su eco');
select ok((agente.ejecutar_ext('bf:env', 'pedido_enviar', pg_temp.ang(jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p), 'aceptar_avisos', true))) ->> 'pedido') ~ '^[A-Z]+-[0-9]{3}$', 'pedido enviado');
create temp table _g as select agente.ejecutar('bf:c3', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 10000, 'cliente_id', pg_temp.cid2()))) as j;
select ok((select j ->> 'folio' from _g) is not null, 'un cobro que cabe en lo que debe se registra sin preguntar');
select ok(jsonb_array_length((select j -> 'eco_rico' -> 'pedidos_aplicados' from _g)) >= 1, 'eco rico: a que pedido se aplico');
create temp table _h as select agente.ejecutar('bf:c4', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 99999999, 'cliente_id', pg_temp.cid2()))) as j;
select is((select (j ->> 'pregunta_exceso')::boolean from _h), true, 'un cero de mas se pregunta aunque no haya topes (99,999,999 centavos)');
create temp table _i as select agente.ejecutar('bf:c5', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 99999999999::bigint, 'cliente_id', pg_temp.cid(), 'confirmo_exceso', true))) as j;
select ok((select j ->> 'folio' from _i) is not null, 'sin tope de monto: un cobro de mas de un millon de pesos confirmado se registra');

-- ------------------------------------------------------------------ 5. deshacer 10 minutos para todos (el autor tambien)
create temp table _k as select agente.ejecutar('bf:g1', 'gasto', pg_temp.jav('{"pagado_por":"javier","monto_cent":12345,"categoria":"uber"}')) as j;
select ok((select j ->> 'folio' from _k) is not null, 'gasto registrado');
select is((agente.localizar(null, 'javier') ->> 'folio'), (select folio from agente.hecho where autor = 'javier' order by creado_at desc limit 1), '"deshaz eso" encuentra el ultimo movimiento propio dentro de la ventana');
select ok((agente.deshacer('bf:d1', (select j ->> 'folio' from _k), 'javier', 5000002)) is not null, 'su autor lo deshace dentro de 10 minutos');
create temp table _l as select agente.ejecutar('bf:a9', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":777700,"intencion":"reembolso"}')) as j;
create temp table _m as select agente.deshacer('bf:d2', (select j ->> 'folio' from _l), 'angelo', 5000001) as j;
select is((select j -> 'revertido' ->> 'monto_cent' from _m), '777700', 'el deshacer devuelve el efecto revertido (eco)');
select is((agente.ejecutar('bf:a9b', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":777700,"intencion":"reembolso"}')) ->> 'posible_duplicado'), null, 'un hecho deshecho ya no cuenta como duplicado: se puede capturar de nuevo');
update agente.hecho set creado_at = now() - interval '11 minutes' where clave_idem = 'bf:a4';
select throws_like($$ select agente.deshacer('bf:d3', (select folio from agente.hecho where clave_idem = 'bf:a4'), 'angelo', 5000001) $$, '%pasaron mas de 10 minutos%', 'pasados 10 minutos ni su autor lo deshace');
select throws_like($$ select agente.deshacer('bf:d4', (select folio from agente.hecho where clave_idem = 'bf:a4'), 'javier', 5000002) $$, '%pasaron mas de 10 minutos%', 'ni el otro socio');
select is((agente.localizar(null, 'angelo') ->> 'folio') is distinct from (select folio from agente.hecho where clave_idem = 'bf:a4'), true, '"deshaz eso" no toma un hecho fuera de la ventana');
select ok('conteo' = any (agente.tipos_no_reversibles()) and 'pedido_envio' = any (agente.tipos_no_reversibles()) and 'compra_recepcion' = any (agente.tipos_no_reversibles()) and 'cliente' = any (agente.tipos_no_reversibles()) and 'acta_firma' = any (agente.tipos_no_reversibles()), 'lista explicita de lo que no se deshace');
update agente.hecho set creado_at = now() where clave_idem = 'bf:env';
select throws_like($$ select agente.deshacer('bf:d5', (select folio from agente.hecho where clave_idem = 'bf:env'), 'angelo', 5000001) $$, '%no se deshace%', 'el envio de un pedido no se deshace (contramovimiento desde el software)');
-- apagado, deshacer sigue funcionando
create temp table _n as select agente.ejecutar('bf:a10', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":888800,"intencion":"reembolso"}')) as j;
select agente.fijar_escritura(false, 'javier', 5000002, 'prueba');
select ok((agente.deshacer('bf:d6', (select j ->> 'folio' from _n), 'angelo', 5000001)) is not null, 'con la escritura apagada el deshacer sigue funcionando');
select throws_ok($$ select agente.ejecutar('bf:a11', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":5,"intencion":"reembolso"}')) $$, 'P0463', null, 'y un registro nuevo sigue bloqueado');

-- ------------------------------------------------------------------ 6. apagado automatico por anomalia: solo apaga; reactivar es de un socio
select agente.fijar_escritura(true, 'javier', 5000002, 'prueba');
select is((agente.revisar_anomalia() ->> 'apagado')::boolean, false, 'sin anomalia no apaga');
insert into agente.evento (tipo, miembro, detalle) select 'error_escritura', null, 'prueba ' || g from generate_series(1, 10) g;
select is((agente.revisar_anomalia() ->> 'apagado')::boolean, true, '10 errores de escritura en 5 minutos apagan el agente');
select is((agente.escritura_estado() ->> 'activa')::boolean, false, 'queda en solo lectura');
select is((agente.escritura_estado() ->> 'por'), 'sistema', 'dice que lo apago el sistema');
select is((agente.apagar_escritura_anomalia('otra') ->> 'apagado')::boolean, false, 'apagar de nuevo no hace nada');
select is((agente.fijar_escritura(true, 'angelo', 5000001, 'reactivado') ->> 'activa')::boolean, true, 'un socio lo reactiva');

-- ------------------------------------------------------------------ 7. lease de updates y migracion de chat
select is(agente.reclamar_update2(900001, '{"update_id":900001}'::jsonb, 120), 'nuevo', 'primer reclamo: nuevo');
select is(agente.reclamar_update2(900001, null, 120), 'duplicado', 'con el lease vigente es duplicado (sigue en curso)');
update agente.tg_update set lease_hasta = now() - interval '1 minute' where update_id = 900001;
select is(agente.reclamar_update2(900001, null, 120), 'reprocesar', 'lease vencido: se reprocesa');
select is((select intentos from agente.tg_update where update_id = 900001), 2, 'cuenta los intentos');
select agente.terminar_update(900001, 'terminado');
select is(agente.reclamar_update2(900001, null, 120), 'duplicado', 'terminado: duplicado');
select is((select cuerpo from agente.tg_update where update_id = 900001), null, 'al terminar se borra el cuerpo guardado');
select agente.reclamar_update2(900002, '{"update_id":900002}'::jsonb, 120);
select agente.terminar_update(900002, 'fallido', 'prueba');
select is(jsonb_array_length(agente.updates_pendientes(10)), 1, 'un update fallido aparece para reprocesar');
select is(agente.reclamar_update2(900002, null, 120), 'reprocesar', 'segundo intento');
select agente.terminar_update(900002, 'fallido', 'prueba');
select is(agente.reclamar_update2(900002, null, 120), 'reprocesar', 'tercer intento');
select agente.terminar_update(900002, 'fallido', 'prueba');
select is(agente.reclamar_update2(900002, null, 120), 'duplicado', 'tras 3 intentos queda abandonado');
select is(jsonb_array_length(agente.updates_abandonados()), 1, 'el abandonado se avisa');
select is(jsonb_array_length(agente.updates_abandonados()), 0, 'una sola vez');
select is((agente.migrar_chat(-4000001, -1004000001) ->> 'migrado')::boolean, true, 'el grupo migra a supergrupo');
select is((agente.chats() ->> 'grupoSocios')::bigint, -1004000001::bigint, 'agente.chat_registrado queda con el id nuevo');
select is((select count(*)::int from notificacion.destino where telegram_chat_id = -4000001), 0, 'notificacion.destino ya no tiene el viejo');
select is((agente.migrar_chat(-777, -778) ->> 'migrado')::boolean, false, 'un chat no registrado no se toca');

-- ------------------------------------------------------------------ 8. privilegios
select is(has_function_privilege('authenticated', 'agente.fijar_escritura(boolean,text,bigint,text)', 'execute'), false, 'fijar_escritura no es de authenticated');
select is(has_function_privilege('authenticated', 'agente.ejecutar(text,text,jsonb)', 'execute'), false, 'ejecutar no es de authenticated');
select is(has_function_privilege('servidor', 'agente._ejecutar_previo(text,text,jsonb)', 'execute'), false, 'el ayudante renombrado no lo ejecuta servidor');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname like '\_%' and has_function_privilege('servidor', p.oid, 'execute')), 0, 'servidor no ejecuta ningun ayudante _*');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ninguna funcion de agente la ejecuta PUBLIC, anon o authenticated');
select * from finish();
rollback;
