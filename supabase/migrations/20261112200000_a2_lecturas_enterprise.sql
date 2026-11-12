-- Rediseno etapa 2 (A2): funciones de LECTURA aditivas para las vistas enterprise de inventario, valuacion, caja y libro de dinero.
-- No cambia tablas, triggers, funciones existentes ni el modelo contable. Todas son api.* de solo lectura (stable), solo para socios,
-- security definer con search_path vacio; nada ejecutable por anon. El valor por sabor es "valor a costo del modelo":
-- piezas del sabor x costo promedio del modelo al momento del movimiento (la base solo guarda piezas por sabor).

-- ---------------------------------------------------------------------------
-- Kardex consolidado (todos los modelos, una marca, un modelo o un sabor) con saldo inicial, totales del periodo, pie y paginacion
-- ---------------------------------------------------------------------------
create function api.inventario_kardex_consolidado(
  p_marca text default null, p_modelo bigint default null, p_sku bigint default null, p_ini date default null, p_fin date default null,
  p_tipo text default null, p_q text default null, p_limite int default 200, p_desplazamiento int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
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
      left join lateral (select mi.piezas_sku_despues as p from operacion.movimiento_inventario mi where p_ini is not null and mi.sku_id = p_sku and mi.fecha_neg < p_ini order by mi.id desc limit 1) s on true
      left join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi where p_ini is not null and mi.modelo_id = v_sku_mod and mi.fecha_neg < p_ini order by mi.id desc limit 1) m on true;
    select coalesce(s.p, 0), case when m.p > 0 then negocio.redondear_medio_arriba(m.v * coalesce(s.p, 0), m.p) else 0 end into v_fin_p, v_fin_v
      from (select 1) z
      left join lateral (select mi.piezas_sku_despues as p from operacion.movimiento_inventario mi where mi.sku_id = p_sku and (p_fin is null or mi.fecha_neg <= p_fin) order by mi.id desc limit 1) s on true
      left join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi where mi.modelo_id = v_sku_mod and (p_fin is null or mi.fecha_neg <= p_fin) order by mi.id desc limit 1) m on true;
  end if;

  select coalesce(array_agg(mi.id), '{}') into v_f
    from operacion.movimiento_inventario mi join unnest(v_mods) g(mid) on g.mid = mi.modelo_id
      join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.modelo mo on mo.id = mi.modelo_id join operacion.evento e on e.id = mi.evento_id
     where (p_sku is null or mi.sku_id = p_sku) and (p_ini is null or mi.fecha_neg >= p_ini) and (p_fin is null or mi.fecha_neg <= p_fin) and (p_tipo is null or mi.tipo = p_tipo)
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
        'piezas', coalesce((select sum(u.piezas) from operacion.existencia_sku_ubicacion u where u.sku_id = k.id), 0),
        'piezas_modelo', coalesce((select e.piezas from operacion.existencia_modelo e where e.modelo_id = mo.id), 0),
        'valor_modelo_cent', coalesce((select e.valor_cent from operacion.existencia_modelo e where e.modelo_id = mo.id), 0),
        'ultima_entrada', (select max(mi.fecha_neg) from operacion.movimiento_inventario mi where mi.sku_id = k.id and mi.cantidad > 0 and mi.tipo = 'entrada_compra'),
        'ultima_salida', (select max(mi.fecha_neg) from operacion.movimiento_inventario mi where mi.sku_id = k.id and mi.tipo in ('salida_pedido', 'salida_toma_omar')),
        'cobertura_dias', (select round(c.dias, 1) from operacion.cobertura(v_hoy) c where c.nivel = 'sku' and c.sku_id = k.id),
        'estado', (select c.estado from operacion.cobertura(v_hoy) c where c.nivel = 'sku' and c.sku_id = k.id))
      into v_sabor
      from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id join catalogo.modelo mo on mo.id = k.modelo_id join catalogo.marca ma on ma.id = mo.marca_id where k.id = p_sku;
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
end $$;

-- ---------------------------------------------------------------------------
-- Detalle del periodo por modelo y por sabor (entradas, salidas, mermas, antiguedad); se une en pantalla con inventario_completo
-- ---------------------------------------------------------------------------
create function api.inventario_detalle(p_ini date default null, p_fin date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
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
    select k.id as sid, jsonb_build_object('sku_id', k.id, 'modelo_id', k.modelo_id,
        'entradas', coalesce(sum(mi.cantidad) filter (where mi.cantidad > 0 and mi.fecha_neg between v_ini and v_fin), 0),
        'salidas', coalesce(-sum(mi.cantidad) filter (where mi.cantidad < 0 and mi.fecha_neg between v_ini and v_fin), 0),
        'mermas', coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'merma' and mi.fecha_neg between v_ini and v_fin), 0),
        'ajustes', coalesce(sum(mi.cantidad) filter (where mi.tipo = 'ajuste_conteo' and mi.fecha_neg between v_ini and v_fin), 0),
        'ultima_entrada', max(mi.fecha_neg) filter (where mi.tipo = 'entrada_compra'),
        'ultima_salida', max(mi.fecha_neg) filter (where mi.tipo in ('salida_pedido', 'salida_toma_omar')),
        'piezas_inicial', (select x.piezas_sku_despues from operacion.movimiento_inventario x where x.sku_id = k.id and x.fecha_neg < v_ini order by x.id desc limit 1)) as j
      from catalogo.sku k join operacion.movimiento_inventario mi on mi.sku_id = k.id where mi.fecha_neg <= v_fin group by k.id) q;
  return jsonb_build_object('ini', v_ini, 'fin', v_fin, 'hoy', v_hoy, 'modelos', v_mod, 'sabores', v_sku);
end $$;

-- ---------------------------------------------------------------------------
-- Resumen por marca y proveedor
-- ---------------------------------------------------------------------------
create function api.inventario_resumen_marca(p_ini date default null, p_fin date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy(); v_fin date := coalesce(p_fin, negocio.hoy()); v_ini date := coalesce(p_ini, coalesce(p_fin, negocio.hoy()) - 29); v_filas jsonb; v_cuentas jsonb; v_sem jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_ini > v_fin then raise exception 'rango de fechas invalido' using errcode = '22023'; end if;
  with cob as (select c.modelo_id, c.dias from operacion.cobertura(v_hoy) c where c.nivel = 'modelo'),
  ex as (select m.marca_id, count(*) filter (where e.piezas > 0)::int as modelos, coalesce(sum(e.piezas), 0)::bigint as piezas, coalesce(sum(e.valor_cent), 0)::bigint as valor
           from catalogo.modelo m join operacion.existencia_modelo e on e.modelo_id = m.id group by m.marca_id),
  sab as (select m.marca_id, count(*)::int as sabores from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id where u.piezas > 0 group by m.marca_id),
  mov as (select m.marca_id, coalesce(sum(mi.cantidad) filter (where mi.cantidad > 0 and mi.fecha_neg between v_ini and v_fin), 0)::bigint as ent,
                 coalesce(-sum(mi.cantidad) filter (where mi.cantidad < 0 and mi.fecha_neg between v_ini and v_fin), 0)::bigint as sal,
                 max(mi.fecha_neg) filter (where mi.tipo = 'entrada_compra') as ult
            from operacion.movimiento_inventario mi join catalogo.modelo m on m.id = mi.modelo_id group by m.marca_id),
  cb as (select m.marca_id, avg(c.dias) filter (where c.dias is not null) as media, count(*) filter (where c.dias is not null)::int as con_dato
           from catalogo.modelo m join cob c on c.modelo_id = m.id group by m.marca_id),
  prov as (select distinct on (m.marca_id) m.marca_id, p.nombre as proveedor
             from catalogo.costo_proveedor cp join catalogo.proveedor p on p.id = cp.proveedor_id join catalogo.modelo m on m.id = cp.modelo_id
            order by m.marca_id, cp.vigente_desde desc, cp.id desc)
  select coalesce(jsonb_agg(jsonb_build_object('marca_id', ma.id, 'marca', ma.nombre, 'proveedor', pr.proveedor, 'modelos', coalesce(ex.modelos, 0), 'modelos_catalogo', (select count(*) from catalogo.modelo z where z.marca_id = ma.id),
           'sabores', coalesce(sab.sabores, 0), 'piezas', coalesce(ex.piezas, 0), 'valor_cent', coalesce(ex.valor, 0),
           'costo_prom_cent', case when coalesce(ex.piezas, 0) > 0 then negocio.redondear_medio_arriba(ex.valor, ex.piezas) end,
           'cobertura_media_dias', case when cb.con_dato > 0 then round(cb.media, 1) end, 'entradas', coalesce(mov.ent, 0), 'salidas', coalesce(mov.sal, 0),
           'rotacion', case when coalesce(ex.piezas, 0) > 0 then round(coalesce(mov.sal, 0)::numeric / ex.piezas, 2) end, 'ultima_entrada', mov.ult) order by coalesce(ex.valor, 0) desc, ma.nombre), '[]'::jsonb)
    into v_filas
    from catalogo.marca ma left join ex on ex.marca_id = ma.id left join sab on sab.marca_id = ma.id left join mov on mov.marca_id = ma.id left join cb on cb.marca_id = ma.id left join prov pr on pr.marca_id = ma.id
   where ex.marca_id is not null or mov.marca_id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'saldo_cent', operacion.saldo_proveedor(p.id),
           'etiqueta', case when operacion.saldo_proveedor(p.id) > 0 then 'A favor' when operacion.saldo_proveedor(p.id) < 0 then 'Se debe' else 'Saldo cero' end) order by p.nombre), '[]'::jsonb)
    into v_cuentas from catalogo.proveedor p;
  select coalesce(jsonb_agg(w.j order by w.semana), '[]'::jsonb) into v_sem from (
    select s.semana, jsonb_build_object('semana', s.semana, 'piezas', s.piezas, 'valor_cent', s.valor) as j
      from (select date_trunc('week', mi.fecha_neg)::date as semana, sum(mi.cantidad)::bigint as piezas, sum(mi.valor_cent)::bigint as valor
              from operacion.movimiento_inventario mi where mi.tipo = 'entrada_compra' and mi.fecha_neg between v_ini and v_fin group by 1 order by 1 desc limit 104) s) w;
  return jsonb_build_object('ini', v_ini, 'fin', v_fin, 'marcas', v_filas, 'cuentas_proveedor', v_cuentas, 'compras_semana', v_sem);
end $$;

-- ---------------------------------------------------------------------------
-- Mermas y diferencias de conteo (movimientos tipo merma y ajuste_conteo)
-- ---------------------------------------------------------------------------
create function api.inventario_mermas(p_ini date default null, p_fin date default null, p_limite int default 200, p_desplazamiento int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_lim int := greatest(least(coalesce(p_limite, 200), 1000), 1); v_off int := greatest(coalesce(p_desplazamiento, 0), 0); v_ids bigint[]; v_filas jsonb; v_tot jsonb; v_meses jsonb; v_modelos jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(array_agg(mi.id), '{}') into v_ids from operacion.movimiento_inventario mi
   where mi.tipo in ('merma', 'ajuste_conteo') and (p_ini is null or mi.fecha_neg >= p_ini) and (p_fin is null or mi.fecha_neg <= p_fin);
  select jsonb_build_object('merma_piezas', coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'merma'), 0), 'merma_valor_cent', coalesce(-sum(mi.valor_cent) filter (where mi.tipo = 'merma'), 0),
      'faltante_piezas', coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'ajuste_conteo' and mi.cantidad < 0), 0), 'faltante_valor_cent', coalesce(-sum(mi.valor_cent) filter (where mi.tipo = 'ajuste_conteo' and mi.cantidad < 0), 0),
      'sobrante_piezas', coalesce(sum(mi.cantidad) filter (where mi.tipo = 'ajuste_conteo' and mi.cantidad > 0), 0), 'sobrante_valor_cent', coalesce(sum(mi.valor_cent) filter (where mi.tipo = 'ajuste_conteo' and mi.cantidad > 0), 0),
      'n', count(*)) into v_tot from operacion.movimiento_inventario mi join unnest(v_ids) f(id) on f.id = mi.id;
  select coalesce(jsonb_agg(s.j order by s.mes), '[]'::jsonb) into v_meses from (
    select date_trunc('month', mi.fecha_neg)::date as mes, jsonb_build_object('mes', date_trunc('month', mi.fecha_neg)::date, 'merma_piezas', coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'merma'), 0),
        'ajuste_piezas', coalesce(-sum(mi.cantidad) filter (where mi.tipo = 'ajuste_conteo'), 0), 'valor_cent', -sum(mi.valor_cent), 'n', count(*)) as j
      from operacion.movimiento_inventario mi join unnest(v_ids) f(id) on f.id = mi.id group by 1) s;
  select coalesce(jsonb_agg(s.j order by s.valor desc, s.nombre), '[]'::jsonb) into v_modelos from (
    select mo.nombre_canonico as nombre, -sum(mi.valor_cent) as valor, jsonb_build_object('modelo_id', mo.id, 'marca', ma.nombre, 'modelo', mo.nombre_canonico, 'piezas', -sum(mi.cantidad), 'valor_cent', -sum(mi.valor_cent), 'n', count(*)) as j
      from operacion.movimiento_inventario mi join unnest(v_ids) f(id) on f.id = mi.id join catalogo.modelo mo on mo.id = mi.modelo_id join catalogo.marca ma on ma.id = mo.marca_id group by mo.id, ma.nombre, mo.nombre_canonico) s;
  select coalesce(jsonb_agg(x.j order by x.id desc), '[]'::jsonb) into v_filas from (
    select mi.id, jsonb_build_object('id', mi.id, 'fecha_neg', mi.fecha_neg, 'tipo', mi.tipo, 'marca', ma.nombre, 'modelo', mo.nombre_canonico, 'modelo_id', mo.id, 'sabor', sa.nombre_canonico, 'piezas', mi.cantidad, 'valor_cent', mi.valor_cent,
        'motivo', mi.nota, 'evento', e.folio, 'autor', (select coalesce(u.socio_nombre, u.rol) from seguridad.usuario u where u.id = e.actor_id), 'mensaje_origen', e.mensaje_origen) as j
      from operacion.movimiento_inventario mi join unnest(v_ids) f(id) on f.id = mi.id join operacion.evento e on e.id = mi.evento_id join catalogo.sku k on k.id = mi.sku_id join catalogo.sabor sa on sa.id = k.sabor_id
      join catalogo.modelo mo on mo.id = mi.modelo_id join catalogo.marca ma on ma.id = mo.marca_id order by mi.id desc limit v_lim offset v_off) x;
  return jsonb_build_object('totales', v_tot, 'meses', v_meses, 'modelos', v_modelos, 'movimientos', v_filas, 'total', coalesce(array_length(v_ids, 1), 0), 'limite', v_lim, 'desplazamiento', v_off);
end $$;

-- ---------------------------------------------------------------------------
-- Desglose de la valuacion al corte (inventario por marca, cuentas por cobrar por cliente, cuentas de activo y pasivo)
-- ---------------------------------------------------------------------------
create function api.conta_valuacion_detalle(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hasta date := coalesce(p_hasta, negocio.hoy()); v_val jsonb; v_cuentas jsonb; v_inv jsonb; v_cli jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_val := contabilidad.valuacion(v_hasta);
  select coalesce(jsonb_agg(jsonb_build_object('codigo', s.codigo, 'nombre', s.nombre, 'tipo', s.tipo, 'saldo_cent', s.saldo_cent, 'activa', s.activa) order by s.codigo), '[]'::jsonb) into v_cuentas
    from contabilidad.saldos(v_hasta) s where s.tipo in ('A', 'P') and (s.saldo_cent <> 0 or s.activa);
  select coalesce(jsonb_agg(jsonb_build_object('marca', q.marca, 'piezas', q.piezas, 'valor_cent', q.valor, 'modelos', q.modelos) order by q.valor desc, q.marca), '[]'::jsonb) into v_inv from (
    select ma.nombre as marca, sum(x.p)::bigint as piezas, sum(x.v)::bigint as valor, count(*) filter (where x.p > 0)::int as modelos
      from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id
      cross join lateral (select mi.piezas_modelo_despues as p, mi.valor_modelo_despues_cent as v from operacion.movimiento_inventario mi where mi.modelo_id = m.id and mi.fecha_neg <= v_hasta order by mi.id desc limit 1) x
     group by ma.nombre having sum(x.v) <> 0 or sum(x.p) <> 0) q;
  select coalesce(jsonb_agg(jsonb_build_object('cliente_id', q.cid, 'cliente', q.nombre, 'saldo_cent', q.saldo, 'ultimo', q.ult) order by q.saldo desc, q.nombre), '[]'::jsonb) into v_cli from (
    select l.cliente_id as cid, c.nombre_canonico as nombre, sum(l.debe_cent - l.haber_cent)::bigint as saldo, max(a.fecha_contable) as ult
      from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join catalogo.cliente c on c.id = l.cliente_id
     where l.cuenta = '1210' and a.fecha_contable <= v_hasta group by l.cliente_id, c.nombre_canonico having sum(l.debe_cent - l.haber_cent) <> 0) q;
  return jsonb_build_object('hasta', v_hasta, 'valuacion', v_val, 'cuentas', v_cuentas, 'inventario_por_marca', v_inv, 'clientes', v_cli);
end $$;

-- ---------------------------------------------------------------------------
-- Serie de la valuacion (cada corte llama contabilidad.valuacion; sin tabla nueva). p_paso: 'mes' | 'semana'
-- ---------------------------------------------------------------------------
create function api.conta_valuacion_serie(p_desde date default null, p_hasta date default null, p_paso text default 'mes') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hasta date := coalesce(p_hasta, negocio.hoy()); v_desde date; v_cortes date[] := '{}'; v_c date; v_filas jsonb := '[]'::jsonb; v_prev jsonb; v_v jsonb; v_n int := 0;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_paso not in ('mes', 'semana') then raise exception 'paso desconocido' using errcode = '22023'; end if;
  v_desde := coalesce(p_desde, (select min(a.fecha_contable) from contabilidad.asiento a), v_hasta);
  if v_desde > v_hasta then raise exception 'rango de fechas invalido' using errcode = '22023'; end if;
  v_c := case p_paso when 'mes' then (date_trunc('month', v_desde) + interval '1 month - 1 day')::date else (date_trunc('week', v_desde) + interval '6 days')::date end;
  while v_c < v_hasta and v_n < 60 loop
    v_cortes := v_cortes || v_c;
    v_c := case p_paso when 'mes' then (date_trunc('month', v_c + 1) + interval '1 month - 1 day')::date else v_c + 7 end;
    v_n := v_n + 1;
  end loop;
  v_cortes := v_cortes || v_hasta;
  foreach v_c in array v_cortes loop
    v_v := contabilidad.valuacion(v_c);
    v_filas := v_filas || jsonb_build_object('corte', v_c, 'parcial', v_c = v_hasta and p_paso = 'mes' and v_c <> (date_trunc('month', v_c) + interval '1 month - 1 day')::date,
      'con_movimientos', v_v -> 'con_movimientos', 'valuacion_cent', v_v -> 'v01_valuacion_cent', 'deudas_cent', v_v -> 'v02_deudas_cent', 'diferencia_cent', v_v -> 'v03_diferencia_cent',
      'utilidad_cent', v_v -> 'v04_utilidad_empresa_cent', 'capital_cent', v_v -> 'v06_capital_aportado_cent', 'inicial_cent', v_prev -> 'v01_valuacion_cent',
      'cambio_cent', case when v_prev is not null then (v_v ->> 'v01_valuacion_cent')::bigint - (v_prev ->> 'v01_valuacion_cent')::bigint end,
      'crecimiento_bp', case when v_prev is not null and (v_prev ->> 'v01_valuacion_cent')::bigint > 0
                         then negocio.redondear_medio_arriba(10000 * ((v_v ->> 'v01_valuacion_cent')::bigint - (v_prev ->> 'v01_valuacion_cent')::bigint), (v_prev ->> 'v01_valuacion_cent')::bigint) end);
    v_prev := v_v;
  end loop;
  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'paso', p_paso, 'filas', v_filas);
end $$;

-- ---------------------------------------------------------------------------
-- Caja y liquidez (cuentas de fondos 1101, 1102, 1150 y 1160 del libro; entradas y salidas por semana; saldo por persona)
-- ---------------------------------------------------------------------------
create function api.caja_resumen(p_ini date default null, p_fin date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_fin date := coalesce(p_fin, negocio.hoy()); v_ini date := coalesce(p_ini, coalesce(p_fin, negocio.hoy()) - 89); v_val jsonb; v_cuentas jsonb; v_sem jsonb; v_dia jsonb; v_tot jsonb; v_hay boolean; v_ap bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_ini > v_fin then raise exception 'rango de fechas invalido' using errcode = '22023'; end if;
  v_val := contabilidad.valuacion(v_fin);
  select exists (select 1 from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable <= v_fin) into v_hay;
  select coalesce(sum(l.debe_cent - l.haber_cent), 0)::bigint into v_ap from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
   where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable < v_ini;
  select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'activa', c.activa,
        'tipo', case c.codigo when '1101' then 'efectivo' when '1102' then 'banco' else 'socio' end,
        'saldo_cent', coalesce(m.saldo, 0), 'entradas_cent', coalesce(m.ent, 0), 'salidas_cent', coalesce(m.sal, 0), 'ultimo', m.ult) order by c.codigo), '[]'::jsonb) into v_cuentas
    from contabilidad.cuenta c
    left join (select l.cuenta, sum(l.debe_cent - l.haber_cent) as saldo,
                      sum(l.debe_cent) filter (where a.fecha_contable >= v_ini) as ent, sum(l.haber_cent) filter (where a.fecha_contable >= v_ini) as sal, max(a.fecha_contable) as ult
                 from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where a.fecha_contable <= v_fin and l.cuenta in ('1101', '1102', '1150', '1160') group by l.cuenta) m on m.cuenta = c.codigo
   where c.codigo in ('1101', '1102', '1150', '1160');
  select jsonb_build_object('entradas_cent', coalesce(sum(l.debe_cent), 0), 'salidas_cent', coalesce(sum(l.haber_cent), 0), 'n', count(*)) into v_tot
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable between v_ini and v_fin;
  select coalesce(jsonb_agg(s.j order by s.semana), '[]'::jsonb) into v_sem from (
    select date_trunc('week', a.fecha_contable)::date as semana, jsonb_build_object('semana', date_trunc('week', a.fecha_contable)::date, 'entradas_cent', sum(l.debe_cent), 'salidas_cent', sum(l.haber_cent)) as j
      from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
     where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable between v_ini and v_fin group by 1) s;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', d.fecha, 'saldo_cent', d.saldo) order by d.fecha), '[]'::jsonb) into v_dia from (
    select t.fecha, v_ap + sum(t.neto) over (order by t.fecha) as saldo from (
      select a.fecha_contable as fecha, sum(l.debe_cent - l.haber_cent)::bigint as neto
        from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
       where l.cuenta in ('1101', '1102', '1150', '1160') and a.fecha_contable between v_ini and v_fin group by a.fecha_contable) t) d;
  return jsonb_build_object('ini', v_ini, 'fin', v_fin, 'con_movimientos', v_hay, 'cuentas', v_cuentas, 'totales', v_tot, 'semanas', v_sem, 'dias', v_dia, 'saldo_inicial_cent', v_ap,
    'l01_liquidez_cent', v_val -> 'l01_liquidez_cent', 'l02_liquidez_total_cent', v_val -> 'l02_liquidez_total_cent', 'l03_pago_semana_cent', v_val -> 'l03_pago_semana_cent',
    'l04_despues_de_pago_cent', v_val -> 'l04_despues_de_pago_cent', 'clientes_cent', v_val -> 'clientes_cent');
end $$;

-- ---------------------------------------------------------------------------
-- Libro de ingresos y egresos en UNA tabla con saldo corrido, totales del filtro completo y paginacion en servidor
-- (sobre movimiento_vigente: sin duplicados ni descartados; los cuenta aparte)
-- ---------------------------------------------------------------------------
create function api.libro_dinero(
  p_ini date default null, p_fin date default null, p_estado text default null, p_q text default null, p_min_cent bigint default null, p_max_cent bigint default null,
  p_cuenta text default null, p_limite int default 200, p_desplazamiento int default 0, p_orden text default 'asc') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_lim int := greatest(least(coalesce(p_limite, 200), 500), 1); v_off int := greatest(coalesce(p_desplazamiento, 0), 0); v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_ap bigint := 0; v_ids bigint[]; v_tot jsonb; v_meses jsonb; v_filas jsonb; v_estados jsonb; v_ex int; v_cuentas jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_estado is not null and p_estado not in ('sin_clasificar', 'clasificado', 'conciliado') then raise exception 'estado desconocido' using errcode = '22023'; end if;
  if p_orden not in ('asc', 'desc') then raise exception 'orden desconocido' using errcode = '22023'; end if;
  -- Saldo anterior al periodo: toda la historia vigente, sin los otros filtros (el saldo corrido no depende de lo que se esconda).
  select coalesce(sum(v.monto_cent), 0) into v_ap from operacion.movimiento_vigente v where v.estado in ('sin_clasificar', 'clasificado', 'conciliado') and p_ini is not null and v.fecha_neg < p_ini;
  select coalesce(array_agg(v.id), '{}') into v_ids from operacion.movimiento_vigente v
   where v.estado in ('sin_clasificar', 'clasificado', 'conciliado') and (p_ini is null or v.fecha_neg >= p_ini) and (p_fin is null or v.fecha_neg <= p_fin)
     and (p_estado is null or v.estado = p_estado) and (p_cuenta is null or v.cuenta_texto = p_cuenta)
     and (p_min_cent is null or abs(v.monto_cent) >= p_min_cent) and (p_max_cent is null or abs(v.monto_cent) <= p_max_cent)
     and (v_q is null or coalesce(v.mensaje_original, '') ilike '%' || v_q || '%' or coalesce(v.origen_texto, '') ilike '%' || v_q || '%' or coalesce(v.cuenta_texto, '') ilike '%' || v_q || '%');
  select count(*)::int into v_ex from operacion.movimiento_vigente v where v.estado in ('duplicado', 'descartado');
  select jsonb_build_object('n', count(*), 'cargos_cent', coalesce(sum(v.monto_cent) filter (where v.monto_cent > 0), 0), 'abonos_cent', coalesce(-sum(v.monto_cent) filter (where v.monto_cent < 0), 0),
                            'neto_cent', coalesce(sum(v.monto_cent), 0), 'saldo_inicial_cent', v_ap,
                            'saldo_final_cent', v_ap + coalesce((select sum(w.monto_cent) from operacion.movimiento_vigente w where w.estado in ('sin_clasificar', 'clasificado', 'conciliado')
                                                    and (p_ini is null or w.fecha_neg >= p_ini) and (p_fin is null or w.fecha_neg <= p_fin)), 0))
    into v_tot from operacion.movimiento_vigente v join unnest(v_ids) f(id) on f.id = v.id;
  select coalesce(jsonb_agg(jsonb_build_object('estado', e.estado, 'n', e.n) order by e.ord), '[]'::jsonb) into v_estados from (
    select v.estado, count(*)::int as n, case v.estado when 'sin_clasificar' then 1 when 'clasificado' then 2 else 3 end as ord
      from operacion.movimiento_vigente v where v.estado in ('sin_clasificar', 'clasificado', 'conciliado') and (p_ini is null or v.fecha_neg >= p_ini) and (p_fin is null or v.fecha_neg <= p_fin) group by v.estado) e;
  select coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'n', m.n, 'cargos_cent', m.c, 'abonos_cent', m.a, 'neto_cent', m.c - m.a,
                   'saldo_cent', v_ap + coalesce((select sum(w.monto_cent) from operacion.movimiento_vigente w where w.estado in ('sin_clasificar', 'clasificado', 'conciliado')
                                         and (p_ini is null or w.fecha_neg >= p_ini) and w.fecha_neg < (m.mes + interval '1 month')::date and (p_fin is null or w.fecha_neg <= p_fin)), 0)) order by m.mes), '[]'::jsonb) into v_meses from (
    select date_trunc('month', v.fecha_neg)::date as mes, count(*)::int as n, coalesce(sum(v.monto_cent) filter (where v.monto_cent > 0), 0)::bigint as c, coalesce(-sum(v.monto_cent) filter (where v.monto_cent < 0), 0)::bigint as a
      from operacion.movimiento_vigente v join unnest(v_ids) f(id) on f.id = v.id group by 1) m;
  select coalesce(jsonb_agg(x.c order by x.c), '[]'::jsonb) into v_cuentas from (select distinct v.cuenta_texto as c from operacion.movimiento_vigente v where v.cuenta_texto is not null) x;
  select coalesce(jsonb_agg(x.j order by case when p_orden = 'asc' then x.k else -x.k end), '[]'::jsonb) into v_filas from (
    select v.id as k, jsonb_build_object('id', v.id, 'fecha_neg', v.fecha_neg, 'concepto', v.mensaje_original, 'categoria', v.tipo, 'cuenta', v.cuenta_texto, 'origen', v.origen_texto,
        'contraparte', coalesce(c.nombre_canonico, pr.nombre, so.nombre), 'folio', pe.folio, 'cargo_cent', case when v.monto_cent > 0 then v.monto_cent end, 'abono_cent', case when v.monto_cent < 0 then -v.monto_cent end,
        'saldo_cent', v_ap + (select sum(w.monto_cent) from operacion.movimiento_vigente w where w.estado in ('sin_clasificar', 'clasificado', 'conciliado') and (p_ini is null or w.fecha_neg >= p_ini)
                               and (w.fecha_neg < v.fecha_neg or (w.fecha_neg = v.fecha_neg and w.id <= v.id))), 'estado', v.estado) as j
      from operacion.movimiento_vigente v join unnest(v_ids) f(id) on f.id = v.id
      left join catalogo.cliente c on c.id = v.cliente_id left join catalogo.proveedor pr on pr.id = v.proveedor_id left join catalogo.socio so on so.id = v.socio_id left join operacion.pedido pe on pe.id = v.pedido_id
     order by case when p_orden = 'asc' then v.fecha_neg end asc, case when p_orden = 'asc' then v.id end asc, case when p_orden = 'desc' then v.fecha_neg end desc, case when p_orden = 'desc' then v.id end desc
     limit v_lim offset v_off) x;
  return jsonb_build_object('totales', v_tot, 'meses', v_meses, 'estados', v_estados, 'movimientos', v_filas, 'total', coalesce(array_length(v_ids, 1), 0), 'limite', v_lim, 'desplazamiento', v_off, 'orden', p_orden,
    'excluidos', v_ex, 'cuentas', v_cuentas);
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios: solo socios autenticados (cada funcion ademas exige rol socio)
-- ---------------------------------------------------------------------------
revoke execute on function
  api.inventario_kardex_consolidado(text, bigint, bigint, date, date, text, text, int, int), api.inventario_detalle(date, date), api.inventario_resumen_marca(date, date),
  api.inventario_mermas(date, date, int, int), api.conta_valuacion_detalle(date), api.conta_valuacion_serie(date, date, text), api.caja_resumen(date, date),
  api.libro_dinero(date, date, text, text, bigint, bigint, text, int, int, text) from public, anon;
grant execute on function
  api.inventario_kardex_consolidado(text, bigint, bigint, date, date, text, text, int, int), api.inventario_detalle(date, date), api.inventario_resumen_marca(date, date),
  api.inventario_mermas(date, date, int, int), api.conta_valuacion_detalle(date), api.conta_valuacion_serie(date, date, text), api.caja_resumen(date, date),
  api.libro_dinero(date, date, text, text, bigint, bigint, text, int, int, text) to authenticated;
