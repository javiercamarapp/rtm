-- pgTAP ficha de "Explicar este numero" (migracion 20261115200000): corte, diferencia entre vias, historial mensual y cuentas del saldo contable.
-- Todo es aditivo: la funcion anterior sigue resolviendo la cifra y exigiendo el rol. Los esperados salen del movimiento sembrado, no del codigo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('ficha.socio@example.test', 'socio', 'Angelo', true), ('ficha.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('76666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ficha.socio@example.test'),
  ('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ficha.omar@example.test');
select set_config('request.jwt.claim.sub', '76666666-6666-6666-6666-666666666666', true);

select operacion.registrar_movimiento_efectivo('ficha-si1', 'Caja de la empresa', 'saldo_inicial', 1000000, 'apertura');
select contabilidad.asentar_pendientes();

create function pg_temp.ex(p text) returns jsonb language sql as $$ select api.explicar_cifra($1) $$;

select is((pg_temp.ex('conta:saldo:1101')->'corte'->>'fecha')::date, negocio.hoy(), 'el corte trae la fecha de negocio de hoy');
select ok(pg_temp.ex('conta:saldo:1101')->'corte'->>'hora' is not null, 'y la hora de la lectura');
select is((pg_temp.ex('conta:saldo:1101')->>'valor')::bigint, contabilidad.saldo('1101'), 'el valor del saldo es el del libro');
select is((pg_temp.ex('conta:saldo:1101')->'comprobacion'->>'diferencia')::bigint, 0::bigint, 'la diferencia entre las dos vias la calcula la base y es 0 cuando cuadra');
select ok((select contabilidad.saldo('1101') >= 1000000), 'el movimiento sembrado esta en el libro');
select is(jsonb_array_length(pg_temp.ex('conta:saldo:1101')->'historial'), 12, 'el historial trae 12 meses');
select is((pg_temp.ex('conta:saldo:1101')->'historial'->11->>'valor_cent')::bigint, contabilidad.saldo('1101'), 'el ultimo mes cierra con el saldo actual (el saldo sembrado suma 10,000.00 a lo que ya hubiera)');
select is(pg_temp.ex('conta:saldo:1101')->'historial'->11->>'periodo', to_char(negocio.hoy(), 'YYYY-MM'), 'el ultimo periodo es el mes en curso');
select is(pg_temp.ex('conta:saldo:1101')->'cuentas'->0->>'codigo', '1101', 'la cuenta involucrada es la 1101');
select is((pg_temp.ex('conta:saldo:1101')->'cuentas'->0->>'saldo_cent')::bigint, contabilidad.saldo('1101'), 'con su saldo al corte');
select ok(not (pg_temp.ex('conta:saldo:1310') ? 'historial'), 'una cuenta que nunca tuvo saldo no trae historial (sin secciones vacias)');
select ok(pg_temp.ex('conta:v01') ? 'corte' and not (pg_temp.ex('conta:v01') ? 'cuentas'), 'otras cifras contables traen corte pero no inventan cuentas');
select is(jsonb_array_length(pg_temp.ex('conta:saldo:1101')->'renglones'), (select count(*)::int from contabilidad.movimientos_cuenta('1101', null, negocio.hoy())), 'los renglones de la funcion anterior se conservan');

-- Seguridad: mismos permisos y rol que antes; la funcion base no se llama desde fuera.
select throws_ok($$select api.explicar_cifra('conta:saldo:9999')$$, '22023', null, 'cuenta desconocida sigue fallando como antes');
select is(has_function_privilege('anon', 'api.explicar_cifra(text)', 'execute'), false, 'anon no ejecuta explicar_cifra');
select is(has_function_privilege('authenticated', 'api.explicar_cifra(text)', 'execute'), true, 'authenticated si');
select is(has_function_privilege('authenticated', 'api.explicar_cifra_antes_ficha(text)', 'execute'), false, 'la funcion anterior queda cerrada');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
select throws_ok($$select api.explicar_cifra('conta:saldo:1101')$$, null, null, 'un rol que no es socio sigue sin ver cifras contables (ni su ficha)');

select * from finish();
rollback;
