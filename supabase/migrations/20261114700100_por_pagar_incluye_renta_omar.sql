-- "Por pagar" incluye la renta de Omar como renglon aparte junto a Isaac y Karen (decision del dueno, 14-nov).
-- La renta YA esta en el libro (debe 6110 Renta de bodega, haber 2210 Renta por pagar a Omar; docs/pago-renta.md). Esta migracion NO crea asientos ni cambia el libro:
-- solo agrega una lectura de presentacion. Una sola definicion: operacion.por_pagar_renglones().
--   renglon de cada proveedor = deuda de la EMPRESA con el (operacion.posicion_proveedor: sin los pedidos a costo del socio de menudeo, que son a su cuenta), nunca negativa
--   renglon de Omar           = por pagar de la renta (operacion.renta_estado = saldo de la cuenta 2210), nunca negativo
--   total                     = suma de los renglones. Lo que esta a favor (proveedor o anticipo a Omar) NO se resta de otro renglon: se informa aparte en a_favor_cent.
-- Las identidades C1..C24 y el cuadre no cambian (no se toca ningun asiento ni auxiliar).
-- ADITIVA: funcion nueva, create or replace de api.pulso (misma firma, una llave nueva) y rename+wrap de agente.consulta (consulta nueva 'por_pagar'). Sin DROP; sin GRANT mas alla de los de cada funcion.

create function operacion.por_pagar_renglones() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare r record; v_pos jsonb; v_ren jsonb := '[]'::jsonb; v_total bigint := 0; v_fav bigint := 0; v_renta jsonb; v_c bigint;
begin
  for r in select p.id, p.nombre from catalogo.proveedor p where p.nombre in ('Isaac', 'Karen') order by case p.nombre when 'Isaac' then 1 else 2 end loop
    v_pos := operacion.posicion_proveedor(r.id);
    v_c := greatest((v_pos ->> 'deuda_empresa_cent')::bigint, 0);
    v_ren := v_ren || jsonb_build_array(jsonb_build_object('clave', lower(r.nombre), 'etiqueta', r.nombre, 'cent', v_c));
    v_total := v_total + v_c; v_fav := v_fav + greatest((v_pos ->> 'a_favor_empresa_cent')::bigint, 0);
  end loop;
  v_renta := operacion.renta_estado(negocio.hoy());
  v_c := greatest((v_renta ->> 'por_pagar_cent')::bigint, 0);
  v_ren := v_ren || jsonb_build_array(jsonb_build_object('clave', 'renta_omar', 'etiqueta', 'Renta de Omar', 'cent', v_c, 'piezas', (v_renta ->> 'piezas')::bigint));
  v_total := v_total + v_c; v_fav := v_fav + greatest((v_renta ->> 'a_favor_cent')::bigint, 0);
  return jsonb_build_object('total_cent', v_total, 'a_favor_cent', v_fav, 'renglones', v_ren);
end $$;

create function api.por_pagar() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.por_pagar_renglones();
end $$;
revoke execute on function api.por_pagar() from public, anon;
grant execute on function api.por_pagar() to authenticated;
revoke execute on function operacion.por_pagar_renglones() from public, anon, authenticated;

-- Inicio y barra: api.pulso agrega 'por_pagar' (el resto igual).
create or replace function api.pulso()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path = ''
as $$
declare
  v_isaac bigint := catalogo.proveedor_id('Isaac'); v_cxc bigint; v_cxc_ap bigint; v_hay_ap boolean; v_pedidos int; v_neto_a bigint; v_neto_j bigint; v_ia bigint; v_ij bigint; v_val bigint; v_pz bigint; v_mov int; v_socios_hay boolean;
begin
  perform seguridad.exigir_rol(array['socio']);
  select count(*) into v_pedidos from operacion.pedido where estado = 'enviado';
  select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0) into v_cxc from operacion.pedido pe where pe.estado = 'enviado';
  select coalesce(sum(greatest(a.saldo_cent, 0)), 0), count(*) > 0 into v_cxc_ap, v_hay_ap from operacion.cxc_apertura() a;
  select id into v_ia from catalogo.socio where nombre = 'Angelo';
  select id into v_ij from catalogo.socio where nombre = 'Javier';
  v_neto_a := operacion.neto_socio(v_ia); v_neto_j := operacion.neto_socio(v_ij);
  v_socios_hay := exists (select 1 from operacion.aportacion_socio) or exists (select 1 from operacion.cuenta_socio_mov) or exists (select 1 from operacion.compra where estado not in ('borrador', 'anulada'));
  select coalesce(sum(piezas), 0), coalesce(sum(valor_cent), 0), count(*) into v_pz, v_val, v_mov from operacion.existencia_modelo;
  return jsonb_build_object(
    -- Por pagar a Isaac = deuda de la EMPRESA: el total del libro (2110) menos los pedidos a costo del socio de menudeo aun sin pagar (a su cuenta). Aparte, esos pedidos.
    'por_pagar_isaac_cent', case when exists (select 1 from operacion.cuenta_proveedor_mov where proveedor_id = v_isaac) or exists (select 1 from operacion.compra where proveedor_id = v_isaac and estado not in ('borrador', 'anulada')) or contabilidad.saldo(contabilidad.cta_proveedor(v_isaac)) <> 0
                                 then (operacion.posicion_proveedor(v_isaac)->>'deuda_empresa_cent')::bigint end,
    'por_pagar_isaac_socio_cent', (operacion.posicion_proveedor(v_isaac)->>'menudeo_pendiente_cent')::bigint,
    'por_pagar', operacion.por_pagar_renglones(),
    'por_cobrar_cent', case when v_pedidos > 0 or v_hay_ap then v_cxc + v_cxc_ap end,
    'entre_socios', case when v_socios_hay then jsonb_build_object(
        'socio', case when v_neto_a >= v_neto_j then 'Angelo' else 'Javier' end,
        'diferencia_cent', greatest(v_neto_a, v_neto_j) - least(v_neto_a, v_neto_j)) end,
    'en_bodega', case when v_mov > 0 then jsonb_build_object('piezas', v_pz, 'valor_cent', v_val) end);
end $$

;

-- Bot: consulta 'por_pagar' (el resto de las consultas pasa igual por la funcion anterior).
alter function agente.consulta(text, bigint, text) rename to _consulta_sin_por_pagar;

create function agente.consulta(p_tipo text, p_modelo bigint default null, p_sujeto text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_pp jsonb;
begin
  if p_tipo <> 'por_pagar' then return agente._consulta_sin_por_pagar(p_tipo, p_modelo, p_sujeto); end if;
  perform notificacion.exigir_sistema();
  v_pp := operacion.por_pagar_renglones();
  return jsonb_build_object('titulo', 'Por pagar', 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', x ->> 'etiqueta', 'centavos', (x ->> 'cent')::bigint) order by o), '[]'::jsonb) from jsonb_array_elements(v_pp -> 'renglones') with ordinality as t(x, o))
    || jsonb_build_array(jsonb_build_object('etiqueta', 'Total por pagar', 'centavos', (v_pp ->> 'total_cent')::bigint))
    || case when (v_pp ->> 'a_favor_cent')::bigint > 0
            then jsonb_build_array(jsonb_build_object('etiqueta', 'Nota', 'texto', 'Hay saldo a favor (proveedor o anticipo a Omar) que no se resta de otro renglon.')) else '[]'::jsonb end);
end $$;
revoke all on function agente.consulta(text, bigint, text), agente._consulta_sin_por_pagar(text, bigint, text) from public, anon, authenticated, servidor;
grant execute on function agente.consulta(text, bigint, text) to servidor;
