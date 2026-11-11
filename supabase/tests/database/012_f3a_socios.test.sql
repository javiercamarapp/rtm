-- pgTAP F3a: cuenta de socios, estado de cuenta por socio y cascada de reparto (adenda 21), faltante asignado a un socio (adenda 29) y diferencia entre
-- socios de la compra inicial (G3). Los saldos de partida se neutralizan DENTRO de la transaccion (se revierte) para no depender de datos previos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3a.angelo@example.test', 'socio', 'Angelo', true), ('f3a.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a3333333-3333-3333-3333-333333333331', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3a.angelo@example.test'),
  ('a3333333-3333-3333-3333-333333333332', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3a.javier@example.test');
select set_config('request.jwt.claim.sub', 'a3333333-3333-3333-3333-333333333331', true);

create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'a3333333-3333-3333-3333-333333333331' else 'a3333333-3333-3333-3333-333333333332' end, true); end $$;

-- Punto de partida limpio: lo pendiente de reembolsos y capital, y lo que cada socio debe, se lleva a cero con renglones de ajuste.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-012', '{}'::jsonb);
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_reembolso', -operacion.aportado_socio(s.id, 'reembolsable') - operacion.libro_socio(s.id, 'pago_reembolso'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'reembolsable') + operacion.libro_socio(s.id, 'pago_reembolso') <> 0;
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_devolucion_aportacion', -operacion.aportado_socio(s.id, 'capital') - operacion.libro_socio(s.id, 'pago_devolucion_aportacion'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'capital') + operacion.libro_socio(s.id, 'pago_devolucion_aportacion') <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')) + operacion.aportacion_pendiente(pg_temp.sid('Angelo')) + operacion.reembolso_pendiente(pg_temp.sid('Javier')) + operacion.aportacion_pendiente(pg_temp.sid('Javier')),
          0::bigint, 'punto de partida: nada pendiente');

-- ---- Cascada pura: ejemplo del documento 21 (cifras inventadas) ----------------------------------------------------------------------------------
create temp table _ej as select operacion.cascada_calcular(1200000, 0, '{"Angelo":50000,"Javier":122100}', '{"Angelo":0,"Javier":100000}', '{"Angelo":800000,"Javier":672100}',
                                                           '{"Angelo":800000,"Javier":672100}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->'efectivo'->>'total_cent')::bigint from _ej), 1472100::bigint, 'ejemplo 21: efectivo total de la sociedad 14,721.00');
select is((select (c->>'repartible_cent')::bigint from _ej), 1200000::bigint, 'ejemplo 21: utilidad repartible 12,000.00');
select is((select (c->'por_socio'->'Angelo'->>'asignado_cent')::bigint from _ej), 650000::bigint, 'ejemplo 21: le corresponde a Angelo 6,500.00');
select is((select (c->'por_socio'->'Javier'->>'asignado_cent')::bigint from _ej), 822100::bigint, 'ejemplo 21: le corresponde a Javier 8,221.00');
select is((select (c->'por_socio'->'Angelo'->>'resultado_cent')::bigint from _ej), -150000::bigint, 'ejemplo 21: Angelo tiene 8,000.00 y devuelve 1,500.00');
select is((select (c->'por_socio'->'Javier'->>'resultado_cent')::bigint from _ej), 150000::bigint, 'ejemplo 21: Javier recibe 1,500.00');
select is((select c->'liquidar' from _ej), '{"de": "Angelo", "a": "Javier", "monto_cent": 150000}'::jsonb, 'ejemplo 21: Angelo paga 1,500.00 a Javier y quedan en paz');
select is((select (c->>'identidad_cuadra')::boolean from _ej), true, 'ejemplo 21: suma de lo asignado = efectivo repartido');
select is((select (c->>'remanente_cent')::bigint from _ej), 0::bigint, 'ejemplo 21: no sobra efectivo');

-- Efectivo insuficiente: se pagan reembolsos antes que aportaciones y antes que utilidad.
create temp table _ins as select operacion.cascada_calcular(1000000, 0, '{"Angelo":100000,"Javier":0}', '{"Angelo":0,"Javier":200000}', '{"Angelo":150000,"Javier":0}', '{"Angelo":150000,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->'por_socio'->'Angelo'->>'paga_reembolso_cent')::bigint from _ins), 100000::bigint, 'efectivo insuficiente: primero el reembolso completo');
select is((select (c->'por_socio'->'Javier'->>'paga_aportacion_cent')::bigint from _ins), 50000::bigint, 'efectivo insuficiente: con lo que queda se devuelve capital');
select is((select (c->>'repartible_cent')::bigint from _ins), 0::bigint, 'efectivo insuficiente: nada de utilidad repartible');
select is((select (c->>'limitado_por_efectivo')::boolean from _ins), true, 'efectivo insuficiente: la cascada avisa que esta limitada por efectivo');
select is((select (c->'por_socio'->'Javier'->>'sigue_pendiente_cent')::bigint from _ins), 150000::bigint, 'efectivo insuficiente: el capital no devuelto sigue pendiente');
-- Utilidad negativa: no hay reparto; el efectivo no se inventa socios con utilidad.
create temp table _neg as select operacion.cascada_calcular(-300000, 500000, '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->>'repartible_cent')::bigint from _neg), 0::bigint, 'utilidad negativa: nada que repartir');
select is((select (c->>'perdida_cent')::bigint from _neg), 300000::bigint, 'utilidad negativa: la perdida se muestra');
select is((select (c->>'remanente_cent')::bigint from _neg), 500000::bigint, 'utilidad negativa: el efectivo se queda en la sociedad');
-- Aportacion devuelta parcialmente (proporcional a lo aportado).
create temp table _par as select operacion.cascada_calcular(1000000, 300000, '{"Angelo":0,"Javier":0}', '{"Angelo":400000,"Javier":100000}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->'por_socio'->'Angelo'->>'paga_aportacion_cent')::bigint from _par), 240000::bigint, 'aportacion parcial: Angelo recibe 2,400.00 de 4,000.00');
select is((select (c->'por_socio'->'Javier'->>'paga_aportacion_cent')::bigint from _par), 60000::bigint, 'aportacion parcial: Javier recibe 600.00 de 1,000.00');
select is((select (c->>'repartible_cent')::bigint from _par), 0::bigint, 'aportacion parcial: la utilidad espera a que se devuelva el capital');
-- Con la configuracion invertida (utilidad antes que capital).
create temp table _inv as select operacion.cascada_calcular(100000, 300000, '{"Angelo":0,"Javier":0}', '{"Angelo":400000,"Javier":100000}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', false) as c;
select is((select (c->>'repartible_cent')::bigint from _inv), 100000::bigint, 'utilidad antes que capital: se reparte primero la utilidad');
-- Un centavo suelto va a favor de quien aporta.
create temp table _imp as select operacion.cascada_calcular(1001, 1001, '{"Angelo":0,"Javier":500}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select is((select (c->'por_socio'->'Javier'->>'utilidad_cent')::bigint from _imp), 251::bigint, 'centavo suelto: a favor del socio que mas aporto');
select is((select (c->'por_socio'->'Angelo'->>'utilidad_cent')::bigint from _imp), 250::bigint, 'centavo suelto: el otro recibe el piso');

-- Propiedad: en 400 casos generados, lo asignado es exactamente el efectivo repartido y nadie recibe negativo.
select setseed(0.31416);
create temp table _casos as
  select g, (random() * 4000000)::bigint - 500000 as u, (random() * 3000000)::bigint as caja,
         (random() * 800000)::bigint as ra, (random() * 800000)::bigint as rj, (random() * 2000000)::bigint as ca, (random() * 2000000)::bigint as cj,
         (random() * 1500000)::bigint as pa, (random() * 1500000)::bigint as pj, random() < 0.5 as antes
  from generate_series(1, 400) g;
create temp table _prop as
  select g, operacion.cascada_calcular(u, caja, jsonb_build_object('Angelo', ra, 'Javier', rj), jsonb_build_object('Angelo', ca, 'Javier', cj), jsonb_build_object('Angelo', pa, 'Javier', pj),
                                       jsonb_build_object('Angelo', pa, 'Javier', pj), '{"Angelo":500000,"Javier":500000}', antes) as c
  from _casos;
select is((select count(*)::int from _prop where not (c->>'identidad_cuadra')::boolean), 0, 'propiedad: suma de lo asignado = efectivo - remanente en 400 casos');
select is((select count(*)::int from _prop where (c->>'remanente_cent')::bigint < 0), 0, 'propiedad: el remanente nunca es negativo');
select is((select count(*)::int from _prop p where exists (select 1 from jsonb_each(p.c->'por_socio') e where (e.value->>'asignado_cent')::bigint < 0)), 0, 'propiedad: nadie recibe asignacion negativa');
select is((select count(*)::int from _prop p where (p.c->>'repartible_cent')::bigint > greatest((p.c->>'utilidad_cent')::bigint, 0)), 0, 'propiedad: no se reparte mas utilidad que la que hay');
select is((select count(*)::int from _prop p where (p.c->>'suma_resultados_cent')::bigint <> (p.c->>'suma_asignada_cent')::bigint - ((p.c->'por_socio'->'Angelo'->>'debe_cent')::bigint + (p.c->'por_socio'->'Javier'->>'debe_cent')::bigint)), 0,
          'propiedad: suma de resultados = asignado - lo que tienen en su poder');

-- ---- Capturas de socios: gasto, aportacion, eco, idempotencia y deshacer ----------------------------------------------------------------------------------
select is((operacion.registrar_gasto_socio('f3g0', 'Angelo', 50000, 'envio', 'variable', '2020-03-04', null, 'Guia a Monterrey', 'Pague 500 de envio')->'eco'->>'neto_cent')::bigint, 50000::bigint, 'gasto de 500 pagado por Angelo: la sociedad le debe 500');
select operacion.registrar_gasto_socio('f3g0', 'Angelo', 50000, 'envio', 'variable', '2020-03-04', null, 'Guia a Monterrey', 'Pague 500 de envio');
select is((select count(*)::int from operacion.gasto where categoria = 'envio' and pagado_por_socio_id = pg_temp.sid('Angelo') and fecha_neg = '2020-03-04'), 1, 'el mismo mensaje dos veces: un solo gasto');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 50000::bigint, 'y un solo reembolso pendiente');
select throws_ok($$select operacion.registrar_gasto_socio('f3g0', 'Angelo', 50001, 'envio')$$, 'P0409', null, 'misma clave con otro monto = 409');
select is((operacion.registrar_aportacion('f3a1', 'Javier', 100000, 'Capital adicional')->'eco'->>'neto_cent')::bigint, 100000::bigint, 'aportacion de 1,000 de Javier: neto a su favor 1,000');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 100000::bigint, 'queda como capital por devolver');
select lives_ok($$select operacion.anular_movimiento_socio('f3u1', 'aportacion', (select id from operacion.aportacion_socio where concepto = 'Capital adicional' and reversa_de is null order by id desc limit 1), 'capture mal')$$, 'deshacer la aportacion');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 0::bigint, 'deshecha: vuelve a cero con su contramovimiento');
select throws_ok($$select operacion.anular_movimiento_socio('f3u2', 'aportacion', (select id from operacion.aportacion_socio where concepto = 'Capital adicional' and reversa_de is null order by id desc limit 1), 'otra vez')$$, 'P0428', null, 'no se deshace dos veces');
select operacion.registrar_aportacion('f3a2', 'Javier', 100000, 'Capital adicional');
select lives_ok($$select operacion.anular_movimiento_socio('f3u3', 'aportacion', (select a.id from operacion.aportacion_socio a join operacion.gasto g on g.id = a.ref_id and a.ref_tipo = 'gasto' where g.categoria = 'envio' and g.fecha_neg = '2020-03-04' and a.reversa_de is null order by a.id desc limit 1), 'gasto repetido')$$, 'deshacer un gasto pagado por un socio');
select is((select count(*)::int from operacion.gasto_anulacion), 1, 'el gasto queda anulado (el original no cambia)');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 0::bigint, 'y el reembolso pendiente regresa a cero');
select operacion.registrar_gasto_socio('f3g1', 'Angelo', 50000, 'envio', 'variable', '2020-03-04', null, 'Guia a Monterrey', 'Pague 500 de envio');
select operacion.registrar_gasto_socio('f3g2', 'Javier', 122100, 'costos del sistema', 'fijo', '2020-03-05', null, 'Suscripciones del mes');
select throws_ok($$select operacion.registrar_pago_a_socio('f3p0', 'Angelo', 50001, 'reembolso')$$, '23514', null, 'un reembolso no excede lo pendiente');

-- ---- Cierre del periodo con cifras del ejemplo (utilidad 12,000.00 despues de gastos) -------------------------------------------------------------------------
select catalogo.asegurar_cliente('F3 Cliente Cascada', 'Angelo');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Cascada 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F3 Cascada 30K', 'Sandia');
select catalogo.fijar_costo('f3cc', 'Isaac', 'F3 Cascada 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f3cp', 'F3 Cliente Cascada', 'F3 Cascada 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('f3pe', pg_temp.cid('F3 Cliente Cascada'), '[{"modelo":"F3 Cascada 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 372100, 0, 0, '2020-03-03');
select operacion.confirmar_pedido('f3pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3pe'));
select is((operacion.enviar_pedido('f3pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3pe'), null, '{"paqueteria":"Castores","numero":"F3-G1","costo_cent":0}'::jsonb, '2020-03-03', true)->>'total_cent')::bigint,
          2372100::bigint, 'pedido directo de 23,721.00 (100 pz x 200 + envio 3,721)');
select operacion.registrar_pago('f3pg1', 'Angelo', 800000, pg_temp.cid('F3 Cliente Cascada'), null, true, 'abono', '2020-03-04');
select operacion.registrar_pago('f3pg2', 'Javier', 672100, pg_temp.cid('F3 Cliente Cascada'), null, true, 'abono', '2020-03-04');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 800000::bigint, 'Angelo tiene 8,000.00 de la sociedad');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos'), 672100::bigint, 'Javier tiene 6,721.00 de la sociedad');
select is((operacion.utilidad_periodo('2020-03-02', '2020-03-08')->>'utilidad_cent')::bigint, 1200000::bigint, 'utilidad neta del periodo 12,000.00 (pedido 13,721.00 menos gastos 1,721.00)');
select is((operacion.cascada_periodo('2020-03-02', '2020-03-08', 0)->'por_socio'->'Angelo'->>'resultado_cent')::bigint, -150000::bigint, 'cascada en vivo: Angelo devuelve 1,500.00');
select is((operacion.cascada_periodo('2020-03-02', '2020-03-08', 0)->'liquidar'->>'monto_cent')::bigint, 150000::bigint, 'cascada en vivo: Angelo paga 1,500.00 a Javier');
select throws_ok($$select operacion.proponer_cierre_reparto('f3cr0', '2020-03-02', current_date)$$, 'P0428', null, 'el periodo debe haber terminado');
create temp table _cr1 as select operacion.proponer_cierre_reparto('f3cr1', '2020-03-02', '2020-03-08', 0) as r;
select is((select r->>'folio' from _cr1), (select folio from operacion.cierre_reparto order by id desc limit 1), 'se propone el cierre con folio');
select throws_ok($$select operacion.proponer_cierre_reparto('f3cr2', '2020-03-05', '2020-03-10', 0)$$, 'P0428', null, 'no se traslapan dos cierres');
select is((select count(*)::int from operacion.aviso where codigo = 'cascada_lista_firma' and estado = 'abierta'), 1, 'NT-045: cascada lista para firma');
select is((select count(*)::int from operacion.socio_libro where cierre_id is not null), 0, 'proponer no asienta nada');
select is((operacion.firmar_cierre_reparto('f3cf1', (select id from operacion.cierre_reparto order by id desc limit 1))->>'cerrado')::boolean, false, 'una firma no cierra');
select throws_ok($$select operacion.firmar_cierre_reparto('f3cf1b', (select id from operacion.cierre_reparto order by id desc limit 1))$$, 'P0428', null, 'el mismo socio no firma dos veces');
select pg_temp.como('Javier');
select is((operacion.firmar_cierre_reparto('f3cf2', (select id from operacion.cierre_reparto order by id desc limit 1))->>'cerrado')::boolean, true, 'con las dos firmas el cierre surte efecto');
select is(operacion.neto_socio(pg_temp.sid('Angelo')), -150000::bigint, 'despues del cierre: Angelo debe 1,500.00');
select is(operacion.neto_socio(pg_temp.sid('Javier')), 150000::bigint, 'despues del cierre: la sociedad le debe 1,500.00 a Javier');
select is(operacion.libro_socio(pg_temp.sid('Angelo'), 'utilidad_asignada'), 600000::bigint, 'utilidad asignada a Angelo 6,000.00');
select is(operacion.saldo_socio(pg_temp.sid('Angelo')), 750000::bigint, 'Angelo conserva 7,500.00 (8,000 menos su reembolso compensado)');
select is(operacion.saldo_socio(pg_temp.sid('Javier')), 450000::bigint, 'Javier conserva 4,500.00 (6,721 menos 2,221 compensados)');
select is((select count(*)::int from operacion.aviso where codigo = 'cascada_lista_firma' and estado = 'abierta'), 0, 'el aviso de firma se resuelve');
select throws_ok($$select operacion.anular_cierre_reparto('f3cx', (select id from operacion.cierre_reparto order by id desc limit 1), 'ya no')$$, 'P0428', null, 'un cierre firmado por los dos no se anula');
-- Liquidacion entre socios: Angelo paga 1,500.00 a Javier y quedan en paz.
select operacion.registrar_liquidacion_entre_socios('f3ls1', 'Angelo', 'Javier', 150000, 'Cascada de marzo');
select is(operacion.neto_socio(pg_temp.sid('Angelo')), 0::bigint, 'liquidado: Angelo queda en cero');
select is(operacion.neto_socio(pg_temp.sid('Javier')), 0::bigint, 'liquidado: Javier queda en cero');
select lives_ok($$select operacion.anular_movimiento_socio('f3ls1u', 'libro', (select id from operacion.socio_libro where concepto = 'liquidacion_recibida' order by id desc limit 1), 'se pago a la cuenta equivocada')$$, 'deshacer la liquidacion entre socios');
select is(operacion.neto_socio(pg_temp.sid('Angelo')), -150000::bigint, 'deshecha: la deuda de Angelo regresa');
select throws_ok($$select operacion.anular_movimiento_socio('f3cierre', 'libro', (select id from operacion.socio_libro where cierre_id is not null order by id desc limit 1), 'no')$$, 'P0428', null, 'lo que viene de un cierre firmado no se deshace por separado');
-- Un cierre propuesto y no firmado se puede anular.
select is((select count(*)::int from jsonb_object_keys(operacion.proponer_cierre_reparto('f3cr3', '2020-04-06', '2020-04-12', 0)->'cascada'->'por_socio')), 2, 'segundo periodo propuesto con los dos socios');
select lives_ok($$select operacion.anular_cierre_reparto('f3cr3a', (select id from operacion.cierre_reparto order by id desc limit 1), 'se capturo mal la caja')$$, 'se anula el cierre sin firmas');
select is((select count(*)::int from operacion.socio_libro where cierre_id = (select id from operacion.cierre_reparto order by id desc limit 1)), 0, 'y no dejo asientos');

-- Seguridad: la web (rol socio) ve la cascada; el rol servidor y anonimo no.
select is((api.cascada_proyeccion('2020-03-02', '2020-03-08', 0)->'por_socio'->'Javier'->>'resultado_cent')::bigint, 150000::bigint, 'api.cascada_proyeccion lee con la sesion del socio');
select is((select count(*)::int from jsonb_array_elements(api.cierres_reparto()) c where c->>'estado' = 'cerrado'), 1, 'el cierre firmado aparece como cerrado');
select is((api.socio_cuenta('Javier')->>'neto_cent')::bigint, 150000::bigint, 'estado de cuenta de Javier: neto 1,500.00 a su favor');
select ok((select bool_and((m->>'saldo_cent') is not null) from jsonb_array_elements(api.socio_cuenta('Javier')->'movimientos') m), 'cada movimiento trae su saldo corrido');
select is((api.socio_cuenta('Javier')->'movimientos'->0->>'saldo_cent')::bigint, 150000::bigint, 'el ultimo saldo corrido es el neto');

-- ---- G3: compra inicial de Nexa 50K y diferencia entre socios; faltante asignado a Angelo (adenda 29) -----------------------------------------------------
create temp table _cs0 as select operacion.cuenta_socios() as c;
select catalogo.asegurar_modelo('F3 Marca', 'F3 Nexa 50K', 50000, 'ambas');
select catalogo.asegurar_sku('F3 Nexa 50K', 'Sin sabor');
select catalogo.asegurar_sku('F3 Nexa 50K', 'Uva');
select catalogo.fijar_costo('f3n1', 'Isaac', 'F3 Nexa 50K', 9000, '2026-11-01', 'compra inicial');
select pg_temp.como('Angelo');
select operacion.crear_compra('f3oc', 'Isaac', '[{"modelo":"F3 Nexa 50K","sabor":"Sin sabor","pagadas":1552,"facturadas":1536}]'::jsonb, 237500, 0, '2026-11-02', 'bodega', 'sociedad', 'Angelo', 'Angelo');
select is((select mercancia_cent from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f3oc')), 13824000::bigint, 'G3: 1,536 facturadas x 90 = 138,240.00');
select operacion.confirmar_compra('f3occ', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc'));
select operacion.pago_proveedor_de_socio('f3pa', 'Isaac', 8368000, 'Angelo', 'aportacion', '2026-11-06');
select operacion.pago_proveedor_de_socio('f3pj', 'Isaac', 5600000, 'Javier', 'aportacion', '2026-11-06');
create temp table _cs1 as select operacion.cuenta_socios() as c;
select is((select (c->>'costo_cent')::bigint from _cs1) - (select (c->>'costo_cent')::bigint from _cs0), 14061500::bigint, 'G3: costo puesto 140,615.00 (138,240 + guia 2,375)');
select is((select (c->'angelo'->>'aportado_cent')::bigint from _cs1) - (select (c->'angelo'->>'aportado_cent')::bigint from _cs0), 8461500::bigint, 'G3: Angelo puso 84,615.00 (83,680 + guia 2,375 - 1,440 fuera de la sociedad)');
select is((select (c->'javier'->>'aportado_cent')::bigint from _cs1) - (select (c->'javier'->>'aportado_cent')::bigint from _cs0), 5600000::bigint, 'G3: Javier puso 56,000.00');
select is((select (c->>'javier_debe_a_angelo_cent')::bigint from _cs1) - (select (c->>'javier_debe_a_angelo_cent')::bigint from _cs0), 1430750::bigint, 'G3: Javier debe a Angelo 14,307.50');
select is((select (c->>'mitad_cent')::bigint from _cs1) - (select (c->>'mitad_cent')::bigint from _cs0), 7030750::bigint, 'G3: la mitad del costo es 70,307.50');
select is((select (c->>'via1_cent')::bigint from _cs1) - (select (c->>'via1_cent')::bigint from _cs0), (select (c->>'via2_cent')::bigint from _cs1) - (select (c->>'via2_cent')::bigint from _cs0), 'G3: las dos vias dan lo mismo');
select is((select sum((p->>'monto_cent')::bigint)::bigint from jsonb_array_elements((select c->'partidas_fuera_sociedad' from _cs1)) p where p->>'socio' = 'Angelo' and p->>'estado' = 'abierta')
          - coalesce((select sum((p->>'monto_cent')::bigint)::bigint from jsonb_array_elements((select c->'partidas_fuera_sociedad' from _cs0)) p where p->>'socio' = 'Angelo' and p->>'estado' = 'abierta'), 0),
          144000::bigint, 'G3: 1,440.00 (16 x 90) quedan fuera de la sociedad, aparte');
-- Recepcion de 1,524 de 1,536 y las 12 piezas faltantes como deuda de Angelo.
select operacion.marcar_compra_enviada('f3oce', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc'), '[{"paqueteria":"Castores","numero":"F3-C1"}]'::jsonb, '2026-11-06', '2026-11-04');
select operacion.marcar_llego_merida('f3ocl', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc'));
select operacion.recibir_compra('f3ocr', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc'),
  jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.compra_linea where compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc')), 'sabor', 'Sin sabor', 'piezas', 1524)), '2026-11-06 10:00-06');
create temp table _dif as select (select min(d.id) from operacion.compra_diferencia d where d.compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc')) as id;
select operacion.asignar_diferencia('f3ad', (select id from _dif), 'socio', 'Angelo', 'Faltante de la compra inicial');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'diferencia'), 109855::bigint, 'adenda 29: Angelo debe 1,098.55 (12 x 9,154.6224 centavos)');
select is(operacion.saldo_puente(), 0::bigint, 'adenda 29: la cuenta puente queda en cero');
select is((select (c->'angelo'->>'debe_cent')::bigint from (select operacion.cuenta_socios() as c) x) - (select (c->'angelo'->>'debe_cent')::bigint from _cs1), 109855::bigint, 'el faltante aparece en lo que Angelo debe a la sociedad');
select operacion.registrar_entrega_socio('f3adp', 'Angelo', 109855, 'sociedad', null, 'diferencia', 'Angelo liquida el faltante');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'diferencia'), 0::bigint, 'adenda 29: si Angelo paga, su deuda por el faltante queda en cero');

select * from finish();
rollback;
