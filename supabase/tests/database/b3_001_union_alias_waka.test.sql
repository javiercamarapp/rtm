-- pgTAP: union aprobada de alias Waka (aprobacion por regla, herencia de precio/costo ya probada por script). Datos sinteticos.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);

select has_table('catalogo', 'unificacion_modelo_aprobada', 'existe la tabla de uniones aprobadas');
select is((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'catalogo.unificacion_modelo_aprobada'::regclass), true, 'RLS activa y forzada');
select ok(not has_table_privilege('authenticated', 'catalogo.unificacion_modelo_aprobada', 'select'), 'nadie con sesion la lee directo');
select is((select destino_norm from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = catalogo.normalizar('Optimus')), catalogo.normalizar('Waka Optimus 100K'), 'Optimus apunta a 100K (decision del dueno)');
select is((select destino_norm from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = catalogo.normalizar('Waka SoPro')), catalogo.normalizar('Waka 15K'), 'SoPro apunta a 15K');

select catalogo.asegurar_marca('Marca Waka T');
select catalogo.asegurar_modelo('Marca Waka T', 'Waka SoPro', null, 'ambas');
select catalogo.asegurar_modelo('Marca Waka T', 'Waka 15K', 15000, 'ambas');
select catalogo.asegurar_modelo('Marca Waka T', 'Modelo Ajeno', null, 'ambas');

select throws_ok($$select catalogo.unificar_modelo('t-sin', (select id from catalogo.modelo where nombre_norm = 'waka sopro'), (select id from catalogo.modelo where nombre_norm = 'waka 15k'), 'importacion', null, null)$$,
  '42501', null, 'sin aprobacion un nombre solo parecido no se une');
select throws_ok($$select catalogo.unificar_modelo('t-regla-mala', (select id from catalogo.modelo where nombre_norm = 'waka sopro'), (select id from catalogo.modelo where nombre_norm = 'waka 15k'), 'importacion', null, 'otra-regla')$$,
  '42501', null, 'una regla inexistente no aprueba');
select throws_ok($$select catalogo.unificar_modelo('t-ajeno', (select id from catalogo.modelo where nombre_norm = 'modelo ajeno'), (select id from catalogo.modelo where nombre_norm = 'waka 15k'), 'importacion', null, 'alias-waka-2026-11-14')$$,
  '42501', null, 'la regla solo vale para los pares del diccionario');
select is((catalogo.unificar_modelo('t-ok', (select id from catalogo.modelo where nombre_norm = 'waka sopro'), (select id from catalogo.modelo where nombre_norm = 'waka 15k'), 'importacion', null, 'alias-waka-2026-11-14')) ->> 'estado', 'unificado', 'el par aprobado se une');
select is((catalogo.unificar_modelo('t-ok', (select id from catalogo.modelo where nombre_original = 'Waka SoPro'), (select id from catalogo.modelo where nombre_norm = 'waka 15k'), 'importacion', null, 'alias-waka-2026-11-14')) ->> 'repetido', 'true', 'idempotente por clave');
select is((select modelo_id from catalogo.modelo_alias where alias_norm = 'waka sopro'), (select id from catalogo.modelo where nombre_norm = 'waka 15k'), 'el nombre viejo queda como alias del destino');
select is((select aprobacion from catalogo.unificacion_catalogo order by id desc limit 1), 'alias:alias-waka-2026-11-14', 'queda registrada la aprobacion');
select is((catalogo.deshacer_unificacion_catalogo('t-undo', (select max(id) from catalogo.unificacion_catalogo))) ->> 'estado', 'deshecha', 'se puede deshacer');
select * from finish();
rollback;
