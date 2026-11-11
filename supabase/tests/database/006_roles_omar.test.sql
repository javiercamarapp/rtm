-- pgTAP: roles (socio, omar desactivado, agente/servidor) y esquema omar cerrado (F1).
begin;
select plan(20);

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('rol.socio@example.test', 'socio', 'Javier', true), ('rol.omar@example.test', 'omar', null, false), ('rol.socio2@example.test', 'socio', 'Angelo', false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('41111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rol.socio@example.test'),
  ('42222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rol.omar@example.test'),
  ('43333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rol.socio2@example.test');

-- Datos de prueba (importacion) para que las vistas de omar tengan algo que (no) mostrar.
select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_modelo('Marca Rol', 'Marca Rol Uno 50K', 50000, 'ambas');
select catalogo.asegurar_sku('Marca Rol Uno 50K', 'Sabor A');
select catalogo.asegurar_cliente('Cliente Rol Bodega', 'Javier');
select catalogo.asegurar_persona_bodega('Cliente Rol Bodega', 'Persona Rol');
select catalogo.fijar_precio('rp1', 'Cliente Rol Bodega', 'Marca Rol Uno 50K', 24000, '2026-11-10', 'lista_javier');
select operacion.registrar_movimiento('re1', 'Marca Rol Uno 50K', 'Sabor A', 'bodega_omar', 'entrada_compra', 10, 100000, negocio.hoy());
select set_config('rtm.canal', '', true);

-- Socio activo: lee por api; no toca tablas.
select set_config('request.jwt.claim.sub', '41111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select ok(jsonb_array_length(api.catalogo_modelos()) >= 1, 'socio activo: api.catalogo_modelos()');
select ok(api.inventario_existencia() ? 'modelos', 'socio activo: api.inventario_existencia()');
select throws_ok($$select * from catalogo.modelo$$, '42501', null, 'socio: sin acceso directo a tablas del catalogo');
select throws_ok($$select * from operacion.movimiento_inventario$$, '42501', null, 'socio: sin acceso directo a tablas de operacion');
select throws_ok($$select catalogo.fijar_precio('x', 'a', 'b', 1, '2026-11-10', 'chat')$$, '42501', null, 'socio: las funciones de escritura no son ejecutables desde la API');
select is((select count(*)::int from omar.v_mercancia), 0, 'socio: las vistas de omar no devuelven nada');
reset role;

-- Omar DESACTIVADO: cerrado.
select set_config('request.jwt.claim.sub', '42222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select throws_ok($$select api.catalogo_modelos()$$, '42501', null, 'omar desactivado: no lee el catalogo');
select is((select count(*)::int from omar.v_mercancia), 0, 'omar desactivado: v_mercancia cerrada (cero filas)');
select is((select count(*)::int from omar.v_mis_precios), 0, 'omar desactivado: v_mis_precios cerrada (cero filas)');
reset role;

-- Socio desactivado tampoco entra.
select set_config('request.jwt.claim.sub', '43333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select throws_ok($$select api.clientes_lista()$$, '42501', null, 'socio desactivado: sin acceso');
reset role;

-- G9: omar ACTIVO (simulado): solo ve omar.*; el resto falla con permission denied.
update seguridad.usuario set activo = true where id = '42222222-2222-2222-2222-222222222222';
select set_config('request.jwt.claim.sub', '42222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mercancia where modelo = 'Marca Rol Uno 50K'), 1, 'omar activo: ve la mercancia de Bodega Omar');
select is((select precio from omar.v_mis_precios where modelo = 'Marca Rol Uno 50K'), 24000::bigint, 'omar activo: ve su tabulador');
select throws_ok($$select * from catalogo.tabulador_precio$$, '42501', null, 'omar: select fuera de omar.* falla (tabulador)');
select throws_ok($$select * from catalogo.costo_proveedor$$, '42501', null, 'omar: select fuera de omar.* falla (costos)');
select throws_ok($$select api.clientes_lista()$$, '42501', null, 'omar: ninguna lectura de socio');
reset role;

-- Lista negra: ninguna columna de omar.* contiene ni deriva (pg_depend) de costo, margen, utilidad, precio_venta, cliente, proveedor.
select is((select count(*)::int from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'omar' and a.attnum > 0 and not a.attisdropped and a.attname ~* '(costo|margen|utilidad|precio_venta|cliente|proveedor)'), 0, 'lista negra: ningun nombre de columna en omar');
select is((select count(*)::int from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class join pg_namespace n on n.oid = v.relnamespace
            join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
            where n.nspname = 'omar' and d.refobjsubid > 0 and a.attname ~* '(costo|margen|utilidad|precio_venta|cliente|proveedor)'), 0, 'lista negra: ninguna dependencia directa (pg_depend) de columnas prohibidas');

-- Rol servidor: sin BYPASSRLS, sin acceso a tablas, solo ejecuta el limite de intentos.
select is((select rolbypassrls or rolsuper from pg_roles where rolname = 'servidor'), false, 'servidor: sin BYPASSRLS ni superusuario');
set local role servidor;
select set_config('rtm.t1', seguridad.registrar_intento_login('ip:zzzzzzzzzzzzzzzz')::text, true);
do $$ begin
  begin perform 1 from seguridad.usuario; perform set_config('rtm.t2', 'leyo', true);
  exception when insufficient_privilege then perform set_config('rtm.t2', 'denegado', true); end;
end $$;
reset role;
select is(current_setting('rtm.t1'), '1', 'servidor: ejecuta registrar_intento_login');
select is(current_setting('rtm.t2'), 'denegado', 'servidor: no lee seguridad.usuario');

select * from finish();
rollback;
