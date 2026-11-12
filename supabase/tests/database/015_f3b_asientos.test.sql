-- pgTAP F3b: contabilidad de partida doble. Los esperados salen de los documentos 02, 10b y 18 (compra inicial de 1,536 piezas, costo promedio
-- 9,154.6224 centavos, puente de 12 piezas igual a 1,098.55 asignado a Angelo; ejemplo E1 a E4 de la paridad con el Excel), no del codigo.
-- Dentro de una transaccion los triggers diferidos nunca disparan: `contabilidad.asentar_pendientes()` hace lo mismo que el COMMIT.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3b.asientos@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('73333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3b.asientos@example.test');
select set_config('request.jwt.claim.sub', '73333333-3333-3333-3333-333333333333', true);

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
-- Lineas de un evento por folio de operacion guardada (clave de idempotencia): [{cuenta, debe, haber}] ya con las sumas.
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.debe(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.haber(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.cuadra(p_clave text) returns boolean language sql as
  $$ select coalesce(sum(l.debe_cent) = sum(l.haber_cent), false) from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) $$;
create function pg_temp.ok(p_codigo text) returns boolean language sql as $$ select ok from contabilidad.comprobaciones() where codigo = $1 $$;

-- Plan de cuentas completo (paridad con el Excel y costos del sistema) ----------------------------------------------------------------------------
select is((select count(*)::int from contabilidad.cuenta where codigo in ('3210', '3220', '3310', '3320', '3900', '1101', '1102', '4120', '5110', '1150', '1160', '2310', '2320', '1340', '6250', '3990')), 16,
  'el plan trae las cuentas que exige la paridad con el Excel y la de mantenimiento del sistema');
select is((select nombre from contabilidad.cuenta where codigo = '6250'), 'Costos de mantenimiento del sistema', 'cuenta de costos de mantenimiento del sistema');
select is((select count(*)::int from contabilidad.cuenta where codigo !~ '^[0-9]{4}$'), 0, 'todos los codigos son de cuatro digitos');

-- Datos de la prueba -----------------------------------------------------------------------------------------------------------------------------
select catalogo.asegurar_cliente('F3B Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('F3B Omar Persona', 'F3B Omar Persona');
select catalogo.asegurar_cliente('F3B Cliente', 'Javier');
select catalogo.asegurar_modelo('F3B Marca', 'F3B Nexa 50K', 50000, 'ambas');
select catalogo.asegurar_modelo('F3B Marca', 'F3B Doc18 A', 50000, 'ambas');
select catalogo.asegurar_modelo('F3B Marca', 'F3B Doc18 B', 15000, 'ambas');
select catalogo.asegurar_sku('F3B Nexa 50K', 'S' || g) from generate_series(1, 10) g;
select catalogo.asegurar_sku('F3B Doc18 A', 'Sin sabor');
select catalogo.asegurar_sku('F3B Doc18 B', 'Sin sabor');
select catalogo.fijar_costo('f3c1', 'Isaac', 'F3B Nexa 50K', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f3c2', 'Isaac', 'F3B Doc18 A', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f3c3', 'Isaac', 'F3B Doc18 B', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('f3r1', 'F3B Cliente', 'F3B Doc18 A', 15000, '2026-11-01', 'chat');
select pg_temp.flush();

-- Escenario A: la compra inicial (1,552 pagadas, 1,536 facturadas, 1,524 contadas) ----------------------------------------------------------------
select operacion.crear_compra('f3n1', 'Isaac', '[{"modelo":"F3B Nexa 50K","sabor":"S1","pagadas":1552,"facturadas":1536}]'::jsonb, 237500, 0, negocio.hoy(), 'bodega', 'sociedad', null, 'Angelo');
select operacion.confirmar_compra('f3n1c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3n1')));
select pg_temp.flush();
select is(pg_temp.debe('f3n1c', '1320'), 14061500::bigint, 'confirmar: la mercancia en transito entra por 140,615.00 (138,240.00 mas la guia de 2,375.00)');
select is(pg_temp.debe('f3n1c', '3110'), 144000::bigint, 'confirmar: los $1,440.00 pagados de mas salen del capital de Angelo (quedan fuera de la sociedad)');
select is(pg_temp.haber('f3n1c', '2110'), 14205500::bigint, 'confirmar: Isaac se acredita por la orden y por lo pagado de mas');
select ok(pg_temp.cuadra('f3n1c'), 'el asiento de confirmar cuadra');

select operacion.pago_proveedor_de_socio('f3p1', 'Isaac', 5600000, 'Javier', 'aportacion');
select operacion.pago_proveedor_de_socio('f3p2', 'Isaac', 8368000, 'Angelo', 'aportacion');
select pg_temp.flush();
select is(pg_temp.haber('f3p1', '3120'), 5600000::bigint, 'Javier paga 56,000.00 a Isaac: aportacion de capital');
select is(pg_temp.debe('f3p1', '2110'), 5600000::bigint, 'y baja lo que se debe a Isaac');
select is(pg_temp.haber('f3p2', '3110'), 8368000::bigint, 'Angelo paga 83,680.00 a Isaac: aportacion de capital');

select operacion.marcar_llego_merida('f3n1m', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3n1')));
select is((operacion.recibir_compra('f3n1r', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3n1')), (
  select jsonb_agg(jsonb_build_object('linea_id', (select cl.id from operacion.compra_linea cl where cl.compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3n1'))),
         'sabor', 'S' || n, 'piezas', c)) from unnest(array[175,192,200,200,166,28,100,159,133,171]) with ordinality t(c, n)), now())->>'piezas_recibidas')::int, 1524, 'recepcion: 1,524 piezas');
select pg_temp.flush();
select is(pg_temp.debe('f3n1r', '1310'), 13951645::bigint, 'recibir: el inventario entra por 139,516.45 (140,615.00 menos 1,098.55)');
select is(pg_temp.debe('f3n1r', '1340'), 109855::bigint, 'recibir: 12 piezas x 9,154.6224 = 1,098.55 al puente de diferencias');
select is(pg_temp.haber('f3n1r', '1320'), 14061500::bigint, 'recibir: sale de la mercancia en transito el costo puesto completo');
select is(round(14061500::numeric / 1536, 4), 9154.6224::numeric, 'costo promedio de la compra inicial: 9,154.6224 centavos por pieza');
select ok(pg_temp.cuadra('f3n1r'), 'el asiento de recibir cuadra');

select operacion.asignar_diferencia('f3n1a', (select id from operacion.compra_diferencia order by id desc limit 1), 'socio', 'Angelo', 'prueba');
select pg_temp.flush();
select is(pg_temp.debe('f3n1a', '1170'), 109855::bigint, 'el faltante asignado a Angelo es una cuenta por cobrar de 1,098.55');
select is(pg_temp.haber('f3n1a', '1340'), 109855::bigint, 'y saca el monto del puente');
select is(contabilidad.saldo('1340') - (select 0), operacion.saldo_puente(), 'el puente del libro coincide con el puente operativo');

-- Cada cuenta de control coincide con su auxiliar operativo ---------------------------------------------------------------------------------------
select is((select count(*)::int from contabilidad.reproducir_saldos() where not ok), 0, 'reproducir_saldos: todos los auxiliares coinciden con el libro tras la compra inicial');
select ok(pg_temp.ok('C3'), 'C3 balanza');
select ok(pg_temp.ok('C4'), 'C4 auxiliares contra control');
select ok(pg_temp.ok('C5'), 'C5 inventario contra kardex');
select ok(pg_temp.ok('C10'), 'C10 asientos cuadrados');
select ok(pg_temp.ok('C19'), 'C19 compras con diferencia');

-- Escenario B: el ejemplo E1 a E4 del documento 18 ------------------------------------------------------------------------------------------------
create temp table _base as select contabilidad.valuacion() as v;
create function pg_temp.d(p_clave text) returns bigint language sql as $$ select coalesce(((contabilidad.valuacion())->>$1)::bigint, 0) - coalesce(((select v from _base)->>$1)::bigint, 0) $$;

select operacion.crear_compra('f3b1', 'Isaac', '[{"modelo":"F3B Doc18 A","sabor":"Sin sabor","pagadas":1536}]'::jsonb, 237500);
select operacion.confirmar_compra('f3b1c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b1')));
select operacion.pago_proveedor_de_socio('f3b1pa', 'Isaac', 8461500, 'Angelo', 'aportacion');
select operacion.pago_proveedor_de_socio('f3b1pj', 'Isaac', 5600000, 'Javier', 'aportacion');
select operacion.marcar_llego_merida('f3b1m', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b1')));
select operacion.recibir_compra('f3b1r', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b1')),
  (select jsonb_build_array(jsonb_build_object('linea_id', cl.id, 'sabor', 'Sin sabor', 'piezas', 1536)) from operacion.compra_linea cl where cl.compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b1'))), now());
select pg_temp.flush();
select is(pg_temp.debe('f3b1r', '1310'), 14061500::bigint, 'E1: Dr 1310 140,615.00');
select is(pg_temp.haber('f3b1pa', '3110'), 8461500::bigint, 'E1: Cr 3110 84,615.00');
select is(pg_temp.haber('f3b1pj', '3120'), 5600000::bigint, 'E1: Cr 3120 56,000.00');

select operacion.crear_compra('f3b4', 'Isaac', '[{"modelo":"F3B Doc18 B","sabor":"Sin sabor","pagadas":200}]'::jsonb);
select operacion.confirmar_compra('f3b4c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b4')));
select operacion.marcar_llego_merida('f3b4m', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b4')));
select operacion.recibir_compra('f3b4r', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b4')),
  (select jsonb_build_array(jsonb_build_object('linea_id', cl.id, 'sabor', 'Sin sabor', 'piezas', 200)) from operacion.compra_linea cl where cl.compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3b4'))), now());
select pg_temp.flush();
select is(pg_temp.debe('f3b4r', '1310'), 2000000::bigint, 'E4: Dr 1310 20,000.00 (200 pz a 100.00, a pagar el viernes)');

select operacion.crear_pedido('f3b2', (select id from catalogo.cliente where nombre_canonico = 'F3B Cliente'), '[{"modelo":"F3B Doc18 A","sabor":"Sin sabor","piezas":100}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('f3b2c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3b2'));
select operacion.enviar_pedido('f3b2e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3b2'), null, null, negocio.hoy());
select pg_temp.flush();
select is(pg_temp.debe('f3b2e', '1210'), 1500000::bigint, 'E2: Dr 1210 15,000.00');
select is(pg_temp.haber('f3b2e', '4110'), 1500000::bigint, 'E2: Cr 4110 15,000.00');
select is(pg_temp.debe('f3b2e', '5100'), 915462::bigint, 'E2: costo de ventas 9,154.62 (14,061,500 x 100 / 1,536)');
select is(pg_temp.haber('f3b2e', '1310'), 915462::bigint, 'E2: Cr 1310 al costo promedio');
select is(pg_temp.debe('f3b2e', '6110'), 20000::bigint, 'E2: Dr 6110 renta de bodega 200.00 (100 pz x 2.00)');
select is(pg_temp.haber('f3b2e', '2210'), 20000::bigint, 'E2: Cr 2210 renta por pagar a Omar');
select ok(pg_temp.cuadra('f3b2e'), 'el asiento de la venta cuadra');

select operacion.registrar_pago('f3b3', 'Angelo', 600000, (select id from catalogo.cliente where nombre_canonico = 'F3B Cliente'));
select pg_temp.flush();
select is(pg_temp.debe('f3b3', '1150'), 600000::bigint, 'E3: Dr 1150 6,000.00 (el cobro cae en la cuenta de Angelo)');
select is(pg_temp.haber('f3b3', '1210'), 600000::bigint, 'E3: Cr 1210 6,000.00');
select is(pg_temp.debe('f3b3', '2410') - pg_temp.haber('f3b3', '2410'), 0::bigint, 'E3: el cobro entra a 2410 y se aplica de inmediato al pedido: sin rastro neto en 2410');

select is(pg_temp.d('v01_valuacion_cent'), 16646038::bigint, 'GU-3: valuacion 166,460.38');
select is(pg_temp.d('v02_deudas_cent'), 2020000::bigint, 'GU-3: deudas 20,200.00');
select is(pg_temp.d('v03_diferencia_cent'), 14626038::bigint, 'GU-3: diferencia 146,260.38');
select is(pg_temp.d('v04_utilidad_empresa_cent'), 564538::bigint, 'GU-3: utilidad de la empresa 5,645.38');
select is(pg_temp.d('v06_capital_aportado_cent'), 14061500::bigint, 'GU-3: capital aportado 140,615.00');
select is(pg_temp.d('v05_utilidades_retenidas_cent'), 0::bigint, 'GU-3: utilidades retenidas 0.00');
select is(pg_temp.d('l01_liquidez_cent'), 600000::bigint, 'GU-6: liquidez 6,000.00');
select ok((contabilidad.valuacion()->'identidades'->'i1'->>'cuadra')::boolean, 'GU-3: identidad I-1 cuadra al centavo');
select ok((contabilidad.valuacion()->'identidades'->'i2'->>'cuadra')::boolean, 'GU-3: identidad I-2 cuadra al centavo');
select is(((contabilidad.balance_general(negocio.hoy()))->>'diferencia_cent')::bigint, 0::bigint, 'v_balance: activo igual a pasivo mas capital');

select operacion.registrar_pago_a_socio('f3b5', 'Angelo', 300000, 'retiro');
select pg_temp.flush();
select is(pg_temp.debe('f3b5', '3210'), 300000::bigint, 'GU-4: el retiro de 3,000.00 va a 3210 (contra capital)');
select is(pg_temp.d('v04_utilidad_empresa_cent'), 564538::bigint, 'GU-4: la utilidad no cambia con el retiro (no es perdida)');
select is(pg_temp.d('v03_diferencia_cent'), 14326038::bigint, 'GU-4: la diferencia baja 3,000.00');
select is(pg_temp.d('l01_liquidez_cent'), 300000::bigint, 'GU-4: la liquidez baja 3,000.00 (queda 3,000.00)');

-- Estados ---------------------------------------------------------------------------------------------------------------------------------------
select is(((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy()))->>'utilidad_neta_cent')::bigint, 564538::bigint, 'estado de resultados: utilidad neta del dia 5,645.38 (con las pruebas anteriores sin ventas)');
select is(((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy()))->>'utilidad_bruta_cent')::bigint, 584538::bigint, 'utilidad bruta 5,845.38 (38.97 %): antes de la renta de Omar');
select is(((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy()))->>'utilidad_contribucion_cent')::bigint, 564538::bigint, 'utilidad de contribucion 5,645.38');
select ok(((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy()))->'comprobacion'->>'cuadra')::boolean, 'estado de resultados: las dos vias coinciden');
select ok(((contabilidad.flujo_efectivo(negocio.hoy(), negocio.hoy()))->'comprobacion'->>'cuadra')::boolean, 'flujo de efectivo: directo, indirecto y saldos coinciden');
select is(((contabilidad.flujo_efectivo(negocio.hoy(), negocio.hoy()))->>'variacion_cent')::bigint, 300000::bigint, 'flujo: la caja de la sociedad subio 6,000.00 y bajo 3,000.00');

-- Explicar un saldo movimiento por movimiento ------------------------------------------------------------------------------------------------------
select ok((api.explicar_cifra('conta:saldo:1310')->'comprobacion'->>'cuadra')::boolean, 'explicar 1310: la suma de lo guardado iguala lo recalculado desde los hechos');
select ok(jsonb_array_length(api.explicar_cifra('conta:saldo:1310')->'renglones') >= 3, 'explicar 1310: trae los movimientos con su asiento');
select ok((api.explicar_cifra('conta:v03')->'comprobacion'->>'cuadra')::boolean, 'explicar V03 por la identidad contable');

-- Un asiento reproducible y verificable -----------------------------------------------------------------------------------------------------------
select ok((contabilidad.verificar_asiento((select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b2e')))->'cuadra'->>'ok')::boolean, 'verificar: el asiento cuadra');
select ok((contabilidad.verificar_asiento((select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b2e')))->'determinismo'->>'ok')::boolean, 'verificar: recalcular las lineas del evento reproduce lo guardado');
select ok((contabilidad.verificar_asiento((select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b2e')))->'cadena'->>'ok')::boolean, 'verificar: el hash corresponde al contenido');
select ok((contabilidad.verificar_asiento((select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b2e')))->'saldos'->>'ok')::boolean, 'verificar: los saldos coinciden con los auxiliares');
select is(contabilidad.verificar_cadena(), null::bigint, 'la cadena de hash esta integra');

-- Anular un pedido enviado: el libro y los auxiliares vuelven juntos --------------------------------------------------------------------------------
select operacion.anular_pedido('f3b2x', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3b2'), 'prueba');
select pg_temp.flush();
select is(pg_temp.haber('f3b2x', '1210'), 900000::bigint, 'anular: se cancela lo que quedaba por cobrar (15,000.00 menos los 6,000.00 cobrados)');
select is(pg_temp.haber('f3b2x', '5100') + pg_temp.debe('f3b2x', '5100'), 915462::bigint, 'anular: el costo vuelve al inventario');
select is(pg_temp.debe('f3b2x', '2210'), 20000::bigint, 'anular: se revierte la renta de bodega');
select is(pg_temp.haber('f3b2x', '2410'), 600000::bigint, 'anular: el cobro queda como saldo a favor del cliente');
select is((select count(*)::int from contabilidad.reproducir_saldos() where not ok), 0, 'despues de anular, todos los auxiliares siguen coincidiendo');

-- Inmutabilidad ------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$update contabilidad.asiento_linea set nota = 'x' where asiento_id = (select min(id) from contabilidad.asiento)$$, '42501', null, 'UPDATE sobre una linea falla');
select throws_ok($$delete from contabilidad.asiento where id = (select min(id) from contabilidad.asiento)$$, '42501', null, 'DELETE sobre un asiento falla');
select throws_ok($t$do $b$ begin set constraints all immediate; insert into contabilidad.asiento_linea (asiento_id, n, cuenta, debe_cent, haber_cent) values ((select max(id) from contabilidad.asiento), 99, '1101', 100, 0); end $b$$t$,
  'P0430', null, 'una linea suelta descuadra el asiento (el trigger de cuadre corre al COMMIT; aqui se fuerza)');

-- Asientos manuales, reversas y periodos -------------------------------------------------------------------------------------------------------------
select throws_ok($$select contabilidad.registrar_asiento_manual('f3m0', '2026-10-05', 'prueba', '[{"cuenta":"1101","debe_cent":100},{"cuenta":"3990","haber_cent":90}]'::jsonb)$$, 'P0430', null, 'un asiento manual descuadrado se rechaza');
select throws_ok($$select contabilidad.registrar_asiento_manual('f3m0b', '2026-10-05', '', '[{"cuenta":"1101","debe_cent":100},{"cuenta":"3990","haber_cent":100}]'::jsonb)$$, '23502', null, 'el asiento manual exige motivo');
select throws_ok($$select contabilidad.registrar_asiento_manual('f3m1a', '2026-10-05', 'apertura por fuera de la firma', '[{"cuenta":"1101","debe_cent":100},{"cuenta":"3990","haber_cent":100}]'::jsonb, true)$$, 'P0428', null, 'un asiento manual no se puede marcar como apertura: solo la firma de los dos socios lo hace');
select lives_ok($$select contabilidad.registrar_asiento_manual('f3m1', '2026-10-05', 'ajuste de prueba', '[{"cuenta":"1101","debe_cent":100},{"cuenta":"3990","haber_cent":100}]'::jsonb)$$, 'asiento manual');
select pg_temp.flush();
select ok(not (select es_apertura from contabilidad.asiento where evento_id = pg_temp.ev('f3m1')), 'no queda marcado como apertura');
select is(pg_temp.debe('f3m1', '1101'), 100::bigint, 'el manual registra sus lineas');
select lives_ok($$select contabilidad.reversar_asiento('f3m1x', (select id from contabilidad.asiento where evento_id = pg_temp.ev('f3m1')), 'se capturo por error')$$, 'la reversa de un manual');
select pg_temp.flush();
select is(pg_temp.haber('f3m1x', '1101'), 100::bigint, 'la reversa invierte los lados');
select is((select reversa_de from contabilidad.asiento where evento_id = pg_temp.ev('f3m1x')), (select id from contabilidad.asiento where evento_id = pg_temp.ev('f3m1')), 'enlazada con el original');
select throws_ok($$select contabilidad.reversar_asiento('f3m1y', (select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b2e')), 'no')$$, 'P0428', null, 'un asiento de negocio no se reversa: se anula la operacion');

create temp table _per as select contabilidad.asegurar_periodo('semana', '2026-10-05') as id;
select throws_ok($$select contabilidad.aprobar_periodo('f3pa0', (select id from _per))$$, 'P0428', null, 'no se aprueba un periodo que no esta preparado');
select throws_ok($$select contabilidad.preparar_periodo('f3pp0', contabilidad.asegurar_periodo('semana', negocio.hoy()))$$, 'P0428', null, 'no se prepara un periodo que no ha terminado');
select is((contabilidad.preparar_periodo('f3pp1', (select id from _per))->>'estado'), 'preparado', 'preparar: corre las comprobaciones y deja el periodo preparado');
select ok((select count(*) from contabilidad.comprobacion where periodo_id = (select id from _per)) >= 22, 'la corrida de comprobaciones queda guardada (22 o mas)');
select is((contabilidad.aprobar_periodo('f3pa1', (select id from _per))->>'estado'), 'aprobado', 'aprobar: periodo aprobado');
select ok((select hash_cabecera is not null from contabilidad.periodo where id = (select id from _per)), 'el periodo aprobado guarda el hash de cabecera del libro');
select lives_ok($$select contabilidad.registrar_asiento_manual('f3m2', '2026-10-06', 'llega tarde', '[{"cuenta":"1101","debe_cent":50},{"cuenta":"3990","haber_cent":50}]'::jsonb)$$, 'un asiento con fecha de un periodo aprobado');
select pg_temp.flush();
select is((select periodo_afectado_id from contabilidad.asiento where evento_id = pg_temp.ev('f3m2')), (select id from _per), 'se registra en el periodo abierto con marca de periodo afectado');
select isnt((select periodo_semana_id from contabilidad.asiento where evento_id = pg_temp.ev('f3m2')), (select id from _per), 'y no dentro del periodo aprobado');
select ok(pg_temp.ok('C11'), 'C11 periodo cerrado sin asientos nuevos');

-- El reporte de un periodo aprobado no cambia cuando llega un asiento tardio de ingresos: la fecha contable cae en el primer periodo abierto.
create temp table _antes as select contabilidad.estado_resultados('2026-10-05', '2026-10-11') as er, contabilidad.balance_general('2026-10-11') as bg;
select lives_ok($$select contabilidad.registrar_asiento_manual('f3m3', '2026-10-06', 'venta tardia de prueba', '[{"cuenta":"1101","debe_cent":700},{"cuenta":"4110","haber_cent":700}]'::jsonb)$$, 'asiento tardio de ingresos con fecha de un periodo aprobado');
select pg_temp.flush();
select is(contabilidad.estado_resultados('2026-10-05', '2026-10-11'), (select er from _antes), 'el estado de resultados del periodo aprobado no cambia con el asiento tardio');
select is(contabilidad.balance_general('2026-10-11'), (select bg from _antes), 'el balance al cierre del periodo aprobado no cambia con el asiento tardio');
select is((select fecha_contable from contabilidad.asiento where evento_id = pg_temp.ev('f3m3')), '2026-10-12'::date, 'la fecha contable del asiento tardio es el inicio del primer periodo abierto');
select is(((contabilidad.estado_resultados('2026-10-12', '2026-10-18'))->>'ventas_brutas_cent')::bigint, 700::bigint, 'el ingreso tardio aparece en el periodo abierto');
select is(((contabilidad.estado_resultados('2026-10-12', '2026-10-18'))->>'ajustes_periodos_anteriores_cent')::bigint, 700::bigint, 'y se informa como ajuste de periodos anteriores');

-- Estado de resultados con envio cobrado, descuentos, costo y gastos variables y fijos (asientos manuales en una semana propia).
select lives_ok($$select contabilidad.registrar_asiento_manual('f3er1', '2026-09-08', 'caso de estado de resultados',
  '[{"cuenta":"1101","debe_cent":3430},{"cuenta":"4210","debe_cent":500},{"cuenta":"5100","debe_cent":6000},{"cuenta":"6110","debe_cent":200},{"cuenta":"6210","debe_cent":300},
    {"cuenta":"4110","haber_cent":10000},{"cuenta":"4300","haber_cent":430}]'::jsonb)$$, 'asiento de estado de resultados');
select pg_temp.flush();
create temp table _er as select contabilidad.estado_resultados('2026-09-07', '2026-09-13') as j;
select is((select (j->>'ventas_netas_cent')::bigint from _er), 9500::bigint, 'ventas netas = 10,000 menos descuento de 500');
select is((select (j->>'ingresos_operativos_cent')::bigint from _er), 9930::bigint, 'ingresos operativos incluyen el envio cobrado de 430');
select is((select (j->>'utilidad_bruta_cent')::bigint from _er), 3930::bigint, 'utilidad bruta = ingresos operativos (con envio) menos costo de 6,000');
select is((select (j->>'utilidad_contribucion_cent')::bigint from _er), 3730::bigint, 'contribucion = bruta menos gastos variables de 200');
select is((select (j->>'utilidad_neta_cent')::bigint from _er), 3430::bigint, 'utilidad neta = contribucion menos gastos fijos de 300');
select ok((select (j->'comprobacion'->>'cuadra')::boolean from _er), 'las dos vias del estado coinciden con envio, descuento y gastos');
select throws_ok($$update contabilidad.periodo set estado = 'preparado' where id = (select id from _per)$$, 'P0431', null, 'un periodo aprobado no vuelve atras por UPDATE directo');
select is((contabilidad.publicar_periodo('f3pu1', (select id from _per))->>'estado'), 'publicado', 'publicar');
select throws_ok($$select contabilidad.reabrir_periodo('f3pr0', (select id from _per), ' ')$$, '23502', null, 'reabrir exige motivo');
select is((contabilidad.reabrir_periodo('f3pr1', (select id from _per), 'faltaba una guia')->>'estado'), 'abierto', 'reabrir con motivo');
select is((select count(*)::int from contabilidad.reapertura where periodo_id = (select id from _per)), 1, 'la reapertura queda registrada');

-- Manipulacion directa: la cadena senala exactamente el asiento alterado -----------------------------------------------------------------------------
select pg_temp.flush();
set constraints all immediate;
set constraints all deferred;
alter table contabilidad.asiento_linea disable trigger asiento_linea_t1;
update contabilidad.asiento_linea set nota = 'manipulada' where asiento_id = (select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b3')) and cuenta = '1150';
alter table contabilidad.asiento_linea enable trigger asiento_linea_t1;
select is(contabilidad.verificar_cadena(), (select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b3')), 'GU-9: verificar_cadena devuelve exactamente el asiento manipulado');
select ok(not (contabilidad.verificar_asiento((select id from contabilidad.asiento where evento_id = pg_temp.ev('f3b3')))->'cadena'->>'ok')::boolean, 'verificar: el asiento alterado ya no verifica');

-- El asiento nace tambien cuando el hecho lo escribe la sesion del socio (rol authenticated, sin acceso directo al esquema de contabilidad) -----------
select pg_temp.flush();
set constraints all immediate;
set constraints all deferred;
set local role authenticated;
select lives_ok($$select api.registrar_aportacion('f3rol1', 'Angelo', 12345, 'prueba con el rol de la web', 'capital')$$, 'la web escribe una aportacion con su rol');
set constraints all immediate;
set constraints all deferred;
reset role;
select is(pg_temp.haber('f3rol1', '3110'), 12345::bigint, 'el asiento de lo que escribio la web se genero al cerrar la transaccion (triggers con permisos del propietario)');
select ok(pg_temp.cuadra('f3rol1'), 'y cuadra');
select set_config('request.jwt.claim.sub', '73333333-3333-3333-3333-333333333333', true);

-- Permisos ------------------------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select api.conta_diario()$$, '42501', null, 'sin sesion de socio no se lee el diario');
select throws_ok($$select api.conta_comprobaciones()$$, '42501', null, 'ni las comprobaciones');
select throws_ok($$select api.explicar_cifra('conta:saldo:1310')$$, '42501', null, 'ni se explica una cifra de contabilidad');

select * from finish();
rollback;
