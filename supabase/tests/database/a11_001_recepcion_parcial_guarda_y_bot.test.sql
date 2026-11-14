-- pgTAP a11_001: recepcion parcial de compras: guarda de "no recibir mas de lo pedido" (P0435), llegadas sucesivas hasta completar, cierre con faltante y
-- recepcion parcial por el bot de Telegram. Datos SINTETICOS; cifras hechas a mano (centavos).
-- Compra A: 100 Mango a 100.00 + guia 200.00 => costo puesto 10,200.00 (1,020,000). 60 pz => 612,000; luego 40 pz => 408,000 (resto exacto).
-- Compra B (bot): 100 Mango + 50 Uva a 100.00 sin guia. Compra C (bot): 100 Mango; llegan 88 y se cierra: faltante 12 pz = 120,000.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('rp.parcial@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('7a111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rp.parcial@example.test');
select set_config('request.jwt.claim.sub', '7a111111-1111-1111-1111-111111111111', true);
select agente.registrar_miembro(5100002, 'javier');

create function pg_temp.flush() returns int language sql as $$ select contabilidad.asentar_pendientes() $$;
create function pg_temp.res(p_clave text, p_campo text) returns bigint language sql as $$ select (resultado->>$2)::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.ok(p_codigo text) returns boolean language sql as $$ select ok from contabilidad.comprobaciones() where codigo = $1 $$;
create function pg_temp.sku(p_sabor text) returns bigint language sql as
  $$ select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'RP Modelo') and s.nombre_canonico = $1 $$;
create function pg_temp.exist(p_sabor text) returns int language sql as $$ select coalesce((select piezas from operacion.existencia_sku_ubicacion where sku_id = pg_temp.sku($1) and ubicacion = 'bodega_omar'), 0) $$;
create function pg_temp.lin(p_compra bigint, p_sabor text) returns bigint language sql as $$ select id from operacion.compra_linea where compra_id = $1 and sku_id = pg_temp.sku($2) $$;
create function pg_temp.bot(p_clave text, p_folio text, p_lineas jsonb) returns jsonb language sql as
  $$ select agente.ejecutar_ext($1, 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'origen', 'x', 'compra_folio', $2, 'lineas', $3)) $$;
create function pg_temp.fol(p_clave text) returns text language sql as $$ select folio from operacion.compra where id = pg_temp.res($1, 'compra_id') $$;
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'RP Modelo' $$;
create function pg_temp.sid(n text) returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = n $$;

select catalogo.asegurar_modelo('RP Marca', 'RP Modelo', 50000, 'ambas');
select catalogo.asegurar_sku('RP Modelo', 'Mango');
select catalogo.asegurar_sku('RP Modelo', 'Uva');
select catalogo.fijar_costo('rpc1', 'Isaac', 'RP Modelo', 10000, '2026-11-01', 'prueba');
select pg_temp.flush();

-- Compra A: guarda y llegadas sucesivas ------------------------------------------------------------------------------------------------------------
select operacion.crear_compra('rpa', 'Isaac', '[{"modelo":"RP Modelo","sabor":"Mango","pagadas":100}]'::jsonb, 20000);
select operacion.confirmar_compra('rpa:c', pg_temp.res('rpa', 'compra_id'));
select is((operacion.recibir_compra_parcial('rpa1', pg_temp.res('rpa', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('rpa', 'compra_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 60)))->>'valor_entrada_cent')::bigint,
  612000::bigint, 'primera llegada: 60 de 100 entra por 6,120.00 (60% del costo puesto)');
select throws_ok($$select operacion.recibir_compra_parcial('rpa2x', pg_temp.res('rpa', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('rpa', 'compra_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 41)))$$,
  'P0435', null, 'no se recibe mas de lo pedido: 60 + 41 pasa de 100');
select is(pg_temp.exist('Mango'), 60, 'la llegada rechazada no suma nada al inventario');
select is((select estado from operacion.compra where id = pg_temp.res('rpa', 'compra_id')), 'recibida_parcial', 'la compra sigue recibida en parte');
select is((api.compra_recepcion(pg_temp.res('rpa', 'compra_id'))->'lineas'->0->>'pendientes')::int, 40, 'el saldo pendiente visible es 40');
select is((operacion.recibir_compra_parcial('rpa2', pg_temp.res('rpa', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('rpa', 'compra_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 40)))->>'valor_entrada_cent')::bigint,
  408000::bigint, 'segunda llegada: 40 pz por el resto exacto, 4,080.00');
select is((select estado from operacion.compra where id = pg_temp.res('rpa', 'compra_id')), 'recibida', 'al completar, la compra queda recibida sin diferencias');
select is((select count(*)::int from operacion.compra_diferencia where compra_id = pg_temp.res('rpa', 'compra_id')), 0, 'sin faltante ni sobrante');
select is((select sum(valor_entrada_cent)::bigint from operacion.lote where compra_linea_id = pg_temp.lin(pg_temp.res('rpa', 'compra_id'), 'Mango')), 1020000::bigint, 'las llegadas suman EXACTAMENTE el costo puesto');
select throws_ok($$select operacion.recibir_compra_parcial('rpa3', pg_temp.res('rpa', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('rpa', 'compra_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 1)))$$,
  'P0428', null, 'una compra ya recibida no admite mas llegadas');
select is((operacion.recibir_compra_parcial('rpa2', pg_temp.res('rpa', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('rpa', 'compra_id'), 'Mango'), 'sku_id', pg_temp.sku('Mango'), 'piezas', 40)))->>'piezas_ahora')::int, 40, 'repetir la clave devuelve lo registrado (no cae en la guarda ni duplica)');
select is(pg_temp.exist('Mango'), 100, 'existencia 100 Mango');
-- Compra anulada: no se recibe
select operacion.crear_compra('rpz', 'Isaac', '[{"modelo":"RP Modelo","sabor":"Uva","pagadas":10}]'::jsonb, 0);
select operacion.confirmar_compra('rpz:c', pg_temp.res('rpz', 'compra_id'));
select operacion.anular_compra('rpz:a', pg_temp.res('rpz', 'compra_id'), 'prueba');
select throws_ok($$select operacion.recibir_compra_parcial('rpz1', pg_temp.res('rpz', 'compra_id'), jsonb_build_array(jsonb_build_object('linea_id', pg_temp.lin(pg_temp.res('rpz', 'compra_id'), 'Uva'), 'sku_id', pg_temp.sku('Uva'), 'piezas', 1)))$$,
  'P0428', null, 'una compra anulada no se recibe');

-- Compra B por el bot: parcial, repeticion, "llego todo" recibe el saldo -----------------------------------------------------------------------------
select operacion.crear_compra('rpb', 'Isaac', '[{"modelo":"RP Modelo","sabor":"Mango","pagadas":100},{"modelo":"RP Modelo","sabor":"Uva","pagadas":50}]'::jsonb, 0);
select operacion.confirmar_compra('rpb:c', pg_temp.res('rpb', 'compra_id'));
create temp table _b as select pg_temp.fol('rpb') as folio;
select is((agente.simular('ejecutar_ext', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'origen', 'x', 'compra_folio', (select folio from _b),
  'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 90))))->'efecto'->>'pendientes')::int, 60, 'la vista previa dice cuantas piezas quedarian pendientes (150 - 90)');
select is((pg_temp.bot('rpb1', (select folio from _b), jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 90)))->>'estado'), 'recibida_parcial', 'por el bot, 90 de 150 deja la compra recibida en parte (ya no la cierra con faltantes)');
select is(pg_temp.exist('Mango'), 190, 'entran solo las 90 dictadas (100 de la compra A + 90)');
select is((pg_temp.bot('rpb1', (select folio from _b), jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 90)))->>'repetido')::boolean, true, 'repetir la misma indicacion no vuelve a recibir');
select is(pg_temp.exist('Mango'), 190, 'la repeticion no duplica el inventario');
select throws_ok($$select pg_temp.bot('rpb2', (select folio from _b), jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 11)))$$, 'P0435', null, 'por el bot tampoco se recibe mas de lo pedido (90 + 11 pasa de 100)');
select is((pg_temp.bot('rpb3', (select folio from _b), '[]'::jsonb)->>'estado'), 'recibida', 'sin renglones, con la compra en parte, recibe el saldo y la cierra');
select is(pg_temp.exist('Mango') + pg_temp.exist('Uva'), 250, 'quedaron 200 Mango (100 + 100) y 50 Uva');
select is((select count(*)::int from operacion.compra_diferencia where compra_id = (select id from operacion.compra where folio = (select folio from _b))), 0, 'recibir todo el saldo no deja diferencias');

-- Compra C: 88 de 100 y cierre con faltante (caso Nexa en chico) ------------------------------------------------------------------------------------
create temp table _base as select operacion.saldo_puente() as puente, pg_temp.exist('Mango') as mango;
select operacion.crear_compra('rpd', 'Isaac', '[{"modelo":"RP Modelo","sabor":"Mango","pagadas":100}]'::jsonb, 0);
select operacion.confirmar_compra('rpd:c', pg_temp.res('rpd', 'compra_id'));
select pg_temp.bot('rpd1', pg_temp.fol('rpd'), jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 88)));
select throws_ok($$select operacion.cerrar_recepcion_compra('rpd2x', pg_temp.res('rpd', 'compra_id'))$$, '23502', null, 'cerrar con faltante exige motivo');
select is((operacion.cerrar_recepcion_compra('rpd2', pg_temp.res('rpd', 'compra_id'), 'el proveedor mando 88')->>'diferencias')::int, 1, 'el cierre deja una diferencia');
select is((select tipo || ':' || piezas || ':' || valor_cent from operacion.compra_diferencia where compra_id = pg_temp.res('rpd', 'compra_id')), 'faltante:12:120000', 'faltante de 12 pz por 1,200.00 (no es inventario)');
select is(pg_temp.exist('Mango') - (select mango from _base), 88, 'el inventario solo suma las 88 recibidas');
select is(operacion.saldo_puente() - (select puente from _base), 120000::bigint, 'el faltante queda en la cuenta puente por reclamar');
select is((select sum(valor_entrada_cent)::bigint from operacion.lote where compra_linea_id = pg_temp.lin(pg_temp.res('rpd', 'compra_id'), 'Mango')), 880000::bigint, 'el costo de lo recibido no cambia por el faltante: 88 x 100.00');
select pg_temp.flush();
select ok(pg_temp.ok('C4') and pg_temp.ok('C5') and pg_temp.ok('C18') and pg_temp.ok('C19'), 'libro, inventario, kardex y puente cuadran tras las recepciones parciales');
select ok((select count(*) = 0 from contabilidad.comprobaciones() c where not c.ok and c.bloqueante), 'ninguna comprobacion bloqueante en rojo');

-- Vista previa vieja: si entre la vista previa y la confirmacion cambia lo pendiente, se aborta (P0462) ----------------------------------------------
select operacion.crear_compra('rpe', 'Isaac', '[{"modelo":"RP Modelo","sabor":"Mango","pagadas":100}]'::jsonb, 0);
select operacion.confirmar_compra('rpe:c', pg_temp.res('rpe', 'compra_id'));
create temp table _e as select pg_temp.fol('rpe') as folio;
create temp table _h as select
  agente.simular('ejecutar_ext', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'origen', 'x', 'compra_folio', (select folio from _e),
    'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 40)))) ->> 'efecto_hash' as parcial;
select ok((select parcial from _h) is not null, 'la vista previa de una llegada parcial trae su hash');
select pg_temp.bot('rpe0', (select folio from _e), jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 10)));
select throws_ok($$select agente.ejecutar_ext('rpe1', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'origen', 'x', 'compra_folio', (select folio from _e),
  'efecto_hash', (select parcial from _h), 'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 40))))$$,
  'P0462', null, 'hash viejo de una llegada parcial: si cambio lo pendiente desde la vista previa, se aborta');
select is(pg_temp.exist('Mango') - (select mango from _base), 88 + 10, 'la llegada abortada no sumo nada (solo las 88 de C y las 10 de E)');
create temp table _h2 as select
  agente.simular('ejecutar_ext', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'origen', 'x', 'compra_folio', (select folio from _e), 'lineas', '[]'::jsonb)) ->> 'efecto_hash' as saldo;
select pg_temp.bot('rpe2', (select folio from _e), jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Mango'), 'piezas', 5)));
select throws_ok($$select agente.ejecutar_ext('rpe3', 'compra_recepcion', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002, 'origen', 'x', 'compra_folio', (select folio from _e),
  'efecto_hash', (select saldo from _h2), 'lineas', '[]'::jsonb))$$, 'P0462', null, 'hash viejo del saldo: si llego otra parte desde la vista previa, se aborta');
select is((pg_temp.bot('rpe4', (select folio from _e), '[]'::jsonb)->>'estado'), 'recibida', 'con la vista previa vigente el saldo se recibe y la compra se completa');
select is((select titulo from (select case when (r->>'piezas_ahora') is not null and r->>'estado' = 'recibida' then 'saldo' end as titulo from (select resultado as r from seguridad.operacion where clave = 'rpe4') q) z), 'saldo', 'el resultado del saldo trae piezas_ahora y estado recibida (el titulo lo distingue de la recepcion total)');

-- El wrapper del bot sigue delegando (si una migracion futura lo pisa, este caso falla) ---------------------------------------------------------------
select ok((select prosrc from pg_proc where oid = 'agente._ejecutar_ext_base(text,text,jsonb)'::regprocedure) like '%recibir_compra_parcial%'
  and (select prosrc from pg_proc where oid = 'agente._ejecutar_ext_base(text,text,jsonb)'::regprocedure) like '%_ejecutar_ext_base_sin_parcial%', 'agente._ejecutar_ext_base conserva la recepcion parcial y delega el resto');
select ok((select prosrc from pg_proc where oid = 'agente._efecto(text,jsonb)'::regprocedure) like '%piezas_ahora%', 'agente._efecto conserva las piezas de la llegada en el hash');

select * from finish();
rollback;
