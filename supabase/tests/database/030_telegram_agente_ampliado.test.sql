-- pgTAP lane telegram-agente (segunda entrega): agente.ejecutar_ext, agente.simular, agente.consulta_ext, deshacer ampliado, actor del canal telegram. Datos sinteticos.
begin;
select no_plan();
select agente.registrar_miembro(5000001, 'angelo');
select agente.registrar_miembro(5000002, 'javier');
select set_config('rtm.canal', 'importacion', true);

-- Catalogo sintetico
select catalogo.asegurar_cliente('Tg Cliente', 'Javier');
select catalogo.asegurar_cliente('Tg Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('Tg Omar Persona', 'Tg Omar Persona');
select catalogo.asegurar_modelo('Tg Marca', 'Tg Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('Tg Modelo', 'Uva');
select catalogo.asegurar_sku('Tg Modelo', 'Menta');
select catalogo.fijar_costo('tg:k', 'Karen', 'Tg Modelo', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_costo('tg:k2', 'Isaac', 'Tg Modelo', 11000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('tg:p', 'Tg Cliente', 'Tg Modelo', 25000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('tg:m1', 'Tg Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 40, 400000, negocio.hoy() - 5);
select operacion.registrar_movimiento('tg:m2', 'Tg Modelo', 'Menta', 'bodega_omar', 'entrada_compra', 40, 400000, negocio.hoy() - 5);

select contabilidad.asentar_pendientes();
create temp table _base as select count(*)::int as rojas from contabilidad.comprobaciones() c where not c.ok and c.bloqueante;
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'Tg Modelo' $$;
create function pg_temp.sid(n text) returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = n $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'Tg Cliente' $$;

-- Actor del canal: sin autor no hay nada; con autor verificado el canal actua como ese socio
select throws_ok($$ select agente.ejecutar_ext('x:0', 'pedido_crear', '{}') $$, 'P0460', null, 'sin autor no se registra nada');
select throws_ok($$ select agente.ejecutar_ext('x:00', 'tipo_inventado', '{"autor":"angelo","telegram_user_id":5000001}') $$, 'P0460', null, 'tipo no soportado: nunca SQL libre');

select agente._actuar('{"autor":"angelo","telegram_user_id":5000001}');
select is((select operacion.actor_socio()), (select id from catalogo.socio where nombre = 'Angelo'), 'dentro de la transaccion marcada, el actor es el socio verificado');

-- Pedido: el precio lo resuelve el sistema (tabulador 25,000)
select is((agente.simular('ejecutar_ext', 'pedido_crear', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'cliente_id', pg_temp.cid(), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 24)))) -> 'efecto' ->> 'mercancia_cent')::bigint, 600000::bigint, 'la vista previa trae el importe del servidor: 24 x 250.00');
select is((select count(*)::int from operacion.pedido), 0, 'la simulacion no deja nada');
select is((agente.simular('ejecutar_ext', 'pedido_crear', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'cliente_id', pg_temp.cid(), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 24)))) ->> 'cuadra')::boolean, ((select rojas from _base) = 0), 'la vista previa informa el cuadre por dos vias (el inventario sembrado a mano ya deja C4 y C5 en rojo)');
select throws_ok($$ select agente.simular('ejecutar_ext', 'pedido_crear', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'cliente_id', pg_temp.cid(), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'piezas', 24)))) $$, 'P0460', null, 'sin sabor se rechaza y se pregunta');
select is((agente.ejecutar_ext('tg:p1', 'pedido_crear', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'cliente_id', pg_temp.cid(), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 24)))) ->> 'estado'), 'confirmado', 'pedido creado y confirmado');
select is((select count(*)::int from agente.hecho where tipo = 'pedido' and autor = 'javier'), 1, 'autor = el socio que escribe');
select is((agente.ejecutar_ext('tg:p1', 'pedido_crear', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'cliente_id', pg_temp.cid(), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 24)))) ->> 'repetido')::boolean, true, 'idempotente por clave');
select is((select count(*)::int from operacion.pedido), 1, 'un solo pedido');
-- Deshacer un pedido confirmado = cancelarlo
select is((agente.deshacer('tg:p1d', (select folio from agente.hecho where tipo = 'pedido'), 'javier', 5000002) ->> 'deshecho')::boolean, true, 'deshacer el pedido confirmado');
select is((select estado from operacion.pedido), 'cancelado', 'queda cancelado con su motivo');

-- Pedido, envio y entrega
select agente.ejecutar_ext('tg:p2', 'pedido_crear', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'cliente_id', pg_temp.cid(), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 20), jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Menta'), 'piezas', 5))));
select is((agente.ejecutar_ext('tg:p2e', 'pedido_enviar', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'pedido_folio', (select folio from operacion.pedido order by id desc limit 1), 'aceptar_avisos', true)) ->> 'pedido') like 'P-%', true, 'pedido enviado');
select is((select estado from operacion.pedido order by id desc limit 1), 'enviado', 'estado enviado');
select is((agente.ejecutar_ext('tg:p2g', 'pedido_entregar', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'pedido_folio', (select folio from operacion.pedido order by id desc limit 1))) ->> 'entregado')::boolean, true, 'pedido entregado');
select throws_ok($$ select agente.ejecutar_ext('tg:p2c', 'pedido_cancelar', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'pedido_folio', (select folio from operacion.pedido order by id desc limit 1), 'motivo', 'x')) $$, 'P0428', null, 'un pedido enviado no se cancela');
select throws_ok($$ select agente.ejecutar_ext('tg:p2z', 'pedido_enviar', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'pedido_folio', 'P-9999999')) $$, 'P0460', null, 'folio inexistente: se pregunta');

-- Cobro del pedido y cuadre por dos vias
select agente.ejecutar('tg:c1', 'pago_cliente', jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 625000, 'cliente_id', pg_temp.cid(), 'autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'Tg Cliente pago 6250'));
select is((select operacion.saldo_cliente(pg_temp.cid())), 0::bigint, 'el cobro deja el saldo del cliente en cero (25 piezas x 250)');

-- Compras. Regla del negocio que el agente respeta: a Karen se le paga completo antes de confirmar.
select agente.ejecutar_ext('tg:ok', 'orden_compra', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'proveedor', 'karen', 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 50))));
select throws_like($$ select agente.ejecutar_ext('tg:oka', 'compra_aprobar', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'compra_folio', (select folio from operacion.compra order by id desc limit 1))) $$, '%exige pago completo%', 'aprobar una compra a Karen sin pago completo se rechaza con el motivo de la base');
select is((agente.ejecutar_ext('tg:o1', 'orden_compra', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'proveedor', 'isaac', 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 50)))) ->> 'estado'), 'borrador', 'la orden de compra nace como borrador');
select is((agente.simular('ejecutar_ext', 'orden_compra', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'proveedor', 'isaac', 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 50)))) -> 'efecto' ->> 'mercancia_cent')::bigint, 550000::bigint, 'costo de lista del proveedor, lo pone el servidor');
select is((agente.ejecutar_ext('tg:o1a', 'compra_aprobar', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'compra_folio', (select folio from operacion.compra order by id desc limit 1))) ->> 'compra') like 'C-%', true, 'los socios aprueban');
select is((select estado from operacion.compra order by id desc limit 1), 'confirmada', 'confirmada');
select is((agente.ejecutar_ext('tg:o1e', 'compra_estado', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'compra_folio', (select folio from operacion.compra order by id desc limit 1), 'estado', 'enviada')) ->> 'compra') like 'C-%', true, 'paquete en trayecto');
select agente.ejecutar_ext('tg:o1l', 'compra_estado', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'compra_folio', (select folio from operacion.compra order by id desc limit 1), 'estado', 'llego_merida'));
select is((select estado from operacion.compra order by id desc limit 1), 'llego_merida', 'llego a Merida');
-- Recepcion parcial: 30 de 50
select agente.ejecutar_ext('tg:o1r', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'compra_folio', (select folio from operacion.compra order by id desc limit 1), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 30))));
select is((select sum(cantidad)::int from operacion.movimiento_inventario where tipo = 'entrada_compra' and evento_id in (select id from operacion.evento where clave_idem like 'tg:o1r%')), 30, 'solo entran las 30 piezas dictadas');
select throws_ok($$ select agente.ejecutar_ext('tg:o1x', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'compra_folio', (select folio from operacion.compra order by id desc limit 1), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Menta'), 'piezas', 1)))) $$, 'P0460', null, 'un renglon que no esta en la compra se rechaza');
select is((agente.ejecutar_ext('tg:k1', 'compra_crear', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'proveedor', 'isaac', 'guia_cent', 15000, 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Menta'), 'piezas', 10)))) ->> 'estado'), 'confirmada', 'compra registrada y confirmada');
select is((agente.deshacer('tg:k1d', (select folio from agente.hecho where tipo = 'compra'), 'javier', 5000002) ->> 'deshecho')::boolean, true, 'deshacer la compra la anula');

-- Merma y conteo
select is((agente.ejecutar_ext('tg:mm1', 'merma', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Menta'), 'piezas', 2, 'motivo', 'caja danada')) ->> 'folio') is not null, true, 'merma con motivo');
select throws_ok($$ select agente.ejecutar_ext('tg:mm2', 'merma', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Menta'), 'piezas', 2)) $$, 'P0460', null, 'sin motivo no hay merma');
select is((agente.deshacer('tg:mm1d', (select folio from agente.hecho where tipo = 'merma'), 'javier', 5000002) ->> 'deshecho')::boolean, true, 'la merma se deshace con reversa');
select is((agente.ejecutar_ext('tg:n1', 'conteo', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Menta'), 'piezas', 38)))) ->> 'folio') is not null, true, 'conteo fisico');
select throws_ok($$ select agente.deshacer('tg:n1d', (select folio from agente.hecho where tipo = 'conteo'), 'javier', 5000002) $$, 'P0460', null, 'el conteo no tiene reversa directa: el agente lo dice');

-- Servicios con tipo de cambio: el peso lo calcula la base (techo al peso entero)
select costos.registrar_tipo_cambio('tg:tc', negocio.hoy(), 18500000, 'manual');
select is((agente.simular('ejecutar_ext', 'gasto_servicio', '{"autor":"javier","telegram_user_id":5000002,"origen":"x","servicio":"openrouter","monto_usd_cent":2000,"pagado_por":"javier"}') -> 'efecto' ->> 'monto_cent')::bigint, 37000::bigint, '20.00 USD x 18.50 = 370.00 pesos');
select throws_ok($$ select agente.ejecutar_ext('tg:s0', 'gasto_servicio', '{"autor":"javier","telegram_user_id":5000002,"origen":"x","servicio":"vercel","monto_usd_cent":100,"monto_mxn_cent":100,"pagado_por":"javier"}') $$, 'P0460', null, 'dolares y pesos a la vez: se pregunta');
select is((agente.ejecutar_ext('tg:s1', 'gasto_servicio', '{"autor":"javier","telegram_user_id":5000002,"origen":"x","servicio":"openrouter","monto_usd_cent":2000,"pagado_por":"javier"}') ->> 'folio') like 'G-%', true, 'cargo registrado como gasto con folio');

-- Clientes y precios
select is((agente.ejecutar_ext('tg:cl1', 'cliente_alta', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x","nombre":"Tg Cliente Nuevo"}') ->> 'nombre'), 'Tg Cliente Nuevo', 'alta de cliente');
select throws_ok($$ select agente.ejecutar_ext('tg:cl2', 'cliente_alta', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x","nombre":"Tg Cliente Nuevo"}') $$, 'P0460', null, 'un cliente repetido no se duplica');
select is((agente.ejecutar_ext('tg:pr1', 'cliente_precio', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5000001, 'origen', 'x', 'cliente_id', (select id from catalogo.cliente where nombre_canonico = 'Tg Cliente Nuevo'), 'modelo_id', pg_temp.mid(), 'precio_cent', 24000)) ->> 'folio') is not null, true, 'precio del tabulador para el cliente nuevo');
select is((catalogo.precio_vigente((select id from catalogo.cliente where nombre_canonico = 'Tg Cliente Nuevo'), pg_temp.mid(), negocio.hoy())), 24000::bigint, 'el tabulador quedo con el precio');

-- Lote historico: fechas pasadas explicitas, vista previa con cuadre, idempotente por lote
create function pg_temp.lote() returns jsonb language sql as $$ select jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'lote', 'etiqueta', 'octubre', 'renglones', jsonb_build_array(
  jsonb_build_object('tipo', 'gasto', 'fecha', (negocio.hoy() - 20)::text, 'monto_cent', 50000, 'socio', 'javier', 'categoria', 'uber', 'concepto', 'uber'),
  jsonb_build_object('tipo', 'aportacion', 'fecha', (negocio.hoy() - 19)::text, 'monto_cent', 100000, 'socio', 'angelo', 'concepto', 'inicio'),
  jsonb_build_object('tipo', 'cobro', 'fecha', (negocio.hoy() - 18)::text, 'monto_cent', 10000, 'cuenta', 'efectivo', 'cliente_id', (select id from catalogo.cliente where nombre_canonico = 'Tg Cliente')))) $$;
select is((agente.simular('ejecutar_ext', 'lote_historico', pg_temp.lote()) ->> 'cuadra')::boolean, ((select rojas from _base) = 0), 'la vista previa del lote informa el cuadre');
select is((select count(*)::int from agente.hecho where tipo = 'lote_historico'), 0, 'la vista previa no escribe');
select is((agente.ejecutar_ext('tg:l1', 'lote_historico', pg_temp.lote()) ->> 'renglones')::int, 3, 'el lote registra 3 renglones');
select is((agente.ejecutar_ext('tg:l1', 'lote_historico', pg_temp.lote()) ->> 'repetido')::boolean, true, 'reenviar el lote no duplica');
select is((select count(*)::int from agente.hecho where tipo = 'lote_historico'), 3, 'cada renglon tiene su folio');
select is((select min(fecha_neg) from operacion.evento where clave_idem like 'tg:l1:%'), negocio.hoy() - 20, 'los movimientos llevan la fecha pasada explicita');
select throws_ok($$ select agente.ejecutar_ext('tg:l2', 'lote_historico', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5000002, 'origen', 'x', 'renglones', jsonb_build_array(jsonb_build_object('tipo', 'gasto', 'fecha', negocio.hoy()::text, 'monto_cent', 100, 'socio', 'javier')))) $$, 'P0460', null, 'un renglon sin fecha pasada se rechaza');
select contabilidad.asentar_pendientes();
select is((select count(*)::int from contabilidad.comprobaciones() c where not c.ok and c.bloqueante), (select rojas from _base), 'tras todo: el agente no abrio ninguna comprobacion nueva en rojo (dos vias)');

-- Actas: firma personal de cada socio
select throws_ok($$ select agente.ejecutar_ext('tg:a0', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x"}') $$, '42501', null, 'sin boton consumido por el socio no se firma (aunque no haya acta)');

-- Consultas nuevas
select is(jsonb_array_length(agente.consulta_ext('cuadra') -> 'lineas') > 0, true, 'cuadra: comprobaciones');
select is((agente.consulta_ext('pendientes') -> 'lineas' -> 0 ->> 'etiqueta'), 'Pedidos confirmados por enviar', 'pendientes');
select is(jsonb_array_length(agente.consulta_ext('saldos_socios') -> 'lineas'), 3, 'saldos de socios');
select is(jsonb_array_length(agente.consulta_ext('cobertura') -> 'lineas') >= 0, true, 'cobertura');
select is(jsonb_array_length(agente.consulta_ext('pedidos') -> 'lineas') >= 0, true, 'pedidos');
select is(jsonb_array_length(agente.consulta_ext('compras') -> 'lineas') >= 0, true, 'compras');
select is((agente.consulta_ext('reporte', null, 'mes') ->> 'titulo') like 'Reporte mes%', true, 'reporte en el grupo');
select is(jsonb_typeof(agente.consulta_ext('balance') -> 'lineas'), 'array', 'balance');
select is(jsonb_typeof(agente.consulta_ext('diario') -> 'lineas'), 'array', 'diario');
select throws_ok($$ select agente.consulta_ext('inventada') $$, '22023', null, 'consulta desconocida');

-- Limite de frecuencia
select agente.reclamar_mensaje(-100200, 9001);
select is(agente.mensajes_recientes(-100200, 60) >= 1, true, 'cuenta mensajes recientes del chat');

-- Permisos y RLS
select is(has_function_privilege('authenticated', 'agente.ejecutar_ext(text,text,jsonb)', 'EXECUTE'), false, 'la web no ejecuta el agente');
select is(has_function_privilege('anon', 'agente.simular(text,text,jsonb)', 'EXECUTE'), false, 'anon tampoco');
select is(has_function_privilege('servidor', 'agente.ejecutar_ext(text,text,jsonb)', 'EXECUTE'), true, 'el servidor si');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'agente' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada');
select * from finish();
rollback;
