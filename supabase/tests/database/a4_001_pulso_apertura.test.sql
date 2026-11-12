-- pgTAP del lote "cuadrar cuentas": el pulso del encabezado toma en cuenta la apertura firmada. Cifras ilustrativas: un cliente debe 7,500.00 de apertura; nada real.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4.ang@example.test', 'socio', 'Angelo', true), ('a4.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777b1' else '77777777-7777-7777-7777-7777777777b2' end, true) $$;
select pg_temp.como('Angelo');

select is(api.pulso() -> 'por_cobrar_cent', 'null'::jsonb, 'sin pedidos ni apertura, por cobrar es Sin dato');

select catalogo.asegurar_cliente('A4 Cliente', 'Javier');
create temp table _c as select id from catalogo.cliente where nombre_canonico = 'A4 Cliente';
create temp table _s as select (api.apertura_crear('a4:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a4:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 8461500}');
select api.apertura_agregar('a4:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 5600000}');
select api.apertura_agregar('a4:p3', (select id from _s), 'cxc', format('{"cliente_id": %s, "monto_cent": 750000, "fecha_ref": "%s"}', (select id from _c), negocio.hoy() - 15)::jsonb);
select is(api.pulso() -> 'por_cobrar_cent', 'null'::jsonb, 'una apertura en borrador todavia no cuenta');
select api.apertura_firmar('a4:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a4:f2', (select id from _s));

select is((api.pulso() ->> 'por_cobrar_cent')::bigint, 750000::bigint, 'con la apertura firmada, por cobrar suma su cuenta por cobrar inicial');
select is((api.pulso() ->> 'por_cobrar_cent')::bigint, (api.cuentas_por_cobrar() ->> 'total_cent')::bigint, 'el encabezado y la pantalla de Cuentas por cobrar dicen lo mismo');

select * from finish();
rollback;
