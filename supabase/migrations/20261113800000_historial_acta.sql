-- Historial personal por socio y sello del acta de corte (adenda 33). Migracion ADITIVA: lecturas, una tabla inmutable y un disparador diferido. No cambia ninguna regla de dinero.
--  * operacion.acta_sello: foto inmutable del acta al cerrarse con las dos firmas; TODAS sus cifras de valuacion salen de operacion.cap_periodo al corte del acta (una sola fecha).
--  * api.acta_detalle, api.acta_periodo_sugerido, api.acta_disponible: lo que necesita la pantalla del acta y su formulario de decisiones (retira / reinvierte por socio).
--  * api.historial_socio: cabecera, flujos, linea de tiempo de actas, series por dia, semana y mes, por cliente y por modelo. Los ratios (ROI, TIR, payback...) se calculan en TypeScript puro.
--  * api.explicar_historial: "Explicar este numero" de las cifras del historial (dos vias).
-- DEFINICIONES UNICAS (las mismas de api.capital_por_mes y del reporte mensual; este archivo NO las duplica):
--   * participacion: siempre 50/50 (operacion.cap_mitad).
--   * valuacion personal = capital aportado (cuenta 3110 + 3310 - 3210 del mayor) + su 50 % de la utilidad sin acta - fondos de la sociedad en su poder (cap_periodo.valuacion_cent).
--   * invertido = capital aportado acumulado (cap_stock.capital_aportado_cent: declaradas, reinversion por acta y apertura); aportacion neta = aportado (capital + reembolso puesto) - fondos en su poder;
--     diferencia a igualar y turno de aportar: los de cap_periodo.
--   * retirado = retiros de utilidad (retiro, pago de utilidad, liquidacion recibida, apertura) + devolucion de aportaciones (pago_devolucion_aportacion): operacion.retirado_socio, definido UNA vez.

-- Retirado de un socio en una ventana: retiros de utilidad + devolucion de aportaciones. UNICA definicion de "retirado": la usan la tarjeta, "Explicar este numero", cada fila de las series,
-- los flujos de la TIR y el sello del acta. Reutiliza operacion.cap_flujos (retirada = libro del socio + apertura; devoluciones = pago_devolucion_aportacion).
create function operacion.retirado_socio(p_socio bigint, p_nombre text, p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_f jsonb := operacion.cap_flujos(p_socio, p_nombre, p_ini, p_fin);
begin
  return jsonb_build_object('utilidad_cent', (v_f ->> 'retirada_cent')::bigint, 'capital_cent', (v_f ->> 'devoluciones_capital_cent')::bigint,
                            'total_cent', (v_f ->> 'retirada_cent')::bigint + (v_f ->> 'devoluciones_capital_cent')::bigint);
end $$;

-- Valuacion y aportaciones de un socio al cierre de p_hasta: la fila de operacion.cap_periodo (la misma de api.capital_por_mes) y el periodo completo para las identidades.
create function operacion.hist_cap(p_hasta date) returns jsonb
language sql stable security definer set search_path = ''
as $$ select operacion.cap_periodo(p_hasta, p_hasta, false) $$;

create function operacion.hist_cap_socio(p_cap jsonb, p_socio text) returns jsonb
language sql immutable set search_path = ''
as $$ select x from jsonb_array_elements(p_cap -> 'socios') x where x ->> 'socio' = p_socio $$;

-- Piezas y ventas del periodo con las mismas reglas de utilidad_periodo (pedidos enviados y tomas de Omar autorizadas con precio).
create function operacion.volumen_periodo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_pz bigint; v_vt bigint; v_tpz bigint; v_tvt bigint;
begin
  select coalesce(sum((l ->> 'piezas')::bigint), 0)::bigint, coalesce(sum((l ->> 'venta_cent')::bigint), 0)::bigint into v_pz, v_vt
    from operacion.pedido pe
    cross join lateral (select n.snapshot_interno as s from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn
    cross join lateral jsonb_array_elements(coalesce(nn.s -> 'lineas', '[]'::jsonb)) l
   where pe.estado = 'enviado' and pe.fecha_envio between p_ini and p_fin;
  select coalesce(sum(t.piezas), 0)::bigint, coalesce(sum(t.piezas * t.precio_cent), 0)::bigint into v_tpz, v_tvt
    from operacion.toma_omar t where t.estado = 'autorizada' and t.precio_cent is not null and t.fecha_neg between p_ini and p_fin;
  return jsonb_build_object('piezas', v_pz + v_tpz, 'ventas_cent', v_vt + v_tvt);
end $$;

-- Cubetas de calendario: 'dia', 'semana' (lunes a domingo) o 'mes'. La ultima se recorta a p_fin y se marca parcial.
create function operacion.historial_cubetas(p_ini date, p_fin date, p_paso text) returns table (n int, ini date, fin date, parcial boolean)
language plpgsql stable set search_path = ''
as $$
begin
  if p_paso not in ('dia', 'semana', 'mes') then raise exception 'paso desconocido' using errcode = '22023'; end if;
  if p_paso = 'dia' then
    return query select (row_number() over (order by d))::int, d::date, d::date, false from generate_series(p_ini::timestamp, p_fin::timestamp, interval '1 day') d;
  elsif p_paso = 'semana' then
    return query select (row_number() over (order by d))::int, d::date, least((d + interval '6 days')::date, p_fin), (d + interval '6 days')::date > p_fin
      from generate_series(date_trunc('week', p_ini::timestamp), p_fin::timestamp, interval '7 days') d;
  else
    return query select (row_number() over (order by d))::int, d::date, least((d + interval '1 month - 1 day')::date, p_fin), (d + interval '1 month - 1 day')::date > p_fin
      from generate_series(date_trunc('month', p_ini::timestamp), p_fin::timestamp, interval '1 month') d;
  end if;
end $$;

-- Una cubeta de la serie de un socio: utilidad de la empresa, su 50 % (cap_mitad), volumen, retirado, reinversion y aportaciones declaradas.
create function operacion.historial_fila(p_socio text, p_id bigint, p_ini date, p_fin date, p_parcial boolean) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_u jsonb; v_v jsonb; v_ret bigint; v_rei bigint; v_apo bigint;
begin
  v_u := operacion.utilidad_periodo(p_ini, p_fin);
  v_v := operacion.volumen_periodo(p_ini, p_fin);
  -- Retirado: la definicion unica (retiros de utilidad + devolucion de aportaciones).
  v_ret := (operacion.retirado_socio(p_id, p_socio, p_ini, p_fin) ->> 'total_cent')::bigint;
  -- La reinversion pertenece al periodo del acta que la decidio (no al dia en que se firmo): se ubica por periodo_fin del acta de origen.
  select coalesce(sum(a.monto_cent), 0)::bigint into v_rei from operacion.aportacion_socio a left join operacion.cierre_reparto k on k.id = a.ref_id
   where a.socio_id = p_id and a.ref_tipo = 'reinversion' and coalesce(k.periodo_fin, a.fecha_neg) between p_ini and p_fin;
  select coalesce(sum(a.monto_cent), 0)::bigint into v_apo from operacion.aportacion_socio a
   where a.socio_id = p_id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion' and a.fecha_neg between p_ini and p_fin;
  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'parcial', p_parcial, 'utilidad_cent', (v_u ->> 'utilidad_cent')::bigint, 'parte_cent', operacion.cap_mitad((v_u ->> 'utilidad_cent')::bigint, p_socio),
    'pedidos', (v_u ->> 'pedidos')::int, 'piezas', (v_v ->> 'piezas')::bigint, 'ventas_cent', (v_v ->> 'ventas_cent')::bigint,
    'retiros_cent', v_ret, 'reinversion_cent', v_rei, 'aportaciones_cent', v_apo, 'provisional', (v_u ->> 'provisional')::boolean);
end $$;

-- ---------------------------------------------------------------------------
-- Sello del acta: foto inmutable al cerrarse con las dos firmas (el calculo ya se recalculo al firmar; esto fija lo que quedo)
-- ---------------------------------------------------------------------------
create table operacion.acta_sello (
  cierre_id bigint primary key references operacion.cierre_reparto (id),
  sellado_at timestamptz not null default now(),
  fecha_neg date not null,
  contenido jsonb not null,
  huella text not null check (huella ~ '^[0-9a-f]{64}$')
);
alter table operacion.acta_sello enable row level security;
alter table operacion.acta_sello force row level security;
revoke all on operacion.acta_sello from public, anon, authenticated;

create function operacion.acta_sello_inmutable() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'el sello de un acta no se modifica ni se borra: se corrige con una contra-acta' using errcode = '42501'; end $$;
create trigger acta_sello_inmutable before update or delete on operacion.acta_sello for each row execute function operacion.acta_sello_inmutable();

create function operacion.sellar_acta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c operacion.cierre_reparto; v_val jsonb; v_cap jsonb; v_fila jsonb; v_cont jsonb; v_valor jsonb := '{}'::jsonb; v_soc jsonb := '{}'::jsonb; s record; v_comp bigint; v_ret jsonb;
  v_disp bigint; v_d jsonb; v_cap_ok boolean := false;
begin
  select * into c from operacion.cierre_reparto where id = new.cierre_id;
  if not found or c.tipo <> 'periodo' then return null; end if;
  if (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) < 2 then return null; end if;
  if exists (select 1 from operacion.acta_sello x where x.cierre_id = c.id) then return null; end if;
  -- UNA sola fecha: todas las cifras de valuacion son AL CORTE del acta (periodo_fin) y salen de la misma funcion que api.capital_por_mes. La decision del acta (retira, reinvierte) se asienta despues
  -- del corte y se guarda aparte, en 'decisiones' y 'queda_cent'. Un fallo de la valuacion nunca debe impedir que el acta se cierre: el sello queda sin esas cifras.
  begin
    v_cap := operacion.cap_periodo(c.periodo_ini, c.periodo_fin, false);
    v_val := contabilidad.valuacion(c.periodo_fin);
    v_cap_ok := coalesce((v_val ->> 'con_movimientos')::boolean, false);
  exception when others then v_cap := null; v_val := null; v_cap_ok := false;
  end;
  for s in select id, nombre from catalogo.socio where nombre in ('Angelo', 'Javier') order by nombre loop
    select coalesce(-sum(m.monto_cent), 0)::bigint into v_comp from operacion.cuenta_socio_mov m where m.socio_id = s.id and m.evento_id = new.evento_id and m.concepto = 'compensacion_reparto';
    v_ret := operacion.retirado_socio(s.id, s.nombre, date '1900-01-01', c.periodo_fin);
    v_d := c.decisiones -> s.nombre;
    v_disp := greatest(coalesce((c.snapshot -> 'por_socio' -> s.nombre ->> 'utilidad_cent')::bigint, 0) - coalesce((c.snapshot -> 'por_socio' -> s.nombre ->> 'anticipo_cent')::bigint, 0), 0);
    v_fila := case when v_cap_ok then operacion.hist_cap_socio(v_cap, s.nombre) end;
    if v_fila is not null then v_valor := v_valor || jsonb_build_object(s.nombre, (v_fila ->> 'valuacion_cent')::bigint); end if;
    v_soc := v_soc || jsonb_build_object(s.nombre, jsonb_build_object(
      'invertido_cent', (v_fila ->> 'capital_aportado_acum_cent')::bigint,
      'aportacion_neta_cent', (v_fila ->> 'aportacion_neta_cent')::bigint,
      'fondos_en_poder_cent', (v_fila ->> 'fondos_en_poder_cent')::bigint,
      'valuacion_cent', (v_fila ->> 'valuacion_cent')::bigint,
      'retirado_cent', (v_ret ->> 'total_cent')::bigint,
      -- Tras la decision del acta (arithmetica sobre las cifras AL CORTE: lo que retira y lo que reinvierte se asienta despues del corte).
      'invertido_tras_acta_cent', (v_fila ->> 'capital_aportado_acum_cent')::bigint + coalesce((v_d ->> 'reinvierte')::bigint, 0),
      'retirado_tras_acta_cent', (v_ret ->> 'total_cent')::bigint + coalesce((v_d ->> 'retira')::bigint, 0),
      'queda_cent', v_disp - coalesce((v_d ->> 'retira')::bigint, 0) - coalesce((v_d ->> 'reinvierte')::bigint, 0),
      'compensaciones_cent', v_comp));
  end loop;
  v_cont := jsonb_build_object(
    'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent, 'huella_cascada', operacion.huella_cascada(c.snapshot), 'decisiones', c.decisiones,
    'al_corte', c.periodo_fin,
    'valuacion_cent', case when v_cap_ok then (v_val ->> 'v01_valuacion_cent')::bigint end,
    'deudas_cent', case when v_cap_ok then (v_val ->> 'v02_deudas_cent')::bigint end,
    'capital_contable_cent', case when v_cap_ok then (v_cap -> 'balance' ->> 'total_capital_cent')::bigint end,
    'valor_participacion_cent', case when v_cap_ok then v_valor end,
    'por_socio', v_soc);
  insert into operacion.acta_sello (cierre_id, fecha_neg, contenido, huella)
    values (c.id, negocio.hoy(), v_cont, encode(sha256(convert_to(v_cont::text, 'UTF8')), 'hex'));
  return null;
end $$;

-- Diferido: corre al confirmar la transaccion de la firma, cuando ya estan asentados la utilidad, la reinversion y las compensaciones del acta.
create constraint trigger acta_sello_firma after insert on operacion.cierre_reparto_firma deferrable initially deferred for each row execute function operacion.sellar_acta();

-- ---------------------------------------------------------------------------
-- Acta: periodo sugerido y detalle
-- ---------------------------------------------------------------------------
-- El siguiente corte mensual: el mes que sigue al ultimo acta vigente (o el primer mes con actividad). Solo se puede proponer cuando el mes ya termino.
create function api.acta_periodo_sugerido() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy(); v_ult date := operacion.ultimo_cierre_firmado_fin(); v_pend bigint; v_ini date; v_fin date; v_primera date;
begin
  perform seguridad.exigir_rol(array['socio']);
  select min(f) into v_primera from (select min(fecha_neg) f from operacion.pedido union all select min(fecha_neg) from operacion.aportacion_socio union all select min(fecha_neg) from operacion.gasto) x;
  select cierre_id into v_pend from operacion.cierre_periodo_vigente v where (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = v.cierre_id) < 2 order by cierre_id desc limit 1;
  v_ini := case when v_ult is not null then v_ult + 1 else date_trunc('month', coalesce(v_primera, v_hoy))::date end;
  v_fin := (date_trunc('month', v_ini::timestamp) + interval '1 month - 1 day')::date;
  return jsonb_build_object('ini', v_ini, 'fin', v_fin, 'hoy', v_hoy, 'ultimo_corte', v_ult, 'listo', v_fin < v_hoy and v_pend is null, 'disponible_desde', v_fin + 1,
    'acta_pendiente_id', v_pend, 'hay_actividad', v_primera is not null);
end $$;

create function api.acta_detalle(p_cierre bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_c jsonb; v_s jsonb; v_corrige text; v_contra text; v_disp jsonb; v_ucuadra boolean; k text; v_cu boolean;
begin
  perform seguridad.exigir_rol(array['socio']);
  select x into v_c from jsonb_array_elements(api.cierres_reparto()) x where (x ->> 'id')::bigint = p_cierre;
  if v_c is null then return null; end if;
  select jsonb_build_object('contenido', s.contenido, 'huella', s.huella, 'sellado_at', s.sellado_at) into v_s from operacion.acta_sello s where s.cierre_id = p_cierre;
  select o.folio into v_corrige from operacion.cierre_reparto c join operacion.cierre_reparto o on o.id = c.corrige_a where c.id = p_cierre;
  select k.folio into v_contra from operacion.cierre_reparto k where k.corrige_a = p_cierre;
  -- Disponible (utilidad menos lo ya recibido, sin bajar de cero) y lo que queda por distribuir tras las decisiones: la resta vive aqui, la pantalla solo la muestra.
  select coalesce(jsonb_object_agg(e.key, jsonb_build_object(
           'disponible_cent', greatest((e.value ->> 'utilidad_cent')::bigint - (e.value ->> 'anticipo_cent')::bigint, 0),
           'queda_cent', greatest((e.value ->> 'utilidad_cent')::bigint - (e.value ->> 'anticipo_cent')::bigint, 0)
                         - coalesce((v_c -> 'decisiones' -> e.key ->> 'retira')::bigint, 0) - coalesce((v_c -> 'decisiones' -> e.key ->> 'reinvierte')::bigint, 0))), '{}'::jsonb)
    into v_disp from jsonb_each(coalesce(v_c -> 'snapshot' -> 'por_socio', '{}'::jsonb)) e where (v_c ->> 'tipo') <> 'contra';
  -- Resultado de la comprobacion por dos vias de lo que la pantalla muestra con "Explicar este numero" (null = sin comprobar): la pantalla no lo decide, solo lo muestra.
  if (v_c ->> 'tipo') <> 'contra' then
    begin v_ucuadra := (api.explicar_cifra('cascada:utilidad:' || (v_c ->> 'periodo_ini') || ':' || (v_c ->> 'periodo_fin')) -> 'comprobacion' ->> 'cuadra')::boolean; exception when others then v_ucuadra := null; end;
    for k in select jsonb_object_keys(v_disp) loop
      begin v_cu := (api.explicar_historial('historial:parte:' || p_cierre || ':' || k) -> 'comprobacion' ->> 'cuadra')::boolean; exception when others then v_cu := null; end;
      v_disp := jsonb_set(v_disp, array[k, 'cuadra'], coalesce(to_jsonb(v_cu), 'null'::jsonb));
    end loop;
  end if;
  return jsonb_build_object('cierre', v_c, 'sello', v_s, 'corrige_folio', v_corrige, 'contra_acta_folio', v_contra, 'por_socio_acta', v_disp, 'utilidad_cuadra', v_ucuadra);
end $$;

-- Disponible por socio de un periodo para el formulario de la propuesta (utilidad menos lo ya recibido, sin bajar de cero). Misma resta que el tope que valida la base.
create function api.acta_disponible(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_p jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_p := api.cascada_proyeccion(p_ini, p_fin);
  return coalesce((select jsonb_object_agg(e.key, jsonb_build_object('disponible_cent', greatest((e.value ->> 'utilidad_cent')::bigint - (e.value ->> 'anticipo_cent')::bigint, 0)))
                     from jsonb_each(v_p -> 'por_socio') e), '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Historial personal
-- ---------------------------------------------------------------------------
create function operacion.historial_socio(p_socio text, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy(); v_hasta date := least(coalesce(p_hasta, v_hoy), negocio.hoy()); v_id bigint; v_otro bigint; v_primera date; v_ini_mes date;
  v_inv bigint; v_rei bigint; v_ret jsonb; v_cap jsonb; v_fila jsonb; v_ef jsonb; v_u jsonb; v_vol jsonb; v_flujos jsonb; v_actas jsonb;
  v_dias jsonb; v_sem jsonb; v_mes jsonb; v_cli_top jsonb; v_mod_top jsonb; v_cab jsonb; v_meses int; v_comp jsonb := '{}'::jsonb;
  r record;
begin
  select id into v_id from catalogo.socio where nombre = p_socio and nombre in ('Angelo', 'Javier');
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  select id into v_otro from catalogo.socio where nombre in ('Angelo', 'Javier') and id <> v_id;
  select min(f) into v_primera from (select min(fecha_neg) f from operacion.pedido where estado = 'enviado' union all select min(fecha_neg) from operacion.aportacion_socio
                                     union all select min(fecha_neg) from operacion.socio_libro union all select min(fecha_neg) from operacion.gasto) x;
  v_primera := least(v_primera, v_hasta);

  -- Cabecera (estado a la fecha de corte; por omision hoy). TODAS las cifras de capital salen de operacion.cap_periodo (la misma funcion de api.capital_por_mes), sin definiciones propias:
  --   invertido = capital aportado acumulado; valor = valuacion personal; aportacion neta, diferencia a igualar y turno; retirado = retirado_socio (retiros de utilidad + devolucion de aportaciones).
  v_cap := operacion.hist_cap(v_hasta);
  v_fila := operacion.hist_cap_socio(v_cap, p_socio);
  select coalesce(sum(a.monto_cent), 0)::bigint into v_rei from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital' and a.ref_tipo = 'reinversion' and a.fecha_neg <= v_hasta;
  v_inv := (v_fila ->> 'capital_aportado_acum_cent')::bigint;
  v_ret := operacion.retirado_socio(v_id, p_socio, date '1900-01-01', v_hasta);
  v_ef := operacion.efectivo_sociedad();
  v_meses := case when v_primera is null then 0 else greatest(1, (extract(year from age(v_hasta, v_primera)) * 12 + extract(month from age(v_hasta, v_primera)))::int + 1) end;

  v_cab := jsonb_build_object(
    'aportaciones_cent', v_inv - v_rei, 'reinversion_cent', v_rei, 'invertido_cent', v_inv,
    'invertido_ambos_cent', (v_cap -> 'total' ->> 'capital_aportado_acum_cent')::bigint,
    'retirado_utilidad_cent', (v_ret ->> 'utilidad_cent')::bigint, 'retirado_capital_cent', (v_ret ->> 'capital_cent')::bigint, 'retirado_cent', (v_ret ->> 'total_cent')::bigint,
    'utilidad_asignada_cent', operacion.libro_socio(v_id, 'utilidad_asignada'), 'utilidad_por_distribuir_cent', operacion.utilidad_por_distribuir(v_id),
    'capital_contable_cent', (v_cap -> 'balance' ->> 'total_capital_cent')::bigint,
    'valor_cent', case when (v_cap ->> 'hay_movimientos')::boolean then (v_fila ->> 'valuacion_cent')::bigint end, 'valor_libro_cent', (v_fila ->> 'valuacion_libro_cent')::bigint, 'participacion_bp', (v_fila ->> 'participacion_bp')::int,
    'aportado_cent', (v_fila ->> 'aportado_cent')::bigint, 'fondos_cent', (v_fila ->> 'fondos_en_poder_cent')::bigint,
    'aportacion_neta_cent', (v_fila ->> 'aportacion_neta_cent')::bigint, 'diferencia_a_igualar_cent', (v_fila ->> 'diferencia_a_igualar_cent')::bigint,
    'le_toca_aportar', (v_fila ->> 'le_toca_aportar')::boolean, 'turno_aportar', v_cap ->> 'turno_aportar', 'igualados', (v_cap ->> 'igualados')::boolean,
    'reembolso_pendiente_cent', operacion.reembolso_pendiente(v_id),
    'efectivo_total_cent', (v_ef ->> 'total_cent')::bigint, 'efectivo_disponible_cent', (v_ef ->> 'disponible_cent')::bigint,
    'primera_fecha', v_primera, 'meses_activo', v_meses);
  -- Estado de la comprobacion por dos vias de cada cifra de la cabecera: sale de la misma funcion que usa "Explicar este numero", con el mismo periodo ya calculado (null = sin dato o sin comprobar).
  for r in select unnest(array['invertido', 'retirado', 'utilidad', 'valor', 'neta']) as k loop
    begin
      v_comp := v_comp || jsonb_build_object(r.k, (operacion.explicar_historial('historial:' || r.k || ':' || p_socio, v_cap, v_hasta) -> 'comprobacion' ->> 'cuadra')::boolean);
    exception when others then v_comp := v_comp || jsonb_build_object(r.k, null);
    end;
  end loop;
  v_cab := v_cab || jsonb_build_object('comprobaciones', v_comp);

  -- Totales de toda la historia hasta la fecha de corte.
  if v_primera is not null then
    v_u := operacion.utilidad_periodo(v_primera, v_hasta);
    v_vol := operacion.volumen_periodo(v_primera, v_hasta);
  end if;

  -- Flujos fechados del socio para su TIR: lo invertido (salida: aportaciones declaradas y capital de apertura; la reinversion es dinero que ya estaba dentro) y lo retirado (entrada, misma definicion
  -- que la tarjeta: retiros de utilidad, liquidaciones recibidas, retiros de la apertura y devolucion de aportaciones). Una reversa cuenta con la fecha en que se deshizo.
  select coalesce(jsonb_agg(f order by (f ->> 'fecha')), '[]'::jsonb) into v_flujos from (
    select jsonb_build_object('fecha', a.fecha_neg, 'monto_cent', -a.monto_cent, 'tipo', 'aportacion') f from operacion.aportacion_socio a
     where a.socio_id = v_id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion'
    union all
    select jsonb_build_object('fecha', a.fecha_contable, 'monto_cent', -(l.haber_cent - l.debe_cent), 'tipo', 'aportacion')
      from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
     where l.cuenta = contabilidad.cta_socio(v_id, 3110) and a.es_apertura and not exists (select 1 from contabilidad.asiento rv where rv.reversa_de = a.id) and (l.haber_cent - l.debe_cent) <> 0
    union all
    select jsonb_build_object('fecha', l.fecha_neg, 'monto_cent', -l.monto_cent, 'tipo', case when coalesce(o.concepto, l.concepto) = 'pago_devolucion_aportacion' then 'retiro_capital' else 'retiro' end)
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
     where l.socio_id = v_id and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida', 'pago_devolucion_aportacion')
    union all
    select jsonb_build_object('fecha', a.fecha_contable, 'monto_cent', (l.debe_cent - l.haber_cent), 'tipo', 'retiro')
      from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
     where l.cuenta = contabilidad.cta_socio(v_id, 3210) and a.es_apertura and not exists (select 1 from contabilidad.asiento rv where rv.reversa_de = a.id) and (l.debe_cent - l.haber_cent) <> 0) q;

  -- Linea de tiempo de actas (la contra-acta se ve como un renglon propio).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'folio', c.folio, 'tipo', c.tipo, 'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent,
      'parte_cent', coalesce((c.snapshot -> 'por_socio' -> p_socio ->> 'utilidad_cent')::bigint, 0),
      'retira_cent', coalesce((c.decisiones -> p_socio ->> 'retira')::bigint, 0), 'reinvierte_cent', coalesce((c.decisiones -> p_socio ->> 'reinvierte')::bigint, 0),
      'estado', case when exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then 'anulado'
                     when (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2 then 'cerrado'
                     when exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id) then 'firmado_por_uno' else 'propuesto' end,
      -- Corregida = hay una contra-acta FIRMADA por los dos (su efecto ya se deshizo); con la contra-acta solo propuesta el acta sigue vigente.
      'corregida', exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = k.id)
                           and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = k.id) >= 2),
      'contra_propuesta', exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = k.id)
                                  and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = k.id) < 2),
      'firmas', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'firmado_at', f.firmado_at) order by f.id) from operacion.cierre_reparto_firma f join catalogo.socio s on s.id = f.socio_id where f.cierre_id = c.id), '[]'::jsonb),
      'capital_contable_cent', (select (s.contenido ->> 'capital_contable_cent')::bigint from operacion.acta_sello s where s.cierre_id = c.id),
      'valor_cent', (select (s.contenido -> 'valor_participacion_cent' ->> p_socio)::bigint from operacion.acta_sello s where s.cierre_id = c.id),
      'huella', (select s.huella from operacion.acta_sello s where s.cierre_id = c.id)) order by c.periodo_fin desc, c.id desc), '[]'::jsonb)
    into v_actas from operacion.cierre_reparto c where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id);

  -- Series: ultimos 60 dias, 26 semanas y los meses desde la primera actividad (maximo 36).
  v_dias := '[]'::jsonb; v_sem := '[]'::jsonb; v_mes := '[]'::jsonb;
  if v_primera is not null then
    for r in select * from operacion.historial_cubetas(greatest(v_primera, v_hasta - 59), v_hasta, 'dia') loop
      v_dias := v_dias || operacion.historial_fila(p_socio, v_id, r.ini, r.fin, r.parcial);
    end loop;
    for r in select * from operacion.historial_cubetas(greatest(v_primera, (date_trunc('week', v_hasta::timestamp) - interval '25 weeks')::date), v_hasta, 'semana') loop
      v_sem := v_sem || operacion.historial_fila(p_socio, v_id, greatest(r.ini, v_primera), r.fin, r.parcial);
    end loop;
    v_ini_mes := greatest(date_trunc('month', v_primera)::date, (date_trunc('month', v_hasta::timestamp) - interval '35 months')::date);
    for r in select * from operacion.historial_cubetas(v_ini_mes, v_hasta, 'mes') loop
      v_mes := v_mes || operacion.historial_fila(p_socio, v_id, greatest(r.ini, v_primera), r.fin, r.parcial);
    end loop;

    -- Utilidad por cliente (pedido enviado) y por modelo (venta menos costo), con la utilidad que ya trae la nota de cada pedido.
    select coalesce(jsonb_agg(jsonb_build_object('cliente_id', q.cid, 'cliente', q.nombre, 'pedidos', q.pedidos, 'piezas', q.piezas, 'utilidad_cent', q.util, 'parte_cent', operacion.cap_mitad(q.util, p_socio))
                             order by q.util desc, q.nombre), '[]'::jsonb) into v_cli_top
      from (select * from (select cl.id as cid, cl.nombre_canonico as nombre, count(*)::int as pedidos,
                   coalesce(sum((select sum((l ->> 'piezas')::int) from jsonb_array_elements(coalesce(nn.s -> 'lineas', '[]'::jsonb)) l)), 0)::bigint as piezas,
                   coalesce(sum((nn.s -> 'cascada' ->> 'utilidad_cent')::bigint), 0)::bigint as util
              from operacion.pedido pe join catalogo.cliente cl on cl.id = pe.cliente_id
              cross join lateral (select n.snapshot_interno as s from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn
             where pe.estado = 'enviado' and pe.fecha_envio between v_primera and v_hasta group by cl.id, cl.nombre_canonico) z order by z.util desc, z.nombre limit 10) q;
    select coalesce(jsonb_agg(jsonb_build_object('modelo', q.modelo, 'piezas', q.piezas, 'venta_cent', q.venta, 'costo_cent', q.costo, 'utilidad_cent', q.venta - q.costo, 'parte_cent', operacion.cap_mitad(q.venta - q.costo, p_socio))
                             order by q.venta - q.costo desc, q.modelo), '[]'::jsonb) into v_mod_top
      from (select * from (select m ->> 'modelo' as modelo, sum((m ->> 'piezas')::int)::bigint as piezas, sum((m ->> 'venta_cent')::bigint)::bigint as venta, sum((m ->> 'costo_cent')::bigint)::bigint as costo
              from operacion.pedido pe
              cross join lateral (select n.snapshot_interno as s from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn
              cross join lateral jsonb_array_elements(coalesce(nn.s -> 'por_modelo', '[]'::jsonb)) m
             where pe.estado = 'enviado' and pe.fecha_envio between v_primera and v_hasta group by m ->> 'modelo') z order by z.venta - z.costo desc, z.modelo limit 10) q;
  end if;

  return jsonb_build_object(
    'socio', p_socio, 'otro', (select nombre from catalogo.socio where id = v_otro), 'hoy', v_hoy, 'hasta', v_hasta, 'con_historial', v_primera is not null,
    'cabecera', v_cab, 'flujos', v_flujos, 'actas', v_actas,
    'totales', case when v_primera is null then null else jsonb_build_object('utilidad_cent', (v_u ->> 'utilidad_cent')::bigint, 'parte_cent', operacion.cap_mitad((v_u ->> 'utilidad_cent')::bigint, p_socio),
      'pedidos', (v_u ->> 'pedidos')::int, 'piezas', (v_vol ->> 'piezas')::bigint, 'ventas_cent', (v_vol ->> 'ventas_cent')::bigint, 'provisional', (v_u ->> 'provisional')::boolean) end,
    'dias', v_dias, 'semanas', v_sem, 'meses', v_mes, 'por_cliente', coalesce(v_cli_top, '[]'::jsonb), 'por_modelo', coalesce(v_mod_top, '[]'::jsonb));
end $$;

create function api.historial_socio(p_socio text, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.historial_socio(p_socio, p_hasta);
end $$;

-- ---------------------------------------------------------------------------
-- Explicar este numero del historial (dos vias por cifra). Mismo formato que api.explicar_cifra; la clave `comprobacion` solo existe si hay dos vias reales.
--   historial:invertido|retirado|utilidad|valor|neta:<socio>      historial:parte:<acta id>:<socio>
-- La funcion de operacion recibe opcionalmente el periodo ya calculado (cap_periodo) para no recalcularlo por cada cifra de la cabecera.
-- ---------------------------------------------------------------------------
create function operacion.explicar_historial(p_cifra text, p_cap jsonb default null, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_id bigint; v_otro_n text; v_rengs jsonb; v_via1 bigint; v_via2 bigint; c operacion.cierre_reparto; v_x jsonb; v_d jsonb; v_disp bigint; v_ap bigint;
  v_hasta date := coalesce(p_hasta, negocio.hoy()); v_cap jsonb; v_fila jsonb; v_otro jsonb; v_ret jsonb; v_c3110 text; v_c3210 text; v_c3310 text; v_c1150 text; v_libro bigint; v_v04 bigint; v_mitad bigint; v_fondos_tot bigint;
begin
  if partes[1] <> 'historial' or partes[2] is null then raise exception 'cifra no explicable' using errcode = '22023'; end if;
  if partes[2] = 'parte' then
    select * into c from operacion.cierre_reparto where id = partes[3]::bigint and tipo = 'periodo';
    if not found then raise exception 'acta desconocida' using errcode = '22023'; end if;
    v_x := c.snapshot -> 'por_socio' -> partes[4]; v_d := c.decisiones -> partes[4];
    if v_x is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
    v_disp := greatest((v_x ->> 'utilidad_cent')::bigint - (v_x ->> 'anticipo_cent')::bigint, 0);
    v_via1 := v_disp;
    -- Segunda via independiente: las dos partes 50/50 suman lo repartible del acta, asi que su parte es lo repartible menos la parte del otro socio (menos lo ya recibido).
    v_via2 := case when c.snapshot ? 'repartible_cent' and jsonb_typeof(c.snapshot -> 'por_socio') = 'object' and (select count(*) from jsonb_object_keys(c.snapshot -> 'por_socio')) = 2
                   then greatest((c.snapshot ->> 'repartible_cent')::bigint - (select sum((e.value ->> 'utilidad_cent')::bigint) from jsonb_each(c.snapshot -> 'por_socio') e where e.key <> partes[4])
                                 - (v_x ->> 'anticipo_cent')::bigint, 0) end;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Utilidad neta del periodo del acta ' || c.folio, 'monto_cent', c.utilidad_cent),
      jsonb_build_object('concepto', 'Su parte de la utilidad repartible (50/50 fijo)', 'monto_cent', (v_x ->> 'utilidad_cent')::bigint),
      jsonb_build_object('concepto', 'Menos lo que ya recibio como retiro anticipado', 'monto_cent', -(v_x ->> 'anticipo_cent')::bigint),
      jsonb_build_object('concepto', 'Retira en el acta', 'monto_cent', coalesce((v_d ->> 'retira')::bigint, 0)),
      jsonb_build_object('concepto', 'Reinvierte en el acta', 'monto_cent', coalesce((v_d ->> 'reinvierte')::bigint, 0)),
      jsonb_build_object('concepto', 'Queda por distribuir', 'monto_cent', v_disp - coalesce((v_d ->> 'retira')::bigint, 0) - coalesce((v_d ->> 'reinvierte')::bigint, 0)));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Parte de ' || partes[4] || ' en el acta ' || c.folio || ' (disponible para retirar, reinvertir o dejar por distribuir)', 'valor', v_via1, 'unidad', 'mxn',
      'renglones', v_rengs, 'movimientos', '[]'::jsonb)
      -- Sin segunda via no hay comprobacion: la clave se OMITE (nunca va con valores nulos) para que el esquema de la pantalla no la rechace.
      || case when v_via2 is null then '{}'::jsonb else jsonb_build_object('comprobacion', jsonb_build_object('via1', 'Su parte del acta menos lo ya recibido', 'via1_valor', v_via1,
           'via2', 'Lo repartible del acta menos la parte del otro socio, menos lo ya recibido', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2)) end;
  end if;
  select id into v_id from catalogo.socio where nombre = partes[3] and nombre in ('Angelo', 'Javier');
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  v_c3110 := contabilidad.cta_socio(v_id, 3110); v_c3210 := contabilidad.cta_socio(v_id, 3210); v_c3310 := contabilidad.cta_socio(v_id, 3310);
  if partes[2] = 'invertido' then
    -- Invertido = capital aportado acumulado (la misma cifra de api.capital_por_mes): aportaciones declaradas, reinversion por acta y capital de la apertura.
    v_cap := coalesce(p_cap, operacion.hist_cap(v_hasta)); v_fila := operacion.hist_cap_socio(v_cap, partes[3]);
    select coalesce(jsonb_agg(jsonb_build_object('concepto', a.concepto || case when a.ref_tipo = 'reinversion' then ' (reinversion)' else ' (aportacion)' end, 'monto_cent', a.monto_cent, 'fecha_neg', a.fecha_neg) order by a.fecha_neg, a.id), '[]'::jsonb)
      into v_rengs from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital' and a.fecha_neg <= v_hasta;
    v_ap := operacion.cap_apertura(v_c3110, v_hasta);
    if v_ap <> 0 then v_rengs := v_rengs || jsonb_build_array(jsonb_build_object('concepto', 'Capital de la apertura firmada', 'monto_cent', v_ap)); end if;
    v_via1 := (v_fila ->> 'capital_aportado_acum_cent')::bigint;
    -- Via 2: las aportaciones declaradas mas la reinversion segun el OTRO libro (la baja de utilidad por distribuir que asienta el acta), mas la apertura.
    v_via2 := (select coalesce(sum(a.monto_cent), 0) from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion' and a.fecha_neg <= v_hasta)
              - (select coalesce(sum(l.monto_cent), 0) from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de where l.socio_id = v_id and l.fecha_neg <= v_hasta and coalesce(o.concepto, l.concepto) = 'reinversion')
              + v_ap;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Invertido por ' || partes[3] || ' (capital aportado: aportaciones declaradas, reinversiones de utilidad y apertura)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Capital aportado acumulado (la cifra de Capital por mes)', 'via1_valor', v_via1, 'via2', 'Aportaciones declaradas mas la reinversion segun el libro de utilidad del socio, mas la apertura', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'retirado' then
    -- Retirado = retiros de utilidad + devolucion de aportaciones (operacion.retirado_socio). Via 2: renglon por renglon del libro y de la apertura.
    v_ret := operacion.retirado_socio(v_id, partes[3], date '1900-01-01', v_hasta);
    select coalesce(jsonb_agg(jsonb_build_object('concepto', coalesce(l.nota, replace(coalesce(o.concepto, l.concepto), '_', ' ')) || case when o.id is not null then ' (reversa)' else '' end, 'monto_cent', -l.monto_cent, 'fecha_neg', l.fecha_neg) order by l.fecha_neg, l.id), '[]'::jsonb),
           coalesce(-sum(l.monto_cent), 0)::bigint into v_rengs, v_via2
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
     where l.socio_id = v_id and l.fecha_neg <= v_hasta and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida', 'pago_devolucion_aportacion');
    v_via1 := (v_ret ->> 'total_cent')::bigint;
    -- La apertura firmada trae retiros anteriores al sistema (cuenta 3210).
    v_ap := coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                       where l.cuenta = v_c3210 and a.es_apertura and a.fecha_contable <= v_hasta and not exists (select 1 from contabilidad.asiento rv where rv.reversa_de = a.id)), 0)::bigint;
    if v_ap <> 0 then
      v_rengs := v_rengs || jsonb_build_array(jsonb_build_object('concepto', 'Retiros anteriores al sistema (apertura firmada)', 'monto_cent', v_ap));
      v_via2 := v_via2 + v_ap;
    end if;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Retirado por ' || partes[3] || ' (retiros de utilidad, liquidaciones recibidas y devolucion de aportaciones)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Retiros de utilidad (' || (v_ret ->> 'utilidad_cent') || ' centavos) mas devolucion de aportaciones (' || (v_ret ->> 'capital_cent') || ' centavos)', 'via1_valor', v_via1, 'via2', 'Renglon por renglon del libro y la apertura', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'utilidad' then
    select coalesce(jsonb_agg(jsonb_build_object('concepto', coalesce(l.nota, 'Utilidad asignada') || case when o.id is not null then ' (reversa)' else '' end, 'monto_cent', l.monto_cent, 'fecha_neg', l.fecha_neg) order by l.fecha_neg, l.id), '[]'::jsonb),
           coalesce(sum(l.monto_cent), 0)::bigint into v_rengs, v_via2
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de where l.socio_id = v_id and coalesce(o.concepto, l.concepto) = 'utilidad_asignada';
    v_via1 := operacion.libro_socio(v_id, 'utilidad_asignada');
    -- Igual que arriba: la apertura firmada trae utilidad asignada anterior al sistema (cuenta 3310).
    v_ap := contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 3310));
    if v_ap <> 0 then
      v_rengs := v_rengs || jsonb_build_array(jsonb_build_object('concepto', 'Utilidad asignada anterior al sistema (apertura firmada)', 'monto_cent', v_ap));
      v_via2 := v_via2 + v_ap;
    end if;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Utilidad recibida por ' || partes[3] || ' en actas firmadas', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma por concepto del libro', 'via1_valor', v_via1, 'via2', 'Renglon por renglon', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'valor' then
    -- Valuacion personal (la definicion vigente de Capital por mes): capital aportado + su 50 % de la utilidad sin acta - fondos de la sociedad en su poder.
    v_cap := coalesce(p_cap, operacion.hist_cap(v_hasta)); v_fila := operacion.hist_cap_socio(v_cap, partes[3]);
    if not (v_cap ->> 'hay_movimientos')::boolean then raise exception 'sin dato: todavia no hay asientos contables' using errcode = 'P0428'; end if;
    select nombre into v_otro_n from catalogo.socio where nombre in ('Angelo', 'Javier') and id <> v_id;
    v_otro := operacion.hist_cap_socio(v_cap, v_otro_n);
    v_via1 := (v_fila ->> 'valuacion_cent')::bigint;
    v_libro := (operacion.cap_stock(v_id, partes[3], v_hasta) ->> 'capital_libro_cent')::bigint;
    v_v04 := contabilidad.resultado(v_hasta) + contabilidad.saldo('3900', v_hasta) + contabilidad.saldo('3990', v_hasta);
    v_mitad := operacion.cap_mitad(v_v04, partes[3]);
    v_fondos_tot := (v_fila ->> 'fondos_en_poder_cent')::bigint + (v_otro ->> 'fondos_en_poder_cent')::bigint;
    -- Via 2: el capital contable del Balance menos los fondos en poder de los dos socios menos la valuacion del otro socio (la suma de las dos valuaciones mas los fondos es el capital contable).
    v_via2 := (v_cap -> 'balance' ->> 'total_capital_cent')::bigint - v_fondos_tot - (v_otro ->> 'valuacion_cent')::bigint;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Capital contable de la sociedad (Balance)', 'monto_cent', (v_cap -> 'balance' ->> 'total_capital_cent')::bigint),
      jsonb_build_object('concepto', 'Su cuenta de capital en el mayor: aportaciones, reinversion y utilidad recibida en actas, menos retiros (3110 + 3310 - 3210)', 'monto_cent', v_libro),
      jsonb_build_object('concepto', 'Su 50 % de la utilidad que aun no pasa por un acta (participacion siempre 50/50)', 'monto_cent', v_mitad),
      jsonb_build_object('concepto', 'Menos los fondos de la sociedad que tiene en su poder', 'monto_cent', -(v_fila ->> 'fondos_en_poder_cent')::bigint),
      jsonb_build_object('concepto', 'Valuacion personal', 'monto_cent', v_via1));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Valuacion personal de ' || partes[3] || ' (capital aportado mas su 50 % de la utilidad, menos los fondos de la sociedad en su poder)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Su cuenta de capital mas su mitad de la utilidad sin acta menos fondos en su poder', 'via1_valor', v_via1, 'via2', 'Capital contable del Balance menos los fondos de los dos socios menos la valuacion del otro socio', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'neta' then
    -- Aportacion neta (la definicion vigente): aportado (capital + dinero propio como reembolso) menos los fondos de la sociedad en su poder. Via 2: los auxiliares operativos del socio.
    v_cap := coalesce(p_cap, operacion.hist_cap(v_hasta)); v_fila := operacion.hist_cap_socio(v_cap, partes[3]);
    v_via1 := (v_fila ->> 'aportacion_neta_cent')::bigint;
    v_via2 := (operacion.aportado_socio(v_id) - greatest(operacion.saldo_socio(v_id, 'fondos'), 0))::bigint;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Capital aportado (apertura, aportaciones declaradas y reinversion por acta)', 'monto_cent', (v_fila ->> 'capital_aportado_acum_cent')::bigint),
      jsonb_build_object('concepto', 'Dinero propio que puso como reembolso', 'monto_cent', (v_fila ->> 'reembolso_puesto_acum_cent')::bigint),
      jsonb_build_object('concepto', 'Menos los fondos de la sociedad que tiene en su poder', 'monto_cent', -(v_fila ->> 'fondos_en_poder_cent')::bigint),
      jsonb_build_object('concepto', 'Aportacion neta', 'monto_cent', v_via1),
      jsonb_build_object('concepto', 'Diferencia a igualar (la mayor aportacion neta menos la suya; no es una deuda)', 'monto_cent', (v_fila ->> 'diferencia_a_igualar_cent')::bigint));
    -- Los auxiliares no tienen corte por fecha: la segunda via solo existe cuando el corte es hoy o posterior (como K8 de Capital por mes); si no, no hay comprobacion (la clave se omite).
    if v_hasta < negocio.hoy() then
      return jsonb_build_object('cifra', p_cifra, 'titulo', 'Aportacion neta de ' || partes[3] || ' al ' || v_hasta, 'valor', v_via1, 'unidad', 'mxn', 'renglones', v_rengs, 'movimientos', '[]'::jsonb);
    end if;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Aportacion neta de ' || partes[3] || ' (aportado menos fondos de la sociedad en su poder)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Capital aportado mas reembolso puesto menos fondos en su poder (mayor)', 'via1_valor', v_via1, 'via2', 'Aportado menos fondos segun el auxiliar de socios', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  raise exception 'cifra no explicable' using errcode = '22023';
end $$;

create function api.explicar_historial(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.explicar_historial(p_cifra, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Permisos: solo el rol socio y solo via api.*; las funciones de operacion y el disparador no son ejecutables por nadie salvo la base. Listado explicito (sin revokes en bloque).
-- ---------------------------------------------------------------------------
revoke execute on function operacion.retirado_socio(bigint, text, date, date), operacion.hist_cap(date), operacion.hist_cap_socio(jsonb, text), operacion.volumen_periodo(date, date),
  operacion.historial_cubetas(date, date, text), operacion.historial_fila(text, bigint, date, date, boolean), operacion.historial_socio(text, date), operacion.explicar_historial(text, jsonb, date),
  operacion.acta_sello_inmutable(), operacion.sellar_acta() from public, anon, authenticated;
revoke execute on function api.acta_periodo_sugerido(), api.acta_detalle(bigint), api.acta_disponible(date, date), api.historial_socio(text, date), api.explicar_historial(text) from public, anon;
grant execute on function api.acta_periodo_sugerido(), api.acta_detalle(bigint), api.acta_disponible(date, date), api.historial_socio(text, date), api.explicar_historial(text) to authenticated;
