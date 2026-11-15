-- pgTAP: catalogo.asignar_marca_modelo (solo socio/importacion, idempotente, solo reasigna 'Sin marca', auditada). ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N903".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n903.socio@example.test', 'socio', 'Angelo', true), ('n903.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('93000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n903.socio@example.test'),
  ('93000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n903.omar@example.test');

select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000001', true);
select catalogo.asegurar_modelo('Sin marca', 'N903 Fifty', 20000, 'javier');
select catalogo.asegurar_modelo('N903 Marca Real', 'N903 Modelo con marca', 10000, 'javier');

create temp table _a as select catalogo.asignar_marca_modelo('n903-a1', (select id from catalogo.modelo where nombre_norm = 'n903 fifty'), 'N903 Fifty Bar') as r;
select is((select r->>'estado' from _a), 'asignado', 'asigna la marca a un modelo de Sin marca');
select is((select b.nombre from catalogo.modelo m join catalogo.marca b on b.id = m.marca_id where m.nombre_norm = 'n903 fifty'), 'N903 Fifty Bar', 'marca_id apunta a la marca nueva (se crea si no existia)');
select is((select puffs from catalogo.modelo where nombre_norm = 'n903 fifty'), 20000, 'no toca puffs ni nombre');
select is(catalogo.asignar_marca_modelo('n903-a1', (select id from catalogo.modelo where nombre_norm = 'n903 fifty'), 'N903 Fifty Bar'), (select r from _a) || '{"repetido": true}'::jsonb, 'idempotente: misma clave devuelve lo guardado');
select throws_ok($$select catalogo.asignar_marca_modelo('n903-a1', (select id from catalogo.modelo where nombre_norm = 'n903 fifty'), 'Otra')$$, 'P0409', null, 'misma clave con otra marca = conflicto');
select is((catalogo.asignar_marca_modelo('n903-a2', (select id from catalogo.modelo where nombre_norm = 'n903 fifty'), 'n903  FIFTY bar')->>'estado'), 'sin_cambio', 'misma marca (normalizada) con clave nueva = sin cambio');
select is((select count(*)::int from seguridad.auditoria where tabla = 'catalogo.modelo' and accion = 'UPDATE' and registro_id = (select id::text from catalogo.modelo where nombre_norm = 'n903 fifty')), 1, 'una sola fila de auditoria (la de sin_cambio no audita)');
select throws_ok($$select catalogo.asignar_marca_modelo('n903-a3', (select id from catalogo.modelo where nombre_norm = 'n903 modelo con marca'), 'Otra marca')$$, 'P0428', null, 'no re-clasifica un modelo que ya tiene marca real');
select throws_ok($$select catalogo.asignar_marca_modelo('n903-a4', (select id from catalogo.modelo where nombre_norm = 'n903 fifty'), 'Sin marca')$$, '22023', null, 'la marca destino no puede ser Sin marca');
select throws_ok($$select catalogo.asignar_marca_modelo('n903-a5', 999999999, 'X')$$, '22023', null, 'modelo desconocido');
select throws_ok($$select catalogo.asignar_marca_modelo('n903-a6', 1, '   ')$$, '22023', null, 'marca vacia');
select set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000002', true);
select throws_ok($$select catalogo.asignar_marca_modelo('n903-a7', (select id from catalogo.modelo where nombre_norm = 'n903 fifty'), 'X')$$, '42501', null, 'Omar no puede');

select * from finish();
rollback;
