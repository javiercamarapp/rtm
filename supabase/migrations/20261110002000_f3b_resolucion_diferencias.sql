-- F3b (reparacion): resoluciones de una diferencia de recepcion que la sociedad absorbe o repone (doc 14, seccion 5).
--   castigar: Dr 5300 / Cr 1340 (la sociedad pierde las piezas).
--   reponer:  Dr 1310 / Cr 1340 (el proveedor repone las piezas: entran al kardex como traspaso desde el puente).
--   acreditar: ya existe como `asignar_diferencia(..., 'proveedor')` (Dr 2110 / Cr 1340 por el reclamo).
-- Ambas dejan una asignacion que baja el puente operativo (`saldo_puente`) y por eso el puente del libro y el operativo siguen iguales.
alter table operacion.diferencia_asignacion drop constraint diferencia_asignacion_responsable_check;
alter table operacion.diferencia_asignacion add constraint diferencia_asignacion_responsable_check check (responsable in ('socio', 'proveedor', 'castigo', 'reposicion'));

create function operacion.resolver_diferencia(p_clave_idem text, p_diferencia bigint, p_resolucion text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; d operacion.compra_diferencia; v_ev bigint; v_res jsonb; v_folio text; v_linea operacion.compra_linea; v_mov bigint; v_resp text;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'resolver_diferencia', 'd', p_diferencia, 'r', p_resolucion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if p_resolucion not in ('castigar', 'reponer') then raise exception 'resolucion invalida (castigar o reponer; acreditar se hace asignando al proveedor)' using errcode = '22023'; end if;
  select * into d from operacion.compra_diferencia where id = p_diferencia for update;
  if not found then raise exception 'diferencia desconocida' using errcode = '22023'; end if;
  if d.tipo <> 'faltante' then raise exception 'solo un faltante se castiga o se repone' using errcode = '22023'; end if;
  if exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = d.id and x.cancela_a is null and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id)) then
    raise exception 'la diferencia ya tiene una resolucion o un responsable' using errcode = 'P0428';
  end if;
  select co.folio into v_folio from operacion.compra co where co.id = d.compra_id;
  select * into v_linea from operacion.compra_linea where id = d.compra_linea_id;
  v_resp := case p_resolucion when 'castigar' then 'castigo' else 'reposicion' end;
  v_ev := operacion.crear_evento('diferencia_resuelta', negocio.hoy(), p_clave_idem, jsonb_build_object('diferencia', d.id, 'resolucion', p_resolucion, 'compra', v_folio, 'motivo', p_motivo));
  if p_resolucion = 'reponer' then
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, nota)
      values (negocio.hoy(), v_linea.sku_id, v_linea.modelo_id, 'bodega_omar', 'traspaso_puente', d.piezas, d.valor_cent, v_ev, 'Reposicion del faltante de ' || v_folio) returning id into v_mov;
  end if;
  insert into operacion.diferencia_asignacion (diferencia_id, responsable, monto_cent, motivo, evento_id) values (d.id, v_resp, d.valor_cent, p_motivo, v_ev);
  perform operacion.resolver_avisos('diferencia_recepcion_abierta', 'compra_diferencia', d.id);
  v_res := jsonb_build_object('diferencia_id', d.id, 'resolucion', p_resolucion, 'valor_cent', d.valor_cent, 'puente_cent', operacion.saldo_puente());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.resolver_diferencia(p_clave_idem text, p_diferencia bigint, p_resolucion text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.resolver_diferencia(p_clave_idem => p_clave_idem, p_diferencia => p_diferencia, p_resolucion => p_resolucion, p_motivo => p_motivo); end $$;
revoke execute on function operacion.resolver_diferencia(text, bigint, text, text) from public, anon, authenticated;
revoke execute on function api.resolver_diferencia(text, bigint, text, text) from public, anon;
grant execute on function api.resolver_diferencia(text, bigint, text, text) to authenticated;
