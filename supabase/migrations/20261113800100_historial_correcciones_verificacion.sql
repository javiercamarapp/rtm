-- Correcciones de la segunda verificacion del historial (aditiva: create or replace + un trigger; sin DROP ni datos).
--  * M2: una ENTREGA a la sociedad o una LIQUIDACION entre socios aplica primero a los fondos de la sociedad que el pagador tiene en su poder (luego faltantes, luego general). Antes se asentaba
--    siempre como 'general': el mayor (1150) bajaba y el auxiliar 'fondos' no, y 'Libro conciliado' quedaba en rojo.
--  * B1: el sello del acta tambien es inmutable ante TRUNCATE. B3: periodo invalido (fin < ini) devuelve 22023 con mensaje claro.
--  * B4: sellar_acta marca 'sin_valuacion' (con motivo) cuando no pudo valuar; el acta y el PDF lo muestran. Se prefiere sellar con la marca antes que bloquear el cierre del acta.

--    Una entrega 'general' mayor que lo que el socio tiene/debe se rechaza (23514) en vez de dejar un renglon general que el mayor (1150) contaria y el auxiliar de fondos no.
-- Reparto de un monto entre los conceptos del socio: fondos en su poder primero, faltante asignado despues y el resto general. p_aplica_a distinto de 'general' no se parte.
create function operacion.partir_entrega_socio(p_socio bigint, p_aplica_a text, p_monto_cent bigint) returns table (aplica_a text, monto_cent bigint)
language plpgsql stable security definer set search_path = ''
as $$
declare v_f bigint; v_d bigint;
begin
  if p_aplica_a <> 'general' then return query select p_aplica_a, p_monto_cent; return; end if;
  v_f := least(p_monto_cent, greatest(operacion.saldo_socio(p_socio, 'fondos'), 0));
  v_d := least(p_monto_cent - v_f, greatest(operacion.saldo_socio(p_socio, 'diferencia'), 0));
  if v_f > 0 then return query select 'fondos'::text, v_f; end if;
  if v_d > 0 then return query select 'diferencia'::text, v_d; end if;
  if p_monto_cent - v_f - v_d > 0 then return query select 'general'::text, p_monto_cent - v_f - v_d; end if;
end $$;

create or replace function operacion.registrar_entrega_socio(p_clave_idem text, p_socio text, p_monto_cent bigint, p_destino text default 'sociedad', p_socio_destino text default null,
                                                  p_aplica_a text default 'general', p_nota text default null, p_fecha date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_dest bigint; v_ev bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_pend bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_entrega_socio', 's', p_socio, 'm', p_monto_cent, 'd', p_destino, 'sd', p_socio_destino, 'a', p_aplica_a, 'n', p_nota, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'la entrega debe ser positiva' using errcode = '23514'; end if;
  if p_destino not in ('sociedad', 'otro_socio') or p_aplica_a not in ('fondos', 'diferencia', 'general') then raise exception 'destino o concepto invalido' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  if p_destino = 'otro_socio' then
    select id into v_dest from catalogo.socio where nombre = p_socio_destino;
    if v_dest is null or v_dest = v_socio then raise exception 'socio destino invalido' using errcode = '22023'; end if;
  end if;
  if p_aplica_a <> 'general' then
    v_pend := operacion.saldo_socio(v_socio, p_aplica_a);
    if p_monto_cent > v_pend then raise exception 'la entrega (%) excede lo pendiente de ese concepto (%)', p_monto_cent, v_pend using errcode = '23514'; end if;
  end if;
  -- Una entrega "general" tampoco puede exceder lo que el socio tiene en su poder o debe (fondos + faltantes): el exceso no es una entrega, es otra cosa (un anticipo o una aportacion) y se registra por su via.
  if p_aplica_a = 'general' and p_monto_cent > greatest(operacion.saldo_socio(v_socio), 0) then
    raise exception 'la entrega (%) excede lo que % tiene de la sociedad en su poder o le debe (%): el exceso se registra como aportacion o reembolso, no como entrega', p_monto_cent, p_socio, greatest(operacion.saldo_socio(v_socio), 0) using errcode = '23514';
  end if;
  v_ev := operacion.crear_evento('entrega_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'destino', p_destino));
  -- Lo que entrega aplica PRIMERO a los fondos de la sociedad que tiene en su poder, luego a faltantes asignados y solo el resto a "general" (mayor y auxiliar bajan juntos).
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
    select v_socio, v_fecha, case when p_destino = 'sociedad' then 'entrega_a_sociedad' else 'traspaso_entre_socios' end, x.aplica_a, -x.monto_cent,
           coalesce(p_nota, case when p_destino = 'sociedad' then 'Entrega a la sociedad' else 'Traspaso a ' || p_socio_destino end), v_ev
      from operacion.partir_entrega_socio(v_socio, p_aplica_a, p_monto_cent) x;
  if v_dest is not null then
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
      values (v_dest, v_fecha, 'traspaso_entre_socios', 'fondos', p_monto_cent, 'Recibe de ' || p_socio, v_ev);
  end if;
  v_res := jsonb_build_object('deuda_socio_cent', operacion.saldo_socio(v_socio), 'diferencia_pendiente_cent', operacion.saldo_socio(v_socio, 'diferencia'), 'fondos_pendientes_cent', operacion.saldo_socio(v_socio, 'fondos'));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function operacion.registrar_liquidacion_entre_socios(p_clave_idem text, p_de text, p_a text, p_monto_cent bigint, p_nota text default null,
                                                                        p_fecha date default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_de bigint; v_a bigint; v_fecha date; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_liquidacion_entre_socios', 'd', p_de, 'a', p_a, 'm', p_monto_cent, 'n', p_nota, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'la liquidacion debe ser positiva' using errcode = '23514'; end if;
  select id into v_de from catalogo.socio where nombre = p_de;
  select id into v_a from catalogo.socio where nombre = p_a;
  if v_de is null or v_a is null or v_de = v_a then raise exception 'indica dos socios distintos' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(81002, v_de::int);
  if p_monto_cent > greatest(operacion.saldo_socio(v_de), 0) then
    raise exception 'la liquidacion (% centavos) excede lo que % debe a la sociedad (% centavos)', p_monto_cent, p_de, greatest(operacion.saldo_socio(v_de), 0) using errcode = '23514';
  end if;
  v_fecha := operacion.fecha_efectiva(p_fecha);
  v_ev := operacion.crear_evento('liquidacion_entre_socios', v_fecha, p_clave_idem, jsonb_build_object('de', p_de, 'a', p_a, 'monto_cent', p_monto_cent), p_mensaje_origen);
  -- Lo que liquida aplica PRIMERO a los fondos de la sociedad que el pagador tiene en su poder, luego a faltantes asignados y solo el resto a "general": el mayor (1150/1170) y el auxiliar bajan juntos.
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
    select v_de, v_fecha, 'entrega_a_sociedad', x.aplica_a, -x.monto_cent, coalesce(p_nota, 'Liquidacion a ' || p_a), v_ev
      from operacion.partir_entrega_socio(v_de, 'general', p_monto_cent) x;
  insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
    values (v_a, v_fecha, 'liquidacion_recibida', -p_monto_cent, 'otro_socio', coalesce(p_nota, 'Liquidacion recibida de ' || p_de), v_ev);
  v_res := jsonb_build_object('eco_de', operacion.eco_socio(v_de), 'eco_a', operacion.eco_socio(v_a));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function operacion.proponer_cierre_reparto(p_clave_idem text, p_ini date, p_fin date, p_decisiones jsonb default '{}'::jsonb, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_c jsonb; v_ev bigint; v_id bigint; v_folio text; v_yo bigint := operacion.actor_socio(); v_res jsonb; s record; v_dec jsonb := '{}'::jsonb; v_x jsonb;
  v_retira bigint; v_reinv bigint; v_disp bigint; v_ult date;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'proponer_cierre_reparto', 'i', p_ini, 'f', p_fin, 'd', p_decisiones, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(true);
  if p_ini is null or p_fin is null or p_fin < p_ini then raise exception 'periodo invalido: la fecha final (%) no puede ser anterior a la inicial (%)', p_fin, p_ini using errcode = '22023'; end if;
  if p_fin >= negocio.hoy() then raise exception 'el periodo del % al % aun no termina: se cierra a partir del %', p_ini, p_fin, p_fin + 1 using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.cierre_periodo_vigente v where v.rango && daterange(p_ini, p_fin, '[]')) then
    raise exception 'ya existe un acta de corte que se traslapa con ese periodo' using errcode = 'P0428';
  end if;
  if exists (select 1 from operacion.cierre_periodo_vigente v where (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = v.cierre_id) < 2) then
    raise exception 'hay un acta pendiente de firma o de anular: terminala antes de proponer otra' using errcode = 'P0428';
  end if;
  select max(upper(v.rango) - 1) into v_ult from operacion.cierre_periodo_vigente v;
  if v_ult is not null and p_ini <= v_ult then raise exception 'el acta debe seguir al ultimo corte (termina el %)', v_ult using errcode = 'P0428'; end if;
  v_c := operacion.cascada_periodo(p_ini, p_fin);
  for s in select nombre from catalogo.socio order by nombre loop
    v_x := coalesce(p_decisiones->s.nombre, '{}'::jsonb);
    v_retira := coalesce((v_x->>'retira')::bigint, 0); v_reinv := coalesce((v_x->>'reinvierte')::bigint, 0);
    v_disp := greatest((v_c->'por_socio'->s.nombre->>'utilidad_cent')::bigint - (v_c->'por_socio'->s.nombre->>'anticipo_cent')::bigint, 0);
    if v_retira < 0 or v_reinv < 0 or v_retira + v_reinv > v_disp then
      raise exception 'la decision de % (retira % + reinvierte %) excede su parte disponible (% centavos)', s.nombre, v_retira, v_reinv, v_disp using errcode = '23514';
    end if;
    v_dec := v_dec || jsonb_build_object(s.nombre, jsonb_build_object('retira', v_retira, 'reinvierte', v_reinv));
  end loop;
  v_ev := operacion.crear_evento('cierre_reparto_propuesto', negocio.hoy(), p_clave_idem, jsonb_build_object('ini', p_ini, 'fin', p_fin));
  v_folio := seguridad.siguiente_folio('CR');
  insert into operacion.cierre_reparto (folio, periodo_ini, periodo_fin, utilidad_cent, utilidad_provisional, efectivo_caja_cent, devolver_aportaciones_antes, nota, snapshot, propuesto_por, evento_id,
                                        decisiones, arrastre_ini_cent, arrastre_fin_cent)
    values (v_folio, p_ini, p_fin, (v_c->>'utilidad_cent')::bigint, (v_c->>'utilidad_provisional')::boolean, greatest(operacion.saldo_efectivo(), 0), false, p_nota, v_c, v_yo, v_ev,
            v_dec, (v_c->>'arrastre_ini_cent')::bigint, (v_c->>'arrastre_fin_cent')::bigint) returning id into v_id;
  insert into operacion.cierre_periodo_vigente (cierre_id, rango) values (v_id, daterange(p_ini, p_fin, '[]'));
  perform operacion.avisar('cascada_lista_firma', 'NT-045', 'cascada_firma:' || v_id, 'I', 'Acta de corte del periodo ' || p_ini || ' al ' || p_fin || ' lista para firma (' || v_folio || ')', 'cierre_reparto', v_id,
    jsonb_build_object('folio', v_folio), null, v_ev, true, array['software', 'telegram']);
  if (v_c->>'limitado_por_efectivo')::boolean then
    perform operacion.avisar('utilidad_mayor_que_efectivo', 'NT-046', 'utilidad_vs_efectivo:' || v_id, 'I', 'La utilidad acumulada es mayor que el efectivo: el reparto queda limitado y el resto se arrastra (' || v_folio || ')', 'cierre_reparto', v_id,
      jsonb_build_object('folio', v_folio), null, v_ev, false, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('cierre_id', v_id, 'folio', v_folio, 'cascada', v_c, 'decisiones', v_dec);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function operacion.sellar_acta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c operacion.cierre_reparto; v_val jsonb; v_cap jsonb; v_fila jsonb; v_cont jsonb; v_valor jsonb := '{}'::jsonb; v_soc jsonb := '{}'::jsonb; s record; v_comp bigint; v_ret jsonb;
  v_disp bigint; v_d jsonb; v_cap_ok boolean := false; v_err text;
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
  exception when others then v_cap := null; v_val := null; v_cap_ok := false; v_err := sqlerrm;
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
    -- Si la valuacion no se pudo calcular, el acta SE SELLA igual (un fallo de valuacion no debe impedir cerrar el acta) pero queda marcada y las pantallas lo avisan.
    'sin_valuacion', not v_cap_ok, 'motivo_sin_valuacion', case when v_cap_ok then null when v_err is not null then 'error al calcular la valuacion: ' || v_err else 'todavia no habia asientos contables al corte' end,
    'valuacion_cent', case when v_cap_ok then (v_val ->> 'v01_valuacion_cent')::bigint end,
    'deudas_cent', case when v_cap_ok then (v_val ->> 'v02_deudas_cent')::bigint end,
    'capital_contable_cent', case when v_cap_ok then (v_cap -> 'balance' ->> 'total_capital_cent')::bigint end,
    'valor_participacion_cent', case when v_cap_ok then v_valor end,
    'por_socio', v_soc);
  insert into operacion.acta_sello (cierre_id, fecha_neg, contenido, huella)
    values (c.id, negocio.hoy(), v_cont, encode(sha256(convert_to(v_cont::text, 'UTF8')), 'hex'));
  return null;
end $$;

create trigger acta_sello_no_truncate before truncate on operacion.acta_sello for each statement execute function operacion.acta_sello_inmutable();

-- Permisos: las funciones nuevas no son ejecutables desde la web; las redefinidas conservan los suyos (create or replace).
revoke execute on function operacion.partir_entrega_socio(bigint, text, bigint) from public, anon, authenticated;
