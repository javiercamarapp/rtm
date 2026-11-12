-- Las cajas de efectivo de la apertura firmada no llegaban a Socios ni a la Cascada: la categoria 'caja' de la apertura se publica en la cuenta 1101 del libro con la persona
-- como dimension, pero operacion.saldo_efectivo (que leen efectivo_sociedad, la Cascada y Disponible para repartir) solo sumaba los movimientos del libro de cajas de efectivo.
-- Cambio ADITIVO (solo redefine lecturas y agrega una funcion y una comprobacion): el efectivo de la apertura firmada se suma a la caja de cada persona, como ya se hace con
-- los fondos en poder (1150/1160), el capital y los reembolsos. No se escribe ningun dato ni se toca el libro de solo insercion.

-- Efectivo que la apertura firmada (no reversada) puso en las cajas: de una persona, o el total si no se indica.
create function operacion.apertura_efectivo(p_socio bigint default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.debe_cent - l.haber_cent), 0)::bigint
  from apertura.sesion s join contabilidad.asiento a on a.evento_id = s.evento_id and a.es_apertura
       join contabilidad.asiento_linea l on l.asiento_id = a.id
  where s.estado = 'firmada' and l.cuenta = '1101' and (p_socio is null or l.socio_id = p_socio)
    and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)
$$;

create or replace function operacion.saldo_efectivo(p_cuenta bigint default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (coalesce(sum(m.monto_cent), 0)
          + case
              when p_cuenta is null then operacion.apertura_efectivo(null)
              else coalesce((select operacion.apertura_efectivo(c.socio_id) from operacion.cuenta_efectivo c where c.id = p_cuenta and c.activa and c.titular = 'socio' and c.tipo = 'caja'), 0)
            end)::bigint
  from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id
  where c.activa and (p_cuenta is null or c.id = p_cuenta)
$$;

-- La comprobacion CA1 compara el efectivo que la apertura puso en el libro (1101) con el que ven las cajas de efectivo (Socios y Cascada). Fuera del patron C<n> a proposito:
-- los reportes semanal y mensual solo muestran C1 a C22. No es bloqueante: avisa, no detiene los reportes.
alter function contabilidad.comprobaciones() rename to comprobaciones_base;
revoke all on function contabilidad.comprobaciones_base() from public, anon, authenticated;

create function contabilidad.comprobaciones() returns table (codigo text, nombre text, bloqueante boolean, via_a_nombre text, via_a_cent bigint, via_b_nombre text, via_b_cent bigint, ok boolean, unidad text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  return query select * from contabilidad.comprobaciones_base();
  return query select 'CA1'::text, 'Efectivo de la apertura: libro (1101) contra las cajas de efectivo que ven Socios y la Cascada'::text, false,
                      'Cuenta 1101 por la apertura'::text, contabilidad.apertura_saldo('1101'),
                      'Cajas de efectivo por la apertura'::text,
                      (select coalesce(sum(operacion.apertura_efectivo(c.socio_id)), 0)::bigint from operacion.cuenta_efectivo c where c.activa and c.titular = 'socio' and c.tipo = 'caja'),
                      contabilidad.apertura_saldo('1101') = (select coalesce(sum(operacion.apertura_efectivo(c.socio_id)), 0)::bigint from operacion.cuenta_efectivo c where c.activa and c.titular = 'socio' and c.tipo = 'caja'),
                      'mxn'::text;
end $$;
