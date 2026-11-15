-- Pedidos: desglose Bodega / Dropshipping (decision del dueno, 14-nov: "divide los pedidos por Bodega / Dropshipping y que dentro de cada uno se vea cuantos son de Karen, cuantos de Isaac").
-- ADITIVA y de solo lectura: una funcion nueva (api.pedidos_desglose) y la lista de pedidos con una llave mas (tipo_venta). No toca eventos, asientos, notas ni saldos.
--
-- Una sola fuente para las cifras: operacion.v_ds_pedido_b (la misma de api.ds_pedidos), de modo que la web solo da formato y nunca suma dinero.
--   * pedidos        : todos los pedidos del grupo, en cualquier estado.
--   * enviados       : los que ya salieron (de ellos salen facturado, por cobrar y utilidad, igual que la lista).
--   * piezas         : piezas pedidas de los pedidos activos (sin anulados ni cancelados).
--   * facturado_cent : lo cobrado por pedido (venta de la nota) de los enviados.
--   * por_cobrar_cent: saldo positivo del cliente en los enviados (un saldo a favor no resta).
--   * utilidad_cent  : suma de la utilidad de la nota de los enviados que ya la tienen; null si ninguno. utilidad_provisional = alguna es provisional (aun sin costo real).
--   * con_avisos     : pedidos del grupo con al menos un aviso.
-- Niveles: 'total' (todos), 'surtido' (inventario_merida | dropshipping), 'proveedor' (bodega_omar, castores, karen, isaac; Karen junta directo y via Isaac) y
-- 'tipo' (solo dropshipping: cliente | socio_a_costo). La interfaz filtra la lista con estas mismas claves.

create or replace function operacion.pedidos_desglose_filas() returns table (
  nivel text, surtido text, clave text, pedidos int, enviados int, piezas int, facturado_cent bigint, por_cobrar_cent bigint, utilidad_cent bigint, utilidad_provisional boolean, con_avisos int)
language sql stable security definer set search_path = ''
as $$
  with b as (
    select v.origen_surtido as b_surtido,
           case v.origen when 'bodega_omar' then 'bodega_omar' when 'castores' then 'castores' when 'isaac_directo' then 'isaac' else 'karen' end as proveedor,
           case when v.origen_surtido = 'dropshipping' then coalesce(v.tipo_venta, 'cliente') end as tipo,
           v.estado, v.piezas_pedidas, v.venta_cent, v.saldo_cliente_cent, v.utilidad_cent, v.utilidad_provisional, v.avisos
    from operacion.v_ds_pedido_b v
  ), g as (
    select 'total'::text as nivel, null::text as surtido, 'todos'::text as clave, b.estado, b.piezas_pedidas, b.venta_cent, b.saldo_cliente_cent, b.utilidad_cent, b.utilidad_provisional, b.avisos from b
    union all select 'surtido', b.b_surtido, b.b_surtido, b.estado, b.piezas_pedidas, b.venta_cent, b.saldo_cliente_cent, b.utilidad_cent, b.utilidad_provisional, b.avisos from b
    union all select 'proveedor', b.b_surtido, b.proveedor, b.estado, b.piezas_pedidas, b.venta_cent, b.saldo_cliente_cent, b.utilidad_cent, b.utilidad_provisional, b.avisos from b
    union all select 'tipo', b.b_surtido, b.tipo, b.estado, b.piezas_pedidas, b.venta_cent, b.saldo_cliente_cent, b.utilidad_cent, b.utilidad_provisional, b.avisos from b where b.tipo is not null
  )
  select g.nivel, g.surtido, g.clave,
         count(*)::int,
         (count(*) filter (where g.estado = 'enviado'))::int,
         (coalesce(sum(g.piezas_pedidas) filter (where g.estado not in ('anulado', 'cancelado')), 0))::int,
         (coalesce(sum(g.venta_cent) filter (where g.estado = 'enviado'), 0))::bigint,
         (coalesce(sum(greatest(g.saldo_cliente_cent, 0)) filter (where g.estado = 'enviado'), 0))::bigint,
         (sum(g.utilidad_cent) filter (where g.estado = 'enviado' and g.utilidad_cent is not null))::bigint,
         coalesce(bool_or(g.utilidad_provisional) filter (where g.estado = 'enviado' and g.utilidad_cent is not null), false),
         (count(*) filter (where g.avisos > 0))::int
  from g
  group by g.nivel, g.surtido, g.clave
$$;
revoke execute on function operacion.pedidos_desglose_filas() from public, anon, authenticated;

create function api.pedidos_desglose() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('nivel', f.nivel, 'surtido', f.surtido, 'clave', f.clave, 'pedidos', f.pedidos, 'enviados', f.enviados, 'piezas', f.piezas,
           'facturado_cent', f.facturado_cent, 'por_cobrar_cent', f.por_cobrar_cent, 'utilidad_cent', f.utilidad_cent, 'utilidad_provisional', f.utilidad_provisional, 'con_avisos', f.con_avisos)
         order by case f.nivel when 'total' then 0 when 'surtido' then 1 when 'proveedor' then 2 else 3 end, f.surtido nulls first, f.clave)
         from operacion.pedidos_desglose_filas() f), '[]'::jsonb);
end $$;
revoke execute on function api.pedidos_desglose() from public, anon;
grant execute on function api.pedidos_desglose() to authenticated;

-- La lista de pedidos suma 'tipo_venta' (cliente | socio_a_costo; null fuera de dropshipping) para que la interfaz filtre por tipo de venta. Todo lo demas queda igual.
create or replace function api.pedidos_lista() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(x order by (x->>'id')::bigint desc) from (
      select jsonb_build_object(
        'id', pe.id, 'folio', pe.folio, 'fecha_neg', pe.fecha_neg, 'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'origen', pe.origen, 'estado', pe.estado,
        'tipo_venta', (select pd.tipo_venta from operacion.pedido_ds pd where pd.pedido_id = pe.id),
        'piezas_pedidas', (select coalesce(sum(piezas_pedidas), 0) from operacion.pedido_linea where pedido_id = pe.id),
        'piezas_surtidas', (select coalesce(sum(piezas_surtidas), 0) from operacion.pedido_linea where pedido_id = pe.id),
        'cobrado_cent', operacion.pedido_cobrado(pe.id), 'saldo_cent', case when pe.estado = 'enviado' then operacion.pedido_saldo(pe.id) end,
        'utilidad_cent', (select (n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1),
        'utilidad_provisional', (select (n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1),
        'avisos', (select count(*) from operacion.pedido_aviso where pedido_id = pe.id),
        'empacado', pe.empacado_at is not null, 'plazo_dias', pe.plazo_dias) as x
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = pe.duenio_id) q), '[]'::jsonb);
end $$;
