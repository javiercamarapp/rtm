-- pgTAP del lote A3: api.conta_serie_semanal es de solo lectura, exige rol socio y entrega semanas continuas de lunes a domingo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a3.serie@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-7777777777a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a3.serie@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a3', true);

select is(jsonb_array_length(api.conta_serie_semanal(6) -> 'semanas'), 6, 'devuelve las semanas pedidas');
select is(jsonb_array_length(api.conta_serie_semanal(1) -> 'semanas'), 2, 'el minimo es de dos semanas');
select is(jsonb_array_length(api.conta_serie_semanal(99) -> 'semanas'), 26, 'el maximo es de 26 semanas');
select is(((api.conta_serie_semanal(4) -> 'semanas') -> 3 ->> 'parcial')::boolean, true, 'la ultima semana (en curso) es parcial');
select is(((api.conta_serie_semanal(4) -> 'semanas') -> 0 ->> 'parcial')::boolean, false, 'las anteriores son completas');
select is(extract(isodow from ((api.conta_serie_semanal(4) -> 'semanas') -> 0 ->> 'ini')::date)::int, 1, 'cada semana empieza en lunes');
select is(((api.conta_serie_semanal(4) -> 'semanas') -> 3 ->> 'con_movimientos')::boolean, false, 'sin asientos no hay movimientos');
select is(((api.conta_serie_semanal(4) -> 'semanas') -> 3 ->> 'utilidad_neta_cent')::bigint, 0::bigint, 'y la utilidad de la semana vacia es cero contable');

-- Misma cifra que el estado de resultados de la semana (una sola fuente de verdad).
select is(((api.conta_serie_semanal(2) -> 'semanas') -> 0 ->> 'ventas_netas_cent')::bigint,
  (api.conta_estado_resultados(((api.conta_serie_semanal(2) -> 'semanas') -> 0 ->> 'ini')::date, ((api.conta_serie_semanal(2) -> 'semanas') -> 0 ->> 'fin')::date) ->> 'ventas_netas_cent')::bigint,
  'las ventas netas coinciden con el estado de resultados');

-- Permisos: nada ejecutable por anon; sin rol de socio se rechaza.
select is(has_function_privilege('anon', 'api.conta_serie_semanal(int)', 'execute'), false, 'anon no puede ejecutarla');
select is(has_function_privilege('authenticated', 'api.conta_serie_semanal(int)', 'execute'), true, 'authenticated si (y la funcion exige rol socio)');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select throws_ok($$ select api.conta_serie_semanal(4) $$, null, null, 'sin sesion de socio se rechaza');

select * from finish();
rollback;
