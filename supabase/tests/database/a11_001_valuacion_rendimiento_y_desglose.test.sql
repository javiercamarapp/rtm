-- pgTAP a11_001: (1) RENDIMIENTO: la serie mensual de api.cuenta_socios_valuacion (una consulta por conjuntos) da EXACTAMENTE las mismas cifras que el calculo anterior (una llamada a cap_periodo por mes),
-- con 1, 12 y 61 meses de historia sembrados; (2) DESGLOSE de la diferencia de valuacion y pasos para igualar con las cifras del dueno (Javier 154,832.30 contra Angelo 106,910.39 = 47,921.91 =
-- 12,446.91 que aporto menos + 35,475.00 de fondos de la sociedad cobrados en su cuenta); (3) caso igualado y caso con retiros desiguales; (4) agente.valuacion_socios (lectura de Telegram).
-- Cifras a mano (escenario del dueno): capital Javier 118,161.91, Angelo 105,715.00; utilidad 73,340.78 (50/50 = 36,670.39 cada uno); fondos en poder de Angelo 35,475.00 (tres cobros de clientes).
--   Javier : 118,161.91 + 36,670.39 = 154,832.30        Angelo : 105,715.00 + 36,670.39 - 35,475.00 = 106,910.39        X = 47,921.91
--   Entrega 35,475.00 -> Angelo 142,385.39 (diferencia 12,446.91); aporta 12,446.91 -> 154,832.30 (igualados).
begin;
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(5800001, 'angelo');
select agente.registrar_miembro(5800002, 'javier');
select set_config('rtm.canal', '', true);
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('vd.ang@example.test', 'socio', 'Angelo', true), ('vd.jav@example.test', 'socio', 'Javier', true), ('vd.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vd.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777d2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vd.jav@example.test'),
  ('77777777-7777-7777-7777-7777777777d3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vd.omar@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777d1' when 'Omar' then '77777777-7777-7777-7777-7777777777d3' when 'Javier' then '77777777-7777-7777-7777-7777777777d2' else '' end, true) $$;
create function pg_temp.cv(p date default null) returns jsonb language sql as $$ select api.cuenta_socios_valuacion(p) $$;
create function pg_temp.s(p_socio text) returns jsonb language sql as $$ select x from jsonb_array_elements(pg_temp.cv()->'socios') x where x->>'socio' = $1 $$;
create function pg_temp.ig() returns jsonb language sql as $$ select pg_temp.cv()->'igualacion' $$;
create function pg_temp.comp(p_id text) returns bigint language sql as $$ select (x->>'monto_cent')::bigint from jsonb_array_elements(pg_temp.ig()->'componentes') x where x->>'id' = $1 $$;

-- Calculo ANTERIOR de la serie (una llamada a cap_periodo por mes), copiado tal cual de la version previa, como referencia.
create function pg_temp.serie_ref(p_hasta date) returns jsonb language plpgsql as $$
declare v_primera date; v_serie jsonb := '[]'::jsonb; v_m date; v_fin date; v_ini date; v_p jsonb; r jsonb; v_acum jsonb := jsonb_build_object('Angelo', 0, 'Javier', 0); v_n int := 0;
begin
  select min(a.fecha_contable) into v_primera from contabilidad.asiento a;
  v_primera := least(coalesce(v_primera, p_hasta), p_hasta);
  v_m := date_trunc('month', v_primera)::date;
  while v_m <= p_hasta and v_n < 61 loop
    v_ini := greatest(v_m, v_primera); v_fin := least((v_m + interval '1 month - 1 day')::date, p_hasta);
    v_p := operacion.cap_periodo(v_ini, v_fin, false);
    for r in select value from jsonb_array_elements(v_p -> 'socios') loop
      v_acum := jsonb_set(v_acum, array[r ->> 'socio'], to_jsonb((v_acum ->> (r ->> 'socio'))::bigint + (r ->> 'utilidad_retirada_cent')::bigint + (r ->> 'devoluciones_capital_cent')::bigint));
    end loop;
    v_serie := v_serie || jsonb_build_object('mes', to_char(v_m, 'YYYY-MM'), 'fin', v_fin, 'parcial', v_fin < (v_m + interval '1 month - 1 day')::date, 'socios',
      (select jsonb_agg(jsonb_build_object('socio', r2 ->> 'socio', 'valuacion_cent', (r2 ->> 'valuacion_cent')::bigint, 'capital_aportado_cent', (r2 ->> 'capital_aportado_acum_cent')::bigint,
          'retirado_cent', (v_acum ->> (r2 ->> 'socio'))::bigint,
          'utilidades_acumuladas_cent', (r2 ->> 'valuacion_libro_cent')::bigint + (v_acum ->> (r2 ->> 'socio'))::bigint - (r2 ->> 'capital_aportado_acum_cent')::bigint,
          'fondos_en_poder_cent', (r2 ->> 'fondos_en_poder_cent')::bigint) order by r2 ->> 'socio') from jsonb_array_elements(v_p -> 'socios') r2));
    v_m := (v_m + interval '1 month')::date; v_n := v_n + 1;
  end loop;
  return v_serie;
end $$;

select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('VD Marca', 'VD Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('VD Modelo', 'Uva');
select catalogo.fijar_costo('vd-c', 'Isaac', 'VD Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_modelo('VD Marca', 'VD Karen', 25000, 'ambas');
select catalogo.asegurar_sku('VD Karen', 'Mango');
select catalogo.fijar_costo('vd-ck', 'Karen', 'VD Karen', 8000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('VD Cliente', 'Javier');
select catalogo.fijar_precio('vd-p', 'VD Cliente', 'VD Modelo', 20000, '2020-01-01', 'chat');
select catalogo.fijar_precio('vd-pk', 'VD Cliente', 'VD Karen', 15000, '2020-01-01', 'chat');

-- Historia de 60 meses antes del escenario del dueno: una aportacion de capital por mes y socio (la ultima de cada uno cierra en 118,161.91 y 105,715.00 con el resto).
select operacion.registrar_aportacion('vd-hj-' || i, 'Javier', 100000, 'Capital mes ' || i, 'capital', (date '2026-10-10' - ((59 - i) || ' months')::interval)::date) from generate_series(0, 59) i;
select operacion.registrar_aportacion('vd-ha-' || i, 'Angelo', 90000, 'Capital mes ' || i, 'capital', (date '2026-10-10' - ((59 - i) || ' months')::interval)::date) from generate_series(0, 59) i;
-- Resto del capital inicial: Javier 118,161.91 - 60 x 1,000.00 = 58,161.91 ; Angelo 105,715.00 - 60 x 900.00 = 51,715.00
select operacion.registrar_aportacion('vd-a1', 'Javier', 5816191, 'Capital inicial (resto)', 'capital', '2026-10-15');
select operacion.registrar_aportacion('vd-a2', 'Angelo', 5171500, 'Capital inicial (resto)', 'capital', '2026-10-19');
-- Ventas y cobros: utilidad 73,340.78 = 40,000.00 + 10,500.00 + 22,840.78 de envio cobrado
select operacion.crear_pedido('vd-v1', (select id from catalogo.cliente where nombre_canonico='VD Cliente'), '[{"modelo":"VD Modelo","sabor":"Uva","piezas":400}]'::jsonb, 'isaac_directo', null, 2284078, 0, 0, '2026-11-03');
select operacion.confirmar_pedido('vd-v1c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'vd-v1'));
select operacion.enviar_pedido('vd-v1e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'vd-v1'), null, '{"paqueteria":"Castores","numero":"VD-G1","costo_cent":0}'::jsonb, '2026-11-03', true);
select operacion.crear_pedido('vd-v2', (select id from catalogo.cliente where nombre_canonico='VD Cliente'), '[{"modelo":"VD Karen","sabor":"Mango","piezas":150}]'::jsonb, 'karen_directo', null, 0, 0, 0, '2026-11-04');
select operacion.confirmar_pedido('vd-v2c', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'vd-v2'));
select operacion.enviar_pedido('vd-v2e', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'vd-v2'), null, '{"paqueteria":"Castores","numero":"VD-G2","costo_cent":0}'::jsonb, '2026-11-04', true);
select operacion.registrar_pago('vd-pg2', 'Efectivo', 2518573, (select id from catalogo.cliente where nombre_canonico='VD Cliente'), null, true, 'abono', '2026-11-08');
select operacion.registrar_pago('vd-pg3', 'Isaac', 4500000, (select id from catalogo.cliente where nombre_canonico='VD Cliente'), null, true, 'abono', '2026-11-09');
-- Tres cobros que le pagaron a Angelo (fondos de la sociedad en su cuenta): 10,000.00 + 15,000.00 + 10,475.00 = 35,475.00
select operacion.registrar_pago('vd-pg1a', 'Angelo', 1000000, (select id from catalogo.cliente where nombre_canonico='VD Cliente'), null, true, 'abono', '2026-11-10');
select operacion.registrar_pago('vd-pg1b', 'Angelo', 1500000, (select id from catalogo.cliente where nombre_canonico='VD Cliente'), null, true, 'abono', '2026-11-11');
select operacion.registrar_pago('vd-pg1c', 'Angelo', 1047500, (select id from catalogo.cliente where nombre_canonico='VD Cliente'), null, true, 'abono', '2026-11-12');
select contabilidad.asentar_pendientes();
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');

-- ============================================================ (1) RENDIMIENTO: serie por conjuntos == serie por cap_periodo, con 1, 12 y 61 meses
select is(jsonb_array_length(pg_temp.cv('2021-12-31')->'serie'), 2, 'corte 31-dic-2021: dos meses sembrados (nov y dic 2021)');
select is(pg_temp.cv('2021-11-30')->'serie', pg_temp.serie_ref('2021-11-30'), '1 mes de historia: la serie nueva es identica a la de una llamada a cap_periodo por mes');
select is(jsonb_array_length(pg_temp.cv('2021-11-30')->'serie'), 1, '... y es de un solo mes');
select is(pg_temp.cv('2022-10-31')->'serie', pg_temp.serie_ref('2022-10-31'), '12 meses de historia: identica');
select is(jsonb_array_length(pg_temp.cv('2022-10-31')->'serie'), 12, '... y es de doce meses');
select is(pg_temp.cv()->'serie', pg_temp.serie_ref(negocio.hoy()), '61 meses de historia: identica');
select is(jsonb_array_length(pg_temp.cv()->'serie'), 61, '... y es de 61 meses (el tope)');
select is(pg_temp.cv('2026-10-31')->'serie', pg_temp.serie_ref('2026-10-31'), 'corte a mitad de la historia (31-oct-2026), hasta el tope de 61 meses: identica');
select ok((select bool_and((s->>'valuacion_cent')::bigint = (pg_temp.s(s->>'socio')->>'valuacion_cent')::bigint) from jsonb_array_elements(pg_temp.cv()->'serie'->60->'socios') s), 'el ultimo mes de la serie es la valuacion actual de cada socio');

-- ============================================================ (2) DESGLOSE con las cifras del dueno
select is((pg_temp.s('Javier')->>'valuacion_cent')::bigint, 15483230::bigint, 'Javier: valuacion 154,832.30');
select is((pg_temp.s('Angelo')->>'valuacion_cent')::bigint, 10691039::bigint, 'Angelo: valuacion 106,910.39 (ya resta sus fondos)');
select is((pg_temp.s('Angelo')->>'fondos_en_poder_cent')::bigint, 3547500::bigint, 'Angelo: fondos de la sociedad en su poder 35,475.00');
select is((pg_temp.s('Javier')->>'capital_aportado_cent')::bigint, 11816191::bigint, 'Javier: capital aportado 118,161.91');
select is((pg_temp.s('Angelo')->>'capital_aportado_cent')::bigint, 10571500::bigint, 'Angelo: capital aportado 105,715.00');
select is((pg_temp.ig()->>'faltan_cent')::bigint, 4792191::bigint, 'faltan 47,921.91 para estar identicos');
select is((pg_temp.ig()->>'igualados')::boolean, false, 'no estan igualados');
select is(pg_temp.ig()->>'menor', 'Angelo', 'tiene menos Angelo');
select is(pg_temp.ig()->>'mayor', 'Javier', 'tiene mas Javier');
select is(pg_temp.comp('capital'), 1244691::bigint, 'componente 1: aporto menos capital, 12,446.91 (105,715.00 contra 118,161.91)');
select is(pg_temp.comp('fondos'), 3547500::bigint, 'componente 2: fondos de la sociedad cobrados en su cuenta, 35,475.00');
select is(pg_temp.comp('retiros'), 0::bigint, 'componente 3: retiros, 0 (los dos en 0)');
select is(pg_temp.comp('utilidades'), 0::bigint, 'componente 4: utilidades, 0 (36,670.39 cada uno)');
select is((pg_temp.ig()->>'suma_componentes_cent')::bigint, (pg_temp.ig()->>'faltan_cent')::bigint, 'los componentes suman exactamente lo que falta');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'entregar_cent')::bigint, 3547500::bigint, 'Angelo: entrega a la sociedad 35,475.00');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'valuacion_tras_entregar_cent')::bigint, 14238539::bigint, 'al entregar, la valuacion de Angelo sube a 142,385.39');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'aportar_cent')::bigint, 1244691::bigint, 'y luego aporta 12,446.91');
select is((pg_temp.ig()->'por_socio'->'Javier'->>'entregar_cent')::bigint, 0::bigint, 'Javier no tiene nada que entregar');
select is((pg_temp.ig()->'por_socio'->'Javier'->>'aportar_cent')::bigint, 0::bigint, 'ni que aportar');
select is((pg_temp.ig()->>'diferencia_libro_cent')::bigint, 4792191::bigint, 'la diferencia a igualar del libro es 47,921.91');
select is((pg_temp.ig()->>'coincide_con_libro')::boolean, true, 'entregar + aportar coincide con "diferencia a igualar" y "le toca aportar" del libro');
select is(pg_temp.cv()->'comparacion'->>'le_toca_aportar', 'Angelo', 'le toca aportar a Angelo (el libro)');
select is(jsonb_array_length(pg_temp.s('Angelo')->'fondos_detalle'), 3, 'Angelo: tres cobros explican los fondos en su poder');
select is((select sum((x->>'monto_cent')::bigint)::bigint from jsonb_array_elements(pg_temp.s('Angelo')->'fondos_detalle') x), 3547500::bigint, '... y suman 35,475.00');
select is(jsonb_array_length(pg_temp.s('Javier')->'fondos_detalle'), 0, 'Javier: sin fondos en su poder');
select ok((select bool_and((x->>'ok')::boolean) from jsonb_array_elements(pg_temp.cv()->'identidades') x), 'las identidades S1 a S6 cuadran');
select ok((select bool_and((x->>'ok')::boolean) from jsonb_array_elements(pg_temp.cv()->'comprobaciones_libro') x where x->>'id' in ('K1','K2','K3')), 'y las comprobaciones K1 a K3 del libro');

-- ============================================================ (4) agente.valuacion_socios (lectura de Telegram: mismas cifras que la web)
create function pg_temp.av() returns jsonb language plpgsql as $$ begin perform pg_temp.como(''); return agente.valuacion_socios(); end $$;
select is((select (x->>'valuacion_cent')::bigint from jsonb_array_elements(pg_temp.av()->'socios') x where x->>'socio' = 'Angelo'), 10691039::bigint, 'agente.valuacion_socios: Angelo 106,910.39 (la misma funcion que la web)');
select is((pg_temp.av()->'igualacion'->>'faltan_cent')::bigint, 4792191::bigint, 'agente.valuacion_socios: faltan 47,921.91');
select is((pg_temp.av()->'igualacion'->'por_socio'->'Angelo'->>'aportar_cent')::bigint, 1244691::bigint, 'agente.valuacion_socios: Angelo aporta 12,446.91 tras entregar');
select ok(not (pg_temp.av()::text ~* '(tel|phone|whatsapp)'), 'sin telefonos en la lectura del agente');
select ok(not has_function_privilege('anon', 'agente.valuacion_socios()', 'execute') and not has_function_privilege('authenticated', 'agente.valuacion_socios()', 'execute'), 'solo el servidor ejecuta agente.valuacion_socios');
select pg_temp.como('Omar');
select throws_ok($$select api.cuenta_socios_valuacion()$$, null, null, 'Omar no lee la cuenta de socios');
select pg_temp.como('Javier');

-- ============================================================ el socio entrega los fondos: Angelo sube a 142,385.39 y la diferencia baja a 12,446.91
select pg_temp.como('Angelo');
select operacion.registrar_entrega_socio('vd-e1', 'Angelo', 3547500, 'sociedad', null, 'fondos');
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');
select is((pg_temp.s('Angelo')->>'valuacion_cent')::bigint, 14238539::bigint, 'tras entregar los 35,475.00, Angelo vale 142,385.39');
select is((pg_temp.ig()->>'faltan_cent')::bigint, 1244691::bigint, '... y la diferencia baja a 12,446.91');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'entregar_cent')::bigint, 0::bigint, '... ya no tiene nada que entregar');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'aportar_cent')::bigint, 1244691::bigint, '... y le falta aportar 12,446.91');
select is(pg_temp.comp('fondos'), 0::bigint, 'el componente de fondos es 0');
select is((pg_temp.ig()->>'coincide_con_libro')::boolean, true, 'sigue coincidiendo con la diferencia a igualar del libro (12,446.91)');
select is((pg_temp.cv()->'comparacion'->>'diferencia_aportacion_cent')::bigint, 1244691::bigint, 'el libro tambien dice 12,446.91');

-- ============================================================ aporta lo que falta: igualados
select pg_temp.como('Angelo');
select operacion.registrar_aportacion('vd-a3', 'Angelo', 1244691, 'Aporta para igualar', 'capital', '2026-11-13');
select contabilidad.asentar_pendientes();
select pg_temp.como('Javier');
select is((pg_temp.ig()->>'igualados')::boolean, true, 'tras aportar 12,446.91: igualados');
select is((pg_temp.ig()->>'faltan_cent')::bigint, 0::bigint, 'faltan 0');
select ok(pg_temp.ig()->>'menor' is null and pg_temp.ig()->>'mayor' is null, 'sin mayor ni menor');
select is((pg_temp.s('Angelo')->>'valuacion_cent')::bigint, (pg_temp.s('Javier')->>'valuacion_cent')::bigint, 'valuaciones identicas');
select is((pg_temp.s('Angelo')->>'valuacion_cent')::bigint, 15483230::bigint, '... en 154,832.30');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'aportar_cent')::bigint, 0::bigint, 'nadie aporta');
select is(pg_temp.cv()->'serie'->60->'socios'->0->>'valuacion_cent', pg_temp.serie_ref(negocio.hoy())->60->'socios'->0->>'valuacion_cent', 'la serie sigue identica a la referencia con el ultimo movimiento');

-- ============================================================ (3) retiros desiguales: el desglose los muestra y la suma sigue exacta
select pg_temp.como('Angelo');
select operacion.proponer_cierre_reparto('vd-ac1', '2026-11-01', '2026-11-13', '{"Angelo":{"retira":0,"reinvierte":0},"Javier":{"retira":0,"reinvierte":0}}');
select operacion.firmar_cierre_reparto('vd-ac2', (select max(id) from operacion.cierre_reparto));
select pg_temp.como('Javier');
select operacion.firmar_cierre_reparto('vd-ac3', (select max(id) from operacion.cierre_reparto));
set constraints all immediate;
select contabilidad.asentar_pendientes();
select operacion.registrar_pago_a_socio('vd-r1', 'Javier', 300000, 'retiro', 'efectivo', '2026-11-13');
select operacion.registrar_pago_a_socio('vd-r2', 'Angelo', 400000, 'retiro', 'efectivo', '2026-11-13');
select contabilidad.asentar_pendientes();
select is((pg_temp.cv()->'comparacion'->>'retiros_desiguales')::boolean, true, 'retiros desiguales: alerta');
select is((pg_temp.s('Javier')->>'retirado_cent')::bigint, 300000::bigint, 'Javier retiro 3,000.00');
select is((pg_temp.s('Angelo')->>'retirado_cent')::bigint, 400000::bigint, 'Angelo retiro 4,000.00');
select is((pg_temp.ig()->>'faltan_cent')::bigint, 100000::bigint, 'Angelo quedo 1,000.00 abajo por haberse pagado mas');
select is(pg_temp.ig()->>'menor', 'Angelo', 'tiene menos Angelo');
select is(pg_temp.comp('retiros'), 100000::bigint, 'componente de retiros: 1,000.00');
select is(pg_temp.comp('capital'), 0::bigint, 'capital: 0 (ya aporto lo que le tocaba)');
select is(pg_temp.comp('fondos'), 0::bigint, 'fondos: 0');
select is((pg_temp.ig()->>'suma_componentes_cent')::bigint, (pg_temp.ig()->>'faltan_cent')::bigint, 'los componentes suman exactamente lo que falta');
select is((pg_temp.ig()->'por_socio'->'Angelo'->>'aportar_cent')::bigint, 100000::bigint, 'Angelo aporta 1,000.00 para igualar valuaciones');
select is((pg_temp.ig()->>'coincide_con_libro')::boolean, false, 'y esto ya no coincide con la diferencia de aportaciones del libro: por los retiros desiguales (que se muestran aparte)');
select is((pg_temp.cv()->'comparacion'->>'diferencia_retiros_cent')::bigint, 100000::bigint, 'diferencia de retiros 1,000.00');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dead', true);
select * from finish();
rollback;
