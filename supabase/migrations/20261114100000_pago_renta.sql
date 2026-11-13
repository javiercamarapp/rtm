-- Pago de la renta de la bodega de Omar (decision del dueno, 14-nov): 2 pesos por pieza enviada desde la bodega. ADITIVA: lecturas, una tabla inmutable de detalle y UNA funcion de escritura.
--
-- Como esta modelado hoy (no se cambia):
--   * Devengo: operacion.renta_devengo (una fila por linea enviada; las reversas son filas negativas). Asiento: debe 6110 Renta de bodega / haber 2210 Renta por pagar a Omar.
--   * Cuenta con Omar: operacion.liquidacion_omar compensa semanalmente la renta contra sus tomas (debe 2210 / haber 1220); operacion.pago_omar registra los pagos (debe 2210 si es 'a_omar').
--   * Por tanto el saldo de la cuenta 2210 = devengado - compensado - pagado a Omar. Esa es la UNICA definicion de "por pagar" y se usa en la web del socio, la web de Omar y las pruebas.
--
-- Que agrega este archivo:
--   * operacion.pago_renta_detalle: nota, referencia de comprobante y exceso confirmado de cada pago de renta (inmutable; el pago mismo sigue siendo operacion.pago_omar).
--   * operacion.renta_estado / renta_serie / renta_proyeccion / renta_pagos / renta_panel: UNA definicion de las cifras (piezas, devengado, pagado, por pagar, serie diaria, proyeccion).
--   * api.pago_renta_panel(p_hoy): lectura del socio (todo el panel con el historial de pagos completo).
--   * api.registrar_pago_renta(...): escritura SOLO de socio. Envuelve operacion.registrar_pago_omar (mismo asiento, mismo cuadre, mismo libro de socios) con idempotencia,
--     fecha no futura, nota y comprobante opcionales y la regla de exceso (abajo). Registra el pago de la renta del lado "a_omar".
--   * omar.mi_pago_renta(): lectura de Omar de SOLO lo suyo (sin socios, sin notas, sin clientes, sin pedidos, sin costos, sin contabilidad).
--
-- DECISION DE EXCESO: un pago mayor que lo que se debe a Omar NO se registra sin aviso explicito. Sin p_confirmo_exceso = true la funcion lanza P0428 con el monto que si se debe; con la
-- confirmacion el pago se registra, el exceso queda anotado en el detalle y la cuenta queda "a favor de Omar" (anticipo), que se absorbe solo con la renta de los envios siguientes.
--
-- PROYECCION (siempre 'Estimado'): ritmo diario de los ultimos 28 dias CERRADOS (sin hoy; si la historia es mas corta, desde el primer envio) con la desviacion de esos dias; piezas esperadas
-- hasta fin de mes = ritmo x dias restantes; rango = 10 % a 90 % (1.2816 desviaciones). MUESTRA MINIMA: al menos 5 dias con envio y 40 piezas en la ventana; con menos NO se emite proyeccion
-- (se devuelve la muestra que falta). Sin tarifa configurada tampoco.
--
-- GRANTS: solo EXECUTE a `authenticated` en api.pago_renta_panel, api.registrar_pago_renta y omar.mi_pago_renta; cada una valida el rol dentro (socio; socio; omar). Nada a anon ni PUBLIC.
-- Las funciones operacion.renta_* son internas (sin EXECUTE para anon, authenticated ni PUBLIC).

-- ---------------------------------------------------------------------------
-- Detalle inmutable de cada pago de renta
-- ---------------------------------------------------------------------------
create table operacion.pago_renta_detalle (
  pago_id bigint primary key references operacion.pago_omar (id),
  nota text check (nota is null or char_length(nota) <= 500),
  comprobante text check (comprobante is null or char_length(comprobante) <= 120),
  exceso_cent bigint not null default 0 check (exceso_cent >= 0),
  registrado_por uuid,
  registrado_at timestamptz not null default now()
);
create trigger pago_renta_detalle_t1 before update or delete on operacion.pago_renta_detalle for each row execute function seguridad.t1_solo_insercion();
create trigger pago_renta_detalle_t1t before truncate on operacion.pago_renta_detalle for each statement execute function seguridad.t1_solo_insercion();
revoke delete, truncate on operacion.pago_renta_detalle from postgres;
alter table operacion.pago_renta_detalle enable row level security;
alter table operacion.pago_renta_detalle force row level security;
revoke all on operacion.pago_renta_detalle from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cifras: una definicion
-- ---------------------------------------------------------------------------
-- Estado de la cuenta de renta. saldo = devengado - compensado con tomas - pagado a Omar (= saldo de la cuenta 2210). Positivo: se le debe; negativo: pagado de mas (a favor de Omar).
create function operacion.renta_estado(p_hoy date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tarifa bigint := (catalogo.config_valor('renta_por_pieza_cent', p_hoy))::text::bigint;
  v_pz bigint; v_dev bigint; v_prim date; v_ult date; v_comp bigint; v_pag bigint; v_saldo bigint;
  v_mes date := date_trunc('month', p_hoy)::date; v_mes_pz bigint; v_mes_dev bigint;
begin
  select coalesce(sum(piezas), 0), coalesce(sum(monto_cent), 0), min(devengada_fecha) filter (where reversa_de is null), max(devengada_fecha) filter (where reversa_de is null)
    into v_pz, v_dev, v_prim, v_ult from operacion.renta_devengo;
  select coalesce(sum(compensado_cent), 0) into v_comp from operacion.liquidacion_omar;
  select coalesce(sum(monto_cent), 0) into v_pag from operacion.pago_omar where sentido = 'a_omar';
  v_saldo := v_dev - v_comp - v_pag;
  select coalesce(sum(piezas), 0), coalesce(sum(monto_cent), 0) into v_mes_pz, v_mes_dev from operacion.renta_devengo where devengada_fecha between v_mes and p_hoy;
  return jsonb_build_object(
    'hoy', p_hoy, 'tarifa_cent', v_tarifa, 'piezas', v_pz, 'devengado_cent', v_dev, 'compensado_tomas_cent', v_comp, 'pagado_cent', v_pag,
    'saldo_cent', v_saldo, 'por_pagar_cent', greatest(v_saldo, 0), 'a_favor_cent', greatest(-v_saldo, 0),
    -- La regla "piezas x tarifa" explica el devengado solo mientras la tarifa no haya cambiado; si cambio, la pantalla lo dice y muestra el devengado real.
    'regla_exacta', v_tarifa is not null and v_dev = v_pz * v_tarifa,
    'primer_envio', v_prim, 'ultimo_envio', v_ult,
    'mes_ini', v_mes, 'mes_piezas', v_mes_pz, 'mes_devengado_cent', v_mes_dev);
end $$;

-- Serie diaria de piezas y renta (dias con movimiento neto) de los ultimos p_dias dias hasta p_hoy.
create function operacion.renta_serie(p_hoy date, p_dias int) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('fecha', q.f, 'piezas', q.pz, 'renta_cent', q.rc) order by q.f), '[]'::jsonb)
  from (select r.devengada_fecha as f, sum(r.piezas)::bigint as pz, sum(r.monto_cent)::bigint as rc
          from operacion.renta_devengo r
         where r.devengada_fecha between p_hoy - (greatest(coalesce(p_dias, 366), 1) - 1) and p_hoy
         group by r.devengada_fecha having sum(r.piezas) <> 0 or sum(r.monto_cent) <> 0) q
$$;

-- Historial de pagos de renta (solo pagos a Omar). p_interno = true agrega socio, nota y comprobante (vista del socio); Omar recibe solo fecha, monto, via y folio del pago.
create function operacion.renta_pagos(p_interno boolean, p_limite int) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x->>'fecha') desc, (x->>'folio') desc), '[]'::jsonb) from (
    select case when p_interno
             then jsonb_build_object('folio', p.folio, 'fecha', p.fecha_neg, 'monto_cent', p.monto_cent, 'via', p.via, 'socio', s.nombre, 'nota', d.nota, 'comprobante', d.comprobante, 'exceso_cent', coalesce(d.exceso_cent, 0))
             else jsonb_build_object('folio', p.folio, 'fecha', p.fecha_neg, 'monto_cent', p.monto_cent, 'via', p.via) end as x
      from operacion.pago_omar p left join catalogo.socio s on s.id = p.socio_id left join operacion.pago_renta_detalle d on d.pago_id = p.id
     where p.sentido = 'a_omar'
     order by p.fecha_neg desc, p.id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) q
$$;

-- Proyeccion a fin de mes. Ver el encabezado: ventana de 28 dias cerrados, muestra minima de 5 dias con envio y 40 piezas, rango p10 a p90.
create function operacion.renta_proyeccion(p_hoy date, p_saldo_cent bigint, p_tarifa_cent bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c_dias_min constant int := 5; c_piezas_min constant int := 40; c_ventana constant int := 28; c_z constant numeric := 1.2816;
  v_prim date; v_ini date; v_fin date := p_hoy - 1; v_n int; v_dias_envio int; v_pz bigint; v_mu numeric; v_var numeric;
  v_fin_mes date := (date_trunc('month', p_hoy) + interval '1 month' - interval '1 day')::date; v_rest int; v_esp numeric; v_sd numeric; v_bajo bigint; v_alto bigint; v_cen bigint;
  v_acum bigint; v_muestra jsonb;
begin
  select min(devengada_fecha) into v_prim from operacion.renta_devengo where reversa_de is null;
  select coalesce(sum(piezas), 0) into v_acum from operacion.renta_devengo where devengada_fecha between date_trunc('month', p_hoy)::date and p_hoy;
  v_rest := v_fin_mes - p_hoy;
  if v_prim is not null and v_prim <= v_fin then
    v_ini := greatest(v_prim, p_hoy - c_ventana);
    v_n := v_fin - v_ini + 1;
    select count(*) filter (where d.pz > 0), coalesce(sum(d.pz), 0), coalesce(avg(d.pz), 0), coalesce(var_samp(d.pz), 0) into v_dias_envio, v_pz, v_mu, v_var
      from (select g::date as f, coalesce(sum(r.piezas), 0)::numeric as pz from generate_series(v_ini, v_fin, interval '1 day') g
              left join operacion.renta_devengo r on r.devengada_fecha = g::date group by g) d;
  else
    v_n := 0; v_dias_envio := 0; v_pz := 0; v_mu := 0; v_var := 0;
  end if;
  v_muestra := jsonb_build_object('dias_ventana', v_n, 'dias_con_envio', v_dias_envio, 'piezas', v_pz, 'dias_requeridos', c_dias_min, 'piezas_requeridas', c_piezas_min);
  if p_tarifa_cent is null then
    return jsonb_build_object('etiqueta', 'Estimado', 'emitida', false, 'motivo', 'sin_tarifa', 'muestra', v_muestra);
  end if;
  if v_dias_envio < c_dias_min or v_pz < c_piezas_min then
    return jsonb_build_object('etiqueta', 'Estimado', 'emitida', false, 'motivo', case when v_n = 0 then 'sin_historia' else 'muestra_chica' end, 'muestra', v_muestra);
  end if;
  v_esp := v_mu * v_rest;
  v_sd := sqrt(v_var) * sqrt(v_rest::numeric);
  v_cen := round(v_esp)::bigint;
  v_bajo := greatest(round(v_esp - c_z * v_sd), 0)::bigint;
  v_alto := round(v_esp + c_z * v_sd)::bigint;
  return jsonb_build_object(
    'etiqueta', 'Estimado', 'emitida', true, 'muestra', v_muestra, 'metodo', 'Ritmo diario de los ultimos dias cerrados; rango de 10 % a 90 %.',
    'ritmo_diario_pz', round(v_mu, 2), 'fecha_corte', v_fin_mes, 'dias_restantes', v_rest,
    'mes_piezas_acumuladas', v_acum,
    'restantes_pz', jsonb_build_object('central', v_cen, 'bajo', v_bajo, 'alto', v_alto),
    'mes_pz', jsonb_build_object('central', v_acum + v_cen, 'bajo', v_acum + v_bajo, 'alto', v_acum + v_alto),
    'restante_renta_cent', jsonb_build_object('central', v_cen * p_tarifa_cent, 'bajo', v_bajo * p_tarifa_cent, 'alto', v_alto * p_tarifa_cent),
    'mes_renta_cent', jsonb_build_object('central', (v_acum + v_cen) * p_tarifa_cent, 'bajo', (v_acum + v_bajo) * p_tarifa_cent, 'alto', (v_acum + v_alto) * p_tarifa_cent),
    -- Lo que se pagaria al corte si no hay pagos antes: saldo de hoy mas la renta que falta devengar.
    'pago_al_corte_cent', jsonb_build_object('central', p_saldo_cent + v_cen * p_tarifa_cent, 'bajo', p_saldo_cent + v_bajo * p_tarifa_cent, 'alto', p_saldo_cent + v_alto * p_tarifa_cent));
end $$;

create function operacion.renta_panel(p_hoy date, p_interno boolean) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_e jsonb := operacion.renta_estado(p_hoy);
begin
  return jsonb_build_object(
    'estado', v_e,
    'proyeccion', operacion.renta_proyeccion(p_hoy, (v_e->>'saldo_cent')::bigint, nullif(v_e->>'tarifa_cent', '')::bigint),
    'serie', operacion.renta_serie(p_hoy, 366),
    'pagos', operacion.renta_pagos(p_interno, 50));
end $$;

-- ---------------------------------------------------------------------------
-- Lectura del socio
-- ---------------------------------------------------------------------------
create function api.pago_renta_panel(p_hoy date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.renta_panel(coalesce(p_hoy, negocio.hoy()), true);
end $$;

-- ---------------------------------------------------------------------------
-- Lectura de Omar: solo lo suyo
-- ---------------------------------------------------------------------------
create function omar.mi_pago_renta() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform seguridad.exigir_rol(array['omar']);
  v := operacion.renta_panel(negocio.hoy(), false);
  -- Omar no ve el saldo compensado con tomas como concepto contable, pero si la cifra que le afecta; las claves son las mismas del socio salvo el primer envio y el ultimo (fechas de su propia renta).
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Escritura del socio: registrar un pago de renta
-- ---------------------------------------------------------------------------
create function api.registrar_pago_renta(p_clave_idem text, p_monto_cent bigint, p_socio text default null, p_via text default 'transferencia', p_fecha date default null,
                                         p_nota text default null, p_comprobante text default null, p_confirmo_exceso boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_hoy date := negocio.hoy(); v_fecha date := coalesce(p_fecha, negocio.hoy()); v_socio text; v_antes jsonb; v_saldo bigint; v_exceso bigint := 0;
  v_r jsonb; v_pago bigint; v_despues jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'api.registrar_pago_renta', 'm', p_monto_cent, 's', p_socio, 'v', p_via, 'f', p_fecha, 'n', p_nota, 'c', p_comprobante, 'x', p_confirmo_exceso));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago de renta debe ser positivo' using errcode = '23514'; end if;
  if p_via is null or p_via not in ('transferencia', 'efectivo') then raise exception 'via de pago invalida' using errcode = '22023'; end if;
  if v_fecha > v_hoy then raise exception 'la fecha del pago no puede ser futura' using errcode = '22023'; end if;
  if p_nota is not null and char_length(p_nota) > 500 then raise exception 'la nota admite hasta 500 caracteres' using errcode = '22023'; end if;
  if p_comprobante is not null and char_length(p_comprobante) > 120 then raise exception 'la referencia del comprobante admite hasta 120 caracteres' using errcode = '22023'; end if;
  v_socio := coalesce(nullif(btrim(p_socio), ''), (select u.socio_nombre from seguridad.usuario u where u.id = auth.uid()));
  if v_socio is null or not exists (select 1 from catalogo.socio where nombre = v_socio) then raise exception 'indica el socio que paga la renta' using errcode = '23502'; end if;
  -- Un candado: dos pagos simultaneos no deben pasarse juntos de lo que se debe.
  perform pg_advisory_xact_lock(hashtextextended('pago_renta', 0));
  v_antes := operacion.renta_estado(v_hoy);
  v_saldo := (v_antes->>'saldo_cent')::bigint;
  if p_monto_cent > greatest(v_saldo, 0) then
    if not coalesce(p_confirmo_exceso, false) then
      raise exception 'el pago (% MXN) es mayor que lo que se debe a Omar (% MXN). Confirma que es un anticipo para registrarlo.',
        to_char(p_monto_cent / 100.0, 'FM999,999,999,990.00'), to_char(greatest(v_saldo, 0) / 100.0, 'FM999,999,999,990.00') using errcode = 'P0428';
    end if;
    v_exceso := p_monto_cent - greatest(v_saldo, 0);
  end if;
  -- Misma operacion contable que cualquier pago a Omar: debe 2210, y el libro del socio (reembolso por omision, nunca capital).
  v_r := operacion.registrar_pago_omar('rr:' || p_clave_idem, p_monto_cent, 'a_omar', v_socio, p_via, v_fecha, null, 'auto');
  v_pago := (v_r->>'pago_id')::bigint;
  insert into operacion.pago_renta_detalle (pago_id, nota, comprobante, exceso_cent, registrado_por) values (v_pago, nullif(btrim(p_nota), ''), nullif(btrim(p_comprobante), ''), v_exceso, auth.uid());
  v_despues := operacion.renta_estado(v_hoy);
  v_res := jsonb_build_object('pago_id', v_pago, 'folio', v_r->>'folio', 'monto_cent', p_monto_cent, 'exceso_cent', v_exceso,
                              'saldo_antes_cent', v_saldo, 'saldo_despues_cent', (v_despues->>'saldo_cent')::bigint,
                              'por_pagar_cent', (v_despues->>'por_pagar_cent')::bigint, 'a_favor_cent', (v_despues->>'a_favor_cent')::bigint, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function operacion.renta_estado(date), operacion.renta_serie(date, int), operacion.renta_pagos(boolean, int), operacion.renta_proyeccion(date, bigint, bigint), operacion.renta_panel(date, boolean)
  from public, anon, authenticated;
revoke execute on function api.pago_renta_panel(date), api.registrar_pago_renta(text, bigint, text, text, date, text, text, boolean), omar.mi_pago_renta() from public, anon;
grant execute on function api.pago_renta_panel(date), api.registrar_pago_renta(text, bigint, text, text, date, text, text, boolean), omar.mi_pago_renta() to authenticated;
