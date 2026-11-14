-- Panel "Explicar este numero" premium: la base entrega ademas (todo ADITIVO y opcional) el corte de la lectura, la diferencia entre las dos vias,
-- el historial mensual y las cuentas del libro de las cifras de saldo contable. Envuelve api.explicar_cifra (rename + wrap): la funcion anterior sigue
-- resolviendo la cifra y exigiendo el rol; aqui no se calcula ninguna cifra nueva fuera de SQL ni se abre nada a otro rol.
alter function api.explicar_cifra(text) rename to explicar_cifra_antes_ficha;
revoke execute on function api.explicar_cifra_antes_ficha(text) from public, anon, authenticated;

create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); r jsonb; v1 numeric; v2 numeric; v_hasta date; v_ini date; v_fin date; v_hist jsonb; v_c contabilidad.cuenta; i int;
begin
  r := api.explicar_cifra_antes_ficha(p_cifra);  -- el rol y la existencia de la cifra los valida la funcion anterior
  r := r || jsonb_build_object('corte', jsonb_build_object('fecha', negocio.hoy(), 'hora', now()));
  if jsonb_typeof(r->'comprobacion') = 'object' and r->'comprobacion'->>'via1_valor' is not null and r->'comprobacion'->>'via2_valor' is not null then
    v1 := (r->'comprobacion'->>'via1_valor')::numeric; v2 := (r->'comprobacion'->>'via2_valor')::numeric;
    r := jsonb_set(r, '{comprobacion,diferencia}', to_jsonb(v1 - v2));
  end if;
  if partes[1] = 'conta' and partes[2] = 'saldo' then
    select * into v_c from contabilidad.cuenta where codigo = partes[3];
    if found then
      v_hasta := coalesce(partes[4]::date, negocio.hoy());
      -- Saldo al cierre de cada uno de los ultimos 12 meses (el mes en curso termina en la fecha de corte); solo si alguna vez hubo saldo.
      v_hist := '[]'::jsonb;
      for i in reverse 11..0 loop
        v_ini := (date_trunc('month', v_hasta) - make_interval(months => i))::date;
        v_fin := least((v_ini + interval '1 month - 1 day')::date, v_hasta);
        v_hist := v_hist || jsonb_build_array(jsonb_build_object('periodo', to_char(v_ini, 'YYYY-MM'), 'fecha', v_fin, 'valor_cent', contabilidad.saldo(partes[3], v_fin)));
      end loop;
      if exists (select 1 from jsonb_array_elements(v_hist) h where (h->>'valor_cent')::bigint <> 0) then r := r || jsonb_build_object('historial', v_hist); end if;
      r := r || jsonb_build_object('cuentas', jsonb_build_array(jsonb_build_object('codigo', v_c.codigo, 'nombre', v_c.nombre, 'tipo', v_c.tipo, 'naturaleza', v_c.naturaleza, 'saldo_cent', contabilidad.saldo(partes[3], v_hasta))));
    end if;
  end if;
  return r;
end $$;
revoke execute on function api.explicar_cifra(text) from public, anon;
grant execute on function api.explicar_cifra(text) to authenticated;
