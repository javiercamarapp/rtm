-- pgTAP acta de corte: firma que recalcula (G5), reinversion como inversion del socio, candado de periodo y captura tardia (G7), traslape y exclusion (G19),
-- contra-acta, arrastre y regla de devolucion de capital eliminada (G20). Cifras del ejemplo de la adenda 21 (utilidad 12,000).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f16.angelo@example.test', 'socio', 'Angelo', true), ('f16.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a1666666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f16.angelo@example.test'),
  ('a1666666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f16.javier@example.test');
select set_config('request.jwt.claim.sub', 'a1666666-6666-6666-6666-666666666661', true);

create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'a1666666-6666-6666-6666-666666666661' else 'a1666666-6666-6666-6666-666666666662' end, true); end $$;
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
select catalogo.asegurar_cliente('F16 Cliente', 'Angelo');
select catalogo.asegurar_modelo('F16 Marca', 'F16 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('F16 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('f16cc', 'Isaac', 'F16 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('f16cp', 'F16 Cliente', 'F16 Modelo 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('f16pe', pg_temp.cid('F16 Cliente'), '[{"modelo":"F16 Modelo 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 372100, 0, 0, '2021-03-03');
select operacion.confirmar_pedido('f16pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f16pe'));
select operacion.enviar_pedido('f16pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'f16pe'), null, '{"paqueteria":"Castores","numero":"F16-G1","costo_cent":0}'::jsonb, '2021-03-03', true);
select operacion.registrar_pago('f16pg1', 'Angelo', 800000, pg_temp.cid('F16 Cliente'), null, true, 'abono', '2021-03-04');
select operacion.registrar_pago('f16pg2', 'Javier', 672100, pg_temp.cid('F16 Cliente'), null, true, 'abono', '2021-03-04');
select operacion.registrar_gasto_socio('f16g1', 'Angelo', 50000, 'envio', 'variable', '2021-03-04', null, 'Guia a Monterrey', 'Pague 500 de envio');
select operacion.registrar_gasto_socio('f16g2', 'Javier', 122100, 'costos del sistema', 'fijo', '2021-03-05', null, 'Suscripciones del mes');
select operacion.registrar_aportacion('f16a1', 'Javier', 100000, 'Deposito de Javier', 'reembolso', '2021-03-05');
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

-- G7: una captura con fecha dentro del periodo firmado no cambia ese periodo; se asienta hoy y se marca como ajuste tardio.
create temp table _g7 as select operacion.registrar_gasto_socio('a11', 'Angelo', 100000, 'reparacion', 'variable', '2021-03-05', null, 'Se descubrio despues') as r;
select is((select (r->>'tardio')::boolean from _g7), true, 'G7: la captura se marca como tardia');
select is((operacion.utilidad_periodo('2021-03-02', '2021-03-08')->>'utilidad_cent')::bigint, 1200000::bigint, 'G7: el periodo firmado no cambia');
select is((operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'ajustes_tardios_cent')::bigint, 100000::bigint, 'G7: el ajuste de 1,000.00 aparece en el siguiente corte');
select is((operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint, -100000::bigint, 'G7: y baja la utilidad del siguiente periodo');

-- G20: la regla de devolucion de capital ya no existe como parametro del cierre.
select throws_ok($$select operacion.proponer_cierre_reparto('a12', '2021-03-09', '2021-03-10', 0, false, 'x')$$, '42883', null, 'G20: el cierre ya no acepta devolver capital antes ni despues');

-- ---- Contra-acta ---------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.como('Angelo');
create temp table _ca as select operacion.contra_acta_reparto('c1', (select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1), 'Se capturo mal una venta') as r;
select is((select tipo from operacion.cierre_reparto where id = (select (r->>'cierre_id')::bigint from _ca)), 'contra', 'se propone una contra-acta');
select throws_ok($$select operacion.contra_acta_reparto('c2', (select id from operacion.cierre_reparto where tipo = 'periodo' order by id desc limit 1), 'otra')$$, 'P0428', null, 'un acta tiene una sola contra-acta');
select is((operacion.firmar_cierre_reparto('c3', (select (r->>'cierre_id')::bigint from _ca))->>'cerrado')::boolean, false, 'la contra-acta necesita las dos firmas');
select is(operacion.libro_socio(pg_temp.sid('Angelo'), 'utilidad_asignada'), 600000::bigint, 'mientras no la firmen los dos, el acta original sigue vigente');
select pg_temp.como('Javier');
select is((operacion.firmar_cierre_reparto('c4', (select (r->>'cierre_id')::bigint from _ca))->>'cerrado')::boolean, true, 'firmada por los dos, la contra-acta surte efecto');
select is(operacion.libro_socio(pg_temp.sid('Angelo'), 'utilidad_asignada'), 0::bigint, 'la utilidad asignada se deshace con renglones contrarios');
select is(operacion.aportacion_pendiente(pg_temp.sid('Javier')), 0::bigint, 'la reinversion se deshace');
select is(operacion.utilidad_por_distribuir(pg_temp.sid('Angelo')), 0::bigint, 'nada queda por distribuir');
select is(operacion.ultimo_cierre_firmado_fin(), null::date, 'el periodo vuelve a quedar abierto');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'fondos'), 672100::bigint, 'y las compensaciones regresan: Javier vuelve a tener 6,721.00 en su poder');
select is((select count(*)::int from operacion.cierre_reparto_firma f join operacion.cierre_reparto c on c.id = f.cierre_id where c.tipo = 'periodo' and c.periodo_ini = '2021-03-02'), 2, 'el acta original no se toco: conserva sus dos firmas');
select lives_ok($$select operacion.proponer_cierre_reparto('c5', '2021-03-02', '2021-03-08')$$, 'el periodo corregido se puede cerrar de nuevo');

-- Seguridad: la web (rol socio) lee actas y la posicion del dinero; sin intencion no se captura.
select is((select count(*)::int from jsonb_array_elements(api.cierres_reparto()) c where c->>'tipo' = 'contra' and c->>'estado' = 'cerrado'), 1, 'api.cierres_reparto muestra la contra-acta');
select ok(api.socios_dinero() ? 'efectivo', 'api.socios_dinero entrega el efectivo calculado');

select * from finish();
rollback;
