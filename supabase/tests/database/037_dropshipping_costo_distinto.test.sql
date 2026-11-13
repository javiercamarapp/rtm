-- pgTAP: COSTO DISTINTO DEL CATALOGO por pedido. El catalogo es el valor por omision; un socio puede capturar el costo real por renglon con motivo (y evidencia opcional) antes de enviar; la diferencia
-- contra el catalogo se muestra y alimenta el registro de diferencias en disputa con el proveedor; la utilidad, la nota y los asientos usan el costo capturado (Libro conciliado en verde). Datos sinteticos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cdc.ang@example.test', 'socio', 'Angelo', true), ('cdc.jav@example.test', 'socio', 'Javier', true), ('cdc.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-3333333300a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cdc.ang@example.test'),
  ('88888888-8888-8888-8888-3333333300a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cdc.jav@example.test'),
  ('88888888-8888-8888-8888-3333333300a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cdc.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-3333333300a1' when 'Omar' then '88888888-8888-8888-8888-3333333300a3' else '88888888-8888-8888-8888-3333333300a2' end, true) $$;
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
create temp table _s as select (api.apertura_crear('cdc:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('cdc:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('cdc:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('cdc:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('cdc:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('cdc:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('cdc:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('cdc:f2', (select id from _s));
select pg_temp.como('Angelo');





select catalogo.asegurar_modelo('CDC Marca', 'CDC Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('CDC Modelo 25K', 'Fresa'), catalogo.asegurar_sku('CDC Modelo 25K', 'Mango');
select catalogo.fijar_costo('cdc-c1', 'Karen', 'CDC Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('cdc-c2', 'Isaac', 'CDC Modelo 25K', 9000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('CDC Cliente', 'Javier'); select catalogo.fijar_precio('cdc-p', 'CDC Cliente', 'CDC Modelo 25K', 10480, negocio.hoy() - 60, 'documento');
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar('CDC Cliente') $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.lineas(p bigint) returns bigint[] language sql as $$ select array_agg(id order by id) from operacion.pedido_linea where pedido_id = $1 $$;
create temp table _png as select encode('\x89504e470d0a1a0a0000000d49484452'::bytea, 'base64') as b;
create function pg_temp.cost(p bigint, c bigint) returns jsonb language sql as $$ select jsonb_agg(jsonb_build_object('linea_id', l, 'costo_unit_cent', c)) from unnest(pg_temp.lineas($1)) l $$;

select operacion.ds_crear_pedido('cdc-a', pg_temp.cli(), '[{"modelo":"CDC Modelo 25K","sabor":"Fresa","piezas":60},{"modelo":"CDC Modelo 25K","sabor":"Mango","piezas":40}]'::jsonb, 'karen_directo', null, null, 'cliente', null, null, 0, 0, negocio.hoy() - 2);
select is((select costo_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('cdc-a:ped')), 892900::bigint, 'por omision el costo es el del catalogo: 100 x 89.29');
select is(operacion.ds_diferencia_pedido(pg_temp.ped('cdc-a:ped')), 0::bigint, 'sin captura: sin diferencia');

-- Capturar el costo real (con motivo y evidencia)
select throws_ok($$select api.ds_capturar_costo('cdc-x1', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cdc-a:ped'), '[{"linea_id": 1, "costo_unit_cent": 9500}]'::jsonb, '')$$, '23502', null, 'el costo distinto exige motivo');
select throws_ok($$select api.ds_capturar_costo('cdc-x2', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cdc-a:ped'), '[]'::jsonb, 'sobrecobro sintetico')$$, '22023', null, 'exige al menos un renglon');
select throws_ok($$select api.ds_capturar_costo('cdc-x3', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cdc-a:ped'), '[{"linea_id": 999999, "costo_unit_cent": 9500}]'::jsonb, 'sobrecobro sintetico')$$, '22023', null, 'un renglon ajeno al pedido se rechaza');
select throws_ok($$select api.ds_capturar_costo('cdc-x4', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cdc-a:ped'), jsonb_build_array(jsonb_build_object('linea_id', (select min(id) from operacion.pedido_linea), 'costo_unit_cent', 0)), 'sobrecobro sintetico')$$, '23514', null, 'el costo debe ser positivo');
create temp table _c as select api.ds_capturar_costo('cdc-1', pg_temp.ped('cdc-a:ped'), pg_temp.cost(pg_temp.ped('cdc-a:ped'), 9500), 'sobrecobro en disputa con el proveedor (sintetico)', (select b from _png), 'image/png', 'factura.png') as r;
select is((select (r->>'diferencia_pedido_cent')::bigint from _c), 57100::bigint, 'diferencia contra el catalogo: 100 x (95.00 - 89.29) = 571.00');
select is((select costo_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('cdc-a:ped')), 950000::bigint, 'el costo estimado del pedido usa el capturado');
select is((select (x->>'diferencia_catalogo_cent')::bigint from jsonb_array_elements(api.ds_pedidos()) x where (x->>'pedido_id')::bigint = pg_temp.ped('cdc-a:ped')), 57100::bigint, 'la lista y el desglose muestran la diferencia');
select is((api.ds_orden_proveedor(pg_temp.ped('cdc-a:ped'), false)->>'costo_proveedor_cent')::bigint, 950000::bigint, 'la orden calcula el costo a Karen con el capturado');
select is(api.ds_costos_pedido(pg_temp.ped('cdc-a:ped'))->'renglones'->0->>'costo_catalogo_cent', '8929', 'la ficha muestra el costo del catalogo');
select is(api.ds_costos_pedido(pg_temp.ped('cdc-a:ped'))->'renglones'->0->>'costo_capturado_cent', '9500', '... el capturado');
select is(api.ds_costos_pedido(pg_temp.ped('cdc-a:ped'))->'renglones'->0->>'motivo', 'sobrecobro en disputa con el proveedor (sintetico)', '... y el motivo');
select is(api.ds_costos_pedido(pg_temp.ped('cdc-a:ped'))->'renglones'->0->'evidencia'->>'nombre', 'factura.png', 'con el metadato de la evidencia (huella sha256), no su contenido');
select is((api.ds_costos_pedido(pg_temp.ped('cdc-a:ped')))::text like '%iVBOR%', false, 'sin el contenido');
select operacion.confirmar_pedido('cdc-ac', pg_temp.ped('cdc-a:ped'));
select operacion.enviar_pedido('cdc-ae', pg_temp.ped('cdc-a:ped'), null, null, null, true);
select is((select sum(costo_valor_cent)::bigint from operacion.pedido_surtido where pedido_linea_id = any (pg_temp.lineas(pg_temp.ped('cdc-a:ped')))), 950000::bigint, 'el costo del surtido es el capturado (60 + 40 piezas a 95.00)');
select is((select costo_unit_cent from operacion.pedido_linea where pedido_id = pg_temp.ped('cdc-a:ped') order by id limit 1), 9500::bigint, 'el costo unitario del renglon es el capturado');
select is((select utilidad_total_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('cdc-a:ped')), (1048000 - 950000)::bigint, 'la utilidad usa el costo capturado: 980.00 en vez de 1,551.00');
select is(operacion.ds_posicion_proveedor(catalogo.proveedor_id('Karen')), -950000::bigint, 'lo que se debe a Karen es el costo capturado');
select is(pg_temp.fallan(), '', 'Libro conciliado con costo distinto del catalogo');
select is(api.ds_conciliacion(negocio.hoy() - 30, negocio.hoy() + 1)->>'cuadra', 'true', 'y la utilidad por pedido cuadra con el Estado de resultados');
select throws_ok($$select api.ds_capturar_costo('cdc-x5', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cdc-a:ped'), '[{"linea_id": 1, "costo_unit_cent": 9400}]'::jsonb, 'otro motivo sintetico')$$, 'P0428', null, 'despues de enviar el costo queda fijo (se corrige con un ajuste de proveedor)');

-- Registro de diferencias en disputa
create temp table _d as select api.ds_diferencias() as r;
select is((select jsonb_array_length(r->'filas') from _d), 2, 'el registro tiene una fila por renglon con diferencia');
select is((select (r->>'abiertas')::int from _d), 2, 'dos abiertas');
select is((select (r->>'monto_abierto_cent')::bigint from _d), 57100::bigint, 'monto abierto 571.00');
select is((select r->'filas'->0->>'estado' from _d), 'abierta', 'estado abierta');
select is((select r->'filas'->0->>'proveedor' from _d), 'Karen', 'con su proveedor');
select api.ds_resolver_diferencia('cdc-r1', (select (r->'filas'->0->>'captura_id')::bigint from _d), 'resuelta', 'el proveedor acepto ajustar la factura (sintetico)');
select is((api.ds_diferencias()->>'abiertas')::int, 1, 'resuelta una: queda una abierta');
select is(jsonb_array_length(api.ds_diferencias('resuelta')->'filas'), 1, 'filtro por estado resuelta');
select throws_ok($$select api.ds_resolver_diferencia('cdc-r2', (select (api.ds_diferencias('resuelta')->'filas'->0->>'captura_id')::bigint), 'resuelta', 'otra vez')$$, 'P0428', null, 'una diferencia resuelta no se resuelve dos veces');
select throws_ok($$select api.ds_resolver_diferencia('cdc-r3', (select (api.ds_diferencias('abierta')->'filas'->0->>'captura_id')::bigint), 'resuelta', '')$$, '23502', null, 'resolver exige una nota');
select api.ds_resolver_diferencia('cdc-r4', (select (api.ds_diferencias('abierta')->'filas'->0->>'captura_id')::bigint), 'descartada', 'error de captura en la factura (sintetico)');
select is((api.ds_diferencias()->>'abiertas')::int, 0, 'descartada la otra: ninguna abierta');

-- Capturar y volver al catalogo: sin diferencia, fuera del registro
select operacion.ds_crear_pedido('cdc-b', pg_temp.cli(), '[{"modelo":"CDC Modelo 25K","sabor":"Fresa","piezas":10}]'::jsonb, 'karen_directo');
select api.ds_capturar_costo('cdc-b1', pg_temp.ped('cdc-b:ped'), pg_temp.cost(pg_temp.ped('cdc-b:ped'), 9000), 'costo de prueba sintetico');
select api.ds_capturar_costo('cdc-b2', pg_temp.ped('cdc-b:ped'), pg_temp.cost(pg_temp.ped('cdc-b:ped'), 8929), 'se corrigio al catalogo (sintetico)');
select is(operacion.ds_diferencia_pedido(pg_temp.ped('cdc-b:ped')), 0::bigint, 'capturar el costo del catalogo revierte la diferencia');
select is((select count(*) from jsonb_array_elements(api.ds_diferencias()->'filas') x where (x->>'pedido_id')::bigint = pg_temp.ped('cdc-b:ped')), 0::bigint, 'y sale del registro de disputas');

-- Karen via Isaac: el seguro de reenvio sigue sumandose al costo capturado
select operacion.ds_crear_pedido('cdc-c', pg_temp.cli(), '[{"modelo":"CDC Modelo 25K","sabor":"Mango","piezas":20}]'::jsonb, 'karen_via_isaac');
select api.ds_capturar_costo('cdc-v1', pg_temp.ped('cdc-c:ped'), pg_temp.cost(pg_temp.ped('cdc-c:ped'), 9200), 'sobrecobro sintetico via Isaac');
select operacion.confirmar_pedido('cdc-cc', pg_temp.ped('cdc-c:ped')); select operacion.enviar_pedido('cdc-ce', pg_temp.ped('cdc-c:ped'), null, null, null, true);
select is((select sum(costo_valor_cent)::bigint from operacion.pedido_surtido where pedido_linea_id = any (pg_temp.lineas(pg_temp.ped('cdc-c:ped')))), (20 * (9200 + 500))::bigint, 'via Isaac: costo capturado + seguro de reenvio por pieza');
select is(pg_temp.fallan(), '', 'Libro conciliado con costo distinto via Isaac');
select is(api.ds_conciliacion(negocio.hoy() - 30, negocio.hoy() + 1)->>'cuadra', 'true', 'la utilidad sigue cuadrando con el Estado de resultados');

-- Sin captura el costo sigue siendo el del catalogo
select operacion.ds_crear_pedido('cdc-d', pg_temp.cli(), '[{"modelo":"CDC Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo');
select operacion.confirmar_pedido('cdc-dc', pg_temp.ped('cdc-d:ped')); select operacion.enviar_pedido('cdc-de', pg_temp.ped('cdc-d:ped'), null, null, null, true);
select is((select sum(costo_valor_cent)::bigint from operacion.pedido_surtido where pedido_linea_id = any (pg_temp.lineas(pg_temp.ped('cdc-d:ped')))), (5 * 8929)::bigint, 'sin captura: costo de catalogo');
select pg_temp.como('Omar');
select throws_ok($$select api.ds_diferencias()$$, '42501', null, 'Omar no ve las diferencias');
select throws_ok($$select api.ds_capturar_costo('cdc-o', 1, '[]'::jsonb, 'motivo sintetico')$$, '42501', null, 'ni captura costos');
select * from finish();
rollback;
