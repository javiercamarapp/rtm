-- pgTAP del lote "cuadrar cuentas": el flujo de primeros movimientos (apertura, compra a Isaac con guia de Angelo, fondos en poder de los socios, pago de la sociedad,
-- pago con fondos, deposito de un socio) deja el libro de Socios CONCILIADO en cada paso (la senal de salud son las identidades del libro, no un cuadro de cifras), con
-- "pendiente de pago al proveedor" mientras falte pagar, y la diferencia por la compra (via 1 y via 2) como dato informativo. Ademas: alta de la persona de bodega desde
-- la web. Ninguna asercion depende de una cifra elegida de antemano: se compara contra sumas independientes. Cifras ilustrativas; nada real.
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
select catalogo.asegurar_cliente('A4F Cliente', 'Javier');
select operacion.registrar_pago('a4f-cobro-a', 'Angelo', 100000, (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4F Cliente')), null, true, 'abono', negocio.hoy(), null, null, 'cobro ilustrativo en la cuenta del socio');
select operacion.registrar_pago('a4f-cobro-j', 'Javier', 230000, (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4F Cliente')), null, true, 'abono', negocio.hoy(), null, null, 'cobro ilustrativo en la cuenta del socio');

-- El flujo de la demostracion: Javier paga 500.00 a Isaac con los fondos de la sociedad que tiene; la sociedad paga 1,000.00; Javier deposita 2,000.00 (reembolso).
select operacion.pago_proveedor_de_socio('a4f-pj', 'Isaac', 50000, 'Javier', 'fondos_sociedad', negocio.hoy());
select operacion.registrar_pago_proveedor_sociedad('a4f-ps', 'Isaac', 100000, negocio.hoy(), 'pago ilustrativo de la sociedad');
select operacion.registrar_aportacion('a4f-dep', 'Javier', 200000, 'deposito ilustrativo', 'reembolso', negocio.hoy());
create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;
select is(pg_temp.fallan(), '', 'tras la apertura, la compra, los fondos en poder, el pago de Javier con fondos, el pago de la sociedad y el deposito: libro conciliado');
create temp table _a as select operacion.cuenta_socios() as c;
select is((select c->'cuadre'->>'estado' from _a), 'pendiente_proveedor', 'etiqueta honesta: libro conciliado, pendiente de pago al proveedor');
select is((select (c->'cuadre'->>'pendiente_proveedor_cent')::bigint from _a), (select -operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))), 'lo pendiente es lo que se debe a Isaac segun su cuenta');
select is((select (c->>'costo_cent')::bigint from _a), (select sum(total_cent)::bigint from operacion.compra where ambito = 'sociedad' and estado not in ('borrador', 'anulada')), 'el costo es el de las compras de la sociedad');
select is((select (c->>'otros_cent')::bigint from _a), -contabilidad.apertura_saldo(contabilidad.cta_proveedor(catalogo.proveedor_id('Isaac'))), 'lo que no es la compra en el desglose es exactamente lo que la apertura dice que se debe a Isaac (otros)');
select is((select (c->>'costo_cent')::bigint from _a), (select (c->>'directo_socios_cent')::bigint + (c->>'pagado_por_sociedad_cent')::bigint + (c->>'pagado_con_fondos_cent')::bigint + (c->>'pendiente_proveedor_cent')::bigint + (c->>'otros_cent')::bigint from _a), 'costo = dinero propio de socios + caja de la sociedad + fondos en poder + pendiente + otros');
select is((select (c->>'pagado_por_sociedad_cent')::bigint from _a), (select sum(monto_cent)::bigint from operacion.cuenta_proveedor_mov where concepto = 'pago_sociedad'), 'lo pagado por la sociedad es lo registrado como pago de la sociedad');

-- Cada socio registra en Proveedores lo que pago de su bolsillo (dinero propio) por lo que falta: es REEMBOLSO, no capital, y el libro sigue conciliado.
select operacion.pago_proveedor_de_socio('a4f-ba', 'Isaac', (select (c->>'pendiente_proveedor_cent')::bigint / 2 from _a), 'Angelo', 'dinero_propio', negocio.hoy());
select operacion.pago_proveedor_de_socio('a4f-bj', 'Isaac', (select (c->>'pendiente_proveedor_cent')::bigint - (c->>'pendiente_proveedor_cent')::bigint / 2 from _a), 'Javier', 'dinero_propio', negocio.hoy());
select is((select count(*) from operacion.aportacion_socio where ref_tipo = 'cuenta_proveedor' and clasificacion = 'reembolsable'), 2::bigint, 'los dos pagos de bolsillo quedan como reembolso');
select is((select count(*) from operacion.aportacion_socio where ref_tipo = 'cuenta_proveedor' and clasificacion = 'capital'), 0::bigint, 'y ninguno como capital');
select is(pg_temp.fallan(), '', 'con el proveedor saldado: libro conciliado');
create temp table _b as select operacion.cuenta_socios() as c;
select is((select c->'cuadre'->>'estado' from _b), 'conciliado', 'etiqueta: libro conciliado (ya sin pendiente con el proveedor)');
select is((select (c->>'pendiente_proveedor_cent')::bigint from _b), 0::bigint, 'nada pendiente con el proveedor');
select is((select (c->>'otros_cent')::bigint from _b), -contabilidad.apertura_saldo(contabilidad.cta_proveedor(catalogo.proveedor_id('Isaac'))), 'y el desglose sigue explicando todo el costo');
-- La diferencia por la compra es informativa: la dicen las dos vias a partir de lo que cada socio puso con su dinero y no tiene que coincidir con la salud del libro.
select is((select (c->>'via1_cent')::bigint from _b), (select (c->'angelo'->>'aportado_cent')::bigint - (c->>'mitad_cent')::bigint from _b), 'via 1 = lo puesto por Angelo menos la mitad del costo (informativa)');

select * from finish();
rollback;
