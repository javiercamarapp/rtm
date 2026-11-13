-- pgTAP con COMMIT REAL: entregas a la sociedad y liquidaciones entre socios cuando el que paga tiene FONDOS DE LA SOCIEDAD en su poder. La entrega aplica primero a esos fondos
-- (mayor 1150 y auxiliar 'fondos' bajan juntos); antes se asentaba como 'general' y 'Libro conciliado' quedaba en rojo. En cada caso, tras el COMMIT, deben cuadrar: Libro conciliado y
-- sus identidades, TODAS las comprobaciones C1..C24, las identidades K de Capital por mes y el Balance. Incluye los numeros del dueno (aportado 118,161.91 y 105,715; fondos 35,475).
-- Corre despues de zz_001 (deja datos confirmados); si ya corrio, se salta con aviso (re-crear la base con supabase db reset).
begin;
select no_plan();
create function pg_temp.ya() returns boolean language sql as $$ select exists (select 1 from catalogo.cliente where nombre_canonico = 'ZZ2 Cliente') $$;
create temp table _f as select pg_temp.ya() as ya;
select case when (select ya from _f) then skip('el escenario ZZ2 ya existe: re-crear la base con supabase db reset', 1) else pass('base sin el escenario ZZ2: se corre con commit real') end;

create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then 'c2222222-2222-2222-2222-222222222201' else 'c2222222-2222-2222-2222-222222222202' end, true) $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
-- Todo lo que NO cuadra, en una cadena ('' = todo cuadra): Libro conciliado y sus identidades, C1..C24, las K de Capital por mes y el Balance.
create function pg_temp.fallas() returns text language plpgsql as $$
declare r text := ''; v jsonb;
begin
  perform contabilidad.asentar_pendientes();
  if not coalesce((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false) then r := r || 'libro_conciliado;'; end if;
  r := r || coalesce((select string_agg('socios:' || (x->>'id'), ';') from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean), '');
  r := r || coalesce((select string_agg(c.codigo, ';' order by c.codigo) from contabilidad.comprobaciones() c where not c.ok), '');
  v := api.capital_por_mes(negocio.hoy(), negocio.hoy())->'acumulado';
  r := r || coalesce((select string_agg('K:' || (x->>'id'), ';') from jsonb_array_elements(v->'comprobaciones') x where not (x->>'ok')::boolean), '');
  if not coalesce((v->'balance'->>'cuadra')::boolean, false) then r := r || 'balance;'; end if;
  return r;
end $$;
create function pg_temp.fila(p text, k text) returns bigint language sql as
  $$ select (x->>k)::bigint from jsonb_array_elements(api.capital_por_mes(negocio.hoy(), negocio.hoy())->'acumulado'->'socios') x where x->>'socio' = $1 $$;

do $$
declare v_f bigint; v_ang bigint; v_jav bigint;
begin
  if (select ya from _f) then return; end if;
  insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('zz2.angelo@example.test', 'socio', 'Angelo', true), ('zz2.javier@example.test', 'socio', 'Javier', true);
  insert into auth.users (id, instance_id, aud, role, email) values
    ('c2222222-2222-2222-2222-222222222201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz2.angelo@example.test'),
    ('c2222222-2222-2222-2222-222222222202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz2.javier@example.test');
  perform pg_temp.como('Angelo');
  perform catalogo.asegurar_cliente('ZZ2 Cliente', 'Angelo');
  -- Numeros del dueno: aportado 118,161.91 (Javier) y 105,715.00 (Angelo); fondos de la sociedad en poder de Angelo 35,475.00.
  v_jav := 11816191 - operacion.aportado_socio(pg_temp.sid('Javier'), 'capital');
  v_ang := 10571500 - operacion.aportado_socio(pg_temp.sid('Angelo'), 'capital');
  if v_jav > 0 then perform operacion.registrar_aportacion('zz2a1', 'Javier', v_jav, 'Capital de Javier (escenario del dueno)', 'capital', '2021-09-01'); end if;
  if v_ang > 0 then perform operacion.registrar_aportacion('zz2a2', 'Angelo', v_ang, 'Capital de Angelo (escenario del dueno)', 'capital', '2021-09-01'); end if;
  v_f := 3547500 - operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos');
  if v_f > 0 then perform operacion.registrar_pago('zz2p1', 'Angelo', v_f, (select id from catalogo.cliente where nombre_canonico = 'ZZ2 Cliente'), null, true, 'abono', '2021-09-02'); end if;
end $$;
commit;

begin;
select pg_temp.como('Angelo');
select is(pg_temp.fallas(), '', 'punto de partida confirmado: libro conciliado, C1..C24, K y Balance cuadran');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 3547500::bigint, 'dueno: Angelo tiene 35,475.00 de fondos de la sociedad en su poder');
select is(pg_temp.fila('Angelo', 'fondos_en_poder_cent'), 3547500::bigint, 'capital_por_mes: fondos en poder de Angelo 35,475.00');
select is(pg_temp.fila('Angelo', 'aportacion_neta_cent'), 10571500::bigint - 3547500, 'capital_por_mes: su aportacion neta es lo aportado (105,715.00) menos esos fondos');
commit;

-- 1) ENTREGA PARCIAL a la sociedad (la que manda la pantalla: aplica_a general).
begin; select pg_temp.como('Angelo');
select operacion.registrar_entrega_socio('zz2e1', 'Angelo', 1000000, 'sociedad', null, 'general', null, '2021-09-03');
commit;
begin; select pg_temp.como('Angelo');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 2547500::bigint, 'entrega parcial: el auxiliar de fondos baja 10,000.00');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'general'), 0::bigint, 'entrega parcial: no queda renglon general');
select is(pg_temp.fila('Angelo', 'fondos_en_poder_cent'), 2547500::bigint, 'entrega parcial: capital_por_mes ve los mismos fondos que el auxiliar');
select is(pg_temp.fallas(), '', 'entrega parcial: Libro conciliado, C1..C24, K y Balance cuadran tras el COMMIT');
commit;

-- 2) LIQUIDACION entre socios con fondos en poder del pagador.
begin; select pg_temp.como('Angelo');
select operacion.registrar_liquidacion_entre_socios('zz2l1', 'Angelo', 'Javier', 500000, null, '2021-09-04');
commit;
begin; select pg_temp.como('Angelo');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 2047500::bigint, 'liquidacion con fondos: aplica primero a los fondos del pagador (baja 5,000.00)');
select is(pg_temp.fila('Angelo', 'fondos_en_poder_cent'), 2047500::bigint, 'liquidacion: capital_por_mes ve los mismos fondos');
select is(pg_temp.fallas(), '', 'liquidacion con fondos: todo cuadra tras el COMMIT');
commit;

-- 2b) Deshacer la liquidacion: los fondos vuelven a subir y todo sigue cuadrando.
begin; select pg_temp.como('Angelo');
select operacion.anular_movimiento_socio('zz2x1', 'libro', (select id from operacion.socio_libro where concepto = 'liquidacion_recibida' order by id desc limit 1), 'prueba de reversa');
commit;
begin; select pg_temp.como('Angelo');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 2547500::bigint, 'deshacer la liquidacion devuelve los fondos al saldo de fondos');
select is(pg_temp.fallas(), '', 'deshacer la liquidacion: todo cuadra');
commit;

-- 3) ENTREGA MAYOR que lo que tiene en su poder: se rechaza (el exceso no es una entrega) y nada cambia.
begin; select pg_temp.como('Angelo');
select throws_ok($$select operacion.registrar_entrega_socio('zz2e2', 'Angelo', 2547501, 'sociedad', null, 'general', null, '2021-09-05')$$, '23514', null, 'entrega mayor que los fondos: se rechaza');
select throws_ok($$select operacion.registrar_liquidacion_entre_socios('zz2l2', 'Angelo', 'Javier', 2547501, null, '2021-09-05')$$, '23514', null, 'liquidacion mayor que lo que debe a la sociedad: se rechaza');
select is(pg_temp.fallas(), '', 'tras el rechazo todo sigue cuadrando');
commit;

-- 4) ENTREGA TOTAL de lo que queda: aportacion neta de Angelo = lo aportado (105,715.00) y desaparecen los fondos "pendientes de entregar".
begin; select pg_temp.como('Angelo');
select operacion.registrar_entrega_socio('zz2e3', 'Angelo', 2547500, 'sociedad', null, 'general', null, '2021-09-06');
commit;
begin; select pg_temp.como('Angelo');
select is(operacion.saldo_socio(pg_temp.sid('Angelo'), 'fondos'), 0::bigint, 'entrega total: Angelo ya no tiene fondos de la sociedad en su poder');
select is(pg_temp.fila('Angelo', 'fondos_en_poder_cent'), 0::bigint, 'entrega total: desaparece el renglon pendiente de entregar (capital_por_mes)');
select is(pg_temp.fila('Angelo', 'aportacion_neta_cent'), 10571500::bigint, 'dueno: la aportacion neta de Angelo sube a 105,715.00');
select is(pg_temp.fallas(), '', 'entrega total: todo cuadra tras el COMMIT');
commit;

-- 5) Entrega total de Javier y LIQUIDACION SIN FONDOS (comportamiento actual: no puede liquidar mas de lo que debe a la sociedad).
begin; select pg_temp.como('Javier');
select operacion.registrar_entrega_socio('zz2e4', 'Javier', greatest(operacion.saldo_socio(pg_temp.sid('Javier')), 1), 'sociedad', null, 'general', null, '2021-09-07')
  where operacion.saldo_socio(pg_temp.sid('Javier')) > 0;
commit;
begin; select pg_temp.como('Javier');
select is(greatest(operacion.saldo_socio(pg_temp.sid('Javier')), 0), 0::bigint, 'Javier tampoco tiene ya fondos ni deuda con la sociedad');
select throws_ok($$select operacion.registrar_liquidacion_entre_socios('zz2l3', 'Javier', 'Angelo', 100, null, '2021-09-08')$$, '23514', null, 'liquidacion sin fondos: se rechaza como siempre');
select is(pg_temp.fallas(), '', 'sin fondos de nadie: todo cuadra');
commit;

select * from finish();
