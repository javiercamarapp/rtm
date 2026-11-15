-- pgTAP: alias Waka (semilla aditiva) y cola de fotos por confirmar. ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N904".
begin;
select no_plan();

select ok(not exists (select 1 from catalogo.modelo_alias a join catalogo.modelo m on m.nombre_norm = a.alias_norm where a.nota = 'semilla alias-waka 2026-11-14'),
  'ningun alias sembrado coincide con el nombre canonico de otro modelo (no se unifica nada)');
select ok(not exists (select 1 from catalogo.modelo_alias where nota = 'semilla alias-waka 2026-11-14' and alias_norm = catalogo.normalizar('Waka Optimus')), 'Waka Optimus no se siembra: pendiente de confirmar 80K contra 100K');

select has_table('proveedores', 'foto_pendiente', 'existe la cola de fotos');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'proveedores.foto_pendiente'::regclass), true, 'RLS activa y forzada');
select ok(not has_table_privilege('authenticated', 'proveedores.foto_pendiente', 'select'), 'nadie con sesion lee la tabla directo');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'proveedores' and table_name = 'foto_pendiente' and (column_name ilike '%precio%' or column_name ilike '%costo%' or column_name ilike '%cent%')), 'sin columnas de importe');

insert into auth.users (id, instance_id, aud, role, email) values ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n904.omar@example.test');
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n904.omar@example.test', 'omar', null, true);
select set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000001', true);
select throws_ok($$select api.prov_fotos_pendientes()$$, '42501', null, 'Omar no ve la cola de fotos');

select * from finish();
rollback;
