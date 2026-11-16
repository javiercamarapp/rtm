-- pgTAP: "Por pagar" incluye la renta de Omar como renglon aparte (migracion 20261114700100). Cifras hechas a mano, datos sinteticos "A12R".
--   Karen: 20 piezas x 10.00 = 200.00 (20000 cent). Isaac: 10 piezas x 50.00 = 500.00 (50000). Renta: 20 piezas enviadas desde bodega x 2.00 = 40.00 (4000). Total 74000.
begin;
-- La persona de bodega es prerequisito de enviar pedidos (renta de Omar): una base limpia no la trae, asi que la prueba la da de alta como cliente interno de prueba.
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform set_config('rtm.canal', 'importacion', true);
    perform catalogo.asegurar_cliente('A12P Bodega Prueba', 'Javier', 'credito_interno');
    perform catalogo.asegurar_persona_bodega('A12P Bodega Prueba', 'A12P Bodega Prueba');
    perform set_config('rtm.canal', '', true);
  end if;
end $$;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a12r.jav@example.test', 'socio', 'Javier', true), ('a12r.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a12a0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a12r.jav@example.test'),
  ('a12a0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a12r.omar@example.test');
create function pg_temp.como(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', $1, true) $$;
select pg_temp.como('a12a0000-0000-0000-0000-000000000001');
select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_cliente('A12R Cliente', 'Javier');
select catalogo.asegurar_modelo('A12R Marca', 'A12R Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('A12R Modelo', 'Uva');
select catalogo.fijar_costo('a12r:k', 'Karen', 'A12R Modelo', 1000, negocio.hoy() - 90, 'prueba');
select catalogo.fijar_costo('a12r:i', 'Isaac', 'A12R Modelo', 5000, negocio.hoy() - 90, 'prueba');
select catalogo.fijar_precio('a12r:p', 'A12R Cliente', 'A12R Modelo', 9000, negocio.hoy() - 90, 'documento');
select operacion.registrar_movimiento('a12r:m', 'A12R Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 100, 500000, negocio.hoy() - 5);
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'A12R Cliente' $$;
create function pg_temp.renglon(c text) returns bigint language sql as $$ select (r->>'monto_cent')::bigint from jsonb_array_elements(api.por_pagar()->'renglones') r where r->>'clave' = $1 $$;
create temp table _b0 as select pg_temp.renglon('renta_omar') as renta, pg_temp.renglon('karen') as karen, pg_temp.renglon('isaac') as isaac, (api.por_pagar()->>'total_cent')::bigint as total;
select contabilidad.asentar_pendientes();
create temp table _base as select count(*)::int as rojas from contabilidad.comprobaciones() c where not c.ok and c.bloqueante;

select is((api.por_pagar()->>'total_cent')::bigint, (select karen + isaac + renta from _b0), 'antes de los pedidos: total = suma de renglones');
select is(jsonb_array_length(api.por_pagar()->'renglones'), 3, 'tres renglones: Isaac, Karen y renta de Omar');

select operacion.ds_crear_pedido('a12r-k', pg_temp.cli(), '[{"modelo":"A12R Modelo","sabor":"Uva","piezas":20}]'::jsonb, 'karen_directo', null, null, 'cliente', null, 'K-1', 0, 0, negocio.hoy());
select operacion.confirmar_pedido('a12r-kc', pg_temp.ped('a12r-k:ped'));
select operacion.enviar_pedido('a12r-ke', pg_temp.ped('a12r-k:ped'), null, null, null, true);
select operacion.ds_crear_pedido('a12r-i', pg_temp.cli(), '[{"modelo":"A12R Modelo","sabor":"Uva","piezas":10}]'::jsonb, 'isaac_directo', null, null, 'cliente', null, 'I-1', 0, 0, negocio.hoy());
select operacion.confirmar_pedido('a12r-ic', pg_temp.ped('a12r-i:ped'));
select operacion.enviar_pedido('a12r-ie', pg_temp.ped('a12r-i:ped'), null, null, null, true);
select operacion.crear_pedido('a12r-b', pg_temp.cli(), '[{"modelo":"A12R Modelo","sabor":"Uva","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy(), null, 0);
select operacion.confirmar_pedido('a12r-bc', pg_temp.ped('a12r-b'));
select operacion.enviar_pedido('a12r-be', pg_temp.ped('a12r-b'), null, null, null, true);
set constraints all immediate;

select is(pg_temp.renglon('karen') - (select karen from _b0), 20000::bigint, 'renglon Karen: +200.00');
select is(pg_temp.renglon('isaac') - (select isaac from _b0), 50000::bigint, 'renglon Isaac: +500.00');
select is(pg_temp.renglon('renta_omar') - (select renta from _b0), 4000::bigint, 'renglon renta de Omar: +20 piezas x 2.00 = 40.00');
select is((api.por_pagar()->>'total_cent')::bigint - (select total from _b0), 74000::bigint, 'total sube 740.00 = Isaac + Karen + renta de Omar');
select is((api.por_pagar()->>'total_cent')::bigint, (select sum((r->>'monto_cent')::bigint)::bigint from jsonb_array_elements(api.por_pagar()->'renglones') r), 'el total es la suma de los renglones (cada uno se ve separado)');
select is(pg_temp.renglon('renta_omar'), (operacion.renta_estado(negocio.hoy())->>'por_pagar_cent')::bigint, 'la renta es la misma cifra de Pago renta (cuenta 2210)');
select is(pg_temp.renglon('renta_omar'), contabilidad.saldo('2210')::bigint, 'la renta coincide con el saldo del Mayor 2210 (sin duplicar)');
select is((api.pulso()->'por_pagar'->>'total_cent')::bigint - (select total from _b0), 74000::bigint, 'api.pulso trae el mismo por pagar');
select is((api.pulso()->>'por_pagar_isaac_cent')::bigint, pg_temp.renglon('isaac'), 'la cifra Por pagar a Isaac del pulso no cambia');

-- Un pago de renta baja SOLO el renglon de Omar.
select api.registrar_pago_renta('a12r-po', 1500);
select is(pg_temp.renglon('renta_omar') - (select renta from _b0), 2500::bigint, 'pagar 15.00 de renta deja +25.00 en el renglon de Omar');
select is(pg_temp.renglon('karen') - (select karen from _b0), 20000::bigint, 'el pago de renta no mueve a Karen');

-- Lo que no cambia: el libro y sus comprobaciones.
select contabilidad.asentar_pendientes();
select is((select count(*)::int from contabilidad.comprobaciones() c where not c.ok and c.bloqueante), (select rojas from _base), 'las comprobaciones bloqueantes (C1..C24) no cambian');

-- Bot
select agente.registrar_miembro(5120099, 'javier');
select is((agente.consulta('por_pagar') -> 'lineas' -> 3 ->> 'centavos')::bigint - (select total from _b0), 72500::bigint, 'el bot: total por pagar (tras el pago de renta)');
select is((agente.consulta('por_pagar') -> 'lineas' -> 2 ->> 'etiqueta'), 'Renta de Omar', 'el bot: renglon de Omar aparte');

-- Omar no usa esta lectura de socios (ve la suya: omar.mi_pago_renta).
select pg_temp.como('a12a0000-0000-0000-0000-000000000002');
select throws_ok($$select api.por_pagar()$$, '42501', null, 'Omar no lee el por pagar de la empresa (costos de proveedores)');
select is((omar.mi_pago_renta()->'estado'->>'por_pagar_cent')::bigint - (select renta from _b0), 2500::bigint, 'Omar SI ve su propia renta');
select * from finish();
rollback;
