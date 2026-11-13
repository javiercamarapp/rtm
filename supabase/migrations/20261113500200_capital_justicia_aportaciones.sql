-- Capital por mes, ajuste de la decision del dueno (13-nov): JUSTICIA EN EL DINERO INVERTIDO, no valuaciones forzadas a ser iguales.
--  * La participacion es siempre 50/50 (utilidad y propiedad): participacion_bp = 5000. Aportar mas NO da mas participacion y se eliminan los porcentajes de valuacion contra aportaciones.
--  * Valuacion personal de cada socio = capital aportado + su 50 % de la utilidad - fondos de la sociedad en su poder (valuacion_cent). Converge a ser igual cuando se igualan las aportaciones.
--    valuacion_libro_cent es esa misma cifra ANTES de restar los fondos en su poder (alimenta K1 y K7). valuacion_si_igualados_cent es informativa: su valuacion si pusiera la diferencia a igualar.
--  * Aportacion neta, diferencia a igualar y turno (turno_aportar = socio con menos aportacion neta; null = igualados). La diferencia NO es una deuda ni un reembolso a favor del otro:
--    se resuelve con las siguientes aportaciones del que tiene menos.
--  * Reinversion IGUAL: reinversion_igual / reinversion_alerta comparan lo que cada socio reinvirtio por acta en el periodo; api.acta_reinversion_sugerida da el monto comun sugerido para un acta.
-- SOLO LECTURA y aditiva: create or replace de operacion.cap_periodo y api.capital_por_mes (conservan sus permisos) y una lectura nueva.

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
  v_min_neta bigint; v_fondos_raw bigint; v_neto bigint; v_dif bigint; v_turno text; v_igual bigint; v_tot_igual bigint := 0; v_tot_pers bigint := 0; v_rei_a bigint; v_rei_j bigint;
begin
  v_er := contabilidad.estado_resultados(p_ini, p_fin);
  v_bal := contabilidad.balance_general(p_fin);
  v_v04_ini := contabilidad.resultado(v_ant) + contabilidad.saldo('3900', v_ant) + contabilidad.saldo('3990', v_ant);
  v_v04_fin := contabilidad.resultado(p_fin) + contabilidad.saldo('3900', p_fin) + contabilidad.saldo('3990', p_fin);
  v_rp_ini := operacion.cap_reinv_proveedor(v_ant);
  v_rp_fin := operacion.cap_reinv_proveedor(p_fin);
  v_hay := exists (select 1 from contabilidad.asiento a where a.fecha_contable <= p_fin);

  -- Primera pasada: aportaciones netas (mayor y menor), fondos en poder y capital contable neto de la sociedad.
  select max(x.neta), min(x.neta), coalesce(sum(x.fondos_raw), 0)::bigint into v_max_neta, v_min_neta, v_fondos_raw
    from (select (l.st->>'capital_aportado_cent')::bigint + (l.st->>'reembolso_puesto_cent')::bigint - greatest((l.st->>'fondos_cent')::bigint, 0) as neta, (l.st->>'fondos_cent')::bigint as fondos_raw
            from catalogo.socio s2 cross join lateral (select operacion.cap_stock(s2.id, s2.nombre, p_fin) as st) l where s2.nombre in ('Angelo', 'Javier')) x;
  v_dif := coalesce(v_max_neta - v_min_neta, 0);
  -- Capital contable neto de la sociedad (capital contable del Balance menos los fondos de la sociedad en poder de socios); informativo.
  v_neto := (v_bal->>'total_capital_cent')::bigint - v_fondos_raw;

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
    v_igual := v_val_fin - v_fondos + (v_max_neta - v_neta);
    v_tot_igual := v_tot_igual + v_igual; v_tot_pers := v_tot_pers + (v_val_fin - v_fondos);
    v_tot_val := v_tot_val + v_val_fin; v_tot_val_ini := v_tot_val_ini + v_val_ini; v_tot_cap := v_tot_cap + v_cap; v_tot_neta := v_tot_neta + v_neta;
    v_tot_aportado := v_tot_aportado + v_aportado; v_tot_fondos := v_tot_fondos + v_fondos; v_tot_util := v_tot_util + v_util;
    v_sum_ret := v_sum_ret + v_ret; v_sum_apo := v_sum_apo + v_apo; v_sum_rei := v_sum_rei + v_rei; v_sum_rpv := v_sum_rpv + v_rpv; v_sum_dev := v_sum_dev + v_dev; v_sum_otros := v_sum_otros + v_otros;
    v_fila := jsonb_build_object('socio', s.nombre,
      'valuacion_libro_inicial_cent', v_val_ini, 'aportaciones_capital_cent', v_apo, 'aportaciones_detalle', v_fl->'aportaciones_detalle',
      'utilidad_generada_cent', v_util,
      'utilidad_reinvertida_acta_cent', v_rei, 'utilidad_reinvertida_acta_detalle', v_fl->'reinvertida_acta_detalle',
      'utilidad_reinvertida_proveedor_cent', v_rpv, 'utilidad_reinvertida_cent', v_rei + v_rpv,
      'utilidad_retirada_cent', v_ret, 'utilidad_retirada_detalle', v_fl->'retirada_detalle', 'devoluciones_capital_cent', v_dev,
      'utilidad_retenida_cent', v_util - v_ret,
      'otros_cent', v_otros, 'valuacion_libro_cent', v_val_fin, 'valuacion_cent', v_val_fin - v_fondos, 'valuacion_si_igualados_cent', v_igual, 'participacion_bp', 5000,
      'fondos_en_poder_cent', v_fondos, 'fondos_detalle', operacion.cap_fondos_detalle(s.id, p_fin),
      'capital_aportado_acum_cent', v_cap, 'reembolso_puesto_acum_cent', (v_fin->>'reembolso_puesto_cent')::bigint, 'aportado_cent', v_aportado,
      'aportacion_neta_cent', v_neta, 'diferencia_a_igualar_cent', v_max_neta - v_neta, 'le_toca_aportar', (v_dif > 0 and v_neta = v_min_neta));
    v_socios := v_socios || v_fila;
  end loop;

  -- Turno de aportar: el socio con menos aportacion neta (null si estan igualados). La diferencia NO es una deuda ni un reembolso a favor del otro: se resuelve con las siguientes aportaciones del que tiene menos.
  if v_dif > 0 then
    select x->>'socio' into v_turno from jsonb_array_elements(v_socios) x order by (x->>'aportacion_neta_cent')::bigint asc, x->>'socio' limit 1;
  end if;

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
    jsonb_build_object('id', 'K1', 'nombre', 'La suma de las valuaciones personales mas los fondos en poder de los socios es el capital contable del Balance', 'a_nombre', 'Valuaciones personales + fondos en poder', 'a_cent', v_tot_pers + v_tot_fondos,
                       'b_nombre', 'Capital contable (Balance)', 'b_cent', v_k, 'ok', v_tot_pers + v_tot_fondos = v_k),
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

  -- Reinversion igual: lo que cada socio reinvirtio por acta en el periodo debe ser lo mismo (alerta informativa si no).
  v_rei_a := coalesce((select (x->>'utilidad_reinvertida_acta_cent')::bigint from jsonb_array_elements(v_socios) x where x->>'socio' = 'Angelo'), 0);
  v_rei_j := coalesce((select (x->>'utilidad_reinvertida_acta_cent')::bigint from jsonb_array_elements(v_socios) x where x->>'socio' = 'Javier'), 0);

  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'parcial', p_parcial, 'hay_movimientos', v_hay,
    'socios', v_socios, 'turno_aportar', v_turno, 'diferencia_a_igualar_cent', v_dif, 'igualados', v_dif = 0, 'capital_contable_neto_cent', v_neto,
    'reinversion_igual', v_rei_a = v_rei_j, 'reinversion_acta_angelo_cent', v_rei_a, 'reinversion_acta_javier_cent', v_rei_j,
    'nota_igualacion', 'La participacion es siempre 50/50. Aportar mas no da mas participacion: la diferencia a igualar no es una deuda ni un reembolso a favor del otro; se resuelve con las siguientes aportaciones del que tiene menos, y asi se busca que ambos tengan el mismo dinero invertido.',
    'total', jsonb_build_object('valuacion_libro_inicial_cent', v_tot_val_ini, 'aportaciones_capital_cent', v_sum_apo, 'utilidad_generada_cent', v_tot_util,
       'utilidad_reinvertida_acta_cent', v_sum_rei, 'utilidad_reinvertida_proveedor_cent', v_sum_rpv, 'utilidad_reinvertida_cent', v_sum_rei + v_sum_rpv,
       'utilidad_retirada_cent', v_sum_ret, 'devoluciones_capital_cent', v_sum_dev, 'utilidad_retenida_cent', v_tot_util - v_sum_ret, 'otros_cent', v_sum_otros, 'valuacion_libro_cent', v_tot_val, 'valuacion_cent', v_tot_pers, 'valuacion_si_igualados_cent', v_tot_igual,
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
    'valuacion', 'Valuacion personal: capital aportado del socio (cuenta 3110 + 3310 - 3210 del mayor) mas su 50 % de la utilidad aun sin acta, menos los fondos de la sociedad en su poder. La suma de las dos mas los fondos es el capital contable del Balance. Converge a ser igual cuando se igualan las aportaciones.',
    'participacion', 'La participacion es siempre 50/50 (utilidad y propiedad); aportar mas no da mas participacion.',
    'turno', 'Le toca aportar el siguiente pago al socio con menos aportacion neta, por la diferencia a igualar. Si ambos aportan lo mismo, estan igualados. No es una deuda ni un reembolso a favor del otro.',
    'valuacion_si_igualados', 'Informativa: la valuacion del socio mas lo que le falta para igualar las aportaciones.',
    'reinversion_igual', 'Se busca reinvertir lo mismo cada mes entre los dos: en el acta la reinversion sugerida es el mismo monto para cada socio (el maximo comun que permita la utilidad de cada uno), editable por ambos antes de firmar.',
    'por_clasificar', 'Todo lo que un socio pago a un proveedor y cuyo destino aun no confirma el dueno: no se cuenta como inventario, saldo a favor ni utilidad reinvertida hasta clasificarlo. El saldo del proveedor se muestra con y sin esos pagos.',
    'proveedores', 'Mayor, cuentas 2110 (Isaac) y 2120 (Karen): positivo se le debe al proveedor; negativo, saldo a favor de la sociedad. El saldo contable incluye los pagos por clasificar; el reconocido no.');
  return jsonb_build_object('desde', v_desde, 'hasta', v_hasta, 'meses', v_meses, 'acumulado', operacion.cap_periodo(v_desde, v_hasta, false), 'fuentes', v_fuentes);
end $$;



-- Reinversion sugerida para un acta: el MISMO monto para cada socio, por omision el maximo comun que permita la utilidad disponible de cada uno (utilidad menos anticipos del periodo, sin retiros).
-- Lectura para el acta de corte y para 'Sugerido para el acta'; la decision final la editan y firman los dos.
create or replace function api.acta_reinversion_sugerida(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_c jsonb; v_a bigint; v_j bigint; v_comun bigint;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_ini is null or p_fin is null or p_fin < p_ini then raise exception 'periodo invalido' using errcode = '22023'; end if;
  v_c := operacion.cascada_periodo(p_ini, p_fin);
  v_a := greatest((v_c->'por_socio'->'Angelo'->>'utilidad_cent')::bigint - (v_c->'por_socio'->'Angelo'->>'anticipo_cent')::bigint, 0);
  v_j := greatest((v_c->'por_socio'->'Javier'->>'utilidad_cent')::bigint - (v_c->'por_socio'->'Javier'->>'anticipo_cent')::bigint, 0);
  v_comun := least(v_a, v_j);
  return jsonb_build_object('ini', p_ini, 'fin', p_fin, 'monto_comun_cent', v_comun,
    'por_socio', jsonb_build_object('Angelo', jsonb_build_object('disponible_cent', v_a, 'reinvierte_sugerido_cent', v_comun), 'Javier', jsonb_build_object('disponible_cent', v_j, 'reinvierte_sugerido_cent', v_comun)),
    'regla', 'Cada mes reinvierten lo mismo: el monto comun es el maximo que permite la utilidad disponible de cada socio; se puede editar antes de firmar.');
end $$;

revoke execute on function api.acta_reinversion_sugerida(date, date) from public, anon;
grant execute on function api.acta_reinversion_sugerida(date, date) to authenticated;
