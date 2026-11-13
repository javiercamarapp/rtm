-- pgTAP puente del efectivo / 2 (migracion 20261112400100): todos los flujos que mueven 1101 en el libro tambien mueven el libro de efectivo, de modo que el efectivo de la empresa
-- y las cajas por persona cuadran con el libro (C23 y C24), y la identidad de la cascada (suma de saldos de los socios = efectivo repartido) parte del efectivo del libro.
-- Los esperados son aritmetica escrita a mano en cada seccion (saldos iniciales, depositos, cobros, pagos, reversas), no salen del codigo. Dentro de una transaccion los
-- disparadores diferidos no corren: `asentar_pendientes()` hace lo del COMMIT.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f28.angelo@example.test', 'socio', 'Angelo', true), ('f28.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a2800000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f28.angelo@example.test'),
  ('a2800000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f28.javier@example.test');
select set_config('request.jwt.claim.sub', 'a2800000-0000-0000-0000-000000000001', true);

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'a2800000-0000-0000-0000-000000000001' else 'a2800000-0000-0000-0000-000000000002' end, true); end $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
-- Debe y haber de una cuenta en el asiento de un evento y con una dimension de socio (null = sin dimension).
create function pg_temp.debe(p_clave text, p_cuenta text, p_socio text default null) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id
      where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 and l.socio_id is not distinct from (select id from catalogo.socio where nombre = $3) $$;
create function pg_temp.haber(p_clave text, p_cuenta text, p_socio text default null) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id
      where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 and l.socio_id is not distinct from (select id from catalogo.socio where nombre = $3) $$;
create function pg_temp.c(p_codigo text) returns table (ok boolean, a bigint, b bigint) language sql as $$ select c.ok, c.via_a_cent, c.via_b_cent from contabilidad.comprobaciones() c where c.codigo = $1 $$;
-- Operativo y libro de una caja (por su nombre de cuenta de efectivo).
create function pg_temp.oper(p_caja text) returns bigint language sql as $$ select e.operativo_cent from contabilidad.efectivo_por_caja() e where e.caja = $1 $$;
create function pg_temp.libro(p_caja text) returns bigint language sql as $$ select e.libro_cent from contabilidad.efectivo_por_caja() e where e.caja = $1 $$;

select catalogo.asegurar_cliente('F28 Cliente', 'Angelo');
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'F28 Cliente' $$;

-- Punto de partida ----------------------------------------------------------------------------------------------------------------------------------
select ok((select ok from pg_temp.c('C23')), 'C23 sin movimientos: cero contra cero');
select ok((select ok from pg_temp.c('C24')), 'C24 sin movimientos: cero contra cero');
select is((select count(*)::int from contabilidad.efectivo_por_caja()), 3, 'tres cajas: la de la empresa y la de cada socio');

-- Saldos iniciales: caja de la empresa 10,000.00, Angelo 2,000.00, Javier 500.00 ------------------------------------------------------------------
select operacion.registrar_movimiento_efectivo('f28-si1', 'Caja de la empresa', 'saldo_inicial', 1000000, 'apertura');
select operacion.registrar_movimiento_efectivo('f28-si2', 'Efectivo de Angelo', 'saldo_inicial', 200000, 'apertura');
select operacion.registrar_movimiento_efectivo('f28-si3', 'Efectivo de Javier', 'saldo_inicial', 50000, 'apertura');
select is(pg_temp.flush(), 3, 'los tres saldos iniciales generan asiento');
select is((select a from pg_temp.c('C23')), 1250000::bigint, 'C23 via A: 12,500.00 de efectivo operativo');
select is((select b from pg_temp.c('C23')), 1250000::bigint, 'C23 via B: 12,500.00 en 1101');
select ok((select ok from pg_temp.c('C24')), 'C24 cuadra tras los saldos iniciales');
select is(pg_temp.libro('Efectivo de Angelo'), 200000::bigint, 'la caja de Angelo es la dimension Angelo de 1101: 2,000.00');
select is(pg_temp.libro('Efectivo de Javier'), 50000::bigint, 'la de Javier: 500.00');
select is(pg_temp.libro('Caja de la empresa'), 1000000::bigint, 'la caja de la empresa no lleva dimension: 10,000.00');

-- Depositos: la dimension de 1101 es la caja que recibe, no quien deposita -------------------------------------------------------------------------
select operacion.registrar_aportacion('f28-d1', 'Javier', 100000, 'Deposito de Javier en la caja de Angelo', 'reembolso', null, null, 'Efectivo de Angelo');
select operacion.registrar_aportacion('f28-d2', 'Angelo', 300000, 'Deposito de Angelo en la caja de la empresa', 'capital');
select is(pg_temp.flush(), 2, 'los dos depositos generan asiento');
select is(pg_temp.debe('f28-d1', '1101', 'Angelo'), 100000::bigint, 'Javier deposita en la caja de Angelo: 1101 con Angelo como custodio');
select is(pg_temp.debe('f28-d1', '1101', 'Javier'), 0::bigint, 'y no queda con la dimension de quien deposito');
select is(pg_temp.haber('f28-d1', '2320', 'Javier'), 100000::bigint, 'el reembolso por pagar sigue siendo de Javier (2320)');
select is(pg_temp.debe('f28-d2', '1101'), 300000::bigint, 'Angelo deposita en la caja de la empresa: 1101 sin dimension');
select is(pg_temp.haber('f28-d2', '3110', 'Angelo'), 300000::bigint, 'y su capital (3110) conserva a Angelo');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran tras los depositos');

-- Cobro de un cliente en efectivo (entra a la caja de los cobros) y su anulacion ---------------------------------------------------------------------
select is((select valor #>> '{}' from catalogo.config where clave = 'puente_efectivo_caja_cobros'), 'Caja de la empresa', 'el parametro de la caja de cobros existe y vale la caja de la empresa');
select operacion.registrar_pago('f28-c1', 'Efectivo', 500000, pg_temp.cid(), null, true, 'abono', negocio.hoy());
select is(operacion.saldo_efectivo(operacion.cuenta_efectivo_id('Caja de la empresa')), 1000000::bigint + 300000 + 500000, 'el cobro en efectivo entra a la caja de la empresa: 18,000.00');
select is(pg_temp.flush(), 1, 'el cobro genera su asiento');
select is(pg_temp.debe('f28-c1', '1101'), 500000::bigint, 'asiento del cobro: 1101 sin dimension de socio');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran con el cobro');
select operacion.anular_pago('f28-c1x', (select id from operacion.pago where folio = (select folio from operacion.pago order by id desc limit 1)), 'cobro capturado dos veces');
select is(operacion.saldo_efectivo(operacion.cuenta_efectivo_id('Caja de la empresa')), 1300000::bigint, 'anular el cobro devuelve la caja a 13,000.00');
select pg_temp.flush();
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran tras anular el cobro');
select operacion.registrar_pago('f28-c2', 'Efectivo', 80000, pg_temp.cid(), null, true, 'abono', negocio.hoy());
-- Un pago por transferencia a la cuenta personal de un socio NO es efectivo de caja (son fondos en su poder): no toca el libro de efectivo.
select operacion.registrar_pago('f28-c3', 'Javier', 90000, pg_temp.cid(), null, true, 'abono', negocio.hoy());
select is((select count(*)::int from operacion.cuenta_efectivo_mov where evento_id = pg_temp.ev('f28-c3')), 0, 'un cobro a la cuenta personal de un socio no crea movimiento de efectivo');

-- Pagos de la sociedad a proveedores y su reversa -------------------------------------------------------------------------------------------------
select operacion.registrar_pago_proveedor_sociedad('f28-p1', 'Isaac', 150000);
select operacion.registrar_pago_proveedor_sociedad('f28-p2', 'Karen', 70000);
select is(pg_temp.flush(), 4, 'dos cobros, dos pagos a proveedores asientan');
select is(pg_temp.haber('f28-p1', '1101'), 150000::bigint, 'pago a Isaac: abono a 1101');
select operacion.anular_movimiento_proveedor('f28-p1x', (select id from operacion.cuenta_proveedor_mov where evento_id = pg_temp.ev('f28-p1')), 'se pago al proveedor equivocado');
select pg_temp.flush();
select is(pg_temp.debe('f28-p1x', '1101'), 150000::bigint, 'deshacer el pago a Isaac regresa 1,500.00 a 1101');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran con los pagos a proveedores');

-- Pago de Omar en efectivo, entrega de un socio, gasto de la empresa, reembolso, traspaso y conteo ---------------------------------------------------
select operacion.registrar_pago_omar('f28-o1', 20000, 'de_omar', null, 'efectivo');
select operacion.registrar_entrega_socio('f28-e1', 'Javier', 30000, 'sociedad', null, 'general');
select operacion.registrar_gasto_empresa('f28-g1', 40000, 'papeleria');
select operacion.registrar_pago_a_socio('f28-r1', 'Javier', 60000, 'reembolso');
select operacion.registrar_movimiento_efectivo('f28-t1', 'Caja de la empresa', 'traspaso', 25000, 'a la caja de Javier', null, 'Efectivo de Javier');
select operacion.registrar_movimiento_efectivo('f28-a1', 'Efectivo de Angelo', 'ajuste_conteo', -5000, 'faltante de conteo');
select pg_temp.flush();
select is(pg_temp.debe('f28-o1', '1101'), 20000::bigint, 'pago de Omar en efectivo: cargo a 1101 de la empresa');
select is(pg_temp.debe('f28-e1', '1101'), 30000::bigint, 'la entrega de Javier cae en la caja de la empresa: 1101 sin dimension (no con Javier)');
select is(pg_temp.debe('f28-e1', '1101', 'Javier'), 0::bigint, 'y no se queda con la dimension de quien entrega');
select is(pg_temp.haber('f28-g1', '1101'), 40000::bigint, 'gasto de la empresa: abono a 1101');
select is(pg_temp.haber('f28-r1', '1101'), 60000::bigint, 'reembolso a un socio: abono a 1101 de la empresa');

-- Cuadre final: saldos esperados a mano --------------------------------------------------------------------------------------------------------------
-- Caja de la empresa: 10,000 + 3,000 (deposito de Angelo) + 800 (cobro vigente) - 700 (Karen) + 200 (Omar) + 300 (entrega) - 400 (gasto) - 600 (reembolso) - 250 (traspaso) = 12,350.00
-- Efectivo de Angelo: 2,000 + 1,000 (deposito de Javier) - 50 (faltante) = 2,950.00;  Efectivo de Javier: 500 + 250 (traspaso) = 750.00;  total 16,050.00
select is(pg_temp.oper('Caja de la empresa'), 1235000::bigint, 'caja de la empresa operativa: 12,350.00');
select is(pg_temp.libro('Caja de la empresa'), 1235000::bigint, 'caja de la empresa en el libro: 12,350.00');
select is(pg_temp.oper('Efectivo de Angelo'), 295000::bigint, 'caja de Angelo operativa: 2,950.00');
select is(pg_temp.libro('Efectivo de Angelo'), 295000::bigint, 'caja de Angelo en el libro: 2,950.00');
select is(pg_temp.oper('Efectivo de Javier'), 75000::bigint, 'caja de Javier operativa: 750.00');
select is(pg_temp.libro('Efectivo de Javier'), 75000::bigint, 'caja de Javier en el libro: 750.00');
select is((select a from pg_temp.c('C23')), 1605000::bigint, 'C23 via A: 16,050.00');
select is((select b from pg_temp.c('C23')), 1605000::bigint, 'C23 via B: 16,050.00');
select ok((select ok from pg_temp.c('C23')), 'C23 cuadra');
select is((select a from pg_temp.c('C24')), 0::bigint, 'C24: ninguna caja con diferencia');
select ok((select ok from pg_temp.c('C24')), 'C24 cuadra');
select is((select count(*)::int from contabilidad.efectivo_por_caja() where diferencia_cent <> 0), 0, 'ninguna caja con diferencia contra el libro');
select is((operacion.efectivo_sociedad()->>'cuentas_total_cent')::bigint, 1605000::bigint, 'el efectivo de la sociedad (cuentas) es el mismo de C23: 16,050.00');
select is((select bloqueante from contabilidad.comprobaciones() where codigo = 'C24'), false, 'C24 avisa y no bloquea');
select ok((select bool_and(ok) from contabilidad.comprobaciones() where bloqueante), 'ninguna comprobacion bloqueante falla');
select is(contabilidad.verificar_cadena(), null, 'la cadena de hash del libro sigue integra');

-- Mutaciones: un renglon de efectivo sin asiento, o un asiento a 1101 sin renglon de efectivo, pone C23 y C24 en rojo ----------------------------------
savepoint m1;
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  values (operacion.cuenta_efectivo_id('Efectivo de Javier'), negocio.hoy(), 'ajuste_conteo', 7000, 'mutacion', pg_temp.ev('f28-si1'));
select is((select a from pg_temp.c('C24')), 7000::bigint, 'mutacion: C24 senala la diferencia de la caja de Javier');
select ok(not (select ok from pg_temp.c('C23')), 'mutacion: C23 se pone en rojo');
select is((select diferencia_cent from contabilidad.efectivo_por_caja() where caja = 'Efectivo de Javier'), 7000::bigint, 'la diferencia aparece en la caja correcta');
rollback to savepoint m1;
select ok((select ok from pg_temp.c('C24')), 'sin la mutacion C24 vuelve a cuadrar');
savepoint m2;
select operacion.crear_evento('asiento_manual', negocio.hoy(), 'f28-m2', jsonb_build_object('motivo', 'mutacion', 'lineas', jsonb_build_array(
  jsonb_build_object('cuenta', '1101', 'debe_cent', 9000), jsonb_build_object('cuenta', '3990', 'haber_cent', 9000))));
select pg_temp.flush();
select is((select a from pg_temp.c('C24')), 9000::bigint, 'mutacion: un asiento a 1101 sin efectivo operativo lo senala C24 (dimension de la empresa)');
select is((select socio_id from contabilidad.efectivo_por_caja() where diferencia_cent <> 0), null::bigint, 'y la diferencia cae en la caja de la empresa');
rollback to savepoint m2;

-- Identidad de la cascada: el efectivo que reparte es el del libro y la suma de saldos de los socios es el efectivo repartido ---------------------------
select pg_temp.como('Javier');
create temp table _c as select operacion.cascada_periodo(negocio.hoy(), negocio.hoy()) as c;
select is((select (c->'efectivo'->>'caja_cent')::bigint from _c), 1605000::bigint, 'la cascada parte del efectivo de las cajas: 16,050.00, igual a C23');
select is((select (c->'efectivo'->>'caja_cent')::bigint from _c), (select b from pg_temp.c('C23')), 'y ese efectivo es el de 1101 y 1102 del libro');
select is((select (c->'efectivo_detalle'->>'cuentas_total_cent')::bigint from _c), 1605000::bigint, 'el detalle de efectivo de la sociedad coincide');
select ok((select (c->>'identidad_cuadra')::boolean from _c), 'la identidad cuadra por dos vias');
select is((select (c->'identidad'->>'via1_cent')::bigint from _c), (select (c->'identidad'->>'efectivo_repartido_cent')::bigint from _c), 'via 1: lo asignado a los socios es el efectivo repartido');
select is((select (c->'identidad'->>'via2_cent')::bigint from _c), (select (c->'identidad'->>'efectivo_repartido_cent')::bigint from _c), 'via 2: saldos de los socios mas fondos en su poder y deuda no efectiva es el efectivo repartido');
select is((select (c->>'suma_resultados_cent')::bigint + (c->'efectivo'->>'en_poder_cent')::bigint + (c->'identidad'->>'deuda_no_efectivo_cent')::bigint from _c),
          (select (c->'identidad'->>'efectivo_repartido_cent')::bigint from _c), 'suma de saldos de los socios + en su poder + deuda no efectiva = efectivo repartido');
select is((select (c->>'remanente_cent')::bigint from _c), (select (c->'efectivo'->>'total_cent')::bigint - (c->'identidad'->>'efectivo_repartido_cent')::bigint from _c), 'lo no repartido es el remanente: nada se pierde ni se inventa');

select * from finish();
rollback;
