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
-- Estas pruebas fijan la compensacion SEMANAL de la renta (comportamiento anterior): se apaga el modo mensual del dia 15 dentro de la transaccion. La regla mensual se prueba en a12_001.
update catalogo.config set valor = 'null'::jsonb where clave = 'omar_renta_dia_compensacion';
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

-- G1 a G18 (dinero entre socios: retiros previos, utilidad retenida, perdidas, cierre con foto vieja, gasto duplicado, anular gasto, topes, anticipos de cliente, identidad):
-- los resolvio la rama fix/dinero-socios y sus pruebas definitivas viven en 015_dinero_socios_cascada y 016_dinero_socios_acta (G1 a G20), segun el protocolo de este archivo.
-- Sus bloques usaban la firma anterior de cascada_periodo y las aportaciones automaticas, que ya no existen; se retiraron de aqui porque ya estan movidos.

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
select throws_like($$select operacion.enviar_pedido('n990d5s', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n990d5'), null, null, '2021-04-02', true)$$, '%faltan 20%', 'GD-05: el error dice cuantas piezas faltan');
select todo_end();

-- GD-25 un movimiento con signo incoherente se rechaza
select todo_start('ESPERADO-FALLA-HASTA: GD-25 (el signo del tipo de movimiento no se valida)');
select throws_like($$select operacion.registrar_movimiento('n990d25', 'N990 Modelo 30K', 'Sandia', 'bodega_omar', 'salida_pedido', 100, 5000, '2021-04-03')$$, '%', 'GD-25: salida_pedido con cantidad positiva se rechaza');
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
-- (la asercion 'CP02: se cierra con decision expresa' y la de GD-17 'asignar el faltante a la sociedad' ya pasaban: viven en 991_correcciones_comprobadas)
select is((select count(*)::int from operacion.toma_omar where fecha_neg between '2021-05-31' and '2021-06-06' and estado = 'pendiente'), 0, 'CP02: ninguna toma queda pendiente en la semana cerrada');
select todo_end();

select operacion.registrar_movimiento('n990e9', 'N990 Modelo 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 100, 1022500, '2021-07-01');
select catalogo.fijar_precio('n990d9p', 'N990 Cliente', 'N990 Modelo 30K', 15000, '2021-07-05', 'chat');
select operacion.crear_pedido('n990d9', pg_temp.cid('N990 Cliente'), '[{"modelo":"N990 Modelo 30K","sabor":"Sandia","piezas":62}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2021-07-05');
select operacion.confirmar_pedido('n990d9c', pg_temp.pid('n990d9'));
select operacion.enviar_pedido('n990d9s', pg_temp.pid('n990d9'), null, null, '2021-07-05', true);
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

-- GD-07 va al final: el conteo se fecha hoy y un movimiento de hoy impediria registrar despues los movimientos de 2021 del mismo modelo.
-- GD-07 merma en utilidad: el conteo con faltante de 5 piezas a 102.25 baja la utilidad del periodo en 511.25
create temp table _m0 as select (operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint as u;
select operacion.abrir_conteo('n990k1', 'bodega_omar', 'semanal', now());
select operacion.cerrar_conteo('n990k2', (select max(id) from operacion.conteo), jsonb_build_array(jsonb_build_object('modelo', 'N990 Modelo 30K', 'sabor', 'Sandia', 'contado', 95)));
select todo_start('ESPERADO-FALLA-HASTA: GD-07 / A3 (la merma de un conteo no llega a la utilidad)');
select is((operacion.utilidad_periodo(negocio.hoy(), negocio.hoy())->>'utilidad_cent')::bigint, (select u from _m0) - 51125, 'GD-07: merma de 5 pz x 102.25 = 511.25 baja la utilidad');
select todo_end();

select * from finish();
rollback;
