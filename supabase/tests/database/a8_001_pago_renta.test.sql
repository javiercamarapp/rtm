-- pgTAP: Pago de la renta de la bodega de Omar (migracion 20261114100000). Numeros calculados a mano.
--  * 10 envios del 1 al 10 de marzo de 2027, alternando 40 y 56 piezas (5 y 5): 480 piezas x 2.00 = 960.00 de renta (96000 centavos).
--  * Pago parcial de 400.00: por pagar 560.00. Exceso: 600.00 sin confirmar se rechaza; confirmado deja 40.00 a favor de Omar.
--  * Proyeccion al 11-mar (31 dias): ritmo 48 pz/dia, desviacion muestral sqrt(640/9) = 8.4327, 20 dias restantes: esperadas 960 pz, 960 +- 1.2816 x 8.4327 x sqrt(20) = 48.33 => 912 a 1008 pz.
--  * Muestra chica (3 dias cerrados) y sin historia: no se emite proyeccion.
-- Datos sinteticos "A8".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('a8.jav@example.test', 'socio', 'Javier', true), ('a8.ang@example.test', 'socio', 'Angelo', true), ('a8.omar@example.test', 'omar', null, true), ('a8.off@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a8.jav@example.test'),
  ('a8000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a8.omar@example.test'),
  ('a8000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a8.off@example.test'),
  ('a8000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a8.ang@example.test');
create function pg_temp.como(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', $1, true) $$;
select pg_temp.como('a8000000-0000-0000-0000-000000000001');

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('A8 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('A8 Omar Cliente', 'A8 Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('A8 Cliente', 'Angelo');
select catalogo.asegurar_modelo('A8 Marca', 'A8 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('A8 Modelo 30K', 'Mango');
select catalogo.fijar_costo('a8c1', 'Isaac', 'A8 Modelo 30K', 10000, '2027-01-01', 'prueba');
select catalogo.fijar_precio('a8p1', 'A8 Cliente', 'A8 Modelo 30K', 15000, '2027-01-01', 'chat');
select operacion.registrar_movimiento('a8m1', 'A8 Modelo 30K', 'Mango', 'bodega_omar', 'entrada_compra', 2000, 2000000, '2027-02-25');
create function pg_temp.pid(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

-- Sin envios: todo en cero y sin proyeccion.
select is((operacion.renta_estado('2027-03-11')->>'piezas')::bigint, 0::bigint, 'sin envios: 0 piezas');
select is((operacion.renta_estado('2027-03-11')->>'por_pagar_cent')::bigint, 0::bigint, 'sin envios: nada por pagar');
select is((operacion.renta_estado('2027-03-11')->>'tarifa_cent')::bigint, 200::bigint, 'tarifa vigente 2.00 por pieza');
select is(operacion.renta_proyeccion('2027-03-11', 0, 200)->>'motivo', 'sin_historia', 'sin envios: sin historia, no se proyecta');

-- Diez envios: 40, 56, 40, 56, ... = 480 piezas.
do $$
declare i int; v_pz int; v_f date;
begin
  for i in 1..10 loop
    v_pz := case when i % 2 = 1 then 40 else 56 end; v_f := date '2027-03-01' + (i - 1);
    perform operacion.crear_pedido('a8ped' || i, (select id from catalogo.cliente where nombre_canonico = 'A8 Cliente'),
      jsonb_build_array(jsonb_build_object('modelo', 'A8 Modelo 30K', 'sabor', 'Mango', 'piezas', v_pz)), 'bodega_omar', null, 0, 0, 0, v_f);
    perform operacion.confirmar_pedido('a8conf' || i, (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a8ped' || i));
    perform operacion.enviar_pedido('a8send' || i, (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a8ped' || i), null, null, v_f, true);
  end loop;
end $$;

select is((operacion.renta_estado('2027-03-11')->>'piezas')::bigint, 480::bigint, '480 piezas enviadas');
select is((operacion.renta_estado('2027-03-11')->>'devengado_cent')::bigint, 96000::bigint, '480 x 2.00 = 960.00 devengados');
select is((operacion.renta_estado('2027-03-11')->>'regla_exacta')::boolean, true, 'la regla piezas x tarifa explica el devengado');
select is((operacion.renta_estado('2027-03-11')->>'por_pagar_cent')::bigint, 96000::bigint, 'por pagar 960.00 sin pagos');
select is((operacion.renta_estado('2027-03-11')->>'mes_piezas')::bigint, 480::bigint, 'piezas del mes: 480');
select is((operacion.renta_estado('2027-03-11')->>'primer_envio')::date, '2027-03-01'::date, 'primer envio 1-mar');
select is(jsonb_array_length(operacion.renta_serie('2027-03-11', 366)), 10, 'serie: 10 dias con envio');
select is((operacion.renta_serie('2027-03-11', 366)->0->>'piezas')::int, 40, 'serie: primer dia 40 piezas');
select is(jsonb_array_length(operacion.renta_serie('2027-03-11', 5)), 4, 'ventana de 5 dias (7 al 11 de marzo): 4 dias con envio');

-- Proyeccion al 11-mar.
create temp table _py as select operacion.renta_proyeccion('2027-03-11', 96000, 200) as p;
select is((select p->>'emitida' from _py), 'true', 'muestra suficiente (10 dias con envio, 480 piezas): se emite');
select is((select p->>'etiqueta' from _py), 'Estimado', 'siempre Estimado');
select is((select (p->>'ritmo_diario_pz')::numeric from _py), 48.00, 'ritmo 48 pz/dia');
select is((select (p->>'dias_restantes')::int from _py), 20, '20 dias restantes del mes');
select is((select (p->'restantes_pz'->>'central')::bigint from _py), 960::bigint, 'esperadas 960 piezas');
select is((select (p->'restantes_pz'->>'bajo')::bigint from _py), 912::bigint, 'rango bajo 912 piezas');
select is((select (p->'restantes_pz'->>'alto')::bigint from _py), 1008::bigint, 'rango alto 1008 piezas');
select is((select (p->'mes_pz'->>'central')::bigint from _py), 1440::bigint, 'mes completo: 480 + 960 = 1440 piezas');
select is((select (p->'restante_renta_cent'->>'central')::bigint from _py), 192000::bigint, 'renta restante central 1920.00');
select is((select (p->'restante_renta_cent'->>'bajo')::bigint from _py), 182400::bigint, 'renta restante baja 1824.00');
select is((select (p->'restante_renta_cent'->>'alto')::bigint from _py), 201600::bigint, 'renta restante alta 2016.00');
select is((select (p->'pago_al_corte_cent'->>'central')::bigint from _py), 288000::bigint, 'pago al corte central 960.00 + 1920.00 = 2880.00');
-- Muestra chica: al 4-mar solo hay 3 dias cerrados (1 al 3): no se proyecta.
select is(operacion.renta_proyeccion('2027-03-04', 0, 200)->>'emitida', 'false', 'muestra chica: sin proyeccion');
select is(operacion.renta_proyeccion('2027-03-04', 0, 200)->>'motivo', 'muestra_chica', 'motivo: muestra chica');
select is((operacion.renta_proyeccion('2027-03-04', 0, 200)->'muestra'->>'dias_con_envio')::int, 3, 'la muestra dice cuantos dias hay');
select is(operacion.renta_proyeccion('2027-03-04', 0, 200) ? 'restantes_pz', false, 'y no trae cifras proyectadas');
select is(operacion.renta_proyeccion('2027-03-11', 96000, null)->>'motivo', 'sin_tarifa', 'sin tarifa: sin proyeccion');
select is(operacion.renta_proyeccion('2027-03-01', 0, 200)->>'motivo', 'sin_historia', 'antes del primer envio cerrado: sin historia');

-- Estado de resultados: la renta sale como renglon propio 6110.
select contabilidad.asentar_pendientes();
select is((select (l->>'monto_cent')::bigint from jsonb_array_elements(contabilidad.estado_resultados('2027-03-01', '2027-03-31')->'lineas') l where l->>'codigo' = '6110'), 96000::bigint, 'el estado de resultados trae 6110 Renta de bodega con 960.00');
select is((select l->>'nombre' from jsonb_array_elements(contabilidad.estado_resultados('2027-03-01', '2027-03-31')->'lineas') l where l->>'codigo' = '6110'), 'Renta de bodega (Omar)', 'con su propio nombre');
select is(contabilidad.saldo('2210'), 96000::bigint, 'pasivo con Omar (2210) = 960.00 antes de pagar');

-- Socio: panel y pagos.
set local role authenticated;
select is((api.pago_renta_panel('2027-03-11')->'estado'->>'por_pagar_cent')::bigint, 96000::bigint, 'api: por pagar 960.00');
select is(jsonb_array_length(api.pago_renta_panel('2027-03-11')->'pagos'), 0, 'api: sin pagos todavia');
select throws_ok($$select api.registrar_pago_renta('a8r0', 0)$$, '23514', null, 'pago de 0 se rechaza');
select throws_ok($$select api.registrar_pago_renta('a8r0b', -5)$$, '23514', null, 'pago negativo se rechaza');
select throws_ok($$select api.registrar_pago_renta('a8r0c', 100, 'Javier', 'cheque')$$, '22023', null, 'via invalida');
select throws_ok($$select api.registrar_pago_renta('a8r0d', 100, 'Javier', 'efectivo', current_date + 400)$$, '22023', null, 'fecha futura');
select throws_ok($$select api.registrar_pago_renta('a8r0e', 100, 'Nadie')$$, '23502', null, 'socio desconocido');
select is((api.registrar_pago_renta('a8r1', 40000, 'Javier', 'transferencia', null, 'abono de noviembre', 'SPEI-123')->>'saldo_despues_cent')::bigint, 56000::bigint, 'pago parcial de 400.00: por pagar 560.00');
select is((api.registrar_pago_renta('a8r1', 40000, 'Javier', 'transferencia', null, 'abono de noviembre', 'SPEI-123')->>'repetido')::boolean, true, 'misma clave y mismos datos: devuelve lo guardado');
select throws_ok($$select api.registrar_pago_renta('a8r1', 41000, 'Javier', 'transferencia', null, 'abono de noviembre', 'SPEI-123')$$, 'P0409', null, 'misma clave con otro monto: 409');
select is((api.pago_renta_panel('2027-03-11')->'estado'->>'pagado_cent')::bigint, 40000::bigint, 'pagado 400.00 (un solo pago pese al reenvio)');
select is((api.pago_renta_panel('2027-03-11')->'pagos'->0->>'nota'), 'abono de noviembre', 'el historial trae la nota');
select is((api.pago_renta_panel('2027-03-11')->'pagos'->0->>'comprobante'), 'SPEI-123', 'y el comprobante');
-- Exceso: 600.00 cuando se deben 560.00.
select throws_ok($$select api.registrar_pago_renta('a8r2', 60000, 'Javier')$$, 'P0428', null, 'un pago mayor que lo devengado no se registra sin confirmar');
select is((api.pago_renta_panel('2027-03-11')->'estado'->>'pagado_cent')::bigint, 40000::bigint, 'y el rechazo no dejo nada');
select is((api.registrar_pago_renta('a8r2', 60000, 'Javier', 'efectivo', null, null, null, true)->>'exceso_cent')::bigint, 4000::bigint, 'confirmado: el exceso es 40.00');
select is((api.pago_renta_panel('2027-03-11')->'estado'->>'a_favor_cent')::bigint, 4000::bigint, 'la cuenta queda 40.00 a favor de Omar');
select is((api.pago_renta_panel('2027-03-11')->'estado'->>'por_pagar_cent')::bigint, 0::bigint, 'y nada por pagar');
reset role;

-- Libro: el pasivo con Omar baja, el libro conciliado y las comprobaciones siguen verdes.
select contabilidad.asentar_pendientes();
select is(contabilidad.saldo('2210'), -4000::bigint, 'pasivo 2210: 960.00 - 1000.00 = -40.00 (a favor de Omar)');
select is(contabilidad.saldo('2210'), (operacion.renta_estado('2027-03-11')->>'saldo_cent')::bigint, 'el saldo del libro es el saldo de la pantalla (dos vias)');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, true, 'Libro conciliado');
select is((select coalesce(string_agg(c.codigo, ','), '') from contabilidad.comprobaciones() c where not c.ok and c.codigo <> 'C20'), '', 'ninguna comprobacion en rojo (C20 queda fuera: la entrada de inventario de la prueba sin compra es la diferencia de apertura 3990, no la renta)');
select is((select count(*)::int from operacion.pago_renta_detalle), 2, 'dos detalles de pago');
select throws_ok($$update operacion.pago_renta_detalle set nota = 'x'$$, null, null, 'el detalle es inmutable');

-- Omar: solo lo suyo.
select pg_temp.como('a8000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((omar.mi_pago_renta()->'estado'->>'piezas')::bigint, 480::bigint, 'Omar ve sus 480 piezas');
select is((omar.mi_pago_renta()->'estado'->>'devengado_cent')::bigint, 96000::bigint, 'Omar ve lo devengado');
select is((omar.mi_pago_renta()->'estado'->>'pagado_cent')::bigint, 100000::bigint, 'Omar ve lo pagado');
select is(jsonb_array_length(omar.mi_pago_renta()->'pagos'), 2, 'Omar ve sus dos pagos');
select is((select count(*)::int from jsonb_object_keys(omar.mi_pago_renta()->'pagos'->0)), 4, 'cada pago de Omar trae solo folio, fecha, monto y via');
select is((omar.mi_pago_renta()::text ~* '(Javier|Angelo|abono de noviembre|SPEI|nota|comprobante|socio|cliente|costo|margen|pedido|P-[0-9])'), false, 'nada de socios, notas, clientes, costos ni pedidos en lo de Omar');
select throws_ok($$select api.pago_renta_panel()$$, '42501', null, 'Omar no ejecuta la vista del socio');
select throws_ok($$select api.registrar_pago_renta('a8r9', 100, 'Javier')$$, '42501', null, 'Omar no registra pagos');
reset role;
select is((select count(*)::int from operacion.pago_omar where sentido = 'a_omar'), 2, 'el intento de Omar no dejo pagos');

-- Socio y extranos.
select pg_temp.como('a8000000-0000-0000-0000-000000000004');
set local role authenticated;
select throws_ok($$select omar.mi_pago_renta()$$, '42501', null, 'un socio no ejecuta la funcion de Omar');
select is((api.pago_renta_panel('2027-03-11')->'estado'->>'piezas')::bigint, 480::bigint, 'el otro socio ve lo mismo (un solo negocio)');
reset role;
select pg_temp.como('a8000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$select omar.mi_pago_renta()$$, '42501', null, 'Omar desactivado: sin acceso');
reset role;
select pg_temp.como('a8000000-0000-0000-0000-0000000000ff');
set local role authenticated;
select throws_ok($$select api.pago_renta_panel()$$, '42501', null, 'desconocido: sin acceso a la vista del socio');
select throws_ok($$select omar.mi_pago_renta()$$, '42501', null, 'desconocido: sin acceso a la de Omar');
select throws_ok($$select api.registrar_pago_renta('a8r8', 100, 'Javier')$$, '42501', null, 'desconocido: no registra pagos');
reset role;
set local role anon;
select throws_ok($$select api.pago_renta_panel()$$, '42501', null, 'anon: sin acceso (panel)');
select throws_ok($$select api.registrar_pago_renta('a8r7', 100, 'Javier')$$, '42501', null, 'anon: sin acceso (pago)');
select throws_ok($$select omar.mi_pago_renta()$$, '42501', null, 'anon: sin acceso (Omar)');
reset role;

-- Privilegios: nada para anon ni PUBLIC; las internas ni para authenticated.
select is(has_function_privilege('authenticated', 'api.pago_renta_panel(date)', 'execute'), true, 'authenticated ejecuta el panel');
select is(has_function_privilege('authenticated', 'api.registrar_pago_renta(text, bigint, text, text, date, text, text, boolean)', 'execute'), true, 'authenticated ejecuta el registro');
select is(has_function_privilege('authenticated', 'omar.mi_pago_renta()', 'execute'), true, 'authenticated ejecuta la de Omar');
select is(has_function_privilege('anon', 'api.pago_renta_panel(date)', 'execute'), false, 'anon no ejecuta el panel');
select is(has_function_privilege('anon', 'api.registrar_pago_renta(text, bigint, text, text, date, text, text, boolean)', 'execute'), false, 'anon no ejecuta el registro');
select is(has_function_privilege('anon', 'omar.mi_pago_renta()', 'execute'), false, 'anon no ejecuta la de Omar');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where a.grantee = 0 and a.privilege_type = 'EXECUTE' and ((n.nspname = 'operacion' and p.proname like 'renta\_%') or p.proname in ('pago_renta_panel', 'registrar_pago_renta', 'mi_pago_renta'))), 0, 'ninguna funcion nueva con EXECUTE para PUBLIC');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'operacion' and p.proname like 'renta\_%' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0, 'las funciones internas operacion.renta_* no se ejecutan desde la web');
select is(has_table_privilege('authenticated', 'operacion.pago_renta_detalle', 'select'), false, 'el detalle no se lee directo');

select * from finish();
rollback;
