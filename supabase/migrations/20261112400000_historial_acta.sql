-- Historial personal por socio y sello del acta de corte (adenda 33). Migracion ADITIVA: lecturas, una tabla inmutable y un disparador diferido. No cambia ninguna regla de dinero.
--  * operacion.acta_sello: foto inmutable (capital contable, valor de cada participacion, fondos y compensaciones) que se toma al cerrarse el acta con las dos firmas.
--  * api.acta_detalle, api.acta_periodo_sugerido: lo que necesita la pantalla del acta y su formulario de decisiones (retira / reinvierte por socio).
--  * api.historial_socio: cabecera, flujos, linea de tiempo de actas, series por dia, semana y mes, por cliente y por modelo. Los ratios (ROI, TIR, payback...) se calculan en TypeScript puro.
--  * api.explicar_historial: "Explicar este numero" de las cifras del historial (dos vias).
-- Reutiliza utilidad_periodo, libro_socio, aportado_socio, repartir_proporcional y contabilidad.valuacion: una cifra, una funcion.

-- ---------------------------------------------------------------------------
-- Redondeo unico (regla E): la mitad de un total para un socio; el centavo suelto va a quien mas ha aportado y, a igualdad, rota segun p_rotor.
-- ---------------------------------------------------------------------------
create function operacion.mitad_socio(p_total bigint, p_socio text, p_rotor int default 0) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_pri jsonb; v_r jsonb;
begin
  v_pri := (select jsonb_object_agg(s.nombre, greatest(operacion.aportado_socio(s.id, 'capital'), 0)) from catalogo.socio s where s.nombre in ('Angelo', 'Javier'));
  v_r := operacion.repartir_proporcional(abs(p_total), '{"Angelo":1,"Javier":1}'::jsonb, v_pri, p_rotor);
  return case when p_total < 0 then -(v_r ->> p_socio)::bigint else (v_r ->> p_socio)::bigint end;
end $$;

-- Valuacion personal (decision): el valor de la participacion de un socio es SU cuenta de capital (aportaciones y reinversiones, mas la utilidad que ya recibio en actas, menos lo que retiro)
-- mas su 50 % de la utilidad que aun no pasa por un acta (regla F: la utilidad se reparte 50/50, el capital aportado no). La suma de los dos socios es EXACTAMENTE el capital contable.
-- No incluye reembolsos por cobrar ni fondos en su poder: esas son deudas o creditos con la sociedad y van aparte (cuenta_socio).
create function operacion.capital_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select (operacion.aportado_socio(p_socio, 'capital') + operacion.libro_socio(p_socio) - operacion.libro_socio(p_socio, 'pago_reembolso'))::bigint $$;

create function operacion.valor_socio(p_socio text, p_capital_contable bigint, p_rotor int default 0) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_sin_acta bigint;
begin
  v_sin_acta := p_capital_contable - (select coalesce(sum(operacion.capital_socio(s.id)), 0) from catalogo.socio s where s.nombre in ('Angelo', 'Javier'));
  return operacion.capital_socio((select id from catalogo.socio where nombre = p_socio)) + operacion.mitad_socio(v_sin_acta, p_socio, p_rotor);
end $$;

-- Deuda o credito con la sociedad (+ la sociedad le debe): reembolsos de gastos por cobrar menos fondos que tiene en su poder.
create function operacion.cuenta_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select (operacion.reembolso_pendiente(p_socio) - operacion.saldo_socio(p_socio))::bigint $$;

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

-- Una cubeta de la serie de un socio: utilidad de la empresa, su 50 %, volumen, retiros, reinversion y aportaciones declaradas.
create function operacion.historial_fila(p_socio text, p_id bigint, p_ini date, p_fin date, p_parcial boolean, p_rotor int) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_u jsonb; v_v jsonb; v_ret bigint; v_rei bigint; v_apo bigint;
begin
  v_u := operacion.utilidad_periodo(p_ini, p_fin);
  v_v := operacion.volumen_periodo(p_ini, p_fin);
  select coalesce(-sum(l.monto_cent), 0)::bigint into v_ret
    from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
   where l.socio_id = p_id and l.fecha_neg between p_ini and p_fin and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad');
  select coalesce(sum(a.monto_cent), 0)::bigint into v_rei from operacion.aportacion_socio a where a.socio_id = p_id and a.ref_tipo = 'reinversion' and a.fecha_neg between p_ini and p_fin;
  select coalesce(sum(a.monto_cent), 0)::bigint into v_apo from operacion.aportacion_socio a
   where a.socio_id = p_id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion' and a.fecha_neg between p_ini and p_fin;
  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'parcial', p_parcial, 'utilidad_cent', (v_u ->> 'utilidad_cent')::bigint, 'parte_cent', operacion.mitad_socio((v_u ->> 'utilidad_cent')::bigint, p_socio, p_rotor),
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
  c operacion.cierre_reparto; v_val jsonb; v_dif bigint; v_cont jsonb; v_valor jsonb := '{}'::jsonb; v_soc jsonb := '{}'::jsonb; s record; v_comp bigint;
begin
  select * into c from operacion.cierre_reparto where id = new.cierre_id;
  if not found or c.tipo <> 'periodo' then return null; end if;
  if (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) < 2 then return null; end if;
  if exists (select 1 from operacion.acta_sello x where x.cierre_id = c.id) then return null; end if;
  -- Un fallo de la valuacion nunca debe impedir que el acta se cierre: el sello queda sin esas cifras.
  begin v_val := contabilidad.valuacion(c.periodo_fin); exception when others then v_val := null; end;
  if v_val is not null and (v_val ->> 'con_movimientos')::boolean then
    v_dif := (v_val ->> 'v03_diferencia_cent')::bigint;
    for s in select nombre from catalogo.socio where nombre in ('Angelo', 'Javier') order by nombre loop
      v_valor := v_valor || jsonb_build_object(s.nombre, operacion.valor_socio(s.nombre, v_dif, c.id::int));
    end loop;
  end if;
  for s in select id, nombre from catalogo.socio where nombre in ('Angelo', 'Javier') order by nombre loop
    select coalesce(-sum(m.monto_cent), 0)::bigint into v_comp from operacion.cuenta_socio_mov m where m.socio_id = s.id and m.evento_id = new.evento_id and m.concepto = 'compensacion_reparto';
    v_soc := v_soc || jsonb_build_object(s.nombre, jsonb_build_object(
      'invertido_cent', operacion.aportado_socio(s.id, 'capital'),
      'retirado_cent', -(operacion.libro_socio(s.id, 'retiro') + operacion.libro_socio(s.id, 'pago_utilidad')),
      'por_distribuir_cent', operacion.utilidad_por_distribuir(s.id),
      'fondos_en_poder_cent', operacion.saldo_socio(s.id),
      'compensaciones_cent', v_comp,
      'cuenta_cent', operacion.cuenta_socio(s.id),
      'neto_cent', operacion.neto_socio(s.id)));
  end loop;
  v_cont := jsonb_build_object(
    'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent, 'huella_cascada', operacion.huella_cascada(c.snapshot), 'decisiones', c.decisiones,
    'valuacion_cent', case when v_dif is not null then (v_val ->> 'v01_valuacion_cent')::bigint end,
    'deudas_cent', case when v_dif is not null then (v_val ->> 'v02_deudas_cent')::bigint end,
    'capital_contable_cent', v_dif,
    'valor_participacion_cent', case when v_dif is not null then v_valor end,
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
declare v_c jsonb; v_s jsonb; v_corrige text; v_contra text;
begin
  perform seguridad.exigir_rol(array['socio']);
  select x into v_c from jsonb_array_elements(api.cierres_reparto()) x where (x ->> 'id')::bigint = p_cierre;
  if v_c is null then return null; end if;
  select jsonb_build_object('contenido', s.contenido, 'huella', s.huella, 'sellado_at', s.sellado_at) into v_s from operacion.acta_sello s where s.cierre_id = p_cierre;
  select o.folio into v_corrige from operacion.cierre_reparto c join operacion.cierre_reparto o on o.id = c.corrige_a where c.id = p_cierre;
  select k.folio into v_contra from operacion.cierre_reparto k where k.corrige_a = p_cierre;
  return jsonb_build_object('cierre', v_c, 'sello', v_s, 'corrige_folio', v_corrige, 'contra_acta_folio', v_contra);
end $$;

-- ---------------------------------------------------------------------------
-- Historial personal
-- ---------------------------------------------------------------------------
create function operacion.historial_socio(p_socio text, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy(); v_hasta date := least(coalesce(p_hasta, v_hoy), negocio.hoy()); v_id bigint; v_otro bigint; v_primera date; v_ini_mes date;
  v_apo bigint; v_rei bigint; v_ret_u bigint; v_ret_c bigint; v_val jsonb; v_dif bigint; v_cli bigint; v_ef jsonb; v_u jsonb; v_vol jsonb; v_flujos jsonb; v_actas jsonb;
  v_dias jsonb; v_sem jsonb; v_mes jsonb; v_cli_top jsonb; v_mod_top jsonb; v_cab jsonb; v_meses int; v_comp jsonb := '{}'::jsonb;
  r record;
begin
  select id into v_id from catalogo.socio where nombre = p_socio and nombre in ('Angelo', 'Javier');
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  select id into v_otro from catalogo.socio where nombre in ('Angelo', 'Javier') and id <> v_id;
  select min(f) into v_primera from (select min(fecha_neg) f from operacion.pedido where estado = 'enviado' union all select min(fecha_neg) from operacion.aportacion_socio
                                     union all select min(fecha_neg) from operacion.socio_libro union all select min(fecha_neg) from operacion.gasto) x;
  v_primera := least(v_primera, v_hasta);

  -- Cabecera (estado a hoy; p_hasta solo acota las series y la valuacion): invertido (aportaciones declaradas + reinversiones), retirado, utilidad recibida y valor de su participacion.
  select coalesce(sum(a.monto_cent) filter (where coalesce(a.ref_tipo, '') <> 'reinversion'), 0)::bigint, coalesce(sum(a.monto_cent) filter (where a.ref_tipo = 'reinversion'), 0)::bigint
    into v_apo, v_rei from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital';
  v_ret_u := -(operacion.libro_socio(v_id, 'retiro') + operacion.libro_socio(v_id, 'pago_utilidad'));
  v_ret_c := -operacion.libro_socio(v_id, 'pago_devolucion_aportacion');
  begin v_val := contabilidad.valuacion(v_hasta); exception when others then v_val := null; end;
  if v_val is not null and (v_val ->> 'con_movimientos')::boolean then v_dif := (v_val ->> 'v03_diferencia_cent')::bigint; v_cli := (v_val ->> 'clientes_cent')::bigint; end if;
  v_ef := operacion.efectivo_sociedad();
  v_meses := case when v_primera is null then 0 else greatest(1, (extract(year from age(v_hasta, v_primera)) * 12 + extract(month from age(v_hasta, v_primera)))::int + 1) end;

  v_cab := jsonb_build_object(
    'aportaciones_cent', v_apo, 'reinversion_cent', v_rei, 'invertido_cent', v_apo + v_rei,
    'invertido_ambos_cent', operacion.aportado_socio(v_id, 'capital') + operacion.aportado_socio(v_otro, 'capital'),
    'retirado_utilidad_cent', v_ret_u, 'retirado_capital_cent', v_ret_c, 'retirado_cent', v_ret_u + v_ret_c,
    'utilidad_asignada_cent', operacion.libro_socio(v_id, 'utilidad_asignada'), 'utilidad_por_distribuir_cent', operacion.utilidad_por_distribuir(v_id),
    'capital_contable_cent', v_dif,
    'capital_cuenta_cent', operacion.capital_socio(v_id),
    'valor_cent', case when v_dif is not null then operacion.valor_socio(p_socio, v_dif, 0) end,
    'valor_bajo_cent', case when v_dif is not null then operacion.valor_socio(p_socio, v_dif, 0) - operacion.mitad_socio(coalesce(v_cli, 0), p_socio, 0) end,
    'valor_alto_cent', case when v_dif is not null then operacion.valor_socio(p_socio, v_dif, 0) end,
    'por_cobrar_clientes_cent', v_cli,
    'neto_cent', operacion.neto_socio(v_id), 'cuenta_cent', operacion.cuenta_socio(v_id), 'reembolso_pendiente_cent', operacion.reembolso_pendiente(v_id), 'fondos_cent', operacion.saldo_socio(v_id),
    'efectivo_total_cent', (v_ef ->> 'total_cent')::bigint, 'efectivo_disponible_cent', (v_ef ->> 'disponible_cent')::bigint,
    'primera_fecha', v_primera, 'meses_activo', v_meses);
  -- Estado de la comprobacion por dos vias de cada cifra de la cabecera: sale de la misma funcion que usa "Explicar este numero" (null = sin dato o sin comprobar).
  for r in select unnest(array['invertido', 'retirado', 'utilidad', 'valor', 'cuenta']) as k loop
    begin
      v_comp := v_comp || jsonb_build_object(r.k, (api.explicar_historial('historial:' || r.k || ':' || p_socio) -> 'comprobacion' ->> 'cuadra')::boolean);
    exception when others then v_comp := v_comp || jsonb_build_object(r.k, null);
    end;
  end loop;
  v_cab := v_cab || jsonb_build_object('comprobaciones', v_comp);

  -- Totales de toda la historia hasta la fecha de corte.
  if v_primera is not null then
    v_u := operacion.utilidad_periodo(v_primera, v_hasta);
    v_vol := operacion.volumen_periodo(v_primera, v_hasta);
  end if;

  -- Flujos fechados del socio para su TIR: aportaciones declaradas (salida) y retiros (entrada). Una reversa cuenta con la fecha en que se deshizo.
  select coalesce(jsonb_agg(f order by (f ->> 'fecha')), '[]'::jsonb) into v_flujos from (
    select jsonb_build_object('fecha', a.fecha_neg, 'monto_cent', -a.monto_cent, 'tipo', 'aportacion') f from operacion.aportacion_socio a
     where a.socio_id = v_id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion'
    union all
    select jsonb_build_object('fecha', l.fecha_neg, 'monto_cent', -l.monto_cent, 'tipo', case when coalesce(o.concepto, l.concepto) = 'pago_devolucion_aportacion' then 'retiro_capital' else 'retiro' end)
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
     where l.socio_id = v_id and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'pago_devolucion_aportacion')) q;

  -- Linea de tiempo de actas (la contra-acta se ve como un renglon propio).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'folio', c.folio, 'tipo', c.tipo, 'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent,
      'parte_cent', coalesce((c.snapshot -> 'por_socio' -> p_socio ->> 'utilidad_cent')::bigint, 0),
      'retira_cent', coalesce((c.decisiones -> p_socio ->> 'retira')::bigint, 0), 'reinvierte_cent', coalesce((c.decisiones -> p_socio ->> 'reinvierte')::bigint, 0),
      'estado', case when exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then 'anulado'
                     when (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2 then 'cerrado'
                     when exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id) then 'firmado_por_uno' else 'propuesto' end,
      'corregida', exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id),
      'firmas', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'firmado_at', f.firmado_at) order by f.id) from operacion.cierre_reparto_firma f join catalogo.socio s on s.id = f.socio_id where f.cierre_id = c.id), '[]'::jsonb),
      'capital_contable_cent', (select (s.contenido ->> 'capital_contable_cent')::bigint from operacion.acta_sello s where s.cierre_id = c.id),
      'valor_cent', (select (s.contenido -> 'valor_participacion_cent' ->> p_socio)::bigint from operacion.acta_sello s where s.cierre_id = c.id),
      'huella', (select s.huella from operacion.acta_sello s where s.cierre_id = c.id)) order by c.periodo_fin desc, c.id desc), '[]'::jsonb)
    into v_actas from operacion.cierre_reparto c where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id);

  -- Series: ultimos 60 dias, 26 semanas y los meses desde la primera actividad (maximo 36).
  v_dias := '[]'::jsonb; v_sem := '[]'::jsonb; v_mes := '[]'::jsonb;
  if v_primera is not null then
    for r in select * from operacion.historial_cubetas(greatest(v_primera, v_hasta - 59), v_hasta, 'dia') loop
      v_dias := v_dias || operacion.historial_fila(p_socio, v_id, r.ini, r.fin, r.parcial, (r.ini - date '2026-01-01')::int);
    end loop;
    for r in select * from operacion.historial_cubetas(greatest(v_primera, (date_trunc('week', v_hasta::timestamp) - interval '25 weeks')::date), v_hasta, 'semana') loop
      v_sem := v_sem || operacion.historial_fila(p_socio, v_id, greatest(r.ini, v_primera), r.fin, r.parcial, (r.ini - date '2026-01-01')::int);
    end loop;
    v_ini_mes := greatest(date_trunc('month', v_primera)::date, (date_trunc('month', v_hasta::timestamp) - interval '35 months')::date);
    for r in select * from operacion.historial_cubetas(v_ini_mes, v_hasta, 'mes') loop
      v_mes := v_mes || operacion.historial_fila(p_socio, v_id, greatest(r.ini, v_primera), r.fin, r.parcial, (extract(year from r.ini)::int * 12 + extract(month from r.ini)::int));
    end loop;

    -- Utilidad por cliente (pedido enviado) y por modelo (venta menos costo), con la utilidad que ya trae la nota de cada pedido.
    select coalesce(jsonb_agg(jsonb_build_object('cliente_id', q.cid, 'cliente', q.nombre, 'pedidos', q.pedidos, 'piezas', q.piezas, 'utilidad_cent', q.util, 'parte_cent', operacion.mitad_socio(q.util, p_socio, q.cid::int))
                             order by q.util desc, q.nombre), '[]'::jsonb) into v_cli_top
      from (select * from (select cl.id as cid, cl.nombre_canonico as nombre, count(*)::int as pedidos,
                   coalesce(sum((select sum((l ->> 'piezas')::int) from jsonb_array_elements(coalesce(nn.s -> 'lineas', '[]'::jsonb)) l)), 0)::bigint as piezas,
                   coalesce(sum((nn.s -> 'cascada' ->> 'utilidad_cent')::bigint), 0)::bigint as util
              from operacion.pedido pe join catalogo.cliente cl on cl.id = pe.cliente_id
              cross join lateral (select n.snapshot_interno as s from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn
             where pe.estado = 'enviado' and pe.fecha_envio between v_primera and v_hasta group by cl.id, cl.nombre_canonico) z order by z.util desc, z.nombre limit 10) q;
    select coalesce(jsonb_agg(jsonb_build_object('modelo', q.modelo, 'piezas', q.piezas, 'venta_cent', q.venta, 'costo_cent', q.costo, 'utilidad_cent', q.venta - q.costo, 'parte_cent', operacion.mitad_socio(q.venta - q.costo, p_socio, length(q.modelo)))
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
    'totales', case when v_primera is null then null else jsonb_build_object('utilidad_cent', (v_u ->> 'utilidad_cent')::bigint, 'parte_cent', operacion.mitad_socio((v_u ->> 'utilidad_cent')::bigint, p_socio, 0),
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
-- Explicar este numero del historial (dos vias por cifra). Mismo formato que api.explicar_cifra.
--   historial:invertido|retirado|utilidad|valor|cuenta:<socio>      historial:parte:<acta id>:<socio>
-- ---------------------------------------------------------------------------
create function api.explicar_historial(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_id bigint; v_rengs jsonb; v_via1 bigint; v_via2 bigint; v_val jsonb; v_dif bigint; c operacion.cierre_reparto; v_x jsonb; v_d jsonb; v_disp bigint; v_titulo text; v_otro_n text;
begin
  perform seguridad.exigir_rol(array['socio']);
  if partes[1] <> 'historial' or partes[2] is null then raise exception 'cifra no explicable' using errcode = '22023'; end if;
  if partes[2] = 'parte' then
    select * into c from operacion.cierre_reparto where id = partes[3]::bigint and tipo = 'periodo';
    if not found then raise exception 'acta desconocida' using errcode = '22023'; end if;
    v_x := c.snapshot -> 'por_socio' -> partes[4]; v_d := c.decisiones -> partes[4];
    if v_x is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
    v_disp := greatest((v_x ->> 'utilidad_cent')::bigint - (v_x ->> 'anticipo_cent')::bigint, 0);
    v_via1 := v_disp;
    v_via2 := coalesce((v_d ->> 'retira')::bigint, 0) + coalesce((v_d ->> 'reinvierte')::bigint, 0) + (v_disp - coalesce((v_d ->> 'retira')::bigint, 0) - coalesce((v_d ->> 'reinvierte')::bigint, 0));
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Utilidad neta del periodo del acta ' || c.folio, 'monto_cent', c.utilidad_cent),
      jsonb_build_object('concepto', 'Su parte de la utilidad repartible (50/50 fijo)', 'monto_cent', (v_x ->> 'utilidad_cent')::bigint),
      jsonb_build_object('concepto', 'Menos lo que ya recibio como retiro anticipado', 'monto_cent', -(v_x ->> 'anticipo_cent')::bigint),
      jsonb_build_object('concepto', 'Retira en el acta', 'monto_cent', coalesce((v_d ->> 'retira')::bigint, 0)),
      jsonb_build_object('concepto', 'Reinvierte en el acta', 'monto_cent', coalesce((v_d ->> 'reinvierte')::bigint, 0)),
      jsonb_build_object('concepto', 'Queda por distribuir', 'monto_cent', v_disp - coalesce((v_d ->> 'retira')::bigint, 0) - coalesce((v_d ->> 'reinvierte')::bigint, 0)));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Parte de ' || partes[4] || ' en el acta ' || c.folio || ' (disponible para retirar, reinvertir o dejar por distribuir)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Su parte menos lo ya recibido', 'via1_valor', v_via1, 'via2', 'Retira + reinvierte + queda por distribuir', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  select id into v_id from catalogo.socio where nombre = partes[3] and nombre in ('Angelo', 'Javier');
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  if partes[2] = 'invertido' then
    select coalesce(jsonb_agg(jsonb_build_object('concepto', a.concepto || case when a.ref_tipo = 'reinversion' then ' (reinversion)' else ' (aportacion)' end, 'monto_cent', a.monto_cent, 'fecha_neg', a.fecha_neg) order by a.fecha_neg, a.id), '[]'::jsonb),
           coalesce(sum(a.monto_cent), 0)::bigint into v_rengs, v_via2 from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital';
    v_via1 := (select coalesce(sum(a.monto_cent) filter (where coalesce(a.ref_tipo, '') <> 'reinversion'), 0) + coalesce(sum(a.monto_cent) filter (where a.ref_tipo = 'reinversion'), 0) from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital');
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Invertido por ' || partes[3] || ' (aportaciones declaradas mas reinversiones de utilidad)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Aportaciones mas reinversiones', 'via1_valor', v_via1, 'via2', 'Suma del libro de aportaciones de capital', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'retirado' then
    select coalesce(jsonb_agg(jsonb_build_object('concepto', coalesce(l.nota, 'Retiro') || case when o.id is not null then ' (reversa)' else '' end, 'monto_cent', -l.monto_cent, 'fecha_neg', l.fecha_neg) order by l.fecha_neg, l.id), '[]'::jsonb),
           coalesce(-sum(l.monto_cent), 0)::bigint into v_rengs, v_via2
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de where l.socio_id = v_id and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'pago_devolucion_aportacion');
    v_via1 := -(operacion.libro_socio(v_id, 'retiro') + operacion.libro_socio(v_id, 'pago_utilidad') + operacion.libro_socio(v_id, 'pago_devolucion_aportacion'));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Retirado por ' || partes[3] || ' (retiros de utilidad y de capital)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma por concepto del libro', 'via1_valor', v_via1, 'via2', 'Renglon por renglon', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'utilidad' then
    select coalesce(jsonb_agg(jsonb_build_object('concepto', coalesce(l.nota, 'Utilidad asignada') || case when o.id is not null then ' (reversa)' else '' end, 'monto_cent', l.monto_cent, 'fecha_neg', l.fecha_neg) order by l.fecha_neg, l.id), '[]'::jsonb),
           coalesce(sum(l.monto_cent), 0)::bigint into v_rengs, v_via2
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de where l.socio_id = v_id and coalesce(o.concepto, l.concepto) = 'utilidad_asignada';
    v_via1 := operacion.libro_socio(v_id, 'utilidad_asignada');
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Utilidad recibida por ' || partes[3] || ' en actas firmadas', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma por concepto del libro', 'via1_valor', v_via1, 'via2', 'Renglon por renglon', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'valor' then
    v_val := contabilidad.valuacion(negocio.hoy());
    if not (v_val ->> 'con_movimientos')::boolean then raise exception 'sin dato: todavia no hay asientos contables' using errcode = 'P0428'; end if;
    v_dif := (v_val ->> 'v03_diferencia_cent')::bigint;
    select nombre into v_otro_n from catalogo.socio where nombre in ('Angelo', 'Javier') and id <> v_id;
    v_via1 := operacion.valor_socio(partes[3], v_dif, 0);
    -- Segunda via: el capital por cuentas de la contabilidad (identidad I-1) menos el valor del otro socio.
    v_via2 := (v_val -> 'identidades' -> 'i1' ->> 'via2_cent')::bigint - operacion.valor_socio(v_otro_n, v_dif, 0);
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Capital contable de la sociedad (valuacion al costo menos deudas)', 'monto_cent', v_dif),
      jsonb_build_object('concepto', 'Su cuenta de capital: aportaciones y reinversiones, mas utilidad recibida en actas, menos retiros', 'monto_cent', operacion.capital_socio(v_id)),
      jsonb_build_object('concepto', 'Cuenta de capital de ' || v_otro_n, 'monto_cent', operacion.capital_socio((select id from catalogo.socio where nombre = v_otro_n))),
      jsonb_build_object('concepto', 'Utilidad que aun no pasa por un acta (capital contable menos las dos cuentas)', 'monto_cent', v_dif - operacion.capital_socio(v_id) - operacion.capital_socio((select id from catalogo.socio where nombre = v_otro_n))),
      jsonb_build_object('concepto', 'Su 50 % de esa utilidad sin acta (regla F; el centavo suelto a quien mas aporta)', 'monto_cent', operacion.mitad_socio(v_dif - operacion.capital_socio(v_id) - operacion.capital_socio((select id from catalogo.socio where nombre = v_otro_n)), partes[3], 0)),
      jsonb_build_object('concepto', 'Valor de su participacion', 'monto_cent', v_via1),
      jsonb_build_object('concepto', 'Rango bajo: sin contar su parte de lo que deben los clientes', 'monto_cent', v_via1 - operacion.mitad_socio((v_val ->> 'clientes_cent')::bigint, partes[3], 0)));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Valor estimado de la participacion de ' || partes[3] || ' (su cuenta de capital mas su 50 % de la utilidad sin acta; estimado en libros)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Su cuenta de capital mas su mitad de la utilidad sin acta', 'via1_valor', v_via1, 'via2', 'Capital por cuentas de la contabilidad (I-1) menos el valor del otro socio', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'cuenta' then
    -- Deuda o credito con la sociedad: reembolsos de gastos por cobrar menos fondos en su poder. Segunda via: la posicion neta menos su cuenta de capital.
    v_via1 := operacion.cuenta_socio(v_id);
    v_via2 := operacion.neto_socio(v_id) - operacion.capital_socio(v_id);
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Reembolsos de gastos pagados que la sociedad aun no le paga', 'monto_cent', operacion.reembolso_pendiente(v_id)),
      jsonb_build_object('concepto', 'Menos los fondos que tiene en su poder', 'monto_cent', -operacion.saldo_socio(v_id)));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Deuda o credito de ' || partes[3] || ' con la sociedad (+ la sociedad le debe, - el debe)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Reembolsos por cobrar menos fondos en su poder', 'via1_valor', v_via1, 'via2', 'Posicion neta con la sociedad menos su cuenta de capital', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  raise exception 'cifra no explicable' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Permisos: solo el rol socio (via api.*); nada ejecutable por anon ni por rol Omar.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function api.acta_periodo_sugerido(), api.acta_detalle(bigint), api.historial_socio(text, date), api.explicar_historial(text) to authenticated;
