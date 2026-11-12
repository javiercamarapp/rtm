-- Devoluciones / 2: devolucion de mercancia de un CLIENTE (nota de credito) y devolucion a un PROVEEDOR.
-- Cliente: regresan piezas a Bodega Omar al valor al que salieron (o se mandan a merma si vienen danadas), baja la cuenta por cobrar del pedido por
--   piezas x precio de la nota vigente (sin envio ni descuento: parametro pendiente del dueno), y si el cliente ya habia pagado de mas, el excedente
--   se libera a saldo a favor. La nota original NO cambia: la devolucion es un documento aparte (DV-xxxx) enlazado al pedido.
-- Proveedor: salen piezas del inventario al costo promedio y la cuenta con el proveedor sube (saldo a favor) por ese mismo valor; cualquier diferencia
--   pactada con el proveedor se captura con el ajuste de proveedor que ya existe.
-- Todo es de solo insercion; se corrige con anulaciones (contramovimientos) y nunca se borra.

alter table seguridad.contador_folio drop constraint contador_folio_serie_check;
alter table seguridad.contador_folio add constraint contador_folio_serie_check check (serie in ('P', 'PG', 'C', 'G', 'L', 'T', 'E', 'PO', 'CR', 'A', 'INV', 'K', 'R', 'DV', 'DP'));
insert into seguridad.contador_folio (serie) values ('DV'), ('DP');

alter table operacion.movimiento_inventario drop constraint movimiento_inventario_tipo_check;
alter table operacion.movimiento_inventario add constraint movimiento_inventario_tipo_check
  check (tipo in ('entrada_compra', 'salida_pedido', 'salida_toma_omar', 'devolucion', 'devolucion_proveedor', 'merma', 'ajuste_conteo', 'traspaso_puente', 'reversa', 'apertura'));
alter table operacion.cuenta_proveedor_mov drop constraint cuenta_proveedor_mov_concepto_check;
alter table operacion.cuenta_proveedor_mov add constraint cuenta_proveedor_mov_concepto_check
  check (concepto in ('pago_cliente_redirigido', 'pago_socio', 'pago_sociedad', 'oc_aplicada', 'ajuste', 'reclamo_diferencia', 'devolucion_proveedor', 'reversa'));

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table operacion.devolucion_cliente (
  id bigint generated always as identity primary key,
  folio text not null unique,
  pedido_id bigint not null references operacion.pedido (id),
  cliente_id bigint not null references catalogo.cliente (id),
  fecha_neg date not null,
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  piezas int not null check (piezas > 0),
  monto_cent bigint not null check (monto_cent > 0),
  costo_cent bigint not null check (costo_cent >= 0),
  liberado_cent bigint not null default 0 check (liberado_cent >= 0),
  saldo_antes_cent bigint not null,
  saldo_despues_cent bigint not null,
  snapshot_cliente jsonb not null,
  texto_whatsapp text not null,
  emitida_por uuid,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);
create index devolucion_cliente_pedido_idx on operacion.devolucion_cliente (pedido_id);

create table operacion.devolucion_cliente_linea (
  id bigint generated always as identity primary key,
  devolucion_id bigint not null references operacion.devolucion_cliente (id),
  pedido_linea_id bigint not null references operacion.pedido_linea (id),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas int not null check (piezas > 0),
  precio_cent bigint not null check (precio_cent > 0),
  monto_cent bigint not null check (monto_cent > 0),
  costo_valor_cent bigint not null check (costo_valor_cent >= 0),
  destino text not null check (destino in ('inventario', 'merma')),
  movimiento_id bigint not null references operacion.movimiento_inventario (id)
);
create index devolucion_cliente_linea_idx on operacion.devolucion_cliente_linea (pedido_linea_id, sku_id);

create table operacion.devolucion_cliente_anulacion (
  id bigint generated always as identity primary key,
  devolucion_id bigint not null unique references operacion.devolucion_cliente (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  evento_id bigint not null references operacion.evento (id)
);

create table operacion.devolucion_proveedor (
  id bigint generated always as identity primary key,
  folio text not null unique,
  proveedor_id bigint not null references catalogo.proveedor (id),
  compra_id bigint references operacion.compra (id),
  fecha_neg date not null,
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  piezas int not null check (piezas > 0),
  valor_cent bigint not null check (valor_cent >= 0),
  saldo_antes_cent bigint not null,
  saldo_despues_cent bigint not null,
  snapshot jsonb not null,
  texto text not null,
  movimiento_prov_id bigint references operacion.cuenta_proveedor_mov (id),
  emitida_por uuid,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);

create table operacion.devolucion_proveedor_linea (
  id bigint generated always as identity primary key,
  devolucion_id bigint not null references operacion.devolucion_proveedor (id),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas int not null check (piezas > 0),
  valor_cent bigint not null check (valor_cent >= 0),
  movimiento_id bigint not null references operacion.movimiento_inventario (id)
);

create table operacion.devolucion_proveedor_anulacion (
  id bigint generated always as identity primary key,
  devolucion_id bigint not null unique references operacion.devolucion_proveedor (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  evento_id bigint not null references operacion.evento (id)
);

-- El PDF se genera una vez y se guarda: reimprimir = los mismos bytes (igual que la nota).
create table operacion.devolucion_documento (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('cliente', 'proveedor')),
  devolucion_id bigint not null,
  variante text not null check (variante in ('pdf', 'texto')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  contenido bytea not null,
  creado_at timestamptz not null default now(),
  unique (tipo, devolucion_id, variante)
);

do $$
declare t text;
begin
  foreach t in array array['devolucion_cliente', 'devolucion_cliente_linea', 'devolucion_cliente_anulacion', 'devolucion_proveedor', 'devolucion_proveedor_linea', 'devolucion_proveedor_anulacion', 'devolucion_documento'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lecturas
-- ---------------------------------------------------------------------------
-- Credito vigente por devoluciones de un pedido (las anuladas no cuentan).
create function operacion.devuelto_pedido(p_pedido bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(d.monto_cent), 0)::bigint from operacion.devolucion_cliente d
  where d.pedido_id = p_pedido and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id)
$$;

-- Lo cobrado del pedido es la nota vigente MENOS las devoluciones vigentes. Todo el saldo y la cuenta por cobrar salen de aqui.
create or replace function operacion.pedido_cobrado(p_pedido bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select case when pe.estado = 'enviado' then coalesce((select n.total_cent from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0) - operacion.devuelto_pedido(pe.id) else 0 end
  from operacion.pedido pe where pe.id = p_pedido
$$;

-- Piezas de un sabor de un renglon que ya se devolvieron (vigentes).
create function operacion.devuelto_linea_sku(p_linea bigint, p_sku bigint) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.piezas), 0)::int from operacion.devolucion_cliente_linea l
  where l.pedido_linea_id = p_linea and l.sku_id = p_sku and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = l.devolucion_id)
$$;

-- Un pedido con devoluciones vigentes no se anula completo (las piezas ya regresaron): se anula primero la devolucion.
create or replace function operacion.anular_pedido(p_clave_idem text, p_pedido bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_ev bigint; m operacion.movimiento_inventario; v_n int := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_pedido', 'p', p_pedido, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: solo uno enviado se anula', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if operacion.devuelto_pedido(ped.id) > 0 then raise exception 'el pedido % tiene devoluciones vigentes: anula primero las devoluciones', ped.folio using errcode = 'P0428'; end if;
  if operacion.origen_es_bodega(ped.origen) then perform operacion.exigir_semana_omar_abierta(ped.fecha_envio); end if;
  v_ev := operacion.crear_evento('pedido_anulado', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio), null, ped.evento_envio_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = ped.evento_envio_id and tipo = 'salida_pedido' order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  perform operacion.revertir_renta_pedido(ped.id, v_ev);
  insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id, reversa_de)
    select a.pago_id, a.pedido_id, -a.monto_cent, v_ev, a.id from operacion.pago_aplicacion a where a.pedido_id = ped.id and a.reversa_de is null
      and not exists (select 1 from operacion.pago_aplicacion r where r.reversa_de = a.id);
  update operacion.pedido set estado = 'anulado', nota = coalesce(nota || ' | ', '') || 'Anulado: ' || p_motivo where id = ped.id;
  perform operacion.avisar('nota_corregida_o_anulada', 'NT-008', 'nota_anulada:' || ped.id, 'I', 'Pedido ' || ped.folio || ' anulado despues de enviar', 'pedido', ped.id,
    jsonb_build_object('folio', ped.folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('pedido_id', ped.id, 'estado', 'anulado', 'movimientos_revertidos', v_n);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Devolucion de un cliente
-- ---------------------------------------------------------------------------
-- p_lineas = [{linea_id, sku_id | sabor, piezas, destino: 'inventario' | 'merma'}]. destino por omision: inventario.
create function operacion.registrar_devolucion_cliente(p_clave_idem text, p_pedido bigint, p_lineas jsonb, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; ped operacion.pedido; ult operacion.nota; v_ev bigint; v_id bigint; v_folio text; r record; v_surtido int; v_costo_tot bigint; v_prev_n int; v_prev_val bigint;
  v_valor bigint; v_precio bigint; v_monto bigint; v_mov bigint; v_total_monto bigint := 0; v_total_costo bigint := 0; v_total_pz int := 0; v_saldo_antes bigint; v_saldo_despues bigint;
  v_cobrado bigint; v_exceso bigint; v_liberado bigint := 0; ap record; v_cli text; v_snap_lineas jsonb; v_texto text; v_snap jsonb; v_res jsonb; v_modelo text; v_sabor text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_devolucion_cliente', 'p', p_pedido, 'l', p_lineas, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la devolucion exige motivo' using errcode = '23502'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'indica lo que se devuelve' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: solo uno enviado admite devolucion', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if not operacion.origen_es_bodega(ped.origen) then raise exception 'el pedido % salio directo del proveedor: su devolucion no pasa por Bodega Omar (pendiente de definir)', ped.folio using errcode = 'P0428'; end if;
  select * into ult from operacion.nota where pedido_id = ped.id order by id desc limit 1;

  create temporary table if not exists _dev_cli_tmp (linea_id bigint, sku_id bigint, piezas int, destino text) on commit drop;
  delete from _dev_cli_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _dev_cli_tmp
  select (x->>'linea_id')::bigint,
         case when x ? 'sku_id' then (x->>'sku_id')::bigint
              else (select s.id from catalogo.sku s join catalogo.sabor sa on sa.id = s.sabor_id join operacion.pedido_linea pl on pl.modelo_id = s.modelo_id
                    where pl.id = (x->>'linea_id')::bigint and sa.nombre_norm = catalogo.normalizar(x->>'sabor')) end,
         (x->>'piezas')::int, coalesce(x->>'destino', 'inventario')
  from jsonb_array_elements(p_lineas) x;
  if exists (select 1 from _dev_cli_tmp where sku_id is null or piezas is null or piezas <= 0 or destino not in ('inventario', 'merma')) then raise exception 'renglon de devolucion invalido' using errcode = '22023'; end if;
  if exists (select 1 from _dev_cli_tmp t left join operacion.pedido_linea l on l.id = t.linea_id and l.pedido_id = ped.id where l.id is null) then raise exception 'un renglon no pertenece al pedido' using errcode = '22023'; end if;

  -- Cada (renglon, sabor) no puede devolver mas de lo que se surtio menos lo ya devuelto.
  for r in select linea_id, sku_id, sum(piezas)::int as piezas from _dev_cli_tmp group by linea_id, sku_id loop
    select coalesce(sum(s.piezas), 0)::int into v_surtido from operacion.pedido_surtido s where s.pedido_linea_id = r.linea_id and s.sku_id = r.sku_id;
    if r.piezas > v_surtido - operacion.devuelto_linea_sku(r.linea_id, r.sku_id) then
      raise exception 'se devuelven mas piezas de las surtidas: surtidas %, ya devueltas %, ahora %', v_surtido, operacion.devuelto_linea_sku(r.linea_id, r.sku_id), r.piezas using errcode = '23514';
    end if;
  end loop;

  -- Totales antes de escribir (el credito no puede pasar de lo que el pedido vale hoy).
  v_cobrado := operacion.pedido_cobrado(ped.id);
  select coalesce(sum(t.piezas * coalesce((ult.ajustes->'precios'->>(t.linea_id::text))::bigint, l.precio_cent)), 0)::bigint, coalesce(sum(t.piezas), 0)::int
    into v_total_monto, v_total_pz from _dev_cli_tmp t join operacion.pedido_linea l on l.id = t.linea_id;
  if v_total_monto > v_cobrado then raise exception 'el credito (%) pasa de lo que el pedido vale hoy (%)', v_total_monto, v_cobrado using errcode = '23514'; end if;
  v_saldo_antes := operacion.pedido_saldo(ped.id);

  v_ev := operacion.crear_evento('devolucion_cliente', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio));
  v_folio := seguridad.siguiente_folio('DV');
  select c.nombre_canonico into v_cli from catalogo.cliente c where c.id = ped.cliente_id;
  -- Encabezado provisional con ceros no permitidos: se calcula el costo en una pasada previa.
  v_total_costo := 0;
  for r in select linea_id, sku_id, sum(piezas)::int as piezas from _dev_cli_tmp group by linea_id, sku_id loop
    select sum(s.piezas)::int, sum(s.costo_valor_cent) into v_surtido, v_costo_tot from operacion.pedido_surtido s where s.pedido_linea_id = r.linea_id and s.sku_id = r.sku_id;
    v_prev_n := operacion.devuelto_linea_sku(r.linea_id, r.sku_id);
    v_total_costo := v_total_costo + negocio.redondear_medio_arriba(v_costo_tot * (v_prev_n + r.piezas), v_surtido) - negocio.redondear_medio_arriba(v_costo_tot * v_prev_n, v_surtido);
  end loop;
  v_saldo_despues := v_saldo_antes - v_total_monto; -- se ajusta abajo si hay pagos que liberar
  insert into operacion.devolucion_cliente (folio, pedido_id, cliente_id, fecha_neg, motivo, piezas, monto_cent, costo_cent, saldo_antes_cent, saldo_despues_cent, snapshot_cliente, texto_whatsapp, emitida_por, evento_id)
    values (v_folio, ped.id, ped.cliente_id, negocio.hoy(), btrim(p_motivo), v_total_pz, v_total_monto, v_total_costo, v_saldo_antes, v_saldo_despues, '{}'::jsonb, '', auth.uid(), v_ev) returning id into v_id;

  -- Renglones, movimientos del kardex (entrada al valor de salida; si viene danado, sale enseguida como merma).
  for r in select t.linea_id, t.sku_id, t.destino, sum(t.piezas)::int as piezas from _dev_cli_tmp t group by t.linea_id, t.sku_id, t.destino order by t.linea_id, t.sku_id, t.destino loop
    select sum(s.piezas)::int, sum(s.costo_valor_cent) into v_surtido, v_costo_tot from operacion.pedido_surtido s where s.pedido_linea_id = r.linea_id and s.sku_id = r.sku_id;
    v_prev_n := operacion.devuelto_linea_sku(r.linea_id, r.sku_id);
    select coalesce(sum(l.costo_valor_cent), 0) into v_prev_val from operacion.devolucion_cliente_linea l
      where l.pedido_linea_id = r.linea_id and l.sku_id = r.sku_id and not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = l.devolucion_id);
    v_valor := negocio.redondear_medio_arriba(v_costo_tot * (v_prev_n + r.piezas), v_surtido) - v_prev_val;
    select coalesce((ult.ajustes->'precios'->>(r.linea_id::text))::bigint, l.precio_cent), l.modelo_id into v_precio, v_monto from operacion.pedido_linea l where l.id = r.linea_id;
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, nota)
      values (negocio.hoy(), r.sku_id, v_monto, 'bodega_omar', 'devolucion', r.piezas, v_valor, v_ev, 'Devolucion ' || v_folio) returning id into v_mov;
    insert into operacion.devolucion_cliente_linea (devolucion_id, pedido_linea_id, sku_id, modelo_id, piezas, precio_cent, monto_cent, costo_valor_cent, destino, movimiento_id)
      values (v_id, r.linea_id, r.sku_id, v_monto, r.piezas, v_precio, r.piezas * v_precio, v_valor, r.destino, v_mov);
    if r.destino = 'merma' then
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id, nota)
        values (negocio.hoy(), r.sku_id, v_monto, 'bodega_omar', 'merma', -r.piezas, v_ev, 'Devolucion danada ' || v_folio);
    end if;
  end loop;

  -- Si el cliente ya habia pagado de mas, el excedente vuelve a ser saldo a favor: se revierte la aplicacion mas reciente y se reaplica lo que si corresponde.
  v_exceso := greatest(-operacion.pedido_saldo(ped.id), 0);
  if v_exceso > 0 then
    for ap in select x.id, x.pago_id, x.monto_cent from operacion.pago_aplicacion x where x.pedido_id = ped.id and x.reversa_de is null
               and not exists (select 1 from operacion.pago_aplicacion y where y.reversa_de = x.id) order by x.id desc loop
      exit when v_exceso <= 0;
      insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id, reversa_de) values (ap.pago_id, ped.id, -ap.monto_cent, v_ev, ap.id);
      if ap.monto_cent > v_exceso then
        insert into operacion.pago_aplicacion (pago_id, pedido_id, monto_cent, evento_id) values (ap.pago_id, ped.id, ap.monto_cent - v_exceso, v_ev);
        v_liberado := v_liberado + v_exceso; v_exceso := 0;
      else
        v_liberado := v_liberado + ap.monto_cent; v_exceso := v_exceso - ap.monto_cent;
      end if;
    end loop;
  end if;
  v_saldo_despues := operacion.pedido_saldo(ped.id);

  select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas, 'precio_cent', l.precio_cent, 'total_cent', l.monto_cent, 'destino', l.destino) order by m.nombre_canonico, sa.nombre_canonico), '[]'::jsonb)
    into v_snap_lineas from operacion.devolucion_cliente_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.devolucion_id = v_id;
  v_snap := jsonb_build_object('folio', v_folio, 'fecha', negocio.hoy(), 'cliente', v_cli, 'pedido', ped.folio, 'nota', ult.folio_documento, 'lineas', v_snap_lineas, 'piezas_total', v_total_pz,
                               'total_cent', v_total_monto, 'total_nota_cent', ult.total_cent, 'saldo_antes_cent', v_saldo_antes, 'saldo_despues_cent', v_saldo_despues, 'liberado_cent', v_liberado, 'motivo', btrim(p_motivo));
  v_texto := 'NOTA DE CREDITO ' || v_folio || E'\n' || v_cli || E'\nPedido ' || ped.folio || E'\n'
    || (select string_agg(x->>'modelo' || ' ' || (x->>'sabor') || ': ' || (x->>'piezas') || ' pz x ' || operacion.fmt_pesos((x->>'precio_cent')::bigint) || ' = ' || operacion.fmt_pesos((x->>'total_cent')::bigint), E'\n') from jsonb_array_elements(v_snap_lineas) x)
    || E'\nCredito total: ' || operacion.fmt_pesos(v_total_monto)
    || case when v_liberado > 0 then E'\nSaldo a favor liberado: ' || operacion.fmt_pesos(v_liberado) else '' end
    || E'\nSaldo del pedido: ' || operacion.fmt_pesos(v_saldo_despues);
  -- Los campos del documento se completan una sola vez (la fila se inserto con valores provisionales; T1 solo permite este cierre dentro de la misma operacion).
  perform set_config('rtm.cerrar_devolucion', v_id::text, true);
  update operacion.devolucion_cliente set snapshot_cliente = v_snap, texto_whatsapp = v_texto, liberado_cent = v_liberado, saldo_despues_cent = v_saldo_despues where id = v_id;

  perform operacion.avisar('nota_corregida_o_anulada', 'NT-008', 'devolucion_cliente:' || v_id, 'I', 'Devolucion ' || v_folio || ' de ' || ped.folio || ': credito de ' || operacion.fmt_pesos(v_total_monto), 'pedido', ped.id,
    jsonb_build_object('folio', ped.folio, 'documento', v_folio), ped.duenio_id, v_ev, true, array['software', 'telegram']);
  v_res := jsonb_build_object('devolucion_id', v_id, 'folio', v_folio, 'pedido_id', ped.id, 'piezas', v_total_pz, 'monto_cent', v_total_monto, 'costo_cent', v_total_costo,
                              'liberado_cent', v_liberado, 'saldo_antes_cent', v_saldo_antes, 'saldo_despues_cent', v_saldo_despues, 'texto', v_texto);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- T1 de la devolucion: cierra UNA vez los campos del documento (snapshot, texto, liberado y saldo despues), en la misma operacion que la crea.
drop trigger devolucion_cliente_t1 on operacion.devolucion_cliente;
create function operacion.t_devolucion_cliente_cierre() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'tabla de solo insercion: devolucion_cliente' using errcode = '42501'; end if;
  if coalesce(current_setting('rtm.cerrar_devolucion', true), '') <> old.id::text or old.snapshot_cliente <> '{}'::jsonb
     or (to_jsonb(new) - array['snapshot_cliente', 'texto_whatsapp', 'liberado_cent', 'saldo_despues_cent']) is distinct from (to_jsonb(old) - array['snapshot_cliente', 'texto_whatsapp', 'liberado_cent', 'saldo_despues_cent']) then
    raise exception 'tabla de solo insercion: la devolucion no se edita' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger devolucion_cliente_t1 before update or delete on operacion.devolucion_cliente for each row execute function operacion.t_devolucion_cliente_cierre();

-- Anular una devolucion: regresan los movimientos del kardex (contramovimientos), el credito vuelve a la cuenta por cobrar y los pagos liberados se reaplican (FIFO).
create function operacion.anular_devolucion_cliente(p_clave_idem text, p_devolucion bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; d operacion.devolucion_cliente; ped operacion.pedido; v_ev bigint; m operacion.movimiento_inventario; v_n int := 0; v_reap bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_devolucion_cliente', 'd', p_devolucion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into d from operacion.devolucion_cliente where id = p_devolucion;
  if not found then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = d.pedido_id for update;
  if exists (select 1 from operacion.devolucion_cliente_anulacion where devolucion_id = d.id) then raise exception 'la devolucion % ya esta anulada', d.folio using errcode = 'P0428'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %', ped.folio, ped.estado using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('devolucion_cliente_anulada', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'devolucion', d.folio, 'motivo', p_motivo), null, d.evento_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = d.evento_id order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  insert into operacion.devolucion_cliente_anulacion (devolucion_id, motivo, evento_id) values (d.id, btrim(p_motivo), v_ev);
  v_reap := operacion.aplicar_fifo(d.cliente_id, v_ev);
  v_res := jsonb_build_object('devolucion_id', d.id, 'folio', d.folio, 'movimientos_revertidos', v_n, 'reaplicado_cent', v_reap, 'saldo_pedido_cent', operacion.pedido_saldo(ped.id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Devolucion a un proveedor
-- ---------------------------------------------------------------------------
-- p_lineas = [{sku_id | modelo+sabor, piezas}]. Sale de Bodega Omar al costo promedio; la cuenta con el proveedor sube por ese valor.
create function operacion.devolver_a_proveedor(p_clave_idem text, p_proveedor text, p_lineas jsonb, p_motivo text, p_compra bigint default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_prov bigint; v_prov_nombre text; v_ev bigint; v_id bigint; v_folio text; r record; v_mov bigint; v_val bigint; v_total_val bigint := 0; v_total_pz int := 0;
  v_saldo_antes bigint; v_mp bigint; v_snap_lineas jsonb; v_snap jsonb; v_texto text; v_folio_compra text; v_res jsonb; v_modelo bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'devolver_a_proveedor', 'p', p_proveedor, 'l', p_lineas, 'm', p_motivo, 'c', p_compra));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la devolucion exige motivo' using errcode = '23502'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  if v_prov is null then raise exception 'proveedor desconocido: %', p_proveedor using errcode = '22023'; end if;
  select nombre into v_prov_nombre from catalogo.proveedor where id = v_prov;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'indica lo que se devuelve' using errcode = '22023'; end if;
  if p_compra is not null then
    select folio into v_folio_compra from operacion.compra where id = p_compra and proveedor_id = v_prov;
    if v_folio_compra is null then raise exception 'la compra no es de ese proveedor' using errcode = '22023'; end if;
  end if;

  create temporary table if not exists _dev_prov_tmp (sku_id bigint, piezas int) on commit drop;
  delete from _dev_prov_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _dev_prov_tmp
  select (operacion.resolver_sku(x)->>'sku_id')::bigint, (x->>'piezas')::int from jsonb_array_elements(p_lineas) x;
  if exists (select 1 from _dev_prov_tmp where piezas is null or piezas <= 0) then raise exception 'renglon de devolucion invalido' using errcode = '22023'; end if;
  for r in select sku_id, sum(piezas)::int as piezas from _dev_prov_tmp group by sku_id loop
    if operacion.disponible_sku(r.sku_id) < r.piezas then raise exception 'no hay disponible suficiente para devolver (disponible %, se piden %): lo apartado no se devuelve', operacion.disponible_sku(r.sku_id), r.piezas using errcode = 'P0423'; end if;
  end loop;

  v_saldo_antes := operacion.saldo_proveedor(v_prov);
  v_ev := operacion.crear_evento('devolucion_proveedor', negocio.hoy(), p_clave_idem, jsonb_build_object('proveedor', v_prov_nombre));
  v_folio := seguridad.siguiente_folio('DP');
  -- Encabezado con el total ya calculado: primero se mueve el kardex (valor al costo promedio) y luego se escribe el encabezado.
  create temporary table if not exists _dev_prov_mov (sku_id bigint, modelo_id bigint, piezas int, valor_cent bigint, movimiento_id bigint) on commit drop;
  delete from _dev_prov_mov where true;
  for r in select t.sku_id, sum(t.piezas)::int as piezas from _dev_prov_tmp t group by t.sku_id order by t.sku_id loop
    select modelo_id into v_modelo from catalogo.sku where id = r.sku_id;
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id, nota)
      values (negocio.hoy(), r.sku_id, v_modelo, 'bodega_omar', 'devolucion_proveedor', -r.piezas, v_ev, 'Devolucion ' || v_folio) returning id, -valor_cent into v_mov, v_val;
    insert into _dev_prov_mov values (r.sku_id, v_modelo, r.piezas, v_val, v_mov);
    v_total_val := v_total_val + v_val; v_total_pz := v_total_pz + r.piezas;
  end loop;
  if v_total_val > 0 then
    insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, compra_id, nota, evento_id)
      values (v_prov, negocio.hoy(), 'devolucion_proveedor', v_total_val, p_compra, 'Devolucion ' || v_folio || ': ' || btrim(p_motivo), v_ev) returning id into v_mp;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', x.piezas, 'valor_cent', x.valor_cent) order by m.nombre_canonico, sa.nombre_canonico), '[]'::jsonb)
    into v_snap_lineas from _dev_prov_mov x join catalogo.sku k on k.id = x.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id;
  v_snap := jsonb_build_object('folio', v_folio, 'fecha', negocio.hoy(), 'proveedor', v_prov_nombre, 'compra', v_folio_compra, 'lineas', v_snap_lineas, 'piezas_total', v_total_pz, 'valor_cent', v_total_val,
                               'saldo_antes_cent', v_saldo_antes, 'saldo_despues_cent', v_saldo_antes + v_total_val, 'motivo', btrim(p_motivo));
  v_texto := 'DEVOLUCION A PROVEEDOR ' || v_folio || E'\n' || v_prov_nombre || coalesce(E'\nOrden ' || v_folio_compra, '') || E'\n'
    || (select string_agg(x->>'modelo' || ' ' || (x->>'sabor') || ': ' || (x->>'piezas') || ' pz', E'\n') from jsonb_array_elements(v_snap_lineas) x)
    || E'\nMotivo: ' || btrim(p_motivo) || E'\nCredito a favor: ' || operacion.fmt_pesos(v_total_val);
  insert into operacion.devolucion_proveedor (folio, proveedor_id, compra_id, fecha_neg, motivo, piezas, valor_cent, saldo_antes_cent, saldo_despues_cent, snapshot, texto, movimiento_prov_id, emitida_por, evento_id)
    values (v_folio, v_prov, p_compra, negocio.hoy(), btrim(p_motivo), v_total_pz, v_total_val, v_saldo_antes, v_saldo_antes + v_total_val, v_snap, v_texto, v_mp, auth.uid(), v_ev) returning id into v_id;
  insert into operacion.devolucion_proveedor_linea (devolucion_id, sku_id, modelo_id, piezas, valor_cent, movimiento_id) select v_id, sku_id, modelo_id, piezas, valor_cent, movimiento_id from _dev_prov_mov;

  v_res := jsonb_build_object('devolucion_id', v_id, 'folio', v_folio, 'piezas', v_total_pz, 'valor_cent', v_total_val, 'saldo_antes_cent', v_saldo_antes, 'saldo_despues_cent', operacion.saldo_proveedor(v_prov), 'texto', v_texto);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function operacion.anular_devolucion_proveedor(p_clave_idem text, p_devolucion bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; d operacion.devolucion_proveedor; v_ev bigint; m operacion.movimiento_inventario; v_n int := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'anular_devolucion_proveedor', 'd', p_devolucion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'anular exige motivo' using errcode = '23502'; end if;
  select * into d from operacion.devolucion_proveedor where id = p_devolucion;
  if not found then raise exception 'devolucion desconocida' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || d.proveedor_id, 0));
  if exists (select 1 from operacion.devolucion_proveedor_anulacion where devolucion_id = d.id) then raise exception 'la devolucion % ya esta anulada', d.folio using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('devolucion_proveedor_anulada', negocio.hoy(), p_clave_idem, jsonb_build_object('devolucion', d.folio, 'motivo', p_motivo), null, d.evento_id, p_motivo);
  for m in select * from operacion.movimiento_inventario where evento_id = d.evento_id order by id desc loop
    insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev, m.id, p_motivo);
    v_n := v_n + 1;
  end loop;
  if d.movimiento_prov_id is not null then
    insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, compra_id, nota, evento_id, reversa_de)
      select m2.proveedor_id, negocio.hoy(), 'reversa', -m2.monto_cent, m2.compra_id, 'Anulacion de ' || d.folio || ': ' || p_motivo, v_ev, m2.id from operacion.cuenta_proveedor_mov m2 where m2.id = d.movimiento_prov_id;
  end if;
  insert into operacion.devolucion_proveedor_anulacion (devolucion_id, motivo, evento_id) values (d.id, btrim(p_motivo), v_ev);
  v_res := jsonb_build_object('devolucion_id', d.id, 'folio', d.folio, 'movimientos_revertidos', v_n, 'saldo_proveedor_cent', operacion.saldo_proveedor(d.proveedor_id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Documento (PDF o texto) guardado una vez. tipo = 'cliente' | 'proveedor'.
create function operacion.guardar_documento_devolucion(p_tipo text, p_devolucion bigint, p_variante text, p_sha256 text, p_contenido bytea) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  insert into operacion.devolucion_documento (tipo, devolucion_id, variante, sha256, contenido) values (p_tipo, p_devolucion, p_variante, p_sha256, p_contenido) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
