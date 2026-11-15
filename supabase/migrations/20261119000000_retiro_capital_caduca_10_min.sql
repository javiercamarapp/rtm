-- Cierre de BAJO del workflow del bot (19-nov): el retiro de capital propuesto no caducaba. Una propuesta vieja la confirmaba cualquier mensaje posterior del otro
-- socio con el mismo socio y monto. Ahora la propuesta solo se confirma dentro de agente._ventana_minutos() (10 minutos), igual que las preguntas de duplicado y de
-- cobro mayor a lo que debe. Pasado ese tiempo, el mensaje del otro socio ya no confirma: el retiro lo vuelve a proponer quien lo retira (y se registra como nueva propuesta).
-- Aditiva: create or replace de agente._socios_ejecutar con el mismo cuerpo de 20261116400000 y UNA condicion mas. Sin cambios de privilegios (se conservan).

create or replace function agente._socios_ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor text; v_origen text; v_existia boolean; v_res jsonb; v_folio text; v_monto bigint; v_socio text; v_otro text; v_dest text; v_ev bigint; v_id bigint; v_via text;
  v_ret bigint; v_cierre bigint; v_saldo bigint; v_pag text; v_r jsonb; v_cat text; v_firmas int; v_texto text; v_modo text; v_yo bigint;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  v_origen := agente._origen(p_args);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
  v_monto := nullif(p_args ->> 'monto_cent', '')::bigint;
  if p_tipo <> 'acta_confirmar' and (v_monto is null or v_monto <= 0) then raise exception 'dime el monto completo, mayor a cero' using errcode = 'P0460'; end if;

  if p_tipo = 'entrega_fondos' then
    v_socio := initcap(p_args ->> 'socio');
    v_dest := lower(coalesce(p_args ->> 'destino', ''));
    if v_socio not in ('Angelo', 'Javier') then raise exception 'dime que socio entrega, Angelo o Javier' using errcode = 'P0460'; end if;
    if v_dest = 'sociedad' then
      v_res := operacion.registrar_entrega_socio(p_clave_idem, v_socio, v_monto, 'sociedad', null, 'general', left(p_args ->> 'nota', 400), null);
      select e.id into v_ev from operacion.evento e where e.clave_idem = p_clave_idem;
      v_folio := agente._guardar_hecho2(p_clave_idem, 'entrega_fondos', 'evento', v_ev, v_autor, null);
    elsif v_dest in ('isaac', 'karen') then
      -- Entregar fondos de la sociedad a un proveedor: sale SOLO de lo que el socio tiene en su poder; no es aportacion ni capital.
      v_res := operacion.pago_proveedor_de_socio(p_clave_idem, initcap(v_dest), v_monto, v_socio, 'fondos_sociedad', null, left(p_args ->> 'nota', 400), v_origen, false);
      select e.id into v_ev from operacion.evento e where e.clave_idem = p_clave_idem;
      v_folio := agente._guardar_hecho2(p_clave_idem, 'entrega_proveedor', 'evento', v_ev, v_autor, null);
    else
      raise exception 'dime a quien entrega: la sociedad, Isaac o Karen' using errcode = 'P0460';
    end if;
    return v_res || jsonb_build_object('folio', v_folio, 'socio', v_socio, 'destino', v_dest, 'monto_cent', v_monto, 'repetido', v_existia);

  elsif p_tipo = 'liquidacion_socios' then
    v_socio := initcap(p_args ->> 'de_socio'); v_otro := initcap(p_args ->> 'a_socio');
    if v_socio not in ('Angelo', 'Javier') or v_otro not in ('Angelo', 'Javier') or v_socio = v_otro then raise exception 'indica dos socios distintos: quien paga y a quien' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_liquidacion_entre_socios(p_clave_idem, v_socio, v_otro, v_monto, left(p_args ->> 'nota', 400), null, v_origen);
    select l.id into v_id from operacion.socio_libro l join operacion.evento e on e.id = l.evento_id where e.clave_idem = p_clave_idem and l.concepto = 'liquidacion_recibida' limit 1;
    v_folio := agente._guardar_hecho2(p_clave_idem, 'liquidacion_socios', 'libro', v_id, v_autor, null);
    return v_res || jsonb_build_object('folio', v_folio, 'de_socio', v_socio, 'a_socio', v_otro, 'monto_cent', v_monto, 'repetido', v_existia);

  elsif p_tipo = 'retiro_capital' then
    v_socio := initcap(p_args ->> 'socio');
    if v_socio not in ('Angelo', 'Javier') then raise exception 'dime que socio retira capital, Angelo o Javier' using errcode = 'P0460'; end if;
    v_yo := operacion.actor_socio();
    -- Si el OTRO socio ya propuso exactamente este retiro y esta sin confirmar, este mensaje es la confirmacion del segundo socio.
    select r.id into v_ret from operacion.retiro_capital r
      where r.socio_id = (select id from catalogo.socio where nombre = v_socio) and r.monto_cent = v_monto and r.propuesto_por <> v_yo
        and not exists (select 1 from operacion.retiro_capital_confirmacion c where c.retiro_id = r.id)
        -- Caduca como las demas preguntas de dinero: la propuesta solo la confirma el otro socio dentro de la ventana (10 minutos).
        and (select e.hora from operacion.evento e where e.id = r.evento_id) > now() - make_interval(mins => agente._ventana_minutos())
      order by r.id desc limit 1;
    if v_ret is not null then
      v_modo := 'confirmado';
      v_res := operacion.confirmar_retiro_capital(p_clave_idem, v_ret);
    else
      -- El capital lo declara cada socio por si mismo: lo propone quien lo retira y lo confirma el otro.
      if lower(v_socio) <> v_autor then raise exception 'el retiro de capital lo propone quien lo retira (%) y lo confirma el otro socio con su propio mensaje', v_socio using errcode = 'P0460'; end if;
      v_modo := 'propuesto';
      v_res := operacion.proponer_retiro_capital(p_clave_idem, v_socio, v_monto, left(p_args ->> 'nota', 400));
      v_ret := (v_res ->> 'retiro_id')::bigint;
    end if;
    select e.id into v_ev from operacion.evento e where e.clave_idem = p_clave_idem;
    v_folio := agente._guardar_hecho2(p_clave_idem, 'retiro_capital', 'evento', v_ev, v_autor, null);
    return v_res || jsonb_build_object('folio', v_folio, 'socio', v_socio, 'monto_cent', v_monto, 'modo', v_modo, 'retiro_id', v_ret, 'repetido', v_existia);

  elsif p_tipo = 'renta_omar' then
    v_pag := lower(coalesce(p_args ->> 'pagado_por', ''));
    v_via := coalesce(nullif(lower(p_args ->> 'via'), ''), 'transferencia');
    if v_pag not in ('angelo', 'javier') then raise exception 'la renta de Omar la paga un socio (con fondos de la sociedad en su poder o de su bolsillo): dime quien, Angelo o Javier' using errcode = 'P0460'; end if;
    if v_via not in ('transferencia', 'efectivo') then raise exception 'dime si fue por transferencia o en efectivo' using errcode = 'P0460'; end if;
    v_saldo := greatest(coalesce((operacion.renta_estado(negocio.hoy()) ->> 'saldo_cent')::bigint, 0), 0);
    -- Sin tope: un pago mayor a lo que se debe a Omar se PREGUNTA (anticipo) y se registra con la confirmacion del socio.
    if not v_existia and v_monto > v_saldo and not coalesce((p_args ->> 'confirmo_exceso')::boolean, false) then
      return jsonb_build_object('pregunta_exceso_renta', true, 'monto_cent', v_monto, 'debe_cent', v_saldo);
    end if;
    v_r := operacion.registrar_pago_omar('rr:' || p_clave_idem, v_monto, 'a_omar', initcap(v_pag), v_via, negocio.hoy(), null, 'auto');
    insert into operacion.pago_renta_detalle (pago_id, nota, comprobante, exceso_cent, registrado_por)
      values ((v_r ->> 'pago_id')::bigint, nullif(btrim(left(p_args ->> 'nota', 400)), ''), null, greatest(v_monto - v_saldo, 0), null) on conflict (pago_id) do nothing;
    v_folio := agente._guardar_hecho2(p_clave_idem, 'renta_omar', null, null, v_autor, v_r ->> 'folio');
    -- El resultado guardado por la operacion interna lleva el estado de la renta DESPUES de este pago.
    v_res := jsonb_build_object('folio', v_folio, 'monto_cent', v_monto, 'socio', initcap(v_pag), 'via', v_via, 'exceso_cent', greatest(v_monto - v_saldo, 0),
      'saldo_antes_cent', v_saldo, 'saldo_despues_cent', greatest((operacion.renta_estado(negocio.hoy()) ->> 'saldo_cent')::bigint, 0),
      'a_favor_cent', (operacion.renta_estado(negocio.hoy()) ->> 'a_favor_cent')::bigint);
    return v_res || jsonb_build_object('repetido', v_existia);

  elsif p_tipo = 'gasto_caja' then
    v_cat := nullif(btrim(p_args ->> 'categoria'), '');
    if v_cat is null then raise exception 'dime que tipo de gasto es (guia, envio, uber, comision de terminal, servicio u otro)' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_gasto_empresa(p_clave_idem, v_monto, v_cat, coalesce(p_args ->> 'naturaleza', 'variable'), null, 'Caja de la empresa', left(p_args ->> 'nota', 400), v_origen);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'gasto_caja', 'gasto', (v_res ->> 'gasto_id')::bigint, v_autor, v_res ->> 'folio');
    return v_res || jsonb_build_object('folio', v_folio, 'monto_cent', v_monto, 'categoria', v_cat, 'repetido', v_existia);

  else -- acta_confirmar
    v_texto := nullif(btrim(coalesce(p_args ->> 'confirmacion_texto', '')), '');
    if v_texto is null or v_texto !~* '(firm|confirm|acept|aprueb|de acuerdo|conforme)' then
      raise exception 'la firma del acta la da cada socio con su propio mensaje: escribe, por ejemplo, "firmo el acta"' using errcode = 'P0460';
    end if;
    if nullif(p_args ->> 'cierre_folio', '') is not null then
      select id into v_cierre from operacion.cierre_reparto where folio = upper(btrim(p_args ->> 'cierre_folio'));
    else
      select c.id into v_cierre from operacion.cierre_reparto c
       where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id)
         and not exists (select 1 from operacion.cierre_reparto_firma f where f.cierre_id = c.id and f.socio_id = operacion.actor_socio())
         and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) < 2
       order by c.id desc limit 1;
    end if;
    if v_cierre is null then raise exception 'no hay un acta pendiente de tu firma' using errcode = 'P0460'; end if;
    insert into agente.acta_confirmacion (cierre_id, socio, telegram_user_id, texto, clave_idem)
      values (v_cierre, v_autor, (p_args ->> 'telegram_user_id')::bigint, left(v_texto, 300), p_clave_idem) on conflict do nothing;
    v_res := operacion.firmar_cierre_reparto(p_clave_idem, v_cierre);
    v_folio := agente._guardar_hecho2(p_clave_idem, 'acta_confirmar', 'cierre', v_cierre, v_autor, null);
    select count(*) into v_firmas from operacion.cierre_reparto_firma f where f.cierre_id = v_cierre;
    return v_res || jsonb_build_object('folio', v_folio, 'acta', (select folio from operacion.cierre_reparto where id = v_cierre), 'firmas', v_firmas, 'faltan_firmas', greatest(2 - v_firmas, 0),
      'confirmaciones', (select jsonb_agg(c.socio order by c.id) from agente.acta_confirmacion c where c.cierre_id = v_cierre), 'repetido', v_existia);
  end if;
end $$;
