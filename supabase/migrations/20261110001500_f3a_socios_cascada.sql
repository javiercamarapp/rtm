-- F3a / 0015: cuenta de socios, estado de cuenta por socio y cascada de reparto (adenda 21).
-- Principio del dueno: la empresa paga primero. Todo gasto que un socio paga de su bolsillo y todo capital que aporta se registra con su nombre y se
-- devuelve con las utilidades; solo lo que queda despues se reparte 50/50. Todo es de solo insercion y se corrige con contramovimientos.
--   * aportacion_socio ya existe (F2): ahora admite su contrario (reversa_de) para deshacer una captura.
--   * socio_libro: lo que la sociedad le debe (+) o le pago (-) a un socio ademas de sus aportaciones: utilidad asignada, pagos, retiros.
--   * Posicion neta de un socio con la sociedad = aportaciones + libro - lo que debe a la sociedad (fondos en su poder, faltantes asignados).
--     > 0 la sociedad le debe; < 0 el socio debe.
--   * Cascada: pura (`cascada_calcular`, sin lectura de tablas) + insumos desde los libros + cierre firmado por los dos (propuesta, dos firmas, asientos).
-- Redondeo: cualquier centavo suelto va a favor de quien paga o aporta (el socio con mayor reembolso + aportacion pendiente).

-- ---------------------------------------------------------------------------
-- Folios, restricciones y tablas
-- ---------------------------------------------------------------------------
alter table seguridad.contador_folio drop constraint contador_folio_serie_check;
alter table seguridad.contador_folio add constraint contador_folio_serie_check check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E', 'PO', 'CR'));
insert into seguridad.contador_folio (serie) values ('CR');

-- Las aportaciones se deshacen con un renglon contrario enlazado (misma clasificacion, monto negativo).
alter table operacion.aportacion_socio drop constraint aportacion_socio_monto_cent_check;
alter table operacion.aportacion_socio add column reversa_de bigint unique references operacion.aportacion_socio (id);
alter table operacion.aportacion_socio add constraint aportacion_socio_reversa_chk check (monto_cent <> 0 and (reversa_de is null) = (monto_cent > 0));

-- La compensacion de la cascada baja lo que el socio debe a la sociedad.
do $$
declare v_nombre text;
begin
  select c.conname into v_nombre from pg_constraint c join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'operacion' and t.relname = 'cuenta_socio_mov' and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%entrega_a_proveedor%';
  execute format('alter table operacion.cuenta_socio_mov drop constraint %I', v_nombre);
end $$;
alter table operacion.cuenta_socio_mov add constraint cuenta_socio_mov_concepto_check
  check (concepto in ('fondos_en_poder', 'diferencia_recepcion', 'entrega_a_sociedad', 'entrega_a_proveedor', 'traspaso_entre_socios', 'compensacion_reparto', 'reversa'));

-- Un gasto pagado por un socio se anula con su propia fila (el gasto original no cambia).
create table operacion.gasto_anulacion (
  id bigint generated always as identity primary key,
  gasto_id bigint not null unique references operacion.gasto (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  evento_id bigint not null references operacion.evento (id)
);

create table operacion.socio_libro (
  id bigint generated always as identity primary key,
  socio_id bigint not null references catalogo.socio (id),
  fecha_neg date not null,
  concepto text not null check (concepto in ('utilidad_asignada', 'pago_reembolso', 'pago_devolucion_aportacion', 'pago_utilidad', 'retiro', 'liquidacion_recibida', 'reversa')),
  monto_cent bigint not null check (monto_cent <> 0),
  via text check (via in ('transferencia', 'efectivo', 'compensacion', 'cascada', 'otro_socio')),
  nota text,
  cierre_id bigint,
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint unique references operacion.socio_libro (id),
  check ((concepto = 'reversa') = (reversa_de is not null))
);
create index socio_libro_socio_idx on operacion.socio_libro (socio_id, id);

create table operacion.cierre_reparto (
  id bigint generated always as identity primary key,
  folio text not null unique,
  periodo_ini date not null,
  periodo_fin date not null check (periodo_fin >= periodo_ini),
  utilidad_cent bigint not null,
  utilidad_provisional boolean not null default false,
  efectivo_caja_cent bigint not null default 0 check (efectivo_caja_cent >= 0),
  devolver_aportaciones_antes boolean not null,
  nota text,
  snapshot jsonb not null,
  propuesto_por bigint references catalogo.socio (id),
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);
alter table operacion.socio_libro add constraint socio_libro_cierre_fk foreign key (cierre_id) references operacion.cierre_reparto (id);

create table operacion.cierre_reparto_firma (
  id bigint generated always as identity primary key,
  cierre_id bigint not null references operacion.cierre_reparto (id),
  socio_id bigint not null references catalogo.socio (id),
  firmado_at timestamptz not null default now(),
  evento_id bigint not null references operacion.evento (id),
  unique (cierre_id, socio_id)
);
create table operacion.cierre_reparto_anulacion (
  id bigint generated always as identity primary key,
  cierre_id bigint not null unique references operacion.cierre_reparto (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  evento_id bigint not null references operacion.evento (id)
);

insert into catalogo.config (clave, valor, vigente_desde) values
  ('cascada_devolver_aportaciones_antes', 'true', '2026-11-10'),
  ('fondos_alerta_dias', '7', '2026-11-10');

do $$
declare t text;
begin
  foreach t in array array['gasto_anulacion', 'socio_libro', 'cierre_reparto', 'cierre_reparto_firma', 'cierre_reparto_anulacion'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lecturas de saldo (una cifra, una funcion)
-- ---------------------------------------------------------------------------
-- Aportado por un socio (capital o reembolsable), ya con sus reversas.
create function operacion.aportado_socio(p_socio bigint, p_clasificacion text default null) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.aportacion_socio where socio_id = p_socio and (p_clasificacion is null or clasificacion = p_clasificacion) $$;

-- Suma del libro por concepto efectivo: una reversa cuenta con el concepto de lo que deshace.
create function operacion.libro_socio(p_socio bigint, p_concepto text default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.monto_cent), 0)::bigint
  from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
  where l.socio_id = p_socio and (p_concepto is null or coalesce(o.concepto, l.concepto) = p_concepto)
$$;

-- Reembolsos de gastos pagados que la sociedad aun no le paga a un socio.
create function operacion.reembolso_pendiente(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select greatest(operacion.aportado_socio(p_socio, 'reembolsable') + operacion.libro_socio(p_socio, 'pago_reembolso'), 0)::bigint $$;

-- Capital aportado que la sociedad aun no devuelve.
create function operacion.aportacion_pendiente(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select greatest(operacion.aportado_socio(p_socio, 'capital') + operacion.libro_socio(p_socio, 'pago_devolucion_aportacion'), 0)::bigint $$;

-- Posicion neta del socio con la sociedad: > 0 la sociedad le debe; < 0 el socio debe.
create function operacion.neto_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select (operacion.aportado_socio(p_socio) + operacion.libro_socio(p_socio) - operacion.saldo_socio(p_socio))::bigint $$;

-- ---------------------------------------------------------------------------
-- Capturas por indicacion de un socio (web o agente): se ejecutan directo, con eco del saldo resultante y reversibles por contramovimiento.
-- ---------------------------------------------------------------------------
create function operacion.eco_socio(p_socio bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('socio', s.nombre, 'neto_cent', operacion.neto_socio(s.id), 'reembolso_pendiente_cent', operacion.reembolso_pendiente(s.id),
                            'aportacion_pendiente_cent', operacion.aportacion_pendiente(s.id), 'debe_cent', operacion.saldo_socio(s.id))
  from catalogo.socio s where s.id = p_socio
$$;

create function operacion.registrar_aportacion(p_clave_idem text, p_socio text, p_monto_cent bigint, p_concepto text, p_clasificacion text default 'capital',
                                               p_fecha date default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_aportacion', 's', p_socio, 'm', p_monto_cent, 'c', p_concepto, 'k', p_clasificacion, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'la aportacion debe ser positiva' using errcode = '23514'; end if;
  if nullif(btrim(p_concepto), '') is null then raise exception 'la aportacion necesita concepto' using errcode = '23502'; end if;
  if p_clasificacion not in ('capital', 'reembolsable') then raise exception 'clasificacion invalida' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('aportacion_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'clasificacion', p_clasificacion), p_mensaje_origen);
  insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, evento_id)
    values (v_socio, p_monto_cent, btrim(p_concepto), p_clasificacion, v_fecha, 'captura', v_ev) returning id into v_id;
  v_res := jsonb_build_object('aportacion_id', v_id, 'eco', operacion.eco_socio(v_socio));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Gasto pagado por un socio (envio, guia, Uber, servicio del sistema...): gasto de la sociedad + reembolso que la sociedad le debe.
create function operacion.registrar_gasto_socio(p_clave_idem text, p_socio text, p_monto_cent bigint, p_categoria text, p_naturaleza text default 'variable',
                                                p_fecha date default null, p_pedido bigint default null, p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_folio text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_gasto_socio', 's', p_socio, 'm', p_monto_cent, 'c', p_categoria, 'n', p_naturaleza, 'f', p_fecha, 'p', p_pedido, 'nt', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el gasto debe ser positivo' using errcode = '23514'; end if;
  if nullif(btrim(p_categoria), '') is null then raise exception 'el gasto necesita categoria' using errcode = '23502'; end if;
  if p_naturaleza not in ('fijo', 'variable') then raise exception 'naturaleza invalida' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('gasto_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'categoria', p_categoria), p_mensaje_origen);
  v_folio := seguridad.siguiente_folio('G');
  insert into operacion.gasto (folio, fecha_neg, categoria, naturaleza, monto_cent, pagado_por_socio_id, pedido_id, evento_id)
    values (v_folio, v_fecha, btrim(p_categoria), p_naturaleza, p_monto_cent, v_socio, p_pedido, v_ev) returning id into v_id;
  insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
    values (v_socio, p_monto_cent, 'Gasto ' || v_folio || ': ' || btrim(p_categoria) || coalesce(' (' || p_nota || ')', ''), 'reembolsable', v_fecha, 'gasto', v_id, v_ev);
  v_res := jsonb_build_object('gasto_id', v_id, 'folio', v_folio, 'eco', operacion.eco_socio(v_socio));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Pago de la sociedad a un socio: reembolso, devolucion de capital o retiro. Reduce lo que se le debe.
create function operacion.registrar_pago_a_socio(p_clave_idem text, p_socio text, p_monto_cent bigint, p_tipo text, p_via text default 'transferencia',
                                                 p_fecha date default null, p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_res jsonb; v_pend bigint; v_concepto text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago_a_socio', 's', p_socio, 'm', p_monto_cent, 't', p_tipo, 'v', p_via, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  if p_tipo not in ('reembolso', 'devolucion_aportacion', 'retiro') or p_via not in ('transferencia', 'efectivo') then raise exception 'tipo o via invalidos' using errcode = '22023'; end if;
  select id into v_socio from catalogo.socio where nombre = p_socio;
  if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  v_concepto := case p_tipo when 'reembolso' then 'pago_reembolso' when 'devolucion_aportacion' then 'pago_devolucion_aportacion' else 'retiro' end;
  v_pend := case p_tipo when 'reembolso' then operacion.reembolso_pendiente(v_socio) when 'devolucion_aportacion' then operacion.aportacion_pendiente(v_socio) else null end;
  if v_pend is not null and p_monto_cent > v_pend then raise exception 'el pago (% centavos) excede lo pendiente de ese concepto (% centavos)', p_monto_cent, v_pend using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('pago_a_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'tipo', p_tipo), p_mensaje_origen);
  insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
    values (v_socio, v_fecha, v_concepto, -p_monto_cent, p_via, coalesce(p_nota, case p_tipo when 'reembolso' then 'Reembolso de gastos' when 'devolucion_aportacion' then 'Devolucion de aportacion' else 'Retiro' end), v_ev) returning id into v_id;
  v_res := jsonb_build_object('libro_id', v_id, 'eco', operacion.eco_socio(v_socio));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Liquidacion entre socios: uno paga al otro con dinero de la sociedad que tenia en su poder. Baja lo que el primero debe y lo que la sociedad le debe al segundo.
create function operacion.registrar_liquidacion_entre_socios(p_clave_idem text, p_de text, p_a text, p_monto_cent bigint, p_nota text default null,
                                                             p_fecha date default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_de bigint; v_a bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_liquidacion_entre_socios', 'd', p_de, 'a', p_a, 'm', p_monto_cent, 'n', p_nota, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'la liquidacion debe ser positiva' using errcode = '23514'; end if;
  select id into v_de from catalogo.socio where nombre = p_de;
  select id into v_a from catalogo.socio where nombre = p_a;
  if v_de is null or v_a is null or v_de = v_a then raise exception 'indica dos socios distintos' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('liquidacion_entre_socios', v_fecha, p_clave_idem, jsonb_build_object('de', p_de, 'a', p_a, 'monto_cent', p_monto_cent), p_mensaje_origen);
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
    values (v_de, v_fecha, 'entrega_a_sociedad', 'general', -p_monto_cent, coalesce(p_nota, 'Liquidacion a ' || p_a), v_ev);
  insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
    values (v_a, v_fecha, 'liquidacion_recibida', -p_monto_cent, 'otro_socio', coalesce(p_nota, 'Liquidacion recibida de ' || p_de), v_ev);
  v_res := jsonb_build_object('eco_de', operacion.eco_socio(v_de), 'eco_a', operacion.eco_socio(v_a));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Deshacer una captura con su contramovimiento. p_tipo: 'aportacion' (incluye gastos pagados) o 'libro' (pagos, retiros y liquidaciones recibidas).
create function operacion.anular_movimiento_socio(p_clave_idem text, p_tipo text, p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; a operacion.aportacion_socio; l operacion.socio_libro; g operacion.gasto; v_res jsonb; v_socio bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_movimiento_socio', 't', p_tipo, 'i', p_id, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'deshacer exige motivo' using errcode = '23502'; end if;
  if p_tipo = 'aportacion' then
    select * into a from operacion.aportacion_socio where id = p_id for update;
    if not found then raise exception 'aportacion desconocida' using errcode = '22023'; end if;
    if a.reversa_de is not null or exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id) then raise exception 'esa aportacion ya esta deshecha' using errcode = 'P0428'; end if;
    if a.ref_tipo not in ('captura', 'gasto') then raise exception 'esa aportacion nace de otra operacion (%): se deshace desde ella', a.ref_tipo using errcode = 'P0428'; end if;
    v_ev := operacion.crear_evento('deshacer_aportacion', negocio.hoy(), p_clave_idem, jsonb_build_object('aportacion', a.id), null, null, null);
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id, reversa_de)
      values (a.socio_id, -a.monto_cent, 'Se deshace: ' || p_motivo, a.clasificacion, negocio.hoy(), a.ref_tipo, a.ref_id, v_ev, a.id);
    if a.ref_tipo = 'gasto' then
      select * into g from operacion.gasto where id = a.ref_id;
      insert into operacion.gasto_anulacion (gasto_id, motivo, evento_id) values (g.id, p_motivo, v_ev) on conflict (gasto_id) do nothing;
    end if;
    v_socio := a.socio_id;
  elsif p_tipo = 'libro' then
    select * into l from operacion.socio_libro where id = p_id for update;
    if not found then raise exception 'movimiento desconocido' using errcode = '22023'; end if;
    if l.concepto = 'reversa' or exists (select 1 from operacion.socio_libro r where r.reversa_de = l.id) then raise exception 'ese movimiento ya esta deshecho' using errcode = 'P0428'; end if;
    if l.cierre_id is not null then raise exception 'ese movimiento viene de un cierre de reparto firmado: no se deshace por separado' using errcode = 'P0428'; end if;
    v_ev := operacion.crear_evento('deshacer_movimiento_socio', negocio.hoy(), p_clave_idem, jsonb_build_object('libro', l.id), null, null, null);
    insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id, reversa_de)
      values (l.socio_id, negocio.hoy(), 'reversa', -l.monto_cent, l.via, 'Se deshace: ' || p_motivo, v_ev, l.id);
    -- La liquidacion entre socios tiene un renglon hermano en el libro de deuda (mismo evento): se deshace junto.
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id, reversa_de)
      select m.socio_id, negocio.hoy(), 'reversa', m.aplica_a, -m.monto_cent, 'Se deshace: ' || p_motivo, v_ev, m.id
      from operacion.cuenta_socio_mov m where m.evento_id = l.evento_id and l.concepto = 'liquidacion_recibida' and m.concepto = 'entrega_a_sociedad'
        and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id);
    v_socio := l.socio_id;
  else
    raise exception 'tipo invalido' using errcode = '22023';
  end if;
  v_res := jsonb_build_object('deshecho', true, 'eco', operacion.eco_socio(v_socio));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Cuenta de socios (S5): costo de la compra, mitad, lo que puso cada uno y la diferencia por dos vias
-- ---------------------------------------------------------------------------
create function operacion.cuenta_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_costo bigint; v_mitad bigint; v_a bigint; v_j bigint; v_ida bigint; v_idj bigint; v_via1_a bigint; v_via2_dobles bigint; v_total bigint; v_fuera jsonb;
begin
  select id into v_ida from catalogo.socio where nombre = 'Angelo';
  select id into v_idj from catalogo.socio where nombre = 'Javier';
  select coalesce(sum(total_cent), 0)::bigint into v_costo from operacion.compra where ambito = 'sociedad' and estado not in ('borrador', 'anulada');
  v_a := operacion.aportado_socio(v_ida) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0) - operacion.saldo_socio(v_ida);
  v_j := operacion.aportado_socio(v_idj) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0) - operacion.saldo_socio(v_idj);
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

-- ---------------------------------------------------------------------------
-- Cascada de reparto
-- ---------------------------------------------------------------------------
-- Reparte un total entero en proporcion a pesos (mapa socio -> peso). Todo el total queda repartido: el resto, centavo a centavo, a quien tenga mayor peso
-- (desempate por p_desempate y despues por nombre). Pura: no lee tablas.
create function operacion.repartir_proporcional(p_total bigint, p_pesos jsonb, p_desempate jsonb default '{}'::jsonb) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare k text; v_sum numeric := 0; v_out jsonb := '{}'::jsonb; v_asig bigint := 0; v_resto bigint; v_val bigint; v_orden text[];
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
  select array_agg(x order by (p_pesos->>x)::numeric desc, coalesce((p_desempate->>x)::numeric, 0) desc, x) into v_orden from jsonb_object_keys(p_pesos) x;
  while v_resto > 0 loop
    foreach k in array v_orden loop
      exit when v_resto = 0;
      v_out := v_out || jsonb_build_object(k, (v_out->>k)::bigint + 1);
      v_resto := v_resto - 1;
    end loop;
  end loop;
  return v_out;
end $$;

-- Los cinco pasos de la adenda 21. Entradas (mapas por nombre de socio, centavos):
--   p_reembolsos / p_aportaciones: lo que la sociedad le debe a cada uno por gastos pagados y por capital;
--   p_poder: efectivo de la sociedad que cada uno tiene en su poder; p_deuda: todo lo que cada uno debe a la sociedad (fondos + faltantes);
--   p_ppm: participacion en la utilidad (partes por millon); p_caja: efectivo en la cuenta de la sociedad.
create function operacion.cascada_calcular(p_utilidad_cent bigint, p_caja_cent bigint, p_reembolsos jsonb, p_aportaciones jsonb, p_poder jsonb, p_deuda jsonb, p_ppm jsonb,
                                           p_aportaciones_antes boolean default true) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  k text; v_socios text[]; v_efectivo bigint := 0; v_poder_total bigint := 0; v_tot_r bigint := 0; v_tot_c bigint := 0; v_pagado_r bigint; v_pagado_c bigint; v_resto bigint;
  v_repartible bigint; v_pay_r jsonb; v_pay_c jsonb; v_share jsonb; v_pesos jsonb := '{}'::jsonb; v_desempate jsonb := '{}'::jsonb; v_por jsonb := '{}'::jsonb;
  v_res bigint; v_asignado bigint := 0; v_suma_res bigint := 0; v_neg text; v_pos text; v_neg_m bigint := 0; v_pos_m bigint := 0; v_liquidar jsonb := 'null'::jsonb; v_remanente bigint;
  v_limitado boolean;
begin
  if p_caja_cent < 0 then raise exception 'el efectivo de la caja no puede ser negativo' using errcode = '23514'; end if;
  select array_agg(x order by x) into v_socios from jsonb_object_keys(p_ppm) x;
  foreach k in array v_socios loop
    v_poder_total := v_poder_total + greatest(coalesce((p_poder->>k)::bigint, 0), 0);
    v_tot_r := v_tot_r + greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0);
    v_tot_c := v_tot_c + greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0);
    v_pesos := v_pesos || jsonb_build_object(k, (p_ppm->>k)::bigint);
    v_desempate := v_desempate || jsonb_build_object(k, greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0) + greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0));
  end loop;
  v_efectivo := v_poder_total + p_caja_cent;
  -- Paso 3a: reembolsos de gastos pagados por socios.
  v_pagado_r := least(v_efectivo, v_tot_r);
  v_pay_r := operacion.repartir_proporcional(v_pagado_r, (select jsonb_object_agg(x, greatest(coalesce((p_reembolsos->>x)::bigint, 0), 0)) from unnest(v_socios) x));
  if p_aportaciones_antes then
    -- Paso 3b: devolucion de aportaciones; paso 3c: utilidad repartible = lo menor entre la utilidad y el efectivo que queda.
    v_pagado_c := least(v_efectivo - v_pagado_r, v_tot_c);
    v_pay_c := operacion.repartir_proporcional(v_pagado_c, (select jsonb_object_agg(x, greatest(coalesce((p_aportaciones->>x)::bigint, 0), 0)) from unnest(v_socios) x));
    v_repartible := greatest(0, least(p_utilidad_cent, v_efectivo - v_pagado_r - v_pagado_c));
  else
    v_repartible := greatest(0, least(p_utilidad_cent, v_efectivo - v_pagado_r));
    v_pagado_c := least(v_efectivo - v_pagado_r - v_repartible, v_tot_c);
    v_pay_c := operacion.repartir_proporcional(v_pagado_c, (select jsonb_object_agg(x, greatest(coalesce((p_aportaciones->>x)::bigint, 0), 0)) from unnest(v_socios) x));
  end if;
  v_share := operacion.repartir_proporcional(v_repartible, v_pesos, v_desempate);
  v_remanente := v_efectivo - v_pagado_r - v_pagado_c - v_repartible;
  v_limitado := v_pagado_r < v_tot_r or v_pagado_c < v_tot_c or v_repartible < greatest(p_utilidad_cent, 0);

  -- Paso 4: resultado por socio = lo que se le devuelve + su parte de la utilidad - lo que ya tiene en su poder o debe a la sociedad.
  foreach k in array v_socios loop
    v_res := (v_pay_r->>k)::bigint + (v_pay_c->>k)::bigint + (v_share->>k)::bigint - coalesce((p_deuda->>k)::bigint, 0);
    v_asignado := v_asignado + (v_pay_r->>k)::bigint + (v_pay_c->>k)::bigint + (v_share->>k)::bigint;
    v_suma_res := v_suma_res + v_res;
    v_por := v_por || jsonb_build_object(k, jsonb_build_object(
      'reembolso_pendiente_cent', greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0), 'aportacion_pendiente_cent', greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0),
      'paga_reembolso_cent', (v_pay_r->>k)::bigint, 'paga_aportacion_cent', (v_pay_c->>k)::bigint, 'utilidad_cent', (v_share->>k)::bigint,
      'asignado_cent', (v_pay_r->>k)::bigint + (v_pay_c->>k)::bigint + (v_share->>k)::bigint,
      'tiene_en_poder_cent', greatest(coalesce((p_poder->>k)::bigint, 0), 0), 'debe_cent', coalesce((p_deuda->>k)::bigint, 0), 'resultado_cent', v_res,
      'sigue_pendiente_cent', greatest(coalesce((p_reembolsos->>k)::bigint, 0), 0) - (v_pay_r->>k)::bigint + greatest(coalesce((p_aportaciones->>k)::bigint, 0), 0) - (v_pay_c->>k)::bigint));
    if v_res < v_neg_m then v_neg := k; v_neg_m := v_res; end if;
    if v_res > v_pos_m then v_pos := k; v_pos_m := v_res; end if;
  end loop;
  -- Paso 5: saldo entre socios. Quien queda en negativo entrega a quien queda en positivo (lo que no cubra el otro lo cubre la caja de la sociedad).
  if v_neg is not null and v_pos is not null then
    v_liquidar := jsonb_build_object('de', v_neg, 'a', v_pos, 'monto_cent', least(-v_neg_m, v_pos_m));
  end if;
  return jsonb_build_object(
    'utilidad_cent', p_utilidad_cent, 'perdida_cent', greatest(-p_utilidad_cent, 0),
    'efectivo', jsonb_build_object('en_poder_cent', v_poder_total, 'caja_cent', p_caja_cent, 'total_cent', v_efectivo),
    'reembolsos', jsonb_build_object('pendiente_cent', v_tot_r, 'pagado_cent', v_pagado_r),
    'aportaciones', jsonb_build_object('pendiente_cent', v_tot_c, 'pagado_cent', v_pagado_c),
    'repartible_cent', v_repartible, 'remanente_cent', v_remanente, 'limitado_por_efectivo', v_limitado, 'devolver_aportaciones_antes', p_aportaciones_antes,
    'por_socio', v_por, 'suma_asignada_cent', v_asignado, 'suma_resultados_cent', v_suma_res,
    'identidad_cuadra', v_asignado = v_efectivo - v_remanente and v_asignado = v_pagado_r + v_pagado_c + v_repartible,
    'liquidar', v_liquidar);
end $$;

-- Utilidad neta de un periodo: utilidad de los pedidos enviados (venta - costo - renta - guia, ya con sus correcciones) + tomas de Omar a su precio - gastos
-- generales de la sociedad. Aproximacion operativa: el estado de resultados contable llega con los asientos.
create function operacion.utilidad_periodo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_ped bigint; v_prov boolean; v_n int; v_tomas bigint; v_gastos bigint;
begin
  select coalesce(sum((n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint), 0)::bigint, coalesce(bool_or((n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean), false), count(*)::int
    into v_ped, v_prov, v_n
  from operacion.pedido pe join operacion.nota n on n.id = (select max(x.id) from operacion.nota x where x.pedido_id = pe.id)
  where pe.estado = 'enviado' and pe.fecha_envio between p_ini and p_fin;
  select coalesce(sum(t.piezas * t.precio_cent + m.valor_cent), 0)::bigint into v_tomas
    from operacion.toma_omar t join operacion.movimiento_inventario m on m.id = t.movimiento_id
   where t.estado = 'autorizada' and t.precio_cent is not null and t.fecha_neg between p_ini and p_fin;
  select coalesce(sum(g.monto_cent), 0)::bigint into v_gastos
    from operacion.gasto g where g.fecha_neg between p_ini and p_fin and g.guia_id is null
     and not exists (select 1 from operacion.gasto_anulacion a where a.gasto_id = g.id);
  return jsonb_build_object('utilidad_pedidos_cent', v_ped, 'pedidos', v_n, 'utilidad_tomas_cent', v_tomas, 'gastos_cent', v_gastos, 'provisional', v_prov,
                            'utilidad_cent', v_ped + v_tomas - v_gastos);
end $$;

-- Insumos de la cascada desde los libros (una funcion por cifra).
create function operacion.cascada_periodo(p_ini date, p_fin date, p_caja_cent bigint default 0, p_aportaciones_antes boolean default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_u jsonb; v_antes boolean; r jsonb := '{}'::jsonb; c jsonb := '{}'::jsonb; p jsonb := '{}'::jsonb; d jsonb := '{}'::jsonb; ppm jsonb := '{}'::jsonb; s record; v_calc jsonb;
begin
  if p_ini is null or p_fin is null or p_fin < p_ini then raise exception 'periodo invalido' using errcode = '22023'; end if;
  v_u := operacion.utilidad_periodo(p_ini, p_fin);
  v_antes := coalesce(p_aportaciones_antes, (catalogo.config_valor('cascada_devolver_aportaciones_antes'))::text::boolean, true);
  for s in select id, nombre, participacion_ppm from catalogo.socio order by nombre loop
    r := r || jsonb_build_object(s.nombre, operacion.reembolso_pendiente(s.id));
    c := c || jsonb_build_object(s.nombre, operacion.aportacion_pendiente(s.id));
    p := p || jsonb_build_object(s.nombre, greatest(operacion.saldo_socio(s.id, 'fondos'), 0));
    d := d || jsonb_build_object(s.nombre, operacion.saldo_socio(s.id));
    ppm := ppm || jsonb_build_object(s.nombre, s.participacion_ppm);
  end loop;
  v_calc := operacion.cascada_calcular((v_u->>'utilidad_cent')::bigint, p_caja_cent, r, c, p, d, ppm, v_antes);
  return v_calc || jsonb_build_object('periodo_ini', p_ini, 'periodo_fin', p_fin, 'utilidad_detalle', v_u, 'utilidad_provisional', (v_u->>'provisional')::boolean);
end $$;

-- Compensa (baja) lo que un socio debe a la sociedad: primero fondos, luego faltantes asignados, luego lo general.
create function operacion.compensar_socio(p_socio bigint, p_monto_cent bigint, p_evento bigint, p_nota text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_resta bigint := p_monto_cent; v_k text; v_disp bigint; v_baja bigint; v_total bigint := 0;
begin
  foreach v_k in array array['fondos', 'diferencia', 'general'] loop
    exit when v_resta <= 0;
    v_disp := operacion.saldo_socio(p_socio, v_k);
    v_baja := least(v_resta, greatest(v_disp, 0));
    if v_baja > 0 then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
        values (p_socio, negocio.hoy(), 'compensacion_reparto', v_k, -v_baja, p_nota, p_evento);
      v_resta := v_resta - v_baja; v_total := v_total + v_baja;
    end if;
  end loop;
  return v_total;
end $$;

-- Propone el cierre de un periodo ya terminado: congela la cascada. Necesita la firma de los dos para surtir efecto.
create function operacion.proponer_cierre_reparto(p_clave_idem text, p_ini date, p_fin date, p_caja_cent bigint default 0, p_devolver_antes boolean default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_c jsonb; v_ev bigint; v_id bigint; v_folio text; v_antes boolean; v_yo bigint := operacion.actor_socio(); v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'proponer_cierre_reparto', 'i', p_ini, 'f', p_fin, 'c', p_caja_cent, 'a', p_devolver_antes, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_fin >= negocio.hoy() then raise exception 'el periodo del % al % aun no termina: se cierra a partir del %', p_ini, p_fin, p_fin + 1 using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.cierre_reparto c where c.periodo_ini <= p_fin and c.periodo_fin >= p_ini and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)) then
    raise exception 'ya existe un cierre de reparto que se traslapa con ese periodo' using errcode = 'P0428';
  end if;
  v_c := operacion.cascada_periodo(p_ini, p_fin, p_caja_cent, p_devolver_antes);
  v_antes := (v_c->>'devolver_aportaciones_antes')::boolean;
  v_ev := operacion.crear_evento('cierre_reparto_propuesto', negocio.hoy(), p_clave_idem, jsonb_build_object('ini', p_ini, 'fin', p_fin));
  v_folio := seguridad.siguiente_folio('CR');
  insert into operacion.cierre_reparto (folio, periodo_ini, periodo_fin, utilidad_cent, utilidad_provisional, efectivo_caja_cent, devolver_aportaciones_antes, nota, snapshot, propuesto_por, evento_id)
    values (v_folio, p_ini, p_fin, (v_c->>'utilidad_cent')::bigint, (v_c->>'utilidad_provisional')::boolean, p_caja_cent, v_antes, p_nota, v_c, v_yo, v_ev) returning id into v_id;
  perform operacion.avisar('cascada_lista_firma', 'NT-045', 'cascada_firma:' || v_id, 'I', 'Cascada del periodo ' || p_ini || ' al ' || p_fin || ' lista para firma (' || v_folio || ')', 'cierre_reparto', v_id,
    jsonb_build_object('folio', v_folio), null, v_ev, true, array['software', 'telegram']);
  if (v_c->>'limitado_por_efectivo')::boolean then
    perform operacion.avisar('utilidad_mayor_que_efectivo', 'NT-046', 'utilidad_vs_efectivo:' || v_id, 'I', 'La utilidad del periodo es mayor que el efectivo: el reparto queda limitado (' || v_folio || ')', 'cierre_reparto', v_id,
      jsonb_build_object('folio', v_folio), null, v_ev, false, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('cierre_id', v_id, 'folio', v_folio, 'cascada', v_c);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Firma del socio que actua. Con las dos firmas el cierre surte efecto: queda la utilidad asignada, los reembolsos y devoluciones pagados por la cascada,
-- y se compensa contra lo que cada uno tenia en su poder. Un cierre no se edita: se anula (antes de las dos firmas) o se corrige en el siguiente.
create function operacion.firmar_cierre_reparto(p_clave_idem text, p_cierre bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.cierre_reparto; v_yo bigint := operacion.actor_socio(); v_ev bigint; v_firmas int; s record; v_x jsonb; v_pay_r bigint; v_pay_c bigint; v_comp bigint; v_res jsonb; v_cerrado boolean := false;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'firmar_cierre_reparto', 'c', p_cierre));
  if v_prev is not null then return v_prev; end if;
  if v_yo is null then raise exception 'solo un socio firma' using errcode = '42501'; end if;
  select * into c from operacion.cierre_reparto where id = p_cierre for update;
  if not found then raise exception 'cierre desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then raise exception 'el cierre % esta anulado', c.folio using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id and f.socio_id = v_yo) then raise exception 'ya firmaste el cierre %', c.folio using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('cierre_reparto_firmado', negocio.hoy(), p_clave_idem, jsonb_build_object('cierre', c.folio));
  insert into operacion.cierre_reparto_firma (cierre_id, socio_id, evento_id) values (c.id, v_yo, v_ev);
  select count(*)::int into v_firmas from operacion.cierre_reparto_firma where cierre_id = c.id;
  if v_firmas >= 2 then
    v_cerrado := true;
    for s in select id, nombre from catalogo.socio order by nombre loop
      v_x := c.snapshot->'por_socio'->s.nombre;
      v_pay_r := (v_x->>'paga_reembolso_cent')::bigint; v_pay_c := (v_x->>'paga_aportacion_cent')::bigint;
      if v_pay_r > 0 then
        insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id)
          values (s.id, negocio.hoy(), 'pago_reembolso', -v_pay_r, 'cascada', 'Reembolso pagado en la cascada ' || c.folio, c.id, v_ev);
      end if;
      if v_pay_c > 0 then
        insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id)
          values (s.id, negocio.hoy(), 'pago_devolucion_aportacion', -v_pay_c, 'cascada', 'Aportacion devuelta en la cascada ' || c.folio, c.id, v_ev);
      end if;
      if (v_x->>'utilidad_cent')::bigint > 0 then
        insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, cierre_id, evento_id)
          values (s.id, negocio.hoy(), 'utilidad_asignada', (v_x->>'utilidad_cent')::bigint, 'cascada', 'Utilidad repartible del periodo ' || c.periodo_ini || ' al ' || c.periodo_fin || ' (' || c.folio || ')', c.id, v_ev);
      end if;
      -- Lo que se le devuelve se compensa contra lo que tenia en su poder o debia a la sociedad; lo que sobre se le paga de la caja.
      v_comp := operacion.compensar_socio(s.id, least(v_pay_r + v_pay_c, greatest(operacion.saldo_socio(s.id), 0)), v_ev, 'Compensacion de la cascada ' || c.folio);
    end loop;
    perform operacion.resolver_avisos('cascada_lista_firma', 'cierre_reparto', c.id);
    perform operacion.avisar('periodo_cascada_cerrado', 'NT-047', 'cierre_firmado:' || c.id, 'I', 'Cierre de reparto ' || c.folio || ' firmado por los dos socios', 'cierre_reparto', c.id,
      jsonb_build_object('folio', c.folio), null, v_ev, true, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('cierre_id', c.id, 'folio', c.folio, 'firmas', v_firmas, 'cerrado', v_cerrado);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.anular_cierre_reparto(p_clave_idem text, p_cierre bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.cierre_reparto; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_cierre_reparto', 'c', p_cierre, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into c from operacion.cierre_reparto where id = p_cierre for update;
  if not found then raise exception 'cierre desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then raise exception 'el cierre % ya esta anulado', c.folio using errcode = 'P0428'; end if;
  if (select count(*) from operacion.cierre_reparto_firma where cierre_id = c.id) >= 2 then raise exception 'el cierre % ya esta firmado por los dos: se corrige en el siguiente periodo', c.folio using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('cierre_reparto_anulado', negocio.hoy(), p_clave_idem, jsonb_build_object('cierre', c.folio));
  insert into operacion.cierre_reparto_anulacion (cierre_id, motivo, evento_id) values (c.id, p_motivo, v_ev);
  perform operacion.resolver_avisos('cascada_lista_firma', 'cierre_reparto', c.id);
  perform operacion.resolver_avisos('utilidad_mayor_que_efectivo', 'cierre_reparto', c.id);
  v_res := jsonb_build_object('cierre_id', c.id, 'anulado', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas para la web (rol socio)
-- ---------------------------------------------------------------------------
-- Dias que lleva el dinero de la sociedad en poder de un socio: antiguedad del tramo mas viejo que aun no ha entregado (los ultimos ingresos hasta cubrir su saldo).
create function operacion.dias_fondos_en_poder(p_socio bigint) returns int
language sql stable security definer set search_path = ''
as $$
  with s as (select greatest(operacion.saldo_socio(p_socio, 'fondos'), 0) as f),
  ingresos as (
    select m.fecha_neg, m.monto_cent, sum(m.monto_cent) over (order by m.id desc) as acum
    from operacion.cuenta_socio_mov m where m.socio_id = p_socio and m.aplica_a = 'fondos' and m.monto_cent > 0
  )
  select case when (select f from s) = 0 then null else (negocio.hoy() - (select min(i.fecha_neg) from ingresos i where i.acum - i.monto_cent < (select f from s)))::int end
$$;

create function api.socios_cuenta() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cs jsonb; v_hoy date := negocio.hoy();
begin
  perform seguridad.exigir_rol(array['socio']);
  v_cs := operacion.cuenta_socios();
  return v_cs || jsonb_build_object(
    'hoy', v_hoy,
    'socios', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'neto_cent', operacion.neto_socio(s.id), 'aportado_cent', operacion.aportado_socio(s.id),
        'capital_pendiente_cent', operacion.aportacion_pendiente(s.id), 'reembolso_pendiente_cent', operacion.reembolso_pendiente(s.id), 'fondos_cent', operacion.saldo_socio(s.id, 'fondos'),
        'debe_cent', operacion.saldo_socio(s.id), 'dias_fondos', operacion.dias_fondos_en_poder(s.id),
        'alerta_fondos', coalesce(operacion.dias_fondos_en_poder(s.id) > (catalogo.config_valor('fondos_alerta_dias'))::text::int, false)) order by s.nombre) from catalogo.socio s), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(q.x order by (q.x->>'orden')::bigint desc) from (select u.x from (
        select jsonb_build_object('orden', e.id * 10 + 1, 'tipo', 'aportacion', 'id', a.id, 'socio', s.nombre, 'fecha_neg', a.fecha_neg, 'concepto', a.concepto, 'monto_cent', a.monto_cent,
                                  'clasificacion', a.clasificacion, 'deshecho', exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id) or a.reversa_de is not null,
                                  'deshacible', a.ref_tipo in ('captura', 'gasto') and a.reversa_de is null and not exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id)) || operacion.evento_info(a.evento_id) as x
          from operacion.aportacion_socio a join catalogo.socio s on s.id = a.socio_id join operacion.evento e on e.id = a.evento_id
        union all
        select jsonb_build_object('orden', e.id * 10 + 2, 'tipo', 'libro', 'id', l.id, 'socio', s.nombre, 'fecha_neg', l.fecha_neg, 'concepto', coalesce(l.nota, l.concepto), 'monto_cent', l.monto_cent,
                                  'clasificacion', l.concepto, 'deshecho', exists (select 1 from operacion.socio_libro r where r.reversa_de = l.id) or l.reversa_de is not null,
                                  'deshacible', l.cierre_id is null and l.concepto <> 'reversa' and not exists (select 1 from operacion.socio_libro r where r.reversa_de = l.id)) || operacion.evento_info(l.evento_id)
          from operacion.socio_libro l join catalogo.socio s on s.id = l.socio_id join operacion.evento e on e.id = l.evento_id
        ) u order by (u.x->>'orden')::bigint desc limit 60) q), '[]'::jsonb));
end $$;

create function api.socio_cuenta(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_id bigint; v_movs jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select id into v_id from catalogo.socio where nombre = p_socio;
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  -- Cada renglon trae su efecto sobre la posicion neta y el saldo corrido.
  select coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'efecto_cent', m.efecto, 'saldo_cent', m.corrido,
                                               'hora', m.hora, 'deshacible', m.deshacible) || operacion.evento_info(m.evento_id) order by m.orden desc, m.id desc), '[]'::jsonb) into v_movs
  from (
    select x.*, sum(x.efecto) over (order by x.orden, x.id) as corrido from (
      select e.id * 10 + 1 as orden, 'aportacion'::text as tipo, a.id, a.fecha_neg, a.concepto, a.monto_cent as efecto, e.hora, a.evento_id,
             (a.ref_tipo in ('captura', 'gasto') and a.reversa_de is null and not exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id)) as deshacible
        from operacion.aportacion_socio a join operacion.evento e on e.id = a.evento_id where a.socio_id = v_id
      union all
      select e.id * 10 + 2, 'libro', l.id, l.fecha_neg, coalesce(l.nota, l.concepto), l.monto_cent, e.hora, l.evento_id,
             (l.cierre_id is null and l.concepto <> 'reversa' and not exists (select 1 from operacion.socio_libro r where r.reversa_de = l.id))
        from operacion.socio_libro l join operacion.evento e on e.id = l.evento_id where l.socio_id = v_id
      union all
      select e.id * 10 + 3, 'deuda', c.id, c.fecha_neg, replace(c.concepto, '_', ' ') || coalesce(': ' || c.nota, ''), -c.monto_cent, e.hora, c.evento_id, false
        from operacion.cuenta_socio_mov c join operacion.evento e on e.id = c.evento_id where c.socio_id = v_id
    ) x
  ) m;
  return jsonb_build_object('socio', p_socio, 'neto_cent', operacion.neto_socio(v_id),
    'aportaciones_capital_cent', operacion.aportado_socio(v_id, 'capital'), 'gastos_pagados_cent', operacion.aportado_socio(v_id, 'reembolsable'),
    'reembolsos_recibidos_cent', -operacion.libro_socio(v_id, 'pago_reembolso'), 'devoluciones_recibidas_cent', -operacion.libro_socio(v_id, 'pago_devolucion_aportacion'),
    'retiros_cent', -(operacion.libro_socio(v_id, 'retiro') + operacion.libro_socio(v_id, 'pago_utilidad') + operacion.libro_socio(v_id, 'liquidacion_recibida')),
    'utilidad_asignada_cent', operacion.libro_socio(v_id, 'utilidad_asignada'),
    'fondos_cent', operacion.saldo_socio(v_id, 'fondos'), 'faltantes_cent', operacion.saldo_socio(v_id, 'diferencia'), 'debe_cent', operacion.saldo_socio(v_id),
    'reembolso_pendiente_cent', operacion.reembolso_pendiente(v_id), 'aportacion_pendiente_cent', operacion.aportacion_pendiente(v_id),
    'dias_fondos', operacion.dias_fondos_en_poder(v_id), 'movimientos', v_movs);
end $$;

create function api.cascada_proyeccion(p_ini date default null, p_fin date default null, p_caja_cent bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy(); v_ini date := coalesce(p_ini, operacion.semana_omar_ini(negocio.hoy())); v_fin date := coalesce(p_fin, negocio.hoy());
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.cascada_periodo(v_ini, v_fin, coalesce(p_caja_cent, 0)) || jsonb_build_object('hoy', v_hoy, 'en_vivo', v_fin >= v_hoy);
end $$;

create function api.cierres_reparto() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'folio', c.folio, 'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent, 'utilidad_provisional', c.utilidad_provisional,
      'efectivo_caja_cent', c.efectivo_caja_cent, 'nota', c.nota, 'snapshot', c.snapshot, 'creado_at', c.creado_at, 'propuesto_por', (select nombre from catalogo.socio where id = c.propuesto_por),
      'firmas', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'firmado_at', f.firmado_at) order by f.id) from operacion.cierre_reparto_firma f join catalogo.socio s on s.id = f.socio_id where f.cierre_id = c.id), '[]'::jsonb),
      'estado', case when exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then 'anulado'
                     when (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2 then 'cerrado'
                     when exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id) then 'firmado_por_uno' else 'propuesto' end,
      'yo_firme', exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id and f.socio_id = operacion.actor_socio())) order by c.id desc)
    from operacion.cierre_reparto c), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* de escritura (rol socio) y permisos
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['registrar_aportacion', 'registrar_gasto_socio', 'registrar_pago_a_socio', 'registrar_liquidacion_entre_socios', 'anular_movimiento_socio',
                                                              'proponer_cierre_reparto', 'firmar_cierre_reparto', 'anular_cierre_reparto'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;

grant execute on function api.socios_cuenta(), api.socio_cuenta(text), api.cascada_proyeccion(date, date, bigint), api.cierres_reparto() to authenticated;
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
