-- F2 / 0014: el limite de intentos del login pasa de VENTANAS FIJAS a VENTANA DESLIZANTE EXACTA.
--
-- Defecto corregido: seguridad.registrar_intento_login alineaba la ventana al reloj
-- (floor(epoch / ventana) * ventana). Los intentos que cruzaban la frontera (p. ej. un multiplo de 10 minutos con
-- ventana de 600 s) reiniciaban el contador, y un atacante podia obtener hasta 2 veces el tope. Ademas el resultado
-- dependia del reloj de pared.
--
-- Ahora: cada intento es un evento (clave, marca de tiempo) y la funcion devuelve cuantos eventos tiene la clave en los
-- ultimos p_ventana_seg segundos, INCLUYENDO el actual. Mismos nombre, firma, validaciones y privilegios (solo el rol
-- `servidor`; nada para anon ni authenticated). La tabla vieja seguridad.limite_intento queda SIN USO (se conserva sin
-- borrar por si hace falta auditarla; sus contadores son efimeros y no se migran: a lo sumo se reinicia un conteo de
-- minutos, nunca se concede de mas).

create table seguridad.limite_intento_evento (
  id bigint generated always as identity primary key,
  clave text not null check (clave ~ '^[a-z]{2,16}:[0-9A-Za-z]{8,64}$'),
  ts timestamptz not null default clock_timestamp()
);
create index limite_intento_evento_clave_ts on seguridad.limite_intento_evento (clave, ts desc);
create index limite_intento_evento_ts on seguridad.limite_intento_evento (ts);

alter table seguridad.limite_intento_evento enable row level security;
alter table seguridad.limite_intento_evento force row level security;
revoke all on seguridad.limite_intento_evento from public, anon, authenticated;
revoke all on all sequences in schema seguridad from public, anon, authenticated;

comment on table seguridad.limite_intento is 'OBSOLETA desde 0014: ventanas fijas (defecto de diseno). Sin uso; ver seguridad.limite_intento_evento.';
comment on table seguridad.limite_intento_evento is 'Un renglon por intento (clave, ts). La ventana deslizante cuenta los de los ultimos N segundos.';

create or replace function seguridad.registrar_intento_login(p_clave text, p_ventana_seg int default 300) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_ahora timestamptz; v_n int;
begin
  if p_ventana_seg is null or p_ventana_seg < 1 or p_ventana_seg > 86400 then
    raise exception 'ventana invalida' using errcode = '22023';
  end if;
  -- Serializa por clave hasta el fin de la transaccion: dos llamadas simultaneas nunca cuentan la misma foto.
  -- (La clave NULL se rechaza despues por la restriccion NOT NULL de la columna.)
  perform pg_advisory_xact_lock(hashtextextended('rtm.limite_intento:' || coalesce(p_clave, ''), 0));
  v_ahora := clock_timestamp();
  insert into seguridad.limite_intento_evento (clave, ts) values (p_clave, v_ahora);
  select count(*)::int into v_n
    from seguridad.limite_intento_evento e
   where e.clave = p_clave and e.ts > v_ahora - make_interval(secs => p_ventana_seg);
  -- Limpieza oportunista y acotada: los eventos de ESTA clave con mas de un dia (mayor ventana posible), y de vez en
  -- cuando un lote de hasta 500 eventos viejos de cualquier clave.
  delete from seguridad.limite_intento_evento e where e.clave = p_clave and e.ts < v_ahora - interval '1 day';
  if random() < 0.02 then
    delete from seguridad.limite_intento_evento e
     where e.id in (select x.id from seguridad.limite_intento_evento x where x.ts < v_ahora - interval '1 day' order by x.ts limit 500);
  end if;
  return v_n;
end $$;

-- create or replace conserva los privilegios; se reafirman por claridad.
revoke execute on function seguridad.registrar_intento_login(text, int) from public, anon, authenticated;
grant execute on function seguridad.registrar_intento_login(text, int) to servidor;
