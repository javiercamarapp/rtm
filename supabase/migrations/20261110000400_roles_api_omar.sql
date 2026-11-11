-- F1 / 0004: roles y lecturas.
--  * rol de base `servidor` (sin BYPASSRLS): solo ejecuta lo que se le concede; sustituye al anon en el limite de intentos del login.
--  * funciones de lectura `api.*` (SECURITY DEFINER, exigen rol socio): la web nunca toca las tablas.
--  * esquema `omar`: solo lectura con lista blanca, PREPARADO PERO CERRADO (devuelve cero filas mientras Omar este desactivado).

-- ---------------------------------------------------------------------------
-- Rol servidor. Sin login por defecto: el script local de entorno le pone contrasena (nunca en el repo).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'servidor') then
    create role servidor nologin nobypassrls noinherit nocreatedb nocreaterole nosuperuser;
  end if;
end $$;
grant servidor to postgres; -- para probar con SET ROLE
grant usage on schema seguridad to servidor;
grant execute on function seguridad.registrar_intento_login(text, int) to servidor;

-- El limite de intentos ya no es ejecutable por anon ni authenticated: lo llama el servidor con su propio rol.
drop function api.registrar_intento_login(text, int);

-- ---------------------------------------------------------------------------
-- Lecturas de la web (rol socio)
-- ---------------------------------------------------------------------------
create function api.catalogo_modelos() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(x order by x->>'marca', x->>'nombre') from (
      select jsonb_build_object(
        'id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico, 'puffs', m.puffs, 'estado', m.estado, 'estado_desde', m.estado_desde,
        'lista', m.lista_origen,
        'costos', coalesce((select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'costo_cent', c.costo_cent, 'desde', c.vigente_desde, 'supuesto', c.supuesto,
                                                               'es_lista', c.es_lista, 'motivo', c.motivo, 'fuente', c.fuente) order by p.nombre)
                            from catalogo.costo_proveedor c join catalogo.proveedor p on p.id = c.proveedor_id where c.modelo_id = m.id and c.vigente_hasta is null), '[]'::jsonb),
        'alias', coalesce((select jsonb_agg(a.alias_norm order by a.alias_norm) from catalogo.modelo_alias a where a.modelo_id = m.id or m.id = any (a.candidatos)), '[]'::jsonb),
        'precios', jsonb_build_object(
          'clientes', (select count(distinct t.cliente_id) from catalogo.tabulador_precio t where t.modelo_id = m.id and t.vigente_hasta is null),
          'min_cent', (select min(t.precio_cent) from catalogo.tabulador_precio t where t.modelo_id = m.id and t.vigente_hasta is null),
          'max_cent', (select max(t.precio_cent) from catalogo.tabulador_precio t where t.modelo_id = m.id and t.vigente_hasta is null))
      ) x
      from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id
    ) q), '[]'::jsonb);
end $$;

create function api.catalogo_modelo_precios(p_modelo_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'precio_cent', t.precio_cent, 'desde', t.vigente_desde, 'origen', t.origen, 'nota', t.nota,
      'margenes', coalesce((select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'costo_cent', k.costo_cent, 'margen_cent', t.precio_cent - k.costo_cent, 'supuesto', k.supuesto) order by p.nombre)
                            from catalogo.costo_proveedor k join catalogo.proveedor p on p.id = k.proveedor_id where k.modelo_id = t.modelo_id and k.vigente_hasta is null), '[]'::jsonb)
    ) order by c.nombre_canonico)
    from catalogo.tabulador_precio t join catalogo.cliente c on c.id = t.cliente_id join catalogo.socio s on s.id = c.duenio_id
    where t.modelo_id = p_modelo_id and t.vigente_hasta is null), '[]'::jsonb);
end $$;

create function api.clientes_lista() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'nombre', c.nombre_canonico, 'duenio', s.nombre, 'tipo', c.tipo, 'activo', c.activo,
      'precios', (select count(*) from catalogo.tabulador_precio t where t.cliente_id = c.id and t.vigente_hasta is null),
      'alias', coalesce((select jsonb_agg(jsonb_build_object('alias', a.alias_norm, 'por_confirmar', a.por_confirmar) order by a.alias_norm) from catalogo.cliente_alias a where a.cliente_id = c.id), '[]'::jsonb),
      'es_bodega', exists (select 1 from catalogo.persona_bodega pb where pb.cliente_id = c.id)
    ) order by c.nombre_canonico)
    from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id), '[]'::jsonb);
end $$;

create function api.cliente_ficha(p_cliente_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select jsonb_build_object(
    'id', c.id, 'nombre', c.nombre_canonico, 'duenio', s.nombre, 'tipo', c.tipo, 'activo', c.activo,
    'es_bodega', exists (select 1 from catalogo.persona_bodega pb where pb.cliente_id = c.id),
    'alias', coalesce((select jsonb_agg(jsonb_build_object('alias', a.alias_norm, 'por_confirmar', a.por_confirmar, 'ambiguo', a.ambiguo) order by a.alias_norm) from catalogo.cliente_alias a where a.cliente_id = c.id or c.id = any (a.candidatos)), '[]'::jsonb),
    'destinos', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', d.etiqueta, 'zona', d.zona) order by d.etiqueta) from catalogo.cliente_destino d where d.cliente_id = c.id), '[]'::jsonb),
    'tabulador', coalesce((select jsonb_agg(jsonb_build_object(
        'modelo_id', m.id, 'modelo', m.nombre_canonico, 'estado', m.estado, 'precio_cent', t.precio_cent, 'desde', t.vigente_desde, 'origen', t.origen, 'nota', t.nota,
        'margenes', coalesce((select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'costo_cent', k.costo_cent, 'margen_cent', t.precio_cent - k.costo_cent, 'supuesto', k.supuesto) order by p.nombre)
                              from catalogo.costo_proveedor k join catalogo.proveedor p on p.id = k.proveedor_id where k.modelo_id = t.modelo_id and k.vigente_hasta is null), '[]'::jsonb)
      ) order by m.nombre_canonico)
      from catalogo.tabulador_precio t join catalogo.modelo m on m.id = t.modelo_id where t.cliente_id = c.id and t.vigente_hasta is null), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(h order by h->>'modelo', h->>'desde' desc) from (
        select jsonb_build_object('modelo', m.nombre_canonico, 'precio_cent', t.precio_cent, 'desde', t.vigente_desde, 'hasta', t.vigente_hasta, 'origen', t.origen, 'vigente', t.vigente_hasta is null) h
          from catalogo.tabulador_precio t join catalogo.modelo m on m.id = t.modelo_id where t.cliente_id = c.id
        union all
        select jsonb_build_object('modelo', m.nombre_canonico, 'precio_cent', e.precio_cent, 'desde', e.creado_en::date, 'hasta', null, 'origen', e.origen, 'vigente', false, 'externo', true, 'nota', e.nota)
          from catalogo.precio_historico_externo e join catalogo.modelo m on m.id = e.modelo_id where e.cliente_id = c.id) q), '[]'::jsonb)
  ) into v
  from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.id = p_cliente_id;
  return v;
end $$;

create function api.inventario_existencia() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'modelos', coalesce((select jsonb_agg(jsonb_build_object(
        'modelo_id', m.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'estado', m.estado,
        'piezas', e.piezas, 'valor_cent', e.valor_cent, 'costo_prom_cent', e.costo_prom_cent,
        'ultimo_movimiento', (select max(mi.hora) from operacion.movimiento_inventario mi where mi.modelo_id = m.id)
      ) order by ma.nombre, m.nombre_canonico)
      from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id left join operacion.existencia_modelo e on e.modelo_id = m.id), '[]'::jsonb),
    'sabores', coalesce((select jsonb_agg(jsonb_build_object(
        'sku_id', k.id, 'modelo_id', k.modelo_id, 'sabor', sa.nombre_canonico, 'ubicacion', ub.nombre, 'ubicacion_codigo', u.ubicacion, 'piezas', u.piezas
      ) order by sa.nombre_canonico, ub.orden)
      from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.ubicacion ub on ub.codigo = u.ubicacion), '[]'::jsonb));
end $$;

-- "Explicar este numero": cifra, segunda via de comprobacion y los movimientos que la forman.

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare partes text[] := string_to_array(p_cifra, ':'); v_id bigint; v_c bigint; v_m bigint; v_via1 bigint; v_via2 bigint; v_movs jsonb; v_precio bigint;
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
  end if;
  raise exception 'cifra desconocida' using errcode = '22023';
end $$;

revoke execute on all functions in schema api from public, anon, authenticated;
grant execute on function api.mi_sesion() to authenticated;
grant execute on function api.catalogo_modelos(), api.catalogo_modelo_precios(bigint), api.clientes_lista(), api.cliente_ficha(bigint), api.inventario_existencia(), api.explicar_cifra(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Esquema omar: lista blanca. Capa intermedia con nombres neutros en el esquema operacion (no expuesto); las vistas de omar solo
-- ven esas columnas. Cerrado: sin rol `omar` ACTIVO las vistas devuelven cero filas.
-- ---------------------------------------------------------------------------
create view operacion.v_omar_mercancia_base with (security_barrier = true) as
  select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, u.piezas as piezas
  from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
  where u.ubicacion = 'bodega_omar' and u.piezas > 0;

create view operacion.v_omar_precios_base with (security_barrier = true) as
  select m.nombre_canonico as modelo, t.precio_cent as precio, t.vigente_desde as desde
  from catalogo.persona_bodega pb join catalogo.tabulador_precio t on t.cliente_id = pb.cliente_id join catalogo.modelo m on m.id = t.modelo_id
  where t.vigente_hasta is null;

create view omar.v_mercancia with (security_barrier = true) as
  select b.modelo, b.sabor, b.piezas from operacion.v_omar_mercancia_base b where exists (select 1 from seguridad.usuario u where u.id = auth.uid() and u.rol = 'omar' and u.activo);
create view omar.v_mis_precios with (security_barrier = true) as
  select b.modelo, b.precio, b.desde from operacion.v_omar_precios_base b where exists (select 1 from seguridad.usuario u where u.id = auth.uid() and u.rol = 'omar' and u.activo);

revoke all on all tables in schema omar from public, anon, authenticated;
grant select on omar.v_mercancia, omar.v_mis_precios to authenticated;
revoke all on operacion.v_omar_mercancia_base, operacion.v_omar_precios_base from public, anon, authenticated;
