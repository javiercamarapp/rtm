-- pgTAP dinero entre socios: cascada pura (casos dorados, mismas cifras que test/unit/dinero/reparto.test.ts), efectivo calculado, intencion obligatoria,
-- orden de fondeo, gasto doble por envio, topes y retiro de capital explicito. Casos G1 a G18 de la auditoria 01; el acta y la contra-acta estan en 016.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f15.angelo@example.test', 'socio', 'Angelo', true), ('f15.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a1555555-5555-5555-5555-555555555551', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f15.angelo@example.test'),
  ('a1555555-5555-5555-5555-555555555552', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f15.javier@example.test');
select set_config('request.jwt.claim.sub', 'a1555555-5555-5555-5555-555555555551', true);

create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'a1555555-5555-5555-5555-555555555551' else 'a1555555-5555-5555-5555-555555555552' end, true); end $$;

-- Punto de partida limpio: lo pendiente, lo que cada socio debe y el efectivo se llevan a cero con renglones de ajuste.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-015', '{}'::jsonb);
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_reembolso', -operacion.aportado_socio(s.id, 'reembolsable') - operacion.libro_socio(s.id, 'pago_reembolso'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'reembolsable') + operacion.libro_socio(s.id, 'pago_reembolso') <> 0;
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_devolucion_aportacion', -operacion.aportado_socio(s.id, 'capital') - operacion.libro_socio(s.id, 'pago_devolucion_aportacion'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'capital') + operacion.libro_socio(s.id, 'pago_devolucion_aportacion') <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select c.id, negocio.hoy(), 'ajuste_conteo', -operacion.saldo_efectivo(c.id), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from operacion.cuenta_efectivo c where operacion.saldo_efectivo(c.id) <> 0;
select is(operacion.saldo_efectivo(), 0::bigint, 'punto de partida: sin efectivo');

-- ---- Casos dorados de la cascada pura --------------------------------------------------------------------------------------------------------------
create function pg_temp.k(u bigint, arr bigint, caja bigint, comp bigint, r jsonb default '{"Angelo":0,"Javier":0}', ap jsonb default '{"Angelo":0,"Javier":0}', po jsonb default '{"Angelo":0,"Javier":0}',
                          de jsonb default '{"Angelo":0,"Javier":0}', an jsonb default '{"Angelo":0,"Javier":0}', rotor int default 0) returns jsonb language sql immutable
as $$ select operacion.cascada_calcular(u, arr, caja, comp, r, ap, po, de, an, '{"Angelo":500000,"Javier":500000}', rotor) $$;
create function pg_temp.g(c jsonb, socio text, campo text) returns bigint language sql immutable as $$ select (c->'por_socio'->socio->>campo)::bigint $$;

-- Ejemplo del dueno: 20,000 antes de gastos; Javier pago 2,221 y Angelo 500; utilidad neta 17,279; 8,639.50 para cada uno mas reembolsos.
create temp table _dueno as select pg_temp.k(1727900, 0, 2000000, 0, '{"Angelo":50000,"Javier":222100}') as c;
select is((select (c->>'repartible_cent')::bigint from _dueno), 1727900::bigint, 'dueno: utilidad neta repartible 17,279.00');
select is((select pg_temp.g(c, 'Angelo', 'utilidad_cent') from _dueno), 863950::bigint, 'dueno: 8,639.50 para Angelo');
select is((select pg_temp.g(c, 'Javier', 'utilidad_cent') from _dueno), 863950::bigint, 'dueno: 8,639.50 para Javier');
select is((select pg_temp.g(c, 'Javier', 'paga_reembolso_cent') from _dueno), 222100::bigint, 'dueno: Javier recibe ademas 2,221.00 de reembolso');
select is((select pg_temp.g(c, 'Angelo', 'paga_reembolso_cent') from _dueno), 50000::bigint, 'dueno: Angelo recibe ademas 500.00 de reembolso');
select is((select (c->>'identidad_cuadra')::boolean from _dueno), true, 'dueno: la identidad cuadra');

-- Adenda 21: utilidad 12,000; Angelo 500 y Javier 2,221 de reembolso; Angelo tiene 8,000 y Javier 6,721 de la sociedad.
create temp table _a21 as select pg_temp.k(1200000, 0, 0, 0, '{"Angelo":50000,"Javier":222100}', po => '{"Angelo":800000,"Javier":672100}', de => '{"Angelo":800000,"Javier":672100}') as c;
select is((select pg_temp.g(c, 'Angelo', 'asignado_cent') from _a21), 650000::bigint, 'adenda 21: le corresponde a Angelo 6,500.00');
select is((select pg_temp.g(c, 'Javier', 'asignado_cent') from _a21), 822100::bigint, 'adenda 21: le corresponde a Javier 8,221.00');
select is((select c->'liquidar' from _a21), '{"de": "Angelo", "a": "Javier", "monto_cent": 150000}'::jsonb, 'adenda 21: Angelo paga 1,500.00 a Javier y quedan en paz');
select is((select (c->>'remanente_cent')::bigint from _a21), 0::bigint, 'adenda 21: no sobra efectivo');

-- G1 retiro previo (H1): utilidad 12,000 y Angelo ya retiro 5,000.
create temp table _g1 as select pg_temp.k(1200000, 0, 1200000, 0, an => '{"Angelo":500000,"Javier":0}') as c;
select is((select pg_temp.g(c, 'Angelo', 'asignado_cent') from _g1), 100000::bigint, 'G1: Angelo recibe 1,000.00 (ya tomo 5,000.00)');
select is((select pg_temp.g(c, 'Javier', 'asignado_cent') from _g1), 600000::bigint, 'G1: Javier recibe 6,000.00');
select is((select (c->>'remanente_cent')::bigint from _g1), 500000::bigint, 'G1: quedan 5,000.00 en la caja');
-- G2 utilidad retenida y G3 perdida arrastrada (H2).
create temp table _g2 as select pg_temp.k(1000000, 0, 300000, 0) as c;
select is((select (c->>'repartible_cent')::bigint from _g2), 300000::bigint, 'G2: semana 1 reparte 3,000.00');
select is((select (c->>'arrastre_fin_cent')::bigint from _g2), 700000::bigint, 'G2: quedan 7,000.00 de utilidad retenida');
select is((select (pg_temp.k(200000, (c->>'arrastre_fin_cent')::bigint, 900000, 0)->>'repartible_cent')::bigint from _g2), 900000::bigint, 'G2: semana 2 reparte 9,000.00 (2,000 + 7,000)');
create temp table _g3 as select pg_temp.k(-600000, 0, 1000000, 0) as c;
select is((select (c->>'arrastre_fin_cent')::bigint from _g3), -600000::bigint, 'G3: la perdida de 6,000.00 se arrastra');
select is((select (pg_temp.k(500000, (c->>'arrastre_fin_cent')::bigint, 1000000, 0)->>'repartible_cent')::bigint from _g3), 0::bigint, 'G3: la utilidad de 5,000.00 no se reparte hasta cubrir la perdida');
select is((select (pg_temp.k(500000, (c->>'arrastre_fin_cent')::bigint, 1000000, 0)->>'arrastre_fin_cent')::bigint from _g3), -100000::bigint, 'G3: queda una perdida acumulada de 1,000.00');
-- G4 perdida con capital desigual (H4): el capital no se devuelve solo; la perdida cae 50/50.
create temp table _g4 as select pg_temp.k(-1000000, 0, 9000000, 0, ap => '{"Angelo":7000000,"Javier":3000000}') as c;
select is((select pg_temp.g(c, 'Angelo', 'asignado_cent') + pg_temp.g(c, 'Javier', 'asignado_cent') from _g4), 0::bigint, 'G4: con perdida no se devuelve capital ni se reparte');
select is((select (c->>'arrastre_fin_cent')::bigint from _g4), -1000000::bigint, 'G4: la perdida de 10,000.00 se absorbe 50/50 con las utilidades siguientes');
select is((select (c->>'remanente_cent')::bigint from _g4), 9000000::bigint, 'G4: el efectivo se queda en la sociedad');
-- G12 anticipo de cliente no es efectivo repartible; G13 proveedores primero (H3).
select is((pg_temp.k(1000000, 0, 0, 900000, po => '{"Angelo":900000,"Javier":0}', de => '{"Angelo":900000,"Javier":0}')->>'repartible_cent')::bigint, 0::bigint, 'G12: 9,000.00 de anticipo no se reparten como utilidad');
select is((pg_temp.k(1000000, 0, 2000000, 1800000)->>'repartible_cent')::bigint, 200000::bigint, 'G13: caja 20,000, proveedores 18,000: repartible 2,000.00');
-- G14 redondeo unico: rota entre periodos y favorece a quien paga.
select is(pg_temp.g(pg_temp.k(100001, 0, 100001, 0, rotor => 0), 'Angelo', 'utilidad_cent'), 50001::bigint, 'G14: periodo par, el centavo es de Angelo');
select is(pg_temp.g(pg_temp.k(100001, 0, 100001, 0, rotor => 1), 'Javier', 'utilidad_cent'), 50001::bigint, 'G14: periodo impar, el centavo es de Javier');
select is(pg_temp.g(pg_temp.k(100001, 0, 100501, 0, r => '{"Angelo":0,"Javier":500}', rotor => 0), 'Javier', 'utilidad_cent'), 50001::bigint, 'G14: quien tiene reembolso pendiente se queda el centavo');
select is(operacion.repartir_proporcional(100000, '{"A":333333,"B":333333,"C":333334}'), '{"A": 33334, "B": 33333, "C": 33333}'::jsonb, 'G14: tres socios simulados suman exacto');
-- G16 identidad real: el faltante de 1,098.55 no es efectivo.
create temp table _g16 as select pg_temp.k(1000000, 0, 1000000, 0, de => '{"Angelo":109855,"Javier":0}') as c;
select is((select (c->>'suma_resultados_cent')::bigint from _g16), 890145::bigint, 'G16: suma de resultados = asignado menos la deuda');
select is((select (c->'identidad'->>'deuda_no_efectivo_cent')::bigint from _g16), 109855::bigint, 'G16: la deuda que no es efectivo se declara aparte');
select is((select (c->'identidad'->>'via1_cent') = (c->'identidad'->>'via2_cent') from _g16), true, 'G16: las dos vias coinciden');

-- Propiedad: en 400 casos la identidad cuadra, el remanente y las asignaciones no son negativos y no se reparte mas utilidad que la que hay.
select setseed(0.2718);
create temp table _casos as
  select g, (random() * 4000000)::bigint - 500000 as u, (random() * 3000000)::bigint as caja, (random() * 800000)::bigint as ra, (random() * 800000)::bigint as rj,
         (random() * 1500000)::bigint as pa, (random() * 1500000)::bigint as pj, (random() * 9)::int as rotor
  from generate_series(1, 400) g;
create temp table _prop as
  select g, pg_temp.k(u, 0, caja, 0, jsonb_build_object('Angelo', ra, 'Javier', rj), po => jsonb_build_object('Angelo', pa, 'Javier', pj), de => jsonb_build_object('Angelo', pa, 'Javier', pj), rotor => rotor) as c from _casos;
select is((select count(*)::int from _prop where not (c->>'identidad_cuadra')::boolean), 0, 'propiedad: la identidad cuadra por dos vias en 400 casos');
select is((select count(*)::int from _prop p where exists (select 1 from jsonb_each(p.c->'por_socio') e where (e.value->>'asignado_cent')::bigint < 0) or (p.c->>'remanente_cent')::bigint < 0), 0, 'propiedad: nada negativo');
select is((select count(*)::int from _prop p where (p.c->>'repartible_cent')::bigint > greatest((p.c->>'utilidad_cent')::bigint, 0)), 0, 'propiedad: no se reparte mas utilidad que la que hay');

-- ---- Capturas: intencion obligatoria, efectivo calculado y orden de fondeo ---------------------------------------------------------------------------
select throws_ok($$select operacion.registrar_aportacion('k0', 'Javier', 100000, 'Dinero de Javier')$$, '42883', null, 'la intencion es obligatoria: sin ella la captura ni existe');
select throws_ok($$select operacion.registrar_aportacion('k0', 'Javier', 100000, 'Dinero de Javier', 'regalo')$$, '23502', null, 'una intencion que no es capital ni reembolso se rechaza');
select is(operacion.registrar_aportacion('k1', 'Javier', 100000, 'Metimos mas lana para inventario', 'capital')->>'clasificacion', 'capital', 'declarar capital = aportacion de capital');
select is(operacion.registrar_aportacion('k2', 'Javier', 50000, 'Deposito para cubrir costos', 'reembolso')->>'clasificacion', 'reembolsable', 'todo lo demas es reembolso / cuenta por pagar');
select is(operacion.saldo_efectivo(), 150000::bigint, 'el efectivo sale de las cuentas: 1,500.00 en la caja');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 100000::bigint, 'capital de Javier 1,000.00');
select is(operacion.reembolso_pendiente(pg_temp.sid('Javier')), 50000::bigint, 'reembolso pendiente de Javier 500.00');
select is(operacion.sugerir_fondeo(120000), '{"monto_cent": 120000, "desde_caja_cent": 120000, "desde_socio_cent": 0}'::jsonb, 'fondeo: si la caja alcanza se usa la caja');
select is(operacion.sugerir_fondeo(200000), '{"monto_cent": 200000, "desde_caja_cent": 150000, "desde_socio_cent": 50000}'::jsonb, 'fondeo: la caja primero y despues el dinero de un socio');
select is((operacion.registrar_gasto_socio('k3', 'Angelo', 30000, 'uber', 'variable', null, null, 'Traslado', 'Pague 300 de uber')->>'caja_alcanzaba')::boolean, true, 'el gasto de socio avisa que la caja alcanzaba');
select is((operacion.registrar_gasto_empresa('k4', 20000, 'papeleria')->'efectivo'->>'caja_empresa_cent')::bigint, 130000::bigint, 'gasto con efectivo de la empresa baja la caja');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 30000::bigint, 'el gasto de la empresa no deja reembolso a nadie');
select throws_ok($$select operacion.registrar_gasto_empresa('k5', 999999, 'comida')$$, '23514', null, 'el gasto de la empresa no excede la caja');
-- G6 gasto doble por envio (H6): el pedido ya tiene guia con costo.
select catalogo.asegurar_cliente('F15 Cliente', 'Angelo');
select catalogo.asegurar_modelo('F15 Marca', 'F15 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F15 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('f15cc', 'Isaac', 'F15 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f15cp', 'F15 Cliente', 'F15 Modelo 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('f15pe', (select id from catalogo.cliente where nombre_canonico = 'F15 Cliente'), '[{"modelo":"F15 Modelo 30K","sabor":"Sandia","piezas":10}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2020-03-03');
select operacion.confirmar_pedido('f15pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f15pe'));
select operacion.enviar_pedido('f15pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f15pe'), null, '{"paqueteria":"Castores","numero":"F15-G6","costo_cent":50000}'::jsonb, '2020-03-03', true);
select throws_ok($$select operacion.registrar_gasto_socio('k6', 'Angelo', 50000, 'envio', 'variable', null, (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f15pe'))$$, 'P0428', null, 'G6: pague 500 de envio de un pedido con guia se rechaza');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 30000::bigint, 'G6: el reembolso no se duplica');
select throws_ok($$select operacion.registrar_gasto_socio('k7', 'Angelo', 30000, 'uber', 'variable', null, null, 'Traslado', 'Otra vez')$$, 'P0428', null, 'un gasto igual del mismo socio en los ultimos dias pide confirmacion');
select lives_ok($$select operacion.registrar_gasto_socio('k7', 'Angelo', 30000, 'uber', 'variable', null, null, 'Traslado', 'Otra vez', true)$$, 'confirmado como otro gasto, se registra');

-- G9 retiro sin saldo, G10 liquidacion sin deuda, G18 pago repetido (H10, H12).
select throws_ok($$select operacion.registrar_pago_a_socio('k8', 'Angelo', 500000, 'retiro')$$, '23514', null, 'G9: un retiro no excede la utilidad que se le debe al socio');
select throws_ok($$select operacion.registrar_pago_a_socio('k8b', 'Javier', 10000, 'devolucion_aportacion')$$, 'P0428', null, 'la devolucion de capital ya no es automatica');
select throws_ok($$select operacion.registrar_liquidacion_entre_socios('k9', 'Javier', 'Angelo', 500000)$$, '23514', null, 'G10: nadie liquida lo que no debe a la sociedad');
select lives_ok($$select operacion.registrar_pago_a_socio('k10', 'Javier', 50000, 'reembolso')$$, 'G18: el primer pago de 500.00 se acepta');
select throws_ok($$select operacion.registrar_pago_a_socio('k11', 'Javier', 50000, 'reembolso')$$, '23514', null, 'G18: el segundo pago de 500.00 con otra clave excede lo pendiente');
select is(operacion.saldo_efectivo(), 80000::bigint, 'el pago salio de la caja: quedan 800.00');

-- G8 anular un gasto ya reembolsado (H11): el sobrepago es deuda del socio y entra a la cascada.
select operacion.registrar_gasto_socio('k12', 'Javier', 40000, 'papeleria', 'variable', null, null, 'Resmas');
select operacion.registrar_pago_a_socio('k13', 'Javier', 40000, 'reembolso');
select lives_ok($$select operacion.anular_movimiento_socio('k14', 'aportacion', (select a.id from operacion.aportacion_socio a join operacion.gasto g on g.id = a.ref_id and a.ref_tipo = 'gasto' where g.categoria = 'papeleria' and g.monto_cent = 40000 and a.reversa_de is null order by a.id desc limit 1), 'gasto duplicado')$$, 'G8: se anula el gasto ya reembolsado');
select is(operacion.sobrepago_socio(pg_temp.sid('Javier')), 40000::bigint, 'G8: el sobrepago de 400.00 queda visible');
select is(pg_temp.g(operacion.cascada_periodo(negocio.hoy(), negocio.hoy()), 'Javier', 'debe_cent'), 40000::bigint, 'G8: y la cascada lo cobra como deuda de Javier');

-- G12 persistente: el anticipo de un cliente en la cuenta de un socio no cuenta como efectivo disponible.
select catalogo.asegurar_cliente('F15 Cliente Anticipo', 'Angelo');
select operacion.registrar_pago('k15', 'Angelo', 900000, (select id from catalogo.cliente where nombre_canonico = 'F15 Cliente Anticipo'), null, true, 'anticipo', negocio.hoy());
select is((operacion.efectivo_sociedad()->>'en_poder_cent')::bigint, 900000::bigint, 'G12: el dinero esta en poder de Angelo');
select is((operacion.efectivo_sociedad()->'comprometido'->>'anticipos_cent')::bigint, 900000::bigint, 'G12: y se aparta como anticipo del cliente');
select is((operacion.efectivo_sociedad()->>'disponible_cent')::bigint, operacion.saldo_efectivo()::bigint, 'G12: disponible = solo el efectivo de la caja');

-- ---- Movimientos de efectivo y retiro de capital explicito -----------------------------------------------------------------------------------------
select is((operacion.registrar_movimiento_efectivo('k16', 'Caja de la empresa', 'traspaso', 10000, null, null, 'Efectivo de Angelo')->'efectivo'->>'cuentas_total_cent')::bigint, operacion.saldo_efectivo()::bigint, 'un traspaso entre cuentas no cambia el efectivo total');
select throws_ok($$select operacion.registrar_movimiento_efectivo('k17', 'Efectivo de Angelo', 'ajuste_conteo', -99999999)$$, '23514', null, 'una cuenta de efectivo no queda en negativo');
create temp table _rc as select (operacion.proponer_retiro_capital('k18', 'Javier', 100000, 'Devolver el capital de Javier')->>'retiro_id')::bigint as id;
select throws_ok($$select operacion.confirmar_retiro_capital('k19', (select id from _rc))$$, 'P0428', null, 'quien propone el retiro de capital no lo confirma: lo acuerdan los dos');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 100000::bigint, 'antes de confirmar el capital sigue pendiente');
select throws_ok($$select operacion.proponer_retiro_capital('k21', 'Javier', 200000, 'de mas')$$, '23514', null, 'el retiro de capital no excede el capital pendiente');
select pg_temp.como('Javier');
select throws_ok($$select operacion.confirmar_retiro_capital('k19a', (select id from _rc))$$, '23514', null, 'el retiro de capital tampoco excede el efectivo de la caja');
select operacion.registrar_aportacion('k22', 'Javier', 100000, 'Deposito para devolver capital', 'reembolso');
select lives_ok($$select operacion.confirmar_retiro_capital('k19b', (select id from _rc))$$, 'el otro socio confirma el retiro de capital');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 0::bigint, 'y el capital pendiente baja');
select throws_ok($$select operacion.confirmar_retiro_capital('k19c', (select id from _rc))$$, 'P0428', null, 'un retiro de capital no se confirma dos veces');

select * from finish();
rollback;
