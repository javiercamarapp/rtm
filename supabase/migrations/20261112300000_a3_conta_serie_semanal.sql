-- Rediseno etapa 2 (lote A3): serie semanal de lectura para graficas de Contabilidad y Proyecciones.
-- ADITIVA y de solo lectura: no crea tablas ni cambia ninguna funcion existente; reutiliza contabilidad.estado_resultados y contabilidad.flujo_efectivo semana por semana.
-- Semanas de lunes a domingo (America/Merida); la ultima es la semana en curso y va marcada como parcial.

create function api.conta_serie_semanal(p_semanas int default 12) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoy date := negocio.hoy();
  v_n int := least(greatest(coalesce(p_semanas, 12), 2), 26);
  v_lunes date := v_hoy - (extract(isodow from v_hoy)::int - 1);
  v_ini date; v_fin date; v_er jsonb; v_fl jsonb; v_out jsonb := '[]'::jsonb; i int;
begin
  perform seguridad.exigir_rol(array['socio']);
  for i in reverse (v_n - 1)..0 loop
    v_ini := v_lunes - (i * 7);
    v_fin := least(v_ini + 6, v_hoy);
    v_er := contabilidad.estado_resultados(v_ini, v_fin);
    v_fl := contabilidad.flujo_efectivo(v_ini, v_fin);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'ini', v_ini, 'fin', v_ini + 6, 'parcial', (v_ini + 6) > v_hoy, 'con_movimientos', (v_er ->> 'con_movimientos')::boolean,
      'ventas_netas_cent', (v_er ->> 'ventas_netas_cent')::bigint, 'ingresos_operativos_cent', (v_er ->> 'ingresos_operativos_cent')::bigint,
      'costo_ventas_cent', (v_er ->> 'costo_ventas_cent')::bigint, 'utilidad_bruta_cent', (v_er ->> 'utilidad_bruta_cent')::bigint,
      'gastos_cent', (v_er ->> 'gastos_variables_cent')::bigint + (v_er ->> 'gastos_fijos_cent')::bigint,
      'utilidad_neta_cent', (v_er ->> 'utilidad_neta_cent')::bigint, 'piezas_vendidas', (v_er ->> 'piezas_vendidas')::bigint,
      'flujo_operacion_cent', (v_fl ->> 'flujo_operacion_cent')::bigint, 'flujo_financiamiento_cent', (v_fl ->> 'flujo_financiamiento_cent')::bigint,
      'variacion_cent', (v_fl ->> 'variacion_cent')::bigint, 'saldo_final_cent', (v_fl ->> 'saldo_final_cent')::bigint,
      'cobros_clientes_cent', coalesce((select sum((x ->> 'monto_cent')::bigint) from jsonb_array_elements(v_fl -> 'directo') x where x ->> 'categoria' = 'Cobros de clientes'), 0),
      'pagos_proveedores_cent', coalesce((select sum((x ->> 'monto_cent')::bigint) from jsonb_array_elements(v_fl -> 'directo') x where x ->> 'categoria' = 'Pagos a proveedores'), 0)));
  end loop;
  return jsonb_build_object('hoy', v_hoy, 'semanas', v_out);
end $$;

revoke execute on function api.conta_serie_semanal(int) from public, anon;
grant execute on function api.conta_serie_semanal(int) to authenticated;
