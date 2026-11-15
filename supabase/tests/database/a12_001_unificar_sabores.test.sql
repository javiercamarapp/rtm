-- pgTAP a12_001: unificacion de sabores (deteccion, cola de preguntas, unificacion logica, reversa, alta con pregunta).
-- Escenario espejo de produccion: un modelo con AMBOS sabores y ventas en los dos (fusion de sku), otro con solo el sabor origen (reasignacion), y un sku con existencia (bloqueo).
-- La prueba central: kardex, existencias, libro (hash encadenado), comprobaciones C1..C24 y totales son IDENTICOS antes y despues de unificar. Ninguna fila inmutable se toca.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('us.jav@example.test', 'socio', 'Javier', true), ('us.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values ('88888888-8888-8888-8888-8888888888a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'us.jav@example.test'),
  ('88888888-8888-8888-8888-8888888888a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'us.omar@example.test');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-8888888888a1', true);

-- Datos: modelo A con ambos sabores; modelo B solo con el origen; modelo C para el bloqueo.
select catalogo.asegurar_cliente('US Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('US Omar Persona', 'US Omar Persona');
select catalogo.asegurar_cliente('US Villa', 'Javier');
select catalogo.asegurar_modelo('US Marca', 'US Blade', 50000, 'ambas');
select catalogo.asegurar_modelo('US Marca', 'US Icon', 50000, 'ambas');
select catalogo.asegurar_modelo('US Marca', 'US Bloq', 50000, 'ambas');
select catalogo.asegurar_sku('US Blade', s) from unnest(array['Passionfruit', 'Passion Fruit', 'Kiwi Dragonfruit', 'Kiwi Dragon Fruit', 'Mango']) s;
select catalogo.asegurar_sku('US Icon', s) from unnest(array['Passionfruit', 'Kiwi Dragon Fruit']) s;
select catalogo.asegurar_sku('US Bloq', s) from unnest(array['Kiwi Dragonfruit', 'Kiwi Dragon Fruit']) s;
select catalogo.fijar_costo('us-k' || m, 'Isaac', m, 23000, '2026-11-01', 'prueba') from unnest(array['US Blade', 'US Icon', 'US Bloq']) m;
select catalogo.fijar_precio('us-p' || m, 'US Villa', m, 25000, '2026-11-01', 'chat') from unnest(array['US Blade', 'US Icon', 'US Bloq']) m;
select operacion.registrar_movimiento('us-e1', 'US Blade', 'Passionfruit', 'bodega_omar', 'entrada_compra', 10, 230000, '2026-11-08');
select operacion.registrar_movimiento('us-e2', 'US Blade', 'Passion Fruit', 'bodega_omar', 'entrada_compra', 30, 690000, '2026-11-08');
select operacion.registrar_movimiento('us-e3', 'US Blade', 'Kiwi Dragonfruit', 'bodega_omar', 'entrada_compra', 5, 115000, '2026-11-08');
select operacion.registrar_movimiento('us-e4', 'US Blade', 'Kiwi Dragon Fruit', 'bodega_omar', 'entrada_compra', 20, 460000, '2026-11-08');
select operacion.registrar_movimiento('us-e5', 'US Icon', 'Passionfruit', 'bodega_omar', 'entrada_compra', 8, 184000, '2026-11-08');
select operacion.registrar_movimiento('us-e6', 'US Bloq', 'Kiwi Dragonfruit', 'bodega_omar', 'entrada_compra', 6, 138000, '2026-11-08');
select operacion.registrar_movimiento('us-e7', 'US Bloq', 'Kiwi Dragon Fruit', 'bodega_omar', 'entrada_compra', 6, 138000, '2026-11-08');
create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
-- Ventas en AMBOS nombres, enviadas (como en produccion): el sku origen queda en 0 y con movimientos de salida en el kardex.
select operacion.crear_pedido('us-v1', (select id from catalogo.cliente where nombre_canonico = 'US Villa'), '[
  {"modelo":"US Blade","sabor":"Passionfruit","piezas":10},{"modelo":"US Blade","sabor":"Passion Fruit","piezas":4},
  {"modelo":"US Blade","sabor":"Kiwi Dragonfruit","piezas":5},{"modelo":"US Icon","sabor":"Passionfruit","piezas":8}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('us-v1c', pg_temp.pid('us-v1'));
select operacion.marcar_empacado('us-v1e', pg_temp.pid('us-v1'));
select operacion.enviar_pedido('us-v1s', pg_temp.pid('us-v1'), null, '{"paqueteria":"Castores","numero":"US-1","costo_cent":18000,"pagada_por":"Javier"}'::jsonb, negocio.hoy());
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();

create function pg_temp.sabor(p text) returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = $1 and unificado_en is null $$;
create function pg_temp.sku(p_modelo text, p_sabor_id bigint) returns bigint language sql as $$ select k.id from catalogo.sku k where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = $1) and k.sabor_id = $2 and k.unificado_en is null $$;
-- Huella de todo lo inmutable y de las lecturas de dinero. md5 del contenido completo de cada tabla de solo insercion.
create function pg_temp.huella() returns jsonb language sql as $$
  select jsonb_build_object(
    'kardex', (select md5(string_agg(to_jsonb(m)::text, '|' order by m.id)) from operacion.movimiento_inventario m),
    'kardex_n', (select count(*) from operacion.movimiento_inventario),
    'existencia_sku', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.sku_id, e.ubicacion)) from operacion.existencia_sku_ubicacion e),
    'existencia_modelo', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.modelo_id)) from operacion.existencia_modelo e),
    'pedido_linea', (select md5(string_agg(to_jsonb(l)::text, '|' order by l.id)) from operacion.pedido_linea l),
    'surtido', (select md5(string_agg(to_jsonb(s)::text, '|' order by s.id)) from operacion.pedido_surtido s),
    'eventos', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) from operacion.evento e),
    'asientos', (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from contabilidad.asiento a),
    'asientos_n', (select count(*) from contabilidad.asiento),
    'cadena', contabilidad.verificar_cadena(),
    'c1310', contabilidad.saldo('1310'),
    'comprobaciones', (select jsonb_agg(jsonb_build_object('c', c.codigo, 'ok', c.ok, 'a', c.via_a_cent, 'b', c.via_b_cent) order by c.codigo) from contabilidad.comprobaciones() c),
    'libro_conciliado', operacion.cuadre_socios() ->> 'libro_conciliado',
    'concilia', api.inventario_concilia() ->> 'concilia');
$$;
create function pg_temp.rojas() returns text language sql as $$ select string_agg(c.codigo, ',' order by c.codigo) from contabilidad.comprobaciones() c where not c.ok and c.bloqueante $$;
create function pg_temp.catalogo_estado() returns text language sql as $$
  select md5(coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from catalogo.sabor s), '') || coalesce((select string_agg(to_jsonb(k)::text, '|' order by k.id) from catalogo.sku k), '') || coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from catalogo.sabor_alias a), ''))
$$;

select is(pg_temp.rojas(), null, 'antes: ninguna comprobacion bloqueante en rojo');
select is((select count(*)::int from operacion.pedido where estado <> 'enviado'), 0, 'todos los pedidos estan enviados (como en produccion)');
create temp table _antes as select pg_temp.huella() as h, pg_temp.catalogo_estado() as ce;
grant all on _antes to public;

-- (1) Deteccion en la base ----------------------------------------------------------------------------------------------------------------------
select is(catalogo.comparar_nombres('sabor', 'Passionfruit', 'Passion Fruit') ->> 'clase', 'IGUAL_NORMALIZADO', 'Passionfruit = Passion Fruit: IGUAL_NORMALIZADO');
select is(catalogo.comparar_nombres('sabor', 'Lychee', 'Lychee Burst') ->> 'clase', 'POSIBLE', 'Lychee vs Lychee Burst: POSIBLE, nunca IGUAL');
select is(catalogo.comparar_nombres('sabor', 'Lychee', 'Lychee Ice') ->> 'clase', 'POSIBLE', 'Lychee vs Lychee Ice: POSIBLE');
select is(catalogo.comparar_nombres('sabor', 'Peach Blue Razz', 'Peach Blue Raspberry') ->> 'ambiguo', 'true', 'razz = raspberry: AMBIGUO, no se asume');
select is(catalogo.comparar_nombres('sabor', 'Grape Strawberry', 'Grape Straw') ->> 'clase', 'MUY_PROBABLE', 'abreviatura straw: MUY_PROBABLE');
select is(catalogo.comparar_nombres('sabor', 'Cool Mint', 'Fresh Mint') ->> 'clase', 'DISTINTO', 'sabores distintos: DISTINTO');
select is(catalogo.comparar_nombres('modelo', 'Waka Blade', 'wakablade') ->> 'clase', 'IGUAL_NORMALIZADO', 'el motor sirve para modelos');
select is(catalogo.comparar_nombres('cliente', 'Alex Perez', 'Alex') ->> 'clase', 'POSIBLE', 'clientes: Alex vs Alex Perez es POSIBLE (se pregunta; la union de clientes es fase posterior)');

-- (2) Nada se unifica solo --------------------------------------------------------------------------------------------------------------------
select throws_ok(format($q$select catalogo.unificar_sabor('us-x1', %s, %s, 'web')$q$, pg_temp.sabor('Passionfruit'), pg_temp.sabor('Passion Fruit')), '42501', null, 'sin pregunta ni aprobacion explicita: se rechaza');
select throws_ok(format($q$select catalogo.unificar_sabor('us-x2', %s, %s, 'web', null, null, 'clave-inventada')$q$, pg_temp.sabor('Passionfruit'), pg_temp.sabor('Passion Fruit')), '42501', null, 'una clave inventada no aprueba nada');
select throws_ok(format($q$select catalogo.unificar_sabor('us-x3', %s, %s, 'web', null, null, 'dueno-2026-11-14-passion-fruit')$q$, pg_temp.sabor('Passion Fruit'), pg_temp.sabor('Passionfruit')), '42501', null, 'la clave aprobada solo vale en el sentido aprobado (origen y destino)');
select is((select count(*)::int from catalogo.sabor where unificado_en is not null), 0, 'nada se unifico');

-- Escaneo: deja preguntas, no unifica.
select ok((api.duplicados_escanear('sabor') ->> 'preguntas_nuevas')::int >= 2, 'el escaneo deja preguntas pendientes');
select is((select count(*)::int from catalogo.sabor where unificado_en is not null), 0, 'el escaneo no unifica');
select is((select clase from catalogo.posible_duplicado where tipo = 'sabor' and id_a = least(pg_temp.sabor('Passionfruit'), pg_temp.sabor('Passion Fruit')) and id_b = greatest(pg_temp.sabor('Passionfruit'), pg_temp.sabor('Passion Fruit'))), 'IGUAL_NORMALIZADO', 'la pregunta de Passionfruit quedo como IGUAL_NORMALIZADO');
select is((api.duplicados_escanear('sabor') ->> 'preguntas_nuevas')::int, 0, 'el escaneo es idempotente');
select ok((select jsonb_array_length(api.duplicados_pendientes('sabor'))) >= 2, 'la web lista las preguntas pendientes');
select is(api.duplicados_pendientes('sabor') -> 0 ->> 'clase', 'IGUAL_NORMALIZADO', 'la primera pregunta es de las IGUAL_NORMALIZADO');
select ok((select bool_or(x ->> 'pregunta' = '¿"Passionfruit" es lo mismo que "Passion Fruit"?') from jsonb_array_elements(api.duplicados_pendientes('sabor')) x), 'texto de la pregunta');

-- (3) Bloqueo: el sku origen con existencia no se fusiona --------------------------------------------------------------------------------------------------
create function pg_temp.q(p_a text, p_b text) returns bigint language sql as $$
  select id from catalogo.posible_duplicado where tipo = 'sabor' and id_a = least(pg_temp.sabor($1), pg_temp.sabor($2)) and id_b = greatest(pg_temp.sabor($1), pg_temp.sabor($2)) $$;
select is(api.duplicado_responder('us-r0', pg_temp.q('Kiwi Dragonfruit', 'Kiwi Dragon Fruit'), 'si', pg_temp.sabor('Kiwi Dragon Fruit')) ->> 'estado', 'bloqueado', 'US Bloq: el origen tiene existencia -> bloqueado');
select is(api.duplicado_responder('us-r0', pg_temp.q('Kiwi Dragonfruit', 'Kiwi Dragon Fruit'), 'si', pg_temp.sabor('Kiwi Dragon Fruit')) -> 'bloqueos' -> 0 -> 'motivos' ->> 0, 'tiene existencia', 'dice el motivo');
select is(pg_temp.catalogo_estado(), (select ce from _antes), 'el bloqueo no escribio nada en el catalogo');
select is((select estado from catalogo.posible_duplicado where id = pg_temp.q('Kiwi Dragonfruit', 'Kiwi Dragon Fruit')), 'pendiente', 'la pregunta sigue pendiente');

-- (4) Unificacion con respuesta de un socio: Passionfruit -> Passion Fruit (US Blade: fusion; US Icon: reasignacion) ----------------------------------------------------
create temp table _ids as select pg_temp.q('Passionfruit', 'Passion Fruit') as q, pg_temp.sabor('Passion Fruit') as dest, pg_temp.sabor('Passionfruit') as orig;
grant all on _ids to public;
select is(api.duplicado_responder('us-r1', (select q from _ids), 'si', (select dest from _ids)) ->> 'estado', 'unificado', 'el socio dice que si: se unifica');
select is((api.duplicado_responder('us-r1', (select q from _ids), 'si', (select dest from _ids)) ->> 'repetido')::boolean, true, 'idempotente por clave');
select is((select (u.detalle -> 0 ->> 'accion') || ',' || (u.detalle -> 1 ->> 'accion') from catalogo.unificacion_sabor u order by id desc limit 1), 'fusionado,reasignado', 'US Blade fusiona sku; US Icon reasigna');
select is(pg_temp.huella(), (select h from _antes), 'IGUAL antes y despues: kardex, existencias, pedidos, surtidos, eventos, asientos, cadena de hash, 1310 y C1..C24');
select is(pg_temp.rojas(), null, 'despues: ninguna comprobacion bloqueante en rojo');
select is((select unificado_en from catalogo.sabor where nombre_original = 'Passionfruit'), pg_temp.sabor('Passion Fruit'), 'el sabor origen queda unificado en el canonico');
select is((select nombre_canonico from catalogo.sabor where nombre_original = 'Passionfruit'), 'Passion Fruit', 'y muestra el nombre canonico en cualquier lectura');
select is((select alias_norm from catalogo.sabor_alias where sabor_id = pg_temp.sabor('Passion Fruit')), 'passionfruit', 'el nombre viejo queda como alias');
select is((select activo from catalogo.sku where id = (select u.detalle -> 0 ->> 'sku_id' from catalogo.unificacion_sabor u order by id desc limit 1)::bigint), false, 'el sku fusionado queda inactivo');
select is((select count(*)::int from catalogo.sku k where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'US Icon') and k.sabor_id = pg_temp.sabor('Passion Fruit')), 1, 'US Icon: el sku se reasigno al sabor canonico (mismo sku_id)');
select is((select count(*)::int from operacion.movimiento_inventario m join catalogo.sku k on k.id = m.sku_id join catalogo.sabor s on s.id = k.sabor_id where s.nombre_canonico = 'Passion Fruit'), (select count(*)::int from operacion.movimiento_inventario m join catalogo.sku k on k.id = m.sku_id where k.modelo_id in (select id from catalogo.modelo where nombre_canonico in ('US Blade', 'US Icon')) and k.sabor_id in (select id from catalogo.sabor where nombre_canonico = 'Passion Fruit')), 'las lecturas por nombre agrupan todo el historial bajo un solo nombre (kardex de ambos sku)');
select is((select count(distinct s.nombre_canonico)::int from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'US Blade') and s.nombre_canonico ilike 'passion%'), 1, 'en US Blade solo existe un nombre de sabor');
select is((select jsonb_array_length(api.conteo_hoja('bodega_omar')) from (select 1) x), (select count(*)::int from catalogo.sku k where k.unificado_en is null and exists (select 1 from operacion.existencia_sku_ubicacion u join catalogo.sku k2 on k2.id = u.sku_id where u.ubicacion = 'bodega_omar' and k2.modelo_id = k.modelo_id)), 'la hoja de conteo no ofrece el sku fusionado');
select is((operacion.resolver_sku('{"modelo":"US Blade","sabor":"Passionfruit"}'::jsonb) ->> 'sku_id')::bigint, pg_temp.sku('US Blade', pg_temp.sabor('Passion Fruit')), 'el nombre viejo ya no abre un sabor duplicado en lecturas por nombre: resuelve por alias al sku canonico (parche a12_003)');
select is(catalogo.asegurar_sabor('Passionfruit'), pg_temp.sabor('Passion Fruit'), 'asegurar_sabor con el nombre viejo resuelve al canonico (no recrea el duplicado)');
select is((select count(*)::int from catalogo.sabor where nombre_original is null and nombre_norm = 'passionfruit'), 0, 'no se recreo Passionfruit');
select is(api.conteo_agregar_sabor('us-a0', (select id from catalogo.modelo where nombre_canonico = 'US Blade'), 'passionfruit') ->> 'estado', 'existente', 'el alta con el nombre viejo devuelve el sku canonico existente');
select is(api.duplicado_responder('us-r1b', (select q from _ids), 'si') ->> 'estado', 'ya_contestada', 'contestar otra vez con otra clave: ya contestada');
select is((select estado from catalogo.posible_duplicado where unificacion_id is not null), 'unido', 'la pregunta quedo unida');
select is(jsonb_array_length(api.sabor_unificaciones(5)), 1, 'la web lista la unificacion para poder deshacerla');
select ok(not (select jsonb_path_exists(api.duplicados_pendientes('sabor'), '$[*] ? (@.a.nombre == "Passion Fruit" && @.b.nombre == "Passion Fruit")')), 'los pares con sabores unificados ya no se preguntan');

-- (5) Reversa ------------------------------------------------------------------------------------------------------------------------------------
select is(api.sabor_unificacion_deshacer('us-d1', (select max(id) from catalogo.unificacion_sabor)) ->> 'estado', 'deshecha', 'deshacer');
select is(pg_temp.catalogo_estado(), (select ce from _antes), 'tras deshacer, el catalogo es identico al de antes (sabores, sku, alias)');
select is(pg_temp.huella(), (select h from _antes), 'y lo inmutable sigue identico');
select is((select estado from catalogo.posible_duplicado where id = pg_temp.q('Passionfruit', 'Passion Fruit')), 'pendiente', 'la pregunta vuelve a quedar pendiente');
select is(api.sabor_unificacion_deshacer('us-d1', (select max(id) from catalogo.unificacion_sabor)) ->> 'repetido', 'true', 'deshacer es idempotente');
select is(api.sabor_unificacion_deshacer('us-d2', (select max(id) from catalogo.unificacion_sabor)) ->> 'estado', 'ya_deshecha', 'y otra clave: ya deshecha');

-- (6) El par aprobado por el dueno por CLAVE explicita (sin pregunta); y con nombre final elegido ---------------------------------------------------------------------------
select is(catalogo.unificar_sabor('us-ap1', pg_temp.sabor('Passionfruit'), pg_temp.sabor('Passion Fruit'), 'importacion', null, null, 'dueno-2026-11-14-passion-fruit') ->> 'estado', 'unificado', 'la clave aprobada unifica sin pregunta');
select is(pg_temp.huella(), (select h from _antes), 'identico otra vez');
select is(catalogo.unificar_sabor('us-ap2', (select orig from _ids), (select dest from _ids), 'importacion', null, null, 'dueno-2026-11-14-passion-fruit') ->> 'estado', 'ya_unificado', 'segunda corrida con otra clave: ya unificado (idempotente)');
select is((select aprobacion from catalogo.unificacion_sabor order by id desc limit 1), 'clave:dueno-2026-11-14-passion-fruit', 'la aprobacion queda registrada');
select is((select count(*)::int from seguridad.auditoria where tabla = 'catalogo.sabor' and accion = 'UNIFICACION'), 2, 'auditoria de cada unificacion');
select ok(seguridad.verificar_cadena_auditoria(), 'la cadena de auditoria sigue valida');

-- (7) NEGATIVO: "no, son distintos" ---------------------------------------------------------------------------------------------------------------------
select is(api.duplicado_responder('us-n2', pg_temp.q('Kiwi Dragonfruit', 'Kiwi Dragon Fruit'), 'no') ->> 'estado', 'distinto', 'no son lo mismo: se guarda el negativo');
select is((api.duplicados_escanear('sabor') ->> 'preguntas_nuevas')::int, 0, 'un par con negativo no se vuelve a preguntar (ni en un escaneo nuevo)');
select ok(not (select coalesce(bool_or(x ->> 'id' = pg_temp.q('Kiwi Dragonfruit', 'Kiwi Dragon Fruit')::text), false) from jsonb_array_elements(api.duplicados_pendientes('sabor')) x), 'ni aparece en pendientes');
select is(api.duplicado_responder('us-n3', pg_temp.q('Kiwi Dragonfruit', 'Kiwi Dragon Fruit'), 'si') ->> 'estado', 'ya_contestada', 'y un si posterior no lo revierte solo');
select is((select negativo from catalogo.candidatos_duplicado('sabor', 'Kiwi Dragonfruit', pg_temp.sabor('Kiwi Dragonfruit'), 50) where nombre = 'Kiwi Dragon Fruit'), true, 'los candidatos marcan el negativo');

-- (8) Alta de sabor consulta la deteccion antes de crear --------------------------------------------------------------------------------------------------
select is(api.conteo_agregar_sabor('us-b1', (select id from catalogo.modelo where nombre_canonico = 'US Icon'), 'Mangoo') ->> 'estado', 'parecidos', 'Mangoo se parece a Mango (una letra): MUY_PROBABLE, NO crea');
select is(api.conteo_agregar_sabor('us-b1', (select id from catalogo.modelo where nombre_canonico = 'US Icon'), 'Mangoo') ->> 'pregunta', '¿"Mangoo" es lo mismo que "Mango"?', 'devuelve la pregunta');
select is((select count(*)::int from catalogo.sabor where nombre_norm = 'mangoo'), 0, 'no se creo nada');
select is(api.conteo_agregar_sabor('us-b2', (select id from catalogo.modelo where nombre_canonico = 'US Icon'), 'Mango Burst') ->> 'estado', 'creado', 'POSIBLE (Mango Burst empieza como Mango): crea');
select is((api.conteo_agregar_sabor('us-b2', (select id from catalogo.modelo where nombre_canonico = 'US Icon'), 'Mango Burst') ->> 'preguntas_pendientes')::int, 1, '... y deja la pregunta pendiente');
select is((select count(*)::int from catalogo.posible_duplicado where estado = 'pendiente' and tipo = 'sabor' and (id_a = pg_temp.sabor('Mango Burst') or id_b = pg_temp.sabor('Mango Burst'))), 1, 'la pregunta esta en la cola');
select is(api.conteo_agregar_sabor('us-b3', (select id from catalogo.modelo where nombre_canonico = 'US Icon'), 'Mangoo', true) ->> 'estado', 'creado', 'el socio confirma que es distinto: se crea');
select is((select estado from catalogo.posible_duplicado where tipo = 'sabor' and (id_a = pg_temp.sabor('Mangoo') or id_b = pg_temp.sabor('Mangoo')) and (id_a = pg_temp.sabor('Mango') or id_b = pg_temp.sabor('Mango'))), 'distinto', '... y queda el NEGATIVO');
select is(api.conteo_agregar_sabor('us-b4', (select id from catalogo.modelo where nombre_canonico = 'US Icon'), 'Zarza Rara') ->> 'estado', 'creado', 'sin parecido: crea sin preguntas');
select is((select count(*)::int from catalogo.posible_duplicado where id_a = pg_temp.sabor('Zarza Rara') or id_b = pg_temp.sabor('Zarza Rara')), 0, 'y no deja preguntas');

-- (9) Permisos ----------------------------------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'api.duplicados_pendientes(text)', 'execute') and not has_function_privilege('anon', 'api.duplicado_responder(text,bigint,text,bigint,text)', 'execute'), 'anon sin EXECUTE');
select ok(not has_function_privilege('authenticated', 'catalogo.unificar_sabor(text,bigint,bigint,text,text,bigint,text)', 'execute'), 'el nucleo de la unificacion no se expone');
select ok(not has_table_privilege('authenticated', 'catalogo.posible_duplicado', 'select') and not has_table_privilege('authenticated', 'catalogo.unificacion_sabor', 'select'), 'las tablas nuevas no se leen directo');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-8888888888a2', true);
select throws_ok($$select api.duplicados_pendientes()$$, '42501', null, 'Omar no ve las preguntas');
select throws_ok($$select api.duplicado_responder('us-o1', 1, 'no')$$, '42501', null, 'Omar no responde');
select throws_ok($$select api.sabor_unificacion_deshacer('us-o2', 1)$$, '42501', null, 'Omar no deshace');
select throws_ok($$select api.duplicados_escanear()$$, '42501', null, 'Omar no escanea');
select * from finish();
rollback;
