-- Unificacion de sabores, parte 1: deteccion de duplicados SIN extensiones (pg_trgm, fuzzystrmatch y unaccent no estan instaladas) y cola de preguntas.
-- Migracion ADITIVA. Espejo exacto de src/dominio/catalogo/duplicados.ts (misma normalizacion, diccionario, umbrales y puntajes; la paridad se prueba contra la base en test/integracion).
-- REGLA CENTRAL: la deteccion solo SUGIERE. Nada se unifica solo: cada candidato es una pregunta a un socio (catalogo.posible_duplicado); los unicos pares aprobados de antemano
-- por el dueno (14-nov) viven por CLAVE EXPLICITA en catalogo.unificacion_aprobada. Un par contestado "no, son distintos" queda como NEGATIVO y no se vuelve a preguntar.
-- La unificacion misma (catalogo.unificar_sabor) llega en 20261115300100; la de CLIENTES y MODELOS NO se implementa (mueve saldos y dinero): solo se detecta y se pregunta (fase posterior, docs/unificar-sabores.md).

-- ---------------------------------------------------------------------------
-- Columnas de la unificacion LOGICA (los eventos, el kardex y el libro son inmutables: no se reescribe ninguna fila que apunte a un sku).
--   sabor.unificado_en: el sabor ya no existe como nombre propio; apunta al canonico. Sigue siendo la fila que usan los sku historicos, y muestra el nombre canonico.
--   sku.unificado_en: sku historico fusionado con el sku canonico del mismo modelo (queda inactivo; sus movimientos viejos siguen apuntando a el).
-- nombre_norm deja de ser columna generada para poder liberar la llave unica de un sabor unificado ('~u<id>'): un trigger la mantiene igual que antes para todo sabor vigente.
-- ---------------------------------------------------------------------------
alter table catalogo.sabor alter column nombre_norm drop expression;
alter table catalogo.sabor add column unificado_en bigint references catalogo.sabor (id) check (unificado_en is distinct from id);
alter table catalogo.sabor add column nombre_original text;
alter table catalogo.sabor add column unificado_at timestamptz;
alter table catalogo.sku add column unificado_en bigint references catalogo.sku (id) check (unificado_en is distinct from id);

create function catalogo.t_sabor_norm() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.nombre_norm := case when new.unificado_en is null then catalogo.normalizar(new.nombre_canonico) else '~u' || new.id::text end;
  return new;
end $$;
create trigger sabor_norm before insert or update of nombre_canonico, unificado_en on catalogo.sabor for each row execute function catalogo.t_sabor_norm();

-- ---------------------------------------------------------------------------
-- Diccionario de variantes de sabores (abreviaturas e ingles/espanol). Exactas: la equivalencia es de uso comun, pero igual solo llega a MUY_PROBABLE (se pregunta).
-- Ambiguas: puede ser falsa (razz, coco, mora...): solo llega a POSIBLE y se marca como ambigua. Nunca se asume.
-- ---------------------------------------------------------------------------
create table catalogo.diccionario_sabor (
  token text primary key check (token = catalogo.normalizar(token) and token <> '' and token !~ ' '),
  reemplazo text not null check (reemplazo = catalogo.normalizar(reemplazo) and reemplazo <> ''),
  ambiguo boolean not null
);
insert into catalogo.diccionario_sabor (token, reemplazo, ambiguo) values
  ('straw', 'strawberry', false),
  ('strawb', 'strawberry', false),
  ('strwb', 'strawberry', false),
  ('strwbry', 'strawberry', false),
  ('rasp', 'raspberry', false),
  ('raspb', 'raspberry', false),
  ('wmelon', 'watermelon', false),
  ('mnt', 'mint', false),
  ('sandia', 'watermelon', false),
  ('fresa', 'strawberry', false),
  ('uva', 'grape', false),
  ('durazno', 'peach', false),
  ('limon', 'lemon', false),
  ('manzana', 'apple', false),
  ('cereza', 'cherry', false),
  ('menta', 'mint', false),
  ('hielo', 'ice', false),
  ('frambuesa', 'raspberry', false),
  ('maracuya', 'passion fruit', false),
  ('pina', 'pineapple', false),
  ('platano', 'banana', false),
  ('lichi', 'lychee', false),
  ('razz', 'raspberry', true),
  ('icy', 'ice', true),
  ('iced', 'ice', true),
  ('coco', 'coconut', true),
  ('arandano', 'blueberry', true),
  ('mora', 'blackberry', true),
  ('lemonade', 'lemon', true);

-- ---------------------------------------------------------------------------
-- Funciones puras (immutable, sin tablas) de la comparacion.
-- ---------------------------------------------------------------------------
-- Palabras normalizadas y en singular: -ies -> -y (largo > 4); -s se quita (largo > 3) salvo -ss, -us, -is.
create function catalogo.dup_palabras(p_texto text) returns text[]
language sql immutable parallel safe set search_path = ''
as $$
  select coalesce(array(
    select case
      when char_length(t) > 4 and t like '%ies' then left(t, char_length(t) - 3) || 'y'
      when char_length(t) > 3 and t like '%s' and t not like '%ss' and t not like '%us' and t not like '%is' then left(t, char_length(t) - 1)
      else t end
    from unnest(string_to_array(nullif(catalogo.normalizar(p_texto), ''), ' ')) with ordinality u(t, o) order by o), '{}'::text[])
$$;

create function catalogo.dup_ordenadas(p_pal text[]) returns text
language sql immutable parallel safe set search_path = ''
as $$ select coalesce(string_agg(x, '' order by x collate "C"), '') from unnest(p_pal) x $$;

-- Union sin repetidos conservando el orden de primera aparicion.
create function catalogo.dup_union(p_a text[], p_b text[]) returns text[]
language sql immutable parallel safe set search_path = ''
as $$
  select coalesce(array(select x from (select x, min(o) as o from (select x, o from unnest(coalesce(p_a, '{}'::text[])) with ordinality u(x, o)
    union all select x, o + 100000 from unnest(coalesce(p_b, '{}'::text[])) with ordinality v(x, o)) q group by x) r order by o), '{}'::text[])
$$;

-- Cuantas palabras de la larga sobran si la corta (sin espacios) es su inicio en frontera de palabra o a mitad de la palabra que empieza donde empieza la ultima de la corta (>= 4 letras). -1 si no.
create function catalogo.dup_prefijo(p_corta text[], p_larga text[]) returns int
language plpgsql immutable parallel safe set search_path = ''
as $$
declare s text := array_to_string(p_corta, ''); l text := array_to_string(p_larga, ''); ult text; acc int := 0; sig int; i int;
begin
  if coalesce(cardinality(p_corta), 0) = 0 or char_length(s) < 4 or char_length(s) >= char_length(l) or left(l, char_length(s)) <> s then return -1; end if;
  ult := p_corta[cardinality(p_corta)];
  for i in 1..cardinality(p_larga) loop
    sig := acc + char_length(p_larga[i]);
    if char_length(s) = sig then return cardinality(p_larga) - i; end if;
    if char_length(s) < sig then
      return case when acc = char_length(s) - char_length(ult) and char_length(ult) >= 4 then cardinality(p_larga) - i + 1 else -1 end;
    end if;
    acc := sig;
  end loop;
  return -1;
end $$;

-- Aplica el diccionario. Nivel 1: solo exactas. Nivel 2: exactas y ambiguas (la exacta manda). Devuelve las palabras y las sustituciones usadas ("straw = strawberry").
create function catalogo.dup_canon(p_pal text[], p_nivel int, out pal text[], out usadas text[]) returns record
language plpgsql stable set search_path = ''
as $$
declare t text; d record;
begin
  pal := '{}'; usadas := '{}';
  foreach t in array p_pal loop
    select x.reemplazo, x.ambiguo into d from catalogo.diccionario_sabor x where x.token = t and (p_nivel >= 2 or not x.ambiguo) order by x.ambiguo limit 1;
    if not found then pal := pal || t; continue; end if;
    usadas := usadas || (t || ' = ' || d.reemplazo);
    pal := pal || string_to_array(d.reemplazo, ' ');
  end loop;
end $$;

-- Compara dos nombres del mismo tipo ('sabor', 'modelo' o 'cliente'). Devuelve {puntaje, clase, motivo, ambiguo}. Espejo de compararNombres (TypeScript).
create function catalogo.comparar_nombres(p_tipo text, p_a text, p_b text) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  pa text[] := catalogo.dup_palabras(p_a); pb text[] := catalogo.dup_palabras(p_b);
  ja text; jb text; sen jsonb := '[]'::jsonb; d int; largo int; ex int; ex2 int; corta text[]; larga text[]; c1 text[]; c2 text[];
  ca record; cb record; aa record; ab record; usadas text; usadas_amb text; nx text; i int; x text[]; y text[]; v_mejor record; v_p int;
begin
  if p_tipo not in ('sabor', 'modelo', 'cliente') then raise exception 'tipo invalido' using errcode = '22023'; end if;
  if coalesce(cardinality(pa), 0) = 0 or coalesce(cardinality(pb), 0) = 0 then return jsonb_build_object('puntaje', 0, 'clase', 'DISTINTO', 'motivo', 'nombre vacio', 'ambiguo', false); end if;
  ja := array_to_string(pa, ''); jb := array_to_string(pb, '');
  if ja = jb then
    sen := sen || jsonb_build_object('p', 100, 'm', case when pa = pb then 'mismo nombre una vez normalizado (mayusculas, acentos, signos o plural)' else 'mismas letras escritas con o sin espacio' end, 'a', false);
  else
    if catalogo.dup_ordenadas(pa) = catalogo.dup_ordenadas(pb) then sen := sen || jsonb_build_object('p', 92, 'm', 'mismas palabras en otro orden', 'a', false); end if;
    largo := greatest(char_length(ja), char_length(jb));
    d := case when (ja || jb) ~ '[0-9]' or abs(char_length(ja) - char_length(jb)) > 2 then 99 else catalogo.distancia_edicion(ja, jb) end;
    if d = 1 and largo >= 5 then sen := sen || jsonb_build_object('p', 85, 'm', 'una letra de diferencia (posible error de dedo)', 'a', false);
    elsif d = 2 and least(char_length(ja), char_length(jb)) >= 8 then sen := sen || jsonb_build_object('p', 68, 'm', 'dos letras de diferencia (posible error de dedo)', 'a', false); end if;
    if char_length(ja) <= char_length(jb) then corta := pa; larga := pb; else corta := pb; larga := pa; end if;
    ex := catalogo.dup_prefijo(corta, larga);
    if ex >= 0 then sen := sen || jsonb_build_object('p', case when ex = 1 then 65 else 55 end, 'm', 'un nombre empieza como el otro y el otro agrega palabras', 'a', false); end if;

    if p_tipo = 'sabor' then
      select * into ca from catalogo.dup_canon(pa, 1);
      select * into cb from catalogo.dup_canon(pb, 1);
      usadas := array_to_string(catalogo.dup_union(ca.usadas, cb.usadas), ', ');
      if cardinality(ca.usadas) + cardinality(cb.usadas) > 0 then
        if array_to_string(ca.pal, '') = array_to_string(cb.pal, '') then
          sen := sen || jsonb_build_object('p', 90, 'm', 'mismo sabor con abreviatura o traduccion conocida (' || usadas || ')', 'a', false);
        elsif catalogo.dup_ordenadas(ca.pal) = catalogo.dup_ordenadas(cb.pal) then
          sen := sen || jsonb_build_object('p', 86, 'm', 'mismas palabras en otro orden con abreviatura o traduccion conocida (' || usadas || ')', 'a', false);
        end if;
        if char_length(array_to_string(ca.pal, '')) <= char_length(array_to_string(cb.pal, '')) then c1 := ca.pal; c2 := cb.pal; else c1 := cb.pal; c2 := ca.pal; end if;
        ex2 := catalogo.dup_prefijo(c1, c2);
        if ex2 >= 0 then sen := sen || jsonb_build_object('p', case when ex2 = 1 then 60 else 50 end, 'm', 'un nombre empieza como el otro, con abreviatura o traduccion conocida (' || usadas || ')', 'a', false); end if;
      end if;
      select * into aa from catalogo.dup_canon(pa, 2);
      select * into ab from catalogo.dup_canon(pb, 2);
      usadas_amb := coalesce((select string_agg(u, ', ' order by o) from (select u, row_number() over () as o from unnest(catalogo.dup_union(aa.usadas, ab.usadas)) u) q
                              where not (u = any (ca.usadas) or u = any (cb.usadas))), '');
      if usadas_amb <> '' then
        if array_to_string(aa.pal, '') = array_to_string(ab.pal, '') then
          sen := sen || jsonb_build_object('p', 62, 'm', 'podria ser el mismo sabor si ' || usadas_amb || ', pero esa equivalencia NO es segura', 'a', true);
        elsif catalogo.dup_ordenadas(aa.pal) = catalogo.dup_ordenadas(ab.pal) then
          sen := sen || jsonb_build_object('p', 58, 'm', 'podria ser el mismo sabor en otro orden si ' || usadas_amb || ', pero esa equivalencia NO es segura', 'a', true);
        end if;
      end if;
      -- Sigla: "bp" podria abreviar un nombre de varias palabras con esas iniciales.
      for i in 1..2 loop
        if i = 1 then x := pa; y := pb; nx := catalogo.normalizar(p_a); else x := pb; y := pa; nx := catalogo.normalizar(p_b); end if;
        if cardinality(x) = 1 and char_length(replace(nx, ' ', '')) between 2 and 4 and cardinality(y) = char_length(replace(nx, ' ', ''))
           and (select string_agg(left(w, 1), '' order by o) from unnest(y) with ordinality u(w, o)) = replace(nx, ' ', '') then
          sen := sen || jsonb_build_object('p', 50, 'm', '"' || nx || '" podria ser la sigla de ' || array_to_string(y, ' '), 'a', true);
        end if;
      end loop;
    end if;
  end if;
  if jsonb_array_length(sen) = 0 then return jsonb_build_object('puntaje', 0, 'clase', 'DISTINTO', 'motivo', 'sin parecido', 'ambiguo', false); end if;
  select (e ->> 'p')::int as p, e ->> 'm' as m, (e ->> 'a')::boolean as a into v_mejor
    from jsonb_array_elements(sen) with ordinality t(e, o) order by (e ->> 'p')::int desc, (e ->> 'a')::boolean asc, o asc limit 1;
  v_p := v_mejor.p;
  return jsonb_build_object('puntaje', v_p, 'clase', case when v_p >= 100 then 'IGUAL_NORMALIZADO' when v_p >= 80 then 'MUY_PROBABLE' when v_p >= 50 then 'POSIBLE' else 'DISTINTO' end,
                            'motivo', v_mejor.m, 'ambiguo', v_mejor.a);
end $$;

-- ---------------------------------------------------------------------------
-- Cola de preguntas y aprobaciones explicitas.
-- ---------------------------------------------------------------------------
create table catalogo.posible_duplicado (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('sabor', 'modelo', 'cliente')),
  id_a bigint not null,
  id_b bigint not null,
  motivo text not null,
  puntaje int not null check (puntaje between 0 and 100),
  clase text not null check (clase in ('IGUAL_NORMALIZADO', 'MUY_PROBABLE', 'POSIBLE')),
  ambiguo boolean not null default false,
  -- pendiente: se espera respuesta. unido: sabores unificados. distinto: NEGATIVO (no se vuelve a preguntar).
  -- confirmado_igual: un socio dijo que SI es lo mismo en un modelo o cliente; la unificacion de esos tipos es fase posterior (mueve saldos y dinero) y no se ejecuta.
  estado text not null default 'pendiente' check (estado in ('pendiente', 'unido', 'distinto', 'confirmado_igual')),
  preguntado_at timestamptz not null default now(),
  respondido_por uuid,
  respondido_at timestamptz,
  canal text,
  canonico_id bigint,
  unificacion_id bigint,
  check (id_a < id_b),
  check ((estado = 'pendiente') = (respondido_at is null)),
  unique (tipo, id_a, id_b)
);
create index posible_duplicado_pendiente_idx on catalogo.posible_duplicado (tipo, puntaje desc) where estado = 'pendiente';

-- Pares que el dueno aprobo de antemano (decision del 14-nov), por clave explicita: solo estos se unifican sin pregunta. La clave debe coincidir con los nombres normalizados.
create table catalogo.unificacion_aprobada (
  clave text primary key,
  origen_norm text not null,
  destino_norm text not null,
  nota text not null,
  check (origen_norm <> destino_norm)
);
insert into catalogo.unificacion_aprobada (clave, origen_norm, destino_norm, nota) values
  ('dueno-2026-11-14-kiwi-dragon-fruit', 'kiwi dragonfruit', 'kiwi dragon fruit', 'Decision del dueno 14-nov: unificar Kiwi Dragonfruit con Kiwi Dragon Fruit (tienen ventas en ambos nombres).'),
  ('dueno-2026-11-14-passion-fruit', 'passionfruit', 'passion fruit', 'Decision del dueno 14-nov: unificar Passionfruit con Passion Fruit (tienen ventas en ambos nombres).');

do $$ declare t text; begin
  foreach t in array array['diccionario_sabor', 'posible_duplicado', 'unificacion_aprobada'] loop
    execute format('alter table catalogo.%I enable row level security', t);
    execute format('alter table catalogo.%I force row level security', t);
    execute format('revoke all on catalogo.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema catalogo from public, anon, authenticated;

-- Candidatos del catalogo para un nombre (nuevo o existente), de mayor a menor puntaje. Con p_excluir_id (nombre existente) excluye el propio id y marca los NEGATIVOS conocidos.
create function catalogo.candidatos_duplicado(p_tipo text, p_nombre text, p_excluir_id bigint default null, p_minimo int default 50)
returns table (id bigint, nombre text, puntaje int, clase text, motivo text, ambiguo boolean, negativo boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_tipo not in ('sabor', 'modelo', 'cliente') then raise exception 'tipo invalido' using errcode = '22023'; end if;
  return query
    select q.id, q.nombre, (q.c ->> 'puntaje')::int, q.c ->> 'clase', q.c ->> 'motivo', (q.c ->> 'ambiguo')::boolean,
           (p_excluir_id is not null and exists (select 1 from catalogo.posible_duplicado d where d.tipo = p_tipo and d.id_a = least(q.id, p_excluir_id) and d.id_b = greatest(q.id, p_excluir_id) and d.estado = 'distinto'))
      from (select o.id, o.nombre, catalogo.comparar_nombres(p_tipo, p_nombre, o.nombre) as c
              from (select s.id, s.nombre_canonico as nombre from catalogo.sabor s where p_tipo = 'sabor' and s.unificado_en is null
                    union all select m.id, m.nombre_canonico from catalogo.modelo m where p_tipo = 'modelo'
                    union all select c2.id, c2.nombre_canonico from catalogo.cliente c2 where p_tipo = 'cliente') o
             where o.id is distinct from p_excluir_id) q
     where (q.c ->> 'puntaje')::int >= p_minimo
     order by (q.c ->> 'puntaje')::int desc, q.nombre;
end $$;

-- Deja una pregunta pendiente (no toca una ya contestada, incluido el negativo).
create function catalogo.registrar_posible_duplicado(p_tipo text, p_id1 bigint, p_id2 bigint, p_motivo text, p_puntaje int, p_clase text, p_ambiguo boolean) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  if p_id1 = p_id2 then raise exception 'un nombre no se compara consigo mismo' using errcode = '22023'; end if;
  insert into catalogo.posible_duplicado (tipo, id_a, id_b, motivo, puntaje, clase, ambiguo)
    values (p_tipo, least(p_id1, p_id2), greatest(p_id1, p_id2), p_motivo, p_puntaje, p_clase, p_ambiguo)
    on conflict (tipo, id_a, id_b) do nothing returning id into v_id;
  return v_id;
end $$;

-- Recorre el catalogo y deja una pregunta pendiente por cada par parecido (POSIBLE o mas) que no tenga ya respuesta o pregunta. No unifica nada.
create function catalogo.escanear_duplicados(p_tipo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t text; r record; c jsonb; v_nuevas int := 0; v_tipos text[] := case when p_tipo is null then array['sabor', 'modelo', 'cliente'] else array[p_tipo] end;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  foreach t in array v_tipos loop
    if t not in ('sabor', 'modelo', 'cliente') then raise exception 'tipo invalido' using errcode = '22023'; end if;
    for r in
      select a.id as ia, a.nombre as na, b.id as ib, b.nombre as nb
        from (select s.id, s.nombre_canonico as nombre from catalogo.sabor s where t = 'sabor' and s.unificado_en is null
              union all select m.id, m.nombre_canonico from catalogo.modelo m where t = 'modelo'
              union all select k.id, k.nombre_canonico from catalogo.cliente k where t = 'cliente') a
        join (select s.id, s.nombre_canonico as nombre from catalogo.sabor s where t = 'sabor' and s.unificado_en is null
              union all select m.id, m.nombre_canonico from catalogo.modelo m where t = 'modelo'
              union all select k.id, k.nombre_canonico from catalogo.cliente k where t = 'cliente') b on a.id < b.id
       where not exists (select 1 from catalogo.posible_duplicado d where d.tipo = t and d.id_a = a.id and d.id_b = b.id)
    loop
      c := catalogo.comparar_nombres(t, r.na, r.nb);
      if (c ->> 'puntaje')::int >= 50 then
        perform catalogo.registrar_posible_duplicado(t, r.ia, r.ib, c ->> 'motivo', (c ->> 'puntaje')::int, c ->> 'clase', (c ->> 'ambiguo')::boolean);
        v_nuevas := v_nuevas + 1;
      end if;
    end loop;
  end loop;
  perform seguridad.registrar_auditoria('catalogo.posible_duplicado', 'ESCANEO', coalesce(p_tipo, 'todos'), null, jsonb_build_object('preguntas_nuevas', v_nuevas), seguridad.canal_actual());
  return jsonb_build_object('preguntas_nuevas', v_nuevas);
end $$;

revoke execute on all functions in schema catalogo from public, anon, authenticated;
