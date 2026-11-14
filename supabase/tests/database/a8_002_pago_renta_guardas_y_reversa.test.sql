-- pgTAP: correcciones del verificador del Pago de renta (migracion 20261114100100). Cada caso FALLA sin su arreglo.
--  B1 api.registrar_pago_omar (a_omar) pasa por la misma guarda de exceso. B2 topes. B4 fecha. B3 reversa exacta. B6 acumulado del mes desde la base.
--  Escenario relativo al dia de negocio: envios de 100, 80 y 20 piezas en hoy-2, hoy-1 y hoy = 200 piezas x 2.00 = 400.00 (40000 centavos).
-- Datos sinteticos "A8B".
begin;
select no_plan();
select set_config('a8b.hoy', negocio.hoy()::text, true);
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a8b.jav@example.test', 'socio', 'Javier', true), ('a8b.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a8b00000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a8b.jav@example.test'),
  ('a8b00000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a8b.omar@example.test');
create function pg_temp.como(p text) returns void language sql as $$ select set_config('request.jwt.claim.sub', $1, true) $$;
select pg_temp.como('a8b00000-0000-0000-0000-000000000001');
create function pg_temp.folio(p bigint) returns text language sql security definer as $$ select folio from operacion.pago_omar where monto_cent = $1 $$;
create function pg_temp.hoy(p int default 0) returns date language sql as $$ select current_setting('a8b.hoy')::date + $1 $$;

do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('A8B Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('A8B Omar Cliente', 'A8B Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('A8B Cliente', 'Angelo');
select catalogo.asegurar_modelo('A8B Marca', 'A8B Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('A8B Modelo 30K', 'Mango');
select catalogo.fijar_costo('a8bc1', 'Isaac', 'A8B Modelo 30K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('a8bp1', 'A8B Cliente', 'A8B Modelo 30K', 15000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('a8bm1', 'A8B Modelo 30K', 'Mango', 'bodega_omar', 'entrada_compra', 1000, 1000000, pg_temp.hoy(-3));
do $$
declare i int; v_pz int[] := array[100, 80, 20];
begin
  for i in 1..3 loop
    perform operacion.crear_pedido('a8bped' || i, (select id from catalogo.cliente where nombre_canonico = 'A8B Cliente'),
      jsonb_build_array(jsonb_build_object('modelo', 'A8B Modelo 30K', 'sabor', 'Mango', 'piezas', v_pz[i])), 'bodega_omar', null, 0, 0, 0, current_setting('a8b.hoy')::date - 3 + i);
    perform operacion.confirmar_pedido('a8bconf' || i, (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a8bped' || i));
    perform operacion.enviar_pedido('a8bsend' || i, (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a8bped' || i), null, null, current_setting('a8b.hoy')::date - 3 + i, true);
  end loop;
end $$;
select is((operacion.renta_estado(pg_temp.hoy())->>'devengado_cent')::bigint, 40000::bigint, '200 piezas x 2.00 = 400.00 devengados');
create function pg_temp.por_pagar() returns bigint language sql as $$ select (operacion.renta_estado(negocio.hoy())->>'saldo_cent')::bigint $$;

-- B6: la renta acumulada del mes la entrega la base (por dia, sin sumar en el navegador).
select is((select (x->>'acum_mes_cent')::bigint from jsonb_array_elements(operacion.renta_serie(pg_temp.hoy(), 30)) x where (x->>'fecha')::date = pg_temp.hoy(-1)), 
          case when date_trunc('month', pg_temp.hoy(-2)) = date_trunc('month', pg_temp.hoy(-1)) then 36000 else 16000 end::bigint, 'acumulado del mes al dia anterior (100 + 80 piezas, o solo 80 si cambio el mes)');
select is((select (x->>'acum_mes_cent')::bigint from jsonb_array_elements(operacion.renta_serie(pg_temp.hoy(), 30)) x where (x->>'fecha')::date = pg_temp.hoy()),
          (select sum(monto_cent)::bigint from operacion.renta_devengo where devengada_fecha between date_trunc('month', pg_temp.hoy())::date and pg_temp.hoy()), 'acumulado del mes hoy = devengado del mes (consulta independiente)');

set local role authenticated;
-- B2: topes.
select throws_ok($$select api.registrar_pago_omar('b2a', 1000000001, 'a_omar', 'Javier', 'transferencia', null, null, 'auto', true)$$, '23514', null, 'B2: un pago de mas de 10,000,000.00 se rechaza (legado)');
select throws_ok($$select api.registrar_pago_renta('b2b', 1000000001, 'Javier', 'transferencia', null, null, null, true)$$, '23514', null, 'B2: tambien en el camino nuevo');
select throws_ok($$select api.registrar_pago_omar('b2c', 1000000001, 'de_omar', 'Javier')$$, '23514', null, 'B2: y los pagos de Omar a los socios');
select is((api.registrar_pago_renta('b2d', 1000000000, 'Javier', 'transferencia', null, null, null, true)->>'a_favor_cent')::bigint, 999960000::bigint, 'B2: el pago maximo de 10,000,000.00 con 400.00 de deuda deja 9,999,600.00 a favor');
select throws_ok($$select api.registrar_pago_renta('b2e', 100000, 'Javier', 'transferencia', null, null, null, true)$$, '23514', null, 'B2: otro anticipo que llevaria el saldo a favor sobre 10,000,000.00 se rechaza');
select is((api.anular_pago_renta('b2f', pg_temp.folio(1000000000), 'prueba del tope')->>'saldo_despues_cent')::bigint, 40000::bigint, 'B2: se anula el pago grande y vuelve a 400.00');
-- B1: el envoltorio preexistente tiene la guarda de exceso.
select throws_ok($$select api.registrar_pago_omar('b1a', 50000, 'a_omar', 'Javier')$$, 'P0428', null, 'B1: api.registrar_pago_omar rechaza 500.00 cuando se deben 400.00');
reset role;
select is(pg_temp.por_pagar(), 40000::bigint, 'B1: el rechazo no dejo nada: se siguen debiendo 400.00');
set local role authenticated;
select is((api.registrar_pago_omar('b1b', 50000, 'a_omar', 'Javier', 'transferencia', null, null, 'auto', true)->>'saldo_omar_cent')::bigint is not null, true, 'B1: con p_confirmo_exceso = true se registra');
reset role;
select is(pg_temp.por_pagar(), -10000::bigint, 'B1: queda 100.00 a favor de Omar');
-- Para seguir con cifras limpias se anula ese pago (tambien prueba B3 con exceso).
set local role authenticated;
select is((api.anular_pago_renta('b3x', pg_temp.folio(50000), 'prueba del anticipo')->>'saldo_despues_cent')::bigint, 40000::bigint, 'B3: anular el anticipo devuelve exactamente 400.00 por pagar');
reset role;

-- B4: fecha.
set local role authenticated;
select throws_ok(format($$select api.registrar_pago_renta('b4a', 100, 'Javier', 'efectivo', %L)$$, pg_temp.hoy(1)), '22023', null, 'B4: fecha futura');
select throws_ok(format($$select api.registrar_pago_renta('b4b', 100, 'Javier', 'efectivo', %L)$$, pg_temp.hoy(-401)), '22023', null, 'B4: de hace mas de 400 dias');
select throws_ok(format($$select api.registrar_pago_renta('b4c', 100, 'Javier', 'efectivo', %L)$$, pg_temp.hoy(-3)), '22023', null, 'B4: anterior al primer devengo (hoy-2)');
select throws_ok(format($$select api.registrar_pago_omar('b4d', 100, 'a_omar', 'Javier', 'efectivo', %L)$$, pg_temp.hoy(-3)), '22023', null, 'B4: lo mismo por el envoltorio preexistente');
select throws_ok(format($$select api.registrar_pago_omar('b4e', 100, 'a_omar', 'Javier', 'efectivo', %L)$$, pg_temp.hoy(1)), '22023', null, 'B4: y la fecha futura por el envoltorio preexistente');
reset role;

-- B3: reversa exacta. Estado previo del lado del socio.
create temp table _s0 as select operacion.saldo_socio((select id from catalogo.socio where nombre = 'Javier')) as saldo,
  (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio) as aport, (select coalesce(sum(monto_cent), 0) from operacion.cuenta_socio_mov) as csm,
  (select coalesce(sum(monto_cent), 0) from operacion.pago_omar where sentido = 'a_omar') as pagado;
set local role authenticated;
select is((api.registrar_pago_renta('b3a', 15000, 'Javier', 'transferencia', pg_temp.hoy(-2), 'abono', 'SPEI-9')->>'saldo_despues_cent')::bigint, 25000::bigint, 'pago de 150.00 (fecha = primer devengo): por pagar 250.00');
select is((api.registrar_pago_renta('b3b', 5000, 'Javier')->>'saldo_despues_cent')::bigint, 20000::bigint, 'otro de 50.00: por pagar 200.00');
select throws_ok($$select api.anular_pago_renta('b3c', pg_temp.folio(15000), '   ')$$, '23502', null, 'B3: el motivo es obligatorio');
select throws_ok($$select api.anular_pago_renta('b3d', 'PO-9999', 'no existe')$$, '22023', null, 'B3: folio desconocido');
select is((api.anular_pago_renta('b3e', pg_temp.folio(15000), 'capture mal el monto')->>'saldo_despues_cent')::bigint, 35000::bigint, 'B3: anular el de 150.00 deja 350.00 por pagar (400.00 - 50.00)');
select is((api.anular_pago_renta('b3e', pg_temp.folio(15000), 'capture mal el monto')->>'repetido')::boolean, true, 'B3: la misma clave devuelve lo guardado (idempotente)');
select throws_ok($$select api.anular_pago_renta('b3e', pg_temp.folio(15000), 'otro motivo')$$, 'P0409', null, 'B3: misma clave con otro motivo = 409');
select throws_ok($$select api.anular_pago_renta('b3f', pg_temp.folio(15000), 'otra vez')$$, 'P0428', null, 'B3: no se anula dos veces');
select throws_ok($$select api.anular_pago_renta('b3g', pg_temp.folio(-15000), 'anular la reversa')$$, 'P0428', null, 'B3: una reversa no se anula');
select is((api.pago_renta_panel()->'estado'->>'pagado_cent')::bigint, 5000::bigint, 'el panel: pagado 50.00 tras la reversa');
select is((select (x->>'anulado')::boolean from jsonb_array_elements(api.pago_renta_panel()->'pagos') x where (x->>'monto_cent')::bigint = 15000), true, 'el historial marca el original como anulado');
select is((select x->>'motivo_reversa' from jsonb_array_elements(api.pago_renta_panel()->'pagos') x where (x->>'monto_cent')::bigint = -15000), 'capture mal el monto', 'y la reversa trae su motivo');
reset role;
select is((select count(*)::int from operacion.pago_omar where monto_cent = 15000), 1, 'B3: el pago original sigue en su lugar (no se borra ni se edita)');
select is((select count(*)::int from operacion.pago_omar where reversa_de = (select id from operacion.pago_omar where monto_cent = 15000)), 1, 'y hay exactamente un contra-pago enlazado');
select throws_ok($$update operacion.pago_omar set monto_cent = 1 where monto_cent = 15000$$, null, null, 'el original es inmutable');
select throws_ok($$insert into operacion.pago_omar (folio, fecha_neg, monto_cent, sentido, evento_id) values ('PO-X', current_date, -5, 'a_omar', (select min(id) from operacion.evento))$$, '23514', null, 'un monto negativo sin enlace al original no entra');
-- Anular el de 50.00 tambien: el estado del socio vuelve EXACTO al previo.
set local role authenticated;
select lives_ok($$select api.anular_pago_renta('b3h', pg_temp.folio(5000), 'prueba de ida y vuelta')$$, 'se anula el de 50.00');
reset role;
select is(pg_temp.por_pagar(), 40000::bigint, 'B3: por pagar vuelve exacto a 400.00');
select is((select saldo from _s0), operacion.saldo_socio((select id from catalogo.socio where nombre = 'Javier')), 'B3: el saldo del socio vuelve exacto');
select is((select aport from _s0), (select coalesce(sum(monto_cent), 0) from operacion.aportacion_socio), 'B3: las aportaciones vuelven a su suma previa');
select is((select csm from _s0), (select coalesce(sum(monto_cent), 0) from operacion.cuenta_socio_mov), 'B3: la cuenta del socio vuelve a su suma previa');
select is((select pagado from _s0), (select coalesce(sum(monto_cent), 0) from operacion.pago_omar where sentido = 'a_omar'), 'B3: lo pagado a Omar vuelve a su suma previa');
select contabilidad.asentar_pendientes();
select is(contabilidad.saldo('2210'), 40000::bigint, 'B3: la cuenta 2210 del libro vuelve exacta a 400.00 (dos vias: libro = pantalla)');
select is(contabilidad.saldo('2210'), pg_temp.por_pagar(), 'y es el por pagar de la pantalla');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, true, 'Libro conciliado tras anular');
select is((select coalesce(string_agg(c.codigo, ','), '') from contabilidad.comprobaciones() c where not c.ok and c.codigo <> 'C20'), '', 'ninguna comprobacion en rojo tras anular (C20 es la entrada de inventario de la prueba)');
select is((select count(*)::int from operacion.evento where tipo = 'anular_pago_renta'), 4, 'cada anulacion deja su evento de auditoria');
select is((select count(*)::int from operacion.evento where tipo = 'anular_pago_renta' and motivo_reversa is not null and actor_id is not null), 4, 'con su motivo y quien la hizo');

-- Roles.
select pg_temp.como('a8b00000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$select api.anular_pago_renta('b3z', 'PO-0001', 'x')$$, '42501', null, 'Omar no anula pagos');
select throws_ok($$select api.registrar_pago_omar('b3y', 100, 'a_omar', 'Javier')$$, '42501', null, 'Omar no registra pagos por el envoltorio');
select is((select count(*)::int from jsonb_object_keys(omar.mi_pago_renta()->'pagos'->0)), 6, 'Omar ve folio, fecha, monto, via y las marcas de reversa, sin motivo');
reset role;
set local role anon;
select throws_ok($$select api.anular_pago_renta('b3w', 'PO-0001', 'x')$$, '42501', null, 'anon no anula');
reset role;
select is(has_function_privilege('anon', 'api.anular_pago_renta(text, text, text)', 'execute'), false, 'anon sin EXECUTE en anular');
select is(has_function_privilege('authenticated', 'operacion.validar_pago_renta(bigint, date, boolean)', 'execute'), false, 'la guarda interna no se ejecuta desde la web');
select is(has_function_privilege('anon', 'api.registrar_pago_omar(text, bigint, text, text, text, date, bigint, text, boolean)', 'execute'), false, 'anon sin EXECUTE en el envoltorio');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE' and p.proname in ('anular_pago_renta', 'validar_pago_renta', 'registrar_pago_omar') and n.nspname in ('api', 'operacion')), 0, 'ninguna con EXECUTE para PUBLIC');

select * from finish();
rollback;
