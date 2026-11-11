-- pgTAP F2: pedidos surtidos pieza por pieza, nota tipo invoice (texto, folio, correcciones enlazadas), avisos no bloqueantes y paquetes.
-- Los esperados salen de los documentos del dueno (nota de Villa: 13,590.00 y 62 piezas; pedido de 50 piezas donde salen 40 cobra solo 40).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f2.pedidos@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('72222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f2.pedidos@example.test');
select set_config('request.jwt.claim.sub', '72222222-2222-2222-2222-222222222222', true);

create temp table _f as select ultimo as p0 from seguridad.contador_folio where serie = 'P';
create function pg_temp.fol(k int) returns text language sql as $$ select 'P-' || lpad(((select p0 from _f) + k)::text, 4, '0') $$;
create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

create function pg_temp.salidas() returns int language sql as $$ select coalesce(sum(-mi.cantidad), 0)::int from operacion.movimiento_inventario mi join catalogo.modelo m on m.id = mi.modelo_id where m.nombre_canonico like 'F2 %' and mi.tipo = 'salida_pedido' $$;
create function pg_temp.renta_n() returns int language sql as $$ select count(*)::int from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido p on p.id = l.pedido_id join catalogo.cliente c on c.id = p.cliente_id where c.nombre_canonico = 'F2 Villa' $$;
create function pg_temp.renta_cent() returns bigint language sql as $$ select coalesce(sum(r.monto_cent), 0)::bigint from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id join operacion.pedido p on p.id = l.pedido_id join catalogo.cliente c on c.id = p.cliente_id where c.nombre_canonico = 'F2 Villa' $$;
select catalogo.asegurar_cliente('F2 Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('F2 Omar Persona', 'F2 Omar Persona');
select catalogo.asegurar_cliente('F2 Villa', 'Javier');
select catalogo.asegurar_modelo('F2 Marca', 'F2 Jupiter 50K', 50000, 'ambas');
select catalogo.asegurar_modelo('F2 Marca', 'F2 DM 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('F2 Marca', 'F2 Fasta 40K', 40000, 'ambas');
select catalogo.asegurar_sku('F2 Jupiter 50K', 'Mango'); select catalogo.asegurar_sku('F2 Jupiter 50K', 'Uva');
select catalogo.asegurar_sku('F2 DM 15K', 'Mango'); select catalogo.asegurar_sku('F2 Fasta 40K', 'Mango');
select catalogo.fijar_costo('f2k1', 'Isaac', 'F2 Jupiter 50K', 23000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f2k2', 'Isaac', 'F2 DM 15K', 12000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f2k3', 'Isaac', 'F2 Fasta 40K', 12000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('f2r1', 'F2 Villa', 'F2 Jupiter 50K', 25000, '2026-11-01', 'chat');
select catalogo.fijar_precio('f2r2', 'F2 Villa', 'F2 DM 15K', 18500, '2026-11-01', 'chat');
select catalogo.fijar_precio('f2r3', 'F2 Villa', 'F2 Fasta 40K', 18500, '2026-11-01', 'chat');
-- Existencia en Bodega Omar (entradas de prueba al costo de lista).
select operacion.registrar_movimiento('f2m1', 'F2 Jupiter 50K', 'Mango', 'bodega_omar', 'entrada_compra', 30, 690000, '2026-11-08');
select operacion.registrar_movimiento('f2m1b', 'F2 Jupiter 50K', 'Uva', 'bodega_omar', 'entrada_compra', 30, 690000, '2026-11-08');
select operacion.registrar_movimiento('f2m2', 'F2 DM 15K', 'Mango', 'bodega_omar', 'entrada_compra', 100, 1200000, '2026-11-08');
select operacion.registrar_movimiento('f2m3', 'F2 Fasta 40K', 'Mango', 'bodega_omar', 'entrada_compra', 100, 1200000, '2026-11-08');

-- G1: nota de Villa. 28 x 250 + 24 x 185 + 10 x 185 + envio 300 = 13,590.00 (62 piezas) ------------------------------------------------------
select is((operacion.crear_pedido('f2v1', (select id from catalogo.cliente where nombre_canonico = 'F2 Villa'), '[
  {"modelo":"F2 Jupiter 50K","sabor":"Mango","piezas":16},{"modelo":"F2 Jupiter 50K","sabor":"Uva","piezas":12},
  {"modelo":"F2 DM 15K","sabor":"Mango","piezas":24},{"modelo":"F2 Fasta 40K","sabor":"Mango","piezas":10}]'::jsonb,
  'bodega_omar', null, 30000, 0, 0, '2026-11-10')->>'folio'), pg_temp.fol(1), 'el primer pedido toma el siguiente folio consecutivo');
select is((select count(*)::int from operacion.pedido_aviso where pedido_id = pg_temp.pid('f2v1')), 0, 'sin avisos: precios del tabulador, mas de 20 piezas, con existencia');
select is((select estado from operacion.pedido where id = pg_temp.pid('f2v1')), 'borrador', 'nace en borrador');
select is(pg_temp.salidas(), 0, 'crear no mueve inventario');
select lives_ok($$select operacion.confirmar_pedido('f2v1c', pg_temp.pid('f2v1'))$$, 'confirmar');
select is((select count(*)::int from operacion.reserva where origen_id = pg_temp.pid('f2v1') and estado = 'activa'), 4, 'confirmar solo reserva');
select is(operacion.disponible_sku((select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F2 Jupiter 50K') and s.nombre_canonico = 'Mango')), 14, 'disponible = fisico menos comprometido');
select is(pg_temp.salidas(), 0, 'confirmar no descuenta ni devenga');
select is(pg_temp.renta_n(), 0, 'ni renta antes de enviar');
select throws_ok($$select operacion.confirmar_pedido('f2v1c2', pg_temp.pid('f2v1'))$$, 'P0428', null, 'carrera: la segunda confirmacion del mismo pedido se rechaza (queda una)');
select is((select count(*)::int from operacion.aviso where codigo = 'paquete_por_empacar' and estado = 'abierta' and entidad_id = pg_temp.pid('f2v1')), 1, 'NT-010: paquete por empacar');
select lives_ok($$select operacion.marcar_empacado('f2v1e', pg_temp.pid('f2v1'))$$, 'marcar empacado');
select ok((select empacado_at is not null from operacion.pedido where id = pg_temp.pid('f2v1')), 'queda empacado');
select is((select estado from operacion.pedido where id = pg_temp.pid('f2v1')), 'confirmado', 'empacado aun no es enviado');

select is((operacion.enviar_pedido('f2v1s', pg_temp.pid('f2v1'), null, '{"paqueteria":"Castores","numero":"CAS-1","costo_cent":18000,"pagada_por":"Javier"}'::jsonb, '2026-11-10')->>'total_cent')::bigint, 1359000::bigint, 'G1: total a saldar 13,590.00');
select is((select texto_whatsapp from operacion.nota where pedido_id = pg_temp.pid('f2v1') and tipo = 'original'),
$t$Nota F2 Villa
F2 DM 15K 24pz x $185 = 4,440
F2 Fasta 40K 10pz x $185 = 1,850
F2 Jupiter 50K 28pz x $250 = 7,000
Envío $300

total a saldar 13,590.00$t$, 'G1: texto de WhatsApp con el formato del documento (por modelo)');
select is((select (snapshot_cliente->>'piezas_total')::int from operacion.nota where pedido_id = pg_temp.pid('f2v1')), 62, 'G1: 62 piezas');
select is((select (snapshot_interno->'cascada'->>'renta_cent')::bigint from operacion.nota where pedido_id = pg_temp.pid('f2v1')), 12400::bigint, 'G1: renta con origen bodega = 62 x $2.00 = $124.00');
select is(pg_temp.renta_cent(), 12400::bigint, 'la renta se devengo al enviar');
select is(pg_temp.salidas(), 62, 'salieron 62 piezas por sabor');
select ok((select (snapshot_interno->'comprobaciones'->'c1'->>'cuadra')::boolean and (snapshot_interno->'comprobaciones'->'c2'->>'cuadra')::boolean from operacion.nota where pedido_id = pg_temp.pid('f2v1')), 'C1 y C2 en verde');
select is((select (snapshot_interno->'cascada'->>'guia_cent')::bigint from operacion.nota where pedido_id = pg_temp.pid('f2v1')), 18000::bigint, 'la guia con costo real entra a la cascada');
select is((select (snapshot_interno->'cascada'->>'utilidad_cent')::bigint from operacion.nota where pedido_id = pg_temp.pid('f2v1')),
  1359000::bigint - (select sum(costo_valor_cent)::bigint from operacion.pedido_surtido where pedido_linea_id in (select id from operacion.pedido_linea where pedido_id = pg_temp.pid('f2v1'))) - 12400 - 18000, 'utilidad = total - costo - renta - guia');
select is((select count(*)::int from operacion.gasto where categoria = 'guia_envio' and pedido_id = pg_temp.pid('f2v1')), 1, 'la guia queda como gasto');
select is((select count(*)::int from operacion.aviso where codigo = 'paquete_enviado_con_guia' and entidad_id = pg_temp.pid('f2v1')), 1, 'NT-012: paquete enviado con guia');
select is((select count(*)::int from operacion.aviso where codigo = 'paquete_por_empacar' and estado = 'abierta' and entidad_id = pg_temp.pid('f2v1')), 0, 'el aviso de empacar se resuelve al enviar');
select is((select sha256 from operacion.nota_documento nd join operacion.nota n on n.id = nd.nota_id where n.pedido_id = pg_temp.pid('f2v1') and nd.variante = 'cliente_texto'),
  encode(sha256(convert_to((select texto_whatsapp from operacion.nota where pedido_id = pg_temp.pid('f2v1')), 'UTF8')), 'hex'), 'el texto de la nota queda guardado con su huella');

-- Nota inmutable y correcciones enlazadas ---------------------------------------------------------------------------------------------
select throws_ok($$update operacion.nota set total_cent = 1$$, '42501', null, 'la nota original no se actualiza');
select throws_ok($$update operacion.pedido_linea set precio_cent = 1$$, '42501', null, 'T4: la linea de un pedido enviado es inmutable');
select throws_ok($$select operacion.emitir_correccion('f2v1k0', pg_temp.pid('f2v1'), '')$$, '23502', null, 'la correccion exige motivo');
select is((operacion.emitir_correccion('f2v1k', pg_temp.pid('f2v1'), 'envio de 350', null, 35000)->>'folio_documento'), pg_temp.fol(1) || '-C1', 'la correccion se llama P-xxxx-C1');
select is((select total_cent from operacion.nota where folio_documento = pg_temp.fol(1)), 1359000::bigint, 'la original no cambia');
select is((select total_cent from operacion.nota where folio_documento = pg_temp.fol(1) || '-C1'), 1364000::bigint, 'la correccion vale 13,640.00');
select is((select corrige_nota_id from operacion.nota where folio_documento = pg_temp.fol(1) || '-C1'), (select id from operacion.nota where folio_documento = pg_temp.fol(1)), 'enlazada a la original');
select is(operacion.pedido_cobrado(pg_temp.pid('f2v1')), 1364000::bigint, 'lo cobrado sigue la nota vigente');
select is((operacion.emitir_correccion('f2v1k2', pg_temp.pid('f2v1'), 'precio de DM', jsonb_build_object((select id::text from operacion.pedido_linea where pedido_id = pg_temp.pid('f2v1') and modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F2 DM 15K')), 19000))->>'folio_documento'), pg_temp.fol(1) || '-C2', 'segunda correccion C2');
select is((select total_cent from operacion.nota where folio_documento = pg_temp.fol(1) || '-C2'), 1364000::bigint + 24 * 500, 'C2 conserva el envio corregido y cambia el precio');
select is((select count(*)::int from operacion.aviso where codigo = 'nota_corregida_o_anulada' and entidad_id = pg_temp.pid('f2v1')), 2, 'NT-008 por cada correccion');
select is(operacion.guardar_documento_nota((select id from operacion.nota where folio_documento = pg_temp.fol(1)), 'cliente_pdf', encode(sha256('pdf'::bytea), 'hex'), 'pdf'::bytea)->>'sha256', encode(sha256('pdf'::bytea), 'hex'), 'se guarda el PDF una vez');
select is(operacion.guardar_documento_nota((select id from operacion.nota where folio_documento = pg_temp.fol(1)), 'cliente_pdf', encode(sha256('otro'::bytea), 'hex'), 'otro'::bytea)->>'sha256', encode(sha256('pdf'::bytea), 'hex'), 'reimprimir entrega los mismos bytes');
select throws_ok($$update operacion.nota_documento set sha256 = repeat('0', 64)$$, '42501', null, 'los documentos guardados no se editan');

-- Folios consecutivos y rollback que no consume folio ---------------------------------------------------------------------------------
select is((operacion.crear_pedido('f2v2', (select id from catalogo.cliente where nombre_canonico = 'F2 Villa'), '[{"modelo":"F2 DM 15K","sabor":"Mango","piezas":50}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10')->>'folio'), pg_temp.fol(2), 'folio consecutivo sin hueco');

-- Pedido de 50 piezas donde salen 40 cobra solo 40 --------------------------------------------------------------------------------------
select operacion.confirmar_pedido('f2v2c', pg_temp.pid('f2v2'));
select is((operacion.enviar_pedido('f2v2s', pg_temp.pid('f2v2'), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.pid('f2v2')), 'piezas', 40)), null, '2026-11-10')->>'total_cent')::bigint,
  40 * 18500::bigint, 'pedido de 50 pz donde salen 40: cobra solo 40 (7,400.00)');
select is((select piezas_surtidas from operacion.pedido_linea where pedido_id = pg_temp.pid('f2v2')), 40, 'piezas surtidas = 40');
select is((select tipo || ':' || piezas from operacion.pedido_ajuste where pedido_id = pg_temp.pid('f2v2')), 'entrega_diferida:10', 'las 10 que no salieron quedan como entrega diferida');
select is((select (snapshot_interno->'comprobaciones'->'c2'->>'pendientes')::int from operacion.nota where pedido_id = pg_temp.pid('f2v2')), 10, 'C2 muestra las 10 pendientes');
select is((select (snapshot_interno->'cascada'->>'renta_cent')::bigint from operacion.nota where pedido_id = pg_temp.pid('f2v2')), 8000::bigint, 'la renta es de 40 piezas, no de 50');

-- Anular un pedido enviado: contramovimiento, la nota queda ---------------------------------------------------------------------------
select is((select piezas from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F2 DM 15K')), 36, 'antes de anular: 100 - 24 - 40');
select lives_ok($$select operacion.anular_pedido('f2v2a', pg_temp.pid('f2v2'), 'se cancelo con el cliente')$$, 'anular');
select is((select piezas from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F2 DM 15K')), 76, 'las piezas regresan');
select is((select coalesce(sum(r.monto_cent), 0)::bigint from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id = pg_temp.pid('f2v2')), 0::bigint, 'la renta de ese pedido queda en cero');
select is((select estado from operacion.pedido where id = pg_temp.pid('f2v2')), 'anulado', 'queda anulado');
select is(operacion.pedido_cobrado(pg_temp.pid('f2v2')), 0::bigint, 'anulado no se cobra');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.pid('f2v2')), 1, 'la nota original sigue guardada');
select throws_ok($$select operacion.reversar_evento('f2v2x', (select evento_envio_id from operacion.pedido where id = pg_temp.pid('f2v2')), 'directo')$$, '22023', null, 'la reversa generica no sirve para un pedido enviado');

-- Existencia insuficiente: T2 la rechaza y el pedido sigue confirmado ---------------------------------------------------------------------
select operacion.crear_pedido('f2v3', (select id from catalogo.cliente where nombre_canonico = 'F2 Villa'), '[{"modelo":"F2 Fasta 40K","sabor":"Mango","piezas":95}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10');
select is((select count(*)::int from operacion.pedido_aviso where pedido_id = pg_temp.pid('f2v3') and codigo = 'existencia_insuficiente'), 1, 'aviso: existencia insuficiente (disponible 90)');
select operacion.confirmar_pedido('f2v3c', pg_temp.pid('f2v3'));
select throws_ok($$select operacion.enviar_pedido('f2v3s0', pg_temp.pid('f2v3'), null, null, '2026-11-10')$$, 'P0427', null, 'avisos sin aceptar: pide Enviar de todos modos');
select throws_ok($$select operacion.enviar_pedido('f2v3s', pg_temp.pid('f2v3'), null, null, '2026-11-10', true)$$, 'P0423', null, 'con avisos aceptados, la existencia insuficiente igual la bloquea el inventario');
select is((select estado from operacion.pedido where id = pg_temp.pid('f2v3')), 'confirmado', 'el pedido sigue confirmado');

-- Avisos de precio: distinto del tabulador y venta bajo costo -----------------------------------------------------------------------------
select operacion.crear_pedido('f2v4', (select id from catalogo.cliente where nombre_canonico = 'F2 Villa'), '[{"modelo":"F2 DM 15K","sabor":"Mango","piezas":30,"precio_cent":12000,"motivo_precio":"cierre de inventario"}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10');
select is((select string_agg(codigo, ',' order by codigo) from operacion.pedido_aviso where pedido_id = pg_temp.pid('f2v4')), 'precio_distinto_tabulador,venta_bajo_costo', 'avisa precio distinto y venta a costo, sin bloquear');
select operacion.confirmar_pedido('f2v4c', pg_temp.pid('f2v4'));
select is((operacion.enviar_pedido('f2v4s', pg_temp.pid('f2v4'), null, null, '2026-11-10', true)->>'avisos_aceptados')::int, 2, 'Enviar de todos modos acepta los avisos');
select is((select decidido_por_nombre from operacion.pedido_aviso_decision d join operacion.pedido_aviso a on a.id = d.aviso_id where a.pedido_id = pg_temp.pid('f2v4') limit 1), 'Javier', 'queda registrado quien los acepto');
select is((select count(*)::int from operacion.aviso where codigo = 'pedido_enviado_con_excepcion' and entidad_id = pg_temp.pid('f2v4')), 1, 'NT-006: pedido enviado con excepcion');

-- Pedido directo de Isaac: sin renta y sin inventario (G1) -------------------------------------------------------------------------------
select operacion.crear_pedido('f2v5', (select id from catalogo.cliente where nombre_canonico = 'F2 Villa'), '[{"modelo":"F2 DM 15K","sabor":"Mango","piezas":25}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2026-11-10');
select operacion.confirmar_pedido('f2v5c', pg_temp.pid('f2v5'));
select is((select count(*)::int from operacion.reserva where origen_id = pg_temp.pid('f2v5')), 0, 'el directo no reserva en la bodega');
select is((operacion.enviar_pedido('f2v5s', pg_temp.pid('f2v5'), null, null, '2026-11-10')->>'renta_cent')::bigint, 0::bigint, 'G1: con origen directo de Isaac la renta es $0.00');
select is((select count(*)::int from operacion.movimiento_inventario where evento_id = (select evento_envio_id from operacion.pedido where id = pg_temp.pid('f2v5'))), 0, 'el directo no mueve la bodega');
select is((select costo_valor_cent from operacion.pedido_surtido where pedido_linea_id = (select id from operacion.pedido_linea where pedido_id = pg_temp.pid('f2v5'))), 25 * 12000::bigint, 'costo con el proveedor de origen');

-- Hechos de solo insercion -----------------------------------------------------------------------------------------------------------
select throws_ok($$delete from operacion.pedido_surtido$$, '42501', null, 'el surtido no se borra');
select throws_ok($$update operacion.renta_devengo set monto_cent = 1$$, '42501', null, 'la renta devengada no se edita');
select * from finish();
rollback;
