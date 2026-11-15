-- Carril FRENOS, punto 4: DESHACER 10 MINUTOS PARA TODOS (tambien el autor), aplicado en SQL.
--   * agente._puede_deshacer deja de dar privilegio al autor: solo dentro de la ventana (agente._ventana_minutos), sea quien sea el socio.
--   * agente.deshacer pasa a ser un envoltorio (rename + wrap de la ultima definicion): mensajes claros (fuera de ventana; movimiento que no se deshace) y eco del efecto revertido.
--   * Lista EXPLICITA de lo que no se deshace (agente.tipos_no_reversibles): se corrige con un contramovimiento desde el software o con un movimiento inverso.
--   * agente.localizar: "deshaz eso" sin folio toma el ultimo movimiento propio DENTRO de la ventana.
-- El interruptor de escritura NO bloquea deshacer (es una reversa, no un registro nuevo).

create or replace function agente._puede_deshacer(p_solicitante text, p_autor_hecho text, p_creado_at timestamptz) returns boolean
language sql stable set search_path = ''
as $$ select p_creado_at > now() - make_interval(mins => agente._ventana_minutos()) $$;

create or replace function agente.tipos_no_reversibles() returns text[]
language sql immutable set search_path = ''
as $$ select array['pedido_envio', 'pedido_entrega', 'pedido_cancelar', 'compra_aprobar', 'compra_estado', 'compra_recepcion', 'conteo', 'cliente', 'precio', 'acta_propuesta', 'acta_firma'] $$;

-- Momento en que se registro un folio del agente (hecho, gasto o toma); null si no es de Telegram.
create or replace function agente._creado_folio(p_folio text) returns timestamptz
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select h.creado_at from agente.hecho h where h.folio = p_folio),
    (select e.hora from operacion.gasto g join operacion.evento e on e.id = g.evento_id where g.folio = p_folio and e.canal = 'telegram'),
    (select e.hora from operacion.toma_omar t join operacion.evento e on e.id = t.evento_id where t.folio = p_folio and e.canal = 'telegram'))
$$;

create or replace function agente._tipo_folio(p_folio text) returns text
language sql stable security definer set search_path = ''
as $$ select (select h.tipo from agente.hecho h where h.folio = p_folio) $$;

alter function agente.deshacer(text, text, text, bigint) rename to _deshacer_previo;
revoke all on function agente._deshacer_previo(text, text, text, bigint) from public, anon, authenticated, servidor;

create function agente.deshacer(p_clave_idem text, p_folio text, p_autor text, p_telegram_user_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_creado timestamptz; v_tipo text; v_res jsonb; v_resumen jsonb; v_sol text;
begin
  perform notificacion.exigir_sistema();
  v_sol := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  v_tipo := agente._tipo_folio(p_folio);
  if v_tipo = any (agente.tipos_no_reversibles()) then
    raise exception 'el folio % (%) no se deshace: es un movimiento cerrado. Corrigelo con un movimiento inverso o desde el software', p_folio, v_tipo using errcode = 'P0460';
  end if;
  v_creado := agente._creado_folio(p_folio);
  if v_creado is not null and not exists (select 1 from agente.hecho h where h.folio = p_folio and h.deshecho_at is not null)
     and not agente._puede_deshacer(v_sol, null, v_creado) then
    raise exception 'pasaron mas de % minutos desde el folio %: ya no se deshace desde Telegram. Corrigelo con un movimiento inverso o desde el software', agente._ventana_minutos(), p_folio using errcode = 'P0464';
  end if;
  v_res := agente._deshacer_previo(p_clave_idem, p_folio, p_autor, p_telegram_user_id);
  update agente.huella set anulada_at = now() where folio = p_folio and anulada_at is null returning resumen into v_resumen;
  return v_res || jsonb_build_object('revertido', coalesce(v_resumen, '{}'::jsonb));
end $$;

-- "Deshaz eso": el ultimo movimiento propio, solo si sigue dentro de la ventana. Con folio explicito se devuelve siempre (deshacer explica por que no).
create or replace function agente.localizar(p_folio text, p_autor text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return coalesce((select jsonb_build_object('folio', x.folio, 'tipo', x.tipo, 'ejecutado_en', x.hora) from (
      select g.folio, 'gasto' as tipo, e.hora from operacion.gasto g join operacion.evento e on e.id = g.evento_id
        where e.canal = 'telegram' and (p_folio is null or g.folio = p_folio) and not exists (select 1 from operacion.gasto_anulacion a where a.gasto_id = g.id)
          and (p_autor is null or e.mensaje_origen like 'telegram:' || p_autor || ':%')
          and (p_folio is not null or e.hora > now() - make_interval(mins => agente._ventana_minutos()))
      union all
      select t.folio, 'toma', e.hora from operacion.toma_omar t join operacion.evento e on e.id = t.evento_id
        where e.canal = 'telegram' and t.estado in ('pendiente', 'autorizada') and (p_folio is null or t.folio = p_folio) and p_autor is null
          and (p_folio is not null or e.hora > now() - make_interval(mins => agente._ventana_minutos()))
      union all
      select h.folio, h.tipo, h.creado_at from agente.hecho h
        where h.deshecho_at is null and (p_folio is null or h.folio = p_folio) and (p_autor is null or h.autor = p_autor)
          and (p_folio is not null or h.creado_at > now() - make_interval(mins => agente._ventana_minutos()))
      order by hora desc limit 1) x), 'null'::jsonb);
end $$;

revoke all on function agente._puede_deshacer(text, text, timestamptz) from public, anon, authenticated, servidor;
revoke all on function agente.tipos_no_reversibles() from public, anon, authenticated;
grant execute on function agente.tipos_no_reversibles() to servidor;
revoke all on function agente._creado_folio(text) from public, anon, authenticated, servidor;
revoke all on function agente._tipo_folio(text) from public, anon, authenticated, servidor;
revoke all on function agente.deshacer(text, text, text, bigint) from public, anon, authenticated;
grant execute on function agente.deshacer(text, text, text, bigint) to servidor;
revoke all on function agente.localizar(text, text) from public, anon, authenticated;
grant execute on function agente.localizar(text, text) to servidor;
