-- F1 / 0003: eventos, movimientos de inventario (solo insercion), existencia derivada, costo promedio ponderado movil,
-- bloqueo de existencia negativa y de fechas retroactivas, conteo fisico con fecha y hora.
-- El inventario es de Angelo y Javier; la ubicacion es 'Bodega Omar'. Nunca "inventario de Omar".

create table operacion.evento (
  id bigint generated always as identity primary key,
  folio text not null unique,
  tipo text not null,
  fecha_neg date not null,
  hora timestamptz not null default now(),
  actor_id uuid,
  canal text not null default 'web' check (canal in ('web', 'telegram', 'importacion')),
  mensaje_origen text,
  payload jsonb,
  clave_idem text unique,
  reversa_de bigint references operacion.evento (id),
  motivo_reversa text,
  check ((reversa_de is null) = (motivo_reversa is null))
);
create unique index evento_una_reversa on operacion.evento (reversa_de) where reversa_de is not null;

create function operacion.t6_evento() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.folio := seguridad.siguiente_folio('E');
  return new;
end $$;
create trigger evento_folio before insert on operacion.evento for each row execute function operacion.t6_evento();

create table operacion.movimiento_inventario (
  id bigint generated always as identity primary key,
  fecha_neg date not null,
  hora timestamptz not null default now(),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  ubicacion text not null references catalogo.ubicacion (codigo),
  tipo text not null check (tipo in ('entrada_compra', 'salida_pedido', 'salida_toma_omar', 'devolucion', 'merma', 'ajuste_conteo', 'traspaso_puente', 'reversa')),
  cantidad int not null check (cantidad <> 0),
  lote_id bigint, -- FK a operacion.lote cuando exista (F2); obligatorio en entrada_compra desde entonces
  costo_unit_aplicado_cent bigint not null default 0,
  valor_cent bigint,
  piezas_modelo_despues int not null default 0,
  valor_modelo_despues_cent bigint not null default 0,
  piezas_sku_despues int not null default 0,
  evento_id bigint not null references operacion.evento (id),
  reversa_de bigint references operacion.movimiento_inventario (id),
  nota text,
  check ((tipo = 'reversa') = (reversa_de is not null))
);
create index movimiento_modelo_idx on operacion.movimiento_inventario (modelo_id, id);
create index movimiento_sku_idx on operacion.movimiento_inventario (sku_id, id);
create unique index movimiento_una_reversa on operacion.movimiento_inventario (reversa_de) where reversa_de is not null;

-- Derivadas (las mantiene el trigger; nadie las escribe a mano).
create table operacion.existencia_modelo (
  modelo_id bigint primary key references catalogo.modelo (id),
  piezas int not null default 0 check (piezas >= 0),
  valor_cent bigint not null default 0 check (valor_cent >= 0),
  costo_prom_cent bigint generated always as (case when piezas > 0 then (2 * valor_cent + piezas) / (2 * piezas) else 0 end) stored,
  check (piezas > 0 or valor_cent = 0)
);
create table operacion.existencia_sku_ubicacion (
  sku_id bigint not null references catalogo.sku (id),
  ubicacion text not null references catalogo.ubicacion (codigo),
  piezas int not null default 0 check (piezas >= 0),
  primary key (sku_id, ubicacion)
);

-- T2: bloquea por modelo, valua al costo promedio, rechaza existencia < 0 y fechas anteriores al ultimo movimiento del modelo.
create function operacion.t2_movimiento() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_e int; v_v bigint; v_ult date; v_n int; v_modelo_sku bigint; v_sku_pzs int; v_ub_pzs int; v_val bigint;
begin
  select s.modelo_id into v_modelo_sku from catalogo.sku s where s.id = new.sku_id;
  if v_modelo_sku is null or v_modelo_sku <> new.modelo_id then raise exception 'el SKU no pertenece al modelo' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.modelo_id::text, 0));
  select coalesce(max(m.fecha_neg), '0001-01-01') into v_ult from operacion.movimiento_inventario m where m.modelo_id = new.modelo_id;
  if new.fecha_neg < v_ult then
    raise exception 'fecha retroactiva: el ultimo movimiento del modelo es del % (solo reversa y nuevo registro)', v_ult using errcode = 'P0422';
  end if;
  select coalesce(e.piezas, 0), coalesce(e.valor_cent, 0) into v_e, v_v from (select 1) x left join operacion.existencia_modelo e on e.modelo_id = new.modelo_id;

  if new.cantidad > 0 then
    v_val := new.valor_cent;
    if v_val is null then
      if new.tipo in ('ajuste_conteo', 'devolucion') and v_e > 0 then v_val := negocio.redondear_medio_arriba(v_v * new.cantidad, v_e);
      else raise exception 'una entrada necesita su valor (costo puesto)' using errcode = '23502'; end if;
    end if;
    if v_val < 0 then raise exception 'valor de entrada negativo' using errcode = '23514'; end if;
  else
    v_n := -new.cantidad;
    if v_n > v_e then raise exception 'existencia insuficiente del modelo: hay %, se piden %', v_e, v_n using errcode = 'P0423'; end if;
    if new.valor_cent is null or new.tipo in ('salida_pedido', 'salida_toma_omar', 'merma') then
      -- Salida al costo promedio ponderado movil; si sale todo, sale todo el valor (residuo exacto).
      v_val := case when v_n = v_e then -v_v else -negocio.redondear_medio_arriba(v_v * v_n, v_e) end;
    else
      v_val := new.valor_cent;
      if -v_val > v_v or (v_n = v_e and -v_val <> v_v) then raise exception 'valor de salida inconsistente con el inventario' using errcode = '23514'; end if;
    end if;
  end if;

  select coalesce(sum(u.piezas), 0) into v_sku_pzs from operacion.existencia_sku_ubicacion u where u.sku_id = new.sku_id;
  select coalesce(u.piezas, 0) into v_ub_pzs from (select 1) x left join operacion.existencia_sku_ubicacion u on u.sku_id = new.sku_id and u.ubicacion = new.ubicacion;
  if v_ub_pzs + new.cantidad < 0 then raise exception 'existencia insuficiente en la ubicacion' using errcode = 'P0423'; end if;

  new.valor_cent := v_val;
  new.costo_unit_aplicado_cent := negocio.redondear_medio_arriba(abs(v_val), abs(new.cantidad));
  new.piezas_modelo_despues := v_e + new.cantidad;
  new.valor_modelo_despues_cent := v_v + v_val;
  new.piezas_sku_despues := v_sku_pzs + new.cantidad;
  if new.valor_modelo_despues_cent < 0 or (new.piezas_modelo_despues = 0 and new.valor_modelo_despues_cent <> 0) then
    raise exception 'el movimiento deja el valor del inventario inconsistente' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger movimiento_t2 before insert on operacion.movimiento_inventario for each row execute function operacion.t2_movimiento();

create function operacion.t2b_aplicar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into operacion.existencia_modelo (modelo_id, piezas, valor_cent) values (new.modelo_id, new.piezas_modelo_despues, new.valor_modelo_despues_cent)
    on conflict (modelo_id) do update set piezas = excluded.piezas, valor_cent = excluded.valor_cent;
  insert into operacion.existencia_sku_ubicacion (sku_id, ubicacion, piezas) values (new.sku_id, new.ubicacion, greatest(new.cantidad, 0))
    on conflict (sku_id, ubicacion) do update set piezas = operacion.existencia_sku_ubicacion.piezas + new.cantidad;
  return new;
end $$;
create trigger movimiento_t2b after insert on operacion.movimiento_inventario for each row execute function operacion.t2b_aplicar();

-- Conteo fisico (fecha y hora obligatorias). Las lineas se escriben al cerrar.
create table operacion.conteo (
  id bigint generated always as identity primary key,
  ubicacion text not null references catalogo.ubicacion (codigo),
  tipo text not null check (tipo in ('semanal', 'recepcion', 'cuadre_inicial')),
  contado_at timestamptz not null,
  contado_por uuid,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  creado_at timestamptz not null default now(),
  evento_id bigint references operacion.evento (id)
);
create table operacion.conteo_linea (
  id bigint generated always as identity primary key,
  conteo_id bigint not null references operacion.conteo (id),
  sku_id bigint not null references catalogo.sku (id),
  contado int not null check (contado >= 0),
  esperado_sistema int not null,
  vendido_por_recoger int not null default 0,
  diferencia int generated always as (contado - esperado_sistema) stored,
  explicacion_tipo text check (explicacion_tipo in ('venta_no_registrada', 'toma_no_registrada', 'error_de_sabor', 'reclamo_proveedor', 'merma', 'error_de_conteo')),
  explicacion_ref text,
  movimiento_ajuste_id bigint references operacion.movimiento_inventario (id),
  unique (conteo_id, sku_id)
);

-- T1 en las tablas de solo insercion.
do $$
declare t text;
begin
  foreach t in array array['evento', 'movimiento_inventario', 'conteo_linea'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    -- evento y movimiento_inventario son referenciados por FK (FOR KEY SHARE exige UPDATE): ahi el UPDATE lo bloquea el trigger T1.
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    if t = 'conteo_linea' then execute format('revoke update on operacion.%I from postgres', t); end if;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'operacion' and c.relkind = 'r' loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Escritura
-- ---------------------------------------------------------------------------
create function operacion.crear_evento(p_tipo text, p_fecha date, p_clave text, p_payload jsonb, p_origen text default null, p_reversa_de bigint default null, p_motivo text default null) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  insert into operacion.evento (tipo, fecha_neg, actor_id, canal, mensaje_origen, payload, clave_idem, reversa_de, motivo_reversa)
  values (p_tipo, p_fecha, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, seguridad.canal_actual(), p_origen, p_payload, p_clave, p_reversa_de, p_motivo)
  returning id into v_id;
  return v_id;
end $$;

-- Un movimiento = un evento. La fecha por omision es la de negocio de hoy (Merida), nunca la fecha UTC.
create function operacion.registrar_movimiento(p_clave_idem text, p_modelo text, p_sabor text, p_ubicacion text, p_tipo text, p_cantidad int,
                                               p_valor_cent bigint default null, p_fecha date default null, p_origen text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_sku bigint; v_modelo bigint; v_ev bigint; v_mov operacion.movimiento_inventario; v_res jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy());
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_movimiento', 'm', p_modelo, 's', p_sabor, 'u', p_ubicacion, 't', p_tipo, 'c', p_cantidad, 'v', p_valor_cent, 'f', p_fecha));
  if v_prev is not null then return v_prev; end if;
  if p_tipo = 'reversa' then raise exception 'las reversas se hacen con reversar_evento' using errcode = '22023'; end if;
  select s.id, s.modelo_id into v_sku, v_modelo from catalogo.sku s join catalogo.modelo m on m.id = s.modelo_id join catalogo.sabor sa on sa.id = s.sabor_id
    where m.nombre_norm = catalogo.normalizar(p_modelo) and sa.nombre_norm = catalogo.normalizar(p_sabor);
  if v_sku is null then raise exception 'SKU desconocido (modelo/sabor)' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('movimiento_' || p_tipo, v_fecha, p_clave_idem, jsonb_build_object('modelo', p_modelo, 'sabor', p_sabor, 'cantidad', p_cantidad), p_origen);
  insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
    values (v_fecha, v_sku, v_modelo, p_ubicacion, p_tipo, p_cantidad, p_valor_cent, v_ev) returning * into v_mov;
  v_res := jsonb_build_object('evento_id', v_ev, 'movimiento_id', v_mov.id, 'piezas_modelo', v_mov.piezas_modelo_despues, 'valor_modelo_cent', v_mov.valor_modelo_despues_cent, 'valor_cent', v_mov.valor_cent);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Contramovimiento: nunca borra. Cada movimiento del evento se invierte con su mismo valor.
create function operacion.reversar_evento(p_clave_idem text, p_evento_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_ev bigint; m operacion.movimiento_inventario; v_res jsonb; v_n int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reversar_evento', 'e', p_evento_id, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la reversa exige motivo' using errcode = '23502'; end if;
  if exists (select 1 from operacion.evento where id = p_evento_id and reversa_de is not null) then raise exception 'una reversa no se reversa' using errcode = '22023'; end if;
  if not exists (select 1 from operacion.evento where id = p_evento_id) then raise exception 'evento desconocido' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('reversa', negocio.hoy(), p_clave_idem, jsonb_build_object('evento', p_evento_id), null, p_evento_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = p_evento_id order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  v_res := jsonb_build_object('evento_id', v_ev, 'movimientos', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.abrir_conteo(p_clave_idem text, p_ubicacion text, p_tipo text, p_contado_at timestamptz) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'abrir_conteo', 'u', p_ubicacion, 't', p_tipo, 'c', p_contado_at));
  if v_prev is not null then return v_prev; end if;
  if p_contado_at is null then raise exception 'el conteo exige fecha y hora' using errcode = '23502'; end if;
  insert into operacion.conteo (ubicacion, tipo, contado_at, contado_por) values (p_ubicacion, p_tipo, p_contado_at, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid) returning id into v_id;
  v_res := jsonb_build_object('conteo_id', v_id);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Cierre: p_lineas = [{modelo, sabor, contado, explicacion_tipo?, explicacion_ref?}]. Por modelo, el valor neto del ajuste es el del costo
-- promedio de las piezas netas que faltan o sobran (una sola redondeada), repartido sin residuo: primero salen las diferencias negativas y la
-- ultima entrada absorbe el residuo. Asi 1,536 facturadas contra 1,524 contadas mueven exactamente 12 piezas al costo promedio.
create function operacion.cerrar_conteo(p_clave_idem text, p_conteo_id bigint, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.conteo; l record; v_res jsonb; v_ev bigint; v_lin bigint; v_mov bigint;
  g record; v_e int; v_v bigint; v_neto int; v_pos_total int; v_valor_neto bigint; v_val_pos_acum bigint; v_pos_hecho int; v_ajustes int := 0; v_val bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_conteo', 'c', p_conteo_id, 'l', p_lineas));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.conteo where id = p_conteo_id for update;
  if not found or c.estado <> 'abierto' then raise exception 'conteo inexistente o ya cerrado' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('conteo_cerrado', negocio.fecha_neg(c.contado_at), p_clave_idem, jsonb_build_object('conteo', c.id));

  create temporary table if not exists _conteo_tmp (modelo_id bigint, sku_id bigint, contado int, esperado int, expl_tipo text, expl_ref text) on commit drop;
  delete from _conteo_tmp;
  insert into _conteo_tmp
  select s.modelo_id, s.id, (x->>'contado')::int, coalesce(u.piezas, 0), x->>'explicacion_tipo', x->>'explicacion_ref'
  from jsonb_array_elements(p_lineas) x
  join catalogo.modelo m on m.nombre_norm = catalogo.normalizar(x->>'modelo')
  join catalogo.sabor sa on sa.nombre_norm = catalogo.normalizar(x->>'sabor')
  join catalogo.sku s on s.modelo_id = m.id and s.sabor_id = sa.id
  left join operacion.existencia_sku_ubicacion u on u.sku_id = s.id and u.ubicacion = c.ubicacion;
  if (select count(*) from _conteo_tmp) <> jsonb_array_length(p_lineas) then raise exception 'linea de conteo con SKU desconocido' using errcode = '22023'; end if;

  for g in select distinct modelo_id from _conteo_tmp order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(g.modelo_id::text, 0));
    select coalesce(e.piezas, 0), coalesce(e.valor_cent, 0) into v_e, v_v from (select 1) x left join operacion.existencia_modelo e on e.modelo_id = g.modelo_id;
    select coalesce(sum(contado - esperado), 0), coalesce(sum(greatest(contado - esperado, 0)), 0) into v_neto, v_pos_total from _conteo_tmp where modelo_id = g.modelo_id;
    -- Valor neto del ajuste (con signo) al costo promedio de las piezas netas.
    v_valor_neto := case when v_neto = 0 then 0 when v_neto < 0 then -(case when -v_neto = v_e then v_v else negocio.redondear_medio_arriba(v_v * (-v_neto), greatest(v_e, 1)) end)
                         else negocio.redondear_medio_arriba(v_v * v_neto, greatest(v_e, 1)) end;
    -- Salidas primero: cada una al costo promedio de la existencia ANTES del cierre; luego las entradas.
    v_val_pos_acum := 0; v_pos_hecho := 0;
    declare v_sal_total bigint := 0; v_sal_pzs int := 0;
    begin
      for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado < esperado order by sku_id loop
        v_val := case when v_e = 0 then 0 else negocio.redondear_medio_arriba(v_v * (l.esperado - l.contado), v_e) end;
        v_sal_total := v_sal_total + v_val; v_sal_pzs := v_sal_pzs + (l.esperado - l.contado);
      end loop;
      -- Valor total de las salidas = el de las piezas que salen; el de las entradas = salidas + valor neto (con signo): se reparte sin residuo.
      if v_sal_pzs > 0 then v_sal_total := case when v_sal_pzs = v_e then v_v else v_sal_total end; end if;
      for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado < esperado order by sku_id loop
        v_val := case when v_e = 0 then 0 else negocio.redondear_medio_arriba(v_v * (l.esperado - l.contado), v_e) end;
        insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
          values (negocio.fecha_neg(c.contado_at), c.contado_at, l.sku_id, g.modelo_id, c.ubicacion, 'ajuste_conteo', l.contado - l.esperado, -v_val, v_ev) returning id into v_mov;
        update _conteo_tmp set expl_ref = coalesce(expl_ref, '') where sku_id = l.sku_id;
        insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref, movimiento_ajuste_id)
          values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''), v_mov);
        v_ajustes := v_ajustes + 1;
      end loop;
      declare v_total_entradas bigint := v_sal_total + v_valor_neto;
      begin
        for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado > esperado order by sku_id loop
          v_pos_hecho := v_pos_hecho + (l.contado - l.esperado);
          v_val := case when v_pos_hecho = v_pos_total then v_total_entradas - v_val_pos_acum
                        else negocio.redondear_medio_arriba(v_total_entradas * (l.contado - l.esperado), v_pos_total) end;
          v_val_pos_acum := v_val_pos_acum + v_val;
          insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
            values (negocio.fecha_neg(c.contado_at), c.contado_at, l.sku_id, g.modelo_id, c.ubicacion, 'ajuste_conteo', l.contado - l.esperado, v_val, v_ev) returning id into v_mov;
          insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref, movimiento_ajuste_id)
            values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''), v_mov);
          v_ajustes := v_ajustes + 1;
        end loop;
      end;
    end;
  end loop;
  -- Lineas sin diferencia: se guardan sin movimiento.
  for l in select * from _conteo_tmp t where contado = esperado loop
    insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref)
      values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''));
  end loop;
  update operacion.conteo set estado = 'cerrado', evento_id = v_ev where id = c.id;
  v_res := jsonb_build_object('conteo_id', c.id, 'evento_id', v_ev, 'ajustes', v_ajustes);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
alter default privileges in schema operacion revoke execute on functions from public, anon, authenticated;
