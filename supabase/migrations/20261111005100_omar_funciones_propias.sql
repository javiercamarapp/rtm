-- Funciones de la vista web de Omar (esquema `omar`). Contrato: docs/pendiente-sql-omar.md de la rama feat/vista-omar.
-- Reglas comunes: SECURITY DEFINER, search_path vacio, primera linea seguridad.exigir_rol(array['omar']); `exigir_rol` solo reconoce usuarios ACTIVOS, asi que
-- una cuenta desactivada recibe 42501. Ninguna devuelve costo, margen, utilidad, precio de venta, cliente, proveedor, socio, duenio, reservas ni folios de
-- pedido o de compra. EXECUTE solo para `authenticated`.

-- ---------------------------------------------------------------------------
-- Configuracion visible
-- ---------------------------------------------------------------------------
create function omar.mi_configuracion() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['omar']);
  return jsonb_build_object(
    'tope_toma_piezas', coalesce((catalogo.config_valor('omar_tope_toma_piezas'))::text::int, 15),
    'caduca_horas', coalesce((catalogo.config_valor('omar_toma_caduca_horas'))::text::int, 72),
    'renta_por_pieza_cent', (catalogo.config_valor('renta_por_pieza_cent'))::text::bigint);
end $$;

-- ---------------------------------------------------------------------------
-- Solicitud de toma (nace pendiente; un socio la autoriza o rechaza desde Telegram o la web)
-- ---------------------------------------------------------------------------
-- Existencia neta de un sku en Bodega Omar: fisico menos reservas activas (pedidos confirmados y tomas pendientes). Una toma pendiente que ya paso su
-- caducidad (72 h) no retiene piezas, aunque nadie la haya cerrado todavia.
create function operacion.existencia_neta_sku(p_sku bigint) returns int
language sql stable security definer set search_path = ''
as $$
  select coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = p_sku and u.ubicacion = 'bodega_omar'), 0)::int
       - coalesce((select sum(r.piezas) from operacion.reserva r
                    where r.sku_id = p_sku and r.estado = 'activa'
                      and not (r.origen_tipo = 'toma_omar' and exists (
                            select 1 from operacion.toma_omar t
                             where t.id = r.origen_id and t.estado = 'pendiente'
                               and t.solicitada_at + make_interval(hours => coalesce((catalogo.config_valor('omar_toma_caduca_horas'))::text::int, 72)) < now()))), 0)::int
$$;

create function omar.solicitar_toma(p_clave_idem text, p_modelo text, p_sabor text, p_piezas int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_tope int := coalesce((catalogo.config_valor('omar_tope_toma_piezas'))::text::int, 15);
  v_horas int := coalesce((catalogo.config_valor('omar_toma_caduca_horas'))::text::int, 72);
  r jsonb; pb catalogo.persona_bodega; v_precio bigint; v_ev bigint; v_id bigint; v_folio text; v_hoy date := negocio.hoy(); v_at timestamptz; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['omar']);
  if nullif(btrim(p_clave_idem), '') is null then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'omar.solicitar_toma', 'm', p_modelo, 's', p_sabor, 'p', p_piezas));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if p_piezas is null or p_piezas <= 0 then raise exception 'la solicitud necesita piezas positivas' using errcode = '23514'; end if;
  if p_piezas > v_tope then raise exception 'la solicitud pasa el tope por toma' using errcode = '23514'; end if;
  r := operacion.resolver_sku(jsonb_build_object('modelo', p_modelo, 'sabor', p_sabor));   -- desconocido: 22023
  select * into pb from catalogo.persona_bodega where id = operacion.persona_bodega_id();
  -- Un candado por sku evita que dos solicitudes simultaneas reserven la misma ultima pieza.
  perform pg_advisory_xact_lock(hashtextextended('toma_sku:' || (r->>'sku_id'), 0));
  if p_piezas > operacion.existencia_neta_sku((r->>'sku_id')::bigint) then
    raise exception 'esa pieza ya no esta disponible para tomar' using errcode = 'P0423';
  end if;
  v_precio := catalogo.precio_vigente(pb.cliente_id, (r->>'modelo_id')::bigint, v_hoy);
  v_ev := operacion.crear_evento('toma_omar', v_hoy, p_clave_idem, jsonb_build_object('piezas', p_piezas, 'estado', 'pendiente', 'via', 'web_omar'));
  v_folio := seguridad.siguiente_folio('T');
  insert into operacion.toma_omar (folio, persona_bodega_id, sku_id, modelo_id, piezas, precio_cent, fecha_neg, via, estado, evento_id)
    values (v_folio, pb.id, (r->>'sku_id')::bigint, (r->>'modelo_id')::bigint, p_piezas, v_precio, v_hoy, 'telegram_omar', 'pendiente', v_ev)
    returning id, solicitada_at into v_id, v_at;
  insert into operacion.reserva (sku_id, piezas, origen_tipo, origen_id) values ((r->>'sku_id')::bigint, p_piezas, 'toma_omar', v_id);
  perform operacion.avisar('toma_pendiente', 'NT-052', 'toma_pendiente:' || v_id, 'I',
    'Omar pide ' || p_piezas || ' pz de ' || p_modelo || ' (' || p_sabor || '): ' || v_folio || '. Autoriza o rechaza', 'toma_omar', v_id,
    jsonb_build_object('folio', v_folio, 'piezas', p_piezas), null, v_ev, false, array['software', 'telegram']);
  v_res := jsonb_build_object('estado', 'pendiente', 'folio', v_folio, 'caduca_at', v_at + make_interval(hours => v_horas), 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas propias
-- ---------------------------------------------------------------------------
create function omar.mis_solicitudes(p_limite int default 20) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_horas int := coalesce((catalogo.config_valor('omar_toma_caduca_horas'))::text::int, 72); v_lim int := least(greatest(coalesce(p_limite, 20), 1), 100);
begin
  perform seguridad.exigir_rol(array['omar']);
  return coalesce((
    select jsonb_agg(x order by (x->>'solicitada_at') desc, (x->>'folio') desc) from (
      select jsonb_build_object(
        'folio', t.folio, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', t.piezas,
        -- Una pendiente que ya paso su plazo se muestra caducada aunque un socio aun no la cierre.
        'estado', case when t.estado = 'pendiente' and t.solicitada_at + make_interval(hours => v_horas) < now() then 'caducada' else t.estado end,
        'solicitada_at', t.solicitada_at, 'caduca_at', t.solicitada_at + make_interval(hours => v_horas), 'resuelta_at', t.resuelta_at) as x
      from operacion.toma_omar t join catalogo.modelo m on m.id = t.modelo_id join catalogo.sku k on k.id = t.sku_id join catalogo.sabor sa on sa.id = k.sabor_id
      order by t.solicitada_at desc, t.id desc limit v_lim) q), '[]'::jsonb);
end $$;

create function omar.mis_liquidaciones(p_limite int default 8) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_lim int := least(greatest(coalesce(p_limite, 8), 1), 100);
begin
  perform seguridad.exigir_rol(array['omar']);
  return coalesce((
    select jsonb_agg(x order by (x->>'semana_ini') desc) from (
      select jsonb_build_object(
        'folio', l.folio, 'semana_ini', l.semana_ini, 'semana_fin', l.semana_fin, 'renta_cent', l.renta_cent, 'tomas_cent', l.tomas_cent,
        'compensado_cent', l.compensado_cent, 'neto_cent', l.neto_cent,
        'pagado_cent', coalesce((select sum(case p.sentido when 'a_omar' then p.monto_cent else -p.monto_cent end) from operacion.pago_omar p where p.liquidacion_id = l.id), 0)::bigint,
        'fecha_cierre', l.fecha_cierre) as x
      from operacion.liquidacion_omar l order by l.semana_ini desc limit v_lim) q), '[]'::jsonb);
end $$;

-- Paquetes sin cliente, proveedor, duenio, guia, costo ni folio. Consecutivos propios (1..n por antiguedad), nunca el id ni el folio.
create function omar.mis_paquetes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['omar']);
  return coalesce((
    select jsonb_agg(x order by (case x->>'tipo' when 'salida' then 0 else 1 end), (x->>'consecutivo')::int) from (
      select jsonb_build_object('consecutivo', row_number() over (order by b.base, b.id), 'tipo', 'salida',
                                'estado', case when b.empacado then 'empacado' else 'por_empacar' end,
                                'horas', greatest(floor(extract(epoch from now() - b.base) / 3600), 0)::int, 'llegada_estimada', null,
                                'renglones', coalesce((select jsonb_agg(jsonb_build_object('modelo', g.modelo, 'sabor', g.sabor, 'piezas', g.piezas) order by g.modelo, g.sabor)
                                                         from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_pedidas)::int as piezas
                                                                 from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                                                                where l.pedido_id = b.id group by m.nombre_canonico, sa.nombre_canonico) g), '[]'::jsonb)) as x
      from (select pe.id, pe.empacado_at is not null as empacado,
                   coalesce((select min(a.creado_at) from operacion.aviso a where a.codigo = 'paquete_por_empacar' and a.entidad_tipo = 'pedido' and a.entidad_id = pe.id), pe.creado_at) as base
              from operacion.pedido pe where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen)) b
      union all
      select jsonb_build_object('consecutivo', row_number() over (order by b.base, b.id), 'tipo', 'entrada',
                                'estado', case when b.estado = 'llego_merida' then 'llego' else 'en_trayecto' end,
                                'horas', null, 'llegada_estimada', b.llegada_estimada,
                                'renglones', coalesce((select jsonb_agg(jsonb_build_object('modelo', g.modelo, 'sabor', g.sabor, 'piezas', g.piezas) order by g.modelo, g.sabor)
                                                         from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_facturadas)::int as piezas
                                                                 from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                                                                where l.compra_id = b.id group by m.nombre_canonico, sa.nombre_canonico) g), '[]'::jsonb))
      from (select c.id, c.estado, c.llegada_estimada, coalesce(c.enviada_fecha::timestamptz, c.creado_at) as base
              from operacion.compra c where c.destino = 'bodega' and c.estado in ('enviada', 'en_trayecto', 'llego_merida')) b) q), '[]'::jsonb);
end $$;

revoke execute on function omar.mi_configuracion(), omar.solicitar_toma(text, text, text, int), omar.mis_solicitudes(int), omar.mis_liquidaciones(int), omar.mis_paquetes() from public, anon;
grant execute on function omar.mi_configuracion(), omar.solicitar_toma(text, text, text, int), omar.mis_solicitudes(int), omar.mis_liquidaciones(int), omar.mis_paquetes() to authenticated;
revoke execute on function operacion.existencia_neta_sku(bigint) from public, anon, authenticated;
