-- Parche 2 de la unificacion de sabores (H-A): cadenas A -> B -> C.
-- Si un sku ya era destino de otros sku fusionados (unificado_en = el) y ahora se fusiona el mismo en un tercero, los anteriores se REAPUNTAN al nuevo destino
-- (queda una sola salto: sku_vigente y todo coalesce(unificado_en, id) siguen valiendo). Igual con sabor.unificado_en. La reversa los restaura y exige deshacer en orden
-- inverso (no se puede deshacer A -> B mientras B ya esta unificado en C).
alter table catalogo.unificacion_sabor add column if not exists sabores_reapuntados bigint[] not null default '{}';


CREATE OR REPLACE FUNCTION catalogo.unificar_sabor(p_clave_idem text, p_origen bigint, p_destino bigint, p_canal text DEFAULT 'web'::text, p_nombre_final text DEFAULT NULL::text, p_pregunta_id bigint DEFAULT NULL::bigint, p_aprobacion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; o catalogo.sabor; d catalogo.sabor; q catalogo.posible_duplicado; v_final text; v_det jsonb := '[]'::jsonb; v_bloq jsonb := '[]'::jsonb; k record; m text[];
  v_aprob text; v_sab_rea bigint[]; v_rea int := 0; v_fus int := 0; v_alias bigint[]; v_uid bigint; v_res jsonb; v_norm_o text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then raise exception 'elige dos sabores distintos' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'unificar_sabor', 'o', p_origen, 'd', p_destino, 'n', p_nombre_final, 'q', p_pregunta_id, 'a', p_aprobacion));
  if v_prev is not null then
    -- La clave ya tiene un resultado 'unificado' pero esa unificacion se DESHIZO despues: devolver lo guardado seria mentir (no hay nada unificado). Se dice claro.
    if v_prev ->> 'estado' = 'unificado' and exists (select 1 from catalogo.unificacion_sabor u where u.id = nullif(v_prev ->> 'unificacion_id', '')::bigint and u.estado = 'deshecha') then
      raise exception 'ya deshecho: la unificacion de esta clave fue deshecha; usa una clave nueva (o --reaplicar en unificar-aprobados) para volver a aplicarla' using errcode = 'P0463';
    end if;
    return v_prev || jsonb_build_object('repetido', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_sabor', 0));

  select * into o from catalogo.sabor where id = p_origen for update;
  if not found then raise exception 'sabor origen desconocido' using errcode = '22023'; end if;
  select * into d from catalogo.sabor where id = p_destino for update;
  if not found then raise exception 'sabor destino desconocido' using errcode = '22023'; end if;
  if o.unificado_en is not null then
    v_res := jsonb_build_object('estado', 'ya_unificado', 'origen', o.nombre_canonico, 'destino', (select nombre_canonico from catalogo.sabor where id = o.unificado_en));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if d.unificado_en is not null then raise exception 'el sabor destino ya fue unificado en otro; elige el vigente' using errcode = '22023'; end if;

  -- La regla central: nunca solo. Respuesta de un socio a la pregunta de ESTE par, o aprobacion explicita por clave (catalogo.unificacion_aprobada).
  if p_pregunta_id is not null then
    select * into q from catalogo.posible_duplicado where id = p_pregunta_id for update;
    if not found or q.tipo <> 'sabor' or q.id_a <> least(p_origen, p_destino) or q.id_b <> greatest(p_origen, p_destino) then
      raise exception 'la pregunta no corresponde a estos sabores' using errcode = '22023';
    end if;
    if q.estado <> 'pendiente' then raise exception 'esa pregunta ya fue contestada' using errcode = '22023'; end if;
    v_aprob := 'pregunta:' || q.id::text;
  elsif p_aprobacion is not null then
    if not exists (select 1 from catalogo.unificacion_aprobada a where a.clave = p_aprobacion and a.origen_norm = o.nombre_norm and a.destino_norm = d.nombre_norm) then
      raise exception 'aprobacion explicita no reconocida para este par' using errcode = '42501';
    end if;
    v_aprob := 'clave:' || p_aprobacion;
  else
    raise exception 'una unificacion exige la respuesta de un socio o una aprobacion explicita' using errcode = '42501';
  end if;

  v_final := case when nullif(btrim(p_nombre_final), '') is null then d.nombre_canonico else catalogo.nombre_alta_valido(p_nombre_final, 40) end;
  if catalogo.normalizar(v_final) <> d.nombre_norm and exists (select 1 from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(v_final) and s.id not in (p_origen, p_destino)) then
    raise exception 'ese nombre ya lo usa otro sabor' using errcode = '22023';
  end if;

  for k in
    select s.id as sku_id, s.modelo_id, (select ds.id from catalogo.sku ds where ds.modelo_id = s.modelo_id and ds.sabor_id = p_destino and ds.unificado_en is null) as dest_sku
      from catalogo.sku s where s.sabor_id = p_origen and s.unificado_en is null order by s.id
  loop
    if k.dest_sku is null then
      v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'accion', 'reasignado', 'sku_destino', k.sku_id);
    else
      m := catalogo.sku_bloqueos_unificacion(k.sku_id);
      if cardinality(m) > 0 then
        v_bloq := v_bloq || jsonb_build_object('sku_id', k.sku_id, 'modelo', (select nombre_canonico from catalogo.modelo where id = k.modelo_id), 'motivos', to_jsonb(m));
      else
        v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'accion', 'fusionado', 'sku_destino', k.dest_sku,
          'reapuntados', coalesce((select jsonb_agg(z.id order by z.id) from catalogo.sku z where z.unificado_en = k.sku_id), '[]'::jsonb));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_bloq) > 0 then
    delete from seguridad.operacion where clave = p_clave_idem;
    return jsonb_build_object('estado', 'bloqueado', 'origen', o.nombre_canonico, 'destino', d.nombre_canonico, 'bloqueos', v_bloq,
                              'ayuda', 'El sku del sabor origen tiene movimiento pendiente. Cierra el conteo, recibe o cancela lo abierto, o traspasa la existencia al sabor canonico, y vuelve a intentar.');
  end if;

  v_norm_o := o.nombre_norm;
  select coalesce(array_agg(id order by id), '{}') into v_sab_rea from catalogo.sabor where unificado_en = p_origen;
  update catalogo.sabor set unificado_en = p_destino where unificado_en = p_origen;
  update catalogo.sabor set nombre_original = nombre_canonico, nombre_canonico = v_final, unificado_en = p_destino, unificado_at = now() where id = p_origen;
  if v_final <> d.nombre_canonico then update catalogo.sabor set nombre_canonico = v_final where id = p_destino; end if;
  for k in select (e ->> 'sku_id')::bigint as sku_id, e ->> 'accion' as accion, (e ->> 'sku_destino')::bigint as sku_destino from jsonb_array_elements(v_det) e loop
    if k.accion = 'reasignado' then
      update catalogo.sku set sabor_id = p_destino where id = k.sku_id;
      v_rea := v_rea + 1;
    else
      update catalogo.sku set activo = false, unificado_en = k.sku_destino where id = k.sku_id;
      update catalogo.sku set unificado_en = k.sku_destino where unificado_en = k.sku_id;
      v_fus := v_fus + 1;
    end if;
  end loop;
  select coalesce(array_agg(id), '{}') into v_alias from catalogo.sabor_alias where sabor_id = p_origen;
  update catalogo.sabor_alias set sabor_id = p_destino where sabor_id = p_origen;
  insert into catalogo.sabor_alias (alias_norm, sabor_id, origen_unificacion) values (v_norm_o, p_destino, null)
    on conflict (alias_norm) do update set sabor_id = excluded.sabor_id;
  insert into catalogo.unificacion_sabor (clave_idem, origen_id, destino_id, nombre_origen, nombre_destino_antes, nombre_destino_despues, detalle, alias_movidos, aprobacion, canal, por, sabores_reapuntados)
    values (p_clave_idem, p_origen, p_destino, o.nombre_canonico, d.nombre_canonico, v_final, v_det, v_alias, v_aprob, p_canal, auth.uid(), v_sab_rea) returning id into v_uid;
  update catalogo.sabor_alias set origen_unificacion = v_uid where alias_norm = v_norm_o;
  if p_pregunta_id is not null then
    update catalogo.posible_duplicado set estado = 'unido', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal, canonico_id = p_destino, unificacion_id = v_uid where id = p_pregunta_id;
  end if;
  perform seguridad.registrar_auditoria('catalogo.sabor', 'UNIFICACION', p_origen::text,
    jsonb_build_object('origen', o.nombre_canonico, 'destino', d.nombre_canonico),
    jsonb_build_object('unificacion_id', v_uid, 'destino_id', p_destino, 'nombre_final', v_final, 'skus', v_det, 'aprobacion', v_aprob, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'unificado', 'unificacion_id', v_uid, 'origen', o.nombre_canonico, 'destino', v_final, 'skus_reasignados', v_rea, 'skus_fusionados', v_fus, 'aprobacion', v_aprob);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION catalogo.deshacer_unificacion_sabor(p_clave_idem text, p_unificacion_id bigint, p_canal text DEFAULT 'web'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_prev jsonb; u catalogo.unificacion_sabor; o catalogo.sabor; e jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'deshacer_unificacion_sabor', 'u', p_unificacion_id));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_sabor', 0));
  select * into u from catalogo.unificacion_sabor where id = p_unificacion_id for update;
  if not found then raise exception 'unificacion desconocida' using errcode = '22023'; end if;
  if u.estado = 'deshecha' then
    v_res := jsonb_build_object('estado', 'ya_deshecha', 'unificacion_id', u.id);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if exists (select 1 from catalogo.sabor s where s.id = u.destino_id and s.unificado_en is not null) then
    raise exception 'el sabor destino ya fue unificado en otro: deshaz primero esa unificacion posterior (se deshace en orden inverso)' using errcode = '22023';
  end if;
  select * into o from catalogo.sabor where id = u.origen_id for update;
  if exists (select 1 from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(o.nombre_original) and s.id <> o.id) then
    raise exception 'otro sabor ya usa el nombre original; no se puede deshacer sin renombrarlo' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(u.detalle) loop
    if e ->> 'accion' = 'reasignado' then
      update catalogo.sku set sabor_id = u.origen_id where id = (e ->> 'sku_id')::bigint and sabor_id = u.destino_id;
    else
      update catalogo.sku set activo = true, unificado_en = null where id = (e ->> 'sku_id')::bigint;
      update catalogo.sku set unificado_en = (e ->> 'sku_id')::bigint where unificado_en = (e ->> 'sku_destino')::bigint
         and id in (select (r)::bigint from jsonb_array_elements_text(coalesce(e -> 'reapuntados', '[]'::jsonb)) r);
    end if;
  end loop;
  delete from catalogo.sabor_alias where alias_norm = catalogo.normalizar(o.nombre_original) and sabor_id = u.destino_id;
  update catalogo.sabor_alias set sabor_id = u.origen_id where id = any (u.alias_movidos);
  update catalogo.sabor set unificado_en = u.origen_id where id = any (u.sabores_reapuntados) and unificado_en = u.destino_id;
  update catalogo.sabor set unificado_en = null, unificado_at = null, nombre_canonico = o.nombre_original, nombre_original = null where id = u.origen_id;
  if u.nombre_destino_despues <> u.nombre_destino_antes then update catalogo.sabor set nombre_canonico = u.nombre_destino_antes where id = u.destino_id; end if;
  update catalogo.unificacion_sabor set estado = 'deshecha', deshecha_at = now(), deshecha_por = auth.uid() where id = u.id;
  update catalogo.posible_duplicado set estado = 'pendiente', respondido_por = null, respondido_at = null, canal = null, canonico_id = null, unificacion_id = null where unificacion_id = u.id;
  perform seguridad.registrar_auditoria('catalogo.sabor', 'UNIFICACION_DESHECHA', u.origen_id::text, null, jsonb_build_object('unificacion_id', u.id, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'deshecha', 'unificacion_id', u.id, 'origen', o.nombre_original, 'destino', u.nombre_destino_antes);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;
