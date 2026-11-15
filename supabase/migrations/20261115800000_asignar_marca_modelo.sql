-- Atar la marca de un modelo del catalogo (decision del dueno, 14-nov: varios modelos salen como 'Sin marca').
-- ADITIVA: una funcion nueva. No existe ninguna funcion oficial que cambie catalogo.modelo.marca_id (asegurar_modelo solo inserta), asi que esta es la unica via controlada.
--
-- catalogo.asignar_marca_modelo(clave_idem, modelo_id, marca)
--  * Solo socio o canal de importacion (mismo criterio que asegurar_modelo / asegurar_marca). Idempotente por clave (misma clave con otro contenido = conflicto P0409).
--  * Solo reasigna un modelo cuya marca actual es 'Sin marca': nunca re-clasifica un modelo que ya tiene marca real (P0428).
--  * La marca destino se asegura con catalogo.asegurar_marca (la crea si no existe) y no puede ser 'Sin marca'.
--  * Si el modelo ya tiene esa marca no cambia nada (sin_cambio). No toca nombre, puffs, precios, costos, kardex ni asientos: solo marca_id.
--  * Auditoria en seguridad.auditoria (antes y despues).
create function catalogo.asignar_marca_modelo(p_clave_idem text, p_modelo_id bigint, p_marca text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_marca text; v_m catalogo.modelo; v_antes text; v_dest bigint; v_sin bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if nullif(btrim(coalesce(p_clave_idem, '')), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_marca := nullif(btrim(coalesce(p_marca, '')), '');
  if v_marca is null or char_length(v_marca) > 60 then raise exception 'indica la marca (hasta 60 caracteres)' using errcode = '22023'; end if;
  if catalogo.normalizar(v_marca) = 'sin marca' then raise exception 'la marca destino no puede ser "Sin marca"' using errcode = '22023'; end if;

  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'asignar_marca_modelo', 'm', p_modelo_id, 'marca', catalogo.normalizar(v_marca)));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into v_m from catalogo.modelo where id = p_modelo_id for update;
  if not found then raise exception 'modelo desconocido: %', p_modelo_id using errcode = '22023'; end if;
  select nombre into v_antes from catalogo.marca where id = v_m.marca_id;
  select id into v_sin from catalogo.marca where nombre_norm = 'sin marca';
  v_dest := catalogo.asegurar_marca(v_marca);

  if v_m.marca_id = v_dest then
    v_res := jsonb_build_object('estado', 'sin_cambio', 'modelo', v_m.nombre_canonico, 'marca', v_antes);
  elsif v_m.marca_id is distinct from v_sin then
    raise exception 'el modelo % ya tiene la marca %: no se reclasifica', v_m.nombre_canonico, v_antes using errcode = 'P0428';
  else
    update catalogo.modelo set marca_id = v_dest where id = v_m.id;
    perform seguridad.registrar_auditoria('catalogo.modelo', 'UPDATE', v_m.id::text, jsonb_build_object('marca', v_antes), jsonb_build_object('marca', (select nombre from catalogo.marca where id = v_dest)), seguridad.canal_actual());
    v_res := jsonb_build_object('estado', 'asignado', 'modelo', v_m.nombre_canonico, 'antes', v_antes, 'marca', (select nombre from catalogo.marca where id = v_dest));
  end if;
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Solo la llama el script de atado (conexion propietaria) o un socio por SQL: la web no la ejecuta directo.
revoke execute on function catalogo.asignar_marca_modelo(text, bigint, text) from public, anon, authenticated;
