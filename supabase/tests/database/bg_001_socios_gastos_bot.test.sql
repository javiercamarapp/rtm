-- pgTAP carril SOCIOS Y GASTOS del bot: entrega de fondos, liquidacion, retiro de capital (dos socios), renta de Omar, gasto de caja, acta por confirmacion personal,
-- ticket con huella, deshacer 10 minutos, antiduplicado, saldos de ambos socios, y que NADA marque capital sin declaracion. Datos sinteticos; no se envia nada.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(7000001, 'angelo');
select agente.registrar_miembro(7000002, 'javier');
select agente.registrar_chat('grupo_socios', -7000001);
select agente.fijar_escritura(true, 'angelo', 7000001, 'prueba');
select catalogo.asegurar_cliente('Bg Cliente', 'Javier');
create function pg_temp.ang(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'angelo', 'telegram_user_id', 7000001, 'origen', 'x') || $1 $$;
create function pg_temp.jav(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'javier', 'telegram_user_id', 7000002, 'origen', 'x') || $1 $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.fondos(p text) returns bigint language sql as $$ select operacion.saldo_socio(pg_temp.sid($1)) $$;
create temp table _cap0 as select count(*)::int n from operacion.aportacion_socio where clasificacion = 'capital';

-- 1. aportacion SIN declarar capital = reembolso; gasto de socio = gasto una vez + reembolso
create temp table _a as select agente.ejecutar('bg:a1', 'aportacion', pg_temp.ang('{"socio":"angelo","monto_cent":2000000,"intencion":"reembolso"}')) j;
select is((select clasificacion from operacion.aportacion_socio order by id desc limit 1), 'reembolsable', 'un deposito sin declarar capital es reembolso');
create temp table _g as select agente.ejecutar('bg:g1', 'gasto', pg_temp.ang('{"pagado_por":"angelo","monto_cent":50000,"categoria":"uber"}')) j;
select is((select count(*)::int from operacion.gasto where folio = (select j ->> 'folio' from _g)), 1, 'el gasto de socio es UN gasto de la empresa');
select is((select count(*)::int from operacion.aportacion_socio where ref_tipo = 'gasto' and clasificacion = 'reembolsable' and monto_cent = 50000), 1, 'y un solo reembolso al socio');

-- 2. fondos de la sociedad en poder de Angelo (cobro de cliente en su cuenta)
select agente.ejecutar('bg:c1', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'angelo', 'monto_cent', 700000, 'cliente_id', (select id from catalogo.cliente where nombre_canonico = 'Bg Cliente'), 'confirmo_exceso', true)));
select is(pg_temp.fondos('Angelo'), 700000::bigint, 'Angelo tiene 7,000.00 de la sociedad en su poder');

-- 3. entrega de fondos a la sociedad: baja fondos, NO es aportacion
create temp table _e as select agente.ejecutar_ext('bg:e1', 'entrega_fondos', pg_temp.ang('{"socio":"angelo","destino":"sociedad","monto_cent":300000}')) j;
select ok((select j ->> 'folio' from _e) is not null, 'la entrega trae folio');
select is(pg_temp.fondos('Angelo'), 400000::bigint, 'la entrega baja los fondos en su poder');
select is((select count(*)::int from operacion.aportacion_socio where concepto ilike '%entrega%'), 0, 'una entrega NO es aportacion');
select is((agente.ejecutar_ext('bg:e2', 'entrega_fondos', pg_temp.jav('{"socio":"angelo","destino":"sociedad","monto_cent":300000}')) ->> 'posible_duplicado')::boolean, true, 'misma entrega por el otro socio en 10 min: posible duplicado');
select is(pg_temp.fondos('Angelo'), 400000::bigint, 'el duplicado no escribio');
select ok((agente.deshacer('bg:u1', (select j ->> 'folio' from _e), 'angelo', 7000001) ->> 'deshecho')::boolean, 'deshacer la entrega dentro de 10 minutos');
select is(pg_temp.fondos('Angelo'), 700000::bigint, 'los fondos vuelven');
select ok((agente.ejecutar_ext('bg:e3', 'entrega_fondos', pg_temp.ang('{"socio":"angelo","destino":"sociedad","monto_cent":300000}')) ->> 'folio') is not null, 'se vuelve a entregar (la anterior ya no cuenta)');

-- 4. entrega a un proveedor con fondos de la sociedad: no es capital ni aportacion; no se deshace
create temp table _k as select agente.ejecutar_ext('bg:k1', 'entrega_fondos', pg_temp.ang('{"socio":"angelo","destino":"karen","monto_cent":100000}')) j;
select is(pg_temp.fondos('Angelo'), 300000::bigint, 'entregar a Karen baja los fondos en poder');
select throws_ok($$ select agente.deshacer('bg:u2', (select j ->> 'folio' from _k), 'angelo', 7000001) $$, 'P0460', null, 'la entrega a proveedor se corrige con contramovimiento, no se deshace');
select throws_ok($$ select agente.ejecutar_ext('bg:k2', 'entrega_fondos', pg_temp.ang('{"socio":"angelo","destino":"karen","monto_cent":99999999}')) $$, '23514', null, 'no se entrega mas de lo que se tiene en poder (guarda contable, mensaje claro)');

-- 5. liquidacion entre socios y su deshacer
create temp table _l as select agente.ejecutar_ext('bg:l1', 'liquidacion_socios', pg_temp.ang('{"de_socio":"angelo","a_socio":"javier","monto_cent":200000}')) j;
select ok((select j ->> 'folio' from _l) is not null, 'liquidacion con folio');
select is(pg_temp.fondos('Angelo'), 100000::bigint, 'la liquidacion baja lo que Angelo tiene de la sociedad');
select ok((agente.deshacer('bg:u3', (select j ->> 'folio' from _l), 'javier', 7000002) ->> 'deshecho')::boolean, 'el otro socio la deshace dentro de la ventana');
select is(pg_temp.fondos('Angelo'), 300000::bigint, 'liquidacion revertida');

-- 6. retiro de capital: lo propone quien retira y lo confirma EL OTRO socio
select agente.ejecutar('bg:cap', 'aportacion', pg_temp.jav('{"socio":"javier","monto_cent":1000000,"intencion":"capital"}'));
select throws_ok($$ select agente.ejecutar_ext('bg:r0', 'retiro_capital', pg_temp.ang('{"socio":"javier","monto_cent":500000}')) $$, 'P0460', null, 'el otro socio no propone el retiro de capital de Javier');
create temp table _r as select agente.ejecutar_ext('bg:r1', 'retiro_capital', pg_temp.jav('{"socio":"javier","monto_cent":500000}')) j;
select is((select j ->> 'modo' from _r), 'propuesto', 'Javier propone');
select is((agente.ejecutar_ext('bg:r2', 'retiro_capital', pg_temp.jav('{"socio":"javier","monto_cent":500000}')) ->> 'posible_duplicado')::boolean, true, 'Javier repetir su propio retiro es posible duplicado: no confirma lo suyo');
select is((agente.ejecutar_ext('bg:r3', 'retiro_capital', pg_temp.ang('{"socio":"javier","monto_cent":500000}')) ->> 'modo'), 'confirmado', 'Angelo lo confirma con su propio mensaje');
select throws_ok($$ select agente.deshacer('bg:u4', (select j ->> 'folio' from _r), 'javier', 7000002) $$, 'P0460', null, 'el retiro de capital no se deshace');

-- 7. renta de Omar: sin devengado PREGUNTA, no topa; con confirmacion registra; se deshace
create temp table _p as select agente.ejecutar_ext('bg:p1', 'renta_omar', pg_temp.ang('{"pagado_por":"angelo","monto_cent":100000,"via":"transferencia"}')) j;
select is((select (j ->> 'pregunta_exceso_renta')::boolean from _p), true, 'un pago mayor a lo que se debe a Omar se pregunta');
create temp table _p2 as select agente.ejecutar_ext('bg:p2', 'renta_omar', pg_temp.ang('{"pagado_por":"angelo","monto_cent":100000,"via":"transferencia","confirmo_exceso":true}')) j;
select ok((select j ->> 'folio' from _p2) like 'PO-%', 'con la confirmacion queda registrado (folio PO)');
select is((select (j ->> 'exceso_cent')::bigint from _p2), 100000::bigint, 'queda marcado como anticipo (cifra de SQL)');
select ok((agente.deshacer('bg:u5', (select j ->> 'folio' from _p2), 'angelo', 7000001) ->> 'deshecho')::boolean, 'la renta se deshace 10 minutos');
select throws_ok($$ select agente.ejecutar_ext('bg:p3', 'renta_omar', pg_temp.ang('{"pagado_por":"sociedad","monto_cent":100,"via":"efectivo"}')) $$, 'P0460', null, 'la renta la paga un socio: se le pregunta cual');

-- 8. gasto de caja con tipo de gasto
create temp table _gc as select agente.ejecutar_ext('bg:gc1', 'gasto_caja', pg_temp.ang('{"monto_cent":20000,"categoria":"guia_envio"}')) j;
select ok((select j ->> 'folio' from _gc) like 'G-%', 'gasto de caja con folio');
select ok((agente.deshacer('bg:u6', (select j ->> 'folio' from _gc), 'angelo', 7000001) ->> 'deshecho')::boolean, 'y se deshace');
select throws_ok($$ select agente.ejecutar_ext('bg:gc2', 'gasto_caja', pg_temp.ang('{"monto_cent":20000}')) $$, 'P0460', null, 'sin tipo de gasto se pregunta');

-- 9. acta: la firma es de cada socio con su propio mensaje
select throws_ok($$ select agente.ejecutar_ext('bg:ac0', 'acta_confirmar', pg_temp.ang('{"confirmacion_texto":"ok"}')) $$, 'P0460', null, 'un mensaje que no es confirmacion no firma');
select throws_ok($$ select agente.ejecutar_ext('bg:ac1', 'acta_confirmar', pg_temp.ang('{"confirmacion_texto":"firmo el acta"}')) $$, 'P0460', null, 'sin acta pendiente no hay nada que firmar');
select ok('acta_confirmar' = any (agente.tipos_no_reversibles()) and 'retiro_capital' = any (agente.tipos_no_reversibles()), 'la firma y el retiro de capital estan en la lista de no reversibles');

-- 10. ticket con huella
select agente.evidencia_guardar(-7000001, 501, 7000001, 'file_x', 'uniq_x');
create temp table _t as select agente.evidencia_ligar_gasto(7000001, (select j ->> 'folio' from _g)) j;
select is((select (j ->> 'ligada')::boolean from _t), true, 'la foto queda ligada al gasto con su huella');
select agente.evidencia_guardar(-7000001, 502, 7000001, 'file_y', 'uniq_x');
select is((agente.evidencia_ligar_gasto(7000001, (select j ->> 'folio' from _gc)) ->> 'duplicada')::boolean, true, 'la misma foto no respalda dos gastos');

-- 11. ambos saldos y cierre mensual en consulta
select is(jsonb_array_length(agente.saldos_socios_aviso() -> 'socios'), 2, 'el aviso trae ambos saldos');
select ok(agente.saldos_socios_aviso() -> 'socios' -> 0 ? 'valuacion_cent', 'cada saldo trae su valuacion (cifra de SQL)');
select lives_ok($$ select agente.consulta_cierre_mensual() $$, 'el cierre mensual se consulta');

-- 12. identidades y capital sin declaracion
select is((select count(*)::int from operacion.aportacion_socio where clasificacion = 'capital') - (select n from _cap0), 1, 'solo UNA fila de capital: la que el socio declaro');
-- Las identidades de socios (auxiliar contra mayor, partida doble, efectivo repartido) se verifican con COMMIT REAL en bg_002 (la cadena de hash C21 no admite varios
-- asientos del mismo instante dentro de una sola transaccion: es una limitacion de la prueba, no de las operaciones). Aqui se revisan todas las demas.
select contabilidad.asentar_pendientes();
select is(coalesce((select string_agg(x ->> 'id', ';') from jsonb_array_elements(operacion.cuadre_socios() -> 'verificaciones') x
                     where not (x ->> 'ok')::boolean and (x ->> 'id') not in ('ii-c21', 'ii-bloqueantes')), ''), '', 'ninguna identidad de socios en rojo (salvo la cadena C21, ver bg_002)');
select * from finish();
rollback;
