-- Mensaje final de un pedido registrado (decision del dueno, 14-nov): "pedido registrado en sistema con folio X" con TODOS los datos.
-- agente.resumen_pedido_registrado(pedido) devuelve las cifras ya calculadas por SQL: el modelo de IA no calcula nada y TypeScript solo da formato.
--   cliente, lineas por modelo y sabor, total, plazo y vencimiento, saldo del pedido, por cobrar del cliente (antes y con este pedido),
--   por pagar al proveedor (ahora y como queda con este pedido), utilidad estimada del pedido e inventario disponible por sabor.
-- Pedido a costo de un socio (tipo_venta socio_a_costo): utilidad 0 por definicion (ingreso = costo).
-- ADITIVA: funcion nueva de solo lectura (stable) en agente.*.

create function agente.resumen_pedido_registrado(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  ped operacion.pedido; v_cli text; v_ds operacion.pedido_ds; v_lineas jsonb; v_sub bigint; v_costo bigint; v_total bigint; v_piezas int; v_bodega boolean;
  v_prov bigint; v_prov_nom text; v_pos jsonb; v_deuda bigint := 0; v_por_cobrar bigint; v_saldo_pedido bigint; v_pendiente boolean; v_venc date; v_inv jsonb; v_costo_hoy bigint;
begin
  perform notificacion.exigir_sistema();
  select * into ped from operacion.pedido where id = p_pedido;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  select nombre_canonico into v_cli from catalogo.cliente where id = ped.cliente_id;
  select * into v_ds from operacion.pedido_ds where pedido_id = ped.id;
  v_bodega := operacion.origen_es_bodega(ped.origen);
  v_pendiente := ped.estado not in ('enviado', 'cancelado', 'anulado');

  select coalesce(jsonb_agg(jsonb_build_object('modelo', upper(m.nombre_canonico), 'sabor', upper(sa.nombre_canonico), 'piezas', l.piezas_pedidas, 'precio_cent', l.precio_cent,
                                               'importe_cent', l.piezas_pedidas * l.precio_cent,
                                               'costo_cent', coalesce(operacion.costo_ref_pedido(ped.origen, l.modelo_id, ped.fecha_neg), 0) * l.piezas_pedidas) order by m.nombre_canonico, sa.nombre_canonico, l.id), '[]'::jsonb),
         coalesce(sum(l.piezas_pedidas * l.precio_cent), 0)::bigint, coalesce(sum(l.piezas_pedidas), 0)::int,
         coalesce(sum(coalesce(operacion.costo_ref_pedido(ped.origen, l.modelo_id, ped.fecha_neg), 0) * l.piezas_pedidas), 0)::bigint
    into v_lineas, v_sub, v_piezas, v_costo
    from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = l.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
   where l.pedido_id = ped.id;
  v_total := v_sub + ped.envio_cent + ped.recargo_cent - ped.descuento_cent;
  -- Mientras el pedido no se envia el libro todavia no lo cobra: el saldo del pedido es su total menos lo ya aplicado.
  v_saldo_pedido := case when v_pendiente then v_total - operacion.pedido_aplicado(ped.id) else operacion.pedido_saldo(ped.id) end;
  v_por_cobrar := operacion.saldo_cliente(ped.cliente_id);
  -- Vencimiento: los dias corren desde el ENVIO; mientras no se envie es un estimado (fecha del pedido + plazo).
  v_venc := case when ped.plazo_dias is null then null else coalesce(ped.fecha_envio, ped.fecha_neg) + ped.plazo_dias end;

  if not v_bodega then
    select p.id, p.nombre into v_prov, v_prov_nom from catalogo.proveedor p where p.id = catalogo.proveedor_id(case when ped.origen = 'isaac_directo' then 'Isaac' else 'Karen' end);
    v_pos := operacion.posicion_proveedor(v_prov);
    v_deuda := greatest((v_pos ->> 'deuda_empresa_cent')::bigint, 0);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('modelo', x.modelo, 'sabor', x.sabor, 'disponible', x.disp, 'piezas_pedidas', x.piezas) order by x.modelo, x.sabor), '[]'::jsonb) into v_inv
    from (select upper(m.nombre_canonico) as modelo, upper(sa.nombre_canonico) as sabor, operacion.disponible_sku(l.sku_id) as disp, sum(l.piezas_pedidas)::int as piezas, l.sku_id
            from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = l.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
           where l.pedido_id = ped.id group by m.nombre_canonico, sa.nombre_canonico, l.sku_id) x;
  v_costo_hoy := case when v_ds.tipo_venta = 'socio_a_costo' then v_sub else v_costo end;

  return jsonb_build_object(
    'folio', ped.folio, 'estado', ped.estado, 'origen', ped.origen, 'tipo_venta', coalesce(v_ds.tipo_venta, 'cliente'),
    'cliente', v_cli, 'fecha', ped.fecha_neg,
    'lineas', v_lineas, 'piezas', v_piezas,
    'subtotal_cent', v_sub, 'envio_cent', ped.envio_cent, 'recargo_cent', ped.recargo_cent, 'descuento_cent', ped.descuento_cent, 'total_cent', v_total,
    'plazo_dias', ped.plazo_dias, 'de_contado', ped.plazo_dias = 0, 'vence', v_venc, 'vence_estimado', ped.fecha_envio is null and ped.plazo_dias is not null,
    'saldo_pedido_cent', v_saldo_pedido,
    -- Por cobrar del cliente: lo que ya cuenta el libro (pedidos enviados) y como queda sumando este pedido mientras no se envie.
    'por_cobrar_cliente_cent', v_por_cobrar,
    'por_cobrar_cliente_con_pedido_cent', v_por_cobrar + case when v_pendiente then v_saldo_pedido else 0 end,
    -- Por pagar al proveedor: lo que se le debe hoy y como queda con el costo estimado de este pedido (el libro lo registra al enviarse).
    'proveedor', v_prov_nom,
    'por_pagar_proveedor_cent', case when v_bodega then null else v_deuda end,
    'costo_pedido_estimado_cent', case when v_bodega then null else v_costo_hoy end,
    'por_pagar_proveedor_con_pedido_cent', case when v_bodega then null else v_deuda + case when v_pendiente then v_costo_hoy else 0 end end,
    'utilidad_estimada_cent', case when v_ds.tipo_venta = 'socio_a_costo' then 0 else v_total - v_costo end,
    'costo_estimado_cent', v_costo_hoy,
    'inventario', case when v_bodega then v_inv else null end,
    'avisos', (select coalesce(jsonb_agg(a.detalle order by a.id), '[]'::jsonb) from operacion.pedido_aviso a where a.pedido_id = ped.id));
end $$;

revoke all on function agente.resumen_pedido_registrado(bigint) from public, anon, authenticated;
grant execute on function agente.resumen_pedido_registrado(bigint) to servidor;
