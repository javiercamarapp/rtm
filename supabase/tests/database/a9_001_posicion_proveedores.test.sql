-- pgTAP a9_001: UNA sola verdad por proveedor. La posicion con el proveedor (api.proveedor_cuenta.posicion*) es la del Mayor (2110 / 2120) y la hoja semanal
-- parte de la posicion al inicio de la semana y termina en el mismo saldo del libro al corte. Datos SINTETICOS con cifras hechas a mano (centavos).
-- Karen (dropshipping a credito): costo 122,000 antes de la semana + 104,000 en la semana = 226,000; abonos 153,000 antes + 19,000 en la semana = 172,000 => se le debe 54,000;
--   saldo anterior de la semana: a favor 31,000 (153,000 - 122,000); 104,000 - 19,000 - 31,000 = 54,000.
-- Isaac: ordenes confirmadas sin recibir 500,000 y recibidas 200,000 (antes), pedido directo enviado 150,000 y pago de socio 300,000 (en la semana) => se le debe 550,000.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('pq.jav@example.test', 'socio', 'Javier', true), ('pq.ang@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('99999999-9999-9999-9999-9999999999a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pq.jav@example.test'),
  ('99999999-9999-9999-9999-9999999999a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pq.ang@example.test');
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-9999999999a2', true);
select set_config('rtm.llave_destinatario', encode(extensions.gen_random_bytes(32), 'base64'), true);

create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar($1) $$;
create function pg_temp.dia(p date) returns void language sql as $$ select set_config('rtm.fecha_negocio', $1::text, true) $$;
-- Lunes de la semana de hoy (nunca futuro) y un dia antes de que empiece la hoja anterior.
create temp table _f as select operacion.semana_omar_ini(negocio.hoy()) as sem, operacion.semana_omar_ini(negocio.hoy()) - 10 as ant;

select catalogo.asegurar_modelo('PQ Marca', 'PQ Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('PQ Modelo', 'Uva');
select catalogo.fijar_costo('pq-c1', 'Karen', 'PQ Modelo', 1000, negocio.hoy() - 90, 'prueba');
select catalogo.fijar_costo('pq-c2', 'Isaac', 'PQ Modelo', 5000, negocio.hoy() - 90, 'prueba');
select catalogo.asegurar_cliente('PQ Cliente', 'Javier');
select catalogo.fijar_precio('pq-p1', 'PQ Cliente', 'PQ Modelo', 2000, negocio.hoy() - 90, 'documento');

select is((api.proveedor_cuenta('Karen')->>'posicion_cent')::bigint, 0::bigint, 'sin movimientos: posicion cero');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'cargos_cent')::bigint, 0::bigint, 'sin movimientos: sin cargos');

-- ---------------------------------------------------------------------------
-- Karen
-- ---------------------------------------------------------------------------
select pg_temp.dia((select ant from _f));
select operacion.ds_crear_pedido('pq-k1', pg_temp.cli('PQ Cliente'), '[{"modelo":"PQ Modelo","sabor":"Uva","piezas":122}]'::jsonb, 'karen_directo', null, null, 'cliente', null, 'K-1', 0, 0, (select ant from _f));
select operacion.confirmar_pedido('pq-k1-c', pg_temp.ped('pq-k1:ped'));
select operacion.enviar_pedido('pq-k1-e', pg_temp.ped('pq-k1:ped'), null, null, null, true);
select operacion.ds_pagar_proveedor('pq-k1-p', 'Karen', 153000, 'socio_propio', 'Javier', null, null, (select ant from _f));
select pg_temp.dia((select sem from _f));
select operacion.ds_crear_pedido('pq-k2', pg_temp.cli('PQ Cliente'), '[{"modelo":"PQ Modelo","sabor":"Uva","piezas":104}]'::jsonb, 'karen_directo', null, null, 'cliente', null, 'K-2', 0, 0, (select sem from _f));
select operacion.confirmar_pedido('pq-k2-c', pg_temp.ped('pq-k2:ped'));
select operacion.enviar_pedido('pq-k2-e', pg_temp.ped('pq-k2:ped'), null, null, null, true);
select operacion.ds_pagar_proveedor('pq-k2-p', 'Karen', 19000, 'socio_propio', 'Javier', null, null, (select sem from _f));
set constraints all immediate;

select is((api.proveedor_cuenta('Karen')->>'saldo_cent')::bigint, 172000::bigint, 'Karen: la cuenta corriente solo suma los abonos (153,000 + 19,000)');
select is((api.proveedor_cuenta('Karen')->>'posicion_cent')::bigint, -54000::bigint, 'Karen: posicion completa = abonos 172,000 - costo 226,000 = se le debe 54,000');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'cargos_cent')::bigint, 226000::bigint, 'Karen: costo de pedidos 226,000');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'abonos_cent')::bigint, 172000::bigint, 'Karen: pagos y abonos 172,000');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'se_debe_cent')::bigint, 54000::bigint, 'Karen: se debe 54,000');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'a_favor_cent')::bigint, 0::bigint, 'Karen: nada a favor (no es un prepago a favor)');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'cuadra_auxiliar')::boolean, true, 'Karen: libro y auxiliar dicen lo mismo');
select is((api.proveedor_cuenta('Karen')->>'posicion_cent')::bigint, -contabilidad.saldo('2120'), 'Karen: es el saldo del Mayor 2120');
select is(contabilidad.saldo('2120'), 54000::bigint, 'Karen: el Mayor 2120 (acreedora) dice 54,000');

select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'saldo_anterior_cent')::bigint, -31000::bigint, 'hoja Karen: saldo anterior = posicion al inicio de la semana, a favor 31,000');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'costo_total_cent')::bigint, 104000::bigint, 'hoja Karen: costo de la semana 104,000');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'pagos_cent')::bigint, 19000::bigint, 'hoja Karen: pagos de la semana 19,000');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'falta_por_saldar_cent')::bigint, 54000::bigint, 'hoja Karen: -31,000 + 104,000 - 19,000 = 54,000');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'libro_al_corte_cent')::bigint, 54000::bigint, 'hoja Karen: el libro al corte dice lo mismo');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'diferencia_libro_cent')::bigint, 0::bigint, 'hoja Karen: diferencia contra el libro 0');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'comprobaciones'->>'libro_igual_hoja')::boolean, true, 'hoja Karen: cuadra con el libro');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'comprobaciones'->>'cuadra')::boolean, true, 'hoja Karen: comprobaciones internas siguen cuadrando');
-- La hoja de la semana anterior parte del saldo cero (nada antes) y termina en la posicion al cierre de esa semana (a favor 31,000).
select is((api.proveedor_hoja('Karen', (select ant from _f))->'totales'->>'saldo_anterior_cent')::bigint, 0::bigint, 'hoja anterior: saldo anterior cero');
select is((api.proveedor_hoja('Karen', (select ant from _f))->'totales'->>'falta_por_saldar_cent')::bigint, -31000::bigint, 'hoja anterior: 122,000 de costo - 153,000 de abonos = a favor 31,000');
select is((api.proveedor_hoja('Karen', (select ant from _f))->'totales'->>'diferencia_libro_cent')::bigint, 0::bigint, 'hoja anterior: tambien cuadra con el libro');

select is(api.explicar_cifra('proveedor:posicion:Karen')->>'valor', '-54000', 'explicar: posicion de Karen');
select is((api.explicar_cifra('proveedor:posicion:Karen')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: libro y auxiliar cuadran');
select is((api.explicar_cifra('proveedor:posicion:Karen')->'comprobacion'->>'via2_valor')::bigint, -54000::bigint, 'explicar: el auxiliar tambien dice -54,000');
select throws_ok($$select api.explicar_cifra('proveedor:posicion:Otro')$$, null, null, 'explicar: un proveedor desconocido no se explica');

-- ---------------------------------------------------------------------------
-- Isaac: ordenes sin recibir, ordenes recibidas y pedido directo
-- ---------------------------------------------------------------------------
select pg_temp.dia((select ant from _f));
select operacion.crear_compra('pq-i1', 'Isaac', '[{"modelo":"PQ Modelo","sabor":"Uva","pagadas":100}]'::jsonb, 0, 0, (select ant + 20 from _f));
select operacion.confirmar_compra('pq-i1-c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'pq-i1'));
select operacion.crear_compra('pq-i2', 'Isaac', '[{"modelo":"PQ Modelo","sabor":"Uva","pagadas":40}]'::jsonb, 0, 0, (select ant + 20 from _f));
select operacion.confirmar_compra('pq-i2-c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'pq-i2'));
select operacion.recibir_compra('pq-i2-r', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'pq-i2'),
  jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.compra_linea where compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'pq-i2')), 'sabor', 'Uva', 'piezas', 40)), ((select ant from _f)::text || ' 12:00-06')::timestamptz);
select pg_temp.dia((select sem from _f));
select operacion.crear_pedido('pq-i3', pg_temp.cli('PQ Cliente'), '[{"modelo":"PQ Modelo","sabor":"Uva","piezas":30,"precio_cent":9000}]'::jsonb, 'isaac_directo', null, 0, 0, 0, (select sem from _f));
select operacion.confirmar_pedido('pq-i3-c', (select id from operacion.pedido order by id desc limit 1));
select operacion.enviar_pedido('pq-i3-e', (select id from operacion.pedido order by id desc limit 1), null, null, null, true);
select operacion.pago_proveedor_de_socio('pq-i4', 'Isaac', 300000, 'Javier', 'dinero_propio', (select sem from _f));
set constraints all immediate;
select contabilidad.asentar_pendientes();

select is((api.proveedor_cuenta('Isaac')->>'saldo_cent')::bigint, -400000::bigint, 'Isaac: la cuenta corriente (ordenes - pagos) dice -400,000 y no incluye el pedido directo');
select is((api.proveedor_cuenta('Isaac')->>'posicion_cent')::bigint, -550000::bigint, 'Isaac: posicion = -(500,000 + 200,000 + 150,000 - 300,000) = se le debe 550,000');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'cargos_cent')::bigint, 850000::bigint, 'Isaac: costo de ordenes y pedidos 850,000');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'abonos_cent')::bigint, 300000::bigint, 'Isaac: pagos 300,000');
select is((api.proveedor_cuenta('Isaac')->>'posicion_cent')::bigint, -contabilidad.saldo('2110'), 'Isaac: es el saldo del Mayor 2110');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'cuadra_auxiliar')::boolean, true, 'Isaac: libro y auxiliar dicen lo mismo');
select is((api.pulso()->>'por_pagar_isaac_cent')::bigint, 550000::bigint, 'Inicio: Por pagar a Isaac = la misma posicion');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'totales'->>'saldo_anterior_cent')::bigint, 700000::bigint, 'hoja Isaac: saldo anterior = ordenes confirmadas antes de la semana (sin recibir y recibidas)');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'totales'->>'falta_por_saldar_cent')::bigint, 550000::bigint, 'hoja Isaac: 700,000 + 150,000 - 300,000 = 550,000');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'totales'->>'diferencia_libro_cent')::bigint, 0::bigint, 'hoja Isaac: cuadra con el libro');
select is(api.explicar_cifra('proveedor:posicion:Isaac')->>'valor', '-550000', 'explicar: posicion de Isaac');

-- Un asiento manual en la cuenta del proveedor que la hoja no clasifica: la hoja lo dice con su diferencia (no lo esconde) y la posicion lo incluye.
select pg_temp.dia((select sem from _f));
select contabilidad.registrar_asiento_manual('pq-m1', (select sem from _f), 'prueba: cargo manual a Karen que la hoja no clasifica', '[{"cuenta":"1101","debe_cent":2500},{"cuenta":"2120","haber_cent":2500}]'::jsonb);
set constraints all immediate;
select is((api.proveedor_cuenta('Karen')->>'posicion_cent')::bigint, -56500::bigint, 'la posicion incluye el asiento manual: se le debe 56,500');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'falta_por_saldar_cent')::bigint, 54000::bigint, 'la hoja no lo clasifica: sigue en 54,000');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'totales'->>'diferencia_libro_cent')::bigint, 2500::bigint, 'y dice la diferencia contra el libro: 2,500');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'comprobaciones'->>'libro_igual_hoja')::boolean, false, 'la hoja ya no se declara cuadrada con el libro');
select is((api.proveedor_hoja('Karen', (select sem from _f))->'comprobaciones'->>'cuadra')::boolean, true, 'las comprobaciones internas de la hoja no cambian');

-- ---------------------------------------------------------------------------
-- Pedidos a costo del socio de menudeo (Angelo): el libro los suma al proveedor, pero lo pendiente NO es deuda de la empresa.
-- Isaac: Angelo pide 10 pzas a 50.00 = 500.00 (pendiente de pago). Karen: Angelo pide 20 pzas a 10.00 = 200.00 y lo paga (queda en cero).
-- ---------------------------------------------------------------------------
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '99999999-9999-9999-9999-9999999999a1' else '99999999-9999-9999-9999-9999999999a2' end, true) $$;
select pg_temp.como('Angelo');
select catalogo.asegurar_cliente('PQ Stock Angelo', 'Angelo');
select pg_temp.dia((select sem from _f));
select operacion.ds_crear_pedido('pq-a1', pg_temp.cli('PQ Stock Angelo'), '[{"modelo":"PQ Modelo","sabor":"Uva","piezas":10}]'::jsonb, 'isaac_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, (select sem from _f));
select operacion.confirmar_pedido('pq-a1-c', pg_temp.ped('pq-a1:ped'));
select operacion.enviar_pedido('pq-a1-e', pg_temp.ped('pq-a1:ped'), null, null, null, true);
select operacion.ds_crear_pedido('pq-a2', pg_temp.cli('PQ Stock Angelo'), '[{"modelo":"PQ Modelo","sabor":"Uva","piezas":20}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, (select sem from _f));
select operacion.confirmar_pedido('pq-a2-c', pg_temp.ped('pq-a2:ped'));
select operacion.enviar_pedido('pq-a2-e', pg_temp.ped('pq-a2:ped'), null, null, null, true);
select operacion.ds_pagar_pedido_menudeo('pq-a2-p', pg_temp.ped('pq-a2:ped'), 'proveedor');
select pg_temp.como('Javier');
set constraints all immediate;
select contabilidad.asentar_pendientes();

select is((api.proveedor_cuenta('Isaac')->>'posicion_cent')::bigint, -600000::bigint, 'Isaac: el libro suma el pedido de Angelo: total con el proveedor 6,000.00');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'menudeo_pendiente_cent')::bigint, 50000::bigint, 'Isaac: pedido de Angelo pendiente de pago 500.00');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'deuda_empresa_cent')::bigint, 550000::bigint, 'Isaac: deuda de la empresa 5,500.00 (sin el pedido de Angelo)');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'deuda_empresa_cent')::bigint + (api.proveedor_cuenta('Isaac')->'posicion'->>'menudeo_pendiente_cent')::bigint, (api.proveedor_cuenta('Isaac')->'posicion'->>'se_debe_cent')::bigint, 'Isaac: deuda de la empresa + pedidos de Angelo pendientes = total del libro');
select is((api.proveedor_cuenta('Isaac')->'posicion'->>'cuadra_auxiliar')::boolean, true, 'Isaac: libro y auxiliar siguen cuadrando con el pedido de Angelo');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'menudeo_pendiente_cent')::bigint, 0::bigint, 'Karen: el pedido de Angelo ya esta pagado, nada pendiente');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'menudeo_costo_cent')::bigint, 20000::bigint, 'Karen: costo del pedido de Angelo 200.00');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'menudeo_pagado_cent')::bigint, 20000::bigint, 'Karen: pagado 200.00');
select is((api.proveedor_cuenta('Karen')->>'posicion_cent')::bigint, -56500::bigint, 'Karen: el total del libro no cambia por un pedido de Angelo ya pagado');
select is((api.proveedor_cuenta('Karen')->'posicion'->>'deuda_empresa_cent')::bigint, 56500::bigint, 'Karen: deuda de la empresa = total del libro');
select is((api.pulso()->>'por_pagar_isaac_cent')::bigint, 550000::bigint, 'Inicio: Por pagar a Isaac es la deuda de la empresa');
select is((api.pulso()->>'por_pagar_isaac_socio_cent')::bigint, 50000::bigint, 'Inicio: aparte, el pedido de Angelo pendiente');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'totales'->>'falta_por_saldar_cent')::bigint, 600000::bigint, 'hoja Isaac: falta por saldar = total del libro 6,000.00');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'totales'->>'menudeo_pendiente_cent')::bigint, 50000::bigint, 'hoja Isaac: pedido de Angelo pendiente 500.00');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'totales'->>'deuda_empresa_cent')::bigint, 550000::bigint, 'hoja Isaac: deuda de la empresa 5,500.00');
select is((api.proveedor_hoja('Isaac', (select sem from _f))->'comprobaciones'->>'libro_igual_hoja')::boolean, true, 'hoja Isaac: sigue cuadrando con el libro');
select is(api.explicar_cifra('proveedor:deuda:Isaac')->>'valor', '-550000', 'explicar: deuda de la empresa con Isaac');
select is((api.explicar_cifra('proveedor:deuda:Isaac')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: la deuda de la empresa cuadra por dos vias');
select is(api.explicar_cifra('proveedor:posicion:Isaac')->>'valor', '-600000', 'explicar: el total con el proveedor sigue siendo el del libro');
select is(jsonb_array_length(api.ds_menudeo('Angelo', null, null, 'Isaac')->'filas'), 1, 'el desglose por pedido de Angelo con Isaac trae su pedido');
select is((api.ds_menudeo('Angelo', null, null, 'Isaac')->'totales'->>'pendiente_cent')::bigint, 50000::bigint, 'y su pendiente coincide con la posicion');
select * from finish();
rollback;
