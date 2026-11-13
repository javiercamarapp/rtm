-- Devoluciones / 4: API. Lecturas de recepciones parciales y devoluciones, y las escrituras nuevas en la lista cerrada de la web (rol socio).
-- Las lecturas de compras ya no suponen un lote por linea (puede haber uno por llegada).

create or replace function api.compras_lista(p_proveedor text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov bigint := case when p_proveedor is null then null else catalogo.proveedor_id(p_proveedor) end;
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', co.id, 'folio', co.folio, 'proveedor', p.nombre, 'fecha_neg', co.fecha_neg, 'estado', co.estado, 'total_cent', co.total_cent, 'ambito', co.ambito,
      'pagadas', (select sum(piezas_pagadas) from operacion.compra_linea where compra_id = co.id), 'facturadas', (select sum(piezas_facturadas) from operacion.compra_linea where compra_id = co.id),
      'recibidas', (select sum(coalesce(piezas_recibidas, case when co.estado = 'recibida_parcial' then operacion.recibido_acumulado(id) end)) from operacion.compra_linea where compra_id = co.id),
      'diferencias_abiertas', (select count(*) from operacion.compra_diferencia d where d.compra_id = co.id and not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = d.id and x.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id)))) order by co.id desc)
    from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id where v_prov is null or co.proveedor_id = v_prov), '[]'::jsonb);
end $$;

create or replace function api.compra_detalle(p_compra bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare co operacion.compra; v jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into co from operacion.compra where id = p_compra;
  if not found then return null; end if;
  select jsonb_build_object(
    'id', co.id, 'folio', co.folio, 'estado', co.estado, 'fecha_neg', co.fecha_neg, 'destino', co.destino, 'ambito', co.ambito, 'mercancia_cent', co.mercancia_cent, 'guia_cent', co.guia_cent, 'seguro_cent', co.seguro_cent,
    'total_cent', co.total_cent, 'llegada_estimada', co.llegada_estimada, 'enviada_fecha', co.enviada_fecha, 'recibida_fecha', co.recibida_fecha, 'nota', co.nota,
    'proveedor', (select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'modalidad', p.modalidad) from catalogo.proveedor p where p.id = co.proveedor_id),
    'saldo_proveedor_cent', operacion.saldo_proveedor(co.proveedor_id),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'sku_id', l.sku_id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'pagadas', l.piezas_pagadas, 'facturadas', l.piezas_facturadas,
        'recibidas', coalesce(l.piezas_recibidas, case when co.estado = 'recibida_parcial' then operacion.recibido_acumulado(l.id) end), 'costo_unit_cent', l.costo_unit_cent, 'costo_lista_cent', l.costo_lista_cent, 'motivo_costo', l.motivo_costo,
        'lote', (select jsonb_build_object('costo_puesto_cent', sum(lo.costo_puesto_cent), 'valor_entrada_cent', sum(lo.valor_entrada_cent), 'guia_cent', sum(lo.guia_prorrateada_cent), 'seguro_cent', sum(lo.seguro_prorrateado_cent), 'llegadas', count(*)) from operacion.lote lo where lo.compra_linea_id = l.id having count(*) > 0)) order by l.id)
      from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.compra_id = co.id), '[]'::jsonb),
    'recepciones', coalesce((select jsonb_agg(jsonb_build_object('sabor', sa.nombre_canonico, 'modelo', m.nombre_canonico, 'piezas', r.piezas, 'contado_at', r.contado_at) order by r.id)
      from operacion.compra_recepcion r join catalogo.sku k on k.id = r.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where r.compra_id = co.id), '[]'::jsonb),
    'guias', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'paqueteria', g.paqueteria, 'numero', g.numero, 'fecha_neg', g.fecha_neg) order by g.id) from operacion.guia g where g.compra_id = co.id), '[]'::jsonb),
    'diferencias', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'piezas', d.piezas, 'valor_cent', d.valor_cent, 'modelo', m.nombre_canonico,
        'responsable', (select case when a.responsable = 'socio' then (select s.nombre from catalogo.socio s where s.id = a.socio_id) when a.responsable = 'proveedor' then 'Proveedor' end
                          from operacion.diferencia_asignacion a where a.diferencia_id = d.id and a.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = a.id) order by a.id desc limit 1),
        'responsable_tipo', coalesce((select a.responsable from operacion.diferencia_asignacion a where a.diferencia_id = d.id and a.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = a.id) order by a.id desc limit 1), 'sociedad'))
        order by d.id)
      from operacion.compra_diferencia d join operacion.compra_linea l on l.id = d.compra_linea_id join catalogo.modelo m on m.id = l.modelo_id where d.compra_id = co.id), '[]'::jsonb),
    'partidas_fuera_sociedad', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'monto_cent', f.monto_cent, 'piezas', f.piezas, 'estado', f.estado)) from operacion.partida_fuera_sociedad f join catalogo.socio s on s.id = f.socio_id where f.compra_id = co.id), '[]'::jsonb),
    'linea_tiempo', coalesce((select jsonb_agg(operacion.evento_info(e.id) || jsonb_build_object('tipo', e.tipo) order by e.id) from operacion.evento e where e.id = co.evento_id or e.payload->>'compra' = co.folio), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Estado de la recepcion de una compra: por linea lo facturado, lo contado, lo pendiente, y las llegadas con su valor.
create function api.compra_recepcion(p_compra bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare co operacion.compra;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into co from operacion.compra where id = p_compra;
  if not found then return null; end if;
  return jsonb_build_object('compra_id', co.id, 'folio', co.folio, 'estado', co.estado,
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('linea_id', l.id, 'sku_id', l.sku_id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'facturadas', l.piezas_facturadas,
        'recibidas', operacion.recibido_acumulado(l.id), 'pendientes', greatest(l.piezas_facturadas - operacion.recibido_acumulado(l.id), 0),
        'puesto_cent', p.puesto_cent, 'entrada_cent', coalesce((select sum(lo.valor_entrada_cent) from operacion.lote lo where lo.compra_linea_id = l.id), 0)) order by l.id)
      from operacion.compra_linea l join operacion.puesto_lineas_compra(co.id) p on p.linea_id = l.id join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
      where l.compra_id = co.id), '[]'::jsonb),
    'llegadas', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'contado_at', x.contado_at, 'piezas', x.piezas, 'valor_cent', x.valor) order by x.contado_at, x.n)
      from (select lo.recepcion_n as n, min(r.contado_at) as contado_at, sum(r.piezas)::int as piezas, max(lo.valor_entrada_cent) as valor
            from operacion.lote lo join operacion.compra_linea l on l.id = lo.compra_linea_id join operacion.movimiento_inventario mi on mi.lote_id = lo.id
                 join operacion.compra_recepcion r on r.movimiento_id = mi.id where l.compra_id = co.id group by lo.id, lo.recepcion_n) x), '[]'::jsonb));
end $$;

-- Lista de devoluciones (clientes y proveedores) con su estado.
create function api.devoluciones_lista() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'folio', d.folio, 'fecha_neg', d.fecha_neg, 'pedido_id', d.pedido_id, 'pedido', pe.folio, 'cliente', c.nombre_canonico, 'piezas', d.piezas,
        'monto_cent', d.monto_cent, 'costo_cent', d.costo_cent, 'liberado_cent', d.liberado_cent, 'motivo', d.motivo, 'anulada', exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id)) order by d.id desc)
      from operacion.devolucion_cliente d join operacion.pedido pe on pe.id = d.pedido_id join catalogo.cliente c on c.id = d.cliente_id), '[]'::jsonb),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'folio', d.folio, 'fecha_neg', d.fecha_neg, 'proveedor', p.nombre, 'compra', co.folio, 'piezas', d.piezas, 'valor_cent', d.valor_cent, 'motivo', d.motivo,
        'anulada', exists (select 1 from operacion.devolucion_proveedor_anulacion a where a.devolucion_id = d.id)) order by d.id desc)
      from operacion.devolucion_proveedor d join catalogo.proveedor p on p.id = d.proveedor_id left join operacion.compra co on co.id = d.compra_id), '[]'::jsonb),
    'credito_clientes_cent', coalesce((select sum(d.monto_cent) from operacion.devolucion_cliente d where not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id)), 0),
    'credito_proveedores_cent', coalesce((select sum(d.valor_cent) from operacion.devolucion_proveedor d where not exists (select 1 from operacion.devolucion_proveedor_anulacion a where a.devolucion_id = d.id)), 0));
end $$;

-- Lo que se puede devolver de un pedido: por renglon y sabor, lo surtido, lo ya devuelto y el precio de la nota vigente; mas las devoluciones hechas.
create function api.pedido_devoluciones(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pe operacion.pedido; ult operacion.nota;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into pe from operacion.pedido where id = p_pedido;
  if not found then return null; end if;
  select * into ult from operacion.nota where pedido_id = pe.id order by id desc limit 1;
  return jsonb_build_object('pedido_id', pe.id, 'folio', pe.folio, 'puede', pe.estado = 'enviado' and operacion.origen_es_bodega(pe.origen),
    'motivo_no', case when pe.estado <> 'enviado' then 'El pedido no está enviado.' when not operacion.origen_es_bodega(pe.origen) then 'El pedido salió directo del proveedor.' end,
    'devuelto_cent', operacion.devuelto_pedido(pe.id),
    -- Cifras del pedido ya netas de devoluciones vigentes (la web no calcula dinero): total cobrado = total de la nota - credito; el costo de lo que regreso a inventario sale del costo; lo que se fue a merma sigue siendo costo; la renta y la guia no cambian (regla pendiente del dueno).
    'cascada_neta', case when ult.snapshot_interno->'cascada' is null then null else jsonb_build_object(
      'total_cent', (ult.snapshot_interno->'cascada'->>'total_cent')::bigint - operacion.devuelto_pedido(pe.id),
      'costo_cent', (ult.snapshot_interno->'cascada'->>'costo_cent')::bigint - coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'inventario'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0),
      'costo_regresado_cent', coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'inventario'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0),
      'merma_cent', coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'merma'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0),
      'utilidad_cent', (ult.snapshot_interno->'cascada'->>'utilidad_cent')::bigint - operacion.devuelto_pedido(pe.id) + coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'inventario'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0)) end,
    'renglones', coalesce((select jsonb_agg(jsonb_build_object('linea_id', l.id, 'sku_id', s.sku_id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'surtidas', s.piezas, 'devueltas', operacion.devuelto_linea_sku(l.id, s.sku_id),
        'disponibles_devolver', s.piezas - operacion.devuelto_linea_sku(l.id, s.sku_id), 'precio_cent', coalesce((ult.ajustes->'precios'->>(l.id::text))::bigint, l.precio_cent)) order by l.id, sa.nombre_canonico)
      from operacion.pedido_linea l join (select pedido_linea_id, sku_id, sum(piezas)::int as piezas from operacion.pedido_surtido group by pedido_linea_id, sku_id) s on s.pedido_linea_id = l.id
           join catalogo.sku k on k.id = s.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = pe.id), '[]'::jsonb),
    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'folio', d.folio, 'fecha_neg', d.fecha_neg, 'piezas', d.piezas, 'monto_cent', d.monto_cent, 'liberado_cent', d.liberado_cent, 'motivo', d.motivo,
        'anulada', exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id),
        'pdf', exists (select 1 from operacion.devolucion_documento x where x.tipo = 'cliente' and x.devolucion_id = d.id and x.variante = 'pdf')) order by d.id)
      from operacion.devolucion_cliente d where d.pedido_id = pe.id), '[]'::jsonb));
end $$;

-- Catalogo de la devolucion a un proveedor: lo disponible hoy en la bodega por sabor, con el costo promedio del modelo.
create function api.devolucion_proveedor_catalogo() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('skus', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'disponible', operacion.disponible_sku(k.id),
        'costo_prom_cent', e.costo_prom_cent) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
      from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
           join operacion.existencia_modelo e on e.modelo_id = m.id where operacion.disponible_sku(k.id) > 0), '[]'::jsonb),
    'compras', coalesce((select jsonb_agg(jsonb_build_object('id', co.id, 'folio', co.folio, 'proveedor', p.nombre, 'estado', co.estado) order by co.id desc)
      from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id where co.estado in ('recibida_parcial', 'recibida', 'cerrada')), '[]'::jsonb));
end $$;

-- Fuente de la nota de credito o de la devolucion a proveedor (snapshot que se imprime) y su documento guardado.
create function api.devolucion_fuente(p_tipo text, p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_tipo = 'cliente' then
    select jsonb_build_object('tipo', 'cliente', 'id', d.id, 'folio', d.folio, 'emitida_at', d.creado_at, 'snapshot', d.snapshot_cliente, 'texto', d.texto_whatsapp) into v from operacion.devolucion_cliente d where d.id = p_id;
  elsif p_tipo = 'proveedor' then
    select jsonb_build_object('tipo', 'proveedor', 'id', d.id, 'folio', d.folio, 'emitida_at', d.creado_at, 'snapshot', d.snapshot, 'texto', d.texto) into v from operacion.devolucion_proveedor d where d.id = p_id;
  else raise exception 'tipo invalido' using errcode = '22023'; end if;
  return v;
end $$;

create function api.devolucion_documento(p_tipo text, p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select jsonb_build_object('sha256', d.sha256, 'base64', encode(d.contenido, 'base64')) into v from operacion.devolucion_documento d where d.tipo = p_tipo and d.devolucion_id = p_id and d.variante = 'pdf';
  return v;
end $$;

-- Envoltorios de escritura (rol socio).
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['recibir_compra_parcial', 'cerrar_recepcion_compra', 'registrar_devolucion_cliente', 'anular_devolucion_cliente', 'devolver_a_proveedor', 'anular_devolucion_proveedor', 'guardar_documento_devolucion'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;

grant execute on function api.compra_recepcion(bigint), api.devoluciones_lista(), api.pedido_devoluciones(bigint), api.devolucion_proveedor_catalogo(), api.devolucion_fuente(text, bigint), api.devolucion_documento(text, bigint),
  api.compras_lista(text), api.compra_detalle(bigint) to authenticated;
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
