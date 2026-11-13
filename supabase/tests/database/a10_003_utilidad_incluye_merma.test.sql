-- pgTAP a10_003 (campana E2E maestra, MEDIO-1): la utilidad distribuible (operacion.utilidad_periodo, base del reparto 50/50 y del Historial personal) es la del libro:
-- ventas menos TODO costo, incluida la merma por obsequio (cuenta 5200). Datos sinteticos con cifras hechas a mano (centavos):
--   pedido de 100 pzas a 200.00 con costo 100.00 y 3,721.00 de cargo extra => utilidad 13,721.00 = 1,372,100.
--   entrada de 10 pzas por 1,000.00 (costo 100.00 c/u) y baja por merma de 4 pzas => 400.00 = 40,000. Utilidad distribuible = 1,332,100.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a103.angelo@example.test', 'socio', 'Angelo', true), ('a103.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('a1036666-6666-6666-6666-666666666661', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a103.angelo@example.test'),
  ('a1036666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a103.javier@example.test');
select set_config('request.jwt.claim.sub', 'a1036666-6666-6666-6666-666666666661', true);
create function pg_temp.como(p text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', case p when 'Angelo' then 'a1036666-6666-6666-6666-666666666661' else 'a1036666-6666-6666-6666-666666666662' end, true); end $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.up(p_ini date, p_fin date, p_k text) returns bigint language sql as $$ select (operacion.utilidad_periodo($1, $2) ->> $3)::bigint $$;
create function pg_temp.libro(p_ini date, p_fin date) returns bigint language sql as $$ select (contabilidad.estado_resultados($1, $2) ->> 'utilidad_neta_cent')::bigint $$;

select catalogo.asegurar_cliente('A103 Cliente', 'Angelo');
select catalogo.asegurar_modelo('A103 Marca', 'A103 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('A103 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('a103cc', 'Isaac', 'A103 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('a103cp', 'A103 Cliente', 'A103 Modelo 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('a103pe', pg_temp.cid('A103 Cliente'), '[{"modelo":"A103 Modelo 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 372100, 0, 0, '2021-03-03');
select operacion.confirmar_pedido('a103pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a103pe'));
select operacion.enviar_pedido('a103pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a103pe'), null, '{"paqueteria":"Castores","numero":"A103-G1","costo_cent":0}'::jsonb, '2021-03-03', true);
select operacion.registrar_movimiento('a103e1', 'A103 Modelo 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 10, 100000, '2021-03-02');
select contabilidad.asentar_pendientes();
set constraints all immediate;

-- Antes de la merma: utilidad_periodo y libro dicen lo mismo.
select is(pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_cent'), 1372100::bigint, 'sin merma: utilidad del periodo 13,721.00');
select is(pg_temp.libro('2021-03-02', '2021-03-08'), 1372100::bigint, 'sin merma: el libro dice 13,721.00');
select is(pg_temp.up('2021-03-02', '2021-03-08', 'merma_cent'), 0::bigint, 'sin merma: merma 0');

-- Piezas regaladas: baja de 4 piezas a costo promedio.
select is((operacion.registrar_movimiento('a103m1', 'A103 Modelo 30K', 'Sandia', 'bodega_omar', 'merma', -4, null, '2021-03-05')->>'valor_cent')::bigint, -40000::bigint, 'baja de 4 piezas a costo promedio: 400.00');
select contabilidad.asentar_pendientes();
set constraints all immediate;
select is(pg_temp.up('2021-03-02', '2021-03-08', 'merma_cent'), 40000::bigint, 'la merma del periodo es 400.00');
select is(pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_cent'), 1332100::bigint, 'utilidad distribuible 13,321.00 = 13,721.00 - 400.00');
select is(pg_temp.libro('2021-03-02', '2021-03-08'), 1332100::bigint, 'el libro (Estado de resultados) dice lo mismo');
select is(pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_cent'), pg_temp.libro('2021-03-02', '2021-03-08'), 'utilidad_periodo = utilidad del libro');
select is(1372100::bigint - pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_cent'), 1372100::bigint - pg_temp.libro('2021-03-02', '2021-03-08'), 'delta del libro = delta de utilidad_periodo (400.00 a 400.00)');
-- La suma por partes sigue cuadrando: pedidos + tomas - gastos (los gastos traen la merma, igual que los paquetes).
select is(pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_pedidos_cent') + pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_tomas_cent') - pg_temp.up('2021-03-02', '2021-03-08', 'gastos_cent'), pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_cent'), 'pedidos + tomas - gastos = utilidad');
-- Un periodo sin la merma no la cuenta, y una baja posterior cae en SU periodo.
select is(pg_temp.up('2021-03-09', '2021-03-15', 'merma_cent'), 0::bigint, 'otra semana: sin merma');
select is((api.explicar_cifra('cascada:utilidad:2021-03-02:2021-03-08')->>'valor')::bigint, 1332100::bigint, 'Explicar este numero: la utilidad neta trae la merma');
select is((api.explicar_cifra('cascada:utilidad:2021-03-02:2021-03-08')->'comprobacion'->>'cuadra')::boolean, true, 'Explicar: las dos vias cuadran');
select is((select (r->>'monto_cent')::bigint from jsonb_array_elements(api.explicar_cifra('cascada:utilidad:2021-03-02:2021-03-08')->'renglones') r where r->>'concepto' like 'Merma%'), -40000::bigint, 'Explicar: renglon propio de la merma, -400.00');
-- El libro de movimientos (Resumen) y el historial leen la misma utilidad del periodo.
select is((operacion.cascada_periodo('2021-03-02', '2021-03-08')->>'utilidad_cent')::bigint, 1332100::bigint, 'la cascada del reparto parte de la utilidad con merma');

-- Un acta ya sellada no cambia con una merma posterior (otro periodo).
select is((operacion.proponer_cierre_reparto('a103a1', '2021-03-02', '2021-03-08', '{"Angelo":{"retira":0,"reinvierte":0},"Javier":{"retira":0,"reinvierte":0}}')->>'cierre_id') is not null, true, 'se propone el acta del periodo');
select pg_temp.como('Angelo');
select operacion.firmar_cierre_reparto('a103f1', (select id from operacion.cierre_reparto order by id desc limit 1));
select pg_temp.como('Javier');
select is((operacion.firmar_cierre_reparto('a103f2', (select id from operacion.cierre_reparto order by id desc limit 1))->>'cerrado')::boolean, true, 'con las dos firmas el acta surte efecto');
create temp table _sello as select md5(to_jsonb(c)::text) as huella from operacion.cierre_reparto c order by id desc limit 1;
select is((select utilidad_cent from operacion.cierre_reparto order by id desc limit 1), 1332100::bigint, 'el acta sellada guarda la utilidad con merma: 13,321.00 (no 13,721.00)');
select operacion.registrar_movimiento('a103m2', 'A103 Modelo 30K', 'Sandia', 'bodega_omar', 'merma', -2, null, '2021-03-20');
select contabilidad.asentar_pendientes();
set constraints all immediate;
select is(pg_temp.up('2021-03-16', '2021-03-22', 'merma_cent'), 20000::bigint, 'la baja posterior cae en su semana: 200.00');
select is((select md5(to_jsonb(c)::text) from operacion.cierre_reparto c order by id desc limit 1), (select huella from _sello), 'el acta sellada no cambio una sola coma');
select is(pg_temp.up('2021-03-02', '2021-03-08', 'utilidad_cent'), 1332100::bigint, 'y la utilidad de su periodo sigue en 13,321.00');
-- Revertir una baja la quita de la utilidad; un asiento manual de paquetes (reclasifica 5100 a 5200) no cuenta como merma por obsequio.
select operacion.reversar_evento('a103r', (select (resultado->>'evento_id')::bigint from seguridad.operacion where clave = 'a103m2'), 'se dio de baja por error');
select contabilidad.asentar_pendientes();
set constraints all immediate;
select is(pg_temp.up('2021-03-16', negocio.hoy(), 'merma_cent'), 0::bigint, 'la reversa de la baja (fechada hoy) la cancela: merma neta 0 desde su semana');
select is(pg_temp.up('2021-03-16', '2021-03-22', 'merma_cent'), 20000::bigint, 'y en su semana original la baja sigue siendo de 200.00 (la reversa cae en el dia que se hizo)');
select contabilidad.registrar_asiento_manual('a103am', '2021-03-20', 'prueba: reclasificacion manual 5100 a 5200', '[{"cuenta":"5200","debe_cent":7000},{"cuenta":"5100","haber_cent":7000}]'::jsonb);
set constraints all immediate;
select is(pg_temp.up('2021-03-16', negocio.hoy(), 'merma_cent'), 0::bigint, 'un asiento manual en 5200 no es merma por obsequio (no se cuenta dos veces)');
select is(has_function_privilege('authenticated', 'operacion.merma_periodo(date,date)', 'execute'), false, 'GRANT: authenticated no ejecuta operacion.merma_periodo');
select is(has_function_privilege('anon', 'operacion.utilidad_periodo(date,date)', 'execute'), false, 'GRANT: anon no ejecuta operacion.utilidad_periodo');
select * from finish();
rollback;
