-- F2 / 0009: pagos de clientes con destino, aplicacion a pedidos, saldo a favor, dinero de la sociedad en poder de un socio (deuda del socio
-- con la sociedad, adenda 22) y pagos de un socio a un proveedor (adenda 23).
-- Un pago que cae en la cuenta personal de un socio SI liquida la cuenta por cobrar del cliente, pero el dinero es de la sociedad: nace una
-- deuda del socio (fondos en su poder) que baja cuando lo entrega, lo paga a un proveedor o se compensa. Un pago redirigido a Isaac o Karen
-- sube el saldo a favor de la sociedad con ese proveedor. Todo es de solo insercion; se corrige con renglones contrarios enlazados.

create table operacion.pago (
  id bigint generated always as identity primary key,
  folio text not null unique,
  fecha_neg date not null,
  hora timestamptz not null default now(),
  monto_cent bigint not null check (monto_cent > 0),
  cliente_id bigint references catalogo.cliente (id),
  cuenta_destino_id bigint not null references operacion.cuenta_dinero (id),
  tipo text not null default 'abono' check (tipo in ('abono', 'anticipo', 'pago_faltante_credito')),
  identificacion text not null check (identificacion in ('identificado', 'sin_identificar')),
  comprobante_sha256 text unique check (comprobante_sha256 is null or comprobante_sha256 ~ '^[0-9a-f]{64}$'),
  nota text,
  evento_id bigint not null references operacion.evento (id),
  check ((identificacion = 'identificado') = (cliente_id is not null))
);

create table operacion.pago_aplicacion (
  id bigint generated always as identity primary key,
  pago_id bigint not null references operacion.pago (id),
  pedido_id bigint not null,
  monto_cent bigint not null check (monto_cent <> 0),
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint unique references operacion.pago_aplicacion (id),
  creado_at timestamptz not null default now(),
  check ((reversa_de is null) = (monto_cent > 0))
);
create index pago_aplicacion_pedido_idx on operacion.pago_aplicacion (pedido_id);
create index pago_aplicacion_pago_idx on operacion.pago_aplicacion (pago_id);

create table operacion.pago_identificacion (
  id bigint generated always as identity primary key,
  pago_id bigint not null unique references operacion.pago (id),
  cliente_id bigint not null references catalogo.cliente (id),
  evento_id bigint not null references operacion.evento (id)
);

create table operacion.pago_anulacion (
  id bigint generated always as identity primary key,
  pago_id bigint not null unique references operacion.pago (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  evento_id bigint not null references operacion.evento (id)
);

alter table operacion.cuenta_proveedor_mov add constraint cpm_pago_fk foreign key (pago_id) references operacion.pago (id);
alter table operacion.cuenta_socio_mov add constraint csm_pago_fk foreign key (pago_id) references operacion.pago (id);

do $$
declare t text;
begin
  foreach t in array array['pago', 'pago_aplicacion', 'pago_identificacion', 'pago_anulacion'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
  revoke update on operacion.pago_identificacion, operacion.pago_anulacion from postgres;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lecturas
-- ---------------------------------------------------------------------------
create function operacion.pago_cliente(p_pago bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(p.cliente_id, (select i.cliente_id from operacion.pago_identificacion i where i.pago_id = p.id)) from operacion.pago p where p.id = p_pago $$;

-- Lo que de un pago aun no se aplico a ningun pedido (0 si esta anulado o sin identificar).
create function operacion.pago_disponible(p_pago bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id) or operacion.pago_cliente(p.id) is null then 0
              else p.monto_cent - coalesce((select sum(x.monto_cent) from operacion.pago_aplicacion x where x.pago_id = p.id), 0) end
  from operacion.pago p where p.id = p_pago
$$;

-- Saldo a favor del cliente = pagos que aun no se aplicaron a pedidos.
create function operacion.saldo_favor_cliente(p_cliente bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(operacion.pago_disponible(p.id)), 0)::bigint from operacion.pago p where operacion.pago_cliente(p.id) = p_cliente
$$;

-- Aplica el saldo a favor del cliente a sus pedidos enviados con saldo, del mas antiguo al mas nuevo (y del pago mas antiguo).
create function operacion.aplicar_fifo(p_cliente bigint, p_evento bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare ped record; pg record; v_saldo bigint; v_disp bigint; v_monto bigint; v_total bigint := 0;
begin
  for ped in select pe.id from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' order by pe.fecha_envio, pe.id loop
    v_saldo := operacion.pedido_saldo(ped.id);
    exit when v_saldo is null;
    continue when v_saldo <= 0;
    for pg in select p.id from operacion.pago p where operacion.pago_cliente(p.id) = p_cliente order by p.fecha_neg, p.id loop
      exit when v_saldo <= 0;
      v_disp := operacion.pago_disponible(pg.id);
      continue when v_disp <= 0;
      v_monto := least(v_disp, v_saldo);
      insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id) values (pg.id, ped.id, v_monto, p_evento);
      v_saldo := v_saldo - v_monto; v_total := v_total + v_monto;
    end loop;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- Escritura
-- ---------------------------------------------------------------------------
-- p_cuenta: 'Angelo' | 'Javier' | 'Isaac' | 'Karen' | 'Efectivo'. Sin cliente => sin identificar (no se aplica a pedidos).
-- p_aplicar: true aplica a los pedidos con saldo (del mas antiguo); false lo deja como saldo a favor; p_pedidos [{pedido_id, monto_cent}] aplica a esos.
create function operacion.registrar_pago(p_clave_idem text, p_cuenta text, p_monto_cent bigint, p_cliente_id bigint default null, p_pedidos jsonb default null,
                                         p_aplicar boolean default true, p_tipo text default 'abono', p_fecha date default null, p_comprobante_sha256 text default null,
                                         p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; cu operacion.cuenta_dinero; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_folio text; v_res jsonb; x record;
  v_existente text; v_aplicado bigint := 0; v_disp bigint; v_saldo bigint; v_monto bigint; v_ident text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago', 'c', p_cuenta, 'm', p_monto_cent, 'cl', p_cliente_id, 'p', p_pedidos, 'ap', p_aplicar, 't', p_tipo, 'f', p_fecha, 'h', p_comprobante_sha256, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  select * into cu from operacion.cuenta_dinero where nombre = p_cuenta;
  if not found then raise exception 'cuenta desconocida: %', p_cuenta using errcode = '22023'; end if;
  if p_cliente_id is not null and not exists (select 1 from catalogo.cliente where id = p_cliente_id) then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  v_ident := case when p_cliente_id is null then 'sin_identificar' else 'identificado' end;
  -- Mismo comprobante no entra dos veces (T7): se avisa y no se registra.
  if p_comprobante_sha256 is not null then
    select folio into v_existente from operacion.pago where comprobante_sha256 = p_comprobante_sha256;
    if v_existente is not null then
      perform operacion.avisar('pago_posible_duplicado', 'NT-038', 'pago_duplicado:' || p_comprobante_sha256, 'C', 'Posible pago duplicado: el comprobante ya esta en ' || v_existente, 'pago', null,
        jsonb_build_object('folio_existente', v_existente), null, null, false, array['software', 'telegram']);
      v_res := jsonb_build_object('duplicado', true, 'folio_existente', v_existente);
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
  end if;
  v_ev := operacion.crear_evento('pago_cliente', v_fecha, p_clave_idem, jsonb_build_object('cuenta', p_cuenta, 'monto_cent', p_monto_cent, 'cliente_id', p_cliente_id), p_mensaje_origen);
  v_folio := seguridad.siguiente_folio('PG');
  insert into operacion.pago (folio, fecha_neg, monto_cent, cliente_id, cuenta_destino_id, tipo, identificacion, comprobante_sha256, nota, evento_id)
    values (v_folio, v_fecha, p_monto_cent, p_cliente_id, cu.id, p_tipo, v_ident, p_comprobante_sha256, p_nota, v_ev) returning id into v_id;
  -- Efecto del destino.
  if cu.titular_tipo = 'socio' then
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, pago_id, cliente_id, nota, evento_id)
      values (cu.socio_id, v_fecha, 'fondos_en_poder', 'fondos', p_monto_cent, v_id, p_cliente_id, 'Pago ' || v_folio || ' en la cuenta de ' || cu.nombre, v_ev);
  elsif cu.titular_tipo = 'proveedor' then
    insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, pago_id, cliente_id, cuenta_origen_id, nota, evento_id)
      values (cu.proveedor_id, v_fecha, 'pago_cliente_redirigido', p_monto_cent, v_id, p_cliente_id, cu.id, 'Pago ' || v_folio || ' de cliente redirigido a ' || cu.nombre, v_ev);
  end if;
  -- Aplicacion a pedidos.
  if v_ident = 'identificado' then
    if p_pedidos is not null and jsonb_typeof(p_pedidos) = 'array' then
      for x in select (e->>'pedido_id')::bigint as pedido_id, (e->>'monto_cent')::bigint as monto from jsonb_array_elements(p_pedidos) e loop
        v_saldo := operacion.pedido_saldo(x.pedido_id);
        if v_saldo is null or not exists (select 1 from operacion.pedido where id = x.pedido_id and cliente_id = p_cliente_id) then raise exception 'pedido invalido para este cliente' using errcode = '22023'; end if;
        v_disp := operacion.pago_disponible(v_id);
        v_monto := least(x.monto, v_saldo, v_disp);
        if v_monto > 0 then insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id) values (v_id, x.pedido_id, v_monto, v_ev); v_aplicado := v_aplicado + v_monto; end if;
      end loop;
    elsif p_aplicar then
      v_aplicado := operacion.aplicar_fifo(p_cliente_id, v_ev);
    end if;
  else
    perform operacion.avisar('pago_sin_identificar', 'NT-037', 'pago_sin_identificar:' || v_id, 'I', 'Pago sin identificar ' || v_folio, 'pago', v_id,
      jsonb_build_object('folio', v_folio), null, v_ev, false, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('pago_id', v_id, 'folio', v_folio, 'monto_cent', p_monto_cent, 'aplicado_cent', v_aplicado, 'saldo_favor_cliente_cent',
                              case when p_cliente_id is null then null else operacion.saldo_favor_cliente(p_cliente_id) end, 'destino', cu.nombre);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.aplicar_pago(p_clave_idem text, p_pago bigint, p_pedido bigint, p_monto_cent bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_cli bigint; v_saldo bigint; v_disp bigint; v_monto bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'aplicar_pago', 'pa', p_pago, 'pe', p_pedido, 'm', p_monto_cent));
  if v_prev is not null then return v_prev; end if;
  v_cli := operacion.pago_cliente(p_pago);
  if v_cli is null then raise exception 'el pago esta sin identificar o no existe: identificalo primero' using errcode = 'P0425'; end if;
  if not exists (select 1 from operacion.pedido where id = p_pedido and cliente_id = v_cli) then raise exception 'el pedido no es de este cliente' using errcode = '22023'; end if;
  v_saldo := operacion.pedido_saldo(p_pedido); v_disp := operacion.pago_disponible(p_pago);
  v_monto := least(p_monto_cent, coalesce(v_saldo, 0), v_disp);
  if v_monto <= 0 then raise exception 'nada que aplicar: saldo del pedido % y disponible del pago %', coalesce(v_saldo, 0), v_disp using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('pago_aplicado', negocio.hoy(), p_clave_idem, jsonb_build_object('pago', p_pago, 'pedido', p_pedido, 'monto_cent', v_monto));
  insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id) values (p_pago, p_pedido, v_monto, v_ev);
  v_res := jsonb_build_object('aplicado_cent', v_monto, 'saldo_pedido_cent', operacion.pedido_saldo(p_pedido));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Un pago sin identificar se asigna a un cliente (renglon aparte) y desde entonces se aplica como cualquier otro.
create function operacion.identificar_pago(p_clave_idem text, p_pago bigint, p_cliente bigint, p_aplicar boolean default true) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_aplicado bigint := 0; v_res jsonb; p operacion.pago;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'identificar_pago', 'p', p_pago, 'c', p_cliente, 'a', p_aplicar));
  if v_prev is not null then return v_prev; end if;
  select * into p from operacion.pago where id = p_pago for update;
  if not found then raise exception 'pago desconocido' using errcode = '22023'; end if;
  if p.identificacion <> 'sin_identificar' or exists (select 1 from operacion.pago_identificacion where pago_id = p.id) then raise exception 'el pago ya esta identificado' using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.pago_anulacion where pago_id = p.id) then raise exception 'el pago esta anulado' using errcode = 'P0428'; end if;
  if not exists (select 1 from catalogo.cliente where id = p_cliente) then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('pago_identificado', negocio.hoy(), p_clave_idem, jsonb_build_object('pago', p.folio, 'cliente_id', p_cliente));
  insert into operacion.pago_identificacion (pago_id, cliente_id, evento_id) values (p.id, p_cliente, v_ev);
  if p_aplicar then v_aplicado := operacion.aplicar_fifo(p_cliente, v_ev); end if;
  perform operacion.resolver_avisos('pago_sin_identificar', 'pago', p.id);
  v_res := jsonb_build_object('pago_id', p.id, 'aplicado_cent', v_aplicado);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.anular_pago(p_clave_idem text, p_pago bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; p operacion.pago; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_pago', 'p', p_pago, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into p from operacion.pago where id = p_pago for update;
  if not found then raise exception 'pago desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.pago_anulacion where pago_id = p.id) then raise exception 'el pago ya esta anulado' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('pago_anulado', negocio.hoy(), p_clave_idem, jsonb_build_object('pago', p.folio, 'motivo', p_motivo));
  insert into operacion.pago_anulacion (pago_id, motivo, evento_id) values (p.id, p_motivo, v_ev);
  insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id, reversa_de)
    select a.pago_id, a.pedido_id, -a.monto_cent, v_ev, a.id from operacion.pago_aplicacion a where a.pago_id = p.id and a.reversa_de is null
      and not exists (select 1 from operacion.pago_aplicacion r where r.reversa_de = a.id);
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, pago_id, cliente_id, nota, evento_id, reversa_de)
    select m.socio_id, negocio.hoy(), 'reversa', m.aplica_a, -m.monto_cent, m.pago_id, m.cliente_id, 'Anulacion del pago ' || p.folio, v_ev, m.id
    from operacion.cuenta_socio_mov m where m.pago_id = p.id and m.concepto = 'fondos_en_poder' and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, pago_id, cliente_id, nota, evento_id, reversa_de)
    select m.proveedor_id, negocio.hoy(), 'reversa', -m.monto_cent, m.pago_id, m.cliente_id, 'Anulacion del pago ' || p.folio, v_ev, m.id
    from operacion.cuenta_proveedor_mov m where m.pago_id = p.id and m.concepto = 'pago_cliente_redirigido' and not exists (select 1 from operacion.cuenta_proveedor_mov r where r.reversa_de = m.id);
  perform operacion.resolver_avisos('pago_sin_identificar', 'pago', p.id);
  v_res := jsonb_build_object('pago_id', p.id, 'anulado', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Un socio paga a un proveedor desde su cuenta. Con fuente 'fondos_sociedad' (o 'auto') baja primero lo que debe a la sociedad; el resto
-- es aportacion de capital. Sube el saldo a favor de la sociedad con el proveedor.
create function operacion.pago_proveedor_de_socio(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_socio text, p_fuente text default 'auto',
                                                  p_fecha date default null, p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_prov bigint; v_socio bigint; v_cuenta bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_deuda bigint; v_fondos bigint; v_desde_fondos bigint;
  v_aport bigint; v_a_fondos bigint; v_a_dif bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'pago_proveedor_de_socio', 'p', p_proveedor, 'm', p_monto_cent, 's', p_socio, 'u', p_fuente, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  if p_fuente not in ('auto', 'fondos_sociedad', 'aportacion') then raise exception 'fuente invalida' using errcode = '22023'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  select id into v_socio from catalogo.socio where nombre = p_socio;
  select id into v_cuenta from operacion.cuenta_dinero where nombre = p_socio;
  if v_prov is null or v_socio is null then raise exception 'proveedor o socio desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || v_prov, 0));
  v_deuda := greatest(operacion.saldo_socio(v_socio), 0);
  v_desde_fondos := case p_fuente when 'aportacion' then 0 else least(p_monto_cent, v_deuda) end;
  if p_fuente = 'fondos_sociedad' and p_monto_cent > v_deuda then raise exception 'el socio solo tiene % centavos de la sociedad en su poder', v_deuda using errcode = '23514'; end if;
  v_aport := p_monto_cent - v_desde_fondos;
  v_ev := operacion.crear_evento('pago_proveedor_socio', v_fecha, p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'socio', p_socio, 'monto_cent', p_monto_cent), p_mensaje_origen);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, cuenta_origen_id, socio_id, nota, evento_id)
    values (v_prov, v_fecha, 'pago_socio', p_monto_cent, v_cuenta, v_socio, coalesce(p_nota, 'Pago de ' || p_socio || ' a ' || p_proveedor), v_ev);
  if v_desde_fondos > 0 then
    v_fondos := operacion.saldo_socio(v_socio, 'fondos');
    v_a_fondos := least(v_desde_fondos, greatest(v_fondos, 0)); v_a_dif := v_desde_fondos - v_a_fondos;
    if v_a_fondos > 0 then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, proveedor_id, nota, evento_id)
        values (v_socio, v_fecha, 'entrega_a_proveedor', 'fondos', -v_a_fondos, v_prov, 'Pago a ' || p_proveedor || ' con fondos de la sociedad', v_ev);
    end if;
    if v_a_dif > 0 then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, proveedor_id, nota, evento_id)
        values (v_socio, v_fecha, 'entrega_a_proveedor', 'general', -v_a_dif, v_prov, 'Pago a ' || p_proveedor || ' con lo que debia a la sociedad', v_ev);
    end if;
  end if;
  if v_aport > 0 then
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, evento_id)
      values (v_socio, v_aport, 'Pago a ' || p_proveedor || ' con dinero propio', 'capital', v_fecha, 'cuenta_proveedor', v_ev);
  end if;
  v_res := jsonb_build_object('proveedor', p_proveedor, 'monto_cent', p_monto_cent, 'baja_deuda_cent', v_desde_fondos, 'aportacion_cent', v_aport,
                              'deuda_socio_cent', operacion.saldo_socio(v_socio), 'saldo_proveedor_cent', operacion.saldo_proveedor(v_prov));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Un socio entrega a la sociedad (o a otro socio) lo que tiene en su poder, o liquida un faltante que se le asigno.
create function operacion.registrar_entrega_socio(p_clave_idem text, p_socio text, p_monto_cent bigint, p_destino text default 'sociedad', p_socio_destino text default null,
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
  v_ev := operacion.crear_evento('entrega_socio', v_fecha, p_clave_idem, jsonb_build_object('socio', p_socio, 'monto_cent', p_monto_cent, 'destino', p_destino));
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
    values (v_socio, v_fecha, case when p_destino = 'sociedad' then 'entrega_a_sociedad' else 'traspaso_entre_socios' end, p_aplica_a, -p_monto_cent,
            coalesce(p_nota, case when p_destino = 'sociedad' then 'Entrega a la sociedad' else 'Traspaso a ' || p_socio_destino end), v_ev);
  if v_dest is not null then
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
      values (v_dest, v_fecha, 'traspaso_entre_socios', 'fondos', p_monto_cent, 'Recibe de ' || p_socio, v_ev);
  end if;
  v_res := jsonb_build_object('deuda_socio_cent', operacion.saldo_socio(v_socio), 'diferencia_pendiente_cent', operacion.saldo_socio(v_socio, 'diferencia'), 'fondos_pendientes_cent', operacion.saldo_socio(v_socio, 'fondos'));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
