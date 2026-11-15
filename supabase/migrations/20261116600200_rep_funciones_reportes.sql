-- Carril RELOJ, punto 3 y 4 (cifras): funciones agente.rep_* de SOLO LECTURA para el resumen diario, los pendientes y las alertas.
-- Todas son solo-servidor (notificacion.exigir_sistema), devuelven centavos y conteos ya calculados por SQL; TypeScript solo extrae campos y da formato.
-- Ninguna cifra la calcula el modelo de IA. Sin dueno de cliente (RTM se opera como un solo negocio). Sin datos de contacto.
--   rep_telegram            resumen del dia: ventas, cobrado, por cobrar, vencidos, deuda con Isaac/Karen/Omar, valuacion e igualacion, fondos en poder, pedidos enviados, concentracion, libro.
--   rep_cartera_vencimientos cuentas por cobrar vencidas y por vencer, agrupadas por cliente.
--   rep_vencimientos_proveedor obligaciones con Isaac (plazo 7) y Karen (plazo 10) con el pago FIFO ya aplicado: solo lo que queda pendiente, por fecha de vencimiento.
--   rep_liquidez            cobertura = cobrable hasta la fecha de pago / pagable a proveedores (en centesimas: 118 = 1.18).
--   rep_concentracion       participacion del mayor cliente y de los dos mayores en la cartera (puntos base).
--   rep_margen              pedidos enviados con margen menor al minimo; excluye los pedidos a costo del socio.
--   rep_pendientes          lo accionable de la manana: cobros y pagos proximos, tareas abiertas.
-- Migracion ADITIVA (funciones nuevas).

insert into catalogo.config (clave, valor, vigente_desde) values
  ('margen_minimo_bp', '500', '2026-11-10'),
  ('rep_dias_proximos', '3', '2026-11-10'),
  ('rep_concentracion_umbral_bp', '4000', '2026-11-10');

-- ---------------------------------------------------------------------------
-- Cartera de clientes: una fila por pedido enviado con saldo (la comparten varias funciones)
-- ---------------------------------------------------------------------------
create function agente._rep_cartera(p_hoy date) returns table (pedido_id bigint, folio text, cliente_id bigint, cliente text, saldo_cent bigint, fecha_envio date, plazo_dias int, vence date, dias_atraso int)
language sql stable security definer set search_path = ''
as $$
  select pe.id, pe.folio, c.id, c.nombre_canonico, operacion.pedido_saldo(pe.id), pe.fecha_envio, pe.plazo_dias,
         case when pe.plazo_dias is null then null else pe.fecha_envio + pe.plazo_dias end,
         case when pe.plazo_dias is null then null else greatest(p_hoy - (pe.fecha_envio + pe.plazo_dias), 0) end
    from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
   where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0
$$;

create function agente.rep_cartera_vencimientos(p_hoy date default null, p_dias int default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := coalesce(p_hoy, negocio.hoy()); v_dias int := coalesce(p_dias, (catalogo.config_valor('rep_dias_proximos') #>> '{}')::int);
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object('hoy', v_hoy, 'dias', v_dias,
    'vencidos', (select coalesce(jsonb_agg(jsonb_build_object('cliente', q.cliente, 'cliente_id', q.cliente_id, 'saldo_cent', q.s, 'pedidos', q.n, 'dias_atraso_max', q.d, 'folios', q.f) order by q.s desc, q.cliente), '[]'::jsonb)
                   from (select cliente, cliente_id, sum(saldo_cent)::bigint s, count(*)::int n, max(dias_atraso) d, jsonb_agg(folio order by folio) f from agente._rep_cartera(v_hoy) where vence is not null and vence < v_hoy group by cliente, cliente_id) q),
    'vencen_manana', (select coalesce(jsonb_agg(jsonb_build_object('cliente', q.cliente, 'cliente_id', q.cliente_id, 'saldo_cent', q.s, 'pedidos', q.n, 'folios', q.f) order by q.s desc, q.cliente), '[]'::jsonb)
                   from (select cliente, cliente_id, sum(saldo_cent)::bigint s, count(*)::int n, jsonb_agg(folio order by folio) f from agente._rep_cartera(v_hoy) where vence = v_hoy + 1 group by cliente, cliente_id) q),
    'proximos', (select coalesce(jsonb_agg(jsonb_build_object('cliente', q.cliente, 'cliente_id', q.cliente_id, 'saldo_cent', q.s, 'pedidos', q.n, 'vence', q.v, 'folios', q.f) order by q.v, q.s desc, q.cliente), '[]'::jsonb)
                   from (select cliente, cliente_id, sum(saldo_cent)::bigint s, count(*)::int n, min(vence) v, jsonb_agg(folio order by folio) f from agente._rep_cartera(v_hoy) where vence between v_hoy and v_hoy + v_dias group by cliente, cliente_id) q),
    'sin_plazo_cent', (select coalesce(sum(saldo_cent), 0)::bigint from agente._rep_cartera(v_hoy) where vence is null),
    'vencido_cent', (select coalesce(sum(saldo_cent), 0)::bigint from agente._rep_cartera(v_hoy) where vence is not null and vence < v_hoy),
    'cobrable_cent', (select coalesce(sum(saldo_cent), 0)::bigint from agente._rep_cartera(v_hoy)));
end $$;

-- ---------------------------------------------------------------------------
-- Vencimientos de proveedor con FIFO: lo que se debe hoy (posicion del libro) se asigna a las obligaciones MAS RECIENTES; lo mas viejo se considera pagado primero.
-- ---------------------------------------------------------------------------
create function agente.rep_vencimientos_proveedor(p_hoy date default null, p_dias int default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_dias int := coalesce(p_dias, (catalogo.config_valor('rep_dias_proximos') #>> '{}')::int); p record; v_plazo int; v_deuda bigint; v_filas jsonb; v_out jsonb := '[]'::jsonb; v_asig bigint;
begin
  perform notificacion.exigir_sistema();
  for p in select id, nombre from catalogo.proveedor where nombre in ('Isaac', 'Karen') order by case nombre when 'Isaac' then 1 else 2 end loop
    v_plazo := coalesce((catalogo.config_valor('plazo_proveedor_dias') ->> p.nombre)::int, 7);
    v_deuda := greatest((operacion.posicion_proveedor(p.id) ->> 'deuda_empresa_cent')::bigint, 0);
    with obl as (
      select 'compra'::text as origen, c.folio, coalesce(c.enviada_fecha, c.fecha_neg) as fecha, c.total_cent::bigint as monto, c.id as oid
        from operacion.compra c where c.proveedor_id = p.id and c.estado not in ('borrador', 'anulada') and c.ambito = 'sociedad' and c.total_cent > 0
      union all
      select 'pedido', v.folio, coalesce(v.fecha_envio, v.fecha_neg), (v.costo_cent + v.seguro_cent)::bigint, v.pedido_id
        from operacion.v_ds_pedido v where v.proveedor_id = p.id and v.estado = 'enviado' and coalesce(v.tipo_venta, 'cliente') <> 'socio_a_costo' and v.costo_cent + v.seguro_cent > 0),
    acum as (select o.*, sum(o.monto) over (order by o.fecha desc, o.oid desc, o.origen) as cum from obl o),
    asig as (select a.*, least(a.monto, greatest(v_deuda - (a.cum - a.monto), 0))::bigint as pendiente from acum a)
    select coalesce(jsonb_agg(jsonb_build_object('origen', s.origen, 'folio', s.folio, 'fecha', s.fecha, 'vence', s.fecha + v_plazo, 'monto_cent', s.monto, 'pendiente_cent', s.pendiente,
                                                 'dias_para_vencer', (s.fecha + v_plazo) - v_hoy) order by s.fecha, s.oid), '[]'::jsonb), coalesce(sum(s.pendiente), 0)
      into v_filas, v_asig from asig s where s.pendiente > 0;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'proveedor', p.nombre, 'plazo_dias', v_plazo, 'deuda_cent', v_deuda, 'sin_fecha_cent', greatest(v_deuda - v_asig, 0), 'filas', v_filas,
      'vencido_cent', (select coalesce(sum((f ->> 'pendiente_cent')::bigint), 0) from jsonb_array_elements(v_filas) f where (f ->> 'dias_para_vencer')::int < 0),
      'proximo_cent', (select coalesce(sum((f ->> 'pendiente_cent')::bigint), 0) from jsonb_array_elements(v_filas) f where (f ->> 'dias_para_vencer')::int between 0 and v_dias),
      'proximo_vence', (select min((f ->> 'vence')::date) from jsonb_array_elements(v_filas) f where (f ->> 'dias_para_vencer')::int >= 0)));
  end loop;
  return jsonb_build_object('hoy', v_hoy, 'dias', v_dias, 'proveedores', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- Liquidez: cobertura de pagos a proveedor. Fecha de pago = la proxima fecha de vencimiento de proveedor (o hoy + dias si no hay fechas). Cobrable = saldos de clientes que vencen
-- a mas tardar en esa fecha (incluye lo ya vencido). Centesimas enteras (118 = 1.18); null si no hay nada por pagar. Se informa tambien sin el cliente mayor (prueba de estres).
-- ---------------------------------------------------------------------------
create function agente.rep_liquidez(p_hoy date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_v jsonb; v_pagable bigint; v_fecha date; v_cobrable bigint; v_mayor_id bigint; v_mayor_nombre text; v_mayor bigint; v_cob int; v_cob_sin int;
begin
  perform notificacion.exigir_sistema();
  v_v := agente.rep_vencimientos_proveedor(v_hoy);
  v_pagable := (select coalesce(sum((p ->> 'deuda_cent')::bigint), 0) from jsonb_array_elements(v_v -> 'proveedores') p);
  v_fecha := coalesce((select min((p ->> 'proximo_vence')::date) from jsonb_array_elements(v_v -> 'proveedores') p), v_hoy + (catalogo.config_valor('rep_dias_proximos') #>> '{}')::int);
  -- Lo que ya vencio tambien es pagable hoy: la fecha de pago no es anterior a hoy.
  v_fecha := greatest(v_fecha, v_hoy);
  select coalesce(sum(saldo_cent), 0) into v_cobrable from agente._rep_cartera(v_hoy) where vence is not null and vence <= v_fecha;
  select cliente_id, cliente, s into v_mayor_id, v_mayor_nombre, v_mayor from (select cliente_id, cliente, sum(saldo_cent)::bigint s from agente._rep_cartera(v_hoy) where vence is not null and vence <= v_fecha group by cliente_id, cliente order by 3 desc, cliente limit 1) q;
  v_cob := case when v_pagable > 0 then negocio.redondear_medio_arriba(v_cobrable * 100, v_pagable)::int end;
  v_cob_sin := case when v_pagable > 0 then negocio.redondear_medio_arriba((v_cobrable - coalesce(v_mayor, 0)) * 100, v_pagable)::int end;
  return jsonb_build_object('hoy', v_hoy, 'fecha_pago', v_fecha, 'pagable_cent', v_pagable, 'cobrable_cent', v_cobrable, 'cobertura_centesimas', v_cob,
    'mayor_cliente', v_mayor_nombre, 'mayor_cliente_cent', coalesce(v_mayor, 0), 'cobertura_sin_mayor_centesimas', v_cob_sin, 'bajo_uno', coalesce(v_cob < 100, false));
end $$;

create function agente.rep_concentracion(p_hoy date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := coalesce(p_hoy, negocio.hoy()); v_tot bigint; v_p jsonb;
begin
  perform notificacion.exigir_sistema();
  select coalesce(sum(saldo_cent), 0) into v_tot from agente._rep_cartera(v_hoy);
  select coalesce(jsonb_agg(jsonb_build_object('cliente', q.cliente, 'saldo_cent', q.s, 'bp', negocio.redondear_medio_arriba(q.s * 10000, v_tot)) order by q.s desc, q.cliente), '[]'::jsonb) into v_p
    from (select cliente, sum(saldo_cent)::bigint s from agente._rep_cartera(v_hoy) group by cliente order by 2 desc, 1 limit 2) q;
  return jsonb_build_object('hoy', v_hoy, 'total_cent', v_tot, 'top', v_p,
    'mayor_bp', coalesce((v_p -> 0 ->> 'bp')::int, 0), 'top2_bp', coalesce((select sum((x ->> 'bp')::int) from jsonb_array_elements(v_p) x), 0),
    'sobre_umbral', coalesce((v_p -> 0 ->> 'bp')::int, 0) > (catalogo.config_valor('rep_concentracion_umbral_bp') #>> '{}')::int);
end $$;

-- ---------------------------------------------------------------------------
-- Margen: pedidos enviados en la ventana con margen menor al minimo. Excluye los pedidos a costo del socio (margen 0 por diseno).
-- ---------------------------------------------------------------------------
create function agente.rep_margen(p_hoy date default null, p_desde date default null, p_minimo_bp int default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := coalesce(p_hoy, negocio.hoy()); v_desde date := coalesce(p_desde, coalesce(p_hoy, negocio.hoy())); v_min int := coalesce(p_minimo_bp, (catalogo.config_valor('margen_minimo_bp') #>> '{}')::int);
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object('hoy', v_hoy, 'desde', v_desde, 'minimo_bp', v_min,
    'pedidos', (select coalesce(jsonb_agg(jsonb_build_object('pedido_id', q.pedido_id, 'folio', q.folio, 'cliente', q.cliente, 'venta_cent', q.venta, 'costo_cent', q.costo, 'margen_bp', q.bp, 'fecha_envio', q.fecha_envio) order by q.bp, q.folio), '[]'::jsonb)
                from (select v.pedido_id, v.folio, v.cliente, v.venta_cent as venta, (v.costo_cent + v.seguro_cent) as costo, v.fecha_envio,
                             negocio.redondear_medio_arriba((v.venta_cent - v.costo_cent - v.seguro_cent) * 10000, v.venta_cent)::int as bp
                        from operacion.v_ds_pedido v
                       where v.estado = 'enviado' and v.venta_cent > 0 and coalesce(v.tipo_venta, 'cliente') <> 'socio_a_costo' and v.fecha_envio between v_desde and v_hoy) q
               where q.bp < v_min));
end $$;

-- ---------------------------------------------------------------------------
-- Resumen del dia: todas las cifras que lee la plantilla de las 20:00.
-- ---------------------------------------------------------------------------
create function agente.rep_telegram(p_hoy date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_ventas jsonb; v_cobrado bigint; v_cxc bigint; v_cxc_ap bigint; v_venc bigint; v_sin_plazo bigint; v_pp jsonb; v_val jsonb; v_igu jsonb; v_fondos jsonb;
  v_env jsonb; v_libro jsonb;
begin
  perform notificacion.exigir_sistema();
  select jsonb_build_object('pedidos', count(*)::int, 'piezas', coalesce(sum((select sum(l.piezas_surtidas) from operacion.pedido_linea l where l.pedido_id = pe.id)), 0)::bigint,
                            'facturado_cent', coalesce(sum(operacion.pedido_cobrado(pe.id)), 0)::bigint)
    into v_ventas from operacion.pedido pe where pe.estado = 'enviado' and pe.fecha_envio = v_hoy;
  select coalesce(sum(p.monto_cent), 0) into v_cobrado from operacion.pago p where p.fecha_neg = v_hoy and not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id);
  select coalesce(sum(saldo_cent), 0), coalesce(sum(saldo_cent) filter (where vence is not null and vence < v_hoy), 0), coalesce(sum(saldo_cent) filter (where vence is null), 0)
    into v_cxc, v_venc, v_sin_plazo from agente._rep_cartera(v_hoy);
  select coalesce(sum(greatest(a.saldo_cent, 0)), 0) into v_cxc_ap from operacion.cxc_apertura() a;
  v_pp := operacion.por_pagar_renglones();
  begin v_val := agente.valuacion_socios(); exception when sqlstate 'P0460' then v_val := null; end;
  begin v_igu := agente.igualacion(); exception when sqlstate 'P0460' then v_igu := null; end;
  select jsonb_build_object('total_cent', coalesce(sum(greatest(operacion.saldo_socio(s.id, 'fondos'), 0)), 0)::bigint,
           'socios', coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre, 'cent', greatest(operacion.saldo_socio(s.id, 'fondos'), 0), 'dias', operacion.dias_fondos_en_poder(s.id)) order by s.nombre)
                                filter (where operacion.saldo_socio(s.id, 'fondos') > 0), '[]'::jsonb))
    into v_fondos from catalogo.socio s;
  select coalesce(jsonb_agg(jsonb_build_object('cliente', q.cliente, 'pedidos', q.n, 'folios', q.folios, 'piezas', q.pz, 'modelos', q.modelos) order by q.cliente), '[]'::jsonb) into v_env
    from (select c.nombre_canonico as cliente, count(*)::int as n, jsonb_agg(pe.folio order by pe.folio) as folios,
                 coalesce(sum((select sum(l.piezas_surtidas) from operacion.pedido_linea l where l.pedido_id = pe.id)), 0)::bigint as pz,
                 (select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'piezas', m.pz) order by m.nombre_canonico), '[]'::jsonb)
                    from (select mo.nombre_canonico, sum(l.piezas_surtidas)::bigint as pz from operacion.pedido p2 join operacion.pedido_linea l on l.pedido_id = p2.id join catalogo.modelo mo on mo.id = l.modelo_id
                           where p2.estado = 'enviado' and p2.fecha_envio = v_hoy and p2.cliente_id = c.id group by mo.nombre_canonico) m) as modelos
            from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id where pe.estado = 'enviado' and pe.fecha_envio = v_hoy group by c.id, c.nombre_canonico) q;
  select jsonb_build_object('rojas', coalesce(jsonb_agg(c.codigo order by c.codigo) filter (where not c.ok), '[]'::jsonb), 'total', count(*)::int) into v_libro from contabilidad.comprobaciones() c;
  return jsonb_build_object('hoy', v_hoy, 'ventas', v_ventas, 'cobrado_cent', v_cobrado, 'por_cobrar_cent', v_cxc + v_cxc_ap, 'cartera_pedidos_cent', v_cxc, 'apertura_cent', v_cxc_ap,
    'vencidos_cent', v_venc, 'sin_plazo_cent', v_sin_plazo, 'por_pagar', v_pp, 'valuacion', v_val, 'igualacion', v_igu, 'fondos_en_poder', v_fondos,
    'pedidos_enviados', v_env, 'concentracion', agente.rep_concentracion(v_hoy), 'margen', agente.rep_margen(v_hoy), 'libro', v_libro);
end $$;

-- ---------------------------------------------------------------------------
-- Pendientes de las 09:00
-- ---------------------------------------------------------------------------
create function agente.rep_pendientes(p_hoy date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := coalesce(p_hoy, negocio.hoy());
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object('hoy', v_hoy, 'cartera', agente.rep_cartera_vencimientos(v_hoy), 'proveedores', agente.rep_vencimientos_proveedor(v_hoy), 'liquidez', agente.rep_liquidez(v_hoy),
    'tareas', jsonb_build_object(
      'avisos_con_accion', (select count(*)::int from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo where a.estado = 'abierta' and t.requiere_accion),
      'diferencias_abiertas', (select count(*)::int from operacion.compra_diferencia d where not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = d.id)),
      'tomas_omar_pendientes', (select count(*)::int from operacion.toma_omar t where t.estado = 'pendiente')));
end $$;

do $$
declare f text;
begin
  foreach f in array array['agente.rep_cartera_vencimientos(date,int)', 'agente.rep_vencimientos_proveedor(date,int)', 'agente.rep_liquidez(date)', 'agente.rep_concentracion(date)',
                           'agente.rep_margen(date,date,int)', 'agente.rep_telegram(date)', 'agente.rep_pendientes(date)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to servidor', f);
  end loop;
  revoke all on function agente._rep_cartera(date) from public, anon, authenticated, servidor;
end $$;
