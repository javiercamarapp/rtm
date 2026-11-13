-- pgTAP: el dinero propio de un socio que paga a un proveedor es REEMBOLSO por omision; solo es CAPITAL si el socio lo declara (p_declara_capital).
-- Cubre: omision = reembolsable (aportacion_socio y asiento 2310, no 3110), declaracion = capital (3110), mezcla con fondos de la sociedad, idempotencia (misma clave, mismo
-- resultado y una sola fila; la declaracion forma parte de la huella), permisos (anon y authenticated sin rol de socio no ejecutan), cuenta de socios con via 1 = via 2 y el
-- parametro 'caja_sociedad_cuenta_puesto_pct' (0 por omision = sin cambio). Cifras ilustrativas; nada real.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4g.ang@example.test', 'socio', 'Angelo', true), ('a4g.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777f3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4g.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777f4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4g.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777f3' else '77777777-7777-7777-7777-7777777777f4' end, true) $$;
create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.haber(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
select pg_temp.como('Angelo');

select catalogo.asegurar_modelo('A4G Marca', 'A4G Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('A4G Modelo 25K', 'Fresa');
select catalogo.fijar_costo('a4g-c', 'Isaac', 'A4G Modelo 25K', 10000, negocio.hoy() - 60, 'prueba');
-- Compra a Isaac: 50 piezas a 100.00 = 5,000.00 (sin guia).
select operacion.crear_compra('a4g-oc', 'Isaac', '[{"modelo":"A4G Modelo 25K","sabor":"Fresa","pagadas":50,"facturadas":50}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', 'Angelo', 'Angelo');
select operacion.confirmar_compra('a4g-occ', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'a4g-oc'));

-- Omision: dinero propio SIN declaracion = reembolso (cuenta por pagar al socio), por cualquiera de las fuentes que no son fondos de la sociedad.
create temp table _a as select operacion.pago_proveedor_de_socio('a4g-a1', 'Isaac', 100000, 'Angelo') as r;
select is((select r->>'clasificacion' from _a), 'reembolsable', 'omision (fuente auto, sin declaracion): el resultado dice reembolsable');
select is((select r->>'aportacion_cent' from _a)::bigint, 100000::bigint, 'el dinero propio es 1,000.00');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Angelo'), 'capital'), 0::bigint, 'y NO se registra capital');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Angelo'), 'reembolsable'), 100000::bigint, 'queda como reembolsable (cuenta por pagar al socio)');
select pg_temp.como('Javier');
select operacion.pago_proveedor_de_socio('a4g-j1', 'Isaac', 50000, 'Javier', 'dinero_propio');
select operacion.pago_proveedor_de_socio('a4g-j2', 'Isaac', 20000, 'Javier', 'aportacion');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Javier'), 'capital'), 0::bigint, 'dinero_propio y el sinonimo antiguo aportacion, sin declarar, tampoco son capital');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Javier'), 'reembolsable'), 70000::bigint, 'ambos son reembolsable: 700.00');
select is((select count(*) from operacion.aportacion_socio a join catalogo.socio s on s.id = a.socio_id where s.nombre = 'Javier' and a.concepto like '%(reembolso)'), 2::bigint, 'el concepto lo dice');

-- Declaracion explicita: capital.
create temp table _c as select operacion.pago_proveedor_de_socio('a4g-c1', 'Isaac', 100000, 'Javier', 'dinero_propio', null, 'reinvierto en la compra', null, true) as r;
select is((select r->>'clasificacion' from _c), 'capital', 'con declaracion expresa el resultado dice capital');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Javier'), 'capital'), 100000::bigint, 'y se registra capital: 1,000.00');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Javier'), 'reembolsable'), 70000::bigint, 'lo anterior no cambia');
select is((select count(*) from operacion.aportacion_socio a join catalogo.socio s on s.id = a.socio_id where s.nombre = 'Javier' and a.concepto like '%(capital declarado)'), 1::bigint, 'el concepto dice capital declarado');

-- Declarar capital sin dinero propio (todo salio de fondos de la sociedad) se rechaza.
select catalogo.asegurar_cliente('A4G Cliente', 'Javier');
select operacion.registrar_pago('a4g-pg', 'Javier', 40000, (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4G Cliente')), null, true, 'abono', negocio.hoy(), null, null, 'cobro ilustrativo en la cuenta del socio');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Javier'), 'fondos'), 40000::bigint, 'Javier tiene 400.00 de la sociedad en su poder (cobro de un cliente)');
select throws_ok($$select operacion.pago_proveedor_de_socio('a4g-x1', 'Isaac', 40000, 'Javier', 'fondos_sociedad', null, null, null, true)$$, '23514', null, 'declarar capital cuando todo el pago salio de fondos de la sociedad se rechaza');
-- Mezcla: 'auto' con declaracion baja primero lo que debe a la sociedad (400.00) y el resto (600.00) es el capital declarado.
create temp table _m as select operacion.pago_proveedor_de_socio('a4g-m1', 'Isaac', 100000, 'Javier', 'auto', null, null, null, true) as r;
select is((select (r->>'baja_deuda_cent')::bigint from _m), 40000::bigint, 'mezcla: 400.00 salen de fondos de la sociedad');
select is((select (r->>'aportacion_cent')::bigint from _m), 60000::bigint, 'mezcla: 600.00 son dinero propio');
select is((select r->>'clasificacion' from _m), 'capital', 'mezcla: lo propio es capital porque se declaro');
select is(operacion.aportado_socio((select id from catalogo.socio where nombre = 'Javier'), 'capital'), 160000::bigint, 'capital de Javier: 1,000.00 + 600.00, solo lo declarado');

-- Idempotencia: la misma clave devuelve lo mismo y no duplica; la declaracion forma parte de la huella.
create temp table _n1 as select count(*)::bigint as n from operacion.aportacion_socio;
select is(operacion.pago_proveedor_de_socio('a4g-c1', 'Isaac', 100000, 'Javier', 'dinero_propio', null, 'reinvierto en la compra', null, true), (select r from _c), 'repetir la misma clave devuelve el mismo resultado');
select is((select count(*)::bigint from operacion.aportacion_socio), (select n from _n1), 'y no duplica la aportacion');
select throws_ok($$select operacion.pago_proveedor_de_socio('a4g-c1', 'Isaac', 100000, 'Javier', 'dinero_propio', null, 'reinvierto en la compra', null, false)$$, null, null, 'la misma clave con otra declaracion se rechaza (no cambia en silencio la clasificacion)');

-- Asientos: reembolso = cuenta por pagar al socio (2310); capital = capital (3110/3120). Cada asiento cuadra.
select set_config('request.jwt.claim.sub', null, true);
set constraints all immediate;
set constraints all deferred;
select pg_temp.flush();
select is(pg_temp.haber('a4g-a1', '2310') + pg_temp.haber('a4g-a1', '2320'), 100000::bigint, 'omision: el asiento acredita la cuenta por pagar al socio (2310/2320), no el capital');
select is(pg_temp.haber('a4g-a1', '3110') + pg_temp.haber('a4g-a1', '3120'), 0::bigint, 'omision: nada va a capital');
select is(pg_temp.haber('a4g-c1', '3110') + pg_temp.haber('a4g-c1', '3120'), 100000::bigint, 'declarado: el asiento acredita capital');
select is(pg_temp.haber('a4g-c1', '2310') + pg_temp.haber('a4g-c1', '2320'), 0::bigint, 'declarado: nada va a la cuenta por pagar');
select is((select count(*) from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id in (select id from operacion.evento where clave_idem like 'a4g-%') group by a.id having sum(l.debe_cent) <> sum(l.haber_cent) limit 1), null::bigint, 'ningun asiento de la prueba queda descuadrado');
select is((select count(*) from contabilidad.comprobaciones() where bloqueante and not ok), 0::bigint, 'ninguna comprobacion bloqueante falla');

-- Cuenta de socios: da igual capital o reembolso para "lo puesto"; cuadra con via 1 = via 2 cuando los socios ponen todo el costo.
-- Costo 5,000.00. Puesto: Angelo 1,000.00; Javier 700.00 + 1,000.00 + 600.00 = 2,300.00; la sociedad financio 1,700.00.
create temp table _s0 as select operacion.cuenta_socios() as c;
select is((select (c->>'caja_cuenta_puesto_pct')::numeric from _s0), 0::numeric, 'el parametro de caja de la sociedad vale 0 por omision (nada se cuenta como puesto por los socios)');
select is((select (c->>'puesto_por_caja_cent')::bigint from _s0), 0::bigint, 'y por lo tanto no atribuye nada');
select is((select ((c->'angelo'->>'aportado_cent')::bigint + (c->'javier'->>'aportado_cent')::bigint) from _s0), (select (c->>'costo_cent')::bigint - (c->>'financiado_por_sociedad_cent')::bigint from _s0), 'puesto por los socios + financiado por la sociedad = costo');
select is((select (c->'angelo'->>'puso_capital_cent')::bigint from _s0), 0::bigint, 'Cuenta de socios: Angelo no puso capital');
select is((select (c->'javier'->>'puso_capital_cent')::bigint from _s0), 160000::bigint, 'Cuenta de socios: el capital de Javier es solo lo declarado');
-- Parametro de la caja de la sociedad (sobre la foto _s0: la sociedad financio 1,700.00). Con 50 % se atribuye la mitad por mitades iguales; con 100 % toda.
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _s0), 170000::bigint, 'antes de completar el costo, la sociedad financio 1,700.00');
update catalogo.config set valor = '50' where clave = 'caja_sociedad_cuenta_puesto_pct';
create temp table _p50 as select operacion.cuenta_socios() as c;
select is((select (c->>'puesto_por_caja_cent')::bigint from _p50), 85000::bigint, 'con 50 %: se atribuyen 850.00 de la caja de la sociedad');
select is((select (c->'angelo'->>'aportado_cent')::bigint from _p50), 142500::bigint, 'repartidos por mitades iguales: Angelo 1,000.00 + 425.00');
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _p50), 85000::bigint, 'y queda por financiar 850.00');
update catalogo.config set valor = '100' where clave = 'caja_sociedad_cuenta_puesto_pct';
create temp table _p100 as select operacion.cuenta_socios() as c;
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _p100), 0::bigint, 'con 100 %: nada queda por financiar');
select is((select (c->>'via1_cent')::bigint from _p100), (select (c->>'via2_cent')::bigint from _p100), 'y via 1 = via 2');
select is((select (c->>'cuadra')::boolean from _p100), true, 'y Socios cuadra');
update catalogo.config set valor = '0' where clave = 'caja_sociedad_cuenta_puesto_pct';
select is((select (operacion.cuenta_socios()->>'puesto_por_caja_cent')::bigint), 0::bigint, 'de vuelta a 0 no atribuye nada');

-- Completa el costo con reembolso de Angelo (sin declarar) y la cuenta cuadra.
select pg_temp.como('Angelo');
select operacion.pago_proveedor_de_socio('a4g-a2', 'Isaac', (select (c->>'financiado_por_sociedad_cent')::bigint from _s0), 'Angelo');
create temp table _s1 as select operacion.cuenta_socios() as c;
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _s1), 0::bigint, 'los socios pusieron todo el costo');
select is((select (c->>'via1_cent')::bigint from _s1), (select (c->>'via2_cent')::bigint from _s1), 'via 1 = via 2');
select is((select (c->>'cuadra')::boolean from _s1), true, 'Socios cuadra');

-- Permisos: anon no ejecuta; sin rol de socio la funcion api rechaza.
select pg_temp.como('Angelo');
reset role;
set local role anon;
select throws_ok($$select api.pago_proveedor_de_socio('a4g-p1', 'Isaac', 100, 'Angelo')$$, '42501', null, 'anon no ejecuta api.pago_proveedor_de_socio');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', true);
select throws_ok($$select api.pago_proveedor_de_socio('a4g-p2', 'Isaac', 100, 'Angelo')$$, '42501', null, 'un usuario autenticado que no es socio es rechazado');
select throws_ok($$select operacion.pago_proveedor_de_socio('a4g-p3', 'Isaac', 100, 'Angelo')$$, '42501', null, 'y no ejecuta operacion.* directo');
select pg_temp.como('Angelo');
select lives_ok($$select api.pago_proveedor_de_socio('a4g-p4', 'Isaac', 100, 'Angelo', 'dinero_propio', null, null, null, false)$$, 'un socio si, por la funcion api (con el rol de la web)');
reset role;
select is((select clasificacion from operacion.aportacion_socio order by id desc limit 1), 'reembolsable', 'y por la web tambien es reembolso por omision');
set local role authenticated;
select lives_ok($$select api.pago_proveedor_de_socio('a4g-p5', 'Isaac', 200, 'Angelo', 'dinero_propio', null, null, null, true)$$, 'y con declaracion es capital');
reset role;
select is((select clasificacion from operacion.aportacion_socio order by id desc limit 1), 'capital', 'por la web con declaracion: capital');

select * from finish();
rollback;
