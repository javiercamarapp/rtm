-- pgTAP Devoluciones, hallazgos del verificador: (1) la utilidad del periodo (base del reparto entre socios) resta las devoluciones, (2) un pedido con descuento
-- se puede devolver completo (el descuento se devuelve en proporcion), (3) la merma de una devolucion danada sale al valor con el que entro (pedido y libro coinciden).
-- Esperados a mano: modelo a costo 90.00, precio 150.00 (utilidad 60.00 por pieza).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('dev.hallazgos@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('79999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dev.hallazgos@example.test');
select set_config('request.jwt.claim.sub', '79999999-9999-9999-9999-999999999999', true);

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.debe(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.haber(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.ok(p_codigo text) returns boolean language sql as $$ select ok from contabilidad.comprobaciones() where codigo = $1 $$;
create function pg_temp.res(p_clave text, p_campo text) returns bigint language sql as $$ select (resultado->>$2)::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'HZ Cliente' $$;
create function pg_temp.sku(p_sabor text) returns bigint language sql as
  $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'HZ Modelo 50K') and s.nombre_canonico = $1 $$;
create function pg_temp.lin(p_pedido bigint, p_sabor text) returns bigint language sql as $$ select id from operacion.pedido_linea where pedido_id = $1 and sku_id = pg_temp.sku($2) $$;
create function pg_temp.util() returns bigint language sql as $$ select (operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_pedidos_cent')::bigint $$;

select catalogo.asegurar_cliente('HZ Omar', 'Javier');
select catalogo.asegurar_persona_bodega('HZ Omar', 'HZ Omar');
select catalogo.asegurar_cliente('HZ Cliente', 'Javier');
select catalogo.asegurar_modelo('HZ Marca', 'HZ Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('HZ Modelo 50K', 'Mango');
select catalogo.fijar_costo('hzc1', 'Isaac', 'HZ Modelo 50K', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('hzr1', 'HZ Cliente', 'HZ Modelo 50K', 15000, '2026-11-01', 'chat');
select pg_temp.flush();

-- Compra de 200 pz a 90.00 (sin guia) y recepcion total ---------------------------------------------------------------------------------------------
select operacion.crear_compra('hzo1', 'Isaac', '[{"modelo":"HZ Modelo 50K","sabor":"Mango","pagadas":200}]'::jsonb, 0);
select operacion.confirmar_compra('hzo1c', pg_temp.res('hzo1', 'compra_id'));
create temp table _l1 as select l.id as linea_id, l.sku_id from operacion.compra_linea l where l.compra_id = pg_temp.res('hzo1', 'compra_id');
select operacion.recibir_compra_parcial('hzo1r', pg_temp.res('hzo1', 'compra_id'), (select jsonb_agg(jsonb_build_object('linea_id', linea_id, 'sku_id', sku_id, 'piezas', 200)) from _l1));
select pg_temp.flush();

-- 1. Utilidad del periodo y devoluciones -------------------------------------------------------------------------------------------------------------
select operacion.crear_pedido('hzp1', pg_temp.cid(), '[{"modelo":"HZ Modelo 50K","sabor":"Mango","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('hzp1c', pg_temp.res('hzp1', 'pedido_id'));
select operacion.enviar_pedido('hzp1s', pg_temp.res('hzp1', 'pedido_id'), null, null, negocio.hoy(), p_aceptar_avisos => true);
select operacion.registrar_pago('hzpg1', 'Efectivo', 300000, pg_temp.cid());
create temp table _u0 as select pg_temp.util() as u;
create temp table _c0 as select (operacion.cascada_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint as u;

-- Danada 10 pz: credito 1,500.00; el costo de 10 pz (900.00) ya salio al venderse y sigue siendo costo -> la utilidad baja el credito completo (1,500.00).
select is((operacion.registrar_devolucion_cliente('hzd1', pg_temp.res('hzp1', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('hzp1', 'pedido_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 10, 'destino', 'merma')), 'danado')->>'monto_cent')::bigint,
  150000::bigint, 'credito de la devolucion danada: 10 pz x 150.00');
select is(pg_temp.util() - (select u from _u0), -150000::bigint, 'la utilidad del periodo baja el credito completo cuando lo devuelto esta danado (antes no se movia)');
select is((operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'devoluciones_cent')::bigint, -150000::bigint, 'el desglose muestra las devoluciones del periodo');
select is((operacion.cascada_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint - (select u from _c0), -150000::bigint, 'la base de la cascada entre socios baja igual: ya no reparte la utilidad bruta');

-- En buen estado 5 pz: credito 750.00 menos el costo que regresa al inventario (5 x 90.00 = 450.00) = baja 300.00.
select is((operacion.registrar_devolucion_cliente('hzd2', pg_temp.res('hzp1', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('hzp1', 'pedido_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 5)), 'no lo queria')->>'monto_cent')::bigint,
  75000::bigint, 'credito de 5 pz en buen estado: 750.00');
select is(pg_temp.util() - (select u from _u0), -150000::bigint - 30000::bigint, 'en buen estado solo baja credito menos el costo que vuelve a inventario (300.00)');
select ok((api.explicar_cifra('cascada:utilidad:2000-01-01:' || negocio.hoy()::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar la utilidad neta del periodo cuadra con las devoluciones');

-- Anular la segunda: la utilidad regresa (misma fecha: neto cero) --------------------------------------------------------------------------------
select operacion.anular_devolucion_cliente('hzd2a', (select id from operacion.devolucion_cliente where evento_id = pg_temp.ev('hzd2')), 'error');
select is(pg_temp.util() - (select u from _u0), -150000::bigint, 'anulada una devolucion, su efecto en la utilidad se contrarresta');

-- 2. Merma al valor con el que entro (aunque el promedio ya cambio) ------------------------------------------------------------------------------------
select operacion.crear_pedido('hzp2', pg_temp.cid(), '[{"modelo":"HZ Modelo 50K","sabor":"Mango","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('hzp2c', pg_temp.res('hzp2', 'pedido_id'));
select operacion.enviar_pedido('hzp2s', pg_temp.res('hzp2', 'pedido_id'), null, null, negocio.hoy(), p_aceptar_avisos => true);
-- La compra nueva a 120.00 llega DESPUES de la venta y ANTES de la devolucion: el promedio vigente ya no es el valor original (valor original 91.00 por pieza contra el promedio ya mezclado con piezas a 120.00).
select catalogo.fijar_costo('hzc2', 'Isaac', 'HZ Modelo 50K', 12000, '2026-11-02', 'prueba');
select operacion.crear_compra('hzo2', 'Isaac', '[{"modelo":"HZ Modelo 50K","sabor":"Mango","pagadas":50}]'::jsonb, 0);
select operacion.confirmar_compra('hzo2c', pg_temp.res('hzo2', 'compra_id'));
create temp table _l2 as select l.id as linea_id, l.sku_id from operacion.compra_linea l where l.compra_id = pg_temp.res('hzo2', 'compra_id');
select operacion.recibir_compra_parcial('hzo2r', pg_temp.res('hzo2', 'compra_id'), (select jsonb_agg(jsonb_build_object('linea_id', linea_id, 'sku_id', sku_id, 'piezas', 50)) from _l2));
create temp table _p2 as select (select -sum(m.valor_cent) from operacion.movimiento_inventario m where m.evento_id = pg_temp.ev('hzp2s') and m.tipo = 'salida_pedido')::bigint as costo_salida;
select operacion.registrar_devolucion_cliente('hzd3', pg_temp.res('hzp2', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('hzp2', 'pedido_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 10, 'destino', 'merma')), 'danado');
select is((select -m.valor_cent from operacion.movimiento_inventario m where m.evento_id = pg_temp.ev('hzd3') and m.tipo = 'merma')::bigint,
  (select valor_cent from operacion.movimiento_inventario m where m.evento_id = pg_temp.ev('hzd3') and m.tipo = 'devolucion')::bigint, 'la merma sale por lo mismo que entro la devolucion (no al promedio vigente)');
select pg_temp.flush();
select is(pg_temp.debe('hzd3', '5200'), pg_temp.haber('hzd3', '5100'), 'libro: la merma (5200) es igual al costo que regreso (5100); el costo neto del pedido no cambia');
select is((api.pedido_devoluciones(pg_temp.res('hzp2', 'pedido_id'))->'cascada_neta'->>'merma_cent')::bigint, pg_temp.debe('hzd3', '5200'), 'pedido y libro muestran la misma merma');
select ok(pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C14') and pg_temp.ok('C16') and pg_temp.ok('C18'), 'las identidades contables siguen cuadrando');

-- 3. Pedido con descuento: se devuelve completo -------------------------------------------------------------------------------------------------------
-- 30 pz a 150.00 = 4,500.00 + envio 100.00 - descuento 500.00 = 4,100.00, pagado completo.
select operacion.crear_pedido('hzp3', pg_temp.cid(), '[{"modelo":"HZ Modelo 50K","sabor":"Mango","piezas":30}]'::jsonb, 'bodega_omar', null, 10000, 50000, 0, negocio.hoy());
select operacion.confirmar_pedido('hzp3c', pg_temp.res('hzp3', 'pedido_id'));
select is((operacion.enviar_pedido('hzp3s', pg_temp.res('hzp3', 'pedido_id'), null, null, negocio.hoy(), p_aceptar_avisos => true)->>'total_cent')::bigint, 410000::bigint, 'pedido con envio y descuento: 4,100.00');
select operacion.registrar_pago('hzpg3', 'Efectivo', 410000, pg_temp.cid());
-- Primera mitad: 15 pz = 2,250.00 brutos; descuento proporcional 250.00 -> credito 2,000.00.
select is((operacion.registrar_devolucion_cliente('hzd4', pg_temp.res('hzp3', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('hzp3', 'pedido_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 15)), 'mitad')->>'monto_cent')::bigint,
  200000::bigint, 'primera mitad: 2,250.00 menos 250.00 del descuento en proporcion = 2,000.00');
-- Segunda mitad: ultimas 15 pz; el credito acumulado debe ser exactamente 4,500.00 - 500.00 = 4,000.00 (antes fallaba con 23514).
select is((operacion.registrar_devolucion_cliente('hzd5', pg_temp.res('hzp3', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('hzp3', 'pedido_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 15)), 'resto')->>'monto_cent')::bigint,
  200000::bigint, 'las ultimas piezas se pueden devolver: otros 2,000.00');
select is(operacion.devuelto_pedido(pg_temp.res('hzp3', 'pedido_id')), 400000::bigint, 'devuelto el pedido completo: 4,000.00 (el envio de 100.00 no se devuelve)');
select is(operacion.pedido_cobrado(pg_temp.res('hzp3', 'pedido_id')), 10000::bigint, 'lo que queda cobrado es el envio: 100.00');
select is(operacion.pedido_saldo(pg_temp.res('hzp3', 'pedido_id')), 0::bigint, 'el saldo del pedido queda en cero (el excedente pagado vuelve a saldo a favor)');
select is((select sum(descuento_prorrateado_cent)::bigint from operacion.devolucion_cliente where pedido_id = pg_temp.res('hzp3', 'pedido_id')), 50000::bigint, 'devolver todo devuelve exactamente todo el descuento');
select ok((api.explicar_cifra('devolucion:cliente:' || (select id from operacion.devolucion_cliente where evento_id = pg_temp.ev('hzd4'))::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar este numero del credito con descuento cuadra');
select pg_temp.flush();
select is(pg_temp.debe('hzd4', '4220'), 200000::bigint, 'asiento: devoluciones sobre ventas por el credito neto del descuento');
select ok(pg_temp.ok('C4') and pg_temp.ok('C14') and pg_temp.ok('C16') and pg_temp.ok('C18') and pg_temp.ok('CU1') and pg_temp.ok('CU2') and pg_temp.ok('CU3'), 'la identidad contable cuadra tras devolver un pedido con descuento');
select throws_ok($$select operacion.registrar_devolucion_cliente('hzd6', pg_temp.res('hzp3', 'pedido_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('hzp3', 'pedido_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 1)), 'otra')$$, '23514', null, 'ya no se puede devolver mas de lo surtido');

select * from finish();
rollback;
