-- Digest con techo de mensajes, consultas del bot (que se vende y que reponer), minimo manual por modelo y sabor, y diff de lista cargada (Isaac, sin fuente viva).
-- El envio real lo hace el reloj/TypeScript con transporte; aqui solo se decide QUE sale: horario de silencio, 3 inmediatos al dia, 6 mensajes al dia (los criticos saltan el tope pero cuentan).

-- ------------------------------------------------------------------ digest: armar y confirmar
create function agente.avisos_digest_armar(p_ventana text, p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_t jsonb; v_dia date := (v_ahora at time zone 'America/Merida')::date; v_hora int := extract(hour from (v_ahora at time zone 'America/Merida'))::int;
  v_total int; v_inm int; v_max int; v_silencio boolean; v_items jsonb; v_pend int;
begin
  perform notificacion.exigir_sistema();
  if p_ventana not in ('I', 'M', 'R', 'S') then raise exception 'ventana invalida' using errcode = '22023'; end if;
  if not coalesce((select i.activo from seguridad.interruptor i where i.clave = 'avisos_inventario'), false) then return jsonb_build_object('estado', 'apagado', 'items', '[]'::jsonb); end if;
  select umbral into v_t from agente.aviso_regla where codigo = '_tope';
  v_max := (v_t ->> 'max_lineas')::int;
  select count(*)::int, count(*) filter (where ventana = 'I')::int into v_total, v_inm from agente.aviso_digest where dia = v_dia;
  v_silencio := v_hora >= (v_t ->> 'silencio_ini')::int or v_hora < (v_t ->> 'silencio_fin')::int;
  with cand as (
    select q.id, q.codigo, q.canal, q.severidad, q.payload, q.creado_at,
           row_number() over (order by (q.severidad = 'C') desc, (q.severidad = 'I') desc, q.id) as rn
      from agente.aviso_cola q
     where q.estado = 'pendiente'
       and case p_ventana
             when 'I' then q.canal = 'I' and (not v_silencio or q.severidad = 'C') and (v_inm < (v_t ->> 'inmediatos_dia')::int or q.severidad = 'C') and (v_total < (v_t ->> 'tope_dia')::int or q.severidad = 'C')
             when 'M' then q.canal in ('M', 'I') and (v_total < (v_t ->> 'tope_dia')::int or q.severidad = 'C')
             when 'R' then q.canal = 'R' and v_total < (v_t ->> 'tope_dia')::int
             else q.canal = 'S' and v_total < (v_t ->> 'tope_dia')::int end)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'canal', c.canal, 'severidad', c.severidad, 'payload', c.payload) order by c.rn) filter (where c.rn <= v_max), '[]'::jsonb),
         count(*) filter (where c.rn > v_max)::int
    into v_items, v_pend from cand c;
  return jsonb_build_object('estado', 'ok', 'ventana', p_ventana, 'items', v_items, 'restantes', v_pend, 'mensajes_hoy', v_total, 'inmediatos_hoy', v_inm);
end $$;

create function agente.avisos_digest_confirmar(p_ventana text, p_ids bigint[], p_ahora timestamptz default null) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_id bigint; v_n int;
begin
  perform notificacion.exigir_sistema();
  if p_ventana not in ('I', 'M', 'R', 'S') then raise exception 'ventana invalida' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return null; end if;
  insert into agente.aviso_digest (dia, ventana, items, enviado_at) values ((v_ahora at time zone 'America/Merida')::date, p_ventana, array_length(p_ids, 1), v_ahora) returning id into v_id;
  update agente.aviso_cola set estado = 'enviado', enviado_at = v_ahora, digest_id = v_id where id = any (p_ids) and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n = 0 then delete from agente.aviso_digest where id = v_id; return null; end if;
  update agente.aviso_digest set items = v_n where id = v_id;
  return v_id;
end $$;

-- ------------------------------------------------------------------ consultas del bot (solo lectura; piezas y conteos, nunca costos ni margenes)
create function agente.consulta_inventario(p_tipo text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy(); v_lin jsonb;
begin
  perform notificacion.exigir_sistema();
  if p_tipo = 'mas_vendido' then
    select coalesce(jsonb_agg(l order by o desc), '[]'::jsonb) into v_lin from (
      select jsonb_build_object('etiqueta', upper(m.nombre_canonico), 'piezas', q.p) as l, 1000 - q.rn as o
        from (select x.modelo_id, sum(x.piezas_pedidas)::int as p, row_number() over (order by sum(x.piezas_pedidas) desc, x.modelo_id) as rn
                from operacion.pedido_linea x join operacion.pedido pe on pe.id = x.pedido_id where pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > v_hoy - 28 group by x.modelo_id) q
        join catalogo.modelo m on m.id = q.modelo_id where q.rn <= 5
      union all
      select jsonb_build_object('etiqueta', 'Sabor: ' || upper(m.nombre_canonico) || ' ' || upper(sb.nombre_canonico), 'piezas', q.p), 500 - q.rn
        from (select x.sku_id, sum(x.piezas_pedidas)::int as p, row_number() over (order by sum(x.piezas_pedidas) desc, x.sku_id) as rn
                from operacion.pedido_linea x join operacion.pedido pe on pe.id = x.pedido_id where pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > v_hoy - 28 group by x.sku_id) q
        join catalogo.sku k on k.id = q.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sb on sb.id = k.sabor_id where q.rn <= 5
      union all
      select jsonb_build_object('etiqueta', 'En Karen: ' || upper(m.nombre_canonico), 'texto', count(*) filter (where v.disponible) || ' de ' || count(*) || ' sabores disponibles'), 100 - dense_rank() over (order by m.nombre_canonico)
        from proveedores.modelo pm join proveedores.variante v on v.producto_id = pm.producto_id and v.estado <> 'descontinuada' join catalogo.modelo m on m.id = pm.canonico_id::bigint
       where pm.canonico_id is not null and pm.estado <> 'descontinuado' and m.id in (
         select x.modelo_id from operacion.pedido_linea x join operacion.pedido pe on pe.id = x.pedido_id where pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > v_hoy - 28 group by x.modelo_id order by sum(x.piezas_pedidas) desc limit 5)
       group by m.nombre_canonico
    ) t;
    if jsonb_array_length(v_lin) = 0 then v_lin := jsonb_build_array(jsonb_build_object('etiqueta', 'Ventas de los ultimos 28 dias', 'texto', 'Todavia no hay ventas registradas en ese periodo.')); end if;
    return jsonb_build_object('titulo', 'Lo que mas se vende (ultimos 28 dias)', 'lineas', v_lin);
  elsif p_tipo = 'reponer' then
    select coalesce(jsonb_agg(l order by o), '[]'::jsonb) into v_lin from (
      select jsonb_build_object('etiqueta', upper(e.p ->> 'modelo') || ' ' || upper(e.p ->> 'sabor'),
               'texto', 'quedan ' || (e.p ->> 'disponible') || ' pz' || case when (e.p ->> 'transito')::int > 0 then ', en camino ' || (e.p ->> 'transito') || ' pz' else '' end
                        || case when e.p ->> 'estado' = 'estimado' then ', minimo ' || coalesce(e.p ->> 'minimo', '?') || ' pz (estimado)' else ', ' || coalesce(e.p ->> 'dias', '?') || ' dias de venta' end) as l, 1 as o
        from agente._ev_inv_reponer(v_hoy, clock_timestamp()) e
      union all
      select jsonb_build_object('etiqueta', upper(e.p ->> 'modelo') || ' ' || upper(e.p ->> 'sabor'), 'texto', 'agotado; vendio ' || (e.p ->> 'vendidas_ventana') || ' pz en 28 dias'), 2
        from agente._ev_inv_agotado(v_hoy, clock_timestamp()) e) t;
    if jsonb_array_length(v_lin) = 0 then v_lin := jsonb_build_array(jsonb_build_object('etiqueta', 'Reposicion', 'texto', 'Nada por reponer con los criterios actuales. Con menos de 28 dias de historia se usa el minimo que fijas con /minimo.')); end if;
    return jsonb_build_object('titulo', 'Que reponer', 'lineas', v_lin);
  end if;
  raise exception 'consulta desconocida' using errcode = '22023';
end $$;

-- ------------------------------------------------------------------ minimo manual por modelo y sabor (el bot pregunta lo que falte y solo escribe con todo)
create function agente._minimo_resolver(p_texto text, out modelo_id bigint, out sabor_id bigint, out modelo text, out sabor text) returns record
language plpgsql stable security definer set search_path = ''
as $$
declare w text[]; n int; i int; m jsonb; s jsonb;
begin
  w := regexp_split_to_array(btrim(coalesce(p_texto, '')), '\s+');
  n := coalesce(array_length(w, 1), 0);
  if n = 0 or w[1] = '' then return; end if;
  -- Primero "modelo sabor" (el modelo mas largo que exista), luego solo modelo.
  for i in reverse n - 1 .. 1 loop
    m := agente._alias_destino('modelo', array_to_string(w[1:i], ' '));
    s := agente._alias_destino('sabor', array_to_string(w[i + 1:n], ' '));
    if m is not null and s is not null then modelo_id := (m ->> 'id')::bigint; modelo := m ->> 'nombre'; sabor_id := (s ->> 'id')::bigint; sabor := s ->> 'nombre'; return; end if;
  end loop;
  m := agente._alias_destino('modelo', array_to_string(w, ' '));
  if m is not null then modelo_id := (m ->> 'id')::bigint; modelo := m ->> 'nombre'; end if;
end $$;

create function agente.minimo_paso(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_chat bigint := (p_args ->> 'chat_id')::bigint; v_texto text := btrim(coalesce(p_args ->> 'texto', ''));
  pe agente.minimo_pendiente; v_tok text; v_pz int; v_modelo bigint; v_sabor bigint; v_mn text; v_sn text; r record; v_sku bigint; v_prev int; v_res jsonb; v_prev_op jsonb; v_raro boolean := false;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_chat is null then raise exception 'falta el chat' using errcode = '22023'; end if;
  -- Reintento de un registro ya hecho (mismo update): devuelve lo aplicado sin volver a preguntar.
  select o.resultado into v_prev_op from seguridad.operacion o where o.clave = p_clave_idem and o.resultado is not null;
  if v_prev_op is not null then return v_prev_op || jsonb_build_object('repetido', true); end if;
  select * into pe from agente.minimo_pendiente where chat_id = v_chat and autor = v_autor and creado_at > clock_timestamp() - interval '15 minutes';
  v_modelo := pe.modelo_id; v_sabor := pe.sabor_id; v_pz := pe.piezas;
  -- Cifra al final: solo digitos completos. Con k o mil (o decimales) se repite y se pregunta.
  v_tok := (regexp_match(v_texto, '(\S+)\s*$'))[1];
  if v_tok is not null and v_tok ~ '^\d+$' then v_pz := v_tok::int; v_texto := btrim(regexp_replace(v_texto, '\S+\s*$', ''));
  elsif v_tok is not null and v_tok ~* '^\d+([.,]\d+)?(k|mil)$' or v_texto ~* '\d\s*mil\M' then v_raro := true; v_texto := btrim(regexp_replace(v_texto, '\S+\s*$', ''));
  end if;
  if v_texto <> '' then
    if v_modelo is null then
      select * into r from agente._minimo_resolver(v_texto);
      v_modelo := r.modelo_id; v_sabor := r.sabor_id;
    elsif v_sabor is null then
      v_sabor := (agente._alias_destino('sabor', v_texto) ->> 'id')::bigint;
    end if;
  end if;
  select nombre_canonico into v_mn from catalogo.modelo where id = v_modelo;
  select nombre_canonico into v_sn from catalogo.sabor where id = v_sabor;
  if v_modelo is null or v_sabor is null or v_pz is null then
    insert into agente.minimo_pendiente (chat_id, autor, modelo_id, sabor_id, piezas) values (v_chat, v_autor, v_modelo, v_sabor, v_pz)
      on conflict (chat_id, autor) do update set modelo_id = excluded.modelo_id, sabor_id = excluded.sabor_id, piezas = excluded.piezas, creado_at = clock_timestamp();
    return jsonb_build_object('estado', 'pregunta', 'falta', case when v_modelo is null then 'modelo' when v_sabor is null then 'sabor' else 'piezas' end,
      'texto', case
        when v_raro then 'Escribe la cifra completa de piezas, sin k ni mil. Por ejemplo 200.'
        when v_modelo is null then '¿De qué modelo y sabor quieres fijar el mínimo? Por ejemplo: nexa mango 20.'
        when v_sabor is null then format('¿De qué sabor de %s?', upper(v_mn))
        else format('¿Cuántas piezas es el mínimo de %s %s? Escribe la cifra completa.', upper(v_mn), upper(v_sn)) end);
  end if;
  select k.id into v_sku from catalogo.sku k where k.modelo_id = v_modelo and k.sabor_id = v_sabor and k.activo and k.unificado_en is null;
  if v_sku is null then
    delete from agente.minimo_pendiente where chat_id = v_chat and autor = v_autor;
    return jsonb_build_object('estado', 'sin_sku', 'texto', format('%s no tiene el sabor %s en el catálogo. Dalo de alta primero.', upper(v_mn), upper(v_sn)));
  end if;
  v_prev_op := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'minimo_paso', 'sku', v_sku, 'pz', v_pz));
  if v_prev_op is not null then return v_prev_op || jsonb_build_object('repetido', true); end if;
  select m.min_pz into v_prev from agente.minimo_manual m where m.sku_id = v_sku and m.vigente_hasta is null;
  if v_prev = v_pz then
    v_res := jsonb_build_object('estado', 'sin_cambio', 'texto', format('El mínimo de %s %s ya era de %s piezas.', upper(v_mn), upper(v_sn), v_pz));
  else
    update agente.minimo_manual set vigente_hasta = clock_timestamp() where sku_id = v_sku and vigente_hasta is null;
    insert into agente.minimo_manual (sku_id, min_pz, fijado_por) values (v_sku, v_pz, v_autor);
    v_res := jsonb_build_object('estado', 'registrado', 'sku_id', v_sku, 'piezas', v_pz, 'antes', v_prev,
      'texto', format('Mínimo registrado: %s %s en %s piezas.', upper(v_mn), upper(v_sn), v_pz),
      'aviso_grupo', format('%s fijó el mínimo de %s %s en %s piezas%s. Las alertas de reposición lo usan mientras no haya 28 días de historia.', initcap(v_autor), upper(v_mn), upper(v_sn), v_pz, case when v_prev is null then '' else format(' (antes %s)', v_prev) end));
  end if;
  delete from agente.minimo_pendiente where chat_id = v_chat and autor = v_autor;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------------ diff de lista cargada a mano (Isaac no tiene fuente viva). Solo compara nombres; el costo solo como sentido y porcentaje entero.
create function agente.lista_proveedor_diff(p_proveedor text, p_lista jsonb, p_emitir boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prov bigint := catalogo.proveedor_id(p_proveedor); it jsonb; sb text; m jsonb; s jsonb; v_ids bigint[] := '{}'; v_nuevos jsonb := '[]'; v_aus jsonb := '[]'; v_sab jsonb := '[]'; v_cos jsonb := '[]';
  v_costo bigint; v_nuevo bigint; v_total int; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  if jsonb_typeof(p_lista) is distinct from 'array' then raise exception 'la lista debe ser un arreglo' using errcode = '22023'; end if;
  for it in select * from jsonb_array_elements(p_lista) loop
    m := agente._alias_destino('modelo', it ->> 'modelo');
    if m is null then v_nuevos := v_nuevos || to_jsonb(upper(it ->> 'modelo')); continue; end if;
    v_ids := v_ids || (m ->> 'id')::bigint;
    for sb in select jsonb_array_elements_text(coalesce(it -> 'sabores', '[]'::jsonb)) loop
      s := agente._alias_destino('sabor', sb);
      if s is null or not exists (select 1 from catalogo.sku k where k.modelo_id = (m ->> 'id')::bigint and k.sabor_id = (s ->> 'id')::bigint) then v_sab := v_sab || to_jsonb(upper(m ->> 'nombre') || ' ' || upper(sb)); end if;
    end loop;
    v_nuevo := nullif(it ->> 'costo_cent', '')::bigint;
    select cp.costo_cent into v_costo from catalogo.costo_proveedor cp where cp.proveedor_id = v_prov and cp.modelo_id = (m ->> 'id')::bigint and cp.vigente_hasta is null order by cp.id desc limit 1;
    if v_nuevo is not null and v_costo is not null and v_costo > 0 and v_nuevo <> v_costo then
      v_cos := v_cos || jsonb_build_object('modelo', upper(m ->> 'nombre'), 'sentido', case when v_nuevo > v_costo then 'sube' else 'baja' end, 'pct', round(abs(v_nuevo - v_costo) * 100.0 / v_costo)::int);
    end if;
  end loop;
  select coalesce(jsonb_agg(upper(mo.nombre_canonico) order by mo.nombre_canonico), '[]') into v_aus
    from catalogo.modelo mo where mo.unificado_en is null and exists (select 1 from catalogo.costo_proveedor cp where cp.proveedor_id = v_prov and cp.modelo_id = mo.id and cp.vigente_hasta is null) and mo.id <> all (v_ids);
  v_total := jsonb_array_length(v_nuevos) + jsonb_array_length(v_aus) + jsonb_array_length(v_sab) + jsonb_array_length(v_cos);
  v_res := jsonb_build_object('proveedor', initcap(p_proveedor), 'modelos_nuevos', v_nuevos, 'modelos_ausentes', v_aus, 'sabores_nuevos', v_sab, 'costos', v_cos, 'cambios', v_total);
  if p_emitir and v_total > 0 then
    perform agente.aviso_encolar('prv_lista', 'prv_lista|' || lower(p_proveedor) || '|' || md5(v_res::text), v_res);
  end if;
  return v_res;
end $$;

revoke all on function agente._minimo_resolver(text) from public, anon, authenticated, servidor;
revoke all on function agente.avisos_digest_armar(text, timestamptz), agente.avisos_digest_confirmar(text, bigint[], timestamptz), agente.consulta_inventario(text),
  agente.minimo_paso(text, jsonb), agente.lista_proveedor_diff(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function agente.avisos_digest_armar(text, timestamptz), agente.avisos_digest_confirmar(text, bigint[], timestamptz), agente.consulta_inventario(text),
  agente.minimo_paso(text, jsonb), agente.lista_proveedor_diff(text, jsonb, boolean) to servidor;

-- Hay una pregunta abierta de /minimo para este socio en este chat? (el interceptor la usa para tomar la respuesta sin confundirla con otro mensaje)
create function agente.minimo_hay_pregunta(p_chat bigint, p_autor text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from agente.minimo_pendiente where chat_id = p_chat and autor = lower(p_autor) and creado_at > clock_timestamp() - interval '15 minutes') $$;
revoke all on function agente.minimo_hay_pregunta(bigint, text) from public, anon, authenticated;
grant execute on function agente.minimo_hay_pregunta(bigint, text) to servidor;
