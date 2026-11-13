-- Dropshipping / 0100: funciones de escritura (operacion.ds_*), armado de la orden para el proveedor y lecturas para socios (api.ds_*).
-- ADITIVA. Reutiliza operacion.crear_pedido, registrar_pago_proveedor_sociedad, pago_proveedor_de_socio (reembolso por omision) y registrar_pago.
-- Ninguna funcion de este archivo escribe a Karen ni a clientes: la orden se entrega como TEXTO para que el socio la copie y la envie el mismo.
-- El destinatario solo lo toca rol socio (web); el canal de Telegram o de importacion no puede crearlo, leerlo ni revelarlo.

-- ---------------------------------------------------------------------------
-- Texto de la orden (puro, sin E/S): grupos = [{marca, modelo, piezas, sabores:[{sabor, piezas}]}], dest = objeto normalizado o null.
-- No incluye precios al cliente ni costos: Karen solo necesita que surtir y a quien.
-- ---------------------------------------------------------------------------
create function operacion.texto_orden_proveedor(p_folio text, p_grupos jsonb, p_dest jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare v text; g jsonb; s jsonb; v_total int := 0;
begin
  v := 'Pedido ' || p_folio || E'\n';
  for g in select * from jsonb_array_elements(p_grupos) loop
    v := v || E'\n' || (g->>'marca') || ' ' || (g->>'modelo') || ' (' || (g->>'piezas') || ' pzas)' || E'\n';
    for s in select * from jsonb_array_elements(g->'sabores') loop
      v := v || '- ' || (s->>'sabor') || ' x ' || (s->>'piezas') || E'\n';
    end loop;
    v_total := v_total + (g->>'piezas')::int;
  end loop;
  v := v || E'\nTotal: ' || v_total || ' pzas';
  if p_dest is not null then
    v := v || E'\n\nEntregar a:\n' || (p_dest->>'nombre') || E'\n' || (p_dest->>'calle_numero')
             || case when coalesce(p_dest->>'colonia', '') <> '' then ', ' || (p_dest->>'colonia') else '' end || ', CP ' || (p_dest->>'cp')
             || E'\n' || (p_dest->>'municipio') || ', ' || (p_dest->>'estado');
    if coalesce(p_dest->>'telefono', '') <> '' then v := v || E'\nTel: ' || (p_dest->>'telefono'); end if;
    if coalesce(p_dest->>'correo', '') <> '' then v := v || E'\nCorreo: ' || (p_dest->>'correo'); end if;
    if coalesce(p_dest->>'referencias', '') <> '' then v := v || E'\nReferencias: ' || (p_dest->>'referencias'); end if;
  end if;
  return v;
end $$;

-- Grupos por marca y modelo de un pedido (sabores con sus piezas pedidas).
create function operacion.ds_grupos_pedido(p_pedido bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('marca', q.marca, 'modelo', q.modelo, 'piezas', q.piezas, 'sabores', q.sabores) order by q.marca, q.modelo), '[]'::jsonb)
  from (
    select ma.nombre as marca, m.nombre_canonico as modelo, sum(l.piezas_pedidas)::int as piezas,
           jsonb_agg(jsonb_build_object('sabor', sa.nombre_canonico, 'piezas', l.piezas_pedidas) order by sa.nombre_canonico) as sabores
    from operacion.pedido_linea l
    join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
    where l.pedido_id = p_pedido group by ma.nombre, m.nombre_canonico) q
$$;

-- Posicion completa con un proveedor: lo registrado en su cuenta (pagos, ajustes, compras) menos el costo de los pedidos directos enviados que aun no se descuenta ahi.
-- Positivo = saldo a favor de la sociedad; negativo = se le debe al proveedor. (operacion.saldo_proveedor solo cubre la cuenta corriente; el costo de los directos vive en el libro.)
create function operacion.ds_posicion_proveedor(p_proveedor bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select operacion.saldo_proveedor(p_proveedor) - contabilidad.directos_proveedor((select nombre from catalogo.proveedor where id = p_proveedor)) $$;

-- ---------------------------------------------------------------------------
-- Crear pedido de dropshipping (borrador). Calcula el credito en SQL; el interes se guarda como recargo por credito del pedido.
-- p_credito: {"tasa_semanal_bp": 1000, "semanas": 1, "fecha_pago": "AAAA-MM-DD", "modo": "simple", "interes_cent": monto pactado fijo}; sin llaves usa 10 % de UNA semana, interes simple, sobre el
-- total de la mercancia (menos descuento; sin envio). Con interes_cent el monto pactado manda. Sin p_credito: contado.
-- p_destinatario: opcional aqui (el bot no lo captura); se puede capturar despues con ds_capturar_destinatario.
-- ---------------------------------------------------------------------------
create function operacion.ds_crear_pedido(p_clave_idem text, p_cliente_id bigint, p_lineas jsonb, p_origen text default 'karen_directo', p_destinatario jsonb default null,
                                          p_credito jsonb default null, p_tipo_venta text default 'cliente', p_socio text default null, p_folio_externo text default null,
                                          p_envio_cent bigint default 0, p_descuento_cent bigint default 0, p_fecha date default null, p_nota text default null,
                                          p_mensaje_origen text default null, p_fecha_compromiso date default null, p_hora_compromiso time default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_socio bigint; v_prov bigint; v_lineas jsonb := '[]'::jsonb; l jsonb; r jsonb; v_precio bigint; v_costo bigint; v_base bigint := 0;
  v_tasa int; v_sem int; v_modo text; v_fp date; v_interes bigint := 0; v_res jsonb; v_ped bigint; v_folio text; v_ev bigint; v_dest jsonb; v_costo_est bigint := 0; v_venta_est bigint;
  v_piezas int := 0; v_nom text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_destinatario is not null then perform seguridad.exigir_rol(array['socio']); end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_crear_pedido', 'c', p_cliente_id, 'l', p_lineas, 'o', p_origen, 'd', p_destinatario, 'cr', p_credito, 't', p_tipo_venta,
                                         's', p_socio, 'fe', p_folio_externo, 'e', p_envio_cent, 'de', p_descuento_cent, 'f', p_fecha, 'n', p_nota, 'mo', p_mensaje_origen, 'fc', p_fecha_compromiso, 'hc', p_hora_compromiso));
  if v_prev is not null then return v_prev; end if;
  if p_hora_compromiso is not null and p_fecha_compromiso is null then raise exception 'la hora del compromiso exige una fecha' using errcode = '23514'; end if;
  if p_fecha_compromiso is not null and p_fecha_compromiso < negocio.hoy() - 1 then raise exception 'la fecha comprometida no puede ser pasada' using errcode = '23514'; end if;
  if p_origen not in ('karen_directo', 'karen_via_isaac', 'isaac_directo') then raise exception 'el dropshipping solo admite origen karen_directo, karen_via_isaac o isaac_directo' using errcode = '22023'; end if;
  if p_tipo_venta not in ('cliente', 'socio_a_costo') then raise exception 'tipo de venta invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'el pedido necesita renglones' using errcode = '22023'; end if;
  v_prov := catalogo.proveedor_id(case when p_origen = 'isaac_directo' then 'Isaac' else 'Karen' end);
  if p_tipo_venta = 'socio_a_costo' then
    select id into v_socio from catalogo.socio where nombre = p_socio;
    if v_socio is null then raise exception 'la venta de un socio a costo exige indicar el socio' using errcode = '22023'; end if;
    -- Solo el socio de menudeo (por omision Angelo) mete pedidos a costo; el otro socio los supervisa. Desde Telegram el agente verifica el autor antes de llamar.
    if v_socio <> operacion.ds_socio_menudeo() or (operacion.actor_socio() is not null and operacion.actor_socio() <> v_socio) then
      raise exception 'solo el socio de menudeo (%) mete pedidos a costo', (select nombre from catalogo.socio where id = operacion.ds_socio_menudeo()) using errcode = '42501';
    end if;
    -- Pedido a costo para un socio: ingreso = costo, utilidad 0. Sin envio cobrado, descuento ni credito (cualquiera de ellos crearia utilidad o cuenta por cobrar por interes).
    if coalesce(p_envio_cent, 0) <> 0 or coalesce(p_descuento_cent, 0) <> 0 or p_credito is not null then
      raise exception 'el pedido a costo para un socio no lleva envio cobrado, descuento ni credito: no genera utilidad' using errcode = '22023';
    end if;
  elsif p_socio is not null then raise exception 'el socio solo aplica a la venta a costo' using errcode = '22023';
  end if;
  if nullif(btrim(p_folio_externo), '') is not null and exists (select 1 from operacion.pedido_ds d where d.proveedor_id = v_prov and d.folio_externo_norm = regexp_replace(lower(btrim(p_folio_externo)), '\s+', '', 'g')) then
    raise exception 'ese folio del proveedor ya esta registrado en otro pedido' using errcode = '23505';
  end if;
  v_dest := case when p_destinatario is null then null else entrega.normalizar(p_destinatario) end;

  -- Precio y costo por renglon (antes de crear el pedido, para fijar el credito y avisar de modelos sin costo del proveedor).
  for l in select * from jsonb_array_elements(p_lineas) loop
    r := operacion.resolver_sku(l);
    if coalesce((l->>'piezas')::int, 0) <= 0 then raise exception 'cada renglon necesita piezas positivas' using errcode = '23514'; end if;
    v_costo := operacion.costo_ref_pedido(p_origen, (r->>'modelo_id')::bigint, v_fecha);
    select nombre_canonico into v_nom from catalogo.modelo where id = (r->>'modelo_id')::bigint;
    if v_costo is null then raise exception '% no tiene costo vigente del proveedor: no se puede surtir por dropshipping', v_nom using errcode = '23502'; end if;
    v_precio := case when p_tipo_venta = 'socio_a_costo' then v_costo else coalesce((l->>'precio_cent')::bigint, catalogo.precio_vigente(p_cliente_id, (r->>'modelo_id')::bigint, v_fecha)) end;
    if v_precio is null then raise exception '% no tiene precio para este cliente: indica el precio', v_nom using errcode = '23502'; end if;
    v_lineas := v_lineas || jsonb_build_array((l - 'precio_cent') || jsonb_build_object('precio_cent', v_precio, 'sku_id', (r->>'sku_id')::bigint));
    v_base := v_base + v_precio * (l->>'piezas')::bigint; v_costo_est := v_costo_est + v_costo * (l->>'piezas')::bigint; v_piezas := v_piezas + (l->>'piezas')::int;
  end loop;
  v_base := greatest(v_base - coalesce(p_descuento_cent, 0), 0);

  if p_credito is not null then
    v_tasa := coalesce((p_credito->>'tasa_semanal_bp')::int, (catalogo.config_valor('recargo_credito_bp', v_fecha))::text::int, 1000);
    v_modo := coalesce(nullif(p_credito->>'modo', ''), 'simple');
    if nullif(p_credito->>'fecha_pago', '') is not null then
      v_fp := (p_credito->>'fecha_pago')::date;
      if v_fp < v_fecha then raise exception 'la fecha de pago no puede ser anterior a la venta' using errcode = '23514'; end if;
      v_sem := coalesce((p_credito->>'semanas')::int, greatest(ceil((v_fp - v_fecha)::numeric / 7)::int, 1));
    else
      v_sem := coalesce((p_credito->>'semanas')::int, 1);
      v_fp := v_fecha + v_sem * 7;
    end if;
    if nullif(p_credito->>'interes_cent', '') is not null then
      -- Monto pactado fijo para esta venta (el dueno lo captura cuando difiere del porcentaje semanal).
      v_interes := (p_credito->>'interes_cent')::bigint; v_modo := 'fijo'; v_tasa := 0;
      if v_interes < 0 then raise exception 'el interes pactado no puede ser negativo' using errcode = '23514'; end if;
    else
      v_interes := operacion.interes_credito(v_base, v_tasa, v_sem, v_modo);
    end if;
  end if;

  v_res := operacion.crear_pedido(p_clave_idem || ':ped', p_cliente_id, v_lineas, p_origen, null, coalesce(p_envio_cent, 0), coalesce(p_descuento_cent, 0), v_interes, v_fecha, null,
                                  case when p_credito is not null then (v_fp - v_fecha) end, null, p_nota, p_mensaje_origen);
  v_ped := (v_res->>'pedido_id')::bigint; v_folio := v_res->>'folio';
  v_ev := operacion.crear_evento('pedido_ds_creado', v_fecha, p_clave_idem || ':ds', jsonb_build_object('pedido', v_folio, 'origen', p_origen, 'tipo_venta', p_tipo_venta, 'credito', p_credito is not null), p_mensaje_origen);
  insert into operacion.pedido_ds (pedido_id, proveedor_id, tipo_venta, socio_id, folio_externo, folio_externo_at, evento_id)
    values (v_ped, v_prov, p_tipo_venta, v_socio, nullif(btrim(p_folio_externo), ''), case when nullif(btrim(p_folio_externo), '') is not null then now() end, v_ev);
  if p_tipo_venta = 'socio_a_costo' then
    -- Fecha comprometida de pago (puede quedar vacia: se muestra "sin fecha comprometida" como alerta).
    insert into operacion.ds_pedido_compromiso (pedido_id, fecha_compromiso, hora_compromiso, comprometido_por, tipo, canal, evento_id)
      values (v_ped, p_fecha_compromiso, p_hora_compromiso, coalesce(operacion.actor_socio(), v_socio), 'inicial', seguridad.canal_actual(), v_ev);
  end if;
  if p_credito is not null then
    insert into operacion.pedido_credito (pedido_id, tasa_semanal_bp, semanas, fecha_pago_pactada, modo, base_cent, interes_cent, evento_id) values (v_ped, v_tasa, v_sem, v_fp, v_modo, v_base, v_interes, v_ev);
  end if;
  if v_dest is not null then
    perform entrega.guardar(v_ped, v_dest);
  end if;
  v_venta_est := v_base + coalesce(p_envio_cent, 0) + v_interes;
  v_res := v_res || jsonb_build_object('origen', p_origen, 'origen_surtido', 'dropshipping', 'tipo_venta', p_tipo_venta, 'costo_estimado_cent', v_costo_est, 'venta_estimada_cent', v_venta_est,
                    'margen_estimado_cent', v_base - v_costo_est, 'interes_cent', v_interes, 'total_credito_cent', case when p_credito is not null then v_venta_est end,
                    'fecha_pago_pactada', v_fp, 'tiene_destinatario', v_dest is not null, 'folio_externo', nullif(btrim(p_folio_externo), ''));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Captura o corrige el destinatario (solo web, rol socio). Nada del destinatario entra a eventos ni a resultados guardados.
create function operacion.ds_capturar_destinatario(p_clave_idem text, p_pedido bigint, p_destinatario jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_d jsonb; v_res jsonb; v_ev bigint; pe operacion.pedido;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_capturar_destinatario', 'p', p_pedido, 'd', p_destinatario));
  if v_prev is not null then return v_prev; end if;
  select * into pe from operacion.pedido where id = p_pedido for update;
  if not found or not exists (select 1 from operacion.pedido_ds where pedido_id = p_pedido) then raise exception 'pedido de dropshipping desconocido' using errcode = '22023'; end if;
  if pe.estado in ('cancelado', 'anulado') then raise exception 'el pedido ya no esta vigente' using errcode = 'P0428'; end if;
  v_d := entrega.normalizar(p_destinatario);
  perform entrega.guardar(p_pedido, v_d);
  v_ev := operacion.crear_evento('destinatario_capturado', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', pe.folio));
  v_res := jsonb_build_object('pedido_id', p_pedido, 'tiene_destinatario', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Folio externo del proveedor (numero de pedido de Karen, por ejemplo 73266). Unico por proveedor; se puede corregir (queda el evento).
create function operacion.ds_registrar_folio(p_clave_idem text, p_pedido bigint, p_folio_externo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; pd operacion.pedido_ds; pe operacion.pedido; v_ev bigint; v_res jsonb; v_f text := nullif(btrim(p_folio_externo), '');
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_registrar_folio', 'p', p_pedido, 'f', p_folio_externo));
  if v_prev is not null then return v_prev; end if;
  if v_f is null then raise exception 'el folio del proveedor no puede ir vacio' using errcode = '23502'; end if;
  select * into pd from operacion.pedido_ds where pedido_id = p_pedido for update;
  select * into pe from operacion.pedido where id = p_pedido;
  if not found then raise exception 'pedido de dropshipping desconocido' using errcode = '22023'; end if;
  if pe.estado in ('cancelado', 'anulado') then raise exception 'el pedido ya no esta vigente' using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.pedido_ds d where d.proveedor_id = pd.proveedor_id and d.pedido_id <> p_pedido and d.folio_externo_norm = regexp_replace(lower(v_f), '\s+', '', 'g')) then
    raise exception 'ese folio del proveedor ya esta registrado en otro pedido' using errcode = '23505';
  end if;
  v_ev := operacion.crear_evento('folio_externo_registrado', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', pe.folio, 'folio_externo', v_f, 'anterior', pd.folio_externo));
  update operacion.pedido_ds set folio_externo = v_f, folio_externo_at = now() where pedido_id = p_pedido;
  v_res := jsonb_build_object('pedido_id', p_pedido, 'folio', pe.folio, 'folio_externo', v_f);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Pago al proveedor (amortizacion por pedido opcional). Fuentes:
--   sociedad            : con dinero de la sociedad (su caja o cuenta).
--   socio_fondos        : un socio paga con fondos de la sociedad que tiene en su poder.
--   socio_propio        : un socio paga con su dinero; es REEMBOLSO (cuenta por pagar al socio) por omision.
--   socio_capital       : igual, pero el socio DECLARA que es capital (inversion).
--   cliente_a_proveedor : el cliente pago directo a la cuenta del proveedor (baja el saldo del cliente y el del proveedor).
create function operacion.ds_pagar_proveedor(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_fuente text, p_socio text default null, p_cliente_id bigint default null,
                                             p_pedido bigint default null, p_fecha date default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_prov bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_r jsonb; v_mov bigint; v_ev bigint; pd operacion.pedido_ds; pe operacion.pedido; v_amort bigint := 0; v_tope bigint;
  v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_pagar_proveedor', 'pr', p_proveedor, 'm', p_monto_cent, 'fu', p_fuente, 's', p_socio, 'c', p_cliente_id, 'p', p_pedido, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  if p_fuente not in ('sociedad', 'socio_fondos', 'socio_propio', 'socio_capital', 'cliente_a_proveedor') then raise exception 'fuente de pago invalida' using errcode = '22023'; end if;
  if p_pedido is not null then
    select * into pd from operacion.pedido_ds where pedido_id = p_pedido;
    if not found or pd.proveedor_id <> v_prov then raise exception 'el pedido no es de dropshipping con ese proveedor' using errcode = '22023'; end if;
    select * into pe from operacion.pedido where id = p_pedido;
    if pe.estado in ('cancelado', 'anulado') then raise exception 'el pedido ya no esta vigente' using errcode = 'P0428'; end if;
  end if;
  -- Un pedido a costo para un socio lo paga el socio como cliente (directo al proveedor o a la sociedad): pagarlo "con su dinero" como aportacion crearia un reembolso a su favor por su propia compra.
  if p_pedido is not null and pd.tipo_venta = 'socio_a_costo' and p_fuente in ('socio_propio', 'socio_capital', 'socio_fondos') then
    raise exception 'un pedido a costo para un socio se paga como cliente: usa el pago directo al proveedor o el abono a la sociedad' using errcode = '22023';
  end if;
  if p_fuente = 'sociedad' then
    v_r := operacion.registrar_pago_proveedor_sociedad(p_clave_idem || ':p', p_proveedor, p_monto_cent, v_fecha, p_nota);
    v_mov := (v_r->>'movimiento_id')::bigint;
  elsif p_fuente in ('socio_fondos', 'socio_propio', 'socio_capital') then
    if p_socio is null then raise exception 'indica que socio paga' using errcode = '23502'; end if;
    v_r := operacion.pago_proveedor_de_socio(p_clave_idem || ':p', p_proveedor, p_monto_cent, p_socio, case p_fuente when 'socio_fondos' then 'fondos_sociedad' else 'dinero_propio' end, v_fecha, p_nota, null, p_fuente = 'socio_capital');
    select id into v_mov from operacion.cuenta_proveedor_mov where proveedor_id = v_prov and concepto = 'pago_socio' order by id desc limit 1;
  else
    if p_cliente_id is null then raise exception 'indica el cliente que pago al proveedor' using errcode = '23502'; end if;
    -- Con pedido indicado el pago se aplica a ESE pedido (no por orden de antiguedad a otros del mismo cliente).
    v_r := operacion.registrar_pago(p_clave_idem || ':p', p_proveedor, p_monto_cent, p_cliente_id, case when p_pedido is not null then jsonb_build_array(jsonb_build_object('pedido_id', p_pedido, 'monto_cent', p_monto_cent)) end, true, 'abono', v_fecha, null, p_nota);
    select m.id into v_mov from operacion.cuenta_proveedor_mov m where m.pago_id = (v_r->>'pago_id')::bigint and m.concepto = 'pago_cliente_redirigido';
  end if;
  if p_pedido is not null and v_mov is not null then
    v_tope := case when pe.estado = 'enviado' then greatest((select (v.costo_cent - v.seguro_cent - v.amortizado_cent) from operacion.v_ds_pedido v where v.pedido_id = p_pedido), 0) else p_monto_cent end;
    v_amort := least(p_monto_cent, v_tope);
    if v_amort > 0 then
      v_ev := operacion.crear_evento('ds_amortizacion', v_fecha, p_clave_idem || ':am', jsonb_build_object('pedido', pe.folio, 'monto_cent', v_amort, 'fuente', p_fuente));
      insert into operacion.ds_amortizacion (movimiento_id, pedido_id, monto_cent, evento_id) values (v_mov, p_pedido, v_amort, v_ev);
    end if;
  end if;
  v_res := jsonb_build_object('proveedor', p_proveedor, 'monto_cent', p_monto_cent, 'fuente', p_fuente, 'movimiento_id', v_mov, 'amortizado_cent', v_amort, 'a_cuenta_cent', p_monto_cent - v_amort,
                              'saldo_proveedor_cent', operacion.ds_posicion_proveedor(v_prov));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Piezas movidas a los proveedores (dropshipping enviado): total, de clientes y a costo para socios; por proveedor, por socio y por mes. Un pedido a costo para un socio cuenta aqui
-- aunque no genere utilidad: sirve para saber cuantas piezas se mueven en total con cada proveedor.
create function operacion.ds_piezas_movidas(p_desde date, p_hasta date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  with b as (
    select v.*, (select s.nombre from catalogo.socio s where s.id = v.socio_venta_id) as socio_venta
    from operacion.v_ds_pedido v where v.origen_surtido = 'dropshipping' and v.estado = 'enviado' and (p_desde is null or v.fecha_envio >= p_desde) and (p_hasta is null or v.fecha_envio <= p_hasta))
  select jsonb_build_object(
    'total', coalesce((select sum(piezas_surtidas) from b), 0), 'de_clientes', coalesce((select sum(piezas_surtidas) from b where tipo_venta = 'cliente'), 0),
    'a_costo_socios', coalesce((select sum(piezas_surtidas) from b where tipo_venta = 'socio_a_costo'), 0),
    'en_curso', coalesce((select sum(v.piezas_pedidas) from operacion.v_ds_pedido v where v.origen_surtido = 'dropshipping' and v.estado in ('borrador', 'confirmado')), 0),
    'por_proveedor', coalesce((select jsonb_agg(jsonb_build_object('proveedor', q.proveedor, 'piezas', q.pz, 'de_clientes', q.cl, 'a_costo_socios', q.ac, 'pedidos', q.n) order by q.proveedor)
                               from (select proveedor, sum(piezas_surtidas) pz, sum(piezas_surtidas) filter (where tipo_venta = 'cliente') cl, sum(piezas_surtidas) filter (where tipo_venta = 'socio_a_costo') ac, count(*) n from b group by proveedor) q), '[]'::jsonb),
    'por_socio', coalesce((select jsonb_agg(jsonb_build_object('socio', q.socio_venta, 'piezas', q.pz, 'pedidos', q.n, 'costo_cent', q.costo) order by q.socio_venta)
                           from (select socio_venta, sum(piezas_surtidas) pz, count(*) n, sum(venta_cent) costo from b where tipo_venta = 'socio_a_costo' group by socio_venta) q), '[]'::jsonb),
    'por_mes', coalesce((select jsonb_agg(jsonb_build_object('mes', q.mes, 'piezas', q.pz, 'a_costo_socios', q.ac) order by q.mes)
                         from (select to_char(fecha_envio, 'YYYY-MM') mes, sum(piezas_surtidas) pz, coalesce(sum(piezas_surtidas) filter (where tipo_venta = 'socio_a_costo'), 0) ac from b group by 1) q), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Lecturas (rol socio)
-- ---------------------------------------------------------------------------
create function api.ds_interes(p_base_cent bigint, p_tasa_bp int, p_semanas int, p_modo text default 'simple') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  v := operacion.interes_credito(p_base_cent, p_tasa_bp, p_semanas, p_modo);
  return jsonb_build_object('interes_cent', v, 'total_cent', p_base_cent + v, 'modo', p_modo);
end $$;

create function api.ds_catalogo(p_cliente_id bigint, p_origen text default 'karen_directo') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_origen not in ('karen_directo', 'karen_via_isaac', 'isaac_directo') then raise exception 'origen invalido' using errcode = '22023'; end if;
  return jsonb_build_object(
    'interes_defecto_bp', coalesce((catalogo.config_valor('recargo_credito_bp'))::text::int, 1000),
    'envio_default_cent', (catalogo.config_valor('envio_default_cent'))::text::bigint,
    'skus', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'modelo_id', m.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'estado', m.estado,
        'precio_cent', catalogo.precio_vigente(p_cliente_id, m.id), 'costo_cent', operacion.costo_ref_pedido(p_origen, m.id, negocio.hoy())) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
      from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id where k.activo), '[]'::jsonb));
end $$;

-- Fila de lista (sin ningun dato del destinatario).
create function operacion.ds_fila(v operacion.v_ds_pedido) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  return jsonb_build_object('pedido_id', v.pedido_id, 'folio', v.folio, 'fecha_neg', v.fecha_neg, 'fecha_envio', v.fecha_envio, 'estado', v.estado, 'origen', v.origen, 'origen_surtido', v.origen_surtido,
    'proveedor', v.proveedor, 'folio_externo', v.folio_externo, 'tipo_venta', v.tipo_venta, 'cliente_id', v.cliente_id, 'cliente', v.cliente, 'piezas_pedidas', v.piezas_pedidas, 'piezas_surtidas', v.piezas_surtidas,
    'real', v.real, 'venta_cent', v.venta_cent, 'costo_cent', v.costo_cent, 'seguro_cent', v.seguro_cent, 'costo_total_cent', v.costo_total_cent, 'guia_cent', v.guia_cent,
    'margen_producto_cent', v.venta_cent - v.costo_cent - v.seguro_cent, 'margen_cent', v.utilidad_total_cent, 'utilidad_cent', v.utilidad_total_cent, 'utilidad_provisional', v.utilidad_provisional,
    'saldo_cliente_cent', v.saldo_cliente_cent, 'interes_cent', v.interes_cent, 'tasa_semanal_bp', v.tasa_semanal_bp, 'semanas', v.semanas, 'fecha_pago_pactada', v.fecha_pago_pactada, 'modo_interes', v.modo_interes,
    'amortizado_cent', v.amortizado_cent, 'por_pagar_cent', case when v.origen_surtido = 'dropshipping' and v.estado = 'enviado' then greatest(v.costo_cent - v.seguro_cent - v.amortizado_cent, 0) else 0 end,
    'avisos', v.avisos, 'tiene_destinatario', v.tiene_destinatario, 'diferencia_catalogo_cent', operacion.ds_diferencia_pedido(v.pedido_id));
end $$;

create function api.ds_pedidos(p_origen_surtido text default null, p_proveedor text default null, p_estado text default null, p_cliente_id bigint default null, p_desde date default null,
                               p_hasta date default null, p_busqueda text default null, p_tipo_venta text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_b text := nullif(btrim(p_busqueda), '');
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_origen_surtido is not null and p_origen_surtido not in ('dropshipping', 'inventario_merida') then raise exception 'origen de surtido invalido' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(operacion.ds_fila(v) order by v.pedido_id desc) from (
    select * from operacion.v_ds_pedido v
    where (p_origen_surtido is null or v.origen_surtido = p_origen_surtido)
      and (p_proveedor is null or v.proveedor = p_proveedor)
      and (p_estado is null or v.estado = p_estado)
      and (p_tipo_venta is null or v.tipo_venta = p_tipo_venta)
      and (p_cliente_id is null or v.cliente_id = p_cliente_id)
      and (p_desde is null or v.fecha_neg >= p_desde) and (p_hasta is null or v.fecha_neg <= p_hasta)
      and (v_b is null or v.folio ilike '%' || v_b || '%' or coalesce(v.folio_externo, '') ilike '%' || v_b || '%' or catalogo.normalizar(v.cliente) like '%' || catalogo.normalizar(v_b) || '%')
    order by v.pedido_id desc limit 500) v), '[]'::jsonb);
end $$;

-- Desglose por dimension. Solo cuenta lo ENVIADO (la venta real); lo demas se ve en el resumen como "en curso".
-- p_dim: origen | semana | mes | cliente | marca | modelo | sabor.
create function api.ds_desglose(p_dim text, p_desde date default null, p_hasta date default null, p_origen_surtido text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_dim not in ('origen', 'semana', 'mes', 'cliente', 'marca', 'modelo', 'sabor') then raise exception 'dimension invalida' using errcode = '22023'; end if;
  if p_origen_surtido is not null and p_origen_surtido not in ('dropshipping', 'inventario_merida') then raise exception 'origen de surtido invalido' using errcode = '22023'; end if;
  if p_dim in ('origen', 'semana', 'mes', 'cliente') then
    return coalesce((select jsonb_agg(jsonb_build_object('clave', q.clave, 'etiqueta', q.etiqueta, 'pedidos', q.pedidos, 'piezas', q.piezas, 'venta_cent', q.venta, 'costo_cent', q.costo,
                      'margen_cent', q.venta - q.costo, 'por_cobrar_cent', q.cobrar, 'por_pagar_cent', q.pagar, 'intereses_cent', q.interes) order by q.orden, q.clave)
      from (
        select case p_dim when 'origen' then v.origen_surtido when 'semana' then to_char(date_trunc('week', v.fecha_envio), 'YYYY-MM-DD') when 'mes' then to_char(v.fecha_envio, 'YYYY-MM') else v.cliente_id::text end as clave,
               min(case p_dim when 'origen' then v.origen_surtido when 'semana' then to_char(date_trunc('week', v.fecha_envio), 'YYYY-MM-DD') when 'mes' then to_char(v.fecha_envio, 'YYYY-MM') else v.cliente end) as etiqueta,
               case p_dim when 'cliente' then -sum(v.venta_cent) else 0 end as orden,
               count(*)::int as pedidos, sum(v.piezas_surtidas)::int as piezas, sum(v.venta_cent)::bigint as venta, sum(v.costo_total_cent)::bigint as costo,
               coalesce(sum(greatest(v.saldo_cliente_cent, 0)), 0)::bigint as cobrar,
               coalesce(sum(case when v.origen_surtido = 'dropshipping' then greatest(v.costo_cent - v.seguro_cent - v.amortizado_cent, 0) else 0 end), 0)::bigint as pagar,
               coalesce(sum(v.interes_cent), 0)::bigint as interes
        from operacion.v_ds_pedido v
        where v.estado = 'enviado' and (p_desde is null or v.fecha_envio >= p_desde) and (p_hasta is null or v.fecha_envio <= p_hasta) and (p_origen_surtido is null or v.origen_surtido = p_origen_surtido)
        group by 1) q), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('clave', q.clave, 'etiqueta', q.clave, 'pedidos', q.pedidos, 'piezas', q.piezas, 'venta_cent', q.venta, 'costo_cent', q.costo, 'margen_cent', q.venta - q.costo) order by q.venta desc, q.clave)
    from (
      select case p_dim when 'marca' then s.marca when 'modelo' then s.marca || ' ' || s.modelo else s.sabor end as clave, count(distinct s.pedido_id)::int as pedidos, sum(s.piezas)::int as piezas,
             sum(s.venta_cent)::bigint as venta, sum(s.costo_cent)::bigint as costo
      from operacion.v_ds_surtido s
      where (p_desde is null or s.fecha_envio >= p_desde) and (p_hasta is null or s.fecha_envio <= p_hasta) and (p_origen_surtido is null or s.origen_surtido = p_origen_surtido)
      group by 1) q), '[]'::jsonb);
end $$;

-- Resumen: las dos columnas (siempre presentes, aunque en cero), pedidos en curso y la cuenta de cada proveedor.
create function api.ds_resumen(p_desde date default null, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_por_origen jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select jsonb_agg(jsonb_build_object('origen_surtido', o.k, 'pedidos', coalesce(d.pedidos, 0), 'piezas', coalesce(d.piezas, 0), 'venta_cent', coalesce(d.venta, 0), 'costo_cent', coalesce(d.costo, 0),
           'margen_cent', coalesce(d.venta, 0) - coalesce(d.costo, 0), 'por_cobrar_cent', coalesce(d.cobrar, 0), 'por_pagar_cent', coalesce(d.pagar, 0), 'intereses_cent', coalesce(d.interes, 0)) order by o.ord)
    into v_por_origen
  from (values ('dropshipping', 1), ('inventario_merida', 2)) o (k, ord)
  left join (
    select v.origen_surtido, count(*) as pedidos, sum(v.piezas_surtidas) as piezas, sum(v.venta_cent) as venta, sum(v.costo_total_cent) as costo, sum(greatest(v.saldo_cliente_cent, 0)) as cobrar,
           sum(case when v.origen_surtido = 'dropshipping' then greatest(v.costo_cent - v.seguro_cent - v.amortizado_cent, 0) else 0 end) as pagar, sum(v.interes_cent) as interes
    from operacion.v_ds_pedido v where v.estado = 'enviado' and (p_desde is null or v.fecha_envio >= p_desde) and (p_hasta is null or v.fecha_envio <= p_hasta) group by v.origen_surtido) d on d.origen_surtido = o.k;
  return jsonb_build_object('por_origen', v_por_origen,
    'en_curso', coalesce((select jsonb_agg(jsonb_build_object('origen_surtido', q.origen_surtido, 'pedidos', q.n, 'piezas', q.pz, 'venta_estimada_cent', q.venta, 'costo_estimado_cent', q.costo))
                          from (select v.origen_surtido, count(*) n, sum(v.piezas_pedidas) pz, sum(v.venta_cent) venta, sum(v.costo_cent) costo from operacion.v_ds_pedido v where v.estado in ('borrador', 'confirmado') group by 1) q), '[]'::jsonb),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'saldo_cent', operacion.ds_posicion_proveedor(p.id)) order by p.nombre) from catalogo.proveedor p), '[]'::jsonb),
    'piezas_movidas', operacion.ds_piezas_movidas(p_desde, p_hasta),
    'sin_folio_externo', (select count(*) from operacion.v_ds_pedido v where v.origen_surtido = 'dropshipping' and v.estado in ('confirmado', 'enviado') and v.folio_externo is null));
end $$;

-- Ficha del pedido (sin PII del destinatario; solo si existe y cuantas veces se reveló).
create function api.ds_ficha(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v operacion.v_ds_pedido;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into v from operacion.v_ds_pedido where pedido_id = p_pedido;
  if not found then return null; end if;
  return operacion.ds_fila(v) || jsonb_build_object(
    'es_dropshipping', v.origen_surtido = 'dropshipping', 'es_estimado', not v.real, 'proveedor_id', v.proveedor_id, 'socio_venta', (select s.nombre from catalogo.socio s where s.id = v.socio_venta_id),
    'base_credito_cent', v.base_credito_cent, 'recargo_cent', v.recargo_cent, 'plazo_dias', v.plazo_dias,
    'grupos', operacion.ds_grupos_pedido(p_pedido),
    'amortizaciones', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'monto_cent', a.monto_cent) order by a.id)
                                from operacion.ds_amortizacion a join operacion.cuenta_proveedor_mov m on m.id = a.movimiento_id where a.pedido_id = p_pedido), '[]'::jsonb),
    'revelaciones', (select count(*) from entrega.revelacion r where r.pedido_id = p_pedido));
end $$;

create function api.ds_destinatario(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare d entrega.destinatario;
begin
  perform seguridad.exigir_rol(array['socio']);
  select l.* into d from entrega.leer(p_pedido) l where l.pedido_id is not null;
  if not found then return null; end if;
  return jsonb_build_object('pedido_id', d.pedido_id, 'nombre', d.nombre, 'calle_numero', d.calle_numero, 'colonia', d.colonia, 'cp', d.cp, 'municipio', d.municipio, 'estado', d.estado,
    'telefono_mascara', entrega.mascara_telefono(d.telefono), 'correo_mascara', entrega.mascara_correo(d.correo), 'tiene_telefono', d.telefono <> '', 'tiene_correo', d.correo <> '', 'referencias', d.referencias);
end $$;

-- Boton "Revelar": entrega el telefono o el correo completo y deja el registro (quien, cuando, por que).
create function api.ds_destinatario_revelar(p_pedido bigint, p_campo text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare d entrega.destinatario;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_campo not in ('telefono', 'correo') then raise exception 'campo invalido' using errcode = '22023'; end if;
  select l.* into d from entrega.leer(p_pedido) l where l.pedido_id is not null;
  if not found then raise exception 'el pedido no tiene destinatario' using errcode = 'P0404'; end if;
  insert into entrega.revelacion (pedido_id, accion, actor, motivo) values (p_pedido, p_campo, auth.uid(), nullif(btrim(p_motivo), ''));
  return jsonb_build_object('pedido_id', p_pedido, 'campo', p_campo, 'valor', case p_campo when 'telefono' then d.telefono else d.correo end);
end $$;

-- Orden para el proveedor: texto listo para copiar. Con el bloque completo del destinatario queda registrado (accion 'orden'); la vista previa va enmascarada.
create function api.ds_orden_proveedor(p_pedido bigint, p_completo boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pe operacion.pedido; pd operacion.pedido_ds; d entrega.destinatario; v_dest jsonb; v_grupos jsonb; v_cost bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into pe from operacion.pedido where id = p_pedido;
  select * into pd from operacion.pedido_ds where pedido_id = p_pedido;
  if pe.id is null or pd.pedido_id is null then raise exception 'pedido de dropshipping desconocido' using errcode = '22023'; end if;
  select l.* into d from entrega.leer(p_pedido) l where l.pedido_id is not null;
  v_grupos := operacion.ds_grupos_pedido(p_pedido);
  if found then
    v_dest := jsonb_build_object('nombre', d.nombre, 'calle_numero', d.calle_numero, 'colonia', d.colonia, 'cp', d.cp, 'municipio', d.municipio, 'estado', d.estado,
      'telefono', case when p_completo then d.telefono else entrega.mascara_telefono(d.telefono) end, 'correo', case when p_completo then d.correo else entrega.mascara_correo(d.correo) end, 'referencias', d.referencias);
    if p_completo then insert into entrega.revelacion (pedido_id, accion, actor, motivo) values (p_pedido, 'orden', auth.uid(), 'copiar orden para el proveedor'); end if;
  end if;
  select coalesce(sum(l.piezas_pedidas * operacion.ds_costo_ref_linea(l.id, pe.origen, l.modelo_id, negocio.hoy())), 0)::bigint into v_cost from operacion.pedido_linea l where l.pedido_id = p_pedido;
  return jsonb_build_object('pedido_id', p_pedido, 'folio', pe.folio, 'texto', operacion.texto_orden_proveedor(pe.folio, v_grupos, v_dest), 'grupos', v_grupos,
    'piezas', (select coalesce(sum(piezas_pedidas), 0) from operacion.pedido_linea where pedido_id = p_pedido), 'costo_proveedor_cent', v_cost,
    'incluye_destinatario', v_dest is not null, 'completo', p_completo and v_dest is not null, 'falta_destinatario', v_dest is null);
end $$;

create function api.ds_cuenta_proveedor(p_proveedor text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_prov bigint := catalogo.proveedor_id(p_proveedor); v_saldo bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_prov is null then raise exception 'proveedor desconocido' using errcode = '22023'; end if;
  v_saldo := operacion.ds_posicion_proveedor(v_prov);
  return jsonb_build_object('proveedor', p_proveedor, 'saldo_cent', v_saldo, 'saldo_cuenta_corriente_cent', operacion.saldo_proveedor(v_prov), 'directos_enviados_cent', contabilidad.directos_proveedor(p_proveedor), 'etiqueta', case when v_saldo > 0 then 'A favor' when v_saldo < 0 then 'Se debe' else 'Saldo cero' end,
    'pedidos', coalesce((select jsonb_agg(operacion.ds_fila(v) order by v.pedido_id desc) from operacion.v_ds_pedido v where v.origen_surtido = 'dropshipping' and v.proveedor_id = v_prov and v.estado in ('confirmado', 'enviado')), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'fecha_neg', m.fecha_neg, 'concepto', m.concepto, 'monto_cent', m.monto_cent, 'nota', m.nota,
                         'amortizado', coalesce((select jsonb_agg(jsonb_build_object('folio', pe.folio, 'monto_cent', a.monto_cent)) from operacion.ds_amortizacion a join operacion.pedido pe on pe.id = a.pedido_id where a.movimiento_id = m.id), '[]'::jsonb))
                         order by m.id desc)
                       from operacion.cuenta_proveedor_mov m where m.proveedor_id = v_prov and m.concepto in ('pago_sociedad', 'pago_socio', 'pago_cliente_redirigido', 'ajuste', 'reversa')), '[]'::jsonb),
    'reinvertida_cent', coalesce((select sum(u.reinvertida_cent) from operacion.v_ds_utilidad u join operacion.v_ds_pedido v on v.pedido_id = u.pedido_id where v.proveedor_id = v_prov), 0),
    'anticipo_cent', greatest(v_saldo, 0) - least(greatest(v_saldo, 0), coalesce((select sum(u.reinvertida_cent) from operacion.v_ds_utilidad u join operacion.v_ds_pedido v on v.pedido_id = u.pedido_id where v.proveedor_id = v_prov), 0)),
    'costo_enviado_cent', coalesce((select sum(v.costo_cent - v.seguro_cent) from operacion.v_ds_pedido v where v.origen_surtido = 'dropshipping' and v.proveedor_id = v_prov and v.estado = 'enviado'), 0),
    'amortizado_cent', coalesce((select sum(v.amortizado_cent) from operacion.v_ds_pedido v where v.origen_surtido = 'dropshipping' and v.proveedor_id = v_prov and v.estado = 'enviado'), 0));
end $$;

create function api.ds_por_cobrar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('hoy', negocio.hoy(),
    'filas', coalesce((select jsonb_agg(operacion.ds_fila(v) || jsonb_build_object('dias_para_vencer', v.fecha_pago_pactada - negocio.hoy()) order by v.fecha_pago_pactada, v.pedido_id)
                       from operacion.v_ds_pedido v where v.tasa_semanal_bp is not null and v.estado in ('confirmado', 'enviado') and (v.estado <> 'enviado' or v.saldo_cliente_cent > 0)), '[]'::jsonb));
end $$;

-- "Explicar este numero": ds:<metrica>:<origen_surtido|todos>:<desde|->:<hasta|->. Dos vias: por pedido y por modelo (mercancia + cargos).
create function api.ds_explicar(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p text[] := string_to_array(p_cifra, ':'); v_met text; v_org text; v_d date; v_h date; v1 bigint; v2 bigint; v_titulo text; v_rengs jsonb; v_cargos bigint; v_extra bigint; v_unidad text := 'mxn';
begin
  perform seguridad.exigir_rol(array['socio']);
  if array_length(p, 1) <> 5 or p[1] <> 'ds' then raise exception 'cifra desconocida' using errcode = '22023'; end if;
  v_met := p[2]; v_org := case p[3] when 'todos' then null else p[3] end; v_d := nullif(p[4], '-')::date; v_h := nullif(p[5], '-')::date;
  if v_met not in ('pedidos', 'piezas', 'venta', 'costo', 'margen', 'porcobrar', 'porpagar') then raise exception 'cifra desconocida' using errcode = '22023'; end if;
  if v_org is not null and v_org not in ('dropshipping', 'inventario_merida') then raise exception 'cifra desconocida' using errcode = '22023'; end if;
  select coalesce(sum(case v_met when 'pedidos' then 1 when 'piezas' then v.piezas_surtidas when 'venta' then v.venta_cent when 'costo' then v.costo_total_cent when 'margen' then v.utilidad_total_cent
                                 when 'porcobrar' then greatest(v.saldo_cliente_cent, 0) else case when v.origen_surtido = 'dropshipping' then greatest(v.costo_cent - v.seguro_cent - v.amortizado_cent, 0) else 0 end end), 0)::bigint
    into v1 from operacion.v_ds_pedido v where v.estado = 'enviado' and (v_d is null or v.fecha_envio >= v_d) and (v_h is null or v.fecha_envio <= v_h) and (v_org is null or v.origen_surtido = v_org);
  -- Segunda via: por modelo vendido (mercancia) mas los cargos del pedido (envio, recargo, descuento) y, para costo, el seguro de reenvio.
  select coalesce(sum(case v_met when 'pedidos' then 0 when 'piezas' then s.piezas when 'venta' then s.venta_cent when 'costo' then s.costo_cent when 'margen' then s.venta_cent - s.costo_cent else 0 end), 0)::bigint into v2
    from operacion.v_ds_surtido s where (v_d is null or s.fecha_envio >= v_d) and (v_h is null or s.fecha_envio <= v_h) and (v_org is null or s.origen_surtido = v_org);
  select coalesce(sum(c.monto_cent), 0)::bigint into v_cargos from operacion.pedido_cargo c join operacion.pedido pe on pe.id = c.pedido_id and pe.estado = 'enviado'
    where (v_d is null or pe.fecha_envio >= v_d) and (v_h is null or pe.fecha_envio <= v_h) and (v_org is null or operacion.origen_surtido(pe.origen) = v_org);
  if v_met in ('venta', 'margen') then v2 := v2 + v_cargos; end if;
  -- Costo total por la segunda via: mercancia por modelo + seguro de reenvio + envio del proveedor (tabla de guias) + renta de bodega (renglones). El margen es venta - costo por esta via.
  select coalesce(sum(v.seguro_cent), 0)::bigint + coalesce(sum((select coalesce(sum(g.costo_cent), 0) from operacion.guia g where g.pedido_id = v.pedido_id)), 0)::bigint
         + coalesce(sum((select coalesce(sum(l.renta_cent), 0) from operacion.pedido_linea l where l.pedido_id = v.pedido_id)), 0)::bigint into v_extra
    from operacion.v_ds_pedido v where v.estado = 'enviado' and (v_d is null or v.fecha_envio >= v_d) and (v_h is null or v.fecha_envio <= v_h) and (v_org is null or v.origen_surtido = v_org);
  if v_met = 'costo' then v2 := v2 + v_extra; end if;
  if v_met = 'margen' then v2 := v2 - v_extra; end if;
  if v_met = 'pedidos' then v2 := (select count(distinct s.pedido_id) from operacion.v_ds_surtido s where (v_d is null or s.fecha_envio >= v_d) and (v_h is null or s.fecha_envio <= v_h) and (v_org is null or s.origen_surtido = v_org)); v_unidad := 'ident'; end if;
  if v_met = 'piezas' then v_unidad := 'pz'; end if;
  if v_met in ('porcobrar', 'porpagar') then v2 := v1; end if;
  v_titulo := case v_met when 'pedidos' then 'Pedidos enviados' when 'piezas' then 'Piezas surtidas' when 'venta' then 'Venta' when 'costo' then 'Costo de venta' when 'margen' then 'Margen'
                         when 'porcobrar' then 'Por cobrar a clientes' else 'Por pagar al proveedor' end
              || case v_org when 'dropshipping' then ' (dropshipping)' when 'inventario_merida' then ' (inventario en Merida)' else '' end;
  select coalesce(jsonb_agg(jsonb_build_object('concepto', v.folio || ' · ' || v.cliente, 'monto_cent', case v_met when 'pedidos' then 1 when 'piezas' then v.piezas_surtidas when 'venta' then v.venta_cent when 'costo' then v.costo_total_cent
                                                 when 'margen' then v.utilidad_total_cent when 'porcobrar' then greatest(v.saldo_cliente_cent, 0)
                                                 else case when v.origen_surtido = 'dropshipping' then greatest(v.costo_cent - v.seguro_cent - v.amortizado_cent, 0) else 0 end end, 'fecha_neg', v.fecha_envio) order by v.pedido_id desc), '[]'::jsonb)
    into v_rengs from operacion.v_ds_pedido v where v.estado = 'enviado' and (v_d is null or v.fecha_envio >= v_d) and (v_h is null or v.fecha_envio <= v_h) and (v_org is null or v.origen_surtido = v_org);
  if v_met in ('pedidos', 'piezas') then v_rengs := '[]'::jsonb; end if;
  return jsonb_build_object('cifra', p_cifra, 'titulo', v_titulo, 'valor', v1, 'unidad', v_unidad,
    'comprobacion', jsonb_build_object('via1', 'Suma por pedido enviado', 'via1_valor', v1, 'via2', case when v_met in ('porcobrar', 'porpagar') then 'Misma suma (saldo por pedido)' else 'Suma por modelo vendido' || case when v_met in ('venta', 'margen') then ' mas cargos del pedido' else '' end || case when v_met in ('costo', 'margen') then ', seguro, guias y renta' else '' end end,
                                       'via2_valor', v2, 'cuadra', v1 = v2),
    'renglones', v_rengs, 'movimientos', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* de las escrituras (rol socio): mismos parametros que operacion.ds_*
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['ds_crear_pedido', 'ds_capturar_destinatario', 'ds_registrar_folio', 'ds_pagar_proveedor'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;

revoke execute on function operacion.texto_orden_proveedor(text, jsonb, jsonb), operacion.ds_grupos_pedido(bigint), operacion.ds_fila(operacion.v_ds_pedido), operacion.interes_credito(bigint, int, int, text),
  operacion.origen_surtido(text), operacion.ds_posicion_proveedor(bigint), operacion.ds_piezas_movidas(date, date), operacion.ds_crear_pedido(text, bigint, jsonb, text, jsonb, jsonb, text, text, text, bigint, bigint, date, text, text, date, time), operacion.ds_capturar_destinatario(text, bigint, jsonb),
  operacion.ds_registrar_folio(text, bigint, text), operacion.ds_pagar_proveedor(text, text, bigint, text, text, bigint, bigint, date, text),
  entrega.mascara_telefono(text), entrega.mascara_correo(text), entrega.normalizar(jsonb) from public, anon, authenticated;

revoke execute on function api.ds_interes(bigint, int, int, text), api.ds_catalogo(bigint, text), api.ds_pedidos(text, text, text, bigint, date, date, text, text), api.ds_desglose(text, date, date, text), api.ds_resumen(date, date),
  api.ds_ficha(bigint), api.ds_destinatario(bigint), api.ds_destinatario_revelar(bigint, text, text), api.ds_orden_proveedor(bigint, boolean), api.ds_cuenta_proveedor(text), api.ds_por_cobrar(), api.ds_explicar(text) from public, anon;
-- GRANT a authenticated (cada funcion exige rol socio dentro; Omar, anon y los canales de sistema no pasan):
grant execute on function api.ds_interes(bigint, int, int, text), api.ds_catalogo(bigint, text), api.ds_pedidos(text, text, text, bigint, date, date, text, text), api.ds_desglose(text, date, date, text), api.ds_resumen(date, date),
  api.ds_ficha(bigint), api.ds_destinatario(bigint), api.ds_destinatario_revelar(bigint, text, text), api.ds_orden_proveedor(bigint, boolean), api.ds_cuenta_proveedor(text), api.ds_por_cobrar(), api.ds_explicar(text) to authenticated;
