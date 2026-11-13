-- pgTAP con COMMIT REAL (no `set constraints all immediate`): el acta de corte con retiro y reinversion POR SOCIO se propone, la firman AMBOS socios y la transaccion se confirma de verdad,
-- de modo que corren los disparadores diferidos (asiento cuadrado y sello del acta). Despues, en otra transaccion, se verifica el resultado ya persistido.
-- Los pgTAP en una sola transaccion NO ejercen esos disparadores. Este archivo se llama zz_* para correr al final y DEJA sus datos confirmados (un acta firmada no se borra):
-- vale en una base recien creada (supabase db reset); si ya existe su acta, se salta con aviso en vez de fallar.
begin;
select no_plan();

create function pg_temp.ya_corrio() returns boolean language sql as $$ select exists (select 1 from operacion.cierre_reparto where periodo_ini = '2021-06-01' and periodo_fin = '2021-06-30' and tipo = 'periodo') $$;
create temp table _flag as select pg_temp.ya_corrio() as ya;
select case when (select ya from _flag) then skip('el acta de junio de 2021 ya existe: re-crear la base con supabase db reset para correr este archivo', 1) else pass('base sin el acta de junio de 2021: se corre el escenario con commit real') end;

create function pg_temp.venta(p text, p_fecha date, p_piezas int) returns void language plpgsql as $$
declare v_ped bigint;
begin
  perform operacion.crear_pedido('zzpe' || p, (select id from catalogo.cliente where nombre_canonico = 'ZZ Cliente'), jsonb_build_array(jsonb_build_object('modelo', 'ZZ Modelo 30K', 'sabor', 'Sandia', 'piezas', p_piezas)), 'isaac_directo', null, p_piezas * 20000, 0, 0, p_fecha);
  v_ped := (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'zzpe' || p);
  perform operacion.confirmar_pedido('zzpec' || p, v_ped);
  perform operacion.enviar_pedido('zzpes' || p, v_ped, null, jsonb_build_object('paqueteria', 'Castores', 'numero', 'ZZ-' || p, 'costo_cent', 0), p_fecha, true);
  perform operacion.registrar_pago('zzpga' || p, 'Angelo', p_piezas * 10000, (select id from catalogo.cliente where nombre_canonico = 'ZZ Cliente'), null, true, 'abono', p_fecha + 1);
  perform operacion.registrar_pago('zzpgj' || p, 'Javier', p_piezas * 10000, (select id from catalogo.cliente where nombre_canonico = 'ZZ Cliente'), null, true, 'abono', p_fecha + 1);
end $$;
do $$
begin
  if (select ya from _flag) then return; end if;
  insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('zz1.angelo@example.test', 'socio', 'Angelo', true), ('zz1.javier@example.test', 'socio', 'Javier', true);
  insert into auth.users (id, instance_id, aud, role, email) values
    ('c1111111-1111-1111-1111-111111111101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz1.angelo@example.test'),
    ('c1111111-1111-1111-1111-111111111102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz1.javier@example.test');
  perform set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111101', true);
  perform catalogo.asegurar_cliente('ZZ Cliente', 'Angelo');
  perform catalogo.asegurar_modelo('ZZ Marca', 'ZZ Modelo 30K', 30000, 'ambas');
  perform catalogo.asegurar_sku('ZZ Modelo 30K', 'Sandia');
  perform catalogo.fijar_costo('zzcc', 'Isaac', 'ZZ Modelo 30K', 10000, '2020-01-01', 'prueba');
  perform catalogo.fijar_precio('zzcp', 'ZZ Cliente', 'ZZ Modelo 30K', 20000, '2020-01-01', 'chat');
  perform operacion.registrar_aportacion('zza1', 'Angelo', 300000, 'Aportacion de Angelo', 'capital', '2021-06-02');
  perform pg_temp.venta('j', '2021-06-03', 100);
  perform pg_temp.venta('l', '2021-07-03', 60);
end $$;
commit;

-- Segunda transaccion: la propuesta (retiro y reinversion POR SOCIO, con la reinversion igual sugerida como valor por omision), la firma de AMBOS socios y el COMMIT.
begin;
select set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111101', true);
create temp table _sug as select case when (select ya from _flag) then null::jsonb else api.acta_reinversion_sugerida('2021-06-01', '2021-06-30') end as j;
select case when (select j from _sug) is null then skip('sin escenario', 1)
            else is((select (j->>'monto_comun_cent')::bigint from _sug), (select least((j->'por_socio'->'Angelo'->>'disponible_cent')::bigint, (j->'por_socio'->'Javier'->>'disponible_cent')::bigint) from _sug), 'la reinversion sugerida es la misma para los dos (el maximo comun)') end;
do $$
declare v_c bigint; v_dec jsonb; v_id bigint;
begin
  if (select ya from _flag) then return; end if;
  -- Junio: RETIRO distinto por socio y reinversion IGUAL (la sugerida menos el mayor retiro, para no exceder la parte de nadie).
  v_c := (api.acta_reinversion_sugerida('2021-06-01', '2021-06-30')->>'monto_comun_cent')::bigint - 100000;
  v_dec := jsonb_build_object('Angelo', jsonb_build_object('retira', 100000, 'reinvierte', v_c), 'Javier', jsonb_build_object('retira', 50000, 'reinvierte', v_c));
  perform operacion.proponer_cierre_reparto('zzact1', '2021-06-01', '2021-06-30', v_dec);
  v_id := (select id from operacion.cierre_reparto where periodo_fin = '2021-06-30' and tipo = 'periodo');
  perform operacion.firmar_cierre_reparto('zzfa', v_id);
  perform set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111102', true);
  perform operacion.firmar_cierre_reparto('zzfj', v_id);
end $$;
commit;   -- AQUI corren los disparadores diferidos; si el asiento no cuadra o el sello falla, el COMMIT falla y esta prueba no pasa.

-- Julio: el valor POR OMISION del formulario, tal cual: la reinversion igual sugerida para los dos y ningun retiro. Firmar con ese valor funciona (commit real).
begin;
select set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111101', true);
do $$
declare v_c bigint; v_id bigint;
begin
  if (select ya from _flag) then return; end if;
  v_c := (api.acta_reinversion_sugerida('2021-07-01', '2021-07-31')->>'monto_comun_cent')::bigint;
  perform operacion.proponer_cierre_reparto('zzact2', '2021-07-01', '2021-07-31', jsonb_build_object('Angelo', jsonb_build_object('retira', 0, 'reinvierte', v_c), 'Javier', jsonb_build_object('retira', 0, 'reinvierte', v_c)));
  v_id := (select id from operacion.cierre_reparto where periodo_fin = '2021-07-31' and tipo = 'periodo');
  perform operacion.firmar_cierre_reparto('zzfa2', v_id);
  perform set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111102', true);
  perform operacion.firmar_cierre_reparto('zzfj2', v_id);
end $$;
commit;

-- Tercera transaccion: lo persistido.
begin;
select set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111101', true);
create temp table _cr as select id, evento_id from operacion.cierre_reparto where periodo_fin = '2021-06-30' and tipo = 'periodo';
create temp table _cr2 as select id, evento_id from operacion.cierre_reparto where periodo_fin = '2021-07-31' and tipo = 'periodo';
create temp view _sello as select * from operacion.acta_sello where cierre_id = (select id from _cr);
select is((select count(*)::int from operacion.cierre_reparto_firma where cierre_id = (select id from _cr)), 2, 'firmaron AMBOS socios');
select is((select count(*)::int from _sello), 1, 'el sello se tomo en el COMMIT');
create temp view _asiento_acta as select l.* from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.cierre_reparto_firma f on f.evento_id = a.evento_id where f.cierre_id = (select id from _cr);
select ok((select count(*) from _asiento_acta) >= 2, 'la firma de los dos genero el asiento contable del acta');
select is((select coalesce(sum(debe_cent), 0) - coalesce(sum(haber_cent), 0) from _asiento_acta)::bigint, 0::bigint, 'el asiento del acta con retiro y reinversion esta cuadrado (debe = haber)');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, true, 'Libro conciliado: verdadero tras sellar el acta');
select is((select (decisiones->'Angelo'->>'reinvierte')::bigint from operacion.cierre_reparto where id = (select id from _cr)), (select (decisiones->'Javier'->>'reinvierte')::bigint from operacion.cierre_reparto where id = (select id from _cr)),
  'la reinversion igual por omision se firmo igual para los dos');
select isnt((select (decisiones->'Angelo'->>'retira')::bigint from operacion.cierre_reparto where id = (select id from _cr)), (select (decisiones->'Javier'->>'retira')::bigint from operacion.cierre_reparto where id = (select id from _cr)), 'y el retiro es propio de cada socio');
select is(operacion.aportacion_pendiente((select id from catalogo.socio where nombre = 'Angelo')) >= 0, true, 'la reinversion de Angelo quedo como inversion suya');

-- Valuacion sellada coherente con capital_por_mes y con el Historial (misma funcion, misma fecha: el corte del acta).
create temp table _cp as select api.capital_por_mes('2021-06-30', '2021-06-30') as j;
select is((select (contenido->'valor_participacion_cent'->>'Angelo')::bigint from _sello), (select (x->>'valuacion_cent')::bigint from _cp, jsonb_array_elements(j->'acumulado'->'socios') x where x->>'socio' = 'Angelo'), 'valuacion sellada de Angelo = capital_por_mes al corte');
select is((select (contenido->'valor_participacion_cent'->>'Javier')::bigint from _sello), (select (x->>'valuacion_cent')::bigint from _cp, jsonb_array_elements(j->'acumulado'->'socios') x where x->>'socio' = 'Javier'), 'valuacion sellada de Javier = capital_por_mes al corte');
select is((api.historial_socio('Angelo', '2021-06-30')->'cabecera'->>'valor_cent')::bigint, (select (contenido->'valor_participacion_cent'->>'Angelo')::bigint from _sello), 'el Historial de Angelo al corte muestra la valuacion sellada');
select is((api.historial_socio('Javier', '2021-06-30')->'cabecera'->>'valor_cent')::bigint, (select (contenido->'valor_participacion_cent'->>'Javier')::bigint from _sello), 'el Historial de Javier al corte muestra la valuacion sellada');
select is((select (contenido->>'valuacion_cent')::bigint - (contenido->>'deudas_cent')::bigint from _sello), (select (contenido->>'capital_contable_cent')::bigint from _sello), 'valuacion menos deudas es el capital contable sellado');
select is((select (contenido->'valor_participacion_cent'->>'Angelo')::bigint + (contenido->'valor_participacion_cent'->>'Javier')::bigint + (contenido->'por_socio'->'Angelo'->>'fondos_en_poder_cent')::bigint + (contenido->'por_socio'->'Javier'->>'fondos_en_poder_cent')::bigint
           from _sello), (select (contenido->>'capital_contable_cent')::bigint from _sello), 'las dos valuaciones selladas mas los fondos en poder son el capital contable sellado');
select is((select contenido->>'al_corte' from _sello), '2021-06-30', 'una sola fecha: el corte del acta');
select is((select (contenido->'por_socio'->'Angelo'->>'invertido_tras_acta_cent')::bigint from _sello),
          (select (contenido->'por_socio'->'Angelo'->>'invertido_cent')::bigint + (c.decisiones->'Angelo'->>'reinvierte')::bigint from _sello s join operacion.cierre_reparto c on c.id = s.cierre_id), 'invertido tras el acta = al corte mas su reinversion');

-- Julio (valor por omision del formulario: reinversion igual sugerida, sin retiro): firmo y asiento.
select is((select count(*)::int from operacion.acta_sello where cierre_id = (select id from _cr2)), 1, 'julio: firmar con la reinversion igual por omision funciona y se sella');
select is((select coalesce(sum(l.debe_cent), 0) - coalesce(sum(l.haber_cent), 0) from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.cierre_reparto_firma f on f.evento_id = a.evento_id where f.cierre_id = (select id from _cr2))::bigint, 0::bigint, 'julio: el asiento del acta con reinversion igual esta cuadrado');
select is((select (decisiones->'Angelo'->>'reinvierte')::bigint = (decisiones->'Javier'->>'reinvierte')::bigint and (decisiones->'Angelo'->>'reinvierte')::bigint > 0 from operacion.cierre_reparto where id = (select id from _cr2)), true, 'julio: la reinversion firmada es igual para los dos');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, true, 'Libro conciliado sigue verdadero tras la segunda acta');
select is((select (j->'cabecera'->>'reinversion_cent')::bigint from (select api.historial_socio('Angelo', null) as j) q) > 0, true, 'el Historial de hoy cuenta la reinversion como invertido');

select * from finish();
rollback;
