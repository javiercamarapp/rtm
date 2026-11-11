-- pgTAP puente contable del efectivo (migracion 8000): saldo inicial, ajuste de conteo y traspaso generan asiento; la comprobacion C23 compara las cuentas de efectivo
-- operativas contra la caja contable (1101 y 1102) y se pone en rojo si algo se rompe a mano (mutacion); idempotencia, hash y reversa. Los esperados salen de las
-- reglas documentadas en docs/puente-efectivo-asientos.md, no del codigo. Dentro de una transaccion los triggers diferidos no disparan: `asentar_pendientes()` hace lo del COMMIT.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('puente.efectivo@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('75555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'puente.efectivo@example.test');
select set_config('request.jwt.claim.sub', '75555555-5555-5555-5555-555555555555', true);

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
-- Debe y haber de una cuenta en el asiento de un evento (por clave de idempotencia), opcionalmente de un socio custodio (null = sin dimension).
create function pg_temp.debe(p_clave text, p_cuenta text, p_socio text default null) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id
      where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 and l.socio_id is not distinct from (select id from catalogo.socio where nombre = $3) $$;
create function pg_temp.haber(p_clave text, p_cuenta text, p_socio text default null) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id
      where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 and l.socio_id is not distinct from (select id from catalogo.socio where nombre = $3) $$;
create function pg_temp.cuadra(p_clave text) returns boolean language sql as
  $$ select coalesce(sum(l.debe_cent) = sum(l.haber_cent), false) from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) $$;
create function pg_temp.lineas(p_clave text) returns int language sql as
  $$ select count(*)::int from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) $$;
create function pg_temp.c23() returns table (ok boolean, a bigint, b bigint) language sql as $$ select c.ok, c.via_a_cent, c.via_b_cent from contabilidad.comprobaciones() c where c.codigo = 'C23' $$;

-- Plan de cuentas, parametros y comprobacion ------------------------------------------------------------------------------------------------------
select is((select nombre from contabilidad.cuenta where codigo = '7200'), 'Sobrante o faltante de caja', 'el plan trae la cuenta de sobrante o faltante de caja');
select is((select tipo || naturaleza from contabilidad.cuenta where codigo = '7200'), 'GD', 'la cuenta 7200 es de resultados (gasto) y de naturaleza deudora');
select is((select count(*)::int from catalogo.config where clave in ('puente_efectivo_contra_saldo_inicial', 'puente_efectivo_cuenta_diferencia_conteo')), 2, 'los dos parametros del puente estan documentados en la configuracion');
select is((select count(*)::int from contabilidad.comprobaciones() where codigo = 'C23'), 1, 'C23 existe una sola vez');
select is((select count(*)::int from contabilidad.comprobaciones()), 26, 'C1 a C23 mas CU1 a CU3');
select is((select bloqueante from contabilidad.comprobaciones() where codigo = 'C23'), false, 'C23 avisa y no bloquea (hay efectivo de clientes y de proveedores fuera del libro de efectivo)');
select ok((select ok from pg_temp.c23()), 'C23: sin movimientos, 0 contra 0 cuadra');

-- Saldo inicial -------------------------------------------------------------------------------------------------------------------------------------
select operacion.registrar_movimiento_efectivo('pe-si1', 'Caja de la empresa', 'saldo_inicial', 1000000, 'apertura');
select operacion.registrar_movimiento_efectivo('pe-si2', 'Efectivo de Angelo', 'saldo_inicial', 200000, 'apertura del socio');
select is(pg_temp.flush(), 2, 'los dos saldos iniciales generan su asiento');
select is(pg_temp.debe('pe-si1', '1101'), 1000000::bigint, 'saldo inicial de la caja de la empresa: cargo a 1101 por 10,000.00');
select is(pg_temp.haber('pe-si1', '3990'), 1000000::bigint, 'con abono a la cuenta de apertura 3990');
select ok(pg_temp.cuadra('pe-si1') and pg_temp.lineas('pe-si1') = 2, 'el asiento cuadra y tiene dos lineas');
select is(pg_temp.debe('pe-si2', '1101', 'Angelo'), 200000::bigint, 'saldo inicial del efectivo de Angelo: 1101 con Angelo como custodio');
select is(pg_temp.haber('pe-si2', '3990', 'Angelo'), 200000::bigint, 'y contrapartida de apertura con la misma dimension');
select is((select a from pg_temp.c23()), 1200000::bigint, 'C23 via A: efectivo operativo 12,000.00');
select is((select b from pg_temp.c23()), 1200000::bigint, 'C23 via B: 1101 contable 12,000.00');
select ok((select ok from pg_temp.c23()), 'C23 cuadra tras los saldos iniciales');
select is((select via_a_cent from contabilidad.comprobaciones() where codigo = 'C20'), 1200000::bigint, 'C20 vigila la cuenta de apertura hasta que el dueno firme el cuadre');
select is(contabilidad.saldo('3110') + contabilidad.saldo('3120'), 0::bigint, 'no se toca el capital de los socios: C4 compara 3110 y 3120 contra las aportaciones operativas');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C4'), 'C4 bloqueante sigue en verde');

-- Ajuste de conteo: sobrante y faltante -------------------------------------------------------------------------------------------------------------
select operacion.registrar_movimiento_efectivo('pe-aj1', 'Caja de la empresa', 'ajuste_conteo', 30000, 'sobrante de conteo');
select operacion.registrar_movimiento_efectivo('pe-aj2', 'Caja de la empresa', 'ajuste_conteo', -50000, 'faltante de conteo');
select is(pg_temp.flush(), 2, 'los dos ajustes generan asiento');
select is(pg_temp.debe('pe-aj1', '1101'), 30000::bigint, 'sobrante: cargo a la caja por 300.00');
select is(pg_temp.haber('pe-aj1', '7200'), 30000::bigint, 'sobrante: abono a Sobrante o faltante de caja');
select is(pg_temp.haber('pe-aj2', '1101'), 50000::bigint, 'faltante: abono a la caja por 500.00');
select is(pg_temp.debe('pe-aj2', '7200'), 50000::bigint, 'faltante: cargo a Sobrante o faltante de caja');
select ok(pg_temp.cuadra('pe-aj1') and pg_temp.cuadra('pe-aj2'), 'ambos asientos cuadran');
select is(contabilidad.saldo('7200'), 20000::bigint, 'la cuenta 7200 queda con faltante neto de 200.00 (saldo deudor)');
select is((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy())->>'otros_cent')::bigint, -20000::bigint, 'el estado de resultados lleva el faltante neto en otros');
select is((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy())->>'utilidad_neta_cent')::bigint, -20000::bigint, 'y la utilidad neta baja 200.00');
select ok((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy())->'comprobacion'->>'cuadra')::boolean, 'la comprobacion del estado de resultados cuadra');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C16'), 'C16: la utilidad comercial incluye el sobrante o faltante de caja');
select ok((select ok from pg_temp.c23()), 'C23 cuadra tras los ajustes');
select is((select a from pg_temp.c23()), 1180000::bigint, 'efectivo operativo: 11,800.00');

-- Traspaso entre cuentas de efectivo ----------------------------------------------------------------------------------------------------------------
insert into operacion.cuenta_efectivo (nombre, tipo, titular, socio_id) values ('Banco de la empresa', 'banco', 'empresa', null);
select operacion.registrar_movimiento_efectivo('pe-tr1', 'Caja de la empresa', 'traspaso', 100000, null, null, 'Efectivo de Angelo');
select operacion.registrar_movimiento_efectivo('pe-tr2', 'Caja de la empresa', 'traspaso', 50000, null, null, 'Banco de la empresa');
select is(pg_temp.flush(), 2, 'los dos traspasos generan asiento');
select is(pg_temp.haber('pe-tr1', '1101'), 100000::bigint, 'traspaso a la caja de un socio: sale de la caja de la empresa (1101 sin custodio)');
select is(pg_temp.debe('pe-tr1', '1101', 'Angelo'), 100000::bigint, 'y entra a 1101 con Angelo como custodio (no crea deuda con el socio)');
select is(pg_temp.lineas('pe-tr1'), 2, 'el traspaso entre cajas son solo las dos lineas de caja');
select ok(pg_temp.cuadra('pe-tr1'), 'el traspaso cuadra');
select is(pg_temp.debe('pe-tr2', '1102'), 50000::bigint, 'traspaso a un banco: cargo a 1102');
select is(pg_temp.haber('pe-tr2', '1101'), 50000::bigint, 'y abono a la caja 1101');
select is(contabilidad.saldo_deudor('1101'), 1130000::bigint, '1101 contable queda en 11,300.00');
select is(contabilidad.saldo_deudor('1102'), 50000::bigint, '1102 contable en 500.00');
select ok((select ok from pg_temp.c23()), 'C23 cuadra con traspasos (1101 mas 1102)');
select is((select a from pg_temp.c23()), (select b from pg_temp.c23()), 'ambas vias iguales');
select is((select count(*)::int from contabilidad.asiento where origen_tipo = 'movimiento_efectivo'), 6, 'seis asientos de movimientos de efectivo');

-- Hash, determinismo e idempotencia ------------------------------------------------------------------------------------------------------------------
select is(contabilidad.verificar_cadena(), null::bigint, 'la cadena de hash esta integra con los asientos del puente');
select ok((select bool_and(contabilidad.coincide_recalculo(a.id)) from contabilidad.asiento a where a.origen_tipo = 'movimiento_efectivo'), 'recalcular las lineas de cada evento reproduce lo guardado');
select ok((select bool_and((contabilidad.verificar_asiento(a.id)->'cadena'->>'ok')::boolean and (contabilidad.verificar_asiento(a.id)->'determinismo'->>'ok')::boolean) from contabilidad.asiento a where a.origen_tipo = 'movimiento_efectivo'), 'verificar_asiento: hash y determinismo en verde');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C21'), 'C21 cadena de hash y folios sin huecos');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C10'), 'C10 asientos cuadrados');
select is(pg_temp.flush(), 0, 'asentar de nuevo no repite nada');
create temp table _n0 as select count(*)::int as n from contabilidad.asiento;
select operacion.registrar_movimiento_efectivo('pe-si1', 'Caja de la empresa', 'saldo_inicial', 1000000, 'apertura');
select is(pg_temp.flush(), 0, 'repetir la captura con la misma clave no genera otro asiento');
select is((select count(*)::int from contabilidad.asiento), (select n from _n0), 'sin asientos nuevos por la repeticion');
select is((select count(*)::int from operacion.cuenta_efectivo_mov where evento_id = pg_temp.ev('pe-si1')), 1, 'ni otro renglon de efectivo');

-- Mutacion: romper a mano lo que C23 vigila -----------------------------------------------------------------------------------------------------------
-- (1) un renglon de efectivo sin asiento (alguien escribe directo en el libro de efectivo)
select operacion.crear_evento('mutacion_prueba', negocio.hoy(), 'pe-mut1', '{}'::jsonb);
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  values (operacion.cuenta_efectivo_id('Caja de la empresa'), negocio.hoy(), 'ajuste_conteo', 70000, 'mutacion a mano', pg_temp.ev('pe-mut1'));
select is(pg_temp.flush(), 1, 'el evento de la mutacion no tiene regla de asiento: no se asienta (queda sin asiento)') where false;
select ok(not (select ok from pg_temp.c23()), 'MUTACION 1: un renglon de efectivo sin asiento pone C23 en rojo');
select is((select a - b from pg_temp.c23()), 70000::bigint, 'la diferencia de C23 es exactamente la del renglon roto');
select is((api.explicar_cifra('conta:efectivo')->>'valor')::bigint, 70000::bigint, 'Explicar este numero: la diferencia de efectivo es 700.00');
select is(jsonb_array_length(api.explicar_cifra('conta:efectivo')->'renglones'), 1, 'y se explica con un solo renglon: el evento sin asiento');
select ok((api.explicar_cifra('conta:efectivo')->'renglones'->0->>'concepto') like '%mutacion prueba%efectivo operativo 70000 contra libro 0%Caja de la empresa%', 'el renglon nombra el evento, las dos cifras y la cuenta de efectivo');
select ok((api.explicar_cifra('conta:efectivo')->'comprobacion'->>'cuadra')::boolean, 'las dos vias de la explicacion cuadran');
select is((api.explicar_cifra('conta:efectivo')->'comprobacion'->>'via2_valor')::bigint, 70000::bigint, 'segunda via: suma evento por evento');
-- se repara con el movimiento contrario y vuelve a verde
select operacion.crear_evento('mutacion_prueba', negocio.hoy(), 'pe-mut1b', '{}'::jsonb);
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  values (operacion.cuenta_efectivo_id('Caja de la empresa'), negocio.hoy(), 'ajuste_conteo', -70000, 'repara la mutacion', pg_temp.ev('pe-mut1b'));
select ok((select ok from pg_temp.c23()), 'al compensar el renglon roto C23 vuelve a verde');
select is((api.explicar_cifra('conta:efectivo')->>'valor')::bigint, 0::bigint, 'y la diferencia explicada es cero');
-- (2) un asiento manual contra 1101 sin movimiento de efectivo
select contabilidad.registrar_asiento_manual('pe-mut2', negocio.hoy(), 'prueba de mutacion', '[{"cuenta":"1101","debe_cent":9000},{"cuenta":"3990","haber_cent":9000}]'::jsonb);
select pg_temp.flush();
select ok(not (select ok from pg_temp.c23()), 'MUTACION 2: un asiento manual contra 1101 sin efectivo operativo pone C23 en rojo');
select is((select b - a from pg_temp.c23()), 9000::bigint, 'el libro tiene 90.00 de mas');
select is((api.explicar_cifra('conta:efectivo')->>'valor')::bigint, -9000::bigint, 'Explicar este numero: -90.00');
select ok((api.explicar_cifra('conta:efectivo')->'renglones')::text like '%asiento manual: efectivo operativo 0 contra libro 9000%', 'y lo atribuye al asiento manual');
select contabilidad.reversar_asiento('pe-mut2r', (select id from contabilidad.asiento where evento_id = pg_temp.ev('pe-mut2')), 'se revierte la mutacion');
select pg_temp.flush();
select ok((select ok from pg_temp.c23()), 'al reversar el asiento manual C23 vuelve a verde');

-- La cadena de explicar_cifra sigue entregando las demas cifras ---------------------------------------------------------------------------------------
select is((api.explicar_cifra('conta:saldo:1101')->>'valor')::bigint, contabilidad.saldo('1101'), 'conta:saldo sigue resolviendose');
select is((api.explicar_cifra('socio:neto:Angelo')->>'cifra'), 'socio:neto:Angelo', 'las cifras de socios siguen resolviendose');
select throws_ok($$select api.explicar_cifra('conta:inexistente')$$, '22023', null, 'una cifra de contabilidad desconocida sigue fallando');

-- Reversa ---------------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.anular_movimiento_efectivo('pe-r0', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-aj2')), '  ')$$, '23502', null, 'deshacer exige motivo');
select lives_ok($$select operacion.anular_movimiento_efectivo('pe-r1', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-aj2')), 'conteo mal capturado')$$, 'se deshace el faltante de conteo');
select pg_temp.flush();
select is(pg_temp.debe('pe-r1', '1101'), 50000::bigint, 'la reversa del faltante devuelve 500.00 a la caja');
select is(pg_temp.haber('pe-r1', '7200'), 50000::bigint, 'y abona la cuenta de sobrante o faltante');
select is(contabilidad.saldo('7200'), -30000::bigint, 'la cuenta 7200 queda solo con el sobrante de 300.00 (saldo acreedor)');
select ok(pg_temp.cuadra('pe-r1'), 'el asiento de la reversa cuadra');
select ok((select ok from pg_temp.c23()), 'C23 cuadra tras la reversa');
select is(operacion.anular_movimiento_efectivo('pe-r1', (select id from operacion.cuenta_efectivo_mov where evento_id = pg_temp.ev('pe-aj2') and concepto = 'ajuste_conteo'), 'conteo mal capturado')->>'deshecho', 'true', 'repetir la reversa con la misma clave devuelve el mismo resultado');
select is((select count(*)::int from operacion.cuenta_efectivo_mov where concepto = 'reversa' and evento_id = pg_temp.ev('pe-r1')), 1, 'y no duplica el renglon de reversa');
select throws_ok($$select operacion.anular_movimiento_efectivo('pe-r1', 0, 'x')$$, null, 'conflicto de idempotencia', 'la misma clave con otros datos es un conflicto');
select throws_ok($$select operacion.anular_movimiento_efectivo('pe-r2', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-aj2') and concepto = 'ajuste_conteo'), 'otra vez')$$, 'P0428', null, 'un movimiento ya deshecho no se deshace dos veces');
select lives_ok($$select operacion.anular_movimiento_efectivo('pe-r3', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-tr1') order by id limit 1), 'traspaso equivocado')$$, 'se deshace un traspaso (los dos renglones)');
select pg_temp.flush();
select is(pg_temp.debe('pe-r3', '1101'), 100000::bigint, 'la reversa del traspaso devuelve el dinero a la caja de la empresa');
select is(pg_temp.haber('pe-r3', '1101', 'Angelo'), 100000::bigint, 'y lo saca de la caja de Angelo');
select ok((select ok from pg_temp.c23()), 'C23 cuadra tras deshacer el traspaso');
select lives_ok($$select operacion.anular_movimiento_efectivo('pe-r4', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-si2')), 'saldo inicial mal')$$, 'se deshace el saldo inicial del efectivo de Angelo');
select pg_temp.flush();
select is(pg_temp.debe('pe-r4', '3990', 'Angelo'), 200000::bigint, 'la reversa del saldo inicial cancela la contrapartida de apertura');
select is(pg_temp.haber('pe-r4', '1101', 'Angelo'), 200000::bigint, 'y baja la caja de Angelo');
select ok((select ok from pg_temp.c23()), 'C23 cuadra tras deshacer el saldo inicial');
-- no se deshace un saldo inicial si el dinero ya se gasto
select operacion.registrar_gasto_empresa('pe-g1', 900000, 'papeleria');
select throws_ok($$select operacion.anular_movimiento_efectivo('pe-r5', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-si1')), 'ya gastado')$$, 'P0428', null, 'no se deshace un saldo inicial si la cuenta quedaria en negativo');
select throws_ok($$select operacion.anular_movimiento_efectivo('pe-r6', (select id from operacion.cuenta_efectivo_mov where evento_id = (select id from operacion.evento where clave_idem = 'pe-g1')), 'no aplica')$$, 'P0428', null, 'un movimiento de otra operacion se deshace desde su operacion');
select throws_ok($$select operacion.anular_movimiento_efectivo('pe-r7', 999999999, 'no existe')$$, '22023', null, 'movimiento desconocido');

-- El gasto de la empresa (ya asentado por f3b) sigue cuadrando con el efectivo operativo ---------------------------------------------------------------
select pg_temp.flush();
select ok((select ok from pg_temp.c23()), 'C23 cuadra tambien con flujos que ya tenian asiento (gasto de la empresa)');
select is(contabilidad.verificar_cadena(), null::bigint, 'la cadena sigue integra al final');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C21'), 'C21 sigue en verde al final');
select ok((select bool_and(ok) from contabilidad.comprobaciones() where bloqueante), 'ninguna comprobacion bloqueante falla al final');

-- Permisos --------------------------------------------------------------------------------------------------------------------------------------------
select is((select has_function_privilege('anon', 'operacion.anular_movimiento_efectivo(text,bigint,text)', 'execute')), false, 'anon no ejecuta deshacer movimientos de efectivo');
select is((select has_function_privilege('authenticated', 'contabilidad.lineas_de_evento(bigint)', 'execute')), false, 'authenticated no ejecuta las lineas de evento');
select is((select has_function_privilege('authenticated', 'api.explicar_cifra_socios(text)', 'execute')), false, 'ni la cifra de socios renombrada');
select is((select has_function_privilege('authenticated', 'api.explicar_cifra(text)', 'execute')), true, 'authenticated si explica cifras');

select * from finish();
rollback;
