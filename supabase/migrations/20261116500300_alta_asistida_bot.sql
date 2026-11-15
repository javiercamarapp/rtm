-- Carril ALTA ASISTIDA (bot de Telegram): cliente nuevo, sabor nuevo y modelo nuevo. ADITIVA: funciones nuevas agente.alta_* y filas del espejo de slots.
-- Reglas: el bot PREGUNTA todo lo que falta (nombre, tipo, duenio, plazo habitual; modelo y sabor; marca, puffs y costo de lista) y solo escribe con todos los datos. NUNCA inventa precios ni costos:
-- el costo de lista es una decision del socio (puede decir "sin costo por ahora"). Un nombre IGUAL o MUY PROBABLE a uno existente se pregunta antes de crear (decision 14-nov); los POSIBLES
-- se crean y dejan la pregunta en la cola (catalogo.posible_duplicado). La unificacion de clientes NO se implementa: solo se detecta y se pregunta.
-- Frenos: exigen la escritura encendida (el bot arranca en solo lectura) y la identidad verificada del socio. Un alta no se deshace desde Telegram (se corrige desde el software).

-- Espejo SQL de los slots (src/dominio/agente/slots.ts): se agregan los datos que faltaban a las tres altas.
update agente.operacion_slot set orden = 5, si_slot = 'proveedor_costo', si_valor = array['isaac', 'karen'] where operacion = 'alta_modelo' and slot = 'costo';
insert into agente.operacion_slot (operacion, orden, slot, obligatorio, si_slot, si_valor) values
  ('alta_modelo', 3, 'puffs', true, null, null),
  ('alta_modelo', 4, 'proveedor_costo', true, null, null),
  ('alta_cliente', 3, 'duenio', true, null, null),
  ('alta_cliente', 4, 'plazo_habitual', true, null, null),
  ('alta_sabor', 2, 'modelo', true, null, null);

-- ------------------------------------------------------------------ cliente
create function agente.alta_cliente(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_nombre text; v_norm text; v_tipo_in text := lower(coalesce(p_args ->> 'tipo', 'mayoreo')); v_tipo text; v_duenio text := lower(coalesce(p_args ->> 'duenio', ''));
  v_plazo int := nullif(p_args ->> 'plazo_dias', '')::int; v_conf boolean := coalesce((p_args ->> 'confirmar')::boolean, false); v_par jsonb; v_fuertes jsonb; v_id bigint; v_res jsonb; r record;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  v_nombre := catalogo.nombre_alta_valido(p_args ->> 'nombre', 60);
  v_norm := catalogo.normalizar(v_nombre);
  if v_duenio not in ('angelo', 'javier') then raise exception 'falta el socio duenio del cliente (Angelo o Javier)' using errcode = 'P0460'; end if;
  if v_tipo_in not in ('mayoreo', 'menudeo', 'ocasional', 'credito_interno') then raise exception 'tipo de cliente invalido' using errcode = 'P0460'; end if;
  v_tipo := case v_tipo_in when 'menudeo' then 'ocasional' else v_tipo_in end;
  if v_plazo is not null and v_plazo not between 0 and 365 then raise exception 'plazo habitual invalido' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alta_cliente', 'n', v_norm, 't', v_tipo_in, 'd', v_duenio, 'p', v_plazo, 'c', v_conf));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  if exists (select 1 from catalogo.cliente where nombre_norm = v_norm) then
    v_res := jsonb_build_object('estado', 'existente', 'texto', format('El cliente "%s" ya existe. No cree otro: usa su nombre para venderle.', v_nombre));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'puntaje', c.puntaje, 'clase', c.clase) order by c.puntaje desc), '[]'::jsonb) into v_par from catalogo.candidatos_duplicado('cliente', v_nombre, null, 50) c where not c.negativo;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_fuertes from jsonb_array_elements(v_par) x where (x ->> 'puntaje')::int >= 80;
  if jsonb_array_length(v_fuertes) > 0 and not v_conf then
    -- No se crea: se pregunta. (Si es el mismo cliente, el socio cancela y ensena el alias; la union de clientes no se implementa.)
    delete from seguridad.operacion where clave = p_clave_idem;
    return jsonb_build_object('estado', 'parecidos', 'parecidos', v_fuertes,
      'texto', format('Ya existe "%s", muy parecido a "%s". ¿Es otro cliente distinto y lo creo? Responde si para crearlo o no para cancelar. Si es la misma persona, cancela y dime "%s es %s" para guardarlo como otro nombre.',
        v_fuertes -> 0 ->> 'nombre', v_nombre, v_nombre, v_fuertes -> 0 ->> 'nombre'));
  end if;

  v_id := catalogo.asegurar_cliente(v_nombre, initcap(v_duenio), v_tipo);
  if v_plazo is not null then
    insert into catalogo.cliente_plazo_habitual (cliente_id, dias, fijado_por) values (v_id, v_plazo, v_autor)
      on conflict (cliente_id) do update set dias = excluded.dias, fijado_por = excluded.fijado_por, fijado_at = clock_timestamp();
  end if;
  -- Parecidos: los fuertes que el socio confirmo como distintos quedan como NEGATIVO; los demas quedan como pregunta pendiente.
  for r in select (x ->> 'id')::bigint as oid, x ->> 'clase' as clase, (x ->> 'puntaje')::int as puntaje from jsonb_array_elements(v_par) x loop
    if r.puntaje >= 80 then
      insert into catalogo.posible_duplicado (tipo, id_a, id_b, motivo, puntaje, clase, ambiguo, estado, respondido_at, canal)
        values ('cliente', least(v_id, r.oid), greatest(v_id, r.oid), 'confirmado distinto al dar de alta por Telegram', r.puntaje, r.clase, false, 'distinto', clock_timestamp(), 'telegram') on conflict do nothing;
    else
      perform catalogo.registrar_posible_duplicado('cliente', v_id, r.oid, 'parecido detectado al dar de alta por Telegram', r.puntaje, r.clase, false);
    end if;
  end loop;
  perform seguridad.registrar_auditoria('catalogo.cliente', 'ALTA_ASISTIDA', v_id::text, null, jsonb_build_object('nombre', v_nombre, 'tipo', v_tipo, 'duenio', v_duenio, 'plazo_habitual', v_plazo, 'origen', 'telegram'), 'telegram');
  v_res := jsonb_build_object('estado', 'creado', 'cliente_id', v_id, 'nombre', v_nombre, 'folio', 'CL-' || v_id, 'tipo', v_tipo_in, 'duenio', initcap(v_duenio), 'plazo_habitual_dias', v_plazo,
    'posibles', (select count(*) from jsonb_array_elements(v_par) x where (x ->> 'puntaje')::int < 80),
    'aviso_grupo', format('%s dio de alta al cliente "%s" (%s, de %s%s).', initcap(v_autor), v_nombre, v_tipo_in, initcap(v_duenio), case when v_plazo is null then '' when v_plazo = 0 then ', paga de contado' else format(', plazo habitual %s dias', v_plazo) end));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------------ sabor
create function agente.alta_sabor(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_mod jsonb; v_sabor text; v_conf boolean := coalesce((p_args ->> 'confirmar')::boolean, false); v_r jsonb; v_res jsonb; v_sug jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  v_sabor := catalogo.nombre_alta_valido(p_args ->> 'sabor_texto', 40);
  v_mod := agente._alias_destino('modelo', catalogo.nombre_alta_valido(p_args ->> 'modelo_texto', 60));
  if v_mod is null then
    select coalesce(jsonb_agg(q.nombre), '[]'::jsonb) into v_sug from (select c.nombre from catalogo.candidatos_duplicado('modelo', p_args ->> 'modelo_texto', null, 50) c limit 3) q;
    return jsonb_build_object('estado', 'modelo_desconocido', 'sugerencias', v_sug,
      'texto', format('No encontre el modelo "%s" en el catalogo.%s', upper(p_args ->> 'modelo_texto'), case when jsonb_array_length(v_sug) > 0 then ' ¿Quisiste decir ' || (select string_agg(upper(x), ' o ') from jsonb_array_elements_text(v_sug) x) || '?' else ' Si es un modelo nuevo, dalo de alta primero.' end));
  end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alta_sabor_bot', 'm', v_mod ->> 'id', 's', catalogo.normalizar(v_sabor), 'c', v_conf));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  v_r := catalogo.alta_sabor(p_clave_idem || ':sabor', (v_mod ->> 'id')::bigint, v_sabor, 'telegram', v_conf);
  if v_r ->> 'estado' = 'parecidos' then
    delete from seguridad.operacion where clave = p_clave_idem;
    return v_r || jsonb_build_object('texto', coalesce(v_r ->> 'pregunta',
      format('El sabor "%s" se parece a %s. ¿Es otro sabor distinto y lo creo? Responde si para crearlo o no para cancelar.', upper(v_sabor), (select string_agg('"' || upper(p ->> 'nombre') || '"', ' o ') from jsonb_array_elements(coalesce(v_r -> 'parecidos', '[]'::jsonb)) p))));
  end if;
  v_res := v_r || jsonb_build_object('folio', 'SB-' || coalesce(v_r ->> 'sku_id', '0'),
    'aviso_grupo', case v_r ->> 'estado'
      when 'creado' then format('%s dio de alta el sabor %s para %s.%s', initcap(v_autor), upper(v_sabor), upper(v_mod ->> 'nombre'), case when (v_r ->> 'falta_costo_lista')::boolean then ' El modelo aun no tiene costo de lista.' else '' end)
      else null end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------------ modelo
create function agente.alta_modelo(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_nombre text; v_marca text; v_norm text; v_puffs int := nullif(p_args ->> 'puffs', '')::int; v_prov text := lower(coalesce(nullif(p_args ->> 'proveedor_costo', ''), 'ninguno'));
  v_costo bigint := nullif(p_args ->> 'costo_cent', '')::bigint; v_conf boolean := coalesce((p_args ->> 'confirmar')::boolean, false); v_par jsonb; v_fuertes jsonb; v_id bigint; v_res jsonb; r record; v_c jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  v_nombre := catalogo.nombre_alta_valido(p_args ->> 'nombre', 60);
  v_marca := catalogo.nombre_alta_valido(p_args ->> 'marca', 40);
  v_norm := catalogo.normalizar(v_nombre);
  if v_puffs is not null and v_puffs <= 0 then raise exception 'puffs invalido' using errcode = 'P0460'; end if;
  if v_prov not in ('isaac', 'karen', 'ninguno') then raise exception 'proveedor del costo invalido' using errcode = 'P0460'; end if;
  if v_prov <> 'ninguno' and (v_costo is null or v_costo <= 0) then raise exception 'falta el costo de lista que dio el socio' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alta_modelo_bot', 'n', v_norm, 'm', catalogo.normalizar(v_marca), 'pf', v_puffs, 'pv', v_prov, 'c', v_costo, 'cf', v_conf));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  if exists (select 1 from catalogo.modelo where nombre_norm = v_norm) or exists (select 1 from catalogo.modelo_alias where alias_norm = v_norm) then
    v_res := jsonb_build_object('estado', 'existente', 'texto', format('El modelo %s ya existe. No cree otro.', upper(v_nombre)));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'puntaje', c.puntaje, 'clase', c.clase) order by c.puntaje desc), '[]'::jsonb) into v_par from catalogo.candidatos_duplicado('modelo', v_nombre, null, 50) c where not c.negativo;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_fuertes from jsonb_array_elements(v_par) x where (x ->> 'puntaje')::int >= 80;
  if jsonb_array_length(v_fuertes) > 0 and not v_conf then
    delete from seguridad.operacion where clave = p_clave_idem;
    return jsonb_build_object('estado', 'parecidos', 'parecidos', v_fuertes,
      'texto', format('El modelo %s se parece mucho a %s. ¿Es otro modelo distinto y lo creo? Responde si para crearlo o no para cancelar.', upper(v_nombre), upper(v_fuertes -> 0 ->> 'nombre')));
  end if;

  v_id := catalogo.asegurar_modelo(coalesce((agente._alias_destino('marca', v_marca) ->> 'nombre'), v_marca), v_nombre, v_puffs, 'ambas');
  if v_prov <> 'ninguno' then
    v_c := catalogo.fijar_costo(p_clave_idem || ':costo', initcap(v_prov), v_nombre, v_costo, negocio.hoy(), 'telegram', null, false, true);
  end if;
  for r in select (x ->> 'id')::bigint as oid, x ->> 'clase' as clase, (x ->> 'puntaje')::int as puntaje from jsonb_array_elements(v_par) x loop
    if r.puntaje >= 80 then
      insert into catalogo.posible_duplicado (tipo, id_a, id_b, motivo, puntaje, clase, ambiguo, estado, respondido_at, canal)
        values ('modelo', least(v_id, r.oid), greatest(v_id, r.oid), 'confirmado distinto al dar de alta por Telegram', r.puntaje, r.clase, false, 'distinto', clock_timestamp(), 'telegram') on conflict do nothing;
    else
      perform catalogo.registrar_posible_duplicado('modelo', v_id, r.oid, 'parecido detectado al dar de alta por Telegram', r.puntaje, r.clase, false);
    end if;
  end loop;
  perform seguridad.registrar_auditoria('catalogo.modelo', 'ALTA_ASISTIDA', v_id::text, null, jsonb_build_object('nombre', v_nombre, 'marca', v_marca, 'puffs', v_puffs, 'proveedor_costo', v_prov, 'origen', 'telegram'), 'telegram');
  v_res := jsonb_build_object('estado', 'creado', 'modelo_id', v_id, 'nombre', v_nombre, 'folio', 'MD-' || v_id, 'con_costo', v_prov <> 'ninguno',
    'aviso_grupo', format('%s dio de alta el modelo %s (marca %s%s). %s', initcap(v_autor), upper(v_nombre), upper(v_marca), case when v_puffs is null then '' else format(', %s puffs', v_puffs) end,
      case when v_prov = 'ninguno' then 'Sin costo de lista: hay que fijarlo antes de venderlo.' else format('Costo de lista con %s: lo dio el socio.', initcap(v_prov)) end));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke all on function agente.alta_cliente(text, jsonb), agente.alta_sabor(text, jsonb), agente.alta_modelo(text, jsonb) from public, anon, authenticated;
grant execute on function agente.alta_cliente(text, jsonb), agente.alta_sabor(text, jsonb), agente.alta_modelo(text, jsonb) to servidor;
