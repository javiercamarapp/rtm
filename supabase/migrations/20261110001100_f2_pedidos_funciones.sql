-- F2 / 0011: funciones del pedido (crear, confirmar, empacar, enviar, anular, corregir), nota tipo invoice y guias de salida.

create function operacion.origen_es_bodega(p_origen text) returns boolean
language sql immutable parallel safe set search_path = ''
as $$ select p_origen in ('bodega_omar', 'castores') $$;

-- Formato de pesos para los textos guardados: "7,000" (enteros) o "13,590.00" (con centavos). Solo presentacion: ninguna cifra se calcula aqui.
create function operacion.fmt_pesos(p_cent bigint, p_centavos boolean default false) returns text
language plpgsql immutable parallel safe set search_path = ''
as $$
declare v_abs bigint := abs(p_cent); v_txt text;
begin
  v_txt := to_char(v_abs / 100, 'FM999,999,999,990');
  if p_centavos or v_abs % 100 <> 0 then v_txt := v_txt || '.' || lpad((v_abs % 100)::text, 2, '0'); end if;
  return case when p_cent < 0 then '-' else '' end || v_txt;
end $$;

create function operacion.pedido_cobrado(p_pedido bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when pe.estado = 'enviado' then coalesce((select n.total_cent from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0) else 0 end
  from operacion.pedido pe where pe.id = p_pedido
$$;

create function operacion.pedido_aplicado(p_pedido bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(monto_cent), 0)::bigint from operacion.pago_aplicacion where pedido_id = p_pedido $$;

-- Saldo por cobrar del pedido (cobrado - aplicado). Negativo = se aplico de mas. null si el pedido no existe.
create function operacion.pedido_saldo(p_pedido bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select operacion.pedido_cobrado(pe.id) - operacion.pedido_aplicado(pe.id) from operacion.pedido pe where pe.id = p_pedido $$;

create function operacion.saldo_cliente(p_cliente bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(sum(operacion.pedido_saldo(pe.id)), 0)::bigint from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' $$;

-- Disponible = fisico en Bodega Omar - comprometido (reservas activas).
create function operacion.disponible_sku(p_sku bigint) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = p_sku and u.ubicacion = 'bodega_omar'), 0)
       - coalesce((select sum(r.piezas) from operacion.reserva r where r.sku_id = p_sku and r.estado = 'activa'), 0)::int
$$;

-- Costo de referencia para avisar de ventas a costo: promedio del inventario (bodega) o costo vigente del proveedor de origen.
create function operacion.costo_ref_pedido(p_origen text, p_modelo bigint, p_fecha date) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_prom bigint; v_isaac bigint := catalogo.proveedor_id('Isaac'); v_karen bigint := catalogo.proveedor_id('Karen'); v_seguro bigint;
begin
  if operacion.origen_es_bodega(p_origen) then
    select costo_prom_cent into v_prom from operacion.existencia_modelo where modelo_id = p_modelo and piezas > 0;
    return coalesce(v_prom, catalogo.costo_vigente(v_isaac, p_modelo, p_fecha));
  elsif p_origen = 'karen_directo' then return catalogo.costo_vigente(v_karen, p_modelo, p_fecha);
  elsif p_origen = 'karen_via_isaac' then
    v_seguro := (catalogo.config_valor('seguro_reenvio_cent', p_fecha))::text::bigint;
    return catalogo.costo_vigente(v_karen, p_modelo, p_fecha) + coalesce(v_seguro, 0);
  else return catalogo.costo_vigente(v_isaac, p_modelo, p_fecha);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Nota tipo invoice
-- ---------------------------------------------------------------------------
-- Texto de WhatsApp (formato corto de Angelo), a partir del snapshot del cliente.
create function operacion.texto_nota(p_snap jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare v text; l jsonb;
begin
  v := 'Nota ' || (p_snap->>'cliente');
  for l in select * from jsonb_array_elements(p_snap->'lineas_texto') loop
    v := v || E'\n' || (l->>'modelo') || ' ' || (l->>'piezas') || 'pz x $' || operacion.fmt_pesos((l->>'precio_cent')::bigint) || ' = ' || operacion.fmt_pesos((l->>'total_cent')::bigint);
  end loop;
  if (p_snap->>'envio_cent')::bigint > 0 then v := v || E'\nEnvío $' || operacion.fmt_pesos((p_snap->>'envio_cent')::bigint); end if;
  if (p_snap->>'recargo_cent')::bigint > 0 then v := v || E'\nRecargo $' || operacion.fmt_pesos((p_snap->>'recargo_cent')::bigint); end if;
  if (p_snap->>'descuento_cent')::bigint > 0 then v := v || E'\nDescuento -$' || operacion.fmt_pesos((p_snap->>'descuento_cent')::bigint); end if;
  v := v || E'\n\ntotal a saldar ' || operacion.fmt_pesos((p_snap->>'total_cent')::bigint, true);
  return v;
end $$;

-- Arma los dos documentos de un pedido ya surtido: {cliente, interno, total_cent}. p_ajustes (correcciones): {precios:{"<linea_id>":cent}, envio_cent, descuento_cent, recargo_cent}.
create function operacion.armar_nota(p_pedido bigint, p_ajustes jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ped operacion.pedido; v_cli text; v_dueno text; v_envio bigint; v_desc bigint; v_rec bigint; v_precios jsonb := coalesce(p_ajustes->'precios', '{}'::jsonb);
  v_grupos jsonb; v_texto jsonb; v_sub bigint; v_piezas int; v_total bigint; v_costo bigint; v_renta bigint; v_guia bigint; v_guia_pend boolean; v_lineas jsonb; v_modelos jsonb;
  v_pedidas int; v_salidas int; v_c1_a bigint; v_c1_b bigint; v_cliente jsonb; v_interno jsonb;
begin
  select * into ped from operacion.pedido where id = p_pedido;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  select c.nombre_canonico, s.nombre into v_cli, v_dueno from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.id = ped.cliente_id;
  v_envio := coalesce((p_ajustes->>'envio_cent')::bigint, ped.envio_cent);
  v_desc := coalesce((p_ajustes->>'descuento_cent')::bigint, ped.descuento_cent);
  v_rec := coalesce((p_ajustes->>'recargo_cent')::bigint, ped.recargo_cent);

  create temporary table if not exists _nota_rows (linea_id bigint, modelo text, sabor text, piezas int, precio bigint, costo bigint) on commit drop;
  delete from _nota_rows;
  insert into _nota_rows
  select l.id, m.nombre_canonico, sa.nombre_canonico, s.piezas, coalesce((v_precios->>(l.id::text))::bigint, l.precio_cent), s.costo_valor_cent
  from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join catalogo.sku k on k.id = s.sku_id
       join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
  where l.pedido_id = p_pedido;

  select coalesce(sum(piezas), 0)::int, coalesce(sum(piezas * precio), 0)::bigint, coalesce(sum(costo), 0)::bigint into v_piezas, v_sub, v_costo from _nota_rows;
  v_total := v_sub + v_envio + v_rec - v_desc;
  select coalesce(sum(renta_cent), 0)::bigint into v_renta from operacion.pedido_linea where pedido_id = p_pedido;
  select sum(g.costo_cent)::bigint, (count(*) = 0 or bool_or(g.costo_cent is null)) into v_guia, v_guia_pend from operacion.guia g where g.pedido_id = p_pedido and g.sentido = 'salida';
  v_guia_pend := coalesce(v_guia_pend, true);

  select coalesce(jsonb_agg(jsonb_build_object('modelo', g.modelo, 'piezas', g.piezas, 'subtotal_cent', g.sub, 'sabores', g.sab) order by g.modelo), '[]'::jsonb) into v_grupos
  from (select x.modelo, sum(x.piezas)::int as piezas, sum(x.piezas * x.precio)::bigint as sub,
               jsonb_agg(jsonb_build_object('sabor', x.sabor, 'piezas', x.piezas, 'precio_cent', x.precio, 'total_cent', x.piezas * x.precio) order by x.sabor, x.precio) as sab
        from (select modelo, sabor, precio, sum(piezas)::int as piezas from _nota_rows group by modelo, sabor, precio) x group by x.modelo) g;
  select coalesce(jsonb_agg(jsonb_build_object('modelo', t.modelo, 'piezas', t.piezas, 'precio_cent', t.precio, 'total_cent', t.piezas * t.precio) order by t.modelo, t.precio), '[]'::jsonb) into v_texto
  from (select modelo, precio, sum(piezas)::int as piezas from _nota_rows group by modelo, precio) t;

  v_cliente := jsonb_build_object('folio', ped.folio, 'fecha', ped.fecha_envio, 'cliente', v_cli, 'entrega', coalesce(ped.paqueteria, case when operacion.origen_es_bodega(ped.origen) then 'Entrega desde Mérida' else 'Envío directo' end),
    'grupos', v_grupos, 'lineas_texto', v_texto, 'piezas_total', v_piezas, 'subtotal_cent', v_sub, 'envio_cent', v_envio, 'recargo_cent', v_rec, 'descuento_cent', v_desc, 'total_cent', v_total);

  select coalesce(jsonb_agg(jsonb_build_object('linea_id', r.linea_id, 'modelo', r.modelo, 'sabor', r.sabor, 'piezas', r.piezas, 'precio_cent', r.precio, 'venta_cent', r.piezas * r.precio, 'costo_cent', r.costo,
                                               'costo_unit_cent', negocio.redondear_medio_arriba(r.costo, r.piezas), 'utilidad_cent', r.piezas * r.precio - r.costo) order by r.modelo, r.sabor), '[]'::jsonb) into v_lineas from _nota_rows r;
  select coalesce(jsonb_agg(jsonb_build_object('modelo', m.modelo, 'piezas', m.piezas, 'venta_cent', m.venta, 'costo_cent', m.costo, 'utilidad_cent', m.venta - m.costo) order by m.modelo), '[]'::jsonb) into v_modelos
  from (select modelo, sum(piezas)::int as piezas, sum(piezas * precio)::bigint as venta, sum(costo)::bigint as costo from _nota_rows group by modelo) m;
  select coalesce(sum(piezas_pedidas), 0)::int, coalesce(sum(piezas_surtidas), 0)::int into v_pedidas, v_salidas from operacion.pedido_linea where pedido_id = p_pedido;
  v_c1_a := v_sub;
  select coalesce(sum(m.venta), 0)::bigint into v_c1_b from (select sum(piezas * precio)::bigint as venta from _nota_rows group by modelo) m;

  v_interno := jsonb_build_object('folio', ped.folio, 'cliente', v_cli, 'duenio', v_dueno, 'origen', ped.origen, 'lineas', v_lineas, 'por_modelo', v_modelos,
    'cascada', jsonb_build_object('venta_cent', v_sub, 'envio_cent', v_envio, 'recargo_cent', v_rec, 'descuento_cent', -v_desc, 'total_cent', v_total, 'costo_cent', v_costo, 'renta_cent', v_renta,
                                  'guia_cent', v_guia, 'guia_pendiente', v_guia_pend, 'utilidad_cent', v_total - v_costo - v_renta - coalesce(v_guia, 0), 'utilidad_provisional', v_guia_pend),
    'comprobaciones', jsonb_build_object(
      'c1', jsonb_build_object('renglones_cent', v_c1_a, 'modelos_cent', v_c1_b, 'cuadra', v_c1_a = v_c1_b),
      'c2', jsonb_build_object('pedidas', v_pedidas, 'salidas', v_salidas, 'en_nota', v_piezas, 'cobradas', v_piezas, 'pendientes', v_pedidas - v_salidas, 'cuadra', v_salidas = v_piezas)));
  return jsonb_build_object('cliente', v_cliente, 'interno', v_interno, 'total_cent', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- Pedido
-- ---------------------------------------------------------------------------
create function operacion.crear_pedido(p_clave_idem text, p_cliente_id bigint, p_lineas jsonb, p_origen text default 'bodega_omar', p_destino_id bigint default null,
                                       p_envio_cent bigint default 0, p_descuento_cent bigint default 0, p_recargo_cent bigint default 0, p_fecha date default null,
                                       p_excepcion_minimo_motivo text default null, p_plazo_dias int default null, p_paqueteria text default null,
                                       p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); c catalogo.cliente; v_ev bigint; v_id bigint; v_folio text; l jsonb; r jsonb; v_tab bigint; v_precio bigint; v_costo bigint;
  v_lin bigint; v_min int; v_piezas int := 0; v_n int := 0; v_dispo int; v_estado text; v_res jsonb; v_nombre text; v_avisos int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'crear_pedido', 'c', p_cliente_id, 'l', p_lineas, 'o', p_origen, 'd', p_destino_id, 'e', p_envio_cent, 'de', p_descuento_cent,
                                         'r', p_recargo_cent, 'f', p_fecha, 'x', p_excepcion_minimo_motivo, 'pl', p_plazo_dias, 'pq', p_paqueteria, 'n', p_nota, 'mo', p_mensaje_origen));
  if v_prev is not null then return v_prev; end if;
  select * into c from catalogo.cliente where id = p_cliente_id;
  if not found or not c.activo then raise exception 'cliente desconocido o inactivo' using errcode = '22023'; end if;
  if p_origen not in ('bodega_omar', 'karen_directo', 'karen_via_isaac', 'isaac_directo', 'castores') then raise exception 'origen invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'el pedido necesita renglones' using errcode = '22023'; end if;
  if coalesce(p_envio_cent, 0) < 0 or coalesce(p_descuento_cent, 0) < 0 or coalesce(p_recargo_cent, 0) < 0 then raise exception 'envio, descuento y recargo no pueden ser negativos' using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('pedido_creado', v_fecha, p_clave_idem, jsonb_build_object('cliente_id', p_cliente_id, 'origen', p_origen, 'lineas', jsonb_array_length(p_lineas)), p_mensaje_origen);
  v_folio := seguridad.siguiente_folio('P');
  insert into operacion.pedido (folio, cliente_id, destino_id, duenio_id, fecha_neg, origen, excepcion_minimo_motivo, envio_cent, descuento_cent, recargo_cent, plazo_dias, paqueteria, nota, evento_id)
    values (v_folio, p_cliente_id, p_destino_id, c.duenio_id, v_fecha, p_origen, nullif(btrim(p_excepcion_minimo_motivo), ''), coalesce(p_envio_cent, 0), coalesce(p_descuento_cent, 0), coalesce(p_recargo_cent, 0),
            p_plazo_dias, p_paqueteria, p_nota, v_ev) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    r := operacion.resolver_sku(l);
    if coalesce((l->>'piezas')::int, 0) <= 0 then raise exception 'cada renglon necesita piezas positivas' using errcode = '23514'; end if;
    v_tab := catalogo.precio_vigente(p_cliente_id, (r->>'modelo_id')::bigint, v_fecha);
    v_precio := coalesce((l->>'precio_cent')::bigint, v_tab);
    if v_precio is null then raise exception 'el cliente no tiene precio de tabulador para ese modelo: indica el precio' using errcode = '23502'; end if;
    insert into operacion.pedido_linea (pedido_id, sku_id, modelo_id, piezas_pedidas, precio_cent, precio_tabulador_cent, motivo_precio)
      values (v_id, (r->>'sku_id')::bigint, (r->>'modelo_id')::bigint, (l->>'piezas')::int, v_precio, v_tab, nullif(btrim(l->>'motivo_precio'), '')) returning id into v_lin;
    v_piezas := v_piezas + (l->>'piezas')::int; v_n := v_n + 1;
    select nombre_canonico, estado into v_nombre, v_estado from catalogo.modelo where id = (r->>'modelo_id')::bigint;
    -- Avisos NO bloqueantes.
    if v_tab is null then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'sin_precio_catalogo', 'NT-004', v_nombre || ': el cliente no tiene precio de tabulador (precio capturado a mano)');
    elsif v_estado = 'sin_disponibilidad' then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'sin_precio_catalogo', 'NT-004', v_nombre || ' esta sin disponibilidad ahora');
    end if;
    if v_tab is not null and v_precio <> v_tab then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'precio_distinto_tabulador', 'NT-001', v_nombre || ': el precio capturado difiere del tabulador');
    end if;
    v_costo := operacion.costo_ref_pedido(p_origen, (r->>'modelo_id')::bigint, v_fecha);
    if v_costo is not null and v_precio <= v_costo then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'venta_bajo_costo', 'NT-002', v_nombre || ': se vende ' || case when v_precio = v_costo then 'a costo' else 'por debajo del costo' end);
    end if;
    if operacion.origen_es_bodega(p_origen) then
      v_dispo := operacion.disponible_sku((r->>'sku_id')::bigint);
      if v_dispo < (l->>'piezas')::int then
        insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'existencia_insuficiente', null, v_nombre || ': disponibles ' || greatest(v_dispo, 0) || ' pz, se piden ' || (l->>'piezas'));
      end if;
    end if;
  end loop;
  v_min := coalesce((catalogo.config_valor('minimo_piezas_pedido', v_fecha))::text::int, 20);
  if v_piezas < v_min and nullif(btrim(p_excepcion_minimo_motivo), '') is null then
    insert into operacion.pedido_aviso (pedido_id, codigo, nt, detalle) values (v_id, 'minimo_piezas', 'NT-005', 'Pedido de ' || v_piezas || ' pz: el minimo es ' || v_min);
  end if;
  select count(*) into v_avisos from operacion.pedido_aviso where pedido_id = v_id;
  v_res := jsonb_build_object('pedido_id', v_id, 'folio', v_folio, 'piezas', v_piezas, 'lineas', v_n, 'avisos', v_avisos);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Confirmar = reservar. Nada sale ni se devenga todavia.
create function operacion.confirmar_pedido(p_clave_idem text, p_pedido bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; ln record; v_cli text; v_falta int := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'confirmar_pedido', 'p', p_pedido));
  if v_prev is not null then return v_prev; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'borrador' then raise exception 'el pedido % ya esta %', ped.folio, ped.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('pedido_confirmado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio));
  update operacion.pedido set estado = 'confirmado' where id = ped.id;
  if operacion.origen_es_bodega(ped.origen) then
    for ln in select * from operacion.pedido_linea where pedido_id = ped.id order by id loop
      insert into operacion.reserva (sku_id, piezas, origen_tipo, origen_id) values (ln.sku_id, ln.piezas_pedidas, 'pedido', ped.id);
      if operacion.disponible_sku(ln.sku_id) < 0 then v_falta := v_falta + 1; end if;
    end loop;
    select nombre_canonico into v_cli from catalogo.cliente where id = ped.cliente_id;
    perform operacion.avisar('paquete_por_empacar', 'NT-010', 'paquete_por_empacar:' || ped.id, 'I', 'Paquete por empacar: ' || ped.folio || ' (' || v_cli || ')', 'pedido', ped.id,
      jsonb_build_object('folio', ped.folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
    if v_falta > 0 then
      perform operacion.avisar('sabor_faltante_antes_empacar', 'NT-013', 'sabor_faltante:' || ped.id, 'I', 'Falta existencia de algun sabor antes de empacar ' || ped.folio, 'pedido', ped.id,
        jsonb_build_object('folio', ped.folio, 'renglones', v_falta), ped.duenio_id, v_ev, false, array['software', 'telegram']);
    end if;
  end if;
  v_res := jsonb_build_object('pedido_id', ped.id, 'folio', ped.folio, 'estado', 'confirmado', 'renglones_sin_existencia', v_falta);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.cancelar_pedido(p_clave_idem text, p_pedido bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cancelar_pedido', 'p', p_pedido, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'cancelar exige motivo' using errcode = '23502'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado not in ('borrador', 'confirmado') then raise exception 'el pedido % esta %: un pedido enviado se anula, no se cancela', ped.folio, ped.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('pedido_cancelado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'motivo', p_motivo));
  update operacion.pedido set estado = 'cancelado', nota = coalesce(nota || ' | ', '') || 'Cancelado: ' || p_motivo where id = ped.id;
  update operacion.reserva set estado = 'liberada', resuelta_at = now() where origen_tipo = 'pedido' and origen_id = ped.id and estado = 'activa';
  perform operacion.resolver_avisos('paquete_por_empacar', 'pedido', ped.id);
  perform operacion.resolver_avisos('sabor_faltante_antes_empacar', 'pedido', ped.id);
  v_res := jsonb_build_object('pedido_id', ped.id, 'estado', 'cancelado');
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.marcar_empacado(p_clave_idem text, p_pedido bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'marcar_empacado', 'p', p_pedido));
  if v_prev is not null then return v_prev; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'confirmado' or not operacion.origen_es_bodega(ped.origen) then raise exception 'solo un pedido confirmado que sale de la bodega se empaca' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('pedido_empacado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio));
  update operacion.pedido set empacado_at = coalesce(empacado_at, now()) where id = ped.id;
  v_res := jsonb_build_object('pedido_id', ped.id, 'empacado', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Costea una guia: un solo costo (null -> valor). Es gasto de la sociedad; si lo pago un socio se le reembolsa (aportacion reembolsable).
create function operacion.costear_guia(p_guia bigint, p_costo_cent bigint, p_pagada_por text, p_evento bigint) returns void
language plpgsql security definer set search_path = ''
as $$
declare g operacion.guia; v_socio bigint;
begin
  select * into g from operacion.guia where id = p_guia for update;
  if g.costo_cent is not null then raise exception 'la guia ya tiene costo' using errcode = 'P0428'; end if;
  if p_costo_cent is null or p_costo_cent < 0 then raise exception 'costo de guia invalido' using errcode = '23514'; end if;
  if p_pagada_por is not null then select id into v_socio from catalogo.socio where nombre = p_pagada_por; if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if; end if;
  update operacion.guia set costo_cent = p_costo_cent, pagada_por_socio_id = coalesce(v_socio, pagada_por_socio_id), costeada_evento_id = p_evento where id = g.id;
  insert into operacion.gasto (folio, fecha_neg, categoria, monto_cent, pagado_por_socio_id, pedido_id, guia_id, evento_id)
    values (seguridad.siguiente_folio('G'), negocio.hoy(), 'guia_envio', p_costo_cent, coalesce(v_socio, g.pagada_por_socio_id), g.pedido_id, g.id, p_evento);
  if coalesce(v_socio, g.pagada_por_socio_id) is not null and p_costo_cent > 0 then
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
      values (coalesce(v_socio, g.pagada_por_socio_id), p_costo_cent, 'Guia ' || g.numero, 'reembolsable', negocio.hoy(), 'guia', g.id, p_evento);
  end if;
end $$;

create function operacion.fijar_costo_guia(p_clave_idem text, p_guia bigint, p_costo_cent bigint, p_pagada_por text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'fijar_costo_guia', 'g', p_guia, 'c', p_costo_cent, 'p', p_pagada_por));
  if v_prev is not null then return v_prev; end if;
  if not exists (select 1 from operacion.guia where id = p_guia and sentido = 'salida') then raise exception 'solo las guias de salida se costean aqui' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('guia_costeada', negocio.hoy(), p_clave_idem, jsonb_build_object('guia', p_guia, 'costo_cent', p_costo_cent));
  perform operacion.costear_guia(p_guia, p_costo_cent, p_pagada_por, v_ev);
  v_res := jsonb_build_object('guia_id', p_guia, 'costo_cent', p_costo_cent);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Marcar enviado: surtido pieza por pieza, descuenta inventario, devenga la renta, emite la nota v1 (inmutable) y aplica el saldo a favor del cliente.
-- p_surtido = [{linea_id, piezas, sku_id?}] (default: todo lo pedido). p_guia = {paqueteria, numero, costo_cent?, pagada_por?}.
create function operacion.enviar_pedido(p_clave_idem text, p_pedido bigint, p_surtido jsonb default null, p_guia jsonb default null, p_fecha date default null,
                                        p_aceptar_avisos boolean default false, p_falta_tipo text default 'entrega_diferida') returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
  delete from _surtido_tmp;
  if p_surtido is null then
    insert into _surtido_tmp select id, sku_id, piezas_pedidas from operacion.pedido_linea where pedido_id = ped.id;
  else
    insert into _surtido_tmp
    select (x->>'linea_id')::bigint, coalesce((x->>'sku_id')::bigint, l.sku_id), (x->>'piezas')::int
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
      select a.id, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, (select s2.nombre from catalogo.socio s2 where s2.id = operacion.actor_socio()), v_ev
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
    values (ped.id, ped.folio, 'original', v_texto, v_nota->'cliente', v_nota->'interno', (v_nota->>'total_cent')::bigint, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, v_ev) returning id into v_nota_id;
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
end $$;

-- Anular un pedido enviado: contramovimiento (devuelve piezas, revierte la renta, libera los pagos aplicados). La nota original NO cambia.
create function operacion.anular_pedido(p_clave_idem text, p_pedido bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; m operacion.movimiento_inventario; v_n int := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_pedido', 'p', p_pedido, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: solo uno enviado se anula', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if operacion.origen_es_bodega(ped.origen) then perform operacion.exigir_semana_omar_abierta(ped.fecha_envio); end if;
  v_ev := operacion.crear_evento('pedido_anulado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio), null, ped.evento_envio_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = ped.evento_envio_id and tipo = 'salida_pedido' order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  perform operacion.revertir_renta_pedido(ped.id, v_ev);
  insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id, reversa_de)
    select a.pago_id, a.pedido_id, -a.monto_cent, v_ev, a.id from operacion.pago_aplicacion a where a.pedido_id = ped.id and a.reversa_de is null
      and not exists (select 1 from operacion.pago_aplicacion r where r.reversa_de = a.id);
  update operacion.pedido set estado = 'anulado', nota = coalesce(nota || ' | ', '') || 'Anulado: ' || p_motivo where id = ped.id;
  perform operacion.avisar('nota_corregida_o_anulada', 'NT-008', 'nota_anulada:' || ped.id, 'I', 'Pedido ' || ped.folio || ' anulado despues de enviar', 'pedido', ped.id,
    jsonb_build_object('folio', ped.folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('pedido_id', ped.id, 'estado', 'anulado', 'movimientos_revertidos', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Correccion enlazada: P-0123-C1, -C2... La nota original jamas cambia. Solo se corrigen importes (precios, envio, descuento, recargo).
create function operacion.emitir_correccion(p_clave_idem text, p_pedido bigint, p_motivo text, p_precios jsonb default null, p_envio_cent bigint default null,
                                            p_descuento_cent bigint default null, p_recargo_cent bigint default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; ped operacion.pedido; ult operacion.nota; v_aj jsonb; v_precios jsonb; v_nota jsonb; v_ev bigint; v_id bigint; v_n int; v_texto text; v_folio text; v_res jsonb; k text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'emitir_correccion', 'p', p_pedido, 'm', p_motivo, 'pr', p_precios, 'e', p_envio_cent, 'd', p_descuento_cent, 'r', p_recargo_cent));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la correccion exige motivo' using errcode = '23502'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found or ped.estado <> 'enviado' then raise exception 'solo un pedido enviado tiene nota que corregir' using errcode = 'P0428'; end if;
  select * into ult from operacion.nota where pedido_id = ped.id order by id desc limit 1;
  v_precios := coalesce(ult.ajustes->'precios', '{}'::jsonb) || coalesce(p_precios, '{}'::jsonb);
  for k in select jsonb_object_keys(v_precios) loop
    if not exists (select 1 from operacion.pedido_linea where id = k::bigint and pedido_id = ped.id) then raise exception 'el renglon % no es de este pedido', k using errcode = '22023'; end if;
    if (v_precios->>k)::bigint <= 0 then raise exception 'precio invalido' using errcode = '23514'; end if;
  end loop;
  v_aj := jsonb_build_object('precios', v_precios,
    'envio_cent', coalesce(p_envio_cent, (ult.ajustes->>'envio_cent')::bigint, ped.envio_cent),
    'descuento_cent', coalesce(p_descuento_cent, (ult.ajustes->>'descuento_cent')::bigint, ped.descuento_cent),
    'recargo_cent', coalesce(p_recargo_cent, (ult.ajustes->>'recargo_cent')::bigint, ped.recargo_cent));
  v_nota := operacion.armar_nota(ped.id, v_aj);
  select count(*) + 1 into v_n from operacion.nota where pedido_id = ped.id and tipo = 'correccion';
  v_folio := ped.folio || '-C' || v_n;
  v_texto := operacion.texto_nota(v_nota->'cliente');
  v_ev := operacion.crear_evento('nota_correccion', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'folio_documento', v_folio));
  insert into operacion.nota (pedido_id, folio_documento, tipo, corrige_nota_id, motivo_correccion, texto_whatsapp, snapshot_cliente, snapshot_interno, ajustes, total_cent, emitida_por, evento_id)
    values (ped.id, v_folio, 'correccion', ult.id, p_motivo, v_texto, v_nota->'cliente', v_nota->'interno', v_aj, (v_nota->>'total_cent')::bigint, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, v_ev) returning id into v_id;
  insert into operacion.nota_documento (nota_id, variante, sha256, contenido) values (v_id, 'cliente_texto', encode(sha256(convert_to(v_texto, 'UTF8')), 'hex'), convert_to(v_texto, 'UTF8'));
  perform operacion.avisar('nota_corregida_o_anulada', 'NT-008', 'nota_corregida:' || v_id, 'I', 'Nota ' || ult.folio_documento || ' corregida por ' || v_folio, 'pedido', ped.id,
    jsonb_build_object('folio', ped.folio, 'documento', v_folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('nota_id', v_id, 'folio_documento', v_folio, 'total_cent', (v_nota->>'total_cent')::bigint, 'total_anterior_cent', ult.total_cent, 'saldo_pedido_cent', operacion.pedido_saldo(ped.id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Plazo acordado del pedido (para vencimientos de la cuenta por cobrar).
create function operacion.acordar_plazo(p_clave_idem text, p_pedido bigint, p_dias int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_res jsonb; ped operacion.pedido;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'acordar_plazo', 'p', p_pedido, 'd', p_dias));
  if v_prev is not null then return v_prev; end if;
  if p_dias is null or p_dias < 0 or p_dias > 365 then raise exception 'plazo invalido' using errcode = '23514'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('plazo_acordado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'dias', p_dias));
  update operacion.pedido set plazo_dias = p_dias where id = ped.id;
  v_res := jsonb_build_object('pedido_id', ped.id, 'plazo_dias', p_dias);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.marcar_entregado(p_clave_idem text, p_pedido bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; v_res jsonb; ped operacion.pedido;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'marcar_entregado', 'p', p_pedido));
  if v_prev is not null then return v_prev; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found or ped.estado <> 'enviado' then raise exception 'solo un pedido enviado se entrega' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('pedido_entregado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio));
  update operacion.pedido set entregado_at = coalesce(entregado_at, now()) where id = ped.id;
  v_res := jsonb_build_object('pedido_id', ped.id, 'entregado', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Documentos guardados: el PDF se genera una vez por la aplicacion y se guarda aqui con su huella; reabrir = los mismos bytes.
create function operacion.guardar_documento_nota(p_nota bigint, p_variante text, p_sha256 text, p_contenido bytea) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare d operacion.nota_documento;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_variante not in ('cliente_pdf', 'interna_pdf') then raise exception 'variante invalida' using errcode = '22023'; end if;
  if encode(sha256(p_contenido), 'hex') <> p_sha256 then raise exception 'la huella no corresponde al contenido' using errcode = '23514'; end if;
  insert into operacion.nota_documento (nota_id, variante, sha256, contenido) values (p_nota, p_variante, p_sha256, p_contenido) on conflict (nota_id, variante) do nothing;
  select * into d from operacion.nota_documento where nota_id = p_nota and variante = p_variante;
  return jsonb_build_object('sha256', d.sha256, 'creado_nuevo', d.sha256 = p_sha256, 'bytes', length(d.contenido));
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
