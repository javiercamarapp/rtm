-- Carril APRENDIZAJE, parte 3: contexto acotado para el prompt (por BUSQUEDA, nunca el catalogo completo), jerga, correcciones, ejemplos anonimizados y revision semanal. ADITIVA.
-- El modelo no se entrena: alias, jerga y ejemplos son DATOS que entran al prompt como contexto. Ninguna funcion de aqui calcula dinero.

create function agente._tokens(p_texto text) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(distinct t), '{}') from (select t from unnest(string_to_array(catalogo.normalizar(p_texto), ' ')) t where char_length(t) >= 3 limit 40) x
$$;

-- Contexto de aprendizaje para UN mensaje: solo lo que el texto menciona (alias, jerga) mas lo reciente (clientes con pedidos de los ultimos 45 dias) y hasta 4 ejemplos parecidos.
-- Tope duro de filas por clase: el catalogo completo jamas viaja al modelo.
create function agente.aprendizaje_contexto(p_args jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_texto text := coalesce(p_args ->> 'texto', ''); v_norm text; v_tok text[]; v_ventana int := agente._ventana_minutos();
  v_alias jsonb; v_jerga jsonb; v_ej jsonb; v_rec jsonb;
begin
  perform notificacion.exigir_sistema();
  v_norm := ' ' || catalogo.normalizar(left(v_texto, 2000)) || ' ';
  v_tok := agente._tokens(left(v_texto, 2000));
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_alias from (
    (select jsonb_build_object('clase', 'cliente', 'alias', a.alias_norm, 'oficial', c.nombre_canonico) x from catalogo.cliente_alias a join catalogo.cliente c on c.id = a.cliente_id
       where not a.ambiguo and (a.alias_norm = any (v_tok) or v_norm like '% ' || a.alias_norm || ' %') limit 12)
    union all
    (select jsonb_build_object('clase', 'sabor', 'alias', a.alias_norm, 'oficial', s.nombre_canonico) from catalogo.sabor_alias a join catalogo.sabor s on s.id = a.sabor_id
       where s.unificado_en is null and (a.alias_norm = any (v_tok) or v_norm like '% ' || a.alias_norm || ' %') limit 12)
    union all
    (select jsonb_build_object('clase', 'modelo', 'alias', a.alias_norm, 'oficial', m.nombre_canonico) from catalogo.modelo_alias a join catalogo.modelo m on m.id = a.modelo_id
       where not a.ambiguo and (a.alias_norm = any (v_tok) or v_norm like '% ' || a.alias_norm || ' %') limit 12)
    union all
    (select jsonb_build_object('clase', 'marca', 'alias', a.alias_norm, 'oficial', m.nombre) from catalogo.marca_alias a join catalogo.marca m on m.id = a.marca_id
       where a.alias_norm = any (v_tok) or v_norm like '% ' || a.alias_norm || ' %' limit 6)
    union all
    (select jsonb_build_object('clase', 'proveedor', 'alias', a.alias_norm, 'oficial', p.nombre) from catalogo.proveedor_alias a join catalogo.proveedor p on p.id = a.proveedor_id
       where a.alias_norm = any (v_tok) or v_norm like '% ' || a.alias_norm || ' %' limit 6)) q;
  -- Clientes recientes con sus alias (contexto aunque el texto no los nombre): hasta 8.
  select coalesce(jsonb_agg(jsonb_build_object('cliente', r.nombre, 'alias', r.alias)), '[]'::jsonb) into v_rec from (
    select c.nombre_canonico as nombre, (select coalesce(jsonb_agg(a.alias_norm), '[]'::jsonb) from (select a2.alias_norm from catalogo.cliente_alias a2 where a2.cliente_id = c.id and not a2.ambiguo limit 4) a) as alias
      from catalogo.cliente c where exists (select 1 from catalogo.cliente_alias x where x.cliente_id = c.id and not x.ambiguo)
       and exists (select 1 from operacion.pedido p where p.cliente_id = c.id and p.fecha_neg >= negocio.hoy() - 45)
     order by (select max(p.fecha_neg) from operacion.pedido p where p.cliente_id = c.id) desc, c.id limit 8) r;
  select coalesce(jsonb_agg(jsonb_build_object('termino', j.termino, 'tipo', j.tipo, 'significado', j.significado) order by j.termino_norm), '[]'::jsonb) into v_jerga from (
    select * from agente.jerga where activo and (termino_norm = any (v_tok) or v_norm like '% ' || termino_norm || ' %') order by char_length(termino_norm) desc limit 20) j;
  select coalesce(jsonb_agg(jsonb_build_object('operacion', e.operacion, 'texto', e.texto_anonimo)), '[]'::jsonb) into v_ej from (
    select ej.* from agente.ejemplo ej
     where ej.creado_at <= clock_timestamp() - make_interval(mins => v_ventana)
       and (ej.folio is null or (
            not exists (select 1 from agente.hecho h where h.folio = ej.folio and h.deshecho_at is not null)
        and not exists (select 1 from agente.huella u where u.folio = ej.folio and u.anulada_at is not null)
        and not exists (select 1 from operacion.pedido pe where pe.folio = ej.folio and pe.estado in ('cancelado', 'anulado'))))
       and ej.palabras && v_tok
     order by cardinality(array(select unnest(ej.palabras) intersect select unnest(v_tok))) desc, ej.id desc limit 4) e;
  return jsonb_build_object('alias', v_alias, 'recientes', v_rec, 'jerga', v_jerga, 'ejemplos', v_ej);
end $$;

-- Agregar jerga o una abreviatura propia de los socios (la confirma un socio verificado; la semilla ya viene en la migracion).
create function agente.jerga_agregar(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_prev jsonb; v_t text; v_norm text; v_sig text; v_tipo text := lower(coalesce(nullif(p_args ->> 'tipo', ''), 'abreviatura')); v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_tipo not in ('jerga', 'abreviatura') then raise exception 'tipo invalido' using errcode = 'P0460'; end if;
  v_t := catalogo.nombre_alta_valido(p_args ->> 'termino', 40);
  v_sig := catalogo.nombre_alta_valido(p_args ->> 'significado', 120);
  v_norm := catalogo.normalizar(v_t);
  if v_norm = '' then raise exception 'el termino no tiene letras ni numeros' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'jerga_agregar', 't', v_norm, 's', v_sig));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  insert into agente.jerga (termino_norm, termino, tipo, significado, origen, creada_por) values (v_norm, v_t, v_tipo, v_sig, 'socio', v_autor)
    on conflict (termino_norm) do update set significado = excluded.significado, activo = true, origen = 'socio', creada_por = excluded.creada_por;
  v_res := jsonb_build_object('estado', 'guardado', 'aviso_grupo', format('%s enseno: "%s" significa %s.', initcap(v_autor), v_t, v_sig));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Una correccion del socio ("no, era Memo Lopez"): alimenta el diccionario. Con dos iguales se SUGIERE un alias; nunca se guarda solo.
create function agente.correccion_registrar(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_prev jsonb; v_clase text := lower(coalesce(p_args ->> 'clase', '')); v_norm text := catalogo.normalizar(coalesce(p_args ->> 'dicho_texto', '')); v_dest jsonb; v_veces int; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_clase not in ('cliente', 'sabor', 'modelo', 'marca', 'proveedor') or v_norm = '' then raise exception 'correccion invalida' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'correccion_registrar', 'c', v_clase, 'd', v_norm, 'o', p_args ->> 'correcto_texto'));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  v_dest := agente._alias_destino(v_clase, coalesce(p_args ->> 'correcto_texto', ''));
  if v_dest is null or agente._alias_ocupado(v_clase, v_norm) is not null then
    v_res := jsonb_build_object('estado', 'ignorada', 'sugerir_alias', false);
  else
    insert into agente.correccion_aprendida (clase, dicho_norm, destino_id, ultima_por) values (v_clase, v_norm, (v_dest ->> 'id')::bigint, v_autor)
      on conflict (clase, dicho_norm, destino_id) do update set veces = agente.correccion_aprendida.veces + 1, ultima_por = excluded.ultima_por, ultima_at = clock_timestamp()
      returning veces into v_veces;
    v_res := jsonb_build_object('estado', 'registrada', 'veces', v_veces, 'oficial', v_dest ->> 'nombre',
      'sugerir_alias', v_veces >= 2 and not exists (select 1 from agente.alias_negativo n where n.clase = v_clase and n.alias_norm = v_norm and n.destino_id = (v_dest ->> 'id')::bigint));
  end if;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Ejemplo anonimizado (el texto ya viene sin nombres ni cifras desde TypeScript; aqui se vuelve a exigir: sin digitos, sin arrobas ni enlaces).
create function agente.ejemplo_registrar(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_txt text := btrim(coalesce(p_args ->> 'texto_anonimo', '')); v_op text := coalesce(p_args ->> 'operacion', ''); v_id bigint; v_pal text[];
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_txt ~ '[0-9@]' or v_txt ~* '(http|www\.)' or char_length(v_txt) not between 5 and 200 or v_op !~ '^[a-z_]{3,40}$' then
    raise exception 'el ejemplo no esta anonimizado' using errcode = 'P0460';
  end if;
  v_pal := agente._tokens(v_txt);
  insert into agente.ejemplo (operacion, texto_anonimo, palabras, folio, autor, clave_idem) values (v_op, v_txt, v_pal, nullif(p_args ->> 'folio', ''), v_autor, p_clave_idem)
    on conflict (clave_idem) do nothing returning id into v_id;
  return jsonb_build_object('estado', case when v_id is null then 'repetido' else 'guardado' end, 'ejemplo_id', v_id);
end $$;

-- Revision semanal: resumen de lo aprendido entre dos fechas (para el digest del grupo). Solo cuenta y nombra datos de catalogo; ninguna cifra de dinero.
create function agente.aprendizaje_resumen(p_desde timestamptz default null, p_hasta timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_d timestamptz := coalesce(p_desde, clock_timestamp() - interval '7 days'); v_h timestamptz := coalesce(p_hasta, clock_timestamp());
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object(
    'desde', v_d, 'hasta', v_h,
    'alias_nuevos', coalesce((select jsonb_agg(jsonb_build_object('clase', a.clase, 'alias', a.alias_norm, 'confirmo', a.confirmado_por) order by a.id) from agente.alias_aprendido a where a.creado_at >= v_d and a.creado_at < v_h and a.revertido_at is null), '[]'::jsonb),
    'alias_negados', (select count(*) from agente.alias_negativo n where n.creado_at >= v_d and n.creado_at < v_h),
    'jerga_nueva', coalesce((select jsonb_agg(j.termino order by j.termino) from agente.jerga j where j.origen <> 'semilla' and j.creada_at >= v_d and j.creada_at < v_h), '[]'::jsonb),
    'correcciones_repetidas', coalesce((select jsonb_agg(jsonb_build_object('clase', c.clase, 'dicho', c.dicho_norm, 'veces', c.veces) order by c.veces desc) from agente.correccion_aprendida c
        where c.veces >= 2 and c.ultima_at >= v_d and c.ultima_at < v_h
          and not exists (select 1 from agente.alias_negativo n where n.clase = c.clase and n.alias_norm = c.dicho_norm and n.destino_id = c.destino_id)), '[]'::jsonb),
    'ejemplos_nuevos', (select count(*) from agente.ejemplo e where e.creado_at >= v_d and e.creado_at < v_h),
    'sabores_unidos', (select count(*) from catalogo.unificacion_sabor u where u.estado = 'aplicada' and u.creada_at >= v_d and u.creada_at < v_h),
    'duplicados_pendientes', jsonb_build_object(
      'sabor', (select count(*) from catalogo.posible_duplicado p where p.tipo = 'sabor' and p.estado = 'pendiente'),
      'cliente', (select count(*) from catalogo.posible_duplicado p where p.tipo = 'cliente' and p.estado = 'pendiente'),
      'modelo', (select count(*) from catalogo.posible_duplicado p where p.tipo = 'modelo' and p.estado = 'pendiente')));
end $$;

revoke all on function agente._tokens(text) from public, anon, authenticated;
revoke all on function agente.aprendizaje_contexto(jsonb), agente.jerga_agregar(text, jsonb), agente.correccion_registrar(text, jsonb), agente.ejemplo_registrar(text, jsonb),
  agente.aprendizaje_resumen(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function agente.aprendizaje_contexto(jsonb), agente.jerga_agregar(text, jsonb), agente.correccion_registrar(text, jsonb), agente.ejemplo_registrar(text, jsonb),
  agente.aprendizaje_resumen(timestamptz, timestamptz) to servidor;
