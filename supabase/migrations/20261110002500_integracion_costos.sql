-- Integracion 1 / 0025: costos de mantenimiento del sistema (esquemas `costos` e `ia`).
--  * El cargo de un servicio es un GASTO DE LA SOCIEDAD pagado por Javier (o por quien se indique): nace llamando a `operacion.registrar_gasto_socio`, asi que el asiento
--    (Dr 62xx / Cr 2320), la cuenta por pagar al socio y la cascada de reparto salen de la misma ruta de siempre (ya reconciliada con el plan de cuentas: 2320 = pagos de Javier
--    por cuenta de la sociedad). No se crean tipos de evento nuevos.
--  * El reembolso llama a `operacion.registrar_pago_a_socio(... 'reembolso')`: reduce lo pendiente del socio sin tocar el cargo.
--  * La base recalcula el monto con las gemelas SQL del techo (`costos.techo`) y rechaza cualquier cifra que no coincida con la que calculo el dominio TypeScript.
--  * Anular un cargo = otra fila con signo contrario enlazada (`reversa_de`); el cargo original no se toca.
-- Nada de esto lee ni guarda llaves: los lectores externos (Vercel, OpenRouter, Banxico) quedan para la ola de despliegue.

create schema costos;
create schema ia;
revoke all on schema costos, ia from public, anon, authenticated;
grant usage on schema costos, ia to servidor;

alter table seguridad.contador_folio drop constraint contador_folio_serie_check;
alter table seguridad.contador_folio add constraint contador_folio_serie_check check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E', 'PO', 'CR', 'A', 'INV', 'K', 'R'));
insert into seguridad.contador_folio (serie) values ('K'), ('R');

-- Guardia compartida por las olas de integracion: un socio con sesion, o el sistema (rol servidor o la Mac local como postgres).
create function seguridad.exigir_socio_o_sistema() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if seguridad.rol_actual() = 'socio' or session_user in ('servidor', 'postgres') then return; end if;
  raise exception 'permiso denegado' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Gemelas SQL de src/dominio/dinero/techo.ts (numeric: base x porcentaje x tipo de cambio supera el rango de bigint).
-- ---------------------------------------------------------------------------
create function costos.ceil_div(a numeric, b numeric) returns numeric
language plpgsql immutable parallel safe set search_path = ''
as $$
begin
  if b <= 0 then raise exception 'denominador invalido' using errcode = '22012'; end if;
  return case when a >= 0 then div(a + b - 1, b) else -div(-a, b) end;
end $$;

create function costos.techo(num numeric, den numeric, paso numeric default 100) returns numeric
language plpgsql immutable parallel safe set search_path = ''
as $$
begin
  if paso <= 0 then raise exception 'paso invalido' using errcode = '22012'; end if;
  return costos.ceil_div(costos.ceil_div(num, den), paso) * paso;
end $$;

create function costos.techo_pct_fraccion(num numeric, den numeric) returns numeric
language plpgsql immutable parallel safe set search_path = ''
as $$
begin
  if num < 0 then raise exception 'participacion negativa' using errcode = '22012'; end if;
  return costos.ceil_div(num * 100, den) * 10000;
end $$;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table costos.servicio (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  nombre text not null,
  categoria text not null check (categoria in ('nube', 'ia', 'software', 'dominio')),
  fase text not null default 'mantenimiento' check (fase in ('construccion', 'mantenimiento')),
  ciclo text not null check (ciclo in ('mensual', 'anual', 'uso', 'ninguno')),
  dia_renovacion int check (dia_renovacion is null or dia_renovacion between 1 and 31),
  moneda text not null default 'USD' check (moneda in ('USD', 'MXN')),
  metodo_atribucion text not null check (nullif(btrim(metodo_atribucion), '') is not null),
  pagador_default text not null default 'javier' check (pagador_default in ('angelo', 'javier')),
  cobrable boolean not null default true,
  opcional boolean not null default false,
  activo boolean not null default true,
  cuota_documento_orig_micro bigint check (cuota_documento_orig_micro is null or cuota_documento_orig_micro >= 0),
  logo_slug text
);
insert into costos.servicio (slug, nombre, categoria, fase, ciclo, dia_renovacion, moneda, metodo_atribucion, pagador_default, cobrable, opcional, cuota_documento_orig_micro, logo_slug) values
  ('openrouter', 'OpenRouter', 'ia', 'mantenimiento', 'uso', null, 'USD', 'Consumo de RTM en el libro propio de llamadas, conciliado contra la llave de RTM; el saldo de la cuenta no cuenta', 'javier', true, false, null, 'openrouter'),
  ('openrouter_comision', 'OpenRouter, comisión de recarga', 'ia', 'mantenimiento', 'uso', null, 'USD', 'Consumo de RTM por la comisión de recarga (línea aparte)', 'javier', true, false, null, 'openrouter'),
  ('vercel', 'Vercel', 'nube', 'mantenimiento', 'mensual', 12, 'USD', 'Participación por consumo en el equipo compartido; se cobra el mayor entre la cuota del documento y el consumo real', 'javier', true, false, 20000000, 'vercel'),
  ('supabase', 'Supabase', 'nube', 'mantenimiento', 'mensual', 1, 'USD', 'Participación por horas de cómputo en la organización compartida; se cobra el mayor entre la cuota del documento y el consumo real', 'javier', true, false, 25000000, 'supabase'),
  ('transcripcion', 'Transcripción de audio', 'ia', 'mantenimiento', 'uso', null, 'USD', '100 % propio de RTM, medido en el libro', 'javier', true, false, null, null),
  ('resend', 'Resend', 'software', 'mantenimiento', 'mensual', null, 'USD', 'Plan gratuito: cero; si hubiera plan de pago, proporción de correos de RTM', 'javier', true, false, null, 'resend'),
  ('dominio', 'Dominio', 'dominio', 'mantenimiento', 'anual', null, 'USD', '100 % si es de RTM; devengo de un doceavo cada mes', 'javier', true, false, null, null),
  ('telegram', 'Telegram', 'software', 'mantenimiento', 'ninguno', null, 'USD', 'La interfaz de bots no tiene cobro', 'javier', true, false, null, 'telegram'),
  ('github', 'GitHub', 'software', 'mantenimiento', 'ninguno', null, 'USD', 'Repositorio privado sin costo', 'javier', true, false, null, 'github'),
  ('higgsfield', 'Higgsfield', 'ia', 'mantenimiento', 'uso', null, 'USD', 'Solo generaciones etiquetadas RTM por el valor del crédito', 'javier', true, true, null, 'higgsfield'),
  ('claude_max', 'Claude Max', 'software', 'construccion', 'mensual', null, 'USD', 'Participación por tokens de los proyectos de RTM, redondeada al punto porcentual superior', 'javier', true, true, null, 'anthropic');

create table costos.tipo_cambio (
  id bigint generated always as identity primary key,
  fecha date not null,
  moneda text not null default 'USD' check (moneda in ('USD')),
  tc_micro bigint not null check (tc_micro > 0),
  fuente text not null check (fuente in ('banxico_fix', 'manual')),
  creado_at timestamptz not null default clock_timestamp(),
  unique (fecha, moneda, fuente)
);

create table costos.cargo (
  id bigint generated always as identity primary key,
  folio text not null unique,
  servicio_id bigint not null references costos.servicio (id),
  mes char(7) not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  fecha_neg date not null,
  fase text not null check (fase in ('construccion', 'mantenimiento')),
  base_orig_micro bigint not null,
  moneda text not null check (moneda in ('USD', 'MXN')),
  pct_exacto_ppm int not null check (pct_exacto_ppm between 0 and 1000000),
  pct_aplicado_ppm int not null check (pct_aplicado_ppm between 0 and 1000000),
  tc_micro bigint not null check (tc_micro > 0),
  tc_fecha date not null,
  tc_fuente text not null check (tc_fuente in ('banxico_fix', 'manual')),
  exacto_mxn_e6 bigint not null,
  exacto_puro_mxn_e6 bigint not null,
  monto_cent bigint not null,
  como_seria_cent bigint,
  como_deberia_cent bigint,
  pagado_por text not null check (pagado_por in ('angelo', 'javier')),
  cobrable boolean not null,
  etiqueta text not null check (etiqueta in ('medido', 'recibo', 'capturado', 'atribuido', 'estimado_prorrateado', 'proyeccion')),
  estado text not null check (estado in ('provisional', 'confirmado', 'disputado', 'anulado')),
  evidencia_tipo text not null check (evidencia_tipo in ('api', 'recibo', 'libro', 'captura', 'script_local')),
  evidencia_sha256 text check (evidencia_sha256 is null or evidencia_sha256 ~ '^[0-9a-f]{64}$'),
  nota text not null default '',
  reversa_de bigint references costos.cargo (id),
  clave_idem text not null unique,
  gasto_id bigint references operacion.gasto (id),
  evento_id bigint references operacion.evento (id),
  creado_at timestamptz not null default clock_timestamp(),
  -- El monto nunca queda por debajo del exacto (solo una reversa copia con signo contrario).
  check (reversa_de is not null or monto_cent * 1000000 >= exacto_mxn_e6),
  check (monto_cent % 100 = 0),
  check (estado <> 'confirmado' or evidencia_sha256 is not null),
  check ((reversa_de is null) = (estado <> 'anulado'))
);
create unique index cargo_una_evidencia on costos.cargo (servicio_id, mes, evidencia_sha256) where evidencia_sha256 is not null and reversa_de is null;
create unique index cargo_una_reversa on costos.cargo (reversa_de) where reversa_de is not null;
create index cargo_mes_idx on costos.cargo (mes, servicio_id);

create table costos.reembolso (
  id bigint generated always as identity primary key,
  folio text not null unique,
  a_socio text not null check (a_socio in ('angelo', 'javier')),
  fondos_de text not null check (fondos_de in ('angelo', 'javier')),
  monto_cent bigint not null check (monto_cent > 0),
  fecha_neg date not null,
  medio text not null check (nullif(btrim(medio), '') is not null),
  comprobante_sha256 text check (comprobante_sha256 is null or comprobante_sha256 ~ '^[0-9a-f]{64}$'),
  clave_idem text not null unique,
  libro_id bigint references operacion.socio_libro (id),
  evento_id bigint references operacion.evento (id),
  creado_at timestamptz not null default clock_timestamp()
);

create table costos.lectura_api (
  id bigint generated always as identity primary key,
  servicio_id bigint not null references costos.servicio (id),
  ventana text not null,
  estado text not null check (estado in ('ok', 'error', 'parcial')),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[0-9a-f]{64}$'),
  leida_at timestamptz not null default clock_timestamp(),
  unique (servicio_id, ventana)
);

-- [ME] solo estado: abrir y resolver un faltante son dos filas, no una edicion.
create table costos.dato_faltante (
  id bigint generated always as identity primary key,
  servicio_id bigint not null references costos.servicio (id),
  mes char(7) not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  abierto_at timestamptz not null default clock_timestamp(),
  resuelto_at timestamptz,
  unique (servicio_id, mes, abierto_at)
);

create table costos.conciliacion (
  id bigint generated always as identity primary key,
  servicio_id bigint not null references costos.servicio (id),
  mes char(7) not null,
  fuente_a text not null,
  a_usd_micro bigint not null,
  fuente_b text not null,
  b_usd_micro bigint not null,
  dif_ppm int not null,
  estado text not null check (estado in ('cuadra', 'fuera_de_tolerancia', 'explicada')),
  explicacion text,
  creada_at timestamptz not null default clock_timestamp()
);

create table costos.presupuesto (
  id bigint generated always as identity primary key,
  servicio_id bigint not null references costos.servicio (id),
  mes char(7) not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monto_cent bigint not null check (monto_cent >= 0),
  creado_at timestamptz not null default clock_timestamp(),
  unique (servicio_id, mes)
);

create table costos.parametro (
  clave text primary key,
  valor jsonb not null,
  cambiado_por uuid,
  cambiado_at timestamptz not null default clock_timestamp()
);
insert into costos.parametro (clave, valor) values
  ('costos_regla_pagador', '"javier"'),
  ('costos_cobrable_por_defecto', 'true'),
  ('openrouter_incluir_comision', 'true'),
  ('openrouter_comision_ppm', '55000'),
  ('conciliacion_tolerancia_ppm', '20000'),
  ('tc_fuente', '"banxico_fix"'),
  ('claude_proyectos_rtm', '["-Users-javiercamaraportepetit-rtm"]'),
  ('fecha_inicio_mantenimiento', '"2026-11-01"'),
  ('marcas_licencia_declaracion', 'true'),
  ('ia_tope_dia_micro_usd', '1000000'),
  ('ia_tope_mes_micro_usd', '30000000');

create table costos.claude_uso_mes (
  id bigint generated always as identity primary key,
  mes char(7) not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  metrica text not null check (metrica in ('entrada_salida_escritura_cache', 'solo_salida', 'todo_con_lectura_cache')),
  tokens_rtm bigint not null check (tokens_rtm >= 0),
  tokens_cuenta bigint not null check (tokens_cuenta > 0),
  pct_exacto_ppm int not null,
  pct_aplicado_ppm int not null,
  sesiones int not null default 0,
  json_sha256 text not null check (json_sha256 ~ '^[0-9a-f]{64}$'),
  script_version text not null,
  importado_por uuid,
  importado_at timestamptz not null default clock_timestamp(),
  unique (mes, metrica, json_sha256)
);

-- Libro de llamadas al modelo (micro-USD, sin texto de usuarios). Lo escribe el agente al liquidar una reserva.
create table ia.llamada (
  id bigint generated always as identity primary key,
  ts timestamptz not null default clock_timestamp(),
  rol text not null,
  modelo text not null,
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  costo_usd_micro bigint not null check (costo_usd_micro >= 0),
  generacion_openrouter text,
  reserva_clave text,
  estado text not null check (estado in ('liquidada', 'reservada', 'fallida'))
);
create index llamada_ts_idx on ia.llamada (ts);

do $$
declare t text;
begin
  foreach t in array array['cargo', 'reembolso', 'tipo_cambio', 'lectura_api', 'conciliacion', 'claude_uso_mes'] loop
    execute format('create trigger %I before update or delete on costos.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on costos.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on costos.%I from postgres', t);
  end loop;
  execute 'create trigger llamada_t1 before update or delete on ia.llamada for each row execute function seguridad.t1_solo_insercion()';
  execute 'create trigger llamada_t1t before truncate on ia.llamada for each statement execute function seguridad.t1_solo_insercion()';
  execute 'revoke delete, truncate on ia.llamada from postgres';
end $$;
do $$
declare r record;
begin
  for r in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('costos', 'ia') and c.relkind = 'r' loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
    execute format('alter table %I.%I force row level security', r.nspname, r.relname);
    execute format('revoke all on %I.%I from public, anon, authenticated', r.nspname, r.relname);
  end loop;
end $$;
revoke all on all sequences in schema costos, ia from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Registrar un cargo: la base recalcula y compara con lo que calculo el dominio TypeScript.
-- ---------------------------------------------------------------------------
create function costos.registrar_cargo(
  p_clave_idem text, p_servicio text, p_mes text, p_fecha date, p_fase text, p_base_orig_micro bigint, p_moneda text,
  p_pct_exacto_ppm int, p_pct_aplicado_ppm int, p_tc_micro bigint, p_tc_fecha date, p_tc_fuente text,
  p_exacto_mxn_e6 bigint, p_exacto_puro_mxn_e6 bigint, p_monto_cent bigint, p_como_seria_cent bigint, p_como_deberia_cent bigint,
  p_pagado_por text, p_cobrable boolean, p_etiqueta text, p_estado text, p_evidencia_tipo text, p_evidencia_sha256 text, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; s costos.servicio; v_num numeric; v_exacto numeric; v_puro numeric; v_monto numeric; v_folio text; v_id bigint; v_gasto jsonb; v_gasto_id bigint; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'costos.registrar_cargo', 's', p_servicio, 'mes', p_mes, 'f', p_fecha, 'b', p_base_orig_micro, 'm', p_moneda, 'pe', p_pct_exacto_ppm,
    'pa', p_pct_aplicado_ppm, 'tc', p_tc_micro, 'x', p_exacto_mxn_e6, 'mc', p_monto_cent, 'p', p_pagado_por, 'c', p_cobrable, 'e', p_estado, 'sha', p_evidencia_sha256));
  if v_prev is not null then return v_prev; end if;
  select * into s from costos.servicio where slug = p_servicio;
  if not found then raise exception 'servicio desconocido: %', p_servicio using errcode = '22023'; end if;
  if not s.activo then raise exception 'el servicio % esta inactivo', p_servicio using errcode = 'P0451'; end if;
  if p_moneda is distinct from s.moneda then raise exception 'moneda distinta de la del servicio' using errcode = '22023'; end if;
  -- Recalculo: base x porcentaje x tipo de cambio con UN solo techo al peso entero. Debe coincidir con el dominio, cifra por cifra.
  v_num := p_base_orig_micro::numeric * p_pct_aplicado_ppm::numeric * p_tc_micro::numeric;
  v_exacto := floor(v_num / 10000000000::numeric);
  v_puro := floor(p_base_orig_micro::numeric * p_pct_exacto_ppm::numeric * p_tc_micro::numeric / 10000000000::numeric);
  v_monto := costos.techo(v_num, 10000000000000000::numeric, 100);
  if v_exacto <> p_exacto_mxn_e6 or v_puro <> p_exacto_puro_mxn_e6 or v_monto <> p_monto_cent then
    raise exception 'el monto no coincide con el recalculo de la base (exacto %, monto %)', v_exacto, v_monto using errcode = 'P0452';
  end if;
  if p_estado = 'confirmado' and p_evidencia_sha256 is null then raise exception 'un cargo confirmado exige evidencia' using errcode = 'P0453'; end if;
  v_folio := seguridad.siguiente_folio('K');
  -- Un cargo cobrable con monto es gasto de la sociedad pagado por el socio: mismo camino que cualquier gasto (asiento, cuenta por pagar y cascada).
  if p_cobrable and p_monto_cent > 0 then
    v_gasto := operacion.registrar_gasto_socio(p_clave_idem || ':gasto', initcap(p_pagado_por), p_monto_cent, s.categoria,
      case when s.ciclo in ('mensual', 'anual') then 'fijo' else 'variable' end, p_fecha, null, 'Costo del sistema ' || v_folio || ': ' || s.nombre || ' ' || p_mes, null);
    v_gasto_id := (v_gasto ->> 'gasto_id')::bigint;
    select evento_id into v_ev from operacion.gasto where id = v_gasto_id;
  end if;
  insert into costos.cargo (folio, servicio_id, mes, fecha_neg, fase, base_orig_micro, moneda, pct_exacto_ppm, pct_aplicado_ppm, tc_micro, tc_fecha, tc_fuente, exacto_mxn_e6, exacto_puro_mxn_e6,
                            monto_cent, como_seria_cent, como_deberia_cent, pagado_por, cobrable, etiqueta, estado, evidencia_tipo, evidencia_sha256, nota, clave_idem, gasto_id, evento_id)
    values (v_folio, s.id, p_mes, p_fecha, p_fase, p_base_orig_micro, p_moneda, p_pct_exacto_ppm, p_pct_aplicado_ppm, p_tc_micro, p_tc_fecha, p_tc_fuente, p_exacto_mxn_e6, p_exacto_puro_mxn_e6,
            p_monto_cent, p_como_seria_cent, p_como_deberia_cent, p_pagado_por, p_cobrable, p_etiqueta, p_estado, p_evidencia_tipo, p_evidencia_sha256, coalesce(p_nota, ''), p_clave_idem, v_gasto_id, v_ev)
    returning id into v_id;
  v_res := jsonb_build_object('cargo_id', v_id, 'folio', v_folio, 'gasto_id', v_gasto_id, 'evento_id', v_ev, 'monto_cent', p_monto_cent, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Anular = reversa enlazada con los montos guardados en signo contrario; el gasto se deshace con su contramovimiento.
create function costos.anular_cargo(p_clave_idem text, p_cargo_id bigint, p_fecha date, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c costos.cargo; v_folio text; v_id bigint; v_aport bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'costos.anular_cargo', 'c', p_cargo_id, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_nota), '') is null then raise exception 'anular un cargo exige motivo' using errcode = '23502'; end if;
  select * into c from costos.cargo where id = p_cargo_id for update;
  if not found then raise exception 'cargo desconocido' using errcode = '22023'; end if;
  if c.reversa_de is not null then raise exception 'una reversa no se anula' using errcode = 'P0454'; end if;
  if exists (select 1 from costos.cargo r where r.reversa_de = c.id) then raise exception 'el cargo ya esta anulado' using errcode = 'P0454'; end if;
  if c.gasto_id is not null then
    select a.id into v_aport from operacion.aportacion_socio a where a.ref_tipo = 'gasto' and a.ref_id = c.gasto_id and a.reversa_de is null;
    perform operacion.anular_movimiento_socio(p_clave_idem || ':gasto', 'aportacion', v_aport, p_nota);
  end if;
  v_folio := seguridad.siguiente_folio('K');
  insert into costos.cargo (folio, servicio_id, mes, fecha_neg, fase, base_orig_micro, moneda, pct_exacto_ppm, pct_aplicado_ppm, tc_micro, tc_fecha, tc_fuente, exacto_mxn_e6, exacto_puro_mxn_e6,
                            monto_cent, como_seria_cent, como_deberia_cent, pagado_por, cobrable, etiqueta, estado, evidencia_tipo, evidencia_sha256, nota, reversa_de, clave_idem, gasto_id, evento_id)
    values (v_folio, c.servicio_id, c.mes, p_fecha, c.fase, -c.base_orig_micro, c.moneda, c.pct_exacto_ppm, c.pct_aplicado_ppm, c.tc_micro, c.tc_fecha, c.tc_fuente, -c.exacto_mxn_e6, -c.exacto_puro_mxn_e6,
            -c.monto_cent, -c.como_seria_cent, -c.como_deberia_cent, c.pagado_por, c.cobrable, c.etiqueta, 'anulado', c.evidencia_tipo, null, p_nota, c.id, p_clave_idem, c.gasto_id, c.evento_id)
    returning id into v_id;
  v_res := jsonb_build_object('cargo_id', v_id, 'folio', v_folio, 'reversa_de', c.id, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Reembolso de la sociedad al socio que pago: sale de la cuenta por pagar y no puede pasar de lo pendiente por costos del sistema.
create function costos.pendiente_socio(p_socio text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(c.monto_cent) from costos.cargo c where c.cobrable and c.pagado_por = p_socio), 0)::bigint
       - coalesce((select sum(r.monto_cent) from costos.reembolso r where r.a_socio = p_socio), 0)::bigint
$$;

create function costos.registrar_reembolso(p_clave_idem text, p_a_socio text, p_fondos_de text, p_monto_cent bigint, p_fecha date, p_medio text, p_comprobante_sha256 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_folio text; v_id bigint; v_pago jsonb; v_libro bigint; v_ev bigint; v_res jsonb; v_pend bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'costos.registrar_reembolso', 'a', p_a_socio, 'd', p_fondos_de, 'm', p_monto_cent, 'f', p_fecha, 'md', p_medio, 'sha', p_comprobante_sha256));
  if v_prev is not null then return v_prev; end if;
  if p_a_socio not in ('angelo', 'javier') or p_fondos_de not in ('angelo', 'javier') then raise exception 'socio desconocido' using errcode = '22023'; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el reembolso debe ser mayor que cero' using errcode = '23514'; end if;
  v_pend := costos.pendiente_socio(p_a_socio);
  if p_monto_cent > v_pend then raise exception 'el reembolso (% centavos) excede lo pendiente por costos del sistema (% centavos)', p_monto_cent, v_pend using errcode = 'P0455'; end if;
  v_folio := seguridad.siguiente_folio('R');
  v_pago := operacion.registrar_pago_a_socio(p_clave_idem || ':pago', initcap(p_a_socio), p_monto_cent, 'reembolso', case when lower(p_medio) like '%efectivo%' then 'efectivo' else 'transferencia' end,
                                              p_fecha, 'Reembolso de costos del sistema ' || v_folio, null);
  v_libro := (v_pago ->> 'libro_id')::bigint;
  select evento_id into v_ev from operacion.socio_libro where id = v_libro;
  insert into costos.reembolso (folio, a_socio, fondos_de, monto_cent, fecha_neg, medio, comprobante_sha256, clave_idem, libro_id, evento_id)
    values (v_folio, p_a_socio, p_fondos_de, p_monto_cent, p_fecha, p_medio, p_comprobante_sha256, p_clave_idem, v_libro, v_ev) returning id into v_id;
  v_res := jsonb_build_object('reembolso_id', v_id, 'folio', v_folio, 'pendiente_cent', costos.pendiente_socio(p_a_socio), 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function costos.registrar_tipo_cambio(p_clave_idem text, p_fecha date, p_tc_micro bigint, p_fuente text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'costos.registrar_tipo_cambio', 'f', p_fecha, 'tc', p_tc_micro, 'fu', p_fuente));
  if v_prev is not null then return v_prev; end if;
  insert into costos.tipo_cambio (fecha, tc_micro, fuente) values (p_fecha, p_tc_micro, p_fuente) on conflict (fecha, moneda, fuente) do nothing;
  v_res := jsonb_build_object('fecha', p_fecha, 'tc_micro', p_tc_micro, 'fuente', p_fuente);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas (STABLE): la pantalla y el reporte mensual leen lo mismo. Nada se calcula en la interfaz.
-- ---------------------------------------------------------------------------
create function costos.tipo_cambio_del_dia(p_fecha date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(x) from (
    select t.fecha as fecha, t.tc_micro as tc_micro, t.fuente as fuente from costos.tipo_cambio t
     where t.fecha <= p_fecha order by t.fecha desc, case t.fuente when 'manual' then 0 else 1 end, t.id desc limit 1) x
$$;

create function costos.cargo_json(c costos.cargo) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'folio', c.folio, 'servicio_slug', s.slug, 'servicio', s.nombre, 'categoria', s.categoria, 'logo_slug', s.logo_slug, 'opcional', s.opcional,
    'mes', c.mes, 'fecha_neg', c.fecha_neg, 'fase', c.fase, 'moneda', c.moneda,
    'base_orig_micro', c.base_orig_micro, 'pct_exacto_ppm', c.pct_exacto_ppm, 'pct_aplicado_ppm', c.pct_aplicado_ppm,
    'tc_micro', c.tc_micro, 'tc_fecha', c.tc_fecha, 'tc_fuente', c.tc_fuente,
    'exacto_mxn_e6', c.exacto_mxn_e6, 'exacto_puro_mxn_e6', c.exacto_puro_mxn_e6, 'monto_cent', c.monto_cent, 'como_seria_cent', c.como_seria_cent, 'como_deberia_cent', c.como_deberia_cent,
    'pagado_por', c.pagado_por, 'cobrable', c.cobrable, 'etiqueta', c.etiqueta, 'estado', c.estado, 'evidencia_tipo', c.evidencia_tipo, 'tiene_evidencia', c.evidencia_sha256 is not null,
    'nota', c.nota, 'clave_idem', c.clave_idem, 'evidencia_sha256', c.evidencia_sha256, 'reversa_de', c.reversa_de, 'anulado', exists (select 1 from costos.cargo r where r.reversa_de = c.id), 'gasto_folio', (select g.folio from operacion.gasto g where g.id = c.gasto_id))
  from costos.servicio s where s.id = c.servicio_id
$$;

create function costos.servicios() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'nombre', s.nombre, 'categoria', s.categoria, 'fase', s.fase, 'ciclo', s.ciclo, 'dia_renovacion', s.dia_renovacion, 'moneda', s.moneda,
    'metodo_atribucion', s.metodo_atribucion, 'pagador_default', s.pagador_default, 'cobrable', s.cobrable, 'opcional', s.opcional, 'activo', s.activo, 'cuota_documento_orig_micro', s.cuota_documento_orig_micro,
    'logo_slug', s.logo_slug) order by s.id), '[]'::jsonb) from costos.servicio s
$$;

create function costos.cargos(p_mes text default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(costos.cargo_json(c) order by c.fecha_neg desc, c.id desc), '[]'::jsonb) from costos.cargo c where p_mes is null or c.mes = p_mes
$$;

create function costos.reembolsos() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'folio', r.folio, 'a_socio', r.a_socio, 'fondos_de', r.fondos_de, 'monto_cent', r.monto_cent, 'fecha_neg', r.fecha_neg, 'medio', r.medio,
    'comprobante_sha256', r.comprobante_sha256, 'clave_idem', r.clave_idem) order by r.id), '[]'::jsonb) from costos.reembolso r
$$;

-- Cuenta por pagar de la sociedad a quien pago: cargado, reembolsado y pendiente. Debe cuadrar con la cuenta de socios (aportaciones reembolsables).
create function costos.cuenta_por_pagar(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cargado bigint; v_reem bigint; v_id bigint;
begin
  select coalesce(sum(c.monto_cent), 0)::bigint into v_cargado from costos.cargo c where c.cobrable and c.pagado_por = p_socio;
  select coalesce(sum(r.monto_cent), 0)::bigint into v_reem from costos.reembolso r where r.a_socio = p_socio;
  select id into v_id from catalogo.socio where nombre = initcap(p_socio);
  return jsonb_build_object('socio', p_socio, 'cargado_cent', v_cargado, 'reembolsado_cent', v_reem, 'pendiente_cent', v_cargado - v_reem,
    'movimientos', coalesce((select jsonb_agg(m order by (m ->> 'fecha_neg') desc, (m ->> 'folio') desc) from (
        select jsonb_build_object('folio', c.folio, 'fecha_neg', c.fecha_neg, 'tipo', case when c.reversa_de is null then 'cargo' else 'reversa' end, 'monto_cent', c.monto_cent, 'concepto', s.nombre) as m
          from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.cobrable and c.pagado_por = p_socio
        union all
        select jsonb_build_object('folio', r.folio, 'fecha_neg', r.fecha_neg, 'tipo', 'reembolso', 'monto_cent', -r.monto_cent, 'concepto', 'Reembolso (' || r.medio || ')')
          from costos.reembolso r where r.a_socio = p_socio) u), '[]'::jsonb));
end $$;

-- Resumen del mes (spec 17, seccion 0): exacto y redondeado SIEMPRE por separado; el total redondeado es la suma de cargos ya redondeados.
create function costos.resumen_mes(p_mes text, p_incluir_construccion boolean default false) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_por_servicio jsonb; v_faltantes jsonb; v_op jsonb; v_opc jsonb; v_con jsonb; v_tot jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'servicio', x.nombre, 'logo_slug', x.logo_slug, 'fase', x.fase, 'opcional', x.opcional, 'categoria', x.categoria,
      'redondeado_cent', x.redondeado, 'exacto_e6', x.exacto, 'exacto_puro_e6', x.puro, 'usd_micro', x.usd, 'cargos', x.n,
      'como_seria_cent', x.seria, 'como_deberia_cent', x.deberia, 'ultima_etiqueta', x.etiqueta, 'ultimo_estado', x.estado) order by x.orden), '[]'::jsonb) into v_por_servicio
  from (
    select s.id as orden, s.slug, s.nombre, s.logo_slug, s.fase, s.opcional, s.categoria,
           coalesce(sum(c.monto_cent), 0)::bigint as redondeado, coalesce(sum(c.exacto_mxn_e6), 0)::bigint as exacto, coalesce(sum(c.exacto_puro_mxn_e6), 0)::bigint as puro,
           coalesce(sum(case when c.moneda = 'USD' then floor(c.base_orig_micro::numeric * c.pct_aplicado_ppm / 1000000) else 0 end), 0)::bigint as usd,
           count(c.id)::int as n, sum(c.como_seria_cent)::bigint as seria, sum(c.como_deberia_cent)::bigint as deberia,
           (array_agg(c.etiqueta order by c.id desc))[1] as etiqueta, (array_agg(c.estado order by c.id desc))[1] as estado
      from costos.servicio s left join costos.cargo c on c.servicio_id = s.id and c.mes = p_mes where s.activo group by s.id) x;
  select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'servicio', s.nombre, 'motivo', f.motivo)), '[]'::jsonb) into v_faltantes
    from costos.dato_faltante f join costos.servicio s on s.id = f.servicio_id where f.mes = p_mes and f.resuelto_at is null;
  select jsonb_build_object('redondeado_cent', coalesce(sum(c.monto_cent), 0)::bigint, 'exacto_e6', coalesce(sum(c.exacto_mxn_e6), 0)::bigint, 'exacto_puro_e6', coalesce(sum(c.exacto_puro_mxn_e6), 0)::bigint)
    into v_op from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.mes = p_mes and c.fase = 'mantenimiento' and not s.opcional;
  select jsonb_build_object('redondeado_cent', coalesce(sum(c.monto_cent), 0)::bigint, 'exacto_e6', coalesce(sum(c.exacto_mxn_e6), 0)::bigint, 'exacto_puro_e6', coalesce(sum(c.exacto_puro_mxn_e6), 0)::bigint)
    into v_opc from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.mes = p_mes and c.fase = 'mantenimiento' and s.opcional;
  select jsonb_build_object('redondeado_cent', coalesce(sum(c.monto_cent), 0)::bigint, 'exacto_e6', coalesce(sum(c.exacto_mxn_e6), 0)::bigint, 'exacto_puro_e6', coalesce(sum(c.exacto_puro_mxn_e6), 0)::bigint)
    into v_con from costos.cargo c where c.mes = p_mes and c.fase = 'construccion';
  v_tot := jsonb_build_object(
    'redondeado_cent', (v_op ->> 'redondeado_cent')::bigint + (v_opc ->> 'redondeado_cent')::bigint + case when p_incluir_construccion then (v_con ->> 'redondeado_cent')::bigint else 0 end,
    'exacto_e6', (v_op ->> 'exacto_e6')::bigint + (v_opc ->> 'exacto_e6')::bigint + case when p_incluir_construccion then (v_con ->> 'exacto_e6')::bigint else 0 end);
  return jsonb_build_object('mes', p_mes, 'servicios', v_por_servicio, 'operar', v_op, 'opcionales', v_opc, 'construccion', v_con, 'total', v_tot, 'al_menos', jsonb_array_length(v_faltantes) > 0,
    'faltantes', v_faltantes, 'incluye_construccion', p_incluir_construccion, 'cuenta_javier', costos.cuenta_por_pagar('javier'),
    'tipo_cambio', costos.tipo_cambio_del_dia(negocio.hoy()));
end $$;

-- "Explicar este numero": lo que el cargo hizo, paso a paso, con los mismos numeros guardados.
create function costos.explicar_cargo(p_cargo_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c costos.cargo; s costos.servicio; v_bruto numeric; v_atribuido numeric;
begin
  select * into c from costos.cargo where id = p_cargo_id;
  if not found then raise exception 'cargo desconocido' using errcode = '22023'; end if;
  select * into s from costos.servicio where id = c.servicio_id;
  v_bruto := c.base_orig_micro::numeric;
  v_atribuido := floor(c.base_orig_micro::numeric * c.pct_aplicado_ppm / 1000000);
  return jsonb_build_object('cargo', costos.cargo_json(c), 'metodo', s.metodo_atribucion, 'base_orig_micro', c.base_orig_micro, 'pct_exacto_ppm', c.pct_exacto_ppm, 'pct_aplicado_ppm', c.pct_aplicado_ppm,
    'atribuido_orig_micro', v_atribuido::bigint, 'tc_micro', c.tc_micro, 'tc_fecha', c.tc_fecha, 'tc_fuente', c.tc_fuente, 'exacto_mxn_e6', c.exacto_mxn_e6, 'monto_cent', c.monto_cent,
    'comprobacion', jsonb_build_object('via1', 'Base por porcentaje por tipo de cambio, con un solo techo al peso', 'via1_cent', costos.techo(c.base_orig_micro::numeric * c.pct_aplicado_ppm * c.tc_micro, 10000000000000000::numeric, 100)::bigint,
      'via2', 'Monto guardado del cargo', 'via2_cent', c.monto_cent, 'cuadra', costos.techo(c.base_orig_micro::numeric * c.pct_aplicado_ppm * c.tc_micro, 10000000000000000::numeric, 100)::bigint = c.monto_cent or c.reversa_de is not null));
end $$;

-- Insumo del reporte mensual (spec 17, seccion 7): lo mismo que la pantalla.
create function costos.insumo_reporte(p_mes text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cargado bigint; v_seria bigint; v_deberia bigint; v_reem bigint;
begin
  select coalesce(sum(c.monto_cent), 0)::bigint, coalesce(sum(c.como_seria_cent), 0)::bigint, coalesce(sum(c.como_deberia_cent), 0)::bigint into v_cargado, v_seria, v_deberia
    from costos.cargo c where c.mes = p_mes and c.cobrable;
  select coalesce(sum(r.monto_cent), 0)::bigint into v_reem from costos.reembolso r where to_char(r.fecha_neg, 'YYYY-MM') = p_mes;
  return jsonb_build_object('cargo_sociedad_cent', v_cargado, 'como_seria_cent', v_seria, 'como_deberia_cent', v_deberia, 'bolsillo_javier_cent', (select coalesce(sum(c.monto_cent), 0)::bigint from costos.cargo c where c.mes = p_mes and c.cobrable and c.pagado_por = 'javier'),
    'reembolsado_cent', v_reem, 'pendiente_cent', costos.pendiente_socio('javier'));
end $$;

-- Topes de IA del mes para el reporte (el libro de llamadas vive en ia.llamada).
create function ia.gasto_mes_micro(p_mes text) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(l.costo_usd_micro), 0)::bigint from ia.llamada l where l.estado = 'liquidada' and to_char((l.ts at time zone 'UTC') - interval '6 hours', 'YYYY-MM') = p_mes $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* (rol socio)
-- ---------------------------------------------------------------------------
create function api.costos_servicios() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.servicios(); end $$;
create function api.costos_resumen(p_mes text, p_incluir_construccion boolean default false) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.resumen_mes(p_mes, p_incluir_construccion); end $$;
create function api.costos_cargos(p_mes text default null) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.cargos(p_mes); end $$;
create function api.costos_reembolsos() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.reembolsos(); end $$;
create function api.costos_cuenta(p_socio text default 'javier') returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.cuenta_por_pagar(p_socio); end $$;
create function api.costos_explicar(p_cargo_id bigint) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.explicar_cargo(p_cargo_id); end $$;
create function api.costos_tipo_cambio(p_fecha date) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.tipo_cambio_del_dia(p_fecha); end $$;
create function api.costos_registrar_cargo(
  p_clave_idem text, p_servicio text, p_mes text, p_fecha date, p_fase text, p_base_orig_micro bigint, p_moneda text, p_pct_exacto_ppm int, p_pct_aplicado_ppm int, p_tc_micro bigint, p_tc_fecha date,
  p_tc_fuente text, p_exacto_mxn_e6 bigint, p_exacto_puro_mxn_e6 bigint, p_monto_cent bigint, p_como_seria_cent bigint, p_como_deberia_cent bigint, p_pagado_por text, p_cobrable boolean, p_etiqueta text,
  p_estado text, p_evidencia_tipo text, p_evidencia_sha256 text, p_nota text) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']);
  return costos.registrar_cargo(p_clave_idem, p_servicio, p_mes, p_fecha, p_fase, p_base_orig_micro, p_moneda, p_pct_exacto_ppm, p_pct_aplicado_ppm, p_tc_micro, p_tc_fecha, p_tc_fuente, p_exacto_mxn_e6,
    p_exacto_puro_mxn_e6, p_monto_cent, p_como_seria_cent, p_como_deberia_cent, p_pagado_por, p_cobrable, p_etiqueta, p_estado, p_evidencia_tipo, p_evidencia_sha256, p_nota); end $$;
create function api.costos_anular_cargo(p_clave_idem text, p_cargo_id bigint, p_fecha date, p_nota text) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.anular_cargo(p_clave_idem, p_cargo_id, p_fecha, p_nota); end $$;
create function api.costos_registrar_reembolso(p_clave_idem text, p_a_socio text, p_fondos_de text, p_monto_cent bigint, p_fecha date, p_medio text, p_comprobante_sha256 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.registrar_reembolso(p_clave_idem, p_a_socio, p_fondos_de, p_monto_cent, p_fecha, p_medio, p_comprobante_sha256); end $$;
create function api.costos_registrar_tipo_cambio(p_clave_idem text, p_fecha date, p_tc_micro bigint, p_fuente text) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.registrar_tipo_cambio(p_clave_idem, p_fecha, p_tc_micro, p_fuente); end $$;

-- Privilegios: nada para PUBLIC; la web (authenticated) solo ve api.*; el sistema ejecuta las lecturas de costos.
revoke execute on all functions in schema costos from public, anon, authenticated;
revoke execute on all functions in schema ia from public, anon, authenticated;
revoke execute on function seguridad.exigir_socio_o_sistema() from public, anon, authenticated;
grant execute on function costos.insumo_reporte(text), costos.resumen_mes(text, boolean), costos.tipo_cambio_del_dia(date), ia.gasto_mes_micro(text) to servidor;
revoke execute on function api.costos_reembolsos(), api.costos_servicios(), api.costos_resumen(text, boolean), api.costos_cargos(text), api.costos_cuenta(text), api.costos_explicar(bigint), api.costos_tipo_cambio(date),
  api.costos_registrar_cargo(text, text, text, date, text, bigint, text, int, int, bigint, date, text, bigint, bigint, bigint, bigint, bigint, text, boolean, text, text, text, text, text),
  api.costos_anular_cargo(text, bigint, date, text), api.costos_registrar_reembolso(text, text, text, bigint, date, text, text), api.costos_registrar_tipo_cambio(text, date, bigint, text) from public, anon;
grant execute on function api.costos_reembolsos(), api.costos_servicios(), api.costos_resumen(text, boolean), api.costos_cargos(text), api.costos_cuenta(text), api.costos_explicar(bigint), api.costos_tipo_cambio(date),
  api.costos_registrar_cargo(text, text, text, date, text, bigint, text, int, int, bigint, date, text, bigint, bigint, bigint, bigint, bigint, text, boolean, text, text, text, text, text),
  api.costos_anular_cargo(text, bigint, date, text), api.costos_registrar_reembolso(text, text, text, bigint, date, text, text), api.costos_registrar_tipo_cambio(text, date, bigint, text) to authenticated;
