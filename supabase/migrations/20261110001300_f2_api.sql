-- F2 / 0013: lecturas `api.*` de las pantallas nuevas y envoltorios `api.*` de las funciones de escritura.
-- La web nunca toca tablas: lee y escribe por estas funciones (SECURITY DEFINER, rol socio). Las cifras salen de funciones de la base; la interfaz
-- solo formatea. Todo lo que dice `_cent` es centavos enteros.

-- Datos de un evento para "Explicar este numero" y las lineas de tiempo.
create function operacion.evento_info(p_evento bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('evento', e.folio, 'canal', e.canal, 'hora', e.hora, 'mensaje_origen', e.mensaje_origen,
                            'autor', (select coalesce(u.socio_nombre, u.rol) from seguridad.usuario u where u.id = e.actor_id))
  from operacion.evento e where e.id = p_evento
$$;

-- ---------------------------------------------------------------------------
-- Pedidos y notas
-- ---------------------------------------------------------------------------
create function api.pedidos_lista() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(x order by (x->>'id')::bigint desc) from (
      select jsonb_build_object(
        'id', pe.id, 'folio', pe.folio, 'fecha_neg', pe.fecha_neg, 'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'origen', pe.origen, 'estado', pe.estado,
        'piezas_pedidas', (select coalesce(sum(piezas_pedidas), 0) from operacion.pedido_linea where pedido_id = pe.id),
        'piezas_surtidas', (select coalesce(sum(piezas_surtidas), 0) from operacion.pedido_linea where pedido_id = pe.id),
        'cobrado_cent', operacion.pedido_cobrado(pe.id), 'saldo_cent', case when pe.estado = 'enviado' then operacion.pedido_saldo(pe.id) end,
        'utilidad_cent', (select (n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1),
        'utilidad_provisional', (select (n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1),
        'avisos', (select count(*) from operacion.pedido_aviso where pedido_id = pe.id),
        'empacado', pe.empacado_at is not null, 'plazo_dias', pe.plazo_dias) as x
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = pe.duenio_id) q), '[]'::jsonb);
end $$;

create function api.pedido_detalle(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pe operacion.pedido; v jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into pe from operacion.pedido where id = p_pedido;
  if not found then return null; end if;
  select jsonb_build_object(
    'id', pe.id, 'folio', pe.folio, 'fecha_neg', pe.fecha_neg, 'origen', pe.origen, 'estado', pe.estado, 'plazo_dias', pe.plazo_dias, 'paqueteria', pe.paqueteria, 'nota', pe.nota,
    'envio_cent', pe.envio_cent, 'descuento_cent', pe.descuento_cent, 'recargo_cent', pe.recargo_cent, 'empacado_at', pe.empacado_at, 'enviado_at', pe.enviado_at, 'fecha_envio', pe.fecha_envio, 'entregado_at', pe.entregado_at,
    'excepcion_minimo_motivo', pe.excepcion_minimo_motivo,
    'cliente', (select jsonb_build_object('id', c.id, 'nombre', c.nombre_canonico, 'duenio', s.nombre) from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.id = pe.cliente_id),
    'cobrado_cent', operacion.pedido_cobrado(pe.id), 'aplicado_cent', operacion.pedido_aplicado(pe.id), 'saldo_cent', case when pe.estado = 'enviado' then operacion.pedido_saldo(pe.id) end,
    'estimado_cent', (select coalesce(sum(l.piezas_pedidas * l.precio_cent), 0) from operacion.pedido_linea l where l.pedido_id = pe.id) + pe.envio_cent + pe.recargo_cent - pe.descuento_cent,
    'saldo_favor_cliente_cent', operacion.saldo_favor_cliente(pe.cliente_id),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'sku_id', l.sku_id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas_pedidas', l.piezas_pedidas, 'piezas_surtidas', l.piezas_surtidas,
        'precio_cent', l.precio_cent, 'precio_tabulador_cent', l.precio_tabulador_cent, 'motivo_precio', l.motivo_precio, 'costo_unit_cent', l.costo_unit_cent, 'renta_cent', l.renta_cent,
        'disponible', operacion.disponible_sku(l.sku_id), 'existencia', coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = l.sku_id and u.ubicacion = 'bodega_omar'), 0)) order by l.id)
      from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = pe.id), '[]'::jsonb),
    'cargos', coalesce((select jsonb_agg(jsonb_build_object('concepto', concepto, 'monto_cent', monto_cent) order by id) from operacion.pedido_cargo where pedido_id = pe.id), '[]'::jsonb),
    'ajustes', coalesce((select jsonb_agg(jsonb_build_object('tipo', a.tipo, 'piezas', a.piezas, 'sabor', sa.nombre_canonico, 'modelo', m.nombre_canonico) order by a.id)
      from operacion.pedido_ajuste a join catalogo.sku k on k.id = a.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where a.pedido_id = pe.id), '[]'::jsonb),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'nt', a.nt, 'detalle', a.detalle, 'decidido_por', d.decidido_por_nombre, 'decidido_at', d.decidido_at) order by a.id)
      from operacion.pedido_aviso a left join operacion.pedido_aviso_decision d on d.aviso_id = a.id where a.pedido_id = pe.id), '[]'::jsonb),
    'guias', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'paqueteria', g.paqueteria, 'numero', g.numero, 'costo_cent', g.costo_cent, 'fecha_neg', g.fecha_neg) order by g.id) from operacion.guia g where g.pedido_id = pe.id), '[]'::jsonb),
    'notas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'folio_documento', n.folio_documento, 'tipo', n.tipo, 'motivo_correccion', n.motivo_correccion, 'total_cent', n.total_cent, 'emitida_at', n.emitida_at,
        'corregida_por', (select c2.folio_documento from operacion.nota c2 where c2.corrige_nota_id = n.id), 'vigente', n.id = (select max(x.id) from operacion.nota x where x.pedido_id = pe.id),
        'texto_whatsapp', n.texto_whatsapp, 'cliente', n.snapshot_cliente, 'interno', n.snapshot_interno, 'ajustes', n.ajustes,
        'pdf_cliente', exists (select 1 from operacion.nota_documento d where d.nota_id = n.id and d.variante = 'cliente_pdf'),
        'pdf_interna', exists (select 1 from operacion.nota_documento d where d.nota_id = n.id and d.variante = 'interna_pdf')) order by n.id)
      from operacion.nota n where n.pedido_id = pe.id), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('folio', p.folio, 'fecha_neg', p.fecha_neg, 'cuenta', cd.nombre, 'monto_cent', sum_ap.monto) order by p.id)
      from (select pago_id, sum(monto_cent) as monto from operacion.pago_aplicacion where pedido_id = pe.id group by pago_id having sum(monto_cent) <> 0) sum_ap
      join operacion.pago p on p.id = sum_ap.pago_id join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id), '[]'::jsonb),
    'linea_tiempo', coalesce((select jsonb_agg(operacion.evento_info(e.id) || jsonb_build_object('tipo', e.tipo) order by e.id)
      from operacion.evento e where e.id in (pe.evento_id, pe.evento_envio_id) or e.payload->>'pedido' = pe.folio), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Catalogo de la captura de pedido: cada sabor con existencia, disponible, precio del tabulador del cliente y costo de referencia.
create function api.pedido_catalogo(p_cliente_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'envio_default_cent', (catalogo.config_valor('envio_default_cent'))::text::bigint,
    'minimo_piezas', (catalogo.config_valor('minimo_piezas_pedido'))::text::int,
    'destinos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'etiqueta', d.etiqueta, 'zona', d.zona) order by d.etiqueta) from catalogo.cliente_destino d where d.cliente_id = p_cliente_id), '[]'::jsonb),
    'skus', coalesce((select jsonb_agg(jsonb_build_object(
        'sku_id', k.id, 'modelo_id', m.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'estado', m.estado,
        'existencia', coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = k.id and u.ubicacion = 'bodega_omar'), 0), 'disponible', operacion.disponible_sku(k.id),
        'precio_cent', catalogo.precio_vigente(p_cliente_id, m.id), 'costo_ref_cent', operacion.costo_ref_pedido('bodega_omar', m.id, negocio.hoy())) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
      from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id where k.activo), '[]'::jsonb));
end $$;

-- Fuente de un documento para generarlo (PDF) o reabrirlo: snapshots guardados + textos de configuracion.
create function api.nota_fuente(p_nota bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare n operacion.nota;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into n from operacion.nota where id = p_nota;
  if not found then return null; end if;
  return jsonb_build_object('id', n.id, 'pedido_id', n.pedido_id, 'folio_documento', n.folio_documento, 'tipo', n.tipo, 'emitida_at', n.emitida_at, 'motivo_correccion', n.motivo_correccion,
    'corrige', (select c.folio_documento from operacion.nota c where c.id = n.corrige_nota_id), 'cliente', n.snapshot_cliente, 'interno', n.snapshot_interno,
    'marca_texto', catalogo.config_valor('nota_marca_texto'), 'datos_pago_texto', catalogo.config_valor('nota_datos_pago_texto'));
end $$;

create function api.nota_documento(p_nota bigint, p_variante text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare d operacion.nota_documento;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into d from operacion.nota_documento where nota_id = p_nota and variante = p_variante;
  if not found then return null; end if;
  return jsonb_build_object('sha256', d.sha256, 'base64', encode(d.contenido, 'base64'), 'creado_at', d.creado_at);
end $$;

-- ---------------------------------------------------------------------------
-- Paquetes
-- ---------------------------------------------------------------------------
create function api.paquetes_por_hacer() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pe.id, 'folio', pe.folio, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'origen', pe.origen, 'paqueteria', pe.paqueteria, 'envio_cent', pe.envio_cent,
        'empacado', pe.empacado_at is not null, 'estado_paquete', case when pe.empacado_at is null then 'por_empacar' else 'empacado' end,
        'horas', (extract(epoch from (now() - pe.creado_at)) / 3600)::int, 'creado_at', pe.creado_at,
        'sin_guia', true,
        'piezas', (select sum(piezas_pedidas) from operacion.pedido_linea where pedido_id = pe.id),
        'renglones', (select jsonb_agg(jsonb_build_object('linea_id', l.id, 'sku_id', l.sku_id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas_pedidas,
                                                            'disponible', operacion.disponible_sku(l.sku_id), 'existencia', coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = l.sku_id and u.ubicacion = 'bodega_omar'), 0)) order by m.nombre_canonico, sa.nombre_canonico)
                      from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = pe.id)) order by pe.id)
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = pe.duenio_id
      where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen)), '[]'::jsonb),
    -- Lista de surtido: piezas por modelo y sabor contra la existencia (aviso si falta un sabor antes de empacar).
    'surtido', coalesce((select jsonb_agg(jsonb_build_object('sku_id', q.sku_id, 'modelo', q.modelo, 'sabor', q.sabor, 'piezas', q.piezas, 'existencia', q.existencia, 'falta', greatest(q.piezas - q.existencia, 0)) order by q.modelo, q.sabor)
      from (select l.sku_id, m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_pedidas)::int as piezas,
                   coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = l.sku_id and u.ubicacion = 'bodega_omar'), 0) as existencia
            from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
            where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen) group by l.sku_id, m.nombre_canonico, sa.nombre_canonico) q), '[]'::jsonb),
    'enviados_recientes', coalesce((select jsonb_agg(jsonb_build_object('id', pe.id, 'folio', pe.folio, 'cliente', c.nombre_canonico, 'fecha_envio', pe.fecha_envio, 'entregado', pe.entregado_at is not null,
        'guias', (select jsonb_agg(jsonb_build_object('paqueteria', g.paqueteria, 'numero', g.numero, 'costo_cent', g.costo_cent)) from operacion.guia g where g.pedido_id = pe.id)) order by pe.id desc)
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id where pe.estado = 'enviado' and pe.fecha_envio >= negocio.hoy() - 14), '[]'::jsonb));
end $$;

create function api.paquetes_en_transito() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', co.id, 'folio', co.folio, 'proveedor', p.nombre, 'estado', co.estado, 'fecha_neg', co.fecha_neg, 'enviada_fecha', co.enviada_fecha, 'llegada_estimada', co.llegada_estimada,
      'dias_en_camino', case when co.enviada_fecha is null then null else negocio.hoy() - co.enviada_fecha end,
      'total_cent', co.total_cent, 'piezas_pedidas', (select sum(piezas_pagadas) from operacion.compra_linea where compra_id = co.id),
      'guias', coalesce((select jsonb_agg(jsonb_build_object('paqueteria', g.paqueteria, 'numero', g.numero) order by g.id) from operacion.guia g where g.compra_id = co.id), '[]'::jsonb),
      'renglones', (select jsonb_agg(jsonb_build_object('linea_id', l.id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'pagadas', l.piezas_pagadas, 'facturadas', l.piezas_facturadas, 'costo_unit_cent', l.costo_unit_cent) order by l.id)
                    from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.compra_id = co.id))
      order by co.id desc)
    from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id where co.estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida') and co.destino = 'bodega'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Compras y cuenta con el proveedor
-- ---------------------------------------------------------------------------
create function api.compras_lista(p_proveedor text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov bigint := case when p_proveedor is null then null else catalogo.proveedor_id(p_proveedor) end;
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', co.id, 'folio', co.folio, 'proveedor', p.nombre, 'fecha_neg', co.fecha_neg, 'estado', co.estado, 'total_cent', co.total_cent, 'ambito', co.ambito,
      'pagadas', (select sum(piezas_pagadas) from operacion.compra_linea where compra_id = co.id), 'facturadas', (select sum(piezas_facturadas) from operacion.compra_linea where compra_id = co.id),
      'recibidas', (select sum(piezas_recibidas) from operacion.compra_linea where compra_id = co.id),
      'diferencias_abiertas', (select count(*) from operacion.compra_diferencia d where d.compra_id = co.id and not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = d.id and x.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id)))) order by co.id desc)
    from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id where v_prov is null or co.proveedor_id = v_prov), '[]'::jsonb);
end $$;

create function api.compra_detalle(p_compra bigint) returns jsonb
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
        'recibidas', l.piezas_recibidas, 'costo_unit_cent', l.costo_unit_cent, 'costo_lista_cent', l.costo_lista_cent, 'motivo_costo', l.motivo_costo,
        'lote', (select jsonb_build_object('costo_puesto_cent', lo.costo_puesto_cent, 'valor_entrada_cent', lo.valor_entrada_cent, 'guia_cent', lo.guia_prorrateada_cent, 'seguro_cent', lo.seguro_prorrateado_cent) from operacion.lote lo where lo.compra_linea_id = l.id)) order by l.id)
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

create function api.proveedor_cuenta(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov catalogo.proveedor; v_saldo bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into v_prov from catalogo.proveedor where id = catalogo.proveedor_id(p_proveedor);
  if not found then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_saldo := operacion.saldo_proveedor(v_prov.id);
  return jsonb_build_object('id', v_prov.id, 'proveedor', v_prov.nombre, 'modalidad', v_prov.modalidad, 'saldo_cent', v_saldo,
    'etiqueta', case when v_saldo > 0 then 'A favor' when v_saldo < 0 then 'Se debe' else 'Saldo cero' end,
    'movimientos', coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
        select jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'monto_cent', m.monto_cent, 'saldo_corrido_cent', sum(m.monto_cent) over (order by m.id),
          'compra', (select folio from operacion.compra where id = m.compra_id), 'pago', (select folio from operacion.pago where id = m.pago_id), 'cliente', (select nombre_canonico from catalogo.cliente where id = m.cliente_id),
          'cuenta_origen', (select nombre from operacion.cuenta_dinero where id = m.cuenta_origen_id), 'nota', m.nota) || operacion.evento_info(m.evento_id) as x
        from operacion.cuenta_proveedor_mov m where m.proveedor_id = v_prov.id) q), '[]'::jsonb),
    'puente_cent', operacion.saldo_puente());
end $$;

create function api.compra_catalogo(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov bigint := catalogo.proveedor_id(p_proveedor);
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('modalidad', (select modalidad from catalogo.proveedor where id = v_prov), 'saldo_cent', operacion.saldo_proveedor(v_prov),
    'seguro_reenvio_cent', (catalogo.config_valor('seguro_reenvio_cent'))::text::bigint,
    'skus', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'modelo', m.nombre_canonico, 'marca', ma.nombre, 'sabor', sa.nombre_canonico, 'costo_cent', catalogo.costo_vigente(v_prov, m.id)) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
      from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id where k.activo), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Cuentas por cobrar, pagos y dinero de la sociedad en poder de un socio
-- ---------------------------------------------------------------------------
create function api.cuentas_por_cobrar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_hoy date := negocio.hoy();
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(jsonb_agg(x order by (x->>'dias')::int desc), '[]'::jsonb) into v_filas from (
    select jsonb_build_object(
      'pedido_id', pe.id, 'folio', pe.folio, 'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'fecha_envio', pe.fecha_envio, 'plazo_dias', pe.plazo_dias,
      'vence', case when pe.plazo_dias is null then null else pe.fecha_envio + pe.plazo_dias end, 'original_cent', operacion.pedido_cobrado(pe.id), 'abonos_cent', operacion.pedido_aplicado(pe.id),
      'saldo_cent', operacion.pedido_saldo(pe.id), 'dias', v_hoy - pe.fecha_envio,
      'dias_atraso', case when pe.plazo_dias is null then null else greatest(v_hoy - (pe.fecha_envio + pe.plazo_dias), 0) end,
      'estado', case when operacion.pedido_saldo(pe.id) < 0 then 'saldo_a_favor' when pe.plazo_dias is null then 'sin_plazo' when v_hoy > pe.fecha_envio + pe.plazo_dias then 'vencido'
                     when v_hoy >= pe.fecha_envio + pe.plazo_dias - 2 then 'por_vencer' else 'al_corriente' end,
      'cubeta', case when v_hoy - pe.fecha_envio <= 7 then '0_7' when v_hoy - pe.fecha_envio <= 14 then '8_14' when v_hoy - pe.fecha_envio <= 30 then '15_30' else 'mas_30' end) as x
    from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id
    where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) <> 0) q;
  return jsonb_build_object(
    'hoy', v_hoy, 'filas', v_filas,
    'total_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) from jsonb_array_elements(v_filas) f),
    'vencido_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) from jsonb_array_elements(v_filas) f),
    'antiguedad_cent', (select jsonb_object_agg(k, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_filas) f where f->>'cubeta' = k and (f->>'saldo_cent')::bigint > 0), 0)) from unnest(array['0_7', '8_14', '15_30', 'mas_30']) k),
    'por_duenio_cent', (select coalesce(jsonb_object_agg(d, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_filas) f where f->>'duenio' = d and (f->>'saldo_cent')::bigint > 0), 0)), '{}'::jsonb) from unnest(array['Angelo', 'Javier']) d),
    'saldos_a_favor', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'monto_cent', operacion.saldo_favor_cliente(c.id)) order by c.nombre_canonico)
      from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where operacion.saldo_favor_cliente(c.id) > 0), '[]'::jsonb),
    'pagos_sin_identificar', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha_neg', p.fecha_neg, 'monto_cent', p.monto_cent, 'cuenta', cd.nombre) order by p.id)
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id
      where p.identificacion = 'sin_identificar' and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id) and not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)), '[]'::jsonb),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'deuda_cent', operacion.saldo_socio(s.id), 'fondos_cent', operacion.saldo_socio(s.id, 'fondos'), 'diferencia_cent', operacion.saldo_socio(s.id, 'diferencia')) order by s.nombre) from catalogo.socio s), '[]'::jsonb));
end $$;

create function api.cxc_cliente(p_cliente bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'cliente', (select jsonb_build_object('id', c.id, 'nombre', c.nombre_canonico, 'duenio', s.nombre) from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.id = p_cliente),
    'saldo_cent', operacion.saldo_cliente(p_cliente), 'saldo_favor_cent', operacion.saldo_favor_cliente(p_cliente),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', pe.id, 'folio', pe.folio, 'estado', pe.estado, 'fecha_envio', pe.fecha_envio, 'cobrado_cent', operacion.pedido_cobrado(pe.id), 'saldo_cent', operacion.pedido_saldo(pe.id),
        'notas', (select jsonb_agg(n.folio_documento order by n.id) from operacion.nota n where n.pedido_id = pe.id)) order by pe.id desc) from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado in ('enviado', 'anulado')), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha_neg', p.fecha_neg, 'monto_cent', p.monto_cent, 'cuenta', cd.nombre, 'disponible_cent', operacion.pago_disponible(p.id),
        'anulado', exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)) || operacion.evento_info(p.evento_id) order by p.id desc)
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id where operacion.pago_cliente(p.id) = p_cliente), '[]'::jsonb));
end $$;

create function api.pagos_contexto() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('cuentas', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'titular_tipo', titular_tipo) order by id) from operacion.cuenta_dinero), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre_canonico, 'duenio', s.nombre, 'saldo_cent', operacion.saldo_cliente(c.id)) order by c.nombre_canonico)
      from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.activo), '[]'::jsonb));
end $$;

create function api.estado_socio(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select id into v_id from catalogo.socio where nombre = p_socio;
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  return jsonb_build_object('socio', p_socio, 'deuda_cent', operacion.saldo_socio(v_id), 'fondos_cent', operacion.saldo_socio(v_id, 'fondos'), 'diferencia_cent', operacion.saldo_socio(v_id, 'diferencia'),
    'aportaciones_cent', (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio where socio_id = v_id and clasificacion = 'capital'),
    'reembolsable_cent', (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio where socio_id = v_id and clasificacion = 'reembolsable'),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'aplica_a', m.aplica_a, 'monto_cent', m.monto_cent, 'saldo_corrido_cent', m.corrido, 'nota', m.nota) order by m.id desc)
      from (select x.*, sum(x.monto_cent) over (order by x.id) as corrido from operacion.cuenta_socio_mov x where x.socio_id = v_id) m), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Avisos (nucleo; en F2 se muestran solo en el software)
-- ---------------------------------------------------------------------------
create function api.avisos_lista(p_estado text default 'abierta') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio(); v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('sin_leer', (select count(*) from operacion.aviso a where a.estado = 'abierta' and not (a.solo_otro and a.actor_socio_id = v_yo) and not exists (select 1 from operacion.aviso_lectura l where l.aviso_id = a.id and l.usuario_id = v_uid)),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nt', a.nt, 'codigo', a.codigo, 'severidad', a.severidad, 'titulo', a.titulo, 'entidad_tipo', a.entidad_tipo, 'entidad_id', a.entidad_id, 'payload', a.payload,
        'duenio', (select nombre from catalogo.socio where id = a.duenio_socio_id), 'actor', (select nombre from catalogo.socio where id = a.actor_socio_id), 'estado', a.estado, 'conteo', a.conteo,
        'creado_at', a.creado_at, 'canales_previstos', a.canales_previstos, 'leido', exists (select 1 from operacion.aviso_lectura l where l.aviso_id = a.id and l.usuario_id = v_uid)) order by a.id desc)
      from operacion.aviso a where (p_estado is null or a.estado = p_estado) and not (a.solo_otro and a.actor_socio_id = v_yo)), '[]'::jsonb));
end $$;

create function operacion.aviso_marcar_leido(p_clave_idem text, p_aviso bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_uid is null then raise exception 'sin sesion' using errcode = '42501'; end if;
  insert into operacion.aviso_lectura (aviso_id, usuario_id) values (p_aviso, v_uid) on conflict do nothing;
  return jsonb_build_object('aviso_id', p_aviso, 'leido', true);
end $$;

-- ---------------------------------------------------------------------------
-- "Explicar este numero": cifras de dinero (se agregan a las de existencia y margen de F1)
-- ---------------------------------------------------------------------------
create or replace function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare partes text[] := string_to_array(p_cifra, ':'); v_id bigint; v_c bigint; v_m bigint; v_via1 bigint; v_via2 bigint; v_movs jsonb; v_precio bigint; v_rengs jsonb; nt operacion.nota;
begin
  perform seguridad.exigir_rol(array['socio']);
  if partes[1] = 'existencia' and partes[2] = 'modelo' then
    v_id := partes[3]::bigint;
    select coalesce(piezas, 0) into v_via1 from operacion.existencia_modelo where modelo_id = v_id;
    select coalesce(sum(cantidad), 0) into v_via2 from operacion.movimiento_inventario where modelo_id = v_id;
    select coalesce(jsonb_agg(jsonb_build_object('hora', mi.hora, 'fecha_neg', mi.fecha_neg, 'tipo', mi.tipo, 'sabor', sa.nombre_canonico, 'ubicacion', ub.nombre, 'cantidad', mi.cantidad,
                                                 'saldo', mi.piezas_modelo_despues, 'valor_cent', mi.valor_cent, 'evento', e.folio, 'canal', e.canal, 'mensaje_origen', e.mensaje_origen,
                                                 'autor', (select coalesce(u.socio_nombre, u.rol) from seguridad.usuario u where u.id = e.actor_id), 'reversa_de', mi.reversa_de) order by mi.id desc), '[]'::jsonb)
      into v_movs
      from operacion.movimiento_inventario mi join operacion.evento e on e.id = mi.evento_id join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.ubicacion ub on ub.codigo = mi.ubicacion
      where mi.modelo_id = v_id;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Existencia del modelo', 'valor', coalesce(v_via1, 0), 'unidad', 'pz',
      'comprobacion', jsonb_build_object('via1', 'Existencia registrada del modelo', 'via1_valor', coalesce(v_via1, 0), 'via2', 'Suma de entradas y salidas del libro', 'via2_valor', v_via2, 'cuadra', coalesce(v_via1, 0) = v_via2),
      'movimientos', v_movs);
  elsif partes[1] = 'margen' then
    v_c := partes[2]::bigint; v_m := partes[3]::bigint;
    select precio_cent into v_precio from catalogo.tabulador_precio where cliente_id = v_c and modelo_id = v_m and vigente_hasta is null;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Margen por pieza', 'valor', null, 'unidad', 'mxn',
      'precio_cent', v_precio,
      'costos', coalesce((select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'costo_cent', k.costo_cent, 'desde', k.vigente_desde, 'supuesto', k.supuesto, 'fuente', k.fuente,
                                'margen_cent', v_precio - k.costo_cent, 'comprobacion_cent', (v_precio - k.costo_cent) + k.costo_cent, 'cuadra', ((v_precio - k.costo_cent) + k.costo_cent) = v_precio) order by p.nombre)
                          from catalogo.costo_proveedor k join catalogo.proveedor p on p.id = k.proveedor_id where k.modelo_id = v_m and k.vigente_hasta is null), '[]'::jsonb),
      'movimientos', '[]'::jsonb);
  elsif partes[1] = 'pedido' and partes[2] = 'total' then
    -- Total del pedido = renglones de la nota vigente + envio + recargo - descuento.
    select * into nt from operacion.nota where pedido_id = partes[3]::bigint order by id desc limit 1;
    if not found then raise exception 'el pedido aun no tiene nota' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('concepto', l->>'modelo' || ' ' || (l->>'piezas') || ' pz x precio', 'monto_cent', (l->>'total_cent')::bigint) order by l->>'modelo'), '[]'::jsonb) into v_rengs from jsonb_array_elements(nt.snapshot_cliente->'lineas_texto') l;
    v_rengs := v_rengs
      || case when (nt.snapshot_cliente->>'envio_cent')::bigint > 0 then jsonb_build_array(jsonb_build_object('concepto', 'Envío cobrado', 'monto_cent', (nt.snapshot_cliente->>'envio_cent')::bigint)) else '[]'::jsonb end
      || case when (nt.snapshot_cliente->>'recargo_cent')::bigint > 0 then jsonb_build_array(jsonb_build_object('concepto', 'Recargo', 'monto_cent', (nt.snapshot_cliente->>'recargo_cent')::bigint)) else '[]'::jsonb end
      || case when (nt.snapshot_cliente->>'descuento_cent')::bigint > 0 then jsonb_build_array(jsonb_build_object('concepto', 'Descuento', 'monto_cent', -(nt.snapshot_cliente->>'descuento_cent')::bigint)) else '[]'::jsonb end;
    select coalesce(sum((r->>'monto_cent')::bigint), 0) into v_via1 from jsonb_array_elements(v_rengs) r;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Total a saldar ' || nt.folio_documento, 'valor', nt.total_cent, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma de renglones, envío y ajustes', 'via1_valor', v_via1, 'via2', 'Total de la nota guardada', 'via2_valor', nt.total_cent, 'cuadra', v_via1 = nt.total_cent),
      'renglones', (select coalesce(jsonb_agg(r || jsonb_build_object('hora', nt.emitida_at, 'fecha_neg', negocio.fecha_neg(nt.emitida_at)) || operacion.evento_info(nt.evento_id) - 'hora'), '[]'::jsonb) from jsonb_array_elements(v_rengs) r), 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'pedido' and partes[2] = 'saldo' then
    v_id := partes[3]::bigint;
    v_via1 := operacion.pedido_saldo(v_id);
    select coalesce(jsonb_agg(x order by (x->>'orden')::bigint), '[]'::jsonb) into v_rengs from (
      select jsonb_build_object('orden', n.id, 'concepto', 'Cobrado: ' || n.folio_documento, 'monto_cent', n.total_cent, 'hora', n.emitida_at, 'fecha_neg', negocio.fecha_neg(n.emitida_at)) || operacion.evento_info(n.evento_id) as x
        from operacion.nota n where n.pedido_id = v_id and n.id = (select max(id) from operacion.nota where pedido_id = v_id) and exists (select 1 from operacion.pedido where id = v_id and estado = 'enviado')
      union all
      select jsonb_build_object('orden', 1000000 + a.id, 'concepto', 'Abono ' || p.folio || ' a ' || cd.nombre, 'monto_cent', -a.monto_cent, 'hora', p.hora, 'fecha_neg', p.fecha_neg) || operacion.evento_info(a.evento_id)
        from operacion.pago_aplicacion a join operacion.pago p on p.id = a.pago_id join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id where a.pedido_id = v_id) q;
    select coalesce(sum((r->>'monto_cent')::bigint), 0) into v_via2 from jsonb_array_elements(v_rengs) r;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Por cobrar del pedido', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Función de saldo del pedido', 'via1_valor', v_via1, 'via2', 'Cobrado menos abonos aplicados', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'proveedor' and partes[2] = 'saldo' then
    v_id := partes[3]::bigint;
    v_via1 := operacion.saldo_proveedor(v_id);
    select coalesce(jsonb_agg(jsonb_build_object('concepto', replace(m.concepto, '_', ' ') || coalesce(': ' || m.nota, ''), 'monto_cent', m.monto_cent, 'saldo_cent', m.corrido, 'hora', m.hora, 'fecha_neg', m.fecha_neg) || operacion.evento_info(m.evento_id) order by m.id desc), '[]'::jsonb), coalesce(sum(m.monto_cent), 0)
      into v_rengs, v_via2 from (select x.*, sum(x.monto_cent) over (order by x.id) as corrido from operacion.cuenta_proveedor_mov x where x.proveedor_id = v_id) m;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Cuenta con el proveedor (+ a favor, − se debe)', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Función de saldo del proveedor', 'via1_valor', v_via1, 'via2', 'Suma de los movimientos de la cuenta', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'socio' and partes[2] in ('deuda', 'fondos', 'diferencia') then
    select id into v_id from catalogo.socio where nombre = partes[3];
    if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
    v_via1 := case partes[2] when 'deuda' then operacion.saldo_socio(v_id) else operacion.saldo_socio(v_id, partes[2]) end;
    select coalesce(jsonb_agg(jsonb_build_object('concepto', replace(m.concepto, '_', ' ') || coalesce(': ' || m.nota, ''), 'monto_cent', m.monto_cent, 'saldo_cent', m.corrido, 'hora', m.hora, 'fecha_neg', m.fecha_neg) || operacion.evento_info(m.evento_id) order by m.id desc), '[]'::jsonb), coalesce(sum(m.monto_cent), 0)
      into v_rengs, v_via2 from (select x.*, sum(x.monto_cent) over (order by x.id) as corrido from operacion.cuenta_socio_mov x where x.socio_id = v_id and (partes[2] = 'deuda' or x.aplica_a = partes[2])) m;
    return jsonb_build_object('cifra', p_cifra, 'titulo', case partes[2] when 'deuda' then 'Lo que ' || partes[3] || ' debe a la sociedad' when 'fondos' then 'Fondos de la sociedad en poder de ' || partes[3] else 'Faltantes asignados a ' || partes[3] end,
      'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Función de saldo del socio', 'via1_valor', v_via1, 'via2', 'Suma de los movimientos', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'cxc' and partes[2] = 'total' then
    select coalesce(jsonb_agg(jsonb_build_object('concepto', pe.folio || ' · ' || c.nombre_canonico, 'monto_cent', operacion.pedido_saldo(pe.id), 'hora', pe.enviado_at, 'fecha_neg', pe.fecha_envio) || operacion.evento_info(pe.evento_envio_id) order by pe.id desc), '[]'::jsonb),
           coalesce(sum(operacion.pedido_saldo(pe.id)), 0)
      into v_rengs, v_via2 from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0;
    select coalesce(sum(greatest(operacion.saldo_cliente(c.id), 0)), 0) into v_via1 from catalogo.cliente c;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Total por cobrar', 'valor', v_via2, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma de saldos por pedido', 'via1_valor', v_via2, 'via2', 'Suma de saldos por cliente', 'via2_valor', v_via1, 'cuadra', v_via1 >= 0),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  raise exception 'cifra desconocida' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* de las funciones de escritura (rol socio). Mismos parametros que la funcion de operacion.
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text; v_args text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array[
      'crear_compra', 'confirmar_compra', 'marcar_compra_enviada', 'registrar_guia_compra', 'marcar_llego_merida', 'recibir_compra', 'asignar_diferencia', 'cerrar_compra', 'anular_compra',
      'crear_pedido', 'confirmar_pedido', 'cancelar_pedido', 'marcar_empacado', 'enviar_pedido', 'anular_pedido', 'emitir_correccion', 'acordar_plazo', 'marcar_entregado', 'fijar_costo_guia', 'guardar_documento_nota',
      'registrar_pago', 'aplicar_pago', 'identificar_pago', 'anular_pago', 'pago_proveedor_de_socio', 'registrar_entrega_socio',
      'registrar_toma_omar', 'resolver_toma_omar', 'cerrar_liquidacion_omar', 'registrar_pago_omar', 'aviso_marcar_leido'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    v_args := f.args;
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, v_args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;

grant execute on function api.pedidos_lista(), api.pedido_detalle(bigint), api.pedido_catalogo(bigint), api.nota_fuente(bigint), api.nota_documento(bigint, text), api.paquetes_por_hacer(), api.paquetes_en_transito(),
  api.compras_lista(text), api.compra_detalle(bigint), api.proveedor_cuenta(text), api.compra_catalogo(text), api.cuentas_por_cobrar(), api.cxc_cliente(bigint), api.pagos_contexto(), api.estado_socio(text),
  api.avisos_lista(text), api.explicar_cifra(text) to authenticated;
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
