-- pgTAP integracion 4: reportes. Un pedido ilustrativo con cifras a mano: 20 piezas a 150.00 con costo de 100.00 y guia de 180.00.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('rep.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-777777777782', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rep.javier@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777782', true);

select catalogo.asegurar_cliente('Rep Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('Rep Omar Persona', 'Rep Omar Persona');
select catalogo.asegurar_cliente('Rep Cliente', 'Javier');
select catalogo.asegurar_modelo('Rep Marca', 'Rep Modelo 10K', 10000, 'ambas');
select catalogo.asegurar_sku('Rep Modelo 10K', 'Sandia');
select catalogo.fijar_costo('rep:k', 'Isaac', 'Rep Modelo 10K', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('rep:p', 'Rep Cliente', 'Rep Modelo 10K', 15000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('rep:m', 'Rep Modelo 10K', 'Sandia', 'bodega_omar', 'entrada_compra', 30, 300000, negocio.hoy() - 2);
select operacion.crear_pedido('rep:v', (select id from catalogo.cliente where nombre_canonico = 'Rep Cliente'), '[{"modelo":"Rep Modelo 10K","sabor":"Sandia","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
create function pg_temp.pid() returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'rep:v' $$;
select operacion.confirmar_pedido('rep:vc', pg_temp.pid());
select operacion.marcar_empacado('rep:ve', pg_temp.pid());
select operacion.enviar_pedido('rep:vs', pg_temp.pid(), null, '{"paqueteria":"Castores","numero":"R-1","costo_cent":18000,"pagada_por":"Javier"}'::jsonb, negocio.hoy());

create function pg_temp.lunes() returns date language sql as $$ select negocio.hoy() - (extract(isodow from negocio.hoy())::int - 1) $$;
create function pg_temp.mi_pedido(j jsonb) returns jsonb language sql as $$ select p from jsonb_array_elements(j -> 'pedidos') p where p ->> 'cliente' = 'Rep Cliente' $$;

select is(pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) #>> '{lineas,0,piezas}', '20', 'insumos: 20 piezas');
select is((pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) #>> '{lineas,0,precio_cent}')::bigint, 15000::bigint, 'precio 150.00');
select is((pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) #>> '{lineas,0,costo_cent}')::bigint, 10000::bigint, 'costo 100.00 al promedio del momento');
select is((pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) ->> 'cobrado_cent')::bigint, 300000::bigint, 'cobrado 3,000.00');
select is((pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) ->> 'guia_cent')::bigint, 18000::bigint, 'guia 180.00');
select is(pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) ->> 'origen', 'bodega', 'origen bodega');
select is((pg_temp.mi_pedido(rep.insumos_semanal(pg_temp.lunes())) #>> '{control,salieron}')::int, 20, 'control C2: salieron 20');
select is(rep.insumos_semanal(pg_temp.lunes()) ->> 'en_curso', 'true', 'la semana de hoy esta en curso');
select is((select count(*)::int from jsonb_array_elements(rep.insumos_semanal(pg_temp.lunes()) -> 'comprobaciones') c where c ->> 'id' in ('C3', 'C4', 'C5')), 3, 'las comprobaciones contables viajan como via1 y via2');
select is((select (c ->> 'unidad') from jsonb_array_elements(rep.insumos_semanal(pg_temp.lunes()) -> 'comprobaciones') c where c ->> 'id' = 'C3'), 'cent', 'unidad en centavos');
select is(jsonb_array_length(rep.insumos_semanal(pg_temp.lunes()) -> 'historia'), 12, 'doce semanas de historia');
select is((select (i ->> 'existencia')::int from jsonb_array_elements(rep.insumos_semanal(pg_temp.lunes()) -> 'inventario') i where i ->> 'modelo' = 'Rep Modelo 10K'), 10, 'inventario: 30 entraron y 20 salieron');
select is((select (i ->> 'costo_prom_cent')::bigint from jsonb_array_elements(rep.insumos_semanal(pg_temp.lunes()) -> 'inventario') i where i ->> 'modelo' = 'Rep Modelo 10K'), 10000::bigint, 'costo promedio 100.00');
select is((select i #>> '{ventas_semanales,11}' from jsonb_array_elements(rep.insumos_semanal(pg_temp.lunes()) -> 'inventario') i where i ->> 'modelo' = 'Rep Modelo 10K'), '20', 'la ultima semana trae 20 piezas');
select is((select (c ->> 'saldo_cent')::bigint from jsonb_array_elements(rep.insumos_semanal(pg_temp.lunes()) -> 'cartera') c where c ->> 'cliente' = 'Rep Cliente'), 300000::bigint, 'cartera: 3,000.00 por cobrar');
select throws_ok($$ select rep.insumos_semanal(pg_temp.lunes() + 1) $$, '22023', null, 'el semanal inicia en lunes');
select is(rep.insumos_mensual(date_trunc('month', negocio.hoy())::date) ->> 'mes', to_char(negocio.hoy(), 'YYYY-MM'), 'mensual: el mes');
select is(jsonb_array_length(rep.insumos_mensual(date_trunc('month', negocio.hoy())::date) -> 'resultados'), 9, 'mensual: nueve renglones del estado de resultados');
select throws_ok($$ select rep.insumos_mensual(date_trunc('month', negocio.hoy())::date + 1) $$, '22023', null, 'el mensual inicia el dia 1');

-- Publicacion: solo insercion, versiones, entrega idempotente
create function pg_temp.rep(p_v int, p_sha text) returns jsonb language sql as $$ select jsonb_build_object('clave', 'semanal:2026-11-09', 'version', p_v, 'folio', 'OM-2026-46', 'huella', 'abc123', 'estado', 'publicado', 'etiquetas', '["PRELIMINAR"]'::jsonb, 'sha256Pdf', p_sha) $$;
select throws_ok($$ select rep.guardar(pg_temp.rep(1, repeat('0', 64)), '\x255044462d'::bytea, '<html></html>', '{}', 'g:0') $$, 'P0471', null, 'un sha256 que no coincide se rechaza');
select is((rep.guardar(pg_temp.rep(1, encode(sha256('\x255044462d'::bytea), 'hex')), '\x255044462d'::bytea, '<html>v1</html>', '{"huella":"abc123"}', 'g:1') ->> 'version')::int, 1, 'se guarda la version 1');
select is((rep.guardar(pg_temp.rep(1, encode(sha256('\x255044462d'::bytea), 'hex')), '\x255044462d'::bytea, '<html>v1</html>', '{"huella":"abc123"}', 'g:1') ->> 'version')::int, 1, 'la misma clave es idempotente');
select throws_ok($$ select rep.guardar(pg_temp.rep(1, encode(sha256('\x255044462d'::bytea), 'hex')), '\x255044462d'::bytea, '<html>otro</html>', '{}', 'g:2') $$, '23505', null, 'una version publicada no se sobrescribe');
select is(rep.html('semanal:2026-11-09', 1), '<html>v1</html>', 'se recupera el HTML guardado');
select is(rep.pdf('semanal:2026-11-09', 1), '\x255044462d'::bytea, 'se recupera el PDF guardado');
select is(jsonb_array_length(rep.versiones('semanal:2026-11-09')), 1, 'una version');
select rep.marcar_entrega('semanal:2026-11-09', 1, 'telegram');
select rep.marcar_entrega('semanal:2026-11-09', 1, 'telegram');
select is((rep.versiones('semanal:2026-11-09') -> 0 -> 'entregas' ->> 'telegram')::boolean, true, 'entrega por telegram marcada una sola vez');
select is((rep.versiones('semanal:2026-11-09') -> 0 -> 'entregas' ->> 'correo')::boolean, false, 'el correo sigue pendiente');
select throws_ok($$ update rep.reporte set folio = 'x' where id > 0 $$, '42501', null, 'rep.reporte es de solo insercion');
select is(jsonb_array_length(api.rep_historial()), 1, 'la web ve el historial');
select is(api.rep_html('semanal:2026-11-09', 1), '<html>v1</html>', 'y la vista previa');
select is(has_function_privilege('authenticated', 'rep.pdf(text,int)', 'EXECUTE'), false, 'la web no ejecuta rep.* directo');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rep' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada');
select * from finish();
rollback;
