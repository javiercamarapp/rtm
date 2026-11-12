-- pgTAP del lote "cuadrar cuentas": cuando los socios ponen todo el costo de la compra, Socios cuadra por dos vias; lo que la sociedad financia aparece como
-- "Parte del costo no la pusieron los socios" y es EXACTAMENTE lo que impide que cuadre. Cifras ilustrativas; nada real. Corre sobre una base recien reiniciada.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4s.ang@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4s.ang@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777e1', true);

select catalogo.asegurar_modelo('A4S Marca', 'A4S Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('A4S Modelo 50K', 'Sin sabor');
select catalogo.fijar_costo('a4s-c', 'Isaac', 'A4S Modelo 50K', 9000, '2026-11-01', 'prueba');
create temp table _cs0 as select operacion.cuenta_socios() as c;
select is((select (c->>'cuadra')::boolean from _cs0), true, 'sin compras, la cuenta de socios cuadra');

-- Caso 1: los socios ponen TODO el costo (la mitad cada uno): cuadra y no hay nada financiado por la sociedad.
select operacion.crear_compra('a4s-oc1', 'Isaac', '[{"modelo":"A4S Modelo 50K","sabor":"Sin sabor","pagadas":100,"facturadas":100}]'::jsonb, 0, 0, '2026-11-02', 'bodega', 'sociedad', 'Angelo', 'Angelo');
select operacion.confirmar_compra('a4s-oc1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'a4s-oc1'));
select operacion.pago_proveedor_de_socio('a4s-p1a', 'Isaac', 450000, 'Angelo', 'aportacion', '2026-11-06');
select operacion.pago_proveedor_de_socio('a4s-p1j', 'Isaac', 450000, 'Javier', 'aportacion', '2026-11-06');
create temp table _cs1 as select operacion.cuenta_socios() as c;
select is((select (c->>'costo_cent')::bigint from _cs1), 900000::bigint, 'el costo de la compra es 9,000.00');
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _cs1), 0::bigint, 'los socios pusieron todo: nada financiado por la sociedad');
select is((select (c->>'cuadra')::boolean from _cs1), true, 'con todo el costo puesto por los socios, la identidad por dos vias cuadra');

-- Caso 2: la sociedad paga 2,000.00 del costo de otra compra: no cuadra y la diferencia es exactamente lo financiado.
select operacion.crear_compra('a4s-oc2', 'Isaac', '[{"modelo":"A4S Modelo 50K","sabor":"Sin sabor","pagadas":100,"facturadas":100}]'::jsonb, 0, 0, '2026-11-03', 'bodega', 'sociedad', 'Angelo', 'Angelo');
select operacion.confirmar_compra('a4s-oc2c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'a4s-oc2'));
select operacion.pago_proveedor_de_socio('a4s-p2a', 'Isaac', 350000, 'Angelo', 'aportacion', '2026-11-07');
select operacion.pago_proveedor_de_socio('a4s-p2j', 'Isaac', 350000, 'Javier', 'aportacion', '2026-11-07');
select operacion.registrar_pago_proveedor_sociedad('a4s-p2s', 'Isaac', 200000, '2026-11-07', 'pago ilustrativo de la sociedad');
create temp table _cs2 as select operacion.cuenta_socios() as c;
select is((select (c->>'financiado_por_sociedad_cent')::bigint from _cs2), 200000::bigint, 'la sociedad financio 2,000.00 del costo');
select is((select (c->>'cuadra')::boolean from _cs2), false, 'con parte del costo puesta por la sociedad, la identidad por dos vias no cuadra');
select is(2 * (select (c->>'via1_cent')::bigint from _cs2) - (select (c->>'via2_cent')::bigint * 2 + (c->>'via2_resto_cent')::bigint from _cs2),
          -(select (c->>'financiado_por_sociedad_cent')::bigint from _cs2), 'la diferencia entre las dos vias es exactamente lo que financio la sociedad');

select * from finish();
rollback;
