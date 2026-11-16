-- pgTAP cierre del carril del bot (revision independiente): el cobro respeta el pedido elegido, un cobro sin cliente se rechaza, un lote de gastos iguales de UN mensaje no es duplicado,
-- las tablas de avisos de inventario tienen RLS habilitada y forzada. Datos sinteticos; no se envia nada. Hace rollback.
begin;
-- La persona de bodega es prerequisito de enviar pedidos (renta de Omar): una base limpia no la trae, asi que la prueba da de alta un cliente interno de prueba.
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform set_config('rtm.canal', 'importacion', true);
    perform catalogo.asegurar_cliente('PB Bodega Prueba', 'Javier', 'credito_interno');
    perform catalogo.asegurar_persona_bodega('PB Bodega Prueba', 'PB Bodega Prueba');
    perform set_config('rtm.canal', '', true);
  end if;
end $$;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5100001, 'angelo');
select agente.registrar_miembro(5100002, 'javier');
select agente.registrar_chat('grupo_socios', -4100001);
select catalogo.asegurar_cliente('Bx Cliente', 'Javier');
select catalogo.asegurar_cliente('Bx Otro', 'Javier');
select catalogo.asegurar_modelo('Bx Marca', 'Bx Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('Bx Modelo', 'Uva');
select catalogo.fijar_costo('bx:k', 'Karen', 'Bx Modelo', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_costo('bx:k2', 'Isaac', 'Bx Modelo', 11000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('bx:p', 'Bx Cliente', 'Bx Modelo', 25000, negocio.hoy() - 30, 'chat');
select catalogo.fijar_precio('bx:p2', 'Bx Otro', 'Bx Modelo', 25000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('bx:m1', 'Bx Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1000000, negocio.hoy() - 5);
select costos.registrar_tipo_cambio('bx:tc0', negocio.hoy() - 1, 18500000, 'manual');
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'Bx Modelo' $$;
create function pg_temp.sid() returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = 'Uva' $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'Bx Cliente' $$;
create function pg_temp.cid2() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'Bx Otro' $$;
create function pg_temp.ang(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5100001, 'origen', 'x') || $1 $$;
select agente.fijar_escritura(true, 'angelo', 5100001, 'prueba');

-- Dos pedidos enviados del mismo cliente: el primero (mas antiguo) y el segundo.
create temp table _p1 as select agente.ejecutar_ext('bx:ped1', 'pedido_crear', pg_temp.ang(jsonb_build_object('plazo_dias', 7, 'cliente_id', pg_temp.cid(),
  'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid(), 'piezas', 10))))) as j;
create temp table _p2 as select agente.ejecutar_ext('bx:ped2', 'pedido_crear', pg_temp.ang(jsonb_build_object('plazo_dias', 7, 'cliente_id', pg_temp.cid(),
  'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid(), 'piezas', 20))))) as j;
create temp table _p3 as select agente.ejecutar_ext('bx:ped3', 'pedido_crear', pg_temp.ang(jsonb_build_object('plazo_dias', 7, 'cliente_id', pg_temp.cid2(),
  'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid(), 'piezas', 5))))) as j;
select agente.ejecutar_ext('bx:env1', 'pedido_enviar', pg_temp.ang(jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p1), 'aceptar_avisos', true)));
select agente.ejecutar_ext('bx:env2', 'pedido_enviar', pg_temp.ang(jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p2), 'aceptar_avisos', true)));
select agente.ejecutar_ext('bx:env3', 'pedido_enviar', pg_temp.ang(jsonb_build_object('pedido_folio', (select j ->> 'folio' from _p3), 'aceptar_avisos', true)));
create temp table _deb as select operacion.pedido_saldo(pe.id) as saldo, pe.folio from operacion.pedido pe where pe.cliente_id = pg_temp.cid() and pe.estado = 'enviado';
select ok((select count(*) from _deb) = 2 and (select min(saldo) from _deb) > 0, 'el cliente tiene dos pedidos enviados con saldo');

-- 1. ALTO: el cobro va al pedido que el socio eligio (el segundo), no al mas antiguo.
create temp table _c1 as select agente.ejecutar('bx:c1', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'cliente_id', pg_temp.cid(),
  'monto_cent', (select saldo from _deb where folio = (select j ->> 'folio' from _p2)), 'pedido_folio', (select j ->> 'folio' from _p2)))) as j;
select is((select count(*)::int from operacion.pago_aplicacion a join operacion.pedido pe on pe.id = a.pedido_id where pe.folio = (select j ->> 'folio' from _p2) and a.reversa_de is null), 1, 'el cobro con pedido elegido se aplico al pedido elegido');
select is((select count(*)::int from operacion.pago_aplicacion a join operacion.pedido pe on pe.id = a.pedido_id where pe.folio = (select j ->> 'folio' from _p1) and a.reversa_de is null), 0, 'y nada al pedido mas antiguo');
select is(operacion.pedido_saldo((select id from operacion.pedido where folio = (select j ->> 'folio' from _p2))), 0::bigint, 'el pedido elegido queda saldado');
select ok((select j -> 'eco_rico' -> 'pedidos_aplicados' -> 0 ->> 'folio' from _c1) = (select j ->> 'folio' from _p2), 'el eco muestra el pedido elegido');
-- sin pedido elegido: sigue la regla de siempre (el mas antiguo)
create temp table _c2 as select agente.ejecutar('bx:c2', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'cliente_id', pg_temp.cid(),
  'monto_cent', 1000))) as j;
select is((select j -> 'eco_rico' -> 'pedidos_aplicados' -> 0 ->> 'folio' from _c2), (select j ->> 'folio' from _p1), 'sin pedido elegido se aplica al mas antiguo (regla de siempre)');
-- un pedido de otro cliente no vale
select throws_ok($$ select agente.ejecutar('bx:c3', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'cliente_id', pg_temp.cid(), 'monto_cent', 1000, 'pedido_folio', (select j ->> 'folio' from _p3)))) $$,
  'P0460', null, 'el pedido de OTRO cliente se rechaza');
select throws_ok($$ select agente.ejecutar('bx:c3b', 'pago_cliente', pg_temp.ang(jsonb_build_object('cuenta', 'efectivo', 'cliente_id', pg_temp.cid(), 'monto_cent', 1000, 'pedido_folio', 'ZZ-999'))) $$,
  'P0460', null, 'un folio que no existe se rechaza');

create temp table _sin as select count(*)::int as n from operacion.pago where cliente_id is null;
-- 5. MEDIO: un cobro sin cliente no se registra como efectivo sin identificar
select throws_ok($$ select agente.ejecutar('bx:c4', 'pago_cliente', pg_temp.ang('{"cuenta":"efectivo","monto_cent":9900000}')) $$, 'P0460', null, 'cobro sin cliente: se pide el cliente');
select is((select count(*)::int from operacion.pago where cliente_id is null), (select n from _sin), 'no quedo ningun pago nuevo sin identificar');

-- 3. MEDIO: un lote legitimo (12 lineas iguales chocan con el MISMO folio previo) no apaga la escritura; bloqueos contra folios distintos si
insert into agente.evento (tipo, miembro, detalle) select 'duplicado_bloqueado', 5100001, 'gasto igual a G-9999' from generate_series(1, 12);
select is((agente.revisar_anomalia() ->> 'apagado')::boolean, false, 'un lote legitimo de gastos iguales (mismo folio previo) no apaga la escritura');
select is((agente.escritura_estado() ->> 'activa')::boolean, true, 'la escritura sigue activa');
insert into agente.evento (tipo, miembro, detalle) select 'duplicado_bloqueado', 5100001, 'gasto igual a G-8' || lpad(n::text, 3, '0') from generate_series(1, 12) n;
select is((agente.revisar_anomalia() ->> 'apagado')::boolean, true, 'bloqueos por duplicado contra folios distintos si apagan la escritura (envio descontrolado)');

-- 2. MEDIO: RLS habilitada y forzada en las tablas de avisos de inventario
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'agente' and c.relname in ('aviso_regla', 'minimo_manual', 'minimo_pendiente', 'aviso_cola', 'aviso_digest')
  and c.relrowsecurity and c.relforcerowsecurity), 5, 'las 5 tablas de avisos de inventario tienen RLS habilitada Y forzada');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'agente' and c.relkind = 'r' and c.relforcerowsecurity and not c.relrowsecurity), 0, 'ninguna tabla de agente tiene FORCE sin ENABLE');
select * from finish();
rollback;
