-- F1 / 0005: apoyo del importador y del resolver.
--  * nota del cliente (por ejemplo "lista anterior descartada por el dueno")
--  * destinos de cliente (Otto: Merida, Chetumal)
--  * resolver_modelo: si un nombre exacto de modelo coincide ademas con un alias que apunta a OTRO modelo, es ambiguo (se pregunta)
alter table catalogo.cliente add column nota text;

drop function catalogo.asegurar_cliente(text, text, text);
create function catalogo.asegurar_cliente(p_nombre text, p_duenio text, p_tipo text default 'mayoreo', p_nota text default null) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_duenio bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_duenio from catalogo.socio where nombre = p_duenio;
  if v_duenio is null then raise exception 'duenio desconocido: %', p_duenio using errcode = '22023'; end if;
  select id into v_id from catalogo.cliente where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is null then
    insert into catalogo.cliente (nombre_canonico, tipo, duenio_id, nota) values (btrim(p_nombre), p_tipo, v_duenio, p_nota) returning id into v_id;
  elsif p_nota is not null then
    update catalogo.cliente set nota = p_nota where id = v_id and nota is distinct from p_nota;
  end if;
  return v_id;
end $$;

create function catalogo.agregar_destino(p_cliente text, p_etiqueta text, p_zona text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_c bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_c from catalogo.cliente where nombre_norm = catalogo.normalizar(p_cliente);
  if v_c is null then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  insert into catalogo.cliente_destino (cliente_id, etiqueta, zona) values (v_c, p_etiqueta, p_zona) on conflict (cliente_id, etiqueta) do nothing;
end $$;

create or replace function catalogo.resolver_modelo(p_texto text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare n text := catalogo.normalizar(p_texto); m bigint; a record;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into m from catalogo.modelo where nombre_norm = n;
  select * into a from catalogo.modelo_alias where alias_norm = n;
  if m is not null and found and (a.ambiguo or a.modelo_id <> m) then
    return jsonb_build_object('tipo', 'ambiguo', 'ids', to_jsonb(case when a.ambiguo then (select array_agg(distinct x) from unnest(a.candidatos || m) x) else array[m, a.modelo_id] end));
  end if;
  if m is not null then return jsonb_build_object('tipo', 'directo', 'ids', jsonb_build_array(m)); end if;
  if found then
    if a.ambiguo then return jsonb_build_object('tipo', 'ambiguo', 'ids', to_jsonb(a.candidatos)); end if;
    return jsonb_build_object('tipo', 'directo', 'ids', jsonb_build_array(a.modelo_id));
  end if;
  return jsonb_build_object('tipo', 'desconocido', 'ids', '[]'::jsonb);
end $$;

revoke execute on all functions in schema catalogo from public, anon, authenticated;

-- Listas de precios sin dueno: referencia, NO vigente (no entra a ningun tabulador).
create table catalogo.lista_sin_duenio (
  id bigint generated always as identity primary key,
  referencia text not null unique,
  origen text not null,
  filas jsonb not null,
  creado_en timestamptz not null default now()
);
alter table catalogo.lista_sin_duenio enable row level security;
alter table catalogo.lista_sin_duenio force row level security;
revoke all on catalogo.lista_sin_duenio from public, anon, authenticated;

create function catalogo.guardar_lista_sin_duenio(p_referencia text, p_origen text, p_filas jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  insert into catalogo.lista_sin_duenio (referencia, origen, filas) values (p_referencia, p_origen, p_filas) on conflict (referencia) do nothing;
end $$;
revoke execute on all functions in schema catalogo from public, anon, authenticated;
