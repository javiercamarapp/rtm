-- F2 / 0010: pedidos de clientes surtidos pieza por pieza, nota tipo invoice (texto, snapshot del cliente y hoja interna), correcciones enlazadas,
-- reservas, guias de salida, avisos del pedido, paquetes por hacer.
-- Reglas del dueno: se cobra solo lo SURTIDO; lo no surtido queda como entrega diferida o pieza que no llego (saldo a favor del cliente);
-- nada se descuenta, devenga ni genera renta antes de marcar enviado; la renta de bodega ($2 por pieza) se devenga al marcar el paquete como
-- enviado; Omar no despacha. El pedido directo de Isaac o Karen no pasa por Merida: no mueve inventario ni genera renta.
-- Una indicacion de un socio se ejecuta; los avisos (precio distinto del tabulador, venta a costo, menos de 20 piezas...) NO bloquean: se
-- aceptan con "Enviar de todos modos", que registra quien.

create table operacion.pedido (
  id bigint generated always as identity primary key,
  folio text not null unique,
  cliente_id bigint not null references catalogo.cliente (id),
  destino_id bigint references catalogo.cliente_destino (id),
  duenio_id bigint not null references catalogo.socio (id),
  fecha_neg date not null,
  origen text not null default 'bodega_omar' check (origen in ('bodega_omar', 'karen_directo', 'karen_via_isaac', 'isaac_directo', 'castores')),
  estado text not null default 'borrador' check (estado in ('borrador', 'confirmado', 'enviado', 'cancelado', 'anulado')),
  es_de_sociedad boolean not null default true,
  excepcion_minimo_motivo text,
  envio_cent bigint not null default 0 check (envio_cent >= 0),
  descuento_cent bigint not null default 0 check (descuento_cent >= 0),
  recargo_cent bigint not null default 0 check (recargo_cent >= 0),
  plazo_dias int check (plazo_dias is null or plazo_dias between 0 and 365),
  paqueteria text,
  nota text,
  empacado_at timestamptz,
  enviado_at timestamptz,
  fecha_envio date,
  entregado_at timestamptz,
  evento_id bigint not null references operacion.evento (id),
  evento_envio_id bigint references operacion.evento (id),
  creado_at timestamptz not null default now()
);
create index pedido_cliente_idx on operacion.pedido (cliente_id, id);
create index pedido_estado_idx on operacion.pedido (estado, id);

create table operacion.pedido_linea (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas_pedidas int not null check (piezas_pedidas > 0),
  piezas_surtidas int not null default 0 check (piezas_surtidas >= 0),
  precio_cent bigint not null check (precio_cent > 0),
  precio_tabulador_cent bigint,
  motivo_precio text,
  costo_unit_cent bigint,
  renta_cent bigint not null default 0 check (renta_cent >= 0),
  fecha_salida date,
  check (piezas_surtidas <= piezas_pedidas)
);
create index pedido_linea_pedido_idx on operacion.pedido_linea (pedido_id);

-- Lo que realmente salio, por sabor (el pedido se surte pieza por pieza y un sabor puede sustituir a otro del mismo modelo).
create table operacion.pedido_surtido (
  id bigint generated always as identity primary key,
  pedido_linea_id bigint not null references operacion.pedido_linea (id),
  sku_id bigint not null references catalogo.sku (id),
  piezas int not null check (piezas > 0),
  costo_valor_cent bigint not null check (costo_valor_cent >= 0),
  movimiento_id bigint references operacion.movimiento_inventario (id),
  evento_id bigint not null references operacion.evento (id)
);

create table operacion.pedido_cargo (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  concepto text not null check (concepto in ('envio_cobrado', 'descuento', 'recargo_credito')),
  monto_cent bigint not null check ((concepto = 'descuento' and monto_cent < 0) or (concepto <> 'descuento' and monto_cent > 0)),
  nota text,
  evento_id bigint not null references operacion.evento (id)
);

create table operacion.pedido_ajuste (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  tipo text not null check (tipo in ('pieza_no_llego', 'entrega_diferida', 'merma_aceptada', 'cortesia')),
  sku_id bigint not null references catalogo.sku (id),
  piezas int not null check (piezas > 0),
  monto_cent bigint not null default 0,
  evento_id bigint not null references operacion.evento (id)
);

-- Avisos no bloqueantes del pedido (se muestran en la pantalla del pedido, no en la campana).
create table operacion.pedido_aviso (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  pedido_linea_id bigint references operacion.pedido_linea (id),
  codigo text not null check (codigo in ('precio_distinto_tabulador', 'venta_bajo_costo', 'sin_precio_catalogo', 'minimo_piezas', 'existencia_insuficiente')),
  nt text,
  detalle text not null,
  creado_at timestamptz not null default now()
);
create table operacion.pedido_aviso_decision (
  aviso_id bigint primary key references operacion.pedido_aviso (id),
  decidido_por uuid,
  decidido_por_nombre text,
  decidido_at timestamptz not null default now(),
  evento_id bigint not null references operacion.evento (id)
);

-- Reservas ("comprometido"): sin efecto en kardex ni valor.
create table operacion.reserva (
  id bigint generated always as identity primary key,
  sku_id bigint not null references catalogo.sku (id),
  piezas int not null check (piezas > 0),
  origen_tipo text not null check (origen_tipo in ('pedido', 'toma_omar')),
  origen_id bigint not null,
  estado text not null default 'activa' check (estado in ('activa', 'aplicada', 'liberada')),
  creada_at timestamptz not null default now(),
  resuelta_at timestamptz
);
create index reserva_sku_idx on operacion.reserva (sku_id) where estado = 'activa';

create table operacion.nota (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  folio_documento text not null unique,
  tipo text not null check (tipo in ('original', 'correccion')),
  corrige_nota_id bigint references operacion.nota (id),
  motivo_correccion text,
  texto_whatsapp text not null,
  snapshot_cliente jsonb not null,
  snapshot_interno jsonb not null,
  ajustes jsonb not null default '{}'::jsonb,
  total_cent bigint not null,
  emitida_at timestamptz not null default now(),
  emitida_por uuid,
  evento_id bigint not null references operacion.evento (id),
  check ((tipo = 'original') = (corrige_nota_id is null)),
  check ((tipo = 'correccion') = (nullif(btrim(motivo_correccion), '') is not null))
);
create unique index nota_una_correccion_por_nota on operacion.nota (corrige_nota_id) where corrige_nota_id is not null;

-- El PDF (o el texto) se genera UNA vez y se guarda: reimprimir = entregar los mismos bytes.
create table operacion.nota_documento (
  id bigint generated always as identity primary key,
  nota_id bigint not null references operacion.nota (id),
  variante text not null check (variante in ('cliente_pdf', 'cliente_texto', 'interna_pdf')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  contenido bytea not null,
  creado_at timestamptz not null default now(),
  unique (nota_id, variante)
);

-- Vinculos diferidos.
alter table operacion.guia add constraint guia_pedido_fk foreign key (pedido_id) references operacion.pedido (id);
alter table operacion.gasto add constraint gasto_pedido_fk foreign key (pedido_id) references operacion.pedido (id);
alter table operacion.pago add constraint pago_pedido_destino_fk foreign key (pedido_destino_id) references operacion.pedido (id);
alter table operacion.pago_aplicacion add constraint pago_aplicacion_pedido_fk foreign key (pedido_id) references operacion.pedido (id);
alter table operacion.cuenta_proveedor_mov add constraint cpm_pedido_fk foreign key (pedido_id) references operacion.pedido (id);

-- T4: la linea es inmutable tras enviar; ninguna linea se borra.
create function operacion.t4_pedido_linea() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'las lineas de un pedido no se borran' using errcode = '42501'; end if;
  if old.fecha_salida is not null then raise exception 'la linea de un pedido enviado es inmutable (precio, piezas surtidas y costo)' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['piezas_surtidas', 'costo_unit_cent', 'renta_cent', 'fecha_salida']) is distinct from (to_jsonb(old) - array['piezas_surtidas', 'costo_unit_cent', 'renta_cent', 'fecha_salida']) then
    raise exception 'la linea de un pedido solo cambia al marcarlo enviado' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pedido_linea_t4 before update or delete on operacion.pedido_linea for each row execute function operacion.t4_pedido_linea();

-- Guia: el costo se fija una sola vez (null -> valor).
create function operacion.t_guia_costo() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'las guias no se borran' using errcode = '42501'; end if;
  if old.costo_cent is not null or (to_jsonb(new) - array['costo_cent', 'costeada_evento_id', 'pagada_por_socio_id']) is distinct from (to_jsonb(old) - array['costo_cent', 'costeada_evento_id', 'pagada_por_socio_id']) then
    raise exception 'la guia solo admite fijar su costo una vez' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guia_costo before update or delete on operacion.guia for each row execute function operacion.t_guia_costo();

do $$
declare t text;
begin
  foreach t in array array['pedido_surtido', 'pedido_cargo', 'pedido_ajuste', 'pedido_aviso', 'pedido_aviso_decision', 'nota', 'nota_documento'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
  end loop;
  revoke update on operacion.pedido_cargo, operacion.pedido_ajuste, operacion.pedido_aviso_decision, operacion.nota_documento from postgres;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'operacion' and c.relkind = 'r' loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;
