-- Liga un modelo de la tienda de Karen (por su identificador corto) con un modelo del catalogo propio, por decision de un socio. ADITIVA: solo una funcion nueva.
-- No crea ni une modelos: solo escribe canonico_id y mapeo='confirmado' en proveedores.modelo (que el vigilante conserva en cada pasada). Idempotente.
create function proveedores.ligar_modelo_karen(p_handle text, p_modelo bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if not exists (select 1 from catalogo.modelo where id = p_modelo and unificado_en is null) then
    raise exception 'modelo del catalogo desconocido: %', p_modelo using errcode = '22023';
  end if;
  update proveedores.modelo set canonico_id = p_modelo::text, mapeo = 'confirmado'
   where handle = p_handle and (canonico_id is distinct from p_modelo::text or mapeo <> 'confirmado');
  get diagnostics v_n = row_count;
  return jsonb_build_object('actualizados', v_n, 'existe', exists (select 1 from proveedores.modelo where handle = p_handle));
end $$;
revoke execute on function proveedores.ligar_modelo_karen(text, bigint) from public, anon, authenticated;
grant execute on function proveedores.ligar_modelo_karen(text, bigint) to servidor;
