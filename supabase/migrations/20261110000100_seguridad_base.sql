-- F0 / 0001: esquema de seguridad, usuario y rol, auditoria encadenada, idempotencia, folios,
-- limite de intentos sobre Postgres (reemplaza Redis) y funciones de tiempo de negocio.
-- Reglas: dinero en centavos bigint; escritura solo por funciones SECURITY DEFINER con search_path vacio;
-- esquemas expuestos a la API: solo `api` y `omar`; todas las tablas con RLS forzada y sin privilegios para anon/authenticated.

create schema if not exists seguridad;
create schema if not exists negocio;
create schema if not exists api;
create schema if not exists omar;

revoke all on schema seguridad, negocio from public, anon, authenticated;
grant usage on schema api, omar to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tiempo de negocio: America/Merida es UTC-6 fijo. Nunca se calcula "hoy" con la fecha UTC.
-- ---------------------------------------------------------------------------
create function negocio.fecha_neg(p_instante timestamptz) returns date
language sql immutable parallel safe set search_path = ''
as $$ select ((p_instante at time zone 'UTC') - interval '6 hours')::date $$;

create function negocio.hoy() returns date
language sql stable set search_path = ''
as $$ select negocio.fecha_neg(now()) $$;

create function negocio.ahora() returns timestamptz
language sql stable set search_path = ''
as $$ select now() $$;

-- Redondeo medio arriba sobre enteros (den > 0): floor((2*num + den) / (2*den)). Misma regla que el modulo TypeScript.
create function negocio.redondear_medio_arriba(p_num bigint, p_den bigint) returns bigint
language plpgsql immutable parallel safe set search_path = ''
as $$
declare a bigint; b bigint; q bigint;
begin
  if p_den is null or p_den <= 0 then raise exception 'denominador invalido' using errcode = '22012'; end if;
  a := 2 * p_num + p_den;
  b := 2 * p_den;
  q := a / b;
  if a < 0 and a % b <> 0 then q := q - 1; end if;
  return q;
end $$;

-- ---------------------------------------------------------------------------
-- T1: tablas de solo insercion (sin UPDATE, DELETE ni TRUNCATE).
-- ---------------------------------------------------------------------------
create function seguridad.t1_solo_insercion() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'tabla de solo insercion: % no admite %', tg_table_name, tg_op using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Lista de correos permitidos y usuario. El rol sale de aqui, nunca de user_metadata.
-- El texto del correo se guarda exacto (en minusculas: GoTrue normaliza asi). Gmail con puntos es otra cuenta.
-- ---------------------------------------------------------------------------
create table seguridad.correo_permitido (
  correo text primary key check (correo = lower(correo) and correo ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  rol text not null check (rol in ('socio', 'omar')),
  socio_nombre text check (socio_nombre in ('Angelo', 'Javier')),
  activo boolean not null default false,
  creado_en timestamptz not null default now(),
  check ((rol = 'socio') = (socio_nombre is not null))
);

create table seguridad.usuario (
  id uuid primary key references auth.users (id) on delete restrict,
  rol text not null check (rol in ('socio', 'omar')),
  socio_nombre text check (socio_nombre in ('Angelo', 'Javier')),
  activo boolean not null default false,
  check ((rol = 'socio') = (socio_nombre is not null))
);

create table seguridad.limite_intento (
  clave text not null check (clave ~ '^[a-z]{2,16}:[0-9A-Za-z]{8,64}$'),
  ventana_ini timestamptz not null,
  intentos int not null check (intentos > 0),
  primary key (clave, ventana_ini)
);

create table seguridad.auditoria (
  id bigserial primary key,
  ocurrio_en timestamptz not null default now(),
  actor uuid,
  canal text not null default 'web' check (canal in ('web', 'telegram', 'importacion', 'sistema')),
  tabla text not null,
  accion text not null,
  registro_id text,
  antes jsonb,
  despues jsonb,
  hash_anterior bytea,
  hash bytea not null
);

create table seguridad.operacion (
  clave text primary key,
  hash_payload bytea not null,
  resultado jsonb,
  creado_en timestamptz not null default now()
);

create table seguridad.contador_folio (
  serie text primary key check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E')),
  ultimo bigint not null default 0 check (ultimo >= 0)
);
insert into seguridad.contador_folio (serie) values ('P'), ('PG'), ('C'), ('G'), ('L'), ('T'), ('E');

create table seguridad.interruptor (
  clave text primary key,
  activo boolean not null default false
);

-- RLS forzada en todas, sin politicas: solo las funciones SECURITY DEFINER las tocan.
do $$
declare t text;
begin
  foreach t in array array['correo_permitido', 'usuario', 'limite_intento', 'auditoria', 'operacion', 'contador_folio', 'interruptor'] loop
    execute format('alter table seguridad.%I enable row level security', t);
    execute format('alter table seguridad.%I force row level security', t);
    execute format('revoke all on seguridad.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema seguridad from public, anon, authenticated;

-- Auditoria [AO]: T1 + sin privilegios de modificacion para nadie.
create trigger auditoria_t1 before update or delete on seguridad.auditoria
  for each row execute function seguridad.t1_solo_insercion();
create trigger auditoria_t1_truncate before truncate on seguridad.auditoria
  for each statement execute function seguridad.t1_solo_insercion();
revoke update, delete, truncate on seguridad.auditoria from postgres;

-- Cadena de hash: hash = sha256(hash_anterior || fila canonica).
create function seguridad.hash_fila_auditoria(p_anterior bytea, p_en timestamptz, p_actor uuid, p_canal text, p_tabla text, p_accion text, p_registro text, p_antes jsonb, p_despues jsonb)
returns bytea language sql immutable set search_path = ''
as $$
  select sha256(coalesce(p_anterior, '\x'::bytea) || convert_to(
    concat_ws('|', to_char(p_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_actor::text, ''), p_canal, p_tabla, p_accion,
              coalesce(p_registro, ''), coalesce(p_antes::text, ''), coalesce(p_despues::text, '')), 'UTF8'))
$$;

create function seguridad.t6_auditoria_hash() returns trigger
language plpgsql set search_path = ''
as $$
declare v_ant bytea;
begin
  perform pg_advisory_xact_lock(hashtextextended('seguridad.auditoria', 0));
  select a.hash into v_ant from seguridad.auditoria a order by a.id desc limit 1;
  new.hash_anterior := v_ant;
  new.hash := seguridad.hash_fila_auditoria(v_ant, new.ocurrio_en, new.actor, new.canal, new.tabla, new.accion, new.registro_id, new.antes, new.despues);
  return new;
end $$;
create trigger auditoria_hash before insert on seguridad.auditoria
  for each row execute function seguridad.t6_auditoria_hash();

create function seguridad.registrar_auditoria(p_tabla text, p_accion text, p_registro text, p_antes jsonb, p_despues jsonb, p_canal text default 'web')
returns void language sql set search_path = ''
as $$
  insert into seguridad.auditoria (actor, canal, tabla, accion, registro_id, antes, despues)
  values (auth.uid(), p_canal, p_tabla, p_accion, p_registro, p_antes, p_despues)
$$;

create function seguridad.verificar_cadena_auditoria() returns boolean
language plpgsql stable set search_path = ''
as $$
declare r record; v_prev bytea := null; v_esperado bytea;
begin
  for r in select * from seguridad.auditoria order by id loop
    if r.hash_anterior is distinct from v_prev then return false; end if;
    v_esperado := seguridad.hash_fila_auditoria(v_prev, r.ocurrio_en, r.actor, r.canal, r.tabla, r.accion, r.registro_id, r.antes, r.despues);
    if r.hash <> v_esperado then return false; end if;
    v_prev := r.hash;
  end loop;
  return true;
end $$;

-- Cambios de usuario: se auditan.
create function seguridad.auditar_usuario() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.registrar_auditoria('seguridad.usuario', tg_op, coalesce(new.id, old.id)::text,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end, to_jsonb(new), 'sistema');
  return new;
end $$;
create trigger usuario_auditoria after insert or update on seguridad.usuario
  for each row execute function seguridad.auditar_usuario();

-- ---------------------------------------------------------------------------
-- Registro cerrado EN EL SERVIDOR: auth.users solo admite correos de la lista de permitidos.
-- (defensa adicional a enable_signup = false en la configuracion de Auth)
-- ---------------------------------------------------------------------------
create function seguridad.t_auth_solo_permitidos() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is null or not exists (select 1 from seguridad.correo_permitido c where c.correo = lower(new.email)) then
    raise exception 'registro cerrado: correo no permitido' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger auth_users_solo_permitidos before insert on auth.users
  for each row execute function seguridad.t_auth_solo_permitidos();

create function seguridad.t_auth_crear_usuario() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into seguridad.usuario (id, rol, socio_nombre, activo)
  select new.id, c.rol, c.socio_nombre, c.activo from seguridad.correo_permitido c where c.correo = lower(new.email)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger auth_users_crear_usuario after insert on auth.users
  for each row execute function seguridad.t_auth_crear_usuario();

-- ---------------------------------------------------------------------------
-- Rol y permisos.
-- ---------------------------------------------------------------------------
create function seguridad.rol_actual() returns text
language sql stable security definer set search_path = ''
as $$ select u.rol from seguridad.usuario u where u.id = auth.uid() and u.activo $$;

create function seguridad.exigir_rol(p_roles text[]) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text := seguridad.rol_actual();
begin
  if v_rol is null or not (v_rol = any (p_roles)) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
end $$;

-- Sesion propia: lo unico que la web lee de seguridad.usuario.
create function api.mi_sesion() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('rol', u.rol, 'socio_nombre', u.socio_nombre, 'activo', u.activo)
  from seguridad.usuario u where u.id = auth.uid()
$$;

-- Limite de intentos (reemplaza Redis). Ventanas fijas; upsert atomico; devuelve el conteo de la ventana actual.
create function seguridad.registrar_intento_login(p_clave text, p_ventana_seg int default 300) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_ini timestamptz; v_n int;
begin
  if p_ventana_seg is null or p_ventana_seg < 1 or p_ventana_seg > 86400 then
    raise exception 'ventana invalida' using errcode = '22023';
  end if;
  v_ini := to_timestamp(floor(extract(epoch from now()) / p_ventana_seg) * p_ventana_seg);
  insert into seguridad.limite_intento as l (clave, ventana_ini, intentos) values (p_clave, v_ini, 1)
  on conflict (clave, ventana_ini) do update set intentos = l.intentos + 1
  returning l.intentos into v_n;
  if random() < 0.02 then
    delete from seguridad.limite_intento where ventana_ini < now() - interval '1 day';
  end if;
  return v_n;
end $$;

create function api.registrar_intento_login(p_clave text, p_ventana_seg int default 300) returns int
language sql security definer set search_path = ''
as $$ select seguridad.registrar_intento_login(p_clave, p_ventana_seg) $$;

-- Idempotencia: misma clave + mismo payload devuelve lo guardado; distinto payload = error 409.
create function seguridad.iniciar_operacion(p_clave text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_hash bytea := sha256(convert_to(coalesce(p_payload::text, ''), 'UTF8')); r seguridad.operacion;
begin
  insert into seguridad.operacion (clave, hash_payload) values (p_clave, v_hash) on conflict (clave) do nothing;
  select * into r from seguridad.operacion where clave = p_clave;
  if r.hash_payload <> v_hash then
    raise exception 'conflicto de idempotencia' using errcode = 'P0409';
  end if;
  return r.resultado;
end $$;

create function seguridad.terminar_operacion(p_clave text, p_resultado jsonb) returns void
language sql security definer set search_path = ''
as $$ update seguridad.operacion set resultado = p_resultado where clave = p_clave and resultado is null $$;

-- Folios sin huecos: el UPDATE vive en la transaccion del llamador; un rollback no consume folio.
create function seguridad.siguiente_folio(p_serie text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_n bigint;
begin
  update seguridad.contador_folio set ultimo = ultimo + 1 where serie = p_serie returning ultimo into v_n;
  if v_n is null then raise exception 'serie de folio desconocida: %', p_serie using errcode = '22023'; end if;
  return p_serie || '-' || lpad(v_n::text, 4, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios de funciones: nada para PUBLIC; solo lo que la web necesita.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema seguridad, negocio, api from public, anon, authenticated;
alter default privileges in schema seguridad, negocio, api revoke execute on functions from public, anon, authenticated;

grant usage on schema seguridad to supabase_auth_admin;
grant execute on function seguridad.t_auth_solo_permitidos(), seguridad.t_auth_crear_usuario() to supabase_auth_admin;
grant execute on function api.mi_sesion() to authenticated;
grant execute on function api.registrar_intento_login(text, int) to anon, authenticated;
