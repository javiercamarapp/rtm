-- pgTAP: esquema de seguridad (F0). Los valores esperados vienen de la especificacion, no de la salida del codigo.
begin;
select plan(30);

-- Estructura -----------------------------------------------------------------
select has_table('seguridad', 'usuario', 'existe seguridad.usuario');
select has_table('seguridad', 'limite_intento', 'existe seguridad.limite_intento');
select has_table('seguridad', 'auditoria', 'existe seguridad.auditoria');
select has_table('seguridad', 'operacion', 'existe seguridad.operacion');
select has_table('seguridad', 'contador_folio', 'existe seguridad.contador_folio');
select has_table('seguridad', 'interruptor', 'existe seguridad.interruptor');
select has_table('seguridad', 'correo_permitido', 'existe la lista de correos permitidos');

-- Tiempo de negocio (G8): 02:00 UTC del sabado 14 es viernes 13 en Merida ---------
select is(negocio.fecha_neg('2026-11-14 02:00:00+00'::timestamptz), '2026-11-13'::date, '02:00 UTC del sabado 14 = viernes 13');
select is(negocio.fecha_neg('2026-11-14 05:59:59+00'::timestamptz), '2026-11-13'::date, '05:59:59 UTC aun es el dia anterior');
select is(negocio.fecha_neg('2026-11-14 06:00:00+00'::timestamptz), '2026-11-14'::date, '06:00:00 UTC ya es el dia nuevo');

-- Redondeo medio arriba (G5): mismas cifras que el modulo TypeScript -----------------
select is(negocio.redondear_medio_arriba(14061500::bigint * 100, 1536), 915462::bigint, 'salida de 100 piezas = 915,462 centavos');
select is(negocio.redondear_medio_arriba(13146038::bigint * 100, 1436), 915462::bigint, 'segunda salida de 100 = 915,462 centavos');
select is(negocio.redondear_medio_arriba(1, 2), 1::bigint, '.5 sube');
select is(negocio.redondear_medio_arriba(-1, 2), 0::bigint, '-.5 -> 0 (medio arriba)');
select is(negocio.redondear_medio_arriba(-3, 2), -1::bigint, '-1.5 -> -1');

-- Folios sin huecos: un rollback no consume folio -------------------------------
select is(seguridad.siguiente_folio('P'), 'P-0001', 'primer folio de pedido');
select is(seguridad.siguiente_folio('P'), 'P-0002', 'segundo folio');
savepoint a;
select seguridad.siguiente_folio('P'); -- consume P-0003 dentro del savepoint
rollback to savepoint a;
select is(seguridad.siguiente_folio('P'), 'P-0003', 'tras el rollback el folio P-0003 no se consumio');
select throws_ok($$select seguridad.siguiente_folio('X')$$, '22023', null, 'serie desconocida rechazada');

-- Limite de intentos: conteo atomico por ventana -------------------------------------
select is(seguridad.registrar_intento_login('ip:aaaaaaaaaaaaaaaa'), 1, 'primer intento = 1');
select is(seguridad.registrar_intento_login('ip:aaaaaaaaaaaaaaaa'), 2, 'segundo intento = 2');
select is(seguridad.registrar_intento_login('ip:bbbbbbbbbbbbbbbb'), 1, 'otra clave cuenta aparte');
select throws_ok($$select seguridad.registrar_intento_login('mal formato')$$, '23514', null, 'clave con formato invalido rechazada por CHECK');

-- Idempotencia: misma clave + mismo payload; distinto payload = conflicto ---------------
select is(seguridad.iniciar_operacion('k1', '{"a":1}'::jsonb), null::jsonb, 'primera vez no hay resultado guardado');
select seguridad.terminar_operacion('k1', '{"ok":true}'::jsonb);
select is(seguridad.iniciar_operacion('k1', '{"a":1}'::jsonb), '{"ok":true}'::jsonb, 'misma clave y payload devuelve lo guardado');
select throws_ok($$select seguridad.iniciar_operacion('k1', '{"a":2}'::jsonb)$$, 'P0409', 'conflicto de idempotencia', 'mismo clave con otro payload = error 409');

-- Auditoria: solo insercion y cadena de hash --------------------------------------------
select seguridad.registrar_auditoria('prueba', 'INSERT', '1', null, '{"x":1}'::jsonb, 'sistema');
select seguridad.registrar_auditoria('prueba', 'UPDATE', '1', '{"x":1}'::jsonb, '{"x":2}'::jsonb, 'sistema');
select throws_ok($$update seguridad.auditoria set accion = 'X'$$, '42501', null, 'UPDATE sobre auditoria falla incluso como propietario');
select throws_ok($$delete from seguridad.auditoria$$, '42501', null, 'DELETE sobre auditoria falla incluso como propietario');
select throws_ok($$truncate seguridad.auditoria$$, '42501', null, 'TRUNCATE sobre auditoria falla incluso como propietario');
select ok(seguridad.verificar_cadena_auditoria(), 'la cadena de hash de la auditoria es valida');

select * from finish();
rollback;
