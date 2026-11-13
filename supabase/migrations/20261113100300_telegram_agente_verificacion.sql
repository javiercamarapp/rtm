-- Lane telegram-agente (verificacion independiente sobre e942121): la tarjeta dice lo que la base REALMENTE registra, el lote historico tiene su candado
-- del segundo socio tambien en SQL, el capital lo declara cada socio por si mismo y resolver_toma verifica al socio.
-- ADITIVA: solo funciones del esquema `agente`; no toca tablas ni funciones de negocio (operacion.pago_proveedor_de_socio queda como esta: ver ORDEN DE INTEGRACION).
--
-- ORDEN DE INTEGRACION: lane/cuadrar-cuentas (migracion 20261113300000: reembolso por omision y p_declara_capital) va ANTES que esta rama. Mientras la base sea la de main,
--   operacion.pago_proveedor_de_socio registra como CAPITAL lo que el socio pone de su dinero. Por eso la vista previa y el resultado traen `clasificaciones` (lo que dejaron las filas de
--   operacion.aportacion_socio) y el agente nunca imprime una clasificacion de plantilla; si la base fuera a registrar capital sin que el socio lo declarara, el agente no lo registra.
-- MEDIO-B: agente.simular ahora pasa por el mismo camino que la ejecucion para `declara_capital` (antes la vista previa lo ignoraba y la ejecucion daba P0461).
-- BAJO-3: agente.ejecutar_ext('lote_historico') exige el boton "Si, estoy seguro" consumido por el OTRO socio.
-- BAJO-4: un socio NO registra capital a nombre del otro (decision de diseno: el capital lo declara cada quien por si mismo).
-- MEDIO-E: agente.resolver_toma recibe y verifica al socio que pulsa.
-- BAJO-6: el gasto vuelve a guardar el origen tal cual (la funcion de negocio ya antepone 'telegram:<socio>:'); antes quedaba 'telegram:javier: telegram:javier: ...'.

-- ------------------------------------------------------------------ lo que dejo la base
create function agente._clasificaciones(p_clave text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('clasificacion', a.clasificacion, 'monto_cent', a.monto_cent, 'socio', s.nombre) order by a.id), '[]'::jsonb)
    from operacion.aportacion_socio a
    join operacion.evento e on e.id = a.evento_id
    join catalogo.socio s on s.id = a.socio_id
   where e.clave_idem = p_clave or starts_with(e.clave_idem, p_clave || ':')
$$;

-- BAJO-4: el capital lo declara cada socio por si mismo (quien lo pone o paga es quien lo registra).
create function agente._exigir_capital_propio(p_tipo text, p_args jsonb, p_autor text) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_tipo = 'aportacion' and lower(coalesce(p_args ->> 'intencion', p_args ->> 'clasificacion', '')) = 'capital' and lower(coalesce(p_args ->> 'socio', '')) <> p_autor then
    raise exception 'el capital lo declara cada socio por si mismo: que lo registre quien lo pone' using errcode = 'P0460';
  end if;
  if p_tipo = 'pago_proveedor' and coalesce((p_args ->> 'declara_capital')::boolean, false) and lower(coalesce(p_args ->> 'pagado_por', '')) <> p_autor then
    raise exception 'el capital lo declara cada socio por si mismo: que lo registre quien pago' using errcode = 'P0460';
  end if;
  if p_tipo = 'lote_historico' and jsonb_typeof(p_args -> 'renglones') = 'array' and exists (
       select 1 from jsonb_array_elements(p_args -> 'renglones') r
        where r ->> 'tipo' = 'aportacion' and lower(coalesce(r ->> 'intencion', '')) = 'capital' and lower(coalesce(r ->> 'socio', '')) <> p_autor) then
    raise exception 'el capital lo declara cada socio por si mismo: un renglon de capital es de quien lo registra' using errcode = 'P0460';
  end if;
end $$;

-- Pago de un socio a un proveedor declarando capital: lo usan la ejecucion Y la vista previa (misma regla, mismo rechazo).
create function agente._pago_proveedor_declarado(p_clave_idem text, p_args jsonb, p_autor text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_existia boolean; v_prov text; v_res jsonb; v_folio text;
begin
  if nullif(p_args ->> 'cliente_id', '') is not null or lower(coalesce(p_args ->> 'pagado_por', '')) not in ('angelo', 'javier') then
    raise exception 'declarar capital solo aplica cuando un socio paga al proveedor con su dinero' using errcode = 'P0460';
  end if;
  perform agente._exigir_capital_propio('pago_proveedor', p_args, p_autor);
  if to_regprocedure('operacion.pago_proveedor_de_socio(text,text,bigint,text,text,date,text,text,boolean)') is null then
    raise exception 'declarar ese pago como capital depende de la integracion de cuadrar cuentas: registralo como reembolso o hazlo en el software' using errcode = 'P0461';
  end if;
  perform set_config('rtm.canal', 'telegram', true);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
  v_prov := initcap(p_args ->> 'proveedor');
  if v_prov not in ('Isaac', 'Karen') then raise exception 'proveedor desconocido' using errcode = 'P0460'; end if;
  execute 'select operacion.pago_proveedor_de_socio($1, $2, $3, $4, $5, $6, $7, $8, true)'
    into v_res using p_clave_idem, v_prov, (p_args ->> 'monto_cent')::bigint, initcap(p_args ->> 'pagado_por'), 'auto', null::date, p_args ->> 'nota', agente._origen(p_args);
  v_folio := agente._guardar_hecho(p_clave_idem, 'pago_proveedor', null, null, p_autor);
  return v_res || jsonb_build_object('folio', v_folio, 'repetido', v_existia);
end $$;

-- ------------------------------------------------------------------ puertas
create or replace function agente.ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_res jsonb;
begin
  perform notificacion.exigir_sistema();
  -- La toma de Omar la pide Omar (sin autor socio); las demas indicaciones de dinero las pide un socio verificado.
  if p_tipo not in ('toma_omar', 'devolucion', 'paquete_perdido') then
    v_autor := agente._autor(p_args);
    perform agente._exigir_capital_propio(p_tipo, p_args, v_autor);
  end if;
  -- Pago a proveedor con dinero propio de un socio: capital SOLO si el socio lo declaro expresamente (decision del dueno, 13-nov).
  if p_tipo = 'pago_proveedor' and coalesce((p_args ->> 'declara_capital')::boolean, false) then
    v_res := agente._pago_proveedor_declarado(p_clave_idem, p_args, v_autor);
  else
    v_res := agente._ejecutar_base(p_clave_idem, p_tipo, p_args);
  end if;
  -- Lo que dejo la base (nunca una plantilla): la tarjeta de resultado lo lee de aqui.
  if p_tipo in ('pago_proveedor', 'aportacion') then v_res := v_res || jsonb_build_object('clasificaciones', agente._clasificaciones(p_clave_idem)); end if;
  return v_res;
end $$;

create or replace function agente.ejecutar_ext(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_autor text; v_res jsonb; v_hash text;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._autor(p_args);
  perform agente._exigir_capital_propio(p_tipo, p_args, v_autor);
  if p_tipo = 'acta_firma' then
    -- La firma es personal: exige un boton "Si, estoy seguro" consumido por ESE socio, de ESTA indicacion (misma clave), y no basta el JSON.
    if not exists (select 1 from agente.tg_token t
        where t.token = p_args ->> 'token_boton' and t.accion = 'confirmar_refuerzo' and t.usado_at is not null
          and t.usado_por = (p_args ->> 'telegram_user_id')::bigint and t.payload ->> 'claveIdem' = p_clave_idem) then
      raise exception 'la firma del acta es personal: falta tu confirmacion con el boton, dada desde tu propio Telegram' using errcode = '42501';
    end if;
  elsif p_tipo = 'lote_historico' then
    -- BAJO-3: el lote historico reescribe historia en bloque: ademas del autor, el OTRO socio da el segundo paso (boton de esta misma indicacion).
    if not exists (select 1 from agente.tg_token t join agente.miembro m on m.telegram_user_id = t.usado_por
        where t.token = p_args ->> 'token_boton' and t.accion = 'confirmar_refuerzo' and t.usado_at is not null and t.payload ->> 'claveIdem' = p_clave_idem
          and m.rol = 'socio' and m.activo and m.persona <> v_autor) then
      raise exception 'el lote historico lo confirma ademas el otro socio, desde su propio Telegram' using errcode = '42501';
    end if;
  end if;
  v_res := agente._ejecutar_ext_base(p_clave_idem, p_tipo, p_args);
  if p_tipo = 'lote_historico' then v_res := v_res || jsonb_build_object('clasificaciones', agente._clasificaciones(p_clave_idem)); end if;
  -- El socio confirmo UN efecto (el de la vista previa). Si el real cambio entre simular y ejecutar, se aborta todo.
  if nullif(p_args ->> 'efecto_hash', '') is not null and not coalesce((v_res ->> 'repetido')::boolean, false) then
    v_hash := agente._hash_efecto(agente._efecto(p_tipo, v_res));
    if v_hash <> p_args ->> 'efecto_hash' then
      raise exception 'el efecto cambio desde la vista previa (precio, tipo de cambio o existencia): revisa el nuevo resumen y confirma otra vez' using errcode = 'P0462';
    end if;
  end if;
  return v_res;
end $$;

create or replace function agente.simular(p_hub text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_efecto jsonb := '{}'::jsonb; v_rojas jsonb; v_txt text; v_autor text; v_clave text := 'sim:' || clock_timestamp()::text || ':' || p_tipo;
begin
  perform notificacion.exigir_sistema();
  v_autor := agente._actuar(p_args);
  perform agente._exigir_capital_propio(p_tipo, p_args, v_autor);
  begin
    -- Funciones base (sin candado de firma ni hash): la simulacion nunca firma y se revierte siempre. La declaracion de capital usa el MISMO camino que la ejecucion.
    if p_hub = 'ejecutar_ext' then v_res := agente._ejecutar_ext_base(v_clave, p_tipo, p_args);
    elsif p_hub = 'ejecutar' and p_tipo = 'pago_proveedor' and coalesce((p_args ->> 'declara_capital')::boolean, false) then v_res := agente._pago_proveedor_declarado(v_clave, p_args, v_autor);
    elsif p_hub = 'ejecutar' then v_res := agente._ejecutar_base(v_clave, p_tipo, p_args);
    else raise exception 'hub desconocido' using errcode = 'P0460'; end if;
    v_efecto := agente._efecto(p_tipo, v_res);
    perform contabilidad.asentar_pendientes();
    select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'nombre', c.nombre, 'via_a_cent', c.via_a_cent, 'via_b_cent', c.via_b_cent)), '[]'::jsonb) into v_rojas from contabilidad.comprobaciones() c where not c.ok and c.bloqueante;
    raise exception 'simulacion' using errcode = 'P0498', detail = jsonb_build_object('resultado', v_res - 'repetido', 'efecto', v_efecto, 'efecto_hash', agente._hash_efecto(v_efecto),
      'clasificaciones', agente._clasificaciones(v_clave), 'cuadra', jsonb_array_length(v_rojas) = 0, 'comprobaciones_rojas', v_rojas)::text;
  exception when sqlstate 'P0498' then
    get stacked diagnostics v_txt = pg_exception_detail;
    return v_txt::jsonb;
  end;
end $$;

-- ------------------------------------------------------------------ MEDIO-E: resolver_toma con socio verificado
drop function agente.resolver_toma(text, text, text);
create function agente.resolver_toma(p_clave_idem text, p_toma_folio text, p_accion text, p_autor text, p_telegram_user_id bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_sol text;
begin
  perform notificacion.exigir_sistema();
  v_sol := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  perform set_config('rtm.canal', 'telegram', true);
  perform set_config('rtm.actor', v_sol, true);
  select id into v_id from operacion.toma_omar where folio = p_toma_folio;
  if v_id is null then return jsonb_build_object('estado', 'no_encontrada'); end if;
  return operacion.resolver_toma_omar(p_clave_idem, v_id, p_accion);
end $$;

-- ------------------------------------------------------------------ privilegios (BAJO-5): por funcion, explicito. El `alter default privileges ... revoke ... from public` no
-- protege funciones futuras (PUBLIC conserva el EXECUTE de fabrica); lo que protege es este revoke/grant por funcion y la prueba pgTAP 032 que falla si alguna queda abierta.
revoke all on function agente._clasificaciones(text), agente._exigir_capital_propio(text, jsonb, text), agente._pago_proveedor_declarado(text, jsonb, text) from public, anon, authenticated, servidor;
revoke all on function agente.ejecutar(text, text, jsonb), agente.ejecutar_ext(text, text, jsonb), agente.simular(text, text, jsonb), agente.resolver_toma(text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function agente.ejecutar(text, text, jsonb), agente.ejecutar_ext(text, text, jsonb), agente.simular(text, text, jsonb), agente.resolver_toma(text, text, text, text, bigint) to servidor;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
  end loop;
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'agente' loop
    if f.proname like '\_%' then execute format('revoke all on function %s from servidor', f.firma);
    else execute format('grant execute on function %s to servidor', f.firma); end if;
  end loop;
end $$;
