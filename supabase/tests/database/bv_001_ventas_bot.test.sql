-- pgTAP bv_001: carril bot/ventas-compras. Guias y paqueterias (catalogo cerrado, enviar sin guia, captura posterior), pedido de dropshipping por el bot, envio y guias en lote,
-- cierre de compra con faltante, devolucion, paquete perdido, consultas de vencimientos y que el libro cuadra (comprobaciones bloqueantes en verde) tras cada operacion. Datos sinteticos "BV".
begin;
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select no_plan();
select agente.registrar_miembro(5130001, 'javier');
select agente.registrar_miembro(5130002, 'angelo');
select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_cliente('BV Lupita Soto', 'Javier');
select catalogo.asegurar_cliente('BV Memo Garcia', 'Javier');
select catalogo.asegurar_modelo('BV Marca', 'BV Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('BV Modelo', 'Uva');
select catalogo.asegurar_sku('BV Modelo', 'Mango');
select catalogo.fijar_costo('bv:k', 'Karen', 'BV Modelo', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_costo('bv:k2', 'Isaac', 'BV Modelo', 11000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('bv:p1', 'BV Lupita Soto', 'BV Modelo', 25000, negocio.hoy() - 30, 'chat');
select catalogo.fijar_precio('bv:p2', 'BV Memo Garcia', 'BV Modelo', 25000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('bv:m1', 'BV Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 60, 600000, negocio.hoy() - 5);
select operacion.registrar_movimiento('bv:m2', 'BV Modelo', 'Mango', 'bodega_omar', 'entrada_compra', 60, 600000, negocio.hoy() - 5);

create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.lin(p_sabor text, p_pz int) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_canonico = 'BV Modelo'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = p_sabor), 'piezas', p_pz)) $$;
create function pg_temp.args(p jsonb) returns jsonb language sql as $$ select jsonb_build_object('autor', 'javier', 'telegram_user_id', 5130001, 'origen', 'x') || p $$;
create function pg_temp.rojas() returns int language plpgsql as $$ declare n int; begin perform contabilidad.asentar_pendientes(); select count(*) into n from contabilidad.comprobaciones() c where not c.ok and c.bloqueante; return n; end $$;

-- ---------------------------------------------------------------- catalogo cerrado
select is(operacion.paqueteria_nombre('castores'), 'Castores', 'catalogo: Castores');
select is(operacion.paqueteria_nombre(' DHL '), 'DHL', 'catalogo: DHL con espacios');
select is(operacion.paqueteria_nombre('Estafeta'), 'Estafeta', 'catalogo: Estafeta');
select is(operacion.paqueteria_nombre('Pitic'), 'Pitic', 'catalogo: Pitic');
select is(operacion.paqueteria_nombre('Fedex'), null, 'catalogo cerrado: otra paqueteria no existe');
select is(has_function_privilege('anon', 'operacion.capturar_guia_pedido(text,bigint,text,text)', 'execute'), false, 'anon no captura guias');
select is(has_function_privilege('authenticated', 'agente.pedidos_para_envio(text)', 'execute'), false, 'authenticated no lee agente.pedidos_para_envio');
select is(has_function_privilege('servidor', 'agente.consulta_ventas(text,bigint)', 'execute'), true, 'servidor lee las consultas de ventas');

-- ---------------------------------------------------------------- pedido de bodega: se envia sin guia y la guia llega despues
select lives_ok($$select agente.ejecutar_ext('bv:b1', 'pedido_crear', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Lupita Soto'), 'plazo_dias', 7, 'lineas', pg_temp.lin('Uva', 12))))$$, 'pedido de bodega 1');
select lives_ok($$select agente.ejecutar_ext('bv:b2', 'pedido_crear', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Memo Garcia'), 'plazo_dias', 0, 'lineas', pg_temp.lin('Mango', 6))))$$, 'pedido de bodega 2');
select lives_ok($$select agente.ejecutar_ext('bv:b3', 'pedido_crear', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Memo Garcia'), 'plazo_dias', 15, 'lineas', pg_temp.lin('Uva', 3))))$$, 'pedido de bodega 3');
create function pg_temp.folio(p_clave text) returns text language sql as $$ select folio from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = p_clave) $$;
select is(jsonb_array_length(agente.pedidos_para_envio('por_enviar')), 3, 'tres pedidos confirmados por enviar');

select throws_ok($$select operacion.enviar_pedido('bv:x1', (select id from operacion.pedido where folio = pg_temp.folio('bv:b3')), null, '{"paqueteria":"Fedex","numero":"1"}'::jsonb)$$, 'P0471', null, 'enviar: paqueteria fuera del catalogo se rechaza');
select throws_ok($$select agente.ejecutar_ext('bv:x2', 'envio_lote', pg_temp.args(jsonb_build_object('paqueteria', 'Fedex', 'folios', jsonb_build_array(pg_temp.folio('bv:b3')))))$$, 'P0471', null, 'bot: envio en lote con paqueteria fuera del catalogo se rechaza');
select throws_ok($$select agente.ejecutar_ext('bv:x3', 'envio_lote', pg_temp.args(jsonb_build_object('paqueteria', 'DHL', 'folios', '[]'::jsonb)))$$, 'P0460', null, 'bot: sin folios no envia');

select throws_ok($$select agente.ejecutar_ext('bv:e0', 'envio_lote', pg_temp.args(jsonb_build_object('paqueteria', 'castores', 'folios', jsonb_build_array(pg_temp.folio('bv:b1')))))$$, 'P0427', null, 'bot: pedido con avisos sin aceptar: pregunta antes de enviar (P0427)');
select lives_ok($$select agente.ejecutar_ext('bv:e1', 'envio_lote', pg_temp.args(jsonb_build_object('aceptar_avisos', true, 'paqueteria', 'castores', 'folios', jsonb_build_array(pg_temp.folio('bv:b1'), pg_temp.folio('bv:b2'), 'ZZ-999'))))$$, 'bot: envio en lote de dos pedidos (el tercer folio no existe)');
select is((select estado from operacion.pedido where folio = pg_temp.folio('bv:b1')), 'enviado', 'envio_lote: el primer pedido salio');
select is((select estado from operacion.pedido where folio = pg_temp.folio('bv:b2')), 'enviado', 'envio_lote: el segundo pedido salio');
select is((select paqueteria from operacion.pedido where folio = pg_temp.folio('bv:b1')), 'Castores', 'envio_lote: queda la paqueteria del catalogo (sin exigir guia)');
select is((select count(*)::int from operacion.guia where pedido_id in (select id from operacion.pedido where folio in (pg_temp.folio('bv:b1'), pg_temp.folio('bv:b2')))), 0, 'envio_lote: no se invento ninguna guia');
select is(jsonb_array_length(agente.ejecutar_ext('bv:e1', 'envio_lote', pg_temp.args(jsonb_build_object('aceptar_avisos', true, 'paqueteria', 'castores', 'folios', jsonb_build_array(pg_temp.folio('bv:b1'), pg_temp.folio('bv:b2'), 'ZZ-999')))) -> 'enviados'), 2, 'envio_lote: repetir la indicacion no envia dos veces');
select is((select tipo from agente.hecho where clave_idem = 'bv:e1'), 'envio_lote', 'envio_lote deja su hecho en el libro del agente');
select is(jsonb_array_length(agente.pedidos_para_envio('sin_guia')), 2, 'dos pedidos enviados esperan su guia');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras enviar en lote');

select lives_ok($$select agente.ejecutar_ext('bv:g1', 'guias_lote', pg_temp.args(jsonb_build_object('guias', jsonb_build_array(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b1'), 'guia', 'BV-1001'), jsonb_build_object('pedido_folio', pg_temp.folio('bv:b2'), 'guia', 'BV-1002')))))$$, 'bot: captura de guias en lote');
select is((select numero from operacion.guia where pedido_id = (select id from operacion.pedido where folio = pg_temp.folio('bv:b1')) and sentido = 'salida'), 'BV-1001', 'guias_lote: la guia queda en su pedido');
select is((select paqueteria from operacion.guia where pedido_id = (select id from operacion.pedido where folio = pg_temp.folio('bv:b2')) and sentido = 'salida'), 'Castores', 'guias_lote: la guia toma la paqueteria del envio');
select is(jsonb_array_length(agente.pedidos_para_envio('sin_guia')), 0, 'ya no hay pedidos sin guia');
select lives_ok($$select agente.ejecutar_ext('bv:g2', 'guias_lote', pg_temp.args(jsonb_build_object('guias', jsonb_build_array(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b1'), 'guia', 'BV-1001')))))$$, 'bot: capturar la misma guia otra vez no falla');
select throws_ok($$select agente.ejecutar_ext('bv:g2b', 'guias_lote', pg_temp.args(jsonb_build_object('guias', jsonb_build_array(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b1'), 'guia', 'BV-2001')))))$$, 'P0460', null, 'bot: una guia distinta sobre una ya capturada no se reescribe (se cambia en el software)');
select is((select count(*)::int from operacion.guia where pedido_id = (select id from operacion.pedido where folio = pg_temp.folio('bv:b1')) and sentido = 'salida'), 1, 'la misma guia no se duplica');
select is((select numero from operacion.guia where pedido_id = (select id from operacion.pedido where folio = pg_temp.folio('bv:b1')) and sentido = 'salida'), 'BV-1001', 'la guia original queda intacta');
select throws_ok($$select agente.ejecutar_ext('bv:g3', 'guias_lote', pg_temp.args(jsonb_build_object('guias', jsonb_build_array(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b3'), 'guia', 'BV-3')))))$$, 'P0460', null, 'una guia de un pedido que no salio no se captura');
select throws_ok($$select agente.ejecutar_ext('bv:g4', 'deshacer_inexistente', '{}'::jsonb)$$, null, null, 'un tipo desconocido sigue rechazandose');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras capturar guias');
select throws_ok($$select agente.deshacer('bv:u1', (select folio from agente.hecho where clave_idem = 'bv:e1'), 'javier', 5130001)$$, 'P0460', null, 'envio_lote esta en la lista de lo no reversible');

-- ---------------------------------------------------------------- devolucion y paquete perdido (pedido enviado de bodega)
select lives_ok($$select agente.ejecutar_ext('bv:d1', 'devolucion', pg_temp.args(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b1'), 'lineas', pg_temp.lin('Uva', 2), 'destino', 'inventario', 'motivo', 'sabor equivocado')))$$, 'bot: devolucion de 2 piezas al inventario');
select is((select count(*)::int from operacion.devolucion_cliente where pedido_id = (select id from operacion.pedido where folio = pg_temp.folio('bv:b1'))), 1, 'la devolucion queda registrada');
select throws_ok($$select agente.ejecutar_ext('bv:d2', 'devolucion', pg_temp.args(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b1'), 'lineas', pg_temp.lin('Uva', 99), 'destino', 'inventario', 'motivo', 'x')))$$, null, null, 'no se devuelve mas de lo surtido');
select throws_ok($$select agente.ejecutar_ext('bv:d3', 'devolucion', pg_temp.args(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b1'), 'lineas', pg_temp.lin('Uva', 1), 'destino', 'inventario', 'motivo', '')))$$, '23502', null, 'la devolucion exige motivo');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras la devolucion');
select lives_ok($$select agente.ejecutar_ext('bv:pp1', 'paquete_perdido', pg_temp.args(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b2'), 'incidente', 'perdido', 'detalle', 'la paqueteria no lo entrego')))$$, 'bot: paquete perdido de todo el pedido');
select is((select count(*)::int from operacion.paquete_incidente where pedido_id = (select id from operacion.pedido where folio = pg_temp.folio('bv:b2'))), 1, 'el incidente queda registrado');
select throws_ok($$select agente.ejecutar_ext('bv:pp2', 'paquete_perdido', pg_temp.args(jsonb_build_object('pedido_folio', pg_temp.folio('bv:b3'), 'incidente', 'perdido', 'detalle', 'x')))$$, 'P0428', null, 'un pedido que no salio no reporta paquete perdido');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras el paquete perdido');

-- ---------------------------------------------------------------- dropshipping por el bot
select throws_ok($$select agente.ejecutar_ext('bv:s0', 'pedido_ds', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Lupita Soto'), 'origen_pedido', 'karen_directo', 'lineas', pg_temp.lin('Uva', 5))))$$, 'P0436', null, 'dropshipping: sin plazo no escribe');
select lives_ok($$select agente.ejecutar_ext('bv:s1', 'pedido_ds', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Lupita Soto'), 'origen_pedido', 'karen_directo', 'plazo_dias', 0, 'lineas', pg_temp.lin('Uva', 5))))$$, 'dropshipping de contado');
select lives_ok($$select agente.ejecutar_ext('bv:s2', 'pedido_ds', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Memo Garcia'), 'origen_pedido', 'isaac_directo', 'plazo_dias', 14, 'envio_cent', 5000, 'lineas', pg_temp.lin('Mango', 4))))$$, 'dropshipping a credito de 14 dias con envio');
select is((select p.plazo_dias from operacion.pedido p where p.id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s1')), 0, 'dropshipping contado: plazo 0');
select is((select p.plazo_dias from operacion.pedido p where p.id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s2')), 14, 'dropshipping credito: plazo 14');
select is((select p.estado from operacion.pedido p where p.id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s2')), 'confirmado', 'dropshipping: queda confirmado');
select is((select tipo_venta from operacion.pedido_ds where pedido_id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s2')), 'cliente', 'dropshipping: venta a cliente');
select matches(pg_temp.folio('bv:s2'), '^BM-\d{3}$', 'dropshipping: folio por iniciales del cliente (BM-nnn)');
select is((agente.ejecutar_ext('bv:s2', 'pedido_ds', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Memo Garcia'), 'origen_pedido', 'isaac_directo', 'plazo_dias', 14, 'envio_cent', 5000, 'lineas', pg_temp.lin('Mango', 4)))) ->> 'repetido')::boolean, true, 'dropshipping: la misma clave no duplica');
select is((agente.ejecutar_ext('bv:s3', 'pedido_ds', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Memo Garcia'), 'origen_pedido', 'isaac_directo', 'plazo_dias', 14, 'envio_cent', 5000, 'lineas', pg_temp.lin('Mango', 4)))) ->> 'posible_duplicado')::boolean, true, 'dropshipping: mismo contenido en 10 minutos pregunta antes de duplicar');
select is((agente.resumen_pedido_registrado((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s2')) ->> 'proveedor'), 'Isaac', 'resumen: el proveedor del dropshipping');
select is((agente.resumen_pedido_registrado((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s2')) ->> 'por_pagar_proveedor_con_pedido_cent')::bigint,
  (agente.resumen_pedido_registrado((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s2')) ->> 'por_pagar_proveedor_cent')::bigint + 44000, 'resumen: por pagar al proveedor con el pedido = antes + 4 x 110.00 (SQL)');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras el dropshipping');
select lives_ok($$select agente.deshacer('bv:u2', (select folio from agente.hecho where clave_idem = 'bv:s1'), 'javier', 5130001)$$, 'dropshipping: se deshace dentro de los 10 minutos');
select is((select p.estado from operacion.pedido p where p.id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bv:s1')), 'cancelado', 'dropshipping deshecho: pedido cancelado');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras deshacer');

-- ---------------------------------------------------------------- compra: llegada parcial y cierre con faltante
select lives_ok($$select agente.ejecutar_ext('bv:c1', 'compra_crear', pg_temp.args(jsonb_build_object('proveedor', 'isaac', 'lineas', pg_temp.lin('Uva', 20), 'guia_cent', 0)))$$, 'compra de 20 piezas');
select lives_ok($$select agente.ejecutar_ext('bv:c2', 'compra_recepcion', pg_temp.args(jsonb_build_object('compra_folio', (select resultado->>'folio' from seguridad.operacion where clave = 'bv:c1'), 'lineas', pg_temp.lin('Uva', 15))))$$, 'llegaron 15 de 20');
select is((select estado from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'bv:c1')), 'recibida_parcial', 'la compra sigue abierta');
select throws_ok($$select agente.ejecutar_ext('bv:c3', 'compra_recepcion', pg_temp.args(jsonb_build_object('compra_folio', (select resultado->>'folio' from seguridad.operacion where clave = 'bv:c1'), 'lineas', pg_temp.lin('Uva', 9))))$$, 'P0435', null, 'no se recibe mas de lo pedido (P0435)');
select lives_ok($$select agente.ejecutar_ext('bv:c4', 'compra_cierre', pg_temp.args(jsonb_build_object('compra_folio', (select resultado->>'folio' from seguridad.operacion where clave = 'bv:c1'), 'motivo', 'el proveedor no manda el resto')))$$, 'cierre con faltante');
select is((select estado from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'bv:c1')), 'recibida', 'la compra queda cerrada');
select throws_ok($$select agente.ejecutar_ext('bv:c5', 'compra_cierre', pg_temp.args(jsonb_build_object('compra_folio', (select resultado->>'folio' from seguridad.operacion where clave = 'bv:c1'), 'motivo', 'otra vez')))$$, 'P0428', null, 'una compra ya cerrada no se cierra de nuevo');
select is(pg_temp.rojas(), 0, 'el libro cuadra tras el cierre con faltante');

-- ---------------------------------------------------------------- consultas
select is(agente.consulta_ventas('vencimientos') ->> 'titulo', 'Vencimientos de pedidos a credito', 'consulta de vencimientos');
select ok(jsonb_array_length(agente.consulta_ventas('vencimientos') -> 'lineas') >= 1, 'hay al menos un pedido a credito por vencer');
select is(agente.consulta_ventas('pedidos_cliente', pg_temp.cli('BV Memo Garcia')) ->> 'titulo', 'Pedidos abiertos de BV Memo Garcia', 'pedidos abiertos de un cliente');
select ok(jsonb_array_length(agente.consulta_ventas('pedidos_cliente', pg_temp.cli('BV Memo Garcia')) -> 'lineas') >= 2, 'incluye sus pedidos y el por cobrar');
select throws_ok($$select agente.consulta_ventas('otra')$$, '22023', null, 'consulta desconocida');

-- ---------------------------------------------------------------- lecturas de la conversacion (a que pedido se aplica un cobro)
select is(jsonb_array_length(agente.pedidos_abiertos_cliente(pg_temp.cli('BV Lupita Soto'))), 1, 'pedidos abiertos de un cliente: solo los enviados con saldo');
select is((agente.pedidos_abiertos_cliente(pg_temp.cli('BV Lupita Soto')) -> 0 ->> 'folio'), pg_temp.folio('bv:b1'), 'pedidos abiertos: trae el folio');
select is(agente.saldo_cliente_agente(pg_temp.cli('BV Lupita Soto')), operacion.saldo_cliente(pg_temp.cli('BV Lupita Soto')), 'saldo del cliente: el mismo que el libro');
select is(has_function_privilege('authenticated', 'agente.pedidos_abiertos_cliente(bigint)', 'execute'), false, 'la web no lee las lecturas del bot');

-- ---------------------------------------------------------------- interruptor de escritura
update seguridad.interruptor set activo = false where clave = 'agente_escritura';
select throws_ok($$select agente.ejecutar_ext('bv:z1', 'envio_lote', pg_temp.args(jsonb_build_object('paqueteria', 'DHL', 'folios', jsonb_build_array(pg_temp.folio('bv:b3')))))$$, 'P0463', null, 'solo lectura: el envio en lote no escribe');
select throws_ok($$select agente.ejecutar_ext('bv:z2', 'pedido_ds', pg_temp.args(jsonb_build_object('cliente_id', pg_temp.cli('BV Lupita Soto'), 'origen_pedido', 'karen_directo', 'plazo_dias', 0, 'lineas', pg_temp.lin('Uva', 1))))$$, 'P0463', null, 'solo lectura: el dropshipping no escribe');
select * from finish();
rollback;
