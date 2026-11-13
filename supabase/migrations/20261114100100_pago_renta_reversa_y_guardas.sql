-- Pago de renta, correcciones del verificador (14-nov). ADITIVA sobre 20261114100000: no se edita esa migracion.
--
--  B1  api.registrar_pago_omar (preexistente) aceptaba cualquier monto. Ahora, del lado "a_omar", pasa por la MISMA guarda que api.registrar_pago_renta
--      (operacion.validar_pago_renta): un pago mayor que lo que se debe se rechaza con P0428 salvo p_confirmo_exceso = true (parametro nuevo, al final).
--      operacion.registrar_pago_omar (interna, sin EXECUTE para la web) no cambia: la usan el cargador y las pruebas previas.
--  B2  Topes: un pago no pasa de 10,000,000.00 pesos (1,000,000,000 centavos) y el anticipo (saldo a favor de Omar) resultante tampoco.
--  B3  Reversa de un pago de renta registrado por error: api.anular_pago_renta(clave, folio, motivo). Solo socio, motivo obligatorio, idempotente, auditada (evento propio).
--      NO borra ni edita el pago original (inmutable): inserta un contra-pago (fila de pago_omar con monto NEGATIVO y reversa_de = el original, folio propio) y las reversas de los
--      renglones del libro del socio que el pago habia creado (cuenta_socio_mov y aportacion_socio). Como todas las sumas de "pagado a Omar" suman los pagos a_omar, el saldo
--      de la cuenta 2210, por pagar y el libro del socio vuelven EXACTOS sin tocar ninguna otra funcion; el asiento de la reversa sale del mismo generador (haber 2210, etc.).
--  B4  Fecha del pago: no futura, no mas de 400 dias atras y no anterior al primer devengo de renta.
--  B6  operacion.renta_serie agrega 'acum_mes_cent' (renta acumulada del mes hasta ese dia, calculada en la base) para que la linea del mes no sume dinero en el navegador.
--
-- GRANT: solo EXECUTE a authenticated en api.anular_pago_renta y en la nueva firma de api.registrar_pago_omar; cada una valida el rol dentro (socio). Nada a anon ni PUBLIC.

-- ---------------------------------------------------------------------------
-- pago_omar admite contra-pagos (monto negativo enlazado al original)
-- ---------------------------------------------------------------------------
alter table operacion.pago_omar add column reversa_de bigint unique references operacion.pago_omar (id);
alter table operacion.pago_omar add column motivo_reversa text;
alter table operacion.pago_omar drop constraint pago_omar_monto_cent_check;
alter table operacion.pago_omar add constraint pago_omar_monto_reversa_chk check (
  (reversa_de is null and monto_cent > 0 and motivo_reversa is null) or (reversa_de is not null and monto_cent < 0 and sentido = 'a_omar' and motivo_reversa is not null));

-- ---------------------------------------------------------------------------
-- Guarda unica de un pago a Omar (monto, topes, fecha, exceso). Devuelve el exceso (0 si no hay).
-- ---------------------------------------------------------------------------
create function operacion.validar_pago_renta(p_monto_cent bigint, p_fecha date, p_confirmo_exceso boolean) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare
  c_tope constant bigint := 1000000000; c_dias constant int := 400;
  v_hoy date := negocio.hoy(); v_prim date; v_saldo bigint; v_exceso bigint := 0;
begin
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago de renta debe ser positivo' using errcode = '23514'; end if;
  if p_monto_cent > c_tope then raise exception 'un pago no puede pasar de 10,000,000.00 MXN' using errcode = '23514'; end if;
  if p_fecha > v_hoy then raise exception 'la fecha del pago no puede ser futura' using errcode = '22023'; end if;
  if p_fecha < v_hoy - c_dias then raise exception 'la fecha del pago no puede ser de hace mas de % dias', c_dias using errcode = '22023'; end if;
  select min(devengada_fecha) into v_prim from operacion.renta_devengo where reversa_de is null;
  if v_prim is not null and p_fecha < v_prim then raise exception 'la fecha del pago (%) es anterior al primer devengo de renta (%)', p_fecha, v_prim using errcode = '22023'; end if;
  v_saldo := (operacion.renta_estado(v_hoy)->>'saldo_cent')::bigint;
  if p_monto_cent > greatest(v_saldo, 0) then
    if not coalesce(p_confirmo_exceso, false) then
      raise exception 'el pago (% MXN) es mayor que lo que se debe a Omar (% MXN). Confirma que es un anticipo para registrarlo.',
        to_char(p_monto_cent / 100.0, 'FM999,999,999,990.00'), to_char(greatest(v_saldo, 0) / 100.0, 'FM999,999,999,990.00') using errcode = 'P0428';
    end if;
    v_exceso := p_monto_cent - greatest(v_saldo, 0);
    if p_monto_cent - v_saldo > c_tope then raise exception 'el anticipo a favor de Omar no puede pasar de 10,000,000.00 MXN' using errcode = '23514'; end if;
  end if;
  return v_exceso;
end $$;

-- ---------------------------------------------------------------------------
-- api.registrar_pago_renta: misma firma, ahora con la guarda unica
-- ---------------------------------------------------------------------------
create or replace function api.registrar_pago_renta(p_clave_idem text, p_monto_cent bigint, p_socio text default null, p_via text default 'transferencia', p_fecha date default null,
                                                    p_nota text default null, p_comprobante text default null, p_confirmo_exceso boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_socio text; v_saldo bigint; v_exceso bigint;
  v_r jsonb; v_pago bigint; v_despues jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'api.registrar_pago_renta', 'm', p_monto_cent, 's', p_socio, 'v', p_via, 'f', p_fecha, 'n', p_nota, 'c', p_comprobante, 'x', p_confirmo_exceso));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago de renta debe ser positivo' using errcode = '23514'; end if;
  if p_via is null or p_via not in ('transferencia', 'efectivo') then raise exception 'via de pago invalida' using errcode = '22023'; end if;
  if p_nota is not null and char_length(p_nota) > 500 then raise exception 'la nota admite hasta 500 caracteres' using errcode = '22023'; end if;
  if p_comprobante is not null and char_length(p_comprobante) > 120 then raise exception 'la referencia del comprobante admite hasta 120 caracteres' using errcode = '22023'; end if;
  v_socio := coalesce(nullif(btrim(p_socio), ''), (select u.socio_nombre from seguridad.usuario u where u.id = auth.uid()));
  if v_socio is null or not exists (select 1 from catalogo.socio where nombre = v_socio) then raise exception 'indica el socio que paga la renta' using errcode = '23502'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pago_renta', 0));
  v_saldo := (operacion.renta_estado(negocio.hoy())->>'saldo_cent')::bigint;
  v_exceso := operacion.validar_pago_renta(p_monto_cent, v_fecha, p_confirmo_exceso);
  v_r := operacion.registrar_pago_omar('rr:' || p_clave_idem, p_monto_cent, 'a_omar', v_socio, p_via, v_fecha, null, 'auto');
  v_pago := (v_r->>'pago_id')::bigint;
  insert into operacion.pago_renta_detalle (pago_id, nota, comprobante, exceso_cent, registrado_por) values (v_pago, nullif(btrim(p_nota), ''), nullif(btrim(p_comprobante), ''), v_exceso, auth.uid());
  v_despues := operacion.renta_estado(negocio.hoy());
  v_res := jsonb_build_object('pago_id', v_pago, 'folio', v_r->>'folio', 'monto_cent', p_monto_cent, 'exceso_cent', v_exceso,
                              'saldo_antes_cent', v_saldo, 'saldo_despues_cent', (v_despues->>'saldo_cent')::bigint,
                              'por_pagar_cent', (v_despues->>'por_pagar_cent')::bigint, 'a_favor_cent', (v_despues->>'a_favor_cent')::bigint, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- B1: el envoltorio preexistente api.registrar_pago_omar pasa por la guarda (a_omar) y gana p_confirmo_exceso
-- ---------------------------------------------------------------------------
drop function api.registrar_pago_omar(text, bigint, text, text, text, date, bigint, text);
create function api.registrar_pago_omar(p_clave_idem text, p_monto_cent bigint, p_sentido text, p_socio text default null, p_via text default 'transferencia',
                                        p_fecha date default null, p_liquidacion_id bigint default null, p_fuente text default 'auto', p_confirmo_exceso boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_fecha date := coalesce(p_fecha, negocio.hoy());
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_sentido = 'a_omar' then
    -- Un pago repetido (misma clave) se resuelve por idempotencia dentro de la funcion interna: la guarda solo corre si la clave es nueva.
    if not exists (select 1 from seguridad.operacion where clave = p_clave_idem) then
      perform pg_advisory_xact_lock(hashtextextended('pago_renta', 0));
      perform operacion.validar_pago_renta(p_monto_cent, v_fecha, p_confirmo_exceso);
    end if;
  elsif p_monto_cent is not null and p_monto_cent > 1000000000 then
    raise exception 'un pago no puede pasar de 10,000,000.00 MXN' using errcode = '23514';
  end if;
  return operacion.registrar_pago_omar(p_clave_idem, p_monto_cent, p_sentido, p_socio, p_via, p_fecha, p_liquidacion_id, p_fuente);
end $$;

-- ---------------------------------------------------------------------------
-- B3: reversa de un pago de renta
-- ---------------------------------------------------------------------------
create function api.anular_pago_renta(p_clave_idem text, p_folio text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; p operacion.pago_omar; v_ev bigint; v_folio text; v_id bigint; v_motivo text := nullif(btrim(p_motivo), ''); v_antes jsonb; v_despues jsonb; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  if nullif(btrim(p_clave_idem), '') is null then raise exception 'falta la clave de idempotencia' using errcode = '22023'; end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'api.anular_pago_renta', 'f', p_folio, 'm', p_motivo));
  if v_prev is not null then return v_prev || jsonb_build_object('repetido', true); end if;
  if v_motivo is null then raise exception 'anular un pago exige motivo' using errcode = '23502'; end if;
  if char_length(v_motivo) > 500 then raise exception 'el motivo admite hasta 500 caracteres' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pago_renta', 0));
  select * into p from operacion.pago_omar where folio = p_folio for update;
  if not found or p.sentido <> 'a_omar' then raise exception 'pago de renta desconocido' using errcode = '22023'; end if;
  if p.reversa_de is not null then raise exception 'ese folio ya es una reversa: no se anula' using errcode = 'P0428'; end if;
  if exists (select 1 from operacion.pago_omar r where r.reversa_de = p.id) then raise exception 'el pago % ya esta anulado', p.folio using errcode = 'P0428'; end if;
  v_antes := operacion.renta_estado(negocio.hoy());
  v_ev := operacion.crear_evento('anular_pago_renta', negocio.hoy(), p_clave_idem, jsonb_build_object('pago', p.folio), null, p.evento_id, v_motivo);
  v_folio := seguridad.siguiente_folio('PO');
  insert into operacion.pago_omar (folio, fecha_neg, monto_cent, sentido, socio_id, via, liquidacion_id, evento_id, reversa_de, motivo_reversa)
    values (v_folio, negocio.hoy(), -p.monto_cent, 'a_omar', p.socio_id, p.via, p.liquidacion_id, v_ev, p.id, v_motivo) returning id into v_id;
  -- Lo que el pago movio del lado del socio vuelve exacto.
  insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id, reversa_de)
    select m.socio_id, negocio.hoy(), 'reversa', m.aplica_a, -m.monto_cent, 'Se anula el pago de renta ' || p.folio || ': ' || v_motivo, v_ev, m.id
      from operacion.cuenta_socio_mov m where m.evento_id = p.evento_id and m.concepto = 'entrega_a_proveedor' and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id);
  insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, ref_id, evento_id, reversa_de)
    select a.socio_id, -a.monto_cent, 'Se anula el pago de renta ' || p.folio || ': ' || v_motivo, a.clasificacion, negocio.hoy(), a.ref_tipo, a.ref_id, v_ev, a.id
      from operacion.aportacion_socio a where a.ref_tipo = 'pago_omar' and a.ref_id = p.id and a.reversa_de is null and not exists (select 1 from operacion.aportacion_socio r where r.reversa_de = a.id);
  insert into operacion.pago_renta_detalle (pago_id, nota, exceso_cent, registrado_por) values (v_id, 'Anula ' || p.folio || ': ' || v_motivo, 0, auth.uid());
  v_despues := operacion.renta_estado(negocio.hoy());
  v_res := jsonb_build_object('pago_original', p.folio, 'folio_reversa', v_folio, 'monto_cent', p.monto_cent,
                              'saldo_antes_cent', (v_antes->>'saldo_cent')::bigint, 'saldo_despues_cent', (v_despues->>'saldo_cent')::bigint,
                              'por_pagar_cent', (v_despues->>'por_pagar_cent')::bigint, 'a_favor_cent', (v_despues->>'a_favor_cent')::bigint, 'repetido', false);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas: historial con reversas y renta acumulada del mes desde la base
-- ---------------------------------------------------------------------------
create or replace function operacion.renta_pagos(p_interno boolean, p_limite int) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x->>'fecha') desc, (x->>'folio') desc), '[]'::jsonb) from (
    select jsonb_build_object('folio', p.folio, 'fecha', p.fecha_neg, 'monto_cent', p.monto_cent, 'via', p.via, 'es_reversa', p.reversa_de is not null,
                              'anulado', exists (select 1 from operacion.pago_omar r where r.reversa_de = p.id))
           || case when p_interno
                then jsonb_build_object('socio', s.nombre, 'nota', d.nota, 'comprobante', d.comprobante, 'exceso_cent', coalesce(d.exceso_cent, 0), 'motivo_reversa', p.motivo_reversa, 'reversa_de_folio', o.folio)
                else '{}'::jsonb end as x
      from operacion.pago_omar p left join catalogo.socio s on s.id = p.socio_id left join operacion.pago_renta_detalle d on d.pago_id = p.id left join operacion.pago_omar o on o.id = p.reversa_de
     where p.sentido = 'a_omar'
     order by p.fecha_neg desc, p.id desc limit least(greatest(coalesce(p_limite, 50), 1), 200)) q
$$;

create or replace function operacion.renta_serie(p_hoy date, p_dias int) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('fecha', q.f, 'piezas', q.pz, 'renta_cent', q.rc, 'acum_mes_cent', q.acum) order by q.f), '[]'::jsonb)
  from (select d.f, d.pz, d.rc, sum(d.rc) over (partition by date_trunc('month', d.f) order by d.f)::bigint as acum
          from (select r.devengada_fecha as f, sum(r.piezas)::bigint as pz, sum(r.monto_cent)::bigint as rc
                  from operacion.renta_devengo r where r.devengada_fecha <= p_hoy
                 group by r.devengada_fecha having sum(r.piezas) <> 0 or sum(r.monto_cent) <> 0) d
         where d.f >= p_hoy - (greatest(coalesce(p_dias, 366), 1) - 1)) q
$$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke execute on function operacion.validar_pago_renta(bigint, date, boolean) from public, anon, authenticated;
revoke execute on function api.anular_pago_renta(text, text, text), api.registrar_pago_omar(text, bigint, text, text, text, date, bigint, text, boolean) from public, anon;
grant execute on function api.anular_pago_renta(text, text, text), api.registrar_pago_omar(text, bigint, text, text, text, date, bigint, text, boolean) to authenticated;
