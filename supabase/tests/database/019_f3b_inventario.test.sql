-- pgTAP F3b-2: inventario completo, kardex, semaforo por dias de cobertura, conteo con diferencias explicadas y documentos PDF.
-- Los esperados salen del documento 18 (GU-1 kardex, GU-2 sabor, GU-5 semaforo, GU-12 apartado) y del 28 (PDF), escritos a mano antes del codigo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3b.inv@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('75555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3b.inv@example.test');
select set_config('request.jwt.claim.sub', '75555555-5555-5555-5555-555555555555', true);

create function pg_temp.mov(p_clave text, p_modelo text, p_sabor text, p_tipo text, p_cant int, p_valor bigint, p_dias_atras int) returns jsonb language sql as
  $$ select operacion.registrar_movimiento($1, $2, $3, 'bodega_omar', $4, $5, $6, negocio.hoy() - $7) $$;
create function pg_temp.mod(p_nombre text) returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = $1 $$;
create function pg_temp.inv(p_modelo text) returns jsonb language sql as
  $$ select m from jsonb_array_elements(api.inventario_completo() -> 'modelos') m where m ->> 'modelo' = $1 $$;

-- Semaforo: los seis casos de 3.5 (LT = 7, R = 7, objetivo 28, sobrestock x2) ------------------------------------------------------------------
select is(operacion.estado_cobertura(6, 7, 7, 28, 2), 'urge', 'GU-5 caso A: 6 d con entrega de 7 => URGE PEDIR');
select is(operacion.estado_cobertura(10, 7, 7, 28, 2), 'brevedad', 'caso B: 10 d => PEDIR A LA BREVEDAD');
select is(operacion.estado_cobertura(20, 7, 7, 28, 2), 'siguiente', 'caso C: 20 d => PEDIR SIGUIENTE PEDIDO');
select is(operacion.estado_cobertura(27.5, 7, 7, 28, 2), 'buena', 'caso D: 27.5 d => BUENA CANTIDAD');
select is(operacion.estado_cobertura(33.3, 7, 7, 28, 2), 'excelente', 'caso E: 33.3 d => EXCELENTE');
select is(operacion.estado_cobertura(120, 7, 7, 28, 2), 'sobrestock', 'caso F: 120 d => SOBRESTOCK (el Excel decia pedir a la brevedad)');
select is(operacion.estado_cobertura(10, 14, 7, 28, 2), 'urge', 'variante: con LT = 14 el caso B pasa a URGE PEDIR');
select is(operacion.estado_cobertura(56, 7, 7, 28, 2), 'excelente', 'el limite superior de excelente es 2 x objetivo');
select is(operacion.estado_cobertura(56.1, 7, 7, 28, 2), 'sobrestock', 'arriba de 2 x objetivo es sobrestock');
select is(operacion.estado_cobertura_calc(10, 28, 6, 40, 7, 7, 28, 2), 'sin_historia', 'menos de 28 dias de historia: SIN HISTORIA');
select is(operacion.estado_cobertura_calc(40, 28, 0, 40, 7, 7, 28, 2), 'sin_movimiento', 'con historia y demanda 0: sin movimiento');
select is(operacion.estado_cobertura_calc(40, 28, 2, 0, 7, 7, 28, 2), 'urge', 'existencia 0 con demanda positiva: URGE PEDIR');

-- Datos: modelos ilustrativos ------------------------------------------------------------------------------------------------------------------
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Urge', 50000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Excelente', 50000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Sobre', 50000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Nuevo', 15000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Quieto', 15000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Agotado', 15000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Tres Sabores', 15000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Marca', 'F3B2 Kardex', 15000, 'ambas');
select catalogo.asegurar_modelo('F3B2 Otra', 'F3B2 Otra Marca', 15000, 'ambas');
select catalogo.asegurar_sku(m, 'Unico') from unnest(array['F3B2 Urge', 'F3B2 Excelente', 'F3B2 Sobre', 'F3B2 Nuevo', 'F3B2 Quieto', 'F3B2 Agotado', 'F3B2 Kardex', 'F3B2 Otra Marca']) m;
select catalogo.asegurar_sku('F3B2 Tres Sabores', s) from unnest(array['Mango', 'Uva', 'Sandia']) s;

-- 168 piezas en 4 salidas dentro de los ultimos 28 dias => 6 por dia
select pg_temp.mov('f3b2:u0', 'F3B2 Urge', 'Unico', 'entrada_compra', 200, 2000000, 40);
select pg_temp.mov('f3b2:e0', 'F3B2 Excelente', 'Unico', 'entrada_compra', 400, 4000000, 40);
select pg_temp.mov('f3b2:s0', 'F3B2 Sobre', 'Unico', 'entrada_compra', 800, 8000000, 40);
do $$
declare m text; i int; d int[] := array[20, 15, 10, 5];
begin
  foreach m in array array['F3B2 Urge', 'F3B2 Excelente', 'F3B2 Sobre'] loop
    for i in 1..4 loop perform pg_temp.mov('f3b2:' || m || ':' || i, m, 'Unico', 'salida_pedido', -42, null, d[i]); end loop;
  end loop;
end $$;
select pg_temp.mov('f3b2:n0', 'F3B2 Nuevo', 'Unico', 'entrada_compra', 50, 500000, 5);
select pg_temp.mov('f3b2:q0', 'F3B2 Quieto', 'Unico', 'entrada_compra', 50, 500000, 40);
select pg_temp.mov('f3b2:a0', 'F3B2 Agotado', 'Unico', 'entrada_compra', 50, 500000, 40);
select pg_temp.mov('f3b2:a1', 'F3B2 Agotado', 'Unico', 'salida_pedido', -50, null, 3);

-- Cobertura de punta a punta -------------------------------------------------------------------------------------------------------------------
select is((pg_temp.inv('F3B2 Urge') ->> 'estado'), 'urge', 'GU-5: 32 disponibles con 6 por dia (5.3 d) y entrega de 7 d => URGE PEDIR');
select is((pg_temp.inv('F3B2 Urge') ->> 'cobertura_dias')::numeric, 5.3, 'cobertura 5.3 d');
select is((pg_temp.inv('F3B2 Urge') ->> 'demanda_diaria')::numeric, 6.00, 'demanda diaria = 168 / 28 = 6');
select is((pg_temp.inv('F3B2 Urge') ->> 'lt_dias')::int, 7, 'sin proveedor con costo, el tiempo de entrega supuesto es el de Isaac (7 d)');
select is((pg_temp.inv('F3B2 Excelente') ->> 'estado'), 'excelente', '232 disponibles con 6 por dia (38.7 d) => EXCELENTE');
select is((pg_temp.inv('F3B2 Sobre') ->> 'estado'), 'sobrestock', '632 disponibles (105 d) => SOBRESTOCK');
select is((pg_temp.inv('F3B2 Nuevo') ->> 'estado'), 'sin_historia', 'GU-5: menos de 28 dias de historia => SIN HISTORIA (solo existencia)');
select is((pg_temp.inv('F3B2 Quieto') ->> 'estado'), 'sin_movimiento', 'con historia y sin ventas => sin movimiento');
select is((pg_temp.inv('F3B2 Agotado') ->> 'estado'), 'urge', 'existencia 0 con demanda => URGE PEDIR');
select is((pg_temp.inv('F3B2 Agotado') ->> 'piezas')::int, 0, 'y la existencia es 0');
select is((pg_temp.inv('F3B2 Quieto') ->> 'cobertura_dias'), null, 'sin demanda no hay cobertura calculable (Sin dato, no infinito)');
-- con un proveedor mas lento el tiempo de entrega sube y el modelo cambia de estado
select catalogo.fijar_costo('f3b2:c1', 'Karen', 'F3B2 Excelente', 9000, negocio.hoy() - 60, 'prueba');
select is((pg_temp.inv('F3B2 Excelente') ->> 'lt_dias')::int, 10, 'con costo vigente de Karen el tiempo de entrega es el de Karen (10 d)');
-- Apartado (GU-12): baja el disponible y la cobertura, no el kardex ni el valor
select is((pg_temp.inv('F3B2 Excelente') ->> 'valor_cent')::bigint, 2320000::bigint, 'valor del modelo = 232 piezas a 10,000');
insert into operacion.reserva (sku_id, piezas, origen_tipo, origen_id) values ((select k.id from catalogo.sku k where k.modelo_id = pg_temp.mod('F3B2 Excelente')), 20, 'pedido', 0);
select is((pg_temp.inv('F3B2 Excelente') ->> 'disponible')::int, 212, 'GU-12: una reserva de 20 pz baja el disponible');
select is((pg_temp.inv('F3B2 Excelente') ->> 'piezas')::int, 232, 'no la existencia fisica');
select is((pg_temp.inv('F3B2 Excelente') ->> 'valor_cent')::bigint, 2320000::bigint, 'ni el valor');
select is((pg_temp.inv('F3B2 Excelente') ->> 'cobertura_dias')::numeric, 35.3, 'la cobertura baja a 212 / 6 = 35.3 d');
update operacion.reserva set estado = 'liberada' where origen_id = 0 and origen_tipo = 'pedido';

-- Valor por sabor: reparto por mayor residuo, la suma de sabores es el valor del modelo al centavo (GU-2, CU3) ----------------------------------
select pg_temp.mov('f3b2:t1', 'F3B2 Tres Sabores', 'Mango', 'entrada_compra', 50, 457731, 40);
select pg_temp.mov('f3b2:t2', 'F3B2 Tres Sabores', 'Uva', 'entrada_compra', 30, 274638, 40);
select pg_temp.mov('f3b2:t3', 'F3B2 Tres Sabores', 'Sandia', 'entrada_compra', 20, 183093, 40);
select is((select jsonb_agg((s ->> 'valor_cent')::bigint order by s ->> 'sabor') from jsonb_array_elements(pg_temp.inv('F3B2 Tres Sabores') -> 'sabores') s), '[457731, 183092, 274639]'::jsonb,
  'GU-2: 50, 30 y 20 pz de un modelo de 9,154.62 por pieza: Mango 457,731, Sandia 183,092 y Uva 274,639 (el mayor residuo recibe el centavo)');
select is((select sum((s ->> 'valor_cent')::bigint)::bigint from jsonb_array_elements(pg_temp.inv('F3B2 Tres Sabores') -> 'sabores') s), (pg_temp.inv('F3B2 Tres Sabores') ->> 'valor_cent')::bigint, 'CU3: suma de sabores = valor del modelo al centavo');
select is((api.inventario_completo() -> 'comprobacion' ->> 'valor_modelos_cent')::bigint, (api.inventario_completo() -> 'comprobacion' ->> 'valor_sabores_cent')::bigint, 'la comprobacion global de valor cuadra');
select is((api.inventario_completo() -> 'comprobacion' ->> 'piezas_modelos')::int, (api.inventario_completo() -> 'comprobacion' ->> 'piezas_sabores')::int, 'y la de piezas');
select is((api.inventario_completo() -> 'totales' ->> 'valor_cent')::bigint, (select sum(valor_cent)::bigint from operacion.existencia_modelo), 'el total de la pantalla es el valor del kardex');
select is((api.inventario_completo() -> 'totales' ->> 'piezas')::int, (select sum(piezas)::int from operacion.existencia_modelo), 'y las piezas');

-- Kardex (GU-1) ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.mov('f3b2:k1', 'F3B2 Kardex', 'Unico', 'entrada_compra', 100, 1200000, 12);
select pg_temp.mov('f3b2:k2', 'F3B2 Kardex', 'Unico', 'salida_pedido', -30, null, 10);
select pg_temp.mov('f3b2:k3', 'F3B2 Kardex', 'Unico', 'entrada_compra', 50, 660000, 8);
select pg_temp.mov('f3b2:k4', 'F3B2 Kardex', 'Unico', 'salida_pedido', -30, null, 6);
select pg_temp.mov('f3b2:k5', 'F3B2 Kardex', 'Unico', 'salida_pedido', -90, null, 4);
create temp table _k on commit drop as select api.inventario_kardex(pg_temp.mod('F3B2 Kardex')) as j;
select is((select jsonb_array_length(j -> 'movimientos') from _k), 5, 'cinco movimientos');
select is((select jsonb_agg(m ->> 'saldo_piezas' order by (m ->> 'id')::bigint) from _k, jsonb_array_elements(j -> 'movimientos') m), '["100", "70", "120", "90", "0"]'::jsonb, 'existencias 100, 70, 120, 90 y 0');
select is((select jsonb_agg((m ->> 'saldo_valor_cent')::bigint order by (m ->> 'id')::bigint) from _k, jsonb_array_elements(j -> 'movimientos') m), '[1200000, 840000, 1500000, 1125000, 0]'::jsonb, 'GU-1: 12,000 => 8,400 => 15,000 => 11,250 => 0 exactos');
select is((select (m ->> 'sale_total_cent')::bigint from _k, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'sale_piezas')::int = 30 order by (m ->> 'id')::bigint limit 1), 360000::bigint, 'la primera salida de 30 vale 3,600.00');
select is((select (m ->> 'sale_total_cent')::bigint from _k, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'sale_piezas')::int = 90), 1125000::bigint, 'la ultima salida de 90 vale 11,250.00 exactos (residuo)');
select is((select (m ->> 'costo_prom_cent')::bigint from _k, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'saldo_piezas')::int = 120), 12500::bigint, 'costo medio 125.00 con 120 piezas y 15,000.00');
select is((select m ->> 'costo_prom_cent' from _k, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'saldo_piezas')::int = 0), null, 'sin existencia el costo promedio es Sin existencia, no un error');
select is((select (m ->> 'entra_unit_cent')::bigint from _k, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'entra_piezas')::int = 50), 13200::bigint, 'la entrada de 50 pz entra a 132.00 c/u');
select is((select (j -> 'comprobacion' ->> 'cuadra')::boolean from _k), true, 'CU6: valor final = entradas menos salidas');
select throws_ok($$ select pg_temp.mov('f3b2:k6', 'F3B2 Kardex', 'Unico', 'entrada_compra', 10, 100000, 20) $$, 'P0422', null, 'GU-1: una entrada con fecha anterior a la ultima se rechaza');
select pg_temp.mov('f3b2:k7', 'F3B2 Kardex', 'Unico', 'entrada_compra', 20, 240000, 2);
select operacion.reversar_evento('f3b2:k7r', (select id from operacion.evento where clave_idem = 'f3b2:k7'), 'prueba de reversa');
create temp table _k2 on commit drop as select api.inventario_kardex(pg_temp.mod('F3B2 Kardex')) as j;
select is((select count(*)::int from _k2, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'es_reversa')::boolean), 1, 'la reversa aparece marcada en el kardex');
select ok((select (m ->> 'reversa_de') is not null from _k2, jsonb_array_elements(j -> 'movimientos') m where (m ->> 'es_reversa')::boolean), 'y enlaza al movimiento que corrige');
select is((api.inventario_kardex(pg_temp.mod('F3B2 Kardex'), null, negocio.hoy() - 5, null) -> 'apertura' ->> 'piezas')::int, 90, 'con un periodo, la apertura es el saldo previo (90 piezas antes de hace 5 dias)');
select is(jsonb_array_length(api.inventario_kardex(pg_temp.mod('F3B2 Kardex'), null, negocio.hoy() - 5, null) -> 'movimientos'), 3, 'y solo trae los movimientos del periodo (la salida de 90, la entrada y su reversa)');
select is(jsonb_array_length(api.inventario_kardex(pg_temp.mod('F3B2 Tres Sabores'), (select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Uva')) -> 'movimientos'), 1, 'el kardex se filtra por sabor');
select is(api.inventario_kardex(999999), null, 'un modelo desconocido da null');

-- Conteo ciego -------------------------------------------------------------------------------------------------------------------------------------
select ok(jsonb_array_length(api.conteo_hoja('bodega_omar')) >= 10, 'la hoja de conteo trae los sabores con entrada en la bodega');
select ok(not (api.conteo_hoja('bodega_omar')::text ~ 'esperado'), 'y NO trae lo esperado: primero se cuenta');
create temp table _p on commit drop as select api.conteo_previsualizar('bodega_omar', jsonb_build_array(
  jsonb_build_object('sku_id', (select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Mango'), 'contado', 48),
  jsonb_build_object('sku_id', (select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Uva'), 'contado', 30))) as j;
select is((select j ->> 'con_diferencia' from _p), '1', 'la previsualizacion encuentra una diferencia');
select is((select (l ->> 'diferencia')::int from _p, jsonb_array_elements(j -> 'lineas') l where l ->> 'sabor' = 'Mango'), -2, 'contado 48 contra 50 del sistema => -2');
select is((select (j ->> 'exactitud_bp')::int from _p), 9750, 'exactitud = 1 - 2 / 80 = 97.5 %');
select is((select count(*)::int from operacion.conteo), 0, 'previsualizar no escribe nada');
insert into operacion.reserva (sku_id, piezas, origen_tipo, origen_id) values ((select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Mango'), 5, 'pedido', 0);
select is((select (l ->> 'vendido_por_recoger')::int from jsonb_array_elements(api.conteo_previsualizar('bodega_omar', jsonb_build_array(jsonb_build_object('sku_id', (select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Mango'), 'contado', 50))) -> 'lineas') l), 5, '"En la bodega" = sistema + vendidas por recoger, con desglose');
update operacion.reserva set estado = 'liberada' where origen_id = 0 and origen_tipo = 'pedido' and piezas = 5;
create temp table _c on commit drop as select api.abrir_conteo('f3b2:c:a', 'bodega_omar', 'semanal', now() - interval '10 minutes') as j;
select throws_ok($$ select api.abrir_conteo('f3b2:c:b', 'bodega_omar', 'semanal', null) $$, '23502', null, 'el conteo exige fecha y hora');
create temp table _lin on commit drop as select jsonb_build_array(
  jsonb_build_object('sku_id', (select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Mango'), 'contado', 48, 'explicacion_tipo', 'error_de_conteo'),
  jsonb_build_object('sku_id', (select k.id from catalogo.sku k join catalogo.sabor sa on sa.id = k.sabor_id where k.modelo_id = pg_temp.mod('F3B2 Tres Sabores') and sa.nombre_canonico = 'Uva'), 'contado', 30)) as j;
create temp table _cc on commit drop as select api.cerrar_conteo('f3b2:c:c', ((select j from _c) ->> 'conteo_id')::bigint, (select j from _lin)) as j;
select is((select (j ->> 'ajustes')::int from _cc), 1, 'cierra con un ajuste por cada sabor con diferencia (Uva cuadra y no se ajusta)');
select is((select valor_cent from operacion.movimiento_inventario where tipo = 'ajuste_conteo' and cantidad = -2), -18309::bigint, 'el faltante de 2 pz sale al costo promedio del modelo (915,462 / 100 x 2)');
select is((select explicacion_tipo from operacion.conteo_linea where diferencia = -2), 'error_de_conteo', 'la diferencia queda explicada');
select is((select count(*)::int from operacion.aviso where codigo = 'conteo_con_diferencia' and estado = 'abierta'), 1, 'NT-032: un aviso por conteo con diferencia');
select is((select severidad from operacion.aviso where codigo = 'conteo_con_diferencia'), 'C', 'critica porque la exactitud (97.5 %) es menor a 98 %');
select is((select payload ->> 'exactitud_bp' from operacion.aviso where codigo = 'conteo_con_diferencia'), '9750', 'el payload lleva la referencia, no texto con cifras');
select is((api.conteos_lista() -> 0 ->> 'sin_explicar')::int, 0, 'la lista de conteos dice cuantas diferencias quedan sin explicar');
select is((api.conteo_detalle(((select j from _c) ->> 'conteo_id')::bigint) -> 'lineas' -> 0 ->> 'esperado')::int, 50, 'el detalle ordena por modelo y sabor (Mango: 50 esperadas)');
select is(api.cerrar_conteo('f3b2:c:c', ((select j from _c) ->> 'conteo_id')::bigint, (select j from _lin)), (select j from _cc), 'cerrar de nuevo con la misma clave devuelve lo mismo y no duplica ajustes (idempotente)');
select is((select count(*)::int from operacion.movimiento_inventario where tipo = 'ajuste_conteo'), 1, 'un solo ajuste en total');

-- Documentos PDF -----------------------------------------------------------------------------------------------------------------------------------
create temp table _d on commit drop as select
  api.reservar_documento_inventario('web:f3b2-d1', 'clientes', '{"solo_disponibles": true, "marca": "F3B2 Marca"}'::jsonb) as c,
  api.reservar_documento_inventario('web:f3b2-d2', 'interna', '{"marca": "F3B2 Marca"}'::jsonb) as i,
  api.reservar_documento_inventario('web:f3b2-d3', 'clientes', '{"solo_disponibles": true, "marca": "F3B2 Marca"}'::jsonb) as c2;
select matches((select c ->> 'folio' from _d), '^INV-[0-9]{4}$', 'folio de la serie INV');
select isnt((select c ->> 'folio' from _d), (select i ->> 'folio' from _d), 'cada documento su folio');
select is((select c ->> 'huella' from _d), (select c2 ->> 'huella' from _d), 'mismo contenido => misma huella (y el corte es el mismo en la transaccion)');
select is(api.reservar_documento_inventario('web:f3b2-d1', 'clientes', '{"solo_disponibles": true, "marca": "F3B2 Marca"}'::jsonb) ->> 'folio', (select c ->> 'folio' from _d), 'reintentar con la misma clave devuelve el mismo folio (idempotente)');
select throws_ok($$ select api.reservar_documento_inventario('web:f3b2-d1', 'interna', '{}'::jsonb) $$, 'P0409', null, 'misma clave con otros datos => conflicto');
select ok(not ((select c -> 'snapshot' from _d)::text ~* '(costo|valor|utilidad|margen|proveedor|Isaac|Karen)'), 'el snapshot para clientes NO lleva costos, valor, utilidad ni proveedor');
select ok(not exists (select 1 from jsonb_array_elements((select c -> 'snapshot' -> 'modelos' from _d)) m where (m ->> 'disponible')::boolean = false), 'solo disponibles: no trae modelos agotados');
select is((select c -> 'snapshot' -> 'modelos' -> 0 -> 'cantidad' from _d), 'null'::jsonb, 'por defecto solo disponible o agotado, sin cantidades exactas');
select ok((select i -> 'snapshot' -> 'modelos' -> 0 ? 'costo_prom_cent' from _d), 'la version interna si lleva el costo promedio');
select is((select jsonb_array_length(i -> 'snapshot' -> 'modelos') from _d), (select count(*)::int from jsonb_array_elements(api.inventario_completo() -> 'modelos') m where m ->> 'marca' = 'F3B2 Marca' and m ->> 'piezas' is not null), 'el corte del PDF coincide con la existencia de la pantalla');
select is((select (i -> 'snapshot' -> 'totales' ->> 'piezas')::int from _d), (api.inventario_completo() -> 'totales' ->> 'piezas')::int, 'y los totales');
select is((select count(*)::int from jsonb_array_elements(api.reservar_documento_inventario('web:f3b2-d4', 'clientes', '{"solo_socios_venden": true, "modelo": "F3B2 Quieto"}'::jsonb) -> 'snapshot' -> 'modelos') m), 1, 'filtro por modelo');
select ok((api.reservar_documento_inventario('web:f3b2-d5', 'clientes', jsonb_build_object('cliente_id', (select id from catalogo.cliente limit 1))) -> 'snapshot' -> 'modelos' -> 0 ? 'precio_cent'), 'con un cliente el modelo trae la llave de precio (del tabulador)');
-- guardar el PDF: la huella debe coincidir con los bytes
select is(api.completar_documento_inventario(((select c from _d) ->> 'id')::bigint, encode(sha256('\x255044462d'::bytea), 'hex'), encode('\x255044462d'::bytea, 'base64')) ->> 'sha256', encode(sha256('\x255044462d'::bytea), 'hex'), 'guarda el PDF con su huella');
select throws_ok($$ select api.completar_documento_inventario(((select i from _d) ->> 'id')::bigint, 'deadbeef', encode('\x255044462d'::bytea, 'base64')) $$, '22023', null, 'una huella que no coincide con los bytes se rechaza');
select is(api.documento_inventario(((select c from _d) ->> 'id')::bigint) ->> 'base64', encode('\x255044462d'::bytea, 'base64'), 'reabrir entrega los mismos bytes') ;
select throws_ok($$ update operacion.documento_inventario set contenido = '\x00' where id = ((select c from _d) ->> 'id')::bigint $$, '42501', null, 'un documento guardado no cambia');
select throws_ok($$ delete from operacion.documento_inventario where true $$, '42501', null, 'ni se borra');
select is(jsonb_array_length(api.documentos_inventario()), 1, 'la lista solo trae los documentos ya guardados');

-- Explicar este numero ------------------------------------------------------------------------------------------------------------------------------
select is((api.explicar_cifra('inventario:valor') -> 'comprobacion' ->> 'cuadra')::boolean, true, 'inventario:valor se comprueba por dos vias');
select is((api.explicar_cifra('inventario:valor') ->> 'valor')::bigint, (select sum(valor_cent)::bigint from operacion.existencia_modelo), 'y es el valor del kardex');
select is((api.explicar_cifra('cobertura:modelo:' || pg_temp.mod('F3B2 Urge')) -> 'comprobacion' ->> 'cuadra')::boolean, true, 'cobertura:modelo se comprueba contra existencia menos reservas');
select is((api.explicar_cifra('cobertura:modelo:' || pg_temp.mod('F3B2 Urge')) ->> 'valor')::int, 32, 'explica el disponible de 32 piezas');
select is(jsonb_array_length(api.explicar_cifra('cobertura:modelo:' || pg_temp.mod('F3B2 Urge')) -> 'movimientos'), 4, 'con las cuatro salidas de la ventana');
select is((api.explicar_cifra('existencia:modelo:' || pg_temp.mod('F3B2 Urge')) ->> 'valor')::int, 32, 'las cifras anteriores siguen funcionando');
select throws_ok($$ select api.explicar_cifra('desconocida:1') $$, '22023', null, 'una cifra desconocida se rechaza');

-- Permisos ----------------------------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select api.inventario_completo() $$, '42501', null, 'sin ser socio no se lee el inventario');
select throws_ok($$ select api.inventario_kardex(1) $$, '42501', null, 'ni el kardex');
select throws_ok($$ select api.documento_inventario(1) $$, '42501', null, 'ni los documentos');

select * from finish();
rollback;
