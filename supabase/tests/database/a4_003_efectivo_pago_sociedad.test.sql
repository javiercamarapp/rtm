-- pgTAP del lote "cuadrar cuentas": el pago de la sociedad a un proveedor descuenta el efectivo que usa la Cascada, igual que el libro (1101). Con el puente de efectivo el pago se ESCRIBE como movimiento de la Caja de la empresa (auditable, con reversa); C23 (total) y C24 (por caja) lo vigilan. Cifras ilustrativas; nada real.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4p.ang@example.test', 'socio', 'Angelo', true), ('a4p.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4p.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4p.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777d1' else '77777777-7777-7777-7777-7777777777d2' end, true) $$;
select pg_temp.como('Angelo');

create temp table _s as select (api.apertura_crear('a4p:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a4p:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('a4p:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_agregar('a4p:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 500000}');
select api.apertura_agregar('a4p:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 300000}');
select api.apertura_resolucion('a4p:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('a4p:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a4p:f2', (select id from _s));
select contabilidad.asentar_pendientes();

select is(operacion.saldo_efectivo(), 800000::bigint, 'antes del pago, el efectivo es el de la apertura (8,000.00)');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C23'), 'C23 verde antes del pago');

create temp table _p as select (operacion.registrar_pago_proveedor_sociedad('a4p:pago', 'Isaac', 100000, negocio.hoy(), 'pago ilustrativo') ->> 'movimiento_id')::bigint as id;
select contabilidad.asentar_pendientes();

select is(operacion.pagado_por_sociedad_a_proveedores(), 100000::bigint, 'el pago de la sociedad a Isaac se suma (1,000.00)');
select is(operacion.saldo_efectivo(), 700000::bigint, 'el efectivo total de la Cascada descuenta el pago (7,000.00)');
select is((api.efectivo_sociedad() ->> 'total_cent')::bigint, 700000::bigint, 'Disponible para repartir parte del efectivo ya descontado');
select is(contabilidad.saldo_deudor('1101'), operacion.saldo_efectivo(), 'el libro (1101) y la Cascada dicen lo mismo despues del pago');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C23'), 'C23 verde despues del pago');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C24'), 'C24 (cajas por persona) verde despues del pago');
select is((select coalesce(sum(m.monto_cent), 0)::bigint from operacion.cuenta_efectivo_mov m join operacion.cuenta_efectivo c on c.id = m.cuenta_id where c.nombre = 'Caja de la empresa'), -100000::bigint, 'el pago queda escrito como movimiento de la Caja de la empresa (auditable)');
select is(operacion.saldo_efectivo((select id from operacion.cuenta_efectivo where nombre = 'Efectivo de Angelo')), 500000::bigint, 'las cajas de los socios no se mueven: el pago sale de la Caja de la empresa (parametro; la regla de que caja paga sigue siendo del dueno)');

select operacion.anular_movimiento_proveedor('a4p:anula', (select id from _p), 'prueba de reversa');
select contabilidad.asentar_pendientes();
select is(operacion.pagado_por_sociedad_a_proveedores(), 0::bigint, 'al deshacer el pago, deja de restar');
select is(operacion.saldo_efectivo(), 800000::bigint, 'el efectivo vuelve a 8,000.00');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C23'), 'C23 verde tras deshacer');

select * from finish();
rollback;
