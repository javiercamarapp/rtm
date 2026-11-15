-- pgTAP bc_001: carril bot/conversacion. (1) agente.conversacion: abrir, completar slot, corregir, conflicto/reemplazar, cancelar, registrar, caducidad perezosa, reloj apagado y recordatorio unico;
-- (2) folio automatico de pedido (iniciales + consecutivo de 3 digitos por clave de iniciales), unico, idempotente, mismo para web y bot; (3) agente.resumen_pedido_registrado. Datos sinteticos.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('bc.ang@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('88888888-8888-8888-8888-8888888888a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bc.ang@example.test');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-8888888888a1', true);

-- ---------------------------------------------------------------- iniciales
select is(operacion.iniciales_cliente('Memo Garcia'), 'MG', 'nombre y apellido: MG');
select is(operacion.iniciales_cliente('Lupita'), 'LU', 'una palabra: sus dos primeras letras');
select is(operacion.iniciales_cliente('  Ángel   Núñez '), 'AN', 'sin acentos ni espacios de mas');
select is(operacion.iniciales_cliente('María del Carmen Ruiz'), 'MC', 'ignora particulas (del)');
select is(operacion.iniciales_cliente('X'), 'XX', 'una letra se rellena con X');
select is(operacion.iniciales_cliente(''), 'XX', 'vacio: XX');

-- ---------------------------------------------------------------- fixtures
select catalogo.asegurar_modelo('BC Marca', 'BC Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('BC Modelo', 'Uva');
select catalogo.asegurar_sku('BC Modelo', 'Mango');
select catalogo.fijar_costo('bc-c1', 'Isaac', 'BC Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_costo('bc-c2', 'Karen', 'BC Modelo', 11000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('Memo Garcia', 'Javier');
select catalogo.asegurar_cliente('Maria Gomez', 'Javier');
select catalogo.asegurar_cliente('Lupita Soto', 'Javier');
select catalogo.fijar_precio('bc-p1', 'Memo Garcia', 'BC Modelo', 20000, '2020-01-01', 'chat');
select catalogo.fijar_precio('bc-p2', 'Maria Gomez', 'BC Modelo', 20000, '2020-01-01', 'chat');
select catalogo.fijar_precio('bc-p3', 'Lupita Soto', 'BC Modelo', 20000, '2020-01-01', 'chat');
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.ped(p_clave text, p_cliente text, p_origen text default 'isaac_directo') returns jsonb language sql as
  $$ select operacion.crear_pedido(p_clave, pg_temp.cid(p_cliente), '[{"modelo":"BC Modelo","sabor":"Uva","piezas":10}]'::jsonb, p_origen, null, 0, 0, 0, '2026-11-02') $$;

-- ---------------------------------------------------------------- folio
select is(pg_temp.ped('bc-f1', 'Memo Garcia') ->> 'folio', 'MG-001', 'primer pedido de MG: MG-001');
select is(pg_temp.ped('bc-f2', 'Maria Gomez') ->> 'folio', 'MG-002', 'otro cliente con las mismas iniciales: MG-002 (unico, comparten consecutivo)');
select is(pg_temp.ped('bc-f3', 'Memo Garcia') ->> 'folio', 'MG-003', 'siguiente de MG: MG-003');
select is(pg_temp.ped('bc-f4', 'Lupita Soto') ->> 'folio', 'LS-001', 'otras iniciales: su propio consecutivo desde 001');
select is(pg_temp.ped('bc-f1', 'Memo Garcia') ->> 'folio', 'MG-001', 'idempotente por clave: la misma clave devuelve el mismo folio');
select is((select count(*) from operacion.pedido where folio like 'MG-%')::int, 3, 'y no crea un pedido repetido');
select is(operacion.siguiente_folio_pedido(pg_temp.cid('Memo Garcia'), 'bc-f1'), 'MG-001', 'siguiente_folio_pedido tambien es idempotente por clave');
select is(operacion.siguiente_folio_pedido(pg_temp.cid('Memo Garcia'), 'bc-f9'), 'MG-004', 'clave nueva: consume el siguiente consecutivo');
select is((select count(distinct folio) from operacion.pedido), (select count(*) from operacion.pedido), 'todos los folios son unicos');
select matches((api.crear_pedido('bc-w1', pg_temp.cid('Lupita Soto'), '[{"modelo":"BC Modelo","sabor":"Uva","piezas":5}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2026-11-02', null, 0)) ->> 'folio', '^LS-002$', 'la web (api.crear_pedido) usa la misma regla: LS-002');
select matches((operacion.ds_crear_pedido('bc-d1', pg_temp.cid('Lupita Soto'), '[{"modelo":"BC Modelo","sabor":"Uva","piezas":5}]'::jsonb, 'karen_directo', null, null, 'cliente', null, null, 0, 0, '2026-11-02')) ->> 'folio', '^LS-003$', 'dropshipping (y por tanto el bot) usa la misma regla: LS-003');
select is(has_function_privilege('authenticated', 'operacion.siguiente_folio_pedido(bigint,text)', 'execute'), false, 'authenticated no ejecuta siguiente_folio_pedido');
select is(has_function_privilege('anon', 'operacion.iniciales_cliente(text)', 'execute'), false, 'anon no ejecuta iniciales_cliente');
select throws_ok($$ select operacion.siguiente_folio_pedido(-5, 'bc-x') $$, '22023', 'cliente desconocido', 'cliente inexistente: error');

-- ---------------------------------------------------------------- resumen
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'folio', 'MG-001', 'resumen: folio');
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) -> 'lineas' -> 0 ->> 'modelo', 'BC MODELO', 'resumen: modelo en MAYUSCULAS');
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) -> 'lineas' -> 0 ->> 'sabor', 'UVA', 'resumen: sabor en MAYUSCULAS');
select is((agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'total_cent')::bigint, 200000::bigint, 'resumen: total 10 x 200.00 (lo calcula SQL)');
select is((agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'utilidad_estimada_cent')::bigint, 100000::bigint, 'resumen: utilidad estimada 10 x (200 - 100)');
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'proveedor', 'Isaac', 'resumen: proveedor del origen');
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'inventario', null, 'resumen: sin inventario propio en dropshipping');
select is((agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'costo_pedido_estimado_cent')::bigint, 100000::bigint, 'resumen: costo estimado del proveedor');
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) -> 'de_contado', 'null'::jsonb, 'resumen: sin plazo todavia, no se afirma contado');
select operacion.acordar_plazo('bc-pl1', (select id from operacion.pedido where folio = 'MG-001'), 15);
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'vence', '2026-11-17', 'resumen: vencimiento = fecha + plazo (estimado)');
select is((agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'MG-001')) ->> 'por_cobrar_cliente_con_pedido_cent')::bigint, 200000::bigint, 'resumen: por cobrar del cliente con este pedido');
select pg_temp.ped('bc-b1', 'Lupita Soto', 'bodega_omar');
select is(jsonb_typeof(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'LS-004')) -> 'inventario'), 'array', 'resumen de bodega: trae inventario por sabor');
select is(agente.resumen_pedido_registrado((select id from operacion.pedido where folio = 'LS-004')) ->> 'proveedor', null, 'resumen de bodega: sin proveedor');
select is(has_function_privilege('authenticated', 'agente.resumen_pedido_registrado(bigint)', 'execute'), false, 'authenticated no ejecuta el resumen');
select is(has_function_privilege('servidor', 'agente.resumen_pedido_registrado(bigint)', 'execute'), true, 'servidor si');

-- ---------------------------------------------------------------- conversacion: slots y espejo
select is(agente.slots_faltantes('pedido_bodega', '{}'::jsonb), array['cliente', 'lineas', 'modalidad', 'envio'], 'pedido de bodega vacio: cliente, lineas, modalidad y envio (el plazo solo si es credito)');
select is(agente.slots_faltantes('pedido_bodega', '{"modalidad":"credito","cliente":"1"}'::jsonb), array['lineas', 'plazo', 'envio'], 'a credito exige plazo');
select is(agente.slots_faltantes('pedido_bodega', '{"modalidad":"contado","cliente":"1","lineas":[{"x":1}],"envio":0}'::jsonb), '{}'::text[], 'completo: sin faltantes (envio 0 cuenta como dato)');
select is(agente.slots_faltantes('aportacion', '{"socio":"angelo","monto":100}'::jsonb), array['intencion'], 'aportacion: la intencion (capital o reembolso) se pregunta siempre');
select is(agente.slots_faltantes('pago_proveedor', '{"proveedor":"x","monto":1,"pagado_por":"sociedad"}'::jsonb), '{}'::text[], 'pago a proveedor de la sociedad no pregunta capital');
select is(agente.slots_faltantes('pago_proveedor', '{"proveedor":"x","monto":1,"pagado_por":"javier"}'::jsonb), array['intencion'], 'pago de un socio pregunta reembolso o capital');
select throws_ok($$ select agente.slots_faltantes('no_existe', '{}'::jsonb) $$, 'P0470', 'operacion desconocida: no_existe', 'operacion desconocida: error');

-- ---------------------------------------------------------------- conversacion: ciclo
create function pg_temp.j(p jsonb, k text) returns jsonb language sql as $$ select p #> string_to_array(k, '.') $$;
select is(agente.conversacion_abrir('bc-a1', 777, 'angelo', 'cobro_cliente', '{"cliente":"7"}'::jsonb, '{}'::jsonb, 'cobro de memo', 11) #>> '{conversacion,faltantes}', '["monto", "cuenta"]', 'abrir: faltan monto y cuenta');
select is(agente.conversacion_abrir('bc-a1', 777, 'angelo', 'cobro_cliente', '{"cliente":"7"}'::jsonb) ->> 'repetido', 'true', 'abrir es idempotente por clave');
select is((select count(*) from agente.conversacion where chat_id = 777)::int, 1, '... y no abre dos');
select is(agente.conversacion_completar_slot('bc-s1', (select id from agente.conversacion where chat_id = 777), 'monto', '1250000'::jsonb, 'son 12,500', 12) #>> '{conversacion,siguiente}', 'cuenta', 'completar monto: sigue la cuenta');
select is(agente.conversacion_completar_slot('bc-s1', (select id from agente.conversacion where chat_id = 777), 'monto', '1250000'::jsonb) ->> 'repetido', 'true', 'completar slot idempotente');
select is(agente.conversacion_completar_slot('bc-s2', (select id from agente.conversacion where chat_id = 777), 'monto', '2000000'::jsonb) #>> '{conversacion,slots,monto}', '2000000', 'corregir: reescribe el slot sin reiniciar');
select is((select tipo from agente.conversacion_evento where clave_idem = 'bc-s2'), 'correccion', '... y queda auditado como correccion');
select is((select slots ->> 'cliente' from agente.conversacion where chat_id = 777), '7', '... el cliente sigue intacto');
select is(agente.conversacion_fijar_pregunta('bc-q1', (select id from agente.conversacion where chat_id = 777), 'cuenta', 'A que cuenta entro?', '[{"valor":"angelo","texto":"Angelo"}]'::jsonb, '{"k":1}'::jsonb, 99) #>> '{conversacion,pregunta,mensaje_id}', '99', 'fijar pregunta: guarda el mensaje para ligar la respuesta');
select is(agente.conversacion_completar_slot('bc-s3', (select id from agente.conversacion where chat_id = 777), 'cuenta', '"efectivo"'::jsonb) ->> 'estado', 'completa', 'sin faltantes: completa');
select is((select pregunta_texto from agente.conversacion where chat_id = 777), null, '... y limpia la pregunta respondida');
select is(agente.conversacion_registrada('bc-r1', (select id from agente.conversacion where chat_id = 777), 'PG-0001') ->> 'estado', 'registrada', 'registrada con folio');
select is((select folio_registro from agente.conversacion where chat_id = 777), 'PG-0001', '... el folio queda');
select throws_ok($$ select agente.conversacion_registrada('bc-r2', (select id from agente.conversacion where chat_id = 777), 'PG-0002') $$, 'P0470', null, 'no se registra dos veces');
select is(agente.conversacion_obtener(777, 'angelo'), null, 'ya no hay conversacion abierta');

-- conflicto, reemplazo y cancelacion
select agente.conversacion_abrir('bc-b1', 778, 'javier', 'gasto', '{"monto":5000}'::jsonb);
select is(agente.conversacion_abrir('bc-b2', 778, 'javier', 'retiro', '{"socio":"javier"}'::jsonb, '{}'::jsonb, 'retiro de javier', 21) ->> 'estado', 'conflicto', 'nueva instruccion con pregunta abierta: conflicto (no cancela solo)');
select is((select reemplazo ->> 'operacion' from agente.conversacion where chat_id = 778 and estado = 'abierta'), 'retiro', '... la instruccion nueva queda guardada');
select is(agente.conversacion_reemplazar('bc-b3', 778, 'javier') #>> '{conversacion,operacion}', 'retiro', 'reemplazar: abre la nueva');
select is((select count(*) from agente.conversacion where chat_id = 778 and estado = 'cancelada')::int, 1, '... y cancela la anterior');
select is((select count(*) from agente.conversacion where chat_id = 778 and estado = 'abierta')::int, 1, '... una sola viva');
select is(agente.conversacion_cancelar('bc-c1', (select id from agente.conversacion where chat_id = 778 and estado = 'abierta'), 'ya no') ->> 'estado', 'cancelada', 'cancelar');
select is(agente.conversacion_cancelar('bc-c1', (select id from agente.conversacion where chat_id = 778 and estado in ('cancelada') order by id desc limit 1), 'ya no') ->> 'repetido', 'true', 'cancelar es idempotente');

-- caducidad perezosa (30 minutos) y reloj apagado
select agente.conversacion_abrir('bc-e1', 779, 'angelo', 'gasto', '{}'::jsonb);
update agente.conversacion set expira_at = clock_timestamp() - interval '1 minute' where chat_id = 779;
select is(agente.conversacion_obtener(779, 'angelo'), null, 'pasados los 30 minutos la conversacion caduca al consultarla (sin reloj)');
select is((select estado from agente.conversacion where chat_id = 779), 'expirada', '... queda expirada');
select agente.conversacion_abrir('bc-e2', 779, 'angelo', 'gasto', '{}'::jsonb);
update agente.conversacion set expira_at = clock_timestamp() - interval '1 minute' where chat_id = 779 and estado = 'abierta';
select is(agente.conversacion_completar_slot('bc-e3', (select id from agente.conversacion where chat_id = 779 and estado = 'expirada' order by id desc limit 1), 'monto', '100'::jsonb) ->> 'estado', 'expirada', 'contestar una vencida avisa que expiro');
select is(agente.conversacion_expirar() ->> 'estado', 'apagado', 'el reloj nace APAGADO');
select is((select activo from seguridad.interruptor where clave = 'agente_conversacion_reloj'), false, '... por el interruptor agente_conversacion_reloj');

-- reloj encendido (solo en esta prueba): un recordatorio unico y luego la caducidad
update seguridad.interruptor set activo = true where clave = 'agente_conversacion_reloj';
select agente.conversacion_abrir('bc-t1', 780, 'angelo', 'gasto', '{}'::jsonb);
select agente.conversacion_fijar_pregunta('bc-t2', (select id from agente.conversacion where chat_id = 780), 'monto', 'De cuanto fue?', null, null, 5);
update agente.conversacion set actualizada_at = clock_timestamp() - interval '16 minutes' where chat_id = 780;
select is(jsonb_array_length(agente.conversacion_expirar() -> 'recordatorios'), 1, 'a los 15 minutos: un recordatorio');
select is(jsonb_array_length(agente.conversacion_expirar() -> 'recordatorios'), 0, '... y solo uno');
update agente.conversacion set expira_at = clock_timestamp() - interval '1 second' where chat_id = 780;
select is(jsonb_array_length(agente.conversacion_expirar() -> 'expiradas'), 1, 'a los 30 minutos: caduca');
select is(agente.conversacion_expirar() ->> 'estado', 'activo', '... el reloj dice que esta activo');
update seguridad.interruptor set activo = false where clave = 'agente_conversacion_reloj';

-- permisos
select is(has_function_privilege('authenticated', 'agente.conversacion_abrir(text,bigint,text,text,jsonb,jsonb,text,bigint,int)', 'execute'), false, 'authenticated no abre conversaciones');
select is(has_function_privilege('anon', 'agente.conversacion_expirar(timestamptz,int)', 'execute'), false, 'anon no ejecuta el reloj');
select is(has_function_privilege('servidor', 'agente.conversacion_completar_slot(text,bigint,text,jsonb,text,bigint,jsonb)', 'execute'), true, 'servidor si completa slots');
select is(has_table_privilege('authenticated', 'agente.conversacion', 'select'), false, 'authenticated no lee la tabla');
select * from finish();
rollback;
