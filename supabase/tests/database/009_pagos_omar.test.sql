-- pgTAP F2: pagos de clientes con destino, cuentas por cobrar, dinero de la sociedad en poder de un socio (adenda 22),
-- idempotencia del mismo mensaje y el modelo de Omar (renta, tomas, liquidacion semanal con corte el lunes; G6).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f2.pagos@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('73333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f2.pagos@example.test');
select set_config('request.jwt.claim.sub', '73333333-3333-3333-3333-333333333333', true);

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;

select catalogo.asegurar_cliente('F2 Omar Persona 2', 'Javier');
select catalogo.asegurar_persona_bodega('F2 Omar Persona 2', 'F2 Omar Persona 2');
select catalogo.asegurar_cliente('F2 Cliente Z', 'Angelo');
select catalogo.asegurar_modelo('F2 Marca', 'F2 Pago 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F2 Pago 30K', 'Sandia');
select catalogo.fijar_costo('f2pc1', 'Isaac', 'F2 Pago 30K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('f2pp1', 'F2 Cliente Z', 'F2 Pago 30K', 15000, '2026-11-01', 'chat');
-- Inventario de sobra para las semanas de Omar (dos pedidos grandes + tomas).
select operacion.registrar_movimiento('f2pm1', 'F2 Pago 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 1500, 15000000, '2026-11-01');

-- Un pedido enviado de $18,000 (120 pz x $150) para el cliente Z, a 7 dias de plazo ------------------------------------------------------
select operacion.crear_pedido('f2z1', pg_temp.cid('F2 Cliente Z'), '[{"modelo":"F2 Pago 30K","sabor":"Sandia","piezas":120}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-02', null, 7);
select operacion.confirmar_pedido('f2z1c', pg_temp.pid('f2z1'));
select is((operacion.enviar_pedido('f2z1s', pg_temp.pid('f2z1'), null, null, '2026-11-02')->>'total_cent')::bigint, 1800000::bigint, 'pedido enviado de $18,000.00');
select is(operacion.pedido_saldo(pg_temp.pid('f2z1')), 1800000::bigint, 'por cobrar completo');
select is(operacion.saldo_cliente(pg_temp.cid('F2 Cliente Z')), 1800000::bigint, 'saldo del cliente = 18,000.00');

-- Pago de $9,000 a la cuenta de Angelo: baja la CxC y Angelo debe $9,000 a la sociedad --------------------------------------------------------
select is((operacion.registrar_pago('f2pg1', 'Angelo', 900000, pg_temp.cid('F2 Cliente Z'), null, true, 'abono', '2026-11-05', null, 'mensaje de prueba', 'Z mando 9000')->>'aplicado_cent')::bigint, 900000::bigint, 'el pago se aplica al pedido');
select is(operacion.pedido_saldo(pg_temp.pid('f2z1')), 900000::bigint, 'la cuenta por cobrar del cliente baja $9,000.00');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 900000::bigint, 'Angelo debe $9,000.00 a la sociedad (fondos en su poder)');
-- Mismo mensaje dos veces: se aplica una sola vez ------------------------------------------------------------------------------------------
select operacion.registrar_pago('f2pg1', 'Angelo', 900000, pg_temp.cid('F2 Cliente Z'), null, true, 'abono', '2026-11-05', null, 'mensaje de prueba', 'Z mando 9000');
select is((select count(*)::int from operacion.pago where cuenta_destino_id = (select id from operacion.cuenta_dinero where nombre = 'Angelo') and monto_cent = 900000), 1, 'el mismo mensaje dos veces: un solo pago');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 900000::bigint, 'y la deuda de Angelo no se duplica');
select throws_ok($$select operacion.registrar_pago('f2pg1', 'Angelo', 900001, (select id from catalogo.cliente where nombre_canonico = 'F2 Cliente Z'))$$, 'P0409', null, 'misma clave con otro monto = 409');
-- Angelo paga $9,000 a Isaac: su deuda baja a cero y la cuenta con Isaac sube 9,000 -----------------------------------------------------------
create temp table _isaac as select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')) as antes;
select is((operacion.pago_proveedor_de_socio('f2pi1', 'Isaac', 900000, 'Angelo', 'auto', '2026-11-06')->>'deuda_socio_cent')::bigint, 0::bigint, 'Angelo paga $9,000.00 a Isaac: su deuda baja a cero');
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')) - (select antes from _isaac), 900000::bigint, 'la cuenta con Isaac mejora $9,000.00');
select is((select count(*)::int from operacion.aportacion_socio where socio_id = pg_temp.sid('Angelo')), 0, 'no es aportacion: salio de fondos de la sociedad');
-- Un pago con dinero propio es aportacion ---------------------------------------------------------------------------------------------------
select is((operacion.pago_proveedor_de_socio('f2pi2', 'Isaac', 500000, 'Javier', 'auto', '2026-11-06')->>'aportacion_cent')::bigint, 500000::bigint, 'sin fondos de la sociedad en su poder: aportacion de capital');
select throws_ok($$select operacion.pago_proveedor_de_socio('f2pi3', 'Isaac', 1, 'Javier', 'fondos_sociedad')$$, '23514', null, 'fondos_sociedad no excede lo que el socio tiene');

-- Cuentas por cobrar: plazo, vencimiento, antiguedad -------------------------------------------------------------------------------------------
select is((select plazo_dias from operacion.pedido where id = pg_temp.pid('f2z1')), 7, 'plazo acordado al crear');
select lives_ok($$select operacion.acordar_plazo('f2pl1', (select pg_temp.pid('f2z1')), 14)$$, 'acordar plazo');
select is((select plazo_dias from operacion.pedido where id = pg_temp.pid('f2z1')), 14, 'plazo de 14 dias');

-- Pago sin identificar: no se aplica; se identifica despues -------------------------------------------------------------------------------------
select is((operacion.registrar_pago('f2pg2', 'Javier', 300000, null, null, true, 'abono', '2026-11-07')->>'aplicado_cent')::bigint, 0::bigint, 'sin cliente no se aplica a pedidos (T7)');
select is((select count(*)::int from operacion.aviso where codigo = 'pago_sin_identificar' and estado = 'abierta'), 1, 'NT-037: pago sin identificar');
select is(operacion.pedido_saldo(pg_temp.pid('f2z1')), 900000::bigint, 'el saldo del pedido no cambia');
select is((operacion.identificar_pago('f2pg2i', (select id from operacion.pago where monto_cent = 300000 and identificacion = 'sin_identificar'), pg_temp.cid('F2 Cliente Z'))->>'aplicado_cent')::bigint, 300000::bigint, 'identificado, se aplica');
select is((select count(*)::int from operacion.aviso where codigo = 'pago_sin_identificar' and estado = 'abierta'), 0, 'el aviso se resuelve');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos'), 300000::bigint, 'y Javier debe lo que cayo en su cuenta');

-- Comprobante repetido: posible duplicado, no se registra ---------------------------------------------------------------------------------------
select operacion.registrar_pago('f2pg3', 'Efectivo', 100000, pg_temp.cid('F2 Cliente Z'), null, false, 'abono', '2026-11-07', repeat('a', 64));
select is((operacion.registrar_pago('f2pg3b', 'Efectivo', 100000, pg_temp.cid('F2 Cliente Z'), null, false, 'abono', '2026-11-07', repeat('a', 64))->>'duplicado')::boolean, true, 'NT-038: el mismo comprobante no entra dos veces');
select is((select count(*)::int from operacion.pago where comprobante_sha256 = repeat('a', 64)), 1, 'un solo pago con ese comprobante');
-- Saldo a favor: pago sin aplicar; se aplica al enviar un pedido nuevo (caso de lo cobrado y no enviado) --------------------------------------------
select is(operacion.saldo_favor_cliente(pg_temp.cid('F2 Cliente Z')), 100000::bigint, 'queda $1,000.00 a favor del cliente');
select operacion.crear_pedido('f2z2', pg_temp.cid('F2 Cliente Z'), '[{"modelo":"F2 Pago 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-08');
select operacion.registrar_pago('f2pg4', 'Efectivo', 1600000, pg_temp.cid('F2 Cliente Z'), null, false, 'anticipo', '2026-11-08', null, null, null, pg_temp.pid('f2z2'));
select is(operacion.saldo_favor_cliente(pg_temp.cid('F2 Cliente Z')), 1700000::bigint, 'G7: pedido cobrado y no enviado: saldo a favor');
select operacion.confirmar_pedido('f2z2c', pg_temp.pid('f2z2'));
select throws_ok($$select operacion.enviar_pedido('f2z2s0', (select pg_temp.pid('f2z2')), '[]'::jsonb, null, '2026-11-08')$$, '23514', null, 'G7: con 0 surtidas no hay venta ni salida');
select is((select count(*)::int from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id = pg_temp.pid('f2z2')), 0, 'G7: sin renta');
select operacion.enviar_pedido('f2z2s', pg_temp.pid('f2z2'), null, null, '2026-11-08');
select is(operacion.pedido_saldo(pg_temp.pid('f2z2')), 0::bigint, 'G7: el pedido queda saldado con el anticipo (se cierra contra el saldo a favor)');
select is(operacion.saldo_favor_cliente(pg_temp.cid('F2 Cliente Z')), 0::bigint, 'lo que sobro cubre el saldo mas antiguo');
select is(operacion.pedido_saldo(pg_temp.pid('f2z1')), 400000::bigint, 'y el pedido anterior queda con 4,000.00 por cobrar');
-- Anular un pago: contramovimientos ---------------------------------------------------------------------------------------------------------
select lives_ok($$select operacion.anular_pago('f2pg2a', (select id from operacion.pago where monto_cent = 300000), 'se capturo mal')$$, 'anular pago');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos'), 0::bigint, 'la deuda de Javier regresa a cero');
select is(operacion.pedido_saldo(pg_temp.pid('f2z1')), 700000::bigint, 'y el pedido vuelve a deber lo que aplicaba ese pago');
select throws_ok($$select operacion.anular_pago('f2pg2a2', (select id from operacion.pago where monto_cent = 300000), 'otra vez')$$, 'P0428', null, 'un pago solo se anula una vez');

-- Entrega de fondos: socio a socio ---------------------------------------------------------------------------------------------------------------
select operacion.registrar_pago('f2pg5', 'Angelo', 200000, pg_temp.cid('F2 Cliente Z'), null, false, 'abono', '2026-11-09');
select is((operacion.registrar_entrega_socio('f2en1', 'Angelo', 200000, 'otro_socio', 'Javier', 'fondos')->>'fondos_pendientes_cent')::bigint, 0::bigint, 'Angelo entrega a Javier');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos'), 200000::bigint, 'ahora los fondos de la sociedad estan en poder de Javier');

-- ---- Omar: G6 (renta 2 pesos por pieza surtida al ENVIAR; tomas a credito; liquidacion semanal con corte el lunes) -------------------------
-- Caso A: 300 pz x $2 = 600.00; tomas 4 x $150 = 600.00; neto 0.00.
select operacion.crear_pedido('f2o1', pg_temp.cid('F2 Cliente Z'), '[{"modelo":"F2 Pago 30K","sabor":"Sandia","piezas":300}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10');
select operacion.confirmar_pedido('f2o1c', pg_temp.pid('f2o1'));
select is((select count(*)::int from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id = pg_temp.pid('f2o1')), 0, 'confirmar no devenga renta');
select operacion.enviar_pedido('f2o1s', pg_temp.pid('f2o1'), null, null, '2026-11-10');
select is((operacion.saldo_omar_semana('2026-11-09')->>'renta_cent')::bigint, 60000::bigint, 'caso A: 300 x $2 = $600.00 de renta');
select is((operacion.registrar_toma_omar('f2t1', '{"modelo":"F2 Pago 30K","sabor":"Sandia"}'::jsonb, 4, 15000, '2026-11-11')->>'estado'), 'autorizada', 'la toma registrada por un socio se ejecuta');
select is((operacion.saldo_omar_semana('2026-11-09')->>'tomas_cent')::bigint, 60000::bigint, 'caso A: tomas 4 x $150 = $600.00');
select is((operacion.saldo_omar_semana('2026-11-09')->>'neto_cent')::bigint, 0::bigint, 'caso A: neto 0.00');
select throws_ok($$select operacion.cerrar_liquidacion_omar('f2l0', '2026-11-09', false, '2026-11-12')$$, 'P0428', null, 'no se liquida antes de que termine la semana (corte el lunes)');
select throws_ok($$select operacion.cerrar_liquidacion_omar('f2l0b', '2026-11-10', false, '2026-11-20')$$, '22023', null, 'la semana de Omar empieza en lunes');
select is((operacion.cerrar_liquidacion_omar('f2l1', '2026-11-09', false, '2026-11-16')->>'palabra'), 'Saldo cero', 'caso A se cierra el lunes 16 con saldo cero');
select is(operacion.saldo_omar_cuenta(), 0::bigint, 'cuenta con Omar en cero');
select throws_ok($$select operacion.cerrar_liquidacion_omar('f2l1b', '2026-11-09', false, '2026-11-16')$$, 'P0428', null, 'una semana no se liquida dos veces');
select throws_ok($$select operacion.registrar_toma_omar('f2t1x', '{"modelo":"F2 Pago 30K","sabor":"Sandia"}'::jsonb, 1, 15000, '2026-11-12')$$, 'P0422', null, 'una semana liquidada no admite tomas nuevas');
-- Caso B: 220 x $2 = 440.00 contra 4 x $175 = 700.00; neto -260.00 (Omar debe y paga).
select operacion.crear_pedido('f2o2', pg_temp.cid('F2 Cliente Z'), '[{"modelo":"F2 Pago 30K","sabor":"Sandia","piezas":220}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-17');
select operacion.confirmar_pedido('f2o2c', pg_temp.pid('f2o2'));
select operacion.enviar_pedido('f2o2s', pg_temp.pid('f2o2'), null, null, '2026-11-17');
select operacion.registrar_toma_omar('f2t2', '{"modelo":"F2 Pago 30K","sabor":"Sandia"}'::jsonb, 4, 17500, '2026-11-18');
select is((operacion.cerrar_liquidacion_omar('f2l2', '2026-11-16', false, '2026-11-23')->>'neto_cent')::bigint, -26000::bigint, 'caso B: neto -$260.00');
select is((operacion.cerrar_liquidacion_omar('f2l2', '2026-11-16', false, '2026-11-23')->>'palabra'), 'Omar debe', 'caso B: Omar debe');
select is((select compensado_cent from operacion.liquidacion_omar where semana_ini = '2026-11-16'), 44000::bigint, 'se compensa el menor de ambos (la renta)');
select is(operacion.saldo_omar_cuenta(), -26000::bigint, 'Omar debe 260.00');
select is((operacion.registrar_pago_omar('f2po1', 26000, 'de_omar', 'Angelo', 'transferencia', '2026-11-23')->>'saldo_omar_cent')::bigint, 0::bigint, 'Omar paga la diferencia: saldo cero');
-- Caso C: 428 x $2 = 856.00 contra 4 x $150 = 600.00; neto +256.00 (le debemos).
select operacion.crear_pedido('f2o3', pg_temp.cid('F2 Cliente Z'), '[{"modelo":"F2 Pago 30K","sabor":"Sandia","piezas":428}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-24');
select operacion.confirmar_pedido('f2o3c', pg_temp.pid('f2o3'));
select operacion.enviar_pedido('f2o3s', pg_temp.pid('f2o3'), null, null, '2026-11-24');
select operacion.registrar_toma_omar('f2t3', '{"modelo":"F2 Pago 30K","sabor":"Sandia"}'::jsonb, 4, 15000, '2026-11-25');
-- Una toma pendiente no cambia saldo ni kardex pero si reserva; una sin precio no entra al saldo.
select is((operacion.registrar_toma_omar('f2t4', '{"modelo":"F2 Pago 30K","sabor":"Sandia"}'::jsonb, 3, 15000, '2026-11-26', 'telegram_omar')->>'estado'), 'pendiente', 'una solicitud de Omar nace pendiente');
select is((select count(*)::int from operacion.reserva where origen_tipo = 'toma_omar' and estado = 'activa'), 1, 'la toma pendiente reserva');
select is((operacion.saldo_omar_semana('2026-11-23')->>'tomas_cent')::bigint, 60000::bigint, 'y no cambia el saldo');
select is((select count(*)::int from operacion.movimiento_inventario where tipo = 'salida_toma_omar' and cantidad = -3), 0, 'ni el kardex');
select is((operacion.registrar_toma_omar('f2t5', '{"modelo":"F2 Pago 30K","sabor":"Sandia"}'::jsonb, 2, null, '2026-11-27')->>'falta_precio')::boolean, true, 'sin precio: Falta precio');
select is((operacion.saldo_omar_semana('2026-11-23')->>'tomas_cent')::bigint, 60000::bigint, 'una toma sin precio no entra al saldo');
select is((select count(*)::int from operacion.aviso where codigo = 'toma_sin_precio'), 1, 'NT-051: toma sin precio');
select throws_ok($$select operacion.cerrar_liquidacion_omar('f2l3', '2026-11-23', false, '2026-11-30')$$, 'P0428', null, 'no cierra con pendientes sin decision expresa');
select is((operacion.resolver_toma_omar('f2t4r', (select id from operacion.toma_omar where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2t4')), 'rechazar')->>'estado'), 'rechazada', 'rechazar libera');
select is((select count(*)::int from operacion.reserva where origen_tipo = 'toma_omar' and estado = 'activa'), 0, 'la reserva se libera');
select throws_ok($$select operacion.resolver_toma_omar('f2t4r2', (select id from operacion.toma_omar where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2t4')), 'autorizar')$$, 'P0428', null, 'T9: el estado de una toma solo avanza');
select is((operacion.cerrar_liquidacion_omar('f2l3', '2026-11-23', false, '2026-11-30')->>'neto_cent')::bigint, 25600::bigint, 'caso C: neto +$256.00');
select is(operacion.saldo_omar_cuenta(), 25600::bigint, 'le debemos 256.00');
select is((select count(*)::int from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido p on p.id = l.pedido_id where p.origen <> 'bodega_omar'), 0, 'ningun pedido directo devenga renta');
-- Deshacer una toma autorizada
select throws_ok($$select operacion.resolver_toma_omar('f2t3d', (select id from operacion.toma_omar where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2t3')), 'deshacer')$$, 'P0422', null, 'una toma de una semana liquidada no se deshace');
select throws_ok($$update operacion.liquidacion_omar set neto_cent = 0$$, '42501', null, 'la liquidacion cerrada no se edita');
select * from finish();
rollback;
