-- Devoluciones / 6: correcciones del verificador independiente. Solo create or replace de funciones y dos funciones auxiliares nuevas (sin tablas, sin datos, sin GRANT nuevo
-- hacia authenticated: las auxiliares quedan revocadas como el resto del esquema operacion).
--  1. El descuento que se devuelve en proporcion es solo el COMERCIAL (el de la nota menos las bonificaciones por paquete perdido o danado).
--  2. No se devuelven piezas ya reportadas como perdidas, ni se reporta como perdida una pieza ya devuelta (candado en los dos sentidos).
--  3. La conciliacion de Dropshipping contra el Estado de resultados descuenta las devoluciones netas.
--  4. Movimientos > Resumen e Historial por cliente y modelo son netos de devoluciones (la base del reparto, operacion.utilidad_periodo, no cambia).
--  5. Anular una devolucion se rechaza si dejaria disponible negativo (otro pedido ya aparto esas piezas).
--  6. El documento de una devolucion exige que la devolucion exista y que la huella corresponda al contenido.

-- Piezas de un sabor de un renglon reportadas como perdidas en un paquete de salida (no existen: no pueden volver a inventario ni dar credito).
create function operacion.perdido_linea_sku(p_linea bigint, p_sku bigint) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(il.piezas), 0)::int from operacion.paquete_incidente_linea il join operacion.paquete_incidente i on i.id = il.incidente_id
  where il.pedido_linea_id = p_linea and il.sku_id = p_sku and i.sentido = 'salida' and i.tipo = 'perdido'
$$;

-- Efecto de las devoluciones vigentes de un pedido en su utilidad: credito (ya neto del descuento) menos el costo de lo que regreso a inventario (lo danado sigue siendo costo).
create function operacion.devolucion_efecto_pedido(p_pedido bigint, p_hasta date default null) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(d.monto_cent - coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.devolucion_id = d.id and l.destino = 'inventario'), 0)), 0)::bigint
  from operacion.devolucion_cliente d
  where d.pedido_id = p_pedido and (p_hasta is null or d.fecha_neg <= p_hasta) and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id)
$$;
revoke execute on function operacion.perdido_linea_sku(bigint, bigint), operacion.devolucion_efecto_pedido(bigint, date) from public, anon, authenticated;

create or replace function operacion.registrar_devolucion_cliente(p_clave_idem text, p_pedido bigint, p_lineas jsonb, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
                    where pl.id = (x->>'linea_id')::bigint and sa.nombre_norm = catalogo.normalizar(x->>'sabor')) end,
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
end $$;

create or replace function api.pedido_devoluciones(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pe operacion.pedido; ult operacion.nota;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into pe from operacion.pedido where id = p_pedido;
  if not found then return null; end if;
  select * into ult from operacion.nota where pedido_id = pe.id order by id desc limit 1;
  return jsonb_build_object('pedido_id', pe.id, 'folio', pe.folio, 'puede', pe.estado = 'enviado' and operacion.origen_es_bodega(pe.origen),
    'motivo_no', case when pe.estado <> 'enviado' then 'El pedido no está enviado.' when not operacion.origen_es_bodega(pe.origen) then 'El pedido salió directo del proveedor.' end,
    'devuelto_cent', operacion.devuelto_pedido(pe.id),
    -- Cifras del pedido ya netas de devoluciones vigentes (la web no calcula dinero): total cobrado = total de la nota - credito; el costo de lo que regreso a inventario sale del costo; lo que se fue a merma sigue siendo costo; la renta y la guia no cambian (regla pendiente del dueno).
    'cascada_neta', case when ult.snapshot_interno->'cascada' is null then null else jsonb_build_object(
      'total_cent', (ult.snapshot_interno->'cascada'->>'total_cent')::bigint - operacion.devuelto_pedido(pe.id),
      'costo_cent', (ult.snapshot_interno->'cascada'->>'costo_cent')::bigint - coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'inventario'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0),
      'costo_regresado_cent', coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'inventario'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0),
      'merma_cent', coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'merma'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0),
      'utilidad_cent', (ult.snapshot_interno->'cascada'->>'utilidad_cent')::bigint - operacion.devuelto_pedido(pe.id) + coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.destino = 'inventario'
          and l.devolucion_id in (select d.id from operacion.devolucion_cliente d where d.pedido_id = pe.id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id))), 0)) end,
    'renglones', coalesce((select jsonb_agg(jsonb_build_object('linea_id', l.id, 'sku_id', s.sku_id, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'surtidas', s.piezas, 'devueltas', operacion.devuelto_linea_sku(l.id, s.sku_id),
        'disponibles_devolver', s.piezas - operacion.devuelto_linea_sku(l.id, s.sku_id) - operacion.perdido_linea_sku(l.id, s.sku_id), 'precio_cent', coalesce((ult.ajustes->'precios'->>(l.id::text))::bigint, l.precio_cent)) order by l.id, sa.nombre_canonico)
      from operacion.pedido_linea l join (select pedido_linea_id, sku_id, sum(piezas)::int as piezas from operacion.pedido_surtido group by pedido_linea_id, sku_id) s on s.pedido_linea_id = l.id
           join catalogo.sku k on k.id = s.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = pe.id), '[]'::jsonb),
    'devoluciones', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'folio', d.folio, 'fecha_neg', d.fecha_neg, 'piezas', d.piezas, 'monto_cent', d.monto_cent, 'liberado_cent', d.liberado_cent, 'motivo', d.motivo,
        'anulada', exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id),
        'pdf', exists (select 1 from operacion.devolucion_documento x where x.tipo = 'cliente' and x.devolucion_id = d.id and x.variante = 'pdf')) order by d.id)
      from operacion.devolucion_cliente d where d.pedido_id = pe.id), '[]'::jsonb));
end $$;

create or replace function operacion.reportar_paquete_salida(p_clave_idem text, p_pedido bigint, p_tipo text, p_detalle text, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; ped operacion.pedido; v_ev bigint; v_id bigint; x jsonb; v_linea bigint; v_sku bigint; v_pz int; v_surt int; v_costo bigint; v_ya int; v_modelo bigint; v_val bigint;
  v_total_pz int := 0; v_total_val bigint := 0; v_folio text; v_res jsonb; v_cli text;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reportar_paquete_salida', 'p', p_pedido, 't', p_tipo, 'd', p_detalle, 'l', p_lineas));
  if v_prev is not null then return v_prev; end if;
  if p_tipo not in ('perdido', 'danado') then raise exception 'tipo invalido: perdido o danado' using errcode = '22023'; end if;
  if nullif(btrim(p_detalle), '') is null then raise exception 'el reporte exige un detalle (que paso)' using errcode = '23502'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'indica las piezas afectadas' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: solo un pedido enviado puede reportar un paquete perdido o danado', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if not operacion.origen_es_bodega(ped.origen) then raise exception 'el pedido % sale directo del proveedor: el reclamo se hace con el proveedor, no con la bodega', ped.folio using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('paquete_incidente', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'tipo', p_tipo, 'sentido', 'salida'));
  insert into operacion.paquete_incidente (sentido, tipo, pedido_id, detalle, fecha_neg, reportado_por, evento_id) values ('salida', p_tipo, ped.id, btrim(p_detalle), negocio.hoy(), auth.uid(), v_ev)
    returning id, folio into v_id, v_folio;
  for x in select * from jsonb_array_elements(p_lineas) loop
    v_linea := (x->>'linea_id')::bigint; v_pz := (x->>'piezas')::int;
    if v_linea is null or v_pz is null or v_pz <= 0 then raise exception 'cada renglon necesita linea y piezas positivas' using errcode = '22023'; end if;
    select coalesce((x->>'sku_id')::bigint, l.sku_id), l.modelo_id into v_sku, v_modelo from operacion.pedido_linea l where l.id = v_linea and l.pedido_id = ped.id;
    if v_sku is null then raise exception 'el renglon % no es de este pedido', v_linea using errcode = '22023'; end if;
    select coalesce(sum(s.piezas), 0)::int, coalesce(sum(s.costo_valor_cent), 0)::bigint into v_surt, v_costo from operacion.pedido_surtido s where s.pedido_linea_id = v_linea and s.sku_id = v_sku;
    select coalesce(sum(il.piezas), 0)::int into v_ya from operacion.paquete_incidente_linea il join operacion.paquete_incidente i on i.id = il.incidente_id
      where il.pedido_linea_id = v_linea and il.sku_id = v_sku and il.incidente_id <> v_id;
    if v_surt = 0 then raise exception 'de ese renglon y sabor no salio ninguna pieza' using errcode = '22023'; end if;
    if exists (select 1 from operacion.paquete_incidente_linea il where il.incidente_id = v_id and il.pedido_linea_id = v_linea and il.sku_id = v_sku) then raise exception 'renglon repetido en el reporte' using errcode = '22023'; end if;
    if v_pz + v_ya + operacion.devuelto_linea_sku(v_linea, v_sku) > v_surt then raise exception 'solo salieron % pz de ese renglon, ya hay % reportadas y % devueltas', v_surt, v_ya, operacion.devuelto_linea_sku(v_linea, v_sku) using errcode = '23514'; end if;
    v_val := negocio.redondear_medio_arriba(v_costo * v_pz, v_surt);
    insert into operacion.paquete_incidente_linea (incidente_id, sku_id, modelo_id, piezas, valor_cent, pedido_linea_id) values (v_id, v_sku, v_modelo, v_pz, v_val, v_linea);
    v_total_pz := v_total_pz + v_pz; v_total_val := v_total_val + v_val;
  end loop;
  select nombre_canonico into v_cli from catalogo.cliente where id = ped.cliente_id;
  perform operacion.avisar('paquete_incidente_reportado', 'NT-080', 'paquete_incidente:' || v_id, 'I',
    'Paquete ' || case p_tipo when 'perdido' then 'perdido' else 'danado' end || ' ' || v_folio || ': ' || v_total_pz || ' pz del pedido ' || ped.folio || ' (' || v_cli || ')',
    'paquete_incidente', v_id, jsonb_build_object('folio', v_folio, 'tipo', p_tipo, 'sentido', 'salida', 'piezas', v_total_pz), ped.duenio_id, v_ev, false, array['software', 'telegram']);
  v_res := jsonb_build_object('incidente_id', v_id, 'folio', v_folio, 'sentido', 'salida', 'piezas', v_total_pz, 'valor_cent', v_total_val);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function operacion.anular_devolucion_cliente(p_clave_idem text, p_devolucion bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_x record; d operacion.devolucion_cliente; ped operacion.pedido; v_ev bigint; m operacion.movimiento_inventario; v_n int := 0; v_reap bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_devolucion_cliente', 'd', p_devolucion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into d from operacion.devolucion_cliente where id = p_devolucion;
  if not found then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = d.pedido_id for update;
  if exists (select 1 from operacion.devolucion_cliente_anulacion where devolucion_id = d.id) then raise exception 'la devolucion % ya esta anulada', d.folio using errcode = 'P0428'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %', ped.folio, ped.estado using errcode = 'P0428'; end if;
  -- Las piezas que volvieron a inventario deben seguir libres: si otro pedido ya las aparto, anular dejaria disponible negativo.
  for v_x in select mi.sku_id, sum(mi.cantidad)::int as n from operacion.movimiento_inventario mi where mi.evento_id = d.evento_id and mi.ubicacion = 'bodega_omar' group by mi.sku_id having sum(mi.cantidad) > 0 loop
    if operacion.disponible_sku(v_x.sku_id) < v_x.n then
      raise exception 'no se puede anular %: % pz de ese sabor ya estan apartadas o vendidas (disponible %)', d.folio, v_x.n, operacion.disponible_sku(v_x.sku_id) using errcode = 'P0423';
    end if;
  end loop;
  v_ev := operacion.crear_evento('devolucion_cliente_anulada', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'devolucion', d.folio, 'motivo', p_motivo), null, d.evento_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = d.evento_id order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  insert into operacion.devolucion_cliente_anulacion (devolucion_id, motivo, evento_id) values (d.id, btrim(p_motivo), v_ev);
  v_reap := operacion.aplicar_fifo(d.cliente_id, v_ev);
  v_res := jsonb_build_object('devolucion_id', d.id, 'folio', d.folio, 'movimientos_revertidos', v_n, 'reaplicado_cent', v_reap, 'saldo_pedido_cent', operacion.pedido_saldo(ped.id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function operacion.guardar_documento_devolucion(p_tipo text, p_devolucion bigint, p_variante text, p_sha256 text, p_contenido bytea) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_tipo = 'cliente' then
    if not exists (select 1 from operacion.devolucion_cliente where id = p_devolucion) then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
  elsif p_tipo = 'proveedor' then
    if not exists (select 1 from operacion.devolucion_proveedor where id = p_devolucion) then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
  else raise exception 'tipo invalido' using errcode = '22023'; end if;
  if p_contenido is null or encode(sha256(p_contenido), 'hex') <> p_sha256 then raise exception 'la huella no corresponde al contenido' using errcode = '23514'; end if;
  insert into operacion.devolucion_documento (tipo, devolucion_id, variante, sha256, contenido) values (p_tipo, p_devolucion, p_variante, p_sha256, p_contenido) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function operacion.ds_conciliacion(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_ped bigint; v_ds bigint; v_otros bigint; v_er jsonb; v_neta bigint; v_prov boolean;
begin
  select coalesce(sum(v.utilidad_total_cent), 0)::bigint, coalesce(sum(v.utilidad_total_cent) filter (where v.origen_surtido = 'dropshipping'), 0)::bigint, coalesce(bool_or(v.utilidad_provisional), false)
    into v_ped, v_ds, v_prov from operacion.v_ds_pedido v where v.estado = 'enviado' and v.fecha_envio between p_ini and p_fin;
  select coalesce(sum(l.haber_cent - l.debe_cent), 0)::bigint into v_otros from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join contabilidad.cuenta c on c.codigo = l.cuenta
    where c.tipo in ('I', 'C', 'G') and a.fecha_contable between p_ini and p_fin
      and l.cuenta not in ('4110', '4120', '4130', '4210', '4220', '4300', '4910', '5100', '5110', '6110', '6120');
  -- Devoluciones de clientes: el libro las trae netas (4220 y el costo que regreso); la utilidad por pedido no. Se restan aqui, y la merma de lo danado
  -- (5200 de esos eventos) no se cuenta dos veces entre los demas movimientos.
  v_ped := v_ped + coalesce((operacion.utilidad_periodo(p_ini, p_fin)->>'devoluciones_cent')::bigint, 0);
  v_otros := v_otros - coalesce((select sum(l.haber_cent - l.debe_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento ev on ev.id = a.evento_id
                                  where l.cuenta = '5200' and ev.tipo in ('devolucion_cliente', 'devolucion_cliente_anulada') and a.fecha_contable between p_ini and p_fin), 0)::bigint;
  v_er := contabilidad.estado_resultados(p_ini, p_fin);
  v_neta := (v_er->>'utilidad_neta_cent')::bigint;
  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'utilidad_pedidos_cent', v_ped, 'utilidad_dropshipping_cent', v_ds, 'utilidad_inventario_cent', v_ped - v_ds,
    'otros_no_pedido_cent', v_otros, 'utilidad_periodo_cent', v_neta, 'diferencia_cent', v_neta - v_ped - v_otros, 'cuadra', v_neta = v_ped + v_otros, 'provisional', v_prov,
    'socios', (select jsonb_agg(jsonb_build_object('socio', r.socio, 'utilidad_periodo_cent', r.monto_cent) order by r.socio_id) from operacion.ds_reparto(v_neta) r));
end $$;

create or replace function operacion.movimientos_utilidad() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_u jsonb; v_total bigint; v_ped jsonb; v_socios jsonb; v_cs jsonb; v_na bigint; v_nj bigint; v_deuda jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', x.id, 'folio', x.folio, 'cliente', x.cliente, 'fecha_envio', x.fecha_envio, 'utilidad_cent', x.u, 'provisional', x.prov, 'cobrado_cent', x.cobrado) order by x.fecha_envio desc, x.id desc), '[]'::jsonb),
         coalesce(sum(x.u), 0)::bigint
    into v_ped, v_total
    from (select pe.id, pe.folio, c.nombre_canonico as cliente, pe.fecha_envio, ((n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint - operacion.devolucion_efecto_pedido(pe.id)) as u,
                 coalesce((n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean, false) as prov,
                 coalesce((select sum(a.monto_cent) from operacion.pago_aplicacion a where a.pedido_id = pe.id), 0)::bigint as cobrado
            from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
            join operacion.nota n on n.id = (select max(z.id) from operacion.nota z where z.pedido_id = pe.id)
           where pe.estado = 'enviado') x;
  v_u := operacion.utilidad_periodo('2000-01-01', negocio.hoy());
  select coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre,
           'mitad_cent', case s.nombre when 'Javier' then ((v_u->>'utilidad_cent')::bigint / 2) else (v_u->>'utilidad_cent')::bigint - ((v_u->>'utilidad_cent')::bigint / 2) end,
           'retirado_cent', operacion.libro_socio(s.id, 'retiro'), 'retenido_cent', operacion.saldo_socio(s.id, 'fondos')) order by s.nombre), '[]'::jsonb)
    into v_socios from catalogo.socio s;
  v_cs := operacion.cuenta_socios();
  -- Posicion de cada socio con la sociedad: la MISMA cifra que el encabezado de la app (api.pulso): neto_socio, + la sociedad le debe, - el debe.
  v_na := operacion.neto_socio((select id from catalogo.socio where nombre = 'Angelo'));
  v_nj := operacion.neto_socio((select id from catalogo.socio where nombre = 'Javier'));
  v_deuda := operacion.posicion_socios();
  -- posicion_diferencia_cent es la brecha entre las dos posiciones (lo que muestra el encabezado); quien debe a quien es la MITAD de la brecha de lo aportado neto
  -- (spec 14, seccion 12: (AportadoNeto(A) - AportadoNeto(J)) / 2), la misma cifra de cuenta_socios() cuando la compra la pusieron los socios.
  return jsonb_build_object('posicion_angelo_cent', v_na, 'posicion_javier_cent', v_nj,
    'posicion_mayor', case when v_na >= v_nj then 'Angelo' else 'Javier' end, 'posicion_diferencia_cent', abs(v_na - v_nj),
    'deudor', v_deuda->>'deudor', 'acreedor', v_deuda->>'acreedor', 'deuda_entre_socios_cent', (v_deuda->>'monto_cent')::bigint,
    'pedidos', v_ped, 'utilidad_pedidos_cent', v_total, 'utilidad_total_cent', (v_u->>'utilidad_cent')::bigint, 'provisional', (v_u->>'provisional')::boolean,
    'socios', v_socios, 'javier_debe_a_angelo_cent', (v_cs->>'javier_debe_a_angelo_cent')::bigint, 'cuadra', (v_cs->>'cuadra')::boolean, 'costo_cent', (v_cs->>'costo_cent')::bigint);
end $$;

create or replace function operacion.historial_socio(p_socio text, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy(); v_hasta date := least(coalesce(p_hasta, v_hoy), negocio.hoy()); v_id bigint; v_otro bigint; v_primera date; v_ini_mes date;
  v_inv bigint; v_rei bigint; v_ret jsonb; v_cap jsonb; v_fila jsonb; v_ef jsonb; v_u jsonb; v_vol jsonb; v_flujos jsonb; v_actas jsonb;
  v_dias jsonb; v_sem jsonb; v_mes jsonb; v_cli_top jsonb; v_mod_top jsonb; v_cab jsonb; v_meses int; v_comp jsonb := '{}'::jsonb;
  r record;
begin
  select id into v_id from catalogo.socio where nombre = p_socio and nombre in ('Angelo', 'Javier');
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  select id into v_otro from catalogo.socio where nombre in ('Angelo', 'Javier') and id <> v_id;
  select min(f) into v_primera from (select min(fecha_neg) f from operacion.pedido where estado = 'enviado' union all select min(fecha_neg) from operacion.aportacion_socio
                                     union all select min(fecha_neg) from operacion.socio_libro union all select min(fecha_neg) from operacion.gasto) x;
  v_primera := least(v_primera, v_hasta);

  -- Cabecera (estado a la fecha de corte; por omision hoy). TODAS las cifras de capital salen de operacion.cap_periodo (la misma funcion de api.capital_por_mes), sin definiciones propias:
  --   invertido = capital aportado acumulado; valor = valuacion personal; aportacion neta, diferencia a igualar y turno; retirado = retirado_socio (retiros de utilidad + devolucion de aportaciones).
  v_cap := operacion.hist_cap(v_hasta);
  v_fila := operacion.hist_cap_socio(v_cap, p_socio);
  select coalesce(sum(a.monto_cent), 0)::bigint into v_rei from operacion.aportacion_socio a where a.socio_id = v_id and a.clasificacion = 'capital' and a.ref_tipo = 'reinversion' and a.fecha_neg <= v_hasta;
  v_inv := (v_fila ->> 'capital_aportado_acum_cent')::bigint;
  v_ret := operacion.retirado_socio(v_id, p_socio, date '1900-01-01', v_hasta);
  v_ef := operacion.efectivo_sociedad();
  v_meses := case when v_primera is null then 0 else greatest(1, (extract(year from age(v_hasta, v_primera)) * 12 + extract(month from age(v_hasta, v_primera)))::int + 1) end;

  v_cab := jsonb_build_object(
    'aportaciones_cent', v_inv - v_rei, 'reinversion_cent', v_rei, 'invertido_cent', v_inv,
    'invertido_ambos_cent', (v_cap -> 'total' ->> 'capital_aportado_acum_cent')::bigint,
    'retirado_utilidad_cent', (v_ret ->> 'utilidad_cent')::bigint, 'retirado_capital_cent', (v_ret ->> 'capital_cent')::bigint, 'retirado_cent', (v_ret ->> 'total_cent')::bigint,
    'utilidad_asignada_cent', operacion.libro_socio(v_id, 'utilidad_asignada'), 'utilidad_por_distribuir_cent', operacion.utilidad_por_distribuir(v_id),
    'capital_contable_cent', (v_cap -> 'balance' ->> 'total_capital_cent')::bigint,
    'valor_cent', case when (v_cap ->> 'hay_movimientos')::boolean then (v_fila ->> 'valuacion_cent')::bigint end, 'valor_libro_cent', (v_fila ->> 'valuacion_libro_cent')::bigint, 'participacion_bp', (v_fila ->> 'participacion_bp')::int,
    'aportado_cent', (v_fila ->> 'aportado_cent')::bigint, 'fondos_cent', (v_fila ->> 'fondos_en_poder_cent')::bigint,
    'aportacion_neta_cent', (v_fila ->> 'aportacion_neta_cent')::bigint, 'diferencia_a_igualar_cent', (v_fila ->> 'diferencia_a_igualar_cent')::bigint,
    'le_toca_aportar', (v_fila ->> 'le_toca_aportar')::boolean, 'turno_aportar', v_cap ->> 'turno_aportar', 'igualados', (v_cap ->> 'igualados')::boolean,
    'reembolso_pendiente_cent', operacion.reembolso_pendiente(v_id),
    'efectivo_total_cent', (v_ef ->> 'total_cent')::bigint, 'efectivo_disponible_cent', (v_ef ->> 'disponible_cent')::bigint,
    'primera_fecha', v_primera, 'meses_activo', v_meses);
  -- Estado de la comprobacion por dos vias de cada cifra de la cabecera: sale de la misma funcion que usa "Explicar este numero", con el mismo periodo ya calculado (null = sin dato o sin comprobar).
  for r in select unnest(array['invertido', 'retirado', 'utilidad', 'valor', 'neta']) as k loop
    begin
      v_comp := v_comp || jsonb_build_object(r.k, (operacion.explicar_historial('historial:' || r.k || ':' || p_socio, v_cap, v_hasta) -> 'comprobacion' ->> 'cuadra')::boolean);
    exception when others then v_comp := v_comp || jsonb_build_object(r.k, null);
    end;
  end loop;
  v_cab := v_cab || jsonb_build_object('comprobaciones', v_comp);

  -- Totales de toda la historia hasta la fecha de corte.
  if v_primera is not null then
    v_u := operacion.utilidad_periodo(v_primera, v_hasta);
    v_vol := operacion.volumen_periodo(v_primera, v_hasta);
  end if;

  -- Flujos fechados del socio para su TIR: lo invertido (salida: aportaciones declaradas y capital de apertura; la reinversion es dinero que ya estaba dentro) y lo retirado (entrada, misma definicion
  -- que la tarjeta: retiros de utilidad, liquidaciones recibidas, retiros de la apertura y devolucion de aportaciones). Una reversa cuenta con la fecha en que se deshizo.
  select coalesce(jsonb_agg(f order by (f ->> 'fecha')), '[]'::jsonb) into v_flujos from (
    select jsonb_build_object('fecha', a.fecha_neg, 'monto_cent', -a.monto_cent, 'tipo', 'aportacion') f from operacion.aportacion_socio a
     where a.socio_id = v_id and a.clasificacion = 'capital' and coalesce(a.ref_tipo, '') <> 'reinversion'
    union all
    select jsonb_build_object('fecha', a.fecha_contable, 'monto_cent', -(l.haber_cent - l.debe_cent), 'tipo', 'aportacion')
      from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
     where l.cuenta = contabilidad.cta_socio(v_id, 3110) and a.es_apertura and not exists (select 1 from contabilidad.asiento rv where rv.reversa_de = a.id) and (l.haber_cent - l.debe_cent) <> 0
    union all
    select jsonb_build_object('fecha', l.fecha_neg, 'monto_cent', -l.monto_cent, 'tipo', case when coalesce(o.concepto, l.concepto) = 'pago_devolucion_aportacion' then 'retiro_capital' else 'retiro' end)
      from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
     where l.socio_id = v_id and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida', 'pago_devolucion_aportacion')
    union all
    select jsonb_build_object('fecha', a.fecha_contable, 'monto_cent', (l.debe_cent - l.haber_cent), 'tipo', 'retiro')
      from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
     where l.cuenta = contabilidad.cta_socio(v_id, 3210) and a.es_apertura and not exists (select 1 from contabilidad.asiento rv where rv.reversa_de = a.id) and (l.debe_cent - l.haber_cent) <> 0) q;

  -- Linea de tiempo de actas (la contra-acta se ve como un renglon propio).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'folio', c.folio, 'tipo', c.tipo, 'periodo_ini', c.periodo_ini, 'periodo_fin', c.periodo_fin, 'utilidad_cent', c.utilidad_cent,
      'parte_cent', coalesce((c.snapshot -> 'por_socio' -> p_socio ->> 'utilidad_cent')::bigint, 0),
      'retira_cent', coalesce((c.decisiones -> p_socio ->> 'retira')::bigint, 0), 'reinvierte_cent', coalesce((c.decisiones -> p_socio ->> 'reinvierte')::bigint, 0),
      'estado', case when exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) then 'anulado'
                     when (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) >= 2 then 'cerrado'
                     when exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id) then 'firmado_por_uno' else 'propuesto' end,
      -- Corregida = hay una contra-acta FIRMADA por los dos (su efecto ya se deshizo); con la contra-acta solo propuesta el acta sigue vigente.
      'corregida', exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = k.id)
                           and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = k.id) >= 2),
      'contra_propuesta', exists (select 1 from operacion.cierre_reparto k where k.corrige_a = c.id and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = k.id)
                                  and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = k.id) < 2),
      'firmas', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'firmado_at', f.firmado_at) order by f.id) from operacion.cierre_reparto_firma f join catalogo.socio s on s.id = f.socio_id where f.cierre_id = c.id), '[]'::jsonb),
      'capital_contable_cent', (select (s.contenido ->> 'capital_contable_cent')::bigint from operacion.acta_sello s where s.cierre_id = c.id),
      'valor_cent', (select (s.contenido -> 'valor_participacion_cent' ->> p_socio)::bigint from operacion.acta_sello s where s.cierre_id = c.id),
      'huella', (select s.huella from operacion.acta_sello s where s.cierre_id = c.id)) order by c.periodo_fin desc, c.id desc), '[]'::jsonb)
    into v_actas from operacion.cierre_reparto c where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id);

  -- Series: ultimos 60 dias, 26 semanas y los meses desde la primera actividad (maximo 36).
  v_dias := '[]'::jsonb; v_sem := '[]'::jsonb; v_mes := '[]'::jsonb;
  if v_primera is not null then
    for r in select * from operacion.historial_cubetas(greatest(v_primera, v_hasta - 59), v_hasta, 'dia') loop
      v_dias := v_dias || operacion.historial_fila(p_socio, v_id, r.ini, r.fin, r.parcial);
    end loop;
    for r in select * from operacion.historial_cubetas(greatest(v_primera, (date_trunc('week', v_hasta::timestamp) - interval '25 weeks')::date), v_hasta, 'semana') loop
      v_sem := v_sem || operacion.historial_fila(p_socio, v_id, greatest(r.ini, v_primera), r.fin, r.parcial);
    end loop;
    v_ini_mes := greatest(date_trunc('month', v_primera)::date, (date_trunc('month', v_hasta::timestamp) - interval '35 months')::date);
    for r in select * from operacion.historial_cubetas(v_ini_mes, v_hasta, 'mes') loop
      v_mes := v_mes || operacion.historial_fila(p_socio, v_id, greatest(r.ini, v_primera), r.fin, r.parcial);
    end loop;

    -- Utilidad por cliente (pedido enviado) y por modelo (venta menos costo), con la utilidad que ya trae la nota de cada pedido.
    select coalesce(jsonb_agg(jsonb_build_object('cliente_id', q.cid, 'cliente', q.nombre, 'pedidos', q.pedidos, 'piezas', q.piezas, 'utilidad_cent', q.util, 'parte_cent', operacion.cap_mitad(q.util, p_socio))
                             order by q.util desc, q.nombre), '[]'::jsonb) into v_cli_top
      from (select * from (select cl.id as cid, cl.nombre_canonico as nombre, count(*)::int as pedidos,
                   coalesce(sum((select sum((l ->> 'piezas')::int) from jsonb_array_elements(coalesce(nn.s -> 'lineas', '[]'::jsonb)) l)), 0)::bigint as piezas,
                   coalesce(sum((nn.s -> 'cascada' ->> 'utilidad_cent')::bigint - operacion.devolucion_efecto_pedido(pe.id, v_hasta)), 0)::bigint as util
              from operacion.pedido pe join catalogo.cliente cl on cl.id = pe.cliente_id
              cross join lateral (select n.snapshot_interno as s from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn
             where pe.estado = 'enviado' and pe.fecha_envio between v_primera and v_hasta group by cl.id, cl.nombre_canonico) z order by z.util desc, z.nombre limit 10) q;
    select coalesce(jsonb_agg(jsonb_build_object('modelo', q.modelo, 'piezas', q.piezas, 'venta_cent', q.venta, 'costo_cent', q.costo, 'utilidad_cent', q.venta - q.costo, 'parte_cent', operacion.cap_mitad(q.venta - q.costo, p_socio))
                             order by q.venta - q.costo desc, q.modelo), '[]'::jsonb) into v_mod_top
      from (select * from (select z0.modelo, z0.piezas - coalesce(d.pz, 0) as piezas, z0.venta - coalesce(d.venta, 0) as venta, z0.costo - coalesce(d.costo, 0) as costo
              from (select m ->> 'modelo' as modelo, sum((m ->> 'piezas')::int)::bigint as piezas, sum((m ->> 'venta_cent')::bigint)::bigint as venta, sum((m ->> 'costo_cent')::bigint)::bigint as costo
              from operacion.pedido pe
              cross join lateral (select n.snapshot_interno as s from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn
              cross join lateral jsonb_array_elements(coalesce(nn.s -> 'por_modelo', '[]'::jsonb)) m
             where pe.estado = 'enviado' and pe.fecha_envio between v_primera and v_hasta group by m ->> 'modelo') z0
              left join (select mo.nombre_canonico as modelo, sum(l.piezas)::bigint as pz, sum(l.monto_cent)::bigint as venta, coalesce(sum(l.costo_valor_cent) filter (where l.destino = 'inventario'), 0)::bigint as costo
                           from operacion.devolucion_cliente_linea l join operacion.devolucion_cliente dc on dc.id = l.devolucion_id join catalogo.modelo mo on mo.id = l.modelo_id
                           join operacion.pedido pe2 on pe2.id = dc.pedido_id
                          where pe2.estado = 'enviado' and pe2.fecha_envio between v_primera and v_hasta and dc.fecha_neg <= v_hasta
                            and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = dc.id) group by mo.nombre_canonico) d on d.modelo = z0.modelo) z order by z.venta - z.costo desc, z.modelo limit 10) q;
  end if;

  return jsonb_build_object(
    'socio', p_socio, 'otro', (select nombre from catalogo.socio where id = v_otro), 'hoy', v_hoy, 'hasta', v_hasta, 'con_historial', v_primera is not null,
    'cabecera', v_cab, 'flujos', v_flujos, 'actas', v_actas,
    'totales', case when v_primera is null then null else jsonb_build_object('utilidad_cent', (v_u ->> 'utilidad_cent')::bigint, 'parte_cent', operacion.cap_mitad((v_u ->> 'utilidad_cent')::bigint, p_socio),
      'pedidos', (v_u ->> 'pedidos')::int, 'piezas', (v_vol ->> 'piezas')::bigint, 'ventas_cent', (v_vol ->> 'ventas_cent')::bigint, 'provisional', (v_u ->> 'provisional')::boolean) end,
    'dias', v_dias, 'semanas', v_sem, 'meses', v_mes, 'por_cliente', coalesce(v_cli_top, '[]'::jsonb), 'por_modelo', coalesce(v_mod_top, '[]'::jsonb));
end $$;
