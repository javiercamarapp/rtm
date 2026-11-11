-- Dinero entre socios / 4: 'Explicar este numero' del resultado de la cascada con las reglas nuevas (sin devolucion automatica de capital, con anticipos).
create or replace function api.explicar_cifra(p_cifra text) returns jsonb
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
    v_c := operacion.cascada_periodo(partes[4]::date, partes[5]::date);
    v_x := v_c->'por_socio'->partes[3];
    if v_x is null then raise exception 'socio desconocido' using errcode = '22023'; end if;
    v_rengs := jsonb_build_array(
      jsonb_build_object('concepto', 'Reembolso de gastos pagados', 'monto_cent', (v_x->>'paga_reembolso_cent')::bigint),
      jsonb_build_object('concepto', 'Su parte de la utilidad repartible (50/50 fijo)', 'monto_cent', (v_x->>'utilidad_cent')::bigint),
      jsonb_build_object('concepto', 'Menos lo que ya recibio como retiro anticipado', 'monto_cent', -(v_x->>'anticipo_cent')::bigint),
      jsonb_build_object('concepto', 'Menos lo que ya tiene en su poder o debe a la sociedad', 'monto_cent', -(v_x->>'debe_cent')::bigint));
    v_via2 := (v_x->>'paga_reembolso_cent')::bigint + (v_x->>'utilidad_cent')::bigint - (v_x->>'anticipo_cent')::bigint - (v_x->>'debe_cent')::bigint;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Resultado de ' || partes[3] || ' en la cascada (+ recibe, - entrega)', 'valor', (v_x->>'resultado_cent')::bigint, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Cascada calculada', 'via1_valor', (v_x->>'resultado_cent')::bigint, 'via2', 'Suma de los pasos de este socio', 'via2_valor', v_via2, 'cuadra', (v_x->>'resultado_cent')::bigint = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  return api.explicar_cifra_f2(p_cifra);
end $$;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra(text) from public, anon;
