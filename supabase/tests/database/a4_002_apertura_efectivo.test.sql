-- pgTAP del lote "cuadrar cuentas": las cajas de efectivo de la apertura firmada llegan a Socios y a la Cascada. Cifras ilustrativas; nada real.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4e.ang@example.test', 'socio', 'Angelo', true), ('a4e.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4e.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4e.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777c1' else '77777777-7777-7777-7777-7777777777c2' end, true) $$;
select pg_temp.como('Angelo');

create temp table _s as select (api.apertura_crear('a4e:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a4e:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 8461500}');
select api.apertura_agregar('a4e:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 5600000}');
select api.apertura_agregar('a4e:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 500000}');
select api.apertura_agregar('a4e:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 300000}');

select api.apertura_resolucion('a4e:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select is(operacion.saldo_efectivo(), 0::bigint, 'una apertura en borrador todavia no pone efectivo en las cajas');
select api.apertura_firmar('a4e:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a4e:f2', (select id from _s));
select contabilidad.asentar_pendientes();   -- en la app el asiento se crea al cerrar la transaccion; la prueba corre en una sola

select is(operacion.saldo_efectivo(), 800000::bigint, 'con la apertura firmada, el efectivo de las cajas suma 8,000.00');
select is(operacion.saldo_efectivo((select id from operacion.cuenta_efectivo where nombre = 'Efectivo de Angelo')), 500000::bigint, 'la caja de Angelo trae su efectivo de apertura');
select is(operacion.saldo_efectivo((select id from operacion.cuenta_efectivo where nombre = 'Efectivo de Javier')), 300000::bigint, 'la caja de Javier trae su efectivo de apertura');
select is(operacion.caja_empresa(), 0::bigint, 'la caja de la empresa no recibe efectivo de apertura (la apertura es por persona)');
select is((api.efectivo_sociedad() ->> 'total_cent')::bigint, 800000::bigint, 'el efectivo de la sociedad (Cascada y Disponible para repartir) incluye el efectivo de apertura');
select is(contabilidad.apertura_saldo('1101'), operacion.saldo_efectivo(), 'el libro (1101) y las cajas dicen lo mismo');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C23'), 'la comprobacion C23 (libro contra cajas) esta en verde con la apertura');
select ok((select ok from contabilidad.comprobaciones() where codigo = 'C24'), 'C24 (cada caja por persona contra su dimension del libro) esta en verde');

select pg_temp.como('Angelo');
select api.apertura_reversar('a4e:r1', (select id from _s), 'prueba de reversa');
select contabilidad.asentar_pendientes();
select is(operacion.saldo_efectivo(), 0::bigint, 'al reversar la apertura, el efectivo de apertura sale de las cajas');

select * from finish();
rollback;
