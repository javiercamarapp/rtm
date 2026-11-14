-- pgTAP de dropshipping (decision del dueno, 13-nov). Datos SINTETICOS (ninguna persona, direccion, telefono ni correo reales).
-- Escenarios: (a) pedido surtido por Karen con costo distinto del precio, margen y folio externo; (b) pagos: a cuenta de un socio (fondos en poder), directo a la cuenta del proveedor,
-- de la sociedad; (c) amortizaciones parciales y pago de un socio (reembolso por omision, capital solo si declara); (d) credito con interes semanal; (e) venta interna a costo;
-- (f) pedido mixto dropshipping/inventario; (g) 120 piezas en 15 sabores; (h) faltante y anulacion contra la cuenta del proveedor. Mas: destinatario protegido, orden para Karen y
-- utilidad reinvertida 50/50. El libro ('Libro conciliado': C1..C24, CU1..CU3) debe seguir en verde tras cada escenario; se fuerzan los triggers diferidos con set constraints all immediate.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('ds.ang@example.test', 'socio', 'Angelo', true), ('ds.jav@example.test', 'socio', 'Javier', true), ('ds.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-8888888888a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ds.ang@example.test'),
  ('88888888-8888-8888-8888-8888888888a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ds.jav@example.test'),
  ('88888888-8888-8888-8888-8888888888a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ds.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-8888888888a1' when 'Omar' then '88888888-8888-8888-8888-8888888888a3' else '88888888-8888-8888-8888-8888888888a2' end, true) $$;
select pg_temp.como('Angelo');
-- Llave de prueba generada aqui (nunca en el repo): el destinatario va cifrado en reposo.
select set_config('rtm.llave_destinatario', encode(extensions.gen_random_bytes(32), 'base64'), true);

create function pg_temp.fallan() returns text language plpgsql as $$
declare r text;
begin
  set constraints all immediate;
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;

-- Apertura firmada por los dos (capital y cajas de efectivo) para que la sociedad pueda pagar con su caja.
create temp table _s as select (api.apertura_crear('ds:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('ds:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('ds:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('ds:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('ds:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('ds:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('ds:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('ds:f2', (select id from _s));
select pg_temp.como('Angelo');

-- Catalogo sintetico: un modelo con 15 sabores; costo de Karen 89.29 y precio al cliente 104.80 (100 pzas: costo 8,929.00, venta 10,480.00, utilidad 1,551.00).
select catalogo.asegurar_modelo('DS Marca', 'DS Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('DS Modelo 25K', s) from unnest(array['Fresa','Mango','Uva','Sandia','Menta','Mora','Durazno','Limon','Cereza','Kiwi','Coco','Pina','Cafe','Vainilla','Manzana']) s;
select catalogo.fijar_costo('cat-c1', 'Karen', 'DS Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('cat-c2', 'Isaac', 'DS Modelo 25K', 9000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('DS Cliente Uno', 'Javier'); select catalogo.asegurar_cliente('DS Cliente Dos', 'Javier'); select catalogo.asegurar_cliente('DS Socio Menudeo', 'Javier');
select catalogo.fijar_precio('cat-p1', 'DS Cliente Uno', 'DS Modelo 25K', 10480, negocio.hoy() - 60, 'documento');
select catalogo.fijar_precio('cat-p2', 'DS Cliente Dos', 'DS Modelo 25K', 13000, negocio.hoy() - 60, 'documento');
select catalogo.fijar_precio('cat-p3', 'DS Socio Menudeo', 'DS Modelo 25K', 8929, negocio.hoy() - 60, 'documento');
create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar($1) $$;
create function pg_temp.dest(n text default 'Persona Sintetica Uno') returns jsonb language sql as
  $$ select jsonb_build_object('nombre', n, 'calle_numero', 'Calle Ficticia 123', 'colonia', 'Colonia Imaginaria', 'cp', '97000', 'municipio', 'Municipio Ejemplo', 'estado', 'Estado Ejemplo',
                               'telefono', '9990001111', 'correo', 'destino.sintetico@example.test', 'referencias', 'Porton azul de prueba') $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

-- ---------------------------------------------------------------------------
-- Interes: funcion determinista
-- ---------------------------------------------------------------------------
select is(operacion.interes_credito(2600000, 1000, 1, 'simple'), 260000::bigint, 'ejemplo del dueno: 26,000.00 a una semana al 10 % => interes 2,600.00');
select is(2600000 + operacion.interes_credito(2600000, 1000, 1, 'simple'), 2860000::bigint, '... y total 28,600.00');
select is(operacion.interes_credito(2600000, 1000, 3, 'simple'), 780000::bigint, 'simple a tres semanas = 3 x 10 %');
select is(operacion.interes_credito(1000000, 1000, 2, 'compuesto'), 210000::bigint, 'compuesto a dos semanas (opcion explicita): 10,000.00 x 21 %');
select is(operacion.interes_credito(1, 1000, 1, 'simple'), 0::bigint, 'redondeo medio hacia arriba: 0.1 centavo => 0');
select is(operacion.interes_credito(5, 1000, 1, 'simple'), 1::bigint, '... 0.5 centavo => 1');
select throws_ok($$select operacion.interes_credito(100, 20000, 1)$$, '23514', null, 'porcentaje fuera de rango se rechaza');
select throws_ok($$select operacion.interes_credito(100, 1000, 1, 'raro')$$, '22023', null, 'modo desconocido se rechaza');
select is(operacion.origen_surtido('karen_directo') || operacion.origen_surtido('isaac_directo') || operacion.origen_surtido('karen_via_isaac'), 'dropshippingdropshippingdropshipping', 'directos = dropshipping (incluye isaac_directo)');
select is(operacion.origen_surtido('bodega_omar') || ',' || operacion.origen_surtido('castores'), 'inventario_merida,inventario_merida', 'bodega = inventario en Merida');

-- ---------------------------------------------------------------------------
-- (a) Pedido surtido por Karen: costo distinto del precio, margen, folio externo, destinatario protegido, orden para Karen
-- ---------------------------------------------------------------------------
select operacion.ds_crear_pedido('ds-a', pg_temp.cli('DS Cliente Uno'), '[{"modelo":"DS Modelo 25K","sabor":"Fresa","piezas":40},{"modelo":"DS Modelo 25K","sabor":"Mango","piezas":35},{"modelo":"DS Modelo 25K","sabor":"Uva","piezas":25}]'::jsonb,
  'karen_directo', pg_temp.dest(), null, 'cliente', null, '73266');
create temp table _a as select resultado as r from seguridad.operacion where clave = 'ds-a';
select is((select r->>'origen_surtido' from _a), 'dropshipping', '(a) el pedido nace como dropshipping');
select is((select (r->>'costo_estimado_cent')::bigint from _a), 892900::bigint, '(a) costo a Karen = 100 x 89.29 = 8,929.00 (catalogo del proveedor)');
select is((select (r->>'venta_estimada_cent')::bigint from _a), 1048000::bigint, '(a) venta al cliente 10,480.00');
select is((select (r->>'margen_estimado_cent')::bigint from _a), 155100::bigint, '(a) margen = precio - costo = 1,551.00');
select is((select r::text like '%Calle Ficticia%' or r::text like '%9990001111%' from _a), false, 'el resultado guardado de la operacion no contiene datos del destinatario');
select is((select count(*) from operacion.evento where payload::text like '%Calle Ficticia%' or payload::text like '%9990001111%' or payload::text like '%destino.sintetico%'), 0::bigint, 'ningun evento lleva datos del destinatario');
select is((select folio_externo from operacion.pedido_ds where pedido_id = pg_temp.ped('ds-a' || ':ped')), '73266', '(a) folio externo de Karen guardado');
select throws_ok($$select operacion.ds_crear_pedido('ds-a2', pg_temp.cli('DS Cliente Uno'), '[{"modelo":"DS Modelo 25K","sabor":"Fresa","piezas":1}]'::jsonb, 'karen_directo', null, null, 'cliente', null, ' 73 266 ')$$, '23505', null, 'el folio de Karen es unico (se ignoran espacios)');
select is(api.ds_pedidos(null, null, null, null, null, null, '73266') -> 0 ->> 'folio', (select folio from operacion.pedido where id = pg_temp.ped('ds-a' || ':ped')), 'se busca por folio de Karen');
select is(jsonb_array_length(api.ds_pedidos(null, null, null, null, null, null, '99999')), 0, 'folio inexistente: lista vacia');

-- Protegido: la web (authenticated) no toca las tablas ni el esquema; Omar y el agente tampoco llegan a las funciones.
set local role authenticated;
select throws_ok($$select count(*) from entrega.destinatario$$, '42501', null, 'authenticated no lee entrega.destinatario');
select throws_ok($$select count(*) from entrega.revelacion$$, '42501', null, 'authenticated no lee entrega.revelacion');
select throws_ok($$select count(*) from operacion.pedido_ds$$, '42501', null, 'authenticated no lee la tabla base de dropshipping');
select throws_ok($$select * from operacion.v_ds_pedido$$, '42501', null, 'ni las vistas internas');
reset role;
select pg_temp.como('Omar');
select throws_ok($$select api.ds_destinatario(1)$$, '42501', null, 'Omar no ve el destinatario');
select throws_ok($$select api.ds_pedidos()$$, '42501', null, 'Omar no ve los pedidos de dropshipping');
select pg_temp.como('Angelo');
select is(api.ds_destinatario(pg_temp.ped('ds-a:ped')) ->> 'telefono_mascara', '*** ** 11', 'el telefono sale enmascarado');
select is(api.ds_destinatario(pg_temp.ped('ds-a:ped')) ->> 'correo_mascara', 'd***@***', 'el correo sale enmascarado');
select is((api.ds_destinatario(pg_temp.ped('ds-a:ped')))::text like '%9990001111%', false, 'la lectura normal no trae el telefono completo');
select is(api.ds_destinatario_revelar(pg_temp.ped('ds-a:ped'), 'telefono', 'prueba') ->> 'valor', '9990001111', 'Revelar entrega el telefono');
select is((select count(*) from entrega.revelacion where pedido_id = pg_temp.ped('ds-a:ped') and accion = 'telefono'), 1::bigint, 'y queda auditado');
select throws_ok($$select api.ds_destinatario_revelar(1, 'nombre')$$, '22023', null, 'solo se revela telefono o correo');
select throws_ok($$select operacion.ds_capturar_destinatario('ds-x', pg_temp.ped('ds-a:ped'), '{"nombre":"A"}')$$, '23502', null, 'destinatario incompleto se rechaza (nombre muy corto)');
select throws_ok($$select entrega.normalizar('{"nombre":"Ana Sintetica","calle_numero":"Calle 1","cp":"123","municipio":"Mun","estado":"Est"}')$$, '23514', null, 'el codigo postal exige 5 digitos');
-- Orden para Karen: vista previa enmascarada; con el bloque completo queda auditado; sin precios del cliente.
create temp table _o1 as select api.ds_orden_proveedor(pg_temp.ped('ds-a:ped'), false) as o;
select is((select o->>'texto' from _o1) like '%*** ** 11%', true, 'la vista previa de la orden va enmascarada');
select is((select count(*) from entrega.revelacion where accion = 'orden'), 0::bigint, 'la vista previa no se audita como revelacion');
create temp table _o2 as select api.ds_orden_proveedor(pg_temp.ped('ds-a:ped'), true) as o;
select is((select o->>'texto' from _o2),
$t$Pedido P-0001

DS Marca DS Modelo 25K (100 pzas)
- Fresa x 40
- Mango x 35
- Uva x 25

Total: 100 pzas

Entregar a:
Persona Sintetica Uno
Calle Ficticia 123, Colonia Imaginaria, CP 97000
Municipio Ejemplo, Estado Ejemplo
Tel: 9990001111
Correo: destino.sintetico@example.test
Referencias: Porton azul de prueba$t$, 'texto de la orden por marca/modelo con sabores y bloque de destinatario');
select is((select count(*) from entrega.revelacion where accion = 'orden'), 1::bigint, 'copiar la orden completa queda auditado');
select is((select o->>'texto' from _o2) ~ '(104|10,?480|89\.29|8,?929)', false, 'la orden no lleva precio al cliente ni costo');
select is((select (o->>'costo_proveedor_cent')::bigint from _o2), 892900::bigint, 'el costo a Karen se calcula aparte del texto');
select is(operacion.texto_orden_proveedor('P-9', '[{"marca":"M","modelo":"X","piezas":2,"sabores":[{"sabor":"A","piezas":2}]}]'::jsonb, null), E'Pedido P-9\n\nM X (2 pzas)\n- A x 2\n\nTotal: 2 pzas', 'sin destinatario no hay bloque de entrega');

-- Enviado: venta, costo y margen reales; el pedido NO mueve inventario de Merida ni genera renta
select operacion.confirmar_pedido('ds-a-c', pg_temp.ped('ds-a:ped'));
select operacion.enviar_pedido('ds-a-e', pg_temp.ped('ds-a:ped'), null, null, null, true);
select is((select count(*) from operacion.movimiento_inventario where evento_id in (select evento_envio_id from operacion.pedido where id = pg_temp.ped('ds-a:ped'))), 0::bigint, '(a) no entra ni sale inventario de la bodega de Merida');
select is((select renta_cent from operacion.pedido_linea where pedido_id = pg_temp.ped('ds-a:ped') limit 1), 0::bigint, '(a) sin renta de bodega');
select is((select (utilidad_cent) from operacion.v_ds_utilidad where pedido_id = pg_temp.ped('ds-a:ped')), 155100::bigint, '(a) utilidad real 1,551.00');
select is(pg_temp.fallan(), '', '(a) libro conciliado tras la venta (aun sin pagar)');
select is(operacion.ds_posicion_proveedor(catalogo.proveedor_id('Karen')), -892900::bigint, '(a) se debe a Karen el costo del pedido');

-- ---------------------------------------------------------------------------
-- (b) El cliente paga la venta completa directo a la cuenta de Karen: costo liquidado, excedente = saldo a favor = utilidad reinvertida 50/50
-- ---------------------------------------------------------------------------
select operacion.ds_pagar_proveedor('ds-b1', 'Karen', 1048000, 'cliente_a_proveedor', null, pg_temp.cli('DS Cliente Uno'), pg_temp.ped('ds-a:ped'));
select is(operacion.pedido_saldo(pg_temp.ped('ds-a:ped')), 0::bigint, '(b) el cliente quedo saldado');
select is(operacion.ds_posicion_proveedor(catalogo.proveedor_id('Karen')), 155100::bigint, '(b) saldo a favor con Karen = excedente 1,551.00');
select is(pg_temp.fallan(), '', '(b) libro conciliado tras el deposito directo al proveedor');
create temp table _u as select api.ds_utilidad(null, null) as u;
select is((select (u->'totales'->>'utilidad_cent')::bigint from _u), 155100::bigint, 'utilidad total 1,551.00');
select is((select (u->'totales'->>'reinvertida_cent')::bigint from _u), 155100::bigint, 'toda reinvertida en el proveedor');
select is((select (x->>'utilidad_cent')::bigint from _u, jsonb_array_elements(u->'totales'->'socios') x where x->>'socio' = 'Angelo'), 77550::bigint, '775.50 para Angelo');
select is((select (x->>'reinvertida_cent')::bigint from _u, jsonb_array_elements(u->'totales'->'socios') x where x->>'socio' = 'Javier'), 77550::bigint, '775.50 reinvertidos para Javier');
select is((api.ds_explicar_utilidad('dsu:utilidad:-:-')->'comprobacion'->>'cuadra')::boolean, true, '"Explicar este numero" de la utilidad cuadra por dos vias');
select is((api.ds_explicar_utilidad('dsu:reinvertida:-:-')->>'valor')::bigint, 155100::bigint, '... y de la reinvertida');
select throws_ok($$select api.ds_explicar_utilidad('dsu:raro:-:-')$$, '22023', null, 'cifra desconocida se rechaza');

-- (b) El cliente paga a cuenta de un socio (fondos en poder); el socio paga a Karen con esos fondos y despues la sociedad transfiere el resto
select operacion.ds_crear_pedido('ds-b2', pg_temp.cli('DS Cliente Uno'), '[{"modelo":"DS Modelo 25K","sabor":"Kiwi","piezas":10}]'::jsonb, 'karen_directo', pg_temp.dest('Persona Sintetica Dos'));
select operacion.confirmar_pedido('ds-b2-c', pg_temp.ped('ds-b2:ped')); select operacion.enviar_pedido('ds-b2-e', pg_temp.ped('ds-b2:ped'), null, null, null, true);
select operacion.registrar_pago('ds-b2-cobro', 'Angelo', 104800, pg_temp.cli('DS Cliente Uno'), null, true, 'abono');
select is(pg_temp.fallan(), '', '(b) libro conciliado: el cobro cayo en la cuenta de un socio (fondos en poder)');
select is(operacion.saldo_socio((select id from catalogo.socio where nombre = 'Angelo'), 'fondos'), 104800::bigint, '(b) Angelo tiene en su poder 1,048.00 de la sociedad');
select operacion.ds_pagar_proveedor('ds-b2-p1', 'Karen', 50000, 'socio_fondos', 'Angelo', null, pg_temp.ped('ds-b2:ped'));
-- Decision 12 (13-nov): el pago de la sociedad exige saldo en la Caja de la empresa; se deposita antes (reembolso al socio, no capital).
select operacion.registrar_aportacion('ds-b2-dep', 'Angelo', 39290, 'deposito a caja', 'reembolso');
select operacion.ds_pagar_proveedor('ds-b2-p2', 'Karen', 39290, 'sociedad', null, null, pg_temp.ped('ds-b2:ped'));
select is(pg_temp.fallan(), '', '(b) libro conciliado tras pagar con fondos del socio y con la sociedad');
select is((select amortizado_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('ds-b2:ped')), 89290::bigint, '(b) las dos amortizaciones suman el costo del pedido (10 x 89.29)');
select is((select por_pagar_cent from jsonb_to_record(api.ds_ficha(pg_temp.ped('ds-b2:ped'))) as x(por_pagar_cent bigint)), 0::bigint, '(b) por pagar a Karen = 0');

-- ---------------------------------------------------------------------------
-- (c) Amortizaciones parciales de un pedido; pago por inversion: reembolso por omision, capital solo si se declara
-- ---------------------------------------------------------------------------
select operacion.ds_crear_pedido('ds-c', pg_temp.cli('DS Cliente Dos'), '[{"modelo":"DS Modelo 25K","sabor":"Sandia","piezas":100}]'::jsonb, 'karen_directo', pg_temp.dest('Persona Sintetica Tres'));
select operacion.confirmar_pedido('ds-c-c', pg_temp.ped('ds-c:ped')); select operacion.enviar_pedido('ds-c-e', pg_temp.ped('ds-c:ped'), null, null, null, true);
select operacion.registrar_aportacion('ds-c1-dep', 'Angelo', 300000, 'deposito a caja', 'reembolso');
select operacion.ds_pagar_proveedor('ds-c1', 'Karen', 300000, 'sociedad', null, null, pg_temp.ped('ds-c:ped'));
select operacion.ds_pagar_proveedor('ds-c2', 'Karen', 200000, 'socio_propio', 'Javier', null, pg_temp.ped('ds-c:ped'));
select operacion.ds_pagar_proveedor('ds-c3', 'Karen', 100000, 'socio_capital', 'Angelo', null, pg_temp.ped('ds-c:ped'));
select is((select amortizado_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('ds-c:ped')), 600000::bigint, '(c) tres pagos parciales amortizan 6,000.00');
select is((select (por_pagar_cent) from jsonb_to_record(api.ds_ficha(pg_temp.ped('ds-c:ped'))) as x(por_pagar_cent bigint)), 292900::bigint, '(c) quedan por pagar 2,929.00');
select is((select clasificacion from operacion.aportacion_socio where concepto like '%Karen%' and monto_cent = 200000), 'reembolsable', '(c) el dinero propio del socio es REEMBOLSO por omision');
select is((select clasificacion from operacion.aportacion_socio where concepto like '%Karen%' and monto_cent = 100000), 'capital', '(c) y capital solo cuando se declara');
select is(pg_temp.fallan(), '', '(c) libro conciliado tras amortizaciones y pagos de socios');
select operacion.registrar_aportacion('ds-c4-dep', 'Angelo', 400000, 'deposito a caja', 'reembolso');
select operacion.ds_pagar_proveedor('ds-c4', 'Karen', 400000, 'sociedad', null, null, pg_temp.ped('ds-c:ped'));
select is((select amortizado_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('ds-c:ped')), 892900::bigint, '(c) la amortizacion se topa en el costo; el resto queda a cuenta');
select is((select (r->>'a_cuenta_cent')::bigint from seguridad.operacion o, lateral (select o.resultado as r) q where o.clave = 'ds-c4'), 107100::bigint, '(c) 1,071.00 quedan como saldo a favor a cuenta');
select is(pg_temp.fallan(), '', '(c) libro conciliado con pago de mas');
select throws_ok($$select operacion.ds_pagar_proveedor('ds-c5', 'Karen', 100, 'socio_propio', null)$$, '23502', null, 'el pago de un socio exige indicar el socio');
select throws_ok($$select operacion.ds_pagar_proveedor('ds-c6', 'Karen', 100, 'cliente_a_proveedor')$$, '23502', null, 'el pago directo del cliente exige indicar el cliente');
select throws_ok($$select operacion.ds_pagar_proveedor('ds-c7', 'Isaac', 100, 'sociedad', null, null, (select pedido_id from operacion.pedido_ds limit 1))$$, '22023', null, 'no se amortiza un pedido de otro proveedor');

-- ---------------------------------------------------------------------------
-- (d) Credito: 10 % de UNA semana, simple, monto pactado fijo; otro porcentaje o monto por venta
-- ---------------------------------------------------------------------------
select operacion.ds_crear_pedido('ds-d', pg_temp.cli('DS Cliente Dos'), '[{"modelo":"DS Modelo 25K","sabor":"Menta","piezas":200}]'::jsonb, 'karen_directo', pg_temp.dest('Persona Sintetica Cuatro'), '{"semanas":1}'::jsonb);
create temp table _d as select resultado as r from seguridad.operacion where clave = 'ds-d';
select is((select (r->>'interes_cent')::bigint from _d), 260000::bigint, '(d) 200 x 130.00 = 26,000.00 a una semana al 10 % => interes 2,600.00');
select is((select (r->>'total_credito_cent')::bigint from _d), 2860000::bigint, '(d) total pactado 28,600.00');
select is((select fecha_pago_pactada from operacion.pedido_credito where pedido_id = pg_temp.ped('ds-d:ped')), negocio.hoy() + 7, '(d) fecha de pago pactada = una semana');
select is((select modo from operacion.pedido_credito where pedido_id = pg_temp.ped('ds-d:ped')), 'simple', '(d) interes simple por omision');
select is((select recargo_cent from operacion.pedido where id = pg_temp.ped('ds-d:ped')), 260000::bigint, '(d) el interes es el recargo por credito del pedido');
select operacion.confirmar_pedido('ds-d-c', pg_temp.ped('ds-d:ped')); select operacion.enviar_pedido('ds-d-e', pg_temp.ped('ds-d:ped'), null, null, null, true);
select is(operacion.pedido_cobrado(pg_temp.ped('ds-d:ped')), 2860000::bigint, '(d) la nota cobra 28,600.00');
select is(pg_temp.fallan(), '', '(d) libro conciliado con venta a credito (interes en la venta)');
select is((select jsonb_array_length(api.ds_por_cobrar()->'filas')), 1, '(d) aparece en Por cobrar');
select is((api.ds_por_cobrar()->'filas'->0->>'saldo_cliente_cent')::bigint, 2860000::bigint, '(d) con saldo 28,600.00');
select is((api.ds_por_cobrar()->'filas'->0->>'dias_para_vencer')::int, 7, '(d) vence en 7 dias');
select operacion.registrar_pago('ds-d-cobro', 'Javier', 2860000, pg_temp.cli('DS Cliente Dos'), jsonb_build_array(jsonb_build_object('pedido_id', pg_temp.ped('ds-d:ped'), 'monto_cent', 2860000)), true, 'abono');
select is(operacion.pedido_saldo(pg_temp.ped('ds-d:ped')), 0::bigint, '(d) liquidado a la semana: no hay mas interes');
select is(pg_temp.fallan(), '', '(d) libro conciliado tras cobrar el credito');
-- otro porcentaje, semanas por fecha de pago y monto pactado fijo
select operacion.ds_crear_pedido('ds-d2', pg_temp.cli('DS Cliente Dos'), '[{"modelo":"DS Modelo 25K","sabor":"Mora","piezas":10}]'::jsonb, 'karen_directo', null, jsonb_build_object('tasa_semanal_bp', 500, 'fecha_pago', (negocio.hoy() + 15)::text));
select is((select semanas from operacion.pedido_credito where pedido_id = pg_temp.ped('ds-d2:ped')), 3, '(d) 15 dias => 3 semanas (hacia arriba)');
select is((select interes_cent from operacion.pedido_credito where pedido_id = pg_temp.ped('ds-d2:ped')), 19500::bigint, '(d) 10 x 130.00 = 1,300.00 x 5 % x 3 semanas = 195.00');
select operacion.ds_crear_pedido('ds-d3', pg_temp.cli('DS Cliente Dos'), '[{"modelo":"DS Modelo 25K","sabor":"Limon","piezas":10}]'::jsonb, 'karen_directo', null, '{"interes_cent": 12345, "semanas": 1}'::jsonb);
select is((select interes_cent || modo from operacion.pedido_credito where pedido_id = pg_temp.ped('ds-d3:ped')), '12345fijo', '(d) monto pactado fijo por venta');
select is((select recargo_cent from operacion.pedido where id = pg_temp.ped('ds-d3:ped')), 12345::bigint, '(d) y es el recargo del pedido');
select operacion.ds_crear_pedido('ds-d4', pg_temp.cli('DS Cliente Dos'), '[{"modelo":"DS Modelo 25K","sabor":"Cereza","piezas":10}]'::jsonb, 'karen_directo', null, null);
select is((select count(*) from operacion.pedido_credito where pedido_id = pg_temp.ped('ds-d4:ped')), 0::bigint, '(d) sin credito = contado, sin terminos');

-- ---------------------------------------------------------------------------
-- (e) Venta interna a costo del socio para su menudeo: precio = costo, sin utilidad
-- ---------------------------------------------------------------------------
-- El socio de menudeo es Angelo por omision; para este pedido de Javier se parametriza a Javier (solo el socio de menudeo mete pedidos a costo).
select pg_temp.como('Javier');
update operacion.ds_recordatorio_config set socio_menudeo = (select id from catalogo.socio where nombre = 'Javier') where id = 1;
select operacion.ds_crear_pedido('ds-e', pg_temp.cli('DS Socio Menudeo'), '[{"modelo":"DS Modelo 25K","sabor":"Coco","piezas":50}]'::jsonb, 'karen_directo', pg_temp.dest('Persona Sintetica Cinco'), null, 'socio_a_costo', 'Javier', null, 0, 0, null, null, null, negocio.hoy() + 7);
update operacion.ds_recordatorio_config set socio_menudeo = (select id from catalogo.socio where nombre = 'Angelo') where id = 1;
select pg_temp.como('Angelo');
select is((select (r->>'margen_estimado_cent')::bigint from seguridad.operacion o, lateral (select o.resultado r) q where o.clave = 'ds-e'), 0::bigint, '(e) a costo: margen cero');
select is((select precio_cent from operacion.pedido_linea where pedido_id = pg_temp.ped('ds-e:ped')), 8929::bigint, '(e) el precio es exactamente el costo de Karen');
select throws_ok($$select operacion.ds_crear_pedido('ds-e2', pg_temp.cli('DS Socio Menudeo'), '[{"modelo":"DS Modelo 25K","sabor":"Coco","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', null, null, 0, 0, null, null, null, negocio.hoy() + 7)$$, '22023', null, '(e) la venta a costo exige el socio');
select operacion.confirmar_pedido('ds-e-c', pg_temp.ped('ds-e:ped')); select operacion.enviar_pedido('ds-e-e', pg_temp.ped('ds-e:ped'), null, null, null, true);
select is((select utilidad_cent from operacion.v_ds_utilidad where pedido_id = pg_temp.ped('ds-e:ped')), 0::bigint, '(e) no genera utilidad');
select is((select count(*) from operacion.pedido_aviso where pedido_id = pg_temp.ped('ds-e:ped') and codigo = 'venta_bajo_costo'), 1::bigint, '(e) el aviso de venta a costo se mostro y se acepto al enviar');
select operacion.ds_pagar_proveedor('ds-e-p', 'Karen', 446450, 'cliente_a_proveedor', null, pg_temp.cli('DS Socio Menudeo'), pg_temp.ped('ds-e:ped'));
select is((select reinvertida_cent from operacion.v_ds_utilidad where pedido_id = pg_temp.ped('ds-e:ped')), 0::bigint, '(e) a costo: nada reinvertido');
select is(pg_temp.fallan(), '', '(e) libro conciliado con venta interna a costo');

-- ---------------------------------------------------------------------------
-- (f) Pedido mixto del mismo cliente: dropshipping + inventario en Merida
-- ---------------------------------------------------------------------------
select catalogo.asegurar_cliente('DS Persona Bodega', 'Javier');
select api.registrar_persona_bodega('ds:pb', pg_temp.cli('DS Persona Bodega'));
select operacion.registrar_movimiento('ds-inv', 'DS Modelo 25K', 'Cafe', 'bodega_omar', 'entrada_compra', 30, 270000, negocio.hoy() - 3);
select operacion.crear_pedido('ds-f-inv', pg_temp.cli('DS Cliente Uno'), '[{"modelo":"DS Modelo 25K","sabor":"Cafe","piezas":20}]'::jsonb, 'bodega_omar');
select operacion.ds_crear_pedido('ds-f-ds', pg_temp.cli('DS Cliente Uno'), '[{"modelo":"DS Modelo 25K","sabor":"Vainilla","piezas":20}]'::jsonb, 'karen_directo', pg_temp.dest('Persona Sintetica Seis'));
select operacion.confirmar_pedido('ds-f-ic', pg_temp.ped('ds-f-inv')); select operacion.enviar_pedido('ds-f-ie', pg_temp.ped('ds-f-inv'), null, null, null, true);
select operacion.confirmar_pedido('ds-f-dc', pg_temp.ped('ds-f-ds:ped')); select operacion.enviar_pedido('ds-f-de', pg_temp.ped('ds-f-ds:ped'), null, null, null, true);
select is(jsonb_array_length(api.ds_pedidos('inventario_merida', null, null, pg_temp.cli('DS Cliente Uno'))), 1, '(f) el filtro Inventario en Merida trae solo el de bodega');
select is(jsonb_array_length(api.ds_pedidos('dropshipping', null, null, pg_temp.cli('DS Cliente Uno'))), 3, '(f) el filtro Dropshipping trae los de dropshipping del cliente');
select is(jsonb_array_length(api.ds_pedidos(null, null, null, pg_temp.cli('DS Cliente Uno'))), 4, '(f) Todos trae los cuatro');
select is((select count(*) from operacion.movimiento_inventario where tipo = 'salida_pedido' and evento_id = (select evento_envio_id from operacion.pedido where id = pg_temp.ped('ds-f-ds:ped'))), 0::bigint, '(f) el de dropshipping no mueve inventario');
select is((select count(*) from operacion.movimiento_inventario where tipo = 'salida_pedido' and evento_id = (select evento_envio_id from operacion.pedido where id = pg_temp.ped('ds-f-inv'))), 1::bigint, '(f) el de bodega si');
select is(pg_temp.fallan(), '', '(f) libro conciliado con pedido mixto');
create temp table _res as select api.ds_resumen() as r;
select is((select jsonb_array_length(r->'por_origen') from _res), 2, 'el resumen siempre trae las dos columnas');
select is((select (x->>'pedidos')::int from _res, jsonb_array_elements(r->'por_origen') x where x->>'origen_surtido' = 'inventario_merida'), 1, 'resumen: 1 pedido enviado desde inventario');
select is((select (x->>'piezas')::int from _res, jsonb_array_elements(r->'por_origen') x where x->>'origen_surtido' = 'dropshipping'), (select sum(piezas_surtidas)::int from operacion.v_ds_pedido where origen_surtido = 'dropshipping' and estado = 'enviado'), 'resumen: piezas de dropshipping = suma de pedidos');
select is((select (x->>'venta_cent')::bigint from _res, jsonb_array_elements(r->'por_origen') x where x->>'origen_surtido' = 'dropshipping'), (select sum(venta_cent)::bigint from operacion.v_ds_pedido where origen_surtido = 'dropshipping' and estado = 'enviado'), 'resumen: venta de dropshipping = suma de pedidos');
select is((api.ds_explicar('ds:venta:todos:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar venta: dos vias cuadran');
select is((api.ds_explicar('ds:costo:dropshipping:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar costo: dos vias cuadran');
select is((api.ds_explicar('ds:margen:todos:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar margen: dos vias cuadran');
select is((api.ds_explicar('ds:piezas:todos:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar piezas: dos vias cuadran');
select is((api.ds_explicar('ds:pedidos:dropshipping:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar pedidos: dos vias cuadran');
select throws_ok($$select api.ds_explicar('ds:raro:todos:-:-')$$, '22023', null, 'cifra desconocida');
select is((select sum((x->>'venta_cent')::bigint)::bigint from jsonb_array_elements(api.ds_desglose('modelo')) x), (select sum(venta_cent)::bigint from operacion.v_ds_surtido), 'desglose por modelo suma la venta de mercancia');
select is((select sum((x->>'pedidos')::int)::bigint from jsonb_array_elements(api.ds_desglose('semana')) x), (select count(*)::bigint from operacion.v_ds_pedido where estado = 'enviado'), 'desglose por semana cuenta todos los enviados');
select is(jsonb_array_length(api.ds_desglose('mes')), 1, 'desglose por mes');
select is(jsonb_array_length(api.ds_desglose('cliente')), 3, 'desglose por cliente');
select is(jsonb_array_length(api.ds_desglose('sabor')), (select count(distinct sabor)::int from operacion.v_ds_surtido), 'desglose por sabor');
select throws_ok($$select api.ds_desglose('raro')$$, '22023', null, 'dimension invalida');

-- ---------------------------------------------------------------------------
-- (g) 120 piezas en 15 sabores
-- ---------------------------------------------------------------------------
create temp table _g as select jsonb_agg(jsonb_build_object('modelo', 'DS Modelo 25K', 'sabor', s, 'piezas', 8)) as l from unnest(array['Fresa','Mango','Uva','Sandia','Menta','Mora','Durazno','Limon','Cereza','Kiwi','Coco','Pina','Cafe','Vainilla','Manzana']) s;
select operacion.ds_crear_pedido('ds-g', pg_temp.cli('DS Cliente Dos'), (select l from _g), 'karen_directo', pg_temp.dest('Persona Sintetica Siete'));
select is((select (r->>'piezas')::int from seguridad.operacion o, lateral (select o.resultado r) q where o.clave = 'ds-g'), 120, '(g) 120 piezas');
select is((select count(*) from operacion.pedido_linea where pedido_id = pg_temp.ped('ds-g:ped')), 15::bigint, '(g) 15 renglones (un sabor por renglon)');
create temp table _og as select api.ds_orden_proveedor(pg_temp.ped('ds-g:ped'), true) as o;
select is((select count(*) from regexp_matches((select o->>'texto' from _og), E'\n- [A-Za-z]+ x 8', 'g')), 15::bigint, '(g) la orden lista los 15 sabores');
select is((select o->>'texto' from _og) like '%DS Marca DS Modelo 25K (120 pzas)%Total: 120 pzas%', true, '(g) agrupa por marca y modelo con el total');
select operacion.confirmar_pedido('ds-g-c', pg_temp.ped('ds-g:ped')); select operacion.enviar_pedido('ds-g-e', pg_temp.ped('ds-g:ped'), null, null, null, true);
select is(pg_temp.fallan(), '', '(g) libro conciliado con 120 piezas en 15 sabores');

-- ---------------------------------------------------------------------------
-- (h) Piezas faltantes: surtido parcial y ajuste a la cuenta del proveedor; anulacion
-- ---------------------------------------------------------------------------
select operacion.ds_crear_pedido('ds-h', pg_temp.cli('DS Cliente Dos'), '[{"modelo":"DS Modelo 25K","sabor":"Pina","piezas":50}]'::jsonb, 'karen_directo', pg_temp.dest('Persona Sintetica Ocho'));
select operacion.confirmar_pedido('ds-h-c', pg_temp.ped('ds-h:ped'));
select operacion.enviar_pedido('ds-h-e', pg_temp.ped('ds-h:ped'), jsonb_build_array(jsonb_build_object('linea_id', (select id from operacion.pedido_linea where pedido_id = pg_temp.ped('ds-h:ped')), 'piezas', 40)), null, null, true, 'pieza_no_llego');
select is((select piezas_surtidas from operacion.v_ds_pedido where pedido_id = pg_temp.ped('ds-h:ped')), 40, '(h) Karen surtio 40 de 50');
select is((select costo_cent from operacion.v_ds_pedido where pedido_id = pg_temp.ped('ds-h:ped')), 357160::bigint, '(h) el costo es solo de lo surtido (40 x 89.29)');
select is((select count(*) from operacion.pedido_ajuste where pedido_id = pg_temp.ped('ds-h:ped') and tipo = 'pieza_no_llego'), 1::bigint, '(h) las 10 piezas quedan como pieza que no llego');
select is(pg_temp.fallan(), '', '(h) libro conciliado con surtido parcial');
select operacion.registrar_ajuste_proveedor('ds-h-aj', 'Karen', 8929, 'descuento_proveedor', 'ajuste sintetico por una pieza danada');
select is(pg_temp.fallan(), '', '(h) libro conciliado con ajuste de proveedor');
select operacion.anular_pedido('ds-h-an', pg_temp.ped('ds-h:ped'), 'cancelacion sintetica');
select is((select estado from operacion.pedido where id = pg_temp.ped('ds-h:ped')), 'anulado', '(h) pedido anulado');
select is(pg_temp.fallan(), '', '(h) libro conciliado tras anular el pedido');
select is(operacion.origen_surtido((select origen from operacion.pedido where id = pg_temp.ped('ds-h:ped'))), 'dropshipping', '(h) el anulado sigue siendo de dropshipping (no se cuenta como venta)');

-- ---------------------------------------------------------------------------
-- Utilidad: caso del dueno (venta/deposito 10,480, costo 8,929, utilidad 1,551, 775.50 por socio); cuenta corriente y reporte mensual
-- ---------------------------------------------------------------------------
select is((select (x->>'utilidad_cent')::bigint from jsonb_array_elements(api.ds_utilidad()->'filas') x where x->>'pedido_id' = pg_temp.ped('ds-a:ped')::text), 155100::bigint, 'por pedido: utilidad 1,551.00');
select is((select (y->>'utilidad_cent')::bigint from jsonb_array_elements(api.ds_utilidad()->'filas') x, jsonb_array_elements(x->'socios') y where x->>'pedido_id' = pg_temp.ped('ds-a:ped')::text and y->>'socio' = 'Angelo'), 77550::bigint, 'por pedido: 775.50 a Angelo');
select is((select sum((y->>'utilidad_cent')::bigint)::bigint from jsonb_array_elements(api.ds_utilidad()->'filas') x, jsonb_array_elements(x->'socios') y), (api.ds_utilidad()->'totales'->>'utilidad_cent')::bigint, 'la suma de las partes de los socios = la utilidad total (centavos impares incluidos)');
select is((select coalesce(sum(reinvertida_cent), 0)::bigint from operacion.v_ds_utilidad where pedido_id = pg_temp.ped('ds-c:ped')), 0::bigint, 'un pedido pagado por la sociedad o los socios no genera utilidad reinvertida en el proveedor');
create temp table _ds as select * from operacion.ds_reparto(155101);
select is((select monto_cent from _ds order by socio_id limit 1), 77551::bigint, 'centavo impar: medio hacia arriba al primer socio');
select is((select sum(monto_cent)::bigint from _ds), 155101::bigint, '... y el segundo recibe el resto: suma exacta');
create temp table _cp as select api.ds_cuenta_proveedor('Karen') as c;
select is((select (c->>'saldo_cent')::bigint from _cp), operacion.saldo_proveedor(catalogo.proveedor_id('Karen')) - contabilidad.directos_proveedor('Karen'), 'cuenta de Karen: saldo = cuenta corriente menos el costo de los directos enviados');
select is((select jsonb_array_length(c->'pagos') from _cp) > 3, true, 'cuenta de Karen: lista los pagos con su amortizacion');
create temp table _rm as select api.ds_reporte_mensual(2) as r;
select is((select jsonb_array_length(r->'meses') from _rm), 2, 'reporte mensual: dos meses');
select is((select (r->'meses'->1->>'utilidad_cent')::bigint from _rm), (api.ds_utilidad()->'totales'->>'utilidad_cent')::bigint, 'reporte mensual: utilidad del mes actual');
select is((select (r->'meses'->1->'socios'->0->>'sugerido_acta_cent')::bigint from _rm), (select (x->>'reinvertida_cent')::bigint from jsonb_array_elements(api.ds_utilidad()->'totales'->'socios') x where x->>'socio' = 'Angelo'), 'reporte mensual: sugerido para el acta = reinvertida en el proveedor');
select is((select (r->'meses'->1->'socios'->0->>'capital_declarado_cent')::bigint from _rm), 100000::bigint, 'reporte mensual: capital declarado de Angelo (el pago por inversion declarado)');
select is((select r->'meses'->1->'socios'->0->>'valuacion_cent' from _rm) is not null, true, 'reporte mensual: valuacion por socio');

-- Valuacion y acta: la reinversion del acta sube el capital del socio y no duplica nada
select is(pg_temp.fallan(), '', 'al final: libro conciliado (C1..C24, CU1..CU3) con todos los escenarios');

-- Telegram / canales de sistema no crean ni leen destinatarios
select set_config('request.jwt.claim.sub', '', true), set_config('rtm.canal', 'telegram', true);
select throws_ok($$select operacion.ds_capturar_destinatario('ds-tg', 1, '{"nombre":"Ana Sintetica"}')$$, '42501', null, 'el canal de Telegram no captura destinatarios');
select throws_ok($$select operacion.ds_crear_pedido('ds-tg2', 1, '[]'::jsonb, 'karen_directo', pg_temp.dest())$$, '42501', null, 'ni crea pedidos con destinatario');
select throws_ok($$select api.ds_destinatario_revelar(1, 'telefono')$$, '42501', null, 'ni revela telefonos');
select is(operacion.ds_crear_pedido('ds-tg3', pg_temp.cli('DS Cliente Uno'), '[{"modelo":"DS Modelo 25K","sabor":"Fresa","piezas":2}]'::jsonb, 'karen_directo') ->> 'tiene_destinatario', 'false', 'el canal de Telegram SI puede crear el pedido SIN destinatario (se captura despues en la web)');

select * from finish();
rollback;
