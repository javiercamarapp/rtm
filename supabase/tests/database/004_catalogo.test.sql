-- pgTAP: catalogo, clientes, costos y precios con vigencia (F1). Datos ILUSTRATIVOS; nada real.
begin;
select plan(28);

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cat.socio@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('21111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cat.socio@example.test');
select set_config('request.jwt.claim.sub', '21111111-1111-1111-1111-111111111111', true);

select is(catalogo.normalizar('  Waka  ÁNGEL-50K '), 'waka angel 50k', 'normalizar: minusculas, sin acentos, sin simbolos');
select is((select count(*)::int from catalogo.socio), 2, 'dos socios');
select is((select string_agg(nombre, ',' order by nombre) from catalogo.proveedor), 'Isaac,Karen', 'proveedores Isaac y Karen');
select is((select nombre from catalogo.ubicacion where codigo = 'bodega_omar'), 'Bodega Omar', 'ubicacion Bodega Omar (nunca inventario de Omar)');
select is((select semana_reporte_ini from catalogo.dim_fecha where fecha = '2026-11-10'), '2026-11-09'::date, 'dim_fecha: martes 10 -> semana desde el lunes 9');

-- Permisos: sin rol no se escribe.
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select catalogo.asegurar_marca('Marca Prueba')$$, '42501', null, 'sin sesion no se escribe');
select set_config('request.jwt.claim.sub', '21111111-1111-1111-1111-111111111111', true);
select set_config('rtm.canal', 'importacion', true);

select lives_ok($$select catalogo.asegurar_modelo('Marca Prueba', 'Marca Prueba Uno 50K', 50000, 'angelo')$$, 'crea modelo');
select is(catalogo.asegurar_modelo('Marca Prueba', 'marca  prueba UNO 50k', 50000, 'javier'), (select id from catalogo.modelo where nombre_canonico = 'Marca Prueba Uno 50K'), 'nombre identico tras normalizar = mismo modelo');
select is((select lista_origen from catalogo.modelo where nombre_canonico = 'Marca Prueba Uno 50K'), 'ambas', 'el modelo comun queda en ambas listas');
select lives_ok($$select catalogo.asegurar_modelo('Marca Prueba', 'Marca Prueba Dos 15K', 15000, 'javier')$$, 'otro modelo');
select lives_ok($$select catalogo.asegurar_modelo('Marca Prueba', 'Marca Prueba Tres 40K', 40000, 'angelo')$$, 'tercer modelo');
select is((select count(*)::int from catalogo.modelo where nombre_canonico like 'Marca Prueba%'), 3, 'nombres distintos = modelos distintos (sin equivalencias inventadas)');

-- Alias: ambiguo obliga a preguntar.
select catalogo.agregar_alias('a1', 'modelo', 'mp 50', array['Marca Prueba Uno 50K', 'Marca Prueba Tres 40K']);
select is(catalogo.resolver_modelo('MP 50')->>'tipo', 'ambiguo', 'alias de grupo = ambiguo');
select is(jsonb_array_length(catalogo.resolver_modelo('MP 50')->'ids'), 2, 'con dos candidatos');
select is(catalogo.resolver_modelo('marca prueba dos 15k')->>'tipo', 'directo', 'nombre canonico resuelve directo');
select is(catalogo.resolver_modelo('algo raro')->>'tipo', 'desconocido', 'desconocido');

-- Disponibilidad reversible; los precios se conservan.
select catalogo.asegurar_cliente('Cliente Prueba A', 'Angelo');
select catalogo.fijar_precio('p1', 'Cliente Prueba A', 'Marca Prueba Uno 50K', 25757, '2026-11-10', 'documento');
select catalogo.fijar_disponibilidad('d1', 'Marca Prueba Uno 50K', 'sin_disponibilidad');
select is((select estado from catalogo.modelo where nombre_canonico = 'Marca Prueba Uno 50K'), 'sin_disponibilidad', 'sin disponibilidad ahora');
select is((select count(*)::int from catalogo.tabulador_precio where precio_cent = 25757), 1, 'el tabulador se conserva');
select catalogo.fijar_disponibilidad('d2', 'Marca Prueba Uno 50K', 'disponible');
select is((select estado from catalogo.modelo where nombre_canonico = 'Marca Prueba Uno 50K'), 'disponible', 'vuelve a disponible');

-- Vigencia de costos: cierra la fila abierta; retroactivo rechazado; mismo dato = sin cambio; idempotencia.
select catalogo.fijar_costo('c1', 'Isaac', 'Marca Prueba Uno 50K', 23000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('c2', 'Isaac', 'Marca Prueba Uno 50K', 22000, '2026-11-10', 'prueba');
select is((select vigente_hasta from catalogo.costo_proveedor where costo_cent = 23000 and fuente = 'prueba'), '2026-11-10'::date, 'el costo anterior se cierra el dia que empieza el nuevo');
select throws_ok($$select catalogo.fijar_costo('c3', 'Isaac', 'Marca Prueba Uno 50K', 21000, '2026-11-05', 'prueba')$$, 'P0422', null, 'vigencia retroactiva rechazada');
select throws_ok($$select catalogo.fijar_costo('c4', 'Karen', 'Marca Prueba Uno 50K', 20000, '2026-11-10', 'prueba', null, false, false)$$, '23514', null, 'costo que no es de lista exige motivo');
select is(catalogo.fijar_costo('c2', 'Isaac', 'Marca Prueba Uno 50K', 22000, '2026-11-10', 'prueba'), catalogo.fijar_costo('c2', 'Isaac', 'Marca Prueba Uno 50K', 22000, '2026-11-10', 'prueba'), 'misma clave y payload = mismo resultado');
select throws_ok($$select catalogo.fijar_costo('c2', 'Isaac', 'Marca Prueba Uno 50K', 99999, '2026-11-10', 'prueba')$$, 'P0409', null, 'misma clave con otro payload = 409');

-- Karen = Vapemate: un solo proveedor, dos nombres.
select is((select count(*)::int from catalogo.proveedor), 2, 'solo dos proveedores (Vapemate no es un tercero)');
select is(catalogo.proveedor_id('Vapemate'), catalogo.proveedor_id('Karen'), 'Vapemate resuelve a Karen');
select is(catalogo.proveedor_id('Mr Cactus'), null::bigint, 'Mr Cactus NO es alias de Karen: no resuelve (se pregunta)');
select catalogo.fijar_costo('k1', 'Vapemate', 'Marca Prueba Dos 15K', 15000, '2026-11-10', 'prueba', null, true);
select is((select p.nombre from catalogo.costo_proveedor c join catalogo.proveedor p on p.id = c.proveedor_id where c.costo_cent = 15000 and c.fuente = 'prueba'), 'Karen', 'un costo dado como Vapemate queda en la cuenta de Karen');

select * from finish();
rollback;
