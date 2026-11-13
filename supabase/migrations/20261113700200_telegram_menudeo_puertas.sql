-- Lane telegram-ampliacion (3/3): intenciones `pedido_menudeo` y `pago_pedido_menudeo`, decision del otro socio, respuesta a recordatorios y lectura/reclamo de recordatorios.
-- ADITIVA: funciones nuevas del esquema `agente` y la redefinicion (create or replace, misma firma) de las puertas agente.ejecutar_ext y agente.simular, que solo agregan
-- el enrutamiento de los tipos nuevos; el resto del comportamiento (autor verificado, firma, lote, hash del efecto) es el de 20261113100300. Sin DROP.
-- Todo lo de dinero y fechas lo calculan las funciones ds_* de dropshipping (la IA no calcula nada). Ninguna funcion nueva tiene GRANT a authenticated.
--
-- Tipos nuevos de agente.ejecutar_ext / agente.simular:
--   pedido_menudeo          crea el pedido a costo del socio de menudeo (ds_crear_pedido, tipo socio_a_costo) con su fecha comprometida y lo confirma. Sin destinatario ni telefonos.
--   pago_pedido_menudeo     el socio de menudeo reporta un pago (monto, referencia, fecha); un comprobante de Telegram (solo huella) permite aplicarlo.
--   pago_decidir            el OTRO socio confirma recibido o rechaza el pago reportado.
--   recordatorio_responder  "Pagado" (reporta el pago pendiente) o "Reprogramar" (nueva fecha) como respuesta a un recordatorio.

-- ------------------------------------------------------------------ solo el socio de menudeo
create function agente._exigir_socio_menudeo(p_autor text) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_nombre text := (select s.nombre from catalogo.socio s where s.id = operacion.ds_socio_menudeo());
begin
  if v_nombre is distinct from initcap(p_autor) then
    raise exception 'solo el socio de menudeo (%) mete pedidos a costo, avisa sus pagos y reprograma sus fechas: el otro socio los confirma o rechaza', coalesce(v_nombre, 'sin definir') using errcode = '42501';
  end if;
end $$;

-- ------------------------------------------------------------------ efecto del servidor (hash de la vista previa) de los tipos nuevos
create function agente._efecto_menudeo(p_tipo text, p_res jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_id bigint; v_c operacion.ds_pedido_compromiso;
begin
  if p_tipo = 'pedido_menudeo' then
    v_id := (p_res ->> 'pedido_id')::bigint;
    select * into v_c from operacion.ds_pedido_compromiso where pedido_id = v_id order by id desc limit 1;
    return jsonb_build_object(
      'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico || ' ' || sa.nombre_canonico, 'piezas', l.piezas_pedidas, 'precio_cent', l.precio_cent, 'importe_cent', l.piezas_pedidas::bigint * l.precio_cent) order by l.id), '[]'::jsonb)
                   from operacion.pedido_linea l join catalogo.modelo m on m.id = l.modelo_id join catalogo.sku k on k.id = l.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = v_id),
      'costo_cent', (select coalesce(sum(l.piezas_pedidas::bigint * l.precio_cent), 0) from operacion.pedido_linea l where l.pedido_id = v_id),
      'proveedor_origen', p_res ->> 'origen',
      'fecha_compromiso', v_c.fecha_compromiso, 'hora_compromiso', v_c.hora_compromiso);
  elsif p_tipo = 'pago_pedido_menudeo' then
    return jsonb_build_object('pendiente_cent', p_res -> 'pendiente_cent', 'estado', p_res -> 'estado', 'aplicado', p_res -> 'aplicado');
  end if;
  return '{}'::jsonb;
end $$;

-- ------------------------------------------------------------------ las escrituras nuevas (internas: las llaman las puertas, que verifican al autor)
create function agente._menudeo_base(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_nombre text; v_origen text; v_existia boolean; v_res jsonb; v_id bigint; v_ped bigint; v_folio text; v_cliente bigint; v_lineas jsonb; v_evid bigint;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  v_nombre := initcap(v_autor);
  v_origen := agente._origen(p_args);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);

  if p_tipo = 'pedido_menudeo' then
    perform agente._exigir_socio_menudeo(v_autor);
    -- Cliente interno de stock del socio (sin telefonos ni destinatario): "Menudeo <socio>". Nunca lo elige la IA.
    v_cliente := catalogo.asegurar_cliente('Menudeo ' || v_nombre, v_nombre);
    v_lineas := agente._lineas_sku(p_args -> 'lineas');
    v_res := operacion.ds_crear_pedido(p_clave_idem, v_cliente, v_lineas, coalesce(nullif(p_args ->> 'origen_pedido', ''), 'karen_directo'), null, null, 'socio_a_costo', v_nombre,
      nullif(p_args ->> 'folio_externo', ''), 0, 0, null, null, v_origen, nullif(p_args ->> 'fecha_compromiso', '')::date, nullif(p_args ->> 'hora_compromiso', '')::time);
    v_id := (v_res ->> 'pedido_id')::bigint;
    perform operacion.confirmar_pedido(p_clave_idem || ':c', v_id);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'pedido', 'pedido', v_id, v_autor, v_res ->> 'folio');
    return v_res || jsonb_build_object('folio', v_folio, 'estado', 'confirmado', 'repetido', v_existia);

  elsif p_tipo = 'pago_pedido_menudeo' then
    perform agente._exigir_socio_menudeo(v_autor);
    v_ped := agente._pedido_id(p_args ->> 'pedido_folio');
    -- Comprobante (foto del ticket o de la transferencia): solo su huella; el bot no lo lee. Con comprobante el pago se aplica (politica del dueno) y el otro socio aun puede rechazarlo.
    v_evid := case when v_existia then null else agente._evidencia_pendiente((p_args ->> 'telegram_user_id')::bigint) end;
    perform set_config('rtm.evidencia_tg', coalesce(v_evid::text, ''), true);
    v_res := operacion.ds_reportar_pago_menudeo(p_clave_idem, v_ped, null, (p_args ->> 'monto_cent')::bigint, coalesce(nullif(p_args ->> 'metodo', ''), 'transferencia'),
      coalesce(p_args ->> 'referencia', ''), nullif(p_args ->> 'fecha', '')::date, coalesce(nullif(p_args ->> 'via', ''), 'proveedor'), null, null, null, v_nombre, null);
    perform set_config('rtm.evidencia_tg', '', true);
    if v_evid is not null and not v_existia then update agente.evidencia_tg set reporte_id = (v_res ->> 'reporte_id')::bigint where id = v_evid and reporte_id is null; end if;
    select o.folio into v_folio from operacion.pedido o where o.id = v_ped;
    return v_res || jsonb_build_object('folio', v_folio, 'pedido', v_folio, 'socio', v_nombre, 'repetido', v_existia);

  elsif p_tipo = 'pago_decidir' then
    -- Lo decide el OTRO socio (la funcion de negocio lo exige): confirmar recibido o rechazar con motivo.
    v_res := operacion.ds_decidir_pago_menudeo(p_clave_idem, (p_args ->> 'reporte_id')::bigint, p_args ->> 'decision', p_args ->> 'motivo');
    select o.folio into v_folio from operacion.ds_pago_reporte r join operacion.pedido o on o.id = r.pedido_id where r.id = (p_args ->> 'reporte_id')::bigint;
    return v_res || jsonb_build_object('folio', v_folio, 'pedido', v_folio, 'repetido', v_existia);

  elsif p_tipo = 'recordatorio_responder' then
    perform agente._exigir_socio_menudeo(v_autor);
    v_ped := coalesce(nullif(p_args ->> 'pedido_id', '')::bigint, agente._pedido_id(p_args ->> 'pedido_folio'));
    v_res := operacion.ds_responder_recordatorio_menudeo(p_clave_idem, v_ped, p_args ->> 'accion', nullif(p_args ->> 'fecha', '')::date, nullif(p_args ->> 'hora', '')::time, p_args ->> 'motivo',
      coalesce(p_args ->> 'referencia', ''), coalesce(nullif(p_args ->> 'metodo', ''), 'transferencia'), coalesce(nullif(p_args ->> 'via', ''), 'proveedor'), v_nombre);
    select o.folio into v_folio from operacion.pedido o where o.id = v_ped;
    return v_res || jsonb_build_object('folio', v_folio, 'pedido', v_folio, 'socio', v_nombre, 'repetido', v_existia);
  end if;
  raise exception 'tipo de menudeo desconocido: %', p_tipo using errcode = 'P0460';
end $$;

-- ------------------------------------------------------------------ puertas (copia de 20261113100300 con el enrutamiento de los tipos nuevos)
create or replace function agente.ejecutar_ext(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_res jsonb; v_hash text; v_menudeo boolean := p_tipo in ('pedido_menudeo', 'pago_pedido_menudeo', 'pago_decidir', 'recordatorio_responder');
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._autor(p_args);
  perform agente._exigir_capital_propio(p_tipo, p_args, v_autor);
  if p_tipo = 'acta_firma' then
    -- La firma es personal: exige un boton "Si, estoy seguro" consumido por ESE socio, de ESTA indicacion (misma clave), y no basta el JSON.
    if not exists (select 1 from agente.tg_token t
        where t.token = p_args ->> 'token_boton' and t.accion = 'confirmar_refuerzo' and t.usado_at is not null
          and t.usado_por = (p_args ->> 'telegram_user_id')::bigint and t.payload ->> 'claveIdem' = p_clave_idem) then
      raise exception 'la firma del acta es personal: falta tu confirmacion con el boton, dada desde tu propio Telegram' using errcode = '42501';
    end if;
  elsif p_tipo = 'lote_historico' then
    -- BAJO-3: el lote historico reescribe historia en bloque: ademas del autor, el OTRO socio da el segundo paso (boton de esta misma indicacion).
    if not exists (select 1 from agente.tg_token t join agente.miembro m on m.telegram_user_id = t.usado_por
        where t.token = p_args ->> 'token_boton' and t.accion = 'confirmar_refuerzo' and t.usado_at is not null and t.payload ->> 'claveIdem' = p_clave_idem
          and m.rol = 'socio' and m.activo and m.persona <> v_autor) then
      raise exception 'el lote historico lo confirma ademas el otro socio, desde su propio Telegram' using errcode = '42501';
    end if;
  end if;
  v_res := case when v_menudeo then agente._menudeo_base(p_clave_idem, p_tipo, p_args) else agente._ejecutar_ext_base(p_clave_idem, p_tipo, p_args) end;
  if p_tipo = 'lote_historico' then v_res := v_res || jsonb_build_object('clasificaciones', agente._clasificaciones(p_clave_idem)); end if;
  -- El socio confirmo UN efecto (el de la vista previa). Si el real cambio entre simular y ejecutar, se aborta todo.
  if nullif(p_args ->> 'efecto_hash', '') is not null and not coalesce((v_res ->> 'repetido')::boolean, false) then
    v_hash := agente._hash_efecto(case when v_menudeo then agente._efecto_menudeo(p_tipo, v_res) else agente._efecto(p_tipo, v_res) end);
    if v_hash <> p_args ->> 'efecto_hash' then
      raise exception 'el efecto cambio desde la vista previa (precio, tipo de cambio o existencia): revisa el nuevo resumen y confirma otra vez' using errcode = 'P0462';
    end if;
  end if;
  return v_res;
end $$;

create or replace function agente.simular(p_hub text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_efecto jsonb := '{}'::jsonb; v_rojas jsonb; v_txt text; v_autor text; v_clave text := 'sim:' || clock_timestamp()::text || ':' || p_tipo; v_menudeo boolean := p_tipo in ('pedido_menudeo', 'pago_pedido_menudeo', 'pago_decidir', 'recordatorio_responder');
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_capital_propio(p_tipo, p_args, v_autor);
  begin
    -- Funciones base (sin candado de firma ni hash): la simulacion nunca firma y se revierte siempre. La declaracion de capital usa el MISMO camino que la ejecucion.
    if p_hub = 'ejecutar_ext' and v_menudeo then v_res := agente._menudeo_base(v_clave, p_tipo, p_args);
    elsif p_hub = 'ejecutar_ext' then v_res := agente._ejecutar_ext_base(v_clave, p_tipo, p_args);
    elsif p_hub = 'ejecutar' and p_tipo = 'pago_proveedor' and coalesce((p_args ->> 'declara_capital')::boolean, false) then v_res := agente._pago_proveedor_declarado(v_clave, p_args, v_autor);
    elsif p_hub = 'ejecutar' then v_res := agente._ejecutar_base(v_clave, p_tipo, p_args);
    else raise exception 'hub desconocido' using errcode = 'P0460'; end if;
    v_efecto := case when v_menudeo then agente._efecto_menudeo(p_tipo, v_res) else agente._efecto(p_tipo, v_res) end;
    perform contabilidad.asentar_pendientes();
    select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'via_a_cent', c.via_a_cent, 'via_b_cent', c.via_b_cent)), '[]'::jsonb) into v_rojas from contabilidad.comprobaciones() c where not c.ok and c.bloqueante;
    raise exception 'simulacion' using errcode = 'P0498', detail = jsonb_build_object('resultado', v_res - 'repetido', 'efecto', v_efecto, 'efecto_hash', agente._hash_efecto(v_efecto),
      'clasificaciones', agente._clasificaciones(v_clave), 'cuadra', jsonb_array_length(v_rojas) = 0, 'comprobaciones_rojas', v_rojas)::text;
  exception when sqlstate 'P0498' then
    get stacked diagnostics v_txt = pg_exception_detail;
    return v_txt::jsonb;
  end;
end $$;

-- ------------------------------------------------------------------ recordatorios (lectura y reclamo; el envio lo hace el latido, solo con `telegram_envio` encendido)
-- Lectura de lo que toca avisar a esta hora (sin datos personales: folio, socio, proveedor, monto pendiente, fecha, atraso, enviados).
create function agente.recordatorios_menudeo(p_ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  return operacion.ds_recordatorios_pago_menudeo(p_ahora);
end $$;

-- Reclama el aviso ANTES de enviarlo: registra el envio (idempotente por pedido y hora) solo si ese aviso todavia toca. Dos latidos simultaneos o un reintento del mismo
-- no duplican: el segundo ya no encuentra el aviso pendiente y recibe reclamado = false.
create function agente.recordatorio_reclamar(p_pedido bigint, p_tipo text, p_ahora timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  perform pg_advisory_xact_lock(hashtextextended('agente.recordatorio:' || p_pedido::text, 0));
  if not exists (select 1 from jsonb_array_elements(operacion.ds_recordatorios_pago_menudeo(p_ahora) -> 'recordatorios') x
                  where (x ->> 'pedido_id')::bigint = p_pedido and x ->> 'tipo' = p_tipo) then
    return jsonb_build_object('reclamado', false);
  end if;
  v_res := operacion.ds_registrar_recordatorio_menudeo('rec:' || p_pedido::text || ':' || p_tipo || ':' || to_char(date_trunc('hour', p_ahora) at time zone 'UTC', 'YYYYMMDDHH24'), p_pedido, p_tipo, p_ahora, 'telegram');
  return jsonb_build_object('reclamado', true, 'enviados', v_res -> 'enviados');
end $$;

-- ------------------------------------------------------------------ privilegios (por funcion, explicito; ninguna a authenticated)
revoke all on function agente._exigir_socio_menudeo(text), agente._efecto_menudeo(text, jsonb), agente._menudeo_base(text, text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente.recordatorios_menudeo(timestamptz), agente.recordatorio_reclamar(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function agente.recordatorios_menudeo(timestamptz), agente.recordatorio_reclamar(bigint, text, timestamptz) to servidor;
revoke all on function agente.ejecutar_ext(text, text, jsonb), agente.simular(text, text, jsonb) from public, anon, authenticated;
grant execute on function agente.ejecutar_ext(text, text, jsonb), agente.simular(text, text, jsonb) to servidor;
