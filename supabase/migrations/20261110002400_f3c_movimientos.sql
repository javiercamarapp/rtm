-- F3c / 0024: zona Movimientos. Captura cruda de movimientos historicos (pegado o CSV) con huella por fila para no duplicar al reimportar, clasificacion versionada
-- (sin clasificar, clasificado, conciliado, duplicado, descartado), conciliacion contra un hecho existente con la misma suma, agrupacion por pedido, cliente, socio y
-- proveedor, utilidad por pedido y acumulada por socio, y quien debe a quien. NO crea cobros, pagos ni asientos: clasificar y conciliar solo describen y comprueban.

create table operacion.importacion (
  id bigint generated always as identity primary key,
  fuente text not null check (fuente in ('pegado', 'archivo')),
  nombre_archivo text,
  sha256_archivo text check (sha256_archivo is null or sha256_archivo ~ '^[0-9a-f]{64}$'),
  filas_total int not null check (filas_total >= 0),
  filas_nuevas int not null check (filas_nuevas >= 0),
  filas_duplicadas int not null check (filas_duplicadas >= 0),
  creada_at timestamptz not null default clock_timestamp(),
  creada_por uuid not null default auth.uid()
);

create table operacion.movimiento_crudo (
  id bigint generated always as identity primary key,
  importacion_id bigint not null references operacion.importacion (id),
  linea int not null check (linea > 0),
  fecha_neg date not null,
  monto_cent bigint not null check (monto_cent <> 0),
  moneda text not null default 'MXN' check (moneda = 'MXN'),
  cuenta_texto text,
  cuenta_dinero_id bigint references operacion.cuenta_dinero (id),
  origen_texto text,
  mensaje_original text,
  hash_fila text not null unique check (hash_fila ~ '^[0-9a-f]{64}$')
);
create index movimiento_crudo_fecha_idx on operacion.movimiento_crudo (fecha_neg, id);

create table operacion.clasificacion_movimiento (
  id bigint generated always as identity primary key,
  movimiento_crudo_id bigint not null references operacion.movimiento_crudo (id),
  version int not null check (version > 0),
  estado text not null check (estado in ('clasificado', 'conciliado', 'duplicado', 'descartado')),
  tipo text check (tipo in ('cobro_cliente', 'pago_proveedor', 'aportacion', 'retiro', 'gasto', 'fondos_en_poder_socio', 'transferencia_entre_socios', 'otro')),
  pedido_id bigint references operacion.pedido (id),
  cliente_id bigint references catalogo.cliente (id),
  socio_id bigint references catalogo.socio (id),
  proveedor_id bigint references catalogo.proveedor (id),
  contraparte_tipo text check (contraparte_tipo in ('pago', 'gasto', 'aportacion')),
  contraparte_id bigint,
  motivo text,
  clasificada_por uuid not null default auth.uid(),
  clasificada_at timestamptz not null default clock_timestamp(),
  unique (movimiento_crudo_id, version),
  check ((estado in ('clasificado', 'conciliado')) = (tipo is not null)),
  check ((estado = 'conciliado') = (contraparte_id is not null and contraparte_tipo is not null))
);
-- Una contraparte concilia un solo movimiento VIGENTE. No es un indice unico: la tabla guarda todas las versiones y una conciliacion reclasificada deja de contar.
-- conciliar_movimiento lo garantiza con un candado por contraparte y la consulta sobre el estado vigente.
create index clasificacion_contraparte_idx on operacion.clasificacion_movimiento (contraparte_tipo, contraparte_id) where estado = 'conciliado';

do $$
declare t text;
begin
  foreach t in array array['importacion', 'movimiento_crudo', 'clasificacion_movimiento'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- Ultima version de cada movimiento (el estado vigente). Sin fila = sin clasificar.
create view operacion.movimiento_vigente with (security_invoker = false) as
  select m.id, m.importacion_id, m.linea, m.fecha_neg, m.monto_cent, m.cuenta_texto, m.origen_texto, m.mensaje_original, m.hash_fila,
         coalesce(c.estado, 'sin_clasificar') as estado, c.tipo, c.pedido_id, c.cliente_id, c.socio_id, c.proveedor_id, c.contraparte_tipo, c.contraparte_id, c.motivo, c.version, c.clasificada_at
    from operacion.movimiento_crudo m
    left join lateral (select x.* from operacion.clasificacion_movimiento x where x.movimiento_crudo_id = m.id order by x.version desc limit 1) c on true;
revoke all on operacion.movimiento_vigente from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Importacion: p_filas = [{fecha 'AAAA-MM-DD', monto_cent (con signo), cuenta, origen, mensaje}]. Con p_solo_contar no escribe nada (--dry-run).
-- ---------------------------------------------------------------------------
create function operacion.importar_movimientos(p_clave text, p_fuente text, p_nombre_archivo text, p_sha256 text, p_filas jsonb, p_solo_contar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_total int; v_invalidas jsonb := '[]'::jsonb; v_nuevas int; v_dups int; v_imp bigint; v_res jsonb; r record; v_validas int := 0;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_fuente not in ('pegado', 'archivo') then raise exception 'fuente desconocida' using errcode = '22023'; end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'las filas deben ser una lista' using errcode = '22023'; end if;
  if jsonb_array_length(p_filas) > 5000 then raise exception 'máximo 5,000 filas por importación' using errcode = '22023'; end if;
  if not p_solo_contar then
    v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'importar_movimientos', 'f', p_fuente, 'n', p_nombre_archivo, 's', p_sha256, 'r', p_filas));
    if v_prev is not null then return v_prev; end if;
  end if;
  v_total := jsonb_array_length(p_filas);
  create temporary table if not exists _imp (linea int, fecha date, monto bigint, cuenta text, origen text, mensaje text, hash text) on commit drop;
  truncate _imp;
  for r in select x.v, x.n::int as n from jsonb_array_elements(p_filas) with ordinality as x(v, n) loop
    if (r.v->>'fecha') is null or (r.v->>'fecha') !~ '^\d{4}-\d{2}-\d{2}$' or (r.v->>'monto_cent') is null or (r.v->>'monto_cent') !~ '^-?\d{1,15}$' or (r.v->>'monto_cent')::bigint = 0 then
      v_invalidas := v_invalidas || jsonb_build_array(jsonb_build_object('linea', r.n, 'motivo', 'fecha AAAA-MM-DD y monto en centavos distinto de cero son obligatorios'));
      continue;
    end if;
    begin
      perform (r.v->>'fecha')::date;
    exception when others then
      v_invalidas := v_invalidas || jsonb_build_array(jsonb_build_object('linea', r.n, 'motivo', 'la fecha no existe'));
      continue;
    end;
    if (r.v->>'fecha')::date > negocio.hoy() then
      v_invalidas := v_invalidas || jsonb_build_array(jsonb_build_object('linea', r.n, 'motivo', 'la fecha es futura'));
      continue;
    end if;
    insert into _imp (linea, fecha, monto, cuenta, origen, mensaje) values (r.n, (r.v->>'fecha')::date, (r.v->>'monto_cent')::bigint, left(btrim(r.v->>'cuenta'), 120), left(btrim(r.v->>'origen'), 200), left(btrim(r.v->>'mensaje'), 1000));
    v_validas := v_validas + 1;
  end loop;
  -- Huella: contenido normalizado + numero de ocurrencia dentro del lote (dos filas identicas legitimas se conservan; el mismo archivo dos veces da las mismas huellas).
  update _imp i set hash = encode(sha256(convert_to(concat_ws('|', i.fecha, i.monto, lower(coalesce(i.cuenta, '')), lower(coalesce(i.origen, '')), lower(coalesce(i.mensaje, '')), o.k), 'UTF8')), 'hex')
    from (select linea, row_number() over (partition by fecha, monto, lower(coalesce(cuenta, '')), lower(coalesce(origen, '')), lower(coalesce(mensaje, '')) order by linea) as k from _imp) o where o.linea = i.linea;
  select count(*) filter (where not exists (select 1 from operacion.movimiento_crudo m where m.hash_fila = i.hash)) into v_nuevas from _imp i;
  v_dups := v_validas - coalesce(v_nuevas, 0);
  if p_solo_contar then
    return jsonb_build_object('solo_contar', true, 'filas_total', v_total, 'filas_validas', v_validas, 'filas_nuevas', coalesce(v_nuevas, 0), 'filas_duplicadas', v_dups, 'invalidas', v_invalidas);
  end if;
  insert into operacion.importacion (fuente, nombre_archivo, sha256_archivo, filas_total, filas_nuevas, filas_duplicadas)
    values (p_fuente, p_nombre_archivo, p_sha256, v_total, coalesce(v_nuevas, 0), v_dups) returning id into v_imp;
  insert into operacion.movimiento_crudo (importacion_id, linea, fecha_neg, monto_cent, cuenta_texto, origen_texto, mensaje_original, hash_fila)
    select v_imp, i.linea, i.fecha, i.monto, i.cuenta, i.origen, i.mensaje, i.hash from _imp i where not exists (select 1 from operacion.movimiento_crudo m where m.hash_fila = i.hash) order by i.linea;
  v_res := jsonb_build_object('solo_contar', false, 'importacion_id', v_imp, 'filas_total', v_total, 'filas_validas', v_validas, 'filas_nuevas', coalesce(v_nuevas, 0), 'filas_duplicadas', v_dups, 'invalidas', v_invalidas);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Clasificar, conciliar, descartar
-- ---------------------------------------------------------------------------
create function operacion.siguiente_version_mov(p_mov bigint) returns int
language sql stable security definer set search_path = ''
as $$ select coalesce(max(version), 0) + 1 from operacion.clasificacion_movimiento where movimiento_crudo_id = $1 $$;

-- p_ref: {pedido_id, cliente_id, socio, proveedor_id}. Sin efecto sobre ningun saldo.
create function operacion.clasificar_movimiento(p_clave text, p_mov bigint, p_tipo text, p_ref jsonb, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_vig record; v_pedido bigint := nullif(p_ref->>'pedido_id', '')::bigint; v_cliente bigint := nullif(p_ref->>'cliente_id', '')::bigint; v_socio bigint; v_prov bigint := nullif(p_ref->>'proveedor_id', '')::bigint;
  v_monto bigint; v_ver int; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'clasificar_movimiento', 'm', p_mov, 't', p_tipo, 'r', p_ref, 'x', p_motivo));
  if v_prev is not null then return v_prev; end if;
  select * into v_vig from operacion.movimiento_vigente where id = p_mov;
  if not found then raise exception 'movimiento desconocido' using errcode = '22023'; end if;
  v_monto := v_vig.monto_cent;
  if p_tipo not in ('cobro_cliente', 'pago_proveedor', 'aportacion', 'retiro', 'gasto', 'fondos_en_poder_socio', 'transferencia_entre_socios', 'otro') then raise exception 'tipo desconocido' using errcode = '22023'; end if;
  if v_vig.estado = 'conciliado' and nullif(btrim(p_motivo), '') is null then raise exception 'reclasificar un movimiento conciliado exige motivo' using errcode = '23502'; end if;
  if v_vig.estado in ('duplicado', 'descartado') then raise exception 'el movimiento está %: no se reclasifica', v_vig.estado using errcode = 'P0443'; end if;
  if p_ref ? 'socio' and nullif(p_ref->>'socio', '') is not null then
    select id into v_socio from catalogo.socio where nombre = p_ref->>'socio';
    if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  end if;
  if p_tipo = 'cobro_cliente' and (v_monto < 0 or (v_cliente is null and v_pedido is null)) then raise exception 'un cobro es una entrada y necesita cliente o pedido' using errcode = '23514'; end if;
  if p_tipo = 'pago_proveedor' and (v_monto > 0 or v_prov is null) then raise exception 'un pago a proveedor es una salida y necesita proveedor' using errcode = '23514'; end if;
  if p_tipo in ('aportacion', 'fondos_en_poder_socio') and (v_monto < 0 or v_socio is null) then raise exception 'ese tipo es una entrada y necesita socio' using errcode = '23514'; end if;
  if p_tipo = 'retiro' and (v_monto > 0 or v_socio is null) then raise exception 'un retiro es una salida y necesita socio' using errcode = '23514'; end if;
  if p_tipo = 'transferencia_entre_socios' and v_socio is null then raise exception 'la transferencia entre socios necesita el socio de la cuenta' using errcode = '23514'; end if;
  if p_tipo = 'otro' and nullif(btrim(p_motivo), '') is null then raise exception 'otro exige motivo' using errcode = '23502'; end if;
  if v_pedido is not null and v_cliente is null then select cliente_id into v_cliente from operacion.pedido where id = v_pedido; end if;
  if v_pedido is not null and not exists (select 1 from operacion.pedido where id = v_pedido) then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  v_ver := operacion.siguiente_version_mov(p_mov);
  insert into operacion.clasificacion_movimiento (movimiento_crudo_id, version, estado, tipo, pedido_id, cliente_id, socio_id, proveedor_id, motivo)
    values (p_mov, v_ver, 'clasificado', p_tipo, v_pedido, v_cliente, v_socio, v_prov, nullif(btrim(p_motivo), ''));
  v_res := jsonb_build_object('movimiento_id', p_mov, 'version', v_ver, 'estado', 'clasificado');
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- Que hecho corresponde a cada clasificacion: un cobro de cliente y los fondos de clientes en la cuenta de un socio son un pago; una aportacion, una aportacion;
-- un gasto, un gasto. Los demas tipos (pago a proveedor, retiro, transferencia entre socios, otro) no tienen hecho con que conciliarse y quedan clasificados.
create function operacion.mov_tipo_contraparte(p_tipo text) returns text
language sql immutable set search_path = ''
as $$ select case p_tipo when 'cobro_cliente' then 'pago' when 'fondos_en_poder_socio' then 'pago' when 'aportacion' then 'aportacion' when 'gasto' then 'gasto' end $$;

-- Por que un hecho NO sirve de contraparte de un movimiento (null = si sirve). Una sola regla para la lista de candidatas y para conciliar:
-- el hecho existe y no esta anulado ni deshecho, corresponde al tipo de la clasificacion (y al socio o al cliente si la clasificacion los nombra),
-- tiene la misma suma y el mismo sentido, y no concilia ya otro movimiento VIGENTE (una conciliacion reclasificada lo libera).
create function operacion.mov_contraparte_rechazo(p_mov bigint, p_contraparte_tipo text, p_contraparte_id bigint) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v record; v_esp text; v_suma bigint; v_sentido int; v_anulado boolean; v_socio bigint; v_cliente bigint; v_titular text;
begin
  select * into v from operacion.movimiento_vigente where id = p_mov;
  if not found then return 'movimiento desconocido'; end if;
  v_esp := operacion.mov_tipo_contraparte(v.tipo);
  if v_esp is null then return format('un movimiento clasificado como %s no tiene hecho con que conciliarse', coalesce(v.tipo, v.estado)); end if;
  if p_contraparte_tipo is distinct from v_esp then return format('un movimiento clasificado como %s se concilia con un %s, no con %s', v.tipo, v_esp, coalesce(p_contraparte_tipo, 'nada')); end if;
  if v_esp = 'pago' then
    select p.monto_cent, 1, exists (select 1 from operacion.pago_anulacion an where an.pago_id = p.id), cd.socio_id, operacion.pago_cliente(p.id), cd.titular_tipo
      into v_suma, v_sentido, v_anulado, v_socio, v_cliente, v_titular
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id where p.id = p_contraparte_id;
  elsif v_esp = 'gasto' then
    select g.monto_cent, -1, exists (select 1 from operacion.gasto_anulacion an where an.gasto_id = g.id) into v_suma, v_sentido, v_anulado from operacion.gasto g where g.id = p_contraparte_id;
  else
    select a.monto_cent, 1, (a.reversa_de is not null or exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id)), a.socio_id
      into v_suma, v_sentido, v_anulado, v_socio from operacion.aportacion_socio a where a.id = p_contraparte_id;
  end if;
  if v_suma is null then return 'la contraparte no existe'; end if;
  if v_anulado then return 'la contraparte está anulada o deshecha'; end if;
  if v.tipo = 'fondos_en_poder_socio' and (v_titular is distinct from 'socio' or v_socio is distinct from v.socio_id) then return 'los fondos en poder de un socio se concilian con un pago que cayó en la cuenta de ese socio'; end if;
  if v.tipo = 'aportacion' and v_socio is distinct from v.socio_id then return 'la aportación es de otro socio'; end if;
  if v.tipo = 'cobro_cliente' and v.cliente_id is not null and v_cliente is not null and v_cliente <> v.cliente_id then return 'el pago es de otro cliente'; end if;
  if v_suma <> abs(v.monto_cent) or sign(v.monto_cent) <> v_sentido then return format('la contraparte no tiene la misma suma: movimiento %s contra %s', v.monto_cent, v_suma * v_sentido); end if;
  if exists (select 1 from operacion.movimiento_vigente w where w.estado = 'conciliado' and w.contraparte_tipo = p_contraparte_tipo and w.contraparte_id = p_contraparte_id and w.id <> p_mov) then
    return 'esa contraparte ya concilia otro movimiento';
  end if;
  return null;
end $$;

-- Conciliar: la contraparte es un hecho vigente que ya existe, del tipo que corresponde a la clasificacion, con la MISMA suma y el mismo sentido. Una contraparte
-- concilia un solo movimiento vigente.
create function operacion.conciliar_movimiento(p_clave text, p_mov bigint, p_contraparte_tipo text, p_contraparte_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_vig record; v_ver int; v_res jsonb; v_rechazo text;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'conciliar_movimiento', 'm', p_mov, 't', p_contraparte_tipo, 'c', p_contraparte_id));
  if v_prev is not null then return v_prev; end if;
  if p_contraparte_tipo is null or p_contraparte_tipo not in ('pago', 'gasto', 'aportacion') then raise exception 'contraparte desconocida' using errcode = '22023'; end if;
  -- Candados: el movimiento y la contraparte, para que dos conciliaciones simultaneas no usen el mismo hecho.
  perform pg_advisory_xact_lock(hashtextextended('movimientos:mov:' || p_mov, 0));
  perform pg_advisory_xact_lock(hashtextextended('movimientos:contraparte:' || p_contraparte_tipo || ':' || p_contraparte_id, 0));
  select * into v_vig from operacion.movimiento_vigente where id = p_mov;
  if not found then raise exception 'movimiento desconocido' using errcode = '22023'; end if;
  if v_vig.estado <> 'clasificado' then raise exception 'solo se concilia un movimiento clasificado (estado actual: %)', v_vig.estado using errcode = 'P0443'; end if;
  v_rechazo := operacion.mov_contraparte_rechazo(p_mov, p_contraparte_tipo, p_contraparte_id);
  if v_rechazo is not null then
    raise exception '%', v_rechazo using errcode = case
      when v_rechazo like 'la contraparte no tiene la misma suma%' then 'P0433'
      when v_rechazo = 'esa contraparte ya concilia otro movimiento' then '23505'
      when v_rechazo = 'la contraparte no existe' then '22023'
      else 'P0434' end;
  end if;
  v_ver := operacion.siguiente_version_mov(p_mov);
  insert into operacion.clasificacion_movimiento (movimiento_crudo_id, version, estado, tipo, pedido_id, cliente_id, socio_id, proveedor_id, contraparte_tipo, contraparte_id)
    values (p_mov, v_ver, 'conciliado', v_vig.tipo, v_vig.pedido_id, v_vig.cliente_id, v_vig.socio_id, v_vig.proveedor_id, p_contraparte_tipo, p_contraparte_id);
  v_res := jsonb_build_object('movimiento_id', p_mov, 'version', v_ver, 'estado', 'conciliado');
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

create function operacion.marcar_movimiento(p_clave text, p_mov bigint, p_estado text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_vig record; v_ver int; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'marcar_movimiento', 'm', p_mov, 'e', p_estado, 'x', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if p_estado not in ('duplicado', 'descartado') then raise exception 'estado inválido' using errcode = '22023'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'marcar un movimiento exige motivo' using errcode = '23502'; end if;
  select * into v_vig from operacion.movimiento_vigente where id = p_mov;
  if not found then raise exception 'movimiento desconocido' using errcode = '22023'; end if;
  if v_vig.estado = 'conciliado' then raise exception 'un movimiento conciliado se reclasifica con motivo antes de descartarse' using errcode = 'P0443'; end if;
  v_ver := operacion.siguiente_version_mov(p_mov);
  insert into operacion.clasificacion_movimiento (movimiento_crudo_id, version, estado, motivo) values (p_mov, v_ver, p_estado, btrim(p_motivo));
  v_res := jsonb_build_object('movimiento_id', p_mov, 'version', v_ver, 'estado', p_estado);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas
-- ---------------------------------------------------------------------------
create function operacion.movimientos_resumen() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'estados', coalesce((select jsonb_agg(jsonb_build_object('estado', e.estado, 'n', e.n, 'entradas_cent', e.ent, 'salidas_cent', e.sal) order by e.ord)
       from (select v.estado, count(*)::int as n, coalesce(sum(v.monto_cent) filter (where v.monto_cent > 0), 0)::bigint as ent, coalesce(-sum(v.monto_cent) filter (where v.monto_cent < 0), 0)::bigint as sal,
                    case v.estado when 'sin_clasificar' then 1 when 'clasificado' then 2 when 'conciliado' then 3 when 'duplicado' then 4 else 5 end as ord
               from operacion.movimiento_vigente v group by v.estado) e), '[]'::jsonb),
    'total', (select count(*)::int from operacion.movimiento_crudo),
    'importaciones', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'fuente', i.fuente, 'nombre_archivo', i.nombre_archivo, 'filas_total', i.filas_total, 'filas_nuevas', i.filas_nuevas,
                                'filas_duplicadas', i.filas_duplicadas, 'creada_at', i.creada_at) order by i.id desc) from (select * from operacion.importacion order by id desc limit 12) i), '[]'::jsonb))
$$;

create function operacion.movimientos_lista(p_estado text, p_limite int, p_desplazamiento int) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*)::int from operacion.movimiento_vigente v where p_estado is null or v.estado = p_estado),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'fecha_neg', q.fecha_neg, 'monto_cent', q.monto_cent, 'cuenta', q.cuenta_texto, 'origen', q.origen_texto, 'mensaje', q.mensaje_original,
        'estado', q.estado, 'tipo', q.tipo, 'cliente', c.nombre_canonico, 'pedido', pe.folio, 'socio', so.nombre, 'proveedor', pr.nombre, 'contraparte_tipo', q.contraparte_tipo,
        'contraparte_id', q.contraparte_id, 'motivo', q.motivo) order by q.fecha_neg desc, q.id desc)
      from (select * from operacion.movimiento_vigente v where p_estado is null or v.estado = p_estado order by v.fecha_neg desc, v.id desc limit greatest(least(p_limite, 200), 1) offset greatest(p_desplazamiento, 0)) q
      left join catalogo.cliente c on c.id = q.cliente_id left join operacion.pedido pe on pe.id = q.pedido_id left join catalogo.socio so on so.id = q.socio_id left join catalogo.proveedor pr on pr.id = q.proveedor_id), '[]'::jsonb))
$$;

-- Agrupa los movimientos clasificados o conciliados por pedido, cliente, socio o proveedor. Los sin clasificar no cuentan en ninguna agrupacion.
create function operacion.movimientos_agrupados(p_dim text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_dim not in ('pedido', 'cliente', 'socio', 'proveedor') then raise exception 'agrupación desconocida' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'etiqueta', g.etiqueta, 'n', g.n, 'entradas_cent', g.ent, 'salidas_cent', g.sal, 'neto_cent', g.ent - g.sal, 'conciliados', g.conc,
                                        'primera', g.primera, 'ultima', g.ultima) order by g.etiqueta)
    from (
      select case p_dim when 'pedido' then v.pedido_id when 'cliente' then v.cliente_id when 'socio' then v.socio_id else v.proveedor_id end as id,
             case p_dim when 'pedido' then pe.folio when 'cliente' then c.nombre_canonico when 'socio' then so.nombre else pr.nombre end as etiqueta,
             count(*)::int as n, coalesce(sum(v.monto_cent) filter (where v.monto_cent > 0), 0)::bigint as ent, coalesce(-sum(v.monto_cent) filter (where v.monto_cent < 0), 0)::bigint as sal,
             count(*) filter (where v.estado = 'conciliado')::int as conc, min(v.fecha_neg) as primera, max(v.fecha_neg) as ultima
        from operacion.movimiento_vigente v
        left join operacion.pedido pe on pe.id = v.pedido_id left join catalogo.cliente c on c.id = v.cliente_id left join catalogo.socio so on so.id = v.socio_id left join catalogo.proveedor pr on pr.id = v.proveedor_id
       where v.estado in ('clasificado', 'conciliado')
         and (case p_dim when 'pedido' then v.pedido_id when 'cliente' then v.cliente_id when 'socio' then v.socio_id else v.proveedor_id end) is not null
       group by 1, 2) g), '[]'::jsonb);
end $$;

create function operacion.movimientos_desglose(p_dim text, p_id bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'fecha_neg', v.fecha_neg, 'monto_cent', v.monto_cent, 'tipo', v.tipo, 'estado', v.estado, 'cuenta', v.cuenta_texto, 'origen', v.origen_texto, 'mensaje', v.mensaje_original)
                                    order by v.fecha_neg, v.id), '[]'::jsonb)
  from operacion.movimiento_vigente v
  where v.estado in ('clasificado', 'conciliado') and p_dim in ('pedido', 'cliente', 'socio', 'proveedor')
    and (case p_dim when 'pedido' then v.pedido_id when 'cliente' then v.cliente_id when 'socio' then v.socio_id else v.proveedor_id end) = p_id
$$;

-- Utilidad por pedido (la de la nota vigente de cada pedido enviado), utilidad acumulada por socio (50/50, el centavo impar a Angelo) con lo retirado y lo retenido, y
-- la posicion de cada socio con la sociedad (la misma cifra del encabezado) y, aparte, la diferencia por la compra de la cuenta de socios. Todas las cifras salen de funciones existentes: aqui no se calcula nada nuevo.
-- Quien debe a quien entre los socios (spec 14, seccion 12): (AportadoNeto(Angelo) - AportadoNeto(Javier)) / 2. AportadoNeto = lo puesto o pagado por la sociedad
-- (aportaciones y libro del socio: pagos, retiros, utilidad asignada) menos el dinero de la sociedad que tiene en su poder (neto_socio), sin lo pagado de mas que quedo
-- fuera de la sociedad (partidas abiertas), igual que cuenta_socios(). El centavo impar se redondea como cuenta_socios() (hacia abajo de (A - J) / 2), para que las
-- dos cifras coincidan centavo a centavo cuando la compra la pusieron los socios. Signo de javier_debe_a_angelo_cent: > 0 Javier debe a Angelo; < 0 Angelo debe a Javier.
create function operacion.posicion_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_ida bigint; v_idj bigint; v_a bigint; v_j bigint; v_d bigint;
begin
  select id into v_ida from catalogo.socio where nombre = 'Angelo';
  select id into v_idj from catalogo.socio where nombre = 'Javier';
  v_a := operacion.neto_socio(v_ida) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0);
  v_j := operacion.neto_socio(v_idj) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0);
  v_d := floor((v_a - v_j)::numeric / 2)::bigint;
  return jsonb_build_object('aportado_neto_angelo_cent', v_a, 'aportado_neto_javier_cent', v_j, 'javier_debe_a_angelo_cent', v_d,
    'deudor', case when v_d > 0 then 'Javier' when v_d < 0 then 'Angelo' end, 'acreedor', case when v_d > 0 then 'Angelo' when v_d < 0 then 'Javier' end, 'monto_cent', abs(v_d));
end $$;

create function operacion.movimientos_utilidad() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_u jsonb; v_total bigint; v_ped jsonb; v_socios jsonb; v_cs jsonb; v_na bigint; v_nj bigint; v_deuda jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', x.id, 'folio', x.folio, 'cliente', x.cliente, 'fecha_envio', x.fecha_envio, 'utilidad_cent', x.u, 'provisional', x.prov, 'cobrado_cent', x.cobrado) order by x.fecha_envio desc, x.id desc), '[]'::jsonb),
         coalesce(sum(x.u), 0)::bigint
    into v_ped, v_total
    from (select pe.id, pe.folio, c.nombre_canonico as cliente, pe.fecha_envio, (n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint as u,
                 coalesce((n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean, false) as prov,
                 coalesce((select sum(a.monto_cent) from operacion.pago_aplicacion a where a.pedido_id = pe.id), 0)::bigint as cobrado
            from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
            join operacion.nota n on n.id = (select max(z.id) from operacion.nota z where z.pedido_id = pe.id)
           where pe.estado = 'enviado') x;
  v_u := operacion.utilidad_periodo('2000-01-01', negocio.hoy());
  select coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre,
           'mitad_cent', case s.nombre when 'Javier' then ((v_u->>'utilidad_cent')::bigint / 2) else (v_u->>'utilidad_cent')::bigint - ((v_u->>'utilidad_cent')::bigint / 2) end,
           'retirado_cent', operacion.libro_socio(s.id, 'retiro'), 'retenido_cent', operacion.saldo_socio(s.id, 'fondos')) order by s.nombre), '[]'::jsonb)
    into v_socios from catalogo.socio s;
  v_cs := operacion.cuenta_socios();
  -- Posicion de cada socio con la sociedad: la MISMA cifra que el encabezado de la app (api.pulso): neto_socio, + la sociedad le debe, - el debe.
  v_na := operacion.neto_socio((select id from catalogo.socio where nombre = 'Angelo'));
  v_nj := operacion.neto_socio((select id from catalogo.socio where nombre = 'Javier'));
  v_deuda := operacion.posicion_socios();
  -- posicion_diferencia_cent es la brecha entre las dos posiciones (lo que muestra el encabezado); quien debe a quien es la MITAD de la brecha de lo aportado neto
  -- (spec 14, seccion 12: (AportadoNeto(A) - AportadoNeto(J)) / 2), la misma cifra de cuenta_socios() cuando la compra la pusieron los socios.
  return jsonb_build_object('posicion_angelo_cent', v_na, 'posicion_javier_cent', v_nj,
    'posicion_mayor', case when v_na >= v_nj then 'Angelo' else 'Javier' end, 'posicion_diferencia_cent', abs(v_na - v_nj),
    'deudor', v_deuda->>'deudor', 'acreedor', v_deuda->>'acreedor', 'deuda_entre_socios_cent', (v_deuda->>'monto_cent')::bigint,
    'pedidos', v_ped, 'utilidad_pedidos_cent', v_total, 'utilidad_total_cent', (v_u->>'utilidad_cent')::bigint, 'provisional', (v_u->>'provisional')::boolean,
    'socios', v_socios, 'javier_debe_a_angelo_cent', (v_cs->>'javier_debe_a_angelo_cent')::bigint, 'cuadra', (v_cs->>'cuadra')::boolean, 'costo_cent', (v_cs->>'costo_cent')::bigint);
end $$;

-- API
create function api.mov_importar(p_clave_idem text, p_fuente text, p_nombre_archivo text, p_sha256 text, p_filas jsonb, p_solo_contar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.importar_movimientos(p_clave_idem, p_fuente, p_nombre_archivo, p_sha256, p_filas, p_solo_contar); end $$;
create function api.mov_clasificar(p_clave_idem text, p_mov bigint, p_tipo text, p_ref jsonb, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.clasificar_movimiento(p_clave_idem, p_mov, p_tipo, p_ref, p_motivo); end $$;
create function api.mov_conciliar(p_clave_idem text, p_mov bigint, p_contraparte_tipo text, p_contraparte_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.conciliar_movimiento(p_clave_idem, p_mov, p_contraparte_tipo, p_contraparte_id); end $$;
create function api.mov_marcar(p_clave_idem text, p_mov bigint, p_estado text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.marcar_movimiento(p_clave_idem, p_mov, p_estado, p_motivo); end $$;
create function api.mov_resumen() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.movimientos_resumen(); end $$;
create function api.mov_lista(p_estado text default null, p_limite int default 50, p_desplazamiento int default 0) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.movimientos_lista(p_estado, p_limite, p_desplazamiento); end $$;
create function api.mov_agrupado(p_dim text) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.movimientos_agrupados(p_dim); end $$;
create function api.mov_desglose(p_dim text, p_id bigint) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.movimientos_desglose(p_dim, p_id); end $$;
create function api.mov_utilidad() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.movimientos_utilidad(); end $$;
create function api.mov_candidatas(p_mov bigint) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_tipo text; v_monto bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  -- Hechos que sirven de contraparte de ESTE movimiento: la misma regla que conciliar (tipo, vigencia, suma, sentido y uso), aplicada a los de la misma suma.
  select operacion.mov_tipo_contraparte(v.tipo), abs(v.monto_cent) into v_tipo, v_monto from operacion.movimiento_vigente v where v.id = p_mov and v.estado = 'clasificado';
  if v_tipo is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('tipo', v_tipo, 'id', c.id, 'texto', c.texto, 'monto_cent', c.monto) order by c.id)
      from (select p.id, p.folio || ' · ' || p.fecha_neg as texto, p.monto_cent as monto from operacion.pago p where v_tipo = 'pago' and p.monto_cent = v_monto
            union all select g.id, g.folio || ' · ' || g.categoria, g.monto_cent from operacion.gasto g where v_tipo = 'gasto' and g.monto_cent = v_monto
            union all select a.id, 'Aportación ' || a.fecha_neg, a.monto_cent from operacion.aportacion_socio a where v_tipo = 'aportacion' and a.monto_cent = v_monto) c
     where operacion.mov_contraparte_rechazo(p_mov, v_tipo, c.id) is null), '[]'::jsonb);
end $$;

create function api.mov_referencias() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object(
    'clientes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre_canonico) order by c.nombre_canonico) from catalogo.cliente c where c.activo), '[]'::jsonb),
    'proveedores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nombre', p.nombre) order by p.nombre) from catalogo.proveedor p), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'folio', x.folio, 'cliente', x.cliente) order by x.id desc)
                           from (select pe.id, pe.folio, c.nombre_canonico as cliente from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
                                  where pe.estado in ('confirmado', 'enviado') order by pe.id desc limit 300) x), '[]'::jsonb));
end $$;

revoke execute on all functions in schema operacion, catalogo, contabilidad, apertura from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function api.mov_importar(text, text, text, text, jsonb, boolean), api.mov_clasificar(text, bigint, text, jsonb, text), api.mov_conciliar(text, bigint, text, bigint),
  api.mov_marcar(text, bigint, text, text), api.mov_resumen(), api.mov_lista(text, int, int), api.mov_agrupado(text), api.mov_desglose(text, bigint), api.mov_utilidad(), api.mov_candidatas(bigint), api.mov_referencias() to authenticated;
