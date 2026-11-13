-- pgTAP a6_001: negocio.hoy() con fecha de carga (migracion 20261113600000). Datos sinteticos.
-- Sin la variable rtm.fecha_negocio todo sigue igual; con ella (conexion propietaria) las funciones que fechan con hoy() usan la fecha historica; nunca una fecha futura; texto invalido se ignora.
begin;
select no_plan();

select is(negocio.hoy(), negocio.fecha_neg(now()), 'sin variable: hoy() es la fecha real de negocio');
select set_config('rtm.fecha_negocio', '2026-10-15', true);
select is(negocio.hoy(), '2026-10-15'::date, 'con la variable (conexion propietaria): hoy() devuelve la fecha historica');
select set_config('rtm.fecha_negocio', '2999-01-01', true);
select is(negocio.hoy(), negocio.fecha_neg(now()), 'una fecha futura se topa con la fecha real');
select set_config('rtm.fecha_negocio', 'ayer', true);
select is(negocio.hoy(), negocio.fecha_neg(now()), 'un texto que no es AAAA-MM-DD se ignora');
select set_config('rtm.fecha_negocio', '', true);
select is(negocio.hoy(), negocio.fecha_neg(now()), 'variable vacia: fecha real');

-- Una funcion del sistema que fecha con hoy(): el evento queda en la fecha historica.
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('hoy.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-7777777777f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hoy.jav@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777f1', true);
select catalogo.asegurar_modelo('HOY Marca', 'HOY Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('HOY Modelo', 'Uva');
select catalogo.fijar_costo('hoy-c1', 'Isaac', 'HOY Modelo', 5000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('HOY Cliente', 'Javier');
select set_config('rtm.fecha_negocio', '2026-10-15', true);
select operacion.crear_pedido('hoy-p1', (select id from catalogo.cliente where nombre_canonico = 'HOY Cliente'), '[{"modelo":"HOY Modelo","sabor":"Uva","piezas":30,"precio_cent":9000}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2026-10-15');
select operacion.confirmar_pedido('hoy-p1-c', (select id from operacion.pedido order by id desc limit 1));
select is((select fecha_neg from operacion.evento where tipo = 'pedido_confirmado' order by id desc limit 1), '2026-10-15'::date, 'confirmar_pedido (sin parametro de fecha) usa la fecha historica');
select set_config('rtm.fecha_negocio', '', true);

select ok(not has_function_privilege('authenticated', 'negocio.hoy()', 'execute') and not has_function_privilege('anon', 'negocio.hoy()', 'execute'), 'los permisos no cambian: ni authenticated ni anon la ejecutan directamente');
select * from finish();
rollback;
