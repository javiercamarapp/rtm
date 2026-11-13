-- pgTAP a9_002: Cuenta de socios por valuacion (api.cuenta_socios_valuacion). Escenario SINTETICO con las MISMAS proporciones que los datos reales del dueno: Javier aporta 118,161.91 y Angelo
-- 105,715.00 de capital, utilidad 53,660.73 (50/50), fondos de la sociedad en poder de Angelo 35,475.00 (un cobro de cliente en su caja) y retiros 0; luego un caso con retiro IGUAL a ambos y
-- otro con retiro DESIGUAL (alerta). Cifras a mano:
--   Javier : capital 118,161.91 + utilidades 26,830.36 - retirado 0 - fondos 0 = 144,992.27
--   Angelo : capital 105,715.00 + utilidades 26,830.37 - retirado 0 - fondos 35,475.00 = 97,070.37
--   X = 144,992.27 - 97,070.37 ; Y (aportacion neta) = 118,161.91 - 70,240.00 = 47,921.91 ; X = Y - 0.01 porque la utilidad es impar (el centavo suelto va a Angelo: redondeo a favor de quien paga).
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cv.ang@example.test', 'socio', 'Angelo', true), ('cv.jav@example.test', 'socio', 'Javier', true), ('cv.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cv.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cv.jav@example.test'),
  ('77777777-7777-7777-7777-7777777777e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cv.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777e1' when 'Omar' then '77777777-7777-7777-7777-7777777777e3' else '77777777-7777-7777-7777-7777777777e2' end, true) $$;
create function pg_temp.cv() returns jsonb language sql as $$ select api.cuenta_socios_valuacion('2026-11-30') $$;
create function pg_temp.s(p_socio text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.cv()->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.id(p_id text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.cv()->'identidades') x where x->>'id' = $1 $$;
select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('CV Marca', 'CV Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('CV Modelo', 'Uva');
select catalogo.fijar_costo('cv-c', 'Isaac', 'CV Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_modelo('CV Marca', 'CV Karen', 25000, 'ambas');
select catalogo.asegurar_sku('CV Karen', 'Mango');
select catalogo.fijar_costo('cv-ck', 'Karen', 'CV Karen', 8000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('CV Cliente', 'Javier');
select catalogo.fijar_precio('cv-p', 'CV Cliente', 'CV Modelo', 20000, '2020-01-01', 'chat');
select catalogo.fijar_precio('cv-pk', 'CV Cliente', 'CV Karen', 15000, '2020-01-01', 'chat');
select operacion.registrar_aportacion('cv-a1', 'Javier', 11816191, 'Capital inicial', 'capital', '2026-10-15');
select operacion.registrar_aportacion('cv-a2', 'Angelo', 10571500, 'Capital inicial', 'capital', '2026-10-19');
select operacion.crear_pedido('cv-v1', (select id from catalogo.cliente where nombre_canonico='CV Cliente'), '[{"modelo":"CV Modelo","sabor":"Uva","piezas":400}]'::jsonb, 'isaac_directo', null, 316073, 0, 0, '2026-11-03');
select operacion.confirmar_pedido('cv-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cv-v1'));
select operacion.enviar_pedido('cv-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cv-v1'), null, '{"paqueteria":"Castores","numero":"CV-G1","costo_cent":0}'::jsonb, '2026-11-03', true);
select operacion.crear_pedido('cv-v2', (select id from catalogo.cliente where nombre_canonico='CV Cliente'), '[{"modelo":"CV Karen","sabor":"Mango","piezas":150}]'::jsonb, 'karen_directo', null, 0, 0, 0, '2026-11-04');
select operacion.confirmar_pedido('cv-v2c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cv-v2'));
select operacion.enviar_pedido('cv-v2e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cv-v2'), null, '{"paqueteria":"Castores","numero":"CV-G2","costo_cent":0}'::jsonb, '2026-11-04', true);
select operacion.registrar_pago('cv-pg2', 'Efectivo', 2518573, (select id from catalogo.cliente where nombre_canonico='CV Cliente'), null, true, 'abono', '2026-11-08');
select operacion.registrar_pago('cv-pg3', 'Isaac', 4500000, (select id from catalogo.cliente where nombre_canonico='CV Cliente'), null, true, 'abono', '2026-11-09');
select operacion.registrar_pago('cv-pg1', 'Angelo', 3547500, (select id from catalogo.cliente where nombre_canonico='CV Cliente'), null, true, 'abono', '2026-11-12');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');

-- Cifras a mano (escenario base: retiros 0)
select is((pg_temp.s('Javier')->>'capital_aportado_cent')::bigint, 11816191::bigint, 'Javier: capital aportado 118,161.91');
select is((pg_temp.s('Angelo')->>'capital_aportado_cent')::bigint, 10571500::bigint, 'Angelo: capital aportado 105,715.00');
select is((pg_temp.s('Javier')->>'utilidades_acumuladas_cent')::bigint, 2683036::bigint, 'Javier: utilidades acumuladas 26,830.36 (mitad de 53,660.73)');
select is((pg_temp.s('Angelo')->>'utilidades_acumuladas_cent')::bigint, 2683037::bigint, 'Angelo: utilidades acumuladas 26,830.37 (el centavo suelto)');
select is((pg_temp.s('Javier')->>'retirado_cent')::bigint, 0::bigint, 'Javier: retirado 0');
select is((pg_temp.s('Angelo')->>'retirado_cent')::bigint, 0::bigint, 'Angelo: retirado 0');
select is((pg_temp.s('Angelo')->>'fondos_en_poder_cent')::bigint, 3547500::bigint, 'Angelo: fondos de la sociedad en su poder 35,475.00');
select is((pg_temp.s('Javier')->>'valuacion_cent')::bigint, 14499227::bigint, 'Javier: valuacion = 118,161.91 + 26,830.36 = 144,992.27');
select is((pg_temp.s('Angelo')->>'valuacion_cent')::bigint, 9707037::bigint, 'Angelo: valuacion = 105,715.00 + 26,830.37 - 35,475.00 = 97,070.37');
select is((pg_temp.s('Javier')->>'subtotal_cent')::bigint + (pg_temp.s('Angelo')->>'subtotal_cent')::bigint, 27753764::bigint, 'subtotales por socio suman 277,537.64');
select is((pg_temp.cv()->'balance'->>'capital_contable_cent')::bigint, 27753764::bigint, 'y son el capital contable del Balance (identidad S2)');
select is((pg_temp.cv()->'comparacion'->>'diferencia_valuacion_cent')::bigint, 4792190::bigint, 'diferencia de valuacion X = 47,921.90');
select is((pg_temp.cv()->'comparacion'->>'diferencia_aportacion_cent')::bigint, 4792191::bigint, 'diferencia de aportacion Y = 47,921.91 (X = Y menos el centavo impar de la utilidad)');
select is(pg_temp.cv()->'comparacion'->>'le_toca_aportar', 'Angelo', 'le toca aportar a Angelo');
select is((pg_temp.cv()->'comparacion'->>'aportar_para_igualar_cent')::bigint, 4792190::bigint, 'y aportar X iguala las valuaciones');
select is(pg_temp.cv()->'comparacion'->>'mayor', 'Javier', 'Javier tiene mas valuacion');
select ok((select bool_and((x->>'ok')::boolean) from jsonb_array_elements(pg_temp.cv()->'identidades') x), 'todas las identidades S1 a S6 cuadran con retiros 0');
select is((pg_temp.cv()->'comparacion'->>'retiros_desiguales')::boolean, false, 'retiros iguales (0 y 0): sin alerta');
select ok((select bool_and((x->>'ok')::boolean) from jsonb_array_elements(pg_temp.cv()->'comprobaciones_libro') x where x->>'id' in ('K1','K2','K3')), 'las comprobaciones K1 a K3 del libro siguen cuadrando');
select is(jsonb_array_length(pg_temp.cv()->'serie') >= 2, true, 'la serie mensual trae octubre y noviembre');
select is((pg_temp.cv()->'serie'->(jsonb_array_length(pg_temp.cv()->'serie') - 1)->'socios'->1->>'valuacion_cent')::bigint, 14499227::bigint, 'el ultimo mes de la serie es la valuacion actual de Javier');
select is((pg_temp.cv()->'proveedores'->>'se_debe_cent')::bigint, 1200000::bigint, 'proveedores: se debe 12,000.00 (posicion del Mayor)');
select is((pg_temp.cv()->'proveedores'->>'pedidos_socio_a_costo_cent')::bigint, 0::bigint, 'sin pedidos de socio a costo');

-- Retiro IGUAL a ambos (3,000.00 cada uno): la valuacion baja lo mismo, las utilidades acumuladas no cambian, retirado sube
-- El retiro exige utilidad asignada: un acta de corte (sin retirar ni reinvertir) la asigna a cada socio como utilidad por distribuir; desde ahi cada retiro baja la valuacion.
select pg_temp.como('Angelo');
select operacion.proponer_cierre_reparto('cv-ac1', '2026-11-01', '2026-11-11', '{"Angelo":{"retira":0,"reinvierte":0},"Javier":{"retira":0,"reinvierte":0}}');
select operacion.firmar_cierre_reparto('cv-ac2', (select max(id) from operacion.cierre_reparto));
select pg_temp.como('Javier');
select operacion.firmar_cierre_reparto('cv-ac3', (select max(id) from operacion.cierre_reparto));
set constraints all immediate;
select contabilidad.asentar_pendientes();
create temp table base_acta as select (pg_temp.s('Javier')->>'valuacion_cent')::bigint vj, (pg_temp.s('Angelo')->>'valuacion_cent')::bigint va, (pg_temp.cv()->'comparacion'->>'diferencia_valuacion_cent')::bigint x;
select ok(abs((select x from base_acta) - 4792190) <= 2 and (select vj + va from base_acta) = 14499227 + 9707037, 'tras el acta sin retiro ni reinversion la suma de valuaciones no cambia y la diferencia solo se mueve por el redondeo del acta (maximo 2 centavos)');
select operacion.registrar_pago_a_socio('cv-r1', 'Javier', 300000, 'retiro', 'efectivo', '2026-11-12');
select operacion.registrar_pago_a_socio('cv-r2', 'Angelo', 300000, 'retiro', 'efectivo', '2026-11-12');
select contabilidad.asentar_pendientes();
select is((pg_temp.s('Javier')->>'retirado_cent')::bigint, 300000::bigint, 'retiro igual: Javier retiro 3,000.00');
select is((pg_temp.s('Angelo')->>'retirado_cent')::bigint, 300000::bigint, 'retiro igual: Angelo retiro 3,000.00');
select is((pg_temp.s('Javier')->>'valuacion_cent')::bigint, (select vj - 300000 from base_acta), 'retiro igual: la valuacion de Javier baja 3,000.00');
select is((pg_temp.s('Angelo')->>'valuacion_cent')::bigint, (select va - 300000 from base_acta), 'retiro igual: la de Angelo baja 3,000.00');
select is((pg_temp.s('Javier')->>'capital_aportado_cent')::bigint + (pg_temp.s('Javier')->>'utilidades_acumuladas_cent')::bigint - (pg_temp.s('Javier')->>'retirado_cent')::bigint - (pg_temp.s('Javier')->>'fondos_en_poder_cent')::bigint, (pg_temp.s('Javier')->>'valuacion_cent')::bigint, 'Javier: capital + utilidades - retirado - fondos = valuacion (identidad del dueno)');
select is((pg_temp.cv()->'comparacion'->>'diferencia_valuacion_cent')::bigint, (select x from base_acta), 'retiros iguales: la diferencia de valuacion no cambia');
select is((pg_temp.cv()->'comparacion'->>'retiros_desiguales')::boolean, false, 'retiros iguales: sin alerta');
select is((pg_temp.id('S5')->>'ok')::boolean, true, 'S5 verde');
select is((pg_temp.id('S2')->>'ok')::boolean, true, 'retiro igual: la suma de valuaciones sigue siendo el capital contable');

-- Retiro DESIGUAL: Angelo retira 1,000.00 mas
select operacion.registrar_pago_a_socio('cv-r3', 'Angelo', 100000, 'retiro', 'efectivo', '2026-11-12');
select contabilidad.asentar_pendientes();
select is((pg_temp.cv()->'comparacion'->>'retiros_desiguales')::boolean, true, 'retiro desigual: alerta');
select is((pg_temp.cv()->'comparacion'->>'diferencia_retiros_cent')::bigint, 100000::bigint, 'retiro desigual: diferencia a igualar en retiros 1,000.00');
select is(pg_temp.cv()->'comparacion'->>'retiro_mas', 'Angelo', 'retiro desigual: Angelo retiro mas');
select is((pg_temp.id('S5')->>'ok')::boolean, false, 'S5 en rojo');
select is((pg_temp.cv()->'comparacion'->>'diferencia_valuacion_cent')::bigint, (select x + 100000 from base_acta), 'retiro desigual: la diferencia de valuacion sube 1,000.00');
select is((pg_temp.id('S2')->>'ok')::boolean, true, 'y aun asi las identidades contables cuadran (S2)');

-- Igualados: Angelo aporta lo que le toca para igualar valuaciones (48,921.90)
select pg_temp.como('Angelo');
select operacion.registrar_aportacion('cv-a3', 'Angelo', (select x + 100000 from base_acta), 'Aporta para igualar', 'capital', '2026-11-12');
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');
select is((pg_temp.cv()->'comparacion'->>'igualados')::boolean, true, 'tras aportar X las valuaciones quedan iguales');
select is((pg_temp.s('Javier')->>'valuacion_cent')::bigint, (pg_temp.s('Angelo')->>'valuacion_cent')::bigint, 'valuaciones identicas');
select ok(pg_temp.cv()->'comparacion'->>'le_toca_aportar' is null, 'nadie le toca aportar');

-- Seguridad: solo socios; anon y Omar sin acceso
select ok(not has_function_privilege('anon', 'api.cuenta_socios_valuacion(date)', 'execute'), 'anon no ejecuta la lectura');
select ok(not has_function_privilege('public', 'api.cuenta_socios_valuacion(date)', 'execute'), 'PUBLIC no ejecuta la lectura');
select ok(has_function_privilege('authenticated', 'api.cuenta_socios_valuacion(date)', 'execute'), 'authenticated si (la funcion exige rol socio)');
select ok(not has_function_privilege('authenticated', 'operacion.cuenta_socios_valuacion(date)', 'execute'), 'el auxiliar de operacion no se expone');
select pg_temp.como('Omar');
select throws_ok($$select api.cuenta_socios_valuacion(null)$$, null, null, 'Omar no lee la cuenta de socios');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', true);
select throws_ok($$select api.cuenta_socios_valuacion(null)$$, null, null, 'sin rol socio no se lee');
select * from finish();
rollback;
