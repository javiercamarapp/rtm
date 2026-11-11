-- pgTAP F3c: saldos de apertura. Cifras ilustrativas calculadas a mano antes del codigo (aportaciones 84,615.00 y 56,000.00 del caso dorado de la compra inicial,
-- el faltante de 12 piezas por 1,098.55 de Angelo y el saldo a favor de 30,500.00 con Karen de la adenda 23). Nada de esto son datos reales.
--   activo   = inventario 139,516.45 + faltante 1,098.55 + caja 500.00 + fondos 9,000.00 + por cobrar 7,500.00        = 157,615.00
--   pasivo   = reembolso 1,221.00 + Isaac 3,000.00 - saldo a favor con Karen 30,500.00                              = -26,279.00
--   capital  = aportaciones 140,615.00 + utilidad no repartida 2,000.00 - retiro previo 1,000.00                    = 141,615.00
--   puente   = 157,615.00 + 26,279.00 - 141,615.00                                                                  = 42,279.00
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3c.ang@example.test', 'socio', 'Angelo', true), ('f3c.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('76666666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3c.ang@example.test'),
  ('76666666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3c.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '76666666-6666-6666-6666-666666666661' else '76666666-6666-6666-6666-666666666662' end, true) $$;
select pg_temp.como('Angelo');
create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.bloq() returns bigint language sql as $$ select count(*) from contabilidad.comprobaciones() where not ok and bloqueante $$;
create function pg_temp.sku(p_modelo text, p_sabor text) returns bigint language sql as
  $$ select k.id from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor s on s.id = k.sabor_id where m.nombre_canonico = $1 and s.nombre_canonico = $2 $$;

select catalogo.asegurar_cliente('F3C Cliente Uno', 'Javier');
select catalogo.asegurar_modelo('F3C Marca', 'F3C Nexa 50K', 50000, 'ambas');
select catalogo.asegurar_sku('F3C Nexa 50K', 'Uno');
select catalogo.asegurar_sku('F3C Nexa 50K', 'Dos');
select catalogo.asegurar_sku('F3C Nexa 50K', 'Tres');

-- Estructura -------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from apertura.categoria), 11, 'once categorias de partida');
select is((select count(distinct paso)::int from apertura.categoria), 6, 'las categorias cubren los pasos 3 a 8');
select is(has_function_privilege('authenticated', 'apertura.firmar(text, bigint)', 'execute'), false, 'las funciones internas no se ejecutan desde la web');
select is(has_function_privilege('authenticated', 'api.apertura_firmar(text, bigint)', 'execute'), true, 'la API de apertura si');
select is(has_table_privilege('authenticated', 'apertura.partida', 'select'), false, 'las tablas de apertura no se leen desde la web');

-- Sesion ---------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ select api.apertura_crear('f3c:s0', negocio.hoy() + 3) $$, '23514', 'la fecha de corte no puede ser futura', 'una fecha de corte futura se rechaza');
select is((api.apertura_crear('f3c:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint is not null, true, 'se crea la sesion');
create temp table _s as select (id) from apertura.sesion;
select is((api.apertura_crear('f3c:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint, (select id from _s), 'la misma clave devuelve la misma sesion (idempotente)');
select throws_ok($$ select api.apertura_crear('f3c:s2', negocio.hoy() - 5) $$, 'P0441', 'ya hay una sesión de apertura vigente: revérsala antes de abrir otra', 'solo una sesion vigente');
select is(((api.apertura_estado() -> 'validacion') ->> 'listo_para_firma')::boolean, false, 'sin partidas no esta lista');
select is(((api.apertura_estado() -> 'validacion') ->> 'puente_cent')::bigint, 0::bigint, 'sin partidas la diferencia es cero');

-- Partidas -------------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.add(p_clave text, p_cat text, p jsonb) returns jsonb language sql as $$ select api.apertura_agregar($1, (select id from _s), $2, $3) $$;
select throws_ok($$ select pg_temp.add('f3c:p0', 'aportacion', '{"monto_cent": 100}') $$, '23502', 'la partida de aportación de capital de un socio necesita un socio (Angelo o Javier)', 'la aportacion exige socio');
select throws_ok($$ select pg_temp.add('f3c:p0b', 'aportacion', '{"socio": "Angelo", "monto_cent": 0}') $$, '23514', 'el monto debe ser mayor que cero', 'el monto debe ser positivo');
select throws_ok($$ select pg_temp.add('f3c:p0c', 'cxc', format('{"cliente_id": %s, "monto_cent": 100}', (select id from catalogo.cliente where nombre_canonico = 'F3C Cliente Uno'))::jsonb) $$, '23502', 'la cuenta por cobrar necesita la fecha del adeudo', 'la cuenta por cobrar exige fecha');
select throws_ok($$ select pg_temp.add('f3c:p0d', 'proveedor_debemos', '{"monto_cent": 100}') $$, '23502', 'la cuenta con proveedor necesita Isaac o Karen', 'la cuenta con proveedor exige proveedor');
select throws_ok($$ select pg_temp.add('f3c:p0e', 'inventario', '{"piezas": 5, "costo_unit_cent": 100}') $$, '23502', 'el inventario necesita un modelo y sabor del catálogo', 'el inventario exige sku');
select is((pg_temp.add('f3c:p1', 'aportacion', '{"socio": "Angelo", "monto_cent": 8461500}') ->> 'cuenta'), '3110', 'aportacion de Angelo a 3110');
select is((pg_temp.add('f3c:p2', 'aportacion', '{"socio": "Javier", "monto_cent": 5600000}') ->> 'cuenta'), '3120', 'aportacion de Javier a 3120');
select is((pg_temp.add('f3c:p3', 'reembolso_socio', '{"socio": "Javier", "monto_cent": 122100}') ->> 'cuenta'), '2320', 'reembolso pendiente de Javier a 2320');
select is((pg_temp.add('f3c:p4', 'inventario', format('{"sku_id": %s, "piezas": 500, "monto_cent": 4577311}', pg_temp.sku('F3C Nexa 50K', 'Uno'))::jsonb) ->> 'monto_cent')::bigint, 4577311::bigint, 'inventario: 500 piezas por su valor total (costo promedio con subcentavo)');
select throws_ok(format($$ select pg_temp.add('f3c:p4x', 'inventario', '{"sku_id": %s, "piezas": 10, "costo_unit_cent": 100, "monto_cent": 1005}'::jsonb) $$, pg_temp.sku('F3C Nexa 50K', 'Dos')), '23514', 'el valor total del inventario no coincide con piezas por costo unitario', 'monto y costo contradictorios se rechazan');
select pg_temp.add('f3c:p5', 'inventario', format('{"sku_id": %s, "piezas": 600, "monto_cent": 5492773}', pg_temp.sku('F3C Nexa 50K', 'Dos'))::jsonb);
select pg_temp.add('f3c:p6', 'inventario', format('{"sku_id": %s, "piezas": 424, "monto_cent": 3881561}', pg_temp.sku('F3C Nexa 50K', 'Tres'))::jsonb);
select is((select costo_unit_cent from apertura.partida where piezas = 500 and categoria = 'inventario' order by id desc limit 1), 9155::bigint, 'el costo por pieza queda como promedio redondeado');
select is((select sum(monto_cent)::bigint from apertura.partida where categoria = 'inventario' and sesion_id = (select id from _s)), 13951645::bigint, 'el inventario del caso dorado se carga al centavo: 139,516.45');
select throws_ok(format($$ select pg_temp.add('f3c:p6b', 'inventario', '{"sku_id": %s, "piezas": 1, "costo_unit_cent": 1}'::jsonb) $$, pg_temp.sku('F3C Nexa 50K', 'Tres')), '23505', null, 'un sabor no se carga dos veces');
select is((pg_temp.add('f3c:p7', 'deuda_faltante_socio', '{"socio": "Angelo", "piezas": 12, "monto_cent": 109855}') ->> 'cuenta'), '1170', 'las 12 piezas son deuda de Angelo en 1170');
select is((pg_temp.add('f3c:p8', 'caja', '{"socio": "Angelo", "monto_cent": 50000}') ->> 'cuenta'), '1101', 'caja en 1101 con la persona');
select is((pg_temp.add('f3c:p9', 'fondos_en_poder', '{"socio": "Javier", "monto_cent": 900000}') ->> 'cuenta'), '1160', 'fondos en poder de Javier a 1160');
select throws_ok(format($$ select pg_temp.add('f3c:p10x', 'cxc', '{"cliente_id": %s, "monto_cent": 750000, "fecha_ref": "%s"}'::jsonb) $$, (select id from catalogo.cliente where nombre_canonico = 'F3C Cliente Uno'), negocio.hoy()), '23514', 'la fecha del adeudo no puede ser posterior al corte', 'el adeudo no puede ser posterior al corte');
select is((pg_temp.add('f3c:p10', 'cxc', format('{"cliente_id": %s, "monto_cent": 750000, "fecha_ref": "%s"}', (select id from catalogo.cliente where nombre_canonico = 'F3C Cliente Uno'), negocio.hoy() - 15)::jsonb) ->> 'cuenta'), '1210', 'por cobrar a 1210');
select is((pg_temp.add('f3c:p11', 'proveedor_debemos', format('{"proveedor_id": %s, "monto_cent": 300000}', catalogo.proveedor_id('Isaac'))::jsonb) ->> 'cuenta'), '2110', 'lo que se debe a Isaac a 2110');
select is((pg_temp.add('f3c:p12', 'proveedor_a_favor', format('{"proveedor_id": %s, "monto_cent": 3050000}', catalogo.proveedor_id('Karen'))::jsonb) ->> 'cuenta'), '2120', 'saldo a favor con Karen a 2120');
select pg_temp.add('f3c:p13', 'utilidad_no_repartida', '{"socio": "Javier", "monto_cent": 200000}');
select pg_temp.add('f3c:p14', 'retiro_previo', '{"socio": "Angelo", "monto_cent": 100000}');
select is((pg_temp.add('f3c:p1', 'aportacion', '{"socio": "Angelo", "monto_cent": 8461500}') ->> 'cuenta'), '3110', 'repetir la misma clave no duplica la partida');
select is((select count(*)::int from apertura.partida), 14, 'catorce partidas');

-- Validacion: identidad contable y puente ---------------------------------------------------------------------------------------------------------
create function pg_temp.val() returns jsonb language sql as $$ select api.apertura_estado() -> 'validacion' $$;
select is((pg_temp.val() ->> 'activo_cent')::bigint, 15761500::bigint, 'activo 157,615.00');
select is((pg_temp.val() ->> 'pasivo_cent')::bigint, -2627900::bigint, 'pasivo -26,279.00 (el saldo a favor con Karen resta)');
select is((pg_temp.val() ->> 'capital_cent')::bigint, 14161500::bigint, 'capital 141,615.00');
select is((pg_temp.val() ->> 'puente_cent')::bigint, 4227900::bigint, 'la diferencia contra la identidad es 42,279.00');
select is((pg_temp.val() ->> 'identidad_cent')::bigint, 0::bigint, 'activo = pasivo + capital + puente');
select is((pg_temp.val() ->> 'listo_para_firma')::boolean, true, 'lista para firma con mantener la diferencia en 3990');
select is(jsonb_array_length(pg_temp.val() -> 'pasos'), 6, 'seis pasos con partidas');

-- Vista previa y ensayo: NO escriben ---------------------------------------------------------------------------------------------------------------
create temp table _antes as select (select count(*) from contabilidad.asiento) as asientos, (select count(*) from operacion.movimiento_inventario) as movs, (select count(*) from operacion.evento) as eventos,
  (select ultimo from seguridad.contador_folio where serie = 'A') as folio_a, (select count(*) from seguridad.operacion) as ops;
select is((api.apertura_vista_previa((select id from _s)) ->> 'cuadra')::boolean, true, 'la vista previa cuadra');
select is((api.apertura_vista_previa((select id from _s)) ->> 'haber_cent')::bigint, (api.apertura_vista_previa((select id from _s)) ->> 'debe_cent')::bigint, 'debe = haber en la vista previa');
select is((select (e ->> 'apertura_cent')::bigint from jsonb_array_elements(api.apertura_vista_previa((select id from _s)) -> 'efecto') e where e ->> 'cuenta' = '3990'), 4227900::bigint, 'la vista previa muestra el puente 3990');
create temp table _ens as select api.apertura_ensayo((select id from _s)) as r;
select is((select (r ->> 'puente_3990_cent')::bigint from _ens), 4227900::bigint, 'el ensayo deja el puente 3990 en la diferencia');
select is((select (r ->> 'bloqueantes_en_rojo')::int from _ens), 0, 'el ensayo no deja ninguna comprobacion bloqueante en rojo');
select is((select (r ->> 'inventario_1310_cent')::bigint from _ens), 13951645::bigint, 'el ensayo carga el inventario al libro');
select is((select (r ->> 'inventario_kardex_cent')::bigint from _ens), 13951645::bigint, 'y al kardex por el mismo valor');
select is((select (r ->> 'cadena_ok')::boolean from _ens), true, 'la cadena de hash queda sana');
select is((select count(*) from contabilidad.asiento), (select asientos from _antes), 'el ensayo no deja asientos');
select is((select count(*) from operacion.movimiento_inventario), (select movs from _antes), 'el ensayo no deja movimientos de inventario');
select is((select count(*) from operacion.evento), (select eventos from _antes), 'ni eventos');
select is((select ultimo from seguridad.contador_folio where serie = 'A'), (select folio_a from _antes), 'ni consume folios');
select is((select count(*) from seguridad.operacion), (select ops from _antes), 'ni claves de idempotencia');
select is((select estado from apertura.sesion), 'borrador', 'la sesion sigue en borrador');

-- Firma de los dos socios --------------------------------------------------------------------------------------------------------------------------
select is((api.apertura_firmar('f3c:f1', (select id from _s)) ->> 'firmas')::int, 1, 'firma de Angelo');
select is((select estado from apertura.sesion), 'en_firma', 'la sesion queda en firma');
select throws_ok($$ select pg_temp.add('f3c:p99', 'aportacion', '{"socio": "Angelo", "monto_cent": 1}') $$, 'P0440', 'la sesión de apertura está en firma o firmada: retira la firma para editar', 'con firma no se agregan partidas');
select throws_ok($$ select api.apertura_quitar('f3c:q1', (select min(id) from apertura.partida)) $$, 'P0440', null, 'ni se quitan');
select is((api.apertura_firmar('f3c:f1', (select id from _s)) ->> 'firmas')::int, 1, 'la misma clave no firma dos veces');
select is((api.apertura_firmar('f3c:f1b', (select id from _s)) ->> 'firmas')::int, 1, 'firmar otra vez con otra clave no cuenta como la segunda firma');
select is((api.apertura_retirar_firma('f3c:r1', (select id from _s)) ->> 'estado'), 'borrador', 'retirar la unica firma devuelve el borrador');
select is((api.apertura_firmar('f3c:f2', (select id from _s)) ->> 'firmas')::int, 1, 'se vuelve a firmar');
select pg_temp.como('Javier');
select is((api.apertura_firmar('f3c:f3', (select id from _s)) ->> 'publicada')::boolean, true, 'la firma de Javier publica la apertura');
select pg_temp.flush();
select is((select estado from apertura.sesion), 'firmada', 'sesion firmada');
select is((select count(*)::int from contabilidad.asiento where es_apertura), 1, 'un asiento de apertura');
select is((select count(*)::int from operacion.movimiento_inventario where tipo = 'apertura'), 3, 'tres movimientos de inventario de apertura');
select is((select piezas from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F3C Nexa 50K')), 1524, 'existencia de 1,524 piezas');
select is((select valor_cent from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F3C Nexa 50K')), 13951645::bigint, 'valor 139,516.45');
select is(contabilidad.saldo('1310'), 13951645::bigint, '1310 coincide con el kardex');
select is(contabilidad.saldo('3990'), 4227900::bigint, '3990 guarda la diferencia hasta resolverla');
select is(contabilidad.saldo('3110'), 8461500::bigint, '3110 trae la aportacion de Angelo');
select is(contabilidad.saldo('1170'), 109855::bigint, '1170 trae la deuda de Angelo por 12 piezas');
select is(contabilidad.saldo('1210'), 750000::bigint, '1210 trae lo por cobrar');
select is(contabilidad.saldo('2120'), -3050000::bigint, '2120 queda con saldo a favor (negativo)');
select is(pg_temp.bloq(), 0::bigint, 'ninguna comprobacion bloqueante en rojo con la apertura publicada');
select is((select ok from contabilidad.comprobaciones() where codigo = 'C20'), false, 'C20 (3990 = 0) avisa mientras la diferencia siga abierta');
select is(contabilidad.verificar_cadena(), null::bigint, 'la cadena de hash es sana');
select is((select count(*)::int from contabilidad.reproducir_saldos() where not ok), 0, 'todos los auxiliares cuadran contra el libro');
select is((select count(*)::int from apertura.firma where retirada_at is null), 2, 'dos firmas vigentes');
select is((select hash_firmado from apertura.sesion), (select hash from apertura.firma where retirada_at is null limit 1), 'las firmas y la sesion llevan la misma huella');
select throws_ok($$ select api.apertura_firmar('f3c:f9', (select id from _s)) $$, 'P0441', 'la sesión ya está firmada o reversada', 'una apertura firmada no se firma otra vez');

-- La apertura vive en la cuenta de socios y en el Mayor por dimension --------------------------------------------------------------------------------
select is((select sum(l.haber_cent - l.debe_cent)::bigint from contabilidad.asiento_linea l where l.cuenta = '3120' and l.socio_id = (select id from catalogo.socio where nombre = 'Javier')), 5600000::bigint, 'el Mayor conserva al socio como dimension');
select is((select count(*)::int from contabilidad.asiento_linea l where l.cuenta = '1210' and l.cliente_id is not null), 1, 'y al cliente');

-- Reversa ------------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$ select api.apertura_reversar('f3c:v0', (select id from _s), ' ') $$, '23502', 'la reversa exige motivo', 'la reversa exige motivo');
select is((api.apertura_reversar('f3c:v1', (select id from _s), 'prueba de reversa') ->> 'reversada')::boolean, true, 'se revierte la apertura');
select pg_temp.flush();
select is((select estado from apertura.sesion), 'reversada', 'sesion reversada');
select is(contabilidad.saldo('1310'), 0::bigint, '1310 vuelve a cero');
select is(contabilidad.saldo('3990'), 0::bigint, '3990 vuelve a cero');
select is(contabilidad.saldo('3110'), 0::bigint, '3110 vuelve a cero');
select is((select coalesce(sum(valor_cent), 0)::bigint from operacion.existencia_modelo), 0::bigint, 'el kardex vuelve a cero');
select is(pg_temp.bloq(), 0::bigint, 'sin comprobaciones bloqueantes tras la reversa');
select is((select count(*)::int from contabilidad.reproducir_saldos() where not ok), 0, 'los auxiliares siguen cuadrando tras la reversa');
select is(contabilidad.verificar_cadena(), null::bigint, 'cadena sana tras la reversa');
select is(contabilidad.apertura_saldo('3110'), 0::bigint, 'una apertura reversada no cuenta como auxiliar');

-- Descartar una sesion sin publicar -----------------------------------------------------------------------------------------------------------------
create temp table _sd as select (api.apertura_crear('f3c:d1', negocio.hoy()) ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('f3c:d2', (select id from _sd), 'caja', '{"socio": "Angelo", "monto_cent": 5000}');
select throws_ok($$ select api.apertura_descartar('f3c:d3', (select id from _sd), ' ') $$, '23502', 'descartar exige motivo', 'descartar exige motivo');
select is((api.apertura_descartar('f3c:d4', (select id from _sd), 'sesion de prueba') ->> 'descartada')::boolean, true, 'se descarta un borrador');
select is((select estado from apertura.sesion where id = (select id from _sd)), 'reversada', 'queda registrada como revertida');
select is((select count(*)::int from apertura.partida where sesion_id = (select id from _sd)), 1, 'y conserva sus partidas');
select throws_ok($$ select api.apertura_descartar('f3c:d5', (select id from _sd), 'otra vez') $$, 'P0441', null, 'no se descarta dos veces');
select is((select count(*)::int from contabilidad.asiento a where a.es_apertura and a.evento_id in (select evento_id from apertura.sesion where id = (select id from _sd))), 0, 'descartar no deja asientos');

-- Segunda sesion: la diferencia pasa al capital 50/50 con justificacion --------------------------------------------------------------------------
create temp table _s2 as select (api.apertura_crear('f3c:t1', negocio.hoy()) ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('f3c:t2', (select id from _s2), 'caja', '{"socio": "Angelo", "monto_cent": 100001}');
select api.apertura_agregar('f3c:t3', (select id from _s2), 'caja', '{"socio": "Javier", "monto_cent": 100000}');
select api.apertura_agregar('f3c:t4', (select id from _s2), 'inventario', format('{"sku_id": %s, "piezas": 10, "costo_unit_cent": 9000}', pg_temp.sku('F3C Nexa 50K', 'Uno'))::jsonb);
select api.apertura_agregar('f3c:t5', (select id from _s2), 'aportacion', '{"socio": "Angelo", "monto_cent": 100}');
select is(((api.apertura_estado((select id from _s2)) -> 'validacion') ->> 'puente_cent')::bigint, 289901::bigint, 'puente de la segunda sesion: 2,899.01');
select api.apertura_resolucion('f3c:t6', (select id from _s2), 'capital_50_50');
select is(((api.apertura_estado((select id from _s2)) -> 'validacion') ->> 'exige_justificacion')::boolean, true, 'una diferencia mayor a 0.5 % del activo exige justificacion');
select throws_ok($$ select api.apertura_firmar('f3c:t7', (select id from _s2)) $$, 'P0442', null, 'sin justificacion no se firma');
select api.apertura_resolucion('f3c:t8', (select id from _s2), 'capital_50_50', 'Diferencia explicada por el conteo inicial de la prueba');
select is((api.apertura_firmar('f3c:t9', (select id from _s2)) ->> 'firmas')::int, 1, 'firma Javier');
select pg_temp.como('Angelo');
select is((api.apertura_firmar('f3c:t10', (select id from _s2)) ->> 'publicada')::boolean, true, 'firma Angelo y publica');
select pg_temp.flush();
select is(contabilidad.saldo('3990'), 0::bigint, 'la diferencia resuelta deja 3990 en cero');
select is(contabilidad.saldo('3110'), 100 + 144951::bigint, 'Angelo recibe la mitad con el centavo impar (1,449.51) mas su aportacion');
select is(contabilidad.saldo('3120'), 144950::bigint, 'Javier recibe la otra mitad');
select is((select ok from contabilidad.comprobaciones() where codigo = 'C20'), true, 'C20 en verde con la diferencia resuelta');
select is(pg_temp.bloq(), 0::bigint, 'sin bloqueantes');
-- No se revierte si ya salio mercancia
select operacion.registrar_movimiento('f3c:sale', 'F3C Nexa 50K', 'Uno', 'bodega_omar', 'salida_pedido', -3, null, negocio.hoy());
select throws_ok($$ select api.apertura_reversar('f3c:v2', (select id from _s2), 'intento con mercancia vendida') $$, 'P0423', null, 'no se revierte una apertura cuya mercancia ya salio');

select * from finish();
rollback;
