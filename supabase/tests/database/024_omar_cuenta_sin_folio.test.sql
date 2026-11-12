-- pgTAP: omar.v_mi_cuenta no expone el folio del pedido en la renta (agrupada por dia); las reversas netean; las tomas y los pagos no cambian.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('t24.socio@example.test', 'socio', 'Javier', true), ('t24.omar@example.test', 'omar', null, true), ('t24.off@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('d2400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't24.socio@example.test'),
  ('d2400000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't24.omar@example.test'),
  ('d2400000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't24.off@example.test');
select set_config('request.jwt.claim.sub', 'd2400000-0000-0000-0000-000000000001', true);

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('T24 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('T24 Omar Cliente', 'T24 Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('T24 Cliente', 'Angelo');
select catalogo.asegurar_modelo('T24 Marca', 'T24 Modelo A 30K', 30000, 'ambas'); select catalogo.asegurar_modelo('T24 Marca', 'T24 Modelo B 30K', 30000, 'ambas');
select catalogo.asegurar_sku('T24 Modelo A 30K', 'Mango'); select catalogo.asegurar_sku('T24 Modelo B 30K', 'Uva');
select catalogo.fijar_costo('t24ka', 'Isaac', 'T24 Modelo A 30K', 10000, '2020-01-01', 'prueba'); select catalogo.fijar_costo('t24kb', 'Isaac', 'T24 Modelo B 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('t24pa', 'T24 Cliente', 'T24 Modelo A 30K', 15000, '2020-01-01', 'chat'); select catalogo.fijar_precio('t24pb', 'T24 Cliente', 'T24 Modelo B 30K', 15000, '2020-01-01', 'chat');
select operacion.registrar_movimiento('t24m1', 'T24 Modelo A 30K', 'Mango', 'bodega_omar', 'entrada_compra', 500, 5000000, '2026-11-10');
select operacion.registrar_movimiento('t24m2', 'T24 Modelo B 30K', 'Uva', 'bodega_omar', 'entrada_compra', 500, 5000000, '2026-11-10');
create function pg_temp.pid(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

-- Dos pedidos distintos el mismo dia (50 pz y 30 pz, modelos distintos) y uno de otro dia.
select operacion.crear_pedido('t24a', (select id from catalogo.cliente where nombre_canonico = 'T24 Cliente'), '[{"modelo":"T24 Modelo A 30K","sabor":"Mango","piezas":50}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10');
select operacion.confirmar_pedido('t24ac', pg_temp.pid('t24a')); select operacion.enviar_pedido('t24as', pg_temp.pid('t24a'), null, null, '2026-11-10', true);
select operacion.crear_pedido('t24b', (select id from catalogo.cliente where nombre_canonico = 'T24 Cliente'), '[{"modelo":"T24 Modelo B 30K","sabor":"Uva","piezas":30}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10');
select operacion.confirmar_pedido('t24bc', pg_temp.pid('t24b')); select operacion.enviar_pedido('t24bs', pg_temp.pid('t24b'), null, null, '2026-11-10', true);
select operacion.crear_pedido('t24c', (select id from catalogo.cliente where nombre_canonico = 'T24 Cliente'), '[{"modelo":"T24 Modelo A 30K","sabor":"Mango","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-11');
select operacion.confirmar_pedido('t24cc', pg_temp.pid('t24c')); select operacion.enviar_pedido('t24cs', pg_temp.pid('t24c'), null, null, '2026-11-11', true);
select operacion.registrar_toma_omar('t24t1', '{"modelo":"T24 Modelo A 30K","sabor":"Mango"}'::jsonb, 2, 15000, '2026-11-11');
select operacion.registrar_pago_omar('t24pg', 5000, 'de_omar', 'Javier', 'efectivo', '2026-11-11');

select set_config('request.jwt.claim.sub', 'd2400000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mi_cuenta where concepto = 'renta' and fecha between '2026-11-09' and '2026-11-15'), 2, 'renta agrupada por dia: dos dias, aunque hubo tres pedidos');
select is((select piezas from omar.v_mi_cuenta where concepto = 'renta' and fecha = '2026-11-10'), 80, 'el primer dia suma 50 + 30 piezas');
select is((select importe from omar.v_mi_cuenta where concepto = 'renta' and fecha = '2026-11-10'), 16000::bigint, 'y 160.00 de renta');
select is((select tarifa from omar.v_mi_cuenta where concepto = 'renta' and fecha = '2026-11-10'), 200::bigint, 'tarifa de 2.00 por pieza');
select is((select modelo from omar.v_mi_cuenta where concepto = 'renta' and fecha = '2026-11-10'), null, 'la renta no trae modelo');
select is((select referencia from omar.v_mi_cuenta where concepto = 'renta' and fecha = '2026-11-10'), 'R-20261110', 'referencia derivada de la fecha, no del pedido');
select is((select count(*)::int from omar.v_mi_cuenta where concepto = 'renta' and referencia ~ '^P-[0-9]'), 0, 'ninguna renta lleva folio de pedido');
select is((select count(*)::int from omar.v_mi_cuenta where referencia ~ '^P-[0-9]'), 0, 'ni ninguna otra fila');
select is((select count(*)::int from omar.v_mi_cuenta where concepto = 'toma' and importe = -30000), 1, 'la toma: 2 x 150.00 en negativo');
select is((select importe from omar.v_mi_cuenta where concepto = 'pago'), -5000::bigint, 'el pago de Omar queda en negativo');
reset role;

-- Reversa: anular el pedido de 50 piezas (100.00) resta su renta en el dia de la reversa (hoy), donde ya habia +40.00: queda un ajuste de -60.00, sin folio.
select set_config('request.jwt.claim.sub', 'd2400000-0000-0000-0000-000000000001', true);
select operacion.anular_pedido('t24an', pg_temp.pid('t24a'), 'prueba');
select set_config('request.jwt.claim.sub', 'd2400000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mi_cuenta where concepto = 'renta' and importe < 0), 1, 'la reversa neta aparece como un ajuste negativo');
select is((select count(*)::int from omar.v_mi_cuenta where concepto = 'renta' and referencia like 'Ajuste %'), 1, 'referencia Ajuste');
select is((select importe from omar.v_mi_cuenta where concepto = 'renta' and referencia like 'Ajuste %'), -6000::bigint, 'ajuste de -60.00');
select is((select sum(importe)::bigint from omar.v_mi_cuenta where concepto = 'renta'), 10000::bigint, 'y la renta neta total es 100.00 (160.00 + 40.00 - 100.00)');
select throws_ok($$select * from operacion.v_omar_cuenta_base$$, '42501', null, 'la capa intermedia no es legible por Omar');
select is((select count(*)::int from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'omar' and a.attnum > 0 and not a.attisdropped and a.attname ~* '(folio|costo|margen|utilidad|cliente|proveedor)'), 0, 'lista negra de columnas: sin folio, costo, margen, utilidad, cliente ni proveedor');
reset role;

-- Cerrada para quien no es Omar activo.
select set_config('request.jwt.claim.sub', 'd2400000-0000-0000-0000-000000000003', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mi_cuenta), 0, 'Omar desactivado: cero filas');
reset role;
select set_config('request.jwt.claim.sub', 'd2400000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mi_cuenta), 0, 'socio: cero filas');
reset role;
set local role anon;
select throws_ok($$select * from omar.v_mi_cuenta$$, '42501', null, 'anon: sin acceso');
reset role;

select * from finish();
rollback;
