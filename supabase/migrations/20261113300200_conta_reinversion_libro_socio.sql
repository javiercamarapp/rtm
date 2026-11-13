-- Correccion: firmar un acta de corte CON REINVERSION fallaba al confirmar ("el evento ... (cierre_reparto_firmado) no cuadra: debe X contra haber Y"). El libro del socio con concepto
-- 'reinversion' (baja de utilidades por distribuir, cuenta 3310/3320) no tenia cuenta en el mapeo de conceptos, mientras la aportacion de capital que genera si acredita 3110/3120.
--
-- Version vigente en esta rama: la de contabilidad.lineas_de_evento_base (la definicion de 20261110002300_f3c_apertura.sql, que 20261112400000_puente_efectivo_asientos.sql renombro y
-- envuelve). Es copia fiel con UNA rama nueva: when 'reinversion' then 3310 (debe: reduce utilidad por distribuir; el monto del libro es negativo y la linea se asienta como -monto).
-- Aditiva (create or replace; conserva los permisos), no toca datos ni asientos hechos.
--
-- NOTA DE INTEGRACION: la rama lane/historial-acta trae 20261113200100_conta_reinversion_acta.sql, que corrige lo mismo envolviendo lineas_de_evento (rename a
-- lineas_de_evento_hist_base). Al integrar ambas hay que dejar UNA sola: si se conserva esta, descartar la de historial-acta (o su envoltura queda inerte porque la base ya cuadra, pero el rename
-- chocaria con esta cadena). No duplicar la redefinicion.
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

