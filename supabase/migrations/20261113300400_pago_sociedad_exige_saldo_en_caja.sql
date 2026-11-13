-- Decision del dueno (13-nov): el pago de la sociedad a un proveedor se BLOQUEA cuando la caja de la sociedad de la que sale no tiene saldo suficiente.
-- Antes dejaba 'Caja de la empresa' en negativo (otros escritores, como el gasto de la empresa, ya lo rechazaban) y ponia en rojo la identidad iii-cascada del Libro conciliado.
-- La guarda vive en la funcion de escritura (no solo en la pantalla) y corre ANTES de crear evento o asiento. Las demas vias no cambian: cobro de cliente aplicado a la cuenta del
-- proveedor, pago de un socio con dinero propio (reembolso por omision o capital si lo declara) y pago desde fondos en poder de un socio.
-- El pago sale de 'Caja de la empresa' (asi lo asienta el puente de efectivo, t_efectivo_pago_proveedor). Se toma el bloqueo exclusivo del dinero (el mismo que usan los demas
-- escritores en modo compartido) para que dos pagos simultaneos no gasten el mismo saldo: el segundo espera, relee el saldo y, si ya no alcanza, se rechaza. Saldo exacto: se permite.
-- Aditiva: create or replace con la misma firma (conserva los permisos; sin GRANT nuevo, sin DROP). Anular un pago (reversa) devuelve el efectivo y no necesita guarda.
create or replace function operacion.registrar_pago_proveedor_sociedad(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_fecha date default null, p_nota text default null,
                                                            p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_prov bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_id bigint; v_res jsonb; v_caja bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago_proveedor_sociedad', 'p', p_proveedor, 'm', p_monto_cent, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  perform operacion.bloquear_dinero(true);
  v_caja := operacion.cuenta_efectivo_id('Caja de la empresa');
  if v_caja is null or operacion.saldo_efectivo(v_caja) < p_monto_cent then
    raise exception 'no hay saldo en la caja de la sociedad; registra el pago como cobro de cliente aplicado al proveedor o como pago de un socio con su dinero' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || v_prov, 0));
  v_ev := operacion.crear_evento('pago_proveedor_sociedad', v_fecha, p_clave_idem, jsonb_build_object('proveedor', p_proveedor, 'monto_cent', p_monto_cent), p_mensaje_origen);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
    values (v_prov, v_fecha, 'pago_sociedad', p_monto_cent, coalesce(p_nota, 'Pago de la sociedad a ' || p_proveedor), v_ev) returning id into v_id;
  v_res := jsonb_build_object('movimiento_id', v_id, 'saldo_proveedor_cent', operacion.saldo_proveedor(v_prov));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;
