-- Carril RELOJ, puntos 2 y 5 (base): cola de envios, vaciado seguro de entregas historicas, regla "nada hacia atras", motor de reglas con interruptor propio y emision programada.
--   * notificacion.vaciar_pendientes: ANTES de dejar telegram_envio encendido, las entregas historicas pendientes (carga del 13-nov) se marcan `omitida` (idempotente, con corte).
--   * notificacion.regla: una fila por regla de aviso con su interruptor propio (TODAS apagadas) y un interruptor maestro `reglas_automaticas` (apagado). Una regla solo emite hechos
--     POSTERIORES a su activacion (`activa_desde`): al encenderla no sale nada del pasado.
--   * notificacion.emitir_programado: unica puerta de los mensajes programados y las alertas: deduplicacion por clave estable, enfriamiento por clase, techo de 6 mensajes al dia,
--     silencio de 21:00 a 07:00 (hora de Merida) salvo criticos. El modelo de IA no interviene: texto y cifras vienen de SQL o de plantillas puras.
-- Migracion ADITIVA: no redefine funciones existentes (el latido se envuelve en la migracion de evaluadores).

insert into catalogo.config (clave, valor, vigente_desde) values
  ('rep_techo_diario', '6', '2026-11-10'),
  ('rep_silencio_ini_hora', '21', '2026-11-10'),
  ('rep_silencio_fin_hora', '7', '2026-11-10'),
  ('rep_enfriamiento_horas', '{"resumen": 20, "pendientes": 20, "cobertura": 72, "vencimiento_proveedor": 20, "cobranza": 20, "libro": 6, "reloj": 3, "fondos": 72, "margen": 20, "credito": 20, "diferencia": 20, "por_omision": 20}', '2026-11-10');

insert into seguridad.interruptor (clave, activo) values ('reglas_automaticas', false) on conflict (clave) do nothing;

-- Tipos nuevos (los demas ya estan en el catalogo: resumen_diario NT-088, cobertura_pago_viernes NT-024, cobranza_vence_manana NT-035, cuenta_vencida NT-036, tarea_sin_latido NT-103...).
insert into notificacion.tipo (codigo, nt, titulo, severidad, requiere_accion, no_silenciable, canal, dominio, agrupable, ttl_horas, fase, botones, activo) values
  ('pendientes_diarios', 'NT-123', 'Pendientes del dia (09:00)', 'F', false, false, 'ST', 'REP', false, 48, 'M2b', '{}', true),
  ('vencimiento_proveedor', 'NT-124', 'Pago a proveedor por vencer o vencido', 'I', false, false, 'ST', 'COM', false, 168, 'M2b', '{}', true),
  ('libro_no_cuadra', 'NT-125', 'El libro no cuadra: comprobacion en rojo', 'C', false, false, 'ST', 'CON', false, null, 'M2b', '{}', true),
  ('margen_bajo_pedido', 'NT-126', 'Pedido con margen menor al minimo', 'I', false, false, 'ST', 'PED', false, 168, 'M2b', '{}', true),
  ('diferencia_recepcion_vieja', 'NT-127', 'Diferencia de recepcion sin resolver', 'I', false, false, 'ST', 'COM', false, 168, 'M2b', '{}', true)
  on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- Reglas con interruptor propio
-- ---------------------------------------------------------------------------
create table notificacion.regla (
  codigo text primary key,
  tipo_codigo text not null references notificacion.tipo (codigo),
  clase text not null,
  interruptor text not null unique,
  evaluador text,                         -- funcion notificacion.<evaluador>(date, timestamptz, timestamptz) -> jsonb; null = la emite una tarea de la app
  descripcion text not null,
  orden int not null default 100,
  activa_desde timestamptz,               -- primer instante en que la regla estuvo activa: solo hechos desde aqui
  ultimo_activa boolean not null default false
);
alter table notificacion.regla enable row level security;
alter table notificacion.regla force row level security;
revoke all on notificacion.regla from public, anon, authenticated;

create table notificacion.programado (
  id bigint generated always as identity primary key,
  clave text not null unique,
  clase text not null,
  codigo text not null,
  aviso_id bigint references operacion.aviso (id),
  severidad text not null,
  dia date not null,                      -- fecha de negocio (Merida) del envio previsto
  cuenta_techo boolean not null,
  creado_at timestamptz not null
);
create index programado_dia_idx on notificacion.programado (dia);
create index programado_clase_idx on notificacion.programado (clase, creado_at desc);
alter table notificacion.programado enable row level security;
alter table notificacion.programado force row level security;
revoke all on notificacion.programado from public, anon, authenticated;

create function notificacion._mxn(p_cent bigint) returns text
language sql immutable parallel safe set search_path = ''
as $$ select case when p_cent is null then 'sin dato' else (case when p_cent < 0 then '-' else '' end) || '$' || to_char(abs(p_cent)::numeric / 100, 'FM999,999,999,990.00') end $$;

-- Siembra (idempotente) de las reglas. Todas apagadas: cada interruptor nace en false.
create function notificacion.sembrar_reglas() returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform notificacion.exigir_sistema();
  insert into notificacion.regla (codigo, tipo_codigo, clase, interruptor, evaluador, descripcion, orden) values
    ('resumen_diario', 'resumen_diario', 'resumen', 'regla_resumen_diario', null, 'Resumen diario de las 20:00 (plantilla sobre agente.rep_telegram)', 10),
    ('pendientes_diarios', 'pendientes_diarios', 'pendientes', 'regla_pendientes_diarios', null, 'Pendientes de las 09:00 (plantilla sobre agente.rep_pendientes)', 20),
    ('cobertura_pagos', 'cobertura_pago_viernes', 'cobertura', 'regla_cobertura_pagos', 'ev_cobertura_pagos', 'Cobertura de pagos a proveedor menor a 1.0 (cruce de >= 1.0 a < 1.0)', 30),
    ('vencimiento_proveedor', 'vencimiento_proveedor', 'vencimiento_proveedor', 'regla_vencimiento_proveedor', 'ev_vencimiento_proveedor', 'Pago a Isaac o Karen a 3 dias del vencimiento (FIFO) o vencido', 40),
    ('cobranza_vence_manana', 'cobranza_vence_manana', 'cobranza', 'regla_cobranza_vence_manana', 'ev_cobranza_vence_manana', 'Cuentas por cobrar que vencen manana', 50),
    ('cuenta_vencida', 'cuenta_vencida', 'cobranza', 'regla_cuenta_vencida', 'ev_cuenta_vencida', 'Cuenta vencida: dia 1 y cruces de 8, 15, 30 y 60 dias de atraso', 60),
    ('libro_no_cuadra', 'libro_no_cuadra', 'libro', 'regla_libro_no_cuadra', 'ev_libro_no_cuadra', 'Cualquier comprobacion C1..C24 o CU en rojo', 70),
    ('reloj_caido', 'tarea_sin_latido', 'reloj', 'regla_reloj_caido', null, 'Reloj caido: sin latido dentro de la tolerancia (la emite reloj.verificar)', 80),
    ('fondos_en_poder', 'fondos_en_poder_socio', 'fondos', 'regla_fondos_en_poder', 'ev_fondos_en_poder', 'Fondos en poder de un socio que crecen (o pasan de la antiguedad permitida)', 90),
    ('margen_bajo', 'margen_bajo_pedido', 'margen', 'regla_margen_bajo', 'ev_margen_bajo', 'Pedido enviado con margen menor al 5 por ciento (excluye pedidos a costo del socio)', 100),
    ('credito_sin_plazo', 'credito_sin_plazo', 'credito', 'regla_credito_sin_plazo', 'ev_credito_sin_plazo', 'Pedido a credito sin plazo acordado', 110),
    ('diferencia_recepcion_vieja', 'diferencia_recepcion_vieja', 'diferencia', 'regla_diferencia_recepcion', 'ev_diferencia_recepcion', 'Diferencia de recepcion abierta a 7, 14 y 30 dias', 120)
    on conflict (codigo) do update set tipo_codigo = excluded.tipo_codigo, clase = excluded.clase, evaluador = excluded.evaluador, descripcion = excluded.descripcion, orden = excluded.orden;
  get diagnostics v_n = row_count;
  insert into seguridad.interruptor (clave, activo) select r.interruptor, false from notificacion.regla r on conflict (clave) do nothing;
  return v_n;
end $$;

-- Ventana de una regla: null si esta apagada (interruptor propio o maestro); si esta activa devuelve `activa_desde` (el instante de su activacion). Se autocorrige si el interruptor
-- se movio directo: al pasar de apagada a encendida reinicia `activa_desde` en ese momento (nada hacia atras).
create function notificacion.regla_ventana(p_regla text, p_ahora timestamptz default null) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare r notificacion.regla; v_on boolean; v_ahora timestamptz := coalesce(p_ahora, clock_timestamp());
begin
  select * into r from notificacion.regla where codigo = p_regla for update;
  if not found then return null; end if;
  v_on := reloj._interruptor('reglas_automaticas') and reloj._interruptor(r.interruptor);
  if not v_on then
    if r.ultimo_activa then update notificacion.regla set ultimo_activa = false where codigo = p_regla; end if;
    return null;
  end if;
  if not r.ultimo_activa or r.activa_desde is null then
    update notificacion.regla set activa_desde = v_ahora, ultimo_activa = true where codigo = p_regla;
    return v_ahora;
  end if;
  return r.activa_desde;
end $$;

-- Enciende o apaga UNA regla (solo sistema). Encender fija el instante desde el que cuentan los hechos.
create function notificacion.fijar_regla(p_regla text, p_activa boolean, p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r notificacion.regla;
begin
  perform notificacion.exigir_sistema();
  select * into r from notificacion.regla where codigo = p_regla;
  if not found then raise exception 'regla desconocida' using errcode = '22023'; end if;
  insert into seguridad.interruptor (clave, activo) values (r.interruptor, p_activa) on conflict (clave) do update set activo = p_activa;
  if p_activa then
    update notificacion.regla set activa_desde = coalesce(p_ahora, clock_timestamp()), ultimo_activa = true where codigo = p_regla;
  else
    update notificacion.regla set ultimo_activa = false where codigo = p_regla;
  end if;
  return jsonb_build_object('regla', p_regla, 'activa', p_activa, 'activa_desde', (select activa_desde from notificacion.regla where codigo = p_regla));
end $$;

-- ---------------------------------------------------------------------------
-- Emision programada: la unica puerta de los mensajes de reloj y de las alertas.
-- Devuelve {estado: emitido | apagada | duplicado | enfriamiento | techo, aviso_id, diferido}.
-- ---------------------------------------------------------------------------
create function notificacion.emitir_programado(p_regla text, p_clave text, p_severidad text, p_titulo text, p_texto text, p_entidad_tipo text default null, p_entidad_id bigint default null,
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
  -- 3. Techo diario (solo cuentan los que van a Telegram; un critico siempre sale y tambien cuenta).
  v_techo := (catalogo.config_valor('rep_techo_diario') #>> '{}')::int;
  select count(*) into v_n from notificacion.programado where dia = v_dia and cuenta_techo;
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

-- Motor: corre las reglas con evaluador cuyo interruptor esta encendido. Cada regla en su propio bloque: una que falle no frena a las demas.
create function notificacion.evaluar_reglas(p_hoy date default null, p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r notificacion.regla; v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); v_hoy date := coalesce(p_hoy, (coalesce(p_ahora, clock_timestamp()) at time zone 'America/Merida')::date);
  v_desde timestamptz; v_res jsonb; v_out jsonb := '{}'::jsonb;
begin
  perform notificacion.exigir_sistema();
  if not reloj._interruptor('reglas_automaticas') then return jsonb_build_object('reglas_activas', false); end if;
  for r in select * from notificacion.regla where evaluador is not null order by orden loop
    v_desde := notificacion.regla_ventana(r.codigo, v_ahora);
    continue when v_desde is null;
    begin
      execute format('select notificacion.%I($1, $2, $3)', r.evaluador) into v_res using v_hoy, v_ahora, v_desde;
      v_out := v_out || jsonb_build_object(r.codigo, v_res);
    exception when others then
      v_out := v_out || jsonb_build_object(r.codigo, jsonb_build_object('error', sqlstate));
      insert into notificacion.estado_evaluador (clave, valor) values ('error_regla:' || r.codigo, to_jsonb(left(sqlerrm, 200)))
        on conflict (clave) do update set valor = excluded.valor, actualizado_at = now();
    end;
  end loop;
  return jsonb_build_object('reglas_activas', true, 'reglas', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- Vaciado seguro de la cola historica (antes de encender telegram_envio)
-- ---------------------------------------------------------------------------
create function notificacion.vaciar_pendientes(p_aplicar boolean default false, p_corte timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_corte timestamptz := coalesce(p_corte, clock_timestamp()); v_antes jsonb; v_n int := 0; v_ids bigint[];
begin
  perform notificacion.exigir_sistema();
  select coalesce(jsonb_object_agg(estado, n), '{}'::jsonb) into v_antes from (select estado, count(*)::int as n from notificacion.entrega group by estado) q;
  select coalesce(array_agg(id order by id), '{}') into v_ids from notificacion.entrega where estado in ('pendiente', 'enviando') and creada_at <= v_corte;
  if p_aplicar and cardinality(v_ids) > 0 then
    update notificacion.entrega set estado = 'omitida', lease_hasta = null, codigo_error = 'vaciado_historico' where id = any (v_ids);
    get diagnostics v_n = row_count;
    insert into notificacion.entrega_intento (entrega_id, resultado, codigo) select unnest(v_ids), 'omitida', 'vaciado_historico';
  end if;
  return jsonb_build_object('aplicado', p_aplicar, 'por_vaciar', cardinality(v_ids), 'vaciadas', v_n, 'estados_antes', v_antes,
    'pendientes_despues', (select count(*)::int from notificacion.entrega where estado in ('pendiente', 'enviando')),
    'telegram_envio', reloj._interruptor('telegram_envio'));
end $$;

do $$
declare f text;
begin
  foreach f in array array['notificacion.sembrar_reglas()', 'notificacion.regla_ventana(text,timestamptz)', 'notificacion.fijar_regla(text,boolean,timestamptz)',
    'notificacion.emitir_programado(text,text,text,text,text,text,bigint,jsonb,timestamptz)', 'notificacion.evaluar_reglas(date,timestamptz)', 'notificacion.vaciar_pendientes(boolean,timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to servidor', f);
  end loop;
  revoke all on function notificacion._mxn(bigint) from public, anon, authenticated;
  grant execute on function notificacion._mxn(bigint) to servidor;
end $$;

select notificacion.sembrar_reglas();
