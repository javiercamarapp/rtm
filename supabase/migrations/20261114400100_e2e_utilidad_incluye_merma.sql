-- Correccion de la campana E2E maestra (13-nov), MEDIO-1: la utilidad que se reparte 50/50 (operacion.utilidad_periodo) y el Historial personal ignoraban la merma por obsequio
-- (cuenta 5200 del libro, movimientos de inventario tipo 'merma': piezas regaladas o dadas de baja). El Estado de resultados, la utilidad objetivo y las valuaciones SI la restaban:
-- con los datos reales de carga, 73,707.02 contra 73,340.78 (diferencia constante 366.24). La utilidad distribuible es la del libro: ventas menos TODO costo.
--
-- Cambio ADITIVO (solo lecturas; sin tablas, sin GRANT nuevo; no toca ningun cierre ni acta ya sellados: sus cifras estan guardadas en su fila):
--   1. operacion.merma_periodo(ini, fin): merma neta (debe - haber de la cuenta 5200, por fecha contable) de las BAJAS de inventario (evento 'movimiento_merma' y sus reversas). NO cuenta
--      lo que ya entra por otra via: devoluciones de clientes (su efecto ya descuenta lo que se fue a merma), incidentes de paquete (ajuste de paquetes; su asiento manual reclasifica 5100 a 5200) ni
--      asientos manuales.
--   2. operacion.utilidad_periodo se envuelve (mismo patron que la envoltura de paquetes): la anterior pasa a utilidad_periodo_sin_merma y la nueva suma la merma a los gastos
--      (para que 'pedidos + tomas - gastos' siga cuadrando) y la expone como 'merma_cent'. Las envolturas de paquetes, devoluciones y reinversion no se tocan.
--   3. api.explicar_cifra('cascada:utilidad:...') muestra la merma en su propio renglon (misma via 2 que el via 1).

create function operacion.merma_periodo(p_ini date, p_fin date) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(l.debe_cent - l.haber_cent), 0)::bigint
    from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento ev on ev.id = a.evento_id left join operacion.evento orig on orig.id = ev.reversa_de
   where l.cuenta = '5200' and a.fecha_contable between p_ini and p_fin
     and (ev.tipo = 'movimiento_merma' or (ev.tipo = 'reversa' and orig.tipo = 'movimiento_merma'))
$$;
revoke execute on function operacion.merma_periodo(date, date) from public, anon, authenticated;

alter function operacion.utilidad_periodo(date, date) rename to utilidad_periodo_sin_merma;
revoke execute on function operacion.utilidad_periodo_sin_merma(date, date) from public, anon, authenticated;
create function operacion.utilidad_periodo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb := operacion.utilidad_periodo_sin_merma(p_ini, p_fin); v_m bigint := operacion.merma_periodo(p_ini, p_fin);
begin
  return v || jsonb_build_object('merma_cent', v_m, 'gastos_cent', (v->>'gastos_cent')::bigint + v_m, 'utilidad_cent', (v->>'utilidad_cent')::bigint - v_m);
end $$;
revoke execute on function operacion.utilidad_periodo(date, date) from public, anon, authenticated;

alter function api.explicar_cifra(text) rename to explicar_cifra_antes_merma;
revoke execute on function api.explicar_cifra_antes_merma(text) from public, anon, authenticated;
create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_u jsonb; v_rengs jsonb; v_via2 bigint; v_paq bigint; v_mer bigint;
begin
  if partes[1] = 'cascada' and partes[2] = 'utilidad' then
    perform seguridad.exigir_rol(array['socio']);
    v_u := operacion.utilidad_periodo(partes[3]::date, partes[4]::date);
    v_paq := coalesce((v_u->>'ajuste_paquetes_cent')::bigint, 0);
    v_mer := coalesce((v_u->>'merma_cent')::bigint, 0);
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Utilidad de los pedidos enviados (' || (v_u->>'pedidos') || ')', 'monto_cent', (v_u->>'utilidad_pedidos_cent')::bigint - (v_u->>'devoluciones_cent')::bigint),
      jsonb_build_object('concepto', 'Devoluciones de clientes (' || (v_u->>'devoluciones') || '): credito menos el costo de lo que regreso a inventario', 'monto_cent', (v_u->>'devoluciones_cent')::bigint),
      jsonb_build_object('concepto', 'Utilidad de las tomas de Omar a su precio', 'monto_cent', (v_u->>'utilidad_tomas_cent')::bigint),
      jsonb_build_object('concepto', 'Gastos generales de la sociedad (incluidos los pagados por socios)', 'monto_cent', -((v_u->>'gastos_cent')::bigint + v_paq - v_mer)),
      jsonb_build_object('concepto', 'Perdidas de paquetes (ajuste de utilidad)', 'monto_cent', v_paq),
      jsonb_build_object('concepto', 'Merma y piezas regaladas dadas de baja (costo absorbido por la sociedad)', 'monto_cent', -v_mer));
    select coalesce(sum((x->>'monto_cent')::bigint), 0)::bigint into v_via2 from jsonb_array_elements(v_rengs) x;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Utilidad neta del periodo' || case when (v_u->>'provisional')::boolean then ' (provisional: hay guias sin costo)' else '' end, 'valor', (v_u->>'utilidad_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Funcion de utilidad del periodo', 'via1_valor', (v_u->>'utilidad_cent')::bigint, 'via2', 'Pedidos menos devoluciones, mas tomas, menos gastos y merma', 'via2_valor', v_via2, 'cuadra', (v_u->>'utilidad_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  return api.explicar_cifra_antes_merma(p_cifra);
end $$;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra(text) from public, anon;
