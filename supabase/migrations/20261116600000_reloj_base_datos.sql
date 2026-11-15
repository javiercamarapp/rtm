-- Carril RELOJ (bot de Telegram), punto 1: el reloj vive en la base de datos (pg_cron + pg_net). CONSTRUIDO Y APAGADO.
--   * Hoy NO hay reloj en produccion. Esta migracion NO enciende nada: habilita las extensiones solo si estan disponibles y deja los jobs CREADOS pero DESACTIVADOS.
--   * Dos jobs: `rtm_reloj_latido` (cada 5 min: cuenta la ejecucion, y solo si `reloj_http` esta encendido pide el latido de la app con pg_net) y `rtm_reloj_vigia` (cada 15 min: detecta el reloj caido).
--   * LATIDO SIN ENVIAR: con `reloj_http` apagado (estado de origen) el tick solo cuenta y deja su fila en reloj.latido. Nunca habla con Telegram: Telegram solo lo despacha la app (despachador).
--   * Reintento seguro: solo se repite una peticion cuya respuesta REGISTRADA en net._http_response no es 2xx. Sin respuesta registrada no se reenvia (pudo haber salido) y se avisa.
--   * Alerta de reloj caido: sin latido en la tolerancia (con `reloj_activo` encendido) se emite `tarea_sin_latido` (NT-103); al volver el latido el asunto se resuelve solo.
--   * Encendido y apagado: reloj.encender() / reloj.apagar() (solo sistema). Ver docs/reloj-base-datos.md. Migracion ADITIVA: no redefine ninguna funcion existente.

create schema if not exists reloj;
revoke all on schema reloj from public, anon, authenticated;
grant usage on schema reloj to servidor;

-- ---------------------------------------------------------------------------
-- Parametros e interruptores (todo nace apagado). catalogo.config vive por vigencia; ninguna constante dentro de las funciones.
-- ---------------------------------------------------------------------------
insert into catalogo.config (clave, valor, vigente_desde) values
  ('reloj_intervalo_min', '5', '2026-11-10'),
  ('reloj_tolerancia_min', '15', '2026-11-10'),
  ('reloj_url_latido', '""', '2026-11-10'),
  ('reloj_vault_secreto', '"reloj_tareas_secreto"', '2026-11-10'),
  ('reloj_http_timeout_ms', '20000', '2026-11-10'),
  ('reloj_reintentos_max', '2', '2026-11-10'),
  ('reloj_reintento_espera_min', '3', '2026-11-10'),
  ('reloj_retencion_dias', '14', '2026-11-10');

insert into seguridad.interruptor (clave, activo) values
  ('reloj_activo', false),               -- el reloj DEBE estar corriendo (si esta encendido y no hay latido, se avisa)
  ('reloj_http', false),                 -- el tick pide el latido de la app con pg_net (apagado = latido sin enviar)
  ('reloj_transporte_simulado', false)   -- pruebas: el tick registra la peticion sin llamar a pg_net
  on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table reloj.contador (
  id int primary key check (id = 1),
  ejecuciones bigint not null default 0,
  ultimo_latido_at timestamptz,
  ultima_solicitud_at timestamptz
);
insert into reloj.contador (id) values (1);

create table reloj.latido (
  id bigint generated always as identity primary key,
  tick_at timestamptz not null,
  origen text not null check (origen in ('pg_cron', 'manual', 'simulado')),
  modo text not null check (modo in ('sin_enviar', 'http')),
  solicitud_id bigint,
  nota text check (nota is null or length(nota) <= 200)
);
create index latido_tick_idx on reloj.latido (tick_at desc);

create table reloj.solicitud (
  id bigint generated always as identity primary key,
  tarea text not null default 'latido',
  creada_at timestamptz not null,
  net_request_id bigint,
  estado text not null default 'enviada' check (estado in ('enviada', 'ok', 'fallida', 'sin_respuesta')),
  http_status int,
  intentos int not null default 1 check (intentos >= 1),
  reintento_de bigint references reloj.solicitud (id),
  revisada_at timestamptz
);
create index solicitud_estado_idx on reloj.solicitud (estado, creada_at);
-- Solo pruebas: respuestas simuladas que reemplazan a net._http_response cuando el transporte es simulado.
create table reloj.respuesta_simulada (
  net_request_id bigint primary key,
  status_code int,
  timed_out boolean not null default false,
  error_msg text
);
create sequence reloj.seq_simulada;

create table reloj.job (
  clave text primary key,
  expresion_cron text not null,
  comando text not null,
  descripcion text not null,
  activo boolean not null default false,
  cron_jobid bigint
);

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'reloj' and c.relkind = 'r' loop
    execute format('alter table reloj.%I enable row level security', t);
    execute format('alter table reloj.%I force row level security', t);
    execute format('revoke all on reloj.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema reloj from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ayudantes privados (sin concesion a servidor: los llaman las funciones publicas del esquema, que son security definer)
-- ---------------------------------------------------------------------------
create function reloj._interruptor(p_clave text) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select i.activo from seguridad.interruptor i where i.clave = p_clave), false) $$;

-- Respuesta HTTP registrada de una peticion: (status, hay_respuesta). Con transporte simulado lee reloj.respuesta_simulada; si no, net._http_response (si pg_net existe).
create function reloj._respuesta(p_net_request_id bigint, out hay boolean, out status int, out error text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  hay := false; status := null; error := null;
  if p_net_request_id is null then return; end if;
  if reloj._interruptor('reloj_transporte_simulado') then
    select true, r.status_code, case when r.timed_out then 'timeout' else r.error_msg end into hay, status, error from reloj.respuesta_simulada r where r.net_request_id = p_net_request_id;
    hay := coalesce(hay, false);
    return;
  end if;
  if to_regclass('net._http_response') is null then return; end if;
  execute 'select true, r.status_code, case when r.timed_out then ''timeout'' else r.error_msg end from net._http_response r where r.id = $1' into hay, status, error using p_net_request_id;
  hay := coalesce(hay, false);
end $$;

-- Pide el latido de la app. Devuelve el id de la peticion de pg_net (o uno simulado). Falla cerrado si falta pg_net, la URL o el secreto del Vault.
create function reloj._pedir_latido() returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_url text := catalogo.config_valor('reloj_url_latido') #>> '{}'; v_sec text; v_id bigint; v_nombre text := catalogo.config_valor('reloj_vault_secreto') #>> '{}';
begin
  if reloj._interruptor('reloj_transporte_simulado') then return nextval('reloj.seq_simulada'); end if;
  if coalesce(v_url, '') = '' then raise exception 'reloj: falta la URL del latido (catalogo.config reloj_url_latido)' using errcode = 'P0481'; end if;
  if to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') is null then raise exception 'reloj: pg_net no esta disponible' using errcode = 'P0481'; end if;
  if to_regclass('vault.decrypted_secrets') is null then raise exception 'reloj: el Vault no esta disponible' using errcode = 'P0481'; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_sec using v_nombre;
  if v_sec is null then raise exception 'reloj: falta el secreto % en el Vault', v_nombre using errcode = 'P0481'; end if;
  execute 'select net.http_get(url := $1, headers := jsonb_build_object(''Authorization'', ''Bearer '' || $2), timeout_milliseconds := $3)'
    into v_id using v_url, v_sec, (catalogo.config_valor('reloj_http_timeout_ms') #>> '{}')::int;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Tick: lo corre pg_cron cada 5 minutos (job desactivado de origen). Siempre cuenta; solo con reloj_http encendido pide el latido de la app.
-- ---------------------------------------------------------------------------
create function reloj.tick(p_origen text default 'pg_cron', p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_http boolean; v_sol bigint; v_net bigint; v_modo text; v_nota text; v_rein jsonb;
begin
  perform notificacion.exigir_sistema();
  if p_origen not in ('pg_cron', 'manual', 'simulado') then raise exception 'origen desconocido' using errcode = '22023'; end if;
  if reloj._interruptor('cron_pausado') then
    return jsonb_build_object('pausado', true);
  end if;
  v_http := reloj._interruptor('reloj_http');
  v_modo := case when v_http then 'http' else 'sin_enviar' end;
  if v_http then
    begin
      v_net := reloj._pedir_latido();
      insert into reloj.solicitud (creada_at, net_request_id) values (v_ahora, v_net) returning id into v_sol;
      update reloj.contador set ultima_solicitud_at = v_ahora where id = 1;
    exception when others then
      -- Un error al pedir el latido no cuenta como respuesta ni se reintenta a ciegas: queda anotado y la vigia avisa si el latido deja de llegar.
      v_nota := left('no se pudo pedir el latido: ' || sqlstate, 200);
    end;
  end if;
  insert into reloj.latido (tick_at, origen, modo, solicitud_id, nota) values (v_ahora, p_origen, v_modo, v_sol, v_nota);
  update reloj.contador set ejecuciones = ejecuciones + 1, ultimo_latido_at = v_ahora where id = 1;
  v_rein := reloj.reintentar(v_ahora);
  return jsonb_build_object('modo', v_modo, 'solicitud', v_sol, 'nota', v_nota, 'reintento', v_rein, 'ejecuciones', (select ejecuciones from reloj.contador where id = 1));
end $$;

-- ---------------------------------------------------------------------------
-- Reintento: SOLO si la respuesta registrada no es 2xx (o se agoto el tiempo). Sin respuesta registrada NO se reenvia: pudo haber salido; se marca y la vigia avisa.
-- ---------------------------------------------------------------------------
create function reloj.reintentar(p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); s reloj.solicitud; r record; v_nuevo bigint; v_net bigint; v_ok int := 0; v_rein int := 0; v_sin int := 0; v_fall int := 0;
  v_espera int := (catalogo.config_valor('reloj_reintento_espera_min') #>> '{}')::int; v_max int := (catalogo.config_valor('reloj_reintentos_max') #>> '{}')::int;
begin
  perform notificacion.exigir_sistema();
  for s in select * from reloj.solicitud where estado in ('enviada', 'sin_respuesta') and creada_at <= v_ahora - make_interval(mins => v_espera) order by id for update skip locked loop
    select * into r from reloj._respuesta(s.net_request_id);
    if not r.hay then
      -- Sin respuesta: no se reenvia. Se marca una sola vez y se avisa (aviso de reloj caido por falta de respuesta).
      if s.estado <> 'sin_respuesta' then
        update reloj.solicitud set estado = 'sin_respuesta', revisada_at = v_ahora where id = s.id;
        perform operacion.avisar('tarea_sin_latido', null, 'reloj_sin_respuesta:' || s.id, 'C', 'El reloj pidio el latido y no hay respuesta registrada; no se reenvio', 'reloj', s.id,
                                 jsonb_build_object('texto', 'El reloj de la base pidio el latido de la app y no hay respuesta registrada. No se reenvio para no duplicar. Revisar la app y el reloj.'));
        v_sin := v_sin + 1;
      end if;
    elsif r.status between 200 and 299 then
      update reloj.solicitud set estado = 'ok', http_status = r.status, revisada_at = v_ahora where id = s.id;
      v_ok := v_ok + 1;
    elsif s.intentos < v_max then
      v_net := reloj._pedir_latido();
      insert into reloj.solicitud (creada_at, net_request_id, intentos, reintento_de) values (v_ahora, v_net, s.intentos + 1, s.id) returning id into v_nuevo;
      update reloj.solicitud set estado = 'fallida', http_status = r.status, revisada_at = v_ahora where id = s.id;
      v_rein := v_rein + 1;
    else
      update reloj.solicitud set estado = 'fallida', http_status = r.status, revisada_at = v_ahora where id = s.id;
      perform operacion.avisar('tarea_sin_latido', null, 'reloj_http_fallida:' || s.id, 'C', 'El latido de la app fallo y se agotaron los reintentos', 'reloj', s.id,
                               jsonb_build_object('texto', 'El reloj de la base pidio el latido de la app y fallo ' || s.intentos || ' veces. Revisar la app.'));
      v_fall := v_fall + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'reintentos', v_rein, 'sin_respuesta', v_sin, 'agotadas', v_fall);
end $$;

-- ---------------------------------------------------------------------------
-- Vigia: reloj caido = el reloj debe estar corriendo (reloj_activo) y no hay latido dentro de la tolerancia. Un asunto abierto por caida; se resuelve solo al volver.
-- La vigia es un job aparte y tambien la corre el latido de la app (segundo mecanismo): un reloj caido no puede avisar por si mismo.
-- ---------------------------------------------------------------------------
create function reloj.verificar(p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); c reloj.contador; v_tol int := (catalogo.config_valor('reloj_tolerancia_min') #>> '{}')::int; v_caido boolean; v_clave text; v_id bigint; v_emitir boolean;
begin
  perform notificacion.exigir_sistema();
  select * into c from reloj.contador where id = 1;
  if not reloj._interruptor('reloj_activo') then
    return jsonb_build_object('esperado', false, 'caido', false);
  end if;
  v_caido := c.ultimo_latido_at is null or c.ultimo_latido_at < v_ahora - make_interval(mins => v_tol);
  if v_caido then
    v_clave := 'reloj_caido:' || coalesce(extract(epoch from c.ultimo_latido_at)::bigint::text, 'nunca');
    -- Regla propia con su interruptor y su ventana (nada hacia atras): la regla `reloj_caido` del motor de evaluadores decide si el asunto se emite.
    v_emitir := notificacion.regla_ventana('reloj_caido', v_ahora) is not null;
    if v_emitir then
      v_id := operacion.avisar('tarea_sin_latido', null, v_clave, 'C', 'El reloj de la base no da latido desde hace mas de ' || v_tol || ' minutos', 'reloj', 1,
                               jsonb_build_object('texto', 'Reloj caido: la base no registra latido desde hace mas de ' || v_tol || ' minutos. Revisar pg_cron y la app.'));
    end if;
  else
    perform operacion.resolver_avisos('tarea_sin_latido', 'reloj', 1);
  end if;
  return jsonb_build_object('esperado', true, 'caido', v_caido, 'aviso', v_id, 'ultimo_latido_at', c.ultimo_latido_at);
end $$;

-- Purga de latidos y solicitudes viejas (solo las registradas aqui; nada de negocio).
create function reloj.purgar(p_ahora timestamptz default null) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int; v_corte timestamptz := coalesce(p_ahora, clock_timestamp()) - make_interval(days => (catalogo.config_valor('reloj_retencion_dias') #>> '{}')::int);
begin
  perform notificacion.exigir_sistema();
  delete from reloj.latido where tick_at < v_corte;
  get diagnostics v_n = row_count;
  delete from reloj.solicitud s where s.creada_at < v_corte and s.estado in ('ok', 'fallida') and not exists (select 1 from reloj.solicitud h where h.reintento_de = s.id);
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Extensiones y jobs: SOLO si estan disponibles; los jobs nacen DESACTIVADOS.
-- ---------------------------------------------------------------------------
create function reloj.preparar_extensiones() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_net boolean := false; v_cron boolean := false;
begin
  perform notificacion.exigir_sistema();
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin create extension if not exists pg_net; exception when others then raise notice 'pg_net no se pudo habilitar: %', sqlerrm; end;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron no se pudo habilitar: %', sqlerrm; end;
  end if;
  v_net := exists (select 1 from pg_extension where extname = 'pg_net');
  v_cron := exists (select 1 from pg_extension where extname = 'pg_cron');
  return jsonb_build_object('pg_net', v_net, 'pg_cron', v_cron);
end $$;

-- Sincroniza reloj.job con pg_cron (si existe): crea el job con su nombre (idempotente) y fija active segun reloj.job.activo.
create function reloj.sincronizar_cron() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare j reloj.job; v_id bigint; v_n int := 0;
begin
  perform notificacion.exigir_sistema();
  if to_regnamespace('cron') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    return jsonb_build_object('cron', false, 'sincronizados', 0);
  end if;
  for j in select * from reloj.job order by clave loop
    execute 'select cron.schedule($1, $2, $3)' into v_id using j.clave, j.expresion_cron, j.comando;
    execute 'select cron.alter_job($1, active := $2)' using v_id, j.activo;
    update reloj.job set cron_jobid = v_id where clave = j.clave;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('cron', true, 'sincronizados', v_n);
end $$;

-- Siembra los jobs (todos DESACTIVADOS) y los sincroniza si pg_cron existe.
create function reloj.sembrar_jobs() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into reloj.job (clave, expresion_cron, comando, descripcion, activo) values
    ('rtm_reloj_latido', '*/5 * * * *', 'select reloj.tick(''pg_cron'')', 'Cuenta la ejecucion y, con reloj_http encendido, pide el latido de la app', false),
    ('rtm_reloj_vigia', '*/15 * * * *', 'select reloj.verificar()', 'Detecta el reloj caido (segundo job, independiente del tick)', false)
    on conflict (clave) do update set expresion_cron = excluded.expresion_cron, comando = excluded.comando, descripcion = excluded.descripcion;
  return reloj.sincronizar_cron();
end $$;

-- Encender: interruptor reloj_activo + jobs activos. NO enciende reloj_http ni telegram_envio ni ninguna regla: cada uno se decide por separado.
create function reloj.encender() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into seguridad.interruptor (clave, activo) values ('reloj_activo', true) on conflict (clave) do update set activo = true;
  update reloj.job set activo = true where clave is not null;
  return jsonb_build_object('reloj_activo', true) || reloj.sincronizar_cron();
end $$;

create function reloj.apagar() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into seguridad.interruptor (clave, activo) values ('reloj_activo', false) on conflict (clave) do update set activo = false;
  insert into seguridad.interruptor (clave, activo) values ('reloj_http', false) on conflict (clave) do update set activo = false;
  update reloj.job set activo = false where clave is not null;
  return jsonb_build_object('reloj_activo', false, 'reloj_http', false) || reloj.sincronizar_cron();
end $$;

-- Estado para la pantalla y para las pruebas (solo lectura).
create function reloj.estado(p_ahora timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c reloj.contador;
begin
  perform notificacion.exigir_sistema();
  select * into c from reloj.contador where id = 1;
  return jsonb_build_object('activo', reloj._interruptor('reloj_activo'), 'http', reloj._interruptor('reloj_http'), 'ejecuciones', c.ejecuciones, 'ultimo_latido_at', c.ultimo_latido_at,
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('clave', j.clave, 'activo', j.activo, 'cron_jobid', j.cron_jobid) order by j.clave), '[]'::jsonb) from reloj.job j));
end $$;

-- Permisos: todo es del sistema (servidor). Los ayudantes _* no se conceden.
do $$
declare f text;
begin
  foreach f in array array['reloj.tick(text,timestamptz)', 'reloj.reintentar(timestamptz)', 'reloj.verificar(timestamptz)', 'reloj.purgar(timestamptz)', 'reloj.preparar_extensiones()',
                           'reloj.sincronizar_cron()', 'reloj.sembrar_jobs()', 'reloj.encender()', 'reloj.apagar()', 'reloj.estado(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to servidor', f);
  end loop;
  foreach f in array array['reloj._interruptor(text)', 'reloj._respuesta(bigint)', 'reloj._pedir_latido()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, servidor', f);
  end loop;
end $$;

-- Habilita las extensiones solo si estan disponibles y deja los jobs creados pero desactivados. (La verificacion de pg_cron/pg_net no aborta la migracion.)
select reloj.preparar_extensiones();
select reloj.sembrar_jobs();
