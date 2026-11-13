-- pgTAP: la utilidad de dropshipping reinvertida en el proveedor (venta depositada completa en la cuenta del proveedor) se reconoce como CAPITAL del socio solo por el acta de corte
-- (reinversion -> 3110/3120), sin asientos propios del modulo: sin doble conteo. Valuacion y reporte mensual la reflejan. Datos sinteticos. Venta 10,480.00, costo 8,929.00, utilidad 1,551.00.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('dsr.ang@example.test', 'socio', 'Angelo', true), ('dsr.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('99999999-9999-9999-9999-9999999999a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dsr.ang@example.test'),
  ('99999999-9999-9999-9999-9999999999a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dsr.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '99999999-9999-9999-9999-9999999999a1' else '99999999-9999-9999-9999-9999999999a2' end, true) $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.ult() returns bigint language sql as $$ select id from operacion.cierre_reparto order by id desc limit 1 $$;
create function pg_temp.rojas() returns text language plpgsql as $$
declare r text;
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;
select pg_temp.como('Angelo');
create temp table _s as select (api.apertura_crear('dsr:s1', negocio.hoy() - 12, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('dsr:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('dsr:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('dsr:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('dsr:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('dsr:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('dsr:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('dsr:f2', (select id from _s));
select pg_temp.como('Angelo');

select catalogo.asegurar_modelo('DSR Marca', 'DSR Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('DSR Modelo', 'Uva');
select catalogo.fijar_costo('dsr-c', 'Karen', 'DSR Modelo', 8929, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('DSR Cliente', 'Javier');
select catalogo.fijar_precio('dsr-p', 'DSR Cliente', 'DSR Modelo', 10480, '2020-01-01', 'chat');

select operacion.ds_crear_pedido('dsr-a', pg_temp.cid('DSR Cliente'), '[{"modelo":"DSR Modelo","sabor":"Uva","piezas":100}]'::jsonb, 'karen_directo', null, null, 'cliente', null, '73266', 0, 0, negocio.hoy() - 10);
create temp table _p as select (resultado->>'pedido_id')::bigint as id from seguridad.operacion where clave = 'dsr-a:ped';
select operacion.confirmar_pedido('dsr-ac', (select id from _p));
select operacion.enviar_pedido('dsr-ae', (select id from _p), null, null, negocio.hoy() - 10, true);
select operacion.ds_pagar_proveedor('dsr-b', 'Karen', 1048000, 'cliente_a_proveedor', null, pg_temp.cid('DSR Cliente'), (select id from _p), negocio.hoy() - 9);
select is(pg_temp.rojas(), '', 'antes del acta: libro conciliado');
select is(operacion.ds_posicion_proveedor(catalogo.proveedor_id('Karen')), 155100::bigint, 'saldo a favor con Karen = utilidad 1,551.00');
select is((api.ds_utilidad()->'totales'->>'reinvertida_cent')::bigint, 155100::bigint, 'utilidad reinvertida 1,551.00');
select is((select (x->>'sugerido_acta_cent')::bigint from jsonb_array_elements(api.ds_reporte_mensual(1)->'meses'->0->'socios') x where x->>'socio' = 'Angelo'), 77550::bigint, 'el reporte sugiere para el acta 775.50 a Angelo');
select is((api.ds_reporte_mensual(1)->'meses'->0->'socios'->0->>'reinvertida_por_acta_acum_cent')::bigint, 0::bigint, 'antes del acta: reinvertido por acta = 0 (no se cuenta dos veces)');
create temp table _v0 as select contabilidad.valuacion() as v;

-- Acta de corte: cada socio reinvierte su mitad (775.50)
select operacion.proponer_cierre_reparto('dsr-a1', negocio.hoy() - 11, negocio.hoy() - 1, '{"Angelo":{"retira":0,"reinvierte":77550},"Javier":{"retira":0,"reinvierte":77550}}');
select operacion.firmar_cierre_reparto('dsr-a2', pg_temp.ult());
select pg_temp.como('Javier');
select lives_ok($$select operacion.firmar_cierre_reparto('dsr-a3', pg_temp.ult())$$, 'el acta con la reinversion de la utilidad de dropshipping se firma');
select is(pg_temp.rojas(), '', 'tras el acta: libro conciliado (C1..C24, CU1..CU3)');
select is((select sum(monto_cent)::bigint from operacion.aportacion_socio where ref_tipo = 'reinversion' and socio_id = (select id from catalogo.socio where nombre = 'Angelo')), 77550::bigint, 'Angelo: reinversion 775.50 como inversion (capital)');
select is((select sum(monto_cent)::bigint from operacion.aportacion_socio where ref_tipo = 'reinversion' and socio_id = (select id from catalogo.socio where nombre = 'Javier')), 77550::bigint, 'Javier: reinversion 775.50 como inversion (capital)');
select is((select v06 from (select (contabilidad.valuacion()->>'v06_capital_aportado_cent')::bigint v06) q), ((select v->>'v06_capital_aportado_cent' from _v0)::bigint + 155100), 'el capital aportado de la valuacion sube 1,551.00 (775.50 por socio)');
select is((contabilidad.valuacion()->>'v01_valuacion_cent')::bigint, (select (v->>'v01_valuacion_cent')::bigint from _v0), 'la valuacion total no cambia: la reinversion no crea ni destruye activos (ya estaba como saldo a favor)');
select is((contabilidad.valuacion()->'identidades'->'i1'->>'cuadra')::boolean, true, 'identidad I-1 de la valuacion cuadra tras el acta');
select is((contabilidad.valuacion()->'identidades'->'i2'->>'cuadra')::boolean, true, 'identidad I-2 de la valuacion cuadra tras el acta');
select is((api.ds_reporte_mensual(1)->'meses'->0->'socios'->0->>'reinvertida_por_acta_acum_cent')::bigint, 77550::bigint, 'reporte mensual: lo reinvertido por acta (Angelo, acumulado)');
select is((api.ds_reporte_mensual(1)->'meses'->0->'socios'->1->>'reinvertida_por_acta_acum_cent')::bigint, 77550::bigint, 'reporte mensual: lo reinvertido por acta (Javier, acumulado)');
select * from finish();
rollback;
