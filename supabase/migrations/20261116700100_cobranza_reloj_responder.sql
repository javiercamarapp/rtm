-- Carril COBRANZA, parte 2: reloj (reclamar y registrar el digest, SIN enviar nada), contador de ignorados, respuestas del socio (puerta unica con idempotencia, dueno del cliente decide,
-- dinero por la puerta de cobro existente), deshacer 10 minutos, metricas y perfil determinista del cliente. ADITIVA: solo objetos nuevos en cobranza.* y agente.cobranza_*.
-- Reglas del dueno aplicadas: sin topes ni tarjeta de confirmacion (el bot pregunta lo que falte y escribe cuando tiene todo), el modelo nunca calcula (monto literal y fecha ya resueltos por el codigo;
-- SQL pone saldos, reparto, recargo y la fecha de "se atrasa"), antiduplicado por contenido en 10 minutos, deshacer 10 minutos aplicado aqui, escritura detras de agente_escritura (nace apagado).

-- ---------------------------------------------------------------- ignorados y promesas incumplidas
-- Corre antes de armar el digest de cada dia: una tarjeta que salio ayer o antes y no tuvo respuesta suma un ignorado; una promesa vencida con saldo suma un incumplimiento (una sola vez).
create function cobranza.contar_ignorados(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_hoy date := coalesce(p_hoy, negocio.hoy()); d record; l record; v_ign int := 0; v_inc int := 0;
begin
  perform notificacion.exigir_sistema();
  for d in select * from cobranza.digest where tipo = 'am' and estado = 'enviado' and not ignorados_procesado and fecha_negocio < v_hoy order by id for update loop
    for l in select dl.* from cobranza.digest_linea dl where dl.digest_id = d.id and dl.formato = 'tarjeta' loop
      if operacion.pedido_saldo(l.pedido_id) > 0 and not exists (
           select 1 from cobranza.respuesta r where r.cliente_id = l.cliente_id and r.accion <> 'deshacer' and r.creado_at >= d.reclamado_at and (r.pedido_id is null or r.pedido_id = l.pedido_id)) then
        insert into cobranza.seguimiento (pedido_id, ignorados_consecutivos) values (l.pedido_id, 1)
          on conflict (pedido_id) do update set ignorados_consecutivos = cobranza.seguimiento.ignorados_consecutivos + 1, actualizado_at = clock_timestamp();
        v_ign := v_ign + 1;
      end if;
    end loop;
    update cobranza.digest set ignorados_procesado = true where id = d.id;
  end loop;
  with u as (
    update cobranza.seguimiento s set promesas_incumplidas = s.promesas_incumplidas + 1, promesa_contada = true, actualizado_at = clock_timestamp()
     where s.promesa_fecha is not null and s.promesa_fecha < v_hoy and not s.promesa_contada and operacion.pedido_saldo(s.pedido_id) > 0 returning 1)
  select count(*) into v_inc from u;
  return jsonb_build_object('ignorados_sumados', v_ign, 'promesas_incumplidas_sumadas', v_inc);
end $$;

-- ---------------------------------------------------------------- reloj: reclamar y registrar (el envio a Telegram lo hace TypeScript con su transporte; aqui jamas sale un mensaje)
-- p_args solo para pruebas del rol propietario: hoy y hora simulados. El servidor usa la fecha y la hora de Merida.
create function cobranza.reloj_tick(p_tipo text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c cobranza.config; v_hoy date := cobranza._hoy(p_args); v_hora time; v_dig jsonb; v_id bigint; r cobranza.digest; l jsonb; v_cont jsonb;
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

create function cobranza.registrar_envio(p_digest bigint, p_ok boolean, p_message_id bigint default null, p_error text default null) returns jsonb
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
  return jsonb_build_object('estado', 'enviado');
end $$;

-- ---------------------------------------------------------------- respuestas del socio
create function cobranza._saldo_texto(p_cliente bigint) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_det text; v_tot bigint;
begin
  select coalesce(string_agg(pe.folio || ' ' || cobranza._pesos(operacion.pedido_saldo(pe.id)), ', ' order by pe.id), ''), coalesce(sum(operacion.pedido_saldo(pe.id)), 0)
    into v_det, v_tot from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0;
  return case when v_tot <= 0 then 'Queda saldado.' else format('Queda pendiente %s (%s).', cobranza._pesos(v_tot), v_det) end;
end $$;

create function cobranza._pregunta(p_falta text, p_texto text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable set search_path = ''
as $$ select jsonb_build_object('estado', 'pregunta', 'falta', p_falta, 'texto', p_texto) || p_extra $$;

create function cobranza._cuentas_validas() returns text[]
language sql immutable set search_path = ''
as $$ select array['Angelo', 'Javier', 'Isaac', 'Karen', 'Efectivo'] $$;

-- La puerta unica. p_args: cliente_id, accion, pedidos (folios, opcional), monto_cent (literal del mensaje), cuenta, fecha (promesa o nueva fecha, ya resuelta por el codigo), dias, motivo,
-- fecha_pago, confirmo_duplicado, cita. Devuelve estado 'ok' (con aviso_grupo y siguiente) o 'pregunta' (falta un dato) o 'conflicto' / 'solo_duenio' / 'duplicado' / 'sin_saldo'.
create function cobranza.responder(p_clave text, p_args jsonb, p_autor text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c cobranza.config; v_hoy date := cobranza._hoy(p_args); v_accion text := p_args ->> 'accion'; v_cli bigint := nullif(p_args ->> 'cliente_id', '')::bigint; v_nombre text; v_duenio text;
  v_folios text[]; v_ped bigint[]; v_prev jsonb; v_res jsonb; v_id bigint; v_folio text; v_cob text; v_monto bigint; v_total bigint; v_cuenta text; v_fecha date; v_dias int; v_motivo text;
  v_antes jsonb; x record; v_rest bigint; v_aplicar jsonb := '[]'::jsonb; v_asig bigint; v_pago jsonb; v_pgfolio text; v_dec text[] := array['prometio', 'se_atrasa', 'pausa', 'disputa', 'extender_plazo'];
  v_prev_dec record; v_t0 timestamptz := clock_timestamp(); v_txt text; v_reparto text := ''; v_fechas date[]; v_vence date; v_fpago date; v_aviso text; v_sig text;
begin
  select * into c from cobranza.config where id = 1;
  if v_accion is null or v_accion not in ('pago_total', 'pago_parcial', 'prometio', 'se_atrasa', 'aun_no', 'disputa', 'pausa', 'reanudar', 'extender_plazo') then
    raise exception 'accion de cobranza desconocida' using errcode = 'P0460';
  end if;
  select cl.nombre_canonico, lower(so.nombre) into v_nombre, v_duenio from catalogo.cliente cl join catalogo.socio so on so.id = cl.duenio_id where cl.id = v_cli;
  if v_nombre is null then raise exception 'no encontre ese cliente' using errcode = 'P0460'; end if;
  v_folios := coalesce((select array_agg(upper(trim(f))) from jsonb_array_elements_text(coalesce(p_args -> 'pedidos', '[]'::jsonb)) f), array[]::text[]);

  -- Pedidos a los que aplica: los folios nombrados (deben ser de este cliente y tener saldo) o todos los del cliente con saldo, del que vence primero al ultimo.
  if cardinality(v_folios) > 0 then
    for x in select f from unnest(v_folios) f loop
      if not exists (select 1 from operacion.pedido pe where upper(pe.folio) = x.f and pe.cliente_id = v_cli and pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0) then
        raise exception 'el pedido % no es de % o ya no tiene saldo', x.f, v_nombre using errcode = 'P0460';
      end if;
    end loop;
    select array_agg(pe.id order by cobranza.vence_efectivo(pe.id) nulls last, pe.fecha_envio, pe.id) into v_ped from operacion.pedido pe where upper(pe.folio) = any (v_folios);
  else
    select array_agg(pe.id order by cobranza.vence_efectivo(pe.id) nulls last, pe.fecha_envio, pe.id) into v_ped
      from operacion.pedido pe where pe.cliente_id = v_cli and pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0;
  end if;
  if v_ped is null then
    return jsonb_build_object('estado', 'sin_saldo', 'texto', format('%s no tiene saldo pendiente: no hay nada que cobrar.', v_nombre));
  end if;
  select coalesce(sum(operacion.pedido_saldo(id)), 0) into v_total from operacion.pedido where id = any (v_ped);

  -- Las decisiones (promesa, atraso, pausa, disputa, extension) las toma el dueno del cliente; los hechos (pagos) se aceptan de cualquier socio.
  if v_accion = any (v_dec) and p_autor <> v_duenio then
    if v_accion = 'extender_plazo' then
      return jsonb_build_object('estado', 'solo_duenio', 'texto', format('Extender el plazo de %s lo decide %s, dueño del cliente. Que lo confirme %s.', v_nombre, initcap(v_duenio), initcap(v_duenio)));
    end if;
    select r.* into v_prev_dec from cobranza.respuesta r where r.cliente_id = v_cli and r.socio = v_duenio and r.accion = any (v_dec) and r.creado_at > clock_timestamp() - make_interval(hours => c.ventana_conflicto_horas)
       and not exists (select 1 from cobranza.respuesta z where z.revierte_id = r.id) order by r.id desc limit 1;
    if found and (v_prev_dec.accion <> v_accion or coalesce(v_prev_dec.params ->> 'fecha', '') <> coalesce(p_args ->> 'fecha', '')) then
      return jsonb_build_object('estado', 'conflicto', 'texto', format('%s ya anotó %s para %s; no lo cambio. %s, ¿lo cambio?', initcap(v_duenio),
        case v_prev_dec.accion when 'prometio' then 'una promesa de pago' when 'se_atrasa' then 'un atraso' when 'pausa' then 'una pausa' when 'disputa' then 'una disputa' else 'una extensión de plazo' end, v_nombre, initcap(v_duenio)));
    end if;
  end if;

  -- ---- datos que faltan: se pregunta ANTES de registrar nada (y antes de reservar la clave de idempotencia)
  if v_accion in ('pago_total', 'pago_parcial') then
    v_cuenta := initcap(coalesce(p_args ->> 'cuenta', ''));
    if v_cuenta <> all (cobranza._cuentas_validas()) then
      return cobranza._pregunta('cuenta', format('¿A qué cuenta entró el pago de %s? Angelo, Javier, Isaac, Karen o Efectivo.', v_nombre));
    end if;
    v_monto := case v_accion when 'pago_total' then v_total else nullif(p_args ->> 'monto_cent', '')::bigint end;
    if v_monto is null or v_monto <= 0 then return cobranza._pregunta('monto', format('¿Cuánto pagó %s? Dime la cifra completa; el saldo es %s.', v_nombre, cobranza._pesos(v_total))); end if;
    v_fpago := coalesce(nullif(p_args ->> 'fecha_pago', '')::date, v_hoy);
    if v_fpago > v_hoy then return cobranza._pregunta('fecha_pago', format('La fecha del pago de %s es futura. ¿Qué día lo pagó?', v_nombre)); end if;
  elsif v_accion = 'prometio' then
    v_fecha := nullif(p_args ->> 'fecha', '')::date;
    if v_fecha is null then return cobranza._pregunta('fecha', format('¿Para qué fecha prometió pagar %s?', v_nombre)); end if;
    if v_fecha < v_hoy then return cobranza._pregunta('fecha', format('Esa fecha ya pasó. ¿Para qué fecha prometió pagar %s?', v_nombre)); end if;
  elsif v_accion = 'se_atrasa' then
    v_dias := nullif(p_args ->> 'dias', '')::int;
    v_fecha := nullif(p_args ->> 'fecha', '')::date;
    if v_fecha is null then
      if v_dias is null or v_dias <= 0 then return cobranza._pregunta('dias', format('¿Cuánto se atrasa %s? Por ejemplo, 3 días o una semana.', v_nombre)); end if;
      -- Base: la fecha prometida vigente de cada pedido o, si no hay, su vencimiento contractual. La suma de fechas la hace SQL.
      select array_agg(coalesce(sg.promesa_fecha, cobranza.vence_efectivo(pe.id)) + v_dias) into v_fechas from operacion.pedido pe left join cobranza.seguimiento sg on sg.pedido_id = pe.id where pe.id = any (v_ped);
      if exists (select 1 from unnest(v_fechas) f where f is null) then return cobranza._pregunta('fecha', format('%s no tiene plazo capturado. ¿Para qué fecha exacta paga?', v_nombre)); end if;
      if exists (select 1 from unnest(v_fechas) f where f < v_hoy) then return cobranza._pregunta('fecha', format('Con ese atraso la fecha de %s sigue en el pasado. ¿Para qué fecha exacta paga?', v_nombre)); end if;
    elsif v_fecha < v_hoy then return cobranza._pregunta('fecha', 'Esa fecha ya pasó. ¿Para qué fecha exacta paga?');
    end if;
  elsif v_accion = 'disputa' then
    v_motivo := trim(coalesce(p_args ->> 'motivo', ''));
    if length(v_motivo) < 3 then return cobranza._pregunta('motivo', format('¿Cuál es el motivo de la disputa de %s? Escríbelo con tus palabras.', v_nombre)); end if;
  elsif v_accion = 'pausa' then
    v_dias := nullif(p_args ->> 'dias', '')::int;
    if v_dias is null or v_dias <= 0 then return cobranza._pregunta('dias', format('¿Por cuántos días callo la cobranza de %s?', v_nombre)); end if;
    if v_dias > c.pausa_max_dias then raise exception 'la pausa máxima es de % días', c.pausa_max_dias using errcode = 'P0460'; end if;
  elsif v_accion = 'extender_plazo' then
    v_fecha := nullif(p_args ->> 'fecha', '')::date; v_dias := nullif(p_args ->> 'dias', '')::int;
    if v_fecha is null and v_dias is null then
      select sg.promesa_fecha into v_fecha from cobranza.seguimiento sg where sg.pedido_id = any (v_ped) and sg.promesa_fecha >= v_hoy order by sg.promesa_fecha limit 1;
      if v_fecha is null then return cobranza._pregunta('fecha', format('¿Hasta qué fecha extiendo el plazo de %s?', v_nombre)); end if;
    end if;
  end if;

  -- Antiduplicado por contenido: el mismo pago (cliente, monto) en 10 minutos no se registra dos veces salvo que el socio diga que es otro.
  if v_accion in ('pago_total', 'pago_parcial') and not coalesce((p_args ->> 'confirmo_duplicado')::boolean, false)
     and not exists (select 1 from seguridad.operacion o where o.clave = p_clave and o.resultado is not null) then
    select r.folio into v_cob from cobranza.respuesta r
     where r.cliente_id = v_cli and r.accion in ('pago_total', 'pago_parcial') and (r.params ->> 'monto_cent')::bigint = v_monto and r.clave_idem <> p_clave
       and r.creado_at > clock_timestamp() - make_interval(mins => agente._ventana_minutos()) and not exists (select 1 from cobranza.respuesta z where z.revierte_id = r.id) order by r.id desc limit 1;
    if v_cob is not null then
      return jsonb_build_object('estado', 'duplicado', 'falta', 'confirmar_duplicado', 'folio_previo', v_cob,
        'texto', format('Ya registré un pago de %s de %s hace unos minutos (%s). ¿Es otro pago? Responde sí si es otro, o dime deshacer %s si fue un error.', cobranza._pesos(v_monto), v_nombre, v_cob, v_cob));
    end if;
  end if;

  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'cobranza_responder', 'c', v_cli, 'a', v_accion, 'p', v_ped, 'm', v_monto, 'cu', v_cuenta, 'f', v_fecha, 'd', v_dias, 'mo', v_motivo));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  -- Lo que habia antes (para deshacer).
  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', pe.id, 'promesa_fecha', sg.promesa_fecha, 'pausa_hasta', sg.pausa_hasta, 'estado_manual', sg.estado_manual, 'disputa_motivo', sg.disputa_motivo,
           'ignorados', coalesce(sg.ignorados_consecutivos, 0), 'promesa_contada', coalesce(sg.promesa_contada, false)) order by pe.id), '[]'::jsonb)
    into v_antes from operacion.pedido pe left join cobranza.seguimiento sg on sg.pedido_id = pe.id where pe.id = any (v_ped);
  insert into cobranza.seguimiento (pedido_id) select unnest(v_ped) on conflict (pedido_id) do nothing;
  v_cob := 'COB-' || lpad(nextval('cobranza.folio_seq')::text, 4, '0');
  v_aviso := null; v_sig := null;

  if v_accion in ('pago_total', 'pago_parcial') then
    -- Reparto calculado por SQL: del pedido que vence primero al ultimo; lo que sobre queda a favor del cliente.
    v_rest := v_monto;
    for x in select pe.id, pe.folio, operacion.pedido_saldo(pe.id) as saldo from operacion.pedido pe where pe.id = any (v_ped) order by cobranza.vence_efectivo(pe.id) nulls last, pe.fecha_envio, pe.id loop
      v_asig := least(v_rest, x.saldo);
      if v_asig > 0 then
        v_aplicar := v_aplicar || jsonb_build_object('pedido_id', x.id, 'monto_cent', v_asig);
        v_reparto := v_reparto || case when v_reparto = '' then '' else ', ' end || x.folio || ' ' || cobranza._pesos(v_asig);
        v_rest := v_rest - v_asig;
      end if;
    end loop;
    v_pago := operacion.registrar_pago(p_clave || ':pago', v_cuenta, v_monto, v_cli, v_aplicar, false, 'abono', v_fpago, null, left('Cobranza ' || v_cob || ' por Telegram: ' || coalesce(p_args ->> 'cita', ''), 300),
                                       left('telegram:' || p_autor || ': ' || coalesce(p_args ->> 'cita', ''), 400));
    v_pgfolio := agente._guardar_hecho(p_clave || ':pago', 'pago_cliente', 'pago', (v_pago ->> 'pago_id')::bigint, p_autor);
    update cobranza.seguimiento set promesa_fecha = null, promesa_contada = false where pedido_id = any (v_ped);
    v_aviso := format('Registrado %s: pago de %s de %s en la cuenta de %s (%s). Se aplicó a %s. %s%s', v_cob, cobranza._pesos(v_monto), v_nombre, v_cuenta, v_pgfolio, v_reparto, cobranza._saldo_texto(v_cli),
      case when v_rest > 0 then format(' Quedan %s a favor del cliente.', cobranza._pesos(v_rest)) else '' end);
    if v_accion = 'pago_parcial' and v_total - v_monto > 0 then v_sig := 'fecha_resto'; v_aviso := v_aviso || ' ¿Y el resto, para cuándo?'; end if;
  elsif v_accion in ('prometio', 'se_atrasa') then
    for x in select pe.id, pe.folio, coalesce(sg.promesa_fecha, cobranza.vence_efectivo(pe.id)) as base from operacion.pedido pe left join cobranza.seguimiento sg on sg.pedido_id = pe.id where pe.id = any (v_ped) order by pe.id loop
      update cobranza.seguimiento set promesa_fecha = coalesce(v_fecha, x.base + v_dias), promesa_contada = false, actualizado_at = clock_timestamp() where pedido_id = x.id;
    end loop;
    select array_agg(distinct sg.promesa_fecha) into v_fechas from cobranza.seguimiento sg where sg.pedido_id = any (v_ped);
    select min(cobranza.vence_efectivo(pe.id)) into v_vence from operacion.pedido pe where pe.id = any (v_ped);
    v_aviso := format('Anotado %s: %s %s.', v_cob, v_nombre, case when cardinality(v_fechas) = 1 then 'paga el ' || cobranza._fecha_txt(v_fechas[1])
                                                                 else 'paga en ' || (select string_agg(pe.folio || ' el ' || cobranza._fecha_txt(sg.promesa_fecha), ', ' order by pe.id) from operacion.pedido pe join cobranza.seguimiento sg on sg.pedido_id = pe.id where pe.id = any (v_ped)) end);
    if v_vence is not null and exists (select 1 from cobranza.seguimiento sg where sg.pedido_id = any (v_ped) and sg.promesa_fecha > cobranza.vence_efectivo(sg.pedido_id)) then
      v_sig := 'extender';
      v_aviso := v_aviso || format(' ¿Solo cambio mi recordatorio (el recargo sigue corriendo desde el %s) o le extiendo el plazo (el recargo cuenta desde el %s)? Responde "solo recordatorio" o "extender plazo".',
        cobranza._fecha_txt(v_vence), cobranza._fecha_txt((select max(promesa_fecha) from cobranza.seguimiento where pedido_id = any (v_ped))));
    end if;
  elsif v_accion = 'aun_no' then
    v_aviso := format('Anotado %s: %s aún no paga; sin novedad. Seguiré recordándolo.', v_cob, v_nombre);
  elsif v_accion = 'disputa' then
    update cobranza.seguimiento set estado_manual = 'disputado', disputa_motivo = left(v_motivo, 300), actualizado_at = clock_timestamp() where pedido_id = any (v_ped);
    v_aviso := format('En disputa %s: %s. Motivo: "%s". No se preguntará a diario; reaparece el lunes. El recargo sigue calculándose, marcado bajo disputa.', v_cob, v_nombre, left(v_motivo, 120));
  elsif v_accion = 'pausa' then
    update cobranza.seguimiento set pausa_hasta = v_hoy + v_dias, actualizado_at = clock_timestamp() where pedido_id = any (v_ped);
    v_aviso := format('Pausa %s: no se mencionará a %s hasta el %s. El recargo sigue corriendo; la pausa solo calla al bot.', v_cob, v_nombre, cobranza._fecha_txt(v_hoy + v_dias));
  elsif v_accion = 'reanudar' then
    update cobranza.seguimiento set pausa_hasta = null, estado_manual = null, disputa_motivo = null, actualizado_at = clock_timestamp() where pedido_id = any (v_ped);
    v_aviso := format('Reanudado %s: %s vuelve a la cobranza normal.', v_cob, v_nombre);
  elsif v_accion = 'extender_plazo' then
    for x in select pe.id, cobranza.vence_efectivo(pe.id) as vence from operacion.pedido pe where pe.id = any (v_ped) loop
      if x.vence is null then raise exception '% no tiene plazo capturado: no se puede extender', v_nombre using errcode = 'P0460'; end if;
      v_dias := coalesce(case when nullif(p_args ->> 'dias', '') is not null then (p_args ->> 'dias')::int end, v_fecha - x.vence);
      if v_dias is null or v_dias <= 0 then raise exception 'la nueva fecha debe ser posterior al vencimiento actual (%)', cobranza._fecha_txt(x.vence) using errcode = 'P0460'; end if;
      insert into cobranza.extension_plazo (pedido_id, dias, motivo, decidido_por, recargo_aplicado_antes_cent)
        values (x.id, v_dias, left(p_args ->> 'motivo', 300), p_autor, coalesce((operacion.recargo_sugerido(x.id, v_hoy) ->> 'aplicado_cent')::bigint, 0));
    end loop;
    v_aviso := format('Plazo extendido %s: %s vence ahora el %s; el recargo cuenta desde esa fecha. Decidió %s.', v_cob, v_nombre,
      cobranza._fecha_txt((select max(cobranza.vence_efectivo(i)) from unnest(v_ped) i)), initcap(p_autor));
  end if;

  update cobranza.seguimiento set ignorados_consecutivos = 0, ultima_respuesta = v_accion, ultima_respuesta_at = clock_timestamp(), ultima_respuesta_por = p_autor, actualizado_at = clock_timestamp() where pedido_id = any (v_ped);
  insert into cobranza.respuesta (folio, pedido_id, cliente_id, accion, params, antes, socio, texto_cita, clave_idem, pago_folio)
    values (v_cob, case when cardinality(v_ped) = 1 then v_ped[1] end, v_cli, v_accion,
            jsonb_strip_nulls(jsonb_build_object('pedidos', to_jsonb(v_ped), 'monto_cent', v_monto, 'cuenta', v_cuenta, 'fecha', coalesce(v_fecha, (select max(promesa_fecha) from cobranza.seguimiento where pedido_id = any (v_ped) and v_accion in ('prometio', 'se_atrasa'))),
              'dias', v_dias, 'motivo', v_motivo)), v_antes, p_autor, left(p_args ->> 'cita', 200), p_clave, v_pgfolio) returning id into v_id;
  if v_accion = 'extender_plazo' then update cobranza.extension_plazo set respuesta_id = v_id where respuesta_id is null and pedido_id = any (v_ped) and creado_at >= v_t0; end if;
  v_res := jsonb_build_object('estado', 'ok', 'folio', v_cob, 'respuesta_id', v_id, 'accion', v_accion, 'aviso_grupo', v_aviso, 'siguiente', v_sig, 'cliente', v_nombre, 'pago_folio', v_pgfolio);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- Puerta del agente: verifica al socio por su id de Telegram y exige la escritura encendida (el bot arranca en solo lectura).
create function agente.cobranza_responder(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_escritura();
  return cobranza.responder(p_clave_idem, p_args, v_autor);
end $$;

-- ---------------------------------------------------------------- deshacer (10 minutos, contra-registro; lo que no se deshace se corrige con un movimiento inverso)
create function cobranza.tipos_no_reversibles() returns text[]
language sql immutable set search_path = ''
as $$ select array['deshacer'] $$;

create function agente.cobranza_deshacer(p_clave_idem text, p_folio text, p_autor text, p_telegram_user_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_sol text; r cobranza.respuesta; v_prev jsonb; a jsonb; v_res jsonb; v_cob text; v_id bigint; v_pg jsonb; x record;
begin
  perform notificacion.exigir_sistema();
  v_sol := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  select * into r from cobranza.respuesta where upper(folio) = upper(trim(p_folio));
  if not found then raise exception 'no encontré el folio %', p_folio using errcode = 'P0460'; end if;
  if r.accion = any (cobranza.tipos_no_reversibles()) then raise exception 'el folio % es un deshacer: no se deshace otra vez; repite la respuesta si hace falta', r.folio using errcode = 'P0460'; end if;
  if exists (select 1 from cobranza.respuesta z where z.revierte_id = r.id) then raise exception 'el folio % ya se deshizo', r.folio using errcode = 'P0460'; end if;
  if r.creado_at <= clock_timestamp() - make_interval(mins => agente._ventana_minutos()) then
    raise exception 'pasaron más de % minutos desde el folio %: ya no se deshace desde Telegram. Corrígelo con una respuesta nueva (por ejemplo, anotar otra fecha) o desde el software', agente._ventana_minutos(), r.folio using errcode = 'P0464';
  end if;
  -- Una extension ya seguida de un recargo aplicado no se deshace sola: el recargo ya cobrado se corrige desde el software.
  if r.accion = 'extender_plazo' then
    for x in select e.* from cobranza.extension_plazo e where e.respuesta_id = r.id and e.anulada_at is null loop
      if coalesce((operacion.recargo_sugerido(x.pedido_id, cobranza._hoy(null)) ->> 'aplicado_cent')::bigint, 0) > x.recargo_aplicado_antes_cent then
        raise exception 'la extensión % ya tiene un recargo aplicado después: no se deshace desde Telegram; corrígelo desde el software', r.folio using errcode = 'P0460';
      end if;
    end loop;
  end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cobranza_deshacer', 'f', r.folio));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if r.accion in ('pago_total', 'pago_parcial') then
    -- La reversa del dinero es la existente (anula el pago y sus aplicaciones); su ventana y su bitacora son las mismas.
    v_pg := agente.deshacer(p_clave_idem || ':pago', r.pago_folio, p_autor, p_telegram_user_id);
  else
    for a in select * from jsonb_array_elements(r.antes) loop
      update cobranza.seguimiento set promesa_fecha = nullif(a ->> 'promesa_fecha', '')::date, pausa_hasta = nullif(a ->> 'pausa_hasta', '')::date, estado_manual = nullif(a ->> 'estado_manual', ''),
             disputa_motivo = nullif(a ->> 'disputa_motivo', ''), ignorados_consecutivos = (a ->> 'ignorados')::int, promesa_contada = (a ->> 'promesa_contada')::boolean, actualizado_at = clock_timestamp()
       where pedido_id = (a ->> 'pedido_id')::bigint;
    end loop;
    if r.accion = 'extender_plazo' then
      update cobranza.extension_plazo set anulada_at = clock_timestamp() where respuesta_id = r.id and anulada_at is null;
    end if;
  end if;
  v_cob := 'COB-' || lpad(nextval('cobranza.folio_seq')::text, 4, '0');
  insert into cobranza.respuesta (folio, pedido_id, cliente_id, accion, params, antes, socio, clave_idem, revierte_id)
    values (v_cob, r.pedido_id, r.cliente_id, 'deshacer', jsonb_build_object('deshace', r.folio), '{}'::jsonb, v_sol, p_clave_idem, r.id) returning id into v_id;
  v_res := jsonb_build_object('estado', 'ok', 'folio', v_cob, 'deshecho', r.folio, 'aviso_grupo', format('%s deshizo %s (%s) de %s. %s', initcap(v_sol), r.folio, r.accion,
    (select nombre_canonico from catalogo.cliente where id = r.cliente_id), cobranza._saldo_texto(r.cliente_id)));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------- conversacion: la pregunta que el bot dejo abierta (el servidor la recuerda)
create function agente.cobranza_espera_guardar(p_chat bigint, p_cliente bigint, p_accion text, p_falta text, p_datos jsonb, p_por text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  insert into cobranza.espera (chat_id, cliente_id, accion, datos, falta, abierta_por, expira_at)
    values (p_chat, p_cliente, p_accion, coalesce(p_datos, '{}'::jsonb), p_falta, lower(p_por), clock_timestamp() + interval '12 hours')
    on conflict (chat_id) do update set cliente_id = excluded.cliente_id, accion = excluded.accion, datos = excluded.datos, falta = excluded.falta, abierta_por = excluded.abierta_por, expira_at = excluded.expira_at;
end $$;

create function agente.cobranza_espera_vigente(p_chat bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select jsonb_build_object('cliente_id', e.cliente_id, 'accion', e.accion, 'falta', e.falta, 'datos', e.datos, 'abierta_por', e.abierta_por)
            from cobranza.espera e where e.chat_id = p_chat and e.expira_at > clock_timestamp());
end $$;

create function agente.cobranza_espera_cerrar(p_chat bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  delete from cobranza.espera where chat_id = p_chat;
end $$;

-- ---------------------------------------------------------------- metricas (SQL; el modelo jamas las calcula)
create function cobranza._fecha_saldado(p_pedido bigint) returns date
language sql stable security definer set search_path = ''
as $$
  select case when operacion.pedido_saldo(p_pedido) <= 0 and exists (select 1 from operacion.pedido where id = p_pedido and estado = 'enviado')
              then (select max(p.fecha_neg) from operacion.pago_aplicacion pa join operacion.pago p on p.id = pa.pago_id where pa.pedido_id = p_pedido) end
$$;

create function cobranza.metricas(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_dc numeric; v_pt numeric; v_p3 numeric; v_ap numeric; v_pc numeric; v_tr numeric; v_h numeric; v_conc numeric; v_rap bigint; v_rpen bigint; v_msg int; v_comp numeric;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  with p as (
    select pe.id, pe.fecha_envio, cobranza.vence_efectivo(pe.id) as vence, cobranza._fecha_saldado(pe.id) as saldado, operacion.pedido_cobrado(pe.id) as cobrado
      from operacion.pedido pe where pe.estado = 'enviado' and pe.fecha_envio is not null)
  select
    (select round(sum((saldado - fecha_envio) * cobrado)::numeric / nullif(sum(cobrado), 0), 2) from p where saldado between p_desde and p_hasta),
    (select round(100.0 * count(*) filter (where saldado is not null and saldado <= vence) / nullif(count(*), 0), 1) from p where vence between p_desde and p_hasta and vence <= p_hasta),
    (select round(100.0 * count(*) filter (where saldado is not null and saldado <= vence + 3) / nullif(count(*), 0), 1) from p where vence between p_desde and p_hasta and vence + 3 <= p_hasta),
    (select round(avg(saldado - vence), 1) from p where saldado between p_desde and p_hasta and saldado > vence)
   into v_dc, v_pt, v_p3, v_ap;
  select round(100.0 * count(*) filter (where cobranza._fecha_saldado(z.pid) is not null and cobranza._fecha_saldado(z.pid) <= z.f) / nullif(count(*), 0), 1) into v_comp
    from (select (r.params ->> 'fecha')::date as f, (r.params -> 'pedidos' ->> 0)::bigint as pid from cobranza.respuesta r
           where r.accion in ('prometio', 'se_atrasa') and (r.params ->> 'fecha')::date between p_desde and p_hasta and not exists (select 1 from cobranza.respuesta z where z.revierte_id = r.id)) z;
  select round(100.0 * count(*) filter (where exists (select 1 from cobranza.respuesta r where r.cliente_id = dl.cliente_id and r.accion <> 'deshacer' and r.creado_at between d.reclamado_at and d.reclamado_at + interval '24 hours')) / nullif(count(*), 0), 1)
    into v_tr from cobranza.digest_linea dl join cobranza.digest d on d.id = dl.digest_id where dl.formato = 'tarjeta' and d.estado = 'enviado' and d.fecha_negocio between p_desde and p_hasta;
  select round(avg(extract(epoch from (pr.t - d.reclamado_at)) / 3600)::numeric, 1) into v_h
    from cobranza.digest d join lateral (select min(r.creado_at) as t from cobranza.respuesta r join cobranza.digest_linea dl on dl.digest_id = d.id and dl.cliente_id = r.cliente_id
                                          where r.creado_at >= d.reclamado_at and r.accion <> 'deshacer') pr on pr.t is not null where d.estado = 'enviado' and d.fecha_negocio between p_desde and p_hasta;
  select coalesce(max(n), 0) into v_msg from (select count(*) n from cobranza.digest where estado = 'enviado' and fecha_negocio between p_desde and p_hasta group by fecha_negocio) z;
  select coalesce(sum((x ->> 'aplicado_cent')::bigint), 0), coalesce(sum((x ->> 'pendiente_cent')::bigint), 0) into v_rap, v_rpen
    from operacion.pedido pe, lateral (select operacion.recargo_sugerido(pe.id, p_hasta) as x) q where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0;
  select round(100.0 * max(s) / nullif(sum(s), 0), 1) into v_conc from (select sum(operacion.pedido_saldo(pe.id)) s from operacion.pedido pe where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0 group by pe.cliente_id) z;
  return jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'dias_cobro_promedio', v_dc, 'pct_cobrado_a_tiempo', v_pt, 'pct_cobrado_dentro_v3', v_p3, 'atraso_promedio_dias', v_ap,
    'promesas_cumplidas_pct', v_comp, 'tasa_respuesta_24h_pct', v_tr, 'horas_primera_respuesta', v_h, 'recargo_aplicado_cent', v_rap, 'recargo_sugerido_pendiente_cent', v_rpen,
    'max_digests_en_un_dia', v_msg, 'concentracion_mayor_cliente_pct', v_conc);
end $$;

-- Perfil determinista por cliente: solo con 3 o mas pedidos CERRADOS; antes dice "sin historial suficiente". Nunca cambia plazos, recargos ni frecuencia por su cuenta.
create function cobranza.perfil_cliente(p_cliente bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_n int; v_atraso numeric; v_comp numeric; v_prom int;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  select count(*), round(avg(cobranza._fecha_saldado(pe.id) - cobranza.vence_efectivo(pe.id)), 1) into v_n, v_atraso
    from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' and cobranza._fecha_saldado(pe.id) is not null and cobranza.vence_efectivo(pe.id) is not null;
  if v_n < 3 then return jsonb_build_object('suficiente', false, 'pedidos_cerrados', v_n, 'texto', 'sin historial suficiente'); end if;
  select count(*), round(100.0 * count(*) filter (where cobranza._fecha_saldado(pr.pedido_id) is not null and cobranza._fecha_saldado(pr.pedido_id) <= pr.fecha), 1) into v_prom, v_comp
    from (select (r.params ->> 'fecha')::date as fecha, (r.params -> 'pedidos' ->> 0)::bigint as pedido_id from cobranza.respuesta r
           where r.cliente_id = p_cliente and r.accion in ('prometio', 'se_atrasa') and not exists (select 1 from cobranza.respuesta z where z.revierte_id = r.id)) pr;
  return jsonb_build_object('suficiente', true, 'pedidos_cerrados', v_n, 'atraso_medio_dias', v_atraso, 'promesas', v_prom, 'promesas_cumplidas_pct', v_comp,
    'texto', format('Paga en promedio %s días %s del vencimiento (%s pedidos cerrados).', abs(v_atraso), case when v_atraso > 0 then 'después' else 'antes' end, v_n));
end $$;

revoke all on sequence cobranza.folio_seq from public, anon, authenticated;
revoke all on function cobranza.contar_ignorados(date), cobranza.reloj_tick(text, jsonb), cobranza.registrar_envio(bigint, boolean, bigint, text) from public, anon, authenticated;
revoke all on function cobranza._saldo_texto(bigint), cobranza._pregunta(text, text, jsonb), cobranza._cuentas_validas(), cobranza.responder(text, jsonb, text), cobranza.tipos_no_reversibles() from public, anon, authenticated;
revoke all on function cobranza._fecha_saldado(bigint), cobranza.metricas(date, date), cobranza.perfil_cliente(bigint) from public, anon, authenticated;
revoke all on function agente.cobranza_responder(text, jsonb), agente.cobranza_deshacer(text, text, text, bigint) from public, anon, authenticated;
revoke all on function agente.cobranza_espera_guardar(bigint, bigint, text, text, jsonb, text), agente.cobranza_espera_vigente(bigint), agente.cobranza_espera_cerrar(bigint) from public, anon, authenticated;
grant execute on function cobranza.contar_ignorados(date), cobranza.reloj_tick(text, jsonb), cobranza.registrar_envio(bigint, boolean, bigint, text), cobranza.metricas(date, date), cobranza.perfil_cliente(bigint) to servidor;
grant execute on function agente.cobranza_responder(text, jsonb), agente.cobranza_deshacer(text, text, text, bigint) to servidor;
grant execute on function agente.cobranza_espera_guardar(bigint, bigint, text, text, jsonb, text), agente.cobranza_espera_vigente(bigint), agente.cobranza_espera_cerrar(bigint) to servidor;
