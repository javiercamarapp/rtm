-- Una sola verdad por proveedor (Proveedores): la POSICION COMPLETA con el proveedor, la del Mayor (cuenta 2110 o 2120), es la unica cifra de saldo en pantalla.
-- Antes Proveedores mostraba tres cifras que no cuadraban entre si ni con el libro: el 'Saldo de la cuenta' (solo la cuenta corriente: pagos, abonos y ordenes; no descuenta el costo de los
-- pedidos directos), 'Falta por saldar' (hoja semanal con saldo anterior de la ultima liquidacion cerrada, normalmente cero) y el encabezado 'A favor / Se le debe'.
-- Cambio ADITIVO (solo lecturas; conserva firmas y permisos; sin GRANT nuevo):
--   1. operacion.posicion_proveedor(proveedor, hasta): posicion del Mayor con su desglose (cargos y abonos sin contar asientos reversados) y su comprobacion contra el auxiliar
--      (operacion.ds_posicion_proveedor: cuenta corriente menos el costo de los pedidos directos).
--   2. api.proveedor_cuenta agrega la clave 'posicion' (detalle) y toma posicion_cent de esa funcion.
--   3. operacion.hoja_proveedor: 'saldo anterior' = posicion del libro al inicio de la hoja; agrega el saldo del libro al corte y la diferencia (si no cuadra se dice).
--   3b. La fecha de una orden de compra en la hoja es la de su cargo en la cuenta del proveedor (la misma del libro), no la del reloj al confirmar: una carga historica con fecha pasada
--      ya no cae en la semana de la carga.
--   4. api.explicar_cifra: 'proveedor:posicion:<Isaac|Karen>'.

create function operacion.posicion_proveedor(p_proveedor bigint, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cta text := contabilidad.cta_proveedor(p_proveedor); v_cargos bigint; v_abonos bigint; v_saldo bigint; v_aux bigint; v_pos bigint;
begin
  select coalesce(sum(l.haber_cent), 0)::bigint, coalesce(sum(l.debe_cent), 0)::bigint into v_cargos, v_abonos
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
   where l.cuenta = v_cta and (p_hasta is null or a.fecha_contable <= p_hasta)
     -- Un asiento reversado y su reversa se anulan entre si: no cuentan como costo ni como pago.
     and a.reversa_de is null
     and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id and (p_hasta is null or r.fecha_contable <= p_hasta));
  v_saldo := contabilidad.saldo(v_cta, p_hasta);
  v_pos := -v_saldo;
  v_aux := case when p_hasta is null then operacion.ds_posicion_proveedor(p_proveedor) end;
  return jsonb_build_object(
    'posicion_cent', v_pos,
    'se_debe_cent', greatest(-v_pos, 0), 'a_favor_cent', greatest(v_pos, 0),
    'cargos_cent', v_cargos, 'abonos_cent', v_abonos,
    'desglose_cuadra', v_cargos - v_abonos = v_saldo,
    'auxiliar_cent', v_aux, 'cuadra_auxiliar', case when v_aux is null then null else v_aux = v_pos end);
end $$;
revoke execute on function operacion.posicion_proveedor(bigint, date) from public, anon, authenticated;

create or replace function api.proveedor_cuenta(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov catalogo.proveedor; v_saldo bigint; v_pos jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into v_prov from catalogo.proveedor where id = catalogo.proveedor_id(p_proveedor);
  if not found then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_saldo := operacion.saldo_proveedor(v_prov.id);
  v_pos := operacion.posicion_proveedor(v_prov.id);
  return jsonb_build_object('id', v_prov.id, 'proveedor', v_prov.nombre, 'modalidad', v_prov.modalidad, 'saldo_cent', v_saldo,
    'etiqueta', case when v_saldo > 0 then 'A favor' when v_saldo < 0 then 'Se debe' else 'Saldo cero' end,
    'movimientos', coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
        select jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'monto_cent', m.monto_cent, 'saldo_corrido_cent', sum(m.monto_cent) over (order by m.id),
          'compra', (select folio from operacion.compra where id = m.compra_id), 'pago', (select folio from operacion.pago where id = m.pago_id), 'cliente', (select nombre_canonico from catalogo.cliente where id = m.cliente_id),
          'cuenta_origen', (select nombre from operacion.cuenta_dinero where id = m.cuenta_origen_id), 'nota', m.nota) || operacion.evento_info(m.evento_id) as x
        from (select c.id, c.fecha_neg, c.concepto, c.monto_cent, c.compra_id, c.pago_id, c.cliente_id, c.cuenta_origen_id, c.nota, c.evento_id from operacion.cuenta_proveedor_mov c where c.proveedor_id = v_prov.id
              union all
              select 0::bigint, se.fecha_corte, 'apertura', (-contabilidad.apertura_saldo(contabilidad.cta_proveedor(v_prov.id)))::bigint, null::bigint, null::bigint, null::bigint, null::bigint, 'Saldo de apertura', se.evento_id
                from apertura.sesion se where se.estado = 'firmada' and se.evento_id is not null and contabilidad.apertura_saldo(contabilidad.cta_proveedor(v_prov.id)) <> 0) m) q), '[]'::jsonb),
    'puente_cent', operacion.saldo_puente(),
    'posicion_cent', (v_pos->>'posicion_cent')::bigint, 'posicion', v_pos);
end $$;

-- Hoja semanal: el saldo anterior es la posicion del libro al inicio de la hoja; el saldo del libro al corte se compara y la diferencia se dice.
create or replace function operacion.hoja_proveedor(p_proveedor text, p_semana_ini date, p_ambito text default 'sociedad') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prov bigint; v_ini date := operacion.semana_omar_ini(p_semana_ini); v_fin date := operacion.semana_omar_ini(p_semana_ini) + 4; v_desde date := operacion.semana_omar_ini(p_semana_ini) - 2;
  v_origenes text[]; v_seguro bigint; v_rengs jsonb; v_abonos jsonb; v_ajustes jsonb; v_mercancia bigint; v_seguros bigint; v_guias bigint; v_pagos bigint; v_ajus bigint; v_ant bigint;
  v_m2 bigint; v_g2 bigint; v_s2 bigint; v_falta bigint; v_dicho operacion.proveedor_dicho; v_liq operacion.liquidacion_proveedor; v_pagos_conc jsonb; v_conc jsonb; v_dif bigint;
  v_cuadra_rengs boolean; v_cuadra_abonos boolean; v_pagos2 bigint; v_cta text; v_libro bigint; v_dif_libro bigint;
begin
  if p_ambito not in ('sociedad', 'todo') then raise exception 'ambito invalido' using errcode = '22023'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_origenes := case p_proveedor when 'Isaac' then array['isaac_directo', 'karen_via_isaac'] else array['karen_directo', 'karen_via_isaac'] end;
  v_seguro := coalesce((catalogo.config_valor('seguro_reenvio_cent', v_fin))::text::bigint, 0);

  -- Bloque 1 y 3: una nota por pedido a costo (con su guia) y las ordenes de compra confirmadas en la semana.
  select coalesce(jsonb_agg(r order by r->>'fecha', r->>'tipo', (r->>'id')::bigint), '[]'::jsonb) into v_rengs from (
    select jsonb_build_object('tipo', 'pedido', 'id', p.id, 'folio', p.folio, 'fecha', p.fecha_envio, 'cliente', p.cliente, 'duenio', p.duenio, 'es_de_sociedad', p.es_de_sociedad, 'origen', p.origen,
      'piezas', p.piezas, 'mercancia_cent', p.mercancia, 'seguro_cent', p.seguro, 'guia_cent', p.guia, 'guia_pendiente', p.guia_pendiente,
      'costo_cent', p.mercancia + p.seguro + p.guia, 'detalle', p.detalle, 'detalle_cent', p.detalle_cent, 'cuadra', p.detalle_cent = p.mercancia + p.seguro) as r
    from (
      select pe.id, pe.folio, pe.fecha_envio, pe.origen, pe.es_de_sociedad, c.nombre_canonico as cliente, so.nombre as duenio,
             d.piezas,
             case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then d.bruto - v_seguro * d.piezas else 0 end) else d.bruto end as mercancia,
             case when pe.origen = 'karen_via_isaac' and p_proveedor = 'Isaac' then v_seguro * d.piezas else 0 end as seguro,
             case when (p_proveedor = 'Isaac' and pe.origen in ('isaac_directo', 'karen_via_isaac')) or (p_proveedor = 'Karen' and pe.origen = 'karen_directo') then g.guia else 0 end as guia,
             g.pendiente as guia_pendiente, d.detalle, d.detalle_cent
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio so on so.id = c.duenio_id
      join lateral (
        select sum(x.piezas)::int as piezas, sum(x.costo)::bigint as bruto,
               jsonb_agg(jsonb_build_object('modelo', x.modelo, 'piezas', x.piezas, 'costo_cent',
                   case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then x.costo - v_seguro * x.piezas else v_seguro * x.piezas end) else x.costo end,
                   'costo_unit_cent', negocio.redondear_medio_arriba(case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then x.costo - v_seguro * x.piezas else v_seguro * x.piezas end) else x.costo end, x.piezas))
                 order by x.modelo) as detalle,
               sum(case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then x.costo - v_seguro * x.piezas else v_seguro * x.piezas end) else x.costo end)::bigint as detalle_cent
        from (select m.nombre_canonico as modelo, sum(s.piezas)::int as piezas, sum(s.costo_valor_cent)::bigint as costo
              from operacion.pedido_linea l join operacion.pedido_surtido s on s.pedido_linea_id = l.id join catalogo.modelo m on m.id = l.modelo_id
              where l.pedido_id = pe.id group by m.nombre_canonico) x
      ) d on d.piezas is not null
      join lateral (
        select coalesce(sum(gu.costo_cent), 0)::bigint as guia, coalesce(bool_or(gu.costo_cent is null), false) as pendiente
        from operacion.guia gu where gu.pedido_id = pe.id and gu.sentido = 'salida' and gu.pagada_por_socio_id is null
      ) g on true
      where pe.estado = 'enviado' and pe.fecha_envio between v_desde and v_fin and pe.origen = any (v_origenes) and (p_ambito = 'todo' or pe.es_de_sociedad)
    ) p
    union all
    select jsonb_build_object('tipo', 'oc', 'id', co.id, 'folio', co.folio, 'fecha', coalesce((select m.fecha_neg from operacion.cuenta_proveedor_mov m where m.compra_id = co.id and m.concepto = 'oc_aplicada' order by m.id limit 1), negocio.fecha_neg(co.confirmada_at)), 'cliente', null, 'duenio', null, 'es_de_sociedad', co.ambito = 'sociedad', 'origen', 'orden_de_compra',
      'piezas', d.piezas, 'mercancia_cent', co.mercancia_cent, 'seguro_cent', co.seguro_cent, 'guia_cent', case when co.guia_pagada_por_socio_id is null then co.guia_cent else 0 end, 'guia_pendiente', false,
      'costo_cent', co.mercancia_cent + co.seguro_cent + case when co.guia_pagada_por_socio_id is null then co.guia_cent else 0 end, 'detalle', d.detalle, 'detalle_cent', d.detalle_cent, 'cuadra', d.detalle_cent = co.mercancia_cent)
    from operacion.compra co
    join lateral (
      select sum(x.facturadas)::int as piezas, sum(x.costo)::bigint as detalle_cent,
             jsonb_agg(jsonb_build_object('modelo', x.modelo, 'piezas', x.facturadas, 'costo_cent', x.costo, 'costo_unit_cent', negocio.redondear_medio_arriba(x.costo, x.facturadas)) order by x.modelo) as detalle
      from (select m.nombre_canonico as modelo, sum(cl.piezas_facturadas)::int as facturadas, sum(cl.piezas_facturadas * cl.costo_unit_cent)::bigint as costo
            from operacion.compra_linea cl join catalogo.modelo m on m.id = cl.modelo_id where cl.compra_id = co.id group by m.nombre_canonico) x
    ) d on true
    where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null and coalesce((select m.fecha_neg from operacion.cuenta_proveedor_mov m where m.compra_id = co.id and m.concepto = 'oc_aplicada' order by m.id limit 1), negocio.fecha_neg(co.confirmada_at)) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')
  ) q;

  select coalesce(sum((r->>'mercancia_cent')::bigint), 0), coalesce(sum((r->>'seguro_cent')::bigint), 0), coalesce(sum((r->>'guia_cent')::bigint), 0), coalesce(bool_and((r->>'cuadra')::boolean), true)
    into v_mercancia, v_seguros, v_guias, v_cuadra_rengs from jsonb_array_elements(v_rengs) r;

  -- Comprobacion independiente (otra consulta): mercancia, seguros y guias directo de los libros.
  select coalesce(sum(case when pe.origen = 'karen_via_isaac' then (case when p_proveedor = 'Karen' then s.costo_valor_cent - v_seguro * s.piezas else 0 end) else s.costo_valor_cent end), 0)::bigint,
         coalesce(sum(case when pe.origen = 'karen_via_isaac' and p_proveedor = 'Isaac' then v_seguro * s.piezas else 0 end), 0)::bigint
    into v_m2, v_s2
  from operacion.pedido pe join operacion.pedido_linea l on l.pedido_id = pe.id join operacion.pedido_surtido s on s.pedido_linea_id = l.id
  where pe.estado = 'enviado' and pe.fecha_envio between v_desde and v_fin and pe.origen = any (v_origenes) and (p_ambito = 'todo' or pe.es_de_sociedad);
  v_m2 := v_m2 + coalesce((select sum(co.mercancia_cent) from operacion.compra co where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null
                            and coalesce((select m.fecha_neg from operacion.cuenta_proveedor_mov m where m.compra_id = co.id and m.concepto = 'oc_aplicada' order by m.id limit 1), negocio.fecha_neg(co.confirmada_at)) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')), 0);
  v_s2 := v_s2 + coalesce((select sum(co.seguro_cent) from operacion.compra co where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null
                            and coalesce((select m.fecha_neg from operacion.cuenta_proveedor_mov m where m.compra_id = co.id and m.concepto = 'oc_aplicada' order by m.id limit 1), negocio.fecha_neg(co.confirmada_at)) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')), 0);
  select coalesce(sum(gu.costo_cent), 0)::bigint into v_g2
  from operacion.pedido pe join operacion.guia gu on gu.pedido_id = pe.id and gu.sentido = 'salida' and gu.pagada_por_socio_id is null
  where pe.estado = 'enviado' and pe.fecha_envio between v_desde and v_fin and pe.origen = any (v_origenes) and (p_ambito = 'todo' or pe.es_de_sociedad)
    and ((p_proveedor = 'Isaac' and pe.origen in ('isaac_directo', 'karen_via_isaac')) or (p_proveedor = 'Karen' and pe.origen = 'karen_directo'));
  v_g2 := v_g2 + coalesce((select sum(co.guia_cent) from operacion.compra co where co.proveedor_id = v_prov and co.estado <> 'anulada' and co.confirmada_at is not null and co.guia_pagada_por_socio_id is null
                            and coalesce((select m.fecha_neg from operacion.cuenta_proveedor_mov m where m.compra_id = co.id and m.concepto = 'oc_aplicada' order by m.id limit 1), negocio.fecha_neg(co.confirmada_at)) between v_desde and v_fin and (p_ambito = 'todo' or co.ambito = 'sociedad')), 0);

  -- Bloque 2: abonos (cada uno con su cliente aunque el proveedor lo vea sin nombre) y ajustes. Una reversa cuenta con el concepto de lo que deshace.
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', coalesce(o.concepto, m.concepto), 'monto_cent', m.monto_cent, 'cliente', c.nombre_canonico,
         'pedido', pe.folio, 'cuenta_origen', cd.nombre, 'nota', m.nota, 'deshecho', m.concepto = 'reversa') || operacion.evento_info(m.evento_id) order by m.fecha_neg, m.id), '[]'::jsonb),
         coalesce(sum(m.monto_cent), 0)::bigint
    into v_abonos, v_pagos
  from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
  left join catalogo.cliente c on c.id = m.cliente_id left join operacion.pedido pe on pe.id = m.pedido_id left join operacion.cuenta_dinero cd on cd.id = m.cuenta_origen_id
  where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad');
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_pagos_conc from (
    select coalesce(o.concepto, m.concepto) as k, sum(m.monto_cent)::bigint as v from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
    where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad') group by 1) z;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', coalesce(o.concepto, m.concepto), 'monto_cent', m.monto_cent, 'nota', m.nota, 'deshecho', m.concepto = 'reversa') || operacion.evento_info(m.evento_id) order by m.fecha_neg, m.id), '[]'::jsonb),
         coalesce(sum(m.monto_cent), 0)::bigint
    into v_ajustes, v_ajus
  from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
  where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('ajuste', 'reclamo_diferencia');
  select coalesce(sum(m.monto_cent), 0)::bigint into v_pagos2 from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
    where m.proveedor_id = v_prov and m.fecha_neg between v_desde and v_fin and coalesce(o.concepto, m.concepto) in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad');
  v_cuadra_abonos := v_pagos = v_pagos2 and v_pagos = coalesce((select sum(e.value::bigint) from jsonb_each_text(v_pagos_conc) e), 0);

  -- Saldo anterior = POSICION con el proveedor en el libro (cuenta 2110 o 2120) al inicio de la hoja, no el de la ultima liquidacion cerrada (que puede no existir).
  -- Positivo = se le debe al proveedor (misma convencion de la hoja); negativo = saldo a favor de la sociedad.
  v_cta := contabilidad.cta_proveedor(v_prov);
  v_ant := contabilidad.saldo(v_cta, v_desde - 1);
  v_falta := v_ant + v_mercancia + v_seguros + v_guias - v_pagos - v_ajus;
  -- Comprobacion contra el libro: el saldo del Mayor al corte de la hoja (viernes) debe ser el mismo; si no, la diferencia se dice.
  v_libro := contabilidad.saldo(v_cta, v_fin);
  v_dif_libro := v_libro - v_falta;

  select * into v_dicho from operacion.proveedor_dicho where proveedor_id = v_prov and semana_ini = v_ini and ambito = p_ambito order by id desc limit 1;
  select * into v_liq from operacion.liquidacion_proveedor where proveedor_id = v_prov and semana_ini = v_ini and ambito = p_ambito;
  if v_dicho.id is not null then
    v_dif := v_dicho.total_cent - v_falta;
    select coalesce(jsonb_agg(jsonb_build_object('folio', x.folio, 'dice_cent', x.dice, 'nuestro_cent', x.nuestro, 'diferencia_cent', coalesce(x.dice, 0) - coalesce(x.nuestro, 0), 'en_nuestra_hoja', x.nuestro is not null) order by x.folio), '[]'::jsonb) into v_conc
    from (select coalesce(d.folio, n.folio) as folio, d.dice, n.nuestro
          from (select e->>'folio' as folio, (e->>'monto_cent')::bigint as dice from jsonb_array_elements(v_dicho.renglones) e) d
          full join (select r->>'folio' as folio, (r->>'costo_cent')::bigint as nuestro from jsonb_array_elements(v_rengs) r) n on n.folio = d.folio) x;
  else
    v_conc := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'proveedor', p_proveedor, 'modalidad', (select modalidad from catalogo.proveedor where id = v_prov), 'ambito', p_ambito, 'semana_ini', v_ini, 'semana_fin', v_fin, 'desde', v_desde, 'viernes_cerrado', negocio.hoy() >= v_fin,
    'renglones', v_rengs, 'abonos', v_abonos, 'ajustes', v_ajustes, 'pagos_por_concepto_cent', v_pagos_conc,
    'totales', jsonb_build_object('saldo_anterior_cent', v_ant, 'mercancia_cent', v_mercancia, 'seguros_cent', v_seguros, 'guias_cent', v_guias, 'costo_total_cent', v_mercancia + v_seguros + v_guias,
                                  'pagos_cent', v_pagos, 'ajustes_cent', v_ajus, 'falta_por_saldar_cent', v_falta,
                                  'libro_al_corte_cent', v_libro, 'diferencia_libro_cent', v_dif_libro),
    'comprobaciones', jsonb_build_object(
      'libro_aplica', p_ambito = 'sociedad', 'libro_igual_hoja', v_dif_libro = 0,
      'renglon_igual_detalle', v_cuadra_rengs,
      'renglones_igual_mercancia', v_mercancia = v_m2, 'mercancia_independiente_cent', v_m2,
      'renglones_igual_seguros', v_seguros = v_s2, 'seguros_independiente_cent', v_s2,
      'guias_igual_envios', v_guias = v_g2, 'guias_independiente_cent', v_g2,
      'abonos_igual_depositos', v_cuadra_abonos, 'depositos_independiente_cent', v_pagos2,
      'cuadra', v_cuadra_rengs and v_mercancia = v_m2 and v_seguros = v_s2 and v_guias = v_g2 and v_cuadra_abonos),
    'guias_pendientes', (select count(*)::int from jsonb_array_elements(v_rengs) r where (r->>'guia_pendiente')::boolean),
    'conciliacion', case when v_dicho.id is null then null else jsonb_build_object('dicho_cent', v_dicho.total_cent, 'nuestro_cent', v_falta, 'diferencia_cent', v_dif, 'nota', v_dicho.nota, 'renglones', v_conc) end,
    'cierre', case when v_liq.id is null then null else jsonb_build_object('folio', v_liq.folio, 'fecha_cierre', v_liq.fecha_cierre, 'falta_por_saldar_cent', v_liq.falta_por_saldar_cent, 'dicho_cent', v_liq.dicho_por_proveedor_cent, 'diferencia_cent', v_liq.diferencia_cent) end);
end $$;

-- "Explicar este numero" de la posicion con un proveedor. Lo demas lo resuelve la funcion anterior.
alter function api.explicar_cifra(text) rename to explicar_cifra_antes_posicion_proveedor;
revoke execute on function api.explicar_cifra_antes_posicion_proveedor(text) from public, anon, authenticated;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_prov bigint; v_p jsonb; v_rengs jsonb; v_cc bigint; v_dir bigint;
begin
  if partes[1] = 'proveedor' and partes[2] = 'posicion' and partes[3] in ('Isaac', 'Karen') then
    perform seguridad.exigir_rol(array['socio']);
    v_prov := catalogo.proveedor_id(partes[3]);
    v_p := operacion.posicion_proveedor(v_prov);
    v_cc := operacion.saldo_proveedor(v_prov);
    v_dir := v_cc - (v_p->>'posicion_cent')::bigint;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Cuenta corriente: pagos, abonos, ajustes y ordenes de compra (+ a favor, - se debe)', 'monto_cent', v_cc),
      jsonb_build_object('concepto', 'Costo de pedidos directos enviados y otros cargos del libro que la cuenta corriente no incluye', 'monto_cent', -v_dir));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Posicion con ' || partes[3] || ' (+ a favor de la sociedad, - se le debe)', 'valor', (v_p->>'posicion_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Libro: cuenta ' || contabilidad.cta_proveedor(v_prov) || ' (abonos menos cargos)', 'via1_valor', (v_p->>'posicion_cent')::bigint,
        'via2', 'Auxiliar: cuenta corriente menos el costo de los pedidos directos', 'via2_valor', (v_p->>'auxiliar_cent')::bigint, 'cuadra', coalesce((v_p->>'cuadra_auxiliar')::boolean, false)),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  return api.explicar_cifra_antes_posicion_proveedor(p_cifra);
end $$;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra(text) from public, anon;
