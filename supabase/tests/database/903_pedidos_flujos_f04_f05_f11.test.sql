-- pgTAP 903 (QA de punta a punta, H-01, H-02, H-04): pedidos con cifras a mano de los flujos F04, F05 y F11:
-- cancelar_pedido (CP24), marcar_entregado, fijar_costo_guia / costear_guia, armar_nota, texto_nota, fmt_pesos, origen_es_bodega,
-- pedido de 50 piezas donde salen 40: total 6,300.00 y utilidad 1,950.00 (provisional: 2,130.00 sin guia).
-- Fechas de noviembre de 2026 (no futuras): la reversa de una anulacion se fecha hoy y no puede ser anterior al ultimo movimiento.
-- Inventario sembrado a costo 102.25 por pieza (la OC de 200 pz x 100.00 + guia 450.00). ESCRITA SIN EJECUTAR (sin Docker). Datos "N903".
begin;
select no_plan();
-- Las pruebas fechan sus operaciones antes del 10-nov-2026 (inicio de vigencia de la configuracion sembrada): se adelanta la vigencia dentro de la transaccion.
update catalogo.config set vigente_desde = '2026-10-01' where vigente_desde = '2026-11-10';

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n903.socio@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('95555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n903.socio@example.test');
select set_config('request.jwt.claim.sub', '95555555-5555-5555-5555-555555555555', true);
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('N903 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('N903 Omar Cliente', 'N903 Omar');
  end if;
end $$;

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.int(p_pedido bigint, p_clave text) returns bigint language sql as $$ select (snapshot_interno->'cascada'->>p_clave)::bigint from operacion.nota where pedido_id = $1 order by id desc limit 1 $$;
create function pg_temp.piezas(p_modelo text) returns int language sql as $$ select coalesce((select e.piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0) $$;
create function pg_temp.valor(p_modelo text) returns bigint language sql as $$ select coalesce((select e.valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0) $$;

select catalogo.asegurar_cliente('N903 Cliente QA 1', 'Angelo');
select catalogo.asegurar_modelo('N903 Marca', 'N903 Modelo QA 50K', 50000, 'ambas');
select catalogo.asegurar_sku('N903 Modelo QA 50K', 'Fresa');
select catalogo.asegurar_sku('N903 Modelo QA 50K', 'Uva');
select catalogo.fijar_costo('n903c1', 'Isaac', 'N903 Modelo QA 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('n903p1', 'N903 Cliente QA 1', 'N903 Modelo QA 50K', 15000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('n903m1', 'N903 Modelo QA 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 100, 1022500, '2026-11-01');
select operacion.registrar_movimiento('n903m2', 'N903 Modelo QA 50K', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1022500, '2026-11-01');
select is(pg_temp.piezas('N903 Modelo QA 50K'), 200, 'inventario de partida: 200 piezas');
select is(pg_temp.valor('N903 Modelo QA 50K'), 2045000::bigint, 'inventario de partida: 20,450.00 (promedio 102.25)');

-- Funciones puras ---------------------------------------------------------------------------------------------------------------
select is(operacion.fmt_pesos(600000), '6,000', 'fmt_pesos: enteros sin centavos');
select is(operacion.fmt_pesos(630000, true), '6,300.00', 'fmt_pesos: con centavos forzados');
select is(operacion.fmt_pesos(51125), '511.25', 'fmt_pesos: centavos presentes');
select is(operacion.fmt_pesos(-86050), '-860.50', 'fmt_pesos: negativo');
select is(operacion.fmt_pesos(0), '0', 'fmt_pesos: cero');
select is(operacion.fmt_pesos(123456789), '1,234,567.89', 'fmt_pesos: miles');
select is(operacion.origen_es_bodega('bodega_omar'), true, 'origen bodega_omar es bodega');
select is(operacion.origen_es_bodega('castores'), true, 'origen castores es bodega');
select is(operacion.origen_es_bodega('isaac_directo'), false, 'isaac_directo no es bodega');
select is(operacion.origen_es_bodega('karen_directo'), false, 'karen_directo no es bodega');

-- F04: pedido de 50 piezas, 7,800.00 si saliera todo -----------------------------------------------------------------------------
select is((operacion.crear_pedido('n903a', pg_temp.cid('N903 Cliente QA 1'), '[{"modelo":"N903 Modelo QA 50K","sabor":"Fresa","piezas":50}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, '2026-11-02')->>'piezas')::int, 50, 'crear: 50 piezas');
select is((select estado from operacion.pedido where id = pg_temp.pid('n903a')), 'borrador', 'nace en borrador');
select is((select count(*)::int from operacion.pedido_aviso where pedido_id = pg_temp.pid('n903a')), 0, 'sin avisos: >= 20 piezas y precio del tabulador');
select is((select precio_cent from operacion.pedido_linea where pedido_id = pg_temp.pid('n903a')), 15000::bigint, 'el precio sale del tabulador: 150.00');
select operacion.confirmar_pedido('n903ac', pg_temp.pid('n903a'));
select is(operacion.disponible_sku((select id from catalogo.sku s where s.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'N903 Modelo QA 50K') and s.sabor_id = (select id from catalogo.sabor where nombre_canonico = 'Fresa'))), 50, 'disponible = fisico 100 - reserva 50');
select is(pg_temp.piezas('N903 Modelo QA 50K'), 200, 'confirmar no mueve el fisico');
select is((operacion.marcar_empacado('n903ae', pg_temp.pid('n903a'))->>'empacado')::boolean, true, 'empacar');
-- Se surten 40 de 50, guia SIN costo todavia (provisional) -------------------------------------------------------------------------
select is((operacion.enviar_pedido('n903as', pg_temp.pid('n903a'),
  jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.pid('n903a')), 'piezas', 40)),
  '{"paqueteria":"Castores","numero":"QA-P1"}'::jsonb, '2026-11-02', false, 'entrega_diferida')->>'total_cent')::bigint, 630000::bigint, 'total a saldar 6,300.00 (40 x 150 + 300), no 7,800.00');
select is(pg_temp.int(pg_temp.pid('n903a'), 'costo_cent'), 409000::bigint, 'costo 40 x 102.25 = 4,090.00');
select is(pg_temp.int(pg_temp.pid('n903a'), 'renta_cent'), 8000::bigint, 'renta de Omar 40 x 2.00 = 80.00');
select is(pg_temp.int(pg_temp.pid('n903a'), 'utilidad_cent'), 213000::bigint, 'sin costear la guia: utilidad 2,130.00');
select is((select (snapshot_interno->'cascada'->>'utilidad_provisional')::boolean from operacion.nota where pedido_id = pg_temp.pid('n903a')), true, 'y es provisional');
select is(pg_temp.piezas('N903 Modelo QA 50K'), 160, 'inventario: 160 piezas');
select is(pg_temp.valor('N903 Modelo QA 50K'), 1636000::bigint, 'inventario: 16,360.00');
select is((select (snapshot_interno->'comprobaciones'->'c2'->>'pendientes')::int from operacion.nota where pedido_id = pg_temp.pid('n903a')), 10, 'pendiente de surtir: 10 piezas');
select is((select (snapshot_interno->'comprobaciones'->'c1'->>'cuadra')::boolean from operacion.nota where pedido_id = pg_temp.pid('n903a')), true, 'comprobacion C1 cuadra');
select is((select (snapshot_interno->'comprobaciones'->'c2'->>'cuadra')::boolean from operacion.nota where pedido_id = pg_temp.pid('n903a')), true, 'comprobacion C2 cuadra');
-- fijar_costo_guia (sin boton en la UI, H-04): fija 180.00 pagada por Javier y la utilidad pasa a 1,950.00 -------------------------------
select lives_ok($$select operacion.fijar_costo_guia('n903g1', (select id from operacion.guia where numero = 'QA-P1'), 18000, 'Javier')$$, 'fijar_costo_guia: costea la guia');
select is((select costo_cent from operacion.guia where numero = 'QA-P1'), 18000::bigint, 'la guia queda en 180.00');
select is(operacion.reembolso_pendiente((select id from catalogo.socio where nombre = 'Javier')) >= 18000, true, 'Javier tiene 180.00 de reembolso pendiente');
select throws_ok($$select operacion.fijar_costo_guia('n903g2', (select id from operacion.guia where numero = 'QA-P1'), 19000, 'Javier')$$, 'P0428', null, 'la guia ya costeada no se vuelve a fijar (GD-29: hoy irreparable)');
select throws_ok($$select operacion.fijar_costo_guia('n903g1', (select id from operacion.guia where numero = 'QA-P1'), 18001, 'Javier')$$, 'P0409', null, 'misma clave con otro monto = 409');
select is((operacion.fijar_costo_guia('n903g1', (select id from operacion.guia where numero = 'QA-P1'), 18000, 'Javier') is not null), true, 'misma clave y mismo monto: devuelve lo guardado');
select throws_ok($$select operacion.fijar_costo_guia('n903g3', (select id from operacion.guia where numero = 'QA-P1'), -1)$$, 'P0428', null, 'costo de guia negativo sobre guia ya costeada: se rechaza (primero la regla de una sola vez)');
-- armar_nota vuelve a calcular con la guia ya costeada
select is((operacion.armar_nota(pg_temp.pid('n903a'))->'interno'->'cascada'->>'utilidad_cent')::bigint, 195000::bigint, 'armar_nota: utilidad 6,300 - 4,090 - 80 - 180 = 1,950.00');
select is((operacion.armar_nota(pg_temp.pid('n903a'))->'interno'->'cascada'->>'utilidad_provisional')::boolean, false, 'armar_nota: ya no es provisional');
select is((operacion.armar_nota(pg_temp.pid('n903a'))->>'total_cent')::bigint, 630000::bigint, 'armar_nota: total 6,300.00');
-- texto de WhatsApp (oraculo en TypeScript: src/dominio/nota/texto.ts)
create temp table _txt as select operacion.texto_nota(operacion.armar_nota(pg_temp.pid('n903a'))->'cliente') as t;
select ok((select t from _txt) like '%40pz x $150 = 6,000%', 'texto: "40pz x $150 = 6,000"');
select ok((select t from _txt) like '%Envío $300%', 'texto: envio 300');
select ok((select t from _txt) like '%total a saldar 6,300.00%', 'texto: total a saldar 6,300.00');
select ok((select t from _txt) !~* 'costo|utilidad|margen', 'texto: la nota del cliente no menciona costo, utilidad ni margen');
select is((select texto_whatsapp from operacion.nota where pedido_id = pg_temp.pid('n903a') and tipo = 'original'), (select t from _txt), 'el texto guardado en la nota es el mismo que arma texto_nota');

-- marcar_entregado (H-02) ----------------------------------------------------------------------------------------------------------
select is((operacion.marcar_entregado('n903ad', pg_temp.pid('n903a'))->>'entregado')::boolean, true, 'entregado: se marca');
select is((select entregado_at is not null from operacion.pedido where id = pg_temp.pid('n903a')), true, 'entregado_at queda fijo');
select is((operacion.marcar_entregado('n903ad', pg_temp.pid('n903a'))->>'entregado')::boolean, true, 'entregado: misma clave = mismo resultado');
select lives_ok($$select operacion.marcar_entregado('n903ad2', (select id from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a')))$$, 'entregado con otra clave sobre pedido ya entregado no rompe');
select throws_ok($$select operacion.marcar_entregado('n903ax', 999999999)$$, 'P0428', null, 'entregado: pedido que no existe');

-- F05: correccion de envio 300 -> 350 ----------------------------------------------------------------------------------------------
select is((operacion.emitir_correccion('n903k', pg_temp.pid('n903a'), 'el envio fue de 350', null, 35000)->>'total_cent')::bigint, 635000::bigint, 'correccion: total a saldar 6,350.00');
select is(operacion.pedido_saldo(pg_temp.pid('n903a')), 635000::bigint, 'por cobrar 6,350.00');
select is(pg_temp.int(pg_temp.pid('n903a'), 'utilidad_cent'), 200000::bigint, 'correccion: utilidad 2,000.00 (+50)');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.pid('n903a')), 2, 'la nota original sigue guardada y se agrega -C1');
select throws_ok($$select operacion.emitir_correccion('n903k0', (select id from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a')), '')$$, '23502', null, 'la correccion exige motivo');

-- F05: pago parcial, plazo y anulacion de pago (sin UI: anular_pago) ------------------------------------------------------------------
select is((operacion.registrar_pago('n903pg', 'Angelo', 500000, pg_temp.cid('N903 Cliente QA 1'), null, true, 'abono', '2026-11-03')->>'aplicado_cent')::bigint, 500000::bigint, 'pago de 5,000.00 aplicado');
select is(operacion.pedido_saldo(pg_temp.pid('n903a')), 135000::bigint, 'por cobrar 1,350.00');
select is(operacion.pedido_cobrado(pg_temp.pid('n903a')), 635000::bigint, 'cobrable 6,350.00 (pedido_cobrado es el total de la ultima nota, no lo pagado)');
select is(operacion.pedido_aplicado(pg_temp.pid('n903a')), 500000::bigint, 'aplicado 5,000.00');
select is((operacion.acordar_plazo('n903pz', pg_temp.pid('n903a'), 5)->>'plazo_dias')::int, 5, 'plazo de 5 dias');
select throws_ok($$select operacion.acordar_plazo('n903pz0', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a'), 400)$$, '23514', null, 'plazo de mas de 365 dias se rechaza');
select throws_ok($$select operacion.acordar_plazo('n903pz1', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a'), -3)$$, '23514', null, 'plazo negativo se rechaza');
select is((operacion.registrar_recargo_credito('n903rc', pg_temp.pid('n903a'))->>'recargo_cent')::bigint, 60000::bigint, 'recargo sugerido: 10 % del subtotal de mercancia 6,000.00 = 600.00');
select is(operacion.pedido_saldo(pg_temp.pid('n903a')), 195000::bigint, 'por cobrar con recargo: 1,950.00 (6,350 - 5,000 + 600)');
select is((operacion.registrar_pago('n903pg2', 'Javier', 195000, pg_temp.cid('N903 Cliente QA 1'), null, true, 'abono', '2026-11-10')->>'aplicado_cent')::bigint, 195000::bigint, 'pago de 1,950.00');
select is(operacion.pedido_saldo(pg_temp.pid('n903a')), 0::bigint, 'por cobrar 0.00');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Javier'), 'fondos'), 195000::bigint, 'fondos de Javier 1,950.00');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'fondos'), 500000::bigint, 'fondos de Angelo 5,000.00');
select lives_ok($$select operacion.anular_pago('n903an', (select id from operacion.pago where monto_cent = 500000 order by id desc limit 1), 'pago capturado en cuenta equivocada')$$, 'anular_pago');
select is(operacion.pedido_saldo(pg_temp.pid('n903a')), 500000::bigint, 'anular el pago de 5,000 devuelve el por cobrar');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'fondos'), 0::bigint, 'y los fondos de Angelo bajan a cero');
select throws_ok($$select operacion.anular_pago('n903an2', (select id from operacion.pago where monto_cent = 500000 order by id desc limit 1), 'otra vez')$$, 'P0428', null, 'anular dos veces se rechaza');

-- cancelar_pedido (H-01 / CP24) ------------------------------------------------------------------------------------------------------
select operacion.crear_pedido('n903b', pg_temp.cid('N903 Cliente QA 1'), '[{"modelo":"N903 Modelo QA 50K","sabor":"Uva","piezas":30}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, '2026-11-03');
select throws_ok($$select operacion.cancelar_pedido('n903bx', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903b'), '')$$, '23502', null, 'cancelar exige motivo');
select operacion.confirmar_pedido('n903bc', pg_temp.pid('n903b'));
select is((select count(*)::int from operacion.reserva where origen_tipo = 'pedido' and origen_id = pg_temp.pid('n903b') and estado = 'activa'), 1, 'confirmado: reserva activa');
select operacion.marcar_empacado('n903be', pg_temp.pid('n903b'));
create temp table _antes as select pg_temp.piezas('N903 Modelo QA 50K') as p, pg_temp.valor('N903 Modelo QA 50K') as v;
select is((operacion.cancelar_pedido('n903bk', pg_temp.pid('n903b'), 'el cliente ya no lo quiere')->>'estado'), 'cancelado', 'cancelar: queda cancelado');
select is((select count(*)::int from operacion.reserva where origen_tipo = 'pedido' and origen_id = pg_temp.pid('n903b') and estado = 'activa'), 0, 'cancelar libera la reserva');
select is(pg_temp.piezas('N903 Modelo QA 50K'), (select p from _antes), 'cancelar no toca el inventario fisico');
select is(pg_temp.valor('N903 Modelo QA 50K'), (select v from _antes), 'ni su valor');
select is((operacion.cancelar_pedido('n903bk', pg_temp.pid('n903b'), 'el cliente ya no lo quiere')->>'estado'), 'cancelado', 'cancelar con la misma clave: mismo resultado');
select throws_ok($$select operacion.cancelar_pedido('n903bk2', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903b'), 'otra vez')$$, 'P0428', null, 'cancelar un pedido ya cancelado se rechaza');
select throws_ok($$select operacion.cancelar_pedido('n903ak', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a'), 'ya enviado')$$, 'P0428', null, 'un pedido enviado se anula, no se cancela');
-- ESPERADO-FALLA-HASTA: CP24 (se limpia empacado_at y aparece el aviso "desarmar paquete"). Vive en 990_pendientes_de_correccion.

-- F11: anular el pedido enviado de 40 piezas ---------------------------------------------------------------------------------------
create temp table _pre as select pg_temp.piezas('N903 Modelo QA 50K') as p, pg_temp.valor('N903 Modelo QA 50K') as v;
select is((operacion.anular_pedido('n903an9', pg_temp.pid('n903a'), 'cliente devolvio todo')->>'estado'), 'anulado', 'anular pedido enviado');
select is(pg_temp.piezas('N903 Modelo QA 50K') - (select p from _pre), 40, 'regresan 40 piezas');
select is(pg_temp.valor('N903 Modelo QA 50K') - (select v from _pre), 409000::bigint, 'regresan a su costo original: 4,090.00');
select is((select coalesce(sum(r.monto_cent), 0)::bigint from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id = pg_temp.pid('n903a')), 0::bigint, 'la renta de Omar del pedido queda en cero');
select is(operacion.pedido_cobrado(pg_temp.pid('n903a')), 0::bigint, 'anulado no se cobra');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.pid('n903a')), 3, 'las notas siguen guardadas (original, correccion de envio y recargo)');
select throws_ok($$select operacion.anular_pedido('n903an9b', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a'), 'otra vez')$$, 'P0428', null, 'anular dos veces se rechaza');
select throws_ok($$select operacion.anular_pedido('n903an9c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n903a'), '')$$, '23502', null, 'anular exige motivo');

select * from finish();
rollback;
