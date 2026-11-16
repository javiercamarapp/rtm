-- Renta de Omar mensual con compensacion el dia 15 (decision del dueno, 16-nov). La renta ($2 por pieza enviada) se DEVENGA al enviar (sin cambio) pero se COMPENSA una vez al mes,
-- en el corte semanal cuya semana (lunes a domingo) contiene el dia 15. En ese corte: renta acumulada contra las tomas de esa semana. Si la renta es mayor, los socios pagan la diferencia;
-- si las tomas son mayores, la renta se anula y Omar paga la diferencia (sube el efectivo y la valuacion). En las demas semanas Omar paga cada semana lo que toma (la renta no se compensa).
-- Parametro: catalogo.config `omar_renta_dia_compensacion` (15). Con valor null vuelve a la compensacion semanal de la renta de esa semana (comportamiento anterior; lo usan las pruebas viejas).
-- Aditiva: create or replace de dos funciones con la misma firma; no toca datos ni asientos (compensado_cent y neto_cent siguen significando lo mismo).

insert into catalogo.config (clave, valor, vigente_desde) values ('omar_renta_dia_compensacion', '15', '2026-11-16');

create function operacion.renta_a_compensar_omar(p_semana_ini date) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_dia int := nullif((catalogo.config_valor('omar_renta_dia_compensacion'))::text, 'null')::int; v_fin date := p_semana_ini + 6; v_dev bigint; v_prev bigint;
begin
  if v_dia is null then
    return coalesce((select sum(monto_cent) from operacion.renta_devengo where devengada_fecha between p_semana_ini and v_fin), 0);
  end if;
  if not exists (select 1 from generate_series(0, 6) g where extract(day from p_semana_ini + g) = v_dia) then return 0; end if;
  select coalesce(sum(monto_cent), 0) into v_dev from operacion.renta_devengo where devengada_fecha <= v_fin;
  select coalesce(sum(renta_cent), 0) into v_prev from operacion.liquidacion_omar where semana_ini < p_semana_ini;
  return v_dev - v_prev;
end $$;
revoke execute on function operacion.renta_a_compensar_omar(date) from public, anon, authenticated;

create or replace function operacion.saldo_omar_semana(p_semana_ini date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_fin date := p_semana_ini + 6; v_renta bigint; v_tomas bigint; v_pend int; v_sin_precio int; v_pagos bigint; v_liq operacion.liquidacion_omar;
begin
  v_renta := operacion.renta_a_compensar_omar(p_semana_ini);
  select coalesce(sum(piezas * precio_cent), 0) into v_tomas from operacion.toma_omar where estado = 'autorizada' and precio_cent is not null and fecha_neg between p_semana_ini and v_fin;
  select count(*) filter (where estado = 'pendiente'), count(*) filter (where estado = 'autorizada' and precio_cent is null) into v_pend, v_sin_precio
    from operacion.toma_omar where fecha_neg between p_semana_ini and v_fin;
  select coalesce(sum(case sentido when 'a_omar' then monto_cent else -monto_cent end), 0) into v_pagos from operacion.pago_omar where fecha_neg between p_semana_ini and v_fin;
  select * into v_liq from operacion.liquidacion_omar where semana_ini = p_semana_ini;
  return jsonb_build_object('semana_ini', p_semana_ini, 'semana_fin', v_fin, 'renta_cent', v_renta, 'tomas_cent', v_tomas, 'compensado_cent', least(v_renta, v_tomas),
    'neto_cent', v_renta - v_tomas, 'pagos_semana_cent', v_pagos, 'tomas_pendientes', v_pend, 'tomas_sin_precio', v_sin_precio,
    'estado', case when v_liq.id is null then 'abierta' else 'cerrada' end, 'liquidacion', v_liq.folio);
end $$;

create or replace function operacion.cerrar_liquidacion_omar(p_clave_idem text, p_semana_ini date, p_decision_pendientes boolean default false, p_fecha_cierre date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_cierre date := coalesce(p_fecha_cierre, negocio.hoy()); v_fin date := p_semana_ini + 6; v_s jsonb; v_ev bigint; v_folio text; v_id bigint; v_pagos bigint; v_res jsonb; v_snap jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_liquidacion_omar', 's', p_semana_ini, 'd', p_decision_pendientes, 'f', p_fecha_cierre));
  if v_prev is not null then return v_prev; end if;
  if extract(isodow from p_semana_ini) <> 1 then raise exception 'la semana de Omar empieza en lunes' using errcode = '22023'; end if;
  if v_cierre <= v_fin then raise exception 'la semana del % al % aun no termina: se liquida a partir del lunes %', p_semana_ini, v_fin, v_fin + 1 using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.liquidacion_omar where semana_ini = p_semana_ini) then raise exception 'la semana del % ya esta liquidada', p_semana_ini using errcode = 'P0428'; end if;
  v_s := operacion.saldo_omar_semana(p_semana_ini);
  if (v_s->>'tomas_pendientes')::int > 0 and not p_decision_pendientes then
    raise exception 'hay % tomas pendientes de autorizacion: decide cada una o cierra con decision expresa', v_s->>'tomas_pendientes' using errcode = 'P0428';
  end if;
  v_pagos := coalesce((select sum(case sentido when 'a_omar' then monto_cent else -monto_cent end) from operacion.pago_omar where fecha_neg between p_semana_ini and v_fin), 0);
  v_snap := v_s || jsonb_build_object(
    'renta', coalesce((select jsonb_agg(jsonb_build_object('folio', pe.folio, 'fecha', r.devengada_fecha, 'piezas', r.piezas, 'monto_cent', r.monto_cent) order by r.id)
                       from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id where operacion.renta_a_compensar_omar(p_semana_ini) <> 0 and r.devengada_fecha <= v_fin and r.devengada_fecha >= coalesce((select max(q.semana_fin) + 1 from operacion.liquidacion_omar q where q.semana_ini < p_semana_ini and q.renta_cent > 0), '1900-01-01'::date)), '[]'::jsonb),
    'tomas', coalesce((select jsonb_agg(jsonb_build_object('folio', t.folio, 'piezas', t.piezas, 'precio_cent', t.precio_cent, 'estado', t.estado) order by t.id)
                       from operacion.toma_omar t where t.fecha_neg between p_semana_ini and v_fin and t.estado in ('autorizada', 'pendiente')), '[]'::jsonb));
  v_ev := operacion.crear_evento('liquidacion_omar', v_cierre, p_clave_idem, jsonb_build_object('semana_ini', p_semana_ini));
  v_folio := seguridad.siguiente_folio('L');
  insert into operacion.liquidacion_omar (folio, persona_bodega_id, semana_ini, semana_fin, renta_cent, tomas_cent, compensado_cent, neto_cent, pagos_previos_cent, snapshot, fecha_cierre, evento_id)
    values (v_folio, operacion.persona_bodega_id(), p_semana_ini, v_fin, (v_s->>'renta_cent')::bigint, (v_s->>'tomas_cent')::bigint, (v_s->>'compensado_cent')::bigint, (v_s->>'neto_cent')::bigint, v_pagos, v_snap, v_cierre, v_ev)
    returning id into v_id;
  v_res := jsonb_build_object('liquidacion_id', v_id, 'folio', v_folio, 'renta_cent', (v_s->>'renta_cent')::bigint, 'tomas_cent', (v_s->>'tomas_cent')::bigint, 'compensado_cent', (v_s->>'compensado_cent')::bigint,
                              'neto_cent', (v_s->>'neto_cent')::bigint, 'palabra', case when (v_s->>'neto_cent')::bigint > 0 then 'Le debemos' when (v_s->>'neto_cent')::bigint < 0 then 'Omar debe' else 'Saldo cero' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;


-- C17 (Omar contra el libro) ajustada a la compensacion mensual: ver el comentario dentro. Mismo resultado que antes cuando el parametro es null.
create or replace function contabilidad.comprobaciones() returns table (codigo text, nombre text, bloqueante boolean, via_a_nombre text, via_a_cent bigint, via_b_nombre text, via_b_cent bigint, ok boolean, unidad text)
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
  v_b := contabilidad.saldo('4110') + contabilidad.saldo('4300') + contabilidad.saldo('4910') - contabilidad.saldo('4210') - contabilidad.saldo('4220');
  codigo := 'C14'; nombre := 'Desglose: ventas por cliente contra ingresos de mayoreo del libro'; bloqueante := false; via_a_nombre := 'Notas vigentes de pedidos enviados'; via_a_cent := v_a; via_b_nombre := 'Cuentas 4110, 4300 y 4910 menos 4210 y 4220'; via_b_cent := v_b; ok := v_a = v_b; return next;
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
       -- Sobrante o faltante de caja (cuenta 7200): ajustes de conteo del efectivo que el puente asienta (migracion 8000).
       + coalesce((select sum(m.monto_cent) from operacion.cuenta_efectivo_mov m join operacion.evento ev on ev.id = m.evento_id left join operacion.cuenta_efectivo_mov o on o.id = m.reversa_de
                    where coalesce(o.concepto, m.concepto) = 'ajuste_conteo' and ev.tipo in ('movimiento_efectivo', 'movimiento_efectivo_anulado')), 0)
    into v_a;
  codigo := 'C16'; nombre := 'Puente pedidos a libro: utilidad comercial contra utilidad del libro'; bloqueante := false; via_a_nombre := 'Utilidad por pedidos, tomas, gastos y ajustes'; via_a_cent := v_a; via_b_nombre := 'Cuentas 4 a 7 del libro'; via_b_cent := v_res; ok := v_a = v_res; return next;
  -- C17 Omar por el camino de la liquidacion (compensacion mensual el dia 15): lo liquidado menos pagos, menos las tomas de semanas abiertas, mas toda la renta devengada que aun no esta en una liquidacion
  -- (en modo semanal esta suma es igual a la de cada semana abierta: neto = renta - tomas).
  select operacion.saldo_omar_cuenta()
         - coalesce((select sum(t.piezas * t.precio_cent) from operacion.toma_omar t
                      where t.estado = 'autorizada' and t.precio_cent is not null
                        and not exists (select 1 from operacion.liquidacion_omar q where t.fecha_neg between q.semana_ini and q.semana_fin)), 0)
         + coalesce((select sum(monto_cent) from operacion.renta_devengo), 0) - coalesce((select sum(renta_cent) from operacion.liquidacion_omar), 0)
    into v_a;
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
  -- C23 efectivo: caja contable contra efectivo operativo (puente de movimientos de efectivo a asientos, migracion 8000)
  v_a := operacion.saldo_efectivo();
  v_b := contabilidad.saldo_deudor('1101') + contabilidad.saldo_deudor('1102');
  codigo := 'C23'; nombre := 'Efectivo: cuentas de efectivo operativas contra caja contable (1101 y 1102)'; bloqueante := false; via_a_nombre := 'Suma de las cuentas de efectivo'; via_a_cent := v_a; via_b_nombre := 'Cuentas 1101 y 1102 del libro'; via_b_cent := v_b; ok := v_a = v_b; return next;
  -- C24 cajas por persona: cada caja de efectivo contra su dimension en 1101 (suma de diferencias absolutas; 0 cuando todas cuadran)
  select coalesce(sum(abs(x.diferencia_cent)), 0)::bigint into v_a from contabilidad.efectivo_por_caja() x;
  codigo := 'C24'; nombre := 'Cajas por persona: cada caja de efectivo contra su dimensión en 1101'; bloqueante := false; via_a_nombre := 'Suma de diferencias por caja (valor absoluto)'; via_a_cent := v_a; via_b_nombre := 'Cero: cada caja igual a su dimensión del libro'; via_b_cent := 0; ok := v_a = 0; return next;
  -- Identidades de la paridad con el Excel (doc 18)
  v_activo := contabilidad.suma_tipo('A'); v_pasivo := contabilidad.suma_tipo('P'); v_capital := contabilidad.suma_tipo('K'); v_res := contabilidad.resultado();
  codigo := 'CU1'; nombre := 'Identidad I-1: activo igual a pasivo más capital'; bloqueante := true; via_a_nombre := 'Activo'; via_a_cent := v_activo; via_b_nombre := 'Pasivo más capital más resultado'; via_b_cent := v_pasivo + v_capital + v_res; ok := v_activo = v_pasivo + v_capital + v_res; return next;
  v_ind := (v_activo - v_pasivo) - v_capital;
  codigo := 'CU2'; nombre := 'Identidad I-2: resultado igual a la variación del capital'; bloqueante := true; via_a_nombre := 'Ingresos menos costos y gastos'; via_a_cent := v_res; via_b_nombre := 'Activo menos pasivo menos capital aportado'; via_b_cent := v_ind; ok := v_res = v_ind; return next;
  select coalesce((select sum(piezas) from operacion.existencia_sku_ubicacion), 0), coalesce((select sum(piezas) from operacion.existencia_modelo), 0) into v_a, v_b;
  codigo := 'CU3'; nombre := 'Piezas por sabor igual a piezas por modelo'; bloqueante := true; via_a_nombre := 'Suma por sabor'; via_a_cent := v_a; via_b_nombre := 'Suma por modelo'; via_b_cent := v_b; ok := v_a = v_b; unidad := 'pz'; return next; unidad := 'mxn';
end $$;
