-- Rol 'bodega' y administracion de cuentas por correo (solo socio).
--  * Catalogo extensible de tipos de cuenta (seguridad.tipo_cuenta). `creable_web` decide que tipos puede dar de alta un socio desde la web.
--    Solo bodega es creable desde la web; socio y omar NO lo son (escalada de privilegios; Omar se activa por el flujo de M2). Un CHECK impide marcar socio como creable.
--  * El acceso sigue siendo por la lista de correos permitidos + enlace magico: una cuenta nueva es una fila de seguridad.correo_permitido. El usuario de Auth se crea
--    con el script `acceso:cuentas` (administracion de Auth, nunca desde la web ni con la llave de servicio en el servidor de la app).
--  * api.cuentas_lista / api.cuenta_alta / api.cuenta_cambiar_estado: solo socio, idempotentes, con auditoria. Nunca cambian el tipo de un correo ya existente.
--  * Aditiva: no toca datos ni funciones existentes (las filas de socio y omar no cambian).

-- ---------------------------------------------------------------------------
-- Catalogo de tipos de cuenta
-- ---------------------------------------------------------------------------
create table seguridad.tipo_cuenta (
  rol text primary key check (rol ~ '^[a-z]{3,20}$'),
  etiqueta text not null,
  descripcion text not null,
  creable_web boolean not null default false,
  -- Un socio nunca se crea desde la web: dar socio es dar el negocio entero (dinero, costos, cuentas).
  check (not (creable_web and rol in ('socio', 'omar', 'importacion')))
);
insert into seguridad.tipo_cuenta (rol, etiqueta, descripcion, creable_web) values
  ('socio', 'Socio', 'Acceso total al negocio. Solo se da de alta por el flujo de acceso, nunca desde la web.', false),
  ('omar', 'Omar', 'Vista propia de la bodega de Omar. Su cuenta se activa por el flujo de M2, no desde la web.', false),
  ('bodega', 'Bodega', 'Ve solo lo que hay que preparar hoy (cliente y piezas) y las llegadas de inventario por guardar. Sin dinero, costos ni contactos.', true);
alter table seguridad.tipo_cuenta enable row level security;
alter table seguridad.tipo_cuenta force row level security;
revoke all on seguridad.tipo_cuenta from public, anon, authenticated;

-- El rol de la lista y del usuario sale del catalogo (extensible por migracion), no de una lista fija en un CHECK.
alter table seguridad.correo_permitido drop constraint correo_permitido_rol_check;
alter table seguridad.usuario drop constraint usuario_rol_check;
alter table seguridad.correo_permitido add constraint correo_permitido_rol_fk foreign key (rol) references seguridad.tipo_cuenta (rol);
alter table seguridad.usuario add constraint usuario_rol_fk foreign key (rol) references seguridad.tipo_cuenta (rol);

alter table seguridad.correo_permitido
  add column nombre text check (nombre is null or char_length(btrim(nombre)) between 1 and 60),
  add column creado_por uuid,
  add column actualizado_en timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Lectura: lista de cuentas (solo socio)
-- ---------------------------------------------------------------------------
create function api.cuentas_lista() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('rol', t.rol, 'etiqueta', t.etiqueta, 'descripcion', t.descripcion, 'creable_web', t.creable_web) order by t.creable_web desc, t.rol)
                         from seguridad.tipo_cuenta t), '[]'::jsonb),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'correo', c.correo, 'rol', c.rol, 'tipo', t.etiqueta, 'nombre', c.nombre, 'activo', c.activo,
        'gestionable', t.creable_web,
        'acceso_creado', exists (select 1 from auth.users u where lower(u.email) = c.correo),
        'ultimo_ingreso', (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = c.correo),
        'creado_en', c.creado_en) order by (c.rol = 'socio') desc, c.rol, c.correo)
      from seguridad.correo_permitido c join seguridad.tipo_cuenta t on t.rol = c.rol), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Alta de un correo con tipo. Idempotente por clave. No cambia el tipo de un correo existente.
-- ---------------------------------------------------------------------------
create function api.cuenta_alta(p_clave_idem text, p_correo text, p_tipo text, p_nombre text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_correo text; v_nombre text; t seguridad.tipo_cuenta; c seguridad.correo_permitido; v_res jsonb; v_activas int;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_correo := lower(btrim(coalesce(p_correo, '')));
  if char_length(v_correo) > 254 or v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'correo invalido' using errcode = '22023'; end if;
  v_nombre := nullif(btrim(coalesce(p_nombre, '')), '');
  if v_nombre is not null and char_length(v_nombre) > 60 then raise exception 'el nombre pasa de 60 caracteres' using errcode = '22023'; end if;
  select * into t from seguridad.tipo_cuenta where rol = p_tipo;
  if not found then raise exception 'tipo de cuenta desconocido' using errcode = '22023'; end if;
  -- Escalada de privilegios: solo los tipos marcados creables desde la web (hoy, bodega).
  if not t.creable_web then raise exception 'ese tipo de cuenta no se crea desde la web' using errcode = '42501'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cuenta_alta', 'c', v_correo, 't', t.rol, 'n', v_nombre));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into c from seguridad.correo_permitido where correo = v_correo for update;
  if found then
    -- Un correo ya existente NUNCA cambia de tipo desde aqui (ni sube ni baja): mismo tipo = sin cambio; otro tipo = conflicto.
    if c.rol <> t.rol then raise exception 'ese correo ya tiene otro tipo de cuenta' using errcode = '23505'; end if;
    v_res := jsonb_build_object('correo', v_correo, 'tipo', t.rol, 'estado', case when c.activo then 'sin_cambio' else 'desactivada' end, 'activo', c.activo);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  -- Un usuario de Auth que ya existe con otro tipo tampoco se reutiliza.
  if exists (select 1 from auth.users u join seguridad.usuario s on s.id = u.id where lower(u.email) = v_correo and s.rol <> t.rol) then
    raise exception 'ese correo ya tiene otro tipo de cuenta' using errcode = '23505';
  end if;
  select count(*) into v_activas from seguridad.correo_permitido x join seguridad.tipo_cuenta y on y.rol = x.rol where y.creable_web and x.activo;
  if v_activas >= 20 then raise exception 'se alcanzo el tope de cuentas creadas desde la web' using errcode = '54000'; end if;

  insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo, nombre, creado_por) values (v_correo, t.rol, null, true, v_nombre, auth.uid());
  -- El correo no se guarda en la auditoria (solo su huella): el rastro dice quien hizo que, sin copiar el dato personal.
  perform seguridad.registrar_auditoria('seguridad.correo_permitido', 'INSERT', left(encode(sha256(convert_to(v_correo, 'UTF8')), 'hex'), 16), null,
    jsonb_build_object('rol', t.rol, 'nombre', v_nombre, 'activo', true), seguridad.canal_actual());
  v_res := jsonb_build_object('correo', v_correo, 'tipo', t.rol, 'estado', 'creada', 'activo', true,
                              'acceso_creado', exists (select 1 from auth.users u where lower(u.email) = v_correo));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Desactivar / reactivar (sin borrar). Solo tipos administrables desde la web: nunca un socio ni Omar.
-- ---------------------------------------------------------------------------
create function api.cuenta_cambiar_estado(p_clave_idem text, p_correo text, p_activo boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_correo text; v_motivo text; c seguridad.correo_permitido; t seguridad.tipo_cuenta; v_uid uuid; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_activo is null then raise exception 'falta el estado' using errcode = '22023'; end if;
  v_correo := lower(btrim(coalesce(p_correo, '')));
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is not null and char_length(v_motivo) > 200 then raise exception 'el motivo pasa de 200 caracteres' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cuenta_cambiar_estado', 'c', v_correo, 'a', p_activo, 'm', v_motivo));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into c from seguridad.correo_permitido where correo = v_correo for update;
  if not found then raise exception 'cuenta desconocida' using errcode = '22023'; end if;
  select * into t from seguridad.tipo_cuenta where rol = c.rol;
  if not t.creable_web then raise exception 'esa cuenta no se administra desde la web' using errcode = '42501'; end if;

  if c.activo = p_activo then
    v_res := jsonb_build_object('correo', v_correo, 'activo', c.activo, 'estado', 'sin_cambio');
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  update seguridad.correo_permitido set activo = p_activo, actualizado_en = now() where correo = v_correo;
  select u.id into v_uid from auth.users u where lower(u.email) = v_correo;
  if v_uid is not null then
    update seguridad.usuario set activo = p_activo where id = v_uid;
    -- Desactivar tambien cierra las sesiones abiertas (el acceso ya se corta solo: exigir_rol y la guarda leen `activo` en cada llamada).
    if not p_activo then delete from auth.sessions where user_id = v_uid; end if;
  end if;
  perform seguridad.registrar_auditoria('seguridad.correo_permitido', 'UPDATE', left(encode(sha256(convert_to(v_correo, 'UTF8')), 'hex'), 16),
    jsonb_build_object('rol', c.rol, 'activo', c.activo), jsonb_build_object('rol', c.rol, 'activo', p_activo, 'motivo', v_motivo), seguridad.canal_actual());
  v_res := jsonb_build_object('correo', v_correo, 'activo', p_activo, 'estado', case when p_activo then 'reactivada' else 'desactivada' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on function api.cuentas_lista(), api.cuenta_alta(text, text, text, text), api.cuenta_cambiar_estado(text, text, boolean, text) from public, anon;
grant execute on function api.cuentas_lista(), api.cuenta_alta(text, text, text, text), api.cuenta_cambiar_estado(text, text, boolean, text) to authenticated;
