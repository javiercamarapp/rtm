-- Union APROBADA por el dueno de los alias Waka con su modelo por puffs (14-nov): "Si, unir cada alias con su modelo por pufs" y "Optimus 100K y SoPro 15K".
-- Migracion ADITIVA y REVERSIBLE. No unifica nada por si sola: solo (1) deja registrada la aprobacion explicita por nombre, (2) deja que catalogo.unificar_modelo
-- acepte esos pares con la regla 'alias-waka-2026-11-14' (el resto sigue exigiendo el nombre repetido EXACTO) y (3) siembra/corrige alias en catalogo.modelo_alias.
-- La union la ejecuta scripts/catalogo/unificar-alias-waka.mjs (--verificar de solo lectura, luego --aplicar con huella de lo inmutable). Ver docs/alias-waka-y-tabulador.md.
--
-- Reversa de los alias: delete from catalogo.modelo_alias where nota like 'semilla alias-waka 2026-11-14 v2%' and nota not like '%(antes:%';
--   y el alias 'waka sopro': update catalogo.modelo_alias set modelo_id = <modelo anterior, en la nota entre '(antes:' y ')'> where alias_norm = 'waka sopro'.
-- Reversa de una union: catalogo.deshacer_unificacion_catalogo (igual que las demas).

create table catalogo.unificacion_modelo_aprobada (
  regla text not null,
  origen_norm text not null,
  destino_norm text not null,
  nota text not null,
  primary key (regla, origen_norm),
  check (origen_norm <> destino_norm)
);
insert into catalogo.unificacion_modelo_aprobada (regla, origen_norm, destino_norm, nota)
  select 'alias-waka-2026-11-14', catalogo.normalizar(t.origen), catalogo.normalizar(t.destino),
         'Decision del dueno 14-nov: unir cada alias Waka con su modelo por puffs (Optimus = 100K, SoPro = 15K).'
    from (values
    ('Waka Icon', 'Waka 50K'),
    ('Icon', 'Waka 50K'),
    ('Waka Steel', 'Waka 60K'),
    ('Waka SoPro', 'Waka 15K'),
    ('Waka So Pro', 'Waka 15K'),
    ('Smash Go', 'Waka GO 10K'),
    ('Waka Go', 'Waka GO 10K'),
    ('Go', 'Waka GO 10K'),
    ('Waka PA30000', 'Waka 30K'),
    ('PA30000', 'Waka 30K'),
    ('Waka Elite', 'Waka Elite 40K'),
    ('Elite', 'Waka Elite 40K'),
    ('Waka Burst', 'Waka 36K'),
    ('Burst', 'Waka 36K'),
    ('Waka Blade', 'Waka Blade 33K'),
    ('Blade', 'Waka Blade 33K'),
    ('Waka Optimus', 'Waka Optimus 100K'),
    ('Optimus', 'Waka Optimus 100K'),
    ('Waka Slim', 'Waka Slim 12K'),
    ('Slim', 'Waka Slim 12K'),
    ('Waka Jupiter', 'Waka Jupiter 50K'),
    ('Waka Icon Slim', 'Waka Icon Slim 20K')
  ) as t(origen, destino);

alter table catalogo.unificacion_modelo_aprobada enable row level security;
alter table catalogo.unificacion_modelo_aprobada force row level security;
revoke all on catalogo.unificacion_modelo_aprobada from public, anon, authenticated;

-- Misma funcion que 20261115900000 con UNA rama mas: un modelo cuyo par (origen, destino) esta en catalogo.unificacion_modelo_aprobada y la regla coincide se acepta
-- aunque los nombres no sean repetidos exactos. Todo lo demas queda igual (exacto + pregunta pendiente o regla de los exactos).
create or replace function catalogo.aprobacion_exacta(p_tipo text, p_origen bigint, p_destino bigint, p_pregunta_id bigint, p_aprobacion text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_a text; v_b text; q catalogo.posible_duplicado;
begin
  if p_tipo = 'marca' then
    select catalogo.llave_exacta(nombre) into v_a from catalogo.marca where id = p_origen;
    select catalogo.llave_exacta(nombre) into v_b from catalogo.marca where id = p_destino;
  else
    select catalogo.llave_exacta(nombre_canonico) into v_a from catalogo.modelo where id = p_origen;
    select catalogo.llave_exacta(nombre_canonico) into v_b from catalogo.modelo where id = p_destino;
  end if;
  if p_tipo = 'modelo' and p_aprobacion is not null and exists (
       select 1 from catalogo.unificacion_modelo_aprobada x, catalogo.modelo o, catalogo.modelo d
        where x.regla = p_aprobacion and o.id = p_origen and d.id = p_destino
          and x.origen_norm = catalogo.normalizar(o.nombre_canonico) and x.destino_norm = catalogo.normalizar(d.nombre_canonico)) then
    return 'alias:' || p_aprobacion;
  end if;
  if v_a is null or v_b is null or v_a = '' or v_a <> v_b then
    raise exception 'solo se unen nombres repetidos EXACTOS (mismo nombre salvo mayusculas, espacios, guiones o acentos); un nombre solo parecido se pregunta, no se une' using errcode = '42501';
  end if;
  if p_pregunta_id is not null then
    select * into q from catalogo.posible_duplicado where id = p_pregunta_id;
    if not found or q.tipo <> p_tipo or q.id_a <> least(p_origen, p_destino) or q.id_b <> greatest(p_origen, p_destino) then raise exception 'la pregunta no corresponde a estos nombres' using errcode = '22023'; end if;
    if q.estado <> 'pendiente' then raise exception 'esa pregunta ya fue contestada' using errcode = '22023'; end if;
    return 'pregunta:' || q.id::text;
  elsif p_aprobacion = 'regla-exactos-2026-11-14' then
    return 'regla:' || p_aprobacion;
  end if;
  raise exception 'una unificacion exige la respuesta de un socio o la regla de los repetidos exactos' using errcode = '42501';
end $$;

-- Alias de los nombres Waka (diccionario del dueno) hacia el modelo por puffs. No pisa un alias que ya exista ni uno cuyo nombre sea hoy el de un modelo VIGENTE
-- (esos se vuelven alias al unirlos con unificar-alias-waka.mjs). Nota 'semilla alias-waka 2026-11-14 v2'.
do $$
declare
  r record;
  v_destino bigint;
begin
  for r in select * from (values
    ('Waka Icon', 'Waka 50K'),
    ('Icon', 'Waka 50K'),
    ('Waka Steel', 'Waka 60K'),
    ('Waka SoPro', 'Waka 15K'),
    ('Waka So Pro', 'Waka 15K'),
    ('Smash Go', 'Waka GO 10K'),
    ('Waka Go', 'Waka GO 10K'),
    ('Go', 'Waka GO 10K'),
    ('Waka PA30000', 'Waka 30K'),
    ('PA30000', 'Waka 30K'),
    ('Waka Elite', 'Waka Elite 40K'),
    ('Elite', 'Waka Elite 40K'),
    ('Waka Burst', 'Waka 36K'),
    ('Burst', 'Waka 36K'),
    ('Waka Blade', 'Waka Blade 33K'),
    ('Blade', 'Waka Blade 33K'),
    ('Waka Optimus', 'Waka Optimus 100K'),
    ('Optimus', 'Waka Optimus 100K'),
    ('Waka Slim', 'Waka Slim 12K'),
    ('Slim', 'Waka Slim 12K'),
    ('Waka Jupiter', 'Waka Jupiter 50K'),
    ('Waka Icon Slim', 'Waka Icon Slim 20K')
  ) as t(alias, destino) loop
    select id into v_destino from catalogo.modelo where nombre_norm = catalogo.normalizar(r.destino);
    continue when v_destino is null;                                                          -- destino inexistente: no se inventa
    continue when r.alias !~* '^waka ';                                                       -- los nombres sueltos (Icon, Go...) solo se vuelven alias al unir el modelo existente
    continue when exists (select 1 from catalogo.modelo where nombre_norm = catalogo.normalizar(r.alias));
    insert into catalogo.modelo_alias (alias_norm, modelo_id, nota)
      values (catalogo.normalizar(r.alias), v_destino, 'semilla alias-waka 2026-11-14 v2')
      on conflict (alias_norm) do nothing;
  end loop;
end $$;

-- Correccion de 'waka sopro': apuntaba a Waka Sopro 30K y el dueno dijo SoPro = 15K. Solo se mueve si el destino existe; la nota guarda el modelo anterior para la reversa.
update catalogo.modelo_alias a
   set modelo_id = d.id,
       nota = 'semilla alias-waka 2026-11-14 v2 (antes: ' || a.modelo_id || ', nota anterior: ' || coalesce(a.nota, '') || ')'
  from catalogo.modelo d
 where a.alias_norm = catalogo.normalizar('Waka SoPro') and d.nombre_norm = catalogo.normalizar('Waka 15K') and a.modelo_id <> d.id;
