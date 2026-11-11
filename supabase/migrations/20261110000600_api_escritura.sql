-- F1 / 0006: unica escritura de la web en F1: disponibilidad reversible de un modelo (sin disponibilidad <-> disponible).
create function api.fijar_disponibilidad(p_clave_idem text, p_modelo_id bigint, p_estado text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_nombre text;
begin
  perform seguridad.exigir_rol(array['socio']);
  select nombre_canonico into v_nombre from catalogo.modelo where id = p_modelo_id;
  if v_nombre is null then raise exception 'modelo desconocido' using errcode = '22023'; end if;
  return catalogo.fijar_disponibilidad(p_clave_idem, v_nombre, p_estado, null);
end $$;
revoke execute on function api.fijar_disponibilidad(text, bigint, text) from public, anon;
grant execute on function api.fijar_disponibilidad(text, bigint, text) to authenticated;
