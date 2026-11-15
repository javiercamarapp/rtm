-- Carril FRENOS (bot de Telegram), punto 1: interruptor de escritura `agente_escritura`.
-- El dueno (14-nov) quito la tarjeta de confirmacion: el bot registra cuando tiene todos los datos. A cambio, este interruptor es el freno maestro:
--   * NACE APAGADO (solo lectura): el dueno lo enciende despues, desde el grupo, con /escritura. Apagado, ninguna puerta de ESCRITURA del agente escribe (falla cerrado con P0463);
--     las consultas y el deshacer siguen funcionando (deshacer es una reversa, no un registro nuevo).
--   * Se lee en UN SOLO punto SQL (agente._exigir_escritura), que llaman agente.ejecutar, agente.ejecutar_ext y agente.resolver_toma (via la capa de frenos de la migracion siguiente).
--   * Lo cambian solo los socios verificados (fijar_escritura exige el id de Telegram del socio). El sistema SOLO puede apagarlo (apagar_escritura_anomalia / revisar_anomalia); reactivar es de un socio.
--   * Cada cambio queda en agente.escritura_cambio (quien, cuando, motivo): el bot responde "Estoy en solo lectura desde HH:MM" con ese dato.
-- Migracion ADITIVA: no redefine ninguna funcion existente. Las funciones nuevas no se conceden a authenticated; las puertas son de `servidor`, los ayudantes `_*` no.

insert into seguridad.interruptor (clave, activo) values ('agente_escritura', false) on conflict (clave) do nothing;

create table if not exists agente.escritura_cambio (
  id bigint generated always as identity primary key,
  activo boolean not null,
  por text not null check (por in ('angelo', 'javier', 'sistema')),
  motivo text check (motivo is null or length(motivo) <= 300),
  creado_at timestamptz not null default clock_timestamp()
);
alter table agente.escritura_cambio enable row level security;
alter table agente.escritura_cambio force row level security;
revoke all on agente.escritura_cambio from public, anon, authenticated;

-- Sin filas el interruptor lleva su valor de origen (apagado). Queda la primera fila como el origen documentado del estado.
insert into agente.escritura_cambio (activo, por, motivo)
select false, 'sistema', 'Estado de origen: solo lectura hasta que un socio escriba /escritura'
where not exists (select 1 from agente.escritura_cambio);

create or replace function agente._escritura_activa() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select i.activo from seguridad.interruptor i where i.clave = 'agente_escritura'), false) $$;

-- UNICO punto donde se lee el interruptor para bloquear una escritura. Falla cerrado.
create or replace function agente._exigir_escritura() returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_desde timestamptz;
begin
  if agente._escritura_activa() then return; end if;
  select c.creado_at into v_desde from agente.escritura_cambio c where not c.activo order by c.id desc limit 1;
  raise exception 'el agente esta en solo lectura%: un socio lo reactiva con /escritura', case when v_desde is null then '' else ' desde ' || to_char(v_desde at time zone 'America/Merida', 'HH24:MI') end
    using errcode = 'P0463';
end $$;

-- Estado que lee TypeScript para responder "Estoy en solo lectura desde HH:MM".
create or replace function agente.escritura_estado() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c agente.escritura_cambio;
begin
  perform notificacion.exigir_sistema();
  select * into c from agente.escritura_cambio order by id desc limit 1;
  return jsonb_build_object('activa', agente._escritura_activa(), 'desde', c.creado_at, 'por', c.por, 'motivo', c.motivo);
end $$;

-- /lectura y /escritura: solo un socio verificado (el id de Telegram debe corresponder al socio indicado). Idempotente: repetir el mismo estado no cambia nada.
create or replace function agente.fijar_escritura(p_activo boolean, p_autor text, p_telegram_user_id bigint, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_socio text; v_antes boolean;
begin
  perform notificacion.exigir_sistema();
  v_socio := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  v_antes := agente._escritura_activa();
  if v_antes is distinct from p_activo then
    insert into seguridad.interruptor (clave, activo) values ('agente_escritura', p_activo) on conflict (clave) do update set activo = excluded.activo;
    insert into agente.escritura_cambio (activo, por, motivo) values (p_activo, v_socio, left(p_motivo, 300));
    insert into agente.evento (tipo, miembro, detalle) values (case when p_activo then 'escritura_encendida' else 'escritura_apagada' end, p_telegram_user_id, left('cambio de ' || v_socio || coalesce(': ' || p_motivo, ''), 300));
  end if;
  return jsonb_build_object('activa', p_activo, 'cambio', v_antes is distinct from p_activo, 'por', v_socio);
end $$;

-- El sistema SOLO puede apagar (nunca encender). Lo usa la deteccion de anomalias.
create or replace function agente.apagar_escritura_anomalia(p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_antes boolean;
begin
  perform notificacion.exigir_sistema();
  v_antes := agente._escritura_activa();
  if v_antes then
    update seguridad.interruptor set activo = false where clave = 'agente_escritura';
    insert into agente.escritura_cambio (activo, por, motivo) values (false, 'sistema', left('Apagado automatico por anomalia: ' || coalesce(p_motivo, 'sin motivo'), 300));
    insert into agente.evento (tipo, miembro, detalle) values ('escritura_apagada_anomalia', null, left(coalesce(p_motivo, 'sin motivo'), 300));
  end if;
  return jsonb_build_object('apagado', v_antes, 'motivo', p_motivo);
end $$;

-- Deteccion de anomalias (la llama TypeScript despues de cada tanda de escrituras). Solo APAGA. Umbrales deliberadamente holgados: un lote normal de ~30 lineas no la dispara.
--   * mas de 80 hechos del agente en 5 minutos (un bucle o un envio repetido sin control),
--   * 10 o mas bloqueos por duplicado en 5 minutos (alguien o algo reenviando lo mismo),
--   * 10 o mas errores de escritura inesperados en 5 minutos (la base o el modelo fallando en serie).
create or replace function agente.revisar_anomalia() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_hechos int; v_dups int; v_err int; v_motivo text;
begin
  perform notificacion.exigir_sistema();
  if not agente._escritura_activa() then return jsonb_build_object('apagado', false, 'ya_apagada', true); end if;
  select count(*) into v_hechos from agente.hecho where creado_at > now() - interval '5 minutes';
  select count(*) filter (where tipo = 'duplicado_bloqueado'), count(*) filter (where tipo = 'error_escritura') into v_dups, v_err from agente.evento where creado_at > now() - interval '5 minutes';
  v_motivo := case
    when v_hechos > 80 then format('%s movimientos del agente en 5 minutos', v_hechos)
    when v_dups >= 10 then format('%s bloqueos por duplicado en 5 minutos', v_dups)
    when v_err >= 10 then format('%s errores de escritura en 5 minutos', v_err)
    else null end;
  if v_motivo is null then return jsonb_build_object('apagado', false); end if;
  perform agente.apagar_escritura_anomalia(v_motivo);
  return jsonb_build_object('apagado', true, 'motivo', v_motivo);
end $$;

revoke all on function agente._escritura_activa() from public, anon, authenticated;
revoke all on function agente._exigir_escritura() from public, anon, authenticated;
revoke all on function agente.escritura_estado() from public, anon, authenticated;
revoke all on function agente.fijar_escritura(boolean, text, bigint, text) from public, anon, authenticated;
revoke all on function agente.apagar_escritura_anomalia(text) from public, anon, authenticated;
revoke all on function agente.revisar_anomalia() from public, anon, authenticated;
grant execute on function agente.escritura_estado() to servidor;
grant execute on function agente.fijar_escritura(boolean, text, bigint, text) to servidor;
grant execute on function agente.apagar_escritura_anomalia(text) to servidor;
grant execute on function agente.revisar_anomalia() to servidor;
