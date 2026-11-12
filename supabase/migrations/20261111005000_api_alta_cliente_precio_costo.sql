-- Alta desde la web (solo socios): clientes, precios por cliente y costos por proveedor con vigencia e historial, y lectura del historial de costos.
-- Contrato: docs/pendiente-sql-alta.md de la rama feat/operar-alta-pulso-pulido. Todo monto viaja en centavos enteros.
-- Patron de api.fijar_disponibilidad (0006): SECURITY DEFINER, search_path vacio, exigir_rol socio en la primera linea, ids resueltos a nombres y llamada a la
-- funcion de `catalogo`, que ya cierra la vigencia anterior (nunca se borra nada) y rechaza vigencias retroactivas con P0422.
-- Decision del dueno (adenda 30): la interfaz NO divide por dueno. `catalogo.cliente.duenio_id` sigue siendo un dato interno obligatorio: un cliente nuevo
-- queda con el socio que lo crea. Ese dato no se muestra, no filtra y estas funciones no lo devuelven.

-- La nota del cliente (catalogo.cliente.nota) ya existe desde 0005. Topes de cordura de precios y costos: 100,000.00 por pieza (la base es la autoridad).
create function api.crear_cliente(p_clave_idem text, p_nombre text, p_tipo text, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_socio text; v_id bigint; v_creado boolean; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'api.crear_cliente', 'n', p_nombre, 't', p_tipo, 'no', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_tipo is null or p_tipo not in ('mayoreo', 'credito_interno', 'ocasional') then raise exception 'tipo de cliente invalido' using errcode = '22023'; end if;
  if catalogo.normalizar(p_nombre) = '' or char_length(btrim(p_nombre)) > 120 then raise exception 'nombre de cliente invalido' using errcode = '22023'; end if;
  if char_length(coalesce(p_nota, '')) > 1000 then raise exception 'la nota es demasiado larga' using errcode = '22023'; end if;
  -- Dato interno: el socio que crea el cliente. Nunca se recibe de la web.
  select u.socio_nombre into v_socio from seguridad.usuario u where u.id = auth.uid();
  select id into v_id from catalogo.cliente where nombre_norm = catalogo.normalizar(p_nombre);
  v_creado := v_id is null;
  if v_creado then
    v_id := catalogo.asegurar_cliente(p_nombre, v_socio, p_tipo);
    update catalogo.cliente set nota = nullif(btrim(p_nota), '') where id = v_id;
    perform seguridad.registrar_auditoria('catalogo.cliente', 'INSERT', v_id::text, null, jsonb_build_object('nombre', btrim(p_nombre), 'tipo', p_tipo), seguridad.canal_actual());
  end if;
  v_res := jsonb_build_object('cliente_id', v_id, 'creado', v_creado);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Cambia nombre canonico, tipo, nota y activo. Un parametro null conserva el valor actual (la nota vacia '' la borra). Desactivar no borra precios ni historial.
create function api.editar_cliente(p_clave_idem text, p_cliente_id bigint, p_nombre text, p_tipo text, p_nota text, p_activo boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; c catalogo.cliente; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'api.editar_cliente', 'c', p_cliente_id, 'n', p_nombre, 't', p_tipo, 'no', p_nota, 'a', p_activo));
  if v_prev is not null then return v_prev; end if;
  select * into c from catalogo.cliente where id = p_cliente_id for update;
  if not found then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  if p_tipo is not null and p_tipo not in ('mayoreo', 'credito_interno', 'ocasional') then raise exception 'tipo de cliente invalido' using errcode = '22023'; end if;
  if p_nombre is not null and (catalogo.normalizar(p_nombre) = '' or char_length(btrim(p_nombre)) > 120) then raise exception 'nombre de cliente invalido' using errcode = '22023'; end if;
  if char_length(coalesce(p_nota, '')) > 1000 then raise exception 'la nota es demasiado larga' using errcode = '22023'; end if;
  if p_nombre is not null and exists (select 1 from catalogo.cliente x where x.nombre_norm = catalogo.normalizar(p_nombre) and x.id <> c.id) then
    raise exception 'ya existe otro cliente con ese nombre' using errcode = '23505';
  end if;
  update catalogo.cliente set
    nombre_canonico = coalesce(btrim(p_nombre), nombre_canonico),
    tipo = coalesce(p_tipo, tipo),
    nota = case when p_nota is null then nota else nullif(btrim(p_nota), '') end,
    activo = coalesce(p_activo, activo)
  where id = c.id;
  perform seguridad.registrar_auditoria('catalogo.cliente', 'UPDATE', c.id::text,
    jsonb_build_object('nombre', c.nombre_canonico, 'tipo', c.tipo, 'activo', c.activo),
    jsonb_build_object('nombre', coalesce(btrim(p_nombre), c.nombre_canonico), 'tipo', coalesce(p_tipo, c.tipo), 'activo', coalesce(p_activo, c.activo)), seguridad.canal_actual());
  v_res := jsonb_build_object('cliente_id', c.id);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Precio del tabulador con vigencia. La fila abierta se cierra el dia en que empieza la nueva; el historial son las filas cerradas.
create function api.fijar_precio(p_clave_idem text, p_cliente_id bigint, p_modelo_id bigint, p_precio_cent bigint, p_desde date, p_origen text, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_cliente text; v_modelo text; v_desde date := coalesce(p_desde, negocio.hoy());
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_precio_cent is null or p_precio_cent <= 0 or p_precio_cent > 10000000 then raise exception 'precio fuera de rango (mayor que 0 y hasta 100,000.00)' using errcode = '23514'; end if;
  if p_origen is null or p_origen not in ('documento', 'chat', 'lista_javier') then raise exception 'origen de precio invalido' using errcode = '22023'; end if;
  select nombre_canonico into v_cliente from catalogo.cliente where id = p_cliente_id;
  select nombre_canonico into v_modelo from catalogo.modelo where id = p_modelo_id;
  if v_cliente is null or v_modelo is null then raise exception 'cliente o modelo desconocido' using errcode = '22023'; end if;
  -- Sin fila abierta pero con una vigencia cerrada que cubre la fecha: seria un traslape (23P01); se dice como lo que es, una vigencia retroactiva.
  if not exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null)
     and not exists (select 1 from catalogo.tabulador_precio where cliente_id = p_cliente_id and modelo_id = p_modelo_id and vigente_hasta is null)
     and exists (select 1 from catalogo.tabulador_precio where cliente_id = p_cliente_id and modelo_id = p_modelo_id and vigente_hasta > v_desde) then
    raise exception 'vigencia retroactiva: ya hay un precio con vigencia posterior a %', v_desde using errcode = 'P0422';
  end if;
  return catalogo.fijar_precio(p_clave_idem, v_cliente, v_modelo, p_precio_cent, v_desde, p_origen, nullif(btrim(p_nota), ''));
end $$;

-- Costo por proveedor con vigencia. Si no es el costo de lista, el motivo es obligatorio.
create function api.fijar_costo(p_clave_idem text, p_proveedor text, p_modelo_id bigint, p_costo_cent bigint, p_desde date, p_fuente text, p_motivo text,
                                p_supuesto boolean, p_es_lista boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_modelo text; v_desde date := coalesce(p_desde, negocio.hoy()); v_lista boolean := coalesce(p_es_lista, true);
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_costo_cent is null or p_costo_cent <= 0 or p_costo_cent > 10000000 then raise exception 'costo fuera de rango (mayor que 0 y hasta 100,000.00)' using errcode = '23514'; end if;
  if p_proveedor is null or p_proveedor not in ('Isaac', 'Karen') then raise exception 'proveedor invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_fuente), '') is null then raise exception 'la fuente del costo es obligatoria' using errcode = '23502'; end if;
  if not v_lista and nullif(btrim(p_motivo), '') is null then raise exception 'un costo que no es de lista exige motivo' using errcode = '23514'; end if;
  select nombre_canonico into v_modelo from catalogo.modelo where id = p_modelo_id;
  if v_modelo is null then raise exception 'modelo desconocido' using errcode = '22023'; end if;
  return catalogo.fijar_costo(p_clave_idem, p_proveedor, v_modelo, p_costo_cent, v_desde, btrim(p_fuente), nullif(btrim(p_motivo), ''), coalesce(p_supuesto, false), v_lista);
end $$;

-- Historial completo de costos de un modelo, de la fila mas reciente a la mas antigua.
create function api.costo_historial(p_modelo_id bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  if not exists (select 1 from catalogo.modelo where id = p_modelo_id) then raise exception 'modelo desconocido' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('proveedor', p.nombre, 'costo_cent', c.costo_cent, 'desde', c.vigente_desde, 'hasta', c.vigente_hasta, 'fuente', c.fuente,
                                        'es_lista', c.es_lista, 'motivo', c.motivo, 'supuesto', c.supuesto, 'vigente', c.vigente_hasta is null)
                     order by c.vigente_desde desc, c.id desc)
    from catalogo.costo_proveedor c join catalogo.proveedor p on p.id = c.proveedor_id where c.modelo_id = p_modelo_id), '[]'::jsonb);
end $$;

revoke execute on function api.crear_cliente(text, text, text, text), api.editar_cliente(text, bigint, text, text, text, boolean),
  api.fijar_precio(text, bigint, bigint, bigint, date, text, text), api.fijar_costo(text, text, bigint, bigint, date, text, text, boolean, boolean),
  api.costo_historial(bigint) from public, anon;
grant execute on function api.crear_cliente(text, text, text, text), api.editar_cliente(text, bigint, text, text, text, boolean),
  api.fijar_precio(text, bigint, bigint, bigint, date, text, text), api.fijar_costo(text, text, bigint, bigint, date, text, text, boolean, boolean),
  api.costo_historial(bigint) to authenticated;
