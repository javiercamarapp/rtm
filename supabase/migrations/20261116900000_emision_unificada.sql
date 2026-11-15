-- INTEGRACION de los carriles de avisos (reloj + resumenes, cobranza, inventario y proveedores): UNA sola puerta de emision, UN solo techo diario y UN solo digest por ventana.
-- Migracion de composicion: redefine con `create or replace` (o drop + create cuando cambia la firma) SOLO las ultimas definiciones de cada carril, copiadas de:
--   * notificacion.emitir_programado           <- 20261116600100 (agrega la cesion de la clase `cobranza` al carril de cobranza)
--   * agente.avisos_digest_armar / _confirmar  <- 20261116800200 (techo compartido; fusion de las ventanas M y R con los reportes del reloj)
--   * cobranza.reloj_tick / registrar_envio    <- 20261116700100 (techo compartido y silencio nocturno)
--   * notificacion.emitir                      <- 20261116800000 (la interfaz unica; antes solo encolaba avisos de inventario)
-- Reglas que esta migracion NO cambia: todo nace apagado (no toca ningun interruptor), ninguna escritura de dinero, ningun envio desde SQL.
--
-- MODELO UNICO
--   * Libro mayor de mensajes: notificacion.programado. Cada mensaje que SALE a Telegram (reporte, alerta, digest de inventario o digest de cobranza) deja ahi una fila con cuenta_techo = true.
--     `notificacion.mensajes_dia(dia)` es el unico contador: tope = catalogo.config `rep_techo_diario` (6). Los criticos saltan el tope pero cuentan.
--   * notificacion.emitir_estado / notificacion.emitir: la UNICA interfaz para pedir un aviso. Enruta por codigo: regla del reloj -> emitir_programado (outbox, dedup, enfriamiento, techo, silencio);
--     regla de inventario -> agente.aviso_encolar (cola que arma el digest).
--   * Un solo digest: las ventanas M (09:00) y R (20:00) de inventario NO mandan mensaje propio cuando el reporte del reloj de esa hora esta encendido; sus lineas viajan dentro de ese reporte
--     (agente.avisos_digest_armar con p_fusion = true). Las ventanas I (inmediato) y S (semanal) siguen siendo mensajes propios y cuentan en el mismo techo.
--   * Cobranza: su digest tiene tarjetas con respuestas ligadas a sus lineas, asi que sigue siendo un mensaje aparte, pero cuenta en el mismo techo, respeta el silencio y es el DUENO de lo que
--     decia el reloj sobre cuentas por cobrar: con `cobranza_activa` encendido, las reglas `cobranza_vence_manana` y `cuenta_vencida` del reloj ceden (mismo hecho, un solo mensaje).

-- ------------------------------------------------------------------ libro mayor compartido
create function notificacion.mensajes_dia(p_dia date) returns int
language sql stable security definer set search_path = ''
as $$ select count(*)::int from notificacion.programado where dia = p_dia and cuenta_techo $$;

create function notificacion.techo_dia() returns int
language sql stable security definer set search_path = ''
as $$ select (catalogo.config_valor('rep_techo_diario') #>> '{}')::int $$;

-- Anota un mensaje ya enviado en el libro (idempotente por clave). Devuelve true si es nuevo.
create function notificacion.contar_envio(p_clave text, p_clase text, p_codigo text, p_severidad text, p_dia date, p_ahora timestamptz default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  insert into notificacion.programado (clave, clase, codigo, aviso_id, severidad, dia, cuenta_techo, creado_at)
    values (p_clave, p_clase, p_codigo, null, p_severidad, p_dia, true, coalesce(p_ahora, clock_timestamp())) on conflict (clave) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ------------------------------------------------------------------ emision programada del reloj (definicion de 20261116600100 + cesion de la clase `cobranza`)
create or replace function notificacion.emitir_programado(p_regla text, p_clave text, p_severidad text, p_titulo text, p_texto text, p_entidad_tipo text default null, p_entidad_id bigint default null,
                                               p_payload jsonb default '{}'::jsonb, p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r notificacion.regla; v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_desde timestamptz; v_dia date; v_hora int; v_crit boolean; v_techo int; v_n int; v_enf numeric; v_cfg jsonb;
  v_aviso bigint; v_dif timestamptz; v_tg boolean; v_ini int := (catalogo.config_valor('rep_silencio_ini_hora') #>> '{}')::int; v_fin int := (catalogo.config_valor('rep_silencio_fin_hora') #>> '{}')::int;
begin
  perform notificacion.exigir_sistema();
  select * into r from notificacion.regla where codigo = p_regla;
  if not found then raise exception 'regla desconocida' using errcode = '22023'; end if;
  v_desde := notificacion.regla_ventana(p_regla, v_ahora);
  if v_desde is null then return jsonb_build_object('estado', 'apagada'); end if;
  -- 0. Cesion: lo de cuentas por cobrar (vence manana, vencida) ya lo dice el digest de cobranza cuando esta encendido; un solo mensaje por hecho.
  if r.clase = 'cobranza' and reloj._interruptor('cobranza_activa') then return jsonb_build_object('estado', 'cedida_a_cobranza'); end if;
  v_crit := p_severidad = 'C';
  select t.canal in ('ST', 'STC', 'TG') into v_tg from notificacion.tipo t where t.codigo = r.tipo_codigo;
  v_dia := (v_ahora at time zone 'America/Merida')::date;
  v_hora := extract(hour from (v_ahora at time zone 'America/Merida'))::int;
  -- 1. Deduplicacion por clave estable (misma clave = mismo mensaje, nunca dos).
  if exists (select 1 from notificacion.programado where clave = p_clave) or exists (select 1 from operacion.aviso where clave_dedupe = p_clave) then
    return jsonb_build_object('estado', 'duplicado');
  end if;
  -- 2. Enfriamiento por clase (un critico nuevo con otra clave no se enfria: solo los informativos).
  v_cfg := catalogo.config_valor('rep_enfriamiento_horas');
  v_enf := coalesce((v_cfg ->> r.clase)::numeric, (v_cfg ->> 'por_omision')::numeric);
  if not v_crit and exists (select 1 from notificacion.programado where clase = r.clase and creado_at > v_ahora - make_interval(secs => (v_enf * 3600)::int)) then
    return jsonb_build_object('estado', 'enfriamiento');
  end if;
  -- 3. Techo diario COMPARTIDO con cobranza e inventario (libro unico): un critico siempre sale y tambien cuenta.
  v_techo := notificacion.techo_dia();
  v_n := notificacion.mensajes_dia(v_dia);
  if not v_crit and v_n >= v_techo then return jsonb_build_object('estado', 'techo', 'del_dia', v_n); end if;
  -- 4. Emision por el outbox existente (la entrega queda omitida si telegram_envio esta apagado).
  v_aviso := operacion.avisar(r.tipo_codigo, null, p_clave, p_severidad, left(p_titulo, 200), p_entidad_tipo, p_entidad_id, p_payload || jsonb_build_object('texto', p_texto, 'regla', p_regla));
  -- 5. Silencio de 21:00 a 07:00 (Merida) salvo criticos: la entrega espera a las 07:00.
  if not v_crit and (v_hora >= v_ini or v_hora < v_fin) then
    v_dif := ((case when v_hora >= v_ini then v_dia + 1 else v_dia end)::timestamp + make_interval(hours => v_fin)) at time zone 'America/Merida';
    update notificacion.entrega set siguiente_intento_at = greatest(siguiente_intento_at, v_dif) where notificacion_id = v_aviso and canal = 'telegram';
  end if;
  insert into notificacion.programado (clave, clase, codigo, aviso_id, severidad, dia, cuenta_techo, creado_at)
    values (p_clave, r.clase, r.tipo_codigo, v_aviso, p_severidad, v_dia, v_tg, v_ahora);
  return jsonb_build_object('estado', 'emitido', 'aviso_id', v_aviso, 'diferido_a', v_dif);
end $$;

-- ------------------------------------------------------------------ digest de inventario: techo compartido y fusion con los reportes del reloj (definiciones de 20261116800200)
drop function agente.avisos_digest_armar(text, timestamptz);
create function agente.avisos_digest_armar(p_ventana text, p_ahora timestamptz default null, p_fusion boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_t jsonb; v_dia date := (v_ahora at time zone 'America/Merida')::date; v_hora int := extract(hour from (v_ahora at time zone 'America/Merida'))::int;
  v_total int; v_inm int; v_max int; v_silencio boolean; v_items jsonb; v_pend int; v_techo int; v_fusiona boolean;
begin
  perform notificacion.exigir_sistema();
  if p_ventana not in ('I', 'M', 'R', 'S') then raise exception 'ventana invalida' using errcode = '22023'; end if;
  if not coalesce((select i.activo from seguridad.interruptor i where i.clave = 'avisos_inventario'), false) then return jsonb_build_object('estado', 'apagado', 'items', '[]'::jsonb); end if;
  -- Las ventanas M y R viajan DENTRO del reporte del reloj de esa hora (pendientes 09:00, resumen 20:00) cuando ese reporte esta encendido: un solo mensaje.
  v_fusiona := p_ventana in ('M', 'R') and reloj._interruptor('reglas_automaticas') and reloj._interruptor(case p_ventana when 'M' then 'regla_pendientes_diarios' else 'regla_resumen_diario' end);
  if v_fusiona and not p_fusion then return jsonb_build_object('estado', 'fusionado', 'ventana', p_ventana, 'items', '[]'::jsonb, 'restantes', 0); end if;
  if p_fusion and not v_fusiona then return jsonb_build_object('estado', 'sin_fusion', 'ventana', p_ventana, 'items', '[]'::jsonb, 'restantes', 0); end if;
  select umbral into v_t from agente.aviso_regla where codigo = '_tope';
  v_max := (v_t ->> 'max_lineas')::int;
  v_techo := least(notificacion.techo_dia(), (v_t ->> 'tope_dia')::int);
  -- Mensajes del dia en el libro UNICO (reloj + cobranza + inventario). Fusionado, el mensaje anfitrion ya paso el techo: no se vuelve a contar.
  v_total := case when p_fusion then 0 else notificacion.mensajes_dia(v_dia) end;
  select count(*)::int into v_inm from agente.aviso_digest where dia = v_dia and ventana = 'I';
  v_silencio := v_hora >= (v_t ->> 'silencio_ini')::int or v_hora < (v_t ->> 'silencio_fin')::int;
  with cand as (
    select q.id, q.codigo, q.canal, q.severidad, q.payload, q.creado_at,
           row_number() over (order by (q.severidad = 'C') desc, (q.severidad = 'I') desc, q.id) as rn
      from agente.aviso_cola q
     where q.estado = 'pendiente'
       and case p_ventana
             when 'I' then q.canal = 'I' and (not v_silencio or q.severidad = 'C') and (v_inm < (v_t ->> 'inmediatos_dia')::int or q.severidad = 'C') and (v_total < v_techo or q.severidad = 'C')
             when 'M' then q.canal in ('M', 'I') and (v_total < v_techo or q.severidad = 'C')
             when 'R' then q.canal = 'R' and v_total < v_techo
             else q.canal = 'S' and v_total < v_techo end)
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'codigo', c.codigo, 'canal', c.canal, 'severidad', c.severidad, 'payload', c.payload) order by c.rn) filter (where c.rn <= v_max), '[]'::jsonb),
         count(*) filter (where c.rn > v_max)::int
    into v_items, v_pend from cand c;
  return jsonb_build_object('estado', 'ok', 'ventana', p_ventana, 'items', v_items, 'restantes', v_pend, 'mensajes_hoy', notificacion.mensajes_dia(v_dia), 'inmediatos_hoy', v_inm);
end $$;

drop function agente.avisos_digest_confirmar(text, bigint[], timestamptz);
create function agente.avisos_digest_confirmar(p_ventana text, p_ids bigint[], p_ahora timestamptz default null, p_fusion boolean default false) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_id bigint; v_n int; v_dia date := (coalesce(p_ahora, clock_timestamp()) at time zone 'America/Merida')::date; v_crit boolean;
begin
  perform notificacion.exigir_sistema();
  if p_ventana not in ('I', 'M', 'R', 'S') then raise exception 'ventana invalida' using errcode = '22023'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return null; end if;
  insert into agente.aviso_digest (dia, ventana, items, enviado_at) values (v_dia, p_ventana, array_length(p_ids, 1), v_ahora) returning id into v_id;
  update agente.aviso_cola set estado = 'enviado', enviado_at = v_ahora, digest_id = v_id where id = any (p_ids) and estado = 'pendiente';
  get diagnostics v_n = row_count;
  if v_n = 0 then delete from agente.aviso_digest where id = v_id; return null; end if;
  update agente.aviso_digest set items = v_n where id = v_id;
  -- Libro unico: el digest enviado cuenta como un mensaje (salvo fusionado: ya lo conto el reporte del reloj que lo lleva).
  if not p_fusion then
    select bool_or(q.severidad = 'C') into v_crit from agente.aviso_cola q where q.digest_id = v_id;
    perform notificacion.contar_envio('inventario:' || v_id, 'inventario_digest', 'digest_inventario_' || p_ventana, case when coalesce(v_crit, false) then 'C' else 'I' end, v_dia, v_ahora);
  end if;
  return v_id;
end $$;

-- ------------------------------------------------------------------ cobranza: techo compartido y silencio (definiciones de 20261116700100)
create or replace function cobranza.reloj_tick(p_tipo text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c cobranza.config; v_hoy date := cobranza._hoy(p_args); v_hora time; v_dig jsonb; v_id bigint; r cobranza.digest; l jsonb; v_cont jsonb; v_ini int; v_fin int;
begin
  perform notificacion.exigir_sistema();
  if p_tipo not in ('am', 'cierre') then raise exception 'tipo de digest desconocido' using errcode = '22023'; end if;
  if not coalesce((select i.activo from seguridad.interruptor i where i.clave = 'cobranza_activa'), false) then return jsonb_build_object('estado', 'apagado'); end if;
  if coalesce((select i.activo from seguridad.interruptor i where i.clave = 'cron_pausado'), false) then return jsonb_build_object('estado', 'cron_pausado'); end if;
  if not coalesce((select i.activo from seguridad.interruptor i where i.clave = 'telegram_envio'), false) then return jsonb_build_object('estado', 'sin_envio'); end if;
  select * into c from cobranza.config where id = 1;
  if p_tipo = 'cierre' and not c.cierre_17h then return jsonb_build_object('estado', 'cierre_apagado'); end if;
  v_hora := case when session_user = 'postgres' and coalesce(p_args ->> 'hora', '') ~ '^\d{2}:\d{2}' then (p_args ->> 'hora')::time else (now() at time zone 'America/Merida')::time end;
  if v_hora < (case p_tipo when 'am' then c.hora_digest else c.hora_cierre end) then return jsonb_build_object('estado', 'temprano'); end if;
  -- Silencio nocturno (el mismo del reloj): ni el digest ni su reintento salen entre 21:00 y 07:00.
  v_ini := (catalogo.config_valor('rep_silencio_ini_hora') #>> '{}')::int; v_fin := (catalogo.config_valor('rep_silencio_fin_hora') #>> '{}')::int;
  if extract(hour from v_hora)::int >= v_ini or extract(hour from v_hora)::int < v_fin then return jsonb_build_object('estado', 'silencio'); end if;
  -- Techo diario COMPARTIDO: solo frena un digest NUEVO (el ya reclamado o enviado sigue su camino y se reporta como antes).
  if not exists (select 1 from cobranza.digest where fecha_negocio = v_hoy and tipo = p_tipo) and notificacion.mensajes_dia(v_hoy) >= notificacion.techo_dia() then
    return jsonb_build_object('estado', 'techo', 'del_dia', notificacion.mensajes_dia(v_hoy));
  end if;
  if p_tipo = 'am' then v_cont := cobranza.contar_ignorados(v_hoy); end if;
  v_dig := cobranza.armar_digest(v_hoy, p_tipo);
  if (v_dig ->> 'vacio')::boolean then return jsonb_build_object('estado', 'sin_contenido'); end if;
  insert into cobranza.digest (fecha_negocio, tipo, texto) values (v_hoy, p_tipo, v_dig ->> 'texto') on conflict (fecha_negocio, tipo) do nothing returning id into v_id;
  if v_id is null then
    select * into r from cobranza.digest where fecha_negocio = v_hoy and tipo = p_tipo for update;
    -- Reintento seguro: solo se reenvia si TypeScript registro que el envio FALLO. Si quedo "reclamado" sin confirmacion no se reenvia (podria haber salido): se avisa.
    if r.estado = 'fallido' then
      update cobranza.digest set estado = 'reclamado', texto = v_dig ->> 'texto', intentos = intentos + 1, error = null, reclamado_at = clock_timestamp() where id = r.id;
      v_id := r.id;
    else
      return jsonb_build_object('estado', case r.estado when 'enviado' then 'ya_enviado' else 'reclamado_sin_confirmar' end, 'digest_id', r.id);
    end if;
  end if;
  delete from cobranza.digest_linea where digest_id = v_id;
  for l in select * from jsonb_array_elements(v_dig -> 'lineas') loop
    insert into cobranza.digest_linea (digest_id, pedido_id, cliente_id, seccion, nivel, formato, saldo_cent)
      values (v_id, (l ->> 'pedido_id')::bigint, (l ->> 'cliente_id')::bigint, l ->> 'seccion', (l ->> 'nivel')::int, l ->> 'formato', (l ->> 'saldo_cent')::bigint) on conflict do nothing;
  end loop;
  return jsonb_build_object('estado', 'reclamado', 'digest_id', v_id, 'fecha', v_hoy, 'tipo', p_tipo, 'texto', v_dig ->> 'texto', 'contadores', v_cont);
end $$;

create or replace function cobranza.registrar_envio(p_digest bigint, p_ok boolean, p_message_id bigint default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r cobranza.digest; l record;
begin
  perform notificacion.exigir_sistema();
  select * into r from cobranza.digest where id = p_digest for update;
  if not found then raise exception 'digest desconocido' using errcode = '22023'; end if;
  if r.estado = 'enviado' then return jsonb_build_object('estado', 'enviado', 'repetido', true); end if;
  if not p_ok then
    update cobranza.digest set estado = 'fallido', error = left(coalesce(p_error, 'sin detalle'), 300) where id = p_digest;
    return jsonb_build_object('estado', 'fallido');
  end if;
  update cobranza.digest set estado = 'enviado', telegram_message_id = p_message_id, enviado_at = clock_timestamp(), error = null where id = p_digest;
  for l in select pedido_id from cobranza.digest_linea where digest_id = p_digest loop
    insert into cobranza.seguimiento (pedido_id, ultimo_aviso_fecha, recordatorios_enviados) values (l.pedido_id, r.fecha_negocio, 1)
      on conflict (pedido_id) do update set ultimo_aviso_fecha = excluded.ultimo_aviso_fecha, recordatorios_enviados = cobranza.seguimiento.recordatorios_enviados + 1, actualizado_at = clock_timestamp();
  end loop;
  -- Libro unico: el digest de cobranza enviado cuenta como un mensaje del dia.
  perform notificacion.contar_envio('cobranza:' || r.fecha_negocio || ':' || r.tipo, 'cobranza_digest', 'cobranza_digest_' || r.tipo, 'I', r.fecha_negocio, clock_timestamp());
  return jsonb_build_object('estado', 'enviado');
end $$;

-- ------------------------------------------------------------------ LA interfaz unica: notificacion.emitir_estado (jsonb) y notificacion.emitir (bigint)
-- p_codigo es una regla del reloj (notificacion.regla) o una regla de inventario (agente.aviso_regla). Para el reloj el payload lleva {texto, titulo?, severidad?, entidad_tipo?, entidad_id?}.
create function notificacion.emitir_estado(p_codigo text, p_clave text, p_payload jsonb default '{}'::jsonb, p_canal text default null, p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_r jsonb; v_texto text;
begin
  perform notificacion.exigir_sistema();
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'el payload debe ser un objeto' using errcode = '22023'; end if;
  if exists (select 1 from notificacion.regla where codigo = p_codigo) then
    v_texto := p_payload ->> 'texto';
    if v_texto is null or v_texto = '' then raise exception 'el aviso del reloj exige texto' using errcode = '22023'; end if;
    v_r := notificacion.emitir_programado(p_codigo, p_clave, coalesce(p_payload ->> 'severidad', 'F'), coalesce(p_payload ->> 'titulo', left(v_texto, 80)), v_texto,
             p_payload ->> 'entidad_tipo', (p_payload ->> 'entidad_id')::bigint, p_payload - 'texto' - 'titulo' - 'severidad' - 'entidad_tipo' - 'entidad_id', p_ahora);
    return v_r || jsonb_build_object('via', 'reloj');
  end if;
  if exists (select 1 from agente.aviso_regla where codigo = p_codigo and codigo <> '_tope') then
    v_id := agente.aviso_encolar(p_codigo, p_clave, p_payload, p_canal, 'pendiente');
    return jsonb_build_object('estado', case when v_id is null then 'omitida' else 'encolado' end, 'aviso_id', v_id, 'via', 'cola');
  end if;
  raise exception 'regla de aviso desconocida: %', p_codigo using errcode = '22023';
end $$;

create or replace function notificacion.emitir(p_codigo text, p_clave text, p_payload jsonb, p_canal text default null) returns bigint
language sql security definer set search_path = ''
as 'select (notificacion.emitir_estado(p_codigo, p_clave, p_payload, p_canal) ->> ''aviso_id'')::bigint';

-- ------------------------------------------------------------------ permisos
revoke all on function notificacion.contar_envio(text, text, text, text, date, timestamptz) from public, anon, authenticated, servidor;
revoke all on function notificacion.mensajes_dia(date), notificacion.techo_dia(), notificacion.emitir_estado(text, text, jsonb, text, timestamptz), notificacion.emitir(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function notificacion.mensajes_dia(date), notificacion.techo_dia(), notificacion.emitir_estado(text, text, jsonb, text, timestamptz), notificacion.emitir(text, text, jsonb, text) to servidor;
revoke all on function agente.avisos_digest_armar(text, timestamptz, boolean), agente.avisos_digest_confirmar(text, bigint[], timestamptz, boolean) from public, anon, authenticated;
grant execute on function agente.avisos_digest_armar(text, timestamptz, boolean), agente.avisos_digest_confirmar(text, bigint[], timestamptz, boolean) to servidor;
revoke all on function notificacion.emitir_programado(text, text, text, text, text, text, bigint, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function notificacion.emitir_programado(text, text, text, text, text, text, bigint, jsonb, timestamptz) to servidor;
revoke all on function cobranza.reloj_tick(text, jsonb), cobranza.registrar_envio(bigint, boolean, bigint, text) from public, anon, authenticated;
grant execute on function cobranza.reloj_tick(text, jsonb), cobranza.registrar_envio(bigint, boolean, bigint, text) to servidor;
