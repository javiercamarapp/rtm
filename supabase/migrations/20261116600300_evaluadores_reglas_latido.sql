-- Carril RELOJ, puntos 4 y 5: motor de evaluadores. notificacion.evaluar() (F3b) solo evalua 4 reglas; aqui se agregan evaluadores para los tipos ya cargados que aplican,
-- cada uno con su interruptor propio (TODOS apagados) y la regla de "nada hacia atras": solo hechos posteriores a la activacion de la regla (p_desde).
-- Cada evaluador: (p_hoy date, p_ahora timestamptz, p_desde timestamptz) -> jsonb. Emiten SIEMPRE por notificacion.emitir_programado (dedup, enfriamiento, techo, silencio).
-- Los textos salen de SQL (cifras ya calculadas, formato con notificacion._mxn); sin IA. Sin dueno de cliente; marcas y modelos no se nombran aqui.
-- notificacion.latido() se ENVUELVE (rename + wrap sobre su ultima definicion, la de F3b): hace lo mismo que antes y ademas corre el motor y la vigia del reloj.

create function notificacion._fecha_desde(p_desde timestamptz) returns date
language sql immutable set search_path = ''
as $$ select (p_desde at time zone 'America/Merida')::date $$;

create function notificacion._estado_get(p_clave text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select valor from notificacion.estado_evaluador where clave = p_clave $$;

create function notificacion._estado_set(p_clave text, p_valor jsonb) returns void
language sql security definer set search_path = ''
as $$ insert into notificacion.estado_evaluador (clave, valor) values (p_clave, p_valor) on conflict (clave) do update set valor = excluded.valor, actualizado_at = now() $$;

-- Cobertura de pagos a proveedor: solo cuando CRUZA de >= 1.0 a < 1.0. Si ya estaba abajo al activar la regla no es un hecho nuevo (queda en el resumen).
create function notificacion.ev_cobertura_pagos(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb; v_bajo boolean; v_ant jsonb; v_r jsonb; v_texto text; v_cob numeric;
begin
  v := agente.rep_liquidez(p_hoy);
  if (v ->> 'pagable_cent')::bigint = 0 then
    perform notificacion._estado_set('cobertura_bajo', 'false'::jsonb);
    return jsonb_build_object('emitidas', 0);
  end if;
  v_bajo := (v ->> 'bajo_uno')::boolean;
  v_ant := notificacion._estado_get('cobertura_bajo');
  perform notificacion._estado_set('cobertura_bajo', to_jsonb(v_bajo));
  if v_ant is null or not v_bajo or (v_ant #>> '{}')::boolean then return jsonb_build_object('emitidas', 0); end if;
  v_cob := (v ->> 'cobertura_centesimas')::numeric / 100;
  v_texto := 'Cobertura de pagos a proveedores: ' || to_char(v_cob, 'FM990.00') || '. Por pagar ' || notificacion._mxn((v ->> 'pagable_cent')::bigint) || '; cobrable hasta el '
    || to_char((v ->> 'fecha_pago')::date, 'DD-MM') || ': ' || notificacion._mxn((v ->> 'cobrable_cent')::bigint) || '.'
    || case when v ->> 'mayor_cliente' is not null then ' Sin el cliente mayor (' || upper(v ->> 'mayor_cliente') || ', ' || notificacion._mxn((v ->> 'mayor_cliente_cent')::bigint) || '): '
         || to_char((v ->> 'cobertura_sin_mayor_centesimas')::numeric / 100, 'FM990.00') || '.' else '' end;
  v_r := notificacion.emitir_programado('cobertura_pagos', 'cobertura:' || p_hoy, 'I', 'Cobertura de pagos a proveedores menor a 1.0', v_texto, 'proveedor', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
  return jsonb_build_object('emitidas', (v_r ->> 'estado' = 'emitido')::int, 'resultado', v_r);
end $$;

-- Vencimiento de proveedor (Isaac plazo 7, Karen plazo 10; FIFO): a 3 dias, a 1 dia, el dia del vencimiento y el dia siguiente. Un mensaje por proveedor y dia.
create function notificacion.ev_vencimiento_proveedor(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb; p jsonb; f jsonb; v_n int := 0; v_r jsonb; v_lineas text[]; v_total bigint; v_crit boolean; v_ini date;
begin
  v := agente.rep_vencimientos_proveedor(p_hoy);
  for p in select * from jsonb_array_elements(v -> 'proveedores') loop
    v_lineas := '{}'; v_total := 0; v_crit := false;
    for f in select * from jsonb_array_elements(p -> 'filas') loop
      -- Nada hacia atras: el aviso de un vencimiento solo existe si el dia del hecho (vencimiento menos 3, o el propio vencimiento) es posterior a la activacion.
      v_ini := (f ->> 'vence')::date - 3;
      continue when v_ini < notificacion._fecha_desde(p_desde) and (f ->> 'vence')::date < notificacion._fecha_desde(p_desde);
      continue when (f ->> 'dias_para_vencer')::int not in (3, 1, 0, -1);
      v_lineas := v_lineas || (case when (f ->> 'dias_para_vencer')::int < 0 then 'VENCIO el ' else 'vence el ' end || to_char((f ->> 'vence')::date, 'DD-MM') || ' ' || (f ->> 'origen') || ' ' || (f ->> 'folio') || ' ' || notificacion._mxn((f ->> 'pendiente_cent')::bigint));
      v_total := v_total + (f ->> 'pendiente_cent')::bigint;
      v_crit := v_crit or (f ->> 'dias_para_vencer')::int < 0;
    end loop;
    continue when cardinality(v_lineas) = 0;
    v_r := notificacion.emitir_programado('vencimiento_proveedor', 'vprov:' || lower(p ->> 'proveedor') || ':' || p_hoy, 'I',
      'Pago a ' || (p ->> 'proveedor') || ' por vencer', 'Pago a ' || (p ->> 'proveedor') || ' (plazo ' || (p ->> 'plazo_dias') || ' dias): ' || array_to_string(v_lineas, '; ') || '. Pendiente en total ' || notificacion._mxn(v_total) || '.',
      'proveedor', null, jsonb_build_object('hecho_fecha', p_hoy, 'proveedor', p ->> 'proveedor'), p_ahora);
    v_n := v_n + (v_r ->> 'estado' = 'emitido')::int;
  end loop;
  return jsonb_build_object('emitidas', v_n);
end $$;

create function notificacion._lineas_clientes(p_filas jsonb) returns text
language sql immutable set search_path = ''
as $$ select coalesce(string_agg(upper(f ->> 'cliente') || ' ' || notificacion._mxn((f ->> 'saldo_cent')::bigint) || ' (' || (f ->> 'pedidos') || case when (f ->> 'pedidos')::int = 1 then ' pedido)' else ' pedidos)' end, '; ' order by ord), '') from jsonb_array_elements(p_filas) with ordinality as t(f, ord) $$;

-- Cobros que vencen manana: un mensaje por dia, agrupado por cliente.
create function notificacion.ev_cobranza_vence_manana(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb; v_r jsonb; v_tot bigint;
begin
  v := agente.rep_cartera_vencimientos(p_hoy) -> 'vencen_manana';
  if jsonb_array_length(v) = 0 then return jsonb_build_object('emitidas', 0); end if;
  select sum((x ->> 'saldo_cent')::bigint) into v_tot from jsonb_array_elements(v) x;
  v_r := notificacion.emitir_programado('cobranza_vence_manana', 'cobro_manana:' || p_hoy, 'I', 'Cobros que vencen manana',
    'Vencen manana (' || to_char(p_hoy + 1, 'DD-MM') || '): ' || notificacion._lineas_clientes(v) || '. Total ' || notificacion._mxn(v_tot) || '.', 'pago', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
  return jsonb_build_object('emitidas', (v_r ->> 'estado' = 'emitido')::int);
end $$;

-- Cuenta vencida: dia 1 y cruces de 8, 15, 30 y 60 dias de atraso. Cada pedido avisa cada cruce una sola vez, y solo si el cruce ocurrio despues de activar la regla.
create function notificacion.ev_cuenta_vencida(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; k int; v_etapa int; v_prev int; v_filas jsonb := '[]'::jsonb; v_n int := 0; v_r jsonb; v_tot bigint := 0; v_ids text[] := '{}'; v_desde date := notificacion._fecha_desde(p_desde); v_map jsonb := '{}'::jsonb; e record;
begin
  for r in select * from agente._rep_cartera(p_hoy) where vence is not null and vence < p_hoy order by cliente, folio loop
    v_etapa := null;
    foreach k in array array[60, 30, 15, 8, 1] loop
      if r.dias_atraso >= k and r.vence + k >= v_desde then v_etapa := k; exit; end if;
    end loop;
    continue when v_etapa is null;
    v_prev := coalesce((notificacion._estado_get('cruce:' || r.pedido_id) #>> '{}')::int, 0);
    continue when v_prev >= v_etapa;
    v_filas := v_filas || jsonb_build_array(jsonb_build_object('cliente', r.cliente, 'saldo_cent', r.saldo_cent, 'pedidos', 1, 'atraso', r.dias_atraso, 'etapa', v_etapa));
    v_tot := v_tot + r.saldo_cent; v_ids := v_ids || (r.pedido_id || ':' || v_etapa); v_map := v_map || jsonb_build_object(r.pedido_id::text, v_etapa);
  end loop;
  if jsonb_array_length(v_filas) = 0 then return jsonb_build_object('emitidas', 0); end if;
  v_r := notificacion.emitir_programado('cuenta_vencida', 'vencidas:' || p_hoy || ':' || md5(array_to_string(v_ids, ',')), 'I', 'Cuentas por cobrar vencidas',
    'Vencidas: ' || (select string_agg(upper(f ->> 'cliente') || ' ' || notificacion._mxn((f ->> 'saldo_cent')::bigint) || ' (' || (f ->> 'atraso') || ' dias de atraso)', '; ') from jsonb_array_elements(v_filas) f) || '. Total ' || notificacion._mxn(v_tot) || '.',
    'pago', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
  if v_r ->> 'estado' = 'emitido' then
    for e in select key, value from jsonb_each(v_map) loop
      perform notificacion._estado_set('cruce:' || e.key, e.value);
    end loop;
    v_n := 1;
  end if;
  return jsonb_build_object('emitidas', v_n);
end $$;

-- Libro que no cuadra: cualquier comprobacion C1..C24 o CU en rojo. Una vez por caida (pasa de verde a rojo); al volver a verde el asunto se resuelve solo.
create function notificacion.ev_libro_no_cuadra(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c record; v_ant jsonb; v_n int := 0; v_r jsonb; v_id bigint;
begin
  for c in select codigo, nombre, ok from contabilidad.comprobaciones() order by codigo loop
    v_id := hashtext(c.codigo);
    v_ant := notificacion._estado_get('libro_ok:' || c.codigo);
    perform notificacion._estado_set('libro_ok:' || c.codigo, to_jsonb(c.ok));
    if c.ok then
      perform operacion.resolver_avisos('libro_no_cuadra', 'comprobacion', v_id);
    elsif v_ant is not null and (v_ant #>> '{}')::boolean then
      v_r := notificacion.emitir_programado('libro_no_cuadra', 'libro:' || c.codigo || ':' || extract(epoch from p_ahora)::bigint, 'C', 'El libro no cuadra: ' || c.codigo,
        'El libro no cuadra: la comprobacion ' || c.codigo || ' (' || c.nombre || ') esta en rojo.', 'comprobacion', v_id, jsonb_build_object('comprobacion', c.codigo), p_ahora);
      v_n := v_n + (v_r ->> 'estado' = 'emitido')::int;
    end if;
  end loop;
  return jsonb_build_object('emitidas', v_n);
end $$;

-- Fondos en poder de un socio: alerta si CRECEN respecto de la ultima cifra vista (la primera vez solo se anota). Muestra, no presiona: un mensaje por socio y dia.
create function notificacion.ev_fondos_en_poder(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s record; v_ant jsonb; v_n int := 0; v_r jsonb; v_f bigint;
begin
  for s in select id, nombre from catalogo.socio order by nombre loop
    v_f := greatest(operacion.saldo_socio(s.id, 'fondos'), 0);
    v_ant := notificacion._estado_get('fondos_vistos:' || s.id);
    perform notificacion._estado_set('fondos_vistos:' || s.id, to_jsonb(v_f));
    continue when v_ant is null or v_f <= (v_ant #>> '{}')::bigint;
    v_r := notificacion.emitir_programado('fondos_en_poder', 'fondos:' || s.id || ':' || p_hoy, 'I', 'Fondos en poder de ' || s.nombre || ' crecen',
      'Fondos de la sociedad en poder de ' || s.nombre || ': ' || notificacion._mxn(v_f) || ' (antes ' || notificacion._mxn((v_ant #>> '{}')::bigint) || ').', 'socios', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
    v_n := v_n + (v_r ->> 'estado' = 'emitido')::int;
  end loop;
  return jsonb_build_object('emitidas', v_n);
end $$;

-- Margen menor al minimo por pedido (excluye pedidos a costo del socio): solo pedidos enviados desde la activacion; cada pedido avisa una vez.
create function notificacion.ev_margen_bajo(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb; x jsonb; v_vistos jsonb := coalesce(notificacion._estado_get('margen_avisados'), '[]'::jsonb); v_nuevos jsonb := '[]'::jsonb; v_r jsonb; v_ids text;
begin
  v := agente.rep_margen(p_hoy, greatest(notificacion._fecha_desde(p_desde), p_hoy - 7));
  for x in select * from jsonb_array_elements(v -> 'pedidos') loop
    continue when v_vistos @> to_jsonb((x ->> 'pedido_id')::bigint);
    v_nuevos := v_nuevos || jsonb_build_array(x);
  end loop;
  if jsonb_array_length(v_nuevos) = 0 then return jsonb_build_object('emitidas', 0); end if;
  select string_agg(i ->> 'pedido_id', ',' order by i ->> 'pedido_id') into v_ids from jsonb_array_elements(v_nuevos) i;
  v_r := notificacion.emitir_programado('margen_bajo', 'margen:' || p_hoy || ':' || md5(v_ids), 'I', 'Pedidos con margen menor al minimo',
    'Margen menor a ' || to_char(((v ->> 'minimo_bp')::numeric) / 100, 'FM990.0') || ' por ciento: ' || (select string_agg((i ->> 'folio') || ' ' || upper(i ->> 'cliente') || ' ' || to_char(((i ->> 'margen_bp')::numeric) / 100, 'FM990.0') || ' por ciento', '; ') from jsonb_array_elements(v_nuevos) i) || '.',
    'pedido', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
  if v_r ->> 'estado' = 'emitido' then
    perform notificacion._estado_set('margen_avisados', v_vistos || (select jsonb_agg((i ->> 'pedido_id')::bigint) from jsonb_array_elements(v_nuevos) i));
  end if;
  return jsonb_build_object('emitidas', (v_r ->> 'estado' = 'emitido')::int);
end $$;

-- Pedido a credito sin plazo: pedidos enviados desde la activacion, con saldo y sin plazo (solo software; no sale por Telegram).
create function notificacion.ev_credito_sin_plazo(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ids text; v_folios text; v_r jsonb; v_vistos jsonb := coalesce(notificacion._estado_get('credito_sin_plazo_avisados'), '[]'::jsonb); v_nuevos bigint[];
begin
  select array_agg(r.pedido_id order by r.pedido_id) into v_nuevos from agente._rep_cartera(p_hoy) r join operacion.pedido pe on pe.id = r.pedido_id
   where r.plazo_dias is null and pe.fecha_envio >= notificacion._fecha_desde(p_desde) and not (v_vistos @> to_jsonb(r.pedido_id));
  if v_nuevos is null then return jsonb_build_object('emitidas', 0); end if;
  select string_agg(folio, ', ' order by folio) into v_folios from operacion.pedido where id = any (v_nuevos);
  v_r := notificacion.emitir_programado('credito_sin_plazo', 'sin_plazo:' || p_hoy || ':' || md5(array_to_string(v_nuevos, ',')), 'F', 'Pedido a credito sin plazo', 'Pedido a credito sin plazo acordado: ' || v_folios || '.', 'pedido', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
  if v_r ->> 'estado' = 'emitido' then
    perform notificacion._estado_set('credito_sin_plazo_avisados', v_vistos || to_jsonb(v_nuevos));
  end if;
  return jsonb_build_object('emitidas', (v_r ->> 'estado' = 'emitido')::int);
end $$;

-- Diferencia de recepcion abierta a 7, 14 y 30 dias (solo cruces posteriores a la activacion; cada diferencia avisa cada cruce una vez).
create function notificacion.ev_diferencia_recepcion(p_hoy date, p_ahora timestamptz, p_desde timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare d record; k int; v_et int; v_prev int; v_lineas text[] := '{}'; v_pares text[] := '{}'; v_r jsonb; v_dias int;
begin
  for d in select x.id, x.tipo, x.piezas, x.abierta_at::date as abierta, c.folio from operacion.compra_diferencia x join operacion.compra c on c.id = x.compra_id
            where not exists (select 1 from operacion.diferencia_asignacion a where a.diferencia_id = x.id) order by x.id loop
    v_dias := p_hoy - d.abierta; v_et := null;
    foreach k in array array[30, 14, 7] loop
      if v_dias >= k and d.abierta + k >= notificacion._fecha_desde(p_desde) then v_et := k; exit; end if;
    end loop;
    continue when v_et is null;
    v_prev := coalesce((notificacion._estado_get('dif_etapa:' || d.id) #>> '{}')::int, 0);
    continue when v_prev >= v_et;
    v_lineas := v_lineas || (d.folio || ' ' || d.tipo || ' de ' || d.piezas || ' piezas, ' || v_dias || ' dias');
    v_pares := v_pares || (d.id || ':' || v_et);
  end loop;
  if cardinality(v_lineas) = 0 then return jsonb_build_object('emitidas', 0); end if;
  v_r := notificacion.emitir_programado('diferencia_recepcion_vieja', 'dif_vieja:' || p_hoy || ':' || md5(array_to_string(v_pares, ',')), 'I', 'Diferencias de recepcion sin resolver',
    'Diferencias de recepcion sin resolver: ' || array_to_string(v_lineas, '; ') || '.', 'compra_diferencia', null, jsonb_build_object('hecho_fecha', p_hoy), p_ahora);
  if v_r ->> 'estado' = 'emitido' then
    for k in 1..cardinality(v_pares) loop
      perform notificacion._estado_set('dif_etapa:' || split_part(v_pares[k], ':', 1), to_jsonb(split_part(v_pares[k], ':', 2)::int));
    end loop;
  end if;
  return jsonb_build_object('emitidas', (v_r ->> 'estado' = 'emitido')::int);
end $$;

-- ---------------------------------------------------------------------------
-- Latido: lo anterior + motor de reglas + vigia del reloj. Rename + wrap sobre la definicion de F3b (misma firma, mismo retorno ampliado).
-- ---------------------------------------------------------------------------
alter function notificacion.latido(date) rename to _latido_f3b;

create function notificacion.latido(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_base jsonb; v_reglas jsonb; v_rel jsonb;
begin
  perform notificacion.exigir_sistema();
  v_base := notificacion._latido_f3b(p_hoy);
  v_reglas := notificacion.evaluar_reglas(p_hoy, null);
  v_rel := reloj.verificar(null);
  return v_base || jsonb_build_object('reglas', v_reglas, 'reloj', v_rel);
end $$;

do $$
declare f text;
begin
  foreach f in array array['notificacion.ev_cobertura_pagos(date,timestamptz,timestamptz)', 'notificacion.ev_vencimiento_proveedor(date,timestamptz,timestamptz)',
    'notificacion.ev_cobranza_vence_manana(date,timestamptz,timestamptz)', 'notificacion.ev_cuenta_vencida(date,timestamptz,timestamptz)', 'notificacion.ev_libro_no_cuadra(date,timestamptz,timestamptz)',
    'notificacion.ev_fondos_en_poder(date,timestamptz,timestamptz)', 'notificacion.ev_margen_bajo(date,timestamptz,timestamptz)', 'notificacion.ev_credito_sin_plazo(date,timestamptz,timestamptz)',
    'notificacion.ev_diferencia_recepcion(date,timestamptz,timestamptz)', 'notificacion.latido(date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to servidor', f);
  end loop;
  revoke all on function notificacion._latido_f3b(date) from public, anon, authenticated, servidor;
  revoke all on function notificacion._estado_get(text), notificacion._estado_set(text, jsonb), notificacion._fecha_desde(timestamptz), notificacion._lineas_clientes(jsonb) from public, anon, authenticated, servidor;
end $$;
