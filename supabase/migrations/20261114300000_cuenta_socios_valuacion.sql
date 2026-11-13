-- Cuenta de socios por VALUACION (pedido del dueno, 13-nov). Migracion ADITIVA: solo lecturas (sin tablas, sin cambios de reglas de dinero, sin DROP).
--   * operacion.cuenta_socios_valuacion(p_hasta): UNA fuente para /socios, Inicio (TU VALUACION), Balance (capital contable por socio), valuacion y reportes.
--   * api.cuenta_socios_valuacion(p_hasta): lectura solo de socios (exigir_rol dentro; sin GRANT a anon ni PUBLIC).
--
-- DEFINICION UNICA (no recalcula nada: reutiliza operacion.cap_periodo, la misma funcion de api.capital_por_mes y del historial personal):
--   valuacion personal = capital aportado + utilidades acumuladas - retirado - fondos de la sociedad en su poder
--     * capital aportado        = cap_periodo.capital_aportado_acum_cent (aportaciones declaradas, reinversion por acta y apertura)
--     * retirado                = retiros de utilidad + devolucion de aportaciones (la UNICA definicion: cap_flujos / operacion.retirado_socio)
--     * utilidades acumuladas   = valuacion del libro + retirado - capital aportado = su 50 % de toda la utilidad generada que ni se retiro ni se capitalizo por acta.
--                                 Sube con cada utilidad y baja solo con retiros (la reinversion por acta la mueve a capital aportado).
--     * valuacion del libro     = cuenta 3110/3120 + 3310/3320 - 3210/3220 + su 50 % del resultado sin asignar (cuentas 4-7 + 3900 + 3990), con redondeo a favor de quien paga (cap_mitad).
--   IDENTIDAD DE CUADRE ELEGIDA: suma de las valuaciones del libro (capital + utilidades - retirado, por socio) = capital contable del Balance (3110..3990 + resultado 4-7);
--     equivalente a: valuaciones personales + fondos de la sociedad en poder de socios = activo - pasivo. Con los datos reales: 154,832.30 + 106,910.39 + 35,475.00 = 297,217.69.
--   Diferencia de valuacion X = valuacion del mayor - valuacion del menor. Diferencia de aportacion Y = aportacion neta mayor - menor (cap_periodo.diferencia_a_igualar_cent).
--     Con utilidades 50/50 y retiros iguales, X = Y. Difieren solo si los retiros son desiguales (X = Y - diferencia de retiros) o si las utilidades acumuladas difieren (acta desigual).
--     La accion que se muestra es la que IGUALA VALUACIONES (aportar X): sube la valuacion de quien tiene menos exactamente en X.
--   Retiros: 'siempre nos pagamos lo mismo'. Si los retirados difieren hay alerta y la diferencia a igualar en retiros.
--   Proveedores: posicion del Mayor (2110 Isaac, 2120 Karen: positivo se debe). Los pedidos de Angelo a costo enviados (socio_a_costo) estan DENTRO de esa cuenta pero los reembolsa el socio:
--     se muestran aparte ('pedidos del socio a costo') y la deuda de la empresa es el saldo del Mayor menos esa parte.
--     El desglose por proveedor sale de operacion.posicion_proveedor (migracion 20261114200000, una sola posicion con el proveedor): se_debe, pedidos del socio a costo y deuda de la empresa.

create function operacion.cuenta_socios_valuacion(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy();
  v_hasta date := least(coalesce(p_hasta, negocio.hoy()), negocio.hoy());
  v_primera date; v_cap jsonb; v_socios jsonb := '[]'::jsonb; x jsonb; v_fila jsonb;
  v_cap_acum bigint; v_ret bigint; v_util_acum bigint; v_lib bigint; v_fondos bigint; v_val bigint;
  v_t_cap bigint := 0; v_t_util bigint := 0; v_t_ret bigint := 0; v_t_fondos bigint := 0; v_t_lib bigint := 0; v_t_val bigint := 0;
  v_mayor text; v_menor text; v_vmax bigint; v_vmin bigint; v_x bigint; v_y bigint; v_ret_a bigint; v_ret_j bigint; v_util_a bigint; v_util_j bigint;
  v_bal jsonb; v_ident jsonb; v_k jsonb; v_serie jsonb := '[]'::jsonb; v_m date; v_fin date; v_ini date; v_p jsonb; r jsonb; v_acum jsonb := '{}'::jsonb; v_n int := 0;
  v_prov jsonb; v_prov_total bigint := 0; v_prov_fav bigint := 0; v_socio_costo bigint := null; v_deuda_emp bigint := null; v_hay boolean; v_k1 jsonb; v_k3 jsonb; v_cons_neta bigint;
begin
  select min(a.fecha_contable) into v_primera from contabilidad.asiento a;
  v_primera := least(coalesce(v_primera, v_hasta), v_hasta);
  v_cap := operacion.cap_periodo(v_primera, v_hasta, false);
  v_hay := (v_cap ->> 'hay_movimientos')::boolean;

  for x in select value from jsonb_array_elements(v_cap -> 'socios') loop
    v_cap_acum := (x ->> 'capital_aportado_acum_cent')::bigint;
    v_ret := (x ->> 'utilidad_retirada_cent')::bigint + (x ->> 'devoluciones_capital_cent')::bigint;
    v_lib := (x ->> 'valuacion_libro_cent')::bigint;
    v_fondos := (x ->> 'fondos_en_poder_cent')::bigint;
    v_util_acum := v_lib + v_ret - v_cap_acum;
    v_val := v_cap_acum + v_util_acum - v_ret - v_fondos;   -- = valuacion_cent de cap_periodo por construccion (se comprueba abajo)
    v_fila := jsonb_build_object('socio', x ->> 'socio',
      'capital_aportado_cent', v_cap_acum, 'utilidades_acumuladas_cent', v_util_acum, 'retirado_cent', v_ret,
      'retirado_utilidad_cent', (x ->> 'utilidad_retirada_cent')::bigint, 'devoluciones_capital_cent', (x ->> 'devoluciones_capital_cent')::bigint,
      'fondos_en_poder_cent', v_fondos, 'subtotal_cent', v_lib, 'valuacion_cent', v_val,
      'utilidad_generada_cent', (x ->> 'utilidad_generada_cent')::bigint, 'reinvertida_acta_cent', (x ->> 'utilidad_reinvertida_acta_cent')::bigint,
      'reembolso_puesto_cent', (x ->> 'reembolso_puesto_acum_cent')::bigint, 'aportado_cent', (x ->> 'aportado_cent')::bigint,
      'aportacion_neta_cent', (x ->> 'aportacion_neta_cent')::bigint, 'diferencia_a_igualar_cent', (x ->> 'diferencia_a_igualar_cent')::bigint,
      'le_toca_aportar_aportacion', (x ->> 'le_toca_aportar')::boolean, 'participacion_bp', 5000,
      'coincide_con_cap_periodo', v_val = (x ->> 'valuacion_cent')::bigint);
    v_socios := v_socios || v_fila;
    v_t_cap := v_t_cap + v_cap_acum; v_t_util := v_t_util + v_util_acum; v_t_ret := v_t_ret + v_ret; v_t_fondos := v_t_fondos + v_fondos; v_t_lib := v_t_lib + v_lib; v_t_val := v_t_val + v_val;
    if x ->> 'socio' = 'Angelo' then v_ret_a := v_ret; v_util_a := v_util_acum; else v_ret_j := v_ret; v_util_j := v_util_acum; end if;
  end loop;

  select s ->> 'socio', (s ->> 'valuacion_cent')::bigint into v_mayor, v_vmax from jsonb_array_elements(v_socios) s order by (s ->> 'valuacion_cent')::bigint desc, s ->> 'socio' limit 1;
  select s ->> 'socio', (s ->> 'valuacion_cent')::bigint into v_menor, v_vmin from jsonb_array_elements(v_socios) s order by (s ->> 'valuacion_cent')::bigint asc, s ->> 'socio' desc limit 1;
  v_x := coalesce(v_vmax - v_vmin, 0); v_y := coalesce((v_cap ->> 'diferencia_a_igualar_cent')::bigint, 0);
  v_bal := v_cap -> 'balance'; v_k1 := (select e from jsonb_array_elements(v_cap -> 'comprobaciones') e where e ->> 'id' = 'K1'); v_k3 := (select e from jsonb_array_elements(v_cap -> 'comprobaciones') e where e ->> 'id' = 'K3');
  v_cons_neta := (v_bal ->> 'total_activo_cent')::bigint - (v_bal ->> 'total_pasivo_cent')::bigint;

  -- Identidades que siempre deben cumplirse (verde/rojo). 'alerta' = no es falla contable sino una desigualdad que los socios quieren evitar.
  v_ident := jsonb_build_array(
    jsonb_build_object('id', 'S1', 'tipo', 'identidad', 'nombre', 'Utilidades acumuladas iguales (50 % y 50 %)', 'a_nombre', 'Utilidades acumuladas de Javier', 'a_cent', coalesce(v_util_j, 0),
                       'b_nombre', 'Utilidades acumuladas de Angelo', 'b_cent', coalesce(v_util_a, 0), 'ok', abs(coalesce(v_util_j, 0) - coalesce(v_util_a, 0)) <= 1),
    jsonb_build_object('id', 'S2', 'tipo', 'identidad', 'nombre', 'Suma de las valuaciones por socio = capital contable del Balance', 'a_nombre', 'Capital + utilidades - retirado, de los dos', 'a_cent', v_t_lib,
                       'b_nombre', 'Capital contable del Balance', 'b_cent', (v_bal ->> 'total_capital_cent')::bigint, 'ok', v_t_lib = (v_bal ->> 'total_capital_cent')::bigint),
    jsonb_build_object('id', 'S3', 'tipo', 'identidad', 'nombre', 'Valuaciones personales + fondos de la sociedad en poder de socios = activo - pasivo', 'a_nombre', 'Valuaciones personales + fondos', 'a_cent', v_t_val + v_t_fondos,
                       'b_nombre', 'Activo menos pasivo', 'b_cent', v_cons_neta, 'ok', v_t_val + v_t_fondos = v_cons_neta),
    jsonb_build_object('id', 'S4', 'tipo', 'identidad', 'nombre', 'La utilidad de los dos es la utilidad neta del Estado de resultados', 'a_nombre', 'Utilidad de Javier + Angelo', 'a_cent', coalesce((v_k3 ->> 'a_cent')::bigint, 0),
                       'b_nombre', 'Utilidad neta (Estado de resultados)', 'b_cent', coalesce((v_k3 ->> 'b_cent')::bigint, 0), 'ok', coalesce((v_k3 ->> 'ok')::boolean, false)),
    jsonb_build_object('id', 'S5', 'tipo', 'alerta', 'nombre', 'Retiros iguales (siempre nos pagamos lo mismo)', 'a_nombre', 'Retirado por Javier', 'a_cent', coalesce(v_ret_j, 0),
                       'b_nombre', 'Retirado por Angelo', 'b_cent', coalesce(v_ret_a, 0), 'ok', coalesce(v_ret_j, 0) = coalesce(v_ret_a, 0)),
    jsonb_build_object('id', 'S6', 'tipo', 'identidad', 'nombre', 'Cada valuación personal es la de la tabla de capital (una sola definición)', 'a_nombre', 'Capital + utilidades - retirado - fondos', 'a_cent', v_t_val,
                       'b_nombre', 'Valuación de Capital por mes', 'b_cent', (v_cap -> 'total' ->> 'valuacion_cent')::bigint, 'ok', v_t_val = (v_cap -> 'total' ->> 'valuacion_cent')::bigint));

  -- Serie mensual: valuacion de cada socio al cierre de cada mes (misma funcion), con lo retirado acumulado.
  v_m := date_trunc('month', v_primera)::date; v_acum := jsonb_build_object('Angelo', 0, 'Javier', 0);
  while v_m <= v_hasta and v_n < 61 loop
    v_ini := greatest(v_m, v_primera); v_fin := least((v_m + interval '1 month - 1 day')::date, v_hasta);
    v_p := operacion.cap_periodo(v_ini, v_fin, false);
    for r in select value from jsonb_array_elements(v_p -> 'socios') loop
      v_acum := jsonb_set(v_acum, array[r ->> 'socio'], to_jsonb((v_acum ->> (r ->> 'socio'))::bigint + (r ->> 'utilidad_retirada_cent')::bigint + (r ->> 'devoluciones_capital_cent')::bigint));
    end loop;
    v_serie := v_serie || jsonb_build_object('mes', to_char(v_m, 'YYYY-MM'), 'fin', v_fin, 'parcial', v_fin < (v_m + interval '1 month - 1 day')::date, 'socios',
      (select jsonb_agg(jsonb_build_object('socio', r2 ->> 'socio', 'valuacion_cent', (r2 ->> 'valuacion_cent')::bigint, 'capital_aportado_cent', (r2 ->> 'capital_aportado_acum_cent')::bigint,
          'retirado_cent', (v_acum ->> (r2 ->> 'socio'))::bigint,
          'utilidades_acumuladas_cent', (r2 ->> 'valuacion_libro_cent')::bigint + (v_acum ->> (r2 ->> 'socio'))::bigint - (r2 ->> 'capital_aportado_acum_cent')::bigint,
          'fondos_en_poder_cent', (r2 ->> 'fondos_en_poder_cent')::bigint) order by r2 ->> 'socio') from jsonb_array_elements(v_p -> 'socios') r2));
    v_m := (v_m + interval '1 month')::date; v_n := v_n + 1;
  end loop;

  -- Proveedores: operacion.posicion_proveedor (la posicion del Mayor con la separacion de los pedidos del socio a costo). Solo con corte hoy: el auxiliar de pedidos no tiene corte por fecha.
  select coalesce(jsonb_agg(d order by d ->> 'proveedor'), '[]'::jsonb) into v_prov from (
    select jsonb_build_object('proveedor', e ->> 'proveedor', 'saldo_cent', (e ->> 'saldo_cent')::bigint,
             'se_debe_cent', (pp ->> 'se_debe_cent')::bigint, 'a_favor_cent', (pp ->> 'a_favor_cent')::bigint,
             'pedidos_socio_a_costo_cent', case when v_hasta >= v_hoy then (pp ->> 'menudeo_pendiente_cent')::bigint end,
             'deuda_empresa_cent', case when v_hasta >= v_hoy then (pp ->> 'deuda_empresa_cent')::bigint end) as d
      from jsonb_array_elements(v_cap -> 'proveedores') e
      cross join lateral (select operacion.posicion_proveedor(catalogo.proveedor_id(e ->> 'proveedor'), case when v_hasta >= v_hoy then null else v_hasta end) as pp) l) q;
  select coalesce(sum((d ->> 'se_debe_cent')::bigint), 0), coalesce(sum((d ->> 'a_favor_cent')::bigint), 0),
         case when v_hasta >= v_hoy then coalesce(sum((d ->> 'pedidos_socio_a_costo_cent')::bigint), 0) end,
         case when v_hasta >= v_hoy then coalesce(sum((d ->> 'deuda_empresa_cent')::bigint), 0) end
    into v_prov_total, v_prov_fav, v_socio_costo, v_deuda_emp from jsonb_array_elements(v_prov) d;

  return jsonb_build_object('hasta', v_hasta, 'hoy', v_hoy, 'primera_fecha', v_primera, 'hay_movimientos', v_hay, 'socios', v_socios,
    'total', jsonb_build_object('capital_aportado_cent', v_t_cap, 'utilidades_acumuladas_cent', v_t_util, 'retirado_cent', v_t_ret, 'fondos_en_poder_cent', v_t_fondos, 'subtotal_cent', v_t_lib, 'valuacion_cent', v_t_val),
    'comparacion', jsonb_build_object('mayor', case when v_x = 0 then null else v_mayor end, 'menor', case when v_x = 0 then null else v_menor end,
      'diferencia_valuacion_cent', v_x, 'diferencia_aportacion_cent', v_y, 'igualados', v_x = 0,
      'le_toca_aportar', case when v_x = 0 then null else v_menor end, 'aportar_para_igualar_cent', v_x,
      'turno_aportacion_neta', v_cap ->> 'turno_aportar',
      'retiros_desiguales', coalesce(v_ret_j, 0) <> coalesce(v_ret_a, 0), 'diferencia_retiros_cent', abs(coalesce(v_ret_j, 0) - coalesce(v_ret_a, 0)),
      'retiro_mas', case when coalesce(v_ret_j, 0) > coalesce(v_ret_a, 0) then 'Javier' when coalesce(v_ret_a, 0) > coalesce(v_ret_j, 0) then 'Angelo' end),
    'balance', jsonb_build_object('total_activo_cent', (v_bal ->> 'total_activo_cent')::bigint, 'total_pasivo_cent', (v_bal ->> 'total_pasivo_cent')::bigint,
      'capital_contable_cent', (v_bal ->> 'total_capital_cent')::bigint, 'cuadra', (v_bal ->> 'cuadra')::boolean),
    'identidades', v_ident, 'comprobaciones_libro', v_cap -> 'comprobaciones', 'serie', v_serie,
    'proveedores', jsonb_build_object('detalle', v_prov, 'se_debe_cent', v_prov_total, 'a_favor_cent', v_prov_fav, 'pedidos_socio_a_costo_cent', v_socio_costo,
      'deuda_empresa_cent', v_deuda_emp,
      'nota', 'La posición con el proveedor incluye los pedidos de Angelo a costo: los reembolsa el socio, no es deuda de la empresa.'),
    'definicion', 'Valuación = capital aportado + utilidades acumuladas - retirado - fondos de la sociedad en su poder. Sube con cada utilidad y baja solo cuando se retira.');
end $$;

create function api.cuenta_socios_valuacion(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.cuenta_socios_valuacion(p_hasta);
end $$;

revoke execute on function operacion.cuenta_socios_valuacion(date) from public, anon, authenticated;
revoke execute on function api.cuenta_socios_valuacion(date) from public, anon;
grant execute on function api.cuenta_socios_valuacion(date) to authenticated;
