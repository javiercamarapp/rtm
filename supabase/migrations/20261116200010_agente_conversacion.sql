-- Carril bot/conversacion (decision del dueno, 14-nov): el bot PREGUNTA todo lo que falte hasta cerrar la operacion y solo escribe con todos los datos.
-- Aqui vive el ESTADO de esa conversacion: una operacion en curso por chat y autor, con sus slots llenos, los faltantes, la pregunta pendiente, el reloj de espera
-- (30 minutos de silencio = caduca; un solo recordatorio a los 15) y el ultimo mensaje.
-- ADITIVA: tabla nueva, funciones nuevas en agente.* y un interruptor nuevo (apagado). No toca funciones de negocio.
--
-- Funciones (todas security definer, search_path vacio, solo el rol servidor/postgres via notificacion.exigir_sistema, idempotentes por clave y auditadas en agente.conversacion_evento):
--   agente.conversacion_abrir             abre (o devuelve) la conversacion; si ya hay otra abierta de otra operacion devuelve 'conflicto' y guarda la nueva instruccion
--   agente.conversacion_reemplazar        cancela la abierta y abre la nueva en una sola transaccion
--   agente.conversacion_completar_slot    llena (o corrige: reescribe sin reiniciar) UN slot y recalcula los faltantes
--   agente.conversacion_fijar_pregunta    guarda la pregunta pendiente (texto, opciones, mensaje de Telegram) y el contexto de trabajo
--   agente.conversacion_cancelar          cancela con motivo
--   agente.conversacion_registrada        cierra la conversacion con el folio que dejo la operacion
--   agente.conversacion_obtener           la conversacion abierta de un chat y autor (caduca de forma perezosa)
--   agente.conversacion_expirar           reloj: caduca las vencidas y reclama los recordatorios; APAGADO por el interruptor agente_conversacion_reloj
--   agente.slots_faltantes                espejo SQL de src/dominio/agente/slots.ts (tabla agente.operacion_slot)
-- Nada de esto calcula dinero ni envia mensajes: el reloj solo DEVUELVE a quien habria que avisar; el envio vive en TypeScript y tiene su propio interruptor.

-- ---------------------------------------------------------------------------
-- Espejo SQL de los slots obligatorios por operacion
-- ---------------------------------------------------------------------------
create table agente.operacion_slot (
  operacion text not null,
  orden int not null,
  slot text not null,
  obligatorio boolean not null default true,
  -- Condicion declarativa: es obligatorio solo si el slot `si_slot` tiene alguno de `si_valor` (o, con si_valor nulo, si esta presente).
  si_slot text,
  si_valor text[],
  primary key (operacion, slot),
  unique (operacion, orden),
  check ((si_slot is null) or obligatorio)
);
alter table agente.operacion_slot enable row level security;
alter table agente.operacion_slot force row level security;
revoke all on agente.operacion_slot from public, anon, authenticated;

insert into agente.operacion_slot (operacion, orden, slot, obligatorio, si_slot, si_valor) values
  -- Ventas
  ('pedido_bodega', 1, 'cliente', true, null, null),
  ('pedido_bodega', 2, 'lineas', true, null, null),
  ('pedido_bodega', 3, 'modalidad', true, null, null),
  ('pedido_bodega', 4, 'plazo', true, 'modalidad', array['credito']),
  ('pedido_bodega', 5, 'envio', true, null, null),
  ('pedido_bodega', 6, 'destino', true, 'destino_varios', array['true']),
  ('pedido_dropshipping', 1, 'cliente', true, null, null),
  ('pedido_dropshipping', 2, 'origen', true, null, null),
  ('pedido_dropshipping', 3, 'lineas', true, null, null),
  ('pedido_dropshipping', 4, 'modalidad', true, null, null),
  ('pedido_dropshipping', 5, 'plazo', true, 'modalidad', array['credito']),
  ('pedido_dropshipping', 6, 'envio', true, null, null),
  ('pedido_a_costo', 1, 'lineas', true, null, null),
  ('pedido_a_costo', 2, 'origen', true, null, null),
  ('pedido_a_costo', 3, 'fecha_pago', true, null, null),
  -- Cobros y pagos
  ('cobro_cliente', 1, 'cliente', true, null, null),
  ('cobro_cliente', 2, 'monto', true, null, null),
  ('cobro_cliente', 3, 'cuenta', true, null, null),
  ('cobro_cliente', 4, 'pedido', true, 'pedido_varios', array['true']),
  ('cobro_cliente', 5, 'confirma_exceso', true, 'exceso', array['true']),
  ('pago_redirigido', 1, 'cliente', true, null, null),
  ('pago_redirigido', 2, 'proveedor', true, null, null),
  ('pago_redirigido', 3, 'monto', true, null, null),
  ('pago_redirigido', 4, 'pedido', true, 'pedido_varios', array['true']),
  ('pago_proveedor', 1, 'proveedor', true, null, null),
  ('pago_proveedor', 2, 'monto', true, null, null),
  ('pago_proveedor', 3, 'pagado_por', true, null, null),
  ('pago_proveedor', 4, 'intencion', true, 'pagado_por', array['angelo', 'javier']),
  -- Compras
  ('compra', 1, 'proveedor', true, null, null),
  ('compra', 2, 'lineas', true, null, null),
  ('compra', 3, 'guia_pagada_por', true, 'guia', null),
  ('recepcion_compra', 1, 'folio_compra', true, null, null),
  ('recepcion_compra', 2, 'alcance', true, null, null),
  ('recepcion_compra', 3, 'lineas', true, 'alcance', array['parcial']),
  -- Gastos
  ('gasto', 1, 'tipo_gasto', true, null, null),
  ('gasto', 2, 'monto', true, null, null),
  ('gasto', 3, 'pagado_por', true, null, null),
  -- Dinero entre socios
  ('aportacion', 1, 'socio', true, null, null),
  ('aportacion', 2, 'monto', true, null, null),
  ('aportacion', 3, 'intencion', true, null, null),
  ('deposito', 1, 'socio', true, null, null),
  ('deposito', 2, 'monto', true, null, null),
  ('deposito', 3, 'intencion', true, null, null),
  ('reembolso', 1, 'socio', true, null, null),
  ('reembolso', 2, 'monto', true, null, null),
  ('reembolso', 3, 'via', true, null, null),
  ('retiro', 1, 'socio', true, null, null),
  ('retiro', 2, 'monto', true, null, null),
  ('retiro', 3, 'via', true, null, null),
  ('entrega_fondos', 1, 'socio', true, null, null),
  ('entrega_fondos', 2, 'monto', true, null, null),
  ('entrega_fondos', 3, 'destino', true, null, null),
  ('entrega_fondos', 4, 'via', true, null, null),
  ('liquidacion', 1, 'socio', true, null, null),
  ('liquidacion', 2, 'contraparte', true, null, null),
  ('liquidacion', 3, 'monto', true, null, null),
  ('liquidacion', 4, 'via', true, null, null),
  -- Inventario
  ('conteo', 1, 'lineas', true, null, null),
  ('merma', 1, 'lineas', true, null, null),
  ('merma', 2, 'motivo', true, null, null),
  ('obsequio', 1, 'lineas', true, null, null),
  ('obsequio', 2, 'motivo', true, null, null),
  ('devolucion', 1, 'cliente', true, null, null),
  ('devolucion', 2, 'pedido_folio', true, null, null),
  ('devolucion', 3, 'lineas', true, null, null),
  ('devolucion', 4, 'destino_piezas', true, null, null),
  ('devolucion', 5, 'motivo', true, null, null),
  -- Catalogo
  ('alta_cliente', 1, 'nombre', true, null, null),
  ('alta_cliente', 2, 'tipo_cliente', true, null, null),
  ('alta_sabor', 1, 'nombre', true, null, null),
  ('alta_modelo', 1, 'nombre', true, null, null),
  ('alta_modelo', 2, 'marca', true, null, null),
  ('alta_modelo', 3, 'costo', true, null, null);

-- Devuelve las claves de slot obligatorios que todavia no tienen valor, en el orden en que se preguntan.
create function agente.slots_faltantes(p_operacion text, p_slots jsonb) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare v_res text[];
begin
  perform notificacion.exigir_sistema();
  if not exists (select 1 from agente.operacion_slot where operacion = p_operacion) then
    raise exception 'operacion desconocida: %', p_operacion using errcode = 'P0470';
  end if;
  select coalesce(array_agg(s.slot order by s.orden), '{}') into v_res
    from agente.operacion_slot s
   where s.operacion = p_operacion and s.obligatorio
     and (s.si_slot is null
          or (s.si_valor is null and coalesce(p_slots -> s.si_slot, 'null'::jsonb) not in ('null'::jsonb, '""'::jsonb))
          or (s.si_valor is not null and (p_slots ->> s.si_slot) = any (s.si_valor)))
     and coalesce(p_slots -> s.slot, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Conversacion
-- ---------------------------------------------------------------------------
create table agente.conversacion (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  autor text not null check (autor in ('angelo', 'javier', 'omar')),
  operacion text not null,
  estado text not null default 'abierta' check (estado in ('abierta', 'completa', 'registrada', 'cancelada', 'expirada')),
  slots jsonb not null default '{}'::jsonb check (jsonb_typeof(slots) = 'object'),
  faltantes text[] not null default '{}',
  -- Pregunta pendiente: el slot que se pregunta, el texto enviado, los botones (opciones cerradas) y el mensaje de Telegram para ligar la respuesta (reply_to_message).
  pregunta_slot text,
  pregunta_texto text,
  pregunta_opciones jsonb,
  pregunta_mensaje_id bigint,
  -- Estado de trabajo de la maquina (desambiguaciones, montos por confirmar, texto crudo por resolver). Nunca dinero calculado por IA.
  contexto jsonb not null default '{}'::jsonb check (jsonb_typeof(contexto) = 'object'),
  -- Nueva instruccion que llego mientras habia una pregunta pendiente (se conserva hasta que el socio decida si cancela la anterior).
  reemplazo jsonb,
  ultimo_mensaje text,
  ultimo_mensaje_id bigint,
  ultimo_mensaje_at timestamptz,
  abierta_at timestamptz not null default clock_timestamp(),
  actualizada_at timestamptz not null default clock_timestamp(),
  espera_minutos int not null default 30 check (espera_minutos between 1 and 1440),
  expira_at timestamptz not null,
  recordatorio_at timestamptz,
  cerrada_at timestamptz,
  folio_registro text,
  motivo_cierre text,
  clave_idem text not null unique,
  check ((estado = 'registrada') = (folio_registro is not null)),
  check ((estado in ('abierta', 'completa')) = (cerrada_at is null))
);
alter table agente.conversacion enable row level security;
alter table agente.conversacion force row level security;
revoke all on agente.conversacion from public, anon, authenticated;
-- Una sola conversacion viva por chat y autor.
create unique index conversacion_viva_uq on agente.conversacion (chat_id, autor) where estado in ('abierta', 'completa');
create index conversacion_expira_idx on agente.conversacion (expira_at) where estado in ('abierta', 'completa');

-- Auditoria e idempotencia: una fila por llamada que muta, con la clave de la llamada y lo que se devolvio.
create table agente.conversacion_evento (
  clave_idem text primary key,
  conversacion_id bigint references agente.conversacion(id),
  tipo text not null check (tipo in ('abrir', 'conflicto', 'reemplazar', 'slot', 'correccion', 'pregunta', 'cancelar', 'registrada', 'expirada', 'recordatorio')),
  slot text,
  detalle jsonb not null default '{}'::jsonb,
  resultado jsonb,
  creado_at timestamptz not null default clock_timestamp()
);
alter table agente.conversacion_evento enable row level security;
alter table agente.conversacion_evento force row level security;
revoke all on agente.conversacion_evento from public, anon, authenticated;
create index conversacion_evento_conv_idx on agente.conversacion_evento (conversacion_id, creado_at);

-- Solo el reloj de la conversacion (apagado: nadie lo enciende en produccion sin orden del dueno).
insert into seguridad.interruptor (clave, activo) values ('agente_conversacion_reloj', false) on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Ayudas internas
-- ---------------------------------------------------------------------------
create function agente._conv_json(p_id bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'chat_id', c.chat_id, 'autor', c.autor, 'operacion', c.operacion, 'estado', c.estado,
    'slots', c.slots, 'faltantes', to_jsonb(c.faltantes), 'siguiente', c.faltantes[1],
    'pregunta', case when c.pregunta_slot is null and c.pregunta_texto is null then null
                     else jsonb_build_object('slot', c.pregunta_slot, 'texto', c.pregunta_texto, 'opciones', c.pregunta_opciones, 'mensaje_id', c.pregunta_mensaje_id) end,
    'contexto', c.contexto, 'reemplazo', c.reemplazo,
    'ultimo_mensaje_id', c.ultimo_mensaje_id, 'abierta_at', c.abierta_at, 'actualizada_at', c.actualizada_at, 'expira_at', c.expira_at,
    'recordatorio_enviado', c.recordatorio_at is not null, 'folio_registro', c.folio_registro, 'motivo_cierre', c.motivo_cierre)
  from agente.conversacion c where c.id = p_id
$$;

-- Caduca de forma perezosa la conversacion viva de un chat y autor si ya paso su espera. Devuelve su id si la caduco.
create function agente._conv_caducar_si_vencida(p_chat bigint, p_autor text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  update agente.conversacion set estado = 'expirada', cerrada_at = clock_timestamp(), motivo_cierre = 'sin respuesta en ' || espera_minutos || ' minutos'
   where chat_id = p_chat and autor = p_autor and estado in ('abierta', 'completa') and expira_at <= clock_timestamp()
   returning id into v_id;
  if v_id is not null then
    insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle) values ('conv:exp:' || v_id, v_id, 'expirada', jsonb_build_object('via', 'perezosa')) on conflict do nothing;
  end if;
  return v_id;
end $$;

create function agente._conv_evento_previo(p_clave text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select resultado from agente.conversacion_evento where clave_idem = p_clave $$;

create function agente._conv_validar_slots(p_slots jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_slots is null or jsonb_typeof(p_slots) <> 'object' then raise exception 'los slots deben ser un objeto' using errcode = 'P0470'; end if;
  if pg_column_size(p_slots) > 65536 then raise exception 'la conversacion es demasiado grande' using errcode = 'P0470'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Abrir / reemplazar
-- ---------------------------------------------------------------------------
create function agente.conversacion_abrir(p_clave_idem text, p_chat_id bigint, p_autor text, p_operacion text, p_slots jsonb default '{}'::jsonb,
                                          p_contexto jsonb default '{}'::jsonb, p_mensaje text default null, p_mensaje_id bigint default null,
                                          p_espera_minutos int default 30) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_viva agente.conversacion; v_id bigint; v_falt text[]; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  if nullif(btrim(p_clave_idem), '') is null then raise exception 'falta la clave de idempotencia' using errcode = 'P0470'; end if;
  v_prev := agente._conv_evento_previo(p_clave_idem);
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform agente._conv_validar_slots(coalesce(p_slots, '{}'::jsonb));
  if p_autor not in ('angelo', 'javier', 'omar') then raise exception 'autor desconocido' using errcode = 'P0470'; end if;
  v_falt := agente.slots_faltantes(p_operacion, coalesce(p_slots, '{}'::jsonb));
  perform agente._conv_caducar_si_vencida(p_chat_id, p_autor);
  select * into v_viva from agente.conversacion where chat_id = p_chat_id and autor = p_autor and estado in ('abierta', 'completa') for update;
  if found then
    -- Ya hay una pregunta abierta. La nueva instruccion NO se pierde ni cancela a la anterior: queda guardada para que el socio decida.
    update agente.conversacion
       set reemplazo = jsonb_build_object('operacion', p_operacion, 'slots', coalesce(p_slots, '{}'::jsonb), 'contexto', coalesce(p_contexto, '{}'::jsonb),
                                          'mensaje', left(p_mensaje, 500), 'mensaje_id', p_mensaje_id)
     where id = v_viva.id;
    v_res := jsonb_build_object('estado', 'conflicto', 'abierta', agente._conv_json(v_viva.id));
    v_res := jsonb_set(v_res, '{abierta}', agente._conv_json(v_viva.id));
    insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle, resultado)
      values (p_clave_idem, v_viva.id, 'conflicto', jsonb_build_object('nueva_operacion', p_operacion), v_res);
    return v_res;
  end if;
  insert into agente.conversacion (chat_id, autor, operacion, estado, slots, faltantes, contexto, ultimo_mensaje, ultimo_mensaje_id, ultimo_mensaje_at, espera_minutos, expira_at, clave_idem)
    values (p_chat_id, p_autor, p_operacion, case when cardinality(v_falt) = 0 then 'completa' else 'abierta' end, coalesce(p_slots, '{}'::jsonb), v_falt,
            coalesce(p_contexto, '{}'::jsonb), left(p_mensaje, 500), p_mensaje_id, case when p_mensaje is not null then clock_timestamp() end,
            p_espera_minutos, clock_timestamp() + make_interval(mins => p_espera_minutos), p_clave_idem)
    returning id into v_id;
  v_res := jsonb_build_object('estado', 'abierta', 'conversacion', agente._conv_json(v_id));
  insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle, resultado)
    values (p_clave_idem, v_id, 'abrir', jsonb_build_object('operacion', p_operacion, 'faltantes', to_jsonb(v_falt)), v_res);
  return v_res;
end $$;

-- El socio dijo "si, cancela la anterior": cierra la viva y abre la nueva (la que quedo en `reemplazo`, o la que se pase) en una sola transaccion.
create function agente.conversacion_reemplazar(p_clave_idem text, p_chat_id bigint, p_autor text, p_operacion text default null, p_slots jsonb default null,
                                               p_contexto jsonb default null, p_mensaje_id bigint default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_viva agente.conversacion; v_op text; v_slots jsonb; v_ctx jsonb; v_msg text; v_mid bigint; v_id bigint; v_falt text[]; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_prev := agente._conv_evento_previo(p_clave_idem);
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into v_viva from agente.conversacion where chat_id = p_chat_id and autor = p_autor and estado in ('abierta', 'completa') for update;
  if not found then raise exception 'no hay una conversacion abierta que reemplazar' using errcode = 'P0470'; end if;
  v_op := coalesce(p_operacion, v_viva.reemplazo ->> 'operacion');
  v_slots := coalesce(p_slots, v_viva.reemplazo -> 'slots', '{}'::jsonb);
  v_ctx := coalesce(p_contexto, v_viva.reemplazo -> 'contexto', '{}'::jsonb);
  v_msg := v_viva.reemplazo ->> 'mensaje';
  v_mid := coalesce(p_mensaje_id, (v_viva.reemplazo ->> 'mensaje_id')::bigint);
  if v_op is null then raise exception 'no hay una instruccion nueva guardada' using errcode = 'P0470'; end if;
  perform agente._conv_validar_slots(v_slots);
  v_falt := agente.slots_faltantes(v_op, v_slots);
  update agente.conversacion set estado = 'cancelada', cerrada_at = clock_timestamp(), motivo_cierre = 'reemplazada por una instruccion nueva', reemplazo = null where id = v_viva.id;
  insert into agente.conversacion (chat_id, autor, operacion, estado, slots, faltantes, contexto, ultimo_mensaje, ultimo_mensaje_id, ultimo_mensaje_at, espera_minutos, expira_at, clave_idem)
    values (p_chat_id, p_autor, v_op, case when cardinality(v_falt) = 0 then 'completa' else 'abierta' end, v_slots, v_falt, v_ctx, left(v_msg, 500), v_mid,
            case when v_msg is not null then clock_timestamp() end, v_viva.espera_minutos, clock_timestamp() + make_interval(mins => v_viva.espera_minutos), p_clave_idem)
    returning id into v_id;
  v_res := jsonb_build_object('estado', 'abierta', 'cancelada_id', v_viva.id, 'conversacion', agente._conv_json(v_id));
  insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle, resultado)
    values (p_clave_idem, v_id, 'reemplazar', jsonb_build_object('operacion', v_op, 'cancelada_id', v_viva.id, 'operacion_anterior', v_viva.operacion), v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Completar o corregir un slot (reescribe sin reiniciar)
-- ---------------------------------------------------------------------------
create function agente.conversacion_completar_slot(p_clave_idem text, p_id bigint, p_slot text, p_valor jsonb, p_mensaje text default null, p_mensaje_id bigint default null,
                                                   p_contexto jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c agente.conversacion; v_slots jsonb; v_falt text[]; v_tipo text; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_prev := agente._conv_evento_previo(p_clave_idem);
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into c from agente.conversacion where id = p_id for update;
  if not found then raise exception 'conversacion desconocida' using errcode = 'P0470'; end if;
  if nullif(btrim(p_slot), '') is null then raise exception 'falta el slot' using errcode = 'P0470'; end if;
  if c.estado in ('abierta', 'completa') and c.expira_at <= clock_timestamp() then
    perform agente._conv_caducar_si_vencida(c.chat_id, c.autor);
    return jsonb_build_object('estado', 'expirada', 'conversacion', agente._conv_json(c.id));
  end if;
  if c.estado not in ('abierta', 'completa') then
    return jsonb_build_object('estado', c.estado, 'conversacion', agente._conv_json(c.id));
  end if;
  v_tipo := case when c.slots ? p_slot and coalesce(c.slots -> p_slot, 'null'::jsonb) <> 'null'::jsonb then 'correccion' else 'slot' end;
  v_slots := case when p_valor is null or p_valor = 'null'::jsonb then c.slots - p_slot else jsonb_set(c.slots, array[p_slot], p_valor, true) end;
  perform agente._conv_validar_slots(v_slots);
  v_falt := agente.slots_faltantes(c.operacion, v_slots);
  update agente.conversacion
     set slots = v_slots, faltantes = v_falt, estado = case when cardinality(v_falt) = 0 then 'completa' else 'abierta' end,
         contexto = coalesce(p_contexto, contexto),
         pregunta_slot = case when pregunta_slot = p_slot then null else pregunta_slot end,
         pregunta_texto = case when pregunta_slot = p_slot then null else pregunta_texto end,
         pregunta_opciones = case when pregunta_slot = p_slot then null else pregunta_opciones end,
         pregunta_mensaje_id = case when pregunta_slot = p_slot then null else pregunta_mensaje_id end,
         reemplazo = null,
         ultimo_mensaje = coalesce(left(p_mensaje, 500), ultimo_mensaje), ultimo_mensaje_id = coalesce(p_mensaje_id, ultimo_mensaje_id),
         ultimo_mensaje_at = case when p_mensaje is not null or p_mensaje_id is not null then clock_timestamp() else ultimo_mensaje_at end,
         actualizada_at = clock_timestamp(), expira_at = clock_timestamp() + make_interval(mins => espera_minutos), recordatorio_at = null
   where id = c.id;
  v_res := jsonb_build_object('estado', (select estado from agente.conversacion where id = c.id), 'conversacion', agente._conv_json(c.id));
  insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, slot, detalle, resultado)
    values (p_clave_idem, c.id, v_tipo, p_slot, jsonb_build_object('antes', c.slots -> p_slot, 'despues', p_valor), v_res);
  return v_res;
end $$;

-- Guarda la pregunta que el bot acaba de hacer (y el contexto de trabajo). No cuenta como actividad del socio: no reinicia la espera.
create function agente.conversacion_fijar_pregunta(p_clave_idem text, p_id bigint, p_slot text, p_texto text, p_opciones jsonb default null, p_contexto jsonb default null,
                                                   p_mensaje_id bigint default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c agente.conversacion; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_prev := agente._conv_evento_previo(p_clave_idem);
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into c from agente.conversacion where id = p_id for update;
  if not found then raise exception 'conversacion desconocida' using errcode = 'P0470'; end if;
  if c.estado not in ('abierta', 'completa') then return jsonb_build_object('estado', c.estado, 'conversacion', agente._conv_json(c.id)); end if;
  update agente.conversacion
     set pregunta_slot = p_slot, pregunta_texto = left(p_texto, 1000), pregunta_opciones = p_opciones, pregunta_mensaje_id = p_mensaje_id, contexto = coalesce(p_contexto, contexto)
   where id = c.id;
  v_res := jsonb_build_object('estado', c.estado, 'conversacion', agente._conv_json(c.id));
  insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, slot, detalle, resultado)
    values (p_clave_idem, c.id, 'pregunta', p_slot, jsonb_build_object('mensaje_id', p_mensaje_id), v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Cancelar, cerrar con folio, obtener
-- ---------------------------------------------------------------------------
create function agente.conversacion_cancelar(p_clave_idem text, p_id bigint, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c agente.conversacion; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_prev := agente._conv_evento_previo(p_clave_idem);
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into c from agente.conversacion where id = p_id for update;
  if not found then raise exception 'conversacion desconocida' using errcode = 'P0470'; end if;
  if c.estado not in ('abierta', 'completa') then return jsonb_build_object('estado', c.estado, 'conversacion', agente._conv_json(c.id)); end if;
  update agente.conversacion set estado = 'cancelada', cerrada_at = clock_timestamp(), motivo_cierre = coalesce(nullif(btrim(p_motivo), ''), 'cancelada por el socio'), reemplazo = null where id = c.id;
  v_res := jsonb_build_object('estado', 'cancelada', 'conversacion', agente._conv_json(c.id));
  insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle, resultado) values (p_clave_idem, c.id, 'cancelar', jsonb_build_object('motivo', p_motivo), v_res);
  return v_res;
end $$;

create function agente.conversacion_registrada(p_clave_idem text, p_id bigint, p_folio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c agente.conversacion; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_prev := agente._conv_evento_previo(p_clave_idem);
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if nullif(btrim(p_folio), '') is null then raise exception 'falta el folio con el que quedo registrada' using errcode = 'P0470'; end if;
  select * into c from agente.conversacion where id = p_id for update;
  if not found then raise exception 'conversacion desconocida' using errcode = 'P0470'; end if;
  if c.estado <> 'completa' then raise exception 'solo se registra una conversacion completa (estado: %)', c.estado using errcode = 'P0470'; end if;
  update agente.conversacion set estado = 'registrada', cerrada_at = clock_timestamp(), folio_registro = btrim(p_folio), pregunta_slot = null, pregunta_texto = null, pregunta_opciones = null,
         pregunta_mensaje_id = null, reemplazo = null where id = c.id;
  v_res := jsonb_build_object('estado', 'registrada', 'conversacion', agente._conv_json(c.id));
  insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle, resultado) values (p_clave_idem, c.id, 'registrada', jsonb_build_object('folio', p_folio), v_res);
  return v_res;
end $$;

create function agente.conversacion_obtener(p_chat_id bigint, p_autor text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform notificacion.exigir_sistema();
  perform agente._conv_caducar_si_vencida(p_chat_id, p_autor);
  select id into v_id from agente.conversacion where chat_id = p_chat_id and autor = p_autor and estado in ('abierta', 'completa');
  return case when v_id is null then null else agente._conv_json(v_id) end;
end $$;

-- ---------------------------------------------------------------------------
-- Reloj: caducidad y recordatorio unico. Apagado por el interruptor; con el apagado no hace nada y lo dice.
-- Devuelve a quien habria que avisar; NO envia nada (el envio vive en TypeScript, con su propio interruptor).
-- ---------------------------------------------------------------------------
create function agente.conversacion_expirar(p_ahora timestamptz default null, p_recordatorio_minutos int default 15) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); r record; v_exp jsonb := '[]'::jsonb; v_rec jsonb := '[]'::jsonb;
begin
  perform notificacion.exigir_sistema();
  if not coalesce((select activo from seguridad.interruptor where clave = 'agente_conversacion_reloj'), false) then
    return jsonb_build_object('estado', 'apagado', 'expiradas', '[]'::jsonb, 'recordatorios', '[]'::jsonb);
  end if;
  for r in select * from agente.conversacion where estado in ('abierta', 'completa') and expira_at <= v_ahora order by id for update skip locked loop
    update agente.conversacion set estado = 'expirada', cerrada_at = v_ahora, motivo_cierre = 'sin respuesta en ' || espera_minutos || ' minutos' where id = r.id;
    insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle) values ('conv:exp:' || r.id, r.id, 'expirada', jsonb_build_object('via', 'reloj')) on conflict do nothing;
    v_exp := v_exp || jsonb_build_array(jsonb_build_object('id', r.id, 'chat_id', r.chat_id, 'autor', r.autor, 'operacion', r.operacion, 'pregunta', r.pregunta_texto));
  end loop;
  -- Recordatorio unico: pasaron `p_recordatorio_minutos` sin respuesta, la conversacion sigue abierta y todavia no se recordo.
  for r in select * from agente.conversacion
            where estado = 'abierta' and recordatorio_at is null and pregunta_slot is not null and actualizada_at + make_interval(mins => p_recordatorio_minutos) <= v_ahora
            order by id for update skip locked loop
    update agente.conversacion set recordatorio_at = v_ahora where id = r.id;
    insert into agente.conversacion_evento (clave_idem, conversacion_id, tipo, detalle) values ('conv:rec:' || r.id, r.id, 'recordatorio', jsonb_build_object('minutos', p_recordatorio_minutos)) on conflict do nothing;
    v_rec := v_rec || jsonb_build_array(jsonb_build_object('id', r.id, 'chat_id', r.chat_id, 'autor', r.autor, 'operacion', r.operacion, 'pregunta', r.pregunta_texto,
                                                           'mensaje_id', r.pregunta_mensaje_id, 'expira_at', r.expira_at));
  end loop;
  return jsonb_build_object('estado', 'activo', 'expiradas', v_exp, 'recordatorios', v_rec);
end $$;

-- Permisos: nada para public/anon/authenticated; solo el rol servidor (el bot).
revoke all on function agente.slots_faltantes(text, jsonb), agente._conv_json(bigint), agente._conv_caducar_si_vencida(bigint, text), agente._conv_evento_previo(text), agente._conv_validar_slots(jsonb),
  agente.conversacion_abrir(text, bigint, text, text, jsonb, jsonb, text, bigint, int), agente.conversacion_reemplazar(text, bigint, text, text, jsonb, jsonb, bigint),
  agente.conversacion_completar_slot(text, bigint, text, jsonb, text, bigint, jsonb), agente.conversacion_fijar_pregunta(text, bigint, text, text, jsonb, jsonb, bigint),
  agente.conversacion_cancelar(text, bigint, text), agente.conversacion_registrada(text, bigint, text), agente.conversacion_obtener(bigint, text),
  agente.conversacion_expirar(timestamptz, int) from public, anon, authenticated;
grant execute on function agente.slots_faltantes(text, jsonb), agente.conversacion_abrir(text, bigint, text, text, jsonb, jsonb, text, bigint, int), agente.conversacion_reemplazar(text, bigint, text, text, jsonb, jsonb, bigint),
  agente.conversacion_completar_slot(text, bigint, text, jsonb, text, bigint, jsonb), agente.conversacion_fijar_pregunta(text, bigint, text, text, jsonb, jsonb, bigint),
  agente.conversacion_cancelar(text, bigint, text), agente.conversacion_registrada(text, bigint, text), agente.conversacion_obtener(bigint, text),
  agente.conversacion_expirar(timestamptz, int) to servidor;
