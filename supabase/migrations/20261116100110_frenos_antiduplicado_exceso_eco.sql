-- Carril FRENOS, puntos 3, 5 y 8: capa de frenos sobre las puertas de escritura del agente (rename + wrap sobre la ULTIMA definicion vigente; no se copia ninguna version vieja).
--   agente.ejecutar / agente.ejecutar_ext / agente.resolver_toma / agente.sabor_responder pasan a ser envoltorios:
--     1. interruptor agente_escritura (agente._exigir_escritura, falla cerrado con P0463);
--     2. ANTIDUPLICADO por huella de contenido (tipo, monto, contraparte, cuenta, pedido, lineas) en una ventana de 10 minutos, incluido el OTRO socio. No rechaza: devuelve
--        {posible_duplicado: true, folio_previo, hace_min, autor_previo} y TypeScript lo convierte en pregunta. Con p_args.permitir_duplicado = true se registra. Un reintento con la
--        misma clave de idempotencia nunca es duplicado. Un hecho deshecho deja de contar.
--     3. GUARDA DE SOBREPAGO del cobro (misma regla que P0429 de la web, sin su tope absoluto: el bot no tiene topes): si el cobro es mayor que lo que debe el cliente devuelve
--        {pregunta_exceso: true, monto_cent, debe_cent, cliente}; con p_args.confirmo_exceso = true se registra (el resto queda a favor del cliente).
--     4. ECO RICO: el resultado lleva `eco_rico` con cliente, cuenta, pedidos aplicados y saldos antes y despues (cifras de SQL, nunca del modelo).
-- Los ayudantes `_*` no se conceden a ningun rol de aplicacion.

create table if not exists agente.huella (
  id bigint generated always as identity primary key,
  huella text not null,
  tipo text not null,
  autor text not null,
  clave_idem text not null unique,
  folio text,
  resumen jsonb not null default '{}'::jsonb,
  creada_at timestamptz not null default clock_timestamp(),
  anulada_at timestamptz
);
create index if not exists huella_contenido_idx on agente.huella (huella, creada_at desc);
create index if not exists huella_folio_idx on agente.huella (folio);
alter table agente.huella enable row level security;
alter table agente.huella force row level security;
revoke all on agente.huella from public, anon, authenticated;

create or replace function agente._ventana_minutos() returns int language sql immutable set search_path = '' as $$ select 10 $$;

-- Huella de contenido: null si el tipo no es un movimiento que deba protegerse de la doble captura.
create or replace function agente._huella(p_tipo text, p_args jsonb) returns text
language plpgsql immutable set search_path = ''
as $$
declare v_obj jsonb; v_lineas jsonb;
begin
  if p_tipo not in ('gasto', 'aportacion', 'pago_a_socio', 'pago_cliente', 'pago_proveedor', 'pedido_crear', 'compra_crear', 'orden_compra', 'gasto_servicio', 'merma', 'pedido_menudeo', 'pago_pedido_menudeo') then
    return null;
  end if;
  if jsonb_typeof(p_args -> 'lineas') = 'array' then
    select coalesce(jsonb_agg(jsonb_build_array(l -> 'modelo_id', l -> 'sabor_id', l -> 'piezas') order by l ->> 'modelo_id', l ->> 'sabor_id', l ->> 'piezas'), '[]'::jsonb)
      into v_lineas from jsonb_array_elements(p_args -> 'lineas') l;
  end if;
  v_obj := jsonb_strip_nulls(jsonb_build_object('t', p_tipo,
    'm', coalesce(p_args ->> 'monto_cent', p_args ->> 'monto_usd_cent', p_args ->> 'monto_mxn_cent'),
    'cl', p_args ->> 'cliente_id', 'pv', lower(p_args ->> 'proveedor'), 'so', lower(p_args ->> 'socio'), 'pp', lower(p_args ->> 'pagado_por'),
    'cu', lower(p_args ->> 'cuenta'), 'vi', lower(p_args ->> 'via'), 'ti', lower(p_args ->> 'tipo'), 'ca', lower(p_args ->> 'categoria'),
    'pe', p_args ->> 'pedido_folio', 'sv', lower(p_args ->> 'servicio'), 'dc', p_args ->> 'declara_capital', 'in', lower(p_args ->> 'intencion'), 'mt', lower(p_args ->> 'motivo'), 'fc', p_args ->> 'fecha_compromiso', 'rf', lower(p_args ->> 'referencia'), 'mo', p_args ->> 'modelo_id', 'sa', p_args ->> 'sabor_id', 'pz', p_args ->> 'piezas', 'ln', v_lineas));
  return encode(extensions.digest(v_obj::text, 'sha256'), 'hex');
end $$;

-- Antes de escribir: interruptor, duplicado y sobrepago. Devuelve null (seguir) o el jsonb que corta la escritura.
create or replace function agente._frenos_antes(p_clave text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_h text; v_prev agente.huella; v_aplicable bigint; v_monto bigint; v_cliente bigint; v_hecha boolean;
begin
  perform agente._exigir_escritura();
  v_hecha := exists (select 1 from seguridad.operacion o where o.clave = p_clave and o.resultado is not null);
  if v_hecha then return null; end if;
  v_h := agente._huella(p_tipo, p_args);
  if v_h is not null and not coalesce((p_args ->> 'permitir_duplicado')::boolean, false) and not exists (select 1 from agente.huella x where x.clave_idem = p_clave) then
    select * into v_prev from agente.huella x
      where x.huella = v_h and x.anulada_at is null and x.creada_at > clock_timestamp() - make_interval(mins => agente._ventana_minutos()) order by x.id desc limit 1;
    if found then
      insert into agente.evento (tipo, miembro, detalle) values ('duplicado_bloqueado', nullif(p_args ->> 'telegram_user_id', '')::bigint, left(p_tipo || ' igual a ' || coalesce(v_prev.folio, '?'), 300));
      return jsonb_build_object('posible_duplicado', true, 'folio_previo', v_prev.folio, 'autor_previo', v_prev.autor, 'tipo', p_tipo,
        'hace_min', greatest(0, floor(extract(epoch from clock_timestamp() - v_prev.creada_at) / 60))::int, 'resumen', v_prev.resumen);
    end if;
  end if;
  if (p_tipo = 'pago_cliente' or (p_tipo = 'pago_proveedor' and nullif(p_args ->> 'cliente_id', '') is not null)) and not coalesce((p_args ->> 'confirmo_exceso')::boolean, false) then
    v_monto := (p_args ->> 'monto_cent')::bigint;
    v_cliente := nullif(p_args ->> 'cliente_id', '')::bigint;
    if v_cliente is not null and v_monto > 0 then
      select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0)::bigint into v_aplicable from operacion.pedido pe where pe.cliente_id = v_cliente and pe.estado = 'enviado';
      if v_monto > v_aplicable then
        return jsonb_build_object('pregunta_exceso', true, 'monto_cent', v_monto, 'debe_cent', v_aplicable, 'cliente', (select nombre_canonico from catalogo.cliente where id = v_cliente));
      end if;
    end if;
  end if;
  return null;
end $$;

create or replace function agente._frenos_instantanea(p_tipo text, p_args jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_c bigint := nullif(p_args ->> 'cliente_id', '')::bigint;
begin
  return jsonb_build_object('saldo_cliente_cent', case when v_c is null then null else operacion.saldo_cliente(v_c) end);
end $$;

-- Despues de escribir: registra la huella y arma el eco con cifras de la base.
create or replace function agente._frenos_despues(p_clave text, p_tipo text, p_args jsonb, p_res jsonb, p_antes jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c bigint := nullif(p_args ->> 'cliente_id', '')::bigint; v_eco jsonb; v_h text; v_pedidos jsonb; v_cli text;
begin
  if coalesce((p_res ->> 'repetido')::boolean, false) then return p_res; end if;
  if v_c is not null then
    select nombre_canonico into v_cli from catalogo.cliente where id = v_c;
    if p_res ? 'pago_id' then
      select coalesce(jsonb_agg(jsonb_build_object('folio', pe.folio, 'monto_cent', a.monto_cent) order by a.id), '[]'::jsonb) into v_pedidos
        from operacion.pago_aplicacion a join operacion.pedido pe on pe.id = a.pedido_id where a.pago_id = (p_res ->> 'pago_id')::bigint and a.reversa_de is null;
    end if;
  end if;
  v_eco := jsonb_strip_nulls(jsonb_build_object('tipo', p_tipo, 'cliente', v_cli, 'cuenta', coalesce(p_res ->> 'destino', initcap(p_args ->> 'cuenta')),
    'proveedor', initcap(p_args ->> 'proveedor'), 'socio', initcap(coalesce(p_args ->> 'socio', p_args ->> 'pagado_por')), 'via', p_args ->> 'via', 'categoria', p_args ->> 'categoria',
    'monto_cent', coalesce((p_res ->> 'monto_cent')::bigint, nullif(p_args ->> 'monto_cent', '')::bigint),
    'pedidos_aplicados', v_pedidos, 'aplicado_cent', (p_res ->> 'aplicado_cent')::bigint,
    'saldo_antes_cent', (p_antes ->> 'saldo_cliente_cent')::bigint,
    'saldo_despues_cent', case when v_c is null then null else operacion.saldo_cliente(v_c) end,
    'a_favor_cent', (p_res ->> 'saldo_favor_cliente_cent')::bigint));
  v_h := agente._huella(p_tipo, p_args);
  if v_h is not null then
    insert into agente.huella (huella, tipo, autor, clave_idem, folio, resumen)
      values (v_h, p_tipo, lower(coalesce(p_args ->> 'autor', '')), p_clave, p_res ->> 'folio', v_eco) on conflict (clave_idem) do nothing;
  end if;
  delete from agente.huella where creada_at < now() - interval '2 days';
  return p_res || jsonb_build_object('eco_rico', v_eco);
end $$;

-- ---- envoltorios
alter function agente.ejecutar(text, text, jsonb) rename to _ejecutar_previo;
alter function agente.ejecutar_ext(text, text, jsonb) rename to _ejecutar_ext_previo;
alter function agente.resolver_toma(text, text, text, text, bigint) rename to _resolver_toma_previo;
alter function agente.sabor_responder(text, jsonb) rename to _sabor_responder_previo;
revoke all on function agente._ejecutar_previo(text, text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente._ejecutar_ext_previo(text, text, jsonb) from public, anon, authenticated, servidor;
revoke all on function agente._resolver_toma_previo(text, text, text, text, bigint) from public, anon, authenticated, servidor;
revoke all on function agente._sabor_responder_previo(text, jsonb) from public, anon, authenticated, servidor;

create function agente.ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_corte jsonb; v_antes jsonb; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_corte := agente._frenos_antes(p_clave_idem, p_tipo, p_args);
  if v_corte is not null then return v_corte; end if;
  v_antes := agente._frenos_instantanea(p_tipo, p_args);
  v_res := agente._ejecutar_previo(p_clave_idem, p_tipo, p_args);
  return agente._frenos_despues(p_clave_idem, p_tipo, p_args, v_res, v_antes);
end $$;

create function agente.ejecutar_ext(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_corte jsonb; v_antes jsonb; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  v_corte := agente._frenos_antes(p_clave_idem, p_tipo, p_args);
  if v_corte is not null then return v_corte; end if;
  v_antes := agente._frenos_instantanea(p_tipo, p_args);
  v_res := agente._ejecutar_ext_previo(p_clave_idem, p_tipo, p_args);
  return agente._frenos_despues(p_clave_idem, p_tipo, p_args, v_res, v_antes);
end $$;

create function agente.resolver_toma(p_clave_idem text, p_toma_folio text, p_accion text, p_autor text, p_telegram_user_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  perform agente._exigir_escritura();
  return agente._resolver_toma_previo(p_clave_idem, p_toma_folio, p_accion, p_autor, p_telegram_user_id);
end $$;

create function agente.sabor_responder(p_clave_idem text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  perform agente._exigir_escritura();
  return agente._sabor_responder_previo(p_clave_idem, p_args);
end $$;

revoke all on function agente._huella(text, jsonb) from public, anon, authenticated;
revoke all on function agente._frenos_antes(text, text, jsonb) from public, anon, authenticated;
revoke all on function agente._frenos_instantanea(text, jsonb) from public, anon, authenticated;
revoke all on function agente._frenos_despues(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function agente._ventana_minutos() from public, anon, authenticated;
revoke all on function agente.ejecutar(text, text, jsonb) from public, anon, authenticated;
revoke all on function agente.ejecutar_ext(text, text, jsonb) from public, anon, authenticated;
revoke all on function agente.resolver_toma(text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function agente.sabor_responder(text, jsonb) from public, anon, authenticated;
grant execute on function agente.ejecutar(text, text, jsonb) to servidor;
grant execute on function agente.ejecutar_ext(text, text, jsonb) to servidor;
grant execute on function agente.resolver_toma(text, text, text, text, bigint) to servidor;
grant execute on function agente.sabor_responder(text, jsonb) to servidor;
