-- pgTAP lane telegram-agente (revision de seguridad): autor verificado en SQL (ALTO-1), deshacer con solicitante (MEDIO-1), hash del efecto (MEDIO-2),
-- folios de la vista previa sin huecos (B2) y privilegios del esquema agente (B6). Datos sinteticos.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5000001, 'angelo');
select agente.registrar_miembro(5000002, 'javier');
select agente.registrar_miembro(5000003, 'omar');

select catalogo.asegurar_cliente('Tg Cliente', 'Javier');
select catalogo.asegurar_modelo('Tg Marca', 'Tg Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('Tg Modelo', 'Uva');
select catalogo.fijar_costo('tg:k', 'Karen', 'Tg Modelo', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_costo('tg:k2', 'Isaac', 'Tg Modelo', 11000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('tg:p', 'Tg Cliente', 'Tg Modelo', 25000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('tg:m1', 'Tg Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 40, 400000, negocio.hoy() - 5);
select costos.registrar_tipo_cambio('tg:tc0', negocio.hoy() - 1, 18500000, 'manual');
create function pg_temp.mid() returns bigint language sql as $$ select id from catalogo.modelo where nombre_canonico = 'Tg Modelo' $$;
create function pg_temp.sid(n text) returns bigint language sql as $$ select id from catalogo.sabor where nombre_canonico = n $$;
create function pg_temp.cid() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'Tg Cliente' $$;
create function pg_temp.pedido(p_autor text, p_id bigint) returns jsonb language sql as $$
  select jsonb_build_object('plazo_dias', 0, 'autor', p_autor, 'telegram_user_id', p_id, 'origen', 'x', 'cliente_id', pg_temp.cid(),
    'lineas', jsonb_build_array(jsonb_build_object('modelo_id', pg_temp.mid(), 'sabor_id', pg_temp.sid('Uva'), 'piezas', 10))) $$;

-- ------------------------------------------------------------------ ALTO-1: el autor del JSON no basta
select throws_ok($$ select agente.ejecutar_ext('v:0', 'pedido_crear', jsonb_build_object('autor', 'javier', 'origen', 'x')) $$, 'P0460', null, 'sin telegram_user_id no se registra nada');
select throws_ok($$ select agente.ejecutar_ext('v:1', 'pedido_crear', pg_temp.pedido('javier', 5000001)) $$, '42501', null, 'autor javier con el id de Angelo: suplantacion rechazada');
select throws_ok($$ select agente.ejecutar_ext('v:2', 'pedido_crear', pg_temp.pedido('javier', 123)) $$, '42501', null, 'id que no esta registrado: rechazado');
select throws_ok($$ select agente.ejecutar_ext('v:3', 'pedido_crear', pg_temp.pedido('javier', 5000003)) $$, '42501', null, 'el id de Omar no actua como socio');
select throws_ok($$ select agente.ejecutar_ext('v:4', 'pedido_crear', pg_temp.pedido('omar', 5000003)) $$, 'P0460', null, 'omar no es un autor valido de escrituras de socios');
select throws_ok($$ select agente.simular('ejecutar_ext', 'pedido_crear', pg_temp.pedido('javier', 5000001)) $$, '42501', null, 'la vista previa tambien verifica al autor');
select throws_ok($$ select agente.ejecutar('v:5', 'aportacion', '{"socio":"angelo","monto_cent":100,"autor":"angelo","telegram_user_id":5000002,"origen":"x"}') $$, '42501', null, 'aportacion con id ajeno rechazada');
select throws_ok($$ select agente.ejecutar('v:6', 'gasto', '{"pagado_por":"javier","monto_cent":100,"categoria":"uber","origen":"x"}') $$, 'P0460', null, 'un gasto sin autor verificado ya no pasa');
select is((select count(*)::int from agente.hecho), 0, 'nada se registro');
select agente.registrar_miembro(5000002, 'javier', false);
select throws_ok($$ select agente.ejecutar_ext('v:7', 'pedido_crear', pg_temp.pedido('javier', 5000002)) $$, '42501', null, 'un socio dado de baja no registra');
select agente.registrar_miembro(5000002, 'javier', true);
select is((agente.ejecutar_ext('v:8', 'pedido_crear', pg_temp.pedido('javier', 5000002)) ->> 'estado'), 'confirmado', 'el socio verificado registra');
select is((select autor from agente.hecho where clave_idem = 'v:8'), 'javier', 'el hecho queda a nombre del socio verificado');

-- Firma del acta: exige un boton consumido por ese socio, de esa misma indicacion
select agente.token_emitir('TokFirma01', 'confirmar_refuerzo', array['socio'], -100200, now() + interval '1 day', null, jsonb_build_object('claveIdem', 'v:af1'));
select throws_ok($$ select agente.ejecutar_ext('v:af1', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x","token_boton":"TokFirma01"}') $$, '42501', null, 'token emitido pero no consumido: no firma');
select is(agente.token_consumir('TokFirma01', 'socio', -100200, now(), 5000003) ->> 'estado', 'no_autorizado', 'Omar (rol omar) no consume un token de socios aunque diga ser socio');
select is(agente.token_consumir('TokFirma01', 'socio', -100200, now(), 5000001) ->> 'estado', 'ok', 'Angelo consume su boton');
select is((select usado_por from agente.tg_token where token = 'TokFirma01'), 5000001::bigint, 'el token guarda quien lo pulso');
select throws_ok($$ select agente.ejecutar_ext('v:af1', 'acta_firma', '{"autor":"javier","telegram_user_id":5000002,"origen":"x","token_boton":"TokFirma01"}') $$, '42501', null, 'Javier no firma con el boton de Angelo');
select throws_ok($$ select agente.ejecutar_ext('v:af2', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x","token_boton":"TokFirma01"}') $$, '42501', null, 'el boton es de otra indicacion (otra clave): no vale');
select throws_ok($$ select agente.ejecutar_ext('v:af1', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x"}') $$, '42501', null, 'sin token en el JSON no firma');
select throws_ok($$ select agente.ejecutar_ext('v:af1', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x","token_boton":"TokFirma01"}') $$, 'P0460', null, 'con su boton pasa la compuerta (aqui no hay acta pendiente que firmar)');
select agente.token_emitir('TokOtraAcc1', 'confirmar_resumen', array['socio'], -100200, now() + interval '1 day', null, jsonb_build_object('claveIdem', 'v:af3'));
select agente.token_consumir('TokOtraAcc1', 'socio', -100200, now(), 5000001);
select throws_ok($$ select agente.ejecutar_ext('v:af3', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x","token_boton":"TokOtraAcc1"}') $$, '42501', null, 'el primer Confirmar no basta: hace falta el boton de confirmacion reforzada');
-- La simulacion nunca firma ni exige boton
select throws_ok($$ select agente.simular('ejecutar_ext', 'acta_firma', '{"autor":"angelo","telegram_user_id":5000001,"origen":"x"}') $$, 'P0460', null, 'la vista previa de la firma no exige boton (y falla solo por falta de acta)');

-- Privilegios: ayudantes internos sin EXECUTE para servidor, nada para la web
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' and p.proname like '\_%' and has_function_privilege('servidor', p.oid, 'execute')), 0, 'servidor no llama a ningun ayudante interno _*');
select is(has_function_privilege('servidor', 'agente._actuar(jsonb)', 'execute'), false, '_actuar no es llamable por servidor');
select is(has_function_privilege('servidor', 'agente._guardar_hecho2(text,text,text,bigint,text,text)', 'execute'), false, '_guardar_hecho2 no es llamable por servidor');
select is(has_function_privilege('servidor', 'agente._lineas_sku(jsonb)', 'execute'), false, '_lineas_sku no es llamable por servidor');
select is(has_function_privilege('servidor', 'agente._ejecutar_ext_base(text,text,jsonb)', 'execute'), false, 'las funciones base (sin candado) no son llamables');
select is(has_function_privilege('servidor', 'agente.ejecutar_ext(text,text,jsonb)', 'execute'), true, 'servidor si usa las puertas');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente'
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 0, 'ninguna funcion del esquema agente la ejecuta la web (guarda contra funciones futuras)');
select is(has_schema_privilege('anon', 'agente', 'usage') or has_schema_privilege('authenticated', 'agente', 'usage'), false, 'la web ni siquiera ve el esquema');

-- ------------------------------------------------------------------ MEDIO-1: deshacer con solicitante verificado
select agente.ejecutar('v:a1', 'aportacion', '{"socio":"angelo","monto_cent":100000,"autor":"angelo","telegram_user_id":5000001,"origen":"puse 1000"}');
select throws_ok($$ select agente.deshacer('v:d0', (select folio from agente.hecho where clave_idem = 'v:a1')) $$, '42883', null, 'ya no existe el deshacer sin solicitante');
select throws_ok($$ select agente.deshacer('v:d1', (select folio from agente.hecho where clave_idem = 'v:a1'), 'javier', 5000001) $$, '42501', null, 'solicitante con id ajeno rechazado');
select throws_ok($$ select agente.deshacer('v:d2', (select folio from agente.hecho where clave_idem = 'v:a1'), 'javier', 999) $$, '42501', null, 'solicitante no registrado rechazado');
select is((agente.deshacer('v:d3', (select folio from agente.hecho where clave_idem = 'v:a1'), 'javier', 5000002) ->> 'deshecho_por'), 'javier', 'dentro de 10 minutos el otro socio puede corregirlo');
select is((select deshecho_por from agente.hecho where clave_idem = 'v:a1'), 'javier', 'queda registrado quien deshizo');
select is((select autor from agente.hecho where clave_idem = 'v:a1'), 'angelo', 'el autor original no cambia');
select is(current_setting('rtm.actor'), 'javier', 'el actor de la anulacion es el solicitante, no el autor del hecho');
select agente.ejecutar('v:a2', 'aportacion', '{"socio":"angelo","monto_cent":200000,"autor":"angelo","telegram_user_id":5000001,"origen":"puse 2000"}');
update agente.hecho set creado_at = now() - interval '11 minutes' where clave_idem = 'v:a2';
select throws_like($$ select agente.deshacer('v:d4', (select folio from agente.hecho where clave_idem = 'v:a2'), 'javier', 5000002) $$, '%solo el puede deshacerlo%', 'pasados 10 minutos el hecho de Angelo no lo deshace Javier');
select is((select deshecho_at from agente.hecho where clave_idem = 'v:a2'), null::timestamptz, 'sigue vigente');
select is((agente.deshacer('v:d5', (select folio from agente.hecho where clave_idem = 'v:a2'), 'angelo', 5000001) ->> 'deshecho_por'), 'angelo', 'su autor lo deshace cuando quiera');

-- ------------------------------------------------------------------ MEDIO-2: el efecto confirmado es el que se ejecuta
create temp table _sim as select agente.simular('ejecutar_ext', 'pedido_crear', pg_temp.pedido('javier', 5000002)) as j;
select is((select j ->> 'efecto_hash' from _sim) is not null, true, 'la vista previa trae el hash del efecto');
select is((select ((j -> 'efecto') ->> 'mercancia_cent')::bigint from _sim), 250000::bigint, 'efecto: 10 x 250');
select is((agente.ejecutar_ext('v:h0', 'pedido_crear', pg_temp.pedido('javier', 5000002) || jsonb_build_object('efecto_hash', (select j ->> 'efecto_hash' from _sim))) ->> 'estado'), 'confirmado', 'con el efecto igual al mostrado se ejecuta');
select catalogo.fijar_precio('tg:p2', 'Tg Cliente', 'Tg Modelo', 26000, negocio.hoy(), 'chat');
select throws_ok($$ select agente.ejecutar_ext('v:h1', 'pedido_crear', pg_temp.pedido('javier', 5000002) || jsonb_build_object('efecto_hash', (select j ->> 'efecto_hash' from _sim))) $$, 'P0462', null, 'si el precio cambio entre simular y ejecutar se aborta');
select is((select count(*)::int from agente.hecho where clave_idem = 'v:h1'), 0, 'y no deja nada');
select is((select count(*)::int from operacion.pedido), 2, 'solo los pedidos anteriores existen (v:8 y v:h0)');
select is((agente.ejecutar_ext('v:h2', 'pedido_crear', pg_temp.pedido('javier', 5000002) || jsonb_build_object('efecto_hash', (agente.simular('ejecutar_ext', 'pedido_crear', pg_temp.pedido('javier', 5000002)) ->> 'efecto_hash'))) ->> 'estado'), 'confirmado', 'tras una nueva vista previa con el precio nuevo, se ejecuta');
select is((select (l.precio_cent) from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id join agente.hecho h on h.ref_id = p.id where h.clave_idem = 'v:h2' limit 1), 26000::bigint, 'al precio nuevo que el socio vio');
-- Tipo de cambio de un servicio
create temp table _sim2 as select agente.simular('ejecutar_ext', 'gasto_servicio', '{"autor":"javier","telegram_user_id":5000002,"origen":"x","servicio":"openrouter","monto_usd_cent":2000,"pagado_por":"javier"}') as j;
select costos.registrar_tipo_cambio('tg:tc1', negocio.hoy(), 19500000, 'manual');
select throws_ok($$ select agente.ejecutar_ext('v:s1', 'gasto_servicio', jsonb_build_object('autor','javier','telegram_user_id',5000002,'origen','x','servicio','openrouter','monto_usd_cent',2000,'pagado_por','javier','efecto_hash',(select j ->> 'efecto_hash' from _sim2))) $$, 'P0462', null, 'si el tipo de cambio cambio, se aborta');
select is((agente.ejecutar_ext('v:s2', 'gasto_servicio', jsonb_build_object('autor','javier','telegram_user_id',5000002,'origen','x','servicio','openrouter','monto_usd_cent',2000,'pagado_por','javier','efecto_hash',(agente.simular('ejecutar_ext','gasto_servicio','{"autor":"javier","telegram_user_id":5000002,"origen":"x","servicio":"openrouter","monto_usd_cent":2000,"pagado_por":"javier"}') ->> 'efecto_hash'))) ->> 'monto_cent')::bigint, 39000::bigint, 'con el nuevo hash: 20 USD x 19.50');
select is((agente.ejecutar_ext('v:h2', 'pedido_crear', pg_temp.pedido('javier', 5000002) || jsonb_build_object('efecto_hash', 'hash-viejo-que-ya-no-aplica')) ->> 'repetido')::boolean, true, 'un reintento idempotente no recalcula (ya estaba aplicado)');

-- ------------------------------------------------------------------ B2: la vista previa no deja huecos de folio
create temp table _f as select (select ultimo from seguridad.contador_folio where serie = 'P') as p, (select ultimo from seguridad.contador_folio where serie = 'E') as e;
select agente.simular('ejecutar_ext', 'pedido_crear', pg_temp.pedido('angelo', 5000001));
select agente.simular('ejecutar_ext', 'pedido_crear', pg_temp.pedido('angelo', 5000001));
select is((select ultimo from seguridad.contador_folio where serie = 'P'), (select p from _f), 'simular no consume folios de pedido (contador transaccional, se revierte)');
select is((select ultimo from seguridad.contador_folio where serie = 'E'), (select e from _f), 'ni de evento');

-- ------------------------------------------------------------------ Pago de un socio a proveedor: reembolso por omision; capital solo si se declara
select is((agente.ejecutar('v:pp0', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"javier","autor":"javier","telegram_user_id":5000002,"origen":"pague 100 a Karen"}') -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'reembolsable', 'sin declarar capital: el pago de un socio a un proveedor se registra como REEMBOLSO');
select is(to_regprocedure('operacion.pago_proveedor_de_socio(text,text,bigint,text,text,date,text,text,boolean)') is not null, true, 'la funcion real de 9 argumentos existe (lane/cuadrar-cuentas va antes en la integracion)');
select is((agente.ejecutar('v:pp1', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"javier","declara_capital":true,"autor":"javier","telegram_user_id":5000002,"origen":"meti 100 de capital pagando a Karen"}') -> 'clasificaciones' -> 0 ->> 'clasificacion'), 'capital', 'con declaracion expresa el mismo pago se registra como CAPITAL (ya no da P0461)');
select is((select clasificacion from operacion.aportacion_socio order by id desc limit 1), 'capital', 'y la fila real de aportacion_socio queda como capital');
select throws_ok($$ select agente.ejecutar('v:pp2', 'pago_proveedor', '{"proveedor":"karen","monto_cent":10000,"pagado_por":"sociedad","declara_capital":true,"autor":"javier","telegram_user_id":5000002,"origen":"x"}') $$, 'P0460', null, 'capital solo aplica si un socio pago con su dinero');
select is((select tipo from agente.hecho where clave_idem = 'v:pp1'), 'pago_proveedor', 'queda en el libro de hechos');

select * from finish();
rollback;
