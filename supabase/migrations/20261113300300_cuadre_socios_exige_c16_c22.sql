-- Libro conciliado (ronda de verificacion): la senal exige tambien C16 (utilidad comercial contra utilidad del libro) y C22 (gastos), porque de esos datos sale la utilidad que se reparte
-- 50/50; antes /socios decia "Conciliado" con C16 o C22 en rojo. `fallas` deja de inflarse con el renglon resumen de bloqueantes y `fallas_nota` lo explica.
-- Aditiva: create or replace de una lectura (misma firma, sin DROP, sin GRANT nuevo).
create or replace function operacion.cuadre_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ver jsonb := '[]'::jsonb; v_ok boolean := true; s record; c record; v_a bigint; v_b bigint; v_rev text;
  v_n bigint; v_pend bigint := operacion.pendiente_con_proveedores(); v_hoy date := negocio.hoy(); v_cas jsonb; v_err text; v_idok boolean; v_e_op bigint; v_e_libro bigint;
  v_det jsonb := '[]'::jsonb;
begin
  -- (i) Auxiliares contra mayor, por socio y por concepto.
  for s in select id, nombre from catalogo.socio order by nombre loop
    v_a := contabilidad.saldo(contabilidad.cta_socio(s.id, 2310));
    v_b := operacion.aportado_socio(s.id, 'reembolsable') + operacion.libro_socio(s.id, 'pago_reembolso');
    v_ver := v_ver || jsonb_build_object('id', 'i-reembolsos-' || lower(s.nombre), 'grupo', 'auxiliares', 'nombre', 'Reembolsos por pagar a ' || s.nombre,
      'a_nombre', 'Mayor: cuenta ' || contabilidad.cta_socio(s.id, 2310), 'a_cent', v_a, 'b_nombre', 'Auxiliar: gastos y dinero propio por reembolsar menos lo reembolsado', 'b_cent', v_b, 'ok', v_a = v_b);
    v_ok := v_ok and v_a = v_b;
    v_a := contabilidad.saldo(contabilidad.cta_socio(s.id, 3110)) + contabilidad.saldo(contabilidad.cta_socio(s.id, 3310)) - contabilidad.saldo(contabilidad.cta_socio(s.id, 3210));
    v_b := operacion.aportado_socio(s.id, 'capital') + operacion.libro_socio(s.id) - operacion.libro_socio(s.id, 'pago_reembolso') - contabilidad.fuera_sociedad(s.id, null);
    v_ver := v_ver || jsonb_build_object('id', 'i-capital-' || lower(s.nombre), 'grupo', 'auxiliares', 'nombre', 'Capital y utilidades por distribuir de ' || s.nombre,
      'a_nombre', 'Mayor: capital + utilidades acumuladas - retiros (' || contabilidad.cta_socio(s.id, 3110) || ', ' || contabilidad.cta_socio(s.id, 3310) || ', ' || contabilidad.cta_socio(s.id, 3210) || ')', 'a_cent', v_a,
      'b_nombre', 'Auxiliar: capital aportado + libro del socio sin reembolsos', 'b_cent', v_b, 'ok', v_a = v_b);
    v_ok := v_ok and v_a = v_b;
    v_a := contabilidad.saldo(contabilidad.cta_socio(s.id, 1150));
    v_b := operacion.saldo_socio(s.id, 'fondos');
    v_ver := v_ver || jsonb_build_object('id', 'i-fondos-' || lower(s.nombre), 'grupo', 'auxiliares', 'nombre', 'Fondos de la sociedad en poder de ' || s.nombre,
      'a_nombre', 'Mayor: cuenta ' || contabilidad.cta_socio(s.id, 1150), 'a_cent', v_a, 'b_nombre', 'Auxiliar: cuenta del socio (fondos)', 'b_cent', v_b, 'ok', v_a = v_b);
    v_ok := v_ok and v_a = v_b;
    v_a := contabilidad.saldo(contabilidad.cta_socio(s.id, 1170));
    v_b := operacion.saldo_socio(s.id, 'diferencia');
    v_ver := v_ver || jsonb_build_object('id', 'i-faltantes-' || lower(s.nombre), 'grupo', 'auxiliares', 'nombre', 'Faltantes por cobrar a ' || s.nombre,
      'a_nombre', 'Mayor: cuenta ' || contabilidad.cta_socio(s.id, 1170), 'a_cent', v_a, 'b_nombre', 'Auxiliar: cuenta del socio (faltantes)', 'b_cent', v_b, 'ok', v_a = v_b);
    v_ok := v_ok and v_a = v_b;
  end loop;
  -- (ii) Partida doble.
  select coalesce(sum(debe_cent), 0), coalesce(sum(haber_cent), 0) into v_a, v_b from contabilidad.asiento_linea;
  v_ver := v_ver || jsonb_build_object('id', 'ii-balanza', 'grupo', 'partida_doble', 'nombre', 'Balanza: debe igual a haber en todo el libro', 'a_nombre', 'Suma del debe', 'a_cent', v_a, 'b_nombre', 'Suma del haber', 'b_cent', v_b, 'ok', v_a = v_b);
  v_ok := v_ok and v_a = v_b;
  select count(*) into v_n from (select l.asiento_id from contabilidad.asiento_linea l group by l.asiento_id having sum(l.debe_cent) <> sum(l.haber_cent)) q;
  v_ver := v_ver || jsonb_build_object('id', 'ii-asientos', 'grupo', 'partida_doble', 'nombre', 'Ningun asiento con debe distinto de haber', 'a_nombre', 'Asientos descuadrados', 'a_cent', v_n, 'b_nombre', 'Esperados', 'b_cent', 0, 'ok', v_n = 0, 'unidad', 'n');
  v_ok := v_ok and v_n = 0;
  select count(distinct e.id) into v_n from operacion.evento e
   where not exists (select 1 from contabilidad.asiento a where a.evento_id = e.id)
     and (exists (select 1 from operacion.aportacion_socio x where x.evento_id = e.id) or exists (select 1 from operacion.cuenta_socio_mov x where x.evento_id = e.id)
          or exists (select 1 from operacion.socio_libro x where x.evento_id = e.id) or exists (select 1 from operacion.cuenta_efectivo_mov x where x.evento_id = e.id))
     and exists (select 1 from contabilidad.lineas_de_evento(e.id));
  v_ver := v_ver || jsonb_build_object('id', 'ii-sin-asiento', 'grupo', 'partida_doble', 'nombre', 'Ningun movimiento de socio o de caja sin su asiento', 'a_nombre', 'Eventos de socios y cajas sin asiento', 'a_cent', v_n, 'b_nombre', 'Esperados', 'b_cent', 0, 'ok', v_n = 0, 'unidad', 'n');
  v_ok := v_ok and v_n = 0;
  -- Comprobaciones del libro: ninguna bloqueante en rojo, y en verde las de proveedores (C7), socios (C8), cajas por persona (C24) y las DOS que respaldan la utilidad que se reparte 50/50:
  -- C16 (utilidad comercial por pedidos contra la utilidad del libro) y C22 (gastos contra las cuentas 5110 y 6xxx). Ambas dan 0 = 0 en una base vacia (sin ventas ni gastos), asi que no hay rojo falso;
  -- si algun dia no hubiera datos, el cero contra cero sigue siendo verde. C9 y C17 (saldo de Omar) quedan fuera a proposito: miden la deuda con Omar (cuentas 2210 y 1220), no la utilidad,
  -- cuyos devengos y tomas ya entran en C16; el efectivo total se compara abajo, en (iii).
  for c in select * from contabilidad.comprobaciones() k where (k.bloqueante and not k.ok) or (k.codigo in ('C7', 'C8', 'C16', 'C22', 'C24') and not k.ok) loop
    v_ver := v_ver || jsonb_build_object('id', 'ii-' || lower(c.codigo), 'grupo', 'comprobaciones', 'nombre', 'Comprobacion ' || c.codigo || ' en rojo: ' || c.nombre,
      'a_nombre', c.via_a_nombre, 'a_cent', c.via_a_cent, 'b_nombre', c.via_b_nombre, 'b_cent', c.via_b_cent, 'ok', false, 'unidad', c.unidad);
    v_ok := false;
  end loop;
  select count(*) into v_n from contabilidad.comprobaciones() k where k.bloqueante and not k.ok;
  v_ver := v_ver || jsonb_build_object('id', 'ii-bloqueantes', 'grupo', 'comprobaciones', 'nombre', 'Ninguna comprobacion bloqueante en rojo', 'a_nombre', 'Comprobaciones bloqueantes en rojo', 'a_cent', v_n, 'b_nombre', 'Esperadas', 'b_cent', 0, 'ok', v_n = 0, 'unidad', 'n');
  -- (iii) Efectivo repartido: el de las cajas es el del libro, y la identidad de la Cascada se cumple con el.
  v_e_op := operacion.saldo_efectivo(); v_e_libro := contabilidad.saldo_deudor('1101') + contabilidad.saldo_deudor('1102');
  v_ver := v_ver || jsonb_build_object('id', 'iii-efectivo', 'grupo', 'efectivo_repartido', 'nombre', 'El efectivo del que parte la Cascada es el del libro',
    'a_nombre', 'Cajas de efectivo (Cascada)', 'a_cent', v_e_op, 'b_nombre', 'Libro: cuentas 1101 y 1102', 'b_cent', v_e_libro, 'ok', v_e_op = v_e_libro);
  v_ok := v_ok and v_e_op = v_e_libro;
  begin
    v_cas := operacion.cascada_periodo(operacion.semana_omar_ini(v_hoy), v_hoy);
    v_idok := coalesce((v_cas->'identidad'->>'cuadra')::boolean, false);
    v_a := (v_cas->'identidad'->>'via1_cent')::bigint; v_b := (v_cas->'identidad'->>'efectivo_repartido_cent')::bigint; v_err := null;
  exception when others then
    v_idok := false; v_a := 0; v_b := 0; v_err := sqlerrm;
  end;
  v_ver := v_ver || jsonb_build_object('id', 'iii-cascada', 'grupo', 'efectivo_repartido', 'nombre', 'Suma de lo asignado a los socios igual al efectivo repartido (identidad del doc 31)',
    'a_nombre', 'Asignado a los socios (reembolsos y utilidad menos anticipos)', 'a_cent', v_a, 'b_nombre', 'Efectivo repartido por la Cascada', 'b_cent', v_b, 'ok', v_idok, 'detalle', v_err);
  v_ok := v_ok and v_idok;
  -- `fallas` cuenta identidades distintas en rojo, NO causas: una causa real (p. ej. un gasto alterado) puede romper a la vez el mayor, la balanza y una comprobacion. El renglon resumen
  -- 'ii-bloqueantes' no se cuenta porque repite las comprobaciones bloqueantes que ya aparecen una por una.
  select count(*) into v_n from jsonb_array_elements(v_ver) x where not (x->>'ok')::boolean and x->>'id' <> 'ii-bloqueantes';
  return jsonb_build_object('libro_conciliado', v_ok, 'fallas', v_n,
    'estado', case when not v_ok then 'revisar' when v_pend > 0 then 'pendiente_proveedor' else 'conciliado' end,
    'etiqueta', case when not v_ok then 'Revisar el libro' when v_pend > 0 then 'Libro conciliado · pendiente de pago al proveedor' else 'Libro conciliado' end,
    'fallas_nota', 'Cuenta identidades en rojo, no causas: una misma causa puede romper varias (mayor, balanza, comprobaciones).', 'pendiente_proveedor_cent', v_pend, 'verificaciones', v_ver);
end $$;
revoke all on function operacion.cuadre_socios() from public, anon, authenticated;
