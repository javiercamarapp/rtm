-- Una toma autorizada DESPUES del corte semanal no se pierde.
-- Problema: la toma de Omar queda con `fecha_neg` = dia de la solicitud y la liquidacion semanal suma las tomas autorizadas por `fecha_neg`. Si Omar pide el
-- domingo y un socio autoriza despues de que esa semana se liquido (lunes en adelante), la toma caia en una semana ya cerrada: no entraba en ninguna liquidacion.
-- Regla (la misma que ya usa la liquidacion: "una semana liquidada no admite tomas nuevas; se corrige en la siguiente liquidacion"): al AUTORIZAR, si la semana
-- de `fecha_neg` ya esta liquidada, la toma se asienta en la semana abierta vigente (`fecha_neg` pasa a hoy, igual que el movimiento de inventario, que ya se
-- fechaba hoy). Si esa semana sigue abierta, conserva su fecha y entra en su liquidacion. La fecha original queda en `solicitada_at` y en el evento.
-- Ademas, una pendiente que ya paso las horas de caducidad (omar_toma_caduca_horas, 72) no se puede autorizar: se cierra como caducada o se vuelve a pedir.

create or replace function operacion.t9_toma() returns trigger
language plpgsql set search_path = ''
as $$
declare v_libres text[] := array['estado', 'resuelta_at', 'resuelta_por', 'movimiento_id'];
begin
  if tg_op = 'DELETE' then raise exception 'las tomas no se borran' using errcode = '42501'; end if;
  -- Solo al autorizar una pendiente puede cambiar la fecha de asiento (ver arriba).
  if old.estado = 'pendiente' and new.estado = 'autorizada' then v_libres := array_append(v_libres, 'fecha_neg'); end if;
  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'la toma solo cambia de estado' using errcode = '42501';
  end if;
  if not ((old.estado = 'pendiente' and new.estado in ('autorizada', 'rechazada', 'caducada')) or (old.estado = 'autorizada' and new.estado = 'deshecha') or old.estado = new.estado) then
    raise exception 'transicion de toma no permitida: % -> %', old.estado, new.estado using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function operacion.resolver_toma_omar(p_clave_idem text, p_toma bigint, p_accion text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; t operacion.toma_omar; v_ev bigint; v_mov bigint; m operacion.movimiento_inventario; v_nuevo text; v_res jsonb; v_asiento date;
  v_horas int := coalesce((catalogo.config_valor('omar_toma_caduca_horas'))::text::int, 72);
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'resolver_toma_omar', 't', p_toma, 'a', p_accion));
  if v_prev is not null then return v_prev; end if;
  if p_accion not in ('autorizar', 'rechazar', 'caducar', 'deshacer') then raise exception 'accion invalida' using errcode = '22023'; end if;
  select * into t from operacion.toma_omar where id = p_toma for update;
  if not found then raise exception 'toma desconocida' using errcode = '22023'; end if;
  if p_accion in ('autorizar', 'rechazar', 'caducar') and t.estado <> 'pendiente' then raise exception 'la toma % ya esta %', t.folio, t.estado using errcode = 'P0428'; end if;
  if p_accion = 'deshacer' and t.estado <> 'autorizada' then raise exception 'solo una toma autorizada se deshace (esta %)', t.estado using errcode = 'P0428'; end if;
  if p_accion = 'autorizar' and t.solicitada_at + make_interval(hours => v_horas) < now() then
    raise exception 'la toma % ya caduco (% horas): cierrala como caducada o pidela de nuevo', t.folio, v_horas using errcode = 'P0428';
  end if;
  v_ev := operacion.crear_evento('toma_omar_' || p_accion, negocio.hoy(), p_clave_idem, jsonb_build_object('toma', t.folio, 'fecha_solicitud', t.fecha_neg));
  if p_accion = 'autorizar' then
    perform operacion.exigir_semana_omar_abierta(negocio.hoy());
    -- Corte semanal: si la semana de la solicitud ya se liquido, la toma se asienta en la semana abierta vigente.
    v_asiento := case when exists (select 1 from operacion.liquidacion_omar where semana_ini = operacion.semana_omar_ini(t.fecha_neg)) then negocio.hoy() else t.fecha_neg end;
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id)
      values (negocio.hoy(), t.sku_id, t.modelo_id, 'bodega_omar', 'salida_toma_omar', -t.piezas, v_ev) returning id into v_mov;
    update operacion.toma_omar set estado = 'autorizada', resuelta_at = now(), resuelta_por = auth.uid(), movimiento_id = v_mov, fecha_neg = v_asiento where id = t.id;
    update operacion.reserva set estado = 'aplicada', resuelta_at = now() where origen_tipo = 'toma_omar' and origen_id = t.id and estado = 'activa';
    v_nuevo := 'autorizada';
    if t.precio_cent is null then
      perform operacion.avisar('toma_sin_precio', 'NT-051', 'toma_sin_precio:' || t.id, 'I', 'Toma ' || t.folio || ' sin precio ("Falta precio"): no entra al saldo', 'toma_omar', t.id,
        jsonb_build_object('folio', t.folio), null, v_ev, false, array['software', 'telegram']);
    end if;
  elsif p_accion in ('rechazar', 'caducar') then
    v_nuevo := case p_accion when 'rechazar' then 'rechazada' else 'caducada' end;
    update operacion.toma_omar set estado = v_nuevo, resuelta_at = now(), resuelta_por = auth.uid() where id = t.id;
    update operacion.reserva set estado = 'liberada', resuelta_at = now() where origen_tipo = 'toma_omar' and origen_id = t.id and estado = 'activa';
  else
    perform operacion.exigir_semana_omar_abierta(t.fecha_neg);
    select * into m from operacion.movimiento_inventario where id = t.movimiento_id;
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, 'Toma deshecha');
    update operacion.toma_omar set estado = 'deshecha', resuelta_at = now() where id = t.id;
    v_nuevo := 'deshecha';
  end if;
  v_res := jsonb_build_object('toma_id', t.id, 'folio', t.folio, 'estado', v_nuevo);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;
revoke execute on function operacion.resolver_toma_omar(text, bigint, text) from public, anon, authenticated;
