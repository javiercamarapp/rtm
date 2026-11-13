-- Lecturas propias del rol 'bodega' (solo lectura). Cada funcion devuelve SOLO los campos que la persona de bodega necesita para preparar y guardar:
-- cliente (nombre), modelo, sabor, piezas, folio, estado de empaque, zona (Merida o fuera), proveedor, fecha esperada y guia de entrada (paqueteria y numero).
-- NUNCA devuelve precios, montos, costos, margenes, saldos, telefonos, direcciones, notas, ni el dueno del cliente.
-- Validan el rol dentro: bodega (y socio, para ver la vista tal como la ve bodega). Omar y anon reciben 42501.
-- Decision: no se expone ninguna accion de escritura (marcar enviado y recibir compra mueven dinero, costos y asientos; marcar empacado exigiria reimplementar la
-- funcion de operacion con otro rol). Ver docs/rol-bodega.md.

create function api.bodega_hoy_a_preparar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy();
begin
  perform seguridad.exigir_rol(array['bodega', 'socio']);
  return jsonb_build_object(
    'fecha', v_hoy,
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object('cliente', q.cliente, 'piezas', q.piezas, 'pedidos', q.pedidos) order by q.mas_viejo, q.cliente)
      from (
        select c.nombre_canonico as cliente, min(pe.fecha_neg) as mas_viejo,
               sum((select sum(l.piezas_pedidas) from operacion.pedido_linea l where l.pedido_id = pe.id))::int as piezas,
               jsonb_agg(jsonb_build_object(
                 'folio', pe.folio, 'fecha', pe.fecha_neg, 'de_hoy', pe.fecha_neg = v_hoy, 'empacado', pe.empacado_at is not null,
                 'zona', (select d.zona from catalogo.cliente_destino d where d.id = pe.destino_id),
                 'piezas', (select sum(l.piezas_pedidas) from operacion.pedido_linea l where l.pedido_id = pe.id)::int,
                 'lineas', coalesce((select jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas_pedidas) order by m.nombre_canonico, sa.nombre_canonico)
                                      from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                                     where l.pedido_id = pe.id), '[]'::jsonb)) order by pe.fecha_neg, pe.id) as pedidos
          from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
         where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen)
         group by c.id, c.nombre_canonico) q), '[]'::jsonb),
    'surtido', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', s.modelo, 'sabor', s.sabor, 'piezas', s.piezas, 'existencia', s.existencia, 'falta', greatest(s.piezas - s.existencia, 0)) order by s.modelo, s.sabor)
      from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_pedidas)::int as piezas,
                   coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = l.sku_id and u.ubicacion = 'bodega_omar'), 0)::int as existencia
              from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id join catalogo.sku k on k.id = l.sku_id
                   join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
             where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen)
             group by l.sku_id, m.nombre_canonico, sa.nombre_canonico) s), '[]'::jsonb),
    'resumen', (select jsonb_build_object(
        'pedidos', count(*)::int,
        'clientes', count(distinct pe.cliente_id)::int,
        'por_empacar', count(*) filter (where pe.empacado_at is null)::int,
        'empacados', count(*) filter (where pe.empacado_at is not null)::int,
        'de_dias_anteriores', count(*) filter (where pe.fecha_neg < v_hoy)::int,
        'piezas', coalesce(sum((select sum(l.piezas_pedidas) from operacion.pedido_linea l where l.pedido_id = pe.id)), 0)::int)
      from operacion.pedido pe where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen)));
end $$;

create function api.bodega_llegadas() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy();
begin
  perform seguridad.exigir_rol(array['bodega', 'socio']);
  return jsonb_build_object(
    'fecha', v_hoy,
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
          'folio', co.folio, 'proveedor', p.nombre, 'estado', co.estado, 'llegada_estimada', co.llegada_estimada, 'enviada_fecha', co.enviada_fecha,
          'dias_en_camino', case when co.enviada_fecha is null then null else v_hoy - co.enviada_fecha end,
          'atrasada', co.llegada_estimada is not null and co.llegada_estimada < v_hoy and co.estado <> 'llego_merida',
          'piezas', (select sum(l.piezas_facturadas) from operacion.compra_linea l where l.compra_id = co.id)::int,
          'guias', coalesce((select jsonb_agg(jsonb_build_object('paqueteria', g.paqueteria, 'numero', g.numero) order by g.id) from operacion.guia g where g.compra_id = co.id and g.sentido = 'entrada'), '[]'::jsonb),
          'lineas', coalesce((select jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas_facturadas) order by m.nombre_canonico, sa.nombre_canonico)
                               from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                              where l.compra_id = co.id), '[]'::jsonb))
        order by (co.estado = 'llego_merida') desc, co.llegada_estimada nulls last, co.id)
      from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id
     where co.destino = 'bodega' and co.estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')), '[]'::jsonb),
    'por_guardar', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', s.modelo, 'sabor', s.sabor, 'piezas', s.piezas) order by s.modelo, s.sabor)
      from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_facturadas)::int as piezas
              from operacion.compra_linea l join operacion.compra co on co.id = l.compra_id join catalogo.sku k on k.id = l.sku_id
                   join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
             where co.destino = 'bodega' and co.estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')
             group by m.nombre_canonico, sa.nombre_canonico) s), '[]'::jsonb));
end $$;

revoke execute on function api.bodega_hoy_a_preparar(), api.bodega_llegadas() from public, anon;
grant execute on function api.bodega_hoy_a_preparar(), api.bodega_llegadas() to authenticated;
