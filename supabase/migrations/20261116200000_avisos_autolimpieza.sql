-- Autolimpieza de avisos (pedido del dueño, 14-nov): "que se me borren las notificaciones una vez se solucionen o se atiendan los temas; que unicamente sigan si sigue eso".
-- ADITIVA: agrega columnas de motivo, una funcion que dice si la causa de un aviso sigue vigente, un barrido idempotente y ajusta la bandeja para mostrar solo lo vigente.
-- Nada se borra: el aviso se marca resuelto con motivo, referencia y fecha (soft-resolve) y se consulta en "Resueltos recientes". Si la causa reaparece, el aviso se reabre.
-- El modelo de IA no interviene: toda condicion es SQL sobre el estado actual.

alter table operacion.aviso add column resuelto_motivo text;
alter table operacion.aviso add column resuelto_ref text;
alter table operacion.aviso add column reabierto_n int not null default 0;
alter table operacion.aviso add column reabierto_at timestamptz;

insert into catalogo.config (clave, valor, vigente_desde) values
  ('aviso_info_retiro_dias', '7', '2026-11-16'),
  ('aviso_resueltos_recientes_dias', '14', '2026-11-16'),
  ('aviso_excepcion_cierra_al_cobrar', '1', '2026-11-16');

-- ---------------------------------------------------------------------------
-- La condicion vigente de un aviso: la misma regla que lo genero, evaluada sobre el estado de hoy.
--   clase 'condicion'  : tiene regla; vigente true = sigue la causa, false = ya no (motivo y ref dicen que la resolvio).
--   clase 'informativo': es un hecho sin causa que persista (recibido, enviado, firmado...): se retira al leerse por todos o a los N dias.
--   clase 'externo'    : pide accion o es una alarma sin regla propia aqui (la cierra su emisor o una persona): el barrido no lo toca.
-- ---------------------------------------------------------------------------
create function notificacion.condicion(p_a operacion.aviso, out clase text, out vigente boolean, out motivo text, out ref text) returns record
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_req boolean; v_e bigint := p_a.entidad_id; v_x bigint; v_t text; v_cierra boolean; v_ubic text; v_cont_at timestamptz; v_ped operacion.pedido;
begin
  clase := 'externo'; vigente := null; motivo := null; ref := null;
  select t.requiere_accion into v_req from notificacion.tipo t where t.codigo = p_a.codigo;

  if p_a.codigo = 'conteo_con_diferencia' then
    clase := 'condicion';
    select c.ubicacion, c.contado_at into v_ubic, v_cont_at from operacion.conteo c where c.id = v_e;
    -- Sigue mientras haya una diferencia sin explicar que ningun conteo posterior de esa ubicacion haya confirmado (cuadre en cero para ese SKU).
    vigente := exists (select 1 from operacion.conteo_linea l
                        where l.conteo_id = v_e and l.diferencia <> 0 and l.explicacion_tipo is null
                          and not exists (select 1 from operacion.conteo c2 join operacion.conteo_linea l2 on l2.conteo_id = c2.id
                                           where c2.ubicacion = v_ubic and c2.estado = 'cerrado' and c2.contado_at > v_cont_at and l2.sku_id = l.sku_id and l2.diferencia = 0));
    if not vigente then
      select max(c2.id) into v_x from operacion.conteo c2 where c2.ubicacion = v_ubic and c2.estado = 'cerrado' and c2.contado_at > v_cont_at;
      motivo := 'las diferencias quedaron explicadas o un conteo posterior las confirmo';
      ref := 'conteo:' || coalesce(v_x, v_e);
    end if;

  elsif p_a.codigo = 'pedido_enviado_con_excepcion' then
    clase := 'condicion';
    select * into v_ped from operacion.pedido where id = v_e;
    v_cierra := coalesce(catalogo.config_num('aviso_excepcion_cierra_al_cobrar') = 1, true);
    if v_ped.id is null or v_ped.estado <> 'enviado' then
      vigente := false; motivo := 'el pedido ya no esta enviado (anulado o cancelado)'; ref := 'pedido:' || v_e;
    else
      -- El precio vigente de cada renglon es el de la ultima nota (la correccion lo cambia), si no el del pedido.
      vigente := exists (
        select 1 from operacion.pedido_aviso pa join operacion.pedido_linea l on l.id = pa.pedido_linea_id
         where pa.pedido_id = v_e and pa.codigo in ('precio_distinto_tabulador', 'venta_bajo_costo', 'sin_precio_catalogo')
           and case pa.codigo
                 when 'precio_distinto_tabulador' then coalesce((select (n.ajustes -> 'precios' ->> l.id::text)::bigint from operacion.nota n where n.pedido_id = v_e order by n.id desc limit 1), l.precio_cent) is distinct from l.precio_tabulador_cent
                 when 'venta_bajo_costo' then coalesce((select (n.ajustes -> 'precios' ->> l.id::text)::bigint from operacion.nota n where n.pedido_id = v_e order by n.id desc limit 1), l.precio_cent) <= coalesce(l.costo_unit_cent, 0)
                 else l.precio_tabulador_cent is null end);
      if vigente and v_cierra and operacion.pedido_saldo(v_e) <= 0 then
        vigente := false; motivo := 'el pedido ya esta cobrado por completo'; ref := 'pago_aplicacion:' || coalesce((select max(pa2.id) from operacion.pago_aplicacion pa2 where pa2.pedido_id = v_e), 0);
      elsif not vigente then
        motivo := 'la nota se corrigio y el precio ya no difiere del tabulador ni queda bajo costo';
        ref := 'nota:' || coalesce((select max(n.id) from operacion.nota n where n.pedido_id = v_e), 0);
      end if;
    end if;

  elsif p_a.codigo = 'pieza_no_llego_saldo' then
    clase := 'condicion';
    select * into v_ped from operacion.pedido where id = v_e;
    vigente := v_ped.id is not null and operacion.saldo_cliente(v_ped.cliente_id) < 0;
    if not vigente then motivo := 'el saldo a favor del cliente ya se aplico o se devolvio'; ref := 'pedido:' || v_e; end if;

  elsif p_a.codigo = 'paquete_por_empacar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pedido p where p.id = v_e and p.estado = 'confirmado' and p.empacado_at is null);
    if not vigente then motivo := 'el pedido ya se empaco, se envio o se cancelo'; ref := 'pedido:' || v_e; end if;

  elsif p_a.codigo = 'sabor_faltante_antes_empacar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pedido p where p.id = v_e and p.estado = 'confirmado' and p.empacado_at is null)
      and exists (select 1 from operacion.pedido_linea l where l.pedido_id = v_e
                    and l.piezas_pedidas > coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = l.sku_id and u.ubicacion = 'bodega_omar'), 0));
    if not vigente then motivo := 'ya hay existencia del sabor o el pedido ya no espera empaque'; ref := 'pedido:' || v_e; end if;

  elsif p_a.codigo = 'llegada_pendiente_confirmar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.compra c where c.id = v_e and c.estado = 'llego_merida');
    if not vigente then motivo := 'la recepcion de la compra ya se confirmo'; ref := 'compra:' || v_e; end if;

  elsif p_a.codigo = 'diferencia_recepcion_abierta' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.compra_diferencia d where d.id = v_e)
      and not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = v_e and x.cancela_a is null
                        and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id));
    if not vigente then
      motivo := 'la diferencia de recepcion ya tiene responsable asignado';
      ref := 'diferencia_asignacion:' || coalesce((select max(x.id) from operacion.diferencia_asignacion x where x.diferencia_id = v_e), 0);
    end if;

  elsif p_a.codigo = 'pago_sin_identificar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pago p where p.id = v_e and p.identificacion = 'sin_identificar')
      and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = v_e);
    if not vigente then motivo := 'el pago ya se identifico'; ref := 'pago_identificacion:' || coalesce((select i.id from operacion.pago_identificacion i where i.pago_id = v_e), 0); end if;

  elsif p_a.codigo in ('cascada_lista_firma', 'utilidad_mayor_que_efectivo') then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.cierre_reparto c where c.id = v_e)
      and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = v_e)
      and (select count(distinct f.socio_id) from operacion.cierre_reparto_firma f where f.cierre_id = v_e) < 2;
    if not vigente then
      if exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = v_e) then
        motivo := 'el cierre se anulo'; ref := 'cierre_reparto_anulacion:' || (select max(a.id) from operacion.cierre_reparto_anulacion a where a.cierre_id = v_e);
      else
        motivo := 'el cierre ya lo firmaron los dos socios'; ref := 'cierre_reparto_firma:' || coalesce((select max(f.id) from operacion.cierre_reparto_firma f where f.cierre_id = v_e), 0);
      end if;
    end if;

  elsif p_a.codigo = 'retiro_capital_por_confirmar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.retiro_capital r where r.id = v_e) and not exists (select 1 from operacion.retiro_capital_confirmacion c where c.retiro_id = v_e);
    if not vigente then motivo := 'el retiro de capital ya lo confirmo el otro socio'; ref := 'retiro_capital_confirmacion:' || coalesce((select c.id from operacion.retiro_capital_confirmacion c where c.retiro_id = v_e), 0); end if;

  elsif p_a.codigo = 'toma_pendiente' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.toma_omar t where t.id = v_e and t.estado = 'pendiente');
    if not vigente then motivo := 'la toma ya se autorizo, se rechazo o caduco'; ref := 'toma_omar:' || v_e; end if;

  elsif p_a.codigo = 'toma_sin_precio' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.toma_omar t where t.id = v_e and t.precio_cent is null and t.estado in ('pendiente', 'autorizada'));
    if not vigente then motivo := 'la toma ya tiene precio o dejo de estar vigente'; ref := 'toma_omar:' || v_e; end if;

  elsif p_a.codigo = 'cobranza_vence_manana' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pedido p where p.id = v_e and p.estado = 'enviado') and operacion.pedido_saldo(v_e) > 0;
    if not vigente then motivo := 'la cuenta por cobrar ya esta saldada'; ref := 'pago_aplicacion:' || coalesce((select max(pa.id) from operacion.pago_aplicacion pa where pa.pedido_id = v_e), 0); end if;

  elsif p_a.codigo = 'fondos_en_poder_socio' then
    clase := 'condicion';
    vigente := coalesce(operacion.dias_fondos_en_poder(v_e) > coalesce(catalogo.config_num('fondos_alerta_dias'), 7), false);
    if not vigente then motivo := 'los fondos de la sociedad ya no pasan del plazo en poder del socio'; ref := 'socio:' || v_e; end if;

  elsif p_a.codigo = 'paquete_incidente_reportado' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.paquete_incidente i where i.id = v_e) and not operacion.paquete_incidente_resuelto(v_e);
    if not vigente then motivo := 'el incidente del paquete ya tiene responsable y efecto registrados'; ref := 'paquete_incidente:' || v_e; end if;

  elsif p_a.codigo = 'saldo_negativo_karen' then
    clase := 'condicion';
    vigente := operacion.saldo_proveedor(v_e) < 0;
    if not vigente then motivo := 'el saldo con la proveedora ya no es negativo'; ref := 'proveedor:' || v_e; end if;

  elsif p_a.codigo = 'tarea_falla' then
    clase := 'condicion';
    v_t := p_a.payload ->> 'tarea';
    vigente := coalesce((select e.estado = 'error' from notificacion.ejecucion e where e.tarea = v_t and e.estado <> 'en_curso' order by e.inicio desc, e.id desc limit 1), false);
    if not vigente then
      motivo := 'la tarea volvio a correr sin error';
      ref := 'ejecucion:' || coalesce((select e.id from notificacion.ejecucion e where e.tarea = v_t and e.estado = 'ok' order by e.inicio desc, e.id desc limit 1), 0);
    end if;

  elsif p_a.codigo = 'telegram_entrega_muerta' then
    clase := 'condicion';
    -- Sigue mientras al mismo destino no haya salido un mensaje despues de la entrega muerta.
    vigente := exists (select 1 from notificacion.entrega m where m.id = v_e and m.estado = 'muerta')
      and not exists (select 1 from notificacion.entrega m join notificacion.entrega o on o.destino_clave = m.destino_clave and o.canal = m.canal
                       where m.id = v_e and o.estado in ('enviada', 'entregada') and coalesce(o.enviada_at, o.creada_at) > m.creada_at);
    if not vigente then
      motivo := 'Telegram volvio a entregar al mismo destino';
      ref := 'entrega:' || coalesce((select o.id from notificacion.entrega m join notificacion.entrega o on o.destino_clave = m.destino_clave and o.canal = m.canal
                                      where m.id = v_e and o.estado in ('enviada', 'entregada') order by o.id desc limit 1), v_e);
    end if;

  elsif p_a.codigo in ('comprobacion_dinero_falla', 'cuenta_proveedor_no_cuadra') then
    clase := 'externo'; -- lo resuelve notificacion.evaluar() (comprobaciones() es costoso por aviso)

  elsif p_a.codigo = 'pago_posible_duplicado' or coalesce(v_req, true) then
    clase := 'externo'; -- pide una decision de una persona y no tiene entidad: se cierra con su boton

  else
    clase := 'informativo';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Barrido idempotente. p_aplicar = false solo informa (lo usa `--verificar` del script).
-- ---------------------------------------------------------------------------
create function notificacion.depurar(p_aplicar boolean default true) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a operacion.aviso; k record; v_dias_info int := coalesce(catalogo.config_num('aviso_info_retiro_dias')::int, 7); v_dias_rec int := coalesce(catalogo.config_num('aviso_resueltos_recientes_dias')::int, 14);
  v_res int := 0; v_ret int := 0; v_reab int := 0; v_det jsonb := '[]'::jsonb; v_leido boolean; v_viejo boolean; v_motivo text;
begin
  for a in select * from operacion.aviso where estado = 'abierta' order by id loop
    select * into k from notificacion.condicion(a);
    if k.clase = 'condicion' and k.vigente is false then
      v_motivo := 'resuelto solo: la causa desaparecio (' || k.motivo || ')';
      if p_aplicar then
        update operacion.aviso set estado = 'resuelta', resuelto_at = now(), actualizado_at = now(), resuelta_canal = 'sistema', resuelto_motivo = v_motivo, resuelto_ref = k.ref
         where id = a.id and estado = 'abierta';
      end if;
      v_res := v_res + 1;
      v_det := v_det || jsonb_build_array(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo, 'accion', 'resolver', 'motivo', v_motivo, 'ref', k.ref));
    elsif k.clase = 'informativo' then
      v_leido := exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id) and not exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.leida_at is null);
      v_viejo := a.severidad <> 'C' and a.creado_at <= now() - make_interval(days => v_dias_info);
      if v_leido or v_viejo then
        v_motivo := case when v_leido then 'retirado: lo leyeron todos los destinatarios' else 'retirado: informativo con mas de ' || v_dias_info || ' dias' end;
        if p_aplicar then
          update operacion.aviso set estado = 'caducada', resuelto_at = now(), actualizado_at = now(), resuelta_canal = 'sistema', resuelto_motivo = v_motivo
           where id = a.id and estado = 'abierta';
        end if;
        v_ret := v_ret + 1;
        v_det := v_det || jsonb_build_array(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo, 'accion', 'retirar', 'motivo', v_motivo, 'ref', null));
      end if;
    end if;
  end loop;
  -- Si la causa reaparecio en un aviso que este mismo barrido cerro, se reabre (el que no re-emite nada tambien vuelve).
  for a in select * from operacion.aviso where estado = 'resuelta' and resuelta_canal = 'sistema' and resuelto_at > now() - make_interval(days => v_dias_rec) order by id loop
    select * into k from notificacion.condicion(a);
    if k.clase = 'condicion' and k.vigente is true then
      if p_aplicar then perform notificacion.reabrir(a.id); end if;
      v_reab := v_reab + 1;
      v_det := v_det || jsonb_build_array(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo, 'accion', 'reabrir', 'motivo', 'la causa reaparecio', 'ref', null));
    end if;
  end loop;
  return jsonb_build_object('aplicado', p_aplicar, 'resueltos', v_res, 'retirados', v_ret, 'reabiertos', v_reab, 'detalle', v_det);
end $$;

-- Deshace una resolucion automatica (nunca toca lo resuelto o descartado por una persona).
create function notificacion.reabrir(p_aviso bigint) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update operacion.aviso set estado = 'abierta', resuelto_at = null, resuelto_motivo = null, resuelto_ref = null, resuelta_canal = null, reabierto_n = reabierto_n + 1, reabierto_at = now(), actualizado_at = now()
   where id = p_aviso and estado in ('resuelta', 'caducada') and resuelta_canal = 'sistema';
  get diagnostics v_n = row_count;
  if v_n = 1 then
    update notificacion.destinatario set leida_at = null where aviso_id = p_aviso;
  end if;
  return v_n = 1;
end $$;

-- La emision de un asunto que ya existe (misma huella) lo reabre si lo cerro el sistema: no se duplica ni se pierde.
create or replace function operacion.avisar(p_codigo text, p_nt text, p_clave text, p_severidad text, p_titulo text, p_entidad_tipo text, p_entidad_id bigint,
                                            p_payload jsonb default '{}'::jsonb, p_duenio_socio_id bigint default null, p_evento_id bigint default null,
                                            p_solo_otro boolean default false, p_canales text[] default array['software']) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_nuevo boolean; t notificacion.tipo; v_caduca timestamptz; v_canales text[]; v_sev text; v_estado_prev text; v_canal_prev text;
begin
  select * into t from notificacion.tipo where codigo = p_codigo;
  if not found then raise exception 'tipo de notificacion desconocido: %', p_codigo using errcode = '22023'; end if;
  if not t.activo then return null; end if;
  if t.campos_permitidos is not null and exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (t.campos_permitidos)) then
    raise exception 'el payload de % lleva claves no permitidas', p_codigo using errcode = '22023';
  end if;
  v_sev := case when p_severidad in ('C', 'I', 'F') then p_severidad else t.severidad end;
  v_caduca := case when v_sev = 'C' or t.ttl_horas is null then null else now() + make_interval(hours => t.ttl_horas) end;
  v_canales := array['software'] || case t.canal when 'ST' then array['telegram'] when 'TG' then array['telegram'] when 'STC' then array['telegram', 'correo'] when 'SC' then array['correo'] when 'CO' then array['correo'] else array[]::text[] end;
  select a.estado, a.resuelta_canal into v_estado_prev, v_canal_prev from operacion.aviso a where a.clave_dedupe = p_clave;
  insert into operacion.aviso (codigo, nt, clave_dedupe, severidad, titulo, entidad_tipo, entidad_id, payload, duenio_socio_id, actor_socio_id, solo_otro, canales_previstos, evento_id, caduca_at)
  values (p_codigo, coalesce(p_nt, t.nt), p_clave, v_sev, p_titulo, p_entidad_tipo, p_entidad_id, p_payload, p_duenio_socio_id, operacion.actor_socio(), p_solo_otro, v_canales, p_evento_id, v_caduca)
  on conflict (clave_dedupe) do update set conteo = operacion.aviso.conteo + 1, actualizado_at = now()
  returning id, (xmax = 0) into v_id, v_nuevo;
  if v_nuevo then
    if t.canal not in ('OM', 'VO') then
      insert into notificacion.destinatario (aviso_id, usuario_id)
        select v_id, u.id from seguridad.usuario u where u.rol = 'socio' and u.activo on conflict do nothing;
    end if;
    perform notificacion.crear_entregas(v_id);
  elsif v_estado_prev in ('resuelta', 'caducada') and v_canal_prev = 'sistema' then
    perform notificacion.reabrir(v_id);
  end if;
  return v_id;
end $$;

-- El cierre por la operacion que atendio el tema (resolver_avisos) tambien deja motivo.
create or replace function operacion.resolver_avisos(p_codigo text, p_entidad_tipo text, p_entidad_id bigint) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  update operacion.aviso set estado = 'resuelta', resuelto_at = now(), actualizado_at = now(), resuelto_por = auth.uid(),
         resuelto_motivo = 'resuelto solo: la causa desaparecio (la operacion que lo atendio lo cerro)'
   where codigo = p_codigo and entidad_tipo = p_entidad_tipo and entidad_id = p_entidad_id and estado = 'abierta';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- El latido (reloj local o programado) tambien barre.
create or replace function notificacion.latido(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_cad int; v_ev jsonb; v_resp int; v_dep jsonb;
begin
  perform notificacion.exigir_sistema();
  v_cad := notificacion.caducar_vencidas();
  v_ev := notificacion.evaluar(p_hoy);
  v_dep := notificacion.depurar(true);
  v_resp := notificacion.respaldo_correo();
  return jsonb_build_object('caducadas', v_cad, 'evaluacion', v_ev, 'depuracion', v_dep - 'detalle', 'respaldos', v_resp);
end $$;

-- ---------------------------------------------------------------------------
-- Web: la bandeja muestra solo lo vigente. Las cuentas salen de lo vigente; "Resueltos recientes" es una consulta aparte.
-- ---------------------------------------------------------------------------
create or replace function api.contar_no_leidas() returns int
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio(); v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  return (select count(*)::int from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo cross join lateral notificacion.condicion(a) k
           where a.estado = 'abierta' and k.vigente is not false and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
             and not exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null));
end $$;

create or replace function api.mis_notificaciones(p_filtro text default 'todas', p_pagina int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_yo bigint := operacion.actor_socio(); v_uid uuid := auth.uid(); v_tam constant int := 25; v_dias int := coalesce(catalogo.config_num('aviso_resueltos_recientes_dias')::int, 14);
  v_filas jsonb; v_hay boolean; v_resumen jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_filtro not in ('todas', 'sin_leer', 'resueltos') then raise exception 'filtro desconocido' using errcode = '22023'; end if;
  with base as (
    select a.id, a.nt, a.codigo, a.severidad, a.titulo, a.entidad_tipo, a.entidad_id, a.estado, a.conteo, a.creado_at, a.resuelto_at, a.resuelto_motivo, t.requiere_accion, t.botones,
           (k.vigente is not false) as vigente,
           exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null) as leida,
           (select e.estado from notificacion.entrega e where e.notificacion_id = a.id and e.canal = 'telegram' order by e.id desc limit 1) as telegram
      from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo cross join lateral notificacion.condicion(a) k
     where t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
  ), pag as (
    select b.*, row_number() over (order by case when p_filtro = 'resueltos' then extract(epoch from coalesce(b.resuelto_at, b.creado_at))::bigint else b.id end desc, b.id desc) as rn
      from base b
     where case p_filtro when 'resueltos' then b.estado <> 'abierta' and coalesce(b.resuelto_at, b.creado_at) > now() - make_interval(days => v_dias)
                         when 'sin_leer' then b.estado = 'abierta' and b.vigente and not b.leida
                         else b.estado = 'abierta' and b.vigente end
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nt', nt, 'codigo', codigo, 'severidad', severidad, 'titulo', titulo, 'entidad_tipo', entidad_tipo, 'entidad_id', entidad_id, 'estado', estado, 'conteo', conteo,
           'creado_at', creado_at, 'requiere_accion', requiere_accion, 'botones', to_jsonb(botones), 'leida', leida, 'telegram', telegram, 'telegram_no_salio', telegram = 'muerta' and estado = 'abierta',
           'resuelto_at', resuelto_at, 'resuelto_motivo', resuelto_motivo) order by rn) filter (where rn > greatest(p_pagina, 0) * v_tam and rn <= (greatest(p_pagina, 0) + 1) * v_tam), '[]'::jsonb),
         count(*) > (greatest(p_pagina, 0) + 1) * v_tam
    into v_filas, v_hay from pag;
  -- Resumen de TODO lo vigente (no solo de la pagina): contadores honestos.
  select jsonb_build_object(
      'criticas', count(*) filter (where b.severidad = 'C'), 'importantes', count(*) filter (where b.severidad = 'I'), 'informativas', count(*) filter (where b.severidad = 'F'),
      'piden_accion', count(*) filter (where b.requiere_accion), 'vigentes', count(*)) into v_resumen
    from (select a.severidad, t.requiere_accion from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo cross join lateral notificacion.condicion(a) k
           where a.estado = 'abierta' and k.vigente is not false and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)) b;
  v_resumen := v_resumen || jsonb_build_object('resueltos_recientes', (select count(*) from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo
                where a.estado <> 'abierta' and coalesce(a.resuelto_at, a.creado_at) > now() - make_interval(days => v_dias) and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)));
  return jsonb_build_object('filtro', p_filtro, 'pagina', greatest(p_pagina, 0), 'hay_mas', coalesce(v_hay, false), 'sin_leer', api.contar_no_leidas(), 'resumen', v_resumen, 'notificaciones', coalesce(v_filas, '[]'::jsonb));
end $$;

create or replace function api.tu_turno() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio();
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('items', coalesce((select jsonb_agg(x order by orden, creado_at desc) from (
      select jsonb_build_object('clase', 'aviso', 'id', a.id, 'codigo', a.codigo, 'severidad', a.severidad, 'titulo', a.titulo, 'entidad_tipo', a.entidad_tipo, 'entidad_id', a.entidad_id,
                                'creado_at', a.creado_at, 'botones', to_jsonb(t.botones)) as x, (case a.severidad when 'C' then 0 else 1 end) as orden, a.creado_at
        from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo cross join lateral notificacion.condicion(a) k
       where a.estado = 'abierta' and k.vigente is not false and (t.requiere_accion or a.severidad = 'C') and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
      union all
      select jsonb_build_object('clase', 'toma', 'id', o.id, 'codigo', 'toma_pendiente', 'severidad', 'I', 'titulo', 'Toma ' || o.folio || ' pendiente de autorizacion', 'entidad_tipo', 'toma', 'entidad_id', o.id,
                                'creado_at', o.solicitada_at, 'botones', '["Autorizar", "Rechazar"]'::jsonb), 1, o.solicitada_at
        from operacion.toma_omar o where o.estado = 'pendiente'
    ) q), '[]'::jsonb));
end $$;

-- Barrido desde la web (al abrir la bandeja): idempotente y solo devuelve las cuentas.
create function api.depurar_avisos() returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return notificacion.depurar(true) - 'detalle';
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function notificacion.condicion(operacion.aviso), notificacion.depurar(boolean), notificacion.reabrir(bigint) from public, anon, authenticated;
grant execute on function notificacion.condicion(operacion.aviso), notificacion.depurar(boolean), notificacion.reabrir(bigint) to servidor;
revoke execute on function api.depurar_avisos() from public, anon;
grant execute on function api.depurar_avisos() to authenticated;
