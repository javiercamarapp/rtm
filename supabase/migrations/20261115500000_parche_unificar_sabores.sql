-- Parche de la unificacion de sabores (revision independiente). Migracion ADITIVA: funciones nuevas y create or replace de funciones vigentes
-- (cada cuerpo parte de la definicion VIGENTE de la base con todas las migraciones anteriores, no de una version vieja; conservan firma, permisos,
-- seguridad.exigir_rol y search_path). No se toca ninguna fila de datos ni ninguna tabla.
--
--   H2  Las lecturas por sku agrupan al sku FUSIONADO (sku.unificado_en) con su sku vigente: sus piezas, entradas y salidas se SUMAN al canonico, nunca desaparecen,
--       y el inventario deja de mostrar un segundo renglon con el mismo nombre y 0 piezas. Totales, kardex y cuadre quedan identicos.
--   H4  Un movimiento, pedido, compra, recepcion, surtido o conteo que llega con el sku_id de un sku fusionado se REDIRIGE de forma transparente al sku vigente
--       (queda auditado en recepcion, surtido y alta por alias). resolver_sku y las funciones que resuelven por nombre entienden el alias dejado por una unificacion
--       ('Passionfruit' resuelve a 'Passion Fruit'). La devolucion de cliente respeta el sku historico surtido (su reingreso es del sku surtido; ver docs).
--   H5  Si la clave de idempotencia ya tiene resultado 'unificado' pero esa unificacion se deshizo, se rechaza con 'ya deshecho: usa una clave nueva' (P0463).
--   H3  canonico_sugerido y la respuesta por omision, en empate de sku, prefieren el nombre con espacios entre palabras o el mas largo ('Passion Fruit' gana a 'Passionfruit').

-- Sku vigente: el canonico si el sku fue fusionado, el mismo si no.
create function catalogo.sku_vigente(p_sku bigint) returns bigint
language sql stable set search_path = ''
as $$ select coalesce((select s.unificado_en from catalogo.sku s where s.id = p_sku), p_sku) $$;

-- Todos los sku que cuentan como el mismo sabor-modelo: el vigente y los fusionados en el.
create function catalogo.skus_del_grupo(p_sku bigint) returns setof bigint
language sql stable set search_path = ''
as $$ select z.id from catalogo.sku z where coalesce(z.unificado_en, z.id) = catalogo.sku_vigente(p_sku) $$;

-- Sabor por nombre propio o por el alias que dejo una unificacion (solo esos alias; los demas siguen sin resolver aqui).
create function catalogo.sabor_por_nombre(p_nombre text) returns bigint
language sql stable set search_path = ''
as $$
  select coalesce((select s.id from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(p_nombre)),
                  (select a.sabor_id from catalogo.sabor_alias a where a.alias_norm = catalogo.normalizar(p_nombre) and a.origen_unificacion is not null))
$$;

-- Canonico por omision de un par de sabores: el que tiene mas sku vigentes; en empate el nombre con mas palabras separadas por espacio, luego el mas largo, luego el id menor.
create function catalogo.sabor_canonico_preferido(p_a bigint, p_b bigint) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_na int; v_nb int; v_ta text; v_tb text; v_wa int; v_wb int;
begin
  select count(*) into v_na from catalogo.sku where sabor_id = p_a and unificado_en is null;
  select count(*) into v_nb from catalogo.sku where sabor_id = p_b and unificado_en is null;
  if v_nb > v_na then return p_b; elsif v_na > v_nb then return p_a; end if;
  select btrim(nombre_canonico) into v_ta from catalogo.sabor where id = p_a;
  select btrim(nombre_canonico) into v_tb from catalogo.sabor where id = p_b;
  v_wa := coalesce(array_length(regexp_split_to_array(v_ta, '\s+'), 1), 1);
  v_wb := coalesce(array_length(regexp_split_to_array(v_tb, '\s+'), 1), 1);
  if v_wb > v_wa then return p_b; elsif v_wa > v_wb then return p_a; end if;
  if char_length(v_tb) > char_length(v_ta) then return p_b; elsif char_length(v_ta) > char_length(v_tb) then return p_a; end if;
  return least(p_a, p_b);
end $$;

-- Auditoria de redirecciones. Una pasada por los renglones: deja un registro por cada sku fusionado que llego y se redirigio al vigente.
create function catalogo.auditar_redirecciones(p_items jsonb, p_contexto text) returns void
language plpgsql security definer set search_path = ''
as $$
declare e jsonb; v_in bigint; v_vig bigint;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(e) = 'object' and e ? 'sku_id' and nullif(e ->> 'sku_id', '') is not null then
      v_in := (e ->> 'sku_id')::bigint;
      v_vig := catalogo.sku_vigente(v_in);
      if v_vig <> v_in then
        perform seguridad.registrar_auditoria('catalogo.sku', 'REDIRECCION_SKU_FUSIONADO', v_in::text, jsonb_build_object('sku_id', v_in),
          jsonb_build_object('sku_vigente', v_vig, 'contexto', p_contexto), 'web');
      end if;
    end if;
  end loop;
end $$;

-- Auditoria de una redireccion por alias: el nombre escrito no es el propio del sabor sino un alias dejado por una unificacion.
create function catalogo.auditar_alias_sabor(p_nombre text, p_sku bigint, p_contexto text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_norm text;
begin
  select sa.nombre_norm into v_norm from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.id = p_sku;
  if v_norm is distinct from catalogo.normalizar(p_nombre) then
    perform seguridad.registrar_auditoria('catalogo.sku', 'REDIRECCION_ALIAS_SABOR', p_sku::text, jsonb_build_object('nombre', p_nombre),
      jsonb_build_object('sku_vigente', p_sku, 'contexto', p_contexto), 'web');
  end if;
end $$;

revoke execute on function catalogo.sku_vigente(bigint), catalogo.skus_del_grupo(bigint), catalogo.sabor_por_nombre(text), catalogo.sabor_canonico_preferido(bigint, bigint),
  catalogo.auditar_redirecciones(jsonb, text), catalogo.auditar_alias_sabor(text, bigint, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION api.inventario_existencia()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'sku_id', q.sid, 'modelo_id', q.mid, 'sabor', q.sabor, 'ubicacion', q.ub, 'ubicacion_codigo', q.cod, 'piezas', q.piezas
      ) order by q.sabor, q.orden)
      from (select c.id as sid, c.modelo_id as mid, sa.nombre_canonico as sabor, ub.nombre as ub, ub.orden as orden, u.ubicacion as cod, sum(u.piezas)::int as piezas
              from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id
              join catalogo.sku c on c.id = coalesce(k.unificado_en, k.id) join catalogo.sabor sa on sa.id = c.sabor_id join catalogo.ubicacion ub on ub.codigo = u.ubicacion
             group by c.id, c.modelo_id, sa.nombre_canonico, ub.nombre, ub.orden, u.ubicacion
            having sum(u.piezas) <> 0 or bool_or(k.unificado_en is null)) q), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION api.inventario_detalle(p_ini date DEFAULT NULL::date, p_fin date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_hoy date := negocio.hoy(); v_fin date := coalesce(p_fin, negocio.hoy()); v_ini date := coalesce(p_ini, coalesce(p_fin, negocio.hoy()) - 29); v_mod jsonb; v_sku jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_ini > v_fin then raise exception 'rango de fechas invalido' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(q.j order by q.mid), '[]'::jsonb) into v_mod from (
    select m.id as mid, jsonb_build_object('modelo_id', m.id,
        'entradas', coalesce(sum(mi.cantidad) filter (where mi.cantidad > 0 and mi.fecha_neg between v_ini and v_fin), 0),
        'salidas', coalesce(-sum(mi.cantidad) filter (where mi.cantidad < 0 and mi.fecha_neg between v_ini and v_fin), 0),
        'mermas', coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'merma' and mi.fecha_neg between v_ini and v_fin), 0),
        'ajustes', coalesce(sum(mi.cantidad) filter (where mi.tipo = 'ajuste_conteo' and mi.fecha_neg between v_ini and v_fin), 0),
        'ultima_entrada', max(mi.fecha_neg) filter (where mi.tipo = 'entrada_compra'),
        'ultima_salida', max(mi.fecha_neg) filter (where mi.tipo in ('salida_pedido', 'salida_toma_omar')),
        'piezas_inicial', (select x.piezas_modelo_despues from operacion.movimiento_inventario x where x.modelo_id = m.id and x.fecha_neg < v_ini order by x.id desc limit 1)) as j
      from catalogo.modelo m join operacion.movimiento_inventario mi on mi.modelo_id = m.id where mi.fecha_neg <= v_fin group by m.id) q;
  select coalesce(jsonb_agg(q.j order by q.sid), '[]'::jsonb) into v_sku from (
    select g.sid, jsonb_build_object('sku_id', g.sid, 'modelo_id', g.mid,
        'entradas', sum(g.entradas), 'salidas', sum(g.salidas), 'mermas', sum(g.mermas), 'ajustes', sum(g.ajustes),
        'ultima_entrada', max(g.ultima_entrada), 'ultima_salida', max(g.ultima_salida), 'piezas_inicial', sum(g.piezas_inicial)) as j
      from (
        select coalesce(k.unificado_en, k.id) as sid, k.modelo_id as mid,
            coalesce(sum(mi.cantidad) filter (where mi.cantidad > 0 and mi.fecha_neg between v_ini and v_fin), 0) as entradas,
            coalesce(-sum(mi.cantidad) filter (where mi.cantidad < 0 and mi.fecha_neg between v_ini and v_fin), 0) as salidas,
            coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'merma' and mi.fecha_neg between v_ini and v_fin), 0) as mermas,
            coalesce(sum(mi.cantidad) filter (where mi.tipo = 'ajuste_conteo' and mi.fecha_neg between v_ini and v_fin), 0) as ajustes,
            max(mi.fecha_neg) filter (where mi.tipo = 'entrada_compra') as ultima_entrada,
            max(mi.fecha_neg) filter (where mi.tipo in ('salida_pedido', 'salida_toma_omar')) as ultima_salida,
            (select x.piezas_sku_despues from operacion.movimiento_inventario x where x.sku_id = k.id and x.fecha_neg < v_ini order by x.id desc limit 1) as piezas_inicial
          from catalogo.sku k join operacion.movimiento_inventario mi on mi.sku_id = k.id where mi.fecha_neg <= v_fin group by k.id) g
     group by g.sid, g.mid) q;
  return jsonb_build_object('ini', v_ini, 'fin', v_fin, 'hoy', v_hoy, 'modelos', v_mod, 'sabores', v_sku);
end $function$;

CREATE OR REPLACE FUNCTION operacion.cobertura(p_hoy date DEFAULT NULL::date)
 RETURNS TABLE(nivel text, modelo_id bigint, sku_id bigint, fisico integer, reservado integer, disponible integer, salidas integer, dias_efectivos integer, dias_historia integer, lt_dias integer, demanda numeric, dias numeric, estado text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_vent int := catalogo.config_num('demanda_ventana_dias')::int; v_hist int := catalogo.config_num('historia_minima_dias')::int;
  v_min int := catalogo.config_num('demanda_min_salidas_sabor')::int; v_ciclo numeric := catalogo.config_num('ciclo_pedido_dias'); v_obj numeric := catalogo.config_num('cobertura_objetivo_dias');
  v_x numeric := catalogo.config_num('sobrestock_x');
begin
  return query
  with salidas as (
    select catalogo.sku_vigente(mi.sku_id) as sid, (-sum(mi.cantidad))::int as n
      from operacion.movimiento_inventario mi left join operacion.movimiento_inventario o on o.id = mi.reversa_de
     where mi.fecha_neg > v_hoy - v_vent and mi.fecha_neg <= v_hoy
       and (mi.tipo in ('salida_pedido', 'salida_toma_omar') or (mi.tipo = 'reversa' and o.tipo in ('salida_pedido', 'salida_toma_omar')))
     group by catalogo.sku_vigente(mi.sku_id)),
  ef as (
    select m.id as mid, count(*) filter (where coalesce(x.p, 0) > 0)::int as d
      from catalogo.modelo m cross join generate_series(0, v_vent - 1) g
      left join lateral (select mi.piezas_modelo_despues as p from operacion.movimiento_inventario mi where mi.modelo_id = m.id and mi.fecha_neg <= v_hoy - g order by mi.id desc limit 1) x on true
     where exists (select 1 from operacion.movimiento_inventario z where z.modelo_id = m.id)
     group by m.id),
  hist as (select mi.modelo_id as mid, (v_hoy - min(mi.fecha_neg))::int as d from operacion.movimiento_inventario mi group by mi.modelo_id),
  lt as (
    select m.id as mid, coalesce((select min(catalogo.config_num('lt_dias_' || lower(p.nombre)))::int from catalogo.costo_proveedor c join catalogo.proveedor p on p.id = c.proveedor_id
                                   where c.modelo_id = m.id and c.vigente_hasta is null), catalogo.config_num('lt_dias_isaac')::int) as l
      from catalogo.modelo m),
  res as (select catalogo.sku_vigente(r.sku_id) as sid, sum(r.piezas)::int as r from operacion.reserva r where r.estado = 'activa' group by catalogo.sku_vigente(r.sku_id)),
  skb as (
    select k.id as sid, k.modelo_id as mid, coalesce(u.piezas, 0)::int as f, coalesce(res.r, 0)::int as r, greatest(coalesce(u.piezas, 0) - coalesce(res.r, 0), 0)::int as disp, coalesce(s.n, 0)::int as n
      from catalogo.sku k
      left join lateral (select sum(uu.piezas)::int as piezas from operacion.existencia_sku_ubicacion uu join catalogo.sku g on g.id = uu.sku_id
                          where coalesce(g.unificado_en, g.id) = k.id and uu.ubicacion = 'bodega_omar') u on true
      left join res on res.sid = k.id left join salidas s on s.sid = k.id
     where k.unificado_en is null and exists (select 1 from operacion.existencia_sku_ubicacion x where catalogo.sku_vigente(x.sku_id) = k.id)),
  modb as (select b.mid, sum(b.f)::int as f, sum(b.r)::int as r, sum(b.disp)::int as disp, sum(b.n)::int as n from skb b group by b.mid),
  modc as (
    select b.mid, b.f, b.r, b.disp, b.n, coalesce(ef.d, 0) as efd, coalesce(h.d, 0) as hd, lt.l,
           case when coalesce(ef.d, 0) > 0 then b.n::numeric / ef.d else 0 end as dem
      from modb b left join ef on ef.mid = b.mid left join hist h on h.mid = b.mid left join lt on lt.mid = b.mid),
  skc as (
    select s.sid, s.mid, s.f, s.r, s.disp, s.n, m.efd, m.hd, m.l,
           case when m.efd = 0 then 0
                when s.n >= v_min then s.n::numeric / m.efd
                else greatest(s.n::numeric / m.efd, case when m.f > 0 then m.dem * s.f / m.f else 0 end) end as dem
      from skb s join modc m on m.mid = s.mid)
  select 'modelo'::text, c.mid, null::bigint, c.f, c.r, c.disp, c.n, c.efd, c.hd, c.l, c.dem, case when c.dem > 0 then c.disp / c.dem end,
         operacion.estado_cobertura_calc(c.hd, v_hist, c.dem, c.disp, c.l, v_ciclo, v_obj, v_x)
    from modc c
  union all
  select 'sku'::text, c.mid, c.sid, c.f, c.r, c.disp, c.n, c.efd, c.hd, c.l, c.dem, case when c.dem > 0 then c.disp / c.dem end,
         operacion.estado_cobertura_calc(c.hd, v_hist, c.dem, c.disp, c.l, v_ciclo, v_obj, v_x)
    from skc c;
end $function$;

CREATE OR REPLACE FUNCTION operacion.inventario_base(p_hoy date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_vent int := catalogo.config_num('socios_venden_ventana_dias')::int; v_res jsonb;
begin
  with cob as (select * from operacion.cobertura(v_hoy)),
  skf as (select coalesce(k.unificado_en, k.id) as sid, k.modelo_id as mid, sum(u.piezas)::int as piezas from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id group by coalesce(k.unificado_en, k.id), k.modelo_id),
  rep as (
    select f.sid, f.mid, (f.piezas::bigint * e.valor_cent) / e.piezas as piso, (f.piezas::bigint * e.valor_cent) % e.piezas as resto, e.valor_cent as vm
      from skf f join operacion.existencia_modelo e on e.modelo_id = f.mid where e.piezas > 0),
  rk as (select r.*, row_number() over (partition by r.mid order by r.resto desc, r.sid) as rn, r.vm - sum(r.piso) over (partition by r.mid) as faltan from rep r),
  vsku as (select r.sid, r.piso + case when r.rn <= r.faltan then 1 else 0 end as v from rk r),
  sab as (
    select f.mid, jsonb_agg(jsonb_build_object('sku_id', f.sid, 'sabor', sa.nombre_canonico, 'piezas', f.piezas, 'reservado', coalesce(c.reservado, 0), 'disponible', coalesce(c.disponible, 0),
             'valor_cent', coalesce(v.v, 0), 'cobertura_dias', round(c.dias, 1), 'demanda_diaria', round(c.demanda, 2), 'estado', c.estado) order by sa.nombre_canonico) as j
      from skf f join catalogo.sku k on k.id = f.sid join catalogo.sabor sa on sa.id = k.sabor_id
      left join cob c on c.nivel = 'sku' and c.sku_id = f.sid left join vsku v on v.sid = f.sid
     group by f.mid),
  ventas as (select distinct mi.modelo_id as mid from operacion.movimiento_inventario mi where mi.tipo in ('salida_pedido', 'salida_toma_omar') and mi.fecha_neg > v_hoy - v_vent),
  mods as (
    select ma.nombre as marca, m.nombre_canonico as modelo,
           jsonb_build_object('modelo_id', m.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'puffs', m.puffs, 'estado_catalogo', m.estado,
             'piezas', e.piezas, 'valor_cent', e.valor_cent, 'costo_prom_cent', e.costo_prom_cent,
             'reservado', c.reservado, 'disponible', c.disponible, 'cobertura_dias', round(c.dias, 1), 'demanda_diaria', round(c.demanda, 2), 'estado', c.estado, 'lt_dias', c.lt_dias, 'dias_historia', c.dias_historia,
             'socios_venden', (v.mid is not null or coalesce(e.piezas, 0) > 0),
             'ultimo_movimiento', (select max(mi.hora) from operacion.movimiento_inventario mi where mi.modelo_id = m.id),
             'sabores', coalesce(s.j, '[]'::jsonb)) as j
      from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id
      left join operacion.existencia_modelo e on e.modelo_id = m.id left join cob c on c.nivel = 'modelo' and c.modelo_id = m.id
      left join sab s on s.mid = m.id left join ventas v on v.mid = m.id)
  select jsonb_build_object(
    'corte', now(), 'hoy', v_hoy,
    'parametros', jsonb_build_object('objetivo_dias', catalogo.config_num('cobertura_objetivo_dias'), 'sobrestock_x', catalogo.config_num('sobrestock_x'), 'ciclo_dias', catalogo.config_num('ciclo_pedido_dias'),
                                     'historia_minima_dias', catalogo.config_num('historia_minima_dias'), 'ventana_dias', catalogo.config_num('demanda_ventana_dias'),
                                     'lt_dias', jsonb_build_object('Isaac', catalogo.config_num('lt_dias_isaac'), 'Karen', catalogo.config_num('lt_dias_karen'))),
    'modelos', coalesce((select jsonb_agg(j order by marca, modelo) from mods), '[]'::jsonb),
    'totales', jsonb_build_object('piezas', coalesce((select sum(piezas) from operacion.existencia_modelo), 0), 'valor_cent', coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0),
                                  'reservado', coalesce((select sum(reservado) from cob where nivel = 'modelo'), 0), 'modelos_con_existencia', (select count(*) from operacion.existencia_modelo where piezas > 0)),
    'comprobacion', jsonb_build_object('valor_modelos_cent', coalesce((select sum(valor_cent) from operacion.existencia_modelo), 0), 'valor_sabores_cent', coalesce((select sum(v) from vsku), 0),
                                       'piezas_modelos', coalesce((select sum(piezas) from operacion.existencia_modelo), 0), 'piezas_sabores', coalesce((select sum(piezas) from skf), 0)),
    'compras_recientes', coalesce((select jsonb_agg(jsonb_build_object('compra_id', q.id, 'folio', q.folio, 'proveedor', q.proveedor, 'pagadas', q.pagadas, 'facturadas', q.facturadas, 'recibidas', q.recibidas,
        'puente_piezas', q.facturadas - coalesce(q.recibidas, 0), 'puente_valor_cent', q.puente, 'fuera_sociedad_cent', q.fuera) order by q.id desc)
      from (select co.id, co.folio, p.nombre as proveedor, (select sum(l.piezas_pagadas) from operacion.compra_linea l where l.compra_id = co.id)::int as pagadas,
                   (select sum(l.piezas_facturadas) from operacion.compra_linea l where l.compra_id = co.id)::int as facturadas, (select sum(l.piezas_recibidas) from operacion.compra_linea l where l.compra_id = co.id)::int as recibidas,
                   coalesce((select sum(d.valor_cent) from operacion.compra_diferencia d where d.compra_id = co.id), 0)::bigint as puente,
                   coalesce((select sum(x.monto_cent) from operacion.partida_fuera_sociedad x where x.compra_id = co.id and x.estado = 'abierta'), 0)::bigint as fuera
              from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id where co.estado in ('recibida', 'cerrada') order by co.id desc limit 3) q), '[]'::jsonb))
    into v_res;
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION proveedores.tablero_karen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_hoy date := negocio.hoy();
  v_modelos jsonb;
  v_recom jsonb;
begin
  perform seguridad.exigir_socio_o_sistema();

  with vta as (
    select catalogo.sku_vigente(s.sku_id) as sku_id, sum(s.piezas)::int as p60, coalesce(sum(s.piezas) filter (where p.fecha_envio >= v_hoy - 30), 0)::int as p30
      from operacion.pedido_surtido s
      join operacion.pedido_linea l on l.id = s.pedido_linea_id
      join operacion.pedido p on p.id = l.pedido_id
     where p.estado = 'enviado' and p.fecha_envio >= v_hoy - 60
     group by catalogo.sku_vigente(s.sku_id)),
  exs as (select catalogo.sku_vigente(u.sku_id) as sku_id, sum(u.piezas)::int as piezas from operacion.existencia_sku_ubicacion u group by catalogo.sku_vigente(u.sku_id)),
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
          left join catalogo.sku k on b.canonico_id is not null and v.sabor_canonico_id is not null and k.modelo_id = b.canonico_id::bigint and k.sabor_id = coalesce((select sx.unificado_en from catalogo.sabor sx where sx.id = v.sabor_canonico_id::bigint), v.sabor_canonico_id::bigint) and k.unificado_en is null
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
end $function$;

CREATE OR REPLACE FUNCTION proveedores.existencia_propia()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('marca', ma.nombre, 'nombre', m.nombre_canonico, 'sabores', s.sabores) order by ma.nombre, m.nombre_canonico)
    from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id
    join lateral (select jsonb_agg(z.nombre order by z.nombre) as sabores
                    from (select distinct sb.nombre_canonico as nombre from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.sku c on c.id = coalesce(k.unificado_en, k.id)
                            join catalogo.sabor sb on sb.id = c.sabor_id where k.modelo_id = m.id and u.piezas > 0) z) s on s.sabores is not null), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION api.inventario_kardex(p_modelo bigint, p_sku bigint DEFAULT NULL::bigint, p_ini date DEFAULT NULL::date, p_fin date DEFAULT NULL::date, p_limite integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_mod jsonb; v_ap jsonb; v_filas jsonb; v_total int; v_via1 bigint; v_via2 bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select jsonb_build_object('id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico) into v_mod from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where m.id = p_modelo;
  if v_mod is null then return null; end if;
  select count(*) into v_total from operacion.movimiento_inventario mi where mi.modelo_id = p_modelo and (p_sku is null or catalogo.sku_vigente(mi.sku_id) = catalogo.sku_vigente(p_sku))
     and (p_ini is null or mi.fecha_neg >= p_ini) and (p_fin is null or mi.fecha_neg <= p_fin);
  select jsonb_build_object('piezas', mi.piezas_modelo_despues, 'valor_cent', mi.valor_modelo_despues_cent,
                            'costo_prom_cent', case when mi.piezas_modelo_despues > 0 then negocio.redondear_medio_arriba(mi.valor_modelo_despues_cent, mi.piezas_modelo_despues) end)
    into v_ap from operacion.movimiento_inventario mi where p_ini is not null and mi.modelo_id = p_modelo and mi.fecha_neg < p_ini order by mi.id desc limit 1;
  select coalesce(jsonb_agg(x.j order by x.id), '[]'::jsonb) into v_filas from (
    select mi.id, jsonb_build_object(
        'id', mi.id, 'hora', mi.hora, 'fecha_neg', mi.fecha_neg, 'tipo', mi.tipo, 'sabor', sa.nombre_canonico, 'sku_id', mi.sku_id, 'ubicacion', mi.ubicacion,
        'referencia', coalesce(
          case mi.tipo
            when 'entrada_compra' then (select co.folio from operacion.lote lo join operacion.compra_linea cl on cl.id = lo.compra_linea_id join operacion.compra co on co.id = cl.compra_id where lo.id = mi.lote_id)
            when 'salida_pedido' then (select pe.folio from operacion.pedido_surtido ps join operacion.pedido_linea pl on pl.id = ps.pedido_linea_id join operacion.pedido pe on pe.id = pl.pedido_id where ps.movimiento_id = mi.id limit 1)
            when 'salida_toma_omar' then (select t.folio from operacion.toma_omar t where t.movimiento_id = mi.id)
          end, e.folio),
        'entra_piezas', case when mi.cantidad > 0 then mi.cantidad end, 'entra_unit_cent', case when mi.cantidad > 0 then mi.costo_unit_aplicado_cent end, 'entra_total_cent', case when mi.cantidad > 0 then mi.valor_cent end,
        'sale_piezas', case when mi.cantidad < 0 then -mi.cantidad end, 'sale_unit_cent', case when mi.cantidad < 0 then mi.costo_unit_aplicado_cent end, 'sale_total_cent', case when mi.cantidad < 0 then -mi.valor_cent end,
        'saldo_piezas', mi.piezas_modelo_despues, 'saldo_valor_cent', mi.valor_modelo_despues_cent,
        'costo_prom_cent', case when mi.piezas_modelo_despues > 0 then negocio.redondear_medio_arriba(mi.valor_modelo_despues_cent, mi.piezas_modelo_despues) end,
        'saldo_sabor_piezas', mi.piezas_sku_despues, 'evento', e.folio, 'canal', e.canal, 'mensaje_origen', e.mensaje_origen,
        'autor', (select coalesce(u.socio_nombre, u.rol) from seguridad.usuario u where u.id = e.actor_id), 'reversa_de', mi.reversa_de, 'es_reversa', mi.tipo = 'reversa', 'nota', mi.nota) as j
      from operacion.movimiento_inventario mi join operacion.evento e on e.id = mi.evento_id join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id
     where mi.modelo_id = p_modelo and (p_sku is null or catalogo.sku_vigente(mi.sku_id) = catalogo.sku_vigente(p_sku)) and (p_ini is null or mi.fecha_neg >= p_ini) and (p_fin is null or mi.fecha_neg <= p_fin)
     order by mi.id desc limit greatest(p_limite, 1)) x;
  select coalesce(e.valor_cent, 0) into v_via1 from (select 1) z left join operacion.existencia_modelo e on e.modelo_id = p_modelo;
  select coalesce(sum(mi.valor_cent), 0) into v_via2 from operacion.movimiento_inventario mi where mi.modelo_id = p_modelo;
  return jsonb_build_object('modelo', v_mod, 'apertura', v_ap, 'movimientos', v_filas, 'total', v_total, 'truncado', v_total > greatest(p_limite, 1),
    'sabores', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'sabor', sa.nombre_canonico) order by sa.nombre_canonico)
                           from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = p_modelo and k.unificado_en is null and exists (select 1 from operacion.existencia_sku_ubicacion x where catalogo.sku_vigente(x.sku_id) = k.id)), '[]'::jsonb),
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico) order by ma.nombre, m.nombre_canonico)
                           from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where exists (select 1 from operacion.movimiento_inventario z where z.modelo_id = m.id)), '[]'::jsonb),
    'comprobacion', jsonb_build_object('via1', 'Valor del modelo en el kardex', 'via1_valor_cent', v_via1, 'via2', 'Entradas menos salidas del libro de movimientos', 'via2_valor_cent', v_via2, 'cuadra', v_via1 = v_via2));
end $function$;

CREATE OR REPLACE FUNCTION api.inventario_kardex_consolidado(p_marca text DEFAULT NULL::text, p_modelo bigint DEFAULT NULL::bigint, p_sku bigint DEFAULT NULL::bigint, p_ini date DEFAULT NULL::date, p_fin date DEFAULT NULL::date, p_tipo text DEFAULT NULL::text, p_q text DEFAULT NULL::text, p_limite integer DEFAULT 200, p_desplazamiento integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lim int := greatest(least(coalesce(p_limite, 200), 1000), 1); v_off int := greatest(coalesce(p_desplazamiento, 0), 0);
  v_q text := nullif(btrim(coalesce(p_q, '')), ''); v_sku_mod bigint; v_hoy date := negocio.hoy();
  v_mods bigint[]; v_f bigint[];
  v_ini_p bigint := 0; v_ini_v bigint := 0; v_fin_p bigint := 0; v_fin_v bigint := 0;
  v_tot jsonb; v_filas jsonb; v_tipos jsonb; v_sem jsonb; v_costos jsonb; v_via1 bigint; v_via2 bigint; v_sabor jsonb; v_modelos jsonb; v_marcas jsonb; v_total int;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_tipo is not null and p_tipo not in ('entrada_compra', 'salida_pedido', 'salida_toma_omar', 'devolucion', 'merma', 'ajuste_conteo', 'traspaso_puente', 'reversa') then
    raise exception 'tipo de movimiento desconocido' using errcode = '22023';
  end if;
  if p_sku is not null then select k.modelo_id into v_sku_mod from catalogo.sku k where k.id = p_sku; end if;

  select coalesce(array_agg(m.id), '{}') into v_mods from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id
   where (p_marca is null or ma.nombre = p_marca) and (p_modelo is null or m.id = p_modelo) and (p_sku is null or m.id = v_sku_mod)
     and exists (select 1 from operacion.movimiento_inventario z where z.modelo_id = m.id);

  -- Existencia inicial (ultimo movimiento anterior al periodo) y final (ultimo movimiento hasta el fin): del sabor o de los modelos elegidos.
  if p_sku is null then
    select coalesce(sum(x.p), 0), coalesce(sum(x.v), 0) into v_ini_p, v_ini_v from unnest(v_mods) g(mid)
      cross join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi
                           where p_ini is not null and mi.modelo_id = g.mid and mi.fecha_neg < p_ini order by mi.id desc limit 1) x;
    select coalesce(sum(x.p), 0), coalesce(sum(x.v), 0) into v_fin_p, v_fin_v from unnest(v_mods) g(mid)
      cross join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi
                           where mi.modelo_id = g.mid and (p_fin is null or mi.fecha_neg <= p_fin) order by mi.id desc limit 1) x;
  elsif v_sku_mod is not null then
    select coalesce(s.p, 0), case when m.p > 0 then negocio.redondear_medio_arriba(m.v * coalesce(s.p, 0), m.p) else 0 end into v_ini_p, v_ini_v
      from (select 1) z
      left join lateral (select sum(q.p) as p from (select (select mi.piezas_sku_despues from operacion.movimiento_inventario mi where p_ini is not null and mi.sku_id = g and mi.fecha_neg < p_ini order by mi.id desc limit 1) as p from catalogo.skus_del_grupo(p_sku) g) q) s on true
      left join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi where p_ini is not null and mi.modelo_id = v_sku_mod and mi.fecha_neg < p_ini order by mi.id desc limit 1) m on true;
    select coalesce(s.p, 0), case when m.p > 0 then negocio.redondear_medio_arriba(m.v * coalesce(s.p, 0), m.p) else 0 end into v_fin_p, v_fin_v
      from (select 1) z
      left join lateral (select sum(q.p) as p from (select (select mi.piezas_sku_despues from operacion.movimiento_inventario mi where mi.sku_id = g and (p_fin is null or mi.fecha_neg <= p_fin) order by mi.id desc limit 1) as p from catalogo.skus_del_grupo(p_sku) g) q) s on true
      left join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi where mi.modelo_id = v_sku_mod and (p_fin is null or mi.fecha_neg <= p_fin) order by mi.id desc limit 1) m on true;
  end if;

  select coalesce(array_agg(mi.id), '{}') into v_f
    from operacion.movimiento_inventario mi join unnest(v_mods) g(mid) on g.mid = mi.modelo_id
      join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.modelo mo on mo.id = mi.modelo_id join operacion.evento e on e.id = mi.evento_id
     where (p_sku is null or catalogo.sku_vigente(mi.sku_id) = catalogo.sku_vigente(p_sku)) and (p_ini is null or mi.fecha_neg >= p_ini) and (p_fin is null or mi.fecha_neg <= p_fin) and (p_tipo is null or mi.tipo = p_tipo)
       and (v_q is null or sa.nombre_canonico ilike '%' || v_q || '%' or mo.nombre_canonico ilike '%' || v_q || '%' or e.folio ilike '%' || v_q || '%' or coalesce(e.mensaje_origen, '') ilike '%' || v_q || '%' or coalesce(mi.nota, '') ilike '%' || v_q || '%');
  v_total := coalesce(array_length(v_f, 1), 0);

  select jsonb_build_object('n', count(*), 'entradas_piezas', coalesce(sum(mi.cantidad) filter (where mi.cantidad > 0), 0), 'entradas_valor_cent', coalesce(sum(mi.valor_cent) filter (where mi.cantidad > 0), 0),
                            'salidas_piezas', coalesce(-sum(mi.cantidad) filter (where mi.cantidad < 0), 0), 'salidas_valor_cent', coalesce(-sum(mi.valor_cent) filter (where mi.cantidad < 0), 0))
    into v_tot from operacion.movimiento_inventario mi join unnest(v_f) f(id) on f.id = mi.id;

  select coalesce(jsonb_agg(jsonb_build_object('tipo', t.tipo, 'n', t.n, 'piezas', t.piezas, 'valor_cent', t.valor) order by t.piezas desc, t.tipo), '[]'::jsonb) into v_tipos
    from (select mi.tipo, count(*)::int as n, sum(abs(mi.cantidad))::bigint as piezas, sum(abs(mi.valor_cent))::bigint as valor
            from operacion.movimiento_inventario mi join unnest(v_f) f(id) on f.id = mi.id group by mi.tipo) t;

  select coalesce(jsonb_agg(w.j order by w.semana), '[]'::jsonb) into v_sem from (
    select s.semana, jsonb_build_object('semana', s.semana, 'entradas_piezas', s.ep, 'salidas_piezas', s.sp, 'entradas_valor_cent', s.ev, 'salidas_valor_cent', s.sv) as j
      from (select date_trunc('week', mi.fecha_neg)::date as semana, coalesce(sum(mi.cantidad) filter (where mi.cantidad > 0), 0)::bigint as ep, coalesce(-sum(mi.cantidad) filter (where mi.cantidad < 0), 0)::bigint as sp,
                   coalesce(sum(mi.valor_cent) filter (where mi.cantidad > 0), 0)::bigint as ev, coalesce(-sum(mi.valor_cent) filter (where mi.cantidad < 0), 0)::bigint as sv
              from operacion.movimiento_inventario mi join unnest(v_f) f(id) on f.id = mi.id group by 1 order by 1 desc limit 104) s) w;

  select coalesce(jsonb_agg(c.j order by c.id), '[]'::jsonb) into v_costos from (
    select mi.id, jsonb_build_object('fecha_neg', mi.fecha_neg, 'unit_cent', mi.costo_unit_aplicado_cent,
             'costo_prom_cent', case when mi.piezas_modelo_despues > 0 then negocio.redondear_medio_arriba(mi.valor_modelo_despues_cent, mi.piezas_modelo_despues) end) as j
      from operacion.movimiento_inventario mi join unnest(v_f) f(id) on f.id = mi.id where mi.tipo = 'entrada_compra' order by mi.id desc limit 60) c;

  select coalesce(jsonb_agg(x.j order by x.id), '[]'::jsonb) into v_filas from (
    select mi.id, jsonb_build_object(
        'id', mi.id, 'hora', mi.hora, 'fecha_neg', mi.fecha_neg, 'tipo', mi.tipo, 'marca', ma.nombre, 'modelo', mo.nombre_canonico, 'modelo_id', mo.id, 'sabor', sa.nombre_canonico, 'sku_id', mi.sku_id,
        'referencia', coalesce(
          case mi.tipo
            when 'entrada_compra' then (select co.folio from operacion.lote lo join operacion.compra_linea cl on cl.id = lo.compra_linea_id join operacion.compra co on co.id = cl.compra_id where lo.id = mi.lote_id)
            when 'salida_pedido' then (select pe.folio from operacion.pedido_surtido ps join operacion.pedido_linea pl on pl.id = ps.pedido_linea_id join operacion.pedido pe on pe.id = pl.pedido_id where ps.movimiento_id = mi.id limit 1)
            when 'salida_toma_omar' then (select t.folio from operacion.toma_omar t where t.movimiento_id = mi.id)
          end, e.folio),
        'entra_piezas', case when mi.cantidad > 0 then mi.cantidad end, 'entra_unit_cent', case when mi.cantidad > 0 then mi.costo_unit_aplicado_cent end, 'entra_total_cent', case when mi.cantidad > 0 then mi.valor_cent end,
        'sale_piezas', case when mi.cantidad < 0 then -mi.cantidad end, 'sale_unit_cent', case when mi.cantidad < 0 then mi.costo_unit_aplicado_cent end, 'sale_total_cent', case when mi.cantidad < 0 then -mi.valor_cent end,
        'saldo_piezas', mi.piezas_modelo_despues, 'saldo_valor_cent', mi.valor_modelo_despues_cent,
        'costo_prom_cent', case when mi.piezas_modelo_despues > 0 then negocio.redondear_medio_arriba(mi.valor_modelo_despues_cent, mi.piezas_modelo_despues) end,
        'saldo_sabor_piezas', mi.piezas_sku_despues,
        'saldo_sabor_valor_cent', case when mi.piezas_modelo_despues > 0 then negocio.redondear_medio_arriba(mi.valor_modelo_despues_cent * mi.piezas_sku_despues, mi.piezas_modelo_despues) end,
        'evento', e.folio, 'canal', e.canal, 'mensaje_origen', e.mensaje_origen,
        'autor', (select coalesce(u.socio_nombre, u.rol) from seguridad.usuario u where u.id = e.actor_id), 'reversa_de', mi.reversa_de, 'es_reversa', mi.tipo = 'reversa', 'nota', mi.nota) as j
      from operacion.movimiento_inventario mi join unnest(v_f) f(id) on f.id = mi.id join operacion.evento e on e.id = mi.evento_id join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id
      join catalogo.modelo mo on mo.id = mi.modelo_id join catalogo.marca ma on ma.id = mo.marca_id
     order by mi.id limit v_lim offset v_off) x;

  select coalesce(sum(e.valor_cent), 0) into v_via1 from unnest(v_mods) g(mid) left join operacion.existencia_modelo e on e.modelo_id = g.mid;
  select coalesce(sum(mi.valor_cent), 0) into v_via2 from operacion.movimiento_inventario mi join unnest(v_mods) g(mid) on g.mid = mi.modelo_id;

  if p_sku is not null then
    select jsonb_build_object('sku_id', k.id, 'sabor', sa.nombre_canonico, 'modelo_id', mo.id, 'modelo', mo.nombre_canonico, 'marca', ma.nombre,
        'piezas', coalesce((select sum(u.piezas) from operacion.existencia_sku_ubicacion u where u.sku_id in (select catalogo.skus_del_grupo(k.id))), 0),
        'piezas_modelo', coalesce((select e.piezas from operacion.existencia_modelo e where e.modelo_id = mo.id), 0),
        'valor_modelo_cent', coalesce((select e.valor_cent from operacion.existencia_modelo e where e.modelo_id = mo.id), 0),
        'ultima_entrada', (select max(mi.fecha_neg) from operacion.movimiento_inventario mi where mi.sku_id in (select catalogo.skus_del_grupo(k.id)) and mi.cantidad > 0 and mi.tipo = 'entrada_compra'),
        'ultima_salida', (select max(mi.fecha_neg) from operacion.movimiento_inventario mi where mi.sku_id in (select catalogo.skus_del_grupo(k.id)) and mi.tipo in ('salida_pedido', 'salida_toma_omar')),
        'cobertura_dias', (select round(c.dias, 1) from operacion.cobertura(v_hoy) c where c.nivel = 'sku' and c.sku_id = k.id),
        'estado', (select c.estado from operacion.cobertura(v_hoy) c where c.nivel = 'sku' and c.sku_id = k.id))
      into v_sabor
      from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.modelo mo on mo.id = k.modelo_id join catalogo.marca ma on ma.id = mo.marca_id where k.id = catalogo.sku_vigente(p_sku);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico) order by ma.nombre, m.nombre_canonico), '[]'::jsonb) into v_modelos
    from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where exists (select 1 from operacion.movimiento_inventario z where z.modelo_id = m.id);
  select coalesce(jsonb_agg(x.nombre order by x.nombre), '[]'::jsonb) into v_marcas
    from (select distinct ma.nombre from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where exists (select 1 from operacion.movimiento_inventario z where z.modelo_id = m.id)) x;

  return jsonb_build_object(
    'inicial', jsonb_build_object('piezas', v_ini_p, 'valor_cent', v_ini_v, 'costo_prom_cent', case when v_ini_p > 0 and p_sku is null then negocio.redondear_medio_arriba(v_ini_v, v_ini_p) end),
    'final', jsonb_build_object('piezas', v_fin_p, 'valor_cent', v_fin_v, 'costo_prom_cent', case when v_fin_p > 0 and p_sku is null then negocio.redondear_medio_arriba(v_fin_v, v_fin_p) end),
    'totales', v_tot, 'por_tipo', v_tipos, 'semanas', v_sem, 'entradas_costo', v_costos, 'movimientos', v_filas, 'total', v_total, 'limite', v_lim, 'desplazamiento', v_off,
    'sabor', v_sabor, 'modelos', v_modelos, 'marcas', v_marcas,
    'comprobacion', jsonb_build_object('via1', 'Valor de los modelos en existencia', 'via1_valor_cent', v_via1, 'via2', 'Entradas menos salidas del libro de movimientos', 'via2_valor_cent', v_via2, 'cuadra', v_via1 = v_via2),
    'cuadre_periodo', jsonb_build_object('esperado_piezas', v_ini_p + (v_tot ->> 'entradas_piezas')::bigint - (v_tot ->> 'salidas_piezas')::bigint, 'final_piezas', v_fin_p,
                                          'aplica', p_tipo is null and v_q is null));
end $function$;

CREATE OR REPLACE FUNCTION operacion.resolver_sku(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_sku bigint; v_modelo bigint; v_pedido bigint; v_vigente bigint;
begin
  if p ? 'sku_id' then
    -- Un sku fusionado por una unificacion de sabores es historia: se redirige de forma transparente al sku vigente (sku.unificado_en).
    v_pedido := (p->>'sku_id')::bigint;
    select s.id, s.modelo_id into v_sku, v_modelo from catalogo.sku s where s.id = catalogo.sku_vigente(v_pedido);
  else
    -- El nombre resuelve por nombre propio o por alias dejado por una unificacion ('Passionfruit' -> 'Passion Fruit').
    select s.id, s.modelo_id into v_sku, v_modelo from catalogo.sku s join catalogo.modelo m on m.id = s.modelo_id
      where m.nombre_norm = catalogo.normalizar(p->>'modelo') and s.sabor_id = catalogo.sabor_por_nombre(p->>'sabor') and s.unificado_en is null;
  end if;
  if v_sku is null then raise exception 'SKU desconocido en el renglon' using errcode = '22023'; end if;
  return jsonb_build_object('sku_id', v_sku, 'modelo_id', v_modelo) || case when v_pedido is not null and v_pedido <> v_sku then jsonb_build_object('redirigido_de', v_pedido) else '{}'::jsonb end;
end $function$;;

CREATE OR REPLACE FUNCTION operacion.registrar_movimiento(p_clave_idem text, p_modelo text, p_sabor text, p_ubicacion text, p_tipo text, p_cantidad integer, p_valor_cent bigint DEFAULT NULL::bigint, p_fecha date DEFAULT NULL::date, p_origen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_prev jsonb; v_sku bigint; v_modelo bigint; v_ev bigint; v_mov operacion.movimiento_inventario; v_res jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy());
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_movimiento', 'm', p_modelo, 's', p_sabor, 'u', p_ubicacion, 't', p_tipo, 'c', p_cantidad, 'v', p_valor_cent, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  if p_tipo = 'reversa' then raise exception 'las reversas se hacen con reversar_evento' using errcode = '22023'; end if;
  select s.id, s.modelo_id into v_sku, v_modelo from catalogo.sku s join catalogo.modelo m on m.id = s.modelo_id 
    where m.nombre_norm = catalogo.normalizar(p_modelo) and s.sabor_id = catalogo.sabor_por_nombre(p_sabor) and s.unificado_en is null;
  if v_sku is null then raise exception 'SKU desconocido (modelo/sabor)' using errcode = '22023'; end if;
  perform catalogo.auditar_alias_sabor(p_sabor, v_sku, 'registrar_movimiento');
  v_ev := operacion.crear_evento('movimiento_' || p_tipo, v_fecha, p_clave_idem, jsonb_build_object('modelo', p_modelo, 'sabor', p_sabor, 'cantidad', p_cantidad), p_origen);
  insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
    values (v_fecha, v_sku, v_modelo, p_ubicacion, p_tipo, p_cantidad, p_valor_cent, v_ev) returning * into v_mov;
  v_res := jsonb_build_object('evento_id', v_ev, 'movimiento_id', v_mov.id, 'piezas_modelo', v_mov.piezas_modelo_despues, 'valor_modelo_cent', v_mov.valor_modelo_despues_cent, 'valor_cent', v_mov.valor_cent);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION operacion.cerrar_conteo(p_clave_idem text, p_conteo_id bigint, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; c operacion.conteo; l record; v_res jsonb; v_ev bigint; v_lin bigint; v_mov bigint;
  g record; v_e int; v_v bigint; v_neto int; v_pos_total int; v_valor_neto bigint; v_val_pos_acum bigint; v_pos_hecho int; v_ajustes int := 0; v_val bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_conteo', 'c', p_conteo_id, 'l', p_lineas));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.conteo where id = p_conteo_id for update;
  if not found or c.estado <> 'abierto' then raise exception 'conteo inexistente o ya cerrado' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('conteo_cerrado', negocio.fecha_neg(c.contado_at), p_clave_idem, jsonb_build_object('conteo', c.id));

  create temporary table if not exists _conteo_tmp (modelo_id bigint, sku_id bigint, contado int, esperado int, expl_tipo text, expl_ref text) on commit drop;
  delete from _conteo_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _conteo_tmp
  select s.modelo_id, s.id, (x->>'contado')::int, coalesce(u.piezas, 0), x->>'explicacion_tipo', x->>'explicacion_ref'
  from jsonb_array_elements(p_lineas) x
  join catalogo.modelo m on m.nombre_norm = catalogo.normalizar(x->>'modelo')
  join catalogo.sabor sa on sa.id = catalogo.sabor_por_nombre(x->>'sabor')
  join catalogo.sku s on s.modelo_id = m.id and s.sabor_id = sa.id and s.unificado_en is null
  left join operacion.existencia_sku_ubicacion u on u.sku_id = s.id and u.ubicacion = c.ubicacion;
  if (select count(*) from _conteo_tmp) <> jsonb_array_length(p_lineas) then raise exception 'linea de conteo con SKU desconocido' using errcode = '22023'; end if;

  for g in select distinct modelo_id from _conteo_tmp order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(g.modelo_id::text, 0));
    select coalesce(e.piezas, 0), coalesce(e.valor_cent, 0) into v_e, v_v from (select 1) x left join operacion.existencia_modelo e on e.modelo_id = g.modelo_id;
    select coalesce(sum(contado - esperado), 0), coalesce(sum(greatest(contado - esperado, 0)), 0) into v_neto, v_pos_total from _conteo_tmp where modelo_id = g.modelo_id;
    -- Valor neto del ajuste (con signo) al costo promedio de las piezas netas.
    v_valor_neto := case when v_neto = 0 then 0 when v_neto < 0 then -(case when -v_neto = v_e then v_v else negocio.redondear_medio_arriba(v_v * (-v_neto), greatest(v_e, 1)) end)
                         else negocio.redondear_medio_arriba(v_v * v_neto, greatest(v_e, 1)) end;
    -- Salidas primero: cada una al costo promedio de la existencia ANTES del cierre; luego las entradas.
    v_val_pos_acum := 0; v_pos_hecho := 0;
    declare v_sal_total bigint := 0; v_sal_pzs int := 0; v_sal_hecho int := 0; v_sal_acum bigint := 0;
    begin
      for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado < esperado order by sku_id loop
        v_val := case when v_e = 0 then 0 else negocio.redondear_medio_arriba(v_v * (l.esperado - l.contado), v_e) end;
        v_sal_total := v_sal_total + v_val; v_sal_pzs := v_sal_pzs + (l.esperado - l.contado);
      end loop;
      -- Valor total de las salidas = el de las piezas que salen; el de las entradas = salidas + valor neto (con signo): se reparte sin residuo.
      if v_sal_pzs > 0 then v_sal_total := case when v_sal_pzs = v_e then v_v else v_sal_total end; end if;
      for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado < esperado order by sku_id loop
        -- La ultima salida de un modelo que se vacia toma el residuo exacto: la suma de las salidas es el valor completo de la existencia (sin centavos sueltos por redondeo).
        v_sal_hecho := v_sal_hecho + (l.esperado - l.contado);
        v_val := case when v_e = 0 then 0 when v_sal_hecho = v_e then v_v - v_sal_acum else negocio.redondear_medio_arriba(v_v * (l.esperado - l.contado), v_e) end;
        v_sal_acum := v_sal_acum + v_val;
        insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
          values (negocio.fecha_neg(c.contado_at), c.contado_at, l.sku_id, g.modelo_id, c.ubicacion, 'ajuste_conteo', l.contado - l.esperado, -v_val, v_ev) returning id into v_mov;
        update _conteo_tmp set expl_ref = coalesce(expl_ref, '') where sku_id = l.sku_id;
        insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref, movimiento_ajuste_id)
          values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''), v_mov);
        v_ajustes := v_ajustes + 1;
      end loop;
      declare v_total_entradas bigint := v_sal_total + v_valor_neto;
      begin
        for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado > esperado order by sku_id loop
          v_pos_hecho := v_pos_hecho + (l.contado - l.esperado);
          v_val := case when v_pos_hecho = v_pos_total then v_total_entradas - v_val_pos_acum
                        else negocio.redondear_medio_arriba(v_total_entradas * (l.contado - l.esperado), v_pos_total) end;
          v_val_pos_acum := v_val_pos_acum + v_val;
          insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
            values (negocio.fecha_neg(c.contado_at), c.contado_at, l.sku_id, g.modelo_id, c.ubicacion, 'ajuste_conteo', l.contado - l.esperado, v_val, v_ev) returning id into v_mov;
          insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref, movimiento_ajuste_id)
            values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''), v_mov);
          v_ajustes := v_ajustes + 1;
        end loop;
      end;
    end;
  end loop;
  -- Lineas sin diferencia: se guardan sin movimiento.
  for l in select * from _conteo_tmp t where contado = esperado loop
    insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref)
      values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''));
  end loop;
  update operacion.conteo set estado = 'cerrado', evento_id = v_ev where id = c.id;
  v_res := jsonb_build_object('conteo_id', c.id, 'evento_id', v_ev, 'ajustes', v_ajustes);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION operacion.conteo_diferencias(p_ubicacion text, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_filas jsonb; v_abs bigint; v_esp bigint; v_dif int; v_bp int;
begin
  with c as (select catalogo.sku_vigente((x ->> 'sku_id')::bigint) as sku_id, (x ->> 'contado')::int as contado from jsonb_array_elements(p_lineas) x),
  d as (
    select c.sku_id, c.contado, coalesce(u.piezas, 0) as esperado,
           coalesce((select sum(r.piezas) from operacion.reserva r where r.sku_id = c.sku_id and r.estado = 'activa'), 0)::int as res
      from c left join operacion.existencia_sku_ubicacion u on u.sku_id = c.sku_id and u.ubicacion = p_ubicacion)
  select coalesce(jsonb_agg(jsonb_build_object('sku_id', d.sku_id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'esperado', d.esperado, 'vendido_por_recoger', d.res,
           'disponible_sistema', d.esperado - d.res, 'contado', d.contado, 'diferencia', d.contado - d.esperado) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico), '[]'::jsonb),
         coalesce(sum(abs(d.contado - d.esperado)), 0), coalesce(sum(d.esperado), 0), count(*) filter (where d.contado <> d.esperado)
    into v_filas, v_abs, v_esp, v_dif
    from d join catalogo.sku k on k.id = d.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id;
  v_bp := case when v_esp > 0 then greatest(10000 - negocio.redondear_medio_arriba(10000 * v_abs, v_esp), 0)::int end;
  return jsonb_build_object('lineas', v_filas, 'con_diferencia', v_dif, 'piezas_diferencia', v_abs, 'piezas_esperadas', v_esp, 'exactitud_bp', v_bp);
end $function$;

CREATE OR REPLACE FUNCTION operacion.enviar_pedido(p_clave_idem text, p_pedido bigint, p_surtido jsonb DEFAULT NULL::jsonb, p_guia jsonb DEFAULT NULL::jsonb, p_fecha date DEFAULT NULL::date, p_aceptar_avisos boolean DEFAULT false, p_falta_tipo text DEFAULT 'entrega_diferida'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; ped operacion.pedido; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_pend int; ln record; s record; v_mov bigint; v_valor bigint; v_costo bigint;
  v_total int; v_renta_pz bigint; v_sumpz int; v_sumcosto bigint; v_renta bigint; v_nota jsonb; v_nota_id bigint; v_apl bigint; v_guia_id bigint; v_res jsonb; v_cli text;
  v_n_aceptados int := 0; v_pieza_no_llego_con_pago boolean := false; v_es_bodega boolean; v_texto text; v_envio_aviso boolean := false;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'enviar_pedido', 'p', p_pedido, 's', p_surtido, 'g', p_guia, 'f', p_fecha, 'a', p_aceptar_avisos, 't', p_falta_tipo));
  if v_prev is not null then return v_prev; end if;
  if p_falta_tipo not in ('entrega_diferida', 'pieza_no_llego') then raise exception 'tipo de faltante invalido' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'confirmado' then raise exception 'el pedido % esta %: solo uno confirmado se envia', ped.folio, ped.estado using errcode = 'P0428'; end if;
  v_es_bodega := operacion.origen_es_bodega(ped.origen);
  -- Avisos sin aceptar: no bloquean, pero exigen "Enviar de todos modos" (queda registrado quien).
  select count(*) into v_pend from operacion.pedido_aviso a where a.pedido_id = ped.id and not exists (select 1 from operacion.pedido_aviso_decision d where d.aviso_id = a.id);
  if v_pend > 0 and not p_aceptar_avisos then
    raise exception 'el pedido % tiene % avisos sin aceptar: usa "Enviar de todos modos"', ped.folio, v_pend using errcode = 'P0427';
  end if;

  create temporary table if not exists _surtido_tmp (linea_id bigint, sku_id bigint, piezas int) on commit drop;
  delete from _surtido_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  perform catalogo.auditar_redirecciones(p_surtido, 'enviar_pedido');
  if p_surtido is null then
    insert into _surtido_tmp select id, sku_id, piezas_pedidas from operacion.pedido_linea where pedido_id = ped.id;
  else
    insert into _surtido_tmp
    select (x->>'linea_id')::bigint, catalogo.sku_vigente(coalesce((x->>'sku_id')::bigint, l.sku_id)), (x->>'piezas')::int
    from jsonb_array_elements(p_surtido) x join operacion.pedido_linea l on l.id = (x->>'linea_id')::bigint and l.pedido_id = ped.id;
    if (select count(*) from _surtido_tmp) <> jsonb_array_length(p_surtido) then raise exception 'un renglon del surtido no pertenece al pedido' using errcode = '22023'; end if;
  end if;
  delete from _surtido_tmp where piezas = 0;
  if exists (select 1 from _surtido_tmp where piezas < 0) then raise exception 'piezas negativas en el surtido' using errcode = '23514'; end if;
  if exists (select 1 from _surtido_tmp t join operacion.pedido_linea l on l.id = t.linea_id join catalogo.sku k on k.id = t.sku_id where k.modelo_id <> l.modelo_id) then
    raise exception 'el sabor surtido debe ser del mismo modelo del renglon' using errcode = '22023';
  end if;
  if exists (select 1 from (select t.linea_id, sum(t.piezas) as pz from _surtido_tmp t group by t.linea_id) q join operacion.pedido_linea l on l.id = q.linea_id where q.pz > l.piezas_pedidas) then
    raise exception 'no se puede surtir mas de lo pedido' using errcode = '23514';
  end if;
  select coalesce(sum(piezas), 0)::int into v_total from _surtido_tmp;
  if v_total = 0 then raise exception 'no hay nada que enviar: marca al menos una pieza surtida' using errcode = '23514'; end if;

  if v_es_bodega then perform operacion.exigir_semana_omar_abierta(v_fecha); end if;
  v_ev := operacion.crear_evento('pedido_enviado', v_fecha, p_clave_idem, jsonb_build_object('pedido', ped.folio, 'piezas', v_total));

  -- Salida por sabor.
  for s in select t.linea_id, t.sku_id, sum(t.piezas)::int as piezas, l.modelo_id from _surtido_tmp t join operacion.pedido_linea l on l.id = t.linea_id group by t.linea_id, t.sku_id, l.modelo_id order by t.linea_id, t.sku_id loop
    if v_es_bodega then
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id) values (v_fecha, s.sku_id, s.modelo_id, 'bodega_omar', 'salida_pedido', -s.piezas, v_ev) returning id, -valor_cent into v_mov, v_valor;
    else
      v_costo := operacion.costo_ref_pedido(ped.origen, s.modelo_id, v_fecha);
      if v_costo is null then raise exception 'no hay costo vigente del proveedor de origen para el modelo' using errcode = '23502'; end if;
      v_mov := null; v_valor := v_costo * s.piezas;
    end if;
    insert into operacion.pedido_surtido (pedido_linea_id, sku_id, piezas, costo_valor_cent, movimiento_id, evento_id) values (s.linea_id, s.sku_id, s.piezas, v_valor, v_mov, v_ev);
  end loop;

  -- Linea: surtido, costo y renta (T4/T5). La renta solo corre si sale de la bodega; en directos de Isaac o Karen es 0.
  v_renta_pz := coalesce((catalogo.config_valor('renta_por_pieza_cent', v_fecha))::text::bigint, 0);
  v_renta := 0;
  for ln in select l.id from operacion.pedido_linea l where l.pedido_id = ped.id order by l.id loop
    select coalesce(sum(piezas), 0), coalesce(sum(costo_valor_cent), 0) into v_sumpz, v_sumcosto from operacion.pedido_surtido where pedido_linea_id = ln.id;
    update operacion.pedido_linea set piezas_surtidas = v_sumpz, costo_unit_cent = case when v_sumpz > 0 then negocio.redondear_medio_arriba(v_sumcosto, v_sumpz) end,
           renta_cent = case when v_es_bodega then v_renta_pz * v_sumpz else 0 end, fecha_salida = v_fecha where id = ln.id;
    if v_es_bodega and v_sumpz > 0 and v_renta_pz > 0 then
      perform operacion.devengar_renta(ln.id, v_sumpz, v_renta_pz * v_sumpz, v_fecha, v_ev);
      v_renta := v_renta + v_renta_pz * v_sumpz;
    end if;
    -- Lo no surtido: entrega diferida o pieza que no llego (saldo a favor del cliente si ya pago).
    if v_sumpz < (select piezas_pedidas from operacion.pedido_linea where id = ln.id) then
      insert into operacion.pedido_ajuste (pedido_id, tipo, sku_id, piezas, evento_id)
        select ped.id, p_falta_tipo, l.sku_id, l.piezas_pedidas - v_sumpz, v_ev from operacion.pedido_linea l where l.id = ln.id;
      if p_falta_tipo = 'pieza_no_llego' and operacion.saldo_favor_cliente(ped.cliente_id) > 0 then v_pieza_no_llego_con_pago := true; end if;
    end if;
  end loop;

  -- Cargos del pedido (solo si algo salio).
  if ped.envio_cent > 0 then insert into operacion.pedido_cargo (pedido_id, concepto, monto_cent, evento_id) values (ped.id, 'envio_cobrado', ped.envio_cent, v_ev); end if;
  if ped.recargo_cent > 0 then insert into operacion.pedido_cargo (pedido_id, concepto, monto_cent, evento_id) values (ped.id, 'recargo_credito', ped.recargo_cent, v_ev); end if;
  if ped.descuento_cent > 0 then insert into operacion.pedido_cargo (pedido_id, concepto, monto_cent, evento_id) values (ped.id, 'descuento', -ped.descuento_cent, v_ev); end if;

  update operacion.reserva set estado = case when estado = 'activa' then 'aplicada' else estado end, resuelta_at = now() where origen_tipo = 'pedido' and origen_id = ped.id and estado = 'activa';

  -- Aceptacion de avisos.
  if v_pend > 0 then
    insert into operacion.pedido_aviso_decision (aviso_id, decidido_por, decidido_por_nombre, evento_id)
      select a.id, auth.uid(), (select s2.nombre from catalogo.socio s2 where s2.id = operacion.actor_socio()), v_ev
      from operacion.pedido_aviso a where a.pedido_id = ped.id and not exists (select 1 from operacion.pedido_aviso_decision d where d.aviso_id = a.id);
    get diagnostics v_n_aceptados = row_count;
  end if;

  -- Guia de salida.
  if p_guia is not null then
    insert into operacion.guia (sentido, paqueteria, numero, pedido_id, fecha_neg, evento_id) values ('salida', p_guia->>'paqueteria', p_guia->>'numero', ped.id, v_fecha, v_ev) returning id into v_guia_id;
    if p_guia ? 'costo_cent' and (p_guia->>'costo_cent') is not null then perform operacion.costear_guia(v_guia_id, (p_guia->>'costo_cent')::bigint, p_guia->>'pagada_por', v_ev); end if;
  end if;

  update operacion.pedido set estado = 'enviado', enviado_at = now(), fecha_envio = v_fecha, evento_envio_id = v_ev, paqueteria = coalesce(p_guia->>'paqueteria', paqueteria) where id = ped.id;

  -- Nota v1 (inmutable) y sus textos guardados.
  v_nota := operacion.armar_nota(ped.id, '{}'::jsonb);
  v_texto := operacion.texto_nota(v_nota->'cliente');
  insert into operacion.nota (pedido_id, folio_documento, tipo, texto_whatsapp, snapshot_cliente, snapshot_interno, total_cent, emitida_por, evento_id)
    values (ped.id, ped.folio, 'original', v_texto, v_nota->'cliente', v_nota->'interno', (v_nota->>'total_cent')::bigint, auth.uid(), v_ev) returning id into v_nota_id;
  insert into operacion.nota_documento (nota_id, variante, sha256, contenido) values (v_nota_id, 'cliente_texto', encode(sha256(convert_to(v_texto, 'UTF8')), 'hex'), convert_to(v_texto, 'UTF8'));

  -- El saldo a favor del cliente (anticipos, piezas que no llegaron) se aplica a este pedido.
  v_apl := operacion.aplicar_fifo(ped.cliente_id, v_ev);

  select nombre_canonico into v_cli from catalogo.cliente where id = ped.cliente_id;
  perform operacion.avisar('paquete_enviado_con_guia', 'NT-012', 'paquete_enviado:' || ped.id, 'F',
    'Paquete enviado: ' || ped.folio || coalesce(' con guia ' || (p_guia->>'numero'), ''), 'pedido', ped.id, jsonb_build_object('folio', ped.folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  perform operacion.resolver_avisos('paquete_por_empacar', 'pedido', ped.id);
  perform operacion.resolver_avisos('sabor_faltante_antes_empacar', 'pedido', ped.id);
  if v_n_aceptados > 0 and exists (select 1 from operacion.pedido_aviso where pedido_id = ped.id and codigo in ('precio_distinto_tabulador', 'venta_bajo_costo', 'sin_precio_catalogo')) then
    perform operacion.avisar('pedido_enviado_con_excepcion', 'NT-006', 'envio_excepcion:' || ped.id, 'I', 'Pedido ' || ped.folio || ' enviado aceptando avisos', 'pedido', ped.id,
      jsonb_build_object('folio', ped.folio, 'avisos', v_n_aceptados), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  end if;
  if v_pieza_no_llego_con_pago then
    perform operacion.avisar('pieza_no_llego_saldo', 'NT-007', 'pieza_no_llego:' || ped.id, 'I', 'Pieza que no llego en ' || ped.folio || ' con pago previo: saldo a favor del cliente', 'pedido', ped.id,
      jsonb_build_object('folio', ped.folio), ped.duenio_id, v_ev, false, array['software', 'telegram']);
  end if;

  v_res := jsonb_build_object('pedido_id', ped.id, 'folio', ped.folio, 'nota_id', v_nota_id, 'total_cent', (v_nota->>'total_cent')::bigint, 'piezas_surtidas', v_total, 'renta_cent', v_renta,
                              'texto_whatsapp', v_texto, 'aplicado_cent', v_apl, 'avisos_aceptados', v_n_aceptados);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION operacion.recibir_compra(p_clave_idem text, p_compra bigint, p_recibido jsonb, p_contado_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; c operacion.compra; v_ev bigint; v_at timestamptz := coalesce(p_contado_at, now()); v_fecha date; ln operacion.compra_linea; v_recib int; v_fact_total int;
  v_guia bigint; v_seguro bigint; v_guia_acum bigint := 0; v_seguro_acum bigint := 0; v_i int := 0; v_n_lineas int; v_merc bigint; v_puesto bigint; v_entrada bigint;
  v_lote bigint; rr record; v_acum bigint; v_val bigint; v_hecho int; v_mov bigint; v_dif bigint; v_ndif int := 0; v_res jsonb; v_total_recibido int := 0; v_valor_dif bigint := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'recibir_compra', 'c', p_compra, 'r', p_recibido, 'a', p_contado_at));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida') then raise exception 'la compra % esta %: no se puede recibir', c.folio, c.estado using errcode = 'P0428'; end if;
  if c.destino <> 'bodega' then raise exception 'una compra directa al cliente no entra al inventario' using errcode = 'P0428'; end if;
  if jsonb_typeof(p_recibido) <> 'array' then raise exception 'recepcion invalida' using errcode = '22023'; end if;
  v_fecha := negocio.fecha_neg(v_at);
  v_ev := operacion.crear_evento('compra_recibida', v_fecha, p_clave_idem, jsonb_build_object('compra', c.folio));

  create temporary table if not exists _recepcion_tmp (linea_id bigint, sku_id bigint, piezas int) on commit drop;
  delete from _recepcion_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  perform catalogo.auditar_redirecciones(p_recibido, 'recibir_compra');
  insert into _recepcion_tmp
  select (x->>'linea_id')::bigint,
         case when x ? 'sku_id' then catalogo.sku_vigente((x->>'sku_id')::bigint)
              else (select s.id from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id join operacion.compra_linea cl on cl.modelo_id = s.modelo_id
                    where cl.id = (x->>'linea_id')::bigint and sa.id = catalogo.sabor_por_nombre(x->>'sabor')) end,
         (x->>'piezas')::int
  from jsonb_array_elements(p_recibido) x;
  if exists (select 1 from _recepcion_tmp where sku_id is null or piezas is null or piezas <= 0) then raise exception 'renglon de recepcion invalido (sabor desconocido o piezas no positivas)' using errcode = '22023'; end if;
  if exists (select 1 from _recepcion_tmp t left join operacion.compra_linea l on l.id = t.linea_id and l.compra_id = c.id where l.id is null) then raise exception 'una linea no pertenece a la compra' using errcode = '22023'; end if;
  if exists (select 1 from _recepcion_tmp t join operacion.compra_linea l on l.id = t.linea_id join catalogo.sku s on s.id = t.sku_id where s.modelo_id <> l.modelo_id) then raise exception 'el sabor no corresponde al modelo de la linea' using errcode = '22023'; end if;

  select coalesce(sum(piezas_facturadas), 0), count(*) into v_fact_total, v_n_lineas from operacion.compra_linea where compra_id = c.id;
  for ln in select * from operacion.compra_linea where compra_id = c.id order by id loop
    v_i := v_i + 1;
    select coalesce(sum(piezas), 0) into v_recib from _recepcion_tmp where linea_id = ln.id;
    -- Guia y seguro se prorratean por piezas facturadas; la ultima linea absorbe el residuo.
    if v_i = v_n_lineas then v_guia := c.guia_cent - v_guia_acum; v_seguro := c.seguro_cent - v_seguro_acum;
    else v_guia := negocio.redondear_medio_arriba(c.guia_cent * ln.piezas_facturadas, v_fact_total); v_seguro := negocio.redondear_medio_arriba(c.seguro_cent * ln.piezas_facturadas, v_fact_total); end if;
    v_guia_acum := v_guia_acum + v_guia; v_seguro_acum := v_seguro_acum + v_seguro;
    v_merc := ln.piezas_facturadas * ln.costo_unit_cent;
    v_puesto := v_merc + v_guia + v_seguro;
    -- Valor que entra: el costo puesto de lo facturado en proporcion a lo recibido (exacto cuando coincide).
    v_entrada := case when v_recib = ln.piezas_facturadas then v_puesto else negocio.redondear_medio_arriba(v_puesto * v_recib, ln.piezas_facturadas) end;
    insert into operacion.lote (compra_linea_id, modelo_id, piezas_facturadas, piezas_entrada, costo_mercancia_cent, guia_prorrateada_cent, seguro_prorrateado_cent, valor_entrada_cent)
      values (ln.id, ln.modelo_id, ln.piezas_facturadas, v_recib, v_merc, v_guia, v_seguro, v_entrada) returning id into v_lote;
    -- Entrada por sabor, repartiendo el valor sin residuo.
    v_acum := 0; v_hecho := 0;
    for rr in select sku_id, sum(piezas)::int as piezas from _recepcion_tmp where linea_id = ln.id group by sku_id order by sku_id loop
      v_hecho := v_hecho + rr.piezas;
      v_val := case when v_hecho = v_recib then v_entrada - v_acum else negocio.redondear_medio_arriba(v_entrada * rr.piezas, v_recib) end;
      v_acum := v_acum + v_val;
      insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, lote_id, valor_cent, evento_id)
        values (v_fecha, v_at, rr.sku_id, ln.modelo_id, 'bodega_omar', 'entrada_compra', rr.piezas, v_lote, v_val, v_ev) returning id into v_mov;
      insert into operacion.compra_recepcion (compra_id, compra_linea_id, sku_id, piezas, movimiento_id, contado_at) values (c.id, ln.id, rr.sku_id, rr.piezas, v_mov, v_at);
    end loop;
    update operacion.compra_linea set piezas_recibidas = v_recib where id = ln.id;
    v_total_recibido := v_total_recibido + v_recib;
    if v_recib <> ln.piezas_facturadas then
      insert into operacion.compra_diferencia (compra_id, compra_linea_id, tipo, piezas, valor_cent, evento_id)
        values (c.id, ln.id, case when v_recib < ln.piezas_facturadas then 'faltante' else 'sobrante' end, abs(ln.piezas_facturadas - v_recib), abs(v_puesto - v_entrada), v_ev) returning id into v_dif;
      v_ndif := v_ndif + 1; v_valor_dif := v_valor_dif + abs(v_puesto - v_entrada);
      perform operacion.avisar('diferencia_recepcion_abierta', 'NT-017', 'diferencia_recepcion:' || v_dif, 'I',
        'Recepcion de ' || c.folio || ' con diferencia: ' || abs(ln.piezas_facturadas - v_recib) || ' pz ' || case when v_recib < ln.piezas_facturadas then 'faltantes' else 'sobrantes' end,
        'compra_diferencia', v_dif, jsonb_build_object('folio', c.folio, 'piezas', abs(ln.piezas_facturadas - v_recib)), null, v_ev, false, array['software', 'telegram']);
    end if;
  end loop;
  update operacion.compra set estado = 'recibida', recibida_fecha = v_fecha where id = c.id;
  perform operacion.resolver_avisos('llegada_pendiente_confirmar', 'compra', c.id);
  v_res := jsonb_build_object('compra_id', c.id, 'folio', c.folio, 'piezas_recibidas', v_total_recibido, 'piezas_facturadas', v_fact_total, 'diferencias', v_ndif, 'valor_diferencias_cent', v_valor_dif);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION operacion.recibir_compra_parcial(p_clave_idem text, p_compra bigint, p_recibido jsonb, p_contado_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; c operacion.compra; v_ev bigint; v_at timestamptz := coalesce(p_contado_at, now()); v_fecha date; pl record; rr record; ex record;
  v_recib int; v_cum_antes int; v_cum_despues int; v_n int; v_lote bigint; v_mov bigint; v_valor bigint; v_acum bigint; v_val bigint; v_hecho int;
  v_dm bigint; v_dg bigint; v_ds bigint; v_pm bigint; v_pg bigint; v_ps bigint; v_total_ahora int := 0; v_valor_ahora bigint := 0; v_completa boolean; v_acum_total int; v_fact_total int; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'recibir_compra_parcial', 'c', p_compra, 'r', p_recibido, 'a', p_contado_at));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida', 'recibida_parcial') then raise exception 'la compra % esta %: no se puede recibir', c.folio, c.estado using errcode = 'P0428'; end if;
  if c.destino <> 'bodega' then raise exception 'una compra directa al cliente no entra al inventario' using errcode = 'P0428'; end if;
  if jsonb_typeof(p_recibido) <> 'array' or jsonb_array_length(p_recibido) = 0 then raise exception 'recepcion invalida: indica lo que llego' using errcode = '22023'; end if;
  v_fecha := negocio.fecha_neg(v_at);

  create temporary table if not exists _recep_parcial_tmp (linea_id bigint, sku_id bigint, piezas int) on commit drop;
  delete from _recep_parcial_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  perform catalogo.auditar_redirecciones(p_recibido, 'recibir_compra_parcial');
  insert into _recep_parcial_tmp
  select (x->>'linea_id')::bigint,
         case when x ? 'sku_id' then catalogo.sku_vigente((x->>'sku_id')::bigint)
              else (select s.id from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id join operacion.compra_linea cl on cl.modelo_id = s.modelo_id
                    where cl.id = (x->>'linea_id')::bigint and sa.id = catalogo.sabor_por_nombre(x->>'sabor')) end,
         (x->>'piezas')::int
  from jsonb_array_elements(p_recibido) x;
  if exists (select 1 from _recep_parcial_tmp where sku_id is null or piezas is null or piezas <= 0) then raise exception 'renglon de recepcion invalido (sabor desconocido o piezas no positivas)' using errcode = '22023'; end if;
  if exists (select 1 from _recep_parcial_tmp t left join operacion.compra_linea l on l.id = t.linea_id and l.compra_id = c.id where l.id is null) then raise exception 'una linea no pertenece a la compra' using errcode = '22023'; end if;
  if exists (select 1 from _recep_parcial_tmp t join operacion.compra_linea l on l.id = t.linea_id join catalogo.sku s on s.id = t.sku_id where s.modelo_id <> l.modelo_id) then raise exception 'el sabor no corresponde al modelo de la linea' using errcode = '22023'; end if;
  -- NUEVO: no se recibe mas de lo pedido. Lo ya contado mas esta llegada no puede pasar de lo facturado de la linea.
  select m.nombre_canonico || ' ' || sa.nombre_canonico as renglon, l.piezas_facturadas as facturadas, operacion.recibido_acumulado(l.id) as ya, x.n as ahora into ex
    from (select t.linea_id, sum(t.piezas)::int as n from _recep_parcial_tmp t group by t.linea_id) x
    join operacion.compra_linea l on l.id = x.linea_id join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = l.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
   where operacion.recibido_acumulado(l.id) + x.n > l.piezas_facturadas order by l.id limit 1;
  if found then
    raise exception 'no se recibe mas de lo pedido: % tiene % facturadas, ya llegaron % y esta llegada trae % (pendientes: %)', ex.renglon, ex.facturadas, ex.ya, ex.ahora, greatest(ex.facturadas - ex.ya, 0) using errcode = 'P0435';
  end if;

  v_ev := operacion.crear_evento('compra_recepcion_parcial', v_fecha, p_clave_idem, jsonb_build_object('compra', c.folio));
  for pl in select p.*, l.modelo_id from operacion.puesto_lineas_compra(c.id) p join operacion.compra_linea l on l.id = p.linea_id order by p.linea_id loop
    select coalesce(sum(piezas), 0)::int into v_recib from _recep_parcial_tmp where linea_id = pl.linea_id;
    continue when v_recib = 0;
    v_cum_antes := operacion.recibido_acumulado(pl.linea_id);
    v_cum_despues := v_cum_antes + v_recib;
    -- Parte del costo puesto que corresponde a lo contado en total, menos lo ya reconocido en llegadas anteriores (redondeo acumulado: sin residuo al completar).
    select coalesce(sum(costo_mercancia_cent), 0), coalesce(sum(guia_prorrateada_cent), 0), coalesce(sum(seguro_prorrateado_cent), 0) into v_pm, v_pg, v_ps from operacion.lote where compra_linea_id = pl.linea_id;
    v_dm := negocio.redondear_medio_arriba(pl.mercancia_cent * v_cum_despues, pl.facturadas) - v_pm;
    v_dg := negocio.redondear_medio_arriba(pl.guia_cent * v_cum_despues, pl.facturadas) - v_pg;
    v_ds := negocio.redondear_medio_arriba(pl.seguro_cent * v_cum_despues, pl.facturadas) - v_ps;
    v_valor := v_dm + v_dg + v_ds;
    select coalesce(max(recepcion_n), 0) + 1 into v_n from operacion.lote where compra_linea_id = pl.linea_id;
    insert into operacion.lote (compra_linea_id, modelo_id, piezas_facturadas, piezas_entrada, costo_mercancia_cent, guia_prorrateada_cent, seguro_prorrateado_cent, valor_entrada_cent, recepcion_n)
      values (pl.linea_id, pl.modelo_id, pl.facturadas, v_recib, v_dm, v_dg, v_ds, v_valor, v_n) returning id into v_lote;
    v_acum := 0; v_hecho := 0;
    for rr in select sku_id, sum(piezas)::int as piezas from _recep_parcial_tmp where linea_id = pl.linea_id group by sku_id order by sku_id loop
      v_hecho := v_hecho + rr.piezas;
      v_val := case when v_hecho = v_recib then v_valor - v_acum else negocio.redondear_medio_arriba(v_valor * rr.piezas, v_recib) end;
      v_acum := v_acum + v_val;
      insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, lote_id, valor_cent, evento_id)
        values (v_fecha, v_at, rr.sku_id, pl.modelo_id, 'bodega_omar', 'entrada_compra', rr.piezas, v_lote, v_val, v_ev) returning id into v_mov;
      insert into operacion.compra_recepcion (compra_id, compra_linea_id, sku_id, piezas, movimiento_id, contado_at) values (c.id, pl.linea_id, rr.sku_id, rr.piezas, v_mov, v_at);
    end loop;
    v_total_ahora := v_total_ahora + v_recib; v_valor_ahora := v_valor_ahora + v_valor;
  end loop;
  if v_total_ahora = 0 then raise exception 'ninguna linea recibio piezas' using errcode = '22023'; end if;

  select coalesce(sum(operacion.recibido_acumulado(l.id)), 0)::int, coalesce(sum(l.piezas_facturadas), 0)::int,
         bool_and(operacion.recibido_acumulado(l.id) = l.piezas_facturadas)
    into v_acum_total, v_fact_total, v_completa from operacion.compra_linea l where l.compra_id = c.id;
  update operacion.compra set estado = 'recibida_parcial' where id = c.id;
  if v_completa then
    perform operacion.cerrar_recepcion_interno(c.id, v_fecha, p_clave_idem || ':cierre', null);
  else
    perform operacion.avisar('llegada_pendiente_confirmar', 'NT-016', 'llegada_pendiente:' || c.id, 'I',
      'Recepcion parcial de ' || c.folio || ': llevan ' || v_acum_total || ' de ' || v_fact_total || ' piezas', 'compra', c.id,
      jsonb_build_object('folio', c.folio), null, v_ev, false, array['software', 'telegram']);
  end if;
  v_res := jsonb_build_object('compra_id', c.id, 'folio', c.folio, 'piezas_ahora', v_total_ahora, 'valor_entrada_cent', v_valor_ahora, 'piezas_acumuladas', v_acum_total,
                              'piezas_facturadas', v_fact_total, 'pendientes', greatest(v_fact_total - v_acum_total, 0), 'completa', v_completa, 'estado', case when v_completa then 'recibida' else 'recibida_parcial' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION operacion.registrar_devolucion_cliente(p_clave_idem text, p_pedido bigint, p_lineas jsonb, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; ped operacion.pedido; ult operacion.nota; v_ev bigint; v_id bigint; v_folio text; r record; v_surtido int; v_costo_tot bigint; v_prev_n int; v_prev_val bigint;
  v_valor bigint; v_precio bigint; v_subtotal bigint; v_desc_pedido bigint; v_bruto_prev bigint; v_desc bigint := 0; v_bruto bigint; v_monto bigint; v_mov bigint; v_total_monto bigint := 0; v_total_costo bigint := 0; v_total_pz int := 0; v_saldo_antes bigint; v_saldo_despues bigint;
  v_cobrado bigint; v_exceso bigint; v_liberado bigint := 0; ap record; v_cli text; v_snap_lineas jsonb; v_texto text; v_snap jsonb; v_res jsonb; v_modelo text; v_sabor text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_devolucion_cliente', 'p', p_pedido, 'l', p_lineas, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la devolucion exige motivo' using errcode = '23502'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'indica lo que se devuelve' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: solo uno enviado admite devolucion', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if not operacion.origen_es_bodega(ped.origen) then raise exception 'el pedido % salio directo del proveedor: su devolucion no pasa por Bodega Omar (pendiente de definir)', ped.folio using errcode = 'P0428'; end if;
  select * into ult from operacion.nota where pedido_id = ped.id order by id desc limit 1;

  create temporary table if not exists _dev_cli_tmp (linea_id bigint, sku_id bigint, piezas int, destino text) on commit drop;
  delete from _dev_cli_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _dev_cli_tmp
  select (x->>'linea_id')::bigint,
         case when x ? 'sku_id' then (x->>'sku_id')::bigint
              else (select s.id from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id join operacion.pedido_linea pl on pl.modelo_id = s.modelo_id
                    where pl.id = (x->>'linea_id')::bigint and sa.id = catalogo.sabor_por_nombre(x->>'sabor')) end,
         (x->>'piezas')::int, coalesce(x->>'destino', 'inventario')
  from jsonb_array_elements(p_lineas) x;
  if exists (select 1 from _dev_cli_tmp where sku_id is null or piezas is null or piezas <= 0 or destino not in ('inventario', 'merma')) then raise exception 'renglon de devolucion invalido' using errcode = '22023'; end if;
  if exists (select 1 from _dev_cli_tmp t left join operacion.pedido_linea l on l.id = t.linea_id and l.pedido_id = ped.id where l.id is null) then raise exception 'un renglon no pertenece al pedido' using errcode = '22023'; end if;

  -- Cada (renglon, sabor) no puede devolver mas de lo que se surtio menos lo ya devuelto.
  for r in select linea_id, sku_id, sum(piezas)::int as piezas from _dev_cli_tmp group by linea_id, sku_id loop
    select coalesce(sum(s.piezas), 0)::int into v_surtido from operacion.pedido_surtido s where s.pedido_linea_id = r.linea_id and s.sku_id = r.sku_id;
    if r.piezas > v_surtido - operacion.devuelto_linea_sku(r.linea_id, r.sku_id) - operacion.perdido_linea_sku(r.linea_id, r.sku_id) then
      raise exception 'se devuelven mas piezas de las que se pueden: surtidas %, ya devueltas %, perdidas en paquete %, ahora %', v_surtido, operacion.devuelto_linea_sku(r.linea_id, r.sku_id), operacion.perdido_linea_sku(r.linea_id, r.sku_id), r.piezas using errcode = '23514';
    end if;
  end loop;

  -- Totales antes de escribir (el credito no puede pasar de lo que el pedido vale hoy).
  v_cobrado := operacion.pedido_cobrado(ped.id);
  select coalesce(sum(t.piezas * coalesce((ult.ajustes->'precios'->>(t.linea_id::text))::bigint, l.precio_cent)), 0)::bigint, coalesce(sum(t.piezas), 0)::int
    into v_total_monto, v_total_pz from _dev_cli_tmp t join operacion.pedido_linea l on l.id = t.linea_id;
  -- El descuento del pedido se devuelve en proporcion a las piezas que regresan (acumulado, para que devolver todo devuelva exactamente todo el descuento);
  -- el envio y el recargo no se devuelven (parametro pendiente del dueno). Asi un pedido con descuento SI se puede devolver completo.
  v_bruto := v_total_monto;
  -- Solo el descuento comercial: la nota tambien lleva las bonificaciones por paquete perdido o danado, que no son un descuento de precio.
  v_desc_pedido := greatest(0, coalesce((ult.ajustes->>'descuento_cent')::bigint, ped.descuento_cent)
    - coalesce((select sum(rs.bonificacion_cent) from operacion.paquete_incidente_resolucion rs join operacion.paquete_incidente i on i.id = rs.incidente_id where i.pedido_id = ped.id and i.sentido = 'salida'), 0)::bigint);
  select coalesce(sum((g.pz - operacion.perdido_linea_sku(g.linea, g.sku)) * g.precio), 0)::bigint into v_subtotal
    from (select l.id as linea, su.sku_id as sku, sum(su.piezas)::bigint as pz, coalesce((ult.ajustes->'precios'->>(l.id::text))::bigint, l.precio_cent) as precio
            from operacion.pedido_surtido su join operacion.pedido_linea l on l.id = su.pedido_linea_id where l.pedido_id = ped.id group by l.id, su.sku_id, l.precio_cent) g;
  if v_desc_pedido > 0 and v_subtotal > 0 then
    select coalesce(sum(d.monto_cent + d.descuento_prorrateado_cent), 0)::bigint into v_bruto_prev from operacion.devolucion_cliente d
      where d.pedido_id = ped.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id);
    v_desc := negocio.redondear_medio_arriba(v_desc_pedido * least(v_bruto_prev + v_bruto, v_subtotal), v_subtotal)
              - coalesce((select sum(d.descuento_prorrateado_cent) from operacion.devolucion_cliente d where d.pedido_id = ped.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id)), 0);
    v_desc := least(greatest(v_desc, 0), v_bruto - 1);
    v_total_monto := v_bruto - v_desc;
  end if;
  if v_total_monto > v_cobrado then raise exception 'el credito (%) pasa de lo que el pedido vale hoy (%)', v_total_monto, v_cobrado using errcode = '23514'; end if;
  v_saldo_antes := operacion.pedido_saldo(ped.id);

  v_ev := operacion.crear_evento('devolucion_cliente', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio));
  v_folio := seguridad.siguiente_folio('DV');
  select c.nombre_canonico into v_cli from catalogo.cliente c where c.id = ped.cliente_id;
  -- Encabezado provisional con ceros no permitidos: se calcula el costo en una pasada previa.
  v_total_costo := 0;
  for r in select linea_id, sku_id, sum(piezas)::int as piezas from _dev_cli_tmp group by linea_id, sku_id loop
    select sum(s.piezas)::int, sum(s.costo_valor_cent) into v_surtido, v_costo_tot from operacion.pedido_surtido s where s.pedido_linea_id = r.linea_id and s.sku_id = r.sku_id;
    v_prev_n := operacion.devuelto_linea_sku(r.linea_id, r.sku_id);
    v_total_costo := v_total_costo + negocio.redondear_medio_arriba(v_costo_tot * (v_prev_n + r.piezas), v_surtido) - negocio.redondear_medio_arriba(v_costo_tot * v_prev_n, v_surtido);
  end loop;
  v_saldo_despues := v_saldo_antes - v_total_monto; -- se ajusta abajo si hay pagos que liberar
  insert into operacion.devolucion_cliente (folio, pedido_id, cliente_id, fecha_neg, motivo, piezas, monto_cent, descuento_prorrateado_cent, costo_cent, saldo_antes_cent, saldo_despues_cent, snapshot_cliente, texto_whatsapp, emitida_por, evento_id)
    values (v_folio, ped.id, ped.cliente_id, negocio.hoy(), btrim(p_motivo), v_total_pz, v_total_monto, v_desc, v_total_costo, v_saldo_antes, v_saldo_despues, '{}'::jsonb, '', auth.uid(), v_ev) returning id into v_id;

  -- Renglones, movimientos del kardex (entrada al valor de salida; si viene danado, sale enseguida como merma).
  for r in select t.linea_id, t.sku_id, t.destino, sum(t.piezas)::int as piezas from _dev_cli_tmp t group by t.linea_id, t.sku_id, t.destino order by t.linea_id, t.sku_id, t.destino loop
    select sum(s.piezas)::int, sum(s.costo_valor_cent) into v_surtido, v_costo_tot from operacion.pedido_surtido s where s.pedido_linea_id = r.linea_id and s.sku_id = r.sku_id;
    v_prev_n := operacion.devuelto_linea_sku(r.linea_id, r.sku_id);
    select coalesce(sum(l.costo_valor_cent), 0) into v_prev_val from operacion.devolucion_cliente_linea l
      where l.pedido_linea_id = r.linea_id and l.sku_id = r.sku_id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = l.devolucion_id);
    v_valor := negocio.redondear_medio_arriba(v_costo_tot * (v_prev_n + r.piezas), v_surtido) - v_prev_val;
    select coalesce((ult.ajustes->'precios'->>(r.linea_id::text))::bigint, l.precio_cent), l.modelo_id into v_precio, v_monto from operacion.pedido_linea l where l.id = r.linea_id;
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, nota)
      values (negocio.hoy(), r.sku_id, v_monto, 'bodega_omar', 'devolucion', r.piezas, v_valor, v_ev, 'Devolucion ' || v_folio) returning id into v_mov;
    insert into operacion.devolucion_cliente_linea (devolucion_id, pedido_linea_id, sku_id, modelo_id, piezas, precio_cent, monto_cent, costo_valor_cent, destino, movimiento_id)
      values (v_id, r.linea_id, r.sku_id, v_monto, r.piezas, v_precio, r.piezas * v_precio, v_valor, r.destino, v_mov);
    if r.destino = 'merma' then
      -- La merma de una devolucion danada sale al MISMO valor con el que entro (no al promedio vigente): el inventario de las demas piezas no se mueve.
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, nota)
        values (negocio.hoy(), r.sku_id, v_monto, 'bodega_omar', 'merma', -r.piezas, -v_valor, v_ev, 'Devolucion danada ' || v_folio);
    end if;
  end loop;

  -- Si el cliente ya habia pagado de mas, el excedente vuelve a ser saldo a favor: se revierte la aplicacion mas reciente y se reaplica lo que si corresponde.
  v_exceso := greatest(-operacion.pedido_saldo(ped.id), 0);
  if v_exceso > 0 then
    for ap in select x.id, x.pago_id, x.monto_cent from operacion.pago_aplicacion x where x.pedido_id = ped.id and x.reversa_de is null
               and not exists (select 1 from operacion.pago_aplicacion y where y.reversa_de = x.id) order by x.id desc loop
      exit when v_exceso <= 0;
      insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id, reversa_de) values (ap.pago_id, ped.id, -ap.monto_cent, v_ev, ap.id);
      if ap.monto_cent > v_exceso then
        insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id) values (ap.pago_id, ped.id, ap.monto_cent - v_exceso, v_ev);
        v_liberado := v_liberado + v_exceso; v_exceso := 0;
      else
        v_liberado := v_liberado + ap.monto_cent; v_exceso := v_exceso - ap.monto_cent;
      end if;
    end loop;
  end if;
  v_saldo_despues := operacion.pedido_saldo(ped.id);

  select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas, 'precio_cent', l.precio_cent, 'total_cent', l.monto_cent, 'destino', l.destino) order by m.nombre_canonico, sa.nombre_canonico), '[]'::jsonb)
    into v_snap_lineas from operacion.devolucion_cliente_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.devolucion_id = v_id;
  v_snap := jsonb_build_object('folio', v_folio, 'fecha', negocio.hoy(), 'cliente', v_cli, 'pedido', ped.folio, 'nota', ult.folio_documento, 'lineas', v_snap_lineas, 'piezas_total', v_total_pz,
                               'bruto_cent', v_bruto, 'descuento_prorrateado_cent', v_desc, 'total_cent', v_total_monto, 'total_nota_cent', ult.total_cent, 'saldo_antes_cent', v_saldo_antes, 'saldo_despues_cent', v_saldo_despues, 'liberado_cent', v_liberado, 'motivo', btrim(p_motivo));
  v_texto := 'NOTA DE CREDITO ' || v_folio || E'\n' || v_cli || E'\nPedido ' || ped.folio || E'\n'
    || (select string_agg(x->>'modelo' || ' ' || (x->>'sabor') || ': ' || (x->>'piezas') || ' pz x ' || operacion.fmt_pesos((x->>'precio_cent')::bigint) || ' = ' || operacion.fmt_pesos((x->>'total_cent')::bigint), E'\n') from jsonb_array_elements(v_snap_lineas) x)
    || case when v_desc > 0 then E'\nDescuento del pedido, en proporcion: -' || operacion.fmt_pesos(v_desc) else '' end
    || E'\nCredito total: ' || operacion.fmt_pesos(v_total_monto)
    || case when v_liberado > 0 then E'\nSaldo a favor liberado: ' || operacion.fmt_pesos(v_liberado) else '' end
    || E'\nSaldo del pedido: ' || operacion.fmt_pesos(v_saldo_despues);
  -- Los campos del documento se completan una sola vez (la fila se inserto con valores provisionales; T1 solo permite este cierre dentro de la misma operacion).
  perform set_config('rtm.cerrar_devolucion', v_id::text, true);
  update operacion.devolucion_cliente set snapshot_cliente = v_snap, texto_whatsapp = v_texto, liberado_cent = v_liberado, saldo_despues_cent = v_saldo_despues where id = v_id;

  perform operacion.avisar('nota_corregida_o_anulada', 'NT-008', 'devolucion_cliente:' || v_id, 'I', 'Devolucion ' || v_folio || ' de ' || ped.folio || ': credito de ' || operacion.fmt_pesos(v_total_monto), 'pedido', ped.id,
    jsonb_build_object('folio', ped.folio, 'documento', v_folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('devolucion_id', v_id, 'folio', v_folio, 'pedido_id', ped.id, 'piezas', v_total_pz, 'monto_cent', v_total_monto, 'costo_cent', v_total_costo,
                              'liberado_cent', v_liberado, 'saldo_antes_cent', v_saldo_antes, 'saldo_despues_cent', v_saldo_despues, 'texto', v_texto);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION api.devolucion_proveedor_catalogo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('skus', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'disponible', operacion.disponible_sku(k.id),
        'costo_prom_cent', e.costo_prom_cent) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
      from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
           join operacion.existencia_modelo e on e.modelo_id = m.id where k.unificado_en is null and operacion.disponible_sku(k.id) > 0), '[]'::jsonb),
    'compras', coalesce((select jsonb_agg(jsonb_build_object('id', co.id, 'folio', co.folio, 'proveedor', p.nombre, 'estado', co.estado) order by co.id desc)
      from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id where co.estado in ('recibida_parcial', 'recibida', 'cerrada')), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION catalogo.unificar_sabor(p_clave_idem text, p_origen bigint, p_destino bigint, p_canal text DEFAULT 'web'::text, p_nombre_final text DEFAULT NULL::text, p_pregunta_id bigint DEFAULT NULL::bigint, p_aprobacion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; o catalogo.sabor; d catalogo.sabor; q catalogo.posible_duplicado; v_final text; v_det jsonb := '[]'::jsonb; v_bloq jsonb := '[]'::jsonb; k record; m text[];
  v_aprob text; v_rea int := 0; v_fus int := 0; v_alias bigint[]; v_uid bigint; v_res jsonb; v_norm_o text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then raise exception 'elige dos sabores distintos' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'unificar_sabor', 'o', p_origen, 'd', p_destino, 'n', p_nombre_final, 'q', p_pregunta_id, 'a', p_aprobacion));
  if v_prev is not null then
    -- La clave ya tiene un resultado 'unificado' pero esa unificacion se DESHIZO despues: devolver lo guardado seria mentir (no hay nada unificado). Se dice claro.
    if v_prev ->> 'estado' = 'unificado' and exists (select 1 from catalogo.unificacion_sabor u where u.id = nullif(v_prev ->> 'unificacion_id', '')::bigint and u.estado = 'deshecha') then
      raise exception 'ya deshecho: la unificacion de esta clave fue deshecha; usa una clave nueva (o --reaplicar en unificar-aprobados) para volver a aplicarla' using errcode = 'P0463';
    end if;
    return v_prev || jsonb_build_object('repetido', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_sabor', 0));

  select * into o from catalogo.sabor where id = p_origen for update;
  if not found then raise exception 'sabor origen desconocido' using errcode = '22023'; end if;
  select * into d from catalogo.sabor where id = p_destino for update;
  if not found then raise exception 'sabor destino desconocido' using errcode = '22023'; end if;
  if o.unificado_en is not null then
    v_res := jsonb_build_object('estado', 'ya_unificado', 'origen', o.nombre_canonico, 'destino', (select nombre_canonico from catalogo.sabor where id = o.unificado_en));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if d.unificado_en is not null then raise exception 'el sabor destino ya fue unificado en otro; elige el vigente' using errcode = '22023'; end if;

  -- La regla central: nunca solo. Respuesta de un socio a la pregunta de ESTE par, o aprobacion explicita por clave (catalogo.unificacion_aprobada).
  if p_pregunta_id is not null then
    select * into q from catalogo.posible_duplicado where id = p_pregunta_id for update;
    if not found or q.tipo <> 'sabor' or q.id_a <> least(p_origen, p_destino) or q.id_b <> greatest(p_origen, p_destino) then
      raise exception 'la pregunta no corresponde a estos sabores' using errcode = '22023';
    end if;
    if q.estado <> 'pendiente' then raise exception 'esa pregunta ya fue contestada' using errcode = '22023'; end if;
    v_aprob := 'pregunta:' || q.id::text;
  elsif p_aprobacion is not null then
    if not exists (select 1 from catalogo.unificacion_aprobada a where a.clave = p_aprobacion and a.origen_norm = o.nombre_norm and a.destino_norm = d.nombre_norm) then
      raise exception 'aprobacion explicita no reconocida para este par' using errcode = '42501';
    end if;
    v_aprob := 'clave:' || p_aprobacion;
  else
    raise exception 'una unificacion exige la respuesta de un socio o una aprobacion explicita' using errcode = '42501';
  end if;

  v_final := case when nullif(btrim(p_nombre_final), '') is null then d.nombre_canonico else catalogo.nombre_alta_valido(p_nombre_final, 40) end;
  if catalogo.normalizar(v_final) <> d.nombre_norm and exists (select 1 from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(v_final) and s.id not in (p_origen, p_destino)) then
    raise exception 'ese nombre ya lo usa otro sabor' using errcode = '22023';
  end if;

  for k in
    select s.id as sku_id, s.modelo_id, (select ds.id from catalogo.sku ds where ds.modelo_id = s.modelo_id and ds.sabor_id = p_destino and ds.unificado_en is null) as dest_sku
      from catalogo.sku s where s.sabor_id = p_origen and s.unificado_en is null order by s.id
  loop
    if k.dest_sku is null then
      v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'accion', 'reasignado', 'sku_destino', k.sku_id);
    else
      m := catalogo.sku_bloqueos_unificacion(k.sku_id);
      if cardinality(m) > 0 then
        v_bloq := v_bloq || jsonb_build_object('sku_id', k.sku_id, 'modelo', (select nombre_canonico from catalogo.modelo where id = k.modelo_id), 'motivos', to_jsonb(m));
      else
        v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'accion', 'fusionado', 'sku_destino', k.dest_sku);
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_bloq) > 0 then
    delete from seguridad.operacion where clave = p_clave_idem;
    return jsonb_build_object('estado', 'bloqueado', 'origen', o.nombre_canonico, 'destino', d.nombre_canonico, 'bloqueos', v_bloq,
                              'ayuda', 'El sku del sabor origen tiene movimiento pendiente. Cierra el conteo, recibe o cancela lo abierto, o traspasa la existencia al sabor canonico, y vuelve a intentar.');
  end if;

  v_norm_o := o.nombre_norm;
  update catalogo.sabor set nombre_original = nombre_canonico, nombre_canonico = v_final, unificado_en = p_destino, unificado_at = now() where id = p_origen;
  if v_final <> d.nombre_canonico then update catalogo.sabor set nombre_canonico = v_final where id = p_destino; end if;
  for k in select (e ->> 'sku_id')::bigint as sku_id, e ->> 'accion' as accion, (e ->> 'sku_destino')::bigint as sku_destino from jsonb_array_elements(v_det) e loop
    if k.accion = 'reasignado' then
      update catalogo.sku set sabor_id = p_destino where id = k.sku_id;
      v_rea := v_rea + 1;
    else
      update catalogo.sku set activo = false, unificado_en = k.sku_destino where id = k.sku_id;
      v_fus := v_fus + 1;
    end if;
  end loop;
  select coalesce(array_agg(id), '{}') into v_alias from catalogo.sabor_alias where sabor_id = p_origen;
  update catalogo.sabor_alias set sabor_id = p_destino where sabor_id = p_origen;
  insert into catalogo.sabor_alias (alias_norm, sabor_id, origen_unificacion) values (v_norm_o, p_destino, null)
    on conflict (alias_norm) do update set sabor_id = excluded.sabor_id;
  insert into catalogo.unificacion_sabor (clave_idem, origen_id, destino_id, nombre_origen, nombre_destino_antes, nombre_destino_despues, detalle, alias_movidos, aprobacion, canal, por)
    values (p_clave_idem, p_origen, p_destino, o.nombre_canonico, d.nombre_canonico, v_final, v_det, v_alias, v_aprob, p_canal, auth.uid()) returning id into v_uid;
  update catalogo.sabor_alias set origen_unificacion = v_uid where alias_norm = v_norm_o;
  if p_pregunta_id is not null then
    update catalogo.posible_duplicado set estado = 'unido', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal, canonico_id = p_destino, unificacion_id = v_uid where id = p_pregunta_id;
  end if;
  perform seguridad.registrar_auditoria('catalogo.sabor', 'UNIFICACION', p_origen::text,
    jsonb_build_object('origen', o.nombre_canonico, 'destino', d.nombre_canonico),
    jsonb_build_object('unificacion_id', v_uid, 'destino_id', p_destino, 'nombre_final', v_final, 'skus', v_det, 'aprobacion', v_aprob, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'unificado', 'unificacion_id', v_uid, 'origen', o.nombre_canonico, 'destino', v_final, 'skus_reasignados', v_rea, 'skus_fusionados', v_fus, 'aprobacion', v_aprob);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION catalogo.responder_duplicado(p_clave_idem text, p_id bigint, p_respuesta text, p_canonico_id bigint DEFAULT NULL::bigint, p_nombre_final text DEFAULT NULL::text, p_canal text DEFAULT 'web'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_prev jsonb; q catalogo.posible_duplicado; v_dest bigint; v_orig bigint; v_res jsonb; v_na int; v_nb int;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_canal not in ('web', 'telegram') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if p_respuesta not in ('si', 'no') then raise exception 'la respuesta es si o no' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'responder_duplicado', 'id', p_id, 'r', p_respuesta, 'c', p_canonico_id, 'n', p_nombre_final));
  if v_prev is not null then
    if v_prev ->> 'estado' = 'unificado' and exists (select 1 from catalogo.unificacion_sabor u where u.id = nullif(v_prev ->> 'unificacion_id', '')::bigint and u.estado = 'deshecha') then
      raise exception 'ya deshecho: la unificacion de esta clave fue deshecha; la pregunta volvio a quedar pendiente, contesta con una clave nueva' using errcode = 'P0463';
    end if;
    return v_prev || jsonb_build_object('repetido', true);
  end if;
  select * into q from catalogo.posible_duplicado where id = p_id for update;
  if not found then raise exception 'pregunta desconocida' using errcode = '22023'; end if;
  if q.estado <> 'pendiente' then
    v_res := jsonb_build_object('estado', 'ya_contestada', 'estado_pregunta', q.estado, 'pregunta_id', q.id);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if p_respuesta = 'no' then
    update catalogo.posible_duplicado set estado = 'distinto', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal where id = q.id;
    perform seguridad.registrar_auditoria('catalogo.posible_duplicado', 'NEGATIVO', q.id::text, null, jsonb_build_object('tipo', q.tipo, 'id_a', q.id_a, 'id_b', q.id_b, 'origen_canal', p_canal), p_canal);
    v_res := jsonb_build_object('estado', 'distinto', 'pregunta_id', q.id);
  elsif q.tipo <> 'sabor' then
    update catalogo.posible_duplicado set estado = 'confirmado_igual', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal where id = q.id;
    perform seguridad.registrar_auditoria('catalogo.posible_duplicado', 'CONFIRMADO_IGUAL', q.id::text, null, jsonb_build_object('tipo', q.tipo, 'id_a', q.id_a, 'id_b', q.id_b, 'origen_canal', p_canal), p_canal);
    v_res := jsonb_build_object('estado', 'confirmado_igual', 'pregunta_id', q.id, 'nota', 'La union de modelos y clientes no se ejecuta todavia: mueve saldos y dinero (fase posterior).');
  else
    if p_canonico_id is not null and p_canonico_id not in (q.id_a, q.id_b) then raise exception 'el canonico debe ser uno de los dos sabores' using errcode = '22023'; end if;
    if p_canonico_id is null then
      v_dest := catalogo.sabor_canonico_preferido(q.id_a, q.id_b);
    else
      v_dest := p_canonico_id;
    end if;
    v_orig := case when v_dest = q.id_a then q.id_b else q.id_a end;
    v_res := catalogo.unificar_sabor(p_clave_idem || ':u', v_orig, v_dest, p_canal, p_nombre_final, q.id, null);
    v_res := v_res || jsonb_build_object('pregunta_id', q.id);
    if v_res ->> 'estado' = 'bloqueado' then delete from seguridad.operacion where clave = p_clave_idem; return v_res; end if;
  end if;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION api.duplicados_pendientes(p_tipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_tipo is not null and p_tipo not in ('sabor', 'modelo', 'cliente') then raise exception 'tipo invalido' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'tipo', d.tipo, 'puntaje', d.puntaje, 'clase', d.clase, 'motivo', d.motivo, 'ambiguo', d.ambiguo, 'preguntado_at', d.preguntado_at,
      'a', jsonb_build_object('id', d.id_a, 'nombre', n.na, 'skus', n.sa, 'lineas_pedido', n.la, 'piezas', n.pa),
      'b', jsonb_build_object('id', d.id_b, 'nombre', n.nb, 'skus', n.sb, 'lineas_pedido', n.lb, 'piezas', n.pb),
      'pregunta', '¿"' || n.na || '" es lo mismo que "' || n.nb || '"?',
      'canonico_sugerido', case when d.tipo = 'sabor' then catalogo.sabor_canonico_preferido(d.id_a, d.id_b) else d.id_a end,
      'se_puede_unir', d.tipo = 'sabor') order by d.puntaje desc, d.id)
    from catalogo.posible_duplicado d
    cross join lateral (select
        case d.tipo when 'sabor' then (select nombre_canonico from catalogo.sabor where id = d.id_a) when 'modelo' then (select nombre_canonico from catalogo.modelo where id = d.id_a) else (select nombre_canonico from catalogo.cliente where id = d.id_a) end as na,
        case d.tipo when 'sabor' then (select nombre_canonico from catalogo.sabor where id = d.id_b) when 'modelo' then (select nombre_canonico from catalogo.modelo where id = d.id_b) else (select nombre_canonico from catalogo.cliente where id = d.id_b) end as nb,
        case when d.tipo = 'sabor' then (select count(*) from catalogo.sku k where k.sabor_id = d.id_a and k.unificado_en is null) else 0 end as sa,
        case when d.tipo = 'sabor' then (select count(*) from catalogo.sku k where k.sabor_id = d.id_b and k.unificado_en is null) else 0 end as sb,
        case when d.tipo = 'sabor' then (select count(*) from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id where k.sabor_id = d.id_a) else 0 end as la,
        case when d.tipo = 'sabor' then (select count(*) from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id where k.sabor_id = d.id_b) else 0 end as lb,
        case when d.tipo = 'sabor' then (select coalesce(sum(e.piezas), 0) from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.sabor_id = d.id_a) else 0 end as pa,
        case when d.tipo = 'sabor' then (select coalesce(sum(e.piezas), 0) from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.sabor_id = d.id_b) else 0 end as pb) n
    where d.estado = 'pendiente' and (p_tipo is null or d.tipo = p_tipo)
      and not (d.tipo = 'sabor' and exists (select 1 from catalogo.sabor s where s.id in (d.id_a, d.id_b) and s.unificado_en is not null))
      and n.na is not null and n.nb is not null), '[]'::jsonb);
end $function$;
