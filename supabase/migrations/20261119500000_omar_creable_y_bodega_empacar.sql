-- (1) Omar ya esta activo: se puede dar de alta y desactivar desde Cuentas (tipo de bajo privilegio, igual que bodega). socio e importacion siguen bloqueados por CHECK.
-- (2) Accion propia de bodega: marcar un pedido confirmado como empacado. Sin dinero: solo fija empacado_at (igual que operacion.marcar_empacado, que exige socio/importacion),
--     idempotente por clave, con evento y auditoria. No envia ni descuenta inventario.
alter table seguridad.tipo_cuenta drop constraint tipo_cuenta_check;
alter table seguridad.tipo_cuenta add constraint tipo_cuenta_check check (not (creable_web and rol in ('socio', 'importacion')));
update seguridad.tipo_cuenta set creable_web = true, descripcion = 'Vista propia de la bodega de Omar (existencia y solicitudes de piezas). Sin costos ni cuentas del negocio.' where rol = 'omar';

create function api.bodega_marcar_empacado(p_clave_idem text, p_folio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['bodega', 'socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'bodega_marcar_empacado', 'f', p_folio));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into ped from operacion.pedido where folio = p_folio for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'confirmado' or not operacion.origen_es_bodega(ped.origen) then raise exception 'solo un pedido confirmado que sale de la bodega se empaca' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('pedido_empacado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio));
  update operacion.pedido set empacado_at = coalesce(empacado_at, now()) where id = ped.id;
  perform seguridad.registrar_auditoria('operacion.pedido', 'EMPACADO', ped.folio, jsonb_build_object('empacado', ped.empacado_at is not null), jsonb_build_object('empacado', true), seguridad.canal_actual());
  v_res := jsonb_build_object('folio', ped.folio, 'empacado', true);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;
revoke execute on function api.bodega_marcar_empacado(text, text) from public, anon;
grant execute on function api.bodega_marcar_empacado(text, text) to authenticated;
