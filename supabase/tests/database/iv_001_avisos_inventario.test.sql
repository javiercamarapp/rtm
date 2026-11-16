-- pgTAP carril AVISOS DE INVENTARIO: evaluadores (reposicion con transito y minimo manual, agotado, compras, proveedores, clientes, pedidos), cola con enfriamiento,
-- carga silenciosa, digest con techo y silencio, puente del monitor, minimo por conversacion y permisos. Datos sinteticos; no se envia nada; todo APAGADO por defecto.
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
select agente.registrar_miembro(5100003, 'omar');

-- Catalogo sintetico: un modelo propio con tres sabores y un modelo de Karen.
select catalogo.asegurar_modelo('Iv Marca', 'Iv Nexa 50K', 50000, 'ambas');
select catalogo.asegurar_sku('Iv Nexa 50K', 'Mango');
select catalogo.asegurar_sku('Iv Nexa 50K', 'Uva');
select catalogo.asegurar_sku('Iv Nexa 50K', 'Menta');
select catalogo.asegurar_modelo('Iv Marca', 'Iv Waka 15K', 15000, 'ambas');
select catalogo.asegurar_sku('Iv Waka 15K', 'Piña');
select catalogo.fijar_costo('iv:c1', 'Isaac', 'Iv Nexa 50K', 9000, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('iv:c2', 'Karen', 'Iv Waka 15K', 10000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('Iv Cliente Uno', 'Javier');
select catalogo.asegurar_cliente('Iv Cliente Dos', 'Angelo');
select catalogo.fijar_precio('iv:p1', 'Iv Cliente Uno', 'Iv Nexa 50K', 25000, negocio.hoy() - 60, 'chat');
select catalogo.fijar_precio('iv:p2', 'Iv Cliente Dos', 'Iv Nexa 50K', 9500, negocio.hoy() - 60, 'chat');
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'Iv Nexa 50K' $$;
create function pg_temp.sku(p text) returns bigint language sql as $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.mid() and s.nombre_canonico = p $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = p $$;
create function pg_temp.cand(p_codigo text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(agente.avisos_inventario_evaluar(negocio.hoy(), 'simular') -> 'candidatos') x where x ->> 'codigo' = $1 $$;
-- Entrada con historia corta (sin 28 dias): Mango 40, Uva 10, Menta 30.
select operacion.registrar_movimiento('iv:m1', 'Iv Nexa 50K', 'Mango', 'bodega_omar', 'entrada_compra', 40, 360000, negocio.hoy() - 3);
select operacion.registrar_movimiento('iv:m2', 'Iv Nexa 50K', 'Uva', 'bodega_omar', 'entrada_compra', 10, 90000, negocio.hoy() - 3);
select operacion.registrar_movimiento('iv:m3', 'Iv Nexa 50K', 'Menta', 'bodega_omar', 'entrada_compra', 30, 270000, negocio.hoy() - 3);

-- ------------------------------------------------------------------ 1. todo nace apagado
select is((select activo from seguridad.interruptor where clave = 'avisos_inventario'), false, 'el interruptor general de avisos nace APAGADO');
select is((select count(*)::int from agente.aviso_regla where activo), 0, 'ninguna regla nace encendida');
select is(agente.avisos_inventario_evaluar(negocio.hoy(), 'emitir') ->> 'estado', 'apagado', 'apagado el general, emitir no hace nada');
select is((select count(*)::int from agente.aviso_cola), 0, 'y la cola sigue vacia');
select is(agente.aviso_encolar('inv_agotado', 'x|1', '{}'::jsonb), null::bigint, 'encolar con la regla apagada devuelve null');
select is(agente.avisos_digest_armar('M') ->> 'estado', 'apagado', 'el digest tambien respeta el interruptor');

-- ------------------------------------------------------------------ 2. reposicion: sin historia manda el minimo manual, con transito incluido
select is(pg_temp.cand('inv_reponer'), '[]'::jsonb, 'sin minimo manual y sin 28 dias de historia no hay alerta de reposicion');
select agente.fijar_escritura(true, 'angelo', 5100001, 'prueba');
create temp table _m1 as select agente.minimo_paso('iv:min1', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5100001, 'chat_id', -100, 'texto', '')) as j;
select is((select j ->> 'falta' from _m1), 'modelo', 'el bot pregunta el modelo y sabor cuando solo llega /minimo');
create temp table _m2 as select agente.minimo_paso('iv:min2', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5100001, 'chat_id', -100, 'texto', 'iv nexa 50k uva')) as j;
select is((select j ->> 'falta' from _m2), 'piezas', 'con modelo y sabor pregunta las piezas');
create temp table _m2b as select agente.minimo_paso('iv:min2b', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5100001, 'chat_id', -100, 'texto', '2k')) as j;
select is((select j ->> 'falta' from _m2b), 'piezas', 'una cifra con k se repite y se pregunta completa');
select ok((select j ->> 'texto' from _m2b) like '%sin k ni mil%', 'el texto pide la cifra completa');
create temp table _m3 as select agente.minimo_paso('iv:min3', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5100001, 'chat_id', -100, 'texto', '15')) as j;
select is((select j ->> 'estado' from _m3), 'registrado', 'con todos los datos se registra el minimo');
select is((select min_pz from agente.minimo_manual where sku_id = pg_temp.sku('Uva') and vigente_hasta is null), 15, 'Uva queda con minimo de 15');
select ok((select j ->> 'aviso_grupo' from _m3) like 'Angelo fij%', 'avisa al grupo quien lo fijo');
select is((agente.minimo_paso('iv:min3', jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5100001, 'chat_id', -100, 'texto', '15')) ->> 'repetido')::boolean, true, 'misma clave = reintento, no duplica');
select throws_ok($$ select agente.minimo_paso('iv:min4', jsonb_build_object('autor', 'omar', 'telegram_user_id', 5100003, 'chat_id', -100, 'texto', 'uva 5')) $$, 'P0460', null, 'Omar no fija minimos');
select agente.minimo_paso('iv:min5', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'chat_id', -101, 'texto', 'iv nexa 50k mango 45'));
select is(jsonb_array_length(pg_temp.cand('inv_reponer')), 2, 'Mango (40 <= 45) y Uva (10 <= 15) piden reposicion con el minimo manual');
select is((select (x -> 'payload' ->> 'estado') from jsonb_array_elements(pg_temp.cand('inv_reponer')) x limit 1), 'estimado', 'sin historia queda etiquetado Estimado');
-- Una compra en transito que cubre Uva (10 + 40 > 15) la saca de la lista.
create temp table _c1 as select operacion.crear_compra('iv:oc1', 'Isaac', '[{"modelo":"Iv Nexa 50K","sabor":"Uva","pagadas":40}]'::jsonb) as j;
select operacion.confirmar_compra('iv:oc1c', (select (j ->> 'compra_id')::bigint from _c1));
select is(jsonb_array_length(pg_temp.cand('inv_reponer')), 1, 'con la compra en transito Uva ya no pide reposicion (solo Mango)');

-- ------------------------------------------------------------------ 3. agotado con venta reciente y sin transito
select catalogo.fijar_precio('iv:p3', 'Iv Cliente Uno', 'Iv Waka 15K', 25000, negocio.hoy() - 60, 'chat');
create temp table _p1 as select operacion.crear_pedido('iv:ped1', pg_temp.cid('Iv Cliente Uno'), '[{"modelo":"Iv Nexa 50K","sabor":"Menta","piezas":30}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy(), null, 15, 'Castores') as j;
select operacion.confirmar_pedido('iv:ped1c', (select (j ->> 'pedido_id')::bigint from _p1));
select operacion.enviar_pedido('iv:ped1e', (select (j ->> 'pedido_id')::bigint from _p1), null, null, negocio.hoy());
select is(jsonb_array_length(pg_temp.cand('inv_agotado')), 1, 'Menta se agoto tras vender 30 y no viene nada en camino');
select is((pg_temp.cand('inv_agotado') -> 0 -> 'payload' ->> 'sabor'), 'Menta', 'el sabor agotado es Menta');

-- ------------------------------------------------------------------ 4. compras: llegada esperada, atraso, fecha faltante, parcial y resumen de llegada
update operacion.compra set fecha_neg = negocio.hoy() - 2 where id = (select (j ->> 'compra_id')::bigint from _c1);
select is(jsonb_array_length(pg_temp.cand('oc_sin_fecha')), 1, 'compra confirmada sin fecha de llegada se avisa');
select is(jsonb_array_length(pg_temp.cand('oc_atraso')), 0, 'sin fecha y dentro del plazo no hay atraso');
update operacion.compra set llegada_estimada = negocio.hoy() + 1 where id = (select (j ->> 'compra_id')::bigint from _c1);
select is(jsonb_array_length(pg_temp.cand('oc_llega')), 1, 'llega manana: aviso de llegada esperada');
select is(jsonb_array_length(pg_temp.cand('oc_sin_fecha')), 0, 'con fecha ya no es higiene');
update operacion.compra set llegada_estimada = negocio.hoy() - 3 where id = (select (j ->> 'compra_id')::bigint from _c1);
select is(jsonb_array_length(pg_temp.cand('oc_atraso')), 1, 'pasada la fecha estimada hay atraso');
select is((pg_temp.cand('oc_atraso') -> 0 ->> 'canal'), 'I', 'con 3 dias de atraso sale como inmediato');
select is((pg_temp.cand('oc_atraso') -> 0 -> 'payload' ->> 'dias_atraso')::int, 3, 'cuenta 3 dias de atraso');
select operacion.recibir_compra_parcial('iv:rec1', (select (j ->> 'compra_id')::bigint from _c1), jsonb_build_array(jsonb_build_object('linea_id', (select min(id) from operacion.compra_linea where compra_id = (select (j ->> 'compra_id')::bigint from _c1)), 'sku_id', pg_temp.sku('Uva'), 'piezas', 30)));
select is(jsonb_array_length(pg_temp.cand('oc_llego')), 1, 'una recepcion genera un resumen de llegada');
select is((pg_temp.cand('oc_llego') -> 0 -> 'payload' ->> 'parcial')::boolean, true, 'es parcial');
select is((pg_temp.cand('oc_llego') -> 0 -> 'payload' ->> 'recibidas')::int, 30, 'con 30 piezas recibidas');
select is(jsonb_array_length(pg_temp.cand('oc_atraso')), 0, 'recibida parcial ya no cuenta como atrasada');
select is(jsonb_array_length(pg_temp.cand('oc_faltante')), 0, 'parcial reciente: aun no se reclama');
update agente.aviso_regla set umbral = jsonb_set(umbral, '{dias_min}', '0') where codigo = 'oc_faltante';
select is((pg_temp.cand('oc_faltante') -> 0 -> 'payload' ->> 'tipo'), 'parcial', 'con el umbral de dias en cero la recepcion parcial pendiente se avisa');
select is((pg_temp.cand('oc_faltante') -> 0 -> 'payload' ->> 'piezas')::int, 10, 'faltan 10 piezas');
update agente.aviso_regla set umbral = jsonb_set(umbral, '{dias_min}', '3') where codigo = 'oc_faltante';

-- ------------------------------------------------------------------ 5. cambio de costo de lista registrado y efecto en margen (solo sentido y porcentaje)
select catalogo.fijar_costo('iv:c3', 'Isaac', 'Iv Nexa 50K', 9500, negocio.hoy(), 'prueba nuevo costo');
select is(jsonb_array_length(pg_temp.cand('prv_costo')), 1, 'un costo de lista nuevo se avisa');
select is((pg_temp.cand('prv_costo') -> 0 -> 'payload' ->> 'sentido'), 'sube', 'sube');
select is((pg_temp.cand('prv_costo') -> 0 -> 'payload' ->> 'pct')::int, 6, 'cerca de 6 por ciento (entero)');
select is((pg_temp.cand('prv_costo') -> 0 -> 'payload' ->> 'clientes_bajo_minimo')::int, 1, 'un cliente (precio 95) queda bajo 5 por ciento de margen');
select is((pg_temp.cand('prv_costo') -> 0 ->> 'canal'), 'I', 'con margen en riesgo sale inmediato');
select ok(not (pg_temp.cand('prv_costo') -> 0 -> 'payload')::text ~ '9500|9000', 'el payload no lleva el importe del proveedor');
select is((select costo_cent from catalogo.costo_proveedor where modelo_id = pg_temp.mid() and vigente_hasta is null), 9500::bigint, 'el aviso no cambia ningun costo');

-- ------------------------------------------------------------------ 6. clientes y pedidos
-- Cliente Dos: pedido a credito viejo sin pagar (vencido) y pedido nuevo.
create temp table _p2 as select operacion.crear_pedido('iv:ped2', pg_temp.cid('Iv Cliente Dos'), '[{"modelo":"Iv Nexa 50K","sabor":"Mango","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy(), null, 7, 'Pitic') as j;
select operacion.confirmar_pedido('iv:ped2c', (select (j ->> 'pedido_id')::bigint from _p2));
select operacion.enviar_pedido('iv:ped2e', (select (j ->> 'pedido_id')::bigint from _p2), null, null, negocio.hoy());
update operacion.pedido set fecha_envio = negocio.hoy() - 20 where id = (select (j ->> 'pedido_id')::bigint from _p2);
create temp table _p3 as select operacion.crear_pedido('iv:ped3', pg_temp.cid('Iv Cliente Dos'), '[{"modelo":"Iv Nexa 50K","sabor":"Mango","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 5000, 0, negocio.hoy(), null, 7) as j;
select operacion.confirmar_pedido('iv:ped3c', (select (j ->> 'pedido_id')::bigint from _p3));
select is(jsonb_array_length(pg_temp.cand('cli_vencido_pide')), 1, 'cliente con saldo vencido que pide mas: aviso inmediato');
select is((pg_temp.cand('cli_vencido_pide') -> 0 -> 'payload' ->> 'dias_vencido')::int, 13, 'vencido hace 13 dias');
select is(jsonb_array_length(pg_temp.cand('din_descuento')), 1, 'un descuento de 5,000 sobre 95,000 es inusual (mas de 5 por ciento)');
select is((pg_temp.cand('din_descuento') -> 0 -> 'payload' ->> 'pct')::int, 5, 'cerca de 5 por ciento entero');
select is(jsonb_array_length(pg_temp.cand('ped_guia_pendiente')), 0, 'enviado hoy: aun no pasa el dia para la guia');
update operacion.pedido set enviado_at = now() - interval '2 days' where folio = (select j ->> 'folio' from _p2);
select is(jsonb_array_length(pg_temp.cand('ped_guia_pendiente')), 1, 'enviado con paqueteria hace 2 dias y sin guia: guia pendiente');
insert into operacion.guia (sentido, paqueteria, numero, pedido_id, fecha_neg, evento_id) select 'salida', 'Pitic', '123', p.id, negocio.hoy(), p.evento_id from operacion.pedido p where p.folio = (select j ->> 'folio' from _p2);
select is(jsonb_array_length(pg_temp.cand('ped_guia_pendiente')), 0, 'con la guia registrada se resuelve');
select is(jsonb_array_length(pg_temp.cand('ped_sin_entrega')), 1, 'enviado hace 20 dias de bodega y sin entrega confirmada');
select is((pg_temp.cand('ped_sin_entrega') -> 0 ->> 'canal'), 'I', 'a los 10 dias escala a inmediato');
update operacion.pedido set creado_at = now() - interval '6 hours' where folio = (select j ->> 'folio' from _p3);
select is((pg_temp.cand('ped_pendiente_envio') -> 0 -> 'payload' ->> 'etapa'), 'empacar', 'pedido confirmado de bodega sin empacar tras 4 horas');
-- Concentracion de cartera: dos clientes con saldo, uno con mas de 40 por ciento.
select is(jsonb_array_length(pg_temp.cand('cli_concentracion')), 1, 'un cliente con mas de 40 por ciento de la cartera se avisa');
select is((pg_temp.cand('cli_concentracion') -> 0 -> 'payload' ->> 'pct_top1')::int, 79, 'el primero tiene 79 por ciento de la cartera');
select operacion.registrar_pago('iv:pg1', 'Angelo', 100000, pg_temp.cid('Iv Cliente Uno'), null, false);
select operacion.registrar_pago('iv:pg2', 'Angelo', 100000, pg_temp.cid('Iv Cliente Uno'), null, false);
select is(jsonb_array_length(pg_temp.cand('cli_pago_dup')), 1, 'mismo cliente, monto y cuenta en menos de 48 horas: posible duplicado');
select is((pg_temp.cand('cli_pago_dup') -> 0 ->> 'canal'), 'I', 'el duplicado sale inmediato');

-- ------------------------------------------------------------------ 7. monitor de proveedores: puente con relevancia
insert into proveedores.modelo (producto_id, handle, titulo, titulo_norm, marca, puffs, estado, primera_vez, ultima_vez, mapeo, canonico_id)
  values ('iv-p1', 'h', 'Iv Waka 15K', 'iv waka 15k', 'Iv Marca', 15000, 'activo', now(), now(), 'confirmado', (select id::text from catalogo.modelo where nombre_canonico = 'Iv Waka 15K')),
         ('iv-p2', 'h2', 'Iv Otra 5K', 'iv otra 5k', 'Marca Ajena', 5000, 'activo', now(), now(), 'pendiente', null);
select operacion.avisar('proveedor_sabor_agotado', null, 'prov:iv1', null, 'Sabor agotado', 'proveedor_modelo', null, '{"entidad":"iv-p1","sabores":["Piña"]}'::jsonb);
select operacion.avisar('proveedor_sabor_agotado', null, 'prov:iv2', null, 'Sabor agotado ajeno', 'proveedor_modelo', null, '{"entidad":"iv-p2","sabores":["Fresa"]}'::jsonb);
select operacion.avisar('inventario_proveedores_degradado', null, 'prov:iv3', null, 'Fuente degradada', 'proveedor_fuente', null, '{"entidad":"inventario"}'::jsonb);
select is((select count(*)::int from jsonb_array_elements(pg_temp.cand('prv_puente')) x), 3, 'el puente ve los tres avisos del monitor');
select is((select x ->> 'canal' from jsonb_array_elements(pg_temp.cand('prv_puente')) x where x -> 'payload' ->> 'modelo' = 'Iv Waka 15K'), 'R', 'un sabor agotado de un modelo que aun no vendemos va al resumen, no inmediato');
select is((select x ->> 'canal' from jsonb_array_elements(pg_temp.cand('prv_puente')) x where x -> 'payload' ->> 'tipo' = 'inventario_proveedores_degradado'), 'I', 'la fuente degradada siempre es inmediata');
select is((select x ->> 'canal' from jsonb_array_elements(pg_temp.cand('prv_puente')) x where x -> 'payload' ->> 'modelo' = 'Iv Otra 5K'), 'R', 'lo que no vendemos va al resumen');
select is((select canal from notificacion.tipo where codigo = 'proveedor_sabor_agotado'), 'ST', 'antes de encender el puente el monitor sigue su camino');
select is((agente.avisos_fijar(true, 'angelo', 5100001, 'prv_puente') ->> 'activo')::boolean, true, 'un socio enciende el puente');
select is((select canal from notificacion.tipo where codigo = 'proveedor_sabor_agotado'), 'SW', 'con el puente, el monitor deja de mandar a Telegram por su cuenta (queda en la campana)');
select agente.avisos_fijar(false, 'angelo', 5100001, 'prv_puente');
select is((select canal from notificacion.tipo where codigo = 'proveedor_sabor_agotado'), 'ST', 'apagado el puente se restaura');
select throws_ok($$ select agente.avisos_fijar(true, 'omar', 5100003, null) $$, 'P0460', null, 'Omar no enciende los avisos');
select throws_ok($$ select agente.avisos_fijar(true, 'angelo', 5100002, null) $$, '42501', null, 'el id de Telegram debe ser del socio indicado');
-- Venta de Karen (Waka) para volver relevante su modelo.
select operacion.confirmar_pedido('iv:ped4c', (operacion.crear_pedido('iv:ped4', pg_temp.cid('Iv Cliente Uno'), '[{"modelo":"Iv Waka 15K","sabor":"Piña","piezas":12}]'::jsonb, 'karen_directo', null, 0, 0, 0, negocio.hoy(), null, 7) ->> 'pedido_id')::bigint);
select is((select x ->> 'canal' from jsonb_array_elements(pg_temp.cand('prv_puente')) x where x -> 'payload' ->> 'modelo' = 'Iv Waka 15K'), 'I', 'con ventas del modelo, el sabor agotado del proveedor es inmediato');

-- ------------------------------------------------------------------ 8. cola: encender, enfriamiento por clave, carga silenciosa, digest con techo
select agente.avisos_fijar(true, 'angelo', 5100001, null);
select agente.avisos_fijar(true, 'angelo', 5100001, 'inv_agotado');
select agente.avisos_fijar(true, 'angelo', 5100001, 'oc_llego');
select agente.avisos_fijar(true, 'angelo', 5100001, 'prv_costo');
create temp table _e1 as select agente.avisos_inventario_evaluar(negocio.hoy(), 'emitir') as j;
select is((select (j -> 'nuevos' ->> 'inv_agotado')::int from _e1), 1, 'la regla encendida encola el agotado');
select is((select (j -> 'nuevos' ->> 'oc_llego')::int from _e1), 1, 'y el resumen de llegada');
select is((select (j -> 'nuevos' ->> 'prv_costo')::int from _e1), 1, 'y el cambio de costo');
select ok(not (select j -> 'nuevos' ? 'inv_reponer' from _e1), 'las reglas apagadas no se evaluan ni encolan');
select is((agente.avisos_inventario_evaluar(negocio.hoy(), 'emitir') -> 'nuevos' ->> 'inv_agotado')::int, 0, 'segunda pasada: la clave esta en enfriamiento y no duplica');
select is((select canal from agente.aviso_cola where codigo = 'oc_llego'), 'I', 'el resumen de llegada quedo como inmediato');
-- Carga silenciosa: lo vigente queda como historico y no sale.
select agente.avisos_inventario_evaluar(negocio.hoy(), 'silencioso');
select ok((select count(*) from agente.aviso_cola where estado = 'historico') > 0, 'la carga silenciosa registra lo vigente como historico');
select is((select count(*)::int from agente.aviso_cola where estado = 'historico' and codigo = 'inv_agotado'), 0, 'lo que ya estaba en la cola no se duplica como historico (enfriamiento)');
-- Digest: el inmediato sale, en silencio nocturno solo salen criticos, y el tope de mensajes cuenta.
create temp table _d1 as select agente.avisos_digest_armar('I', (negocio.hoy() + time '10:00') at time zone 'America/Merida') as j;
select is((select jsonb_array_length(j -> 'items') from _d1), 2, 'ventana I de dia: salen los dos inmediatos (llegada y costo en riesgo)');
select is((agente.avisos_digest_armar('I', (negocio.hoy() + time '23:00') at time zone 'America/Merida') -> 'items') , '[]'::jsonb, 'de noche (silencio 21 a 7) un inmediato no critico no sale');
select is(jsonb_array_length(agente.avisos_digest_armar('M', (negocio.hoy() + time '09:00') at time zone 'America/Merida') -> 'items'), 3, 'el digest de las 09:00 junta lo pendiente (M y los inmediatos que esperaron)');
select ok(agente.avisos_digest_confirmar('I', array(select (x ->> 'id')::bigint from jsonb_array_elements((select j -> 'items' from _d1)) x), (negocio.hoy() + time '10:00') at time zone 'America/Merida') is not null, 'confirmar registra el digest');
select is((select estado from agente.aviso_cola where codigo = 'oc_llego'), 'enviado', 'lo enviado sale de la cola');
select is(agente.avisos_digest_confirmar('I', array(select id from agente.aviso_cola where codigo = 'oc_llego'), now()), null::bigint, 'confirmar dos veces no registra otro digest');
-- Tope: con 6 mensajes en el dia ya no sale nada que no sea critico.
-- (el techo cuenta en el libro unico notificacion.programado: reloj + cobranza + inventario)
insert into notificacion.programado (clave, clase, codigo, severidad, dia, cuenta_techo, creado_at) select 'iv:tope:' || g, 'inventario_digest', 'digest_inventario_M', 'I', negocio.hoy(), true, now() from generate_series(1, 6) g;
select is(jsonb_array_length(agente.avisos_digest_armar('M', (negocio.hoy() + time '09:00') at time zone 'America/Merida') -> 'items'), 0, 'con 6 mensajes en el dia el digest no manda mas');

-- ------------------------------------------------------------------ 9. consultas del bot y diff de lista
select ok(jsonb_array_length(agente.consulta_inventario('mas_vendido') -> 'lineas') > 0, '/vende devuelve lineas');
select is((agente.consulta_inventario('mas_vendido') -> 'lineas' -> 0 ->> 'etiqueta'), 'IV NEXA 50K', 'el modelo mas vendido va en mayusculas');
select ok(jsonb_array_length(agente.consulta_inventario('reponer') -> 'lineas') > 0, '/reponer devuelve lineas');
select throws_ok($$ select agente.consulta_inventario('otra') $$, '22023', null, 'consulta desconocida se rechaza');
create temp table _l as select agente.lista_proveedor_diff('Isaac', '[{"modelo":"Iv Nexa 50K","sabores":["Mango","Sandia Hielo"],"costo_cent":10000},{"modelo":"Iv Modelo Nuevo","sabores":["Uva"]}]'::jsonb, true) as j;
select is((select j -> 'modelos_nuevos' ->> 0 from _l), 'IV MODELO NUEVO', 'la lista trae un modelo nuevo');
select is((select j -> 'sabores_nuevos' ->> 0 from _l), 'IV NEXA 50K SANDIA HIELO', 'y un sabor nuevo');
select is((select (j -> 'costos' -> 0 ->> 'pct')::int from _l), 5, 'y un costo que sube cerca de 5 por ciento (sin importe)');
select ok(not (select j::text from _l) ~ '10000|9500', 'el diff no expone importes');
select is((select count(*)::int from agente.aviso_cola where codigo = 'prv_lista'), 0, 'con la regla prv_lista apagada no encola');

-- ------------------------------------------------------------------ 10. permisos
select ok(has_function_privilege('servidor', 'agente.avisos_inventario_evaluar(date,text,timestamptz)', 'execute'), 'servidor evalua');
select ok(not has_function_privilege('authenticated', 'agente.avisos_inventario_evaluar(date,text,timestamptz)', 'execute'), 'la web no evalua');
select ok(not has_function_privilege('anon', 'agente.aviso_encolar(text,text,jsonb,text,text)', 'execute'), 'anon no encola');
select ok(not has_function_privilege('servidor', 'agente._ev_inv_reponer(date,timestamptz)', 'execute'), 'los evaluadores internos no se llaman desde fuera');
select ok(not has_table_privilege('authenticated', 'agente.aviso_cola', 'select'), 'la cola no es legible desde la web');
select ok(has_function_privilege('servidor', 'agente.minimo_paso(text,jsonb)', 'execute'), 'servidor fija minimos');
select * from finish();
rollback;
