-- Costos del sistema como APORTACION DE CAPITAL del socio que los paga (decision del dueno, 14-nov).
-- "Vercel y Supabase estan conectados con mi cuenta; cada mes todos los cobros se anaden a mi valuacion como aportacion porque yo pago eso, y se lleva registro, se tiene fecha de todo."
--
-- Es la EXCEPCION EXPLICITA a la regla "dinero propio de un socio = reembolso por omision": aqui Javier DECLARA capital (parametro costos_como_capital, con su declaracion y fecha).
--  * Cada cargo cobrable pagado por un socio declarado nace como gasto de la sociedad + aportacion de capital del socio (cuenta 3110/3120 del mayor), SIN tocar la caja:
--    asiento Dr 62xx (gasto del servicio) / Cr 3120 (aportaciones de Javier). Suma a su valuacion personal y al capital contable del Balance por la ruta de siempre.
--  * Un socio no declarado (Angelo) conserva el camino anterior: gasto + cuenta por pagar reembolsable (2310).
--  * Idempotente por servicio y mes: un segundo cargo VIVO del mismo servicio y mes con otra clave se rechaza (P0456); para corregirlo se anula (reversa) y se registra de nuevo.
--  * Los cargos capital NO generan cuenta por pagar: costos.pendiente_socio y la cuenta de costos los excluyen (no hay nada que reembolsar).
-- Tambien agrega: cuota base editable con vigente_desde (regla 'menor' o 'mayor' entre la cuota y el consumo real), cargos en dolares sin tipo de cambio (no se convierten ni se inventa un TC),
-- validacion de montos (cargos del mes = aportacion generada = mayor) y "Explicar este numero" propio (api.explicar_costos).
-- Aditiva: sin DROP de tablas ni funciones; las funciones existentes se recrean con la misma firma o se envuelven (rename) conservando permisos cerrados.

-- ---------------------------------------------------------------------------
-- Declaracion del dueno y columnas nuevas del cargo
-- ---------------------------------------------------------------------------
insert into costos.parametro (clave, valor) values
  ('costos_como_capital', jsonb_build_object('socios', jsonb_build_array('javier'), 'intencion', 'costos del sistema pagados por el socio', 'declarado_por', 'Javier (dueno)', 'fecha', '2026-11-14'));

alter table costos.cargo add column como_capital boolean not null default false;
alter table costos.cargo add column aportacion_id bigint references operacion.aportacion_socio (id);
alter table costos.cargo add column intencion text;

-- Servicios: el dominio se administra en Vercel (logo de Vercel, devengo de un doceavo) y la regla de las plataformas pasa a "lo menor entre la cuota base y el consumo real".
update costos.servicio set logo_slug = 'vercel',
  metodo_atribucion = 'Dominio administrado en Vercel, devengo de un doceavo cada mes; vale 0 hasta que el dueño declare el costo anual'
  where slug = 'dominio';
update costos.servicio set
  metodo_atribucion = 'Participación por consumo en el equipo compartido; se cobra lo menor entre la cuota base (editable) y el consumo real; sin consumo declarado vale 0'
  where slug = 'vercel';
update costos.servicio set
  metodo_atribucion = 'Participación por horas de cómputo en la organización compartida; se cobra lo menor entre la cuota base (editable) y el consumo real; sin consumo declarado vale 0'
  where slug = 'supabase';
update costos.servicio set
  metodo_atribucion = 'Monto fijo declarado por el dueño: 20 USD al mes (20 de 200 prorrateados)'
  where slug = 'claude_max';

-- ---------------------------------------------------------------------------
-- Cuota base por servicio, con vigente_desde (editable: fila nueva, nunca se edita una anterior)
-- ---------------------------------------------------------------------------
create table costos.cuota_base (
  id bigint generated always as identity primary key,
  servicio_id bigint not null references costos.servicio (id),
  regla text not null check (regla in ('menor', 'mayor')),
  cuota_orig_micro bigint not null check (cuota_orig_micro >= 0),
  vigente_desde date not null,
  nota text not null default '',
  creado_at timestamptz not null default clock_timestamp(),
  unique (servicio_id, vigente_desde)
);
insert into costos.cuota_base (servicio_id, regla, cuota_orig_micro, vigente_desde, nota)
  select s.id, 'menor', s.cuota_documento_orig_micro, date '2026-11-01',
         'Cuota del documento inicial; regla: se cobra lo menor entre esta cuota y el consumo real (decision del dueño, 14-nov; pendiente de confirmar el sentido exacto)'
    from costos.servicio s where s.slug in ('vercel', 'supabase') and s.cuota_documento_orig_micro is not null;

-- Cargos en dolares declarados que NO se pueden convertir porque no hay tipo de cambio: se guardan en USD y la pagina dice "Sin tipo de cambio: falta capturarlo".
-- Es estado (abrir y resolver), no un cargo: no toca el libro ni el total hasta que exista el tipo de cambio.
create table costos.cargo_pendiente_tc (
  id bigint generated always as identity primary key,
  servicio_id bigint not null references costos.servicio (id),
  mes char(7) not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  fecha_neg date not null,
  usd_micro bigint not null check (usd_micro > 0),
  nota text not null default '',
  abierto_at timestamptz not null default clock_timestamp(),
  resuelto_at timestamptz,
  unique (servicio_id, mes, abierto_at)
);

do $$
declare t text;
begin
  foreach t in array array['cuota_base', 'cargo_pendiente_tc'] loop
    execute format('alter table costos.%I enable row level security', t);
    execute format('alter table costos.%I force row level security', t);
    execute format('revoke all on costos.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema costos from public, anon, authenticated;

create function costos.cuota_base_vigente(p_servicio text, p_fecha date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(x) from (
    select q.regla as regla, q.cuota_orig_micro as cuota_orig_micro, q.vigente_desde as vigente_desde, q.nota as nota
      from costos.cuota_base q join costos.servicio s on s.id = q.servicio_id
     where s.slug = p_servicio and q.vigente_desde <= p_fecha order by q.vigente_desde desc, q.id desc limit 1) x
$$;

create function costos.fijar_cuota_base(p_servicio text, p_regla text, p_cuota_orig_micro bigint, p_vigente_desde date, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s costos.servicio; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_regla not in ('menor', 'mayor') then raise exception 'regla invalida: menor o mayor' using errcode = '22023'; end if;
  if p_cuota_orig_micro is null or p_cuota_orig_micro < 0 then raise exception 'cuota invalida' using errcode = '23514'; end if;
  select * into s from costos.servicio where slug = p_servicio;
  if not found then raise exception 'servicio desconocido: %', p_servicio using errcode = '22023'; end if;
  insert into costos.cuota_base (servicio_id, regla, cuota_orig_micro, vigente_desde, nota)
    values (s.id, p_regla, p_cuota_orig_micro, p_vigente_desde, coalesce(p_nota, ''))
    on conflict (servicio_id, vigente_desde) do nothing returning id into v_id;
  if v_id is null then raise exception 'ya hay una cuota base con vigente_desde %: usa otra fecha (no se edita una fila anterior)', p_vigente_desde using errcode = 'P0457'; end if;
  return jsonb_build_object('id', v_id, 'servicio', p_servicio, 'regla', p_regla, 'cuota_orig_micro', p_cuota_orig_micro, 'vigente_desde', p_vigente_desde);
end $$;

create function costos.registrar_pendiente_tc(p_servicio text, p_mes text, p_fecha date, p_usd_micro bigint, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s costos.servicio; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'mes invalido' using errcode = '22023'; end if;
  if p_usd_micro is null or p_usd_micro <= 0 then raise exception 'el cargo pendiente debe ser mayor que cero' using errcode = '23514'; end if;
  select * into s from costos.servicio where slug = p_servicio;
  if not found then raise exception 'servicio desconocido: %', p_servicio using errcode = '22023'; end if;
  select id into v_id from costos.cargo_pendiente_tc where servicio_id = s.id and mes = p_mes and resuelto_at is null order by id desc limit 1;
  if v_id is null then
    insert into costos.cargo_pendiente_tc (servicio_id, mes, fecha_neg, usd_micro, nota) values (s.id, p_mes, p_fecha, p_usd_micro, coalesce(p_nota, '')) returning id into v_id;
    return jsonb_build_object('id', v_id, 'nuevo', true);
  end if;
  update costos.cargo_pendiente_tc set usd_micro = p_usd_micro, fecha_neg = p_fecha, nota = coalesce(p_nota, '')
   where id = v_id and (usd_micro <> p_usd_micro or fecha_neg <> p_fecha or nota <> coalesce(p_nota, ''));
  return jsonb_build_object('id', v_id, 'nuevo', false);
end $$;

create function costos.resolver_pendiente_tc(p_servicio text, p_mes text) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  update costos.cargo_pendiente_tc p set resuelto_at = clock_timestamp()
    from costos.servicio s where s.id = p.servicio_id and s.slug = p_servicio and p.mes = p_mes and p.resuelto_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Gasto de la sociedad pagado por un socio que DECLARA capital: gasto + aportacion de capital, sin movimiento de caja.
-- Solo lo llama costos.registrar_cargo (security definer); la web y el agente no lo ven.
-- ---------------------------------------------------------------------------
create function operacion.registrar_gasto_socio_capital(p_clave_idem text, p_socio text, p_monto_cent bigint, p_categoria text, p_naturaleza text, p_fecha date, p_nota text, p_intencion text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_fecha date; v_origen date; v_ev bigint; v_id bigint; v_folio text; v_apo bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_gasto_socio_capital', 's', p_socio, 'm', p_monto_cent, 'c', p_categoria, 'n', p_naturaleza, 'f', p_fecha, 'nt', p_nota, 'i', p_intencion));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el gasto debe ser positivo' using errcode = '23514'; end if;
  if nullif(btrim(p_categoria), '') is null then raise exception 'el gasto necesita categoria' using errcode = '23502'; end if;
  if nullif(btrim(p_intencion), '') is null then raise exception 'el capital se declara con su intencion' using errcode = '23502'; end if;
  if p_naturaleza not in ('fijo', 'variable') then raise exception 'naturaleza invalida' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  v_fecha := operacion.fecha_efectiva(p_fecha); v_origen := operacion.fecha_tardia(p_fecha);
  v_ev := operacion.crear_evento('gasto_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'categoria', p_categoria, 'clasificacion', 'capital'), null);
  v_folio := seguridad.siguiente_folio('G');
  insert into operacion.gasto (folio, fecha_neg, categoria, naturaleza, monto_cent, pagado_por_socio_id, evento_id, fecha_origen)
    values (v_folio, v_fecha, btrim(p_categoria), p_naturaleza, p_monto_cent, v_socio, v_ev, v_origen) returning id into v_id;
  -- El asiento sale del evento: Dr gasto del servicio / Cr aportaciones del socio (3110 Angelo, 3120 Javier). Sin linea de caja: el socio pago con su tarjeta.
  insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
    values (v_socio, p_monto_cent, 'Aportación de capital (' || btrim(p_intencion) || '), gasto ' || v_folio || ': ' || btrim(p_categoria) || coalesce(' (' || p_nota || ')', ''), 'capital', v_fecha, 'gasto', v_id, v_ev)
    returning id into v_apo;
  v_res := jsonb_build_object('gasto_id', v_id, 'folio', v_folio, 'aportacion_id', v_apo, 'evento_id', v_ev, 'tardio', v_origen is not null, 'fecha_origen', v_origen);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Registrar un cargo: capital declarado si el socio esta en costos_como_capital; si no, el camino anterior (cuenta por pagar reembolsable).
-- ---------------------------------------------------------------------------
create or replace function costos.registrar_cargo(
  p_clave_idem text, p_servicio text, p_mes text, p_fecha date, p_fase text, p_base_orig_micro bigint, p_moneda text,
  p_pct_exacto_ppm int, p_pct_aplicado_ppm int, p_tc_micro bigint, p_tc_fecha date, p_tc_fuente text,
  p_exacto_mxn_e6 bigint, p_exacto_puro_mxn_e6 bigint, p_monto_cent bigint, p_como_seria_cent bigint, p_como_deberia_cent bigint,
  p_pagado_por text, p_cobrable boolean, p_etiqueta text, p_estado text, p_evidencia_tipo text, p_evidencia_sha256 text, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; s costos.servicio; v_num numeric; v_exacto numeric; v_puro numeric; v_monto numeric; v_folio text; v_id bigint; v_gasto jsonb; v_gasto_id bigint; v_ev bigint; v_res jsonb;
  v_decl jsonb; v_cap boolean; v_intencion text; v_apo bigint; v_nat text;
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
  select valor into v_decl from costos.parametro where clave = 'costos_como_capital';
  v_cap := coalesce(p_cobrable, false) and p_monto_cent > 0 and v_decl is not null and jsonb_exists(v_decl -> 'socios', p_pagado_por);
  v_intencion := case when v_cap then coalesce(nullif(btrim(v_decl ->> 'intencion'), ''), 'costos del sistema pagados por el socio') end;
  -- Idempotente por servicio y mes: un cargo capital VIVO (sin reversa) de otra clave bloquea un segundo cargo del mismo servicio y mes.
  if v_cap and exists (select 1 from costos.cargo x where x.servicio_id = s.id and x.mes = p_mes and x.como_capital and x.reversa_de is null and x.clave_idem <> p_clave_idem
                         and not exists (select 1 from costos.cargo r where r.reversa_de = x.id)) then
    raise exception 'ya hay un cargo vivo de % en %: anulalo (reversa) y registra el nuevo, no se duplica el servicio y mes', p_servicio, p_mes using errcode = 'P0456';
  end if;
  v_folio := seguridad.siguiente_folio('K');
  v_nat := case when s.ciclo in ('mensual', 'anual') then 'fijo' else 'variable' end;
  if p_cobrable and p_monto_cent > 0 then
    if v_cap then
      v_gasto := operacion.registrar_gasto_socio_capital(p_clave_idem || ':gasto', initcap(p_pagado_por), p_monto_cent, s.categoria, v_nat, p_fecha,
        'Costo del sistema ' || v_folio || ': ' || s.nombre || ' ' || p_mes || ', USD ' || (p_base_orig_micro / 1000000.0)::numeric(18, 2)::text || ' a ' || (p_tc_micro / 1000000.0)::numeric(18, 4)::text, v_intencion);
      v_apo := (v_gasto ->> 'aportacion_id')::bigint;
    else
      v_gasto := operacion.registrar_gasto_socio(p_clave_idem || ':gasto', initcap(p_pagado_por), p_monto_cent, s.categoria, v_nat, p_fecha, null, 'Costo del sistema ' || v_folio || ': ' || s.nombre || ' ' || p_mes, null);
    end if;
    v_gasto_id := (v_gasto ->> 'gasto_id')::bigint;
    select evento_id into v_ev from operacion.gasto where id = v_gasto_id;
  end if;
  insert into costos.cargo (folio, servicio_id, mes, fecha_neg, fase, base_orig_micro, moneda, pct_exacto_ppm, pct_aplicado_ppm, tc_micro, tc_fecha, tc_fuente, exacto_mxn_e6, exacto_puro_mxn_e6,
                            monto_cent, como_seria_cent, como_deberia_cent, pagado_por, cobrable, etiqueta, estado, evidencia_tipo, evidencia_sha256, nota, clave_idem, gasto_id, evento_id,
                            como_capital, aportacion_id, intencion)
    values (v_folio, s.id, p_mes, p_fecha, p_fase, p_base_orig_micro, p_moneda, p_pct_exacto_ppm, p_pct_aplicado_ppm, p_tc_micro, p_tc_fecha, p_tc_fuente, p_exacto_mxn_e6, p_exacto_puro_mxn_e6,
            p_monto_cent, p_como_seria_cent, p_como_deberia_cent, p_pagado_por, p_cobrable, p_etiqueta, p_estado, p_evidencia_tipo, p_evidencia_sha256, coalesce(p_nota, ''), p_clave_idem, v_gasto_id, v_ev,
            v_cap, v_apo, v_intencion)
    returning id into v_id;
  v_res := jsonb_build_object('cargo_id', v_id, 'folio', v_folio, 'gasto_id', v_gasto_id, 'evento_id', v_ev, 'monto_cent', p_monto_cent, 'como_capital', v_cap, 'aportacion_id', v_apo, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Anular conserva la clasificacion: la reversa del cargo capital queda como capital (resta a lo aportado) y deshace la aportacion y el gasto con su contramovimiento.
create or replace function costos.anular_cargo(p_clave_idem text, p_cargo_id bigint, p_fecha date, p_nota text) returns jsonb
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
                            monto_cent, como_seria_cent, como_deberia_cent, pagado_por, cobrable, etiqueta, estado, evidencia_tipo, evidencia_sha256, nota, reversa_de, clave_idem, gasto_id, evento_id,
                            como_capital, aportacion_id, intencion)
    values (v_folio, c.servicio_id, c.mes, p_fecha, c.fase, -c.base_orig_micro, c.moneda, c.pct_exacto_ppm, c.pct_aplicado_ppm, c.tc_micro, c.tc_fecha, c.tc_fuente, -c.exacto_mxn_e6, -c.exacto_puro_mxn_e6,
            -c.monto_cent, -c.como_seria_cent, -c.como_deberia_cent, c.pagado_por, c.cobrable, c.etiqueta, 'anulado', c.evidencia_tipo, null, p_nota, c.id, p_clave_idem, c.gasto_id, c.evento_id,
            c.como_capital, c.aportacion_id, c.intencion)
    returning id into v_id;
  v_res := jsonb_build_object('cargo_id', v_id, 'folio', v_folio, 'reversa_de', c.id, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Cuenta por pagar: solo lo reembolsable. Lo declarado como capital no se debe: se muestra aparte (aportado_capital_cent).
-- ---------------------------------------------------------------------------
create or replace function costos.pendiente_socio(p_socio text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(c.monto_cent) from costos.cargo c where c.cobrable and not c.como_capital and c.pagado_por = p_socio), 0)::bigint
       - coalesce((select sum(r.monto_cent) from costos.reembolso r where r.a_socio = p_socio), 0)::bigint
$$;

create or replace function costos.cuenta_por_pagar(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cargado bigint; v_reem bigint; v_cap bigint;
begin
  select coalesce(sum(c.monto_cent), 0)::bigint into v_cargado from costos.cargo c where c.cobrable and not c.como_capital and c.pagado_por = p_socio;
  select coalesce(sum(c.monto_cent), 0)::bigint into v_cap from costos.cargo c where c.cobrable and c.como_capital and c.pagado_por = p_socio;
  select coalesce(sum(r.monto_cent), 0)::bigint into v_reem from costos.reembolso r where r.a_socio = p_socio;
  return jsonb_build_object('socio', p_socio, 'cargado_cent', v_cargado, 'reembolsado_cent', v_reem, 'pendiente_cent', v_cargado - v_reem, 'aportado_capital_cent', v_cap,
    'movimientos', coalesce((select jsonb_agg(m order by (m ->> 'fecha_neg') desc, (m ->> 'folio') desc) from (
        select jsonb_build_object('folio', c.folio, 'fecha_neg', c.fecha_neg, 'tipo', case when c.reversa_de is null then 'cargo' else 'reversa' end, 'monto_cent', c.monto_cent, 'concepto', s.nombre) as m
          from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.cobrable and not c.como_capital and c.pagado_por = p_socio
        union all
        select jsonb_build_object('folio', r.folio, 'fecha_neg', r.fecha_neg, 'tipo', 'reembolso', 'monto_cent', -r.monto_cent, 'concepto', 'Reembolso (' || r.medio || ')')
          from costos.reembolso r where r.a_socio = p_socio) u), '[]'::jsonb));
end $$;

create or replace function costos.cargo_json(c costos.cargo) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'folio', c.folio, 'servicio_slug', s.slug, 'servicio', s.nombre, 'categoria', s.categoria, 'logo_slug', s.logo_slug, 'opcional', s.opcional,
    'mes', c.mes, 'fecha_neg', c.fecha_neg, 'fase', c.fase, 'moneda', c.moneda,
    'base_orig_micro', c.base_orig_micro, 'pct_exacto_ppm', c.pct_exacto_ppm, 'pct_aplicado_ppm', c.pct_aplicado_ppm,
    'tc_micro', c.tc_micro, 'tc_fecha', c.tc_fecha, 'tc_fuente', c.tc_fuente,
    'exacto_mxn_e6', c.exacto_mxn_e6, 'exacto_puro_mxn_e6', c.exacto_puro_mxn_e6, 'monto_cent', c.monto_cent, 'como_seria_cent', c.como_seria_cent, 'como_deberia_cent', c.como_deberia_cent,
    'pagado_por', c.pagado_por, 'cobrable', c.cobrable, 'etiqueta', c.etiqueta, 'estado', c.estado, 'evidencia_tipo', c.evidencia_tipo, 'tiene_evidencia', c.evidencia_sha256 is not null,
    'nota', c.nota, 'clave_idem', c.clave_idem, 'evidencia_sha256', c.evidencia_sha256, 'reversa_de', c.reversa_de, 'anulado', exists (select 1 from costos.cargo r where r.reversa_de = c.id),
    'gasto_folio', (select g.folio from operacion.gasto g where g.id = c.gasto_id),
    'como_capital', c.como_capital, 'intencion', c.intencion, 'aportacion_id', c.aportacion_id)
  from costos.servicio s where s.id = c.servicio_id
$$;

create or replace function costos.servicios() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'nombre', s.nombre, 'categoria', s.categoria, 'fase', s.fase, 'ciclo', s.ciclo, 'dia_renovacion', s.dia_renovacion, 'moneda', s.moneda,
    'metodo_atribucion', s.metodo_atribucion, 'pagador_default', s.pagador_default, 'cobrable', s.cobrable, 'opcional', s.opcional, 'activo', s.activo, 'cuota_documento_orig_micro', s.cuota_documento_orig_micro,
    'logo_slug', s.logo_slug, 'cuota_base', costos.cuota_base_vigente(s.slug, negocio.hoy())) order by s.id), '[]'::jsonb) from costos.servicio s
$$;

-- ---------------------------------------------------------------------------
-- Validacion de montos: lo cargado en el mes (cargos capital) = lo aportado (libro de socios) = lo asentado (mayor 3110/3120). p_mes null = todos los meses.
-- ---------------------------------------------------------------------------
create function costos.validacion_mes(p_mes text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cargos bigint; v_apo bigint; v_mayor bigint; v_por jsonb; v_pend jsonb; v_cargos_n int;
begin
  select coalesce(sum(c.monto_cent), 0)::bigint, count(*)::int into v_cargos, v_cargos_n from costos.cargo c where c.como_capital and (p_mes is null or c.mes = p_mes);
  select coalesce(sum(a.monto_cent), 0)::bigint into v_apo from operacion.aportacion_socio a
   where a.ref_tipo = 'gasto' and a.clasificacion = 'capital' and a.ref_id in (select c.gasto_id from costos.cargo c where c.como_capital and c.gasto_id is not null and (p_mes is null or c.mes = p_mes));
  select coalesce(sum(l.haber_cent - l.debe_cent), 0)::bigint into v_mayor
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
   where l.cuenta in ('3110', '3120')
     and a.evento_id in (select ap.evento_id from operacion.aportacion_socio ap where ap.ref_tipo = 'gasto' and ap.clasificacion = 'capital'
                           and ap.ref_id in (select c.gasto_id from costos.cargo c where c.como_capital and c.gasto_id is not null and (p_mes is null or c.mes = p_mes)));
  select coalesce(jsonb_agg(jsonb_build_object('slug', x.slug, 'servicio', x.nombre, 'cargos_cent', x.cargos, 'aportado_cent', x.apo, 'cuadra', x.cargos = x.apo) order by x.id), '[]'::jsonb) into v_por
    from (select s.id, s.slug, s.nombre,
                 coalesce((select sum(c.monto_cent) from costos.cargo c where c.servicio_id = s.id and c.como_capital and (p_mes is null or c.mes = p_mes)), 0)::bigint as cargos,
                 coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a where a.ref_tipo = 'gasto' and a.clasificacion = 'capital'
                             and a.ref_id in (select c.gasto_id from costos.cargo c where c.servicio_id = s.id and c.como_capital and c.gasto_id is not null and (p_mes is null or c.mes = p_mes))), 0)::bigint as apo
            from costos.servicio s where s.activo) x
   where x.cargos <> 0 or x.apo <> 0;
  select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'servicio', s.nombre, 'mes', p.mes, 'usd_micro', p.usd_micro, 'fecha_neg', p.fecha_neg, 'nota', p.nota,
           'motivo', 'Sin tipo de cambio: falta capturarlo') order by s.id, p.mes), '[]'::jsonb) into v_pend
    from costos.cargo_pendiente_tc p join costos.servicio s on s.id = p.servicio_id where p.resuelto_at is null and (p_mes is null or p.mes = p_mes);
  return jsonb_build_object('mes', p_mes, 'cargos_cent', v_cargos, 'aportado_cent', v_apo, 'mayor_cent', v_mayor, 'cargos', v_cargos_n,
    'cuadra', v_cargos = v_apo and v_apo = v_mayor, 'por_servicio', v_por, 'pendientes_tc', v_pend,
    'via1', 'Suma de los cargos capital (costos.cargo)', 'via2', 'Aportaciones de capital del libro de socios ligadas a esos cargos', 'via3', 'Mayor: cuentas 3110 y 3120 de esos asientos');
end $$;

-- Aportaciones por costos del sistema: una fila por cargo (y su reversa), con fecha, servicio, monto MXN, tipo de cambio y referencias.
create function costos.aportaciones_socio(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_total bigint; v_lista jsonb;
begin
  select coalesce(sum(c.monto_cent), 0)::bigint into v_total from costos.cargo c where c.como_capital and c.pagado_por = p_socio;
  select coalesce(jsonb_agg(jsonb_build_object('cargo_id', c.id, 'folio', c.folio, 'fecha_neg', c.fecha_neg, 'mes', c.mes, 'servicio_slug', s.slug, 'servicio', s.nombre, 'logo_slug', s.logo_slug,
           'monto_cent', c.monto_cent, 'moneda', c.moneda, 'base_orig_micro', c.base_orig_micro, 'pct_aplicado_ppm', c.pct_aplicado_ppm, 'tc_micro', c.tc_micro, 'tc_fecha', c.tc_fecha, 'tc_fuente', c.tc_fuente,
           'gasto_folio', (select g.folio from operacion.gasto g where g.id = c.gasto_id), 'aportacion_id', c.aportacion_id, 'intencion', c.intencion,
           'tipo', case when c.reversa_de is null then 'aportacion' else 'reversa' end) order by c.fecha_neg desc, c.id desc), '[]'::jsonb) into v_lista
    from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.como_capital and c.pagado_por = p_socio;
  return jsonb_build_object('socio', p_socio, 'total_cent', v_total, 'aportaciones', v_lista,
    'declaracion', (select valor from costos.parametro where clave = 'costos_como_capital'));
end $$;

-- El resumen del mes conserva su calculo (rename) y se le agregan: acumulado por servicio, USD sin tipo de cambio y la validacion de montos.
alter function costos.resumen_mes(text, boolean) rename to resumen_mes_base;
revoke execute on function costos.resumen_mes_base(text, boolean) from public, anon, authenticated, servidor;

create function costos.resumen_mes(p_mes text, p_incluir_construccion boolean default false) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare r jsonb; v jsonb;
begin
  r := costos.resumen_mes_base(p_mes, p_incluir_construccion);
  v := costos.validacion_mes(p_mes);
  return jsonb_set(r || jsonb_build_object('validacion', v, 'aportacion_javier', costos.aportaciones_socio('javier') - 'aportaciones'), '{servicios}',
    coalesce((select jsonb_agg(x || jsonb_build_object(
        'acumulado_cent', (select coalesce(sum(c.monto_cent), 0)::bigint from costos.cargo c join costos.servicio s on s.id = c.servicio_id where s.slug = x ->> 'slug'),
        'usd_sin_tc_micro', (select coalesce(sum(p.usd_micro), 0)::bigint from costos.cargo_pendiente_tc p join costos.servicio s on s.id = p.servicio_id where s.slug = x ->> 'slug' and p.mes = p_mes and p.resuelto_at is null),
        'cuota_base', costos.cuota_base_vigente(x ->> 'slug', negocio.hoy())) order by ord)
      from jsonb_array_elements(r -> 'servicios') with ordinality t(x, ord)), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* (rol socio) y "Explicar este numero" propio (no pasa por la cadena de api.explicar_cifra)
-- ---------------------------------------------------------------------------
create function api.costos_validacion(p_mes text default null) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return costos.validacion_mes(p_mes); end $$;
create function api.costos_aportaciones(p_socio text default 'javier') returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); if p_socio not in ('angelo', 'javier') then raise exception 'socio desconocido' using errcode = '22023'; end if; return costos.aportaciones_socio(p_socio); end $$;

-- Cifras: costos:aportacion:AAAA-MM (aportado por costos en el mes) y costos:aportacion:total (acumulado). Dos vias: cargos contra libro de socios; el mayor se muestra en un renglon.
create function api.explicar_costos(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare partes text[] := string_to_array(p_cifra, ':'); v_mes text; v jsonb; v_rengs jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if partes[1] is distinct from 'costos' or partes[2] is distinct from 'aportacion' or partes[3] is null or not (partes[3] = 'total' or partes[3] ~ '^\d{4}-(0[1-9]|1[0-2])$') then
    raise exception 'cifra no explicable' using errcode = '22023';
  end if;
  v_mes := case when partes[3] = 'total' then null else partes[3] end;
  v := costos.validacion_mes(v_mes);
  select coalesce(jsonb_agg(jsonb_build_object('concepto', c.folio || ' · ' || s.nombre || ' ' || c.mes || case when c.reversa_de is not null then ' (reversa)' else '' end
           || ' · ' || c.moneda || ' ' || to_char(c.base_orig_micro / 1000000.0, 'FM999,999,990.00') || ' x TC ' || to_char(c.tc_micro / 1000000.0, 'FM990.0000') || ' del ' || c.tc_fecha,
           'monto_cent', c.monto_cent, 'fecha_neg', c.fecha_neg) order by c.fecha_neg, c.id), '[]'::jsonb) into v_rengs
    from costos.cargo c join costos.servicio s on s.id = c.servicio_id where c.como_capital and (v_mes is null or c.mes = v_mes);
  return jsonb_build_object('cifra', p_cifra,
    'titulo', 'Aportación de capital por costos del sistema' || case when v_mes is null then ', acumulada' else ' de ' || v_mes end || ' (pagados por el socio con su tarjeta)', 'valor', (v ->> 'aportado_cent')::bigint, 'unidad', 'mxn',
    'fuente', 'Cada cargo mensual de un servicio atribuido a RTM se registra como aportación de capital declarada del socio que lo paga; no mueve la caja. Suma a su valuación personal y al capital contable.',
    'comprobacion', jsonb_build_object('via1', v ->> 'via1', 'via1_valor', (v ->> 'cargos_cent')::bigint, 'via2', v ->> 'via2', 'via2_valor', (v ->> 'aportado_cent')::bigint,
                                       'cuadra', (v ->> 'cuadra')::boolean),
    'renglones', v_rengs || jsonb_build_array(jsonb_build_object('concepto', 'Mayor (cuentas 3110 y 3120) de esos asientos', 'monto_cent', (v ->> 'mayor_cent')::bigint)),
    'movimientos', '[]'::jsonb);
end $$;

-- Privilegios: nada para PUBLIC; la web solo ve api.*; el sistema ejecuta las lecturas que ya ejecutaba.
revoke execute on function costos.cuota_base_vigente(text, date), costos.fijar_cuota_base(text, text, bigint, date, text), costos.registrar_pendiente_tc(text, text, date, bigint, text),
  costos.resolver_pendiente_tc(text, text), costos.validacion_mes(text), costos.aportaciones_socio(text), costos.resumen_mes(text, boolean), costos.cargo_json(costos.cargo), costos.servicios(),
  costos.pendiente_socio(text), costos.cuenta_por_pagar(text), costos.registrar_cargo(text, text, text, date, text, bigint, text, int, int, bigint, date, text, bigint, bigint, bigint, bigint, bigint, text, boolean, text, text, text, text, text),
  costos.anular_cargo(text, bigint, date, text), operacion.registrar_gasto_socio_capital(text, text, bigint, text, text, date, text, text) from public, anon, authenticated;
grant execute on function costos.resumen_mes(text, boolean) to servidor;
revoke execute on function api.costos_validacion(text), api.costos_aportaciones(text), api.explicar_costos(text) from public, anon;
grant execute on function api.costos_validacion(text), api.costos_aportaciones(text), api.explicar_costos(text) to authenticated;
