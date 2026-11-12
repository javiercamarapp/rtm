-- Integracion 4 / 0028: reportes (esquema `rep`).
--  * Reportes publicados: solo insercion, clave `tipo:AAAA-MM-DD` y version; PDF y HTML se guardan por sha256 en `rep.blob` (almacenamiento privado dentro de la propia base; no hay servicio de archivos).
--  * `rep.insumos_semanal` y `rep.insumos_mensual` entregan, en jsonb, lo que el motor de reportes necesita (forma de src/dominio/reportes/insumos.ts, claves en snake_case y centavos `*_cent`).
--    Lo que la base todavia no puede derivar (flujo de caja con cobros prometidos, liquidacion con la hoja del proveedor, conteo ciego, comparativo de cuenta entre socios) NO se inventa:
--    se omite y el reporte lo muestra como "sin datos"; los vacios reales de captura (guias sin costear, conteo semanal sin hacer) van en `datos_incompletos` y el reporte sale PARCIAL.
--  * El estado DEFINITIVO / PRELIMINAR / PARCIAL lo decide el motor con `aprobado_en` (contabilidad.periodo), `en_curso`, `datos_incompletos` y las comprobaciones C1..C22.
--  * El correo al grupo de socios y el aviso de Telegram usan `operacion.avisar` (tipos reporte_semanal, reporte_mensual, reporte_no_salio); el PDF va solo por enlace autenticado.

create schema rep;
revoke all on schema rep from public, anon, authenticated;
grant usage on schema rep to servidor;

insert into catalogo.config (clave, valor, vigente_desde) values
  ('reporte_piezas_por_caja', '1', '2026-11-10'),
  ('plazo_proveedor_dias', '{"Isaac": 7, "Karen": 10}', '2026-11-10'),
  ('reporte_tope_plataforma_cent', '300000', '2026-11-10')
  on conflict do nothing;

create table rep.reporte (
  id bigint generated always as identity primary key,
  clave text not null check (clave ~ '^(semanal|mensual):\d{4}-\d{2}-\d{2}$'),
  version int not null check (version > 0),
  folio text not null,
  huella char(6) not null,
  estado text not null check (estado in ('publicado', 'borrador')),
  etiquetas text[] not null default '{}',
  sha256_pdf text check (sha256_pdf is null or sha256_pdf ~ '^[0-9a-f]{64}$'),
  html_sha256 text not null check (html_sha256 ~ '^[0-9a-f]{64}$'),
  paquete jsonb,
  clave_idem text not null unique,
  creado_at timestamptz not null default clock_timestamp(),
  unique (clave, version),
  check ((estado = 'publicado') = (sha256_pdf is not null))
);
create table rep.blob (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$'),
  tipo text not null check (tipo in ('pdf', 'html')),
  bytes bytea not null
);
create table rep.entrega (
  id bigint generated always as identity primary key,
  reporte_id bigint not null references rep.reporte (id),
  canal text not null check (canal in ('telegram', 'correo')),
  enviado_at timestamptz not null default clock_timestamp(),
  clave_idem text not null,
  unique (reporte_id, canal)
);
create table rep.config (
  clave text not null,
  valor jsonb not null,
  vigente_desde date not null,
  primary key (clave, vigente_desde)
);
insert into rep.config (clave, valor, vigente_desde) values
  ('alfa_ema', '0.3', '2026-11-10'), ('ventana_ema', '8', '2026-11-10'), ('z80', '1.28', '2026-11-10'),
  ('bloqueantes', '["C3","C4","C5","C10","C11","C12"]', '2026-11-10'), ('renta_bodega_cent_por_pz', '200', '2026-11-10');

do $$
declare t text;
begin
  foreach t in array array['reporte', 'blob', 'entrega'] loop
    execute format('create trigger %I before update or delete on rep.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on rep.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on rep.%I from postgres', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rep' and c.relkind = 'r' loop
    execute format('alter table rep.%I enable row level security', t);
    execute format('alter table rep.%I force row level security', t);
    execute format('revoke all on rep.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema rep from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Publicacion y entrega. Un reporte publicado no se regenera: se reemite como version nueva.
-- ---------------------------------------------------------------------------
create function rep.versiones(p_clave text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('clave', r.clave, 'version', r.version, 'folio', r.folio, 'huella', r.huella, 'estado', r.estado, 'etiquetas', to_jsonb(r.etiquetas), 'sha256Pdf', r.sha256_pdf,
      'entregas', jsonb_build_object('telegram', exists (select 1 from rep.entrega e where e.reporte_id = r.id and e.canal = 'telegram'), 'correo', exists (select 1 from rep.entrega e where e.reporte_id = r.id and e.canal = 'correo')),
      'creado_at', r.creado_at) order by r.version) from rep.reporte r where r.clave = p_clave), '[]'::jsonb);
end $$;

create function rep.guardar(p_reporte jsonb, p_pdf bytea, p_html text, p_paquete jsonb, p_clave_idem text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_html_sha text := encode(sha256(convert_to(p_html, 'UTF8')), 'hex'); v_pdf_sha text; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_socio_o_sistema();
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'rep.guardar', 'c', p_reporte ->> 'clave', 'v', (p_reporte ->> 'version')::int, 'h', p_reporte ->> 'huella'));
  if v_prev is not null then return v_prev; end if;
  if p_pdf is not null then
    v_pdf_sha := encode(sha256(p_pdf), 'hex');
    if v_pdf_sha is distinct from (p_reporte ->> 'sha256Pdf') then raise exception 'el sha256 del PDF no coincide con el declarado' using errcode = 'P0471'; end if;
    insert into rep.blob (sha256, tipo, bytes) values (v_pdf_sha, 'pdf', p_pdf) on conflict do nothing;
  end if;
  insert into rep.blob (sha256, tipo, bytes) values (v_html_sha, 'html', convert_to(p_html, 'UTF8')) on conflict do nothing;
  insert into rep.reporte (clave, version, folio, huella, estado, etiquetas, sha256_pdf, html_sha256, paquete, clave_idem)
    values (p_reporte ->> 'clave', (p_reporte ->> 'version')::int, p_reporte ->> 'folio', p_reporte ->> 'huella', p_reporte ->> 'estado', proveedores.arr(p_reporte -> 'etiquetas'), v_pdf_sha, v_html_sha, p_paquete, p_clave_idem)
    returning id into v_id;
  v_res := jsonb_build_object('reporte_id', v_id, 'clave', p_reporte ->> 'clave', 'version', (p_reporte ->> 'version')::int);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function rep.marcar_entrega(p_clave text, p_version int, p_canal text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_socio_o_sistema();
  select id into v_id from rep.reporte where clave = p_clave and version = p_version;
  if v_id is null then raise exception 'no existe % v%', p_clave, p_version using errcode = '22023'; end if;
  insert into rep.entrega (reporte_id, canal, clave_idem) values (v_id, p_canal, p_clave || ':' || p_version || ':' || p_canal) on conflict (reporte_id, canal) do nothing;
end $$;

create function rep.pdf(p_clave text, p_version int) returns bytea
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return (select b.bytes from rep.reporte r join rep.blob b on b.sha256 = r.sha256_pdf where r.clave = p_clave and r.version = p_version);
end $$;

create function rep.html(p_clave text, p_version int) returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return (select convert_from(b.bytes, 'UTF8') from rep.reporte r join rep.blob b on b.sha256 = r.html_sha256 where r.clave = p_clave and r.version = p_version);
end $$;

create function rep.historial() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('clave', r.clave, 'version', r.version, 'folio', r.folio, 'huella', r.huella, 'estado', r.estado, 'etiquetas', to_jsonb(r.etiquetas),
      'tiene_pdf', r.sha256_pdf is not null, 'creado_at', r.creado_at, 'ultima', r.version = (select max(x.version) from rep.reporte x where x.clave = r.clave),
      'entrega_telegram', exists (select 1 from rep.entrega e where e.reporte_id = r.id and e.canal = 'telegram'), 'entrega_correo', exists (select 1 from rep.entrega e where e.reporte_id = r.id and e.canal = 'correo'))
    order by r.creado_at desc, r.id desc) from rep.reporte r), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Insumos. Aislados en funciones pequenas para poder probar cada una con cifras a mano.
-- ---------------------------------------------------------------------------
-- Gastos de guia y de mensajeria atribuidos a un pedido (sin los anulados).
create function rep.gasto_pedido(p_pedido bigint, p_categorias text[]) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(g.monto_cent), 0)::bigint from operacion.gasto g left join operacion.guia gu on gu.id = g.guia_id
   where g.categoria = any (p_categorias) and coalesce(g.pedido_id, gu.pedido_id) = p_pedido and not exists (select 1 from operacion.gasto_anulacion an where an.gasto_id = g.id)
$$;

-- Costo por pieza de una linea: lo que realmente salio al costo promedio del momento.
create function rep.costo_linea(p_linea bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce((select negocio.redondear_medio_arriba(sum(s.costo_valor_cent)::bigint, sum(s.piezas)::bigint) from operacion.pedido_surtido s where s.pedido_linea_id = l.id having sum(s.piezas) > 0), l.costo_unit_cent, 0)
    from operacion.pedido_linea l where l.id = p_linea
$$;

create function rep.pedidos(p_ini date, p_fin date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j order by x.fecha, x.folio), '[]'::jsonb) from (
    select p.fecha_envio as fecha, p.folio, jsonb_build_object(
      'folio', p.folio, 'fecha', p.fecha_envio, 'cliente_id', p.cliente_id::text, 'cliente', c.nombre_canonico,
      'origen', case when operacion.origen_es_bodega(p.origen) then 'bodega' else 'directo' end,
      'lineas', coalesce((select jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sb.nombre_canonico, 'piezas', l.piezas_surtidas, 'precio_cent', l.precio_cent, 'costo_cent', rep.costo_linea(l.id),
          'precio_tabulador_cent', l.precio_tabulador_cent,
          'con_excepcion', exists (select 1 from operacion.pedido_aviso a join operacion.pedido_aviso_decision d on d.aviso_id = a.id where a.pedido_linea_id = l.id and a.codigo = 'precio_distinto_tabulador')) order by l.id)
          from operacion.pedido_linea l join catalogo.modelo m on m.id = l.modelo_id join catalogo.sku k on k.id = l.sku_id join catalogo.sabor sb on sb.id = k.sabor_id where l.pedido_id = p.id and l.piezas_surtidas > 0), '[]'::jsonb),
      'cobrado_cent', operacion.pedido_cobrado(p.id), 'guia_cent', rep.gasto_pedido(p.id, array['guia_envio']), 'mensajero_cent', rep.gasto_pedido(p.id, array['uber', 'mensajeria']),
      'avisos', coalesce((select jsonb_agg(a.codigo order by a.id) from operacion.pedido_aviso a where a.pedido_id = p.id), '[]'::jsonb),
      'control', jsonb_build_object('salieron', coalesce((select sum(s.piezas) from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id where l.pedido_id = p.id), 0),
          'cobradas', coalesce((select sum(l.piezas_surtidas) from operacion.pedido_linea l where l.pedido_id = p.id), 0) - coalesce((select sum(j.piezas) from operacion.pedido_ajuste j where j.pedido_id = p.id and j.tipo = 'cortesia'), 0),
          'autorizadas', coalesce((select sum(j.piezas) from operacion.pedido_ajuste j where j.pedido_id = p.id and j.tipo = 'cortesia'), 0))) as j
    from operacion.pedido p join catalogo.cliente c on c.id = p.cliente_id
   where p.estado = 'enviado' and p.fecha_envio between p_ini and p_fin) x
$$;

-- Resumen de un periodo: ventas por lineas, costo, piezas, gastos de guia y mensajeria y renta de bodega.
create function rep.resumen_periodo(p_ini date, p_fin date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'ventas_cent', coalesce(sum(l.precio_cent * l.piezas_surtidas), 0)::bigint,
    'piezas', coalesce(sum(l.piezas_surtidas), 0)::bigint,
    'costo_cent', coalesce(sum(rep.costo_linea(l.id) * l.piezas_surtidas), 0)::bigint,
    'gastos_cent', coalesce((select sum(rep.gasto_pedido(p2.id, array['guia_envio', 'uber', 'mensajeria'])) from operacion.pedido p2 where p2.estado = 'enviado' and p2.fecha_envio between p_ini and p_fin), 0)::bigint,
    'renta_cent', coalesce((select sum(rd.monto_cent) from operacion.renta_devengo rd where rd.devengada_fecha between p_ini and p_fin), 0)::bigint)
  from operacion.pedido p join operacion.pedido_linea l on l.pedido_id = p.id where p.estado = 'enviado' and p.fecha_envio between p_ini and p_fin
$$;

create function rep._base(p_ini date, p_fin date, p_ini_ant date, p_fin_ant date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy(); v_aprob timestamptz; v_incompletos jsonb := '[]'::jsonb; v_hist jsonb; v_clientes jsonb; v_inv jsonb; v_cartera jsonb; v_gastos jsonb; v_comp jsonb; v_tope bigint; v_gasto_ia bigint;
  v_cajas int := coalesce(catalogo.config_num('reporte_piezas_por_caja'), 1)::int;
  v_semana_ini date := p_fin - 6;
begin
  select aprobado_at into v_aprob from contabilidad.periodo where ini = p_ini and fin = p_fin and aprobado_at is not null limit 1;
  if exists (select 1 from operacion.pedido p where p.estado = 'enviado' and p.fecha_envio between p_ini and p_fin and operacion.origen_es_bodega(p.origen)
               and not exists (select 1 from operacion.gasto g left join operacion.guia gu on gu.id = g.guia_id where g.categoria = 'guia_envio' and coalesce(g.pedido_id, gu.pedido_id) = p.id)) then
    v_incompletos := v_incompletos || '["guias_sin_costear"]'::jsonb;
  end if;
  if not exists (select 1 from operacion.conteo c where c.tipo = 'semanal' and c.estado = 'cerrado' and (c.contado_at at time zone 'UTC' - interval '6 hours')::date between p_ini and p_fin) then
    v_incompletos := v_incompletos || '["conteo_semanal_sin_hacer"]'::jsonb;
  end if;
  -- Doce semanas anteriores, de la mas antigua a la mas reciente.
  select coalesce(jsonb_agg(jsonb_build_object('inicio', w.ini, 'ventas_cent', (r ->> 'ventas_cent')::bigint, 'piezas', (r ->> 'piezas')::bigint,
      'contrib_cent', (r ->> 'ventas_cent')::bigint - (r ->> 'costo_cent')::bigint - (r ->> 'gastos_cent')::bigint - (r ->> 'renta_cent')::bigint,
      'cobrado_cent', (select coalesce(sum(pg.monto_cent), 0)::bigint from operacion.pago pg where pg.fecha_neg between w.ini and w.ini + 6)) order by w.ini), '[]'::jsonb) into v_hist
    from (select (v_semana_ini - 7 * g)::date as ini from generate_series(1, 12) g) w cross join lateral (select rep.resumen_periodo(w.ini, w.ini + 6) as r) q;
  -- Clientes: pedidos de las ultimas 13 semanas.
  select coalesce(jsonb_agg(jsonb_build_object('cliente_id', c.id::text, 'cliente', c.nombre_canonico, 'pedidos', pj.pedidos) order by c.nombre_canonico), '[]'::jsonb) into v_clientes
    from catalogo.cliente c join lateral (
      select jsonb_agg(jsonb_build_object('fecha', x.fecha, 'piezas', x.piezas, 'ventas_cent', x.ventas, 'contrib_cent', x.ventas - x.costo - x.gastos - x.renta, 'sabores', x.sabores) order by x.fecha, x.folio) as pedidos from (
        select p.fecha_envio as fecha, p.folio, sum(l.piezas_surtidas)::int as piezas, sum(l.precio_cent * l.piezas_surtidas)::bigint as ventas, sum(rep.costo_linea(l.id) * l.piezas_surtidas)::bigint as costo,
               rep.gasto_pedido(p.id, array['guia_envio', 'uber', 'mensajeria']) as gastos, coalesce((select sum(rd.monto_cent) from operacion.renta_devengo rd join operacion.pedido_linea l3 on l3.id = rd.pedido_linea_id where l3.pedido_id = p.id), 0)::bigint as renta,
               (select jsonb_object_agg(z.sabor, z.n) from (select sb.nombre_canonico as sabor, sum(l2.piezas_surtidas)::int as n from operacion.pedido_linea l2 join catalogo.sku k on k.id = l2.sku_id join catalogo.sabor sb on sb.id = k.sabor_id
                                                            where l2.pedido_id = p.id and l2.piezas_surtidas > 0 group by sb.nombre_canonico) z) as sabores
          from operacion.pedido p join operacion.pedido_linea l on l.pedido_id = p.id
         where p.cliente_id = c.id and p.estado = 'enviado' and p.fecha_envio between p_fin - 13 * 7 + 1 and p_fin and l.piezas_surtidas > 0 group by p.id) x) pj on pj.pedidos is not null;
  -- Inventario por modelo.
  select coalesce(jsonb_agg(jsonb_build_object(
      'modelo', m.nombre_canonico, 'existencia', coalesce(e.piezas, 0), 'en_transito', coalesce((select sum(u.piezas) from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.ubicacion ub on ub.codigo = u.ubicacion where k.modelo_id = m.id and ub.tipo = 'transito'), 0),
      'costo_prom_cent', coalesce(e.costo_prom_cent, 0),
      'ventas_semanales', (select jsonb_agg(coalesce((select sum(l.piezas_surtidas) from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id
                                                         where l.modelo_id = m.id and p.estado = 'enviado' and p.fecha_envio between (v_semana_ini - 7 * g)::date and (v_semana_ini - 7 * g)::date + 6), 0) order by g desc) from generate_series(0, 11) g),
      'contrib_por_pieza_cent', coalesce((select negocio.redondear_medio_arriba(sum((l.precio_cent - rep.costo_linea(l.id)) * l.piezas_surtidas)::bigint, sum(l.piezas_surtidas)::bigint) from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id
                                           where l.modelo_id = m.id and p.estado = 'enviado' and p.fecha_envio between p_fin - 27 and p_fin having sum(l.piezas_surtidas) > 0), 0),
      'dias_sin_venta', coalesce(p_fin - (select max(p.fecha_envio) from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where l.modelo_id = m.id and p.estado = 'enviado' and p.fecha_envio <= p_fin and l.piezas_surtidas > 0), 365)::int,
      'proveedor', coalesce(pv.nombre, 'Isaac'), 'costo_reposicion_cent', coalesce(pv.costo_cent, e.costo_prom_cent, 0),
      'lead_time', jsonb_build_object('dias', coalesce((catalogo.config_valor('plazo_proveedor_dias') ->> coalesce(pv.nombre, 'Isaac'))::int, 7), 'reposiciones', 0, 'declarado', true),
      'piezas_por_caja', v_cajas,
      'sabores', coalesce((select jsonb_agg(jsonb_build_object('sabor', sb.nombre_canonico, 'existencia', coalesce((select sum(u.piezas) from operacion.existencia_sku_ubicacion u where u.sku_id = k.id), 0),
          'vendidas28', coalesce((select sum(l.piezas_surtidas) from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where l.sku_id = k.id and p.estado = 'enviado' and p.fecha_envio between p_fin - 27 and p_fin), 0),
          'dias_agotado', 0) order by sb.nombre_canonico) from catalogo.sku k join catalogo.sabor sb on sb.id = k.sabor_id where k.modelo_id = m.id and k.activo), '[]'::jsonb)) order by m.nombre_canonico), '[]'::jsonb) into v_inv
    from catalogo.modelo m left join operacion.existencia_modelo e on e.modelo_id = m.id
    left join lateral (select p2.nombre, c2.costo_cent from catalogo.costo_proveedor c2 join catalogo.proveedor p2 on p2.id = c2.proveedor_id where c2.modelo_id = m.id and c2.vigente_hasta is null order by c2.costo_cent, p2.nombre limit 1) pv on true
   where coalesce(e.piezas, 0) > 0 or exists (select 1 from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where l.modelo_id = m.id and p.estado = 'enviado' and p.fecha_envio between p_fin - 83 and p_fin);
  -- Cartera: saldo por cobrar por cliente y antiguedad del saldo mas viejo.
  select coalesce(jsonb_agg(jsonb_build_object('cliente_id', c.id::text, 'cliente', c.nombre_canonico, 'saldo_cent', s.saldo, 'dias', s.dias, 'ticket_mediano_cent', s.ticket, 'pagos_mas_lentos', false, 'pedidos_historia', s.n) order by s.saldo desc), '[]'::jsonb) into v_cartera
    from catalogo.cliente c join lateral (
      select sum(operacion.pedido_saldo(p.id))::bigint as saldo, (p_fin - min(p.fecha_envio) filter (where operacion.pedido_saldo(p.id) > 0))::int as dias,
             (select (percentile_disc(0.5) within group (order by operacion.pedido_cobrado(x.id)))::bigint from operacion.pedido x where x.cliente_id = c.id and x.estado = 'enviado') as ticket,
             (select count(*)::int from operacion.pedido x where x.cliente_id = c.id and x.estado = 'enviado') as n
        from operacion.pedido p where p.cliente_id = c.id and p.estado = 'enviado' and p.fecha_envio <= p_fin) s on s.saldo > 0;
  select coalesce(jsonb_agg(jsonb_build_object('concepto', g.categoria, 'categoria', g.naturaleza, 'plataforma', contabilidad.cuenta_gasto(g.categoria, null) ~ '^62', 'monto_cent', g.monto_cent,
      'pagado_por', coalesce((select s.nombre from catalogo.socio s where s.id = g.pagado_por_socio_id), 'Sociedad')) order by g.fecha_neg, g.id), '[]'::jsonb) into v_gastos
    from operacion.gasto g where g.fecha_neg between p_ini and p_fin and not exists (select 1 from operacion.gasto_anulacion an where an.gasto_id = g.id);
  select coalesce(jsonb_agg(jsonb_build_object('id', c.codigo, 'nombre', c.nombre, 'via1_cent', c.via_a_cent, 'via2_cent', c.via_b_cent, 'ok', c.ok, 'unidad', case c.unidad when 'mxn' then 'cent' else c.unidad end) order by c.codigo), '[]'::jsonb) into v_comp
    from contabilidad.comprobaciones() c where c.codigo ~ '^C[0-9]+$';
  v_tope := coalesce(catalogo.config_num('reporte_tope_plataforma_cent'), 0)::bigint;
  v_gasto_ia := coalesce((select sum(l.monto_cent) from costos.cargo l join costos.servicio s on s.id = l.servicio_id where s.categoria = 'ia' and l.mes = to_char(p_fin, 'YYYY-MM')), 0);
  return jsonb_build_object(
    'inicio', p_ini, 'fin', p_fin, 'corte_iso', (p_fin + 1)::text || 'T11:59:00Z', 'aprobado_en', v_aprob, 'en_curso', v_hoy <= p_fin, 'datos_incompletos', v_incompletos,
    'semana_iso', extract(week from p_ini)::int, 'anio', extract(isoyear from p_ini)::int,
    'pedidos', rep.pedidos(p_ini, p_fin), 'pedidos_anterior', rep.pedidos(p_ini_ant, p_fin_ant), 'historia', v_hist, 'clientes', v_clientes, 'inventario', v_inv, 'cartera', v_cartera,
    'gastos', v_gastos, 'comparacion_proveedores', '[]'::jsonb, 'comprobaciones', v_comp, 'plataforma', jsonb_build_object('tope_cent', v_tope, 'gasto_cent', v_gasto_ia));
end $$;

create function rep.insumos_semanal(p_inicio date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  if extract(isodow from p_inicio) <> 1 then raise exception 'el reporte semanal inicia en lunes' using errcode = '22023'; end if;
  return rep._base(p_inicio, p_inicio + 6, p_inicio - 7, p_inicio - 1);
end $$;

-- Mensual: lo mismo sobre el mes, mas estado de resultados con mes anterior y mediana de tres meses, costos del sistema y series de 24 meses.
create function rep.insumos_mensual(p_inicio date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_fin date := (p_inicio + interval '1 month' - interval '1 day')::date; v_ant_ini date := (p_inicio - interval '1 month')::date; v_ant_fin date := p_inicio - 1;
  er jsonb; er1 jsonb; er2 jsonb; er3 jsonb; v_res jsonb; v_cs jsonb; v_ventas jsonb; v_cs_sabor jsonb; v_rank jsonb; v_dso int; v_cartera bigint; v_vent90 bigint;
  v_primero date; v_n int;
begin
  perform seguridad.exigir_socio_o_sistema();
  if extract(day from p_inicio) <> 1 then raise exception 'el reporte mensual inicia el dia 1' using errcode = '22023'; end if;
  er := contabilidad.estado_resultados(p_inicio, v_fin);
  er1 := contabilidad.estado_resultados(v_ant_ini, v_ant_fin);
  er2 := contabilidad.estado_resultados((p_inicio - interval '2 months')::date, (p_inicio - interval '1 month' - interval '1 day')::date);
  er3 := contabilidad.estado_resultados((p_inicio - interval '3 months')::date, (p_inicio - interval '2 months' - interval '1 day')::date);
  v_res := (select jsonb_agg(jsonb_build_object('id', r.id, 'etiqueta', r.etiqueta, 'cuenta', r.cuenta, 'monto_cent', (er ->> r.clave)::bigint, 'mes_anterior_cent', (er1 ->> r.clave)::bigint,
      'mediana_tres_meses_cent', (select (percentile_disc(0.5) within group (order by v))::bigint from unnest(array[(er1 ->> r.clave)::bigint, (er2 ->> r.clave)::bigint, (er3 ->> r.clave)::bigint]) v),
      'subtotal', r.subtotal, 'signo', r.signo) order by r.orden)
    from (values (1, 'ventasNetas', 'Ventas netas', '4110-4130', 'ventas_netas_cent', false, 1), (2, 'envioCobrado', 'Envío cobrado', '4300', 'envio_cent', false, 1),
                 (3, 'costoVentas', 'Costo de ventas', '5100-5400', 'costo_ventas_cent', false, -1), (4, 'utilidadBruta', 'Utilidad bruta', '', 'utilidad_bruta_cent', true, 1),
                 (5, 'gastosVariables', 'Gastos variables', '6110-6140', 'gastos_variables_cent', false, -1), (6, 'utilidadContribucion', 'Utilidad de contribución', '', 'utilidad_contribucion_cent', true, 1),
                 (7, 'gastosFijos', 'Gastos fijos', '6210-6290', 'gastos_fijos_cent', false, -1), (8, 'otros', 'Otros ingresos y gastos', '4910-7900', 'otros_cent', false, 1),
                 (9, 'utilidadNeta', 'Utilidad neta', '', 'utilidad_neta_cent', true, 1)) r (orden, id, etiqueta, cuenta, clave, subtotal, signo));
  v_cs := costos.insumo_reporte(to_char(p_inicio, 'YYYY-MM'));
  select min(p.fecha_envio) into v_primero from operacion.pedido p where p.estado = 'enviado';
  v_n := least(24, coalesce((extract(year from age(date_trunc('month', p_inicio), date_trunc('month', coalesce(v_primero, p_inicio)))) * 12 + extract(month from age(date_trunc('month', p_inicio), date_trunc('month', coalesce(v_primero, p_inicio)))))::int + 1, 1));
  select coalesce(jsonb_agg((contabilidad.estado_resultados(m.ini, (m.ini + interval '1 month' - interval '1 day')::date) ->> 'ventas_netas_cent')::bigint order by m.ini), '[]'::jsonb) into v_ventas
    from (select (date_trunc('month', p_inicio) - make_interval(months => g))::date as ini from generate_series(0, v_n - 1) g) m;
  select coalesce(jsonb_agg(jsonb_build_object('cliente', q.cliente, 'sabor', q.sabor, 'piezas', q.piezas) order by q.cliente, q.sabor), '[]'::jsonb) into v_cs_sabor
    from (select c.nombre_canonico as cliente, sb.nombre_canonico as sabor, sum(l.piezas_surtidas)::int as piezas from operacion.pedido p join operacion.pedido_linea l on l.pedido_id = p.id join catalogo.cliente c on c.id = p.cliente_id
            join catalogo.sku k on k.id = l.sku_id join catalogo.sabor sb on sb.id = k.sabor_id where p.estado = 'enviado' and p.fecha_envio between p_inicio and v_fin and l.piezas_surtidas > 0 group by c.nombre_canonico, sb.nombre_canonico) q;
  select coalesce(jsonb_agg(jsonb_build_object('cliente', t.cliente, 'rank', t.rangos) order by t.total desc), '[]'::jsonb) into v_rank from (
    select s.cliente, sum(s.ventas) as total, jsonb_agg(s.rk order by s.sem) as rangos from (
      select c.nombre_canonico as cliente, w.sem, coalesce(v.ventas, 0) as ventas,
             rank() over (partition by w.sem order by coalesce(v.ventas, 0) desc, c.nombre_canonico) as rk
        from catalogo.cliente c cross join (select g as sem from generate_series(0, 12) g) w
        left join lateral (select sum(l.precio_cent * l.piezas_surtidas)::bigint as ventas from operacion.pedido p join operacion.pedido_linea l on l.pedido_id = p.id
                            where p.cliente_id = c.id and p.estado = 'enviado' and p.fecha_envio between v_fin - 7 * (13 - w.sem) + 1 and v_fin - 7 * (12 - w.sem)) v on true
       where exists (select 1 from operacion.pedido p where p.cliente_id = c.id and p.estado = 'enviado' and p.fecha_envio between v_fin - 90 and v_fin)) s group by s.cliente order by sum(s.ventas) desc limit 6) t;
  select coalesce(sum(operacion.pedido_saldo(p.id)), 0)::bigint into v_cartera from operacion.pedido p where p.estado = 'enviado' and p.fecha_envio <= v_fin;
  select coalesce(sum(l.precio_cent * l.piezas_surtidas), 0)::bigint into v_vent90 from operacion.pedido p join operacion.pedido_linea l on l.pedido_id = p.id where p.estado = 'enviado' and p.fecha_envio between v_fin - 89 and v_fin;
  v_dso := case when v_vent90 > 0 then round(v_cartera::numeric * 90 / v_vent90)::int else 0 end;
  return rep._base(p_inicio, v_fin, v_ant_ini, v_ant_fin) || jsonb_build_object(
    'mes', to_char(p_inicio, 'YYYY-MM'), 'resultados', v_res, 'utilidad_neta_cent', (er ->> 'utilidad_neta_cent')::bigint,
    'costos_sistema', case when (v_cs ->> 'cargo_sociedad_cent')::bigint = 0 and (v_cs ->> 'reembolsado_cent')::bigint = 0 then null else v_cs end,
    'ventas_mensuales_cent', v_ventas, 'cliente_sabor', v_cs_sabor, 'rank_semanal_clientes', v_rank, 'dso_dias', v_dso, 'tendencia_cartera_bp', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- api.* para la web (rol socio): historial, vista previa (HTML guardado) y PDF bajo sesion.
-- ---------------------------------------------------------------------------
create function api.rep_historial() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return rep.historial(); end $$;
create function api.rep_versiones(p_clave text) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return rep.versiones(p_clave); end $$;
create function api.rep_html(p_clave text, p_version int) returns text language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return rep.html(p_clave, p_version); end $$;
create function api.rep_pdf(p_clave text, p_version int) returns text language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return encode(rep.pdf(p_clave, p_version), 'base64'); end $$;

revoke execute on all functions in schema rep from public, anon, authenticated;
grant execute on all functions in schema rep to servidor;
revoke execute on function api.rep_historial(), api.rep_versiones(text), api.rep_html(text, int), api.rep_pdf(text, int) from public, anon;
grant execute on function api.rep_historial(), api.rep_versiones(text), api.rep_html(text, int), api.rep_pdf(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Aviso de reporte: UN aviso (campana + Telegram al grupo con el enlace autenticado + correo corto sin adjunto) por version. Idempotente por clave y version.
-- ---------------------------------------------------------------------------
create function rep.emitir_aviso(p_clave text, p_codigo text, p_texto text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_version int; v_folio text;
begin
  perform seguridad.exigir_socio_o_sistema();
  if p_codigo not in ('reporte_semanal', 'reporte_mensual', 'reporte_no_salio') then raise exception 'codigo de aviso de reporte desconocido' using errcode = '22023'; end if;
  select r.version, r.folio into v_version, v_folio from rep.reporte r where r.clave = p_clave order by r.version desc limit 1;
  if v_version is null then raise exception 'no hay reporte % para avisar', p_clave using errcode = '22023'; end if;
  return operacion.avisar(p_codigo, null, 'rep:' || p_clave || ':' || v_version || ':' || p_codigo, null, left(p_texto, 200), 'reporte', null,
    jsonb_build_object('clave', p_clave, 'version', v_version, 'folio', v_folio, 'texto', p_texto));
end $$;
revoke execute on function rep.emitir_aviso(text, text, text) from public, anon, authenticated;
grant execute on function rep.emitir_aviso(text, text, text) to servidor;
