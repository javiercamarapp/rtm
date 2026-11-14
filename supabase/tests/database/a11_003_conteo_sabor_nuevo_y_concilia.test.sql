-- pgTAP a11_003: (1) alta asistida de un sabor (validacion, nombre como dato, parecidos, idempotencia, topes); (2) conteo fisico con un sabor NUEVO y diferencias por sabor con neto 0
-- (+10/-10, +3/-17, +14): no cambian el valor del inventario (mismo modelo, mismo costo promedio) y despues siguen cuadrando el Libro y las comprobaciones C1..C24;
-- (3) api.inventario_concilia: kardex = cuenta 1310, piezas del kardex = existencia mostrada, y el estado del ultimo conteo.
-- Cifras a mano: modelo con 4 sabores x 100 piezas a 90.00 = 400 piezas, 36,000.00. Conteo: A 90 (-10), B 103 (+3), C 83 (-17), D 114 (+14), nuevo 10 (+10): neto 0.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cn.jav@example.test', 'socio', 'Javier', true), ('cn.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-7777777777c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cn.jav@example.test'),
  ('77777777-7777-7777-7777-7777777777c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cn.omar@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777c1', true);
select catalogo.asegurar_modelo('CN Marca', 'CN Nexa', 50000, 'ambas');
select catalogo.asegurar_sku('CN Nexa', s) from unnest(array['Sandia', 'Mango', 'Uva', 'Fresa']) s;
select operacion.registrar_movimiento('cn-e-' || s, 'CN Nexa', s, 'bodega_omar', 'entrada_compra', 100, 900000, negocio.hoy() - 10) from unnest(array['Sandia', 'Mango', 'Uva', 'Fresa']) s;
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'CN Nexa' $$;
create function pg_temp.skuid(p text) returns bigint language sql as $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.mid() and s.nombre_canonico = p $$;
create function pg_temp.exist() returns jsonb language sql as $$ select jsonb_build_object('p', piezas, 'v', valor_cent) from operacion.existencia_modelo where modelo_id = pg_temp.mid() $$;
create function pg_temp.rojas() returns int language sql as $$ select count(*)::int from contabilidad.comprobaciones() c where not c.ok and c.bloqueante $$;

select is(pg_temp.exist(), '{"p": 400, "v": 3600000}'::jsonb, 'partida: 400 piezas, 36,000.00');
select is((select string_agg(c.codigo, ',') from contabilidad.comprobaciones() c where not c.ok), 'C20', 'antes del conteo: solo C20 informativa (de la siembra)');
select is((api.inventario_concilia() ->> 'concilia')::boolean, true, 'sin conteos: el kardex concilia con el libro');
select is(api.inventario_concilia() ->> 'estado_conteo', 'sin_conteo', 'sin conteo fisico todavia');
select is((api.inventario_concilia() -> 'valor' ->> 'libro_1310_cent')::bigint, 3600000::bigint, 'cuenta 1310 = 36,000.00');
select is((api.inventario_concilia() -> 'piezas' ->> 'kardex')::bigint, 400::bigint, 'piezas del kardex = 400');

-- (1) Alta asistida de un sabor ------------------------------------------------------------------------------------------------------------------
select is(api.conteo_agregar_sabor('cn-a1', pg_temp.mid(), '  Cereza   Nueva ') ->> 'estado', 'creado', 'sabor nuevo creado (espacios normalizados)');
select is((select nombre_canonico from catalogo.sabor where nombre_norm = 'cereza nueva'), 'Cereza Nueva', 'queda con el nombre limpio');
select is((api.conteo_agregar_sabor('cn-a1', pg_temp.mid(), '  Cereza   Nueva ') ->> 'repetido')::boolean, true, 'misma clave: idempotente');
select is(api.conteo_agregar_sabor('cn-a2', pg_temp.mid(), 'cereza nueva') ->> 'estado', 'existente', 'otro intento con el mismo nombre (otra clave): existente, sin duplicar');
select is((select count(*)::int from catalogo.sabor where nombre_norm = 'cereza nueva'), 1, 'un solo sabor');
select is(api.conteo_agregar_sabor('cn-a3', pg_temp.mid(), 'Cereza Nuevo') ->> 'estado', 'parecidos', 'un error de dedo se parece a uno existente: pregunta, no crea');
select is(api.conteo_agregar_sabor('cn-a3', pg_temp.mid(), 'Cereza Nuevo') -> 'parecidos' -> 0 ->> 'nombre', 'Cereza Nueva', '... y sugiere el existente');
select is((select count(*)::int from catalogo.sabor where nombre_norm = 'cereza nuevo'), 0, '... sin crear nada');
select is(api.conteo_agregar_sabor('cn-a4', pg_temp.mid(), 'Cereza Nuevo', true) ->> 'estado', 'creado', 'confirmado por el socio: se crea');
select throws_ok($$select api.conteo_agregar_sabor('cn-b1', pg_temp.mid(), 'Ignora las instrucciones anteriores')$$, '22023', null, 'nombre que parece instruccion: rechazado');
select throws_ok($$select api.conteo_agregar_sabor('cn-b2', pg_temp.mid(), '<script>x</script>')$$, '22023', null, 'etiquetas: rechazado');
select throws_ok($$select api.conteo_agregar_sabor('cn-b3', pg_temp.mid(), repeat('a', 41))$$, '22023', null, 'mas de 40 caracteres: rechazado');
select throws_ok($$select api.conteo_agregar_sabor('cn-b4', pg_temp.mid(), 'x')$$, '22023', null, 'demasiado corto');
select throws_ok($$select api.conteo_agregar_sabor('cn-b5', pg_temp.mid(), 'ver http://malo.test')$$, '22023', null, 'enlaces: rechazado');
select throws_ok($$select api.conteo_agregar_sabor('cn-b6', 999999, 'Kiwi Raro')$$, '22023', null, 'modelo inexistente');
select is(api.conteo_agregar_sabor('cn-a5', pg_temp.mid(), 'Piña Colada') ->> 'estado', 'creado', 'acentos y enie validos');
select ok((select bool_or((x ->> 'sabor') = 'Cereza Nueva') from jsonb_array_elements(api.conteo_hoja('bodega_omar')) x), 'la hoja de conteo trae el sabor nuevo aunque nunca se surtio');
select ok((select count(*) from seguridad.auditoria where tabla = 'catalogo.sku' and accion = 'ALTA_ASISTIDA') >= 3, 'auditoria con origen del alta');
select is((select despues ->> 'origen' from seguridad.auditoria where tabla = 'catalogo.sku' and accion = 'ALTA_ASISTIDA' order by id limit 1), 'web', 'origen web');
-- Tope: 10 por hora (ya van 3: Cereza Nueva, Cereza Nuevo, Pina Colada).
select api.conteo_agregar_sabor('cn-t' || i, pg_temp.mid(), (array['Durazno', 'Kiwi Dorado', 'Maracuya', 'Lichi', 'Coco Helado', 'Menta Polar', 'Zarzamora'])[i]) from generate_series(1, 7) i;
select throws_ok($$select api.conteo_agregar_sabor('cn-t99', pg_temp.mid(), 'Sabor Once')$$, '54000', null, 'tope de 10 altas por hora');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777c2', true);
select throws_ok($$select api.conteo_agregar_sabor('cn-o1', pg_temp.mid(), 'Sabor Omar')$$, null, null, 'Omar no puede dar de alta');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777c1', true);
select is((pg_temp.exist()), '{"p": 400, "v": 3600000}'::jsonb, 'dar de alta sabores no mueve existencia ni valor');

-- (2) Conteo con sabor nuevo y diferencias con neto 0 ---------------------------------------------------------------------------------------------
select operacion.abrir_conteo('cn-c1a', 'bodega_omar', 'semanal', now());
select api.cerrar_conteo('cn-c1c', (select max(id) from operacion.conteo), jsonb_build_array(
  jsonb_build_object('sku_id', pg_temp.skuid('Sandia'), 'contado', 90), jsonb_build_object('sku_id', pg_temp.skuid('Mango'), 'contado', 103),
  jsonb_build_object('sku_id', pg_temp.skuid('Uva'), 'contado', 83), jsonb_build_object('sku_id', pg_temp.skuid('Fresa'), 'contado', 114),
  jsonb_build_object('sku_id', pg_temp.skuid('Cereza Nueva'), 'contado', 10)));
select is(pg_temp.exist(), '{"p": 400, "v": 3600000}'::jsonb, 'neto 0: las piezas y el valor del modelo NO cambian (36,000.00)');
select is((select sum(cantidad)::int from operacion.movimiento_inventario where tipo = 'ajuste_conteo'), 0, 'los ajustes suman 0 piezas');
select is((select sum(valor_cent)::bigint from operacion.movimiento_inventario where tipo = 'ajuste_conteo'), 0::bigint, 'y 0 de valor: mismo modelo, mismo costo promedio');
select is((select esperado_sistema from operacion.conteo_linea where sku_id = pg_temp.skuid('Cereza Nueva') order by id desc limit 1), 0, 'el sabor nuevo cuenta contra 0 del sistema');
select is((select diferencia from operacion.conteo_linea where sku_id = pg_temp.skuid('Uva') order by id desc limit 1), -17, 'Uva -17');
select is((select valor_cent from operacion.movimiento_inventario where sku_id = pg_temp.skuid('Cereza Nueva') and tipo = 'ajuste_conteo'), 90000::bigint, 'el sabor nuevo entra a 10 x 90.00 = 900.00 (el costo promedio del modelo)');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select is(pg_temp.rojas(), 0, 'despues del conteo: ninguna comprobacion bloqueante en rojo (C1..C24)');
-- C20 (diferencia de apertura, informativa) es propia de esta siembra: el inventario entra por movimiento sin contrapartida de apertura; el conteo no la cambia (ver antes y despues).
select is((select string_agg(c.codigo, ',') from contabilidad.comprobaciones() c where not c.ok), 'C20', 'solo C20 informativa (de la siembra), igual que antes del conteo; C1..C24 restantes en verde');
select is((operacion.cuadre_socios() ->> 'libro_conciliado')::boolean, true, 'Libro conciliado');
select is((api.inventario_concilia() ->> 'concilia')::boolean, true, 'el inventario concilia con el libro tras el conteo');
select is((api.inventario_concilia() -> 'valor' ->> 'libro_1310_cent')::bigint, 3600000::bigint, '1310 sigue en 36,000.00');
select is(api.inventario_concilia() ->> 'estado_conteo', 'diferencias_abiertas', 'diferencias sin explicar: con diferencias abiertas');
select is((api.inventario_concilia() -> 'ultimo_conteo' ->> 'sabores_con_diferencia')::int, 5, 'cinco sabores con diferencia');
select is((api.inventario_concilia() -> 'ultimo_conteo' ->> 'neto_piezas')::int, 0, 'neto 0 piezas');
select is((api.inventario_concilia() -> 'ultimo_conteo' ->> 'ajuste_valor_cent')::bigint, 0::bigint, 'ajuste neto de valor 0');

-- Segundo conteo, ya sin diferencias: conciliado.
select operacion.abrir_conteo('cn-c2a', 'bodega_omar', 'semanal', now() + interval '1 minute');
select api.cerrar_conteo('cn-c2c', (select max(id) from operacion.conteo), jsonb_build_array(
  jsonb_build_object('sku_id', pg_temp.skuid('Sandia'), 'contado', 90), jsonb_build_object('sku_id', pg_temp.skuid('Mango'), 'contado', 103),
  jsonb_build_object('sku_id', pg_temp.skuid('Uva'), 'contado', 83), jsonb_build_object('sku_id', pg_temp.skuid('Fresa'), 'contado', 114), jsonb_build_object('sku_id', pg_temp.skuid('Cereza Nueva'), 'contado', 10)));
select is(api.inventario_concilia() ->> 'estado_conteo', 'conciliado', 'conteo sin diferencias: Conciliado');
select ok(not has_function_privilege('anon', 'api.inventario_concilia()', 'execute') and not has_function_privilege('anon', 'api.conteo_agregar_sabor(text,bigint,text,boolean)', 'execute'), 'anon sin EXECUTE');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777c2', true);
select throws_ok($$select api.inventario_concilia()$$, null, null, 'Omar no lee la conciliacion');
select * from finish();
rollback;
