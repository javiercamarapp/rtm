-- pgTAP: CIFRADO EN REPOSO del destinatario (pgcrypto, AES-256, por columna). La llave no vive en la base ni en el repo: aqui se genera una de PRUEBA (nunca se guarda). Cubre: sin llave y llave corta
-- (falla cerrada), llave incorrecta, round-trip, SELECT directo como superusuario sin texto plano, llave por cabecera (como la manda el servidor), rotacion idempotente con llave anterior,
-- migracion idempotente de filas en claro, alteracion de datos, y que la web no llama a las funciones de cifrado. Datos sinteticos.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cif.ang@example.test', 'socio', 'Angelo', true), ('cif.jav@example.test', 'socio', 'Javier', true), ('cif.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('88888888-8888-8888-8888-4444444400a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cif.ang@example.test'),
  ('88888888-8888-8888-8888-4444444400a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cif.jav@example.test'),
  ('88888888-8888-8888-8888-4444444400a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cif.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '88888888-8888-8888-8888-4444444400a1' when 'Omar' then '88888888-8888-8888-8888-4444444400a3' else '88888888-8888-8888-8888-4444444400a2' end, true) $$;
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
create temp table _s as select (api.apertura_crear('cif:s1', negocio.hoy() - 5, 'ilustrativa') ->> 'sesion_id')::bigint as id;
select api.apertura_agregar('cif:p1', (select id from _s), 'aportacion', '{"socio": "Angelo", "monto_cent": 10000000}');
select api.apertura_agregar('cif:p2', (select id from _s), 'aportacion', '{"socio": "Javier", "monto_cent": 8000000}');
select api.apertura_agregar('cif:p3', (select id from _s), 'caja', '{"socio": "Angelo", "monto_cent": 5000000}');
select api.apertura_agregar('cif:p4', (select id from _s), 'caja', '{"socio": "Javier", "monto_cent": 3000000}');
select api.apertura_resolucion('cif:r0', (select id from _s), 'capital_50_50', 'Diferencia entre el capital declarado y los saldos de la prueba');
select api.apertura_firmar('cif:f1', (select id from _s));
select pg_temp.como('Javier');
select api.apertura_firmar('cif:f2', (select id from _s));
select pg_temp.como('Angelo');



create temp table _k as select encode(extensions.gen_random_bytes(32), 'base64') as k1, encode(extensions.gen_random_bytes(32), 'base64') as k2;
create function pg_temp.con(p_k text) returns void language sql as $$ select set_config('rtm.llave_destinatario', $1, true), set_config('request.headers', '', true) $$;
create function pg_temp.sin() returns void language sql as $$ select set_config('rtm.llave_destinatario', '', true), set_config('rtm.llave_destinatario_anterior', '', true), set_config('request.headers', '', true) $$;
create function pg_temp.dest() returns jsonb language sql as
  $$ select jsonb_build_object('nombre', 'Persona Sintetica Cifrada', 'calle_numero', 'Calle Ficticia 999', 'colonia', 'Colonia Imaginaria', 'cp', '97000', 'municipio', 'Municipio Ejemplo', 'estado', 'Estado Ejemplo',
                               'telefono', '9990002222', 'correo', 'cifrado.sintetico@example.test', 'referencias', 'Porton verde de prueba') $$;
select catalogo.asegurar_modelo('CIF Marca', 'CIF Modelo 25K', 25000, 'ambas'); select catalogo.asegurar_sku('CIF Modelo 25K', 'Fresa');
select catalogo.fijar_costo('cif-c', 'Karen', 'CIF Modelo 25K', 8929, negocio.hoy() - 60, 'prueba');
select catalogo.asegurar_cliente('CIF Cliente', 'Javier'); select catalogo.fijar_precio('cif-p', 'CIF Cliente', 'CIF Modelo 25K', 10480, negocio.hoy() - 60, 'documento');
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_norm = catalogo.normalizar('CIF Cliente') $$;

-- Sin llave: falla cerrada al escribir y al leer
select pg_temp.sin();
select throws_ok($$select operacion.ds_crear_pedido('cif-0', pg_temp.cli(), '[{"modelo":"CIF Modelo 25K","sabor":"Fresa","piezas":1}]'::jsonb, 'karen_directo', pg_temp.dest())$$, 'P0450', null, 'sin llave: crear un pedido con destinatario falla cerrado');
select is((select count(*) from entrega.destinatario), 0::bigint, 'y no queda nada guardado (ni en claro)');
select pg_temp.con('corta');
select throws_ok($$select operacion.ds_crear_pedido('cif-0b', pg_temp.cli(), '[{"modelo":"CIF Modelo 25K","sabor":"Fresa","piezas":1}]'::jsonb, 'karen_directo', pg_temp.dest())$$, 'P0450', null, 'una llave de menos de 32 caracteres se rechaza');

-- Round-trip con la llave 1
select pg_temp.con((select k1 from _k));
select operacion.ds_crear_pedido('cif-1', pg_temp.cli(), '[{"modelo":"CIF Modelo 25K","sabor":"Fresa","piezas":10}]'::jsonb, 'karen_directo', pg_temp.dest());
create function pg_temp.ped() returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped' $$;
select is(api.ds_destinatario(pg_temp.ped()) ->> 'nombre', 'Persona Sintetica Cifrada', 'round-trip: se lee lo que se guardo');
select is(api.ds_destinatario(pg_temp.ped()) ->> 'telefono_mascara', '*** ** 22', 'la lectura sigue enmascarando el telefono');
select is(api.ds_destinatario_revelar(pg_temp.ped(), 'correo') ->> 'valor', 'cifrado.sintetico@example.test', 'Revelar sigue funcionando');
select is((select count(*) from entrega.revelacion where pedido_id = pg_temp.ped()), 1::bigint, 'y sigue auditado');
select ok((api.ds_orden_proveedor(pg_temp.ped(), true) ->> 'texto') like '%Calle Ficticia 999%', 'la orden completa para el proveedor se arma con los datos descifrados');
-- SELECT directo como superusuario: nada en claro
select is((select count(*) from entrega.destinatario where nombre is not null or calle_numero is not null or telefono is not null or correo is not null), 0::bigint, 'superusuario: las columnas en claro estan vacias');
select is((select d::text !~* 'persona sintetica|calle ficticia|9990002222|cifrado.sintetico' from entrega.destinatario d), true, 'superusuario: la fila completa no contiene texto plano');
select is((select encode(datos_cifrados, 'escape') !~* 'persona|calle|9990002222' from entrega.destinatario), true, 'ni el bytea cifrado deja ver el contenido');
select is((select length(datos_cifrados) > 60 from entrega.destinatario), true, 'el bytea cifrado existe');
select is((select count(*) from operacion.evento where payload::text ~* 'persona sintetica|calle ficticia|9990002222|cifrado.sintetico'), 0::bigint, 'ningun evento lleva datos descifrados');
select is((select count(*) from seguridad.operacion where resultado::text ~* 'persona sintetica|calle ficticia|9990002222|cifrado.sintetico'), 0::bigint, 'ni los resultados de idempotencia');

-- Llave incorrecta: error, nunca texto plano
select pg_temp.con((select k2 from _k));
select throws_ok($$select api.ds_destinatario((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped'))$$, 'P0451', null, 'llave incorrecta: la lectura falla cerrada');
select throws_ok($$select api.ds_destinatario_revelar((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped'), 'telefono')$$, 'P0451', null, 'llave incorrecta: Revelar tambien');
select throws_ok($$select api.ds_orden_proveedor((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped'), false)$$, 'P0451', null, 'llave incorrecta: la orden tambien');
select pg_temp.sin();
select throws_ok($$select api.ds_destinatario((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped'))$$, 'P0450', null, 'sin llave: la lectura falla cerrada');

-- La llave llega por cabecera, como la manda el servidor (PostgREST las expone en request.headers)
select set_config('request.headers', json_build_object('x-rtm-llave', (select k1 from _k))::text, true);
select is(api.ds_destinatario(pg_temp.ped()) ->> 'nombre', 'Persona Sintetica Cifrada', 'llave por cabecera x-rtm-llave: funciona');
select pg_temp.sin();
-- Alteracion de los datos
create temp table _orig as select datos_cifrados as d from entrega.destinatario;
update entrega.destinatario set datos_cifrados = set_byte(datos_cifrados, 40, get_byte(datos_cifrados, 40) # 255);
select pg_temp.con((select k1 from _k));
select throws_ok($$select api.ds_destinatario((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped'))$$, 'P0451', null, 'datos alterados: falla cerrada');
update entrega.destinatario set datos_cifrados = (select d from _orig);
select is(api.ds_destinatario(pg_temp.ped()) ->> 'nombre', 'Persona Sintetica Cifrada', 'restaurados: vuelve a leerse');

-- Rotacion: llave nueva (k2) y anterior (k1)
select set_config('rtm.llave_destinatario', (select k2 from _k), true), set_config('rtm.llave_destinatario_anterior', (select k1 from _k), true), set_config('rtm.llave_destinatario_version', '2', true);
select is(api.ds_destinatario(pg_temp.ped()) ->> 'nombre', 'Persona Sintetica Cifrada', 'durante la rotacion se lee con la llave anterior');
select is(entrega.recifrar(), 1, 'recifrar: vuelve a cifrar una fila con la llave nueva');
select is(entrega.recifrar(), 0, 'recifrar es idempotente: la segunda corrida no cambia nada');
select is((select llave_version from entrega.destinatario), 2, 'la fila queda con la version nueva');
select set_config('rtm.llave_destinatario_anterior', '', true);
select is(api.ds_destinatario(pg_temp.ped()) ->> 'nombre', 'Persona Sintetica Cifrada', 'solo con la llave nueva ya se lee');
select pg_temp.con((select k1 from _k));
select throws_ok($$select api.ds_destinatario((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-1:ped'))$$, 'P0451', null, 'la llave vieja sola ya no abre');

-- Migracion idempotente de filas anteriores en claro
select pg_temp.con((select k1 from _k));
select operacion.ds_crear_pedido('cif-2', pg_temp.cli(), '[{"modelo":"CIF Modelo 25K","sabor":"Fresa","piezas":2}]'::jsonb, 'karen_directo');
insert into entrega.destinatario (pedido_id, nombre, calle_numero, colonia, cp, municipio, estado, telefono, correo, referencias)
  values ((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-2:ped'), 'Persona Anterior', 'Calle Vieja 1', '', '97000', 'Municipio Ejemplo', 'Estado Ejemplo', '9990003333', '', '');
select is((select count(*) from entrega.destinatario where datos_cifrados is null), 1::bigint, 'hay una fila anterior en claro');
select pg_temp.sin();
select throws_ok($$select entrega.cifrar_pendientes()$$, 'P0450', null, 'migrar exige la llave');
select pg_temp.con((select k1 from _k));
select is(entrega.cifrar_pendientes(), 1, 'cifra la fila anterior');
select is(entrega.cifrar_pendientes(), 0, 'idempotente: la segunda corrida no cifra nada');
select is((select count(*) from entrega.destinatario where nombre is not null), 0::bigint, 'ya no queda nada en claro');
select is(api.ds_destinatario((select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'cif-2:ped')) ->> 'nombre', 'Persona Anterior', 'y se sigue leyendo');

-- Permisos: la web no llama a las funciones de cifrado ni lee las tablas
set local role authenticated;
select throws_ok($$select entrega.descifrar('\x00'::bytea)$$, '42501', null, 'authenticated no ejecuta entrega.descifrar');
select throws_ok($$select entrega.leer(1)$$, '42501', null, 'ni entrega.leer');
select throws_ok($$select entrega.recifrar()$$, '42501', null, 'ni la rotacion');
select throws_ok($$select count(*) from entrega.destinatario$$, '42501', null, 'ni la tabla');
reset role;
select * from finish();
rollback;
