-- Endurecimiento de la administracion de cuentas (verificacion independiente de feat/rol-bodega). Reemplaza api.cuenta_alta y api.cuenta_cambiar_estado (mismas firmas y GRANT).
--  * El tope de 20 cuentas activas creadas desde la web tambien se aplica al REACTIVAR (antes se evadia desactivando y reactivando).
--  * Validacion de correo alineada con GoTrue: ASCII, un solo @, sin espacios, comas ni <>, sin punto final ni puntos dobles, parte local <= 64, dominio con etiquetas validas.
--  * Unicidad por forma canonica: minusculas, trim y NFKC; el punto final y las variantes Unicode (ancho completo) caen en el mismo correo.
--    LIMITACION documentada: no se colapsan alias +tag ni los puntos de Gmail (otra cuenta para Gmail, como ya exige el login).
--  * seguridad.operacion.resultado ya no guarda el correo en claro (solo huella, tipo y estado). La auditoria filtra lo que parezca un correo en motivo y nombre.

create function seguridad.correo_canonico(p_correo text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select regexp_replace(lower(normalize(btrim(coalesce(p_correo, '')), NFKC)), '\.+$', '') $$;

create function seguridad.correo_valido(p_canonico text) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select p_canonico is not null
     and char_length(p_canonico) <= 254
     and p_canonico ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]{1,64}@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
     and split_part(p_canonico, '@', 1) !~ '(^\.|\.$|\.\.)'
$$;

create function seguridad.huella_correo(p_canonico text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select left(encode(sha256(convert_to(p_canonico, 'UTF8')), 'hex'), 16) $$;

create function seguridad.sin_correos(p_texto text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select nullif(btrim(regexp_replace(coalesce(p_texto, ''), '\S*@\S*', '[correo omitido]', 'g')), '') $$;

create or replace function api.cuenta_alta(p_clave_idem text, p_correo text, p_tipo text, p_nombre text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_correo text; v_nombre text; t seguridad.tipo_cuenta; c seguridad.correo_permitido; v_res jsonb; v_activas int; v_huella text;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_correo := seguridad.correo_canonico(p_correo);
  if not seguridad.correo_valido(v_correo) then raise exception 'correo invalido' using errcode = '22023'; end if;
  v_huella := seguridad.huella_correo(v_correo);
  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is not null and char_length(v_nombre) > 60 then raise exception 'el nombre pasa de 60 caracteres' using errcode = '22023'; end if;
  select * into t from seguridad.tipo_cuenta where rol = p_tipo;
  if not found then raise exception 'tipo de cuenta desconocido' using errcode = '22023'; end if;
  if not t.creable_web then raise exception 'ese tipo de cuenta no se crea desde la web' using errcode = '42501'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cuenta_alta', 'h', v_huella, 't', t.rol, 'n', v_nombre));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into c from seguridad.correo_permitido where correo = v_correo for update;
  if found then
    if c.rol <> t.rol then raise exception 'ese correo ya tiene otro tipo de cuenta' using errcode = '23505'; end if;
    v_res := jsonb_build_object('huella', v_huella, 'tipo', t.rol, 'estado', case when c.activo then 'sin_cambio' else 'desactivada' end, 'activo', c.activo);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if exists (select 1 from auth.users u join seguridad.usuario s on s.id = u.id where seguridad.correo_canonico(u.email) = v_correo and s.rol <> t.rol) then
    raise exception 'ese correo ya tiene otro tipo de cuenta' using errcode = '23505';
  end if;
  select count(*) into v_activas from seguridad.correo_permitido x join seguridad.tipo_cuenta y on y.rol = x.rol where y.creable_web and x.activo;
  if v_activas >= 20 then raise exception 'se alcanzo el tope de cuentas creadas desde la web' using errcode = '54000'; end if;

  insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo, nombre, creado_por) values (v_correo, t.rol, null, true, v_nombre, auth.uid());
  perform seguridad.registrar_auditoria('seguridad.correo_permitido', 'INSERT', v_huella, null,
    jsonb_build_object('rol', t.rol, 'nombre', seguridad.sin_correos(v_nombre), 'activo', true), seguridad.canal_actual());
  v_res := jsonb_build_object('huella', v_huella, 'tipo', t.rol, 'estado', 'creada', 'activo', true,
                              'acceso_creado', exists (select 1 from auth.users u where seguridad.correo_canonico(u.email) = v_correo));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function api.cuenta_cambiar_estado(p_clave_idem text, p_correo text, p_activo boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_correo text; v_motivo text; c seguridad.correo_permitido; t seguridad.tipo_cuenta; v_uid uuid; v_res jsonb; v_huella text; v_activas int;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_activo is null then raise exception 'falta el estado' using errcode = '22023'; end if;
  v_correo := seguridad.correo_canonico(p_correo);
  v_huella := seguridad.huella_correo(v_correo);
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is not null and char_length(v_motivo) > 200 then raise exception 'el motivo pasa de 200 caracteres' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cuenta_cambiar_estado', 'h', v_huella, 'a', p_activo, 'm', v_motivo));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into c from seguridad.correo_permitido where correo = v_correo for update;
  if not found then raise exception 'cuenta desconocida' using errcode = '22023'; end if;
  select * into t from seguridad.tipo_cuenta where rol = c.rol;
  if not t.creable_web then raise exception 'esa cuenta no se administra desde la web' using errcode = '42501'; end if;

  if c.activo = p_activo then
    v_res := jsonb_build_object('huella', v_huella, 'activo', c.activo, 'estado', 'sin_cambio');
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if p_activo then
    select count(*) into v_activas from seguridad.correo_permitido x join seguridad.tipo_cuenta y on y.rol = x.rol where y.creable_web and x.activo;
    if v_activas >= 20 then raise exception 'se alcanzo el tope de cuentas creadas desde la web' using errcode = '54000'; end if;
  end if;
  update seguridad.correo_permitido set activo = p_activo, actualizado_en = now() where correo = v_correo;
  select u.id into v_uid from auth.users u where seguridad.correo_canonico(u.email) = v_correo;
  if v_uid is not null then
    update seguridad.usuario set activo = p_activo where id = v_uid;
    if not p_activo then delete from auth.sessions where user_id = v_uid; end if;
  end if;
  perform seguridad.registrar_auditoria('seguridad.correo_permitido', 'UPDATE', v_huella,
    jsonb_build_object('rol', c.rol, 'activo', c.activo), jsonb_build_object('rol', c.rol, 'activo', p_activo, 'motivo', seguridad.sin_correos(v_motivo)), seguridad.canal_actual());
  v_res := jsonb_build_object('huella', v_huella, 'activo', p_activo, 'estado', case when p_activo then 'reactivada' else 'desactivada' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on function seguridad.correo_canonico(text), seguridad.correo_valido(text), seguridad.huella_correo(text), seguridad.sin_correos(text) from public, anon, authenticated;
revoke execute on function api.cuenta_alta(text, text, text, text), api.cuenta_cambiar_estado(text, text, boolean, text) from public, anon;
grant execute on function api.cuenta_alta(text, text, text, text), api.cuenta_cambiar_estado(text, text, boolean, text) to authenticated;
