-- Dropshipping / 0400: pedidos a costo de un socio para su menudeo ("Pedidos menudeo"): lista por socio con renglones, pagado y pendiente de pago, pago del pedido y "Explicar este numero".
-- ADITIVA. Reglas del dueno (13-nov):
--  * Un pedido a costo NO resta a la valuacion ni a la aportacion neta del socio, este pagado o pendiente (el libro lo registra como venta a costo contra cuenta por cobrar y cuenta por pagar al
--    proveedor: valuacion menos deudas no cambia). SOLO resta lo que se cobra en SU cuenta (fondos de la sociedad en su poder).
--  * "Pagado" = lo aplicado al pedido (pagos del socio como cliente: directo a la cuenta del proveedor o abono a la sociedad). "Pendiente de pago" = costo menos lo pagado. Cuentan como pendientes
--    los pedidos confirmados y enviados; un borrador aun no compromete nada y se muestra sin monto pendiente.
--  * Lenguaje: "pendiente de pago", nunca "deuda".

--  * Pago del pedido a costo (decision del dueno, 13-nov): el socio debe pagar el TOTAL del costo. El pedido sigue "pendiente de pago" hasta que el socio lo MARQUE como pagado (referencia, fecha, monto,
--    metodo, evidencia opcional), o lo AVISE por Telegram, o mande su ticket o transferencia. Un pago parcial deja el saldo pendiente; solo es "pagado" cuando el total cubre el costo.
--  * POLITICA de confirmacion: (a) con evidencia adjunta (solo desde la web), o si lo registra el OTRO socio (el que recibe), basta registrar: el pago se aplica de inmediato;
--    (b) sin evidencia reportado por el propio socio dueno del pedido (Telegram o web), el pedido sigue pendiente de pago, con estado "Pago reportado", hasta que el OTRO socio lo
--    "Confirme recibido" (entonces se aplica) o lo "Rechace" con motivo (no se aplica; si ya estaba aplicado se anula). En todos los casos el otro socio puede confirmar o rechazar.
--  * La evidencia (imagen o PDF) vive en el esquema cerrado `entrega`: huella sha256 calculada en la base, metadato visible, contenido solo para socios en la web con registro de lectura; el modelo
--    de IA y Telegram nunca leen su contenido (Telegram no adjunta evidencia).

create table entrega.evidencia_pago (
  id bigint generated always as identity primary key,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'application/pdf')),
  nombre text not null check (length(nombre) between 1 and 160),
  tam_bytes int not null check (tam_bytes between 1 and 2097152),
  contenido bytea not null,
  subido_por bigint not null references catalogo.socio (id),
  creado_at timestamptz not null default now()
);
create table entrega.evidencia_lectura (
  id bigint generated always as identity primary key,
  evidencia_id bigint not null references entrega.evidencia_pago (id),
  actor uuid not null,
  en timestamptz not null default now()
);
create table operacion.ds_pago_reporte (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  reportado_por bigint not null references catalogo.socio (id),
  monto_cent bigint not null check (monto_cent > 0),
  metodo text not null check (metodo in ('transferencia', 'deposito', 'efectivo')),
  referencia text not null default '' check (length(referencia) <= 120),
  fecha_pago date not null,
  via text not null check (via in ('proveedor', 'sociedad')),
  canal text not null check (canal in ('web', 'telegram', 'importacion')),
  evidencia_id bigint references entrega.evidencia_pago (id),
  aplicado boolean not null,
  pago_id bigint references operacion.pago (id),
  nota text,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now(),
  check (aplicado = (pago_id is not null))
);
create index ds_pago_reporte_pedido_idx on operacion.ds_pago_reporte (pedido_id, id);
create table operacion.ds_pago_decision (
  reporte_id bigint primary key references operacion.ds_pago_reporte (id),
  decision text not null check (decision in ('confirmado', 'rechazado')),
  motivo text check (decision = 'confirmado' or length(btrim(coalesce(motivo, ''))) > 0),
  decidido_por bigint not null references catalogo.socio (id),
  pago_id bigint references operacion.pago (id),
  evento_id bigint not null references operacion.evento (id),
  decidido_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['entrega.evidencia_pago', 'entrega.evidencia_lectura', 'operacion.ds_pago_reporte', 'operacion.ds_pago_decision'] loop
    execute format('create trigger %I before update or delete on %s for each row execute function seguridad.t1_solo_insercion()', split_part(t, '.', 2) || '_t1', t);
    execute format('create trigger %I before truncate on %s for each statement execute function seguridad.t1_solo_insercion()', split_part(t, '.', 2) || '_t1t', t);
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
    execute format('revoke all on %s from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema entrega from public, anon, authenticated;
revoke all on all sequences in schema operacion from public, anon, authenticated;

create function operacion.ds_menudeo_filas(p_socio text, p_desde date, p_hasta date, p_proveedor text, p_estado text) returns table (
  pedido_id bigint, folio text, fecha_neg date, fecha_envio date, estado text, proveedor text, cliente_id bigint, cliente text, piezas int, costo_cent bigint, pagado_cent bigint, pendiente_cent bigint, estado_pago text, reportado_cent bigint, por_confirmar int)
language sql stable security definer set search_path = ''
as $$
  select v.pedido_id, v.folio, v.fecha_neg, v.fecha_envio, v.estado, v.proveedor, v.cliente_id, v.cliente,
         (case when v.estado = 'enviado' then v.piezas_surtidas else v.piezas_pedidas end)::int,
         v.venta_cent,
         operacion.pedido_aplicado(v.pedido_id),
         case when v.estado in ('confirmado', 'enviado') then greatest(v.venta_cent - operacion.pedido_aplicado(v.pedido_id), 0) else 0 end::bigint,
         case when v.estado = 'borrador' then 'por_confirmar'
              when v.estado = 'enviado' and v.venta_cent - operacion.pedido_aplicado(v.pedido_id) <= 0 then 'pagado'
              when exists (select 1 from operacion.ds_pago_reporte r where r.pedido_id = v.pedido_id and not r.aplicado and not exists (select 1 from operacion.ds_pago_decision d where d.reporte_id = r.id)) then 'pago_reportado'
              else 'no_pagado' end,
         coalesce((select sum(r.monto_cent) from operacion.ds_pago_reporte r where r.pedido_id = v.pedido_id and not r.aplicado and not exists (select 1 from operacion.ds_pago_decision d where d.reporte_id = r.id)), 0)::bigint,
         (select count(*) from operacion.ds_pago_reporte r where r.pedido_id = v.pedido_id and not exists (select 1 from operacion.ds_pago_decision d where d.reporte_id = r.id))::int
  from operacion.v_ds_pedido v join catalogo.socio s on s.id = v.socio_venta_id
  where v.tipo_venta = 'socio_a_costo' and s.nombre = p_socio and v.estado in ('borrador', 'confirmado', 'enviado')
    and (p_desde is null or v.fecha_neg >= p_desde) and (p_hasta is null or v.fecha_neg <= p_hasta) and (p_proveedor is null or v.proveedor = p_proveedor)
$$;

create function operacion.ds_menudeo_renglones(p_pedido bigint, p_enviado boolean) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', q.pz, 'costo_unit_cent', l.precio_cent, 'costo_cent', q.pz * l.precio_cent)
                            order by ma.nombre, m.nombre_canonico, sa.nombre_canonico), '[]'::jsonb)
  from operacion.pedido_linea l
  cross join lateral (select (case when p_enviado then l.piezas_surtidas else l.piezas_pedidas end)::bigint as pz) q
  join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
  where l.pedido_id = p_pedido and q.pz > 0
$$;

create function api.ds_menudeo(p_socio text, p_desde date default null, p_hasta date default null, p_proveedor text default null, p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_t jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if not exists (select 1 from catalogo.socio where nombre = p_socio) then raise exception 'socio desconocido' using errcode = '22023'; end if;
  if p_estado is not null and p_estado not in ('pagado', 'no_pagado', 'pago_reportado', 'por_confirmar') then raise exception 'estado de pago invalido' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('pedido_id', f.pedido_id, 'folio', f.folio, 'fecha_neg', f.fecha_neg, 'fecha_envio', f.fecha_envio, 'estado', f.estado, 'proveedor', f.proveedor,
           'cliente_id', f.cliente_id, 'cliente', f.cliente, 'piezas', f.piezas, 'costo_cent', f.costo_cent, 'pagado_cent', f.pagado_cent, 'pendiente_cent', f.pendiente_cent, 'estado_pago', f.estado_pago, 'reportado_cent', f.reportado_cent, 'por_confirmar', f.por_confirmar,
           'reportes', operacion.ds_menudeo_reportes(f.pedido_id),
           'renglones', operacion.ds_menudeo_renglones(f.pedido_id, f.estado = 'enviado')) order by f.fecha_neg desc, f.pedido_id desc), '[]'::jsonb),
         jsonb_build_object('pedidos', count(*), 'piezas', coalesce(sum(f.piezas), 0), 'costo_cent', coalesce(sum(f.costo_cent), 0), 'pagado_cent', coalesce(sum(f.pagado_cent), 0),
                            'pendiente_cent', coalesce(sum(f.pendiente_cent), 0), 'pedidos_pendientes', count(*) filter (where f.pendiente_cent > 0),
                            'reportado_cent', coalesce(sum(f.reportado_cent), 0), 'pedidos_reportados', count(*) filter (where f.estado_pago = 'pago_reportado'))
    into v_filas, v_t
    from operacion.ds_menudeo_filas(p_socio, p_desde, p_hasta, p_proveedor, p_estado) f where p_estado is null or f.estado_pago = p_estado;
  return jsonb_build_object('socio', p_socio, 'totales', v_t, 'filas', v_filas);
end $$;

-- Resumen para el Inicio: DOS renglones separados por socio. (1) Pedidos a costo: monto pendiente de pago y cuantos son (NO restan a su valuacion ni a su aportacion neta).
-- (2) Fondos de la sociedad cobrados en su cuenta, pendientes de entregar (SI restan a su aportacion neta): saldo de fondos y cuantos cobros lo forman.
create function api.ds_menudeo_pendientes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'pedidos', q.n, 'pendiente_cent', q.p,
                     'reportado_cent', q.rc, 'pedidos_reportados', q.nr, 'fondos_pendiente_cent', greatest(operacion.saldo_socio(s.id, 'fondos'), 0),
                     'fondos_cobros', (select count(*) from operacion.cuenta_socio_mov m where m.socio_id = s.id and m.aplica_a = 'fondos' and m.concepto = 'fondos_en_poder' and m.reversa_de is null
                                         and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id))) order by s.id)
                   from catalogo.socio s cross join lateral (select count(*) filter (where x.pendiente_cent > 0) as n, coalesce(sum(x.pendiente_cent), 0)::bigint as p, coalesce(sum(x.reportado_cent), 0)::bigint as rc, count(*) filter (where x.estado_pago = 'pago_reportado') as nr from operacion.ds_menudeo_filas(s.nombre, null, null, null, null) x) q), '[]'::jsonb);
end $$;

-- Detalle de los fondos de la sociedad cobrados en la cuenta del socio: cada cobro (fecha, folio del pago, cliente, pedidos a los que se aplico) y lo ya entregado, con saldo corrido.
-- Pendiente de entregar = saldo de fondos del socio. Estos fondos SI restan a su aportacion neta; los pedidos a costo no.
create function api.ds_fondos_en_poder(p_socio text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  select id into v_id from catalogo.socio where nombre = p_socio;
  if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
  return jsonb_build_object('socio', p_socio, 'pendiente_cent', greatest(operacion.saldo_socio(v_id, 'fondos'), 0),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'fecha_neg', q.fecha_neg, 'concepto', q.concepto, 'monto_cent', q.monto_cent, 'saldo_corrido_cent', q.corrido,
                                'pago', q.pago, 'cliente', q.cliente, 'pedidos', q.pedidos, 'nota', q.nota) order by q.id desc)
      from (select m.id, m.fecha_neg, m.concepto, m.monto_cent, m.nota, sum(m.monto_cent) over (order by m.id)::bigint as corrido, pg.folio as pago, c.nombre_canonico as cliente,
                   (select coalesce(jsonb_agg(pe.folio order by pe.id), '[]'::jsonb) from operacion.pago_aplicacion pa join operacion.pedido pe on pe.id = pa.pedido_id where pa.pago_id = m.pago_id and pa.monto_cent > 0) as pedidos
            from operacion.cuenta_socio_mov m left join operacion.pago pg on pg.id = m.pago_id left join catalogo.cliente c on c.id = m.cliente_id
            where m.socio_id = v_id and m.aplica_a = 'fondos') q), '[]'::jsonb));
end $$;

-- Pago de un pedido a costo (el socio paga como cliente): 'proveedor' = directo a la cuenta del proveedor con su dinero; 'sociedad' = abono a la sociedad (efectivo de la empresa).
-- No toca su aportacion: no crea reembolso ni capital. Se aplica a ESE pedido y lo quita de pendientes cuando cubre el costo.
create function operacion.ds_pagar_pedido_menudeo(p_clave_idem text, p_pedido bigint, p_via text, p_monto_cent bigint default null, p_fecha date default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; r record; v_monto bigint; v_res jsonb; v_pago jsonb; v_pago_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_pagar_pedido_menudeo', 'p', p_pedido, 'v', p_via, 'm', p_monto_cent, 'f', p_fecha, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_via not in ('proveedor', 'sociedad') then raise exception 'via de pago invalida' using errcode = '22023'; end if;
  select x.pedido_id, x.estado, x.tipo_venta, x.cliente_id, x.proveedor, x.venta_cent into r from operacion.v_ds_pedido x where x.pedido_id = p_pedido;
  if not found or r.tipo_venta is distinct from 'socio_a_costo' then raise exception 'no es un pedido a costo para un socio' using errcode = '22023'; end if;
  if r.estado <> 'enviado' then raise exception 'el pedido aun no esta enviado: no hay nada que pagar todavia' using errcode = 'P0428'; end if;
  v_monto := coalesce(p_monto_cent, greatest(operacion.pedido_saldo(p_pedido), 0));
  if v_monto <= 0 then raise exception 'el pedido ya esta pagado' using errcode = 'P0428'; end if;
  if v_monto > operacion.pedido_saldo(p_pedido) then raise exception 'el monto excede lo pendiente de pago del pedido' using errcode = '23514'; end if;
  if p_via = 'proveedor' then
    v_pago := operacion.ds_pagar_proveedor(p_clave_idem || ':pp', r.proveedor, v_monto, 'cliente_a_proveedor', null, r.cliente_id, p_pedido, p_fecha, p_nota);
  else
    v_pago := operacion.registrar_pago(p_clave_idem || ':ps', 'Efectivo', v_monto, r.cliente_id, jsonb_build_array(jsonb_build_object('pedido_id', p_pedido, 'monto_cent', v_monto)), true, 'abono', p_fecha, null, p_nota);
  end if;
  v_pago_id := case when p_via = 'proveedor' then (select m.pago_id from operacion.cuenta_proveedor_mov m where m.id = (v_pago->>'movimiento_id')::bigint) else (v_pago->>'pago_id')::bigint end;
  v_res := jsonb_build_object('pedido_id', p_pedido, 'pago_id', v_pago_id, 'pagado_cent', v_monto, 'via', p_via, 'pendiente_cent', greatest(operacion.pedido_saldo(p_pedido), 0));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- "Explicar este numero": dsm:<socio>:<pendiente|pagado|costo|piezas>:<desde|->:<hasta|->. Via 1 = suma por pedido; via 2 = suma por renglon (costo y piezas) o costo menos pagado (pendiente y pagado).
create function api.ds_explicar_menudeo(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p text[] := string_to_array(p_cifra, ':'); v_d date; v_h date; v1 bigint; v2 bigint; v_rengs jsonb; v_tit text; v_unidad text := 'mxn';
begin
  perform seguridad.exigir_rol(array['socio']);
  if array_length(p, 1) <> 5 or p[1] <> 'dsm' or p[3] not in ('pendiente', 'pagado', 'costo', 'piezas', 'fondos', 'reportado') or p[2] not in (select nombre from catalogo.socio) then raise exception 'cifra desconocida' using errcode = '22023'; end if;
  if p[3] = 'reportado' then
    -- Pagos reportados sin aplicar y sin decidir. Via 1 = suma por pedido; via 2 = suma directa de los reportes de ese socio.
    select coalesce(sum(x.reportado_cent), 0)::bigint into v1 from operacion.ds_menudeo_filas(p[2], nullif(p[4], '-')::date, nullif(p[5], '-')::date, null, null) x;
    select coalesce(sum(r.monto_cent), 0)::bigint into v2 from operacion.ds_pago_reporte r join operacion.pedido_ds d on d.pedido_id = r.pedido_id join catalogo.socio s on s.id = d.socio_id
      join operacion.pedido pe on pe.id = r.pedido_id where s.nombre = p[2] and not r.aplicado and not exists (select 1 from operacion.ds_pago_decision dd where dd.reporte_id = r.id)
        and (nullif(p[4], '-')::date is null or pe.fecha_neg >= nullif(p[4], '-')::date) and (nullif(p[5], '-')::date is null or pe.fecha_neg <= nullif(p[5], '-')::date) and pe.estado in ('borrador', 'confirmado', 'enviado');
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Pagos reportados por confirmar (' || p[2] || ')', 'valor', v1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma por pedido', 'via1_valor', v1, 'via2', 'Suma de los reportes sin aplicar ni decidir', 'via2_valor', v2, 'cuadra', v1 = v2), 'renglones', '[]'::jsonb, 'movimientos', '[]'::jsonb);
  end if;
  if p[3] = 'fondos' then
    -- Fondos de la sociedad cobrados en la cuenta del socio, pendientes de entregar. Via 1 = saldo de su cuenta; via 2 = cobros menos entregas, sumados movimiento por movimiento.
    select greatest(operacion.saldo_socio(s.id, 'fondos'), 0)::bigint, coalesce((select sum(m.monto_cent) from operacion.cuenta_socio_mov m where m.socio_id = s.id and m.aplica_a = 'fondos'), 0)::bigint
      into v1, v2 from catalogo.socio s where s.nombre = p[2];
    select coalesce(jsonb_agg(jsonb_build_object('concepto', m.concepto || coalesce(' · ' || pg.folio, '') || coalesce(' · ' || c.nombre_canonico, ''), 'monto_cent', m.monto_cent, 'fecha_neg', m.fecha_neg) order by m.id desc), '[]'::jsonb) into v_rengs
      from operacion.cuenta_socio_mov m join catalogo.socio s on s.id = m.socio_id left join operacion.pago pg on pg.id = m.pago_id left join catalogo.cliente c on c.id = m.cliente_id where s.nombre = p[2] and m.aplica_a = 'fondos';
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Fondos de la sociedad pendientes de entregar (' || p[2] || ')', 'valor', v1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Saldo de fondos de la cuenta del socio', 'via1_valor', v1, 'via2', 'Cobros menos entregas, movimiento por movimiento', 'via2_valor', v2, 'cuadra', v1 = greatest(v2, 0)),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  v_d := nullif(p[4], '-')::date; v_h := nullif(p[5], '-')::date;
  select coalesce(sum(case p[3] when 'pendiente' then x.pendiente_cent when 'pagado' then x.pagado_cent when 'costo' then x.costo_cent else x.piezas end), 0)::bigint into v1 from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x;
  select coalesce(sum(case p[3] when 'costo' then (case when x.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end) * l.precio_cent when 'piezas' then (case when x.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end)
                              else 0 end), 0)::bigint into v2
    from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x join operacion.pedido_linea l on l.pedido_id = x.pedido_id;
  if p[3] in ('pendiente', 'pagado') then
    select coalesce(sum(case p[3] when 'pendiente' then (case when x.estado in ('confirmado', 'enviado') then greatest(x.costo_cent - coalesce((select sum(pa.monto_cent) from operacion.pago_aplicacion pa where pa.pedido_id = x.pedido_id), 0), 0) else 0 end)
                                 else coalesce((select sum(pa.monto_cent) from operacion.pago_aplicacion pa where pa.pedido_id = x.pedido_id), 0) end), 0)::bigint into v2
      from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x;
  end if;
  if p[3] = 'piezas' then v_unidad := 'pz'; end if;
  v_tit := case p[3] when 'pendiente' then 'Pendiente de pago de pedidos a costo' when 'pagado' then 'Pagado de pedidos a costo' when 'costo' then 'Costo de pedidos a costo' else 'Piezas de pedidos a costo' end || ' (' || p[2] || ')';
  select coalesce(jsonb_agg(jsonb_build_object('concepto', x.folio || ' · ' || coalesce(x.proveedor, ''), 'fecha_neg', x.fecha_neg,
      'monto_cent', case p[3] when 'pendiente' then x.pendiente_cent when 'pagado' then x.pagado_cent else x.costo_cent end) order by x.pedido_id desc), '[]'::jsonb) into v_rengs
    from operacion.ds_menudeo_filas(p[2], v_d, v_h, null, null) x;
  if p[3] = 'piezas' then v_rengs := '[]'::jsonb; end if;
  return jsonb_build_object('cifra', p_cifra, 'titulo', v_tit, 'valor', v1, 'unidad', v_unidad,
    'comprobacion', jsonb_build_object('via1', 'Suma por pedido', 'via1_valor', v1, 'via2', case when p[3] in ('pendiente', 'pagado') then 'Costo menos pagos aplicados, por pedido' else 'Suma por renglon' end, 'via2_valor', v2, 'cuadra', v1 = v2),
    'renglones', v_rengs, 'movimientos', '[]'::jsonb);
end $$;


-- Reportes de pago de un pedido (para la pantalla): con metadato de evidencia, nunca su contenido.
create function operacion.ds_menudeo_reportes(p_pedido bigint) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'fecha_pago', r.fecha_pago, 'monto_cent', r.monto_cent, 'metodo', r.metodo, 'referencia', r.referencia, 'via', r.via, 'canal', r.canal,
           'reportado_por', (select s.nombre from catalogo.socio s where s.id = r.reportado_por), 'aplicado', r.aplicado or d.pago_id is not null,
           'estado', case when d.decision is null then 'por_confirmar' else d.decision end, 'motivo', d.motivo, 'decidido_por', (select s2.nombre from catalogo.socio s2 where s2.id = d.decidido_por),
           'evidencia', case when e.id is null then null else jsonb_build_object('sha256', e.sha256, 'mime', e.mime, 'nombre', e.nombre, 'tam_bytes', e.tam_bytes) end) order by r.id), '[]'::jsonb)
  from operacion.ds_pago_reporte r left join operacion.ds_pago_decision d on d.reporte_id = r.id left join entrega.evidencia_pago e on e.id = r.evidencia_id
  where r.pedido_id = p_pedido
$$;

-- Reportar / marcar como pagado un pedido a costo (web) o avisar el pago (Telegram). Idempotente. Telegram solo reporta: nunca adjunta evidencia.
-- Contrato de la intencion `pago_pedido_menudeo` en docs/dropshipping-telegram-contrato.md. Llamable por agente.ejecutar_ext cuando se integre (canal telegram, p_socio = quien avisa).
create function operacion.ds_reportar_pago_menudeo(p_clave_idem text, p_pedido bigint default null, p_folio text default null, p_monto_cent bigint default null, p_metodo text default 'transferencia',
                                                   p_referencia text default '', p_fecha date default null, p_via text default 'proveedor', p_evidencia_b64 text default null,
                                                   p_evidencia_mime text default null, p_evidencia_nombre text default null, p_socio text default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_canal text := seguridad.canal_actual(); v_ped bigint; r record; v_rep bigint; v_bytes bytea; v_evid bigint; v_sha text; v_inmediato boolean; v_pago jsonb; v_pago_id bigint;
  v_ev bigint; v_id bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_pend bigint; v_res jsonb; v_resumen text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_reportar_pago_menudeo', 'p', p_pedido, 'fo', p_folio, 'm', p_monto_cent, 'me', p_metodo, 'r', p_referencia, 'f', p_fecha, 'v', p_via,
                                         'h', case when p_evidencia_b64 is null then null else encode(sha256(convert_to(p_evidencia_b64, 'UTF8')), 'hex') end, 's', p_socio, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_metodo not in ('transferencia', 'deposito', 'efectivo') then raise exception 'metodo de pago invalido' using errcode = '22023'; end if;
  if p_via not in ('proveedor', 'sociedad') then raise exception 'via de pago invalida' using errcode = '22023'; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el monto debe ser positivo' using errcode = '23514'; end if;
  if length(coalesce(p_referencia, '')) > 120 then raise exception 'la referencia es demasiado larga' using errcode = '23514'; end if;
  if v_fecha > negocio.hoy() + 1 then raise exception 'la fecha del pago no puede ser futura' using errcode = '23514'; end if;
  v_ped := coalesce(p_pedido, (select id from operacion.pedido where folio = p_folio));
  select x.pedido_id, x.estado, x.tipo_venta, x.socio_venta_id, x.venta_cent, x.folio into r from operacion.v_ds_pedido x where x.pedido_id = v_ped;
  if not found or r.tipo_venta is distinct from 'socio_a_costo' then raise exception 'no es un pedido a costo para un socio' using errcode = '22023'; end if;
  if r.estado <> 'enviado' then raise exception 'el pedido aun no esta enviado: no hay nada que pagar todavia' using errcode = 'P0428'; end if;
  v_rep := coalesce(operacion.actor_socio(), (select id from catalogo.socio where nombre = p_socio));
  if v_rep is null then raise exception 'indica que socio reporta el pago' using errcode = '23502'; end if;
  if p_evidencia_b64 is not null and v_canal <> 'web' then raise exception 'la evidencia solo se adjunta desde la web: el bot no lee ni recibe tickets' using errcode = '22023'; end if;
  v_pend := greatest(operacion.pedido_saldo(v_ped), 0) - coalesce((select sum(q.monto_cent) from operacion.ds_pago_reporte q where q.pedido_id = v_ped and not q.aplicado and not exists (select 1 from operacion.ds_pago_decision d where d.reporte_id = q.id)), 0);
  if p_monto_cent > v_pend then raise exception 'el monto excede lo pendiente de pago (descontando pagos ya reportados por confirmar)' using errcode = '23514'; end if;
  if p_evidencia_b64 is not null then
    v_bytes := decode(p_evidencia_b64, 'base64');
    if length(v_bytes) < 1 or length(v_bytes) > 2097152 then raise exception 'la evidencia debe pesar entre 1 byte y 2 MB' using errcode = '23514'; end if;
    if p_evidencia_mime not in ('image/png', 'image/jpeg', 'application/pdf') then raise exception 'la evidencia debe ser imagen PNG o JPEG, o PDF' using errcode = '22023'; end if;
    if not ((p_evidencia_mime = 'image/png' and substring(v_bytes from 1 for 4) = '\x89504e47'::bytea) or (p_evidencia_mime = 'image/jpeg' and substring(v_bytes from 1 for 3) = '\xffd8ff'::bytea)
            or (p_evidencia_mime = 'application/pdf' and substring(v_bytes from 1 for 4) = '\x25504446'::bytea)) then raise exception 'el archivo no corresponde a su tipo' using errcode = '22023'; end if;
    v_sha := encode(sha256(v_bytes), 'hex');
    insert into entrega.evidencia_pago (sha256, mime, nombre, tam_bytes, contenido, subido_por) values (v_sha, p_evidencia_mime, coalesce(nullif(btrim(p_evidencia_nombre), ''), 'evidencia'), length(v_bytes), v_bytes, v_rep) returning id into v_evid;
  end if;
  -- Politica: con evidencia, o si lo registra el OTRO socio (el que recibe), se aplica de inmediato; si no, queda "Pago reportado" hasta que el otro socio confirme.
  v_inmediato := v_evid is not null or v_rep <> r.socio_venta_id;
  v_ev := operacion.crear_evento('ds_pago_reportado', v_fecha, p_clave_idem || ':ev', jsonb_build_object('pedido', r.folio, 'monto_cent', p_monto_cent, 'metodo', p_metodo, 'con_evidencia', v_evid is not null, 'canal', v_canal, 'aplicado', v_inmediato));
  if v_inmediato then
    v_pago := operacion.ds_pagar_pedido_menudeo(p_clave_idem || ':pg', v_ped, p_via, p_monto_cent, v_fecha, p_nota);
    v_pago_id := (v_pago->>'pago_id')::bigint;
  end if;
  insert into operacion.ds_pago_reporte (pedido_id, reportado_por, monto_cent, metodo, referencia, fecha_pago, via, canal, evidencia_id, aplicado, pago_id, nota, evento_id)
    values (v_ped, v_rep, p_monto_cent, p_metodo, coalesce(btrim(p_referencia), ''), v_fecha, p_via, v_canal, v_evid, v_inmediato, v_pago_id, p_nota, v_ev) returning id into v_id;
  v_res := jsonb_build_object('reporte_id', v_id, 'pedido_id', v_ped, 'aplicado', v_inmediato, 'requiere_confirmacion_del_otro_socio', not v_inmediato, 'con_evidencia', v_evid is not null,
                              'evidencia_sha256', v_sha, 'pendiente_cent', greatest(operacion.pedido_saldo(v_ped), 0),
                              'estado', case when not v_inmediato then 'pago_reportado' when operacion.pedido_saldo(v_ped) <= 0 then 'pagado' else 'no_pagado' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- El OTRO socio confirma recibido o rechaza con motivo. Confirmar un reporte sin aplicar lo aplica; rechazar uno ya aplicado lo anula (el pedido vuelve a pendiente de pago).
create function operacion.ds_decidir_pago_menudeo(p_clave_idem text, p_reporte bigint, p_decision text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; rp operacion.ds_pago_reporte; v_dec bigint := operacion.actor_socio(); v_ev bigint; v_pago jsonb; v_pago_id bigint; v_res jsonb; r record;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_decidir_pago_menudeo', 'r', p_reporte, 'd', p_decision, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if p_decision not in ('confirmado', 'rechazado') then raise exception 'decision invalida' using errcode = '22023'; end if;
  select * into rp from operacion.ds_pago_reporte where id = p_reporte for update;
  if not found then raise exception 'reporte de pago desconocido' using errcode = '22023'; end if;
  if v_dec is null or v_dec = rp.reportado_por then raise exception 'lo confirma o rechaza el OTRO socio' using errcode = '42501'; end if;
  if exists (select 1 from operacion.ds_pago_decision where reporte_id = rp.id) then raise exception 'ese reporte ya se resolvio' using errcode = 'P0428'; end if;
  if p_decision = 'rechazado' and nullif(btrim(p_motivo), '') is null then raise exception 'rechazar exige un motivo' using errcode = '23502'; end if;
  select x.folio, x.estado into r from operacion.v_ds_pedido x where x.pedido_id = rp.pedido_id;
  v_ev := operacion.crear_evento('ds_pago_decidido', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', r.folio, 'reporte', rp.id, 'decision', p_decision));
  if p_decision = 'confirmado' and not rp.aplicado then
    v_pago := operacion.ds_pagar_pedido_menudeo(p_clave_idem || ':pg', rp.pedido_id, rp.via, rp.monto_cent, rp.fecha_pago, rp.nota);
    v_pago_id := (v_pago->>'pago_id')::bigint;
  elsif p_decision = 'rechazado' and rp.aplicado then
    perform operacion.anular_pago(p_clave_idem || ':an', rp.pago_id, 'Pago rechazado por el otro socio: ' || btrim(p_motivo));
  end if;
  insert into operacion.ds_pago_decision (reporte_id, decision, motivo, decidido_por, pago_id, evento_id) values (rp.id, p_decision, nullif(btrim(p_motivo), ''), v_dec, v_pago_id, v_ev);
  v_res := jsonb_build_object('reporte_id', rp.id, 'decision', p_decision, 'pendiente_cent', greatest(operacion.pedido_saldo(rp.pedido_id), 0),
                              'estado', case when p_decision = 'rechazado' then 'no_pagado' when operacion.pedido_saldo(rp.pedido_id) <= 0 then 'pagado' else 'no_pagado' end);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Evidencia: contenido solo para socios en la web, con registro de cada lectura.
create function api.ds_evidencia(p_reporte bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare e entrega.evidencia_pago;
begin
  perform seguridad.exigir_rol(array['socio']);
  select ev.* into e from operacion.ds_pago_reporte r join entrega.evidencia_pago ev on ev.id = r.evidencia_id where r.id = p_reporte;
  if not found then return null; end if;
  insert into entrega.evidencia_lectura (evidencia_id, actor) values (e.id, auth.uid());
  return jsonb_build_object('mime', e.mime, 'nombre', e.nombre, 'sha256', e.sha256, 'tam_bytes', e.tam_bytes, 'b64', encode(e.contenido, 'base64'));
end $$;

create function api.ds_reportar_pago_menudeo(p_clave_idem text, p_pedido bigint default null, p_folio text default null, p_monto_cent bigint default null, p_metodo text default 'transferencia',
                                             p_referencia text default '', p_fecha date default null, p_via text default 'proveedor', p_evidencia_b64 text default null,
                                             p_evidencia_mime text default null, p_evidencia_nombre text default null, p_socio text default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_reportar_pago_menudeo(p_clave_idem, p_pedido, p_folio, p_monto_cent, p_metodo, p_referencia, p_fecha, p_via, p_evidencia_b64, p_evidencia_mime, p_evidencia_nombre, p_socio, p_nota); end $$;
create function api.ds_decidir_pago_menudeo(p_clave_idem text, p_reporte bigint, p_decision text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_decidir_pago_menudeo(p_clave_idem, p_reporte, p_decision, p_motivo); end $$;

-- Escritura: envoltorio api.* (rol socio)
create function api.ds_pagar_pedido_menudeo(p_clave_idem text, p_pedido bigint, p_via text, p_monto_cent bigint default null, p_fecha date default null, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_pagar_pedido_menudeo(p_clave_idem => p_clave_idem, p_pedido => p_pedido, p_via => p_via, p_monto_cent => p_monto_cent, p_fecha => p_fecha, p_nota => p_nota); end $$;

revoke execute on function operacion.ds_menudeo_filas(text, date, date, text, text), operacion.ds_menudeo_renglones(bigint, boolean), operacion.ds_menudeo_reportes(bigint),
  operacion.ds_reportar_pago_menudeo(text, bigint, text, bigint, text, text, date, text, text, text, text, text, text), operacion.ds_decidir_pago_menudeo(text, bigint, text, text), operacion.ds_pagar_pedido_menudeo(text, bigint, text, bigint, date, text) from public, anon, authenticated;
revoke execute on function api.ds_menudeo(text, date, date, text, text), api.ds_menudeo_pendientes(), api.ds_fondos_en_poder(text), api.ds_explicar_menudeo(text), api.ds_pagar_pedido_menudeo(text, bigint, text, bigint, date, text),
  api.ds_evidencia(bigint), api.ds_reportar_pago_menudeo(text, bigint, text, bigint, text, text, date, text, text, text, text, text, text), api.ds_decidir_pago_menudeo(text, bigint, text, text) from public, anon;
-- GRANT a authenticated (cada una exige rol socio dentro):
grant execute on function api.ds_menudeo(text, date, date, text, text), api.ds_menudeo_pendientes(), api.ds_fondos_en_poder(text), api.ds_explicar_menudeo(text), api.ds_pagar_pedido_menudeo(text, bigint, text, bigint, date, text),
  api.ds_evidencia(bigint), api.ds_reportar_pago_menudeo(text, bigint, text, bigint, text, text, date, text, text, text, text, text, text), api.ds_decidir_pago_menudeo(text, bigint, text, text) to authenticated;
