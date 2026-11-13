-- Capital por socio en el reporte mensual (correo y PDF): lectura para el motor de reportes. Aditiva: NO toca rep.insumos_mensual (otras ramas lo extienden); el motor pide esta funcion aparte
-- y, si devuelve null (sin movimientos hasta el cierre del mes), la pagina de capital simplemente no sale. Misma fuente y mismas identidades que api.capital_por_mes.
create or replace function rep.capital_mensual(p_inicio date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_fin date := (p_inicio + interval '1 month' - interval '1 day')::date; v_primero date;
begin
  perform seguridad.exigir_socio_o_sistema();
  if extract(day from p_inicio) <> 1 then raise exception 'el reporte mensual inicia el dia 1' using errcode = '22023'; end if;
  select min(a.fecha_contable) into v_primero from contabilidad.asiento a;
  if v_primero is null or v_primero > v_fin then return null; end if;
  return jsonb_build_object('mes', operacion.cap_periodo(p_inicio, v_fin, v_fin >= negocio.hoy() and v_fin <> (date_trunc('month', v_fin) + interval '1 month - 1 day')::date),
                            'acumulado', operacion.cap_periodo(least(v_primero, p_inicio), v_fin, false));
end $$;

-- Privilegios: solo el rol servidor (el que genera los reportes).
revoke execute on function rep.capital_mensual(date) from public, anon, authenticated;
grant execute on function rep.capital_mensual(date) to servidor;
