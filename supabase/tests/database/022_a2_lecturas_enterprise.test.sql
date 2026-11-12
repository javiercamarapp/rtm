-- pgTAP A2: lecturas enterprise (kardex consolidado y por sabor, detalle, marcas, mermas, valuacion, caja, libro de dinero).
-- Datos ilustrativos inventados; las cifras se escribieron a mano antes de correr.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a2.lectura@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('7a222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2.lectura@example.test');

-- Seguridad: anon no ejecuta nada; sin sesion de socio, nada responde ---------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
            and p.proname in ('inventario_kardex_consolidado', 'inventario_detalle', 'inventario_resumen_marca', 'inventario_mermas', 'conta_valuacion_detalle', 'conta_valuacion_serie', 'caja_resumen', 'libro_dinero')
            and has_function_privilege('anon', p.oid, 'execute')), 0, 'ninguna funcion nueva es ejecutable por anon');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
            and p.proname in ('inventario_kardex_consolidado', 'inventario_detalle', 'inventario_resumen_marca', 'inventario_mermas', 'conta_valuacion_detalle', 'conta_valuacion_serie', 'caja_resumen', 'libro_dinero')
            and has_function_privilege('authenticated', p.oid, 'execute')), 8, 'las ocho son ejecutables por authenticated');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'
            and p.proname in ('inventario_kardex_consolidado', 'inventario_detalle', 'inventario_resumen_marca', 'inventario_mermas', 'conta_valuacion_detalle', 'conta_valuacion_serie', 'caja_resumen', 'libro_dinero')
            and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))), 0, 'todas son security definer con search_path vacio');
select throws_ok($$ select api.inventario_kardex_consolidado() $$, null, null, 'sin sesion no hay lectura del kardex');
select throws_ok($$ select api.libro_dinero() $$, null, null, 'sin sesion no hay libro');

select set_config('request.jwt.claim.sub', '7a222222-2222-2222-2222-222222222222', true);

create function pg_temp.mov(p_clave text, p_modelo text, p_sabor text, p_tipo text, p_cant int, p_valor bigint, p_dias_atras int) returns jsonb language sql as
  $$ select operacion.registrar_movimiento($1, $2, $3, 'bodega_omar', $4, $5, $6, negocio.hoy() - $7) $$;
create function pg_temp.mod(p_nombre text) returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = $1 $$;
create function pg_temp.sku(p_modelo text, p_sabor text) returns bigint language sql as
  $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = pg_temp.mod($1) and s.nombre_canonico = $2 $$;

-- Vacio: sin movimientos nada es cero inventado ---------------------------------------------------------------------------------------------------
select is((api.inventario_kardex_consolidado() -> 'totales' ->> 'n')::int, 0, 'sin movimientos el kardex consolidado tiene 0 renglones');
select is((api.libro_dinero() -> 'totales' ->> 'n')::int, 0, 'y el libro tambien');
select is((api.caja_resumen() ->> 'con_movimientos')::boolean, false, 'la caja sin asientos lo dice (con_movimientos = false)');

-- Datos: dos modelos de una marca y uno de otra ---------------------------------------------------------------------------------------------------
select catalogo.asegurar_modelo('A2 Marca', 'A2 Uno', 15000, 'ambas');
select catalogo.asegurar_modelo('A2 Marca', 'A2 Dos', 15000, 'ambas');
select catalogo.asegurar_modelo('A2 Otra', 'A2 Tres', 15000, 'ambas');
select catalogo.asegurar_sku('A2 Uno', s) from unnest(array['Mango', 'Uva']) s;
select catalogo.asegurar_sku('A2 Dos', 'Unico');
select catalogo.asegurar_sku('A2 Tres', 'Unico');

-- A2 Uno: compra 100 Mango a 100.00 (total 10,000.00) hace 40 d; compra 50 Uva a 120.00 hace 30 d => 150 pzas, valor 16,000.00, promedio 106.67
select pg_temp.mov('a2:1', 'A2 Uno', 'Mango', 'entrada_compra', 100, 1000000, 40);
select pg_temp.mov('a2:2', 'A2 Uno', 'Uva', 'entrada_compra', 50, 600000, 30);
-- venta de 30 Mango hace 10 d (sale al promedio 106.67 = 3,200.00 aprox) y merma de 5 Uva hace 5 d
select pg_temp.mov('a2:3', 'A2 Uno', 'Mango', 'salida_pedido', -30, null, 10);
select pg_temp.mov('a2:4', 'A2 Uno', 'Uva', 'merma', -5, null, 5);
select pg_temp.mov('a2:5', 'A2 Dos', 'Unico', 'entrada_compra', 20, 200000, 3);
select pg_temp.mov('a2:6', 'A2 Tres', 'Unico', 'entrada_compra', 10, 100000, 2);

-- Kardex consolidado ------------------------------------------------------------------------------------------------------------------------------
select is((api.inventario_kardex_consolidado() -> 'totales' ->> 'n')::int, 6, 'consolidado: seis movimientos');
select is((api.inventario_kardex_consolidado() -> 'totales' ->> 'entradas_piezas')::int, 180, 'entradas 100 + 50 + 20 + 10 = 180');
select is((api.inventario_kardex_consolidado() -> 'totales' ->> 'salidas_piezas')::int, 35, 'salidas 30 + 5 = 35');
select is((api.inventario_kardex_consolidado() -> 'final' ->> 'piezas')::int, 145, 'existencia final 180 - 35 = 145');
select is(((api.inventario_kardex_consolidado() -> 'final' ->> 'valor_cent')::bigint), (select sum(valor_cent)::bigint from operacion.existencia_modelo), 'el valor final del pie coincide con existencia_modelo (via 2)');
select is((api.inventario_kardex_consolidado() -> 'comprobacion' ->> 'cuadra')::boolean, true, 'la comprobacion por dos vias cuadra');
select is((api.inventario_kardex_consolidado(p_marca => 'A2 Marca') -> 'totales' ->> 'entradas_piezas')::int, 170, 'por marca: 170 piezas de entrada');
select is((api.inventario_kardex_consolidado(p_marca => 'A2 Marca', p_tipo => 'merma') -> 'totales' ->> 'n')::int, 1, 'filtro por tipo: una merma');
select is((api.inventario_kardex_consolidado(p_q => 'uva') -> 'totales' ->> 'n')::int, 2, 'busqueda por sabor: dos movimientos de Uva');
select is((api.inventario_kardex_consolidado(p_limite => 2, p_desplazamiento => 4) -> 'movimientos' -> 0 ->> 'saldo_piezas') is not null, true, 'paginacion: la ultima pagina trae renglones');
select is(jsonb_array_length(api.inventario_kardex_consolidado(p_limite => 2) -> 'movimientos'), 2, 'el limite se respeta');
select is((api.inventario_kardex_consolidado(p_limite => 2) ->> 'total')::int, 6, 'pero el total del filtro es 6 (pie del filtro completo)');
-- Saldo inicial: con inicio hace 20 dias hay 150 piezas y 16,000.00 antes del periodo (A2 Uno) y 10 tras la venta
select is((api.inventario_kardex_consolidado(p_modelo => pg_temp.mod('A2 Uno'), p_ini => negocio.hoy() - 20) -> 'inicial' ->> 'piezas')::int, 150, 'saldo inicial del periodo: 150 piezas');
select is((api.inventario_kardex_consolidado(p_modelo => pg_temp.mod('A2 Uno'), p_ini => negocio.hoy() - 20) -> 'inicial' ->> 'valor_cent')::bigint, 1600000::bigint, 'saldo inicial: 16,000.00');
select is((api.inventario_kardex_consolidado(p_modelo => pg_temp.mod('A2 Uno'), p_ini => negocio.hoy() - 20) -> 'inicial' ->> 'costo_prom_cent')::bigint, 10667::bigint, 'costo promedio inicial 106.67');
select is((api.inventario_kardex_consolidado(p_modelo => pg_temp.mod('A2 Uno'), p_ini => negocio.hoy() - 20) -> 'cuadre_periodo' ->> 'esperado_piezas')::int,
          (api.inventario_kardex_consolidado(p_modelo => pg_temp.mod('A2 Uno'), p_ini => negocio.hoy() - 20) -> 'final' ->> 'piezas')::int, 'inicial + entradas - salidas = final en piezas');
-- Por sabor
select is((api.inventario_kardex_consolidado(p_sku => pg_temp.sku('A2 Uno', 'Mango')) -> 'final' ->> 'piezas')::int, 70, 'Mango: 100 - 30 = 70 piezas');
select is((api.inventario_kardex_consolidado(p_sku => pg_temp.sku('A2 Uno', 'Mango')) -> 'totales' ->> 'n')::int, 2, 'Mango: dos movimientos');
select is((api.inventario_kardex_consolidado(p_sku => pg_temp.sku('A2 Uno', 'Mango')) -> 'sabor' ->> 'piezas')::int, 70, 'bloque del sabor trae la existencia actual');
select is((select sum(((m ->> 'saldo_sabor_valor_cent'))::bigint)::bigint from jsonb_array_elements(api.inventario_kardex_consolidado(p_sku => pg_temp.sku('A2 Uno', 'Mango')) -> 'movimientos') m where (m ->> 'id')::bigint = (select max(id) from operacion.movimiento_inventario where sku_id = pg_temp.sku('A2 Uno', 'Mango'))),
          (select negocio.redondear_medio_arriba(valor_cent * 70, piezas) from operacion.existencia_modelo where modelo_id = pg_temp.mod('A2 Uno')), 'valor del sabor = piezas x costo promedio del modelo (valor a costo del modelo)');
select is((api.inventario_kardex_consolidado(p_sku => 999999) -> 'totales' ->> 'n')::int, 0, 'un sabor inexistente da cero renglones, sin error');
select throws_ok($$ select api.inventario_kardex_consolidado(p_tipo => 'inventado') $$, '22023', 'tipo de movimiento desconocido', 'tipo invalido rechazado');

-- Detalle ------------------------------------------------------------------------------------------------------------------------------------------
select is((select (m ->> 'salidas')::int from jsonb_array_elements(api.inventario_detalle(negocio.hoy() - 29, negocio.hoy()) -> 'modelos') m where (m ->> 'modelo_id')::bigint = pg_temp.mod('A2 Uno')), 35, 'detalle: A2 Uno salio 35 piezas en 30 dias');
select is((select (m ->> 'mermas')::int from jsonb_array_elements(api.inventario_detalle(negocio.hoy() - 29, negocio.hoy()) -> 'modelos') m where (m ->> 'modelo_id')::bigint = pg_temp.mod('A2 Uno')), 5, 'detalle: 5 piezas de merma');
select is((select (m ->> 'ultima_entrada')::date from jsonb_array_elements(api.inventario_detalle() -> 'modelos') m where (m ->> 'modelo_id')::bigint = pg_temp.mod('A2 Uno')), negocio.hoy() - 30, 'ultima entrada de A2 Uno hace 30 dias (antiguedad)');
select throws_ok($$ select api.inventario_detalle(negocio.hoy(), negocio.hoy() - 5) $$, '22023', 'rango de fechas invalido', 'rango invertido rechazado');

-- Marcas ---------------------------------------------------------------------------------------------------------------------------------------------
select is((select (m ->> 'piezas')::int from jsonb_array_elements(api.inventario_resumen_marca() -> 'marcas') m where m ->> 'marca' = 'A2 Marca'), 135, 'marca A2 Marca: 115 + 20 = 135 piezas');
select is((select (m ->> 'valor_cent')::bigint from jsonb_array_elements(api.inventario_resumen_marca() -> 'marcas') m where m ->> 'marca' = 'A2 Otra'), 100000::bigint, 'marca A2 Otra: 1,000.00');
select is((select (m ->> 'proveedor') from jsonb_array_elements(api.inventario_resumen_marca() -> 'marcas') m where m ->> 'marca' = 'A2 Otra'), null, 'sin costo de proveedor el proveedor es Sin dato (null), no inventado');
select is(jsonb_array_length(api.inventario_resumen_marca() -> 'cuentas_proveedor'), (select count(*)::int from catalogo.proveedor), 'una cuenta por proveedor');

-- Mermas -----------------------------------------------------------------------------------------------------------------------------------------------
select is((api.inventario_mermas() -> 'totales' ->> 'merma_piezas')::int, 5, 'mermas: 5 piezas');
select is((api.inventario_mermas() -> 'totales' ->> 'n')::int, 1, 'un renglon de merma');

-- Libro de dinero ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.fila(p_fecha text, p_monto bigint, p_msg text) returns jsonb language sql as
  $$ select jsonb_build_object('fecha', $1, 'monto_cent', $2, 'cuenta', 'Cuenta ilustrativa', 'origen', 'Origen ilustrativo', 'mensaje', $3) $$;
select api.mov_importar('a2:imp', 'pegado', null, null, jsonb_build_array(
  pg_temp.fila((negocio.hoy() - 40)::text, 1000000, 'Cobro ilustrativo uno'),
  pg_temp.fila((negocio.hoy() - 20)::text, -250000, 'Pago ilustrativo a proveedor'),
  pg_temp.fila((negocio.hoy() - 10)::text, 500000, 'Deposito sin nombre'),
  pg_temp.fila((negocio.hoy() - 5)::text, -100000, 'Gasto ilustrativo')));
select is((api.libro_dinero() -> 'totales' ->> 'n')::int, 4, 'libro: cuatro renglones');
select is((api.libro_dinero() -> 'totales' ->> 'cargos_cent')::bigint, 1500000::bigint, 'cargos 10,000 + 5,000 = 15,000.00');
select is((api.libro_dinero() -> 'totales' ->> 'abonos_cent')::bigint, 350000::bigint, 'abonos 2,500 + 1,000 = 3,500.00');
select is((api.libro_dinero() -> 'totales' ->> 'saldo_final_cent')::bigint, 1150000::bigint, 'saldo final 11,500.00');
select is((api.libro_dinero() -> 'movimientos' -> 1 ->> 'saldo_cent')::bigint, 750000::bigint, 'saldo corrido del segundo renglon: 10,000 - 2,500 = 7,500.00');
select is((api.libro_dinero() -> 'movimientos' -> 3 ->> 'saldo_cent')::bigint, 1150000::bigint, 'y el del ultimo coincide con el saldo final');
select is((api.libro_dinero(p_orden => 'desc') -> 'movimientos' -> 0 ->> 'saldo_cent')::bigint, 1150000::bigint, 'orden descendente: el primero es el ultimo saldo');
select is((api.libro_dinero(p_ini => negocio.hoy() - 15) -> 'totales' ->> 'saldo_inicial_cent')::bigint, 750000::bigint, 'con inicio posterior, el saldo inicial arrastra la historia (7,500.00)');
select is((api.libro_dinero(p_ini => negocio.hoy() - 15) -> 'movimientos' -> 0 ->> 'saldo_cent')::bigint, 1250000::bigint, 'y el primer renglon del periodo suma sobre ese saldo');
select is((api.libro_dinero(p_q => 'proveedor') -> 'totales' ->> 'n')::int, 1, 'busqueda por concepto');
select is((api.libro_dinero(p_min_cent => 400000) -> 'totales' ->> 'n')::int, 2, 'rango de montos: dos renglones de 4,000 o mas');
select is(jsonb_array_length(api.libro_dinero(p_limite => 2) -> 'movimientos'), 2, 'paginacion en servidor');
select is((api.libro_dinero(p_limite => 2) ->> 'total')::int, 4, 'con el total del filtro completo');
select is((api.libro_dinero() -> 'estados' -> 0 ->> 'n')::int, 4, 'estados: cuatro sin clasificar');
select throws_ok($$ select api.libro_dinero(p_estado => 'otro') $$, '22023', 'estado desconocido', 'estado invalido rechazado');

-- Caja y valuacion (con un asiento de aportacion para tener fondos) -----------------------------------------------------------------------
select operacion.registrar_aportacion('a2:ap', 'Angelo', 500000, 'Aportacion ilustrativa de prueba', 'capital');
select is((api.caja_resumen() ->> 'con_movimientos')::boolean, false, 'una aportacion de capital no mueve cuentas de fondos: la caja sigue sin movimientos');
select is(jsonb_array_length(api.caja_resumen() -> 'cuentas'), 4, 'cuatro cuentas de fondos');
select is((api.caja_resumen() ->> 'l01_liquidez_cent'), null, 'sin movimientos de fondos la liquidez L01 es Sin dato (null), nunca cero');
select is((api.conta_valuacion_detalle() -> 'valuacion' ->> 'v01_valuacion_cent')::bigint, (contabilidad.valuacion() ->> 'v01_valuacion_cent')::bigint, 'el desglose trae la misma valuacion que la funcion base');
select is((select coalesce(sum((m ->> 'valor_cent')::bigint), 0)::bigint from jsonb_array_elements(api.conta_valuacion_detalle() -> 'inventario_por_marca') m), (select coalesce(sum(valor_cent), 0)::bigint from operacion.existencia_modelo), 'inventario por marca suma el valor de existencia_modelo');
select ok(jsonb_array_length(api.conta_valuacion_serie(negocio.hoy() - 70, negocio.hoy(), 'mes') -> 'filas') >= 2, 'la serie mensual trae al menos dos cortes');
select is((api.conta_valuacion_serie(negocio.hoy() - 70, negocio.hoy(), 'mes') -> 'filas' -> 0 ->> 'crecimiento_bp'), null, 'el primer corte no tiene crecimiento (Sin dato)');
select is((api.conta_valuacion_serie(negocio.hoy() - 10, negocio.hoy(), 'semana') -> 'filas' -> -1 ->> 'corte')::date, negocio.hoy(), 'el ultimo corte es el de hoy');
select throws_ok($$ select api.conta_valuacion_serie(null, null, 'dia') $$, '22023', 'paso desconocido', 'paso invalido rechazado');

select * from finish();
rollback;
