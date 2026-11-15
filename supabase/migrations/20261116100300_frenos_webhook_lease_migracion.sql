-- Carril FRENOS, punto 7: robustez del webhook.
--   * agente.tg_update gana estado, lease, intentos y el cuerpo del update (para reprocesarlo). Un update reclamado y no terminado ya no se pierde: vencido su lease se REPROCESA
--     (las escrituras son idempotentes por clave). Maximo 3 intentos; despues queda 'abandonado' y se avisa UNA vez al grupo.
--   * agente.reclamar_update2 devuelve 'nuevo' | 'reprocesar' | 'duplicado' (reclamar_update, el de siempre, sigue disponible).
--   * agente.migrar_chat: el grupo basico pasa a supergrupo y Telegram cambia su id (migrate_to_chat_id). Una sola funcion actualiza agente.chat_registrado y notificacion.destino.
-- El cuerpo guardado se purga a los 14 dias, como el registro del update.

alter table agente.tg_update add column if not exists estado text not null default 'terminado' check (estado in ('reclamado', 'terminado', 'fallido', 'abandonado'));
alter table agente.tg_update add column if not exists lease_hasta timestamptz;
alter table agente.tg_update add column if not exists intentos int not null default 1;
alter table agente.tg_update add column if not exists cuerpo jsonb;
alter table agente.tg_update add column if not exists error text check (error is null or length(error) <= 300);
alter table agente.tg_update add column if not exists avisado boolean not null default false;
alter table agente.tg_update add column if not exists terminado_at timestamptz;
create index if not exists tg_update_pendientes_idx on agente.tg_update (estado, lease_hasta) where estado in ('reclamado', 'fallido');

create or replace function agente.reclamar_update2(p_update_id bigint, p_cuerpo jsonb default null, p_lease_seg int default 120) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_n int; u agente.tg_update;
begin
  perform notificacion.exigir_sistema();
  insert into agente.tg_update (update_id, estado, lease_hasta, intentos, cuerpo) values (p_update_id, 'reclamado', now() + make_interval(secs => p_lease_seg), 1, p_cuerpo) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then return 'nuevo'; end if;
  select * into u from agente.tg_update where update_id = p_update_id for update;
  if u.estado in ('terminado', 'abandonado') then return 'duplicado'; end if;
  if u.estado = 'reclamado' and u.lease_hasta > now() then return 'duplicado'; end if;
  if u.intentos >= 3 then
    update agente.tg_update set estado = 'abandonado' where update_id = p_update_id;
    return 'duplicado';
  end if;
  update agente.tg_update set estado = 'reclamado', intentos = intentos + 1, lease_hasta = now() + make_interval(secs => p_lease_seg), cuerpo = coalesce(cuerpo, p_cuerpo) where update_id = p_update_id;
  return 'reprocesar';
end $$;

create or replace function agente.terminar_update(p_update_id bigint, p_estado text, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  if p_estado not in ('terminado', 'fallido') then raise exception 'estado de update invalido' using errcode = '22023'; end if;
  update agente.tg_update set estado = p_estado, terminado_at = now(), lease_hasta = null, error = left(p_error, 300), cuerpo = case when p_estado = 'terminado' then null else cuerpo end where update_id = p_update_id;
end $$;

-- Updates que hay que reprocesar: fallidos o con lease vencido, con intentos disponibles y de las ultimas 24 horas.
create or replace function agente.updates_pendientes(p_limite int default 20) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('update_id', x.update_id, 'cuerpo', x.cuerpo, 'intentos', x.intentos) order by x.update_id) from (
    select update_id, cuerpo, intentos from agente.tg_update
    where cuerpo is not null and intentos < 3 and recibido_at > now() - interval '24 hours'
      and (estado = 'fallido' or (estado = 'reclamado' and lease_hasta < now())) order by update_id limit p_limite) x), '[]'::jsonb);
end $$;

-- Updates que ya no se reintentan: se devuelven UNA sola vez para avisar al grupo ("reenvia el mensaje").
create or replace function agente.updates_abandonados() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform notificacion.exigir_sistema();
  update agente.tg_update set estado = 'abandonado' where intentos >= 3 and (estado = 'fallido' or (estado = 'reclamado' and lease_hasta < now()));
  select coalesce(jsonb_agg(jsonb_build_object('update_id', update_id, 'recibido_at', recibido_at) order by update_id), '[]'::jsonb) into v
    from agente.tg_update where estado = 'abandonado' and not avisado and recibido_at > now() - interval '24 hours';
  update agente.tg_update set avisado = true where estado = 'abandonado' and not avisado;
  return v;
end $$;

-- El grupo paso a supergrupo: el id viejo deja de existir. Una sola fuente de verdad (las dos tablas se actualizan juntas). No sale del grupo, no registra nada mas.
create or replace function agente.migrar_chat(p_viejo bigint, p_nuevo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_destino text;
begin
  perform notificacion.exigir_sistema();
  if p_viejo is null or p_nuevo is null or p_viejo = p_nuevo then raise exception 'ids de chat invalidos' using errcode = '22023'; end if;
  update agente.chat_registrado set chat_id = p_nuevo where chat_id = p_viejo returning destino into v_destino;
  update notificacion.destino set telegram_chat_id = p_nuevo where telegram_chat_id = p_viejo;
  if v_destino is null then
    return jsonb_build_object('migrado', false, 'motivo', 'el chat viejo no estaba registrado');
  end if;
  insert into agente.evento (tipo, miembro, detalle) values ('chat_migrado', null, left('destino ' || v_destino || ' paso a supergrupo', 300));
  return jsonb_build_object('migrado', true, 'destino', v_destino);
end $$;

revoke all on function agente.reclamar_update2(bigint, jsonb, int) from public, anon, authenticated;
revoke all on function agente.terminar_update(bigint, text, text) from public, anon, authenticated;
revoke all on function agente.updates_pendientes(int) from public, anon, authenticated;
revoke all on function agente.updates_abandonados() from public, anon, authenticated;
revoke all on function agente.migrar_chat(bigint, bigint) from public, anon, authenticated;
grant execute on function agente.reclamar_update2(bigint, jsonb, int) to servidor;
grant execute on function agente.terminar_update(bigint, text, text) to servidor;
grant execute on function agente.updates_pendientes(int) to servidor;
grant execute on function agente.updates_abandonados() to servidor;
grant execute on function agente.migrar_chat(bigint, bigint) to servidor;
