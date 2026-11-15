-- pgTAP: el bot exige plazo al crear un pedido (migracion 20261114700000). Datos sinteticos "A12B".
begin;
-- Carril frenos: el interruptor agente_escritura nace apagado; esta prueba ejerce las puertas de escritura.
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select no_plan();
select agente.registrar_miembro(5120001, 'javier');
select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_cliente('A12B Cliente', 'Javier');
select catalogo.asegurar_modelo('A12B Marca', 'A12B Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('A12B Modelo', 'Uva');
select catalogo.fijar_costo('a12b:k', 'Karen', 'A12B Modelo', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_costo('a12b:k2', 'Isaac', 'A12B Modelo', 11000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('a12b:p', 'A12B Cliente', 'A12B Modelo', 25000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('a12b:m1', 'A12B Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 40, 400000, negocio.hoy() - 5);
create function pg_temp.args(p_plazo text) returns jsonb language sql as $$
  select jsonb_build_object('autor', 'javier', 'telegram_user_id', 5120001, 'origen', 'x', 'cliente_id', (select id from catalogo.cliente where nombre_canonico = 'A12B Cliente'),
    'lineas', jsonb_build_array(jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_canonico = 'A12B Modelo'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = 'Uva'), 'piezas', 24)))
    || case when p_plazo is null then '{}'::jsonb else jsonb_build_object('plazo_dias', p_plazo::int) end $$;

select throws_ok($$select agente.ejecutar_ext('a12b:1', 'pedido_crear', pg_temp.args(null))$$, 'P0436', null, 'bot: sin plazo no escribe');
select is((select count(*)::int from seguridad.operacion where clave like 'a12b:1%'), 0, 'bot: sin plazo no deja operacion ni pedido');
select throws_ok($$select agente.simular('ejecutar_ext', 'pedido_crear', pg_temp.args(null))$$, 'P0436', null, 'bot: la vista previa tampoco pasa sin plazo');
select lives_ok($$select agente.ejecutar_ext('a12b:2', 'pedido_crear', pg_temp.args('15'))$$, 'bot: con plazo de 15 dias se crea');
select is((select p.plazo_dias from operacion.pedido p where p.id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a12b:2')), 15, 'bot: el plazo queda en el pedido');
select is((select count(*)::int from operacion.evento where tipo = 'plazo_acordado' and payload->>'pedido' = (select folio from operacion.pedido order by id desc limit 1)), 1, 'bot: el plazo queda con evento de auditoria');
select lives_ok($$select agente.ejecutar_ext('a12b:3', 'pedido_crear', pg_temp.args('0'))$$, 'bot: de contado es plazo 0');
select is((agente.ejecutar_ext('a12b:2', 'pedido_crear', pg_temp.args('15')) ->> 'repetido')::boolean, true, 'bot: repetir la indicacion no duplica');
select * from finish();
rollback;
