-- pgTAP: decision del dueno (13-nov): el pago de la sociedad a un proveedor se BLOQUEA sin saldo suficiente en la Caja de la empresa (guarda en la funcion de escritura, antes de crear
-- evento o asiento). Cubre saldo insuficiente, suficiente, exacto, dos pagos que juntos exceden el saldo (el segundo se rechaza: con una sola transaccion es la forma determinista de la
-- concurrencia; el bloqueo exclusivo que toma la funcion serializa dos sesiones reales, verificado a mano con dos psql) y anulacion; las otras vias siguen funcionando. Tras cada caso el
-- Libro conciliado queda verdadero y se fuerza el trigger diferido (`set constraints all immediate`) para que un descuadre de asiento no se esconda hasta el COMMIT.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4q.ang@example.test', 'socio', 'Angelo', true), ('a4q.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4q.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4q.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777c1' else '77777777-7777-7777-7777-7777777777c2' end, true) $$;
create function pg_temp.caja() returns bigint language sql as $$ select operacion.saldo_efectivo((select id from operacion.cuenta_efectivo where nombre = 'Caja de la empresa')) $$;
create function pg_temp.conciliado() returns boolean language plpgsql as $$
begin
  perform contabilidad.asentar_pendientes();
  set constraints all immediate;
  return (operacion.cuadre_socios()->>'libro_conciliado')::boolean;
end $$;
create function pg_temp.n_eventos() returns bigint language sql as $$ select count(*) from operacion.evento where tipo = 'pago_proveedor_sociedad' $$;
create function pg_temp.n_asientos() returns bigint language sql as $$ select count(*) from contabilidad.asiento $$;

select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('A4Q Marca', 'A4Q Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('A4Q Modelo', 'Uva');
select catalogo.fijar_costo('a4q-c', 'Isaac', 'A4Q Modelo', 7777, negocio.hoy() - 60, 'prueba');
select operacion.crear_compra('a4q-oc', 'Isaac', '[{"modelo":"A4Q Modelo","sabor":"Uva","pagadas":100,"facturadas":100}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', 'Angelo', 'Angelo');
select operacion.confirmar_compra('a4q-occ', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'a4q-oc'));

-- Saldo insuficiente (caja en cero): se rechaza con el mensaje claro y antes de crear evento, asiento o movimiento.
select is(pg_temp.caja(), 0::bigint, 'la caja de la empresa parte en cero');
create temp table _antes as select pg_temp.n_eventos() as ev, pg_temp.n_asientos() as asi, (select count(*) from operacion.cuenta_proveedor_mov) as mov, (select count(*) from operacion.cuenta_efectivo_mov) as ef;
select throws_ok($$select operacion.registrar_pago_proveedor_sociedad('a4q-p0', 'Isaac', 100000, negocio.hoy(), 'sin saldo')$$, '23514',
  'no hay saldo en la caja de la sociedad; registra el pago como cobro de cliente aplicado al proveedor o como pago de un socio con su dinero', 'sin saldo en caja: el pago se bloquea con un mensaje claro');
select is(pg_temp.caja(), 0::bigint, 'y la caja no queda en negativo');
select is((select (pg_temp.n_eventos(), pg_temp.n_asientos(), (select count(*) from operacion.cuenta_proveedor_mov), (select count(*) from operacion.cuenta_efectivo_mov))::text), (select (ev, asi, mov, ef)::text from _antes), 'no se creo evento, asiento ni movimiento');
select is(pg_temp.conciliado(), true, 'libro conciliado tras el rechazo');
select throws_ok($$select operacion.registrar_pago_proveedor_sociedad('a4q-p0', 'Isaac', 100000, negocio.hoy(), 'sin saldo')$$, '23514', null, 'repetir la misma clave tras el rechazo no lo deja pasar (nada quedo guardado)');

-- Las otras vias siguen: pago de un socio con dinero propio (reembolso).
select operacion.pago_proveedor_de_socio('a4q-pj', 'Isaac', 30000, 'Angelo', 'dinero_propio', negocio.hoy());
select is((select count(*)::int from operacion.cuenta_proveedor_mov where concepto = 'pago_socio'), 1, 'el pago de un socio con dinero propio sigue funcionando sin saldo en la caja');
select is(pg_temp.conciliado(), true, 'libro conciliado tras el pago del socio');

-- Saldo suficiente.
select operacion.registrar_aportacion('a4q-dep', 'Angelo', 150000, 'deposito a caja', 'reembolso');
select is(pg_temp.caja(), 150000::bigint, 'el deposito entra a la caja de la empresa');
select lives_ok($$select operacion.registrar_pago_proveedor_sociedad('a4q-p1', 'Isaac', 100000, negocio.hoy(), 'con saldo')$$, 'con saldo suficiente el pago pasa');
select is(pg_temp.caja(), 50000::bigint, 'la caja baja por el pago');
select is(pg_temp.conciliado(), true, 'libro conciliado tras el pago con saldo');

-- Dos pagos que juntos exceden el saldo: el primero (exacto) pasa, el segundo se rechaza.
select lives_ok($$select operacion.registrar_pago_proveedor_sociedad('a4q-p2', 'Isaac', 50000, negocio.hoy(), 'saldo exacto')$$, 'saldo exacto: se permite y la caja queda en cero');
select is(pg_temp.caja(), 0::bigint, 'caja en cero tras el pago exacto');
select throws_ok($$select operacion.registrar_pago_proveedor_sociedad('a4q-p3', 'Isaac', 1, negocio.hoy(), 'un centavo de mas')$$, '23514', null, 'un centavo mas que el saldo se rechaza');
select is(pg_temp.conciliado(), true, 'libro conciliado con la caja en cero');

-- Anulacion: deshacer un pago devuelve el efectivo (no necesita guarda) y permite pagar de nuevo.
select operacion.anular_movimiento_proveedor('a4q-an', (select id from operacion.cuenta_proveedor_mov where concepto = 'pago_sociedad' order by id limit 1), 'prueba de anulacion');
select is(pg_temp.caja(), 100000::bigint, 'al anular el primer pago, la caja recupera 1,000.00');
select is(pg_temp.conciliado(), true, 'libro conciliado tras anular');
select lives_ok($$select operacion.registrar_pago_proveedor_sociedad('a4q-p4', 'Isaac', 100000, negocio.hoy(), 'otra vez')$$, 'con el saldo recuperado se puede pagar otra vez');
select is(pg_temp.conciliado(), true, 'libro conciliado al final');
select is((select count(*)::int from contabilidad.comprobaciones() k where not k.ok and k.bloqueante), 0, 'ninguna comprobacion bloqueante en rojo');

select * from finish();
rollback;
