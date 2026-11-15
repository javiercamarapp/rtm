-- Cierre del carril del bot (revision independiente, 14-nov). Todo es CREATE OR REPLACE de la definicion VIGENTE (extraida de la base con todas las migraciones aplicadas), sin copiar versiones viejas.
--   1. ALTO  El cobro respeta el pedido que el socio eligio: agente._ejecutar_base resuelve pedido_folio y lo pasa a operacion.registrar_pago como pedido destino (primero ese pedido; el sobrante sigue la regla de siempre).
--   2. MEDIO agente._frenos_antes toma candados de transaccion por cliente y por huella: antiduplicado y sobrepago ya no son "revisar y luego escribir" sin serializar.
--   3. MEDIO agente.revisar_anomalia cuenta los bloqueos por duplicado por folio previo distinto: un lote legitimo de gastos iguales ya no apaga la escritura de todos.
--   4. MEDIO Un cobro sin cliente se rechaza (P0460) en la puerta y en la base; no se registra como efectivo sin identificar.
--   5. MEDIO Las 5 tablas de avisos de inventario tenian FORCE sin ENABLE row level security: se habilita (mismo modelo que el resto de agente.*).
-- Nada se activa: el interruptor agente_escritura sigue como este.

CREATE OR REPLACE FUNCTION agente._ejecutar_base(p_clave_idem text, p_tipo text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_res jsonb; v_socio text; v_existia boolean; v_sku jsonb; v_autor text; v_origen text; v_prov text; v_via text; v_cuenta text; v_folio text; v_ped bigint;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
  v_origen := agente._origen(p_args);
  if p_tipo = 'gasto' then
    v_socio := initcap(p_args ->> 'pagado_por');
    if v_socio not in ('Angelo', 'Javier') then raise exception 'un gasto de la sociedad pagado en efectivo de la caja aun no se captura por Telegram: dile al agente quien lo pago' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_gasto_socio(p_clave_idem, v_socio, (p_args ->> 'monto_cent')::bigint, p_args ->> 'categoria', coalesce(p_args ->> 'naturaleza', 'variable'), null, null, p_args ->> 'nota', v_origen);
  elsif p_tipo = 'aportacion' then
    v_autor := agente._autor(p_args);
    v_res := operacion.registrar_aportacion(p_clave_idem, initcap(p_args ->> 'socio'), (p_args ->> 'monto_cent')::bigint, coalesce(p_args ->> 'concepto', 'Aportacion por Telegram'),
      case lower(coalesce(p_args ->> 'intencion', p_args ->> 'clasificacion', '')) when 'capital' then 'capital' else 'reembolso' end, null, v_origen);
    v_folio := agente._guardar_hecho(p_clave_idem, 'aportacion', 'aportacion', (v_res ->> 'aportacion_id')::bigint, v_autor);
    v_res := v_res || jsonb_build_object('folio', v_folio);
  elsif p_tipo = 'pago_a_socio' then
    v_autor := agente._autor(p_args);
    if lower(p_args ->> 'tipo') not in ('reembolso', 'retiro') then raise exception 'el pago a un socio es reembolso o retiro de utilidad' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_pago_a_socio(p_clave_idem, initcap(p_args ->> 'socio'), (p_args ->> 'monto_cent')::bigint, lower(p_args ->> 'tipo'), lower(p_args ->> 'via'), null, p_args ->> 'nota', v_origen);
    v_folio := agente._guardar_hecho(p_clave_idem, 'pago_a_socio', 'libro', (v_res ->> 'libro_id')::bigint, v_autor);
    v_res := v_res || jsonb_build_object('folio', v_folio);
  elsif p_tipo = 'pago_cliente' then
    v_autor := agente._autor(p_args);
    v_cuenta := initcap(p_args ->> 'cuenta');
    if v_cuenta not in ('Angelo', 'Javier', 'Isaac', 'Karen', 'Efectivo') then raise exception 'cuenta destino desconocida: dile a que cuenta entro el pago' using errcode = 'P0460'; end if;
    if nullif(p_args ->> 'cliente_id', '') is null then raise exception 'dime de que cliente es el cobro' using errcode = 'P0460'; end if;
    -- El pedido que el socio eligio (boton op:<folio>) recibe el cobro PRIMERO; lo que sobre sigue la regla de siempre (el pedido mas antiguo).
    v_ped := null;
    if nullif(p_args ->> 'pedido_folio', '') is not null then
      select pe.id into v_ped from operacion.pedido pe
        where pe.folio = upper(btrim(p_args ->> 'pedido_folio')) and pe.cliente_id = (p_args ->> 'cliente_id')::bigint and pe.estado in ('borrador', 'confirmado', 'enviado');
      if v_ped is null then raise exception 'ese pedido no es de este cliente o ya no esta vigente: dime a que pedido lo aplico' using errcode = 'P0460'; end if;
    end if;
    v_res := operacion.registrar_pago(p_clave_idem, v_cuenta, (p_args ->> 'monto_cent')::bigint, (p_args ->> 'cliente_id')::bigint, null, true, 'abono', null, null, p_args ->> 'nota', v_origen, v_ped);
    v_folio := agente._guardar_hecho(p_clave_idem, 'pago_cliente', 'pago', (v_res ->> 'pago_id')::bigint, v_autor);
    v_res := v_res || jsonb_build_object('folio', v_folio);
  elsif p_tipo = 'pago_proveedor' then
    v_autor := agente._autor(p_args);
    v_prov := initcap(p_args ->> 'proveedor');
    if v_prov not in ('Isaac', 'Karen') then raise exception 'proveedor desconocido' using errcode = 'P0460'; end if;
    if nullif(p_args ->> 'cliente_id', '') is not null then
      -- Un cliente le pago directo al proveedor: es un pago del cliente a la cuenta del proveedor (baja su saldo y sube el saldo a favor con el proveedor).
      v_res := operacion.registrar_pago(p_clave_idem, v_prov, (p_args ->> 'monto_cent')::bigint, (p_args ->> 'cliente_id')::bigint, null, true, 'abono', null, null, p_args ->> 'nota', v_origen);
      v_folio := agente._guardar_hecho(p_clave_idem, 'pago_cliente', 'pago', (v_res ->> 'pago_id')::bigint, v_autor);
    elsif lower(p_args ->> 'pagado_por') in ('angelo', 'javier') then
      v_res := operacion.pago_proveedor_de_socio(p_clave_idem, v_prov, (p_args ->> 'monto_cent')::bigint, initcap(p_args ->> 'pagado_por'), 'auto', null, p_args ->> 'nota', v_origen);
      v_folio := agente._guardar_hecho(p_clave_idem, 'pago_proveedor', null, null, v_autor);
    else
      v_res := operacion.registrar_pago_proveedor_sociedad(p_clave_idem, v_prov, (p_args ->> 'monto_cent')::bigint, null, p_args ->> 'nota', v_origen);
      v_folio := agente._guardar_hecho(p_clave_idem, 'pago_proveedor', 'movimiento_proveedor', (v_res ->> 'movimiento_id')::bigint, v_autor);
    end if;
    v_res := v_res || jsonb_build_object('folio', v_folio);
  elsif p_tipo = 'toma_omar' then
    v_sku := coalesce(p_args -> 'sku', jsonb_build_object('sku_id', (select k.id from catalogo.sku k where k.modelo_id = (p_args ->> 'modelo_id')::bigint and k.sabor_id = (p_args ->> 'sabor_id')::bigint)));
    v_res := operacion.registrar_toma_omar(p_clave_idem, v_sku, (p_args ->> 'piezas')::int, null, null, 'telegram_omar');
  elsif p_tipo in ('devolucion', 'paquete_perdido') then
    raise exception 'la % todavia no se registra desde Telegram: depende de la integracion de su rama (ver agente.capacidades); hazlo en el software', replace(p_tipo, '_', ' ') using errcode = 'P0461';
  else
    raise exception 'tipo de indicacion no soportado por Telegram todavia: %', p_tipo using errcode = 'P0460';
  end if;
  return v_res || jsonb_build_object('repetido', v_existia);
end $$;

CREATE OR REPLACE FUNCTION agente._frenos_antes(p_clave text, p_tipo text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_h text; v_prev agente.huella; v_aplicable bigint; v_monto bigint; v_cliente bigint; v_hecha boolean;
begin
  perform agente._exigir_escritura();
  -- Un cobro sin cliente no se registra como efectivo sin identificar por esta puerta: la ultima barrera no puede ser solo TypeScript.
  if p_tipo = 'pago_cliente' and nullif(p_args ->> 'cliente_id', '') is null then raise exception 'dime de que cliente es el cobro' using errcode = 'P0460'; end if;
  v_hecha := exists (select 1 from seguridad.operacion o where o.clave = p_clave and o.resultado is not null);
  if v_hecha then return null; end if;
  v_h := agente._huella(p_tipo, p_args);
  -- Serializa revisar-y-escribir: dos socios capturando el mismo cobro (o dos cobros que juntos pasan lo que debe el cliente) esperan su turno; el segundo ve lo que dejo el primero.
  -- Orden fijo (cliente, luego huella) para no provocar interbloqueos.
  if (p_tipo = 'pago_cliente' or (p_tipo = 'pago_proveedor' and nullif(p_args ->> 'cliente_id', '') is not null)) and nullif(p_args ->> 'cliente_id', '') is not null then
    perform pg_advisory_xact_lock(hashtextextended('agente:cliente:' || (p_args ->> 'cliente_id'), 0));
  end if;
  if v_h is not null then perform pg_advisory_xact_lock(hashtextextended('agente:huella:' || v_h, 0)); end if;
  if v_h is not null and not coalesce((p_args ->> 'permitir_duplicado')::boolean, false) and not exists (select 1 from agente.huella x where x.clave_idem = p_clave) then
    select * into v_prev from agente.huella x
      where x.huella = v_h and x.anulada_at is null
 and x.creada_at > clock_timestamp() - make_interval(mins => agente._ventana_minutos()) order by x.id desc limit 1;
    if found then
      insert into agente.evento (tipo, miembro, detalle) values ('duplicado_bloqueado', nullif(p_args ->> 'telegram_user_id', '')::bigint, left(p_tipo || ' igual a ' || coalesce(v_prev.folio, '?'), 300));
      return jsonb_build_object('posible_duplicado', true, 'folio_previo', v_prev.folio, 'autor_previo', v_prev.autor, 'tipo', p_tipo,
        'hace_min', greatest(0, floor(extract(epoch from clock_timestamp() - v_prev.creada_at) / 60))::int, 'resumen', v_prev.resumen);
    end if;
  end if;
  if (p_tipo = 'pago_cliente' or (p_tipo = 'pago_proveedor' and nullif(p_args ->> 'cliente_id', '') is not null)) and not coalesce((p_args ->> 'confirmo_exceso')::boolean, false) then
    v_monto := (p_args ->> 'monto_cent')::bigint;
    v_cliente := nullif(p_args ->> 'cliente_id', '')::bigint;
    if v_cliente is not null and v_monto > 0 then
      select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0)::bigint into v_aplicable from operacion.pedido pe where pe.cliente_id = v_cliente and pe.estado = 'enviado';
      if v_monto > v_aplicable then
        return jsonb_build_object('pregunta_exceso', true, 'monto_cent', v_monto, 'debe_cent', v_aplicable, 'cliente', (select nombre_canonico from catalogo.cliente where id = v_cliente));
      end if;
    end if;
  end if;
  return null;
end $$;

-- Freno de anomalias: los bloqueos por duplicado se cuentan por folio previo DISTINTO. Un lote legitimo de lineas iguales choca todas con el mismo folio (1), un envio descontrolado de cosas distintas no.
CREATE OR REPLACE FUNCTION agente.revisar_anomalia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare v_hechos int; v_dups int; v_err int; v_motivo text;
begin
  perform notificacion.exigir_sistema();
  if not agente._escritura_activa() then return jsonb_build_object('apagado', false, 'ya_apagada', true); end if;
  select count(*) into v_hechos from agente.hecho where creado_at > now() - interval '5 minutes';
  select count(distinct detalle) filter (where tipo = 'duplicado_bloqueado'), count(*) filter (where tipo = 'error_escritura') into v_dups, v_err from agente.evento where creado_at > now() - interval '5 minutes';
  v_motivo := case
    when v_hechos > 80 then format('%s movimientos del agente en 5 minutos', v_hechos)
    when v_dups >= 10 then format('%s bloqueos por duplicado en 5 minutos', v_dups)
    when v_err >= 10 then format('%s errores de escritura en 5 minutos', v_err)
    else null end;
  if v_motivo is null then return jsonb_build_object('apagado', false); end if;
  perform agente.apagar_escritura_anomalia(v_motivo);
  return jsonb_build_object('apagado', true, 'motivo', v_motivo);
end $$;

alter table agente.aviso_regla enable row level security;
alter table agente.minimo_manual enable row level security;
alter table agente.minimo_pendiente enable row level security;
alter table agente.aviso_cola enable row level security;
alter table agente.aviso_digest enable row level security;
