-- pgTAP a7_002: INTENCIONES DE MENUDEO del agente de Telegram (pedido_menudeo, pago_pedido_menudeo, decision del otro socio, recordatorios, esperas y comprobantes).
-- Solo el socio de menudeo (Angelo por omision) mete pedidos a costo, avisa pagos y reprograma; el otro socio confirma o rechaza. La fecha la fija el codigo, nunca la IA.
-- El comprobante se guarda solo como huella (el bot no lo lee). Ninguna funcion nueva se concede a authenticated. Datos sinteticos; sin envios reales.
begin;
-- Carril frenos: el interruptor agente_escritura nace apagado; esta prueba ejerce las puertas de escritura.
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5800001, 'angelo');
select agente.registrar_miembro(5800002, 'javier');
select agente.registrar_miembro(5800003, 'omar');
select set_config('rtm.canal', '', true);
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('mt.ang@example.test', 'socio', 'Angelo', true), ('mt.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-3333333300a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mt.ang@example.test'),
  ('88888888-8888-8888-8888-3333333300a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mt.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-3333333300a1' when 'Javier' then '88888888-8888-8888-8888-3333333300a2' else '' end, true) $$;
select pg_temp.como('Angelo');
-- Apertura firmada por los dos (capital y cajas) para que la sociedad pueda pagar.
create temp table _s as select (api.apertura_crear('mtA:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('mtA:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('mtA:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('mtA:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('mtA:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('mtA:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('mtA:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('mtA:f2', (select id from _s));
select pg_temp.como('');
select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_modelo('MT Marca', 'MT Modelo 25K', 25000, 'ambas'); select catalogo.asegurar_sku('MT Modelo 25K', 'Fresa'); select catalogo.asegurar_sku('MT Modelo 25K', 'Mango');
select catalogo.fijar_costo('mt-c1', 'Karen', 'MT Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select set_config('rtm.canal', '', true);
create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;
create function pg_temp.args(p_autor text, p_tid bigint, p_extra jsonb) returns jsonb language sql as
  $$ select jsonb_build_object('autor', p_autor, 'telegram_user_id', p_tid, 'origen', 'mensaje sintetico') || p_extra $$;
create function pg_temp.pedido_args(p_fc date, p_hc time) returns jsonb language sql as $$
  select pg_temp.args('angelo', 5800001, jsonb_build_object('lineas', jsonb_build_array(
    jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_norm = 'mt modelo 25k'), 'sabor_id', (select id from catalogo.sabor where nombre_norm = 'fresa'), 'piezas', 10),
    jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_norm = 'mt modelo 25k'), 'sabor_id', (select id from catalogo.sabor where nombre_norm = 'mango'), 'piezas', 20)),
    'origen_pedido', 'karen_directo', 'fecha_compromiso', p_fc, 'hora_compromiso', p_hc)) $$;

select is(agente.socio_menudeo(), 'angelo', 'el socio de menudeo es Angelo por omision (lectura para el agente)');
select is(has_function_privilege('authenticated', 'agente.socio_menudeo()', 'execute'), false, '... y authenticated no la ejecuta');

-- ------------------------------------------------------------------ pedido_menudeo: solo el socio de menudeo, autor verificado
select throws_ok($$ select agente.ejecutar_ext('mt:x1', 'pedido_menudeo', pg_temp.args('javier', 5800002, pg_temp.pedido_args(negocio.hoy() + 2, '10:00') - 'autor' - 'telegram_user_id')) $$, '42501', null, 'Javier no mete pedidos a costo (no es el socio de menudeo)');
select throws_ok($$ select agente.simular('ejecutar_ext', 'pedido_menudeo', pg_temp.args('javier', 5800002, pg_temp.pedido_args(negocio.hoy() + 2, '10:00') - 'autor' - 'telegram_user_id')) $$, '42501', null, 'ni en la vista previa');
select throws_ok($$ select agente.ejecutar_ext('mt:x2', 'pedido_menudeo', pg_temp.args('angelo', 5800002, pg_temp.pedido_args(negocio.hoy() + 2, '10:00') - 'autor' - 'telegram_user_id')) $$, '42501', null, 'el id de Javier no sirve para firmar como Angelo');
select throws_ok($$ select agente.ejecutar_ext('mt:x3', 'pedido_menudeo', pg_temp.args('angelo', 5800003, pg_temp.pedido_args(negocio.hoy() + 2, '10:00') - 'autor' - 'telegram_user_id')) $$, '42501', null, 'ni el de Omar');
select is((select count(*)::int from operacion.pedido), 0, 'ninguno de esos intentos dejo un pedido');

create temp table _prev as select agente.simular('ejecutar_ext', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() + 2, '10:00') - 'x') as j;
select is((select (j -> 'efecto' ->> 'costo_cent')::bigint from _prev), (30 * 8929)::bigint, 'la vista previa calcula el costo con el costo del proveedor (30 piezas por 89.29)');
select is((select j -> 'efecto' ->> 'fecha_compromiso' from _prev)::date, negocio.hoy() + 2, '... y muestra la fecha comprometida');
select is((select j -> 'efecto' ->> 'hora_compromiso' from _prev), '10:00:00', '... y su hora');
select is((select jsonb_array_length(j -> 'efecto' -> 'lineas') from _prev), 2, '... y el desglose por renglon');
select ok((select j ->> 'efecto_hash' from _prev) ~ '^[0-9a-f]{64}$', '... con el hash del efecto');
select is((select count(*)::int from operacion.pedido), 0, 'la vista previa no dejo pedido');
select is((select count(*)::int from catalogo.cliente where nombre_norm = 'menudeo angelo'), 0, '... ni el cliente interno de menudeo');

-- hash distinto => aborta
select throws_ok($$ select agente.ejecutar_ext('mt:h1', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() + 2, '10:00') || jsonb_build_object('efecto_hash', repeat('0', 64))) $$, 'P0462', null, 'si el efecto cambio desde la vista previa: P0462');
select is((select count(*)::int from operacion.pedido), 0, '... y no deja nada');

create temp table _p1 as select agente.ejecutar_ext('mt:p1', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() + 2, '10:00') || jsonb_build_object('efecto_hash', (select j ->> 'efecto_hash' from _prev))) as j;
select is((select j ->> 'folio' from _p1) ~ '^[A-Z]{2}-[0-9]{3}$', true, 'pedido creado con folio por iniciales');
select is((select tipo_venta from operacion.pedido_ds where pedido_id = (select (j ->> 'pedido_id')::bigint from _p1)), 'socio_a_costo', 'es un pedido a costo para un socio');
select is((select s.nombre from operacion.pedido_ds d join catalogo.socio s on s.id = d.socio_id where d.pedido_id = (select (j ->> 'pedido_id')::bigint from _p1)), 'Angelo', '... de Angelo');
select is((select estado from operacion.pedido where id = (select (j ->> 'pedido_id')::bigint from _p1)), 'confirmado', '... confirmado');
select is((select fecha_compromiso from operacion.ds_pedido_compromiso where pedido_id = (select (j ->> 'pedido_id')::bigint from _p1)), negocio.hoy() + 2, 'guarda fecha_compromiso_pago');
select is((select hora_compromiso::text from operacion.ds_pedido_compromiso where pedido_id = (select (j ->> 'pedido_id')::bigint from _p1)), '10:00:00', '... con su hora');
select is((select s.nombre from operacion.ds_pedido_compromiso c join catalogo.socio s on s.id = c.comprometido_por where c.pedido_id = (select (j ->> 'pedido_id')::bigint from _p1)), 'Angelo', '... y quien la comprometio');
select is((select count(*)::int from entrega.destinatario), 0, 'jamas hay destinatario ni telefonos: el esquema entrega queda vacio');
select is((select count(*)::int from operacion.pedido), 1, 'un solo pedido');
select is(agente.ejecutar_ext('mt:p1', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() + 2, '10:00')) ->> 'repetido', 'true', 'doble envio: la misma clave no duplica (repetido)');
select is((select count(*)::int from operacion.pedido), 1, '... un solo pedido tras el doble envio');
select is((select count(*)::int from agente.hecho where tipo = 'pedido'), 1, '... y un solo hecho para /deshacer');
select is((select (select count(*)::int from catalogo.cliente where nombre_norm = 'menudeo angelo')), 1, 'el cliente interno "Menudeo Angelo" existe una vez');
-- fecha pasada rechazada por la base (validacion adicional a la del codigo)
select throws_ok($$ select agente.ejecutar_ext('mt:p2', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() - 30, null)) $$, '23514', null, 'la base rechaza una fecha comprometida pasada');
-- sin fecha: ya no se acepta (decision del dueno 14-nov: ningun pedido nuevo sin plazo)
select throws_ok($$ select agente.ejecutar_ext('mt:p3x', 'pedido_menudeo', pg_temp.pedido_args(null, null)) $$, 'P0436', null, 'sin fecha de pago el pedido a costo no se crea');
create temp table _p2 as select agente.ejecutar_ext('mt:p3', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() + 1, null)) as j;
select is((select plazo_dias from operacion.pedido where id = (select (j ->> 'pedido_id')::bigint from _p2)), 1, 'el pedido a costo queda con plazo = dias hasta su fecha de pago');

-- enviar (lo hace /enviado, funcion existente) para poder pagar
select set_config('rtm.canal', 'importacion', true);
select operacion.enviar_pedido('mt-e1', (select (j ->> 'pedido_id')::bigint from _p1), null, null, null, true);
select operacion.enviar_pedido('mt-e2', (select (j ->> 'pedido_id')::bigint from _p2), null, null, null, true);
select set_config('rtm.canal', '', true);

-- ------------------------------------------------------------------ pago_pedido_menudeo
select throws_ok($$ select agente.ejecutar_ext('mt:q0', 'pago_pedido_menudeo', pg_temp.args('javier', 5800002, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 100))) $$, '42501', null, 'Javier no avisa pagos de los pedidos de Angelo');
select throws_ok($$ select agente.ejecutar_ext('mt:q1', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 99999999))) $$, '23514', null, 'el monto no puede exceder lo pendiente');
create temp table _pr as select agente.simular('ejecutar_ext', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 100000, 'referencia', 'REF-SINT-1', 'metodo', 'transferencia', 'via', 'proveedor'))) as j;
select is((select j -> 'resultado' ->> 'estado' from _pr), 'pago_reportado', 'la vista previa dice que quedaria como pago reportado');
select is((select count(*)::int from operacion.ds_pago_reporte), 0, '... y no deja nada');
create temp table _q1 as select agente.ejecutar_ext('mt:q2', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 100000, 'referencia', 'REF-SINT-1', 'metodo', 'transferencia', 'via', 'proveedor', 'efecto_hash', (select j ->> 'efecto_hash' from _pr)))) as j;
select is((select j ->> 'estado' from _q1), 'pago_reportado', 'sin comprobante: Pago reportado');
select is((select (j ->> 'aplicado')::boolean from _q1), false, '... todavia NO aplicado');
select is((select (j ->> 'requiere_confirmacion_del_otro_socio')::boolean from _q1), true, '... el otro socio debe confirmar');
select is((select j ->> 'pendiente_cent' from _q1)::bigint, (30 * 8929)::bigint, 'el pedido sigue pendiente de pago completo');
select is((select referencia from operacion.ds_pago_reporte where id = (select (j ->> 'reporte_id')::bigint from _q1)), 'REF-SINT-1', 'guarda la referencia');
select is(agente.ejecutar_ext('mt:q2', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 100000, 'referencia', 'REF-SINT-1', 'metodo', 'transferencia', 'via', 'proveedor'))) ->> 'repetido', 'true', 'doble envio: idempotente');
select is((select count(*)::int from operacion.ds_pago_reporte), 1, '... un solo reporte');
-- decision del otro socio
select throws_ok($$ select agente.ejecutar_ext('mt:d0', 'pago_decidir', pg_temp.args('angelo', 5800001, jsonb_build_object('reporte_id', (select (j ->> 'reporte_id')::bigint from _q1), 'decision', 'confirmado'))) $$, '42501', null, 'quien reporto no se confirma a si mismo');
select throws_ok($$ select agente.ejecutar_ext('mt:d1', 'pago_decidir', pg_temp.args('javier', 5800002, jsonb_build_object('reporte_id', (select (j ->> 'reporte_id')::bigint from _q1), 'decision', 'rechazado'))) $$, '23502', null, 'rechazar exige motivo');
select is(agente.ejecutar_ext('mt:d2', 'pago_decidir', pg_temp.args('javier', 5800002, jsonb_build_object('reporte_id', (select (j ->> 'reporte_id')::bigint from _q1), 'decision', 'confirmado'))) ->> 'decision', 'confirmado', 'el otro socio confirma recibido');
select is((select (api_pendiente)::bigint from (select (operacion.pedido_saldo((select (j ->> 'pedido_id')::bigint from _p1))) as api_pendiente) x), (30 * 8929 - 100000)::bigint, 'se aplico: baja el pendiente por lo pagado');
select throws_ok($$ select agente.ejecutar_ext('mt:d3', 'pago_decidir', pg_temp.args('javier', 5800002, jsonb_build_object('reporte_id', (select (j ->> 'reporte_id')::bigint from _q1), 'decision', 'confirmado'))) $$, 'P0428', null, 'un reporte ya resuelto no se resuelve otra vez');
-- rechazo con motivo
create temp table _q2 as select agente.ejecutar_ext('mt:q3', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 50000, 'referencia', 'REF-SINT-2'))) as j;
select is(agente.ejecutar_ext('mt:d4', 'pago_decidir', pg_temp.args('javier', 5800002, jsonb_build_object('reporte_id', (select (j ->> 'reporte_id')::bigint from _q2), 'decision', 'rechazado', 'motivo', 'no llego el dinero (sintetico)'))) ->> 'decision', 'rechazado', 'el otro socio rechaza con motivo');
select is(operacion.pedido_saldo((select (j ->> 'pedido_id')::bigint from _p1)), (30 * 8929 - 100000)::bigint, 'el rechazado no se aplica: el pendiente no cambia');

-- ------------------------------------------------------------------ comprobante de Telegram (solo huella)
select throws_ok($$ select agente.evidencia_guardar(-100800, 9001, 5800003, 'FILEID-OMAR', 'UNIQ-OMAR') $$, '42501', null, 'Omar no deja comprobantes');
create temp table _ev as select agente.evidencia_guardar(-100800, 9002, 5800001, 'FILEID-SINT-1', 'UNIQ-SINT-1') as j;
select ok((select j ->> 'huella' from _ev) ~ '^[0-9a-f]{64}$', 'se guarda la huella (sha256) del comprobante');
select is(agente.evidencia_guardar(-100800, 9002, 5800001, 'FILEID-SINT-1', 'UNIQ-SINT-1') ->> 'id', (select j ->> 'id' from _ev), 'el mismo mensaje no duplica el comprobante');
select is((select count(*)::int from agente.evidencia_tg), 1, '... una sola fila');
create temp table _pc as select agente.simular('ejecutar_ext', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 150000, 'referencia', 'REF-SINT-3'))) as j;
select is((select (j -> 'resultado' ->> 'aplicado')::boolean from _pc), true, 'con comprobante la vista previa dice que se aplica');
select is((select reporte_id from agente.evidencia_tg where id = (select (j ->> 'id')::bigint from _ev)), null, '... y la vista previa NO liga el comprobante');
create temp table _q3 as select agente.ejecutar_ext('mt:q4', 'pago_pedido_menudeo', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'monto_cent', 150000, 'referencia', 'REF-SINT-3', 'efecto_hash', (select j ->> 'efecto_hash' from _pc)))) as j;
select is((select (j ->> 'aplicado')::boolean from _q3), true, 'con comprobante: se aplica (con comprobante basta registrar)');
select is((select (j ->> 'comprobante_telegram')::boolean from _q3), true, '... y lo dice');
select is((select reporte_id from agente.evidencia_tg where id = (select (j ->> 'id')::bigint from _ev)), (select (j ->> 'reporte_id')::bigint from _q3), 'el comprobante queda ligado al reporte');
select is(operacion.pedido_saldo((select (j ->> 'pedido_id')::bigint from _p1)), (30 * 8929 - 100000 - 150000)::bigint, 'el pendiente baja');
select is(agente._evidencia_pendiente(5800001), null, 'el comprobante no se reutiliza para otro pago');
-- el otro socio todavia puede rechazar lo aplicado con comprobante
select is(agente.ejecutar_ext('mt:d5', 'pago_decidir', pg_temp.args('javier', 5800002, jsonb_build_object('reporte_id', (select (j ->> 'reporte_id')::bigint from _q3), 'decision', 'rechazado', 'motivo', 'el ticket no corresponde (sintetico)'))) ->> 'decision', 'rechazado', 'el otro socio puede rechazar un pago aplicado con comprobante');
select is(operacion.pedido_saldo((select (j ->> 'pedido_id')::bigint from _p1)), (30 * 8929 - 100000)::bigint, '... y se anula: el pedido vuelve a pendiente por ese monto');
select is((select count(*)::int from entrega.evidencia_pago), 0, 'nada de imagenes en el esquema entrega: el bot nunca recibe ni lee el archivo');

-- ------------------------------------------------------------------ esperas (preguntas abiertas)
select throws_ok($$ select agente.espera_abrir(-100800, 5800003, 'fecha_pago', '{}'::jsonb, now() + interval '1 hour') $$, '42501', null, 'Omar no abre preguntas');
select agente.espera_abrir(-100800, 5800001, 'fecha_pago', '{"a":1}'::jsonb, now() + interval '1 hour');
select agente.espera_abrir(-100800, 5800001, 'fecha_reprogramar', '{"b":2}'::jsonb, now() + interval '1 hour');
select is((select count(*)::int from agente.tg_espera where resuelta_at is null and telegram_user_id = 5800001), 1, 'una sola pregunta abierta por socio');
select is(agente.espera_tomar(-100800, 5800002, now()), null, 'otro socio no toma la pregunta de Angelo');
select is(agente.espera_tomar(-100801, 5800001, now()), null, 'ni en otro chat');
select is(agente.espera_tomar(-100800, 5800001, now()) ->> 'tipo', 'fecha_reprogramar', 'Angelo toma la suya');
select is(agente.espera_tomar(-100800, 5800001, now()), null, 'y solo una vez');
select agente.espera_abrir(-100800, 5800001, 'fecha_pago', '{}'::jsonb, now() + interval '1 hour');
select is(agente.espera_tomar(-100800, 5800001, now() + interval '2 hours'), null, 'una pregunta caducada no se toma');

-- ------------------------------------------------------------------ interruptor y recordatorios
select is(agente.envio_activo(), false, 'telegram_envio nace apagado');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p1), 'por_vencer', now()) ->> 'reclamado', 'false', 'con el interruptor apagado el reclamo devuelve false (defensa en profundidad)');
select is((select count(*)::int from operacion.ds_recordatorio_log), 0, '... y no registra nada');
update seguridad.interruptor set activo = true where clave = 'telegram_envio';
select is(agente.envio_activo(), true, '... y se lee encendido');
create temp table _v as select operacion.ds_vence_en(negocio.hoy() + 2, '10:00') as vence;
create function pg_temp.rec(p_ahora timestamptz) returns jsonb language sql as $$ select agente.recordatorios_menudeo($1) -> 'recordatorios' $$;
create function pg_temp.tipo(p bigint, p_ahora timestamptz) returns text language sql as $$ select x ->> 'tipo' from jsonb_array_elements(pg_temp.rec($2)) x where (x ->> 'pedido_id')::bigint = $1 $$;
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p1), (select vence from _v) - interval '30 hours'), null, 'a mas de 24 h de vencer: nada');
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p1), (select vence from _v) - interval '20 hours'), 'por_vencer', '24 h antes: por vencer');
select is((select x ->> 'socio' from jsonb_array_elements(pg_temp.rec((select vence from _v) - interval '20 hours')) x where (x ->> 'pedido_id')::bigint = (select (j ->> 'pedido_id')::bigint from _p1)), 'Angelo', 'el recordatorio no lleva datos de clientes: folio, socio, monto, fechas');
select is((select (x ? 'cliente' or x ? 'destinatario' or x ? 'telefono') from jsonb_array_elements(pg_temp.rec((select vence from _v) - interval '20 hours')) x limit 1), false, '... ni cliente, ni destinatario ni telefono');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p1), 'por_vencer', (select vence from _v) - interval '20 hours') ->> 'reclamado', 'true', 'el primer latido reclama el aviso');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p1), 'por_vencer', (select vence from _v) - interval '20 hours') ->> 'reclamado', 'false', 'un segundo latido (doble envio) NO lo reclama otra vez');
select is((select count(*)::int from operacion.ds_recordatorio_log where pedido_id = (select (j ->> 'pedido_id')::bigint from _p1)), 1, 'una sola fila en el registro');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p1), 'vencido', (select vence from _v) - interval '20 hours') ->> 'reclamado', 'false', 'un tipo que no toca no se reclama');
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p1), (select vence from _v) - interval '19 hours'), null, 'ya avisado: no se repite');
-- Borde: por_vencer y vence_hoy en la MISMA hora de reloj (la ventana unica es pedido+hora): el segundo aviso NO se duplica, se reclama en la hora siguiente.
create temp table _p3 as select agente.ejecutar_ext('mt:p9', 'pedido_menudeo', pg_temp.pedido_args(negocio.hoy() + 2, '10:30')) as j;
select set_config('rtm.canal', 'importacion', true);
select operacion.enviar_pedido('mt-e9', (select (j ->> 'pedido_id')::bigint from _p3), null, null, null, true);
select set_config('rtm.canal', '', true);
create temp table _v3 as select operacion.ds_vence_en(negocio.hoy() + 2, '10:30') as vence;
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p3), 'por_vencer', (select vence from _v3) - interval '20 minutes') ->> 'reclamado', 'true', 'por_vencer a las :10 se reclama');
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p3), (select vence from _v3) + interval '10 minutes'), 'vence_hoy', 'a las :40 ya toca vence_hoy');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p3), 'vence_hoy', (select vence from _v3) + interval '10 minutes') ->> 'reclamado', 'false', 'pero en la misma hora de reloj NO se reclama (evita el aviso duplicado)');
select is((select count(*)::int from operacion.ds_recordatorio_log where pedido_id = (select (j ->> 'pedido_id')::bigint from _p3)), 1, '... una sola fila');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p3), 'vence_hoy', (select vence from _v3) + interval '70 minutes') ->> 'reclamado', 'true', 'en la hora siguiente si se reclama');

-- vence hoy y vencido periodico, con el compromiso historico de otro pedido
insert into operacion.ds_pedido_compromiso (pedido_id, fecha_compromiso, comprometido_por, tipo, motivo, evento_id)
  select (select (j ->> 'pedido_id')::bigint from _p2), negocio.hoy() - 3, (select id from catalogo.socio where nombre = 'Angelo'), 'reprogramacion', 'compromiso historico sintetico', (select evento_id from operacion.pedido where id = (select (j ->> 'pedido_id')::bigint from _p2));
create temp table _t as select now() as t0;
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p2), (select t0 from _t)), 'vencido', 'vencido: recordatorio');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t)) ->> 'reclamado', 'true', 'se reclama');
select is(agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t)) ->> 'reclamado', 'false', 'un recordatorio repetido en la misma hora no se duplica');
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p2), (select t0 from _t) + interval '12 hours'), null, 'antes de 24 h no hay otro');
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p2), (select t0 from _t) + interval '25 hours'), 'vencido', 'a las 24 h toca otro');
-- maximo 7
select agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t) + interval '25 hours');
select agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t) + interval '50 hours');
select agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t) + interval '75 hours');
select agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t) + interval '100 hours');
select agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t) + interval '125 hours');
select agente.recordatorio_reclamar((select (j ->> 'pedido_id')::bigint from _p2), 'vencido', (select t0 from _t) + interval '150 hours');
select is((select count(*)::int from operacion.ds_recordatorio_log where pedido_id = (select (j ->> 'pedido_id')::bigint from _p2)), 7, 'siete recordatorios');
select is(pg_temp.tipo((select (j ->> 'pedido_id')::bigint from _p2), (select t0 from _t) + interval '175 hours'), null, 'despues del septimo no hay mas');

-- respuesta al recordatorio
select throws_ok($$ select agente.ejecutar_ext('mt:r0', 'recordatorio_responder', pg_temp.args('javier', 5800002, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p2), 'accion', 'pagado'))) $$, '42501', null, 'Javier no responde por los pedidos de Angelo');
select throws_ok($$ select agente.ejecutar_ext('mt:r1', 'recordatorio_responder', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p2), 'accion', 'posponer', 'fecha', (negocio.hoy() + 3)::text))) $$, '23502', null, 'reprogramar exige motivo');
select is(agente.ejecutar_ext('mt:r2', 'recordatorio_responder', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p2), 'accion', 'posponer', 'fecha', (negocio.hoy() + 3)::text, 'hora', '09:00', 'motivo', 'reprogramado desde Telegram (sintetico)'))) ->> 'accion', 'posponer', 'Reprogramar: nueva fecha con motivo');
select is((select fecha_compromiso from operacion.ds_pedido_compromiso where pedido_id = (select (j ->> 'pedido_id')::bigint from _p2) order by id desc limit 1), negocio.hoy() + 3, '... y queda en el historial');
select is(agente.ejecutar_ext('mt:r3', 'recordatorio_responder', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p2), 'accion', 'pagado', 'referencia', 'REF-SINT-9'))) ->> 'estado', 'pago_reportado', 'Pagado: reporta el pago pendiente sin comprobante (Pago reportado)');
select is(agente.ejecutar_ext('mt:r3', 'recordatorio_responder', pg_temp.args('angelo', 5800001, jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p2), 'accion', 'pagado', 'referencia', 'REF-SINT-9'))) ->> 'repetido', 'true', 'doble pulsacion: idempotente');
select is((select count(*)::int from operacion.ds_pago_reporte where pedido_id = (select (j ->> 'pedido_id')::bigint from _p2)), 1, '... un solo reporte');

-- ------------------------------------------------------------------ cuadre y privilegios
select is(pg_temp.fallan(), '', 'el cuadre de socios sigue sin verificaciones rojas tras todo lo anterior');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0, 'ninguna funcion de agente la ejecuta PUBLIC, anon o authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname like '\_%' and has_function_privilege('servidor', p.oid, 'execute')), 0, 'servidor no ejecuta ningun ayudante _*');
select is(has_function_privilege('authenticated', 'operacion.ds_reportar_pago_menudeo(text,bigint,text,bigint,text,text,date,text,text,text,text,text,text)', 'execute'), false, 'la funcion de dropshipping redefinida sigue sin GRANT a authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname in ('igualacion', 'espera_abrir', 'espera_tomar', 'evidencia_guardar', 'envio_activo', 'recordatorios_menudeo', 'recordatorio_reclamar', 'socio_menudeo')
  and has_function_privilege('servidor', p.oid, 'execute')), 8, 'las ocho puertas nuevas son de servidor');
select is((select count(*)::int from information_schema.role_table_grants where table_schema = 'agente' and table_name in ('tg_espera', 'evidencia_tg') and grantee in ('anon', 'authenticated', 'public')), 0, 'las tablas nuevas no tienen GRANT a anon, authenticated ni public');
select * from finish();
rollback;
