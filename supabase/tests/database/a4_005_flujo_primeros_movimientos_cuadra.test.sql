-- pgTAP del lote "cuadrar cuentas": el flujo de primeros movimientos (apertura, compra a Isaac con guia de Angelo, fondos en poder de los socios, pago de la sociedad,
-- pago con fondos, deposito de un socio) deja la Cuenta de socios en "No cuadra" por una causa exacta (5,800.00 que no pusieron los socios) y, cuando los socios
-- registran su pago de bolsillo a Isaac por esa cifra, cuadra con via 1 = via 2. Ademas: alta de la persona de bodega desde la web. Cifras ilustrativas; nada real.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4f.ang@example.test', 'socio', 'Angelo', true), ('a4f.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4f.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4f.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777f1' else '77777777-7777-7777-7777-7777777777f2' end, true) $$;
select pg_temp.como('Angelo');

-- Persona de bodega desde la web: sin ella no hay persona; con ella si; es idempotente y no admite una segunda distinta.
select throws_ok($$select operacion.persona_bodega_id()$$, 'P0428', null, 'sin alta, no hay persona de bodega configurada');
select catalogo.asegurar_cliente('A4F Omar Cliente', 'Javier');
select catalogo.asegurar_cliente('A4F Otro Cliente', 'Javier');
create temp table _pb as select api.registrar_persona_bodega('a4f:pb1', (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4F Omar Cliente'))) as r;
select is((select r->>'nombre' from _pb), 'A4F Omar Cliente', 'el alta devuelve el nombre de la persona de bodega');
select lives_ok($$select operacion.persona_bodega_id()$$, 'con el alta, la persona de bodega existe');
select is((select count(*) from catalogo.persona_bodega), 1::bigint, 'queda una sola persona de bodega');
select is(api.registrar_persona_bodega('a4f:pb1', (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4F Omar Cliente'))), (select r from _pb), 'repetir la misma clave devuelve lo mismo y no duplica');
select throws_ok($$select api.registrar_persona_bodega('a4f:pb2', (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4F Otro Cliente')))$$, '23505', null, 'no admite una segunda persona de bodega distinta');
select throws_ok($$select api.registrar_persona_bodega('a4f:pb3', 999999999)$$, '22023', null, 'cliente desconocido se rechaza');

-- Apertura firmada por los dos: capital 50,000 y 30,000, cajas 5,000 y 3,000, y se le debe a Isaac 3,000.
create temp table _s as select (api.apertura_crear('a4f:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a4f:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('a4f:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_agregar('a4f:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 500000}');
select api.apertura_agregar('a4f:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 300000}');
select api.apertura_agregar('a4f:p5', (select id from _s), 'proveedor_debemos', jsonb_build_object('proveedor_id', catalogo.proveedor_id('Isaac'), 'monto_cent', 300000));
select api.apertura_resolucion('a4f:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('a4f:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a4f:f2', (select id from _s));
select pg_temp.como('Angelo');

-- Compra a Isaac: 50 piezas a 100.00 y guia de 250.00 pagada por Angelo (costo 5,250.00). Cobros que cayeron en la cuenta de cada socio (fondos en su poder).
select catalogo.asegurar_modelo('A4F Marca', 'A4F Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('A4F Modelo 25K', 'Fresa');
select catalogo.fijar_costo('a4f-c', 'Isaac', 'A4F Modelo 25K', 10000, negocio.hoy() - 60, 'prueba');
select operacion.crear_compra('a4f-oc', 'Isaac', '[{"modelo":"A4F Modelo 25K","sabor":"Fresa","pagadas":50,"facturadas":50}]'::jsonb, 25000, 0, negocio.hoy(), 'bodega', 'sociedad', 'Angelo', 'Angelo');
select operacion.confirmar_compra('a4f-occ', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'a4f-oc'));
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'fondos_en_poder', 'fondos', v.m, 'cobro ilustrativo en la cuenta del socio', operacion.crear_evento('aportacion_socio', negocio.hoy(), 'a4f-fondos-' || s.nombre, '{}'::jsonb, null)
    from (values ('Angelo', 100000::bigint), ('Javier', 230000::bigint)) v(n, m) join catalogo.socio s on s.nombre = v.n;

-- El flujo de la demostracion: Javier paga 500.00 a Isaac con los fondos de la sociedad que tiene; la sociedad paga 1,000.00; Javier deposita 2,000.00 (reembolso).
select operacion.pago_proveedor_de_socio('a4f-pj', 'Isaac', 50000, 'Javier', 'fondos_sociedad', negocio.hoy());
select operacion.registrar_pago_proveedor_sociedad('a4f-ps', 'Isaac', 100000, negocio.hoy(), 'pago ilustrativo de la sociedad');
select operacion.registrar_aportacion('a4f-dep', 'Javier', 200000, 'deposito ilustrativo', 'reembolso', negocio.hoy());
create temp table _a as select operacion.cuenta_socios() as c;
select is((select (c->>'costo_cent')::bigint from _a), 525000::bigint, 'el costo de la compra es 5,250.00');
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _a), 580000::bigint, 'antes de los pagos de bolsillo, 5,800.00 no los pusieron los socios (cifra de la demostracion)');
select is((select (c->>'via1_cent')::bigint from _a), -337500::bigint, 'via 1 = -3,375.00 (la cifra que se veia en la demostracion)');
select is((select (c->>'via2_cent')::bigint from _a), -47500::bigint, 'via 2 = -475.00');
select is((select (c->>'cuadra')::boolean from _a), false, 'sin los pagos de bolsillo, Socios dice No cuadra');

-- Cada socio registra en Proveedores lo que pago de su bolsillo a Isaac (dinero propio): 2,900.00 cada uno = exactamente lo financiado.
select operacion.pago_proveedor_de_socio('a4f-ba', 'Isaac', 290000, 'Angelo', 'dinero_propio', negocio.hoy());
select operacion.pago_proveedor_de_socio('a4f-bj', 'Isaac', 290000, 'Javier', 'dinero_propio', negocio.hoy());
-- Regla del dueno: ese dinero propio es REEMBOLSO (cuenta por pagar al socio), no capital, porque ningun socio declaro capital.
select is((select count(*) from operacion.aportacion_socio where ref_tipo = 'cuenta_proveedor' and clasificacion = 'reembolsable' and monto_cent = 290000), 2::bigint, 'los dos pagos de bolsillo quedan como reembolso');
select is((select count(*) from operacion.aportacion_socio where ref_tipo = 'cuenta_proveedor' and clasificacion = 'capital'), 0::bigint, 'y ninguno como capital');
create temp table _b as select operacion.cuenta_socios() as c;
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _b), 0::bigint, 'los socios pusieron todo el costo: nada financiado por la sociedad');
select is((select (c->>'via1_cent')::bigint from _b), (select (c->>'via2_cent')::bigint from _b), 'via 1 = via 2');
select is((select (c->>'via1_cent')::bigint from _b), -47500::bigint, 'ambas vias dicen -475.00 (con signo: se lee como -475.00 de Javier a Angelo)');
select is((select (c->>'cuadra')::boolean from _b), true, 'Socios cuadra');

select * from finish();
rollback;
