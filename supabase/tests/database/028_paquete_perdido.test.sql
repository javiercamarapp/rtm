-- pgTAP carril paquete-perdido: paquete perdido o danado en salida (pedido enviado) y en entrada (orden en camino).
-- Esperados desde las reglas del dueno (CLAUDE.md, adendas 21, 27, 29, 31): perdidas 50/50 por la utilidad; gasto una sola vez; sin gasto doble por envio; el socio responsable
-- queda con cuenta por cobrar; nada se edita. Los importes salen de la aritmetica de la prueba (costo 100.00 por pieza, precio 150.00), no del codigo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('pq.paquete@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pq.paquete@example.test');
select set_config('request.jwt.claim.sub', '7aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.inc(p_clave text) returns bigint language sql as $$ select (resultado->>'incidente_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p_clave text) returns bigint language sql as $$ select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.existe() returns int language sql as $$ select coalesce(sum(u.piezas), 0)::int from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id where m.nombre_canonico = 'PQ Modelo 50K' $$;
create function pg_temp.saldo(p_cta text) returns bigint language plpgsql as $$ begin perform contabilidad.asentar_pendientes(); return contabilidad.saldo(p_cta); end $$;
create function pg_temp.malos() returns int language plpgsql as $$ begin perform contabilidad.asentar_pendientes(); return (select count(*) from contabilidad.reproducir_saldos() where not ok)::int; end $$;

select catalogo.asegurar_cliente('PQ Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('PQ Omar Persona', 'PQ Omar Persona');
select catalogo.asegurar_cliente('PQ Cliente', 'Javier');
select catalogo.asegurar_modelo('PQ Marca', 'PQ Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('PQ Modelo 50K', 'Mango');
select catalogo.asegurar_sku('PQ Modelo 50K', 'Uva');
select catalogo.fijar_costo('pqk1', 'Isaac', 'PQ Modelo 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('pqp1', 'PQ Cliente', 'PQ Modelo 50K', 15000, '2026-11-01', 'chat');
-- 100 piezas de cada sabor a 100.00 de costo promedio.
select operacion.registrar_movimiento('pqm1', 'PQ Modelo 50K', 'Mango', 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-08');
select operacion.registrar_movimiento('pqm2', 'PQ Modelo 50K', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-08');
create temp table _base as select pg_temp.malos() as malos0;

-- SALIDA A: bonificar, la sociedad absorbe ------------------------------------------------------------------------------------------------------
select operacion.crear_pedido('pqa', (select id from catalogo.cliente where nombre_canonico = 'PQ Cliente'), '[{"modelo":"PQ Modelo 50K","sabor":"Mango","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('pqac', pg_temp.pid('pqa'));
select lives_ok($$select operacion.enviar_pedido('pqae', pg_temp.pid('pqa'), null, '{"paqueteria":"Castores","numero":"PQ-G1","costo_cent":18000}'::jsonb, negocio.hoy(), true)$$, 'enviar el pedido A (guia de 180.00)');
select is(operacion.pedido_saldo(pg_temp.pid('pqa')), 300000::bigint, 'el cliente debe 20 x 150.00 = 3,000.00');
select throws_ok($$select operacion.reportar_paquete_salida('pqa0', (select id from operacion.pedido where id = pg_temp.pid('pqa')), 'perdido', 'x', '[{"linea_id":0,"piezas":1}]'::jsonb)$$, '22023', null, 'un renglon que no es del pedido se rechaza');
select throws_ok($$select operacion.reportar_paquete_salida('pqa1', pg_temp.pid('pqa'), 'perdido', 'se extravio', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 21)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqa')))$$, '23514', null, 'no se puede reportar mas de lo que salio');
select throws_ok($$select operacion.reportar_paquete_salida('pqa2', pg_temp.pid('pqa'), 'perdido', '  ', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 5)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqa')))$$, '23502', null, 'el reporte exige detalle');
select lives_ok($$select operacion.reportar_paquete_salida('pqa3', pg_temp.pid('pqa'), 'perdido', 'la paqueteria lo extravio', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 5)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqa')))$$, 'reporta 5 piezas perdidas');
select is((select valor_cent from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqa3')), 50000::bigint, '5 piezas a costo promedio 100.00 = 500.00');
select is((select count(*)::int from operacion.aviso where codigo = 'paquete_incidente_reportado' and entidad_id = pg_temp.inc('pqa3') and estado = 'abierta'), 1, 'avisa a los socios por el flujo de avisos (abierto)');
select is(operacion.reportar_paquete_salida('pqa3', pg_temp.pid('pqa'), 'perdido', 'la paqueteria lo extravio', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 5)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqa')))->>'incidente_id', pg_temp.inc('pqa3')::text, 'la misma clave devuelve el mismo incidente (idempotente)');
select throws_ok($$select operacion.reportar_paquete_salida('pqa4', pg_temp.pid('pqa'), 'danado', 'otro', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 16)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqa')))$$, '23514', null, 'lo ya reportado cuenta: 5 + 16 > 20');
create temp table _a as select pg_temp.saldo('5200') as c5200, pg_temp.saldo('5100') as c5100, (select count(*) from operacion.gasto where pedido_id = pg_temp.pid('pqa')) as gastos,
  (operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint as u0, operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) as aj0;
select throws_ok($$select operacion.resolver_paquete_incidente('pqar0', pg_temp.inc('pqa3'), 'proveedor', null, 'bonificar', 'x')$$, '22023', null, 'una salida no se reclama al proveedor');
select throws_ok($$select operacion.resolver_paquete_incidente('pqar1', pg_temp.inc('pqa3'), 'sociedad', null, null, 'x')$$, '22023', null, 'falta decidir que pasa con el cliente');
select throws_ok($$select operacion.resolver_paquete_incidente('pqar2', pg_temp.inc('pqa3'), 'sociedad', null, 'bonificar', null)$$, '23502', null, 'resolver exige motivo');
select lives_ok($$select operacion.resolver_paquete_incidente('pqar3', pg_temp.inc('pqa3'), 'sociedad', null, 'bonificar', 'la sociedad absorbe')$$, 'bonificar: la sociedad absorbe');
select is(operacion.pedido_saldo(pg_temp.pid('pqa')), 225000::bigint, 'el cliente ya no paga las 5 piezas perdidas: 3,000.00 - 750.00 = 2,250.00');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.pid('pqa') and tipo = 'correccion'), 1, 'la nota original no cambia: nace una correccion enlazada');
select is(pg_temp.saldo('5200') - (select c5200 from _a), 50000::bigint, 'asiento: el costo de lo perdido (500.00) va a perdida 5200');
select is(pg_temp.saldo('5100') - (select c5100 from _a), -50000::bigint, 'asiento: sale del costo de ventas 5100 (se reclasifica, no se duplica)');
select is((select count(*) from operacion.gasto where pedido_id = pg_temp.pid('pqa')), (select gastos from _a), 'gasto una sola vez: resolver no crea otro gasto ni recuenta la guia original');
select is((select absorbe_sociedad_cent from operacion.paquete_incidente_resolucion where incidente_id = pg_temp.inc('pqa3')), 50000::bigint, 'la sociedad absorbe 500.00');
select is(operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) - (select aj0 from _a), 0::bigint, 'bonificar ya esta en la utilidad de la nota: sin ajuste extra (no se cuenta dos veces)');
select is((operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint - (select u0 from _a), -75000::bigint, 'la utilidad del periodo baja por la nota corregida (la venta perdida)');
select throws_ok($$select operacion.resolver_paquete_incidente('pqar4', pg_temp.inc('pqa3'), 'sociedad', null, 'bonificar', 'otra vez')$$, 'P0428', null, 'un incidente resuelto no se resuelve de nuevo');
select is((select count(*)::int from operacion.aviso where codigo = 'paquete_incidente_reportado' and entidad_id = pg_temp.inc('pqa3') and estado = 'abierta'), 0, 'el aviso de reporte se cierra');
select is((select count(*)::int from operacion.aviso where codigo = 'paquete_incidente_resuelto' and entidad_id = pg_temp.inc('pqa3')), 1, 'queda el aviso informativo de la resolucion');
select throws_ok($$update operacion.paquete_incidente_resolucion set motivo = 'x'$$, '42501', null, 'la resolucion es de solo insercion');

-- SALIDA B: reponer, la sociedad absorbe, con guia nueva de reenvio --------------------------------------------------------------------------------
select operacion.crear_pedido('pqb', (select id from catalogo.cliente where nombre_canonico = 'PQ Cliente'), '[{"modelo":"PQ Modelo 50K","sabor":"Uva","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('pqbc', pg_temp.pid('pqb'));
select operacion.enviar_pedido('pqbe', pg_temp.pid('pqb'), null, '{"paqueteria":"Castores","numero":"PQ-G2","costo_cent":12000}'::jsonb, negocio.hoy(), true);
select operacion.reportar_paquete_salida('pqb1', pg_temp.pid('pqb'), 'danado', 'llego aplastado', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 3)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqb')));
create temp table _b as select pg_temp.existe() as ex0, pg_temp.saldo('5200') as c5200, pg_temp.saldo('5100') as c5100, pg_temp.malos() as malos,
  (operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint as u0, (select count(*) from operacion.gasto where categoria = 'guia_envio' and pedido_id = pg_temp.pid('pqb')) as g0,
  operacion.pedido_saldo(pg_temp.pid('pqb')) as saldo0;
select lives_ok($$select operacion.resolver_paquete_incidente('pqbr', pg_temp.inc('pqb1'), 'sociedad', null, 'reponer', 'se repone al cliente', '{"paqueteria":"Castores","numero":"PQ-G3","costo_cent":9000}'::jsonb)$$, 'reponer con guia de reenvio de 90.00');
select is((select ex0 from _b) - pg_temp.existe(), 3, 'la reposicion saca 3 piezas de la existencia');
select is(pg_temp.saldo('5200') - (select c5200 from _b), 30000::bigint, 'asiento: la merma de la reposicion (3 x 100.00) va a 5200');
select is(pg_temp.saldo('5100') - (select c5100 from _b), 0::bigint, 'el costo de ventas original no se toca (la perdida no se cuenta dos veces)');
select is(operacion.pedido_saldo(pg_temp.pid('pqb')), (select saldo0 from _b), 'reponer no cambia lo que paga el cliente');
select is((select count(*)::int from operacion.gasto where categoria = 'guia_envio' and pedido_id = pg_temp.pid('pqb')) - (select g0 from _b)::int, 1, 'la guia del reenvio es un gasto nuevo, una sola vez (sin gasto doble)');
select is((select costo_cent from operacion.guia where numero = 'PQ-G2'), 12000::bigint, 'la guia original conserva su costo y no se recuenta como perdida');
select is((operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint - (select u0 from _b), -39000::bigint, 'utilidad del periodo: -300.00 de merma y -90.00 de guia nueva = -390.00 (se reparte 50/50)');
select is((operacion.cascada_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint, (operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint, 'la cascada reparte la misma utilidad que incluye la perdida');
select is(((api.explicar_cifra('cascada:utilidad:' || negocio.hoy() || ':' || negocio.hoy()))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar la utilidad de la cascada sigue cuadrando por dos vias');
select is(pg_temp.malos(), (select malos from _b), 'los controles de saldos (inventario, puente, clientes, socios) no empeoran');

-- SALIDA C: responsable un socio (cuenta por cobrar, adenda 29) ----------------------------------------------------------------------------------
select operacion.crear_pedido('pqc', (select id from catalogo.cliente where nombre_canonico = 'PQ Cliente'), '[{"modelo":"PQ Modelo 50K","sabor":"Mango","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('pqcc', pg_temp.pid('pqc'));
select operacion.enviar_pedido('pqce', pg_temp.pid('pqc'), null, null, negocio.hoy(), true);
select operacion.reportar_paquete_salida('pqc1', pg_temp.pid('pqc'), 'perdido', 'lo dejo en otra direccion', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 4)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqc')));
create temp table _c as select operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia') as a0, pg_temp.saldo('1170') as c1170, pg_temp.saldo('1340') as c1340, pg_temp.saldo('5200') as c5200,
  pg_temp.malos() as malos, operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) as aj0;
select throws_ok($$select operacion.resolver_paquete_incidente('pqcr0', pg_temp.inc('pqc1'), 'socio', 'Nadie', 'bonificar', 'x')$$, '22023', null, 'el socio debe existir');
select lives_ok($$select operacion.resolver_paquete_incidente('pqcr', pg_temp.inc('pqc1'), 'socio', 'Angelo', 'bonificar', 'Angelo mando mal la direccion')$$, 'bonificar y cobrar a Angelo');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia') - (select a0 from _c), 40000::bigint, 'cuenta de socios: Angelo debe 4 x 100.00');
select is(pg_temp.saldo('1170') - (select c1170 from _c), 40000::bigint, 'asiento: faltante por cobrar a Angelo (1170)');
select is(pg_temp.saldo('1340') - (select c1340 from _c), 0::bigint, 'la cuenta puente queda en cero (no se esconde)');
select is(pg_temp.saldo('5200') - (select c5200 from _c), 0::bigint, 'la sociedad no absorbe nada: la perdida es del socio');
select is(operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) - (select aj0 from _c), 40000::bigint, 'el costo recuperado de un socio se devuelve a la utilidad (la nota ya lo restaba)');
select is(pg_temp.malos(), (select malos from _c), 'los controles de saldos siguen igual (faltantes de socios cuadran con el libro)');
select is((operacion.cascada_periodo(negocio.hoy(), negocio.hoy())->'por_socio'->'Angelo'->>'debe_cent')::bigint - 0 >= 40000, true, 'la cascada ve la deuda de Angelo');

-- SALIDA D: el cliente asume ----------------------------------------------------------------------------------------------------------------------
select operacion.reportar_paquete_salida('pqd1', pg_temp.pid('pqc'), 'perdido', 'el cliente rechazo la entrega', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'piezas', 2)) from operacion.pedido_linea where pedido_id = pg_temp.pid('pqc')));
create temp table _d as select (select count(*) from operacion.cuenta_socio_mov) as csm, pg_temp.saldo('5200') as c5200, operacion.pedido_saldo(pg_temp.pid('pqc')) as saldo;
select throws_ok($$select operacion.resolver_paquete_incidente('pqdr0', pg_temp.inc('pqd1'), 'cliente', null, 'reponer', 'x')$$, '22023', null, 'si el cliente asume no hay reposicion');
select lives_ok($$select operacion.resolver_paquete_incidente('pqdr', pg_temp.inc('pqd1'), 'cliente', null, null, 'el cliente rechazo la entrega')$$, 'el cliente asume la perdida');
select is((select count(*) from operacion.cuenta_socio_mov), (select csm from _d), 'sin efecto en cuentas de socios');
select is(pg_temp.saldo('5200'), (select c5200 from _d), 'sin efecto contable');
select is(operacion.pedido_saldo(pg_temp.pid('pqc')), (select saldo from _d), 'el cliente sigue debiendo lo mismo');

-- ENTRADA E: perdida total en camino, la sociedad castiga --------------------------------------------------------------------------------------
select operacion.crear_compra('pqe', 'Isaac', '[{"modelo":"PQ Modelo 50K","sabor":"Mango","pagadas":50}]'::jsonb);
select operacion.confirmar_compra('pqec', pg_temp.cid('pqe'));
select operacion.registrar_guia_compra('pqeg', pg_temp.cid('pqe'), 'Castores', 'PQ-E1');
create temp table _e as select pg_temp.existe() as ex0, pg_temp.saldo('5300') as c5300, pg_temp.saldo('1320') as c1320, pg_temp.malos() as malos, operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) as aj0;
select throws_ok($$select operacion.reportar_paquete_entrada('pqe0', pg_temp.cid('pqe'), 'perdido', 'x', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'sabor', 'Mango', 'piezas', 50)) from operacion.compra_linea where compra_id = pg_temp.cid('pqe')))$$, '23514', null, 'si llego todo sano no hay incidente');
select lives_ok($$select operacion.reportar_paquete_entrada('pqe1', pg_temp.cid('pqe'), 'perdido', 'la paqueteria perdio la caja', '[]'::jsonb)$$, 'reportar la orden perdida');
select is((select estado from operacion.compra where id = pg_temp.cid('pqe')), 'recibida', 'la orden se da por recibida con cero piezas sanas');
select is(pg_temp.existe(), (select ex0 from _e), 'las piezas perdidas NO entran a la existencia');
select is((select sum(valor_cent)::bigint from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqe1')), 500000::bigint, 'valor de lo perdido: 50 x 100.00 = 5,000.00');
select is(pg_temp.saldo('1320') - (select c1320 from _e), -500000::bigint, 'asiento: sale de mercancia en transito');
select is((select count(*)::int from operacion.aviso where codigo = 'diferencia_recepcion_abierta' and estado = 'abierta' and entidad_id in (select diferencia_id from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqe1'))), 0, 'no se duplica el aviso de diferencia');
select is(operacion.paquete_incidente_resuelto(pg_temp.inc('pqe1')), false, 'sigue abierto hasta decidir responsable');
select throws_ok($$select operacion.resolver_paquete_incidente('pqer0', pg_temp.inc('pqe1'), 'cliente', null, null, 'x')$$, '22023', null, 'una entrada no tiene cliente responsable');
select lives_ok($$select operacion.resolver_paquete_incidente('pqer', pg_temp.inc('pqe1'), 'sociedad', null, null, 'perdida absorbida por la sociedad')$$, 'la sociedad castiga la perdida');
select is(pg_temp.saldo('5300') - (select c5300 from _e), 500000::bigint, 'asiento: pierde la sociedad (5300)');
select is(operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) - (select aj0 from _e), -500000::bigint, 'la perdida entra a la utilidad del periodo (50/50)');
select is((select estado from operacion.compra where id = pg_temp.cid('pqe')), 'cerrada', 'la orden se cierra al quedar resuelta');
select is(operacion.paquete_incidente_resuelto(pg_temp.inc('pqe1')), true, 'incidente resuelto');
select is(pg_temp.malos(), (select malos from _e), 'los controles de saldos (transito, puente) no empeoran');

-- ENTRADA F: danado parcial, se cobra a un socio ---------------------------------------------------------------------------------------------------
select operacion.crear_compra('pqf', 'Isaac', '[{"modelo":"PQ Modelo 50K","sabor":"Uva","pagadas":30}]'::jsonb);
select operacion.confirmar_compra('pqfc', pg_temp.cid('pqf'));
create temp table _f as select pg_temp.existe() as ex0, operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia') as a0, operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()) as aj0;
select lives_ok($$select operacion.reportar_paquete_entrada('pqf1', pg_temp.cid('pqf'), 'danado', 'llegaron 10 piezas mojadas', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'sabor', 'Uva', 'piezas', 20)) from operacion.compra_linea where compra_id = pg_temp.cid('pqf')))$$, 'reportar danado con 20 sanas de 30');
select is(pg_temp.existe() - (select ex0 from _f), 20, 'entran solo las 20 sanas');
select is((select piezas from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqf1')), 10, 'quedan 10 piezas danadas');
select lives_ok($$select operacion.resolver_paquete_incidente('pqfr', pg_temp.inc('pqf1'), 'socio', 'Angelo', null, 'Angelo lo resuelve con el proveedor')$$, 'se asigna a Angelo');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia') - (select a0 from _f), (select sum(valor_cent)::bigint from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqf1')), 'Angelo debe el valor de las 10 piezas (adenda 29)');
select is(operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy()), (select aj0 from _f), 'asignado a un socio: la sociedad no absorbe, la utilidad no baja');
select is((api.paquetes_incidentes()->'incidentes'->0->>'estado'), 'resuelto', 'la lectura de la web trae el incidente');

-- ENTRADA F2: reasignar desde la pantalla de la compra: la lectura muestra el responsable VIGENTE, no el guardado al resolver -------------------------------
create function pg_temp.lec(p_inc bigint) returns jsonb language sql as $$ select x from jsonb_array_elements(api.paquetes_incidentes()->'incidentes') x where (x->>'id')::bigint = p_inc $$;
select is(pg_temp.lec(pg_temp.inc('pqf1'))->'resolucion'->>'responsable', 'socio', 'antes de reasignar: socio');
select is(pg_temp.lec(pg_temp.inc('pqf1'))->'resolucion'->>'socio', 'Angelo', 'y es Angelo');
select lives_ok($$select operacion.asignar_diferencia('pqfx', (select diferencia_id from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqf1') limit 1), 'proveedor', null, 'se reclama al proveedor')$$, 'reasignar la diferencia al proveedor desde la compra');
select is(pg_temp.lec(pg_temp.inc('pqf1'))->>'responsable_vigente', 'proveedor', 'responsable_vigente es proveedor');
select is(pg_temp.lec(pg_temp.inc('pqf1'))->'resolucion'->>'responsable', 'proveedor', 'la resolucion que se lee ya es la vigente (proveedor), no la guardada (socio)');
select is(pg_temp.lec(pg_temp.inc('pqf1'))->'resolucion'->>'socio', null, 'y ya no rotula a Angelo');
select is((pg_temp.lec(pg_temp.inc('pqf1'))->'resolucion'->>'recuperable_cent')::bigint, (select sum(valor_cent)::bigint from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqf1')), 'por cobrar = valor, ahora al proveedor');
select is((api.explicar_cifra('paquete:absorbe:' || pg_temp.inc('pqf1'))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar lo que absorbe tras reasignar: cuadra');

-- ENTRADA G: resuelta solo desde la pantalla de la compra (sin fila de resolucion del flujo) ---------------------------------------------------------------------
select operacion.crear_compra('pqg', 'Isaac', '[{"modelo":"PQ Modelo 50K","sabor":"Mango","pagadas":20}]'::jsonb);
select operacion.confirmar_compra('pqgc', pg_temp.cid('pqg'));
select operacion.reportar_paquete_entrada('pqg1', pg_temp.cid('pqg'), 'danado', 'llegaron mojadas', (select jsonb_build_array(jsonb_build_object('linea_id', id, 'sabor', 'Mango', 'piezas', 15)) from operacion.compra_linea where compra_id = pg_temp.cid('pqg')));
select is(pg_temp.lec(pg_temp.inc('pqg1'))->>'estado', 'abierto', 'G abierto');
select throws_ok($$select api.explicar_cifra('paquete:absorbe:' || pg_temp.inc('pqg1'))$$, '22023', null, 'abierto: aun sin resolucion para explicar');
select lives_ok($$select operacion.resolver_diferencia('pqgr', (select diferencia_id from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqg1') limit 1), 'castigar', 'la sociedad lo castiga')$$, 'castigar desde la compra');
select is((select count(*)::int from operacion.paquete_incidente_resolucion where incidente_id = pg_temp.inc('pqg1')), 0, 'no hay fila de resolucion del flujo');
select is(pg_temp.lec(pg_temp.inc('pqg1'))->>'estado', 'resuelto', 'G resuelto');
select is(pg_temp.lec(pg_temp.inc('pqg1'))->'resolucion'->>'responsable', 'sociedad', 'la lectura trae la resolucion derivada: sociedad');
select is(pg_temp.lec(pg_temp.inc('pqg1'))->'resolucion'->>'accion', 'castigar', 'accion castigar');
select is((pg_temp.lec(pg_temp.inc('pqg1'))->'resolucion'->>'absorbe_sociedad_cent')::bigint, (select sum(valor_cent)::bigint from operacion.paquete_incidente_linea where incidente_id = pg_temp.inc('pqg1')), 'absorbe todo el valor');
select is((api.explicar_cifra('paquete:absorbe:' || pg_temp.inc('pqg1'))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar lo que absorbe (resuelta desde la compra): cuadra por dos vias');

-- Lecturas y explicar ------------------------------------------------------------------------------------------------------------------------------
select ok((select count(*) from jsonb_array_elements(api.paquetes_incidentes()->'incidentes') x where x->>'folio' = (select folio from operacion.paquete_incidente where id = pg_temp.inc('pqa3'))) = 1, 'api.paquetes_incidentes trae el folio de la salida A');
select is((api.explicar_cifra('paquete:valor:' || pg_temp.inc('pqa3'))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar el costo de lo perdido (salida): dos vias cuadran');
select is((api.explicar_cifra('paquete:valor:' || pg_temp.inc('pqe1'))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar el costo de lo perdido (entrada): dos vias cuadran');
select is((api.explicar_cifra('paquete:absorbe:' || pg_temp.inc('pqa3'))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar lo que absorbe la sociedad (bonificacion): cuadra');
select is((api.explicar_cifra('paquete:absorbe:' || pg_temp.inc('pqb1'))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar lo que absorbe la sociedad (reposicion): cuadra');
select is(jsonb_array_length(api.paquete_salida_lineas(pg_temp.pid('pqa'))), 1, 'api.paquete_salida_lineas trae el renglon del pedido');
select is((api.paquete_salida_lineas(pg_temp.pid('pqa'))->0->>'reportadas')::int, 5, 'y lo ya reportado');
select is((select count(*)::int from notificacion.tipo where codigo in ('paquete_incidente_reportado', 'paquete_incidente_resuelto') and activo), 2, 'los dos tipos de aviso estan en el catalogo');
select ok(not exists (select 1 from operacion.aviso a where a.codigo like 'paquete_incidente%' and not exists (select 1 from notificacion.tipo t where t.codigo = a.codigo)), 'todo aviso del flujo existe en el catalogo');

select * from finish();
rollback;
