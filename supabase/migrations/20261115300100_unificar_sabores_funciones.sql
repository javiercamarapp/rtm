-- Unificacion de sabores, parte 2. Migracion ADITIVA (create or replace de funciones; mismos permisos: nada de catalogo.* se expone, api.* solo a authenticated con rol socio).
--
-- DISENO (por que es logica y no reescribe nada inmutable): 14 tablas apuntan a catalogo.sku(id) (kardex, existencias, conteos, compras, pedidos, surtidos, reservas, aperturas, devoluciones, paquetes...)
-- y casi todas son de solo insercion con hash encadenado o triggers de inmutabilidad. NINGUNA fila de esas tablas se modifica. Solo cambia el catalogo, que si es mutable:
--   * Si el modelo NO tiene un sku del sabor canonico: el sku del sabor origen se REASIGNA al canonico (mismo sku_id; todo el historial queda intacto y ahora muestra el nombre canonico).
--   * Si el modelo YA tiene ambos (caso real: Waka Blade): el sku origen se FUSIONA logicamente: queda inactivo y marcado sku.unificado_en = sku canonico. Sus filas historicas siguen apuntando a el;
--     el sabor origen conserva el nombre canonico como texto, asi que toda lectura que muestre o agrupe por nombre ya ve un solo sabor. Las altas, pedidos y compras nuevas resuelven al sku canonico.
--     Se BLOQUEA (sin escribir) si el sku origen tiene existencia, reservas, pedidos o compras abiertas, tomas pendientes o hay un conteo abierto: primero se traspasa o se cierra.
--   * El sabor origen queda unificado_en = canonico, su nombre viejo pasa a alias (catalogo.sabor_alias) y a sabor.nombre_original, y su llave unica de nombre se libera.
-- Todo reversible (catalogo.deshacer_unificacion_sabor), idempotente por clave, auditado y solo para socios. Nunca se unifica sin una respuesta de un socio o una aprobacion explicita por clave.

alter table catalogo.sabor_alias add column if not exists origen_unificacion bigint;

create table catalogo.unificacion_sabor (
  id bigint generated always as identity primary key,
  clave_idem text not null unique,
  origen_id bigint not null references catalogo.sabor (id),
  destino_id bigint not null references catalogo.sabor (id),
  nombre_origen text not null,
  nombre_destino_antes text not null,
  nombre_destino_despues text not null,
  -- [{sku_id, accion: 'reasignado' | 'fusionado', sku_destino}]
  detalle jsonb not null,
  alias_movidos bigint[] not null default '{}',
  aprobacion text not null,
  estado text not null default 'aplicada' check (estado in ('aplicada', 'deshecha')),
  canal text not null,
  por uuid,
  creada_at timestamptz not null default now(),
  deshecha_at timestamptz,
  deshecha_por uuid
);
alter table catalogo.unificacion_sabor enable row level security;
alter table catalogo.unificacion_sabor force row level security;
revoke all on catalogo.unificacion_sabor from public, anon, authenticated;
revoke all on all sequences in schema catalogo from public, anon, authenticated;

-- Motivos por los que un sku NO puede fusionarse con el canonico (vacio = se puede). Solo lectura.
create function catalogo.sku_bloqueos_unificacion(p_sku bigint) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when exists (select 1 from operacion.existencia_sku_ubicacion e where e.sku_id = p_sku and e.piezas <> 0) then 'tiene existencia' end,
    case when exists (select 1 from operacion.reserva r where r.sku_id = p_sku and r.estado = 'activa') then 'tiene una reserva activa' end,
    case when exists (select 1 from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where l.sku_id = p_sku and p.estado in ('borrador', 'confirmado')) then 'esta en un pedido abierto' end,
    case when exists (select 1 from operacion.compra_linea l join operacion.compra c on c.id = l.compra_id where l.sku_id = p_sku and c.estado not in ('recibida', 'cerrada', 'anulada')) then 'esta en una compra abierta' end,
    case when exists (select 1 from operacion.toma_omar t where t.sku_id = p_sku and t.estado = 'pendiente') then 'tiene una toma pendiente' end,
    case when exists (select 1 from operacion.conteo c where c.estado = 'abierto') then 'hay un conteo abierto' end], null)
$$;

-- Plan de una unificacion SIN escribir: por cada sku del origen, si se reasigna o se fusiona y que lo bloquea. Para --verificar del script y para la web.
create function catalogo.unificacion_plan(p_origen bigint, p_destino bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  return jsonb_build_object('origen', p_origen, 'destino', p_destino, 'skus', coalesce((
    select jsonb_agg(jsonb_build_object('sku_id', s.id, 'modelo', m.nombre_canonico,
             'accion', case when d.id is null then 'reasigna' else 'fusiona' end,
             'bloqueos', case when d.id is null then '[]'::jsonb else to_jsonb(catalogo.sku_bloqueos_unificacion(s.id)) end) order by s.id)
      from catalogo.sku s join catalogo.modelo m on m.id = s.modelo_id
      left join catalogo.sku d on d.modelo_id = s.modelo_id and d.sabor_id = p_destino and d.unificado_en is null
     where s.sabor_id = p_origen and s.unificado_en is null), '[]'::jsonb));
end $$;

-- Huella de todo lo que una unificacion NO debe tocar: kardex, existencias, pedidos, surtidos, eventos, asientos, cadena de hash del libro, cuenta 1310 y comprobaciones C1..C24.
create function catalogo.huella_inmutables() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  return jsonb_build_object(
    'kardex', (select md5(string_agg(to_jsonb(m)::text, '|' order by m.id)) from operacion.movimiento_inventario m),
    'kardex_n', (select count(*) from operacion.movimiento_inventario),
    'existencia_sku', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.sku_id, e.ubicacion)) from operacion.existencia_sku_ubicacion e),
    'existencia_modelo', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.modelo_id)) from operacion.existencia_modelo e),
    'pedido_linea', (select md5(string_agg(to_jsonb(l)::text, '|' order by l.id)) from operacion.pedido_linea l),
    'surtido', (select md5(string_agg(to_jsonb(s)::text, '|' order by s.id)) from operacion.pedido_surtido s),
    'eventos', (select md5(string_agg(to_jsonb(e)::text, '|' order by e.id)) from operacion.evento e),
    'asientos', (select md5(string_agg(to_jsonb(a)::text, '|' order by a.id)) from contabilidad.asiento a),
    'asientos_n', (select count(*) from contabilidad.asiento),
    'cadena', contabilidad.verificar_cadena(),
    'c1310', contabilidad.saldo('1310'),
    'comprobaciones', (select jsonb_agg(jsonb_build_object('c', c.codigo, 'ok', c.ok, 'a', c.via_a_cent, 'b', c.via_b_cent) order by c.codigo) from contabilidad.comprobaciones() c),
    'rojas', (select count(*) from contabilidad.comprobaciones() c where not c.ok and c.bloqueante));
end $$;

-- ---------------------------------------------------------------------------
-- Unificar dos sabores (nucleo). Solo con una pregunta pendiente de ESE par (respuesta de un socio) o con una aprobacion explicita por clave.
-- Devuelve estado: 'unificado' | 'ya_unificado' | 'bloqueado' (con los motivos; no escribe nada).
-- ---------------------------------------------------------------------------
create function catalogo.unificar_sabor(p_clave_idem text, p_origen bigint, p_destino bigint, p_canal text default 'web', p_nombre_final text default null,
                                        p_pregunta_id bigint default null, p_aprobacion text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; o catalogo.sabor; d catalogo.sabor; q catalogo.posible_duplicado; v_final text; v_det jsonb := '[]'::jsonb; v_bloq jsonb := '[]'::jsonb; k record; m text[];
  v_aprob text; v_rea int := 0; v_fus int := 0; v_alias bigint[]; v_uid bigint; v_res jsonb; v_norm_o text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then raise exception 'elige dos sabores distintos' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'unificar_sabor', 'o', p_origen, 'd', p_destino, 'n', p_nombre_final, 'q', p_pregunta_id, 'a', p_aprobacion));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_sabor', 0));

  select * into o from catalogo.sabor where id = p_origen for update;
  if not found then raise exception 'sabor origen desconocido' using errcode = '22023'; end if;
  select * into d from catalogo.sabor where id = p_destino for update;
  if not found then raise exception 'sabor destino desconocido' using errcode = '22023'; end if;
  if o.unificado_en is not null then
    v_res := jsonb_build_object('estado', 'ya_unificado', 'origen', o.nombre_canonico, 'destino', (select nombre_canonico from catalogo.sabor where id = o.unificado_en));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if d.unificado_en is not null then raise exception 'el sabor destino ya fue unificado en otro; elige el vigente' using errcode = '22023'; end if;

  -- La regla central: nunca solo. Respuesta de un socio a la pregunta de ESTE par, o aprobacion explicita por clave (catalogo.unificacion_aprobada).
  if p_pregunta_id is not null then
    select * into q from catalogo.posible_duplicado where id = p_pregunta_id for update;
    if not found or q.tipo <> 'sabor' or q.id_a <> least(p_origen, p_destino) or q.id_b <> greatest(p_origen, p_destino) then
      raise exception 'la pregunta no corresponde a estos sabores' using errcode = '22023';
    end if;
    if q.estado <> 'pendiente' then raise exception 'esa pregunta ya fue contestada' using errcode = '22023'; end if;
    v_aprob := 'pregunta:' || q.id::text;
  elsif p_aprobacion is not null then
    if not exists (select 1 from catalogo.unificacion_aprobada a where a.clave = p_aprobacion and a.origen_norm = o.nombre_norm and a.destino_norm = d.nombre_norm) then
      raise exception 'aprobacion explicita no reconocida para este par' using errcode = '42501';
    end if;
    v_aprob := 'clave:' || p_aprobacion;
  else
    raise exception 'una unificacion exige la respuesta de un socio o una aprobacion explicita' using errcode = '42501';
  end if;

  v_final := case when nullif(btrim(p_nombre_final), '') is null then d.nombre_canonico else catalogo.nombre_alta_valido(p_nombre_final, 40) end;
  if catalogo.normalizar(v_final) <> d.nombre_norm and exists (select 1 from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(v_final) and s.id not in (p_origen, p_destino)) then
    raise exception 'ese nombre ya lo usa otro sabor' using errcode = '22023';
  end if;

  for k in
    select s.id as sku_id, s.modelo_id, (select ds.id from catalogo.sku ds where ds.modelo_id = s.modelo_id and ds.sabor_id = p_destino and ds.unificado_en is null) as dest_sku
      from catalogo.sku s where s.sabor_id = p_origen and s.unificado_en is null order by s.id
  loop
    if k.dest_sku is null then
      v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'accion', 'reasignado', 'sku_destino', k.sku_id);
    else
      m := catalogo.sku_bloqueos_unificacion(k.sku_id);
      if cardinality(m) > 0 then
        v_bloq := v_bloq || jsonb_build_object('sku_id', k.sku_id, 'modelo', (select nombre_canonico from catalogo.modelo where id = k.modelo_id), 'motivos', to_jsonb(m));
      else
        v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'accion', 'fusionado', 'sku_destino', k.dest_sku);
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_bloq) > 0 then
    delete from seguridad.operacion where clave = p_clave_idem;
    return jsonb_build_object('estado', 'bloqueado', 'origen', o.nombre_canonico, 'destino', d.nombre_canonico, 'bloqueos', v_bloq,
                              'ayuda', 'El sku del sabor origen tiene movimiento pendiente. Cierra el conteo, recibe o cancela lo abierto, o traspasa la existencia al sabor canonico, y vuelve a intentar.');
  end if;

  v_norm_o := o.nombre_norm;
  update catalogo.sabor set nombre_original = nombre_canonico, nombre_canonico = v_final, unificado_en = p_destino, unificado_at = now() where id = p_origen;
  if v_final <> d.nombre_canonico then update catalogo.sabor set nombre_canonico = v_final where id = p_destino; end if;
  for k in select (e ->> 'sku_id')::bigint as sku_id, e ->> 'accion' as accion, (e ->> 'sku_destino')::bigint as sku_destino from jsonb_array_elements(v_det) e loop
    if k.accion = 'reasignado' then
      update catalogo.sku set sabor_id = p_destino where id = k.sku_id;
      v_rea := v_rea + 1;
    else
      update catalogo.sku set activo = false, unificado_en = k.sku_destino where id = k.sku_id;
      v_fus := v_fus + 1;
    end if;
  end loop;
  select coalesce(array_agg(id), '{}') into v_alias from catalogo.sabor_alias where sabor_id = p_origen;
  update catalogo.sabor_alias set sabor_id = p_destino where sabor_id = p_origen;
  insert into catalogo.sabor_alias (alias_norm, sabor_id, origen_unificacion) values (v_norm_o, p_destino, null)
    on conflict (alias_norm) do update set sabor_id = excluded.sabor_id;
  insert into catalogo.unificacion_sabor (clave_idem, origen_id, destino_id, nombre_origen, nombre_destino_antes, nombre_destino_despues, detalle, alias_movidos, aprobacion, canal, por)
    values (p_clave_idem, p_origen, p_destino, o.nombre_canonico, d.nombre_canonico, v_final, v_det, v_alias, v_aprob, p_canal, auth.uid()) returning id into v_uid;
  update catalogo.sabor_alias set origen_unificacion = v_uid where alias_norm = v_norm_o;
  if p_pregunta_id is not null then
    update catalogo.posible_duplicado set estado = 'unido', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal, canonico_id = p_destino, unificacion_id = v_uid where id = p_pregunta_id;
  end if;
  perform seguridad.registrar_auditoria('catalogo.sabor', 'UNIFICACION', p_origen::text,
    jsonb_build_object('origen', o.nombre_canonico, 'destino', d.nombre_canonico),
    jsonb_build_object('unificacion_id', v_uid, 'destino_id', p_destino, 'nombre_final', v_final, 'skus', v_det, 'aprobacion', v_aprob, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'unificado', 'unificacion_id', v_uid, 'origen', o.nombre_canonico, 'destino', v_final, 'skus_reasignados', v_rea, 'skus_fusionados', v_fus, 'aprobacion', v_aprob);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Deshacer: devuelve los sku a su sabor, reactiva los fusionados, restaura los nombres y quita el alias. La pregunta vuelve a quedar pendiente.
-- No toca lo registrado despues sobre el sku canonico (sigue siendo valido). Se rechaza si otro sabor ya ocupa el nombre original.
create function catalogo.deshacer_unificacion_sabor(p_clave_idem text, p_unificacion_id bigint, p_canal text default 'web') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; u catalogo.unificacion_sabor; o catalogo.sabor; e jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'deshacer_unificacion_sabor', 'u', p_unificacion_id));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_sabor', 0));
  select * into u from catalogo.unificacion_sabor where id = p_unificacion_id for update;
  if not found then raise exception 'unificacion desconocida' using errcode = '22023'; end if;
  if u.estado = 'deshecha' then
    v_res := jsonb_build_object('estado', 'ya_deshecha', 'unificacion_id', u.id);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  select * into o from catalogo.sabor where id = u.origen_id for update;
  if exists (select 1 from catalogo.sabor s where s.nombre_norm = catalogo.normalizar(o.nombre_original) and s.id <> o.id) then
    raise exception 'otro sabor ya usa el nombre original; no se puede deshacer sin renombrarlo' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(u.detalle) loop
    if e ->> 'accion' = 'reasignado' then
      update catalogo.sku set sabor_id = u.origen_id where id = (e ->> 'sku_id')::bigint and sabor_id = u.destino_id;
    else
      update catalogo.sku set activo = true, unificado_en = null where id = (e ->> 'sku_id')::bigint;
    end if;
  end loop;
  delete from catalogo.sabor_alias where alias_norm = catalogo.normalizar(o.nombre_original) and sabor_id = u.destino_id;
  update catalogo.sabor_alias set sabor_id = u.origen_id where id = any (u.alias_movidos);
  update catalogo.sabor set unificado_en = null, unificado_at = null, nombre_canonico = o.nombre_original, nombre_original = null where id = u.origen_id;
  if u.nombre_destino_despues <> u.nombre_destino_antes then update catalogo.sabor set nombre_canonico = u.nombre_destino_antes where id = u.destino_id; end if;
  update catalogo.unificacion_sabor set estado = 'deshecha', deshecha_at = now(), deshecha_por = auth.uid() where id = u.id;
  update catalogo.posible_duplicado set estado = 'pendiente', respondido_por = null, respondido_at = null, canal = null, canonico_id = null, unificacion_id = null where unificacion_id = u.id;
  perform seguridad.registrar_auditoria('catalogo.sabor', 'UNIFICACION_DESHECHA', u.origen_id::text, null, jsonb_build_object('unificacion_id', u.id, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'deshecha', 'unificacion_id', u.id, 'origen', o.nombre_original, 'destino', u.nombre_destino_antes);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Responde una pregunta de la cola (nucleo; lo usan la web y el bot). 'si' en un sabor unifica (canonico por omision: el que tiene mas sku, luego el de id menor);
-- 'si' en un modelo o cliente solo queda confirmado (la unificacion de esos tipos es fase posterior: mueve saldos y dinero). 'no' guarda el NEGATIVO.
create function catalogo.responder_duplicado(p_clave_idem text, p_id bigint, p_respuesta text, p_canonico_id bigint default null, p_nombre_final text default null, p_canal text default 'web') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; q catalogo.posible_duplicado; v_dest bigint; v_orig bigint; v_res jsonb; v_na int; v_nb int;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_canal not in ('web', 'telegram') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if p_respuesta not in ('si', 'no') then raise exception 'la respuesta es si o no' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'responder_duplicado', 'id', p_id, 'r', p_respuesta, 'c', p_canonico_id, 'n', p_nombre_final));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  select * into q from catalogo.posible_duplicado where id = p_id for update;
  if not found then raise exception 'pregunta desconocida' using errcode = '22023'; end if;
  if q.estado <> 'pendiente' then
    v_res := jsonb_build_object('estado', 'ya_contestada', 'estado_pregunta', q.estado, 'pregunta_id', q.id);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if p_respuesta = 'no' then
    update catalogo.posible_duplicado set estado = 'distinto', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal where id = q.id;
    perform seguridad.registrar_auditoria('catalogo.posible_duplicado', 'NEGATIVO', q.id::text, null, jsonb_build_object('tipo', q.tipo, 'id_a', q.id_a, 'id_b', q.id_b, 'origen_canal', p_canal), p_canal);
    v_res := jsonb_build_object('estado', 'distinto', 'pregunta_id', q.id);
  elsif q.tipo <> 'sabor' then
    update catalogo.posible_duplicado set estado = 'confirmado_igual', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal where id = q.id;
    perform seguridad.registrar_auditoria('catalogo.posible_duplicado', 'CONFIRMADO_IGUAL', q.id::text, null, jsonb_build_object('tipo', q.tipo, 'id_a', q.id_a, 'id_b', q.id_b, 'origen_canal', p_canal), p_canal);
    v_res := jsonb_build_object('estado', 'confirmado_igual', 'pregunta_id', q.id, 'nota', 'La union de modelos y clientes no se ejecuta todavia: mueve saldos y dinero (fase posterior).');
  else
    if p_canonico_id is not null and p_canonico_id not in (q.id_a, q.id_b) then raise exception 'el canonico debe ser uno de los dos sabores' using errcode = '22023'; end if;
    if p_canonico_id is null then
      select count(*) filter (where sabor_id = q.id_a), count(*) filter (where sabor_id = q.id_b) into v_na, v_nb from catalogo.sku where sabor_id in (q.id_a, q.id_b) and unificado_en is null;
      v_dest := case when v_nb > v_na then q.id_b else q.id_a end;
    else
      v_dest := p_canonico_id;
    end if;
    v_orig := case when v_dest = q.id_a then q.id_b else q.id_a end;
    v_res := catalogo.unificar_sabor(p_clave_idem || ':u', v_orig, v_dest, p_canal, p_nombre_final, q.id, null);
    v_res := v_res || jsonb_build_object('pregunta_id', q.id);
    if v_res ->> 'estado' = 'bloqueado' then delete from seguridad.operacion where clave = p_clave_idem; return v_res; end if;
  end if;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Puertas de la web (solo socios).
-- ---------------------------------------------------------------------------
-- Preguntas pendientes, de mayor a menor puntaje, con lo que cada nombre tiene en el catalogo para decidir cual queda como canonico.
create function api.duplicados_pendientes(p_tipo text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_tipo is not null and p_tipo not in ('sabor', 'modelo', 'cliente') then raise exception 'tipo invalido' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'tipo', d.tipo, 'puntaje', d.puntaje, 'clase', d.clase, 'motivo', d.motivo, 'ambiguo', d.ambiguo, 'preguntado_at', d.preguntado_at,
      'a', jsonb_build_object('id', d.id_a, 'nombre', n.na, 'skus', n.sa, 'lineas_pedido', n.la, 'piezas', n.pa),
      'b', jsonb_build_object('id', d.id_b, 'nombre', n.nb, 'skus', n.sb, 'lineas_pedido', n.lb, 'piezas', n.pb),
      'pregunta', '¿"' || n.na || '" es lo mismo que "' || n.nb || '"?',
      'canonico_sugerido', case when n.sb > n.sa then d.id_b else d.id_a end,
      'se_puede_unir', d.tipo = 'sabor') order by d.puntaje desc, d.id)
    from catalogo.posible_duplicado d
    cross join lateral (select
        case d.tipo when 'sabor' then (select nombre_canonico from catalogo.sabor where id = d.id_a) when 'modelo' then (select nombre_canonico from catalogo.modelo where id = d.id_a) else (select nombre_canonico from catalogo.cliente where id = d.id_a) end as na,
        case d.tipo when 'sabor' then (select nombre_canonico from catalogo.sabor where id = d.id_b) when 'modelo' then (select nombre_canonico from catalogo.modelo where id = d.id_b) else (select nombre_canonico from catalogo.cliente where id = d.id_b) end as nb,
        case when d.tipo = 'sabor' then (select count(*) from catalogo.sku k where k.sabor_id = d.id_a and k.unificado_en is null) else 0 end as sa,
        case when d.tipo = 'sabor' then (select count(*) from catalogo.sku k where k.sabor_id = d.id_b and k.unificado_en is null) else 0 end as sb,
        case when d.tipo = 'sabor' then (select count(*) from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id where k.sabor_id = d.id_a) else 0 end as la,
        case when d.tipo = 'sabor' then (select count(*) from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id where k.sabor_id = d.id_b) else 0 end as lb,
        case when d.tipo = 'sabor' then (select coalesce(sum(e.piezas), 0) from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.sabor_id = d.id_a) else 0 end as pa,
        case when d.tipo = 'sabor' then (select coalesce(sum(e.piezas), 0) from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.sabor_id = d.id_b) else 0 end as pb) n
    where d.estado = 'pendiente' and (p_tipo is null or d.tipo = p_tipo)
      and not (d.tipo = 'sabor' and exists (select 1 from catalogo.sabor s where s.id in (d.id_a, d.id_b) and s.unificado_en is not null))
      and n.na is not null and n.nb is not null), '[]'::jsonb);
end $$;

create function api.duplicado_responder(p_clave_idem text, p_id bigint, p_respuesta text, p_canonico_id bigint default null, p_nombre_final text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return catalogo.responder_duplicado(p_clave_idem, p_id, p_respuesta, p_canonico_id, p_nombre_final, 'web');
end $$;

create function api.duplicados_escanear(p_tipo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return catalogo.escanear_duplicados(p_tipo);
end $$;

create function api.sabor_unificacion_deshacer(p_clave_idem text, p_unificacion_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return catalogo.deshacer_unificacion_sabor(p_clave_idem, p_unificacion_id, 'web');
end $$;

create function api.sabor_unificaciones(p_limite int default 10) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'origen', x.nombre_origen, 'destino', x.nombre_destino_despues, 'estado', x.estado, 'creada_at', x.creada_at, 'skus', jsonb_array_length(x.detalle)) order by x.id desc)
    from (select * from catalogo.unificacion_sabor order by id desc limit greatest(least(coalesce(p_limite, 10), 50), 1)) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Alta de sabor: consulta la deteccion ANTES de crear.
--   IGUAL_NORMALIZADO o MUY_PROBABLE (sin confirmar): NO crea; devuelve estado 'parecidos' con la pregunta ("¿'Passion Fruit' es lo mismo que 'Passionfruit'?").
--   POSIBLE: crea y deja la pregunta pendiente en la cola.
--   p_confirmar = el socio dice "no, es distinto": crea y guarda los pares como NEGATIVO (no se vuelven a preguntar).
--   Un nombre que ya es alias de un sabor (por una unificacion) resuelve al sabor canonico.
-- Misma firma y mismos permisos que la version anterior.
-- ---------------------------------------------------------------------------
create or replace function catalogo.alta_sabor(p_clave_idem text, p_modelo_id bigint, p_sabor text, p_canal text default 'web', p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_sabor text; v_modelo catalogo.modelo; v_norm text; v_sku bigint; v_sabor_id bigint; v_cand jsonb; v_par jsonb; v_hora int; v_dia int; v_res jsonb; v_existia boolean; v_bloquea boolean;
  v_preg int := 0; c record;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_sabor := catalogo.nombre_alta_valido(p_sabor, 40);
  v_norm := catalogo.normalizar(v_sabor);
  if v_norm = '' then raise exception 'el nombre trae caracteres no permitidos' using errcode = '22023'; end if;
  select * into v_modelo from catalogo.modelo where id = p_modelo_id;
  if not found then raise exception 'modelo desconocido' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alta_sabor', 'm', p_modelo_id, 's', v_norm, 'c', p_confirmar));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select id into v_sabor_id from catalogo.sabor where nombre_norm = v_norm;
  if v_sabor_id is null then select a.sabor_id into v_sabor_id from catalogo.sabor_alias a where a.alias_norm = v_norm; end if;
  if v_sabor_id is not null then
    select id into v_sku from catalogo.sku where modelo_id = p_modelo_id and sabor_id = v_sabor_id and unificado_en is null;
    if v_sku is not null then
      v_res := jsonb_build_object('estado', 'existente', 'sku_id', v_sku, 'modelo', v_modelo.nombre_canonico, 'sabor', (select nombre_canonico from catalogo.sabor where id = v_sabor_id));
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
  else
    -- Sabor que no existe: se compara con todo el catalogo (normalizacion, diccionario, orden, errores de dedo, prefijos).
    select coalesce(jsonb_agg(jsonb_build_object('sabor_id', q.id, 'nombre', q.nombre, 'puntaje', q.puntaje, 'clase', q.clase, 'motivo', q.motivo, 'ambiguo', q.ambiguo,
             'ya_en_modelo', exists (select 1 from catalogo.sku k where k.sabor_id = q.id and k.modelo_id = p_modelo_id and k.unificado_en is null)) order by q.puntaje desc, q.nombre), '[]'::jsonb)
      into v_cand from catalogo.candidatos_duplicado('sabor', v_sabor, null, 50) q;
    v_bloquea := exists (select 1 from jsonb_array_elements(v_cand) e where e ->> 'clase' in ('IGUAL_NORMALIZADO', 'MUY_PROBABLE'));
    if v_bloquea and not p_confirmar then
      select coalesce(jsonb_agg(jsonb_build_object('sabor_id', e -> 'sabor_id', 'nombre', e -> 'nombre') order by o), '[]'::jsonb) into v_par from jsonb_array_elements(v_cand) with ordinality t(e, o);
      v_res := jsonb_build_object('estado', 'parecidos', 'parecidos', v_par, 'candidatos', v_cand, 'sabor', v_sabor, 'modelo', v_modelo.nombre_canonico,
                                  'pregunta', '¿"' || v_sabor || '" es lo mismo que "' || (v_cand -> 0 ->> 'nombre') || '"?');
      -- No se guarda la operacion: el socio puede repetirla con p_confirmar (son distintos) o usar el nombre existente (son lo mismo).
      delete from seguridad.operacion where clave = p_clave_idem;
      return v_res;
    end if;
  end if;

  -- Serializa el conteo de topes por actor: sin esto dos altas simultaneas leian 9 y pasaban las dos (carrera que dejo 11).
  perform pg_advisory_xact_lock(hashtextextended('alta_sabor:' || coalesce(auth.uid()::text, p_canal), 0));
  select count(*) filter (where ocurrio_en > now() - interval '1 hour'), count(*) filter (where ocurrio_en > now() - interval '1 day') into v_hora, v_dia
    from seguridad.auditoria where tabla = 'catalogo.sku' and accion = 'ALTA_ASISTIDA' and actor is not distinct from auth.uid();
  if v_hora >= 10 then raise exception 'tope de altas por hora alcanzado (10)' using errcode = '54000'; end if;
  if v_dia >= 30 then raise exception 'tope de altas por dia alcanzado (30)' using errcode = '54000'; end if;

  v_existia := v_sabor_id is not null;
  if v_sabor_id is null then insert into catalogo.sabor (nombre_canonico) values (v_sabor) returning id into v_sabor_id; end if;
  insert into catalogo.sku (modelo_id, sabor_id) values (p_modelo_id, v_sabor_id) on conflict (modelo_id, sabor_id) do nothing;
  select id into v_sku from catalogo.sku where modelo_id = p_modelo_id and sabor_id = v_sabor_id and unificado_en is null;
  if not v_existia and jsonb_array_length(coalesce(v_cand, '[]'::jsonb)) > 0 then
    for c in select (e ->> 'sabor_id')::bigint as sid, e ->> 'motivo' as motivo, (e ->> 'puntaje')::int as puntaje, e ->> 'clase' as clase, (e ->> 'ambiguo')::boolean as ambiguo from jsonb_array_elements(v_cand) e loop
      if p_confirmar then
        -- "No, es distinto": negativo guardado, no se vuelve a preguntar.
        insert into catalogo.posible_duplicado (tipo, id_a, id_b, motivo, puntaje, clase, ambiguo, estado, respondido_por, respondido_at, canal)
          values ('sabor', least(v_sabor_id, c.sid), greatest(v_sabor_id, c.sid), c.motivo, c.puntaje, c.clase, c.ambiguo, 'distinto', auth.uid(), now(), p_canal) on conflict (tipo, id_a, id_b) do nothing;
      else
        if catalogo.registrar_posible_duplicado('sabor', v_sabor_id, c.sid, c.motivo, c.puntaje, c.clase, c.ambiguo) is not null then v_preg := v_preg + 1; end if;
      end if;
    end loop;
  end if;
  perform seguridad.registrar_auditoria('catalogo.sku', 'ALTA_ASISTIDA', v_sku::text, null,
    jsonb_build_object('modelo_id', p_modelo_id, 'sabor', v_sabor, 'sabor_nuevo', not v_existia, 'origen', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'creado', 'sku_id', v_sku, 'modelo', v_modelo.nombre_canonico, 'sabor', (select nombre_canonico from catalogo.sabor where id = v_sabor_id), 'sabor_nuevo', not v_existia,
                              'falta_costo_lista', not exists (select 1 from catalogo.costo_proveedor c2 where c2.modelo_id = p_modelo_id), 'preguntas_pendientes', v_preg);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Un nombre que es alias de un sabor unificado resuelve al sabor vigente; nunca recrea el duplicado (el importador y las altas por nombre pasan por aqui).
create or replace function catalogo.asegurar_sabor(p_nombre text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_id from catalogo.sabor where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is null then select a.sabor_id into v_id from catalogo.sabor_alias a where a.alias_norm = catalogo.normalizar(p_nombre); end if;
  if v_id is null then insert into catalogo.sabor (nombre_canonico) values (btrim(p_nombre)) returning id into v_id; end if;
  return v_id;
end $$;

-- Un sku fusionado es historia: no se ofrece en la hoja de conteo ni en las listas del agente.
create or replace function api.conteo_hoja(p_ubicacion text default 'bodega_omar') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'modelo_id', m.id) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
    from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
   where k.unificado_en is null and exists (select 1 from operacion.existencia_sku_ubicacion u join catalogo.sku k2 on k2.id = u.sku_id where u.ubicacion = p_ubicacion and k2.modelo_id = k.modelo_id)), '[]'::jsonb);
end $$;

create or replace function agente.sabores_de(p_modelo bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'nombre', s.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.sabor_alias a where a.sabor_id = s.id), '[]'::jsonb)) order by s.nombre_canonico)
    from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = p_modelo and k.unificado_en is null), '[]'::jsonb);
end $$;

create or replace function agente.sabores_en_existencia(p_modelo bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'nombre', s.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.sabor_alias a where a.sabor_id = s.id), '[]'::jsonb)) order by s.nombre_canonico)
    from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id join operacion.existencia_sku_ubicacion u on u.sku_id = k.id and u.piezas > 0 where k.modelo_id = p_modelo and k.unificado_en is null), '[]'::jsonb);
end $$;

revoke execute on function catalogo.sku_bloqueos_unificacion(bigint), catalogo.unificacion_plan(bigint, bigint), catalogo.huella_inmutables(),
  catalogo.unificar_sabor(text, bigint, bigint, text, text, bigint, text), catalogo.deshacer_unificacion_sabor(text, bigint, text),
  catalogo.responder_duplicado(text, bigint, text, bigint, text, text) from public, anon, authenticated;
revoke execute on function api.duplicados_pendientes(text), api.duplicado_responder(text, bigint, text, bigint, text), api.duplicados_escanear(text),
  api.sabor_unificacion_deshacer(text, bigint), api.sabor_unificaciones(int) from public, anon;
grant execute on function api.duplicados_pendientes(text), api.duplicado_responder(text, bigint, text, bigint, text), api.duplicados_escanear(text),
  api.sabor_unificacion_deshacer(text, bigint), api.sabor_unificaciones(int) to authenticated;
