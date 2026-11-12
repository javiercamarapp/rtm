-- Correccion: firmar un acta con reinversion fallaba al confirmar ("el evento no cuadra"): el libro 'reinversion' (baja de utilidad por distribuir, cuenta 3310) no tenia cuenta en
-- contabilidad.lineas_de_evento, mientras la aportacion de capital que genera si acredita 3110.
--
-- Esta version NO copia la funcion completa: la envuelve. La definicion vigente (la que haya dejado la ultima migracion anterior, incluidas las de puente de efectivo, devolucion parcial
-- y apertura) pasa a lineas_de_evento_hist_base, intacta, y la nueva solo completa la cuenta de la linea del libro 'reinversion' cuando la base la deja vacia. Si algun dia la base ya
-- trae la rama, el coalesce no cambia nada. Debe aplicarse DESPUES de cualquier migracion que redefina la funcion completa (por eso su prefijo es el mas alto de la cadena);
-- aditiva: no toca datos ni asientos ya hechos.
alter function contabilidad.lineas_de_evento(bigint) rename to lineas_de_evento_hist_base;

create function contabilidad.lineas_de_evento(p_evento bigint)
returns table (cuenta text, debe_cent bigint, haber_cent bigint, cliente_id bigint, proveedor_id bigint, socio_id bigint, modelo_id bigint, pedido_id bigint, nota text)
language sql stable security definer set search_path = ''
as $$
  select coalesce(x.cuenta, case when x.nota = 'Libro del socio: reinversion' then contabilidad.cta_socio(x.socio_id, 3310) end),
         x.debe_cent, x.haber_cent, x.cliente_id, x.proveedor_id, x.socio_id, x.modelo_id, x.pedido_id, x.nota
  from contabilidad.lineas_de_evento_hist_base(p_evento) x
$$;
revoke execute on function contabilidad.lineas_de_evento(bigint) from public, anon, authenticated;
revoke execute on function contabilidad.lineas_de_evento_hist_base(bigint) from public, anon, authenticated;
