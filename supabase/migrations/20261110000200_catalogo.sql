-- F1 / 0002: catalogo, clientes, costos y precios con vigencia.
-- Reglas: dinero en centavos bigint; nada de acceso directo (RLS forzada, cero privilegios); toda escritura por funciones
-- SECURITY DEFINER con search_path vacio, exigir_rol en la primera linea y clave de idempotencia.
-- Decisiones del dueno (10-nov): "fuera de catalogo" = sin disponibilidad ahora (estado reversible, el modelo y sus
-- tabuladores se conservan); NO hay equivalencias entre las listas de Angelo y de Javier: el catalogo solo unifica nombres
-- identicos tras normalizar; lo demas son modelos distintos con su lista de origen.

create extension if not exists btree_gist with schema extensions;
create schema if not exists catalogo;
create schema if not exists operacion;
revoke all on schema catalogo, operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Canal de escritura: la web (rol socio) o el importador local (postgres + bandera de sesion rtm.canal).
-- ---------------------------------------------------------------------------
create or replace function seguridad.exigir_rol(p_roles text[]) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text := seguridad.rol_actual();
begin
  if v_rol is not null and v_rol = any (p_roles) then return; end if;
  -- El importador corre en la Mac, conectado como postgres y declarando su canal. Nadie de la web llega a esta rama.
  if 'importacion' = any (p_roles) and session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then return; end if;
  raise exception 'permiso denegado' using errcode = '42501';
end $$;

create function seguridad.canal_actual() returns text
language sql stable set search_path = ''
as $$ select case when session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then 'importacion' else 'web' end $$;

-- Normalizacion unica (misma regla que src/dominio/catalogo/normalizar.ts): minusculas, sin acentos, solo letras y numeros.
create function catalogo.normalizar(p_texto text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select btrim(regexp_replace(translate(lower(coalesce(p_texto, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table catalogo.socio (
  id bigint generated always as identity primary key,
  nombre text not null unique check (nombre in ('Angelo', 'Javier')),
  participacion_ppm int not null default 500000 check (participacion_ppm between 0 and 1000000)
);
insert into catalogo.socio (nombre) values ('Angelo'), ('Javier');

create table catalogo.marca (
  id bigint generated always as identity primary key,
  nombre text not null,
  nombre_norm text generated always as (catalogo.normalizar(nombre)) stored unique
);

create table catalogo.modelo (
  id bigint generated always as identity primary key,
  marca_id bigint not null references catalogo.marca (id),
  nombre_canonico text not null,
  nombre_norm text generated always as (catalogo.normalizar(nombre_canonico)) stored,
  puffs int check (puffs is null or puffs > 0),
  -- Disponibilidad ahora (reversible). Un modelo "fuera de catalogo" solo esta sin disponibilidad: nunca se borra ni desactiva.
  estado text not null default 'disponible' check (estado in ('disponible', 'sin_disponibilidad')),
  estado_desde date not null default negocio.hoy(),
  -- Lista de la que vino el nombre. Un nombre identico en las dos listas es UN modelo (lista_origen 'ambas').
  lista_origen text not null check (lista_origen in ('angelo', 'javier', 'ambas')),
  nota text,
  unique (marca_id, nombre_canonico),
  unique (nombre_norm)
);

create table catalogo.modelo_alias (
  id bigint generated always as identity primary key,
  alias_norm text not null unique check (alias_norm = catalogo.normalizar(alias_norm) and alias_norm <> ''),
  modelo_id bigint references catalogo.modelo (id),
  ambiguo boolean not null default false,
  candidatos bigint[],
  nota text,
  check ((ambiguo and modelo_id is null and cardinality(candidatos) >= 2) or (not ambiguo and modelo_id is not null and candidatos is null))
);

create table catalogo.sabor (
  id bigint generated always as identity primary key,
  nombre_canonico text not null,
  nombre_norm text generated always as (catalogo.normalizar(nombre_canonico)) stored unique
);
create table catalogo.sabor_alias (
  id bigint generated always as identity primary key,
  alias_norm text not null unique check (alias_norm = catalogo.normalizar(alias_norm) and alias_norm <> ''),
  sabor_id bigint not null references catalogo.sabor (id)
);

create table catalogo.sku (
  id bigint generated always as identity primary key,
  modelo_id bigint not null references catalogo.modelo (id),
  sabor_id bigint not null references catalogo.sabor (id),
  activo boolean not null default true,
  unique (modelo_id, sabor_id)
);

create table catalogo.proveedor (
  id bigint generated always as identity primary key,
  nombre text not null unique check (nombre in ('Isaac', 'Karen')),
  modalidad text not null check (modalidad in ('semanal_viernes', 'prepago_total'))
);
insert into catalogo.proveedor (nombre, modalidad) values ('Isaac', 'semanal_viernes'), ('Karen', 'prepago_total');

create table catalogo.costo_proveedor (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references catalogo.proveedor (id),
  modelo_id bigint not null references catalogo.modelo (id),
  costo_cent bigint not null check (costo_cent > 0),
  vigente_desde date not null,
  vigente_hasta date,
  fuente text not null,
  -- Lista = el costo normal del proveedor. Si no es el de lista, el motivo es obligatorio.
  es_lista boolean not null default true,
  motivo text,
  -- Dato dado de palabra por el dueno, aun sin documento: visible como "supuesto".
  supuesto boolean not null default false,
  creado_en timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta > vigente_desde),
  check (es_lista or nullif(btrim(motivo), '') is not null),
  exclude using gist (proveedor_id with =, modelo_id with =, daterange(vigente_desde, vigente_hasta) with &&)
);

create table catalogo.cliente (
  id bigint generated always as identity primary key,
  nombre_canonico text not null,
  nombre_norm text generated always as (catalogo.normalizar(nombre_canonico)) stored unique,
  tipo text not null default 'mayoreo' check (tipo in ('mayoreo', 'credito_interno', 'ocasional')),
  duenio_id bigint not null references catalogo.socio (id),
  activo boolean not null default true
  -- Sin telefono ni direccion: solo nombre y precios.
);

create table catalogo.cliente_alias (
  id bigint generated always as identity primary key,
  alias_norm text not null unique check (alias_norm = catalogo.normalizar(alias_norm) and alias_norm <> ''),
  cliente_id bigint references catalogo.cliente (id),
  ambiguo boolean not null default false,
  candidatos bigint[],
  por_confirmar boolean not null default false,
  nota text,
  check ((ambiguo and cliente_id is null and cardinality(candidatos) >= 2) or (not ambiguo and cliente_id is not null and candidatos is null))
);

create table catalogo.cliente_destino (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references catalogo.cliente (id),
  etiqueta text not null,
  zona text not null check (zona in ('merida', 'fuera')),
  unique (cliente_id, etiqueta)
);

-- Tabulador por cliente y modelo, con vigencia: el historial de precios son las filas cerradas.
-- El ultimo precio cobrado NO lo modifica: solo `fijar_precio` (cuando un socio lo indica).
create table catalogo.tabulador_precio (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references catalogo.cliente (id),
  modelo_id bigint not null references catalogo.modelo (id),
  precio_cent bigint not null check (precio_cent > 0),
  vigente_desde date not null,
  vigente_hasta date,
  origen text not null check (origen in ('documento', 'chat', 'lista_javier')),
  nota text,
  creado_en timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta > vigente_desde),
  exclude using gist (cliente_id with =, modelo_id with =, daterange(vigente_desde, vigente_hasta) with &&)
);

-- Precios que NO son el vigente (por ejemplo precios de un alias en conflicto): historial con su origen.
create table catalogo.precio_historico_externo (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references catalogo.cliente (id),
  modelo_id bigint not null references catalogo.modelo (id),
  precio_cent bigint not null check (precio_cent > 0),
  origen text not null,
  nota text,
  creado_en timestamptz not null default now()
);

create table catalogo.config (
  id bigint generated always as identity primary key,
  clave text not null,
  valor jsonb not null,
  vigente_desde date not null,
  vigente_hasta date,
  exclude using gist (clave with =, daterange(vigente_desde, vigente_hasta) with &&)
);
insert into catalogo.config (clave, valor, vigente_desde) values
  ('renta_por_pieza_cent', '200', '2026-11-10'),
  ('reparto_angelo_ppm', '500000', '2026-11-10'),
  ('omar_dia_corte', '"lunes"', '2026-11-10'),
  ('minimo_piezas_pedido', '20', '2026-11-10');

-- Omar Yacaman: UNA entidad, dos papeles (cliente de Javier y quien presta la bodega). Desactivado hasta M2.
create table catalogo.persona_bodega (
  id bigint generated always as identity primary key,
  cliente_id bigint not null unique references catalogo.cliente (id),
  nombre text not null
);

-- Ubicaciones de inventario. El inventario es de Angelo y Javier; nunca "inventario de Omar".
create table catalogo.ubicacion (
  codigo text primary key,
  nombre text not null unique,
  tipo text not null check (tipo in ('bodega', 'proveedor', 'transito', 'directo')),
  orden int not null
);
insert into catalogo.ubicacion (codigo, nombre, tipo, orden) values
  ('bodega_omar', 'Bodega Omar', 'bodega', 1),
  ('proveedor_isaac', 'Con Isaac', 'proveedor', 2),
  ('proveedor_karen', 'Con Karen', 'proveedor', 3),
  ('en_transito', 'En tránsito', 'transito', 4),
  ('directo', 'Directo', 'directo', 5);

create table catalogo.dim_fecha (
  fecha date primary key,
  dow int not null check (dow between 0 and 6),
  semana_reporte_ini date not null,
  semana_liq_ini date not null,
  mes date not null,
  es_festivo boolean not null default false
);
insert into catalogo.dim_fecha (fecha, dow, semana_reporte_ini, semana_liq_ini, mes)
select d::date, ((extract(isodow from d)::int) - 1), (d::date - ((extract(isodow from d)::int) - 1)), (d::date - ((extract(isodow from d)::int) - 1)), date_trunc('month', d)::date
from generate_series('2026-01-01'::date, '2030-12-31'::date, interval '1 day') d;

-- RLS forzada, sin politicas y sin privilegios: todo acceso es por funciones SECURITY DEFINER.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'catalogo' and c.relkind = 'r' loop
    execute format('alter table catalogo.%I enable row level security', t);
    execute format('alter table catalogo.%I force row level security', t);
    execute format('revoke all on catalogo.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema catalogo from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Escritura
-- ---------------------------------------------------------------------------
create function catalogo.asegurar_marca(p_nombre text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_id from catalogo.marca where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is null then insert into catalogo.marca (nombre) values (btrim(p_nombre)) returning id into v_id; end if;
  return v_id;
end $$;

-- Un nombre identico (normalizado) en la otra lista es el MISMO modelo: pasa a lista_origen 'ambas'. Nunca cambia la disponibilidad.
create function catalogo.asegurar_modelo(p_marca text, p_nombre text, p_puffs int, p_lista text, p_estado text default 'disponible', p_nota text default null)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_marca bigint; v_id bigint; v_lista text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id, lista_origen into v_id, v_lista from catalogo.modelo where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is not null then
    if v_lista <> p_lista and v_lista <> 'ambas' then update catalogo.modelo set lista_origen = 'ambas' where id = v_id; end if;
    return v_id;
  end if;
  v_marca := catalogo.asegurar_marca(p_marca);
  insert into catalogo.modelo (marca_id, nombre_canonico, puffs, lista_origen, estado, nota) values (v_marca, btrim(p_nombre), p_puffs, p_lista, p_estado, p_nota) returning id into v_id;
  return v_id;
end $$;

-- Disponibilidad reversible: sin_disponibilidad <-> disponible. No toca precios ni costos.
create function catalogo.fijar_disponibilidad(p_clave_idem text, p_modelo text, p_estado text, p_desde date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'fijar_disponibilidad', 'm', p_modelo, 'e', p_estado, 'd', p_desde));
  if v_prev is not null then return v_prev; end if;
  if p_estado not in ('disponible', 'sin_disponibilidad') then raise exception 'estado invalido' using errcode = '22023'; end if;
  select id into v_id from catalogo.modelo where nombre_norm = catalogo.normalizar(p_modelo);
  if v_id is null then raise exception 'modelo desconocido: %', p_modelo using errcode = '22023'; end if;
  update catalogo.modelo set estado = p_estado, estado_desde = coalesce(p_desde, negocio.hoy()) where id = v_id and estado <> p_estado;
  perform seguridad.registrar_auditoria('catalogo.modelo', 'DISPONIBILIDAD', v_id::text, null, jsonb_build_object('estado', p_estado), seguridad.canal_actual());
  v_res := jsonb_build_object('modelo_id', v_id, 'estado', p_estado);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function catalogo.asegurar_sabor(p_nombre text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_id from catalogo.sabor where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is null then insert into catalogo.sabor (nombre_canonico) values (btrim(p_nombre)) returning id into v_id; end if;
  return v_id;
end $$;

create function catalogo.asegurar_sku(p_modelo text, p_sabor text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_m bigint; v_s bigint; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_m from catalogo.modelo where nombre_norm = catalogo.normalizar(p_modelo);
  if v_m is null then raise exception 'modelo desconocido: %', p_modelo using errcode = '22023'; end if;
  v_s := catalogo.asegurar_sabor(p_sabor);
  insert into catalogo.sku (modelo_id, sabor_id) values (v_m, v_s) on conflict (modelo_id, sabor_id) do nothing;
  select id into v_id from catalogo.sku where modelo_id = v_m and sabor_id = v_s;
  return v_id;
end $$;

create function catalogo.asegurar_cliente(p_nombre text, p_duenio text, p_tipo text default 'mayoreo') returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_duenio bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_duenio from catalogo.socio where nombre = p_duenio;
  if v_duenio is null then raise exception 'duenio desconocido: %', p_duenio using errcode = '22023'; end if;
  select id into v_id from catalogo.cliente where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is null then
    insert into catalogo.cliente (nombre_canonico, tipo, duenio_id) values (btrim(p_nombre), p_tipo, v_duenio) returning id into v_id;
  end if;
  return v_id;
end $$;

create function catalogo.asegurar_persona_bodega(p_cliente text, p_nombre text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_c bigint; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_c from catalogo.cliente where nombre_norm = catalogo.normalizar(p_cliente);
  if v_c is null then raise exception 'cliente desconocido: %', p_cliente using errcode = '22023'; end if;
  insert into catalogo.persona_bodega (cliente_id, nombre) values (v_c, p_nombre) on conflict (cliente_id) do nothing;
  select id into v_id from catalogo.persona_bodega where cliente_id = v_c;
  return v_id;
end $$;

-- Alias: un destino = directo; dos o mas = ambiguo (el sistema debe preguntar).
create function catalogo.agregar_alias(p_clave_idem text, p_tipo text, p_alias text, p_destinos text[], p_por_confirmar boolean default false, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_norm text := catalogo.normalizar(p_alias); v_ids bigint[]; v_res jsonb; v_n int := coalesce(cardinality(p_destinos), 0);
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'agregar_alias', 't', p_tipo, 'a', p_alias, 'd', p_destinos, 'pc', p_por_confirmar));
  if v_prev is not null then return v_prev; end if;
  if v_n = 0 or v_norm = '' then raise exception 'alias sin destino' using errcode = '22023'; end if;
  if p_tipo = 'modelo' then
    select array_agg(m.id order by u.ord) into v_ids from unnest(p_destinos) with ordinality u(nombre, ord) join catalogo.modelo m on m.nombre_norm = catalogo.normalizar(u.nombre);
    if coalesce(cardinality(v_ids), 0) <> v_n then raise exception 'destino de alias desconocido' using errcode = '22023'; end if;
    insert into catalogo.modelo_alias (alias_norm, modelo_id, ambiguo, candidatos, nota)
      values (v_norm, case when v_n = 1 then v_ids[1] end, v_n > 1, case when v_n > 1 then v_ids end, p_nota)
      on conflict (alias_norm) do nothing;
  elsif p_tipo = 'sabor' then
    select s.id into strict v_ids[1] from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(p_destinos[1]);
    insert into catalogo.sabor_alias (alias_norm, sabor_id) values (v_norm, v_ids[1]) on conflict (alias_norm) do nothing;
  elsif p_tipo = 'cliente' then
    select array_agg(c.id order by u.ord) into v_ids from unnest(p_destinos) with ordinality u(nombre, ord) join catalogo.cliente c on c.nombre_norm = catalogo.normalizar(u.nombre);
    if coalesce(cardinality(v_ids), 0) <> v_n then raise exception 'destino de alias desconocido' using errcode = '22023'; end if;
    insert into catalogo.cliente_alias (alias_norm, cliente_id, ambiguo, candidatos, por_confirmar, nota)
      values (v_norm, case when v_n = 1 then v_ids[1] end, v_n > 1, case when v_n > 1 then v_ids end, p_por_confirmar, p_nota)
      on conflict (alias_norm) do nothing;
  else
    raise exception 'tipo de alias invalido' using errcode = '22023';
  end if;
  perform seguridad.registrar_auditoria('catalogo.alias_' || p_tipo, 'INSERT', v_norm, null, to_jsonb(p_destinos), seguridad.canal_actual());
  v_res := jsonb_build_object('alias_norm', v_norm, 'ambiguo', v_n > 1);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Resolver de alias (lectura): devuelve {tipo: 'directo'|'ambiguo'|'desconocido', ids}
create function catalogo.resolver_modelo(p_texto text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare n text := catalogo.normalizar(p_texto); m bigint; a record;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into m from catalogo.modelo where nombre_norm = n;
  if m is not null then return jsonb_build_object('tipo', 'directo', 'ids', jsonb_build_array(m)); end if;
  select * into a from catalogo.modelo_alias where alias_norm = n;
  if found then
    if a.ambiguo then return jsonb_build_object('tipo', 'ambiguo', 'ids', to_jsonb(a.candidatos)); end if;
    return jsonb_build_object('tipo', 'directo', 'ids', jsonb_build_array(a.modelo_id));
  end if;
  return jsonb_build_object('tipo', 'desconocido', 'ids', '[]'::jsonb);
end $$;

-- Costos con vigencia: cierra la fila abierta el dia en que empieza la nueva. No admite fechas anteriores al ultimo cambio.
create function catalogo.fijar_costo(p_clave_idem text, p_proveedor text, p_modelo text, p_costo_cent bigint, p_desde date, p_fuente text,
                                     p_motivo text default null, p_supuesto boolean default false, p_es_lista boolean default true) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_p bigint; v_m bigint; v_abierta catalogo.costo_proveedor; v_res jsonb; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'fijar_costo', 'p', p_proveedor, 'm', p_modelo, 'c', p_costo_cent, 'd', p_desde, 'f', p_fuente, 'mo', p_motivo, 's', p_supuesto, 'l', p_es_lista));
  if v_prev is not null then return v_prev; end if;
  select id into v_p from catalogo.proveedor where nombre = p_proveedor;
  select id into v_m from catalogo.modelo where nombre_norm = catalogo.normalizar(p_modelo);
  if v_p is null or v_m is null then raise exception 'proveedor o modelo desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('costo:' || v_p || ':' || v_m, 0));
  select * into v_abierta from catalogo.costo_proveedor where proveedor_id = v_p and modelo_id = v_m and vigente_hasta is null;
  if found then
    if v_abierta.costo_cent = p_costo_cent and v_abierta.es_lista = p_es_lista then
      v_res := jsonb_build_object('costo_id', v_abierta.id, 'sin_cambio', true);
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
    if p_desde <= v_abierta.vigente_desde then raise exception 'vigencia retroactiva: el costo vigente empezo el %', v_abierta.vigente_desde using errcode = 'P0422'; end if;
    update catalogo.costo_proveedor set vigente_hasta = p_desde where id = v_abierta.id;
  elsif exists (select 1 from catalogo.costo_proveedor where proveedor_id = v_p and modelo_id = v_m and vigente_desde >= p_desde) then
    raise exception 'vigencia retroactiva' using errcode = 'P0422';
  end if;
  insert into catalogo.costo_proveedor (proveedor_id, modelo_id, costo_cent, vigente_desde, fuente, es_lista, motivo, supuesto)
    values (v_p, v_m, p_costo_cent, p_desde, p_fuente, p_es_lista, p_motivo, p_supuesto) returning id into v_id;
  perform seguridad.registrar_auditoria('catalogo.costo_proveedor', 'INSERT', v_id::text, null, jsonb_build_object('proveedor', p_proveedor, 'modelo', p_modelo, 'costo_cent', p_costo_cent, 'desde', p_desde), seguridad.canal_actual());
  v_res := jsonb_build_object('costo_id', v_id, 'sin_cambio', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Precio del tabulador: solo cambia cuando un socio lo indica (esta funcion). La nota de un pedido NO la llama.
create function catalogo.fijar_precio(p_clave_idem text, p_cliente text, p_modelo text, p_precio_cent bigint, p_desde date, p_origen text, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_c bigint; v_m bigint; v_abierta catalogo.tabulador_precio; v_res jsonb; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'fijar_precio', 'c', p_cliente, 'm', p_modelo, 'p', p_precio_cent, 'd', p_desde, 'o', p_origen, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  select id into v_c from catalogo.cliente where nombre_norm = catalogo.normalizar(p_cliente);
  select id into v_m from catalogo.modelo where nombre_norm = catalogo.normalizar(p_modelo);
  if v_c is null or v_m is null then raise exception 'cliente o modelo desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('precio:' || v_c || ':' || v_m, 0));
  select * into v_abierta from catalogo.tabulador_precio where cliente_id = v_c and modelo_id = v_m and vigente_hasta is null;
  if found then
    if v_abierta.precio_cent = p_precio_cent then
      v_res := jsonb_build_object('precio_id', v_abierta.id, 'sin_cambio', true);
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
    if p_desde <= v_abierta.vigente_desde then raise exception 'vigencia retroactiva: el precio vigente empezo el %', v_abierta.vigente_desde using errcode = 'P0422'; end if;
    update catalogo.tabulador_precio set vigente_hasta = p_desde where id = v_abierta.id;
  end if;
  insert into catalogo.tabulador_precio (cliente_id, modelo_id, precio_cent, vigente_desde, origen, nota)
    values (v_c, v_m, p_precio_cent, p_desde, p_origen, p_nota) returning id into v_id;
  perform seguridad.registrar_auditoria('catalogo.tabulador_precio', 'INSERT', v_id::text, null, jsonb_build_object('cliente', p_cliente, 'modelo', p_modelo, 'precio_cent', p_precio_cent, 'desde', p_desde), seguridad.canal_actual());
  v_res := jsonb_build_object('precio_id', v_id, 'sin_cambio', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Precio que queda solo como historial con su origen (conflicto resuelto a favor del tabulador vigente).
create function catalogo.registrar_precio_historico_externo(p_clave_idem text, p_cliente text, p_modelo text, p_precio_cent bigint, p_origen text, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_c bigint; v_m bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ph', 'c', p_cliente, 'm', p_modelo, 'p', p_precio_cent, 'o', p_origen));
  if v_prev is not null then return v_prev; end if;
  select id into v_c from catalogo.cliente where nombre_norm = catalogo.normalizar(p_cliente);
  select id into v_m from catalogo.modelo where nombre_norm = catalogo.normalizar(p_modelo);
  if v_c is null or v_m is null then raise exception 'cliente o modelo desconocido' using errcode = '22023'; end if;
  insert into catalogo.precio_historico_externo (cliente_id, modelo_id, precio_cent, origen, nota) values (v_c, v_m, p_precio_cent, p_origen, p_nota);
  v_res := jsonb_build_object('ok', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on function seguridad.canal_actual() from public, anon, authenticated;

-- Funciones de escritura: nadie las ejecuta salvo el dueno de la base (el importador) y las funciones de la API.
revoke execute on all functions in schema catalogo from public, anon, authenticated;
alter default privileges in schema catalogo revoke execute on functions from public, anon, authenticated;
