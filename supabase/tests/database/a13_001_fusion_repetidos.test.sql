-- pgTAP a13_001: fusion de REPETIDOS EXACTOS de marcas y modelos (y su deteccion en sabores), bloqueos, reversa, idempotencia y alta que bloquea.
-- Escenario espejo de lo que podria pasar en produccion: "FR Brand" y "FRBrand" (marca), "FR Blade 33K" y "FR Blade33K" (modelo, con historial y sku en comun y propios).
-- Prueba central: kardex, existencias, libro (hash encadenado), comprobaciones C1..C24 y totales son IDENTICOS antes y despues de unificar y de deshacer.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('fr.jav@example.test', 'socio', 'Javier', true), ('fr.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-7777777777a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fr.jav@example.test'),
  ('77777777-7777-7777-7777-7777777777a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fr.omar@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a1', true);

-- Datos. Marca repetida exacta "FRBrand" (con espacio faltante) con un modelo propio; modelo repetido exacto "FR Blade33K" bajo ella.
select catalogo.asegurar_cliente('FR Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('FR Omar Persona', 'FR Omar Persona');
select catalogo.asegurar_cliente('FR Villa', 'Javier');
select catalogo.asegurar_modelo('FR Brand', 'FR Blade 33K', 33000, 'ambas');
select catalogo.asegurar_modelo('FR Brand', 'FR Icon', 50000, 'ambas');
select catalogo.asegurar_modelo('FR Brand', 'FR Icon Pro', 50000, 'ambas');
insert into catalogo.marca (nombre) values ('FRBrand');
insert into catalogo.modelo (marca_id, nombre_canonico, puffs, lista_origen) values ((select id from catalogo.marca where nombre = 'FRBrand'), 'FR Blade33K', 33000, 'ambas');
select catalogo.asegurar_sku('FR Blade 33K', s) from unnest(array['Mango', 'Uva']) s;
select catalogo.asegurar_sku('FR Blade33K', s) from unnest(array['Mango', 'Fresa']) s;
select catalogo.asegurar_sku('FR Icon', 'Mango');
select catalogo.asegurar_sku('FR Icon Pro', 'Mango');
-- Sabores: un exacto (con espacio) y un par SOLO parecido que NUNCA debe unirse.
select catalogo.asegurar_sku('FR Icon', s) from unnest(array['FR Passion Fruit', 'FR Lychee', 'FR Lychee Ice']) s;
insert into catalogo.sabor (nombre_canonico) values ('FRPassionfruit');

select catalogo.fijar_costo('fr-k1', 'Isaac', 'FR Blade 33K', 23000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('fr-k3', 'Isaac', 'FR Icon', 23000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('fr-k4', 'Isaac', 'FR Icon Pro', 23000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('fr-k2', 'Isaac', 'FR Blade33K', 21000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('fr-p2', 'FR Villa', 'FR Blade33K', 25000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('fr-e1', 'FR Blade 33K', 'Mango', 'bodega_omar', 'entrada_compra', 10, 230000, '2026-11-08');
select operacion.registrar_movimiento('fr-e2', 'FR Blade33K', 'Mango', 'bodega_omar', 'entrada_compra', 4, 84000, '2026-11-08');
select operacion.registrar_movimiento('fr-e3', 'FR Blade33K', 'Fresa', 'bodega_omar', 'entrada_compra', 6, 126000, '2026-11-08');

create function pg_temp.mid(p text) returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = p $$;
create function pg_temp.maid(p text) returns bigint language sql as $$ select id from catalogo.marca where nombre = p $$;
create function pg_temp.rojas() returns text language sql as $$ select string_agg(c.codigo, ',' order by c.codigo) from contabilidad.comprobaciones() c where not c.ok and c.bloqueante $$;
create function pg_temp.huella() returns jsonb language sql as $$ select catalogo.huella_inmutables() $$;

select contabilidad.asentar_pendientes();
select is(pg_temp.rojas(), null, 'antes: ninguna comprobacion bloqueante en rojo');
create temp table _antes as select pg_temp.huella() as h;
grant all on _antes to public;

-- (1) Llave exacta y deteccion ---------------------------------------------------------------------------------------------------------------------
select is(catalogo.llave_exacta('Geek-Bar  2GO 50K'), 'geekbar2go50k', 'la llave ignora mayusculas, espacios, guiones y signos');
select is(catalogo.llave_exacta('Piña Colada'), 'pinacolada', 'y los acentos');
select isnt(catalogo.llave_exacta('Lychee'), catalogo.llave_exacta('Lychee Ice'), 'Lychee vs Lychee Ice NO tiene la misma llave');
select is((select count(*)::int from catalogo.duplicados_exactos() where tipo = 'marca' and llave = 'frbrand'), 1, 'marca repetida exacta detectada');
select is((select count(*)::int from catalogo.duplicados_exactos() where tipo = 'modelo' and llave = 'frblade33k'), 1, 'modelo repetido exacto detectado');
select is((select count(*)::int from catalogo.duplicados_exactos() where tipo = 'sabor' and llave = 'frpassionfruit'), 1, 'sabor repetido exacto detectado');
select is((select count(*)::int from catalogo.duplicados_exactos() where llave in ('frlychee', 'frlycheeice', 'fricon', 'friconpro')), 0, 'los solo PARECIDOS (Lychee / Lychee Ice, Icon / Icon Pro) no son exactos');
select is((select canonico from catalogo.duplicados_exactos() where tipo = 'modelo' and llave = 'frblade33k'), 'FR Blade33K', 'canonico del modelo: el de mas movimientos (3 contra 1); en empate el nombre mas largo y luego el id menor');

-- (2) Que no reaparezcan: el alta bloquea y pregunta ----------------------------------------------------------------------------------------------------
select is(catalogo.asegurar_marca('fr-brand'), pg_temp.maid('FR Brand'), 'un guion o una mayuscula distinta es el mismo nombre normalizado: resuelve a la marca existente');
select throws_ok($$select catalogo.asegurar_marca('F R Brand')$$, 'P0462', null, 'alta de marca repetida exacta (espacios): bloquea y pregunta');
select lives_ok($$select catalogo.asegurar_modelo('FR Brand', 'FR Icon Pro Max', 50000, 'ambas')$$, 'un modelo solo parecido NO esta bloqueado por exactos (la cola lo pregunta)');
select throws_ok($$select catalogo.asegurar_modelo('FR Brand', 'fr-blade 33 k', 33000, 'ambas')$$, 'P0462', null, 'alta de modelo repetido exacto: bloquea y pregunta');
select is(catalogo.asegurar_modelo('FR Brand', 'fr blade 33k', 33000, 'ambas'), pg_temp.mid('FR Blade 33K'), 'el nombre ya existente (solo cambia la mayuscula) resuelve al mismo modelo');
select is((select count(*)::int from catalogo.modelo where catalogo.llave_exacta(nombre_canonico) = 'frblade33k'), 2, 'no se creo ningun modelo nuevo');
select set_config('rtm.canal', 'importacion', true);
select throws_ok($$select catalogo.asegurar_sabor('F R Passionfruit')$$, 'P0462', null, 'importador: sabor repetido exacto bloquea y pregunta');
select is(catalogo.asegurar_sabor('FR Lychee Burst') > 0, true, 'importador: un sabor solo parecido se crea (la cola lo pregunta, no se bloquea)');
select set_config('rtm.canal', '', true);

-- (3) Solo exactos, y solo con aprobacion ---------------------------------------------------------------------------------------------------------
select throws_ok($$select catalogo.unificar_modelo('fr-x1', pg_temp.mid('FR Icon Pro'), pg_temp.mid('FR Icon'), 'web', null, 'regla-exactos-2026-11-14')$$, '42501', null, 'FR Icon Pro vs FR Icon: solo parecidos, NO se unen ni con la regla');
select throws_ok($$select catalogo.unificar_modelo('fr-x2', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'))$$, '42501', null, 'sin respuesta ni regla: no se une');
select throws_ok($$select catalogo.unificar_marca('fr-x3', pg_temp.maid('FRBrand'), pg_temp.maid('FR Brand'))$$, '42501', null, 'marca: sin respuesta ni regla: no se une');
select throws_ok($$select catalogo.unificar_modelo('fr-x4', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'cualquier-cosa')$$, '42501', null, 'una clave que no es la regla no sirve');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a2', true);
select throws_ok($$select catalogo.unificar_modelo('fr-x5', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14')$$, '42501', null, 'Omar no unifica');
select throws_ok($$select catalogo.duplicados_exactos()$$, '42501', null, 'Omar no ve los repetidos');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a1', true);

-- (4) Bloqueos: no escribe nada --------------------------------------------------------------------------------------------------------------------
create temp table _cat0 as select md5(string_agg(to_jsonb(m)::text, '|' order by m.id)) as m, (select md5(string_agg(to_jsonb(k)::text, '|' order by k.id)) from catalogo.sku k) as k from catalogo.modelo m;
grant all on _cat0 to public;
select is(catalogo.unificar_modelo('fr-b1', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') ->> 'estado', 'bloqueado', 'con existencia: bloqueado');
select ok((catalogo.unificar_modelo('fr-b1', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') -> 'bloqueos') ? 'tiene existencia', 'y dice por que: tiene existencia');
select is((select md5(string_agg(to_jsonb(m)::text, '|' order by m.id)) from catalogo.modelo m), (select m from _cat0), 'un bloqueo no escribe nada en el catalogo (modelos)');
select is((select md5(string_agg(to_jsonb(k)::text, '|' order by k.id)) from catalogo.sku k), (select k from _cat0), 'ni en los sku');
select is((select count(*)::int from seguridad.operacion where clave = 'fr-b1'), 0, 'ni deja la clave de idempotencia (se puede reintentar)');
-- se vacia el origen (merma) para pasar al siguiente bloqueo: el costo vigente que el destino no tiene
select operacion.registrar_movimiento('fr-m1', 'FR Blade33K', 'Mango', 'bodega_omar', 'merma', -4, null, '2026-11-09');
select operacion.registrar_movimiento('fr-m2', 'FR Blade33K', 'Fresa', 'bodega_omar', 'merma', -6, null, '2026-11-09');
select catalogo.fijar_costo('fr-k5', 'Karen', 'FR Blade33K', 20000, '2026-11-01', 'prueba');
select ok(catalogo.unificar_modelo('fr-b2', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') -> 'bloqueos' @> '["tiene un costo de lista vigente que el destino no tiene: fijalo primero en el destino"]'::jsonb, 'costo vigente de Karen que el destino no tiene: bloqueado (no se pierde la lista)');
select catalogo.fijar_costo('fr-k6', 'Karen', 'FR Blade 33K', 20000, '2026-11-01', 'prueba');
select ok(catalogo.unificar_modelo('fr-b3', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') -> 'bloqueos' @> '["tiene un precio de cliente vigente que el destino no tiene: fijalo primero en el destino"]'::jsonb, 'precio de cliente vigente que el destino no tiene: bloqueado');
select catalogo.fijar_precio('fr-p1', 'FR Villa', 'FR Blade 33K', 25000, '2026-11-01', 'chat');
select is(catalogo.unificacion_modelo_plan(pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K')) -> 'bloqueos', '[]'::jsonb, 'el plan ya no ve bloqueos');
select is((select string_agg(x ->> 'sabor' || ':' || (x ->> 'accion'), ',' order by x ->> 'sabor') from jsonb_array_elements(catalogo.unificacion_modelo_plan(pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K')) -> 'skus') x), 'Fresa:crea_en_destino,Mango:fusiona', 'plan: Mango se fusiona, Fresa se crea en el destino');

-- (5) Unificar modelo -------------------------------------------------------------------------------------------------------------------------------
select contabilidad.asentar_pendientes();
create temp table _huella as select pg_temp.huella() as h;
grant all on _huella to public;
select is(catalogo.unificar_modelo('fr-u1', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') ->> 'estado', 'unificado', 'modelo repetido exacto: unificado');
select is((select unificado_en from catalogo.modelo where nombre_canonico = 'FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'el origen apunta al canonico');
select ok((select nombre_norm like '~u%' and estado = 'sin_disponibilidad' from catalogo.modelo where nombre_canonico = 'FR Blade33K'), 'el origen libera su llave y queda sin disponibilidad');
select is((select count(*)::int from catalogo.sku where modelo_id = pg_temp.mid('FR Blade33K') and (activo or unificado_en is null)), 0, 'todos sus sku quedan inactivos y fusionados');
select is((select count(*)::int from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.mid('FR Blade 33K') and s.nombre_canonico = 'Fresa' and k.activo), 1, 'el destino ahora ofrece Fresa');
select is(catalogo.resolver_modelo('fr blade33k') -> 'ids', jsonb_build_array(pg_temp.mid('FR Blade 33K')), 'el nombre viejo resuelve al canonico');
select is(catalogo.asegurar_modelo('FR Brand', 'FR Blade33K', 33000, 'ambas'), pg_temp.mid('FR Blade 33K'), 'las altas con el nombre viejo caen en el canonico sin preguntar');
select ok(not (api.catalogo_modelos() @> jsonb_build_array(jsonb_build_object('nombre', 'FR Blade33K'))) and (api.catalogo_modelos() @> jsonb_build_array(jsonb_build_object('nombre', 'FR Blade 33K'))), 'el catalogo web ya solo ve el canonico');
select ok(not exists (select 1 from jsonb_array_elements(agente.catalogo_modelos()) x where x ->> 'nombre' = 'FR Blade33K'), 'ni el agente (listas del bot)') ;
select is(pg_temp.huella(), (select h from _huella), 'kardex, existencias, eventos, asientos, cadena, 1310 y comprobaciones IDENTICOS antes y despues');
select is(pg_temp.rojas(), null, 'ninguna comprobacion bloqueante en rojo');
select is((select count(*)::int from operacion.movimiento_inventario where modelo_id = pg_temp.mid('FR Blade33K')), 4, 'el kardex del origen sigue intacto (4 movimientos)');
select is((select estado from catalogo.posible_duplicado where tipo = 'modelo' and id_a = least(pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K')) and id_b = greatest(pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'))), 'unido', 'el par queda como unido en la cola');
select is((catalogo.unificar_modelo('fr-u1', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') ->> 'repetido')::boolean, true, 'misma clave: devuelve lo guardado');
select is(catalogo.unificar_modelo('fr-u2', pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'), 'web', null, 'regla-exactos-2026-11-14') ->> 'estado', 'ya_unificado', 'otra clave: ya unificado, sin cambios');
select is((select count(*)::int from catalogo.duplicados_exactos() where tipo = 'modelo'), 0, 'ya no queda ningun modelo repetido exacto');

-- (6) Deshacer --------------------------------------------------------------------------------------------------------------------------------------
select is(catalogo.deshacer_unificacion_catalogo('fr-d1', (select id from catalogo.unificacion_catalogo where clave_idem = 'fr-u1')) ->> 'estado', 'deshecha', 'se deshace');
select ok((select unificado_en is null and nombre_norm = 'fr blade33k' and estado = 'disponible' from catalogo.modelo where nombre_canonico = 'FR Blade33K'), 'el modelo vuelve con su nombre, llave y estado');
select is((select count(*)::int from catalogo.sku where modelo_id = pg_temp.mid('FR Blade33K') and activo and unificado_en is null), 2, 'sus sku vuelven activos');
select is((select count(*)::int from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.mid('FR Blade 33K') and s.nombre_canonico = 'Fresa' and k.unificado_en is null), 1, 'el sku vacio creado en el destino queda como entrada de catalogo (la base no deja borrarlo: kardex y conteos son inmutables)');
select is((select estado from catalogo.posible_duplicado where tipo = 'modelo' and id_a = least(pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K')) and id_b = greatest(pg_temp.mid('FR Blade33K'), pg_temp.mid('FR Blade 33K'))), 'pendiente', 'la pregunta vuelve a quedar pendiente');
select is(pg_temp.huella(), (select h from _huella), 'tras deshacer: la huella sigue identica');
select is(catalogo.deshacer_unificacion_catalogo('fr-d2', (select id from catalogo.unificacion_catalogo where clave_idem = 'fr-u1')) ->> 'estado', 'ya_deshecha', 'deshacer dos veces: sin efecto');
select is((select count(*)::int from catalogo.duplicados_exactos() where tipo = 'modelo'), 1, 'el modelo vuelve a figurar como repetido exacto');

-- (7) Unificar marca (modelos de la marca origen pasan al canonico) -----------------------------------------------------------------------------------
select is(catalogo.unificar_marca('fr-m-u1', pg_temp.maid('FRBrand'), pg_temp.maid('FR Brand'), 'web', null, 'regla-exactos-2026-11-14') ->> 'estado', 'unificado', 'marca repetida exacta: unificada');
select is((select marca_id from catalogo.modelo where nombre_canonico = 'FR Blade33K'), pg_temp.maid('FR Brand'), 'su modelo pasa a la marca canonica');
select ok((select unificado_en = pg_temp.maid('FR Brand') and nombre_norm like '~u%' from catalogo.marca where nombre = 'FRBrand'), 'la marca origen queda marcada y libera su llave');
select is(catalogo.asegurar_marca('frbrand'), pg_temp.maid('FR Brand'), 'el nombre viejo de la marca resuelve a la canonica');
select is(pg_temp.huella(), (select h from _huella), 'la marca no toca nada inmutable');
select is(catalogo.unificar_marca('fr-m-u2', pg_temp.maid('FRBrand'), pg_temp.maid('FR Brand'), 'web', null, 'regla-exactos-2026-11-14') ->> 'estado', 'ya_unificado', 'marca: repetirlo no cambia nada');
select is(catalogo.deshacer_unificacion_catalogo('fr-m-d1', (select id from catalogo.unificacion_catalogo where clave_idem = 'fr-m-u1')) ->> 'estado', 'deshecha', 'marca: se deshace');
select is((select marca_id from catalogo.modelo where nombre_canonico = 'FR Blade33K'), pg_temp.maid('FRBrand'), 'su modelo vuelve a su marca');

-- (8) Con la pregunta contestada tambien funciona, y el escaneo registra los exactos -------------------------------------------------------------------
select ok((catalogo.escanear_duplicados_exactos() ->> 'preguntas_nuevas')::int >= 1, 'el escaneo de exactos deja preguntas pendientes (marca y sabor; el modelo ya estaba)');
select is((catalogo.escanear_duplicados_exactos() ->> 'preguntas_nuevas')::int, 0, 'y es idempotente');
select is(catalogo.unificar_marca('fr-m-u3', pg_temp.maid('FRBrand'), pg_temp.maid('FR Brand'), 'web',
  (select id from catalogo.posible_duplicado where tipo = 'marca' and estado = 'pendiente' limit 1)) ->> 'estado', 'unificado', 'marca unificada con la respuesta de un socio a la pregunta');
select is((select estado from catalogo.posible_duplicado where tipo = 'marca' limit 1), 'unido', 'y la pregunta queda unida');

-- (9) Permisos -----------------------------------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'catalogo.unificar_modelo(text,bigint,bigint,text,bigint,text)', 'execute') and not has_function_privilege('authenticated', 'catalogo.unificar_modelo(text,bigint,bigint,text,bigint,text)', 'execute'), 'unificar_modelo no se expone');
select ok(not has_function_privilege('authenticated', 'catalogo.unificar_marca(text,bigint,bigint,text,bigint,text)', 'execute') and not has_function_privilege('authenticated', 'catalogo.duplicados_exactos()', 'execute'), 'ni unificar_marca ni duplicados_exactos');
select ok(not has_table_privilege('authenticated', 'catalogo.unificacion_catalogo', 'select'), 'la tabla de unificaciones no se lee directo');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', true);
select * from finish();
rollback;
