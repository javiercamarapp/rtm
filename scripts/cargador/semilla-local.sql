-- Semilla SOLO PARA UNA BASE LOCAL DE PRUEBA del cargador (datos sinteticos; correos example.test). Nunca se corre contra la nube.
--   psql "$DATABASE_URL" -f scripts/cargador/semilla-local.sql
-- Crea los dos socios y la persona de bodega como CLIENTE INTERNO "Bodega Merida (socios)" (tipo credito_interno: la bodega somos los socios; ver docs/rol-bodega.md). Prerequisitos del cargador.
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('carga.angelo@example.test', 'socio', 'Angelo', true), ('carga.javier@example.test', 'socio', 'Javier', true) on conflict do nothing;
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carga.angelo@example.test'),
  ('77777777-7777-7777-7777-7777777777a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carga.javier@example.test') on conflict do nothing;
begin;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a2', true);
select api.registrar_persona_bodega('semilla:bodega:p', (catalogo.asegurar_cliente('Bodega Merida (socios)', 'Javier', 'credito_interno'))::bigint);
commit;
-- Solo para poder entrar a la web local con la API de administracion de GoTrue (campos que GoTrue espera no nulos); no afecta al cargador.
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), created_at = coalesce(created_at, now()), updated_at = coalesce(updated_at, now()), encrypted_password = coalesce(encrypted_password, ''),
  is_super_admin = coalesce(is_super_admin, false), raw_app_meta_data = '{"provider":"email","providers":["email"]}', raw_user_meta_data = coalesce(raw_user_meta_data, '{}'),
  confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '', email_change_token_current = '', reauthentication_token = '', phone_change = '', phone_change_token = ''
  where email like '%@example.test';
