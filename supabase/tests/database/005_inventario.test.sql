-- pgTAP: inventario (F1). Cifras de G3/G4/G5 del documento de Angelo; los esperados no salen del codigo.
begin;
select plan(30);

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('inv.socio@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('31111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inv.socio@example.test');
select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);

select catalogo.asegurar_modelo('Marca Inv', 'Marca Inv Nexa 50K', 50000, 'ambas');
select catalogo.asegurar_modelo('Marca Inv', 'Marca Inv Otro 40K', 40000, 'angelo');
select catalogo.asegurar_sku('Marca Inv Nexa 50K', 'Sin sabor');
select catalogo.asegurar_sku('Marca Inv Nexa 50K', 'Sabor A');
select catalogo.asegurar_sku('Marca Inv Nexa 50K', 'Sabor B');
select catalogo.asegurar_sku('Marca Inv Otro 40K', 'Sabor A');

-- G3/G5: entrada de 1,536 con costo puesto 140,615.00 = 14,061,500 centavos ---------------------------------------------------
select is((operacion.registrar_movimiento('e1', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'entrada_compra', 1536, 14061500, '2026-11-10', 'compra de prueba')->>'piezas_modelo')::int, 1536, 'entrada: 1,536 piezas');
select is((select costo_prom_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Nexa 50K'), 9155::bigint, 'costo promedio 9,154.6224 centavos -> 9,155 al centavo');
select is((operacion.registrar_movimiento('s1', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'salida_pedido', -100, null, '2026-11-10')->>'valor_cent')::bigint, -915462::bigint, 'G5: salida de 100 = 915,462 centavos');
select is((select valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Nexa 50K'), 13146038::bigint, 'G5: restan 13,146,038 centavos');
select is((operacion.registrar_movimiento('s2', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'salida_pedido', -100, null, '2026-11-10')->>'valor_cent')::bigint, -915462::bigint, 'G5: segunda salida de 100 = 915,462');
select is((operacion.registrar_movimiento('s3', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'salida_pedido', -1336, null, '2026-11-10')->>'valor_modelo_cent')::bigint, 0::bigint, 'G5: sacar todo deja el inventario en 0.00 exacto (residuo en la ultima salida)');
select is((select piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Nexa 50K'), 0, 'cero piezas');

-- Bloqueos --------------------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.registrar_movimiento('s4', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'salida_pedido', -1, null, '2026-11-10')$$, 'P0423', null, 'existencia negativa bloqueada');
select throws_ok($$select operacion.registrar_movimiento('e2', 'Marca Inv Nexa 50K', 'Sabor A', 'bodega_omar', 'entrada_compra', 10, 90000, '2026-11-09')$$, 'P0422', null, 'fecha anterior al ultimo movimiento del modelo bloqueada');
select throws_ok($$select operacion.registrar_movimiento('e3', 'Marca Inv Nexa 50K', 'Sabor A', 'bodega_omar', 'entrada_compra', 10, null, '2026-11-10')$$, '23502', null, 'una entrada sin valor se rechaza');
select throws_ok($$update operacion.movimiento_inventario set cantidad = 5$$, '42501', null, 'UPDATE de movimientos falla incluso como propietario');
select throws_ok($$delete from operacion.movimiento_inventario$$, '42501', null, 'DELETE de movimientos falla');
select throws_ok($$update operacion.evento set tipo = 'x'$$, '42501', null, 'los eventos no se editan');

-- Idempotencia y reversa -------------------------------------------------------------------------------------------------------
select is(operacion.registrar_movimiento('e1', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'entrada_compra', 1536, 14061500, '2026-11-10', 'compra de prueba')->>'movimiento_id', (select id::text from operacion.movimiento_inventario where tipo = 'entrada_compra' and cantidad = 1536 limit 1), 'repetir la clave no duplica');
select throws_ok($$select operacion.registrar_movimiento('e1', 'Marca Inv Nexa 50K', 'Sin sabor', 'bodega_omar', 'entrada_compra', 1500, 14061500, '2026-11-10')$$, 'P0409', null, 'misma clave con otro payload = 409');
select operacion.registrar_movimiento('e4', 'Marca Inv Otro 40K', 'Sabor A', 'bodega_omar', 'entrada_compra', 20, 200000, negocio.hoy());
select operacion.registrar_movimiento('e5', 'Marca Inv Otro 40K', 'Sabor A', 'bodega_omar', 'salida_pedido', -5, null, negocio.hoy());
select lives_ok($$select operacion.reversar_evento('r1', (select evento_id from operacion.movimiento_inventario where tipo = 'salida_pedido' and cantidad = -5), 'pedido anulado')$$, 'reversa de una salida');
select is((select piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Otro 40K'), 20, 'la reversa devuelve las piezas');
select is((select valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Otro 40K'), 200000::bigint, 'y el valor exacto');
select throws_ok($$select operacion.reversar_evento('r2', (select evento_id from operacion.movimiento_inventario where tipo = 'salida_pedido' and cantidad = -5), 'otra vez')$$, '23505', null, 'un evento solo se reversa una vez');
select throws_ok($$select operacion.reversar_evento('r3', (select evento_id from operacion.movimiento_inventario where tipo = 'entrada_compra' and cantidad = 20), '')$$, '23502', null, 'la reversa exige motivo');

-- Eventos con folio sin huecos ------------------------------------------------------------------------------------------------
select is((select count(distinct folio) from operacion.evento), (select count(*) from operacion.evento), 'folios de evento unicos');
select matches((select folio from operacion.evento order by id limit 1), '^E-\d{4}$', 'folio E-0001');

-- G4: conteo fisico. 1,536 facturadas en "Sin sabor"; el conteo por sabor suma 1,524; la diferencia son 12 piezas -------------------------------
select catalogo.asegurar_modelo('Marca Inv', 'Marca Inv Puente 50K', 50000, 'ambas');
select catalogo.asegurar_sku('Marca Inv Puente 50K', 'Sin sabor');
select catalogo.asegurar_sku('Marca Inv Puente 50K', 'S' || g) from generate_series(1, 10) g;
select operacion.registrar_movimiento('g4e', 'Marca Inv Puente 50K', 'Sin sabor', 'bodega_omar', 'entrada_compra', 1536, 14061500, negocio.hoy());
select operacion.abrir_conteo('g4a', 'bodega_omar', 'cuadre_inicial', now());
select throws_ok($$select operacion.abrir_conteo('g4x', 'bodega_omar', 'semanal', null)$$, '23502', null, 'el conteo exige fecha y hora');
select lives_ok($$select operacion.cerrar_conteo('g4c', (select max(id) from operacion.conteo), (
  select jsonb_agg(x) from (
    select jsonb_build_object('modelo', 'Marca Inv Puente 50K', 'sabor', 'Sin sabor', 'contado', 0) x
    union all
    select jsonb_build_object('modelo', 'Marca Inv Puente 50K', 'sabor', 'S' || n, 'contado', c)
    from unnest(array[175,192,200,200,166,28,100,159,133,171]) with ordinality t(c, n)) q))$$, 'cierra el conteo');
select is((select piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Puente 50K'), 1524, 'G4: piezas fisicas 1,524');
select is((select valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'Marca Inv Puente 50K'), 13951645::bigint, 'G4: inventario restante $139,516.45 (140,615.00 - 1,098.55)');

-- "Explicar este numero": la cifra, su segunda via y los movimientos que la forman.
select is(api.explicar_cifra('existencia:modelo:' || (select id from catalogo.modelo where nombre_canonico = 'Marca Inv Puente 50K'))->'comprobacion'->>'cuadra', 'true', 'explicar existencia: las dos vias cuadran');
select is((api.explicar_cifra('existencia:modelo:' || (select id from catalogo.modelo where nombre_canonico = 'Marca Inv Puente 50K'))->>'valor')::int, 1524, 'explicar existencia: 1,524 piezas');
select ok(jsonb_array_length(api.explicar_cifra('existencia:modelo:' || (select id from catalogo.modelo where nombre_canonico = 'Marca Inv Puente 50K'))->'movimientos') >= 11, 'explicar existencia: trae los movimientos con hora y autor');
select throws_ok($$select api.explicar_cifra('cualquier cosa')$$, '22023', null, 'cifra desconocida rechazada');

select * from finish();
rollback;
