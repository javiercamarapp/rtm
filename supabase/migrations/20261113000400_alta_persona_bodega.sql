-- Alta de la persona de bodega desde la web (solo socios). Sin ella "Marcar enviado" falla con "no hay persona de bodega configurada".
-- Es el cliente que presta la bodega (Omar): se elige un cliente existente. Aditiva: no toca datos ni funciones existentes. Idempotente por clave.
-- Decision del dueno: la interfaz no divide por socio; esta accion no recibe ni devuelve dueno.
create function operacion.registrar_persona_bodega(p_clave_idem text, p_cliente_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_nombre text; v_actual bigint; v_id bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_persona_bodega', 'c', p_cliente_id));
  if v_prev is not null then return v_prev; end if;
  select nombre_canonico into v_nombre from catalogo.cliente where id = p_cliente_id;
  if v_nombre is null then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  select cliente_id into v_actual from catalogo.persona_bodega order by id limit 1;
  if v_actual is not null and v_actual <> p_cliente_id then raise exception 'ya hay una persona de bodega configurada' using errcode = '23505'; end if;
  insert into catalogo.persona_bodega (cliente_id, nombre) values (p_cliente_id, v_nombre) on conflict (cliente_id) do nothing;
  select id into v_id from catalogo.persona_bodega where cliente_id = p_cliente_id;
  perform seguridad.registrar_auditoria('catalogo.persona_bodega', 'INSERT', v_id::text, null, jsonb_build_object('cliente_id', p_cliente_id, 'nombre', v_nombre), seguridad.canal_actual());
  v_res := jsonb_build_object('persona_bodega_id', v_id, 'cliente_id', p_cliente_id, 'nombre', v_nombre);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.registrar_persona_bodega(p_clave_idem text, p_cliente_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.registrar_persona_bodega(p_clave_idem => p_clave_idem, p_cliente_id => p_cliente_id); end $$;

revoke execute on function operacion.registrar_persona_bodega(text, bigint) from public, anon, authenticated;
revoke execute on function api.registrar_persona_bodega(text, bigint) from public, anon;
grant execute on function api.registrar_persona_bodega(text, bigint) to authenticated;
