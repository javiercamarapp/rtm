-- pgTAP: costos del sistema como aportacion de capital declarada del socio que paga. Cifras ilustrativas (Supabase US$75, 10 de 60 horas, techo 17 %, TC 18.50 = $236.00).
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cos5.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('88888888-8888-8888-8888-888888888885', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cos5.javier@example.test');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888885', true);
create temp table _b as select costos.pendiente_socio('javier') as pend,
  (select (x ->> 'capital_aportado_cent')::bigint from jsonb_array_elements(api.cuenta_socios_valuacion() -> 'socios') x where x ->> 'socio' = 'Javier') as cap_val0, (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio where clasificacion = 'capital' and socio_id = (select id from catalogo.socio where nombre = 'Javier')) as cap0,
  (select coalesce(sum(debe_cent - haber_cent), 0) from contabilidad.asiento_linea where cuenta = '3120') as m0;

create function pg_temp.cargo(p_clave text, p_pagado text default 'javier', p_mes text default '2031-03') returns jsonb language sql as $$
  select api.costos_registrar_cargo(p_clave, 'supabase', p_mes, negocio.hoy(), 'mantenimiento', 75000000, 'USD', 166666, 170000, 18500000, negocio.hoy(), 'manual',
    23587500000, 23124907500, 23600, null, null, p_pagado, true, 'atribuido', 'provisional', 'recibo', null, 'ilustrativo') $$;

select is((pg_temp.cargo('k5:1') ->> 'como_capital')::boolean, true, 'el cargo de Javier nace como aportacion de capital declarada');
select is((pg_temp.cargo('k5:1') ->> 'repetido')::boolean, false, 'misma clave: devuelve el mismo registro');
select is((select count(*)::int from costos.cargo where clave_idem = 'k5:1'), 1, 'una sola fila');
select is(costos.pendiente_socio('javier'), (select pend from _b), 'no genera cuenta por pagar: nada que reembolsar');
select is((select clasificacion from operacion.aportacion_socio where id = (select aportacion_id from costos.cargo where clave_idem = 'k5:1')), 'capital', 'la aportacion es de capital');
select matches((select concepto from operacion.aportacion_socio where id = (select aportacion_id from costos.cargo where clave_idem = 'k5:1')), 'costos del sistema pagados por el socio', 'lleva la intencion declarada');
select throws_ok($$ select pg_temp.cargo('k5:otra') $$, 'P0456', null, 'mismo servicio y mes con otra clave se rechaza');
select lives_ok($$ select pg_temp.cargo('k5:abril', 'javier', '2031-04') $$, 'otro mes se permite');
set constraints all immediate;
select is((select (x ->> 'capital_aportado_cent')::bigint from jsonb_array_elements(api.cuenta_socios_valuacion() -> 'socios') x where x ->> 'socio' = 'Javier') - (select cap_val0 from _b), 47200::bigint, 'suma al capital aportado de la valuacion personal de Javier');
select is((api.costos_validacion('2031-03') ->> 'cuadra')::boolean, true, 'validacion: cargos = aportado = mayor');
select is((api.costos_validacion('2031-03') ->> 'cargos_cent')::bigint, 23600::bigint, 'cargos del mes 236.00');
select is((api.costos_validacion('2031-03') ->> 'mayor_cent')::bigint, 23600::bigint, 'el mayor 3120 recibe 236.00 (sin tocar la caja)');
select is((select coalesce(sum(debe_cent - haber_cent), 0)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id where l.cuenta = '1101' and a.evento_id = (select evento_id from costos.cargo where clave_idem = 'k5:1')), 0::bigint, 'sin linea de caja');
select is((select count(*)::int from contabilidad.comprobaciones() k where k.bloqueante and not k.ok), 0, 'comprobaciones bloqueantes en verde');
select is((operacion.cuadre_socios() ->> 'libro_conciliado')::boolean, true, 'libro de socios conciliado');
select is((api.costos_aportaciones('javier') ->> 'total_cent')::bigint, 47200::bigint, 'acumulado de aportaciones por costos');
select is((api.explicar_costos('costos:aportacion:2031-03') -> 'comprobacion' ->> 'cuadra')::boolean, true, 'explicar: dos vias cuadran');
select throws_ok($$ select api.explicar_costos('costos:aportacion:x') $$, '22023', null, 'cifra invalida');
-- anular y volver a registrar el mismo servicio y mes
select lives_ok($$ select api.costos_anular_cargo('k5:a1', (select id from costos.cargo where clave_idem = 'k5:1'), negocio.hoy(), 'error de captura') $$, 'se anula');
select lives_ok($$ select pg_temp.cargo('k5:2') $$, 'tras la reversa se registra de nuevo');
set constraints all immediate;
select is((api.costos_validacion('2031-03') ->> 'cargos_cent')::bigint, 23600::bigint, 'el mes queda en 236.00 tras anular y registrar');
select is((api.costos_validacion('2031-03') ->> 'cuadra')::boolean, true, 'sigue cuadrando');
-- Angelo no declaro capital: camino anterior (reembolsable)
select is((pg_temp.cargo('k5:ang', 'angelo', '2031-05') ->> 'como_capital')::boolean, false, 'un socio no declarado conserva la cuenta por pagar');
select is(costos.pendiente_socio('angelo'), 23600::bigint, 'pendiente de Angelo 236.00');
-- pendiente sin tipo de cambio
select is((costos.registrar_pendiente_tc('claude_max', '2031-06', negocio.hoy(), 20000000, 'x') ->> 'nuevo')::boolean, true, 'cargo en USD sin tipo de cambio se guarda');
select is((costos.registrar_pendiente_tc('claude_max', '2031-06', negocio.hoy(), 20000000, 'x') ->> 'nuevo')::boolean, false, 'idempotente');
select is(jsonb_array_length(api.costos_validacion('2031-06') -> 'pendientes_tc'), 1, 'la validacion lo lista');
select is(costos.resolver_pendiente_tc('claude_max', '2031-06'), 1, 'se resuelve');
-- cuota base con vigente_desde
select is(costos.cuota_base_vigente('vercel', date '2031-01-01') ->> 'regla', 'menor', 'regla vigente: menor');
select lives_ok($$ select costos.fijar_cuota_base('vercel', 'mayor', 30000000, date '2031-02-01', 'prueba') $$, 'fila nueva con vigente_desde');
select is(costos.cuota_base_vigente('vercel', date '2031-03-01') ->> 'regla', 'mayor', 'la nueva rige desde su fecha');
select is(costos.cuota_base_vigente('vercel', date '2031-01-15') ->> 'regla', 'menor', 'antes de la fecha rige la anterior');
select throws_ok($$ select costos.fijar_cuota_base('vercel', 'mayor', 1, date '2031-02-01', 'x') $$, 'P0457', null, 'no se edita una fila anterior');
select is((select logo_slug from costos.servicio where slug = 'dominio'), 'vercel', 'el dominio usa el logo de Vercel');
select is(has_function_privilege('authenticated', 'operacion.registrar_gasto_socio_capital(text,text,bigint,text,text,date,text,text)', 'EXECUTE'), false, 'la web no ejecuta el gasto capital');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'costos' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada en todas las tablas de costos');
select * from finish();
rollback;
