-- pgTAP: la ficha del pedido y los conteos muestran solo los avisos cuya causa sigue hoy, agrupados por causa
-- (pedido del dueño, 15-nov: "que unicamente sigan si sigue el problema"). Los esperados salen de la regla del dueño. Datos ficticios.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('av.vig@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-777777777771', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'av.vig@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777771', true);

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.fic(p_clave text) returns jsonb language sql as $$ select api.avisos_vigentes_pedido(pg_temp.pid($1)) $$;

-- Hay una persona de bodega (en la base real existe; aqui una de prueba si no).
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('AV3 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('AV3 Omar Cliente', 'AV3 Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('AV3 Cliente', 'Javier');
select catalogo.asegurar_modelo('AV3 Marca', m, 15000, 'ambas') from unnest(array['AV3 Igual 15K', 'AV3 Sin lista 15K', 'AV3 Menor 15K']) m;
select catalogo.asegurar_sku(m, s) from unnest(array['AV3 Igual 15K', 'AV3 Sin lista 15K', 'AV3 Menor 15K']) m, unnest(array['Mango', 'Uva', 'Sandia']) s;
select catalogo.fijar_costo('av3k' || i, 'Isaac', m, 10000, '2026-11-01', 'prueba') from unnest(array['AV3 Igual 15K', 'AV3 Sin lista 15K', 'AV3 Menor 15K']) with ordinality as t(m, i);
select operacion.registrar_movimiento('av3m' || i || s, m, s, 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-08')
  from unnest(array['AV3 Igual 15K', 'AV3 Sin lista 15K', 'AV3 Menor 15K']) with ordinality as t(m, i), unnest(array['Mango', 'Uva', 'Sandia']) s;

-- Tres renglones (tres sabores) del mismo modelo, capturados a mano y enviados aceptando el aviso.
create function pg_temp.enviar(p_clave text, p_modelo text, p_precio bigint) returns void language plpgsql as $$
begin
  perform operacion.crear_pedido(p_clave, (select id from catalogo.cliente where nombre_canonico = 'AV3 Cliente'),
    jsonb_build_array(
      jsonb_build_object('modelo', p_modelo, 'sabor', 'Mango', 'piezas', 10, 'precio_cent', p_precio, 'motivo_precio', 'prueba'),
      jsonb_build_object('modelo', p_modelo, 'sabor', 'Uva', 'piezas', 10, 'precio_cent', p_precio, 'motivo_precio', 'prueba'),
      jsonb_build_object('modelo', p_modelo, 'sabor', 'Sandia', 'piezas', 10, 'precio_cent', p_precio, 'motivo_precio', 'prueba')),
    'bodega_omar', null, 0, 0, 0, negocio.hoy());
  perform operacion.confirmar_pedido(p_clave || 'c', pg_temp.pid(p_clave));
  perform operacion.enviar_pedido(p_clave || 's', pg_temp.pid(p_clave), null, null, negocio.hoy(), true);
end $$;
select pg_temp.enviar('av3igual', 'AV3 Igual 15K', 20000);
select pg_temp.enviar('av3sin', 'AV3 Sin lista 15K', 20000);
select pg_temp.enviar('av3menor', 'AV3 Menor 15K', 20000);

select is((select count(*)::int from operacion.pedido_aviso where codigo = 'sin_precio_catalogo' and pedido_id = pg_temp.pid('av3igual')), 3, 'nacieron tres avisos iguales, uno por renglon');
select is(jsonb_array_length(pg_temp.fic('av3igual')), 1, 'antes de cargar la lista: una sola tarjeta');
select is((pg_temp.fic('av3igual') -> 0 ->> 'renglones')::int, 3, 'con tres renglones');
select is(pg_temp.fic('av3igual') -> 0 -> 'modelos', '["AV3 Igual 15K"]'::jsonb, 'y el modelo');
select is(pg_temp.fic('av3igual') -> 0 -> 'decidido_por', '["Javier"]'::jsonb, 'aceptado por Javier (solo avisos vigentes realmente aceptados)');
select is((pg_temp.fic('av3igual') -> 0 ->> 'aceptados')::int, 3, 'los tres aceptados');
select is((api.pedidos_avisos_vigentes() ->> pg_temp.pid('av3igual')::text)::int, 1, 'el conteo del pedido es 1 (una causa), no 3');

-- Javier carga el precio de lista despues.
select catalogo.fijar_precio('av3l1', 'AV3 Cliente', 'AV3 Igual 15K', 20000, negocio.hoy(), 'lista_javier');
select catalogo.fijar_precio('av3l3', 'AV3 Cliente', 'AV3 Menor 15K', 25000, negocio.hoy(), 'lista_javier');

select is(pg_temp.fic('av3igual'), '[]'::jsonb, 'lista igual a lo cobrado: la ficha no muestra nada');
select is(api.pedidos_avisos_vigentes() -> pg_temp.pid('av3igual')::text, null, 'y el pedido sale de los conteos');
select is((pg_temp.fic('av3sin') -> 0 ->> 'detalle'), 'el cliente no tiene precio de tabulador (precio capturado a mano)', 'sin lista: sigue la causa');
select is((pg_temp.fic('av3sin') -> 0 ->> 'renglones')::int, 3, 'agrupada en una tarjeta de tres renglones');
select is(pg_temp.fic('av3menor') -> 0 ->> 'codigo', 'precio_distinto_tabulador', 'lista mayor a lo cobrado: sigue como precio bajo la lista');
select is((pg_temp.fic('av3menor') -> 0 ->> 'renglones')::int, 3, 'tambien agrupada');
select is((select count(*)::int from jsonb_object_keys(api.pedidos_avisos_vigentes()) k where k::bigint in (pg_temp.pid('av3igual'), pg_temp.pid('av3sin'), pg_temp.pid('av3menor'))), 2, 'solo dos de los tres pedidos cuentan como con avisos');

-- Pedido inexistente.
select is(operacion.avisos_vigentes_pedido(-1), '[]'::jsonb, 'un pedido inexistente no tiene avisos');

-- Nada se edita: los avisos y la foto del renglon siguen igual.
select is((select count(*)::int from operacion.pedido_aviso where pedido_id = pg_temp.pid('av3igual')), 3, 'los avisos originales siguen en la base');
select is((select precio_tabulador_cent from operacion.pedido_linea where pedido_id = pg_temp.pid('av3igual') limit 1), null, 'la foto del renglon sigue vacia');

-- Pedido anulado: sin avisos vigentes.
select operacion.anular_pedido('av3anu', pg_temp.pid('av3sin'), 'prueba');
select is(pg_temp.fic('av3sin'), '[]'::jsonb, 'un pedido anulado no tiene avisos vigentes');

-- Privilegios: la web solo entra por api y con rol de socio.
select is(has_function_privilege('anon', 'api.avisos_vigentes_pedido(bigint)', 'execute'), false, 'anon no ejecuta la ficha');
select is(has_function_privilege('anon', 'api.pedidos_avisos_vigentes()', 'execute'), false, 'anon no ejecuta el conteo');
select is(has_function_privilege('authenticated', 'api.avisos_vigentes_pedido(bigint)', 'execute'), true, 'el socio autenticado si');
select is(has_function_privilege('authenticated', 'operacion.avisos_vigentes_base(bigint)', 'execute'), false, 'la base interna no se expone');

select * from finish();
rollback;
