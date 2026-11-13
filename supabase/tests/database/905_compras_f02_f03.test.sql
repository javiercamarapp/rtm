-- pgTAP 905 (QA de punta a punta, H-03, H-07): flujo F02 (compra a Isaac con cuenta) y F03 (recepcion e inventario) con cifras a mano:
-- 200 pz x 100.00 + guia 450.00 pagada por Angelo -> cargo 20,000.00, costo puesto 102.25, aportacion reembolsable 450.00;
-- registrar_guia_compra, resolver_sku, recepcion faltante de 2 pz = 200.00 al costo de la orden, anular OC, Karen sin saldo (P0424).
-- ESPERADO-FALLA-HASTA para GD-16/17/18: ver 990_pendientes_de_correccion. ESCRITA SIN EJECUTAR (sin Docker). Datos "N905".
begin;
select no_plan();
-- Las pruebas fechan sus operaciones antes del 10-nov-2026 (inicio de vigencia de la configuracion sembrada): se adelanta la vigencia dentro de la transaccion.
update catalogo.config set vigente_desde = '2026-10-01' where vigente_desde = '2026-11-10';

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n905.socio@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('97777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n905.socio@example.test');
select set_config('request.jwt.claim.sub', '97777777-7777-7777-7777-777777777777', true);

select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-905', '{}'::jsonb);
insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select p.id, negocio.hoy(), 'ajuste', -operacion.saldo_proveedor(p.id), 'neutraliza para la prueba', (select max(id) from operacion.evento) from catalogo.proveedor p where operacion.saldo_proveedor(p.id) <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;

create function pg_temp.cid(p_clave text) returns bigint language sql as $$ select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.saldo(p text) returns bigint language sql as $$ select operacion.saldo_proveedor(catalogo.proveedor_id($1)) $$;
create function pg_temp.piezas(p_modelo text) returns int language sql as $$ select coalesce((select e.piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0) $$;
create function pg_temp.valor(p_modelo text) returns bigint language sql as $$ select coalesce((select e.valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0) $$;
create function pg_temp.linea(p_compra bigint, p_sabor text) returns bigint language sql as $$
  select cl.id from operacion.compra_linea cl join catalogo.sku s on s.id = cl.sku_id join catalogo.sabor sa on sa.id = s.sabor_id where cl.compra_id = $1 and sa.nombre_canonico = $2 $$;

select catalogo.asegurar_modelo('N905 Marca', 'N905 Modelo QA 50K', 50000, 'ambas');
select catalogo.asegurar_sku('N905 Modelo QA 50K', 'Fresa');
select catalogo.asegurar_sku('N905 Modelo QA 50K', 'Uva');
select catalogo.fijar_costo('n905c1', 'Isaac', 'N905 Modelo QA 50K', 10000, '2027-03-01', 'prueba');
select catalogo.fijar_costo('n905c2', 'Karen', 'N905 Modelo QA 50K', 11000, '2027-03-01', 'prueba', null, true);
select catalogo.asegurar_cliente('N905 Cliente', 'Angelo');

-- resolver_sku ---------------------------------------------------------------------------------------------------------------------
select is((operacion.resolver_sku('{"modelo":"N905 Modelo QA 50K","sabor":"Fresa"}'::jsonb) ? 'sku_id'), true, 'resolver_sku: por modelo y sabor');
select is((operacion.resolver_sku('{"modelo":"  n905 modelo qa 50k ","sabor":"FRESA"}'::jsonb) ->> 'sku_id'), (operacion.resolver_sku('{"modelo":"N905 Modelo QA 50K","sabor":"Fresa"}'::jsonb) ->> 'sku_id'), 'resolver_sku: normaliza mayusculas y espacios');
select throws_ok($$select operacion.resolver_sku('{"modelo":"N905 Modelo QA 50K","sabor":"Sabor Inexistente"}'::jsonb)$$, '22023', null, 'resolver_sku: sabor desconocido');
select throws_ok($$select operacion.resolver_sku('{"sku_id":999999999}'::jsonb)$$, '22023', null, 'resolver_sku: sku_id desconocido');

-- F02: OC-1 a Isaac: Fresa 100 + Uva 100 a 100.00, guia 450.00 pagada por Angelo -----------------------------------------------------
select is((operacion.crear_compra('n905o1', 'Isaac', '[{"modelo":"N905 Modelo QA 50K","sabor":"Fresa","pagadas":100},{"modelo":"N905 Modelo QA 50K","sabor":"Uva","pagadas":100}]'::jsonb, 45000, 0, '2027-03-01', 'bodega', 'sociedad', 'Angelo')->>'total_cent')::bigint, 2045000::bigint, 'OC-1: total 20,450.00 (mercancia 20,000.00 + guia 450.00)');
select is(pg_temp.saldo('Isaac'), 0::bigint, 'antes de confirmar el saldo de Isaac es 0.00');
create temp table _r0 as select operacion.reembolso_pendiente(pg_temp.sid('Angelo')) as r, operacion.aportacion_pendiente(pg_temp.sid('Angelo')) as c;
select is((operacion.confirmar_compra('n905o1c', pg_temp.cid('n905o1'))->>'saldo_despues_cent')::bigint, -2000000::bigint, 'confirmar: saldo de Isaac -20,000.00 (la guia NO carga porque la pago Angelo)');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')) - (select r from _r0), 45000::bigint, 'aportacion reembolsable de Angelo por la guia: +450.00');
select is(pg_temp.piezas('N905 Modelo QA 50K'), 0, 'confirmar no sube el inventario');
select throws_ok($$select operacion.confirmar_compra('n905o1d', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o1'))$$, 'P0428', null, 'confirmar dos veces con otra clave: P0428');
-- Pago de Angelo a Isaac con dinero propio declarado como capital: saldo 0 y capital pendiente (sin declaracion seria reembolso: ver a4_006)
select is((operacion.pago_proveedor_de_socio('n905pa', 'Isaac', 2000000, 'Angelo', 'auto', '2027-03-02', p_declara_capital => true)->>'aportacion_cent')::bigint, 2000000::bigint, 'Angelo paga 20,000.00 con dinero propio: aportacion');
select is(pg_temp.saldo('Isaac'), 0::bigint, 'saldo de Isaac 0.00');
select is(operacion.aportacion_pendiente(pg_temp.sid('Angelo')) - (select c from _r0), 2000000::bigint, 'pendiente de devolver a Angelo: 20,000.00');
-- Envio y guia de entrada (H-03: registrar_guia_compra no tenia prueba)
select is((operacion.marcar_compra_enviada('n905o1e', pg_temp.cid('n905o1'), '[]'::jsonb, null, '2027-03-02')->>'estado'), 'enviada', 'marcar enviada');
select is((operacion.registrar_guia_compra('n905o1g', pg_temp.cid('n905o1'), 'Castores', 'QA-OC1', '2027-03-04', '2027-03-02')->>'estado'), 'en_trayecto', 'registrar_guia_compra: pasa a en_trayecto');
select is((select count(*)::int from operacion.guia where compra_id = pg_temp.cid('n905o1') and sentido = 'entrada' and numero = 'QA-OC1'), 1, 'la guia de entrada queda ligada a la orden');
select is((select llegada_estimada from operacion.compra where id = pg_temp.cid('n905o1')), '2027-03-04'::date, 'llegada estimada 4-mar');
select is((operacion.registrar_guia_compra('n905o1g', pg_temp.cid('n905o1'), 'Castores', 'QA-OC1', '2027-03-04', '2027-03-02')->>'estado'), 'en_trayecto', 'misma clave: mismo resultado, sin segunda guia');
select is((select count(*)::int from operacion.guia where compra_id = pg_temp.cid('n905o1') and numero = 'QA-OC1'), 1, 'una sola guia tras repetir la clave');
select throws_ok($$select operacion.registrar_guia_compra('n905o1g', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o1'), 'Castores', 'QA-OC1', '2027-03-05')$$, 'P0409', null, 'misma clave de la guia con otro dato: P0409') ;
select throws_ok($$select operacion.registrar_guia_compra('n905o1i', 999999999, 'Castores', 'X')$$, '22023', null, 'guia sobre una compra que no existe');
select is((select count(*)::int from operacion.aviso where codigo = 'guia_registrada_trayecto' and entidad_id = pg_temp.cid('n905o1')), 1, 'NT-015: aviso de guia registrada');
select is(pg_temp.piezas('N905 Modelo QA 50K'), 0, 'en trayecto el inventario sigue sin las piezas');
select lives_ok($$select operacion.marcar_llego_merida('n905o1m', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o1'))$$, 'llego a Merida');
select throws_ok($$select operacion.registrar_guia_compra('n905o1j', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o1'), 'Castores', 'Z')$$, 'P0428', null, 'ya llego: no admite guias de entrada');

-- F03: recepcion 100 + 100 -> costo puesto (20,000 + 450) / 200 = 102.25 ---------------------------------------------------------------
select is((operacion.recibir_compra('n905o1r', pg_temp.cid('n905o1'), jsonb_build_array(
  jsonb_build_object('linea_id', pg_temp.linea(pg_temp.cid('n905o1'), 'Fresa'), 'sabor', 'Fresa', 'piezas', 100),
  jsonb_build_object('linea_id', pg_temp.linea(pg_temp.cid('n905o1'), 'Uva'), 'sabor', 'Uva', 'piezas', 100)), '2027-03-04 12:00-06')->>'piezas_recibidas')::int, 200, 'recepcion: 200 piezas');
select is(pg_temp.piezas('N905 Modelo QA 50K'), 200, 'inventario 200 piezas');
select is(pg_temp.valor('N905 Modelo QA 50K'), 2045000::bigint, 'inventario valuado en 20,450.00 (mercancia + guia)');
select is((select count(*)::int from operacion.compra_diferencia where compra_id = pg_temp.cid('n905o1')), 0, 'sin diferencias');
select is((select estado from operacion.compra where id = pg_temp.cid('n905o1')), 'recibida', 'estado recibida');
select lives_ok($$select operacion.cerrar_compra('n905o1z', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o1'))$$, 'cerrar orden');
select is(operacion.saldo_puente(), 0::bigint, 'cuenta puente en 0.00');
select throws_ok($$select operacion.anular_compra('n905o1y', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o1'), 'ya recibida')$$, 'P0428', null, 'una orden recibida o cerrada no se anula');

-- 2b: faltante: se piden 100 y llegan 98 (sin guia, costo 100.00): 2 pz x 100.00 = 200.00 ------------------------------------------------
select operacion.crear_compra('n905o2', 'Isaac', '[{"modelo":"N905 Modelo QA 50K","sabor":"Uva","pagadas":100}]'::jsonb, 0, 0, '2027-03-05');
select operacion.confirmar_compra('n905o2c', pg_temp.cid('n905o2'));
select operacion.marcar_compra_enviada('n905o2e', pg_temp.cid('n905o2'), '[]'::jsonb, null, '2027-03-05');
select operacion.marcar_llego_merida('n905o2m', pg_temp.cid('n905o2'));
select is((operacion.recibir_compra('n905o2r', pg_temp.cid('n905o2'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.linea(pg_temp.cid('n905o2'), 'Uva'), 'sabor', 'Uva', 'piezas', 98)), '2027-03-06 12:00-06')->>'piezas_recibidas')::int, 98, 'llegan 98 de 100');
select is((select valor_cent from operacion.compra_diferencia where compra_id = pg_temp.cid('n905o2')), 20000::bigint, 'faltante de 2 pz valuado en 200.00');
select is((select piezas from operacion.compra_diferencia where compra_id = pg_temp.cid('n905o2')), 2, 'diferencia de 2 piezas');
select is(pg_temp.piezas('N905 Modelo QA 50K'), 298, 'solo entra lo recibido: 298');
select is(pg_temp.valor('N905 Modelo QA 50K'), 2045000::bigint + 980000, 'valor 20,450.00 + 9,800.00');
select throws_ok($$select operacion.cerrar_compra('n905o2x', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o2'))$$, 'P0428', null, 'no se cierra con diferencias sin responsable');
select lives_ok($$select operacion.asignar_diferencia('n905d1', (select id from operacion.compra_diferencia where compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o2')), 'socio', 'Angelo', 'prueba')$$, 'asignar la diferencia a Angelo');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'diferencia'), 20000::bigint, 'deuda de Angelo por el faltante: 200.00');
select lives_ok($$select operacion.cerrar_compra('n905o2y', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o2'))$$, 'ya se puede cerrar');

-- 2f: anular una OC sin recibir devuelve el cargo ----------------------------------------------------------------------------------------
create temp table _s0 as select pg_temp.saldo('Isaac') as s;
select operacion.crear_compra('n905o3', 'Isaac', '[{"modelo":"N905 Modelo QA 50K","sabor":"Fresa","pagadas":50}]'::jsonb, 0, 0, '2027-03-06');
select is((operacion.confirmar_compra('n905o3c', pg_temp.cid('n905o3'))->>'saldo_despues_cent')::bigint, (select s from _s0) - 500000, 'OC-3 de 5,000.00 confirmada');
select throws_ok($$select operacion.anular_compra('n905o3x', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o3'), '')$$, '23502', null, 'anular exige motivo');
select is((operacion.anular_compra('n905o3a', pg_temp.cid('n905o3'), 'se cayo el trato') ->> 'estado'), 'anulada', 'anular OC no recibida');
select is(pg_temp.saldo('Isaac'), (select s from _s0), 'el cargo regresa: saldo de Isaac como antes');
select throws_ok($$select operacion.anular_compra('n905o3b', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905o3'), 'otra vez')$$, 'P0428', null, 'anular dos veces se rechaza');

-- 2e: Karen exige saldo suficiente: 200 x 110.00 = 22,000.00 -----------------------------------------------------------------------------
select operacion.crear_compra('n905k1', 'Karen', '[{"modelo":"N905 Modelo QA 50K","sabor":"Fresa","pagadas":200}]'::jsonb, 0, 0, '2027-03-06');
select throws_ok($$select operacion.confirmar_compra('n905k1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n905k1'))$$, 'P0424', null, 'Karen sin saldo: P0424');
select is(pg_temp.saldo('Karen'), 0::bigint, 'y no se carga nada');
select operacion.registrar_pago('n905kp', 'Karen', 3050000, (select id from catalogo.cliente where nombre_canonico = 'N905 Cliente'));
select is(pg_temp.saldo('Karen'), 3050000::bigint, 'pago de cliente redirigido: saldo a favor 30,500.00');
select is((operacion.confirmar_compra('n905k1d', pg_temp.cid('n905k1'))->>'saldo_despues_cent')::bigint, 850000::bigint, 'con 30,500.00 la OC confirma y deja 8,500.00');

-- Monto y cantidad invalidos --------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.crear_compra('n905z1', 'Isaac', '[{"modelo":"N905 Modelo QA 50K","sabor":"Fresa","pagadas":0}]'::jsonb)$$, '23514', null, 'pagadas = 0 se rechaza');
select throws_ok($$select operacion.crear_compra('n905z2', 'Isaac', '[{"modelo":"N905 Modelo QA 50K","sabor":"Fresa","pagadas":-5}]'::jsonb)$$, '23514', null, 'pagadas negativas se rechazan');
select throws_ok($$select operacion.crear_compra('n905z3', 'Proveedor Fantasma', '[{"modelo":"N905 Modelo QA 50K","sabor":"Fresa","pagadas":5}]'::jsonb)$$, '22023', null, 'proveedor desconocido');
select throws_ok($$select operacion.crear_compra('n905z4', 'Isaac', '[]'::jsonb)$$, '22023', null, 'una orden sin renglones se rechaza');

select * from finish();
rollback;
