-- El efectivo de la Cascada (operacion.saldo_efectivo, total) y el de Contabilidad (cuenta 1101 del libro) diferian por los pagos de la sociedad a un proveedor:
-- el libro los descuenta de 1101 (contrapartida del pago_sociedad), pero registrar_pago_proveedor_sociedad no escribe en ninguna caja de efectivo, asi que la Cascada
-- seguia contando ese efectivo y "Disponible para repartir" quedaba sobrestimado por el monto pagado.
-- Cambio ADITIVO (solo redefine lecturas y agrega una comprobacion; no escribe datos ni toca el libro de solo insercion). NO decide de que caja sale el pago (regla pendiente
-- del dueno): el TOTAL de efectivo descuenta el pago de la sociedad, y cada caja conserva su saldo propio hasta que el dueno indique la caja.

-- Pagos de la sociedad a proveedores, netos de los que se deshicieron (la reversa lleva el signo contrario y apunta al pago original).
create function operacion.pagos_sociedad_proveedor() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(c.monto_cent), 0)::bigint
  from operacion.cuenta_proveedor_mov c left join operacion.cuenta_proveedor_mov o on o.id = c.reversa_de
  where coalesce(o.concepto, c.concepto) = 'pago_sociedad'
$$;

create or replace function operacion.saldo_efectivo(p_cuenta bigint default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (coalesce(sum(m.monto_cent), 0)
          + case
              when p_cuenta is null then operacion.apertura_efectivo(null) - operacion.pagos_sociedad_proveedor()
              else coalesce((select operacion.apertura_efectivo(c.socio_id) from operacion.cuenta_efectivo c where c.id = p_cuenta and c.activa and c.titular = 'socio' and c.tipo = 'caja'), 0)
            end)::bigint
  from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id
  where c.activa and (p_cuenta is null or c.id = p_cuenta)
$$;

-- CA2: el efectivo TOTAL del libro (1101) contra el que usa la Cascada. Si algun flujo mueve efectivo en un lado y no en el otro, queda en rojo.
-- No es bloqueante (como CA1) y su codigo queda fuera del patron C<n> para no alterar los reportes semanal y mensual.
create or replace function contabilidad.comprobaciones() returns table (codigo text, nombre text, bloqueante boolean, via_a_nombre text, via_a_cent bigint, via_b_nombre text, via_b_cent bigint, ok boolean, unidad text)
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
  return query select 'CA2'::text, 'Efectivo total: libro (1101) contra el efectivo de la Cascada y Disponible para repartir'::text, false,
                      'Cuenta 1101 del libro'::text, contabilidad.saldo_deudor('1101'),
                      'Efectivo de la Cascada'::text, operacion.saldo_efectivo(),
                      contabilidad.saldo_deudor('1101') = operacion.saldo_efectivo(),
                      'mxn'::text;
end $$;

revoke all on function operacion.pagos_sociedad_proveedor() from public, anon, authenticated;
revoke all on function contabilidad.comprobaciones() from public, anon, authenticated;
