-- pgTAP a7_001: COMENTARIO DE IGUALACION del agente de Telegram. agente.igualacion() es una lectura de solo servidor que reutiliza api.socios_aportacion_neta (la misma definicion
-- de api.capital_por_mes) sin duplicarla. Ejemplo del dueno (a5_002): 118,161.91 contra 70,240.00 de aportacion neta; diferencia 47,921.91; le toca aportar al de menos. Datos sinteticos.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5700001, 'angelo');
select agente.registrar_miembro(5700002, 'javier');
select set_config('rtm.canal', '', true);
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('ig.ang@example.test', 'socio', 'Angelo', true), ('ig.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ig.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ig.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777f1' when 'Javier' then '77777777-7777-7777-7777-7777777777f2' else '' end, true) $$;
create function pg_temp.mes() returns jsonb language sql as $$ select api.capital_por_mes('2026-10-01', '2026-11-30')->'meses'->1->'periodo' $$;
create function pg_temp.fila(p_socio text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.mes()->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.ig() returns jsonb language plpgsql as $$ begin perform pg_temp.como(''); return agente.igualacion(); end $$;

-- Sin movimientos: igualados.
select is((pg_temp.ig() ->> 'igualados')::boolean, true, 'sin aportaciones: aportaciones igualadas');
select is(pg_temp.ig() ->> 'le_toca_aportar', null, '... y sin turno');
select is(pg_temp.ig() ->> 'lleva_mas', null, '... ni quien lleve mas');

-- Ejemplo del dueno.
select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('IG Marca', 'IG Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('IG Modelo', 'Uva');
select catalogo.fijar_costo('ig-c', 'Isaac', 'IG Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('IG Cliente', 'Javier');
select catalogo.fijar_precio('ig-p', 'IG Cliente', 'IG Modelo', 20000, '2020-01-01', 'chat');
select operacion.registrar_aportacion('ig-a1', 'Angelo', 11816191, 'Capital inicial', 'capital', '2026-10-15');
select operacion.registrar_aportacion('ig-a2', 'Javier', 10571500, 'Capital inicial', 'capital', '2026-10-19');
select operacion.crear_pedido('ig-v1', (select id from catalogo.cliente where nombre_canonico = 'IG Cliente'), '[{"modelo":"IG Modelo","sabor":"Uva","piezas":700}]'::jsonb, 'isaac_directo', null, 430073, 0, 0, '2026-11-02');
select operacion.confirmar_pedido('ig-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'ig-v1'));
select operacion.enviar_pedido('ig-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'ig-v1'), null, '{"paqueteria":"Castores","numero":"IG-G1","costo_cent":0}'::jsonb, '2026-11-03');
select operacion.registrar_pago('ig-pg1', 'Javier', 3547500, (select id from catalogo.cliente where nombre_canonico = 'IG Cliente'), null, true, 'abono', '2026-11-06');
select operacion.registrar_pago('ig-pg2', 'Efectivo', 10882573, (select id from catalogo.cliente where nombre_canonico = 'IG Cliente'), null, true, 'abono', '2026-11-08');
select contabilidad.asentar_pendientes();

select is(pg_temp.ig() ->> 'le_toca_aportar', 'Javier', 'el turno es de quien tiene menos aportacion neta');
select is(pg_temp.ig() ->> 'lleva_mas', 'Angelo', 'el otro es quien lleva mas aportado');
select is((pg_temp.ig() ->> 'diferencia_cent')::bigint, 4792191::bigint, 'diferencia 47,921.91 (de la base, no de la IA)');
select is((pg_temp.ig() ->> 'igualados')::boolean, false, 'todavia no estan igualados');
select is((select (x ->> 'aportacion_neta_cent')::bigint from jsonb_array_elements(pg_temp.ig() -> 'socios') x where x ->> 'socio' = 'Angelo'), 11816191::bigint, 'aportacion neta de Angelo: 118,161.91');
select is((select (x ->> 'aportacion_neta_cent')::bigint from jsonb_array_elements(pg_temp.ig() -> 'socios') x where x ->> 'socio' = 'Javier'), 7024000::bigint, 'aportacion neta de Javier: 70,240.00');

-- Misma fuente que api.capital_por_mes: turno y diferencia coinciden (no se duplica la logica).
select pg_temp.como('Javier');
select is(pg_temp.mes() ->> 'turno_aportar', (select agente.igualacion() ->> 'le_toca_aportar'), 'el turno es el de api.capital_por_mes');
select is((pg_temp.mes() ->> 'diferencia_a_igualar_cent')::bigint, (select (agente.igualacion() ->> 'diferencia_cent')::bigint from (select 1) _), 'la diferencia es la de api.capital_por_mes');
select is((pg_temp.fila('Javier') ->> 'aportacion_neta_cent')::bigint, (select (x ->> 'aportacion_neta_cent')::bigint from jsonb_array_elements(agente.igualacion() -> 'socios') x where x ->> 'socio' = 'Javier'), 'y la aportacion neta de cada socio');
select is(agente.igualacion() ->> 'fuente', 'api.socios_aportacion_neta', 'declara su fuente');

-- La lectura no deja el canal ni el actor cambiados.
select set_config('rtm.canal', 'importacion', true); select set_config('rtm.actor', 'angelo', true);
select agente.igualacion();
select is(current_setting('rtm.canal'), 'importacion', 'restaura el canal anterior');
select is(current_setting('rtm.actor'), 'angelo', 'y el actor anterior');
select set_config('rtm.canal', '', true); select set_config('rtm.actor', '', true);

-- Cada movimiento cambia el comentario: Javier aporta mas de lo que falta y el turno pasa a Angelo.
select pg_temp.como('Javier');
select operacion.registrar_aportacion('ig-a3', 'Javier', 5000000, 'Aportacion', 'capital', '2026-11-10');
select contabilidad.asentar_pendientes();
select is(pg_temp.ig() ->> 'le_toca_aportar', 'Angelo', 'si el atrasado rebasa la diferencia, el turno pasa al otro');
select is(pg_temp.ig() ->> 'lleva_mas', 'Javier', '... y ahora Javier es quien lleva mas');
select is((pg_temp.ig() ->> 'diferencia_cent')::bigint, 207809::bigint, '... por 2,078.09 (5,000,000 - 4,792,191 centavos)');
-- Aportaciones igualadas.
select pg_temp.como('Angelo');
select operacion.registrar_aportacion('ig-a4', 'Angelo', 207809, 'Aportacion para igualar', 'capital', '2026-11-11');
select contabilidad.asentar_pendientes();
select is((pg_temp.ig() ->> 'igualados')::boolean, true, 'al igualar: Aportaciones igualadas');
select is(pg_temp.ig() ->> 'le_toca_aportar', null, '... sin turno');
select is((pg_temp.ig() ->> 'diferencia_cent')::bigint, 0::bigint, '... y diferencia cero');

-- Privilegios: solo servidor.
select is(has_function_privilege('authenticated', 'agente.igualacion()', 'execute'), false, 'authenticated NO ejecuta agente.igualacion');
select is(has_function_privilege('anon', 'agente.igualacion()', 'execute'), false, 'anon tampoco');
select is(has_function_privilege('servidor', 'agente.igualacion()', 'execute'), true, 'servidor si');
select * from finish();
rollback;
