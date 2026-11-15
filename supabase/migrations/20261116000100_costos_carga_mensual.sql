-- Carga mensual de costos del sistema (scripts/costos/cargar-mes.mjs). Solo agrega funciones; no cambia tablas ni funciones existentes.
--  * registrar_dato_faltante / resolver_dato_faltante: hasta hoy nada escribia costos.dato_faltante, asi que la pagina nunca podia decir "al menos".
--  * importar_claude_uso: guarda en costos.claude_uso_mes el conteo de tokens que produce scripts/costos/prorratear-claude.mjs (evidencia del cargo de Claude Max).
-- Solo el rol propietario con el canal de importacion (la Mac de Javier) o un socio con sesion pueden llamarlas; la web no las ve.

create or replace function costos.registrar_dato_faltante(p_servicio text, p_mes text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s costos.servicio; v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'mes invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'el dato faltante exige motivo' using errcode = '23502'; end if;
  select * into s from costos.servicio where slug = p_servicio;
  if not found then raise exception 'servicio desconocido: %', p_servicio using errcode = '22023'; end if;
  -- Un solo faltante abierto por servicio y mes: si ya existe, solo se actualiza el motivo (la tabla es de estado, no de historia).
  select id into v_id from costos.dato_faltante where servicio_id = s.id and mes = p_mes and resuelto_at is null order by id desc limit 1;
  if v_id is null then
    insert into costos.dato_faltante (servicio_id, mes, motivo) values (s.id, p_mes, btrim(p_motivo)) returning id into v_id;
    return jsonb_build_object('id', v_id, 'servicio', p_servicio, 'mes', p_mes, 'nuevo', true);
  end if;
  update costos.dato_faltante set motivo = btrim(p_motivo) where id = v_id and motivo <> btrim(p_motivo);
  return jsonb_build_object('id', v_id, 'servicio', p_servicio, 'mes', p_mes, 'nuevo', false);
end $$;

create or replace function costos.resolver_dato_faltante(p_servicio text, p_mes text) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  update costos.dato_faltante f set resuelto_at = clock_timestamp()
    from costos.servicio s where s.id = f.servicio_id and s.slug = p_servicio and f.mes = p_mes and f.resuelto_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function costos.importar_claude_uso(p_mes text, p_metrica text, p_tokens_rtm bigint, p_tokens_cuenta bigint, p_pct_exacto_ppm int, p_pct_aplicado_ppm int, p_sesiones int, p_json_sha256 text, p_script_version text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  insert into costos.claude_uso_mes (mes, metrica, tokens_rtm, tokens_cuenta, pct_exacto_ppm, pct_aplicado_ppm, sesiones, json_sha256, script_version)
    values (p_mes, p_metrica, p_tokens_rtm, p_tokens_cuenta, p_pct_exacto_ppm, p_pct_aplicado_ppm, coalesce(p_sesiones, 0), p_json_sha256, p_script_version)
    on conflict (mes, metrica, json_sha256) do nothing returning id into v_id;
  return jsonb_build_object('id', v_id, 'repetido', v_id is null);
end $$;

revoke execute on function costos.registrar_dato_faltante(text, text, text), costos.resolver_dato_faltante(text, text),
  costos.importar_claude_uso(text, text, bigint, bigint, int, int, int, text, text) from public, anon, authenticated;
