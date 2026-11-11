-- F3b-2 / 0022: inventario completo, kardex, semaforo de cobertura, conteo fisico con diferencias explicadas y documentos PDF del inventario.
--  * semaforo por DIAS DE COBERTURA (doc 18, 2.2 y 3.5): c = disponible / demanda diaria. Todo umbral sale de catalogo.config.
--  * kardex por modelo y sabor con costo promedio y comprobacion CU6 (valor final = suma de entradas menos salidas).
--  * conteo ciego: se cuenta, luego se muestra la diferencia, se explica y se cierra; el cierre emite el aviso NT-032.
--  * documentos del inventario (version clientes sin costos y version interna) con folio INV y huella estable; se guardan para reabrirlos identicos.

insert into catalogo.config (clave, valor, vigente_desde) values
  ('cobertura_objetivo_dias', '28', '2026-11-10'),
  ('sobrestock_x', '2', '2026-11-10'),
  ('ciclo_pedido_dias', '7', '2026-11-10'),
  ('lt_dias_isaac', '7', '2026-11-10'),
  ('lt_dias_karen', '10', '2026-11-10'),
  ('demanda_ventana_dias', '28', '2026-11-10'),
  ('historia_minima_dias', '28', '2026-11-10'),
  ('demanda_min_salidas_sabor', '4', '2026-11-10'),
  ('socios_venden_ventana_dias', '60', '2026-11-10'),
  ('conteo_exactitud_critica_bp', '9800', '2026-11-10'),
  ('trayecto_dias_extra', '3', '2026-11-10');

alter table seguridad.contador_folio drop constraint contador_folio_serie_check;
alter table seguridad.contador_folio add constraint contador_folio_serie_check check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E', 'PO', 'CR', 'A', 'INV'));
insert into seguridad.contador_folio (serie) values ('INV');

-- ---------------------------------------------------------------------------
-- Semaforo
-- ---------------------------------------------------------------------------
-- Regla RTM por dias de cobertura c (doc 18, 2.2). LT = tiempo de entrega, R = ciclo de pedido. Sin literales: todo viene como parametro.
create function operacion.estado_cobertura(p_dias numeric, p_lt numeric, p_ciclo numeric, p_objetivo numeric, p_x numeric) returns text
language sql immutable set search_path = ''
as $$
  select case when p_dias < p_lt then 'urge'
              when p_dias < p_lt + p_ciclo then 'brevedad'
              when p_dias < p_lt + p_ciclo + p_ciclo then 'siguiente'
              when p_dias < p_objetivo then 'buena'
              when p_dias <= p_x * p_objetivo then 'excelente'
              else 'sobrestock' end
$$;

-- Estado completo: sin historia suficiente solo se informa la existencia; con historia y demanda 0 es "sin movimiento"; existencia 0 con demanda es URGE.
create function operacion.estado_cobertura_calc(p_historia int, p_historia_min int, p_demanda numeric, p_disponible int, p_lt numeric, p_ciclo numeric, p_objetivo numeric, p_x numeric) returns text
language sql immutable set search_path = ''
as $$
  select case when p_historia < p_historia_min then 'sin_historia'
              when coalesce(p_demanda, 0) <= 0 then 'sin_movimiento'
              when p_disponible <= 0 then 'urge'
              else operacion.estado_cobertura(p_disponible / p_demanda, p_lt, p_ciclo, p_objetivo, p_x) end
$$;

-- Cobertura por modelo y por sabor. Demanda = salidas netas (pedidos y tomas, menos sus reversas) de la ventana entre los dias con existencia;
-- con menos de N salidas del sabor se usa la mezcla de existencia del modelo. LT: el menor entre los proveedores con costo vigente del modelo.
create function operacion.cobertura(p_hoy date default null) returns table (nivel text, modelo_id bigint, sku_id bigint, fisico int, reservado int, disponible int, salidas int, dias_efectivos int,
                                                                      dias_historia int, lt_dias int, demanda numeric, dias numeric, estado text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_vent int := catalogo.config_num('demanda_ventana_dias')::int; v_hist int := catalogo.config_num('historia_minima_dias')::int;
  v_min int := catalogo.config_num('demanda_min_salidas_sabor')::int; v_ciclo numeric := catalogo.config_num('ciclo_pedido_dias'); v_obj numeric := catalogo.config_num('cobertura_objetivo_dias');
  v_x numeric := catalogo.config_num('sobrestock_x');
begin
  return query
  with salidas as (
    select mi.sku_id as sid, (-sum(mi.cantidad))::int as n
      from operacion.movimiento_inventario mi left join operacion.movimiento_inventario o on o.id = mi.reversa_de
     where mi.fecha_neg > v_hoy - v_vent and mi.fecha_neg <= v_hoy
       and (mi.tipo in ('salida_pedido', 'salida_toma_omar') or (mi.tipo = 'reversa' and o.tipo in ('salida_pedido', 'salida_toma_omar')))
     group by mi.sku_id),
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
  res as (select r.sku_id as sid, sum(r.piezas)::int as r from operacion.reserva r where r.estado = 'activa' group by r.sku_id),
  skb as (
    select k.id as sid, k.modelo_id as mid, coalesce(u.piezas, 0)::int as f, coalesce(res.r, 0)::int as r, greatest(coalesce(u.piezas, 0) - coalesce(res.r, 0), 0)::int as disp, coalesce(s.n, 0)::int as n
      from catalogo.sku k
      left join operacion.existencia_sku_ubicacion u on u.sku_id = k.id and u.ubicacion = 'bodega_omar'
      left join res on res.sid = k.id left join salidas s on s.sid = k.id
     where exists (select 1 from operacion.existencia_sku_ubicacion x where x.sku_id = k.id)),
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
end $$;

-- ---------------------------------------------------------------------------
-- Inventario completo (la misma funcion alimenta la pantalla y el PDF: el corte coincide)
-- ---------------------------------------------------------------------------
create function operacion.inventario_base(p_hoy date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_vent int := catalogo.config_num('socios_venden_ventana_dias')::int; v_res jsonb;
begin
  with cob as (select * from operacion.cobertura(v_hoy)),
  skf as (select k.id as sid, k.modelo_id as mid, sum(u.piezas)::int as piezas from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id group by k.id, k.modelo_id),
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
end $$;

create function api.inventario_completo() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.inventario_base();
end $$;

-- ---------------------------------------------------------------------------
-- Kardex por modelo y sabor
-- ---------------------------------------------------------------------------
create function api.inventario_kardex(p_modelo bigint, p_sku bigint default null, p_ini date default null, p_fin date default null, p_limite int default 500) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_mod jsonb; v_ap jsonb; v_filas jsonb; v_total int; v_via1 bigint; v_via2 bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select jsonb_build_object('id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico) into v_mod from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where m.id = p_modelo;
  if v_mod is null then return null; end if;
  select count(*) into v_total from operacion.movimiento_inventario mi where mi.modelo_id = p_modelo and (p_sku is null or mi.sku_id = p_sku)
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
     where mi.modelo_id = p_modelo and (p_sku is null or mi.sku_id = p_sku) and (p_ini is null or mi.fecha_neg >= p_ini) and (p_fin is null or mi.fecha_neg <= p_fin)
     order by mi.id desc limit greatest(p_limite, 1)) x;
  select coalesce(e.valor_cent, 0) into v_via1 from (select 1) z left join operacion.existencia_modelo e on e.modelo_id = p_modelo;
  select coalesce(sum(mi.valor_cent), 0) into v_via2 from operacion.movimiento_inventario mi where mi.modelo_id = p_modelo;
  return jsonb_build_object('modelo', v_mod, 'apertura', v_ap, 'movimientos', v_filas, 'total', v_total, 'truncado', v_total > greatest(p_limite, 1),
    'sabores', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'sabor', sa.nombre_canonico) order by sa.nombre_canonico)
                           from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = p_modelo and exists (select 1 from operacion.existencia_sku_ubicacion x where x.sku_id = k.id)), '[]'::jsonb),
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico) order by ma.nombre, m.nombre_canonico)
                           from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where exists (select 1 from operacion.movimiento_inventario z where z.modelo_id = m.id)), '[]'::jsonb),
    'comprobacion', jsonb_build_object('via1', 'Valor del modelo en el kardex', 'via1_valor_cent', v_via1, 'via2', 'Entradas menos salidas del libro de movimientos', 'via2_valor_cent', v_via2, 'cuadra', v_via1 = v_via2));
end $$;

-- ---------------------------------------------------------------------------
-- Conteo fisico ciego
-- ---------------------------------------------------------------------------
create function api.abrir_conteo(p_clave_idem text, p_ubicacion text, p_tipo text, p_contado_at timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.abrir_conteo(p_clave_idem, p_ubicacion, p_tipo, p_contado_at);
end $$;

-- La hoja de conteo NO trae lo esperado: primero se cuenta, despues se muestra la diferencia.
create function api.conteo_hoja(p_ubicacion text default 'bodega_omar') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
    from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
   where u.ubicacion = p_ubicacion), '[]'::jsonb);
end $$;

-- Previsualizacion de la diferencia (no escribe nada). "En la bodega" = sistema + vendidas por recoger, con desglose.
create function operacion.conteo_diferencias(p_ubicacion text, p_lineas jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_abs bigint; v_esp bigint; v_dif int; v_bp int;
begin
  with c as (select (x ->> 'sku_id')::bigint as sku_id, (x ->> 'contado')::int as contado from jsonb_array_elements(p_lineas) x),
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
end $$;

create function api.conteo_previsualizar(p_ubicacion text, p_lineas jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.conteo_diferencias(p_ubicacion, p_lineas);
end $$;

-- Cierre: traduce SKU a modelo y sabor, cierra con la funcion de F1 (ajustes al costo promedio) y emite NT-032 en la misma transaccion.
create function api.cerrar_conteo(p_clave_idem text, p_conteo_id bigint, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_trad jsonb; v_res jsonb; c operacion.conteo; v_abs bigint; v_esp bigint; v_dif int; v_bp int; v_umbral int := catalogo.config_num('conteo_exactitud_critica_bp')::int;
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'contado', (x ->> 'contado')::int,
                                               'explicacion_tipo', nullif(x ->> 'explicacion_tipo', ''), 'explicacion_ref', nullif(x ->> 'explicacion_ref', ''))), '[]'::jsonb)
    into v_trad from jsonb_array_elements(p_lineas) x join catalogo.sku k on k.id = (x ->> 'sku_id')::bigint join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id;
  if jsonb_array_length(v_trad) <> jsonb_array_length(p_lineas) then raise exception 'linea de conteo con SKU desconocido' using errcode = '22023'; end if;
  v_res := operacion.cerrar_conteo(p_clave_idem, p_conteo_id, v_trad);
  select * into c from operacion.conteo where id = p_conteo_id;
  select coalesce(sum(abs(l.diferencia)), 0), coalesce(sum(l.esperado_sistema), 0), count(*) filter (where l.diferencia <> 0) into v_abs, v_esp, v_dif from operacion.conteo_linea l where l.conteo_id = p_conteo_id;
  v_bp := case when v_esp > 0 then greatest(10000 - negocio.redondear_medio_arriba(10000 * v_abs, v_esp), 0)::int end;
  if v_dif > 0 then
    perform operacion.avisar('conteo_con_diferencia', 'NT-032', 'conteo_dif:' || p_conteo_id, case when v_bp is not null and v_bp < v_umbral then 'C' else 'I' end,
      'Conteo cerrado con ' || v_dif || ' ' || case when v_dif = 1 then 'diferencia' else 'diferencias' end, 'conteo', p_conteo_id,
      jsonb_build_object('conteo_id', p_conteo_id, 'ubicacion', c.ubicacion, 'diferencias', v_dif, 'exactitud_bp', v_bp));
  end if;
  return v_res;
end $$;

create function api.conteos_lista() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'ubicacion', ub.nombre, 'estado', c.estado, 'contado_at', c.contado_at,
      'lineas', (select count(*) from operacion.conteo_linea l where l.conteo_id = c.id), 'con_diferencia', (select count(*) from operacion.conteo_linea l where l.conteo_id = c.id and l.diferencia <> 0),
      'sin_explicar', (select count(*) from operacion.conteo_linea l where l.conteo_id = c.id and l.diferencia <> 0 and l.explicacion_tipo is null),
      'exactitud_bp', (select case when sum(l.esperado_sistema) > 0 then greatest(10000 - negocio.redondear_medio_arriba(10000 * sum(abs(l.diferencia))::bigint, sum(l.esperado_sistema)::bigint), 0)::int end from operacion.conteo_linea l where l.conteo_id = c.id))
      order by c.id desc) from operacion.conteo c join catalogo.ubicacion ub on ub.codigo = c.ubicacion), '[]'::jsonb);
end $$;

create function api.conteo_detalle(p_conteo bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c operacion.conteo;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into c from operacion.conteo where id = p_conteo;
  if not found then return null; end if;
  return jsonb_build_object('id', c.id, 'tipo', c.tipo, 'ubicacion', (select nombre from catalogo.ubicacion where codigo = c.ubicacion), 'estado', c.estado, 'contado_at', c.contado_at,
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('sku_id', l.sku_id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'esperado', l.esperado_sistema, 'contado', l.contado,
        'diferencia', l.diferencia, 'explicacion_tipo', l.explicacion_tipo, 'explicacion_ref', l.explicacion_ref, 'ajuste_valor_cent', (select mi.valor_cent from operacion.movimiento_inventario mi where mi.id = l.movimiento_ajuste_id))
        order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
      from operacion.conteo_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id where l.conteo_id = c.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Documentos del inventario (PDF): version clientes (sin costos, utilidad ni proveedor) e interna
-- ---------------------------------------------------------------------------
create table operacion.documento_inventario (
  id bigint generated always as identity primary key,
  folio text not null unique,
  version text not null check (version in ('clientes', 'interna')),
  parametros jsonb not null,
  corte_at timestamptz not null,
  snapshot jsonb not null,
  huella_contenido text not null,
  sha256 text,
  contenido bytea,
  creado_por uuid,
  creado_at timestamptz not null default now(),
  clave_idem text unique,
  check ((sha256 is null) = (contenido is null))
);

create function operacion.t_documento_inventario() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'los documentos no se borran' using errcode = '42501'; end if;
  if old.contenido is not null then raise exception 'el documento ya esta guardado y no cambia' using errcode = '42501'; end if;
  if new.snapshot is distinct from old.snapshot or new.folio <> old.folio or new.version <> old.version or new.huella_contenido <> old.huella_contenido or new.parametros is distinct from old.parametros then
    raise exception 'solo se completa el contenido del PDF' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger documento_inventario_t before update or delete on operacion.documento_inventario for each row execute function operacion.t_documento_inventario();
alter table operacion.documento_inventario enable row level security;
alter table operacion.documento_inventario force row level security;
revoke all on operacion.documento_inventario from public, anon, authenticated;

-- Lo que se exporta, filtrado. La version para clientes no lleva costos, valor ni utilidad: por construccion solo recibe existencia disponible y, si se pide, precios del tabulador.
create function operacion.inventario_snapshot(p_version text, p_params jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_base jsonb := operacion.inventario_base(); v_marca text := nullif(btrim(coalesce(p_params ->> 'marca', '')), ''); v_modelo text := nullif(btrim(coalesce(p_params ->> 'modelo', '')), '');
  v_socios boolean := coalesce((p_params ->> 'solo_socios_venden')::boolean, false); v_disp boolean := coalesce((p_params ->> 'solo_disponibles')::boolean, false);
  v_cant boolean := coalesce((p_params ->> 'mostrar_cantidades')::boolean, false); v_calad boolean := coalesce((p_params ->> 'con_caladas')::boolean, false);
  v_cliente bigint := nullif(p_params ->> 'cliente_id', '')::bigint; v_mods jsonb; v_norm jsonb;
begin
  if p_version not in ('clientes', 'interna') then raise exception 'version desconocida' using errcode = '22023'; end if;
  if p_version = 'interna' then v_cant := true; end if;
  v_norm := jsonb_build_object('marca', v_marca, 'modelo', v_modelo, 'solo_socios_venden', v_socios, 'solo_disponibles', v_disp, 'mostrar_cantidades', v_cant, 'con_caladas', v_calad,
                               'cliente_id', case when p_version = 'clientes' then v_cliente end);
  select coalesce(jsonb_agg(q.j order by q.marca, q.modelo), '[]'::jsonb) into v_mods from (
    select m ->> 'marca' as marca, m ->> 'modelo' as modelo,
           case p_version
             when 'clientes' then jsonb_build_object('marca', m ->> 'marca', 'modelo', m ->> 'modelo', 'puffs', case when v_calad then m -> 'puffs' end,
               'disponible', (m ->> 'disponible')::int > 0, 'cantidad', case when v_cant then to_jsonb((m ->> 'disponible')::int) end,
               'precio_cent', case when v_cliente is not null then to_jsonb(catalogo.precio_vigente(v_cliente, (m ->> 'modelo_id')::bigint)) end,
               'sabores', coalesce((select jsonb_agg(jsonb_build_object('sabor', s ->> 'sabor', 'disponible', (s ->> 'disponible')::int > 0, 'cantidad', case when v_cant then to_jsonb((s ->> 'disponible')::int) end) order by s ->> 'sabor')
                                      from jsonb_array_elements(m -> 'sabores') s where not v_disp or (s ->> 'disponible')::int > 0), '[]'::jsonb))
             else jsonb_build_object('marca', m ->> 'marca', 'modelo', m ->> 'modelo', 'puffs', case when v_calad then m -> 'puffs' end, 'piezas', m -> 'piezas', 'disponible', m -> 'disponible', 'reservado', m -> 'reservado',
               'valor_cent', m -> 'valor_cent', 'costo_prom_cent', m -> 'costo_prom_cent', 'estado', m -> 'estado', 'cobertura_dias', m -> 'cobertura_dias',
               'sabores', coalesce((select jsonb_agg(jsonb_build_object('sabor', s ->> 'sabor', 'piezas', s -> 'piezas', 'disponible', s -> 'disponible', 'valor_cent', s -> 'valor_cent', 'estado', s -> 'estado') order by s ->> 'sabor')
                                      from jsonb_array_elements(m -> 'sabores') s where not v_disp or (s ->> 'disponible')::int > 0), '[]'::jsonb))
           end as j
      from jsonb_array_elements(v_base -> 'modelos') m
     where (m ->> 'piezas') is not null
       and (v_marca is null or lower(m ->> 'marca') = lower(v_marca)) and (v_modelo is null or lower(m ->> 'modelo') = lower(v_modelo))
       and (not v_socios or (m ->> 'socios_venden')::boolean) and (not v_disp or (m ->> 'disponible')::int > 0)) q;
  return jsonb_build_object('version', p_version, 'corte', v_base -> 'corte', 'hoy', v_base -> 'hoy', 'parametros', v_norm, 'modelos', v_mods)
    || case when p_version = 'interna' then jsonb_build_object('totales', v_base -> 'totales') else '{}'::jsonb end;
end $$;

create function operacion.reservar_documento_inventario(p_clave_idem text, p_version text, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_snap jsonb; v_id bigint; v_folio text; v_huella text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reservar_documento_inventario', 'v', p_version, 'p', p_params));
  if v_prev is not null then return v_prev; end if;
  v_snap := operacion.inventario_snapshot(p_version, p_params);
  v_huella := encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex');
  v_folio := seguridad.siguiente_folio('INV');
  insert into operacion.documento_inventario (folio, version, parametros, corte_at, snapshot, huella_contenido, creado_por, clave_idem)
    values (v_folio, p_version, v_snap -> 'parametros', (v_snap ->> 'corte')::timestamptz, v_snap, v_huella, auth.uid(), p_clave_idem) returning id into v_id;
  v_res := jsonb_build_object('id', v_id, 'folio', v_folio, 'version', p_version, 'corte', v_snap -> 'corte', 'huella', v_huella, 'snapshot', v_snap);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.completar_documento_inventario(p_id bigint, p_sha256 text, p_base64 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_bytes bytea := decode(p_base64, 'base64');
begin
  perform seguridad.exigir_rol(array['socio']);
  if encode(sha256(v_bytes), 'hex') <> p_sha256 then raise exception 'la huella no coincide con el PDF recibido' using errcode = '22023'; end if;
  update operacion.documento_inventario set sha256 = p_sha256, contenido = v_bytes where id = p_id and contenido is null;
  if not found then
    if exists (select 1 from operacion.documento_inventario where id = p_id and sha256 = p_sha256) then return jsonb_build_object('id', p_id, 'sha256', p_sha256); end if;
    raise exception 'el documento no existe o ya tiene otro contenido' using errcode = 'P0428';
  end if;
  return jsonb_build_object('id', p_id, 'sha256', p_sha256);
end $$;

create function api.reservar_documento_inventario(p_clave_idem text, p_version text, p_params jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.reservar_documento_inventario(p_clave_idem, p_version, p_params); end $$;
create function api.completar_documento_inventario(p_id bigint, p_sha256 text, p_base64 text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.completar_documento_inventario(p_id, p_sha256, p_base64); end $$;

create function api.documento_inventario(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare d operacion.documento_inventario;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into d from operacion.documento_inventario where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('id', d.id, 'folio', d.folio, 'version', d.version, 'corte', d.corte_at, 'huella', d.huella_contenido, 'sha256', d.sha256, 'snapshot', d.snapshot,
    'base64', case when d.contenido is not null then encode(d.contenido, 'base64') end, 'creado_at', d.creado_at);
end $$;

create function api.documentos_inventario() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'folio', d.folio, 'version', d.version, 'corte', d.corte_at, 'sha256', d.sha256, 'creado_at', d.creado_at) order by d.id desc)
                     from (select * from operacion.documento_inventario where contenido is not null order by id desc limit 20) d), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- "Explicar este numero" para el valor del inventario y la cobertura. La funcion de F1/F2/F3b se conserva como base.
-- ---------------------------------------------------------------------------
alter function api.explicar_cifra(text) rename to explicar_cifra_base;
revoke execute on function api.explicar_cifra_base(text) from authenticated;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare partes text[] := string_to_array(p_cifra, ':'); v_id bigint; v_via1 bigint; v_via2 bigint; v_rengs jsonb; v_movs jsonb; v_cob record; v_ult text;
begin
  perform seguridad.exigir_rol(array['socio']);
  if partes[1] = 'inventario' and partes[2] = 'valor' then
    select coalesce(sum(valor_cent), 0) into v_via1 from operacion.existencia_modelo;
    select coalesce(sum(valor_cent), 0) into v_via2 from operacion.movimiento_inventario;
    select coalesce(jsonb_agg(jsonb_build_object('concepto', ma.nombre || ' ' || m.nombre_canonico || ' · ' || e.piezas || ' pz a costo promedio', 'monto_cent', e.valor_cent) order by ma.nombre, m.nombre_canonico), '[]'::jsonb)
      into v_rengs from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id join catalogo.marca ma on ma.id = m.marca_id where e.piezas > 0;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Valor del inventario', 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma del valor por modelo (kárdex)', 'via1_valor', v_via1, 'via2', 'Entradas menos salidas del libro de movimientos', 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'cobertura' and partes[2] = 'modelo' then
    v_id := partes[3]::bigint;
    select * into v_cob from operacion.cobertura() c where c.nivel = 'modelo' and c.modelo_id = v_id;
    if not found then raise exception 'el modelo no tiene existencias registradas' using errcode = '22023'; end if;
    v_via1 := v_cob.disponible;
    select coalesce(sum(u.piezas), 0) - coalesce((select sum(r.piezas) from operacion.reserva r join catalogo.sku k on k.id = r.sku_id where k.modelo_id = v_id and r.estado = 'activa'), 0)
      into v_via2 from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id where k.modelo_id = v_id and u.ubicacion = 'bodega_omar';
    select coalesce(jsonb_agg(jsonb_build_object('hora', mi.hora, 'fecha_neg', mi.fecha_neg, 'tipo', mi.tipo, 'sabor', sa.nombre_canonico, 'ubicacion', ub.nombre, 'cantidad', mi.cantidad, 'saldo', mi.piezas_modelo_despues,
              'valor_cent', mi.valor_cent, 'evento', e.folio, 'canal', e.canal, 'mensaje_origen', e.mensaje_origen, 'autor', (select coalesce(u.socio_nombre, u.rol) from seguridad.usuario u where u.id = e.actor_id), 'reversa_de', mi.reversa_de) order by mi.id desc), '[]'::jsonb)
      into v_movs from operacion.movimiento_inventario mi join operacion.evento e on e.id = mi.evento_id join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.ubicacion ub on ub.codigo = mi.ubicacion
     where mi.modelo_id = v_id and mi.tipo in ('salida_pedido', 'salida_toma_omar', 'reversa') and mi.fecha_neg > negocio.hoy() - catalogo.config_num('demanda_ventana_dias')::int;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Disponible del modelo (' || coalesce(round(v_cob.dias, 1)::text || ' días de cobertura', 'sin cobertura calculable') || '): existencia menos lo apartado', 'valor', v_via1, 'unidad', 'pz',
      'comprobacion', jsonb_build_object('via1', 'Disponible según el semáforo (' || v_cob.salidas || ' salidas en ' || v_cob.dias_efectivos || ' días con existencia)', 'via1_valor', v_via1,
                                         'via2', 'Existencia en la bodega menos reservas activas', 'via2_valor', v_via2, 'cuadra', v_via1 = greatest(v_via2, 0)),
      'movimientos', v_movs);
  end if;
  return api.explicar_cifra_base(p_cifra);
end $$;

-- ---------------------------------------------------------------------------
-- Umbrales de las paginas de paquetes (adenda 27): antiguedad sin empacar o enviar, y plazo del proveedor mas dias de gracia para un paquete en trayecto.
-- ---------------------------------------------------------------------------
create function api.paquetes_umbrales() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('horas_sin_empacar', catalogo.config_num('paquete_horas_sin_empacar'), 'trayecto_dias_extra', catalogo.config_num('trayecto_dias_extra'),
    'plazo_dias', jsonb_build_object('Isaac', catalogo.config_num('lt_dias_isaac'), 'Karen', catalogo.config_num('lt_dias_karen')));
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema operacion, catalogo from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function api.inventario_completo(), api.inventario_kardex(bigint, bigint, date, date, int), api.abrir_conteo(text, text, text, timestamptz), api.conteo_hoja(text),
  api.conteo_previsualizar(text, jsonb), api.cerrar_conteo(text, bigint, jsonb), api.conteos_lista(), api.conteo_detalle(bigint), api.reservar_documento_inventario(text, text, jsonb),
  api.completar_documento_inventario(bigint, text, text), api.documento_inventario(bigint), api.documentos_inventario(), api.explicar_cifra(text), api.paquetes_umbrales() to authenticated;
revoke execute on function api.explicar_cifra_base(text) from authenticated;
