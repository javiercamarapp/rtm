-- Carril bot/ventas-compras, parte 1: guias y paqueterias (decision del dueno 14-nov, punto 6).
--   * Catalogo CERRADO de paqueterias: Castores, Pitic, DHL y Estafeta (operacion.paqueteria_nombre). Un pedido de bodega no se envia con otra.
--   * Marcar enviado SIN exigir la guia: operacion.enviar_pedido acepta una paqueteria sin numero (el pedido sale y queda "por capturar guia").
--   * Captura POSTERIOR de la guia por pedido (operacion.capturar_guia_pedido): la guia llega despues y se agrupa por pedido (el bot lo hace en lote).
--   * Lectura de pedidos candidatos para emparejar (agente.pedidos_para_envio): sin telefonos ni destinatarios.
-- ADITIVA: rename + wrap de operacion.enviar_pedido (misma firma; los pedidos que salen directo del proveedor conservan su texto libre, p. ej. 'Proveedor'), funciones nuevas.
-- Nada calcula dinero. Los ayudantes no se conceden a la web; las funciones agente.* solo al rol servidor.

create function operacion.paqueteria_nombre(p text) returns text
language sql immutable set search_path = ''
as $$
  select case lower(translate(btrim(coalesce(p, '')), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou'))
    when 'castores' then 'Castores' when 'pitic' then 'Pitic' when 'dhl' then 'DHL' when 'estafeta' then 'Estafeta' end
$$;

alter function operacion.enviar_pedido(text, bigint, jsonb, jsonb, date, boolean, text) rename to _enviar_pedido_sin_catalogo;

create function operacion.enviar_pedido(p_clave_idem text, p_pedido bigint, p_surtido jsonb default null, p_guia jsonb default null, p_fecha date default null,
                                        p_aceptar_avisos boolean default false, p_falta_tipo text default 'entrega_diferida') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_bodega boolean; v_paq text; v_num text; v_guia jsonb := p_guia; v_res jsonb;
begin
  select operacion.origen_es_bodega(pe.origen) into v_bodega from operacion.pedido pe where pe.id = p_pedido;
  if p_guia is not null and coalesce(v_bodega, false) then
    v_paq := operacion.paqueteria_nombre(p_guia ->> 'paqueteria');
    v_num := nullif(btrim(coalesce(p_guia ->> 'numero', '')), '');
    if nullif(btrim(coalesce(p_guia ->> 'paqueteria', '')), '') is not null and v_paq is null then
      raise exception 'paqueteria no valida: elige Castores, Pitic, DHL o Estafeta' using errcode = 'P0471';
    end if;
    if v_paq is null and v_num is not null then
      raise exception 'la guia necesita una paqueteria del catalogo: Castores, Pitic, DHL o Estafeta' using errcode = 'P0471';
    end if;
    -- Sin numero no hay renglon de guia: el pedido sale con su paqueteria y la guia se captura despues.
    v_guia := case when v_num is null then null else (p_guia - 'paqueteria' - 'numero') || jsonb_build_object('paqueteria', v_paq, 'numero', v_num) end;
  end if;
  v_res := operacion._enviar_pedido_sin_catalogo(p_clave_idem, p_pedido, p_surtido, v_guia, p_fecha, p_aceptar_avisos, p_falta_tipo);
  if v_guia is null and v_paq is not null then
    update operacion.pedido set paqueteria = v_paq where id = p_pedido and estado = 'enviado';
  end if;
  return v_res;
end $$;

-- Captura de la guia de un pedido YA enviado. Idempotente por clave; la misma guia dos veces no se duplica y una guia distinta sobre una ya capturada se rechaza (P0428).
create function operacion.capturar_guia_pedido(p_clave_idem text, p_pedido bigint, p_numero text, p_paqueteria text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; ped operacion.pedido; v_num text := nullif(btrim(coalesce(p_numero, '')), ''); v_paq text; v_ev bigint; v_g operacion.guia; v_res jsonb; v_anterior text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'capturar_guia_pedido', 'p', p_pedido, 'n', p_numero, 'q', p_paqueteria));
  if v_prev is not null then return v_prev; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: la guia se captura cuando ya salio', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if v_num is null then raise exception 'la guia no puede ir vacia' using errcode = '23502'; end if;
  if length(v_num) > 60 then raise exception 'el numero de guia es demasiado largo' using errcode = '23514'; end if;
  if nullif(btrim(coalesce(p_paqueteria, '')), '') is not null then
    v_paq := operacion.paqueteria_nombre(p_paqueteria);
    if v_paq is null then raise exception 'paqueteria no valida: elige Castores, Pitic, DHL o Estafeta' using errcode = 'P0471'; end if;
  else
    v_paq := coalesce(operacion.paqueteria_nombre(ped.paqueteria), ped.paqueteria);
  end if;
  if v_paq is null then raise exception 'falta la paqueteria del pedido %: Castores, Pitic, DHL o Estafeta', ped.folio using errcode = 'P0471'; end if;
  v_ev := operacion.crear_evento('guia_capturada', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', ped.folio, 'paqueteria', v_paq));
  select * into v_g from operacion.guia where pedido_id = ped.id and sentido = 'salida' order by id desc limit 1;
  if found then
    -- La guia ya capturada no se reescribe (el libro de guias es inmutable): el mismo numero es un no-op; otro numero se corrige desde el software.
    if v_g.numero <> v_num then raise exception 'el pedido % ya tiene la guia %: para cambiarla hazlo desde el software', ped.folio, v_g.numero using errcode = 'P0428'; end if;
    v_anterior := null;
  else
    insert into operacion.guia (sentido, paqueteria, numero, pedido_id, fecha_neg, evento_id) values ('salida', v_paq, v_num, ped.id, negocio.hoy(), v_ev) returning * into v_g;
  end if;
  update operacion.pedido set paqueteria = v_paq where id = ped.id;
  v_res := jsonb_build_object('pedido_id', ped.id, 'pedido', ped.folio, 'guia_id', v_g.id, 'paqueteria', v_g.paqueteria);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Pedidos candidatos para emparejar envios y guias. p_modo: 'por_enviar' (confirmados) o 'sin_guia' (enviados sin numero de guia de salida). Sin destinatario ni telefonos.
create function agente.pedidos_para_envio(p_modo text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  if p_modo not in ('por_enviar', 'sin_guia') then raise exception 'modo desconocido' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('folio', pe.folio, 'cliente', c.nombre_canonico, 'folio_externo', d.folio_externo, 'paqueteria', pe.paqueteria, 'estado', pe.estado, 'fecha', coalesce(pe.fecha_envio, pe.fecha_neg)) order by pe.id)
      from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id left join operacion.pedido_ds d on d.pedido_id = pe.id
     where case p_modo
             when 'por_enviar' then pe.estado = 'confirmado'
             else pe.estado = 'enviado' and pe.fecha_envio >= negocio.hoy() - 60 and not exists (select 1 from operacion.guia g where g.pedido_id = pe.id and g.sentido = 'salida') end), '[]'::jsonb);
end $$;

revoke all on function operacion.paqueteria_nombre(text) from public, anon, authenticated;
revoke all on function operacion._enviar_pedido_sin_catalogo(text, bigint, jsonb, jsonb, date, boolean, text) from public, anon, authenticated;
revoke all on function operacion.enviar_pedido(text, bigint, jsonb, jsonb, date, boolean, text) from public, anon;
grant execute on function operacion.enviar_pedido(text, bigint, jsonb, jsonb, date, boolean, text) to authenticated;
revoke all on function operacion.capturar_guia_pedido(text, bigint, text, text) from public, anon;
grant execute on function operacion.capturar_guia_pedido(text, bigint, text, text) to authenticated;
revoke all on function agente.pedidos_para_envio(text) from public, anon, authenticated;
grant execute on function agente.pedidos_para_envio(text) to servidor;
