-- pgTAP 901 (QA de punta a punta, H-07): contrato de las 11 funciones api.* de lectura que ninguna prueba nombraba:
-- catalogo_modelo_precios, cliente_ficha, compra_catalogo, compra_detalle, compras_lista, cxc_cliente, nota_fuente, pagos_contexto,
-- paquetes_en_transito, proveedor_hoja y socios_cuenta. Por funcion: forma del JSON, socio activo SI, Omar y socio desactivado NO (42501).
-- ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos con prefijo "N901".
begin;
select no_plan();
-- Las pruebas fechan sus operaciones antes del 10-nov-2026 (inicio de vigencia de la configuracion sembrada): se adelanta la vigencia dentro de la transaccion.
update catalogo.config set vigente_desde = '2026-10-01' where vigente_desde = '2026-11-10';

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('n901.socio@example.test', 'socio', 'Javier', true), ('n901.omar@example.test', 'omar', null, true), ('n901.off@example.test', 'socio', 'Angelo', false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('91111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n901.socio@example.test'),
  ('92222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n901.omar@example.test'),
  ('93333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n901.off@example.test');
select set_config('request.jwt.claim.sub', '91111111-1111-1111-1111-111111111111', true);
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('N901 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('N901 Omar Cliente', 'N901 Omar');
  end if;
end $$;

select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_cliente('N901 Cliente', 'Angelo');
select catalogo.asegurar_modelo('N901 Marca', 'N901 Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('N901 Modelo 50K', 'Fresa');
select catalogo.fijar_costo('n901c1', 'Isaac', 'N901 Modelo 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('n901p1', 'N901 Cliente', 'N901 Modelo 50K', 15000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('n901m1', 'N901 Modelo 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 100, 1022500, '2026-11-08');
select set_config('rtm.canal', '', true);

select operacion.crear_compra('n901o1', 'Isaac', '[{"modelo":"N901 Modelo 50K","sabor":"Fresa","pagadas":10}]'::jsonb, 0, 0, '2026-11-09');
select operacion.crear_pedido('n901pe', (select id from catalogo.cliente where nombre_canonico = 'N901 Cliente'), '[{"modelo":"N901 Modelo 50K","sabor":"Fresa","piezas":40}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, '2026-11-10');
select operacion.confirmar_pedido('n901pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n901pe'));
select operacion.enviar_pedido('n901pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n901pe'), null, null, '2026-11-10');

create temp table _ids as select
  (select id from catalogo.cliente where nombre_canonico = 'N901 Cliente') as cliente,
  (select id from catalogo.modelo where nombre_canonico = 'N901 Modelo 50K') as modelo,
  (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n901o1') as compra,
  (select id from operacion.nota order by id desc limit 1) as nota;
grant select on _ids to authenticated;

select set_config('request.jwt.claim.sub', '91111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select ok(jsonb_typeof(api.catalogo_modelo_precios((select modelo from _ids))) in ('array', 'object'), 'catalogo_modelo_precios: devuelve JSON estructurado');
select ok(api.catalogo_modelo_precios((select modelo from _ids))::text like '%N901 Cliente%', 'catalogo_modelo_precios: incluye al cliente con precio');
select ok(api.catalogo_modelo_precios((select modelo from _ids))::text like '%15000%', 'catalogo_modelo_precios: precio 150.00 del tabulador');
select ok(jsonb_typeof(api.cliente_ficha((select cliente from _ids))) = 'object', 'cliente_ficha: objeto');
select ok(api.cliente_ficha((select cliente from _ids))::text like '%N901 Cliente%', 'cliente_ficha: nombre del cliente');
select ok(jsonb_typeof(api.compra_catalogo('Isaac')) = 'object', 'compra_catalogo: objeto');
select is(api.compra_catalogo('Isaac') ->> 'modalidad', 'semanal_viernes', 'compra_catalogo: Isaac liquida cada viernes');
select ok(jsonb_typeof(api.compra_catalogo('Isaac') -> 'skus') = 'array', 'compra_catalogo: skus es lista, nunca null');
select ok(jsonb_typeof(api.compras_lista()) = 'array', 'compras_lista: lista');
select ok(jsonb_array_length(api.compras_lista('Isaac')) >= 1, 'compras_lista: la OC de la prueba aparece');
select ok(jsonb_typeof(api.compra_detalle((select compra from _ids))) = 'object', 'compra_detalle: objeto');
select is(api.compra_detalle((select compra from _ids)) ->> 'estado', 'borrador', 'compra_detalle: nace en borrador');
select ok(jsonb_typeof(api.cxc_cliente((select cliente from _ids))) = 'object', 'cxc_cliente: objeto');
select ok(jsonb_typeof(api.nota_fuente((select nota from _ids))) = 'object', 'nota_fuente: objeto con cliente e interno');
select ok(api.nota_fuente((select nota from _ids)) ? 'cliente', 'nota_fuente: trae la nota del cliente');
select ok(api.nota_fuente((select nota from _ids))::text !~* '"cliente":\{[^}]*(utilidad|margen)', 'nota_fuente: la nota del cliente no trae utilidad ni margen');
select ok(jsonb_typeof(api.pagos_contexto()) = 'object', 'pagos_contexto: objeto');
select ok(jsonb_typeof(api.pagos_contexto() -> 'cuentas') = 'array', 'pagos_contexto: cuentas es lista');
select ok(jsonb_typeof(api.paquetes_en_transito()) in ('array', 'object'), 'paquetes_en_transito: JSON estructurado');
select ok(jsonb_typeof(api.proveedor_hoja('Isaac')) = 'object', 'proveedor_hoja: objeto');
select ok(jsonb_typeof(api.proveedor_hoja('Karen', null, 'todo')) = 'object', 'proveedor_hoja: ambito todo');
select ok(jsonb_typeof(api.socios_cuenta()) = 'object', 'socios_cuenta: objeto');
select ok(api.socios_cuenta()::text like '%Angelo%' and api.socios_cuenta()::text like '%Javier%', 'socios_cuenta: los dos socios');
select throws_ok($$select * from operacion.compra$$, '42501', null, 'sin acceso directo a tablas');
reset role;

-- Omar (simulado) y socio desactivado no leen nada de esto.
select set_config('request.jwt.claim.sub', '92222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select throws_ok($$select api.catalogo_modelo_precios(1)$$, '42501', null, 'omar: catalogo_modelo_precios');
select throws_ok($$select api.cliente_ficha(1)$$, '42501', null, 'omar: cliente_ficha');
select throws_ok($$select api.compra_catalogo('Isaac')$$, '42501', null, 'omar: compra_catalogo');
select throws_ok($$select api.compras_lista()$$, '42501', null, 'omar: compras_lista');
select throws_ok($$select api.compra_detalle(1)$$, '42501', null, 'omar: compra_detalle');
select throws_ok($$select api.cxc_cliente(1)$$, '42501', null, 'omar: cxc_cliente');
select throws_ok($$select api.nota_fuente(1)$$, '42501', null, 'omar: nota_fuente');
select throws_ok($$select api.pagos_contexto()$$, '42501', null, 'omar: pagos_contexto');
select throws_ok($$select api.paquetes_en_transito()$$, '42501', null, 'omar: paquetes_en_transito');
select throws_ok($$select api.proveedor_hoja('Isaac')$$, '42501', null, 'omar: proveedor_hoja');
select throws_ok($$select api.socios_cuenta()$$, '42501', null, 'omar: socios_cuenta');
reset role;
select set_config('request.jwt.claim.sub', '93333333-3333-3333-3333-333333333333', true);
set local role authenticated;
select throws_ok($$select api.socios_cuenta()$$, '42501', null, 'socio desactivado: socios_cuenta');
select throws_ok($$select api.compras_lista()$$, '42501', null, 'socio desactivado: compras_lista');
select throws_ok($$select api.pagos_contexto()$$, '42501', null, 'socio desactivado: pagos_contexto');
reset role;

-- anon: ninguna de las 11 es ejecutable.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'api' and p.proname in ('catalogo_modelo_precios', 'cliente_ficha', 'compra_catalogo', 'compra_detalle', 'compras_lista', 'cxc_cliente', 'nota_fuente', 'pagos_contexto', 'paquetes_en_transito', 'proveedor_hoja', 'socios_cuenta')
              and has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'anon no ejecuta ninguna de las 11 lecturas');
select * from finish();
rollback;
