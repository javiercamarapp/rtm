-- Folio automatico de pedido (decision del dueno, 14-nov): iniciales del cliente (nombre y apellido; una palabra = sus dos primeras letras) + consecutivo de 3 digitos POR CLAVE DE INICIALES,
-- unico en el sistema, generado por SQL (nunca por el modelo) y con la MISMA regla en la web (api.crear_pedido) y en el bot (agente pedido_crear), porque ambos pasan por operacion.crear_pedido.
-- Ejemplos (nombres ficticios): "Memo Garcia" -> MG-001, MG-002; "Lupita" -> LU-001; "Maria del Carmen Ruiz" -> MC-001 (se ignoran particulas: de, del, la, los, y...).
-- Los folios viejos P-00NN se CONSERVAN tal cual (no se renombra nada); la serie 'P' deja de crecer.
-- Dos clientes con las mismas iniciales comparten el consecutivo (MG-001 y MG-002): por eso es unico.
-- ADITIVA: tablas y funciones nuevas + create or replace de operacion.crear_pedido sobre su ULTIMA definicion vigente (cambia SOLO la linea del folio). Idempotente por clave de operacion.

create table operacion.contador_folio_pedido (
  iniciales text primary key check (iniciales ~ '^[A-Z]{2}$'),
  ultimo int not null default 0 check (ultimo >= 0)
);
create table operacion.folio_pedido_asignado (
  clave_idem text primary key,
  cliente_id bigint not null references catalogo.cliente(id),
  iniciales text not null,
  folio text not null unique,
  creado_at timestamptz not null default clock_timestamp()
);
alter table operacion.contador_folio_pedido enable row level security;
alter table operacion.contador_folio_pedido force row level security;
alter table operacion.folio_pedido_asignado enable row level security;
alter table operacion.folio_pedido_asignado force row level security;
revoke all on operacion.contador_folio_pedido, operacion.folio_pedido_asignado from public, anon, authenticated;

-- Iniciales de un nombre: dos letras mayusculas. Misma regla que src/dominio/agente/folio_pedido.ts.
create function operacion.iniciales_cliente(p_nombre text) returns text
language plpgsql immutable set search_path = ''
as $$
declare v_t text; v_pal text[]; v_utiles text[]; w text;
begin
  v_t := regexp_replace(translate(lower(coalesce(p_nombre, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'), '[^a-z]+', ' ', 'g');
  v_pal := array_remove(string_to_array(btrim(v_t), ' '), '');
  v_utiles := '{}';
  foreach w in array coalesce(v_pal, '{}') loop
    if w <> all (array['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'da', 'di', 'van', 'von']) then v_utiles := v_utiles || w; end if;
  end loop;
  if cardinality(v_utiles) = 0 then v_utiles := coalesce(v_pal, '{}'); end if;
  if cardinality(v_utiles) = 0 then return 'XX'; end if;
  if cardinality(v_utiles) = 1 then return upper(rpad(left(v_utiles[1], 2), 2, 'x')); end if;
  return upper(left(v_utiles[1], 1) || left(v_utiles[2], 1));
end $$;

-- Siguiente folio para un cliente. Atomico (candado de transaccion por iniciales + fila de contador), unico y IDEMPOTENTE por clave de operacion.
create function operacion.siguiente_folio_pedido(p_cliente_id bigint, p_clave_idem text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_nombre text; v_ini text; v_n int; v_folio text; v_prev text;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  select nombre_canonico into v_nombre from catalogo.cliente where id = p_cliente_id;
  if not found then raise exception 'cliente desconocido' using errcode = '22023'; end if;
  v_ini := operacion.iniciales_cliente(v_nombre);
  perform pg_advisory_xact_lock(hashtextextended('folio_pedido:' || v_ini, 0));
  if p_clave_idem is not null then
    select folio into v_prev from operacion.folio_pedido_asignado where clave_idem = p_clave_idem;
    if v_prev is not null then return v_prev; end if;
  end if;
  loop
    insert into operacion.contador_folio_pedido (iniciales, ultimo) values (v_ini, 1)
      on conflict (iniciales) do update set ultimo = operacion.contador_folio_pedido.ultimo + 1 returning ultimo into v_n;
    v_folio := v_ini || '-' || lpad(v_n::text, 3, '0');
    exit when not exists (select 1 from operacion.pedido where folio = v_folio);
  end loop;
  if p_clave_idem is not null then
    insert into operacion.folio_pedido_asignado (clave_idem, cliente_id, iniciales, folio) values (p_clave_idem, p_cliente_id, v_ini, v_folio);
  end if;
  return v_folio;
end $$;

revoke all on function operacion.iniciales_cliente(text), operacion.siguiente_folio_pedido(bigint, text) from public, anon, authenticated;

-- operacion.crear_pedido: ultima definicion vigente (20261110001100), con UN cambio: el folio sale de siguiente_folio_pedido.
create or replace function operacion.crear_pedido(p_clave_idem text, p_cliente_id bigint, p_lineas jsonb, p_origen text DEFAULT 'bodega_omar'::text, p_destino_id bigint DEFAULT NULL::bigint, p_envio_cent bigint DEFAULT 0, p_descuento_cent bigint DEFAULT 0, p_recargo_cent bigint DEFAULT 0, p_fecha date DEFAULT NULL::date, p_excepcion_minimo_motivo text DEFAULT NULL::text, p_plazo_dias integer DEFAULT NULL::integer, p_paqueteria text DEFAULT NULL::text, p_nota text DEFAULT NULL::text, p_mensaje_origen text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prev jsonb; v_fecha date := coalesce(p_fecha, negocio.hoy()); c catalogo.cliente; v_ev bigint; v_id bigint; v_folio text; l jsonb; r jsonb; v_tab bigint; v_precio bigint; v_costo bigint;
  v_lin bigint; v_min int; v_piezas int := 0; v_n int := 0; v_dispo int; v_estado text; v_res jsonb; v_nombre text; v_avisos int := 0;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'crear_pedido', 'c', p_cliente_id, 'l', p_lineas, 'o', p_origen, 'd', p_destino_id, 'e', p_envio_cent, 'de', p_descuento_cent,
                                         'r', p_recargo_cent, 'f', p_fecha, 'x', p_excepcion_minimo_motivo, 'pl', p_plazo_dias, 'pq', p_paqueteria, 'n', p_nota, 'mo', p_mensaje_origen));
  if v_prev is not null then return v_prev; end if;
  select * into c from catalogo.cliente where id = p_cliente_id;
  if not found or not c.activo then raise exception 'cliente desconocido o inactivo' using errcode = '22023'; end if;
  if p_origen not in ('bodega_omar', 'karen_directo', 'karen_via_isaac', 'isaac_directo', 'castores') then raise exception 'origen invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'el pedido necesita renglones' using errcode = '22023'; end if;
  if coalesce(p_envio_cent, 0) < 0 or coalesce(p_descuento_cent, 0) < 0 or coalesce(p_recargo_cent, 0) < 0 then raise exception 'envio, descuento y recargo no pueden ser negativos' using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('pedido_creado', v_fecha, p_clave_idem, jsonb_build_object('cliente_id', p_cliente_id, 'origen', p_origen, 'lineas', jsonb_array_length(p_lineas)), p_mensaje_origen);
  v_folio := operacion.siguiente_folio_pedido(p_cliente_id, p_clave_idem);
  insert into operacion.pedido (folio, cliente_id, destino_id, duenio_id, fecha_neg, origen, excepcion_minimo_motivo, envio_cent, descuento_cent, recargo_cent, plazo_dias, paqueteria, nota, evento_id)
    values (v_folio, p_cliente_id, p_destino_id, c.duenio_id, v_fecha, p_origen, nullif(btrim(p_excepcion_minimo_motivo), ''), coalesce(p_envio_cent, 0), coalesce(p_descuento_cent, 0), coalesce(p_recargo_cent, 0),
            p_plazo_dias, p_paqueteria, p_nota, v_ev) returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    r := operacion.resolver_sku(l);
    if coalesce((l->>'piezas')::int, 0) <= 0 then raise exception 'cada renglon necesita piezas positivas' using errcode = '23514'; end if;
    v_tab := catalogo.precio_vigente(p_cliente_id, (r->>'modelo_id')::bigint, v_fecha);
    v_precio := coalesce((l->>'precio_cent')::bigint, v_tab);
    if v_precio is null then raise exception 'el cliente no tiene precio de tabulador para ese modelo: indica el precio' using errcode = '23502'; end if;
    insert into operacion.pedido_linea (pedido_id, sku_id, modelo_id, piezas_pedidas, precio_cent, precio_tabulador_cent, motivo_precio)
      values (v_id, (r->>'sku_id')::bigint, (r->>'modelo_id')::bigint, (l->>'piezas')::int, v_precio, v_tab, nullif(btrim(l->>'motivo_precio'), '')) returning id into v_lin;
    v_piezas := v_piezas + (l->>'piezas')::int; v_n := v_n + 1;
    select nombre_canonico, estado into v_nombre, v_estado from catalogo.modelo where id = (r->>'modelo_id')::bigint;
    -- Avisos NO bloqueantes.
    if v_tab is null then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'sin_precio_catalogo', 'NT-004', v_nombre || ': el cliente no tiene precio de tabulador (precio capturado a mano)');
    elsif v_estado = 'sin_disponibilidad' then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'sin_precio_catalogo', 'NT-004', v_nombre || ' esta sin disponibilidad ahora');
    end if;
    if v_tab is not null and v_precio <> v_tab then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'precio_distinto_tabulador', 'NT-001', v_nombre || ': el precio capturado difiere del tabulador');
    end if;
    v_costo := operacion.costo_ref_pedido(p_origen, (r->>'modelo_id')::bigint, v_fecha);
    if v_costo is not null and v_precio <= v_costo then
      insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'venta_bajo_costo', 'NT-002', v_nombre || ': se vende ' || case when v_precio = v_costo then 'a costo' else 'por debajo del costo' end);
    end if;
    if operacion.origen_es_bodega(p_origen) then
      v_dispo := operacion.disponible_sku((r->>'sku_id')::bigint);
      if v_dispo < (l->>'piezas')::int then
        insert into operacion.pedido_aviso (pedido_id, pedido_linea_id, codigo, nt, detalle) values (v_id, v_lin, 'existencia_insuficiente', null, v_nombre || ': disponibles ' || greatest(v_dispo, 0) || ' pz, se piden ' || (l->>'piezas'));
      end if;
    end if;
  end loop;
  v_min := coalesce((catalogo.config_valor('minimo_piezas_pedido', v_fecha))::text::int, 20);
  if v_piezas < v_min and nullif(btrim(p_excepcion_minimo_motivo), '') is null then
    insert into operacion.pedido_aviso (pedido_id, codigo, nt, detalle) values (v_id, 'minimo_piezas', 'NT-005', 'Pedido de ' || v_piezas || ' pz: el minimo es ' || v_min);
  end if;
  select count(*) into v_avisos from operacion.pedido_aviso where pedido_id = v_id;
  v_res := jsonb_build_object('pedido_id', v_id, 'folio', v_folio, 'piezas', v_piezas, 'lineas', v_n, 'avisos', v_avisos);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $function$

;
