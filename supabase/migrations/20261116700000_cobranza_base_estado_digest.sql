-- Carril COBRANZA (bot de Telegram), parte 1: esquema cobranza.*, estado derivado por pedido, vencimiento efectivo, recargo con extension explicita y digest diario.
-- Diseno: 03-recordatorios-cobranza.md adaptado a las decisiones del dueno (14-nov): sin topes ni tarjetas de confirmacion (el bot pregunta lo que falte), el modelo de IA nunca calcula dinero
-- (SQL pone saldos, reparto, recargo y fechas de promesa; el codigo de TypeScript interpreta las fechas), el bot solo habla al grupo de los socios (nunca a clientes), todo APAGADO por interruptor.
-- ADITIVA: esquema nuevo; unica funcion existente tocada: operacion.recargo_sugerido (rename + wrap sobre la definicion vigente de 20261116500400) para que una extension de plazo explicita mueva el inicio del recargo.
-- Interruptor `cobranza_activa` NACE APAGADO: apagado, el reloj no reclama ni arma ningun envio. El envio real a Telegram lo hace TypeScript con el transporte del bot (aqui nunca sale un mensaje).

insert into seguridad.interruptor (clave, activo) values ('cobranza_activa', false) on conflict (clave) do nothing;

create schema if not exists cobranza;
grant usage on schema cobranza to servidor;
-- Folio propio COB-0001 (no se toca el CHECK compartido de seguridad.contador_folio, que otros carriles tambien amplian).
create sequence cobranza.folio_seq;

-- ---------------------------------------------------------------- parametros (una fila)
create table cobranza.config (
  id smallint primary key default 1 check (id = 1),
  hora_digest time not null default '09:00',
  hora_cierre time not null default '17:00',
  pre_aviso_dias int not null default 1 check (pre_aviso_dias between 0 and 7),
  cierre_17h boolean not null default true,
  compacto_desde_dia int not null default 4 check (compacto_desde_dia between 2 and 30),
  pausa_max_dias int not null default 60 check (pausa_max_dias between 1 and 365),
  max_caracteres int not null default 3500 check (max_caracteres between 500 and 4000),
  ventana_conflicto_horas int not null default 24 check (ventana_conflicto_horas between 1 and 168)
);
insert into cobranza.config (id) values (1);

-- ---------------------------------------------------------------- seguimiento por pedido
create table cobranza.seguimiento (
  pedido_id bigint primary key references operacion.pedido (id),
  estado_manual text check (estado_manual is null or estado_manual = 'disputado'),
  disputa_motivo text check (disputa_motivo is null or length(disputa_motivo) between 3 and 300),
  pausa_hasta date,
  promesa_fecha date,
  promesa_contada boolean not null default false,
  promesas_incumplidas int not null default 0 check (promesas_incumplidas >= 0),
  ultima_respuesta text,
  ultima_respuesta_at timestamptz,
  ultima_respuesta_por text,
  ignorados_consecutivos int not null default 0 check (ignorados_consecutivos >= 0),
  recordatorios_enviados int not null default 0 check (recordatorios_enviados >= 0),
  ultimo_aviso_fecha date,
  actualizado_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------- respuestas (append-only: el deshacer es un contra-registro)
create table cobranza.respuesta (
  id bigint generated always as identity primary key,
  folio text not null unique,
  pedido_id bigint references operacion.pedido (id),
  cliente_id bigint not null references catalogo.cliente (id),
  accion text not null check (accion in ('pago_total', 'pago_parcial', 'prometio', 'se_atrasa', 'aun_no', 'disputa', 'pausa', 'reanudar', 'extender_plazo', 'deshacer')),
  params jsonb not null default '{}'::jsonb,
  antes jsonb not null default '{}'::jsonb,
  socio text not null check (socio in ('angelo', 'javier')),
  texto_cita text check (texto_cita is null or length(texto_cita) <= 200),
  clave_idem text not null unique,
  revierte_id bigint references cobranza.respuesta (id),
  pago_folio text,
  creado_at timestamptz not null default clock_timestamp()
);
create index respuesta_cliente_idx on cobranza.respuesta (cliente_id, creado_at);
create index respuesta_pedido_idx on cobranza.respuesta (pedido_id, creado_at);
create unique index respuesta_revierte_uq on cobranza.respuesta (revierte_id) where revierte_id is not null;

create function cobranza._solo_anexar() returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'cobranza.respuesta es de solo anexar: se corrige con un contra-registro' using errcode = 'P0460'; end $$;
create trigger respuesta_solo_anexar before update or delete on cobranza.respuesta for each row execute function cobranza._solo_anexar();

-- Plazo contractual extendido por decision explicita del socio dueno del cliente (nunca se toca pedido.plazo_dias).
create table cobranza.extension_plazo (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  dias int not null check (dias between 1 and 365),
  motivo text check (motivo is null or length(motivo) <= 300),
  decidido_por text not null check (decidido_por in ('angelo', 'javier')),
  respuesta_id bigint references cobranza.respuesta (id),
  recargo_aplicado_antes_cent bigint not null default 0,
  anulada_at timestamptz,
  creado_at timestamptz not null default clock_timestamp()
);
create index extension_plazo_pedido_idx on cobranza.extension_plazo (pedido_id) where anulada_at is null;

-- Un envio por (dia de negocio, tipo): la idempotencia del reloj.
create table cobranza.digest (
  id bigint generated always as identity primary key,
  fecha_negocio date not null,
  tipo text not null check (tipo in ('am', 'cierre')),
  estado text not null default 'reclamado' check (estado in ('reclamado', 'enviado', 'fallido')),
  texto text not null,
  intentos int not null default 1,
  telegram_message_id bigint,
  error text check (error is null or length(error) <= 300),
  ignorados_procesado boolean not null default false,
  reclamado_at timestamptz not null default clock_timestamp(),
  enviado_at timestamptz,
  unique (fecha_negocio, tipo)
);
create table cobranza.digest_linea (
  digest_id bigint not null references cobranza.digest (id),
  pedido_id bigint not null references operacion.pedido (id),
  cliente_id bigint not null references catalogo.cliente (id),
  seccion text not null,
  nivel int not null,
  formato text not null check (formato in ('tarjeta', 'compacta', 'linea')),
  saldo_cent bigint not null,
  primary key (digest_id, pedido_id)
);

-- Pregunta que el bot dejo abierta en un chat (que falta para cerrar la respuesta): el servidor la recuerda, el modelo de IA nunca pone ids.
create table cobranza.espera (
  chat_id bigint primary key,
  cliente_id bigint not null references catalogo.cliente (id),
  accion text not null,
  datos jsonb not null default '{}'::jsonb,
  falta text not null,
  abierta_por text not null check (abierta_por in ('angelo', 'javier')),
  expira_at timestamptz not null
);

create table cobranza.dia_inhabil (fecha date primary key, nombre text not null check (length(nombre) between 1 and 80));

do $$
declare t text;
begin
  foreach t in array array['config', 'seguimiento', 'respuesta', 'extension_plazo', 'digest', 'digest_linea', 'espera', 'dia_inhabil'] loop
    execute format('alter table cobranza.%I enable row level security', t);
    execute format('alter table cobranza.%I force row level security', t);
    execute format('revoke all on cobranza.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- utilidades de formato
create function cobranza._fecha_txt(p_fecha date) returns text
language sql immutable set search_path = ''
as $$
  select (array['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'])[extract(dow from p_fecha)::int + 1]
         || ' ' || extract(day from p_fecha)::int || '-' || (array['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'])[extract(month from p_fecha)::int]
$$;

create function cobranza._pesos(p_cent numeric) returns text
language sql immutable set search_path = ''
as $$ select '$' || operacion.fmt_pesos(p_cent::bigint) $$;

create function cobranza._dias_txt(p_dias int) returns text
language sql immutable set search_path = ''
as $$ select p_dias || case when p_dias = 1 then ' día' else ' días' end $$;

-- "Hoy" de la cobranza. Solo el rol propietario (las pruebas) puede fijarlo con args.hoy para simular un calendario; el servidor siempre usa la fecha de Merida.
create function cobranza._hoy(p_args jsonb default null) returns date
language sql stable set search_path = ''
as $$
  select coalesce(case when session_user = 'postgres' and coalesce(p_args ->> 'hoy', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_args ->> 'hoy')::date end, negocio.hoy())
$$;

create function cobranza.es_inhabil(p_fecha date) returns boolean
language sql stable security definer set search_path = ''
as $$ select extract(dow from p_fecha) in (0, 6) or exists (select 1 from cobranza.dia_inhabil d where d.fecha = p_fecha) $$;

-- ---------------------------------------------------------------- vencimiento efectivo y estado derivado
-- fecha_envio + plazo_dias + extensiones vigentes. null si el pedido no tiene plazo (todo credito exige plazo: P0436).
create function cobranza.vence_efectivo(p_pedido bigint) returns date
language sql stable security definer set search_path = ''
as $$
  select case when pe.plazo_dias is null or pe.fecha_envio is null then null
              else pe.fecha_envio + pe.plazo_dias + coalesce((select sum(x.dias) from cobranza.extension_plazo x where x.pedido_id = pe.id and x.anulada_at is null), 0)::int end
    from operacion.pedido pe where pe.id = p_pedido
$$;

-- Estado derivado del saldo y del seguimiento. Precedencia: pagado, disputado, pausado, prometido, sin_plazo, vence_hoy, vencido, por_vencer, al_corriente.
create function cobranza.estado_pedido(p_pedido bigint, p_hoy date default null) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  pe operacion.pedido; sg cobranza.seguimiento; c cobranza.config; v_hoy date := coalesce(p_hoy, negocio.hoy()); v_saldo bigint; v_vence date;
begin
  select * into pe from operacion.pedido where id = p_pedido;
  if not found then return null; end if;
  select * into c from cobranza.config where id = 1;
  v_saldo := operacion.pedido_saldo(pe.id);
  if pe.estado <> 'enviado' or coalesce(v_saldo, 0) <= 0 then return 'pagado'; end if;
  select * into sg from cobranza.seguimiento where pedido_id = pe.id;
  if sg.estado_manual = 'disputado' then return 'disputado'; end if;
  if sg.pausa_hasta is not null and sg.pausa_hasta >= v_hoy then return 'pausado'; end if;
  if sg.promesa_fecha is not null and sg.promesa_fecha >= v_hoy then return 'prometido'; end if;
  v_vence := cobranza.vence_efectivo(pe.id);
  if v_vence is null then return 'sin_plazo'; end if;
  if v_hoy = v_vence then return 'vence_hoy'; end if;
  if v_hoy > v_vence then return 'vencido'; end if;
  if v_vence - v_hoy <= c.pre_aviso_dias then return 'por_vencer'; end if;
  -- Vence en dia inhabil (sabado, domingo, festivo): el aviso previo sale tambien el ultimo dia habil anterior.
  if cobranza.es_inhabil(v_vence) and not cobranza.es_inhabil(v_hoy)
     and not exists (select 1 from generate_series(v_hoy + 1, v_vence - 1, interval '1 day') g where not cobranza.es_inhabil(g::date)) then return 'por_vencer'; end if;
  return 'al_corriente';
end $$;

-- ---------------------------------------------------------------- recargo: una extension explicita mueve el inicio del recargo (envoltorio de la definicion vigente)
alter function operacion.recargo_sugerido(bigint, date) rename to _recargo_sugerido_sin_extension;
revoke all on function operacion._recargo_sugerido_sin_extension(bigint, date) from public, anon, authenticated, servidor;
create function operacion.recargo_sugerido(p_pedido bigint, p_fecha date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ext int; r jsonb; v_vence date;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion', 'sistema']);
  select coalesce(sum(x.dias), 0)::int into v_ext from cobranza.extension_plazo x where x.pedido_id = p_pedido and x.anulada_at is null;
  -- Con extension de E dias, el pedido se comporta como si hoy fuera E dias antes: mismos 10 % simple por semana COMPLETA, contados desde el vencimiento extendido.
  r := operacion._recargo_sugerido_sin_extension(p_pedido, v_fecha - v_ext);
  if v_ext = 0 or r ->> 'vence' is null then return r; end if;
  v_vence := (r ->> 'vence')::date + v_ext;
  return r || jsonb_build_object('fecha', v_fecha, 'vence', v_vence, 'dias_atraso', greatest(v_fecha - v_vence, 0), 'extension_dias', v_ext);
end $$;
revoke all on function operacion.recargo_sugerido(bigint, date) from public, anon, authenticated;
grant execute on function operacion.recargo_sugerido(bigint, date) to authenticated;

-- ---------------------------------------------------------------- cola de cobranza de un dia (una fila por pedido con saldo; el agrupado por cliente lo hace armar_digest)
create function cobranza._cola(p_hoy date, p_tipo text default 'am') returns table (
  pedido_id bigint, folio text, cliente_id bigint, cliente text, duenio text, saldo_cent bigint, vence date, estado text, dias_vencido int, ignorados int,
  promesa_fecha date, promesa_incumplida boolean, termino_pausa boolean, nivel int, seccion text, formato text,
  semanas int, recargo_pendiente_cent bigint, sin_plazo_a_costo boolean, respondio_hoy boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare c cobranza.config; v_lunes boolean := extract(dow from p_hoy) = 1; x record; r jsonb; v_nivel int; v_sec text; v_fmt text; v_dias int; v_sem int; v_rec bigint;
begin
  perform set_config('rtm.canal', 'telegram', true);
  select * into c from cobranza.config where id = 1;
  for x in
    select pe.id, pe.folio, pe.cliente_id, cl.nombre_canonico as cliente, so.nombre as duenio, pe.es_de_sociedad, operacion.pedido_saldo(pe.id) as saldo, cobranza.vence_efectivo(pe.id) as vence,
           cobranza.estado_pedido(pe.id, p_hoy) as est, coalesce(sg.ignorados_consecutivos, 0) as ign, sg.promesa_fecha as prom, sg.pausa_hasta, sg.ultima_respuesta_at
      from operacion.pedido pe join catalogo.cliente cl on cl.id = pe.cliente_id join catalogo.socio so on so.id = cl.duenio_id left join cobranza.seguimiento sg on sg.pedido_id = pe.id
     where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0
     order by operacion.pedido_saldo(pe.id) desc, pe.id
  loop
    v_dias := case when x.vence is not null and p_hoy > x.vence then p_hoy - x.vence else 0 end;
    v_nivel := 0; v_sec := null; v_fmt := 'linea'; v_sem := 0; v_rec := 0;
    if x.est = 'vence_hoy' then v_sec := 'vence_hoy'; v_fmt := 'tarjeta';
    elsif x.est = 'prometido' then
      if x.prom = p_hoy then v_sec := 'vence_hoy'; v_fmt := 'tarjeta'; else v_sec := 'prometido'; end if;
    elsif x.est = 'vencido' then
      v_nivel := greatest(case when v_dias >= 30 then 4 when v_dias >= 15 then 3 when v_dias >= c.compacto_desde_dia then 2 else 1 end,
                          case when x.ign >= 5 then 3 when x.ign >= 3 then 2 when x.ign >= 1 then 1 else 0 end);
      v_sec := case when v_nivel >= 3 then 'sin_respuesta' else 'vencido' end;
      v_fmt := case when v_nivel <= 1 or v_lunes then 'tarjeta' else 'compacta' end;
      r := operacion.recargo_sugerido(x.id, p_hoy);
      v_sem := (r ->> 'semanas_completas')::int; v_rec := (r ->> 'pendiente_cent')::bigint;
    elsif x.est = 'por_vencer' then v_sec := 'proximo';
    elsif x.est = 'disputado' then v_sec := 'disputa';
    elsif x.est = 'sin_plazo' then v_sec := 'sin_plazo';
    end if;
    -- Cierre de las 17:00: solo lo que vencia o se prometio para hoy y nadie ha contestado hoy.
    if p_tipo = 'cierre' and not (v_sec = 'vence_hoy' and (x.ultima_respuesta_at is null or negocio.fecha_neg(x.ultima_respuesta_at) <> p_hoy)) then continue; end if;
    if v_sec is null then continue; end if;
    pedido_id := x.id; folio := x.folio; cliente_id := x.cliente_id; cliente := x.cliente; duenio := x.duenio; saldo_cent := x.saldo; vence := x.vence; estado := x.est;
    dias_vencido := v_dias; ignorados := x.ign; promesa_fecha := x.prom; promesa_incumplida := (x.prom is not null and x.prom < p_hoy and x.est = 'vencido');
    termino_pausa := (x.pausa_hasta is not null and x.pausa_hasta = p_hoy - 1 and x.est <> 'pausado');
    nivel := v_nivel; seccion := v_sec; formato := v_fmt; semanas := v_sem; recargo_pendiente_cent := v_rec; sin_plazo_a_costo := (v_sec = 'sin_plazo' and not x.es_de_sociedad);
    respondio_hoy := (x.ultima_respuesta_at is not null and negocio.fecha_neg(x.ultima_respuesta_at) = p_hoy);
    return next;
  end loop;
end $$;

create function cobranza.cola_hoy(p_hoy date default null, p_tipo text default 'am') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(to_jsonb(q)) from cobranza._cola(coalesce(p_hoy, negocio.hoy()), p_tipo) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- digest: plantilla pura sobre SQL, sin IA
-- Una tarjeta por cliente y seccion con todos sus pedidos; solo se pregunta en tarjetas. Cero mensajes vacios: si no hay nada que decir, `vacio` = true.
create function cobranza.armar_digest(p_hoy date default null, p_tipo text default 'am') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c cobranza.config; v_hoy date := coalesce(p_hoy, negocio.hoy()); v_lunes boolean := extract(dow from coalesce(p_hoy, negocio.hoy())) = 1;
  v_txt text := ''; v_bloque text; k record; v_lineas jsonb := '[]'::jsonb; v_n int := 0; v_total bigint := 0; v_sin_id record; v_resumen text := ''; v_n_sr int; v_monto_sr bigint; v_viejo text; v_viejo_d int;
  v_pregunta constant text := E'\n  ¿Ya pagó? Respondan con sus palabras: pagó todo, pagó una parte, prometió fecha, aún no o disputa.';
  v_excede boolean := false; v_compacto boolean := false;
begin
  perform notificacion.exigir_sistema();
  select * into c from cobranza.config where id = 1;

  -- cabecera
  v_txt := case p_tipo when 'cierre' then 'Cierre del día de cobranza, ' else 'Cobranza de hoy, ' end || cobranza._fecha_txt(v_hoy);

  -- Resumen semanal del lunes (lo ignorado: vencidos desde el nivel 2).
  select count(distinct cliente_id), coalesce(sum(saldo_cent), 0), max(dias_vencido) into v_n_sr, v_monto_sr, v_viejo_d from cobranza._cola(v_hoy, p_tipo) where p_tipo = 'am' and v_lunes and nivel >= 2;
  if coalesce(v_n_sr, 0) > 0 then
    select cliente into v_viejo from cobranza._cola(v_hoy, p_tipo) where nivel >= 2 order by dias_vencido desc, saldo_cent desc limit 1;
    v_resumen := format(E'\n\nResumen semanal de cobranza sin respuesta: %s cliente%s, %s en total. El más antiguo: %s, %s vencido.\n¿Pausamos, extendemos el plazo o marcamos disputa en alguno?',
      v_n_sr, case when v_n_sr = 1 then '' else 's' end, cobranza._pesos(v_monto_sr), v_viejo, cobranza._dias_txt(v_viejo_d));
    v_txt := v_txt || v_resumen;
  end if;

  -- Secciones con tarjeta o linea, agrupadas por cliente.
  for k in
    select seccion, cliente_id, cliente, formato, max(nivel) as nivel, sum(saldo_cent) as saldo, max(dias_vencido) as dias, max(ignorados) as ign,
           string_agg(folio || ' ' || cobranza._pesos(saldo_cent), ' + ' order by vence nulls last, pedido_id) as detalle, count(*) as pedidos,
           max(semanas) as semanas, sum(recargo_pendiente_cent) as recargo, bool_or(promesa_incumplida) as incumplida, bool_or(termino_pausa) as termino_pausa,
           min(promesa_fecha) as promesa, min(vence) as vence, min(duenio) as duenio, bool_or(sin_plazo_a_costo) as a_costo, array_agg(pedido_id order by pedido_id) as ids, array_agg(saldo_cent order by pedido_id) as saldos
      from cobranza._cola(v_hoy, p_tipo)
     group by seccion, cliente_id, cliente, formato
     order by case seccion when 'sin_respuesta' then 1 when 'vence_hoy' then 2 when 'vencido' then 3 when 'prometido' then 4 when 'disputa' then 5 when 'proximo' then 6 else 7 end, sum(saldo_cent) desc, cliente
  loop
    v_bloque := null;
    if k.seccion = 'sin_respuesta' then
      v_bloque := format(E'SIN RESPUESTA\n%s lleva %s vencido (%s, sin respuesta desde hace %s).%s%s', k.cliente, cobranza._dias_txt(k.dias), k.detalle, cobranza._dias_txt(k.dias),
        case when k.recargo > 0 then format(' Recargo sugerido a hoy: %s (%s semana%s), no aplicado; lo decide %s.', cobranza._pesos(k.recargo), k.semanas, case when k.semanas = 1 then '' else 's' end, k.duenio) else '' end,
        case when k.nivel >= 4 then ' Decisión pendiente: llamar, extender plazo, marcar disputa o castigar.' else '' end);
      if k.formato = 'tarjeta' then v_bloque := v_bloque || v_pregunta; end if;
    elsif k.seccion = 'vence_hoy' then
      v_bloque := format('%s %s. %s%s', k.cliente, case when k.promesa is not null and k.promesa = v_hoy then 'prometió pagar HOY' else 'vence HOY' end, k.detalle,
        case when k.pedidos > 1 then ' = ' || cobranza._pesos(k.saldo) else '' end) || v_pregunta;
    elsif k.seccion = 'vencido' then
      if k.formato = 'tarjeta' then
        v_bloque := format('%s venció hace %s%s. %s%s%s', k.cliente, cobranza._dias_txt(k.dias), case when k.incumplida then ' (promesa incumplida)' else '' end, k.detalle,
          case when k.pedidos > 1 then ' = ' || cobranza._pesos(k.saldo) else '' end,
          case when k.recargo > 0 and k.dias % 7 = 0 then format(' Recargo sugerido a hoy: %s (%s semana%s), no aplicado; lo decide %s.', cobranza._pesos(k.recargo), k.semanas, case when k.semanas = 1 then '' else 's' end, k.duenio) else '' end)
          || case when k.termino_pausa then ' Terminó la pausa.' else '' end || v_pregunta;
      else
        v_bloque := format('%s lleva %s vencido. %s.%s Se vuelve a preguntar el lunes; para callarlo: "silenciar %s 7 días".', k.cliente, cobranza._dias_txt(k.dias), k.detalle,
          case when k.recargo > 0 then format(' Recargo sugerido a hoy: %s (%s semana%s), no aplicado.', cobranza._pesos(k.recargo), k.semanas, case when k.semanas = 1 then '' else 's' end) else '' end, k.cliente)
          || case when k.termino_pausa then ' Terminó la pausa.' else '' end;
      end if;
    elsif k.seccion = 'prometido' then
      v_bloque := format('Prometido: %s pagará el %s. %s', k.cliente, cobranza._fecha_txt(k.promesa), k.detalle);
    elsif k.seccion = 'disputa' and (v_lunes or p_tipo <> 'am') and p_tipo = 'am' then
      v_bloque := format('En disputa: %s, %s. El recargo sigue calculándose, marcado bajo disputa.', k.cliente, k.detalle);
    elsif k.seccion = 'proximo' then
      v_bloque := format('Próximos: %s vence %s. %s', k.cliente, case when k.vence = v_hoy + 1 then 'mañana' else 'el ' || cobranza._fecha_txt(k.vence) end, k.detalle);
    elsif k.seccion = 'sin_plazo' and v_lunes and p_tipo = 'am' then
      v_bloque := case when k.a_costo then format('Alerta de plazo: %s (pedido a costo del socio) sigue sin fecha comprometida. %s', k.cliente, k.detalle)
                       else format('Alerta de plazo: %s no tiene plazo capturado (todo crédito lo exige). %s', k.cliente, k.detalle) end;
    end if;
    if v_bloque is null then continue; end if;
    v_n := v_n + 1;
    if k.seccion in ('sin_respuesta', 'vence_hoy', 'vencido') then v_total := v_total + k.saldo; end if;
    -- Limite de Telegram: pasado el tope se compactan las tarjetas de vencidos (una linea, sin pregunta); nunca se parte en varios mensajes.
    if length(v_txt) + length(v_bloque) + 2 > c.max_caracteres and k.seccion in ('vencido', 'sin_respuesta') and position(v_pregunta in v_bloque) > 0 then
      v_bloque := replace(v_bloque, v_pregunta, ''); v_compacto := true;
    end if;
    v_txt := v_txt || E'\n\n' || v_bloque;
    v_lineas := v_lineas || (select coalesce(jsonb_agg(jsonb_build_object('pedido_id', pid, 'cliente_id', k.cliente_id, 'seccion', k.seccion, 'nivel', k.nivel,
                  'formato', case when position(v_pregunta in v_bloque) > 0 then 'tarjeta' when k.formato = 'tarjeta' then 'compacta' else k.formato end,
                  'saldo_cent', sd)), '[]'::jsonb) from unnest(k.ids, k.saldos) as u(pid, sd));
  end loop;

  if p_tipo = 'am' and v_n > 0 then
    select count(*) as n, coalesce(sum(p.monto_cent), 0) as total into v_sin_id from operacion.pago p where p.identificacion = 'sin_identificar'
       and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id) and not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id);
    if v_sin_id.n > 0 then
      v_txt := v_txt || format(E'\n\nHay %s pago%s sin identificar por %s; podría corresponder a alguno de los pendientes de arriba.', v_sin_id.n, case when v_sin_id.n = 1 then '' else 's' end, cobranza._pesos(v_sin_id.total));
    end if;
  end if;
  if v_total > 0 then v_txt := v_txt || E'\n\nTotal por cobrar vencido o que vence hoy: ' || cobranza._pesos(v_total) || '.'; end if;
  return jsonb_build_object('fecha', v_hoy, 'tipo', p_tipo, 'vacio', v_n = 0, 'texto', case when v_n = 0 then null else v_txt end, 'lineas', v_lineas, 'total_cent', v_total, 'compactado', v_compacto);
end $$;

revoke all on function cobranza._solo_anexar() from public, anon, authenticated;
revoke all on function cobranza._fecha_txt(date), cobranza._pesos(numeric), cobranza._dias_txt(int), cobranza._hoy(jsonb) from public, anon, authenticated;
revoke all on function cobranza.es_inhabil(date), cobranza.vence_efectivo(bigint), cobranza.estado_pedido(bigint, date) from public, anon, authenticated;
revoke all on function cobranza._cola(date, text), cobranza.cola_hoy(date, text), cobranza.armar_digest(date, text) from public, anon, authenticated;
grant execute on function cobranza.cola_hoy(date, text), cobranza.armar_digest(date, text) to servidor;
