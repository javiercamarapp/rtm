-- Puente contable del efectivo: los eventos `movimiento_efectivo` (saldo_inicial, ajuste_conteo y traspaso entre cuentas de efectivo) ya generan asiento,
-- y una comprobacion nueva (C23) compara las cuentas de efectivo operativas contra la caja contable (1101 y 1102). Ver docs/puente-efectivo-asientos.md.
-- Sigue el patron de f3b (0018): el asiento es una proyeccion determinista de los hechos del evento (`lineas_de_evento`), con hash encadenado y periodo
-- calculados por `asentar_evento` y creado por el trigger diferido al COMMIT. No se edita ninguna migracion anterior: `lineas_de_evento` se envuelve
-- (la original pasa a `lineas_de_evento_base`, intacta) y solo los dos tipos de evento nuevos usan la rama de efectivo.
-- Reglas propuestas por el orquestador a falta de decision del dueno (parametros en catalogo.config, documentados):
--  * saldo inicial de una cuenta de efectivo: cargo a la caja y abono a la cuenta de apertura (por omision 3990, puente de saldos de apertura que C20 vigila hasta
--    que el dueno firme el cuadre). No se abona a 3110 y 3120 porque C4 (bloqueante) compara esas cuentas contra las aportaciones operativas y fallaria.
--  * sobrante o faltante de conteo: cuenta de resultados 7200 'Sobrante o faltante de caja' (nueva; entra a otros del estado de resultados y a C16).
--  * traspaso entre cuentas de efectivo: movimiento entre cuentas de caja (1101 y 1102, con el socio custodio como dimension); no crea deuda con el socio
--    porque `efectivo_sociedad` cuenta el efectivo a cargo de un socio como efectivo de la sociedad (un pago real al socio ya se asienta con registrar_pago_a_socio).
-- Nota: el efectivo de una cuenta de socio se asienta en 1101 con `socio_id` del custodio.

insert into contabilidad.cuenta (codigo, nombre, tipo, naturaleza, activa, nota) values
  ('7200', 'Sobrante o faltante de caja', 'G', 'D', true, 'Ajuste de conteo del efectivo: saldo deudor = faltante, acreedor = sobrante. Entra a otros del estado de resultados.');

insert into catalogo.config (clave, valor, vigente_desde) values
  ('puente_efectivo_contra_saldo_inicial', '"3990"', '2026-11-11'),
  ('puente_efectivo_cuenta_diferencia_conteo', '"7200"', '2026-11-11');

-- ---------------------------------------------------------------------------
-- Lineas de un evento: envoltura que agrega la rama de efectivo
-- ---------------------------------------------------------------------------
alter function contabilidad.lineas_de_evento(bigint) rename to lineas_de_evento_base;

create function contabilidad.lineas_de_evento(p_evento bigint)
returns table (cuenta text, debe_cent bigint, haber_cent bigint, cliente_id bigint, proveedor_id bigint, socio_id bigint, modelo_id bigint, pedido_id bigint, nota text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_tipo text; v_fecha date; v_apertura text; v_dif text; v_cajas int; v_custodio bigint; v_efectivo bigint; v_solo_cajas boolean; v_base bigint;
begin
  select e.tipo, e.fecha_neg into v_tipo, v_fecha from operacion.evento e where e.id = p_evento;
  if v_tipo is null then return; end if;
  if v_tipo not in ('movimiento_efectivo', 'movimiento_efectivo_anulado') then
    -- Caja por persona: si el evento mueve el efectivo de una sola caja y su efecto neto es el mismo que el de 1101 en el asiento base, la dimension de 1101 es el
    -- custodio de esa caja (la empresa = sin dimension), no quien deposito o entrego. Si no coincide, el asiento base queda tal cual y C23 y C24 lo senalan.
    select count(distinct coalesce(c.socio_id, 0))::int, min(c.socio_id), coalesce(sum(m.monto_cent), 0)::bigint, coalesce(bool_and(c.tipo = 'caja'), false)
      into v_cajas, v_custodio, v_efectivo, v_solo_cajas
      from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id where m.evento_id = p_evento;
    if v_cajas = 1 and v_solo_cajas then
      select coalesce(sum(b.debe_cent - b.haber_cent), 0)::bigint into v_base from contabilidad.lineas_de_evento_base(p_evento) b where b.cuenta = '1101';
      if v_base = v_efectivo then
        return query select b.cuenta, b.debe_cent, b.haber_cent, b.cliente_id, b.proveedor_id, case when b.cuenta = '1101' then v_custodio else b.socio_id end, b.modelo_id, b.pedido_id, b.nota
                       from contabilidad.lineas_de_evento_base(p_evento) b;
        return;
      end if;
    end if;
    return query select b.cuenta, b.debe_cent, b.haber_cent, b.cliente_id, b.proveedor_id, b.socio_id, b.modelo_id, b.pedido_id, b.nota from contabilidad.lineas_de_evento_base(p_evento) b;
    return;
  end if;
  v_apertura := coalesce(catalogo.config_valor('puente_efectivo_contra_saldo_inicial', v_fecha) #>> '{}', '3990');
  v_dif := coalesce(catalogo.config_valor('puente_efectivo_cuenta_diferencia_conteo', v_fecha) #>> '{}', '7200');
  -- Cada renglon del libro de efectivo del evento (o su reversa, con el concepto del original) mueve la caja contable con el signo del renglon; el saldo inicial
  -- y el ajuste de conteo agregan su contrapartida. El traspaso trae dos renglones que se compensan: queda como movimiento entre cuentas de caja.
  return query
  select x.cuenta, greatest(x.s, 0)::bigint, greatest(-x.s, 0)::bigint, null::bigint, null::bigint, x.socio_id, null::bigint, null::bigint, x.nota
  from (
    select l.cuenta, sum(l.d)::bigint as s, l.socio_id, min(l.nota) as nota
    from (
      select case c.tipo when 'banco' then '1102' else '1101' end as cuenta, m.monto_cent as d, c.socio_id, ('Efectivo: ' || coalesce(o.concepto, m.concepto))::text as nota
        from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id left join operacion.cuenta_efectivo_mov o on o.id = m.reversa_de
       where m.evento_id = p_evento
      union all
      select case coalesce(o.concepto, m.concepto) when 'saldo_inicial' then v_apertura else v_dif end, -m.monto_cent, c.socio_id,
             (case coalesce(o.concepto, m.concepto) when 'saldo_inicial' then 'Contrapartida del saldo inicial' else 'Sobrante o faltante de caja' end)::text
        from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id left join operacion.cuenta_efectivo_mov o on o.id = m.reversa_de
       where m.evento_id = p_evento and coalesce(o.concepto, m.concepto) in ('saldo_inicial', 'ajuste_conteo')
    ) l
    group by l.cuenta, l.socio_id
  ) x
  where x.s <> 0
  order by x.cuenta, x.socio_id nulls first;
end $$;
revoke execute on function contabilidad.lineas_de_evento(bigint), contabilidad.lineas_de_evento_base(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deshacer un movimiento de efectivo (saldo inicial, ajuste o traspaso) con su contramovimiento: nunca borra. La reversa se asienta como evento propio.
-- ---------------------------------------------------------------------------
create function operacion.anular_movimiento_efectivo(p_clave_idem text, p_movimiento bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; m operacion.cuenta_efectivo_mov; v_orig operacion.evento; v_ev bigint; r record; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_movimiento_efectivo', 'm', p_movimiento, 'x', p_motivo));
  if v_prev is not null then return v_prev; end if;
  perform operacion.bloquear_dinero(false);
  if nullif(btrim(p_motivo), '') is null then raise exception 'deshacer exige motivo' using errcode = '23502'; end if;
  select * into m from operacion.cuenta_efectivo_mov where id = p_movimiento;
  if not found then raise exception 'movimiento de efectivo desconocido' using errcode = '22023'; end if;
  select * into v_orig from operacion.evento where id = m.evento_id;
  if v_orig.tipo <> 'movimiento_efectivo' or m.concepto not in ('saldo_inicial', 'ajuste_conteo', 'traspaso') then
    raise exception 'solo se deshacen saldos iniciales, ajustes de conteo y traspasos: lo demas se deshace desde su operacion' using errcode = 'P0428';
  end if;
  if exists (select 1 from operacion.cuenta_efectivo_mov rv join operacion.cuenta_efectivo_mov xo on xo.id = rv.reversa_de where xo.evento_id = v_orig.id) then
    raise exception 'ese movimiento ya esta deshecho' using errcode = 'P0428';
  end if;
  for r in select x.cuenta_id, sum(x.monto_cent)::bigint as monto from operacion.cuenta_efectivo_mov x where x.evento_id = v_orig.id group by x.cuenta_id loop
    if operacion.saldo_efectivo(r.cuenta_id) - r.monto < 0 then raise exception 'no se puede deshacer: la cuenta de efectivo quedaria en negativo' using errcode = 'P0428'; end if;
  end loop;
  v_ev := operacion.crear_evento('movimiento_efectivo_anulado', negocio.hoy(), p_clave_idem, jsonb_build_object('movimiento', p_movimiento, 'evento', v_orig.id), null, v_orig.id, p_motivo);
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id, reversa_de)
    select x.cuenta_id, negocio.hoy(), 'reversa', -x.monto_cent, 'Se deshace: ' || p_motivo, x.ref_tipo, x.ref_id, v_ev, x.id from operacion.cuenta_efectivo_mov x where x.evento_id = v_orig.id order by x.id;
  v_res := jsonb_build_object('deshecho', true, 'evento_id', v_ev, 'efectivo', operacion.efectivo_sociedad());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;
revoke execute on function operacion.anular_movimiento_efectivo(text, bigint, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Cajas por persona contra el libro: para cada caja (o banco) de efectivo, su saldo operativo contra la cuenta 1101 (1102) con esa persona como dimension.
-- La caja de la empresa no lleva dimension (socio null). Incluye las dimensiones del libro que no tienen cuenta de efectivo (diferencia = todo su saldo).
-- ---------------------------------------------------------------------------
create function contabilidad.efectivo_por_caja()
returns table (cuenta text, socio_id bigint, caja text, operativo_cent bigint, libro_cent bigint, diferencia_cent bigint)
language sql stable security definer set search_path = ''
as $$
  with k as (
    select case c.tipo when 'banco' then '1102' else '1101' end as cta, c.socio_id, string_agg(c.nombre, ', ' order by c.id) as nombre, sum(operacion.saldo_efectivo(c.id))::bigint as oper
      from operacion.cuenta_efectivo c where c.activa group by 1, 2),
  l as (
    select x.cuenta as cta, x.socio_id, sum(x.debe_cent - x.haber_cent)::bigint as libro
      from contabilidad.asiento_linea x where x.cuenta in ('1101', '1102') group by 1, 2)
  select coalesce(k.cta, l.cta)::text, coalesce(k.socio_id, l.socio_id),
         coalesce(k.nombre, 'Sin cuenta de efectivo' || coalesce(' (' || (select s.nombre from catalogo.socio s where s.id = l.socio_id) || ')', ' (sociedad)')),
         coalesce(k.oper, 0)::bigint, coalesce(l.libro, 0)::bigint, (coalesce(k.oper, 0) - coalesce(l.libro, 0))::bigint
    from k full join l on l.cta = k.cta and l.socio_id is not distinct from k.socio_id
   order by 1, 2 nulls first
$$;
revoke execute on function contabilidad.efectivo_por_caja() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Comprobaciones: C23 (efectivo operativo contra caja contable) y C16 con el sobrante o faltante de caja. Estado de resultados con la cuenta 7200 en otros.
-- Misma funcion que f3b (0019) con solo esos cambios.
-- ---------------------------------------------------------------------------
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
       -- Sobrante o faltante de caja (cuenta 7200): ajustes de conteo del efectivo que el puente asienta (migracion 8000).
       + coalesce((select sum(m.monto_cent) from operacion.cuenta_efectivo_mov m join operacion.evento ev on ev.id = m.evento_id left join operacion.cuenta_efectivo_mov o on o.id = m.reversa_de
                    where coalesce(o.concepto, m.concepto) = 'ajuste_conteo' and ev.tipo in ('movimiento_efectivo', 'movimiento_efectivo_anulado')), 0)
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

create or replace function contabilidad.estado_resultados(p_ini date, p_fin date) returns jsonb
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
  v_otros := coalesce((v_m->>'4910')::bigint, 0) + coalesce((v_m->>'4930')::bigint, 0) + coalesce((v_m->>'7100')::bigint, 0) + coalesce((v_m->>'6310')::bigint, 0) + coalesce((v_m->>'7900')::bigint, 0) + coalesce((v_m->>'7200')::bigint, 0);
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

-- ---------------------------------------------------------------------------
-- Explicar este numero de la diferencia de efectivo: conta:efectivo. Segunda via: diferencia evento por evento (efectivo operativo menos efectivo del asiento).
-- ---------------------------------------------------------------------------
alter function api.explicar_cifra(text) rename to explicar_cifra_socios;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_oper bigint; v_conta bigint; v_rengs jsonb; v_via2 bigint;
begin
  if partes[1] <> 'conta' or partes[2] is distinct from 'efectivo' then return api.explicar_cifra_socios(p_cifra); end if;
  perform seguridad.exigir_rol(array['socio']);
  v_oper := operacion.saldo_efectivo();
  v_conta := contabilidad.saldo_deudor('1101') + contabilidad.saldo_deudor('1102');
  select coalesce(jsonb_agg(jsonb_build_object('concepto', d.folio || ' ' || replace(d.tipo, '_', ' ') || ': efectivo operativo ' || d.oper || ' contra libro ' || d.conta || coalesce(' (' || d.cuentas || ')', ''),
                                               'monto_cent', d.oper - d.conta, 'fecha_neg', d.fecha_neg) || operacion.evento_info(d.id) order by d.id), '[]'::jsonb),
         coalesce(sum(d.oper - d.conta), 0)::bigint
    into v_rengs, v_via2
  from (
    select e.id, e.folio, e.tipo, e.fecha_neg, coalesce(o.oper, 0) as oper, coalesce(k.conta, 0) as conta, o.cuentas
    from operacion.evento e
    left join (select m.evento_id, sum(m.monto_cent)::bigint as oper, string_agg(distinct c.nombre, ', ') as cuentas
                 from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id where c.activa group by m.evento_id) o on o.evento_id = e.id
    left join (select a.evento_id, sum(l.debe_cent - l.haber_cent)::bigint as conta
                 from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where l.cuenta in ('1101', '1102') group by a.evento_id) k on k.evento_id = e.id
    where coalesce(o.oper, 0) <> coalesce(k.conta, 0)
  ) d;
  return jsonb_build_object('cifra', p_cifra, 'titulo', 'Diferencia entre el efectivo operativo y la caja contable (1101 y 1102)', 'valor', v_oper - v_conta, 'unidad', 'mxn',
    'comprobacion', jsonb_build_object('via1', 'Suma de las cuentas de efectivo menos cuentas 1101 y 1102 del libro', 'via1_valor', v_oper - v_conta,
                                       'via2', 'Suma de las diferencias evento por evento', 'via2_valor', v_via2, 'cuadra', v_oper - v_conta = v_via2),
    'renglones', v_rengs, 'movimientos', '[]'::jsonb);
end $$;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra(text) from public, anon;
revoke execute on function api.explicar_cifra_socios(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enlaza los movimientos de efectivo que ya existian sin asiento (idempotente: asentar_evento no repite).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select e.id from operacion.evento e where e.tipo = 'movimiento_efectivo' and not exists (select 1 from contabilidad.asiento a where a.evento_id = e.id) order by e.id loop
    perform contabilidad.asentar_evento(r.id);
  end loop;
end $$;
