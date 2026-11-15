-- pgTAP: stock DISPONIBLE de Isaac (catalogo Remate). Datos sinteticos. Sin importes; solo socios; idempotente.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('isaac.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('99999999-9999-9999-9999-999999999993', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isaac.javier@example.test');

set local session_replication_role = replica;
insert into catalogo.marca (id, nombre) overriding system value values (881001, 'Marca Isaac');
insert into catalogo.modelo (id, marca_id, nombre_canonico, puffs, lista_origen) overriding system value values (881001, 881001, 'Modelo Isaac 3300', 3300, 'ambas'), (881002, 881001, 'Modelo Isaac Sin Sabor', 4500, 'ambas');
insert into catalogo.sabor (id, nombre_canonico) overriding system value values (881001, 'Uva Isaac'), (881002, 'Mango Isaac'), (881003, 'Menta Isaac');
set local session_replication_role = origin;

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999993', true);

select is((proveedores.guardar_stock_isaac('[{"modelo_id":881001,"sabores":[881001,881002]},{"modelo_id":881002,"sabores":[]}]'::jsonb, 'prueba') ->> 'modelos')::int, 2, 'guarda dos modelos');
select is((select count(*)::int from proveedores.stock_isaac_sabor where disponible), 2, 'dos sabores disponibles');
select is((proveedores.guardar_stock_isaac('[{"modelo_id":881001,"sabores":[881001,881002]},{"modelo_id":881002,"sabores":[]}]'::jsonb, 'prueba') ->> 'modelos')::int, 2, 'idempotente: repetir no duplica');
select is((select count(*)::int from proveedores.stock_isaac_sabor), 2, 'sigue habiendo dos sabores');
select is((select count(*)::int from proveedores.stock_isaac_modelo), 2, 'sigue habiendo dos modelos');

-- Un sabor que ya no viene queda agotado (no se borra).
select proveedores.guardar_stock_isaac('[{"modelo_id":881001,"sabores":[881001]}]'::jsonb, 'prueba');
select is((select disponible from proveedores.stock_isaac_sabor where modelo_id = 881001 and sabor_id = 881002), false, 'el sabor que no viene queda agotado');
select is((select disponible from proveedores.stock_isaac_sabor where modelo_id = 881001 and sabor_id = 881001), true, 'el que viene sigue disponible');

-- Tablero: mismo formato que el de Karen.
select is(jsonb_array_length(proveedores.tablero_isaac() -> 'modelos'), 2, 'el tablero lista los dos modelos');
select is((select m ->> 'producto_id' from jsonb_array_elements(proveedores.tablero_isaac() -> 'modelos') m where m ->> 'titulo' = 'Modelo Isaac 3300'), 'isaac-881001', 'producto_id con prefijo isaac');
select is((select jsonb_array_length(m -> 'sabores') from jsonb_array_elements(proveedores.tablero_isaac() -> 'modelos') m where m ->> 'titulo' = 'Modelo Isaac 3300'), 2, 'trae disponibles y agotados');
select is((select (m ->> 'sin_sabores')::boolean from jsonb_array_elements(proveedores.tablero_isaac() -> 'modelos') m where m ->> 'titulo' = 'Modelo Isaac Sin Sabor'), true, 'el modelo sin sabor se registra sin sabor');
select is((select (m ->> 'existencia_propia')::int from jsonb_array_elements(proveedores.tablero_isaac() -> 'modelos') m where m ->> 'titulo' = 'Modelo Isaac 3300'), 0, 'lo que falta en nuestro registro esta en 0');

-- Sin importes.
select throws_ok($$select proveedores.guardar_stock_isaac('[{"modelo_id":881001,"sabores":[],"precio":10}]'::jsonb, 'x')$$, 'P0461', null, 'no admite importes');
select is((select count(*)::int from information_schema.columns where table_schema = 'proveedores' and table_name like 'stock_isaac%' and (column_name ~ 'precio|costo|monto|importe|_cent')), 0, 'las tablas no tienen columnas de dinero');

-- Solo socios: sin sesion de socio la API falla.
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select api.prov_tablero_isaac()$$, null, null, 'sin sesion no hay tablero');

select * from finish();
rollback;
