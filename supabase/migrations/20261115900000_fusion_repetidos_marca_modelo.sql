-- Fusion de REPETIDOS EXACTOS de marcas y modelos (decision del dueno, 14-nov: "los nombres y sabores repetidos fusionalos en uno").
-- Migracion ADITIVA. Extiende el motor de sabores (20261115300000..300200) a MARCAS y MODELOS. Nada de lo inmutable se reescribe.
--
-- EXACTO = mismo nombre salvo mayusculas, espacios, guiones o acentos (catalogo.llave_exacta = normalizar sin espacios). Nunca se unen pares solo PARECIDOS
-- (Lychee vs Lychee Ice, un prefijo, una letra de diferencia): esos siguen preguntandose por la cola. Toda unificacion exige la llave exacta igual, venga de una
-- pregunta contestada o de la regla del dueno ('regla-exactos-2026-11-14').
--
-- DISENO.
--   MARCA: solo la usa catalogo.modelo(marca_id) (mutable). Los modelos de la marca origen pasan a la destino; la origen queda marcada (unificado_en). Sin bloqueos.
--   MODELO: 17 tablas apuntan a catalogo.modelo(id) (kardex, lotes, existencias por modelo, pedidos, compras, devoluciones, tomas, apertura, asientos...), casi todas
--     inmutables o de hash encadenado, y el FIFO cuenta por modelo_id. Por eso NO se reasigna ni se reescribe ninguna fila: el modelo origen queda como HISTORIA
--     (unificado_en = destino, sin disponibilidad, sus sku inactivos y fusionados logicamente con el sku del mismo sabor del destino, que se crea si falta) y todo
--     lo nuevo resuelve al destino (el nombre viejo queda como alias). Costos de lista y tabuladores del origen NO se tocan: si el origen tiene un costo o precio VIGENTE
--     que el destino no tiene, la unificacion se BLOQUEA hasta fijarlo en el destino. Se bloquea tambien con existencia, reservas, pedidos o compras abiertos, tomas
--     pendientes o un conteo abierto. Todo reversible (catalogo.deshacer_unificacion_catalogo), idempotente por clave, auditado y solo para socios o importacion.
--   Los pares ya unificados quedan en la cola como 'unido' para que el escaneo no los vuelva a preguntar.

-- ---------------------------------------------------------------------------
-- Columnas y llaves
-- ---------------------------------------------------------------------------
alter table catalogo.posible_duplicado drop constraint posible_duplicado_tipo_check;
alter table catalogo.posible_duplicado add constraint posible_duplicado_tipo_check check (tipo in ('sabor', 'modelo', 'cliente', 'marca'));

alter table catalogo.marca alter column nombre_norm drop expression;
alter table catalogo.marca add column unificado_en bigint references catalogo.marca (id) check (unificado_en is distinct from id);
alter table catalogo.marca add column nombre_original text;
alter table catalogo.marca add column unificado_at timestamptz;

alter table catalogo.modelo alter column nombre_norm drop expression;
alter table catalogo.modelo add column unificado_en bigint references catalogo.modelo (id) check (unificado_en is distinct from id);
alter table catalogo.modelo add column nombre_original text;
alter table catalogo.modelo add column unificado_at timestamptz;

-- nombre_norm sigue siendo unico: un vigente lo conserva igual que antes; uno unificado libera su llave ('~u<id>').
create function catalogo.t_marca_norm() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.nombre_norm := case when new.unificado_en is null then catalogo.normalizar(new.nombre) else '~u' || new.id::text end;
  return new;
end $$;
create trigger marca_norm before insert or update of nombre, unificado_en on catalogo.marca for each row execute function catalogo.t_marca_norm();

create function catalogo.t_modelo_norm() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.nombre_norm := case when new.unificado_en is null then catalogo.normalizar(new.nombre_canonico) else '~u' || new.id::text end;
  return new;
end $$;
create trigger modelo_norm before insert or update of nombre_canonico, unificado_en on catalogo.modelo for each row execute function catalogo.t_modelo_norm();

-- Llave exacta: mismo nombre salvo mayusculas, espacios, guiones o acentos.
create function catalogo.llave_exacta(p_texto text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select replace(catalogo.normalizar(p_texto), ' ', '') $$;

-- Registro de unificaciones de marca y modelo (la de sabores vive en catalogo.unificacion_sabor).
create table catalogo.unificacion_catalogo (
  id bigint generated always as identity primary key,
  clave_idem text not null unique,
  tipo text not null check (tipo in ('marca', 'modelo')),
  origen_id bigint not null,
  destino_id bigint not null check (destino_id <> origen_id),
  nombre_origen text not null,
  nombre_destino text not null,
  detalle jsonb not null,
  aprobacion text not null,
  estado text not null default 'aplicada' check (estado in ('aplicada', 'deshecha')),
  canal text not null,
  por uuid,
  creada_at timestamptz not null default now(),
  deshecha_at timestamptz,
  deshecha_por uuid
);
alter table catalogo.unificacion_catalogo enable row level security;
alter table catalogo.unificacion_catalogo force row level security;
revoke all on catalogo.unificacion_catalogo from public, anon, authenticated;
revoke all on all sequences in schema catalogo from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deteccion de repetidos EXACTOS (solo lectura). Un renglon por cada nombre sobrante: canonico (el que queda) y origen (el que se fusiona).
-- Canonico: el de mas uso (modelos de la marca, movimientos del modelo, sku del sabor); luego el nombre mas largo (con espacios); luego el id menor.
-- ---------------------------------------------------------------------------
create function catalogo.duplicados_exactos() returns table (tipo text, llave text, canonico_id bigint, canonico text, origen_id bigint, origen text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  return query
    with c as (
      select 'marca'::text as t, m.id, m.nombre as nombre, (select count(*) from catalogo.modelo x where x.marca_id = m.id and x.unificado_en is null) as peso from catalogo.marca m where m.unificado_en is null
      union all select 'modelo', m.id, m.nombre_canonico, (select count(*) from operacion.movimiento_inventario v where v.modelo_id = m.id) from catalogo.modelo m where m.unificado_en is null
      union all select 'sabor', s.id, s.nombre_canonico, (select count(*) from catalogo.sku k where k.sabor_id = s.id and k.unificado_en is null) from catalogo.sabor s where s.unificado_en is null),
    k as (select c.*, catalogo.llave_exacta(c.nombre) as ll, count(*) over (partition by c.t, catalogo.llave_exacta(c.nombre)) as n from c),
    r as (select k.*, row_number() over (partition by k.t, k.ll order by k.peso desc, char_length(k.nombre) desc, k.id) as rn from k where k.n > 1 and k.ll <> '')
    select o.t, o.ll, g.id, g.nombre, o.id, o.nombre from r o join r g on g.t = o.t and g.ll = o.ll and g.rn = 1 where o.rn > 1 order by o.t, o.ll, o.id;
end $$;

-- Deja una pregunta pendiente por cada repetido exacto sin respuesta (no unifica nada).
create function catalogo.escanear_duplicados_exactos() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r record; v_nuevas int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  for r in select * from catalogo.duplicados_exactos() loop
    if catalogo.registrar_posible_duplicado(r.tipo, r.canonico_id, r.origen_id, 'mismo nombre salvo mayusculas, espacios, guiones o acentos', 100, 'IGUAL_NORMALIZADO', false) is not null then v_nuevas := v_nuevas + 1; end if;
  end loop;
  perform seguridad.registrar_auditoria('catalogo.posible_duplicado', 'ESCANEO_EXACTOS', 'todos', null, jsonb_build_object('preguntas_nuevas', v_nuevas), seguridad.canal_actual());
  return jsonb_build_object('preguntas_nuevas', v_nuevas);
end $$;

-- Autorizacion de una unificacion de marca o modelo: la llave exacta debe coincidir SIEMPRE (nunca pares solo parecidos) y ademas hace falta la respuesta pendiente de ESE par
-- o la regla del dueno. Devuelve el texto de la aprobacion.
create function catalogo.aprobacion_exacta(p_tipo text, p_origen bigint, p_destino bigint, p_pregunta_id bigint, p_aprobacion text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_a text; v_b text; q catalogo.posible_duplicado;
begin
  if p_tipo = 'marca' then
    select catalogo.llave_exacta(nombre) into v_a from catalogo.marca where id = p_origen;
    select catalogo.llave_exacta(nombre) into v_b from catalogo.marca where id = p_destino;
  else
    select catalogo.llave_exacta(nombre_canonico) into v_a from catalogo.modelo where id = p_origen;
    select catalogo.llave_exacta(nombre_canonico) into v_b from catalogo.modelo where id = p_destino;
  end if;
  if v_a is null or v_b is null or v_a = '' or v_a <> v_b then
    raise exception 'solo se unen nombres repetidos EXACTOS (mismo nombre salvo mayusculas, espacios, guiones o acentos); un nombre solo parecido se pregunta, no se une' using errcode = '42501';
  end if;
  if p_pregunta_id is not null then
    select * into q from catalogo.posible_duplicado where id = p_pregunta_id;
    if not found or q.tipo <> p_tipo or q.id_a <> least(p_origen, p_destino) or q.id_b <> greatest(p_origen, p_destino) then raise exception 'la pregunta no corresponde a estos nombres' using errcode = '22023'; end if;
    if q.estado <> 'pendiente' then raise exception 'esa pregunta ya fue contestada' using errcode = '22023'; end if;
    return 'pregunta:' || q.id::text;
  elsif p_aprobacion = 'regla-exactos-2026-11-14' then
    return 'regla:' || p_aprobacion;
  end if;
  raise exception 'una unificacion exige la respuesta de un socio o la regla de los repetidos exactos' using errcode = '42501';
end $$;

-- Motivos por los que un MODELO no puede fusionarse con otro (vacio = se puede). Solo lectura.
create function catalogo.modelo_bloqueos_unificacion(p_origen bigint, p_destino bigint) returns text[]
language sql stable security definer set search_path = ''
as $$
  select array_remove(array[
    case when exists (select 1 from operacion.existencia_sku_ubicacion e join catalogo.sku k on k.id = e.sku_id where k.modelo_id = p_origen and e.piezas <> 0)
           or exists (select 1 from operacion.existencia_modelo e where e.modelo_id = p_origen and e.piezas <> 0) then 'tiene existencia' end,
    case when exists (select 1 from operacion.reserva r join catalogo.sku k on k.id = r.sku_id where k.modelo_id = p_origen and r.estado = 'activa') then 'tiene una reserva activa' end,
    case when exists (select 1 from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where l.modelo_id = p_origen and p.estado in ('borrador', 'confirmado')) then 'esta en un pedido abierto' end,
    case when exists (select 1 from operacion.compra_linea l join operacion.compra c on c.id = l.compra_id where l.modelo_id = p_origen and c.estado not in ('recibida', 'cerrada', 'anulada')) then 'esta en una compra abierta' end,
    case when exists (select 1 from operacion.toma_omar t where t.modelo_id = p_origen and t.estado = 'pendiente') then 'tiene una toma pendiente' end,
    case when exists (select 1 from operacion.conteo c where c.estado = 'abierto') then 'hay un conteo abierto' end,
    case when exists (select 1 from catalogo.costo_proveedor c where c.modelo_id = p_origen and c.vigente_hasta is null
                        and not exists (select 1 from catalogo.costo_proveedor d where d.modelo_id = p_destino and d.proveedor_id = c.proveedor_id and d.vigente_hasta is null))
         then 'tiene un costo de lista vigente que el destino no tiene: fijalo primero en el destino' end,
    case when exists (select 1 from catalogo.tabulador_precio t where t.modelo_id = p_origen and t.vigente_hasta is null
                        and not exists (select 1 from catalogo.tabulador_precio d where d.modelo_id = p_destino and d.cliente_id = t.cliente_id and d.vigente_hasta is null))
         then 'tiene un precio de cliente vigente que el destino no tiene: fijalo primero en el destino' end], null)
$$;

-- Plan SIN escribir (para --verificar): por cada sku del modelo origen, si se fusiona con uno existente o se crea en el destino; y los bloqueos.
create function catalogo.unificacion_modelo_plan(p_origen bigint, p_destino bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  return jsonb_build_object('origen', p_origen, 'destino', p_destino, 'bloqueos', to_jsonb(catalogo.modelo_bloqueos_unificacion(p_origen, p_destino)),
    'skus', coalesce((select jsonb_agg(jsonb_build_object('sku_id', s.id, 'sabor', sa.nombre_canonico, 'accion', case when d.id is null then 'crea_en_destino' else 'fusiona' end) order by s.id)
      from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id
      left join catalogo.sku d on d.modelo_id = p_destino and d.sabor_id = s.sabor_id and d.unificado_en is null
     where s.modelo_id = p_origen and s.unificado_en is null), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Unificar dos MARCAS repetidas exactas.
-- ---------------------------------------------------------------------------
create function catalogo.unificar_marca(p_clave_idem text, p_origen bigint, p_destino bigint, p_canal text default 'web', p_pregunta_id bigint default null, p_aprobacion text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; o catalogo.marca; d catalogo.marca; v_aprob text; v_mods bigint[]; v_uid bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then raise exception 'elige dos marcas distintas' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'unificar_marca', 'o', p_origen, 'd', p_destino, 'q', p_pregunta_id, 'a', p_aprobacion));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_catalogo', 0));
  select * into o from catalogo.marca where id = p_origen for update;
  if not found then raise exception 'marca origen desconocida' using errcode = '22023'; end if;
  select * into d from catalogo.marca where id = p_destino for update;
  if not found then raise exception 'marca destino desconocida' using errcode = '22023'; end if;
  if o.unificado_en is not null then
    v_res := jsonb_build_object('estado', 'ya_unificado', 'origen', o.nombre, 'destino', (select nombre from catalogo.marca where id = o.unificado_en));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if d.unificado_en is not null then raise exception 'la marca destino ya fue unificada en otra; elige la vigente' using errcode = '22023'; end if;
  v_aprob := catalogo.aprobacion_exacta('marca', p_origen, p_destino, p_pregunta_id, p_aprobacion);

  select coalesce(array_agg(id order by id), '{}') into v_mods from catalogo.modelo where marca_id = p_origen;
  update catalogo.modelo set marca_id = p_destino where marca_id = p_origen;
  update catalogo.marca set nombre_original = nombre, unificado_en = p_destino, unificado_at = now() where id = p_origen;
  insert into catalogo.unificacion_catalogo (clave_idem, tipo, origen_id, destino_id, nombre_origen, nombre_destino, detalle, aprobacion, canal, por)
    values (p_clave_idem, 'marca', p_origen, p_destino, o.nombre, d.nombre, jsonb_build_object('modelos', to_jsonb(v_mods)), v_aprob, p_canal, auth.uid()) returning id into v_uid;
  insert into catalogo.posible_duplicado (tipo, id_a, id_b, motivo, puntaje, clase, ambiguo, estado, respondido_por, respondido_at, canal, canonico_id, unificacion_id)
    values ('marca', least(p_origen, p_destino), greatest(p_origen, p_destino), 'mismo nombre salvo mayusculas, espacios, guiones o acentos', 100, 'IGUAL_NORMALIZADO', false, 'unido', auth.uid(), now(), p_canal, p_destino, v_uid)
    on conflict (tipo, id_a, id_b) do update set estado = 'unido', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal, canonico_id = p_destino, unificacion_id = v_uid;
  perform seguridad.registrar_auditoria('catalogo.marca', 'UNIFICACION', p_origen::text, jsonb_build_object('origen', o.nombre, 'destino', d.nombre),
    jsonb_build_object('unificacion_id', v_uid, 'destino_id', p_destino, 'modelos', to_jsonb(v_mods), 'aprobacion', v_aprob, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'unificado', 'tipo', 'marca', 'unificacion_id', v_uid, 'origen', o.nombre, 'destino', d.nombre, 'modelos_movidos', cardinality(v_mods), 'aprobacion', v_aprob);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Unificar dos MODELOS repetidos exactos. Devuelve 'unificado' | 'ya_unificado' | 'bloqueado' (con los motivos; no escribe nada).
-- ---------------------------------------------------------------------------
create function catalogo.unificar_modelo(p_clave_idem text, p_origen bigint, p_destino bigint, p_canal text default 'web', p_pregunta_id bigint default null, p_aprobacion text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; o catalogo.modelo; d catalogo.modelo; v_aprob text; v_bloq text[]; k record; v_dest bigint; v_det jsonb := '[]'::jsonb; v_alias_mov bigint[]; v_alias_nuevo bigint;
  v_norm_o text; v_uid bigint; v_res jsonb; v_creados int := 0; v_fus int := 0; v_lista_antes text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then raise exception 'elige dos modelos distintos' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'unificar_modelo', 'o', p_origen, 'd', p_destino, 'q', p_pregunta_id, 'a', p_aprobacion));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_catalogo', 0));
  select * into o from catalogo.modelo where id = p_origen for update;
  if not found then raise exception 'modelo origen desconocido' using errcode = '22023'; end if;
  select * into d from catalogo.modelo where id = p_destino for update;
  if not found then raise exception 'modelo destino desconocido' using errcode = '22023'; end if;
  if o.unificado_en is not null then
    v_res := jsonb_build_object('estado', 'ya_unificado', 'origen', o.nombre_canonico, 'destino', (select nombre_canonico from catalogo.modelo where id = o.unificado_en));
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if d.unificado_en is not null then raise exception 'el modelo destino ya fue unificado en otro; elige el vigente' using errcode = '22023'; end if;
  v_aprob := catalogo.aprobacion_exacta('modelo', p_origen, p_destino, p_pregunta_id, p_aprobacion);

  v_bloq := catalogo.modelo_bloqueos_unificacion(p_origen, p_destino);
  if cardinality(v_bloq) > 0 then
    delete from seguridad.operacion where clave = p_clave_idem;
    return jsonb_build_object('estado', 'bloqueado', 'origen', o.nombre_canonico, 'destino', d.nombre_canonico, 'bloqueos', to_jsonb(v_bloq),
                              'ayuda', 'El modelo origen tiene movimiento o precios que el destino no tiene. Cierra el conteo, recibe o cancela lo abierto, traspasa la existencia o fija el costo y el precio en el destino, y vuelve a intentar.');
  end if;

  v_norm_o := o.nombre_norm;
  v_lista_antes := d.lista_origen;
  for k in select s.id as sku_id, s.sabor_id, s.activo, (select ds.id from catalogo.sku ds where ds.modelo_id = p_destino and ds.sabor_id = s.sabor_id and ds.unificado_en is null) as dest_sku
             from catalogo.sku s where s.modelo_id = p_origen and s.unificado_en is null order by s.id loop
    v_dest := k.dest_sku;
    if v_dest is null then
      insert into catalogo.sku (modelo_id, sabor_id, activo) values (p_destino, k.sabor_id, k.activo) returning id into v_dest;
      v_creados := v_creados + 1;
      v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'sku_destino', v_dest, 'creado', true, 'activo_antes', k.activo);
    else
      v_fus := v_fus + 1;
      v_det := v_det || jsonb_build_object('sku_id', k.sku_id, 'sku_destino', v_dest, 'creado', false, 'activo_antes', k.activo);
    end if;
    update catalogo.sku set activo = false, unificado_en = v_dest where id = k.sku_id;
  end loop;

  -- Alias: los del origen pasan al destino y el nombre viejo queda como alias (asi resolver_modelo y el agente encuentran el vigente).
  select coalesce(array_agg(id), '{}') into v_alias_mov from catalogo.modelo_alias where modelo_id = p_origen and not ambiguo;
  update catalogo.modelo_alias set modelo_id = p_destino where id = any (v_alias_mov);
  insert into catalogo.modelo_alias (alias_norm, modelo_id, ambiguo, nota) values (v_norm_o, p_destino, false, 'nombre unificado: ' || o.nombre_canonico)
    on conflict (alias_norm) do nothing returning id into v_alias_nuevo;

  update catalogo.modelo set nombre_original = nombre_canonico, unificado_en = p_destino, unificado_at = now(), estado = 'sin_disponibilidad', estado_desde = negocio.hoy() where id = p_origen;
  if d.lista_origen <> 'ambas' and o.lista_origen <> d.lista_origen then update catalogo.modelo set lista_origen = 'ambas' where id = p_destino; end if;

  insert into catalogo.unificacion_catalogo (clave_idem, tipo, origen_id, destino_id, nombre_origen, nombre_destino, detalle, aprobacion, canal, por)
    values (p_clave_idem, 'modelo', p_origen, p_destino, o.nombre_canonico, d.nombre_canonico,
            jsonb_build_object('skus', v_det, 'estado_antes', o.estado, 'estado_desde_antes', o.estado_desde, 'alias_movidos', to_jsonb(v_alias_mov), 'alias_nuevo', v_alias_nuevo, 'lista_destino_antes', v_lista_antes, 'nombre_norm_origen', v_norm_o),
            v_aprob, p_canal, auth.uid()) returning id into v_uid;
  insert into catalogo.posible_duplicado (tipo, id_a, id_b, motivo, puntaje, clase, ambiguo, estado, respondido_por, respondido_at, canal, canonico_id, unificacion_id)
    values ('modelo', least(p_origen, p_destino), greatest(p_origen, p_destino), 'mismo nombre salvo mayusculas, espacios, guiones o acentos', 100, 'IGUAL_NORMALIZADO', false, 'unido', auth.uid(), now(), p_canal, p_destino, v_uid)
    on conflict (tipo, id_a, id_b) do update set estado = 'unido', respondido_por = auth.uid(), respondido_at = now(), canal = p_canal, canonico_id = p_destino, unificacion_id = v_uid;
  perform seguridad.registrar_auditoria('catalogo.modelo', 'UNIFICACION', p_origen::text, jsonb_build_object('origen', o.nombre_canonico, 'destino', d.nombre_canonico),
    jsonb_build_object('unificacion_id', v_uid, 'destino_id', p_destino, 'skus', v_det, 'aprobacion', v_aprob, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'unificado', 'tipo', 'modelo', 'unificacion_id', v_uid, 'origen', o.nombre_canonico, 'destino', d.nombre_canonico, 'skus_fusionados', v_fus, 'skus_creados_en_destino', v_creados, 'aprobacion', v_aprob);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Deshacer una unificacion de marca o modelo. La pregunta vuelve a quedar pendiente. Lo registrado despues sobre el destino sigue siendo valido.
-- Un sku creado en el destino se intenta borrar; si la base no lo permite (kardex y conteos son inmutables y bloquean hasta la verificacion de la llave foranea) o ya tiene uso se deja: es solo una entrada de catalogo.
create function catalogo.deshacer_unificacion_catalogo(p_clave_idem text, p_unificacion_id bigint, p_canal text default 'web') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; u catalogo.unificacion_catalogo; e jsonb; v_res jsonb; v_nombre text; v_dejados int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'deshacer_unificacion_catalogo', 'u', p_unificacion_id));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('unificar_catalogo', 0));
  select * into u from catalogo.unificacion_catalogo where id = p_unificacion_id for update;
  if not found then raise exception 'unificacion desconocida' using errcode = '22023'; end if;
  if u.estado = 'deshecha' then
    v_res := jsonb_build_object('estado', 'ya_deshecha', 'unificacion_id', u.id);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;
  if u.tipo = 'marca' then
    select nombre_original into v_nombre from catalogo.marca where id = u.origen_id for update;
    if exists (select 1 from catalogo.marca m where m.nombre_norm = catalogo.normalizar(v_nombre) and m.id <> u.origen_id) then
      raise exception 'otra marca ya usa el nombre original; no se puede deshacer sin renombrarla' using errcode = '22023';
    end if;
    update catalogo.modelo set marca_id = u.origen_id where marca_id = u.destino_id and id in (select (x)::bigint from jsonb_array_elements_text(u.detalle -> 'modelos') x);
    update catalogo.marca set unificado_en = null, unificado_at = null, nombre_original = null where id = u.origen_id;
  else
    select nombre_original into v_nombre from catalogo.modelo where id = u.origen_id for update;
    if exists (select 1 from catalogo.modelo m where m.nombre_norm = catalogo.normalizar(v_nombre) and m.id <> u.origen_id) then
      raise exception 'otro modelo ya usa el nombre original; no se puede deshacer sin renombrarlo' using errcode = '22023';
    end if;
    for e in select * from jsonb_array_elements(u.detalle -> 'skus') loop
      update catalogo.sku set activo = coalesce((e ->> 'activo_antes')::boolean, true), unificado_en = null where id = (e ->> 'sku_id')::bigint;
      if (e ->> 'creado')::boolean then
        begin
          delete from catalogo.sku where id = (e ->> 'sku_destino')::bigint;
        exception when foreign_key_violation or insufficient_privilege then
          -- Las tablas del kardex y del conteo no dejan ni la verificacion de la llave foranea al borrar (inmutables): el sku vacio queda como entrada de catalogo.
          v_dejados := v_dejados + 1;
        end;
      end if;
    end loop;
    if u.detalle ->> 'alias_nuevo' is not null then delete from catalogo.modelo_alias where id = (u.detalle ->> 'alias_nuevo')::bigint; end if;
    update catalogo.modelo_alias set modelo_id = u.origen_id where id in (select (x)::bigint from jsonb_array_elements_text(u.detalle -> 'alias_movidos') x) and modelo_id = u.destino_id;
    update catalogo.modelo set unificado_en = null, unificado_at = null, nombre_original = null, estado = u.detalle ->> 'estado_antes', estado_desde = (u.detalle ->> 'estado_desde_antes')::date where id = u.origen_id;
    update catalogo.modelo set lista_origen = u.detalle ->> 'lista_destino_antes' where id = u.destino_id and lista_origen <> u.detalle ->> 'lista_destino_antes';
  end if;
  update catalogo.unificacion_catalogo set estado = 'deshecha', deshecha_at = now(), deshecha_por = auth.uid() where id = u.id;
  update catalogo.posible_duplicado set estado = 'pendiente', respondido_por = null, respondido_at = null, canal = null, canonico_id = null, unificacion_id = null where unificacion_id = u.id and tipo = u.tipo;
  perform seguridad.registrar_auditoria('catalogo.' || u.tipo, 'UNIFICACION_DESHECHA', u.origen_id::text, null, jsonb_build_object('unificacion_id', u.id, 'origen_canal', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'deshecha', 'unificacion_id', u.id, 'tipo', u.tipo, 'origen', v_nombre, 'destino', u.nombre_destino, 'skus_creados_que_se_dejaron', v_dejados);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Que no reaparezcan: al dar de alta una marca o un modelo (importadores, cargador, apertura) un nombre repetido EXACTO de uno vigente BLOQUEA y pregunta (P0462), igual
-- que alta_sabor para los sabores. El nombre viejo de uno ya unificado resuelve al vigente sin preguntar. Misma firma y permisos que las versiones anteriores.
-- ---------------------------------------------------------------------------
create or replace function catalogo.asegurar_marca(p_nombre text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_otro catalogo.marca; v_n text := catalogo.normalizar(p_nombre);
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_id from catalogo.marca where nombre_norm = v_n;
  if v_id is not null then return v_id; end if;
  select m.unificado_en into v_id from catalogo.marca m where m.unificado_en is not null and catalogo.normalizar(m.nombre_original) = v_n order by m.id limit 1;
  if v_id is not null then
    while exists (select 1 from catalogo.marca where id = v_id and unificado_en is not null) loop select unificado_en into v_id from catalogo.marca where id = v_id; end loop;
    return v_id;
  end if;
  select * into v_otro from catalogo.marca m where m.unificado_en is null and catalogo.llave_exacta(m.nombre) = catalogo.llave_exacta(p_nombre) order by m.id limit 1;
  if found then
    raise exception 'la marca "%" se escribe igual que "%" salvo mayusculas, espacios, guiones o acentos: ¿es lo mismo? Usa "%" o unifícalas (scripts/catalogo/fusionar-repetidos.mjs); no se crea otra', btrim(p_nombre), v_otro.nombre, v_otro.nombre using errcode = 'P0462';
  end if;
  insert into catalogo.marca (nombre) values (btrim(p_nombre)) returning id into v_id;
  return v_id;
end $$;

create or replace function catalogo.asegurar_modelo(p_marca text, p_nombre text, p_puffs int, p_lista text, p_estado text default 'disponible', p_nota text default null) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_marca bigint; v_id bigint; v_lista text; v_otro catalogo.modelo; v_n text := catalogo.normalizar(p_nombre);
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id, lista_origen into v_id, v_lista from catalogo.modelo where nombre_norm = v_n;
  if v_id is null then
    select m.unificado_en into v_id from catalogo.modelo m where m.unificado_en is not null and catalogo.normalizar(m.nombre_original) = v_n order by m.id limit 1;
    if v_id is not null then
      while exists (select 1 from catalogo.modelo where id = v_id and unificado_en is not null) loop select unificado_en into v_id from catalogo.modelo where id = v_id; end loop;
      return v_id;
    end if;
  end if;
  if v_id is not null then
    if v_lista <> p_lista and v_lista <> 'ambas' then update catalogo.modelo set lista_origen = 'ambas' where id = v_id; end if;
    return v_id;
  end if;
  select * into v_otro from catalogo.modelo m where m.unificado_en is null and catalogo.llave_exacta(m.nombre_canonico) = catalogo.llave_exacta(p_nombre) order by m.id limit 1;
  if found then
    raise exception 'el modelo "%" se escribe igual que "%" salvo mayusculas, espacios, guiones o acentos: ¿es lo mismo? Usa "%" o unifícalos (scripts/catalogo/fusionar-repetidos.mjs); no se crea otro', btrim(p_nombre), v_otro.nombre_canonico, v_otro.nombre_canonico using errcode = 'P0462';
  end if;
  v_marca := catalogo.asegurar_marca(p_marca);
  insert into catalogo.modelo (marca_id, nombre_canonico, puffs, lista_origen, estado, nota) values (v_marca, btrim(p_nombre), p_puffs, p_lista, p_estado, p_nota) returning id into v_id;
  return v_id;
end $$;

-- Sabores por el importador y el bot (canal importacion o telegram): un exacto de uno vigente bloquea y pregunta. La web ya pasa por alta_sabor, que pregunta con p_confirmar.
-- (Las pruebas y operaciones internas sin canal conservan el comportamiento anterior.)
create or replace function catalogo.asegurar_sabor(p_nombre text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_otro catalogo.sabor;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select id into v_id from catalogo.sabor where nombre_norm = catalogo.normalizar(p_nombre);
  if v_id is null then select a.sabor_id into v_id from catalogo.sabor_alias a where a.alias_norm = catalogo.normalizar(p_nombre); end if;
  if v_id is null and seguridad.canal_actual() in ('importacion', 'telegram') then
    select * into v_otro from catalogo.sabor s where s.unificado_en is null and catalogo.llave_exacta(s.nombre_canonico) = catalogo.llave_exacta(p_nombre) order by s.id limit 1;
    if found then
      raise exception 'el sabor "%" se escribe igual que "%" salvo mayusculas, espacios, guiones o acentos: ¿es lo mismo? Usa "%"; no se crea otro', btrim(p_nombre), v_otro.nombre_canonico, v_otro.nombre_canonico using errcode = 'P0462';
    end if;
  end if;
  if v_id is null then insert into catalogo.sabor (nombre_canonico) values (btrim(p_nombre)) returning id into v_id; end if;
  return v_id;
end $$;

-- Un modelo unificado es historia: no se ofrece en el catalogo web ni en las listas del agente (sus sku quedan inactivos y las listas por sku ya los omiten).
CREATE OR REPLACE FUNCTION api.catalogo_modelos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(x order by x->>'marca', x->>'nombre') from (
      select jsonb_build_object(
        'id', m.id, 'marca', ma.nombre, 'nombre', m.nombre_canonico, 'puffs', m.puffs, 'estado', m.estado, 'estado_desde', m.estado_desde,
        'lista', m.lista_origen,
        'costos', coalesce((select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'costo_cent', c.costo_cent, 'desde', c.vigente_desde, 'supuesto', c.supuesto,
                                                               'es_lista', c.es_lista, 'motivo', c.motivo, 'fuente', c.fuente) order by p.nombre)
                            from catalogo.costo_proveedor c join catalogo.proveedor p on p.id = c.proveedor_id where c.modelo_id = m.id and c.vigente_hasta is null), '[]'::jsonb),
        'alias', coalesce((select jsonb_agg(a.alias_norm order by a.alias_norm) from catalogo.modelo_alias a where a.modelo_id = m.id or m.id = any (a.candidatos)), '[]'::jsonb),
        'precios', jsonb_build_object(
          'clientes', (select count(distinct t.cliente_id) from catalogo.tabulador_precio t where t.modelo_id = m.id and t.vigente_hasta is null),
          'min_cent', (select min(t.precio_cent) from catalogo.tabulador_precio t where t.modelo_id = m.id and t.vigente_hasta is null),
          'max_cent', (select max(t.precio_cent) from catalogo.tabulador_precio t where t.modelo_id = m.id and t.vigente_hasta is null))
      ) x
      from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id where m.unificado_en is null
    ) q), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION agente.catalogo_modelos()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id::text, 'nombre', m.nombre_canonico, 'alias', coalesce((select jsonb_agg(a.alias_norm) from catalogo.modelo_alias a where a.modelo_id = m.id or m.id = any (a.candidatos)), '[]'::jsonb)) order by m.id)
    from catalogo.modelo m where m.unificado_en is null), '[]'::jsonb);
end $function$;

-- Permisos: nada de lo nuevo se expone a la web; solo funciones internas (la web las alcanza, si hace falta, por una puerta api.* de socio en otra entrega).
revoke execute on function catalogo.t_marca_norm(), catalogo.t_modelo_norm(), catalogo.llave_exacta(text), catalogo.duplicados_exactos(), catalogo.escanear_duplicados_exactos(),
  catalogo.aprobacion_exacta(text, bigint, bigint, bigint, text), catalogo.modelo_bloqueos_unificacion(bigint, bigint), catalogo.unificacion_modelo_plan(bigint, bigint),
  catalogo.unificar_marca(text, bigint, bigint, text, bigint, text), catalogo.unificar_modelo(text, bigint, bigint, text, bigint, text),
  catalogo.deshacer_unificacion_catalogo(text, bigint, text), catalogo.asegurar_marca(text), catalogo.asegurar_modelo(text, text, int, text, text, text), catalogo.asegurar_sabor(text)
  from public, anon, authenticated;
