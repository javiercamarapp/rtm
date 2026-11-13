-- Dropshipping / 0600: fecha comprometida de pago, reprogramaciones y RECORDATORIOS de pedidos a costo (solo lectura y registro; el envio por Telegram lo integra la rama de Telegram).
-- Sin datos personales: los recordatorios llevan folio, socio, proveedor, monto pendiente, fecha comprometida y dias de atraso (nunca cliente ni destinatario).

-- Reprogramar (o fijar por primera vez) el compromiso de pago de un pedido a costo. Cualquier socio (queda registrado quien); motivo obligatorio al reprogramar.
create function operacion.ds_reprogramar_compromiso(p_clave_idem text, p_pedido bigint, p_fecha date, p_hora time default null, p_motivo text default null, p_socio text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_soc bigint := coalesce(operacion.actor_socio(), (select id from catalogo.socio where nombre = p_socio)); v_cur operacion.ds_pedido_compromiso; r record; v_ev bigint; v_res jsonb; v_tipo text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_reprogramar_compromiso', 'p', p_pedido, 'f', p_fecha, 'h', p_hora, 'm', p_motivo, 's', p_socio));
  if v_prev is not null then return v_prev; end if;
  if v_soc is null then raise exception 'indica que socio reprograma' using errcode = '23502'; end if;
  if v_soc <> operacion.ds_socio_menudeo() then raise exception 'solo el socio de menudeo programa o reprograma el compromiso de pago' using errcode = '42501'; end if;
  if p_fecha is null then raise exception 'indica la nueva fecha comprometida' using errcode = '23502'; end if;
  if p_fecha < negocio.hoy() - 1 then raise exception 'la fecha comprometida no puede ser pasada' using errcode = '23514'; end if;
  select x.pedido_id, x.estado, x.tipo_venta, x.folio, x.venta_cent into r from operacion.v_ds_pedido x where x.pedido_id = p_pedido;
  if not found or r.tipo_venta is distinct from 'socio_a_costo' then raise exception 'no es un pedido a costo para un socio' using errcode = '22023'; end if;
  if r.estado not in ('borrador', 'confirmado', 'enviado') then raise exception 'el pedido ya no esta vigente' using errcode = 'P0428'; end if;
  if r.estado = 'enviado' and r.venta_cent - operacion.pedido_aplicado(p_pedido) <= 0 then raise exception 'el pedido ya esta pagado' using errcode = 'P0428'; end if;
  v_cur := operacion.ds_compromiso_vigente(p_pedido);
  v_tipo := case when v_cur.id is null or v_cur.fecha_compromiso is null then 'inicial' else 'reprogramacion' end;
  if v_tipo = 'reprogramacion' and length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'reprogramar exige un motivo' using errcode = '23502'; end if;
  v_ev := operacion.crear_evento('ds_compromiso_pago', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', r.folio, 'fecha', p_fecha, 'tipo', v_tipo));
  insert into operacion.ds_pedido_compromiso (pedido_id, fecha_compromiso, hora_compromiso, comprometido_por, tipo, motivo, canal, evento_id)
    values (p_pedido, p_fecha, p_hora, v_soc, v_tipo, nullif(btrim(p_motivo), ''), seguridad.canal_actual(), v_ev);
  v_res := jsonb_build_object('pedido_id', p_pedido, 'tipo', v_tipo, 'fecha_compromiso', p_fecha, 'hora_compromiso', p_hora, 'reprogramaciones', (select count(*) from operacion.ds_pedido_compromiso where pedido_id = p_pedido and tipo = 'reprogramacion'));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Parametro socio_menudeo (por omision Angelo): quien mete pedidos a costo y registra su pago. Editable por socios con registro.
create function api.ds_menudeo_config() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return (select jsonb_build_object('socio_menudeo', s.nombre) from operacion.ds_recordatorio_config c join catalogo.socio s on s.id = c.socio_menudeo where c.id = 1);
end $$;
create function operacion.ds_menudeo_socio_guardar(p_clave_idem text, p_socio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_menudeo_socio_guardar', 's', p_socio));
  if v_prev is not null then return v_prev; end if;
  select id into v_id from catalogo.socio where nombre = p_socio;
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  update operacion.ds_recordatorio_config set socio_menudeo = v_id, actualizado_por = operacion.actor_socio(), actualizado_at = now() where id = 1;
  perform operacion.crear_evento('ds_socio_menudeo', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('socio', p_socio));
  v_res := jsonb_build_object('socio_menudeo', p_socio);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;
create function api.ds_menudeo_socio_guardar(p_clave_idem text, p_socio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_menudeo_socio_guardar(p_clave_idem, p_socio); end $$;

-- Configuracion de recordatorios (editable por socios con registro).
create function api.ds_recordatorio_config() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return (select jsonb_build_object('aviso_previo_horas', c.aviso_previo_horas, 'intervalo_horas', c.intervalo_horas, 'max_recordatorios', c.max_recordatorios,
                                    'actualizado_por', (select s.nombre from catalogo.socio s where s.id = c.actualizado_por), 'actualizado_at', c.actualizado_at) from operacion.ds_recordatorio_config c where c.id = 1);
end $$;
create function operacion.ds_recordatorio_config_guardar(p_clave_idem text, p_aviso_previo_horas int, p_intervalo_horas int, p_max_recordatorios int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_recordatorio_config_guardar', 'a', p_aviso_previo_horas, 'i', p_intervalo_horas, 'm', p_max_recordatorios));
  if v_prev is not null then return v_prev; end if;
  if p_aviso_previo_horas not between 1 and 168 or p_intervalo_horas not between 1 and 720 or p_max_recordatorios not between 1 and 60 then raise exception 'valores fuera de rango' using errcode = '23514'; end if;
  update operacion.ds_recordatorio_config set aviso_previo_horas = p_aviso_previo_horas, intervalo_horas = p_intervalo_horas, max_recordatorios = p_max_recordatorios, actualizado_por = operacion.actor_socio(), actualizado_at = now() where id = 1;
  perform operacion.crear_evento('ds_recordatorio_config', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('aviso_previo_horas', p_aviso_previo_horas, 'intervalo_horas', p_intervalo_horas, 'max_recordatorios', p_max_recordatorios));
  v_res := jsonb_build_object('aviso_previo_horas', p_aviso_previo_horas, 'intervalo_horas', p_intervalo_horas, 'max_recordatorios', p_max_recordatorios);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Lectura de recordatorios pendientes a una hora dada (rol socio o canal del agente; sin datos personales).
--   por_vencer : el compromiso vence en las proximas aviso_previo_horas y aun no se aviso.
--   vence_hoy  : el compromiso vencio hoy (hora de Merida) y aun no se aviso hoy.
--   vencido    : venció antes de hoy; recordatorio periodico cada intervalo_horas hasta max_recordatorios o hasta que se pague.
--   sin_fecha  : pedido pendiente sin fecha comprometida (alerta; no consume recordatorios).
create function operacion.ds_recordatorios_pago_menudeo(p_ahora timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare cfg operacion.ds_recordatorio_config; v_hoy date := (p_ahora at time zone 'America/Merida')::date;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select * into cfg from operacion.ds_recordatorio_config where id = 1;
  return jsonb_build_object('ahora', p_ahora, 'config', jsonb_build_object('aviso_previo_horas', cfg.aviso_previo_horas, 'intervalo_horas', cfg.intervalo_horas, 'max_recordatorios', cfg.max_recordatorios),
    'recordatorios', coalesce((select jsonb_agg(q.fila order by q.orden, q.pedido_id) from (
      select b.*, jsonb_build_object('pedido_id', b.pedido_id, 'folio', b.folio, 'socio', b.socio, 'proveedor', b.proveedor, 'pendiente_cent', b.pendiente_cent, 'fecha_compromiso', b.fecha_compromiso,
                                     'hora_compromiso', b.hora_compromiso, 'vence_en', b.vence_en, 'dias_atraso', b.dias_atraso, 'tipo', b.tipo, 'enviados', b.enviados, 'pago_reportado', b.reportado_cent > 0) as fila
      from (
        select x.pedido_id, x.folio, x.socio, x.proveedor, x.pendiente_cent, x.reportado_cent, x.fecha_compromiso, x.hora_compromiso, x.vence_en,
               greatest(v_hoy - x.fecha_compromiso, 0) as dias_atraso, l.n as enviados,
               case when x.fecha_compromiso is null then 'sin_fecha'
                    when x.vence_en > p_ahora and x.vence_en <= p_ahora + make_interval(hours => cfg.aviso_previo_horas) then 'por_vencer'
                    when x.vence_en <= p_ahora and x.fecha_compromiso = v_hoy then 'vence_hoy'
                    when x.vence_en <= p_ahora then 'vencido' end as tipo,
               case when x.fecha_compromiso is null then 9 when x.vence_en > p_ahora then 3 when x.fecha_compromiso = v_hoy then 2 else 1 end as orden,
               l.ult
        from operacion.ds_menudeo_filas(null, null, null, null, null) x
        cross join lateral (select count(*) as n, max(g.enviado_at) as ult from operacion.ds_recordatorio_log g where g.pedido_id = x.pedido_id) l
        where x.estado = 'enviado' and x.pendiente_cent > 0) b
      where b.tipo is not null
        and (b.tipo = 'sin_fecha'
             or (b.tipo = 'por_vencer' and not exists (select 1 from operacion.ds_recordatorio_log g where g.pedido_id = b.pedido_id and g.tipo = 'por_vencer' and g.enviado_at >= b.vence_en - make_interval(hours => cfg.aviso_previo_horas)))
             or (b.tipo = 'vence_hoy' and not exists (select 1 from operacion.ds_recordatorio_log g where g.pedido_id = b.pedido_id and g.tipo in ('vence_hoy', 'vencido') and g.enviado_at >= b.vence_en))
             or (b.tipo = 'vencido' and b.enviados < cfg.max_recordatorios and (b.ult is null or b.ult + make_interval(hours => cfg.intervalo_horas) <= p_ahora)))) q), '[]'::jsonb));
end $$;

-- Registra que se envio un recordatorio. Idempotente por pedido y hora (misma hora: no duplica y devuelve el registro existente).
create function operacion.ds_registrar_recordatorio_menudeo(p_clave_idem text, p_pedido bigint, p_tipo text, p_enviado timestamptz default now(), p_canal text default 'telegram') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_vent timestamptz := date_trunc('hour', p_enviado); v_ev bigint; v_id bigint; v_res jsonb; v_folio text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_registrar_recordatorio_menudeo', 'p', p_pedido, 't', p_tipo, 'e', p_enviado, 'c', p_canal));
  if v_prev is not null then return v_prev; end if;
  if p_tipo not in ('por_vencer', 'vence_hoy', 'vencido') then raise exception 'tipo de recordatorio invalido' using errcode = '22023'; end if;
  select x.folio into v_folio from operacion.v_ds_pedido x where x.pedido_id = p_pedido and x.tipo_venta = 'socio_a_costo';
  if v_folio is null then raise exception 'no es un pedido a costo para un socio' using errcode = '22023'; end if;
  select id into v_id from operacion.ds_recordatorio_log where pedido_id = p_pedido and ventana = v_vent;
  if v_id is null then
    v_ev := operacion.crear_evento('ds_recordatorio_pago', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', v_folio, 'tipo', p_tipo, 'canal', p_canal));
    insert into operacion.ds_recordatorio_log (pedido_id, tipo, ventana, enviado_at, canal, evento_id) values (p_pedido, p_tipo, v_vent, p_enviado, p_canal, v_ev) returning id into v_id;
  end if;
  v_res := jsonb_build_object('recordatorio_id', v_id, 'pedido_id', p_pedido, 'tipo', p_tipo, 'enviados', (select count(*) from operacion.ds_recordatorio_log where pedido_id = p_pedido));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Respuesta al recordatorio: 'posponer' (nueva fecha, con motivo) o 'pagado' (reporta el pago por todo lo pendiente; sin evidencia queda "Pago reportado" hasta que el otro socio confirme).
create function operacion.ds_responder_recordatorio_menudeo(p_clave_idem text, p_pedido bigint, p_accion text, p_fecha date default null, p_hora time default null, p_motivo text default null,
                                                            p_referencia text default '', p_metodo text default 'transferencia', p_via text default 'proveedor', p_socio text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_res jsonb; v_pend bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_responder_recordatorio_menudeo', 'p', p_pedido, 'a', p_accion, 'f', p_fecha, 'h', p_hora, 'm', p_motivo, 'r', p_referencia, 'me', p_metodo, 'v', p_via, 's', p_socio));
  if v_prev is not null then return v_prev; end if;
  if p_accion not in ('posponer', 'pagado') then raise exception 'accion invalida' using errcode = '22023'; end if;
  -- Solo se acepta la respuesta del socio de menudeo (autor verificado por el agente).
  if coalesce(operacion.actor_socio(), (select id from catalogo.socio where nombre = p_socio)) is distinct from operacion.ds_socio_menudeo() then raise exception 'solo el socio de menudeo responde por sus pedidos' using errcode = '42501'; end if;
  if p_accion = 'posponer' then
    v_res := operacion.ds_reprogramar_compromiso(p_clave_idem || ':rp', p_pedido, p_fecha, p_hora, p_motivo, p_socio);
  else
    v_pend := greatest(operacion.pedido_saldo(p_pedido), 0) - coalesce((select sum(q.monto_cent) from operacion.ds_pago_reporte q where q.pedido_id = p_pedido and not q.aplicado and not exists (select 1 from operacion.ds_pago_decision d where d.reporte_id = q.id)), 0);
    if v_pend <= 0 then raise exception 'no hay nada pendiente por reportar' using errcode = 'P0428'; end if;
    v_res := operacion.ds_reportar_pago_menudeo(p_clave_idem || ':pg', p_pedido, null, v_pend, p_metodo, p_referencia, null, p_via, null, null, null, p_socio, 'respuesta a recordatorio');
  end if;
  v_res := v_res || jsonb_build_object('accion', p_accion);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.ds_recordatorios_pago_menudeo(p_ahora timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_recordatorios_pago_menudeo(p_ahora); end $$;
create function api.ds_reprogramar_compromiso(p_clave_idem text, p_pedido bigint, p_fecha date, p_hora time default null, p_motivo text default null, p_socio text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_reprogramar_compromiso(p_clave_idem, p_pedido, p_fecha, p_hora, p_motivo, p_socio); end $$;
create function api.ds_recordatorio_config_guardar(p_clave_idem text, p_aviso_previo_horas int, p_intervalo_horas int, p_max_recordatorios int) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_recordatorio_config_guardar(p_clave_idem, p_aviso_previo_horas, p_intervalo_horas, p_max_recordatorios); end $$;

revoke execute on function operacion.ds_menudeo_socio_guardar(text, text), operacion.ds_reprogramar_compromiso(text, bigint, date, time, text, text), operacion.ds_recordatorio_config_guardar(text, int, int, int), operacion.ds_recordatorios_pago_menudeo(timestamptz),
  operacion.ds_registrar_recordatorio_menudeo(text, bigint, text, timestamptz, text), operacion.ds_responder_recordatorio_menudeo(text, bigint, text, date, time, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function api.ds_menudeo_config(), api.ds_menudeo_socio_guardar(text, text), api.ds_recordatorio_config(), api.ds_recordatorios_pago_menudeo(timestamptz), api.ds_reprogramar_compromiso(text, bigint, date, time, text, text), api.ds_recordatorio_config_guardar(text, int, int, int) from public, anon;
-- GRANT a authenticated (cada una exige rol socio dentro). Las operacion.ds_registrar_recordatorio_menudeo y ds_responder_recordatorio_menudeo SOLO las llama el agente (canal telegram) cuando se integre.
grant execute on function api.ds_menudeo_config(), api.ds_menudeo_socio_guardar(text, text), api.ds_recordatorio_config(), api.ds_recordatorios_pago_menudeo(timestamptz), api.ds_reprogramar_compromiso(text, bigint, date, time, text, text), api.ds_recordatorio_config_guardar(text, int, int, int) to authenticated;
