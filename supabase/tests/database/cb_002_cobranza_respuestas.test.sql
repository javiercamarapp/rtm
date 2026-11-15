-- pgTAP cb_002: carril COBRANZA, respuestas del socio. Pago total y parcial (reparto por SQL, cuenta y monto que faltan se preguntan), promesa y atraso (la fecha la resuelve el codigo,
-- el plazo contractual NO cambia), extension explicita solo del duenio, disputa, pausa, conflicto entre socios, idempotencia, antiduplicado, solo lectura, deshacer 10 minutos y metricas.
-- Datos FICTICIOS; el dinero pasa por la puerta de cobro existente. Nada se envia a Telegram.
begin;
select no_plan();
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select agente.registrar_miembro(5170001, 'javier');
select agente.registrar_miembro(5170002, 'angelo');
select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_cliente('CB Cliente A', 'Javier');
select catalogo.asegurar_cliente('CB Cliente B', 'Javier');
select catalogo.asegurar_cliente('CB Cliente C', 'Angelo');
select catalogo.asegurar_cliente('CB Cliente D', 'Javier');
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('CB Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('CB Omar Cliente', 'CB Omar');
  end if;
end $$;
select catalogo.asegurar_modelo('CB Marca', 'CB Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('CB Modelo', 'Uva');
select catalogo.fijar_costo('cb:k', 'Karen', 'CB Modelo', 10000, negocio.hoy() - 40, 'prueba');
select catalogo.fijar_costo('cb:k2', 'Isaac', 'CB Modelo', 11000, negocio.hoy() - 40, 'prueba');
select catalogo.fijar_precio('cb:p1', 'CB Cliente A', 'CB Modelo', 25000, negocio.hoy() - 40, 'chat');
select catalogo.fijar_precio('cb:p2', 'CB Cliente B', 'CB Modelo', 25000, negocio.hoy() - 40, 'chat');
select catalogo.fijar_precio('cb:p3', 'CB Cliente C', 'CB Modelo', 25000, negocio.hoy() - 40, 'chat');
select catalogo.fijar_precio('cb:p4', 'CB Cliente D', 'CB Modelo', 25000, negocio.hoy() - 40, 'chat');
select operacion.registrar_movimiento('cb:m1', 'CB Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 400, 4000000, negocio.hoy() - 30);

create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.args(p jsonb) returns jsonb language sql as $$ select jsonb_build_object('autor', 'javier', 'telegram_user_id', 5170001, 'origen', 'x') || p $$;
create function pg_temp.lin(p_pz int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_canonico = 'CB Modelo'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = 'Uva'), 'piezas', p_pz)) $$;
-- Pedido enviado en una fecha pasada (la fecha de negocio de la sesion se fija solo durante el envio).
create function pg_temp.pedido(p_clave text, p_cliente text, p_plazo int, p_pz int, p_envio date) returns text language plpgsql as $$
declare v_folio text;
begin
  perform set_config('rtm.fecha_negocio', p_envio::text, true);
  perform agente.ejecutar_ext(p_clave, 'pedido_crear', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli(p_cliente), 'plazo_dias', p_plazo, 'lineas', pg_temp.lin(p_pz))));
  select folio into v_folio from operacion.pedido where id = (select (resultado ->> 'pedido_id')::bigint from seguridad.operacion where clave = p_clave);
  perform agente.ejecutar_ext(p_clave || 'e', 'envio_lote', pg_temp.args(jsonb_build_object('aceptar_avisos', true, 'paqueteria', 'castores', 'folios', jsonb_build_array(v_folio))));
  perform set_config('rtm.fecha_negocio', '', true);
  return v_folio;
end $$;
create function pg_temp.pedido2(p_clave text, p_cliente text, p_plazo int, p_pz int, p_envio date) returns text language plpgsql as $$
declare v_folio text; v_id bigint;
begin
  perform set_config('rtm.fecha_negocio', p_envio::text, true);
  perform agente.ejecutar_ext(p_clave, 'pedido_crear', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli(p_cliente), 'plazo_dias', p_plazo, 'lineas', pg_temp.lin(p_pz))));
  select id, folio into v_id, v_folio from operacion.pedido where id = (select (resultado ->> 'pedido_id')::bigint from seguridad.operacion where clave = p_clave);
  perform operacion.enviar_pedido(p_clave || 'e', v_id, null, null, p_envio, true);
  perform set_config('rtm.fecha_negocio', '', true);
  return v_folio;
end $$;
create temp table cb_f as select 1 as n;
create function pg_temp.f(p text) returns text language sql as $$ select folio from operacion.pedido where id = (select (resultado ->> 'pedido_id')::bigint from seguridad.operacion where clave = $1) $$;
select pg_temp.pedido('cb:a1', 'CB Cliente A', 10, 16, '2026-11-06');   -- vence el 16
select pg_temp.pedido('cb:b1', 'CB Cliente B', 10, 40, '2026-11-07');   -- vence el 17
select pg_temp.pedido('cb:b2', 'CB Cliente B', 10, 20, '2026-11-07');   -- vence el 17 (segundo pedido del mismo cliente)
select pg_temp.pedido('cb:c1', 'CB Cliente C', 10, 12, '2026-11-10');   -- vence el 20
select pg_temp.pedido('cb:d1', 'CB Cliente D', 10, 8, '2026-11-10');    -- vence el 20
create function pg_temp.h(p text) returns jsonb language sql as $$ select jsonb_build_object('hoy', $1) $$;
create function pg_temp.dig(p text) returns text language sql as $$ select cobranza.armar_digest(p::date, 'am') ->> 'texto' $$;
create function pg_temp.id(p_clave text) returns bigint language sql as $$ select (resultado ->> 'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;


create function pg_temp.r(p_clave text, p jsonb) returns jsonb language sql as $$
  select agente.cobranza_responder(p_clave, jsonb_build_object('autor', 'javier', 'telegram_user_id', 5170001, 'hoy', '2026-11-17', 'cita', 'prueba') || p) $$;
create function pg_temp.ra(p_clave text, p jsonb) returns jsonb language sql as $$
  select agente.cobranza_responder(p_clave, jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5170002, 'hoy', '2026-11-17', 'cita', 'prueba') || p) $$;
create function pg_temp.saldo(p text) returns bigint language sql as $$ select operacion.pedido_saldo(pg_temp.id($1)) $$;
create function pg_temp.sg(p text) returns cobranza.seguimiento language sql as $$ select s from cobranza.seguimiento s where s.pedido_id = pg_temp.id($1) $$;
create temp table cb_i as select pg_temp.saldo('cb:a1') as a1, pg_temp.saldo('cb:b1') as b1, pg_temp.saldo('cb:b2') as b2, pg_temp.saldo('cb:c1') as c1, pg_temp.saldo('cb:d1') as d1;
create temp table cb_n as select coalesce((select max(id) from notificacion.entrega), 0) as ultimo;

-- ---------------------------------------------------------------- solo lectura: el bot arranca sin escribir
update seguridad.interruptor set activo = false where clave = 'agente_escritura';
select throws_ok($$select pg_temp.r('cb:ro', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente A'), 'accion', 'aun_no'))$$, 'P0463', null, 'solo lectura: la respuesta de cobranza no escribe');
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select throws_ok($$select agente.cobranza_responder('cb:x', '{"autor":"javier","telegram_user_id":9999999,"cliente_id":1,"accion":"aun_no"}'::jsonb)$$, '42501', null, 'un id de Telegram que no es de un socio no responde');

-- ---------------------------------------------------------------- lo que falta se pregunta, y nada se escribe mientras falte
select is(pg_temp.r('cb:q1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_total')) ->> 'falta', 'cuenta', 'pago sin cuenta: pregunta a que cuenta');
select is(pg_temp.r('cb:q2', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_parcial', 'cuenta', 'Javier')) ->> 'falta', 'monto', 'pago parcial sin monto: pregunta cuanto');
select is(pg_temp.r('cb:q3', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_total', 'cuenta', 'Banamex')) ->> 'falta', 'cuenta', 'cuenta fuera de la lista: vuelve a preguntar');
select is(pg_temp.r('cb:q4', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'prometio')) ->> 'falta', 'fecha', 'promesa sin fecha: pregunta para cuando');
select is(pg_temp.r('cb:q5', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'prometio', 'fecha', '2026-11-10')) ->> 'falta', 'fecha', 'promesa en el pasado: vuelve a preguntar');
select is(pg_temp.r('cb:q6', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'disputa')) ->> 'falta', 'motivo', 'disputa sin motivo: lo pide');
select is(pg_temp.r('cb:q7', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'se_atrasa')) ->> 'falta', 'dias', 'se atrasa sin cuanto: pregunta');
select is(pg_temp.r('cb:q8', jsonb_build_object('hoy', '2026-11-20', 'cliente_id', pg_temp.cli('CB Cliente A'), 'accion', 'se_atrasa', 'dias', 1)) ->> 'falta', 'fecha', 'se atrasa y el resultado sigue en el pasado: pide la fecha exacta');
select is(pg_temp.r('cb:q9', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pausa')) ->> 'falta', 'dias', 'pausa sin dias: pregunta');
select throws_ok($$select pg_temp.r('cb:q10', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pausa', 'dias', 61))$$, 'P0460', null, 'pausa mayor al maximo de 60 dias se rechaza con motivo claro');
select is((select count(*)::int from cobranza.respuesta), 0, 'mientras faltaba un dato no se registro NADA');
select is((select count(*)::int from seguridad.operacion where clave like 'cb:q%'), 0, 'ni se reservo la clave de idempotencia (la respuesta con el dato completo usa otra clave)');

-- ---------------------------------------------------------------- pago parcial a un cliente con dos pedidos: el reparto lo calcula SQL
create temp table cb_p1 as select pg_temp.r('cb:pp1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_parcial', 'cuenta', 'Javier', 'monto_cent', 300000, 'fecha_pago', '2026-11-17')) as r;
select is((select r ->> 'estado' from cb_p1), 'ok', 'pago parcial de B registrado');
select is(pg_temp.saldo('cb:b1') + pg_temp.saldo('cb:b2'), (select b1 + b2 - 300000 from cb_i), 'el saldo total de B bajo exactamente lo pagado');
select is(pg_temp.saldo('cb:b1'), (select b1 - 300000 from cb_i), 'el reparto va primero al pedido que vence antes (mismo vencimiento: el mas antiguo)');
select matches((select r ->> 'aviso_grupo' from cb_p1), 'Registrado COB-[0-9]+: pago de \$3,000 de CB Cliente B en la cuenta de Javier \([A-Z]+-[0-9]+\)\. Se aplicó a [A-Z]+-[0-9]+ \$3,000\. Queda pendiente', 'el aviso al grupo trae pago, cuenta, reparto y como queda');
select is((select r ->> 'siguiente' from cb_p1), 'fecha_resto', 'tras un pago parcial pregunta para cuando el resto');
select matches((select r ->> 'aviso_grupo' from cb_p1), '¿Y el resto, para cuándo\?', 'el aviso pregunta por el resto');
select is((select pago_folio is not null from cobranza.respuesta where folio = (select r ->> 'folio' from cb_p1)), true, 'la respuesta guarda el folio del pago para deshacerlo');
select is((select count(*)::int from agente.hecho where tipo = 'pago_cliente' and clave_idem = 'cb:pp1:pago'), 1, 'el pago quedo en el libro de hechos del agente (deshacer comun)');

-- ---------------------------------------------------------------- antiduplicado por contenido
select is(pg_temp.r('cb:pp2', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_parcial', 'cuenta', 'Javier', 'monto_cent', 300000)) ->> 'estado', 'duplicado', 'el mismo pago (cliente, monto) en 10 minutos no se registra dos veces');
select is(pg_temp.saldo('cb:b1') + pg_temp.saldo('cb:b2'), (select b1 + b2 - 300000 from cb_i), 'el duplicado no movio dinero');
select is(pg_temp.r('cb:pp3', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_parcial', 'cuenta', 'Javier', 'monto_cent', 300000, 'confirmo_duplicado', true)) ->> 'estado', 'ok', 'si el socio confirma que es otro pago, se registra');
select is(pg_temp.saldo('cb:b1') + pg_temp.saldo('cb:b2'), (select b1 + b2 - 600000 from cb_i), 'el segundo pago confirmado si bajo el saldo');
-- Idempotencia: la misma clave dos veces es una sola respuesta.
select is(pg_temp.r('cb:pp1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pago_parcial', 'cuenta', 'Javier', 'monto_cent', 300000, 'fecha_pago', '2026-11-17')) ->> 'repetido', 'true', 'la misma clave repetida devuelve lo guardado');
select is((select count(*)::int from cobranza.respuesta where clave_idem = 'cb:pp1'), 1, 'una sola respuesta por clave');

-- ---------------------------------------------------------------- pago total a la cuenta de un proveedor (el cliente le pago directo a Isaac)
create temp table cb_p2 as select pg_temp.r('cb:pt1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente A'), 'accion', 'pago_total', 'cuenta', 'Isaac')) as r;
select is((select r ->> 'estado' from cb_p2), 'ok', 'pago total de A, directo a la cuenta de Isaac');
select is(pg_temp.saldo('cb:a1'), 0::bigint, 'A quedo saldado');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-17'), 'pagado', 'el estado se deriva del saldo: pagado');
select matches((select r ->> 'aviso_grupo' from cb_p2), 'Queda saldado\.', 'el aviso dice que quedo saldado');
select doesnt_match(cobranza.armar_digest('2026-11-17', 'am') ->> 'texto', 'CB Cliente A', 'un cliente pagado sale de TODO seguimiento sin accion alguna');

-- ---------------------------------------------------------------- promesa y "se atrasa": la fecha la resuelve el codigo, el plazo contractual NO cambia
create temp table cb_v as select cobranza.vence_efectivo(pg_temp.id('cb:c1')) as vence, (select plazo_dias from operacion.pedido where id = pg_temp.id('cb:c1')) as plazo,
  (operacion.recargo_sugerido(pg_temp.id('cb:c1'), '2026-12-05') ->> 'pendiente_cent')::bigint as recargo;
create temp table cb_pr as select pg_temp.r('cb:pr1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'prometio', 'fecha', '2026-11-26')) as r;
select is((select r ->> 'estado' from cb_pr), 'ok', 'promesa de C para el 26');
select is((pg_temp.sg('cb:c1')).promesa_fecha, '2026-11-26'::date, 'la promesa queda en el seguimiento');
select is(cobranza.vence_efectivo(pg_temp.id('cb:c1')), (select vence from cb_v), 'el vencimiento contractual NO cambio');
select is((select plazo_dias from operacion.pedido where id = pg_temp.id('cb:c1')), (select plazo from cb_v), 'pedido.plazo_dias NO cambio');
select is((operacion.recargo_sugerido(pg_temp.id('cb:c1'), '2026-12-05') ->> 'pendiente_cent')::bigint, (select recargo from cb_v), 'el recargo NO cambio con una promesa (solo cambia el recordatorio)');
select is(cobranza.estado_pedido(pg_temp.id('cb:c1'), '2026-11-18'), 'prometido', 'estado prometido mientras la promesa vive');
select is((select r ->> 'siguiente' from cb_pr), 'extender', 'una promesa mas alla del plazo pregunta: solo recordatorio o extender');
select matches((select r ->> 'aviso_grupo' from cb_pr), 'el recargo sigue corriendo desde el viernes 20-nov', 'la pregunta dice desde cuando corre el recargo');
select matches(cobranza.armar_digest('2026-11-18', 'am') ->> 'texto', 'Prometido: CB Cliente C pagará el jueves 26-nov', 'el digest lista lo prometido en una linea');
select doesnt_match(cobranza.armar_digest('2026-11-18', 'am') ->> 'texto', 'CB Cliente C (vence|venció)', 'prometido no se pregunta cada dia');
select matches(cobranza.armar_digest('2026-11-26', 'am') ->> 'texto', 'CB Cliente C prometió pagar HOY', 'el dia de la promesa pregunta si llego');
-- se atrasa una semana: base = vencimiento (no hay promesa en D) + 7
create temp table cb_sa as select pg_temp.r('cb:sa1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'se_atrasa', 'dias', 7)) as r;
select is((pg_temp.sg('cb:d1')).promesa_fecha, '2026-11-27'::date, 'se atrasa 7 dias: vencimiento 20 + 7 = 27 (suma hecha por SQL)');
select matches((select r ->> 'aviso_grupo' from cb_sa), 'paga el viernes 27-nov', 'el aviso dice la fecha resultante');
-- otro atraso encadenado parte de la promesa vigente
select is((select r ->> 'estado' from (select pg_temp.r('cb:sa2', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'se_atrasa', 'dias', 3)) as r) z), 'ok', 'otro atraso de 3 dias');
select is((pg_temp.sg('cb:d1')).promesa_fecha, '2026-11-30'::date, 'se atrasa encadenado: base = la promesa vigente (27) + 3 = 30');

-- ---------------------------------------------------------------- extension de plazo: decision explicita SOLO del duenio; mueve el vencimiento efectivo y el recargo, no el plazo contractual
select is(pg_temp.ra('cb:ex0', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'extender_plazo', 'fecha', '2026-11-30')) ->> 'estado', 'solo_duenio', 'el otro socio no extiende el plazo de un cliente ajeno');
create temp table cb_ex as select pg_temp.r('cb:ex1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'extender_plazo', 'fecha', '2026-11-30', 'motivo', 'pidio mas tiempo')) as r;
select is((select r ->> 'estado' from cb_ex), 'ok', 'el duenio extiende el plazo de D hasta el 30');
select is(cobranza.vence_efectivo(pg_temp.id('cb:d1')), '2026-11-30'::date, 'el vencimiento efectivo se movio al 30');
select is((select plazo_dias from operacion.pedido where id = pg_temp.id('cb:d1')), 10, 'pedido.plazo_dias sigue siendo el contractual (10)');
select is((operacion.recargo_sugerido(pg_temp.id('cb:d1'), '2026-12-06') ->> 'semanas_completas')::int, 0, 'recargo: con la extension, el 6-dic aun no cumple una semana desde el 30');
select is((operacion.recargo_sugerido(pg_temp.id('cb:d1'), '2026-12-07') ->> 'semanas_completas')::int, 1, 'recargo: el 7-dic cumple una semana contada desde el vencimiento extendido');
select is((operacion.recargo_sugerido(pg_temp.id('cb:d1'), '2026-12-07') ->> 'vence')::date, '2026-11-30'::date, 'el recargo reporta el vencimiento extendido');

-- ---------------------------------------------------------------- disputa, pausa y reanudar
select is(pg_temp.r('cb:di1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'disputa', 'motivo', 'faltaron 5 piezas')) ->> 'estado', 'ok', 'disputa de B con motivo');
select is(cobranza.estado_pedido(pg_temp.id('cb:b1'), '2026-11-18'), 'disputado', 'estado disputado');
select doesnt_match(cobranza.armar_digest('2026-11-18', 'am') ->> 'texto', 'CB Cliente B (vence|venció|lleva)', 'en disputa no se pregunta a diario');
select matches(cobranza.armar_digest('2026-11-23', 'am') ->> 'texto', 'En disputa: CB Cliente B', 'el lunes reaparece en una linea');
select is(pg_temp.r('cb:re1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'reanudar')) ->> 'estado', 'ok', 'reanudar limpia la disputa');
select is(cobranza.estado_pedido(pg_temp.id('cb:b1'), '2026-11-18'), 'vencido', 'B vuelve a vencido');
select is(pg_temp.r('cb:pa1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente B'), 'accion', 'pausa', 'dias', 3)) ->> 'estado', 'ok', 'pausa de 3 dias');
select is(cobranza.estado_pedido(pg_temp.id('cb:b1'), '2026-11-20'), 'pausado', 'pausado durante la pausa');
select is(cobranza.estado_pedido(pg_temp.id('cb:b1'), '2026-11-21'), 'vencido', 'la pausa termina y vuelve');
select matches(cobranza.armar_digest('2026-11-21', 'am') ->> 'texto', 'Terminó la pausa', 'el dia que termina la pausa lo dice');
select is((operacion.recargo_sugerido(pg_temp.id('cb:b1'), '2026-11-30') ->> 'semanas_completas')::int, 1, 'la pausa solo calla al bot: el recargo sigue corriendo');

-- ---------------------------------------------------------------- dos socios contradiciendose: decide el duenio; los hechos se aceptan siempre
select is(pg_temp.r('cb:cf1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'prometio', 'fecha', '2026-12-01')) ->> 'estado', 'ok', 'el duenio anota su promesa');
create temp table cb_cf as select pg_temp.ra('cb:cf2', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'prometio', 'fecha', '2026-12-10')) as r;
select is((select r ->> 'estado' from cb_cf), 'conflicto', 'el otro socio contradice la decision del duenio: no se aplica');
select matches((select r ->> 'texto' from cb_cf), 'Javier ya anotó una promesa de pago para CB Cliente D; no lo cambio\. Javier, ¿lo cambio\?', 'el bot pregunta al duenio');
select is((pg_temp.sg('cb:d1')).promesa_fecha, '2026-12-01'::date, 'la promesa del duenio queda como estaba');
select is(pg_temp.ra('cb:cf3', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente D'), 'accion', 'pago_parcial', 'cuenta', 'Angelo', 'monto_cent', 100000)) ->> 'estado', 'ok', 'el otro socio SI puede registrar un pago (hecho)');
select is(pg_temp.ra('cb:cf4', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'aun_no')) ->> 'estado', 'ok', 'sin decision previa del duenio, la primera respuesta del otro socio se acepta');

-- ---------------------------------------------------------------- deshacer 10 minutos (contra-registro; nada se borra)
create temp table cb_u as select pg_temp.r('cb:u1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'pausa', 'dias', 5)) as r;
select is(cobranza.estado_pedido(pg_temp.id('cb:c1'), '2026-11-17'), 'pausado', 'C pausado');
select is(agente.cobranza_deshacer('cb:u1d', (select r ->> 'folio' from cb_u), 'javier', 5170001) ->> 'estado', 'ok', 'deshacer la pausa dentro de 10 minutos');
select is((pg_temp.sg('cb:c1')).pausa_hasta, null, 'la pausa se quito');
select is((select count(*)::int from cobranza.respuesta where accion = 'deshacer'), 1, 'el deshacer es un contra-registro nuevo');
select throws_ok($$select agente.cobranza_deshacer('cb:u1e', (select r ->> 'folio' from cb_u), 'javier', 5170001)$$, 'P0460', null, 'un folio ya deshecho no se deshace otra vez');
select throws_ok($$update cobranza.respuesta set accion = 'aun_no'$$, 'P0460', null, 'las respuestas son de solo anexar');
select throws_ok($$delete from cobranza.respuesta$$, 'P0460', null, 'ni se borran');
-- Fuera de la ventana de 10 minutos ya no desde Telegram.
create temp table cb_u2 as select pg_temp.r('cb:u2', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'pausa', 'dias', 4)) as r;
alter table cobranza.respuesta disable trigger respuesta_solo_anexar;
update cobranza.respuesta set creado_at = clock_timestamp() - interval '11 minutes' where folio = (select r ->> 'folio' from cb_u2);
alter table cobranza.respuesta enable trigger respuesta_solo_anexar;
select throws_ok($$select agente.cobranza_deshacer('cb:u2d', (select r ->> 'folio' from cb_u2), 'javier', 5170001)$$, 'P0464', null, 'pasados 10 minutos ya no se deshace desde Telegram');
-- Deshacer un pago pasa por la reversa de pagos existente.
create temp table cb_up as select pg_temp.r('cb:up1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'pago_parcial', 'cuenta', 'Efectivo', 'monto_cent', 50000)) as r;
create temp table cb_s as select pg_temp.saldo('cb:c1') as c1;
select is(agente.cobranza_deshacer('cb:up1d', (select r ->> 'folio' from cb_up), 'javier', 5170001) ->> 'estado', 'ok', 'deshacer un pago de cobranza');
select is(pg_temp.saldo('cb:c1'), (select c1 + 50000 from cb_s), 'el pago deshecho devolvio el saldo exacto');
-- Una extension ya seguida de recargo aplicado no se deshace sola.
create temp table cb_ue as select pg_temp.ra('cb:ue1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'extender_plazo', 'dias', 3)) as r;
select is(cobranza.vence_efectivo(pg_temp.id('cb:c1')), '2026-11-23'::date, 'extension de 3 dias: vence el 23');
select is(agente.cobranza_deshacer('cb:ue1d', (select r ->> 'folio' from cb_ue), 'javier', 5170001) ->> 'estado', 'ok', 'sin recargo aplicado la extension se deshace');
select is(cobranza.vence_efectivo(pg_temp.id('cb:c1')), '2026-11-20'::date, 'vuelve el vencimiento contractual');

-- ---------------------------------------------------------------- aun_no cuenta como respuesta y reinicia los ignorados
update cobranza.seguimiento set ignorados_consecutivos = 4 where pedido_id = pg_temp.id('cb:c1');
select is(pg_temp.r('cb:an1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'aun_no')) ->> 'estado', 'ok', 'aun no es una respuesta');
select is((pg_temp.sg('cb:c1')).ignorados_consecutivos, 0, 'contestar (aunque sea "aun no") baja el nivel: ignorados a cero');
select is(pg_temp.r('cb:sn1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente A'), 'accion', 'aun_no')) ->> 'estado', 'sin_saldo', 'responder por un cliente sin saldo no inventa nada');
select throws_ok($$select pg_temp.r('cb:fo1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente C'), 'accion', 'aun_no', 'pedidos', jsonb_build_array(pg_temp.f('cb:b1'))))$$, 'P0460', null, 'un folio de otro cliente se rechaza');

-- ---------------------------------------------------------------- metricas (SQL) y perfil determinista
select is(cobranza.metricas('2026-11-01', '2026-11-30') ->> 'max_digests_en_un_dia', '0', 'metricas: sin digests enviados en esta prueba');
select isnt(cobranza.metricas('2026-11-01', '2026-11-30') ->> 'concentracion_mayor_cliente_pct', null, 'metricas: concentracion calculada por SQL');
select is(cobranza.perfil_cliente(pg_temp.cli('CB Cliente C')) ->> 'texto', 'sin historial suficiente', 'perfil: con menos de 3 pedidos cerrados dice sin historial suficiente');
select is((cobranza.perfil_cliente(pg_temp.cli('CB Cliente C')) ->> 'suficiente')::boolean, false, 'perfil: suficiente = false');
-- Cliente con 3 pedidos cerrados
select catalogo.asegurar_cliente('CB Cliente E', 'Javier');
select catalogo.fijar_precio('cb:p5', 'CB Cliente E', 'CB Modelo', 25000, negocio.hoy() - 40, 'chat');
select pg_temp.pedido2('cb:e1', 'CB Cliente E', 1, 2, '2026-11-11');
select pg_temp.pedido2('cb:e2', 'CB Cliente E', 1, 3, '2026-11-12');
select pg_temp.pedido2('cb:e3', 'CB Cliente E', 1, 4, '2026-11-13');
select pg_temp.r('cb:em1', jsonb_build_object('cliente_id', pg_temp.cli('CB Cliente E'), 'accion', 'pago_total', 'cuenta', 'Efectivo', 'fecha_pago', '2026-11-14'));
select is((cobranza.perfil_cliente(pg_temp.cli('CB Cliente E')) ->> 'suficiente')::boolean, true, 'perfil: con 3 pedidos cerrados ya hay perfil');
select matches(cobranza.perfil_cliente(pg_temp.cli('CB Cliente E')) ->> 'texto', 'Paga en promedio [0-9.]+ días (después|antes) del vencimiento \(3 pedidos cerrados\)', 'perfil: texto con el atraso medio calculado por SQL');
select is((cobranza.metricas('2026-11-01', '2026-11-30') ->> 'dias_cobro_promedio') is not null, true, 'metricas: dias de cobro promedio ponderado');
select is((select count(*) from notificacion.entrega where id > (select ultimo from cb_n) and destino_clave <> 'grupo_socios'), 0::bigint, 'todo lo que salio en esta prueba va al grupo de los socios (avisos de pedidos y pagos ya existentes): ninguna entrega a clientes, proveedores ni Omar');
select * from finish();
rollback;
