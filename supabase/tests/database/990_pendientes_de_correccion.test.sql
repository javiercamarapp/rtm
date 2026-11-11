-- pgTAP 990: PENDIENTES DE CORRECCION. Casos dorados escritos tal como DEBE comportarse el sistema segun CLAUDE.md y las adendas 21, 31, 32 y 33
-- (informes de auditoria 01 a 03). Si el sistema de hoy no los cumple, es hallazgo, no error de la prueba.
--
-- Cada bloque lleva el comentario `-- ESPERADO-FALLA-HASTA: <hallazgo>` y va dentro de todo_start/todo_end de pgTAP:
--   * mientras el defecto exista, la salida muestra "not ok ... # TODO" y `supabase test db` NO falla;
--   * cuando alguien lo corrija, la salida muestra "ok ... # TODO passed": es la señal para MOVER esa prueba a su archivo definitivo y quitar el todo.
-- Preguntas abiertas al dueño (G1, G2, G9, G13, G14): aqui se fija la respuesta que dicta CLAUDE.md cuando existe; si no existe, el esperado
-- es la opcion que la auditoria propone y esta senalado "(propuesto)".
-- ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N990".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n990.angelo@example.test', 'socio', 'Angelo', true), ('n990.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a9900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n990.angelo@example.test'),
  ('a9900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n990.javier@example.test');
select set_config('request.jwt.claim.sub', 'a9900000-0000-0000-0000-000000000001', true);

create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'a9900000-0000-0000-0000-000000000001' else 'a9900000-0000-0000-0000-000000000002' end, true); end $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
-- Pedido directo de Isaac (sin renta ni inventario) con utilidad conocida: piezas x (precio - 100.00).
create function pg_temp.pedido_util(p_clave text, p_fecha date, p_piezas int, p_precio_cent bigint) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  perform catalogo.fijar_precio(p_clave || 'p', 'N990 Cliente', 'N990 Modelo 30K', p_precio_cent, p_fecha, 'chat');
  v_id := (operacion.crear_pedido(p_clave, (select id from catalogo.cliente where nombre_canonico = 'N990 Cliente'), jsonb_build_array(jsonb_build_object('modelo', 'N990 Modelo 30K', 'sabor', 'Sandia', 'piezas', p_piezas)), 'isaac_directo', null, 0, 0, 0, p_fecha)->>'pedido_id')::bigint;
  perform operacion.confirmar_pedido(p_clave || 'c', v_id);
  perform operacion.enviar_pedido(p_clave || 's', v_id, null, jsonb_build_object('paqueteria', 'Castores', 'numero', 'N990-' || p_clave, 'costo_cent', 0), p_fecha, true);
  return v_id;
end $$;

-- Punto de partida limpio (mismo patron que 012 y 906).
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-990', '{}'::jsonb);
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_reembolso', -operacion.aportado_socio(s.id, 'reembolsable') - operacion.libro_socio(s.id, 'pago_reembolso'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'reembolsable') + operacion.libro_socio(s.id, 'pago_reembolso') <> 0;
insert into operacion.socio_libro (socio_id, fecha_neg, concepto, monto_cent, via, nota, evento_id)
  select s.id, negocio.hoy(), 'pago_devolucion_aportacion', -operacion.aportado_socio(s.id, 'capital') - operacion.libro_socio(s.id, 'pago_devolucion_aportacion'), 'cascada', 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s where operacion.aportado_socio(s.id, 'capital') + operacion.libro_socio(s.id, 'pago_devolucion_aportacion') <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;
insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select p.id, negocio.hoy(), 'ajuste', -operacion.saldo_proveedor(p.id), 'neutraliza para la prueba', (select max(id) from operacion.evento) from catalogo.proveedor p where operacion.saldo_proveedor(p.id) <> 0;

select catalogo.asegurar_cliente('N990 Cliente', 'Angelo');
select catalogo.asegurar_modelo('N990 Marca', 'N990 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('N990 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('n990c1', 'Isaac', 'N990 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_costo('n990c2', 'Karen', 'N990 Modelo 30K', 11000, '2020-01-01', 'prueba');
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('N990 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('N990 Omar Cliente', 'N990 Omar');
  end if;
end $$;

-- =====================================================================================================================================================
-- G1 retiro previo (informe 01, H1; pregunta 2 del dueño). Utilidad 12,000.00 sin fondos; Angelo retiro 5,000.00 el lunes.
-- Esperado (propuesto: el retiro es anticipo de utilidad): lo ya recibido entra en el resultado, Angelo asignado < Javier.
-- =====================================================================================================================================================
select pg_temp.pedido_util('n990g1', '2020-10-06', 100, 22000);
select operacion.registrar_aportacion('n990g1a', 'Angelo', 500000, 'Capital para el retiro', 'capital', '2020-10-05');
select operacion.registrar_pago_a_socio('n990g1r', 'Angelo', 500000, 'retiro', 'transferencia', '2020-10-07');
create temp table _g1 as select operacion.cascada_periodo('2020-10-05', '2020-10-11', 1200000, false) as c;
select todo_start('ESPERADO-FALLA-HASTA: H1 (retiros previos no entran a la cascada)');
select is((select (c->>'repartible_cent')::bigint from _g1), 1200000::bigint, 'G1: utilidad repartible 12,000.00');
select ok((select (c->'por_socio'->'Angelo'->>'asignado_cent')::bigint < (c->'por_socio'->'Javier'->>'asignado_cent')::bigint from _g1), 'G1: Angelo, que retiro 5,000.00, recibe 1,000.00 y Javier 6,000.00');
select todo_end();

-- =====================================================================================================================================================
-- G2 utilidad retenida y G3 perdida arrastrada (H2, adenda 31 punto D: perdidas 50/50 y se arrastran al periodo siguiente)
-- =====================================================================================================================================================
select pg_temp.pedido_util('n990g2a', '2020-10-13', 100, 20000);   -- utilidad 10,000.00
select pg_temp.pedido_util('n990g2b', '2020-10-20', 100, 12000);   -- utilidad 2,000.00
create temp table _s1 as select operacion.proponer_cierre_reparto('n990cr1', '2020-10-12', '2020-10-18', 300000, false) as r;
select is((select (r->'cascada'->>'repartible_cent')::bigint from _s1), 300000::bigint, 'S1: caja 3,000.00 limita el reparto de 10,000.00');
select operacion.firmar_cierre_reparto('n990cf1', (select id from operacion.cierre_reparto order by id desc limit 1));
select pg_temp.como('Javier');
select operacion.firmar_cierre_reparto('n990cf2', (select id from operacion.cierre_reparto order by id desc limit 1));
select pg_temp.como('Angelo');
select todo_start('ESPERADO-FALLA-HASTA: H2 (utilidad no repartida se pierde de un periodo al siguiente)');
select is((operacion.cascada_periodo('2020-10-19', '2020-10-25', 900000, false)->>'repartible_cent')::bigint, 900000::bigint, 'G2: S2 utilidad 2,000.00 + 7,000.00 retenidos de S1 = 9,000.00 con efectivo 9,000.00');
select todo_end();

-- G3: S3 pierde 6,000.00 y S4 gana 5,000.00 con efectivo de sobra: repartible 0 y arrastre -1,000.00
select pg_temp.pedido_util('n990g3a', '2020-11-03', 100, 4000);    -- utilidad -6,000.00
select pg_temp.pedido_util('n990g3b', '2020-11-10', 100, 15000);   -- utilidad +5,000.00
do $$ begin
  perform operacion.proponer_cierre_reparto('n990cr3', '2020-11-02', '2020-11-08', 5000000, false);
  perform operacion.firmar_cierre_reparto('n990cf3', (select id from operacion.cierre_reparto order by id desc limit 1));
  perform pg_temp.como('Javier');
  perform operacion.firmar_cierre_reparto('n990cf4', (select id from operacion.cierre_reparto order by id desc limit 1));
exception when others then null;   -- si hoy un cierre con perdida no se puede proponer, G3 falla abajo y no aborta el archivo
end $$;
select pg_temp.como('Angelo');
select todo_start('ESPERADO-FALLA-HASTA: H2 (las perdidas no se arrastran al periodo siguiente)');
select is((operacion.cascada_periodo('2020-11-09', '2020-11-15', 5000000, false)->>'repartible_cent')::bigint, 0::bigint, 'G3: S4 +5,000.00 despues de S3 -6,000.00 no reparte nada (acumulado -1,000.00)');
select todo_end();

-- G7 gasto con fecha dentro de un periodo ya firmado (H7): S1 (12 a 18 oct) esta cerrado
select todo_start('ESPERADO-FALLA-HASTA: H7 (movimientos con fecha anterior al cierre no se reconcilian)');
select throws_like($$select operacion.registrar_gasto_socio('n990g7', 'Javier', 100000, 'envio', 'variable', '2020-10-14')$$, '%', 'G7: un gasto fechado en un periodo firmado se rechaza o genera ajuste explicito');
select todo_end();

-- =====================================================================================================================================================
-- G4 perdida con capital desigual: regla D del dueño = perdidas 50/50. Angelo 70,000.00 y Javier 30,000.00 de capital, efectivo 90,000.00,
-- utilidad -10,000.00: Angelo 65,000.00 y Javier 25,000.00 (no 63,000 / 27,000 proporcional).
-- =====================================================================================================================================================
create temp table _g4 as select operacion.cascada_calcular(-1000000, 9000000, '{"Angelo":0,"Javier":0}', '{"Angelo":7000000,"Javier":3000000}', '{"Angelo":0,"Javier":0}', '{"Angelo":0,"Javier":0}', '{"Angelo":500000,"Javier":500000}', true) as c;
select todo_start('ESPERADO-FALLA-HASTA: H4 (la devolucion con perdida es proporcional a lo aportado, no 50/50)');
select is((select (c->'por_socio'->'Angelo'->>'paga_aportacion_cent')::bigint from _g4), 6500000::bigint, 'G4: Angelo recibe 65,000.00');
select is((select (c->'por_socio'->'Javier'->>'paga_aportacion_cent')::bigint from _g4), 2500000::bigint, 'G4: Javier recibe 25,000.00');
select todo_end();

-- G16 identidad real: una deuda que no es efectivo (faltante 1,098.55) no puede dejar que la UI diga "cuadra" sin explicarlo
create temp table _g16 as select operacion.cascada_calcular(1200000, 0, '{"Angelo":50000,"Javier":122100}', '{"Angelo":0,"Javier":100000}', '{"Angelo":800000,"Javier":672100}', '{"Angelo":909855,"Javier":672100}', '{"Angelo":500000,"Javier":500000}', true) as c;
select todo_start('ESPERADO-FALLA-HASTA: H8 (identidad_cuadra es una tautologia)');
select is((select (c->>'identidad_cuadra')::boolean from _g16), false, 'G16: con una deuda que no es efectivo la suma de resultados no es 0 y la identidad no debe decir "cuadra" sin explicarlo');
select todo_end();

-- H-30: una caja negativa capturada a mano en la cascada se rechaza
select todo_start('ESPERADO-FALLA-HASTA: H-30 (cascada acepta caja negativa)');
select throws_like($$select operacion.cascada_periodo('2020-10-12', '2020-10-18', -50000, false)$$, '%', 'H-30: caja negativa rechazada');
select todo_end();

-- =====================================================================================================================================================
-- G5 foto vieja de un cierre: reembolso pendiente 500.00, propuesta, pago manual de 500.00, firma. Esperado: la firma rechaza o recalcula.
-- =====================================================================================================================================================
select operacion.registrar_gasto_socio('n990g5', 'Angelo', 50000, 'envio', 'variable', '2020-12-01');
select operacion.proponer_cierre_reparto('n990cr5', '2020-11-30', '2020-12-06', 100000, false);
select operacion.registrar_pago_a_socio('n990g5p', 'Angelo', 50000, 'reembolso', 'efectivo', '2020-12-07');
select operacion.firmar_cierre_reparto('n990cf5', (select id from operacion.cierre_reparto order by id desc limit 1));
select pg_temp.como('Javier');
select todo_start('ESPERADO-FALLA-HASTA: H5 (cierre firmado con foto vieja, sin revalidar)');
select throws_ok($$select operacion.firmar_cierre_reparto('n990cf6', (select id from operacion.cierre_reparto order by id desc limit 1))$$, 'P0428', null, 'G5: firmar un cierre cuyo reembolso ya se pago por fuera se rechaza');
select todo_end();
select pg_temp.como('Angelo');

-- =====================================================================================================================================================
-- G6 gasto de envio duplicado (H6): la guia del pedido ya cuesta 500.00 pagada por Angelo; capturarla como gasto de socio la descontaria dos veces.
-- =====================================================================================================================================================
select catalogo.fijar_precio('n990g6p', 'N990 Cliente', 'N990 Modelo 30K', 20000, '2021-01-04', 'chat');
select operacion.crear_pedido('n990g6', pg_temp.cid('N990 Cliente'), '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","piezas":25}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2021-01-04');
select operacion.confirmar_pedido('n990g6c', pg_temp.pid('n990g6'));
select operacion.enviar_pedido('n990g6s', pg_temp.pid('n990g6'), null, '{"paqueteria":"Castores","numero":"N990-G6","costo_cent":50000,"pagada_por":"Angelo"}'::jsonb, '2021-01-04', true);
create temp table _g6a as select operacion.reembolso_pendiente(pg_temp.sid('Angelo')) as r;
select todo_start('ESPERADO-FALLA-HASTA: H6 (un gasto de envio con pedido duplica la guia)');
select throws_like($$select operacion.registrar_gasto_socio('n990g6x', 'Angelo', 50000, 'envio', 'variable', '2021-01-04', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n990g6'))$$, '%', 'G6: un gasto de envio de un pedido que ya tiene guia costeada se rechaza');
select is(operacion.reembolso_pendiente(pg_temp.sid('Angelo')), (select r from _g6a), 'G6: el reembolso total sigue siendo 500.00 (una sola vez)');
select todo_end();

-- =====================================================================================================================================================
-- G8 anular un gasto ya reembolsado: el sobrepago de 500.00 debe quedar como deuda de Angelo y no ocultarse con el clamp a 0 (H11).
-- =====================================================================================================================================================
select operacion.registrar_gasto_socio('n990g8', 'Javier', 50000, 'costos del sistema', 'fijo', '2021-01-05');
select operacion.registrar_pago_a_socio('n990g8p', 'Javier', 50000, 'reembolso', 'efectivo', '2021-01-06');
select operacion.anular_movimiento_socio('n990g8a', 'aportacion', (select a.id from operacion.aportacion_socio a join operacion.gasto g on g.id = a.ref_id and a.ref_tipo = 'gasto' where g.fecha_neg = '2021-01-05' and a.reversa_de is null order by a.id desc limit 1), 'gasto repetido');
select todo_start('ESPERADO-FALLA-HASTA: H11 (anular un gasto ya reembolsado oculta el sobrepago)');
select is(operacion.saldo_socio(pg_temp.sid('Javier'), 'general'), 50000::bigint, 'G8: el sobrepago de 500.00 queda como deuda de Javier con la sociedad');
select todo_end();

-- G9 y G10: retiro y liquidacion sin respaldo (H10). Esperado propuesto: rechazo (pregunta 12 del dueño pendiente).
select todo_start('ESPERADO-FALLA-HASTA: H10 (retiros y liquidaciones sin tope; pregunta 12)');
select throws_like($$select operacion.registrar_pago_a_socio('n990g9', 'Angelo', 100000000, 'retiro', 'transferencia', '2021-01-07')$$, '%', 'G9: un retiro mayor que lo que la sociedad le debe al socio se rechaza (propuesto)');
select throws_like($$select operacion.registrar_liquidacion_entre_socios('n990g10', 'Javier', 'Angelo', 100000000, 'sin deuda', '2021-01-07')$$, '%', 'G10: quien paga una liquidacion debe tener esa deuda');
select todo_end();

-- =====================================================================================================================================================
-- G12 un anticipo de cliente no es efectivo repartible (H3c): 9,000.00 en la cuenta de Angelo sin pedido enviado.
-- =====================================================================================================================================================
select operacion.registrar_pago('n990g12', 'Angelo', 900000, pg_temp.cid('N990 Cliente'), null, false, 'anticipo', '2021-02-01');
select todo_start('ESPERADO-FALLA-HASTA: H3 (los anticipos cuentan como efectivo repartible)');
select is((operacion.cascada_periodo('2021-02-01', '2021-02-07', 0, false)->'efectivo'->>'total_cent')::bigint - (select coalesce(sum(operacion.saldo_socio(s.id, 'fondos')), 0)::bigint - 900000 from catalogo.socio s), 0::bigint, 'G12: el anticipo de 9,000.00 no suma al efectivo de la cascada');
select todo_end();

-- =====================================================================================================================================================
-- GD-01 guia tardia: la utilidad baja cuando la guia se costea despues de la nota. Pedido directo 10 pz a 300.00 (utilidad 2,000.00), guia 450.00.
-- =====================================================================================================================================================
select catalogo.fijar_precio('n990d1p', 'N990 Cliente', 'N990 Modelo 30K', 30000, '2021-03-01', 'chat');
select operacion.crear_pedido('n990d1', pg_temp.cid('N990 Cliente'), '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","piezas":10}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2021-03-01');
select operacion.confirmar_pedido('n990d1c', pg_temp.pid('n990d1'));
select operacion.enviar_pedido('n990d1s', pg_temp.pid('n990d1'), null, '{"paqueteria":"Castores","numero":"N990-D1"}'::jsonb, '2021-03-01', true);
create temp table _d1a as select (operacion.utilidad_periodo('2021-03-01', '2021-03-07')->>'utilidad_cent')::bigint as u;
select operacion.fijar_costo_guia('n990d1g', (select id from operacion.guia where numero = 'N990-D1'), 45000, 'Angelo');
select todo_start('ESPERADO-FALLA-HASTA: GD-01 (guia costeada despues de la nota no baja la utilidad)');
select is((operacion.utilidad_periodo('2021-03-01', '2021-03-07')->>'utilidad_cent')::bigint, (select u from _d1a) - 45000, 'GD-01: la utilidad del periodo baja 450.00 al costear la guia');
select todo_end();

-- GD-05 venta mayor que la existencia: mensaje claro con lo que falta
select operacion.registrar_movimiento('n990e5', 'N990 Modelo 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 100, 1022500, '2021-04-01');
select catalogo.fijar_precio('n990d5p', 'N990 Cliente', 'N990 Modelo 30K', 15000, '2021-04-02', 'chat');
select operacion.crear_pedido('n990d5', pg_temp.cid('N990 Cliente'), '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","piezas":120}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2021-04-02');
select operacion.confirmar_pedido('n990d5c', pg_temp.pid('n990d5'));
select todo_start('ESPERADO-FALLA-HASTA: GD-05 (P0423 con mensaje crudo)');
select throws_like($$select operacion.enviar_pedido('n990d5s', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n990d5'), '%', '2021-04-02', true)$$, '%faltan 20%', 'GD-05: el error dice cuantas piezas faltan');
select todo_end();

-- GD-25 un movimiento con signo incoherente se rechaza
select todo_start('ESPERADO-FALLA-HASTA: GD-25 (el signo del tipo de movimiento no se valida)');
select throws_like($$select operacion.registrar_movimiento('n990d25', 'N990 Modelo 30K', 'Sandia', 'bodega_omar', 'salida_pedido', 100, 5000, '2021-04-03')$$, '%', 'GD-25: salida_pedido con cantidad positiva se rechaza');
select todo_end();

-- GD-07 merma en utilidad: el conteo con faltante de 5 piezas a 102.25 baja la utilidad del periodo en 511.25
create temp table _m0 as select (operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint as u;
select operacion.abrir_conteo('n990k1', 'bodega_omar', 'semanal', now());
select operacion.cerrar_conteo('n990k2', (select max(id) from operacion.conteo), jsonb_build_array(jsonb_build_object('modelo', 'N990 Modelo 30K', 'sabor', 'Sandia', 'contado', 95)));
select todo_start('ESPERADO-FALLA-HASTA: GD-07 / A3 (la merma de un conteo no llega a la utilidad)');
select is((operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint, (select u from _m0) - 51125, 'GD-07: merma de 5 pz x 102.25 = 511.25 baja la utilidad');
select todo_end();

-- =====================================================================================================================================================
-- Compras: GD-15 prepago roto, GD-16 sobrante, GD-17 perdida absorbida por la sociedad
-- =====================================================================================================================================================
select operacion.registrar_pago('n990k3', 'Karen', 3050000, pg_temp.cid('N990 Cliente'));
select operacion.crear_compra('n990o1', 'Karen', '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","pagadas":200}]'::jsonb, 0, 0, '2021-05-01');
select operacion.confirmar_compra('n990o1c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o1'));
select todo_start('ESPERADO-FALLA-HASTA: GD-15 (anular el pago de un prepago ya aplicado deja saldo negativo)');
select throws_like($$select operacion.anular_pago('n990k4', (select id from operacion.pago where monto_cent = 3050000 order by id desc limit 1), 'pago capturado en otra cuenta')$$, '%', 'GD-15: no se anula un pago cuyo saldo ya respalda una OC confirmada');
select todo_end();

select operacion.crear_compra('n990o2', 'Isaac', '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","pagadas":100}]'::jsonb, 0, 0, '2021-05-02');
select operacion.confirmar_compra('n990o2c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o2'));
select operacion.marcar_compra_enviada('n990o2e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o2'), '[]'::jsonb, null, '2021-05-02');
select operacion.marcar_llego_merida('n990o2m', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o2'));
select operacion.recibir_compra('n990o2r', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o2'),
  jsonb_build_array(jsonb_build_object('linea_id', (select cl.id from operacion.compra_linea cl where cl.compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o2')), 'sabor', 'Sandia', 'piezas', 102)), '2021-05-03 12:00-06');
select todo_start('ESPERADO-FALLA-HASTA: GD-16 (un sobrante deja la compra sin poder cerrarse)');
select lives_ok($$select operacion.cerrar_compra('n990o2x', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o2'))$$, 'GD-16: una compra con sobrante resuelto se cierra');
select todo_end();

select operacion.crear_compra('n990o3', 'Isaac', '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","pagadas":100}]'::jsonb, 0, 0, '2021-05-04');
select operacion.confirmar_compra('n990o3c', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3'));
select operacion.marcar_compra_enviada('n990o3e', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3'), '[]'::jsonb, null, '2021-05-04');
select operacion.marcar_llego_merida('n990o3m', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3'));
select operacion.recibir_compra('n990o3r', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3'),
  jsonb_build_array(jsonb_build_object('linea_id', (select cl.id from operacion.compra_linea cl where cl.compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3')), 'sabor', 'Sandia', 'piezas', 98)), '2021-05-05 12:00-06');
select todo_start('ESPERADO-FALLA-HASTA: GD-17 (un faltante asignado a la sociedad no se puede castigar ni cerrar)');
select lives_ok($$select operacion.asignar_diferencia('n990d17', (select id from operacion.compra_diferencia where compra_id = (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3')), 'sociedad', null, 'perdida absorbida')$$, 'GD-17: asignar el faltante a la sociedad');
select lives_ok($$select operacion.cerrar_compra('n990o3x', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'n990o3'))$$, 'GD-17: y la compra se cierra con el puente en 0');
select todo_end();

-- =====================================================================================================================================================
-- Omar: CP03 tope de 15 piezas, CP02 cierre con toma pendiente, GD-09 anular en semana cerrada, CP24 cancelar un pedido empacado
-- =====================================================================================================================================================
select todo_start('ESPERADO-FALLA-HASTA: H-27 / CP03 (la toma no valida el tope de 15 piezas)');
select throws_like($$select operacion.registrar_toma_omar('n990t16', '{"modelo":"N990 Modelo 30K","sabor":"Sandia"}'::jsonb, 16, 15000, '2021-06-01', 'telegram_omar')$$, '%', 'CP03: una toma de 16 piezas supera el tope de 15 y no se crea');
select todo_end();

select operacion.registrar_toma_omar('n990t2', '{"modelo":"N990 Modelo 30K","sabor":"Sandia"}'::jsonb, 2, 15000, '2021-06-02', 'telegram_omar');
select todo_start('ESPERADO-FALLA-HASTA: CP02 (cerrar con decision de pendientes deja la toma pendiente)');
select lives_ok($$select operacion.cerrar_liquidacion_omar('n990l1', '2021-05-31', true, '2021-06-07')$$, 'CP02: se cierra con decision expresa');
select is((select count(*)::int from operacion.toma_omar where fecha_neg between '2021-05-31' and '2021-06-06' and estado = 'pendiente'), 0, 'CP02: ninguna toma queda pendiente en la semana cerrada');
select todo_end();

select operacion.registrar_movimiento('n990e9', 'N990 Modelo 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 100, 1022500, '2021-07-01');
select catalogo.fijar_precio('n990d9p', 'N990 Cliente', 'N990 Modelo 30K', 15000, '2021-07-05', 'chat');
select operacion.crear_pedido('n990d9', pg_temp.cid('N990 Cliente'), '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","piezas":62}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2021-07-05');
select operacion.confirmar_pedido('n990d9c', pg_temp.pid('n990d9'));
select operacion.enviar_pedido('n990d9s', pg_temp.pid('n990d9'), '%', '2021-07-05', true);
select operacion.cerrar_liquidacion_omar('n990l9', '2021-07-05', false, '2021-07-12');
select todo_start('ESPERADO-FALLA-HASTA: GD-09 (anular un pedido de una semana ya liquidada da P0422)');
select lives_ok($$select operacion.anular_pedido('n990d9a', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n990d9'), 'devolucion total')$$, 'GD-09: se puede anular; la renta se revierte en la semana abierta (-124.00)');
select todo_end();

select catalogo.fijar_precio('n990c24p', 'N990 Cliente', 'N990 Modelo 30K', 15000, '2021-08-02', 'chat');
select operacion.crear_pedido('n990c24', pg_temp.cid('N990 Cliente'), '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2021-08-02');
select operacion.confirmar_pedido('n990c24c', pg_temp.pid('n990c24'));
select operacion.marcar_empacado('n990c24e', pg_temp.pid('n990c24'));
select operacion.cancelar_pedido('n990c24k', pg_temp.pid('n990c24'), 'el cliente cancelo');
select todo_start('ESPERADO-FALLA-HASTA: CP24 (cancelar un pedido empacado no limpia empacado_at)');
select is((select empacado_at from operacion.pedido where id = pg_temp.pid('n990c24')), null, 'CP24: empacado_at queda limpio');
select is((select count(*)::int from operacion.aviso where entidad_tipo = 'pedido' and entidad_id = pg_temp.pid('n990c24') and titulo ~* 'desarmar'), 1, 'CP24: aviso "desarmar paquete"');
select todo_end();

select * from finish();
rollback;
