-- Pulido final (14-nov), inventario. Migracion ADITIVA:
--  (1) api.inventario_concilia(): comprobacion visible 'Concilia con el libro' (kardex valorizado = cuenta 1310; piezas del kardex = existencia mostrada) y el ultimo conteo fisico
--      con sus diferencias por sabor y estado Conciliado / con diferencias abiertas / sin conteo. Solo lectura.
--  (2) Conteo con sabores NUEVOS: la hoja incluye todos los sabores de los modelos con existencia (aunque ese sabor nunca se haya surtido en la ubicacion) y un socio puede dar de alta
--      un sabor nuevo desde la hoja (api.conteo_agregar_sabor). Alta validada, idempotente, con deteccion de parecidos (coincidencia aproximada por distancia de edicion), topes por hora y dia y auditoria.
--      El nucleo (catalogo.alta_sabor) lo reutiliza el agente de Telegram. Un SKU nuevo nace sin costo propio: usa el costo promedio del modelo; el costo de lista del modelo no cambia.
-- cerrar_conteo no cambia: un SKU nuevo entra con esperado 0 y, por modelo, el valor del ajuste neto sigue siendo el del costo promedio de las piezas netas (diferencias +10/-10 con neto 0 no mueven el valor).

-- Distancia de edicion (Levenshtein) simple y determinista; los nombres son cortos. Sin extensiones.
create function catalogo.distancia_edicion(a text, b text) returns int
language plpgsql immutable parallel safe set search_path = ''
as $$
declare la int := char_length(a); lb int := char_length(b); prev int[]; cur int[]; i int; j int; costo int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      costo := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + costo);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- Umbral documentado: nombre normalizado con distancia <= 2 y <= 30 % de la longitud del mas largo, o uno contenido en el otro (palabras completas). Nunca el mismo nombre.
create function catalogo.parecido(p_a text, p_b text) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select p_a <> p_b and (
    catalogo.distancia_edicion(p_a, p_b) <= least(2, greatest(1, (greatest(char_length(p_a), char_length(p_b)) * 30) / 100))
    or (char_length(least(p_a, p_b)) >= 4 and (' ' || p_a || ' ') like '%' || ' ' || p_b || ' ' || '%' )
    or (char_length(least(p_a, p_b)) >= 4 and (' ' || p_b || ' ') like '%' || ' ' || p_a || ' ' || '%' ))
$$;

create function catalogo.sabores_parecidos(p_texto text, p_limite int default 3) returns table (sabor_id bigint, nombre text, distancia int)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.nombre_canonico, catalogo.distancia_edicion(s.nombre_norm, catalogo.normalizar(p_texto)) as d
    from catalogo.sabor s where catalogo.parecido(s.nombre_norm, catalogo.normalizar(p_texto))
   order by d, s.nombre_canonico limit greatest(p_limite, 1)
$$;

-- Nombre de un alta asistida: tratado SIEMPRE como dato. Longitud, caracteres y nada que parezca una instruccion, una etiqueta o un enlace.
create function catalogo.nombre_alta_valido(p_texto text, p_max int default 40) returns text
language plpgsql immutable parallel safe set search_path = ''
as $$
declare v text := regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g');
begin
  if char_length(v) < 2 or char_length(v) > p_max then raise exception 'el nombre debe tener entre 2 y % caracteres', p_max using errcode = '22023'; end if;
  if v !~ '^[[:alpha:]0-9][[:alpha:]0-9 .''&+/%-]*$' then raise exception 'el nombre trae caracteres no permitidos' using errcode = '22023'; end if;
  if v ~* '(ignora|ignore|instrucc|instruction|system|prompt|http|www\.|\.com|@|script|drop table|select )' then raise exception 'el nombre no puede parecer una instruccion, un enlace o un correo' using errcode = '22023'; end if;
  return v;
end $$;

-- Alta asistida de un sabor (SKU) para un modelo existente. Idempotente por clave; tope por actor: 10 por hora y 30 por dia; si hay sabores parecidos y no se confirma, NO escribe y los devuelve.
create function catalogo.alta_sabor(p_clave_idem text, p_modelo_id bigint, p_sabor text, p_canal text default 'web', p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_sabor text; v_modelo catalogo.modelo; v_norm text; v_sku bigint; v_sabor_id bigint; v_par jsonb; v_hora int; v_dia int; v_res jsonb; v_existia boolean;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_canal not in ('web', 'telegram', 'importacion') then raise exception 'canal invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_sabor := catalogo.nombre_alta_valido(p_sabor, 40);
  v_norm := catalogo.normalizar(v_sabor);
  if v_norm = '' then raise exception 'el nombre trae caracteres no permitidos' using errcode = '22023'; end if;
  select * into v_modelo from catalogo.modelo where id = p_modelo_id;
  if not found then raise exception 'modelo desconocido' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'alta_sabor', 'm', p_modelo_id, 's', v_norm, 'c', p_confirmar));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select id into v_sabor_id from catalogo.sabor where nombre_norm = v_norm;
  if v_sabor_id is not null then
    select id into v_sku from catalogo.sku where modelo_id = p_modelo_id and sabor_id = v_sabor_id;
    if v_sku is not null then
      v_res := jsonb_build_object('estado', 'existente', 'sku_id', v_sku, 'modelo', v_modelo.nombre_canonico, 'sabor', (select nombre_canonico from catalogo.sabor where id = v_sabor_id));
      perform seguridad.terminar_operacion(p_clave_idem, v_res);
      return v_res;
    end if;
  else
    -- Sabor que no existe: si se parece a uno que si (error de dedo) se pregunta antes de crear.
    select coalesce(jsonb_agg(jsonb_build_object('sabor_id', q.sabor_id, 'nombre', q.nombre) order by q.distancia, q.nombre), '[]'::jsonb) into v_par from catalogo.sabores_parecidos(v_sabor, 3) q;
    if jsonb_array_length(v_par) > 0 and not p_confirmar then
      v_res := jsonb_build_object('estado', 'parecidos', 'parecidos', v_par, 'sabor', v_sabor, 'modelo', v_modelo.nombre_canonico);
      -- No se guarda la operacion: el socio puede repetirla con p_confirmar o elegir uno de los parecidos.
      delete from seguridad.operacion where clave = p_clave_idem;
      return v_res;
    end if;
  end if;

  select count(*) filter (where ocurrio_en > now() - interval '1 hour'), count(*) filter (where ocurrio_en > now() - interval '1 day') into v_hora, v_dia
    from seguridad.auditoria where tabla = 'catalogo.sku' and accion = 'ALTA_ASISTIDA' and actor is not distinct from auth.uid();
  if v_hora >= 10 then raise exception 'tope de altas por hora alcanzado (10)' using errcode = '54000'; end if;
  if v_dia >= 30 then raise exception 'tope de altas por dia alcanzado (30)' using errcode = '54000'; end if;

  v_existia := v_sabor_id is not null;
  if v_sabor_id is null then insert into catalogo.sabor (nombre_canonico) values (v_sabor) returning id into v_sabor_id; end if;
  insert into catalogo.sku (modelo_id, sabor_id) values (p_modelo_id, v_sabor_id) on conflict (modelo_id, sabor_id) do nothing;
  select id into v_sku from catalogo.sku where modelo_id = p_modelo_id and sabor_id = v_sabor_id;
  perform seguridad.registrar_auditoria('catalogo.sku', 'ALTA_ASISTIDA', v_sku::text, null,
    jsonb_build_object('modelo_id', p_modelo_id, 'sabor', v_sabor, 'sabor_nuevo', not v_existia, 'origen', p_canal), p_canal);
  v_res := jsonb_build_object('estado', 'creado', 'sku_id', v_sku, 'modelo', v_modelo.nombre_canonico, 'sabor', v_sabor, 'sabor_nuevo', not v_existia,
                              'falta_costo_lista', not exists (select 1 from catalogo.costo_proveedor c where c.modelo_id = p_modelo_id));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.conteo_agregar_sabor(p_clave_idem text, p_modelo_id bigint, p_sabor text, p_confirmar boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return catalogo.alta_sabor(p_clave_idem, p_modelo_id, p_sabor, 'web', coalesce(p_confirmar, false));
end $$;

-- La hoja incluye todos los sabores de los modelos que tienen existencia en la ubicacion, aunque ese sabor nunca se haya surtido ahi (cuenta 0 contra el sistema).
create or replace function api.conteo_hoja(p_ubicacion text default 'bodega_omar') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((select jsonb_agg(jsonb_build_object('sku_id', k.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'modelo_id', m.id) order by ma.nombre, m.nombre_canonico, sa.nombre_canonico)
    from catalogo.sku k join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
   where exists (select 1 from operacion.existencia_sku_ubicacion u join catalogo.sku k2 on k2.id = u.sku_id where u.ubicacion = p_ubicacion and k2.modelo_id = k.modelo_id)), '[]'::jsonb);
end $$;

-- Comprobacion de conciliacion del inventario.
create function api.inventario_concilia() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_kardex_valor bigint; v_kardex_piezas bigint; v_libro bigint; v_exist_valor bigint; v_exist_piezas bigint; c operacion.conteo; v_ult jsonb := null; v_difs jsonb; v_abiertas int := 0; v_estado text;
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(sum(valor_cent), 0), coalesce(sum(cantidad), 0) into v_kardex_valor, v_kardex_piezas from operacion.movimiento_inventario;
  v_libro := contabilidad.saldo('1310');
  select coalesce(sum(valor_cent), 0), coalesce(sum(piezas), 0) into v_exist_valor, v_exist_piezas from operacion.existencia_modelo;
  select * into c from operacion.conteo where estado = 'cerrado' order by contado_at desc, id desc limit 1;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'esperado', l.esperado_sistema, 'contado', l.contado, 'diferencia', l.diferencia,
             'explicada', l.explicacion_tipo is not null) order by m.nombre_canonico, sa.nombre_canonico) filter (where l.diferencia <> 0), '[]'::jsonb),
           count(*) filter (where l.diferencia <> 0 and l.explicacion_tipo is null)
      into v_difs, v_abiertas
      from operacion.conteo_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.conteo_id = c.id;
    v_ult := jsonb_build_object('id', c.id, 'contado_at', c.contado_at, 'ubicacion', c.ubicacion, 'diferencias', v_difs, 'sabores_con_diferencia', jsonb_array_length(v_difs),
              'abiertas', v_abiertas, 'neto_piezas', (select coalesce(sum(l.diferencia), 0) from operacion.conteo_linea l where l.conteo_id = c.id),
              'ajuste_valor_cent', (select coalesce(sum(mi.valor_cent), 0) from operacion.conteo_linea l join operacion.movimiento_inventario mi on mi.id = l.movimiento_ajuste_id where l.conteo_id = c.id));
  end if;
  v_estado := case when v_ult is null then 'sin_conteo' when v_abiertas > 0 then 'diferencias_abiertas' else 'conciliado' end;
  return jsonb_build_object('hoy', negocio.hoy(),
    'valor', jsonb_build_object('kardex_cent', v_kardex_valor, 'libro_1310_cent', v_libro, 'existencia_cent', v_exist_valor, 'ok', v_kardex_valor = v_libro and v_exist_valor = v_libro),
    'piezas', jsonb_build_object('kardex', v_kardex_piezas, 'existencia', v_exist_piezas, 'ok', v_kardex_piezas = v_exist_piezas),
    'concilia', v_kardex_valor = v_libro and v_exist_valor = v_libro and v_kardex_piezas = v_exist_piezas,
    'ultimo_conteo', v_ult, 'estado_conteo', v_estado);
end $$;

revoke execute on function catalogo.distancia_edicion(text, text), catalogo.parecido(text, text), catalogo.sabores_parecidos(text, int), catalogo.nombre_alta_valido(text, int),
  catalogo.alta_sabor(text, bigint, text, text, boolean) from public, anon;
grant execute on function catalogo.distancia_edicion(text, text), catalogo.parecido(text, text), catalogo.sabores_parecidos(text, int), catalogo.nombre_alta_valido(text, int),
  catalogo.alta_sabor(text, bigint, text, text, boolean) to authenticated;
revoke execute on function api.conteo_agregar_sabor(text, bigint, text, boolean), api.inventario_concilia() from public, anon;
grant execute on function api.conteo_agregar_sabor(text, bigint, text, boolean), api.inventario_concilia() to authenticated;
