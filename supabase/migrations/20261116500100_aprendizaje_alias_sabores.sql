-- Carril APRENDIZAJE, parte 2: memoria de preguntas del servidor, alias que el bot aprende (con confirmacion de un socio) y cableado de la unificacion de sabores por Telegram.
-- ADITIVA: funciones nuevas en agente.*; agente.sabor_deshacer se envuelve (rename + wrap) para aplicar la ventana de 10 minutos tambien a las uniones de sabores.
-- Frenos: proponer y contestar un alias exigen la escritura encendida (el bot ARRANCA en solo lectura); deshacer nunca se bloquea por el interruptor.
-- El modelo de IA NUNCA decide ni pone ids: el id de la pregunta sale de agente.pregunta_pendiente (memoria del servidor).

-- ---------------------------------------------------------------- memoria de preguntas
create function agente._pregunta_abrir(p_chat bigint, p_tipo text, p_ref bigint, p_texto text, p_datos jsonb, p_por text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  update agente.pregunta_pendiente set estado = 'cancelada', cerrada_at = clock_timestamp() where chat_id = p_chat and estado = 'abierta';
  insert into agente.pregunta_pendiente (chat_id, tipo, ref_id, texto, datos, abierta_por, expira_at)
    values (p_chat, p_tipo, p_ref, p_texto, coalesce(p_datos, '{}'::jsonb), p_por, clock_timestamp() + interval '12 hours') returning id into v_id;
  return v_id;
end $$;

-- La pregunta abierta y vigente de un chat (o null). Solo lectura: "si/ok/dale" cuentan como respuesta unicamente si esto devuelve algo.
create function agente.pregunta_vigente(p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select jsonb_build_object('id', p.id, 'tipo', p.tipo, 'ref_id', p.ref_id, 'texto', p.texto, 'datos', p.datos, 'abierta_por', p.abierta_por)
            from agente.pregunta_pendiente p where p.chat_id = p_chat and p.estado = 'abierta' and p.expira_at > clock_timestamp());
end $$;

create function agente.pregunta_mensaje(p_chat bigint, p_id bigint, p_mensaje_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  update agente.pregunta_pendiente set mensaje_id = p_mensaje_id where id = p_id and chat_id = p_chat and estado = 'abierta';
end $$;

create function agente.pregunta_cancelar(p_chat bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v int;
begin
  perform notificacion.exigir_sistema();
  update agente.pregunta_pendiente set estado = 'cancelada', cerrada_at = clock_timestamp() where chat_id = p_chat and estado = 'abierta';
  get diagnostics v = row_count;
  return jsonb_build_object('canceladas', v);
end $$;

-- ---------------------------------------------------------------- alias: resolver el destino oficial
-- Devuelve {id, nombre} del oficial por nombre o por alias directo, o null.
create function agente._alias_destino(p_clase text, p_texto text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare n text := catalogo.normalizar(p_texto); v_id bigint; v_nombre text;
begin
  if p_clase = 'cliente' then
    select c.id, c.nombre_canonico into v_id, v_nombre from catalogo.cliente c where c.nombre_norm = n and c.activo;
    if v_id is null then select c.id, c.nombre_canonico into v_id, v_nombre from catalogo.cliente_alias a join catalogo.cliente c on c.id = a.cliente_id where a.alias_norm = n and not a.ambiguo and c.activo; end if;
  elsif p_clase = 'sabor' then
    select s.id, s.nombre_canonico into v_id, v_nombre from catalogo.sabor s where s.nombre_norm = n and s.unificado_en is null;
    if v_id is null then select s.id, s.nombre_canonico into v_id, v_nombre from catalogo.sabor_alias a join catalogo.sabor s on s.id = a.sabor_id where a.alias_norm = n and s.unificado_en is null; end if;
  elsif p_clase = 'modelo' then
    select m.id, m.nombre_canonico into v_id, v_nombre from catalogo.modelo m where m.nombre_norm = n;
    if v_id is null then select m.id, m.nombre_canonico into v_id, v_nombre from catalogo.modelo_alias a join catalogo.modelo m on m.id = a.modelo_id where a.alias_norm = n and not a.ambiguo; end if;
  elsif p_clase = 'marca' then
    select m.id, m.nombre into v_id, v_nombre from catalogo.marca m where m.nombre_norm = n;
    if v_id is null then select m.id, m.nombre into v_id, v_nombre from catalogo.marca_alias a join catalogo.marca m on m.id = a.marca_id where a.alias_norm = n; end if;
  elsif p_clase = 'proveedor' then
    v_id := catalogo.proveedor_id(p_texto);
    if v_id is not null then select p.nombre into v_nombre from catalogo.proveedor p where p.id = v_id; end if;
  end if;
  if v_id is null then return null; end if;
  return jsonb_build_object('id', v_id, 'nombre', v_nombre);
end $$;

-- Quien es dueno de ese nombre en esa clase (canonico o alias): para detectar conflictos. Devuelve el id destino o null.
create function agente._alias_ocupado(p_clase text, p_norm text) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v bigint;
begin
  if p_clase = 'cliente' then
    select c.id into v from catalogo.cliente c where c.nombre_norm = p_norm;
    if v is null then select coalesce(a.cliente_id, -1) into v from catalogo.cliente_alias a where a.alias_norm = p_norm; end if;
  elsif p_clase = 'sabor' then
    select s.id into v from catalogo.sabor s where s.nombre_norm = p_norm;
    if v is null then select a.sabor_id into v from catalogo.sabor_alias a where a.alias_norm = p_norm; end if;
  elsif p_clase = 'modelo' then
    select m.id into v from catalogo.modelo m where m.nombre_norm = p_norm;
    if v is null then select coalesce(a.modelo_id, -1) into v from catalogo.modelo_alias a where a.alias_norm = p_norm; end if;
  elsif p_clase = 'marca' then
    select m.id into v from catalogo.marca m where m.nombre_norm = p_norm;
    if v is null then select a.marca_id into v from catalogo.marca_alias a where a.alias_norm = p_norm; end if;
  elsif p_clase = 'proveedor' then
    v := catalogo.proveedor_id(p_norm);
    if v is null then select a.proveedor_id into v from catalogo.proveedor_alias a where a.alias_norm = p_norm; end if;
  end if;
  return v;
end $$;

create function agente._mostrar(p_clase text, p_texto text) returns text
language sql immutable set search_path = ''
as $$ select case when p_clase in ('sabor', 'modelo', 'marca') then upper(p_texto) else p_texto end $$;

-- ---------------------------------------------------------------- alias: proponer
create function agente.alias_proponer(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_clase text := lower(coalesce(p_args ->> 'clase', '')); v_chat bigint := nullif(p_args ->> 'chat_id', '')::bigint;
  v_alias text; v_oficial text; v_norm text; v_dest jsonb; v_ocupado bigint; v_pid bigint; v_sug jsonb; v_texto text; v_mem bigint;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_clase not in ('cliente', 'sabor', 'modelo', 'marca', 'proveedor') then raise exception 'clase de alias invalida' using errcode = 'P0460'; end if;
  if v_chat is null then raise exception 'falta el chat de la pregunta' using errcode = 'P0460'; end if;
  v_alias := catalogo.nombre_alta_valido(p_args ->> 'alias_texto', 60);
  v_oficial := catalogo.nombre_alta_valido(p_args ->> 'oficial_texto', 60);
  v_norm := catalogo.normalizar(v_alias);
  if v_norm = '' then raise exception 'el alias no tiene letras ni numeros' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alias_proponer', 'c', v_clase, 'a', v_norm, 'o', catalogo.normalizar(v_oficial), 'ch', v_chat));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  v_dest := agente._alias_destino(v_clase, v_oficial);
  if v_dest is null then
    if v_clase in ('cliente', 'sabor', 'modelo') then
      select coalesce(jsonb_agg(q.nombre), '[]'::jsonb) into v_sug from (select c.nombre from catalogo.candidatos_duplicado(v_clase, v_oficial, null, 50) c limit 3) q;
    else v_sug := '[]'::jsonb; end if;
    v_prev := jsonb_build_object('estado', 'oficial_desconocido', 'sugerencias', v_sug,
      'texto', format('No encontre %s "%s" en el catalogo. No guarde nada.%s', case v_clase when 'cliente' then 'al cliente' when 'sabor' then 'el sabor' when 'modelo' then 'el modelo' when 'marca' then 'la marca' else 'al proveedor' end,
        agente._mostrar(v_clase, v_oficial), case when jsonb_array_length(v_sug) > 0 then ' ¿Quisiste decir ' || (select string_agg(agente._mostrar(v_clase, x), ' o ') from jsonb_array_elements_text(v_sug) x) || '?' else '' end));
    perform seguridad.terminar_operacion(p_clave_idem, v_prev);
    return v_prev;
  end if;

  v_ocupado := agente._alias_ocupado(v_clase, v_norm);
  if v_ocupado is not null then
    v_prev := case when v_ocupado = (v_dest ->> 'id')::bigint
      then jsonb_build_object('estado', 'ya_existe', 'texto', format('"%s" ya es otro nombre de %s. No hace falta guardarlo.', agente._mostrar(v_clase, v_alias), agente._mostrar(v_clase, v_dest ->> 'nombre')))
      else jsonb_build_object('estado', 'conflicto', 'texto', format('"%s" ya se usa para otro registro del catalogo, asi que no lo guardo como nombre de %s. Si es un error, corrigelo desde el software.', agente._mostrar(v_clase, v_alias), agente._mostrar(v_clase, v_dest ->> 'nombre'))) end;
    perform seguridad.terminar_operacion(p_clave_idem, v_prev);
    return v_prev;
  end if;

  if exists (select 1 from agente.alias_negativo n where n.clase = v_clase and n.alias_norm = v_norm and n.destino_id = (v_dest ->> 'id')::bigint) then
    v_prev := jsonb_build_object('estado', 'negado_antes', 'texto', format('Un socio ya dijo que "%s" no es lo mismo que %s. No lo vuelvo a preguntar.', agente._mostrar(v_clase, v_alias), agente._mostrar(v_clase, v_dest ->> 'nombre')));
    perform seguridad.terminar_operacion(p_clave_idem, v_prev);
    return v_prev;
  end if;

  select id into v_pid from agente.alias_pregunta where clase = v_clase and alias_norm = v_norm and destino_id = (v_dest ->> 'id')::bigint and estado = 'pendiente';
  if v_pid is null then
    insert into agente.alias_pregunta (clase, alias_texto, alias_norm, destino_id, destino_nombre, propuesto_por)
      values (v_clase, v_alias, v_norm, (v_dest ->> 'id')::bigint, v_dest ->> 'nombre', v_autor) returning id into v_pid;
  end if;
  v_texto := format('¿"%s" es lo mismo que %s? Si respondes que si, lo recordare como otro nombre de %s. Responde si o no.', agente._mostrar(v_clase, v_alias), agente._mostrar(v_clase, v_dest ->> 'nombre'), agente._mostrar(v_clase, v_dest ->> 'nombre'));
  v_mem := agente._pregunta_abrir(v_chat, 'alias', v_pid, v_texto, jsonb_build_object('clase', v_clase), v_autor);
  v_prev := jsonb_build_object('estado', 'pregunta', 'pregunta_id', v_pid, 'memoria_id', v_mem, 'texto', v_texto);
  perform seguridad.terminar_operacion(p_clave_idem, v_prev);
  return v_prev;
end $$;

-- ---------------------------------------------------------------- alias: responder (si guarda con auditoria, no registra el negativo)
create function agente.alias_responder(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_chat bigint := nullif(p_args ->> 'chat_id', '')::bigint; v_resp text := lower(coalesce(p_args ->> 'respuesta', ''));
  m agente.pregunta_pendiente; q agente.alias_pregunta; v_res jsonb; v_ap bigint; v_ocupado bigint; v_nombre text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_resp not in ('si', 'no') then raise exception 'la respuesta debe ser si o no' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alias_responder', 'ch', v_chat, 'r', v_resp, 'au', v_autor));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into m from agente.pregunta_pendiente where chat_id = v_chat and tipo = 'alias' and estado = 'abierta' and expira_at > clock_timestamp() for update;
  if not found then
    delete from seguridad.operacion where clave = p_clave_idem;
    raise exception 'no hay una pregunta de alias pendiente en este chat' using errcode = 'P0460';
  end if;
  select * into q from agente.alias_pregunta where id = m.ref_id for update;
  v_nombre := agente._mostrar(q.clase, q.destino_nombre);
  if v_resp = 'si' then
    v_ocupado := agente._alias_ocupado(q.clase, q.alias_norm);
    if v_ocupado is not null then
      update agente.alias_pregunta set estado = 'negado', respondido_por = v_autor, respondido_at = clock_timestamp() where id = q.id;
      update agente.pregunta_pendiente set estado = 'contestada', cerrada_at = clock_timestamp() where id = m.id;
      v_res := jsonb_build_object('estado', 'conflicto', 'aviso_grupo', format('No guarde "%s": mientras tanto ya se uso para otro registro del catalogo.', agente._mostrar(q.clase, q.alias_texto)));
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
    if q.clase = 'cliente' then insert into catalogo.cliente_alias (alias_norm, cliente_id, nota) values (q.alias_norm, q.destino_id, 'aprendido por Telegram');
    elsif q.clase = 'sabor' then insert into catalogo.sabor_alias (alias_norm, sabor_id) values (q.alias_norm, q.destino_id);
    elsif q.clase = 'modelo' then insert into catalogo.modelo_alias (alias_norm, modelo_id, nota) values (q.alias_norm, q.destino_id, 'aprendido por Telegram');
    elsif q.clase = 'marca' then insert into catalogo.marca_alias (alias_norm, marca_id) values (q.alias_norm, q.destino_id);
    else insert into catalogo.proveedor_alias (alias_norm, proveedor_id) values (q.alias_norm, q.destino_id); end if;
    perform seguridad.registrar_auditoria('catalogo.alias_' || q.clase, 'ALIAS_TELEGRAM', q.alias_norm, null, jsonb_build_object('destino_id', q.destino_id, 'confirmado_por', v_autor, 'propuesto_por', q.propuesto_por), 'telegram');
    update agente.alias_pregunta set estado = 'guardado', respondido_por = v_autor, respondido_at = clock_timestamp() where id = q.id;
    insert into agente.alias_aprendido (pregunta_id, clase, alias_norm, destino_id, confirmado_por) values (q.id, q.clase, q.alias_norm, q.destino_id, v_autor) returning id into v_ap;
    v_res := jsonb_build_object('estado', 'guardado', 'alias_id', v_ap, 'aviso_grupo',
      format('%s confirmo: "%s" queda como otro nombre de %s. Para deshacerlo en los proximos %s minutos escribe "deshacer alias".', initcap(v_autor), agente._mostrar(q.clase, q.alias_texto), v_nombre, agente._ventana_minutos()));
  else
    insert into agente.alias_negativo (clase, alias_norm, destino_id, negado_por) values (q.clase, q.alias_norm, q.destino_id, v_autor) on conflict do nothing;
    update agente.alias_pregunta set estado = 'negado', respondido_por = v_autor, respondido_at = clock_timestamp() where id = q.id;
    v_res := jsonb_build_object('estado', 'negado', 'aviso_grupo', format('%s dijo que "%s" no es lo mismo que %s. No lo vuelvo a preguntar.', initcap(v_autor), agente._mostrar(q.clase, q.alias_texto), v_nombre));
  end if;
  update agente.pregunta_pendiente set estado = 'contestada', cerrada_at = clock_timestamp() where id = m.id;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Deshacer el ultimo alias aprendido dentro de la ventana de 10 minutos (cualquier socio). No lo bloquea el interruptor de escritura.
create function agente.alias_deshacer(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_prev jsonb; a agente.alias_aprendido; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alias_deshacer', 'au', v_autor));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into a from agente.alias_aprendido where revertido_at is null order by id desc limit 1 for update;
  if not found then
    v_res := jsonb_build_object('estado', 'nada', 'aviso_grupo', 'No hay ningun alias reciente que deshacer.');
  elsif a.creado_at < clock_timestamp() - make_interval(mins => agente._ventana_minutos()) then
    v_res := jsonb_build_object('estado', 'fuera_de_ventana', 'aviso_grupo', format('Ya pasaron mas de %s minutos desde que se guardo ese alias: se quita desde el software.', agente._ventana_minutos()));
  else
    if a.clase = 'cliente' then delete from catalogo.cliente_alias where alias_norm = a.alias_norm and cliente_id = a.destino_id;
    elsif a.clase = 'sabor' then delete from catalogo.sabor_alias where alias_norm = a.alias_norm and sabor_id = a.destino_id;
    elsif a.clase = 'modelo' then delete from catalogo.modelo_alias where alias_norm = a.alias_norm and modelo_id = a.destino_id;
    elsif a.clase = 'marca' then delete from catalogo.marca_alias where alias_norm = a.alias_norm and marca_id = a.destino_id;
    else delete from catalogo.proveedor_alias where alias_norm = a.alias_norm and proveedor_id = a.destino_id; end if;
    update agente.alias_aprendido set revertido_at = clock_timestamp(), revertido_por = v_autor where id = a.id;
    perform seguridad.registrar_auditoria('catalogo.alias_' || a.clase, 'ALIAS_TELEGRAM_DESHECHO', a.alias_norm, null, jsonb_build_object('destino_id', a.destino_id, 'por', v_autor), 'telegram');
    v_res := jsonb_build_object('estado', 'deshecho', 'aviso_grupo', format('%s deshizo el alias "%s".', initcap(v_autor), a.alias_norm));
  end if;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------- sabores: la pregunta del chat y su respuesta (el id sale de la memoria del servidor)
create function agente.sabor_preguntar_chat(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_chat bigint := nullif(p_args ->> 'chat_id', '')::bigint; q jsonb; v_prev jsonb; v_txt text; v_mem bigint;
begin
  perform notificacion.exigir_sistema();
  if v_chat is null then raise exception 'falta el chat de la pregunta' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'sabor_preguntar_chat', 'ch', v_chat));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  q := agente.sabor_pregunta();
  if q is null then
    v_prev := jsonb_build_object('estado', 'sin_pendientes', 'texto', 'No hay sabores por revisar.');
  else
    v_txt := format('¿"%s" es lo mismo que "%s"? Responde si o no.%s', upper(q ->> 'a'), upper(q ->> 'b'), case when (q ->> 'pendientes')::int > 1 then format(' (Hay %s mas por revisar.)', (q ->> 'pendientes')::int - 1) else '' end);
    v_mem := agente._pregunta_abrir(v_chat, 'sabor_duplicado', (q ->> 'pregunta_id')::bigint, v_txt, jsonb_build_object('a', q ->> 'a', 'b', q ->> 'b', 'ambiguo', q -> 'ambiguo'), 'sistema');
    v_prev := jsonb_build_object('estado', 'pregunta', 'pregunta_id', (q ->> 'pregunta_id')::bigint, 'memoria_id', v_mem, 'texto', v_txt, 'pendientes', (q ->> 'pendientes')::int);
  end if;
  perform seguridad.terminar_operacion(p_clave_idem, v_prev);
  return v_prev;
end $$;

create function agente.sabor_responder_chat(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_chat bigint := nullif(p_args ->> 'chat_id', '')::bigint; m agente.pregunta_pendiente; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  select * into m from agente.pregunta_pendiente where chat_id = v_chat and tipo = 'sabor_duplicado' and estado = 'abierta' and expira_at > clock_timestamp() for update;
  if not found then
    -- Idempotencia: la misma clave repetida devuelve lo ya hecho (agente.sabor_responder la resuelve por su propia clave).
    raise exception 'no hay una pregunta de sabores pendiente en este chat' using errcode = 'P0460';
  end if;
  v_res := agente.sabor_responder(p_clave_idem, (p_args - 'chat_id') || jsonb_build_object('pregunta_id', m.ref_id));
  update agente.pregunta_pendiente set estado = 'contestada', cerrada_at = clock_timestamp() where id = m.id;
  return v_res;
end $$;

-- Union de sabores: deshacer desde Telegram solo en los primeros 10 minutos (despues, desde el software). Envoltorio de la definicion vigente.
alter function agente.sabor_deshacer(text, jsonb) rename to _sabor_deshacer_previo;
revoke all on function agente._sabor_deshacer_previo(text, jsonb) from public, anon, authenticated, servidor;
create function agente.sabor_deshacer(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_u bigint; v_creada timestamptz;
begin
  perform notificacion.exigir_sistema();
  v_u := coalesce(nullif(p_args ->> 'unificacion_id', '')::bigint, (select max(id) from catalogo.unificacion_sabor where estado = 'aplicada'));
  select creada_at into v_creada from catalogo.unificacion_sabor where id = v_u and estado = 'aplicada';
  if v_creada is not null and v_creada < clock_timestamp() - make_interval(mins => agente._ventana_minutos()) then
    raise exception 'pasaron mas de % minutos desde esa union: ya no se deshace desde Telegram, se hace desde el software', agente._ventana_minutos() using errcode = 'P0464';
  end if;
  return agente._sabor_deshacer_previo(p_clave_idem, p_args);
end $$;

-- ---------------------------------------------------------------- permisos: solo el rol servidor
revoke all on function agente._pregunta_abrir(bigint, text, bigint, text, jsonb, text) from public, anon, authenticated;
revoke all on function agente._alias_destino(text, text) from public, anon, authenticated;
revoke all on function agente._alias_ocupado(text, text) from public, anon, authenticated;
revoke all on function agente._mostrar(text, text) from public, anon, authenticated;
revoke all on function agente.pregunta_vigente(bigint), agente.pregunta_mensaje(bigint, bigint, bigint), agente.pregunta_cancelar(bigint),
  agente.alias_proponer(text, jsonb), agente.alias_responder(text, jsonb), agente.alias_deshacer(text, jsonb),
  agente.sabor_preguntar_chat(text, jsonb), agente.sabor_responder_chat(text, jsonb), agente.sabor_deshacer(text, jsonb) from public, anon, authenticated;
grant execute on function agente.pregunta_vigente(bigint), agente.pregunta_mensaje(bigint, bigint, bigint), agente.pregunta_cancelar(bigint),
  agente.alias_proponer(text, jsonb), agente.alias_responder(text, jsonb), agente.alias_deshacer(text, jsonb),
  agente.sabor_preguntar_chat(text, jsonb), agente.sabor_responder_chat(text, jsonb), agente.sabor_deshacer(text, jsonb) to servidor;
