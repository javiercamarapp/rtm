-- pgTAP a5_002: JUSTICIA EN EL DINERO INVERTIDO (decision del dueno, 13-nov). Ejemplo sintetico del dueno: capital 118,161.91 y 105,715.00, fondos de la sociedad en poder del segundo 35,475.00,
-- utilidad 74,300.73. La participacion es 50/50; la valuacion personal = capital + 50 % de la utilidad - fondos en su poder (155,312.28 y 107,390.36); aportaciones netas 118,161.91 y 70,240.00;
-- diferencia 47,921.91 "le toca al segundo"; al aportarla, ambos valen 155,312.28 (con un centavo de redondeo); si la rebasa, el turno pasa al otro. La reinversion del acta es la misma para los dos.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cap2.ang@example.test', 'socio', 'Angelo', true), ('cap2.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap2.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cap2.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777e1' else '77777777-7777-7777-7777-7777777777e2' end, true) $$;
create function pg_temp.mes() returns jsonb language sql as $$ select api.capital_por_mes('2026-10-01', '2026-11-30')->'meses'->1->'periodo' $$;
create function pg_temp.fila(p_socio text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.mes()->'socios') x where x->>'socio' = $1 $$;

select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('CP2 Marca', 'CP2 Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('CP2 Modelo', 'Uva');
select catalogo.fijar_costo('cp2-c', 'Isaac', 'CP2 Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('CP2 Cliente', 'Javier');
select catalogo.fijar_precio('cp2-p', 'CP2 Cliente', 'CP2 Modelo', 20000, '2020-01-01', 'chat');
select operacion.registrar_aportacion('cp2-a1', 'Angelo', 11816191, 'Capital inicial', 'capital', '2026-10-15');
select operacion.registrar_aportacion('cp2-a2', 'Javier', 10571500, 'Capital inicial', 'capital', '2026-10-19');
-- Utilidad 74,300.73: 700 pz a 200.00 (140,000.00) + envio cobrado 4,300.73 - costo 70,000.00
select operacion.crear_pedido('cp2-v1', (select id from catalogo.cliente where nombre_canonico = 'CP2 Cliente'), '[{"modelo":"CP2 Modelo","sabor":"Uva","piezas":700}]'::jsonb, 'isaac_directo', null, 430073, 0, 0, '2026-11-03');
select operacion.confirmar_pedido('cp2-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp2-v1'));
select operacion.enviar_pedido('cp2-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cp2-v1'), null, '{"paqueteria":"Castores","numero":"CP2-G1","costo_cent":0}'::jsonb, '2026-11-03', true);
select operacion.registrar_pago('cp2-pg1', 'Javier', 3547500, (select id from catalogo.cliente where nombre_canonico = 'CP2 Cliente'), null, true, 'abono', '2026-11-06');
select operacion.registrar_pago('cp2-pg2', 'Efectivo', 10882573, (select id from catalogo.cliente where nombre_canonico = 'CP2 Cliente'), null, true, 'abono', '2026-11-08');
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');

select is((pg_temp.mes()->'estado_resultados'->>'utilidad_neta_cent')::bigint, 7430073::bigint, 'utilidad 74,300.73');
select is((pg_temp.fila('Javier')->>'fondos_en_poder_cent')::bigint, 3547500::bigint, 'fondos de la sociedad en poder del segundo: 35,475.00');
select is((pg_temp.fila('Angelo')->>'aportacion_neta_cent')::bigint, 11816191::bigint, 'aportacion neta del primero: 118,161.91');
select is((pg_temp.fila('Javier')->>'aportacion_neta_cent')::bigint, 7024000::bigint, 'aportacion neta del segundo: 70,240.00');
select is((pg_temp.mes()->>'diferencia_a_igualar_cent')::bigint, 4792191::bigint, 'diferencia a igualar: 47,921.91');
select is(pg_temp.mes()->>'turno_aportar', 'Javier', 'le toca aportar el siguiente pago al segundo (menos aportacion neta)');
select is((pg_temp.fila('Javier')->>'diferencia_a_igualar_cent')::bigint, 4792191::bigint, 'y la diferencia es suya');
select is((pg_temp.fila('Angelo')->>'diferencia_a_igualar_cent')::bigint, 0::bigint, 'el primero no tiene diferencia');
select is((pg_temp.mes()->>'igualados')::boolean, false, 'todavia no estan igualados');
select is((pg_temp.fila('Angelo')->>'participacion_bp')::int, 5000, 'participacion 50/50 del primero (aportar mas no da mas participacion)');
select is((pg_temp.fila('Javier')->>'participacion_bp')::int, 5000, 'participacion 50/50 del segundo');
select is((pg_temp.fila('Angelo')->>'valuacion_cent')::bigint, 15531228::bigint, 'valuacion del primero: 118,161.91 + 37,150.37 = 155,312.28');
select is((pg_temp.fila('Javier')->>'valuacion_cent')::bigint, 10739036::bigint, 'valuacion del segundo: 105,715.00 + 37,150.36 - 35,475.00 = 107,390.36');
select is((pg_temp.fila('Javier')->>'valuacion_si_igualados_cent')::bigint, 15531227::bigint, 'valuacion informativa si el segundo igualara: 155,312.27');
select is((pg_temp.fila('Angelo')->>'valuacion_si_igualados_cent')::bigint, 15531228::bigint, 'la del primero no cambia');
select is((select count(*)::int from jsonb_array_elements(pg_temp.mes()->'comprobaciones') c where not (c->>'ok')::boolean), 0, 'K1 a K9 en verde con el ejemplo del dueno');
select ok(pg_temp.mes()->>'nota_igualacion' ~ 'no es una deuda ni un reembolso', 'la nota dice que la diferencia no es una deuda ni un reembolso');
select ok(pg_temp.mes()->>'nota_igualacion' !~* 'adeuda', 'y no usa lenguaje de deuda');

-- Al aportar el segundo la diferencia, quedan igualados y ambos valen lo mismo (un centavo de redondeo).
select operacion.registrar_aportacion('cp2-a3', 'Javier', 4792191, 'Aportacion para igualar', 'capital', '2026-11-10');
select contabilidad.asentar_pendientes();
select is((pg_temp.mes()->>'diferencia_a_igualar_cent')::bigint, 0::bigint, 'tras aportar 47,921.91 la diferencia es cero');
select is(pg_temp.mes()->>'turno_aportar', null, 'sin turno: igualados');
select is((pg_temp.mes()->>'igualados')::boolean, true, 'Igualados');
select is((pg_temp.fila('Javier')->>'valuacion_cent')::bigint, 15531227::bigint, 'el segundo vale 155,312.27');
select ok(abs((pg_temp.fila('Angelo')->>'valuacion_cent')::bigint - (pg_temp.fila('Javier')->>'valuacion_cent')::bigint) <= 1, 'ambos valen lo mismo (un centavo de redondeo de la utilidad impar)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.mes()->'comprobaciones') c where not (c->>'ok')::boolean), 0, 'comprobaciones en verde tras igualar');

-- Si el segundo rebasa, el turno pasa al otro.
select operacion.registrar_aportacion('cp2-a4', 'Javier', 100000, 'Aportacion de mas', 'capital', '2026-11-11');
select contabilidad.asentar_pendientes();
select is(pg_temp.mes()->>'turno_aportar', 'Angelo', 'rebasada la igualdad, le toca aportar al primero');
select is((pg_temp.mes()->>'diferencia_a_igualar_cent')::bigint, 100000::bigint, 'por 1,000.00');
select is((pg_temp.fila('Javier')->>'valuacion_cent')::bigint - 15531227, 100000::bigint, 'el exceso del adelantado si sube su valuacion personal (informativo; no es participacion)');

-- Reinversion IGUAL: la sugerida es el mismo monto para los dos, el maximo comun de su utilidad disponible.
select is((api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->'por_socio'->'Angelo'->>'reinvierte_sugerido_cent')::bigint, (api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->'por_socio'->'Javier'->>'reinvierte_sugerido_cent')::bigint, 'la reinversion sugerida es igual para los dos');
select ok((api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->>'monto_comun_cent')::bigint <= least((api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->'por_socio'->'Angelo'->>'disponible_cent')::bigint, (api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->'por_socio'->'Javier'->>'disponible_cent')::bigint), 'y no pasa de lo que permite la utilidad de cada uno');
select pg_temp.como('Angelo');
select operacion.proponer_cierre_reparto('cp2-ac1', '2026-11-01', '2026-11-11', jsonb_build_object('Angelo', jsonb_build_object('retira', 0, 'reinvierte', (api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->>'monto_comun_cent')::bigint), 'Javier', jsonb_build_object('retira', 0, 'reinvierte', (api.acta_reinversion_sugerida('2026-11-01', '2026-11-11')->>'monto_comun_cent')::bigint)));
select operacion.firmar_cierre_reparto('cp2-ac2', (select max(id) from operacion.cierre_reparto));
select pg_temp.como('Javier');
select operacion.firmar_cierre_reparto('cp2-ac3', (select max(id) from operacion.cierre_reparto));
set constraints all immediate;
select contabilidad.asentar_pendientes();
select is((pg_temp.mes()->>'reinversion_igual')::boolean, true, 'el acta con el monto sugerido reinvierte lo mismo: igual para los dos');
select is((pg_temp.mes()->>'reinversion_acta_angelo_cent')::bigint, (pg_temp.mes()->>'reinversion_acta_javier_cent')::bigint, 'mismos montos');
select ok((pg_temp.mes()->>'reinversion_acta_angelo_cent')::bigint > 0, 'y es mayor que cero');
select is((select count(*)::int from jsonb_array_elements(pg_temp.mes()->'comprobaciones') c where not (c->>'ok')::boolean), 0, 'tras el acta: K1 a K9 en verde');
select ok(not has_function_privilege('anon', 'api.acta_reinversion_sugerida(date, date)', 'execute'), 'anon no lee la reinversion sugerida');
select * from finish();
rollback;
