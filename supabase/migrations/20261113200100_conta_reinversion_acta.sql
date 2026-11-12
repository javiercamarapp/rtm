-- Correccion: firmar un acta con reinversion fallaba al confirmar ("el evento no cuadra"): el libro 'reinversion' (baja de utilidad por distribuir, cuenta 3310) no tenia cuenta en
-- contabilidad.lineas_de_evento, mientras la aportacion de capital que genera si acredita 3110.
--
-- Esta version NO copia la funcion completa: la envuelve. La definicion vigente (la que haya dejado la ultima migracion anterior, incluidas las de puente de efectivo, devolucion parcial
-- y apertura) pasa a lineas_de_evento_hist_base, intacta, y la nueva agrega las lineas del libro 'reinversion' (debe 3310) SOLO cuando el asiento de la base esta descuadrado exactamente por ese monto: la base descarta
-- las lineas sin cuenta antes de agrupar, asi que no se pueden recuperar de su salida. Si algun dia la base ya trae la rama, queda balanceada y la envoltura no agrega nada. Debe aplicarse DESPUES de cualquier migracion que redefina la funcion completa (por eso su prefijo es el mas alto de la cadena);
-- aditiva: no toca datos ni asientos ya hechos.
alter function contabilidad.lineas_de_evento(bigint) rename to lineas_de_evento_hist_base;

create function contabilidad.lineas_de_evento(p_evento bigint)
returns table (cuenta text, debe_cent bigint, haber_cent bigint, cliente_id bigint, proveedor_id bigint, socio_id bigint, modelo_id bigint, pedido_id bigint, nota text)
language sql stable security definer set search_path = ''
as $$
  with base as (select * from contabilidad.lineas_de_evento_hist_base(p_evento)),
  desbalance as (select coalesce(sum(b.debe_cent), 0) - coalesce(sum(b.haber_cent), 0) as d from base b),
  extra as (
    select contabilidad.cta_socio(l.socio_id, 3310) as cuenta, (-l.monto_cent)::bigint as s, l.socio_id
    from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
    where l.evento_id = p_evento and coalesce(o.concepto, l.concepto) = 'reinversion'),
  completa as (select coalesce(sum(e.s), 0) as t from extra e),
  l as (
    select b.cuenta, (b.debe_cent - b.haber_cent)::bigint as s, b.cliente_id, b.proveedor_id, b.socio_id, b.modelo_id, b.pedido_id, b.nota from base b
    union all
    select e.cuenta, e.s, null::bigint, null::bigint, e.socio_id, null::bigint, null::bigint, 'Libro del socio: reinversion'
    from extra e cross join desbalance d cross join completa c where c.t <> 0 and d.d = -c.t)
  select x.cuenta, greatest(x.s, 0)::bigint, greatest(-x.s, 0)::bigint, x.cliente_id, x.proveedor_id, x.socio_id, x.modelo_id, x.pedido_id, x.nota
  from (select l.cuenta, sum(l.s)::bigint as s, l.cliente_id, l.proveedor_id, l.socio_id, l.modelo_id, l.pedido_id, min(l.nota) as nota
        from l group by l.cuenta, l.cliente_id, l.proveedor_id, l.socio_id, l.modelo_id, l.pedido_id) x
  where x.s <> 0
  order by x.cuenta, x.cliente_id nulls first, x.proveedor_id nulls first, x.socio_id nulls first, x.modelo_id nulls first, x.pedido_id nulls first
$$;
revoke execute on function contabilidad.lineas_de_evento(bigint) from public, anon, authenticated;
revoke execute on function contabilidad.lineas_de_evento_hist_base(bigint) from public, anon, authenticated;
