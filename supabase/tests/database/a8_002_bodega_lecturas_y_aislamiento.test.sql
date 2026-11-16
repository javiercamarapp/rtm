-- pgTAP a8_002: lecturas del rol 'bodega' (contenido correcto y SIN dinero, contactos ni direcciones) y aislamiento (ataques): el rol bodega no ejecuta
-- ninguna otra funcion api.* ni omar.*, no lee tablas, omar y anon no ven la vista de bodega. Auto-descubriente: recorre el catalogo, no una lista escrita a mano.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2026-10-01' where vigente_desde > '2026-10-01';

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('b82.socio@example.test', 'socio', 'Angelo', true), ('b82.omar@example.test', 'omar', null, true), ('b82.bodega@example.test', 'bodega', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('b8200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b82.socio@example.test'),
  ('b8200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b82.omar@example.test'),
  ('b8200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b82.bodega@example.test');
create function pg_temp.como(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce($1::text, ''), true) $$;

-- Datos: dos clientes con pedidos confirmados (uno empacado), una compra en camino con guia, existencia parcial ----------------------------------------
select pg_temp.como('b8200000-0000-0000-0000-000000000001');
select catalogo.asegurar_cliente('B82 Bodega Merida (socios)', 'Javier', 'credito_interno');
select catalogo.asegurar_persona_bodega('B82 Bodega Merida (socios)', 'B82 Bodega Merida (socios)');
select catalogo.asegurar_cliente('B82 Cliente Uno', 'Angelo');
select catalogo.asegurar_cliente('B82 Cliente Dos', 'Javier');
select catalogo.asegurar_modelo('B82 Marca', 'B82 Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('B82 Modelo 50K', 'Fresa');
select catalogo.asegurar_sku('B82 Modelo 50K', 'Uva');
select catalogo.fijar_costo('b82c1', 'Isaac', 'B82 Modelo 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('b82p1', 'B82 Cliente Uno', 'B82 Modelo 50K', 15000, '2026-11-01', 'chat');
select catalogo.fijar_precio('b82p2', 'B82 Cliente Dos', 'B82 Modelo 50K', 15500, '2026-11-01', 'chat');
select operacion.registrar_movimiento('b82m1', 'B82 Modelo 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 30, 300000, '2026-11-01');
select operacion.registrar_movimiento('b82m2', 'B82 Modelo 50K', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-01');
select operacion.crear_pedido('b82a', (select id from catalogo.cliente where nombre_canonico = 'B82 Cliente Uno'), '[{"modelo":"B82 Modelo 50K","sabor":"Fresa","piezas":25},{"modelo":"B82 Modelo 50K","sabor":"Uva","piezas":20}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, negocio.hoy() - 1, null, null, null, 'nota privada con dinero 999');
select operacion.confirmar_pedido('b82ac', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'b82a'));
select operacion.marcar_empacado('b82ae', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'b82a'));
select operacion.crear_pedido('b82b', (select id from catalogo.cliente where nombre_canonico = 'B82 Cliente Dos'), '[{"modelo":"B82 Modelo 50K","sabor":"Fresa","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('b82bc', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'b82b'));
-- Un borrador y un pedido directo del proveedor NO son trabajo de bodega.
select operacion.crear_pedido('b82d', (select id from catalogo.cliente where nombre_canonico = 'B82 Cliente Dos'), '[{"modelo":"B82 Modelo 50K","sabor":"Uva","piezas":22}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.crear_compra('b82o1', 'Isaac', '[{"modelo":"B82 Modelo 50K","sabor":"Fresa","pagadas":60},{"modelo":"B82 Modelo 50K","sabor":"Uva","pagadas":40}]'::jsonb, 45000, 0, '2026-11-20', 'bodega', 'sociedad', 'Angelo');
select operacion.confirmar_compra('b82o1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'b82o1'));
select operacion.marcar_compra_enviada('b82o1e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'b82o1'), '[{"paqueteria":"Castores","numero":"B82-GUIA-1"}]'::jsonb, '2026-11-20', '2026-11-13');
-- Una orden en borrador no se muestra.
select operacion.crear_compra('b82o2', 'Isaac', '[{"modelo":"B82 Modelo 50K","sabor":"Uva","pagadas":5}]'::jsonb, 0, 0, '2026-11-25', 'bodega', 'sociedad', 'Angelo');

-- Contenido para bodega -------------------------------------------------------------------------------------------------------------------
select pg_temp.como('b8200000-0000-0000-0000-000000000003');
set local role authenticated;
create temp table _hoy as select api.bodega_hoy_a_preparar() j;
create temp table _lleg as select api.bodega_llegadas() j;
reset role;
select is((select (j #>> '{resumen,pedidos}')::int from _hoy), 2, 'hoy: 2 pedidos confirmados (el borrador no cuenta)');
select is((select (j #>> '{resumen,clientes}')::int from _hoy), 2, 'hoy: 2 clientes');
select is((select (j #>> '{resumen,piezas}')::int from _hoy), 55, 'hoy: 55 piezas (25+20+10)');
select is((select (j #>> '{resumen,empacados}')::int from _hoy), 1, 'hoy: 1 empacado y 1 por empacar');
select is((select (j #>> '{resumen,de_dias_anteriores}')::int from _hoy), 1, 'hoy: uno viene de un dia anterior');
select is((select jsonb_array_length(j -> 'clientes') from _hoy), 2, 'agrupado por cliente');
select is((select j #>> '{clientes,0,cliente}' from _hoy), 'B82 Cliente Uno', 'el pedido mas antiguo va primero');
select is((select j #>> '{clientes,0,piezas}' from _hoy), '45', 'piezas del cliente uno: 45');
select is((select jsonb_array_length(j #> '{clientes,0,pedidos,0,lineas}') from _hoy), 2, 'lineas por modelo y sabor');
select is((select (x ->> 'falta')::int from _hoy, jsonb_array_elements(j -> 'surtido') x where x ->> 'sabor' = 'Fresa'), 5, 'surtido: faltan 5 de Fresa (35 pedidas, 30 en existencia)');
select is((select (x ->> 'piezas')::int from _hoy, jsonb_array_elements(j -> 'surtido') x where x ->> 'sabor' = 'Uva'), 20, 'surtido: 20 de Uva');
select is((select jsonb_array_length(j -> 'compras') from _lleg), 1, 'llegadas: una orden por recibir (el borrador no cuenta)');
select is((select j #>> '{compras,0,proveedor}' from _lleg), null, 'llegadas: ya no lleva el proveedor (decision del dueno, 14-nov)');
select is((select j #>> '{compras,0,llegada_estimada}' from _lleg), '2026-11-20', 'llegadas: fecha esperada');
select is((select j #>> '{compras,0,guias,0,numero}' from _lleg), 'B82-GUIA-1', 'llegadas: guia de entrada (paqueteria y numero)');
select is((select (j #>> '{compras,0,piezas}')::int from _lleg), 100, 'llegadas: 100 piezas esperadas');
select is((select (x ->> 'piezas')::int from _lleg, jsonb_array_elements(j -> 'por_guardar') x where x ->> 'sabor' = 'Fresa'), 60, 'por guardar: 60 de Fresa');

-- Sin dinero, contactos ni direcciones: ni en llaves ni en valores -------------------------------------------------------------------------
select is((select count(*)::int from (select jsonb_path_query(j, 'strict $.**') v from _hoy union all select jsonb_path_query(j, 'strict $.**') from _lleg) q
            where jsonb_typeof(v) = 'object' and exists (select 1 from jsonb_object_keys(v) k where k ~* '(precio|costo|monto|saldo|margen|total|valor|utilidad|renta|envio|telefono|direccion|correo|nota|duenio|deuda|cuenta|pago)')), 0, 'ninguna llave de dinero, contacto ni direccion en las lecturas de bodega');
select is((select count(*)::int from _hoy where j::text ~ '(999|15000|15500|150\.00|45000|300000)'), 0, 'ninguna cifra de precio, envio o nota en la lectura de hoy');
select is((select count(*)::int from _lleg where j::text ~ '(10000|45000|450\.00|1000000)'), 0, 'ninguna cifra de costo ni guia en las llegadas');

-- Quien puede leer ----------------------------------------------------------------------------------------------------------------------
select pg_temp.como('b8200000-0000-0000-0000-000000000001');
set local role authenticated;
select ok(api.bodega_hoy_a_preparar() ? 'clientes', 'socio puede ver la vista (tal como la ve bodega)');
select ok(api.bodega_llegadas() ? 'compras', 'socio puede ver las llegadas');
reset role;
select pg_temp.como('b8200000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$select api.bodega_hoy_a_preparar()$$, '42501', null, 'omar activo no ve la vista de bodega');
select throws_ok($$select api.bodega_llegadas()$$, '42501', null, 'omar activo no ve las llegadas');
reset role;
select pg_temp.como(null);
set local role anon;
select throws_ok($$select api.bodega_hoy_a_preparar()$$, '42501', null, 'anon no ve la vista de bodega');
select throws_ok($$select api.bodega_llegadas()$$, '42501', null, 'anon no ve las llegadas');
reset role;
select is((select count(*)::int from pg_proc p where p.oid in ('api.bodega_hoy_a_preparar()'::regprocedure, 'api.bodega_llegadas()'::regprocedure)
            and (has_function_privilege('anon', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))), 0, 'has_function_privilege: sin EXECUTE para anon ni PUBLIC');

-- ATAQUE: el rol bodega llama a TODA otra funcion api.* y omar.* con argumentos nulos: debe recibir 42501 -----------------------------------
create function pg_temp.sondeo() returns text language plpgsql as $$
declare f record; v_args text; v_estado text; v_malas text[] := array[]::text[]; v_n int := 0;
begin
  for f in select n.nspname, p.proname, p.oid, p.proargtypes::oid[] as tipos
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('api', 'omar') and has_function_privilege(current_user, p.oid, 'EXECUTE')
              and p.proname not in ('mi_sesion', 'bodega_hoy_a_preparar', 'bodega_llegadas', 'bodega_marcar_empacado') order by 1, 2, 3 loop
    v_args := coalesce((select string_agg('null::' || t::regtype::text, ', ' order by o) from unnest(f.tipos) with ordinality u(t, o)), '');
    v_n := v_n + 1;
    begin
      execute format('select %I.%I(%s)', f.nspname, f.proname, v_args);
      v_malas := v_malas || (f.nspname || '.' || f.proname || ' (sin error)');
    exception when others then
      get stacked diagnostics v_estado = returned_sqlstate;
      if v_estado <> '42501' then v_malas := v_malas || (f.nspname || '.' || f.proname || ' (' || v_estado || ')'); end if;
    end;
  end loop;
  return v_n::text || ' funciones; fuera de 42501: ' || coalesce(array_to_string(v_malas, ', '), '');
end $$;
select pg_temp.como('b8200000-0000-0000-0000-000000000003');
set local role authenticated;
select matches(pg_temp.sondeo(), '^[0-9]{3,} funciones; fuera de 42501: $', 'bodega recibe 42501 en TODA otra funcion api.* y omar.* (auto-descubierto)');
select ok(api.mi_sesion() ->> 'rol' = 'bodega', 'unica funcion abierta a cualquier sesion: mi_sesion (solo su propia fila)');
select is((select count(*)::int from omar.v_mercancia), 0, 'bodega: v_mercancia de Omar devuelve cero filas');
select is((select count(*)::int from omar.v_mis_precios), 0, 'bodega: v_mis_precios devuelve cero filas');
select is((select count(*)::int from omar.v_mi_cuenta), 0, 'bodega: v_mi_cuenta devuelve cero filas');
select throws_ok($$select * from catalogo.cliente$$, '42501', null, 'bodega: sin lectura directa de clientes');
select throws_ok($$select * from catalogo.tabulador_precio$$, '42501', null, 'bodega: sin precios');
select throws_ok($$select * from catalogo.costo_proveedor$$, '42501', null, 'bodega: sin costos');
select throws_ok($$select * from operacion.pedido$$, '42501', null, 'bodega: sin pedidos en tabla');
select throws_ok($$select * from operacion.compra$$, '42501', null, 'bodega: sin compras en tabla');
select throws_ok($$select * from operacion.cuenta_socio_mov$$, '42501', null, 'bodega: sin cuentas de socios');
select throws_ok($$select * from seguridad.usuario$$, '42501', null, 'bodega: sin usuarios');
select throws_ok($$select * from seguridad.correo_permitido$$, '42501', null, 'bodega: sin lista de correos');
select throws_ok($$select * from seguridad.tipo_cuenta$$, '42501', null, 'bodega: sin catalogo de tipos');
select throws_ok($$select * from agente.miembro$$, '42501', null, 'bodega: sin Telegram');
select throws_ok($$select * from contabilidad.asiento$$, '42501', null, 'bodega: sin contabilidad');
select throws_ok($$select * from contactos.contacto$$, '42501', null, 'bodega: sin contactos');
reset role;

-- Estatico: ninguna otra funcion admite 'bodega' en exigir_rol; ningun privilegio de tabla para anon/authenticated fuera de las 3 vistas de omar ------------
select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prosrc ~ 'exigir_rol\(array\[[^]]*''bodega''' and p.proname not in ('bodega_hoy_a_preparar', 'bodega_llegadas', 'bodega_marcar_empacado')), '', 'solo las funciones propias de bodega admiten el rol bodega');
select is((select coalesce(string_agg(n.nspname || '.' || c.relname, ',' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'supabase_functions', '_realtime', 'pgsodium', 'net', 'pgbouncer', 'pg_temp')
              and n.nspname !~ '^pg_' and (has_any_column_privilege('authenticated', c.oid, 'SELECT') or has_any_column_privilege('anon', c.oid, 'SELECT'))), 'omar.v_mercancia,omar.v_mi_cuenta,omar.v_mis_precios', 'tablas legibles por la API: solo las tres vistas cerradas de omar');

select * from finish();
rollback;
