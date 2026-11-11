-- Dinero entre socios / 2: capturas con intencion obligatoria, gasto doble por envio, topes, candado de periodo y retiro de capital explicito.
-- Reglas del dueno (11-nov): el dinero de un socio es REEMBOLSO / cuenta por pagar salvo que se declare aportacion de capital (campo obligatorio);
-- la devolucion de aportaciones YA NO es automatica: es un retiro de capital explicito, propuesto por uno y confirmado por el otro.
-- Hallazgos de la auditoria 01 cerrados aqui: H6 (envio doble), H7 (periodo cerrado), H9 (cuenta_socios), H10 (topes), H11 (anular lo ya pagado), H12 (concurrencia).

-- Las capturas de dinero entre socios dejan de tener la clasificacion por omision 'capital'.
drop function api.registrar_aportacion(text, text, bigint, text, text, date, text);
drop function api.registrar_gasto_socio(text, text, bigint, text, text, date, bigint, text, text);
drop function operacion.registrar_aportacion(text, text, bigint, text, text, date, text);
drop function operacion.registrar_gasto_socio(text, text, bigint, text, text, date, bigint, text, text);

-- ---------------------------------------------------------------------------
-- Lecturas
-- ---------------------------------------------------------------------------
-- Lo que un socio puso para la compra inicial y sus guias (todo menos los gastos de operacion que pago de su bolsillo: esos se reembolsan, no se comparan con la mitad de la compra).
create function operacion.aportado_compra_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.aportacion_socio where socio_id = p_socio and coalesce(ref_tipo, '') <> 'gasto' $$;

-- Reembolso cobrado de mas (un gasto se anulo despues de reembolsarse): el socio debe ese dinero a la sociedad.
create function operacion.sobrepago_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select greatest(-(operacion.aportado_socio(p_socio, 'reembolsable') + operacion.libro_socio(p_socio, 'pago_reembolso')), 0)::bigint $$;

-- Utilidad ya asignada al socio y que la sociedad aun le debe (positivo) o anticipo que ya recibio (negativo). Excluye reembolsos y capital.
create function operacion.utilidad_por_distribuir(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select (operacion.libro_socio(p_socio) - operacion.libro_socio(p_socio, 'pago_reembolso') - operacion.libro_socio(p_socio, 'pago_devolucion_aportacion'))::bigint $$;

create function operacion.anticipo_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select greatest(-operacion.utilidad_por_distribuir(p_socio), 0)::bigint $$;

-- Deshace el movimiento de efectivo ligado a una captura (si lo tiene). No deja la cuenta en negativo.
create function operacion.revertir_efectivo(p_ref_tipo text, p_ref_id bigint, p_evento bigint, p_nota text) returns void
language plpgsql security definer set search_path = ''
as $$
declare m operacion.cuenta_efectivo_mov;
begin
  for m in select * from operacion.cuenta_efectivo_mov x where x.ref_tipo = p_ref_tipo and x.ref_id = p_ref_id and x.concepto <> 'reversa'
              and not exists (select 1 from operacion.cuenta_efectivo_mov r where r.reversa_de = x.id) loop
    if operacion.saldo_efectivo(m.cuenta_id) - m.monto_cent < 0 then raise exception 'no se puede deshacer: la cuenta de efectivo quedaria en negativo' using errcode = 'P0428'; end if;
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id, reversa_de)
      values (m.cuenta_id, negocio.hoy(), 'reversa', -m.monto_cent, p_nota, m.ref_tipo, m.ref_id, p_evento, m.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Capturas
-- ---------------------------------------------------------------------------
-- Dinero que un socio deposita en la caja de la empresa. La intencion es OBLIGATORIA: 'capital' solo si el socio la declara; 'reembolso' = cuenta por pagar al socio.
create function operacion.registrar_aportacion(p_clave_idem text, p_socio text, p_monto_cent bigint, p_concepto text, p_intencion text, p_fecha date default null,
                                               p_mensaje_origen text default null, p_cuenta text default 'Caja de la empresa') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_cuenta bigint; v_fecha date; v_ev bigint; v_id bigint; v_clasif text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_aportacion', 's', p_socio, 'm', p_monto_cent, 'c', p_concepto, 'i', p_intencion, 'f', p_fecha, 'u', p_cuenta));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el deposito debe ser positivo' using errcode = '23514'; end if;
  if nullif(btrim(p_concepto), '') is null then raise exception 'el deposito necesita concepto' using errcode = '23502'; end if;
  if p_intencion is null or p_intencion not in ('capital', 'reembolso') then raise exception 'declara la intencion: capital (metimos mas lana para invertir) o reembolso (cuenta por pagar al socio)' using errcode = '23502'; end if;
  v_clasif := case p_intencion when 'capital' then 'capital' else 'reembolsable' end;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  v_cuenta := operacion.cuenta_efectivo_id(p_cuenta);
  if v_cuenta is null then raise exception 'cuenta de efectivo desconocida' using errcode = '22023'; end if;
  v_fecha := operacion.fecha_efectiva(p_fecha);
  v_ev := operacion.crear_evento('aportacion_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'clasificacion', v_clasif), p_mensaje_origen);
  insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, evento_id)
    values (v_socio, p_monto_cent, btrim(p_concepto), v_clasif, v_fecha, 'captura', v_ev) returning id into v_id;
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
    values (v_cuenta, v_fecha, 'deposito_socio', p_monto_cent, 'Deposito de ' || p_socio || ' (' || p_intencion || '): ' || btrim(p_concepto), 'aportacion', v_id, v_ev);
  v_res := jsonb_build_object('aportacion_id', v_id, 'clasificacion', v_clasif, 'eco', operacion.eco_socio(v_socio), 'efectivo', operacion.efectivo_sociedad());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Gasto pagado por un socio de su bolsillo: gasto de la sociedad (una sola vez) + reembolso. Avisa si la caja de la empresa alcanzaba (orden de fondeo) y
-- rechaza el envio doble (H6) y el probable duplicado.
create function operacion.registrar_gasto_socio(p_clave_idem text, p_socio text, p_monto_cent bigint, p_categoria text, p_naturaleza text default 'variable',
                                                p_fecha date default null, p_pedido bigint default null, p_nota text default null, p_mensaje_origen text default null,
                                                p_confirmar_duplicado boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_fecha date; v_origen date; v_ev bigint; v_id bigint; v_folio text; v_res jsonb; v_guia record; v_caja bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_gasto_socio', 's', p_socio, 'm', p_monto_cent, 'c', p_categoria, 'n', p_naturaleza, 'f', p_fecha, 'p', p_pedido, 'nt', p_nota));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el gasto debe ser positivo' using errcode = '23514'; end if;
  if nullif(btrim(p_categoria), '') is null then raise exception 'el gasto necesita categoria' using errcode = '23502'; end if;
  if p_naturaleza not in ('fijo', 'variable') then raise exception 'naturaleza invalida' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  -- H6: el costo de la guia de un pedido ya baja la utilidad del pedido; capturarlo otra vez como gasto cobraria el reembolso dos veces.
  if p_pedido is not null and p_categoria ~* '(envio|guia|paqueteria|flete)' then
    select g.id, g.numero, g.costo_cent into v_guia from operacion.guia g where g.pedido_id = p_pedido and g.sentido = 'salida' order by g.id limit 1;
    if found then
      raise exception 'el pedido % ya tiene la guia % (costo %): no se captura como gasto aparte; si falta el costo, fijalo en la guia', p_pedido, v_guia.numero, coalesce(v_guia.costo_cent::text, 'sin costo') using errcode = 'P0428';
    end if;
  end if;
  if not coalesce(p_confirmar_duplicado, false) and exists (
       select 1 from operacion.gasto g where g.pagado_por_socio_id = v_socio and g.monto_cent = p_monto_cent and g.categoria = btrim(p_categoria)
          and g.pedido_id is not distinct from p_pedido and g.fecha_neg >= negocio.hoy() - 3 and g.guia_id is null
          and not exists (select 1 from operacion.gasto_anulacion a where a.gasto_id = g.id)) then
    raise exception 'posible gasto duplicado (mismo socio, monto, categoria y pedido en los ultimos dias): confirma si es otro gasto' using errcode = 'P0428';
  end if;
  v_fecha := operacion.fecha_efectiva(p_fecha); v_origen := operacion.fecha_tardia(p_fecha);
  v_caja := operacion.caja_empresa();
  v_ev := operacion.crear_evento('gasto_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'categoria', p_categoria), p_mensaje_origen);
  v_folio := seguridad.siguiente_folio('G');
  insert into operacion.gasto (folio, fecha_neg, categoria, naturaleza, monto_cent, pagado_por_socio_id, pedido_id, evento_id, fecha_origen)
    values (v_folio, v_fecha, btrim(p_categoria), p_naturaleza, p_monto_cent, v_socio, p_pedido, v_ev, v_origen) returning id into v_id;
  insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
    values (v_socio, p_monto_cent, 'Gasto ' || v_folio || ': ' || btrim(p_categoria) || coalesce(' (' || p_nota || ')', ''), 'reembolsable', v_fecha, 'gasto', v_id, v_ev);
  v_res := jsonb_build_object('gasto_id', v_id, 'folio', v_folio, 'eco', operacion.eco_socio(v_socio), 'caja_alcanzaba', v_caja >= p_monto_cent, 'caja_cent', v_caja,
                              'tardio', v_origen is not null, 'fecha_origen', v_origen);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Pago de la sociedad a un socio: reembolso de gastos o retiro de utilidad. Sale de la caja de la empresa y no excede lo pendiente ni lo que hay en caja.
-- (El retiro de capital es explicito: proponer_retiro_capital / confirmar_retiro_capital.)
create or replace function operacion.registrar_pago_a_socio(p_clave_idem text, p_socio text, p_monto_cent bigint, p_tipo text, p_via text default 'transferencia',
                                                            p_fecha date default null, p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_fecha date; v_ev bigint; v_id bigint; v_res jsonb; v_pend bigint; v_concepto text; v_cuenta bigint := operacion.cuenta_efectivo_id('Caja de la empresa'); v_tope bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago_a_socio', 's', p_socio, 'm', p_monto_cent, 't', p_tipo, 'v', p_via, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  if p_tipo = 'devolucion_aportacion' then raise exception 'la devolucion de capital ya no es automatica: usa retiro de capital (lo propone uno y lo confirma el otro)' using errcode = 'P0428'; end if;
  if p_tipo not in ('reembolso', 'retiro') or p_via not in ('transferencia', 'efectivo') then raise exception 'tipo o via invalidos' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(81002, v_socio::int);
  v_concepto := case p_tipo when 'reembolso' then 'pago_reembolso' else 'retiro' end;
  if p_tipo = 'reembolso' then
    v_pend := operacion.reembolso_pendiente(v_socio);
    if p_monto_cent > v_pend then raise exception 'el pago (% centavos) excede lo pendiente de ese concepto (% centavos)', p_monto_cent, v_pend using errcode = '23514'; end if;
  else
    -- H10: un retiro sale de la utilidad que ya se le asigno; solo puede adelantarse hasta el limite de anticipos que fijen los dos (por omision 0).
    v_tope := operacion.utilidad_por_distribuir(v_socio) + coalesce((catalogo.config_valor('retiro_anticipo_max_cent'))::text::bigint, 0);
    if p_monto_cent > greatest(v_tope, 0) then raise exception 'el retiro (% centavos) excede la utilidad asignada que se le debe a % (% centavos)', p_monto_cent, p_socio, greatest(v_tope, 0) using errcode = '23514'; end if;
  end if;
  if operacion.saldo_efectivo(v_cuenta) < p_monto_cent then raise exception 'la caja de la empresa solo tiene % centavos', operacion.saldo_efectivo(v_cuenta) using errcode = '23514'; end if;
  v_fecha := operacion.fecha_efectiva(p_fecha);
  v_ev := operacion.crear_evento('pago_a_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'tipo', p_tipo), p_mensaje_origen);
  insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
    values (v_socio, v_fecha, v_concepto, -p_monto_cent, p_via, coalesce(p_nota, case p_tipo when 'reembolso' then 'Reembolso de gastos' else 'Retiro de utilidad' end), v_ev) returning id into v_id;
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
    values (v_cuenta, v_fecha, case p_tipo when 'reembolso' then 'pago_reembolso' else 'retiro_utilidad' end, -p_monto_cent, 'Pago a ' || p_socio || ' (' || p_tipo || ')', 'libro', v_id, v_ev);
  v_res := jsonb_build_object('libro_id', v_id, 'eco', operacion.eco_socio(v_socio), 'efectivo', operacion.efectivo_sociedad());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Liquidacion entre socios: solo hasta lo que el que paga debe a la sociedad (H10).
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
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
    values (v_de, v_fecha, 'entrega_a_sociedad', 'general', -p_monto_cent, coalesce(p_nota, 'Liquidacion a ' || p_a), v_ev);
  insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
    values (v_a, v_fecha, 'liquidacion_recibida', -p_monto_cent, 'otro_socio', coalesce(p_nota, 'Liquidacion recibida de ' || p_de), v_ev);
  v_res := jsonb_build_object('eco_de', operacion.eco_socio(v_de), 'eco_a', operacion.eco_socio(v_a));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Deshacer una captura con su contramovimiento (tambien el efectivo que movio). Un gasto anulado deja de contar en el periodo en que se anula, no en el original (H7);
-- si el reembolso ya se pago, el sobrepago queda como deuda del socio (H11, sobrepago_socio).
create or replace function operacion.anular_movimiento_socio(p_clave_idem text, p_tipo text, p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; a operacion.aportacion_socio; l operacion.socio_libro; g operacion.gasto; v_res jsonb; v_socio bigint; v_nuevo bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_movimiento_socio', 't', p_tipo, 'i', p_id, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if nullif(btrim(p_motivo), '') is null then raise exception 'deshacer exige motivo' using errcode = '23502'; end if;
  if p_tipo = 'aportacion' then
    select * into a from operacion.aportacion_socio where id = p_id for update;
    if not found then raise exception 'aportacion desconocida' using errcode = '22023'; end if;
    if a.reversa_de is not null or exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id) then raise exception 'esa aportacion ya esta deshecha' using errcode = 'P0428'; end if;
    if a.ref_tipo not in ('captura', 'gasto') then raise exception 'esa aportacion nace de otra operacion (%): se deshace desde ella', a.ref_tipo using errcode = 'P0428'; end if;
    v_ev := operacion.crear_evento('deshacer_aportacion', negocio.hoy(), p_clave_idem, jsonb_build_object('aportacion', a.id), null, null, null);
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id, reversa_de)
      values (a.socio_id, -a.monto_cent, 'Se deshace: ' || p_motivo, a.clasificacion, negocio.hoy(), a.ref_tipo, a.ref_id, v_ev, a.id) returning id into v_nuevo;
    if a.ref_tipo = 'gasto' then
      select * into g from operacion.gasto where id = a.ref_id;
      insert into operacion.gasto_anulacion (gasto_id, motivo, evento_id, fecha_neg) values (g.id, p_motivo, v_ev, negocio.hoy()) on conflict (gasto_id) do nothing;
    else
      perform operacion.revertir_efectivo('aportacion', a.id, v_ev, 'Se deshace: ' || p_motivo);
    end if;
    v_socio := a.socio_id;
  elsif p_tipo = 'libro' then
    select * into l from operacion.socio_libro where id = p_id for update;
    if not found then raise exception 'movimiento desconocido' using errcode = '22023'; end if;
    if l.concepto = 'reversa' or exists (select 1 from operacion.socio_libro r where r.reversa_de = l.id) then raise exception 'ese movimiento ya esta deshecho' using errcode = 'P0428'; end if;
    if l.cierre_id is not null then raise exception 'ese movimiento viene de un acta de corte firmada: se corrige con una contra-acta' using errcode = 'P0428'; end if;
    v_ev := operacion.crear_evento('deshacer_movimiento_socio', negocio.hoy(), p_clave_idem, jsonb_build_object('libro', l.id), null, null, null);
    insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id, reversa_de)
      values (l.socio_id, negocio.hoy(), 'reversa', -l.monto_cent, l.via, 'Se deshace: ' || p_motivo, v_ev, l.id);
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id, reversa_de)
      select m.socio_id, negocio.hoy(), 'reversa', m.aplica_a, -m.monto_cent, 'Se deshace: ' || p_motivo, v_ev, m.id
      from operacion.cuenta_socio_mov m where m.evento_id = l.evento_id and l.concepto = 'liquidacion_recibida' and m.concepto = 'entrega_a_sociedad'
        and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id);
    perform operacion.revertir_efectivo('libro', l.id, v_ev, 'Se deshace: ' || p_motivo);
    v_socio := l.socio_id;
  else
    raise exception 'tipo invalido' using errcode = '22023';
  end if;
  v_res := jsonb_build_object('deshecho', true, 'eco', operacion.eco_socio(v_socio), 'sobrepago_cent', operacion.sobrepago_socio(v_socio));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Retiro de capital explicito (acordado por los dos): lo propone uno, lo confirma el otro.
-- ---------------------------------------------------------------------------
create table operacion.retiro_capital (
  id bigint generated always as identity primary key,
  socio_id bigint not null references catalogo.socio (id),
  monto_cent bigint not null check (monto_cent > 0),
  nota text,
  propuesto_por bigint not null references catalogo.socio (id),
  evento_id bigint not null references operacion.evento (id)
);
create table operacion.retiro_capital_confirmacion (
  id bigint generated always as identity primary key,
  retiro_id bigint not null unique references operacion.retiro_capital (id),
  confirmado_por bigint not null references catalogo.socio (id),
  libro_id bigint not null references operacion.socio_libro (id),
  evento_id bigint not null references operacion.evento (id)
);
do $$
declare t text;
begin
  foreach t in array array['retiro_capital', 'retiro_capital_confirmacion'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

create function operacion.proponer_retiro_capital(p_clave_idem text, p_socio text, p_monto_cent bigint, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_yo bigint := operacion.actor_socio(); v_ev bigint; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'proponer_retiro_capital', 's', p_socio, 'm', p_monto_cent, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if v_yo is null then raise exception 'solo un socio propone' using errcode = '42501'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el retiro debe ser positivo' using errcode = '23514'; end if;
  if p_monto_cent > operacion.aportacion_pendiente(v_socio) then raise exception 'el retiro (% centavos) excede el capital aportado pendiente (% centavos)', p_monto_cent, operacion.aportacion_pendiente(v_socio) using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('retiro_capital_propuesto', negocio.hoy(), p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent));
  insert into operacion.retiro_capital (socio_id, monto_cent, nota, propuesto_por, evento_id) values (v_socio, p_monto_cent, p_nota, v_yo, v_ev) returning id into v_id;
  perform operacion.avisar('retiro_capital_por_confirmar', 'NT-048', 'retiro_capital:' || v_id, 'I', 'Retiro de capital de ' || p_socio || ' por confirmar', 'retiro_capital', v_id,
    jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent), null, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('retiro_id', v_id);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Lo confirma el OTRO socio (no quien lo propuso). Al confirmar sale el efectivo de la caja y baja el capital pendiente.
create function operacion.confirmar_retiro_capital(p_clave_idem text, p_retiro bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; r operacion.retiro_capital; v_yo bigint := operacion.actor_socio(); v_ev bigint; v_libro bigint; v_cuenta bigint := operacion.cuenta_efectivo_id('Caja de la empresa'); v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'confirmar_retiro_capital', 'r', p_retiro));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if v_yo is null then raise exception 'solo un socio confirma' using errcode = '42501'; end if;
  select * into r from operacion.retiro_capital where id = p_retiro for update;
  if not found then raise exception 'retiro desconocido' using errcode = '22023'; end if;
  if r.propuesto_por = v_yo then raise exception 'lo confirma el otro socio: el retiro de capital lo acuerdan los dos' using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.retiro_capital_confirmacion c where c.retiro_id = r.id) then raise exception 'ese retiro ya esta confirmado' using errcode = 'P0428'; end if;
  perform pg_advisory_xact_lock(81002, r.socio_id::int);
  if r.monto_cent > operacion.aportacion_pendiente(r.socio_id) then raise exception 'el capital pendiente ya no alcanza' using errcode = '23514'; end if;
  if r.monto_cent > operacion.saldo_efectivo(v_cuenta) then raise exception 'la caja de la empresa solo tiene % centavos', operacion.saldo_efectivo(v_cuenta) using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('retiro_capital_confirmado', negocio.hoy(), p_clave_idem, jsonb_build_object('retiro', r.id));
  insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
    values (r.socio_id, negocio.hoy(), 'pago_devolucion_aportacion', -r.monto_cent, 'transferencia', coalesce(r.nota, 'Retiro de capital acordado por los dos'), v_ev) returning id into v_libro;
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
    values (v_cuenta, negocio.hoy(), 'retiro_capital', -r.monto_cent, 'Retiro de capital', 'libro', v_libro, v_ev);
  insert into operacion.retiro_capital_confirmacion (retiro_id, confirmado_por, libro_id, evento_id) values (r.id, v_yo, v_libro, v_ev);
  perform operacion.resolver_avisos('retiro_capital_por_confirmar', 'retiro_capital', r.id);
  v_res := jsonb_build_object('retiro_id', r.id, 'libro_id', v_libro, 'eco', operacion.eco_socio(r.socio_id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Utilidad del periodo con ajustes tardios y anulaciones en el periodo en que ocurren (H7), y cuenta de socios sin gastos (H9).
-- ---------------------------------------------------------------------------
create or replace function operacion.utilidad_periodo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_ped bigint; v_prov boolean; v_n int; v_tomas bigint; v_gastos bigint; v_tardios bigint;
begin
  select coalesce(sum((n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint), 0)::bigint, coalesce(bool_or((n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean), false), count(*)::int
    into v_ped, v_prov, v_n
  from operacion.pedido pe join operacion.nota n on n.id = (select max(x.id) from operacion.nota x where x.pedido_id = pe.id)
  where pe.estado = 'enviado' and pe.fecha_envio between p_ini and p_fin;
  select coalesce(sum(t.piezas * t.precio_cent + m.valor_cent), 0)::bigint into v_tomas
    from operacion.toma_omar t join operacion.movimiento_inventario m on m.id = t.movimiento_id
   where t.estado = 'autorizada' and t.precio_cent is not null and t.fecha_neg between p_ini and p_fin;
  -- Un gasto cuenta en su fecha; si se anula, resta en la fecha de la anulacion (en el mismo periodo, el neto es cero).
  select coalesce(sum(g.monto_cent) filter (where g.fecha_neg between p_ini and p_fin), 0)::bigint
       - coalesce(sum(g.monto_cent) filter (where a.id is not null and coalesce(a.fecha_neg, g.fecha_neg) between p_ini and p_fin), 0)::bigint,
         coalesce(sum(g.monto_cent) filter (where g.fecha_origen is not null and g.fecha_neg between p_ini and p_fin and a.id is null), 0)::bigint
    into v_gastos, v_tardios
    from operacion.gasto g left join operacion.gasto_anulacion a on a.gasto_id = g.id
   where g.guia_id is null;
  return jsonb_build_object('utilidad_pedidos_cent', v_ped, 'pedidos', v_n, 'utilidad_tomas_cent', v_tomas, 'gastos_cent', v_gastos, 'ajustes_tardios_cent', v_tardios, 'provisional', v_prov,
                            'utilidad_cent', v_ped + v_tomas - v_gastos);
end $$;

create or replace function operacion.cuenta_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_costo bigint; v_mitad bigint; v_a bigint; v_j bigint; v_ida bigint; v_idj bigint; v_via1_a bigint; v_via2_dobles bigint; v_total bigint; v_fuera jsonb;
begin
  select id into v_ida from catalogo.socio where nombre = 'Angelo';
  select id into v_idj from catalogo.socio where nombre = 'Javier';
  select coalesce(sum(total_cent), 0)::bigint into v_costo from operacion.compra where ambito = 'sociedad' and estado not in ('borrador', 'anulada');
  v_a := operacion.aportado_compra_socio(v_ida) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0) - operacion.saldo_socio(v_ida);
  v_j := operacion.aportado_compra_socio(v_idj) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0) - operacion.saldo_socio(v_idj);
  v_mitad := (v_costo + 1) / 2;                     -- hacia arriba, a favor de quien aporta
  v_total := v_a + v_j;
  v_via1_a := v_a - v_mitad;                        -- via 1: lo puesto menos la mitad del costo
  v_via2_dobles := v_a - v_j;                       -- via 2: (A - J) / 2, comparada sin redondeo como 2 x via 1 = A - J
  select coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre, 'monto_cent', p.monto_cent, 'concepto', p.concepto, 'estado', p.estado, 'piezas', p.piezas) order by p.id), '[]'::jsonb) into v_fuera
    from operacion.partida_fuera_sociedad p join catalogo.socio s on s.id = p.socio_id;
  return jsonb_build_object(
    'costo_cent', v_costo, 'mitad_cent', v_mitad,
    'angelo', jsonb_build_object('aportado_cent', v_a, 'puso_capital_cent', operacion.aportado_socio(v_ida, 'capital'), 'puso_reembolsable_cent', operacion.aportado_socio(v_ida, 'reembolsable'),
                                 'fuera_sociedad_cent', coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0), 'debe_cent', operacion.saldo_socio(v_ida),
                                 'diferencia_cent', v_via1_a),
    'javier', jsonb_build_object('aportado_cent', v_j, 'puso_capital_cent', operacion.aportado_socio(v_idj, 'capital'), 'puso_reembolsable_cent', operacion.aportado_socio(v_idj, 'reembolsable'),
                                 'fuera_sociedad_cent', coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0), 'debe_cent', operacion.saldo_socio(v_idj),
                                 'diferencia_cent', v_j - v_mitad),
    -- Signo: > 0 Javier debe a Angelo; < 0 Angelo debe a Javier.
    'javier_debe_a_angelo_cent', v_via1_a,
    'via1_cent', v_via1_a, 'via2_cent', v_via2_dobles / 2, 'via2_resto_cent', v_via2_dobles % 2,
    'financiado_por_sociedad_cent', v_costo - v_total,
    'cuadra', (2 * v_via1_a = v_via2_dobles) or (v_costo % 2 = 1 and abs(2 * v_via1_a - v_via2_dobles) = 1),
    'partidas_fuera_sociedad', v_fuera);
end $$;

insert into catalogo.config (clave, valor, vigente_desde) values ('retiro_anticipo_max_cent', '0', '2026-11-11');

-- ---------------------------------------------------------------------------
-- Envoltorios api.* (rol socio) y permisos
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['registrar_aportacion', 'registrar_gasto_socio', 'proponer_retiro_capital', 'confirmar_retiro_capital',
                                                              'registrar_movimiento_efectivo', 'registrar_gasto_empresa'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;

create function api.efectivo_sociedad() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.efectivo_sociedad(); end $$;
grant execute on function api.efectivo_sociedad() to authenticated;

revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
