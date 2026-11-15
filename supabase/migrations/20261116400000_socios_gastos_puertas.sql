-- Carril SOCIOS Y GASTOS del bot de Telegram (16-nov): dinero entre socios, gastos, renta de Omar, acta y ticket.
-- ADITIVA: rename + wrap sobre la ULTIMA definicion vigente (nunca se copia una version vieja) y funciones nuevas del esquema `agente`. No toca funciones de negocio.
--
--   * agente._ejecutar_ext_previo (puerta ext debajo de los frenos) enruta 6 tipos nuevos a agente._socios_ejecutar:
--       entrega_fondos     un socio entrega fondos de la sociedad que tiene en su poder: a la sociedad (reversible 10 min) o a Isaac/Karen (no reversible: corrige el software).
--                          NO es aportacion: baja los fondos en poder del socio (operacion.registrar_entrega_socio / pago_proveedor_de_socio con fuente fondos_sociedad).
--       liquidacion_socios un socio le liquida al otro (operacion.registrar_liquidacion_entre_socios).
--       retiro_capital     lo propone quien retira y lo CONFIRMA EL OTRO SOCIO con su propio mensaje (operacion.proponer/confirmar_retiro_capital). No se deshace.
--       renta_omar         pago de la renta de Omar por un socio (devengado y exceso los calcula SQL; un pago mayor a lo que se debe PREGUNTA, no topa).
--       gasto_caja         gasto pagado con el efectivo de la sociedad (operacion.registrar_gasto_empresa), con tipo de gasto.
--       acta_confirmar     la firma del acta es un acto de CADA socio: queda su mensaje y su id de Telegram en agente.acta_confirmacion y firma la funcion oficial. Sin boton generico.
--   * agente._deshacer_previo: 10 minutos para todos tambien en estos tipos (lo que no se puede deshacer entra a agente.tipos_no_reversibles: se corrige con un contramovimiento).
--   * agente._huella: el antiduplicado por huella de contenido cubre los tipos nuevos.
--   * agente.saldos_socios_aviso(): ambos saldos y la frase de igualacion para el aviso al grupo (cifras de SQL; el modelo no calcula).
--   * agente.evidencia_ligar_gasto(): la foto del ticket es evidencia con huella ligada al gasto; el monto lo teclea el socio (nada se lee de la imagen).
--   * agente.consulta_cierre_mensual(): cierre mensual en consulta (periodo sugerido y disponible); la propuesta y las firmas siguen en la funcion oficial.
--   * Espejo SQL de los slots de las operaciones nuevas de la conversacion (agente.operacion_slot).
-- Nada de esto envia mensajes ni calcula con IA. Los ayudantes `_*` no se conceden a ningun rol de aplicacion.

-- ------------------------------------------------------------------ libro de hechos: tipos nuevos (se parte de la definicion VIGENTE de la restriccion)
do $$
declare v_def text; v_tipos text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'agente.hecho'::regclass and conname = 'hecho_tipo_check';
  select coalesce(array_agg(distinct m[1]), '{}') into v_tipos from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') m;
  v_tipos := array(select distinct x from unnest(v_tipos || array['entrega_fondos', 'entrega_proveedor', 'liquidacion_socios', 'renta_omar', 'gasto_caja', 'retiro_capital', 'acta_confirmar']) x order by x);
  alter table agente.hecho drop constraint hecho_tipo_check;
  execute format('alter table agente.hecho add constraint hecho_tipo_check check (tipo = any (%L::text[]))', v_tipos);
end $$;

-- ------------------------------------------------------------------ confirmacion personal del acta
create table agente.acta_confirmacion (
  id bigint generated always as identity primary key,
  cierre_id bigint not null references operacion.cierre_reparto (id),
  socio text not null check (socio in ('angelo', 'javier')),
  telegram_user_id bigint not null,
  texto text not null check (char_length(texto) between 1 and 300),
  clave_idem text not null unique,
  creada_at timestamptz not null default clock_timestamp(),
  unique (cierre_id, socio)
);
alter table agente.acta_confirmacion enable row level security;
alter table agente.acta_confirmacion force row level security;
revoke all on agente.acta_confirmacion from public, anon, authenticated;

-- ------------------------------------------------------------------ ticket del gasto: evidencia con huella ligada a un solo gasto
alter table agente.evidencia_tg add column if not exists gasto_folio text;
-- La misma foto (misma huella) no respalda dos gastos: el segundo intento se avisa, no se registra una evidencia doble.
create unique index if not exists evidencia_tg_gasto_huella_idx on agente.evidencia_tg (huella) where gasto_folio is not null;

-- ------------------------------------------------------------------ antiduplicado: huella de los tipos nuevos (autor aparte: el duplicado se detecta tambien contra el OTRO socio)
alter function agente._huella(text, jsonb) rename to _huella_previo;
revoke all on function agente._huella_previo(text, jsonb) from public, anon, authenticated, servidor;

create function agente._huella(p_tipo text, p_args jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare v_obj jsonb;
begin
  if p_tipo not in ('entrega_fondos', 'liquidacion_socios', 'renta_omar', 'gasto_caja', 'retiro_capital') then return agente._huella_previo(p_tipo, p_args); end if;
  v_obj := jsonb_strip_nulls(jsonb_build_object('t', p_tipo, 'm', p_args ->> 'monto_cent', 'so', lower(p_args ->> 'socio'), 'de', lower(p_args ->> 'de_socio'), 'a', lower(p_args ->> 'a_socio'),
    'ds', lower(p_args ->> 'destino'), 'pp', lower(p_args ->> 'pagado_por'), 'vi', lower(p_args ->> 'via'), 'ca', lower(p_args ->> 'categoria'),
    -- El retiro de capital lo confirma el OTRO socio con el mismo contenido: el autor entra a la huella para que la confirmacion no sea un duplicado.
    'au', case when p_tipo = 'retiro_capital' then lower(p_args ->> 'autor') end));
  return encode(extensions.digest(v_obj::text, 'sha256'), 'hex');
end $$;

-- Una PREGUNTA (pago de renta mayor a lo que se debe) no deja huella: la respuesta afirmativa del socio se registra sin chocar con ella.
alter function agente._frenos_despues(text, text, jsonb, jsonb, jsonb) rename to _frenos_despues_previo;
revoke all on function agente._frenos_despues_previo(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated, servidor;
create function agente._frenos_despues(p_clave text, p_tipo text, p_args jsonb, p_res jsonb, p_antes jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_res ? 'pregunta_exceso_renta' then return p_res; end if;
  return agente._frenos_despues_previo(p_clave, p_tipo, p_args, p_res, p_antes);
end $$;
revoke all on function agente._frenos_despues(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated, servidor;

-- ------------------------------------------------------------------ lo que NO se deshace (se corrige con un contramovimiento desde el software)
alter function agente.tipos_no_reversibles() rename to _tipos_no_reversibles_previo;
revoke all on function agente._tipos_no_reversibles_previo() from public, anon, authenticated, servidor;

create function agente.tipos_no_reversibles() returns text[]
language sql immutable set search_path = ''
as $$ select agente._tipos_no_reversibles_previo() || array['retiro_capital', 'acta_confirmar', 'entrega_proveedor'] $$;

-- ------------------------------------------------------------------ escrituras nuevas
alter function agente._ejecutar_ext_previo(text, text, jsonb) rename to _ejecutar_ext_previo_sin_socios;
revoke all on function agente._ejecutar_ext_previo_sin_socios(text, text, jsonb) from public, anon, authenticated, servidor;

create function agente._socios_ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
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

create function agente._ejecutar_ext_previo(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if p_tipo in ('entrega_fondos', 'liquidacion_socios', 'retiro_capital', 'renta_omar', 'gasto_caja', 'acta_confirmar') then
    return agente._socios_ejecutar(p_clave_idem, p_tipo, p_args);
  end if;
  return agente._ejecutar_ext_previo_sin_socios(p_clave_idem, p_tipo, p_args);
end $$;

-- ------------------------------------------------------------------ deshacer (la ventana de 10 minutos ya la aplica el envoltorio agente.deshacer)
alter function agente._deshacer_previo(text, text, text, bigint) rename to _deshacer_previo_sin_socios;
revoke all on function agente._deshacer_previo_sin_socios(text, text, text, bigint) from public, anon, authenticated, servidor;

create function agente._deshacer_previo(p_clave_idem text, p_folio text, p_autor text, p_telegram_user_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare h agente.hecho; v_sol text; v_res jsonb; v_ev bigint; m record; n int := 0;
begin
  select * into h from agente.hecho where folio = p_folio;
  if not found or h.tipo not in ('entrega_fondos', 'liquidacion_socios', 'renta_omar', 'gasto_caja') then
    return agente._deshacer_previo_sin_socios(p_clave_idem, p_folio, p_autor, p_telegram_user_id);
  end if;
  perform notificacion.exigir_sistema();
  v_sol := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_sol, true);
  if h.deshecho_at is not null then raise exception 'el folio % ya estaba deshecho', p_folio using errcode = 'P0428'; end if;

  if h.tipo = 'liquidacion_socios' then
    v_res := operacion.anular_movimiento_socio(p_clave_idem, 'libro', h.ref_id, 'Deshecho desde Telegram');
  elsif h.tipo = 'renta_omar' then
    v_res := api.anular_pago_renta(p_clave_idem, p_folio, 'Deshecho desde Telegram');
  elsif h.tipo = 'entrega_fondos' then
    v_ev := operacion.crear_evento('deshacer_entrega', negocio.hoy(), p_clave_idem, jsonb_build_object('folio', p_folio));
    for m in select x.* from operacion.cuenta_socio_mov x
              where x.evento_id = h.ref_id and x.concepto in ('entrega_a_sociedad', 'traspaso_entre_socios') and x.reversa_de is null
                and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = x.id) loop
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id, reversa_de)
        values (m.socio_id, negocio.hoy(), 'reversa', m.aplica_a, -m.monto_cent, 'Se deshace la entrega ' || p_folio, v_ev, m.id);
      n := n + 1;
    end loop;
    if n = 0 then raise exception 'esa entrega ya estaba deshecha' using errcode = 'P0428'; end if;
    v_res := jsonb_build_object('renglones', n);
  else -- gasto_caja
    v_ev := operacion.crear_evento('deshacer_gasto', negocio.hoy(), p_clave_idem, jsonb_build_object('gasto', h.ref_id), null, null, null);
    insert into operacion.gasto_anulacion (gasto_id, motivo, evento_id, fecha_neg) values (h.ref_id, 'Deshecho desde Telegram', v_ev, negocio.hoy());
    perform operacion.revertir_efectivo('gasto', h.ref_id, v_ev, 'Se deshace el gasto ' || p_folio);
    v_res := jsonb_build_object('gasto_id', h.ref_id);
  end if;
  update agente.hecho set deshecho_at = now(), deshecho_por = v_sol where folio = p_folio;
  insert into agente.evento (tipo, miembro, detalle) values ('deshacer', p_telegram_user_id, left('deshizo ' || v_sol || ' ' || h.tipo || ' ' || p_folio, 300));
  return v_res || jsonb_build_object('folio', p_folio, 'deshecho', true, 'deshecho_por', v_sol);
end $$;

-- ------------------------------------------------------------------ lecturas: ambos saldos, ticket, cierre mensual
create function agente.saldos_socios_aviso() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_v jsonb;
begin
  perform notificacion.exigir_sistema();
  v_v := agente.valuacion_socios();
  return v_v || jsonb_build_object('socios', coalesce((
    select jsonb_agg(x || jsonb_build_object('reembolso_pendiente_cent', operacion.reembolso_pendiente(s.id), 'saldo_socio_cent', operacion.saldo_socio(s.id), 'neto_cent', operacion.neto_socio(s.id))
                     order by x ->> 'socio')
      from jsonb_array_elements(v_v -> 'socios') x join catalogo.socio s on s.nombre = x ->> 'socio'), '[]'::jsonb));
end $$;

-- Liga la ultima foto sin ligar del socio (30 minutos) al gasto. La huella ya existe (sha256 de la identidad unica del archivo): la misma foto no respalda dos gastos.
create function agente.evidencia_ligar_gasto(p_telegram_user_id bigint, p_folio text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_huella text; v_prev text;
begin
  perform notificacion.exigir_sistema();
  if not exists (select 1 from operacion.gasto g where g.folio = p_folio) then raise exception 'no encuentro el gasto %', p_folio using errcode = 'P0460'; end if;
  select e.id, e.huella into v_id, v_huella from agente.evidencia_tg e
    where e.telegram_user_id = p_telegram_user_id and e.reporte_id is null and e.gasto_folio is null and e.creada_at >= now() - interval '30 minutes'
    order by e.id desc limit 1;
  if v_id is null then return jsonb_build_object('ligada', false); end if;
  select e.gasto_folio into v_prev from agente.evidencia_tg e where e.huella = v_huella and e.gasto_folio is not null limit 1;
  if v_prev is not null then return jsonb_build_object('ligada', false, 'duplicada', true, 'gasto_previo', v_prev); end if;
  update agente.evidencia_tg set gasto_folio = p_folio where id = v_id;
  return jsonb_build_object('ligada', true, 'huella', v_huella, 'gasto', p_folio);
end $$;

-- Cierre mensual en consulta: el periodo que sugiere la base y lo disponible para repartir. La propuesta y las firmas son de las funciones oficiales.
create function agente.consulta_cierre_mensual() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_canal text := coalesce(current_setting('rtm.canal', true), ''); v_actor text := coalesce(current_setting('rtm.actor', true), '');
  v_lector text; v_p jsonb; v_d jsonb; v_pend jsonb;
begin
  perform notificacion.exigir_sistema();
  select m.persona into v_lector from agente.miembro m where m.rol = 'socio' and m.activo order by m.persona limit 1;
  if v_lector is null then raise exception 'no hay socios registrados en el agente' using errcode = 'P0460'; end if;
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_lector, true);
  v_p := api.acta_periodo_sugerido();
  if v_p is not null and v_p ->> 'ini' is not null and v_p ->> 'fin' is not null then v_d := api.acta_disponible((v_p ->> 'ini')::date, (v_p ->> 'fin')::date); end if;
  select coalesce(jsonb_agg(jsonb_build_object('folio', c.folio, 'firmas', (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id)) order by c.id), '[]'::jsonb) into v_pend
    from operacion.cierre_reparto c
   where not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = c.id) and (select count(*) from operacion.cierre_reparto_firma f where f.cierre_id = c.id) < 2;
  perform set_config('rtm.canal', v_canal, true);
  perform set_config('rtm.actor', v_actor, true);
  return jsonb_build_object('periodo', v_p, 'disponible', v_d, 'actas_pendientes', v_pend);
end $$;

-- ------------------------------------------------------------------ espejo SQL de los slots de las operaciones nuevas (src/dominio/agente/slots_socios.ts)
insert into agente.operacion_slot (operacion, orden, slot, obligatorio, si_slot, si_valor) values
  ('retiro_capital', 1, 'socio', true, null, null),
  ('retiro_capital', 2, 'monto', true, null, null),
  ('renta_omar', 1, 'monto', true, null, null),
  ('renta_omar', 2, 'pagado_por', true, null, null),
  ('renta_omar', 3, 'via', true, null, null),
  ('gasto_servicio', 1, 'servicio', true, null, null),
  ('gasto_servicio', 2, 'moneda', true, null, null),
  ('gasto_servicio', 3, 'monto', true, null, null),
  ('gasto_servicio', 4, 'pagado_por', true, null, null),
  ('gasto_servicio', 5, 'tipo_cambio', true, 'moneda', array['usd']);

-- ------------------------------------------------------------------ correccion: el pago a Omar con fondos de la sociedad se asentaba siempre como 'general'
-- (mismo defecto que ya se corrigio en las entregas: el auxiliar 'fondos' no bajaba junto con el mayor 1150 y 'Libro conciliado' quedaba en rojo). Misma definicion vigente,
-- solo cambia el renglon de la entrega a Omar; la web y el bot usan esta funcion.
CREATE OR REPLACE FUNCTION operacion.registrar_pago_omar(p_clave_idem text, p_monto_cent bigint, p_sentido text, p_socio text DEFAULT NULL::text, p_via text DEFAULT 'transferencia'::text, p_fecha date DEFAULT NULL::date, p_liquidacion_id bigint DEFAULT NULL::bigint, p_fuente text DEFAULT 'auto'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_socio bigint; v_ev bigint; v_id bigint; v_folio text; v_deuda bigint; v_desde bigint := 0; v_aport bigint := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'registrar_pago_omar', 'm', p_monto_cent, 's', p_sentido, 'so', p_socio, 'v', p_via, 'f', p_fecha, 'l', p_liquidacion_id, 'u', p_fuente));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  if p_sentido not in ('a_omar', 'de_omar') or p_via not in ('transferencia', 'efectivo') or p_fuente not in ('auto', 'fondos_sociedad', 'aportacion') then raise exception 'pago invalido' using errcode = '22023'; end if;
  if p_socio is not null then select id into v_socio from catalogo.socio where nombre = p_socio; if v_socio is null then raise exception 'socio desconocido' using errcode = '22023'; end if; end if;
  if p_sentido = 'a_omar' and v_socio is null then raise exception 'indica el socio que pago a Omar' using errcode = '23502'; end if;
  v_ev := operacion.crear_evento('pago_omar', v_fecha, p_clave_idem, jsonb_build_object('sentido', p_sentido, 'monto_cent', p_monto_cent));
  v_folio := seguridad.siguiente_folio('PO');
  insert into operacion.pago_omar (folio, fecha_neg, monto_cent, sentido, socio_id, via, liquidacion_id, evento_id) values (v_folio, v_fecha, p_monto_cent, p_sentido, v_socio, p_via, p_liquidacion_id, v_ev) returning id into v_id;
  if p_sentido = 'a_omar' then
    -- El socio paga a Omar: baja primero lo que debe a la sociedad (si la fuente lo permite); el resto es aportacion reembolsable.
    v_deuda := greatest(operacion.saldo_socio(v_socio), 0);
    v_desde := case p_fuente when 'aportacion' then 0 else least(p_monto_cent, v_deuda) end;
    v_aport := p_monto_cent - v_desde;
    if v_desde > 0 then
      -- Lo que baja del poder del socio se parte en fondos / diferencia / general (como las entregas): el mayor 1150/1170 y el auxiliar bajan juntos.
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
        select v_socio, v_fecha, 'entrega_a_proveedor', x.aplica_a, -x.monto_cent, 'Pago a Omar ' || v_folio || ' con fondos de la sociedad', v_ev
          from operacion.partir_entrega_socio(v_socio, 'general', v_desde) x;
    end if;
    if v_aport > 0 then
      insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id)
        values (v_socio, v_aport, 'Pago a Omar ' || v_folio, 'reembolsable', v_fecha, 'pago_omar', v_id, v_ev);
    end if;
  elsif v_socio is not null then
    -- Omar paga y lo recibe un socio: son fondos de la sociedad en su poder.
    insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
      values (v_socio, v_fecha, 'fondos_en_poder', 'fondos', p_monto_cent, 'Pago de Omar ' || v_folio, v_ev);
  end if;
  v_res := jsonb_build_object('pago_id', v_id, 'folio', v_folio, 'saldo_omar_cent', operacion.saldo_omar_cuenta());
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$;
revoke execute on function operacion.registrar_pago_omar(text, bigint, text, text, text, date, bigint, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ privilegios
revoke all on function agente._socios_ejecutar(text, text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente._ejecutar_ext_previo(text, text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente._deshacer_previo(text, text, text, bigint) from public, anon, authenticated, servidor;
revoke all on function agente._huella(text, jsonb) from public, anon, authenticated;
revoke all on function agente.tipos_no_reversibles() from public, anon, authenticated;
grant execute on function agente.tipos_no_reversibles() to servidor;
revoke all on function agente.saldos_socios_aviso() from public, anon, authenticated;
grant execute on function agente.saldos_socios_aviso() to servidor;
revoke all on function agente.evidencia_ligar_gasto(bigint, text) from public, anon, authenticated;
grant execute on function agente.evidencia_ligar_gasto(bigint, text) to servidor;
revoke all on function agente.consulta_cierre_mensual() from public, anon, authenticated;
grant execute on function agente.consulta_cierre_mensual() to servidor;
