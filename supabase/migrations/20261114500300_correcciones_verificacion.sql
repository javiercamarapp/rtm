-- Correcciones de la verificacion independiente de feat/pulido-final. Migracion NUEVA y aditiva (create or replace; permisos sin cambio):
--  * api.bodega_llegadas ya NO emite 'proveedor' (decision del dueno: bodega no ve el nombre del proveedor; antes solo lo ocultaba el parser web). api.bodega_hoy_a_preparar no lleva proveedor.
--    Las guias de entrada solo traen paqueteria y numero (texto de captura; si alguien escribe ahi el nombre de un proveedor, es dato de captura y no se filtra).
--  * operacion.cerrar_conteo: defecto ya existente en main. Al contar en cero un modelo con varios SKUs y costo promedio fraccionario fallaba con 'valor de salida inconsistente con el inventario'
--    porque cada salida se redondeaba por separado y la suma no era el valor total. La ULTIMA salida de un modelo que se vacia toma el residuo exacto.
--  * catalogo.alta_sabor: advisory lock por actor antes de contar los topes (la carrera dejaba pasar 11 en una hora).
--  * catalogo.parecido: el 'mas corto' se elige por longitud, no alfabeticamente.
-- NOTA DE SEGURIDAD: el filtro de instrucciones de catalogo.nombre_alta_valido es una lista de palabras (defensa de primera linea para un dato). catalogo.alta_sabor NO debe cablearse al bot de Telegram sin otra defensa.

create or replace function api.bodega_llegadas() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hoy date := negocio.hoy();
begin
  perform seguridad.exigir_rol(array['bodega', 'socio']);
  return jsonb_build_object(
    'fecha', v_hoy,
    'compras', coalesce((
      select jsonb_agg(jsonb_build_object(
          'folio', co.folio, 'estado', co.estado, 'llegada_estimada', co.llegada_estimada, 'enviada_fecha', co.enviada_fecha,
          'dias_en_camino', case when co.enviada_fecha is null then null else v_hoy - co.enviada_fecha end,
          'atrasada', co.llegada_estimada is not null and co.llegada_estimada < v_hoy and co.estado <> 'llego_merida',
          'piezas', (select sum(l.piezas_facturadas) from operacion.compra_linea l where l.compra_id = co.id)::int,
          'guias', coalesce((select jsonb_agg(jsonb_build_object('paqueteria', g.paqueteria, 'numero', g.numero) order by g.id) from operacion.guia g where g.compra_id = co.id and g.sentido = 'entrada'), '[]'::jsonb),
          'lineas', coalesce((select jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas_facturadas) order by m.nombre_canonico, sa.nombre_canonico)
                               from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                              where l.compra_id = co.id), '[]'::jsonb))
        order by (co.estado = 'llego_merida') desc, co.llegada_estimada nulls last, co.id)
      from operacion.compra co
     where co.destino = 'bodega' and co.estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')), '[]'::jsonb),
    'por_guardar', coalesce((
      select jsonb_agg(jsonb_build_object('modelo', s.modelo, 'sabor', s.sabor, 'piezas', s.piezas) order by s.modelo, s.sabor)
      from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_facturadas)::int as piezas
              from operacion.compra_linea l join operacion.compra co on co.id = l.compra_id join catalogo.sku k on k.id = l.sku_id
                   join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
             where co.destino = 'bodega' and co.estado in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida')
             group by m.nombre_canonico, sa.nombre_canonico) s), '[]'::jsonb));
end $$;

create or replace function operacion.cerrar_conteo(p_clave_idem text, p_conteo_id bigint, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.conteo; l record; v_res jsonb; v_ev bigint; v_lin bigint; v_mov bigint;
  g record; v_e int; v_v bigint; v_neto int; v_pos_total int; v_valor_neto bigint; v_val_pos_acum bigint; v_pos_hecho int; v_ajustes int := 0; v_val bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'cerrar_conteo', 'c', p_conteo_id, 'l', p_lineas));
  if v_prev is not null then return v_prev; end if;
  select * into c from operacion.conteo where id = p_conteo_id for update;
  if not found or c.estado <> 'abierto' then raise exception 'conteo inexistente o ya cerrado' using errcode = '22023'; end if;
  v_ev := operacion.crear_evento('conteo_cerrado', negocio.fecha_neg(c.contado_at), p_clave_idem, jsonb_build_object('conteo', c.id));

  create temporary table if not exists _conteo_tmp (modelo_id bigint, sku_id bigint, contado int, esperado int, expl_tipo text, expl_ref text) on commit drop;
  delete from _conteo_tmp where true; -- pg_safeupdate (PostgREST) exige WHERE
  insert into _conteo_tmp
  select s.modelo_id, s.id, (x->>'contado')::int, coalesce(u.piezas, 0), x->>'explicacion_tipo', x->>'explicacion_ref'
  from jsonb_array_elements(p_lineas) x
  join catalogo.modelo m on m.nombre_norm = catalogo.normalizar(x->>'modelo')
  join catalogo.sabor sa on sa.nombre_norm = catalogo.normalizar(x->>'sabor')
  join catalogo.sku s on s.modelo_id = m.id and s.sabor_id = sa.id
  left join operacion.existencia_sku_ubicacion u on u.sku_id = s.id and u.ubicacion = c.ubicacion;
  if (select count(*) from _conteo_tmp) <> jsonb_array_length(p_lineas) then raise exception 'linea de conteo con SKU desconocido' using errcode = '22023'; end if;

  for g in select distinct modelo_id from _conteo_tmp order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(g.modelo_id::text, 0));
    select coalesce(e.piezas, 0), coalesce(e.valor_cent, 0) into v_e, v_v from (select 1) x left join operacion.existencia_modelo e on e.modelo_id = g.modelo_id;
    select coalesce(sum(contado - esperado), 0), coalesce(sum(greatest(contado - esperado, 0)), 0) into v_neto, v_pos_total from _conteo_tmp where modelo_id = g.modelo_id;
    -- Valor neto del ajuste (con signo) al costo promedio de las piezas netas.
    v_valor_neto := case when v_neto = 0 then 0 when v_neto < 0 then -(case when -v_neto = v_e then v_v else negocio.redondear_medio_arriba(v_v * (-v_neto), greatest(v_e, 1)) end)
                         else negocio.redondear_medio_arriba(v_v * v_neto, greatest(v_e, 1)) end;
    -- Salidas primero: cada una al costo promedio de la existencia ANTES del cierre; luego las entradas.
    v_val_pos_acum := 0; v_pos_hecho := 0;
    declare v_sal_total bigint := 0; v_sal_pzs int := 0; v_sal_hecho int := 0; v_sal_acum bigint := 0;
    begin
      for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado < esperado order by sku_id loop
        v_val := case when v_e = 0 then 0 else negocio.redondear_medio_arriba(v_v * (l.esperado - l.contado), v_e) end;
        v_sal_total := v_sal_total + v_val; v_sal_pzs := v_sal_pzs + (l.esperado - l.contado);
      end loop;
      -- Valor total de las salidas = el de las piezas que salen; el de las entradas = salidas + valor neto (con signo): se reparte sin residuo.
      if v_sal_pzs > 0 then v_sal_total := case when v_sal_pzs = v_e then v_v else v_sal_total end; end if;
      for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado < esperado order by sku_id loop
        -- La ultima salida de un modelo que se vacia toma el residuo exacto: la suma de las salidas es el valor completo de la existencia (sin centavos sueltos por redondeo).
        v_sal_hecho := v_sal_hecho + (l.esperado - l.contado);
        v_val := case when v_e = 0 then 0 when v_sal_hecho = v_e then v_v - v_sal_acum else negocio.redondear_medio_arriba(v_v * (l.esperado - l.contado), v_e) end;
        v_sal_acum := v_sal_acum + v_val;
        insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
          values (negocio.fecha_neg(c.contado_at), c.contado_at, l.sku_id, g.modelo_id, c.ubicacion, 'ajuste_conteo', l.contado - l.esperado, -v_val, v_ev) returning id into v_mov;
        update _conteo_tmp set expl_ref = coalesce(expl_ref, '') where sku_id = l.sku_id;
        insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref, movimiento_ajuste_id)
          values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''), v_mov);
        v_ajustes := v_ajustes + 1;
      end loop;
      declare v_total_entradas bigint := v_sal_total + v_valor_neto;
      begin
        for l in select * from _conteo_tmp where modelo_id = g.modelo_id and contado > esperado order by sku_id loop
          v_pos_hecho := v_pos_hecho + (l.contado - l.esperado);
          v_val := case when v_pos_hecho = v_pos_total then v_total_entradas - v_val_pos_acum
                        else negocio.redondear_medio_arriba(v_total_entradas * (l.contado - l.esperado), v_pos_total) end;
          v_val_pos_acum := v_val_pos_acum + v_val;
          insert into operacion.movimiento_inventario (fecha_neg, hora, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id)
            values (negocio.fecha_neg(c.contado_at), c.contado_at, l.sku_id, g.modelo_id, c.ubicacion, 'ajuste_conteo', l.contado - l.esperado, v_val, v_ev) returning id into v_mov;
          insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref, movimiento_ajuste_id)
            values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''), v_mov);
          v_ajustes := v_ajustes + 1;
        end loop;
      end;
    end;
  end loop;
  -- Lineas sin diferencia: se guardan sin movimiento.
  for l in select * from _conteo_tmp t where contado = esperado loop
    insert into operacion.conteo_linea (conteo_id, sku_id, contado, esperado_sistema, explicacion_tipo, explicacion_ref)
      values (c.id, l.sku_id, l.contado, l.esperado, nullif(l.expl_tipo, ''), nullif(l.expl_ref, ''));
  end loop;
  update operacion.conteo set estado = 'cerrado', evento_id = v_ev where id = c.id;
  v_res := jsonb_build_object('conteo_id', c.id, 'evento_id', v_ev, 'ajustes', v_ajustes);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create or replace function catalogo.alta_sabor(p_clave_idem text, p_modelo_id bigint, p_sabor text, p_canal text default 'web', p_confirmar boolean default false) returns jsonb
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

  -- Serializa el conteo de topes por actor: sin esto dos altas simultaneas leian 9 y pasaban las dos (carrera que dejo 11).
  perform pg_advisory_xact_lock(hashtextextended('alta_sabor:' || coalesce(auth.uid()::text, p_canal), 0));
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

-- Umbral documentado de 'parecido' (solo SUGIERE, nunca bloquea: el socio confirma): sobre el nombre normalizado, (a) distancia de edicion <= min(2, max(1, 30 % de la longitud del mas largo)), o
-- (b) el mas CORTO (por longitud, minimo 3 caracteres) esta contenido en el otro como palabras completas ('uva' en 'uva verde'). Nunca el mismo nombre.
create or replace function catalogo.parecido(p_a text, p_b text) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select p_a <> p_b and (
    catalogo.distancia_edicion(p_a, p_b) <= least(2, greatest(1, (greatest(char_length(p_a), char_length(p_b)) * 30) / 100))
    or (char_length(c.corto) >= 3 and (' ' || c.largo || ' ') like '% ' || c.corto || ' %'))
  from (select case when char_length(p_a) <= char_length(p_b) then p_a else p_b end as corto, case when char_length(p_a) <= char_length(p_b) then p_b else p_a end as largo) c
$$;
