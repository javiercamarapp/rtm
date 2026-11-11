-- pgTAP 902 (QA de punta a punta, H-07): funciones del schema catalogo sin prueba directa:
-- normalizar, asegurar_sabor, agregar_destino, guardar_lista_sin_duenio, registrar_precio_historico_externo,
-- config_valor, costo_vigente y precio_vigente (frontera de vigencia: el flujo F01 de la matriz).
-- Cifras del flujo F01: precio 150.00 desde 1-mar, 160.00 desde 2-mar; margen vs Isaac 50.00 y 60.00.
-- ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N902".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n902.socio@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('94444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n902.socio@example.test');
select set_config('request.jwt.claim.sub', '94444444-4444-4444-4444-444444444444', true);

-- normalizar ---------------------------------------------------------------------------------------------------------------------
select is(catalogo.normalizar('  Peña   NIETO  '), 'pena nieto', 'normalizar: minusculas, sin acentos y espacios colapsados');
select is(catalogo.normalizar('Níño-Ñandú_50K!'), 'nino nandu 50k', 'normalizar: signos se vuelven espacio');
select is(catalogo.normalizar(null), '', 'normalizar: nulo = vacio');
select is(catalogo.normalizar('ÁÉÍÓÚ'), 'aeiou', 'normalizar: mayusculas acentuadas');
select is(catalogo.normalizar('Mr Cactus'), 'mr cactus', 'normalizar: "Mr Cactus" no se confunde con otro nombre');

-- asegurar_sabor -----------------------------------------------------------------------------------------------------------------
create temp table _s as select catalogo.asegurar_sabor('N902 Fresa Kiwi') as a, catalogo.asegurar_sabor('  n902 FRESA kiwi ') as b;
select is((select a = b from _s), true, 'asegurar_sabor: idempotente por nombre normalizado');
select is((select count(*)::int from catalogo.sabor where nombre_norm = 'n902 fresa kiwi'), 1, 'asegurar_sabor: una sola fila');

-- Catalogo base de la prueba -----------------------------------------------------------------------------------------------------
select catalogo.asegurar_cliente('N902 Cliente', 'Javier');
select catalogo.asegurar_modelo('N902 Marca', 'N902 Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('N902 Modelo 50K', 'Fresa');

-- agregar_destino ---------------------------------------------------------------------------------------------------------------
select lives_ok($$select catalogo.agregar_destino('N902 Cliente', 'Bodega norte', 'norte')$$, 'agregar_destino: crea');
select lives_ok($$select catalogo.agregar_destino('N902 Cliente', 'Bodega norte', 'norte')$$, 'agregar_destino: repetir no falla (on conflict do nothing)');
select is((select count(*)::int from catalogo.cliente_destino d join catalogo.cliente c on c.id = d.cliente_id where c.nombre_canonico = 'N902 Cliente'), 1, 'agregar_destino: sin duplicado');
select throws_ok($$select catalogo.agregar_destino('N902 Inexistente', 'x', 'y')$$, '22023', null, 'agregar_destino: cliente desconocido');

-- guardar_lista_sin_duenio -------------------------------------------------------------------------------------------------------
select lives_ok($$select catalogo.guardar_lista_sin_duenio('n902-ref', 'prueba', '[{"modelo":"x","precio_cent":1}]'::jsonb)$$, 'guardar_lista_sin_duenio: guarda');
select lives_ok($$select catalogo.guardar_lista_sin_duenio('n902-ref', 'prueba', '[{"modelo":"y","precio_cent":2}]'::jsonb)$$, 'guardar_lista_sin_duenio: misma referencia no se sobrescribe ni falla');
select is((select filas->0->>'modelo' from catalogo.lista_sin_duenio where referencia = 'n902-ref'), 'x', 'guardar_lista_sin_duenio: gana la primera');

-- Vigencias: costo (F01) -----------------------------------------------------------------------------------------------------------
select catalogo.fijar_costo('n902c1', 'Isaac', 'N902 Modelo 50K', 10000, '2027-03-01', 'prueba');
select catalogo.fijar_costo('n902c2', 'Isaac', 'N902 Modelo 50K', 10500, '2027-03-10', 'prueba');
select is(catalogo.costo_vigente(catalogo.proveedor_id('Isaac'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-09'), 10000::bigint, 'costo_vigente: el dia anterior al cambio rige el viejo');
select is(catalogo.costo_vigente(catalogo.proveedor_id('Isaac'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-10'), 10500::bigint, 'costo_vigente: el dia del cambio rige el nuevo (frontera de vigente_hasta)');
select is(catalogo.costo_vigente(catalogo.proveedor_id('Isaac'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-02-28'), null, 'costo_vigente: antes de existir costo no hay dato (no se inventa cero)');
select throws_ok($$select catalogo.fijar_costo('n902c3', 'Isaac', 'N902 Modelo 50K', 11000, '2027-03-05', 'prueba')$$, 'P0422', null, 'fijar_costo: vigencia retroactiva se rechaza');
select is((catalogo.fijar_costo('n902c4', 'Isaac', 'N902 Modelo 50K', 10500, '2027-03-20', 'prueba')->>'sin_cambio')::boolean, true, 'fijar_costo: mismo costo = sin cambio, no abre vigencia nueva');
select is((select count(*)::int from catalogo.costo_proveedor where proveedor_id = catalogo.proveedor_id('Isaac') and modelo_id = (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K') and vigente_hasta is null), 1, 'fijar_costo: una sola vigencia abierta');

-- Vigencias: precio (F01: 150.00 desde 1-mar, 160.00 desde 2-mar) -------------------------------------------------------------------
select catalogo.fijar_precio('n902p1', 'N902 Cliente', 'N902 Modelo 50K', 15000, '2027-03-01', 'chat');
select catalogo.fijar_precio('n902p2', 'N902 Cliente', 'N902 Modelo 50K', 16000, '2027-03-02', 'chat');
select is(catalogo.precio_vigente((select id from catalogo.cliente where nombre_canonico = 'N902 Cliente'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-01'), 15000::bigint, 'precio_vigente: el pedido del 1-mar toma 150.00');
select is(catalogo.precio_vigente((select id from catalogo.cliente where nombre_canonico = 'N902 Cliente'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-02'), 16000::bigint, 'precio_vigente: el del 2-mar toma 160.00');
select is(catalogo.precio_vigente((select id from catalogo.cliente where nombre_canonico = 'N902 Cliente'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-02-28'), null, 'precio_vigente: sin precio anterior = sin dato');
select is(catalogo.precio_vigente((select id from catalogo.cliente where nombre_canonico = 'N902 Cliente'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-02') - catalogo.costo_vigente(catalogo.proveedor_id('Isaac'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-02'), 6000::bigint, 'margen por pieza vs Isaac el 2-mar: 160.00 - 100.00 = 60.00');
select is((select count(*)::int from catalogo.tabulador_precio t join catalogo.cliente c on c.id = t.cliente_id where c.nombre_canonico = 'N902 Cliente'), 2, 'el historial de precio tiene 2 filas y una vigente');
select is((select count(*)::int from catalogo.tabulador_precio t join catalogo.cliente c on c.id = t.cliente_id where c.nombre_canonico = 'N902 Cliente' and t.vigente_hasta is null), 1, 'una sola vigente');
select is((catalogo.fijar_precio('n902p1', 'N902 Cliente', 'N902 Modelo 50K', 15000, '2027-03-01', 'chat') is not null), true, 'fijar_precio: la misma clave devuelve lo guardado');
select throws_ok($$select catalogo.fijar_precio('n902p1', 'N902 Cliente', 'N902 Modelo 50K', 15001, '2027-03-01', 'chat')$$, 'P0409', null, 'fijar_precio: misma clave con otro monto = 409');

-- registrar_precio_historico_externo -----------------------------------------------------------------------------------------------
select lives_ok($$select catalogo.registrar_precio_historico_externo('n902h1', 'N902 Cliente', 'N902 Modelo 50K', 14000, 'hoja_vieja')$$, 'precio historico externo: se registra');
select is((select count(*)::int from catalogo.precio_historico_externo h join catalogo.cliente c on c.id = h.cliente_id where c.nombre_canonico = 'N902 Cliente'), 1, 'precio historico externo: una fila');
select is(catalogo.precio_vigente((select id from catalogo.cliente where nombre_canonico = 'N902 Cliente'), (select id from catalogo.modelo where nombre_canonico = 'N902 Modelo 50K'), '2027-03-02'), 16000::bigint, 'el historico externo no altera el precio vigente');

-- config_valor ------------------------------------------------------------------------------------------------------------------
select is((catalogo.config_valor('renta_por_pieza_cent'))::text, '200', 'config: renta por pieza 2.00');
select is((catalogo.config_valor('minimo_piezas_pedido'))::text, '20', 'config: minimo 20 piezas');
select is((catalogo.config_valor('recargo_credito_bp'))::text, '1000', 'config: recargo por credito 10 % (1000 pb)');
select is(catalogo.config_valor('clave_que_no_existe'), null, 'config: clave desconocida = nulo, no error');

select * from finish();
rollback;
