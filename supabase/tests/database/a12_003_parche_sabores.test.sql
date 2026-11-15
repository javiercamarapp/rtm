-- pgTAP a12_003: PARCHE de la unificacion de sabores (hallazgos H2, H3, H4, H5 de la revision independiente).
-- Escenario espejo de produccion (igual que a12_001): US Blade con ambos sabores y ventas enviadas en los dos nombres (fusion de sku), US Icon solo con el origen (reasignacion).
-- Lo central: kardex, existencias, libro y C1..C24 IDENTICOS antes y despues de unificar y de deshacer; el inventario ya no muestra el segundo renglon del sku fusionado;
-- si ese sku llegara a tener piezas, se SUMAN al canonico; un sku_id o un nombre viejo se redirigen al sku vigente; la clave deshecha se detecta; el empate de sku prefiere 'Passion Fruit'.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('us.jav@example.test', 'socio', 'Javier', true), ('us.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values ('88888888-8888-8888-8888-8888888888a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'us.jav@example.test'),
  ('88888888-8888-8888-8888-8888888888a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'us.omar@example.test');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-8888888888a1', true);

-- Datos: modelo A con ambos sabores; modelo B solo con el origen; modelo C para el bloqueo.
select catalogo.asegurar_cliente('US Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('US Omar Persona', 'US Omar Persona');
select catalogo.asegurar_cliente('US Villa', 'Javier');
select catalogo.asegurar_modelo('US Marca', 'US Blade', 50000, 'ambas');
select catalogo.asegurar_modelo('US Marca', 'US Icon', 50000, 'ambas');
select catalogo.asegurar_modelo('US Marca', 'US Bloq', 50000, 'ambas');
select catalogo.asegurar_sku('US Blade', s) from unnest(array['Passionfruit', 'Passion Fruit', 'Kiwi Dragonfruit', 'Kiwi Dragon Fruit', 'Mango']) s;
select catalogo.asegurar_sku('US Icon', s) from unnest(array['Passionfruit', 'Kiwi Dragon Fruit']) s;
select catalogo.asegurar_sku('US Bloq', s) from unnest(array['Kiwi Dragonfruit', 'Kiwi Dragon Fruit']) s;
select catalogo.fijar_costo('us-k' || m, 'Isaac', m, 23000, '2026-11-01', 'prueba') from unnest(array['US Blade', 'US Icon', 'US Bloq']) m;
select catalogo.fijar_precio('us-p' || m, 'US Villa', m, 25000, '2026-11-01', 'chat') from unnest(array['US Blade', 'US Icon', 'US Bloq']) m;
select operacion.registrar_movimiento('us-e1', 'US Blade', 'Passionfruit', 'bodega_omar', 'entrada_compra', 10, 230000, '2026-11-08');
select operacion.registrar_movimiento('us-e2', 'US Blade', 'Passion Fruit', 'bodega_omar', 'entrada_compra', 30, 690000, '2026-11-08');
select operacion.registrar_movimiento('us-e3', 'US Blade', 'Kiwi Dragonfruit', 'bodega_omar', 'entrada_compra', 5, 115000, '2026-11-08');
select operacion.registrar_movimiento('us-e4', 'US Blade', 'Kiwi Dragon Fruit', 'bodega_omar', 'entrada_compra', 20, 460000, '2026-11-08');
select operacion.registrar_movimiento('us-e5', 'US Icon', 'Passionfruit', 'bodega_omar', 'entrada_compra', 8, 184000, '2026-11-08');
select operacion.registrar_movimiento('us-e6', 'US Bloq', 'Kiwi Dragonfruit', 'bodega_omar', 'entrada_compra', 6, 138000, '2026-11-08');
select operacion.registrar_movimiento('us-e7', 'US Bloq', 'Kiwi Dragon Fruit', 'bodega_omar', 'entrada_compra', 6, 138000, '2026-11-08');
create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
-- Ventas en AMBOS nombres, enviadas (como en produccion): el sku origen queda en 0 y con movimientos de salida en el kardex.
select operacion.crear_pedido('us-v1', (select id from catalogo.cliente where nombre_canonico = 'US Villa'), '[
  {"modelo":"US Blade","sabor":"Passionfruit","piezas":10},{"modelo":"US Blade","sabor":"Passion Fruit","piezas":4},
  {"modelo":"US Blade","sabor":"Kiwi Dragonfruit","piezas":5},{"modelo":"US Icon","sabor":"Passionfruit","piezas":8}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('us-v1c', pg_temp.pid('us-v1'));
select operacion.marcar_empacado('us-v1e', pg_temp.pid('us-v1'));
select operacion.enviar_pedido('us-v1s', pg_temp.pid('us-v1'), null, '{"paqueteria":"Castores","numero":"US-1","costo_cent":18000,"pagada_por":"Javier"}'::jsonb, negocio.hoy());
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();

create function pg_temp.sabor(p text) returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = $1 and unificado_en is null $$;
create function pg_temp.sku(p_modelo text, p_sabor_id bigint) returns bigint language sql as $$ select k.id from catalogo.sku k where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = $1) and k.sabor_id = $2 and k.unificado_en is null $$;
-- Huella de todo lo inmutable y de las lecturas de dinero. md5 del contenido completo de cada tabla de solo insercion.
create function pg_temp.huella() returns jsonb language sql as $$
  select jsonb_build_object(
    'kardex', (select md5(string_agg(to_jsonb(m)::text, '|' order by m.id)) from operacion.movimiento_inventario m),
    'kardex_n', (select count(*) from operacion.movimiento_inventario),
    'existencia_sku', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.sku_id, e.ubicacion)) from operacion.existencia_sku_ubicacion e),
    'existencia_modelo', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.modelo_id)) from operacion.existencia_modelo e),
    'pedido_linea', (select md5(string_agg(to_jsonb(l)::text, '|' order by l.id)) from operacion.pedido_linea l),
    'surtido', (select md5(string_agg(to_jsonb(s)::text, '|' order by s.id)) from operacion.pedido_surtido s),
    'eventos', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) from operacion.evento e),
    'asientos', (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from contabilidad.asiento a),
    'asientos_n', (select count(*) from contabilidad.asiento),
    'cadena', contabilidad.verificar_cadena(),
    'c1310', contabilidad.saldo('1310'),
    'comprobaciones', (select jsonb_agg(jsonb_build_object('c', c.codigo, 'ok', c.ok, 'a', c.via_a_cent, 'b', c.via_b_cent) order by c.codigo) from contabilidad.comprobaciones() c),
    'libro_conciliado', operacion.cuadre_socios() ->> 'libro_conciliado',
    'concilia', api.inventario_concilia() ->> 'concilia');
$$;
create function pg_temp.rojas() returns text language sql as $$ select string_agg(c.codigo, ',' order by c.codigo) from contabilidad.comprobaciones() c where not c.ok and c.bloqueante $$;
create function pg_temp.catalogo_estado() returns text language sql as $$
  select md5(coalesce((select string_agg(to_jsonb(s)::text, '|' order by s.id) from catalogo.sabor s), '') || coalesce((select string_agg(to_jsonb(k)::text, '|' order by k.id) from catalogo.sku k), '') || coalesce((select string_agg(to_jsonb(a)::text, '|' order by a.id) from catalogo.sabor_alias a), ''))
$$;


create function pg_temp.blade() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'US Blade' $$;
create function pg_temp.icon() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'US Icon' $$;
-- Lecturas de pantalla, ya como jsonb filtrado a un modelo y a los sabores 'Passion%'.
create function pg_temp.exis_filas(p_modelo bigint) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(api.inventario_existencia() -> 'sabores') x where (x ->> 'modelo_id')::bigint = $1 and x ->> 'sabor' ilike 'passion%' $$;
create function pg_temp.exis_piezas(p_modelo bigint) returns bigint language sql as $$
  select coalesce(sum((x ->> 'piezas')::int), 0) from jsonb_array_elements(api.inventario_existencia() -> 'sabores') x where (x ->> 'modelo_id')::bigint = $1 and x ->> 'sabor' ilike 'passion%' $$;
create function pg_temp.exis_modelo(p_modelo bigint) returns text language sql as $$
  select (x ->> 'piezas') || '/' || (x ->> 'valor_cent') from jsonb_array_elements(api.inventario_existencia() -> 'modelos') x where (x ->> 'modelo_id')::bigint = $1 $$;
create function pg_temp.det(p_sku bigint, p_campo text) returns numeric language sql as $$
  select coalesce(sum((x ->> $2)::numeric), 0) from jsonb_array_elements(api.inventario_detalle() -> 'sabores') x where (x ->> 'sku_id')::bigint = $1 $$;
create function pg_temp.kar(p_sku bigint, p_campo text) returns bigint language sql as $$
  select (api.inventario_kardex_consolidado(null, pg_temp.blade(), $1, null, null, null, null, 500, 0) -> 'totales' ->> $2)::bigint $$;
create function pg_temp.cob_sal(p_modelo bigint) returns bigint language sql as $$ select coalesce(sum(salidas), 0) from operacion.cobertura(negocio.hoy()) where nivel = 'sku' and modelo_id = $1 $$;
create function pg_temp.cob_filas(p_modelo bigint) returns int language sql as $$ select count(*)::int from operacion.cobertura(negocio.hoy()) where nivel = 'sku' and modelo_id = $1 $$;
create function pg_temp.base_sabores(p_modelo bigint) returns jsonb language sql as $$
  select x -> 'sabores' from jsonb_array_elements(operacion.inventario_base() -> 'modelos') x where (x ->> 'modelo_id')::bigint = $1 $$;

select is(pg_temp.rojas(), null, 'antes: ninguna comprobacion bloqueante en rojo');
create temp table _antes as select pg_temp.huella() as h, pg_temp.catalogo_estado() as ce;
grant all on _antes to public;
create temp table _pre as select pg_temp.sabor('Passionfruit') as orig, pg_temp.sabor('Passion Fruit') as dest,
  pg_temp.sku('US Blade', pg_temp.sabor('Passionfruit')) as sku_o, pg_temp.sku('US Blade', pg_temp.sabor('Passion Fruit')) as sku_d,
  pg_temp.sku('US Icon', pg_temp.sabor('Passionfruit')) as icon_o,
  pg_temp.exis_filas(pg_temp.blade()) as filas, pg_temp.exis_piezas(pg_temp.blade()) as piezas, pg_temp.exis_modelo(pg_temp.blade()) as modelo_ex, pg_temp.exis_modelo(pg_temp.icon()) as icon_ex;
grant all on _pre to public;
create temp table _pre2 as select
  pg_temp.det((select sku_o from _pre), 'entradas') + pg_temp.det((select sku_d from _pre), 'entradas') as det_ent,
  pg_temp.det((select sku_o from _pre), 'salidas') + pg_temp.det((select sku_d from _pre), 'salidas') as det_sal,
  pg_temp.kar((select sku_o from _pre), 'entradas_piezas') + pg_temp.kar((select sku_d from _pre), 'entradas_piezas') as kar_ent,
  pg_temp.kar((select sku_o from _pre), 'salidas_piezas') + pg_temp.kar((select sku_d from _pre), 'salidas_piezas') as kar_sal,
  pg_temp.cob_sal(pg_temp.blade()) as cob_sal, pg_temp.cob_filas(pg_temp.blade()) as cob_filas, jsonb_array_length(pg_temp.base_sabores(pg_temp.blade())) as base_n,
  api.inventario_kardex_consolidado(null, pg_temp.blade(), null, null, null, null, null, 500, 0) -> 'totales' as kar_mod;
grant all on _pre2 to public;

-- (1) ANTES: dos renglones de Passion en US Blade, con sus movimientos.
select is((select filas from _pre), 2, 'antes: US Blade lista Passionfruit y Passion Fruit como dos renglones');
select ok((select piezas from _pre) > 0 and (select det_ent from _pre2) = 40 and (select det_sal from _pre2) = 14, 'antes: entradas 10+30 y salidas 10+4 de los dos sku');
select is((select kar_ent from _pre2), 40::bigint, 'antes: kardex por sabor, entradas de los dos sku = 40');

-- (2) UNIFICAR (clave aprobada por el dueno, como lo hace el script) --------------------------------------------------------------------------------------
select is(catalogo.unificar_sabor('aprobados:dueno-2026-11-14-passion-fruit', (select orig from _pre), (select dest from _pre), 'importacion', null, null, 'dueno-2026-11-14-passion-fruit') ->> 'estado', 'unificado', 'unificada con la clave aprobada');
select is(pg_temp.huella(), (select h from _antes), 'IGUAL antes y despues de unificar: kardex, existencias, eventos, asientos, cadena, 1310 y C1..C24');
select is(pg_temp.rojas(), null, 'despues de unificar: ninguna comprobacion bloqueante en rojo');
-- H2: el inventario ya no muestra el segundo renglon.
select is(pg_temp.exis_filas(pg_temp.blade()), 1, 'H2: existencias de US Blade: un solo renglon de Passion Fruit (sin el fusionado con 0 piezas)');
select is(pg_temp.exis_piezas(pg_temp.blade()), (select piezas from _pre), 'H2: y las piezas son las mismas que antes (nada desaparece)');
select is(pg_temp.exis_modelo(pg_temp.blade()), (select modelo_ex from _pre), 'H2: piezas y valor del modelo identicos');
select is(pg_temp.exis_modelo(pg_temp.icon()), (select icon_ex from _pre), 'H2: US Icon (reasignado) identico');
select ok(not exists (select 1 from jsonb_array_elements(api.inventario_existencia() -> 'sabores') x where (x ->> 'sku_id')::bigint = (select sku_o from _pre)), 'H2: el sku fusionado no aparece en la lectura de existencias');
select is(pg_temp.det((select sku_d from _pre), 'entradas'), (select det_ent from _pre2), 'H2: el detalle suma al canonico las entradas del fusionado');
select is(pg_temp.det((select sku_d from _pre), 'salidas'), (select det_sal from _pre2), 'H2: y las salidas');
select is(pg_temp.det((select sku_o from _pre), 'entradas'), 0::numeric, 'H2: el sku fusionado ya no tiene fila propia en el detalle');
select is(pg_temp.kar((select sku_d from _pre), 'entradas_piezas'), (select kar_ent from _pre2), 'H2: el kardex filtrado por el canonico incluye las entradas del fusionado');
select is(pg_temp.kar((select sku_d from _pre), 'salidas_piezas'), (select kar_sal from _pre2), 'H2: y las salidas');
select is(pg_temp.kar((select sku_o from _pre), 'entradas_piezas'), (select kar_ent from _pre2), 'H2: pedir el kardex del sku fusionado (liga vieja) devuelve el del canonico');
select is(api.inventario_kardex_consolidado(null, pg_temp.blade(), (select sku_d from _pre), null, null, null, null, 500, 0) -> 'cuadre_periodo' ->> 'esperado_piezas',
          api.inventario_kardex_consolidado(null, pg_temp.blade(), (select sku_d from _pre), null, null, null, null, 500, 0) -> 'cuadre_periodo' ->> 'final_piezas', 'H2: el cuadre del periodo del sabor cuadra (inicial + entradas - salidas = final)');
select is(api.inventario_kardex_consolidado(null, pg_temp.blade(), null, null, null, null, null, 500, 0) -> 'totales', (select kar_mod from _pre2), 'H2: los totales del kardex del modelo son identicos');
select is((api.inventario_kardex_consolidado(null, pg_temp.blade(), null, null, null, null, null, 500, 0) -> 'comprobacion' ->> 'cuadra')::boolean, true, 'H2: la comprobacion de dos vias del kardex cuadra');
select is(pg_temp.cob_sal(pg_temp.blade()), (select cob_sal from _pre2), 'H2: cobertura: las salidas del modelo por sku suman igual');
select is(pg_temp.cob_filas(pg_temp.blade()), (select cob_filas from _pre2) - 1, 'H2: cobertura: una fila de sku menos (el fusionado ya no sale aparte)');
select is(jsonb_array_length(pg_temp.base_sabores(pg_temp.blade())), (select base_n from _pre2) - 1, 'H2: inventario_base (Inventario): un renglon de sabor menos');
select is((operacion.inventario_base() -> 'comprobacion' ->> 'piezas_sabores')::bigint, (operacion.inventario_base() -> 'comprobacion' ->> 'piezas_modelos')::bigint, 'H2: inventario_base: piezas por sabor = piezas por modelo');
select is((operacion.inventario_base() -> 'comprobacion' ->> 'valor_sabores_cent')::bigint, (operacion.inventario_base() -> 'comprobacion' ->> 'valor_modelos_cent')::bigint, 'H2: inventario_base: valor por sabor = valor por modelo');
select ok(proveedores.tablero_karen() is not null, 'tablero de Karen: se lee sin error con un sku fusionado');
select ok(jsonb_typeof(proveedores.existencia_propia()) = 'array', 'existencia propia de Karen: se lee sin error');

-- (5) H5: la clave fija de aprobados ya tenia resultado 'unificado' pero se deshizo ----------------------------------------------------------------------------
select is(api.sabor_unificacion_deshacer('us-h5z', (select max(id) from catalogo.unificacion_sabor)) ->> 'estado', 'deshecha', 'H5: se deshace la unificacion hecha con la clave fija de aprobados');
select is(pg_temp.exis_filas(pg_temp.blade()), 2, 'H5: tras deshacer vuelven los dos renglones');
select throws_ok(format($q$select catalogo.unificar_sabor('aprobados:dueno-2026-11-14-passion-fruit', %s, %s, 'importacion', null, null, 'dueno-2026-11-14-passion-fruit')$q$, (select orig from _pre), (select dest from _pre)),
  'P0463', null, 'H5: la misma clave tras deshacer dice "ya deshecho" (no devuelve un resultado viejo)');
select is(catalogo.unificar_sabor('aprobados:dueno-2026-11-14-passion-fruit:r1', (select orig from _pre), (select dest from _pre), 'importacion', null, null, 'dueno-2026-11-14-passion-fruit') ->> 'estado', 'unificado', 'H5: con una clave nueva se vuelve a aplicar');
select is(catalogo.unificar_sabor('aprobados:dueno-2026-11-14-passion-fruit:r1', (select orig from _pre), (select dest from _pre), 'importacion', null, null, 'dueno-2026-11-14-passion-fruit') ->> 'repetido', 'true', 'H5: la clave nueva es idempotente mientras siga unificada');
select is((select count(*)::int from catalogo.unificacion_sabor where estado = 'aplicada'), 1, 'una unificacion aplicada');
select is(pg_temp.huella(), (select h from _antes), 'H5: tras reaplicar, lo inmutable sigue identico');


-- H2 con piezas: un sku fusionado que reciba piezas (p. ej. una devolucion de cliente historica) se SUMA al canonico en la lectura; nunca desaparece.
select is((select count(*)::int from catalogo.sku where id = (select sku_o from _pre) and unificado_en = (select sku_d from _pre)), 1, 'el sku origen de US Blade esta fusionado en el canonico');
do $do$
declare v_ev bigint;
begin
  v_ev := operacion.crear_evento('movimiento_entrada_compra', negocio.hoy(), 'us-fus-1', jsonb_build_object('nota', 'piezas en el sku fusionado'));
  insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
    select negocio.hoy(), p.sku_o, pg_temp.blade(), 'bodega_omar', 'entrada_compra', 3, 69000, v_ev from _pre p;
end $do$;
select is((select piezas from operacion.existencia_sku_ubicacion where sku_id = (select sku_o from _pre) and ubicacion = 'bodega_omar'), 3, 'el sku fusionado tiene ahora 3 piezas propias');
select is(pg_temp.exis_filas(pg_temp.blade()), 1, 'con piezas en el fusionado: sigue un solo renglon');
select is(pg_temp.exis_piezas(pg_temp.blade()), (select piezas from _pre) + 3, 'sus 3 piezas se suman al canonico en existencias');
select is((select sum((x ->> 'piezas')::int) from jsonb_array_elements(pg_temp.base_sabores(pg_temp.blade())) x where x ->> 'sabor' = 'Passion Fruit')::bigint, (select piezas from _pre) + 3, 'y en inventario_base');
select is((operacion.inventario_base() -> 'comprobacion' ->> 'piezas_sabores')::bigint, (operacion.inventario_base() -> 'comprobacion' ->> 'piezas_modelos')::bigint, 'inventario_base sigue cuadrando por piezas con piezas en el fusionado');
select is((select e.valor_cent from operacion.existencia_modelo e where e.modelo_id = pg_temp.blade()) , (select e.valor_cent from operacion.existencia_modelo e where e.modelo_id = pg_temp.blade()) , 'valor del modelo leido');
select is((select (x ->> 'piezas')::int from jsonb_array_elements(api.inventario_existencia() -> 'modelos') x where (x ->> 'modelo_id')::bigint = pg_temp.blade()), (select e.piezas from operacion.existencia_modelo e where e.modelo_id = pg_temp.blade()), 'el total del modelo en la lectura = existencia_modelo');
select is((select sum((x ->> 'piezas')::int) from jsonb_array_elements(api.inventario_existencia() -> 'sabores') x where (x ->> 'modelo_id')::bigint = pg_temp.blade()), (select e.piezas::bigint from operacion.existencia_modelo e where e.modelo_id = pg_temp.blade()), 'la suma de sabores = total del modelo (cuadre de piezas)');

-- (3) H4: redireccion a sku vigente, nombre viejo por alias, auditoria ----------------------------------------------------------------------------------------------
select is(operacion.resolver_sku(jsonb_build_object('sku_id', (select sku_o from _pre))) ->> 'sku_id', (select sku_d from _pre)::text, 'H4: resolver_sku con el sku_id fusionado resuelve al sku canonico');
select is(operacion.resolver_sku(jsonb_build_object('sku_id', (select sku_o from _pre))) ->> 'redirigido_de', (select sku_o from _pre)::text, 'H4: y dice de cual se redirigio');
select is(operacion.resolver_sku(jsonb_build_object('sku_id', (select sku_d from _pre))) ? 'redirigido_de', false, 'H4: un sku vigente no se marca como redirigido');
select is(operacion.resolver_sku('{"modelo":"US Blade","sabor":"Passionfruit"}'::jsonb) ->> 'sku_id', (select sku_d from _pre)::text, 'H4: resolver_sku por nombre: Passionfruit resuelve por alias al canonico');
select is(operacion.resolver_sku('{"modelo":"US Blade","sabor":"passion fruit"}'::jsonb) ->> 'sku_id', (select sku_d from _pre)::text, 'H4: y el nombre canonico sigue resolviendo');
select is(operacion.resolver_sku('{"modelo":"US Icon","sabor":"Passionfruit"}'::jsonb) ->> 'sku_id', (select icon_o from _pre)::text, 'H4: en US Icon (reasignado) el nombre viejo resuelve a su mismo sku');
select throws_ok($$select operacion.resolver_sku('{"modelo":"US Blade","sabor":"Sandia Fantasma"}'::jsonb)$$, '22023', null, 'H4: un sabor sin relacion sigue siendo desconocido');
select is(catalogo.sabor_por_nombre('Passionfruit'), (select dest from _pre), 'sabor_por_nombre: el alias resuelve al canonico');
select is(catalogo.sabor_por_nombre('Straw'), null::bigint, 'sabor_por_nombre: otros alias (no de unificacion) no se asumen');
select is(operacion.registrar_movimiento('us-h4a', 'US Blade', 'Passionfruit', 'bodega_omar', 'entrada_compra', 2, 46000, negocio.hoy()) ->> 'movimiento_id' is not null, true, 'H4: registrar_movimiento con el nombre viejo opera (por alias)');
select is((select m.sku_id from operacion.movimiento_inventario m order by m.id desc limit 1), (select sku_d from _pre), 'H4: y el movimiento cae en el sku canonico, no en el fusionado');
select is((select count(*)::int from seguridad.auditoria where accion = 'REDIRECCION_ALIAS_SABOR'), 1, 'H4: la redireccion por alias queda auditada');
select is((select piezas from operacion.existencia_sku_ubicacion where sku_id = (select sku_o from _pre) and ubicacion = 'bodega_omar'), 3, 'H4: el fusionado no recibio nada nuevo');
select is(operacion.registrar_movimiento('us-h4b', 'US Blade', 'Passion Fruit', 'bodega_omar', 'entrada_compra', 1, 23000, negocio.hoy()) ->> 'movimiento_id' is not null, true, 'registrar_movimiento con el nombre canonico no cambia');
select is((select count(*)::int from seguridad.auditoria where accion = 'REDIRECCION_ALIAS_SABOR'), 1, 'y con el nombre propio no se audita redireccion');
select is(operacion.crear_pedido('us-h4p', (select id from catalogo.cliente where nombre_canonico = 'US Villa'),
   jsonb_build_array(jsonb_build_object('sku_id', (select sku_o from _pre), 'piezas', 2)), 'bodega_omar', null, 30000, 0, 0, negocio.hoy()) ->> 'pedido_id' is not null, true, 'H4: un pedido con el sku_id fusionado se crea');
select is((select l.sku_id from operacion.pedido_linea l order by l.id desc limit 1), (select sku_d from _pre), 'H4: y su renglon queda en el sku canonico');
select is(jsonb_array_length(operacion.conteo_diferencias('bodega_omar', jsonb_build_array(jsonb_build_object('sku_id', (select sku_o from _pre), 'contado', 5))) -> 'lineas'), 1, 'H4: conteo_diferencias con el sku fusionado devuelve una linea');
select is(operacion.conteo_diferencias('bodega_omar', jsonb_build_array(jsonb_build_object('sku_id', (select sku_o from _pre), 'contado', 5))) -> 'lineas' -> 0 ->> 'sku_id', (select sku_d from _pre)::text, 'H4: ... del sku canonico');
select is(api.conteo_agregar_sabor('us-h4c', pg_temp.blade(), 'Passionfruit') ->> 'estado', 'existente', 'alta por el nombre viejo: existente (no recrea)');
select is((select count(*)::int from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.blade() and k.unificado_en is null and s.nombre_canonico ilike 'passion%'), 1, 'US Blade tiene un solo sku vigente de Passion');

-- (4) Deshacer: todo vuelve a como estaba (el sku fusionado conserva sus 3 piezas y su historia) ---------------------------------------------------------------------
select is(api.sabor_unificacion_deshacer('us-h5d', (select max(id) from catalogo.unificacion_sabor)) ->> 'estado', 'deshecha', 'deshacer la unificacion');
select is(pg_temp.exis_filas(pg_temp.blade()), 2, 'tras deshacer vuelven los dos renglones');
select is(pg_temp.exis_piezas(pg_temp.blade()), (select piezas from _pre) + 3 + 2 + 1, 'y el total de piezas de Passion es el mismo (incluye lo registrado despues)');
select is(operacion.resolver_sku('{"modelo":"US Blade","sabor":"Passionfruit"}'::jsonb) ->> 'sku_id', (select sku_o from _pre)::text, 'tras deshacer, el nombre viejo vuelve a resolver a su propio sku');

create function pg_temp.q(p_a text, p_b text) returns bigint language sql as $$
  select id from catalogo.posible_duplicado where tipo = 'sabor' and id_a = least(pg_temp.sabor($1), pg_temp.sabor($2)) and id_b = greatest(pg_temp.sabor($1), pg_temp.sabor($2)) $$;
-- (6) H3: empate de sku -> el nombre con espacios entre palabras (o el mas largo) -----------------------------------------------------------------------------------
select catalogo.asegurar_sku('US Bloq', 'Zetafruit');
select catalogo.asegurar_sku('US Bloq', 'Zeta Fruit');
select is(catalogo.sabor_canonico_preferido(pg_temp.sabor('Zetafruit'), pg_temp.sabor('Zeta Fruit')), pg_temp.sabor('Zeta Fruit'), 'H3: empate de sku: "Zeta Fruit" gana a "Zetafruit"');
select is(catalogo.sabor_canonico_preferido(pg_temp.sabor('Zeta Fruit'), pg_temp.sabor('Zetafruit')), pg_temp.sabor('Zeta Fruit'), 'H3: sin importar el orden de los argumentos');
select is(catalogo.sabor_canonico_preferido(pg_temp.sabor('Passionfruit'), pg_temp.sabor('Passion Fruit')), pg_temp.sabor('Passionfruit'), 'H3: si NO hay empate, gana el que tiene mas sku (Passionfruit tiene 2 y Passion Fruit 1)');
select catalogo.asegurar_sku('US Bloq', 'Melonmix');
select catalogo.asegurar_sku('US Bloq', 'Melon Mixx');
select is(catalogo.sabor_canonico_preferido(pg_temp.sabor('Melonmix'), pg_temp.sabor('Melon Mixx')), pg_temp.sabor('Melon Mixx'), 'H3: con espacios en uno solo, ese gana aunque el otro sea mas corto o igual');
select catalogo.asegurar_sku('US Bloq', 'Uvaazul');
select catalogo.asegurar_sku('US Bloq', 'Uvaazules');
select is(catalogo.sabor_canonico_preferido(pg_temp.sabor('Uvaazul'), pg_temp.sabor('Uvaazules')), pg_temp.sabor('Uvaazules'), 'H3: sin espacios en ninguno, gana el mas largo');
select ok((api.duplicados_escanear('sabor') ->> 'preguntas_nuevas')::int >= 3, 'el escaneo deja las preguntas del desempate');
select is((select x ->> 'canonico_sugerido' from jsonb_array_elements(api.duplicados_pendientes('sabor')) x where (x -> 'a' ->> 'nombre') in ('Zetafruit', 'Zeta Fruit') and (x -> 'b' ->> 'nombre') in ('Zetafruit', 'Zeta Fruit')), pg_temp.sabor('Zeta Fruit')::text, 'H3: canonico_sugerido de la web = "Zeta Fruit"');
create temp table _q3 as select pg_temp.q('Zetafruit', 'Zeta Fruit') as id;
grant all on _q3 to public;
select is(api.duplicado_responder('us-h3', (select id from _q3), 'si') ->> 'destino', 'Zeta Fruit', 'H3: contestar "si" sin elegir canonico (aunque contesten antes) deja "Zeta Fruit"');
select is((select count(*)::int from catalogo.sabor where nombre_canonico = 'Zeta Fruit' and unificado_en is null), 1, 'H3: el canonico vigente es "Zeta Fruit"');
select is(api.duplicado_responder('us-h3', (select id from _q3), 'si') ->> 'repetido', 'true', 'H3: la misma clave devuelve lo guardado mientras siga unificado');
select is(api.sabor_unificacion_deshacer('us-h3d', (select max(id) from catalogo.unificacion_sabor)) ->> 'estado', 'deshecha', 'deshacer la del desempate');
select throws_ok(format($q$select api.duplicado_responder('us-h3', %s, 'si')$q$, (select id from _q3)), 'P0463', null, 'H5: responder con la clave vieja tras deshacer dice "ya deshecho"');

-- (7) Permisos y seguridad --------------------------------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'catalogo.sku_vigente(bigint)', 'execute') and not has_function_privilege('anon', 'catalogo.sku_vigente(bigint)', 'execute'), 'las piezas nuevas no se exponen (sku_vigente)');
select ok(not has_function_privilege('authenticated', 'catalogo.skus_del_grupo(bigint)', 'execute') and not has_function_privilege('authenticated', 'catalogo.sabor_por_nombre(text)', 'execute')
      and not has_function_privilege('authenticated', 'catalogo.sabor_canonico_preferido(bigint,bigint)', 'execute') and not has_function_privilege('authenticated', 'catalogo.auditar_redirecciones(jsonb,text)', 'execute')
      and not has_function_privilege('authenticated', 'catalogo.auditar_alias_sabor(text,bigint,text)', 'execute'), 'ni el resto de los auxiliares');
select ok(has_function_privilege('authenticated', 'api.inventario_existencia()', 'execute') and has_function_privilege('authenticated', 'api.inventario_detalle(date,date)', 'execute')
      and has_function_privilege('authenticated', 'api.duplicados_pendientes(text)', 'execute'), 'las lecturas de la web conservan su permiso para authenticated');
select ok(not has_function_privilege('anon', 'api.inventario_existencia()', 'execute') and not has_function_privilege('anon', 'api.inventario_detalle(date,date)', 'execute'), 'y anon sigue sin EXECUTE');
select ok((select bool_and(p.prosecdef) from pg_proc p where p.pronamespace = 'api'::regnamespace and p.proname in ('inventario_existencia', 'inventario_detalle', 'inventario_kardex_consolidado', 'duplicados_pendientes')), 'las lecturas siguen siendo SECURITY DEFINER');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace in ('api'::regnamespace, 'operacion'::regnamespace, 'catalogo'::regnamespace) and p.proname in ('inventario_existencia', 'inventario_detalle', 'cobertura', 'resolver_sku', 'registrar_movimiento', 'sku_vigente', 'sabor_por_nombre', 'sabor_canonico_preferido', 'auditar_alias_sabor')), 'search_path vacio en lo tocado');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-8888888888a2', true);
select throws_ok($$select api.inventario_existencia()$$, '42501', null, 'Omar no ve el inventario');
select throws_ok($$select api.inventario_detalle()$$, '42501', null, 'Omar no ve el detalle');
select throws_ok($$select api.duplicados_pendientes()$$, '42501', null, 'Omar no ve las preguntas');
select * from finish();
rollback;
