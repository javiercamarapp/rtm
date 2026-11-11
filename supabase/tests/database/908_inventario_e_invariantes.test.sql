-- pgTAP 908 (QA de punta a punta, seccion 3.14 de la matriz, GD-04, GD-28): inventario con promedio movil y los invariantes que deben
-- cumplirse despues de CUALQUIER secuencia de operaciones:
--   1. verificar_cadena_auditoria() = true;
--   2. valor y piezas de existencia_modelo = suma de movimientos, y nunca negativos;
--   3. cada evento con reversa_de aparece una sola vez;
--   4. suma de saldos de socios consistente con aportado + libro - saldo;
--   5. idempotencia: repetir las claves no cambia ningun conteo.
-- GD-04: 3 piezas con valor 27,463 y tres salidas de 1 dan 9,154; 9,155; 9,154 (suman 27,463).
-- GD-28: 400 secuencias aleatorias (semilla fija) de entradas y salidas: valor = suma entradas - suma salidas.
-- ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N908".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n908.socio@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n908.socio@example.test');
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);

create function pg_temp.pz(p_modelo text) returns int language sql as $$ select coalesce((select e.piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0) $$;
create function pg_temp.val(p_modelo text) returns bigint language sql as $$ select coalesce((select e.valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0) $$;

select catalogo.asegurar_modelo('N908 Marca', 'N908 Modelo A', 30000, 'ambas');
select catalogo.asegurar_sku('N908 Modelo A', 'Sandia');
select catalogo.asegurar_modelo('N908 Marca', 'N908 Modelo B', 30000, 'ambas');
select catalogo.asegurar_sku('N908 Modelo B', 'Uva');

-- GD-04: reparto de centavos en salidas sucesivas ---------------------------------------------------------------------------------------------
select operacion.registrar_movimiento('n908e1', 'N908 Modelo A', 'Sandia', 'bodega_omar', 'entrada_compra', 3, 27463, '2026-11-01');
select is((operacion.registrar_movimiento('n908s1', 'N908 Modelo A', 'Sandia', 'bodega_omar', 'salida_pedido', -1, null, '2026-11-02')->>'valor_cent')::bigint, -9154::bigint, 'GD-04: primera salida 91.54');
select is((operacion.registrar_movimiento('n908s2', 'N908 Modelo A', 'Sandia', 'bodega_omar', 'salida_pedido', -1, null, '2026-11-02')->>'valor_cent')::bigint, -9155::bigint, 'GD-04: segunda salida 91.55 (27,463 - 9,154 = 18,309; 18,309 / 2 = 9,154.5 -> medio arriba)');
select is((operacion.registrar_movimiento('n908s3', 'N908 Modelo A', 'Sandia', 'bodega_omar', 'salida_pedido', -1, null, '2026-11-02')->>'valor_cent')::bigint, -9154::bigint, 'GD-04: la ultima lleva el residuo exacto');
select is(pg_temp.pz('N908 Modelo A'), 0, 'GD-04: existencia 0');
select is(pg_temp.val('N908 Modelo A'), 0::bigint, 'GD-04: valor 0.00 exacto');

-- Entradas y salidas con costo puesto 102.25 (F03) ------------------------------------------------------------------------------------------------
select operacion.registrar_movimiento('n908e2', 'N908 Modelo B', 'Uva', 'bodega_omar', 'entrada_compra', 200, 2045000, '2026-11-03');
select is((select costo_prom_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'N908 Modelo B'), 10225::bigint, 'costo promedio 102.25');
select is((operacion.registrar_movimiento('n908s4', 'N908 Modelo B', 'Uva', 'bodega_omar', 'salida_pedido', -40, null, '2026-11-04')->>'valor_cent')::bigint, -409000::bigint, 'salida de 40 a promedio: 4,090.00');
select is(pg_temp.val('N908 Modelo B'), 1636000::bigint, 'quedan 160 pz con 16,360.00');
-- Una segunda entrada a otro costo cambia el promedio (GD-28): 100 pz a 120.00 -> (16,360 + 12,000) / 260
select operacion.registrar_movimiento('n908e3', 'N908 Modelo B', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1200000, '2026-11-05');
select is(pg_temp.val('N908 Modelo B'), 2836000::bigint, 'valor 28,360.00');
select is((operacion.registrar_movimiento('n908s5', 'N908 Modelo B', 'Uva', 'bodega_omar', 'salida_pedido', -26, null, '2026-11-06')->>'valor_cent')::bigint, -283600::bigint, '26 pz salen al nuevo promedio 109.0769 -> 2,836.00 (10 %)');
-- Reversa de una salida regresa a su costo original, no al promedio actual
select lives_ok($$select operacion.reversar_evento('n908r1', (select evento_id from operacion.movimiento_inventario where tipo = 'salida_pedido' and cantidad = -40 and valor_cent = -409000 limit 1), 'pedido anulado')$$, 'GD-28: reversa de la salida de 40');
select is(pg_temp.val('N908 Modelo B'), 2836000::bigint - 283600 + 409000, 'GD-28: las 40 piezas regresan a su costo original 4,090.00');
select is(pg_temp.pz('N908 Modelo B'), 200 - 40 + 100 - 26 + 40, 'GD-28: piezas 274');
select throws_ok($$select operacion.reversar_evento('n908r2', (select evento_id from operacion.movimiento_inventario where tipo = 'salida_pedido' and cantidad = -40 and valor_cent = -409000 limit 1), 'otra vez')$$, '23505', null, 'un evento solo se reversa una vez');
-- Salida mayor que la existencia
select throws_ok($$select operacion.registrar_movimiento('n908s6', 'N908 Modelo B', 'Uva', 'bodega_omar', 'salida_pedido', -9999, null, '2026-11-07')$$, 'P0423', null, 'salida mayor que la existencia: P0423 y nada cambia');
select is(pg_temp.pz('N908 Modelo B'), 274, 'tras el rechazo la existencia sigue en 274');
-- Cantidad cero y valor en cero
select throws_ok($$select operacion.registrar_movimiento('n908z1', 'N908 Modelo B', 'Uva', 'bodega_omar', 'entrada_compra', 0, 100, '2026-11-08')$$);
-- Idempotencia: repetir claves no cambia conteos
create temp table _c0 as select (select count(*) from operacion.movimiento_inventario) as mov, (select count(*) from operacion.evento) as ev, pg_temp.pz('N908 Modelo B') as pz;
select operacion.registrar_movimiento('n908e2', 'N908 Modelo B', 'Uva', 'bodega_omar', 'entrada_compra', 200, 2045000, '2026-11-03');
select operacion.registrar_movimiento('n908s4', 'N908 Modelo B', 'Uva', 'bodega_omar', 'salida_pedido', -40, null, '2026-11-04');
select is((select count(*) from operacion.movimiento_inventario), (select mov from _c0), 'idempotencia: repetir claves no agrega movimientos');
select is((select count(*) from operacion.evento), (select ev from _c0), 'idempotencia: ni eventos');
select is(pg_temp.pz('N908 Modelo B'), (select pz from _c0), 'idempotencia: ni piezas');

-- GD-28: 400 secuencias aleatorias; el valor y las piezas siempre son suma de movimientos ---------------------------------------------------------
select catalogo.asegurar_modelo('N908 Marca', 'N908 Modelo Azar', 30000, 'ambas');
select catalogo.asegurar_sku('N908 Modelo Azar', 'Mango');
select setseed(0.2718);
do $$
declare i int; v_pz int := 0; v_n int; v_clave text; v_dia int := 0;
begin
  for i in 1..400 loop
    v_clave := 'n908az' || i;
    if v_pz = 0 or random() < 0.45 then
      v_n := 1 + floor(random() * 50)::int;
      perform operacion.registrar_movimiento(v_clave, 'N908 Modelo Azar', 'Mango', 'bodega_omar', 'entrada_compra', v_n, (v_n * (5000 + floor(random() * 9000)))::bigint + floor(random() * 99)::bigint, '2026-11-09');
      v_pz := v_pz + v_n;
    else
      v_n := 1 + floor(random() * least(v_pz, 40))::int;
      perform operacion.registrar_movimiento(v_clave, 'N908 Modelo Azar', 'Mango', 'bodega_omar', 'salida_pedido', -v_n, null, '2026-11-09');
      v_pz := v_pz - v_n;
    end if;
  end loop;
end $$;

-- ---- Invariantes (seccion 3.14) ------------------------------------------------------------------------------------------------------------------
select is(seguridad.verificar_cadena_auditoria(), true, 'INV-1: la cadena de hashes de auditoria esta integra');
select is((select count(*)::int from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id
            where m.nombre_canonico like 'N908 %' and (e.piezas <> coalesce((select sum(mi.cantidad) from operacion.movimiento_inventario mi where mi.modelo_id = e.modelo_id), 0))), 0, 'INV-2: piezas = suma de movimientos en todos los modelos de la prueba');
select is((select count(*)::int from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id
            where m.nombre_canonico like 'N908 %' and (e.valor_cent <> coalesce((select sum(mi.valor_cent) from operacion.movimiento_inventario mi where mi.modelo_id = e.modelo_id), 0))), 0, 'INV-2: valor = suma de valores de movimientos (400 secuencias aleatorias incluidas)');
select is((select count(*)::int from operacion.existencia_modelo where piezas < 0 or (piezas = 0 and valor_cent <> 0)), 0, 'INV-2: nunca piezas negativas y existencia cero implica valor cero');
select is((select count(*)::int from (select reversa_de from operacion.evento where reversa_de is not null group by reversa_de having count(*) > 1) x), 0, 'INV-3: cada evento se reversa a lo mas una vez');
select is((select count(*)::int from operacion.evento r where r.reversa_de is not null and not exists (select 1 from operacion.evento o where o.id = r.reversa_de)), 0, 'INV-3: ningun contramovimiento sin original');
select is((select count(distinct folio) from operacion.evento), (select count(*) from operacion.evento), 'folios de evento unicos');
select is((select count(*)::int from catalogo.socio s where operacion.neto_socio(s.id) <> operacion.aportado_socio(s.id) + operacion.libro_socio(s.id) - operacion.saldo_socio(s.id)), 0, 'INV-4: neto de cada socio = aportado + libro - saldo (dos vias)');
select throws_ok($$update operacion.movimiento_inventario set cantidad = 1$$, '42501', null, 'los movimientos son de solo insercion');
select throws_ok($$delete from operacion.evento$$, '42501', null, 'los eventos no se borran');

select * from finish();
rollback;
