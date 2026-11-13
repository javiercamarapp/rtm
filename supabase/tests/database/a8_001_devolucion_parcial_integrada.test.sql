-- pgTAP de integracion: la devolucion parcial con descuento convive con lo que main agrego despues (puente de efectivo C23/C24, paquete perdido, reinversion, historial).
-- Datos sinteticos. Esperados a mano: costo 90.00, precio 150.00.
--   Pedido 1: 20 pz = 3,000.00 + envio 100.00 - descuento 200.00 = 2,900.00. Devolucion parcial de 8 pz (5 en buen estado + 3 danadas):
--   bruto 1,200.00 - descuento proporcional 8/20 x 200.00 = 80.00 -> credito 1,120.00; regresan 5 pz al inventario (450.00 de costo); la merma de 3 pz sale a 270.00.
--   La utilidad del periodo baja credito - costo de lo que volvio = 1,120.00 - 450.00 = 670.00; el ajuste de paquetes no se mueve.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('di.angelo@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('c8888888-8888-8888-8888-888888888801', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'di.angelo@example.test');
select set_config('request.jwt.claim.sub', 'c8888888-8888-8888-8888-888888888801', true);

create function pg_temp.res(p_clave text, p_campo text) returns bigint language sql as $$ select (resultado->>$2)::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.ev(p_clave text) returns bigint language sql as $$ select id from operacion.evento where clave_idem = $1 $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'DI Cliente' $$;
create function pg_temp.sku() returns bigint language sql as
  $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DI Modelo 50K') and s.nombre_canonico = 'Mango' $$;
create function pg_temp.lin(p_pedido bigint) returns bigint language sql as $$ select id from operacion.pedido_linea where pedido_id = $1 and sku_id = pg_temp.sku() $$;
create function pg_temp.debe(p_clave text, p_cuenta text) returns bigint language sql as
  $$ select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento a join contabilidad.asiento_linea l on l.asiento_id = a.id where a.evento_id = pg_temp.ev($1) and l.cuenta = $2 $$;
create function pg_temp.piezas() returns bigint language sql as $$ select coalesce(sum(piezas), 0)::bigint from operacion.existencia_modelo where modelo_id = (select id from catalogo.modelo where nombre_canonico = 'DI Modelo 50K') $$;
-- Todo lo que NO cuadra ('' = todo cuadra): Libro conciliado y sus identidades, C1..C24 (y CU), las K de Capital por mes y el Balance.
create function pg_temp.fallas() returns text language plpgsql as $$
declare r text := ''; v jsonb;
begin
  perform contabilidad.asentar_pendientes();
  if not coalesce((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false) then r := r || 'libro_conciliado;'; end if;
  r := r || coalesce((select string_agg('socios:' || (x->>'id'), ';') from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean), '');
  r := r || coalesce((select string_agg(c.codigo, ';' order by c.codigo) from contabilidad.comprobaciones() c where not c.ok), '');
  v := api.capital_por_mes(negocio.hoy(), negocio.hoy())->'acumulado';
  r := r || coalesce((select string_agg('K:' || (x->>'id'), ';') from jsonb_array_elements(v->'comprobaciones') x where not (x->>'ok')::boolean), '');
  if not coalesce((v->'balance'->>'cuadra')::boolean, false) then r := r || 'balance;'; end if;
  return r;
end $$;

select catalogo.asegurar_cliente('DI Omar', 'Javier');
select catalogo.asegurar_persona_bodega('DI Omar', 'DI Omar');
select catalogo.asegurar_cliente('DI Cliente', 'Javier');
select catalogo.asegurar_modelo('DI Marca', 'DI Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('DI Modelo 50K', 'Mango');
select catalogo.fijar_costo('dic1', 'Isaac', 'DI Modelo 50K', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('dir1', 'DI Cliente', 'DI Modelo 50K', 15000, '2026-11-01', 'chat');
select is(pg_temp.fallas(), '', 'punto de partida: todo cuadra');

-- Compra de 100 pz recibida por llegadas (60 + 40) ------------------------------------------------------------------------------------------------
select operacion.crear_compra('dio1', 'Isaac', '[{"modelo":"DI Modelo 50K","sabor":"Mango","pagadas":100}]'::jsonb, 0);
select operacion.confirmar_compra('dio1c', pg_temp.res('dio1', 'compra_id'));
create temp table _l as select l.id as linea_id, l.sku_id from operacion.compra_linea l where l.compra_id = pg_temp.res('dio1', 'compra_id');
select operacion.recibir_compra_parcial('dio1r1', pg_temp.res('dio1', 'compra_id'), (select jsonb_agg(jsonb_build_object('linea_id', linea_id, 'sku_id', sku_id, 'piezas', 60)) from _l));
select is(pg_temp.fallas(), '', 'primera llegada de 60 pz: el libro cuadra con la mercancia pendiente en 1320');
select operacion.recibir_compra_parcial('dio1r2', pg_temp.res('dio1', 'compra_id'), (select jsonb_agg(jsonb_build_object('linea_id', linea_id, 'sku_id', sku_id, 'piezas', 40)) from _l));
select is(pg_temp.fallas(), '', 'segunda llegada: la compra queda completa y el libro cuadra');

-- Pedido 1 (con descuento) y pedido 2 (para una perdida de paquete) ----------------------------------------------------------------------------------
select operacion.crear_pedido('dip1', pg_temp.cid(), '[{"modelo":"DI Modelo 50K","sabor":"Mango","piezas":20}]'::jsonb, 'bodega_omar', null, 10000, 20000, 0, negocio.hoy());
select operacion.confirmar_pedido('dip1c', pg_temp.res('dip1', 'pedido_id'));
select is((operacion.enviar_pedido('dip1s', pg_temp.res('dip1', 'pedido_id'), null, null, negocio.hoy(), p_aceptar_avisos => true)->>'total_cent')::bigint, 290000::bigint, 'pedido 1: 3,000.00 + envio 100.00 - descuento 200.00 = 2,900.00');
select operacion.registrar_pago('dipg1', 'Efectivo', 290000, pg_temp.cid());
select operacion.crear_pedido('dip2', pg_temp.cid(), '[{"modelo":"DI Modelo 50K","sabor":"Mango","piezas":10}]'::jsonb, 'bodega_omar', null, 0, 0, 0, negocio.hoy());
select operacion.confirmar_pedido('dip2c', pg_temp.res('dip2', 'pedido_id'));
select operacion.enviar_pedido('dip2s', pg_temp.res('dip2', 'pedido_id'), null, null, negocio.hoy(), p_aceptar_avisos => true);
select operacion.registrar_pago('dipg2', 'Efectivo', 150000, pg_temp.cid());
select operacion.reportar_paquete_salida('dipq1', pg_temp.res('dip2', 'pedido_id'), 'perdido', 'se extravio en transito', jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('dip2', 'pedido_id')), 'piezas', 4)));
select operacion.resolver_paquete_incidente('dipq2', pg_temp.res('dipq1', 'incidente_id'), 'sociedad', null, 'reponer', 'la sociedad repone y absorbe la perdida');
select is(pg_temp.fallas(), '', 'con la perdida de paquete resuelta (puente de paquetes) todo cuadra');

create temp table _u0 as select operacion.utilidad_periodo('2000-01-01', negocio.hoy()) as u;
create temp table _p0 as select pg_temp.piezas() as pz;
select isnt((select (u->>'ajuste_paquetes_cent')::bigint from _u0), 0::bigint, 'hay un ajuste de paquetes en la utilidad del periodo (la envoltura de paquetes sigue activa)');

-- Devolucion parcial: 5 en buen estado + 3 danadas del mismo sabor --------------------------------------------------------------------------------
select is((operacion.registrar_devolucion_cliente('didv1', pg_temp.res('dip1', 'pedido_id'), jsonb_build_array(
    jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('dip1', 'pedido_id')), 'sku_id', pg_temp.sku(), 'piezas', 5),
    jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('dip1', 'pedido_id')), 'sku_id', pg_temp.sku(), 'piezas', 3, 'destino', 'merma')), 'devolucion parcial')->>'monto_cent')::bigint,
  112000::bigint, 'credito: 8 pz x 150.00 = 1,200.00 menos el descuento en proporcion (80.00) = 1,120.00');
select is(pg_temp.fallas(), '', 'Libro conciliado, C1..C24, K y Balance cuadran tras la devolucion parcial con descuento');
select is(pg_temp.piezas() - (select pz from _p0), 5::bigint, 'inventario: regresan 5 pz (las 3 danadas entran y salen como merma)');
select is(pg_temp.debe('didv1', '4220'), 112000::bigint, 'libro: devoluciones sobre ventas por el credito neto');
select is(pg_temp.debe('didv1', '5200'), 27000::bigint, 'libro: la merma de 3 pz sale a 270.00 (el valor con el que entraron)');
select is((operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint - (select (u->>'utilidad_cent')::bigint from _u0), -67000::bigint,
  'la utilidad del periodo baja 670.00: credito 1,120.00 menos el costo que regreso a inventario (450.00)');
select is((operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'ajuste_paquetes_cent')::bigint, (select (u->>'ajuste_paquetes_cent')::bigint from _u0), 'el ajuste de paquetes no se mueve con la devolucion');
select is((operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'devoluciones_cent')::bigint, -67000::bigint, 'el desglose muestra las devoluciones netas del costo');
select is((operacion.cascada_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint, (operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint, 'la base de la cascada entre socios es la utilidad neta del periodo');
select ok((api.explicar_cifra('cascada:utilidad:2000-01-01:' || negocio.hoy()::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar la utilidad neta cuadra con devoluciones y perdida de paquete a la vez');
select ok((api.explicar_cifra('devolucion:cliente:' || (select id from operacion.devolucion_cliente where evento_id = pg_temp.ev('didv1'))::text)->'comprobacion'->>'cuadra')::boolean, 'Explicar este numero de la devolucion cuadra');

-- Anular la devolucion: todo regresa ---------------------------------------------------------------------------------------------------------------
select operacion.anular_devolucion_cliente('didv1a', (select id from operacion.devolucion_cliente where evento_id = pg_temp.ev('didv1')), 'error de captura');
select is(pg_temp.fallas(), '', 'anulada la devolucion, el libro y los controles siguen cuadrando');
select is((operacion.utilidad_periodo('2000-01-01', negocio.hoy())->>'utilidad_cent')::bigint, (select (u->>'utilidad_cent')::bigint from _u0), 'anulada, la utilidad del periodo vuelve a la de antes');

select * from finish();
rollback;
