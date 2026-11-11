-- pgTAP: omar.mi_configuracion y omar.solicitar_toma (existencia neta de reservas, tope por toma, Omar activo, caducidad, idempotencia, permisos).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('t21.socio@example.test', 'socio', 'Javier', true), ('t21.omar@example.test', 'omar', null, true), ('t21.off@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('d2100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't21.socio@example.test'),
  ('d2100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't21.omar@example.test'),
  ('d2100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't21.off@example.test');
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000001', true);

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('T21 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('T21 Omar Cliente', 'T21 Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('T21 Cliente', 'Angelo');
select catalogo.asegurar_modelo('T21 Marca', 'T21 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('T21 Modelo 30K', 'Mango');
select catalogo.fijar_costo('t21k', 'Isaac', 'T21 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('t21p', 'T21 Cliente', 'T21 Modelo 30K', 15000, '2020-01-01', 'chat');
select catalogo.fijar_precio('t21po', (select nombre_canonico from catalogo.cliente where id = (select cliente_id from catalogo.persona_bodega order by id limit 1)), 'T21 Modelo 30K', 14000, '2020-01-01', 'chat');
select operacion.registrar_movimiento('t21m1', 'T21 Modelo 30K', 'Mango', 'bodega_omar', 'entrada_compra', 20, 200000);
create function pg_temp.sku() returns bigint language sql as $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'T21 Modelo 30K') and s.nombre_canonico = 'Mango' $$;

-- ---- mi_configuracion ------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is((omar.mi_configuracion()->>'tope_toma_piezas')::int, 15, 'configuracion: tope de 15 piezas por toma');
select is((omar.mi_configuracion()->>'caduca_horas')::int, 72, 'configuracion: caduca en 72 horas');
select is((omar.mi_configuracion()->>'renta_por_pieza_cent')::bigint, 200::bigint, 'configuracion: renta por pieza');
select is((select count(*)::int from jsonb_object_keys(omar.mi_configuracion())), 3, 'configuracion: solo tres llaves');

-- ---- solicitar_toma: caso feliz e idempotencia -------------------------------------------------------------------------------------------------
select is(omar.solicitar_toma('web:t21-a', 'T21 Modelo 30K', 'Mango', 5)->>'estado', 'pendiente', 'solicitar: nace pendiente');
select is((omar.solicitar_toma('web:t21-a', 'T21 Modelo 30K', 'Mango', 5)->>'repetido')::boolean, true, 'misma clave: repetido true');
select throws_ok($$select omar.solicitar_toma('web:t21-a', 'T21 Modelo 30K', 'Mango', 6)$$, 'P0409', null, 'misma clave con otro payload = conflicto');
select ok(omar.solicitar_toma('web:t21-a', 'T21 Modelo 30K', 'Mango', 5)->>'caduca_at' is not null, 'trae la caducidad');
select is(jsonb_typeof(omar.solicitar_toma('web:t21-a', 'T21 Modelo 30K', 'Mango', 5)->'repetido'), 'boolean', 'repetido es booleano');
reset role;
select is((select count(*)::int from operacion.toma_omar t where t.sku_id = pg_temp.sku()), 1, 'la repeticion no crea otra toma');
select is((select count(*)::int from operacion.reserva where origen_tipo = 'toma_omar' and sku_id = pg_temp.sku() and estado = 'activa'), 1, 'ni otra reserva');
select is((select estado || '|' || via || '|' || piezas || '|' || fecha_neg::text from operacion.toma_omar where sku_id = pg_temp.sku()), 'pendiente|telegram_omar|5|' || negocio.hoy()::text, 'toma pendiente con la fecha de la solicitud');
select is((select precio_cent from operacion.toma_omar where sku_id = pg_temp.sku()), 14000::bigint, 'a su tabulador');
select is((select count(*)::int from operacion.aviso where codigo = 'toma_pendiente' and 'telegram' = any (canales_previstos)), 1, 'aviso para la tarjeta de Telegram');
select is((select count(*)::int from operacion.movimiento_inventario where sku_id = pg_temp.sku() and tipo = 'salida_toma_omar'), 0, 'pendiente: sin kardex');

-- ---- limites de piezas -----------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select omar.solicitar_toma('web:t21-b0', 'T21 Modelo 30K', 'Mango', 0)$$, '23514', null, 'piezas 0');
select throws_ok($$select omar.solicitar_toma('web:t21-b1', 'T21 Modelo 30K', 'Mango', -2)$$, '23514', null, 'piezas negativas');
select throws_ok($$select omar.solicitar_toma('web:t21-b2', 'T21 Modelo 30K', 'Mango', null)$$, '23514', null, 'piezas nulas');
select throws_ok($$select omar.solicitar_toma('web:t21-b3', 'T21 Modelo 30K', 'Mango', 16)$$, '23514', null, 'sobre el tope de 15');
select throws_ok($$select omar.solicitar_toma('web:t21-b4', 'Modelo Que No Existe', 'Mango', 1)$$, '22023', null, 'modelo desconocido');
select throws_ok($$select omar.solicitar_toma('web:t21-b5', 'T21 Modelo 30K', 'Sabor Raro', 1)$$, '22023', null, 'sabor desconocido');
reset role;

-- ---- existencia neta: 20 fisicas, 5 en una toma pendiente, 10 en un pedido confirmado --------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000001', true);
select operacion.crear_pedido('t21ped', (select id from catalogo.cliente where nombre_canonico = 'T21 Cliente'), '[{"modelo":"T21 Modelo 30K","sabor":"Mango","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('t21pedc', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 't21ped'));
select is(operacion.existencia_neta_sku(pg_temp.sku()), 5, 'neta = 20 - 5 (toma pendiente) - 10 (pedido confirmado)');
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select omar.solicitar_toma('web:t21-c1', 'T21 Modelo 30K', 'Mango', 6)$$, 'P0423', null, 'mas que la neta: P0423');
select throws_like($$select omar.solicitar_toma('web:t21-c1', 'T21 Modelo 30K', 'Mango', 6)$$, '%disponible%', 'el mensaje no dice cuantas piezas estan reservadas ni por que') ;
select is(omar.solicitar_toma('web:t21-c2', 'T21 Modelo 30K', 'Mango', 5)->>'estado', 'pendiente', 'exactamente la neta: se acepta');
select throws_ok($$select omar.solicitar_toma('web:t21-c3', 'T21 Modelo 30K', 'Mango', 1)$$, 'P0423', null, 'sin existencia neta: P0423');
reset role;
-- Una pendiente caducada (mas de 72 h) ya no retiene piezas.
alter table operacion.toma_omar disable trigger toma_omar_t9;
update operacion.toma_omar set solicitada_at = now() - interval '100 hours' where piezas = 5 and estado = 'pendiente' and id = (select min(id) from operacion.toma_omar where sku_id = pg_temp.sku());
alter table operacion.toma_omar enable trigger toma_omar_t9;
select is(operacion.existencia_neta_sku(pg_temp.sku()), 5, 'la pendiente caducada libera sus 5 piezas');
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(omar.solicitar_toma('web:t21-c4', 'T21 Modelo 30K', 'Mango', 5)->>'estado', 'pendiente', 'y se puede volver a pedir');
reset role;
-- Una rechazada libera la reserva.
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000001', true);
select operacion.resolver_toma_omar('t21rej', (select max(id) from operacion.toma_omar), 'rechazar');
select is(operacion.existencia_neta_sku(pg_temp.sku()), 5, 'rechazar libera la reserva (la otra pendiente retiene 5, la caducada no)');

-- ---- Omar desactivado, socio y anon ------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select omar.solicitar_toma('web:t21-d1', 'T21 Modelo 30K', 'Mango', 1)$$, '42501', null, 'Omar desactivado: solicitar denegado');
select throws_ok($$select omar.mi_configuracion()$$, '42501', null, 'Omar desactivado: configuracion denegada');
reset role;
select set_config('request.jwt.claim.sub', 'd2100000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select omar.solicitar_toma('web:t21-d2', 'T21 Modelo 30K', 'Mango', 1)$$, '42501', null, 'socio: no es Omar');
select throws_ok($$select omar.mi_configuracion()$$, '42501', null, 'socio: configuracion denegada');
reset role;
set local role anon;
select throws_ok($$select omar.solicitar_toma('web:t21-d3', 'T21 Modelo 30K', 'Mango', 1)$$, '42501', null, 'anon: no ejecutable');
select throws_ok($$select omar.mi_configuracion()$$, '42501', null, 'anon: configuracion no ejecutable');
reset role;
select has_function('operacion', 'existencia_neta_sku', array['bigint'], 'existe la existencia neta');
select is(has_function_privilege('authenticated', 'operacion.existencia_neta_sku(bigint)', 'execute'), false, 'y no es ejecutable por la API');

select * from finish();
rollback;
