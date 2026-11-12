-- Dinero entre socios / 1: el efectivo deja de ser un numero tecleado.
-- Hallazgo H3 de la auditoria 01 y decision del dueno del 11-nov (orden de fondeo): hoy NO hay bancos ni cuenta comun; todo es efectivo en cajas.
-- Se modelan CUENTAS DE EFECTIVO (caja de la empresa y efectivo a cargo de cada socio), extensibles a bancos (tipo 'banco'), con un libro de solo insercion.
-- El efectivo de la sociedad = saldo de las cuentas de efectivo + dinero de la sociedad en poder de un socio (cobros en su cuenta personal, libro ya existente).
-- Lo comprometido (deuda con proveedores, dinero de clientes aun no aplicado a pedidos y reserva minima) se resta antes de repartir.

create table operacion.cuenta_efectivo (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  tipo text not null check (tipo in ('caja', 'banco')),
  titular text not null check (titular in ('empresa', 'socio')),
  socio_id bigint references catalogo.socio (id),
  activa boolean not null default true,
  check ((titular = 'socio') = (socio_id is not null))
);
insert into operacion.cuenta_efectivo (nombre, tipo, titular, socio_id)
  values ('Caja de la empresa', 'caja', 'empresa', null);
insert into operacion.cuenta_efectivo (nombre, tipo, titular, socio_id)
  select 'Efectivo de ' || s.nombre, 'caja', 'socio', s.id from catalogo.socio s order by s.nombre;

create table operacion.cuenta_efectivo_mov (
  id bigint generated always as identity primary key,
  cuenta_id bigint not null references operacion.cuenta_efectivo (id),
  fecha_neg date not null,
  concepto text not null check (concepto in ('saldo_inicial', 'deposito_socio', 'pago_reembolso', 'retiro_utilidad', 'retiro_capital', 'gasto_empresa', 'traspaso', 'ajuste_conteo', 'reversa')),
  monto_cent bigint not null check (monto_cent <> 0),
  nota text,
  ref_tipo text,
  ref_id bigint,
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint unique references operacion.cuenta_efectivo_mov (id),
  check ((concepto = 'reversa') = (reversa_de is not null))
);
create index cuenta_efectivo_mov_idx on operacion.cuenta_efectivo_mov (cuenta_id, id);

do $$
declare t text;
begin
  execute 'create trigger cuenta_efectivo_mov_t1 before update or delete on operacion.cuenta_efectivo_mov for each row execute function seguridad.t1_solo_insercion()';
  execute 'create trigger cuenta_efectivo_mov_t1t before truncate on operacion.cuenta_efectivo_mov for each statement execute function seguridad.t1_solo_insercion()';
  execute 'revoke delete, truncate on operacion.cuenta_efectivo_mov from postgres';
  foreach t in array array['cuenta_efectivo', 'cuenta_efectivo_mov'] loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

insert into catalogo.config (clave, valor, vigente_desde) values ('reserva_minima_cent', '0', '2026-11-11');

-- Candado compartido de las operaciones de dinero entre socios: las capturas toman el candado compartido; proponer y firmar un acta toman el exclusivo,
-- de modo que nada cambia entre el calculo y el asiento (H5 y H12).
create function operacion.bloquear_dinero(p_exclusivo boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_exclusivo then perform pg_advisory_xact_lock(81001); else perform pg_advisory_xact_lock_shared(81001); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas
-- ---------------------------------------------------------------------------
create function operacion.saldo_efectivo(p_cuenta bigint default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(m.monto_cent), 0)::bigint from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id
   where c.activa and (p_cuenta is null or c.id = p_cuenta)
$$;

create function operacion.caja_empresa() returns bigint
language sql stable security definer set search_path = ''
as $$ select operacion.saldo_efectivo((select id from operacion.cuenta_efectivo where titular = 'empresa' and tipo = 'caja' order by id limit 1)) $$;

-- Dinero de la sociedad que tiene cada socio por cobros recibidos en su cuenta personal (libro de deuda del socio, aplica_a 'fondos').
create function operacion.fondos_en_poder_total() returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(greatest(operacion.saldo_socio(s.id, 'fondos'), 0)), 0)::bigint from catalogo.socio s $$;

-- Lo que la sociedad debe a terceros o que no es suyo todavia: proveedores, dinero de clientes sin aplicar a pedidos (anticipos, saldo a favor, pagos sin
-- identificar) y la reserva minima fijada por los dos.
create function operacion.comprometido() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'proveedores_cent', (select coalesce(sum(greatest(-operacion.saldo_proveedor(p.id), 0)), 0)::bigint from catalogo.proveedor p),
    'anticipos_cent', (select coalesce(sum(greatest(p.monto_cent - coalesce((select sum(x.monto_cent) from operacion.pago_aplicacion x where x.pago_id = p.id), 0), 0)), 0)::bigint
                         from operacion.pago p where not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)),
    'reserva_cent', coalesce((catalogo.config_valor('reserva_minima_cent'))::text::bigint, 0))
$$;

create function operacion.comprometido_total() returns bigint
language sql stable security definer set search_path = ''
as $$ select (c->>'proveedores_cent')::bigint + (c->>'anticipos_cent')::bigint + (c->>'reserva_cent')::bigint from (select operacion.comprometido() as c) x $$;

-- Efectivo de la sociedad desglosado: cuentas de efectivo, fondos en poder de socios, comprometido y disponible para repartir.
create function operacion.efectivo_sociedad() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cuentas jsonb; v_cuentas_total bigint; v_poder bigint := operacion.fondos_en_poder_total(); v_comp jsonb := operacion.comprometido(); v_total bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'tipo', c.tipo, 'titular', c.titular, 'saldo_cent', operacion.saldo_efectivo(c.id)) order by c.id), '[]'::jsonb)
    into v_cuentas from operacion.cuenta_efectivo c where c.activa;
  v_cuentas_total := operacion.saldo_efectivo();
  v_total := v_cuentas_total + v_poder;
  return jsonb_build_object('cuentas', v_cuentas, 'cuentas_total_cent', v_cuentas_total, 'caja_empresa_cent', operacion.caja_empresa(), 'en_poder_cent', v_poder, 'total_cent', v_total,
    'comprometido', v_comp, 'comprometido_cent', (v_comp->>'proveedores_cent')::bigint + (v_comp->>'anticipos_cent')::bigint + (v_comp->>'reserva_cent')::bigint,
    'disponible_cent', greatest(v_total - ((v_comp->>'proveedores_cent')::bigint + (v_comp->>'anticipos_cent')::bigint + (v_comp->>'reserva_cent')::bigint), 0));
end $$;

-- Orden de fondeo (dueno, 11-nov): primero el efectivo de la caja de la empresa; solo si no alcanza, dinero de un socio (reembolso, o capital si lo declara).
create function operacion.sugerir_fondeo(p_monto_cent bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('monto_cent', p_monto_cent, 'desde_caja_cent', least(greatest(operacion.caja_empresa(), 0), p_monto_cent),
                            'desde_socio_cent', p_monto_cent - least(greatest(operacion.caja_empresa(), 0), p_monto_cent))
$$;

-- ---------------------------------------------------------------------------
-- Capturas de efectivo
-- ---------------------------------------------------------------------------
create function operacion.cuenta_efectivo_id(p_nombre text) returns bigint
language sql stable security definer set search_path = ''
as $$ select id from operacion.cuenta_efectivo where nombre = p_nombre and activa $$;

-- Movimiento interno o ajuste de una cuenta de efectivo: saldo inicial (+), ajuste por conteo (+ o -) y traspaso entre cuentas (caja a banco, etc.).
create function operacion.registrar_movimiento_efectivo(p_clave_idem text, p_cuenta text, p_concepto text, p_monto_cent bigint, p_nota text default null,
                                                        p_fecha date default null, p_cuenta_destino text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_c bigint; v_d bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_res jsonb; v_delta bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_movimiento_efectivo', 'c', p_cuenta, 'k', p_concepto, 'm', p_monto_cent, 'd', p_cuenta_destino, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_concepto not in ('saldo_inicial', 'ajuste_conteo', 'traspaso') then raise exception 'concepto de efectivo invalido' using errcode = '22023'; end if;
  if p_monto_cent is null or p_monto_cent = 0 then raise exception 'el monto no puede ser cero' using errcode = '23514'; end if;
  if p_concepto in ('saldo_inicial', 'traspaso') and p_monto_cent < 0 then raise exception 'el monto de % es positivo', p_concepto using errcode = '23514'; end if;
  if v_fecha > negocio.hoy() then raise exception 'la fecha no puede ser futura' using errcode = '22023'; end if;
  v_c := operacion.cuenta_efectivo_id(p_cuenta);
  if v_c is null then raise exception 'cuenta de efectivo desconocida' using errcode = '22023'; end if;
  if p_concepto = 'traspaso' then
    v_d := operacion.cuenta_efectivo_id(p_cuenta_destino);
    if v_d is null or v_d = v_c then raise exception 'indica una cuenta destino distinta' using errcode = '22023'; end if;
  end if;
  if p_concepto = 'traspaso' then v_delta := -p_monto_cent; else v_delta := p_monto_cent; end if;
  if p_concepto in ('ajuste_conteo', 'traspaso') and operacion.saldo_efectivo(v_c) + v_delta < 0 then
    raise exception 'la cuenta % no puede quedar en negativo', p_cuenta using errcode = '23514';
  end if;
  v_ev := operacion.crear_evento('movimiento_efectivo', v_fecha, p_clave_idem, jsonb_build_object('cuenta', p_cuenta, 'concepto', p_concepto, 'monto_cent', p_monto_cent), p_mensaje_origen);
  if p_concepto = 'traspaso' then
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id) values (v_c, v_fecha, 'traspaso', -p_monto_cent, coalesce(p_nota, 'Traspaso a ' || p_cuenta_destino), v_ev) returning id into v_id;
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id) values (v_d, v_fecha, 'traspaso', p_monto_cent, coalesce(p_nota, 'Traspaso desde ' || p_cuenta), v_ev);
  else
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id) values (v_c, v_fecha, p_concepto, p_monto_cent, p_nota, v_ev) returning id into v_id;
  end if;
  v_res := jsonb_build_object('movimiento_id', v_id, 'efectivo', operacion.efectivo_sociedad());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Gasto pagado con efectivo de la empresa: gasto normal de la sociedad, sin reembolso a nadie (adenda 32 A).
create function operacion.registrar_gasto_empresa(p_clave_idem text, p_monto_cent bigint, p_categoria text, p_naturaleza text default 'variable', p_fecha date default null,
                                                  p_cuenta text default 'Caja de la empresa', p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_c bigint; v_fecha date; v_origen date; v_ev bigint; v_id bigint; v_folio text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_gasto_empresa', 'm', p_monto_cent, 'c', p_categoria, 'n', p_naturaleza, 'f', p_fecha, 'u', p_cuenta, 'nt', p_nota));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el gasto debe ser positivo' using errcode = '23514'; end if;
  if nullif(btrim(p_categoria), '') is null then raise exception 'el gasto necesita categoria' using errcode = '23502'; end if;
  if p_naturaleza not in ('fijo', 'variable') then raise exception 'naturaleza invalida' using errcode = '22023'; end if;
  v_c := operacion.cuenta_efectivo_id(p_cuenta);
  if v_c is null then raise exception 'cuenta de efectivo desconocida' using errcode = '22023'; end if;
  if operacion.saldo_efectivo(v_c) < p_monto_cent then raise exception 'la cuenta % solo tiene % centavos: si un socio lo pago de su bolsillo, capturalo como gasto pagado por un socio', p_cuenta, operacion.saldo_efectivo(v_c) using errcode = '23514'; end if;
  v_fecha := operacion.fecha_efectiva(p_fecha); v_origen := operacion.fecha_tardia(p_fecha);
  v_ev := operacion.crear_evento('gasto_empresa', v_fecha, p_clave_idem, jsonb_build_object('monto_cent', p_monto_cent, 'categoria', p_categoria), p_mensaje_origen);
  v_folio := seguridad.siguiente_folio('G');
  insert into operacion.gasto (folio, fecha_neg, categoria, naturaleza, monto_cent, pagado_por_socio_id, evento_id, fecha_origen)
    values (v_folio, v_fecha, btrim(p_categoria), p_naturaleza, p_monto_cent, null, v_ev, v_origen) returning id into v_id;
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
    values (v_c, v_fecha, 'gasto_empresa', -p_monto_cent, 'Gasto ' || v_folio || ': ' || btrim(p_categoria) || coalesce(' (' || p_nota || ')', ''), 'gasto', v_id, v_ev);
  v_res := jsonb_build_object('gasto_id', v_id, 'folio', v_folio, 'efectivo', operacion.efectivo_sociedad());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Candado de periodo (H7): una captura con fecha dentro de un periodo ya firmado no cambia ese periodo. Se asienta con la fecha de hoy, conserva la fecha
-- de origen y aparece como ajuste tardio en el siguiente corte (acta del mes siguiente); nunca se pierde.
-- ---------------------------------------------------------------------------
alter table operacion.gasto add column fecha_origen date;
alter table operacion.gasto_anulacion add column fecha_neg date;

-- Fin del ultimo periodo cerrado con las dos firmas (acta vigente: no anulada ni corregida por contra-acta). Se redefine con las actas en la migracion 3.
create function operacion.ultimo_cierre_firmado_fin() returns date
language sql stable security definer set search_path = ''
as $$
  select max(c.periodo_fin) from operacion.cierre_reparto c
   where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)
     and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2
$$;

-- Fecha con la que se asienta una captura: la dada si cae despues del ultimo cierre; si cae dentro de un periodo firmado, la de hoy.
create function operacion.fecha_efectiva(p_fecha date) returns date
language plpgsql stable security definer set search_path = ''
as $$
declare v_cierre date := operacion.ultimo_cierre_firmado_fin();
begin
  if p_fecha is null then return negocio.hoy(); end if;
  if p_fecha > negocio.hoy() then raise exception 'la fecha % es futura', p_fecha using errcode = '22023'; end if;
  if v_cierre is not null and p_fecha <= v_cierre then return negocio.hoy(); end if;
  return p_fecha;
end $$;

-- Fecha original de una captura tardia (null si no es tardia).
create function operacion.fecha_tardia(p_fecha date) returns date
language sql stable security definer set search_path = ''
as $$ select case when p_fecha is not null and operacion.ultimo_cierre_firmado_fin() is not null and p_fecha <= operacion.ultimo_cierre_firmado_fin() then p_fecha end $$;
