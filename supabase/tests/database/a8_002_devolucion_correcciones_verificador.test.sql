-- pgTAP de los hallazgos del verificador independiente sobre devoluciones. Cada caso reproduce el defecto (falla sin la migracion 20261113900600). Datos sinteticos.
-- Costo 90.00, precio 150.00 por pieza.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('vf.angelo@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('c9999999-9999-9999-9999-999999999901', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vf.angelo@example.test');
select set_config('request.jwt.claim.sub', 'c9999999-9999-9999-9999-999999999901', true);

create function pg_temp.res(p_clave text, p_campo text) returns bigint language sql as $$ select (resultado->>$2)::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'VF Cliente' $$;
create function pg_temp.sku(p_modelo text) returns bigint language sql as
  $$ select k.id from catalogo.sku k where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = $1) $$;
create function pg_temp.lin(p_pedido bigint) returns bigint language sql as $$ select id from operacion.pedido_linea where pedido_id = $1 $$;
-- Modelo nuevo con N piezas recibidas a 90.00.
create function pg_temp.prep(p_modelo text, p_n int) returns void language plpgsql as $$
begin
  perform catalogo.asegurar_modelo('VF Marca', p_modelo, 50000, 'ambas');
  perform catalogo.asegurar_sku(p_modelo, 'Uva');
  perform catalogo.fijar_costo('c' || p_modelo, 'Isaac', p_modelo, 9000, '2026-11-01', 'prueba');
  perform catalogo.fijar_precio('r' || p_modelo, 'VF Cliente', p_modelo, 15000, '2026-11-01', 'chat');
  perform operacion.crear_compra('o' || p_modelo, 'Isaac', jsonb_build_array(jsonb_build_object('modelo', p_modelo, 'sabor', 'Uva', 'pagadas', p_n)), 0);
  perform operacion.confirmar_compra('oc' || p_modelo, pg_temp.res('o' || p_modelo, 'compra_id'));
  perform operacion.recibir_compra_parcial('or' || p_modelo, pg_temp.res('o' || p_modelo, 'compra_id'),
    (select jsonb_agg(jsonb_build_object('linea_id', l.id, 'sku_id', l.sku_id, 'piezas', p_n)) from operacion.compra_linea l where l.compra_id = pg_temp.res('o' || p_modelo, 'compra_id')));
end $$;
-- Pedido enviado y pagado completo; devuelve el id.
create function pg_temp.vende(p_clave text, p_modelo text, p_n int, p_envio bigint, p_desc bigint) returns bigint language plpgsql as $$
declare v_id bigint; v_total bigint;
begin
  perform operacion.crear_pedido(p_clave, pg_temp.cid(), jsonb_build_array(jsonb_build_object('modelo', p_modelo, 'sabor', 'Uva', 'piezas', p_n)), 'bodega_omar', null, p_envio, p_desc, 0, negocio.hoy());
  v_id := pg_temp.res(p_clave, 'pedido_id');
  perform operacion.confirmar_pedido(p_clave || 'c', v_id);
  v_total := (operacion.enviar_pedido(p_clave || 's', v_id, null, null, negocio.hoy(), p_aceptar_avisos => true)->>'total_cent')::bigint;
  perform operacion.registrar_pago(p_clave || 'g', 'Efectivo', v_total, pg_temp.cid());
  return v_id;
end $$;
create function pg_temp.dev(p_clave text, p_pedido bigint, p_sku bigint, p_n int, p_destino text default 'inventario') returns jsonb language sql as
  $$ select operacion.registrar_devolucion_cliente($1, $2, jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin($2), 'sku_id', $3, 'piezas', $4, 'destino', $5)), 'prueba') $$;

select catalogo.asegurar_cliente('VF Omar', 'Javier');
select catalogo.asegurar_persona_bodega('VF Omar', 'VF Omar');
select catalogo.asegurar_cliente('VF Cliente', 'Javier');

-- 3 y 4. Conciliacion de Dropshipping, Movimientos e Historial netos de devoluciones --------------------------------------------------------------------------------
select pg_temp.prep('VF M4', 30);
create temp table _p4 as select pg_temp.vende('vfp4', 'VF M4', 10, 5000, 10000) as id;
select contabilidad.asentar_pendientes();
create temp table _a as select
  (operacion.movimientos_utilidad()->>'utilidad_pedidos_cent')::bigint as mov,
  (select (x->>'utilidad_cent')::bigint from jsonb_array_elements(operacion.historial_socio('Angelo')->'por_cliente') x where x->>'cliente' = 'VF Cliente') as cli,
  (select (x->>'venta_cent')::bigint from jsonb_array_elements(operacion.historial_socio('Angelo')->'por_modelo') x where x->>'modelo' = 'VF M4') as ven,
  (select (x->>'costo_cent')::bigint from jsonb_array_elements(operacion.historial_socio('Angelo')->'por_modelo') x where x->>'modelo' = 'VF M4') as cos,
  (operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint as per,
  (contabilidad.estado_resultados('2000-01-01', negocio.hoy())->>'utilidad_neta_cent')::bigint as libro;
select ok((operacion.ds_conciliacion('2000-01-01', negocio.hoy())->>'cuadra')::boolean, '3: antes de devolver, la conciliacion cuadra con el Estado de resultados');
-- 4 pz en buen estado + 2 danadas del pedido de 10 pz (envio 50.00, descuento 100.00): bruto 900.00, descuento 6/10 x 100.00 = 60.00 -> credito 840.00; regresan 4 pz (360.00 de costo)
select is((operacion.registrar_devolucion_cliente('vfd5', (select id from _p4), jsonb_build_array(
    jsonb_build_object('linea_id', pg_temp.lin((select id from _p4)), 'sku_id', pg_temp.sku('VF M4'), 'piezas', 4),
    jsonb_build_object('linea_id', pg_temp.lin((select id from _p4)), 'sku_id', pg_temp.sku('VF M4'), 'piezas', 2, 'destino', 'merma')), 'prueba')->>'monto_cent')::bigint, 84000::bigint, '3: credito 840.00');
select contabilidad.asentar_pendientes();
select ok((operacion.ds_conciliacion('2000-01-01', negocio.hoy())->>'cuadra')::boolean, '3: tras una devolucion de cliente la conciliacion de Dropshipping sigue cuadrando');
select is((operacion.ds_conciliacion('2000-01-01', negocio.hoy())->>'diferencia_cent')::bigint, 0::bigint, '3: diferencia en cero');
select is((operacion.movimientos_utilidad()->>'utilidad_pedidos_cent')::bigint - (select mov from _a), -(84000 - 36000)::bigint, '4: Movimientos > Utilidad de pedidos baja credito menos el costo que regreso (480.00)');
select is((operacion.movimientos_utilidad()->>'utilidad_pedidos_cent')::bigint - (operacion.movimientos_utilidad()->>'utilidad_total_cent')::bigint, 0::bigint, '4: la utilidad de pedidos y la del periodo coinciden (sin tomas ni gastos)') ;
select is((select (x->>'utilidad_cent')::bigint from jsonb_array_elements(operacion.historial_socio('Angelo')->'por_cliente') x where x->>'cliente' = 'VF Cliente') - (select cli from _a), -48000::bigint, '4: el historial por cliente es neto de devoluciones');
select is((select (x->>'venta_cent')::bigint from jsonb_array_elements(operacion.historial_socio('Angelo')->'por_modelo') x where x->>'modelo' = 'VF M4') - (select ven from _a), -90000::bigint, '4: historial por modelo: la venta baja lo devuelto (900.00 bruto)');
select is((select (x->>'costo_cent')::bigint from jsonb_array_elements(operacion.historial_socio('Angelo')->'por_modelo') x where x->>'modelo' = 'VF M4') - (select cos from _a), -36000::bigint, '4: historial por modelo: el costo baja lo que regreso a inventario');
select is((operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint - (select per from _a), -48000::bigint, '4: la base del reparto (utilidad del periodo) baja igual que el resumen: 480.00');

select is((contabilidad.estado_resultados('2000-01-01', negocio.hoy())->>'utilidad_neta_cent')::bigint - (select libro from _a), (operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint - (select per from _a), '4: el delta de utilidad del libro es igual al delta de operacion.utilidad_periodo');

-- 1. Bonificacion por paquete perdido: no es un descuento que se prorratee ----------------------------------------------------------------------------------
select pg_temp.prep('VF M1', 20);
create temp table _p1 as select pg_temp.vende('vfp1', 'VF M1', 5, 0, 0) as id;
select operacion.reportar_paquete_salida('vfq1', (select id from _p1), 'perdido', 'se extravio', jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin((select id from _p1)), 'piezas', 2)));
select operacion.resolver_paquete_incidente('vfq1r', pg_temp.res('vfq1', 'incidente_id'), 'sociedad', null, 'bonificar', 'la sociedad absorbe');
select is((pg_temp.dev('vfd1', (select id from _p1), pg_temp.sku('VF M1'), 1)->>'monto_cent')::bigint, 15000::bigint, '1: devolver 1 pieza entregada da el credito completo (150.00); la bonificacion de 300.00 no se prorratea como descuento');

-- 2. Las piezas perdidas no se devuelven; lo devuelto no se reporta como perdido -------------------------------------------------------------------------------------
-- 5 surtidas - 2 perdidas - 1 devuelta = 2 devolvibles
select throws_ok($$select pg_temp.dev('vfd2', (select id from _p1), pg_temp.sku('VF M1'), 3)$$, '23514', null, '2: no se pueden devolver las piezas ya perdidas (piezas fantasma y doble credito)');
select lives_ok($$select pg_temp.dev('vfd3', (select id from _p1), pg_temp.sku('VF M1'), 2)$$, '2: las 2 entregadas restantes si se devuelven');
select is((select (r->>'disponibles_devolver')::int from jsonb_array_elements(api.pedido_devoluciones((select id from _p1))->'renglones') r limit 1), 0, '2: la pantalla muestra 0 piezas por devolver');
select pg_temp.prep('VF M2', 20);
create temp table _p2 as select pg_temp.vende('vfp2', 'VF M2', 5, 0, 0) as id;
select pg_temp.dev('vfd4', (select id from _p2), pg_temp.sku('VF M2'), 4);
select throws_ok($$select operacion.reportar_paquete_salida('vfq2', (select id from _p2), 'perdido', 'x', jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin((select id from _p2)), 'piezas', 2)))$$, '23514', null, '2: no se reporta como perdida una pieza ya devuelta');

-- 5. Anular una devolucion con las piezas ya apartadas por otro pedido ------------------------------------------------------------------------------------------
select pg_temp.prep('VF M5', 10);
create temp table _p5 as select pg_temp.vende('vfp5', 'VF M5', 5, 0, 0) as id;
select pg_temp.dev('vfd6', (select id from _p5), pg_temp.sku('VF M5'), 5);
select operacion.crear_pedido('vfp6', pg_temp.cid(), '[{"modelo":"VF M5","sabor":"Uva","piezas":8}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('vfp6c', pg_temp.res('vfp6', 'pedido_id'));
select is(operacion.disponible_sku(pg_temp.sku('VF M5')), 2, '5: otro pedido aparto 8 de las 10 piezas: disponible 2');
select throws_ok($$select operacion.anular_devolucion_cliente('vfd6a', (select id from operacion.devolucion_cliente where evento_id = (select id from operacion.evento where clave_idem = 'vfd6')), 'error')$$, 'P0423', null, '5: anular se rechaza si dejaria disponible negativo');
select cmp_ok(operacion.disponible_sku(pg_temp.sku('VF M5')), '>=', 0, '5: el disponible no queda negativo');

-- 6. Documento de la devolucion: existencia y huella ---------------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.guardar_documento_devolucion('cliente', 999999, 'pdf', encode(sha256('abc'::bytea), 'hex'), 'abc'::bytea)$$, '22023', null, '6: una devolucion que no existe no recibe documento');
select throws_ok($$select operacion.guardar_documento_devolucion('cliente', (select id from operacion.devolucion_cliente limit 1), 'pdf', repeat('a', 64), 'abc'::bytea)$$, '23514', null, '6: una huella que no corresponde al contenido se rechaza');
select lives_ok($$select operacion.guardar_documento_devolucion('cliente', (select id from operacion.devolucion_cliente limit 1), 'pdf', encode(sha256('abc'::bytea), 'hex'), 'abc'::bytea)$$, '6: con huella correcta se guarda');

select * from finish();
rollback;
