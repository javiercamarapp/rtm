-- pgTAP cb_001: carril COBRANZA. Estado derivado, vencimiento efectivo, digest diario y simulacion del calendario del 14 al 21-nov con datos FICTICIOS equivalentes
-- (vencimientos 16, 17 y 20 de noviembre), reloj apagado por interruptor, idempotencia del envio, ignorados, escalamiento y permisos. Nada se envia: el reloj solo reclama y registra.
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

-- ---------------------------------------------------------------- permisos e interruptor: todo nace apagado
select is((select activo from seguridad.interruptor where clave = 'cobranza_activa'), false, 'interruptor cobranza_activa nace APAGADO');
select is(has_function_privilege('anon', 'cobranza.armar_digest(date,text)', 'execute'), false, 'anon no arma el digest');
select is(has_function_privilege('authenticated', 'cobranza.armar_digest(date,text)', 'execute'), false, 'authenticated no arma el digest');
select is(has_function_privilege('authenticated', 'cobranza.reloj_tick(text,jsonb)', 'execute'), false, 'authenticated no mueve el reloj');
select is(has_function_privilege('servidor', 'cobranza.reloj_tick(text,jsonb)', 'execute'), true, 'servidor mueve el reloj');
select is(has_function_privilege('authenticated', 'agente.cobranza_responder(text,jsonb)', 'execute'), false, 'authenticated no responde cobranza');
select is(has_function_privilege('servidor', 'agente.cobranza_responder(text,jsonb)', 'execute'), true, 'servidor responde cobranza');
select is(has_function_privilege('servidor', 'agente.cobranza_deshacer(text,text,text,bigint)', 'execute'), true, 'servidor deshace cobranza');
select is(has_function_privilege('authenticated', 'cobranza.responder(text,jsonb,text)', 'execute'), false, 'la puerta interna no se concede a nadie fuera del propietario');
select is(has_table_privilege('authenticated', 'cobranza.respuesta', 'select'), false, 'authenticated no lee las respuestas');
select is(has_table_privilege('servidor', 'cobranza.seguimiento', 'select'), false, 'ni el servidor toca las tablas: solo por funciones');
select is(has_function_privilege('authenticated', 'operacion.recargo_sugerido(bigint,date)', 'execute'), true, 'el recargo envuelto conserva su permiso');

-- ---------------------------------------------------------------- vencimiento efectivo y estado derivado
select is(cobranza.vence_efectivo(pg_temp.id('cb:a1')), '2026-11-16'::date, 'A vence el 16');
select is(cobranza.vence_efectivo(pg_temp.id('cb:b1')), '2026-11-17'::date, 'B vence el 17');
select is(cobranza.vence_efectivo(pg_temp.id('cb:c1')), '2026-11-20'::date, 'C vence el 20');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-13'), 'al_corriente', 'A el 13: al corriente');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-15'), 'por_vencer', 'A el 15: por vencer (manana)');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-16'), 'vence_hoy', 'A el 16: vence hoy');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-17'), 'vencido', 'A el 17: vencido');
select is(cobranza.estado_pedido(pg_temp.id('cb:b1'), '2026-11-16'), 'por_vencer', 'B el 16: por vencer');
select is(operacion.pedido_saldo(pg_temp.id('cb:a1')) > 0, true, 'fixture: A tiene saldo');
-- Vence en dia inhabil: el aviso previo sale el ultimo dia habil anterior (viernes 13 para el lunes 16, festivo de la Revolucion).
insert into cobranza.dia_inhabil values ('2026-11-16', 'Revolucion');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-12'), 'al_corriente', 'festivo: el jueves 12 todavia no avisa');
select is(cobranza.estado_pedido(pg_temp.id('cb:a1'), '2026-11-13'), 'por_vencer', 'festivo: el viernes 13 (ultimo dia habil) avisa del lunes 16');
delete from cobranza.dia_inhabil where fecha = '2026-11-16';
select is(cobranza.es_inhabil('2026-11-14'), true, 'sabado es inhabil');
select is(cobranza.es_inhabil('2026-11-17'), false, 'martes es habil');

-- ---------------------------------------------------------------- recargo envuelto: una extension explicita mueve el inicio, el plazo contractual NO se toca
select is((operacion.recargo_sugerido(pg_temp.id('cb:a1'), '2026-11-23') ->> 'semanas_completas')::int, 1, 'recargo: 7 dias de atraso = 1 semana completa');
select is((operacion.recargo_sugerido(pg_temp.id('cb:a1'), '2026-11-22') ->> 'semanas_completas')::int, 0, 'recargo: 6 dias de atraso = 0 semanas');
select is((operacion.recargo_sugerido(pg_temp.id('cb:a1'), '2026-11-23') ->> 'pendiente_cent')::bigint, (operacion.recargo_sugerido(pg_temp.id('cb:a1'), '2026-11-23') ->> 'base_cent')::bigint / 10, 'recargo: 10 % simple de la base por una semana');

-- ---------------------------------------------------------------- simulacion del calendario 14 al 21-nov (digest de las 09:00, sin IA)
select is((cobranza.armar_digest('2026-11-14', 'am') ->> 'vacio')::boolean, true, 'sab 14: sin nada que decir no hay mensaje (cero mensajes vacios)');
select is(cobranza.armar_digest('2026-11-14', 'am') ->> 'texto', null, 'sab 14: texto nulo');
select matches(pg_temp.dig('2026-11-15'), 'Próximos: CB Cliente A vence mañana', 'dom 15: manana vence A (aviso un dia antes)');
select doesnt_match(pg_temp.dig('2026-11-15'), '¿Ya pagó\?', 'dom 15: el aviso previo no pregunta');
select matches(pg_temp.dig('2026-11-16'), 'CB Cliente A vence HOY', 'lun 16: tarjeta de A que vence hoy');
select matches(pg_temp.dig('2026-11-16'), '¿Ya pagó\?', 'lun 16: la tarjeta pregunta');
select matches(pg_temp.dig('2026-11-16'), 'Próximos: CB Cliente B vence mañana', 'lun 16: proximos, manana vence B');
select matches(pg_temp.dig('2026-11-17'), 'CB Cliente B vence HOY\. [A-Z]+-[0-9]+ \$[0-9,]+ \+ [A-Z]+-[0-9]+ \$[0-9,]+ = \$[0-9,]+', 'mar 17: B, dos pedidos en UNA tarjeta con total');
select matches(pg_temp.dig('2026-11-17'), 'CB Cliente A venció hace 1 día', 'mar 17: A vencio hace 1 dia (sigue preguntando)');
select matches(pg_temp.dig('2026-11-18'), 'CB Cliente A venció hace 2 días', 'mie 18: A +2');
select matches(pg_temp.dig('2026-11-18'), 'CB Cliente B venció hace 1 día', 'mie 18: B +1');
select matches(pg_temp.dig('2026-11-19'), 'CB Cliente A venció hace 3 días', 'jue 19: A +3 todavia tarjeta');
select matches(pg_temp.dig('2026-11-19'), 'Próximos: CB Cliente C vence mañana', 'jue 19: manana vencen C');
select matches(pg_temp.dig('2026-11-19'), 'Próximos: CB Cliente D vence mañana', 'jue 19: manana vencen D');
select matches(pg_temp.dig('2026-11-20'), 'CB Cliente C vence HOY', 'vie 20: C vence hoy');
select matches(pg_temp.dig('2026-11-20'), 'CB Cliente D vence HOY', 'vie 20: D vence hoy');
select matches(pg_temp.dig('2026-11-20'), 'CB Cliente A lleva 4 días vencido', 'vie 20: A pasa a linea compacta (+4)');
select doesnt_match(pg_temp.dig('2026-11-20'), 'CB Cliente A lleva 4 días vencido[^\n]*\n  ¿Ya pagó', 'vie 20: la linea compacta no pregunta');
select matches(pg_temp.dig('2026-11-20'), 'CB Cliente B venció hace 3 días', 'vie 20: B +3 todavia tarjeta');
select matches(pg_temp.dig('2026-11-21'), 'CB Cliente C venció hace 1 día', 'sab 21: C +1');
select matches(pg_temp.dig('2026-11-21'), 'CB Cliente B lleva 4 días vencido', 'sab 21: B compacta');
select matches(pg_temp.dig('2026-11-17'), 'Total por cobrar vencido o que vence hoy: \$[0-9,]+\.', 'el digest cierra con el total que pone SQL');
select is(cobranza.armar_digest('2026-11-17', 'am') -> 'total_cent', to_jsonb(operacion.pedido_saldo(pg_temp.id('cb:a1')) + operacion.pedido_saldo(pg_temp.id('cb:b1')) + operacion.pedido_saldo(pg_temp.id('cb:b2'))), 'el total del 17 = A + B1 + B2 (saldos de SQL)');
select is((select count(*)::int from jsonb_array_elements(cobranza.armar_digest('2026-11-17', 'am') -> 'lineas')), 3, 'el 17 hay tres pedidos en el digest: A, B1 y B2');
select doesnt_match(pg_temp.dig('2026-11-20'), '(Angelo|Javier)', 'el digest no se divide por socio (regla del proyecto: un solo negocio)');
-- Lunes: resumen semanal de lo ignorado y recargo sugerido en las lineas compactas.
select matches(pg_temp.dig('2026-11-23'), 'Resumen semanal de cobranza sin respuesta: ', 'lun 23: resumen semanal');
select matches(pg_temp.dig('2026-11-23'), 'Recargo sugerido a hoy: \$[0-9,]+ \(1 semana\), no aplicado; lo decide Javier\.', 'lun 23: recargo sugerido, no aplicado, lo decide el duenio');
select doesnt_match(pg_temp.dig('2026-11-24'), 'Resumen semanal', 'el resumen semanal solo sale el lunes');
-- Un domingo con contenido sale igual; sin contenido, nada.
select is(cobranza.armar_digest('2026-11-15', 'am') ->> 'vacio', 'false', 'el domingo con contenido el digest sale');

-- ---------------------------------------------------------------- niveles por dias e ignorados (la frecuencia no cambia, cambia el formato)
select matches(pg_temp.dig('2026-12-02'), 'SIN RESPUESTA\nCB Cliente A lleva 16 días vencido', 'V+15 en adelante: va al inicio como SIN RESPUESTA');
select matches(pg_temp.dig('2026-12-16'), 'Decisión pendiente: llamar, extender plazo, marcar disputa o castigar', 'V+30: decision pendiente');
select matches(pg_temp.dig('2026-11-21'), 'CB Cliente A lleva 5 días vencido', 'el cliente sigue apareciendo TODOS los dias aunque nadie conteste');
update cobranza.seguimiento set ignorados_consecutivos = 3 where pedido_id = pg_temp.id('cb:b1');
insert into cobranza.seguimiento (pedido_id, ignorados_consecutivos) values (pg_temp.id('cb:b2'), 3) on conflict (pedido_id) do update set ignorados_consecutivos = 3;
insert into cobranza.seguimiento (pedido_id, ignorados_consecutivos) values (pg_temp.id('cb:b1'), 3) on conflict (pedido_id) do update set ignorados_consecutivos = 3;
select matches(pg_temp.dig('2026-11-18'), 'CB Cliente B lleva 1 día vencido', '3 tarjetas ignoradas suben a nivel 2 aunque sea V+1');
update cobranza.seguimiento set ignorados_consecutivos = 0 where pedido_id in (pg_temp.id('cb:b1'), pg_temp.id('cb:b2'));

-- ---------------------------------------------------------------- reloj: apagado, temprano, idempotente, reintento seguro y nada sale
create temp table cb_antes as select (select count(*) from notificacion.entrega) as entregas, (select count(*) from notificacion.destino) as destinos;
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"09:00"}') ->> 'estado', 'apagado', 'reloj apagado: no reclama nada');
select is((select count(*)::int from cobranza.digest), 0, 'apagado: no queda ningun digest');
update seguridad.interruptor set activo = true where clave = 'cobranza_activa';
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"09:00"}') ->> 'estado', 'sin_envio', 'con telegram_envio apagado el reloj no corre');
update seguridad.interruptor set activo = true where clave = 'telegram_envio';
update seguridad.interruptor set activo = true where clave = 'cron_pausado';
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"09:00"}') ->> 'estado', 'cron_pausado', 'con cron_pausado el reloj no corre');
update seguridad.interruptor set activo = false where clave = 'cron_pausado';
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"08:59"}') ->> 'estado', 'temprano', 'antes de las 09:00 de Merida no sale');
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-14","hora":"09:00"}') ->> 'estado', 'sin_contenido', 'sabado sin nada: sin_contenido');
create temp table cb_t1 as select cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"09:00"}') as r;
select is((select r ->> 'estado' from cb_t1), 'reclamado', 'lun 16 09:00: reclama el digest');
select matches((select r ->> 'texto' from cb_t1), 'CB Cliente A vence HOY', 'el texto reclamado es el digest de SQL');
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"09:05"}') ->> 'estado', 'reclamado_sin_confirmar', 'segundo tick sin confirmacion: NO reenvia (podria haber salido)');
select is((select count(*)::int from cobranza.digest where fecha_negocio = '2026-11-16' and tipo = 'am'), 1, 'un solo digest por dia y tipo');
select is((select count(*)::int from cobranza.digest_linea where digest_id = (select (r ->> 'digest_id')::bigint from cb_t1)), 3, 'el digest guarda una linea por pedido (A que vence hoy, B1 y B2 proximos)');
select is(cobranza.registrar_envio((select (r ->> 'digest_id')::bigint from cb_t1), true, 777)::jsonb ->> 'estado', 'enviado', 'registrar_envio confirma');
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-16","hora":"09:10"}') ->> 'estado', 'ya_enviado', 'ya enviado: el tick no hace nada');
select is((select recordatorios_enviados from cobranza.seguimiento where pedido_id = pg_temp.id('cb:a1')), 1, 'el envio cuenta un recordatorio por pedido');
-- Cierre de las 17:00: solo si vencia algo hoy sin respuesta.
select is(cobranza.reloj_tick('cierre', '{"hoy":"2026-11-16","hora":"16:59"}') ->> 'estado', 'temprano', 'cierre antes de las 17:00: temprano');
create temp table cb_t2 as select cobranza.reloj_tick('cierre', '{"hoy":"2026-11-16","hora":"17:00"}') as r;
select is((select r ->> 'estado' from cb_t2), 'reclamado', 'cierre 17:00: vencia A hoy y nadie contesto');
select matches((select r ->> 'texto' from cb_t2), 'Cierre del día de cobranza, lunes 16-nov', 'texto del cierre');
select doesnt_match((select r ->> 'texto' from cb_t2), 'Próximos', 'el cierre no repite los proximos');
select cobranza.registrar_envio((select (r ->> 'digest_id')::bigint from cb_t2), true, 778);
-- Reintento seguro: un envio FALLIDO si se reintenta (una sola vez por intento registrado).
create temp table cb_t3 as select cobranza.reloj_tick('am', '{"hoy":"2026-11-17","hora":"09:00"}') as r;
select cobranza.registrar_envio((select (r ->> 'digest_id')::bigint from cb_t3), false, null, 'telegram 502');
select is((select estado from cobranza.digest where id = (select (r ->> 'digest_id')::bigint from cb_t3)), 'fallido', 'el envio fallido queda registrado');
select is(cobranza.reloj_tick('am', '{"hoy":"2026-11-17","hora":"09:15"}') ->> 'estado', 'reclamado', 'tras un fallo registrado el reintento reclama de nuevo');
select is((select intentos from cobranza.digest where fecha_negocio = '2026-11-17' and tipo = 'am'), 2, 'el digest cuenta el intento');
select is(cobranza.registrar_envio((select (r ->> 'digest_id')::bigint from cb_t3), true, 779) ->> 'estado', 'enviado', 'el reintento se confirma');
select is(cobranza.registrar_envio((select (r ->> 'digest_id')::bigint from cb_t3), true, 779) ->> 'repetido', 'true', 'confirmar dos veces es idempotente');

-- ---------------------------------------------------------------- ignorados: una tarjeta sin respuesta suma un ignorado; contar dos veces no duplica
select is((select r -> 'contadores' ->> 'ignorados_sumados' from cb_t3), '1', 'el reloj del 17 conto antes de armar: la tarjeta del 16 (A) sin respuesta suma un ignorado');
select is((select ignorados_consecutivos from cobranza.seguimiento where pedido_id = pg_temp.id('cb:a1')), 1, 'A lleva un ignorado');
select is(cobranza.contar_ignorados('2026-11-17') ->> 'ignorados_sumados', '0', 'contar dos veces el mismo dia no duplica');
-- Una promesa vencida con saldo suma un incumplimiento, una sola vez.
update cobranza.seguimiento set promesa_fecha = '2026-11-18', promesa_contada = false where pedido_id = pg_temp.id('cb:a1');
select is(cobranza.contar_ignorados('2026-11-19') ->> 'promesas_incumplidas_sumadas', '1', 'promesa vencida suma un incumplimiento');
select is(cobranza.contar_ignorados('2026-11-19') ->> 'promesas_incumplidas_sumadas', '0', 'el incumplimiento se cuenta una sola vez');
select matches(pg_temp.dig('2026-11-19'), 'venció hace 3 días \(promesa incumplida\)', 'la tarjeta marca la promesa incumplida');
update cobranza.seguimiento set promesa_fecha = null where pedido_id = pg_temp.id('cb:a1');

-- ---------------------------------------------------------------- cero cobranza para lo pagado y para lo ajeno al credito
select is(cobranza.estado_pedido((select id from operacion.pedido where cliente_id = pg_temp.cli('CB Omar Cliente') limit 1), '2026-11-17'), null, 'pedido inexistente: null');
select is((select count(*) from notificacion.entrega) - (select entregas from cb_antes), 0::bigint, 'el reloj y el digest NO crearon ninguna entrega de notificacion (nada sale a Telegram)');
select is((select count(*) from notificacion.destino) - (select destinos from cb_antes), 0::bigint, 'ni destinos: cobranza solo habla al grupo desde TypeScript y apagado');
select is((select count(*)::int from cobranza.respuesta), 0, 'el digest solo lee: no escribio respuestas');
select * from finish();
rollback;
