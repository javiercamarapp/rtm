-- pgTAP 028 (historial y sello). Base: escenario del acta de 016. Original: acta de corte: firma que recalcula (G5), reinversion como inversion del socio, candado de periodo y captura tardia (G7), traslape y exclusion (G19),
-- contra-acta, arrastre y regla de devolucion de capital eliminada (G20). Cifras del ejemplo de la adenda 21 (utilidad 12,000).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('h28.angelo@example.test', 'socio', 'Angelo', true), ('h28.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('b2866666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h28.angelo@example.test'),
  ('b2866666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'h28.javier@example.test');
select set_config('request.jwt.claim.sub', 'b2866666-6666-6666-6666-666666666661', true);

create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'b2866666-6666-6666-6666-666666666661' else 'b2866666-6666-6666-6666-666666666662' end, true); end $$;
create function pg_temp.ult() returns bigint language sql as $$ select id from operacion.cierre_reparto order by id desc limit 1 $$;

-- Punto de partida limpio.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-016', '{}'::jsonb);
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_reembolso', -operacion.aportado_socio(s.id, 'reembolsable') - operacion.libro_socio(s.id, 'pago_reembolso'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'reembolsable') + operacion.libro_socio(s.id, 'pago_reembolso') <> 0;
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_devolucion_aportacion', -operacion.aportado_socio(s.id, 'capital') - operacion.libro_socio(s.id, 'pago_devolucion_aportacion'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'capital') + operacion.libro_socio(s.id, 'pago_devolucion_aportacion') <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select c.id, negocio.hoy(), 'ajuste_conteo', -operacion.saldo_efectivo(c.id), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from operacion.cuenta_efectivo c where operacion.saldo_efectivo(c.id) <> 0;

-- Semana del 2 al 8 de marzo de 2021: pedido de 23,721.00 (utilidad 13,721.00), gastos de Angelo 500.00 y de Javier 1,221.00, y 1,000.00 que Javier deposito como reembolso.
select catalogo.asegurar_cliente('H28 Cliente', 'Angelo');
select catalogo.asegurar_modelo('H28 Marca', 'H28 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('H28 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('h28cc', 'Isaac', 'H28 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('h28cp', 'H28 Cliente', 'H28 Modelo 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('h28pe', pg_temp.cid('H28 Cliente'), '[{"modelo":"H28 Modelo 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 372100, 0, 0, '2021-03-03');
select operacion.confirmar_pedido('h28pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'h28pe'));
select operacion.enviar_pedido('h28pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'h28pe'), null, '{"paqueteria":"Castores","numero":"H28-G1","costo_cent":0}'::jsonb, '2021-03-03', true);
select operacion.registrar_pago('h28pg1', 'Angelo', 800000, pg_temp.cid('H28 Cliente'), null, true, 'abono', '2021-03-04');
select operacion.registrar_pago('h28pg2', 'Javier', 672100, pg_temp.cid('H28 Cliente'), null, true, 'abono', '2021-03-04');
select operacion.registrar_gasto_socio('h28g1', 'Angelo', 50000, 'envio', 'variable', '2021-03-04', null, 'Guia a Monterrey', 'Pague 500 de envio');
select operacion.registrar_gasto_socio('h28g2', 'Javier', 122100, 'costos del sistema', 'fijo', '2021-03-05', null, 'Suscripciones del mes');
select operacion.registrar_aportacion('h28a1', 'Javier', 100000, 'Deposito de Javier', 'reembolso', '2021-03-05');
select is((operacion.utilidad_periodo('2021-03-02', '2021-03-08')->>'utilidad_cent')::bigint, 1200000::bigint, 'utilidad neta del periodo 12,000.00');
select is(operacion.reembolso_pendiente(pg_temp.sid('Javier')), 222100::bigint, 'a Javier se le deben 2,221.00 (1,221 de gasto + 1,000 de deposito)');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 50000::bigint, 'a Angelo se le deben 500.00');
create temp table _vivo as select operacion.cascada_periodo('2021-03-02', '2021-03-08') as c;
select is((select (c->'efectivo'->>'caja_cent')::bigint from _vivo), 100000::bigint, 'el efectivo de la caja sale del libro: 1,000.00 depositados');
select is((select (c->>'repartible_cent')::bigint from _vivo), 1200000::bigint, 'repartible 12,000.00');
select is((select (c->'por_socio'->'Angelo'->>'resultado_cent')::bigint from _vivo), -150000::bigint, 'Angelo devuelve 1,500.00');
select is((select (c->'por_socio'->'Javier'->>'resultado_cent')::bigint from _vivo), 150000::bigint, 'Javier recibe 1,500.00');
select is((select (c->>'identidad_cuadra')::boolean from _vivo), true, 'la identidad cuadra por dos vias');

-- ---- Propuesta con decisiones y G5: la firma recalcula ------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.proponer_cierre_reparto('a0', '2021-03-02', '2021-03-08', '{"Angelo":{"retira":600000,"reinvierte":100000}}')$$, '23514', null, 'la decision no excede la parte disponible del socio');
select throws_ok($$select operacion.proponer_cierre_reparto('a0b', '2021-03-02', current_date)$$, 'P0428', null, 'el periodo debe haber terminado');
create temp table _p1 as select operacion.proponer_cierre_reparto('a1', '2021-03-02', '2021-03-08', '{"Angelo":{"retira":400000,"reinvierte":200000},"Javier":{"retira":0,"reinvierte":600000}}') as r;
select is((select r->'decisiones'->'Javier'->>'reinvierte' from _p1), '600000', 'Javier decide reinvertir 6,000.00');
select throws_ok($$select operacion.proponer_cierre_reparto('a2', '2021-03-05', '2021-03-10')$$, 'P0428', null, 'G19: no se traslapan dos actas');
select ok(exists (select 1 from pg_constraint where conrelid = 'operacion.cierre_periodo_vigente'::regclass and contype = 'x'), 'G19: el traslape de periodos lo impide tambien una restriccion de exclusion de la base');
-- Entre la propuesta y la firma Angelo registra un pago de reembolso de 500.00: la foto de la propuesta ya no vale (H5).
select operacion.registrar_pago_a_socio('a3', 'Angelo', 50000, 'reembolso');
select throws_ok($$select operacion.firmar_cierre_reparto('a4', pg_temp.ult())$$, 'P0428', null, 'G5: no se firma una foto vieja; las cifras cambiaron');
select is((select count(*)::int from operacion.cierre_reparto_firma where cierre_id = pg_temp.ult()), 0, 'G5: no quedo ninguna firma');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), 0::bigint, 'G5: el reembolso pendiente no se sobrepaga ni se oculta');
select lives_ok($$select operacion.anular_cierre_reparto('a5', pg_temp.ult(), 'cambio un pago')$$, 'se anula el acta con cifras viejas');
select lives_ok($$select operacion.proponer_cierre_reparto('a6', '2021-03-02', '2021-03-08', '{"Angelo":{"retira":400000,"reinvierte":200000},"Javier":{"retira":0,"reinvierte":600000}}')$$, 'y se propone de nuevo con las cifras de hoy');

-- ---- Firma de los dos ----------------------------------------------------------------------------------------------------------------------------------------
select is((operacion.firmar_cierre_reparto('a7', pg_temp.ult())->>'cerrado')::boolean, false, 'una firma no cierra');
select is((select count(*)::int from operacion.socio_libro where cierre_id is not null), 0, 'proponer y firmar una vez no asienta nada');
select throws_ok($$select operacion.firmar_cierre_reparto('a7b', pg_temp.ult())$$, 'P0428', null, 'el mismo socio no firma dos veces');
select pg_temp.como('Javier');
select is((operacion.firmar_cierre_reparto('a8', pg_temp.ult())->>'cerrado')::boolean, true, 'con las dos firmas el acta surte efecto');
select is(operacion.libro_socio(pg_temp.sid('Angelo'), 'utilidad_asignada'), 600000::bigint, 'utilidad 50/50 asignada a Angelo: 6,000.00');
select is(operacion.libro_socio(pg_temp.sid('Javier'), 'utilidad_asignada'), 600000::bigint, 'utilidad 50/50 asignada a Javier: 6,000.00');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 600000::bigint, 'la reinversion de Javier queda como inversion suya (capital) de 6,000.00');
select is(operacion.aportacion_pendiente(pg_temp.sid('Angelo')), 200000::bigint, 'la reinversion de Angelo queda como inversion suya de 2,000.00');
select is(operacion.utilidad_por_distribuir(pg_temp.sid('Angelo')), 400000::bigint, 'a Angelo le quedan 4,000.00 por distribuir (lo que retira)');
select is(operacion.utilidad_por_distribuir(pg_temp.sid('Javier')), 0::bigint, 'a Javier no le queda utilidad por distribuir');
select is(operacion.arrastre_actual(), 0::bigint, 'se reparte todo: no hay utilidad retenida ni perdida por arrastrar');
select throws_ok($$select operacion.anular_cierre_reparto('a9', pg_temp.ult(), 'ya no')$$, 'P0428', null, 'un acta firmada por los dos no se anula: se corrige con contra-acta');
select throws_ok($$select operacion.anular_movimiento_socio('a10', 'libro', (select id from operacion.socio_libro where cierre_id is not null order by id desc limit 1), 'no')$$, 'P0428', null, 'lo que viene de un acta no se deshace por separado');
select is(operacion.ultimo_cierre_firmado_fin(), '2021-03-08'::date, 'el candado de periodo cubre hasta el 8 de marzo');


-- ---- Historial y sello (028) -------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from operacion.acta_sello), 0, 'el sello diferido aun no corre dentro de la transaccion');
set constraints all immediate;
select is((select count(*)::int from operacion.acta_sello), 1, 'al cerrarse el acta con las dos firmas se toma el sello');
select throws_ok($$update operacion.acta_sello set huella = repeat('0', 64)$$, '42501', null, 'el sello es inmutable (update)');
select throws_ok($$delete from operacion.acta_sello$$, '42501', null, 'el sello es inmutable (delete)');
select is((select length(huella) from operacion.acta_sello), 64, 'huella sha256 de 64 hex');
select is((select (contenido->'por_socio'->'Javier'->>'invertido_cent')::bigint from operacion.acta_sello), 600000::bigint, 'el sello fija lo invertido por Javier tras la reinversion');
select is((select (contenido->'por_socio'->'Angelo'->>'por_distribuir_cent')::bigint from operacion.acta_sello), 400000::bigint, 'y lo que le queda por distribuir a Angelo');
select is((select (contenido->>'utilidad_cent')::bigint from operacion.acta_sello), 1200000::bigint, 'la utilidad del periodo en el sello');

select pg_temp.como('Angelo');
create temp table _h as select api.historial_socio('Angelo', '2021-03-31') as j;
select is((select j->'cabecera'->>'reinversion_cent' from _h), '200000', 'cabecera: reinversion de Angelo 2,000.00');
select is((select j->'cabecera'->>'invertido_cent' from _h), '200000', 'cabecera: invertido = aportaciones + reinversiones');
select is((select j->'cabecera'->>'utilidad_asignada_cent' from _h), '600000', 'cabecera: utilidad recibida 6,000.00');
select is((select j->'cabecera'->>'utilidad_por_distribuir_cent' from _h), '400000', 'cabecera: por distribuir 4,000.00');
select is((select j->'cabecera'->>'retirado_cent' from _h), '0', 'cabecera: aun no retira en efectivo');
select is((select j->>'con_historial' from _h), 'true', 'hay historial');
select is((select jsonb_array_length(j->'actas') from _h), 1, 'linea de tiempo: un acta');
select is((select j->'actas'->0->>'parte_cent' from _h), '600000', 'linea de tiempo: su parte 6,000.00');
select is((select j->'actas'->0->>'retira_cent' from _h), '400000', 'linea de tiempo: retira 4,000.00');
select is((select j->'actas'->0->>'estado' from _h), 'cerrado', 'linea de tiempo: acta cerrada');
select is((select jsonb_array_length(j->'actas'->0->'firmas') from _h), 2, 'linea de tiempo: firmas de los dos');
select is((select j->'actas'->0->>'huella' from _h) = (select huella from operacion.acta_sello), true, 'la linea de tiempo trae la huella del sello');
select is((select j->'totales'->>'utilidad_cent' from _h), '1200000', 'totales: utilidad de la empresa 12,000.00');
select is((select j->'totales'->>'parte_cent' from _h), '600000', 'totales: su 50 % atribuido');
select is((select j->'totales'->>'piezas' from _h), '100', 'totales: 100 piezas');
select is((select (j->'meses'->-1->>'utilidad_cent') from _h), '1200000', 'el mes de marzo concentra la utilidad');
select is((select sum((x->>'parte_cent')::bigint)::text from _h, jsonb_array_elements(j->'meses') x), '600000', 'la suma mensual de su parte es el 50 %');
select is((select sum((x->>'utilidad_cent')::bigint)::text from _h, jsonb_array_elements(j->'dias') x), '1200000', 'la suma diaria de la utilidad cuadra con la mensual');
select is((select j->'por_cliente'->0->>'cliente' from _h), 'H28 Cliente', 'por cliente');
select is((select j->'por_modelo'->0->>'utilidad_cent' from _h), '1000000', 'por modelo: venta menos costo 10,000.00');
select is((select jsonb_array_length(j->'flujos') from _h), 0, 'sin aportaciones declaradas ni retiros no hay flujos');

-- Valuacion personal: una sola cifra por socio y la suma de los dos es SIEMPRE el capital contable (sin centavo perdido), con o sin utilidad sin acta.
select is((select sum(operacion.valor_socio(n, 5000001, 0))::bigint from (values ('Angelo'), ('Javier')) v(n)), 5000001::bigint, 'valor personal: la suma de los dos socios es el capital contable (impar)');
select is((select sum(operacion.valor_socio(n, -7, 0))::bigint from (values ('Angelo'), ('Javier')) v(n)), -7::bigint, 'valor personal: tambien con capital contable negativo');
select is(operacion.valor_socio('Angelo', operacion.capital_socio(pg_temp.sid('Angelo')) + operacion.capital_socio(pg_temp.sid('Javier')), 0), operacion.capital_socio(pg_temp.sid('Angelo')),
  'valor personal: sin utilidad sin acta es su cuenta de capital, no la mitad plana');
select isnt(operacion.valor_socio('Angelo', 1000000, 0), operacion.valor_socio('Javier', 1000000, 0), 'valor personal: no es plano 50/50 cuando las cuentas de capital difieren');
select is((select (j->'cabecera'->>'cuenta_cent')::bigint from _h), operacion.reembolso_pendiente(pg_temp.sid('Angelo')) - operacion.saldo_socio(pg_temp.sid('Angelo')), 'cabecera: deuda o credito = reembolsos por cobrar menos fondos en su poder');
select is((select (j->'cabecera'->>'neto_cent')::bigint from _h), (select (j->'cabecera'->>'capital_cuenta_cent')::bigint + (j->'cabecera'->>'cuenta_cent')::bigint from _h), 'cabecera: posicion neta = cuenta de capital + deuda o credito');
select is((select (j->'cabecera'->'comprobaciones'->>'cuenta')::boolean from _h), true, 'cabecera: la comprobacion de la cuenta sale de las dos vias reales');

-- Misma cifra, dos vias: explicar.
select is((api.explicar_historial('historial:parte:' || (select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1) || ':Angelo')->'comprobacion'->>'cuadra')::boolean, true, 'explicar parte: cuadra');
select is((api.explicar_historial('historial:invertido:Angelo')->'comprobacion'->>'cuadra')::boolean, true, 'explicar invertido: cuadra');
select is((api.explicar_historial('historial:utilidad:Angelo')->>'valor')::bigint, 600000::bigint, 'explicar utilidad recibida');
select is((api.explicar_historial('historial:cuenta:Javier')->'comprobacion'->>'cuadra')::boolean, true, 'explicar cuenta: cuadra');
select is((api.explicar_historial('historial:retirado:Angelo')->'comprobacion'->>'cuadra')::boolean, true, 'explicar retirado: cuadra');
select throws_ok($$select api.explicar_historial('historial:otra:Angelo')$$, '22023', null, 'cifra desconocida rechazada');

-- Detalle y periodo sugerido.
select is((api.acta_detalle((select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1))->'sello'->>'huella') = (select huella from operacion.acta_sello), true, 'acta_detalle trae el sello');
select is((api.acta_detalle((select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1))->'por_socio_acta'->'Angelo'->>'disponible_cent'), '600000', 'acta_detalle: disponible de Angelo lo calcula la base');
select is((api.acta_detalle((select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1))->'por_socio_acta'->'Angelo'->>'queda_cent'), '0', 'acta_detalle: queda por distribuir tras retirar 4,000 y reinvertir 2,000');
select is((api.acta_detalle((select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1))->'por_socio_acta'->'Javier'->>'queda_cent'), '0', 'acta_detalle: Javier reinvierte todo, no queda nada');
select is(has_function_privilege('anon', 'api.acta_disponible(date, date)', 'execute'), false, 'anon no ejecuta el disponible del acta');
select is(api.acta_detalle(-1), null::jsonb, 'acta inexistente: nulo');
select is((api.acta_periodo_sugerido()->>'ini')::date, '2021-03-09'::date, 'el siguiente corte empieza el dia despues del ultimo');
select is((api.acta_periodo_sugerido()->>'fin')::date, '2021-03-31'::date, 'y termina al fin de mes');
select is((api.acta_periodo_sugerido()->>'listo')::boolean, true, 'el mes ya termino: se puede proponer');

-- Rechazos y permisos.
select throws_ok($$select api.historial_socio('Omar')$$, '22023', null, 'solo hay historial de socios');
select is(has_function_privilege('anon', 'api.historial_socio(text, date)', 'execute'), false, 'anon no ejecuta el historial');
select is(has_function_privilege('anon', 'api.acta_detalle(bigint)', 'execute'), false, 'anon no ejecuta el detalle del acta');
select is(has_function_privilege('authenticated', 'operacion.historial_socio(text, date)', 'execute'), false, 'las funciones internas no son ejecutables desde la web');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select throws_ok($$select api.historial_socio('Angelo')$$, null, null, 'sin sesion de socio se rechaza');

select * from finish();
rollback;
