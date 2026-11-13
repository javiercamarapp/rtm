-- pgTAP: (A) pedidos a COSTO para un socio (ingreso = costo, utilidad 0, sin cuenta por cobrar si paga directo al proveedor) y contador de piezas movidas a proveedores por proveedor, socio
-- y mes; (B) Aportacion neta (aportado - fondos de la sociedad en su poder) y diferencia a igualar, sin tocar el libro. Datos sinteticos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a2c.ang@example.test', 'socio', 'Angelo', true), ('a2c.jav@example.test', 'socio', 'Javier', true), ('a2c.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-7777777700a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2c.ang@example.test'),
  ('88888888-8888-8888-8888-7777777700a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2c.jav@example.test'),
  ('88888888-8888-8888-8888-7777777700a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2c.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-7777777700a1' when 'Omar' then '88888888-8888-8888-8888-7777777700a3' else '88888888-8888-8888-8888-7777777700a2' end, true) $$;
select pg_temp.como('Angelo');

create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;

-- Apertura firmada por los dos (capital y cajas de efectivo) para que la sociedad pueda pagar con su caja.
create temp table _s as select (api.apertura_crear('a2c:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a2c:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('a2c:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('a2c:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('a2c:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('a2c:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('a2c:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a2c:f2', (select id from _s));
select pg_temp.como('Angelo');


select catalogo.asegurar_modelo('A2C Marca', 'A2C Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('A2C Modelo 25K', 'Fresa'), catalogo.asegurar_sku('A2C Modelo 25K', 'Mango');
select catalogo.fijar_costo('a2c-c1', 'Karen', 'A2C Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('a2c-c2', 'Isaac', 'A2C Modelo 25K', 9000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('A2C Cliente', 'Javier'); select catalogo.asegurar_cliente('A2C Stock Angelo', 'Angelo'); select catalogo.asegurar_cliente('A2C Stock Javier', 'Javier');
select catalogo.fijar_precio('a2c-p1', 'A2C Cliente', 'A2C Modelo 25K', 10480, negocio.hoy() - 60, 'documento');
create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar($1) $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

-- (A) Angelo pide 50 piezas a Karen para su stock; Javier 30 a Isaac para el suyo; un cliente compra 40 a Karen
select operacion.ds_crear_pedido('a2c-a', pg_temp.cli('A2C Stock Angelo'), '[{"modelo":"A2C Modelo 25K","sabor":"Fresa","piezas":50}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo');
-- El socio de menudeo es Angelo por omision; para este pedido de Javier se parametriza a Javier (solo el socio de menudeo mete pedidos a costo).
select pg_temp.como('Javier');
update operacion.ds_recordatorio_config set socio_menudeo = (select id from catalogo.socio where nombre = 'Javier') where id = 1;
select operacion.ds_crear_pedido('a2c-j', pg_temp.cli('A2C Stock Javier'), '[{"modelo":"A2C Modelo 25K","sabor":"Mango","piezas":30}]'::jsonb, 'isaac_directo', null, null, 'socio_a_costo', 'Javier');
update operacion.ds_recordatorio_config set socio_menudeo = (select id from catalogo.socio where nombre = 'Angelo') where id = 1;
select pg_temp.como('Angelo');
select operacion.ds_crear_pedido('a2c-c', pg_temp.cli('A2C Cliente'), '[{"modelo":"A2C Modelo 25K","sabor":"Fresa","piezas":40}]'::jsonb, 'karen_directo');
select is((select precio_cent from operacion.pedido_linea where pedido_id = pg_temp.ped('a2c-a:ped')), 8929::bigint, '(A) a Angelo se le cobra solo el costo de Karen');
select is((select precio_cent from operacion.pedido_linea where pedido_id = pg_temp.ped('a2c-j:ped')), 9000::bigint, '(A) a Javier solo el costo de Isaac');
select throws_ok($$select operacion.ds_crear_pedido('a2c-x1', (select id from catalogo.cliente where nombre_norm = 'a2c stock angelo'), '[{"modelo":"A2C Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, '{}'::jsonb, 'socio_a_costo', 'Angelo')$$, '22023', null, '(A) a costo no admite credito (crearia interes)');
select throws_ok($$select operacion.ds_crear_pedido('a2c-x2', (select id from catalogo.cliente where nombre_norm = 'a2c stock angelo'), '[{"modelo":"A2C Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 30000)$$, '22023', null, '(A) a costo no admite envio cobrado');
select throws_ok($$select operacion.ds_crear_pedido('a2c-x3', (select id from catalogo.cliente where nombre_norm = 'a2c stock angelo'), '[{"modelo":"A2C Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 100)$$, '22023', null, '(A) ni descuento');
select operacion.confirmar_pedido('a2c-ac', pg_temp.ped('a2c-a:ped')); select operacion.enviar_pedido('a2c-ae', pg_temp.ped('a2c-a:ped'), null, null, null, true);
select operacion.confirmar_pedido('a2c-jc', pg_temp.ped('a2c-j:ped')); select operacion.enviar_pedido('a2c-je', pg_temp.ped('a2c-j:ped'), null, null, null, true);
select operacion.confirmar_pedido('a2c-cc', pg_temp.ped('a2c-c:ped')); select operacion.enviar_pedido('a2c-ce', pg_temp.ped('a2c-c:ped'), null, null, null, true);
select is((select utilidad_total_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('a2c-a:ped')), 0::bigint, '(A) el pedido a costo de Angelo no genera utilidad');
select is((select utilidad_total_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('a2c-j:ped')), 0::bigint, '(A) el de Javier tampoco');
select is((select venta_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('a2c-a:ped')), (select costo_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('a2c-a:ped')), '(A) ingreso = costo');
select is(pg_temp.fallan(), '', '(A) libro conciliado con pedidos a costo y de cliente');
-- paga directo al proveedor: sin cuenta por cobrar
select operacion.ds_pagar_proveedor('a2c-pa', 'Karen', 446450, 'cliente_a_proveedor', null, pg_temp.cli('A2C Stock Angelo'), pg_temp.ped('a2c-a:ped'));
select is(operacion.pedido_saldo(pg_temp.ped('a2c-a:ped')), 0::bigint, '(A) si paga directo al proveedor no queda cuenta por cobrar');
select is(pg_temp.fallan(), '', '(A) libro conciliado tras pagar a costo directo al proveedor');
create temp table _pm as select api.ds_resumen()->'piezas_movidas' as r;
select is((select (r->>'total')::int from _pm), 120, '(A) piezas movidas a proveedores: 50 + 30 + 40');
select is((select (r->>'a_costo_socios')::int from _pm), 80, '(A) de ellas 80 a costo para socios');
select is((select (r->>'de_clientes')::int from _pm), 40, '(A) y 40 de clientes');
select is((select (x->>'piezas')::int from _pm, jsonb_array_elements(r->'por_proveedor') x where x->>'proveedor' = 'Karen'), 90, '(A) por proveedor: Karen 90');
select is((select (x->>'piezas')::int from _pm, jsonb_array_elements(r->'por_proveedor') x where x->>'proveedor' = 'Isaac'), 30, '(A) por proveedor: Isaac 30');
select is((select (x->>'piezas')::int from _pm, jsonb_array_elements(r->'por_socio') x where x->>'socio' = 'Angelo'), 50, '(A) por socio: Angelo 50');
select is((select (x->>'piezas')::int from _pm, jsonb_array_elements(r->'por_socio') x where x->>'socio' = 'Javier'), 30, '(A) por socio: Javier 30');
select is((select (x->>'costo_cent')::bigint from _pm, jsonb_array_elements(r->'por_socio') x where x->>'socio' = 'Angelo'), 446450::bigint, '(A) lo cobrado a Angelo es solo el costo (50 x 89.29)');
select is((select (r->'por_mes'->0->>'piezas')::int from _pm), 120, '(A) por periodo (mes)');
select is((api.ds_resumen(negocio.hoy() + 10, null)->'piezas_movidas'->>'total')::int, 0, '(A) un periodo sin movimientos da cero, no se inventa');
select is(jsonb_array_length(api.ds_pedidos(null, null, null, null, null, null, null, 'socio_a_costo')), 2, '(A) filtro: pedidos a costo para socio');
select is(jsonb_array_length(api.ds_pedidos(null, null, null, null, null, null, null, 'cliente')), 1, '(A) filtro: pedidos de clientes');
select is((api.ds_utilidad()->'totales'->>'utilidad_cent')::bigint, (select sum(utilidad_total_cent)::bigint from operacion.v_ds_pedido where origen_surtido = 'dropshipping' and estado = 'enviado'), '(A) la utilidad total solo viene del pedido de cliente (a costo = 0)');

-- (B) Aportacion neta: aportado - fondos de la sociedad en su poder; diferencia a igualar
select operacion.registrar_pago('a2c-cobro', 'Angelo', 300000, pg_temp.cli('A2C Cliente'), null, true, 'abono');
create temp table _an as select api.socios_aportacion_neta() as r;
select is((select (x->>'aportado_cent')::bigint from _an, jsonb_array_elements(r->'socios') x where x->>'socio' = 'Angelo'), 5000000::bigint, '(B) Angelo aporto 50,000.00 (capital de la apertura)');
select is((select (x->>'fondos_en_poder_cent')::bigint from _an, jsonb_array_elements(r->'socios') x where x->>'socio' = 'Angelo'), 300000::bigint, '(B) tiene en su poder 3,000.00 de la sociedad (cobro que cayo en su cuenta)');
select is((select (x->>'aportacion_neta_cent')::bigint from _an, jsonb_array_elements(r->'socios') x where x->>'socio' = 'Angelo'), 4700000::bigint, '(B) aportacion neta = aportado - fondos en su poder');
select is((select (x->>'aportacion_neta_cent')::bigint from _an, jsonb_array_elements(r->'socios') x where x->>'socio' = 'Javier'), 3000000::bigint, '(B) Javier: aportacion neta 30,000.00');
select is((select (x->>'diferencia_a_igualar_cent')::bigint from _an, jsonb_array_elements(r->'socios') x where x->>'socio' = 'Javier'), 1700000::bigint, '(B) Javier tiene 17,000.00 por igualar');
select is((select (x->>'diferencia_a_igualar_cent')::bigint from _an, jsonb_array_elements(r->'socios') x where x->>'socio' = 'Angelo'), 0::bigint, '(B) Angelo 0 por igualar');
select is((select r->>'le_toca_aportar' from _an), 'Javier', '(B) turno: le toca aportar el siguiente pago a Javier, el de menor aportacion neta');
select is((select (r->>'igualados')::boolean from _an), false, '(B) no estan igualados');
select is((select r::text !~* 'deuda|reembolso' from _an), true, '(B) el turno no usa lenguaje de deuda ni reembolso');
select is((select (r->'identidad'->>'cuadra')::boolean from _an), true, '(B) la identidad (suma de netas = aportado - fondos) cuadra');
select is((select r::text ~* 'debe|deuda' from _an), false, '(B) la lectura no usa lenguaje de deuda');
select is(pg_temp.fallan(), '', '(B) Libro conciliado y auxiliar contra mayor intactos: la presentacion no cambia ningun asiento');
select is((operacion.cuenta_socios()->'angelo'->>'debe_cent')::bigint, 300000::bigint, '(B) el dato contable de fondos en poder sigue igual en la base (solo cambia la presentacion)');
-- Igualados: si Javier aporta la diferencia, nadie tiene turno
select operacion.registrar_aportacion('a2c-igual', 'Javier', 1700000, 'aportacion para igualar (sintetica)', 'reembolso', negocio.hoy());
select is(api.socios_aportacion_neta() ->> 'le_toca_aportar', null, '(B) con las aportaciones iguales no le toca a nadie');
select is((api.socios_aportacion_neta() ->> 'igualados')::boolean, true, '(B) Igualados');
select pg_temp.como('Omar');
select throws_ok($$select api.socios_aportacion_neta()$$, '42501', null, '(B) Omar no lo ve');
select * from finish();
rollback;
