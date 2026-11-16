-- pgTAP F2: lo que la web puede hacer pasa SOLO por api.* con rol socio activo; Omar (aun activo en simulacion), anon y socio desactivado no entran.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('api.socio@example.test', 'socio', 'Javier', true), ('api.omar@example.test', 'omar', null, true), ('api.socio2@example.test', 'socio', 'Angelo', false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('51111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'api.socio@example.test'),
  ('52222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'api.omar@example.test'),
  ('53333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'api.socio2@example.test');

select set_config('rtm.canal', 'importacion', true);
-- Punto de partida conocido sin depender de datos previos: se neutralizan, DENTRO de la transaccion (que se revierte), los saldos de socios.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-010', '{}'::jsonb);
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;
create temp table _c0 as select coalesce(sum(operacion.pedido_saldo(id)), 0)::bigint as total from operacion.pedido where estado = 'enviado' and operacion.pedido_saldo(id) > 0;
grant select on _c0 to authenticated;
select catalogo.asegurar_cliente('Api Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('Api Omar Persona', 'Api Omar Persona');
select catalogo.asegurar_cliente('Api Cliente', 'Javier');
select catalogo.asegurar_modelo('Api Marca', 'Api Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('Api Modelo 50K', 'Fresa');
select catalogo.fijar_costo('apc1', 'Isaac', 'Api Modelo 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('apc2', 'Karen', 'Api Modelo 50K', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('app1', 'Api Cliente', 'Api Modelo 50K', 15000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('apm1', 'Api Modelo 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-08');
select set_config('rtm.canal', '', true);

-- Socio activo: escribe y lee por api -------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '51111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select ok((api.crear_pedido('apx1', (select (x->>'id')::bigint from jsonb_array_elements(api.clientes_lista()) x where x->>'nombre' = 'Api Cliente'),
  '[{"modelo":"Api Modelo 50K","sabor":"Fresa","piezas":40}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10', null, 30)->>'folio') ~ '^(?:[A-Z]{2}-\d{3}|P-\d{4})$', 'api.crear_pedido devuelve el folio (iniciales del cliente y consecutivo)');
select ok(jsonb_array_length(api.pedidos_lista()) >= 1, 'api.pedidos_lista()');
select is((api.pedido_detalle((select (x->>'id')::bigint from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Api Cliente' limit 1))->>'estado'), 'borrador', 'api.pedido_detalle()');
select ok((api.pedido_catalogo((select (x->>'id')::bigint from jsonb_array_elements(api.clientes_lista()) x where x->>'nombre' = 'Api Cliente'))->'skus') @> '[{"modelo":"Api Modelo 50K","precio_cent":15000}]'::jsonb, 'api.pedido_catalogo(): precio del tabulador y existencia');
select lives_ok($$select api.confirmar_pedido('apx1c', (select (x->>'id')::bigint from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Api Cliente' limit 1))$$, 'api.confirmar_pedido');
select is(jsonb_array_length(api.paquetes_por_hacer()->'pedidos') >= 1, true, 'api.paquetes_por_hacer(): el pedido confirmado aparece');
select is((select (x->>'piezas')::int from jsonb_array_elements(api.paquetes_por_hacer()->'surtido') x where x->>'modelo' = 'Api Modelo 50K'), 40, 'lista de surtido por modelo y sabor');
select lives_ok($$select api.enviar_pedido('apx1s', (select (x->>'id')::bigint from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Api Cliente' limit 1), null, null, '2026-11-10', true)$$, 'api.enviar_pedido');
select is((api.explicar_cifra('pedido:total:' || (select (x->>'id') from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Api Cliente' limit 1))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar el total del pedido: cuadra por dos vias');
select lives_ok($$select api.registrar_pago('apx1p', 'Javier', 200000, (select (x->>'id')::bigint from jsonb_array_elements(api.clientes_lista()) x where x->>'nombre' = 'Api Cliente'))$$, 'api.registrar_pago a la cuenta de un socio');
select is((api.explicar_cifra('pedido:saldo:' || (select (x->>'id') from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Api Cliente' limit 1))->'comprobacion'->>'cuadra')::boolean, true, 'Explicar el saldo del pedido: cuadra');
select is((api.explicar_cifra('socio:deuda:Javier')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar la deuda del socio: cuadra');
select is((api.explicar_cifra('socio:deuda:Javier')->>'valor')::bigint, 200000::bigint, 'Javier debe lo que cayo en su cuenta');
select is((api.explicar_cifra('cxc:total')->>'valor')::bigint - (select total from _c0), 400000::bigint, 'por cobrar: 40 x 150 = 6,000 menos 2,000');
select is((api.cuentas_por_cobrar()->>'total_cent')::bigint - (select total from _c0), 400000::bigint, 'api.cuentas_por_cobrar()');
select is((select f->>'estado' from jsonb_array_elements(api.cuentas_por_cobrar()->'filas') f where f->>'cliente' = 'Api Cliente'), 'al_corriente', 'con plazo de 30 dias: estado en palabra');
-- Pedidos anteriores a la regla de plazo obligatorio (14-nov) pueden seguir sin plazo: el estado 'sin_plazo' se conserva.
reset role;
update operacion.pedido set plazo_dias = null where cliente_id = (select id from catalogo.cliente where nombre_canonico = 'Api Cliente');
set local role authenticated;
select is((select f->>'estado' from jsonb_array_elements(api.cuentas_por_cobrar()->'filas') f where f->>'cliente' = 'Api Cliente'), 'sin_plazo', 'pedido anterior sin plazo (NULL): estado en palabra sin_plazo');
select is((api.proveedor_cuenta('Vapemate')->>'proveedor'), 'Karen', 'Vapemate es el alias de Karen');
select ok(api.proveedor_cuenta('Karen') ? 'etiqueta', 'api.proveedor_cuenta()');
select ok(api.avisos_lista()->'avisos' is not null, 'api.avisos_lista()');
select is((api.estado_socio('Javier')->>'deuda_cent')::bigint, 200000::bigint, 'api.estado_socio()');
select throws_ok($$select * from operacion.pedido$$, '42501', null, 'sin acceso directo a las tablas de operacion');
select throws_ok($$select operacion.crear_pedido('x', 1, '[]'::jsonb)$$, '42501', null, 'las funciones de operacion no son ejecutables desde la API');
reset role;

-- Omar (simulado activo): no ejecuta nada de F2 ------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '52222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select throws_ok($$select api.pedidos_lista()$$, '42501', null, 'omar: sin pedidos');
select throws_ok($$select api.cuentas_por_cobrar()$$, '42501', null, 'omar: sin cuentas por cobrar');
select throws_ok($$select api.proveedor_cuenta('Karen')$$, '42501', null, 'omar: sin cuenta con proveedores');
select throws_ok($$select api.crear_pedido('o1', 1, '[]'::jsonb)$$, '42501', null, 'omar: no escribe pedidos');
select throws_ok($$select api.registrar_pago('o2', 'Angelo', 100)$$, '42501', null, 'omar: no registra pagos');
select throws_ok($$select api.estado_socio('Javier')$$, '42501', null, 'omar: sin estado de cuenta de socios');
select throws_ok($$select api.avisos_lista()$$, '42501', null, 'omar: sin avisos de socios');
reset role;

-- Socio desactivado --------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '53333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select throws_ok($$select api.pedidos_lista()$$, '42501', null, 'socio desactivado: sin acceso');
reset role;

-- anon: ninguna funcion nueva ----------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('api', 'operacion', 'catalogo') and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'anon no ejecuta ninguna funcion de negocio');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('operacion', 'catalogo') and p.proname <> 'recargo_sugerido' and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 0, 'authenticated no ejecuta funciones de operacion ni catalogo directamente (salvo recargo_sugerido, que la cobranza concede a proposito y cb_001 vigila)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('api', 'operacion', 'catalogo') and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), 0, 'toda funcion de negocio fija search_path');
select * from finish();
rollback;
