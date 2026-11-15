-- Avisos del pedido: solo los que siguen vigentes HOY, agrupados por causa (pedido del dueño, 15-nov: "soluciona todos los avisos, que no salga nada de eso; que unicamente sigan si sigue el problema").
-- ADITIVA: solo funciones de lectura nuevas. No edita migraciones ya aplicadas, no toca lineas, notas, avisos ni decisiones (tablas inmutables).
-- Causa: pedido_aviso es la foto de lo que se aviso al capturar el pedido; la ficha y los conteos la leian completa, aunque el precio de lista ya se hubiera cargado.
-- Regla: la misma de notificacion.condicion para el aviso del pedido enviado (precio de lista vigente hoy, ultima nota, cobrado por completo), extendida a los avisos de minimo y existencia
-- (solo mientras el pedido no se ha enviado) y a pedidos no enviados. Un pedido anulado o cancelado no tiene avisos vigentes.

-- Base: una fila por aviso del pedido (o de todos los pedidos con p_pedido null) cuya causa sigue hoy.
-- codigo: el efectivo (un 'sin_precio_catalogo' con lista vigente y cobrado menor se muestra como 'precio_distinto_tabulador').
-- causa: texto generico de la causa (sin el nombre del modelo) para agrupar renglones iguales.
create function operacion.avisos_vigentes_base(p_pedido bigint default null)
returns table (aviso_id bigint, pedido_id bigint, linea_id bigint, codigo text, nt text, causa text, modelo text)
language sql stable security definer set search_path = ''
as $$
  with base as (
    select pa.id as aviso_id, pe.id as pedido_id, pa.pedido_linea_id as linea_id, pa.codigo as cod, pa.nt, pa.detalle, pe.estado, pe.origen, pe.fecha_neg,
           pe.excepcion_minimo_motivo, l.modelo_id, l.sku_id, l.piezas_pedidas, l.piezas_surtidas, l.precio_cent, l.precio_tabulador_cent, l.costo_unit_cent,
           (select m.nombre_canonico from catalogo.modelo m where m.id = l.modelo_id) as modelo,
           -- Precio cobrado hoy del renglon: el de la ultima nota (la correccion lo cambia) y, si no hay, el del renglon.
           coalesce((select (n.ajustes -> 'precios' ->> l.id::text)::bigint from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), l.precio_cent) as cobrado,
           notificacion.precio_lista_vigente(pe.cliente_id, l.modelo_id) as lista,
           -- Con la opcion vigente, el pedido enviado ya cobrado por completo cierra los avisos de precio (igual que el aviso del sistema).
           (pe.estado = 'enviado' and coalesce(catalogo.config_num('aviso_excepcion_cierra_al_cobrar') = 1, true) and operacion.pedido_saldo(pe.id) <= 0) as cobrado_completo
      from operacion.pedido_aviso pa
      join operacion.pedido pe on pe.id = pa.pedido_id
      left join operacion.pedido_linea l on l.id = pa.pedido_linea_id
     where (p_pedido is null or pe.id = p_pedido)
       and pe.estado in ('borrador', 'confirmado', 'enviado')
  ), evaluado as (
    select b.*,
      case b.cod
        when 'precio_distinto_tabulador' then
          not b.cobrado_completo and b.precio_tabulador_cent is not null and b.cobrado is distinct from b.precio_tabulador_cent
        when 'venta_bajo_costo' then
          not b.cobrado_completo and b.cobrado <= coalesce(b.costo_unit_cent, case when b.estado = 'enviado' then null else operacion.costo_ref_pedido(b.origen, b.modelo_id, b.fecha_neg) end, 0)
        when 'sin_precio_catalogo' then
          case when b.precio_tabulador_cent is null
                 -- Foto vacia: sigue si no hay precio de lista vigente o si lo cobrado esta por debajo de la lista.
                 then not b.cobrado_completo and b.cobrado < coalesce(b.lista, 9223372036854775807)
                 -- Foto con precio: era el aviso de modelo sin disponibilidad; sigue mientras el pedido no se envie y el modelo siga asi.
                 else b.estado <> 'enviado' and exists (select 1 from catalogo.modelo m where m.id = catalogo.modelo_vigente(b.modelo_id) and m.estado = 'sin_disponibilidad') end
        when 'existencia_insuficiente' then
          -- Solo antes de enviar; lo disponible descuenta lo reservado por otros pedidos (no el de este).
          b.estado <> 'enviado' and operacion.origen_es_bodega(b.origen)
            and (operacion.disponible_sku(b.sku_id) + coalesce((select sum(r.piezas) from operacion.reserva r where r.origen_tipo = 'pedido' and r.origen_id = b.pedido_id and r.sku_id = b.sku_id and r.estado = 'activa'), 0)::int)
                < greatest(b.piezas_pedidas - b.piezas_surtidas, 0)
        when 'minimo_piezas' then
          b.estado <> 'enviado' and b.excepcion_minimo_motivo is null
            and (select coalesce(sum(x.piezas_pedidas), 0) from operacion.pedido_linea x where x.pedido_id = b.pedido_id) < coalesce((catalogo.config_valor('minimo_piezas_pedido', b.fecha_neg))::text::int, 20)
        else false end as vigente
    from base b
  )
  select e.aviso_id, e.pedido_id, e.linea_id,
         -- Con lista vigente y lo cobrado por debajo, el motivo real es el precio bajo la lista.
         case when e.cod = 'sin_precio_catalogo' and e.precio_tabulador_cent is null and e.lista is not null then 'precio_distinto_tabulador' else e.cod end,
         e.nt,
         case when e.cod = 'sin_precio_catalogo' and e.precio_tabulador_cent is null and e.lista is not null then 'el precio cobrado es menor al precio de lista vigente'
              when e.cod = 'sin_precio_catalogo' and e.precio_tabulador_cent is null then 'el cliente no tiene precio de tabulador (precio capturado a mano)'
              when e.cod = 'sin_precio_catalogo' then 'el modelo esta sin disponibilidad ahora'
              when e.cod = 'precio_distinto_tabulador' then 'el precio capturado difiere del tabulador'
              when e.cod = 'venta_bajo_costo' then 'se vende a costo o por debajo del costo'
              when e.cod = 'existencia_insuficiente' then 'no alcanza la existencia disponible'
              else e.detalle end,
         e.modelo
    from evaluado e
   where e.vigente
$$;

-- Ficha del pedido: avisos vigentes agrupados por causa, con la cantidad de renglones y los modelos.
-- aceptados: cuantos de los avisos del grupo ya acepto una persona ("Enviar de todos modos"); decidido_por solo trae quienes aceptaron.
create function operacion.avisos_vigentes_pedido(p_pedido bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(q.g order by q.ord), '[]'::jsonb) from (
    select min(v.aviso_id) as ord,
           jsonb_build_object(
             'codigo', v.codigo, 'nt', v.nt, 'detalle', v.causa,
             'renglones', count(distinct v.linea_id),
             'modelos', coalesce((select jsonb_agg(m order by m) from (select distinct x as m from unnest(array_agg(v.modelo)) x where x is not null) z), '[]'::jsonb),
             'avisos', count(*), 'aceptados', count(d.aviso_id),
             'decidido_por', coalesce((select jsonb_agg(m order by m) from (select distinct x as m from unnest(array_agg(d.decidido_por_nombre)) x where x is not null) z), '[]'::jsonb),
             'decidido_at', max(d.decidido_at)) as g
      from operacion.avisos_vigentes_base(p_pedido) v
      left join operacion.pedido_aviso_decision d on d.aviso_id = v.aviso_id
     group by v.codigo, v.nt, v.causa) q
$$;

-- Conteo por pedido de los avisos vigentes agrupados (misma cuenta que muestra la ficha); solo trae pedidos con al menos uno.
create function operacion.pedidos_avisos_vigentes() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(q.pedido_id::text, q.n), '{}'::jsonb) from (
    select v.pedido_id, count(distinct (v.codigo, v.nt, v.causa)) as n from operacion.avisos_vigentes_base(null) v group by v.pedido_id) q
$$;

create function api.avisos_vigentes_pedido(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.avisos_vigentes_pedido(p_pedido);
end $$;

create function api.pedidos_avisos_vigentes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.pedidos_avisos_vigentes();
end $$;

revoke execute on function operacion.avisos_vigentes_base(bigint), operacion.avisos_vigentes_pedido(bigint), operacion.pedidos_avisos_vigentes() from public, anon, authenticated;
grant execute on function operacion.avisos_vigentes_base(bigint), operacion.avisos_vigentes_pedido(bigint), operacion.pedidos_avisos_vigentes() to servidor;
revoke execute on function api.avisos_vigentes_pedido(bigint), api.pedidos_avisos_vigentes() from public, anon;
grant execute on function api.avisos_vigentes_pedido(bigint), api.pedidos_avisos_vigentes() to authenticated;
