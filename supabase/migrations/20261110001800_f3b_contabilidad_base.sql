-- F3b / 0018: contabilidad de partida doble. Plan de cuentas completo, asientos generados por cada evento en la MISMA transaccion
-- (trigger de restriccion diferido al COMMIT), debe = haber por trigger diferido, cadena de hash, periodos con reversas en lugar de ediciones.
-- Principios:
--  * El asiento es una proyeccion DETERMINISTA de los hechos inmutables de un evento: `contabilidad.lineas_de_evento(evento)` es STABLE y se puede
--    recalcular en cualquier momento; `verificar_asiento` compara lo guardado con lo recalculado.
--  * Nada se actualiza ni se borra: corregir es una reversa enlazada (`reversa_asiento`) mas un asiento nuevo.
--  * El LLM nunca calcula dinero: todo sale de funciones SQL sobre centavos bigint.
-- Convencion de signos interna de `lineas_de_evento`: monto positivo = DEBE, negativo = HABER.

create schema if not exists contabilidad;

alter table seguridad.contador_folio drop constraint contador_folio_serie_check;
alter table seguridad.contador_folio add constraint contador_folio_serie_check check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E', 'PO', 'CR', 'A'));
insert into seguridad.contador_folio (serie) values ('A');

-- ---------------------------------------------------------------------------
-- Plan de cuentas (02 + 10b + 18 + 17). tipo: A activo, P pasivo, K capital, I ingreso, C costo, G gasto. naturaleza: D deudora, A acreedora.
-- ---------------------------------------------------------------------------
create table contabilidad.cuenta (
  codigo text primary key check (codigo ~ '^[0-9]{4}$'),
  nombre text not null,
  tipo text not null check (tipo in ('A', 'P', 'K', 'I', 'C', 'G')),
  naturaleza text not null check (naturaleza in ('D', 'A')),
  activa boolean not null default true,
  nota text
);

insert into contabilidad.cuenta (codigo, nombre, tipo, naturaleza, activa, nota) values
  ('1101', 'Efectivo físico de la sociedad', 'A', 'D', true, 'Caja física de la sociedad. Hoy el dinero vive sobre todo en cuentas de los socios (1150 y 1160).'),
  ('1102', 'Banco de la sociedad', 'A', 'D', false, 'Reservada: la sociedad no tiene cuenta bancaria propia todavía.'),
  ('1150', 'Fondos de la sociedad en poder de Angelo', 'A', 'D', true, 'Cobros de clientes que cayeron en su cuenta personal y no se han aplicado ni entregado.'),
  ('1160', 'Fondos de la sociedad en poder de Javier', 'A', 'D', true, 'Cobros de clientes que cayeron en su cuenta personal y no se han aplicado ni entregado.'),
  ('1170', 'Faltantes de recepción por cobrar a Angelo', 'A', 'D', true, 'Faltante de una recepción asignado como deuda del socio (adenda 29).'),
  ('1180', 'Faltantes de recepción por cobrar a Javier', 'A', 'D', true, 'Faltante de una recepción asignado como deuda del socio (adenda 29).'),
  ('1210', 'Clientes por cobrar', 'A', 'D', true, 'Auxiliar por cliente y por pedido.'),
  ('1220', 'Cuenta Omar: menudeo tomado de la bodega', 'A', 'D', true, 'Tomas de Omar a su precio, pendientes de compensar con su renta.'),
  ('1290', 'Estimación de cuentas incobrables', 'A', 'A', false, 'Solo por decisión explícita de un socio.'),
  ('1310', 'Inventario en bodega', 'A', 'D', true, 'Costo promedio ponderado móvil por modelo.'),
  ('1320', 'Mercancía en tránsito', 'A', 'D', true, 'Orden confirmada y aún no recibida en Mérida.'),
  ('1330', 'Mercancía por reasignar', 'A', 'D', false, 'Reservada para cruces entre clientes.'),
  ('1340', 'Diferencias de recepción por explicar', 'A', 'D', true, 'Puente: debe quedar en cero o asignado a un responsable.'),
  ('1410', 'Gastos pagados por anticipado', 'A', 'D', false, 'Anualidades (dominio) que se devengan cada mes.'),
  ('2110', 'Proveedor Isaac', 'P', 'A', true, 'Nunca se mezcla con Karen. Saldo deudor = saldo a favor con el proveedor.'),
  ('2120', 'Proveedor Karen', 'P', 'A', true, 'Nunca se mezcla con Isaac. Saldo deudor = saldo a favor con el proveedor.'),
  ('2190', 'Otros proveedores', 'P', 'A', false, 'Reservada.'),
  ('2210', 'Renta de bodega por pagar a Omar', 'P', 'A', true, 'Dos pesos por pieza enviada desde la bodega.'),
  ('2220', 'Otros acreedores', 'P', 'A', true, 'Guías y servicios devengados y no pagados.'),
  ('2310', 'Pagos de Angelo por cuenta de la sociedad', 'P', 'A', true, 'Gastos y guías que pagó de su bolsillo y se le reembolsan.'),
  ('2320', 'Pagos de Javier por cuenta de la sociedad', 'P', 'A', true, 'Gastos y guías que pagó de su bolsillo y se le reembolsan.'),
  ('2410', 'Saldos a favor de clientes', 'P', 'A', true, 'Pagos identificados todavía sin aplicar a un pedido.'),
  ('2420', 'Depósitos por identificar', 'P', 'A', true, 'Abonos sin nombre; deben quedar en cero tras asignarlos.'),
  ('3110', 'Aportaciones de Angelo', 'K', 'A', true, 'Capital: solo si el socio declara que invierte.'),
  ('3120', 'Aportaciones de Javier', 'K', 'A', true, 'Capital: solo si el socio declara que invierte.'),
  ('3210', 'Retiros de Angelo', 'K', 'D', true, 'Contra capital: retiros y devoluciones de capital.'),
  ('3220', 'Retiros de Javier', 'K', 'D', true, 'Contra capital: retiros y devoluciones de capital.'),
  ('3310', 'Utilidades acumuladas de Angelo', 'K', 'A', true, 'Utilidad repartible asignada en un cierre firmado.'),
  ('3320', 'Utilidades acumuladas de Javier', 'K', 'A', true, 'Utilidad repartible asignada en un cierre firmado.'),
  ('3900', 'Resultado del periodo ya asignado', 'K', 'A', true, 'Contrapartida de la utilidad asignada a los socios; el resultado no asignado se calcula de las cuentas 4 a 7.'),
  ('3990', 'Diferencia de cuadre inicial', 'K', 'A', true, 'Puente de las existencias y saldos de apertura; debe quedar en cero al firmar el cuadre.'),
  ('4110', 'Ventas de mayoreo', 'I', 'A', true, null),
  ('4120', 'Ventas de menudeo a Omar', 'I', 'A', true, 'Tomas de Omar a su precio de lista.'),
  ('4130', 'Ventas de menudeo al público', 'I', 'A', false, 'Reservada: menudeo aparte.'),
  ('4210', 'Descuentos y bonificaciones', 'I', 'D', true, null),
  ('4220', 'Devoluciones sobre ventas', 'I', 'D', true, null),
  ('4300', 'Envío cobrado a clientes', 'I', 'A', true, null),
  ('4910', 'Recargos por crédito', 'I', 'A', true, null),
  ('4920', 'Sobrantes de inventario', 'I', 'A', true, null),
  ('4930', 'Ganancia cambiaria', 'I', 'A', false, null),
  ('5100', 'Costo de la mercancía vendida', 'C', 'D', true, 'Promedio ponderado móvil, o costo real en pedidos directos.'),
  ('5110', 'Fletes y seguros de compra directa', 'C', 'D', true, 'Guía y seguro de pedidos que van del proveedor al cliente.'),
  ('5200', 'Merma y piezas falladas absorbidas', 'C', 'D', true, null),
  ('5300', 'Faltantes de inventario por conteo', 'C', 'D', true, null),
  ('5400', 'Ajustes con proveedores', 'C', 'D', true, 'Descuentos, errores de bodega y seguros de reenvío pactados con el proveedor (saldo acreedor = descuento).'),
  ('6110', 'Renta de bodega (Omar)', 'G', 'D', true, 'Gasto variable: dos pesos por pieza enviada.'),
  ('6120', 'Guías de salida desde bodega', 'G', 'D', true, null),
  ('6130', 'Ubers y mensajeros', 'G', 'D', true, null),
  ('6140', 'Comisión de terminal', 'G', 'D', true, null),
  ('6210', 'Nube y hosting', 'G', 'D', true, 'Costos del sistema: Vercel y Supabase.'),
  ('6220', 'IA y transcripción', 'G', 'D', true, 'Costos del sistema: OpenRouter y audio.'),
  ('6230', 'Software y suscripciones', 'G', 'D', true, 'Costos del sistema: Claude y herramientas.'),
  ('6240', 'Dominio y correo', 'G', 'D', true, 'Costos del sistema.'),
  ('6250', 'Costos de mantenimiento del sistema', 'G', 'D', true, 'Gasto de la sociedad pagado por Javier y reembolsable (doc 17). Los cargos de la plataforma sin cuenta propia caen aquí.'),
  ('6290', 'Otros gastos de administración', 'G', 'D', true, null),
  ('6310', 'Cuentas incobrables castigadas', 'G', 'D', false, null),
  ('7100', 'Pérdida cambiaria', 'G', 'D', false, null),
  ('7900', 'Ajuste por redondeo', 'G', 'D', true, 'Tolerancia máxima de un centavo por asiento; vigilada.');

-- Categoria de un gasto -> cuenta. `guia_envio` se decide por el origen del pedido (5110 directo, 6120 bodega).
create table contabilidad.categoria_gasto (
  categoria text primary key check (categoria = lower(btrim(categoria))),
  cuenta text not null references contabilidad.cuenta (codigo)
);
insert into contabilidad.categoria_gasto (categoria, cuenta) values
  ('vercel', '6210'), ('supabase', '6210'), ('nube', '6210'), ('hosting', '6210'),
  ('openrouter', '6220'), ('ia', '6220'), ('transcripcion', '6220'), ('audio', '6220'),
  ('claude', '6230'), ('software', '6230'), ('suscripcion', '6230'),
  ('dominio', '6240'), ('correo', '6240'),
  ('mantenimiento_sistema', '6250'), ('costos_sistema', '6250'),
  ('uber', '6130'), ('mensajeria', '6130'), ('terminal', '6140');

-- ---------------------------------------------------------------------------
-- Periodos: abierto -> preparado -> aprobado -> publicado. Solo avanzan; reabrir exige una reapertura con motivo.
-- ---------------------------------------------------------------------------
create table contabilidad.periodo (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('semana', 'mes')),
  ini date not null,
  fin date not null check (fin >= ini),
  estado text not null default 'abierto' check (estado in ('abierto', 'preparado', 'aprobado', 'publicado')),
  preparado_at timestamptz,
  aprobado_at timestamptz,
  aprobado_por uuid,
  publicado_at timestamptz,
  hash_cabecera text,
  unique (tipo, ini)
);

create table contabilidad.reapertura (
  id bigint generated always as identity primary key,
  periodo_id bigint not null references contabilidad.periodo (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  reabierto_por uuid,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default clock_timestamp()
);

create function contabilidad.t_periodo() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'los periodos no se borran' using errcode = '42501'; end if;
  if new.tipo <> old.tipo or new.ini <> old.ini or new.fin <> old.fin then raise exception 'las fechas de un periodo no cambian' using errcode = '42501'; end if;
  if new.estado = old.estado then return new; end if;
  if (old.estado, new.estado) in (('abierto', 'preparado'), ('preparado', 'abierto'), ('preparado', 'aprobado'), ('aprobado', 'publicado')) then return new; end if;
  if (old.estado, new.estado) in (('aprobado', 'abierto'), ('publicado', 'abierto')) and current_setting('rtm.reapertura', true) = old.id::text then return new; end if;
  raise exception 'transicion de periodo no permitida: % -> %', old.estado, new.estado using errcode = 'P0431';
end $$;
create trigger periodo_t before update or delete on contabilidad.periodo for each row execute function contabilidad.t_periodo();

-- ---------------------------------------------------------------------------
-- Asientos y lineas [AO]
-- ---------------------------------------------------------------------------
create table contabilidad.asiento (
  id bigint generated always as identity primary key,
  folio text not null unique,
  evento_id bigint not null unique references operacion.evento (id),
  fecha_neg date not null,
  fecha_contable date not null,
  periodo_semana_id bigint not null references contabilidad.periodo (id),
  periodo_mes_id bigint not null references contabilidad.periodo (id),
  periodo_afectado_id bigint references contabilidad.periodo (id),
  descripcion text not null,
  origen_tipo text not null,
  reversa_de bigint unique references contabilidad.asiento (id),
  motivo_reversa text,
  es_manual boolean not null default false,
  es_apertura boolean not null default false,
  propuesto_por uuid,
  confirmado_por uuid,
  canal text not null,
  mensaje_origen text,
  hash_anterior text not null,
  hash text not null,
  creado_at timestamptz not null default clock_timestamp(),
  check ((reversa_de is null) = (motivo_reversa is null))
);
create index asiento_fecha_idx on contabilidad.asiento (fecha_contable, id);
create index asiento_semana_idx on contabilidad.asiento (periodo_semana_id);

create table contabilidad.asiento_linea (
  asiento_id bigint not null references contabilidad.asiento (id),
  n int not null,
  cuenta text not null references contabilidad.cuenta (codigo),
  debe_cent bigint not null check (debe_cent >= 0),
  haber_cent bigint not null check (haber_cent >= 0),
  cliente_id bigint references catalogo.cliente (id),
  proveedor_id bigint references catalogo.proveedor (id),
  socio_id bigint references catalogo.socio (id),
  modelo_id bigint references catalogo.modelo (id),
  pedido_id bigint references operacion.pedido (id),
  nota text,
  primary key (asiento_id, n),
  check ((debe_cent = 0) <> (haber_cent = 0))
);
create index asiento_linea_cuenta_idx on contabilidad.asiento_linea (cuenta, asiento_id);
create index asiento_linea_cliente_idx on contabilidad.asiento_linea (cliente_id) where cliente_id is not null;
create index asiento_linea_proveedor_idx on contabilidad.asiento_linea (proveedor_id) where proveedor_id is not null;
create index asiento_linea_socio_idx on contabilidad.asiento_linea (socio_id) where socio_id is not null;

-- Corrida de comprobaciones (se guarda cada vez que se prepara un periodo o se corre a mano).
create table contabilidad.comprobacion (
  id bigint generated always as identity primary key,
  corrida_id bigint not null,
  codigo text not null,
  nombre text not null,
  bloqueante boolean not null,
  via_a_nombre text not null,
  via_a_cent bigint not null,
  via_b_nombre text not null,
  via_b_cent bigint not null,
  ok boolean not null,
  periodo_id bigint references contabilidad.periodo (id),
  corrida_at timestamptz not null default clock_timestamp()
);
create index comprobacion_corrida_idx on contabilidad.comprobacion (corrida_id, codigo);

do $$
declare t text;
begin
  foreach t in array array['asiento', 'asiento_linea', 'comprobacion', 'reapertura'] loop
    execute format('create trigger %I before update or delete on contabilidad.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on contabilidad.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on contabilidad.%I from postgres', t);
  end loop;
  foreach t in array array['cuenta', 'categoria_gasto', 'periodo'] loop
    execute format('create trigger %I before delete on contabilidad.%I for each row execute function seguridad.t1_solo_insercion()', t || '_nodel', t);
    execute format('create trigger %I before truncate on contabilidad.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_notr', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'contabilidad' and c.relkind = 'r' loop
    execute format('alter table contabilidad.%I enable row level security', t);
    execute format('alter table contabilidad.%I force row level security', t);
    execute format('revoke all on contabilidad.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema contabilidad from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ayudas de cuentas
-- ---------------------------------------------------------------------------
-- Cuenta de un socio: base + 0 (Angelo) o + 10 (Javier). Ej. cta_socio(s, 1150) = 1150 o 1160.
create function contabilidad.cta_socio(p_socio bigint, p_base int) returns text
language sql stable security definer set search_path = ''
as $$ select (p_base + case s.nombre when 'Angelo' then 0 when 'Javier' then 10 end)::text from catalogo.socio s where s.id = p_socio $$;

create function contabilidad.cta_proveedor(p_proveedor bigint) returns text
language sql stable security definer set search_path = ''
as $$ select case p.nombre when 'Isaac' then '2110' when 'Karen' then '2120' else '2190' end from catalogo.proveedor p where p.id = p_proveedor $$;

create function contabilidad.cuenta_gasto(p_categoria text, p_origen text) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when lower(btrim(p_categoria)) = 'guia_envio' then case when p_origen in ('isaac_directo', 'karen_directo', 'karen_via_isaac') then '5110' else '6120' end
    else coalesce((select c.cuenta from contabilidad.categoria_gasto c where c.categoria = lower(btrim(p_categoria))), '6290')
  end
$$;

-- ---------------------------------------------------------------------------
-- Las lineas de un evento (funcion pura sobre hechos inmutables). Devuelve debe/haber ya separados.
-- ---------------------------------------------------------------------------
create function contabilidad.lineas_de_evento(p_evento bigint)
returns table (cuenta text, debe_cent bigint, haber_cent bigint, cliente_id bigint, proveedor_id bigint, socio_id bigint, modelo_id bigint, pedido_id bigint, nota text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_tipo text; v_payload jsonb;
begin
  select e.tipo, e.payload into v_tipo, v_payload from operacion.evento e where e.id = p_evento;
  if v_tipo is null then return; end if;
  return query
  with
  mov as (
    select m.id, m.modelo_id, m.valor_cent, coalesce(o.tipo, m.tipo) as tipo_ef, coalesce(o.valor_cent, m.valor_cent) as valor_ef, m.reversa_de
    from operacion.movimiento_inventario m left join operacion.movimiento_inventario o on o.id = m.reversa_de where m.evento_id = p_evento),
  cpm as (
    select c.proveedor_id, c.monto_cent, coalesce(o.concepto, c.concepto) as conc
    from operacion.cuenta_proveedor_mov c left join operacion.cuenta_proveedor_mov o on o.id = c.reversa_de where c.evento_id = p_evento),
  csm as (
    select s.socio_id, s.monto_cent, s.aplica_a, coalesce(o.concepto, s.concepto) as conc, coalesce(oe.tipo, ee.tipo) as tipo_ev
    from operacion.cuenta_socio_mov s left join operacion.cuenta_socio_mov o on o.id = s.reversa_de
         left join operacion.evento oe on oe.id = o.evento_id join operacion.evento ee on ee.id = s.evento_id where s.evento_id = p_evento),
  apo as (select a.socio_id, a.monto_cent, a.clasificacion, a.ref_tipo from operacion.aportacion_socio a where a.evento_id = p_evento),
  gas as (
    select g.id, g.monto_cent, g.categoria, g.pagado_por_socio_id, pe.origen, g.guia_id, 1 as sgn
    from operacion.gasto g left join operacion.guia gu on gu.id = g.guia_id left join operacion.pedido pe on pe.id = coalesce(g.pedido_id, gu.pedido_id) where g.evento_id = p_evento
    union all
    select g.id, g.monto_cent, g.categoria, g.pagado_por_socio_id, pe.origen, g.guia_id, -1
    from operacion.gasto_anulacion an join operacion.gasto g on g.id = an.gasto_id left join operacion.guia gu on gu.id = g.guia_id left join operacion.pedido pe on pe.id = coalesce(g.pedido_id, gu.pedido_id)
    where an.evento_id = p_evento),
  pg as (
    select p.id, p.monto_cent, p.cliente_id, cd.titular_tipo from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id where p.evento_id = p_evento),
  pgi as (select i.pago_id, i.cliente_id, p.monto_cent from operacion.pago_identificacion i join operacion.pago p on p.id = i.pago_id where i.evento_id = p_evento),
  pga as (select x.pago_id, x.pedido_id, x.monto_cent, operacion.pago_cliente(x.pago_id) as cliente_id from operacion.pago_aplicacion x where x.evento_id = p_evento),
  pgn as (
    select p.id, p.monto_cent, operacion.pago_cliente(p.id) as cliente_id, cd.titular_tipo,
           (p.cliente_id is not null or exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id and i.evento_id < an.evento_id)) as identificado
    from operacion.pago_anulacion an join operacion.pago p on p.id = an.pago_id join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id where an.evento_id = p_evento),
  nt as (
    select n.pedido_id, pe.cliente_id,
           n.total_cent - coalesce(pn.total_cent, 0) as dt,
           (n.snapshot_cliente->>'subtotal_cent')::bigint - coalesce((pn.snapshot_cliente->>'subtotal_cent')::bigint, 0) as ds,
           (n.snapshot_cliente->>'envio_cent')::bigint - coalesce((pn.snapshot_cliente->>'envio_cent')::bigint, 0) as de,
           (n.snapshot_cliente->>'recargo_cent')::bigint - coalesce((pn.snapshot_cliente->>'recargo_cent')::bigint, 0) as dr,
           (n.snapshot_cliente->>'descuento_cent')::bigint - coalesce((pn.snapshot_cliente->>'descuento_cent')::bigint, 0) as dd
    from operacion.nota n join operacion.pedido pe on pe.id = n.pedido_id left join operacion.nota pn on pn.id = n.corrige_nota_id where n.evento_id = p_evento),
  anu as (
    select pe.id as pedido_id, pe.cliente_id, n.total_cent as dt,
           (n.snapshot_cliente->>'subtotal_cent')::bigint as ds, (n.snapshot_cliente->>'envio_cent')::bigint as de,
           (n.snapshot_cliente->>'recargo_cent')::bigint as dr, (n.snapshot_cliente->>'descuento_cent')::bigint as dd
    from operacion.pedido pe
    join lateral (select x.* from operacion.nota x where x.pedido_id = pe.id and x.evento_id < p_evento order by x.id desc limit 1) n on true
    where v_tipo = 'pedido_anulado' and pe.folio = v_payload->>'pedido'),
  dir as (
    select pe.id as pedido_id, pe.cliente_id, pe.origen, l.modelo_id, s.piezas, s.costo_valor_cent,
           case when s.evento_id = p_evento then 1 else -1 end as sgn,
           coalesce((catalogo.config_valor('seguro_reenvio_cent', pe.fecha_envio))::text::bigint, 0) as seg
    from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id
    where s.movimiento_id is null and (s.evento_id = p_evento or (v_tipo = 'pedido_anulado' and pe.folio = v_payload->>'pedido'))),
  ren as (select r.monto_cent from operacion.renta_devengo r where r.evento_id = p_evento),
  tom as (
    select t.piezas, t.precio_cent, 1 as sgn from operacion.toma_omar t join operacion.movimiento_inventario m on m.id = t.movimiento_id and m.evento_id = p_evento and m.tipo = 'salida_toma_omar'
    union all
    select t.piezas, t.precio_cent, -1 from operacion.toma_omar t join operacion.movimiento_inventario r on r.reversa_de = t.movimiento_id and r.evento_id = p_evento),
  lq as (select q.compensado_cent from operacion.liquidacion_omar q where q.evento_id = p_evento),
  po as (select p.monto_cent, p.sentido, p.socio_id from operacion.pago_omar p where p.evento_id = p_evento),
  lib as (
    select l.socio_id, l.monto_cent, coalesce(o.concepto, l.concepto) as ec from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de where l.evento_id = p_evento),
  pf as (select f.socio_id, f.proveedor_id, f.monto_cent from operacion.partida_fuera_sociedad f where f.evento_id = p_evento),
  lot as (
    select l.costo_puesto_cent, l.valor_entrada_cent, l.modelo_id from operacion.lote l join operacion.compra_linea cl on cl.id = l.compra_linea_id join operacion.compra c on c.id = cl.compra_id
    where v_tipo = 'compra_recibida' and c.folio = v_payload->>'compra'),
  l as (
    -- Inventario y su contrapartida.
    select '1310'::text as cuenta, m.valor_cent as d, null::bigint as cliente_id, null::bigint as proveedor_id, null::bigint as socio_id, m.modelo_id, null::bigint as pedido_id, 'Inventario'::text as nota from mov m
    union all
    select case m.tipo_ef when 'salida_pedido' then '5100' when 'salida_toma_omar' then '5100' when 'devolucion' then '5100' when 'merma' then '5200' when 'traspaso_puente' then '1340'
                         when 'ajuste_conteo' then case when m.valor_ef < 0 then '5300' else '4920' end
                         when 'entrada_compra' then case when v_tipo = 'compra_recibida' then null else '3990' end end,
           -m.valor_cent, null, null, null, m.modelo_id, null, 'Contrapartida del inventario'
    from mov m where not (m.tipo_ef = 'entrada_compra' and v_tipo = 'compra_recibida')
    union all
    select '1320', -x.puesto, null, null, null, null, null, 'Mercancía en tránsito que entra' from (select coalesce(sum(costo_puesto_cent), 0) as puesto from lot) x
    union all
    select '1340', x.dif, null, null, null, null, null, 'Diferencia de recepción' from (select coalesce(sum(costo_puesto_cent - valor_entrada_cent), 0) as dif from lot) x
    -- Cuenta con el proveedor.
    union all
    select contabilidad.cta_proveedor(c.proveedor_id), c.monto_cent, null, c.proveedor_id, null, null, null, 'Cuenta con el proveedor' from cpm c
    union all
    select case c.conc when 'oc_aplicada' then '1320' when 'pago_sociedad' then '1101' when 'ajuste' then '5400' when 'reclamo_diferencia' then '1340' end,
           -c.monto_cent, null, c.proveedor_id, null, null, null, 'Contrapartida del proveedor'
    from cpm c where c.conc in ('oc_aplicada', 'pago_sociedad', 'ajuste', 'reclamo_diferencia')
    -- Cuenta de los socios (fondos en poder y faltantes).
    union all
    select contabilidad.cta_socio(s.socio_id, case s.aplica_a when 'diferencia' then 1170 else 1150 end), s.monto_cent, null, null, s.socio_id, null, null, 'Cuenta del socio' from csm s
    union all
    select case when s.conc = 'diferencia_recepcion' then '1340' else '1101' end, -s.monto_cent, null, null, s.socio_id, null, null, 'Contrapartida del socio'
    from csm s where s.conc = 'diferencia_recepcion' or (s.conc = 'entrega_a_sociedad' and s.tipo_ev <> 'liquidacion_entre_socios')
    -- Aportaciones y gastos pagados por socios.
    union all
    select contabilidad.cta_socio(a.socio_id, case a.clasificacion when 'capital' then 3110 else 2310 end), -a.monto_cent, null, null, a.socio_id, null, null, 'Aportación o pago del socio' from apo a
    union all
    select case a.ref_tipo when 'compra' then '1320' else '1101' end, a.monto_cent, null, null, a.socio_id, null, null, 'Contrapartida de la aportación' from apo a where a.ref_tipo in ('compra', 'captura')
    union all
    select contabilidad.cuenta_gasto(g.categoria, g.origen), g.sgn * g.monto_cent, null, null, g.pagado_por_socio_id, null, null, 'Gasto: ' || g.categoria from gas g
    union all
    select case when g.categoria = 'guia_envio' then case g.origen when 'karen_directo' then '2120' when 'isaac_directo' then '2110' when 'karen_via_isaac' then '2110' else '2220' end else '1101' end,
           -g.sgn * g.monto_cent, null, null, null, null, null, 'Contrapartida del gasto'
    from gas g where g.pagado_por_socio_id is null
    -- Pagos de clientes.
    union all
    select case when p.cliente_id is not null then '2410' else '2420' end, -p.monto_cent, p.cliente_id, null, null, null, null, 'Pago recibido' from pg p
    union all
    select '1101', p.monto_cent, p.cliente_id, null, null, null, null, 'Pago en efectivo' from pg p where p.titular_tipo = 'efectivo'
    union all
    select '2420', i.monto_cent, null, null, null, null, null, 'Pago identificado' from pgi i
    union all
    select '2410', -i.monto_cent, i.cliente_id, null, null, null, null, 'Pago identificado' from pgi i
    union all
    select '2410', x.monto_cent, x.cliente_id, null, null, null, x.pedido_id, 'Pago aplicado al pedido' from pga x
    union all
    select '1210', -x.monto_cent, x.cliente_id, null, null, null, x.pedido_id, 'Pago aplicado al pedido' from pga x
    union all
    select case when p.identificado then '2410' else '2420' end, p.monto_cent, p.cliente_id, null, null, null, null, 'Pago anulado' from pgn p
    union all
    select '1101', -p.monto_cent, p.cliente_id, null, null, null, null, 'Pago en efectivo anulado' from pgn p where p.titular_tipo = 'efectivo'
    -- Venta, correccion de nota y anulacion de pedido.
    union all select '1210', n.dt, n.cliente_id, null, null, null, n.pedido_id, 'Total de la nota' from nt n
    union all select '4110', -n.ds, n.cliente_id, null, null, null, n.pedido_id, 'Ventas' from nt n
    union all select '4300', -n.de, n.cliente_id, null, null, null, n.pedido_id, 'Envío cobrado' from nt n
    union all select '4910', -n.dr, n.cliente_id, null, null, null, n.pedido_id, 'Recargo por crédito' from nt n
    union all select '4210', n.dd, n.cliente_id, null, null, null, n.pedido_id, 'Descuento' from nt n
    union all select '1210', -a.dt, a.cliente_id, null, null, null, a.pedido_id, 'Anulación del pedido' from anu a
    union all select '4110', a.ds, a.cliente_id, null, null, null, a.pedido_id, 'Anulación del pedido' from anu a
    union all select '4300', a.de, a.cliente_id, null, null, null, a.pedido_id, 'Anulación del pedido' from anu a
    union all select '4910', a.dr, a.cliente_id, null, null, null, a.pedido_id, 'Anulación del pedido' from anu a
    union all select '4210', -a.dd, a.cliente_id, null, null, null, a.pedido_id, 'Anulación del pedido' from anu a
    -- Costo de pedidos directos del proveedor al cliente (no pasan por la bodega).
    union all select '5100', d.sgn * (case d.origen when 'karen_via_isaac' then d.costo_valor_cent - d.seg * d.piezas else d.costo_valor_cent end), d.cliente_id, null, null, d.modelo_id, d.pedido_id, 'Costo del pedido directo' from dir d
    union all select case d.origen when 'isaac_directo' then '2110' else '2120' end, -d.sgn * (case d.origen when 'karen_via_isaac' then d.costo_valor_cent - d.seg * d.piezas else d.costo_valor_cent end),
                     null, case d.origen when 'isaac_directo' then catalogo.proveedor_id('Isaac') else catalogo.proveedor_id('Karen') end, null, d.modelo_id, d.pedido_id, 'Costo del pedido directo' from dir d
    union all select '5110', d.sgn * d.seg * d.piezas, d.cliente_id, null, null, d.modelo_id, d.pedido_id, 'Seguro de reenvío' from dir d where d.origen = 'karen_via_isaac'
    union all select '2110', -d.sgn * d.seg * d.piezas, null, catalogo.proveedor_id('Isaac'), null, d.modelo_id, d.pedido_id, 'Seguro de reenvío' from dir d where d.origen = 'karen_via_isaac'
    -- Renta de bodega (Omar).
    union all select '6110', r.monto_cent, null, null, null, null, null, 'Renta de bodega devengada' from ren r
    union all select '2210', -r.monto_cent, null, null, null, null, null, 'Renta de bodega devengada' from ren r
    -- Tomas de Omar, liquidacion y pagos.
    union all select '1220', t.sgn * t.piezas * t.precio_cent, null, null, null, null, null, 'Toma de Omar' from tom t where t.precio_cent is not null
    union all select '4120', -t.sgn * t.piezas * t.precio_cent, null, null, null, null, null, 'Toma de Omar' from tom t where t.precio_cent is not null
    union all select '2210', q.compensado_cent, null, null, null, null, null, 'Compensación semanal con Omar' from lq q
    union all select '1220', -q.compensado_cent, null, null, null, null, null, 'Compensación semanal con Omar' from lq q
    union all select case p.sentido when 'a_omar' then '2210' else '1220' end, case p.sentido when 'a_omar' then p.monto_cent else -p.monto_cent end, null, null, p.socio_id, null, null, 'Pago con Omar' from po p
    union all select '1101', p.monto_cent, null, null, null, null, null, 'Pago de Omar en efectivo de la sociedad' from po p where p.sentido = 'de_omar' and p.socio_id is null
    -- Libro de los socios (cascada, retiros y pagos).
    union all
    select contabilidad.cta_socio(b.socio_id, case b.ec when 'utilidad_asignada' then 3310 when 'pago_reembolso' then 2310 when 'pago_devolucion_aportacion' then 3210
                                                      when 'pago_utilidad' then 3310 when 'retiro' then 3210 when 'liquidacion_recibida' then 3310 end),
           -b.monto_cent, null, null, b.socio_id, null, null, 'Libro del socio: ' || b.ec from lib b
    union all select '3900', b.monto_cent, null, null, b.socio_id, null, null, 'Utilidad asignada' from lib b where b.ec = 'utilidad_asignada'
    union all
    select '1101', (select coalesce(sum(b.monto_cent), 0) from lib b where b.ec in ('pago_reembolso', 'pago_devolucion_aportacion', 'pago_utilidad', 'retiro'))
                 - (select coalesce(sum(s.monto_cent), 0) from csm s where s.conc = 'compensacion_reparto'), null, null, null, null, null, 'Pago a socios desde la caja de la sociedad'
    -- Aportacion pagada de mas: queda fuera de la sociedad.
    union all select contabilidad.cta_socio(f.socio_id, 3110), f.monto_cent, null, null, f.socio_id, null, null, 'Pagado de más fuera de la sociedad' from pf f
    union all select contabilidad.cta_proveedor(f.proveedor_id), -f.monto_cent, null, f.proveedor_id, f.socio_id, null, null, 'Pagado de más fuera de la sociedad' from pf f
    -- Asientos manuales (apertura, ajustes con motivo) y reversas de asientos.
    union all
    select x->>'cuenta', coalesce((x->>'debe_cent')::bigint, 0) - coalesce((x->>'haber_cent')::bigint, 0), (x->>'cliente_id')::bigint, (x->>'proveedor_id')::bigint, (x->>'socio_id')::bigint, null, null, x->>'nota'
    from jsonb_array_elements(case when v_tipo = 'asiento_manual' then v_payload->'lineas' else '[]'::jsonb end) x
    union all
    select al.cuenta, al.haber_cent - al.debe_cent, al.cliente_id, al.proveedor_id, al.socio_id, al.modelo_id, al.pedido_id, al.nota
    from contabilidad.asiento_linea al where v_tipo = 'reversa_asiento' and al.asiento_id = (v_payload->>'asiento_id')::bigint
  )
  select x.cuenta, greatest(x.s, 0)::bigint, greatest(-x.s, 0)::bigint, x.cliente_id, x.proveedor_id, x.socio_id, x.modelo_id, x.pedido_id, x.nota
  from (select l.cuenta, sum(l.d)::bigint as s, l.cliente_id, l.proveedor_id, l.socio_id, l.modelo_id, l.pedido_id, min(l.nota) as nota
        from l where l.cuenta is not null group by l.cuenta, l.cliente_id, l.proveedor_id, l.socio_id, l.modelo_id, l.pedido_id) x
  where x.s <> 0
  order by x.cuenta, x.cliente_id nulls first, x.proveedor_id nulls first, x.socio_id nulls first, x.modelo_id nulls first, x.pedido_id nulls first;
end $$;

-- ---------------------------------------------------------------------------
-- Periodos de un asiento
-- ---------------------------------------------------------------------------
create function contabilidad.asegurar_periodo(p_tipo text, p_fecha date) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_ini date; v_fin date; v_id bigint;
begin
  if p_tipo = 'semana' then v_ini := p_fecha - (extract(isodow from p_fecha)::int - 1); v_fin := v_ini + 6;
  else v_ini := date_trunc('month', p_fecha)::date; v_fin := (v_ini + interval '1 month' - interval '1 day')::date; end if;
  select id into v_id from contabilidad.periodo where tipo = p_tipo and ini = v_ini;
  if v_id is null then
    insert into contabilidad.periodo (tipo, ini, fin) values (p_tipo, v_ini, v_fin) on conflict (tipo, ini) do nothing returning id into v_id;
    if v_id is null then select id into v_id from contabilidad.periodo where tipo = p_tipo and ini = v_ini; end if;
  end if;
  return v_id;
end $$;

-- Periodo que recibe un asiento de la fecha dada: el que la contiene si esta abierto o preparado; si ya esta aprobado o publicado, el primer
-- periodo posterior abierto, con el original como `afectado` (el reporte viejo no cambia).
create function contabilidad.periodo_destino(p_tipo text, p_fecha date) returns table (periodo_id bigint, afectado_id bigint, fecha_contable date)
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint := contabilidad.asegurar_periodo(p_tipo, p_fecha); v_orig bigint := v_id; v_est text; v_fin date; v_ini date;
begin
  loop
    select estado, fin, ini into v_est, v_fin, v_ini from contabilidad.periodo where id = v_id;
    exit when v_est in ('abierto', 'preparado');
    v_id := contabilidad.asegurar_periodo(p_tipo, v_fin + 1);
  end loop;
  if v_est = 'preparado' then update contabilidad.periodo set estado = 'abierto', preparado_at = null where id = v_id; end if;
  periodo_id := v_id;
  afectado_id := case when v_id <> v_orig then v_orig end;
  fecha_contable := case when v_id <> v_orig then v_ini else p_fecha end;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Hash de auditoria y creacion del asiento
-- ---------------------------------------------------------------------------
create function contabilidad.texto_canonico(p_folio text, p_evento bigint, p_fecha_neg date, p_fecha_contable date, p_tipo text, p_reversa_de bigint, p_lineas jsonb) returns text
language sql immutable set search_path = ''
as $$ select concat_ws('|', p_folio, p_evento::text, p_fecha_neg::text, p_fecha_contable::text, p_tipo, coalesce(p_reversa_de::text, ''), p_lineas::text) $$;

create function contabilidad.hash_de(p_anterior text, p_texto text) returns text
language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(p_anterior || '|' || p_texto, 'UTF8')), 'hex') $$;

create function contabilidad.lineas_json(p_asiento bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('n', n, 'cuenta', cuenta, 'debe', debe_cent, 'haber', haber_cent, 'cliente', cliente_id, 'proveedor', proveedor_id, 'socio', socio_id,
                                               'modelo', modelo_id, 'pedido', pedido_id, 'nota', nota) order by n), '[]'::jsonb)
  from contabilidad.asiento_linea where asiento_id = p_asiento
$$;

create function contabilidad.asentar_evento(p_evento bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  e operacion.evento; v_lineas jsonb; v_d bigint; v_h bigint; v_ant text; v_folio text; v_id bigint; v_sem record; v_mes record; v_hash text; v_rev bigint;
begin
  select * into e from operacion.evento where id = p_evento;
  if not found then raise exception 'evento desconocido' using errcode = '22023'; end if;
  if exists (select 1 from contabilidad.asiento where evento_id = p_evento) then return null; end if;
  select jsonb_agg(jsonb_build_object('n', x.n, 'cuenta', x.cuenta, 'debe', x.debe_cent, 'haber', x.haber_cent, 'cliente', x.cliente_id, 'proveedor', x.proveedor_id, 'socio', x.socio_id,
                                      'modelo', x.modelo_id, 'pedido', x.pedido_id, 'nota', x.nota) order by x.n), coalesce(sum(x.debe_cent), 0), coalesce(sum(x.haber_cent), 0)
    into v_lineas, v_d, v_h
  from contabilidad.lineas_de_evento(p_evento) with ordinality as x(cuenta, debe_cent, haber_cent, cliente_id, proveedor_id, socio_id, modelo_id, pedido_id, nota, n);
  if v_lineas is null then return null; end if;
  if v_d <> v_h then
    raise exception 'el evento % (%) no cuadra: debe % contra haber %', e.folio, e.tipo, v_d, v_h using errcode = 'P0430';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('contabilidad:cadena', 0));
  select * into v_sem from contabilidad.periodo_destino('semana', e.fecha_neg);
  select * into v_mes from contabilidad.periodo_destino('mes', e.fecha_neg);
  select a.hash into v_ant from contabilidad.asiento a order by a.id desc limit 1;
  v_ant := coalesce(v_ant, repeat('0', 64));
  v_rev := case when e.tipo = 'reversa_asiento' then (e.payload->>'asiento_id')::bigint end;
  v_folio := seguridad.siguiente_folio('A');
  v_hash := contabilidad.hash_de(v_ant, contabilidad.texto_canonico(v_folio, e.id, e.fecha_neg, v_sem.fecha_contable, e.tipo, v_rev, v_lineas));
  insert into contabilidad.asiento (folio, evento_id, fecha_neg, fecha_contable, periodo_semana_id, periodo_mes_id, periodo_afectado_id, descripcion, origen_tipo, reversa_de, motivo_reversa,
                                    es_manual, es_apertura, propuesto_por, confirmado_por, canal, mensaje_origen, hash_anterior, hash)
    values (v_folio, e.id, e.fecha_neg, v_sem.fecha_contable, v_sem.periodo_id, v_mes.periodo_id, v_sem.afectado_id, e.folio || ' ' || replace(e.tipo, '_', ' '), e.tipo, v_rev,
            case when v_rev is not null then coalesce(e.motivo_reversa, e.payload->>'motivo', 'reversa') end,
            e.tipo = 'asiento_manual', coalesce((e.payload->>'apertura')::boolean, false), e.actor_id, e.actor_id, e.canal, e.mensaje_origen, v_ant, v_hash)
    returning id into v_id;
  insert into contabilidad.asiento_linea (asiento_id, n, cuenta, debe_cent, haber_cent, cliente_id, proveedor_id, socio_id, modelo_id, pedido_id, nota)
    select v_id, (x->>'n')::int, x->>'cuenta', (x->>'debe')::bigint, (x->>'haber')::bigint, (x->>'cliente')::bigint, (x->>'proveedor')::bigint, (x->>'socio')::bigint,
           (x->>'modelo')::bigint, (x->>'pedido')::bigint, x->>'nota'
    from jsonb_array_elements(v_lineas) x;
  return v_id;
end $$;

-- Trigger diferido al COMMIT: cuando el evento ya tiene todos sus hechos. Un evento sin efecto contable no genera asiento.
create function contabilidad.t_asentar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform contabilidad.asentar_evento(new.id);
  return null;
end $$;
create constraint trigger evento_asentar after insert on operacion.evento deferrable initially deferred for each row execute function contabilidad.t_asentar();

-- Σ debe = Σ haber por asiento, tambien diferido (cubre cualquier otro camino de escritura).
create function contabilidad.t_cuadre() returns trigger
language plpgsql set search_path = ''
as $$
declare v_d bigint; v_h bigint;
begin
  select coalesce(sum(debe_cent), 0), coalesce(sum(haber_cent), 0) into v_d, v_h from contabilidad.asiento_linea where asiento_id = new.asiento_id;
  if v_d <> v_h then raise exception 'asiento descuadrado: debe % contra haber %', v_d, v_h using errcode = 'P0430'; end if;
  return null;
end $$;
create constraint trigger asiento_linea_cuadre after insert on contabilidad.asiento_linea deferrable initially deferred for each row execute function contabilidad.t_cuadre();

-- Asienta de golpe lo que aun no tenga asiento (migracion que enlaza eventos existentes, y pruebas). Idempotente.
create function contabilidad.asentar_pendientes() returns int
language plpgsql security definer set search_path = ''
as $$
declare r record; v_n int := 0;
begin
  for r in select e.id from operacion.evento e where not exists (select 1 from contabilidad.asiento a where a.evento_id = e.id) order by e.id loop
    if contabilidad.asentar_evento(r.id) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Verificacion de un asiento (cuatro comprobaciones) y de la cadena
-- ---------------------------------------------------------------------------
create function contabilidad.hash_calculado(p_asiento bigint) returns text
language sql stable security definer set search_path = ''
as $$
  select contabilidad.hash_de(a.hash_anterior, contabilidad.texto_canonico(a.folio, a.evento_id, a.fecha_neg, a.fecha_contable, a.origen_tipo, a.reversa_de, contabilidad.lineas_json(a.id)))
  from contabilidad.asiento a where a.id = p_asiento
$$;

-- Primer asiento roto de la cadena (hash que no corresponde al contenido o enlace al anterior que no coincide); null si esta integra.
create function contabilidad.verificar_cadena() returns bigint
language sql stable security definer set search_path = ''
as $$
  select min(s.id) from (
    select a.id, a.hash, a.hash_anterior, lag(a.hash) over (order by a.id) as previo, contabilidad.hash_calculado(a.id) as recalculado
    from contabilidad.asiento a) s
  where s.hash <> s.recalculado or s.hash_anterior <> coalesce(s.previo, repeat('0', 64))
$$;

-- Lineas guardadas contra lineas recalculadas (determinismo). Manuales y reversas se recalculan con su payload / asiento original.
create function contabilidad.coincide_recalculo(p_asiento bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    (select cuenta, debe_cent, haber_cent, cliente_id, proveedor_id, socio_id, modelo_id, pedido_id from contabilidad.asiento_linea where asiento_id = p_asiento
     except select cuenta, debe_cent, haber_cent, cliente_id, proveedor_id, socio_id, modelo_id, pedido_id from contabilidad.lineas_de_evento((select evento_id from contabilidad.asiento where id = p_asiento)))
    union all
    (select cuenta, debe_cent, haber_cent, cliente_id, proveedor_id, socio_id, modelo_id, pedido_id from contabilidad.lineas_de_evento((select evento_id from contabilidad.asiento where id = p_asiento))
     except select cuenta, debe_cent, haber_cent, cliente_id, proveedor_id, socio_id, modelo_id, pedido_id from contabilidad.asiento_linea where asiento_id = p_asiento))
$$;

revoke execute on all functions in schema contabilidad from public, anon, authenticated;
alter default privileges in schema contabilidad revoke execute on functions from public, anon, authenticated;
