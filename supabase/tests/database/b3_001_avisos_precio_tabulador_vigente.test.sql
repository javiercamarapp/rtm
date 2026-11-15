-- pgTAP: el aviso de pedido enviado con excepcion por "sin precio de catalogo" se cierra cuando el precio de lista se carga despues
-- (pedido del dueño, 14-nov: "que se borren las notificaciones una vez se solucionen; que unicamente sigan si sigue el problema").
-- Los esperados salen de la regla del dueño, no del codigo. Datos ficticios.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('av.tab@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('76666666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'av.tab@example.test');
select set_config('request.jwt.claim.sub', '76666666-6666-6666-6666-666666666661', true);

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.av(p_clave text) returns operacion.aviso language sql as $$
  select a from operacion.aviso a where a.codigo = 'pedido_enviado_con_excepcion' and a.entidad_id = pg_temp.pid($1) $$;
create function pg_temp.vig(p_clave text) returns boolean language sql as $$ select (notificacion.condicion(pg_temp.av($1))).vigente $$;
create function pg_temp.est(p_clave text) returns text language sql as $$ select (pg_temp.av($1)).estado $$;

select catalogo.asegurar_cliente('AV2 Cliente', 'Javier');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Igual 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Menor 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Sin lista 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Mayor 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Viejo 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Nuevo 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('AV2 Marca', 'AV2 Bajo costo 15K', 15000, 'ambas');
select catalogo.asegurar_sku(m, 'Mango') from unnest(array['AV2 Igual 15K', 'AV2 Menor 15K', 'AV2 Sin lista 15K', 'AV2 Mayor 15K', 'AV2 Viejo 15K', 'AV2 Nuevo 15K', 'AV2 Bajo costo 15K']) m;
select catalogo.fijar_costo('av2k' || i, 'Isaac', m, 10000, '2026-11-01', 'prueba')
  from unnest(array['AV2 Igual 15K', 'AV2 Menor 15K', 'AV2 Sin lista 15K', 'AV2 Mayor 15K', 'AV2 Viejo 15K', 'AV2 Nuevo 15K', 'AV2 Bajo costo 15K']) with ordinality as t(m, i);
select operacion.registrar_movimiento('av2m' || i, m, 'Mango', 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-08')
  from unnest(array['AV2 Igual 15K', 'AV2 Menor 15K', 'AV2 Sin lista 15K', 'AV2 Mayor 15K', 'AV2 Viejo 15K', 'AV2 Nuevo 15K', 'AV2 Bajo costo 15K']) with ordinality as t(m, i);

-- Siete pedidos enviados aceptando el aviso: el cliente no tiene precio de tabulador y el precio se capturo a mano (20,000 centavos por pieza; 9,000 en el de bajo costo).
create function pg_temp.enviar(p_clave text, p_modelo text, p_precio bigint) returns void language plpgsql as $$
begin
  perform operacion.crear_pedido(p_clave, (select id from catalogo.cliente where nombre_canonico = 'AV2 Cliente'),
    jsonb_build_array(jsonb_build_object('modelo', p_modelo, 'sabor', 'Mango', 'piezas', 25, 'precio_cent', p_precio, 'motivo_precio', 'prueba')),
    'bodega_omar', null, 0, 0, 0, negocio.hoy());
  perform operacion.confirmar_pedido(p_clave || 'c', pg_temp.pid(p_clave));
  perform operacion.enviar_pedido(p_clave || 's', pg_temp.pid(p_clave), null, null, negocio.hoy(), true);
end $$;
select pg_temp.enviar('av2igual', 'AV2 Igual 15K', 20000);
select pg_temp.enviar('av2menor', 'AV2 Menor 15K', 20000);
select pg_temp.enviar('av2sin', 'AV2 Sin lista 15K', 20000);
select pg_temp.enviar('av2mayor', 'AV2 Mayor 15K', 20000);
select pg_temp.enviar('av2viejo', 'AV2 Viejo 15K', 20000);
select pg_temp.enviar('av2bajo', 'AV2 Bajo costo 15K', 9000);

select is((select count(*)::int from operacion.pedido_aviso where codigo = 'sin_precio_catalogo' and pedido_id in (select pg_temp.pid(c) from unnest(array['av2igual', 'av2menor', 'av2sin', 'av2mayor', 'av2viejo', 'av2bajo']) c)), 6, 'los seis pedidos nacieron con el aviso sin precio de catalogo (NT-004)');
select is((select count(*)::int from operacion.aviso where codigo = 'pedido_enviado_con_excepcion' and entidad_id in (select pg_temp.pid(c) from unnest(array['av2igual', 'av2menor', 'av2sin', 'av2mayor', 'av2viejo', 'av2bajo']) c)), 6, 'y seis avisos de pedido enviado con excepcion (NT-006)');
select is(pg_temp.vig('av2igual'), true, 'antes de cargar la lista el aviso sigue');
select is(pg_temp.vig('av2sin'), true, 'sin lista sigue');

-- Javier carga hoy el precio de lista (despues de enviados los pedidos).
select catalogo.fijar_precio('av2l1', 'AV2 Cliente', 'AV2 Igual 15K', 20000, negocio.hoy(), 'lista_javier');
select catalogo.fijar_precio('av2l2', 'AV2 Cliente', 'AV2 Menor 15K', 25000, negocio.hoy(), 'lista_javier');
select catalogo.fijar_precio('av2l4', 'AV2 Cliente', 'AV2 Mayor 15K', 18000, negocio.hoy(), 'lista_javier');
select catalogo.fijar_precio('av2l6', 'AV2 Cliente', 'AV2 Bajo costo 15K', 9000, negocio.hoy(), 'lista_javier');

select is(pg_temp.vig('av2igual'), false, 'lista igual a lo cobrado: la causa ya no existe');
select matches((notificacion.condicion(pg_temp.av('av2igual'))).motivo, 'la nota se corrigio, el precio ya no difiere', 'con motivo');
select is(pg_temp.vig('av2mayor'), false, 'lista menor a lo cobrado (cobrado mayor): la causa ya no existe');
select is(pg_temp.vig('av2menor'), true, 'lista mayor a lo cobrado: sigue, ahora como precio bajo tabulador');
select is(pg_temp.vig('av2sin'), true, 'sin precio de lista: sigue sin precio de catalogo');
select is(pg_temp.vig('av2bajo'), true, 'lista igual a lo cobrado pero cobrado bajo costo: sigue por bajo costo');
select is((select precio_tabulador_cent from operacion.pedido_linea where pedido_id = pg_temp.pid('av2igual')), null, 'la foto del renglon sigue vacia: nada se edita');

-- Modelo unificado: el pedido es del modelo viejo y la lista se cargo en el modelo vigente al que se unifico.
update catalogo.modelo set unificado_en = (select id from catalogo.modelo where nombre_canonico = 'AV2 Nuevo 15K') where nombre_canonico = 'AV2 Viejo 15K';
select is(pg_temp.vig('av2viejo'), true, 'unificado, aun sin lista en el vigente: sigue');
select catalogo.fijar_precio('av2l5', 'AV2 Cliente', 'AV2 Nuevo 15K', 20000, negocio.hoy(), 'lista_javier');
select is(pg_temp.vig('av2viejo'), false, 'unificado: la lista del modelo vigente cierra la causa');
select is(notificacion.precio_lista_vigente((select id from catalogo.cliente where nombre_canonico = 'AV2 Cliente'), (select id from catalogo.modelo where nombre_canonico = 'AV2 Viejo 15K')), 20000::bigint, 'el ayudante sigue la unificacion');

-- Barrido: verificar no escribe; aplicar resuelve solo los tres cuya causa ya no existe; es idempotente.
select is((select count(*)::int from jsonb_array_elements(notificacion.depurar(false) -> 'detalle') d where d ->> 'accion' = 'resolver' and d ->> 'codigo' = 'pedido_enviado_con_excepcion'), 3, 'verificar lista los tres por resolver');
select is(pg_temp.est('av2igual'), 'abierta', 'verificar es solo lectura');
select notificacion.depurar(true);
select is(pg_temp.est('av2igual'), 'resuelta', 'igual: resuelto');
select is(pg_temp.est('av2mayor'), 'resuelta', 'mayor: resuelto');
select is(pg_temp.est('av2viejo'), 'resuelta', 'unificado: resuelto');
select is(pg_temp.est('av2menor'), 'abierta', 'bajo tabulador: sigue');
select is(pg_temp.est('av2sin'), 'abierta', 'sin lista: sigue');
select is(pg_temp.est('av2bajo'), 'abierta', 'bajo costo: sigue');
select matches((select resuelto_motivo from operacion.aviso a where a.id = (pg_temp.av('av2igual')).id), '^resuelto solo: la causa desaparecio', 'queda el motivo');
select is(((notificacion.depurar(true)) ->> 'resueltos')::int, 0, 'idempotente');

-- Una lista que empieza manana no cuenta todavia: manda la vigencia de hoy.
select catalogo.fijar_precio('av2l1b', 'AV2 Cliente', 'AV2 Igual 15K', 22000, negocio.hoy() + 1, 'lista_javier');
select is(pg_temp.vig('av2igual'), false, 'la vigencia manda: hoy la lista sigue igual a lo cobrado');

-- Privilegios: la web no ejecuta lo interno.
select is(has_function_privilege('authenticated', 'notificacion.precio_lista_vigente(bigint, bigint)', 'execute'), false, 'la web no ejecuta el ayudante');
select is(has_function_privilege('authenticated', 'catalogo.modelo_vigente(bigint)', 'execute'), false, 'ni el modelo vigente');
select is(has_function_privilege('authenticated', 'notificacion.condicion(operacion.aviso)', 'execute'), false, 'ni la condicion');

select * from finish();
rollback;
