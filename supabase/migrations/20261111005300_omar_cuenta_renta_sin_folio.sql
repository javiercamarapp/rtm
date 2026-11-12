-- La cuenta de Omar ya no expone el folio del pedido en la renta (hallazgo H07): la renta se agrupa POR DIA, sin folio, sin modelo (varios pedidos del mismo
-- dia suman en una fila) y con una referencia propia derivada de la fecha. Las reversas de renta restan en el dia en que ocurrieron; si un dia queda neto
-- negativo la referencia es "Ajuste". Un dia que netea cero no aparece. Mismas columnas y tipos que antes; las tomas y los pagos no cambian.
create or replace view operacion.v_omar_cuenta_base with (security_barrier = true) as
  select 'renta'::text as concepto, r.devengada_fecha as fecha,
         (case when sum(r.monto_cent) < 0 then 'Ajuste ' else 'R-' end || to_char(r.devengada_fecha, 'YYYYMMDD'))::text as referencia,
         null::text as modelo, sum(r.piezas)::int as piezas,
         (sum(r.monto_cent) / nullif(sum(r.piezas), 0))::bigint as tarifa, sum(r.monto_cent)::bigint as importe
  from operacion.renta_devengo r
  group by r.devengada_fecha
  having sum(r.monto_cent) <> 0
  union all
  select 'toma', t.fecha_neg, t.folio, m.nombre_canonico, t.piezas, t.precio_cent, -(t.piezas * t.precio_cent)
  from operacion.toma_omar t join catalogo.modelo m on m.id = t.modelo_id where t.estado = 'autorizada' and t.precio_cent is not null
  union all
  select 'pago', p.fecha_neg, p.folio, null, null, null, case p.sentido when 'a_omar' then p.monto_cent else -p.monto_cent end from operacion.pago_omar p;
