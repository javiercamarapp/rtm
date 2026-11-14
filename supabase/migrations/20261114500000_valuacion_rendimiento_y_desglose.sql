-- Pulido final (14-nov). Migracion ADITIVA, solo lecturas:
--  (1) RENDIMIENTO de operacion.cuenta_socios_valuacion: la serie mensual ya no llama a cap_periodo una vez por mes (0.5 s hoy; con 61 meses rondaba el statement_timeout de 8 s):
--      una sola consulta por conjuntos con las mismas cifras. cap_periodo se llama UNA vez (el acumulado).
--  (2) DESGLOSE de la diferencia de valuacion y como igualar (campo nuevo `igualacion`, y `fondos_detalle` por socio con los cobros que explican los fondos en su poder).
--  (3) agente.valuacion_socios(): lectura determinista para Telegram ('mi valuacion', 'como estamos'); misma funcion de la base, sin telefonos; solo socios (Omar queda fuera en el agente).
-- Sin cambios de reglas de dinero. Los permisos de operacion.cuenta_socios_valuacion y api.cuenta_socios_valuacion no cambian (create or replace los conserva).

create or replace function operacion.cuenta_socios_valuacion(p_hasta date default null) returns jsonb
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
  v_ig jsonb; v_fm record; v_fx record; v_comp jsonb; v_pasos jsonb := '{}'::jsonb; v_vpa bigint; v_vpj bigint; v_ent_men bigint; v_apo_men bigint;
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
      'coincide_con_cap_periodo', v_val = (x ->> 'valuacion_cent')::bigint, 'fondos_detalle', coalesce(x -> 'fondos_detalle', '[]'::jsonb));
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

  -- Serie mensual: valuacion de cada socio al cierre de cada mes. UNA sola consulta por conjuntos (ya no una llamada a cap_periodo por mes: con 61 meses de historia
  -- eso rondaba el statement_timeout de 8 s). Las cifras son IDENTICAS a las del calculo anterior: mismas cuentas, mismos cortes, misma regla de redondeo (cap_mitad);
  -- pgTAP a11_001 las compara contra el calculo por cap_periodo con 1, 12 y 61 meses sembrados.
  --   valuacion_libro = capital libro (3110 + 3310 - 3210) + su 50 % de (resultado + 3900 + 3990);  valuacion = libro - fondos en su poder (1150, solo deudor)
  --   capital aportado = aportaciones de capital hasta el corte + apertura de la cuenta 3110;  retirado = retiros + devoluciones de aportacion + apertura 3210, de la primera fecha al corte.
  with meses as (
    select g::date as m from generate_series(date_trunc('month', v_primera)::date, v_hasta, interval '1 month') g limit 61
  ), corte as (
    select m, least((m + interval '1 month - 1 day')::date, v_hasta) as fin, least((m + interval '1 month - 1 day')::date, v_hasta) < (m + interval '1 month - 1 day')::date as parcial from meses
  ), so as (
    select s.id, s.nombre, contabilidad.cta_socio(s.id, 3110) as c3110, contabilidad.cta_socio(s.id, 3310) as c3310, contabilidad.cta_socio(s.id, 3210) as c3210, contabilidad.cta_socio(s.id, 1150) as c1150
      from catalogo.socio s where s.nombre in ('Angelo', 'Javier')
  ), sal as (
    -- saldos acumulados al cierre de cada corte, solo de las cuentas que se usan (socios, 3900, 3990 y las de resultado)
    select c.fin, l.cuenta, cu.tipo,
           sum(case cu.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end)::bigint as saldo,
           sum(l.debe_cent - l.haber_cent)::bigint as deudor, sum(l.haber_cent - l.debe_cent)::bigint as acreedor
      from corte c join contabilidad.asiento a on a.fecha_contable <= c.fin join contabilidad.asiento_linea l on l.asiento_id = a.id join contabilidad.cuenta cu on cu.codigo = l.cuenta
     where cu.tipo in ('I', 'C', 'G') or l.cuenta in ('3900', '3990') or l.cuenta in (select unnest(array[c3110, c3310, c3210, c1150]) from so)
     group by c.fin, l.cuenta, cu.tipo
  ), res as (
    select fin, sum(acreedor)::bigint as resultado from sal where tipo in ('I', 'C', 'G') group by fin
  ), apo as (
    select c.fin, s.id as socio_id, coalesce(sum(a.monto_cent), 0)::bigint as capital
      from corte c cross join so s left join operacion.aportacion_socio a on a.socio_id = s.id and a.clasificacion = 'capital' and a.fecha_neg <= c.fin group by c.fin, s.id
  ), ape as (
    -- cap_apertura: apertura firmada y no reversada, saldo de la cuenta 3110 del socio en su naturaleza
    select c.fin, s.id as socio_id,
           coalesce(sum(case cu.naturaleza when 'D' then l.debe_cent - l.haber_cent else l.haber_cent - l.debe_cent end), 0)::bigint as capital
      from corte c cross join so s
      left join (apertura.sesion se join contabilidad.asiento a on a.evento_id = se.evento_id and a.es_apertura and se.estado = 'firmada'
                 and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)) on a.fecha_contable <= c.fin
      left join contabilidad.asiento_linea l on l.asiento_id = a.id and l.cuenta = s.c3110 left join contabilidad.cuenta cu on cu.codigo = l.cuenta
     group by c.fin, s.id
  ), ret as (
    select c.fin, s.id as socio_id,
           coalesce((select sum(-l.monto_cent) from operacion.socio_libro l left join operacion.socio_libro o on o.id = l.reversa_de
                      where l.socio_id = s.id and l.fecha_neg between v_primera and c.fin
                        and coalesce(o.concepto, l.concepto) in ('retiro', 'pago_utilidad', 'liquidacion_recibida', 'pago_devolucion_aportacion')), 0)::bigint
         + coalesce((select sum(l.debe_cent - l.haber_cent) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id
                      where l.cuenta = s.c3210 and a.es_apertura and a.fecha_contable between v_primera and c.fin and not exists (select 1 from contabilidad.asiento r where r.reversa_de = a.id)), 0)::bigint as retirado
      from corte c cross join so s
  ), fila as (
    select c.m, c.fin, s.nombre,
           (select coalesce(sum(x.saldo), 0) from sal x where x.fin = c.fin and x.cuenta = s.c3110) + (select coalesce(sum(x.saldo), 0) from sal x where x.fin = c.fin and x.cuenta = s.c3310)
             - (select coalesce(sum(x.saldo), 0) from sal x where x.fin = c.fin and x.cuenta = s.c3210)
             + operacion.cap_mitad((coalesce((select r.resultado from res r where r.fin = c.fin), 0) + (select coalesce(sum(x.saldo), 0) from sal x where x.fin = c.fin and x.cuenta in ('3900', '3990')))::bigint, s.nombre) as libro,
           greatest((select coalesce(sum(x.deudor), 0) from sal x where x.fin = c.fin and x.cuenta = s.c1150), 0)::bigint as fondos,
           (select a1.capital from apo a1 where a1.fin = c.fin and a1.socio_id = s.id) + (select a2.capital from ape a2 where a2.fin = c.fin and a2.socio_id = s.id) as capital,
           (select r2.retirado from ret r2 where r2.fin = c.fin and r2.socio_id = s.id) as retirado
      from corte c cross join so s
  )
  select coalesce(jsonb_agg(jsonb_build_object('mes', to_char(c.m, 'YYYY-MM'), 'fin', c.fin, 'parcial', c.parcial, 'socios',
           (select jsonb_agg(jsonb_build_object('socio', f.nombre, 'valuacion_cent', f.libro - f.fondos, 'capital_aportado_cent', f.capital, 'retirado_cent', f.retirado,
              'utilidades_acumuladas_cent', f.libro + f.retirado - f.capital, 'fondos_en_poder_cent', f.fondos) order by f.nombre) from fila f where f.fin = c.fin)) order by c.m), '[]'::jsonb)
    into v_serie from corte c;

  -- Desglose de la diferencia de valuacion entre los dos y como igualar (decision del dueno, 14-nov: la valuacion de quien tiene fondos de la sociedad en su cuenta SI los resta,
  -- pero debe verse explicito por que es menos). Todo sale de las filas de socios de arriba; sin recalcular reglas de dinero.
  --   X = valuacion mayor - valuacion menor = (capital aportado mayor - menor) + (fondos del menor - fondos del mayor) + (retirado del menor - retirado del mayor) + (utilidades del mayor - menor)
  --   Pasos: cada socio entrega a la sociedad los fondos que tiene cobrados (su valuacion sube lo mismo); despues el que quede con menos aporta la diferencia restante.
  select (s ->> 'valuacion_cent')::bigint as val, (s ->> 'fondos_en_poder_cent')::bigint as fon, (s ->> 'capital_aportado_cent')::bigint as cap, (s ->> 'utilidades_acumuladas_cent')::bigint as uti, (s ->> 'retirado_cent')::bigint as ret
    into v_fm from jsonb_array_elements(v_socios) s where s ->> 'socio' = v_menor;
  select (s ->> 'valuacion_cent')::bigint as val, (s ->> 'fondos_en_poder_cent')::bigint as fon, (s ->> 'capital_aportado_cent')::bigint as cap, (s ->> 'utilidades_acumuladas_cent')::bigint as uti, (s ->> 'retirado_cent')::bigint as ret
    into v_fx from jsonb_array_elements(v_socios) s where s ->> 'socio' = v_mayor;
  if v_fm is not null and v_fx is not null then
    v_comp := jsonb_build_array(
      jsonb_build_object('id', 'capital', 'nombre', 'Aportó menos capital', 'menor_cent', v_fm.cap, 'mayor_cent', v_fx.cap, 'monto_cent', v_fx.cap - v_fm.cap),
      jsonb_build_object('id', 'fondos', 'nombre', 'Fondos de la sociedad cobrados en su cuenta, pendientes de entregar', 'menor_cent', v_fm.fon, 'mayor_cent', v_fx.fon, 'monto_cent', v_fm.fon - v_fx.fon),
      jsonb_build_object('id', 'retiros', 'nombre', 'Se ha pagado más en retiros', 'menor_cent', v_fm.ret, 'mayor_cent', v_fx.ret, 'monto_cent', v_fm.ret - v_fx.ret),
      jsonb_build_object('id', 'utilidades', 'nombre', 'Utilidades acumuladas (centavo suelto del reparto 50/50)', 'menor_cent', v_fm.uti, 'mayor_cent', v_fx.uti, 'monto_cent', v_fx.uti - v_fm.uti));
    v_vpa := (select (s ->> 'valuacion_cent')::bigint + (s ->> 'fondos_en_poder_cent')::bigint from jsonb_array_elements(v_socios) s where s ->> 'socio' = 'Angelo');
    v_vpj := (select (s ->> 'valuacion_cent')::bigint + (s ->> 'fondos_en_poder_cent')::bigint from jsonb_array_elements(v_socios) s where s ->> 'socio' = 'Javier');
    v_pasos := jsonb_build_object(
      'Angelo', jsonb_build_object('entregar_cent', (select (s ->> 'fondos_en_poder_cent')::bigint from jsonb_array_elements(v_socios) s where s ->> 'socio' = 'Angelo'),
                                   'valuacion_tras_entregar_cent', v_vpa, 'aportar_cent', greatest(v_vpj - v_vpa, 0)),
      'Javier', jsonb_build_object('entregar_cent', (select (s ->> 'fondos_en_poder_cent')::bigint from jsonb_array_elements(v_socios) s where s ->> 'socio' = 'Javier'),
                                   'valuacion_tras_entregar_cent', v_vpj, 'aportar_cent', greatest(v_vpa - v_vpj, 0)));
    v_ent_men := (v_pasos -> v_menor ->> 'entregar_cent')::bigint; v_apo_men := (v_pasos -> v_menor ->> 'aportar_cent')::bigint;
  end if;
  v_ig := jsonb_build_object('igualados', v_x = 0, 'faltan_cent', v_x, 'mayor', case when v_x = 0 then null else v_mayor end, 'menor', case when v_x = 0 then null else v_menor end,
    'componentes', coalesce(v_comp, '[]'::jsonb),
    'suma_componentes_cent', coalesce((select sum((e ->> 'monto_cent')::bigint) from jsonb_array_elements(coalesce(v_comp, '[]'::jsonb)) e), 0),
    'por_socio', v_pasos,
    'diferencia_libro_cent', v_y,
    'coincide_con_libro', coalesce(v_ent_men + v_apo_men = v_y, false),
    'regla', 'Cada socio entrega a la sociedad los fondos que tiene cobrados; después el que queda con menos aporta lo que falta. Con retiros iguales, entregar más aportar es la diferencia a igualar del libro.');

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
    'igualacion', v_ig, 'identidades', v_ident, 'comprobaciones_libro', v_cap -> 'comprobaciones', 'serie', v_serie,
    'proveedores', jsonb_build_object('detalle', v_prov, 'se_debe_cent', v_prov_total, 'a_favor_cent', v_prov_fav, 'pedidos_socio_a_costo_cent', v_socio_costo,
      'deuda_empresa_cent', v_deuda_emp,
      'nota', 'La posición con el proveedor incluye los pedidos de Angelo a costo: los reembolsa el socio, no es deuda de la empresa.'),
    'definicion', 'Valuación = capital aportado + utilidades acumuladas - retirado - fondos de la sociedad en su poder. Sube con cada utilidad y baja solo cuando se retira.');
end $$;


create function agente.valuacion_socios() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_canal text := coalesce(current_setting('rtm.canal', true), ''); v_actor text := coalesce(current_setting('rtm.actor', true), '');
  v_lector text; v_c jsonb;
begin
  perform notificacion.exigir_sistema();
  select m.persona into v_lector from agente.miembro m where m.rol = 'socio' and m.activo order by m.persona limit 1;
  if v_lector is null then raise exception 'no hay socios registrados en el agente' using errcode = 'P0460'; end if;
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_lector, true);
  v_c := api.cuenta_socios_valuacion();
  perform set_config('rtm.canal', v_canal, true);
  perform set_config('rtm.actor', v_actor, true);
  -- Solo lo necesario para redactar la respuesta: valuaciones, diferencia y pasos para igualar (sin serie, sin proveedores, sin detalle de asientos).
  return jsonb_build_object('hasta', v_c -> 'hasta',
    'socios', (select jsonb_agg(jsonb_build_object('socio', s ->> 'socio', 'valuacion_cent', (s ->> 'valuacion_cent')::bigint, 'fondos_en_poder_cent', (s ->> 'fondos_en_poder_cent')::bigint,
                                                   'capital_aportado_cent', (s ->> 'capital_aportado_cent')::bigint) order by s ->> 'socio') from jsonb_array_elements(v_c -> 'socios') s),
    'igualacion', v_c -> 'igualacion', 'retiros_desiguales', (v_c -> 'comparacion' ->> 'retiros_desiguales')::boolean, 'diferencia_retiros_cent', (v_c -> 'comparacion' ->> 'diferencia_retiros_cent')::bigint,
    'retiro_mas', v_c -> 'comparacion' ->> 'retiro_mas', 'fuente', 'api.cuenta_socios_valuacion');
end $$;

revoke all on function agente.valuacion_socios() from public, anon, authenticated;
grant execute on function agente.valuacion_socios() to servidor;
