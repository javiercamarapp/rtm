-- pgTAP lane telegram-agente: pagos a socios, aportacion declarada, cobro, libro de hechos, deshacer, consultas y dependencias. Datos sinteticos.
begin;
select no_plan();

-- Aportacion de capital (declarada) y por omision (reembolso); el autor es obligatorio
select throws_ok($$ select agente.ejecutar('tt:a0', 'aportacion', '{"socio":"angelo","monto_cent":100,"origen":"x"}') $$, 'P0460', null, 'sin autor no se registra dinero');
select is((agente.ejecutar('tt:a1', 'aportacion', '{"socio":"angelo","monto_cent":500000,"intencion":"capital","autor":"angelo","origen":"meti 5000 de capital"}') ->> 'clasificacion'), 'capital', 'capital solo si se declara');
select is((agente.ejecutar('tt:a2', 'aportacion', '{"socio":"javier","monto_cent":200000,"autor":"javier","origen":"puse 2000"}') ->> 'clasificacion'), 'reembolsable', 'sin declarar: reembolso (cuenta por pagar)');
select is((select count(*)::int from agente.hecho where tipo = 'aportacion'), 2, 'cada hecho queda en el libro del agente');
select is((select mensaje_origen from operacion.evento where clave_idem = 'tt:a1'), 'telegram:angelo: meti 5000 de capital', 'la cadena de auditoria dice quien lo mando');
select is((agente.ejecutar('tt:a1', 'aportacion', '{"socio":"angelo","monto_cent":500000,"intencion":"capital","autor":"angelo","origen":"meti 5000 de capital"}') ->> 'repetido')::boolean, true, 'la misma clave no duplica');
select is((select count(*)::int from operacion.aportacion_socio where concepto = 'Aportacion por Telegram' and monto_cent = 500000), 1, 'una sola aportacion');

-- Gasto de Javier -> reembolso pendiente; reembolso parcial; exceso rechazado
select is((agente.ejecutar('tt:g1', 'gasto', '{"pagado_por":"javier","monto_cent":90000,"categoria":"uber","autor":"javier","origen":"pague 900 de uber"}') ->> 'folio') like 'G-%', true, 'gasto de socio');
select is((agente.ejecutar('tt:r1', 'pago_a_socio', '{"socio":"javier","monto_cent":50000,"tipo":"reembolso","via":"transferencia","autor":"angelo","origen":"reembolso a Javier 500"}') -> 'eco' ->> 'reembolso_pendiente_cent')::bigint,
  240000::bigint, 'el eco sale de la base: 290,000 - 50,000');
select is((select operacion.reembolso_pendiente((select id from catalogo.socio where nombre = 'Javier'))), 240000::bigint, 'pendiente = 200,000 de deposito + 90,000 de gasto - 50,000 pagados = 240,000');
select throws_ok($$ select agente.ejecutar('tt:r2', 'pago_a_socio', '{"socio":"javier","monto_cent":99999999,"tipo":"reembolso","via":"efectivo","autor":"angelo","origen":"x"}') $$, '23514', null, 'un reembolso mayor a lo pendiente se rechaza');
select throws_ok($$ select agente.ejecutar('tt:r3', 'pago_a_socio', '{"socio":"angelo","monto_cent":1000,"tipo":"retiro","via":"efectivo","autor":"angelo","origen":"x"}') $$, '23514', null, 'un retiro sin utilidad asignada se rechaza');
select throws_ok($$ select agente.ejecutar('tt:r4', 'pago_a_socio', '{"socio":"javier","monto_cent":1000,"tipo":"otro","via":"efectivo","autor":"angelo","origen":"x"}') $$, 'P0460', null, 'tipo de pago a socio invalido');

-- Deshacer por folio y por ultimo hecho del autor
select is((agente.localizar(null, 'angelo') ->> 'tipo'), 'pago_a_socio', 'el ultimo hecho de Angelo es el pago');
select is((agente.deshacer('tt:d1', (agente.localizar(null, 'angelo') ->> 'folio')) ->> 'deshecho')::boolean, true, 'deshacer el reembolso');
select is((select operacion.reembolso_pendiente((select id from catalogo.socio where nombre = 'Javier'))), 290000::bigint, 'el pendiente vuelve a 290,000 (el original no se borra)');
select is((select count(*)::int from agente.hecho where deshecho_at is not null), 1, 'el hecho queda marcado como deshecho');
select throws_ok($$ select agente.deshacer('tt:d2', (select folio from agente.hecho where deshecho_at is not null)) $$, 'P0428', null, 'no se deshace dos veces');

-- Cobro a un cliente
select catalogo.asegurar_cliente('Tt Cliente', 'Javier');
select is((agente.ejecutar('tt:c1', 'pago_cliente', jsonb_build_object('cuenta', 'efectivo', 'monto_cent', 700000, 'cliente_id', (select id from catalogo.cliente where nombre_canonico = 'Tt Cliente'), 'autor', 'angelo', 'origen', 'Tt Cliente pago 7000')) ->> 'folio') is not null, true, 'cobro con folio');
select throws_ok($$ select agente.ejecutar('tt:c2', 'pago_cliente', '{"cuenta":"banorte","monto_cent":100,"cliente_id":1,"autor":"angelo","origen":"x"}') $$, 'P0460', null, 'cuenta desconocida: se pregunta, no se supone');
select is((agente.deshacer('tt:c3', (select folio from agente.hecho where tipo = 'pago_cliente')) ->> 'deshecho')::boolean, true, 'deshacer un cobro');

-- Dependencias de otras ramas
select throws_ok($$ select agente.ejecutar('tt:v1', 'devolucion', '{"autor":"angelo"}') $$, 'P0461', null, 'devolucion depende de su rama');
select throws_ok($$ select agente.ejecutar('tt:v2', 'paquete_perdido', '{"autor":"angelo"}') $$, 'P0461', null, 'paquete perdido depende de su rama');
select is((agente.capacidades() ? 'devolucion') and (agente.capacidades() ? 'paquete'), true, 'capacidades informa las dos dependencias');

-- Consultas
select is(jsonb_array_length(agente.consulta('estado_socio', null, 'javier') -> 'lineas'), 6, 'estado de cuenta de un socio');
select is((agente.consulta('estado_socio', null, 'javier') -> 'lineas' -> 1 ->> 'centavos')::bigint, 290000::bigint, 'reembolso pendiente de Javier segun la base');
select throws_ok($$ select agente.consulta('estado_socio', null, 'omar') $$, '22023', null, 'solo hay estado de Angelo y Javier');
select is(jsonb_array_length(agente.consulta('utilidad', null, 'mes') -> 'lineas'), 5, 'utilidad del mes');
select is((agente.consulta('cartera') -> 'lineas' -> -1 ->> 'etiqueta'), 'Total por cobrar', 'cartera cierra con el total');

-- Permisos y RLS
select is(has_function_privilege('authenticated', 'agente.capacidades()', 'EXECUTE'), false, 'la web no ejecuta el agente');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'agente' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada tambien en agente.hecho');
select * from finish();
rollback;
