-- Evaluadores de avisos de inventario, compras, proveedores, clientes y pedidos. SOLO LECTURA: cada _ev_* devuelve candidatos (clave estable, canal opcional, payload con cifras de SQL).
-- Ninguno escribe costos, precios, inventario ni dinero. El orquestador agente.avisos_inventario_evaluar los encola (emitir), los carga como historico (silencioso) o los lista (simular).
-- Fechas en America/Merida (negocio.hoy). Los nombres de modelo, sabor y cliente viajan tal cual; TypeScript los muestra y pone modelos y sabores en mayusculas.

-- Piezas en transito por sabor: lo pagado a un proveedor que aun no se recibe (compras que van a bodega).
create function agente._transito_sku() returns table (sku_id bigint, transito int, llega date)
language sql stable security definer set search_path = ''
as $$
  select catalogo.sku_vigente(l.sku_id), sum(greatest(l.piezas_pagadas - greatest(coalesce(l.piezas_recibidas, 0), coalesce((select sum(r.piezas) from operacion.compra_recepcion r where r.compra_linea_id = l.id), 0)), 0))::int, min(c.llegada_estimada)
    from operacion.compra c join operacion.compra_linea l on l.compra_id = c.id
   where c.destino = 'bodega' and c.estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida', 'recibida_parcial')
   group by 1
$$;

-- INV-1 Reposicion por sabor (cobertura incluye transito; sin 28 dias de historia, minimo manual por modelo y sabor, etiquetado como estimado).
create function agente._ev_inv_reponer(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select catalogo.config_num('historia_minima_dias')::int as hist, catalogo.config_num('demanda_min_salidas_sabor')::int as minsal, catalogo.config_num('ciclo_pedido_dias') as ciclo,
                      (select coalesce((r.umbral ->> 'urge_top')::int, 5) from agente.aviso_regla r where r.codigo = 'inv_reponer') as topn),
  cob as (select * from operacion.cobertura(p_hoy)),
  top as (select x.modelo_id from cob x where x.nivel = 'modelo' order by x.salidas desc, x.modelo_id limit (select topn from cfg)),
  tr as (select * from agente._transito_sku()),
  b as (
    select s.sku_id, s.modelo_id, s.disponible, s.demanda, s.salidas, s.lt_dias, coalesce(t.transito, 0) as transito, t.llega, mm.min_pz,
           (s.dias_historia >= cfg.hist) as firme, cfg.ciclo, cfg.minsal
      from cob s cross join cfg left join tr t on t.sku_id = s.sku_id left join agente.minimo_manual mm on mm.sku_id = s.sku_id and mm.vigente_hasta is null
     where s.nivel = 'sku')
  select 'inv_reponer|' || b.sku_id,
         case when b.firme and b.demanda > 0 and b.disponible / b.demanda < b.lt_dias and b.modelo_id in (select modelo_id from top) then 'I' end,
         jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sb.nombre_canonico, 'disponible', b.disponible, 'transito', b.transito, 'llega', b.llega, 'minimo', b.min_pz,
                            'estado', case when b.firme then 'firme' else 'estimado' end,
                            'dias', case when b.demanda > 0 then round(b.disponible / b.demanda, 1) end,
                            'urge', b.firme and b.demanda > 0 and b.disponible / b.demanda < b.lt_dias)
    from b join catalogo.modelo m on m.id = b.modelo_id join catalogo.sku k on k.id = b.sku_id join catalogo.sabor sb on sb.id = k.sabor_id
   where b.disponible > 0
     and case when b.firme then b.demanda > 0 and b.salidas >= b.minsal and (b.disponible + b.transito) / b.demanda < b.lt_dias + b.ciclo
              else b.min_pz is not null and b.disponible + b.transito <= b.min_pz end
$$;

-- INV-2 Sabor agotado: existencia cero, vendio en la ventana de demanda y no hay compra en camino.
create function agente._ev_inv_agotado(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'inv_agotado|' || s.sku_id, null::text,
         jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sb.nombre_canonico, 'vendidas_ventana', s.salidas)
    from operacion.cobertura(p_hoy) s join catalogo.modelo m on m.id = s.modelo_id join catalogo.sku k on k.id = s.sku_id join catalogo.sabor sb on sb.id = k.sabor_id
   where s.nivel = 'sku' and s.fisico = 0 and s.salidas > 0 and not exists (select 1 from agente._transito_sku() t where t.sku_id = s.sku_id and t.transito > 0)
$$;

-- OC-1 Llegada esperada hoy o manana.
create function agente._ev_oc_llega(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'oc_llega|' || c.id || '|' || c.llegada_estimada, null::text,
         jsonb_build_object('folio', c.folio, 'proveedor', pr.nombre, 'llegada', c.llegada_estimada, 'es_hoy', c.llegada_estimada = p_hoy,
                            'piezas', (select sum(l.piezas_pagadas) from operacion.compra_linea l where l.compra_id = c.id))
    from operacion.compra c join catalogo.proveedor pr on pr.id = c.proveedor_id
   where c.destino = 'bodega' and c.estado in ('confirmada', 'enviada', 'en_trayecto') and c.llegada_estimada between p_hoy and p_hoy + 1
$$;

-- OC-2 Compra atrasada (con fecha estimada vencida, o sin fecha y pasado el plazo del proveedor mas la holgura). Desde 2 dias sale como inmediato.
create function agente._ev_oc_atraso(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'escalar_dias')::int, 2) as esc, coalesce((r.umbral ->> 'holgura_sin_fecha')::int, 2) as holg from agente.aviso_regla r where r.codigo = 'oc_atraso'),
  b as (
    select c.*, pr.nombre as prov, cfg.esc,
           case when c.llegada_estimada is not null then p_hoy - c.llegada_estimada
                else p_hoy - coalesce(c.enviada_fecha, c.fecha_neg) - coalesce(catalogo.config_num('lt_dias_' || lower(pr.nombre))::int, 7) - cfg.holg end as atraso
      from operacion.compra c join catalogo.proveedor pr on pr.id = c.proveedor_id cross join cfg
     where c.destino = 'bodega' and c.estado in ('confirmada', 'enviada', 'en_trayecto'))
  select 'oc_atraso|' || b.id, case when b.atraso >= b.esc then 'I' end,
         jsonb_build_object('folio', b.folio, 'proveedor', b.prov, 'dias_atraso', b.atraso, 'esperada', b.llegada_estimada, 'sin_fecha', b.llegada_estimada is null,
                            'valor_cent', b.mercancia_cent, 'piezas', (select sum(l.piezas_pagadas) from operacion.compra_linea l where l.compra_id = b.id))
    from b where b.atraso > 0
$$;

-- OC-3 Compra sin fecha de llegada o de envio (higiene: sin ella no hay llegada esperada ni atraso).
create function agente._ev_oc_sin_fecha(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  select 'oc_sin_fecha|' || c.id, null::text,
         jsonb_build_object('folio', c.folio, 'proveedor', pr.nombre, 'falta', case when c.estado = 'confirmada' then 'llegada' else 'envio' end,
                            'piezas', (select sum(l.piezas_pagadas) from operacion.compra_linea l where l.compra_id = c.id))
    from operacion.compra c join catalogo.proveedor pr on pr.id = c.proveedor_id
   where c.destino = 'bodega' and ((c.estado = 'confirmada' and c.llegada_estimada is null and c.fecha_neg < p_hoy) or (c.estado in ('enviada', 'en_trayecto') and c.enviada_fecha is null))
$$;

-- OC-4 Recepcion parcial pendiente y faltantes por reclamar.
create function agente._ev_oc_faltante(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'dias_min')::int, 3) as dmin, coalesce((r.umbral ->> 'antigua_dias')::int, 7) as ant from agente.aviso_regla r where r.codigo = 'oc_faltante'),
  f as (
    select c.id, c.folio, pr.nombre as prov, c.estado,
           (select coalesce(sum(d.piezas), 0) from operacion.compra_diferencia d where d.compra_id = c.id and d.tipo = 'faltante')::int as falt,
           (select coalesce(sum(d.valor_cent), 0) from operacion.compra_diferencia d where d.compra_id = c.id and d.tipo = 'faltante')::bigint as valor,
           (select coalesce(sum(greatest(l.piezas_facturadas - greatest(coalesce(l.piezas_recibidas, 0), coalesce((select sum(r.piezas) from operacion.compra_recepcion r where r.compra_linea_id = l.id), 0)), 0)), 0) from operacion.compra_linea l where l.compra_id = c.id)::int as pend,
           (select (min(d.abierta_at) at time zone 'America/Merida')::date from operacion.compra_diferencia d where d.compra_id = c.id and d.tipo = 'faltante') as desde,
           (select (max(r.contado_at) at time zone 'America/Merida')::date from operacion.compra_recepcion r where r.compra_id = c.id) as ult_rec
      from operacion.compra c join catalogo.proveedor pr on pr.id = c.proveedor_id where c.estado in ('recibida_parcial', 'recibida'))
  select 'oc_faltante|' || f.id, null::text,
         jsonb_build_object('folio', f.folio, 'proveedor', f.prov, 'tipo', case when f.estado = 'recibida_parcial' then 'parcial' else 'faltante' end,
                            'piezas', case when f.estado = 'recibida_parcial' then f.pend else f.falt end, 'valor_cent', f.valor,
                            'dias', p_hoy - coalesce(f.desde, f.ult_rec), 'antigua', p_hoy - coalesce(f.desde, f.ult_rec) >= cfg.ant)
    from f cross join cfg
   where case when f.estado = 'recibida_parcial' then f.pend > 0 and p_hoy - coalesce(f.ult_rec, p_hoy) >= cfg.dmin else f.falt > 0 and p_hoy - f.desde >= cfg.dmin end
$$;

-- OC-5 Resumen de llegada: una vez por recepcion. Sabores nuevos para el catalogo propio y reposiciones que se cierran.
create function agente._ev_oc_llego(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with rec as (
    select r.compra_id, max(r.id) as ult, sum(r.piezas)::int as recibidas, min(r.contado_at) as desde
      from operacion.compra_recepcion r where (r.contado_at at time zone 'America/Merida')::date >= p_hoy - 1 group by r.compra_id)
  select 'oc_llego|' || c.id || '|' || rec.ult, 'I',
         jsonb_build_object('folio', c.folio, 'proveedor', pr.nombre, 'recibidas', rec.recibidas,
           'facturadas', (select sum(l.piezas_facturadas) from operacion.compra_linea l where l.compra_id = c.id),
           'parcial', c.estado = 'recibida_parcial',
           'sabores_nuevos', coalesce((
             select jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sb.nombre_canonico, 'piezas', q.pz) order by q.pz desc)
               from (select r2.sku_id, sum(r2.piezas)::int as pz from operacion.compra_recepcion r2 where r2.compra_id = c.id group by r2.sku_id) q
               join catalogo.sku k on k.id = q.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sb on sb.id = k.sabor_id
              where not exists (select 1 from operacion.compra_recepcion r3 where r3.sku_id = q.sku_id and r3.compra_id <> c.id and r3.contado_at < rec.desde)), '[]'::jsonb),
           'repone', coalesce((
             select jsonb_agg(distinct m.nombre_canonico || ' ' || sb.nombre_canonico)
               from operacion.compra_recepcion r2 join catalogo.sku k on k.id = r2.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sb on sb.id = k.sabor_id
              where r2.compra_id = c.id and exists (select 1 from agente.aviso_cola q where q.estado in ('pendiente', 'enviado') and q.clave in ('inv_reponer|' || r2.sku_id, 'inv_agotado|' || r2.sku_id))), '[]'::jsonb),
           'diferencias', (select count(*) from operacion.compra_diferencia d where d.compra_id = c.id and d.tipo = 'faltante'))
    from rec join operacion.compra c on c.id = rec.compra_id join catalogo.proveedor pr on pr.id = c.proveedor_id
$$;

-- INV-5 Los mas vendidos que ya llegaron con el proveedor (monitor de Karen: sabores o modelos nuevos o de regreso en la ventana).
create function agente._ev_prv_llego(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'top')::int, 10) as topn, coalesce((r.umbral ->> 'min_piezas_28d')::int, 6) as minp, coalesce((r.umbral ->> 'ventana_dias')::int, 7) as vent from agente.aviso_regla r where r.codigo = 'prv_llego'),
  vta as (
    select l.modelo_id, sum(l.piezas_pedidas)::int as p28 from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id
     where pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > p_hoy - 28 group by l.modelo_id),
  rk as (select v.modelo_id, v.p28, dense_rank() over (order by v.p28 desc) as r from vta v),
  ev as (
    select e.producto_id, e.variante_id, e.tipo, e.en, pm.canonico_id::bigint as modelo_id
      from proveedores.evento e join proveedores.modelo pm on pm.producto_id = e.producto_id cross join cfg
     where e.tipo in ('sabor_nuevo', 'sabor_regreso', 'modelo_nuevo', 'modelo_regreso_catalogo') and pm.canonico_id is not null
       and (e.en at time zone 'America/Merida')::date >= p_hoy - cfg.vent)
  select 'prv_llego|' || ev.producto_id || '|' || to_char(max(ev.en) at time zone 'America/Merida', 'YYYYMMDD'),
         case when rk.r <= 3 then 'I' end,
         jsonb_build_object('modelo', m.nombre_canonico, 'proveedor', 'Karen', 'posicion', rk.r, 'piezas_28d', rk.p28,
           'modelo_nuevo', bool_or(ev.tipo in ('modelo_nuevo', 'modelo_regreso_catalogo')),
           'sabores', coalesce((select jsonb_agg(distinct v.sabor_original) from proveedores.variante v where v.variante_id = any (array_agg(ev.variante_id)) and v.disponible), '[]'::jsonb))
    from ev join rk on rk.modelo_id = ev.modelo_id cross join cfg join catalogo.modelo m on m.id = ev.modelo_id
   where rk.r <= cfg.topn and rk.p28 >= cfg.minp
   group by ev.producto_id, rk.r, rk.p28, m.nombre_canonico
$$;

-- PRV-10 Cambio de costo de lista REGISTRADO y su efecto en margen. Solo bandera, sentido y porcentaje entero: nunca el importe del proveedor. No cambia nada.
create function agente._ev_prv_costo(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'margen_min_pct')::int, 5) as mmin, coalesce((r.umbral ->> 'ventana_dias')::int, 3) as vent from agente.aviso_regla r where r.codigo = 'prv_costo'),
  n as (
    select cp.id, cp.proveedor_id, cp.modelo_id, cp.costo_cent, cp.vigente_hasta,
           (select q.costo_cent from catalogo.costo_proveedor q where q.proveedor_id = cp.proveedor_id and q.modelo_id = cp.modelo_id and q.id < cp.id order by q.id desc limit 1) as previo
      from catalogo.costo_proveedor cp cross join cfg
     where cp.es_lista and (cp.creado_en at time zone 'America/Merida')::date >= p_hoy - cfg.vent),
  e as (
    select n.*, round(abs(n.costo_cent - n.previo) * 100.0 / n.previo)::int as pct,
           (select count(*) from catalogo.tabulador_precio t where t.modelo_id = n.modelo_id and t.vigente_hasta is null and t.precio_cent > 0)::int as clientes,
           (select count(*) from catalogo.tabulador_precio t where t.modelo_id = n.modelo_id and t.vigente_hasta is null and t.precio_cent > 0
               and (t.precio_cent - n.costo_cent) * 100.0 / t.precio_cent < cfg.mmin)::int as bajo,
           (select floor(min((t.precio_cent - n.costo_cent) * 100.0 / t.precio_cent))::int from catalogo.tabulador_precio t where t.modelo_id = n.modelo_id and t.vigente_hasta is null and t.precio_cent > 0) as peor
      from n cross join cfg where n.previo is not null and n.previo > 0 and n.costo_cent <> n.previo and n.vigente_hasta is null)
  select 'prv_costo|' || e.id, case when e.bajo > 0 then 'I' end,
         jsonb_build_object('modelo', m.nombre_canonico, 'proveedor', pr.nombre, 'sentido', case when e.costo_cent > e.previo then 'sube' else 'baja' end, 'pct', e.pct,
                            'clientes', e.clientes, 'clientes_bajo_minimo', e.bajo, 'peor_margen_pct', e.peor, 'margen_min_pct', cfg.mmin)
    from e cross join cfg join catalogo.modelo m on m.id = e.modelo_id join catalogo.proveedor pr on pr.id = e.proveedor_id
$$;

-- PUENTE del monitor de proveedores: toma los avisos YA confirmados del monitor (deduplicados y con umbral de confianza en su ciclo) y decide el canal por relevancia para lo que vendemos.
create function agente._ev_prv_puente(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'ventana_dias')::int, 3) as vent, coalesce((r.umbral ->> 'puffs_interes')::int, 15000) as puffs from agente.aviso_regla r where r.codigo = 'prv_puente'),
  a as (
    select av.id, av.codigo, av.titulo, av.payload, pm.canonico_id::bigint as modelo_id, pm.marca, pm.puffs, pm.titulo as titulo_modelo
      from operacion.aviso av cross join cfg left join proveedores.modelo pm on pm.producto_id = av.payload ->> 'entidad'
     where av.estado = 'abierta' and av.creado_at >= p_ahora - make_interval(days => cfg.vent)
       and av.codigo in ('proveedor_modelo_nuevo', 'proveedor_sabor_nuevo', 'proveedor_sabor_agotado', 'proveedor_modelo_agotado', 'proveedor_regreso', 'proveedor_descontinuado',
                         'proveedor_poca_variedad', 'proveedor_cambios_sin_impacto', 'proveedor_nombres_por_confirmar', 'inventario_proveedores_degradado', 'lectura_retenida',
                         'promocion_nueva', 'promocion_anunciada', 'promocion_por_terminar', 'promocion_terminada')),
  r as (
    select a.*,
      (a.modelo_id is not null and exists (select 1 from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id where l.modelo_id = a.modelo_id and pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > p_hoy - 60)) as vendemos,
      (a.modelo_id is not null and (exists (select 1 from operacion.existencia_modelo em where em.modelo_id = a.modelo_id and em.piezas > 0) or exists (select 1 from agente._transito_sku() t join catalogo.sku k on k.id = t.sku_id where k.modelo_id = a.modelo_id))) as propio,
      (a.marca is not null and exists (select 1 from catalogo.marca mk join catalogo.modelo mo on mo.marca_id = mk.id join operacion.pedido_linea l on l.modelo_id = mo.id join operacion.pedido pe on pe.id = l.pedido_id
                                        where mk.nombre_norm = catalogo.normalizar(a.marca) and pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > p_hoy - 60)) as marca_vendida
      from a)
  select 'prv_puente|' || r.id,
         case r.codigo
           when 'inventario_proveedores_degradado' then 'I' when 'lectura_retenida' then 'I'
           when 'proveedor_modelo_nuevo' then case when r.marca_vendida or coalesce(r.puffs, 0) >= (select puffs from cfg) then 'I' else 'R' end
           when 'proveedor_sabor_nuevo' then case when r.vendemos then 'M' else 'R' end
           when 'proveedor_sabor_agotado' then case when r.vendemos or r.propio then 'I' else 'R' end
           when 'proveedor_modelo_agotado' then case when r.vendemos or r.propio then 'I' else 'R' end
           when 'proveedor_regreso' then case when r.vendemos then 'M' else 'R' end
           when 'proveedor_descontinuado' then case when r.propio then 'I' else 'R' end
           when 'promocion_nueva' then case when r.vendemos then 'M' else 'R' end
           when 'promocion_por_terminar' then case when r.propio then 'M' else 'R' end
           else 'R' end,
         jsonb_build_object('aviso_id', r.id, 'tipo', r.codigo, 'modelo', r.titulo_modelo, 'vendemos', r.vendemos, 'propio', r.propio, 'texto', r.titulo)
    from r
$$;

-- CLI-3 Cliente sin comprar respecto a su ritmo.
create function agente._ev_cli_sin_comprar(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'min_pedidos')::int, 3) as minp, coalesce((r.umbral ->> 'ventana_dias')::int, 90) as vent, coalesce((r.umbral ->> 'factor')::numeric, 2) as fac, coalesce((r.umbral ->> 'piso_dias')::int, 21) as piso from agente.aviso_regla r where r.codigo = 'cli_sin_comprar'),
  ped as (
    select pe.cliente_id, pe.fecha_neg, pe.folio, pe.id, pe.fecha_neg - lag(pe.fecha_neg) over (partition by pe.cliente_id order by pe.fecha_neg, pe.id) as d
      from operacion.pedido pe cross join cfg where pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > p_hoy - cfg.vent),
  g as (select ped.cliente_id, count(*)::int as n, percentile_cont(0.5) within group (order by ped.d) as m, max(ped.fecha_neg) as ultimo from ped group by ped.cliente_id)
  select 'cli_sin_comprar|' || g.cliente_id || '|' || g.ultimo, null::text,
         jsonb_build_object('cliente', c.nombre_canonico, 'dias', p_hoy - g.ultimo, 'intervalo', round(g.m::numeric, 0), 'pedidos', g.n)
    from g cross join cfg join catalogo.cliente c on c.id = g.cliente_id
   where g.n >= cfg.minp and g.m is not null and p_hoy - g.ultimo > greatest(cfg.fac * g.m, cfg.piso)
$$;

-- CLI-6 Cliente con saldo vencido que pide mas (el socio decide si se surte).
create function agente._ev_cli_vencido_pide(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with v as (
    select pe.id, pe.folio, pe.cliente_id,
           (select coalesce(sum(operacion.pedido_saldo(q.id)), 0) from operacion.pedido q where q.cliente_id = pe.cliente_id and q.id <> pe.id and q.estado = 'enviado' and q.plazo_dias is not null
               and q.fecha_envio + q.plazo_dias < p_hoy and operacion.pedido_saldo(q.id) > 0)::bigint as vencido,
           (select coalesce(max(p_hoy - (q.fecha_envio + q.plazo_dias)), 0) from operacion.pedido q where q.cliente_id = pe.cliente_id and q.id <> pe.id and q.estado = 'enviado' and q.plazo_dias is not null
               and q.fecha_envio + q.plazo_dias < p_hoy and operacion.pedido_saldo(q.id) > 0)::int as dias
      from operacion.pedido pe where pe.estado in ('confirmado', 'enviado') and (pe.creado_at at time zone 'America/Merida')::date >= p_hoy - 1)
  select 'cli_vencido_pide|' || v.id, 'I',
         jsonb_build_object('cliente', c.nombre_canonico, 'folio', v.folio, 'vencido_cent', v.vencido, 'dias_vencido', v.dias,
           'piezas', (select sum(l.piezas_pedidas) from operacion.pedido_linea l where l.pedido_id = v.id),
           'importe_cent', (select sum(l.piezas_pedidas * l.precio_cent) from operacion.pedido_linea l where l.pedido_id = v.id))
    from v join catalogo.cliente c on c.id = v.cliente_id where v.vencido > 0
$$;

-- CLI-5 Concentracion de cartera (y participacion en ventas): sale solo al cambiar de banda.
create function agente._ev_cli_concentracion(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'top1_pct')::int, 40) as t1, coalesce((r.umbral ->> 'top2_pct')::int, 70) as t2, coalesce((r.umbral ->> 'min_clientes')::int, 2) as minc from agente.aviso_regla r where r.codigo = 'cli_concentracion'),
  s as (select pe.cliente_id, sum(operacion.pedido_saldo(pe.id))::bigint as saldo from operacion.pedido pe where pe.estado = 'enviado' group by pe.cliente_id having sum(operacion.pedido_saldo(pe.id)) > 0),
  o as (select s.cliente_id, s.saldo, row_number() over (order by s.saldo desc, s.cliente_id) as rn, sum(s.saldo) over () as total, count(*) over () as n from s),
  t as (select max(o.total) as total, max(o.n) as n, max(o.saldo) filter (where o.rn = 1) as s1, coalesce(max(o.saldo) filter (where o.rn = 2), 0) as s2, max(o.cliente_id) filter (where o.rn = 1) as c1 from o),
  vt as (
    select l.pedido_id, pe.cliente_id, sum(l.piezas_pedidas * l.precio_cent)::bigint as imp from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id
     where pe.estado in ('confirmado', 'enviado') and pe.fecha_neg > p_hoy - 28 group by l.pedido_id, pe.cliente_id),
  vc as (select vt.cliente_id, sum(vt.imp) as imp, sum(sum(vt.imp)) over () as total from vt group by vt.cliente_id),
  v1 as (select vc.cliente_id, vc.imp, vc.total from vc order by vc.imp desc limit 1),
  b as (select t.*, floor(t.s1 * 100.0 / t.total)::int as p1, floor((t.s1 + t.s2) * 100.0 / t.total)::int as p2 from t cross join cfg where t.total > 0 and t.n >= cfg.minc)
  select 'cli_concentracion|' || case when b.p1 >= 70 then 70 when b.p1 >= 55 then 55 when b.p1 >= cfg.t1 then cfg.t1 else 0 end || '|' || (b.p2 >= cfg.t2), null::text,
         jsonb_build_object('cartera_cent', b.total, 'cliente', c.nombre_canonico, 'pct_top1', b.p1, 'pct_top2', b.p2, 'clientes_con_saldo', b.n,
                            'ventas_top_pct', (select floor(v1.imp * 100.0 / v1.total)::int from v1), 'ventas_top_cliente', (select cc.nombre_canonico from v1 join catalogo.cliente cc on cc.id = v1.cliente_id))
    from b cross join cfg join catalogo.cliente c on c.id = b.c1 where b.p1 >= cfg.t1 or b.p2 >= cfg.t2
$$;

-- PED-1 Pedidos de bodega sin empacar o empacados sin enviar.
create function agente._ev_ped_pendiente_envio(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'horas_empacar')::int, 4) as he, coalesce((r.umbral ->> 'horas_enviar')::int, 24) as hv from agente.aviso_regla r where r.codigo = 'ped_pendiente_envio')
  select 'ped_envio|' || pe.id || '|' || case when pe.empacado_at is null then 'empacar' else 'enviar' end, null::text,
         jsonb_build_object('folio', pe.folio, 'cliente', c.nombre_canonico, 'etapa', case when pe.empacado_at is null then 'empacar' else 'enviar' end,
           'piezas', (select sum(l.piezas_pedidas) from operacion.pedido_linea l where l.pedido_id = pe.id),
           'horas', floor(extract(epoch from (p_ahora - coalesce(pe.empacado_at, pe.creado_at))) / 3600)::int)
    from operacion.pedido pe cross join cfg join catalogo.cliente c on c.id = pe.cliente_id
   where pe.estado = 'confirmado' and pe.origen = 'bodega_omar'
     and ((pe.empacado_at is null and pe.creado_at < p_ahora - make_interval(hours => cfg.he)) or (pe.empacado_at is not null and pe.enviado_at is null and pe.empacado_at < p_ahora - make_interval(hours => cfg.hv)))
$$;

-- PED-2 Guia pendiente: flujo en dos tiempos (primero se envia el pedido con su paqueteria; la guia llega despues).
create function agente._ev_ped_guia_pendiente(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'horas')::int, 24) as h from agente.aviso_regla r where r.codigo = 'ped_guia_pendiente')
  select 'ped_guia|' || pe.id, null::text,
         jsonb_build_object('folio', pe.folio, 'cliente', c.nombre_canonico, 'paqueteria', pe.paqueteria, 'horas', floor(extract(epoch from (p_ahora - pe.enviado_at)) / 3600)::int)
    from operacion.pedido pe cross join cfg join catalogo.cliente c on c.id = pe.cliente_id
   where pe.estado = 'enviado' and pe.paqueteria is not null and pe.enviado_at < p_ahora - make_interval(hours => cfg.h)
     and not exists (select 1 from operacion.guia g where g.pedido_id = pe.id and g.sentido = 'salida')
$$;

-- PED-3 Enviado sin entrega confirmada (a los 10 dias sale una segunda vez como inmediato).
create function agente._ev_ped_sin_entrega(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'dias')::int, 4) as d, coalesce((r.umbral ->> 'escalar_dias')::int, 10) as esc, coalesce((r.umbral ->> 'solo_bodega')::boolean, true) as sb from agente.aviso_regla r where r.codigo = 'ped_sin_entrega')
  select 'ped_entrega|' || pe.id || '|' || case when p_hoy - pe.fecha_envio >= cfg.esc then 'esc' else 'n' end,
         case when p_hoy - pe.fecha_envio >= cfg.esc then 'I' end,
         jsonb_build_object('folio', pe.folio, 'cliente', c.nombre_canonico, 'dias', p_hoy - pe.fecha_envio, 'paqueteria', pe.paqueteria)
    from operacion.pedido pe cross join cfg join catalogo.cliente c on c.id = pe.cliente_id
   where pe.estado = 'enviado' and pe.entregado_at is null and pe.fecha_envio < p_hoy - cfg.d and (not cfg.sb or pe.origen = 'bodega_omar')
$$;

-- DIN-9 Descuento inusual (mayor al umbral del importe de las lineas).
create function agente._ev_din_descuento(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'pct')::int, 5) as pct, coalesce((r.umbral ->> 'ventana_dias')::int, 2) as vent from agente.aviso_regla r where r.codigo = 'din_descuento'),
  d as (select pe.id, pe.folio, pe.cliente_id, pe.descuento_cent, (select sum(l.piezas_pedidas * l.precio_cent) from operacion.pedido_linea l where l.pedido_id = pe.id)::bigint as imp
          from operacion.pedido pe cross join cfg where pe.estado in ('confirmado', 'enviado') and pe.descuento_cent > 0 and (pe.creado_at at time zone 'America/Merida')::date >= p_hoy - cfg.vent)
  select 'din_descuento|' || d.id, 'I',
         jsonb_build_object('folio', d.folio, 'cliente', c.nombre_canonico, 'pct', round(d.descuento_cent * 100.0 / d.imp)::int, 'descuento_cent', d.descuento_cent)
    from d cross join cfg join catalogo.cliente c on c.id = d.cliente_id where d.imp > 0 and d.descuento_cent * 100.0 / d.imp > cfg.pct
$$;

-- CLI-7 Posible pago duplicado: mismo cliente, monto y cuenta en menos de 48 horas.
create function agente._ev_cli_pago_dup(p_hoy date, p_ahora timestamptz) returns table (k text, c text, p jsonb)
language sql stable security definer set search_path = ''
as $$
  with cfg as (select coalesce((r.umbral ->> 'horas')::int, 48) as h from agente.aviso_regla r where r.codigo = 'cli_pago_dup')
  select 'cli_pago_dup|' || b.id, 'I',
         jsonb_build_object('cliente', c.nombre_canonico, 'monto_cent', b.monto_cent, 'folio', b.folio, 'folio_previo', a.folio)
    from operacion.pago b cross join cfg
    join operacion.pago a on a.cliente_id = b.cliente_id and a.monto_cent = b.monto_cent and a.cuenta_destino_id = b.cuenta_destino_id and a.tipo = b.tipo and a.id < b.id and b.hora - a.hora <= make_interval(hours => cfg.h)
    join catalogo.cliente c on c.id = b.cliente_id
   where b.tipo = 'abono' and b.hora >= p_ahora - interval '3 days'
$$;

-- ------------------------------------------------------------------ orquestador
-- 'emitir': encola los candidatos de las reglas ACTIVAS (requiere el interruptor general). 'silencioso': carga todo lo vigente como historico (para encender una regla sin que salga el pasado).
-- 'simular': solo lista candidatos, no escribe nada y funciona con todo apagado.
create function agente.avisos_inventario_evaluar(p_hoy date default null, p_modo text default 'emitir', p_ahora timestamptz default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); v_ahora timestamptz := coalesce(p_ahora, clock_timestamp()); r agente.aviso_regla; c record;
  v_res jsonb := '{}'::jsonb; v_n int; v_cand jsonb := '[]'::jsonb; v_id bigint;
  v_general boolean := coalesce((select i.activo from seguridad.interruptor i where i.clave = 'avisos_inventario'), false);
begin
  perform notificacion.exigir_sistema();
  if p_modo not in ('emitir', 'silencioso', 'simular') then raise exception 'modo invalido' using errcode = '22023'; end if;
  if p_modo = 'emitir' and not v_general then return jsonb_build_object('estado', 'apagado', 'motivo', 'interruptor_avisos_inventario'); end if;
  for r in select * from agente.aviso_regla x where x.codigo <> '_tope' and x.codigo <> 'prv_lista' and (p_modo <> 'emitir' or x.activo) order by x.codigo loop
    v_n := 0;
    for c in execute format('select k, c, p from agente.%I($1, $2)', '_ev_' || r.codigo) using v_hoy, v_ahora loop
      if p_modo = 'simular' then
        v_cand := v_cand || jsonb_build_array(jsonb_build_object('codigo', r.codigo, 'clave', c.k, 'canal', coalesce(c.c, r.canal), 'payload', c.p));
        v_n := v_n + 1;
      else
        v_id := agente.aviso_encolar(r.codigo, c.k, c.p, c.c, case when p_modo = 'silencioso' then 'historico' else 'pendiente' end);
        if v_id is not null then v_n := v_n + 1; end if;
      end if;
    end loop;
    v_res := v_res || jsonb_build_object(r.codigo, v_n);
  end loop;
  return jsonb_build_object('estado', 'ok', 'modo', p_modo, 'nuevos', v_res) || case when p_modo = 'simular' then jsonb_build_object('candidatos', v_cand) else '{}'::jsonb end;
end $$;

do $perm$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'agente'::regnamespace and (p.proname like '\_ev\_%' or p.proname = '_transito_sku') loop
    execute format('revoke all on function %s from public, anon, authenticated, servidor', f);
  end loop;
end $perm$;
revoke all on function agente.avisos_inventario_evaluar(date, text, timestamptz) from public, anon, authenticated;
grant execute on function agente.avisos_inventario_evaluar(date, text, timestamptz) to servidor;
