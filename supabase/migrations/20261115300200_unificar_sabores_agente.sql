-- Unificacion de sabores, parte 3: puertas del agente de Telegram (solo rol servidor). ADITIVA: funciones nuevas; no se toca agente.ejecutar_ext.
-- El modelo de IA NO decide la unificacion: solo extrae si el socio contesto si o no (src/dominio/agente/sabores.ts). La deteccion y la accion son SQL.
--   agente.sabor_pregunta()        siguiente pregunta pendiente de un sabor (texto del servidor) o null. Solo lectura.
--   agente.sabor_responder(...)     el socio verificado (id de Telegram registrado) contesta si o no; si = unifica (canonico por omision), no = negativo. Sin tarjeta: devuelve el aviso para el grupo.
--   agente.sabor_deshacer(...)      deshace la ultima unificacion o la indicada.
-- Pendiente de cablear (ver docs/unificar-sabores.md): la intencion en el extractor y la llamada a estas puertas desde src/infra/agente/postgres.ts.

create function agente.sabor_pregunta() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare r jsonb;
begin
  perform notificacion.exigir_sistema();
  select jsonb_build_object('pregunta_id', d.id, 'pregunta', '¿"' || a.nombre_canonico || '" es lo mismo que "' || b.nombre_canonico || '"?', 'a', a.nombre_canonico, 'b', b.nombre_canonico,
         'clase', d.clase, 'motivo', d.motivo, 'ambiguo', d.ambiguo, 'pendientes', (select count(*) from catalogo.posible_duplicado x where x.estado = 'pendiente' and x.tipo = 'sabor'))
    into r
    from catalogo.posible_duplicado d join catalogo.sabor a on a.id = d.id_a join catalogo.sabor b on b.id = d.id_b
   where d.tipo = 'sabor' and d.estado = 'pendiente' and a.unificado_en is null and b.unificado_en is null
   order by d.puntaje desc, d.id limit 1;
  return r;
end $$;

create function agente.sabor_responder(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_res jsonb; v_id bigint := nullif(p_args ->> 'pregunta_id', '')::bigint; v_resp text := lower(coalesce(p_args ->> 'respuesta', '')); v_a text; v_b text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  if v_id is null or v_resp not in ('si', 'no') then raise exception 'falta la pregunta o la respuesta (si o no)' using errcode = 'P0460'; end if;
  select a.nombre_canonico, b.nombre_canonico into v_a, v_b from catalogo.posible_duplicado d join catalogo.sabor a on a.id = d.id_a join catalogo.sabor b on b.id = d.id_b where d.id = v_id and d.tipo = 'sabor';
  if not found then raise exception 'pregunta desconocida' using errcode = 'P0460'; end if;
  v_res := catalogo.responder_duplicado(p_clave_idem, v_id, v_resp, nullif(p_args ->> 'canonico_id', '')::bigint, null, 'telegram');
  return v_res || jsonb_build_object('autor', v_autor, 'a', v_a, 'b', v_b,
    'aviso_grupo', case v_res ->> 'estado'
      when 'unificado' then format('%s unió los sabores "%s" y "%s": queda "%s". Para deshacerlo: "deshacer unión %s".', initcap(v_autor), v_a, v_b, v_res ->> 'destino', v_res ->> 'unificacion_id')
      when 'distinto' then format('%s confirmó que "%s" y "%s" son sabores distintos. No se vuelve a preguntar.', initcap(v_autor), v_a, v_b)
      when 'bloqueado' then format('No se pudo unir "%s" y "%s" todavía: tiene movimiento pendiente. Cierra el conteo o lo abierto y vuelve a intentar.', v_a, v_b)
      else null end);
end $$;

create function agente.sabor_deshacer(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_u bigint := coalesce(nullif(p_args ->> 'unificacion_id', '')::bigint, (select max(id) from catalogo.unificacion_sabor where estado = 'aplicada')); v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  if v_u is null then raise exception 'no hay una union que deshacer' using errcode = 'P0460'; end if;
  v_res := catalogo.deshacer_unificacion_sabor(p_clave_idem, v_u, 'telegram');
  return v_res || jsonb_build_object('autor', v_autor, 'aviso_grupo', format('%s deshizo la unión %s: "%s" vuelve a ser un sabor aparte.', initcap(v_autor), v_u, v_res ->> 'origen'));
end $$;

revoke all on function agente.sabor_pregunta(), agente.sabor_responder(text, jsonb), agente.sabor_deshacer(text, jsonb) from public, anon, authenticated;
grant execute on function agente.sabor_pregunta(), agente.sabor_responder(text, jsonb), agente.sabor_deshacer(text, jsonb) to servidor;
