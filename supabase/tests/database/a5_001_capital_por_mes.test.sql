-- pgTAP a5_001: Capital por mes y por socio (api.capital_por_mes). Escenario SINTETICO de dos meses (octubre y noviembre de 2026) con la estructura que pidio el dueno:
--   dos socios con aportaciones de capital desiguales (118,161.91 y 105,715.00; cifras de ejemplo, no ligadas a personas), utilidad 53,660.73 repartida 50/50, utilidad reinvertida parcial
--   por acta (5,000.00 y 2,000.00) y en el proveedor (5,000.00), un retiro, fondos de la sociedad en poder de un socio (35,475.00 por el cobro de un cliente), Karen con deuda (12,000.00) e Isaac
--   con saldo a favor y 62,161.91 pagados por un socio SIN destino confirmado ('Por clasificar'). Verifica las identidades K1 a K9 y que cada cifra cuadre contra Estado de resultados, Balance y Libro.
-- pgTAP corre en una sola transaccion: el trigger diferido de partida doble se fuerza con `set constraints all immediate` justo despues de firmar el acta (lo que haria el COMMIT).
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cap.ang@example.test', 'socio', 'Angelo', true), ('cap.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777c1' else '77777777-7777-7777-7777-7777777777c2' end, true) $$;
create function pg_temp.cap() returns jsonb language sql as $$ select api.capital_por_mes('2026-10-01', '2026-11-30') $$;
create function pg_temp.fila(p_mes text, p_socio text) returns jsonb language sql as
  $$ select x from jsonb_array_elements(pg_temp.cap()->'meses') m, jsonb_array_elements(m->'periodo'->'socios') x where m->>'mes' = $1 and x->>'socio' = $2 $$;
create function pg_temp.ac(p_socio text) returns jsonb language sql as
  $$ select x from jsonb_array_elements(pg_temp.cap()->'acumulado'->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.prov(p_mes text, p_prov text) returns jsonb language sql as
  $$ select x from jsonb_array_elements(pg_temp.cap()->'meses') m, jsonb_array_elements(m->'periodo'->'proveedores') x where m->>'mes' = $1 and x->>'proveedor' = $2 $$;
select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('CAP Marca', 'CAP Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('CAP Modelo', 'Uva');
select catalogo.fijar_costo('cap-c', 'Isaac', 'CAP Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_modelo('CAP Marca', 'CAP Karen', 25000, 'ambas');
select catalogo.asegurar_sku('CAP Karen', 'Mango');
select catalogo.fijar_costo('cap-ck', 'Karen', 'CAP Karen', 8000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('CAP Cliente', 'Javier');
select catalogo.fijar_precio('cap-p', 'CAP Cliente', 'CAP Modelo', 20000, '2020-01-01', 'chat');
-- Octubre
select operacion.registrar_aportacion('cap-a1', 'Angelo', 11816191, 'Capital inicial', 'capital', '2026-10-15');
select operacion.registrar_aportacion('cap-a2', 'Javier', 10571500, 'Capital inicial', 'capital', '2026-10-19');
select operacion.pago_proveedor_de_socio('cap-pp1', 'Isaac', 6216191, 'Javier', 'dinero_propio', '2026-10-21', 'Pago de Javier a Isaac, destino por confirmar');
select catalogo.fijar_precio('cap-pk', 'CAP Cliente', 'CAP Karen', 15000, '2020-01-01', 'chat');
-- Noviembre: ventas
select operacion.crear_pedido('cap-v1', (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), '[{"modelo":"CAP Modelo","sabor":"Uva","piezas":400}]'::jsonb, 'isaac_directo', null, 316073, 0, 0, '2026-11-03');
select operacion.confirmar_pedido('cap-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v1'));
select operacion.enviar_pedido('cap-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v1'), null, '{"paqueteria":"Castores","numero":"CAP-G1","costo_cent":0}'::jsonb, '2026-11-03', true);
select operacion.crear_pedido('cap-v2', (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), '[{"modelo":"CAP Karen","sabor":"Mango","piezas":150}]'::jsonb, 'karen_directo', null, 0, 0, 0, '2026-11-04');
select operacion.confirmar_pedido('cap-v2c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v2'));
select operacion.enviar_pedido('cap-v2e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v2'), null, '{"paqueteria":"Castores","numero":"CAP-G2","costo_cent":0}'::jsonb, '2026-11-04', true);
select operacion.registrar_pago('cap-pg2', 'Efectivo', 2518573, (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), null, true, 'abono', '2026-11-08');
select operacion.registrar_pago('cap-pg3', 'Isaac', 4500000, (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), null, true, 'abono', '2026-11-09');
select pg_temp.como('Angelo');
select operacion.proponer_cierre_reparto('cap-ac1', '2026-11-01', '2026-11-11', '{"Angelo":{"retira":300000,"reinvierte":500000},"Javier":{"retira":0,"reinvierte":200000}}');
select pg_temp.como('Angelo');
select operacion.firmar_cierre_reparto('cap-ac2', (select max(id) from operacion.cierre_reparto));
select pg_temp.como('Javier');
select operacion.firmar_cierre_reparto('cap-ac3', (select max(id) from operacion.cierre_reparto));
set constraints all immediate;
select operacion.registrar_pago('cap-pg1', 'Javier', 3547500, (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), null, true, 'abono', '2026-11-12');
select operacion.registrar_pago_a_socio('cap-ret1', 'Angelo', 300000, 'retiro', 'efectivo', '2026-11-12');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');

-- Forma y alcance
select is(jsonb_array_length(pg_temp.cap()->'meses'), 2, 'dos meses: octubre y noviembre de 2026');
select is(pg_temp.cap()->'meses'->0->>'mes', '2026-10', 'el primer mes es octubre');
select is(pg_temp.cap()->'meses'->1->>'mes', '2026-11', 'el segundo es noviembre');
select ok(pg_temp.cap() ? 'fuentes' and pg_temp.cap() ? 'acumulado', 'trae las fuentes de cada cifra y el acumulado');

-- Octubre: aportaciones desiguales de capital, sin utilidad todavia
select is((pg_temp.fila('2026-10', 'Angelo')->>'aportaciones_capital_cent')::bigint, 11816191::bigint, 'octubre: Angelo declara 118,161.91 de capital');
select is((pg_temp.fila('2026-10', 'Javier')->>'aportaciones_capital_cent')::bigint, 10571500::bigint, 'octubre: Javier declara 105,715.00 de capital');
select is((pg_temp.fila('2026-10', 'Javier')->>'reembolso_puesto_acum_cent')::bigint, 6216191::bigint, 'el pago de Javier a Isaac es dinero puesto como reembolso, no capital');
select is((pg_temp.fila('2026-10', 'Angelo')->>'utilidad_generada_cent')::bigint, 0::bigint, 'octubre: sin utilidad generada');
select is(jsonb_array_length(pg_temp.fila('2026-10', 'Angelo')->'aportaciones_detalle'), 1, 'el detalle de aportaciones trae el movimiento con fecha, concepto y origen');
select is(pg_temp.fila('2026-10', 'Angelo')->'aportaciones_detalle'->0->>'origen', 'Caja: Caja de la empresa', 'origen: la caja a la que entro el deposito');
select is(pg_temp.fila('2026-10', 'Angelo')->'aportaciones_detalle'->0->>'fecha', '2026-10-15', 'con su fecha');
select is((pg_temp.fila('2026-10', 'Angelo')->>'pct_valuacion_bp')::int, 5278, 'octubre: participacion en libros de Angelo 52.78 %');
select is((pg_temp.fila('2026-10', 'Angelo')->>'pct_capital_bp')::int, (pg_temp.fila('2026-10', 'Angelo')->>'pct_valuacion_bp')::int, 'sin utilidad la participacion en libros es la de las aportaciones');

-- Noviembre: utilidad 53,660.73 repartida 50/50 (regla del Estado de resultados)
select is((pg_temp.fila('2026-11', 'Angelo')->>'utilidad_generada_cent')::bigint + (pg_temp.fila('2026-11', 'Javier')->>'utilidad_generada_cent')::bigint, 5366073::bigint, 'noviembre: utilidad generada 53,660.73');
select is((pg_temp.fila('2026-11', 'Angelo')->>'utilidad_generada_cent')::bigint, 2683037::bigint, 'Angelo: su mitad (el centavo suelto como en el Estado de resultados)');
select is((pg_temp.fila('2026-11', 'Javier')->>'utilidad_generada_cent')::bigint, 2683036::bigint, 'Javier: la otra mitad');
select is((pg_temp.cap()->'meses'->1->'periodo'->'estado_resultados'->>'utilidad_neta_cent')::bigint, 5366073::bigint, 'cuadra contra el Estado de resultados del mes');
select is((contabilidad.estado_resultados('2026-11-01', '2026-11-30')->>'utilidad_neta_cent')::bigint, 5366073::bigint, 'y es la que calcula contabilidad.estado_resultados');

-- Utilidad reinvertida (acta y proveedor), retirada y fondos en poder
select is((pg_temp.fila('2026-11', 'Angelo')->>'utilidad_reinvertida_acta_cent')::bigint, 500000::bigint, 'acta: Angelo reinvierte 5,000.00');
select is((pg_temp.fila('2026-11', 'Javier')->>'utilidad_reinvertida_acta_cent')::bigint, 200000::bigint, 'acta: Javier reinvierte 2,000.00 (parcial)');
select is((pg_temp.cap()->'meses'->1->'periodo'->'total'->>'utilidad_reinvertida_proveedor_cent')::bigint, 500000::bigint, 'reinvertida en el proveedor: 5,000.00 respaldados por utilidad, a partes iguales');
select is((pg_temp.fila('2026-11', 'Angelo')->>'utilidad_reinvertida_cent')::bigint, 750000::bigint, 'Angelo: reinvertida total = acta + proveedor');
select is((pg_temp.fila('2026-11', 'Angelo')->>'utilidad_retirada_cent')::bigint, 300000::bigint, 'retirada: Angelo retiro 3,000.00');
select is((pg_temp.fila('2026-11', 'Javier')->>'utilidad_retirada_cent')::bigint, 0::bigint, 'Javier no retiro');
select is((pg_temp.fila('2026-11', 'Angelo')->>'utilidad_retenida_cent')::bigint, 2383037::bigint, 'retenida = generada - retirada');
select is((pg_temp.fila('2026-11', 'Javier')->>'fondos_en_poder_cent')::bigint, 3547500::bigint, 'fondos de la sociedad en poder de Javier: 35,475.00');
select is((pg_temp.fila('2026-11', 'Angelo')->>'fondos_en_poder_cent')::bigint, 0::bigint, 'Angelo no tiene fondos de la sociedad');
select matches(pg_temp.fila('2026-11', 'Javier')->'fondos_detalle'->0->>'motivo', '^Pago PG-[0-9]+ en la cuenta de Javier$', 'el motivo es el cobro que cayo en su cuenta');
select is(pg_temp.fila('2026-11', 'Javier')->'fondos_detalle'->0->>'cliente', 'CAP Cliente', 'con el cliente que pago');
select is((pg_temp.fila('2026-10', 'Javier')->>'fondos_en_poder_cent')::bigint, 0::bigint, 'en octubre no habia fondos en poder (la tabla es por mes)');

-- Aportacion neta y diferencia a igualar
select is((pg_temp.fila('2026-11', 'Javier')->>'aportacion_neta_cent')::bigint, (pg_temp.fila('2026-11', 'Javier')->>'aportado_cent')::bigint - 3547500, 'aportacion neta = aportado - fondos en su poder');
select is((pg_temp.fila('2026-11', 'Javier')->>'aportacion_neta_cent')::bigint, operacion.aportado_socio((select id from catalogo.socio where nombre = 'Javier')) - 3547500, 'y es la del auxiliar de socios');
select is((pg_temp.fila('2026-11', 'Javier')->>'diferencia_a_igualar_cent')::bigint, 0::bigint, 'Javier tiene la mayor aportacion neta: nada que igualar');
select is((pg_temp.fila('2026-11', 'Angelo')->>'diferencia_a_igualar_cent')::bigint, 13440191 - 12316191::bigint, 'Angelo: la diferencia a igualar es lo que le falta para alcanzar la mayor');

-- Valuacion personal y participacion: crece con la utilidad retenida
select is((pg_temp.cap()->'meses'->1->'periodo'->'total'->>'valuacion_cent')::bigint, 27453764::bigint, 'valuacion total de noviembre: capital 230,876.91 + utilidad 53,660.73 - retiro 3,000.00');
select is((pg_temp.fila('2026-11', 'Angelo')->>'valuacion_cent')::bigint + (pg_temp.fila('2026-11', 'Javier')->>'valuacion_cent')::bigint, (contabilidad.balance_general('2026-11-30')->>'total_capital_cent')::bigint, 'la suma de las valuaciones personales es el capital contable del Balance');
select is((contabilidad.valuacion('2026-11-30')->>'v03_diferencia_cent')::bigint, 27453764::bigint, 'y la valuacion menos deudas de contabilidad.valuacion');
select ok((pg_temp.fila('2026-11', 'Javier')->>'pct_valuacion_bp')::int > (pg_temp.fila('2026-11', 'Javier')->>'pct_capital_bp')::int, 'Javier: sin retirar su participacion en libros (48.28 %) supera su parte del capital (46.65 %)');
select ok(abs((pg_temp.fila('2026-11', 'Angelo')->>'otros_cent')::bigint) <= 1 and abs((pg_temp.fila('2026-11', 'Javier')->>'otros_cent')::bigint) <= 1, 'el unico residuo de la valuacion es el redondeo de un centavo del acta contra el Estado de resultados');

-- Proveedores: Karen se le debe; Isaac saldo a favor; lo pagado por un socio sin destino confirmado, por clasificar
select is(pg_temp.prov('2026-11', 'Karen')->>'estado', 'se_debe', 'Karen: se le debe');
select is((pg_temp.prov('2026-11', 'Karen')->>'saldo_cent')::bigint, 1200000::bigint, 'Karen: 12,000.00');
select is(pg_temp.prov('2026-11', 'Isaac')->>'estado', 'a_favor', 'Isaac: saldo a favor');
select is((pg_temp.prov('2026-11', 'Isaac')->>'saldo_sin_clasificar_cent')::bigint, -500000::bigint, 'Isaac: 5,000.00 a favor reconocidos');
select is((pg_temp.prov('2026-10', 'Isaac')->>'por_clasificar_cent')::bigint, 6216191::bigint, 'octubre: los 62,161.91 de Javier a Isaac quedan por clasificar');
select is(pg_temp.prov('2026-10', 'Isaac')->>'estado', 'sin_saldo', 'sin contarlos, Isaac no tiene saldo a favor ni inventario');
select is((pg_temp.prov('2026-11', 'Isaac')->>'saldo_cent')::bigint, -6716191::bigint, 'el saldo contable de Isaac (Balance) los incluye');
select is((pg_temp.cap()->'acumulado'->>'por_clasificar_cent')::bigint, 6216191::bigint, 'el acumulado trae el total por clasificar');

-- Acumulado
select is((pg_temp.cap()->'acumulado'->'total'->>'utilidad_generada_cent')::bigint, 5366073::bigint, 'acumulado: utilidad generada 53,660.73');
select is((pg_temp.cap()->'acumulado'->'total'->>'aportaciones_capital_cent')::bigint, 22387691::bigint, 'acumulado: aportaciones declaradas 223,876.91');
select is((pg_temp.cap()->'acumulado'->'total'->>'valuacion_inicial_cent')::bigint, 0::bigint, 'acumulado: parte de cero');

-- Comprobaciones: todas en verde en cada mes y en el acumulado
select is((select count(*)::int from jsonb_array_elements(pg_temp.cap()->'meses') m, jsonb_array_elements(m->'periodo'->'comprobaciones') c where not (c->>'ok')::boolean), 0, 'ninguna comprobacion K1 a K9 falla en ningun mes');
select is((select count(*)::int from jsonb_array_elements(pg_temp.cap()->'acumulado'->'comprobaciones') c where not (c->>'ok')::boolean), 0, 'ni en el acumulado');
select is((select count(*)::int from jsonb_array_elements(pg_temp.cap()->'acumulado'->'comprobaciones') c), 9, 'el acumulado (corte hoy) trae las nueve comprobaciones');
select ok((operacion.cuadre_socios()->>'libro_conciliado')::boolean, 'Libro conciliado');
select is((pg_temp.cap()->'acumulado'->'comprobaciones'->0->>'a_cent')::bigint, (pg_temp.cap()->'acumulado'->'comprobaciones'->0->>'b_cent')::bigint, 'K1 con sus dos lados iguales');

-- Identidad a mano: valuacion final - inicial = aportaciones + utilidad - retiros (+ redondeo)
select is((pg_temp.cap()->'meses'->1->'periodo'->'total'->>'valuacion_cent')::bigint - (pg_temp.cap()->'meses'->1->'periodo'->'total'->>'valuacion_inicial_cent')::bigint,
          (pg_temp.cap()->'meses'->1->'periodo'->'total'->>'aportaciones_capital_cent')::bigint + (pg_temp.cap()->'meses'->1->'periodo'->'total'->>'utilidad_generada_cent')::bigint - (pg_temp.cap()->'meses'->1->'periodo'->'total'->>'utilidad_retirada_cent')::bigint - (pg_temp.cap()->'meses'->1->'periodo'->'total'->>'devoluciones_capital_cent')::bigint + (pg_temp.cap()->'meses'->1->'periodo'->'total'->>'otros_cent')::bigint,
          'noviembre: la valuacion crece con la utilidad retenida (identidad a mano)');

-- Seguridad
select ok(not has_function_privilege('anon', 'api.capital_por_mes(date, date)', 'execute'), 'anon no ejecuta la lectura');
select ok(has_function_privilege('authenticated', 'api.capital_por_mes(date, date)', 'execute'), 'authenticated si (la funcion exige rol socio)');
select ok(not has_function_privilege('authenticated', 'operacion.cap_periodo(date, date, boolean)', 'execute'), 'los auxiliares de operacion no se exponen');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', true);
select throws_ok($$select api.capital_por_mes('2026-10-01', '2026-11-30')$$, null, null, 'sin rol socio no se lee');
select pg_temp.como('Javier');
select throws_ok($$select api.capital_por_mes('2026-11-30', '2026-10-01')$$, '22023', null, 'rango invertido rechazado');
select is((api.capital_por_mes('2026-09-01', '2026-09-30')->'meses'->0->'periodo'->>'hay_movimientos')::boolean, false, 'antes del primer movimiento: sin movimientos (honesto, no ceros)');
select * from finish();
rollback;
