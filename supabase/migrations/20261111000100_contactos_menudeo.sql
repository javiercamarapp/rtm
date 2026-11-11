-- Contactos de MENUDEO (decision del dueno, 11-nov): todos los numeros de las bases (Toocloudy, Vapeunion, Google) y de Meta son de Javier y son de menudeo.
-- Se segmenta SOLO por ORIGEN (meta con anuncio y formulario, toocloudy, vapeunion, google-lote:<etiqueta>); la interfaz no filtra por Angelo o Javier.
-- Esquema separado `contactos`: cerrado a anon, authenticated y Omar. Las tablas llevan RLS forzada SIN politicas (deniega por omision); solo las
-- funciones SECURITY DEFINER del esquema api (rol socio) y la carga idempotente (canal de importacion) las tocan.
-- El agente de IA nunca ve telefonos: la vista contactos.v_contacto_agente entrega solo los ultimos 2 digitos y si hay correo (nunca el correo).
-- NO se aplica en ninguna base hasta que el dueno autorice la carga (ver docs/pendiente-contactos.md).

create schema if not exists contactos;
revoke all on schema contactos from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table contactos.contacto (
  id bigint generated always as identity primary key,
  tipo text not null default 'menudeo' check (tipo = 'menudeo'),
  telefono_principal text not null unique check (telefono_principal ~ '^\+[1-9][0-9]{7,14}$' or telefono_principal ~ '^sl:[0-9]{7,8}$'),
  nombre text not null default '',
  -- Comparte un correo con otro contacto de nombre distinto: no se unieron; queda marcado para revision.
  correo_compartido boolean not null default false,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

-- Sin duplicados: un telefono pertenece a un solo contacto. Un numero de 7 u 8 digitos sin lada se conserva como 'sl:<digitos>' (no es E.164,
-- no se inventa la lada) y se deduplica por sus digitos.
create table contactos.telefono (
  e164 text primary key check (e164 ~ '^\+[1-9][0-9]{7,14}$' or e164 ~ '^sl:[0-9]{7,8}$'),
  contacto_id bigint not null references contactos.contacto (id) on delete cascade,
  sin_lada boolean generated always as (e164 like 'sl:%') stored
);
create index telefono_contacto_idx on contactos.telefono (contacto_id);

-- Un correo se une a un solo contacto SOLO si el nombre normalizado coincide; si no, dos contactos pueden tener el mismo correo (marcados correo_compartido).
create table contactos.correo (
  correo text not null check (correo = lower(correo) and correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  contacto_id bigint not null references contactos.contacto (id) on delete cascade,
  primary key (contacto_id, correo)
);
create index correo_correo_idx on contactos.correo (correo);
create index correo_contacto_idx on contactos.correo (contacto_id);

-- Todos los origenes de cada contacto se conservan. Cadena vacia = no aplica (para poder usarlos en la llave primaria).
create table contactos.origen (
  contacto_id bigint not null references contactos.contacto (id) on delete cascade,
  origen text not null check (origen ~ '^(meta|toocloudy|toocloudy-whatsapp|vapeunion|google-lote:[a-z0-9-]+|google-vcf:[a-z0-9-]+|descargas-[a-z0-9-]+)$'),
  anuncio text not null default '',
  formulario text not null default '',
  campana text not null default '',
  primary key (contacto_id, origen, anuncio, formulario, campana)
);
create index origen_origen_idx on contactos.origen (origen);
create index origen_anuncio_idx on contactos.origen (anuncio) where anuncio <> '';

create table contactos.etiqueta (
  contacto_id bigint not null references contactos.contacto (id) on delete cascade,
  etiqueta text not null check (btrim(etiqueta) <> ''),
  primary key (contacto_id, etiqueta)
);

create table contactos.lote_contacto (
  contacto_id bigint not null references contactos.contacto (id) on delete cascade,
  lote text not null check (btrim(lote) <> ''),
  primary key (contacto_id, lote)
);

-- Cargas ya aplicadas (idempotencia por lote: mismo lote y misma huella = no se vuelve a cargar).
create table contactos.carga (
  lote_id text primary key,
  huella text not null,
  contactos integer not null check (contactos >= 0),
  nuevos integer not null check (nuevos >= 0),
  cargado_at timestamptz not null default now()
);

-- Registro de cada vez que un socio revela o exporta telefonos. Solo insercion. Sin llave foranea: sobrevive a fusiones de contactos.
create table contactos.revelacion (
  id bigint generated always as identity primary key,
  contacto_id bigint not null,
  telefono_ult2 text not null,
  accion text not null check (accion in ('revelar', 'exportar')),
  actor uuid not null,
  motivo text,
  en timestamptz not null default now()
);
create index revelacion_contacto_idx on contactos.revelacion (contacto_id, id);
create trigger revelacion_t1 before update or delete on contactos.revelacion for each row execute function seguridad.t1_solo_insercion();
create trigger revelacion_t1_truncate before truncate on contactos.revelacion for each statement execute function seguridad.t1_solo_insercion();

-- RLS forzada y sin politicas en todas las tablas: deniega por omision. Ningun rol de la web tiene privilegios sobre ellas.
do $$
declare t text;
begin
  foreach t in array array['contacto', 'telefono', 'correo', 'origen', 'etiqueta', 'lote_contacto', 'carga', 'revelacion'] loop
    execute format('alter table contactos.%I enable row level security', t);
    execute format('alter table contactos.%I force row level security', t);
    execute format('revoke all on contactos.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema contactos from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vista para el agente de IA: sin telefono completo, sin correo.
-- ---------------------------------------------------------------------------
create view contactos.v_contacto_agente with (security_barrier = true) as
  select c.id,
         c.tipo,
         c.nombre,
         '***' || right(c.telefono_principal, 2) as telefono_ult2,
         exists (select 1 from contactos.correo r where r.contacto_id = c.id) as tiene_correo,
         coalesce((select array_agg(distinct o.origen order by o.origen) from contactos.origen o where o.contacto_id = c.id), '{}') as origenes
  from contactos.contacto c;
revoke all on contactos.v_contacto_agente from public, anon, authenticated;

-- Si existe un rol dedicado del agente, solo recibe la vista (nunca las tablas).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'agente_ia') then
    grant usage on schema contactos to agente_ia;
    grant select on contactos.v_contacto_agente to agente_ia;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Carga idempotente por lotes (canal de importacion: postgres con rtm.canal = 'importacion'; nadie de la web llega aqui).
-- Entrada: arreglo JSON de {telefono, nombre, telefonos[], correos[], etiquetas[], lotes[], origenes[{origen, anuncio, formulario, campana}]}.
-- Un contacto que comparte telefono o correo con uno existente se FUSIONA (se unen todos sus datos); varios existentes se unifican en el menor id.
-- Correrlo dos veces con el mismo lote no cambia nada.
-- ---------------------------------------------------------------------------
create function contactos.cargar_lote(p_lote_id text, p_contactos jsonb, p_huella text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb; v_tels text[]; v_cors text[]; v_ids bigint[]; v_id bigint; v_otro bigint;
  v_nuevos int := 0; v_existentes int := 0; v_total int := 0; v_huella text;
begin
  perform seguridad.exigir_rol(array['importacion']);
  if p_lote_id is null or btrim(p_lote_id) = '' then raise exception 'lote invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_contactos) is distinct from 'array' then raise exception 'se esperaba un arreglo de contactos' using errcode = '22023'; end if;
  v_huella := coalesce(p_huella, md5(p_contactos::text));
  if exists (select 1 from contactos.carga c where c.lote_id = p_lote_id and c.huella = v_huella) then
    return jsonb_build_object('lote', p_lote_id, 'repetido', true, 'nuevos', 0, 'existentes', 0, 'contactos', 0);
  end if;
  if exists (select 1 from contactos.carga c where c.lote_id = p_lote_id) then
    raise exception 'el lote % ya se cargo con otro contenido', p_lote_id using errcode = '23505';
  end if;

  for v in select * from jsonb_array_elements(p_contactos) loop
    v_total := v_total + 1;
    v_tels := array(select distinct jsonb_array_elements_text(v -> 'telefonos') order by 1);
    v_cors := array(select distinct lower(jsonb_array_elements_text(coalesce(v -> 'correos', '[]'::jsonb))) order by 1);
    if coalesce(array_length(v_tels, 1), 0) = 0 then raise exception 'contacto sin telefono en el lote %', p_lote_id using errcode = '22023'; end if;

    -- Union por telefono siempre; por correo solo con el mismo nombre normalizado (sin acentos, mayusculas ni espacios extra).
    v_ids := array(select contacto_id from contactos.telefono where e164 = any (v_tels)
                   union select r.contacto_id from contactos.correo r join contactos.contacto k on k.id = r.contacto_id
                          where r.correo = any (v_cors) and catalogo.normalizar(v ->> 'nombre') <> '' and catalogo.normalizar(k.nombre) = catalogo.normalizar(v ->> 'nombre')
                   order by 1);
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      insert into contactos.contacto (telefono_principal, nombre) values (v_tels[1], btrim(coalesce(v ->> 'nombre', ''))) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    else
      v_id := v_ids[1];
      v_existentes := v_existentes + 1;
      -- Unificar los demas contactos existentes en el menor id.
      foreach v_otro in array v_ids[2:array_length(v_ids, 1)] loop
        update contactos.telefono set contacto_id = v_id where contacto_id = v_otro;
        update contactos.correo set contacto_id = v_id where contacto_id = v_otro;
        insert into contactos.origen select v_id, origen, anuncio, formulario, campana from contactos.origen where contacto_id = v_otro on conflict do nothing;
        insert into contactos.etiqueta select v_id, etiqueta from contactos.etiqueta where contacto_id = v_otro on conflict do nothing;
        insert into contactos.lote_contacto select v_id, lote from contactos.lote_contacto where contacto_id = v_otro on conflict do nothing;
        update contactos.contacto set nombre = (select nombre from contactos.contacto where id = v_otro) where id = v_id and length(nombre) < (select length(nombre) from contactos.contacto where id = v_otro);
        delete from contactos.contacto where id = v_otro;
      end loop;
    end if;

    insert into contactos.telefono (e164, contacto_id) select t, v_id from unnest(v_tels) t on conflict (e164) do nothing;
    insert into contactos.correo (correo, contacto_id) select c, v_id from unnest(v_cors) c where c <> '' on conflict do nothing;
    insert into contactos.origen (contacto_id, origen, anuncio, formulario, campana)
      select v_id, o ->> 'origen', coalesce(o ->> 'anuncio', ''), coalesce(o ->> 'formulario', ''), coalesce(o ->> 'campana', '')
      from jsonb_array_elements(v -> 'origenes') o on conflict do nothing;
    insert into contactos.etiqueta (contacto_id, etiqueta) select v_id, e from jsonb_array_elements_text(coalesce(v -> 'etiquetas', '[]'::jsonb)) e on conflict do nothing;
    insert into contactos.lote_contacto (contacto_id, lote) select v_id, l from jsonb_array_elements_text(coalesce(v -> 'lotes', '[]'::jsonb)) l on conflict do nothing;

    -- Nombre: el mas largo; telefono principal: el menor de sus telefonos (determinista).
    update contactos.contacto c set
      nombre = case when length(btrim(coalesce(v ->> 'nombre', ''))) > length(c.nombre) then btrim(v ->> 'nombre') else c.nombre end,
      telefono_principal = (select e164 from contactos.telefono where contacto_id = v_id order by sin_lada, e164 limit 1),
      actualizado_at = now()
    where c.id = v_id
      and (length(btrim(coalesce(v ->> 'nombre', ''))) > length(c.nombre) or c.telefono_principal is distinct from (select e164 from contactos.telefono where contacto_id = v_id order by sin_lada, e164 limit 1));

    -- Correo compartido con otro contacto (nombre distinto): ambos quedan marcados para revision.
    update contactos.contacto k set correo_compartido = true
    where k.id in (select r2.contacto_id from contactos.correo r1 join contactos.correo r2 on r2.correo = r1.correo and r2.contacto_id <> r1.contacto_id where r1.contacto_id = v_id)
       or (k.id = v_id and exists (select 1 from contactos.correo r1 join contactos.correo r2 on r2.correo = r1.correo and r2.contacto_id <> r1.contacto_id where r1.contacto_id = v_id));
  end loop;

  insert into contactos.carga (lote_id, huella, contactos, nuevos) values (p_lote_id, v_huella, v_total, v_nuevos);
  perform seguridad.registrar_auditoria('contactos.carga', 'cargar_lote', p_lote_id, null, jsonb_build_object('contactos', v_total, 'nuevos', v_nuevos), 'importacion');
  return jsonb_build_object('lote', p_lote_id, 'repetido', false, 'nuevos', v_nuevos, 'existentes', v_existentes, 'contactos', v_total);
end $$;
revoke all on function contactos.cargar_lote(text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lectura para socios (esquema api). El telefono sale enmascarado; revelarlo o exportarlo queda registrado.
-- ---------------------------------------------------------------------------
create function contactos.ids_filtrados(p_busqueda text, p_origen text, p_anuncio text) returns setof bigint
language sql stable security definer set search_path = ''
as $$
  select c.id from contactos.contacto c
  where (nullif(btrim(p_busqueda), '') is null
         or catalogo.normalizar(c.nombre) like '%' || catalogo.normalizar(p_busqueda) || '%'
         or (regexp_replace(p_busqueda, '\D', '', 'g') ~ '^[0-9]{4,}$'
             and exists (select 1 from contactos.telefono t where t.contacto_id = c.id and t.e164 like '%' || regexp_replace(p_busqueda, '\D', '', 'g') || '%'))
         or exists (select 1 from contactos.correo r where r.contacto_id = c.id and r.correo like '%' || lower(btrim(p_busqueda)) || '%'))
    and (nullif(p_origen, '') is null
         or exists (select 1 from contactos.origen o where o.contacto_id = c.id and (o.origen = p_origen or (p_origen = 'google-lote' and o.origen like 'google-lote:%'))))
    and (nullif(p_anuncio, '') is null
         or exists (select 1 from contactos.origen o where o.contacto_id = c.id and o.origen = 'meta' and o.anuncio = p_anuncio))
$$;
revoke all on function contactos.ids_filtrados(text, text, text) from public, anon, authenticated;

create function api.contactos_lista(p_busqueda text default null, p_origen text default null, p_anuncio text default null, p_limite int default 50, p_desplazamiento int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_limite int := least(greatest(coalesce(p_limite, 50), 1), 200); v_total bigint; v_filas jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select count(*) into v_total from contactos.ids_filtrados(p_busqueda, p_origen, p_anuncio);
  select coalesce(jsonb_agg(q.fila order by q.id), '[]'::jsonb) into v_filas from (
    select c.id,
           jsonb_build_object(
             'id', c.id,
             'nombre', c.nombre,
             'telefono_mascara', '+** **** **' || right(c.telefono_principal, 2),
             'telefonos', (select count(*) from contactos.telefono t where t.contacto_id = c.id),
             'sin_lada', exists (select 1 from contactos.telefono t where t.contacto_id = c.id and t.sin_lada),
             'correo_compartido', c.correo_compartido,
             'correo', (select min(r.correo) from contactos.correo r where r.contacto_id = c.id),
             'origenes', coalesce((select jsonb_agg(distinct o.origen) from contactos.origen o where o.contacto_id = c.id), '[]'::jsonb),
             'anuncios', coalesce((select jsonb_agg(distinct o.anuncio) from contactos.origen o where o.contacto_id = c.id and o.anuncio <> ''), '[]'::jsonb),
             'etiquetas', coalesce((select jsonb_agg(e.etiqueta order by e.etiqueta) from contactos.etiqueta e where e.contacto_id = c.id), '[]'::jsonb)
           ) as fila
    from contactos.contacto c
    where c.id in (select contactos.ids_filtrados(p_busqueda, p_origen, p_anuncio))
    order by c.id offset greatest(coalesce(p_desplazamiento, 0), 0) limit v_limite
  ) q;
  return jsonb_build_object('total', v_total, 'limite', v_limite, 'desplazamiento', greatest(coalesce(p_desplazamiento, 0), 0), 'filas', v_filas);
end $$;

create function api.contactos_resumen() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'total', (select count(*) from contactos.contacto),
    'con_correo', (select count(distinct contacto_id) from contactos.correo),
    'correo_compartido', (select count(*) from contactos.contacto where correo_compartido),
    'sin_lada', (select count(distinct contacto_id) from contactos.telefono where sin_lada),
    'por_origen', coalesce((select jsonb_agg(jsonb_build_object('origen', origen, 'contactos', n) order by n desc, origen)
                            from (select origen, count(distinct contacto_id) n from contactos.origen group by origen) x), '[]'::jsonb),
    'por_anuncio', coalesce((select jsonb_agg(jsonb_build_object('anuncio', anuncio, 'formulario', formulario, 'contactos', n) order by n desc, anuncio)
                             from (select anuncio, formulario, count(distinct contacto_id) n from contactos.origen where origen = 'meta' group by anuncio, formulario) x), '[]'::jsonb));
end $$;

create function api.contacto_revelar(p_id bigint, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_tels jsonb; v_principal text;
begin
  perform seguridad.exigir_rol(array['socio']);
  select c.telefono_principal into v_principal from contactos.contacto c where c.id = p_id;
  if v_principal is null then raise exception 'contacto inexistente' using errcode = 'P0404'; end if;
  select jsonb_agg(t.e164 order by t.e164) into v_tels from contactos.telefono t where t.contacto_id = p_id;
  insert into contactos.revelacion (contacto_id, telefono_ult2, accion, actor, motivo) values (p_id, right(v_principal, 2), 'revelar', auth.uid(), nullif(btrim(p_motivo), ''));
  return jsonb_build_object('id', p_id, 'telefonos', v_tels);
end $$;

-- Exporta la seleccion (ids) o, sin ids, todo lo que coincide con los filtros (tope 20000). Registra una revelacion por contacto exportado.
create function api.contactos_exportar(p_ids bigint[] default null, p_busqueda text default null, p_origen text default null, p_anuncio text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ids bigint[]; v_filas jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_ids is not null then
    if cardinality(p_ids) > 20000 then raise exception 'seleccion demasiado grande' using errcode = '22023'; end if;
    v_ids := array(select c.id from contactos.contacto c where c.id = any (p_ids) order by c.id);
  else
    v_ids := array(select i from contactos.ids_filtrados(p_busqueda, p_origen, p_anuncio) i order by i limit 20000);
  end if;
  insert into contactos.revelacion (contacto_id, telefono_ult2, accion, actor, motivo)
    select c.id, right(c.telefono_principal, 2), 'exportar', auth.uid(), 'exportacion de ' || cardinality(v_ids) || ' contactos' from contactos.contacto c where c.id = any (v_ids);
  select coalesce(jsonb_agg(jsonb_build_object(
      'nombre', c.nombre,
      'telefono', c.telefono_principal,
      'telefonos', (select jsonb_agg(t.e164 order by t.e164) from contactos.telefono t where t.contacto_id = c.id),
      'correo', (select min(r.correo) from contactos.correo r where r.contacto_id = c.id),
      'origenes', coalesce((select jsonb_agg(distinct o.origen) from contactos.origen o where o.contacto_id = c.id), '[]'::jsonb),
      'anuncios', coalesce((select jsonb_agg(distinct o.anuncio) from contactos.origen o where o.contacto_id = c.id and o.anuncio <> ''), '[]'::jsonb)
    ) order by c.id), '[]'::jsonb) into v_filas
  from contactos.contacto c where c.id = any (v_ids);
  return jsonb_build_object('total', cardinality(v_ids), 'filas', v_filas);
end $$;

-- Apoyo para el agente (siempre enmascarado): lo mismo que la vista, pero llamado desde una sesion de socio.
create function api.contactos_agente(p_origen text default null, p_limite int default 50) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(to_jsonb(v)) from (
    select * from contactos.v_contacto_agente a
    where nullif(p_origen, '') is null or p_origen = any (a.origenes)
    order by a.id limit least(greatest(coalesce(p_limite, 50), 1), 200)) v), '[]'::jsonb);
end $$;

revoke execute on function api.contactos_lista(text, text, text, int, int), api.contactos_resumen(), api.contacto_revelar(bigint, text),
  api.contactos_exportar(bigint[], text, text, text), api.contactos_agente(text, int) from public, anon;
grant execute on function api.contactos_lista(text, text, text, int, int), api.contactos_resumen(), api.contacto_revelar(bigint, text),
  api.contactos_exportar(bigint[], text, text, text), api.contactos_agente(text, int) to authenticated;
