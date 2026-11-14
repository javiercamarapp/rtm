-- Plazo obligatorio en todo pedido a credito (decision del dueno, 14-nov).
-- Convencion: plazo_dias = dias para pagar contados desde el envio (vence = fecha_envio + plazo_dias). CERO = de contado (se paga en el acto). NULL ya no se acepta al crear.
-- Rutas que crean pedido y como quedan:
--   * Web (api.crear_pedido)             : exige plazo_dias (0 a 365); sin el, P0436.
--   * Bot (agente pedido_crear)          : exige args.plazo_dias; el plazo se fija con operacion.acordar_plazo (con evento); sin el, P0436. El bot pregunta antes de escribir.
--   * Dropshipping (operacion.ds_crear_pedido, api.ds_crear_pedido): un credito debe traer fecha_pago o semanas EXPLICITAS (antes se asumia 1 semana); sin ellas, P0436.
--     Contado y venta a costo del socio (sin p_credito) no cambian: su plazo es la fecha comprometida propia del socio de menudeo.
--   * Cargador historico: llama api.crear_pedido y operacion.ds_crear_pedido; el credito ya lleva su plazo explicito y el contado se carga con plazo 0 (scripts/cargador/plan.mjs).
--   * Importacion: no crea pedidos.
--   * operacion.crear_pedido (interna, sin EXECUTE para ningun rol de la web) NO cambia: la usan las rutas anteriores.
-- ADITIVA: create or replace de api.crear_pedido y rename+wrap de funciones internas. Sin DROP ni GRANT nuevo.

create function operacion.exigir_plazo_pedido(p_plazo_dias int) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_plazo_dias is null then
    raise exception 'el pedido necesita plazo: indica en cuantos dias paga el cliente, o 0 si es de contado' using errcode = 'P0436';
  end if;
  if p_plazo_dias < 0 or p_plazo_dias > 365 then
    raise exception 'plazo invalido: debe estar entre 0 (contado) y 365 dias' using errcode = 'P0436';
  end if;
end $$;

-- Web.
create or replace function api.crear_pedido(p_clave_idem text, p_cliente_id bigint, p_lineas jsonb, p_origen text default 'bodega_omar', p_destino_id bigint default null,
                                            p_envio_cent bigint default 0, p_descuento_cent bigint default 0, p_recargo_cent bigint default 0, p_fecha date default null,
                                            p_excepcion_minimo_motivo text default null, p_plazo_dias int default null, p_paqueteria text default null,
                                            p_nota text default null, p_mensaje_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  perform operacion.exigir_plazo_pedido(p_plazo_dias);
  return operacion.crear_pedido(p_clave_idem => p_clave_idem, p_cliente_id => p_cliente_id, p_lineas => p_lineas, p_origen => p_origen, p_destino_id => p_destino_id,
    p_envio_cent => p_envio_cent, p_descuento_cent => p_descuento_cent, p_recargo_cent => p_recargo_cent, p_fecha => p_fecha, p_excepcion_minimo_motivo => p_excepcion_minimo_motivo,
    p_plazo_dias => p_plazo_dias, p_paqueteria => p_paqueteria, p_nota => p_nota, p_mensaje_origen => p_mensaje_origen);
end $$;

-- Dropshipping: el credito lleva su plazo explicito.
alter function operacion.ds_crear_pedido(text, bigint, jsonb, text, jsonb, jsonb, text, text, text, bigint, bigint, date, text, text, date, time) rename to _ds_crear_pedido_sin_plazo;

create function operacion.ds_crear_pedido(p_clave_idem text, p_cliente_id bigint, p_lineas jsonb, p_origen text default 'karen_directo', p_destinatario jsonb default null,
                                          p_credito jsonb default null, p_tipo_venta text default 'cliente', p_socio text default null, p_folio_externo text default null,
                                          p_envio_cent bigint default 0, p_descuento_cent bigint default 0, p_fecha date default null, p_nota text default null,
                                          p_mensaje_origen text default null, p_fecha_compromiso date default null, p_hora_compromiso time default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_credito is not null and p_tipo_venta <> 'socio_a_costo' and nullif(p_credito ->> 'fecha_pago', '') is null and nullif(p_credito ->> 'semanas', '') is null then
    raise exception 'la venta a credito necesita plazo: indica la fecha de pago o las semanas' using errcode = 'P0436';
  end if;
  return operacion._ds_crear_pedido_sin_plazo(p_clave_idem, p_cliente_id, p_lineas, p_origen, p_destinatario, p_credito, p_tipo_venta, p_socio, p_folio_externo,
    p_envio_cent, p_descuento_cent, p_fecha, p_nota, p_mensaje_origen, p_fecha_compromiso, p_hora_compromiso);
end $$;

-- Bot: pedido_crear exige plazo y lo fija con la funcion oficial (queda el evento plazo_acordado).
alter function agente._ejecutar_ext_base(text, text, jsonb) rename to _ejecutar_ext_base_sin_plazo;

create function agente._ejecutar_ext_base(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_plazo int; v_res jsonb;
begin
  if p_tipo <> 'pedido_crear' then return agente._ejecutar_ext_base_sin_plazo(p_clave_idem, p_tipo, p_args); end if;
  if coalesce(p_args ->> 'plazo_dias', '') !~ '^\d{1,3}$' then
    raise exception 'el pedido necesita plazo: pregunta en cuantos dias paga el cliente, o si es de contado' using errcode = 'P0436';
  end if;
  v_plazo := (p_args ->> 'plazo_dias')::int;
  perform operacion.exigir_plazo_pedido(v_plazo);
  v_res := agente._ejecutar_ext_base_sin_plazo(p_clave_idem, p_tipo, p_args);
  perform operacion.acordar_plazo(p_clave_idem || ':plazo', (v_res ->> 'pedido_id')::bigint, v_plazo);
  return v_res || jsonb_build_object('plazo_dias', v_plazo);
end $$;

revoke all on function agente._ejecutar_ext_base(text, text, jsonb), agente._ejecutar_ext_base_sin_plazo(text, text, jsonb) from public, anon, authenticated;
revoke all on function operacion.ds_crear_pedido(text, bigint, jsonb, text, jsonb, jsonb, text, text, text, bigint, bigint, date, text, text, date, time),
  operacion._ds_crear_pedido_sin_plazo(text, bigint, jsonb, text, jsonb, jsonb, text, text, text, bigint, bigint, date, text, text, date, time),
  operacion.exigir_plazo_pedido(int) from public, anon, authenticated;
