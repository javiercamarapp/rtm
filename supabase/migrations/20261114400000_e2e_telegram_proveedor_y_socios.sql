-- Correcciones de la campana E2E maestra (13-nov), Telegram: la cuenta con un proveedor y la cuenta entre socios.
--  * /saldo isaac y /saldo karen no respondian con base real (la resolucion nunca llevaba el proveedor, ver resolucion.ts); aqui la consulta 'proveedor' deja de mezclar signos:
--    deuda de la empresa + pedidos del socio de menudeo (aparte) = total del libro, todo con deuda positiva.
--  * /saldo socios decia 'Javier le debe a Angelo: -$23,960.96' mientras la pantalla de Socios dice que Angelo debe igualar la diferencia de aportaciones netas. Ahora lee la funcion unica
--    agente.igualacion() (api.socios_aportacion_neta): aportacion neta de cada socio y diferencia a igualar, sin lenguaje de deuda ni redondeo propio.
-- ADITIVA: reemplaza solo agente.consulta (funcion del propio agente; misma firma y permisos). Sin GRANT nuevo.

create or replace function agente.consulta(p_tipo text, p_modelo bigint default null, p_sujeto text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_res jsonb; v_ig jsonb; v_socio bigint; v_nombre text; v_hoy date := negocio.hoy(); v_ini date; v_u jsonb; v_total bigint;
begin
  perform notificacion.exigir_sistema();
  if p_tipo = 'inventario' then
    select jsonb_build_object('titulo', 'Existencia', 'lineas', coalesce(jsonb_agg(jsonb_build_object('etiqueta', m.nombre_canonico, 'piezas', e.piezas) order by m.nombre_canonico), '[]'::jsonb)) into v_res
      from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where e.piezas > 0 and (p_modelo is null or m.id = p_modelo);
  elsif p_tipo = 'socios' then
    -- Una sola regla (la misma de la pantalla de Socios): la aportacion neta de cada socio y la diferencia a igualar. NO es una deuda ni un reembolso: se resuelve con las
    -- siguientes aportaciones del socio que lleva menos. Todo sale de agente.igualacion() (api.socios_aportacion_neta), sin un segundo calculo ni un redondeo propio.
    v_ig := agente.igualacion();
    v_res := jsonb_build_object('titulo', 'Aportaciones entre socios', 'lineas',
      (select coalesce(jsonb_agg(jsonb_build_object('etiqueta', 'Aportacion neta de ' || (x ->> 'socio'), 'centavos', (x ->> 'aportacion_neta_cent')::bigint) order by x ->> 'socio'), '[]'::jsonb)
         from jsonb_array_elements(v_ig -> 'socios') x)
      || case when (v_ig ->> 'igualados')::boolean then jsonb_build_array(jsonb_build_object('etiqueta', 'Estado', 'texto', 'Aportaciones igualadas'))
              else jsonb_build_array(
                jsonb_build_object('etiqueta', 'Diferencia a igualar', 'centavos', (v_ig ->> 'diferencia_cent')::bigint),
                jsonb_build_object('etiqueta', 'Lleva mas aportado', 'texto', v_ig ->> 'lleva_mas'),
                jsonb_build_object('etiqueta', 'Le toca aportar el siguiente pago', 'texto', v_ig ->> 'le_toca_aportar'),
                jsonb_build_object('etiqueta', 'Nota', 'texto', 'La diferencia no es una deuda ni un reembolso: se resuelve con las siguientes aportaciones del que lleva menos.')) end);
  elsif p_tipo = 'cuenta_cliente' then
    select jsonb_build_object('titulo', 'Saldo de ' || c.nombre_canonico, 'lineas', jsonb_build_array(jsonb_build_object('etiqueta', 'Por cobrar', 'centavos', operacion.saldo_cliente(c.id)))) into v_res
      from catalogo.cliente c where c.id = p_modelo;
  elsif p_tipo = 'proveedor' then
    -- Posicion unica con el proveedor, SIEMPRE en el mismo sentido (positivo = se le debe): deuda de la empresa + pedidos del socio de menudeo pendientes (aparte, a su cuenta)
    -- = total segun el libro. Un renglon negativo significa a favor de la empresa; entonces se dice en una nota.
    select jsonb_build_object('titulo', 'Cuenta con ' || p.nombre, 'lineas', jsonb_build_array(
             jsonb_build_object('etiqueta', 'Deuda de la empresa', 'centavos', -(q.pos ->> 'posicion_empresa_cent')::bigint),
             jsonb_build_object('etiqueta', 'Mas: pedidos del socio de menudeo pendientes de pago (a su cuenta, aparte)', 'centavos', (q.pos ->> 'menudeo_pendiente_cent')::bigint),
             jsonb_build_object('etiqueta', 'Total segun el libro (lo que se le debe)', 'centavos', -(q.pos ->> 'posicion_cent')::bigint))
           || case when (q.pos ->> 'posicion_empresa_cent')::bigint > 0 or (q.pos ->> 'posicion_cent')::bigint > 0
                   then jsonb_build_array(jsonb_build_object('etiqueta', 'Nota', 'texto', 'Un monto negativo es a favor de la empresa: el proveedor le debe a la empresa.')) else '[]'::jsonb end) into v_res
      from catalogo.proveedor p cross join lateral (select operacion.posicion_proveedor(p.id) as pos) q where p.nombre = initcap(p_sujeto);
  elsif p_tipo = 'estado_socio' then
    select id, nombre into v_socio, v_nombre from catalogo.socio where nombre = initcap(p_sujeto);
    if v_socio is null then raise exception 'socio desconocido: dime si es Angelo o Javier' using errcode = '22023'; end if;
    v_res := jsonb_build_object('titulo', 'Estado de cuenta de ' || v_nombre, 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Posicion neta', 'centavos', operacion.neto_socio(v_socio)),
      jsonb_build_object('etiqueta', 'Reembolso pendiente', 'centavos', operacion.reembolso_pendiente(v_socio)),
      jsonb_build_object('etiqueta', 'Aportacion pendiente de devolver', 'centavos', operacion.aportacion_pendiente(v_socio)),
      jsonb_build_object('etiqueta', 'Capital aportado', 'centavos', operacion.aportado_socio(v_socio, 'capital')),
      jsonb_build_object('etiqueta', 'Utilidad asignada por distribuir', 'centavos', operacion.utilidad_por_distribuir(v_socio)),
      jsonb_build_object('etiqueta', 'Lo que debe a la sociedad', 'centavos', operacion.saldo_socio(v_socio))));
  elsif p_tipo = 'utilidad' then
    v_ini := case lower(coalesce(p_sujeto, 'mes')) when 'hoy' then v_hoy when 'semana' then v_hoy - 6 else date_trunc('month', v_hoy)::date end;
    v_u := operacion.utilidad_periodo(v_ini, v_hoy);
    v_res := jsonb_build_object('titulo', 'Utilidad operativa (' || coalesce(p_sujeto, 'mes') || ')', 'lineas', jsonb_build_array(
      jsonb_build_object('etiqueta', 'Utilidad de pedidos', 'centavos', (v_u ->> 'utilidad_pedidos_cent')::bigint),
      jsonb_build_object('etiqueta', 'Utilidad de tomas de Omar', 'centavos', (v_u ->> 'utilidad_tomas_cent')::bigint),
      jsonb_build_object('etiqueta', 'Gastos generales', 'centavos', (v_u ->> 'gastos_cent')::bigint),
      jsonb_build_object('etiqueta', 'Utilidad operativa', 'centavos', (v_u ->> 'utilidad_cent')::bigint),
      jsonb_build_object('etiqueta', 'Nota', 'texto', case when (v_u ->> 'provisional')::boolean then 'Aproximacion operativa y provisional: hay pedidos con costos por confirmar.' else 'Aproximacion operativa; la cifra contable esta en el software.' end)));
  elsif p_tipo = 'cartera' then
    select coalesce(sum(s.saldo), 0)::bigint into v_total from (select operacion.saldo_cliente(c.id) + coalesce(operacion.apertura_cxc_cliente(c.id), 0) as saldo from catalogo.cliente c where c.activo) s where s.saldo > 0;
    v_res := jsonb_build_object('titulo', 'Cuanto debe cada cliente', 'lineas',
      coalesce((select jsonb_agg(jsonb_build_object('etiqueta', q.nombre, 'centavos', q.saldo) order by q.saldo desc, q.nombre)
                  from (select c.nombre_canonico as nombre, operacion.saldo_cliente(c.id) + coalesce(operacion.apertura_cxc_cliente(c.id), 0) as saldo from catalogo.cliente c where c.activo) q where q.saldo > 0), '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('etiqueta', 'Total por cobrar', 'centavos', v_total)));
  else
    raise exception 'consulta desconocida' using errcode = '22023';
  end if;
  return coalesce(v_res, jsonb_build_object('titulo', 'Sin datos', 'lineas', '[]'::jsonb));
end $$;
