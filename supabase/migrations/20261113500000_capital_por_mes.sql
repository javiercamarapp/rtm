-- Capital por mes y por socio (pedido del dueno, 13-nov): valuacion, aportaciones de capital, utilidad generada, reinvertida y retirada, fondos de la sociedad en poder de cada socio
-- (con su motivo), aportacion neta, diferencia a igualar y cuenta con cada proveedor. SOLO LECTURA: ninguna tabla nueva, ningun asiento nuevo, ninguna regla de dinero cambia.
--
-- Fuente de cada cifra (para "Explicar este numero"; el texto vive en el resultado, campo `fuentes`):
--   aportaciones de capital declaradas : mayor, cuenta 3110/3120 (haber - debe) del periodo, SIN el capital que nace de un acta con reinversion; detalle por asiento con su concepto y origen (caja o proveedor).
--   utilidad generada                  : Estado de resultados (contabilidad.estado_resultados) del periodo, 50/50 con su misma regla de redondeo.
--   utilidad reinvertida (acta)        : aportacion_socio con ref_tipo 'reinversion', ubicada en el periodo del acta que la decidio (la misma regla que el Historial personal de lane/historial-acta).
--   utilidad reinvertida en proveedor  : CALCULADA aqui: saldo a favor con proveedores (2110/2120 con saldo deudor) limitado por la utilidad acumulada que aun no se retira ni se reinvirtio por acta;
--                                        lo que excede es ANTICIPO al proveedor, no utilidad; lo pagado por un socio sin destino confirmado es 'Por clasificar' y no cuenta como reinvertido ni como saldo a favor. Es una aproximacion mensual: la nocion por pedido (v_ds_utilidad.reinvertida) vive en feat/dropshipping y
--                                        la sustituye al integrar (ver docs/capital-por-mes.md).
--   utilidad retirada                  : socio_libro (retiro, pago_utilidad, liquidacion_recibida) mas lo retirado en la apertura (3210).
--   fondos de la sociedad en poder     : mayor, cuenta 1150/1160 al cierre del mes; motivo = nota y cliente del movimiento de la cuenta del socio.
--   aportacion neta / diferencia       : aportado (capital + dinero propio como reembolso, por fecha) menos fondos en su poder; diferencia = mayor aportacion neta - la del socio (misma definicion de
--                                        api.socios_aportacion_neta en feat/dropshipping; aqui se calcula por mes).
--   valuacion personal                 : cuenta de capital del socio en el mayor (3110 + 3310 - 3210) mas su 50 % de la utilidad aun no asignada por acta (v04). La suma de los dos es EXACTAMENTE el capital contable.
--   proveedores                        : mayor, cuenta 2110 (Isaac) / 2120 (Karen); positivo = se le debe, negativo = saldo a favor.
-- Identidades (campo `comprobaciones`): ver cada una abajo. Todo es SQL determinista; ningun modelo de IA calcula dinero.

-- Reparto 50/50 con la regla del Estado de resultados: Javier trunca, Angelo recibe el resto.
create or replace function operacion.cap_mitad(p_total bigint, p_socio text) returns bigint
language sql immutable set search_path = ''
as $$ select case p_socio when 'Javier' then p_total / 2 else p_total - p_total / 2 end $$;

-- Saldo de apertura de una cuenta hasta una fecha (misma regla que contabilidad.apertura_saldo, con corte por fecha contable).
create or replace function operacion.cap_apertura(p_cuenta text, p_hasta date) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(case c.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end), 0)::bigint
  from apertura.sesion s join contabilidad.asiento a on a.evento_id = s.evento_id and a.es_apertura and a.fecha_contable <= p_hasta
       join contabilidad.asiento_linea l on l.asiento_id = a.id join contabilidad.cuenta c on c.codigo = l.cuenta
  where s.estado = 'firmada' and l.cuenta = p_cuenta and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)
$$;

-- Existencias de un socio al cierre de una fecha.
create or replace function operacion.cap_stock(p_socio bigint, p_nombre text, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c3110 text := contabilidad.cta_socio(p_socio, 3110); c3310 text := contabilidad.cta_socio(p_socio, 3310); c3210 text := contabilidad.cta_socio(p_socio, 3210);
  c1150 text := contabilidad.cta_socio(p_socio, 1150); c2310 text := contabilidad.cta_socio(p_socio, 2310);
  v_cap_libro bigint; v_cap_puesto bigint; v_reemb bigint; v_fondos bigint;
begin
  v_cap_libro := contabilidad.saldo(c3110, p_fecha) + contabilidad.saldo(c3310, p_fecha) - contabilidad.saldo(c3210, p_fecha);
  v_cap_puesto := coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a where a.socio_id = p_socio and a.clasificacion = 'capital' and a.fecha_neg <= p_fecha), 0)
                  + operacion.cap_apertura(c3110, p_fecha);
  v_reemb := coalesce((select sum(a.monto_cent) from operacion.aportacion_socio a where a.socio_id = p_socio and a.clasificacion = 'reembolsable' and a.fecha_neg <= p_fecha), 0)
             + operacion.cap_apertura(c2310, p_fecha);
  v_fondos := contabilidad.saldo_deudor(c1150, p_fecha);
  return jsonb_build_object('capital_libro_cent', v_cap_libro, 'capital_aportado_cent', v_cap_puesto, 'reembolso_puesto_cent', v_reemb, 'fondos_cent', v_fondos);
end $$;

-- Flujos de un socio dentro de una ventana (por fecha contable o de negocio) y su detalle.
create or replace function operacion.cap_flujos(p_socio bigint, p_nombre text, p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c3110 text := contabilidad.cta_socio(p_socio, 3110); c3210 text := contabilidad.cta_socio(p_socio, 3210);
  v_apo_det jsonb; v_apo bigint; v_ret_det jsonb; v_ret bigint; v_dev bigint; v_rei_det jsonb; v_rei bigint; v_ap_ret bigint;
begin
  -- Aportaciones de capital declaradas: asientos de la cuenta de capital del periodo que NO vienen de un acta (la reinversion se cuenta aparte).
  select coalesce(jsonb_agg(jsonb_build_object('fecha', x.fecha, 'concepto', x.concepto, 'origen', x.origen, 'monto_cent', x.monto, 'fuente', x.fuente) order by x.fecha, x.asiento), '[]'::jsonb),
         coalesce(sum(x.monto), 0)::bigint
    into v_apo_det, v_apo
  from (
    select a.id as asiento, a.fecha_contable as fecha, sum(l.haber_cent - l.debe_cent)::bigint as monto,
           coalesce(case when a.es_apertura then 'Saldo de apertura al corte' end,
                    (select string_agg(distinct ap.concepto, '; ') from operacion.aportacion_socio ap where ap.evento_id = a.evento_id and ap.socio_id = p_socio and ap.clasificacion = 'capital'),
                    a.descripcion) as concepto,
           case when a.es_apertura then 'Apertura'
                else coalesce((select 'Caja: ' || ce.nombre from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo ce on ce.id = m.cuenta_id where m.evento_id = a.evento_id and m.ref_tipo = 'aportacion' limit 1),
                              (select 'Proveedor: ' || pr.nombre from operacion.cuenta_proveedor_mov c join catalogo.proveedor pr on pr.id = c.proveedor_id where c.evento_id = a.evento_id and c.concepto = 'pago_socio' limit 1),
                              'Otro (ver asiento)') end as origen,
           'Mayor, cuenta ' || c3110 || ', asiento ' || a.folio as fuente
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id
    where l.cuenta = c3110 and a.fecha_contable between p_ini and p_fin and e.tipo <> 'cierre_reparto_firmado'
    group by a.id, a.fecha_contable, a.es_apertura, a.evento_id, a.descripcion, a.folio
    having sum(l.haber_cent - l.debe_cent) <> 0
  ) x;

  -- Reinversion decidida en un acta: pertenece al periodo del acta (periodo_fin), no al dia de la firma.
  select coalesce(jsonb_agg(jsonb_build_object('fecha', coalesce(k.periodo_fin, a.fecha_neg), 'concepto', coalesce(k.folio, a.concepto), 'origen', 'Acta de corte', 'monto_cent', a.monto_cent,
                                               'fuente', 'Acta ' || coalesce(k.folio, '(sin folio)')) order by coalesce(k.periodo_fin, a.fecha_neg), a.id), '[]'::jsonb),
         coalesce(sum(a.monto_cent), 0)::bigint
    into v_rei_det, v_rei
  from operacion.aportacion_socio a left join operacion.cierre_reparto k on k.id = a.ref_id
  where a.socio_id = p_socio and a.ref_tipo = 'reinversion' and coalesce(k.periodo_fin, a.fecha_neg) between p_ini and p_fin;

  -- Retiros de utilidad: libro del socio mas lo retirado en la apertura.
  select coalesce(sum(-l.monto_cent), 0)::bigint into v_ret
    from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
   where l.socio_id = p_socio and l.fecha_neg between p_ini and p_fin and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida');
  v_ap_ret := coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                         where l.cuenta = c3210 and a.es_apertura and a.fecha_contable between p_ini and p_fin and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)), 0)::bigint;
  select coalesce(jsonb_agg(jsonb_build_object('fecha', x.fecha, 'concepto', x.concepto, 'origen', x.origen, 'monto_cent', x.monto, 'fuente', x.fuente) order by x.fecha, x.n), '[]'::jsonb) into v_ret_det
  from (
    select l.fecha_neg as fecha, l.id as n, coalesce(nullif(btrim(l.nota), ''), replace(coalesce(o.concepto, l.concepto), '_', ' ')) as concepto,
           'Libro del socio' as origen, -l.monto_cent as monto, 'Libro del socio, movimiento ' || l.id as fuente
    from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
    where l.socio_id = p_socio and l.fecha_neg between p_ini and p_fin and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida')
    union all
    select p_ini, 0, 'Retiros de la apertura', 'Apertura', v_ap_ret, 'Mayor, cuenta ' || c3210 where v_ap_ret <> 0
  ) x;
  v_ret := v_ret + v_ap_ret;
  select coalesce(sum(-l.monto_cent), 0)::bigint into v_dev
    from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
   where l.socio_id = p_socio and l.fecha_neg between p_ini and p_fin and coalesce(o.concepto, l.concepto) = 'pago_devolucion_aportacion';

  return jsonb_build_object('aportaciones_capital_cent', v_apo, 'aportaciones_detalle', v_apo_det, 'reinvertida_acta_cent', v_rei, 'reinvertida_acta_detalle', v_rei_det,
                            'retirada_cent', v_ret, 'retirada_detalle', v_ret_det, 'devoluciones_capital_cent', v_dev);
end $$;

-- Motivo de los fondos de la sociedad en poder de un socio: un renglon por movimiento de su cuenta de fondos (1150/1160) hasta el corte.
create or replace function operacion.cap_fondos_detalle(p_socio bigint, p_fecha date) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('fecha', x.fecha, 'monto_cent', x.monto, 'motivo', x.motivo, 'cliente', x.cliente, 'concepto', x.concepto,
                                               'fuente', 'Mayor, cuenta ' || contabilidad.cta_socio(p_socio, 1150) || ', asiento ' || x.folio) order by x.fecha, x.asiento), '[]'::jsonb)
  from (
    select a.id as asiento, a.folio, a.fecha_contable as fecha, sum(l.debe_cent - l.haber_cent)::bigint as monto,
           coalesce(case when a.es_apertura then 'Saldo de apertura al corte' end, nullif(btrim(m.nota), ''), replace(m.concepto, '_', ' '), a.descripcion) as motivo,
           m.cliente, m.concepto
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
    left join lateral (
      select string_agg(distinct s.nota, '; ') as nota, string_agg(distinct s.concepto, '; ') as concepto,
             string_agg(distinct cl.nombre_canonico, ', ') as cliente
      from operacion.cuenta_socio_mov s left join catalogo.cliente cl on cl.id = coalesce(s.cliente_id, operacion.pago_cliente(s.pago_id))
      where s.evento_id = a.evento_id and s.socio_id = p_socio and s.aplica_a = 'fondos') m on true
    where l.cuenta = contabilidad.cta_socio(p_socio, 1150) and a.fecha_contable <= p_fecha
    group by a.id, a.folio, a.fecha_contable, a.es_apertura, a.descripcion, m.nota, m.concepto, m.cliente
    having sum(l.debe_cent - l.haber_cent) <> 0
  ) x
$$;

-- Utilidad reinvertida en el proveedor (CALCULADA) al cierre de una fecha: total de la sociedad.
create or replace function operacion.cap_reinv_proveedor(p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_favor bigint; v_util bigint; v_ret bigint; v_rei bigint; v_disp bigint; v_resp bigint; v_pc bigint; v_rec bigint;
begin
  select coalesce(sum(greatest(-s.saldo_cent, 0)), 0)::bigint into v_favor from contabilidad.saldos(p_fecha) s where s.codigo in ('2110', '2120');
  -- Por clasificar: TODO lo que un socio pago a un proveedor (no hay marca de destino confirmado en la base): no se cuenta como inventario, saldo a favor reconocido ni utilidad reinvertida
  -- hasta que el dueno confirme su destino. El saldo a favor reconocido de cada proveedor es el que queda SIN contar esos pagos.
  select coalesce(sum(greatest(coalesce(ps.t, 0), 0)), 0)::bigint, coalesce(sum(greatest(-(s.saldo_cent + greatest(coalesce(ps.t, 0), 0)), 0)), 0)::bigint into v_pc, v_rec
    from contabilidad.saldos(p_fecha) s join catalogo.proveedor p on ('Proveedor ' || p.nombre) = s.nombre
    left join lateral (select sum(m.monto_cent) as t from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
                        where m.proveedor_id = p.id and m.fecha_neg <= p_fecha and coalesce(o.concepto, m.concepto) = 'pago_socio') ps on true
   where s.codigo in ('2110', '2120');
  v_util := contabilidad.resultado(p_fecha);
  select coalesce(sum(-l.monto_cent), 0)::bigint into v_ret
    from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
   where l.fecha_neg <= p_fecha and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida');
  select coalesce(sum(a.monto_cent), 0)::bigint into v_rei from operacion.aportacion_socio a left join operacion.cierre_reparto k on k.id = a.ref_id
   where a.ref_tipo = 'reinversion' and coalesce(k.periodo_fin, a.fecha_neg) <= p_fecha;
  v_disp := greatest(v_util - v_ret - v_rei, 0);
  v_resp := least(v_rec, v_disp);
  return jsonb_build_object('saldo_a_favor_cent', v_favor, 'por_clasificar_cent', v_pc, 'saldo_a_favor_reconocido_cent', v_rec, 'utilidad_disponible_cent', v_disp, 'respaldada_cent', v_resp, 'anticipo_cent', v_rec - v_resp);
end $$;

-- Un periodo completo (un mes o el acumulado): por socio, total, proveedores, Balance, Estado de resultados y comprobaciones.
create or replace function operacion.cap_periodo(p_ini date, p_fin date, p_parcial boolean) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record; v_er jsonb; v_bal jsonb; v_ant date := p_ini - 1; v_ini jsonb; v_fin jsonb; v_fl jsonb; v_rp_ini jsonb; v_rp_fin jsonb;
  v_v04_ini bigint; v_v04_fin bigint; v_socios jsonb := '[]'::jsonb; v_fila jsonb;
  v_util bigint; v_rpv bigint; v_rei bigint; v_apo bigint; v_ret bigint; v_dev bigint; v_val_ini bigint; v_val_fin bigint; v_otros bigint;
  v_aportado bigint; v_fondos bigint; v_neta bigint; v_cap bigint;
  v_tot_val bigint := 0; v_tot_val_ini bigint := 0; v_tot_cap bigint := 0; v_tot_neta bigint := 0; v_tot_aportado bigint := 0; v_tot_fondos bigint := 0; v_tot_util bigint := 0;
  v_max_neta bigint; v_prov jsonb := '[]'::jsonb; v_comp jsonb := '[]'::jsonb; v_hay boolean; v_k bigint; v_sum_ret bigint := 0; v_sum_apo bigint := 0; v_sum_rei bigint := 0; v_sum_rpv bigint := 0; v_sum_dev bigint := 0; v_sum_otros bigint := 0;
  v_prov_ledger bigint; v_prov_bal bigint; v_cuadre jsonb; r record;
  v_ant_ini date;
begin
  v_er := contabilidad.estado_resultados(p_ini, p_fin);
  v_bal := contabilidad.balance_general(p_fin);
  v_v04_ini := contabilidad.resultado(v_ant) + contabilidad.saldo('3900', v_ant) + contabilidad.saldo('3990', v_ant);
  v_v04_fin := contabilidad.resultado(p_fin) + contabilidad.saldo('3900', p_fin) + contabilidad.saldo('3990', p_fin);
  v_rp_ini := operacion.cap_reinv_proveedor(v_ant);
  v_rp_fin := operacion.cap_reinv_proveedor(p_fin);
  v_hay := exists (select 1 from contabilidad.asiento a where a.fecha_contable <= p_fin);

  -- Primera pasada: totales de aportacion neta para la diferencia a igualar.
  select max(((operacion.cap_stock(x.id, x.nombre, p_fin)->>'capital_aportado_cent')::bigint + (operacion.cap_stock(x.id, x.nombre, p_fin)->>'reembolso_puesto_cent')::bigint
              - greatest((operacion.cap_stock(x.id, x.nombre, p_fin)->>'fondos_cent')::bigint, 0)))
    into v_max_neta from catalogo.socio x where x.nombre in ('Angelo', 'Javier');

  for s in select id, nombre from catalogo.socio where nombre in ('Angelo', 'Javier') order by nombre loop
    v_ini := operacion.cap_stock(s.id, s.nombre, v_ant);
    v_fin := operacion.cap_stock(s.id, s.nombre, p_fin);
    v_fl := operacion.cap_flujos(s.id, s.nombre, p_ini, p_fin);
    v_util := case s.nombre when 'Angelo' then (v_er->>'angelo_cent')::bigint else (v_er->>'javier_cent')::bigint end;
    v_rpv := operacion.cap_mitad((v_rp_fin->>'respaldada_cent')::bigint, s.nombre) - operacion.cap_mitad((v_rp_ini->>'respaldada_cent')::bigint, s.nombre);
    v_rei := (v_fl->>'reinvertida_acta_cent')::bigint; v_apo := (v_fl->>'aportaciones_capital_cent')::bigint; v_ret := (v_fl->>'retirada_cent')::bigint; v_dev := (v_fl->>'devoluciones_capital_cent')::bigint;
    v_val_ini := (v_ini->>'capital_libro_cent')::bigint + operacion.cap_mitad(v_v04_ini, s.nombre);
    v_val_fin := (v_fin->>'capital_libro_cent')::bigint + operacion.cap_mitad(v_v04_fin, s.nombre);
    v_otros := v_val_fin - (v_val_ini + v_apo + v_util - v_ret - v_dev);
    v_cap := (v_fin->>'capital_aportado_cent')::bigint;
    v_fondos := greatest((v_fin->>'fondos_cent')::bigint, 0);
    v_aportado := v_cap + (v_fin->>'reembolso_puesto_cent')::bigint;
    v_neta := v_aportado - v_fondos;
    v_tot_val := v_tot_val + v_val_fin; v_tot_val_ini := v_tot_val_ini + v_val_ini; v_tot_cap := v_tot_cap + v_cap; v_tot_neta := v_tot_neta + v_neta;
    v_tot_aportado := v_tot_aportado + v_aportado; v_tot_fondos := v_tot_fondos + v_fondos; v_tot_util := v_tot_util + v_util;
    v_sum_ret := v_sum_ret + v_ret; v_sum_apo := v_sum_apo + v_apo; v_sum_rei := v_sum_rei + v_rei; v_sum_rpv := v_sum_rpv + v_rpv; v_sum_dev := v_sum_dev + v_dev; v_sum_otros := v_sum_otros + v_otros;
    v_fila := jsonb_build_object('socio', s.nombre,
      'valuacion_inicial_cent', v_val_ini, 'aportaciones_capital_cent', v_apo, 'aportaciones_detalle', v_fl->'aportaciones_detalle',
      'utilidad_generada_cent', v_util,
      'utilidad_reinvertida_acta_cent', v_rei, 'utilidad_reinvertida_acta_detalle', v_fl->'reinvertida_acta_detalle',
      'utilidad_reinvertida_proveedor_cent', v_rpv, 'utilidad_reinvertida_cent', v_rei + v_rpv,
      'utilidad_retirada_cent', v_ret, 'utilidad_retirada_detalle', v_fl->'retirada_detalle', 'devoluciones_capital_cent', v_dev,
      'utilidad_retenida_cent', v_util - v_ret,
      'otros_cent', v_otros, 'valuacion_cent', v_val_fin,
      'fondos_en_poder_cent', v_fondos, 'fondos_detalle', operacion.cap_fondos_detalle(s.id, p_fin),
      'capital_aportado_acum_cent', v_cap, 'reembolso_puesto_acum_cent', (v_fin->>'reembolso_puesto_cent')::bigint, 'aportado_cent', v_aportado,
      'aportacion_neta_cent', v_neta, 'diferencia_a_igualar_cent', v_max_neta - v_neta);
    v_socios := v_socios || v_fila;
  end loop;

  -- Participaciones: en libros (valuacion) contra aportaciones de capital acumuladas (en puntos base, o null sin base).
  select coalesce(jsonb_agg(x.f || jsonb_build_object(
      'pct_valuacion_bp', case when v_tot_val > 0 then negocio.redondear_medio_arriba(10000 * (x.f->>'valuacion_cent')::bigint, v_tot_val) end,
      'pct_capital_bp', case when v_tot_cap > 0 then negocio.redondear_medio_arriba(10000 * (x.f->>'capital_aportado_acum_cent')::bigint, v_tot_cap) end,
      'pct_aportacion_neta_bp', case when v_tot_neta > 0 then negocio.redondear_medio_arriba(10000 * (x.f->>'aportacion_neta_cent')::bigint, v_tot_neta) end) order by x.f->>'socio'), '[]'::jsonb)
    into v_socios from jsonb_array_elements(v_socios) x(f);

  -- Proveedores: positivo = se le debe; negativo = saldo a favor.
  for r in select c.codigo, c.nombre, p.nombre as proveedor, p.id as proveedor_id from contabilidad.cuenta c join catalogo.proveedor p on ('Proveedor ' || p.nombre) = c.nombre where c.codigo in ('2110', '2120') order by c.codigo loop
    v_prov := v_prov || jsonb_build_object('proveedor', r.proveedor, 'cuenta', r.codigo,
      'saldo_cent', contabilidad.saldo(r.codigo, p_fin),
      'saldo_inicial_cent', contabilidad.saldo(r.codigo, v_ant),
      'compras_cent', (select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where l.cuenta = r.codigo and a.fecha_contable between p_ini and p_fin),
      'pagos_cent', (select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where l.cuenta = r.codigo and a.fecha_contable between p_ini and p_fin),
      'por_clasificar_cent', (select greatest(coalesce(sum(m.monto_cent), 0), 0)::bigint from operacion.cuenta_proveedor_mov m left join operacion.cuenta_proveedor_mov o on o.id = m.reversa_de
                               where m.proveedor_id = r.proveedor_id and m.fecha_neg <= p_fin and coalesce(o.concepto, m.concepto) = 'pago_socio'),
      'fuente', 'Mayor, cuenta ' || r.codigo);
    v_prov := jsonb_set(v_prov, array[(jsonb_array_length(v_prov) - 1)::text], (v_prov->(jsonb_array_length(v_prov) - 1)) || jsonb_build_object(
      'saldo_sin_clasificar_cent', (v_prov->(jsonb_array_length(v_prov) - 1)->>'saldo_cent')::bigint + (v_prov->(jsonb_array_length(v_prov) - 1)->>'por_clasificar_cent')::bigint,
      'estado', case when (v_prov->(jsonb_array_length(v_prov) - 1)->>'saldo_cent')::bigint + (v_prov->(jsonb_array_length(v_prov) - 1)->>'por_clasificar_cent')::bigint > 0 then 'se_debe'
                     when (v_prov->(jsonb_array_length(v_prov) - 1)->>'saldo_cent')::bigint + (v_prov->(jsonb_array_length(v_prov) - 1)->>'por_clasificar_cent')::bigint < 0 then 'a_favor' else 'sin_saldo' end));
  end loop;

  v_k := (v_bal->>'total_capital_cent')::bigint;
  v_prov_ledger := coalesce((select sum((x->>'saldo_cent')::bigint) from jsonb_array_elements(v_prov) x), 0);
  v_prov_bal := coalesce((select sum((x->>'monto_cent')::bigint) from jsonb_array_elements(v_bal->'pasivo') x where x->>'codigo' in ('2110', '2120')), 0)
                - coalesce((select sum((x->>'monto_cent')::bigint) from jsonb_array_elements(v_bal->'activo') x where x->>'codigo' in ('2110', '2120')), 0);

  v_comp := jsonb_build_array(
    jsonb_build_object('id', 'K1', 'nombre', 'La suma de las valuaciones personales es el capital contable del Balance', 'a_nombre', 'Suma de valuaciones personales', 'a_cent', v_tot_val,
                       'b_nombre', 'Capital contable (Balance)', 'b_cent', v_k, 'ok', v_tot_val = v_k),
    jsonb_build_object('id', 'K2', 'nombre', 'Valuacion menos deudas es el capital contable (activo = pasivo + capital)', 'a_nombre', 'Activo menos pasivo', 'a_cent', (v_bal->>'total_activo_cent')::bigint - (v_bal->>'total_pasivo_cent')::bigint,
                       'b_nombre', 'Capital contable (Balance)', 'b_cent', v_k, 'ok', coalesce((v_bal->>'cuadra')::boolean, false)),
    jsonb_build_object('id', 'K3', 'nombre', 'La utilidad generada de los socios es la utilidad neta del Estado de resultados', 'a_nombre', 'Suma de la utilidad de los socios', 'a_cent', v_tot_util,
                       'b_nombre', 'Utilidad neta (Estado de resultados)', 'b_cent', (v_er->>'utilidad_neta_cent')::bigint, 'ok', v_tot_util = (v_er->>'utilidad_neta_cent')::bigint),
    jsonb_build_object('id', 'K4', 'nombre', 'Los fondos en poder de los socios son la cuenta 1150 + 1160 del Balance', 'a_nombre', 'Fondos en poder (tabla)', 'a_cent', v_tot_fondos,
                       'b_nombre', 'Cuentas 1150 y 1160 (Balance)', 'b_cent', coalesce((select sum((x->>'monto_cent')::bigint) from jsonb_array_elements(v_bal->'activo') x where x->>'codigo' in ('1150', '1160')), 0),
                       'ok', v_tot_fondos = coalesce((select sum((x->>'monto_cent')::bigint) from jsonb_array_elements(v_bal->'activo') x where x->>'codigo' in ('1150', '1160')), 0)),
    jsonb_build_object('id', 'K5', 'nombre', 'La cuenta con proveedores de la tabla es la del Balance (pasivo menos saldo a favor)', 'a_nombre', 'Saldo por proveedor (tabla)', 'a_cent', v_prov_ledger,
                       'b_nombre', 'Proveedores en el Balance', 'b_cent', v_prov_bal, 'ok', v_prov_ledger = v_prov_bal),
    jsonb_build_object('id', 'K6', 'nombre', 'La suma de las aportaciones netas es lo aportado menos los fondos en poder', 'a_nombre', 'Suma de aportaciones netas', 'a_cent', v_tot_neta,
                       'b_nombre', 'Aportado menos fondos en poder', 'b_cent', v_tot_aportado - v_tot_fondos, 'ok', v_tot_neta = v_tot_aportado - v_tot_fondos),
    jsonb_build_object('id', 'K7', 'nombre', 'La valuacion del periodo se explica con aportaciones, utilidad y retiros (otros y redondeo no supera un centavo por socio)', 'a_nombre', 'Valuacion inicial + aportaciones + utilidad - retiros - devoluciones',
                       'a_cent', v_tot_val_ini + v_sum_apo + v_tot_util - v_sum_ret - v_sum_dev, 'b_nombre', 'Valuacion final', 'b_cent', v_tot_val, 'ok', abs(v_sum_otros) <= 2));

  -- Aportado y fondos contra los auxiliares operativos, solo cuando el corte es hoy o posterior (los auxiliares no tienen corte por fecha).
  if p_fin >= negocio.hoy() then
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('id', 'K8', 'nombre', 'Aportacion neta de la tabla contra el auxiliar de socios (aportado menos fondos en su poder)',
      'a_nombre', 'Suma de aportaciones netas (tabla)', 'a_cent', v_tot_neta,
      'b_nombre', 'Auxiliar de socios', 'b_cent', (select coalesce(sum(operacion.aportado_socio(x.id) - greatest(operacion.saldo_socio(x.id, 'fondos'), 0)), 0)::bigint from catalogo.socio x where x.nombre in ('Angelo', 'Javier')),
      'ok', v_tot_neta = (select coalesce(sum(operacion.aportado_socio(x.id) - greatest(operacion.saldo_socio(x.id, 'fondos'), 0)), 0)::bigint from catalogo.socio x where x.nombre in ('Angelo', 'Javier'))));
    v_cuadre := operacion.cuadre_socios();
    v_comp := v_comp || jsonb_build_array(jsonb_build_object('id', 'K9', 'nombre', 'Libro conciliado (identidades de Socios)', 'a_nombre', 'Identidades que fallan', 'a_cent', coalesce((v_cuadre->>'fallas')::bigint, 0),
      'b_nombre', 'Esperado', 'b_cent', 0, 'unidad', 'n', 'ok', coalesce((v_cuadre->>'libro_conciliado')::boolean, false)));
  end if;

  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'parcial', p_parcial, 'hay_movimientos', v_hay,
    'socios', v_socios,
    'total', jsonb_build_object('valuacion_inicial_cent', v_tot_val_ini, 'aportaciones_capital_cent', v_sum_apo, 'utilidad_generada_cent', v_tot_util,
       'utilidad_reinvertida_acta_cent', v_sum_rei, 'utilidad_reinvertida_proveedor_cent', v_sum_rpv, 'utilidad_reinvertida_cent', v_sum_rei + v_sum_rpv,
       'utilidad_retirada_cent', v_sum_ret, 'devoluciones_capital_cent', v_sum_dev, 'utilidad_retenida_cent', v_tot_util - v_sum_ret, 'otros_cent', v_sum_otros, 'valuacion_cent', v_tot_val,
       'fondos_en_poder_cent', v_tot_fondos, 'capital_aportado_acum_cent', v_tot_cap, 'aportado_cent', v_tot_aportado, 'aportacion_neta_cent', v_tot_neta),
    'proveedores', v_prov,
    'anticipo_proveedor_cent', (v_rp_fin->>'anticipo_cent')::bigint, 'saldo_a_favor_reconocido_cent', (v_rp_fin->>'saldo_a_favor_reconocido_cent')::bigint, 'por_clasificar_cent', (v_rp_fin->>'por_clasificar_cent')::bigint, 'saldo_a_favor_proveedores_cent', (v_rp_fin->>'saldo_a_favor_cent')::bigint,
    'balance', jsonb_build_object('total_activo_cent', (v_bal->>'total_activo_cent')::bigint, 'total_pasivo_cent', (v_bal->>'total_pasivo_cent')::bigint, 'total_capital_cent', v_k,
                                  'cuadra', (v_bal->>'cuadra')::boolean),
    'estado_resultados', jsonb_build_object('utilidad_neta_cent', (v_er->>'utilidad_neta_cent')::bigint, 'angelo_cent', (v_er->>'angelo_cent')::bigint, 'javier_cent', (v_er->>'javier_cent')::bigint,
                                            'con_movimientos', (v_er->>'con_movimientos')::boolean),
    'comprobaciones', v_comp);
end $$;

-- Lectura publica: un renglon por mes (de p_desde a p_hasta) y el acumulado del rango. Solo socios.
create or replace function api.capital_por_mes(p_desde date default null, p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hasta date := coalesce(p_hasta, negocio.hoy()); v_desde date; v_m date; v_ini date; v_fin date; v_meses jsonb := '[]'::jsonb; v_n int := 0; v_fuentes jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_desde := coalesce(p_desde, (select min(a.fecha_contable) from contabilidad.asiento a), v_hasta);
  if v_desde > v_hasta then raise exception 'rango de fechas invalido' using errcode = '22023'; end if;
  if v_hasta - v_desde > 1830 then raise exception 'el rango no puede pasar de cinco anos' using errcode = '22023'; end if;
  v_m := date_trunc('month', v_desde)::date;
  while v_m <= v_hasta and v_n < 61 loop
    v_ini := greatest(v_m, v_desde);
    v_fin := least((v_m + interval '1 month - 1 day')::date, v_hasta);
    v_meses := v_meses || jsonb_build_object('mes', to_char(v_m, 'YYYY-MM'), 'periodo', operacion.cap_periodo(v_ini, v_fin, v_ini <> v_m or v_fin <> (v_m + interval '1 month - 1 day')::date));
    v_m := (v_m + interval '1 month')::date; v_n := v_n + 1;
  end loop;
  v_fuentes := jsonb_build_object(
    'aportaciones_capital', 'Mayor, cuentas 3110 y 3120 (haber menos debe) del periodo, sin el capital que nace de un acta de corte con reinversion. Detalle por asiento con su concepto y origen (caja o proveedor).',
    'utilidad_generada', 'Estado de resultados del periodo (utilidad neta), repartida 50/50 con la misma regla de redondeo del Estado de resultados.',
    'utilidad_reinvertida_acta', 'Actas de corte firmadas con reinversion: aportacion de capital con origen acta, ubicada en el periodo del acta.',
    'utilidad_reinvertida_proveedor', 'Calculada: saldo a favor con proveedores (cuentas 2110 y 2120 con saldo deudor), limitado por la utilidad acumulada que aun no se retira ni se reinvierte por acta; lo que excede es anticipo al proveedor, no utilidad.',
    'utilidad_retirada', 'Libro del socio (retiro, pago de utilidad, liquidacion recibida) y lo retirado en la apertura (cuentas 3210 y 3220).',
    'fondos_en_poder', 'Mayor, cuentas 1150 y 1160 al cierre del mes; motivo y cliente de cada movimiento de la cuenta del socio.',
    'aportacion_neta', 'Capital aportado (apertura, aportaciones declaradas y reinversion por acta) mas dinero propio puesto como reembolso, menos los fondos de la sociedad en su poder.',
    'diferencia_a_igualar', 'La mayor aportacion neta menos la aportacion neta del socio: lo que le falta para igualar porque ambos seguiran aportando por partes iguales.',
    'valuacion', 'Cuenta de capital del socio en el mayor (3110 + 3310 - 3210) mas su 50 % de la utilidad aun no asignada por acta. La suma de los dos es el capital contable del Balance.',
    'participacion', 'Valuacion del socio entre la valuacion total, contra su parte de las aportaciones de capital acumuladas.',
    'por_clasificar', 'Todo lo que un socio pago a un proveedor y cuyo destino aun no confirma el dueno: no se cuenta como inventario, saldo a favor ni utilidad reinvertida hasta clasificarlo. El saldo del proveedor se muestra con y sin esos pagos.',
    'proveedores', 'Mayor, cuentas 2110 (Isaac) y 2120 (Karen): positivo se le debe al proveedor; negativo, saldo a favor de la sociedad. El saldo contable incluye los pagos por clasificar; el reconocido no.');
  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'meses', v_meses, 'acumulado', operacion.cap_periodo(v_desde, v_hasta, false), 'fuentes', v_fuentes);
end $$;

-- Privilegios: solo lectura de socios autenticados (la funcion ademas exige rol socio). Los auxiliares de operacion.* no se exponen.
revoke execute on function api.capital_por_mes(date, date) from public, anon;
grant execute on function api.capital_por_mes(date, date) to authenticated;
revoke execute on function operacion.cap_mitad(bigint, text), operacion.cap_apertura(text, date), operacion.cap_stock(bigint, text, date), operacion.cap_flujos(bigint, text, date, date),
  operacion.cap_fondos_detalle(bigint, date), operacion.cap_reinv_proveedor(date), operacion.cap_periodo(date, date, boolean) from public, anon, authenticated;
