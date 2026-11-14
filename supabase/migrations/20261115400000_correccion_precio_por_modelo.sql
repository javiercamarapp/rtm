-- Correccion de precio POR MODELO de un pedido enviado (decision del dueno, 14-nov: "ponle el precio a cada modelo, hazlo de tal manera que cuadre con el precio de venta").
-- ADITIVA: una funcion nueva (operacion + envoltorio api) y una guarda ampliada del trigger T4 de pedido_linea. No borra ni reescribe eventos, asientos, notas ni movimientos.
--
-- Como se registra el ingreso (leido de contabilidad.lineas_de_evento_base): la venta entra al libro desde la NOTA (Dr 1210 total / Cr 4110 subtotal / Cr 4300 envio / Cr 4910 recargo / Dr 4210
-- descuento), por PEDIDO (pedido_id) y SIN dimension de modelo; el modelo solo viaja en el costo (5100 / 1310). Por eso repartir el mismo subtotal entre modelos de otra forma no cambia ningun
-- asiento: el libro (hash encadenado, eventos inmutables) queda intacto y la correccion vive en (a) pedido_linea.precio_cent, de donde leen los reportes de venta y utilidad por modelo, y
-- (b) una nota de correccion enlazada (mecanismo oficial operacion.emitir_correccion), que deja el documento al cliente con el precio por modelo y cuyo asiento neto es cero (sin asiento).
--
-- Reglas de la funcion:
--  * Solo socio. Idempotente por clave (misma clave y mismo contenido devuelve lo guardado; otro contenido = conflicto). Si todos los renglones ya estan al precio pedido, no cambia nada.
--  * Recibe el pedido y un precio por MODELO (entero en centavos, clave = nombre del modelo o su id). Exige un precio para cada modelo del pedido y ninguno de mas.
--  * La suma piezas surtidas x precio nuevo debe ser IGUAL al subtotal vigente de la ultima nota; si no, falla y no escribe nada.
--  * Un pedido con devoluciones de cliente no se corrige (las devoluciones ya fijaron su precio por renglon).
--  * Cada renglon del modelo recibe el precio del modelo, motivo_precio = 'correccion de precio por modelo' y precio_tabulador_cent = tabulador vigente del cliente (null si no existe).
--  * Auditoria: evento 'correccion_precio_modelo' (antes y despues por modelo) y registro en seguridad.auditoria.
--
-- T4: la linea enviada es inmutable. Se permite UNICAMENTE cambiar precio_cent, precio_tabulador_cent y motivo_precio mientras la funcion oficial tiene el interruptor de transaccion
-- rtm.correccion_precio = 'on' (set_config local, lo apaga al terminar). La web no tiene privilegio de UPDATE sobre la tabla; cualquier otro cambio sigue prohibido.

create or replace function operacion.t4_pedido_linea() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'las lineas de un pedido no se borran' using errcode = '42501'; end if;
  if old.fecha_salida is not null then
    if current_setting('rtm.correccion_precio', true) = 'on'
       and (to_jsonb(new) - array['precio_cent', 'precio_tabulador_cent', 'motivo_precio']) is not distinct from (to_jsonb(old) - array['precio_cent', 'precio_tabulador_cent', 'motivo_precio']) then
      return new;
    end if;
    raise exception 'la linea de un pedido enviado es inmutable (precio, piezas surtidas y costo)' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['piezas_surtidas', 'costo_unit_cent', 'renta_cent', 'fecha_salida']) is distinct from (to_jsonb(old) - array['piezas_surtidas', 'costo_unit_cent', 'renta_cent', 'fecha_salida']) then
    raise exception 'la linea de un pedido solo cambia al marcarlo enviado' using errcode = '42501';
  end if;
  return new;
end $$;

create function operacion.corregir_precio_por_modelo(p_clave_idem text, p_pedido bigint, p_precios jsonb, p_detalle text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c_motivo constant text := 'correccion de precio por modelo';
  v_prev jsonb; ped operacion.pedido; ult operacion.nota; v_norm jsonb := '{}'::jsonb; k text; v_val numeric; v_mod bigint; v_falta text; v_extra text;
  v_sub_nota bigint; v_sub_nue bigint; v_cambian int; v_map jsonb; v_antes jsonb; v_despues jsonb; v_nota jsonb; v_ev bigint; v_res jsonb; v_det text;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null or char_length(p_clave_idem) > 120 then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  if p_precios is null or jsonb_typeof(p_precios) <> 'object' or p_precios = '{}'::jsonb then raise exception 'indica el precio de cada modelo (objeto modelo -> centavos)' using errcode = '22023'; end if;
  v_det := nullif(btrim(coalesce(p_detalle, '')), '');
  if v_det is not null and char_length(v_det) > 300 then raise exception 'el detalle pasa de 300 caracteres' using errcode = '22023'; end if;

  -- Normaliza las claves a modelo_id y valida cada precio (entero en centavos, mayor que cero).
  for k in select jsonb_object_keys(p_precios) loop
    if jsonb_typeof(p_precios->k) <> 'number' then raise exception 'el precio de % no es un numero' , k using errcode = '22023'; end if;
    v_val := (p_precios->>k)::numeric;
    if v_val <= 0 or v_val <> trunc(v_val) then raise exception 'precio invalido para %: debe ser un entero en centavos mayor que cero', k using errcode = '23514'; end if;
    select m.id into v_mod from catalogo.modelo m where case when k ~ '^[0-9]+$' then m.id = k::bigint else m.nombre_norm = catalogo.normalizar(k) end;
    if v_mod is null then raise exception 'modelo desconocido: %', k using errcode = '22023'; end if;
    if v_norm ? v_mod::text then raise exception 'el modelo % viene repetido', k using errcode = '22023'; end if;
    v_norm := v_norm || jsonb_build_object(v_mod::text, v_val::bigint);
  end loop;

  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'corregir_precio_por_modelo', 'p', p_pedido, 'pr', v_norm, 'd', v_det));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;

  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found or ped.estado <> 'enviado' then raise exception 'solo un pedido enviado se corrige por modelo' using errcode = 'P0428'; end if;
  select * into ult from operacion.nota where pedido_id = ped.id order by id desc limit 1;
  if not found then raise exception 'el pedido no tiene nota que corregir' using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.devolucion_cliente d where d.pedido_id = ped.id) then
    raise exception 'el pedido tiene devoluciones de cliente: su precio ya quedo fijado por renglon' using errcode = 'P0428';
  end if;

  select string_agg(m.nombre_canonico, ', ' order by m.nombre_canonico) into v_falta
  from catalogo.modelo m where m.id in (select l.modelo_id from operacion.pedido_linea l where l.pedido_id = ped.id) and not (v_norm ? m.id::text);
  if v_falta is not null then raise exception 'falta el precio de: %', v_falta using errcode = '22023'; end if;
  select string_agg(x.key, ', ' order by x.key) into v_extra
  from jsonb_each(v_norm) x where not exists (select 1 from operacion.pedido_linea l where l.pedido_id = ped.id and l.modelo_id = x.key::bigint);
  if v_extra is not null then raise exception 'modelos que no son de este pedido (id): %', v_extra using errcode = '22023'; end if;

  -- La suma debe cuadrar EXACTAMENTE con el subtotal vigente (el de la ultima nota).
  v_sub_nota := (ult.snapshot_cliente->>'subtotal_cent')::bigint;
  select coalesce(sum(s.piezas * (v_norm->>l.modelo_id::text)::bigint), 0)::bigint into v_sub_nue
  from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id where l.pedido_id = ped.id;
  if v_sub_nue <> v_sub_nota then
    raise exception 'los precios no cuadran con el total de venta vigente: suman % centavos y el subtotal es %', v_sub_nue, v_sub_nota using errcode = '23514';
  end if;

  -- Sin cambio: todos los renglones ya estan al precio pedido (en el renglon y en la ultima nota).
  select count(*) into v_cambian from operacion.pedido_linea l
  where l.pedido_id = ped.id and (l.precio_cent <> (v_norm->>l.modelo_id::text)::bigint or coalesce((ult.ajustes->'precios'->>(l.id::text))::bigint, l.precio_cent) <> (v_norm->>l.modelo_id::text)::bigint);
  if v_cambian = 0 then
    v_res := jsonb_build_object('estado', 'sin_cambio', 'pedido', ped.folio, 'subtotal_cent', v_sub_nota, 'total_cent', ult.total_cent);
    perform seguridad.terminar_operacion(p_clave_idem, v_res);
    return v_res;
  end if;

  select coalesce(jsonb_agg(x order by x->>'modelo'), '[]'::jsonb) into v_antes
  from (select jsonb_build_object('modelo', m.nombre_canonico, 'piezas', sum(s.piezas), 'venta_cent', sum(s.piezas * l.precio_cent), 'renglones', count(distinct l.id),
                                  'precio_min_cent', min(l.precio_cent), 'precio_max_cent', max(l.precio_cent)) as x
        from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join catalogo.modelo m on m.id = l.modelo_id where l.pedido_id = ped.id group by m.nombre_canonico) q;
  select coalesce(jsonb_agg(x order by x->>'modelo'), '[]'::jsonb) into v_despues
  from (select jsonb_build_object('modelo', m.nombre_canonico, 'piezas', sum(s.piezas), 'precio_cent', (v_norm->>l.modelo_id::text)::bigint, 'venta_cent', sum(s.piezas * (v_norm->>l.modelo_id::text)::bigint)) as x
        from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join catalogo.modelo m on m.id = l.modelo_id where l.pedido_id = ped.id group by m.nombre_canonico, l.modelo_id) q;

  -- Renglones: el precio del modelo (T4 lo permite solo con el interruptor de esta funcion).
  perform set_config('rtm.correccion_precio', 'on', true);
  update operacion.pedido_linea l set precio_cent = (v_norm->>l.modelo_id::text)::bigint,
                                      precio_tabulador_cent = catalogo.precio_vigente(ped.cliente_id, l.modelo_id, ped.fecha_neg),
                                      motivo_precio = c_motivo
   where l.pedido_id = ped.id;
  perform set_config('rtm.correccion_precio', 'off', true);

  -- Nota de correccion enlazada con el precio por renglon (mecanismo oficial). Subtotal igual => su asiento neto es cero: el libro no cambia.
  select jsonb_object_agg(l.id::text, l.precio_cent) into v_map from operacion.pedido_linea l where l.pedido_id = ped.id;
  v_nota := operacion.emitir_correccion(p_clave_idem || ':nota', ped.id, c_motivo, v_map);
  if (v_nota->>'total_cent')::bigint <> ult.total_cent then
    raise exception 'la nota corregida cambia el total (% contra %): se revierte', v_nota->>'total_cent', ult.total_cent using errcode = 'P0430';
  end if;

  v_ev := operacion.crear_evento('correccion_precio_modelo', negocio.hoy(), p_clave_idem,
            jsonb_build_object('pedido', ped.folio, 'motivo', c_motivo, 'detalle', v_det, 'nota', v_nota->>'folio_documento', 'subtotal_cent', v_sub_nota, 'antes', v_antes, 'despues', v_despues));
  perform seguridad.registrar_auditoria('operacion.pedido_linea', 'UPDATE', ped.folio, jsonb_build_object('por_modelo', v_antes), jsonb_build_object('por_modelo', v_despues, 'motivo', c_motivo), seguridad.canal_actual());

  v_res := jsonb_build_object('estado', 'corregido', 'pedido', ped.folio, 'nota', v_nota->>'folio_documento', 'evento_id', v_ev, 'renglones_cambiados', v_cambian,
                              'subtotal_cent', v_sub_nota, 'total_cent', ult.total_cent, 'antes', v_antes, 'despues', v_despues);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.corregir_precio_por_modelo(p_clave_idem text, p_pedido bigint, p_precios jsonb, p_detalle text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.corregir_precio_por_modelo(p_clave_idem, p_pedido, p_precios, p_detalle); end $$;
revoke execute on function api.corregir_precio_por_modelo(text, bigint, jsonb, text) from public, anon;
grant execute on function api.corregir_precio_por_modelo(text, bigint, jsonb, text) to authenticated;
-- La funcion de operacion solo la llama la api (y el cargador con conexion propietaria): nadie de la web la ejecuta directo, con o sin privilegios por omision del esquema.
revoke execute on function operacion.corregir_precio_por_modelo(text, bigint, jsonb, text) from public, anon, authenticated;
