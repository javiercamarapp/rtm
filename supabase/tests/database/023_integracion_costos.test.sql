-- pgTAP integracion 1: costos del sistema. Cifras ilustrativas escritas a mano (Supabase US$75, 10 de 60 horas, techo 17 %, TC 18.50).
begin;
select no_plan();
create temp table _b as select (select ultimo from seguridad.contador_folio where serie = 'K') as k, (select count(*) from costos.cargo) as cargos, (select count(*) from operacion.gasto) as gastos, costos.pendiente_socio('javier') as pend;
create function pg_temp.fk(n int) returns text language sql as $$ select 'K-' || lpad(((select k from _b) + n)::text, 4, '0') $$;
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cos.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('88888888-8888-8888-8888-888888888881', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cos.javier@example.test');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888881', true);

select is(costos.techo(23587.5::numeric * 1000000, 1000000, 100), 23600::numeric, 'techo: 235.875 pesos sube al peso entero');
select is(costos.techo(-23587.5::numeric * 1000000, 1000000, 100), -23500::numeric, 'techo hacia +infinito en negativos');
select is(costos.techo_pct_fraccion(10, 60), 170000::numeric, 'participacion 10/60 sube a 17 %');
select is(costos.ceil_div(7, 2), 4::numeric, 'ceil_div 7/2');

create function pg_temp.cargo(p_clave text, p_monto bigint default 23600, p_sha text default null, p_estado text default 'provisional') returns jsonb language sql as $$
  select api.costos_registrar_cargo(p_clave, 'supabase', '2031-03', negocio.hoy(), 'mantenimiento', 75000000, 'USD', 166666, 170000, 18500000, negocio.hoy(), 'manual',
    23587500000, 23124907500, p_monto, null, null, 'javier', true, 'atribuido', p_estado, 'recibo', p_sha, 'ilustrativo') $$;

select throws_ok($$ select pg_temp.cargo('c:mal', 23500) $$, 'P0452', null, 'un monto distinto del recalculo se rechaza');
select throws_ok($$ select pg_temp.cargo('c:conf', 23600, null, 'confirmado') $$, 'P0453', null, 'confirmado exige evidencia');
select is((pg_temp.cargo('c:1') ->> 'monto_cent')::bigint, 23600::bigint, 'el cargo se registra');
select is((pg_temp.cargo('c:1') ->> 'folio'), pg_temp.fk(1), 'idempotente: misma clave, mismo folio');
select is((select count(*) from costos.cargo) - (select cargos from _b), 1::bigint, 'una sola fila nueva');
select is((select count(*) from operacion.gasto) - (select gastos from _b), 1::bigint, 'nace el gasto de la sociedad pagado por Javier');
select is(costos.pendiente_socio('javier') - (select pend from _b), 23600::bigint, 'pendiente de reembolso 236.00 mas lo previo');
-- Reglas de reparto vigentes (dueño, 11-nov): todo pago a un socio sale primero del efectivo de la caja de la empresa; con la caja en cero el reembolso se rechaza.
select operacion.registrar_movimiento_efectivo('t23:caja', 'Caja de la empresa', 'ajuste_conteo', 100000, 'fondos de prueba');
select throws_ok($$ select api.costos_registrar_reembolso('r:grande', 'javier', 'angelo', 30000 + (select pend from _b)::bigint, negocio.hoy(), 'transferencia', null) $$, 'P0455', null, 'no se reembolsa mas de lo pendiente');
select is((api.costos_registrar_reembolso('r:1', 'javier', 'angelo', 10000, negocio.hoy(), 'transferencia', null) ->> 'pendiente_cent')::bigint - (select pend from _b), 13600::bigint, 'reembolso parcial de 100.00 deja 136.00 mas lo previo');
select is((api.costos_cuenta('javier') ->> 'pendiente_cent')::bigint - (select pend from _b), 13600::bigint, 'la cuenta por pagar coincide');
select is((api.costos_resumen('2031-03') -> 'operar' ->> 'redondeado_cent')::bigint, 23600::bigint, 'resumen: operar 236.00 redondeado');
select is((api.costos_resumen('2031-03') -> 'operar' ->> 'exacto_e6')::bigint, 23587500000::bigint, 'resumen: exacto 235.875 aparte');
select is((api.costos_explicar((select id from costos.cargo where clave_idem = 'c:1')) -> 'comprobacion' ->> 'cuadra')::boolean, true, 'explicar: dos vias cuadran');
select throws_ok($$ select api.costos_anular_cargo('a:0', (select id from costos.cargo where clave_idem = 'c:1'), negocio.hoy(), ' ') $$, '23502', null, 'anular exige motivo');
select is((api.costos_anular_cargo('a:1', (select id from costos.cargo where clave_idem = 'c:1'), negocio.hoy(), 'error de captura') ->> 'folio'), pg_temp.fk(2), 'la reversa tiene folio propio');
select is((api.costos_resumen('2031-03') -> 'operar' ->> 'redondeado_cent')::bigint, 0::bigint, 'con la reversa el mes queda en cero');
select throws_ok($$ select api.costos_anular_cargo('a:2', (select id from costos.cargo where clave_idem = 'c:1'), negocio.hoy(), 'otra vez') $$, 'P0454', null, 'no se anula dos veces');
select throws_ok($$ update costos.cargo set nota = 'x' where id > 0 $$, '42501', null, 'cargo es de solo insercion');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('costos','ia') and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada en todas las tablas');
select is(has_function_privilege('authenticated', 'costos.registrar_cargo(text,text,text,date,text,bigint,text,int,int,bigint,date,text,bigint,bigint,bigint,bigint,bigint,text,boolean,text,text,text,text,text)', 'EXECUTE'), false, 'la web no ejecuta costos.* directo');
select * from finish();
rollback;
