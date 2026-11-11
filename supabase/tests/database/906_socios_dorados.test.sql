-- pgTAP 906 (QA de punta a punta, H-07, H-12): dinero entre socios segun CLAUDE.md y las adendas 21, 31, 32 y 33.
-- Casos dorados con cifras a mano:
--   * Caso del dueño: utilidad antes de gastos 20,000.00; gastos Javier 2,221.00 y Angelo 500.00; utilidad neta 17,279.00;
--     8,639.50 a cada socio mas sus reembolsos; el gasto de un socio se descuenta UNA sola vez.
--   * Ejemplos B, C, D y E de la matriz (qa/01, flujo F10) con la funcion pura cascada_calcular.
--   * repartir_proporcional, validaciones de aportacion / pago a socio / liquidacion entre socios (montos 0 y negativos, tipos invalidos).
-- Lo que hoy NO cumple la especificacion vive en 990_pendientes_de_correccion. ESCRITA SIN EJECUTAR (sin Docker).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n906.angelo@example.test', 'socio', 'Angelo', true), ('n906.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a6666666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n906.angelo@example.test'),
  ('a6666666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n906.javier@example.test');
select set_config('request.jwt.claim.sub', 'a6666666-6666-6666-6666-666666666661', true);

create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;

-- Punto de partida limpio (mismo patron que 012): nada pendiente ni en poder de nadie.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-906', '{}'::jsonb);
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_reembolso', -operacion.aportado_socio(s.id, 'reembolsable') - operacion.libro_socio(s.id, 'pago_reembolso'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'reembolsable') + operacion.libro_socio(s.id, 'pago_reembolso') <> 0;
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_devolucion_aportacion', -operacion.aportado_socio(s.id, 'capital') - operacion.libro_socio(s.id, 'pago_devolucion_aportacion'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'capital') + operacion.libro_socio(s.id, 'pago_devolucion_aportacion') <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;

-- ---- repartir_proporcional (H-07: sin prueba directa) ---------------------------------------------------------------------------------
select is(operacion.repartir_proporcional(100001, '{"Angelo":500000,"Javier":500000}'), '{"Angelo": 50001, "Javier": 50000}'::jsonb, 'repartir: el centavo suelto va a Angelo por desempate alfabetico (regla E pendiente)');
select is(operacion.repartir_proporcional(100001, '{"Angelo":500000,"Javier":500000}', '{"Javier":10}'), '{"Angelo": 50000, "Javier": 50001}'::jsonb, 'repartir: con desempate a favor de Javier, el centavo es de Javier');
select is((select sum(value::bigint) from jsonb_each_text(operacion.repartir_proporcional(100, '{"a":1,"b":1,"c":1}'))), 100::bigint, 'repartir: 3 socios simulados suman exacto 100');
select is((select sum(value::bigint) from jsonb_each_text(operacion.repartir_proporcional(1000003, '{"Angelo":3,"Javier":7}'))), 1000003::bigint, 'repartir: 30/70 suma exacto');
select is(operacion.repartir_proporcional(0, '{"Angelo":1,"Javier":1}'), '{"Angelo": 0, "Javier": 0}'::jsonb, 'repartir: total 0 = ceros');
select is(operacion.repartir_proporcional(-500, '{"Angelo":1,"Javier":1}'), '{"Angelo": 0, "Javier": 0}'::jsonb, 'repartir: total negativo = ceros');
select is(operacion.repartir_proporcional(500, '{"Angelo":0,"Javier":0}'), '{"Angelo": 0, "Javier": 0}'::jsonb, 'repartir: pesos en cero = ceros, no division por cero');
select is(operacion.repartir_proporcional(1000, '{"Angelo":1,"Javier":0}'), '{"Angelo": 1000, "Javier": 0}'::jsonb, 'repartir: un solo socio con peso se lleva todo');

-- ---- Caso del dueño con cascada pura: 20,000 - 2,221 - 500 = 17,279 ---------------------------------------------------------------------
create temp table _dueno as select operacion.cascada_calcular(1727900, 0, '{"Angelo":50000,"Javier":222100}', '{"Angelo":0,"Javier":0}', '{"Angelo":1000000,"Javier":1000000}',
                                                              '{"Angelo":1000000,"Javier":1000000}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->'efectivo'->>'total_cent')::bigint from _dueno), 2000000::bigint, 'dueño: efectivo 20,000.00');
select is((select (c->>'repartible_cent')::bigint from _dueno), 1727900::bigint, 'dueño: utilidad neta repartible 17,279.00');
select is((select (c->'por_socio'->'Angelo'->>'utilidad_cent')::bigint from _dueno), 863950::bigint, 'dueño: 8,639.50 a Angelo');
select is((select (c->'por_socio'->'Javier'->>'utilidad_cent')::bigint from _dueno), 863950::bigint, 'dueño: 8,639.50 a Javier');
select is((select (c->'por_socio'->'Angelo'->>'asignado_cent')::bigint from _dueno), 913950::bigint, 'dueño: Angelo 8,639.50 + reembolso 500.00 = 9,139.50');
select is((select (c->'por_socio'->'Javier'->>'asignado_cent')::bigint from _dueno), 1086050::bigint, 'dueño: Javier 8,639.50 + reembolso 2,221.00 = 10,860.50');
select is((select (c->'por_socio'->'Angelo'->>'resultado_cent')::bigint from _dueno), -86050::bigint, 'dueño: Angelo tiene 10,000 y le tocan 9,139.50: devuelve 860.50');
select is((select (c->'por_socio'->'Javier'->>'resultado_cent')::bigint from _dueno), 86050::bigint, 'dueño: Javier recibe 860.50');
select is((select c->'liquidar' from _dueno), '{"de": "Angelo", "a": "Javier", "monto_cent": 86050}'::jsonb, 'dueño: Angelo paga 860.50 a Javier y quedan en paz');
select is((select (c->>'remanente_cent')::bigint from _dueno), 0::bigint, 'dueño: no sobra efectivo');
select is((select (c->>'suma_asignada_cent')::bigint from _dueno), 2000000::bigint, 'identidad: suma asignada = efectivo repartido 20,000.00');
select is((select (c->>'suma_resultados_cent')::bigint from _dueno), 0::bigint, 'identidad: suma de saldos de los socios = 0 (todo el efectivo esta repartido)');
select is((select (c->>'identidad_cuadra')::boolean from _dueno), true, 'identidad cuadra');

-- ---- Ejemplos B, C, D de la matriz (efectivo de medio peso, insuficiente, utilidad negativa) ---------------------------------------------
create temp table _b1 as select operacion.cascada_calcular(1200000, 0, '{"Angelo":50000,"Javier":122100}', '{"Angelo":0,"Javier":100000}', '{"Angelo":800000,"Javier":500000}', '{"Angelo":800000,"Javier":500000}', '{"Angelo":500000,"Javier":500000}', false) as c;
select is((select (c->>'repartible_cent')::bigint from _b1), 1127900::bigint, 'B1 utilidad antes que capital: repartible 11,279.00');
select is((select (c->'por_socio'->'Angelo'->>'utilidad_cent')::bigint from _b1), 563950::bigint, 'B1: 5,639.50 por socio');
select is((select (c->'por_socio'->'Angelo'->>'resultado_cent')::bigint from _b1), -186050::bigint, 'B1: Angelo devuelve 1,860.50');
select is((select (c->'por_socio'->'Javier'->>'resultado_cent')::bigint from _b1), 186050::bigint, 'B1: Javier recibe 1,860.50');
create temp table _b2 as select operacion.cascada_calcular(1200000, 0, '{"Angelo":50000,"Javier":122100}', '{"Angelo":0,"Javier":100000}', '{"Angelo":800000,"Javier":500000}', '{"Angelo":800000,"Javier":500000}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->>'repartible_cent')::bigint from _b2), 1027900::bigint, 'B2 devolver antes: repartible 10,279.00');
select is((select (c->'por_socio'->'Angelo'->>'utilidad_cent')::bigint from _b2), 513950::bigint, 'B2: 5,139.50 por socio');
select is((select (c->'por_socio'->'Angelo'->>'resultado_cent')::bigint from _b2), -236050::bigint, 'B2: Angelo devuelve 2,360.50');
select is((select (c->'por_socio'->'Javier'->>'resultado_cent')::bigint from _b2), 236050::bigint, 'B2: Javier recibe 2,360.50');
create temp table _c as select operacion.cascada_calcular(1200000, 0, '{"Angelo":50000,"Javier":122100}', '{"Angelo":0,"Javier":100000}', '{"Angelo":0,"Javier":200000}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->>'repartible_cent')::bigint from _c), 0::bigint, 'C efectivo 2,000.00: nada de utilidad');
select is((select (c->'por_socio'->'Angelo'->>'paga_reembolso_cent')::bigint from _c), 50000::bigint, 'C: reembolso de Angelo completo 500.00');
select is((select (c->'por_socio'->'Javier'->>'paga_reembolso_cent')::bigint from _c), 122100::bigint, 'C: reembolso de Javier completo 1,221.00');
select is((select (c->'por_socio'->'Javier'->>'paga_aportacion_cent')::bigint from _c), 27900::bigint, 'C: con los 279.00 que sobran se devuelve capital parcial');
select is((select (c->>'limitado_por_efectivo')::boolean from _c), true, 'C: avisa que esta limitada por efectivo');
select is((select (c->>'remanente_cent')::bigint from _c), 0::bigint, 'C: no sobra nada');
create temp table _d as select operacion.cascada_calcular(-300000, 0, '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->>'repartible_cent')::bigint from _d), 0::bigint, 'D sin efectivo y con perdida: nada que repartir');
select is((select (c->'liquidar') is null or c->'liquidar' = 'null'::jsonb from _d), true, 'D: no hay liquidacion');
-- Efectivo menor que los reembolsos: se reparte en proporcion a lo pendiente (H4: decision del dueño pendiente)
create temp table _e as select operacion.cascada_calcular(0, 100000, '{"Angelo":300000,"Javier":100000}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->'por_socio'->'Angelo'->>'paga_reembolso_cent')::bigint from _e), 75000::bigint, 'efectivo corto: Angelo recibe 750.00 de 3,000.00');
select is((select (c->'por_socio'->'Javier'->>'paga_reembolso_cent')::bigint from _e), 25000::bigint, 'efectivo corto: Javier recibe 250.00 de 1,000.00');

-- ---- Validaciones de las capturas de socios -------------------------------------------------------------------------------------------
select throws_ok($$select operacion.registrar_aportacion('n906a0', 'Javier', 0, 'Capital adicional')$$, '23514', null, 'aportacion de 0 se rechaza');
select throws_ok($$select operacion.registrar_aportacion('n906a1', 'Javier', -100, 'Capital adicional')$$, '23514', null, 'aportacion negativa se rechaza');
select throws_ok($$select operacion.registrar_aportacion('n906a2', 'Javier', 100, '')$$, '23502', null, 'aportacion sin concepto se rechaza');
select throws_ok($$select operacion.registrar_aportacion('n906a3', 'Javier', 100, 'x', 'regalo')$$, '22023', null, 'clasificacion invalida');
select throws_ok($$select operacion.registrar_aportacion('n906a4', 'Fulano', 100, 'x')$$, '22023', null, 'socio desconocido');
select throws_ok($$select operacion.registrar_gasto_socio('n906g0', 'Javier', 0, 'envio')$$, '23514', null, 'gasto de 0 se rechaza');
select throws_ok($$select operacion.registrar_gasto_socio('n906g1', 'Javier', 100, '')$$, '23502', null, 'gasto sin categoria se rechaza');
select throws_ok($$select operacion.registrar_gasto_socio('n906g2', 'Javier', 100, 'envio', 'raro')$$, '22023', null, 'naturaleza invalida');
select throws_ok($$select operacion.registrar_pago_a_socio('n906p0', 'Javier', 0, 'reembolso')$$, '23514', null, 'pago a socio de 0 se rechaza');
select throws_ok($$select operacion.registrar_pago_a_socio('n906p1', 'Javier', 100, 'regalo')$$, '22023', null, 'tipo de pago invalido');
select throws_ok($$select operacion.registrar_pago_a_socio('n906p2', 'Javier', 100, 'reembolso', 'cheque')$$, '22023', null, 'via invalida');
select throws_ok($$select operacion.registrar_liquidacion_entre_socios('n906l0', 'Angelo', 'Angelo', 100)$$, '22023', null, 'liquidacion de un socio consigo mismo');
select throws_ok($$select operacion.registrar_liquidacion_entre_socios('n906l1', 'Angelo', 'Javier', 0)$$, '23514', null, 'liquidacion de 0 se rechaza');
select throws_ok($$select operacion.anular_movimiento_socio('n906u0', 'aportacion', 999999999, 'x')$$);

-- ---- Aportacion de capital (F09): 1,000.00 de Javier, devolucion parcial 400, exceso 700 rechazado -----------------------------------
select is((operacion.registrar_aportacion('n906c1', 'Javier', 100000, 'Capital adicional', 'capital', '2020-09-07')->'eco'->>'neto_cent')::bigint, 100000::bigint, 'F09: aportacion de 1,000.00: neto a favor de Javier');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 100000::bigint, 'F09: devolucion pendiente 1,000.00');
select lives_ok($$select operacion.registrar_pago_a_socio('n906c2', 'Javier', 40000, 'devolucion_aportacion')$$, 'F09: devolucion de 400.00');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 60000::bigint, 'F09: quedan 600.00');
select throws_ok($$select operacion.registrar_pago_a_socio('n906c3', 'Javier', 70000, 'devolucion_aportacion')$$, '23514', null, 'F09: devolver 700.00 con 600.00 pendiente se rechaza');
select throws_ok($$select operacion.registrar_pago_a_socio('n906c4', 'Javier', 100, 'reembolso')$$, '23514', null, 'reembolso sin nada pendiente se rechaza');

-- ---- Escenario completo en la base: utilidad 20,000.00, gastos Javier 2,221.00 y Angelo 500.00 -------------------------------------------
select catalogo.asegurar_cliente('N906 Cliente', 'Angelo');
select catalogo.asegurar_modelo('N906 Marca', 'N906 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('N906 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('n906k1', 'Isaac', 'N906 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('n906k2', 'N906 Cliente', 'N906 Modelo 30K', 30000, '2020-01-01', 'chat');
select operacion.crear_pedido('n906pe', pg_temp.cid('N906 Cliente'), '[{"modelo":"N906 Modelo 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2020-09-08');
select operacion.confirmar_pedido('n906pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n906pe'));
select is((operacion.enviar_pedido('n906pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n906pe'), null, '{"paqueteria":"Castores","numero":"N906-G1","costo_cent":0}'::jsonb, '2020-09-08', true)->>'total_cent')::bigint, 3000000::bigint, 'pedido directo de 30,000.00 (100 pz x 300.00)');
select is((operacion.utilidad_periodo('2020-09-07', '2020-09-13')->>'utilidad_cent')::bigint, 2000000::bigint, 'utilidad antes de gastos: 20,000.00 (30,000 - 100 x 100.00)');
select operacion.registrar_gasto_socio('n906gj', 'Javier', 222100, 'costos del sistema', 'fijo', '2020-09-09', null, 'Suscripciones del mes');
select operacion.registrar_gasto_socio('n906ga', 'Angelo', 50000, 'envio', 'variable', '2020-09-10', null, 'Guia a Monterrey');
select is((operacion.utilidad_periodo('2020-09-07', '2020-09-13')->>'gastos_cent')::bigint, 272100::bigint, 'los gastos de los dos socios suman 2,721.00 UNA sola vez');
select is((operacion.utilidad_periodo('2020-09-07', '2020-09-13')->>'utilidad_cent')::bigint, 1727900::bigint, 'utilidad neta 17,279.00');
select is(operacion.reembolso_pendiente(pg_temp.sid('Javier')), 222100::bigint, 'reembolso pendiente de Javier: 2,221.00 (una sola vez)');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 50000::bigint, 'reembolso pendiente de Angelo: 500.00 (una sola vez)');
select operacion.registrar_pago('n906py1', 'Angelo', 1000000, pg_temp.cid('N906 Cliente'), null, true, 'abono', '2020-09-09');
select operacion.registrar_pago('n906py2', 'Javier', 1000000, pg_temp.cid('N906 Cliente'), null, true, 'abono', '2020-09-09');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 1000000::bigint, 'Angelo tiene 10,000.00 de la sociedad');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos'), 1000000::bigint, 'Javier tiene 10,000.00 de la sociedad');
create temp table _vivo as select operacion.cascada_periodo('2020-09-07', '2020-09-13', 0, true) as c;
select is((select (c->>'repartible_cent')::bigint from _vivo), 1667900::bigint, 'en la base: la aportacion de capital pendiente de Javier (600.00) se devuelve antes de repartir -> repartible 16,679.00');
create temp table _vivo2 as select operacion.cascada_periodo('2020-09-07', '2020-09-13', 0, false) as c;
select is((select (c->>'repartible_cent')::bigint from _vivo2), 1727900::bigint, 'sin devolver antes: repartible 17,279.00');
select is((select (c->'por_socio'->'Angelo'->>'utilidad_cent')::bigint from _vivo2), 863950::bigint, 'en la base: 8,639.50 a Angelo');
select is((select (c->'por_socio'->'Javier'->>'utilidad_cent')::bigint from _vivo2), 863950::bigint, 'en la base: 8,639.50 a Javier');
select is((select (c->'por_socio'->'Angelo'->>'resultado_cent')::bigint from _vivo2), -86050::bigint, 'en la base: Angelo devuelve 860.50');
select is((select (c->>'identidad_cuadra')::boolean from _vivo2), true, 'en la base: la identidad cuadra');

-- Un gasto de socio no se duplica por reenviarlo con la misma clave, y los estados de cuenta se mueven una sola vez
select operacion.registrar_gasto_socio('n906gj', 'Javier', 222100, 'costos del sistema', 'fijo', '2020-09-09', null, 'Suscripciones del mes');
select is(operacion.reembolso_pendiente(pg_temp.sid('Javier')), 222100::bigint, 'repetir la misma clave: el reembolso sigue en 2,221.00');
select is((select count(*)::int from operacion.gasto where categoria = 'costos del sistema' and fecha_neg = '2020-09-09'), 1, 'y un solo gasto');

-- eco_socio, dias_fondos_en_poder y cuenta_socios
select ok(operacion.eco_socio(pg_temp.sid('Javier')) ? 'neto_cent', 'eco_socio: trae el neto del socio');
select is((operacion.eco_socio(pg_temp.sid('Javier'))->>'neto_cent')::bigint, operacion.neto_socio(pg_temp.sid('Javier')), 'eco_socio: coincide con neto_socio');
select ok(operacion.dias_fondos_en_poder(pg_temp.sid('Javier')) is null or operacion.dias_fondos_en_poder(pg_temp.sid('Javier')) >= 0, 'dias_fondos_en_poder: numero no negativo o sin dato');
select ok(jsonb_typeof(operacion.cuenta_socios()) = 'object', 'cuenta_socios: objeto');

select * from finish();
rollback;
