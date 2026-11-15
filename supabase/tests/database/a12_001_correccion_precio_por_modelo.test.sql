-- pgTAP a12_001: CORRECCION DE PRECIO POR MODELO (decision del dueno, 14-nov). Reproduce con datos SINTETICOS el patron de tres pedidos de dropshipping
-- con Isaac, enviados, con un precio PLANO por pieza en todos los renglones (varios sabores por modelo; uno con recargo de credito y con un abono) que dejan renglones bajo costo.
-- Se prueba: totales, por cobrar, pagos, utilidad, costo, kardex, saldos y el libro IDENTICOS antes y despues (hash encadenado integro, sin asientos nuevos, C1..C24 y CU sin cambio);
-- suma exacta; rechazo si no cuadra; idempotencia; permisos (Omar, bodega y anon no pueden); T4 sigue cerrando todo lo demas; reversibilidad (otra correccion y regreso).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('cp.ang@example.test', 'socio', 'Angelo', true), ('cp.jav@example.test', 'socio', 'Javier', true), ('cp.omar@example.test', 'omar', null, true), ('cp.bod@example.test', 'bodega', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('cc000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp.ang@example.test'),
  ('cc000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp.jav@example.test'),
  ('cc000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp.omar@example.test'),
  ('cc000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cp.bod@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then 'cc000000-0000-0000-0000-0000000000a1' when 'Omar' then 'cc000000-0000-0000-0000-0000000000a3'
                                                       when 'Bodega' then 'cc000000-0000-0000-0000-0000000000a4' when 'Nadie' then '' else 'cc000000-0000-0000-0000-0000000000a2' end, true) $$;
select pg_temp.como('Angelo');

create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;
create function pg_temp.comprobaciones_rojas() returns text language sql as
  $$ select coalesce(string_agg(codigo, ',' order by codigo), '') from contabilidad.comprobaciones() where not ok $$;

-- Catalogo: cinco modelos con su costo de Isaac; tabulador solo para el modelo 1.
select catalogo.asegurar_modelo('CP Marca', 'CP Modelo Uno', 100000, 'ambas');
select catalogo.asegurar_modelo('CP Marca', 'CP Modelo Dos', 50000, 'ambas');
select catalogo.asegurar_modelo('CP Marca', 'CP Modelo Tres', 15000, 'ambas');
select catalogo.asegurar_modelo('CP Marca', 'CP Modelo Cuatro', 60000, 'ambas');
select catalogo.asegurar_modelo('CP Marca', 'CP Modelo Cinco', 35000, 'ambas');
select catalogo.asegurar_sku(m, s) from (values ('CP Modelo Uno', 'Fresa'), ('CP Modelo Uno', 'Mango'), ('CP Modelo Dos', 'Fresa'), ('CP Modelo Tres', 'Fresa'),
  ('CP Modelo Cuatro', 'Fresa'), ('CP Modelo Cuatro', 'Mango'), ('CP Modelo Cinco', 'Fresa')) x(m, s);
select catalogo.fijar_costo('cp-c' || n, 'Isaac', m, c, negocio.hoy() - 60, 'prueba') from (values (1, 'CP Modelo Uno', 16500), (2, 'CP Modelo Dos', 13000), (3, 'CP Modelo Tres', 17500),
  (4, 'CP Modelo Cuatro', 21500), (5, 'CP Modelo Cinco', 9000)) x(n, m, c);
select catalogo.asegurar_cliente('CP Cliente', 'Javier');
select catalogo.fijar_precio('cp-tab', 'CP Cliente', 'CP Modelo Uno', 19000, negocio.hoy() - 60, 'documento');
create function pg_temp.mid(p text) returns bigint language sql as $$ select id from catalogo.modelo where nombre_norm = catalogo.normalizar($1) $$;
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar('CP Cliente') $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

-- Pedido A: 27 piezas, total 4,660.00, precio plano 172.59 / 172.60 (el residuo en un renglon).
select operacion.ds_crear_pedido('cp-a', pg_temp.cli(), '[
  {"modelo":"CP Modelo Uno","sabor":"Fresa","piezas":6,"precio_cent":17259},{"modelo":"CP Modelo Uno","sabor":"Mango","piezas":4,"precio_cent":17259},
  {"modelo":"CP Modelo Dos","sabor":"Fresa","piezas":10,"precio_cent":17259},{"modelo":"CP Modelo Tres","sabor":"Fresa","piezas":7,"precio_cent":17260}]'::jsonb,
  'isaac_directo', null, null, 'cliente', null, null, 0, 0, negocio.hoy() - 2);
-- Pedido B: 30 piezas, total 6,470.00.
select operacion.ds_crear_pedido('cp-b', pg_temp.cli(), '[
  {"modelo":"CP Modelo Uno","sabor":"Fresa","piezas":10,"precio_cent":21566},{"modelo":"CP Modelo Cuatro","sabor":"Fresa","piezas":12,"precio_cent":21567},
  {"modelo":"CP Modelo Cuatro","sabor":"Mango","piezas":8,"precio_cent":21567}]'::jsonb, 'isaac_directo', null, null, 'cliente', null, null, 0, 0, negocio.hoy() - 2);
-- Pedido C: 30 piezas, mercancia 4,250.00 y recargo de credito 450.00 aparte.
select operacion.ds_crear_pedido('cp-c', pg_temp.cli(), '[
  {"modelo":"CP Modelo Cuatro","sabor":"Fresa","piezas":10,"precio_cent":14166},{"modelo":"CP Modelo Cinco","sabor":"Fresa","piezas":20,"precio_cent":14167}]'::jsonb,
  'isaac_directo', null, '{"interes_cent": 45000, "semanas": 2}'::jsonb, 'cliente', null, null, 0, 0, negocio.hoy() - 2);
-- Pedido D: sin enviar (para el rechazo).
select operacion.ds_crear_pedido('cp-d', pg_temp.cli(), '[{"modelo":"CP Modelo Cinco","sabor":"Fresa","piezas":5,"precio_cent":10000}]'::jsonb, 'isaac_directo', null, null, 'cliente', null, null, 0, 0, negocio.hoy() - 2);
select operacion.confirmar_pedido('cp-ac', pg_temp.ped('cp-a:ped')); select operacion.enviar_pedido('cp-ae', pg_temp.ped('cp-a:ped'), null, null, null, true);
select operacion.confirmar_pedido('cp-bc', pg_temp.ped('cp-b:ped')); select operacion.enviar_pedido('cp-be', pg_temp.ped('cp-b:ped'), null, null, null, true);
select operacion.confirmar_pedido('cp-cc', pg_temp.ped('cp-c:ped')); select operacion.enviar_pedido('cp-ce', pg_temp.ped('cp-c:ped'), null, null, null, true);
-- Un abono a cuenta de un socio (queda aplicado) y un pago a Isaac, para comprobar que por cobrar, pagos y saldos no se mueven.
select operacion.registrar_pago('cp-pago', 'Angelo', 100000, pg_temp.cli(), null, true, 'abono');
select operacion.ds_pagar_proveedor('cp-pi', 'Isaac', 200000, 'cliente_a_proveedor', null, pg_temp.cli(), pg_temp.ped('cp-a:ped'));

create function pg_temp.snap() returns jsonb language plpgsql as $$
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  return (select jsonb_build_object(
    'asientos', (select count(*) from contabilidad.asiento), 'lineas', (select count(*) from contabilidad.asiento_linea),
    'hash', (select hash from contabilidad.asiento order by id desc limit 1),
    'mayor', (select jsonb_object_agg(cuenta, s) from (select cuenta, sum(debe_cent - haber_cent) s from contabilidad.asiento_linea group by cuenta) x),
    'ventas_pedido', (select jsonb_object_agg(pedido_id::text, s) from (select pedido_id, sum(haber_cent - debe_cent) s from contabilidad.asiento_linea where cuenta = '4110' group by pedido_id) x),
    'costo_modelo', (select jsonb_object_agg(modelo_id::text, s) from (select modelo_id, sum(debe_cent - haber_cent) s from contabilidad.asiento_linea where cuenta = '5100' group by modelo_id) x),
    'cobro', (select jsonb_object_agg(id::text, jsonb_build_array(operacion.pedido_cobrado(id), operacion.pedido_aplicado(id), operacion.pedido_saldo(id))) from operacion.pedido),
    'saldo_cliente', operacion.saldo_cliente(pg_temp.cli()), 'pos_isaac', operacion.ds_posicion_proveedor(catalogo.proveedor_id('Isaac')),
    'costo_surtido', (select sum(costo_valor_cent) from operacion.pedido_surtido), 'piezas_surtidas', (select sum(piezas_surtidas) from operacion.pedido_linea),
    'kardex', (select coalesce(sum(valor_cent), 0) from operacion.existencia_modelo), 'movimientos', (select count(*) from operacion.movimiento_inventario),
    'utilidad', (select jsonb_object_agg(pedido_id::text, utilidad_total_cent) from operacion.v_ds_pedido),
    'totales_nota', (select jsonb_object_agg(pedido_id::text, total_cent) from (select distinct on (pedido_id) pedido_id, total_cent from operacion.nota order by pedido_id, id desc) n),
    'recargo', (select jsonb_object_agg(id::text, recargo_cent) from operacion.pedido),
    'rojas', pg_temp.comprobaciones_rojas(), 'cuadre', pg_temp.fallan()));
end $$;
select set_config('cp.a', pg_temp.ped('cp-a:ped')::text, true);

-- Antes -----------------------------------------------------------------------------------------------------------------------
create temp table _antes as select pg_temp.snap() as s;
create temp table _venta_antes as select pedido_id, sum(piezas_surtidas * precio_cent)::bigint as venta from operacion.pedido_linea group by pedido_id;
select is((select count(*)::int from operacion.pedido_linea l where l.pedido_id = pg_temp.ped('cp-a:ped') and l.precio_cent < l.costo_unit_cent), 1, 'antes: A tiene un renglon bajo costo (modelo 3: 172.60 contra 175.00)');
select is((select count(*)::int from operacion.pedido_linea l where l.pedido_id = pg_temp.ped('cp-c:ped') and l.precio_cent < l.costo_unit_cent), 1, 'antes: C tiene un renglon bajo costo (modelo 4: 141.66 contra 215.00)');
select is((select s->>'rojas' from _antes), '', 'antes: comprobaciones C1..C24 y CU en verde');
select is((select s->>'cuadre' from _antes), '', 'antes: Libro conciliado en verde');
select is(contabilidad.verificar_cadena(), null::bigint, 'antes: cadena de hash integra');
select is((select s->'totales_nota'->>(pg_temp.ped('cp-a:ped')::text) from _antes), '466000', 'total vigente de A: 4,660.00');

-- Rechazos (no escriben nada) ----------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x1', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'),
  '{"CP Modelo Uno": 18501, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb)$$, '23514', null, 'si la suma no cuadra EXACTAMENTE con el total vigente, falla (un centavo por pieza de mas)');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x2', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'),
  '{"CP Modelo Uno": 18500, "CP Modelo Dos": 15500}'::jsonb)$$, '22023', null, 'falta el precio de un modelo del pedido');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x3', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'),
  '{"CP Modelo Uno": 18500, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000, "CP Modelo Cinco": 100}'::jsonb)$$, '22023', null, 'un modelo que no es del pedido se rechaza');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x4', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'),
  '{"CP Modelo Uno": 18500.5, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb)$$, '23514', null, 'el precio debe ser entero en centavos');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x5', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'),
  '{"CP Modelo Uno": 0, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb)$$, '23514', null, 'el precio debe ser mayor que cero');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x6', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'),
  '{"Modelo que no existe": 18500, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb)$$, '22023', null, 'un modelo desconocido se rechaza');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x7', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-d:ped'), '{"CP Modelo Cinco": 10000}'::jsonb)$$,
  'P0428', null, 'un pedido sin enviar no se corrige por modelo');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-x8', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'), '{}'::jsonb)$$,
  '22023', null, 'sin precios no hay correccion');
select is(pg_temp.snap(), (select s from _antes), 'los rechazos no escribieron nada');

-- Permisos: Omar, bodega y anon no pueden; solo socio ----------------------------------------------------------------------------
select pg_temp.como('Omar');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-p1', 1, '{"x": 1}'::jsonb)$$, '42501', null, 'Omar no puede (funcion de operacion)');
set local role authenticated;
select throws_ok($$select api.corregir_precio_por_modelo('cp-p2', 1, '{"x": 1}'::jsonb)$$, '42501', null, 'Omar no puede (api)');
reset role;
select pg_temp.como('Bodega');
set local role authenticated;
select throws_ok($$select api.corregir_precio_por_modelo('cp-p3', 1, '{"x": 1}'::jsonb)$$, '42501', null, 'bodega no puede (api)');
reset role;
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-p4', 1, '{"x": 1}'::jsonb)$$, '42501', null, 'bodega no puede (funcion de operacion)');
select pg_temp.como('Nadie');
set local role anon;
select throws_ok($$select api.corregir_precio_por_modelo('cp-p5', 1, '{"x": 1}'::jsonb)$$, '42501', null, 'anon no tiene ni execute');
reset role;
select pg_temp.como('Angelo');
select is(pg_temp.snap(), (select s from _antes), 'los intentos sin permiso no escribieron nada');

-- T4 sigue cerrando todo lo demas ----------------------------------------------------------------------------------------------
select throws_ok($$update operacion.pedido_linea set precio_cent = 1 where pedido_id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped')$$, '42501', null, 'sin la funcion oficial, el precio de un renglon enviado sigue inmutable');
select set_config('rtm.correccion_precio', 'on', true);
select throws_ok($$update operacion.pedido_linea set renta_cent = 5 where pedido_id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped')$$, '42501', null, 'aun con el interruptor, solo cambian precio, tabulador y motivo (no el costo, la renta ni las piezas)');
select throws_ok($$update operacion.pedido_linea set precio_cent = 1, costo_unit_cent = 1 where pedido_id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped')$$, '42501', null, 'ni precio junto con costo');
select set_config('rtm.correccion_precio', 'off', true);
select throws_ok($$delete from operacion.pedido_linea where pedido_id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped')$$, '42501', null, 'las lineas no se borran');

-- Aplicar (con el socio, por la api) ---------------------------------------------------------------------------------------------
set local role authenticated;
create temp table _ra as select api.corregir_precio_por_modelo('cp-1a', current_setting('cp.a')::bigint, '{"CP Modelo Uno": 18500, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb, 'precios por modelo del dueno (sintetico)') as r;
reset role;
select is((select r->>'estado' from _ra), 'corregido', 'A corregido');
select is((select r->>'nota' from _ra), (select folio from operacion.pedido where id = pg_temp.ped('cp-a:ped')) || '-C1', 'deja la nota de correccion C1 enlazada');
select operacion.corregir_precio_por_modelo('cp-1b', pg_temp.ped('cp-b:ped'), '{"CP Modelo Uno": 18900, "CP Modelo Cuatro": 22900}'::jsonb);
select operacion.corregir_precio_por_modelo('cp-1c', pg_temp.ped('cp-c:ped'), '{"CP Modelo Cuatro": 23100, "CP Modelo Cinco": 9700}'::jsonb);

select is((select count(*)::int from operacion.pedido_linea l where l.pedido_id = pg_temp.ped('cp-a:ped') and l.precio_cent <> case l.modelo_id when pg_temp.mid('CP Modelo Uno') then 18500 when pg_temp.mid('CP Modelo Dos') then 15500 else 18000 end), 0, 'todos los renglones de A (por sabor) tienen el precio de su modelo');
select is((select sum(piezas_surtidas * precio_cent)::bigint from operacion.pedido_linea where pedido_id = pg_temp.ped('cp-b:ped')), 647000::bigint, 'B: la suma por renglon cuadra exacto: 6,470.00');
select is((select sum(piezas_surtidas * precio_cent)::bigint from operacion.pedido_linea where pedido_id = pg_temp.ped('cp-c:ped')), 425000::bigint, 'C: la mercancia cuadra exacto: 4,250.00');
select is((select recargo_cent from operacion.pedido where id = pg_temp.ped('cp-c:ped')), 45000::bigint, 'C: el recargo de credito no se toco');
select is((select count(*)::int from operacion.pedido_linea l where l.precio_cent < l.costo_unit_cent), 0, 'despues: ningun renglon bajo costo');
select is((select count(*)::int from operacion.pedido_linea where motivo_precio = 'correccion de precio por modelo'), (select count(*)::int from operacion.pedido_linea where pedido_id in (pg_temp.ped('cp-a:ped'), pg_temp.ped('cp-b:ped'), pg_temp.ped('cp-c:ped'))), 'cada renglon trae el motivo');
select is((select string_agg(distinct coalesce(precio_tabulador_cent::text, 'null'), ',' order by coalesce(precio_tabulador_cent::text, 'null')) from operacion.pedido_linea where pedido_id in (pg_temp.ped('cp-a:ped'), pg_temp.ped('cp-b:ped')) and modelo_id = pg_temp.mid('CP Modelo Uno')), '19000', 'tabulador del cliente cuando existe');
select is((select count(*)::int from operacion.pedido_linea where pedido_id in (pg_temp.ped('cp-a:ped'), pg_temp.ped('cp-b:ped'), pg_temp.ped('cp-c:ped')) and precio_tabulador_cent is null), 6, 'tabulador null donde no existe (modelos sin tabulador)');
select is((select count(*)::int from operacion.nota where tipo = 'correccion' and motivo_correccion = 'correccion de precio por modelo'), 3, 'tres notas de correccion con el motivo');
select is((select count(*)::int from operacion.nota n, jsonb_array_elements(n.snapshot_cliente->'lineas_texto') x where n.pedido_id = pg_temp.ped('cp-b:ped') and n.tipo = 'correccion' and x->>'modelo' = 'CP Modelo Uno' and x->>'precio_cent' = '18900'), 1, 'la nota al cliente muestra el precio por modelo');
select is((select count(*)::int from operacion.evento where tipo = 'correccion_precio_modelo'), 3, 'un evento de auditoria por correccion');
select is((select x->>'precio_cent' from operacion.evento e, jsonb_array_elements(e.payload->'despues') x where e.tipo = 'correccion_precio_modelo' and x->>'modelo' = 'CP Modelo Uno' order by e.id limit 1), '18500', 'el evento guarda el antes y el despues por modelo');
select is((select count(*)::int from seguridad.auditoria where tabla = 'operacion.pedido_linea' and accion = 'UPDATE'), 3, 'y deja registro en la auditoria');

-- Totales identicos antes y despues ----------------------------------------------------------------------------------------------
create temp table _despues as select pg_temp.snap() as s;
select is((select s - 'costo_modelo' from _despues), (select s - 'costo_modelo' from _antes), 'TODO igual antes y despues: asientos, lineas, hash, mayor, ventas por pedido, por cobrar, pagos, saldos, costo, kardex, utilidad, totales de nota, recargo, C1..C24 y CU');
select is((select s->'costo_modelo' from _despues), (select s->'costo_modelo' from _antes), 'el costo por modelo en el libro no cambia');
select is((select s->>'asientos' from _despues), (select s->>'asientos' from _antes), 'no se creo ningun asiento (la nota corregida suma cero)');
select is(contabilidad.verificar_cadena(), null::bigint, 'despues: la cadena de hash sigue integra');
select is((select count(*)::int from contabilidad.asiento a where not contabilidad.coincide_recalculo(a.id)), 0, 'despues: todo asiento coincide con su recalculo');
select is((select s->>'rojas' from _despues), '', 'despues: C1..C24 y CU en verde');
select is((select s->>'cuadre' from _despues), '', 'despues: Libro conciliado en verde');
select is((select array_agg(venta order by pedido_id) from (select pedido_id, sum(piezas_surtidas * precio_cent)::bigint as venta from operacion.pedido_linea group by pedido_id) x),
          (select array_agg(venta order by pedido_id) from _venta_antes), 'la venta por pedido (suma de renglones) es la misma');
select is((select jsonb_agg(jsonb_build_array(m.nombre_canonico, v) order by m.nombre_canonico) from (select modelo_id, sum(piezas_surtidas * precio_cent)::bigint v from operacion.pedido_linea group by modelo_id) x join catalogo.modelo m on m.id = x.modelo_id where m.nombre_canonico like 'CP Modelo%'),
          '[["CP Modelo Cinco",194000],["CP Modelo Cuatro",689000],["CP Modelo Dos",155000],["CP Modelo Tres",126000],["CP Modelo Uno",374000]]'::jsonb, 'la venta por modelo ahora si refleja los precios por modelo');

-- Idempotencia ---------------------------------------------------------------------------------------------------------------------
select is((operacion.corregir_precio_por_modelo('cp-1a', pg_temp.ped('cp-a:ped'), '{"CP Modelo Uno": 18500, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb, 'precios por modelo del dueno (sintetico)')->>'repetido')::boolean, true, 'misma clave y mismo contenido: devuelve lo guardado');
select throws_ok($$select operacion.corregir_precio_por_modelo('cp-1a', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp-a:ped'), '{"CP Modelo Uno": 19000, "CP Modelo Dos": 15000, "CP Modelo Tres": 18000}'::jsonb)$$, 'P0409', null, 'misma clave con otros precios: conflicto de idempotencia');
select is(operacion.corregir_precio_por_modelo('cp-1z', pg_temp.ped('cp-a:ped'), '{"CP Modelo Uno": 18500, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb)->>'estado', 'sin_cambio', 'otra clave con los mismos precios: sin cambio');
select is((select count(*)::int from operacion.nota where tipo = 'correccion'), 3, 'sin cambio no emite otra nota');
select is((select count(*)::int from operacion.evento where tipo = 'correccion_precio_modelo'), 3, 'ni otro evento');
select is((select s - 'costo_modelo' from (select pg_temp.snap() as s) q), (select s - 'costo_modelo' from _antes), 'y el estado completo sigue igual');

-- Reversibilidad: otra distribucion que tambien cuadra, y regreso a la deseada ------------------------------------------------------
select is(operacion.corregir_precio_por_modelo('cp-2a', pg_temp.ped('cp-a:ped'), '{"CP Modelo Uno": 19000, "CP Modelo Dos": 15000, "CP Modelo Tres": 18000}'::jsonb)->>'estado', 'corregido', 'se puede corregir otra vez (otra distribucion con el mismo total)');
select is((select sum(piezas_surtidas * precio_cent)::bigint from operacion.pedido_linea where pedido_id = pg_temp.ped('cp-a:ped')), 466000::bigint, 'mismo total');
select is(operacion.corregir_precio_por_modelo('cp-2b', pg_temp.ped('cp-a:ped'), '{"CP Modelo Uno": 18500, "CP Modelo Dos": 15500, "CP Modelo Tres": 18000}'::jsonb)->>'estado', 'corregido', 'y se regresa a la distribucion deseada');
select is((select string_agg(distinct precio_cent::text, ',' order by precio_cent::text) from operacion.pedido_linea where pedido_id = pg_temp.ped('cp-a:ped')), '15500,18000,18500', 'precios finales de A');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.ped('cp-a:ped') and tipo = 'correccion'), 3, 'cadena de notas de A: C1, C2 y C3 (cada una corrige a la anterior)');
select is((select s - 'costo_modelo' - 'hash' - 'asientos' - 'lineas' from (select pg_temp.snap() as s) q), (select s - 'costo_modelo' - 'hash' - 'asientos' - 'lineas' from _antes), 'tras la ida y la vuelta, totales, utilidad, saldos y comprobaciones iguales');
select is((select s->>'asientos' from (select pg_temp.snap() as s) q), (select s->>'asientos' from _antes), 'y ningun asiento nuevo');
select is(contabilidad.verificar_cadena(), null::bigint, 'cadena integra al final');

-- Privilegios de las funciones ------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc where proname = 'corregir_precio_por_modelo' and pronamespace = 'api'::regnamespace and not has_function_privilege('anon', oid, 'execute')), 1, 'anon sin execute sobre la api');
select is((select count(*)::int from pg_proc where proname = 'corregir_precio_por_modelo' and pronamespace = 'operacion'::regnamespace and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute'))), 0, 'la funcion de operacion no es ejecutable por la web');

select * from finish();
rollback;
