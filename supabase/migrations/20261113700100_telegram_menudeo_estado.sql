-- Lane telegram-ampliacion (2/3): estado de conversacion y comprobantes de Telegram para el menudeo del socio.
-- ADITIVA: tablas y funciones nuevas del esquema `agente` y UNA redefinicion (create or replace, misma firma) de operacion.ds_reportar_pago_menudeo para que un comprobante
-- recibido por Telegram (solo su huella) cuente como evidencia. Sin DROP. Ninguna funcion nueva tiene GRANT a authenticated: las `agente.*` son solo del rol servidor.
--
-- * agente.tg_espera: la pregunta abierta a un socio ("¿cuando pagas?", "¿para cuando lo reprogramas?"). Un socio tiene a lo mas una abierta; caduca; se toma una sola vez.
-- * agente.evidencia_tg: el comprobante (foto del ticket o la transferencia) se guarda SOLO como evidencia: su file_id y su huella (sha256 del file_unique_id). El bot no descarga
--   ni lee la imagen y la IA nunca la ve. Se liga al reporte de pago cuando el socio lo registra.

create table agente.tg_espera (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  telegram_user_id bigint not null references agente.miembro (telegram_user_id),
  tipo text not null check (tipo in ('fecha_pago', 'fecha_reprogramar')),
  payload jsonb not null default '{}'::jsonb,
  creada_at timestamptz not null default now(),
  caduca_at timestamptz not null,
  resuelta_at timestamptz
);
create index tg_espera_abierta_idx on agente.tg_espera (telegram_user_id) where resuelta_at is null;

create table agente.evidencia_tg (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  mensaje_id bigint not null,
  telegram_user_id bigint not null references agente.miembro (telegram_user_id),
  file_id text not null check (length(file_id) between 1 and 300),
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  creada_at timestamptz not null default now(),
  reporte_id bigint references operacion.ds_pago_reporte (id),
  unique (chat_id, mensaje_id)
);
create unique index evidencia_tg_reporte_idx on agente.evidencia_tg (reporte_id) where reporte_id is not null;
do $$
declare t text;
begin
  foreach t in array array['tg_espera', 'evidencia_tg'] loop
    execute format('alter table agente.%I enable row level security', t);
    execute format('alter table agente.%I force row level security', t);
    execute format('revoke all on agente.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema agente from public, anon, authenticated;

-- ------------------------------------------------------------------ preguntas abiertas
-- Abre la pregunta de un socio verificado. Cierra la que tuviera abierta (una a la vez).
create function agente.espera_abrir(p_chat bigint, p_telegram_user_id bigint, p_tipo text, p_payload jsonb, p_caduca timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  if not exists (select 1 from agente.miembro m where m.telegram_user_id = p_telegram_user_id and m.rol = 'socio' and m.activo) then
    raise exception 'permiso denegado: solo un socio registrado tiene preguntas abiertas' using errcode = '42501';
  end if;
  update agente.tg_espera set resuelta_at = now() where telegram_user_id = p_telegram_user_id and resuelta_at is null;
  insert into agente.tg_espera (chat_id, telegram_user_id, tipo, payload, caduca_at) values (p_chat, p_telegram_user_id, p_tipo, coalesce(p_payload, '{}'::jsonb), p_caduca);
end $$;

-- Toma (una sola vez) la pregunta abierta de ese socio en ese chat, si no caduco. null = no hay.
create function agente.espera_tomar(p_chat bigint, p_telegram_user_id bigint, p_ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e agente.tg_espera;
begin
  perform notificacion.exigir_sistema();
  select * into e from agente.tg_espera where telegram_user_id = p_telegram_user_id and chat_id = p_chat and resuelta_at is null order by id desc limit 1 for update;
  if not found then return null; end if;
  update agente.tg_espera set resuelta_at = now() where id = e.id;
  if p_ahora >= e.caduca_at then return null; end if;
  return jsonb_build_object('tipo', e.tipo, 'payload', e.payload);
end $$;

-- ------------------------------------------------------------------ comprobantes
create function agente.evidencia_guardar(p_chat bigint, p_mensaje bigint, p_telegram_user_id bigint, p_file_id text, p_file_unique_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_huella text := encode(sha256(convert_to(coalesce(nullif(p_file_unique_id, ''), p_file_id), 'UTF8')), 'hex');
begin
  perform notificacion.exigir_sistema();
  if not exists (select 1 from agente.miembro m where m.telegram_user_id = p_telegram_user_id and m.rol = 'socio' and m.activo) then
    raise exception 'permiso denegado: solo un socio registrado deja comprobantes' using errcode = '42501';
  end if;
  insert into agente.evidencia_tg (chat_id, mensaje_id, telegram_user_id, file_id, huella) values (p_chat, p_mensaje, p_telegram_user_id, p_file_id, v_huella)
    on conflict (chat_id, mensaje_id) do nothing returning id into v_id;
  if v_id is null then select e.id into v_id from agente.evidencia_tg e where e.chat_id = p_chat and e.mensaje_id = p_mensaje; end if;
  return jsonb_build_object('id', v_id, 'huella', v_huella);
end $$;

-- El comprobante mas reciente de ese socio que aun no esta ligado a un pago y llego en los ultimos 30 minutos (interna: la usa el registro del pago).
create function agente._evidencia_pendiente(p_telegram_user_id bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select e.id from agente.evidencia_tg e where e.telegram_user_id = p_telegram_user_id and e.reporte_id is null and e.creada_at >= now() - interval '30 minutes' order by e.id desc limit 1 $$;

-- ------------------------------------------------------------------ interruptor de envio (los recordatorios no salen con `telegram_envio` apagado)
create function agente.envio_activo() returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select i.activo from seguridad.interruptor i where i.clave = 'telegram_envio'), false);
end $$;

-- ------------------------------------------------------------------ un comprobante de Telegram (solo huella) cuenta como evidencia al reportar el pago
-- Misma funcion de dropshipping (copia de 20261113400400 con tres cambios marcados): con comprobante el pago se aplica y el otro socio todavia puede rechazarlo.
create or replace function operacion.ds_reportar_pago_menudeo(p_clave_idem text, p_pedido bigint default null, p_folio text default null, p_monto_cent bigint default null, p_metodo text default 'transferencia',
                                                   p_referencia text default '', p_fecha date default null, p_via text default 'proveedor', p_evidencia_b64 text default null,
                                                   p_evidencia_mime text default null, p_evidencia_nombre text default null, p_socio text default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  -- Comprobante recibido por Telegram (solo huella): lo fija agente._menudeo_base en la misma transaccion; solo cuenta en el canal telegram.
  v_tg_evid text := case when seguridad.canal_actual() = 'telegram' then nullif(current_setting('rtm.evidencia_tg', true), '') end;
  v_prev jsonb; v_canal text := seguridad.canal_actual(); v_ped bigint; r record; v_rep bigint; v_bytes bytea; v_evid bigint; v_sha text; v_inmediato boolean; v_pago jsonb; v_pago_id bigint;
  v_ev bigint; v_id bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_pend bigint; v_res jsonb; v_resumen text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_reportar_pago_menudeo', 'p', p_pedido, 'fo', p_folio, 'm', p_monto_cent, 'me', p_metodo, 'r', p_referencia, 'f', p_fecha, 'v', p_via,
                                         'h', case when p_evidencia_b64 is null then null else encode(sha256(convert_to(p_evidencia_b64, 'UTF8')), 'hex') end, 's', p_socio, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_metodo not in ('transferencia', 'deposito', 'efectivo') then raise exception 'metodo de pago invalido' using errcode = '22023'; end if;
  if p_via not in ('proveedor', 'sociedad') then raise exception 'via de pago invalida' using errcode = '22023'; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el monto debe ser positivo' using errcode = '23514'; end if;
  if length(coalesce(p_referencia, '')) > 120 then raise exception 'la referencia es demasiado larga' using errcode = '23514'; end if;
  if v_fecha > negocio.hoy() + 1 then raise exception 'la fecha del pago no puede ser futura' using errcode = '23514'; end if;
  v_ped := coalesce(p_pedido, (select id from operacion.pedido where folio = p_folio));
  select x.pedido_id, x.estado, x.tipo_venta, x.socio_venta_id, x.venta_cent, x.folio into r from operacion.v_ds_pedido x where x.pedido_id = v_ped;
  if not found or r.tipo_venta is distinct from 'socio_a_costo' then raise exception 'no es un pedido a costo para un socio' using errcode = '22023'; end if;
  if r.estado <> 'enviado' then raise exception 'el pedido aun no esta enviado: no hay nada que pagar todavia' using errcode = 'P0428'; end if;
  v_rep := coalesce(operacion.actor_socio(), (select id from catalogo.socio where nombre = p_socio));
  if v_rep is null then raise exception 'indica que socio reporta el pago' using errcode = '23502'; end if;
  if v_rep <> operacion.ds_socio_menudeo() then raise exception 'solo el socio de menudeo registra el pago de sus pedidos: el otro socio los confirma o rechaza' using errcode = '42501'; end if;
  if p_evidencia_b64 is not null and v_canal <> 'web' then raise exception 'la evidencia solo se adjunta desde la web: el bot no lee ni recibe tickets' using errcode = '22023'; end if;
  v_pend := greatest(operacion.pedido_saldo(v_ped), 0) - coalesce((select sum(q.monto_cent) from operacion.ds_pago_reporte q where q.pedido_id = v_ped and not q.aplicado and not exists (select 1 from operacion.ds_pago_decision d where d.reporte_id = q.id)), 0);
  if p_monto_cent > v_pend then raise exception 'el monto excede lo pendiente de pago (descontando pagos ya reportados por confirmar)' using errcode = '23514'; end if;
  if p_evidencia_b64 is not null then
    v_bytes := decode(p_evidencia_b64, 'base64');
    if length(v_bytes) < 1 or length(v_bytes) > 2097152 then raise exception 'la evidencia debe pesar entre 1 byte y 2 MB' using errcode = '23514'; end if;
    if p_evidencia_mime not in ('image/png', 'image/jpeg', 'application/pdf') then raise exception 'la evidencia debe ser imagen PNG o JPEG, o PDF' using errcode = '22023'; end if;
    if not ((p_evidencia_mime = 'image/png' and substring(v_bytes from 1 for 4) = '\x89504e47'::bytea) or (p_evidencia_mime = 'image/jpeg' and substring(v_bytes from 1 for 3) = '\xffd8ff'::bytea)
            or (p_evidencia_mime = 'application/pdf' and substring(v_bytes from 1 for 4) = '\x25504446'::bytea)) then raise exception 'el archivo no corresponde a su tipo' using errcode = '22023'; end if;
    v_sha := encode(sha256(v_bytes), 'hex');
    insert into entrega.evidencia_pago (sha256, mime, nombre, tam_bytes, contenido, subido_por) values (v_sha, p_evidencia_mime, coalesce(nullif(btrim(p_evidencia_nombre), ''), 'evidencia'), length(v_bytes), v_bytes, v_rep) returning id into v_evid;
  end if;
  -- Politica: con evidencia, o si lo registra el OTRO socio (el que recibe), se aplica de inmediato; si no, queda "Pago reportado" hasta que el otro socio confirme.
  v_inmediato := v_evid is not null or v_tg_evid is not null or v_rep <> r.socio_venta_id;
  v_ev := operacion.crear_evento('ds_pago_reportado', v_fecha, p_clave_idem || ':ev', jsonb_build_object('pedido', r.folio, 'monto_cent', p_monto_cent, 'metodo', p_metodo, 'con_evidencia', v_evid is not null, 'comprobante_telegram', v_tg_evid is not null, 'canal', v_canal, 'aplicado', v_inmediato));
  if v_inmediato then
    v_pago := operacion.ds_pagar_pedido_menudeo(p_clave_idem || ':pg', v_ped, p_via, p_monto_cent, v_fecha, p_nota);
    v_pago_id := (v_pago->>'pago_id')::bigint;
  end if;
  insert into operacion.ds_pago_reporte (pedido_id, reportado_por, monto_cent, metodo, referencia, fecha_pago, via, canal, evidencia_id, aplicado, pago_id, nota, evento_id)
    values (v_ped, v_rep, p_monto_cent, p_metodo, coalesce(btrim(p_referencia), ''), v_fecha, p_via, v_canal, v_evid, v_inmediato, v_pago_id, p_nota, v_ev) returning id into v_id;
  v_res := jsonb_build_object('reporte_id', v_id, 'pedido_id', v_ped, 'aplicado', v_inmediato, 'requiere_confirmacion_del_otro_socio', not v_inmediato, 'con_evidencia', v_evid is not null,
                              'evidencia_sha256', v_sha, 'comprobante_telegram', v_tg_evid is not null, 'pendiente_cent', greatest(operacion.pedido_saldo(v_ped), 0),
                              'estado', case when not v_inmediato then 'pago_reportado' when operacion.pedido_saldo(v_ped) <= 0 then 'pagado' else 'no_pagado' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------------ privilegios (por funcion; ninguna a authenticated)
revoke all on function agente.espera_abrir(bigint, bigint, text, jsonb, timestamptz), agente.espera_tomar(bigint, bigint, timestamptz), agente.evidencia_guardar(bigint, bigint, bigint, text, text),
  agente.envio_activo() from public, anon, authenticated;
grant execute on function agente.espera_abrir(bigint, bigint, text, jsonb, timestamptz), agente.espera_tomar(bigint, bigint, timestamptz), agente.evidencia_guardar(bigint, bigint, bigint, text, text),
  agente.envio_activo() to servidor;
revoke all on function agente._evidencia_pendiente(bigint) from public, anon, authenticated, servidor;
