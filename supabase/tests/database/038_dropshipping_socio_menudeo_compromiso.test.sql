-- pgTAP: SOCIO DE MENUDEO (Angelo por omision; parametro editable), FECHA COMPROMETIDA de pago, VENCIDO con dias de atraso, reprogramaciones con historial y RECORDATORIOS (por vencer, vence hoy,
-- vencido periodico) sin datos personales. Solo el socio de menudeo mete pedidos a costo, registra su pago y programa; el otro socio supervisa y confirma o rechaza. No cambian valuacion ni aportacion neta.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cmp.ang@example.test', 'socio', 'Angelo', true), ('cmp.jav@example.test', 'socio', 'Javier', true), ('cmp.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-2222222200a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmp.ang@example.test'),
  ('88888888-8888-8888-8888-2222222200a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmp.jav@example.test'),
  ('88888888-8888-8888-8888-2222222200a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cmp.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-2222222200a1' when 'Omar' then '88888888-8888-8888-8888-2222222200a3' else '88888888-8888-8888-8888-2222222200a2' end, true) $$;
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
create temp table _s as select (api.apertura_crear('cmp:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('cmp:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('cmp:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('cmp:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('cmp:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('cmp:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('cmp:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('cmp:f2', (select id from _s));
select pg_temp.como('Angelo');





select catalogo.asegurar_modelo('CMP Marca', 'CMP Modelo 25K', 25000, 'ambas'); select catalogo.asegurar_sku('CMP Modelo 25K', 'Fresa');
select catalogo.fijar_costo('cmp-c1', 'Karen', 'CMP Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('CMP Stock Angelo', 'Angelo'); select catalogo.asegurar_cliente('CMP Stock Javier', 'Javier');
create function pg_temp.cli(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar($1) $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.web(p text) returns void language plpgsql as $$ begin perform set_config('rtm.canal', '', true); perform pg_temp.como(p); end $$;
create function pg_temp.bot() returns void language sql as $$ select set_config('request.jwt.claim.sub', '', true), set_config('rtm.canal', 'telegram', true) $$;
create function pg_temp.v03() returns bigint language plpgsql as $$ begin set constraints all immediate; perform contabilidad.asentar_pendientes(); return (contabilidad.valuacion()->>'v03_diferencia_cent')::bigint; end $$;
create function pg_temp.neta(p text) returns bigint language sql as $$ select (x->>'aportacion_neta_cent')::bigint from jsonb_array_elements(api.socios_aportacion_neta()->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.fila(p bigint) returns jsonb language sql as $$ select f from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = $1 $$;
create function pg_temp.rec(p_ahora timestamptz) returns jsonb language sql as $$ select api.ds_recordatorios_pago_menudeo($1)->'recordatorios' $$;
create function pg_temp.tipo(p bigint, p_ahora timestamptz) returns text language sql as $$ select x->>'tipo' from jsonb_array_elements(pg_temp.rec($2)) x where (x->>'pedido_id')::bigint = $1 $$;
create function pg_temp.enviar(p text, p_lineas jsonb, p_fc date, p_hc time) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform operacion.ds_crear_pedido('cmp-' || p, pg_temp.cli('CMP Stock Angelo'), p_lineas, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, negocio.hoy() - 5, null, null, p_fc, p_hc);
  v := (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cmp-' || p || ':ped');
  perform operacion.confirmar_pedido('cmp-' || p || 'c', v); perform operacion.enviar_pedido('cmp-' || p || 'e', v, null, null, null, true);
  return v;
end $$;
create temp table _base as select pg_temp.v03() as v03, pg_temp.neta('Angelo') as na, pg_temp.neta('Javier') as nj;

-- Socio de menudeo: Angelo por omision; solo el mete pedidos a costo
select is(api.ds_menudeo_config() ->> 'socio_menudeo', 'Angelo', 'el socio de menudeo es Angelo por omision');
select pg_temp.web('Javier');
select throws_ok($$select operacion.ds_crear_pedido('cmp-x1', (select id from catalogo.cliente where nombre_norm = 'cmp stock javier'), '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Javier')$$, '42501', null, 'Javier no mete pedidos a costo (solo supervisa)');
select throws_ok($$select operacion.ds_crear_pedido('cmp-x2', (select id from catalogo.cliente where nombre_norm = 'cmp stock angelo'), '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo')$$, '42501', null, 'ni a nombre de Angelo');
select pg_temp.bot();
select throws_ok($$select operacion.ds_crear_pedido('cmp-x3', (select id from catalogo.cliente where nombre_norm = 'cmp stock javier'), '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Javier')$$, '42501', null, 'tampoco por el canal del bot para otro socio (el agente verifica el autor)');
select pg_temp.web('Angelo');

-- Pedidos de Angelo con y sin fecha comprometida
select throws_ok($$select operacion.ds_crear_pedido('cmp-0', (select id from catalogo.cliente where nombre_norm = 'cmp stock angelo'), '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, null, null, null, negocio.hoy() - 5)$$, '23514', null, 'la fecha comprometida no puede ser pasada');
select throws_ok($$select operacion.ds_crear_pedido('cmp-0b', (select id from catalogo.cliente where nombre_norm = 'cmp stock angelo'), '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Angelo', null, 0, 0, null, null, null, null, '10:00')$$, '23514', null, 'la hora exige fecha');
create temp table _p as select
  pg_temp.enviar('a', '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":10}]'::jsonb, negocio.hoy() + 2, '10:00') as a,
  pg_temp.enviar('b', '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":20}]'::jsonb, null, null) as b,
  pg_temp.enviar('c', '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":30}]'::jsonb, negocio.hoy() + 1, null) as c;
select is((pg_temp.fila((select a from _p))->>'fecha_compromiso')::date, negocio.hoy() + 2, 'el pedido guarda su fecha comprometida');
select is(pg_temp.fila((select a from _p))->>'hora_compromiso', '10:00:00', '... y su hora');
select is(pg_temp.fila((select a from _p))->>'comprometido_por', 'Angelo', '... y quien la comprometio');
select is((pg_temp.fila((select b from _p))->>'sin_fecha')::boolean, true, 'sin fecha comprometida: alerta');
select is((pg_temp.fila((select a from _p))->>'vencido')::boolean, false, 'con compromiso futuro no esta vencido');
select is(pg_temp.fila((select a from _p))->>'estado_pago', 'no_pagado', 'sigue pendiente de pago');
select is((api.ds_menudeo('Angelo')->'totales'->>'sin_fecha')::int, 3 - 2, 'total de pedidos sin fecha comprometida');
select is(jsonb_array_length(api.ds_menudeo(null)->'filas'), 3, 'p_socio null = ambos socios (supervision)');
select pg_temp.web('Javier');
select is(jsonb_array_length(api.ds_menudeo('Angelo')->'filas'), 3, 'Javier ve TODOS los pedidos de Angelo');
select throws_ok($$select api.ds_reportar_pago_menudeo('cmp-y1', (select a from _p), null, 100)$$, '42501', null, 'pero no registra su pago');
select throws_ok($$select api.ds_reprogramar_compromiso('cmp-y2', (select a from _p), negocio.hoy() + 3, null, 'motivo sintetico')$$, '42501', null, 'ni reprograma su compromiso');
select pg_temp.web('Angelo');

-- Vencido con dias de atraso (compromiso historico insertado como superusuario) y reprogramacion con historial
insert into operacion.ds_pedido_compromiso (pedido_id, fecha_compromiso, comprometido_por, tipo, motivo, evento_id)
  select (select c from _p), negocio.hoy() - 3, (select id from catalogo.socio where nombre = 'Angelo'), 'reprogramacion', 'compromiso historico sintetico', (select evento_id from operacion.pedido where id = (select c from _p));
select is((pg_temp.fila((select c from _p))->>'vencido')::boolean, true, 'compromiso pasado y sin pago: VENCIDO');
select is((pg_temp.fila((select c from _p))->>'dias_atraso')::int, 3, 'con 3 dias de atraso');
select is(pg_temp.fila((select c from _p))->>'estado_pago', 'vencido', 'estado Vencido');
select is((api.ds_menudeo('Angelo')->'totales'->>'vencidos')::int, 1, 'total de vencidos');
select is((api.ds_menudeo('Angelo')->'totales'->>'vencido_cent')::bigint, (30 * 8929)::bigint, 'monto vencido');
select is(jsonb_array_length(api.ds_menudeo('Angelo', null, null, null, 'vencido')->'filas'), 1, 'filtro por estado Vencido');
select is((select (x->>'vencidos')::int from jsonb_array_elements(api.ds_menudeo_pendientes()) x where x->>'socio' = 'Angelo'), 1, 'Inicio: cuantos vencidos');
select throws_ok($$select api.ds_reprogramar_compromiso('cmp-r0', (select c from _p), negocio.hoy() + 4)$$, '23502', null, 'reprogramar exige motivo');
select api.ds_reprogramar_compromiso('cmp-r1', (select c from _p), negocio.hoy() + 4, '09:00', 'el proveedor tardo en entregar (sintetico)');
select is((pg_temp.fila((select c from _p))->>'vencido')::boolean, false, 'reprogramado: ya no esta vencido');
select is((pg_temp.fila((select c from _p))->>'fecha_compromiso')::date, negocio.hoy() + 4, 'con la nueva fecha');
select is(jsonb_array_length(pg_temp.fila((select c from _p))->'compromisos'), 3, 'historial: inicial, compromiso historico y reprogramacion');
select is(pg_temp.fila((select c from _p))->'compromisos'->2->>'motivo', 'el proveedor tardo en entregar (sintetico)', 'el historial guarda el motivo');
select is(api.ds_reprogramar_compromiso('cmp-r2', (select b from _p), negocio.hoy() + 1) ->> 'tipo', 'inicial', 'un pedido sin fecha se programa por primera vez (sin motivo)');
select is((api.ds_menudeo('Angelo')->'totales'->>'sin_fecha')::int, 0, 'ya ninguno sin fecha');
select throws_ok($$select api.ds_reprogramar_compromiso('cmp-r3', (select a from _p), negocio.hoy() - 5, null, 'motivo sintetico')$$, '23514', null, 'no se reprograma al pasado');

-- Recordatorios
select is(api.ds_recordatorio_config() ->> 'intervalo_horas', '24', 'configuracion: cada 24 horas por omision');
select is(api.ds_recordatorio_config() ->> 'max_recordatorios', '7', '... y un maximo de 7');
create temp table _v as select operacion.ds_vence_en((select (f->>'fecha_compromiso')::date from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = (select a from _p)),
                                                     (select (f->>'hora_compromiso')::time from jsonb_array_elements(api.ds_menudeo('Angelo')->'filas') f where (f->>'pedido_id')::bigint = (select a from _p))) as vence;
select is(pg_temp.tipo((select a from _p), (select vence from _v) - interval '20 hours'), 'por_vencer', 'a menos de 24 h de vencer: por vencer');
select is(pg_temp.tipo((select a from _p), (select vence from _v) - interval '30 hours'), null, 'a mas de 24 h: aun no');
select is(operacion.ds_registrar_recordatorio_menudeo('cmp-g1', (select a from _p), 'por_vencer', (select vence from _v) - interval '20 hours') ->> 'enviados', '1', 'se registra el recordatorio enviado');
select is(operacion.ds_registrar_recordatorio_menudeo('cmp-g1b', (select a from _p), 'por_vencer', (select vence from _v) - interval '20 hours') ->> 'enviados', '1', 'idempotente por pedido y hora: no duplica');
select is(pg_temp.tipo((select a from _p), (select vence from _v) - interval '19 hours'), null, 'ya avisado: no se repite el por vencer');
select is((select count(*) from operacion.ds_recordatorio_log where pedido_id = (select a from _p)), 1::bigint, 'una sola fila en el registro');
-- vence hoy: compromiso de hoy a las 08:00, ya paso a las 20:00
select api.ds_reprogramar_compromiso('cmp-r4', (select b from _p), negocio.hoy(), '08:00', 'adelantado por el socio (sintetico)');
select is(pg_temp.tipo((select b from _p), operacion.ds_vence_en(negocio.hoy(), '20:00')), 'vence_hoy', 'vencio hoy: recordatorio de vence hoy');
select operacion.ds_registrar_recordatorio_menudeo('cmp-g2', (select b from _p), 'vence_hoy', operacion.ds_vence_en(negocio.hoy(), '20:00'));
select is(pg_temp.tipo((select b from _p), operacion.ds_vence_en(negocio.hoy(), '21:30')), null, 'ya avisado hoy: no se repite el mismo dia');
-- vencido con recordatorio periodico: compromiso historico de hace 3 dias para el pedido c
insert into operacion.ds_pedido_compromiso (pedido_id, fecha_compromiso, comprometido_por, tipo, motivo, evento_id)
  select (select c from _p), negocio.hoy() - 3, (select id from catalogo.socio where nombre = 'Angelo'), 'reprogramacion', 'otra vez historico sintetico', (select evento_id from operacion.pedido where id = (select c from _p));
create temp table _t as select now() as t0;
select is(pg_temp.tipo((select c from _p), (select t0 from _t)), 'vencido', 'vencido antes de hoy: recordatorio periodico');
select is((select x ? 'folio' and x ? 'socio' and x ? 'pendiente_cent' and x ? 'dias_atraso' from jsonb_array_elements(pg_temp.rec((select t0 from _t))) x where (x->>'pedido_id')::bigint = (select c from _p)), true, 'solo folio, socio, monto, fechas y dias de atraso');
select operacion.ds_registrar_recordatorio_menudeo('cmp-g3', (select c from _p), 'vencido', (select t0 from _t));
select is(pg_temp.tipo((select c from _p), (select t0 from _t) + interval '12 hours'), null, 'antes del intervalo (24 h) no hay otro');
select is(pg_temp.tipo((select c from _p), (select t0 from _t) + interval '25 hours'), 'vencido', 'cumplido el intervalo: otro recordatorio');
select api.ds_recordatorio_config_guardar('cmp-cfg', 24, 12, 2);
select is(api.ds_recordatorio_config() ->> 'intervalo_horas', '12', 'la configuracion se edita (queda registrada)');
select is(pg_temp.tipo((select c from _p), (select t0 from _t) + interval '13 hours'), 'vencido', 'con intervalo de 12 h ya toca');
select operacion.ds_registrar_recordatorio_menudeo('cmp-g4', (select c from _p), 'vencido', (select t0 from _t) + interval '13 hours');
select is(pg_temp.tipo((select c from _p), (select t0 from _t) + interval '40 hours'), null, 'con maximo de 2 recordatorios no hay un tercero');
select throws_ok($$select api.ds_recordatorio_config_guardar('cmp-cfg2', 0, 12, 2)$$, '23514', null, 'valores fuera de rango se rechazan');
select is((select count(*) from jsonb_array_elements(pg_temp.rec(now())) x where x->>'tipo' = 'sin_fecha'), 0::bigint, 'sin pedidos sin fecha comprometida ya no hay alerta de sin fecha');
select is((select (pg_temp.rec(now())::text ~* 'cliente|destinatario|telefono|correo')), false, 'los recordatorios no llevan datos personales (ni cliente)');

-- Respuesta al recordatorio por el canal del agente: posponer y pagado (sin evidencia: Pago reportado)
select pg_temp.bot();
select is(operacion.ds_responder_recordatorio_menudeo('cmp-s1', (select c from _p), 'posponer', negocio.hoy() + 6, '12:00', 'pidio mas tiempo (sintetico)', '', 'transferencia', 'proveedor', 'Angelo') ->> 'accion', 'posponer', 'posponer desde el recordatorio');
select is(operacion.ds_responder_recordatorio_menudeo('cmp-s2', (select a from _p), 'pagado', null, null, null, 'REF-BOT-9', 'transferencia', 'proveedor', 'Angelo') ->> 'estado', 'pago_reportado', 'pagado desde el recordatorio: queda Pago reportado hasta que el otro socio confirme');
select throws_ok($$select operacion.ds_responder_recordatorio_menudeo('cmp-s3', (select a from _p), 'pagado', null, null, null, 'REF-BOT-10', 'transferencia', 'proveedor', 'Javier')$$, '42501', null, 'el bot solo acepta el aviso del socio de menudeo');
select pg_temp.web('Javier');
select api.ds_decidir_pago_menudeo('cmp-s4', (select (x->>'id')::bigint from jsonb_array_elements(pg_temp.fila((select a from _p))->'reportes') x limit 1), 'confirmado');
select is(pg_temp.fila((select a from _p))->>'estado_pago', 'pagado', 'el otro socio confirma y queda pagado');
select is((select count(*) from jsonb_array_elements(pg_temp.rec(now())) x where (x->>'pedido_id')::bigint = (select a from _p)), 0::bigint, 'un pedido pagado ya no genera recordatorios');

-- Parametro: el socio de menudeo se puede cambiar; las invariantes de valuacion no se mueven
select pg_temp.web('Angelo');
select api.ds_menudeo_socio_guardar('cmp-m1', 'Javier');
select is(api.ds_menudeo_config() ->> 'socio_menudeo', 'Javier', 'el parametro socio_menudeo se edita');
select pg_temp.web('Javier');
select lives_ok($$select operacion.ds_crear_pedido('cmp-j1', (select id from catalogo.cliente where nombre_norm = 'cmp stock javier'), '[{"modelo":"CMP Modelo 25K","sabor":"Fresa","piezas":5}]'::jsonb, 'karen_directo', null, null, 'socio_a_costo', 'Javier')$$, 'con el parametro en Javier, Javier mete pedidos a costo');
select api.ds_menudeo_socio_guardar('cmp-m2', 'Angelo');
select is(api.ds_menudeo_config() ->> 'socio_menudeo', 'Angelo', 'y se regresa a Angelo');
select pg_temp.web('Angelo');
select is(pg_temp.v03(), (select v03 from _base), 'pedidos a costo con compromisos y recordatorios: valuacion neta intacta');
select is(pg_temp.neta('Angelo') || ',' || pg_temp.neta('Javier'), (select na || ',' || nj from _base), 'aportaciones netas intactas');
select is(pg_temp.fallan(), '', 'Libro conciliado');
select pg_temp.como('Omar');
select throws_ok($$select api.ds_recordatorios_pago_menudeo()$$, '42501', null, 'Omar no ve los recordatorios');
select throws_ok($$select api.ds_menudeo_config()$$, '42501', null, 'ni la configuracion');
select * from finish();
rollback;
