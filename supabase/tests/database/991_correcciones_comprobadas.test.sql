-- pgTAP 991: correcciones que antes vivian como pendientes en 990 y que la integracion ya cumple (la salida de 990 mostraba "ok ... # TODO passed").
-- Se movieron aqui sus aserciones definitivas: GD-17 (asignar a la sociedad el faltante de una compra) y CP02 (cerrar la liquidacion de Omar con decision expresa). Datos sinteticos "N991".
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n991.angelo@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('a9910000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n991.angelo@example.test');
select set_config('request.jwt.claim.sub', 'a9910000-0000-0000-0000-000000000001', true);
select catalogo.asegurar_cliente('N991 Cliente', 'Angelo');
select catalogo.asegurar_modelo('N991 Marca', 'N991 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('N991 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('n991c1', 'Isaac', 'N991 Modelo 30K', 10000, '2020-01-01', 'prueba');
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('N991 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('N991 Omar Cliente', 'N991 Omar');
  end if;
end $$;
select operacion.crear_compra('n991o3', 'Isaac', '[{"modelo":"N991 Modelo 30K","sabor":"Sandia","pagadas":100}]'::jsonb, 0, 0, '2021-05-04');
select operacion.confirmar_compra('n991o3c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n991o3'));
select operacion.marcar_compra_enviada('n991o3e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n991o3'), '[]'::jsonb, null, '2021-05-04');
select operacion.marcar_llego_merida('n991o3m', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n991o3'));
select operacion.recibir_compra('n991o3r', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n991o3'),
  jsonb_build_array(jsonb_build_object('linea_id', (select cl.id from operacion.compra_linea cl where cl.compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n991o3')), 'sabor', 'Sandia', 'piezas', 98)), '2021-05-05 12:00-06');
select lives_ok($$select operacion.asignar_diferencia('n991d17', (select id from operacion.compra_diferencia where compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n991o3')), 'sociedad', null, 'perdida absorbida')$$, 'GD-17: asignar el faltante a la sociedad');
select operacion.registrar_toma_omar('n991t2', '{"modelo":"N991 Modelo 30K","sabor":"Sandia"}'::jsonb, 2, 15000, '2021-06-02', 'telegram_omar');
select lives_ok($$select operacion.cerrar_liquidacion_omar('n991l1', '2021-05-31', true, '2021-06-07')$$, 'CP02: se cierra con decision expresa');
select * from finish();
rollback;
