-- Lane telegram-ampliacion (1/3): comentario de igualacion de aportaciones.
-- ADITIVA: una funcion de lectura nueva en el esquema `agente`; no toca tablas ni funciones existentes.
--
-- Despues de CUALQUIER aportacion, pago de un socio a un proveedor con dinero propio, reembolso, cobro en cuenta de socio o retiro, el bot comenta en el grupo
-- "<socio> lleva <monto> mas aportado; el siguiente pago le toca a <otro>" o "Aportaciones igualadas". Las cifras salen de la base, jamas de la IA, y NO se
-- duplica la logica de aportacion neta: esta funcion llama a api.socios_aportacion_neta() (la misma definicion que usa api.capital_por_mes; pgTAP a7_001 comprueba que
-- coinciden). Sin lenguaje de deuda: la diferencia no es una deuda ni un reembolso a favor del otro.
--
-- api.socios_aportacion_neta() exige rol socio. Esta funcion la llama con el canal del agente y, como actor de LECTURA, el primer socio activo registrado (es una lectura de cifras
-- comunes a los dos socios; el canal y el actor anteriores se restauran al terminar).

create function agente.igualacion() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_canal text := coalesce(current_setting('rtm.canal', true), ''); v_actor text := coalesce(current_setting('rtm.actor', true), '');
  v_lector text; v_n jsonb; v_mayor text; v_dif bigint; v_turno text; v_igualados boolean;
begin
  perform notificacion.exigir_sistema();
  select m.persona into v_lector from agente.miembro m where m.rol = 'socio' and m.activo order by m.persona limit 1;
  if v_lector is null then raise exception 'no hay socios registrados en el agente' using errcode = 'P0460'; end if;
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_lector, true);
  v_n := api.socios_aportacion_neta();
  perform set_config('rtm.canal', v_canal, true);
  perform set_config('rtm.actor', v_actor, true);
  v_igualados := coalesce((v_n ->> 'igualados')::boolean, false);
  v_turno := v_n ->> 'le_toca_aportar';
  v_dif := coalesce((select max((x ->> 'diferencia_a_igualar_cent')::bigint) from jsonb_array_elements(v_n -> 'socios') x), 0);
  -- El socio con la mayor aportacion neta (el que lleva mas aportado) es el de diferencia cero cuando no estan igualados.
  select x ->> 'socio' into v_mayor from jsonb_array_elements(v_n -> 'socios') x
   where not v_igualados order by (x ->> 'aportacion_neta_cent')::bigint desc, x ->> 'socio' limit 1;
  return jsonb_build_object('igualados', v_igualados, 'le_toca_aportar', v_turno, 'lleva_mas', v_mayor, 'diferencia_cent', v_dif,
    'socios', (select jsonb_agg(jsonb_build_object('socio', x ->> 'socio', 'aportacion_neta_cent', (x ->> 'aportacion_neta_cent')::bigint, 'diferencia_cent', (x ->> 'diferencia_a_igualar_cent')::bigint)
                               order by x ->> 'socio') from jsonb_array_elements(v_n -> 'socios') x),
    'fuente', 'api.socios_aportacion_neta');
end $$;

revoke all on function agente.igualacion() from public, anon, authenticated;
grant execute on function agente.igualacion() to servidor;
