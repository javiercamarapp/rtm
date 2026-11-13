-- pgTAP: la UTILIDAD por pedido (venta con envio cobrado menos TODO el costo: producto, envio del proveedor y otros directos), su 50/50 y la suma por periodo COINCIDEN con el Estado de resultados;
-- el envio de una compra de inventario se capitaliza al costo y sale a costo de ventas al venderse; lo que no es de un pedido (gastos) baja la utilidad del periodo; el saldo a favor con el
-- proveedor que no esta respaldado por utilidad es un anticipo. Datos sinteticos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('pyl.ang@example.test', 'socio', 'Angelo', true), ('pyl.jav@example.test', 'socio', 'Javier', true), ('pyl.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-8888888888a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pyl.ang@example.test'),
  ('88888888-8888-8888-8888-8888888888a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pyl.jav@example.test'),
  ('88888888-8888-8888-8888-8888888888a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pyl.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-8888888888a1' when 'Omar' then '88888888-8888-8888-8888-8888888888a3' else '88888888-8888-8888-8888-8888888888a2' end, true) $$;
select pg_temp.como('Angelo');

create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;

-- Apertura firmada por los dos (capital y cajas de efectivo) para que la sociedad pueda pagar con su caja.
create temp table _s as select (api.apertura_crear('pyl:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('pyl:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('pyl:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('pyl:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('pyl:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('pyl:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('pyl:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('pyl:f2', (select id from _s));
select pg_temp.como('Angelo');


select catalogo.asegurar_modelo('PYL Marca', 'PYL Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('PYL Modelo 25K', 'Fresa'), catalogo.asegurar_sku('PYL Modelo 25K', 'Mango');
select catalogo.fijar_costo('pyl-c1', 'Karen', 'PYL Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('pyl-c2', 'Isaac', 'PYL Modelo 25K', 10000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('PYL Cliente', 'Javier'); select catalogo.asegurar_cliente('PYL Persona Bodega', 'Javier');
select catalogo.fijar_precio('pyl-p1', 'PYL Cliente', 'PYL Modelo 25K', 15000, negocio.hoy() - 60, 'documento');
select api.registrar_persona_bodega('pyl:pb', (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('PYL Persona Bodega')));
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar('PYL Cliente') $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.er() returns jsonb language sql as $$ select contabilidad.estado_resultados(negocio.hoy() - 30, negocio.hoy() + 1) $$;
create function pg_temp.conc() returns jsonb language plpgsql as $$ begin set constraints all immediate; perform contabilidad.asentar_pendientes(); return api.ds_conciliacion(negocio.hoy() - 30, negocio.hoy() + 1); end $$;

-- (4) Compra de inventario a Isaac: 20 pzas x 100.00 = 2,000.00 y envio de 50.00 (pagado por Angelo). El envio se CAPITALIZA al costo del inventario: 2,050.00 / 20 = 102.50 por pieza.
select operacion.crear_compra('pyl-oc', 'Isaac', '[{"modelo":"PYL Modelo 25K","sabor":"Fresa","pagadas":20}]'::jsonb, 5000, 0, negocio.hoy() - 5, 'bodega', 'sociedad', 'Angelo');
create temp table _oc as select (resultado->>'compra_id')::bigint as id from seguridad.operacion where clave = 'pyl-oc';
select operacion.confirmar_compra('pyl-occ', (select id from _oc));
select operacion.marcar_compra_enviada('pyl-oce', (select id from _oc), '[]'::jsonb, null, negocio.hoy() - 4);
select operacion.registrar_guia_compra('pyl-ocg', (select id from _oc), 'Castores', 'PYL-OC1', negocio.hoy() - 2, negocio.hoy() - 4);
select operacion.marcar_llego_merida('pyl-ocm', (select id from _oc));
select operacion.recibir_compra('pyl-ocr', (select id from _oc), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.compra_linea where compra_id = (select id from _oc)), 'sabor', 'Fresa', 'piezas', 20)), negocio.hoy() - 2);
select is((select costo_prom_cent from operacion.existencia_modelo where piezas > 0 limit 1), 10250::bigint, '(4) el envio de la compra se capitaliza: costo del inventario 102.50 por pieza (100.00 + 2.50 de envio)');
select is(pg_temp.conc()->>'cuadra', 'true', 'con la compra recibida y sin ventas: la utilidad del periodo cuadra con el Estado de resultados (0 = 0)');
select is(contabilidad.saldo('1310'), 205000::bigint, '(4) el inventario del libro vale 2,050.00 (producto mas envio)');
select is(contabilidad.saldo('5100'), 0::bigint, '(4) y no hay costo de ventas hasta que se vende');
-- Venta de 10 piezas desde la bodega: el envio capitalizado SALE a costo de ventas al venderse.
select operacion.crear_pedido('pyl-inv', pg_temp.cli(), '[{"modelo":"PYL Modelo 25K","sabor":"Fresa","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy() - 1);
select operacion.confirmar_pedido('pyl-invc', pg_temp.ped('pyl-inv')); select operacion.enviar_pedido('pyl-inve', pg_temp.ped('pyl-inv'), null, null, negocio.hoy() - 1, true);
select is((select costo_valor_cent from operacion.pedido_surtido where pedido_linea_id in (select id from operacion.pedido_linea where pedido_id = pg_temp.ped('pyl-inv'))), 102500::bigint, '(4) las 10 piezas salen a 1,025.00 (con su parte del envio)');
select is(pg_temp.conc()->>'cuadra', 'true', 'pedido de inventario: utilidad por pedido (venta - costo con envio capitalizado - renta) = Estado de resultados');
select is(contabilidad.saldo('5100'), 102500::bigint, '(4) costo de ventas 1,025.00 en el libro (el envio de la compra sale a costo al venderse)');
select is(contabilidad.saldo('1310'), 102500::bigint, '(4) y el inventario restante vale 1,025.00');

-- Pedido de dropshipping con envio cobrado al cliente (ingreso), envio del proveedor (costo directo) y credito
select operacion.ds_crear_pedido('pyl-ds', pg_temp.cli(), '[{"modelo":"PYL Modelo 25K","sabor":"Mango","piezas":40}]'::jsonb, 'karen_directo', null, '{}'::jsonb, 'cliente', null, '73266', 30000);
select operacion.confirmar_pedido('pyl-dsc', pg_temp.ped('pyl-ds:ped'));
select operacion.enviar_pedido('pyl-dse', pg_temp.ped('pyl-ds:ped'), null, '{"paqueteria":"Castores","numero":"PYL-G1","costo_cent":25000,"pagada_por":"Angelo"}'::jsonb, null, true);
create temp table _u as select x from jsonb_array_elements(api.ds_utilidad()->'filas') x where (x->>'pedido_id')::bigint = pg_temp.ped('pyl-ds:ped');
-- venta = 40 x 150.00 = 6,000.00 + envio cobrado 300.00 + interes 10 % (600.00) = 6,900.00; costo = 40 x 89.29 = 3,571.60 + envio del proveedor 250.00 = 3,821.60; utilidad 3,078.40
select is((select (x->>'venta_cent')::bigint from _u), 690000::bigint, 'venta con el envio cobrado como ingreso y el interes del credito');
select is((select (x->>'costo_producto_cent')::bigint from _u), 357160::bigint, 'costo del producto 3,571.60');
select is((select (x->>'envio_proveedor_cent')::bigint from _u), 25000::bigint, 'envio del proveedor 250.00 (costo directo del pedido)');
select is((select (x->>'costo_cent')::bigint from _u), 382160::bigint, 'costo total del pedido 3,821.60');
select is((select (x->>'utilidad_cent')::bigint from _u), 307840::bigint, 'utilidad = venta menos TODO el costo = 3,078.40');
select is((select (y->>'utilidad_cent')::bigint from _u, jsonb_array_elements(x->'socios') y where y->>'socio' = 'Angelo'), 153920::bigint, 'mitad para Angelo: 1,539.20');
select is(pg_temp.conc()->>'cuadra', 'true', 'inventario + dropshipping: la suma de utilidades por pedido = Estado de resultados');
select is((pg_temp.conc()->>'utilidad_periodo_cent')::bigint, (pg_temp.conc()->>'utilidad_pedidos_cent')::bigint, 'sin gastos ni mermas, utilidad del periodo = suma de utilidades por pedido');
select is((pg_temp.conc()->>'utilidad_dropshipping_cent')::bigint + (pg_temp.conc()->>'utilidad_inventario_cent')::bigint, (pg_temp.conc()->>'utilidad_pedidos_cent')::bigint, 'dropshipping + inventario = total por pedido');
select is(pg_temp.er()->>'utilidad_neta_cent', (pg_temp.conc()->>'utilidad_periodo_cent'), 'la utilidad del periodo ES la utilidad neta del Estado de resultados');
-- Mermas, regalos a costo, servicios: no son de un pedido, bajan la utilidad del periodo, no la de los pedidos
select operacion.registrar_gasto_socio('pyl-g1', 'Angelo', 12345, 'otros', 'variable', negocio.hoy());
select is(pg_temp.conc()->>'cuadra', 'true', 'con un gasto del periodo sigue cuadrando: utilidad del periodo = pedidos - gastos');
select is((pg_temp.conc()->>'otros_no_pedido_cent')::bigint, -12345::bigint, 'los gastos aparecen aparte: -123.45');
select is((pg_temp.conc()->>'utilidad_periodo_cent')::bigint, (pg_temp.conc()->>'utilidad_pedidos_cent')::bigint - 12345, 'utilidad del periodo = utilidades por pedido menos gastos');
select is((api.ds_explicar_utilidad('dsu:resultado:' || (negocio.hoy() - 30)::text || ':' || (negocio.hoy() + 1)::text)->'comprobacion'->>'cuadra')::boolean, true, '"Explicar este numero" de la utilidad del periodo cuadra por dos vias (libro vs pedidos + gastos)');
select is((api.ds_explicar_utilidad('dsu:costo:-:-')->'comprobacion'->>'cuadra')::boolean, true, '"Explicar" del costo total del pedido cuadra (producto + envio + otros directos)');
select is((api.ds_explicar('ds:costo:dropshipping:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar costo (resumen) cuadra: mercancia, seguro, guias y renta');
select is((api.ds_explicar('ds:margen:todos:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar margen (resumen) cuadra');
select is((api.ds_explicar('ds:margen:todos:-:-')->>'valor')::bigint, (pg_temp.conc()->>'utilidad_pedidos_cent')::bigint, 'el margen del resumen es la utilidad por pedido');
create temp table _rm as select api.ds_reporte_mensual(1) as r;
select is((select (r->'meses'->0->'conciliacion'->>'cuadra')::boolean from _rm), true, 'el reporte mensual trae la conciliacion y cuadra');
select is((select (r->'meses'->0->'conciliacion'->>'utilidad_periodo_cent')::bigint from _rm), (pg_temp.conc()->>'utilidad_periodo_cent')::bigint, 'el reporte mensual muestra la misma utilidad del periodo');
select is((select sum((x->>'margen_cent')::bigint)::bigint from jsonb_array_elements(api.ds_desglose('origen')) x), (pg_temp.conc()->>'utilidad_pedidos_cent')::bigint, 'el desglose por origen suma la misma utilidad (margen = venta - costo total)');
select is((select sum(((x->>'venta_cent')::bigint - (x->>'costo_cent')::bigint))::bigint from jsonb_array_elements(api.ds_desglose('origen')) x), (pg_temp.conc()->>'utilidad_pedidos_cent')::bigint, 'desglose por origen: venta - costo = utilidad');
select is(pg_temp.fallan(), '', 'libro conciliado (C1..C24, CU1..CU3) con compra de inventario, ventas, envios y gastos');
-- Anticipo al proveedor: un pago de la sociedad por encima de lo que se debe NO es utilidad
select operacion.ds_pagar_proveedor('pyl-pa', 'Karen', 1000000, 'sociedad', null, null, null);
create temp table _cp as select api.ds_cuenta_proveedor('Karen') as c;
select is((select (c->>'anticipo_cent')::bigint from _cp), (select greatest((c->>'saldo_cent')::bigint, 0) from _cp), 'el saldo a favor no respaldado por la utilidad se muestra como ANTICIPO al proveedor');
select is((select (c->>'reinvertida_cent')::bigint from _cp), 0::bigint, 'y no se trata como utilidad reinvertida');
select is(pg_temp.fallan(), '', 'libro conciliado con anticipo al proveedor');
select * from finish();
rollback;
