-- Decision del dueno (16-nov): "siempre 50 % y 50 %" es implicito y no se escribe en nada que salga del software. Reescribe SOLO los textos visibles (literales) de las funciones que los
-- generan (Explicar este numero, reportes, notas): mismo codigo, mismas firmas y privilegios (create or replace con la definicion actual de cada funcion). No toca datos ni
-- documentos ya sellados (las actas firmadas conservan su texto). Aditiva e idempotente: si no queda ningun texto con esa leyenda no hace nada.
do $$
declare
  f record; v_def text; v_nuevo text; v_n int := 0; v_resto text;
  v_pares text[][] := array[
    ['repartida 50/50 con la misma regla', 'repartida con la misma regla'],
    ['Su parte de la utilidad repartible (50/50 fijo)', 'Su parte de la utilidad repartible'],
    ['Utilidades acumuladas iguales (50 % y 50 %)', 'Utilidades acumuladas iguales'],
    ['Su 50 % de la utilidad que aun no pasa por un acta (participacion siempre 50/50)', 'Su parte de la utilidad que aun no pasa por un acta'],
    ['La participacion es siempre 50/50. Aportar mas', 'Aportar mas'],
    ['La participacion es siempre 50/50 (utilidad y propiedad); aportar mas', 'Aportar mas'],
    ['mas su 50 % de la utilidad aun sin acta', 'mas su parte de la utilidad aun sin acta'],
    ['mas su 50 % de la utilidad, menos los fondos', 'mas su parte de la utilidad, menos los fondos'],
    ['lo absorbe la sociedad (50/50)', 'lo absorbe la sociedad'],
    [' (se reparte 50/50 en la utilidad)', ''],
    ['(centavo suelto del reparto 50/50)', '(centavo suelto del reparto)'],
    ['50/50 fijo', 'fijo']
  ];
  i int;
begin
  for f in
    select p.oid, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('api', 'operacion', 'contabilidad', 'agente', 'catalogo', 'notificacion', 'proveedores', 'cobranza', 'omar', 'seguridad', 'negocio', 'reloj')
       and p.prokind = 'f' and p.prosrc ~ '(50 ?/ ?50|50 ?% y 50|su 50 ?%|siempre 50)'
  loop
    v_def := pg_get_functiondef(f.oid);
    v_nuevo := v_def;
    for i in 1 .. array_length(v_pares, 1) loop
      v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
    end loop;
    if v_nuevo <> v_def then execute v_nuevo; v_n := v_n + 1; end if;
  end loop;
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_resto from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('api', 'operacion', 'contabilidad', 'agente', 'catalogo', 'notificacion', 'proveedores', 'cobranza', 'omar', 'seguridad', 'negocio', 'reloj')
     and p.prokind = 'f' and p.prosrc ~ '(\mliteral|^)' and (regexp_replace(p.prosrc, '--[^\n]*', '', 'g')) ~ '''[^'']*(50 ?/ ?50|50 ?% y 50|su 50 ?%|siempre 50)[^'']*''';
  raise notice 'funciones reescritas: %; con leyenda restante en literales: %', v_n, coalesce(v_resto, 'ninguna');
end $$;
