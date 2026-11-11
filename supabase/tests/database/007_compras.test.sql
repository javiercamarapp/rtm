-- pgTAP F2: compras, cuenta con el proveedor, recepcion por sabor y diferencias asignables (adendas 23, 27 y 29).
-- Los esperados salen de los documentos del dueno (22,000 con saldo de 30,500; 1,536 facturadas y 1,524 contadas; 12 pz = $1,098.55), no del codigo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f2.compras@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('71111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f2.compras@example.test');
select set_config('request.jwt.claim.sub', '71111111-1111-1111-1111-111111111111', true);

-- Punto de partida conocido sin depender de datos previos (la base puede traer datos de demostracion): la prueba neutraliza, DENTRO de su transaccion
-- (que se revierte), los saldos de proveedores y de socios con renglones de ajuste.
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-007', '{}'::jsonb);
insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select p.id, negocio.hoy(), 'ajuste', -operacion.saldo_proveedor(p.id), 'neutraliza para la prueba', (select max(id) from operacion.evento) from catalogo.proveedor p where operacion.saldo_proveedor(p.id) <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;

select catalogo.asegurar_modelo('F2 Marca', 'F2 Karen A 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('F2 Marca', 'F2 Karen B 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('F2 Marca', 'F2 Nexa 50K', 50000, 'ambas');
select catalogo.asegurar_sku('F2 Karen A 15K', 'Mango');
select catalogo.asegurar_sku('F2 Karen B 15K', 'Uva');
select catalogo.asegurar_sku('F2 Nexa 50K', 'Sin sabor');
select catalogo.asegurar_sku('F2 Nexa 50K', 'S' || g) from generate_series(1, 10) g;
select catalogo.fijar_costo('f2c1', 'Karen', 'F2 Karen A 15K', 11000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f2c2', 'Karen', 'F2 Karen B 15K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f2c3', 'Isaac', 'F2 Karen B 15K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('f2c4', 'Isaac', 'F2 Nexa 50K', 9000, '2026-11-01', 'prueba');

-- Saldo a favor con Karen: un cliente le manda 30,500 directo (pago redirigido) ----------------------------------------------
select catalogo.asegurar_cliente('F2 Cliente Angel', 'Angelo');
create temp table _base as select operacion.saldo_proveedor(catalogo.proveedor_id('Karen')) as k_antes, operacion.saldo_puente() as puente_antes;
select lives_ok($$select operacion.registrar_pago('f2p1', 'Karen', 3050000, (select id from catalogo.cliente where nombre_canonico = 'F2 Cliente Angel'))$$, 'pago de cliente redirigido a Karen');
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Karen')) - (select k_antes from _base), 3050000::bigint, 'el pago redirigido sube el saldo a favor en 30,500');
create temp table _base2 as select operacion.saldo_proveedor(catalogo.proveedor_id('Karen')) as k_ini;

-- Costo distinto de lista exige motivo ------------------------------------------------------------------------------------------
select throws_ok($$select operacion.crear_compra('f2o0', 'Karen', '[{"modelo":"F2 Karen A 15K","sabor":"Mango","pagadas":10,"costo_cent":9000}]'::jsonb)$$, '23514', null, 'costo distinto al de lista sin motivo se rechaza');
select lives_ok($$select operacion.crear_compra('f2o0b', 'Karen', '[{"modelo":"F2 Karen A 15K","sabor":"Mango","pagadas":10,"costo_cent":9000,"motivo_costo":"promocion pactada"}]'::jsonb)$$, 'con motivo pasa');
select is((select motivo_costo from operacion.compra_linea where costo_unit_cent = 9000 and piezas_pagadas = 10 limit 1), 'promocion pactada', 'el motivo queda en la linea');

-- Karen exige pago completo: OC de 40,000 con saldo de 30,500 no se confirma ------------------------------------------------------
select operacion.crear_compra('f2o1', 'Karen', '[{"modelo":"F2 Karen B 15K","sabor":"Uva","pagadas":400}]'::jsonb);
select throws_ok($$select operacion.confirmar_compra('f2o1c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o1')))$$, 'P0424', null, 'Karen: la OC de 40,000 con saldo de 30,500 no se confirma');
-- Orden de 22,000 con saldo de 30,500 deja 8,500 a favor -------------------------------------------------------------------------
select is((operacion.crear_compra('f2o2', 'Karen', '[{"modelo":"F2 Karen A 15K","sabor":"Mango","pagadas":200}]'::jsonb)->>'total_cent')::bigint, 2200000::bigint, 'la OC de 200 pz a 110.00 suma 22,000.00');
select is((operacion.confirmar_compra('f2o2c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o2')))->>'saldo_despues_cent')::bigint, 850000::bigint, 'G: 22,000 con saldo 30,500 deja 8,500.00 a favor');
select is(operacion.saldo_proveedor(catalogo.proveedor_id('Karen')), (select k_ini from _base2) - 2200000, 'la cuenta con Karen refleja el cargo');
select is((select estado from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o2')), 'confirmada', 'la OC queda confirmada');
select is((select coalesce(piezas, 0) from (select 1) x left join operacion.existencia_modelo e on e.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'F2 Karen A 15K')), 0, 'las piezas en transito NO cuentan como existencia');
select is((select count(*)::int from operacion.aviso where codigo = 'oc_confirmada_dinero_aplicado' and entidad_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o2'))), 1, 'NT-014: aviso de OC confirmada con dinero aplicado');
-- Idempotencia: la misma clave dos veces no vuelve a cargar ----------------------------------------------------------------------
select is((operacion.confirmar_compra('f2o2c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o2')))->>'saldo_despues_cent')::bigint, 850000::bigint, 'repetir la confirmacion devuelve lo mismo');
select is((select count(*)::int from operacion.cuenta_proveedor_mov where concepto = 'oc_aplicada' and monto_cent = -2200000 and compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o2'))), 1, 'un solo cargo en la cuenta');
select throws_ok($$select operacion.confirmar_compra('f2o2d', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o2')))$$, 'P0428', null, 'otra clave sobre una OC ya confirmada se rechaza (carrera)');

-- Isaac admite credito: OC de 40,000 con saldo de 30,500 deja la cuenta NEGATIVA en 9,500 ------------------------------------------
select operacion.registrar_pago('f2p2', 'Isaac', 3050000, (select id from catalogo.cliente where nombre_canonico = 'F2 Cliente Angel'));
select is((operacion.confirmar_compra('f2o3c', (operacion.crear_compra('f2o3', 'Isaac', '[{"modelo":"F2 Karen B 15K","sabor":"Uva","pagadas":400}]'::jsonb)->>'compra_id')::bigint)->>'saldo_despues_cent')::bigint,
  -950000::bigint, 'Isaac: 40,000 con saldo 30,500 deja la cuenta en -9,500.00 (se debe)');

-- Anular una OC no recibida: contramovimiento ------------------------------------------------------------------------------------
select is((operacion.anular_compra('f2a1', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2o3')), 'prueba')->>'saldo_proveedor_cent')::bigint,
  3050000::bigint, 'anular devuelve el cargo: la cuenta con Isaac vuelve a 30,500.00');

-- G3/G4/adenda 29: Nexa 1,536 facturadas (1,552 pagadas), guia 2,375.00, 10 sabores contados = 1,524 ---------------------------------------------
select is((operacion.crear_compra('f2n1', 'Isaac', '[{"modelo":"F2 Nexa 50K","sabor":"Sin sabor","pagadas":1552,"facturadas":1536}]'::jsonb, 237500, 0, '2026-11-10', 'bodega', 'sociedad', null, 'Angelo')->>'total_cent')::bigint,
  14061500::bigint, 'costo puesto de lo facturado: 140,615.00');
select operacion.confirmar_compra('f2n1c', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')));
select is((select monto_cent from operacion.partida_fuera_sociedad order by id desc limit 1), 144000::bigint, 'las 16 piezas pagadas de mas ($1,440.00) quedan FUERA de la sociedad');
select is((select socio_id from operacion.partida_fuera_sociedad order by id desc limit 1), (select id from catalogo.socio where nombre = 'Angelo'), 'a nombre de Angelo');
select is((select piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'F2 Nexa 50K'), null, 'antes de recibir no hay existencia');
select lives_ok($$select operacion.marcar_compra_enviada('f2n1e', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')), '[{"paqueteria":"Castores","numero":"G-100"},{"paqueteria":"Castores","numero":"G-101"}]'::jsonb, '2026-11-14', '2026-11-10')$$, 'se envia con dos guias');
select is((select estado from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')), 'en_trayecto', 'queda en trayecto');
select is((select count(*)::int from operacion.guia where sentido = 'entrada' and compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1'))), 2, 'una orden puede tener varias guias');
select lives_ok($$select operacion.marcar_llego_merida('f2n1m', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')))$$, 'llego a Merida');
select is((select count(*)::int from operacion.aviso where codigo = 'llegada_pendiente_confirmar' and estado = 'abierta' and entidad_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1'))), 1, 'NT-016: llegada pendiente de confirmar');

select is((operacion.recibir_compra('f2n1r', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')), (
  select jsonb_agg(jsonb_build_object('linea_id', (select cl.id from operacion.compra_linea cl where cl.compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1'))), 'sabor', 'S' || n, 'piezas', c))
  from unnest(array[175,192,200,200,166,28,100,159,133,171]) with ordinality t(c, n)), '2026-11-10 12:00-06')->>'piezas_recibidas')::int, 1524, 'recepcion confirmada por sabor: 1,524 piezas');
select is((select piezas from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'F2 Nexa 50K'), 1524, 'la existencia queda en 1,524');
select is((select valor_cent from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = 'F2 Nexa 50K'), 13951645::bigint, 'inventario: 139,516.45 (140,615.00 menos 1,098.55)');
select is((select sum(cantidad)::int from operacion.movimiento_inventario mi join catalogo.modelo m on m.id = mi.modelo_id where m.nombre_canonico = 'F2 Nexa 50K' and mi.tipo = 'entrada_compra'), 1524, 'solo entra lo recibido');
select is((select piezas from operacion.compra_diferencia order by id desc limit 1), 12, 'quedan 12 piezas en diferencias');
select is((select valor_cent from operacion.compra_diferencia order by id desc limit 1), 109855::bigint, '12 x 9,154.6224 = 1,098.55');
select is(operacion.saldo_puente() - (select puente_antes from _base), 109855::bigint, 'el puente (1340) retiene $1,098.55');
select is((select count(*)::int from operacion.aviso where codigo = 'diferencia_recepcion_abierta' and estado = 'abierta' and entidad_id = (select id from operacion.compra_diferencia order by id desc limit 1)), 1, 'NT-017: aviso de diferencia abierta');
select throws_ok($$select operacion.cerrar_compra('f2n1x', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')))$$, 'P0428', null, 'no se cierra con diferencias sin responsable');

-- Asignar a Angelo: deuda de Angelo con la sociedad, puente en cero -----------------------------------------------------------------
select is((operacion.asignar_diferencia('f2d1', (select id from operacion.compra_diferencia order by id desc limit 1), 'socio', 'Angelo', 'adenda 29')->>'puente_cent')::bigint, (select puente_antes from _base), 'asignada a Angelo: el puente queda como estaba (la diferencia sale del puente)');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia'), 109855::bigint, 'Angelo debe $1,098.55 a la sociedad');
select is((select count(*)::int from operacion.aviso where codigo = 'diferencia_recepcion_abierta' and estado = 'abierta' and entidad_id = (select id from operacion.compra_diferencia order by id desc limit 1)), 0, 'el aviso se resuelve al asignar');
select operacion.asignar_diferencia('f2d1', (select id from operacion.compra_diferencia order by id desc limit 1), 'socio', 'Angelo', 'adenda 29');
select is((select count(*)::int from operacion.diferencia_asignacion where responsable = 'socio' and diferencia_id = (select id from operacion.compra_diferencia order by id desc limit 1)), 1, 'repetir la clave no duplica la asignacion');
select is((operacion.asignar_diferencia('f2d1b', (select id from operacion.compra_diferencia order by id desc limit 1), 'socio', 'Angelo')->>'sin_cambio')::boolean, true, 'asignar al mismo responsable es sin cambio');
-- Reasignar al proveedor: la deuda de Angelo se cancela con su contramovimiento y nace el reclamo -----------------------------------
select lives_ok($$select operacion.asignar_diferencia('f2d2', (select id from operacion.compra_diferencia order by id desc limit 1), 'proveedor')$$, 'reasignar al proveedor');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia'), 0::bigint, 'la deuda de Angelo queda en cero');
select is((select sum(monto_cent)::bigint from operacion.cuenta_proveedor_mov where concepto = 'reclamo_diferencia' and diferencia_id = (select id from operacion.compra_diferencia order by id desc limit 1)), 109855::bigint, 'nace el reclamo con Isaac');
-- Y de vuelta a Angelo; Angelo paga y su deuda y la cuenta por cobrar quedan en cero --------------------------------------------------
select operacion.asignar_diferencia('f2d3', (select id from operacion.compra_diferencia order by id desc limit 1), 'socio', 'Angelo');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'diferencia'), 109855::bigint, 'otra vez debe $1,098.55');
select is((operacion.registrar_entrega_socio('f2e1', 'Angelo', 109855, 'sociedad', null, 'diferencia')->>'diferencia_pendiente_cent')::bigint, 0::bigint, 'si Angelo paga, la cuenta por cobrar queda en cero');
select throws_ok($$select operacion.registrar_entrega_socio('f2e2', 'Angelo', 1, 'sociedad', null, 'diferencia')$$, '23514', null, 'no se puede entregar mas de lo que debe en ese concepto');
select is((select count(*)::int from operacion.compra_diferencia where compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1'))), 1, 'una sola diferencia (los $1,440 no se mezclan con ella)');
select lives_ok($$select operacion.cerrar_compra('f2n1x2', (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')))$$, 'ya se puede cerrar la compra');

-- Hechos de solo insercion ---------------------------------------------------------------------------------------------------------
select throws_ok($$update operacion.cuenta_proveedor_mov set monto_cent = 1$$, '42501', null, 'la cuenta con el proveedor no se edita');
select throws_ok($$delete from operacion.compra_diferencia$$, '42501', null, 'las diferencias no se borran');
select throws_ok($$update operacion.diferencia_asignacion set motivo = 'x'$$, '42501', null, 'las asignaciones no se editan');
select throws_ok($$update operacion.lote set piezas_entrada = 1$$, '42501', null, 'los lotes no se editan');
select is((select count(*)::int from operacion.lote where compra_linea_id in (select id from operacion.compra_linea where compra_id = (select id from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = 'f2n1')))), 1, 'un lote por linea recibida');

-- Canal `sistema` (hallazgo H6): la caducidad de tomas, el latido y el scraper son actores del sistema ------------------------------------------------
select set_config('rtm.canal', 'sistema', true);
create temp table _evs as select operacion.crear_evento('evento_de_sistema', negocio.hoy(), 'f2-sis-1', '{}'::jsonb) as id;
select is((select canal from operacion.evento where id = (select id from _evs)), 'sistema', 'operacion.evento.canal admite sistema');
select is(seguridad.canal_actual(), 'sistema', 'seguridad.canal_actual() devuelve sistema');
select set_config('rtm.canal', '', true);
select is(seguridad.canal_actual(), 'web', 'sin bandera, el canal sigue siendo web');
select throws_ok($$insert into operacion.evento (tipo, fecha_neg, canal) values ('x', negocio.hoy(), 'otro')$$, '23514', null, 'un canal desconocido se rechaza');

select * from finish();
rollback;
