-- pgTAP: una toma autorizada despues del corte semanal se asienta en la semana abierta vigente (no se pierde); caducidad; inmutabilidad de la toma.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('t23.socio@example.test', 'socio', 'Javier', true), ('t23.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('d2300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't23.socio@example.test'),
  ('d2300000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't23.omar@example.test');
select set_config('request.jwt.claim.sub', 'd2300000-0000-0000-0000-000000000001', true);

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('T23 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('T23 Omar Cliente', 'T23 Omar');
  end if;
end $$;
select catalogo.asegurar_modelo('T23 Marca', 'T23 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('T23 Modelo 30K', 'Mango');
select catalogo.fijar_precio('t23po', (select nombre_canonico from catalogo.cliente where id = (select cliente_id from catalogo.persona_bodega order by id limit 1)), 'T23 Modelo 30K', 15000, '2020-01-01', 'chat');
select operacion.registrar_movimiento('t23m1', 'T23 Modelo 30K', 'Mango', 'bodega_omar', 'entrada_compra', 100, 1000000, '2020-05-25');
create function pg_temp.tid(p text) returns bigint language sql as $$ select (resultado->>'toma_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.sem_hoy() returns date language sql as $$ select operacion.semana_omar_ini(negocio.hoy()) $$;

-- Toma pedida en la semana del 2020-06-01 (pendiente); la semana se liquida con decision expresa sobre la pendiente.
select operacion.registrar_toma_omar('t23a', '{"modelo":"T23 Modelo 30K","sabor":"Mango"}'::jsonb, 3, 15000, '2020-06-02', 'telegram_omar');
select is((operacion.cerrar_liquidacion_omar('t23liq', '2020-06-01', true)->>'tomas_cent')::bigint, 0::bigint, 'la semana se liquida sin la pendiente');
select is((select tomas_cent from operacion.liquidacion_omar where semana_ini = '2020-06-01'), 0::bigint, 'liquidacion con tomas 0');

-- Autorizada despues del corte: se asienta en la semana vigente.
select is(operacion.resolver_toma_omar('t23a1', pg_temp.tid('t23a'), 'autorizar')->>'estado', 'autorizada', 'se autoriza despues del corte');
select is((select fecha_neg from operacion.toma_omar where id = pg_temp.tid('t23a')), negocio.hoy(), 'la toma pasa a la fecha de asiento de hoy');
select is((operacion.saldo_omar_semana(pg_temp.sem_hoy())->>'tomas_cent')::bigint, 45000::bigint, 'entra a la semana abierta vigente: 3 x 150.00');
select is((operacion.saldo_omar_semana('2020-06-01')->>'tomas_cent')::bigint, 0::bigint, 'la semana cerrada no cambia');
select is((select tomas_cent from operacion.liquidacion_omar where semana_ini = '2020-06-01'), 0::bigint, 'y su liquidacion tampoco');
select is((select (payload->>'fecha_solicitud') from operacion.evento where tipo = 'toma_omar_autorizar' order by id desc limit 1), '2020-06-02', 'el evento guarda la fecha de la solicitud');
select is((select count(*)::int from operacion.movimiento_inventario where tipo = 'salida_toma_omar' and fecha_neg = negocio.hoy() and cantidad = -3), 1, 'y el movimiento de inventario es de hoy');

select operacion.registrar_toma_omar('t23b', '{"modelo":"T23 Modelo 30K","sabor":"Mango"}'::jsonb, 2, 15000, null, 'telegram_omar');
select ok(pg_temp.tid('t23b') is not null, 'la pendiente nace');

-- Caducidad: una pendiente de mas de 72 h no se autoriza; se cierra como caducada.
alter table operacion.toma_omar disable trigger toma_omar_t9;
update operacion.toma_omar set solicitada_at = now() - interval '100 hours' where id = pg_temp.tid('t23b');
alter table operacion.toma_omar enable trigger toma_omar_t9;
select throws_ok($$select operacion.resolver_toma_omar('t23b1', pg_temp.tid('t23b'), 'autorizar')$$, 'P0428', null, 'caducada: no se autoriza');
select is(operacion.resolver_toma_omar('t23b2', pg_temp.tid('t23b'), 'caducar')->>'estado', 'caducada', 'se cierra como caducada');
select is((select count(*)::int from operacion.reserva where origen_tipo = 'toma_omar' and origen_id = pg_temp.tid('t23b') and estado = 'activa'), 0, 'y libera su reserva');
select throws_ok($$select operacion.resolver_toma_omar('t23b3', pg_temp.tid('t23b'), 'autorizar')$$, 'P0428', null, 'una ya cerrada no se autoriza');

-- Inmutabilidad: la toma solo cambia de estado (y la fecha de asiento al autorizar).
select throws_ok($$update operacion.toma_omar set fecha_neg = '2020-01-01' where id = (select (resultado->>'toma_id')::bigint from seguridad.operacion where clave = 't23a')$$, '42501', null, 'una autorizada no cambia de fecha');
select throws_ok($$update operacion.toma_omar set piezas = 99 where id = (select (resultado->>'toma_id')::bigint from seguridad.operacion where clave = 't23a')$$, '42501', null, 'ni de piezas');
select throws_ok($$update operacion.toma_omar set piezas = 99 where estado = 'caducada'$$, '42501', null, 'una pendiente tampoco cambia de piezas');
select throws_ok($$delete from operacion.toma_omar$$, '42501', null, 'las tomas no se borran');

-- Pendiente de la semana abierta: conserva su fecha al autorizarse (semana 2031, aun sin liquidar).
select operacion.registrar_toma_omar('t23c', '{"modelo":"T23 Modelo 30K","sabor":"Mango"}'::jsonb, 1, 15000, null, 'telegram_omar');
alter table operacion.toma_omar disable trigger toma_omar_t9;
update operacion.toma_omar set fecha_neg = '2031-03-05' where id = pg_temp.tid('t23c');
alter table operacion.toma_omar enable trigger toma_omar_t9;
select operacion.resolver_toma_omar('t23c1', pg_temp.tid('t23c'), 'autorizar');
select is((select fecha_neg from operacion.toma_omar where id = pg_temp.tid('t23c')), '2031-03-05'::date, 'si su semana sigue abierta, la toma conserva su fecha');
select is((operacion.saldo_omar_semana('2031-03-03')->>'tomas_cent')::bigint, 15000::bigint, 'y cuenta en su propia semana');
select is(operacion.resolver_toma_omar('t23c2', pg_temp.tid('t23c'), 'deshacer')->>'estado', 'deshecha', 'una toma de semana abierta se deshace');

-- Flujo completo desde la web de Omar: solicitar y autorizar.
select set_config('request.jwt.claim.sub', 'd2300000-0000-0000-0000-000000000002', true);
set local role authenticated;
select is(omar.solicitar_toma('web:t23-o1', 'T23 Modelo 30K', 'Mango', 4)->>'estado', 'pendiente', 'Omar solicita desde la web');
reset role;
select set_config('request.jwt.claim.sub', 'd2300000-0000-0000-0000-000000000001', true);
select is(operacion.resolver_toma_omar('t23o2', (select max(id) from operacion.toma_omar), 'rechazar')->>'estado', 'rechazada', 'un socio la rechaza');
select is((select estado from operacion.toma_omar where id = (select max(id) from operacion.toma_omar)), 'rechazada', 'y queda rechazada');

select is((operacion.cerrar_liquidacion_omar('t23liq2', pg_temp.sem_hoy(), false, pg_temp.sem_hoy() + 7)->>'tomas_cent')::bigint, 45000::bigint, 'al cerrar la semana vigente la toma SI entra a una liquidacion');

select * from finish();
rollback;
