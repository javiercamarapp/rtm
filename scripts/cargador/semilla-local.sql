-- Semilla SOLO PARA UNA BASE LOCAL DE PRUEBA del cargador (datos sinteticos; correos example.test). Nunca se corre contra la nube.
--   psql "$DATABASE_URL" -f scripts/cargador/semilla-local.sql
-- Crea los dos socios (como los crea el alta de usuarios real) y la persona de bodega, que son prerequisitos del cargador.
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('carga.angelo@example.test', 'socio', 'Angelo', true), ('carga.javier@example.test', 'socio', 'Javier', true) on conflict do nothing;
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carga.angelo@example.test'),
  ('77777777-7777-7777-7777-7777777777a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carga.javier@example.test') on conflict do nothing;
begin;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a2', true);
select api.registrar_persona_bodega('semilla:bodega:p', (catalogo.asegurar_cliente('Persona Bodega Sintetica', 'Javier'))::bigint);
commit;
