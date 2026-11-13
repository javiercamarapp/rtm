-- pgTAP (ronda de verificacion independiente de la rama integra/cuadre-puente):
--  (A) Firmar un acta de corte CON REINVERSION debe asentar bien. El descuadre de ese asiento solo salta en el COMMIT (trigger de restriccion diferido), y pgTAP corre en una sola
--      transaccion: por eso la prueba fuerza el trigger con `set constraints all immediate` justo despues de firmar. Sin la migracion 20261113300200 (when 'reinversion' then 3310) falla
--      con "el evento ... (cierre_reparto_firmado) no cuadra: debe X contra haber Y".
--      NOTA DE INTEGRACION: la rama lane/historial-acta corrige lo mismo (20261113200100_conta_reinversion_acta.sql, envoltura de lineas_de_evento). Al integrar hay que dejar UNA sola
--      redefinicion; esta prueba sirve para las dos.
--  (B) La senal "Libro conciliado" exige tambien C16 (utilidad comercial contra utilidad del libro) y C22 (gastos): inducidas en rojo, la senal pasa a 'revisar'.
--  (C) (la antigua asercion "PENDIENTE DEL DUENO" sobre la caja negativa se retiro: el dueno decidio bloquear el pago sin saldo; ver a4_008_pago_sociedad_exige_saldo.)
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a4r.ang@example.test', 'socio', 'Angelo', true), ('a4r.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('77777777-7777-7777-7777-7777777777f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4r.ang@example.test'),
  ('77777777-7777-7777-7777-7777777777f2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a4r.jav@example.test');
create function pg_temp.como(p text) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', case $1 when 'Angelo' then '77777777-7777-7777-7777-7777777777f1' else '77777777-7777-7777-7777-7777777777f2' end, true) $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.ult() returns bigint language sql as $$ select id from operacion.cierre_reparto order by id desc limit 1 $$;
create function pg_temp.ids_rojas() returns text language plpgsql as $$
declare r text;
begin
  perform contabilidad.asentar_pendientes();
  select coalesce(string_agg(x->>'id', ',' order by x->>'id'), '') into r from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean;
  return r;
end $$;

select pg_temp.como('Angelo');
select catalogo.asegurar_modelo('A4R Marca', 'A4R Modelo', 25000, 'ambas');
select catalogo.asegurar_sku('A4R Modelo', 'Uva');
select catalogo.fijar_costo('a4r-c', 'Isaac', 'A4R Modelo', 10000, '2020-01-01', 'prueba');
select catalogo.asegurar_cliente('A4R Cliente', 'Javier');
select catalogo.fijar_precio('a4r-p', 'A4R Cliente', 'A4R Modelo', 20000, '2020-01-01', 'chat');

-- Base vacia de ventas y gastos: C16 y C22 dan 0 = 0, asi que exigirlas no pone la senal en rojo (sin rojo falso).
select is(pg_temp.ids_rojas(), '', 'base sin ventas ni gastos: conciliado aunque la senal exija C16 y C22');
select is((select count(*)::int from contabilidad.comprobaciones() k where k.codigo in ('C16', 'C22') and k.ok), 2, 'C16 y C22 existen y estan en verde en base vacia (0 = 0)');

-- Un pedido enviado y cobrado para que el acta tenga utilidad que repartir.
select operacion.crear_pedido('a4r-pe', pg_temp.cid('A4R Cliente'), '[{"modelo":"A4R Modelo","sabor":"Uva","piezas":30}]'::jsonb, 'isaac_directo', null, 120000, 0, 0, negocio.hoy() - 5);
select operacion.confirmar_pedido('a4r-pec', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a4r-pe'));
select operacion.enviar_pedido('a4r-pes', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a4r-pe'), null, '{"paqueteria":"Castores","numero":"A4R-G1","costo_cent":0}'::jsonb, negocio.hoy() - 5, true);
select operacion.registrar_pago('a4r-pg', 'Angelo', 600000, pg_temp.cid('A4R Cliente'), null, true, 'abono', negocio.hoy() - 4);
select is(pg_temp.ids_rojas(), '', 'con pedido cobrado: conciliado (C16 y C22 en verde con datos reales)');

-- (A) Acta con reinversion: la firma debe asentar bien y el trigger diferido, forzado, no debe fallar.
select operacion.proponer_cierre_reparto('a4r-a1', negocio.hoy() - 6, negocio.hoy() - 1, '{"Angelo":{"retira":0,"reinvierte":100000},"Javier":{"retira":0,"reinvierte":0}}');
select operacion.firmar_cierre_reparto('a4r-a2', pg_temp.ult());
select pg_temp.como('Javier');
select lives_ok($$select operacion.firmar_cierre_reparto('a4r-a3', pg_temp.ult())$$, 'firmar el acta con reinversion no falla');
select lives_ok($$set constraints all immediate$$, 'el asiento del acta con reinversion cuadra al forzar el trigger diferido (lo que ocurre en el COMMIT)');
select is((select count(*)::int from operacion.cierre_reparto_firma where cierre_id = pg_temp.ult()), 2, 'el acta quedo con las dos firmas');
select ok((select count(*) from operacion.socio_libro where concepto = 'reinversion') > 0, 'el libro del socio trae el renglon de reinversion');
select is((select sum(l.debe_cent)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id where e.tipo = 'cierre_reparto_firmado'),
          (select sum(l.haber_cent)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id where e.tipo = 'cierre_reparto_firmado'), 'el asiento de la firma: debe = haber');
select is((select coalesce(sum(l.debe_cent), 0)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id
            where e.tipo = 'cierre_reparto_firmado' and l.cuenta = '3110'), 0::bigint, 'el capital se acredita (haber), no se debita');
select is((select coalesce(sum(l.haber_cent), 0)::bigint from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id
            where e.tipo = 'cierre_reparto_firmado' and l.cuenta = '3110'), 100000::bigint, 'la reinversion acredita capital 3110 de Angelo por 1,000.00 (contrapartida: baja de utilidades por distribuir 3310)');
select is(pg_temp.ids_rojas(), '', 'tras la reinversion el libro sigue conciliado y la senal es verdadera');

-- (B) C16 y C22 en rojo => 'revisar'.
select pg_temp.como('Angelo');
select operacion.registrar_gasto_socio('a4r-g1', 'Angelo', 5000, 'otros', 'variable', negocio.hoy() - 3);
select is(pg_temp.ids_rojas(), '', 'con un gasto asentado: conciliado');
set local session_replication_role = replica;
update operacion.gasto set monto_cent = monto_cent + 11 where id = (select min(id) from operacion.gasto);
select is((select ok from contabilidad.comprobaciones() where codigo = 'C22'), false, 'un gasto alterado fuera del libro pone C22 en rojo');
select is((select bloqueante from contabilidad.comprobaciones() where codigo = 'C22'), false, 'y C22 no es bloqueante (antes no movia la senal)');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false, 'la senal ya no dice conciliado con C22 en rojo');
select is(operacion.cuadre_socios()->>'estado', 'revisar', 'estado revisar por C22');
select ok((select bool_or(x->>'id' = 'ii-c22' and not (x->>'ok')::boolean) from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x), 'y el renglon de la causa es la comprobacion C22');
select is((operacion.cuadre_socios()->>'fallas')::int, (select count(*)::int from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x where not (x->>'ok')::boolean and x->>'id' <> 'ii-bloqueantes'),
          'fallas = identidades distintas en rojo, sin contar el resumen de bloqueantes');
select isnt(operacion.cuadre_socios()->>'fallas_nota', null, 'y explica que cuenta identidades, no causas');
update operacion.gasto set monto_cent = monto_cent - 11 where id = (select min(id) from operacion.gasto);
update operacion.pedido_surtido set costo_valor_cent = costo_valor_cent + 7 where id = (select min(id) from operacion.pedido_surtido);
select is((select ok from contabilidad.comprobaciones() where codigo = 'C16'), false, 'un costo de pedido alterado fuera del libro pone C16 en rojo');
select is((select bloqueante from contabilidad.comprobaciones() where codigo = 'C16'), false, 'y C16 no es bloqueante (antes no movia la senal)');
select is((operacion.cuadre_socios()->>'libro_conciliado')::boolean, false, 'la senal ya no dice conciliado con C16 en rojo');
select is(operacion.cuadre_socios()->>'estado', 'revisar', 'estado revisar por C16');
select ok((select bool_or(x->>'id' = 'ii-c16' and not (x->>'ok')::boolean) from jsonb_array_elements(operacion.cuadre_socios()->'verificaciones') x), 'y el renglon de la causa es la comprobacion C16');
update operacion.pedido_surtido set costo_valor_cent = costo_valor_cent - 7 where id = (select min(id) from operacion.pedido_surtido);
set local session_replication_role = origin;
select is(pg_temp.ids_rojas(), '', 'deshechas las inducciones, conciliado');

select * from finish();
rollback;
