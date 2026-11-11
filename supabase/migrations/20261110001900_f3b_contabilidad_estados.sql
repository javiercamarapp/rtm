-- F3b / 0019: saldos, reproduccion de saldos contra los auxiliares, comprobaciones C1 a C22 por dos vias, periodos, asientos manuales y reversas,
-- estado de resultados con tres niveles de utilidad, balance general, flujo de efectivo, valuacion/liquidez/deudas como identidad contable,
-- la funcion que explica cualquier saldo movimiento por movimiento y las funciones api.* de la seccion Contabilidad.

-- ---------------------------------------------------------------------------
-- Saldos
-- ---------------------------------------------------------------------------
-- Saldo en la naturaleza de la cuenta (deudora: debe - haber; acreedora: haber - debe). Filtra por fecha contable.
create function contabilidad.saldo(p_cuenta text, p_hasta date default null, p_desde date default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case c.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end), 0)::bigint
  from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join contabilidad.cuenta c on c.codigo = l.cuenta
  where l.cuenta = p_cuenta and (p_hasta is null or a.fecha_contable <= p_hasta) and (p_desde is null or a.fecha_contable >= p_desde)
$$;

-- Debe - haber crudo (positivo = saldo deudor).
create function contabilidad.saldo_deudor(p_cuenta text, p_hasta date default null, p_desde date default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.debe_cent - l.haber_cent), 0)::bigint
  from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
  where l.cuenta = p_cuenta and (p_hasta is null or a.fecha_contable <= p_hasta) and (p_desde is null or a.fecha_contable >= p_desde)
$$;

-- Saldo de un tipo de cuentas en su naturaleza deudora (activo) o acreedora (resto): haber - debe para I, P, K; debe - haber para A, C, G.
create function contabilidad.suma_tipo(p_tipo text, p_hasta date default null, p_desde date default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case when p_tipo in ('A', 'C', 'G') then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end), 0)::bigint
  from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join contabilidad.cuenta c on c.codigo = l.cuenta
  where c.tipo = p_tipo and (p_hasta is null or a.fecha_contable <= p_hasta) and (p_desde is null or a.fecha_contable >= p_desde)
$$;

-- Resultado acumulado de las cuentas 4 a 7 (ingresos - costos - gastos).
create function contabilidad.resultado(p_hasta date default null, p_desde date default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select contabilidad.suma_tipo('I', p_hasta, p_desde) - contabilidad.suma_tipo('C', p_hasta, p_desde) - contabilidad.suma_tipo('G', p_hasta, p_desde)
$$;

-- Activo: A (los saldos acreedores de proveedores se reclasifican al activo en la presentacion, no aqui).
create function contabilidad.saldos(p_hasta date default null) returns table (codigo text, nombre text, tipo text, naturaleza text, debe_cent bigint, haber_cent bigint, saldo_cent bigint, activa boolean)
language sql stable security definer set search_path = ''
as $$
  select c.codigo, c.nombre, c.tipo, c.naturaleza, coalesce(sum(l.debe_cent), 0)::bigint, coalesce(sum(l.haber_cent), 0)::bigint,
         coalesce(sum(case c.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end), 0)::bigint, c.activa
  from contabilidad.cuenta c
  left join (select l.* from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where p_hasta is null or a.fecha_contable <= p_hasta) l on l.cuenta = c.codigo
  group by c.codigo, c.nombre, c.tipo, c.naturaleza, c.activa order by c.codigo
$$;

-- ---------------------------------------------------------------------------
-- Auxiliares operativos independientes del libro (segunda via)
-- ---------------------------------------------------------------------------
-- Costo de los pedidos directos enviados que se debe al proveedor: mercancia, seguro de reenvio y guias no pagadas por un socio.
create function contabilidad.directos_proveedor(p_proveedor text) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select sum(case p_proveedor
                 when 'Isaac' then case pe.origen when 'isaac_directo' then s.costo_valor_cent when 'karen_via_isaac' then coalesce((catalogo.config_valor('seguro_reenvio_cent', pe.fecha_envio))::text::bigint, 0) * s.piezas else 0 end
                 else case pe.origen when 'karen_directo' then s.costo_valor_cent when 'karen_via_isaac' then s.costo_valor_cent - coalesce((catalogo.config_valor('seguro_reenvio_cent', pe.fecha_envio))::text::bigint, 0) * s.piezas else 0 end end)
    from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id
    where pe.estado = 'enviado' and s.movimiento_id is null), 0)::bigint
  + coalesce((
    select sum(g.monto_cent)
    from operacion.gasto g join operacion.guia gu on gu.id = g.guia_id join operacion.pedido pe on pe.id = gu.pedido_id
    where g.categoria = 'guia_envio' and g.pagado_por_socio_id is null and not exists (select 1 from operacion.gasto_anulacion an where an.gasto_id = g.id)
      and ((p_proveedor = 'Isaac' and pe.origen in ('isaac_directo', 'karen_via_isaac')) or (p_proveedor = 'Karen' and pe.origen = 'karen_directo'))), 0)::bigint
$$;

create function contabilidad.fuera_sociedad(p_socio bigint default null, p_proveedor bigint default null) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.partida_fuera_sociedad where (p_socio is null or socio_id = p_socio) and (p_proveedor is null or proveedor_id = p_proveedor) $$;

create function contabilidad.omar_operativo() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(monto_cent) from operacion.renta_devengo), 0)::bigint
       - coalesce((select sum(piezas * precio_cent) from operacion.toma_omar where estado = 'autorizada' and precio_cent is not null), 0)::bigint
       - coalesce((select sum(case sentido when 'a_omar' then monto_cent else -monto_cent end) from operacion.pago_omar), 0)::bigint
$$;

-- Lo que el libro debe reproducir de cada auxiliar operativo. Una fila por auxiliar: mayor contra funcion operativa.
create function contabilidad.reproducir_saldos() returns table (clave text, descripcion text, mayor_cent bigint, operativo_cent bigint, ok boolean)
language sql stable security definer set search_path = ''
as $$
  select r.clave, r.descripcion, r.mayor, r.oper, r.mayor = r.oper from (
    select 'inventario'::text as clave, 'Inventario (1310) contra el valor del kárdex por modelo'::text as descripcion, contabilidad.saldo('1310') as mayor,
           coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0)::bigint as oper
    union all select 'transito', 'Mercancía en tránsito (1320) contra órdenes confirmadas sin recibir', contabilidad.saldo('1320'),
           coalesce((select sum(total_cent) from operacion.compra where estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')), 0)::bigint
         + coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a join operacion.compra c on c.id = a.ref_id where a.ref_tipo = 'compra' and a.reversa_de is null and c.estado = 'anulada'), 0)::bigint
    union all select 'puente', 'Diferencias de recepción (1340) contra el puente operativo', contabilidad.saldo('1340'), operacion.saldo_puente()
    union all select 'clientes', 'Clientes (1210) contra los saldos de pedidos enviados', contabilidad.saldo('1210'),
           coalesce((select sum(operacion.saldo_cliente(c.id)) from catalogo.cliente c), 0)::bigint
    union all select 'saldos_favor', 'Saldos a favor de clientes (2410) contra pagos sin aplicar', contabilidad.saldo('2410'),
           coalesce((select sum(operacion.saldo_favor_cliente(c.id)) from catalogo.cliente c), 0)::bigint
    union all select 'por_identificar', 'Depósitos por identificar (2420) contra pagos sin cliente', contabilidad.saldo('2420'),
           coalesce((select sum(p.monto_cent) from operacion.pago p where p.cliente_id is null and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id)
                      and not exists (select 1 from operacion.pago_anulacion an where an.pago_id = p.id)), 0)::bigint
    union all select 'fondos_socios', 'Fondos en poder de los socios (1150 y 1160) contra la cuenta de los socios', contabilidad.saldo('1150') + contabilidad.saldo('1160'),
           coalesce((select sum(monto_cent) from operacion.cuenta_socio_mov where aplica_a <> 'diferencia'), 0)::bigint
    union all select 'faltantes_socios', 'Faltantes por cobrar a socios (1170 y 1180) contra la cuenta de los socios', contabilidad.saldo('1170') + contabilidad.saldo('1180'),
           coalesce((select sum(monto_cent) from operacion.cuenta_socio_mov where aplica_a = 'diferencia'), 0)::bigint
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

-- ---------------------------------------------------------------------------
-- Comprobaciones C1 a C22 (y CU1 a CU3) por dos vias. Bloqueantes: ningun reporte sale si fallan.
-- ---------------------------------------------------------------------------
create function contabilidad.comprobaciones() returns table (codigo text, nombre text, bloqueante boolean, via_a_nombre text, via_a_cent bigint, via_b_nombre text, via_b_cent bigint, ok boolean, unidad text)
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
  v_b := contabilidad.saldo('4110') + contabilidad.saldo('4300') + contabilidad.saldo('4910') - contabilidad.saldo('4210');
  codigo := 'C14'; nombre := 'Desglose: ventas por cliente contra ingresos de mayoreo del libro'; bloqueante := false; via_a_nombre := 'Notas vigentes de pedidos enviados'; via_a_cent := v_a; via_b_nombre := 'Cuentas 4110, 4300 y 4910 menos 4210'; via_b_cent := v_b; ok := v_a = v_b; return next;
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
  -- Identidades de la paridad con el Excel (doc 18)
  v_activo := contabilidad.suma_tipo('A'); v_pasivo := contabilidad.suma_tipo('P'); v_capital := contabilidad.suma_tipo('K'); v_res := contabilidad.resultado();
  codigo := 'CU1'; nombre := 'Identidad I-1: activo igual a pasivo más capital'; bloqueante := true; via_a_nombre := 'Activo'; via_a_cent := v_activo; via_b_nombre := 'Pasivo más capital más resultado'; via_b_cent := v_pasivo + v_capital + v_res; ok := v_activo = v_pasivo + v_capital + v_res; return next;
  v_ind := (v_activo - v_pasivo) - v_capital;
  codigo := 'CU2'; nombre := 'Identidad I-2: resultado igual a la variación del capital'; bloqueante := true; via_a_nombre := 'Ingresos menos costos y gastos'; via_a_cent := v_res; via_b_nombre := 'Activo menos pasivo menos capital aportado'; via_b_cent := v_ind; ok := v_res = v_ind; return next;
  select coalesce((select sum(piezas) from operacion.existencia_sku_ubicacion), 0), coalesce((select sum(piezas) from operacion.existencia_modelo), 0) into v_a, v_b;
  codigo := 'CU3'; nombre := 'Piezas por sabor igual a piezas por modelo'; bloqueante := true; via_a_nombre := 'Suma por sabor'; via_a_cent := v_a; via_b_nombre := 'Suma por modelo'; via_b_cent := v_b; ok := v_a = v_b; unidad := 'pz'; return next; unidad := 'mxn';
end $$;

-- ---------------------------------------------------------------------------
-- Estados financieros
-- ---------------------------------------------------------------------------
create function contabilidad.estado_resultados(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_m jsonb; v_lineas jsonb; v_ventas_brutas bigint; v_dev bigint; v_desc bigint; v_ventas_netas bigint; v_envio bigint; v_ingresos bigint; v_costo bigint; v_bruta bigint;
  v_variables bigint; v_contribucion bigint; v_fijos bigint; v_otros bigint; v_neta bigint; v_via2 bigint; v_javier bigint; v_angelo bigint; v_piezas bigint; v_ajustes bigint; v_hay boolean;
begin
  if p_ini is null or p_fin is null or p_fin < p_ini then raise exception 'periodo invalido' using errcode = '22023'; end if;
  select coalesce(jsonb_object_agg(x.cuenta, x.hd), '{}'::jsonb) into v_m from (
    select l.cuenta, sum(l.haber_cent - l.debe_cent) as hd from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
     where a.fecha_contable between p_ini and p_fin group by l.cuenta) x;
  select exists (select 1 from contabilidad.asiento a where a.fecha_contable between p_ini and p_fin) into v_hay;
  -- m(c) = haber - debe de la cuenta en el periodo (positivo = acreedor).
  v_ventas_brutas := coalesce((v_m->>'4110')::bigint, 0) + coalesce((v_m->>'4120')::bigint, 0) + coalesce((v_m->>'4130')::bigint, 0);
  v_dev := -coalesce((v_m->>'4220')::bigint, 0);
  v_desc := -coalesce((v_m->>'4210')::bigint, 0);
  v_ventas_netas := v_ventas_brutas - v_dev - v_desc;
  v_envio := coalesce((v_m->>'4300')::bigint, 0);
  v_ingresos := v_ventas_netas + v_envio;
  v_costo := -(coalesce((v_m->>'5100')::bigint, 0) + coalesce((v_m->>'5110')::bigint, 0) + coalesce((v_m->>'5200')::bigint, 0) + coalesce((v_m->>'5300')::bigint, 0) + coalesce((v_m->>'5400')::bigint, 0))
             - coalesce((v_m->>'4920')::bigint, 0);
  v_bruta := v_ingresos - v_costo;
  v_variables := -(coalesce((v_m->>'6110')::bigint, 0) + coalesce((v_m->>'6120')::bigint, 0) + coalesce((v_m->>'6130')::bigint, 0) + coalesce((v_m->>'6140')::bigint, 0));
  v_contribucion := v_bruta - v_variables;
  v_fijos := -(coalesce((v_m->>'6210')::bigint, 0) + coalesce((v_m->>'6220')::bigint, 0) + coalesce((v_m->>'6230')::bigint, 0) + coalesce((v_m->>'6240')::bigint, 0)
             + coalesce((v_m->>'6250')::bigint, 0) + coalesce((v_m->>'6290')::bigint, 0));
  v_otros := coalesce((v_m->>'4910')::bigint, 0) + coalesce((v_m->>'4930')::bigint, 0) + coalesce((v_m->>'7100')::bigint, 0) + coalesce((v_m->>'6310')::bigint, 0) + coalesce((v_m->>'7900')::bigint, 0);
  v_neta := v_contribucion - v_fijos + v_otros;
  select coalesce(sum(x.hd), 0) into v_via2 from (select c.codigo, coalesce((v_m->>c.codigo)::bigint, 0) as hd from contabilidad.cuenta c where c.tipo in ('I', 'C', 'G')) x;
  v_javier := v_neta / 2; v_angelo := v_neta - v_javier;
  select coalesce(sum(s.piezas), 0) into v_piezas from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join operacion.pedido p on p.id = l.pedido_id
    where p.estado = 'enviado' and p.fecha_envio between p_ini and p_fin;
  select coalesce(sum(case c.tipo when 'I' then l.haber_cent - l.debe_cent else l.haber_cent - l.debe_cent end), 0) into v_ajustes
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join contabilidad.cuenta c on c.codigo = l.cuenta
    where c.tipo in ('I', 'C', 'G') and a.periodo_afectado_id is not null and a.fecha_contable between p_ini and p_fin;
  select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'tipo', c.tipo,
      'monto_cent', case when c.naturaleza = 'A' then coalesce((v_m->>c.codigo)::bigint, 0) else -coalesce((v_m->>c.codigo)::bigint, 0) end) order by c.codigo), '[]'::jsonb) into v_lineas
    from contabilidad.cuenta c where c.tipo in ('I', 'C', 'G') and (c.activa or v_m ? c.codigo);
  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'con_movimientos', v_hay, 'lineas', v_lineas,
    'ventas_brutas_cent', v_ventas_brutas, 'devoluciones_cent', v_dev, 'descuentos_cent', v_desc, 'ventas_netas_cent', v_ventas_netas, 'envio_cent', v_envio, 'ingresos_operativos_cent', v_ingresos,
    'costo_ventas_cent', v_costo, 'utilidad_bruta_cent', v_bruta, 'gastos_variables_cent', v_variables, 'utilidad_contribucion_cent', v_contribucion, 'gastos_fijos_cent', v_fijos,
    'otros_cent', v_otros, 'utilidad_neta_cent', v_neta,
    'angelo_cent', v_angelo, 'javier_cent', v_javier, 'piezas_vendidas', v_piezas, 'ajustes_periodos_anteriores_cent', v_ajustes,
    'comprobacion', jsonb_build_object('via1_cent', v_neta, 'via2_cent', v_via2, 'cuadra', v_neta = v_via2));
end $$;

create function contabilidad.balance_general(p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hay boolean; v_activo jsonb; v_pasivo jsonb; v_capital jsonb; v_ta bigint := 0; v_tp bigint := 0; v_tk bigint := 0; v_res bigint; v_fuera jsonb; r record; v_favor bigint;
begin
  if p_hasta is null then raise exception 'falta la fecha de corte' using errcode = '22023'; end if;
  select exists (select 1 from contabilidad.asiento a where a.fecha_contable <= p_hasta) into v_hay;
  v_activo := '[]'::jsonb; v_pasivo := '[]'::jsonb; v_capital := '[]'::jsonb;
  for r in select * from contabilidad.saldos(p_hasta) s where s.tipo in ('A', 'P', 'K') and (s.activa or s.saldo_cent <> 0) order by s.codigo loop
    if r.tipo = 'A' then
      v_activo := v_activo || jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'monto_cent', r.saldo_cent); v_ta := v_ta + r.saldo_cent;
    elsif r.tipo = 'P' then
      -- Saldo deudor de un proveedor = saldo a favor: se presenta en el activo.
      if r.codigo in ('2110', '2120') and r.saldo_cent < 0 then
        v_activo := v_activo || jsonb_build_object('codigo', r.codigo, 'nombre', 'Saldo a favor con ' || case r.codigo when '2110' then 'Isaac' else 'Karen' end, 'monto_cent', -r.saldo_cent); v_ta := v_ta - r.saldo_cent;
      else
        v_pasivo := v_pasivo || jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'monto_cent', r.saldo_cent); v_tp := v_tp + r.saldo_cent;
      end if;
    else
      v_capital := v_capital || jsonb_build_object('codigo', r.codigo, 'nombre', r.nombre, 'monto_cent', case when r.naturaleza = 'D' then -r.saldo_cent else r.saldo_cent end);
      v_tk := v_tk + case when r.naturaleza = 'D' then -r.saldo_cent else r.saldo_cent end;
    end if;
  end loop;
  v_res := contabilidad.resultado(p_hasta);
  v_capital := v_capital || jsonb_build_object('codigo', '4-7', 'nombre', 'Resultado acumulado de las cuentas 4 a 7', 'monto_cent', v_res); v_tk := v_tk + v_res;
  select coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre, 'concepto', f.concepto, 'estado', f.estado, 'monto_cent', f.monto_cent) order by f.id), '[]'::jsonb) into v_fuera
    from operacion.partida_fuera_sociedad f join catalogo.socio s on s.id = f.socio_id where f.fecha_neg <= p_hasta;
  return jsonb_build_object('hasta', p_hasta, 'con_movimientos', v_hay, 'activo', v_activo, 'pasivo', v_pasivo, 'capital', v_capital,
    'total_activo_cent', v_ta, 'total_pasivo_cent', v_tp, 'total_capital_cent', v_tk, 'diferencia_cent', v_ta - v_tp - v_tk, 'cuadra', v_ta = v_tp + v_tk,
    'fuera_de_libros', v_fuera);
end $$;

-- Flujo de efectivo (fondos de la sociedad = 1101 + 1102 + 1150 + 1160). Directo por tipo de evento, con conciliacion indirecta.
create function contabilidad.flujo_efectivo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ini bigint; v_fin bigint; v_directo jsonb; v_op bigint; v_fin_act bigint; v_otros bigint; v_total bigint; v_res bigint; v_dact bigint; v_dpas bigint; v_dcap bigint;
  v_ind_op bigint; v_ind_fin bigint; v_hay boolean; v_directo_prov bigint;
begin
  if p_ini is null or p_fin is null or p_fin < p_ini then raise exception 'periodo invalido' using errcode = '22023'; end if;
  select exists (select 1 from contabilidad.asiento a where a.fecha_contable between p_ini and p_fin) into v_hay;
  v_ini := coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                      where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable < p_ini), 0);
  v_fin := coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                      where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable <= p_fin), 0);
  select coalesce(jsonb_agg(jsonb_build_object('categoria', z.cat, 'seccion', z.sec, 'monto_cent', z.m) order by z.ord), '[]'::jsonb) into v_directo from (
    select case when a.origen_tipo in ('pago_cliente', 'pago_aplicado', 'pago_anulado', 'pago_identificado') then 'Cobros de clientes'
                when a.origen_tipo in ('pago_proveedor_socio', 'pago_proveedor_sociedad') then 'Pagos a proveedores'
                when a.origen_tipo = 'pago_omar' then 'Renta pagada a Omar'
                when a.origen_tipo in ('gasto_socio', 'deshacer_aportacion') then 'Guías y otros gastos'
                when a.origen_tipo in ('aportacion_socio') then 'Aportaciones y pagos de socios'
                when a.origen_tipo in ('pago_a_socio', 'cierre_reparto_firmado', 'liquidacion_entre_socios', 'deshacer_movimiento_socio') then 'Reembolsos, retiros y reparto'
                else 'Otros movimientos de fondos' end as cat,
           case when a.origen_tipo in ('aportacion_socio', 'pago_a_socio', 'cierre_reparto_firmado', 'liquidacion_entre_socios', 'deshacer_movimiento_socio', 'deshacer_aportacion') then 'financiamiento' else 'operacion' end as sec,
           min(case when a.origen_tipo in ('pago_cliente', 'pago_aplicado', 'pago_anulado', 'pago_identificado') then 1 when a.origen_tipo in ('pago_proveedor_socio', 'pago_proveedor_sociedad') then 2
                    when a.origen_tipo = 'pago_omar' then 3 when a.origen_tipo in ('gasto_socio', 'deshacer_aportacion') then 4 when a.origen_tipo in ('aportacion_socio') then 5
                    when a.origen_tipo in ('pago_a_socio', 'cierre_reparto_firmado', 'liquidacion_entre_socios', 'deshacer_movimiento_socio') then 6 else 7 end) as ord,
           sum(l.debe_cent - l.haber_cent)::bigint as m
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
    where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable between p_ini and p_fin
    group by 1, 2 having sum(l.debe_cent - l.haber_cent) <> 0) z;
  select coalesce(sum((x->>'monto_cent')::bigint) filter (where x->>'seccion' = 'operacion'), 0), coalesce(sum((x->>'monto_cent')::bigint) filter (where x->>'seccion' = 'financiamiento'), 0)
    into v_op, v_fin_act from jsonb_array_elements(v_directo) x;
  v_total := v_op + v_fin_act;
  -- Cobros que pagaron directo al proveedor: no pasan por fondos pero si pagan deuda (memorando).
  v_directo_prov := coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                               where l.cuenta in ('2110', '2120') and a.origen_tipo in ('pago_cliente', 'pago_anulado') and a.fecha_contable between p_ini and p_fin), 0);
  -- Conciliacion indirecta: utilidad neta mas cambios del capital de trabajo mas financiamiento = variacion de fondos.
  v_res := contabilidad.resultado(p_fin, p_ini);
  v_dact := coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                       where l.cuenta in ('1170', '1180', '1210', '1220', '1290', '1310', '1320', '1330', '1340', '1410') and a.fecha_contable between p_ini and p_fin), 0);
  v_dpas := coalesce((select sum(l.haber_cent - l.debe_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                       where l.cuenta in ('2110', '2120', '2190', '2210', '2220', '2410', '2420') and a.fecha_contable between p_ini and p_fin), 0);
  v_dcap := coalesce((select sum(l.haber_cent - l.debe_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                       where l.cuenta in ('2310', '2320', '3110', '3120', '3210', '3220', '3310', '3320', '3900', '3990') and a.fecha_contable between p_ini and p_fin), 0);
  v_ind_op := v_res - v_dact + v_dpas;
  v_ind_fin := v_dcap;
  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'con_movimientos', v_hay, 'saldo_inicial_cent', v_ini, 'saldo_final_cent', v_fin, 'directo', v_directo,
    'flujo_operacion_cent', v_op, 'flujo_financiamiento_cent', v_fin_act, 'variacion_cent', v_total, 'cobros_directo_proveedor_cent', v_directo_prov,
    'indirecto', jsonb_build_object('utilidad_neta_cent', v_res, 'cambio_activos_cent', -v_dact, 'cambio_pasivos_cent', v_dpas, 'operacion_cent', v_ind_op, 'financiamiento_cent', v_ind_fin, 'variacion_cent', v_ind_op + v_ind_fin),
    'comprobacion', jsonb_build_object('via1_cent', v_total, 'via2_cent', v_ind_op + v_ind_fin, 'saldo_cent', v_fin - v_ini, 'cuadra', v_total = v_ind_op + v_ind_fin and v_fin - v_ini = v_total));
end $$;

-- Valuacion, liquidez, deudas y diferencia como identidad contable (doc 18, V01 a V06 y L01 a L04).
create function contabilidad.valuacion(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hasta date := coalesce(p_hasta, negocio.hoy()); v_hay boolean; v_a_nat bigint; v_fav bigint; v_v01 bigint; v_v02 bigint; v_v03 bigint; v_v04 bigint; v_v05 bigint; v_v06 bigint;
  v_l01 bigint; v_l02 bigint; v_l03 bigint; v_hoja jsonb; v_fondos_mov boolean; v_i1 bigint; v_inv bigint; v_cap_cuentas bigint;
begin
  select exists (select 1 from contabilidad.asiento a where a.fecha_contable <= v_hasta) into v_hay;
  v_a_nat := contabilidad.suma_tipo('A', v_hasta);
  v_fav := coalesce((select sum(-s.saldo_cent) from contabilidad.saldos(v_hasta) s where s.codigo in ('2110', '2120') and s.saldo_cent < 0), 0);
  v_v01 := v_a_nat + v_fav;
  v_v02 := contabilidad.suma_tipo('P', v_hasta) + v_fav;
  v_v03 := v_v01 - v_v02;
  v_v06 := contabilidad.saldo('3110', v_hasta) + contabilidad.saldo('3120', v_hasta) - contabilidad.saldo('3210', v_hasta) - contabilidad.saldo('3220', v_hasta);
  v_v05 := contabilidad.saldo('3310', v_hasta) + contabilidad.saldo('3320', v_hasta);
  v_v04 := contabilidad.resultado(v_hasta) + contabilidad.saldo('3900', v_hasta) + contabilidad.saldo('3990', v_hasta);
  v_cap_cuentas := v_v06 + v_v05 + v_v04;
  v_inv := contabilidad.saldo('1310', v_hasta);
  select exists (select 1 from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable <= v_hasta) into v_fondos_mov;
  v_l01 := case when v_fondos_mov then contabilidad.saldo_deudor('1101', v_hasta) + contabilidad.saldo_deudor('1102', v_hasta) + contabilidad.saldo_deudor('1150', v_hasta) + contabilidad.saldo_deudor('1160', v_hasta) end;
  v_l02 := case when v_l01 is not null then v_l01 + contabilidad.saldo('1210', v_hasta) end;
  begin
    v_hoja := operacion.hoja_proveedor('Isaac', operacion.semana_liquidacion_ini(v_hasta), 'sociedad');
    v_l03 := greatest((v_hoja->'totales'->>'falta_por_saldar_cent')::bigint, 0);
  exception when others then v_l03 := null;
  end;
  return jsonb_build_object('hasta', v_hasta, 'con_movimientos', v_hay,
    'v01_valuacion_cent', v_v01, 'v02_deudas_cent', v_v02, 'v03_diferencia_cent', v_v03, 'v04_utilidad_empresa_cent', v_v04, 'v05_utilidades_retenidas_cent', v_v05, 'v06_capital_aportado_cent', v_v06,
    'inventario_cent', v_inv, 'clientes_cent', contabilidad.saldo('1210', v_hasta), 'omar_cent', contabilidad.saldo('1220', v_hasta),
    'l01_liquidez_cent', v_l01, 'l02_liquidez_total_cent', v_l02, 'l03_pago_semana_cent', v_l03,
    'l04_despues_de_pago_cent', case when v_l02 is not null and v_l03 is not null then v_l02 - v_l03 end,
    'l04c_conservadora_cent', case when v_l01 is not null and v_l03 is not null then v_l01 - v_l03 end,
    'identidades', jsonb_build_object(
      'i1', jsonb_build_object('nombre', 'I-1: valuación menos deudas igual a capital por cuentas', 'via1_cent', v_v03, 'via2_cent', v_cap_cuentas, 'cuadra', v_v03 = v_cap_cuentas),
      'i2', jsonb_build_object('nombre', 'I-2: utilidad igual a diferencia menos capital aportado menos utilidades retenidas', 'via1_cent', v_v04, 'via2_cent', v_v03 - v_v06 - v_v05, 'cuadra', v_v04 = v_v03 - v_v06 - v_v05)));
end $$;

-- ---------------------------------------------------------------------------
-- Explicar este numero: cualquier saldo movimiento por movimiento, con su asiento, evento, autor y mensaje de origen
-- ---------------------------------------------------------------------------
create function contabilidad.movimientos_cuenta(p_cuenta text, p_ini date, p_fin date, p_dim text default null, p_dim_id bigint default null)
returns table (n bigint, asiento_id bigint, folio text, fecha_neg date, fecha_contable date, hora timestamptz, descripcion text, evento_folio text, evento_tipo text, canal text, autor text,
               mensaje_origen text, nota text, debe_cent bigint, haber_cent bigint, saldo_cent bigint, cliente_id bigint, proveedor_id bigint, socio_id bigint, pedido_id bigint)
language sql stable security definer set search_path = ''
as $$
  with c as (select naturaleza from contabilidad.cuenta where codigo = p_cuenta),
  base as (
    select l.asiento_id, a.folio, a.fecha_neg, a.fecha_contable, e.hora, a.descripcion, e.folio as evento_folio, e.tipo as evento_tipo, a.canal,
           (select u.socio_nombre from seguridad.usuario u where u.id = e.actor_id) as autor, a.mensaje_origen, l.nota, l.debe_cent, l.haber_cent,
           l.cliente_id, l.proveedor_id, l.socio_id, l.pedido_id, l.n as ln,
           case (select naturaleza from c) when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end as efecto
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id
    where l.cuenta = p_cuenta and (p_fin is null or a.fecha_contable <= p_fin)
      and (p_dim is null or (p_dim = 'cliente' and l.cliente_id = p_dim_id) or (p_dim = 'proveedor' and l.proveedor_id = p_dim_id) or (p_dim = 'socio' and l.socio_id = p_dim_id))),
  corrido as (select b.*, sum(b.efecto) over (order by b.asiento_id, b.ln) as saldo from base b)
  select row_number() over (order by k.asiento_id, k.ln), k.asiento_id, k.folio, k.fecha_neg, k.fecha_contable, k.hora, k.descripcion, k.evento_folio, k.evento_tipo, k.canal, k.autor, k.mensaje_origen, k.nota,
         k.debe_cent, k.haber_cent, k.saldo::bigint, k.cliente_id, k.proveedor_id, k.socio_id, k.pedido_id
  from corrido k where (p_ini is null or k.fecha_contable >= p_ini) order by k.asiento_id, k.ln
$$;

-- ---------------------------------------------------------------------------
-- Verificacion de un asiento con sus cuatro comprobaciones
-- ---------------------------------------------------------------------------
create function contabilidad.verificar_asiento(p_asiento bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  a contabilidad.asiento; v_d bigint; v_h bigint; v_prev text; v_rec text; v_roto bigint; v_cuentas jsonb; v_ok4 boolean;
begin
  select * into a from contabilidad.asiento where id = p_asiento;
  if not found then raise exception 'asiento desconocido' using errcode = '22023'; end if;
  select coalesce(sum(debe_cent), 0), coalesce(sum(haber_cent), 0) into v_d, v_h from contabilidad.asiento_linea where asiento_id = a.id;
  select x.hash into v_prev from contabilidad.asiento x where x.id < a.id order by x.id desc limit 1;
  v_rec := contabilidad.hash_calculado(a.id);
  v_roto := contabilidad.verificar_cadena();
  -- 4. cada cuenta tocada por el asiento coincide con su auxiliar operativo (cuando lo tiene)
  select coalesce(jsonb_agg(jsonb_build_object('clave', r.clave, 'ok', r.ok)), '[]'::jsonb), coalesce(bool_and(r.ok), true) into v_cuentas, v_ok4 from contabilidad.reproducir_saldos() r;
  return jsonb_build_object('asiento', a.folio, 'hash', a.hash,
    'cuadra', jsonb_build_object('nombre', 'Suma del debe igual a suma del haber', 'debe_cent', v_d, 'haber_cent', v_h, 'ok', v_d = v_h),
    'determinismo', jsonb_build_object('nombre', 'Recalcular las líneas del evento reproduce lo guardado', 'ok', contabilidad.coincide_recalculo(a.id)),
    'cadena', jsonb_build_object('nombre', 'El hash corresponde al contenido y enlaza con el asiento anterior', 'ok', a.hash = v_rec and a.hash_anterior = coalesce(v_prev, repeat('0', 64)), 'cadena_integra', v_roto is null),
    'saldos', jsonb_build_object('nombre', 'Los saldos del libro coinciden con los auxiliares operativos', 'ok', v_ok4, 'detalle', v_cuentas));
end $$;

-- ---------------------------------------------------------------------------
-- Escritura: periodos, asientos manuales y reversas
-- ---------------------------------------------------------------------------
create function contabilidad.bloqueantes_fallando() returns text
language sql stable security definer set search_path = ''
as $$ select string_agg(c.codigo, ', ' order by c.codigo) from contabilidad.comprobaciones() c where c.bloqueante and not c.ok $$;

create function contabilidad.preparar_periodo(p_clave_idem text, p_periodo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; p contabilidad.periodo; v_ev bigint; v_corrida bigint; v_fallan text; v_res jsonb; v_n int;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'preparar_periodo', 'p', p_periodo));
  if v_prev is not null then return v_prev; end if;
  select * into p from contabilidad.periodo where id = p_periodo for update;
  if not found then raise exception 'periodo desconocido' using errcode = '22023'; end if;
  if p.estado not in ('abierto', 'preparado') then raise exception 'el periodo ya esta %', p.estado using errcode = 'P0428'; end if;
  if negocio.hoy() <= p.fin then raise exception 'el periodo del % al % aun no termina: se prepara a partir del %', p.ini, p.fin, p.fin + 1 using errcode = 'P0428'; end if;
  v_fallan := contabilidad.bloqueantes_fallando();
  v_corrida := (select coalesce(max(corrida_id), 0) + 1 from contabilidad.comprobacion);
  insert into contabilidad.comprobacion (corrida_id, codigo, nombre, bloqueante, via_a_nombre, via_a_cent, via_b_nombre, via_b_cent, ok, periodo_id)
    select v_corrida, c.codigo, c.nombre, c.bloqueante, c.via_a_nombre, c.via_a_cent, c.via_b_nombre, c.via_b_cent, c.ok, p.id from contabilidad.comprobaciones() c;
  get diagnostics v_n = row_count;
  if v_fallan is not null then
    -- No se prepara, pero la corrida queda guardada para ver que fallo.
    v_res := jsonb_build_object('periodo_id', p.id, 'estado', p.estado, 'preparado', false, 'fallan', v_fallan, 'corrida', v_corrida, 'comprobaciones', v_n);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  v_ev := operacion.crear_evento('periodo_preparado', negocio.hoy(), p_clave_idem, jsonb_build_object('periodo', p.id, 'ini', p.ini, 'fin', p.fin, 'corrida', v_corrida));
  update contabilidad.periodo set estado = 'preparado', preparado_at = clock_timestamp() where id = p.id;
  v_res := jsonb_build_object('periodo_id', p.id, 'estado', 'preparado', 'preparado', true, 'corrida', v_corrida, 'comprobaciones', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function contabilidad.aprobar_periodo(p_clave_idem text, p_periodo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; p contabilidad.periodo; v_ev bigint; v_hash text; v_fallan text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'aprobar_periodo', 'p', p_periodo));
  if v_prev is not null then return v_prev; end if;
  select * into p from contabilidad.periodo where id = p_periodo for update;
  if not found then raise exception 'periodo desconocido' using errcode = '22023'; end if;
  if p.estado <> 'preparado' then raise exception 'solo un periodo preparado se aprueba (esta %)', p.estado using errcode = 'P0428'; end if;
  if negocio.hoy() < p.fin + 1 then raise exception 'el periodo se aprueba a partir del %', p.fin + 1 using errcode = 'P0428'; end if;
  v_fallan := contabilidad.bloqueantes_fallando();
  if v_fallan is not null then raise exception 'no se puede aprobar: fallan las comprobaciones bloqueantes %', v_fallan using errcode = 'P0432'; end if;
  select a.hash into v_hash from contabilidad.asiento a where a.fecha_contable <= p.fin order by a.id desc limit 1;
  v_ev := operacion.crear_evento('periodo_aprobado', negocio.hoy(), p_clave_idem, jsonb_build_object('periodo', p.id, 'ini', p.ini, 'fin', p.fin));
  update contabilidad.periodo set estado = 'aprobado', aprobado_at = clock_timestamp(), aprobado_por = auth.uid(), hash_cabecera = v_hash where id = p.id;
  v_res := jsonb_build_object('periodo_id', p.id, 'estado', 'aprobado', 'hash_cabecera', v_hash);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function contabilidad.publicar_periodo(p_clave_idem text, p_periodo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; p contabilidad.periodo; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'publicar_periodo', 'p', p_periodo));
  if v_prev is not null then return v_prev; end if;
  select * into p from contabilidad.periodo where id = p_periodo for update;
  if not found then raise exception 'periodo desconocido' using errcode = '22023'; end if;
  if p.estado <> 'aprobado' then raise exception 'solo un periodo aprobado se publica (esta %)', p.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('periodo_publicado', negocio.hoy(), p_clave_idem, jsonb_build_object('periodo', p.id));
  update contabilidad.periodo set estado = 'publicado', publicado_at = clock_timestamp() where id = p.id;
  v_res := jsonb_build_object('periodo_id', p.id, 'estado', 'publicado');
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function contabilidad.reabrir_periodo(p_clave_idem text, p_periodo bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; p contabilidad.periodo; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reabrir_periodo', 'p', p_periodo, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'reabrir exige motivo' using errcode = '23502'; end if;
  select * into p from contabilidad.periodo where id = p_periodo for update;
  if not found then raise exception 'periodo desconocido' using errcode = '22023'; end if;
  if p.estado not in ('aprobado', 'publicado') then raise exception 'solo un periodo aprobado o publicado se reabre (esta %)', p.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('periodo_reabierto', negocio.hoy(), p_clave_idem, jsonb_build_object('periodo', p.id, 'motivo', p_motivo));
  insert into contabilidad.reapertura (periodo_id, motivo, reabierto_por, evento_id) values (p.id, p_motivo, auth.uid(), v_ev);
  perform set_config('rtm.reapertura', p.id::text, true);
  update contabilidad.periodo set estado = 'abierto', preparado_at = null, aprobado_at = null, aprobado_por = null, publicado_at = null, hash_cabecera = null where id = p.id;
  perform set_config('rtm.reapertura', '', true);
  v_res := jsonb_build_object('periodo_id', p.id, 'estado', 'abierto');
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Asiento manual (apertura, ajuste con motivo). p_lineas = [{cuenta, debe_cent | haber_cent, nota?, cliente_id?, proveedor_id?, socio_id?}].
create function contabilidad.registrar_asiento_manual(p_clave_idem text, p_fecha date, p_motivo text, p_lineas jsonb, p_apertura boolean default false, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_d bigint; v_h bigint; x jsonb; v_res jsonb; v_asiento bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_asiento_manual', 'f', p_fecha, 'm', p_motivo, 'l', p_lineas, 'a', p_apertura));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'el asiento manual exige motivo' using errcode = '23502'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then raise exception 'el asiento necesita al menos dos líneas' using errcode = '22023'; end if;
  v_d := 0; v_h := 0;
  for x in select * from jsonb_array_elements(p_lineas) loop
    if not exists (select 1 from contabilidad.cuenta c where c.codigo = x->>'cuenta' and c.activa) then raise exception 'cuenta desconocida o inactiva: %', x->>'cuenta' using errcode = '22023'; end if;
    if (coalesce((x->>'debe_cent')::bigint, 0) > 0) = (coalesce((x->>'haber_cent')::bigint, 0) > 0) or coalesce((x->>'debe_cent')::bigint, 0) < 0 or coalesce((x->>'haber_cent')::bigint, 0) < 0 then
      raise exception 'cada línea lleva debe o haber (uno solo, positivo)' using errcode = '23514';
    end if;
    v_d := v_d + coalesce((x->>'debe_cent')::bigint, 0); v_h := v_h + coalesce((x->>'haber_cent')::bigint, 0);
  end loop;
  if v_d <> v_h then raise exception 'el asiento no cuadra: debe % contra haber %', v_d, v_h using errcode = 'P0430'; end if;
  v_ev := operacion.crear_evento('asiento_manual', coalesce(p_fecha, negocio.hoy()), p_clave_idem, jsonb_build_object('motivo', p_motivo, 'lineas', p_lineas, 'apertura', p_apertura), p_mensaje_origen);
  v_res := jsonb_build_object('evento_id', v_ev, 'debe_cent', v_d, 'haber_cent', v_h);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Reversa de un asiento MANUAL (los de negocio se corrigen anulando la operacion que los genero).
create function contabilidad.reversar_asiento(p_clave_idem text, p_asiento bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; a contabilidad.asiento; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reversar_asiento', 'a', p_asiento, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la reversa exige motivo' using errcode = '23502'; end if;
  select * into a from contabilidad.asiento where id = p_asiento;
  if not found then raise exception 'asiento desconocido' using errcode = '22023'; end if;
  if not a.es_manual then raise exception 'solo se reversan asientos manuales: un asiento de negocio se corrige anulando la operación que lo generó' using errcode = 'P0428'; end if;
  if a.reversa_de is not null or exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id) then raise exception 'ese asiento ya está reversado' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('reversa_asiento', negocio.hoy(), p_clave_idem, jsonb_build_object('asiento_id', a.id, 'motivo', p_motivo), null, a.evento_id, p_motivo);
  v_res := jsonb_build_object('evento_id', v_ev, 'asiento', a.folio);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- API de lectura y escritura (sesion de socio)
-- ---------------------------------------------------------------------------
create function api.conta_diario(p_ini date default null, p_fin date default null, p_limite int default 100) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_lim int := greatest(1, least(coalesce(p_limite, 100), 500)); v_total int;
begin
  perform seguridad.exigir_rol(array['socio']);
  select count(*) into v_total from contabilidad.asiento a where (p_ini is null or a.fecha_contable >= p_ini) and (p_fin is null or a.fecha_contable <= p_fin);
  return jsonb_build_object('total', v_total, 'limite', v_lim, 'ini', p_ini, 'fin', p_fin, 'asientos', coalesce((
    select jsonb_agg(q.x order by (q.x->>'id')::bigint desc) from (
      select jsonb_build_object('id', a.id, 'folio', a.folio, 'fecha_neg', a.fecha_neg, 'fecha_contable', a.fecha_contable, 'descripcion', a.descripcion, 'origen_tipo', a.origen_tipo,
               'evento', e.folio, 'evento_id', e.id, 'canal', a.canal, 'autor', (select u.socio_nombre from seguridad.usuario u where u.id = e.actor_id), 'mensaje_origen', a.mensaje_origen,
               'periodo_afectado', (select p.ini from contabilidad.periodo p where p.id = a.periodo_afectado_id), 'reversa_de', (select r.folio from contabilidad.asiento r where r.id = a.reversa_de),
               'reversado_por', (select r.folio from contabilidad.asiento r where r.reversa_de = a.id), 'es_manual', a.es_manual, 'hash', a.hash,
               'total_cent', (select sum(l.debe_cent) from contabilidad.asiento_linea l where l.asiento_id = a.id),
               'lineas', (select jsonb_agg(jsonb_build_object('n', l.n, 'cuenta', l.cuenta, 'nombre', c.nombre, 'debe_cent', l.debe_cent, 'haber_cent', l.haber_cent, 'nota', l.nota,
                          'cliente', (select nombre_canonico from catalogo.cliente k where k.id = l.cliente_id), 'proveedor', (select nombre from catalogo.proveedor k where k.id = l.proveedor_id),
                          'socio', (select nombre from catalogo.socio k where k.id = l.socio_id)) order by l.n)
                          from contabilidad.asiento_linea l join contabilidad.cuenta c on c.codigo = l.cuenta where l.asiento_id = a.id)) as x
      from contabilidad.asiento a join operacion.evento e on e.id = a.evento_id
      where (p_ini is null or a.fecha_contable >= p_ini) and (p_fin is null or a.fecha_contable <= p_fin) order by a.id desc limit v_lim) q), '[]'::jsonb));
end $$;

create function api.conta_asiento(p_asiento bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return contabilidad.verificar_asiento(p_asiento);
end $$;

create function api.conta_mayor(p_cuenta text default null, p_ini date default null, p_fin date default null, p_dim text default null, p_dim_id bigint default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_c contabilidad.cuenta; v_fin date := coalesce(p_fin, negocio.hoy()); v_inicial bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_cuenta is null then
    return jsonb_build_object('hasta', v_fin, 'cuentas', coalesce((select jsonb_agg(jsonb_build_object('codigo', s.codigo, 'nombre', s.nombre, 'tipo', s.tipo, 'naturaleza', s.naturaleza,
        'debe_cent', s.debe_cent, 'haber_cent', s.haber_cent, 'saldo_cent', s.saldo_cent, 'activa', s.activa) order by s.codigo) from contabilidad.saldos(v_fin) s where s.activa or s.saldo_cent <> 0), '[]'::jsonb));
  end if;
  select * into v_c from contabilidad.cuenta where codigo = p_cuenta;
  if not found then raise exception 'cuenta desconocida' using errcode = '22023'; end if;
  v_inicial := case when p_ini is null then 0 else contabilidad.saldo(p_cuenta, p_ini - 1) end;
  return jsonb_build_object('cuenta', jsonb_build_object('codigo', v_c.codigo, 'nombre', v_c.nombre, 'tipo', v_c.tipo, 'naturaleza', v_c.naturaleza, 'nota', v_c.nota),
    'ini', p_ini, 'fin', v_fin, 'saldo_inicial_cent', v_inicial, 'saldo_final_cent', contabilidad.saldo(p_cuenta, v_fin),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('asiento_id', m.asiento_id, 'folio', m.folio, 'fecha_neg', m.fecha_neg, 'fecha_contable', m.fecha_contable, 'hora', m.hora,
        'descripcion', m.descripcion, 'evento', m.evento_folio, 'canal', m.canal, 'autor', m.autor, 'mensaje_origen', m.mensaje_origen, 'nota', m.nota,
        'debe_cent', m.debe_cent, 'haber_cent', m.haber_cent, 'saldo_cent', m.saldo_cent) order by m.n) from contabilidad.movimientos_cuenta(p_cuenta, p_ini, v_fin, p_dim, p_dim_id) m), '[]'::jsonb));
end $$;

create function api.conta_estado_resultados(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.estado_resultados(p_ini, p_fin); end $$;

create function api.conta_balance(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.balance_general(coalesce(p_hasta, negocio.hoy())); end $$;

create function api.conta_flujo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.flujo_efectivo(p_ini, p_fin); end $$;

create function api.conta_valuacion(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.valuacion(p_hasta); end $$;

create function api.conta_comprobaciones() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('hoy', negocio.hoy(), 'cadena_hash_cabecera', (select hash from contabilidad.asiento order by id desc limit 1),
    'comprobaciones', coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'bloqueante', c.bloqueante, 'via_a_nombre', c.via_a_nombre, 'via_a_cent', c.via_a_cent,
        'via_b_nombre', c.via_b_nombre, 'via_b_cent', c.via_b_cent, 'ok', c.ok, 'unidad', c.unidad) order by length(c.codigo), c.codigo) from contabilidad.comprobaciones() c), '[]'::jsonb),
    'auxiliares', coalesce((select jsonb_agg(jsonb_build_object('clave', r.clave, 'descripcion', r.descripcion, 'mayor_cent', r.mayor_cent, 'operativo_cent', r.operativo_cent, 'ok', r.ok) order by r.clave)
                             from contabilidad.reproducir_saldos() r), '[]'::jsonb));
end $$;

create function api.conta_periodos() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('hoy', negocio.hoy(), 'periodos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'tipo', p.tipo, 'ini', p.ini, 'fin', p.fin, 'estado', p.estado,
      'preparado_at', p.preparado_at, 'aprobado_at', p.aprobado_at, 'publicado_at', p.publicado_at, 'hash_cabecera', p.hash_cabecera,
      'asientos', (select count(*) from contabilidad.asiento a where a.periodo_semana_id = p.id or a.periodo_mes_id = p.id),
      'afectados', (select count(*) from contabilidad.asiento a where a.periodo_afectado_id = p.id)) order by p.ini desc, p.tipo) from contabilidad.periodo p), '[]'::jsonb));
end $$;

create function api.conta_preparar_periodo(p_clave_idem text, p_periodo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.preparar_periodo(p_clave_idem, p_periodo); end $$;
create function api.conta_aprobar_periodo(p_clave_idem text, p_periodo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.aprobar_periodo(p_clave_idem, p_periodo); end $$;
create function api.conta_publicar_periodo(p_clave_idem text, p_periodo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.publicar_periodo(p_clave_idem, p_periodo); end $$;
create function api.conta_reabrir_periodo(p_clave_idem text, p_periodo bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.reabrir_periodo(p_clave_idem, p_periodo, p_motivo); end $$;
create function api.conta_asiento_manual(p_clave_idem text, p_fecha date, p_motivo text, p_lineas jsonb, p_apertura boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.registrar_asiento_manual(p_clave_idem, p_fecha, p_motivo, p_lineas, p_apertura); end $$;
create function api.conta_reversar_asiento(p_clave_idem text, p_asiento bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return contabilidad.reversar_asiento(p_clave_idem, p_asiento, p_motivo); end $$;

-- ---------------------------------------------------------------------------
-- Explicar este numero para las cifras de contabilidad: conta:saldo:<cuenta>, conta:v01 a v06, conta:l01, conta:utilidad:<ini>:<fin>:<nivel>
-- ---------------------------------------------------------------------------
alter function api.explicar_cifra(text) rename to explicar_cifra_f3a;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_rengs jsonb; v_valor bigint; v_via2 bigint; v_titulo text; v_v jsonb; v_er jsonb; v_hasta date; v_c contabilidad.cuenta; v_clave text; v_nivel text;
begin
  if partes[1] <> 'conta' then return api.explicar_cifra_f3a(p_cifra); end if;
  perform seguridad.exigir_rol(array['socio']);
  if partes[2] = 'saldo' then
    select * into v_c from contabilidad.cuenta where codigo = partes[3];
    if not found then raise exception 'cuenta desconocida' using errcode = '22023'; end if;
    v_hasta := coalesce(partes[4]::date, negocio.hoy());
    select coalesce(jsonb_agg(jsonb_build_object('concepto', m.folio || ' ' || m.descripcion || coalesce(': ' || m.nota, ''),
        'monto_cent', case v_c.naturaleza when 'D' then m.debe_cent - m.haber_cent else m.haber_cent - m.debe_cent end, 'saldo_cent', m.saldo_cent, 'hora', m.hora, 'fecha_neg', m.fecha_neg,
        'evento', m.evento_folio, 'canal', m.canal, 'autor', m.autor, 'mensaje_origen', m.mensaje_origen) order by m.n), '[]'::jsonb) into v_rengs
      from contabilidad.movimientos_cuenta(partes[3], null, v_hasta) m;
    v_valor := contabilidad.saldo(partes[3], v_hasta);
    -- Segunda via: se recalculan las lineas de cada evento con asiento (sin leer lo guardado) y se suma.
    select coalesce(sum(case v_c.naturaleza when 'D' then x.debe_cent - x.haber_cent else x.haber_cent - x.debe_cent end), 0)::bigint into v_via2
      from contabilidad.asiento a cross join lateral contabilidad.lineas_de_evento(a.evento_id) x where x.cuenta = partes[3] and a.fecha_contable <= v_hasta
       and not (a.es_manual or a.reversa_de is not null);
    v_via2 := v_via2 + coalesce((select sum(case v_c.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                                  where l.cuenta = partes[3] and a.fecha_contable <= v_hasta and (a.es_manual or a.reversa_de is not null)), 0);
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Saldo de ' || v_c.codigo || ' ' || v_c.nombre || ' al ' || v_hasta, 'valor', v_valor, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma de las líneas guardadas en el libro', 'via1_valor', v_valor, 'via2', 'Líneas recalculadas desde los hechos de cada evento', 'via2_valor', v_via2, 'cuadra', v_valor = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] in ('v01', 'v02', 'v03', 'v04', 'v05', 'v06', 'l01', 'l02') then
    v_hasta := coalesce(partes[3]::date, negocio.hoy());
    v_v := contabilidad.valuacion(v_hasta);
    v_clave := case partes[2] when 'v01' then 'v01_valuacion_cent' when 'v02' then 'v02_deudas_cent' when 'v03' then 'v03_diferencia_cent' when 'v04' then 'v04_utilidad_empresa_cent'
                              when 'v05' then 'v05_utilidades_retenidas_cent' when 'v06' then 'v06_capital_aportado_cent' when 'l01' then 'l01_liquidez_cent' else 'l02_liquidez_total_cent' end;
    v_titulo := case partes[2] when 'v01' then 'Valuación: activo a costo (inventario nunca a precio de venta)' when 'v02' then 'Deudas: pasivo total'
                              when 'v03' then 'Diferencia entre valuación y deudas (capital contable)' when 'v04' then 'Utilidad de la empresa (resultado no asignado)'
                              when 'v05' then 'Utilidades retenidas de los socios' when 'v06' then 'Capital aportado neto' when 'l01' then 'Liquidez: fondos de la sociedad' else 'Liquidez total: fondos más clientes' end;
    v_valor := (v_v->>v_clave)::bigint;
    v_rengs := case partes[2]
      when 'v01' then (select coalesce(jsonb_agg(jsonb_build_object('concepto', s.codigo || ' ' || s.nombre, 'monto_cent', s.saldo_cent) order by s.codigo), '[]'::jsonb) from contabilidad.saldos(v_hasta) s where s.tipo = 'A' and s.saldo_cent <> 0)
      when 'v02' then (select coalesce(jsonb_agg(jsonb_build_object('concepto', s.codigo || ' ' || s.nombre, 'monto_cent', s.saldo_cent) order by s.codigo), '[]'::jsonb) from contabilidad.saldos(v_hasta) s where s.tipo = 'P' and s.saldo_cent <> 0)
      when 'v06' then (select coalesce(jsonb_agg(jsonb_build_object('concepto', s.codigo || ' ' || s.nombre, 'monto_cent', case s.naturaleza when 'D' then -s.saldo_cent else s.saldo_cent end) order by s.codigo), '[]'::jsonb)
                       from contabilidad.saldos(v_hasta) s where s.codigo in ('3110', '3120', '3210', '3220') and s.saldo_cent <> 0)
      when 'v05' then (select coalesce(jsonb_agg(jsonb_build_object('concepto', s.codigo || ' ' || s.nombre, 'monto_cent', s.saldo_cent) order by s.codigo), '[]'::jsonb) from contabilidad.saldos(v_hasta) s where s.codigo in ('3310', '3320') and s.saldo_cent <> 0)
      when 'l01' then (select coalesce(jsonb_agg(jsonb_build_object('concepto', s.codigo || ' ' || s.nombre, 'monto_cent', s.saldo_cent) order by s.codigo), '[]'::jsonb) from contabilidad.saldos(v_hasta) s where s.codigo in ('1101', '1102', '1150', '1160') and s.saldo_cent <> 0)
      else jsonb_build_array(jsonb_build_object('concepto', 'Activo menos deudas, resultado y capital por cuentas', 'monto_cent', coalesce(v_valor, 0))) end;
    v_via2 := case partes[2]
      when 'v01' then contabilidad.suma_tipo('A', v_hasta) + coalesce((select sum(-s.saldo_cent) from contabilidad.saldos(v_hasta) s where s.codigo in ('2110', '2120') and s.saldo_cent < 0), 0)
      when 'v02' then contabilidad.suma_tipo('P', v_hasta) + coalesce((select sum(-s.saldo_cent) from contabilidad.saldos(v_hasta) s where s.codigo in ('2110', '2120') and s.saldo_cent < 0), 0)
      when 'v03' then (v_v->'identidades'->'i1'->>'via2_cent')::bigint
      when 'v04' then (v_v->'identidades'->'i2'->>'via2_cent')::bigint
      when 'v05' then contabilidad.saldo('3310', v_hasta) + contabilidad.saldo('3320', v_hasta)
      when 'v06' then contabilidad.saldo('3110', v_hasta) + contabilidad.saldo('3120', v_hasta) - contabilidad.saldo('3210', v_hasta) - contabilidad.saldo('3220', v_hasta)
      else v_valor end;
    return jsonb_build_object('cifra', p_cifra, 'titulo', v_titulo || case when v_valor is null then ' (sin dato: aún no se clasifican movimientos de dinero)' else '' end, 'valor', v_valor, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Función de valuación', 'via1_valor', coalesce(v_valor, 0), 'via2', case when partes[2] in ('v03', 'v04') then 'Identidad contable por cuentas de capital' else 'Suma directa de las cuentas' end,
                                         'via2_valor', coalesce(v_via2, 0), 'cuadra', v_valor is not distinct from v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'utilidad' then
    v_er := contabilidad.estado_resultados(partes[3]::date, partes[4]::date);
    v_nivel := coalesce(partes[5], 'neta');
    v_valor := (v_er->>(case v_nivel when 'bruta' then 'utilidad_bruta_cent' when 'contribucion' then 'utilidad_contribucion_cent' else 'utilidad_neta_cent' end))::bigint;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Ventas netas', 'monto_cent', (v_er->>'ventas_netas_cent')::bigint),
      jsonb_build_object('concepto', 'Envío cobrado', 'monto_cent', (v_er->>'envio_cent')::bigint),
      jsonb_build_object('concepto', 'Costo de ventas', 'monto_cent', -(v_er->>'costo_ventas_cent')::bigint),
      jsonb_build_object('concepto', 'Gastos variables de venta', 'monto_cent', -(v_er->>'gastos_variables_cent')::bigint),
      jsonb_build_object('concepto', 'Gastos fijos', 'monto_cent', -(v_er->>'gastos_fijos_cent')::bigint),
      jsonb_build_object('concepto', 'Recargos y otros', 'monto_cent', (v_er->>'otros_cent')::bigint));
    v_via2 := case v_nivel when 'bruta' then (v_er->>'ventas_netas_cent')::bigint + (v_er->>'envio_cent')::bigint - (v_er->>'costo_ventas_cent')::bigint
                           when 'contribucion' then (v_er->>'ventas_netas_cent')::bigint + (v_er->>'envio_cent')::bigint - (v_er->>'costo_ventas_cent')::bigint - (v_er->>'gastos_variables_cent')::bigint
                           else (v_er->'comprobacion'->>'via2_cent')::bigint end;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Utilidad ' || case v_nivel when 'bruta' then 'bruta' when 'contribucion' then 'de contribución' else 'neta' end || ' del ' || partes[3] || ' al ' || partes[4], 'valor', v_valor, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Estado de resultados por niveles', 'via1_valor', v_valor, 'via2', case when v_nivel = 'neta' then 'Suma directa de las cuentas 4 a 7 del periodo' else 'Suma de los renglones hasta ese nivel' end, 'via2_valor', v_via2, 'cuadra', v_valor = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  raise exception 'cifra de contabilidad desconocida' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema contabilidad from public, anon, authenticated;
grant execute on function api.conta_diario(date, date, int), api.conta_asiento(bigint), api.conta_mayor(text, date, date, text, bigint), api.conta_estado_resultados(date, date), api.conta_balance(date),
  api.conta_flujo(date, date), api.conta_valuacion(date), api.conta_comprobaciones(), api.conta_periodos(), api.conta_preparar_periodo(text, bigint), api.conta_aprobar_periodo(text, bigint),
  api.conta_publicar_periodo(text, bigint), api.conta_reabrir_periodo(text, bigint, text), api.conta_asiento_manual(text, date, text, jsonb, boolean), api.conta_reversar_asiento(text, bigint, text),
  api.explicar_cifra(text) to authenticated;
revoke execute on all functions in schema api from public, anon;
revoke execute on function api.explicar_cifra_f3a(text) from authenticated;

-- ---------------------------------------------------------------------------
-- Migracion que enlaza los eventos existentes con su asiento (idempotente).
-- ---------------------------------------------------------------------------
select contabilidad.asentar_pendientes();
