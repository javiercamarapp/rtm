-- F2 / 0008: compras a proveedores (orden de compra), cuenta con cada proveedor, guias, lotes, recepcion en Merida por sabor
-- y diferencias de recepcion asignables a un responsable (sociedad, socio o proveedor).
-- Reglas del dueno: el dinero se descuenta al CONFIRMAR la orden, pero las piezas no cuentan como existencia hasta que un socio confirma
-- la recepcion en Merida. Karen exige pago completo antes de confirmar; Isaac admite credito (la cuenta puede quedar negativa).
-- La recepcion entra al inventario por lo RECIBIDO (con el costo puesto de lo facturado, prorrateado); lo que falta va a la cuenta puente
-- de diferencias y se asigna sin esconderlo en el costo (adenda 29). Nada se edita: se corrige con contramovimientos.

create table operacion.compra (
  id bigint generated always as identity primary key,
  folio text not null unique,
  proveedor_id bigint not null references catalogo.proveedor (id),
  fecha_neg date not null,
  destino text not null default 'bodega' check (destino in ('bodega', 'directo_cliente')),
  ambito text not null default 'sociedad' check (ambito in ('sociedad', 'angelo', 'javier')),
  estado text not null default 'borrador' check (estado in ('borrador', 'confirmada', 'enviada', 'en_trayecto', 'llego_merida', 'recibida', 'cerrada', 'anulada')),
  mercancia_cent bigint not null check (mercancia_cent >= 0),
  guia_cent bigint not null default 0 check (guia_cent >= 0),
  seguro_cent bigint not null default 0 check (seguro_cent >= 0),
  total_cent bigint not null check (total_cent >= 0),
  guia_pagada_por_socio_id bigint references catalogo.socio (id),
  socio_excedente_id bigint references catalogo.socio (id),
  llegada_estimada date,
  enviada_fecha date,
  recibida_fecha date,
  confirmada_at timestamptz,
  nota text,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);

create table operacion.compra_linea (
  id bigint generated always as identity primary key,
  compra_id bigint not null references operacion.compra (id),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas_pagadas int not null check (piezas_pagadas >= 0),
  piezas_facturadas int not null check (piezas_facturadas > 0),
  piezas_recibidas int check (piezas_recibidas is null or piezas_recibidas >= 0),
  costo_unit_cent bigint not null check (costo_unit_cent > 0),
  costo_lista_cent bigint,
  motivo_costo text,
  -- Un costo distinto del de lista (o sin lista vigente) exige motivo.
  check ((costo_lista_cent is not null and costo_unit_cent = costo_lista_cent) or nullif(btrim(motivo_costo), '') is not null)
);
create index compra_linea_compra_idx on operacion.compra_linea (compra_id);

create table operacion.lote (
  id bigint generated always as identity primary key,
  compra_linea_id bigint not null unique references operacion.compra_linea (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas_facturadas int not null,
  piezas_entrada int not null check (piezas_entrada >= 0),
  costo_mercancia_cent bigint not null,
  guia_prorrateada_cent bigint not null default 0,
  seguro_prorrateado_cent bigint not null default 0,
  costo_puesto_cent bigint generated always as (costo_mercancia_cent + guia_prorrateada_cent + seguro_prorrateado_cent) stored,
  valor_entrada_cent bigint not null,
  creado_at timestamptz not null default now()
);
alter table operacion.movimiento_inventario add constraint movimiento_lote_fk foreign key (lote_id) references operacion.lote (id);

create table operacion.compra_recepcion (
  id bigint generated always as identity primary key,
  compra_id bigint not null references operacion.compra (id),
  compra_linea_id bigint not null references operacion.compra_linea (id),
  sku_id bigint not null references catalogo.sku (id),
  piezas int not null check (piezas > 0),
  movimiento_id bigint not null references operacion.movimiento_inventario (id),
  contado_at timestamptz not null
);

create table operacion.compra_diferencia (
  id bigint generated always as identity primary key,
  compra_id bigint not null references operacion.compra (id),
  compra_linea_id bigint not null unique references operacion.compra_linea (id),
  tipo text not null check (tipo in ('faltante', 'sobrante')),
  piezas int not null check (piezas > 0),
  valor_cent bigint not null check (valor_cent >= 0),
  abierta_at timestamptz not null default now(),
  evento_id bigint not null references operacion.evento (id)
);

-- Asignacion de la diferencia a un responsable. Asignar, reasignar o cancelar son renglones aparte; el original nunca se edita.
-- Un renglon con `cancela_a` es el contrario exacto del que cancela.
create table operacion.diferencia_asignacion (
  id bigint generated always as identity primary key,
  diferencia_id bigint not null references operacion.compra_diferencia (id),
  responsable text not null check (responsable in ('socio', 'proveedor')),
  socio_id bigint references catalogo.socio (id),
  proveedor_id bigint references catalogo.proveedor (id),
  monto_cent bigint not null check (monto_cent <> 0),
  cancela_a bigint unique references operacion.diferencia_asignacion (id),
  motivo text,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now(),
  check ((responsable = 'socio') = (socio_id is not null) and (responsable = 'proveedor') = (proveedor_id is not null)),
  check ((cancela_a is null) = (monto_cent > 0))
);

-- Guias de rastreo. Entrada = de un proveedor hacia Merida (varias por orden); salida = de la bodega a un cliente.
create table operacion.guia (
  id bigint generated always as identity primary key,
  sentido text not null check (sentido in ('entrada', 'salida')),
  paqueteria text not null,
  numero text not null,
  costo_cent bigint check (costo_cent is null or costo_cent >= 0),
  pagada_por_socio_id bigint references catalogo.socio (id),
  compra_id bigint references operacion.compra (id),
  pedido_id bigint,
  fecha_neg date not null,
  llegada_estimada date,
  evento_id bigint not null references operacion.evento (id),
  costeada_evento_id bigint references operacion.evento (id),
  creado_at timestamptz not null default now(),
  check ((compra_id is not null) <> (pedido_id is not null))
);

create table operacion.gasto (
  id bigint generated always as identity primary key,
  folio text not null unique,
  fecha_neg date not null,
  categoria text not null,
  naturaleza text not null default 'variable' check (naturaleza in ('fijo', 'variable')),
  monto_cent bigint not null check (monto_cent >= 0),
  pagado_por_socio_id bigint references catalogo.socio (id),
  pedido_id bigint,
  guia_id bigint references operacion.guia (id),
  evento_id bigint not null references operacion.evento (id)
);

-- Vinculos diferidos de los libros de la 0007.
alter table operacion.cuenta_proveedor_mov add constraint cpm_compra_fk foreign key (compra_id) references operacion.compra (id);
alter table operacion.cuenta_proveedor_mov add constraint cpm_diferencia_fk foreign key (diferencia_id) references operacion.compra_diferencia (id);
alter table operacion.cuenta_socio_mov add constraint csm_diferencia_fk foreign key (diferencia_id) references operacion.compra_diferencia (id);
alter table operacion.partida_fuera_sociedad add constraint pfs_compra_fk foreign key (compra_id) references operacion.compra (id);

-- Solo estado en compra (los demas cambios son contramovimientos). T1 en los hechos.
do $$
declare t text;
begin
  foreach t in array array['compra_linea', 'lote', 'compra_recepcion', 'compra_diferencia', 'diferencia_asignacion', 'gasto'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
  end loop;
  -- compra_linea: solo piezas_recibidas pasa de null a un valor, una vez.
  drop trigger compra_linea_t1 on operacion.compra_linea;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'operacion' and c.relkind = 'r' loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
create function operacion.t_compra_linea_recibida() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.piezas_recibidas is not null or (to_jsonb(new) - 'piezas_recibidas') is distinct from (to_jsonb(old) - 'piezas_recibidas') then
    raise exception 'tabla de solo insercion: compra_linea solo registra una vez lo recibido' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger compra_linea_recibida before update on operacion.compra_linea for each row execute function operacion.t_compra_linea_recibida();
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lecturas de saldo (una cifra, una funcion)
-- ---------------------------------------------------------------------------
-- >0 a favor de la sociedad; <0 la sociedad le debe al proveedor.
create function operacion.saldo_proveedor(p_proveedor bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.cuenta_proveedor_mov where proveedor_id = p_proveedor $$;

create function operacion.saldo_socio(p_socio bigint, p_aplica_a text default null) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.cuenta_socio_mov where socio_id = p_socio and (p_aplica_a is null or aplica_a = p_aplica_a) $$;

-- Cuenta puente 1340: faltantes por asignar (sobrantes restan).
create function operacion.saldo_puente() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case d.tipo when 'faltante' then d.valor_cent else -d.valor_cent end), 0)::bigint
       - coalesce((select sum(a.monto_cent) from operacion.diferencia_asignacion a), 0)::bigint
  from operacion.compra_diferencia d
$$;

-- Resuelve un renglon de linea: {sku_id} o {modelo, sabor}.
create function operacion.resolver_sku(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_sku bigint; v_modelo bigint;
begin
  if p ? 'sku_id' then
    select s.id, s.modelo_id into v_sku, v_modelo from catalogo.sku s where s.id = (p->>'sku_id')::bigint;
  else
    select s.id, s.modelo_id into v_sku, v_modelo from catalogo.sku s join catalogo.modelo m on m.id = s.modelo_id join catalogo.sabor sa on sa.id = s.sabor_id
      where m.nombre_norm = catalogo.normalizar(p->>'modelo') and sa.nombre_norm = catalogo.normalizar(p->>'sabor');
  end if;
  if v_sku is null then raise exception 'SKU desconocido en el renglon' using errcode = '22023'; end if;
  return jsonb_build_object('sku_id', v_sku, 'modelo_id', v_modelo);
end $$;

-- ---------------------------------------------------------------------------
-- Escritura
-- ---------------------------------------------------------------------------
create function operacion.crear_compra(p_clave_idem text, p_proveedor text, p_lineas jsonb, p_guia_cent bigint default 0, p_seguro_cent bigint default 0,
                                       p_fecha date default null, p_destino text default 'bodega', p_ambito text default 'sociedad',
                                       p_guia_pagada_por text default null, p_socio_excedente text default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_prov bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_folio text; v_res jsonb;
  l jsonb; r jsonb; v_lista bigint; v_costo bigint; v_merc bigint := 0; v_exceso bigint := 0; v_g bigint; v_se bigint; v_n int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'crear_compra', 'p', p_proveedor, 'l', p_lineas, 'g', p_guia_cent, 's', p_seguro_cent, 'f', p_fecha,
                                         'd', p_destino, 'a', p_ambito, 'gp', p_guia_pagada_por, 'se', p_socio_excedente, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido: %', p_proveedor using errcode = '22023'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'la orden necesita renglones' using errcode = '22023'; end if;
  if p_guia_pagada_por is not null then select id into v_g from catalogo.socio where nombre = p_guia_pagada_por; if v_g is null then raise exception 'socio desconocido' using errcode = '22023'; end if; end if;
  if p_socio_excedente is not null then select id into v_se from catalogo.socio where nombre = p_socio_excedente; if v_se is null then raise exception 'socio desconocido' using errcode = '22023'; end if; end if;

  -- Primero se valida todo (costos y motivos) y se suma; despues se inserta.
  for l in select * from jsonb_array_elements(p_lineas) loop
    r := operacion.resolver_sku(l);
    v_lista := catalogo.costo_vigente(v_prov, (r->>'modelo_id')::bigint, v_fecha);
    v_costo := coalesce((l->>'costo_cent')::bigint, v_lista);
    if v_costo is null then raise exception 'sin costo vigente del proveedor para el modelo: indica el costo y el motivo' using errcode = '23514'; end if;
    if v_costo is distinct from v_lista and nullif(btrim(l->>'motivo_costo'), '') is null then
      raise exception 'el costo no es el de lista: el motivo es obligatorio' using errcode = '23514';
    end if;
    v_merc := v_merc + coalesce((l->>'facturadas')::int, (l->>'pagadas')::int) * v_costo;
    v_exceso := v_exceso + greatest((l->>'pagadas')::int - coalesce((l->>'facturadas')::int, (l->>'pagadas')::int), 0) * v_costo;
  end loop;
  if v_exceso > 0 and v_se is null then raise exception 'hay piezas pagadas de mas: indica el socio que pago de mas' using errcode = '23502'; end if;

  v_ev := operacion.crear_evento('compra_creada', v_fecha, p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'lineas', jsonb_array_length(p_lineas)));
  v_folio := seguridad.siguiente_folio('C');
  insert into operacion.compra (folio, proveedor_id, fecha_neg, destino, ambito, mercancia_cent, guia_cent, seguro_cent, total_cent, guia_pagada_por_socio_id, socio_excedente_id, nota, evento_id)
    values (v_folio, v_prov, v_fecha, p_destino, p_ambito, v_merc, p_guia_cent, p_seguro_cent, v_merc + p_guia_cent + p_seguro_cent, v_g, v_se, p_nota, v_ev)
    returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    r := operacion.resolver_sku(l);
    v_lista := catalogo.costo_vigente(v_prov, (r->>'modelo_id')::bigint, v_fecha);
    v_costo := coalesce((l->>'costo_cent')::bigint, v_lista);
    insert into operacion.compra_linea (compra_id, sku_id, modelo_id, piezas_pagadas, piezas_facturadas, costo_unit_cent, costo_lista_cent, motivo_costo)
      values (v_id, (r->>'sku_id')::bigint, (r->>'modelo_id')::bigint, (l->>'pagadas')::int, coalesce((l->>'facturadas')::int, (l->>'pagadas')::int), v_costo, v_lista, nullif(btrim(l->>'motivo_costo'), ''));
    v_n := v_n + 1;
  end loop;
  v_res := jsonb_build_object('compra_id', v_id, 'folio', v_folio, 'mercancia_cent', v_merc, 'total_cent', v_merc + p_guia_cent + p_seguro_cent, 'lineas', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Confirmar = el dinero se aplica a la cuenta con el proveedor (primero el saldo a favor). Karen exige pago completo antes.
create function operacion.confirmar_compra(p_clave_idem text, p_compra bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.compra; v_prov catalogo.proveedor; v_saldo bigint; v_cargo bigint; v_ev bigint; v_exceso bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'confirmar_compra', 'c', p_compra));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado <> 'borrador' then raise exception 'la compra % ya esta %', c.folio, c.estado using errcode = 'P0428'; end if;
  select * into v_prov from catalogo.proveedor where id = c.proveedor_id;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || c.proveedor_id, 0));
  v_saldo := operacion.saldo_proveedor(c.proveedor_id);
  -- Lo que carga a la cuenta: mercancia y seguro, y la guia solo si NO la pago un socio por su lado (en ese caso es reembolso al socio).
  v_cargo := c.mercancia_cent + c.seguro_cent + case when c.guia_pagada_por_socio_id is null then c.guia_cent else 0 end;
  if v_prov.modalidad = 'prepago_total' and v_saldo < v_cargo then
    raise exception 'Karen exige pago completo antes de confirmar: faltan % centavos entre saldo a favor y pagos', v_cargo - v_saldo using errcode = 'P0424';
  end if;
  v_ev := operacion.crear_evento('compra_confirmada', negocio.hoy(), p_clave_idem, jsonb_build_object('compra', c.folio, 'cargo_cent', v_cargo));
  if v_cargo > 0 then
    insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, compra_id, nota, evento_id)
      values (c.proveedor_id, negocio.hoy(), 'oc_aplicada', -v_cargo, c.id, 'Orden de compra ' || c.folio, v_ev);
  end if;
  if c.guia_pagada_por_socio_id is not null and c.guia_cent > 0 then
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
      values (c.guia_pagada_por_socio_id, c.guia_cent, 'Guia de la orden ' || c.folio, 'reembolsable', negocio.hoy(), 'compra', c.id, v_ev);
  end if;
  select coalesce(sum(greatest(piezas_pagadas - piezas_facturadas, 0) * costo_unit_cent), 0) into v_exceso from operacion.compra_linea where compra_id = c.id;
  if v_exceso > 0 then
    insert into operacion.partida_fuera_sociedad (socio_id, proveedor_id, concepto, piezas, monto_cent, fecha_neg, compra_id, evento_id)
      select c.socio_excedente_id, c.proveedor_id, 'Piezas pagadas de mas en ' || c.folio, sum(piezas_pagadas - piezas_facturadas)::int, v_exceso, negocio.hoy(), c.id, v_ev
      from operacion.compra_linea where compra_id = c.id and piezas_pagadas > piezas_facturadas;
  end if;
  update operacion.compra set estado = 'confirmada', confirmada_at = now() where id = c.id;
  perform operacion.avisar('oc_confirmada_dinero_aplicado', 'NT-014', 'oc_confirmada:' || c.id, 'F',
    'Orden de compra ' || c.folio || ' confirmada con dinero aplicado', 'compra', c.id,
    jsonb_build_object('folio', c.folio, 'proveedor', v_prov.nombre), null, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('compra_id', c.id, 'folio', c.folio, 'cargo_cent', v_cargo, 'saldo_antes_cent', v_saldo, 'saldo_despues_cent', v_saldo - v_cargo,
                              'por_pagar_cent', greatest(v_cargo - greatest(v_saldo, 0), 0), 'excedente_fuera_sociedad_cent', v_exceso);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Enviada / en trayecto / llego a Merida. Las guias de rastreo (puede haber varias) viven en operacion.guia.
create function operacion.marcar_compra_enviada(p_clave_idem text, p_compra bigint, p_guias jsonb default '[]'::jsonb, p_llegada_estimada date default null, p_fecha date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.compra; v_ev bigint; g jsonb; v_n int := 0; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_res jsonb; v_est text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'marcar_compra_enviada', 'c', p_compra, 'g', p_guias, 'l', p_llegada_estimada, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada') then raise exception 'la compra % esta %: solo una confirmada pasa a enviada', c.folio, c.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('compra_enviada', v_fecha, p_clave_idem, jsonb_build_object('compra', c.folio));
  for g in select * from jsonb_array_elements(p_guias) loop
    insert into operacion.guia (sentido, paqueteria, numero, compra_id, fecha_neg, llegada_estimada, evento_id)
      values ('entrada', g->>'paqueteria', g->>'numero', c.id, v_fecha, p_llegada_estimada, v_ev);
    perform operacion.avisar('guia_registrada_trayecto', 'NT-015', 'guia_trayecto:' || c.id || ':' || (g->>'numero'), 'F', 'Guia registrada de ' || c.folio || ': ' || (g->>'paqueteria') || ' ' || (g->>'numero'),
      'compra', c.id, jsonb_build_object('folio', c.folio), null, v_ev, true, array['software', 'telegram']);
    v_n := v_n + 1;
  end loop;
  v_est := case when v_n > 0 then 'en_trayecto' else 'enviada' end;
  update operacion.compra set estado = v_est, enviada_fecha = coalesce(enviada_fecha, v_fecha), llegada_estimada = coalesce(p_llegada_estimada, llegada_estimada) where id = c.id;
  v_res := jsonb_build_object('compra_id', c.id, 'estado', v_est, 'guias', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.registrar_guia_compra(p_clave_idem text, p_compra bigint, p_paqueteria text, p_numero text, p_llegada_estimada date default null, p_fecha date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.compra; v_ev bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_res jsonb; v_g bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_guia_compra', 'c', p_compra, 'p', p_paqueteria, 'n', p_numero, 'l', p_llegada_estimada, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto') then raise exception 'la compra % esta %: no admite guias de entrada', c.folio, c.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('guia_compra_registrada', v_fecha, p_clave_idem, jsonb_build_object('compra', c.folio, 'guia', p_numero));
  insert into operacion.guia (sentido, paqueteria, numero, compra_id, fecha_neg, llegada_estimada, evento_id) values ('entrada', p_paqueteria, p_numero, c.id, v_fecha, p_llegada_estimada, v_ev) returning id into v_g;
  update operacion.compra set estado = 'en_trayecto', enviada_fecha = coalesce(enviada_fecha, v_fecha), llegada_estimada = coalesce(p_llegada_estimada, llegada_estimada) where id = c.id;
  perform operacion.avisar('guia_registrada_trayecto', 'NT-015', 'guia_trayecto:' || c.id || ':' || p_numero, 'F', 'Guia registrada de ' || c.folio || ': ' || p_paqueteria || ' ' || p_numero,
    'compra', c.id, jsonb_build_object('folio', c.folio), null, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('guia_id', v_g, 'compra_id', c.id, 'estado', 'en_trayecto');
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.marcar_llego_merida(p_clave_idem text, p_compra bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.compra; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'marcar_llego_merida', 'c', p_compra));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto') then raise exception 'la compra % esta %', c.folio, c.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('compra_llego_merida', negocio.hoy(), p_clave_idem, jsonb_build_object('compra', c.folio));
  update operacion.compra set estado = 'llego_merida' where id = c.id;
  perform operacion.avisar('llegada_pendiente_confirmar', 'NT-016', 'llegada_pendiente:' || c.id, 'I', 'Llego a Merida ' || c.folio || ': falta confirmar las piezas recibidas',
    'compra', c.id, jsonb_build_object('folio', c.folio), null, v_ev, false, array['software', 'telegram']);
  v_res := jsonb_build_object('compra_id', c.id, 'estado', 'llego_merida');
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Recepcion confirmada por sabor. p_recibido = [{linea_id, sku_id | sabor, piezas}]. Las piezas SUMAN al inventario solo ahora.
create function operacion.recibir_compra(p_clave_idem text, p_compra bigint, p_recibido jsonb, p_contado_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.compra; v_ev bigint; v_at timestamptz := coalesce(p_contado_at, now()); v_fecha date; ln operacion.compra_linea; v_recib int; v_fact_total int;
  v_guia bigint; v_seguro bigint; v_guia_acum bigint := 0; v_seguro_acum bigint := 0; v_i int := 0; v_n_lineas int; v_merc bigint; v_puesto bigint; v_entrada bigint;
  v_lote bigint; rr record; v_acum bigint; v_val bigint; v_hecho int; v_mov bigint; v_dif bigint; v_ndif int := 0; v_res jsonb; v_total_recibido int := 0; v_valor_dif bigint := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'recibir_compra', 'c', p_compra, 'r', p_recibido, 'a', p_contado_at));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida') then raise exception 'la compra % esta %: no se puede recibir', c.folio, c.estado using errcode = 'P0428'; end if;
  if c.destino <> 'bodega' then raise exception 'una compra directa al cliente no entra al inventario' using errcode = 'P0428'; end if;
  if jsonb_typeof(p_recibido) <> 'array' then raise exception 'recepcion invalida' using errcode = '22023'; end if;
  v_fecha := negocio.fecha_neg(v_at);
  v_ev := operacion.crear_evento('compra_recibida', v_fecha, p_clave_idem, jsonb_build_object('compra', c.folio));

  create temporary table if not exists _recepcion_tmp (linea_id bigint, sku_id bigint, piezas int) on commit drop;
  delete from _recepcion_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _recepcion_tmp
  select (x->>'linea_id')::bigint,
         case when x ? 'sku_id' then (x->>'sku_id')::bigint
              else (select s.id from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id join operacion.compra_linea cl on cl.modelo_id = s.modelo_id
                    where cl.id = (x->>'linea_id')::bigint and sa.nombre_norm = catalogo.normalizar(x->>'sabor')) end,
         (x->>'piezas')::int
  from jsonb_array_elements(p_recibido) x;
  if exists (select 1 from _recepcion_tmp where sku_id is null or piezas is null or piezas <= 0) then raise exception 'renglon de recepcion invalido (sabor desconocido o piezas no positivas)' using errcode = '22023'; end if;
  if exists (select 1 from _recepcion_tmp t left join operacion.compra_linea l on l.id = t.linea_id and l.compra_id = c.id where l.id is null) then raise exception 'una linea no pertenece a la compra' using errcode = '22023'; end if;
  if exists (select 1 from _recepcion_tmp t join operacion.compra_linea l on l.id = t.linea_id join catalogo.sku s on s.id = t.sku_id where s.modelo_id <> l.modelo_id) then raise exception 'el sabor no corresponde al modelo de la linea' using errcode = '22023'; end if;

  select coalesce(sum(piezas_facturadas), 0), count(*) into v_fact_total, v_n_lineas from operacion.compra_linea where compra_id = c.id;
  for ln in select * from operacion.compra_linea where compra_id = c.id order by id loop
    v_i := v_i + 1;
    select coalesce(sum(piezas), 0) into v_recib from _recepcion_tmp where linea_id = ln.id;
    -- Guia y seguro se prorratean por piezas facturadas; la ultima linea absorbe el residuo.
    if v_i = v_n_lineas then v_guia := c.guia_cent - v_guia_acum; v_seguro := c.seguro_cent - v_seguro_acum;
    else v_guia := negocio.redondear_medio_arriba(c.guia_cent * ln.piezas_facturadas, v_fact_total); v_seguro := negocio.redondear_medio_arriba(c.seguro_cent * ln.piezas_facturadas, v_fact_total); end if;
    v_guia_acum := v_guia_acum + v_guia; v_seguro_acum := v_seguro_acum + v_seguro;
    v_merc := ln.piezas_facturadas * ln.costo_unit_cent;
    v_puesto := v_merc + v_guia + v_seguro;
    -- Valor que entra: el costo puesto de lo facturado en proporcion a lo recibido (exacto cuando coincide).
    v_entrada := case when v_recib = ln.piezas_facturadas then v_puesto else negocio.redondear_medio_arriba(v_puesto * v_recib, ln.piezas_facturadas) end;
    insert into operacion.lote (compra_linea_id, modelo_id, piezas_facturadas, piezas_entrada, costo_mercancia_cent, guia_prorrateada_cent, seguro_prorrateado_cent, valor_entrada_cent)
      values (ln.id, ln.modelo_id, ln.piezas_facturadas, v_recib, v_merc, v_guia, v_seguro, v_entrada) returning id into v_lote;
    -- Entrada por sabor, repartiendo el valor sin residuo.
    v_acum := 0; v_hecho := 0;
    for rr in select sku_id, sum(piezas)::int as piezas from _recepcion_tmp where linea_id = ln.id group by sku_id order by sku_id loop
      v_hecho := v_hecho + rr.piezas;
      v_val := case when v_hecho = v_recib then v_entrada - v_acum else negocio.redondear_medio_arriba(v_entrada * rr.piezas, v_recib) end;
      v_acum := v_acum + v_val;
      insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, lote_id, valor_cent, evento_id)
        values (v_fecha, v_at, rr.sku_id, ln.modelo_id, 'bodega_omar', 'entrada_compra', rr.piezas, v_lote, v_val, v_ev) returning id into v_mov;
      insert into operacion.compra_recepcion (compra_id, compra_linea_id, sku_id, piezas, movimiento_id, contado_at) values (c.id, ln.id, rr.sku_id, rr.piezas, v_mov, v_at);
    end loop;
    update operacion.compra_linea set piezas_recibidas = v_recib where id = ln.id;
    v_total_recibido := v_total_recibido + v_recib;
    if v_recib <> ln.piezas_facturadas then
      insert into operacion.compra_diferencia (compra_id, compra_linea_id, tipo, piezas, valor_cent, evento_id)
        values (c.id, ln.id, case when v_recib < ln.piezas_facturadas then 'faltante' else 'sobrante' end, abs(ln.piezas_facturadas - v_recib), abs(v_puesto - v_entrada), v_ev) returning id into v_dif;
      v_ndif := v_ndif + 1; v_valor_dif := v_valor_dif + abs(v_puesto - v_entrada);
      perform operacion.avisar('diferencia_recepcion_abierta', 'NT-017', 'diferencia_recepcion:' || v_dif, 'I',
        'Recepcion de ' || c.folio || ' con diferencia: ' || abs(ln.piezas_facturadas - v_recib) || ' pz ' || case when v_recib < ln.piezas_facturadas then 'faltantes' else 'sobrantes' end,
        'compra_diferencia', v_dif, jsonb_build_object('folio', c.folio, 'piezas', abs(ln.piezas_facturadas - v_recib)), null, v_ev, false, array['software', 'telegram']);
    end if;
  end loop;
  update operacion.compra set estado = 'recibida', recibida_fecha = v_fecha where id = c.id;
  perform operacion.resolver_avisos('llegada_pendiente_confirmar', 'compra', c.id);
  v_res := jsonb_build_object('compra_id', c.id, 'folio', c.folio, 'piezas_recibidas', v_total_recibido, 'piezas_facturadas', v_fact_total, 'diferencias', v_ndif, 'valor_diferencias_cent', v_valor_dif);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Asignar, reasignar o cancelar la asignacion de una diferencia. responsable = 'sociedad' deja la diferencia en la cuenta puente.
create function operacion.asignar_diferencia(p_clave_idem text, p_diferencia bigint, p_responsable text, p_socio text default null, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; d operacion.compra_diferencia; a operacion.diferencia_asignacion; v_ev bigint; v_socio bigint; v_prov bigint; v_cancelada int := 0; v_res jsonb; v_folio text; v_hay boolean;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'asignar_diferencia', 'd', p_diferencia, 'r', p_responsable, 's', p_socio, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if p_responsable not in ('sociedad', 'socio', 'proveedor') then raise exception 'responsable invalido' using errcode = '22023'; end if;
  select * into d from operacion.compra_diferencia where id = p_diferencia for update;
  if not found then raise exception 'diferencia desconocida' using errcode = '22023'; end if;
  if d.tipo = 'sobrante' and p_responsable <> 'sociedad' then raise exception 'un sobrante solo puede quedar en la cuenta puente' using errcode = '22023'; end if;
  select co.folio, co.proveedor_id into v_folio, v_prov from operacion.compra co where co.id = d.compra_id;
  if p_responsable = 'socio' then
    select id into v_socio from catalogo.socio where nombre = p_socio;
    if v_socio is null then raise exception 'indica el socio responsable' using errcode = '22023'; end if;
  end if;
  -- Asignacion vigente: positiva y sin renglon que la cancele.
  select * into a from operacion.diferencia_asignacion x where x.diferencia_id = d.id and x.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id) order by x.id desc limit 1;
  v_hay := found;
  if v_hay and ((p_responsable = 'socio' and a.responsable = 'socio' and a.socio_id = v_socio) or (p_responsable = 'proveedor' and a.responsable = 'proveedor')) then
    v_res := jsonb_build_object('diferencia_id', d.id, 'sin_cambio', true);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  v_ev := operacion.crear_evento('diferencia_asignada', negocio.hoy(), p_clave_idem, jsonb_build_object('diferencia', d.id, 'responsable', p_responsable, 'socio', p_socio));
  if v_hay then
    insert into operacion.diferencia_asignacion (diferencia_id, responsable, socio_id, proveedor_id, monto_cent, cancela_a, motivo, evento_id)
      values (d.id, a.responsable, a.socio_id, a.proveedor_id, -a.monto_cent, a.id, coalesce(p_motivo, 'reasignacion'), v_ev);
    if a.responsable = 'socio' then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, diferencia_id, nota, evento_id, reversa_de)
        select m.socio_id, negocio.hoy(), 'reversa', 'diferencia', -m.monto_cent, d.id, 'Se cancela la asignacion de la diferencia', v_ev, m.id
        from operacion.cuenta_socio_mov m where m.diferencia_id = d.id and m.concepto = 'diferencia_recepcion' and m.socio_id = a.socio_id
          and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id) order by m.id desc limit 1;
    else
      insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, compra_id, diferencia_id, nota, evento_id, reversa_de)
        select m.proveedor_id, negocio.hoy(), 'reversa', -m.monto_cent, m.compra_id, d.id, 'Se cancela el reclamo de la diferencia', v_ev, m.id
        from operacion.cuenta_proveedor_mov m where m.diferencia_id = d.id and m.concepto = 'reclamo_diferencia'
          and not exists (select 1 from operacion.cuenta_proveedor_mov r where r.reversa_de = m.id) order by m.id desc limit 1;
    end if;
    v_cancelada := 1;
  end if;
  if p_responsable = 'socio' then
    insert into operacion.diferencia_asignacion (diferencia_id, responsable, socio_id, monto_cent, motivo, evento_id) values (d.id, 'socio', v_socio, d.valor_cent, p_motivo, v_ev);
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, diferencia_id, nota, evento_id)
      values (v_socio, negocio.hoy(), 'diferencia_recepcion', 'diferencia', d.valor_cent, d.id, 'Faltante de ' || v_folio, v_ev);
  elsif p_responsable = 'proveedor' then
    insert into operacion.diferencia_asignacion (diferencia_id, responsable, proveedor_id, monto_cent, motivo, evento_id) values (d.id, 'proveedor', v_prov, d.valor_cent, p_motivo, v_ev);
    insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, compra_id, diferencia_id, nota, evento_id)
      values (v_prov, negocio.hoy(), 'reclamo_diferencia', d.valor_cent, d.compra_id, d.id, 'Reclamo por faltante de ' || v_folio, v_ev);
  end if;
  if p_responsable <> 'sociedad' then perform operacion.resolver_avisos('diferencia_recepcion_abierta', 'compra_diferencia', d.id); end if;
  v_res := jsonb_build_object('diferencia_id', d.id, 'responsable', p_responsable, 'valor_cent', d.valor_cent, 'cancelo_anterior', v_cancelada = 1, 'puente_cent', operacion.saldo_puente());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.cerrar_compra(p_clave_idem text, p_compra bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.compra; v_ev bigint; v_res jsonb; v_abiertas int;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_compra', 'c', p_compra));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado <> 'recibida' then raise exception 'solo una compra recibida se cierra (esta %)', c.estado using errcode = 'P0428'; end if;
  select count(*) into v_abiertas from operacion.compra_diferencia d
    where d.compra_id = c.id and not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = d.id and x.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id));
  if v_abiertas > 0 then raise exception 'quedan % diferencias sin responsable', v_abiertas using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('compra_cerrada', negocio.hoy(), p_clave_idem, jsonb_build_object('compra', c.folio));
  update operacion.compra set estado = 'cerrada' where id = c.id;
  v_res := jsonb_build_object('compra_id', c.id, 'estado', 'cerrada');
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Anular una compra que aun no se recibio: contramovimiento en la cuenta con el proveedor.
create function operacion.anular_compra(p_clave_idem text, p_compra bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c operacion.compra; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_compra', 'c', p_compra, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('borrador', 'confirmada', 'enviada', 'en_trayecto', 'llego_merida') then raise exception 'la compra % esta %: ya no se anula', c.folio, c.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('compra_anulada', negocio.hoy(), p_clave_idem, jsonb_build_object('compra', c.folio), null, null, null);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, compra_id, nota, evento_id, reversa_de)
    select m.proveedor_id, negocio.hoy(), 'reversa', -m.monto_cent, m.compra_id, 'Anulacion de ' || c.folio || ': ' || p_motivo, v_ev, m.id
    from operacion.cuenta_proveedor_mov m where m.compra_id = c.id and m.concepto = 'oc_aplicada' and not exists (select 1 from operacion.cuenta_proveedor_mov r where r.reversa_de = m.id);
  update operacion.compra set estado = 'anulada', nota = coalesce(nota || ' | ', '') || 'Anulada: ' || p_motivo where id = c.id;
  v_res := jsonb_build_object('compra_id', c.id, 'estado', 'anulada', 'saldo_proveedor_cent', operacion.saldo_proveedor(c.proveedor_id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- La reversa generica de F1 solo entiende movimientos de inventario: los eventos que mueven mas cosas tienen su propia anulacion.
create or replace function operacion.reversar_evento(p_clave_idem text, p_evento_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; m operacion.movimiento_inventario; v_res jsonb; v_n int := 0; v_tipo text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reversar_evento', 'e', p_evento_id, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la reversa exige motivo' using errcode = '23502'; end if;
  select tipo into v_tipo from operacion.evento where id = p_evento_id;
  if v_tipo is null then raise exception 'evento desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.evento where id = p_evento_id and reversa_de is not null) then raise exception 'una reversa no se reversa' using errcode = '22023'; end if;
  if v_tipo not like 'movimiento\_%' and v_tipo <> 'conteo_cerrado' then
    raise exception 'el evento % tiene su propia anulacion (anular_pedido, anular_pago, anular_compra...)', v_tipo using errcode = '22023';
  end if;
  v_ev := operacion.crear_evento('reversa', negocio.hoy(), p_clave_idem, jsonb_build_object('evento', p_evento_id), null, p_evento_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = p_evento_id order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  v_res := jsonb_build_object('evento_id', v_ev, 'movimientos', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
