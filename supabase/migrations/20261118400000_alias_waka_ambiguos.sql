-- Respuestas del dueno a las dudas de alias Waka (14-nov), segunda vuelta. Migracion ADITIVA y REVERSIBLE. No unifica nada por si sola ni toca produccion por su cuenta:
--   * "Waka 50K" puede ser Jupiter o Icon; "Waka 15K" puede ser SoPro o DM; "Waka Sopro 30K" puede ser Waka 30K o Titan 30K  ->  AMBIGUOS: no se unen y el agente PREGUNTA.
--   * "Waka Burst" = "Waka 36K" (se une); "Burst" a secas = marca Waka (alias global, ya no ambiguo); "Blade" con costo 200 es el unico Waka 33K.
-- (La migracion 20261118100000 ya esta aplicada y NO se edita.) Ver docs/alias-waka-y-tabulador.md.
--
-- 1. catalogo.unificacion_modelo_aprobada: salen los pares cuyo destino es ambiguo ('Waka 50K', 'Waka 15K') y entran Icon -> 'Waka Icon 50K' y 'Waka Burst 36K' -> 'Waka 36K'.
-- 2. catalogo.modelo_alias: alias AMBIGUOS (ambiguo = true, con sus candidatos) para 'waka 50k', 'waka 50', 'waka 15k', 'waka 15', 'waka sopro 30k' y 'pro 30k';
--    'burst' pasa a ser directo (Waka 36K); 'titan' apunta al modelo Waka Titan 30K.
-- 3. agente.catalogo_modelos(): el agente ya no ve como opcion un modelo SIN existencia cuyo nombre es el texto ambiguo (p. ej. el modelo generico 'Waka 50K'): la pregunta ofrece solo las opciones del dueno.
--
-- Reversa:
--   delete from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm in ('waka icon', 'icon') and destino_norm = 'waka icon 50k';
--   delete from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = 'waka burst 36k';
--   insert de nuevo ('Waka Icon','Waka 50K'), ('Icon','Waka 50K'), ('Waka SoPro','Waka 15K'), ('Waka So Pro','Waka 15K') con la regla 'alias-waka-2026-11-14' (ver 20261118100000);
--   los alias tocados llevan en la nota 'alias-waka v3 (antes: ...)' con el estado anterior; la funcion agente.catalogo_modelos vuelve a su version de 20261115900000.

-- 1. Uniones aprobadas.
delete from catalogo.unificacion_modelo_aprobada
 where regla = 'alias-waka-2026-11-14' and destino_norm in (catalogo.normalizar('Waka 50K'), catalogo.normalizar('Waka 15K'), catalogo.normalizar('Waka Sopro 30K'));

insert into catalogo.unificacion_modelo_aprobada (regla, origen_norm, destino_norm, nota)
  select 'alias-waka-2026-11-14', catalogo.normalizar(t.origen), catalogo.normalizar(t.destino),
         'Respuestas del dueno 14-nov: ' || t.motivo
    from (values
      ('Waka Icon', 'Waka Icon 50K', '50K es ambiguo (Jupiter o Icon); Icon se une a su modelo propio.'),
      ('Icon', 'Waka Icon 50K', '50K es ambiguo (Jupiter o Icon); Icon se une a su modelo propio.'),
      ('Waka Burst 36K', 'Waka 36K', 'Waka Burst = Waka 36K.')
    ) as t(origen, destino, motivo)
  on conflict (regla, origen_norm) do nothing;

-- 2. Alias ambiguos y directos. Un grupo se omite si falta alguno de sus modelos (nunca se inventa un candidato).
do $$
declare
  r record;
  v_ids bigint[];
  v_id bigint;
  v_antes text;
begin
  for r in select * from (values
    ('Waka 50K',       array['Waka Jupiter 50K', 'Waka Icon 50K']),
    ('Waka 50',        array['Waka Jupiter 50K', 'Waka Icon 50K']),
    ('Waka 15K',       array['Waka 15K', 'Waka DM 15K']),
    ('Waka 15',        array['Waka 15K', 'Waka DM 15K']),
    ('Waka Sopro 30K', array['Waka 30K', 'Waka Titan 30K']),
    ('Pro 30K',        array['Waka 30K', 'Waka Titan 30K'])
  ) as t(alias, candidatos) loop
    select array_agg(m.id order by u.ord) into v_ids
      from unnest(r.candidatos) with ordinality u(nombre, ord) join catalogo.modelo m on m.nombre_norm = catalogo.normalizar(u.nombre) and m.unificado_en is null;
    continue when coalesce(cardinality(v_ids), 0) <> cardinality(r.candidatos);
    select case when a.ambiguo then 'ambiguo ' || array_to_string(a.candidatos, ',') else 'directo ' || a.modelo_id end into v_antes
      from catalogo.modelo_alias a where a.alias_norm = catalogo.normalizar(r.alias);
    insert into catalogo.modelo_alias (alias_norm, modelo_id, ambiguo, candidatos, nota)
      values (catalogo.normalizar(r.alias), null, true, v_ids, 'alias-waka v3 2026-11-14: ambiguo, el agente pregunta' || coalesce(' (antes: ' || v_antes || ')', ''))
      on conflict (alias_norm) do update set modelo_id = null, ambiguo = true, candidatos = excluded.candidatos, nota = excluded.nota;
  end loop;

  -- 'Burst' a secas = Waka (alias global): deja de ser ambiguo y apunta a Waka 36K.
  select m.id into v_id from catalogo.modelo m where m.nombre_norm = catalogo.normalizar('Waka 36K') and m.unificado_en is null;
  if v_id is not null then
    update catalogo.modelo_alias a set modelo_id = v_id, ambiguo = false, candidatos = null,
           nota = 'alias-waka v3 2026-11-14: Burst = Waka 36K (antes: ' || case when a.ambiguo then 'ambiguo ' || array_to_string(a.candidatos, ',') else 'directo ' || a.modelo_id end || ')'
     where a.alias_norm = catalogo.normalizar('Burst') and (a.ambiguo or a.modelo_id <> v_id);
  end if;

  -- 'Titan' apuntaba al modelo generico 'Waka Sopro 30K' (que el agente deja de ofrecer): ahora va al modelo Waka Titan 30K.
  select m.id into v_id from catalogo.modelo m where m.nombre_norm = catalogo.normalizar('Waka Titan 30K') and m.unificado_en is null;
  if v_id is not null then
    update catalogo.modelo_alias a set modelo_id = v_id,
           nota = 'alias-waka v3 2026-11-14: Titan = Waka Titan 30K (antes: directo ' || a.modelo_id || ')'
     where a.alias_norm = catalogo.normalizar('Titan') and not a.ambiguo and a.modelo_id <> v_id;
  end if;
end $$;

-- 3. El agente no ofrece como opcion un modelo sin existencia cuyo nombre ES un texto ambiguo y que no es uno de sus candidatos (p. ej. el modelo generico 'Waka 50K').
--    Si tuviera existencia se sigue ofreciendo: nunca queda stock invisible para vender. Misma firma y mismos permisos que la version anterior.
create or replace function agente.catalogo_modelos() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id::text, 'nombre', m.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.modelo_alias a where a.modelo_id = m.id or m.id = any (a.candidatos)), '[]'::jsonb)) order by m.id)
    from catalogo.modelo m
   where m.unificado_en is null
     and not exists (select 1 from catalogo.modelo_alias a
                      where a.ambiguo and a.alias_norm = m.nombre_norm and not (m.id = any (a.candidatos))
                        and not exists (select 1 from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.modelo_id = m.id and e.piezas <> 0))), '[]'::jsonb);
end $$;
