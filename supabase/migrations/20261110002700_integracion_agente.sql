-- Integracion 3 / 0027: agente de Telegram (esquema `agente`) y latido de tareas programadas (tablas `notificacion.programacion` y `notificacion.ejecucion`).
--  * Todo el esquema agente es de uso del sistema: solo el rol `servidor` (el webhook) ejecuta sus funciones. Los ids de Telegram no estan en el repo: un script local los carga
--    desde una variable de entorno privada con `agente.registrar_miembro` y `agente.registrar_chat`.
--  * Reclamo por update_id y por (chat, mensaje) con INSERT ... ON CONFLICT DO NOTHING: un reintento de Telegram no se ejecuta dos veces.
--  * Presupuesto de IA con la MISMA logica que src/dominio/agente/presupuesto.ts (reserva del peor caso, liquidacion con el costo real, liberacion), bajo un candado de transaccion.
--  * Botones: tokens aleatorios de un solo uso (callback_data <= 64 bytes) con el orden de validacion de la spec 26: rol, chat, caducidad, un solo uso.
--  * Las escrituras de negocio del agente reutilizan las funciones operacion.* ya existentes: la ruta de Telegram solo puede escribir si esta marcada como canal 'telegram' por una funcion
--    del propio agente (marca de transaccion), y solo desde el rol servidor.

create schema agente;
revoke all on schema agente from public, anon, authenticated;
grant usage on schema agente to servidor;

-- Canal telegram: el sistema (rol servidor, o la Mac local en pruebas) puede escribir con las funciones de negocio solo dentro de una transaccion marcada por el agente.
create or replace function seguridad.canal_actual() returns text
language sql stable set search_path = ''
as $$ select case when session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then 'importacion'
                  when session_user = 'postgres' and current_setting('rtm.canal', true) = 'sistema' then 'sistema'
                  when session_user in ('servidor', 'postgres') and current_setting('rtm.canal', true) = 'telegram' then 'telegram'
                  else 'web' end $$;

create or replace function seguridad.exigir_rol(p_roles text[]) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text := seguridad.rol_actual();
begin
  if v_rol is not null and v_rol = any (p_roles) then return; end if;
  if 'importacion' = any (p_roles) and session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then return; end if;
  -- El agente de Telegram: lo que un socio indica por el grupo se ejecuta directo (con eco y deshacer), pero solo dentro de una funcion `agente.*` que marca la transaccion.
  if 'importacion' = any (p_roles) and session_user in ('servidor', 'postgres') and current_setting('rtm.canal', true) = 'telegram' then return; end if;
  raise exception 'permiso denegado' using errcode = '42501';
end $$;

create table agente.miembro (
  telegram_user_id bigint primary key,
  persona text not null check (persona in ('angelo', 'javier', 'omar')),
  rol text not null check (rol in ('socio', 'omar')),
  activo boolean not null default true,
  check ((persona = 'omar') = (rol = 'omar'))
);
create table agente.chat_registrado (
  destino text primary key check (destino in ('grupo_socios', 'privado_omar')),
  chat_id bigint not null unique
);
create table agente.tg_update (update_id bigint primary key, recibido_at timestamptz not null default now());
create table agente.tg_mensaje (chat_id bigint not null, message_id bigint not null, recibido_at timestamptz not null default now(), primary key (chat_id, message_id));
create table agente.estado (
  id int primary key check (id = 1),
  sin_ia boolean not null default false,
  motivo text,
  avisado boolean not null default false,
  actualizado_at timestamptz not null default now()
);
insert into agente.estado (id) values (1);
create table agente.llm_corrida (
  clave text primary key,
  resultado jsonb not null,
  modelo text,
  tokens_entrada int not null default 0,
  tokens_salida int not null default 0,
  costo_micro_usd bigint not null default 0,
  creada_at timestamptz not null default now()
);
create table agente.reparto_rol (rol text primary key, micro_usd bigint not null check (micro_usd > 0));
insert into agente.reparto_rol values ('texto', 550000), ('vision', 250000), ('audio', 50000), ('redaccion', 100000), ('resumen', 50000);
create table agente.ia_presupuesto (
  id int primary key check (id = 1),
  fecha_dia date not null,
  mes text not null,
  dia_micro bigint not null default 0,
  mes_micro bigint not null default 0,
  por_rol jsonb not null default '{}'::jsonb,
  alerta_dia boolean not null default false,
  alerta_mes boolean not null default false
);
create table agente.ia_reserva (
  clave text primary key,
  rol text not null references agente.reparto_rol (rol),
  micro_usd bigint not null check (micro_usd > 0),
  estado text not null default 'reservada' check (estado in ('reservada', 'liquidada', 'liberada')),
  creada_at timestamptz not null default now()
);
create table agente.tg_token (
  token text primary key check (octet_length(token) <= 64 and token ~ '^[0-9A-Za-z_-]{8,64}$'),
  accion text not null,
  roles_permitidos text[] not null,
  chat_id bigint not null,
  caduca_at timestamptz not null,
  grupo_exclusivo text,
  usado_at timestamptz,
  payload jsonb not null default '{}'::jsonb
);
create index tg_token_grupo_idx on agente.tg_token (grupo_exclusivo) where grupo_exclusivo is not null;
-- Solo intencion, motivo y tamanos: jamas el texto de los usuarios.
create table agente.evento (
  id bigint generated always as identity primary key,
  tipo text not null,
  miembro bigint,
  detalle text not null check (length(detalle) <= 300),
  creado_at timestamptz not null default now()
);
create table agente.contador_no_procesado (dia date primary key, n int not null default 0);

-- Programacion y ejecucion de tareas (spec 26, sec. 10): el latido lee `programacion` y deja una fila por (tarea, ventana).
create table notificacion.programacion (
  tarea text primary key,
  expresion_local text not null,
  expresion_utc text not null,
  descripcion text not null,
  activa boolean not null default true,
  ultima_ejecucion_at timestamptz
);
create table notificacion.ejecucion (
  id bigint generated always as identity primary key,
  tarea text not null references notificacion.programacion (tarea),
  ventana text not null,
  estado text not null check (estado in ('en_curso', 'ok', 'error', 'omitida')),
  inicio timestamptz not null default clock_timestamp(),
  fin timestamptz,
  error text check (error is null or length(error) <= 300),
  unique (tarea, ventana)
);

do $$
declare r record;
begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and (n.nspname = 'agente' or (n.nspname = 'notificacion' and c.relname in ('programacion', 'ejecucion'))) loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
    execute format('alter table %I.%I force row level security', r.nspname, r.relname);
    execute format('revoke all on %I.%I from public, anon, authenticated', r.nspname, r.relname);
  end loop;
end $$;
revoke all on all sequences in schema agente from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Identidad y chats (los carga un script local desde configuracion privada)
-- ---------------------------------------------------------------------------
create function agente.registrar_miembro(p_telegram_user_id bigint, p_persona text, p_activo boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_rol text := case when p_persona = 'omar' then 'omar' else 'socio' end;
begin
  perform notificacion.exigir_sistema();
  insert into agente.miembro (telegram_user_id, persona, rol, activo) values (p_telegram_user_id, p_persona, v_rol, p_activo)
    on conflict (telegram_user_id) do update set persona = excluded.persona, rol = excluded.rol, activo = excluded.activo;
  insert into notificacion.miembro (telegram_user_id, rol, activo) values (p_telegram_user_id, v_rol, p_activo)
    on conflict (telegram_user_id) do update set rol = excluded.rol, activo = excluded.activo;
end $$;

create function agente.registrar_chat(p_destino text, p_chat_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into agente.chat_registrado (destino, chat_id) values (p_destino, p_chat_id) on conflict (destino) do update set chat_id = excluded.chat_id;
  update notificacion.destino set telegram_chat_id = p_chat_id where clave = p_destino;
end $$;

create function agente.miembro_por_telegram(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select jsonb_build_object('telegramUserId', m.telegram_user_id, 'persona', m.persona, 'rol', m.rol) from agente.miembro m where m.telegram_user_id = p_id and m.activo);
end $$;

create function agente.chats() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object('grupoSocios', (select chat_id from agente.chat_registrado where destino = 'grupo_socios'), 'privadoOmar', (select chat_id from agente.chat_registrado where destino = 'privado_omar'));
end $$;

-- ---------------------------------------------------------------------------
-- Reclamos (idempotencia) y estado
-- ---------------------------------------------------------------------------
create function agente.reclamar_update(p_update_id bigint) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform notificacion.exigir_sistema();
  insert into agente.tg_update (update_id) values (p_update_id) on conflict do nothing;
  get diagnostics v_n = row_count;
  delete from agente.tg_update where recibido_at < now() - interval '14 days';
  return v_n = 1;
end $$;

create function agente.reclamar_mensaje(p_chat bigint, p_mensaje bigint) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform notificacion.exigir_sistema();
  insert into agente.tg_mensaje (chat_id, message_id) values (p_chat, p_mensaje) on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

create function agente.modo_sin_ia() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select jsonb_build_object('activo', sin_ia, 'motivo', motivo, 'avisado', avisado) from agente.estado where id = 1);
end $$;

create function agente.fijar_modo_sin_ia(p_activo boolean, p_motivo text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_antes boolean;
begin
  perform notificacion.exigir_sistema();
  select sin_ia into v_antes from agente.estado where id = 1 for update;
  if v_antes = p_activo then return false; end if;
  update agente.estado set sin_ia = p_activo, motivo = case when p_activo then p_motivo end, avisado = false, actualizado_at = now() where id = 1;
  return true;
end $$;

create function agente.marcar_aviso_sin_ia() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  update agente.estado set avisado = true where id = 1;
end $$;

create function agente.corrida(p_clave text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select resultado from agente.llm_corrida where clave = p_clave);
end $$;

create function agente.guardar_corrida(p_clave text, p_resultado jsonb, p_modelo text default null, p_tin int default 0, p_tout int default 0, p_costo_micro bigint default 0) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into agente.llm_corrida (clave, resultado, modelo, tokens_entrada, tokens_salida, costo_micro_usd) values (p_clave, p_resultado, p_modelo, p_tin, p_tout, p_costo_micro) on conflict do nothing;
end $$;

create function agente.contar_no_procesado() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into agente.contador_no_procesado as c (dia, n) values (negocio.hoy(), 1) on conflict (dia) do update set n = c.n + 1;
end $$;

create function agente.registrar_evento(p_tipo text, p_miembro bigint, p_detalle text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into agente.evento (tipo, miembro, detalle) values (p_tipo, p_miembro, left(coalesce(p_detalle, ''), 300));
end $$;

-- ---------------------------------------------------------------------------
-- Presupuesto de IA: misma logica que presupuesto.ts. Micro-USD; tope diario y mensual en costos.parametro.
-- ---------------------------------------------------------------------------
create function agente._rotar(p_fecha date) returns agente.ia_presupuesto
language plpgsql security definer set search_path = ''
as $$
declare e agente.ia_presupuesto; v_mes text := to_char(p_fecha, 'YYYY-MM');
begin
  insert into agente.ia_presupuesto (id, fecha_dia, mes) values (1, p_fecha, v_mes) on conflict (id) do nothing;
  select * into e from agente.ia_presupuesto where id = 1 for update;
  if e.mes <> v_mes then update agente.ia_presupuesto set mes = v_mes, mes_micro = 0, alerta_mes = false where id = 1; end if;
  if e.fecha_dia <> p_fecha then update agente.ia_presupuesto set fecha_dia = p_fecha, dia_micro = 0, por_rol = '{}'::jsonb, alerta_dia = false where id = 1; end if;
  select * into e from agente.ia_presupuesto where id = 1;
  return e;
end $$;


create function agente.tope(p_clave text) returns bigint
language sql stable security definer set search_path = ''
as $$ select (valor #>> '{}')::bigint from costos.parametro where clave = case p_clave when 'dia' then 'ia_tope_dia_micro_usd' else 'ia_tope_mes_micro_usd' end $$;

create function agente._con_avisos() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e agente.ia_presupuesto; v_av jsonb := '[]'::jsonb;
begin
  select * into e from agente.ia_presupuesto where id = 1;
  if not e.alerta_dia and e.dia_micro >= agente.tope('dia') * 80 / 100 then update agente.ia_presupuesto set alerta_dia = true where id = 1; v_av := v_av || '["alerta_dia"]'::jsonb; end if;
  if not e.alerta_mes and e.mes_micro >= agente.tope('mes') * 80 / 100 then update agente.ia_presupuesto set alerta_mes = true where id = 1; v_av := v_av || '["alerta_mes"]'::jsonb; end if;
  return v_av;
end $$;

create function agente.reservar(p_clave text, p_rol text, p_micro bigint, p_fecha date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e agente.ia_presupuesto; v_reparto bigint; v_resumen bigint; v_tope_dia bigint; v_base bigint; v_rol_actual bigint;
begin
  perform notificacion.exigir_sistema();
  perform pg_advisory_xact_lock(hashtextextended('agente.ia_presupuesto', 0));
  if exists (select 1 from agente.ia_reserva where clave = p_clave) then return jsonb_build_object('ok', true, 'avisos', '[]'::jsonb); end if;
  select micro_usd into v_reparto from agente.reparto_rol where rol = p_rol;
  if v_reparto is null then raise exception 'rol de presupuesto desconocido' using errcode = '22023'; end if;
  if p_micro is null or p_micro <= 0 then return jsonb_build_object('ok', false, 'motivo', 'monto_invalido'); end if;
  e := agente._rotar(p_fecha);
  select micro_usd into v_resumen from agente.reparto_rol where rol = 'resumen';
  v_tope_dia := case when p_rol = 'resumen' then agente.tope('dia') else agente.tope('dia') - v_resumen end;
  v_base := case when p_rol = 'resumen' then e.dia_micro else e.dia_micro - coalesce((e.por_rol ->> 'resumen')::bigint, 0) end;
  v_rol_actual := coalesce((e.por_rol ->> p_rol)::bigint, 0);
  if v_base + p_micro > v_tope_dia then return jsonb_build_object('ok', false, 'motivo', 'tope_diario'); end if;
  if e.mes_micro + p_micro > agente.tope('mes') then return jsonb_build_object('ok', false, 'motivo', 'tope_mensual'); end if;
  if v_rol_actual + p_micro > v_reparto then return jsonb_build_object('ok', false, 'motivo', 'tope_rol'); end if;
  update agente.ia_presupuesto set dia_micro = dia_micro + p_micro, mes_micro = mes_micro + p_micro, por_rol = jsonb_set(por_rol, array[p_rol], to_jsonb(v_rol_actual + p_micro)) where id = 1;
  insert into agente.ia_reserva (clave, rol, micro_usd) values (p_clave, p_rol, p_micro);
  return jsonb_build_object('ok', true, 'avisos', agente._con_avisos());
end $$;

create function agente.liquidar(p_clave text, p_real_micro bigint, p_modelo text default null, p_tin int default 0, p_tout int default 0) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r agente.ia_reserva; e agente.ia_presupuesto; v_delta bigint; v_rol bigint;
begin
  perform notificacion.exigir_sistema();
  perform pg_advisory_xact_lock(hashtextextended('agente.ia_presupuesto', 0));
  select * into r from agente.ia_reserva where clave = p_clave for update;
  if not found or r.estado <> 'reservada' then return jsonb_build_object('avisos', '[]'::jsonb); end if;
  select * into e from agente.ia_presupuesto where id = 1;
  v_delta := p_real_micro - r.micro_usd;
  v_rol := coalesce((e.por_rol ->> r.rol)::bigint, 0);
  update agente.ia_presupuesto set dia_micro = greatest(dia_micro + v_delta, 0), mes_micro = greatest(mes_micro + v_delta, 0), por_rol = jsonb_set(por_rol, array[r.rol], to_jsonb(greatest(v_rol + v_delta, 0))) where id = 1;
  update agente.ia_reserva set estado = 'liquidada' where clave = p_clave;
  insert into ia.llamada (rol, modelo, tokens_in, tokens_out, costo_usd_micro, reserva_clave, estado) values (r.rol, coalesce(p_modelo, 'desconocido'), greatest(p_tin, 0), greatest(p_tout, 0), greatest(p_real_micro, 0), p_clave, 'liquidada');
  return jsonb_build_object('avisos', agente._con_avisos());
end $$;

create function agente.liberar(p_clave text) returns void
language plpgsql security definer set search_path = ''
as $$
declare r agente.ia_reserva; e agente.ia_presupuesto; v_rol bigint;
begin
  perform notificacion.exigir_sistema();
  perform pg_advisory_xact_lock(hashtextextended('agente.ia_presupuesto', 0));
  select * into r from agente.ia_reserva where clave = p_clave for update;
  if not found or r.estado <> 'reservada' then return; end if;
  select * into e from agente.ia_presupuesto where id = 1;
  v_rol := coalesce((e.por_rol ->> r.rol)::bigint, 0);
  update agente.ia_presupuesto set dia_micro = greatest(dia_micro - r.micro_usd, 0), mes_micro = greatest(mes_micro - r.micro_usd, 0), por_rol = jsonb_set(por_rol, array[r.rol], to_jsonb(greatest(v_rol - r.micro_usd, 0))) where id = 1;
  update agente.ia_reserva set estado = 'liberada' where clave = p_clave;
end $$;

create function agente.presupuesto_estado() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select jsonb_build_object('fecha_dia', fecha_dia, 'mes', mes, 'dia_micro', dia_micro, 'mes_micro', mes_micro, 'por_rol', por_rol, 'alerta_dia', alerta_dia, 'alerta_mes', alerta_mes) from agente.ia_presupuesto where id = 1);
end $$;

-- ---------------------------------------------------------------------------
-- Tokens de botones
-- ---------------------------------------------------------------------------
create function agente.token_emitir(p_token text, p_accion text, p_roles text[], p_chat bigint, p_caduca timestamptz, p_grupo text, p_payload jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into agente.tg_token (token, accion, roles_permitidos, chat_id, caduca_at, grupo_exclusivo, payload) values (p_token, p_accion, p_roles, p_chat, p_caduca, p_grupo, coalesce(p_payload, '{}'::jsonb));
  delete from agente.tg_token where caduca_at < now() - interval '7 days';
  return p_token;
end $$;

-- Orden: (1) rol de quien pulsa (un no autorizado NO consume el token); (2) chat registrado del token; (3) caducidad; (4) un solo uso, e invalida los del mismo grupo exclusivo.
create function agente.token_consumir(p_token text, p_rol text, p_chat bigint, p_ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t agente.tg_token;
begin
  perform notificacion.exigir_sistema();
  select * into t from agente.tg_token where token = p_token for update;
  if not found then return jsonb_build_object('estado', 'invalido'); end if;
  if not (p_rol = any (t.roles_permitidos)) then return jsonb_build_object('estado', 'no_autorizado'); end if;
  if t.chat_id <> p_chat then return jsonb_build_object('estado', 'chat_distinto'); end if;
  if p_ahora >= t.caduca_at then return jsonb_build_object('estado', 'caducado'); end if;
  if t.usado_at is not null then return jsonb_build_object('estado', 'usado'); end if;
  update agente.tg_token set usado_at = p_ahora where token = p_token;
  if t.grupo_exclusivo is not null then update agente.tg_token set usado_at = coalesce(usado_at, p_ahora) where grupo_exclusivo = t.grupo_exclusivo; end if;
  return jsonb_build_object('estado', 'ok', 'accion', t.accion, 'payload', t.payload);
end $$;

-- ---------------------------------------------------------------------------
-- Catalogo (solo lectura) y lo que calcula el servidor. El agente no calcula ninguna cifra.
-- ---------------------------------------------------------------------------
create function agente.catalogo_clientes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id::text, 'nombre', c.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.cliente_alias a where a.cliente_id = c.id or c.id = any (a.candidatos)), '[]'::jsonb)) order by c.id)
    from catalogo.cliente c where c.activo), '[]'::jsonb);
end $$;

create function agente.catalogo_modelos() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id::text, 'nombre', m.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.modelo_alias a where a.modelo_id = m.id or m.id = any (a.candidatos)), '[]'::jsonb)) order by m.id)
    from catalogo.modelo m), '[]'::jsonb);
end $$;

create function agente.sabores_en_existencia(p_modelo bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'nombre', s.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.sabor_alias a where a.sabor_id = s.id), '[]'::jsonb)) order by s.nombre_canonico)
    from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id join operacion.existencia_sku_ubicacion u on u.sku_id = k.id and u.piezas > 0 where k.modelo_id = p_modelo), '[]'::jsonb);
end $$;

-- Consultas de lectura que responde el agente (cifras del servidor).
create function agente.consulta(p_tipo text, p_modelo bigint default null, p_sujeto text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  if p_tipo = 'inventario' then
    select jsonb_build_object('titulo', 'Existencia', 'lineas', coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico, 'piezas', e.piezas) order by m.nombre_canonico), '[]'::jsonb)) into v_res
      from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where e.piezas > 0 and (p_modelo is null or m.id = p_modelo);
  elsif p_tipo = 'socios' then
    v_res := jsonb_build_object('titulo', 'Cuenta entre socios', 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Javier le debe a Angelo', 'centavos', (operacion.posicion_socios() ->> 'javier_debe_a_angelo_cent')::bigint)));
  elsif p_tipo = 'cuenta_cliente' then
    select jsonb_build_object('titulo', 'Saldo de ' || c.nombre_canonico, 'lineas', jsonb_build_array(jsonb_build_object('etiqueta', 'Por cobrar', 'centavos', operacion.saldo_cliente(c.id)))) into v_res
      from catalogo.cliente c where c.id = p_modelo;
  elsif p_tipo = 'proveedor' then
    select jsonb_build_object('titulo', 'Cuenta con ' || p.nombre, 'lineas', jsonb_build_array(jsonb_build_object('etiqueta', 'Saldo (positivo: a favor)', 'centavos', -operacion.saldo_proveedor(p.id)))) into v_res
      from catalogo.proveedor p where p.nombre = initcap(p_sujeto);
  else
    raise exception 'consulta desconocida' using errcode = '22023';
  end if;
  return coalesce(v_res, jsonb_build_object('titulo', 'Sin datos', 'lineas', '[]'::jsonb));
end $$;

-- Escrituras por indicacion de un socio: se ejecutan directo; la funcion de negocio decide y el agente solo transporta. Marca la transaccion como canal telegram.
create function agente.ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_socio text; v_existia boolean; v_sku jsonb;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
  if p_tipo = 'gasto' then
    v_socio := initcap(p_args ->> 'pagado_por');
    if v_socio not in ('Angelo', 'Javier') then raise exception 'un gasto de la sociedad pagado en efectivo de la caja aun no se captura por Telegram: dile al agente quien lo pago' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_gasto_socio(p_clave_idem, v_socio, (p_args ->> 'monto_cent')::bigint, p_args ->> 'categoria', coalesce(p_args ->> 'naturaleza', 'variable'), null, null, p_args ->> 'nota', p_args ->> 'origen');
  elsif p_tipo = 'aportacion' then
    v_res := operacion.registrar_aportacion(p_clave_idem, initcap(p_args ->> 'socio'), (p_args ->> 'monto_cent')::bigint, coalesce(p_args ->> 'concepto', 'Aportacion por Telegram'), coalesce(p_args ->> 'clasificacion', 'reembolsable'));
  elsif p_tipo = 'toma_omar' then
    v_sku := coalesce(p_args -> 'sku', jsonb_build_object('sku_id', (select k.id from catalogo.sku k where k.modelo_id = (p_args ->> 'modelo_id')::bigint and k.sabor_id = (p_args ->> 'sabor_id')::bigint)));
    v_res := operacion.registrar_toma_omar(p_clave_idem, v_sku, (p_args ->> 'piezas')::int, null, null, 'telegram_omar');
  else
    raise exception 'tipo de indicacion no soportado por Telegram todavia: %', p_tipo using errcode = 'P0460';
  end if;
  return v_res || jsonb_build_object('repetido', v_existia);
end $$;

-- Ultimo hecho aplicado por el agente (canal telegram) o el folio indicado: gasto G-, toma T- o aportacion (por su folio de evento).
create function agente.localizar(p_folio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_build_object('folio', x.folio, 'tipo', x.tipo, 'ejecutado_en', x.hora) from (
      select g.folio, 'gasto' as tipo, e.hora from operacion.gasto g join operacion.evento e on e.id = g.evento_id where e.canal = 'telegram' and (p_folio is null or g.folio = p_folio)
        and not exists (select 1 from operacion.gasto_anulacion a where a.gasto_id = g.id)
      union all
      select t.folio, 'toma', e.hora from operacion.toma_omar t join operacion.evento e on e.id = t.evento_id where e.canal = 'telegram' and t.estado in ('pendiente', 'autorizada') and (p_folio is null or t.folio = p_folio)
      order by hora desc limit 1) x), 'null'::jsonb);
end $$;

create function agente.deshacer(p_clave_idem text, p_folio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_gasto bigint; v_aport bigint; v_toma bigint; v_estado text; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  select id into v_gasto from operacion.gasto where folio = p_folio;
  if v_gasto is not null then
    select id into v_aport from operacion.aportacion_socio where ref_tipo = 'gasto' and ref_id = v_gasto and reversa_de is null;
    v_res := operacion.anular_movimiento_socio(p_clave_idem, 'aportacion', v_aport, 'Deshecho desde Telegram');
    return v_res || jsonb_build_object('folio', p_folio);
  end if;
  select id, estado into v_toma, v_estado from operacion.toma_omar where folio = p_folio;
  if v_toma is not null then
    v_res := operacion.resolver_toma_omar(p_clave_idem, v_toma, case v_estado when 'pendiente' then 'rechazar' else 'deshacer' end);
    return v_res;
  end if;
  raise exception 'folio desconocido o que aun no se deshace por Telegram' using errcode = 'P0460';
end $$;

-- Autorizar o rechazar una toma de Omar (pendiente hasta que un socio decide) y caducar las que pasan de las horas dadas.
create function agente.resolver_toma(p_clave_idem text, p_toma_folio text, p_accion text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  select id into v_id from operacion.toma_omar where folio = p_toma_folio;
  if v_id is null then return jsonb_build_object('estado', 'no_encontrada'); end if;
  return operacion.resolver_toma_omar(p_clave_idem, v_id, p_accion);
end $$;

create function agente.caducar_tomas(p_horas int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ids jsonb; r record;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  select coalesce(jsonb_agg(t.folio), '[]'::jsonb) into v_ids from operacion.toma_omar t where t.estado = 'pendiente' and t.solicitada_at < now() - make_interval(hours => p_horas);
  for r in select t.id, t.folio from operacion.toma_omar t where t.estado = 'pendiente' and t.solicitada_at < now() - make_interval(hours => p_horas) loop
    perform operacion.resolver_toma_omar('caducar:' || r.folio, r.id, 'caducar');
  end loop;
  return v_ids;
end $$;

-- ---------------------------------------------------------------------------
-- Latido: tareas debidas, una ejecucion por (tarea, ventana). Reclamar una ventana es idempotente.
-- ---------------------------------------------------------------------------
create function notificacion.sembrar_programacion(p_tareas jsonb) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform notificacion.exigir_sistema();
  insert into notificacion.programacion (tarea, expresion_local, expresion_utc, descripcion)
    select r."tarea", r."expresionLocal", r."expresionUtc", r."descripcion" from jsonb_to_recordset(p_tareas) as r("tarea" text, "expresionLocal" text, "expresionUtc" text, "descripcion" text)
    on conflict (tarea) do update set expresion_local = excluded.expresion_local, expresion_utc = excluded.expresion_utc, descripcion = excluded.descripcion;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function notificacion.reclamar_ejecucion(p_tarea text, p_ventana text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform notificacion.exigir_sistema();
  if exists (select 1 from seguridad.interruptor where clave = 'cron_pausado' and activo) then return false; end if;
  if not exists (select 1 from notificacion.programacion where tarea = p_tarea and activa) then return false; end if;
  insert into notificacion.ejecucion (tarea, ventana, estado) values (p_tarea, p_ventana, 'en_curso') on conflict (tarea, ventana) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end $$;

create function notificacion.terminar_ejecucion(p_tarea text, p_ventana text, p_estado text, p_error text default null) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  update notificacion.ejecucion set estado = p_estado, fin = clock_timestamp(), error = left(p_error, 300) where tarea = p_tarea and ventana = p_ventana and estado = 'en_curso';
  update notificacion.programacion set ultima_ejecucion_at = now() where tarea = p_tarea and p_estado = 'ok';
  if p_estado = 'error' then
    perform operacion.avisar('tarea_falla', null, 'tarea_falla:' || p_tarea || ':' || p_ventana, null, 'Una tarea programada fallo', 'tarea', null, jsonb_build_object('tarea', p_tarea));
  end if;
end $$;

create function notificacion.estado_tareas() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('tarea', p.tarea, 'expresion_local', p.expresion_local, 'activa', p.activa, 'ultima_ejecucion_at', p.ultima_ejecucion_at,
     'ultimo_estado', (select e.estado from notificacion.ejecucion e where e.tarea = p.tarea order by e.id desc limit 1)) order by p.tarea) from notificacion.programacion p), '[]'::jsonb);
end $$;

revoke execute on all functions in schema agente from public, anon, authenticated;
grant execute on all functions in schema agente to servidor;
revoke execute on function notificacion.sembrar_programacion(jsonb), notificacion.reclamar_ejecucion(text, text), notificacion.terminar_ejecucion(text, text, text, text), notificacion.estado_tareas() from public, anon, authenticated;
grant execute on function notificacion.sembrar_programacion(jsonb), notificacion.reclamar_ejecucion(text, text), notificacion.terminar_ejecucion(text, text, text, text), notificacion.estado_tareas() to servidor;
