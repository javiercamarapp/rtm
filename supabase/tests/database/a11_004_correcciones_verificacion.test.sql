-- pgTAP a11_004: correcciones de la verificacion. (1) bodega no recibe el nombre del proveedor en NINGUN texto de api.bodega_llegadas ni api.bodega_hoy_a_preparar;
-- (2) operacion.cerrar_conteo vacia un modelo con varios SKUs y costo promedio fraccionario (33+33+34 con 1,000,001 centavos; 10 SKUs x 104 pz = 1,040 pz con 9,522,078) sin error y sin centavos sueltos,
-- y los conteos parciales y con entradas siguen igual; el Libro y las comprobaciones no cambian; (3) catalogo.parecido compara por longitud; (4) catalogo.alta_sabor toma el lock por actor.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('v4.socio@example.test', 'socio', 'Javier', true), ('v4.bodega@example.test', 'bodega', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('c1140000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v4.socio@example.test'),
  ('c1140000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v4.bodega@example.test');
create function pg_temp.como(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce($1::text, ''), true) $$;
select pg_temp.como('c1140000-0000-0000-0000-000000000001');

-- (1) Bodega sin el nombre del proveedor -------------------------------------------------------------------------------------------------------
select catalogo.asegurar_modelo('V4 Marca', 'V4 Modelo', 50000, 'ambas');
select catalogo.asegurar_sku('V4 Modelo', 'Fresa');
select catalogo.fijar_costo('v4c1', 'Isaac', 'V4 Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_costo('v4c2', 'Karen', 'V4 Modelo', 9000, '2020-01-01', 'prueba');
select operacion.crear_compra('v4o1', 'Isaac', '[{"modelo":"V4 Modelo","sabor":"Fresa","pagadas":60}]'::jsonb, 45000, 0, '2026-11-20', 'bodega', 'sociedad', 'Angelo');
select operacion.confirmar_compra('v4o1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'v4o1'));
select operacion.marcar_compra_enviada('v4o1e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'v4o1'), '[{"paqueteria":"Castores","numero":"V4-GUIA-1"}]'::jsonb, '2026-11-20', '2026-11-13');
select operacion.crear_compra('v4o2', 'Isaac', '[{"modelo":"V4 Modelo","sabor":"Fresa","pagadas":10}]'::jsonb, 0, 0, '2026-11-22', 'bodega', 'sociedad', 'Angelo');
select operacion.confirmar_compra('v4o2c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'v4o2'));
select pg_temp.como('c1140000-0000-0000-0000-000000000002');
set local role authenticated;
create temp table _ll as select api.bodega_llegadas() j;
create temp table _hy as select api.bodega_hoy_a_preparar() j;
reset role;
select is(jsonb_array_length((select j -> 'compras' from _ll)), 2, 'bodega ve las dos llegadas');
select ok(not ((select j::text from _ll) ~* '(isaac|karen|vapemate|proveedor)'), 'ningun texto de api.bodega_llegadas lleva el nombre del proveedor ni la clave proveedor');
select ok(not ((select j::text from _hy) ~* '(isaac|karen|vapemate|proveedor)'), 'ni api.bodega_hoy_a_preparar');
select ok((select (c -> 'folio') is not null and (c -> 'lineas') is not null from jsonb_array_elements((select j -> 'compras' from _ll)) c limit 1), 'conserva folio y lineas');
select ok((select j::text from _ll) like '%V4-GUIA-1%', 'conserva la guia de entrada (paqueteria y numero)');

-- (2) cerrar_conteo ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.como('c1140000-0000-0000-0000-000000000001');
select catalogo.asegurar_modelo('V4 Marca', 'V4 Tres', 50000, 'ambas');
select catalogo.asegurar_sku('V4 Tres', s) from unnest(array['A', 'B', 'C']) s;
select operacion.registrar_movimiento('v4t-a', 'V4 Tres', 'A', 'bodega_omar', 'entrada_compra', 33, 330001, negocio.hoy() - 5);
select operacion.registrar_movimiento('v4t-b', 'V4 Tres', 'B', 'bodega_omar', 'entrada_compra', 33, 330000, negocio.hoy() - 5);
select operacion.registrar_movimiento('v4t-c', 'V4 Tres', 'C', 'bodega_omar', 'entrada_compra', 34, 340000, negocio.hoy() - 5);
select catalogo.asegurar_modelo('V4 Marca', 'V4 Nexa', 50000, 'ambas');
select catalogo.asegurar_sku('V4 Nexa', 'S' || i) from generate_series(1, 10) i;
select operacion.registrar_movimiento('v4n-' || i, 'V4 Nexa', 'S' || i, 'bodega_omar', 'entrada_compra', 104, case when i = 10 then 952215 else 952207 end, negocio.hoy() - 5) from generate_series(1, 10) i;
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
create function pg_temp.sk(p_modelo text, p_sabor text) returns bigint language sql as $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id join catalogo.modelo m on m.id = k.modelo_id where m.nombre_canonico = $1 and s.nombre_canonico = $2 $$;
create function pg_temp.ex(p_modelo text) returns jsonb language sql as $$ select jsonb_build_object('p', piezas, 'v', valor_cent) from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1 $$;
create function pg_temp.rojas() returns text language sql as $$ select string_agg(c.codigo, ',' order by c.codigo) from contabilidad.comprobaciones() c where not c.ok $$;
select is(pg_temp.ex('V4 Tres'), '{"p": 100, "v": 1000001}'::jsonb, 'V4 Tres: 100 piezas, 10,000.01');
select is(pg_temp.ex('V4 Nexa'), '{"p": 1040, "v": 9522078}'::jsonb, 'V4 Nexa: 1,040 piezas, 95,220.78');
create temp table _antes as select pg_temp.rojas() r;

-- Parcial: A baja 10 (33 a 23): sale 10 x costo promedio = 100,000.1 -> 100,000
select operacion.abrir_conteo('v4-c0a', 'bodega_omar', 'semanal', now() - interval '2 hours');
select api.cerrar_conteo('v4-c0c', (select max(id) from operacion.conteo), jsonb_build_array(jsonb_build_object('sku_id', pg_temp.sk('V4 Tres', 'A'), 'contado', 23)));
select is(pg_temp.ex('V4 Tres'), '{"p": 90, "v": 900001}'::jsonb, 'conteo parcial: sale 10 piezas a 1,000.00 y quedan 90 piezas, 9,000.01');
-- Con entradas y neto 0: B sube 5 y C baja 5
select operacion.abrir_conteo('v4-c1a', 'bodega_omar', 'semanal', now() - interval '90 minutes');
select api.cerrar_conteo('v4-c1c', (select max(id) from operacion.conteo), jsonb_build_array(jsonb_build_object('sku_id', pg_temp.sk('V4 Tres', 'B'), 'contado', 38), jsonb_build_object('sku_id', pg_temp.sk('V4 Tres', 'C'), 'contado', 29)));
select is(pg_temp.ex('V4 Tres'), '{"p": 90, "v": 900001}'::jsonb, 'con entradas y neto 0: piezas y valor no cambian');
-- Repro 1: contar en cero el modelo de 3 SKUs (23 + 33 + 34... hoy 23, 38, 29)
select operacion.abrir_conteo('v4-c2a', 'bodega_omar', 'semanal', now() - interval '1 hour');
select api.cerrar_conteo('v4-c2c', (select max(id) from operacion.conteo), jsonb_build_array(jsonb_build_object('sku_id', pg_temp.sk('V4 Tres', 'A'), 'contado', 0), jsonb_build_object('sku_id', pg_temp.sk('V4 Tres', 'B'), 'contado', 0), jsonb_build_object('sku_id', pg_temp.sk('V4 Tres', 'C'), 'contado', 0)));
select is(pg_temp.ex('V4 Tres'), '{"p": 0, "v": 0}'::jsonb, 'repro 1: contar todo en cero cierra y deja 0 piezas y 0.00 (sin centavos sueltos)');
-- Repro 2: 1,040 piezas en 10 SKUs contados todos en cero
select operacion.abrir_conteo('v4-c3a', 'bodega_omar', 'semanal', now() - interval '30 minutes');
select api.cerrar_conteo('v4-c3c', (select max(id) from operacion.conteo), (select jsonb_agg(jsonb_build_object('sku_id', pg_temp.sk('V4 Nexa', 'S' || i), 'contado', 0)) from generate_series(1, 10) i));
select is(pg_temp.ex('V4 Nexa'), '{"p": 0, "v": 0}'::jsonb, 'repro 2: 1,040 piezas contadas en cero cierran y dejan 0.00');
select is((select sum(valor_cent)::bigint from operacion.movimiento_inventario mi join catalogo.modelo m on m.id = mi.modelo_id where m.nombre_canonico = 'V4 Nexa' and mi.tipo = 'ajuste_conteo'), -9522078::bigint, 'las salidas suman exactamente el valor del modelo');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select is(pg_temp.rojas(), (select r from _antes), 'el libro y las comprobaciones quedan como antes (solo la C20 informativa de la siembra)');
select is((operacion.cuadre_socios() ->> 'libro_conciliado')::boolean, true, 'Libro conciliado');
select is((api.inventario_concilia() ->> 'concilia')::boolean, true, 'el inventario concilia con el libro');

-- (3) parecido por longitud y (4) lock -----------------------------------------------------------------------------------------------------------
select is(catalogo.parecido('uva verde', 'uva'), true, 'Uva verde se parece a Uva (el corto contenido por palabras)');
select is(catalogo.parecido('uva', 'uva verde'), true, 'y en el otro orden (antes dependia del orden alfabetico)');
select is(catalogo.parecido('mango', 'mangos'), true, 'distancia 1');
select is(catalogo.parecido('mango', 'sandia'), false, 'distintos');
select is(catalogo.parecido('uva', 'uva'), false, 'nunca el mismo nombre');
select ok(pg_get_functiondef('catalogo.alta_sabor(text,bigint,text,text,boolean)'::regprocedure) like '%pg_advisory_xact_lock%', 'alta_sabor serializa el conteo de topes por actor');
select * from finish();
rollback;
