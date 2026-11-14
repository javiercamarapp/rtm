-- Pagina unica "Lo que hay en Karen": tablero con modelos, sabores, ventas propias, cobertura y recomendaciones de compra. SOLO LECTURA y ADITIVA.
--  * Ninguna cifra es dinero: piezas, dias y conteos. Las cuentas (ventas, cobertura, umbrales) se hacen aqui; la web solo las muestra.
--  * No lee ni guarda precios ni costos del proveedor; no cambia el esquema ni los interruptores (la lectura sigue apagada hasta que el dueno lo decida).
--  * Umbrales de recomendacion: vende al menos 6 piezas en 60 dias y le quedan 21 dias o menos de cobertura (o cero existencia).

create function proveedores.tablero_karen() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy();
  v_modelos jsonb;
  v_recom jsonb;
begin
  perform seguridad.exigir_socio_o_sistema();

  with vta as (
    select s.sku_id, sum(s.piezas)::int as p60, coalesce(sum(s.piezas) filter (where p.fecha_envio >= v_hoy - 30), 0)::int as p30
      from operacion.pedido_surtido s
      join operacion.pedido_linea l on l.id = s.pedido_linea_id
      join operacion.pedido p on p.id = l.pedido_id
     where p.estado = 'enviado' and p.fecha_envio >= v_hoy - 60
     group by s.sku_id),
  exs as (select u.sku_id, sum(u.piezas)::int as piezas from operacion.existencia_sku_ubicacion u group by u.sku_id),
  por_modelo as (select k.modelo_id, sum(v.p60)::int as p60, sum(v.p30)::int as p30 from catalogo.sku k join vta v on v.sku_id = k.id group by k.modelo_id),
  base as (
    select m.*, mo.nombre_canonico as canonico_nombre, coalesce(pm.p60, 0) as p60, coalesce(pm.p30, 0) as p30, coalesce(em.piezas, 0) as existencia
      from proveedores.modelo m
      left join catalogo.modelo mo on m.canonico_id is not null and mo.id = m.canonico_id::bigint
      left join por_modelo pm on m.canonico_id is not null and pm.modelo_id = m.canonico_id::bigint
      left join operacion.existencia_modelo em on m.canonico_id is not null and em.modelo_id = m.canonico_id::bigint
     where m.estado <> 'descontinuado')
  select coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', b.producto_id, 'handle', b.handle, 'marca', b.marca, 'titulo', b.titulo, 'puffs', b.puffs, 'estado', b.estado,
      'primera_vez', b.primera_vez, 'nuevo_semana', b.primera_vez >= now() - interval '7 days',
      'mapeo', b.mapeo, 'canonico_id', b.canonico_id, 'canonico_nombre', b.canonico_nombre, 'sin_sabores', b.sin_sabores, 'nuevo_sin_costo', b.nuevo_sin_costo,
      'ventas_60d', b.p60, 'ventas_30d', b.p30, 'vendemos', b.p60 > 0, 'existencia_propia', b.existencia,
      'cobertura_dias', case when b.p60 > 0 then floor(b.existencia * 60.0 / b.p60)::int end,
      'sabores', coalesce((
        select jsonb_agg(jsonb_build_object(
            'variante_id', v.variante_id, 'sabor', v.sabor_original, 'disponible', v.disponible, 'inestable', v.inestable_hasta is not null and v.inestable_hasta > now(),
            'sabor_canonico_id', v.sabor_canonico_id,
            'ventas_60d', coalesce(sv.p60, 0), 'existencia_propia', coalesce(se.piezas, 0),
            'cambio_en', ue.en, 'cambio_tipo', ue.tipo) order by v.sabor_original)
          from proveedores.variante v
          left join catalogo.sku k on b.canonico_id is not null and v.sabor_canonico_id is not null and k.modelo_id = b.canonico_id::bigint and k.sabor_id = v.sabor_canonico_id::bigint
          left join vta sv on sv.sku_id = k.id
          left join exs se on se.sku_id = k.id
          left join lateral (select e.en, e.tipo from proveedores.evento e where e.variante_id = v.variante_id order by e.en desc limit 1) ue on true
         where v.producto_id = b.producto_id and v.estado <> 'descontinuada'), '[]'::jsonb),
      'eventos', coalesce((
        select jsonb_agg(jsonb_build_object('clave', e.clave, 'tipo', e.tipo, 'en', e.en, 'antes', e.antes, 'despues', e.despues,
            'sabor', (select vv.sabor_original from proveedores.variante vv where vv.variante_id = e.variante_id)) order by e.en desc)
          from (select * from proveedores.evento ee where ee.producto_id = b.producto_id order by ee.en desc limit 8) e), '[]'::jsonb)
    ) order by b.marca, b.titulo), '[]'::jsonb)
    into v_modelos
    from base b;

  -- Recomendaciones: un renglon por modelo, con todos sus motivos. Solo modelos que ya vendemos (6 piezas o mas en 60 dias) y que Karen tiene con algun sabor disponible.
  with m as (
    select x as j, (x ->> 'producto_id') as producto_id, (x ->> 'ventas_60d')::int as p60, (x ->> 'existencia_propia')::int as ex, nullif(x ->> 'cobertura_dias', '')::int as cob
      from jsonb_array_elements(v_modelos) x
     where (x ->> 'ventas_60d')::int >= 6 and exists (select 1 from jsonb_array_elements(x -> 'sabores') s where (s ->> 'disponible')::boolean)),
  motivos as (
    select m.producto_id, m.p60, m.ex, m.cob, m.j,
      array_remove(array[
        case when m.ex = 0 or m.cob <= 21 then 'reponer' end,
        case when exists (select 1 from jsonb_array_elements(m.j -> 'eventos') e where e ->> 'tipo' in ('modelo_nuevo', 'modelo_regreso_catalogo', 'sabor_nuevo', 'sabor_regreso') and (e ->> 'en')::timestamptz >= now() - interval '7 days') then 'llego_y_vendemos' end,
        case when exists (select 1 from jsonb_array_elements(m.j -> 'eventos') e where e ->> 'tipo' in ('modelo_agotado', 'sabor_agotado') and (e ->> 'en')::timestamptz >= now() - interval '7 days') then 'agotado_y_vendemos' end
      ], null) as lista
      from m)
  select coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', mo.producto_id, 'titulo', mo.j ->> 'titulo', 'marca', mo.j ->> 'marca', 'motivos', to_jsonb(mo.lista),
      'ventas_60d', mo.p60, 'existencia_propia', mo.ex, 'cobertura_dias', mo.cob,
      'sabores_sugeridos', coalesce((
        select jsonb_agg(s ->> 'sabor' order by (s ->> 'ventas_60d')::int desc, (s ->> 'existencia_propia')::int, s ->> 'sabor')
          from (select s from jsonb_array_elements(mo.j -> 'sabores') s where (s ->> 'disponible')::boolean and (s ->> 'ventas_60d')::int > 0 order by (s ->> 'ventas_60d')::int desc, (s ->> 'existencia_propia')::int limit 6) q(s)), '[]'::jsonb)
    ) order by (case when 'reponer' = any (mo.lista) then 0 else 1 end), coalesce(mo.cob, -1), mo.p60 desc), '[]'::jsonb)
    into v_recom
    from motivos mo
   where cardinality(mo.lista) > 0;

  return jsonb_build_object('modelos', v_modelos, 'recomendaciones', v_recom);
end $$;

create function api.prov_tablero() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.tablero_karen(); end $$;

revoke execute on function proveedores.tablero_karen() from public, anon, authenticated;
grant execute on function proveedores.tablero_karen() to servidor;
revoke execute on function api.prov_tablero() from public, anon;
grant execute on function api.prov_tablero() to authenticated;
