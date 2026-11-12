-- pgTAP 907 (QA de punta a punta, H-06, H-07): flujo F07 de la matriz (renta de Omar y liquidacion semanal, semana 1-mar-2027 a 7-mar-2027,
-- corte el lunes 8-mar) con cifras a mano: renta (40 + 30) x 2.00 = 140.00; toma 3 x 150.00 = 450.00; neto -310.00; compensado 140.00.
-- Tambien: validaciones de tomas, semana ya liquidada (P0422), caducidad y vistas omar.* sin costos ni folios (CP09).
-- Los casos que hoy NO cumplen (tope de 15 piezas, toma autorizada despues del corte, anular en semana cerrada) estan en 990_pendientes_de_correccion.
-- ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N907".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n907.socio@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('98888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n907.socio@example.test');
select set_config('request.jwt.claim.sub', '98888888-8888-8888-8888-888888888888', true);

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('N907 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('N907 Omar Cliente', 'N907 Omar');
  end if;
end $$;
create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;

select catalogo.asegurar_cliente('N907 Cliente QA', 'Angelo');
select catalogo.asegurar_modelo('N907 Marca', 'N907 Modelo QA 50K', 50000, 'ambas');
select catalogo.asegurar_sku('N907 Modelo QA 50K', 'Fresa');
select catalogo.asegurar_sku('N907 Modelo QA 50K', 'Uva');
select catalogo.fijar_costo('n907c1', 'Isaac', 'N907 Modelo QA 50K', 10000, '2027-03-01', 'prueba');
select catalogo.fijar_precio('n907p1', 'N907 Cliente QA', 'N907 Modelo QA 50K', 15000, '2027-03-01', 'chat');
select operacion.registrar_movimiento('n907m1', 'N907 Modelo QA 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 100, 1022500, '2027-03-01');
select operacion.registrar_movimiento('n907m2', 'N907 Modelo QA 50K', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1022500, '2027-03-01');
create temp table _o0 as select operacion.saldo_omar_cuenta() as b;

-- 1. Semana vacia: neto 0.00 ----------------------------------------------------------------------------------------------------
select is((operacion.saldo_omar_semana('2027-03-01')->>'renta_cent')::bigint, 0::bigint, 'semana vacia: renta 0.00');
select is((operacion.saldo_omar_semana('2027-03-01')->>'tomas_cent')::bigint, 0::bigint, 'semana vacia: tomas 0.00');
select is((operacion.saldo_omar_semana('2027-03-01')->>'neto_cent')::bigint, 0::bigint, 'semana vacia: neto 0.00');
select is(operacion.semana_omar_ini('2027-03-05'), '2027-03-01'::date, 'semana_omar_ini: el viernes 5 pertenece a la semana del lunes 1');
select is(operacion.semana_omar_ini('2027-03-07'), '2027-03-01'::date, 'semana_omar_ini: el domingo 7 todavia es la semana del 1');
select is(operacion.semana_omar_ini('2027-03-08'), '2027-03-08'::date, 'semana_omar_ini: el lunes 8 abre otra semana');
select is(operacion.persona_bodega_id() is not null, true, 'persona_bodega_id: hay persona de bodega');

-- 2. Renta devengada al enviar: P-1 40 pz y P-2 30 pz ---------------------------------------------------------------------------------
select operacion.crear_pedido('n907a', pg_temp.cid('N907 Cliente QA'), '[{"modelo":"N907 Modelo QA 50K","sabor":"Fresa","piezas":40}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, '2027-03-01');
select operacion.confirmar_pedido('n907ac', pg_temp.pid('n907a'));
select is((operacion.enviar_pedido('n907as', pg_temp.pid('n907a'), null, null, '2027-03-01')->>'renta_cent')::bigint, 8000::bigint, 'P-1: renta 40 x 2.00 = 80.00');
select operacion.crear_pedido('n907b', pg_temp.cid('N907 Cliente QA'), '[{"modelo":"N907 Modelo QA 50K","sabor":"Uva","piezas":30}]'::jsonb, 'bodega_omar', null, 30000, 0, 0, '2027-03-02');
select operacion.confirmar_pedido('n907bc', pg_temp.pid('n907b'));
select is((operacion.enviar_pedido('n907bs', pg_temp.pid('n907b'), null, null, '2027-03-02')->>'renta_cent')::bigint, 6000::bigint, 'P-2: renta 30 x 2.00 = 60.00');
select is((operacion.saldo_omar_semana('2027-03-01')->>'renta_cent')::bigint, 14000::bigint, 'renta devengada de la semana: 140.00');
select is((select count(*)::int from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id in (pg_temp.pid('n907a'), pg_temp.pid('n907b'))), 2, 'un devengo por linea enviada');

-- 3. Toma de 3 piezas a 150.00 -----------------------------------------------------------------------------------------------------
select is((operacion.registrar_toma_omar('n907t1', '{"modelo":"N907 Modelo QA 50K","sabor":"Fresa"}'::jsonb, 3, 15000, '2027-03-02')->>'estado'), 'autorizada', 'la toma registrada por un socio se autoriza');
select is((operacion.saldo_omar_semana('2027-03-01')->>'tomas_cent')::bigint, 45000::bigint, 'tomas de la semana: 450.00');
select is((operacion.saldo_omar_semana('2027-03-01')->>'neto_cent')::bigint, -31000::bigint, 'neto -310.00: Omar debe 310.00');
select is((operacion.saldo_omar_semana('2027-03-01')->>'compensado_cent')::bigint, 14000::bigint, 'compensado = el menor de renta y tomas: 140.00');
select is((select count(*)::int from operacion.movimiento_inventario mi join catalogo.modelo m on m.id = mi.modelo_id where m.nombre_canonico = 'N907 Modelo QA 50K' and mi.tipo like 'salida%' and mi.cantidad = -3), 1, 'la toma saca 3 piezas del inventario');
select throws_ok($$select operacion.registrar_toma_omar('n907t0', '{"modelo":"N907 Modelo QA 50K","sabor":"Fresa"}'::jsonb, 0, 15000, '2027-03-02')$$, '23514', null, 'toma de 0 piezas se rechaza');
select throws_ok($$select operacion.registrar_toma_omar('n907t0b', '{"modelo":"N907 Modelo QA 50K","sabor":"Fresa"}'::jsonb, -2, 15000, '2027-03-02')$$, '23514', null, 'toma negativa se rechaza');
select throws_ok($$select operacion.registrar_toma_omar('n907t0c', '{"modelo":"N907 Modelo QA 50K","sabor":"Fresa"}'::jsonb, 1, 15000, '2027-03-02', 'radio')$$, '22023', null, 'via invalida');
select throws_ok($$select operacion.registrar_toma_omar('n907t1', '{"modelo":"N907 Modelo QA 50K","sabor":"Fresa"}'::jsonb, 4, 15000, '2027-03-02')$$, 'P0409', null, 'misma clave con otras piezas = 409');
-- Toma que pide Omar por Telegram: pendiente; autorizar la carga; rechazar la libera; no se resuelve dos veces
select is((operacion.registrar_toma_omar('n907t2', '{"modelo":"N907 Modelo QA 50K","sabor":"Uva"}'::jsonb, 2, 15000, '2027-03-03', 'telegram_omar')->>'estado'), 'pendiente', 'la toma que pide Omar nace pendiente');
select is((operacion.saldo_omar_semana('2027-03-01')->>'tomas_cent')::bigint, 45000::bigint, 'una toma pendiente todavia no se carga');
select throws_ok($$select operacion.cerrar_liquidacion_omar('n907l0', '2027-03-01', false, '2027-03-08')$$, 'P0428', null, 'CP02: no se cierra con tomas pendientes sin decision expresa');
select lives_ok($$select operacion.resolver_toma_omar('n907r1', (select id from operacion.toma_omar where folio = (select max(folio) from operacion.toma_omar where fecha_neg = '2027-03-03')), 'rechazar')$$, 'rechazar la toma pendiente');
select throws_ok($$select operacion.resolver_toma_omar('n907r2', (select id from operacion.toma_omar where fecha_neg = '2027-03-03' order by id desc limit 1), 'autorizar')$$, 'P0428', null, 'una toma rechazada no se autoriza despues');
select throws_ok($$select operacion.resolver_toma_omar('n907r3', 1, 'inventar')$$, '22023', null, 'accion invalida');

-- 4. Pago de Omar a los socios: 310.00 ----------------------------------------------------------------------------------------------
select throws_ok($$select operacion.registrar_pago_omar('n907po0', 0, 'de_omar', 'Javier')$$, '23514', null, 'pago de 0 se rechaza');
select throws_ok($$select operacion.registrar_pago_omar('n907po1', 100, 'rumbo_raro', 'Javier')$$, '22023', null, 'sentido invalido');
select throws_ok($$select operacion.registrar_pago_omar('n907po2', 100, 'a_omar')$$, '23502', null, 'pago a Omar sin indicar el socio');
select is((operacion.registrar_pago_omar('n907po3', 31000, 'de_omar', 'Javier', 'efectivo', '2027-03-04')->>'saldo_omar_cent')::bigint - (select b from _o0), 31000::bigint, 'Omar paga 310.00 antes de liquidar: la cuenta queda a su favor en 310.00 hasta el cierre');
select is((operacion.saldo_omar_semana('2027-03-01')->>'neto_cent')::bigint, -31000::bigint, 'el neto de la semana sigue siendo -310.00 (el pago va aparte)');

-- 5. Cierre el lunes 8-mar --------------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.cerrar_liquidacion_omar('n907l1', '2027-03-01', false, '2027-03-05')$$, 'P0428', null, 'antes del corte no se liquida');
select is((operacion.cerrar_liquidacion_omar('n907l2', '2027-03-01', false, '2027-03-08')->>'renta_cent')::bigint, 14000::bigint, 'liquidacion: renta 140.00');
select is((operacion.cerrar_liquidacion_omar('n907l2', '2027-03-01', false, '2027-03-08')->>'tomas_cent')::bigint, 45000::bigint, 'liquidacion: tomas 450.00');
select is((operacion.cerrar_liquidacion_omar('n907l2', '2027-03-01', false, '2027-03-08')->>'compensado_cent')::bigint, 14000::bigint, 'liquidacion: compensado 140.00');
select is((operacion.cerrar_liquidacion_omar('n907l2', '2027-03-01', false, '2027-03-08')->>'neto_cent')::bigint, -31000::bigint, 'liquidacion: neto -310.00');
select is((select count(*)::int from operacion.liquidacion_omar where semana_ini = '2027-03-01'), 1, 'una sola liquidacion tras repetir la clave');
select is(operacion.saldo_omar_cuenta() - (select b from _o0), 0::bigint, 'cerrada la liquidacion (-310.00) y pagados 310.00: saldo de Omar en cero');
select throws_ok($$select operacion.cerrar_liquidacion_omar('n907l3', '2027-03-01', false, '2027-03-08')$$, 'P0428', null, 'una semana no se liquida dos veces');
select throws_ok($$select operacion.registrar_toma_omar('n907t9', '{"modelo":"N907 Modelo QA 50K","sabor":"Fresa"}'::jsonb, 1, 15000, '2027-03-04')$$, 'P0422', null, 'semana liquidada: no admite tomas nuevas');
select throws_ok($$select operacion.exigir_semana_omar_abierta('2027-03-04')$$, 'P0422', null, 'exigir_semana_omar_abierta: cerrada');
select lives_ok($$select operacion.exigir_semana_omar_abierta('2027-03-09')$$, 'exigir_semana_omar_abierta: la semana siguiente sigue abierta');
select throws_ok($$select operacion.cerrar_liquidacion_omar('n907l4', '2027-03-02', false, '2027-03-08')$$, '22023', null, 'la semana de Omar empieza en lunes');

-- 6. Las vistas de Omar no exponen costos, folios ni utilidades (CP09) ----------------------------------------------------------------------
select is((select count(*)::int from information_schema.columns where table_schema = 'omar' and table_name in ('v_mercancia', 'v_mi_cuenta', 'v_mis_precios') and (column_name ~* 'costo|margen|utilidad|folio')), 0, 'omar.*: ninguna columna de costo, margen, utilidad ni folio');
select is((select count(*)::int from information_schema.columns where table_schema = 'omar' and table_name = 'v_mercancia' and column_name ~* 'valor'), 0, 'v_mercancia: sin valor del inventario');

select * from finish();
rollback;
