-- Cuenta de socios: la senal de salud "Cuadra" deja de ser (puesto por Angelo + puesto por Javier = costo de la compra) y pasa a ser "Libro conciliado".
-- Hallazgo del verificador independiente (ALTA): ese cuadro no es una identidad contable. Marcaba "No cuadra" en estados legitimos (la sociedad paga con su caja, pagos
-- parciales pendientes con el proveedor) porque `aportado_compra_socio` sumaba como "puesto para la compra" todo deposito de un socio a la caja aunque siguiera sin gastarse.
--
-- Definicion por escrito (docs/cuadre-socios-definicion.md, doc 31 de la investigacion): el libro de socios esta conciliado cuando se cumplen TODAS estas identidades,
-- que no dependen de ninguna cifra elegida de antemano:
--  (i)   Auxiliares contra mayor, por socio y por concepto: reembolsos por pagar (2310/2320), capital y utilidades por distribuir (3110/3120, 3310/3320 menos los retiros
--        3210/3220), fondos de la sociedad en su poder (1150/1160) y faltantes por cobrar (1170/1180) contra lo que dicen las tablas operativas del socio.
--  (ii)  Partida doble: toda la balanza (debe = haber), ningun asiento descuadrado, ningun movimiento de socio o de caja sin su asiento y ninguna comprobacion bloqueante
--        en rojo (ademas de las que tocan a los socios).
--  (iii) Doc 31, "suma de los saldos de los socios = efectivo de la sociedad repartido": (a) el efectivo del que parte la Cascada (cajas) es el que dice el libro
--        (1101 y 1102); (b) la identidad de la propia Cascada por dos vias (lo asignado a los socios = efectivo repartido, y los resultados mas lo que tienen en su poder
--        y lo que deben sin ser efectivo suman lo mismo) se cumple con el efectivo real. El efectivo negativo la rompe y se senala.
-- "Diferencia por la compra" (via 1 y via 2) pasa a ser INFORMATIVA: dice cuanto de la compra no lo pusieron los socios con su dinero (lo pago la caja de la sociedad o sigue
-- pendiente con el proveedor) y no decide la salud. El parametro caja_sociedad_cuenta_puesto_pct sigue configurable y SIN DECIDIR (0 = conservador).
--
-- Aditiva: solo create or replace de lecturas (sin DROP, sin GRANT nuevo, sin tocar datos ni el libro de solo insercion).

-- Lo que un socio puso de su dinero para la compra: pagos a proveedores con dinero propio y compras o guias pagadas por el. NO cuenta los depositos a la caja de la empresa
-- (aun sin gastar, o gastados por la sociedad: de quien es ese efectivo es la regla pendiente del dueno, parametro caja_sociedad_cuenta_puesto_pct), ni los gastos de
-- operacion, ni la reinversion de utilidades.
create or replace function operacion.aportado_compra_socio(p_socio bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.aportacion_socio where socio_id = p_socio and ref_tipo in ('compra', 'cuenta_proveedor') $$;

-- Pagos de la sociedad (desde su caja) a proveedores, netos de los deshechos.
create or replace function operacion.pagado_por_sociedad_a_proveedores() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(c.monto_cent), 0)::bigint
  from operacion.cuenta_proveedor_mov c left join operacion.cuenta_proveedor_mov o on o.id = c.reversa_de
  where coalesce(o.concepto, c.concepto) = 'pago_sociedad'
$$;

-- Pagos a proveedores hechos con fondos de la sociedad que un socio tenia en su poder (cobros de clientes en su cuenta), netos de los deshechos.
create or replace function operacion.pagado_con_fondos_de_socios() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(-m.monto_cent), 0)::bigint
  from operacion.cuenta_socio_mov m left join operacion.cuenta_socio_mov o on o.id = m.reversa_de
  where coalesce(o.concepto, m.concepto) = 'entrega_a_proveedor'
$$;

-- Lo que la sociedad aun debe a sus proveedores (suma de los saldos acreedores; el saldo a favor con un proveedor no se compensa con la deuda de otro).
create or replace function operacion.pendiente_con_proveedores() returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(greatest(-operacion.saldo_proveedor(p.id), 0)), 0)::bigint from catalogo.proveedor p $$;

-- ---------------------------------------------------------------------------
-- Libro conciliado: las identidades (i), (ii) y (iii) con sus dos lados. Cada renglon trae su grupo, sus dos cifras y si coinciden.
-- ---------------------------------------------------------------------------
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
  -- Comprobaciones del libro: ninguna bloqueante en rojo, y en verde las de proveedores, socios y cajas por persona (C7, C8, C24 cuando existen; el efectivo total se compara abajo, en (iii)).
  for c in select * from contabilidad.comprobaciones() k where (k.bloqueante and not k.ok) or (k.codigo in ('C7', 'C8', 'C24') and not k.ok) loop
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
  select count(*) into v_n from jsonb_array_elements(v_ver) x where not (x->>'ok')::boolean;
  return jsonb_build_object('libro_conciliado', v_ok, 'fallas', v_n,
    'estado', case when not v_ok then 'revisar' when v_pend > 0 then 'pendiente_proveedor' else 'conciliado' end,
    'etiqueta', case when not v_ok then 'Revisar el libro' when v_pend > 0 then 'Libro conciliado · pendiente de pago al proveedor' else 'Libro conciliado' end,
    'pendiente_proveedor_cent', v_pend, 'verificaciones', v_ver);
end $$;
revoke all on function operacion.cuadre_socios() from public, anon, authenticated;
revoke all on function operacion.pagado_por_sociedad_a_proveedores() from public, anon, authenticated;
revoke all on function operacion.pendiente_con_proveedores() from public, anon, authenticated;
revoke all on function operacion.pagado_con_fondos_de_socios() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cuenta de socios: "diferencia por la compra" (informativa) y el desglose de lo que no pusieron los socios; la salud es `cuadre`.
-- ---------------------------------------------------------------------------
-- Misma firma y mismas llaves que antes (mas las nuevas). `cuadra` se conserva como "las dos vias de la diferencia coinciden" (informativo; NO es la salud del libro).
-- El parametro caja_sociedad_cuenta_puesto_pct (0 a 100, por omision 0, sin decidir) atribuye ese porcentaje de lo que la caja de la sociedad pago al proveedor, por mitades iguales,
-- como "puesto por los socios"; la mitad igual conserva A - J (via 2) y el total se redondea a un numero par para no abrir un centavo entre las vias.
create or replace function operacion.cuenta_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_costo bigint; v_mitad bigint; v_a bigint; v_j bigint; v_ida bigint; v_idj bigint; v_via1_a bigint; v_via2_dobles bigint; v_total bigint; v_fuera jsonb;
  v_pct numeric; v_pc bigint := 0; v_psoc bigint := operacion.pagado_por_sociedad_a_proveedores(); v_pf bigint := operacion.pagado_con_fondos_de_socios(); v_pend bigint := operacion.pendiente_con_proveedores();
begin
  select id into v_ida from catalogo.socio where nombre = 'Angelo';
  select id into v_idj from catalogo.socio where nombre = 'Javier';
  select coalesce(sum(total_cent), 0)::bigint into v_costo from operacion.compra where ambito = 'sociedad' and estado not in ('borrador', 'anulada');
  v_a := operacion.aportado_compra_socio(v_ida) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0) - operacion.saldo_socio(v_ida);
  v_j := operacion.aportado_compra_socio(v_idj) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0) - operacion.saldo_socio(v_idj);
  v_pct := least(greatest(coalesce(catalogo.config_num('caja_sociedad_cuenta_puesto_pct'), 0), 0), 100);
  if v_pct > 0 and v_psoc > 0 then
    v_pc := (floor(v_psoc * v_pct / 100)::bigint / 2) * 2;
  end if;
  v_a := v_a + v_pc / 2; v_j := v_j + v_pc / 2;
  v_mitad := (v_costo + 1) / 2;                     -- hacia arriba, a favor de quien aporta
  v_total := v_a + v_j;
  v_via1_a := v_a - v_mitad;                        -- via 1: lo puesto menos la mitad del costo
  v_via2_dobles := v_a - v_j;                       -- via 2: (A - J) / 2, comparada sin redondeo como 2 x via 1 = A - J
  select coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre, 'monto_cent', p.monto_cent, 'concepto', p.concepto, 'estado', p.estado, 'piezas', p.piezas) order by p.id), '[]'::jsonb) into v_fuera
    from operacion.partida_fuera_sociedad p join catalogo.socio s on s.id = p.socio_id;
  return jsonb_build_object(
    'costo_cent', v_costo, 'mitad_cent', v_mitad,
    'angelo', jsonb_build_object('aportado_cent', v_a, 'puso_capital_cent', operacion.aportado_socio(v_ida, 'capital'), 'puso_reembolsable_cent', operacion.aportado_socio(v_ida, 'reembolsable'),
                                 'directo_cent', operacion.aportado_compra_socio(v_ida),
                                 'fuera_sociedad_cent', coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0), 'debe_cent', operacion.saldo_socio(v_ida),
                                 'diferencia_cent', v_via1_a),
    'javier', jsonb_build_object('aportado_cent', v_j, 'puso_capital_cent', operacion.aportado_socio(v_idj, 'capital'), 'puso_reembolsable_cent', operacion.aportado_socio(v_idj, 'reembolsable'),
                                 'directo_cent', operacion.aportado_compra_socio(v_idj),
                                 'fuera_sociedad_cent', coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0), 'debe_cent', operacion.saldo_socio(v_idj),
                                 'diferencia_cent', v_j - v_mitad),
    -- Signo: > 0 Javier debe a Angelo; < 0 Angelo debe a Javier.
    'javier_debe_a_angelo_cent', v_via1_a,
    'via1_cent', v_via1_a, 'via2_cent', v_via2_dobles / 2, 'via2_resto_cent', v_via2_dobles % 2,
    'financiado_por_sociedad_cent', v_costo - v_total,
    -- Desglose del costo: dinero propio de los socios (compras, guias y pagos a proveedores) + caja de la sociedad + fondos de la sociedad en poder de un socio + pendiente con
    -- el proveedor + otros (apertura, ajustes, pedidos directos). Siempre suma el costo.
    'directo_socios_cent', operacion.aportado_compra_socio(v_ida) + operacion.aportado_compra_socio(v_idj),
    'pagado_por_sociedad_cent', v_psoc, 'pagado_con_fondos_cent', v_pf, 'pendiente_proveedor_cent', v_pend,
    'otros_cent', v_costo - (operacion.aportado_compra_socio(v_ida) + operacion.aportado_compra_socio(v_idj)) - v_psoc - v_pf - v_pend,
    'caja_cuenta_puesto_pct', v_pct, 'puesto_por_caja_cent', v_pc,
    'cuadra', (2 * v_via1_a = v_via2_dobles) or (v_costo % 2 = 1 and abs(2 * v_via1_a - v_via2_dobles) = 1),
    'cuadre', operacion.cuadre_socios(),
    'partidas_fuera_sociedad', v_fuera);
end $$;
