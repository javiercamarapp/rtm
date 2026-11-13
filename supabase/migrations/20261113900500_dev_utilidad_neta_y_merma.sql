-- Devoluciones / 5: cierre de hallazgos del verificador.
--  1. La utilidad del periodo (base del reparto entre socios, la cascada y el acta) resta las devoluciones de clientes: credito menos el costo de lo que
--     regreso a inventario (lo danado ya salio como costo al venderse y sigue siendo costo). Cuenta en la fecha de la devolucion; si se anula, resta en la fecha de la anulacion.
--  2. La merma de una devolucion danada sale al mismo valor con el que entro (antes salia al promedio vigente y el pedido y el libro diferian).
-- Aditiva: solo create or replace de funciones; no toca tablas ni datos.

create or replace function operacion.t2_movimiento() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_e int; v_v bigint; v_ult date; v_n int; v_modelo_sku bigint; v_sku_pzs int; v_ub_pzs int; v_val bigint;
begin
  select s.modelo_id into v_modelo_sku from catalogo.sku s where s.id = new.sku_id;
  if v_modelo_sku is null or v_modelo_sku <> new.modelo_id then raise exception 'el SKU no pertenece al modelo' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.modelo_id::text, 0));
  select coalesce(max(m.fecha_neg), '0001-01-01') into v_ult from operacion.movimiento_inventario m where m.modelo_id = new.modelo_id;
  if new.fecha_neg < v_ult then
    raise exception 'fecha retroactiva: el ultimo movimiento del modelo es del % (solo reversa y nuevo registro)', v_ult using errcode = 'P0422';
  end if;
  select coalesce(e.piezas, 0), coalesce(e.valor_cent, 0) into v_e, v_v from (select 1) x left join operacion.existencia_modelo e on e.modelo_id = new.modelo_id;

  if new.cantidad > 0 then
    v_val := new.valor_cent;
    if v_val is null then
      if new.tipo in ('ajuste_conteo', 'devolucion') and v_e > 0 then v_val := negocio.redondear_medio_arriba(v_v * new.cantidad, v_e);
      else raise exception 'una entrada necesita su valor (costo puesto)' using errcode = '23502'; end if;
    end if;
    if v_val < 0 then raise exception 'valor de entrada negativo' using errcode = '23514'; end if;
  else
    v_n := -new.cantidad;
    if v_n > v_e then raise exception 'existencia insuficiente del modelo: hay %, se piden %', v_e, v_n using errcode = 'P0423'; end if;
    if new.valor_cent is null or (new.tipo in ('salida_pedido', 'salida_toma_omar', 'merma') and not (new.tipo = 'merma' and new.nota like 'Devolucion danada %')) then
      -- Salida al costo promedio ponderado movil; si sale todo, sale todo el valor (residuo exacto).
      v_val := case when v_n = v_e then -v_v else -negocio.redondear_medio_arriba(v_v * v_n, v_e) end;
    else
      v_val := new.valor_cent;
      if -v_val > v_v or (v_n = v_e and -v_val <> v_v) then raise exception 'valor de salida inconsistente con el inventario' using errcode = '23514'; end if;
    end if;
  end if;

  select coalesce(sum(u.piezas), 0) into v_sku_pzs from operacion.existencia_sku_ubicacion u where u.sku_id = new.sku_id;
  select coalesce(u.piezas, 0) into v_ub_pzs from (select 1) x left join operacion.existencia_sku_ubicacion u on u.sku_id = new.sku_id and u.ubicacion = new.ubicacion;
  if v_ub_pzs + new.cantidad < 0 then raise exception 'existencia insuficiente en la ubicacion' using errcode = 'P0423'; end if;

  new.valor_cent := v_val;
  new.costo_unit_aplicado_cent := negocio.redondear_medio_arriba(abs(v_val), abs(new.cantidad));
  new.piezas_modelo_despues := v_e + new.cantidad;
  new.valor_modelo_despues_cent := v_v + v_val;
  new.piezas_sku_despues := v_sku_pzs + new.cantidad;
  if new.valor_modelo_despues_cent < 0 or (new.piezas_modelo_despues = 0 and new.valor_modelo_despues_cent <> 0) then
    raise exception 'el movimiento deja el valor del inventario inconsistente' using errcode = '23514';
  end if;
  return new;
end $$;

-- Integracion: operacion.utilidad_periodo es hoy la envoltura de paquetes (20261112400200); la base renombrada es utilidad_periodo_sin_paquetes. Se redefine la
-- BASE para que la envoltura siga sumando el ajuste de paquetes (y conserve las claves devoluciones_cent / devoluciones de esta rama).
create or replace function operacion.utilidad_periodo_sin_paquetes(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_ped bigint; v_prov boolean; v_n int; v_tomas bigint; v_gastos bigint; v_tardios bigint; v_dev bigint; v_dev_n int;
begin
  select coalesce(sum((n.snapshot_interno->'cascada'->>'utilidad_cent')::bigint), 0)::bigint, coalesce(bool_or((n.snapshot_interno->'cascada'->>'utilidad_provisional')::boolean), false), count(*)::int
    into v_ped, v_prov, v_n
  from operacion.pedido pe join operacion.nota n on n.id = (select max(x.id) from operacion.nota x where x.pedido_id = pe.id)
  where pe.estado = 'enviado' and pe.fecha_envio between p_ini and p_fin;
  -- Devoluciones de clientes: efecto = credito - costo de lo que volvio al inventario (lo que se fue a merma sigue siendo costo). Una anulada se contrarresta en la fecha de su anulacion.
  select coalesce(sum(x.efecto) filter (where x.fecha_neg between p_ini and p_fin), 0)::bigint - coalesce(sum(x.efecto) filter (where x.fecha_anulacion between p_ini and p_fin), 0)::bigint,
         count(*) filter (where x.fecha_neg between p_ini and p_fin)::int
    into v_dev, v_dev_n
    from (select d.fecha_neg, (d.monto_cent - coalesce((select sum(l.costo_valor_cent) from operacion.devolucion_cliente_linea l where l.devolucion_id = d.id and l.destino = 'inventario'), 0))::bigint as efecto,
                 (select e.fecha_neg from operacion.devolucion_cliente_anulacion a join operacion.evento e on e.id = a.evento_id where a.devolucion_id = d.id) as fecha_anulacion
            from operacion.devolucion_cliente d) x;
  v_ped := v_ped - v_dev;
  select coalesce(sum(t.piezas * t.precio_cent + m.valor_cent), 0)::bigint into v_tomas
    from operacion.toma_omar t join operacion.movimiento_inventario m on m.id = t.movimiento_id
   where t.estado = 'autorizada' and t.precio_cent is not null and t.fecha_neg between p_ini and p_fin;
  select coalesce(sum(g.monto_cent) filter (where g.fecha_neg between p_ini and p_fin), 0)::bigint
       - coalesce(sum(g.monto_cent) filter (where a.id is not null and coalesce(a.fecha_neg, g.fecha_neg) between p_ini and p_fin), 0)::bigint,
         coalesce(sum(g.monto_cent) filter (where g.fecha_origen is not null and g.fecha_neg between p_ini and p_fin and a.id is null), 0)::bigint
    into v_gastos, v_tardios
    from operacion.gasto g left join operacion.gasto_anulacion a on a.gasto_id = g.id
   where g.guia_id is null;
  return jsonb_build_object('utilidad_pedidos_cent', v_ped, 'pedidos', v_n, 'devoluciones_cent', -v_dev, 'devoluciones', v_dev_n, 'utilidad_tomas_cent', v_tomas, 'gastos_cent', v_gastos, 'ajustes_tardios_cent', v_tardios, 'provisional', v_prov,
                            'utilidad_cent', v_ped + v_tomas - v_gastos);
end $$;

-- "Explicar este numero" de la utilidad neta del periodo: ahora desglosa las devoluciones. Lo demas lo resuelve la funcion anterior.
alter function api.explicar_cifra(text) rename to explicar_cifra_antes_utilidad_neta;
revoke execute on function api.explicar_cifra_antes_utilidad_neta(text) from public, anon, authenticated;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); v_u jsonb; v_rengs jsonb; v_via2 bigint; v_paq bigint;
begin
  if partes[1] = 'cascada' and partes[2] = 'utilidad' then
    perform seguridad.exigir_rol(array['socio']);
    v_u := operacion.utilidad_periodo(partes[3]::date, partes[4]::date);
    v_paq := coalesce((v_u->>'ajuste_paquetes_cent')::bigint, 0);
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Utilidad de los pedidos enviados (' || (v_u->>'pedidos') || ')', 'monto_cent', (v_u->>'utilidad_pedidos_cent')::bigint - (v_u->>'devoluciones_cent')::bigint),
      jsonb_build_object('concepto', 'Devoluciones de clientes (' || (v_u->>'devoluciones') || '): credito menos el costo de lo que regreso a inventario', 'monto_cent', (v_u->>'devoluciones_cent')::bigint),
      jsonb_build_object('concepto', 'Utilidad de las tomas de Omar a su precio', 'monto_cent', (v_u->>'utilidad_tomas_cent')::bigint),
      jsonb_build_object('concepto', 'Gastos generales de la sociedad (incluidos los pagados por socios)', 'monto_cent', -((v_u->>'gastos_cent')::bigint + v_paq)),
      jsonb_build_object('concepto', 'Perdidas de paquetes (ajuste de utilidad)', 'monto_cent', v_paq));
    select coalesce(sum((x->>'monto_cent')::bigint), 0)::bigint into v_via2 from jsonb_array_elements(v_rengs) x;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Utilidad neta del periodo' || case when (v_u->>'provisional')::boolean then ' (provisional: hay guias sin costo)' else '' end, 'valor', (v_u->>'utilidad_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Funcion de utilidad del periodo', 'via1_valor', (v_u->>'utilidad_cent')::bigint, 'via2', 'Pedidos menos devoluciones, mas tomas, menos gastos', 'via2_valor', v_via2, 'cuadra', (v_u->>'utilidad_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  return api.explicar_cifra_antes_utilidad_neta(p_cifra);
end $$;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra(text) from public, anon;
