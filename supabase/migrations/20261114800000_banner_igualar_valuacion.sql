-- Banner de IGUALACION DE VALUACION (decision del dueno, 14-nov: "debemos estar igualados de valuacion siempre"). Migracion ADITIVA, solo lecturas:
--  (1) operacion.banner_igualacion(p_cuenta): arma el bloque `banner` a partir de lo que YA calculo operacion.cuenta_socios_valuacion (campo `igualacion`: faltan, mayor/menor, pasos por socio).
--      Agrega solo lo que la valuacion no traia: tolerancia de centavos, antiguedad de los fondos en poder, entregas parciales registradas y avance hacia la entrega. Ninguna regla de dinero nueva.
--  (2) api.cuenta_socios_valuacion devuelve el mismo jsonb de antes MAS la clave `banner` (solo cuando el corte es hoy; con un corte historico es null). Una sola lectura para Inicio, /socios y el agente.
--  (3) agente.valuacion_socios incluye `banner`, para que "mi valuacion", "como estamos" y /valuacion digan la misma frase con las mismas cifras.
-- Los permisos no cambian (create or replace conserva los GRANT de api.cuenta_socios_valuacion y agente.valuacion_socios).
--
-- TOLERANCIA: 1 centavo. Con utilidades 50/50 el reparto de un centavo impar se redondea a favor de quien paga (operacion.cap_mitad), asi que dos socios pueden quedar para siempre
-- a un centavo sin que nadie deba nada. Con faltan_cent <= 1 el banner desaparece (igualados = true); `exacto` dice si la diferencia es exactamente 0.
--
-- IDENTIDAD DE LOS PASOS (para el neteo cuando los dos socios tienen fondos por entregar), con X = faltan_cent:
--   X = entregar(menor) + aportar(menor) - entregar(mayor) - aportar(mayor)
-- `cuadra` lo comprueba. La regla es igualar valuaciones, no cada partida: si el mayor tambien entrega, su valuacion sube y la diferencia se netea.

create or replace function operacion.banner_igualacion(p_cuenta jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tol constant bigint := 1;
  v_ig jsonb := p_cuenta -> 'igualacion';
  v_x bigint; v_mayor text; v_menor text; v_hoy date := negocio.hoy();
  v_por jsonb := '{}'::jsonb; v_n text; v_sid bigint; v_ent bigint; v_apo bigint; v_dias int; v_desde date; v_hist jsonb; v_tot bigint; v_bp int;
  v_ent_mayor bigint := 0; v_apo_mayor bigint := 0; v_ent_menor bigint := 0; v_apo_menor bigint := 0;
begin
  if v_ig is null then return null; end if;
  v_x := (v_ig ->> 'faltan_cent')::bigint;
  v_mayor := v_ig ->> 'mayor'; v_menor := v_ig ->> 'menor';

  foreach v_n in array array['Angelo', 'Javier'] loop
    select id into v_sid from catalogo.socio where nombre = v_n;
    v_ent := coalesce((v_ig -> 'por_socio' -> v_n ->> 'entregar_cent')::bigint, 0);
    v_apo := coalesce((v_ig -> 'por_socio' -> v_n ->> 'aportar_cent')::bigint, 0);
    -- Antiguedad: dias del tramo mas viejo de fondos que aun no se entrega (la misma funcion de /cuentas-por-cobrar y de la cuenta del socio).
    v_dias := case when v_ent > 0 and v_sid is not null then operacion.dias_fondos_en_poder(v_sid) end;
    v_desde := case when v_dias is not null then v_hoy - v_dias end;
    -- Entregas parciales a la sociedad registradas desde esa fecha (sin las anuladas por reversa).
    select coalesce(jsonb_agg(jsonb_build_object('fecha', m.fecha_neg, 'monto_cent', -m.monto_cent) order by m.fecha_neg, m.id), '[]'::jsonb), coalesce(sum(-m.monto_cent), 0)::bigint
      into v_hist, v_tot
      from operacion.cuenta_socio_mov m
     where m.socio_id = v_sid and m.concepto = 'entrega_a_sociedad' and m.aplica_a in ('fondos', 'general') and m.fecha_neg >= v_desde
       and not exists (select 1 from operacion.cuenta_socio_mov r where r.reversa_de = m.id);
    -- Avance: lo entregado desde esa fecha contra lo entregado mas lo que falta entregar (puntos base: 10000 = completo).
    v_bp := case when v_ent > 0 and v_tot > 0 then ((v_tot * 10000) / (v_tot + v_ent))::int end;
    v_por := v_por || jsonb_build_object(v_n, jsonb_build_object('entregar_cent', v_ent, 'aportar_cent', v_apo, 'dias_fondos', v_dias, 'desde', v_desde,
      'entregado_cent', v_tot, 'entrega_total_cent', v_tot + v_ent, 'progreso_bp', v_bp, 'entregas', v_hist));
    if v_n = v_mayor then v_ent_mayor := v_ent; v_apo_mayor := v_apo; end if;
    if v_n = v_menor then v_ent_menor := v_ent; v_apo_menor := v_apo; end if;
  end loop;

  return jsonb_build_object('activo', v_x > v_tol, 'igualados', v_x <= v_tol, 'exacto', v_x = 0, 'tolerancia_cent', v_tol,
    'faltan_cent', v_x, 'mayor', v_mayor, 'menor', v_menor, 'por_socio', v_por,
    'neteo_cent', v_ent_mayor,
    'cuadra', case when v_mayor is null then true else v_ent_menor + v_apo_menor - v_ent_mayor - v_apo_mayor = v_x end,
    'regla', 'La regla es igualar valuaciones, no cada partida. Entregar los fondos que un socio cobró en su cuenta personal sube su valuación; si el otro socio también tiene fondos por entregar, las dos entregas se netean.');
end $$;

revoke execute on function operacion.banner_igualacion(jsonb) from public, anon, authenticated;

create or replace function api.cuenta_socios_valuacion(p_hasta date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_c jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_c := operacion.cuenta_socios_valuacion(p_hasta);
  -- El banner describe el estado de HOY: con un corte historico no aplica.
  return v_c || jsonb_build_object('banner', case when (v_c ->> 'hasta')::date >= (v_c ->> 'hoy')::date then operacion.banner_igualacion(v_c) end);
end $$;

create or replace function agente.valuacion_socios() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_canal text := coalesce(current_setting('rtm.canal', true), ''); v_actor text := coalesce(current_setting('rtm.actor', true), '');
  v_lector text; v_c jsonb;
begin
  perform notificacion.exigir_sistema();
  select m.persona into v_lector from agente.miembro m where m.rol = 'socio' and m.activo order by m.persona limit 1;
  if v_lector is null then raise exception 'no hay socios registrados en el agente' using errcode = 'P0460'; end if;
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_lector, true);
  v_c := api.cuenta_socios_valuacion();
  perform set_config('rtm.canal', v_canal, true);
  perform set_config('rtm.actor', v_actor, true);
  -- Solo lo necesario para redactar la respuesta: valuaciones, diferencia, pasos para igualar y el banner (sin serie, sin proveedores, sin detalle de asientos).
  return jsonb_build_object('hasta', v_c -> 'hasta',
    'socios', (select jsonb_agg(jsonb_build_object('socio', s ->> 'socio', 'valuacion_cent', (s ->> 'valuacion_cent')::bigint, 'fondos_en_poder_cent', (s ->> 'fondos_en_poder_cent')::bigint,
                                                   'capital_aportado_cent', (s ->> 'capital_aportado_cent')::bigint) order by s ->> 'socio') from jsonb_array_elements(v_c -> 'socios') s),
    'igualacion', v_c -> 'igualacion', 'banner', v_c -> 'banner', 'retiros_desiguales', (v_c -> 'comparacion' ->> 'retiros_desiguales')::boolean, 'diferencia_retiros_cent', (v_c -> 'comparacion' ->> 'diferencia_retiros_cent')::bigint,
    'retiro_mas', v_c -> 'comparacion' ->> 'retiro_mas', 'fuente', 'api.cuenta_socios_valuacion');
end $$;
