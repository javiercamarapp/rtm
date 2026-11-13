-- Escenario ILUSTRATIVO de capital por mes (octubre y noviembre de 2026) para las capturas y la prueba e2e. Cifras inventadas, sin personas ni datos reales.
-- Lo carga scripts/capturas/datos-demo-capital.mjs (una sola vez por base; confirma al final). Estructura: aportaciones de capital desiguales, utilidad 53,660.73 50/50,
-- reinversion parcial por acta y en el proveedor, un retiro, 35,475.00 de fondos de la sociedad en poder de un socio, Karen con deuda, Isaac con saldo a favor y 62,161.91 por clasificar.
begin;
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('demo.capital.angelo@prueba.invalid', 'socio', 'Angelo', true), ('demo.capital.javier@prueba.invalid', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.capital.angelo@prueba.invalid'),
  ('77777777-7777-7777-7777-7777777777c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo.capital.javier@prueba.invalid');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777c1' else '77777777-7777-7777-7777-7777777777c2' end, true) $$;
select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('CAP Marca', 'CAP Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('CAP Modelo', 'Uva');
select catalogo.fijar_costo('cap-c', 'Isaac', 'CAP Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_modelo('CAP Marca', 'CAP Karen', 25000, 'ambas');
select catalogo.asegurar_sku('CAP Karen', 'Mango');
select catalogo.fijar_costo('cap-ck', 'Karen', 'CAP Karen', 8000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('CAP Cliente', 'Javier');
select catalogo.fijar_precio('cap-p', 'CAP Cliente', 'CAP Modelo', 20000, '2020-01-01', 'chat');
-- Octubre
select operacion.registrar_aportacion('cap-a1', 'Angelo', 11816191, 'Capital inicial', 'capital', '2026-10-15');
select operacion.registrar_aportacion('cap-a2', 'Javier', 10571500, 'Capital inicial', 'capital', '2026-10-19');
select operacion.pago_proveedor_de_socio('cap-pp1', 'Isaac', 6216191, 'Javier', 'dinero_propio', '2026-10-21', 'Pago de Javier a Isaac, destino por confirmar');
select catalogo.fijar_precio('cap-pk', 'CAP Cliente', 'CAP Karen', 15000, '2020-01-01', 'chat');
-- Noviembre: ventas
select operacion.crear_pedido('cap-v1', (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), '[{"modelo":"CAP Modelo","sabor":"Uva","piezas":400}]'::jsonb, 'isaac_directo', null, 316073, 0, 0, '2026-11-03');
select operacion.confirmar_pedido('cap-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v1'));
select operacion.enviar_pedido('cap-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v1'), null, '{"paqueteria":"Castores","numero":"CAP-G1","costo_cent":0}'::jsonb, '2026-11-03', true);
select operacion.crear_pedido('cap-v2', (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), '[{"modelo":"CAP Karen","sabor":"Mango","piezas":150}]'::jsonb, 'karen_directo', null, 0, 0, 0, '2026-11-04');
select operacion.confirmar_pedido('cap-v2c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v2'));
select operacion.enviar_pedido('cap-v2e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cap-v2'), null, '{"paqueteria":"Castores","numero":"CAP-G2","costo_cent":0}'::jsonb, '2026-11-04', true);
select operacion.registrar_pago('cap-pg2', 'Efectivo', 2518573, (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), null, true, 'abono', '2026-11-08');
select operacion.registrar_pago('cap-pg3', 'Isaac', 4500000, (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), null, true, 'abono', '2026-11-09');
select pg_temp.como('Angelo');
select operacion.proponer_cierre_reparto('cap-ac1', '2026-11-01', '2026-11-11', '{"Angelo":{"retira":300000,"reinvierte":500000},"Javier":{"retira":0,"reinvierte":200000}}');
select pg_temp.como('Angelo');
select operacion.firmar_cierre_reparto('cap-ac2', (select max(id) from operacion.cierre_reparto));
select pg_temp.como('Javier');
select operacion.firmar_cierre_reparto('cap-ac3', (select max(id) from operacion.cierre_reparto));
set constraints all immediate;
select operacion.registrar_pago('cap-pg1', 'Javier', 3547500, (select id from catalogo.cliente where nombre_canonico='CAP Cliente'), null, true, 'abono', '2026-11-12');
select operacion.registrar_pago_a_socio('cap-ret1', 'Angelo', 300000, 'retiro', 'efectivo', '2026-11-12');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
commit;
