-- pgTAP puente del efectivo / 3: la caja por persona de la apertura entra al libro de efectivo (y se revierte con la apertura), y el reembolso pagado en el acta de corte
-- sale de la caja neto de la compensacion con lo que el socio tiene en su poder (y regresa con la contra-acta). Esperados a mano.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f29.ang@example.test', 'socio', 'Angelo', true), ('f29.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a2900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f29.ang@example.test'),
  ('a2900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f29.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then 'a2900000-0000-0000-0000-000000000001' else 'a2900000-0000-0000-0000-000000000002' end, true) $$;
select pg_temp.como('Angelo');
create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.c(p_codigo text) returns table (ok boolean, a bigint, b bigint) language sql as $$ select c.ok, c.via_a_cent, c.via_b_cent from contabilidad.comprobaciones() c where c.codigo = $1 $$;
create function pg_temp.oper(p_caja text) returns bigint language sql as $$ select e.operativo_cent from contabilidad.efectivo_por_caja() e where e.caja = $1 $$;
create function pg_temp.libro(p_caja text) returns bigint language sql as $$ select e.libro_cent from contabilidad.efectivo_por_caja() e where e.caja = $1 $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.ult() returns bigint language sql as $$ select id from operacion.cierre_reparto order by id desc limit 1 $$;

-- Apertura: caja de Angelo 500.00 y de Javier 1,000.00 -----------------------------------------------------------------------------------------------
create temp table _s as select (api.apertura_crear('f29:s', negocio.hoy()) ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('f29:a1', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 50000}');
select api.apertura_agregar('f29:a2', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 100000}');
select api.apertura_firmar('f29:f1', (select id from _s));
select pg_temp.como('Javier');
select is((api.apertura_firmar('f29:f2', (select id from _s)) ->> 'publicada')::boolean, true, 'las dos firmas publican la apertura');
select pg_temp.flush();
select is(pg_temp.oper('Efectivo de Angelo'), 50000::bigint, 'la caja de Angelo entra al libro de efectivo: 500.00');
select is(pg_temp.oper('Efectivo de Javier'), 100000::bigint, 'la de Javier: 1,000.00');
select is(pg_temp.libro('Efectivo de Angelo'), 50000::bigint, 'y el libro la trae con Angelo como dimension');
select is(pg_temp.libro('Efectivo de Javier'), 100000::bigint, 'y a Javier con la suya');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran desde el primer dia de la apertura');
select is(operacion.saldo_efectivo(), 150000::bigint, 'el efectivo de la sociedad es el declarado en la apertura: 1,500.00');
select is((api.apertura_reversar('f29:v', (select id from _s), 'prueba') ->> 'reversada')::boolean, true, 'se revierte la apertura');
select pg_temp.flush();
select is(operacion.saldo_efectivo(), 0::bigint, 'la reversa deja el efectivo en cero');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran tras la reversa');

-- Acta de corte: Javier tiene 6,721.00 en su poder (cobros a su cuenta), Angelo 8,000.00; reembolsos pendientes 2,221.00 y 500.00 -------------------------
select catalogo.asegurar_cliente('F29 Cliente', 'Angelo');
select catalogo.asegurar_modelo('F29 Marca', 'F29 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F29 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('f29cc', 'Isaac', 'F29 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f29cp', 'F29 Cliente', 'F29 Modelo 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('f29pe', pg_temp.cid('F29 Cliente'), '[{"modelo":"F29 Modelo 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 372100, 0, 0, '2021-03-03');
select operacion.confirmar_pedido('f29pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f29pe'));
select operacion.enviar_pedido('f29pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f29pe'), null, '{"paqueteria":"Castores","numero":"F29-G1","costo_cent":0}'::jsonb, '2021-03-03', true);
select operacion.registrar_pago('f29pg1', 'Angelo', 800000, pg_temp.cid('F29 Cliente'), null, true, 'abono', '2021-03-04');
select operacion.registrar_pago('f29pg2', 'Javier', 672100, pg_temp.cid('F29 Cliente'), null, true, 'abono', '2021-03-04');
select operacion.registrar_gasto_socio('f29g1', 'Angelo', 50000, 'envio', 'variable', '2021-03-04', null, 'Guia a Monterrey', 'Pague 500 de envio');
select operacion.registrar_gasto_socio('f29g2', 'Javier', 122100, 'costos del sistema', 'fijo', '2021-03-05', null, 'Suscripciones del mes');
select operacion.registrar_aportacion('f29a1', 'Javier', 100000, 'Deposito de Javier', 'reembolso', '2021-03-05');
select pg_temp.flush();
select is(operacion.saldo_efectivo(), 100000::bigint, 'antes del acta el efectivo de las cajas es el deposito de 1,000.00');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran antes del acta');
create temp table _antes as select operacion.efectivo_sociedad() as e, operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos') as fj, operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos') as fa;
select operacion.proponer_cierre_reparto('f29-a1', '2021-03-02', '2021-03-08');
select pg_temp.como('Angelo');
select operacion.firmar_cierre_reparto('f29-a2', pg_temp.ult());
select pg_temp.como('Javier');
select is((operacion.firmar_cierre_reparto('f29-a3', pg_temp.ult())->>'cerrado')::boolean, true, 'con las dos firmas el acta surte efecto');
select pg_temp.flush();
-- El acta paga reembolsos por 2,721.00 (2,221 de Javier y 500 de Angelo): el efectivo total baja exactamente eso, repartido entre la caja y lo que los socios tenian en su poder.
select is((select (e->>'total_cent')::bigint from _antes) - (operacion.efectivo_sociedad()->>'total_cent')::bigint, 272100::bigint, 'el efectivo de la sociedad baja lo que el acta pago de reembolsos: 2,721.00');
select ok((select ok from pg_temp.c('C23')), 'C23 cuadra tras firmar el acta: el reembolso del acta salio de la caja en el libro de efectivo y en 1101');
select ok((select ok from pg_temp.c('C24')), 'C24 cuadra tras firmar el acta');
select is((select count(*)::int from operacion.cuenta_efectivo_mov where concepto = 'pago_acta'), 2, 'un renglon de pago de acta por socio con reembolso');
select is((select count(*)::int from operacion.cuenta_efectivo_mov where concepto = 'compensacion_acta'), (select count(*)::int from operacion.cuenta_socio_mov where concepto = 'compensacion_reparto'), 'un renglon por cada compensacion del acta');
-- Contra-acta: todo regresa.
select pg_temp.como('Angelo');
create temp table _ca as select operacion.contra_acta_reparto('f29-c1', (select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1), 'Se capturo mal una venta') as r;
select operacion.firmar_cierre_reparto('f29-c2', (select (r->>'cierre_id')::bigint from _ca));
select pg_temp.como('Javier');
select is((operacion.firmar_cierre_reparto('f29-c3', (select (r->>'cierre_id')::bigint from _ca))->>'cerrado')::boolean, true, 'la contra-acta surte efecto');
select pg_temp.flush();
select is(operacion.saldo_efectivo(), 100000::bigint, 'la contra-acta devuelve la caja a 1,000.00');
select is((operacion.efectivo_sociedad()->>'total_cent')::bigint, (select (e->>'total_cent')::bigint from _antes), 'y el efectivo total de la sociedad al de antes del acta');
select ok((select ok from pg_temp.c('C23')) and (select ok from pg_temp.c('C24')), 'C23 y C24 cuadran tras la contra-acta');

select * from finish();
rollback;
