-- pgTAP: PAGO de un pedido a costo con politica de confirmacion. El socio debe pagar el TOTAL; pendiente de pago -> pago reportado -> pagado. Con evidencia (solo web) o si lo registra el otro
-- socio, basta registrar; sin evidencia reportado por el dueno del pedido (Telegram o web), sigue pendiente hasta que el OTRO socio confirme o rechace. Parcial deja saldo. Los pedidos a costo
-- no cambian valuacion ni aportacion neta. Datos sinteticos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a2p.ang@example.test', 'socio', 'Angelo', true), ('a2p.jav@example.test', 'socio', 'Javier', true), ('a2p.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-5555555500a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2p.ang@example.test'),
  ('88888888-8888-8888-8888-5555555500a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2p.jav@example.test'),
  ('88888888-8888-8888-8888-5555555500a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2p.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-5555555500a1' when 'Omar' then '88888888-8888-8888-8888-5555555500a3' else '88888888-8888-8888-8888-5555555500a2' end, true) $$;
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
create temp table _s as select (api.apertura_crear('a2p:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('a2p:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('a2p:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('a2p:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('a2p:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('a2p:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('a2p:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('a2p:f2', (select id from _s));
select pg_temp.como('Angelo');




select catalogo.asegurar_modelo('A2P Marca', 'A2P Modelo 25K', 25000, 'ambas');
select catalogo.asegurar_sku('A2P Modelo 25K', 'Fresa');
select catalogo.fijar_costo('a2p-c1', 'Karen', 'A2P Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('a2p-c2', 'Isaac', 'A2P Modelo 25K', 9000, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('A2P Stock Angelo', 'Angelo');
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar('A2P Stock Angelo') $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.v03() returns bigint language plpgsql as $$ begin set constraints all immediate; perform contabilidad.asentar_pendientes(); return (contabilidad.valuacion()->>'v03_diferencia_cent')::bigint; end $$;
create function pg_temp.neta(p text) returns bigint language sql as $$ select (x->>'aportacion_neta_cent')::bigint from jsonb_array_elements(api.socios_aportacion_neta()->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.web(p text) returns void language plpgsql as $$ begin perform set_config('rtm.canal', '', true); perform pg_temp.como(p); end $$;
create function pg_temp.bot() returns void language sql as $$ select set_config('request.jwt.claim.sub', '', true), set_config('rtm.canal', 'telegram', true) $$;
create function pg_temp.estado(p bigint) returns text language sql as $$ select f->>'estado_pago' from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = p $$;
create function pg_temp.pend(p bigint) returns bigint language sql as $$ select (f->>'pendiente_cent')::bigint from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = p $$;
create temp table _png as select encode('\x89504e470d0a1a0a0000000d49484452'::bytea, 'base64') as b;
create temp table _pdf as select encode('\x255044462d312e340a'::bytea, 'base64') as b;
create temp table _base as select pg_temp.v03() as v03, pg_temp.neta('Angelo') as na, pg_temp.neta('Javier') as nj, (select count(*) from operacion.aportacion_socio) as ap;

select operacion.ds_crear_pedido('a2p-1', pg_temp.cli(), '[{"modelo":"A2P Modelo 25K","sabor":"Fresa","piezas":100}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, negocio.hoy() - 3);
select operacion.ds_crear_pedido('a2p-2', pg_temp.cli(), '[{"modelo":"A2P Modelo 25K","sabor":"Fresa","piezas":50}]'::jsonb, 'isaac_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, negocio.hoy() - 2);
select operacion.confirmar_pedido('a2p-1c', pg_temp.ped('a2p-1:ped')); select operacion.enviar_pedido('a2p-1e', pg_temp.ped('a2p-1:ped'), null, null, null, true);
select operacion.confirmar_pedido('a2p-2c', pg_temp.ped('a2p-2:ped')); select operacion.enviar_pedido('a2p-2e', pg_temp.ped('a2p-2:ped'), null, null, null, true);
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'no_pagado', 'sin pago: pendiente de pago (estado no_pagado)');
select is(pg_temp.pend(pg_temp.ped('a2p-1:ped')), 892900::bigint, 'debe pagar el TOTAL del costo: 8,929.00');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-x0', null, null, 100, 'raro')$$, '22023', null, 'metodo invalido');

-- (b) Telegram sin evidencia, reporta el dueno del pedido: sigue pendiente hasta confirmacion del otro socio
select pg_temp.bot();
create temp table _r1 as select operacion.ds_reportar_pago_menudeo('a2p-r1', null, (select folio from operacion.pedido where id = pg_temp.ped('a2p-1:ped')), 300000, 'transferencia', 'REF-TG-001', negocio.hoy(), 'proveedor', null, null, null, 'Angelo') as r;
select pg_temp.web('Angelo');
select is((select (r->>'aplicado')::boolean from _r1), false, 'Telegram sin evidencia: no se aplica');
select is((select r->>'estado' from _r1), 'pago_reportado', 'estado Pago reportado');
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'pago_reportado', 'la pantalla muestra Pago reportado');
select is(pg_temp.pend(pg_temp.ped('a2p-1:ped')), 892900::bigint, 'el pedido SIGUE pendiente de pago por el total hasta confirmar');
select is((api.ds_menudeo('Angelo')->'totales'->>'reportado_cent')::bigint, 300000::bigint, 'el total reportado por confirmar se muestra aparte');
select is(operacion.pedido_saldo(pg_temp.ped('a2p-1:ped')), 892900::bigint, 'el libro no aplico nada');
select pg_temp.bot();
select throws_ok($$select operacion.ds_reportar_pago_menudeo('a2p-r1e', null, null, 100, 'transferencia', 'X', null, 'proveedor', (select b from _png), 'image/png', 'ticket.png', 'Angelo')$$, '22023', null, 'Telegram no adjunta evidencia: el bot no lee ni recibe tickets');
select throws_ok($$select api.ds_decidir_pago_menudeo('a2p-d0', 1, 'confirmado')$$, '42501', null, 'el bot no confirma ni rechaza (solo socios en la web)');
select pg_temp.web('Angelo');
select throws_ok($$select api.ds_decidir_pago_menudeo('a2p-d1', (select (r->>'reporte_id')::bigint from _r1), 'confirmado')$$, '42501', null, 'el propio socio no puede confirmar su pago: lo hace el OTRO');
select is(pg_temp.v03(), (select v03 from _base), 'pago reportado: valuacion neta intacta');
select pg_temp.web('Javier');
select throws_ok($$select api.ds_decidir_pago_menudeo('a2p-d2', (select (r->>'reporte_id')::bigint from _r1), 'rechazado')$$, '23502', null, 'rechazar exige motivo');
select api.ds_decidir_pago_menudeo('a2p-d3', (select (r->>'reporte_id')::bigint from _r1), 'confirmado');
select is(pg_temp.pend(pg_temp.ped('a2p-1:ped')), 592900::bigint, 'confirmado: se aplica 3,000.00 y el saldo queda pendiente (parcial)');
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'no_pagado', 'un pago parcial NO lo marca pagado');
select throws_ok($$select api.ds_decidir_pago_menudeo('a2p-d4', (select (r->>'reporte_id')::bigint from _r1), 'confirmado')$$, 'P0428', null, 'un reporte ya resuelto no se decide otra vez');
select is(api.ds_decidir_pago_menudeo('a2p-d3', (select (r->>'reporte_id')::bigint from _r1), 'confirmado') ->> 'decision', 'confirmado', 'misma clave: mismo resultado, sin duplicar');
select is(pg_temp.fallan(), '', 'Libro conciliado tras confirmar un pago');

-- (c) Web con evidencia adjunta (Angelo): basta registrar
select pg_temp.web('Angelo');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r2x', pg_temp.ped('a2p-1:ped'), null, 700000)$$, '23514', null, 'no se reporta mas de lo pendiente');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r2y', pg_temp.ped('a2p-1:ped'), null, 100, 'transferencia', 'X', negocio.hoy() + 30)$$, '23514', null, 'fecha futura se rechaza');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r2z', pg_temp.ped('a2p-1:ped'), null, 100, 'transferencia', 'X', null, 'proveedor', (select b from _png), 'image/jpeg', 'x.jpg')$$, '22023', null, 'el archivo debe corresponder a su tipo');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r2w', pg_temp.ped('a2p-1:ped'), null, 100, 'transferencia', 'X', null, 'proveedor', (select b from _png), 'text/plain', 'x.txt')$$, '22023', null, 'solo imagen PNG o JPEG, o PDF');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r2v', pg_temp.ped('a2p-1:ped'), null, 100, 'transferencia', 'X', null, 'proveedor', encode('\x89504e47'::bytea || decode(repeat('QUJD', 800000), 'base64'), 'base64'), 'image/png', 'grande.png')$$, '23514', null, 'evidencia de mas de 2 MB se rechaza');
create temp table _r2 as select api.ds_reportar_pago_menudeo('a2p-r2', pg_temp.ped('a2p-1:ped'), null, 592900, 'transferencia', 'CLAVE-RASTREO-77', negocio.hoy(), 'proveedor', (select b from _png), 'image/png', 'ticket.png') as r;
select is((select (r->>'aplicado')::boolean from _r2), true, 'con evidencia: se aplica de inmediato');
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'pagado', 'cubre el total: Pagado');
select is((select r->>'evidencia_sha256' from _r2), encode(sha256(decode((select b from _png), 'base64')), 'hex'), 'huella sha256 calculada en la base sobre los bytes');
select is((select f->'reportes'->1->'evidencia'->>'mime' from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2p-1:ped')), 'image/png', 'la pantalla recibe el metadato de la evidencia');
select is(((select f->'reportes'->1 from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2p-1:ped')))::text like '%iVBOR%', false, 'pero no su contenido');
select is(api.ds_evidencia((select (r->>'reporte_id')::bigint from _r2)) ->> 'b64', (select b from _png), 'un socio descarga el contenido en la web');
select is((select count(*) from entrega.evidencia_lectura), 1::bigint, 'y cada lectura queda registrada');
select is(pg_temp.v03(), (select v03 from _base), 'pagado con evidencia: valuacion neta intacta');
select is(pg_temp.neta('Angelo') || ',' || pg_temp.neta('Javier'), (select na || ',' || nj from _base), 'y aportaciones netas intactas');
select is((select count(*) from operacion.evento where payload::text like '%iVBOR%' or payload::text like '%89504e47%'), 0::bigint, 'ningun evento lleva contenido de la evidencia');
set local role authenticated;
select throws_ok($$select count(*) from entrega.evidencia_pago$$, '42501', null, 'authenticated no lee la tabla de evidencia');
select throws_ok($$select count(*) from operacion.ds_pago_reporte$$, '42501', null, 'ni los reportes directamente');
reset role;
select pg_temp.web('Angelo');
select is(pg_temp.fallan(), '', 'Libro conciliado tras pago con evidencia');

-- (d) El otro socio rechaza un pago ya aplicado con evidencia: se anula y vuelve a pendiente
select pg_temp.web('Javier');
select api.ds_decidir_pago_menudeo('a2p-d5', (select (r->>'reporte_id')::bigint from _r2), 'rechazado', 'el comprobante no coincide con el banco (sintetico)');
select is(pg_temp.pend(pg_temp.ped('a2p-1:ped')), 592900::bigint, 'rechazado: el pago se anula y el pedido vuelve a pendiente de pago');
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'no_pagado', 'estado de nuevo pendiente');
select is((select f->'reportes'->1->>'estado' from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = pg_temp.ped('a2p-1:ped')), 'rechazado', 'el reporte queda rechazado, con su motivo');
select is(pg_temp.fallan(), '', 'Libro conciliado tras anular el pago');

-- (e) Parcial con PDF, luego el OTRO socio registra el resto (basta registrar)
select pg_temp.web('Angelo');
select api.ds_reportar_pago_menudeo('a2p-r3', pg_temp.ped('a2p-1:ped'), null, 100000, 'deposito', 'DEP-9', negocio.hoy(), 'sociedad', (select b from _pdf), 'application/pdf', 'ficha.pdf');
select is(pg_temp.pend(pg_temp.ped('a2p-1:ped')), 492900::bigint, 'parcial con PDF: el saldo sigue pendiente');
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'no_pagado', 'no esta pagado hasta cubrir el total');
select pg_temp.web('Javier');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r4x', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a2p-1:ped'), null, 492900, 'efectivo', 'recibo en mano')$$, '42501', null, 'solo el socio de menudeo (Angelo) registra el pago; Javier solo supervisa, confirma o rechaza');
select pg_temp.web('Angelo');
select is(api.ds_reportar_pago_menudeo('a2p-r4', pg_temp.ped('a2p-1:ped'), null, 492900, 'efectivo', 'recibo en mano', null, 'proveedor', (select b from _png), 'image/png', 'recibo.png') ->> 'aplicado', 'true', 'con evidencia el pago del resto se aplica de inmediato');
select is(pg_temp.estado(pg_temp.ped('a2p-1:ped')), 'pagado', 'cubre el total: Pagado');
select is((api.ds_menudeo('Angelo')->'totales'->>'pendiente_cent')::bigint, 450000::bigint, 'total pendiente del socio = solo su otro pedido (50 x 90.00)');
select is(pg_temp.v03(), (select v03 from _base), 'valuacion neta intacta con pagos por las dos vias');
select is(pg_temp.neta('Angelo'), (select na from _base), 'aportacion neta de Angelo intacta');
select is(pg_temp.fallan(), '', 'Libro conciliado');

-- (f) Reporte sin evidencia por la web: rechazado antes de aplicarse; excedentes por reportes pendientes
select pg_temp.web('Angelo');
create temp table _r5 as select api.ds_reportar_pago_menudeo('a2p-r5', pg_temp.ped('a2p-2:ped'), null, 300000, 'transferencia', 'WEB-SIN-EVID', negocio.hoy(), 'proveedor') as r;
select is((select r->>'estado' from _r5), 'pago_reportado', 'web sin evidencia del dueno: Pago reportado, por confirmar');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-r6', pg_temp.ped('a2p-2:ped'), null, 200000)$$, '23514', null, 'lo ya reportado por confirmar se descuenta del tope: 4,500.00 - 3,000.00 = 1,500.00');
select is((select (x->>'reportado_cent')::bigint from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), 300000::bigint, 'Inicio: pagos reportados por confirmar');
select is((select (x->>'pendiente_cent')::bigint from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), 450000::bigint, 'Inicio: el pendiente de pago no baja hasta confirmar');
select is((api.ds_explicar_menudeo('dsm:Angelo:reportado:-:-')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar pagos reportados: dos vias cuadran');
select is((api.ds_menudeo('Angelo', null, null, null, 'pago_reportado')->'totales'->>'pedidos')::int, 1, 'filtro por estado Pago reportado');
select pg_temp.web('Javier');
select api.ds_decidir_pago_menudeo('a2p-d6', (select (r->>'reporte_id')::bigint from _r5), 'rechazado', 'no llego a la cuenta (sintetico)');
select is(pg_temp.estado(pg_temp.ped('a2p-2:ped')), 'no_pagado', 'rechazado sin aplicar: vuelve a pendiente sin tocar el libro');
select is(pg_temp.pend(pg_temp.ped('a2p-2:ped')), 450000::bigint, 'y el pendiente sigue completo');
select is((select (x->>'reportado_cent')::bigint from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), 0::bigint, 'ya nada por confirmar');
select is(pg_temp.fallan(), '', 'Libro conciliado al final');
-- idempotencia y permisos
select pg_temp.web('Angelo');
select is(api.ds_reportar_pago_menudeo('a2p-r5', pg_temp.ped('a2p-2:ped'), null, 300000, 'transferencia', 'WEB-SIN-EVID', negocio.hoy(), 'proveedor') -> 'reporte_id', (select r->'reporte_id' from _r5), 'misma clave: mismo reporte, sin duplicar');
select pg_temp.como('Omar');
select throws_ok($$select api.ds_reportar_pago_menudeo('a2p-o', 1, null, 100)$$, '42501', null, 'Omar no reporta pagos');
select throws_ok($$select api.ds_evidencia(1)$$, '42501', null, 'ni descarga evidencia');
select * from finish();
rollback;
