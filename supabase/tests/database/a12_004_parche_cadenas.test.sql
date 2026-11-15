-- pgTAP a12_004: parche 2 de la unificacion de sabores. H-A: cadena A -> B -> C (los sku ya fusionados se reapuntan al nuevo destino; las lecturas agrupan todo en C aunque llegue
-- una devolucion de cliente al sku historico; deshacer en orden inverso restaura). H-C: proveedores.tablero_karen con variantes sinteticas de Karen que apuntan a los dos nombres de un
-- sabor unificado (ventas y existencia por modelo correctas, sin doble conteo).
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
create function pg_temp.ca() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'CA Blade' $$;
create function pg_temp.sab(p text) returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = $1 or nombre_original = $1 order by (nombre_original is null) desc limit 1 $$;
create function pg_temp.skx(p text) returns bigint language sql as $$ select k.id from catalogo.sku k where k.modelo_id = pg_temp.ca() and k.sabor_id = pg_temp.sab($1) $$;

-- Escenario H-A: CA Blade con tres sabores. A y B se venden por completo (existencia 0); C tiene existencia.
select catalogo.asegurar_modelo('US Marca', 'CA Blade', 50000, 'ambas');
select catalogo.asegurar_sku('CA Blade', s) from unnest(array['Cadena Ana', 'Cadena Beto', 'Cadena Cora']) s;
select catalogo.fijar_costo('ca-k', 'Isaac', 'CA Blade', 23000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('ca-p', 'US Villa', 'CA Blade', 25000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('ca-e1', 'CA Blade', 'Cadena Ana', 'bodega_omar', 'entrada_compra', 10, 230000, '2026-11-08');
select operacion.registrar_movimiento('ca-e2', 'CA Blade', 'Cadena Beto', 'bodega_omar', 'entrada_compra', 10, 230000, '2026-11-08');
select operacion.registrar_movimiento('ca-e3', 'CA Blade', 'Cadena Cora', 'bodega_omar', 'entrada_compra', 20, 460000, '2026-11-08');
select operacion.crear_pedido('ca-v1', (select id from catalogo.cliente where nombre_canonico = 'US Villa'), '[
  {"modelo":"CA Blade","sabor":"Cadena Ana","piezas":10},{"modelo":"CA Blade","sabor":"Cadena Beto","piezas":10}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('ca-v1c', pg_temp.pid('ca-v1'));
select operacion.marcar_empacado('ca-v1e', pg_temp.pid('ca-v1'));
select operacion.enviar_pedido('ca-v1s', pg_temp.pid('ca-v1'), null, '{"paqueteria":"Castores","numero":"CA-1","costo_cent":18000,"pagada_por":"Javier"}'::jsonb, negocio.hoy());
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
insert into catalogo.unificacion_aprobada (clave, origen_norm, destino_norm, nota) values ('ca-a-b', 'cadena ana', 'cadena beto', 'prueba'), ('ca-b-c', 'cadena beto', 'cadena cora', 'prueba');
create temp table _h as select pg_temp.huella() as h, pg_temp.catalogo_estado() as ce, pg_temp.skx('Cadena Ana') as a, pg_temp.skx('Cadena Beto') as b, pg_temp.skx('Cadena Cora') as c,
  pg_temp.sab('Cadena Ana') as sa, pg_temp.sab('Cadena Beto') as sb, pg_temp.sab('Cadena Cora') as sc;
grant all on _h to public;
select is(pg_temp.rojas(), null, 'antes: ninguna comprobacion bloqueante en rojo');

select is(catalogo.unificar_sabor('ca-u1', (select sa from _h), (select sb from _h), 'importacion', null, null, 'ca-a-b') ->> 'estado', 'unificado', 'A -> B unificado');
select is((select unificado_en from catalogo.sku where id = (select a from _h)), (select b from _h), 'sku a apunta a b');
select is(catalogo.unificar_sabor('ca-u2', (select sb from _h), (select sc from _h), 'importacion', null, null, 'ca-b-c') ->> 'estado', 'unificado', 'B -> C unificado');
select is((select unificado_en from catalogo.sku where id = (select b from _h)), (select c from _h), 'sku b apunta a c');
select is((select unificado_en from catalogo.sku where id = (select a from _h)), (select c from _h), 'H-A: sku a se REAPUNTO a c (una sola salto, no queda en b)');
select is((select unificado_en from catalogo.sabor where id = (select sa from _h)), (select sc from _h), 'H-A: el sabor A tambien apunta a C');
select is(catalogo.sku_vigente((select a from _h)), (select c from _h), 'sku_vigente(a) = c');
select is(pg_temp.huella(), (select h from _h), 'IGUAL antes y despues de la cadena: kardex, existencias, eventos, asientos, cadena, 1310 y C1..C24');
select is(pg_temp.rojas(), null, 'despues de la cadena: C1..C24 sin rojos');
select is((operacion.resolver_sku(jsonb_build_object('sku_id', (select a from _h))) ->> 'sku_id')::bigint, (select c from _h), 'resolver_sku(a) -> c');
select is((operacion.resolver_sku('{"modelo":"CA Blade","sabor":"Cadena Ana"}'::jsonb) ->> 'sku_id')::bigint, (select c from _h), 'el alias del primer origen resuelve a C');

-- Devolucion de cliente de un renglon vendido con el sku a (historico): la pieza reingresa a a.
select is((operacion.registrar_devolucion_cliente('ca-dev', pg_temp.pid('ca-v1'), jsonb_build_array(jsonb_build_object('linea_id',
    (select l.id from operacion.pedido_linea l where l.pedido_id = pg_temp.pid('ca-v1') and l.sku_id = (select a from _h)), 'sku_id', (select a from _h), 'piezas', 2)), 'prueba') ->> 'monto_cent') is not null, true, 'devolucion de 2 piezas del sku historico a');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select is((select piezas from operacion.existencia_sku_ubicacion where sku_id = (select a from _h) and ubicacion = 'bodega_omar'), 2, 'las 2 piezas quedaron en el sku a (historico)');
create function pg_temp.filas_ca() returns jsonb language sql as $$ select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(api.inventario_existencia() -> 'sabores') x where (x ->> 'modelo_id')::bigint = pg_temp.ca() $$;
select is(jsonb_array_length(pg_temp.filas_ca()), 1, 'H-A: inventario_existencia: una sola fila para CA Blade');
select is(pg_temp.filas_ca() -> 0 ->> 'sku_id', (select c from _h)::text, 'H-A: y es la de C');
select is((pg_temp.filas_ca() -> 0 ->> 'piezas')::int, 22, 'H-A: con 20 + 2 piezas (la devolucion no se pierde)');
create function pg_temp.base_ca() returns jsonb language sql as $$ select x -> 'sabores' from jsonb_array_elements(operacion.inventario_base() -> 'modelos') x where (x ->> 'modelo_id')::bigint = pg_temp.ca() $$;
select is(jsonb_array_length(pg_temp.base_ca()), 1, 'H-A: inventario_base: un solo renglon de sabor');
select is((pg_temp.base_ca() -> 0 ->> 'piezas')::int, 22, 'H-A: inventario_base: 22 piezas en C');
select is((pg_temp.base_ca() -> 0 ->> 'sku_id')::bigint, (select c from _h), 'H-A: inventario_base: es C');
select is((operacion.inventario_base() -> 'comprobacion' ->> 'piezas_sabores')::bigint, (operacion.inventario_base() -> 'comprobacion' ->> 'piezas_modelos')::bigint, 'H-A: inventario_base cuadra piezas por sabor = por modelo');
select is((operacion.inventario_base() -> 'comprobacion' ->> 'valor_sabores_cent')::bigint, (operacion.inventario_base() -> 'comprobacion' ->> 'valor_modelos_cent')::bigint, 'H-A: y valor');
select is((select count(*)::int from operacion.cobertura(negocio.hoy()) c where c.nivel = 'sku' and c.modelo_id = pg_temp.ca()), 1, 'H-A: cobertura: una sola fila de sku para CA Blade');
select is((select c.sku_id from operacion.cobertura(negocio.hoy()) c where c.nivel = 'sku' and c.modelo_id = pg_temp.ca()), (select c from _h), 'H-A: cobertura: es la de C');
select is((select c.fisico from operacion.cobertura(negocio.hoy()) c where c.nivel = 'sku' and c.modelo_id = pg_temp.ca()), 22, 'H-A: cobertura: fisico 22');
select is((select c.salidas from operacion.cobertura(negocio.hoy()) c where c.nivel = 'sku' and c.modelo_id = pg_temp.ca()), (select c.salidas from operacion.cobertura(negocio.hoy()) c where c.nivel = 'modelo' and c.modelo_id = pg_temp.ca()), 'H-A: cobertura: las salidas del sku suman las del modelo (nada suelto)');
select is((select (x ->> 'piezas')::int from jsonb_array_elements(api.inventario_existencia() -> 'modelos') x where (x ->> 'modelo_id')::bigint = pg_temp.ca()), 22, 'H-A: total del modelo 22');
select is(pg_temp.rojas(), null, 'tras la devolucion: C1..C24 sin rojos');

-- Reversa: fuera de orden se rechaza; en orden inverso restaura.
select throws_ok(format($q$select api.sabor_unificacion_deshacer('ca-d0', %s)$q$, (select id from catalogo.unificacion_sabor where clave_idem = 'ca-u1')), '22023', null, 'H-A: deshacer A->B mientras B ya esta en C se rechaza (orden inverso)');
select is(api.sabor_unificacion_deshacer('ca-d1', (select id from catalogo.unificacion_sabor where clave_idem = 'ca-u2')) ->> 'estado', 'deshecha', 'deshacer B -> C');
select is((select unificado_en from catalogo.sku where id = (select a from _h)), (select b from _h), 'H-A: a vuelve a apuntar a b');
select is((select unificado_en from catalogo.sabor where id = (select sa from _h)), (select sb from _h), 'H-A: el sabor A vuelve a apuntar a B');
select is((select activo from catalogo.sku where id = (select b from _h)), true, 'b vuelve a estar activo');
select is(api.sabor_unificacion_deshacer('ca-d2', (select id from catalogo.unificacion_sabor where clave_idem = 'ca-u1')) ->> 'estado', 'deshecha', 'deshacer A -> B');
select is(pg_temp.catalogo_estado(), (select ce from _h), 'H-A: el catalogo (sabores, sku, alias) es identico al de antes de la cadena');
select is((select count(*)::int from jsonb_array_elements(pg_temp.filas_ca()) x where (x ->> 'piezas')::int <> 0), 2, 'tras deshacer, las 22 piezas se ven en c (20) y a (2), cada una en su sku');
select is(pg_temp.rojas(), null, 'tras deshacer: C1..C24 sin rojos');

-- H-C: tablero de Karen con variantes sinteticas que apuntan a los DOS nombres del sabor Passion de US Blade, ya unificado.
select is(catalogo.unificar_sabor('hc-u', pg_temp.sab('Passionfruit'), pg_temp.sab('Passion Fruit'), 'importacion', null, null, 'dueno-2026-11-14-passion-fruit') ->> 'estado', 'unificado', 'Passionfruit -> Passion Fruit (para el tablero)');
select proveedores.guardar_estado(jsonb_build_object(
  'version', 1, 'inicializado', true, 'tarjetasPromo', 0,
  'modelos', jsonb_build_object('900000000000000701', jsonb_build_object('id', '900000000000000701', 'handle', 'us-blade', 'titulo', 'US Blade', 'tituloNorm', 'us blade', 'aliasTitulos', '[]'::jsonb,
      'marca', 'US Marca', 'puffs', 50000, 'estado', 'activo', 'primeraVez', now() - interval '30 days', 'ultimaVez', now(), 'ausencias', 0, 'primeraAusencia', null, 'sinSabores', false,
      'nuevoSinCosto', false, 'mapeo', 'confirmado', 'canonicoId', pg_temp.blade()::text, 'gruposCandidatos', '[]'::jsonb)),
  'variantes', jsonb_build_object(
    '900000000000000801', jsonb_build_object('id', '900000000000000801', 'productoId', '900000000000000701', 'saborOriginal', 'Passionfruit', 'saborNorm', 'passionfruit', 'disponible', true, 'estado', 'activa', 'ausencias', 0,
      'primeraAusencia', null, 'mapeo', 'confirmado', 'saborCanonicoId', pg_temp.sab('Passionfruit')::text, 'cambios', '[]'::jsonb, 'inestableHasta', null, 'primeraVez', now(), 'ultimaVez', now()),
    '900000000000000802', jsonb_build_object('id', '900000000000000802', 'productoId', '900000000000000701', 'saborOriginal', 'Passion Fruit', 'saborNorm', 'passion fruit', 'disponible', true, 'estado', 'activa', 'ausencias', 0,
      'primeraAusencia', null, 'mapeo', 'confirmado', 'saborCanonicoId', pg_temp.sab('Passion Fruit')::text, 'cambios', '[]'::jsonb, 'inestableHasta', null, 'primeraVez', now(), 'ultimaVez', now())),
  'candidatos', '{}'::jsonb, 'retenida', null, 'promociones', '{}'::jsonb, 'cola', '[]'::jsonb, 'historialVariedad', '{}'::jsonb, 'variedad', '{}'::jsonb,
  'salud', jsonb_build_object('ultimaLecturaOk', now(), 'ultimoIntento', now(), 'fallosSeguidos', 0, 'bloqueada', false, 'incidente', null), 'lecturasProcesadas', '[]'::jsonb),
  '[]'::jsonb, 'hc:1');
create function pg_temp.tab() returns jsonb language sql as $$ select proveedores.tablero_karen() -> 'modelos' -> 0 $$;
create function pg_temp.vsab(p text, p_campo text) returns int language sql as $$ select (s ->> $2)::int from jsonb_array_elements(pg_temp.tab() -> 'sabores') s where s ->> 'sabor' = $1 $$;
create function pg_temp.piezas_pass() returns int language sql as $$ select coalesce(sum(u.piezas), 0)::int from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.blade() and s.nombre_canonico = 'Passion Fruit' $$;
select is(pg_temp.vsab('Passionfruit', 'ventas_60d'), 14, 'H-C: la variante Passionfruit ve las ventas de los dos nombres (10 + 4)');
select is(pg_temp.vsab('Passion Fruit', 'ventas_60d'), 14, 'H-C: la variante Passion Fruit ve las mismas 14');
select is(pg_temp.vsab('Passionfruit', 'existencia_propia'), pg_temp.piezas_pass(), 'H-C: existencia de Passionfruit = piezas del sabor unificado');
select is(pg_temp.vsab('Passion Fruit', 'existencia_propia'), pg_temp.piezas_pass(), 'H-C: existencia de Passion Fruit igual');
select is((pg_temp.tab() ->> 'ventas_60d')::int, 19, 'H-C: ventas del modelo 19 (10 + 4 + 5 de Kiwi), sin doble conteo');
select is((pg_temp.tab() ->> 'existencia_propia')::int, (select e.piezas from operacion.existencia_modelo e where e.modelo_id = pg_temp.blade()), 'H-C: existencia del modelo = existencia_modelo');
select is((pg_temp.tab() ->> 'cobertura_dias')::int, floor((pg_temp.tab() ->> 'existencia_propia')::numeric * 60 / 19)::int, 'H-C: cobertura del modelo coherente');
select is(jsonb_array_length(proveedores.existencia_propia()) > 0, true, 'existencia_propia de Karen se lee');
select is((select count(*)::int from jsonb_array_elements(proveedores.existencia_propia()) m, jsonb_array_elements_text(m -> 'sabores') s where m ->> 'nombre' = 'US Blade' and s like 'Passion%'), 1, 'H-C: existencia_propia lista un solo sabor Passion para US Blade');
select * from finish();
rollback;
