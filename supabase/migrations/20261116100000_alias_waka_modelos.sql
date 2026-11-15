-- Alias oficiales de los modelos Waka (diccionario del dueno, 14-nov): el nombre con que los socios los llaman = el nombre por puffs.
-- ADITIVA y REVERSIBLE: solo inserta filas en catalogo.modelo_alias marcadas con la nota 'semilla alias-waka 2026-11-14' (reversa: delete from catalogo.modelo_alias where nota = 'semilla alias-waka 2026-11-14').
-- NUNCA unifica modelos ni mueve existencias: si un alias ya existe, o si su nombre es el nombre canonico de OTRO modelo (por ejemplo 'Waka Icon' = modelo 123), no se inserta (queda para la cola de confirmacion, ver docs/conciliacion-marcas-mrcactus.md).
-- 'Waka Optimus' (80K segun el diccionario; 100K en el catalogo y la tienda) NO se inserta hasta confirmar. Semilla legible: scripts/catalogo/alias-waka.json.
do $$
declare
  r record;
  v_destino bigint;
begin
  for r in select * from (values
    ('Waka Icon', 'Waka 50K'), ('Waka Steel', 'Waka 60K'), ('Waka SoPro', 'Waka 15K'), ('Smash Go', 'Waka GO 10K'), ('Waka Go', 'Waka GO 10K'),
    ('Waka PA30000', 'Waka 30K'), ('Waka Elite', 'Waka Elite 40K'), ('Waka Burst', 'Waka 36K'), ('Waka Blade', 'Waka Blade 33K'),
    ('Waka Slim', 'Waka Slim 12K'), ('Waka Jupiter', 'Waka Jupiter 50K'), ('Waka Icon Slim', 'Waka Icon Slim 20K')
  ) as t(alias, destino) loop
    select id into v_destino from catalogo.modelo where nombre_norm = catalogo.normalizar(r.destino);
    continue when v_destino is null;                                                          -- destino inexistente: no se inventa
    continue when exists (select 1 from catalogo.modelo where nombre_norm = catalogo.normalizar(r.alias));  -- coincide con otro modelo: cola de confirmacion
    insert into catalogo.modelo_alias (alias_norm, modelo_id, nota)
      values (catalogo.normalizar(r.alias), v_destino, 'semilla alias-waka 2026-11-14')
      on conflict (alias_norm) do nothing;                                                    -- ya existia (p. ej. 'waka sopro'): no se pisa
  end loop;
end $$;
