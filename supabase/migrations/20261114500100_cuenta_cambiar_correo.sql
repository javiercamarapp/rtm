-- Cambiar el correo de una cuenta creable desde la web (bodega): 'correo provisional que se pueda cambiar' (decision del dueno, 14-nov). ADITIVA: una funcion nueva.
--  * Solo socio. Solo tipos creables desde la web (nunca socio ni Omar). Idempotente por clave.
--  * Desactiva el acceso anterior (corta sus sesiones de Auth, igual que api.cuenta_cambiar_estado) y crea la cuenta con el correo nuevo del MISMO tipo y nombre.
--  * Mismo validador y forma canonica unica que el alta; el tope de 20 cuentas activas se respeta (la cuenta anterior deja de contar al desactivarse).
--  * Auditoria con HUELLA de los dos correos; nunca el correo en claro (ni en la auditoria ni en seguridad.operacion).
--  * El usuario de Auth del correo nuevo lo crea `npm run acceso:cuentas` (ya atiende a toda cuenta creable activa sin acceso), sin mandar correos.
create function api.cuenta_cambiar_correo(p_clave_idem text, p_correo_actual text, p_correo_nuevo text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_act text; v_nue text; v_h_act text; v_h_nue text; v_motivo text; c seguridad.correo_permitido; t seguridad.tipo_cuenta; x seguridad.correo_permitido;
  v_uid uuid; v_activas int; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_act := seguridad.correo_canonico(p_correo_actual);
  v_nue := seguridad.correo_canonico(p_correo_nuevo);
  if not seguridad.correo_valido(v_nue) then raise exception 'correo invalido' using errcode = '22023'; end if;
  if v_act = v_nue then raise exception 'el correo nuevo es igual al actual' using errcode = '22023'; end if;
  v_h_act := seguridad.huella_correo(v_act); v_h_nue := seguridad.huella_correo(v_nue);
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is not null and char_length(v_motivo) > 200 then raise exception 'el motivo pasa de 200 caracteres' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cuenta_cambiar_correo', 'a', v_h_act, 'n', v_h_nue, 'm', v_motivo));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into c from seguridad.correo_permitido where correo = v_act for update;
  if not found then raise exception 'cuenta desconocida' using errcode = '22023'; end if;
  select * into t from seguridad.tipo_cuenta where rol = c.rol;
  if not t.creable_web then raise exception 'esa cuenta no se administra desde la web' using errcode = '42501'; end if;

  -- El correo nuevo ya existe: si es del mismo tipo y esta activo y la anterior ya esta desactivada, el cambio ya se hizo (sin cambio); en otro caso, conflicto.
  select * into x from seguridad.correo_permitido where correo = v_nue for update;
  if found then
    if x.rol = c.rol and x.activo and not c.activo then
      v_res := jsonb_build_object('huella_anterior', v_h_act, 'huella_nueva', v_h_nue, 'tipo', c.rol, 'estado', 'sin_cambio');
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
    raise exception 'ese correo ya tiene una cuenta' using errcode = '23505';
  end if;
  if exists (select 1 from auth.users u where seguridad.correo_canonico(u.email) = v_nue) then raise exception 'ese correo ya tiene una cuenta' using errcode = '23505'; end if;
  if not c.activo then raise exception 'la cuenta actual esta desactivada: reactivala antes de cambiar su correo' using errcode = '22023'; end if;

  -- Desactivar la anterior primero: deja de contar para el tope.
  update seguridad.correo_permitido set activo = false, actualizado_en = now() where correo = v_act;
  select u.id into v_uid from auth.users u where seguridad.correo_canonico(u.email) = v_act;
  if v_uid is not null then
    update seguridad.usuario set activo = false where id = v_uid;
    delete from auth.sessions where user_id = v_uid;
  end if;
  select count(*) into v_activas from seguridad.correo_permitido y join seguridad.tipo_cuenta z on z.rol = y.rol where z.creable_web and y.activo;
  if v_activas >= 20 then raise exception 'se alcanzo el tope de cuentas creadas desde la web' using errcode = '54000'; end if;
  insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo, nombre, creado_por) values (v_nue, c.rol, null, true, c.nombre, auth.uid());
  perform seguridad.registrar_auditoria('seguridad.correo_permitido', 'UPDATE', v_h_act, jsonb_build_object('rol', c.rol, 'activo', true),
    jsonb_build_object('rol', c.rol, 'activo', false, 'cambio_de_correo_a', v_h_nue, 'motivo', seguridad.sin_correos(v_motivo)), seguridad.canal_actual());
  perform seguridad.registrar_auditoria('seguridad.correo_permitido', 'INSERT', v_h_nue, null,
    jsonb_build_object('rol', c.rol, 'nombre', seguridad.sin_correos(c.nombre), 'activo', true, 'reemplaza_a', v_h_act), seguridad.canal_actual());
  v_res := jsonb_build_object('huella_anterior', v_h_act, 'huella_nueva', v_h_nue, 'tipo', c.rol, 'estado', 'cambiada', 'acceso_creado', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on function api.cuenta_cambiar_correo(text, text, text, text) from public, anon;
grant execute on function api.cuenta_cambiar_correo(text, text, text, text) to authenticated;
