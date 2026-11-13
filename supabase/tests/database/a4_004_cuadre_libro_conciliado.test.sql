-- pgTAP: la senal de salud de Socios es "Libro conciliado" (identidades i, ii, iii de docs/cuadre-socios-definicion.md), NO "los socios pusieron todo el costo".
-- Ninguna asercion depende de una cifra calibrada: cada paso compara contra sumas independientes (consultas directas a las tablas) y la senal debe ser verdadera en todo
-- estado legitimo (reembolsos, depositos sin gastar, pagos parciales pendientes, la sociedad paga con su caja, fondos en poder de un socio, capital declarado, otra
-- parametrizacion del porcentaje de caja) y falsa SOLO ante una inconsistencia inducida a proposito. La "diferencia por la compra" (via 1 y via 2) es informativa.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4s.ang@example.test', 'socio', 'Angelo', true), ('a4s.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777e1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4s.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777e2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4s.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777e1' else '77777777-7777-7777-7777-7777777777e2' end, true) $$;
-- Ids de verificaciones que fallan ('' = todo conciliado), despues de asentar lo pendiente.
create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;
-- El desglose del costo suma el costo (otros = 0 mientras no haya apertura, ajustes ni pedidos directos) y la via 1 y la via 2 son informativas.
create function pg_temp.desglose_suma() returns boolean language sql as $$
  select (c->>'otros_cent')::bigint = 0
     and (c->>'costo_cent')::bigint = (c->>'directo_socios_cent')::bigint + (c->>'pagado_por_sociedad_cent')::bigint + (c->>'pagado_con_fondos_cent')::bigint + (c->>'pendiente_proveedor_cent')::bigint
  from (select operacion.cuenta_socios() c) x $$;
select pg_temp.como('Angelo');

select catalogo.asegurar_modelo('A4S Marca', 'A4S Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('A4S Modelo', 'Uva');
select catalogo.fijar_costo('a4s-c', 'Isaac', 'A4S Modelo', 7777, negocio.hoy() - 60, 'prueba');
select is(pg_temp.fallan(), '', 'sin movimientos el libro esta conciliado');
-- Compra con costo impar (37 piezas a 77.77).
select operacion.crear_compra('a4s-oc', 'Isaac', '[{"modelo":"A4S Modelo","sabor":"Uva","pagadas":37,"facturadas":37}]'::jsonb, 0, 0, negocio.hoy(), 'bodega', 'sociedad', 'Angelo', 'Angelo');
select operacion.confirmar_compra('a4s-occ', (select (resultado->>'compra_id')::bigint from seguridad.operacion where clave = 'a4s-oc'));
select is(pg_temp.fallan(), '', 'compra confirmada sin pagos: conciliado y el costo esta pendiente con el proveedor');
select is((operacion.cuadre_socios()->>'estado'), 'pendiente_proveedor', 'etiqueta honesta: libro conciliado, pendiente de pago al proveedor');
select is((operacion.cuadre_socios()->>'pendiente_proveedor_cent')::bigint, (operacion.cuenta_socios()->>'costo_cent')::bigint, 'y lo pendiente es todo el costo');
select ok(pg_temp.desglose_suma(), 'el desglose del costo suma el costo');

-- Pagos parciales de bolsillo (reembolso por omision): ningun paso intermedio rompe la senal aunque las dos vias de la diferencia no coincidan.
select operacion.pago_proveedor_de_socio('a4s-p1', 'Isaac', 100001, 'Angelo', 'dinero_propio');
select pg_temp.como('Javier');
select operacion.pago_proveedor_de_socio('a4s-p2', 'Isaac', 50000, 'Javier', 'dinero_propio');
select is(pg_temp.fallan(), '', 'pagos parciales desiguales: conciliado');
select isnt((operacion.cuenta_socios()->>'via1_cent')::bigint * 2, (operacion.cuenta_socios()->>'via2_cent')::bigint * 2 + (operacion.cuenta_socios()->>'via2_resto_cent')::bigint, 'mientras hay pendiente las dos vias difieren (informativo)');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, true, 'y eso no es una falla del libro');
select ok(pg_temp.desglose_suma(), 'el desglose sigue sumando el costo');

-- Deposito de un socio a la caja SIN gastar: no es "puesto para la compra" (A no lo cuenta) y el libro cuadra.
select pg_temp.como('Angelo');
select operacion.registrar_aportacion('a4s-dep', 'Angelo', 150000, 'deposito a caja', 'reembolso');
select is(operacion.aportado_compra_socio((select id from catalogo.socio where nombre = 'Angelo')), 100001::bigint, 'el deposito sin gastar no cuenta como puesto para la compra (solo el pago directo)');
select is(pg_temp.fallan(), '', 'deposito sin gastar: conciliado');

-- La sociedad paga con su caja (alimentada por el deposito).
select operacion.registrar_pago_proveedor_sociedad('a4s-soc', 'Isaac', 107000, negocio.hoy(), 'pago de la sociedad');
select is(pg_temp.fallan(), '', 'la sociedad paga desde su caja: conciliado');
select ok(pg_temp.desglose_suma(), 'el desglose suma el costo con el pago de la caja');

-- Cobro que cae en la cuenta de Javier (fondos de la sociedad en su poder) y pago mixto (fondos + dinero propio).
select catalogo.asegurar_cliente('A4S Cliente', 'Javier');
select pg_temp.como('Javier');
select operacion.registrar_pago('a4s-cobro', 'Javier', 40000, (select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A4S Cliente')), null, true, 'abono', negocio.hoy(), null, null, 'cobro');
select is(pg_temp.fallan(), '', 'fondos de la sociedad en poder de un socio: conciliado');
select operacion.pago_proveedor_de_socio('a4s-mix', 'Isaac', 30000, 'Javier', 'auto');
select is(pg_temp.fallan(), '', 'pago mixto (fondos de la sociedad + dinero propio): conciliado');
select ok(pg_temp.desglose_suma(), 'el desglose suma el costo con pagos desde fondos en poder de un socio');

-- Capital declarado por un socio (reinvierte): sube 3110/3120 y sigue conciliado.
select pg_temp.como('Angelo');
select operacion.pago_proveedor_de_socio('a4s-cap', 'Isaac', 500, 'Angelo', 'dinero_propio', null, null, null, true);
select is(pg_temp.fallan(), '', 'capital declarado: conciliado');

-- El porcentaje de caja (sin decidir) cambia solo la cifra informativa, nunca la salud del libro.
create temp table _pct0 as select operacion.cuenta_socios() c;
update catalogo.config set valor = '100' where clave = 'caja_sociedad_cuenta_puesto_pct';
select is(pg_temp.fallan(), '', 'con el porcentaje de caja al 100 % sigue conciliado');
select is((operacion.cuenta_socios()->>'puesto_por_caja_cent')::bigint, (floor((operacion.cuenta_socios()->>'pagado_por_sociedad_cent')::numeric / 2) * 2)::bigint, 'al 100 %, lo atribuido es lo que pago la caja de la sociedad (a par)');
select isnt((operacion.cuenta_socios()->'angelo'->>'aportado_cent')::bigint, (select (c->'angelo'->>'aportado_cent')::bigint from _pct0), 'y mueve la cifra informativa');
update catalogo.config set valor = '0' where clave = 'caja_sociedad_cuenta_puesto_pct';

-- Proveedor liquidado por completo: etiqueta sin pendiente.
select operacion.pago_proveedor_de_socio('a4s-fin', 'Isaac', (select -operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))), 'Angelo', 'dinero_propio');
select is(pg_temp.fallan(), '', 'proveedor liquidado: conciliado');
select is((operacion.cuadre_socios()->>'estado'), 'conciliado', 'etiqueta: libro conciliado (sin pendiente)');
select ok(pg_temp.desglose_suma(), 'y el desglose suma el costo');

-- Inconsistencias REALES inducidas a proposito: cada una debe poner la senal en falso con su causa.
-- (1) Un movimiento de socio con evento que ya tiene asiento pero cuyo efecto no esta en el libro (auxiliar sin mayor).
savepoint s1;
insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, evento_id)
  select s.id, 12345, 'induccion: auxiliar sin mayor', 'reembolsable', negocio.hoy(), 'captura', (select evento_id from operacion.aportacion_socio order by id limit 1) from catalogo.socio s where s.nombre = 'Angelo';
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false, 'un reembolso en el auxiliar sin su asiento: NO conciliado');
select ok((select bool_or(x->>'id' = 'i-reembolsos-angelo' and not (x->>'ok')::boolean) from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x), 'y la causa es el auxiliar de reembolsos de Angelo contra su cuenta 2310');
select is((operacion.cuadre_socios()->>'estado'), 'revisar', 'etiqueta: revisar el libro');
rollback to s1;
-- (2) Fondos en poder de un socio sin su asiento.
savepoint s2;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'fondos_en_poder', 'fondos', 5000, 'induccion', (select evento_id from operacion.cuenta_socio_mov order by id limit 1) from catalogo.socio s where s.nombre = 'Javier';
select ok((select bool_or(x->>'id' = 'i-fondos-javier' and not (x->>'ok')::boolean) from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x), 'fondos en poder de Javier sin asiento: lo detecta el auxiliar de fondos');
rollback to s2;
-- (3) Un movimiento de socio con un evento nuevo cuyo asiento no se ha generado: "movimiento sin asiento".
savepoint s3;
select operacion.registrar_aportacion('a4s-sin-asiento', 'Javier', 7000, 'deposito sin asentar', 'reembolso');
select is((select (x->>'a_cent')::bigint from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where x->>'id' = 'ii-sin-asiento'), 1::bigint, 'un movimiento de socio sin asiento se cuenta');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false, 'y la senal pasa a falso');
select contabilidad.asentar_pendientes();
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, true, 'al asentarlo vuelve a conciliado');
rollback to s3;
-- (4) El efectivo de las cajas deja de ser el del libro.
savepoint s4;
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select c.id, negocio.hoy(), 'ajuste_conteo', 3, 'induccion', (select evento_id from operacion.cuenta_efectivo_mov order by id limit 1) from operacion.cuenta_efectivo c where c.nombre = 'Caja de la empresa';
select ok((select bool_or(x->>'id' = 'iii-efectivo' and not (x->>'ok')::boolean) from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x), 'efectivo de las cajas distinto del libro (1101 y 1102): lo detecta (iii)');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false, 'y la senal pasa a falso');
rollback to s4;
-- (5) Efectivo negativo (la sociedad pagaria mas de lo que tiene en caja): la identidad de la Cascada no se puede cumplir.
savepoint s5;
insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select c.id, negocio.hoy(), 'ajuste_conteo', -(operacion.saldo_efectivo() + 100), 'induccion', (select evento_id from operacion.cuenta_efectivo_mov order by id limit 1) from operacion.cuenta_efectivo c where c.nombre = 'Caja de la empresa';
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false, 'efectivo negativo: NO conciliado');
select matches((select x->>'detalle' from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where x->>'id' = 'iii-cascada'), 'negativo', 'y dice por que (el efectivo de la caja no puede ser negativo)');
rollback to s5;
-- Despues de deshacer las inducciones, todo vuelve a estar conciliado.
select is(pg_temp.fallan(), '', 'sin inconsistencias inducidas, conciliado');

select * from finish();
rollback;
