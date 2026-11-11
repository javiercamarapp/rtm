-- pgTAP F3b: resoluciones de una diferencia de recepcion (doc 14, seccion 5): castigar, reponer y acreditar. Los esperados salen de la regla del doc, no del codigo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3b.resol@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('74444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3b.resol@example.test');
select set_config('request.jwt.claim.sub', '74444444-4444-4444-4444-444444444444', true);

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.debe(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.haber(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.cuadra(p_clave text) returns boolean language sql as
  $$ select coalesce(sum(l.debe_cent) = sum(l.haber_cent), false) from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) $$;
create function pg_temp.compra(p_clave text) returns bigint language sql as $$ select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = $1) $$;

select catalogo.asegurar_modelo('F3R Marca', 'F3R Modelo', 50000, 'ambas');
select catalogo.asegurar_sku('F3R Modelo', 'A');
select catalogo.fijar_costo('f3rk1', 'Isaac', 'F3R Modelo', 10000, '2026-11-01', 'prueba');

-- Tres compras de 100 facturadas con 90 recibidas: cada una deja un faltante de 10 piezas x 100.00 = 1,000.00.
select operacion.crear_compra('f3r' || g, 'Isaac', '[{"modelo":"F3R Modelo","sabor":"A","pagadas":100,"facturadas":100}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', null, 'Angelo') from generate_series(1, 3) g;
select operacion.confirmar_compra('f3rc' || g, pg_temp.compra('f3r' || g)) from generate_series(1, 3) g;
select operacion.marcar_llego_merida('f3rm' || g, pg_temp.compra('f3r' || g)) from generate_series(1, 3) g;
select operacion.recibir_compra('f3rr' || g, pg_temp.compra('f3r' || g),
  jsonb_build_array(jsonb_build_object('linea_id', (select cl.id from operacion.compra_linea cl where cl.compra_id = pg_temp.compra('f3r' || g)), 'sabor', 'A', 'piezas', 90)), now()) from generate_series(1, 3) g;
select pg_temp.flush();
select is((select count(*)::int from operacion.compra_diferencia where valor_cent = 100000 and piezas = 10), 3, 'tres faltantes de 10 piezas por 1,000.00');
select is(operacion.saldo_puente(), 300000::bigint, 'el puente operativo suma los tres faltantes');
select is(contabilidad.saldo('1340'), operacion.saldo_puente(), 'y el puente del libro coincide');

create temp table _d as select row_number() over (order by id) as n, id from operacion.compra_diferencia where valor_cent = 100000;

-- Castigar -----------------------------------------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.resolver_diferencia('f3rx0', (select id from _d where n = 1), 'regalar')$$, '22023', null, 'una resolucion desconocida se rechaza');
select lives_ok($$select operacion.resolver_diferencia('f3rx1', (select id from _d where n = 1), 'castigar', 'se perdio en el camino')$$, 'castigar el faltante');
select pg_temp.flush();
select is(pg_temp.debe('f3rx1', '5300'), 100000::bigint, 'castigar: Dr 5300 faltantes por 1,000.00');
select is(pg_temp.haber('f3rx1', '1340'), 100000::bigint, 'castigar: Cr 1340 saca el monto del puente');
select ok(pg_temp.cuadra('f3rx1'), 'el asiento de castigar cuadra');
select is(operacion.saldo_puente(), 200000::bigint, 'el puente operativo baja 1,000.00');
select is(contabilidad.saldo('1340'), operacion.saldo_puente(), 'el puente del libro sigue igual al operativo');
select throws_ok($$select operacion.resolver_diferencia('f3rx1b', (select id from _d where n = 1), 'castigar')$$, 'P0428', null, 'una diferencia resuelta no se resuelve dos veces');
select throws_ok($$select operacion.asignar_diferencia('f3rx1c', (select id from _d where n = 1), 'socio', 'Angelo')$$, 'P0428', null, 'ni se reasigna despues de castigada');

-- Reponer ------------------------------------------------------------------------------------------------------------------------------------------
select is((select piezas from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_norm = catalogo.normalizar('F3R Modelo'))), 270, 'antes de reponer hay 270 piezas');
select lives_ok($$select operacion.resolver_diferencia('f3rx2', (select id from _d where n = 2), 'reponer')$$, 'reponer el faltante');
select pg_temp.flush();
select is(pg_temp.debe('f3rx2', '1310'), 100000::bigint, 'reponer: Dr 1310 inventario por 1,000.00');
select is(pg_temp.haber('f3rx2', '1340'), 100000::bigint, 'reponer: Cr 1340 saca el monto del puente');
select ok(pg_temp.cuadra('f3rx2'), 'el asiento de reponer cuadra');
select is((select piezas from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_norm = catalogo.normalizar('F3R Modelo'))), 280, 'las 10 piezas repuestas entran al kardex');
select is(operacion.saldo_puente(), 100000::bigint, 'el puente operativo queda en 1,000.00');
select is(contabilidad.saldo('1340'), operacion.saldo_puente(), 'el puente del libro sigue igual al operativo');

-- Acreditar (reclamo al proveedor) -----------------------------------------------------------------------------------------------------------------
select lives_ok($$select operacion.asignar_diferencia('f3rx3', (select id from _d where n = 3), 'proveedor', null, 'se acredita')$$, 'acreditar el faltante al proveedor');
select pg_temp.flush();
select is(pg_temp.debe('f3rx3', '2110'), 100000::bigint, 'acreditar: Dr 2110 baja lo que se debe a Isaac');
select is(pg_temp.haber('f3rx3', '1340'), 100000::bigint, 'acreditar: Cr 1340 saca el monto del puente');
select is(operacion.saldo_puente(), 0::bigint, 'el puente queda en cero');

-- Comprobaciones tras las tres resoluciones --------------------------------------------------------------------------------------------------------
select is((select count(*)::int from contabilidad.reproducir_saldos() where not ok), 0, 'todos los auxiliares coinciden con el libro');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C16'), 'C16: la utilidad comercial incluye el castigo');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C19'), 'C19: puente operativo contra 1340');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C5'), 'C5: inventario contra kardex');
select is(((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy()))->>'costo_ventas_cent')::bigint, 100000::bigint, 'el castigo aparece en el costo del estado de resultados');

-- Comision de terminal y gastos variables y fijos entran por gasto de socio ---------------------------------------------------------------------------
select operacion.registrar_gasto_socio('f3rg1', 'Javier', 4000, 'terminal');
select pg_temp.flush();
select is(pg_temp.debe('f3rg1', '6140'), 4000::bigint, 'comision de terminal: Dr 6140');
select is(((contabilidad.estado_resultados(negocio.hoy(), negocio.hoy()))->>'gastos_variables_cent')::bigint, 4000::bigint, 'y es gasto variable del estado de resultados');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C22'), 'C22 gastos');

select * from finish();
rollback;
