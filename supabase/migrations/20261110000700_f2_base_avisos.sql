-- F2 / 0007: base comun de la fase.
--  * `operacion.evento.canal` y `seguridad.canal_actual()` admiten `sistema` (caducidades, latido y scraper son actores del sistema; hallazgo H6 de 25c).
--  * cuentas de dinero, libros auxiliares solo de insercion: cuenta con cada proveedor, deuda de los socios con la sociedad, aportaciones y
--    partidas fuera de la sociedad.
--  * nucleo de avisos: tabla `operacion.aviso` y la funcion de emision `operacion.avisar()`, que se llama DENTRO de la transaccion del hecho de negocio.
--    En F2 los avisos se muestran solo en el software (sin Telegram ni correo).
-- Convencion de signos de los libros:
--   cuenta_proveedor_mov.monto_cent  > 0 saldo a favor de la sociedad con el proveedor; < 0 la sociedad le debe.
--   cuenta_socio_mov.monto_cent      > 0 el socio debe a la sociedad (fondos de la sociedad en su poder, faltantes asignados); < 0 baja o la sociedad le debe.

-- ---------------------------------------------------------------------------
-- Canal `sistema`
-- ---------------------------------------------------------------------------
alter table operacion.evento drop constraint evento_canal_check;
alter table operacion.evento add constraint evento_canal_check check (canal in ('web', 'telegram', 'importacion', 'sistema'));

create or replace function seguridad.canal_actual() returns text
language sql stable set search_path = ''
as $$
  select case when session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then 'importacion'
              when session_user = 'postgres' and current_setting('rtm.canal', true) = 'sistema' then 'sistema'
              else 'web' end
$$;

create or replace function seguridad.exigir_rol(p_roles text[]) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text := seguridad.rol_actual();
begin
  if v_rol is not null and v_rol = any (p_roles) then return; end if;
  -- El importador y el sistema corren en la Mac, conectados como postgres y declarando su canal. Nadie de la web llega a estas ramas.
  if 'importacion' = any (p_roles) and session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then return; end if;
  if 'sistema' = any (p_roles) and session_user = 'postgres' and current_setting('rtm.canal', true) = 'sistema' then return; end if;
  raise exception 'permiso denegado' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Parametros de F2 (con vigencia; los fija el dueno)
-- ---------------------------------------------------------------------------
insert into catalogo.config (clave, valor, vigente_desde) values
  ('envio_default_cent', '30000', '2026-11-10'),
  ('seguro_reenvio_cent', '500', '2026-11-10'),
  ('omar_toma_caduca_horas', '72', '2026-11-10'),
  ('omar_tope_toma_piezas', '15', '2026-11-10'),
  ('renta_aplica_directo', 'false', '2026-11-10'),
  ('paquete_horas_sin_empacar', '24', '2026-11-10');

create function catalogo.config_valor(p_clave text, p_fecha date default null) returns jsonb
language sql stable set search_path = ''
as $$
  select c.valor from catalogo.config c
  where c.clave = p_clave and c.vigente_desde <= coalesce(p_fecha, negocio.hoy()) and (c.vigente_hasta is null or coalesce(p_fecha, negocio.hoy()) < c.vigente_hasta)
$$;

create function catalogo.costo_vigente(p_proveedor bigint, p_modelo bigint, p_fecha date default null) returns bigint
language sql stable set search_path = ''
as $$
  select c.costo_cent from catalogo.costo_proveedor c
  where c.proveedor_id = p_proveedor and c.modelo_id = p_modelo and c.vigente_desde <= coalesce(p_fecha, negocio.hoy())
    and (c.vigente_hasta is null or coalesce(p_fecha, negocio.hoy()) < c.vigente_hasta)
$$;

create function catalogo.precio_vigente(p_cliente bigint, p_modelo bigint, p_fecha date default null) returns bigint
language sql stable set search_path = ''
as $$
  select t.precio_cent from catalogo.tabulador_precio t
  where t.cliente_id = p_cliente and t.modelo_id = p_modelo and t.vigente_desde <= coalesce(p_fecha, negocio.hoy())
    and (t.vigente_hasta is null or coalesce(p_fecha, negocio.hoy()) < t.vigente_hasta)
$$;

-- ---------------------------------------------------------------------------
-- Cuentas de dinero: destino de un pago de cliente o origen de un pago a proveedor.
-- ---------------------------------------------------------------------------
create table operacion.cuenta_dinero (
  id bigint generated always as identity primary key,
  nombre text not null unique check (nombre in ('Isaac', 'Karen', 'Angelo', 'Javier', 'Efectivo')),
  titular_tipo text not null check (titular_tipo in ('proveedor', 'socio', 'efectivo')),
  proveedor_id bigint references catalogo.proveedor (id),
  socio_id bigint references catalogo.socio (id),
  check ((titular_tipo = 'proveedor') = (proveedor_id is not null) and (titular_tipo = 'socio') = (socio_id is not null))
);
insert into operacion.cuenta_dinero (nombre, titular_tipo, proveedor_id, socio_id)
  select p.nombre, 'proveedor', p.id, null from catalogo.proveedor p
  union all select s.nombre, 'socio', null, s.id from catalogo.socio s
  union all select 'Efectivo', 'efectivo', null, null;

-- ---------------------------------------------------------------------------
-- Libros auxiliares [AO]. Los hechos de negocio apuntan a un evento; nada se edita: se reversa con un renglon contrario enlazado.
-- ---------------------------------------------------------------------------
create table operacion.cuenta_proveedor_mov (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references catalogo.proveedor (id),
  fecha_neg date not null,
  hora timestamptz not null default now(),
  concepto text not null check (concepto in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad', 'oc_aplicada', 'ajuste', 'reclamo_diferencia', 'reversa')),
  monto_cent bigint not null check (monto_cent <> 0),
  compra_id bigint,
  pago_id bigint,
  cliente_id bigint references catalogo.cliente (id),
  pedido_id bigint,
  cuenta_origen_id bigint references operacion.cuenta_dinero (id),
  socio_id bigint references catalogo.socio (id),
  diferencia_id bigint,
  nota text,
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint references operacion.cuenta_proveedor_mov (id),
  check ((concepto = 'reversa') = (reversa_de is not null))
);
create index cuenta_proveedor_mov_prov_idx on operacion.cuenta_proveedor_mov (proveedor_id, id);
create unique index cuenta_proveedor_mov_una_reversa on operacion.cuenta_proveedor_mov (reversa_de) where reversa_de is not null;

create table operacion.cuenta_socio_mov (
  id bigint generated always as identity primary key,
  socio_id bigint not null references catalogo.socio (id),
  fecha_neg date not null,
  hora timestamptz not null default now(),
  concepto text not null check (concepto in ('fondos_en_poder', 'diferencia_recepcion', 'entrega_a_sociedad', 'entrega_a_proveedor', 'traspaso_entre_socios', 'reversa')),
  aplica_a text not null default 'general' check (aplica_a in ('fondos', 'diferencia', 'general')),
  monto_cent bigint not null check (monto_cent <> 0),
  pago_id bigint,
  diferencia_id bigint,
  proveedor_id bigint references catalogo.proveedor (id),
  cliente_id bigint references catalogo.cliente (id),
  nota text,
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint references operacion.cuenta_socio_mov (id),
  check ((concepto = 'reversa') = (reversa_de is not null))
);
create index cuenta_socio_mov_socio_idx on operacion.cuenta_socio_mov (socio_id, id);
create unique index cuenta_socio_mov_una_reversa on operacion.cuenta_socio_mov (reversa_de) where reversa_de is not null;

create table operacion.aportacion_socio (
  id bigint generated always as identity primary key,
  socio_id bigint not null references catalogo.socio (id),
  monto_cent bigint not null check (monto_cent > 0),
  concepto text not null,
  clasificacion text not null default 'capital' check (clasificacion in ('capital', 'reembolsable')),
  fecha_neg date not null,
  ref_tipo text,
  ref_id bigint,
  evento_id bigint not null references operacion.evento (id)
);

-- Lo que un socio pago de mas a un proveedor y NO entra al balance de la sociedad (los $1,440 de la compra inicial).
create table operacion.partida_fuera_sociedad (
  id bigint generated always as identity primary key,
  socio_id bigint not null references catalogo.socio (id),
  proveedor_id bigint not null references catalogo.proveedor (id),
  concepto text not null,
  piezas int,
  monto_cent bigint not null check (monto_cent > 0),
  fecha_neg date not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'aplicada_a_sociedad', 'reembolsada', 'condonada')),
  compra_id bigint,
  evento_id bigint not null references operacion.evento (id)
);

-- ---------------------------------------------------------------------------
-- Avisos (nucleo). El asunto vive en la base en la misma transaccion que el hecho; el texto se rinde al leer con las cifras de hoy.
-- ---------------------------------------------------------------------------
create table operacion.aviso (
  id bigint generated always as identity primary key,
  codigo text not null,
  nt text not null,
  clave_dedupe text not null unique,
  severidad text not null check (severidad in ('C', 'I', 'F')),
  titulo text not null,
  entidad_tipo text,
  entidad_id bigint,
  payload jsonb not null default '{}'::jsonb,
  duenio_socio_id bigint references catalogo.socio (id),
  actor_socio_id bigint references catalogo.socio (id),
  solo_otro boolean not null default false,
  canales_previstos text[] not null default array['software'],
  estado text not null default 'abierta' check (estado in ('abierta', 'resuelta', 'descartada', 'caducada')),
  conteo int not null default 1,
  evento_id bigint references operacion.evento (id),
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  caduca_at timestamptz,
  resuelto_at timestamptz,
  resuelto_por uuid
);
create index aviso_estado_idx on operacion.aviso (estado, id desc);
create index aviso_entidad_idx on operacion.aviso (entidad_tipo, entidad_id);

create table operacion.aviso_lectura (
  aviso_id bigint not null references operacion.aviso (id),
  usuario_id uuid not null,
  leida_at timestamptz not null default now(),
  primary key (aviso_id, usuario_id)
);

-- Socio que actua (por la sesion); null en canal importacion o sistema.
create function operacion.actor_socio() returns bigint
language sql stable security definer set search_path = ''
as $$
  select s.id from seguridad.usuario u join catalogo.socio s on s.nombre = u.socio_nombre
  where u.id = auth.uid()
$$;

-- Emision idempotente: misma clave => solo sube el conteo (un asunto recurrente no se duplica). Nunca se llama desde la web: solo desde
-- las funciones de negocio, dentro de su transaccion (si el hecho se revierte, el aviso tambien).
create function operacion.avisar(p_codigo text, p_nt text, p_clave text, p_severidad text, p_titulo text, p_entidad_tipo text, p_entidad_id bigint,
                                 p_payload jsonb default '{}'::jsonb, p_duenio_socio_id bigint default null, p_evento_id bigint default null,
                                 p_solo_otro boolean default false, p_canales text[] default array['software']) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_caduca timestamptz;
begin
  v_caduca := case p_severidad when 'F' then now() + interval '7 days' when 'I' then now() + interval '30 days' else null end;
  insert into operacion.aviso (codigo, nt, clave_dedupe, severidad, titulo, entidad_tipo, entidad_id, payload, duenio_socio_id, actor_socio_id, solo_otro, canales_previstos, evento_id, caduca_at)
  values (p_codigo, p_nt, p_clave, p_severidad, p_titulo, p_entidad_tipo, p_entidad_id, p_payload, p_duenio_socio_id, operacion.actor_socio(), p_solo_otro, p_canales, p_evento_id, v_caduca)
  on conflict (clave_dedupe) do update set conteo = operacion.aviso.conteo + 1, actualizado_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Cuando la condicion cesa el asunto se resuelve solo (leido y resuelto son estados distintos).
create function operacion.resolver_avisos(p_codigo text, p_entidad_tipo text, p_entidad_id bigint) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update operacion.aviso set estado = 'resuelta', resuelto_at = now(), actualizado_at = now(),
         resuelto_por = auth.uid()
   where codigo = p_codigo and entidad_tipo = p_entidad_tipo and entidad_id = p_entidad_id and estado = 'abierta';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- T1 y RLS forzada sin politicas ni privilegios (todo acceso por funciones SECURITY DEFINER).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cuenta_proveedor_mov', 'cuenta_socio_mov', 'aportacion_socio', 'partida_fuera_sociedad'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    -- Una llave foranea exige UPDATE al duenio (FOR KEY SHARE): en las tablas que se referencian a si mismas lo bloquea el trigger T1.
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
  end loop;
  -- UPDATE se conserva para el duenio: una llave foranea lo exige al borrar el padre (FOR KEY SHARE); el trigger T1 lo bloquea de todos modos.
  -- La partida fuera de la sociedad cambia de estado (se aplica, se reembolsa o se condona): [ME] controlada por funcion.
  drop trigger partida_fuera_sociedad_t1 on operacion.partida_fuera_sociedad;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'operacion' and c.relkind = 'r' loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema operacion, catalogo from public, anon, authenticated;
