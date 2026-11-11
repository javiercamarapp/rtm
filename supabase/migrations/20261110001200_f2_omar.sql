-- F2 / 0012: Omar Yacaman (una entidad, dos papeles) a nivel de funciones: renta de bodega devengada al marcar enviado, tomas a credito a su
-- tabulador con autorizacion de un socio, liquidacion semanal con corte el lunes y pagos. SIN interfaz para Omar todavia (desactivado hasta M2).
-- El inventario es de Angelo y Javier; Omar presta el lugar. Omar NO despacha. No existen "reposiciones 2 a 1".
-- Signo del neto: > 0 los socios deben a Omar (renta mayor que sus tomas); < 0 Omar debe (tomas mayores que la renta).

alter table seguridad.contador_folio drop constraint contador_folio_serie_check;
alter table seguridad.contador_folio add constraint contador_folio_serie_check check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E', 'PO'));
insert into seguridad.contador_folio (serie) values ('PO');

create table operacion.renta_devengo (
  id bigint generated always as identity primary key,
  pedido_linea_id bigint not null references operacion.pedido_linea (id),
  persona_bodega_id bigint not null references catalogo.persona_bodega (id),
  piezas int not null check (piezas <> 0),
  monto_cent bigint not null check (monto_cent <> 0),
  devengada_fecha date not null,
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint unique references operacion.renta_devengo (id),
  check ((reversa_de is null) = (monto_cent > 0))
);
create unique index renta_devengo_una_por_linea on operacion.renta_devengo (pedido_linea_id) where reversa_de is null;
create index renta_devengo_fecha_idx on operacion.renta_devengo (devengada_fecha);

create table operacion.toma_omar (
  id bigint generated always as identity primary key,
  folio text not null unique,
  persona_bodega_id bigint not null references catalogo.persona_bodega (id),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas int not null check (piezas > 0),
  precio_cent bigint check (precio_cent is null or precio_cent > 0),
  fecha_neg date not null,
  via text not null default 'web_socio' check (via in ('web_socio', 'telegram_omar')),
  estado text not null check (estado in ('pendiente', 'autorizada', 'rechazada', 'caducada', 'deshecha')),
  solicitada_at timestamptz not null default now(),
  resuelta_at timestamptz,
  resuelta_por uuid,
  movimiento_id bigint references operacion.movimiento_inventario (id),
  evento_id bigint not null references operacion.evento (id)
);
create index toma_omar_fecha_idx on operacion.toma_omar (fecha_neg);

-- T9: el estado de una toma solo avanza.
create function operacion.t9_toma() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'las tomas no se borran' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['estado', 'resuelta_at', 'resuelta_por', 'movimiento_id']) is distinct from (to_jsonb(old) - array['estado', 'resuelta_at', 'resuelta_por', 'movimiento_id']) then
    raise exception 'la toma solo cambia de estado' using errcode = '42501';
  end if;
  if not ((old.estado = 'pendiente' and new.estado in ('autorizada', 'rechazada', 'caducada')) or (old.estado = 'autorizada' and new.estado = 'deshecha') or old.estado = new.estado) then
    raise exception 'transicion de toma no permitida: % -> %', old.estado, new.estado using errcode = '42501';
  end if;
  return new;
end $$;
create trigger toma_omar_t9 before update or delete on operacion.toma_omar for each row execute function operacion.t9_toma();

create table operacion.liquidacion_omar (
  id bigint generated always as identity primary key,
  folio text not null unique,
  persona_bodega_id bigint not null references catalogo.persona_bodega (id),
  semana_ini date not null check (extract(isodow from semana_ini) = 1),
  semana_fin date not null,
  renta_cent bigint not null,
  tomas_cent bigint not null,
  compensado_cent bigint not null,
  neto_cent bigint not null,
  pagos_previos_cent bigint not null default 0,
  estado text not null default 'cerrada' check (estado = 'cerrada'),
  snapshot jsonb not null,
  fecha_cierre date not null,
  evento_id bigint not null references operacion.evento (id),
  unique (persona_bodega_id, semana_ini),
  check (semana_fin = semana_ini + 6)
);

create table operacion.pago_omar (
  id bigint generated always as identity primary key,
  folio text not null unique,
  fecha_neg date not null,
  monto_cent bigint not null check (monto_cent > 0),
  sentido text not null check (sentido in ('a_omar', 'de_omar')),
  socio_id bigint references catalogo.socio (id),
  via text not null default 'transferencia' check (via in ('transferencia', 'efectivo')),
  liquidacion_id bigint references operacion.liquidacion_omar (id),
  evento_id bigint not null references operacion.evento (id)
);

do $$
declare t text;
begin
  foreach t in array array['renta_devengo', 'liquidacion_omar', 'pago_omar'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
  end loop;
  revoke update on operacion.pago_omar from postgres;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'operacion' and c.relkind = 'r' loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Calendario de la semana de Omar (lunes a domingo) y guardas
-- ---------------------------------------------------------------------------
create function operacion.semana_omar_ini(p_fecha date) returns date
language sql immutable parallel safe set search_path = ''
as $$ select p_fecha - (extract(isodow from p_fecha)::int - 1) $$;

create function operacion.persona_bodega_id() returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v bigint;
begin
  select id into v from catalogo.persona_bodega order by id limit 1;
  if v is null then raise exception 'no hay persona de bodega configurada (Omar Yacaman)' using errcode = 'P0428'; end if;
  return v;
end $$;

-- Una semana ya liquidada no admite renta ni tomas nuevas (se corrige en la siguiente liquidacion con un movimiento aparte).
create function operacion.exigir_semana_omar_abierta(p_fecha date) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if exists (select 1 from operacion.liquidacion_omar where semana_ini = operacion.semana_omar_ini(p_fecha)) then
    raise exception 'la semana de Omar del % ya esta liquidada', operacion.semana_omar_ini(p_fecha) using errcode = 'P0422';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Renta de bodega
-- ---------------------------------------------------------------------------
create function operacion.devengar_renta(p_linea bigint, p_piezas int, p_monto_cent bigint, p_fecha date, p_evento bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into operacion.renta_devengo (pedido_linea_id, persona_bodega_id, piezas, monto_cent, devengada_fecha, evento_id)
    values (p_linea, operacion.persona_bodega_id(), p_piezas, p_monto_cent, p_fecha, p_evento);
end $$;

create function operacion.revertir_renta_pedido(p_pedido bigint, p_evento bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into operacion.renta_devengo (pedido_linea_id, persona_bodega_id, piezas, monto_cent, devengada_fecha, evento_id, reversa_de)
    select r.pedido_linea_id, r.persona_bodega_id, -r.piezas, -r.monto_cent, negocio.hoy(), p_evento, r.id
    from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id
    where l.pedido_id = p_pedido and r.reversa_de is null and not exists (select 1 from operacion.renta_devengo x where x.reversa_de = r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Tomas a credito
-- ---------------------------------------------------------------------------
create function operacion.registrar_toma_omar(p_clave_idem text, p_sku jsonb, p_piezas int, p_precio_cent bigint default null, p_fecha date default null, p_via text default 'web_socio') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); r jsonb; pb catalogo.persona_bodega; v_precio bigint; v_ev bigint; v_id bigint; v_folio text; v_mov bigint; v_estado text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_toma_omar', 's', p_sku, 'p', p_piezas, 'pr', p_precio_cent, 'f', p_fecha, 'v', p_via));
  if v_prev is not null then return v_prev; end if;
  if p_piezas is null or p_piezas <= 0 then raise exception 'la toma necesita piezas positivas' using errcode = '23514'; end if;
  if p_via not in ('web_socio', 'telegram_omar') then raise exception 'via invalida' using errcode = '22023'; end if;
  select * into pb from catalogo.persona_bodega where id = operacion.persona_bodega_id();
  r := operacion.resolver_sku(p_sku);
  v_precio := coalesce(p_precio_cent, catalogo.precio_vigente(pb.cliente_id, (r->>'modelo_id')::bigint, v_fecha));
  v_estado := case p_via when 'web_socio' then 'autorizada' else 'pendiente' end;   -- la indicacion de un socio se ejecuta
  if v_estado = 'autorizada' then perform operacion.exigir_semana_omar_abierta(v_fecha); end if;
  v_ev := operacion.crear_evento('toma_omar', v_fecha, p_clave_idem, jsonb_build_object('piezas', p_piezas, 'estado', v_estado));
  v_folio := seguridad.siguiente_folio('T');
  if v_estado = 'autorizada' then
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id)
      values (v_fecha, (r->>'sku_id')::bigint, (r->>'modelo_id')::bigint, 'bodega_omar', 'salida_toma_omar', -p_piezas, v_ev) returning id into v_mov;
  end if;
  insert into operacion.toma_omar (folio, persona_bodega_id, sku_id, modelo_id, piezas, precio_cent, fecha_neg, via, estado, resuelta_at, resuelta_por, movimiento_id, evento_id)
    values (v_folio, pb.id, (r->>'sku_id')::bigint, (r->>'modelo_id')::bigint, p_piezas, v_precio, v_fecha, p_via, v_estado,
            case when v_estado = 'autorizada' then now() end, case when v_estado = 'autorizada' then nullif(current_setting('request.jwt.claim.sub', true), '')::uuid end, v_mov, v_ev) returning id into v_id;
  if v_estado = 'pendiente' then
    insert into operacion.reserva (sku_id, piezas, origen_tipo, origen_id) values ((r->>'sku_id')::bigint, p_piezas, 'toma_omar', v_id);
  end if;
  if v_estado = 'autorizada' and v_precio is null then
    perform operacion.avisar('toma_sin_precio', 'NT-051', 'toma_sin_precio:' || v_id, 'I', 'Toma ' || v_folio || ' sin precio ("Falta precio"): no entra al saldo', 'toma_omar', v_id,
      jsonb_build_object('folio', v_folio), null, v_ev, false, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('toma_id', v_id, 'folio', v_folio, 'estado', v_estado, 'precio_cent', v_precio, 'falta_precio', v_precio is null);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.resolver_toma_omar(p_clave_idem text, p_toma bigint, p_accion text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; t operacion.toma_omar; v_ev bigint; v_mov bigint; m operacion.movimiento_inventario; v_nuevo text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'resolver_toma_omar', 't', p_toma, 'a', p_accion));
  if v_prev is not null then return v_prev; end if;
  if p_accion not in ('autorizar', 'rechazar', 'caducar', 'deshacer') then raise exception 'accion invalida' using errcode = '22023'; end if;
  select * into t from operacion.toma_omar where id = p_toma for update;
  if not found then raise exception 'toma desconocida' using errcode = '22023'; end if;
  if p_accion in ('autorizar', 'rechazar', 'caducar') and t.estado <> 'pendiente' then raise exception 'la toma % ya esta %', t.folio, t.estado using errcode = 'P0428'; end if;
  if p_accion = 'deshacer' and t.estado <> 'autorizada' then raise exception 'solo una toma autorizada se deshace (esta %)', t.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('toma_omar_' || p_accion, negocio.hoy(), p_clave_idem, jsonb_build_object('toma', t.folio));
  if p_accion = 'autorizar' then
    perform operacion.exigir_semana_omar_abierta(negocio.hoy());
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id)
      values (negocio.hoy(), t.sku_id, t.modelo_id, 'bodega_omar', 'salida_toma_omar', -t.piezas, v_ev) returning id into v_mov;
    update operacion.toma_omar set estado = 'autorizada', resuelta_at = now(), resuelta_por = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, movimiento_id = v_mov where id = t.id;
    update operacion.reserva set estado = 'aplicada', resuelta_at = now() where origen_tipo = 'toma_omar' and origen_id = t.id and estado = 'activa';
    v_nuevo := 'autorizada';
    if t.precio_cent is null then
      perform operacion.avisar('toma_sin_precio', 'NT-051', 'toma_sin_precio:' || t.id, 'I', 'Toma ' || t.folio || ' sin precio ("Falta precio"): no entra al saldo', 'toma_omar', t.id,
        jsonb_build_object('folio', t.folio), null, v_ev, false, array['software', 'telegram']);
    end if;
  elsif p_accion in ('rechazar', 'caducar') then
    v_nuevo := case p_accion when 'rechazar' then 'rechazada' else 'caducada' end;
    update operacion.toma_omar set estado = v_nuevo, resuelta_at = now(), resuelta_por = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid where id = t.id;
    update operacion.reserva set estado = 'liberada', resuelta_at = now() where origen_tipo = 'toma_omar' and origen_id = t.id and estado = 'activa';
  else
    perform operacion.exigir_semana_omar_abierta(t.fecha_neg);
    select * into m from operacion.movimiento_inventario where id = t.movimiento_id;
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, 'Toma deshecha');
    update operacion.toma_omar set estado = 'deshecha', resuelta_at = now() where id = t.id;
    v_nuevo := 'deshecha';
  end if;
  v_res := jsonb_build_object('toma_id', t.id, 'folio', t.folio, 'estado', v_nuevo);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Cuenta de la semana, liquidacion y pagos
-- ---------------------------------------------------------------------------
-- Una cifra, una funcion: la usan la liquidacion, la web y (despues) el agente.
create function operacion.saldo_omar_semana(p_semana_ini date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_fin date := p_semana_ini + 6; v_renta bigint; v_tomas bigint; v_pend int; v_sin_precio int; v_pagos bigint; v_liq operacion.liquidacion_omar;
begin
  select coalesce(sum(monto_cent), 0) into v_renta from operacion.renta_devengo where devengada_fecha between p_semana_ini and v_fin;
  select coalesce(sum(piezas * precio_cent), 0) into v_tomas from operacion.toma_omar where estado = 'autorizada' and precio_cent is not null and fecha_neg between p_semana_ini and v_fin;
  select count(*) filter (where estado = 'pendiente'), count(*) filter (where estado = 'autorizada' and precio_cent is null) into v_pend, v_sin_precio
    from operacion.toma_omar where fecha_neg between p_semana_ini and v_fin;
  select coalesce(sum(case sentido when 'a_omar' then monto_cent else -monto_cent end), 0) into v_pagos from operacion.pago_omar where fecha_neg between p_semana_ini and v_fin;
  select * into v_liq from operacion.liquidacion_omar where semana_ini = p_semana_ini;
  return jsonb_build_object('semana_ini', p_semana_ini, 'semana_fin', v_fin, 'renta_cent', v_renta, 'tomas_cent', v_tomas, 'compensado_cent', least(v_renta, v_tomas),
    'neto_cent', v_renta - v_tomas, 'pagos_semana_cent', v_pagos, 'tomas_pendientes', v_pend, 'tomas_sin_precio', v_sin_precio,
    'estado', case when v_liq.id is null then 'abierta' else 'cerrada' end, 'liquidacion', v_liq.folio);
end $$;

create function operacion.cerrar_liquidacion_omar(p_clave_idem text, p_semana_ini date, p_decision_pendientes boolean default false, p_fecha_cierre date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_cierre date := coalesce(p_fecha_cierre, negocio.hoy()); v_fin date := p_semana_ini + 6; v_s jsonb; v_ev bigint; v_folio text; v_id bigint; v_pagos bigint; v_res jsonb; v_snap jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_liquidacion_omar', 's', p_semana_ini, 'd', p_decision_pendientes, 'f', p_fecha_cierre));
  if v_prev is not null then return v_prev; end if;
  if extract(isodow from p_semana_ini) <> 1 then raise exception 'la semana de Omar empieza en lunes' using errcode = '22023'; end if;
  if v_cierre <= v_fin then raise exception 'la semana del % al % aun no termina: se liquida a partir del lunes %', p_semana_ini, v_fin, v_fin + 1 using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.liquidacion_omar where semana_ini = p_semana_ini) then raise exception 'la semana del % ya esta liquidada', p_semana_ini using errcode = 'P0428'; end if;
  v_s := operacion.saldo_omar_semana(p_semana_ini);
  if (v_s->>'tomas_pendientes')::int > 0 and not p_decision_pendientes then
    raise exception 'hay % tomas pendientes de autorizacion: decide cada una o cierra con decision expresa', v_s->>'tomas_pendientes' using errcode = 'P0428';
  end if;
  v_pagos := coalesce((select sum(case sentido when 'a_omar' then monto_cent else -monto_cent end) from operacion.pago_omar where fecha_neg between p_semana_ini and v_fin), 0);
  v_snap := v_s || jsonb_build_object(
    'renta', coalesce((select jsonb_agg(jsonb_build_object('folio', pe.folio, 'fecha', r.devengada_fecha, 'piezas', r.piezas, 'monto_cent', r.monto_cent) order by r.id)
                       from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id where r.devengada_fecha between p_semana_ini and v_fin), '[]'::jsonb),
    'tomas', coalesce((select jsonb_agg(jsonb_build_object('folio', t.folio, 'piezas', t.piezas, 'precio_cent', t.precio_cent, 'estado', t.estado) order by t.id)
                       from operacion.toma_omar t where t.fecha_neg between p_semana_ini and v_fin and t.estado in ('autorizada', 'pendiente')), '[]'::jsonb));
  v_ev := operacion.crear_evento('liquidacion_omar', v_cierre, p_clave_idem, jsonb_build_object('semana_ini', p_semana_ini));
  v_folio := seguridad.siguiente_folio('L');
  insert into operacion.liquidacion_omar (folio, persona_bodega_id, semana_ini, semana_fin, renta_cent, tomas_cent, compensado_cent, neto_cent, pagos_previos_cent, snapshot, fecha_cierre, evento_id)
    values (v_folio, operacion.persona_bodega_id(), p_semana_ini, v_fin, (v_s->>'renta_cent')::bigint, (v_s->>'tomas_cent')::bigint, (v_s->>'compensado_cent')::bigint, (v_s->>'neto_cent')::bigint, v_pagos, v_snap, v_cierre, v_ev)
    returning id into v_id;
  v_res := jsonb_build_object('liquidacion_id', v_id, 'folio', v_folio, 'renta_cent', (v_s->>'renta_cent')::bigint, 'tomas_cent', (v_s->>'tomas_cent')::bigint, 'compensado_cent', (v_s->>'compensado_cent')::bigint,
                              'neto_cent', (v_s->>'neto_cent')::bigint, 'palabra', case when (v_s->>'neto_cent')::bigint > 0 then 'Le debemos' when (v_s->>'neto_cent')::bigint < 0 then 'Omar debe' else 'Saldo cero' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Saldo acumulado con Omar: lo liquidado menos lo pagado. > 0 los socios deben a Omar; < 0 Omar debe.
create function operacion.saldo_omar_cuenta() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(neto_cent) from operacion.liquidacion_omar), 0)::bigint
       - coalesce((select sum(case sentido when 'a_omar' then monto_cent else -monto_cent end) from operacion.pago_omar), 0)::bigint
$$;

create function operacion.registrar_pago_omar(p_clave_idem text, p_monto_cent bigint, p_sentido text, p_socio text default null, p_via text default 'transferencia',
                                              p_fecha date default null, p_liquidacion_id bigint default null, p_fuente text default 'auto') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_socio bigint; v_ev bigint; v_id bigint; v_folio text; v_deuda bigint; v_desde bigint := 0; v_aport bigint := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago_omar', 'm', p_monto_cent, 's', p_sentido, 'so', p_socio, 'v', p_via, 'f', p_fecha, 'l', p_liquidacion_id, 'u', p_fuente));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  if p_sentido not in ('a_omar', 'de_omar') or p_via not in ('transferencia', 'efectivo') or p_fuente not in ('auto', 'fondos_sociedad', 'aportacion') then raise exception 'pago invalido' using errcode = '22023'; end if;
  if p_socio is not null then select id into v_socio from catalogo.socio where nombre = p_socio; if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if; end if;
  if p_sentido = 'a_omar' and v_socio is null then raise exception 'indica el socio que pago a Omar' using errcode = '23502'; end if;
  v_ev := operacion.crear_evento('pago_omar', v_fecha, p_clave_idem, jsonb_build_object('sentido', p_sentido, 'monto_cent', p_monto_cent));
  v_folio := seguridad.siguiente_folio('PO');
  insert into operacion.pago_omar (folio, fecha_neg, monto_cent, sentido, socio_id, via, liquidacion_id, evento_id) values (v_folio, v_fecha, p_monto_cent, p_sentido, v_socio, p_via, p_liquidacion_id, v_ev) returning id into v_id;
  if p_sentido = 'a_omar' then
    -- El socio paga a Omar: baja primero lo que debe a la sociedad (si la fuente lo permite); el resto es aportacion reembolsable.
    v_deuda := greatest(operacion.saldo_socio(v_socio), 0);
    v_desde := case p_fuente when 'aportacion' then 0 else least(p_monto_cent, v_deuda) end;
    v_aport := p_monto_cent - v_desde;
    if v_desde > 0 then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
        values (v_socio, v_fecha, 'entrega_a_proveedor', 'general', -v_desde, 'Pago a Omar ' || v_folio || ' con fondos de la sociedad', v_ev);
    end if;
    if v_aport > 0 then
      insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
        values (v_socio, v_aport, 'Pago a Omar ' || v_folio, 'reembolsable', v_fecha, 'pago_omar', v_id, v_ev);
    end if;
  elsif v_socio is not null then
    -- Omar paga y lo recibe un socio: son fondos de la sociedad en su poder.
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
      values (v_socio, v_fecha, 'fondos_en_poder', 'fondos', p_monto_cent, 'Pago de Omar ' || v_folio, v_ev);
  end if;
  v_res := jsonb_build_object('pago_id', v_id, 'folio', v_folio, 'saldo_omar_cent', operacion.saldo_omar_cuenta());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
