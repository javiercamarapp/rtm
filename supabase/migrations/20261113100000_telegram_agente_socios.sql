-- Lane telegram-agente: lo que los socios necesitan registrar y consultar por Telegram para cuadrar cuentas entre ellos.
-- ADITIVA: no toca tablas ni funciones de negocio; reemplaza agente.ejecutar, agente.consulta, agente.localizar y agente.deshacer (todas del propio agente).
--
-- Nuevas indicaciones (agente.ejecutar): pago_a_socio (reembolso o retiro de utilidad), pago_cliente (cobro), pago_proveedor (cliente redirigido, de socio o de la sociedad).
-- La aportacion de capital ya existia (union 20261112000300); aqui lleva el campo `intencion` y queda en el libro de hechos.
-- Nuevas consultas (agente.consulta): estado_socio, utilidad, cartera.
-- Auditoria: cada hecho del agente queda en agente.hecho (quien lo mando, folio del evento, a que fila apunta) y el evento de negocio lleva mensaje_origen = 'telegram:<persona>: <cita>'.
-- Devolucion y paquete perdido: el contrato existe en el agente (TypeScript) pero la base de ESTA rama no trae las funciones (viven en lane/devolucion-parcial y lane/paquete-perdido);
--   agente.capacidades() lo reporta y agente.ejecutar responde P0461 hasta que esas ramas esten integradas.
-- Nada aqui calcula con IA: todo monto lo valida el codigo TypeScript contra el mensaje del socio y lo aplica la funcion de negocio de siempre.

create table agente.hecho (
  clave_idem text primary key,
  folio text not null unique,
  tipo text not null check (tipo in ('pago_a_socio', 'aportacion', 'pago_cliente', 'pago_proveedor')),
  ref_tipo text check (ref_tipo in ('libro', 'aportacion', 'pago', 'movimiento_proveedor')),
  ref_id bigint,
  autor text not null check (autor in ('angelo', 'javier')),
  creado_at timestamptz not null default clock_timestamp(),
  deshecho_at timestamptz,
  check ((ref_tipo is null) = (ref_id is null))
);
alter table agente.hecho enable row level security;
alter table agente.hecho force row level security;
revoke all on agente.hecho from public, anon, authenticated;

create function agente._origen(p_args jsonb) returns text
language sql immutable set search_path = ''
as $$ select left('telegram:' || coalesce(nullif(p_args ->> 'autor', ''), 'socio') || ': ' || coalesce(p_args ->> 'origen', ''), 400) $$;

create function agente._autor(p_args jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare v text := lower(coalesce(p_args ->> 'autor', ''));
begin
  if v not in ('angelo', 'javier') then raise exception 'falta quien mando la indicacion (solo un socio registra dinero por Telegram)' using errcode = 'P0460'; end if;
  return v;
end $$;

create function agente._guardar_hecho(p_clave text, p_tipo text, p_ref_tipo text, p_ref_id bigint, p_autor text) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_folio text;
begin
  select folio into v_folio from operacion.evento where clave_idem = p_clave;
  if v_folio is null then raise exception 'el movimiento no dejo evento' using errcode = 'P0460'; end if;
  insert into agente.hecho (clave_idem, folio, tipo, ref_tipo, ref_id, autor) values (p_clave, v_folio, p_tipo, p_ref_tipo, p_ref_id, p_autor) on conflict (clave_idem) do nothing;
  return v_folio;
end $$;

-- Lo que esta base puede registrar hoy (las ramas hermanas lo encienden al integrarse).
create function agente.capacidades() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return jsonb_build_object(
    'devolucion', to_regprocedure('operacion.registrar_devolucion_cliente(text,bigint,jsonb,text)') is not null,
    'paquete', to_regprocedure('operacion.reportar_paquete_salida(text,bigint,text,text,jsonb)') is not null);
end $$;

create or replace function agente.ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_socio text; v_existia boolean; v_sku jsonb; v_autor text; v_origen text; v_prov text; v_via text; v_cuenta text; v_folio text;
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
    v_res := operacion.registrar_pago(p_clave_idem, v_cuenta, (p_args ->> 'monto_cent')::bigint, (p_args ->> 'cliente_id')::bigint, null, true, 'abono', null, null, p_args ->> 'nota', v_origen);
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

-- Ultimo hecho aplicado por el agente (canal telegram) o el folio indicado, y de quien lo mando si se pide: gasto G-, toma T- o un hecho del libro del agente.
drop function agente.localizar(text);
create function agente.localizar(p_folio text, p_autor text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_build_object('folio', x.folio, 'tipo', x.tipo, 'ejecutado_en', x.hora) from (
      select g.folio, 'gasto' as tipo, e.hora from operacion.gasto g join operacion.evento e on e.id = g.evento_id
        where e.canal = 'telegram' and (p_folio is null or g.folio = p_folio) and not exists (select 1 from operacion.gasto_anulacion a where a.gasto_id = g.id)
          and (p_autor is null or e.mensaje_origen like 'telegram:' || p_autor || ':%')
      union all
      select t.folio, 'toma', e.hora from operacion.toma_omar t join operacion.evento e on e.id = t.evento_id
        where e.canal = 'telegram' and t.estado in ('pendiente', 'autorizada') and (p_folio is null or t.folio = p_folio) and p_autor is null
      union all
      select h.folio, h.tipo, h.creado_at from agente.hecho h
        where h.deshecho_at is null and (p_folio is null or h.folio = p_folio) and (p_autor is null or h.autor = p_autor)
      order by hora desc limit 1) x), 'null'::jsonb);
end $$;

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
    if h.ref_tipo is null then raise exception 'ese movimiento se deshace desde el software (no tiene una anulacion directa)' using errcode = 'P0460'; end if;
    if h.ref_tipo = 'libro' then v_res := operacion.anular_movimiento_socio(p_clave_idem, 'libro', h.ref_id, 'Deshecho desde Telegram');
    elsif h.ref_tipo = 'aportacion' then v_res := operacion.anular_movimiento_socio(p_clave_idem, 'aportacion', h.ref_id, 'Deshecho desde Telegram');
    elsif h.ref_tipo = 'pago' then v_res := operacion.anular_pago(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
    else v_res := operacion.anular_movimiento_proveedor(p_clave_idem, h.ref_id, 'Deshecho desde Telegram');
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

-- Consultas de lectura. Todas las cifras salen de las funciones de siempre; el agente no calcula.
create or replace function agente.consulta(p_tipo text, p_modelo bigint default null, p_sujeto text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_socio bigint; v_nombre text; v_hoy date := negocio.hoy(); v_ini date; v_u jsonb; v_total bigint;
begin
  perform notificacion.exigir_sistema();
  if p_tipo = 'inventario' then
    select jsonb_build_object('titulo', 'Existencia', 'lineas', coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico, 'piezas', e.piezas) order by m.nombre_canonico), '[]'::jsonb)) into v_res
      from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where e.piezas > 0 and (p_modelo is null or m.id = p_modelo);
  elsif p_tipo = 'socios' then
    v_res := jsonb_build_object('titulo', 'Cuenta entre socios', 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Javier le debe a Angelo', 'centavos', (operacion.posicion_socios() ->> 'javier_debe_a_angelo_cent')::bigint)));
  elsif p_tipo = 'cuenta_cliente' then
    select jsonb_build_object('titulo', 'Saldo de ' || c.nombre_canonico, 'lineas', jsonb_build_array(jsonb_build_object('etiqueta', 'Por cobrar', 'centavos', operacion.saldo_cliente(c.id)))) into v_res
      from catalogo.cliente c where c.id = p_modelo;
  elsif p_tipo = 'proveedor' then
    select jsonb_build_object('titulo', 'Cuenta con ' || p.nombre, 'lineas', jsonb_build_array(jsonb_build_object('etiqueta', 'Saldo (positivo: a favor)', 'centavos', -operacion.saldo_proveedor(p.id)))) into v_res
      from catalogo.proveedor p where p.nombre = initcap(p_sujeto);
  elsif p_tipo = 'estado_socio' then
    select id, nombre into v_socio, v_nombre from catalogo.socio where nombre = initcap(p_sujeto);
    if v_socio is null then raise exception 'socio desconocido: dime si es Angelo o Javier' using errcode = '22023'; end if;
    v_res := jsonb_build_object('titulo', 'Estado de cuenta de ' || v_nombre, 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Posicion neta', 'centavos', operacion.neto_socio(v_socio)),
      jsonb_build_object('etiqueta', 'Reembolso pendiente', 'centavos', operacion.reembolso_pendiente(v_socio)),
      jsonb_build_object('etiqueta', 'Aportacion pendiente de devolver', 'centavos', operacion.aportacion_pendiente(v_socio)),
      jsonb_build_object('etiqueta', 'Capital aportado', 'centavos', operacion.aportado_socio(v_socio, 'capital')),
      jsonb_build_object('etiqueta', 'Utilidad asignada por distribuir', 'centavos', operacion.utilidad_por_distribuir(v_socio)),
      jsonb_build_object('etiqueta', 'Lo que debe a la sociedad', 'centavos', operacion.saldo_socio(v_socio))));
  elsif p_tipo = 'utilidad' then
    v_ini := case lower(coalesce(p_sujeto, 'mes')) when 'hoy' then v_hoy when 'semana' then v_hoy - 6 else date_trunc('month', v_hoy)::date end;
    v_u := operacion.utilidad_periodo(v_ini, v_hoy);
    v_res := jsonb_build_object('titulo', 'Utilidad operativa (' || coalesce(p_sujeto, 'mes') || ')', 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Utilidad de pedidos', 'centavos', (v_u ->> 'utilidad_pedidos_cent')::bigint),
      jsonb_build_object('etiqueta', 'Utilidad de tomas de Omar', 'centavos', (v_u ->> 'utilidad_tomas_cent')::bigint),
      jsonb_build_object('etiqueta', 'Gastos generales', 'centavos', (v_u ->> 'gastos_cent')::bigint),
      jsonb_build_object('etiqueta', 'Utilidad operativa', 'centavos', (v_u ->> 'utilidad_cent')::bigint),
      jsonb_build_object('etiqueta', 'Nota', 'texto', case when (v_u ->> 'provisional')::boolean then 'Aproximacion operativa y provisional: hay pedidos con costos por confirmar.' else 'Aproximacion operativa; la cifra contable esta en el software.' end)));
  elsif p_tipo = 'cartera' then
    select coalesce(sum(s.saldo), 0)::bigint into v_total from (select operacion.saldo_cliente(c.id) + coalesce(operacion.apertura_cxc_cliente(c.id), 0) as saldo from catalogo.cliente c where c.activo) s where s.saldo > 0;
    v_res := jsonb_build_object('titulo', 'Cuanto debe cada cliente', 'lineas',
      coalesce((select jsonb_agg(jsonb_build_object('etiqueta', q.nombre, 'centavos', q.saldo) order by q.saldo desc, q.nombre)
                  from (select c.nombre_canonico as nombre, operacion.saldo_cliente(c.id) + coalesce(operacion.apertura_cxc_cliente(c.id), 0) as saldo from catalogo.cliente c where c.activo) q where q.saldo > 0), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('etiqueta', 'Total por cobrar', 'centavos', v_total)));
  else
    raise exception 'consulta desconocida' using errcode = '22023';
  end if;
  return coalesce(v_res, jsonb_build_object('titulo', 'Sin datos', 'lineas', '[]'::jsonb));
end $$;

revoke execute on all functions in schema agente from public, anon, authenticated;
grant execute on all functions in schema agente to servidor;
