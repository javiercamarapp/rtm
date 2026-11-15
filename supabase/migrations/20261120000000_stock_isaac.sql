-- Stock DISPONIBLE de Isaac (catalogo Remate), con el mismo formato que el de Karen. ADITIVA: solo tablas y funciones nuevas; no toca el estado de Karen ni ningun dato existente.
--  * Isaac no tiene una tienda que se pueda leer: su disponible es el catalogo que el dueno recibe de el. Se guarda por modelo y sabor del CATALOGO propio (catalogo.modelo / catalogo.sabor).
--  * Sin importes: ninguna columna de dinero (el costo de Isaac vive en catalogo.costo_proveedor, solo para socios).
--  * guardar_stock_isaac es idempotente: por cada modelo recibido, los sabores listados quedan disponibles y los que ya estaban registrados y no vienen quedan agotados.

create table proveedores.stock_isaac_modelo (
  modelo_id bigint primary key references catalogo.modelo (id),
  fuente text not null,
  primera_vez timestamptz not null default now(),
  visto_en timestamptz not null default now()
);
create table proveedores.stock_isaac_sabor (
  modelo_id bigint not null references proveedores.stock_isaac_modelo (modelo_id),
  sabor_id bigint not null references catalogo.sabor (id),
  disponible boolean not null default true,
  cambio_en timestamptz not null default now(),
  primary key (modelo_id, sabor_id)
);

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'proveedores' and c.relname in ('stock_isaac_modelo', 'stock_isaac_sabor') loop
    execute format('alter table proveedores.%I enable row level security', r.relname);
    execute format('alter table proveedores.%I force row level security', r.relname);
    execute format('revoke all on proveedores.%I from public, anon, authenticated', r.relname);
  end loop;
end $$;

-- p_modelos: [{ "modelo_id": 12, "sabores": [34, 35] }, ...]. Un modelo sin sabores queda registrado sin sabor.
create function proveedores.guardar_stock_isaac(p_modelos jsonb, p_fuente text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m jsonb; v_modelo bigint; v_sabores bigint[]; v_nm int := 0; v_ns int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if proveedores.tiene_clave_importe(p_modelos) then raise exception 'el stock de proveedores no admite importes' using errcode = 'P0461'; end if;
  if jsonb_typeof(p_modelos) <> 'array' then raise exception 'p_modelos debe ser un arreglo' using errcode = '22023'; end if;
  for m in select * from jsonb_array_elements(p_modelos) loop
    v_modelo := (m ->> 'modelo_id')::bigint;
    v_sabores := coalesce(array(select jsonb_array_elements_text(m -> 'sabores')::bigint), '{}'::bigint[]);
    insert into proveedores.stock_isaac_modelo (modelo_id, fuente) values (v_modelo, p_fuente)
      on conflict (modelo_id) do update set visto_en = now(), fuente = excluded.fuente;
    v_nm := v_nm + 1;
    insert into proveedores.stock_isaac_sabor (modelo_id, sabor_id, disponible)
      select v_modelo, s, true from unnest(v_sabores) s
      on conflict (modelo_id, sabor_id) do update set disponible = true, cambio_en = case when proveedores.stock_isaac_sabor.disponible then proveedores.stock_isaac_sabor.cambio_en else now() end;
    update proveedores.stock_isaac_sabor set disponible = false, cambio_en = now()
     where modelo_id = v_modelo and disponible and not (sabor_id = any (v_sabores));
    v_ns := v_ns + cardinality(v_sabores);
  end loop;
  return jsonb_build_object('modelos', v_nm, 'sabores', v_ns);
end $$;

-- Mismo formato que proveedores.tablero_karen().modelos, para reusar la pagina. producto_id = 'isaac-<id del modelo>'.
create function proveedores.tablero_isaac() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy(); v_modelos jsonb;
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
  por_modelo as (select k.modelo_id, sum(v.p60)::int as p60, sum(v.p30)::int as p30 from catalogo.sku k join vta v on v.sku_id = k.id group by k.modelo_id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', 'isaac-' || si.modelo_id, 'handle', regexp_replace(lower(mo.nombre_norm), '[^a-z0-9]+', '-', 'g'), 'marca', ma.nombre, 'titulo', mo.nombre_canonico, 'puffs', mo.puffs,
      'estado', 'activo', 'primera_vez', si.primera_vez, 'nuevo_semana', si.primera_vez >= now() - interval '7 days',
      'mapeo', 'confirmado', 'canonico_id', mo.id::text, 'canonico_nombre', mo.nombre_canonico,
      'sin_sabores', not exists (select 1 from proveedores.stock_isaac_sabor x where x.modelo_id = si.modelo_id), 'nuevo_sin_costo', false,
      'ventas_60d', coalesce(pm.p60, 0), 'ventas_30d', coalesce(pm.p30, 0), 'vendemos', coalesce(pm.p60, 0) > 0,
      'existencia_propia', coalesce(em.piezas, 0),
      'cobertura_dias', case when coalesce(pm.p60, 0) > 0 then floor(coalesce(em.piezas, 0) * 60.0 / pm.p60)::int end,
      'sabores', coalesce((
        select jsonb_agg(jsonb_build_object(
            'variante_id', 'isaac-' || x.modelo_id || '-' || x.sabor_id, 'sabor', sb.nombre_canonico, 'disponible', x.disponible, 'inestable', false,
            'sabor_canonico_id', x.sabor_id::text, 'ventas_60d', coalesce(sv.p60, 0), 'existencia_propia', coalesce(se.piezas, 0),
            'cambio_en', x.cambio_en, 'cambio_tipo', null) order by sb.nombre_canonico)
          from proveedores.stock_isaac_sabor x
          join catalogo.sabor sb on sb.id = x.sabor_id
          left join catalogo.sku k on k.modelo_id = x.modelo_id and k.sabor_id = x.sabor_id
          left join vta sv on sv.sku_id = k.id
          left join exs se on se.sku_id = k.id
         where x.modelo_id = si.modelo_id), '[]'::jsonb),
      'eventos', '[]'::jsonb) order by ma.nombre, mo.nombre_canonico), '[]'::jsonb)
    into v_modelos
    from proveedores.stock_isaac_modelo si
    join catalogo.modelo mo on mo.id = si.modelo_id
    join catalogo.marca ma on ma.id = mo.marca_id
    left join por_modelo pm on pm.modelo_id = mo.id
    left join operacion.existencia_modelo em on em.modelo_id = mo.id;
  return jsonb_build_object('modelos', v_modelos, 'recomendaciones', '[]'::jsonb);
end $$;

create function api.prov_tablero_isaac() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.tablero_isaac(); end $$;

revoke execute on function proveedores.guardar_stock_isaac(jsonb, text), proveedores.tablero_isaac() from public, anon, authenticated;
grant execute on function proveedores.guardar_stock_isaac(jsonb, text), proveedores.tablero_isaac() to servidor;
revoke execute on function api.prov_tablero_isaac() from public, anon;
grant execute on function api.prov_tablero_isaac() to authenticated;
