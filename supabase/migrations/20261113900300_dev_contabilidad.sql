-- Devoluciones / 3: contabilidad. Las devoluciones y la recepcion parcial entran al libro por la misma funcion pura de siempre (hechos inmutables -> asiento),
-- y los controles por dos vias las reconocen:
--   * Devolucion de cliente: Dr 4220 Devoluciones sobre ventas / Cr 1210 Clientes (por pedido). El kardex ya traia Dr 1310 / Cr 5100 (devolucion) y, si viene danada, Dr 5200 / Cr 1310.
--   * Devolucion a proveedor: Cr 1310 inventario / Dr cuenta del proveedor (misma cifra: el credito es el valor en libros; la diferencia pactada va por ajuste de proveedor).
--   * Recepcion parcial: Dr 1310 / Cr 1320 por lo contado; al cerrar, Dr 1340 / Cr 1320 por lo que no llego (o al reves si sobro).
-- Integracion: la migracion de efectivo (20261112400000) renombro la original a lineas_de_evento_base y puso una envoltura; la rama de devoluciones
-- redefine la BASE vigente (la de 20261113300200, con reinversion) con create or replace sobre _base, asi la envoltura de efectivo sigue intacta. comprobaciones parte de la version vigente (con C23/C24).
-- Controles: la cuenta 1320 reconoce lo pendiente de compras recibidas en parte, y C14 resta 4220 (el cobrado del pedido ya es neto de devoluciones).

create or replace function contabilidad.lineas_de_evento_base(p_evento bigint)
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
  cie as (select d.tipo, d.valor_cent from operacion.compra_diferencia d where v_tipo = 'compra_recepcion_cerrada' and d.evento_id = p_evento),
  dvc as (
    select d.monto_cent * case when v_tipo = 'devolucion_cliente' then 1 else -1 end as monto_cent, d.cliente_id, d.pedido_id from operacion.devolucion_cliente d
    where (v_tipo = 'devolucion_cliente' and d.evento_id = p_evento) or (v_tipo = 'devolucion_cliente_anulada' and d.folio = v_payload->>'devolucion')),
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
    from mov m where not (m.tipo_ef = 'entrada_compra' and v_tipo in ('compra_recibida', 'compra_recepcion_parcial'))
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
    -- Recepcion parcial: lo contado entra al inventario contra la mercancia en transito; al cerrar, lo que falta o sobra va a la cuenta puente.
    union all select '1320', -sum(m.valor_cent), null, null, null, null, null, 'Mercancía en tránsito que entra (recepción parcial)' from mov m where v_tipo = 'compra_recepcion_parcial'
    union all select '1340', case c.tipo when 'faltante' then c.valor_cent else -c.valor_cent end, null, null, null, null, null, 'Diferencia al cerrar la recepción' from cie c
    union all select '1320', case c.tipo when 'faltante' then -c.valor_cent else c.valor_cent end, null, null, null, null, null, 'Diferencia al cerrar la recepción' from cie c
    -- Devolucion de un cliente (nota de credito) y su anulacion; el kardex y la liberacion de pagos entran por sus propios hechos.
    union all select '4220', d.monto_cent, d.cliente_id, null, null, null, d.pedido_id, 'Devolución sobre ventas' from dvc d
    union all select '1210', -d.monto_cent, d.cliente_id, null, null, null, d.pedido_id, 'Devolución sobre ventas' from dvc d
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
                                                      when 'pago_utilidad' then 3310 when 'retiro' then 3210 when 'liquidacion_recibida' then 3310 when 'reinversion' then 3310 end),
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

create or replace function contabilidad.reproducir_saldos() returns table (clave text, descripcion text, mayor_cent bigint, operativo_cent bigint, ok boolean)
language sql stable security definer set search_path = ''
as $$
  select r.clave, r.descripcion, r.mayor, r.oper, r.mayor = r.oper from (
    select 'inventario'::text as clave, 'Inventario (1310) contra el valor del kárdex por modelo'::text as descripcion, contabilidad.saldo('1310') as mayor,
           coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0)::bigint as oper
    union all select 'transito', 'Mercancía en tránsito (1320) contra órdenes confirmadas sin recibir y lo pendiente de las recibidas en parte', contabilidad.saldo('1320'),
           coalesce((select sum(total_cent) from operacion.compra where estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')), 0)::bigint
         + coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a join operacion.compra c on c.id = a.ref_id where a.ref_tipo = 'compra' and a.reversa_de is null and c.estado = 'anulada'), 0)::bigint
         + coalesce((select sum(c.total_cent - coalesce((select sum(lo.valor_entrada_cent) from operacion.lote lo join operacion.compra_linea cl on cl.id = lo.compra_linea_id where cl.compra_id = c.id), 0)) from operacion.compra c where c.estado = 'recibida_parcial'), 0)::bigint
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

create or replace function contabilidad.comprobaciones() returns table (codigo text, nombre text, bloqueante boolean, via_a_nombre text, via_a_cent bigint, via_b_nombre text, via_b_cent bigint, ok boolean, unidad text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_a bigint; v_b bigint; v_activo bigint; v_pasivo bigint; v_capital bigint; v_res bigint; v_ind bigint; v_aux bigint;
begin
  unidad := 'mxn';
  -- C1 nota: renglones contra modelos
  select coalesce(sum((snapshot_interno->'comprobaciones'->'c1'->>'renglones_cent')::bigint), 0), coalesce(sum((snapshot_interno->'comprobaciones'->'c1'->>'modelos_cent')::bigint), 0) into v_a, v_b
    from operacion.nota where tipo = 'original';
  codigo := 'C1'; nombre := 'Cada nota: suma de renglones contra suma por modelo'; bloqueante := false; via_a_nombre := 'Suma de renglones'; via_a_cent := v_a; via_b_nombre := 'Suma por modelo'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C2 fuga de piezas
  select coalesce(sum(l.piezas_surtidas), 0), coalesce((select sum(s.piezas) from operacion.pedido_surtido s join operacion.pedido_linea l2 on l2.id = s.pedido_linea_id join operacion.pedido p2 on p2.id = l2.pedido_id where p2.estado = 'enviado'), 0)
    into v_a, v_b from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where p.estado = 'enviado';
  codigo := 'C2'; nombre := 'Piezas surtidas contra piezas que salieron y van en la nota'; bloqueante := false; via_a_nombre := 'Piezas surtidas por renglón'; via_a_cent := v_a; via_b_nombre := 'Piezas por sabor surtido'; via_b_cent := v_b; ok := v_a = v_b; unidad := 'pz'; return next; unidad := 'mxn';
  -- C3 balanza
  select coalesce(sum(debe_cent), 0), coalesce(sum(haber_cent), 0) into v_a, v_b from contabilidad.asiento_linea;
  codigo := 'C3'; nombre := 'Balanza: suma del debe contra suma del haber'; bloqueante := true; via_a_nombre := 'Suma del debe'; via_a_cent := v_a; via_b_nombre := 'Suma del haber'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C4 auxiliares contra control
  select coalesce(sum(abs(mayor_cent - operativo_cent)), 0) into v_aux from contabilidad.reproducir_saldos();
  codigo := 'C4'; nombre := 'Auxiliares operativos contra cuentas de control'; bloqueante := true; via_a_nombre := 'Diferencia total libro contra auxiliares'; via_a_cent := v_aux; via_b_nombre := 'Esperada'; via_b_cent := 0; ok := v_aux = 0; return next;
  -- C5 inventario
  v_a := contabilidad.saldo('1310'); v_b := coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0);
  codigo := 'C5'; nombre := 'Inventario: cuenta 1310 contra kárdex por modelo'; bloqueante := true; via_a_nombre := 'Cuenta 1310'; via_a_cent := v_a; via_b_nombre := 'Valor del kárdex'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C6 pagos aplicados no exceden pagos
  select coalesce(sum(monto_cent), 0) into v_a from operacion.pago_aplicacion;
  select coalesce(sum(p.monto_cent), 0) into v_b from operacion.pago p where operacion.pago_cliente(p.id) is not null and not exists (select 1 from operacion.pago_anulacion an where an.pago_id = p.id);
  codigo := 'C6'; nombre := 'Pagos aplicados no exceden los pagos identificados'; bloqueante := false; via_a_nombre := 'Pagos aplicados'; via_a_cent := v_a; via_b_nombre := 'Pagos identificados'; via_b_cent := v_b; ok := v_a <= v_b and not exists (select 1 from operacion.pago p where operacion.pago_disponible(p.id) < 0); return next;
  -- C7 proveedores por separado
  select coalesce(sum(mayor_cent), 0), coalesce(sum(operativo_cent), 0) into v_a, v_b from contabilidad.reproducir_saldos() r where r.clave in ('proveedor_isaac', 'proveedor_karen');
  codigo := 'C7'; nombre := 'Isaac y Karen: cuentas 2110 y 2120 contra su cuenta y sus pedidos'; bloqueante := false; via_a_nombre := 'Cuentas 2110 y 2120'; via_a_cent := v_a; via_b_nombre := 'Cuenta con el proveedor y pedidos directos'; via_b_cent := v_b;
  ok := not exists (select 1 from contabilidad.reproducir_saldos() r where r.clave in ('proveedor_isaac', 'proveedor_karen') and not r.ok); return next;
  -- C8 socios
  select coalesce(sum(mayor_cent), 0), coalesce(sum(operativo_cent), 0) into v_a, v_b from contabilidad.reproducir_saldos() r where r.clave like 'socio\_%';
  codigo := 'C8'; nombre := 'Socios: posición por cuentas contra la cuenta de socios'; bloqueante := false; via_a_nombre := 'Cuentas de capital y de socios'; via_a_cent := v_a; via_b_nombre := 'Posición neta de la cuenta de socios'; via_b_cent := v_b;
  ok := not exists (select 1 from contabilidad.reproducir_saldos() r where r.clave like 'socio\_%' and not r.ok); return next;
  -- C9 Omar
  select mayor_cent, operativo_cent into v_a, v_b from contabilidad.reproducir_saldos() r where r.clave = 'omar';
  codigo := 'C9'; nombre := 'Omar: renta menos tomas por cuentas contra devengos, tomas y pagos'; bloqueante := false; via_a_nombre := 'Cuentas 2210 menos 1220'; via_a_cent := v_a; via_b_nombre := 'Devengos, tomas y pagos'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C10 asientos cuadrados
  select count(*) into v_a from (select asiento_id from contabilidad.asiento_linea group by asiento_id having sum(debe_cent) <> sum(haber_cent)) q;
  codigo := 'C10'; nombre := 'Asientos cuadrados: ninguno con debe distinto de haber'; bloqueante := true; via_a_nombre := 'Asientos descuadrados'; via_a_cent := v_a; via_b_nombre := 'Esperados'; via_b_cent := 0; ok := v_a = 0; unidad := 'n'; return next; unidad := 'mxn';
  -- C11 periodo cerrado sin asientos nuevos
  select count(*) into v_a from contabilidad.asiento a join contabilidad.periodo p on p.id in (a.periodo_semana_id, a.periodo_mes_id)
    where p.estado in ('aprobado', 'publicado') and p.aprobado_at is not null and a.creado_at > p.aprobado_at;
  codigo := 'C11'; nombre := 'Periodo cerrado sin asientos nuevos'; bloqueante := true; via_a_nombre := 'Asientos creados después de aprobar'; via_a_cent := v_a; via_b_nombre := 'Esperados'; via_b_cent := 0; ok := v_a = 0; unidad := 'n'; return next; unidad := 'mxn';
  -- C12 pedidos a libro
  select count(*) into v_a from operacion.pedido where estado = 'enviado';
  select count(*) into v_b from operacion.pedido p where p.estado = 'enviado' and exists (select 1 from contabilidad.asiento a where a.evento_id = p.evento_envio_id);
  codigo := 'C12'; nombre := 'Pedidos a libro: cada pedido enviado tiene su asiento'; bloqueante := true; via_a_nombre := 'Pedidos enviados'; via_a_cent := v_a; via_b_nombre := 'Pedidos con asiento'; via_b_cent := v_b; ok := v_a = v_b; unidad := 'n'; return next; unidad := 'mxn';
  -- C13 unicidad
  select coalesce(count(comprobante_sha256) - count(distinct comprobante_sha256), 0) into v_a from operacion.pago;
  codigo := 'C13'; nombre := 'Unicidad: ningún comprobante de pago repetido'; bloqueante := false; via_a_nombre := 'Comprobantes repetidos'; via_a_cent := v_a; via_b_nombre := 'Esperados'; via_b_cent := 0; ok := v_a = 0; unidad := 'n'; return next; unidad := 'mxn';
  -- C14 desglose: ventas por cliente contra ingresos del libro
  select coalesce(sum(operacion.pedido_cobrado(p.id)), 0) into v_a from operacion.pedido p where p.estado = 'enviado';
  v_b := contabilidad.saldo('4110') + contabilidad.saldo('4300') + contabilidad.saldo('4910') - contabilidad.saldo('4210') - contabilidad.saldo('4220');
  codigo := 'C14'; nombre := 'Desglose: ventas por cliente contra ingresos de mayoreo del libro'; bloqueante := false; via_a_nombre := 'Notas vigentes de pedidos enviados'; via_a_cent := v_a; via_b_nombre := 'Cuentas 4110, 4300 y 4910 menos 4210 y 4220'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C15 piezas: kardex contra notas y tomas
  select coalesce(sum(-m.cantidad), 0) into v_a from operacion.movimiento_inventario m left join operacion.movimiento_inventario o on o.id = m.reversa_de
    where coalesce(o.tipo, m.tipo) in ('salida_pedido', 'salida_toma_omar');
  select coalesce((select sum(l.piezas_surtidas) from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where p.estado = 'enviado' and operacion.origen_es_bodega(p.origen)), 0)
       + coalesce((select sum(piezas) from operacion.toma_omar where estado = 'autorizada'), 0) into v_b;
  codigo := 'C15'; nombre := 'Piezas: salidas del kárdex contra piezas de notas y tomas'; bloqueante := false; via_a_nombre := 'Salidas netas del kárdex'; via_a_cent := v_a; via_b_nombre := 'Piezas de pedidos de bodega y tomas'; via_b_cent := v_b; ok := v_a = v_b; unidad := 'pz'; return next; unidad := 'mxn';
  -- C16 puente pedidos a libro (utilidad por el camino comercial contra el libro)
  v_res := contabilidad.resultado();
  select coalesce((select sum(operacion.pedido_cobrado(p.id)) from operacion.pedido p where p.estado = 'enviado'), 0)
       + coalesce((select sum(t.piezas * t.precio_cent) from operacion.toma_omar t where t.estado = 'autorizada' and t.precio_cent is not null), 0)
       - coalesce((select sum(s.costo_valor_cent) from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join operacion.pedido p on p.id = l.pedido_id where p.estado = 'enviado'), 0)
       - coalesce((select sum(-m.valor_cent) from operacion.toma_omar t join operacion.movimiento_inventario m on m.id = t.movimiento_id where t.estado = 'autorizada'), 0)
       - coalesce((select sum(monto_cent) from operacion.renta_devengo), 0)
       - coalesce((select sum(monto_cent) from operacion.diferencia_asignacion where responsable = 'castigo'), 0)
       - coalesce((select sum(monto_cent) from operacion.gasto), 0) + coalesce((select sum(g.monto_cent) from operacion.gasto_anulacion an join operacion.gasto g on g.id = an.gasto_id), 0)
       + coalesce((select sum(case when coalesce(o.tipo, m.tipo) in ('merma', 'ajuste_conteo', 'devolucion') then m.valor_cent else 0 end) from operacion.movimiento_inventario m left join operacion.movimiento_inventario o on o.id = m.reversa_de), 0)
       + coalesce((select sum(c.monto_cent) from operacion.cuenta_proveedor_mov c left join operacion.cuenta_proveedor_mov o on o.id = c.reversa_de where coalesce(o.concepto, c.concepto) = 'ajuste'), 0)
       -- Sobrante o faltante de caja (cuenta 7200): ajustes de conteo del efectivo que el puente asienta (migracion 8000).
       + coalesce((select sum(m.monto_cent) from operacion.cuenta_efectivo_mov m join operacion.evento ev on ev.id = m.evento_id left join operacion.cuenta_efectivo_mov o on o.id = m.reversa_de
                    where coalesce(o.concepto, m.concepto) = 'ajuste_conteo' and ev.tipo in ('movimiento_efectivo', 'movimiento_efectivo_anulado')), 0)
    into v_a;
  codigo := 'C16'; nombre := 'Puente pedidos a libro: utilidad comercial contra utilidad del libro'; bloqueante := false; via_a_nombre := 'Utilidad por pedidos, tomas, gastos y ajustes'; via_a_cent := v_a; via_b_nombre := 'Cuentas 4 a 7 del libro'; via_b_cent := v_res; ok := v_a = v_res; return next;
  -- C17 Omar por el camino de la liquidacion semanal
  select operacion.saldo_omar_cuenta() + coalesce((
      select sum((operacion.saldo_omar_semana(w.semana)->>'neto_cent')::bigint) from (
        select distinct operacion.semana_omar_ini(f) as semana from (select devengada_fecha as f from operacion.renta_devengo union select fecha_neg from operacion.toma_omar) z) w
      where not exists (select 1 from operacion.liquidacion_omar q where q.semana_ini = w.semana)), 0) into v_a;
  v_b := contabilidad.saldo('2210') - contabilidad.saldo('1220');
  codigo := 'C17'; nombre := 'Omar: saldo de la liquidación semanal contra el libro'; bloqueante := false; via_a_nombre := 'Semanas liquidadas y abiertas menos pagos'; via_a_cent := v_a; via_b_nombre := 'Cuentas 2210 menos 1220'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C18 / CU6 kardex: entradas menos salidas igual al valor final
  select coalesce(sum(valor_cent), 0) into v_a from operacion.movimiento_inventario;
  v_b := coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0);
  codigo := 'C18'; nombre := 'Kárdex: entradas menos salidas igual al valor final'; bloqueante := true; via_a_nombre := 'Suma de movimientos'; via_a_cent := v_a; via_b_nombre := 'Valor por modelo'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C19 compras con diferencia
  v_a := operacion.saldo_puente(); v_b := contabilidad.saldo('1340');
  codigo := 'C19'; nombre := 'Compras con diferencia: puente operativo contra cuenta 1340'; bloqueante := false; via_a_nombre := 'Faltantes sin responsable'; via_a_cent := v_a; via_b_nombre := 'Cuenta 1340'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C20 cuadre inicial
  v_a := contabilidad.saldo('3990');
  codigo := 'C20'; nombre := 'Cuadre inicial: la diferencia de apertura debe ser cero'; bloqueante := false; via_a_nombre := 'Cuenta 3990'; via_a_cent := v_a; via_b_nombre := 'Esperada'; via_b_cent := 0; ok := v_a = 0; return next;
  -- C21 cadena
  select coalesce(contabilidad.verificar_cadena(), 0) + coalesce(max(substr(folio, 3)::bigint) - count(*), 0) into v_a from contabilidad.asiento;
  codigo := 'C21'; nombre := 'Cadena de hash íntegra y folios sin huecos'; bloqueante := true; via_a_nombre := 'Primer asiento roto y huecos'; via_a_cent := v_a; via_b_nombre := 'Esperado'; via_b_cent := 0; ok := v_a = 0; unidad := 'n'; return next; unidad := 'mxn';
  -- C22 gastos
  select coalesce((select sum(case when contabilidad.cuenta_gasto(g.categoria, pe.origen) ~ '^(5110|6)' then g.monto_cent else 0 end)
                     from operacion.gasto g left join operacion.guia gu on gu.id = g.guia_id left join operacion.pedido pe on pe.id = coalesce(g.pedido_id, gu.pedido_id)
                    where not exists (select 1 from operacion.gasto_anulacion an where an.gasto_id = g.id)), 0)
       + coalesce((select sum(monto_cent) from operacion.renta_devengo), 0)
       + coalesce((select sum(coalesce((catalogo.config_valor('seguro_reenvio_cent', pe.fecha_envio))::text::bigint, 0) * s.piezas)
                     from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id
                    where pe.estado = 'enviado' and pe.origen = 'karen_via_isaac' and s.movimiento_id is null), 0) into v_a;
  select coalesce(sum(saldo_cent), 0) into v_b from contabilidad.saldos() where codigo = '5110' or codigo ~ '^6';
  codigo := 'C22'; nombre := 'Gastos: mini reporte contra cuentas 5110 y 6xxx'; bloqueante := false; via_a_nombre := 'Gastos, renta y seguros de reenvío'; via_a_cent := v_a; via_b_nombre := 'Cuentas 5110 y 6xxx'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C23 efectivo: caja contable contra efectivo operativo (puente de movimientos de efectivo a asientos, migracion 8000)
  v_a := operacion.saldo_efectivo();
  v_b := contabilidad.saldo_deudor('1101') + contabilidad.saldo_deudor('1102');
  codigo := 'C23'; nombre := 'Efectivo: cuentas de efectivo operativas contra caja contable (1101 y 1102)'; bloqueante := false; via_a_nombre := 'Suma de las cuentas de efectivo'; via_a_cent := v_a; via_b_nombre := 'Cuentas 1101 y 1102 del libro'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C24 cajas por persona: cada caja de efectivo contra su dimension en 1101 (suma de diferencias absolutas; 0 cuando todas cuadran)
  select coalesce(sum(abs(x.diferencia_cent)), 0)::bigint into v_a from contabilidad.efectivo_por_caja() x;
  codigo := 'C24'; nombre := 'Cajas por persona: cada caja de efectivo contra su dimensión en 1101'; bloqueante := false; via_a_nombre := 'Suma de diferencias por caja (valor absoluto)'; via_a_cent := v_a; via_b_nombre := 'Cero: cada caja igual a su dimensión del libro'; via_b_cent := 0; ok := v_a = 0; return next;
  -- Identidades de la paridad con el Excel (doc 18)
  v_activo := contabilidad.suma_tipo('A'); v_pasivo := contabilidad.suma_tipo('P'); v_capital := contabilidad.suma_tipo('K'); v_res := contabilidad.resultado();
  codigo := 'CU1'; nombre := 'Identidad I-1: activo igual a pasivo más capital'; bloqueante := true; via_a_nombre := 'Activo'; via_a_cent := v_activo; via_b_nombre := 'Pasivo más capital más resultado'; via_b_cent := v_pasivo + v_capital + v_res; ok := v_activo = v_pasivo + v_capital + v_res; return next;
  v_ind := (v_activo - v_pasivo) - v_capital;
  codigo := 'CU2'; nombre := 'Identidad I-2: resultado igual a la variación del capital'; bloqueante := true; via_a_nombre := 'Ingresos menos costos y gastos'; via_a_cent := v_res; via_b_nombre := 'Activo menos pasivo menos capital aportado'; via_b_cent := v_ind; ok := v_res = v_ind; return next;
  select coalesce((select sum(piezas) from operacion.existencia_sku_ubicacion), 0), coalesce((select sum(piezas) from operacion.existencia_modelo), 0) into v_a, v_b;
  codigo := 'CU3'; nombre := 'Piezas por sabor igual a piezas por modelo'; bloqueante := true; via_a_nombre := 'Suma por sabor'; via_a_cent := v_a; via_b_nombre := 'Suma por modelo'; via_b_cent := v_b; ok := v_a = v_b; unidad := 'pz'; return next; unidad := 'mxn';
end $$;

-- "Explicar este numero" de lo cobrado y del saldo de un pedido con devoluciones, y de cada devolucion. Lo demas lo sigue resolviendo la funcion anterior.
alter function api.explicar_cifra(text) rename to explicar_cifra_antes_devoluciones;
revoke execute on function api.explicar_cifra_antes_devoluciones(text) from public, anon, authenticated;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_id bigint; v_via1 bigint; v_via2 bigint; v_rengs jsonb; nt operacion.nota; v_d operacion.devolucion_cliente; v_p operacion.devolucion_proveedor; v_mov bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  if partes[1] = 'pedido' and partes[2] in ('total', 'saldo') and operacion.devuelto_pedido(partes[3]::bigint) > 0 then
    v_id := partes[3]::bigint;
    select * into nt from operacion.nota where pedido_id = v_id order by id desc limit 1;
    v_rengs := jsonb_build_array(jsonb_build_object('concepto', 'Nota ' || nt.folio_documento, 'monto_cent', nt.total_cent, 'hora', nt.emitida_at, 'fecha_neg', negocio.fecha_neg(nt.emitida_at)) || operacion.evento_info(nt.evento_id))
      || coalesce((select jsonb_agg(jsonb_build_object('concepto', 'Devolución ' || d.folio, 'monto_cent', -d.monto_cent, 'hora', d.creado_at, 'fecha_neg', d.fecha_neg) || operacion.evento_info(d.evento_id) order by d.id)
                     from operacion.devolucion_cliente d where d.pedido_id = v_id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id)), '[]'::jsonb);
    if partes[2] = 'saldo' then
      v_rengs := v_rengs || coalesce((select jsonb_agg(jsonb_build_object('concepto', 'Abono ' || p.folio, 'monto_cent', -a.monto_cent, 'hora', p.hora, 'fecha_neg', p.fecha_neg) || operacion.evento_info(a.evento_id) order by a.id)
                                       from operacion.pago_aplicacion a join operacion.pago p on p.id = a.pago_id where a.pedido_id = v_id), '[]'::jsonb);
      v_via1 := operacion.pedido_saldo(v_id);
    else
      v_via1 := operacion.pedido_cobrado(v_id);
    end if;
    select coalesce(sum((r->>'monto_cent')::bigint), 0) into v_via2 from jsonb_array_elements(v_rengs) r;
    return jsonb_build_object('cifra', p_cifra, 'titulo', case partes[2] when 'saldo' then 'Por cobrar del pedido (nota, menos devoluciones, menos abonos)' else 'Total a saldar (nota menos devoluciones)' end, 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', case partes[2] when 'saldo' then 'Función de saldo del pedido' else 'Función de cobrado del pedido' end, 'via1_valor', v_via1,
                                         'via2', case partes[2] when 'saldo' then 'Nota menos devoluciones menos abonos' else 'Nota menos devoluciones' end, 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'devolucion' and partes[2] = 'cliente' then
    select * into v_d from operacion.devolucion_cliente where id = partes[3]::bigint;
    if not found then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('concepto', m.nombre_canonico || ' ' || sa.nombre_canonico || ': ' || l.piezas || ' pz x precio de la nota', 'monto_cent', l.monto_cent, 'hora', v_d.creado_at, 'fecha_neg', v_d.fecha_neg) || operacion.evento_info(v_d.evento_id) order by l.id), '[]'::jsonb),
           coalesce(sum(l.monto_cent), 0)::bigint - v_d.descuento_prorrateado_cent
      into v_rengs, v_via2 from operacion.devolucion_cliente_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.devolucion_id = v_d.id;
    if v_d.descuento_prorrateado_cent > 0 then
      v_rengs := v_rengs || (jsonb_build_object('concepto', 'Descuento del pedido, en proporcion a las piezas devueltas', 'monto_cent', -v_d.descuento_prorrateado_cent, 'hora', v_d.creado_at, 'fecha_neg', v_d.fecha_neg) || operacion.evento_info(v_d.evento_id));
    end if;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Crédito de la devolución ' || v_d.folio, 'valor', v_d.monto_cent, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Crédito guardado en la devolución', 'via1_valor', v_d.monto_cent, 'via2', 'Suma de piezas por precio de la nota, menos el descuento en proporcion', 'via2_valor', v_via2, 'cuadra', v_d.monto_cent = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'devolucion' and partes[2] = 'proveedor' then
    select * into v_p from operacion.devolucion_proveedor where id = partes[3]::bigint;
    if not found then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('concepto', m.nombre_canonico || ' ' || sa.nombre_canonico || ': ' || l.piezas || ' pz a costo promedio', 'monto_cent', l.valor_cent, 'hora', v_p.creado_at, 'fecha_neg', v_p.fecha_neg) || operacion.evento_info(v_p.evento_id) order by l.id), '[]'::jsonb)
      into v_rengs from operacion.devolucion_proveedor_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.devolucion_id = v_p.id;
    select coalesce(sum(-mi.valor_cent), 0)::bigint into v_via2 from operacion.movimiento_inventario mi join operacion.devolucion_proveedor_linea l on l.movimiento_id = mi.id where l.devolucion_id = v_p.id;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Crédito con el proveedor por la devolución ' || v_p.folio, 'valor', v_p.valor_cent, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Crédito sumado a la cuenta del proveedor', 'via1_valor', v_p.valor_cent, 'via2', 'Valor que salió del kárdex', 'via2_valor', v_via2, 'cuadra', v_p.valor_cent = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  return api.explicar_cifra_antes_devoluciones(p_cifra);
end $$;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra(text) from public, anon;
