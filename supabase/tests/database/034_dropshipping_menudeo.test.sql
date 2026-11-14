-- pgTAP: PEDIDOS A COSTO de un socio para su menudeo. (1) ni pagados ni pendientes cambian la valuacion neta ni la aportacion neta (solo resta lo cobrado en SU cuenta);
-- (2) lista por socio con renglones, pagado y pendiente de pago, filtros y totales; (3) pago del pedido (directo al proveedor o abono a la sociedad) que lo quita de pendientes;
-- (4) resumen de pendientes para el Inicio; (5) contador de piezas movidas; Explicar con dos vias. Datos sinteticos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a2m.ang@example.test', 'socio', 'Angelo', true), ('a2m.jav@example.test', 'socio', 'Javier', true), ('a2m.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-6666666600a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2m.ang@example.test'),
  ('88888888-8888-8888-8888-6666666600a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2m.jav@example.test'),
  ('88888888-8888-8888-8888-6666666600a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2m.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-6666666600a1' when 'Omar' then '88888888-8888-8888-8888-6666666600a3' else '88888888-8888-8888-8888-6666666600a2' end, true) $$;
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
create temp table _s as select (api.apertura_crear('a2m:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a2m:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('a2m:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('a2m:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('a2m:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('a2m:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('a2m:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a2m:f2', (select id from _s));
select pg_temp.como('Angelo');



select catalogo.asegurar_modelo('A2M Marca', 'A2M Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('A2M Modelo 25K', 'Fresa'), catalogo.asegurar_sku('A2M Modelo 25K', 'Mango');
select catalogo.fijar_costo('a2m-c1', 'Karen', 'A2M Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('a2m-c2', 'Isaac', 'A2M Modelo 25K', 9000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('A2M Stock Angelo', 'Angelo'); select catalogo.asegurar_cliente('A2M Stock Javier', 'Javier');
create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar($1) $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.v03() returns bigint language plpgsql as $$ begin set constraints all immediate; perform contabilidad.asentar_pendientes(); return (contabilidad.valuacion()->>'v03_diferencia_cent')::bigint; end $$;
create function pg_temp.neta(p text) returns bigint language sql as $$ select (x->>'aportacion_neta_cent')::bigint from jsonb_array_elements(api.socios_aportacion_neta()->'socios') x where x->>'socio' = $1 $$;
create temp table _base as select pg_temp.v03() as v03, pg_temp.neta('Angelo') as na, pg_temp.neta('Javier') as nj, (select count(*) from operacion.aportacion_socio) as ap;

-- Tres pedidos de Angelo y uno de Javier (a costo)
select operacion.ds_crear_pedido('a2m-1', pg_temp.cli('A2M Stock Angelo'), '[{"modelo":"A2M Modelo 25K","sabor":"Fresa","piezas":30},{"modelo":"A2M Modelo 25K","sabor":"Mango","piezas":20}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, negocio.hoy() - 2, null, null, negocio.hoy() + 7);
select operacion.ds_crear_pedido('a2m-2', pg_temp.cli('A2M Stock Angelo'), '[{"modelo":"A2M Modelo 25K","sabor":"Fresa","piezas":30}]'::jsonb, 'isaac_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, negocio.hoy() - 1, null, null, negocio.hoy() + 7);
select operacion.ds_crear_pedido('a2m-3', pg_temp.cli('A2M Stock Angelo'), '[{"modelo":"A2M Modelo 25K","sabor":"Mango","piezas":20}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, null, null, null, negocio.hoy() + 7);
-- El socio de menudeo es Angelo por omision; para este pedido de Javier se parametriza a Javier (solo el socio de menudeo mete pedidos a costo).
select pg_temp.como('Javier');
update operacion.ds_recordatorio_config set socio_menudeo = (select id from catalogo.socio where nombre = 'Javier') where id = 1;
select operacion.ds_crear_pedido('a2m-4', pg_temp.cli('A2M Stock Javier'), '[{"modelo":"A2M Modelo 25K","sabor":"Fresa","piezas":10}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Javier', null, 0, 0, null, null, null, negocio.hoy() + 7);
update operacion.ds_recordatorio_config set socio_menudeo = (select id from catalogo.socio where nombre = 'Angelo') where id = 1;
select pg_temp.como('Angelo');
select is((api.ds_menudeo('Angelo')->'totales'->>'pendiente_cent')::bigint, 0::bigint, 'borradores: nada pendiente aun (no comprometen)');
select is((select estado_pago from jsonb_to_recordset(api.ds_menudeo('Angelo')->'filas') as x(estado_pago text, pedido_id bigint) where pedido_id = pg_temp.ped('a2m-3:ped')), 'por_confirmar', 'un borrador se muestra por confirmar');
select operacion.confirmar_pedido('a2m-1c', pg_temp.ped('a2m-1:ped')); select operacion.confirmar_pedido('a2m-2c', pg_temp.ped('a2m-2:ped')); select operacion.confirmar_pedido('a2m-4c', pg_temp.ped('a2m-4:ped'));
select is((api.ds_menudeo('Angelo')->'totales'->>'pendiente_cent')::bigint, (50 * 8929 + 30 * 9000)::bigint, 'confirmados: pendiente de pago = su costo');
select is(pg_temp.v03(), (select v03 from _base), '(1) pedidos a costo PENDIENTES: la valuacion neta no cambia');
select is(pg_temp.neta('Angelo'), (select na from _base), '(1) ni la aportacion neta de Angelo');
select operacion.enviar_pedido('a2m-1e', pg_temp.ped('a2m-1:ped'), null, null, null, true); select operacion.enviar_pedido('a2m-2e', pg_temp.ped('a2m-2:ped'), null, null, null, true); select operacion.enviar_pedido('a2m-4e', pg_temp.ped('a2m-4:ped'), null, null, null, true);
select is(pg_temp.v03(), (select v03 from _base), '(1) enviados y sin pagar: la valuacion neta sigue igual');
select is(pg_temp.neta('Angelo') || ',' || pg_temp.neta('Javier'), (select na || ',' || nj from _base), '(1) y las aportaciones netas de los dos');
select is((select count(*) from operacion.aportacion_socio), (select ap from _base), '(1) no se crea aportacion ni reembolso por un pedido a costo');
select is(pg_temp.fallan(), '', 'Libro conciliado con pedidos a costo pendientes');

-- Lista del socio
create temp table _m as select api.ds_menudeo('Angelo') as r;
select is((select jsonb_array_length(r->'filas') from _m), 3, 'Pedidos menudeo de Angelo: sus tres pedidos');
select is((select (r->'totales'->>'piezas')::int from _m), 100, 'total de piezas 100 (50 + 30 + 20)');
select is((select (r->'totales'->>'costo_cent')::bigint from _m), (50 * 8929 + 30 * 9000 + 20 * 8929)::bigint, 'costo total de todos');
select is((select jsonb_array_length(f->'renglones') from _m, jsonb_array_elements(r->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-1:ped')), 2, 'ficha de renglones: dos sabores');
select is((select (y->>'costo_unit_cent')::bigint from _m, jsonb_array_elements(r->'filas') f, jsonb_array_elements(f->'renglones') y where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-1:ped') and y->>'sabor' = 'Fresa'), 8929::bigint, 'renglon: costo unitario 89.29');
select is((select y->>'marca' || '/' || (y->>'modelo') from _m, jsonb_array_elements(r->'filas') f, jsonb_array_elements(f->'renglones') y where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-1:ped') limit 1), 'A2M Marca/A2M Modelo 25K', 'renglon: marca y modelo');
select is((select f->>'proveedor' from _m, jsonb_array_elements(r->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-2:ped')), 'Isaac', 'proveedor del pedido');
select is((api.ds_menudeo('Javier')->'totales'->>'pedidos')::int, 1, 'funciona igual para Javier');
select is((api.ds_menudeo('Angelo', null, null, 'Isaac')->'totales'->>'pedidos')::int, 1, 'filtro por proveedor');
select is((api.ds_menudeo('Angelo', negocio.hoy() - 1, negocio.hoy() - 1)->'totales'->>'pedidos')::int, 1, 'filtro por periodo');
select is((api.ds_menudeo('Angelo', null, null, null, 'pagado')->'totales'->>'pedidos')::int, 0, 'filtro por estado: ninguno pagado todavia');
select throws_ok($$select api.ds_menudeo('Nadie')$$, '22023', null, 'socio desconocido');
select throws_ok($$select api.ds_menudeo('Angelo', null, null, null, 'raro')$$, '22023', null, 'estado invalido');
select is((select (x->>'pendiente_cent')::bigint from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), (50 * 8929 + 30 * 9000)::bigint, 'Inicio: pendiente de pago de Angelo');
select is((select (x->>'pedidos')::int from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), 2, 'Inicio: 2 pedidos pendientes');

-- Pago: directo al proveedor (su dinero) y abono a la sociedad
select throws_ok($$select operacion.ds_pagar_pedido_menudeo('a2m-px', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a2m-3:ped'), 'proveedor')$$, 'P0428', null, 'un pedido aun no enviado no se paga');
select throws_ok($$select operacion.ds_pagar_pedido_menudeo('a2m-py', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a2m-1:ped'), 'proveedor', 99999999)$$, '23514', null, 'no se paga mas de lo pendiente');
select throws_ok($$select operacion.ds_pagar_proveedor('a2m-pz', 'Karen', 100, 'socio_propio', 'Angelo', null, (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a2m-1:ped'))$$, '22023', null, 'pagar un pedido a costo "como aportacion" se rechaza: se paga como cliente');
select operacion.ds_pagar_pedido_menudeo('a2m-p1', pg_temp.ped('a2m-1:ped'), 'proveedor');
select is(operacion.pedido_saldo(pg_temp.ped('a2m-1:ped')), 0::bigint, 'pagado directo al proveedor: el pedido queda saldado');
select is((select f->>'estado_pago' from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-1:ped')), 'pagado', 'estado Pagado');
select is((api.ds_menudeo('Angelo')->'totales'->>'pendiente_cent')::bigint, (30 * 9000)::bigint, 'sale de pendientes');
select is(pg_temp.v03(), (select v03 from _base), '(1) pedido a costo PAGADO directo al proveedor: la valuacion neta no cambia');
select is(pg_temp.neta('Angelo'), (select na from _base), '(1) ni la aportacion neta');
select is((select count(*) from operacion.aportacion_socio), (select ap from _base), '(1) sin aportacion ni reembolso');
select operacion.ds_pagar_pedido_menudeo('a2m-p2', pg_temp.ped('a2m-2:ped'), 'sociedad', 100000);
select is((select (f->>'pagado_cent')::bigint from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-2:ped')), 100000::bigint, 'abono parcial a la sociedad: pagado 1,000.00');
select is((select f->>'estado_pago' from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-2:ped')), 'no_pagado', 'con abono parcial sigue No pagado, con su pendiente');
select is((select (f->>'pendiente_cent')::bigint from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2m-2:ped')), (30 * 9000 - 100000)::bigint, 'pendiente = costo menos abono');
select is(pg_temp.v03(), (select v03 from _base), '(1) abono a la sociedad: la valuacion neta no cambia');
select is(pg_temp.neta('Angelo'), (select na from _base), '(1) y la aportacion neta tampoco (el efectivo entra a la caja de la sociedad)');
select operacion.ds_pagar_pedido_menudeo('a2m-p3', pg_temp.ped('a2m-2:ped'), 'sociedad');
select is((api.ds_menudeo('Angelo')->'totales'->>'pendiente_cent')::bigint, 0::bigint, 'todo pagado: sin pendientes');
select is((select (x->>'pedidos')::int from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), 0, 'Inicio: Angelo sin pedidos pendientes');
select is(pg_temp.fallan(), '', 'Libro conciliado con pedidos a costo pagados por las dos vias');
-- Lo unico que resta: lo que se cobra en SU cuenta (fondos de la sociedad en su poder)
select operacion.registrar_pago('a2m-cobro', 'Angelo', 250000, pg_temp.cli('A2M Stock Angelo'), null, true, 'abono');
select is(pg_temp.neta('Angelo'), (select na from _base) - 250000, '(1) un cobro recibido en la cuenta de Angelo SI resta de su aportacion neta, y solo por ese monto');
select is(pg_temp.v03(), (select v03 from _base), '(1) y la valuacion neta de la sociedad no cambia por ese cobro');
select is(pg_temp.fallan(), '', 'Libro conciliado con fondos en poder del socio');

-- Dos renglones SEPARADOS y con totales distintos: pedidos a costo pendientes de pago (no restan) y fondos de la sociedad cobrados en su cuenta (si restan)
create temp table _pn as select api.ds_menudeo_pendientes() as r;
select is((select (x->>'fondos_pendiente_cent')::bigint from _pn, jsonb_array_elements(r) x where x->>'socio' = 'Angelo'), 250000::bigint, 'Inicio: fondos de la sociedad pendientes de entregar de Angelo = 2,500.00');
select is((select (x->>'pendiente_cent')::bigint from _pn, jsonb_array_elements(r) x where x->>'socio' = 'Angelo'), 0::bigint, 'Inicio: sus pedidos a costo pendientes de pago = 0 (todos pagados): totales distintos, renglones separados');
select is((select (x->>'pendiente_cent')::bigint from _pn, jsonb_array_elements(r) x where x->>'socio' = 'Javier'), (10 * 8929)::bigint, 'Inicio: Javier tiene pedidos a costo pendientes y no tiene fondos en su cuenta');
select is((select (x->>'fondos_pendiente_cent')::bigint from _pn, jsonb_array_elements(r) x where x->>'socio' = 'Javier'), 0::bigint, 'Javier: sin fondos pendientes de entregar');
create temp table _fp as select api.ds_fondos_en_poder('Angelo') as r;
select is((select (r->>'pendiente_cent')::bigint from _fp), 250000::bigint, 'detalle de fondos: pendiente de entregar 2,500.00');
select is((select r->'movimientos'->0->>'cliente' from _fp), 'A2M Stock Angelo', 'detalle: de que cliente es el cobro');
select is((select r->'movimientos'->0->>'pago' from _fp) ~ '^PG-', true, 'detalle: folio del cobro');
select is((select (r->'movimientos'->0->>'fecha_neg')::date from _fp), negocio.hoy(), 'detalle: fecha del cobro');
select is((select r->'movimientos'->0->>'concepto' from _fp), 'fondos_en_poder', 'detalle: concepto del movimiento');
select is((api.ds_explicar_menudeo('dsm:Angelo:fondos:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar fondos pendientes: dos vias cuadran');
select is((api.ds_explicar_menudeo('dsm:Angelo:fondos:-:-')->>'valor')::bigint, 250000::bigint, 'Explicar fondos: 2,500.00');
select is(pg_temp.neta('Angelo'), (select na from _base) - (select (r->>'pendiente_cent')::bigint from _fp), 'los fondos pendientes SI restan de la aportacion neta; los pedidos a costo NO');
select is((select (x->>'pendiente_cent')::bigint from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Javier') + 0, (10 * 8929)::bigint, 'Javier: el pendiente de pedidos a costo no cambio por el cobro de Angelo');
select is((api.ds_fondos_en_poder('Javier')->>'pendiente_cent')::bigint, 0::bigint, 'Javier sin fondos');
select throws_ok($$select api.ds_fondos_en_poder('Nadie')$$, '22023', null, 'socio desconocido');

-- Explicar con dos vias y contador de piezas movidas
select is((api.ds_explicar_menudeo('dsm:Angelo:costo:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar costo: cuadra');
select is((api.ds_explicar_menudeo('dsm:Angelo:piezas:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar piezas: cuadra');
select is((api.ds_explicar_menudeo('dsm:Angelo:pagado:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar pagado: cuadra');
select is((api.ds_explicar_menudeo('dsm:Javier:pendiente:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar pendiente: cuadra');
select is((api.ds_explicar_menudeo('dsm:Javier:pendiente:-:-')->>'valor')::bigint, (10 * 8929)::bigint, 'pendiente de Javier = su pedido sin pagar');
select throws_ok($$select api.ds_explicar_menudeo('dsm:Angelo:raro:-:-')$$, '22023', null, 'cifra desconocida');
create temp table _pm as select api.ds_resumen()->'piezas_movidas' as r;
select is((select (r->>'a_costo_socios')::int from _pm), 90, 'piezas movidas a costo: 50 + 30 + 10 (los enviados)');
select is((select (x->>'piezas')::int from _pm, jsonb_array_elements(r->'por_socio') x where x->>'socio' = 'Angelo'), 80, 'por socio: Angelo 80');
select is((select (x->>'piezas')::int from _pm, jsonb_array_elements(r->'por_proveedor') x where x->>'proveedor' = 'Isaac'), 30, 'por proveedor: Isaac 30');
select is((select (r->'por_mes'->0->>'a_costo_socios')::int from _pm), 90, 'por mes');
select pg_temp.como('Omar');
select throws_ok($$select api.ds_fondos_en_poder('Angelo')$$, '42501', null, 'Omar no ve los fondos en poder');
select throws_ok($$select api.ds_menudeo('Angelo')$$, '42501', null, 'Omar no ve los pedidos de menudeo');
select throws_ok($$select api.ds_pagar_pedido_menudeo('a2m-o', 1, 'proveedor')$$, '42501', null, 'ni los paga');
select * from finish();
rollback;
