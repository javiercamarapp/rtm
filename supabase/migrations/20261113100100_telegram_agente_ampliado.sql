-- Lane telegram-agente (segunda entrega): el agente puede hacer lo util del sistema desde el chat de los dos socios.
-- ADITIVA: no borra ni cambia tablas de negocio. Reemplaza solo funciones del propio agente (agente.deshacer) y amplia dos funciones de seguridad
-- para que, DENTRO de una funcion agente.* y solo con el autor verificado (un socio registrado), el canal telegram actue como ese socio.
--
--  * agente.ejecutar_ext: una sola puerta para las indicaciones nuevas (pedidos, compras, recepcion, mermas, conteo, servicios con tipo de cambio,
--    clientes y precios, actas de corte, lote historico). Cada rama llama a la funcion de negocio de siempre; el agente NO calcula dinero.
--  * agente.simular: ejecuta la indicacion dentro de un sub-bloque y la revierte; devuelve el efecto REAL que calcula el servidor y las comprobaciones por dos vias.
--    Asi el resumen de confirmacion muestra cifras del servidor y rechaza antes de escribir lo que la base no aceptaria.
--  * agente.consulta_ext: consultas de contabilidad, socios, inventario, pendientes y reporte (solo lectura).
--  * Todo con security definer, search_path vacio, revoke a public/anon/authenticated y grant solo al rol servidor.

-- ------------------------------------------------------------------ actor del canal telegram
-- Funcion de sistema: marca al autor (angelo|javier) para esta transaccion. Solo agente.ejecutar_ext la llama, despues de validar al autor.
create function agente._actuar(p_args jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_autor text := agente._autor(p_args);
begin
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_autor, true);
  return v_autor;
end $$;

create or replace function seguridad.exigir_rol(p_roles text[]) returns void
language plpgsql stable security definer set search_path = ''
as $$
declare v_rol text := seguridad.rol_actual();
begin
  if v_rol is not null and v_rol = any (p_roles) then return; end if;
  if 'importacion' = any (p_roles) and session_user = 'postgres' and current_setting('rtm.canal', true) = 'importacion' then return; end if;
  if 'importacion' = any (p_roles) and session_user in ('servidor', 'postgres') and current_setting('rtm.canal', true) = 'telegram' then return; end if;
  -- Un socio verificado por el agente (id de Telegram registrado) actua como ese socio en las funciones que exigen rol socio.
  if 'socio' = any (p_roles) and session_user in ('servidor', 'postgres') and current_setting('rtm.canal', true) = 'telegram'
     and current_setting('rtm.actor', true) in ('angelo', 'javier') then return; end if;
  raise exception 'permiso denegado' using errcode = '42501';
end $$;

create or replace function operacion.actor_socio() returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select s.id from seguridad.usuario u join catalogo.socio s on s.nombre = u.socio_nombre where u.id = auth.uid()),
    (select s.id from catalogo.socio s
       where session_user in ('servidor', 'postgres') and current_setting('rtm.canal', true) = 'telegram'
         and s.nombre = initcap(nullif(current_setting('rtm.actor', true), ''))))
$$;

-- ------------------------------------------------------------------ libro de hechos ampliado
alter table agente.hecho drop constraint hecho_tipo_check;
alter table agente.hecho add constraint hecho_tipo_check check (tipo in (
  'pago_a_socio', 'aportacion', 'pago_cliente', 'pago_proveedor',
  'pedido', 'pedido_envio', 'pedido_entrega', 'pedido_cancelar', 'compra', 'orden_compra', 'compra_aprobar', 'compra_estado', 'compra_recepcion',
  'merma', 'conteo', 'cliente', 'precio', 'acta_propuesta', 'acta_firma', 'lote_historico'));
alter table agente.hecho drop constraint hecho_ref_tipo_check;
alter table agente.hecho add constraint hecho_ref_tipo_check check (ref_tipo is null or ref_tipo in ('libro', 'aportacion', 'pago', 'movimiento_proveedor', 'pedido', 'compra', 'evento', 'cierre', 'gasto'));

-- Guarda un hecho con el folio de negocio que se le muestra al socio (P-, C-, T-...) o, si no hay, el del evento.
create function agente._guardar_hecho2(p_clave text, p_tipo text, p_ref_tipo text, p_ref_id bigint, p_autor text, p_folio text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_folio text := p_folio;
begin
  if v_folio is null then select folio into v_folio from operacion.evento where clave_idem = p_clave; end if;
  if v_folio is null then raise exception 'el movimiento no dejo evento ni folio' using errcode = 'P0460'; end if;
  -- Un mismo folio de negocio puede tener varios hechos (crear y enviar un pedido): los posteriores usan el folio de su evento.
  if exists (select 1 from agente.hecho h where h.folio = v_folio and h.clave_idem <> p_clave) then
    select folio into v_folio from operacion.evento where clave_idem = p_clave;
  end if;
  insert into agente.hecho (clave_idem, folio, tipo, ref_tipo, ref_id, autor) values (p_clave, v_folio, p_tipo, p_ref_tipo, p_ref_id, p_autor) on conflict (clave_idem) do nothing;
  select h.folio into v_folio from agente.hecho h where h.clave_idem = p_clave;
  return v_folio;
end $$;

-- Renglones del agente (modelo_id, sabor_id, piezas, precio_cent opcional) a renglones de las funciones de negocio (sku_id). Jamas calcula precios.
create function agente._lineas_sku(p_lineas jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare l jsonb; v_sku bigint; v_sal jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'faltan renglones: modelo, sabor y piezas' using errcode = 'P0460'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    select k.id into v_sku from catalogo.sku k where k.modelo_id = (l ->> 'modelo_id')::bigint and k.sabor_id = nullif(l ->> 'sabor_id', '')::bigint;
    if v_sku is null then raise exception 'falta el sabor de un renglon (modelo y sabor del catalogo)' using errcode = 'P0460'; end if;
    v_sal := v_sal || jsonb_build_array(jsonb_build_object('sku_id', v_sku, 'modelo_id', (l ->> 'modelo_id')::bigint, 'piezas', (l ->> 'piezas')::int, 'pagadas', (l ->> 'piezas')::int,
      'precio_cent', nullif(l ->> 'precio_cent', '')::bigint));
  end loop;
  return v_sal;
end $$;

create function agente._pedido_id(p_folio text) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v bigint;
begin
  select id into v from operacion.pedido where folio = upper(btrim(p_folio));
  if v is null then raise exception 'no encuentro el pedido %: dime el folio (por ejemplo P-0001)', coalesce(p_folio, '') using errcode = 'P0460'; end if;
  return v;
end $$;

create function agente._compra_id(p_folio text) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v bigint;
begin
  select id into v from operacion.compra where folio = upper(btrim(p_folio));
  if v is null then raise exception 'no encuentro la compra %: dime el folio (por ejemplo C-0001)', coalesce(p_folio, '') using errcode = 'P0460'; end if;
  return v;
end $$;

-- ------------------------------------------------------------------ escrituras nuevas
create function agente.ejecutar_ext(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_origen text; v_existia boolean; v_res jsonb; v_res2 jsonb; v_id bigint; v_folio text; v_lineas jsonb; v_prov text; v_nota text;
  v_mxn bigint; v_tc bigint; v_usd bigint; v_modelo text; v_sabor text; v_ev bigint; v_cierre bigint; r jsonb; n int := 0; v_tipo_r text; v_folios jsonb := '[]'::jsonb; v_fecha date;
  v_conteo bigint; v_recib jsonb; v_cli text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  v_origen := agente._origen(p_args);
  v_existia := exists (select 1 from seguridad.operacion where clave = case when p_tipo = 'lote_historico' then p_clave_idem || ':1' else p_clave_idem end and resultado is not null);

  if p_tipo = 'pedido_crear' then
    v_lineas := agente._lineas_sku(p_args -> 'lineas');
    v_res := operacion.crear_pedido(p_clave_idem, (p_args ->> 'cliente_id')::bigint, v_lineas, coalesce(nullif(p_args ->> 'origen_pedido', ''), 'bodega_omar'), null,
      coalesce((p_args ->> 'envio_cent')::bigint, 0), 0, 0, null, null, null, null, p_args ->> 'nota', v_origen);
    v_id := (v_res ->> 'pedido_id')::bigint;
    v_res2 := operacion.confirmar_pedido(p_clave_idem || ':c', v_id);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'pedido', 'pedido', v_id, v_autor, v_res ->> 'folio');
    v_res := v_res || jsonb_build_object('folio', v_res ->> 'folio', 'estado', 'confirmado', 'renglones_sin_existencia', v_res2 -> 'renglones_sin_existencia');

  elsif p_tipo = 'pedido_enviar' then
    v_id := agente._pedido_id(p_args ->> 'pedido_folio');
    v_res := operacion.enviar_pedido(p_clave_idem, v_id, null,
      case when nullif(p_args ->> 'guia', '') is null then null else jsonb_build_object('paqueteria', coalesce(nullif(p_args ->> 'paqueteria', ''), 'sin dato'), 'numero', p_args ->> 'guia') end,
      null, coalesce((p_args ->> 'aceptar_avisos')::boolean, false));
    v_folio := agente._guardar_hecho2(p_clave_idem, 'pedido_envio', 'pedido', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'pedido', upper(p_args ->> 'pedido_folio'));

  elsif p_tipo = 'pedido_entregar' then
    v_id := agente._pedido_id(p_args ->> 'pedido_folio');
    v_res := operacion.marcar_entregado(p_clave_idem, v_id);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'pedido_entrega', 'pedido', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'pedido', upper(p_args ->> 'pedido_folio'));

  elsif p_tipo = 'pedido_cancelar' then
    v_id := agente._pedido_id(p_args ->> 'pedido_folio');
    v_res := operacion.cancelar_pedido(p_clave_idem, v_id, p_args ->> 'motivo');
    v_folio := agente._guardar_hecho2(p_clave_idem, 'pedido_cancelar', 'pedido', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'pedido', upper(p_args ->> 'pedido_folio'));

  elsif p_tipo in ('compra_crear', 'orden_compra') then
    v_lineas := agente._lineas_sku(p_args -> 'lineas');
    v_prov := initcap(p_args ->> 'proveedor');
    if v_prov not in ('Isaac', 'Karen') then raise exception 'proveedor desconocido: Isaac o Karen' using errcode = 'P0460'; end if;
    v_res := operacion.crear_compra(p_clave_idem, v_prov, v_lineas, coalesce((p_args ->> 'guia_cent')::bigint, 0), 0, null, 'bodega', 'sociedad',
      nullif(nullif(initcap(coalesce(p_args ->> 'pagado_por', '')), ''), 'Sociedad'), null, p_args ->> 'nota');
    v_id := (v_res ->> 'compra_id')::bigint;
    if p_tipo = 'compra_crear' then
      v_res2 := operacion.confirmar_compra(p_clave_idem || ':c', v_id);
    end if;
    v_folio := agente._guardar_hecho2(p_clave_idem, case p_tipo when 'compra_crear' then 'compra' else 'orden_compra' end, 'compra', v_id, v_autor, v_res ->> 'folio');
    v_res := v_res || jsonb_build_object('folio', v_res ->> 'folio', 'estado', case p_tipo when 'compra_crear' then 'confirmada' else 'borrador' end);

  elsif p_tipo = 'compra_aprobar' then
    v_id := agente._compra_id(p_args ->> 'compra_folio');
    v_res := operacion.confirmar_compra(p_clave_idem, v_id);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'compra_aprobar', 'compra', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'compra', upper(p_args ->> 'compra_folio'));

  elsif p_tipo = 'compra_estado' then
    v_id := agente._compra_id(p_args ->> 'compra_folio');
    if lower(p_args ->> 'estado') = 'enviada' then v_res := operacion.marcar_compra_enviada(p_clave_idem, v_id, '[]'::jsonb, null, null);
    elsif lower(p_args ->> 'estado') = 'llego_merida' then v_res := operacion.marcar_llego_merida(p_clave_idem, v_id);
    else raise exception 'el estado de una compra por Telegram es enviada o llego a Merida' using errcode = 'P0460'; end if;
    v_folio := agente._guardar_hecho2(p_clave_idem, 'compra_estado', 'compra', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'compra', upper(p_args ->> 'compra_folio'));

  elsif p_tipo = 'compra_recepcion' then
    v_id := agente._compra_id(p_args ->> 'compra_folio');
    if jsonb_typeof(p_args -> 'lineas') = 'array' and jsonb_array_length(p_args -> 'lineas') > 0 then
      -- Recepcion parcial: solo lo que el socio dicto; el servidor ubica el renglon de la compra por modelo y sabor.
      select coalesce(jsonb_agg(jsonb_build_object('linea_id', cl.id, 'sku_id', cl.sku_id, 'piezas', (x ->> 'piezas')::int)), '[]'::jsonb) into v_recib
        from jsonb_array_elements(p_args -> 'lineas') x
        join catalogo.sku k on k.modelo_id = (x ->> 'modelo_id')::bigint and k.sabor_id = nullif(x ->> 'sabor_id', '')::bigint
        join operacion.compra_linea cl on cl.compra_id = v_id and cl.sku_id = k.id;
      if jsonb_array_length(v_recib) <> jsonb_array_length(p_args -> 'lineas') then raise exception 'un renglon recibido no esta en la compra %', upper(p_args ->> 'compra_folio') using errcode = 'P0460'; end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('linea_id', cl.id, 'sku_id', cl.sku_id, 'piezas', cl.piezas_facturadas)), '[]'::jsonb) into v_recib from operacion.compra_linea cl where cl.compra_id = v_id;
    end if;
    v_res := operacion.recibir_compra(p_clave_idem, v_id, v_recib, null);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'compra_recepcion', 'compra', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'compra', upper(p_args ->> 'compra_folio'));

  elsif p_tipo = 'gasto_servicio' then
    -- El monto en pesos lo calcula la base: USD por tipo de cambio con UN techo al peso entero (la misma regla de los costos del sistema).
    v_usd := nullif(p_args ->> 'monto_usd_cent', '')::bigint;
    v_mxn := nullif(p_args ->> 'monto_mxn_cent', '')::bigint;
    if v_usd is not null and v_mxn is not null then raise exception 'dime el monto en dolares o en pesos, no los dos' using errcode = 'P0460'; end if;
    if v_usd is not null then
      v_tc := coalesce(nullif(p_args ->> 'tc_micro', '')::bigint, (costos.tipo_cambio_del_dia(negocio.hoy()) ->> 'tc_micro')::bigint);
      if v_tc is null then raise exception 'falta el tipo de cambio: dime a cuanto lo pagaste o registralo primero' using errcode = 'P0460'; end if;
      v_mxn := costos.techo(v_usd::numeric * v_tc::numeric, 1000000::numeric, 100::numeric)::bigint;
    end if;
    if v_mxn is null or v_mxn <= 0 then raise exception 'falta el monto del cargo' using errcode = 'P0460'; end if;
    if initcap(p_args ->> 'pagado_por') not in ('Angelo', 'Javier') then raise exception 'dime quien pago el servicio, Angelo o Javier' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_gasto_socio(p_clave_idem, initcap(p_args ->> 'pagado_por'), v_mxn, 'servicio', 'fijo', null, null,
      left('Servicio ' || coalesce(p_args ->> 'servicio', '') || case when v_usd is not null then ' USD ' || (v_usd / 100.0)::numeric(14, 2) || ' a TC ' || (v_tc / 1000000.0)::numeric(12, 4) else '' end, 200), v_origen);
    v_res := v_res || jsonb_build_object('monto_cent', v_mxn, 'tc_micro', v_tc, 'usd_cent', v_usd);

  elsif p_tipo = 'merma' then
    select m.nombre_canonico, sa.nombre_canonico into v_modelo, v_sabor from catalogo.modelo m, catalogo.sabor sa where m.id = (p_args ->> 'modelo_id')::bigint and sa.id = nullif(p_args ->> 'sabor_id', '')::bigint;
    if v_modelo is null then raise exception 'la merma necesita modelo y sabor' using errcode = 'P0460'; end if;
    if coalesce(btrim(p_args ->> 'motivo'), '') = '' then raise exception 'la merma necesita motivo' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_movimiento(p_clave_idem, v_modelo, v_sabor, 'bodega_omar', 'merma', -((p_args ->> 'piezas')::int), null, null, left(v_origen || ' | motivo: ' || (p_args ->> 'motivo'), 400));
    v_folio := agente._guardar_hecho2(p_clave_idem, 'merma', 'evento', (v_res ->> 'evento_id')::bigint, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio);

  elsif p_tipo = 'conteo' then
    v_res := operacion.abrir_conteo(p_clave_idem || ':a', 'bodega_omar', 'semanal', now());
    v_conteo := (v_res ->> 'conteo_id')::bigint;
    select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'contado', (x ->> 'piezas')::int, 'explicacion_tipo', null)), '[]'::jsonb) into v_recib
      from jsonb_array_elements(p_args -> 'lineas') x join catalogo.modelo m on m.id = (x ->> 'modelo_id')::bigint join catalogo.sabor sa on sa.id = nullif(x ->> 'sabor_id', '')::bigint;
    if jsonb_array_length(v_recib) <> jsonb_array_length(p_args -> 'lineas') then raise exception 'cada renglon del conteo necesita modelo y sabor' using errcode = 'P0460'; end if;
    v_res := operacion.cerrar_conteo(p_clave_idem, v_conteo, v_recib);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'conteo', null, null, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'conteo_id', v_conteo);

  elsif p_tipo = 'cliente_alta' then
    v_cli := btrim(coalesce(p_args ->> 'nombre', ''));
    if char_length(v_cli) < 2 or char_length(v_cli) > 120 then raise exception 'nombre de cliente invalido' using errcode = 'P0460'; end if;
    if exists (select 1 from catalogo.cliente where nombre_norm = catalogo.normalizar(v_cli)) then raise exception 'ese cliente ya existe: usa su nombre para venderle' using errcode = 'P0460'; end if;
    v_res := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cliente_alta', 'n', v_cli));
    if v_res is null then
      v_id := catalogo.asegurar_cliente(v_cli, initcap(v_autor), coalesce(nullif(p_args ->> 'tipo', ''), 'mayoreo'), p_args ->> 'nota');
      v_res := jsonb_build_object('cliente_id', v_id, 'nombre', v_cli);
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
    end if;
    v_ev := operacion.crear_evento('cliente_alta_telegram', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('cliente_id', (v_res ->> 'cliente_id')::bigint), v_origen);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'cliente', null, null, v_autor, (select e.folio from operacion.evento e where e.id = v_ev));
    v_res := v_res || jsonb_build_object('folio', v_folio);

  elsif p_tipo = 'cliente_precio' then
    v_res := api.fijar_precio(p_clave_idem, (p_args ->> 'cliente_id')::bigint, (p_args ->> 'modelo_id')::bigint, (p_args ->> 'precio_cent')::bigint, coalesce(nullif(p_args ->> 'desde', '')::date, negocio.hoy()), 'chat', left(v_origen, 300));
    v_ev := operacion.crear_evento('precio_telegram', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('cliente_id', (p_args ->> 'cliente_id')::bigint), v_origen);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'precio', null, null, v_autor, (select e.folio from operacion.evento e where e.id = v_ev));
    v_res := v_res || jsonb_build_object('folio', v_folio);

  elsif p_tipo = 'acta_propuesta' then
    v_res := operacion.proponer_cierre_reparto(p_clave_idem, (p_args ->> 'ini')::date, (p_args ->> 'fin')::date, coalesce(p_args -> 'decisiones', '{}'::jsonb), left(v_origen, 300));
    v_cierre := coalesce((v_res ->> 'cierre_id')::bigint, (v_res ->> 'id')::bigint);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'acta_propuesta', 'cierre', v_cierre, v_autor, v_res ->> 'folio');
    v_res := v_res || jsonb_build_object('folio', coalesce(v_res ->> 'folio', v_folio));

  elsif p_tipo = 'acta_firma' then
    -- La firma es personal: la da quien la pide, desde su propio id de Telegram. El bot jamas firma por un socio.
    if nullif(p_args ->> 'cierre_folio', '') is not null then select id into v_cierre from operacion.cierre_reparto where folio = upper(btrim(p_args ->> 'cierre_folio'));
    else
      select c.id into v_cierre from operacion.cierre_reparto c
        where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)
          and not exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id and f.socio_id = operacion.actor_socio())
          and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) < 2
        order by c.id desc limit 1;
    end if;
    if v_cierre is null then raise exception 'no hay un acta pendiente de tu firma' using errcode = 'P0460'; end if;
    v_res := operacion.firmar_cierre_reparto(p_clave_idem, v_cierre);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'acta_firma', 'cierre', v_cierre, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio);

  elsif p_tipo = 'lote_historico' then
    -- Cada renglon lleva fecha pasada explicita y su propia clave (clave del lote + posicion): reenviar el lote completo no duplica nada.
    if jsonb_typeof(p_args -> 'renglones') <> 'array' or jsonb_array_length(p_args -> 'renglones') = 0 then raise exception 'el lote no trae renglones' using errcode = 'P0460'; end if;
    for r in select * from jsonb_array_elements(p_args -> 'renglones') loop
      n := n + 1;
      v_fecha := (r ->> 'fecha')::date;
      if v_fecha is null or v_fecha >= negocio.hoy() then raise exception 'el renglon % necesita una fecha pasada explicita', n using errcode = 'P0460'; end if;
      v_tipo_r := r ->> 'tipo';
      if v_tipo_r = 'gasto' then
        v_res2 := operacion.registrar_gasto_socio(p_clave_idem || ':' || n, initcap(r ->> 'socio'), (r ->> 'monto_cent')::bigint, coalesce(nullif(r ->> 'categoria', ''), 'otro'), 'variable', v_fecha, null, left(coalesce(r ->> 'concepto', 'Historico'), 200), v_origen);
      elsif v_tipo_r = 'cobro' then
        v_res2 := operacion.registrar_pago(p_clave_idem || ':' || n, initcap(r ->> 'cuenta'), (r ->> 'monto_cent')::bigint, (r ->> 'cliente_id')::bigint, null, true, 'abono', v_fecha, null, left(coalesce(r ->> 'concepto', 'Historico'), 200), v_origen);
      elsif v_tipo_r = 'aportacion' then
        v_res2 := operacion.registrar_aportacion(p_clave_idem || ':' || n, initcap(r ->> 'socio'), (r ->> 'monto_cent')::bigint, coalesce(r ->> 'concepto', 'Aportacion historica'), case lower(coalesce(r ->> 'intencion', '')) when 'capital' then 'capital' else 'reembolso' end, v_fecha, v_origen);
      elsif v_tipo_r in ('reembolso', 'retiro') then
        v_res2 := operacion.registrar_pago_a_socio(p_clave_idem || ':' || n, initcap(r ->> 'socio'), (r ->> 'monto_cent')::bigint, v_tipo_r, lower(coalesce(r ->> 'via', 'efectivo')), v_fecha, left(coalesce(r ->> 'concepto', 'Historico'), 200), v_origen);
      else
        raise exception 'el renglon % es de un tipo que el lote historico no acepta (gasto, cobro, aportacion, reembolso o retiro)', n using errcode = 'P0460';
      end if;
      v_folio := agente._guardar_hecho2(p_clave_idem || ':' || n, case v_tipo_r when 'gasto' then 'lote_historico' else 'lote_historico' end,
        case v_tipo_r when 'cobro' then 'pago' when 'aportacion' then 'aportacion' when 'gasto' then null else 'libro' end,
        case v_tipo_r when 'cobro' then (v_res2 ->> 'pago_id')::bigint when 'aportacion' then (v_res2 ->> 'aportacion_id')::bigint when 'gasto' then null else (v_res2 ->> 'libro_id')::bigint end, v_autor, null);
      v_folios := v_folios || to_jsonb(v_folio);
    end loop;
    v_res := jsonb_build_object('renglones', n, 'folios', v_folios, 'folio', v_folios ->> 0, 'etiqueta', p_args ->> 'etiqueta');

  else
    raise exception 'tipo de indicacion no soportado por Telegram todavia: %', p_tipo using errcode = 'P0460';
  end if;
  return v_res || jsonb_build_object('repetido', v_existia);
end $$;

-- ------------------------------------------------------------------ vista previa con el efecto real (se revierte siempre)
create function agente.simular(p_hub text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_efecto jsonb := '{}'::jsonb; v_rojas jsonb; v_txt text; v_id bigint; v_clave text := 'sim:' || clock_timestamp()::text || ':' || p_tipo;
begin
  perform notificacion.exigir_sistema();
  perform agente._actuar(p_args);
  begin
    if p_hub = 'ejecutar_ext' then v_res := agente.ejecutar_ext(v_clave, p_tipo, p_args);
    elsif p_hub = 'ejecutar' then v_res := agente.ejecutar(v_clave, p_tipo, p_args);
    else raise exception 'hub desconocido' using errcode = 'P0460'; end if;
    -- Efecto que calcula el servidor (precios del tabulador, totales, saldos): NUNCA la IA.
    if p_tipo = 'pedido_crear' then
      v_id := (v_res ->> 'pedido_id')::bigint;
      v_efecto := jsonb_build_object(
        'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico || ' ' || sa.nombre_canonico, 'piezas', l.piezas_pedidas, 'precio_cent', l.precio_cent, 'importe_cent', l.piezas_pedidas::bigint * l.precio_cent) order by l.id), '[]'::jsonb)
                     from operacion.pedido_linea l join catalogo.modelo m on m.id = l.modelo_id join catalogo.sku k on k.id = l.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = v_id),
        'mercancia_cent', (select coalesce(sum(l.piezas_pedidas::bigint * l.precio_cent), 0) from operacion.pedido_linea l where l.pedido_id = v_id),
        'envio_cent', (select envio_cent from operacion.pedido where id = v_id),
        'avisos', (select coalesce(jsonb_agg(a.detalle order by a.id), '[]'::jsonb) from operacion.pedido_aviso a where a.pedido_id = v_id));
    elsif p_tipo in ('compra_crear', 'orden_compra') then
      v_id := (v_res ->> 'compra_id')::bigint;
      v_efecto := (select jsonb_build_object('mercancia_cent', c.mercancia_cent, 'guia_cent', c.guia_cent, 'total_cent', c.total_cent,
        'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico || ' ' || sa.nombre_canonico, 'piezas', cl.piezas_pagadas, 'precio_cent', cl.costo_unit_cent, 'importe_cent', cl.piezas_pagadas::bigint * cl.costo_unit_cent) order by cl.id), '[]'::jsonb)
                     from operacion.compra_linea cl join catalogo.modelo m on m.id = cl.modelo_id join catalogo.sku k on k.id = cl.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where cl.compra_id = c.id))
        from operacion.compra c where c.id = v_id);
    elsif p_tipo = 'gasto_servicio' then
      v_efecto := jsonb_build_object('monto_cent', v_res -> 'monto_cent', 'tc_micro', v_res -> 'tc_micro', 'usd_cent', v_res -> 'usd_cent');
    elsif p_tipo = 'compra_recepcion' then
      v_efecto := jsonb_build_object('diferencias', coalesce(v_res -> 'diferencias', '[]'::jsonb), 'estado', v_res -> 'estado');
    end if;
    -- Los asientos se publican al cerrar cada transaccion real; aqui se fuerzan para que el cuadre por dos vias incluya el efecto simulado.
    perform contabilidad.asentar_pendientes();
    select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'via_a_cent', c.via_a_cent, 'via_b_cent', c.via_b_cent)), '[]'::jsonb) into v_rojas from contabilidad.comprobaciones() c where not c.ok and c.bloqueante;
    raise exception 'simulacion' using errcode = 'P0498', detail = jsonb_build_object('resultado', v_res - 'repetido', 'efecto', v_efecto, 'cuadra', jsonb_array_length(v_rojas) = 0, 'comprobaciones_rojas', v_rojas)::text;
  exception when sqlstate 'P0498' then
    get stacked diagnostics v_txt = pg_exception_detail;
    return v_txt::jsonb;
  end;
end $$;

-- ------------------------------------------------------------------ deshacer ampliado
create or replace function agente.deshacer(p_clave_idem text, p_folio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_gasto bigint; v_aport bigint; v_toma bigint; v_estado text; v_res jsonb; h agente.hecho;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  select * into h from agente.hecho where folio = p_folio;
  if found then
    if h.deshecho_at is not null then raise exception 'el folio % ya estaba deshecho', p_folio using errcode = 'P0428'; end if;
    perform set_config('rtm.actor', h.autor, true);
    if h.tipo = 'pedido' then
      select estado into v_estado from operacion.pedido where id = h.ref_id;
      if v_estado not in ('borrador', 'confirmado') then raise exception 'el pedido % ya esta %: un pedido enviado se anula desde el software, no por Telegram', p_folio, v_estado using errcode = 'P0460'; end if;
      v_res := operacion.cancelar_pedido(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
    elsif h.tipo in ('compra', 'orden_compra') then
      v_res := operacion.anular_compra(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
    elsif h.tipo = 'merma' then
      v_res := operacion.reversar_evento(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
    elsif h.tipo in ('pedido_envio', 'pedido_entrega', 'pedido_cancelar', 'compra_aprobar', 'compra_estado', 'compra_recepcion', 'conteo', 'cliente', 'precio', 'acta_propuesta', 'acta_firma') then
      raise exception 'ese movimiento (%) no tiene reversa directa: se corrige desde el software', h.tipo using errcode = 'P0460';
    else
      if h.ref_tipo is null then raise exception 'ese movimiento se deshace desde el software (no tiene una anulacion directa)' using errcode = 'P0460'; end if;
      if h.ref_tipo = 'libro' then v_res := operacion.anular_movimiento_socio(p_clave_idem, 'libro', h.ref_id, 'Deshecho desde Telegram');
      elsif h.ref_tipo = 'aportacion' then v_res := operacion.anular_movimiento_socio(p_clave_idem, 'aportacion', h.ref_id, 'Deshecho desde Telegram');
      elsif h.ref_tipo = 'pago' then v_res := operacion.anular_pago(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
      else v_res := operacion.anular_movimiento_proveedor(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
      end if;
    end if;
    update agente.hecho set deshecho_at = now() where folio = p_folio;
    return v_res || jsonb_build_object('folio', p_folio, 'deshecho', true);
  end if;
  select id into v_gasto from operacion.gasto where folio = p_folio;
  if v_gasto is not null then
    select id into v_aport from operacion.aportacion_socio where ref_tipo = 'gasto' and ref_id = v_gasto and reversa_de is null;
    v_res := operacion.anular_movimiento_socio(p_clave_idem, 'aportacion', v_aport, 'Deshecho desde Telegram');
    return v_res || jsonb_build_object('folio', p_folio);
  end if;
  select id, estado into v_toma, v_estado from operacion.toma_omar where folio = p_folio;
  if v_toma is not null then
    v_res := operacion.resolver_toma_omar(p_clave_idem, v_toma, case v_estado when 'pendiente' then 'rechazar' else 'deshacer' end);
    return v_res;
  end if;
  raise exception 'folio desconocido o que aun no se deshace por Telegram' using errcode = 'P0460';
end $$;

-- ------------------------------------------------------------------ consultas nuevas (solo lectura; las cifras salen de las funciones de siempre)
create function agente.consulta_ext(p_tipo text, p_modelo bigint default null, p_sujeto text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_hoy date := negocio.hoy(); v_ini date; v_u jsonb; v_b jsonb; v_n int; v_c jsonb;
begin
  perform notificacion.exigir_sistema();
  if p_tipo = 'cuadra' then
    select jsonb_build_object('titulo', case when bool_and(c.ok or not c.bloqueante) then 'Las cuentas cuadran' else 'Hay comprobaciones en rojo' end,
      'lineas', coalesce(jsonb_agg(jsonb_build_object('etiqueta', c.nombre || case when c.ok then ' (ok)' else ' (NO cuadra)' end, 'centavos', c.via_a_cent - c.via_b_cent) order by c.codigo), '[]'::jsonb)) into v_res
      from contabilidad.comprobaciones() c;
  elsif p_tipo = 'saldos_socios' then
    v_c := operacion.cuenta_socios();
    v_res := jsonb_build_object('titulo', 'Cuenta de cada socio', 'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', 'Posicion neta de ' || s.nombre, 'centavos', operacion.neto_socio(s.id)) order by s.nombre), '[]'::jsonb) from catalogo.socio s)
      || jsonb_build_array(jsonb_build_object('etiqueta', 'Javier le debe a Angelo', 'centavos', (operacion.posicion_socios() ->> 'javier_debe_a_angelo_cent')::bigint)));
  elsif p_tipo = 'balance' then
    v_b := contabilidad.balance_general(v_hoy);
    v_res := jsonb_build_object('titulo', 'Balance general al ' || v_hoy, 'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', k, 'centavos', (v_b -> k)::text::bigint)), '[]'::jsonb)
      from jsonb_object_keys(v_b) k where jsonb_typeof(v_b -> k) = 'number' and k like '%cent'));
  elsif p_tipo = 'diario' then
    v_res := jsonb_build_object('titulo', 'Ultimos asientos del diario', 'lineas', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', a.folio || ' ' || left(a.descripcion, 60), 'texto', a.fecha_neg::text)) from (
      select * from contabilidad.asiento order by id desc limit 8) a), '[]'::jsonb));
  elsif p_tipo = 'cobertura' then
    select jsonb_build_object('titulo', 'Cobertura de inventario por modelo', 'lineas', coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico, 'piezas', x.disponible, 'texto', coalesce(x.estado, 'sin dato') || ' (' || coalesce(round(x.dias)::text, '?') || ' dias)') order by m.nombre_canonico), '[]'::jsonb)) into v_res
      from operacion.cobertura(v_hoy) x join catalogo.modelo m on m.id = x.modelo_id where x.nivel = 'modelo' and (p_modelo is null or m.id = p_modelo);
  elsif p_tipo = 'reporte' then
    v_ini := case lower(coalesce(p_sujeto, 'semana')) when 'hoy' then v_hoy when 'mes' then date_trunc('month', v_hoy)::date else v_hoy - 6 end;
    v_u := operacion.utilidad_periodo(v_ini, v_hoy);
    v_res := jsonb_build_object('titulo', 'Reporte ' || coalesce(p_sujeto, 'semana') || ' (' || v_ini || ' al ' || v_hoy || ')', 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Utilidad operativa', 'centavos', (v_u ->> 'utilidad_cent')::bigint),
      jsonb_build_object('etiqueta', 'Gastos generales', 'centavos', (v_u ->> 'gastos_cent')::bigint),
      jsonb_build_object('etiqueta', 'Por cobrar a clientes', 'centavos', (select coalesce(sum(q.s), 0)::bigint from (select operacion.saldo_cliente(c.id) + coalesce(operacion.apertura_cxc_cliente(c.id), 0) as s from catalogo.cliente c where c.activo) q where q.s > 0)),
      jsonb_build_object('etiqueta', 'Piezas en existencia', 'piezas', (select coalesce(sum(piezas), 0)::int from operacion.existencia_modelo)),
      jsonb_build_object('etiqueta', 'Nota', 'texto', 'Resumen en el grupo; no se envia por correo.')));
  elsif p_tipo = 'compras' then
    v_res := jsonb_build_object('titulo', 'Compras abiertas', 'lineas', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', c.folio || ' ' || p.nombre || ' (' || c.estado || ')', 'centavos', c.total_cent) order by c.id desc)
      from operacion.compra c join catalogo.proveedor p on p.id = c.proveedor_id where c.estado in ('borrador', 'confirmada', 'enviada', 'en_trayecto', 'llego_merida')), '[]'::jsonb));
  elsif p_tipo = 'pedidos' then
    v_res := jsonb_build_object('titulo', 'Pedidos abiertos', 'lineas', coalesce((select jsonb_agg(jsonb_build_object('etiqueta', pe.folio || ' ' || cl.nombre_canonico || ' (' || pe.estado || ')', 'centavos', operacion.pedido_saldo(pe.id)) order by pe.id desc)
      from operacion.pedido pe join catalogo.cliente cl on cl.id = pe.cliente_id where pe.estado in ('borrador', 'confirmado', 'enviado')), '[]'::jsonb));
  elsif p_tipo = 'pendientes' then
    v_res := jsonb_build_object('titulo', 'Que falta por hacer', 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Pedidos confirmados por enviar', 'piezas', (select count(*)::int from operacion.pedido where estado = 'confirmado')),
      jsonb_build_object('etiqueta', 'Pedidos enviados por entregar o cobrar', 'piezas', (select count(*)::int from operacion.pedido where estado = 'enviado' and operacion.pedido_saldo(id) > 0)),
      jsonb_build_object('etiqueta', 'Compras por recibir', 'piezas', (select count(*)::int from operacion.compra where estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida'))),
      jsonb_build_object('etiqueta', 'Ordenes de compra por aprobar', 'piezas', (select count(*)::int from operacion.compra where estado = 'borrador')),
      jsonb_build_object('etiqueta', 'Tomas de Omar por autorizar', 'piezas', (select count(*)::int from operacion.toma_omar where estado = 'pendiente')),
      jsonb_build_object('etiqueta', 'Actas de corte pendientes de firma', 'piezas', (select count(*)::int from operacion.cierre_reparto c
        where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) < 2))));
  else
    raise exception 'consulta desconocida' using errcode = '22023';
  end if;
  return coalesce(v_res, jsonb_build_object('titulo', 'Sin datos', 'lineas', '[]'::jsonb));
end $$;

-- Limite de frecuencia: mensajes reclamados en ese chat en los ultimos segundos (cuenta filas; no guarda texto).
create function agente.mensajes_recientes(p_chat bigint, p_segundos int) returns int
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select count(*)::int from agente.tg_mensaje where chat_id = p_chat and recibido_at > now() - make_interval(secs => p_segundos));
end $$;

-- ------------------------------------------------------------------ capacidades ampliadas
create or replace function agente.capacidades() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object(
    'devolucion', to_regprocedure('operacion.registrar_devolucion_cliente(text,bigint,jsonb,text)') is not null,
    'paquete', to_regprocedure('operacion.reportar_paquete_salida(text,bigint,text,text,jsonb)') is not null,
    'ejecutar_ext', true);
end $$;

revoke execute on all functions in schema agente from public, anon, authenticated;
grant execute on all functions in schema agente to servidor;
