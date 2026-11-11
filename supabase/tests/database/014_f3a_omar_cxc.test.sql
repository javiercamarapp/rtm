-- pgTAP F3a: cuenta con Omar (lectura para socios, casos G6, pendientes de autorizacion, vista de Omar cerrada), cuentas por cobrar completa (plazo, vencimiento,
-- recargo, concentracion, texto de cobro, recordatorios) y "Explicar este numero" de las cifras nuevas. Fechas de Omar en 2028 para no depender de datos previos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3a.omar.socio@example.test', 'socio', 'Javier', true), ('f3a.omar.omar@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('c3333333-3333-3333-3333-333333333331', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3a.omar.socio@example.test'),
  ('c3333333-3333-3333-3333-333333333332', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3a.omar.omar@example.test');
select set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333331', true);

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;

-- Punto de partida: lo que los socios deben se neutraliza dentro de la transaccion.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-014', '{}'::jsonb);
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;

-- Hay una persona de bodega (Omar Yacaman en la base real; aqui una de prueba si no existe).
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('F3 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('F3 Omar Cliente', 'F3 Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('F3 Cliente Omar Z', 'Angelo');
select catalogo.asegurar_modelo('F3 Marca', 'F3 Omar 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F3 Omar 30K', 'Sandia');
select catalogo.fijar_costo('f3oco', 'Isaac', 'F3 Omar 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f3ocp', 'F3 Cliente Omar Z', 'F3 Omar 30K', 15000, '2020-01-01', 'chat');
select operacion.registrar_movimiento('f3om1', 'F3 Omar 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 1500, 15000000, '2028-03-01');

-- ---- G6 desde la lectura de los socios --------------------------------------------------------------------------------------------------------------
-- Caso A: 300 pz x $2 = 600.00 contra 4 x $150 = 600.00: saldo cero.
select operacion.crear_pedido('f3o1', pg_temp.cid('F3 Cliente Omar Z'), '[{"modelo":"F3 Omar 30K","sabor":"Sandia","piezas":300}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2028-03-07');
select operacion.confirmar_pedido('f3o1c', pg_temp.pid('f3o1'));
select operacion.enviar_pedido('f3o1s', pg_temp.pid('f3o1'), null, null, '2028-03-07');
select operacion.registrar_toma_omar('f3t1', '{"modelo":"F3 Omar 30K","sabor":"Sandia"}'::jsonb, 4, 15000, '2028-03-08');
select is((api.omar_cuenta('2028-03-06')->>'renta_cent')::bigint, 60000::bigint, 'caso A: renta devengada 600.00');
select is((api.omar_cuenta('2028-03-06')->>'tomas_cent')::bigint, 60000::bigint, 'caso A: tomas a su precio 600.00');
select is((api.omar_cuenta('2028-03-06')->>'neto_cent')::bigint, 0::bigint, 'caso A: neto 0.00');
select is((api.omar_cuenta('2028-03-06')->>'palabra'), 'Saldo cero', 'caso A: la palabra es Saldo cero');
select is((api.omar_cuenta('2028-03-06')->'renta'->0->>'folio'), (select folio from operacion.pedido where id = pg_temp.pid('f3o1')), 'la renta se muestra por pedido con su folio');
select is((api.omar_cuenta('2028-03-06')->'renta'->0->>'sabores'), 'Sandia', 'y con el sabor surtido');
select is((api.omar_cuenta('2028-03-06')->>'puede_cerrar')::boolean, false, 'una semana que aun no termina frente a hoy no se puede cerrar desde la pantalla');
select is((api.omar_cuenta('2028-03-06')->'skus')::text like '%"F3 Omar 30K"%', true, 'el formulario de tomas trae la mercancia de su bodega con su precio');
select is((operacion.cerrar_liquidacion_omar('f3l1', '2028-03-06', false, '2028-03-13')->>'palabra'), 'Saldo cero', 'caso A se cierra el lunes con saldo cero');
select is((api.omar_cuenta('2028-03-13')->'liquidaciones'->0->>'palabra'), 'Saldo cero', 'y aparece en las liquidaciones cerradas');
-- Caso B: 220 pz x $2 = 440.00 contra 4 x $175 = 700.00: neto -260.00 (Omar debe 260.00).
select operacion.crear_pedido('f3o2', pg_temp.cid('F3 Cliente Omar Z'), '[{"modelo":"F3 Omar 30K","sabor":"Sandia","piezas":220}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2028-03-14');
select operacion.confirmar_pedido('f3o2c', pg_temp.pid('f3o2'));
select operacion.enviar_pedido('f3o2s', pg_temp.pid('f3o2'), null, null, '2028-03-14');
select operacion.registrar_toma_omar('f3t2', '{"modelo":"F3 Omar 30K","sabor":"Sandia"}'::jsonb, 4, 17500, '2028-03-15');
select is((api.omar_cuenta('2028-03-13')->>'neto_cent')::bigint, -26000::bigint, 'caso B: neto -260.00');
select is((api.omar_cuenta('2028-03-13')->>'palabra'), 'Omar debe', 'caso B: Omar debe');
-- Pendientes de autorizacion: separados, no cambian el saldo.
select is((operacion.registrar_toma_omar('f3t3', '{"modelo":"F3 Omar 30K","sabor":"Sandia"}'::jsonb, 2, 17500, '2028-03-16', 'telegram_omar')->>'estado'), 'pendiente', 'una toma que pide Omar nace pendiente');
select is((api.omar_cuenta('2028-03-13')->>'neto_cent')::bigint, -26000::bigint, 'la pendiente no cambia el saldo');
select is(jsonb_array_length(api.omar_cuenta('2028-03-13')->'pendientes'), 1, 'y aparece en pendientes de autorizacion');
select ok((api.omar_cuenta('2028-03-13')->'pendientes'->0->>'caduca_at') is not null, 'con su hora de caducidad');
select is(jsonb_array_length(api.omar_cuenta('2028-03-13')->'tomas'), 1, 'las tomas de la semana no incluyen la pendiente');
select operacion.resolver_toma_omar('f3t3r', (select id from operacion.toma_omar where folio = (select max(folio) from operacion.toma_omar where fecha_neg = '2028-03-16')), 'rechazar');
select is(jsonb_array_length(api.omar_cuenta('2028-03-13')->'pendientes'), 0, 'rechazada, ya no esta pendiente');
-- Toma sin precio: "Falta precio", no entra al saldo.
select catalogo.asegurar_modelo('F3 Marca', 'F3 Omar Sin Precio', 30000, 'ambas');
select catalogo.asegurar_sku('F3 Omar Sin Precio', 'Uva');
select operacion.registrar_movimiento('f3om2', 'F3 Omar Sin Precio', 'Uva', 'bodega_omar', 'entrada_compra', 10, 100000, '2028-03-01');
select operacion.registrar_toma_omar('f3t4', '{"modelo":"F3 Omar Sin Precio","sabor":"Uva"}'::jsonb, 2, null, '2028-03-16');
select is((api.omar_cuenta('2028-03-13')->>'neto_cent')::bigint, -26000::bigint, 'sin precio no entra al saldo');
select is((select bool_or((t->>'falta_precio')::boolean) from jsonb_array_elements(api.omar_cuenta('2028-03-13')->'tomas') t), true, 'y se marca Falta precio');
-- Caso C: 428 pz x $2 = 856.00 contra 4 x $150 = 600.00: neto +256.00 (le debemos).
select operacion.crear_pedido('f3o3', pg_temp.cid('F3 Cliente Omar Z'), '[{"modelo":"F3 Omar 30K","sabor":"Sandia","piezas":428}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2028-03-21');
select operacion.confirmar_pedido('f3o3c', pg_temp.pid('f3o3'));
select operacion.enviar_pedido('f3o3s', pg_temp.pid('f3o3'), null, null, '2028-03-21');
select operacion.registrar_toma_omar('f3t5', '{"modelo":"F3 Omar 30K","sabor":"Sandia"}'::jsonb, 4, 15000, '2028-03-22');
select is((api.omar_cuenta('2028-03-20')->>'neto_cent')::bigint, 25600::bigint, 'caso C: neto +256.00');
select is((api.omar_cuenta('2028-03-20')->>'palabra'), 'Le debemos', 'caso C: le debemos');
-- Un pedido directo de Isaac o Karen no genera renta.
select operacion.crear_pedido('f3o4', pg_temp.cid('F3 Cliente Omar Z'), '[{"modelo":"F3 Omar 30K","sabor":"Sandia","piezas":50}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2028-03-23');
select operacion.confirmar_pedido('f3o4c', pg_temp.pid('f3o4'));
select operacion.enviar_pedido('f3o4s', pg_temp.pid('f3o4'), null, null, '2028-03-23', true);
select is((api.omar_cuenta('2028-03-20')->>'renta_cent')::bigint, 85600::bigint, 'un pedido directo de Isaac no devenga renta');
-- Semana anterior sin cerrar.
select is((api.omar_cuenta('2028-03-20')->>'semana_anterior_sin_cerrar'), null, 'la semana anterior sin cerrar solo se avisa si ya termino frente a hoy');

-- Una semana ya terminada: se puede cerrar y, mientras no se cierre, la pantalla la avisa como semana anterior sin cerrar.
select catalogo.asegurar_modelo('F3 Marca', 'F3 Omar Pasado', 30000, 'ambas');
select catalogo.asegurar_sku('F3 Omar Pasado', 'Uva');
select catalogo.fijar_costo('f3ocp0', 'Isaac', 'F3 Omar Pasado', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f3ocp1', 'F3 Cliente Omar Z', 'F3 Omar Pasado', 15000, '2020-01-01', 'chat');
select operacion.registrar_movimiento('f3om3', 'F3 Omar Pasado', 'Uva', 'bodega_omar', 'entrada_compra', 100, 1000000, '2020-05-25');
select operacion.registrar_toma_omar('f3t6', '{"modelo":"F3 Omar Pasado","sabor":"Uva"}'::jsonb, 3, 15000, '2020-06-02');
select is((api.omar_cuenta('2020-06-01')->>'puede_cerrar')::boolean, true, 'la semana terminada se puede cerrar');
select is((api.omar_cuenta()->>'semana_anterior_sin_cerrar')::date, '2020-06-01'::date, 'y la pantalla avisa la semana anterior sin cerrar');
select is((operacion.cerrar_liquidacion_omar('f3l5', '2020-06-01')->>'palabra'), 'Omar debe', 'se cierra: la toma de 3 x $150 = 450.00 sin renta y Omar debe');
select is((api.omar_cuenta('2020-06-01')->>'puede_cerrar')::boolean, false, 'ya cerrada, no se cierra otra vez');
select is(api.omar_cuenta()->'semana_anterior_sin_cerrar', 'null'::jsonb, 'y deja de avisarse');

-- Vista de Omar: preparada pero cerrada.
select set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333331', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mi_cuenta), 0, 'socio: la vista de Omar no devuelve filas');
reset role;
select set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333332', true);
set local role authenticated;
select is((select count(*)::int from omar.v_mi_cuenta), 0, 'omar desactivado: la vista de su cuenta esta cerrada');
select throws_ok($$select api.omar_cuenta()$$, '42501', null, 'omar no lee la cuenta de los socios');
reset role;
update seguridad.usuario set activo = true where id = 'c3333333-3333-3333-3333-333333333332';
set local role authenticated;
select ok((select count(*)::int from omar.v_mi_cuenta where concepto = 'renta') >= 3, 'omar activo (simulado): ve su renta por pieza');
select ok((select count(*)::int from omar.v_mi_cuenta where concepto = 'toma') >= 3, 'y sus tomas a su precio');
select throws_ok($$select * from operacion.renta_devengo$$, '42501', null, 'omar activo: no toca las tablas');
select is((select count(*)::int from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'omar' and a.attnum > 0 and not a.attisdropped and a.attname ~* '(costo|margen|utilidad|precio_venta|cliente|proveedor)'), 0, 'lista negra: ningun nombre de columna prohibido en omar');
reset role;
select set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333331', true);

-- ---- Cuentas por cobrar completa -------------------------------------------------------------------------------------------------------------------
select catalogo.asegurar_cliente('F3 Cliente Cobro', 'Angelo');
select catalogo.fijar_precio('f3ccp', 'F3 Cliente Cobro', 'F3 Omar 30K', 20000, '2020-01-01', 'chat');
-- Pedido enviado hace 10 dias con plazo de 7: vencido hace 3 dias.
select operacion.crear_pedido('f3c1', pg_temp.cid('F3 Cliente Cobro'), '[{"modelo":"F3 Omar 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 0, 0, 0, negocio.hoy() - 10, null, 7);
select operacion.confirmar_pedido('f3c1c', pg_temp.pid('f3c1'));
select operacion.enviar_pedido('f3c1s', pg_temp.pid('f3c1'), null, null, negocio.hoy() - 10, true);
-- Otro, enviado ayer con plazo de 2: vence manana.
select operacion.crear_pedido('f3c2', pg_temp.cid('F3 Cliente Cobro'), '[{"modelo":"F3 Omar 30K","sabor":"Sandia","piezas":50}]'::jsonb, 'isaac_directo', null, 0, 0, 0, negocio.hoy() - 1, null, 2);
select operacion.confirmar_pedido('f3c2c', pg_temp.pid('f3c2'));
select operacion.enviar_pedido('f3c2s', pg_temp.pid('f3c2'), null, null, negocio.hoy() - 1, true);
create temp table _cx as select api.cuentas_por_cobrar() as d;
select is((select f->>'estado' from _cx, jsonb_array_elements(d->'filas') f where (f->>'pedido_id')::bigint = pg_temp.pid('f3c1')), 'vencido', 'con 10 dias y plazo de 7: vencido');
select is((select (f->>'dias_atraso')::int from _cx, jsonb_array_elements(d->'filas') f where (f->>'pedido_id')::bigint = pg_temp.pid('f3c1')), 3, 'tres dias de atraso');
select is((select f->>'estado' from _cx, jsonb_array_elements(d->'filas') f where (f->>'pedido_id')::bigint = pg_temp.pid('f3c2')), 'por_vencer', 'el que vence manana esta por vencer');
select is((select (f->>'vence')::date from _cx, jsonb_array_elements(d->'filas') f where (f->>'pedido_id')::bigint = pg_temp.pid('f3c1')), negocio.hoy() - 3, 'vencimiento = envio + plazo');
select is((select (c->>'saldo_cent')::bigint from _cx, jsonb_array_elements(d->'por_cliente') c where c->>'cliente' = 'F3 Cliente Cobro'), 3000000::bigint, 'concentracion por cliente: 20,000 + 10,000');
select is((select (c->>'vencido_cent')::bigint from _cx, jsonb_array_elements(d->'por_cliente') c where c->>'cliente' = 'F3 Cliente Cobro'), 2000000::bigint, 'y lo vencido por cliente: 20,000');
select is((select (d->'antiguedad_cent'->>'8_14')::bigint from _cx), 2000000::bigint, 'antiguedad: el de 10 dias cae en 8 a 14');
select is((select (f->>'recargo_sugerido_cent')::bigint from _cx, jsonb_array_elements(d->'filas') f where (f->>'pedido_id')::bigint = pg_temp.pid('f3c1')), 200000::bigint, 'recargo sugerido de 10 % sobre 20,000: 2,000');
-- Recargo: sale como correccion enlazada de la nota y sube el saldo.
select is((operacion.registrar_recargo_credito('f3rc1', pg_temp.pid('f3c1'))->>'recargo_cent')::bigint, 200000::bigint, 'recargo de 2,000.00');
select is(operacion.pedido_saldo(pg_temp.pid('f3c1')), 2200000::bigint, 'el saldo del pedido sube a 22,000.00');
select is((select count(*)::int from operacion.nota where pedido_id = pg_temp.pid('f3c1') and tipo = 'correccion'), 1, 'con una correccion enlazada de la nota');
select throws_ok($$select operacion.registrar_recargo_credito('f3rc2', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f3c1'))$$, 'P0428', null, 'no se aplica dos veces el mismo recargo');
select is((operacion.registrar_recargo_credito('f3rc3', pg_temp.pid('f3c1'), null, 150000, 'Acuerdo con el cliente')->>'recargo_cent')::bigint, 150000::bigint, 'o un monto acordado');
-- Texto de cobro para copiar y pegar.
select ok(position('vencido desde' in api.texto_cobro(pg_temp.cid('F3 Cliente Cobro'))->>'texto') > 0, 'texto de cobro: marca lo vencido');
select ok(position('Total por pagar' in api.texto_cobro(pg_temp.cid('F3 Cliente Cobro'))->>'texto') > 0, 'texto de cobro: total por pagar');
select catalogo.asegurar_cliente('F3 Cliente Sin Saldo', 'Javier');
select is(api.texto_cobro(pg_temp.cid('F3 Cliente Sin Saldo')) -> 'texto', 'null'::jsonb, 'sin saldo no hay texto de cobro');
-- Recordatorios y fondos en poder de un socio.
select operacion.registrar_pago('f3cp1', 'Angelo', 100000, pg_temp.cid('F3 Cliente Cobro'), null, true, 'abono', negocio.hoy() - 10);
select is((select (s->>'dias_fondos')::int from jsonb_array_elements(api.cuentas_por_cobrar()->'socios') s where s->>'socio' = 'Angelo'), 10, 'el dinero lleva 10 dias en poder de Angelo');
select is((select (s->>'alerta_fondos')::boolean from jsonb_array_elements(api.cuentas_por_cobrar()->'socios') s where s->>'socio' = 'Angelo'), true, 'alerta: mas de 7 dias sin entregar');
select is((operacion.emitir_recordatorios_cobro()->>'vencen_manana')::int >= 1, true, 'recordatorio del cobro que vence manana');
select is((select count(*)::int from operacion.aviso where codigo = 'cobranza_vence_manana' and entidad_id = pg_temp.pid('f3c2')), 1, 'NT-035: un aviso por pedido');
select operacion.emitir_recordatorios_cobro();
select is((select count(*)::int from operacion.aviso where codigo = 'cobranza_vence_manana' and entidad_id = pg_temp.pid('f3c2')), 1, 'emitir dos veces el mismo dia no duplica');
select is((select count(*)::int from operacion.aviso where codigo = 'fondos_en_poder_socio' and estado = 'abierta'), 1, 'NT-043: fondos de la sociedad en poder de un socio');
select operacion.registrar_entrega_socio('f3en1', 'Angelo', 100000, 'sociedad', null, 'fondos');
select is((select (s->>'alerta_fondos')::boolean from jsonb_array_elements(api.cuentas_por_cobrar()->'socios') s where s->>'socio' = 'Angelo'), false, 'al entregar, la alerta desaparece');

-- ---- Explicar este numero ---------------------------------------------------------------------------------------------------------------------------
select is((api.explicar_cifra('socio:neto:Angelo')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: posicion neta de un socio cuadra por dos vias');
select is((api.explicar_cifra('socios:diferencia')->'comprobacion'->>'via1_valor')::bigint, (operacion.cuenta_socios()->>'via1_cent')::bigint, 'explicar: diferencia entre socios');
select is((api.explicar_cifra('proveedor:falta:Isaac:2020-06-01:todo')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: falta por saldar con un proveedor');
select is((api.explicar_cifra('omar:neto:2028-03-20')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: neto con Omar de la semana');
select is((api.explicar_cifra('omar:neto:2028-03-20')->'comprobacion'->>'via2_valor')::bigint, 25600::bigint, 'explicar: renta menos tomas = 256.00');
select is((api.explicar_cifra('cascada:utilidad:2028-03-20:2028-03-26')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: utilidad del periodo');
select is((api.explicar_cifra('cascada:resultado:Angelo:2028-03-20:2028-03-26:0')->'comprobacion'->>'cuadra')::boolean, true, 'explicar: resultado de un socio en la cascada');
select is((api.explicar_cifra('proveedor:saldo:' || catalogo.proveedor_id('Isaac'))->'comprobacion'->>'cuadra')::boolean, true, 'las cifras de F2 se siguen explicando');
select throws_ok($$select api.explicar_cifra('cosa:rara')$$, '22023', null, 'una cifra desconocida se rechaza');

select * from finish();
rollback;
