-- F3a / 0017: cuenta con Omar (lectura para los socios y vista de solo lectura preparada pero CERRADA), cuentas por cobrar completa (recargo, concentracion,
-- texto de cobro y recordatorios) y "Explicar este numero" de las cifras de F3a.
-- Omar sigue DESACTIVADO hasta M2: omar.v_mi_cuenta devuelve cero filas mientras no exista un usuario con rol omar ACTIVO. No despacha; presta el lugar.

-- ---------------------------------------------------------------------------
-- Vista de Omar (lista blanca de columnas, nombres neutros; sin cliente, precio de venta, costo ni utilidad)
-- ---------------------------------------------------------------------------
create view operacion.v_omar_cuenta_base with (security_barrier = true) as
  select 'renta'::text as concepto, r.devengada_fecha as fecha, pe.folio as referencia, m.nombre_canonico as modelo, r.piezas as piezas,
         (r.monto_cent / nullif(r.piezas, 0))::bigint as tarifa, r.monto_cent as importe
  from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id join catalogo.modelo m on m.id = l.modelo_id
  union all
  select 'toma', t.fecha_neg, t.folio, m.nombre_canonico, t.piezas, t.precio_cent, -(t.piezas * t.precio_cent)
  from operacion.toma_omar t join catalogo.modelo m on m.id = t.modelo_id where t.estado = 'autorizada' and t.precio_cent is not null
  union all
  select 'pago', p.fecha_neg, p.folio, null, null, null, case p.sentido when 'a_omar' then p.monto_cent else -p.monto_cent end from operacion.pago_omar p;

create view omar.v_mi_cuenta with (security_barrier = true) as
  select b.concepto, b.fecha, b.referencia, b.modelo, b.piezas, b.tarifa, b.importe from operacion.v_omar_cuenta_base b
  where exists (select 1 from seguridad.usuario u where u.id = auth.uid() and u.rol = 'omar' and u.activo);
revoke all on omar.v_mi_cuenta from public, anon, authenticated;
grant select on omar.v_mi_cuenta to authenticated;
revoke all on operacion.v_omar_cuenta_base from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Cuenta con Omar para los socios (S6)
-- ---------------------------------------------------------------------------
create function api.omar_cuenta(p_semana_ini date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy(); v_ini date := operacion.semana_omar_ini(coalesce(p_semana_ini, negocio.hoy())); v_fin date := operacion.semana_omar_ini(coalesce(p_semana_ini, negocio.hoy())) + 6;
  v_s jsonb; v_sin_cerrar date; v_pb catalogo.persona_bodega; v_neto bigint; v_horas int := coalesce((catalogo.config_valor('omar_toma_caduca_horas'))::text::int, 72);
begin
  perform seguridad.exigir_rol(array['socio']);
  select * into v_pb from catalogo.persona_bodega order by id limit 1;
  v_s := operacion.saldo_omar_semana(v_ini);
  v_neto := (v_s->>'neto_cent')::bigint;
  select min(x.sem) into v_sin_cerrar from (
    select operacion.semana_omar_ini(r.devengada_fecha) as sem from operacion.renta_devengo r
    union select operacion.semana_omar_ini(t.fecha_neg) from operacion.toma_omar t where t.estado = 'autorizada'
  ) x where x.sem + 6 < v_hoy and not exists (select 1 from operacion.liquidacion_omar l where l.semana_ini = x.sem);
  return v_s || jsonb_build_object(
    'hoy', v_hoy, 'persona', v_pb.nombre, 'palabra', case when v_neto > 0 then 'Le debemos' when v_neto < 0 then 'Omar debe' else 'Saldo cero' end,
    'renta_por_pieza_cent', coalesce((catalogo.config_valor('renta_por_pieza_cent'))::text::bigint, 0),
    'puede_cerrar', v_hoy > v_fin and not exists (select 1 from operacion.liquidacion_omar l where l.semana_ini = v_ini),
    'semana_anterior_sin_cerrar', case when v_sin_cerrar is not null and v_sin_cerrar <> v_ini then v_sin_cerrar end,
    'saldo_cuenta_cent', operacion.saldo_omar_cuenta(),
    'renta', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'folio', pe.folio, 'fecha', r.devengada_fecha, 'modelo', m.nombre_canonico, 'piezas', r.piezas, 'monto_cent', r.monto_cent,
                'tarifa_cent', (r.monto_cent / nullif(r.piezas, 0))::bigint, 'reversa', r.reversa_de is not null,
                'sabores', (select string_agg(distinct sa.nombre_canonico, ', ') from operacion.pedido_surtido s join catalogo.sku k on k.id = s.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where s.pedido_linea_id = l.id)) order by r.devengada_fecha, r.id)
                from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id join catalogo.modelo m on m.id = l.modelo_id
                where r.devengada_fecha between v_ini and v_fin), '[]'::jsonb),
    'tomas', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'folio', t.folio, 'fecha', t.fecha_neg, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', t.piezas, 'precio_cent', t.precio_cent,
                'subtotal_cent', case when t.estado = 'autorizada' and t.precio_cent is not null then t.piezas * t.precio_cent end, 'estado', t.estado, 'via', t.via, 'falta_precio', t.precio_cent is null) order by t.fecha_neg, t.id)
                from operacion.toma_omar t join catalogo.modelo m on m.id = t.modelo_id join catalogo.sku k on k.id = t.sku_id join catalogo.sabor sa on sa.id = k.sabor_id
                where t.fecha_neg between v_ini and v_fin and t.estado <> 'pendiente'), '[]'::jsonb),
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'folio', t.folio, 'fecha', t.fecha_neg, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', t.piezas, 'precio_cent', t.precio_cent,
                'solicitada_at', t.solicitada_at, 'caduca_at', t.solicitada_at + make_interval(hours => v_horas), 'falta_precio', t.precio_cent is null) order by t.solicitada_at)
                from operacion.toma_omar t join catalogo.modelo m on m.id = t.modelo_id join catalogo.sku k on k.id = t.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where t.estado = 'pendiente'), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha', p.fecha_neg, 'monto_cent', p.monto_cent, 'sentido', p.sentido, 'via', p.via, 'socio', (select nombre from catalogo.socio where id = p.socio_id))
                order by p.fecha_neg, p.id) from operacion.pago_omar p where p.fecha_neg between v_ini and v_fin), '[]'::jsonb),
    'liquidaciones', coalesce((select jsonb_agg(jsonb_build_object('folio', l.folio, 'semana_ini', l.semana_ini, 'semana_fin', l.semana_fin, 'renta_cent', l.renta_cent, 'tomas_cent', l.tomas_cent, 'compensado_cent', l.compensado_cent,
                'neto_cent', l.neto_cent, 'palabra', case when l.neto_cent > 0 then 'Le debemos' when l.neto_cent < 0 then 'Omar debe' else 'Saldo cero' end, 'fecha_cierre', l.fecha_cierre) order by l.semana_ini desc)
                from (select * from operacion.liquidacion_omar order by semana_ini desc limit 8) l), '[]'::jsonb),
    'skus', coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'existencia', u.piezas, 'precio_cent', catalogo.precio_vigente(v_pb.cliente_id, m.id))
                order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
                from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
                where u.ubicacion = 'bodega_omar' and u.piezas > 0), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Cuentas por cobrar completa
-- ---------------------------------------------------------------------------
insert into catalogo.config (clave, valor, vigente_desde) values ('recargo_credito_bp', '1000', '2026-11-10');   -- 10 % por credito (regla del documento de Angelo), sugerido; se aplica a mano

-- Recargo por credito de un pedido enviado: se calcula en la base (hacia arriba, a favor de la sociedad) y sale como correccion enlazada de la nota.
create function operacion.registrar_recargo_credito(p_clave_idem text, p_pedido bigint, p_porcentaje_bp int default null, p_monto_cent bigint default null, p_motivo text default 'Recargo por credito') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; ult operacion.nota; v_bp int; v_recargo bigint; v_actual bigint; v_sub bigint; v_r jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_recargo_credito', 'p', p_pedido, 'b', p_porcentaje_bp, 'm', p_monto_cent, 'mo', p_motivo));
  if v_prev is not null then return v_prev; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found or ped.estado <> 'enviado' then raise exception 'solo un pedido enviado admite recargo' using errcode = 'P0428'; end if;
  select * into ult from operacion.nota where pedido_id = ped.id order by id desc limit 1;
  v_sub := (ult.snapshot_cliente->>'subtotal_cent')::bigint;
  v_actual := coalesce((ult.snapshot_cliente->>'recargo_cent')::bigint, 0);
  if p_monto_cent is not null then
    v_recargo := p_monto_cent;
  else
    v_bp := coalesce(p_porcentaje_bp, (catalogo.config_valor('recargo_credito_bp'))::text::int);
    if v_bp is null or v_bp <= 0 or v_bp > 10000 then raise exception 'porcentaje de recargo invalido' using errcode = '23514'; end if;
    v_recargo := (v_sub * v_bp + 9999) / 10000;
  end if;
  if v_recargo is null or v_recargo < 0 then raise exception 'recargo invalido' using errcode = '23514'; end if;
  if v_recargo = v_actual then raise exception 'el pedido ya tiene ese recargo' using errcode = 'P0428'; end if;
  v_r := operacion.emitir_correccion(p_clave_idem || ':nota', p_pedido, coalesce(nullif(btrim(p_motivo), ''), 'Recargo por credito'), null, null, null, v_recargo);
  v_res := v_r || jsonb_build_object('recargo_cent', v_recargo, 'recargo_anterior_cent', v_actual);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Recordatorios por evento de calendario (los emite el sistema o un socio; el agente nunca escribe a clientes): cobro que vence manana y dinero de la sociedad
-- que lleva demasiados dias en poder de un socio. Idempotentes por dia.
create function operacion.emitir_recordatorios_cobro(p_fecha date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_fecha date := coalesce(p_fecha, negocio.hoy()); v_n int := 0; v_m int := 0; r record; v_dias int; v_umbral int := coalesce((catalogo.config_valor('fondos_alerta_dias'))::text::int, 7);
begin
  perform seguridad.exigir_rol(array['socio', 'importacion', 'sistema']);
  for r in
    select pe.id, pe.folio, pe.duenio_id, c.nombre_canonico as cliente, operacion.pedido_saldo(pe.id) as saldo
    from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id
    where pe.estado = 'enviado' and pe.plazo_dias is not null and pe.fecha_envio + pe.plazo_dias = v_fecha + 1 and operacion.pedido_saldo(pe.id) > 0
  loop
    perform operacion.avisar('cobranza_vence_manana', 'NT-035', 'cobro_vence:' || r.id || ':' || (v_fecha + 1), 'I', 'Cuenta por cobrar de ' || r.cliente || ' vence manana (' || r.folio || ')', 'pedido', r.id,
      jsonb_build_object('folio', r.folio, 'cliente', r.cliente, 'saldo_cent', r.saldo), r.duenio_id, null, false, array['software', 'telegram']);
    v_n := v_n + 1;
  end loop;
  for r in select s.id, s.nombre from catalogo.socio s loop
    v_dias := operacion.dias_fondos_en_poder(r.id);
    if v_dias is not null and v_dias > v_umbral then
      perform operacion.avisar('fondos_en_poder_socio', 'NT-043', 'fondos_poder:' || r.id || ':' || v_fecha, 'I', 'Fondos de la sociedad en poder de ' || r.nombre || ' desde hace ' || v_dias || ' dias', 'socio', r.id,
        jsonb_build_object('socio', r.nombre, 'dias', v_dias, 'fondos_cent', operacion.saldo_socio(r.id, 'fondos')), null, null, false, array['software', 'telegram']);
      v_m := v_m + 1;
    end if;
  end loop;
  return jsonb_build_object('vencen_manana', v_n, 'fondos_en_poder', v_m);
end $$;

-- Texto de cobro y recordatorio para copiar y pegar (el agente nunca escribe a clientes).
create function api.texto_cobro(p_cliente bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_nombre text; v_texto text; r record; v_total bigint := 0; v_pago text; v_hoy date := negocio.hoy(); v_vencidos int := 0;
begin
  perform seguridad.exigir_rol(array['socio']);
  select nombre_canonico into v_nombre from catalogo.cliente where id = p_cliente;
  if v_nombre is null then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  v_texto := 'Hola, te comparto el estado de tu cuenta:' || E'\n';
  for r in
    select pe.folio, pe.fecha_envio, pe.plazo_dias, operacion.pedido_saldo(pe.id) as saldo, case when pe.plazo_dias is null then null else pe.fecha_envio + pe.plazo_dias end as vence
    from operacion.pedido pe where pe.cliente_id = p_cliente and pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0 order by pe.fecha_envio, pe.id
  loop
    v_total := v_total + r.saldo;
    if r.vence is not null and r.vence < v_hoy then v_vencidos := v_vencidos + 1; end if;
    v_texto := v_texto || r.folio || ' (enviado el ' || r.fecha_envio || '): $' || operacion.fmt_pesos(r.saldo, true)
            || case when r.vence is null then '' when r.vence < v_hoy then ', vencido desde el ' || r.vence else ', vence el ' || r.vence end || E'\n';
  end loop;
  if v_total = 0 then return jsonb_build_object('texto', null, 'total_cent', 0, 'cliente', v_nombre); end if;
  v_texto := v_texto || 'Total por pagar: $' || operacion.fmt_pesos(v_total, true) || E'\n';
  v_pago := nullif(btrim(coalesce(trim(both '"' from (catalogo.config_valor('nota_datos_pago_texto'))::text), '')), '');
  if v_pago is not null then v_texto := v_texto || v_pago || E'\n'; end if;
  v_texto := v_texto || case when v_vencidos > 0 then 'Quedamos pendientes de tu pago. Gracias.' else 'Gracias por tu preferencia.' end;
  return jsonb_build_object('texto', v_texto, 'total_cent', v_total, 'cliente', v_nombre, 'vencidos', v_vencidos);
end $$;

-- Mismo resultado que F2 con concentracion por cliente, recargo (actual y sugerido), principal deudor con su proximo vencimiento y antiguedad de los fondos en poder de un socio.
create or replace function api.cuentas_por_cobrar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb; v_hoy date := negocio.hoy(); v_bp int := coalesce((catalogo.config_valor('recargo_credito_bp'))::text::int, 1000);
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(jsonb_agg(x order by (x->>'dias')::int desc), '[]'::jsonb) into v_filas from (
    select jsonb_build_object(
      'pedido_id', pe.id, 'folio', pe.folio, 'cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'fecha_envio', pe.fecha_envio, 'plazo_dias', pe.plazo_dias,
      'vence', case when pe.plazo_dias is null then null else pe.fecha_envio + pe.plazo_dias end, 'original_cent', operacion.pedido_cobrado(pe.id), 'abonos_cent', operacion.pedido_aplicado(pe.id),
      'saldo_cent', operacion.pedido_saldo(pe.id), 'dias', v_hoy - pe.fecha_envio,
      'dias_atraso', case when pe.plazo_dias is null then null else greatest(v_hoy - (pe.fecha_envio + pe.plazo_dias), 0) end,
      'estado', case when operacion.pedido_saldo(pe.id) < 0 then 'saldo_a_favor' when pe.plazo_dias is null then 'sin_plazo' when v_hoy > pe.fecha_envio + pe.plazo_dias then 'vencido'
                     when v_hoy >= pe.fecha_envio + pe.plazo_dias - 2 then 'por_vencer' else 'al_corriente' end,
      'cubeta', case when v_hoy - pe.fecha_envio <= 7 then '0_7' when v_hoy - pe.fecha_envio <= 14 then '8_14' when v_hoy - pe.fecha_envio <= 30 then '15_30' else 'mas_30' end,
      'recargo_cent', coalesce((select (n.snapshot_cliente->>'recargo_cent')::bigint from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0),
      'recargo_sugerido_cent', coalesce((select ((n.snapshot_cliente->>'subtotal_cent')::bigint * v_bp + 9999) / 10000 from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1), 0)) as x
    from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id join catalogo.socio s on s.id = c.duenio_id
    where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) <> 0) q;
  return jsonb_build_object(
    'hoy', v_hoy, 'filas', v_filas, 'recargo_bp', v_bp,
    'total_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) from jsonb_array_elements(v_filas) f),
    'vencido_cent', (select coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) from jsonb_array_elements(v_filas) f),
    'antiguedad_cent', (select jsonb_object_agg(k, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_filas) f where f->>'cubeta' = k and (f->>'saldo_cent')::bigint > 0), 0)) from unnest(array['0_7', '8_14', '15_30', 'mas_30']) k),
    'por_duenio_cent', (select coalesce(jsonb_object_agg(d, coalesce((select sum((f->>'saldo_cent')::bigint) from jsonb_array_elements(v_filas) f where f->>'duenio' = d and (f->>'saldo_cent')::bigint > 0), 0)), '{}'::jsonb) from unnest(array['Angelo', 'Javier']) d),
    'por_cliente', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', k.cid, 'cliente', k.cliente, 'duenio', k.duenio, 'saldo_cent', k.saldo, 'vencido_cent', k.vencido, 'pedidos', k.n, 'dias_max', k.dias_max,
                  'proximo_vence', k.vence) order by k.saldo desc, k.cliente)
      from (select (f->>'cliente_id')::bigint as cid, f->>'cliente' as cliente, f->>'duenio' as duenio,
                   sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0) as saldo,
                   coalesce(sum((f->>'saldo_cent')::bigint) filter (where f->>'estado' = 'vencido'), 0) as vencido,
                   count(*) filter (where (f->>'saldo_cent')::bigint > 0)::int as n, max((f->>'dias')::int) as dias_max,
                   min((f->>'vence')::date) filter (where (f->>'saldo_cent')::bigint > 0) as vence
            from jsonb_array_elements(v_filas) f group by 1, 2, 3 having coalesce(sum((f->>'saldo_cent')::bigint) filter (where (f->>'saldo_cent')::bigint > 0), 0) > 0) k), '[]'::jsonb),
    'saldos_a_favor', coalesce((select jsonb_agg(jsonb_build_object('cliente_id', c.id, 'cliente', c.nombre_canonico, 'duenio', s.nombre, 'monto_cent', operacion.saldo_favor_cliente(c.id)) order by c.nombre_canonico)
      from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where operacion.saldo_favor_cliente(c.id) > 0), '[]'::jsonb),
    'pagos_sin_identificar', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'folio', p.folio, 'fecha_neg', p.fecha_neg, 'monto_cent', p.monto_cent, 'cuenta', cd.nombre) order by p.id)
      from operacion.pago p join operacion.cuenta_dinero cd on cd.id = p.cuenta_destino_id
      where p.identificacion = 'sin_identificar' and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = p.id) and not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id)), '[]'::jsonb),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('socio', s.nombre, 'deuda_cent', operacion.saldo_socio(s.id), 'fondos_cent', operacion.saldo_socio(s.id, 'fondos'), 'diferencia_cent', operacion.saldo_socio(s.id, 'diferencia'),
        'dias_fondos', operacion.dias_fondos_en_poder(s.id),
        'alerta_fondos', coalesce(operacion.dias_fondos_en_poder(s.id) > (catalogo.config_valor('fondos_alerta_dias'))::text::int, false)) order by s.nombre) from catalogo.socio s), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- "Explicar este numero" de F3a: se antepone a la funcion de F2, que atiende el resto de las cifras.
-- ---------------------------------------------------------------------------
alter function api.explicar_cifra(text) rename to explicar_cifra_f2;
revoke execute on function api.explicar_cifra_f2(text) from public, anon, authenticated;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_c jsonb; v_h jsonb; v_t jsonb; v_cp jsonb; v_rengs jsonb; v_via1 bigint; v_via2 bigint; v_id bigint; v_s jsonb; v_u jsonb; v_caja bigint; v_x jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if partes[1] = 'socios' and partes[2] = 'diferencia' then
    v_c := operacion.cuenta_socios();
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Costo de la compra de la sociedad (mercancia, seguros y guias)', 'monto_cent', (v_c->>'costo_cent')::bigint),
      jsonb_build_object('concepto', 'Mitad del costo que toca a cada socio', 'monto_cent', (v_c->>'mitad_cent')::bigint),
      jsonb_build_object('concepto', 'Angelo puso (capital y gastos pagados)', 'monto_cent', (v_c->'angelo'->>'puso_capital_cent')::bigint + (v_c->'angelo'->>'puso_reembolsable_cent')::bigint),
      jsonb_build_object('concepto', 'Angelo: menos lo que queda fuera de la sociedad', 'monto_cent', -(v_c->'angelo'->>'fuera_sociedad_cent')::bigint),
      jsonb_build_object('concepto', 'Angelo: menos lo que debe a la sociedad', 'monto_cent', -(v_c->'angelo'->>'debe_cent')::bigint),
      jsonb_build_object('concepto', 'Javier puso (capital y gastos pagados)', 'monto_cent', (v_c->'javier'->>'puso_capital_cent')::bigint + (v_c->'javier'->>'puso_reembolsable_cent')::bigint),
      jsonb_build_object('concepto', 'Javier: menos lo que queda fuera de la sociedad', 'monto_cent', -(v_c->'javier'->>'fuera_sociedad_cent')::bigint),
      jsonb_build_object('concepto', 'Javier: menos lo que debe a la sociedad', 'monto_cent', -(v_c->'javier'->>'debe_cent')::bigint));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Lo que Javier debe a Angelo por la compra (+ Javier debe, − Angelo debe)', 'valor', (v_c->>'javier_debe_a_angelo_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Lo que puso Angelo menos la mitad del costo', 'via1_valor', (v_c->>'via1_cent')::bigint, 'via2', 'Lo que puso Angelo menos lo que puso Javier, entre dos', 'via2_valor', (v_c->>'via2_cent')::bigint, 'cuadra', (v_c->>'cuadra')::boolean),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'socio' and partes[2] = 'neto' then
    select id into v_id from catalogo.socio where nombre = partes[3];
    if v_id is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
    v_s := api.socio_cuenta(partes[3]);
    select coalesce(jsonb_agg(m || jsonb_build_object('monto_cent', m->'efecto_cent') order by ord), '[]'::jsonb), coalesce(sum((m->>'efecto_cent')::bigint), 0)::bigint into v_rengs, v_via2
      from jsonb_array_elements(v_s->'movimientos') with ordinality as t(m, ord);
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Posicion de ' || partes[3] || ' con la sociedad (+ la sociedad le debe, − el debe)', 'valor', operacion.neto_socio(v_id), 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Funcion de posicion neta del socio', 'via1_valor', operacion.neto_socio(v_id), 'via2', 'Suma de aportaciones, libro y lo que debe', 'via2_valor', v_via2, 'cuadra', operacion.neto_socio(v_id) = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'proveedor' and partes[2] = 'falta' then
    v_h := operacion.hoja_proveedor(partes[3], partes[4]::date, partes[5]);
    v_t := v_h->'totales'; v_cp := v_h->'comprobaciones';
    v_via2 := (v_t->>'saldo_anterior_cent')::bigint + (v_cp->>'mercancia_independiente_cent')::bigint + (v_cp->>'seguros_independiente_cent')::bigint + (v_cp->>'guias_independiente_cent')::bigint
              - (v_cp->>'depositos_independiente_cent')::bigint - (v_t->>'ajustes_cent')::bigint;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Saldo anterior', 'monto_cent', (v_t->>'saldo_anterior_cent')::bigint),
      jsonb_build_object('concepto', 'Mercancia a costo (pedidos y ordenes de compra)', 'monto_cent', (v_t->>'mercancia_cent')::bigint),
      jsonb_build_object('concepto', 'Seguros de reenvio', 'monto_cent', (v_t->>'seguros_cent')::bigint),
      jsonb_build_object('concepto', 'Guias', 'monto_cent', (v_t->>'guias_cent')::bigint),
      jsonb_build_object('concepto', 'Pagos de la semana (depositos de clientes, socios y sociedad)', 'monto_cent', -(v_t->>'pagos_cent')::bigint),
      jsonb_build_object('concepto', 'Ajustes a favor', 'monto_cent', -(v_t->>'ajustes_cent')::bigint));
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Falta por saldar con ' || partes[3] || ' (costo total con guias menos pagos)', 'valor', (v_t->>'falta_por_saldar_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Hoja: suma de renglones, pagos y ajustes', 'via1_valor', (v_t->>'falta_por_saldar_cent')::bigint, 'via2', 'Recalculo directo de los libros', 'via2_valor', v_via2, 'cuadra', (v_t->>'falta_por_saldar_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'omar' and partes[2] = 'neto' then
    v_s := operacion.saldo_omar_semana(partes[3]::date);
    select coalesce(jsonb_agg(x order by (x->>'o')::bigint), '[]'::jsonb), coalesce(sum((x->>'monto_cent')::bigint), 0)::bigint into v_rengs, v_via2 from (
      select jsonb_build_object('o', r.id, 'concepto', 'Renta ' || pe.folio || ': ' || r.piezas || ' pz x $2', 'monto_cent', r.monto_cent, 'fecha_neg', r.devengada_fecha) || operacion.evento_info(r.evento_id) as x
        from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido pe on pe.id = l.pedido_id where r.devengada_fecha between partes[3]::date and partes[3]::date + 6
      union all
      select jsonb_build_object('o', 1000000 + t.id, 'concepto', 'Toma ' || t.folio || ': ' || t.piezas || ' pz a su precio', 'monto_cent', -(t.piezas * t.precio_cent), 'fecha_neg', t.fecha_neg) || operacion.evento_info(t.evento_id)
        from operacion.toma_omar t where t.estado = 'autorizada' and t.precio_cent is not null and t.fecha_neg between partes[3]::date and partes[3]::date + 6) z;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Neto con Omar de la semana (+ le debemos, − Omar debe)', 'valor', (v_s->>'neto_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Funcion de saldo de la semana', 'via1_valor', (v_s->>'neto_cent')::bigint, 'via2', 'Renta menos tomas, renglon por renglon', 'via2_valor', v_via2, 'cuadra', (v_s->>'neto_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'cascada' and partes[2] = 'utilidad' then
    v_u := operacion.utilidad_periodo(partes[3]::date, partes[4]::date);
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Utilidad de los pedidos enviados (' || (v_u->>'pedidos') || ')', 'monto_cent', (v_u->>'utilidad_pedidos_cent')::bigint),
      jsonb_build_object('concepto', 'Utilidad de las tomas de Omar a su precio', 'monto_cent', (v_u->>'utilidad_tomas_cent')::bigint),
      jsonb_build_object('concepto', 'Gastos generales de la sociedad (incluidos los pagados por socios)', 'monto_cent', -(v_u->>'gastos_cent')::bigint));
    v_via2 := (v_u->>'utilidad_pedidos_cent')::bigint + (v_u->>'utilidad_tomas_cent')::bigint - (v_u->>'gastos_cent')::bigint;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Utilidad neta del periodo' || case when (v_u->>'provisional')::boolean then ' (provisional: hay guias sin costo)' else '' end, 'valor', (v_u->>'utilidad_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Funcion de utilidad del periodo', 'via1_valor', (v_u->>'utilidad_cent')::bigint, 'via2', 'Pedidos mas tomas menos gastos', 'via2_valor', v_via2, 'cuadra', (v_u->>'utilidad_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[1] = 'cascada' and partes[2] = 'resultado' then
    v_caja := coalesce(partes[6]::bigint, 0);
    v_c := operacion.cascada_periodo(partes[4]::date, partes[5]::date, v_caja);
    v_x := v_c->'por_socio'->partes[3];
    if v_x is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Reembolso de gastos pagados', 'monto_cent', (v_x->>'paga_reembolso_cent')::bigint),
      jsonb_build_object('concepto', 'Devolucion de aportaciones', 'monto_cent', (v_x->>'paga_aportacion_cent')::bigint),
      jsonb_build_object('concepto', 'Su parte de la utilidad repartible', 'monto_cent', (v_x->>'utilidad_cent')::bigint),
      jsonb_build_object('concepto', 'Menos lo que ya tiene en su poder o debe a la sociedad', 'monto_cent', -(v_x->>'debe_cent')::bigint));
    v_via2 := (v_x->>'paga_reembolso_cent')::bigint + (v_x->>'paga_aportacion_cent')::bigint + (v_x->>'utilidad_cent')::bigint - (v_x->>'debe_cent')::bigint;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Resultado de ' || partes[3] || ' en la cascada (+ recibe, − entrega)', 'valor', (v_x->>'resultado_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Cascada calculada', 'via1_valor', (v_x->>'resultado_cent')::bigint, 'via2', 'Suma de los cuatro pasos de este socio', 'via2_valor', v_via2, 'cuadra', (v_x->>'resultado_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  return api.explicar_cifra_f2(p_cifra);
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios y permisos
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'operacion' and p.proname = any (array['registrar_recargo_credito'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;
grant execute on function api.omar_cuenta(date), api.texto_cobro(bigint), api.cuentas_por_cobrar(), api.explicar_cifra(text) to authenticated;
revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
revoke execute on function api.explicar_cifra_f2(text) from authenticated;
