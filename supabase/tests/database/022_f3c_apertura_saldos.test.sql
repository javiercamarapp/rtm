-- pgTAP F3c (ronda 3): los saldos de apertura de socios, proveedores y clientes se ven en las lecturas de saldo y se saldan con las operaciones normales; la firma de los dos
-- socios es la unica forma de crear o deshacer el asiento de apertura; la reversa de la apertura no distorsiona el costo. Cifras ilustrativas calculadas a mano, nada real.
--   Angelo aporta 84,615.00 y Javier 56,000.00; Javier tiene 9,000.00 de la sociedad en su cuenta personal; Karen tiene un saldo a favor de 30,500.00; a Isaac se le deben 3,000.00;
--   el cliente debe 2,500.00 (fecha hace 40 dias) y 7,500.00 (hace 15 dias); inventario de 10 piezas a 90.00.
--   neto de Angelo = 84,615.00; neto de Javier = 56,000.00 - 9,000.00 = 47,000.00; Javier le debe a Angelo (84,615.00 - 47,000.00) / 2 = 18,807.50
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3d.ang@example.test', 'socio', 'Angelo', true), ('f3d.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77666666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3d.ang@example.test'),
  ('77666666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3d.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77666666-6666-6666-6666-666666666661' else '77666666-6666-6666-6666-666666666662' end, true) $$;
select pg_temp.como('Angelo');
create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.rojos() returns bigint language sql as $$ select count(*) from contabilidad.reproducir_saldos() where not ok $$;
create function pg_temp.bloq() returns bigint language sql as $$ select count(*) from contabilidad.comprobaciones() where not ok and bloqueante $$;

select catalogo.asegurar_cliente('F3D Cliente', 'Javier');
select catalogo.asegurar_modelo('F3D Marca', 'F3D Nexa', 50000, 'ambas');
select catalogo.asegurar_sku('F3D Nexa', 'Uno');
create temp table _c as select id from catalogo.cliente where nombre_canonico = 'F3D Cliente';

-- Un asiento de apertura no se crea ni se deshace por fuera de la firma --------------------------------------------------------------------------
select throws_ok($$ select api.conta_asiento_manual('f3d:m0', negocio.hoy(), 'apertura unilateral', '[{"cuenta":"1210","debe_cent":1000000,"cliente_id":1},{"cuenta":"3990","haber_cent":1000000}]'::jsonb, true) $$,
  'P0428', null, 'la API no deja marcar un asiento manual como apertura (A1)');
select is(contabilidad.apertura_saldo('1210'), 0::bigint, 'sin sesion firmada la apertura no aporta saldo a ningun auxiliar');

-- Sesion con una partida de cada categoria ---------------------------------------------------------------------------------------------------------
create temp table _s as select (api.apertura_crear('f3d:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
create function pg_temp.add(p_clave text, p_cat text, p jsonb) returns jsonb language sql as $$ select api.apertura_agregar($1, (select id from _s), $2, $3) $$;
select pg_temp.add('f3d:p1', 'aportacion', '{"socio": "Angelo", "monto_cent": 8461500}');
select pg_temp.add('f3d:p2', 'aportacion', '{"socio": "Javier", "monto_cent": 5600000}');
select pg_temp.add('f3d:p3', 'fondos_en_poder', '{"socio": "Javier", "monto_cent": 900000}');
select pg_temp.add('f3d:p4', 'cxc', format('{"cliente_id": %s, "monto_cent": 250000, "fecha_ref": "%s"}', (select id from _c), negocio.hoy() - 40)::jsonb);
select pg_temp.add('f3d:p5', 'cxc', format('{"cliente_id": %s, "monto_cent": 750000, "fecha_ref": "%s"}', (select id from _c), negocio.hoy() - 15)::jsonb);
select pg_temp.add('f3d:p6', 'proveedor_a_favor', format('{"proveedor_id": %s, "monto_cent": 3050000}', catalogo.proveedor_id('Karen'))::jsonb);
select pg_temp.add('f3d:p7', 'proveedor_debemos', format('{"proveedor_id": %s, "monto_cent": 300000}', catalogo.proveedor_id('Isaac'))::jsonb);
select pg_temp.add('f3d:p8', 'inventario', format('{"sku_id": %s, "piezas": 10, "costo_unit_cent": 9000}', (select k.id from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id where m.nombre_canonico = 'F3D Nexa' limit 1))::jsonb);
select api.apertura_firmar('f3d:f1', (select id from _s));
select pg_temp.como('Javier');
select is((api.apertura_firmar('f3d:f2', (select id from _s)) ->> 'publicada')::boolean, true, 'los dos socios firman y se publica');
select pg_temp.flush();
select is(pg_temp.rojos(), 0::bigint, 'los auxiliares cuadran con la apertura publicada');

-- Quien debe a quien y las posiciones ven la apertura (A4) ------------------------------------------------------------------------------------------
select is(operacion.neto_socio((select id from catalogo.socio where nombre = 'Angelo')), 8461500::bigint, 'posicion de Angelo: lo aportado');
select is(operacion.neto_socio((select id from catalogo.socio where nombre = 'Javier')), 4700000::bigint, 'posicion de Javier: lo aportado menos lo que tiene de la sociedad en su cuenta');
select is((operacion.posicion_socios() ->> 'deudor'), 'Javier', 'quien debe: Javier');
select is((operacion.posicion_socios() ->> 'monto_cent')::bigint, 1880750::bigint, 'Javier le debe a Angelo 18,807.50');
select is((api.mov_utilidad() ->> 'deudor'), 'Javier', 'la pantalla de Movimientos dice lo mismo');
select is((api.mov_utilidad() ->> 'deuda_entre_socios_cent')::bigint, 1880750::bigint, 'con la misma cifra');
select is(operacion.aportacion_pendiente((select id from catalogo.socio where nombre = 'Angelo')), 8461500::bigint, 'el capital aportado en la apertura cuenta para la cascada');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Javier'), 'fondos'), 900000::bigint, 'los fondos en poder de Javier se ven');
select is((api.socio_cuenta('Javier') ->> 'neto_cent')::bigint, 4700000::bigint, 'el estado de cuenta del socio trae la posicion');
select is((select (m ->> 'concepto') from jsonb_array_elements(api.socio_cuenta('Javier') -> 'movimientos') m where m ->> 'tipo' = 'apertura'), 'Saldo de apertura al corte', 'y el renglon de apertura');
select is((select (m ->> 'saldo_cent')::bigint from jsonb_array_elements(api.socio_cuenta('Javier') -> 'movimientos') m order by (m ->> 'fecha_neg') desc, (m ->> 'id')::bigint limit 1), 4700000::bigint, 'el saldo corrido termina en la posicion');
select is((api.estado_socio('Javier') ->> 'fondos_cent')::bigint, 900000::bigint, 'el estado del socio muestra los fondos de apertura');

-- Proveedores ------------------------------------------------------------------------------------------------------------------------------------
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Karen')), 3050000::bigint, 'el saldo a favor con Karen es 30,500.00 (el anticipo se puede aplicar a una compra)');
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')), -300000::bigint, 'lo que se debe a Isaac es negativo');
select is((api.proveedor_cuenta('Karen') ->> 'saldo_cent')::bigint, 3050000::bigint, 'la cuenta con el proveedor lo muestra');
select is((select (m ->> 'saldo_corrido_cent')::bigint from jsonb_array_elements(api.proveedor_cuenta('Karen') -> 'movimientos') m where m ->> 'concepto' = 'apertura'), 3050000::bigint, 'con su renglon de apertura');
select is(pg_temp.rojos(), 0::bigint, 'sin controles en rojo');

-- Cuentas por cobrar de apertura: se cobran con un pago normal -----------------------------------------------------------------------------------
select is(operacion.saldo_cliente((select id from _c)), 1000000::bigint, 'el cliente debe 10,000.00 de apertura');
select is((select count(*)::int from operacion.cxc_apertura() where cliente_id = (select id from _c)), 2, 'dos partidas con su fecha');
select is((api.cuentas_por_cobrar() ->> 'total_cent')::bigint, 1000000::bigint, 'la pantalla de cuentas por cobrar suma la apertura');
select is(jsonb_array_length(api.cuentas_por_cobrar() -> 'apertura'), 2, 'y la lista por partida con fecha');
select is((api.cxc_cliente((select id from _c)) ->> 'saldo_cent')::bigint, 1000000::bigint, 'el cliente tambien');
create temp table _pg1 as select operacion.registrar_pago('f3d:pg1', 'Efectivo', 1100000, (select id from _c)) as r;
select is((select (r ->> 'aplicado_cent')::bigint from _pg1), 1000000::bigint, 'un cobro de 11,000.00 salda la apertura');
select is((select (r ->> 'saldo_favor_cliente_cent')::bigint from _pg1), 100000::bigint, 'y lo que sobra es saldo a favor');
select pg_temp.flush();
select is(operacion.saldo_cliente((select id from _c)), 0::bigint, 'el cliente queda en cero');
select is(contabilidad.saldo('1210'), 0::bigint, 'el libro tambien (1210)');
select is(contabilidad.saldo('2410'), 100000::bigint, 'y el saldo a favor (2410)');
select is(pg_temp.rojos(), 0::bigint, 'los auxiliares siguen cuadrando');
select is(operacion.anular_pago('f3d:an1', (select (r ->> 'pago_id')::bigint from _pg1), 'prueba')::text is not null, true, 'anular el pago');
select pg_temp.flush();
select is(operacion.saldo_cliente((select id from _c)), 1000000::bigint, 'la deuda de apertura vuelve');
select is(contabilidad.saldo('1210'), 1000000::bigint, 'y el libro');
select is(pg_temp.rojos(), 0::bigint, 'sin controles en rojo tras anular');
create temp table _pg2 as select operacion.registrar_pago('f3d:pg2', 'Efectivo', 300000, (select id from _c)) as r;
select pg_temp.flush();
select is((select sum(saldo_cent)::bigint from operacion.cxc_apertura()), 700000::bigint, 'cobro parcial de 3,000.00: quedan 7,000.00');
select is((select saldo_cent from operacion.cxc_apertura() where original_cent = 250000), 0::bigint, 'se salda primero la partida mas antigua');
select is((select saldo_cent from operacion.cxc_apertura() where original_cent = 750000), 700000::bigint, 'y la siguiente queda con 7,000.00');
select is(pg_temp.rojos(), 0::bigint, 'auxiliares sanos tras el cobro parcial');
create temp table _pg3 as select operacion.registrar_pago('f3d:pg3', 'Efectivo', 50000, (select id from _c), null, false) as r;
select is((api.pago_aplicar_apertura('f3d:ap1', (select (r ->> 'pago_id')::bigint from _pg3), null) ->> 'aplicado_cent')::bigint, 50000::bigint, 'un pago guardado como saldo a favor se aplica a la apertura a mano');
select pg_temp.flush();
select is(operacion.saldo_cliente((select id from _c)), 650000::bigint, 'quedan 6,500.00');
select is(pg_temp.rojos(), 0::bigint, 'sin controles en rojo');

-- Fondos en poder de un socio: se entregan -----------------------------------------------------------------------------------------------------------
select lives_ok($$ select operacion.registrar_entrega_socio('f3d:en1', 'Javier', 900000, 'sociedad', null, 'fondos') $$, 'Javier entrega los 9,000.00 de la apertura');
select pg_temp.flush();
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Javier'), 'fondos'), 0::bigint, 'ya no tiene fondos de la sociedad');
select is(contabilidad.saldo('1160'), 0::bigint, 'el libro tambien (1160)');
select is(pg_temp.rojos(), 0::bigint, 'sin controles en rojo');

-- El asiento de la apertura no se deshace por la reversa generica (A2) -----------------------------------------------------------------------------
select throws_ok($$ select api.conta_reversar_asiento('f3d:rv0', (select a.id from contabilidad.asiento a where a.es_apertura limit 1), 'intento por fuera') $$, 'P0428', null, 'la reversa generica rechaza el asiento de apertura');
select is(contabilidad.saldo('3110'), 8461500::bigint, 'y 3110 sigue intacto');

-- La reversa de la apertura no se hace si ya se cobro o ya salio mercancia (A3) ------------------------------------------------------------------------
select throws_ok($$ select api.apertura_reversar('f3d:v1', (select id from _s), 'intento con cobros aplicados') $$, 'P0441', null, 'no se revierte con cobros aplicados a la apertura');
select operacion.anular_pago('f3d:an2', (select (r ->> 'pago_id')::bigint from _pg2), 'prueba');
select operacion.anular_pago('f3d:an3', (select (r ->> 'pago_id')::bigint from _pg3), 'prueba');
select pg_temp.flush();
select is(operacion.saldo_cliente((select id from _c)), 1000000::bigint, 'anulados los cobros, la apertura vuelve a 10,000.00');
select operacion.registrar_movimiento('f3d:e2', 'F3D Nexa', 'Uno', 'bodega_omar', 'entrada_compra', 10, 110000, negocio.hoy(), 'compra posterior');
select operacion.registrar_movimiento('f3d:s2', 'F3D Nexa', 'Uno', 'bodega_omar', 'salida_pedido', -5, null, negocio.hoy());
select pg_temp.flush();
select throws_ok($$ select api.apertura_reversar('f3d:v2', (select id from _s), 'intento con mercancia vendida') $$, 'P0423', null, 'no se revierte si salio mercancia de un modelo de la apertura (el costo promedio quedaria falso)');
select is((select estado from apertura.sesion where id = (select id from _s)), 'firmada', 'la sesion sigue firmada');
select is(pg_temp.rojos(), 0::bigint, 'ningun control en rojo');
select is(contabilidad.verificar_cadena(), null::bigint, 'cadena sana');

select * from finish();
rollback;
