-- pgTAP a12_001: banner de igualacion de valuacion (api.cuenta_socios_valuacion -> banner; agente.valuacion_socios). Escenario del dueno (14-nov): Javier 154,832.30, Angelo 106,910.39;
-- faltan 47,921.91 = 35,475.00 de fondos cobrados en la cuenta personal de Angelo + 12,446.91 de aportacion. ESCRITA SIN DOCKER: no se ha ejecutado (ver docs/banner-igualar-valuacion.md).
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5800101, 'angelo');
select agente.registrar_miembro(5800102, 'javier');
select set_config('rtm.canal', '', true);
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('bn.ang@example.test', 'socio', 'Angelo', true), ('bn.jav@example.test', 'socio', 'Javier', true), ('bn.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bn.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bn.jav@example.test'),
  ('77777777-7777-7777-7777-7777777777e3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bn.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777e1' when 'Omar' then '77777777-7777-7777-7777-7777777777e3' when 'Javier' then '77777777-7777-7777-7777-7777777777e2' else '' end, true) $$;
create function pg_temp.cv(p date default null) returns jsonb language sql as $$ select api.cuenta_socios_valuacion(p) $$;
create function pg_temp.s(p_socio text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.cv()->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.ig() returns jsonb language sql as $$ select pg_temp.cv()->'igualacion' $$;
create function pg_temp.comp(p_id text) returns bigint language sql as $$ select (x->>'monto_cent')::bigint from jsonb_array_elements(pg_temp.ig()->'componentes') x where x->>'id' = $1 $$;

select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('BN Marca', 'BN Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('BN Modelo', 'Uva');
select catalogo.fijar_costo('bn-c', 'Isaac', 'BN Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_modelo('BN Marca', 'BN Karen', 25000, 'ambas');
select catalogo.asegurar_sku('BN Karen', 'Mango');
select catalogo.fijar_costo('bn-ck', 'Karen', 'BN Karen', 8000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('BN Cliente', 'Javier');
select catalogo.fijar_precio('bn-p', 'BN Cliente', 'BN Modelo', 20000, '2020-01-01', 'chat');
select catalogo.fijar_precio('bn-pk', 'BN Cliente', 'BN Karen', 15000, '2020-01-01', 'chat');

-- Resto del capital inicial: Javier 118,161.91 - 60 x 1,000.00 = 58,161.91 ; Angelo 105,715.00 - 60 x 900.00 = 51,715.00
select operacion.registrar_aportacion('bn-a1', 'Javier', 11816191, 'Capital inicial (resto)', 'capital', '2026-10-15');
select operacion.registrar_aportacion('bn-a2', 'Angelo', 10571500, 'Capital inicial (resto)', 'capital', '2026-10-19');
-- Ventas y cobros: utilidad 73,340.78 = 40,000.00 + 10,500.00 + 22,840.78 de envio cobrado
select operacion.crear_pedido('bn-v1', (select id from catalogo.cliente where nombre_canonico='BN Cliente'), '[{"modelo":"BN Modelo","sabor":"Uva","piezas":400}]'::jsonb, 'isaac_directo', null, 2284078, 0, 0, '2026-11-03');
select operacion.confirmar_pedido('bn-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bn-v1'));
select operacion.enviar_pedido('bn-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bn-v1'), null, '{"paqueteria":"Castores","numero":"VD-G1","costo_cent":0}'::jsonb, '2026-11-03', true);
select operacion.crear_pedido('bn-v2', (select id from catalogo.cliente where nombre_canonico='BN Cliente'), '[{"modelo":"BN Karen","sabor":"Mango","piezas":150}]'::jsonb, 'karen_directo', null, 0, 0, 0, '2026-11-04');
select operacion.confirmar_pedido('bn-v2c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bn-v2'));
select operacion.enviar_pedido('bn-v2e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'bn-v2'), null, '{"paqueteria":"Castores","numero":"VD-G2","costo_cent":0}'::jsonb, '2026-11-04', true);
select operacion.registrar_pago('bn-pg2', 'Efectivo', 2518573, (select id from catalogo.cliente where nombre_canonico='BN Cliente'), null, true, 'abono', '2026-11-08');
select operacion.registrar_pago('bn-pg3', 'Isaac', 4500000, (select id from catalogo.cliente where nombre_canonico='BN Cliente'), null, true, 'abono', '2026-11-09');
-- Tres cobros que le pagaron a Angelo (fondos de la sociedad en su cuenta): 10,000.00 + 15,000.00 + 10,475.00 = 35,475.00
select operacion.registrar_pago('bn-pg1a', 'Angelo', 1000000, (select id from catalogo.cliente where nombre_canonico='BN Cliente'), null, true, 'abono', '2026-11-10');
select operacion.registrar_pago('bn-pg1b', 'Angelo', 1500000, (select id from catalogo.cliente where nombre_canonico='BN Cliente'), null, true, 'abono', '2026-11-11');
select operacion.registrar_pago('bn-pg1c', 'Angelo', 1047500, (select id from catalogo.cliente where nombre_canonico='BN Cliente'), null, true, 'abono', '2026-11-12');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');

create function pg_temp.bn() returns jsonb language sql as $$ select api.cuenta_socios_valuacion()->'banner' $$;
create function pg_temp.pb(p text) returns jsonb language sql as $$ select pg_temp.bn()->'por_socio'->p $$;
create function pg_temp.av() returns jsonb language plpgsql as $$ begin perform pg_temp.como(''); return agente.valuacion_socios(); end $$;
-- ============================================================ (1) Cifras del dueno: faltan 47,921.91 = 35,475.00 de fondos + 12,446.91 de aportacion
select is((pg_temp.bn()->>'activo')::boolean, true, 'banner activo: no estan igualados');
select is((pg_temp.bn()->>'faltan_cent')::bigint, 4792191::bigint, 'faltan 47,921.91');
select is(pg_temp.bn()->>'menor', 'Angelo', 'debe reponer Angelo');
select is((pg_temp.pb('Angelo')->>'entregar_cent')::bigint, 3547500::bigint, 'partida 1: entregar los 35,475.00 recibidos en su cuenta personal');
select is((pg_temp.pb('Angelo')->>'aportar_cent')::bigint, 1244691::bigint, 'partida 2: aportar 12,446.91');
select is((pg_temp.bn()->>'cuadra')::boolean, true, 'entregar + aportar - entregar del otro = lo que falta');
select is((pg_temp.bn()->>'neteo_cent')::bigint, 0::bigint, 'el otro socio no tiene fondos: sin neteo');
select is((pg_temp.bn()->>'tolerancia_cent')::bigint, 1::bigint, 'tolerancia documentada: 1 centavo');
select is((pg_temp.pb('Angelo')->>'dias_fondos')::int, (negocio.hoy() - date '2026-11-10'), 'antiguedad: dias desde el cobro mas viejo (10-nov)');
select is(pg_temp.pb('Angelo')->>'desde', '2026-11-10', 'desde = fecha del cobro mas viejo');
select is(jsonb_array_length(pg_temp.pb('Angelo')->'entregas'), 0, 'sin entregas registradas todavia');
select is(pg_temp.pb('Angelo')->'progreso_bp', 'null'::jsonb, 'sin avance todavia');
select is(pg_temp.pb('Javier')->'dias_fondos', 'null'::jsonb, 'Javier no tiene fondos: sin antiguedad');
select is(pg_temp.cv('2026-11-10')->'banner', 'null'::jsonb, 'con un corte historico el banner no aplica');
select is(pg_temp.cv()->'banner'->'igualados', 'false'::jsonb, 'igualados falso');
select is((pg_temp.av()->'banner'->>'faltan_cent')::bigint, 4792191::bigint, 'agente.valuacion_socios trae el mismo banner (misma cifra)');
select pg_temp.como('Omar');
select throws_ok($$select api.cuenta_socios_valuacion()$$, null, null, 'Omar no ve valuaciones ni el banner');
select pg_temp.como('Javier');

-- ============================================================ (2) entrega parcial: baja lo que falta, queda el historial y el avance
select pg_temp.como('Angelo');
select operacion.registrar_entrega_socio('bn-e1', 'Angelo', 1000000, 'sociedad', null, 'fondos', null, '2026-11-13');
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');
select is((pg_temp.bn()->>'faltan_cent')::bigint, 3792191::bigint, 'tras entregar 10,000.00 faltan 37,921.91');
select is((pg_temp.pb('Angelo')->>'entregar_cent')::bigint, 2547500::bigint, 'quedan 25,475.00 por entregar');
select is((pg_temp.pb('Angelo')->>'entregado_cent')::bigint, 1000000::bigint, 'entregado desde el cobro mas viejo: 10,000.00');
select is(jsonb_array_length(pg_temp.pb('Angelo')->'entregas'), 1, 'una entrega parcial en el historial');
select is((pg_temp.pb('Angelo')->>'progreso_bp')::int, 2818, 'avance 28.18 % (10,000.00 de 35,475.00, truncado a punto base)');
select is((pg_temp.bn()->>'cuadra')::boolean, true, 'sigue cuadrando');

-- ============================================================ (3) entrega el resto y aporta: el banner desaparece (activo = false)
select pg_temp.como('Angelo');
select operacion.registrar_entrega_socio('bn-e2', 'Angelo', 2547500, 'sociedad', null, 'fondos', null, '2026-11-13');
select operacion.registrar_aportacion('bn-a3', 'Angelo', 1244691, 'Aporta para igualar', 'capital', '2026-11-13');
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');
select is((pg_temp.bn()->>'faltan_cent')::bigint, 0::bigint, 'igualados: faltan 0');
select is((pg_temp.bn()->>'activo')::boolean, false, 'el banner desaparece solo');
select is((pg_temp.bn()->>'exacto')::boolean, true, 'diferencia exacta de 0');
select is((pg_temp.pb('Angelo')->>'entregar_cent')::bigint, 0::bigint, 'nada que entregar');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', true);
select * from finish();
rollback;
