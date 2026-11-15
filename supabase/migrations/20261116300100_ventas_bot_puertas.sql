-- Carril bot/ventas-compras, parte 2: puertas de escritura y lectura del bot para ventas, compras, guias, devoluciones y paquetes.
-- Tipos nuevos de agente.ejecutar_ext / agente.simular (se enrutan en agente._ejecutar_ext_base, rename + wrap sobre la ultima definicion):
--   pedido_ds        pedido de dropshipping a un cliente (ds_crear_pedido + confirmar). Contado = plazo 0; credito = plazo explicito (P0436). Sin destinatario: los datos de entrega se capturan en la web.
--   envio_lote       primer tiempo: varios pedidos salen con una paqueteria del catalogo cerrado, sin exigir guia.
--   guias_lote       segundo tiempo: captura de guias por pedido (ya emparejadas por el codigo; las dudas se preguntaron antes).
--   compra_cierre    cierra la recepcion de una compra con faltante (baja la cuenta del proveedor).
--   devolucion       devolucion de un cliente (registrar_devolucion_cliente).
--   paquete_perdido  paquete perdido o danado de un pedido enviado (reportar_paquete_salida).
-- Ademas: huella antiduplicado de los tipos nuevos, lista explicita de lo no reversible, espejo de slots de las operaciones nuevas y consultas de vencimientos y pedidos de un cliente.
-- ADITIVA. Nada de aqui calcula dinero con IA: todo importe lo calcula SQL.

alter table agente.hecho drop constraint hecho_tipo_check;
alter table agente.hecho add constraint hecho_tipo_check check (tipo in (
  'pago_a_socio', 'aportacion', 'pago_cliente', 'pago_proveedor',
  'pedido', 'pedido_envio', 'pedido_entrega', 'pedido_cancelar', 'compra', 'orden_compra', 'compra_aprobar', 'compra_estado', 'compra_recepcion',
  'merma', 'conteo', 'cliente', 'precio', 'acta_propuesta', 'acta_firma', 'lote_historico',
  'envio_lote', 'guias_lote', 'compra_cierre', 'devolucion', 'paquete_perdido'));

-- Renglones {modelo_id, sabor_id, piezas} -> renglones del pedido {linea_id, sku_id, piezas, destino?}. Prefiere el renglon del mismo sabor; si no, el del mismo modelo.
create function agente._lineas_de_pedido(p_pedido bigint, p_lineas jsonb, p_destino text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare l jsonb; v_sku bigint; v_linea bigint; v_sal jsonb := '[]'::jsonb;
begin
  if coalesce(jsonb_typeof(p_lineas) <> 'array', true) or jsonb_array_length(p_lineas) = 0 then raise exception 'faltan renglones: modelo, sabor y piezas' using errcode = 'P0460'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    select k.id into v_sku from catalogo.sku k where k.modelo_id = (l ->> 'modelo_id')::bigint and k.sabor_id = nullif(l ->> 'sabor_id', '')::bigint;
    if v_sku is null then raise exception 'falta el sabor de un renglon (modelo y sabor del catalogo)' using errcode = 'P0460'; end if;
    select pl.id into v_linea from operacion.pedido_linea pl where pl.pedido_id = p_pedido and pl.modelo_id = (l ->> 'modelo_id')::bigint order by (pl.sku_id = v_sku) desc, pl.id limit 1;
    if v_linea is null then raise exception 'ese modelo no esta en el pedido' using errcode = 'P0460'; end if;
    v_sal := v_sal || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('linea_id', v_linea, 'sku_id', v_sku, 'piezas', (l ->> 'piezas')::int, 'destino', p_destino)));
  end loop;
  return v_sal;
end $$;

alter function agente._ejecutar_ext_base(text, text, jsonb) rename to _ejecutar_ext_base_sin_ventas;

create function agente._ejecutar_ext_base(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_origen text; v_existia boolean; v_res jsonb; v_id bigint; v_folio text; v_cli bigint; v_credito jsonb; v_plazo int; v_paq text; r jsonb; v_i int := 0;
  v_ok jsonb := '[]'::jsonb; v_fallos jsonb := '[]'::jsonb; v_primero bigint; v_ped bigint; v_lin jsonb; v_prev jsonb;
begin
  if p_tipo not in ('pedido_ds', 'envio_lote', 'guias_lote', 'compra_cierre', 'devolucion', 'paquete_perdido') then
    return agente._ejecutar_ext_base_sin_ventas(p_clave_idem, p_tipo, p_args);
  end if;
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  v_origen := agente._origen(p_args);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);

  if p_tipo = 'pedido_ds' then
    v_cli := (p_args ->> 'cliente_id')::bigint;
    if coalesce(p_args ->> 'plazo_dias', '') !~ '^\d{1,3}$' then
      raise exception 'el pedido necesita plazo: pregunta en cuantos dias paga el cliente, o si es de contado' using errcode = 'P0436';
    end if;
    v_plazo := (p_args ->> 'plazo_dias')::int;
    perform operacion.exigir_plazo_pedido(v_plazo);
    -- Contado: sin credito (ds_crear_pedido fija plazo 0). Credito: fecha de pago explicita; el interes de credito lo calcula SQL con la misma regla de la web.
    v_credito := case when v_plazo > 0 then jsonb_build_object('fecha_pago', (negocio.hoy() + v_plazo)::text) end;
    v_res := operacion.ds_crear_pedido(p_clave_idem, v_cli, agente._lineas_sku(p_args -> 'lineas'), coalesce(nullif(p_args ->> 'origen_pedido', ''), 'karen_directo'), null, v_credito, 'cliente', null,
      nullif(p_args ->> 'folio_externo', ''), coalesce((p_args ->> 'envio_cent')::bigint, 0), 0, null, null, v_origen, null, null);
    v_id := (v_res ->> 'pedido_id')::bigint;
    perform operacion.confirmar_pedido(p_clave_idem || ':c', v_id);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'pedido', 'pedido', v_id, v_autor, v_res ->> 'folio');
    v_res := v_res || jsonb_build_object('folio', v_folio, 'estado', 'confirmado', 'plazo_dias', v_plazo);

  elsif p_tipo = 'envio_lote' then
    v_paq := operacion.paqueteria_nombre(p_args ->> 'paqueteria');
    if v_paq is null then raise exception 'elige una paqueteria del catalogo: Castores, Pitic, DHL o Estafeta' using errcode = 'P0471'; end if;
    if coalesce(jsonb_typeof(p_args -> 'folios'), '') <> 'array' or jsonb_array_length(p_args -> 'folios') = 0 then raise exception 'dime los folios de los pedidos que salen' using errcode = 'P0460'; end if;
    v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'envio_lote', 'f', p_args -> 'folios', 'q', v_paq));
    if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
    for r in select * from jsonb_array_elements(p_args -> 'folios') loop
      v_i := v_i + 1;
      begin
        v_ped := agente._pedido_id(r #>> '{}');
        v_primero := coalesce(v_primero, v_ped);
        perform operacion.enviar_pedido(p_clave_idem || ':e' || v_i, v_ped, null, jsonb_build_object('paqueteria', v_paq), null, coalesce((p_args ->> 'aceptar_avisos')::boolean, false));
        v_ok := v_ok || to_jsonb(upper(r #>> '{}'));
      exception when others then
        if sqlstate = '42501' then raise; end if;
        v_fallos := v_fallos || jsonb_build_object('folio', upper(r #>> '{}'), 'error', sqlerrm, 'codigo', sqlstate);
      end;
    end loop;
    if jsonb_array_length(v_ok) = 0 then
      -- Todos tienen avisos sin aceptar: el bot PREGUNTA ("enviar de todos modos?") y reenvia con aceptar_avisos.
      if not exists (select 1 from jsonb_array_elements(v_fallos) f where f ->> 'codigo' <> 'P0427') then
        raise exception 'hay avisos sin aceptar en % pedido(s) (%)', jsonb_array_length(v_fallos), (select string_agg(f ->> 'folio', ', ') from jsonb_array_elements(v_fallos) f) using errcode = 'P0427';
      end if;
      raise exception 'no pude enviar ningun pedido: %', (select string_agg((f ->> 'folio') || ': ' || (f ->> 'error'), '; ') from jsonb_array_elements(v_fallos) f) using errcode = 'P0460';
    end if;
    perform operacion.crear_evento('envio_lote', negocio.hoy(), p_clave_idem, jsonb_build_object('paqueteria', v_paq, 'enviados', jsonb_array_length(v_ok)), v_origen);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'envio_lote', 'pedido', v_primero, v_autor, null);
    v_res := jsonb_build_object('folio', v_folio, 'paqueteria', v_paq, 'enviados', v_ok, 'fallidos', v_fallos, 'folios', v_ok);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);

  elsif p_tipo = 'guias_lote' then
    if coalesce(jsonb_typeof(p_args -> 'guias'), '') <> 'array' or jsonb_array_length(p_args -> 'guias') = 0 then raise exception 'dime las guias con su pedido' using errcode = 'P0460'; end if;
    v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'guias_lote', 'g', p_args -> 'guias', 'q', p_args ->> 'paqueteria'));
    if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
    for r in select * from jsonb_array_elements(p_args -> 'guias') loop
      v_i := v_i + 1;
      begin
        v_ped := agente._pedido_id(r ->> 'pedido_folio');
        v_primero := coalesce(v_primero, v_ped);
        perform operacion.capturar_guia_pedido(p_clave_idem || ':g' || v_i, v_ped, r ->> 'guia', nullif(p_args ->> 'paqueteria', ''));
        v_ok := v_ok || jsonb_build_object('folio', upper(r ->> 'pedido_folio'), 'guia', r ->> 'guia');
      exception when others then
        if sqlstate = '42501' then raise; end if;
        v_fallos := v_fallos || jsonb_build_object('folio', upper(coalesce(r ->> 'pedido_folio', '?')), 'error', sqlerrm);
      end;
    end loop;
    if jsonb_array_length(v_ok) = 0 then raise exception 'no pude capturar ninguna guia: %', v_fallos::text using errcode = 'P0460'; end if;
    perform operacion.crear_evento('guias_lote', negocio.hoy(), p_clave_idem, jsonb_build_object('capturadas', jsonb_array_length(v_ok)), v_origen);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'guias_lote', 'pedido', v_primero, v_autor, null);
    v_res := jsonb_build_object('folio', v_folio, 'capturadas', v_ok, 'fallidas', v_fallos);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);

  elsif p_tipo = 'compra_cierre' then
    v_id := agente._compra_id(p_args ->> 'compra_folio');
    v_res := operacion.cerrar_recepcion_compra(p_clave_idem, v_id, nullif(p_args ->> 'motivo', ''));
    v_folio := agente._guardar_hecho2(p_clave_idem, 'compra_cierre', 'compra', v_id, v_autor, null);
    v_res := v_res || jsonb_build_object('folio', v_folio, 'compra', upper(p_args ->> 'compra_folio'));

  elsif p_tipo = 'devolucion' then
    v_ped := agente._pedido_id(p_args ->> 'pedido_folio');
    v_lin := agente._lineas_de_pedido(v_ped, p_args -> 'lineas', coalesce(nullif(p_args ->> 'destino', ''), 'inventario'));
    v_res := operacion.registrar_devolucion_cliente(p_clave_idem, v_ped, v_lin, p_args ->> 'motivo');
    v_folio := agente._guardar_hecho2(p_clave_idem, 'devolucion', 'pedido', v_ped, v_autor, v_res ->> 'folio');
    v_res := v_res || jsonb_build_object('folio', v_folio, 'pedido', upper(p_args ->> 'pedido_folio'));

  elsif p_tipo = 'paquete_perdido' then
    v_ped := agente._pedido_id(p_args ->> 'pedido_folio');
    if (select estado from operacion.pedido where id = v_ped) <> 'enviado' then raise exception 'el pedido % no ha salido: solo un pedido enviado reporta paquete perdido o danado', upper(p_args ->> 'pedido_folio') using errcode = 'P0428'; end if;
    if coalesce(jsonb_typeof(p_args -> 'lineas'), '') = 'array' and jsonb_array_length(p_args -> 'lineas') > 0 then
      v_lin := agente._lineas_de_pedido(v_ped, p_args -> 'lineas');
    else
      -- Sin renglones: se reporta todo lo que salio en el pedido.
      select coalesce(jsonb_agg(jsonb_build_object('linea_id', q.linea_id, 'sku_id', q.sku_id, 'piezas', q.piezas) order by q.linea_id, q.sku_id), '[]'::jsonb) into v_lin
        from (select s.pedido_linea_id as linea_id, s.sku_id, sum(s.piezas)::int as piezas from operacion.pedido_surtido s join operacion.pedido_linea pl on pl.id = s.pedido_linea_id
               where pl.pedido_id = v_ped group by s.pedido_linea_id, s.sku_id having sum(s.piezas) > 0) q;
    end if;
    v_res := operacion.reportar_paquete_salida(p_clave_idem, v_ped, case when lower(p_args ->> 'incidente') = 'danado' then 'danado' else 'perdido' end, p_args ->> 'detalle', v_lin);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'paquete_perdido', 'pedido', v_ped, v_autor, v_res ->> 'folio');
    v_res := v_res || jsonb_build_object('folio', v_folio, 'pedido', upper(p_args ->> 'pedido_folio'));
  end if;
  return v_res || jsonb_build_object('repetido', v_existia);
end $$;

-- Huella antiduplicado: se agregan los tipos nuevos (misma definicion vigente + 'pedido_ds', 'devolucion' y el origen del pedido).
create or replace function agente._huella(p_tipo text, p_args jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare v_obj jsonb; v_lineas jsonb;
begin
  if p_tipo not in ('gasto', 'aportacion', 'pago_a_socio', 'pago_cliente', 'pago_proveedor', 'pedido_crear', 'compra_crear', 'orden_compra', 'gasto_servicio', 'merma', 'pedido_menudeo', 'pago_pedido_menudeo', 'pedido_ds', 'devolucion') then
    return null;
  end if;
  if jsonb_typeof(p_args -> 'lineas') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_array(l -> 'modelo_id', l -> 'sabor_id', l -> 'piezas') order by l ->> 'modelo_id', l ->> 'sabor_id', l ->> 'piezas'), '[]'::jsonb)
      into v_lineas from jsonb_array_elements(p_args -> 'lineas') l;
  end if;
  v_obj := jsonb_strip_nulls(jsonb_build_object('t', p_tipo,
    'm', coalesce(p_args ->> 'monto_cent', p_args ->> 'monto_usd_cent', p_args ->> 'monto_mxn_cent'),
    'cl', p_args ->> 'cliente_id', 'pv', lower(p_args ->> 'proveedor'), 'so', lower(p_args ->> 'socio'), 'pp', lower(p_args ->> 'pagado_por'),
    'cu', lower(p_args ->> 'cuenta'), 'vi', lower(p_args ->> 'via'), 'ti', lower(p_args ->> 'tipo'), 'ca', lower(p_args ->> 'categoria'),
    'pe', p_args ->> 'pedido_folio', 'sv', lower(p_args ->> 'servicio'), 'dc', p_args ->> 'declara_capital', 'in', lower(p_args ->> 'intencion'), 'mt', lower(p_args ->> 'motivo'), 'fc', p_args ->> 'fecha_compromiso', 'rf', lower(p_args ->> 'referencia'), 'mo', p_args ->> 'modelo_id', 'sa', p_args ->> 'sabor_id', 'pz', p_args ->> 'piezas', 'ln', v_lineas,
    'or', lower(p_args ->> 'origen_pedido')));
  return encode(extensions.digest(v_obj::text, 'sha256'), 'hex');
end $$;

-- Lo que NO se deshace por Telegram (se corrige con un movimiento inverso o desde el software). Los pedidos nuevos (pedido_ds) si: son hechos de tipo 'pedido'.
create or replace function agente.tipos_no_reversibles() returns text[]
language sql immutable set search_path = ''
as $$ select array['pedido_envio', 'pedido_entrega', 'pedido_cancelar', 'compra_aprobar', 'compra_estado', 'compra_recepcion', 'conteo', 'cliente', 'precio', 'acta_propuesta', 'acta_firma',
                   'envio_lote', 'guias_lote', 'compra_cierre', 'devolucion', 'paquete_perdido'] $$;

-- Espejo SQL de los slots obligatorios de las operaciones nuevas (la fuente es src/dominio/agente/slots.ts).
insert into agente.operacion_slot (operacion, orden, slot, obligatorio, si_slot, si_valor) values
  ('orden_compra', 1, 'proveedor', true, null, null),
  ('orden_compra', 2, 'lineas', true, null, null),
  ('compra_estado', 1, 'folio_compra', true, null, null),
  ('compra_estado', 2, 'estado_compra', true, null, null),
  ('compra_cierre', 1, 'folio_compra', true, null, null),
  ('envio_lote', 1, 'folios', true, null, null),
  ('envio_lote', 2, 'paqueteria', true, null, null),
  ('guias_lote', 1, 'guias', true, null, null),
  ('paquete_perdido', 1, 'pedido_folio', true, null, null),
  ('paquete_perdido', 2, 'incidente', true, null, null),
  ('paquete_perdido', 3, 'detalle', true, null, null);

-- Consultas de ventas: vencimientos (por vencer y vencidos) y pedidos abiertos de un cliente. Cifras de SQL; sin telefonos ni destinatarios.
create function agente.consulta_ventas(p_tipo text, p_cliente bigint default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  if p_tipo = 'vencimientos' then
    v_res := jsonb_build_object('titulo', 'Vencimientos de pedidos a credito', 'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('etiqueta', q.folio || ' ' || q.cliente || ' vence ' || to_char(q.vence, 'DD/MM/YYYY') || case when q.vence < negocio.hoy() then ' (vencido hace ' || (negocio.hoy() - q.vence) || ' dias)' else '' end,
                                          'centavos', q.saldo) order by q.vence, q.folio)
        from (select pe.folio, c.nombre_canonico as cliente, pe.fecha_envio + pe.plazo_dias as vence, operacion.pedido_saldo(pe.id) as saldo
                from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
               where pe.estado = 'enviado' and pe.plazo_dias is not null and operacion.pedido_saldo(pe.id) > 0) q), '[]'::jsonb));
  elsif p_tipo = 'pedidos_cliente' then
    if p_cliente is null then raise exception 'falta el cliente' using errcode = '22023'; end if;
    v_res := jsonb_build_object('titulo', 'Pedidos abiertos de ' || (select nombre_canonico from catalogo.cliente where id = p_cliente), 'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('etiqueta', pe.folio || ' (' || pe.estado || case when pe.plazo_dias is not null and pe.fecha_envio is not null then ', vence ' || to_char(pe.fecha_envio + pe.plazo_dias, 'DD/MM/YYYY') else '' end || ')',
                                          'centavos', operacion.pedido_saldo(pe.id)) order by pe.id)
        from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado in ('borrador', 'confirmado', 'enviado') and (pe.estado <> 'enviado' or operacion.pedido_saldo(pe.id) > 0)), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('etiqueta', 'Por cobrar del cliente', 'centavos', operacion.saldo_cliente(p_cliente))));
  else
    raise exception 'consulta desconocida' using errcode = '22023';
  end if;
  return v_res;
end $$;

revoke all on function agente._lineas_de_pedido(bigint, jsonb, text) from public, anon, authenticated, servidor;
revoke all on function agente._ejecutar_ext_base(text, text, jsonb), agente._ejecutar_ext_base_sin_ventas(text, text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente._huella(text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente.tipos_no_reversibles() from public, anon, authenticated;
grant execute on function agente.tipos_no_reversibles() to servidor;
revoke all on function agente.consulta_ventas(text, bigint) from public, anon, authenticated;
grant execute on function agente.consulta_ventas(text, bigint) to servidor;
