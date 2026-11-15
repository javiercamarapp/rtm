-- pgTAP cierre de BAJO (19-nov): la propuesta de retiro de capital caduca a los 10 minutos como las demas preguntas de dinero.
-- Dentro de la ventana el otro socio la confirma; pasada, su mensaje ya no confirma y el retiro debe proponerlo de nuevo quien lo retira. Datos sinteticos.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
select agente.registrar_miembro(7100001, 'angelo');
select agente.registrar_miembro(7100002, 'javier');
select agente.registrar_chat('grupo_socios', -7100001);
select agente.fijar_escritura(true, 'angelo', 7100001, 'prueba');
create function pg_temp.ang(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'angelo', 'telegram_user_id', 7100001, 'origen', 'x') || $1 $$;
create function pg_temp.jav(extra jsonb default '{}') returns jsonb language sql as $$ select jsonb_build_object('autor', 'javier', 'telegram_user_id', 7100002, 'origen', 'x') || $1 $$;
select agente.ejecutar('bh:cap', 'aportacion', pg_temp.jav('{"socio":"javier","monto_cent":2000000,"intencion":"capital"}'));

-- A. dentro de la ventana: lo confirma el otro socio
select is((agente.ejecutar_ext('bh:p1', 'retiro_capital', pg_temp.jav('{"socio":"javier","monto_cent":500000}')) ->> 'modo'), 'propuesto', 'Javier propone');
select is((agente.ejecutar_ext('bh:c1', 'retiro_capital', pg_temp.ang('{"socio":"javier","monto_cent":500000}')) ->> 'modo'), 'confirmado', 'dentro de 10 minutos Angelo confirma');

-- B. propuesta vieja: el evento se envejece 11 minutos (las pruebas corren con privilegios de propietario)
select is((agente.ejecutar_ext('bh:p2', 'retiro_capital', pg_temp.jav('{"socio":"javier","monto_cent":300000}')) ->> 'modo'), 'propuesto', 'Javier propone otro retiro');
set local session_replication_role = replica;
update operacion.evento set hora = hora - interval '11 minutes'
 where id = (select r.evento_id from operacion.retiro_capital r where r.monto_cent = 300000 order by r.id desc limit 1);
set local session_replication_role = origin;
select throws_ok($$ select agente.ejecutar_ext('bh:c2', 'retiro_capital', pg_temp.ang('{"socio":"javier","monto_cent":300000}')) $$, 'P0460', null, 'pasados 10 minutos, el mensaje del otro socio ya no confirma (debe proponerlo quien retira)');
select is((select count(*)::int from operacion.retiro_capital_confirmacion c join operacion.retiro_capital r on r.id = c.retiro_id where r.monto_cent = 300000), 0, 'la propuesta vencida quedo sin confirmar');
select is((agente.ejecutar_ext('bh:p3', 'retiro_capital', pg_temp.jav('{"socio":"javier","monto_cent":310000}')) ->> 'modo'), 'propuesto', 'quien retira propone de nuevo (monto distinto: el antiduplicado de la huella vencida sigue vigente 10 min)');
select is((agente.ejecutar_ext('bh:c3', 'retiro_capital', pg_temp.ang('{"socio":"javier","monto_cent":310000}')) ->> 'modo'), 'confirmado', 'y el otro socio la confirma a tiempo');
select * from finish();
rollback;
