-- pgTAP Devoluciones: recepcion parcial de compras, devolucion de un cliente (nota de credito) y devolucion a un proveedor, con la identidad contable por dos vias.
-- Los esperados salen de aritmetica hecha a mano (ver comentarios), no del codigo: 2 sabores x 100 pz a $90.00, guia $200.00 repartida por piezas facturadas.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('dev.parcial@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('78888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dev.parcial@example.test');
select set_config('request.jwt.claim.sub', '78888888-8888-8888-8888-888888888888', true);

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.debe(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.haber(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.cuadra(p_clave text) returns boolean language sql as
  $$ select coalesce(sum(l.debe_cent) = sum(l.haber_cent), false) from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) $$;
create function pg_temp.ok(p_codigo text) returns boolean language sql as $$ select ok from contabilidad.comprobaciones() where codigo = $1 $$;
create function pg_temp.res(p_clave text, p_campo text) returns bigint language sql as $$ select (resultado->>$2)::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'DV Cliente' $$;
create function pg_temp.sku(p_sabor text) returns bigint language sql as
  $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DV Modelo 50K') and s.nombre_canonico = $1 $$;
create function pg_temp.exist(p_sabor text) returns int language sql as $$ select coalesce((select piezas from operacion.existencia_sku_ubicacion where sku_id = pg_temp.sku($1) and ubicacion = 'bodega_omar'), 0) $$;

select catalogo.asegurar_cliente('DV Omar', 'Javier');
select catalogo.asegurar_persona_bodega('DV Omar', 'DV Omar');
select catalogo.asegurar_cliente('DV Cliente', 'Javier');
select catalogo.asegurar_modelo('DV Marca', 'DV Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('DV Modelo 50K', 'Mango');
select catalogo.asegurar_sku('DV Modelo 50K', 'Uva');
select catalogo.fijar_costo('dvc1', 'Isaac', 'DV Modelo 50K', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('dvr1', 'DV Cliente', 'DV Modelo 50K', 15000, '2026-11-01', 'chat');
select pg_temp.flush();

-- Compra 200 pz (100 Mango, 100 Uva) a 90.00 + guia 200.00 = 18,200.00 ---------------------------------------------------------------------------
select is((operacion.crear_compra('dvo1', 'Isaac', '[{"modelo":"DV Modelo 50K","sabor":"Mango","pagadas":100},{"modelo":"DV Modelo 50K","sabor":"Uva","pagadas":100}]'::jsonb, 20000)->>'total_cent')::bigint, 1820000::bigint, 'la orden suma 18,200.00');
select operacion.confirmar_compra('dvo1c', pg_temp.res('dvo1', 'compra_id'));
create temp table _lin as select l.id, k.id as sku_id, sa.nombre_canonico as sabor from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.sabor sa on sa.id = k.sabor_id where l.compra_id = pg_temp.res('dvo1', 'compra_id');
select pg_temp.flush();
create temp table _base as select contabilidad.saldo('1320') as t1320, operacion.saldo_puente() as puente;

-- Recepcion parcial 1: llegan 60 Mango. Linea Mango: puesto = 90,000.00 + guia 100.00 = 9,100.00 x 100 pz -> 910,000 ; 60/100 = 546,000 ------------------
select is((operacion.recibir_compra_parcial('dvr_p1', pg_temp.res('dvo1', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', (select id from _lin where sabor = 'Mango'), 'sku_id', (select sku_id from _lin where sabor = 'Mango'), 'piezas', 60)))->>'valor_entrada_cent')::bigint,
  546000::bigint, 'la primera llegada entra por 60% del costo puesto de la linea: 5,460.00');
select is((select estado from operacion.compra where id = pg_temp.res('dvo1', 'compra_id')), 'recibida_parcial', 'la compra queda recibida en parte');
select is(pg_temp.exist('Mango'), 60, 'el inventario solo suma lo contado: 60 Mango');
select is(pg_temp.exist('Uva'), 0, 'lo que no llego no es existencia');
select throws_ok($$select operacion.recibir_compra('dvr_tot', pg_temp.res('dvo1', 'compra_id'), '[]'::jsonb)$$, 'P0428', null, 'la recepcion total ya no aplica a una compra recibida en parte');
select is((operacion.recibir_compra_parcial('dvr_p1', pg_temp.res('dvo1', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', (select id from _lin where sabor = 'Mango'), 'sku_id', (select sku_id from _lin where sabor = 'Mango'), 'piezas', 60)))->>'piezas_ahora')::int, 60, 'repetir la misma clave devuelve lo mismo y no vuelve a sumar');
select is(pg_temp.exist('Mango'), 60, 'la clave repetida no duplica el inventario');
select pg_temp.flush();
select is(pg_temp.debe('dvr_p1', '1310'), 546000::bigint, 'asiento: inventario entra por 5,460.00');
select is(pg_temp.haber('dvr_p1', '1320'), 546000::bigint, 'asiento: contra mercancia en transito');
select ok(pg_temp.cuadra('dvr_p1'), 'el asiento de la llegada parcial cuadra');
select ok((select ok from contabilidad.reproducir_saldos() where clave = 'transito'), 'la cuenta 1320 reconoce lo pendiente de una compra recibida en parte');
select is(contabilidad.saldo('1320') - (select t1320 from _base), -546000::bigint, 'la mercancia en transito baja solo por lo recibido');

-- Recepcion parcial 2: 40 Mango (completa la linea sin residuo) y 70 Uva ----------------------------------------------------------------------------
select is((operacion.recibir_compra_parcial('dvr_p2', pg_temp.res('dvo1', 'compra_id'), jsonb_build_array(
  jsonb_build_object('linea_id', (select id from _lin where sabor = 'Mango'), 'sku_id', (select sku_id from _lin where sabor = 'Mango'), 'piezas', 40),
  jsonb_build_object('linea_id', (select id from _lin where sabor = 'Uva'), 'sku_id', (select sku_id from _lin where sabor = 'Uva'), 'piezas', 70)))->>'valor_entrada_cent')::bigint,
  364000::bigint + 637000::bigint, 'segunda llegada: 3,640.00 (resto exacto de Mango) mas 6,370.00 (70% de Uva)');
select is((select sum(valor_entrada_cent)::bigint from operacion.lote lo join _lin l on l.id = lo.compra_linea_id where l.sabor = 'Mango'), 910000::bigint, 'la suma de las llegadas de Mango es EXACTAMENTE el costo puesto de la linea');
select is(pg_temp.exist('Mango') + pg_temp.exist('Uva'), 170, 'existencia 100 Mango y 70 Uva');
select throws_ok($$select operacion.cerrar_recepcion_compra('dvr_c0', pg_temp.res('dvo1', 'compra_id'))$$, '23502', null, 'cerrar con faltante exige motivo');
select is((operacion.cerrar_recepcion_compra('dvr_c1', pg_temp.res('dvo1', 'compra_id'), 'el proveedor no mando el resto')->>'diferencias')::int, 1, 'cerrar deja una diferencia');
select is((select tipo || ':' || piezas || ':' || valor_cent from operacion.compra_diferencia where compra_id = pg_temp.res('dvo1', 'compra_id')), 'faltante:30:273000', 'faltante de 30 Uva por 2,730.00 (9,100.00 - 6,370.00)');
select is(operacion.saldo_puente() - (select puente from _base), 273000::bigint, 'el puente suma el faltante');
select is((select estado from operacion.compra where id = pg_temp.res('dvo1', 'compra_id')), 'recibida', 'la compra queda recibida');
select pg_temp.flush();
select is(pg_temp.debe('dvr_c1', '1340'), 273000::bigint, 'cierre: el faltante va a la cuenta puente');
select is(pg_temp.haber('dvr_c1', '1320'), 273000::bigint, 'cierre: y sale de lo que estaba en transito');
select is(contabilidad.saldo('1320') - (select t1320 from _base), -1820000::bigint, 'la mercancia en transito queda en cero para la orden (1,820,000 entre llegadas y faltante)');
select ok(pg_temp.ok('C5') and pg_temp.ok('C18') and pg_temp.ok('C19') and pg_temp.ok('C4'), 'inventario, kardex, puente y auxiliares cuadran tras la recepcion parcial');

-- Pedido: 20 Mango y 10 Uva a 150.00; se cobran 4,000.00 --------------------------------------------------------------------------------------------
select operacion.crear_pedido('dvp1', pg_temp.cid(), '[{"modelo":"DV Modelo 50K","sabor":"Mango","piezas":20},{"modelo":"DV Modelo 50K","sabor":"Uva","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('dvp1c', pg_temp.res('dvp1', 'pedido_id'));
select is((operacion.enviar_pedido('dvp1s', pg_temp.res('dvp1', 'pedido_id'), null, null, negocio.hoy())->>'total_cent')::bigint, 450000::bigint, 'pedido de 30 pz a 150.00 = 4,500.00');
select operacion.registrar_pago('dvpg1', 'Efectivo', 400000, pg_temp.cid());
select is(operacion.pedido_saldo(pg_temp.res('dvp1', 'pedido_id')), 50000::bigint, 'saldo antes de la devolucion: 500.00');

-- Devolucion del cliente: 10 Mango buenos y 2 Uva danados --------------------------------------------------------------------------------------------
select throws_ok($$select operacion.registrar_devolucion_cliente('dvd0', pg_temp.res('dvp1', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.res('dvp1', 'pedido_id') and sku_id = pg_temp.sku('Mango')), 'sku_id', pg_temp.sku('Mango'), 'piezas', 21)), 'prueba')$$, '23514', null, 'no se devuelven mas piezas de las surtidas');
select throws_ok($$select operacion.registrar_devolucion_cliente('dvd0b', pg_temp.res('dvp1', 'pedido_id'), '[]'::jsonb, 'prueba')$$, '22023', null, 'una devolucion vacia se rechaza');
create temp table _antes as select pg_temp.exist('Mango') as mango, pg_temp.exist('Uva') as uva, (select valor_cent from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DV Modelo 50K')) as valor;
select is((operacion.registrar_devolucion_cliente('dvd1', pg_temp.res('dvp1', 'pedido_id'), jsonb_build_array(
  jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.res('dvp1', 'pedido_id') and sku_id = pg_temp.sku('Mango')), 'sku_id', pg_temp.sku('Mango'), 'piezas', 10),
  jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.res('dvp1', 'pedido_id') and sku_id = pg_temp.sku('Uva')), 'sku_id', pg_temp.sku('Uva'), 'piezas', 2, 'destino', 'merma')), 'producto danado')->>'monto_cent')::bigint,
  180000::bigint, 'credito: 12 pz x 150.00 = 1,800.00');
select is(pg_temp.res('dvd1', 'costo_cent'), 109200::bigint, 'costo devuelto: 10 Mango a 91.00 mas 2 Uva a 91.00 = 1,092.00');
select is(pg_temp.res('dvd1', 'liberado_cent'), 130000::bigint, 'el cliente habia pagado 4,000.00 y ahora debe 2,700.00: se liberan 1,300.00 a saldo a favor');
select is(operacion.pedido_saldo(pg_temp.res('dvp1', 'pedido_id')), 0::bigint, 'el pedido queda sin saldo');
select is(operacion.pedido_cobrado(pg_temp.res('dvp1', 'pedido_id')), 270000::bigint, 'lo cobrado es la nota menos la devolucion: 2,700.00');
select is(operacion.saldo_favor_cliente(pg_temp.cid()), 130000::bigint, 'saldo a favor del cliente: 1,300.00');
select is(pg_temp.exist('Mango') - (select mango from _antes), 10, 'regresan 10 Mango a la bodega');
select is(pg_temp.exist('Uva') - (select uva from _antes), 0, 'las 2 Uva danadas entran y salen como merma: sin cambio en existencia');
select is((select count(*)::int from operacion.movimiento_inventario where evento_id = pg_temp.ev('dvd1') and tipo = 'merma'), 1, 'queda el movimiento de merma de lo danado');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.res('dvp1', 'pedido_id')), 1, 'sigue habiendo una sola nota: la devolucion es un documento aparte');
select ok((select texto_whatsapp from operacion.devolucion_cliente where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'dvd1')) like 'NOTA DE CREDITO DV-%', 'la nota de credito lleva su texto');
select throws_ok($$select operacion.anular_pedido('dvx1', pg_temp.res('dvp1', 'pedido_id'), 'prueba')$$, 'P0428', null, 'un pedido con devoluciones vigentes no se anula: primero la devolucion');
select throws_ok($$update operacion.devolucion_cliente set monto_cent = 1$$, '42501', null, 'la devolucion no se edita');
select pg_temp.flush();
select is(pg_temp.debe('dvd1', '4220'), 180000::bigint, 'asiento: devoluciones sobre ventas 1,800.00');
select is(pg_temp.haber('dvd1', '1210'), 50000::bigint, 'asiento: clientes baja 1,800.00 por el credito y sube 1,300.00 por los pagos liberados (neto 500.00, el saldo que quedaba)');
select ok(pg_temp.cuadra('dvd1'), 'el asiento de la devolucion cuadra');
select is(pg_temp.debe('dvd1', '1310'), 91000::bigint, 'inventario: entran 1,092.00 de lo devuelto y salen 182.00 de lo danado (neto 910.00)');
select is(pg_temp.haber('dvd1', '5100'), 109200::bigint, 'costo de ventas: se reversa el costo de las 12 piezas devueltas');
select is(pg_temp.debe('dvd1', '5200'), 18200::bigint, 'merma: las 2 danadas se absorben al costo');
select ok(pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C14') and pg_temp.ok('C16') and pg_temp.ok('C18') and pg_temp.ok('CU1') and pg_temp.ok('CU2') and pg_temp.ok('CU3'), 'la identidad contable cuadra por dos vias tras la devolucion');
select ok((select ok from contabilidad.reproducir_saldos() where clave = 'clientes'), 'Clientes (1210) igual a la suma de saldos de pedidos');
select ok((select ok from contabilidad.reproducir_saldos() where clave = 'saldos_favor'), 'Saldos a favor (2410) igual a pagos sin aplicar');
select ok((api.explicar_cifra('pedido:saldo:' || pg_temp.res('dvp1', 'pedido_id')::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar este numero del saldo del pedido cuadra con la devolucion');
select ok((api.explicar_cifra('devolucion:cliente:' || (select id from operacion.devolucion_cliente limit 1)::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar este numero del credito cuadra');

-- Anular la devolucion --------------------------------------------------------------------------------------------------------------------------------
select is((operacion.anular_devolucion_cliente('dvd1a', (select id from operacion.devolucion_cliente where evento_id = pg_temp.ev('dvd1')), 'se capturo mal')->>'reaplicado_cent')::bigint, 130000::bigint, 'anular reaplica los 1,300.00 liberados');
select is(operacion.pedido_saldo(pg_temp.res('dvp1', 'pedido_id')), 50000::bigint, 'el saldo vuelve a 500.00');
select is(operacion.saldo_favor_cliente(pg_temp.cid()), 0::bigint, 'ya no hay saldo a favor');
select is(pg_temp.exist('Mango') - (select mango from _antes), 0, 'el kardex regresa: las 10 Mango vuelven a salir');
select throws_ok($$select operacion.anular_devolucion_cliente('dvd1b', (select id from operacion.devolucion_cliente where evento_id = pg_temp.ev('dvd1')), 'otra vez')$$, 'P0428', null, 'no se anula dos veces');
select is((select valor_cent from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DV Modelo 50K')), (select valor from _antes), 'el valor del inventario vuelve exactamente al de antes de devolver');
select pg_temp.flush();
select ok(pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C14') and pg_temp.ok('C16') and pg_temp.ok('C18') and pg_temp.ok('CU1') and pg_temp.ok('CU2'), 'tras anular, la identidad contable sigue cuadrando');
select is((select count(*)::int from contabilidad.asiento where evento_id = pg_temp.ev('dvd1a')), 1, 'la anulacion tiene su asiento');

-- Devolucion a un proveedor --------------------------------------------------------------------------------------------------------------------------
create temp table _prov as select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')) as saldo, (select valor_cent from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DV Modelo 50K')) as valor;
select throws_ok($$select operacion.devolver_a_proveedor('dvv0', 'Isaac', jsonb_build_array(jsonb_build_object('sku_id', pg_temp.sku('Uva'), 'piezas', 9999)), 'prueba')$$, 'P0423', null, 'no se devuelve mas de lo disponible');
select throws_ok($$select operacion.devolver_a_proveedor('dvv0b', 'Isaac', jsonb_build_array(jsonb_build_object('sku_id', pg_temp.sku('Uva'), 'piezas', 5)), '')$$, '23502', null, 'la devolucion al proveedor exige motivo');
select lives_ok($$select operacion.devolver_a_proveedor('dvv1', 'Isaac', jsonb_build_array(jsonb_build_object('sku_id', pg_temp.sku('Mango'), 'piezas', 5)), 'sabor equivocado', pg_temp.res('dvo1', 'compra_id'))$$, 'devolver 5 Mango a Isaac');
select is(pg_temp.res('dvv1', 'valor_cent'), 45500::bigint, 'valen 5 x 91.00 = 455.00 al costo promedio');
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')) - (select saldo from _prov), 45500::bigint, 'la cuenta con Isaac sube 455.00 a favor de la sociedad');
select is((select valor_cent from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DV Modelo 50K')) - (select valor from _prov), -45500::bigint, 'el inventario baja el mismo valor');
select pg_temp.flush();
select is(pg_temp.haber('dvv1', '1310'), 45500::bigint, 'asiento: sale inventario');
select is(pg_temp.debe('dvv1', '2110'), 45500::bigint, 'asiento: se acredita la cuenta de Isaac');
select ok(pg_temp.cuadra('dvv1'), 'el asiento de la devolucion al proveedor cuadra');
select ok(pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C7') and pg_temp.ok('C18') and pg_temp.ok('CU1') and pg_temp.ok('CU2') and pg_temp.ok('CU3'), 'proveedores, inventario y balance cuadran por dos vias');
select ok((api.explicar_cifra('devolucion:proveedor:' || (select id from operacion.devolucion_proveedor limit 1)::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar este numero del credito del proveedor cuadra');
select operacion.anular_devolucion_proveedor('dvv1a', (select id from operacion.devolucion_proveedor limit 1), 'se devolvio por error');
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Isaac')), (select saldo from _prov), 'anular regresa la cuenta con el proveedor');
select pg_temp.flush();
select ok(pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C7') and pg_temp.ok('C18') and pg_temp.ok('CU1'), 'tras anular, todo sigue cuadrando');

-- Recepcion que completa sola: otra orden recibida en dos llegadas exactas ------------------------------------------------------------------------------
select operacion.crear_compra('dvo2', 'Isaac', '[{"modelo":"DV Modelo 50K","sabor":"Mango","pagadas":10}]'::jsonb, 1000);
select operacion.confirmar_compra('dvo2c', pg_temp.res('dvo2', 'compra_id'));
select operacion.recibir_compra_parcial('dvs1', pg_temp.res('dvo2', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.compra_linea where compra_id = pg_temp.res('dvo2', 'compra_id')), 'sku_id', pg_temp.sku('Mango'), 'piezas', 3)));
select is((operacion.recibir_compra_parcial('dvs2', pg_temp.res('dvo2', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.compra_linea where compra_id = pg_temp.res('dvo2', 'compra_id')), 'sku_id', pg_temp.sku('Mango'), 'piezas', 7)))->>'estado'), 'recibida', 'al completar todas las piezas la compra se cierra sola');
select is((select count(*)::int from operacion.compra_diferencia where compra_id = pg_temp.res('dvo2', 'compra_id')), 0, 'sin diferencias');
select is((select sum(valor_entrada_cent)::bigint from operacion.lote where compra_linea_id = (select id from operacion.compra_linea where compra_id = pg_temp.res('dvo2', 'compra_id'))), 91000::bigint, 'las dos llegadas suman 900.00 + guia 10.00 = 910.00');
select pg_temp.flush();
select ok(pg_temp.ok('C3') and pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C10') and pg_temp.ok('C18') and pg_temp.ok('CU1') and pg_temp.ok('CU2') and pg_temp.ok('CU3'), 'identidad contable completa al final de la prueba');
select ok((select ok from contabilidad.reproducir_saldos() where clave = 'transito'), 'la mercancia en transito cuadra al final');


-- API: lecturas y envoltorios -----------------------------------------------------------------------------------------------------------------------
select is(jsonb_array_length(api.compra_recepcion(pg_temp.res('dvo1', 'compra_id'))->'lineas'), 2, 'api.compra_recepcion: una fila por linea');
select is((select (x->>'pendientes')::int from jsonb_array_elements(api.compra_recepcion(pg_temp.res('dvo1', 'compra_id'))->'lineas') x where x->>'sabor' = 'Uva'), 30, 'api.compra_recepcion: faltaron 30 Uva');
select is(jsonb_array_length(api.compra_recepcion(pg_temp.res('dvo1', 'compra_id'))->'llegadas'), 3, 'api.compra_recepcion: tres llegadas de lote (60 Mango, 40 Mango, 70 Uva)');
select is((api.compra_detalle(pg_temp.res('dvo1', 'compra_id'))->'lineas'->0->'lote'->>'llegadas')::int, 2, 'api.compra_detalle ya no falla con varios lotes por linea');
select ok(jsonb_array_length(api.devoluciones_lista()->'clientes') >= 1 and jsonb_array_length(api.devoluciones_lista()->'proveedores') >= 1, 'api.devoluciones_lista trae ambas');
select is((api.pedido_devoluciones(pg_temp.res('dvp1', 'pedido_id'))->>'puede')::boolean, true, 'api.pedido_devoluciones: el pedido enviado de bodega admite devolucion');
select is((select sum((x->>'disponibles_devolver')::int) from jsonb_array_elements(api.pedido_devoluciones(pg_temp.res('dvp1', 'pedido_id'))->'renglones') x)::int, 30, 'tras anular la devolucion se pueden devolver las 30 piezas');
select is((api.registrar_devolucion_cliente('dvw1', pg_temp.res('dvp1', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.res('dvp1', 'pedido_id') and sku_id = pg_temp.sku('Mango')), 'sku_id', pg_temp.sku('Mango'), 'piezas', 1)), 'por la API')->>'monto_cent')::bigint,
  15000::bigint, 'el envoltorio api.registrar_devolucion_cliente funciona igual: 1 pz a 150.00');
select pg_temp.flush();
select ok(pg_temp.ok('C4') and pg_temp.ok('C14') and pg_temp.ok('CU1'), 'la identidad sigue cuadrando tras la devolucion hecha por la API');

select * from finish();
rollback;
