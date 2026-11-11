-- Dinero entre socios / 3: cascada corregida y ACTA de corte mensual firmada por los dos.
-- Cierra H1 (retiros previos), H2 (perdida y utilidad no repartida se arrastran), H3 (efectivo calculado y comprometido), H4 (perdida 50/50), H5 (recalcula al firmar),
-- H8 (identidad por dos vias), H12 (candado y traslape), H14 (una sola regla de redondeo) y H15 (la devolucion de capital deja de ser automatica).
-- Reglas del dueno 11-nov: utilidad 50/50 fija; reembolsos primero; perdidas 50/50 arrastradas; redondeo a favor de quien paga o aporta, con desempate rotatorio;
-- reinversion de utilidades = inversion de cada socio; acta inmutable (se corrige solo con contra-acta).

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------
do $$
declare v_nombre text;
begin
  select c.conname into v_nombre from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'operacion' and t.relname = 'socio_libro' and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%utilidad_asignada%';
  execute format('alter table operacion.socio_libro drop constraint %I', v_nombre);
end $$;
alter table operacion.socio_libro add constraint socio_libro_concepto_check
  check (concepto in ('utilidad_asignada', 'pago_reembolso', 'pago_devolucion_aportacion', 'pago_utilidad', 'retiro', 'liquidacion_recibida', 'reinversion', 'reversa'));

alter table operacion.cierre_reparto
  add column tipo text not null default 'periodo' check (tipo in ('periodo', 'contra')),
  add column corrige_a bigint references operacion.cierre_reparto (id),
  add column decisiones jsonb not null default '{}'::jsonb,
  add column arrastre_ini_cent bigint not null default 0,
  add column arrastre_fin_cent bigint not null default 0,
  add constraint cierre_reparto_contra_chk check ((tipo = 'contra') = (corrige_a is not null));

-- Un periodo solo puede tener un acta vigente: restriccion de exclusion sobre el rango (H12). La fila se borra al anular el acta o al corregirla con contra-acta.
create table operacion.cierre_periodo_vigente (
  cierre_id bigint primary key references operacion.cierre_reparto (id),
  rango daterange not null,
  exclude using gist (rango with &&)
);
alter table operacion.cierre_periodo_vigente enable row level security;
alter table operacion.cierre_periodo_vigente force row level security;
revoke all on operacion.cierre_periodo_vigente from public, anon, authenticated;

drop function operacion.cascada_periodo(date, date, bigint, boolean);
drop function operacion.cascada_calcular(bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, boolean);
drop function operacion.repartir_proporcional(bigint, jsonb, jsonb);
drop function api.proponer_cierre_reparto(text, date, date, bigint, boolean, text);
drop function operacion.proponer_cierre_reparto(text, date, date, bigint, boolean, text);
drop function api.cascada_proyeccion(date, date, bigint);

-- ---------------------------------------------------------------------------
-- Actas vigentes y arrastre
-- ---------------------------------------------------------------------------
-- Acta vigente = de periodo, firmada por los dos, no anulada y no corregida por una contra-acta firmada.
create or replace function operacion.ultimo_cierre_firmado_fin() returns date
language sql stable security definer set search_path = ''
as $$
  select max(c.periodo_fin) from operacion.cierre_reparto c
   where c.tipo = 'periodo'
     and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)
     and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2
     and not exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = k.id) >= 2)
$$;

-- Utilidad no repartida acumulada (positiva) o perdida por absorber (negativa) que dejo la ultima acta firmada.
create function operacion.arrastre_actual() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select c.arrastre_fin_cent from operacion.cierre_reparto c
                    where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)
                      and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2
                      and not exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = k.id) >= 2)
                    order by c.id desc limit 1), 0)::bigint
$$;

-- ---------------------------------------------------------------------------
-- Redondeo unico (E): los centavos sueltos van a favor de quien paga o aporta (mayor prioridad); a igual prioridad rota segun el periodo, de forma determinista.
-- ---------------------------------------------------------------------------
create function operacion.repartir_proporcional(p_total bigint, p_pesos jsonb, p_prioridad jsonb default '{}'::jsonb, p_rotor int default 0) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare k text; v_sum numeric := 0; v_out jsonb := '{}'::jsonb; v_asig bigint := 0; v_resto bigint; v_orden text[]; v_n int; v_val bigint;
begin
  if p_total <= 0 then return (select coalesce(jsonb_object_agg(x, 0), '{}'::jsonb) from jsonb_object_keys(p_pesos) x); end if;
  for k in select jsonb_object_keys(p_pesos) loop v_sum := v_sum + (p_pesos->>k)::numeric; end loop;
  if v_sum = 0 then return (select coalesce(jsonb_object_agg(x, 0), '{}'::jsonb) from jsonb_object_keys(p_pesos) x); end if;
  for k in select jsonb_object_keys(p_pesos) order by 1 loop
    v_val := floor(p_total::numeric * (p_pesos->>k)::numeric / v_sum)::bigint;
    v_out := v_out || jsonb_build_object(k, v_val);
    v_asig := v_asig + v_val;
  end loop;
  v_resto := p_total - v_asig;
  select count(*)::int into v_n from jsonb_object_keys(p_pesos) x where (p_pesos->>x)::numeric > 0;
  select array_agg(t.x order by t.pri desc, mod(t.rk - mod(p_rotor, v_n) + v_n, v_n))
    into v_orden
    from (select x, coalesce((p_prioridad->>x)::numeric, 0) as pri, (row_number() over (order by x)) - 1 as rk
            from (select y as x from jsonb_object_keys(p_pesos) y where (p_pesos->>y)::numeric > 0) z) t;
  while v_resto > 0 loop
    foreach k in array v_orden loop
      exit when v_resto = 0;
      v_out := v_out || jsonb_build_object(k, (v_out->>k)::bigint + 1);
      v_resto := v_resto - 1;
    end loop;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Cascada pura (sin leer tablas). Mapas por nombre de socio, centavos.
--   1 utilidad + arrastre; 2 efectivo disponible = caja + dinero en poder de socios - comprometido; 3 reembolsos primero; 4 repartible = min(utilidad acumulada, efectivo
--   que queda); 5 reparto por participacion (50/50 fija); lo no repartido y las perdidas se arrastran. Un anticipo (retiro mayor a lo asignado) descuenta la parte del socio.
-- ---------------------------------------------------------------------------
create function operacion.cascada_calcular(p_utilidad_cent bigint, p_arrastre_cent bigint, p_caja_cent bigint, p_comprometido_cent bigint, p_reembolsos jsonb, p_aportaciones jsonb,
                                           p_poder jsonb, p_deuda jsonb, p_anticipos jsonb, p_ppm jsonb, p_rotor int default 0) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  k text; v_socios text[]; v_poder_t bigint := 0; v_r_t bigint := 0; v_a_t bigint := 0; v_antic_t bigint := 0; v_deuda_t bigint := 0; v_noefec_t bigint := 0;
  v_efectivo bigint; v_disp bigint; v_pagado_r bigint; v_acum bigint; v_repartible bigint; v_pay_r jsonb; v_share jsonb; v_pesos jsonb := '{}'::jsonb; v_pri jsonb := '{}'::jsonb;
  v_pesos_r jsonb := '{}'::jsonb; v_por jsonb := '{}'::jsonb; v_asig_k bigint; v_res bigint; v_asignado bigint := 0; v_suma_res bigint := 0; v_neg text; v_pos text; v_neg_m bigint := 0; v_pos_m bigint := 0;
  v_liquidar jsonb := 'null'::jsonb; v_remanente bigint; v_via1 bigint; v_via2 bigint; v_esperado bigint;
begin
  if p_caja_cent < 0 then raise exception 'el efectivo de la caja no puede ser negativo' using errcode = '23514'; end if;
  select array_agg(x order by x) into v_socios from jsonb_object_keys(p_ppm) x;
  foreach k in array v_socios loop
    v_poder_t := v_poder_t + greatest(coalesce((p_poder->>k)::bigint, 0), 0);
    v_r_t := v_r_t + greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0);
    v_a_t := v_a_t + greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0);
    v_antic_t := v_antic_t + greatest(coalesce((p_anticipos->>k)::bigint, 0), 0);
    v_deuda_t := v_deuda_t + greatest(coalesce((p_deuda->>k)::bigint, 0), 0);
    v_noefec_t := v_noefec_t + greatest(coalesce((p_deuda->>k)::bigint, 0), 0) - greatest(coalesce((p_poder->>k)::bigint, 0), 0);
    v_pesos := v_pesos || jsonb_build_object(k, (p_ppm->>k)::bigint);
    v_pesos_r := v_pesos_r || jsonb_build_object(k, greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0));
    v_pri := v_pri || jsonb_build_object(k, greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0) + greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0));
  end loop;
  v_efectivo := v_poder_t + p_caja_cent;
  v_disp := greatest(v_efectivo - p_comprometido_cent, 0);
  v_pagado_r := least(v_disp, v_r_t);
  v_pay_r := operacion.repartir_proporcional(v_pagado_r, v_pesos_r, v_pri, p_rotor);
  v_acum := p_utilidad_cent + p_arrastre_cent;
  v_repartible := greatest(0, least(v_acum, v_disp - v_pagado_r + v_antic_t));
  v_share := operacion.repartir_proporcional(v_repartible, v_pesos, v_pri, p_rotor);
  v_remanente := v_efectivo - v_pagado_r - (v_repartible - v_antic_t);

  foreach k in array v_socios loop
    v_asig_k := (v_pay_r->>k)::bigint + (v_share->>k)::bigint - greatest(coalesce((p_anticipos->>k)::bigint, 0), 0);
    v_res := v_asig_k - greatest(coalesce((p_deuda->>k)::bigint, 0), 0);
    v_asignado := v_asignado + v_asig_k;
    v_suma_res := v_suma_res + v_res;
    v_por := v_por || jsonb_build_object(k, jsonb_build_object(
      'reembolso_pendiente_cent', greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0), 'aportacion_pendiente_cent', greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0),
      'paga_reembolso_cent', (v_pay_r->>k)::bigint, 'utilidad_cent', (v_share->>k)::bigint, 'anticipo_cent', greatest(coalesce((p_anticipos->>k)::bigint, 0), 0),
      'asignado_cent', v_asig_k, 'tiene_en_poder_cent', greatest(coalesce((p_poder->>k)::bigint, 0), 0), 'debe_cent', greatest(coalesce((p_deuda->>k)::bigint, 0), 0),
      'resultado_cent', v_res, 'sigue_pendiente_cent', greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0) - (v_pay_r->>k)::bigint));
    if v_res < v_neg_m then v_neg := k; v_neg_m := v_res; end if;
    if v_res > v_pos_m then v_pos := k; v_pos_m := v_res; end if;
  end loop;
  if v_neg is not null and v_pos is not null then
    v_liquidar := jsonb_build_object('de', v_neg, 'a', v_pos, 'monto_cent', least(-v_neg_m, v_pos_m));
  end if;
  -- Identidad por dos vias (H8). Via 1: lo asignado a los socios es lo que sale del efectivo (reembolsos + utilidad repartible - anticipos ya entregados).
  -- Via 2: los resultados de los socios, mas lo que cada uno tiene en su poder y lo que debe sin ser efectivo, suman lo mismo; la deuda que no es efectivo se muestra aparte.
  v_esperado := v_efectivo - v_remanente;
  v_via1 := v_asignado;
  v_via2 := v_suma_res + v_poder_t + v_noefec_t;
  return jsonb_build_object(
    'utilidad_cent', p_utilidad_cent, 'perdida_cent', greatest(-p_utilidad_cent, 0), 'arrastre_ini_cent', p_arrastre_cent, 'utilidad_acumulada_cent', v_acum,
    'arrastre_fin_cent', v_acum - v_repartible,
    'efectivo', jsonb_build_object('en_poder_cent', v_poder_t, 'caja_cent', p_caja_cent, 'total_cent', v_efectivo, 'comprometido_cent', p_comprometido_cent, 'disponible_cent', v_disp),
    'reembolsos', jsonb_build_object('pendiente_cent', v_r_t, 'pagado_cent', v_pagado_r),
    'aportaciones', jsonb_build_object('pendiente_cent', v_a_t, 'pagado_cent', 0),
    'repartible_cent', v_repartible, 'remanente_cent', v_remanente, 'limitado_por_efectivo', v_pagado_r < v_r_t or v_repartible < greatest(v_acum, 0),
    'por_socio', v_por, 'suma_asignada_cent', v_asignado, 'suma_resultados_cent', v_suma_res,
    'identidad', jsonb_build_object('via1_cent', v_via1, 'via2_cent', v_via2, 'efectivo_repartido_cent', v_esperado, 'deuda_no_efectivo_cent', v_noefec_t,
                                    'cuadra', v_via1 = v_esperado and v_via2 = v_esperado and v_remanente >= 0),
    'identidad_cuadra', v_via1 = v_esperado and v_via2 = v_esperado and v_remanente >= 0,
    'liquidar', v_liquidar);
end $$;

-- Insumos de la cascada desde los libros (una funcion por cifra). El efectivo se calcula de las cuentas de efectivo; nadie lo teclea.
create function operacion.cascada_periodo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_u jsonb; r jsonb := '{}'::jsonb; c jsonb := '{}'::jsonb; p jsonb := '{}'::jsonb; d jsonb := '{}'::jsonb; a jsonb := '{}'::jsonb; ppm jsonb := '{}'::jsonb; s record; v_calc jsonb;
  v_ef jsonb := operacion.efectivo_sociedad();
begin
  if p_ini is null or p_fin is null or p_fin < p_ini then raise exception 'periodo invalido' using errcode = '22023'; end if;
  v_u := operacion.utilidad_periodo(p_ini, p_fin);
  for s in select id, nombre, participacion_ppm from catalogo.socio order by nombre loop
    r := r || jsonb_build_object(s.nombre, operacion.reembolso_pendiente(s.id));
    c := c || jsonb_build_object(s.nombre, operacion.aportacion_pendiente(s.id));
    p := p || jsonb_build_object(s.nombre, greatest(operacion.saldo_socio(s.id, 'fondos'), 0));
    d := d || jsonb_build_object(s.nombre, greatest(operacion.saldo_socio(s.id), 0) + operacion.sobrepago_socio(s.id));
    a := a || jsonb_build_object(s.nombre, operacion.anticipo_socio(s.id));
    ppm := ppm || jsonb_build_object(s.nombre, s.participacion_ppm);
  end loop;
  v_calc := operacion.cascada_calcular((v_u->>'utilidad_cent')::bigint, operacion.arrastre_actual(), operacion.saldo_efectivo(), (v_ef->>'comprometido_cent')::bigint, r, c, p, d, a, ppm, (p_ini - date '2000-01-01'));
  return v_calc || jsonb_build_object('periodo_ini', p_ini, 'periodo_fin', p_fin, 'utilidad_detalle', v_u, 'utilidad_provisional', (v_u->>'provisional')::boolean,
                                      'efectivo_detalle', v_ef);
end $$;

-- Cifras que no pueden cambiar entre la propuesta y la firma.
create function operacion.huella_cascada(p jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select jsonb_build_object('u', p->'utilidad_cent', 'a', p->'arrastre_ini_cent', 'r', p->'repartible_cent', 'pr', p->'reembolsos'->'pagado_cent',
    's', (select jsonb_object_agg(e.key, jsonb_build_object('r', e.value->'paga_reembolso_cent', 's', e.value->'utilidad_cent', 'x', e.value->'anticipo_cent', 'd', e.value->'debe_cent')) from jsonb_each(p->'por_socio') e))
$$;

-- Compensa (baja) lo que un socio debe a la sociedad: primero fondos, luego faltantes asignados, luego lo general.
-- (operacion.compensar_socio no cambia.)

-- ---------------------------------------------------------------------------
-- Acta de corte: propuesta (con la decision de cada socio), firmas y asientos
-- ---------------------------------------------------------------------------
-- p_decisiones: {"Angelo": {"retira": 100000, "reinvierte": 500000}, ...}. Sin decision, la utilidad queda como 'utilidad por distribuir' (no se pierde ni se reparte sola).
create function operacion.proponer_cierre_reparto(p_clave_idem text, p_ini date, p_fin date, p_decisiones jsonb default '{}'::jsonb, p_nota text default null) returns jsonb
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

-- Firma del socio que actua. Cada firma RECALCULA con los libros de ese momento y exige las mismas cifras de la propuesta (H5): si algo se capturo o pago entre tanto,
-- no se firma una foto vieja; hay que anular el acta y proponerla de nuevo. Con las dos firmas el acta surte efecto y queda inmutable.
create or replace function operacion.firmar_cierre_reparto(p_clave_idem text, p_cierre bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.cierre_reparto; o operacion.cierre_reparto; v_yo bigint := operacion.actor_socio(); v_ev bigint; v_firmas int; s record; v_x jsonb; v_d jsonb; v_pay_r bigint; v_util bigint; v_reinv bigint;
  v_res jsonb; v_cerrado boolean := false; v_nuevo jsonb; v_ev_firma bigint; v_aid bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'firmar_cierre_reparto', 'c', p_cierre));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(true);
  if v_yo is null then raise exception 'solo un socio firma' using errcode = '42501'; end if;
  select * into c from operacion.cierre_reparto where id = p_cierre for update;
  if not found then raise exception 'cierre desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then raise exception 'el acta % esta anulada', c.folio using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id and f.socio_id = v_yo) then raise exception 'ya firmaste el acta %', c.folio using errcode = 'P0428'; end if;
  if c.tipo = 'periodo' then
    v_nuevo := operacion.cascada_periodo(c.periodo_ini, c.periodo_fin);
    if operacion.huella_cascada(v_nuevo) <> operacion.huella_cascada(c.snapshot) then
      raise exception 'las cifras del acta % cambiaron desde que se propuso (se capturo o pago algo): anula el acta y propon otra', c.folio using errcode = 'P0428';
    end if;
  end if;
  v_ev := operacion.crear_evento('cierre_reparto_firmado', negocio.hoy(), p_clave_idem, jsonb_build_object('cierre', c.folio));
  insert into operacion.cierre_reparto_firma (cierre_id, socio_id, evento_id) values (c.id, v_yo, v_ev);
  select count(*)::int into v_firmas from operacion.cierre_reparto_firma where cierre_id = c.id;
  if v_firmas >= 2 and c.tipo = 'periodo' then
    v_cerrado := true;
    for s in select id, nombre from catalogo.socio order by nombre loop
      v_x := c.snapshot->'por_socio'->s.nombre; v_d := c.decisiones->s.nombre;
      v_pay_r := (v_x->>'paga_reembolso_cent')::bigint; v_util := (v_x->>'utilidad_cent')::bigint; v_reinv := coalesce((v_d->>'reinvierte')::bigint, 0);
      if v_pay_r > 0 then
        insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id)
          values (s.id, negocio.hoy(), 'pago_reembolso', -v_pay_r, 'cascada', 'Reembolso pagado en el acta ' || c.folio, c.id, v_ev);
        perform operacion.compensar_socio(s.id, least(v_pay_r, greatest(operacion.saldo_socio(s.id), 0)), v_ev, 'Compensacion del acta ' || c.folio);
      end if;
      if v_util > 0 then
        insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id)
          values (s.id, negocio.hoy(), 'utilidad_asignada', v_util, 'cascada', 'Utilidad del periodo ' || c.periodo_ini || ' al ' || c.periodo_fin || ' (' || c.folio || ')', c.id, v_ev);
      end if;
      -- Reinversion de utilidades: se registra como inversion (capital) de ese socio; la utilidad asignada baja lo mismo.
      if v_reinv > 0 then
        insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id)
          values (s.id, negocio.hoy(), 'reinversion', -v_reinv, 'cascada', 'Reinversion de utilidades (' || c.folio || ')', c.id, v_ev);
        insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
          values (s.id, v_reinv, 'Reinversion de utilidades (' || c.folio || ')', 'capital', negocio.hoy(), 'reinversion', c.id, v_ev);
      end if;
    end loop;
    perform operacion.resolver_avisos('cascada_lista_firma', 'cierre_reparto', c.id);
    perform operacion.avisar('periodo_cascada_cerrado', 'NT-047', 'cierre_firmado:' || c.id, 'I', 'Acta de corte ' || c.folio || ' firmada por los dos socios', 'cierre_reparto', c.id,
      jsonb_build_object('folio', c.folio), null, v_ev, true, array['software', 'telegram']);
  elsif v_firmas >= 2 and c.tipo = 'contra' then
    v_cerrado := true;
    select * into o from operacion.cierre_reparto where id = c.corrige_a;
    -- La contra-acta deshace, renglon por renglon, lo que asento el acta original (el original no se toca).
    insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id, reversa_de)
      select l.socio_id, negocio.hoy(), 'reversa', -l.monto_cent, l.via, 'Contra-acta ' || c.folio || ' de ' || o.folio, c.id, v_ev, l.id
        from operacion.socio_libro l where l.cierre_id = o.id and l.concepto <> 'reversa' and not exists (select 1 from operacion.socio_libro r where r.reversa_de = l.id);
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id, reversa_de)
      select a.socio_id, -a.monto_cent, 'Contra-acta ' || c.folio, a.clasificacion, negocio.hoy(), a.ref_tipo, a.ref_id, v_ev, a.id
        from operacion.aportacion_socio a where a.ref_tipo = 'reinversion' and a.ref_id = o.id and a.reversa_de is null and not exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id);
    select f.evento_id into v_ev_firma from operacion.cierre_reparto_firma f where f.cierre_id = o.id order by f.id desc limit 1;
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id, reversa_de)
      select m.socio_id, negocio.hoy(), 'reversa', m.aplica_a, -m.monto_cent, 'Contra-acta ' || c.folio, v_ev, m.id
        from operacion.cuenta_socio_mov m where m.evento_id = v_ev_firma and m.concepto = 'compensacion_reparto' and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id);
    delete from operacion.cierre_periodo_vigente where cierre_id = o.id;
    perform operacion.resolver_avisos('cascada_lista_firma', 'cierre_reparto', c.id);
  end if;
  v_res := jsonb_build_object('cierre_id', c.id, 'folio', c.folio, 'firmas', v_firmas, 'cerrado', v_cerrado);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Un acta no se edita: antes de las dos firmas se anula; firmada por los dos solo se corrige con una contra-acta (que tambien firman los dos).
create or replace function operacion.anular_cierre_reparto(p_clave_idem text, p_cierre bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.cierre_reparto; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_cierre_reparto', 'c', p_cierre, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(true);
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into c from operacion.cierre_reparto where id = p_cierre for update;
  if not found then raise exception 'cierre desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then raise exception 'el acta % ya esta anulada', c.folio using errcode = 'P0428'; end if;
  if (select count(*) from operacion.cierre_reparto_firma where cierre_id = c.id) >= 2 then raise exception 'el acta % ya esta firmada por los dos: se corrige con una contra-acta', c.folio using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('cierre_reparto_anulado', negocio.hoy(), p_clave_idem, jsonb_build_object('cierre', c.folio));
  insert into operacion.cierre_reparto_anulacion (cierre_id, motivo, evento_id) values (c.id, p_motivo, v_ev);
  delete from operacion.cierre_periodo_vigente where cierre_id = c.id;
  perform operacion.resolver_avisos('cascada_lista_firma', 'cierre_reparto', c.id);
  perform operacion.resolver_avisos('utilidad_mayor_que_efectivo', 'cierre_reparto', c.id);
  v_res := jsonb_build_object('cierre_id', c.id, 'anulado', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Contra-acta: corrige la ULTIMA acta firmada. Propone un acta de tipo 'contra' que deshace los asientos del original y devuelve el arrastre; la firman los dos.
create function operacion.contra_acta_reparto(p_clave_idem text, p_cierre bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; o operacion.cierre_reparto; v_ev bigint; v_id bigint; v_folio text; v_yo bigint := operacion.actor_socio(); v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'contra_acta_reparto', 'c', p_cierre, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(true);
  if nullif(btrim(p_motivo), '') is null then raise exception 'la contra-acta exige motivo' using errcode = '23502'; end if;
  select * into o from operacion.cierre_reparto where id = p_cierre for update;
  if not found or o.tipo <> 'periodo' then raise exception 'acta desconocida' using errcode = '22023'; end if;
  if (select count(*) from operacion.cierre_reparto_firma where cierre_id = o.id) < 2 then raise exception 'el acta % aun no esta firmada: se anula', o.folio using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.cierre_reparto k where k.corrige_a = o.id) then raise exception 'el acta % ya tiene una contra-acta', o.folio using errcode = 'P0428'; end if;
  if o.id <> (select max(c.id) from operacion.cierre_reparto c where c.tipo = 'periodo' and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)
                 and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2 and not exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id)) then
    raise exception 'solo se corrige el ultimo corte firmado' using errcode = 'P0428';
  end if;
  v_ev := operacion.crear_evento('contra_acta_propuesta', negocio.hoy(), p_clave_idem, jsonb_build_object('acta', o.folio));
  v_folio := seguridad.siguiente_folio('CR');
  insert into operacion.cierre_reparto (folio, periodo_ini, periodo_fin, utilidad_cent, utilidad_provisional, efectivo_caja_cent, devolver_aportaciones_antes, nota, snapshot, propuesto_por, evento_id,
                                        tipo, corrige_a, arrastre_ini_cent, arrastre_fin_cent)
    values (v_folio, o.periodo_ini, o.periodo_fin, o.utilidad_cent, o.utilidad_provisional, o.efectivo_caja_cent, false, p_motivo,
            jsonb_build_object('contra', true, 'corrige', o.folio, 'motivo', p_motivo), v_yo, v_ev, 'contra', o.id, o.arrastre_fin_cent, o.arrastre_ini_cent) returning id into v_id;
  perform operacion.avisar('cascada_lista_firma', 'NT-045', 'cascada_firma:' || v_id, 'I', 'Contra-acta ' || v_folio || ' de ' || o.folio || ' lista para firma', 'cierre_reparto', v_id,
    jsonb_build_object('folio', v_folio), null, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('cierre_id', v_id, 'folio', v_folio);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas para la web (rol socio)
-- ---------------------------------------------------------------------------
create function api.cascada_proyeccion(p_ini date default null, p_fin date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy(); v_ini date := coalesce(p_ini, operacion.semana_omar_ini(negocio.hoy())); v_fin date := coalesce(p_fin, negocio.hoy());
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.cascada_periodo(v_ini, v_fin) || jsonb_build_object('hoy', v_hoy, 'en_vivo', v_fin >= v_hoy);
end $$;

create or replace function api.cierres_reparto() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'folio', c.folio, 'tipo', c.tipo, 'corrige_a', c.corrige_a, 'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent,
      'utilidad_provisional', c.utilidad_provisional, 'efectivo_caja_cent', c.efectivo_caja_cent, 'nota', c.nota, 'snapshot', c.snapshot, 'decisiones', c.decisiones,
      'arrastre_ini_cent', c.arrastre_ini_cent, 'arrastre_fin_cent', c.arrastre_fin_cent, 'creado_at', c.creado_at, 'propuesto_por', (select nombre from catalogo.socio where id = c.propuesto_por),
      'firmas', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'firmado_at', f.firmado_at) order by f.id) from operacion.cierre_reparto_firma f join catalogo.socio s on s.id = f.socio_id where f.cierre_id = c.id), '[]'::jsonb),
      'estado', case when exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then 'anulado'
                     when (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2 then 'cerrado'
                     when exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id) then 'firmado_por_uno' else 'propuesto' end,
      'corregida', exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id),
      'yo_firme', exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id and f.socio_id = operacion.actor_socio())) order by c.id desc)
    from operacion.cierre_reparto c), '[]'::jsonb);
end $$;

-- Posicion del dinero entre socios: efectivo, comprometido y, por socio, lo pendiente en cada concepto.
create function api.socios_dinero() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('efectivo', operacion.efectivo_sociedad(), 'arrastre_cent', operacion.arrastre_actual(),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'reembolso_pendiente_cent', operacion.reembolso_pendiente(s.id), 'capital_cent', operacion.aportacion_pendiente(s.id),
        'utilidad_por_distribuir_cent', operacion.utilidad_por_distribuir(s.id), 'anticipo_cent', operacion.anticipo_socio(s.id), 'sobrepago_cent', operacion.sobrepago_socio(s.id),
        'neto_cent', operacion.neto_socio(s.id)) order by s.nombre) from catalogo.socio s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* y permisos
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['proponer_cierre_reparto', 'contra_acta_reparto'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;
grant execute on function api.cascada_proyeccion(date, date), api.socios_dinero() to authenticated;
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
