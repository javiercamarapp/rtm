-- Lane telegram-agente (revision de seguridad): la base ya no confia en el campo `autor` del JSON.
-- ADITIVA: solo funciones y columnas del propio esquema `agente`; no toca tablas ni funciones de negocio.
--
-- ALTO-1  El autor de una escritura se verifica en SQL: debe existir en agente.miembro como persona con rol 'socio' y activo, y el `telegram_user_id`
--         que manda TypeScript (el del remitente ya verificado por el webhook) debe ser el de esa persona. La firma del acta ademas exige un boton
--         consumido por ese mismo socio. Los ayudantes internos (prefijo _) quedan sin EXECUTE para el rol servidor.
-- MEDIO-1 agente.deshacer recibe y verifica al solicitante, lo usa como actor y deja `deshecho_por`.
--         Politica de /deshacer con folio explicito: ver agente._puede_deshacer.
-- MEDIO-2 La vista previa devuelve el hash del efecto que calculo el servidor; la ejecucion recalcula el efecto real y aborta (P0462) si difiere.
-- B6      alter default privileges ... revoke execute ... from public en el esquema agente (ver la prueba pgTAP 031 sobre su alcance real).

-- ------------------------------------------------------------------ columnas nuevas
alter table agente.hecho add column deshecho_por text check (deshecho_por in ('angelo', 'javier'));
alter table agente.tg_token add column usado_por bigint;

-- ------------------------------------------------------------------ autor verificado
create or replace function agente._autor(p_args jsonb) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v text := lower(coalesce(p_args ->> 'autor', '')); v_tid bigint;
begin
  if v not in ('angelo', 'javier') then raise exception 'falta quien mando la indicacion (solo un socio registra dinero por Telegram)' using errcode = 'P0460'; end if;
  begin
    v_tid := (p_args ->> 'telegram_user_id')::bigint;
  exception when others then
    v_tid := null;
  end;
  if v_tid is null then raise exception 'falta el remitente verificado de Telegram: no se registra nada sin saber quien lo mando' using errcode = 'P0460'; end if;
  if not exists (select 1 from agente.miembro m where m.telegram_user_id = v_tid and m.persona = v and m.rol = 'socio' and m.activo) then
    raise exception 'permiso denegado: el remitente no es el socio indicado' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function agente._actuar(p_args jsonb) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_autor text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._autor(p_args);
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_autor, true);
  return v_autor;
end $$;

-- ------------------------------------------------------------------ boton consumido: quien lo pulso queda registrado
drop function agente.token_consumir(text, text, bigint, timestamptz);
create function agente.token_consumir(p_token text, p_rol text, p_chat bigint, p_ahora timestamptz, p_usuario bigint default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare t agente.tg_token;
begin
  perform notificacion.exigir_sistema();
  select * into t from agente.tg_token where token = p_token for update;
  if not found then return jsonb_build_object('estado', 'invalido'); end if;
  -- Quien pulsa debe ser un miembro activo cuyo rol sea el que dice el llamador.
  if p_usuario is not null and not exists (select 1 from agente.miembro m where m.telegram_user_id = p_usuario and m.activo and m.rol = p_rol) then
    return jsonb_build_object('estado', 'no_autorizado');
  end if;
  if not (p_rol = any (t.roles_permitidos)) then return jsonb_build_object('estado', 'no_autorizado'); end if;
  if t.chat_id <> p_chat then return jsonb_build_object('estado', 'chat_distinto'); end if;
  if p_ahora >= t.caduca_at then return jsonb_build_object('estado', 'caducado'); end if;
  if t.usado_at is not null then return jsonb_build_object('estado', 'usado'); end if;
  update agente.tg_token set usado_at = p_ahora, usado_por = p_usuario where token = p_token;
  if t.grupo_exclusivo is not null then update agente.tg_token set usado_at = coalesce(usado_at, p_ahora) where grupo_exclusivo = t.grupo_exclusivo; end if;
  return jsonb_build_object('estado', 'ok', 'accion', t.accion, 'payload', t.payload);
end $$;

-- ------------------------------------------------------------------ efecto del servidor (para el hash de la vista previa)
create function agente._efecto(p_tipo text, p_res jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_id bigint; v_efecto jsonb := '{}'::jsonb;
begin
  if p_tipo = 'pedido_crear' then
    v_id := (p_res ->> 'pedido_id')::bigint;
    v_efecto := jsonb_build_object(
      'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico || ' ' || sa.nombre_canonico, 'piezas', l.piezas_pedidas, 'precio_cent', l.precio_cent, 'importe_cent', l.piezas_pedidas::bigint * l.precio_cent) order by l.id), '[]'::jsonb)
                   from operacion.pedido_linea l join catalogo.modelo m on m.id = l.modelo_id join catalogo.sku k on k.id = l.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where l.pedido_id = v_id),
      'mercancia_cent', (select coalesce(sum(l.piezas_pedidas::bigint * l.precio_cent), 0) from operacion.pedido_linea l where l.pedido_id = v_id),
      'envio_cent', (select envio_cent from operacion.pedido where id = v_id),
      'avisos', (select coalesce(jsonb_agg(a.detalle order by a.id), '[]'::jsonb) from operacion.pedido_aviso a where a.pedido_id = v_id));
  elsif p_tipo in ('compra_crear', 'orden_compra') then
    v_id := (p_res ->> 'compra_id')::bigint;
    v_efecto := (select jsonb_build_object('mercancia_cent', c.mercancia_cent, 'guia_cent', c.guia_cent, 'total_cent', c.total_cent,
      'lineas', (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico || ' ' || sa.nombre_canonico, 'piezas', cl.piezas_pagadas, 'precio_cent', cl.costo_unit_cent, 'importe_cent', cl.piezas_pagadas::bigint * cl.costo_unit_cent) order by cl.id), '[]'::jsonb)
                   from operacion.compra_linea cl join catalogo.modelo m on m.id = cl.modelo_id join catalogo.sku k on k.id = cl.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where cl.compra_id = c.id))
      from operacion.compra c where c.id = v_id);
  elsif p_tipo = 'gasto_servicio' then
    v_efecto := jsonb_build_object('monto_cent', p_res -> 'monto_cent', 'tc_micro', p_res -> 'tc_micro', 'usd_cent', p_res -> 'usd_cent');
  elsif p_tipo = 'compra_recepcion' then
    v_efecto := jsonb_build_object('diferencias', coalesce(p_res -> 'diferencias', '[]'::jsonb), 'estado', p_res -> 'estado');
  end if;
  return coalesce(v_efecto, '{}'::jsonb);
end $$;

create function agente._hash_efecto(p_efecto jsonb) returns text
language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_efecto, '{}'::jsonb)::text, 'UTF8')), 'hex') $$;

-- ------------------------------------------------------------------ puertas de escritura: las funciones anteriores pasan a ser internas y las puertas verifican
alter function agente.ejecutar(text, text, jsonb) rename to _ejecutar_base;
alter function agente.ejecutar_ext(text, text, jsonb) rename to _ejecutar_ext_base;

create function agente.ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_res jsonb; v_existia boolean; v_folio text; v_prov text;
begin
  perform notificacion.exigir_sistema();
  -- La toma de Omar la pide Omar (sin autor socio); las demas indicaciones de dinero las pide un socio verificado.
  if p_tipo not in ('toma_omar', 'devolucion', 'paquete_perdido') then
    v_autor := agente._autor(p_args);
  end if;
  -- El gasto de socio guarda en el evento QUIEN lo mando (el deshacer lo usa para su politica); las demas ramas ya lo hacen con agente._origen.
  if p_tipo = 'gasto' then p_args := p_args || jsonb_build_object('origen', agente._origen(p_args)); end if;

  -- Pago a proveedor con dinero propio de un socio: REEMBOLSO por omision; capital SOLO si el socio lo declaro expresamente (decision del dueno, 13-nov).
  -- La funcion de negocio con el parametro `p_declara_capital` vive en lane/cuadrar-cuentas; mientras no este integrada, la indicacion se rechaza con P0461
  -- (jamas se registra como reembolso algo que el socio declaro como capital).
  if p_tipo = 'pago_proveedor' and coalesce((p_args ->> 'declara_capital')::boolean, false) then
    if nullif(p_args ->> 'cliente_id', '') is not null or lower(coalesce(p_args ->> 'pagado_por', '')) not in ('angelo', 'javier') then
      raise exception 'declarar capital solo aplica cuando un socio paga al proveedor con su dinero' using errcode = 'P0460';
    end if;
    if to_regprocedure('operacion.pago_proveedor_de_socio(text,text,bigint,text,text,date,text,text,boolean)') is null then
      raise exception 'declarar ese pago como capital depende de la integracion de cuadrar cuentas: registralo como reembolso o hazlo en el software' using errcode = 'P0461';
    end if;
    perform set_config('rtm.canal', 'telegram', true);
    v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
    v_prov := initcap(p_args ->> 'proveedor');
    if v_prov not in ('Isaac', 'Karen') then raise exception 'proveedor desconocido' using errcode = 'P0460'; end if;
    execute 'select operacion.pago_proveedor_de_socio($1, $2, $3, $4, $5, $6, $7, $8, true)'
      into v_res using p_clave_idem, v_prov, (p_args ->> 'monto_cent')::bigint, initcap(p_args ->> 'pagado_por'), 'auto', null::date, p_args ->> 'nota', agente._origen(p_args);
    v_folio := agente._guardar_hecho(p_clave_idem, 'pago_proveedor', null, null, v_autor);
    return v_res || jsonb_build_object('folio', v_folio, 'repetido', v_existia);
  end if;

  return agente._ejecutar_base(p_clave_idem, p_tipo, p_args);
end $$;

create function agente.ejecutar_ext(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_res jsonb; v_hash text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._autor(p_args);
  if p_tipo = 'acta_firma' then
    -- La firma es personal: exige un boton "Si, estoy seguro" consumido por ESE socio, de ESTA indicacion (misma clave), y no basta el JSON.
    if not exists (select 1 from agente.tg_token t
        where t.token = p_args ->> 'token_boton' and t.accion = 'confirmar_refuerzo' and t.usado_at is not null
          and t.usado_por = (p_args ->> 'telegram_user_id')::bigint and t.payload ->> 'claveIdem' = p_clave_idem) then
      raise exception 'la firma del acta es personal: falta tu confirmacion con el boton, dada desde tu propio Telegram' using errcode = '42501';
    end if;
  end if;
  v_res := agente._ejecutar_ext_base(p_clave_idem, p_tipo, p_args);
  -- El socio confirmo UN efecto (el de la vista previa). Si el real cambio entre simular y ejecutar (precio, tipo de cambio, existencia), se aborta todo.
  if nullif(p_args ->> 'efecto_hash', '') is not null and not coalesce((v_res ->> 'repetido')::boolean, false) then
    v_hash := agente._hash_efecto(agente._efecto(p_tipo, v_res));
    if v_hash <> p_args ->> 'efecto_hash' then
      raise exception 'el efecto cambio desde la vista previa (precio, tipo de cambio o existencia): revisa el nuevo resumen y confirma otra vez' using errcode = 'P0462';
    end if;
  end if;
  return v_res;
end $$;

-- ------------------------------------------------------------------ vista previa con hash
create or replace function agente.simular(p_hub text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_efecto jsonb := '{}'::jsonb; v_rojas jsonb; v_txt text; v_clave text := 'sim:' || clock_timestamp()::text || ':' || p_tipo;
begin
  perform notificacion.exigir_sistema();
  perform agente._actuar(p_args);
  begin
    -- Llama a las funciones base (sin el candado de la firma ni el hash): la simulacion nunca firma, y se revierte siempre.
    if p_hub = 'ejecutar_ext' then v_res := agente._ejecutar_ext_base(v_clave, p_tipo, p_args);
    elsif p_hub = 'ejecutar' then v_res := agente._ejecutar_base(v_clave, p_tipo, p_args);
    else raise exception 'hub desconocido' using errcode = 'P0460'; end if;
    v_efecto := agente._efecto(p_tipo, v_res);
    perform contabilidad.asentar_pendientes();
    select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'via_a_cent', c.via_a_cent, 'via_b_cent', c.via_b_cent)), '[]'::jsonb) into v_rojas from contabilidad.comprobaciones() c where not c.ok and c.bloqueante;
    raise exception 'simulacion' using errcode = 'P0498', detail = jsonb_build_object('resultado', v_res - 'repetido', 'efecto', v_efecto, 'efecto_hash', agente._hash_efecto(v_efecto),
      'cuadra', jsonb_array_length(v_rojas) = 0, 'comprobaciones_rojas', v_rojas)::text;
  exception when sqlstate 'P0498' then
    get stacked diagnostics v_txt = pg_exception_detail;
    return v_txt::jsonb;
  end;
end $$;

-- ------------------------------------------------------------------ deshacer con solicitante verificado
-- POLITICA (MEDIO-1). Quien pide deshacer es un socio verificado (agente._autor) y es el actor de la anulacion; el hecho queda con `deshecho_por`.
--   * Un socio puede deshacer SUS hechos cuando quiera (la base decide si la anulacion es posible).
--   * Un socio puede deshacer un hecho DEL OTRO socio solo dentro de los 10 minutos siguientes (corregir un error visible en el grupo, como el boton Deshacer);
--     pasado ese tiempo solo lo deshace quien lo registro, o se corrige en el software.
--   * Una toma de Omar (T-) la resuelve cualquier socio. Un gasto G- solo si lo capturo Telegram, con la misma regla de los hechos.
create function agente._puede_deshacer(p_solicitante text, p_autor_hecho text, p_creado_at timestamptz) returns boolean
language sql stable set search_path = ''
as $$ select p_autor_hecho = p_solicitante or p_creado_at > now() - interval '10 minutes' $$;

drop function agente.deshacer(text, text);
create function agente.deshacer(p_clave_idem text, p_folio text, p_autor text, p_telegram_user_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_gasto bigint; v_aport bigint; v_toma bigint; v_estado text; v_res jsonb; h agente.hecho; v_sol text; v_orig text; v_hora timestamptz;
begin
  perform notificacion.exigir_sistema();
  v_sol := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_sol, true);
  select * into h from agente.hecho where folio = p_folio;
  if found then
    if h.deshecho_at is not null then raise exception 'el folio % ya estaba deshecho', p_folio using errcode = 'P0428'; end if;
    if not agente._puede_deshacer(v_sol, h.autor, h.creado_at) then
      raise exception 'el folio % lo registro %: solo el puede deshacerlo pasados 10 minutos', p_folio, initcap(h.autor) using errcode = 'P0460';
    end if;
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
    update agente.hecho set deshecho_at = now(), deshecho_por = v_sol where folio = p_folio;
    return v_res || jsonb_build_object('folio', p_folio, 'deshecho', true, 'deshecho_por', v_sol);
  end if;
  select g.id, e.mensaje_origen, e.hora into v_gasto, v_orig, v_hora from operacion.gasto g join operacion.evento e on e.id = g.evento_id where g.folio = p_folio and e.canal = 'telegram';
  if v_gasto is not null then
    if not agente._puede_deshacer(v_sol, coalesce(substring(v_orig from '^telegram:([a-z]+):'), ''), v_hora) then
      raise exception 'el gasto % lo registro otro socio: solo quien lo registro puede deshacerlo pasados 10 minutos', p_folio using errcode = 'P0460';
    end if;
    select id into v_aport from operacion.aportacion_socio where ref_tipo = 'gasto' and ref_id = v_gasto and reversa_de is null;
    v_res := operacion.anular_movimiento_socio(p_clave_idem, 'aportacion', v_aport, 'Deshecho desde Telegram');
    insert into agente.evento (tipo, miembro, detalle) values ('deshacer', p_telegram_user_id, left('deshizo ' || v_sol || ' el gasto ' || p_folio, 300));
    return v_res || jsonb_build_object('folio', p_folio, 'deshecho_por', v_sol);
  end if;
  select id, estado into v_toma, v_estado from operacion.toma_omar where folio = p_folio;
  if v_toma is not null then
    v_res := operacion.resolver_toma_omar(p_clave_idem, v_toma, case v_estado when 'pendiente' then 'rechazar' else 'deshacer' end);
    insert into agente.evento (tipo, miembro, detalle) values ('deshacer', p_telegram_user_id, left('deshizo ' || v_sol || ' la toma ' || p_folio, 300));
    return v_res;
  end if;
  raise exception 'folio desconocido o que aun no se deshace por Telegram' using errcode = 'P0460';
end $$;

-- ------------------------------------------------------------------ privilegios
-- Todo lo publico del esquema agente es del rol servidor; los ayudantes internos (prefijo _) no los llama nadie desde fuera.
revoke execute on all functions in schema agente from public, anon, authenticated;
grant execute on all functions in schema agente to servidor;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from servidor', f.firma);
  end loop;
end $$;
alter default privileges in schema agente revoke execute on functions from public, anon, authenticated;
