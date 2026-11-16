-- Libro propio de llamadas de IA por mes, para la pagina Costos del sistema: se compara EN VIVO contra lo que reporta OpenRouter para la llave de RTM y, al cerrar el ciclo, contra el cargo.
-- Solo lectura, solo socio. Cuenta unicamente llamadas liquidadas (las reservadas y fallidas no son consumo). Aditiva.
create function api.costos_ia_libro(p_mes text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_mes text := coalesce(nullif(btrim(p_mes), ''), to_char(negocio.hoy(), 'YYYY-MM'));
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'mes invalido' using errcode = '22023'; end if;
  return jsonb_build_object(
    'mes', v_mes,
    'total_micro', coalesce((select sum(l.costo_usd_micro) from ia.llamada l where l.estado = 'liquidada' and to_char(negocio.fecha_neg(l.ts), 'YYYY-MM') = v_mes), 0),
    'llamadas', (select count(*) from ia.llamada l where l.estado = 'liquidada' and to_char(negocio.fecha_neg(l.ts), 'YYYY-MM') = v_mes),
    'por_rol', coalesce((select jsonb_object_agg(x.rol, x.micro) from (select l.rol, sum(l.costo_usd_micro) micro from ia.llamada l where l.estado = 'liquidada' and to_char(negocio.fecha_neg(l.ts), 'YYYY-MM') = v_mes group by l.rol) x), '{}'::jsonb),
    'ultima_at', (select max(l.ts) from ia.llamada l where l.estado = 'liquidada'));
end $$;
revoke execute on function api.costos_ia_libro(text) from public, anon;
grant execute on function api.costos_ia_libro(text) to authenticated;
