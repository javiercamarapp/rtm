-- pgTAP F3a: cuenta con proveedores. Hoja de Isaac de la Parada 3 (12 renglones = 284,540; 11 guias = 7,105; Villa a costo 9,430), liquidacion del viernes con su
-- comprobacion (costo total con guias - pagos = lo que falta), conciliacion contra lo que dice el proveedor, ambito, ajustes y Karen via Isaac.
-- La semana de prueba es de 2020 para no depender de datos previos de la base.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3a.prov@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('b3333333-3333-3333-3333-333333333331', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3a.prov@example.test');
select set_config('request.jwt.claim.sub', 'b3333333-3333-3333-3333-333333333331', true);

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

select catalogo.asegurar_cliente('F3 Cliente Isaac', 'Angelo');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Isaac 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F3 Isaac 30K', 'Sandia');
select catalogo.fijar_costo('f3hc0', 'Isaac', 'F3 Isaac 30K', 500, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f3hp0', 'F3 Cliente Isaac', 'F3 Isaac 30K', 1000, '2020-01-01', 'chat');
-- Villa a costo: 12 x 230 + 14 x 215 + 23 x 120 + 4 x 225 = 9,430.
select catalogo.asegurar_modelo('F3 Marca', 'F3 Villa A', 30000, 'ambas'); select catalogo.asegurar_sku('F3 Villa A', 'Sandia');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Villa B', 30000, 'ambas'); select catalogo.asegurar_sku('F3 Villa B', 'Sandia');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Villa C', 30000, 'ambas'); select catalogo.asegurar_sku('F3 Villa C', 'Sandia');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Villa D', 30000, 'ambas'); select catalogo.asegurar_sku('F3 Villa D', 'Sandia');
select catalogo.fijar_costo('f3hv1', 'Isaac', 'F3 Villa A', 23000, '2020-01-01', 'prueba');
select catalogo.fijar_costo('f3hv2', 'Isaac', 'F3 Villa B', 21500, '2020-01-01', 'prueba');
select catalogo.fijar_costo('f3hv3', 'Isaac', 'F3 Villa C', 12000, '2020-01-01', 'prueba');
select catalogo.fijar_costo('f3hv4', 'Isaac', 'F3 Villa D', 22500, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f3hpv1', 'F3 Cliente Isaac', 'F3 Villa A', 30000, '2020-01-01', 'chat');
select catalogo.fijar_precio('f3hpv2', 'F3 Cliente Isaac', 'F3 Villa B', 30000, '2020-01-01', 'chat');
select catalogo.fijar_precio('f3hpv3', 'F3 Cliente Isaac', 'F3 Villa C', 30000, '2020-01-01', 'chat');
select catalogo.fijar_precio('f3hpv4', 'F3 Cliente Isaac', 'F3 Villa D', 30000, '2020-01-01', 'chat');

-- Once renglones de la hoja (sin Villa) y sus once guias; el costo es piezas x 5 pesos.
do $$
declare
  tot bigint[] := array[43500, 18100, 39875, 11430, 13000, 27310, 10960, 4770, 84800, 12765, 8600];
  gu bigint[] := array[1269, 672, 788, 672, 614, 307, 307, 1555, 307, 0, 614];
  i int; v_id bigint; v_cli bigint := (select id from catalogo.cliente where nombre_canonico = 'F3 Cliente Isaac');
begin
  for i in 1..11 loop
    v_id := (operacion.crear_pedido('f3h' || i, v_cli, jsonb_build_array(jsonb_build_object('modelo', 'F3 Isaac 30K', 'sabor', 'Sandia', 'piezas', tot[i] * 100 / 500)), 'isaac_directo', null, 0, 0, 0, '2020-06-02')->>'pedido_id')::bigint;
    perform operacion.confirmar_pedido('f3hc' || i, v_id);
    perform operacion.enviar_pedido('f3hs' || i, v_id, null, jsonb_build_object('paqueteria', 'Castores', 'numero', 'F3-G' || i, 'costo_cent', gu[i] * 100), '2020-06-02', true);
  end loop;
  -- Villa: 53 piezas en cuatro modelos, sin guia propia.
  v_id := (operacion.crear_pedido('f3hvilla', v_cli, '[{"modelo":"F3 Villa A","sabor":"Sandia","piezas":12},{"modelo":"F3 Villa B","sabor":"Sandia","piezas":14},{"modelo":"F3 Villa C","sabor":"Sandia","piezas":23},{"modelo":"F3 Villa D","sabor":"Sandia","piezas":4}]'::jsonb,
           'isaac_directo', null, 0, 0, 0, '2020-06-02')->>'pedido_id')::bigint;
  perform operacion.confirmar_pedido('f3hvillac', v_id);
  perform operacion.enviar_pedido('f3hvillas', v_id, null, null, '2020-06-02', true);
end $$;

create temp table _h as select operacion.hoja_proveedor('Isaac', '2020-06-01', 'todo') as h;
select is((select jsonb_array_length(h->'renglones') from _h), 12, 'hoja de Isaac: 12 renglones');
select is((select (h->'totales'->>'mercancia_cent')::bigint from _h), 28454000::bigint, 'hoja de Isaac: los 12 renglones suman 284,540.00');
select is((select (h->'totales'->>'guias_cent')::bigint from _h), 710500::bigint, 'hoja de Isaac: las 11 guias suman 7,105.00');
select is((select count(*)::int from _h, jsonb_array_elements(h->'renglones') r where (r->>'guia_cent')::bigint >= 0 and r->>'tipo' = 'pedido' and (r->>'guia_cent')::bigint > 0) , 10, 'diez guias con costo y una de 0.00');
select is((select (r->>'costo_cent')::bigint from _h, jsonb_array_elements(h->'renglones') r where r->>'cliente' = 'F3 Cliente Isaac' and (r->>'piezas')::int = 53), 943000::bigint, 'Villa a costo 9,430.00 (12 x 230 + 14 x 215 + 23 x 120 + 4 x 225)');
select is((select jsonb_array_length(r->'detalle') from _h, jsonb_array_elements(h->'renglones') r where (r->>'piezas')::int = 53), 4, 'Villa lleva el detalle de sus cuatro modelos');
select is((select (h->'totales'->>'costo_total_cent')::bigint from _h), 29164500::bigint, 'costo total con guias 291,645.00');
select is((select (h->'comprobaciones'->>'cuadra')::boolean from _h), true, 'las comprobaciones cuadran (renglon = piezas x costo, suma de renglones, guias = envios, abonos = depositos)');
select is((select (h->'comprobaciones'->>'mercancia_independiente_cent')::bigint from _h), 28454000::bigint, 'la mercancia calculada por otra via coincide');
-- Ambito: dos pedidos propios de Angelo salen de la vista por omision.
select operacion.fijar_ambito_pedido('f3amb1', pg_temp.pid('f3h1'), false, 'pedido propio de Angelo');
select operacion.fijar_ambito_pedido('f3amb2', pg_temp.pid('f3h2'), false, 'pedido propio de Angelo');
select is((operacion.hoja_proveedor('Isaac', '2020-06-01', 'sociedad')->'totales'->>'mercancia_cent')::bigint, 28454000::bigint - 4350000 - 1810000, 'Solo de la sociedad deja fuera lo propio de Angelo');
select is((operacion.hoja_proveedor('Isaac', '2020-06-01', 'todo')->'totales'->>'mercancia_cent')::bigint, 28454000::bigint, 'Todo, por dueno incluye todo y vuelve a sumar 284,540.00');
select throws_ok($$select operacion.fijar_ambito_pedido('f3amb3', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3h3'), false, '')$$, '23502', null, 'cambiar el ambito exige motivo');
-- Isaac y Karen nunca se mezclan.
select is((operacion.hoja_proveedor('Karen', '2020-06-01', 'todo')->'totales'->>'costo_total_cent')::bigint, 0::bigint, 'la hoja de Karen no incluye nada de Isaac');

-- Pagos de la semana: un deposito de cliente (con su cliente), un pago de un socio y un descuento del proveedor.
select operacion.registrar_pago('f3hpg1', 'Isaac', 15000000, (select id from catalogo.cliente where nombre_canonico = 'F3 Cliente Isaac'), null, true, 'abono', '2020-06-03');
select operacion.pago_proveedor_de_socio('f3hpg2', 'Isaac', 10000000, 'Angelo', 'aportacion', '2020-06-04');
select operacion.registrar_ajuste_proveedor('f3haj', 'Isaac', 100000, 'descuento_proveedor', 'descuento por volumen', '2020-06-04');
create temp table _h2 as select operacion.hoja_proveedor('Isaac', '2020-06-01', 'todo') as h;
select is((select (h->'totales'->>'pagos_cent')::bigint from _h2), 25000000::bigint, 'pagos de la semana 250,000.00 (deposito de cliente + pago de un socio)');
select is((select (h->'pagos_por_concepto_cent'->>'pago_cliente_redirigido')::bigint from _h2), 15000000::bigint, 'el deposito de cliente se distingue del pago del socio');
select is((select count(*)::int from _h2, jsonb_array_elements(h->'abonos') a where a->>'cliente' = 'F3 Cliente Isaac'), 1, 'cada abono de cliente trae su cliente aunque el proveedor no lo vea');
select is((select (h->'totales'->>'ajustes_cent')::bigint from _h2), 100000::bigint, 'ajuste a favor de 1,000.00');
select is((select (h->'totales'->>'falta_por_saldar_cent')::bigint from _h2), 4064500::bigint, 'falta por saldar = 291,645.00 - 250,000.00 - 1,000.00 = 40,645.00');
select is((select (h->'comprobaciones'->>'cuadra')::boolean from _h2), true, 'y la hoja sigue cuadrando');
-- Deshacer el ajuste con su contramovimiento.
select operacion.anular_movimiento_proveedor('f3haju', (select id from operacion.cuenta_proveedor_mov where concepto = 'ajuste' and monto_cent = 100000 and nota like 'descuento proveedor%' order by id desc limit 1), 'se capturo en la semana equivocada');
select is((operacion.hoja_proveedor('Isaac', '2020-06-01', 'todo')->'totales'->>'falta_por_saldar_cent')::bigint, 4164500::bigint, 'deshecho el ajuste, la falta vuelve a 41,645.00');
select throws_ok($$select operacion.anular_movimiento_proveedor('f3haju2', (select id from operacion.cuenta_proveedor_mov where concepto = 'ajuste' and monto_cent = 100000 order by id desc limit 1), 'otra vez')$$, 'P0428', null, 'un ajuste se deshace una sola vez');
select throws_ok($$select operacion.anular_movimiento_proveedor('f3hpgx', (select id from operacion.cuenta_proveedor_mov where concepto = 'pago_cliente_redirigido' order by id desc limit 1), 'no')$$, 'P0428', null, 'un pago de cliente no se deshace desde aqui');
select operacion.registrar_ajuste_proveedor('f3haj2', 'Isaac', 100000, 'descuento_proveedor', 'descuento por volumen', '2020-06-04');
select throws_ok($$select operacion.registrar_ajuste_proveedor('f3haj3', 'Isaac', 100, 'descuento_proveedor', '')$$, '23502', null, 'un ajuste exige motivo');
-- Conciliacion contra lo que dice el proveedor, renglon por renglon; no se toma por verdad ni su cifra ni la nuestra.
select operacion.registrar_dicho_proveedor('f3hd', 'Isaac', '2020-06-01', 'todo', 4100000,
  jsonb_build_array(jsonb_build_object('folio', (select folio from operacion.pedido where id = pg_temp.pid('f3hvilla')), 'monto_cent', 950000)), 'Isaac dice 41,000.00');
select is((operacion.hoja_proveedor('Isaac', '2020-06-01', 'todo')->'conciliacion'->>'diferencia_cent')::bigint, 35500::bigint, 'conciliacion: el proveedor dice 41,000.00 y nuestra cuenta 40,645.00: diferencia de 355.00');
select is((select (r->>'diferencia_cent')::bigint from jsonb_array_elements(operacion.hoja_proveedor('Isaac', '2020-06-01', 'todo')->'conciliacion'->'renglones') r where (r->>'dice_cent')::bigint = 950000), 7000::bigint, 'renglon por renglon: Villa cuesta 9,430.00 y el proveedor dice 9,500.00');
-- Texto para el proveedor: totales por modelo, sin nombres de clientes.
select ok(position('F3 Cliente Isaac' in api.nota_proveedor('Isaac', '2020-06-01', 'todo')->>'texto') = 0, 'la nota para el proveedor no lleva nombres de clientes');
select ok(position('Falta por saldar: $40,645.00' in api.nota_proveedor('Isaac', '2020-06-01', 'todo')->>'texto') > 0, 'y trae lo que falta por saldar');
-- Cierre del viernes.
select throws_ok($$select operacion.cerrar_liquidacion_proveedor('f3hl0', 'Isaac', '2020-06-01', 'todo', null, '2020-06-03')$$, 'P0428', null, 'no se liquida antes del viernes');
create temp table _l as select operacion.cerrar_liquidacion_proveedor('f3hl', 'Isaac', '2020-06-01', 'todo', 'viernes') as r;
select is((select (r->>'falta_por_saldar_cent')::bigint from _l), 4064500::bigint, 'liquidacion cerrada con 40,645.00 por saldar');
select is((select dicho_por_proveedor_cent from operacion.liquidacion_proveedor order by id desc limit 1), 4100000::bigint, 'queda registrado lo que dijo el proveedor');
select throws_ok($$select operacion.cerrar_liquidacion_proveedor('f3hl2', 'Isaac', '2020-06-01', 'todo')$$, 'P0428', null, 'una semana no se liquida dos veces');
select throws_ok($$select operacion.registrar_dicho_proveedor('f3hd2', 'Isaac', '2020-06-01', 'todo', 1)$$, 'P0428', null, 'cerrada la semana ya no se concilia');
select is((operacion.hoja_proveedor('Isaac', '2020-06-08', 'todo')->'totales'->>'saldo_anterior_cent')::bigint, 4064500::bigint, 'la siguiente semana arranca con el saldo anterior de 40,645.00');
select is((api.liquidaciones_proveedor('Isaac')->0->>'folio'), (select folio from operacion.liquidacion_proveedor order by id desc limit 1), 'la liquidacion aparece en el historial');

-- ---- Orden de compra aplicada en la semana actual y Karen via Isaac -------------------------------------------------------------------------------
create temp table _sem as select operacion.semana_liquidacion_ini(negocio.hoy()) as ini;
select operacion.crear_compra('f3oc1', 'Isaac', '[{"modelo":"F3 Isaac 30K","sabor":"Sandia","pagadas":100}]'::jsonb, 20000, 0);
select operacion.confirmar_compra('f3oc1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'f3oc1'));
select is((select r->>'tipo' from jsonb_array_elements(operacion.hoja_proveedor('Isaac', (select ini from _sem), 'todo')->'renglones') r where r->>'tipo' = 'oc' order by (r->>'id')::bigint desc limit 1), 'oc', 'la orden de compra confirmada entra a la hoja de la semana');
select is((select (r->>'costo_cent')::bigint from jsonb_array_elements(operacion.hoja_proveedor('Isaac', (select ini from _sem), 'todo')->'renglones') r where r->>'tipo' = 'oc' order by (r->>'id')::bigint desc limit 1), 70000::bigint, 'la orden pesa lo que cargo a la cuenta: 100 x 5.00 + guia 200.00');
select is((operacion.hoja_proveedor('Isaac', (select ini from _sem), 'todo')->'comprobaciones'->>'cuadra')::boolean, true, 'con la orden la hoja sigue cuadrando');

select catalogo.asegurar_cliente('F3 Cliente Karen', 'Javier');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Karen 15K', 15000, 'ambas');
select catalogo.asegurar_sku('F3 Karen 15K', 'Uva');
select catalogo.fijar_costo('f3kc', 'Karen', 'F3 Karen 15K', 8000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f3kp', 'F3 Cliente Karen', 'F3 Karen 15K', 12000, '2020-01-01', 'chat');
select operacion.crear_pedido('f3kv', (select id from catalogo.cliente where nombre_canonico = 'F3 Cliente Karen'), '[{"modelo":"F3 Karen 15K","sabor":"Uva","piezas":10}]'::jsonb, 'karen_via_isaac', null, 0, 0, 0, negocio.hoy(), 'minimo de piezas');
select operacion.confirmar_pedido('f3kvc', pg_temp.pid('f3kv'));
select operacion.enviar_pedido('f3kvs', pg_temp.pid('f3kv'), null, '{"paqueteria":"Castores","numero":"F3-KV","costo_cent":20000}'::jsonb, negocio.hoy(), true);
select is((select sum((r->>'seguro_cent')::bigint)::bigint from jsonb_array_elements(operacion.hoja_proveedor('Isaac', (select ini from _sem), 'todo')->'renglones') r where r->>'folio' = (select folio from operacion.pedido where id = pg_temp.pid('f3kv'))),
          5000::bigint, 'Karen via Isaac: a Isaac le toca el seguro de reenvio de 5.00 por pieza');
select is((select sum((r->>'mercancia_cent')::bigint)::bigint from jsonb_array_elements(operacion.hoja_proveedor('Karen', (select ini from _sem), 'todo')->'renglones') r where r->>'folio' = (select folio from operacion.pedido where id = pg_temp.pid('f3kv'))),
          80000::bigint, 'Karen via Isaac: a Karen le toca la mercancia (10 x 80.00)');
select is((select sum((r->>'guia_cent')::bigint)::bigint from jsonb_array_elements(operacion.hoja_proveedor('Karen', (select ini from _sem), 'todo')->'renglones') r where r->>'folio' = (select folio from operacion.pedido where id = pg_temp.pid('f3kv'))),
          0::bigint, 'la guia de Karen via Isaac no es de Karen');
select is((operacion.hoja_proveedor('Karen', (select ini from _sem), 'todo')->'comprobaciones'->>'cuadra')::boolean, true, 'la hoja de Karen cuadra');
select is((operacion.hoja_proveedor('Isaac', (select ini from _sem), 'todo')->'comprobaciones'->>'cuadra')::boolean, true, 'la hoja de Isaac con Karen via Isaac cuadra');
-- Pago de la sociedad.
create temp table _ps0 as select operacion.saldo_proveedor(catalogo.proveedor_id('Karen')) as antes;
create temp table _ps as select operacion.registrar_pago_proveedor_sociedad('f3ps', 'Karen', 100000) as r;
select is((select (r->>'saldo_proveedor_cent')::bigint from _ps) - (select antes from _ps0), 100000::bigint, 'el pago de la sociedad sube el saldo a favor con el proveedor');
select throws_ok($$select operacion.registrar_pago_proveedor_sociedad('f3ps2', 'Karen', 0)$$, '23514', null, 'el pago debe ser positivo');

select * from finish();
rollback;
