-- Carril RECARGO DE CREDITO: 10 % SIMPLE por cada semana COMPLETA de atraso, calculado por SQL (decision del dueno, 14-nov). ADITIVA.
--   * operacion.recargo_sugerido(pedido, fecha): base, semanas completas, total sugerido, ya aplicado y pendiente. Solo lectura.
--   * api.cuentas_por_cobrar envuelta (rename + wrap de la definicion vigente): cada fila gana semanas_atraso, recargo_sugerido_atraso_cent y recargo_pendiente_cent; ningun campo existente cambia.
--   * El recargo solo se SUGIERE: el bot pregunta y lo aplica unicamente el socio DUENO del cliente con un si (agente.recargo_responder, por operacion.registrar_recargo_credito).
-- La base es el subtotal de la nota vigente (igual que el recargo sugerido que ya existia); el porcentaje sale de catalogo.config recargo_credito_bp (1000 = 10 %). El modelo de IA no calcula nada.

create function operacion.recargo_sugerido(p_pedido bigint, p_fecha date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  pe operacion.pedido; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_bp int := coalesce((catalogo.config_valor('recargo_credito_bp'))::text::int, 1000);
  v_vence date; v_atraso int; v_sem int; v_base bigint; v_total bigint; v_aplicado bigint; v_saldo bigint; v_motivo text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion', 'sistema']);
  select * into pe from operacion.pedido where id = p_pedido;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  select (n.snapshot_cliente ->> 'subtotal_cent')::bigint, coalesce((n.snapshot_cliente ->> 'recargo_cent')::bigint, 0) into v_base, v_aplicado
    from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1;
  v_aplicado := coalesce(v_aplicado, 0);
  v_saldo := operacion.pedido_saldo(pe.id);
  if pe.estado <> 'enviado' then v_motivo := 'no_enviado';
  elsif pe.plazo_dias is null or pe.fecha_envio is null then v_motivo := 'sin_plazo';
  elsif v_base is null then v_motivo := 'sin_nota';
  elsif v_saldo <= 0 then v_motivo := 'sin_saldo'; end if;
  if pe.plazo_dias is not null and pe.fecha_envio is not null then
    v_vence := pe.fecha_envio + pe.plazo_dias;
    v_atraso := greatest(v_fecha - v_vence, 0);
  else v_atraso := 0; end if;
  v_sem := v_atraso / 7;
  -- 10 % simple: base x porcentaje x semanas completas, redondeado hacia arriba al centavo.
  v_total := case when v_motivo is null then (coalesce(v_base, 0) * v_bp * v_sem + 9999) / 10000 else 0 end;
  return jsonb_build_object('pedido_id', pe.id, 'folio', pe.folio, 'fecha', v_fecha, 'vence', v_vence, 'dias_atraso', v_atraso, 'semanas_completas', v_sem, 'porcentaje_bp', v_bp,
    'base_cent', coalesce(v_base, 0), 'sugerido_total_cent', v_total, 'aplicado_cent', v_aplicado, 'pendiente_cent', greatest(v_total - v_aplicado, 0), 'motivo_sin_recargo', v_motivo);
end $$;

-- api.cuentas_por_cobrar: se conserva la definicion vigente y se le agregan campos por fila.
alter function api.cuentas_por_cobrar() rename to _cuentas_por_cobrar_sin_recargo_semanal;
revoke all on function api._cuentas_por_cobrar_sin_recargo_semanal() from public, anon, authenticated, servidor;
create function api.cuentas_por_cobrar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb := api._cuentas_por_cobrar_sin_recargo_semanal();
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_set(v, '{filas}', coalesce((
    select jsonb_agg(f.fila || case when f.fila ->> 'pedido_id' is null then '{}'::jsonb else jsonb_build_object(
      'semanas_atraso', (operacion.recargo_sugerido((f.fila ->> 'pedido_id')::bigint) ->> 'semanas_completas')::int,
      'recargo_sugerido_atraso_cent', (operacion.recargo_sugerido((f.fila ->> 'pedido_id')::bigint) ->> 'sugerido_total_cent')::bigint,
      'recargo_pendiente_cent', (operacion.recargo_sugerido((f.fila ->> 'pedido_id')::bigint) ->> 'pendiente_cent')::bigint) end order by f.ord)
      from jsonb_array_elements(v -> 'filas') with ordinality as f(fila, ord)), '[]'::jsonb));
end $$;

-- ------------------------------------------------------------------ el bot sugiere, el socio duenio decide
create function agente.recargo_preguntar(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_chat bigint := nullif(p_args ->> 'chat_id', '')::bigint; v_folio text := nullif(p_args ->> 'pedido_folio', ''); v_cli bigint := nullif(p_args ->> 'cliente_id', '')::bigint;
  v_ped bigint; r jsonb; v_duenio text; v_cliente text; v_txt text; v_mem bigint; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_chat is null or (v_folio is null and v_cli is null) then raise exception 'falta el chat y el pedido o el cliente' using errcode = 'P0460'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'recargo_preguntar', 'ch', v_chat, 'f', v_folio, 'c', v_cli));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if v_folio is not null then select id into v_ped from operacion.pedido where upper(folio) = upper(v_folio);
  else
    select pe.id into v_ped from operacion.pedido pe where pe.cliente_id = v_cli and pe.estado = 'enviado'
      order by coalesce((operacion.recargo_sugerido(pe.id) ->> 'pendiente_cent')::bigint, 0) desc, pe.id limit 1;
  end if;
  if v_ped is null then
    v_res := jsonb_build_object('estado', 'sin_pedido', 'texto', 'No encontre ese pedido. Dime el folio.');
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  r := operacion.recargo_sugerido(v_ped);
  select s.nombre, c.nombre_canonico into v_duenio, v_cliente from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id where pe.id = v_ped;
  if (r ->> 'pendiente_cent')::bigint <= 0 then
    v_res := jsonb_build_object('estado', 'sin_recargo', 'recargo', r, 'texto', case
      when r ->> 'motivo_sin_recargo' is not null then format('El pedido %s no admite recargo ahora (%s).', r ->> 'folio', replace(r ->> 'motivo_sin_recargo', '_', ' '))
      when (r ->> 'semanas_completas')::int = 0 then format('El pedido %s todavia no completa una semana de atraso: no hay recargo que sugerir.', r ->> 'folio')
      else format('El pedido %s ya tiene aplicado el recargo que corresponde (%s semanas completas).', r ->> 'folio', r ->> 'semanas_completas') end);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  v_txt := format('El pedido %s de %s lleva %s semanas completas de atraso. Recargo sugerido: $%s (10 %% simple por semana; pendiente de aplicar). Lo decide %s, dueno del cliente. ¿Lo aplico? Responde si o no.',
    r ->> 'folio', v_cliente, r ->> 'semanas_completas', operacion.fmt_pesos((r ->> 'pendiente_cent')::bigint), v_duenio);
  v_mem := agente._pregunta_abrir(v_chat, 'recargo', v_ped, v_txt, jsonb_build_object('duenio', lower(v_duenio), 'sugerido_cent', (r ->> 'sugerido_total_cent')::bigint), v_autor);
  v_res := jsonb_build_object('estado', 'pregunta', 'memoria_id', v_mem, 'duenio', lower(v_duenio), 'recargo', r, 'texto', v_txt);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function agente.recargo_responder(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_prev jsonb; v_chat bigint := nullif(p_args ->> 'chat_id', '')::bigint; v_resp text := lower(coalesce(p_args ->> 'respuesta', '')); m agente.pregunta_pendiente; r jsonb; v_ap jsonb; v_res jsonb; v_duenio text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  if v_resp not in ('si', 'no') then raise exception 'la respuesta debe ser si o no' using errcode = 'P0460'; end if;
  select * into m from agente.pregunta_pendiente where chat_id = v_chat and tipo = 'recargo' and estado = 'abierta' and expira_at > clock_timestamp() for update;
  if not found then raise exception 'no hay una pregunta de recargo pendiente en este chat' using errcode = 'P0460'; end if;
  select lower(s.nombre) into v_duenio from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id where pe.id = m.ref_id;
  if v_autor <> v_duenio then
    raise exception 'el recargo lo decide % (dueno del cliente); la pregunta sigue abierta', initcap(v_duenio) using errcode = 'P0460';
  end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'recargo_responder', 'ch', v_chat, 'r', v_resp, 'p', m.ref_id));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if v_resp = 'si' then
    r := operacion.recargo_sugerido(m.ref_id);
    if (r ->> 'pendiente_cent')::bigint <= 0 then
      v_res := jsonb_build_object('estado', 'sin_recargo', 'aviso_grupo', format('El pedido %s ya no tiene recargo pendiente. No cambie nada.', r ->> 'folio'));
    else
      -- El monto lo calcula SQL con la fecha de HOY (no el de la pregunta); registrar_recargo_credito deja el recargo total del pedido en ese monto.
      v_ap := operacion.registrar_recargo_credito(p_clave_idem || ':recargo', m.ref_id, null, (r ->> 'sugerido_total_cent')::bigint, format('Recargo por credito: %s semanas completas de atraso', r ->> 'semanas_completas'));
      v_res := jsonb_build_object('estado', 'aplicado', 'recargo', r, 'aviso_grupo', format('%s aplico el recargo del pedido %s: %s en total (%s semanas completas de atraso, 10 %% simple por semana).',
        initcap(v_autor), r ->> 'folio', operacion.fmt_pesos((r ->> 'sugerido_total_cent')::bigint), r ->> 'semanas_completas'));
    end if;
  else
    v_res := jsonb_build_object('estado', 'rechazado', 'aviso_grupo', format('%s decidio no aplicar el recargo por ahora.', initcap(v_autor)));
  end if;
  update agente.pregunta_pendiente set estado = 'contestada', cerrada_at = clock_timestamp() where id = m.id;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Lo que los recordatorios de cobranza pueden mencionar (el bot NO los envia: es del carril de cobranza). Una linea por pedido con recargo pendiente.
create function agente.recargo_menciones(p_fecha date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('pedido_id', x.id, 'folio', x.folio, 'cliente', x.cliente, 'duenio', x.duenio, 'semanas', x.sem, 'pendiente_cent', x.pend,
      'texto', format('Recargo sugerido por atraso: $%s (%s semanas completas, 10 %% simple por semana). Lo decide %s.', operacion.fmt_pesos(x.pend), x.sem, x.duenio)) order by x.sem desc, x.id)
    from (select pe.id, pe.folio, c.nombre_canonico as cliente, s.nombre as duenio, (r ->> 'semanas_completas')::int as sem, (r ->> 'pendiente_cent')::bigint as pend
            from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id, lateral (select operacion.recargo_sugerido(pe.id, p_fecha) as r) q
           where pe.estado = 'enviado' and (r ->> 'pendiente_cent')::bigint > 0) x), '[]'::jsonb);
end $$;

revoke all on function operacion.recargo_sugerido(bigint, date) from public, anon, authenticated;
grant execute on function operacion.recargo_sugerido(bigint, date) to authenticated;
revoke all on function api.cuentas_por_cobrar() from public, anon;
grant execute on function api.cuentas_por_cobrar() to authenticated;
revoke all on function agente.recargo_preguntar(text, jsonb), agente.recargo_responder(text, jsonb), agente.recargo_menciones(date) from public, anon, authenticated;
grant execute on function agente.recargo_preguntar(text, jsonb), agente.recargo_responder(text, jsonb), agente.recargo_menciones(date) to servidor;
