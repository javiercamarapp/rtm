-- F3c / 0023: saldos de apertura. La herramienta con la que el dueno cargara el cuadre inicial real (esta migracion NO carga ningun dato).
--  * Una sesion de apertura con fecha de corte y partidas por categoria (inventario por modelo y sabor con costo, caja y fondos por persona, cuentas por cobrar por cliente con fecha,
--    cuentas con cada proveedor, aportaciones, utilidades no repartidas, retiros previos y deuda de Angelo por las 12 piezas).
--  * La validacion calcula la identidad contable (activo = pasivo + capital) y deja la diferencia en la cuenta puente 3990. La vista previa y el ensayo NO escriben nada.
--  * Firman los dos socios sobre la huella del contenido; la segunda firma publica: un evento de inventario (movimientos 'apertura') y un asiento manual de apertura.
--  * La reversa deshace los dos. Los controles de contabilidad.reproducir_saldos reconocen el saldo de apertura como auxiliar.

-- ---------------------------------------------------------------------------
-- Cobro de una cuenta por cobrar de apertura: un pago de un cliente se aplica a su saldo de apertura (que vive en el libro, no en un pedido).
-- De solo insercion; se corrige con renglones contrarios enlazados. La anulacion del pago los reversa.
-- ---------------------------------------------------------------------------
create table operacion.pago_aplicacion_apertura (
  id bigint generated always as identity primary key,
  pago_id bigint not null references operacion.pago (id),
  cliente_id bigint not null references catalogo.cliente (id),
  monto_cent bigint not null check (monto_cent <> 0),
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint unique references operacion.pago_aplicacion_apertura (id),
  creado_at timestamptz not null default now(),
  check ((reversa_de is null) = (monto_cent > 0))
);
create index pago_aplicacion_apertura_pago_idx on operacion.pago_aplicacion_apertura (pago_id);
create index pago_aplicacion_apertura_cliente_idx on operacion.pago_aplicacion_apertura (cliente_id);
create trigger pago_aplicacion_apertura_t1 before update or delete on operacion.pago_aplicacion_apertura for each row execute function seguridad.t1_solo_insercion();
create trigger pago_aplicacion_apertura_t1t before truncate on operacion.pago_aplicacion_apertura for each statement execute function seguridad.t1_solo_insercion();
revoke delete, truncate on operacion.pago_aplicacion_apertura from postgres;
alter table operacion.pago_aplicacion_apertura enable row level security;
alter table operacion.pago_aplicacion_apertura force row level security;
revoke all on operacion.pago_aplicacion_apertura from public, anon, authenticated;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- El libro: el movimiento de inventario 'apertura' contra la cuenta puente 3990 (copia de lineas_de_evento con una sola rama nueva).
-- ---------------------------------------------------------------------------
create or replace function contabilidad.lineas_de_evento(p_evento bigint)
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
  pgap as (select x.pago_id, x.monto_cent, x.cliente_id from operacion.pago_aplicacion_apertura x where x.evento_id = p_evento),
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
  cas as (select a.monto_cent from operacion.diferencia_asignacion a where a.evento_id = p_evento and a.responsable = 'castigo'),
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
                         when 'entrada_compra' then case when v_tipo = 'compra_recibida' then null else '3990' end when 'apertura' then '3990' end,
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
    select '2410', x.monto_cent, x.cliente_id, null, null, null, null, 'Pago aplicado a la cuenta por cobrar de apertura' from pgap x
    union all
    select '1210', -x.monto_cent, x.cliente_id, null, null, null, null, 'Pago aplicado a la cuenta por cobrar de apertura' from pgap x
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
    -- Diferencia de recepcion castigada por la sociedad (la reposicion entra por el movimiento del kardex).
    union all select '5300', c.monto_cent, null, null, null, null, null, 'Faltante de recepcion castigado' from cas c
    union all select '1340', -c.monto_cent, null, null, null, null, null, 'Faltante de recepcion castigado' from cas c
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

alter table operacion.movimiento_inventario drop constraint movimiento_inventario_tipo_check;
alter table operacion.movimiento_inventario add constraint movimiento_inventario_tipo_check
  check (tipo in ('entrada_compra', 'salida_pedido', 'salida_toma_omar', 'devolucion', 'merma', 'ajuste_conteo', 'traspaso_puente', 'reversa', 'apertura'));

-- ---------------------------------------------------------------------------
-- Esquema y tablas
-- ---------------------------------------------------------------------------
create schema apertura;
revoke all on schema apertura from public, anon, authenticated;
grant usage on schema apertura to servidor;

create table apertura.categoria (
  codigo text primary key,
  paso int not null check (paso between 3 and 8),
  nombre text not null,
  sentido text not null check (sentido in ('D', 'H')),
  cuenta_fija text references contabilidad.cuenta (codigo),
  base_socio int,
  req_socio boolean not null default false,
  req_cliente boolean not null default false,
  req_proveedor boolean not null default false,
  req_fecha boolean not null default false,
  ayuda text not null,
  check ((cuenta_fija is not null) or (base_socio is not null) or req_proveedor)
);
insert into apertura.categoria (codigo, paso, nombre, sentido, cuenta_fija, base_socio, req_socio, req_cliente, req_proveedor, req_fecha, ayuda) values
  ('aportacion', 3, 'Aportación de capital de un socio', 'H', null, 3110, true, false, false, false, 'Capital que el socio declara haber puesto (cuenta 3110 o 3120).'),
  ('reembolso_socio', 3, 'Gasto pagado por un socio, pendiente de reembolso', 'H', null, 2310, true, false, false, false, 'Lo que la sociedad le debe por gastos que pagó de su bolsillo (2310 o 2320).'),
  ('inventario', 4, 'Inventario por modelo y sabor con costo', 'D', '1310', null, false, false, false, false, 'Piezas contadas al corte por su costo puesto unitario; entra al kárdex como movimiento de apertura.'),
  ('caja', 5, 'Efectivo de la sociedad por persona', 'D', '1101', null, true, false, false, false, 'Caja física que guarda cada persona (cuenta 1101 con la persona como dimensión).'),
  ('fondos_en_poder', 5, 'Fondos de la sociedad en poder de un socio', 'D', null, 1150, true, false, false, false, 'Cobros de clientes que cayeron en la cuenta personal de un socio y no se han entregado (1150 o 1160).'),
  ('cxc', 6, 'Cuenta por cobrar de un cliente', 'D', '1210', null, false, true, false, true, 'Saldo que el cliente debe al corte, con la fecha del adeudo.'),
  ('proveedor_debemos', 7, 'Lo que se debe a un proveedor', 'H', null, null, false, false, true, false, 'Saldo pendiente con Isaac o Karen (2110 o 2120).'),
  ('proveedor_a_favor', 7, 'Saldo a favor con un proveedor', 'D', null, null, false, false, true, false, 'Anticipo o crédito de la sociedad con Isaac o Karen (se muestra con signo negativo en la cuenta con el proveedor).'),
  ('utilidad_no_repartida', 8, 'Utilidad no repartida de un socio', 'H', null, 3310, true, false, false, false, 'Utilidad ya asignada al socio y no retirada (3310 o 3320).'),
  ('retiro_previo', 8, 'Retiro previo de un socio', 'D', null, 3210, true, false, false, false, 'Dinero que el socio ya retiró (contra capital, 3210 o 3220).'),
  ('deuda_faltante_socio', 8, 'Faltante de recepción por cobrar a un socio', 'D', null, 1170, true, false, false, false, 'Las 12 piezas de la compra inicial son deuda de Angelo (1170).');

create table apertura.sesion (
  id bigint generated always as identity primary key,
  fecha_corte date not null,
  estado text not null default 'borrador' check (estado in ('borrador', 'en_firma', 'firmada', 'reversada')),
  resolucion_puente text not null default 'mantener' check (resolucion_puente in ('mantener', 'capital_50_50')),
  justificacion text,
  nota text,
  creada_por uuid not null default auth.uid(),
  creada_at timestamptz not null default clock_timestamp(),
  evento_id bigint references operacion.evento (id),
  evento_inventario_id bigint references operacion.evento (id),
  hash_firmado text,
  firmada_at timestamptz,
  motivo_reversa text,
  reversada_at timestamptz,
  evento_reversa_id bigint references operacion.evento (id)
);
create unique index sesion_una_vigente on apertura.sesion ((1)) where estado <> 'reversada';

create table apertura.partida (
  id bigint generated always as identity primary key,
  sesion_id bigint not null references apertura.sesion (id),
  categoria text not null references apertura.categoria (codigo),
  cuenta text not null references contabilidad.cuenta (codigo),
  sentido text not null check (sentido in ('D', 'H')),
  monto_cent bigint not null check (monto_cent > 0),
  socio_id bigint references catalogo.socio (id),
  cliente_id bigint references catalogo.cliente (id),
  proveedor_id bigint references catalogo.proveedor (id),
  modelo_id bigint references catalogo.modelo (id),
  sku_id bigint references catalogo.sku (id),
  piezas int check (piezas > 0),
  costo_unit_cent bigint check (costo_unit_cent >= 0),
  fecha_ref date,
  descripcion text,
  creada_at timestamptz not null default clock_timestamp(),
  check ((categoria = 'inventario') = (sku_id is not null)),
  -- El valor del sabor es el monto total (verdad contable); el costo unitario es solo su promedio redondeado, para mostrarlo. Asi un costo promedio con subcentavo se carga al centavo.
  check (categoria <> 'inventario' or (piezas is not null and costo_unit_cent is not null and costo_unit_cent = round(monto_cent::numeric / piezas)))
);
create unique index partida_un_sku on apertura.partida (sesion_id, sku_id) where sku_id is not null;
create index partida_sesion_idx on apertura.partida (sesion_id, categoria);

create table apertura.firma (
  id bigint generated always as identity primary key,
  sesion_id bigint not null references apertura.sesion (id),
  socio_id bigint not null references catalogo.socio (id),
  usuario uuid not null default auth.uid(),
  hash text not null,
  firmada_at timestamptz not null default clock_timestamp(),
  retirada_at timestamptz
);
create unique index firma_una_vigente on apertura.firma (sesion_id, socio_id) where retirada_at is null;

-- Una sesion con firma o publicada no admite cambios en sus partidas: se retira la firma para editar.
create function apertura.t_partida() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_estado text;
begin
  select s.estado into v_estado from apertura.sesion s where s.id = coalesce(new.sesion_id, old.sesion_id);
  if v_estado <> 'borrador' then raise exception 'la sesión de apertura está en firma o firmada: retira la firma para editar' using errcode = 'P0440'; end if;
  return coalesce(new, old);
end $$;
create trigger partida_bloqueo before insert or update or delete on apertura.partida for each row execute function apertura.t_partida();
create trigger sesion_nodel before delete on apertura.sesion for each row execute function seguridad.t1_solo_insercion();
create trigger sesion_notr before truncate on apertura.sesion for each statement execute function seguridad.t1_solo_insercion();
create trigger firma_nodel before delete on apertura.firma for each row execute function seguridad.t1_solo_insercion();
create trigger firma_notr before truncate on apertura.firma for each statement execute function seguridad.t1_solo_insercion();

do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'apertura' and c.relkind = 'r' loop
    execute format('alter table apertura.%I enable row level security', t);
    execute format('alter table apertura.%I force row level security', t);
    execute format('revoke all on apertura.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema apertura from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------------
create function apertura.socio_actual() returns bigint
language sql stable security definer set search_path = ''
as $$ select s.id from catalogo.socio s join seguridad.usuario u on u.socio_nombre = s.nombre where u.id = auth.uid() and u.activo and u.rol = 'socio' $$;

-- Saldo de apertura de una cuenta en su naturaleza: solo cuenta el asiento ligado a una sesion de apertura FIRMADA por los dos socios (un asiento manual con la bandera
-- de apertura que no salga de esa firma no cuenta como auxiliar) y no reversado.
create function contabilidad.apertura_saldo(p_cuenta text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case c.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end), 0)::bigint
  from apertura.sesion s join contabilidad.asiento a on a.evento_id = s.evento_id and a.es_apertura
       join contabilidad.asiento_linea l on l.asiento_id = a.id join contabilidad.cuenta c on c.codigo = l.cuenta
  where s.estado = 'firmada' and l.cuenta = p_cuenta and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)
$$;

-- Lo que la apertura firmada aporta a la cuenta por cobrar (1210) de un cliente.
create function contabilidad.apertura_saldo_cliente(p_cliente bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.debe_cent - l.haber_cent), 0)::bigint
  from apertura.sesion s join contabilidad.asiento a on a.evento_id = s.evento_id and a.es_apertura
       join contabilidad.asiento_linea l on l.asiento_id = a.id
  where s.estado = 'firmada' and l.cuenta = '1210' and l.cliente_id = p_cliente and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)
$$;

-- ---------------------------------------------------------------------------
-- Los saldos de apertura entran a las lecturas de saldo (una cifra, una funcion): cliente, proveedor y socio los ven y las operaciones normales los saldan.
-- ---------------------------------------------------------------------------
-- Lo que falta cobrar de la apertura de un cliente (su saldo de apertura menos lo aplicado con pagos).
create function operacion.apertura_cxc_cliente(p_cliente bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select contabilidad.apertura_saldo_cliente(p_cliente) - coalesce((select sum(x.monto_cent) from operacion.pago_aplicacion_apertura x where x.cliente_id = p_cliente), 0)::bigint $$;

-- Partidas de cuenta por cobrar de la apertura con su fecha y lo cobrado hasta hoy: los pagos se asignan a la partida mas antigua primero.
create function operacion.cxc_apertura() returns table (cliente_id bigint, partida_id bigint, fecha_ref date, original_cent bigint, abonos_cent bigint, saldo_cent bigint)
language sql stable security definer set search_path = ''
as $$
  with p as (
    select pa.cliente_id, pa.id, pa.fecha_ref, pa.monto_cent,
           sum(pa.monto_cent) over (partition by pa.cliente_id order by pa.fecha_ref, pa.id) - pa.monto_cent as antes
    from apertura.partida pa join apertura.sesion s on s.id = pa.sesion_id
    where s.estado = 'firmada' and pa.categoria = 'cxc'),
  a as (select x.cliente_id, sum(x.monto_cent) as aplicado from operacion.pago_aplicacion_apertura x group by x.cliente_id)
  select p.cliente_id, p.id, p.fecha_ref, p.monto_cent,
         least(p.monto_cent, greatest(coalesce(a.aplicado, 0) - p.antes, 0))::bigint,
         (p.monto_cent - least(p.monto_cent, greatest(coalesce(a.aplicado, 0) - p.antes, 0)))::bigint
  from p left join a on a.cliente_id = p.cliente_id
$$;

-- Lo que de un pago aun no se aplico a ningun pedido ni a la apertura (0 si esta anulado o sin identificar).
create or replace function operacion.pago_disponible(p_pago bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id) or operacion.pago_cliente(p.id) is null then 0
              else p.monto_cent - coalesce((select sum(x.monto_cent) from operacion.pago_aplicacion x where x.pago_id = p.id), 0)
                                - coalesce((select sum(x.monto_cent) from operacion.pago_aplicacion_apertura x where x.pago_id = p.id), 0) end
  from operacion.pago p where p.id = p_pago
$$;

create or replace function operacion.saldo_cliente(p_cliente bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select (coalesce(sum(operacion.pedido_saldo(pe.id)), 0) + operacion.apertura_cxc_cliente(p_cliente))::bigint from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' $$;

-- >0 a favor de la sociedad; <0 la sociedad le debe al proveedor. Incluye el saldo de apertura (2110 o 2120 con signo contrario: lo que se debe es negativo).
create or replace function operacion.saldo_proveedor(p_proveedor bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select (coalesce(sum(monto_cent), 0) - contabilidad.apertura_saldo(contabilidad.cta_proveedor(p_proveedor)))::bigint from operacion.cuenta_proveedor_mov where proveedor_id = p_proveedor $$;

-- Lo que el socio debe a la sociedad: fondos en su poder (1150/1160) y faltantes (1170/1180), con lo que traiga la apertura.
create or replace function operacion.saldo_socio(p_socio bigint, p_aplica_a text default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (coalesce(sum(monto_cent), 0)
          + case when p_aplica_a is null or p_aplica_a = 'fondos' then contabilidad.apertura_saldo(contabilidad.cta_socio(p_socio, 1150)) else 0 end
          + case when p_aplica_a is null or p_aplica_a = 'diferencia' then contabilidad.apertura_saldo(contabilidad.cta_socio(p_socio, 1170)) else 0 end)::bigint
  from operacion.cuenta_socio_mov where socio_id = p_socio and (p_aplica_a is null or aplica_a = p_aplica_a)
$$;

-- Aportado por un socio: capital (3110/3120) y gastos pagados por reembolsar (2310/2320), con lo que traiga la apertura.
create or replace function operacion.aportado_socio(p_socio bigint, p_clasificacion text default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (coalesce(sum(monto_cent), 0)
          + case when p_clasificacion is null or p_clasificacion = 'capital' then contabilidad.apertura_saldo(contabilidad.cta_socio(p_socio, 3110)) else 0 end
          + case when p_clasificacion is null or p_clasificacion = 'reembolsable' then contabilidad.apertura_saldo(contabilidad.cta_socio(p_socio, 2310)) else 0 end)::bigint
  from operacion.aportacion_socio where socio_id = p_socio and (p_clasificacion is null or clasificacion = p_clasificacion)
$$;

-- Libro del socio por concepto efectivo (una reversa cuenta con el concepto de lo que deshace). La utilidad no repartida de la apertura es 'utilidad_asignada' y el retiro previo es 'retiro'.
create or replace function operacion.libro_socio(p_socio bigint, p_concepto text default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (coalesce(sum(l.monto_cent), 0)
          + case when p_concepto is null or p_concepto = 'utilidad_asignada' then contabilidad.apertura_saldo(contabilidad.cta_socio(p_socio, 3310)) else 0 end
          - case when p_concepto is null or p_concepto = 'retiro' then contabilidad.apertura_saldo(contabilidad.cta_socio(p_socio, 3210)) else 0 end)::bigint
  from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
  where l.socio_id = p_socio and (p_concepto is null or coalesce(o.concepto, l.concepto) = p_concepto)
$$;

create or replace function operacion.aplicar_fifo(p_cliente bigint, p_evento bigint) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare ped record; pg record; v_saldo bigint; v_disp bigint; v_monto bigint; v_total bigint := 0; v_pasada int; v_ap bigint;
begin
  -- Primero la cuenta por cobrar de apertura (es la deuda mas antigua). Un anticipo destinado a un pedido vigente no se toca.
  v_ap := operacion.apertura_cxc_cliente(p_cliente);
  if v_ap > 0 then
    for pg in
      select p.id from operacion.pago p
       where operacion.pago_cliente(p.id) = p_cliente
         and (p.pedido_destino_id is null or exists (select 1 from operacion.pedido d where d.id = p.pedido_destino_id and d.estado in ('cancelado', 'anulado')))
       order by p.fecha_neg, p.id
    loop
      exit when v_ap <= 0;
      v_disp := operacion.pago_disponible(pg.id);
      continue when v_disp <= 0;
      v_monto := least(v_disp, v_ap);
      insert into operacion.pago_aplicacion_apertura (pago_id, cliente_id, monto_cent, evento_id) values (pg.id, p_cliente, v_monto, p_evento);
      v_ap := v_ap - v_monto; v_total := v_total + v_monto;
    end loop;
  end if;
  for v_pasada in 1..2 loop
    for ped in select pe.id from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' order by pe.fecha_envio, pe.id loop
      v_saldo := operacion.pedido_saldo(ped.id);
      continue when v_saldo is null or v_saldo <= 0;
      for pg in
        select p.id from operacion.pago p
         where operacion.pago_cliente(p.id) = p_cliente
           and (p.pedido_destino_id is null or p.pedido_destino_id = ped.id
                or exists (select 1 from operacion.pedido d where d.id = p.pedido_destino_id and (d.estado in ('cancelado', 'anulado') or (v_pasada = 2 and d.estado = 'enviado'))))
         order by (p.pedido_destino_id = ped.id) desc nulls last, p.fecha_neg, p.id
      loop
        exit when v_saldo <= 0;
        v_disp := operacion.pago_disponible(pg.id);
        continue when v_disp <= 0;
        v_monto := least(v_disp, v_saldo);
        insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id) values (pg.id, ped.id, v_monto, p_evento);
        v_saldo := v_saldo - v_monto; v_total := v_total + v_monto;
      end loop;
    end loop;
  end loop;
  return v_total;
end $$;

create or replace function operacion.anular_pago(p_clave_idem text, p_pago bigint, p_motivo text) returns jsonb
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
  insert into operacion.pago_aplicacion_apertura (pago_id, cliente_id, monto_cent, evento_id, reversa_de)
    select a.pago_id, a.cliente_id, -a.monto_cent, v_ev, a.id from operacion.pago_aplicacion_apertura a where a.pago_id = p.id and a.reversa_de is null
      and not exists (select 1 from operacion.pago_aplicacion_apertura r where r.reversa_de = a.id);
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

-- Aplica un pago ya registrado (con saldo disponible) a la cuenta por cobrar de apertura de su cliente.
create function operacion.aplicar_pago_apertura(p_clave_idem text, p_pago bigint, p_monto_cent bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_cli bigint; v_saldo bigint; v_disp bigint; v_monto bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'aplicar_pago_apertura', 'pa', p_pago, 'm', p_monto_cent));
  if v_prev is not null then return v_prev; end if;
  v_cli := operacion.pago_cliente(p_pago);
  if v_cli is null then raise exception 'el pago esta sin identificar o no existe: identificalo primero' using errcode = 'P0425'; end if;
  v_saldo := operacion.apertura_cxc_cliente(v_cli); v_disp := operacion.pago_disponible(p_pago);
  v_monto := least(coalesce(p_monto_cent, v_disp), v_saldo, v_disp);
  if v_monto <= 0 then raise exception 'nada que aplicar: saldo de apertura del cliente % y disponible del pago %', v_saldo, v_disp using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('pago_aplicado', negocio.hoy(), p_clave_idem, jsonb_build_object('pago', p_pago, 'apertura', true, 'monto_cent', v_monto));
  insert into operacion.pago_aplicacion_apertura (pago_id, cliente_id, monto_cent, evento_id) values (p_pago, v_cli, v_monto, v_ev);
  v_res := jsonb_build_object('aplicado_cent', v_monto, 'saldo_apertura_cent', operacion.apertura_cxc_cliente(v_cli));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;
create function api.pago_aplicar_apertura(p_clave_idem text, p_pago bigint, p_monto_cent bigint default null) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.aplicar_pago_apertura(p_clave_idem, p_pago, p_monto_cent); end $$;
grant execute on function api.pago_aplicar_apertura(text, bigint, bigint) to authenticated;

-- Guardas de los asientos de apertura.
create or replace function contabilidad.registrar_asiento_manual(p_clave_idem text, p_fecha date, p_motivo text, p_lineas jsonb, p_apertura boolean default false, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_d bigint; v_h bigint; x jsonb; v_res jsonb; v_asiento bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_asiento_manual', 'f', p_fecha, 'm', p_motivo, 'l', p_lineas, 'a', p_apertura));
  if v_prev is not null then return v_prev; end if;
  -- Un asiento de apertura solo nace de la firma de los dos socios (apertura.publicar); por aqui no se puede marcar como apertura.
  if coalesce(p_apertura, false) then raise exception 'un asiento de apertura solo sale de la firma de los dos socios en la herramienta de apertura' using errcode = 'P0428'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'el asiento manual exige motivo' using errcode = '23502'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then raise exception 'el asiento necesita al menos dos líneas' using errcode = '22023'; end if;
  v_d := 0; v_h := 0;
  for x in select * from jsonb_array_elements(p_lineas) loop
    if not exists (select 1 from contabilidad.cuenta c where c.codigo = x->>'cuenta' and c.activa) then raise exception 'cuenta desconocida o inactiva: %', x->>'cuenta' using errcode = '22023'; end if;
    if (coalesce((x->>'debe_cent')::bigint, 0) > 0) = (coalesce((x->>'haber_cent')::bigint, 0) > 0) or coalesce((x->>'debe_cent')::bigint, 0) < 0 or coalesce((x->>'haber_cent')::bigint, 0) < 0 then
      raise exception 'cada línea lleva debe o haber (uno solo, positivo)' using errcode = '23514';
    end if;
    v_d := v_d + coalesce((x->>'debe_cent')::bigint, 0); v_h := v_h + coalesce((x->>'haber_cent')::bigint, 0);
  end loop;
  if v_d <> v_h then raise exception 'el asiento no cuadra: debe % contra haber %', v_d, v_h using errcode = 'P0430'; end if;
  v_ev := operacion.crear_evento('asiento_manual', coalesce(p_fecha, negocio.hoy()), p_clave_idem, jsonb_build_object('motivo', p_motivo, 'lineas', p_lineas, 'apertura', p_apertura), p_mensaje_origen);
  v_res := jsonb_build_object('evento_id', v_ev, 'debe_cent', v_d, 'haber_cent', v_h);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function contabilidad.reversar_asiento(p_clave_idem text, p_asiento bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; a contabilidad.asiento; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reversar_asiento', 'a', p_asiento, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la reversa exige motivo' using errcode = '23502'; end if;
  select * into a from contabilidad.asiento where id = p_asiento;
  if not found then raise exception 'asiento desconocido' using errcode = '22023'; end if;
  -- El asiento de una apertura firmada se deshace solo con la reversa de la apertura (que reversa tambien el kardex); por la reversa generica quedaria a medias.
  if a.es_apertura and coalesce(current_setting('rtm.reversa_apertura', true), '') <> 'si' then raise exception 'el asiento de una apertura solo se revierte con la reversa de la apertura' using errcode = 'P0428'; end if;
  if not a.es_manual then raise exception 'solo se reversan asientos manuales: un asiento de negocio se corrige anulando la operación que lo generó' using errcode = 'P0428'; end if;
  if a.reversa_de is not null or exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id) then raise exception 'ese asiento ya está reversado' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('reversa_asiento', negocio.hoy(), p_clave_idem, jsonb_build_object('asiento_id', a.id, 'motivo', p_motivo), null, a.evento_id, p_motivo);
  v_res := jsonb_build_object('evento_id', v_ev, 'asiento', a.folio);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Lecturas para la web con los saldos de apertura.
create or replace function api.cuentas_por_cobrar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_ap jsonb; v_base jsonb; v_hoy date := negocio.hoy(); v_bp int := coalesce((catalogo.config_valor('recargo_credito_bp'))::text::int, 1000);
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(jsonb_agg(x order by (x->>'dias')::int desc), '[]'::jsonb) into v_filas from (
    select jsonb_build_object(
      'pedido_id', pe.id, 'folio', pe.folio, 'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'fecha_envio', pe.fecha_envio, 'plazo_dias', pe.plazo_dias,
      'vence', case when pe.plazo_dias is null then null else pe.fecha_envio + pe.plazo_dias end, 'original_cent', operacion.pedido_cobrado(pe.id), 'abonos_cent', operacion.pedido_aplicado(pe.id),
      'saldo_cent', operacion.pedido_saldo(pe.id), 'dias', v_hoy - pe.fecha_envio,
      'dias_atraso', case when pe.plazo_dias is null then null else greatest(v_hoy - (pe.fecha_envio + pe.plazo_dias), 0) end,
      'estado', case when operacion.pedido_saldo(pe.id) < 0 then 'saldo_a_favor' when pe.plazo_dias is null then 'sin_plazo' when v_hoy > pe.fecha_envio + pe.plazo_dias then 'vencido'
                     when v_hoy >= pe.fecha_envio + pe.plazo_dias - 2 then 'por_vencer' else 'al_corriente' end,
      'cubeta', case when v_hoy - pe.fecha_envio <= 7 then '0_7' when v_hoy - pe.fecha_envio <= 14 then '8_14' when v_hoy - pe.fecha_envio <= 30 then '15_30' else 'mas_30' end,
      'recargo_cent', coalesce((select (n.snapshot_cliente->>'recargo_cent')::bigint from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0),
      'recargo_sugerido_cent', coalesce((select ((n.snapshot_cliente->>'subtotal_cent')::bigint * v_bp + 9999) / 10000 from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0)) as x
    from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id
    where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) <> 0) q;
  -- Cuentas por cobrar de la apertura: una fila por partida con su fecha; entran a los totales, la antiguedad y la concentracion por cliente.
  select coalesce(jsonb_agg(jsonb_build_object('partida_id', a.partida_id, 'cliente_id', a.cliente_id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'fecha_ref', a.fecha_ref, 'original_cent', a.original_cent,
           'abonos_cent', a.abonos_cent, 'saldo_cent', a.saldo_cent, 'dias', v_hoy - a.fecha_ref) order by a.fecha_ref, a.partida_id), '[]'::jsonb) into v_ap
    from operacion.cxc_apertura() a join catalogo.cliente c on c.id = a.cliente_id join catalogo.socio s on s.id = c.duenio_id where a.saldo_cent <> 0;
  v_base := v_filas || coalesce((select jsonb_agg(jsonb_build_object('pedido_id', null, 'cliente_id', x->'cliente_id', 'cliente', x->'cliente', 'duenio', x->'duenio', 'saldo_cent', x->'saldo_cent',
                                    'estado', 'sin_plazo', 'dias', x->'dias', 'vence', null,
                                    'cubeta', case when (x->>'dias')::int <= 7 then '0_7' when (x->>'dias')::int <= 14 then '8_14' when (x->>'dias')::int <= 30 then '15_30' else 'mas_30' end)) from jsonb_array_elements(v_ap) x), '[]'::jsonb);
  return jsonb_build_object(
    'hoy', v_hoy, 'filas', v_filas, 'apertura', v_ap, 'recargo_bp', v_bp,
    'total_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) from jsonb_array_elements(v_base) f),
    'vencido_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) from jsonb_array_elements(v_base) f),
    'antiguedad_cent', (select jsonb_object_agg(k, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_base) f where f->>'cubeta' = k and (f->>'saldo_cent')::bigint > 0), 0)) from unnest(array['0_7', '8_14', '15_30', 'mas_30']) k),
    'por_duenio_cent', (select coalesce(jsonb_object_agg(d, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_base) f where f->>'duenio' = d and (f->>'saldo_cent')::bigint > 0), 0)), '{}'::jsonb) from unnest(array['Angelo', 'Javier']) d),
    'por_cliente', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', k.cid, 'cliente', k.cliente, 'duenio', k.duenio, 'saldo_cent', k.saldo, 'vencido_cent', k.vencido, 'pedidos', k.n, 'dias_max', k.dias_max,
                  'proximo_vence', k.vence) order by k.saldo desc, k.cliente)
      from (select (f->>'cliente_id')::bigint as cid, f->>'cliente' as cliente, f->>'duenio' as duenio,
                   sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0) as saldo,
                   coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) as vencido,
                   count(*) filter (where (f->>'saldo_cent')::bigint > 0)::int as n, max((f->>'dias')::int) as dias_max,
                   min((f->>'vence')::date) filter (where (f->>'saldo_cent')::bigint > 0) as vence
            from jsonb_array_elements(v_base) f group by 1, 2, 3 having coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) > 0) k), '[]'::jsonb),
    'saldos_a_favor', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'monto_cent', operacion.saldo_favor_cliente(c.id)) order by c.nombre_canonico)
      from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where operacion.saldo_favor_cliente(c.id) > 0), '[]'::jsonb),
    'pagos_sin_identificar', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha_neg', p.fecha_neg, 'monto_cent', p.monto_cent, 'cuenta', cd.nombre) order by p.id)
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id
      where p.identificacion = 'sin_identificar' and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id) and not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)), '[]'::jsonb),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'deuda_cent', operacion.saldo_socio(s.id), 'fondos_cent', operacion.saldo_socio(s.id, 'fondos'), 'diferencia_cent', operacion.saldo_socio(s.id, 'diferencia'),
        'dias_fondos', operacion.dias_fondos_en_poder(s.id),
        'alerta_fondos', coalesce(operacion.dias_fondos_en_poder(s.id) > (catalogo.config_valor('fondos_alerta_dias'))::text::int, false)) order by s.nombre) from catalogo.socio s), '[]'::jsonb));
end $$;

create or replace function api.cxc_cliente(p_cliente bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'cliente', (select jsonb_build_object('id', c.id, 'nombre', c.nombre_canonico, 'duenio', s.nombre) from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.id = p_cliente),
    'saldo_cent', operacion.saldo_cliente(p_cliente), 'saldo_favor_cent', operacion.saldo_favor_cliente(p_cliente),
    'apertura', coalesce((select jsonb_agg(jsonb_build_object('partida_id', a.partida_id, 'fecha_ref', a.fecha_ref, 'original_cent', a.original_cent, 'abonos_cent', a.abonos_cent, 'saldo_cent', a.saldo_cent) order by a.fecha_ref, a.partida_id)
                           from operacion.cxc_apertura() a where a.cliente_id = p_cliente), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', pe.id, 'folio', pe.folio, 'estado', pe.estado, 'fecha_envio', pe.fecha_envio, 'cobrado_cent', operacion.pedido_cobrado(pe.id), 'saldo_cent', operacion.pedido_saldo(pe.id),
        'notas', (select jsonb_agg(n.folio_documento order by n.id) from operacion.nota n where n.pedido_id = pe.id)) order by pe.id desc) from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado in ('enviado', 'anulado')), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha_neg', p.fecha_neg, 'monto_cent', p.monto_cent, 'cuenta', cd.nombre, 'disponible_cent', operacion.pago_disponible(p.id),
        'anulado', exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)) || operacion.evento_info(p.evento_id) order by p.id desc)
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id where operacion.pago_cliente(p.id) = p_cliente), '[]'::jsonb));
end $$;

create or replace function api.proveedor_cuenta(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov catalogo.proveedor; v_saldo bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into v_prov from catalogo.proveedor where id = catalogo.proveedor_id(p_proveedor);
  if not found then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_saldo := operacion.saldo_proveedor(v_prov.id);
  return jsonb_build_object('id', v_prov.id, 'proveedor', v_prov.nombre, 'modalidad', v_prov.modalidad, 'saldo_cent', v_saldo,
    'etiqueta', case when v_saldo > 0 then 'A favor' when v_saldo < 0 then 'Se debe' else 'Saldo cero' end,
    'movimientos', coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
        select jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'monto_cent', m.monto_cent, 'saldo_corrido_cent', sum(m.monto_cent) over (order by m.id),
          'compra', (select folio from operacion.compra where id = m.compra_id), 'pago', (select folio from operacion.pago where id = m.pago_id), 'cliente', (select nombre_canonico from catalogo.cliente where id = m.cliente_id),
          'cuenta_origen', (select nombre from operacion.cuenta_dinero where id = m.cuenta_origen_id), 'nota', m.nota) || operacion.evento_info(m.evento_id) as x
        from (select c.id, c.fecha_neg, c.concepto, c.monto_cent, c.compra_id, c.pago_id, c.cliente_id, c.cuenta_origen_id, c.nota, c.evento_id from operacion.cuenta_proveedor_mov c where c.proveedor_id = v_prov.id
              union all
              select 0::bigint, se.fecha_corte, 'apertura', (-contabilidad.apertura_saldo(contabilidad.cta_proveedor(v_prov.id)))::bigint, null::bigint, null::bigint, null::bigint, null::bigint, 'Saldo de apertura', se.evento_id
                from apertura.sesion se where se.estado = 'firmada' and se.evento_id is not null and contabilidad.apertura_saldo(contabilidad.cta_proveedor(v_prov.id)) <> 0) m) q), '[]'::jsonb),
    'puente_cent', operacion.saldo_puente());
end $$;

create or replace function api.socio_cuenta(p_socio text) returns jsonb
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
      select 0::bigint, 'apertura', 0::bigint, se.fecha_corte, 'Saldo de apertura al corte', ef.v, (select ev.hora from operacion.evento ev where ev.id = se.evento_id), se.evento_id, false
        from apertura.sesion se
        cross join lateral (select contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 3110)) + contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 2310)) + contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 3310))
                                 - contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 3210)) - contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 1150)) - contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 1170)) as v) ef
       where se.estado = 'firmada' and se.evento_id is not null and ef.v <> 0
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

create or replace function api.estado_socio(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select id into v_id from catalogo.socio where nombre = p_socio;
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  return jsonb_build_object('socio', p_socio, 'deuda_cent', operacion.saldo_socio(v_id), 'fondos_cent', operacion.saldo_socio(v_id, 'fondos'), 'diferencia_cent', operacion.saldo_socio(v_id, 'diferencia'),
    'aportaciones_cent', (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio where socio_id = v_id and clasificacion = 'capital'),
    'reembolsable_cent', (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio where socio_id = v_id and clasificacion = 'reembolsable'),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'aplica_a', m.aplica_a, 'monto_cent', m.monto_cent, 'saldo_corrido_cent', m.corrido, 'nota', m.nota) order by m.id desc)
      from (select x.*, sum(x.monto_cent) over (order by x.id) as corrido from (
              select c.id, c.fecha_neg, c.concepto, c.aplica_a, c.monto_cent, c.nota from operacion.cuenta_socio_mov c where c.socio_id = v_id
              union all
              select -1::bigint, se.fecha_corte, 'apertura', 'fondos', contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 1150)), 'Saldo de apertura' from apertura.sesion se
               where se.estado = 'firmada' and contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 1150)) <> 0
              union all
              select -2::bigint, se.fecha_corte, 'apertura', 'diferencia', contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 1170)), 'Saldo de apertura' from apertura.sesion se
               where se.estado = 'firmada' and contabilidad.apertura_saldo(contabilidad.cta_socio(v_id, 1170)) <> 0) x) m), '[]'::jsonb));
end $$;

-- Lineas del asiento de apertura. p_con_inventario = true es la vista completa (para mostrar); false es el contenido del asiento manual (el inventario y su
-- contrapartida salen del movimiento 'apertura'). Positivo: signo de debe/haber segun el sentido de cada partida.
create function apertura.lineas(p_sesion bigint, p_con_inventario boolean) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s apertura.sesion; v_p bigint; v_v bigint; v_lin jsonb; v_neto bigint; v_ida bigint; v_idj bigint; v_a bigint; v_j bigint; v_abs bigint;
begin
  select * into s from apertura.sesion where id = p_sesion;
  select coalesce(sum(case sentido when 'D' then monto_cent else -monto_cent end), 0) into v_p from apertura.partida where sesion_id = p_sesion;
  select coalesce(sum(monto_cent), 0) into v_v from apertura.partida where sesion_id = p_sesion and categoria = 'inventario';
  select id into v_ida from catalogo.socio where nombre = 'Angelo';
  select id into v_idj from catalogo.socio where nombre = 'Javier';
  v_lin := coalesce((select jsonb_agg(jsonb_build_object('cuenta', p.cuenta, case p.sentido when 'D' then 'debe_cent' else 'haber_cent' end, p.monto_cent,
                       'cliente_id', p.cliente_id, 'proveedor_id', p.proveedor_id, 'socio_id', p.socio_id, 'modelo_id', p.modelo_id, 'nota', 'Apertura: ' || lower(c.nombre)) order by p.id)
                       from apertura.partida p join apertura.categoria c on c.codigo = p.categoria
                      where p.sesion_id = p_sesion and (p_con_inventario or p.categoria <> 'inventario')), '[]'::jsonb);
  -- Puente 3990: la diferencia contra la identidad contable. En el asiento manual descuenta lo que ya pone el movimiento de inventario.
  v_neto := case when p_con_inventario then v_p else v_p - v_v end;
  if v_neto > 0 then v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3990', 'haber_cent', v_neto, 'nota', 'Diferencia de cuadre inicial (puente)'));
  elsif v_neto < 0 then v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3990', 'debe_cent', -v_neto, 'nota', 'Diferencia de cuadre inicial (puente)')); end if;
  -- Resolucion firmada por los dos: la diferencia pasa al capital 50/50 (el centavo impar a Angelo).
  if s.resolucion_puente = 'capital_50_50' and v_p <> 0 then
    v_abs := abs(v_p); v_a := (v_abs + 1) / 2; v_j := v_abs - v_a;
    if v_p > 0 then
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3990', 'debe_cent', v_abs, 'nota', 'La diferencia se reparte al capital'));
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3110', 'haber_cent', v_a, 'socio_id', v_ida, 'nota', 'Mitad de la diferencia de apertura'));
      if v_j > 0 then v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3120', 'haber_cent', v_j, 'socio_id', v_idj, 'nota', 'Mitad de la diferencia de apertura')); end if;
    else
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3990', 'haber_cent', v_abs, 'nota', 'La diferencia se descuenta del capital'));
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3110', 'debe_cent', v_a, 'socio_id', v_ida, 'nota', 'Mitad de la diferencia de apertura'));
      if v_j > 0 then v_lin := v_lin || jsonb_build_array(jsonb_build_object('cuenta', '3120', 'debe_cent', v_j, 'socio_id', v_idj, 'nota', 'Mitad de la diferencia de apertura')); end if;
    end if;
  end if;
  return v_lin;
end $$;

-- Huella del contenido que firman los socios: fecha de corte, resolucion y partidas ordenadas por su contenido (no por su numero).
create function apertura.huella(p_sesion bigint) returns text
language sql stable security definer set search_path = ''
as $$
  select encode(sha256(convert_to(
    s.fecha_corte::text || '|' || s.resolucion_puente || '|' || coalesce(s.justificacion, '') || '|' ||
    coalesce((select string_agg(concat_ws(',', p.categoria, p.cuenta, p.sentido, p.monto_cent, p.socio_id, p.cliente_id, p.proveedor_id, p.modelo_id, p.sku_id, p.piezas, p.costo_unit_cent, p.fecha_ref),
                     ';' order by p.categoria, p.cuenta, p.socio_id, p.cliente_id, p.proveedor_id, p.modelo_id, p.sku_id, p.monto_cent, p.fecha_ref)
                from apertura.partida p where p.sesion_id = s.id), ''), 'UTF8')), 'hex')
  from apertura.sesion s where s.id = p_sesion
$$;

-- ---------------------------------------------------------------------------
-- Validacion: pasos, identidad contable y diferencia contra la cuenta puente
-- ---------------------------------------------------------------------------
create function apertura.validar(p_sesion bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s apertura.sesion; v_act bigint; v_pas bigint; v_cap bigint; v_puente bigint; v_pasos jsonb; v_alertas jsonb := '[]'::jsonb; v_n int; v_umbral bigint; v_exige boolean;
  v_hay_ocupado boolean;
begin
  select * into s from apertura.sesion where id = p_sesion;
  if not found then raise exception 'sesión de apertura desconocida' using errcode = '22023'; end if;
  select coalesce(sum(case c.tipo when 'A' then case p.sentido when 'D' then p.monto_cent else -p.monto_cent end else 0 end), 0),
         coalesce(sum(case c.tipo when 'P' then case p.sentido when 'H' then p.monto_cent else -p.monto_cent end else 0 end), 0),
         coalesce(sum(case c.tipo when 'K' then case p.sentido when 'H' then p.monto_cent else -p.monto_cent end else 0 end), 0),
         count(*)
    into v_act, v_pas, v_cap, v_n
    from apertura.partida p join contabilidad.cuenta c on c.codigo = p.cuenta where p.sesion_id = p_sesion;
  v_puente := v_act - v_pas - v_cap;
  v_umbral := (v_act * 5) / 1000;   -- 0.5 % del activo (regla de 10b, 5.1)
  v_exige := abs(v_puente) > v_umbral and v_puente <> 0;
  select jsonb_agg(jsonb_build_object('paso', x.paso, 'nombre', x.nombre, 'partidas', x.n, 'monto_cent', x.m, 'estado', case when x.n > 0 then 'con_datos' else 'vacio' end) order by x.paso)
    into v_pasos
    from (select 3 as paso, 'Aportaciones y reembolsos de los socios' as nombre, count(*) filter (where c.paso = 3)::int as n, coalesce(sum(p.monto_cent) filter (where c.paso = 3), 0) as m from apertura.partida p join apertura.categoria c on c.codigo = p.categoria where p.sesion_id = p_sesion
          union all select 4, 'Inventario por modelo y sabor', count(*) filter (where c.paso = 4)::int, coalesce(sum(p.monto_cent) filter (where c.paso = 4), 0) from apertura.partida p join apertura.categoria c on c.codigo = p.categoria where p.sesion_id = p_sesion
          union all select 5, 'Caja y fondos en poder de cada socio', count(*) filter (where c.paso = 5)::int, coalesce(sum(p.monto_cent) filter (where c.paso = 5), 0) from apertura.partida p join apertura.categoria c on c.codigo = p.categoria where p.sesion_id = p_sesion
          union all select 6, 'Cuentas por cobrar por cliente', count(*) filter (where c.paso = 6)::int, coalesce(sum(p.monto_cent) filter (where c.paso = 6), 0) from apertura.partida p join apertura.categoria c on c.codigo = p.categoria where p.sesion_id = p_sesion
          union all select 7, 'Cuentas con cada proveedor', count(*) filter (where c.paso = 7)::int, coalesce(sum(p.monto_cent) filter (where c.paso = 7), 0) from apertura.partida p join apertura.categoria c on c.codigo = p.categoria where p.sesion_id = p_sesion
          union all select 8, 'Utilidades, retiros y deuda de Angelo', count(*) filter (where c.paso = 8)::int, coalesce(sum(p.monto_cent) filter (where c.paso = 8), 0) from apertura.partida p join apertura.categoria c on c.codigo = p.categoria where p.sesion_id = p_sesion) x;
  if v_n = 0 then v_alertas := v_alertas || jsonb_build_array('La sesión no tiene partidas.'); end if;
  if v_puente <> 0 then v_alertas := v_alertas || jsonb_build_array('La diferencia contra la identidad contable queda en la cuenta puente 3990 hasta que los dos socios firmen una resolución.'); end if;
  if v_exige and s.resolucion_puente = 'capital_50_50' and nullif(btrim(coalesce(s.justificacion, '')), '') is null then
    v_alertas := v_alertas || jsonb_build_array('La diferencia supera el 0.5 % del activo: repartirla al capital exige una justificación escrita.');
  end if;
  if s.fecha_corte > negocio.hoy() then v_alertas := v_alertas || jsonb_build_array('La fecha de corte no puede ser futura.'); end if;
  select exists (select 1 from operacion.movimiento_inventario m where m.fecha_neg > s.fecha_corte and exists (select 1 from apertura.partida p where p.sesion_id = p_sesion and p.modelo_id = m.modelo_id)) into v_hay_ocupado;
  if v_hay_ocupado then v_alertas := v_alertas || jsonb_build_array('Ya hay movimientos de inventario posteriores a la fecha de corte para un modelo de la sesión: el kárdex no admite fechas retroactivas.'); end if;
  return jsonb_build_object('sesion_id', s.id, 'fecha_corte', s.fecha_corte, 'partidas', v_n,
    'activo_cent', v_act, 'pasivo_cent', v_pas, 'capital_cent', v_cap, 'puente_cent', v_puente,
    'identidad_cent', v_act - (v_pas + v_cap + v_puente),
    'umbral_justificacion_cent', v_umbral, 'exige_justificacion', v_exige and s.resolucion_puente = 'capital_50_50',
    'resolucion', s.resolucion_puente, 'justificacion', s.justificacion,
    'pasos', coalesce(v_pasos, '[]'::jsonb), 'alertas', v_alertas,
    'listo_para_firma', v_n > 0 and s.fecha_corte <= negocio.hoy() and not v_hay_ocupado
                        and not (v_exige and s.resolucion_puente = 'capital_50_50' and nullif(btrim(coalesce(s.justificacion, '')), '') is null),
    'huella', apertura.huella(p_sesion));
end $$;

-- Vista previa SIN escribir: las lineas del asiento y el efecto en cada cuenta (saldo actual, apertura y saldo despues).
create function apertura.vista_previa(p_sesion bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_lin jsonb; v_efecto jsonb; v_d bigint; v_h bigint;
begin
  v_lin := apertura.lineas(p_sesion, true);
  select coalesce(sum((x->>'debe_cent')::bigint), 0), coalesce(sum((x->>'haber_cent')::bigint), 0) into v_d, v_h from jsonb_array_elements(v_lin) x;
  select coalesce(jsonb_agg(jsonb_build_object('cuenta', c.codigo, 'nombre', c.nombre, 'naturaleza', c.naturaleza, 'antes_cent', contabilidad.saldo(c.codigo), 'apertura_cent', a.delta,
                                               'despues_cent', contabilidad.saldo(c.codigo) + a.delta) order by c.codigo), '[]'::jsonb)
    into v_efecto
    from (select x->>'cuenta' as cuenta, sum(case (select naturaleza from contabilidad.cuenta where codigo = x->>'cuenta') when 'D' then coalesce((x->>'debe_cent')::bigint, 0) - coalesce((x->>'haber_cent')::bigint, 0)
                                              else coalesce((x->>'haber_cent')::bigint, 0) - coalesce((x->>'debe_cent')::bigint, 0) end)::bigint as delta
            from jsonb_array_elements(v_lin) x group by x->>'cuenta') a join contabilidad.cuenta c on c.codigo = a.cuenta;
  return jsonb_build_object('sesion_id', p_sesion, 'lineas', v_lin, 'debe_cent', v_d, 'haber_cent', v_h, 'cuadra', v_d = v_h, 'efecto', v_efecto, 'escribe', false);
end $$;

-- ---------------------------------------------------------------------------
-- Escritura del borrador
-- ---------------------------------------------------------------------------
create function apertura.crear_sesion(p_clave text, p_fecha_corte date, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_crear', 'f', p_fecha_corte, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_fecha_corte is null then raise exception 'la fecha de corte es obligatoria' using errcode = '23502'; end if;
  if p_fecha_corte > negocio.hoy() then raise exception 'la fecha de corte no puede ser futura' using errcode = '23514'; end if;
  if exists (select 1 from apertura.sesion where estado <> 'reversada') then raise exception 'ya hay una sesión de apertura vigente: revérsala antes de abrir otra' using errcode = 'P0441'; end if;
  insert into apertura.sesion (fecha_corte, nota) values (p_fecha_corte, p_nota) returning id into v_id;
  v_res := jsonb_build_object('sesion_id', v_id);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

create function apertura.fijar_corte(p_clave text, p_sesion bigint, p_fecha_corte date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_corte', 's', p_sesion, 'f', p_fecha_corte));
  if v_prev is not null then return v_prev; end if;
  if p_fecha_corte is null or p_fecha_corte > negocio.hoy() then raise exception 'fecha de corte inválida' using errcode = '23514'; end if;
  if (select estado from apertura.sesion where id = p_sesion) is distinct from 'borrador' then raise exception 'la sesión de apertura está en firma o firmada: retira la firma para editar' using errcode = 'P0440'; end if;
  update apertura.sesion set fecha_corte = p_fecha_corte where id = p_sesion;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'fecha_corte', p_fecha_corte);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

create function apertura.fijar_resolucion(p_clave text, p_sesion bigint, p_resolucion text, p_justificacion text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_resolucion', 's', p_sesion, 'r', p_resolucion, 'j', p_justificacion));
  if v_prev is not null then return v_prev; end if;
  if p_resolucion not in ('mantener', 'capital_50_50') then raise exception 'resolución desconocida' using errcode = '22023'; end if;
  if (select estado from apertura.sesion where id = p_sesion) is distinct from 'borrador' then raise exception 'la sesión de apertura está en firma o firmada: retira la firma para editar' using errcode = 'P0440'; end if;
  update apertura.sesion set resolucion_puente = p_resolucion, justificacion = nullif(btrim(p_justificacion), '') where id = p_sesion;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'resolucion', p_resolucion);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- p: {socio: 'Angelo'|'Javier', cliente_id, proveedor_id, sku_id, piezas, costo_unit_cent, monto_cent, fecha_ref, descripcion}
-- Inventario: monto_cent (valor total del sabor, para costos con subcentavo) o costo_unit_cent (piezas x costo); si llegan los dos, deben coincidir.
create function apertura.agregar_partida(p_clave text, p_sesion bigint, p_categoria text, p jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c apertura.categoria; s apertura.sesion; v_socio bigint; v_cliente bigint := nullif(p->>'cliente_id', '')::bigint; v_prov bigint := nullif(p->>'proveedor_id', '')::bigint;
  v_sku bigint := nullif(p->>'sku_id', '')::bigint; v_modelo bigint; v_cuenta text; v_monto bigint; v_pzs int := nullif(p->>'piezas', '')::int; v_costo bigint := nullif(p->>'costo_unit_cent', '')::bigint;
  v_fecha date := nullif(p->>'fecha_ref', '')::date; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_agregar', 's', p_sesion, 'c', p_categoria, 'p', p));
  if v_prev is not null then return v_prev; end if;
  select * into s from apertura.sesion where id = p_sesion for update;
  if not found then raise exception 'sesión de apertura desconocida' using errcode = '22023'; end if;
  if s.estado <> 'borrador' then raise exception 'la sesión de apertura está en firma o firmada: retira la firma para editar' using errcode = 'P0440'; end if;
  select * into c from apertura.categoria where codigo = p_categoria;
  if not found then raise exception 'categoría de apertura desconocida: %', p_categoria using errcode = '22023'; end if;
  if c.req_socio then
    select id into v_socio from catalogo.socio where nombre = p->>'socio';
    if v_socio is null then raise exception 'la partida de % necesita un socio (Angelo o Javier)', lower(c.nombre) using errcode = '23502'; end if;
  end if;
  if c.codigo = 'deuda_faltante_socio' and p->>'socio' is distinct from 'Angelo' and p->>'socio' is distinct from 'Javier' then raise exception 'indica el socio deudor' using errcode = '23502'; end if;
  if c.req_cliente and (v_cliente is null or not exists (select 1 from catalogo.cliente where id = v_cliente)) then raise exception 'la cuenta por cobrar necesita un cliente del catálogo' using errcode = '23502'; end if;
  if c.req_proveedor and (v_prov is null or not exists (select 1 from catalogo.proveedor where id = v_prov)) then raise exception 'la cuenta con proveedor necesita Isaac o Karen' using errcode = '23502'; end if;
  if c.req_fecha then
    if v_fecha is null then raise exception 'la cuenta por cobrar necesita la fecha del adeudo' using errcode = '23502'; end if;
    if v_fecha > s.fecha_corte then raise exception 'la fecha del adeudo no puede ser posterior al corte' using errcode = '23514'; end if;
  end if;
  if c.codigo = 'inventario' then
    select k.modelo_id into v_modelo from catalogo.sku k where k.id = v_sku;
    if v_modelo is null then raise exception 'el inventario necesita un modelo y sabor del catálogo' using errcode = '23502'; end if;
    v_monto := nullif(p->>'monto_cent', '')::bigint;
    if v_pzs is null or v_pzs <= 0 or (v_costo is null and v_monto is null) or v_costo < 0 then raise exception 'el inventario necesita piezas y costo unitario o el valor total' using errcode = '23514'; end if;
    if v_monto is null then v_monto := v_pzs::bigint * v_costo;
    elsif v_costo is not null and v_monto <> v_pzs::bigint * v_costo then raise exception 'el valor total del inventario no coincide con piezas por costo unitario' using errcode = '23514';
    end if;
    if v_monto <= 0 then raise exception 'el valor del inventario debe ser mayor que cero' using errcode = '23514'; end if;
    v_costo := round(v_monto::numeric / v_pzs)::bigint;
    v_cuenta := '1310';
  else
    v_monto := nullif(p->>'monto_cent', '')::bigint;
    if v_monto is null or v_monto <= 0 then raise exception 'el monto debe ser mayor que cero' using errcode = '23514'; end if;
    v_sku := null; v_costo := null; v_pzs := case when c.codigo = 'deuda_faltante_socio' then v_pzs else null end;
    v_cuenta := case when c.cuenta_fija is not null then c.cuenta_fija
                     when c.req_proveedor then contabilidad.cta_proveedor(v_prov)
                     else contabilidad.cta_socio(v_socio, c.base_socio) end;
    if c.codigo = 'deuda_faltante_socio' then v_cuenta := contabilidad.cta_socio(v_socio, 1170); end if;
  end if;
  if not exists (select 1 from contabilidad.cuenta where codigo = v_cuenta and activa) then raise exception 'cuenta inactiva: %', v_cuenta using errcode = '22023'; end if;
  insert into apertura.partida (sesion_id, categoria, cuenta, sentido, monto_cent, socio_id, cliente_id, proveedor_id, modelo_id, sku_id, piezas, costo_unit_cent, fecha_ref, descripcion)
  values (p_sesion, c.codigo, v_cuenta, c.sentido, v_monto, v_socio, case when c.req_cliente then v_cliente end, case when c.req_proveedor then v_prov end, v_modelo, v_sku, v_pzs, v_costo,
          case when c.req_fecha then v_fecha end, nullif(btrim(p->>'descripcion'), ''))
  returning id into v_id;
  v_res := jsonb_build_object('partida_id', v_id, 'cuenta', v_cuenta, 'monto_cent', v_monto);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

create function apertura.quitar_partida(p_clave text, p_partida bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_quitar', 'p', p_partida));
  if v_prev is not null then return v_prev; end if;
  delete from apertura.partida where id = p_partida;
  if not found then raise exception 'partida desconocida' using errcode = '22023'; end if;
  v_res := jsonb_build_object('partida_id', p_partida, 'quitada', true);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Publicacion (interna): un evento de inventario y un asiento manual de apertura. La usan la segunda firma y el ensayo.
-- ---------------------------------------------------------------------------
create function apertura.publicar(p_sesion bigint, p_clave text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s apertura.sesion; v_ev_inv bigint; v_ev bigint; r record; v_val jsonb;
begin
  select * into s from apertura.sesion where id = p_sesion for update;
  v_val := apertura.validar(p_sesion);
  if not (v_val->>'listo_para_firma')::boolean then raise exception 'la apertura no está lista: %', v_val->'alertas' using errcode = 'P0442'; end if;
  if exists (select 1 from apertura.partida where sesion_id = p_sesion and categoria = 'inventario') then
    v_ev_inv := operacion.crear_evento('apertura_inventario', s.fecha_corte, p_clave || ':inventario', jsonb_build_object('sesion_id', p_sesion), 'apertura');
    for r in select p.* from apertura.partida p where p.sesion_id = p_sesion and p.categoria = 'inventario' order by p.id loop
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, nota)
      values (s.fecha_corte, r.sku_id, r.modelo_id, 'bodega_omar', 'apertura', r.piezas, r.monto_cent, v_ev_inv, 'Apertura al ' || s.fecha_corte);
    end loop;
  end if;
  v_ev := operacion.crear_evento('asiento_manual', s.fecha_corte, p_clave || ':asiento',
            jsonb_build_object('motivo', 'Asiento de apertura al ' || s.fecha_corte, 'lineas', apertura.lineas(p_sesion, false), 'apertura', true, 'sesion_id', p_sesion), 'apertura');
  update apertura.sesion set estado = 'firmada', evento_id = v_ev, evento_inventario_id = v_ev_inv, hash_firmado = apertura.huella(p_sesion), firmada_at = clock_timestamp() where id = p_sesion;
  return jsonb_build_object('evento_id', v_ev, 'evento_inventario_id', v_ev_inv);
end $$;

-- Ensayo: publica de verdad dentro de una subtransaccion, mide el resultado y lo deshace. No deja asientos, movimientos, folios ni claves.
create function apertura.ensayo(p_sesion bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_pub jsonb; v_res jsonb; v_txt text;
begin
  begin
    v_pub := apertura.publicar(p_sesion, 'ensayo:' || p_sesion || ':' || clock_timestamp()::text);
    if (v_pub->>'evento_inventario_id') is not null then perform contabilidad.asentar_evento((v_pub->>'evento_inventario_id')::bigint); end if;
    perform contabilidad.asentar_evento((v_pub->>'evento_id')::bigint);
    select jsonb_build_object(
      'escribe', false,
      'puente_3990_cent', contabilidad.saldo('3990'),
      'comprobaciones_en_rojo', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'bloqueante', c.bloqueante, 'via_a_cent', c.via_a_cent, 'via_b_cent', c.via_b_cent)) from contabilidad.comprobaciones() c where not c.ok), '[]'::jsonb),
      'bloqueantes_en_rojo', (select count(*) from contabilidad.comprobaciones() c where not c.ok and c.bloqueante),
      'auxiliares_en_rojo', coalesce((select jsonb_agg(jsonb_build_object('clave', a.clave, 'libro_cent', a.mayor_cent, 'auxiliar_cent', a.operativo_cent)) from contabilidad.reproducir_saldos() a where not a.ok), '[]'::jsonb),
      'asientos', (select count(*) from contabilidad.asiento),
      'cadena_ok', contabilidad.verificar_cadena() is null,
      'inventario_1310_cent', contabilidad.saldo('1310'),
      'inventario_kardex_cent', coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0)::bigint)
      into v_res;
    raise exception 'ensayo' using errcode = 'P0499', detail = v_res::text;
  exception when sqlstate 'P0499' then
    get stacked diagnostics v_txt = pg_exception_detail;
    v_res := v_txt::jsonb;
  end;
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Los controles reconocen el saldo de apertura como auxiliar: clientes, proveedores y la posicion de cada socio ya lo traen las funciones de saldo; los fondos y faltantes de los socios lo suman aqui.
-- ---------------------------------------------------------------------------
create or replace function contabilidad.reproducir_saldos() returns table (clave text, descripcion text, mayor_cent bigint, operativo_cent bigint, ok boolean)
language sql stable security definer set search_path = ''
as $$
  select r.clave, r.descripcion, r.mayor, r.oper, r.mayor = r.oper from (
    select 'inventario'::text as clave, 'Inventario (1310) contra el valor del kárdex por modelo'::text as descripcion, contabilidad.saldo('1310') as mayor,
           coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0)::bigint as oper
    union all select 'transito', 'Mercancía en tránsito (1320) contra órdenes confirmadas sin recibir', contabilidad.saldo('1320'),
           coalesce((select sum(total_cent) from operacion.compra where estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')), 0)::bigint
         + coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a join operacion.compra c on c.id = a.ref_id where a.ref_tipo = 'compra' and a.reversa_de is null and c.estado = 'anulada'), 0)::bigint
    union all select 'puente', 'Diferencias de recepción (1340) contra el puente operativo', contabilidad.saldo('1340'), operacion.saldo_puente()
    union all select 'clientes', 'Clientes (1210) contra los saldos de pedidos enviados', contabilidad.saldo('1210'),
           coalesce((select sum(operacion.saldo_cliente(c.id)) from catalogo.cliente c), 0)::bigint
    union all select 'saldos_favor', 'Saldos a favor de clientes (2410) contra pagos sin aplicar', contabilidad.saldo('2410'),
           coalesce((select sum(operacion.saldo_favor_cliente(c.id)) from catalogo.cliente c), 0)::bigint
    union all select 'por_identificar', 'Depósitos por identificar (2420) contra pagos sin cliente', contabilidad.saldo('2420'),
           coalesce((select sum(p.monto_cent) from operacion.pago p where p.cliente_id is null and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id)
                      and not exists (select 1 from operacion.pago_anulacion an where an.pago_id = p.id)), 0)::bigint
    union all select 'fondos_socios', 'Fondos en poder de los socios (1150 y 1160) contra la cuenta de los socios', contabilidad.saldo('1150') + contabilidad.saldo('1160'),
           coalesce((select sum(monto_cent) from operacion.cuenta_socio_mov where aplica_a <> 'diferencia'), 0)::bigint + contabilidad.apertura_saldo('1150') + contabilidad.apertura_saldo('1160')
    union all select 'faltantes_socios', 'Faltantes por cobrar a socios (1170 y 1180) contra la cuenta de los socios', contabilidad.saldo('1170') + contabilidad.saldo('1180'),
           coalesce((select sum(monto_cent) from operacion.cuenta_socio_mov where aplica_a = 'diferencia'), 0)::bigint + contabilidad.apertura_saldo('1170') + contabilidad.apertura_saldo('1180')
    union all select 'proveedor_isaac', 'Isaac (2110) contra su cuenta, los pedidos directos y lo pagado de más fuera de la sociedad', contabilidad.saldo('2110'),
           (-operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')) + contabilidad.fuera_sociedad(null, catalogo.proveedor_id('Isaac')) + contabilidad.directos_proveedor('Isaac'))::bigint
    union all select 'proveedor_karen', 'Karen (2120) contra su cuenta, los pedidos directos y lo pagado de más fuera de la sociedad', contabilidad.saldo('2120'),
           (-operacion.saldo_proveedor(catalogo.proveedor_id('Karen')) + contabilidad.fuera_sociedad(null, catalogo.proveedor_id('Karen')) + contabilidad.directos_proveedor('Karen'))::bigint
    union all select 'socio_' || lower(s.nombre), 'Posición de ' || s.nombre || ' (aportaciones, reembolsos y utilidad menos lo que tiene en su poder) contra la cuenta de socios',
           contabilidad.saldo(contabilidad.cta_socio(s.id, 2310)) + contabilidad.saldo(contabilidad.cta_socio(s.id, 3110)) + contabilidad.saldo(contabilidad.cta_socio(s.id, 3310))
             - contabilidad.saldo(contabilidad.cta_socio(s.id, 3210)) - contabilidad.saldo(contabilidad.cta_socio(s.id, 1150)) - contabilidad.saldo(contabilidad.cta_socio(s.id, 1170)),
           (operacion.neto_socio(s.id) - contabilidad.fuera_sociedad(s.id, null))::bigint
      from catalogo.socio s
    union all select 'omar', 'Omar: renta por pagar (2210) menos tomas por cobrar (1220) contra sus devengos, tomas y pagos', contabilidad.saldo('2210') - contabilidad.saldo('1220'), contabilidad.omar_operativo()
  ) r
$$;


-- ---------------------------------------------------------------------------
-- Firma de los dos socios. La segunda firma publica.
-- ---------------------------------------------------------------------------
create function apertura.firmar(p_clave text, p_sesion bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint := apertura.socio_actual(); s apertura.sesion; v_val jsonb; v_hash text; v_firmas int; v_pub jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_firmar', 's', p_sesion));
  if v_prev is not null then return v_prev; end if;
  select * into s from apertura.sesion where id = p_sesion for update;
  if not found then raise exception 'sesión de apertura desconocida' using errcode = '22023'; end if;
  if s.estado not in ('borrador', 'en_firma') then raise exception 'la sesión ya está firmada o reversada' using errcode = 'P0441'; end if;
  v_val := apertura.validar(p_sesion);
  if not (v_val->>'listo_para_firma')::boolean then raise exception 'la apertura no está lista para firma: %', v_val->'alertas' using errcode = 'P0442'; end if;
  v_hash := apertura.huella(p_sesion);
  if not exists (select 1 from apertura.firma where sesion_id = p_sesion and socio_id = v_socio and retirada_at is null) then
    insert into apertura.firma (sesion_id, socio_id, hash) values (p_sesion, v_socio, v_hash);
  end if;
  update apertura.sesion set estado = 'en_firma' where id = p_sesion and estado = 'borrador';
  select count(distinct socio_id) into v_firmas from apertura.firma where sesion_id = p_sesion and retirada_at is null and hash = v_hash;
  if v_firmas = 2 then v_pub := apertura.publicar(p_sesion, 'apertura:' || p_sesion); end if;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'firmas', v_firmas, 'publicada', v_firmas = 2, 'huella', v_hash) || coalesce(v_pub, '{}'::jsonb);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

create function apertura.retirar_firma(p_clave text, p_sesion bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio bigint := apertura.socio_actual(); s apertura.sesion; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_retirar_firma', 's', p_sesion));
  if v_prev is not null then return v_prev; end if;
  select * into s from apertura.sesion where id = p_sesion for update;
  if s.estado <> 'en_firma' then raise exception 'solo se retira la firma de una sesión en firma; una sesión firmada se revierte' using errcode = 'P0441'; end if;
  update apertura.firma set retirada_at = clock_timestamp() where sesion_id = p_sesion and socio_id = v_socio and retirada_at is null;
  if not exists (select 1 from apertura.firma where sesion_id = p_sesion and retirada_at is null) then update apertura.sesion set estado = 'borrador' where id = p_sesion; end if;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'estado', (select estado from apertura.sesion where id = p_sesion));
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- Reversa de una apertura firmada: contramovimientos del inventario (fallan si ya salio mercancia) y reversa del asiento manual.
create function apertura.reversar(p_clave text, p_sesion bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; s apertura.sesion; v_ev_rev bigint; v_asiento bigint; m record; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_reversar', 's', p_sesion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la reversa exige motivo' using errcode = '23502'; end if;
  select * into s from apertura.sesion where id = p_sesion for update;
  if s.estado <> 'firmada' then raise exception 'solo se revierte una apertura firmada' using errcode = 'P0441'; end if;
  -- No se revierte si ya salio mercancia de un modelo de la apertura (la reversa dejaria un costo promedio que no corresponde a ningun costo real) ni si ya se cobro una cuenta por cobrar de la apertura.
  if exists (select 1 from operacion.movimiento_inventario mi join operacion.movimiento_inventario xi on xi.modelo_id = mi.modelo_id and xi.id > mi.id and xi.cantidad < 0
              where mi.evento_id = s.evento_inventario_id and mi.tipo = 'apertura') then
    raise exception 'ya salió mercancía de un modelo de la apertura: no se puede revertir; corrige con un ajuste de inventario' using errcode = 'P0423';
  end if;
  if exists (select 1 from operacion.pago_aplicacion_apertura x where x.reversa_de is null and not exists (select 1 from operacion.pago_aplicacion_apertura r where r.reversa_de = x.id)) then
    raise exception 'ya se cobraron cuentas por cobrar de la apertura: anula esos pagos antes de revertirla' using errcode = 'P0441';
  end if;
  if s.evento_inventario_id is not null then
    v_ev_rev := operacion.crear_evento('apertura_reversa_inventario', negocio.hoy(), p_clave || ':inventario', jsonb_build_object('sesion_id', p_sesion), p_motivo, s.evento_inventario_id, p_motivo);
    for m in select * from operacion.movimiento_inventario where evento_id = s.evento_inventario_id and tipo = 'apertura' order by id loop
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev_rev, m.id, 'Reversa de la apertura: ' || p_motivo);
    end loop;
  end if;
  select id into v_asiento from contabilidad.asiento where evento_id = s.evento_id;
  if v_asiento is null then perform contabilidad.asentar_evento(s.evento_id); select id into v_asiento from contabilidad.asiento where evento_id = s.evento_id; end if;
  -- Una apertura solo de inventario no produce asiento manual (el inventario y su contrapartida 3990 salen del movimiento 'apertura', que se deshace arriba con
  -- su contramovimiento): no hay asiento que reversar. Si el asiento manual traia lineas y no existe, es un error real y se detiene.
  if v_asiento is not null then
    perform set_config('rtm.reversa_apertura', 'si', true);
    perform contabilidad.reversar_asiento(p_clave || ':asiento', v_asiento, p_motivo);
    perform set_config('rtm.reversa_apertura', '', true);
  elsif jsonb_array_length(coalesce((select e.payload->'lineas' from operacion.evento e where e.id = s.evento_id), '[]'::jsonb)) > 0 then
    raise exception 'la apertura tiene líneas de asiento pero no se encontró su asiento' using errcode = 'P0441';
  end if;
  update apertura.sesion set estado = 'reversada', motivo_reversa = p_motivo, reversada_at = clock_timestamp(), evento_reversa_id = v_ev_rev where id = p_sesion;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'reversada', true);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- Descartar una sesion que aun no se publico (borrador o en firma): queda registrada como revertida con su motivo; las partidas se conservan.
create function apertura.descartar(p_clave text, p_sesion bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; s apertura.sesion; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_descartar', 's', p_sesion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'descartar exige motivo' using errcode = '23502'; end if;
  select * into s from apertura.sesion where id = p_sesion for update;
  if not found then raise exception 'sesión de apertura desconocida' using errcode = '22023'; end if;
  if s.estado not in ('borrador', 'en_firma') then raise exception 'solo se descarta una sesión sin publicar; una apertura firmada se revierte' using errcode = 'P0441'; end if;
  update apertura.firma set retirada_at = clock_timestamp() where sesion_id = p_sesion and retirada_at is null;
  update apertura.sesion set estado = 'reversada', motivo_reversa = btrim(p_motivo), reversada_at = clock_timestamp() where id = p_sesion;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'descartada', true);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lectura para la web
-- ---------------------------------------------------------------------------
create function apertura.estado(p_sesion bigint default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare s apertura.sesion; v_id bigint;
begin
  v_id := coalesce(p_sesion, (select id from apertura.sesion where estado <> 'reversada' order by id desc limit 1), (select id from apertura.sesion order by id desc limit 1));
  select * into s from apertura.sesion where id = v_id;
  return jsonb_build_object(
    'categorias', (select jsonb_agg(to_jsonb(c) - 'cuenta_fija' - 'base_socio' order by c.paso, c.codigo) from apertura.categoria c),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'fecha_corte', h.fecha_corte, 'estado', h.estado, 'firmada_at', h.firmada_at, 'reversada_at', h.reversada_at, 'motivo_reversa', h.motivo_reversa) order by h.id desc) from apertura.sesion h), '[]'::jsonb),
    'sesion', case when s.id is null then null else jsonb_build_object('id', s.id, 'fecha_corte', s.fecha_corte, 'estado', s.estado, 'resolucion', s.resolucion_puente, 'justificacion', s.justificacion, 'nota', s.nota,
      'firmada_at', s.firmada_at, 'hash_firmado', s.hash_firmado) end,
    'partidas', case when s.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'categoria', p.categoria, 'paso', c.paso, 'nombre', c.nombre, 'cuenta', p.cuenta, 'sentido', p.sentido, 'monto_cent', p.monto_cent,
      'socio', so.nombre, 'cliente_id', p.cliente_id, 'cliente', cl.nombre_canonico, 'proveedor', pr.nombre, 'modelo', mo.nombre_canonico, 'sabor', sa.nombre_canonico, 'sku_id', p.sku_id,
      'piezas', p.piezas, 'costo_unit_cent', p.costo_unit_cent, 'fecha_ref', p.fecha_ref, 'descripcion', p.descripcion) order by c.paso, p.id)
      from apertura.partida p join apertura.categoria c on c.codigo = p.categoria left join catalogo.socio so on so.id = p.socio_id left join catalogo.cliente cl on cl.id = p.cliente_id
      left join catalogo.proveedor pr on pr.id = p.proveedor_id left join catalogo.modelo mo on mo.id = p.modelo_id left join catalogo.sku k on k.id = p.sku_id left join catalogo.sabor sa on sa.id = k.sabor_id
      where p.sesion_id = s.id), '[]'::jsonb) end,
    'firmas', case when s.id is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('socio', so.nombre, 'firmada_at', f.firmada_at, 'hash', f.hash) order by f.id)
      from apertura.firma f join catalogo.socio so on so.id = f.socio_id where f.sesion_id = s.id and f.retirada_at is null), '[]'::jsonb) end,
    'yo', (select so.nombre from catalogo.socio so where so.id = apertura.socio_actual()),
    'validacion', case when s.id is null then null else apertura.validar(s.id) end);
end $$;

create function apertura.catalogos() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('modelo_id', m.id, 'modelo', m.nombre_canonico, 'marca', ma.nombre,
         'sabores', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'sabor', sa.nombre_canonico) order by sa.nombre_canonico) from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = m.id and k.activo), '[]'::jsonb))
         order by ma.nombre, m.nombre_canonico) from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre_canonico) order by c.nombre_canonico) from catalogo.cliente c where c.activo), '[]'::jsonb),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre) from catalogo.proveedor p), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- API (solo socios)
-- ---------------------------------------------------------------------------
create function api.apertura_estado(p_sesion bigint default null) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.estado(p_sesion); end $$;
create function api.apertura_catalogos() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.catalogos(); end $$;
create function api.apertura_crear(p_clave_idem text, p_fecha_corte date, p_nota text default null) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.crear_sesion(p_clave_idem, p_fecha_corte, p_nota); end $$;
create function api.apertura_fijar_corte(p_clave_idem text, p_sesion bigint, p_fecha_corte date) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.fijar_corte(p_clave_idem, p_sesion, p_fecha_corte); end $$;
create function api.apertura_resolucion(p_clave_idem text, p_sesion bigint, p_resolucion text, p_justificacion text default null) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.fijar_resolucion(p_clave_idem, p_sesion, p_resolucion, p_justificacion); end $$;
create function api.apertura_agregar(p_clave_idem text, p_sesion bigint, p_categoria text, p_datos jsonb) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.agregar_partida(p_clave_idem, p_sesion, p_categoria, p_datos); end $$;
create function api.apertura_quitar(p_clave_idem text, p_partida bigint) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.quitar_partida(p_clave_idem, p_partida); end $$;
create function api.apertura_vista_previa(p_sesion bigint) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.vista_previa(p_sesion); end $$;
create function api.apertura_ensayo(p_sesion bigint) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.ensayo(p_sesion); end $$;
create function api.apertura_firmar(p_clave_idem text, p_sesion bigint) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.firmar(p_clave_idem, p_sesion); end $$;
create function api.apertura_retirar_firma(p_clave_idem text, p_sesion bigint) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.retirar_firma(p_clave_idem, p_sesion); end $$;
create function api.apertura_descartar(p_clave_idem text, p_sesion bigint, p_motivo text) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.descartar(p_clave_idem, p_sesion, p_motivo); end $$;
create function api.apertura_reversar(p_clave_idem text, p_sesion bigint, p_motivo text) returns jsonb language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return apertura.reversar(p_clave_idem, p_sesion, p_motivo); end $$;

revoke execute on all functions in schema apertura from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function api.apertura_estado(bigint), api.apertura_catalogos(), api.apertura_crear(text, date, text), api.apertura_fijar_corte(text, bigint, date),
  api.apertura_resolucion(text, bigint, text, text), api.apertura_agregar(text, bigint, text, jsonb), api.apertura_quitar(text, bigint), api.apertura_vista_previa(bigint),
  api.apertura_ensayo(bigint), api.apertura_firmar(text, bigint), api.apertura_retirar_firma(text, bigint), api.apertura_reversar(text, bigint, text), api.apertura_descartar(text, bigint, text) to authenticated;
revoke execute on all functions in schema contabilidad, operacion, catalogo from public, anon, authenticated;
