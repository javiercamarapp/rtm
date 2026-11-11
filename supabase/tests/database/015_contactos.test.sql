-- pgTAP de contactos de menudeo (ESCRITA, SIN EJECUTAR: la migracion 20261111000100 no se ha aplicado en ninguna base).
-- Describe la RLS esperada: esquema cerrado, RLS forzada sin politicas, solo socios, Omar y anon sin acceso, vista del agente sin telefonos,
-- registro de revelaciones y carga idempotente. Todos los datos son sinteticos (numeros 555).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('ctc.socio@example.test', 'socio', 'Javier', true),
  ('ctc.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('d4444444-4444-4444-4444-444444444441', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ctc.socio@example.test'),
  ('d4444444-4444-4444-4444-444444444442', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ctc.omar@example.test');

-- ---- Estructura: RLS forzada y sin politicas en las ocho tablas --------------------------------------------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'contactos' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), 8, 'las 8 tablas de contactos tienen RLS activa y forzada');
select is((select count(*)::int from pg_policies where schemaname = 'contactos'), 0, 'sin politicas: deniega por omision');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'contactos' and c.relkind = 'r' and not c.relforcerowsecurity), 0, 'ninguna tabla de contactos sin RLS forzada');

-- ---- Carga por el canal de importacion (postgres + bandera de sesion) -------------------------------------------------------------------------------
select set_config('rtm.canal', 'importacion', true);
select is((contactos.cargar_lote('lote-prueba-1', $j$[
  {"telefono":"+529995550101","nombre":"Ana Prueba","telefonos":["+529995550101","+529995550102"],"correos":["ana@example.test"],"etiquetas":["Lote Uno"],"lotes":["a.csv"],
   "origenes":[{"origen":"google-lote:lote-uno","anuncio":null,"formulario":null,"campana":null}]},
  {"telefono":"+529995550103","nombre":"Beto Prueba","telefonos":["+529995550103"],"correos":[],"etiquetas":[],"lotes":["m.csv"],
   "origenes":[{"origen":"meta","anuncio":"Anuncio A","formulario":"Formulario 1","campana":"Campana 1"}]}
]$j$::jsonb)->>'nuevos')::int, 2, 'la carga crea 2 contactos');
select is((contactos.cargar_lote('lote-prueba-1', '[]'::jsonb, (select huella from contactos.carga where lote_id = 'lote-prueba-1'))->>'repetido')::boolean, true, 'repetir el mismo lote con la misma huella no hace nada');
select throws_ok($$select contactos.cargar_lote('lote-prueba-1', '[]'::jsonb, 'otra')$$, '23505', null, 'el mismo lote con otro contenido se rechaza');

-- Un lote nuevo con un telefono ya conocido (+529995550102) y un correo ya conocido se fusiona, sin duplicar.
select is((contactos.cargar_lote('lote-prueba-2', $j$[
  {"telefono":"+529995550102","nombre":"Ana P.","telefonos":["+529995550102"],"correos":["otro@example.test"],"etiquetas":[],"lotes":["b.csv"],
   "origenes":[{"origen":"vapeunion","anuncio":null,"formulario":null,"campana":null}]}
]$j$::jsonb)->>'nuevos')::int, 0, 'un telefono ya existente fusiona y no crea contacto');
select is((select count(*)::int from contactos.contacto), 2, 'sin duplicados: siguen 2 contactos');
select is((select count(*)::int from contactos.origen where contacto_id = (select contacto_id from contactos.telefono where e164 = '+529995550101')), 2, 'el contacto fusionado conserva sus dos origenes');
select is((select count(*)::int from contactos.correo where contacto_id = (select contacto_id from contactos.telefono where e164 = '+529995550101')), 2, 'y sus dos correos');
select is((select nombre from contactos.contacto where telefono_principal = '+529995550101'), 'Ana Prueba', 'el nombre conserva el mas largo');
-- Telefono sin lada (7 u 8 digitos) se conserva sin inventar la lada; mismo correo con nombre distinto NO une y marca correo compartido.
select is((contactos.cargar_lote('lote-prueba-3', $j$[
  {"telefono":"sl:5550104","nombre":"Cris Prueba","telefonos":["sl:5550104"],"correos":["ana@example.test"],"etiquetas":[],"lotes":["c.csv"],
   "origenes":[{"origen":"toocloudy","anuncio":null,"formulario":null,"campana":null}]}
]$j$::jsonb)->>'nuevos')::int, 1, 'un numero sin lada se conserva como contacto nuevo');
select is((select count(*)::int from contactos.telefono where sin_lada), 1, 'el telefono sin lada queda marcado');
select is((select count(*)::int from contactos.contacto where correo_compartido), 2, 'mismo correo con nombre distinto: no se unen y ambos quedan marcados para revision');
select is((select count(*)::int from contactos.contacto), 3, 'siguen separados: 3 contactos');
select is((contactos.cargar_lote('lote-prueba-4', $j$[
  {"telefono":"+529995550105","nombre":"ANA  prueba","telefonos":["+529995550105"],"correos":["ana@example.test"],"etiquetas":[],"lotes":["d.csv"],
   "origenes":[{"origen":"vapeunion","anuncio":null,"formulario":null,"campana":null}]}
]$j$::jsonb)->>'nuevos')::int, 0, 'mismo correo y mismo nombre normalizado: se une y conserva todos los telefonos');
select is((select count(*)::int from contactos.telefono where contacto_id = (select contacto_id from contactos.telefono where e164 = '+529995550105')), 3, 'el contacto unido por correo y nombre conserva sus 3 telefonos');
select throws_ok($$select contactos.cargar_lote('lote-malo', '[{"telefonos":[],"origenes":[]}]'::jsonb)$$, '22023', null, 'un contacto sin telefono se rechaza');
select throws_ok($$select contactos.cargar_lote('lote-malo2', '[{"telefonos":["no-es-telefono"],"origenes":[]}]'::jsonb)$$, '23514', null, 'un telefono fuera de E.164 se rechaza por la restriccion');
select set_config('rtm.canal', '', true);

-- ---- Anonimo y Omar: nada ---------------------------------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select * from contactos.contacto$$, '42501', null, 'anon no lee contactos.contacto');
select throws_ok($$select api.contactos_lista()$$, '42501', null, 'anon no ejecuta api.contactos_lista');
reset role;

select set_config('request.jwt.claim.sub', 'd4444444-4444-4444-4444-444444444442', true);
set local role authenticated;
select throws_ok($$select * from contactos.contacto$$, '42501', null, 'authenticated (Omar) no lee las tablas');
select throws_ok($$select * from contactos.v_contacto_agente$$, '42501', null, 'ni la vista del agente');
select throws_ok($$select api.contactos_lista()$$, '42501', 'permiso denegado', 'Omar no ejecuta la lista de contactos');
select throws_ok($$select api.contactos_resumen()$$, '42501', 'permiso denegado', 'Omar no ve el resumen');
select throws_ok($$select api.contacto_revelar(1)$$, '42501', 'permiso denegado', 'Omar no revela telefonos');
select throws_ok($$select api.contactos_exportar()$$, '42501', 'permiso denegado', 'Omar no exporta');
select throws_ok($$select contactos.cargar_lote('x', '[]'::jsonb)$$, '42501', null, 'nadie de la web llama a la carga');
reset role;

-- ---- Socio: lee enmascarado, revela con registro, exporta con registro --------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd4444444-4444-4444-4444-444444444441', true);
set local role authenticated;
select throws_ok($$select * from contactos.contacto$$, '42501', null, 'ni el socio lee las tablas directo: solo por api');
select is((api.contactos_lista()->>'total')::int, 3, 'el socio ve 3 contactos');
select is((api.contactos_lista('ana')->>'total')::int, 1, 'busqueda por nombre');
select is((api.contactos_lista('5550101')->>'total')::int, 1, 'busqueda por digitos del telefono');
select is((api.contactos_lista(null, 'meta')->>'total')::int, 1, 'filtro por origen meta');
select is((api.contactos_lista(null, null, 'Anuncio A')->>'total')::int, 1, 'filtro por anuncio');
select is((api.contactos_lista(null, 'google-lote')->>'total')::int, 1, 'el prefijo google-lote agrupa los lotes de Google');
select is((api.contactos_lista()->'filas'->0->>'telefono_mascara') like '%01', true, 'el telefono sale enmascarado con los ultimos 2 digitos');
select is(api.contactos_lista()::text like '%99955501%', false, 'la lista nunca trae el telefono completo');
select is((api.contactos_resumen()->>'total')::int, 3, 'resumen: total');
select is((api.contactos_resumen()->'por_origen') @> '[{"origen":"meta","contactos":1}]'::jsonb, true, 'resumen: por origen');
select is((api.contactos_resumen()->'por_anuncio') @> '[{"anuncio":"Anuncio A","formulario":"Formulario 1","contactos":1}]'::jsonb, true, 'resumen: por anuncio y formulario');

select is(jsonb_array_length(api.contacto_revelar((select (api.contactos_lista('ana')->'filas'->0->>'id')::bigint), 'llamar')->'telefonos'), 2, 'revelar entrega los telefonos del contacto');
reset role;
select is((select count(*)::int from contactos.revelacion where accion = 'revelar' and actor = 'd4444444-4444-4444-4444-444444444441'), 1, 'revelar deja registro con el actor');
select throws_ok($$update contactos.revelacion set motivo = 'x'$$, '42501', null, 'el registro de revelaciones es de solo insercion');
select throws_ok($$delete from contactos.revelacion$$, '42501', null, 'y no se borra');

select set_config('request.jwt.claim.sub', 'd4444444-4444-4444-4444-444444444441', true);
set local role authenticated;
select is((api.contactos_exportar((select array_agg((f->>'id')::bigint) from jsonb_array_elements(api.contactos_lista()->'filas') f))->>'total')::int, 3, 'exportar la seleccion entrega 3 contactos');
reset role;
select is((select count(*)::int from contactos.revelacion where accion = 'exportar'), 3, 'exportar registra una revelacion por contacto');

-- ---- Vista del agente: sin telefonos ni correos -------------------------------------------------------------------------------------------------------
select is((select count(*)::int from information_schema.columns where table_schema = 'contactos' and table_name = 'v_contacto_agente' and column_name in ('telefono_principal', 'e164', 'correo')), 0, 'la vista del agente no tiene columnas de telefono completo ni de correo');
select is((select telefono_ult2 from contactos.v_contacto_agente where nombre = 'Beto Prueba'), '***03', 'la vista del agente solo muestra los ultimos 2 digitos');
select is((select tiene_correo from contactos.v_contacto_agente where nombre = 'Beto Prueba'), false, 'y si existe correo (booleano), nunca el correo');
select is((select tiene_correo from contactos.v_contacto_agente where nombre = 'Ana Prueba'), true, 'Ana si tiene correo');

select * from finish();
rollback;
