-- pgTAP: omar.mis_solicitudes, mis_liquidaciones y mis_paquetes (lecturas propias de Omar, sin folios de pedido ni de compra).
begin;
-- Estas pruebas fijan la compensacion SEMANAL de la renta (comportamiento anterior): se apaga el modo mensual del dia 15 dentro de la transaccion. La regla mensual se prueba en a12_001.
update catalogo.config set valor = 'null'::jsonb where clave = 'omar_renta_dia_compensacion';
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('t22.socio@example.test', 'socio', 'Javier', true), ('t22.omar@example.test', 'omar', null, true), ('t22.off@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('d2200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't22.socio@example.test'),
  ('d2200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't22.omar@example.test'),
  ('d2200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't22.off@example.test');
select set_config('request.jwt.claim.sub', 'd2200000-0000-0000-0000-000000000001', true);

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('T22 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('T22 Omar Cliente', 'T22 Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('T22 Cliente', 'Angelo');
select catalogo.asegurar_modelo('T22 Marca', 'T22 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('T22 Modelo 30K', 'Mango'); select catalogo.asegurar_sku('T22 Modelo 30K', 'Uva');
select catalogo.fijar_costo('t22k', 'Isaac', 'T22 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('t22p', 'T22 Cliente', 'T22 Modelo 30K', 15000, '2020-01-01', 'chat');
select catalogo.fijar_precio('t22po', (select nombre_canonico from catalogo.cliente where id = (select cliente_id from catalogo.persona_bodega order by id limit 1)), 'T22 Modelo 30K', 14000, '2020-01-01', 'chat');
select operacion.registrar_movimiento('t22m1', 'T22 Modelo 30K', 'Mango', 'bodega_omar', 'entrada_compra', 400, 4000000, '2029-01-01');
select operacion.registrar_movimiento('t22m2', 'T22 Modelo 30K', 'Uva', 'bodega_omar', 'entrada_compra', 400, 4000000, '2029-01-01');

-- Renta y liquidacion de la semana 2029-01-01 (lunes): pedido de 100 pz enviado el 2029-01-02 = 200.00 de renta; la toma de 3 x 140.00 = 420.00.
select operacion.crear_pedido('t22ped', (select id from catalogo.cliente where nombre_canonico = 'T22 Cliente'), '[{"modelo":"T22 Modelo 30K","sabor":"Mango","piezas":100}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2029-01-02');
select operacion.confirmar_pedido('t22pedc', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't22ped'));
select operacion.enviar_pedido('t22peds', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't22ped'), null, null, '2029-01-02');
-- Tomas: una autorizada de un socio (2029-01-03), una pendiente de Omar, una rechazada.
select operacion.registrar_toma_omar('t22t1', '{"modelo":"T22 Modelo 30K","sabor":"Mango"}'::jsonb, 3, 14000, '2029-01-03');
select operacion.registrar_toma_omar('t22t2', '{"modelo":"T22 Modelo 30K","sabor":"Uva"}'::jsonb, 4, null, null, 'telegram_omar');
select operacion.registrar_toma_omar('t22t3', '{"modelo":"T22 Modelo 30K","sabor":"Uva"}'::jsonb, 2, null, null, 'telegram_omar');
select operacion.resolver_toma_omar('t22t3r', (select id from operacion.toma_omar where piezas = 2 and estado = 'pendiente' order by id desc limit 1), 'rechazar');

select operacion.cerrar_liquidacion_omar('t22liq', '2029-01-01', true, '2029-01-09');
select operacion.registrar_pago_omar('t22pg1', 10000, 'de_omar', 'Javier', 'efectivo', '2029-01-10', (select id from operacion.liquidacion_omar where semana_ini = '2029-01-01'));
select operacion.registrar_pago_omar('t22pg2', 3000, 'a_omar', 'Javier', 'efectivo', '2029-01-11', (select id from operacion.liquidacion_omar where semana_ini = '2029-01-01'));

-- Paquetes: un pedido por empacar y otro empacado (de 8 y 5 piezas), una compra en trayecto y otra que llego, una directa.
select operacion.crear_pedido('t22pa', (select id from catalogo.cliente where nombre_canonico = 'T22 Cliente'), '[{"modelo":"T22 Modelo 30K","sabor":"Mango","piezas":5},{"modelo":"T22 Modelo 30K","sabor":"Uva","piezas":3}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('t22pac', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't22pa'));
select operacion.crear_pedido('t22pb', (select id from catalogo.cliente where nombre_canonico = 'T22 Cliente'), '[{"modelo":"T22 Modelo 30K","sabor":"Uva","piezas":5}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('t22pbc', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't22pb'));
select operacion.marcar_empacado('t22pbe', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't22pb'));
select operacion.crear_pedido('t22pd', (select id from catalogo.cliente where nombre_canonico = 'T22 Cliente'), '[{"modelo":"T22 Modelo 30K","sabor":"Uva","piezas":9}]'::jsonb, 'isaac_directo', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('t22pdc', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't22pd'));
select operacion.crear_compra('t22c1', 'Isaac', '[{"modelo":"T22 Modelo 30K","sabor":"Mango","pagadas":50,"facturadas":50}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', null, null);
select operacion.confirmar_compra('t22c1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 't22c1'));
select operacion.marcar_compra_enviada('t22c1e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 't22c1'), '[{"paqueteria":"Castores","numero":"G-T22"}]'::jsonb, negocio.hoy() + 3, negocio.hoy());
select operacion.crear_compra('t22c2', 'Isaac', '[{"modelo":"T22 Modelo 30K","sabor":"Uva","pagadas":20,"facturadas":20}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', null, null);
select operacion.confirmar_compra('t22c2c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 't22c2'));
select operacion.marcar_compra_enviada('t22c2e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 't22c2'), '[{"paqueteria":"Castores","numero":"G-T22B"}]'::jsonb, negocio.hoy() + 1, negocio.hoy());
select operacion.marcar_llego_merida('t22c2m', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 't22c2'));
select operacion.crear_compra('t22c3', 'Isaac', '[{"modelo":"T22 Modelo 30K","sabor":"Uva","pagadas":7,"facturadas":7}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', null, null);   -- borrador: no aparece

select set_config('t22.hoy', negocio.hoy()::text, true);
-- ---- Omar activo -----------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2200000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(jsonb_array_length(omar.mis_solicitudes()), 3, 'solicitudes: las tres tomas (todas las vias)');
select is(omar.mis_solicitudes()->0->>'estado', 'rechazada', 'la mas reciente primero');
select is((select string_agg(x->>'estado', ',' order by x->>'folio') from jsonb_array_elements(omar.mis_solicitudes()) x), 'autorizada,pendiente,rechazada', 'estados por folio');
select is(jsonb_array_length(omar.mis_solicitudes(1)), 1, 'el limite se respeta');
select is(jsonb_array_length(omar.mis_solicitudes(0)), 1, 'limite 0 se corrige a 1');
select ok((omar.mis_solicitudes()->1->>'caduca_at')::timestamptz > (omar.mis_solicitudes()->1->>'solicitada_at')::timestamptz, 'caduca_at es posterior a la solicitud');
select is((select count(*)::int from jsonb_array_elements(omar.mis_solicitudes()) x where x ? 'precio_cent' or x ? 'precio' or x ? 'importe'), 0, 'sin precio ni importe');
select is(jsonb_array_length(omar.mis_liquidaciones()), 1, 'liquidaciones: una');
select is((omar.mis_liquidaciones()->0->>'renta_cent')::bigint, 20000::bigint, 'renta 200.00');
select is((omar.mis_liquidaciones()->0->>'tomas_cent')::bigint, 42000::bigint, 'tomas 420.00');
select is((omar.mis_liquidaciones()->0->>'neto_cent')::bigint, -22000::bigint, 'neto -220.00 (Omar debe)');
select is((omar.mis_liquidaciones()->0->>'pagado_cent')::bigint, -7000::bigint, 'pagado con signo: +3,000 a Omar menos 10,000 de Omar');
select is(omar.mis_liquidaciones()->0->>'semana_ini', '2029-01-01', 'semana_ini');
select is((select count(*)::int from jsonb_object_keys(omar.mis_liquidaciones()->0)), 9, 'nueve campos exactos');
select is(jsonb_array_length(omar.mis_paquetes()), 4, 'paquetes: dos salidas y dos entradas; ni la compra en borrador ni el pedido directo');
select is(omar.mis_paquetes()->0->>'tipo', 'salida', 'salidas primero');
select is((omar.mis_paquetes()->0->>'consecutivo')::int, 1, 'consecutivo 1');
select is(omar.mis_paquetes()->0->>'estado', 'por_empacar', 'el mas antiguo esta por empacar');
select is(omar.mis_paquetes()->1->>'estado', 'empacado', 'el siguiente, empacado');
select is((omar.mis_paquetes()->0->>'horas')::int, 0, 'horas desde que se pidio preparar');
select is(jsonb_array_length(omar.mis_paquetes()->0->'renglones'), 2, 'renglones por modelo y sabor');
select is((select sum((r->>'piezas')::int)::int from jsonb_array_elements(omar.mis_paquetes()->0->'renglones') r), 8, '8 piezas por empacar');
select is((select string_agg(x->>'estado', ',') from jsonb_array_elements(omar.mis_paquetes()) x where x->>'tipo' = 'entrada'), 'en_trayecto,llego', 'entradas: en trayecto y llego');
select is((select (x->>'llegada_estimada')::date from jsonb_array_elements(omar.mis_paquetes()) x where x->>'estado' = 'en_trayecto'), current_setting('t22.hoy')::date + 3, 'llegada estimada');
select is((select count(*)::int from jsonb_array_elements(omar.mis_paquetes()) x, jsonb_object_keys(x) k where k not in ('consecutivo', 'tipo', 'estado', 'horas', 'llegada_estimada', 'renglones')), 0, 'solo las llaves de la lista blanca');
select is((select count(*)::int from jsonb_array_elements(omar.mis_paquetes()) x where x::text ~* '(P-[0-9]|C-[0-9]|G-T22|T22 Cliente|Isaac|costo|guia)'), 0, 'ningun folio de pedido o compra, cliente, proveedor, guia ni costo');
reset role;

-- ---- permisos --------------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2200000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select omar.mis_solicitudes()$$, '42501', null, 'Omar desactivado: solicitudes');
select throws_ok($$select omar.mis_liquidaciones()$$, '42501', null, 'Omar desactivado: liquidaciones');
select throws_ok($$select omar.mis_paquetes()$$, '42501', null, 'Omar desactivado: paquetes');
reset role;
select set_config('request.jwt.claim.sub', 'd2200000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select omar.mis_solicitudes()$$, '42501', null, 'socio: solicitudes');
select throws_ok($$select omar.mis_liquidaciones()$$, '42501', null, 'socio: liquidaciones');
select throws_ok($$select omar.mis_paquetes()$$, '42501', null, 'socio: paquetes');
reset role;
set local role anon;
select throws_ok($$select omar.mis_solicitudes()$$, '42501', null, 'anon: solicitudes');
select throws_ok($$select omar.mis_liquidaciones()$$, '42501', null, 'anon: liquidaciones');
select throws_ok($$select omar.mis_paquetes()$$, '42501', null, 'anon: paquetes');
reset role;

select * from finish();
rollback;
