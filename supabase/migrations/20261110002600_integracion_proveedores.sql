-- Integracion 2 / 0026: inventario actual de proveedores (esquema `proveedores`).
--  * Estado vigente en tablas (modelo, variante, promocion, cola), solo los CAMBIOS como eventos, foto diaria y presupuesto de peticiones (tope 40 al dia con UPDATE condicional).
--  * Lo que el motor guarda como estructura interna (candidatos, lectura retenida, historial de variedad, salud, lecturas procesadas) vive en una fila jsonb `estado_interno`.
--  * NINGUNA columna de importe: una prueba de esquema lo vigila, y guardar_estado rechaza cualquier clave del JSON que parezca un importe.
--  * Avisos: `proveedores.emitir_aviso` traduce P-01..P-20 y V-1 a los tipos del catalogo de notificaciones y llama a `operacion.avisar` (idempotente por clave).
--  * La lectura contra el sitio real NO existe aqui: el lector vive en el servidor detras de un puerto y esta apagado por el interruptor `promociones_lectura` / cron_pausado.

create schema proveedores;
revoke all on schema proveedores from public, anon, authenticated;
grant usage on schema proveedores to servidor;

insert into seguridad.interruptor (clave, activo) values ('promociones_lectura', false), ('lectura_proveedores', false) on conflict (clave) do nothing;

create table proveedores.modelo (
  producto_id text primary key,
  handle text not null,
  titulo text not null,
  titulo_norm text not null,
  alias_titulos text[] not null default '{}',
  marca text not null,
  puffs int,
  estado text not null check (estado in ('activo', 'no_visto', 'descontinuado')),
  primera_vez timestamptz not null,
  ultima_vez timestamptz not null,
  ausencias int not null default 0,
  primera_ausencia timestamptz,
  sin_sabores boolean not null default false,
  nuevo_sin_costo boolean not null default false,
  mapeo text not null check (mapeo in ('pendiente', 'auto', 'confirmado')),
  canonico_id text,
  grupos_candidatos text[] not null default '{}'
);
create table proveedores.variante (
  variante_id text primary key,
  producto_id text not null,
  sabor_original text not null,
  sabor_norm text not null,
  disponible boolean not null,
  estado text not null check (estado in ('activa', 'no_vista', 'descontinuada')),
  ausencias int not null default 0,
  primera_ausencia timestamptz,
  mapeo text not null check (mapeo in ('pendiente', 'auto', 'confirmado')),
  sabor_canonico_id text,
  cambios timestamptz[] not null default '{}',
  inestable_hasta timestamptz,
  primera_vez timestamptz not null,
  ultima_vez timestamptz not null
);
create index variante_producto_idx on proveedores.variante (producto_id);
-- Bandera, tipo, porcentaje entero, modelos y fechas. Sin importes, sin precio de comparacion, sin texto de mercadotecnia.
create table proveedores.promocion (
  clave text primary key,
  tipo text not null check (tipo in ('porcentaje', 'multicompra', 'campana')),
  pct int check (pct is null or pct between 1 and 99),
  etiqueta text not null,
  alcance text[] not null default '{}',
  inicio timestamptz,
  fin timestamptz,
  primera_vista timestamptz not null,
  ultima_vista timestamptz not null,
  lecturas_ausente int not null default 0,
  estado text not null check (estado in ('candidata', 'activa', 'anunciada', 'terminada')),
  aviso_por_terminar boolean not null default false,
  coleccion text
);
create table proveedores.cola (
  tipo text not null check (tipo in ('modelo', 'sabor')),
  texto_norm text not null,
  texto_original text not null,
  sugerencia_id text,
  similitud numeric,
  creada timestamptz not null,
  primary key (tipo, texto_norm)
);
create table proveedores.estado_interno (
  id int primary key check (id = 1),
  inicializado boolean not null default false,
  tarjetas_promo int not null default 0,
  candidatos jsonb not null default '{}'::jsonb,
  retenida jsonb,
  historial_variedad jsonb not null default '{}'::jsonb,
  variedad jsonb not null default '{}'::jsonb,
  salud jsonb not null,
  lecturas_procesadas jsonb not null default '[]'::jsonb,
  actualizado_at timestamptz not null default now()
);
insert into proveedores.estado_interno (id, salud) values (1, '{"ultimaLecturaOk": null, "ultimoIntento": null, "fallosSeguidos": 0, "bloqueada": false, "incidente": null}');
create table proveedores.evento (
  clave text primary key,
  tipo text not null,
  producto_id text,
  variante_id text,
  lectura text not null,
  en timestamptz not null,
  antes text,
  despues text,
  datos jsonb not null default '{}'::jsonb
);
create index evento_en_idx on proveedores.evento (en desc);
create table proveedores.foto_diaria (
  dia date not null,
  variante_id text not null,
  disponible boolean not null,
  primary key (dia, variante_id)
);
create table proveedores.presupuesto (
  dia date primary key,
  usadas int not null default 0 check (usadas between 0 and 40),
  por_tipo jsonb not null default '{}'::jsonb
);
-- Pares que un socio rechazo y alias confirmados desde la cola (la confirmacion en pantalla llega en una ola posterior; aqui solo se leen).
create table proveedores.par_descartado (
  tipo text not null check (tipo in ('modelo', 'sabor')),
  texto_norm text not null,
  canonico_id text not null,
  creado_at timestamptz not null default now(),
  primary key (tipo, texto_norm, canonico_id)
);

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'proveedores' and c.relkind = 'r' loop
    execute format('alter table proveedores.%I enable row level security', r.relname);
    execute format('alter table proveedores.%I force row level security', r.relname);
    execute format('revoke all on proveedores.%I from public, anon, authenticated', r.relname);
  end loop;
end $$;
revoke all on all sequences in schema proveedores from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Defensa de privacidad: ninguna clave del JSON puede parecer un importe.
-- ---------------------------------------------------------------------------
create function proveedores.tiene_clave_importe(j jsonb) returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  with recursive t(k, v) as (
    select null::text, j
    union all
    select x.k, x.v from t, lateral (
      select e.key as k, e.value as v from jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) e
      union all
      select null::text, a.value from jsonb_array_elements(case when jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end) a
    ) x)
  select coalesce(bool_or(k ~* '^(price|prices|compare_at_price|compare|precio|precios|importe|importes|monto|montos|costo|costos|amount|subtotal|total_cent|body_html|description|descripcion|marketing|banner|texto_promocional)$' or k ~* '_cent$'), false) from t
$$;

create function proveedores.arr(j jsonb) returns text[]
language sql immutable parallel safe set search_path = ''
as $$ select coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end)), '{}'::text[]) $$;

-- ---------------------------------------------------------------------------
-- Estado: guardar reemplaza el vigente y agrega eventos (clave unica); cargar devuelve la forma de EstadoProveedor.
-- ---------------------------------------------------------------------------
create function proveedores.guardar_estado(p_estado jsonb, p_eventos jsonb, p_clave_idem text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_n int; v_res jsonb;
begin
  perform seguridad.exigir_socio_o_sistema();
  if proveedores.tiene_clave_importe(p_estado) or proveedores.tiene_clave_importe(coalesce(p_eventos, '[]'::jsonb)) then
    raise exception 'el estado de proveedores no admite importes' using errcode = 'P0461';
  end if;
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'proveedores.guardar_estado', 'e', p_estado, 'ev', p_eventos));
  if v_prev is not null then return v_prev; end if;
  delete from proveedores.modelo where true;
  insert into proveedores.modelo
    select r."id", r."handle", r."titulo", r."tituloNorm", proveedores.arr(r."aliasTitulos"), r."marca", r."puffs", r."estado", r."primeraVez", r."ultimaVez", r."ausencias", r."primeraAusencia",
           r."sinSabores", r."nuevoSinCosto", r."mapeo", r."canonicoId", proveedores.arr(r."gruposCandidatos")
      from jsonb_each(coalesce(p_estado -> 'modelos', '{}'::jsonb)) e,
           jsonb_to_record(e.value) as r("id" text, "handle" text, "titulo" text, "tituloNorm" text, "aliasTitulos" jsonb, "marca" text, "puffs" int, "estado" text, "primeraVez" timestamptz,
             "ultimaVez" timestamptz, "ausencias" int, "primeraAusencia" timestamptz, "sinSabores" boolean, "nuevoSinCosto" boolean, "mapeo" text, "canonicoId" text, "gruposCandidatos" jsonb);
  delete from proveedores.variante where true;
  insert into proveedores.variante
    select r."id", r."productoId", r."saborOriginal", r."saborNorm", r."disponible", r."estado", r."ausencias", r."primeraAusencia", r."mapeo", r."saborCanonicoId",
           coalesce(array(select jsonb_array_elements_text(r."cambios")::timestamptz), '{}'::timestamptz[]), r."inestableHasta", r."primeraVez", r."ultimaVez"
      from jsonb_each(coalesce(p_estado -> 'variantes', '{}'::jsonb)) e,
           jsonb_to_record(e.value) as r("id" text, "productoId" text, "saborOriginal" text, "saborNorm" text, "disponible" boolean, "estado" text, "ausencias" int, "primeraAusencia" timestamptz,
             "mapeo" text, "saborCanonicoId" text, "cambios" jsonb, "inestableHasta" timestamptz, "primeraVez" timestamptz, "ultimaVez" timestamptz);
  delete from proveedores.promocion where true;
  insert into proveedores.promocion
    select r."clave", r."tipo", r."pct", r."etiqueta", proveedores.arr(r."alcance"), r."inicio", r."fin", r."primeraVista", r."ultimaVista", r."lecturasAusente", r."estado", r."avisoPorTerminar", r."coleccion"
      from jsonb_each(coalesce(p_estado -> 'promociones', '{}'::jsonb)) e,
           jsonb_to_record(e.value) as r("clave" text, "tipo" text, "pct" int, "etiqueta" text, "alcance" jsonb, "inicio" timestamptz, "fin" timestamptz, "primeraVista" timestamptz, "ultimaVista" timestamptz,
             "lecturasAusente" int, "estado" text, "avisoPorTerminar" boolean, "coleccion" text);
  delete from proveedores.cola where true;
  insert into proveedores.cola
    select r."tipo", r."textoNorm", r."textoOriginal", r."sugerenciaId", r."similitud", r."creada"
      from jsonb_array_elements(coalesce(p_estado -> 'cola', '[]'::jsonb)) e,
           jsonb_to_record(e.value) as r("tipo" text, "textoNorm" text, "textoOriginal" text, "sugerenciaId" text, "similitud" numeric, "creada" timestamptz)
    on conflict do nothing;
  update proveedores.estado_interno set inicializado = coalesce((p_estado ->> 'inicializado')::boolean, false), tarjetas_promo = coalesce((p_estado ->> 'tarjetasPromo')::int, 0),
         candidatos = coalesce(p_estado -> 'candidatos', '{}'::jsonb), retenida = case when jsonb_typeof(p_estado -> 'retenida') = 'object' then p_estado -> 'retenida' end,
         historial_variedad = coalesce(p_estado -> 'historialVariedad', '{}'::jsonb), variedad = coalesce(p_estado -> 'variedad', '{}'::jsonb), salud = p_estado -> 'salud',
         lecturas_procesadas = coalesce(p_estado -> 'lecturasProcesadas', '[]'::jsonb), actualizado_at = now() where id = 1;
  insert into proveedores.evento (clave, tipo, producto_id, variante_id, lectura, en, antes, despues, datos)
    select r."clave", r."tipo", r."productoId", r."varianteId", r."lectura", r."en", r."antes", r."despues", coalesce(r."datos", '{}'::jsonb)
      from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb)) e,
           jsonb_to_record(e.value) as r("clave" text, "tipo" text, "productoId" text, "varianteId" text, "lectura" text, "en" timestamptz, "antes" text, "despues" text, "datos" jsonb)
    on conflict (clave) do nothing;
  get diagnostics v_n = row_count;
  v_res := jsonb_build_object('eventos_nuevos', v_n, 'modelos', (select count(*) from proveedores.modelo), 'variantes', (select count(*) from proveedores.variante));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function proveedores.cargar_estado() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare i proveedores.estado_interno;
begin
  perform seguridad.exigir_socio_o_sistema();
  select * into i from proveedores.estado_interno where id = 1;
  return jsonb_build_object(
    'version', 1, 'inicializado', i.inicializado,
    'modelos', coalesce((select jsonb_object_agg(m.producto_id, jsonb_build_object('id', m.producto_id, 'handle', m.handle, 'titulo', m.titulo, 'tituloNorm', m.titulo_norm, 'aliasTitulos', to_jsonb(m.alias_titulos),
        'marca', m.marca, 'puffs', m.puffs, 'estado', m.estado, 'primeraVez', m.primera_vez, 'ultimaVez', m.ultima_vez, 'ausencias', m.ausencias, 'primeraAusencia', m.primera_ausencia,
        'sinSabores', m.sin_sabores, 'nuevoSinCosto', m.nuevo_sin_costo, 'mapeo', m.mapeo, 'canonicoId', m.canonico_id, 'gruposCandidatos', to_jsonb(m.grupos_candidatos))) from proveedores.modelo m), '{}'::jsonb),
    'variantes', coalesce((select jsonb_object_agg(v.variante_id, jsonb_build_object('id', v.variante_id, 'productoId', v.producto_id, 'saborOriginal', v.sabor_original, 'saborNorm', v.sabor_norm,
        'disponible', v.disponible, 'estado', v.estado, 'ausencias', v.ausencias, 'primeraAusencia', v.primera_ausencia, 'mapeo', v.mapeo, 'saborCanonicoId', v.sabor_canonico_id, 'cambios', to_jsonb(v.cambios),
        'inestableHasta', v.inestable_hasta, 'primeraVez', v.primera_vez, 'ultimaVez', v.ultima_vez)) from proveedores.variante v), '{}'::jsonb),
    'candidatos', i.candidatos, 'retenida', i.retenida,
    'promociones', coalesce((select jsonb_object_agg(p.clave, jsonb_build_object('clave', p.clave, 'tipo', p.tipo, 'pct', p.pct, 'etiqueta', p.etiqueta, 'alcance', to_jsonb(p.alcance), 'inicio', p.inicio, 'fin', p.fin,
        'primeraVista', p.primera_vista, 'ultimaVista', p.ultima_vista, 'lecturasAusente', p.lecturas_ausente, 'estado', p.estado, 'avisoPorTerminar', p.aviso_por_terminar, 'coleccion', p.coleccion)) from proveedores.promocion p), '{}'::jsonb),
    'tarjetasPromo', i.tarjetas_promo,
    'cola', coalesce((select jsonb_agg(jsonb_build_object('tipo', c.tipo, 'textoOriginal', c.texto_original, 'textoNorm', c.texto_norm, 'sugerenciaId', c.sugerencia_id, 'similitud', c.similitud, 'creada', c.creada) order by c.creada, c.texto_norm) from proveedores.cola c), '[]'::jsonb),
    'historialVariedad', i.historial_variedad, 'variedad', i.variedad, 'salud', i.salud, 'lecturasProcesadas', i.lecturas_procesadas);
end $$;

create function proveedores.cargar_presupuesto(p_dia date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return (select jsonb_build_object('dia', p.dia, 'usadas', p.usadas, 'porTipo', jsonb_build_object('catalogo', coalesce((p.por_tipo ->> 'catalogo')::int, 0), 'confirmacion', coalesce((p.por_tipo ->> 'confirmacion')::int, 0),
            'inicio', coalesce((p.por_tipo ->> 'inicio')::int, 0), 'coleccion', coalesce((p.por_tipo ->> 'coleccion')::int, 0), 'robots', coalesce((p.por_tipo ->> 'robots')::int, 0))) from proveedores.presupuesto p where p.dia = p_dia);
end $$;

-- Toma una peticion del presupuesto: el UPDATE condicional impide que dos corridas simultaneas pasen de 40.
create function proveedores.presupuesto_tomar(p_dia date, p_tipo text, p_tope int default 40) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_usadas int;
begin
  perform seguridad.exigir_socio_o_sistema();
  if p_tipo not in ('catalogo', 'confirmacion', 'inicio', 'coleccion', 'robots') then raise exception 'tipo de peticion desconocido' using errcode = '22023'; end if;
  insert into proveedores.presupuesto as p (dia, usadas, por_tipo) values (p_dia, 1, jsonb_build_object(p_tipo, 1))
    on conflict (dia) do update set usadas = p.usadas + 1, por_tipo = jsonb_set(p.por_tipo, array[p_tipo], to_jsonb(coalesce((p.por_tipo ->> p_tipo)::int, 0) + 1))
    where p.usadas < least(p_tope, 40)
    returning usadas into v_usadas;
  return v_usadas is not null;
end $$;

create function proveedores.guardar_foto_diaria(p_dia date, p_filas jsonb) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform seguridad.exigir_socio_o_sistema();
  delete from proveedores.foto_diaria where dia = p_dia;
  insert into proveedores.foto_diaria (dia, variante_id, disponible)
    select p_dia, r."varianteId", r."disponible" from jsonb_to_recordset(p_filas) as r("varianteId" text, "disponible" boolean) on conflict do nothing;
  get diagnostics v_n = row_count;
  delete from proveedores.foto_diaria where dia < p_dia - 400;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Avisos: P-xx -> tipo del catalogo; idempotente por clave de deduplicacion; resolver cierra el aviso abierto.
-- ---------------------------------------------------------------------------
create function proveedores.emitir_aviso(p_codigo text, p_clave text, p_entidad_tipo text, p_entidad_id text, p_payload jsonb, p_titulo text) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_tipo text;
begin
  perform seguridad.exigir_socio_o_sistema();
  if proveedores.tiene_clave_importe(p_payload) then raise exception 'un aviso de proveedores no lleva importes' using errcode = 'P0461'; end if;
  v_tipo := case p_codigo when 'P-01' then 'proveedor_modelo_nuevo' when 'P-02' then 'proveedor_sabor_nuevo' when 'P-03' then 'proveedor_sabor_agotado' when 'P-04' then 'proveedor_modelo_agotado'
    when 'P-05' then 'proveedor_regreso' when 'P-07' then 'proveedor_cambios_sin_impacto' when 'P-08' then 'proveedor_descontinuado' when 'P-09' then 'promocion_nueva'
    when 'P-10' then 'promocion_anunciada' when 'P-11' then 'promocion_por_terminar' when 'P-12' then 'promocion_terminada' when 'P-17' then 'inventario_proveedores_degradado'
    when 'P-18' then 'lectura_retenida' when 'P-19' then 'proveedor_nombres_por_confirmar' when 'P-20' then 'proveedor_cambios_sin_impacto' when 'V-1' then 'proveedor_poca_variedad' end;
  if v_tipo is null then raise exception 'codigo de aviso desconocido: %', p_codigo using errcode = '22023'; end if;
  return operacion.avisar(v_tipo, null, 'prov:' || p_clave, null, p_titulo, 'proveedor_' || p_entidad_tipo, null, p_payload || jsonb_build_object('entidad', p_entidad_id));
end $$;

create function proveedores.resolver_aviso(p_clave text) returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform seguridad.exigir_socio_o_sistema();
  update operacion.aviso set estado = 'resuelta', resuelto_at = now(), resuelta_canal = 'sistema', actualizado_at = now() where clave_dedupe = 'prov:' || p_clave and estado = 'abierta';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Contexto del negocio (catalogo propio, alias y lo que los socios venden) y datos de la lista para clientes.
-- Ningun costo ni utilidad sale de estas funciones.
-- ---------------------------------------------------------------------------
create function proveedores.contexto_normalizacion() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return jsonb_build_object(
    'modelos', coalesce((select jsonb_agg(jsonb_build_object('id', m.id::text, 'nombre', m.nombre_canonico) order by m.id) from catalogo.modelo m), '[]'::jsonb),
    'aliasModelos', coalesce((select jsonb_agg(jsonb_build_object('alias', a.alias_norm, 'modeloIds', case when a.ambiguo then (select to_jsonb(array_agg(c::text)) from unnest(a.candidatos) c) else jsonb_build_array(a.modelo_id::text) end)) from catalogo.modelo_alias a), '[]'::jsonb),
    'sabores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id::text, 'nombre', s.nombre_canonico) order by s.id) from catalogo.sabor s), '[]'::jsonb),
    'aliasSabores', coalesce((select jsonb_agg(jsonb_build_object('textoNorm', a.alias_norm, 'saborId', a.sabor_id::text)) from catalogo.sabor_alias a), '[]'::jsonb),
    'descartados', coalesce((select to_jsonb(array_agg(d.tipo || '|' || d.texto_norm || '|' || d.canonico_id)) from proveedores.par_descartado d), '[]'::jsonb));
end $$;

-- "Activo para los socios": ventas en 60 dias o existencia propia mayor que 0 (por modelo y por sabor).
create function proveedores.contexto_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return jsonb_build_object(
    'modelos', coalesce((select to_jsonb(array_agg(distinct x::text)) from (
        select m.modelo_id as x from operacion.existencia_modelo m where m.piezas > 0
        union select l.modelo_id from operacion.pedido_linea l join operacion.pedido p on p.id = l.pedido_id where p.estado = 'enviado' and p.fecha_envio >= negocio.hoy() - 60) q), '[]'::jsonb),
    'sabores', coalesce((select to_jsonb(array_agg(distinct x)) from (
        select k.modelo_id::text || ':' || k.sabor_id::text as x from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id where u.piezas > 0
        union select l.modelo_id::text || ':' || k.sabor_id::text from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join operacion.pedido p on p.id = l.pedido_id
         where p.estado = 'enviado' and p.fecha_envio >= negocio.hoy() - 60) q), '[]'::jsonb));
end $$;

create function proveedores.precio_tabulador(p_cliente bigint, p_modelo bigint) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return (select t.precio_cent from catalogo.tabulador_precio t where t.cliente_id = p_cliente and t.modelo_id = p_modelo and t.vigente_hasta is null limit 1);
end $$;

create function proveedores.existencia_propia() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('marca', ma.nombre, 'nombre', m.nombre_canonico, 'sabores', s.sabores) order by ma.nombre, m.nombre_canonico)
    from catalogo.modelo m join catalogo.marca ma on ma.id = m.marca_id
    join lateral (select jsonb_agg(sb.nombre_canonico order by sb.nombre_canonico) as sabores from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.sabor sb on sb.id = k.sabor_id
                   where k.modelo_id = m.id and u.piezas > 0) s on s.sabores is not null), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas de la pantalla (STABLE)
-- ---------------------------------------------------------------------------
create function proveedores.frescura() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare i proveedores.estado_interno; v_horas numeric;
begin
  perform seguridad.exigir_socio_o_sistema();
  select * into i from proveedores.estado_interno where id = 1;
  v_horas := case when i.salud ->> 'ultimaLecturaOk' is null then null else round(extract(epoch from (now() - (i.salud ->> 'ultimaLecturaOk')::timestamptz)) / 3600, 1) end;
  return jsonb_build_object('inicializado', i.inicializado, 'ultima_lectura_ok', i.salud ->> 'ultimaLecturaOk', 'ultimo_intento', i.salud ->> 'ultimoIntento', 'fallos_seguidos', (i.salud ->> 'fallosSeguidos')::int,
    'bloqueada', (i.salud ->> 'bloqueada')::boolean, 'horas', v_horas, 'desactualizado', v_horas is null or v_horas > 3, 'lectura_activa', coalesce((select activo from seguridad.interruptor where clave = 'lectura_proveedores'), false),
    'promociones_activas', coalesce((select activo from seguridad.interruptor where clave = 'promociones_lectura'), false),
    'peticiones_hoy', coalesce((select usadas from proveedores.presupuesto where dia = negocio.hoy()), 0), 'tope_dia', 40);
end $$;

create function proveedores.inventario() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('producto_id', m.producto_id, 'marca', m.marca, 'titulo', m.titulo, 'puffs', m.puffs, 'estado', m.estado, 'nuevo_sin_costo', m.nuevo_sin_costo,
      'mapeo', m.mapeo, 'canonico_id', m.canonico_id, 'canonico_nombre', (select mo.nombre_canonico from catalogo.modelo mo where m.canonico_id is not null and mo.id = m.canonico_id::bigint), 'sin_sabores', m.sin_sabores,
      'sabores', coalesce((select jsonb_agg(jsonb_build_object('variante_id', v.variante_id, 'sabor', v.sabor_original, 'disponible', v.disponible, 'estado', v.estado, 'inestable', v.inestable_hasta is not null and v.inestable_hasta > now(),
          'sabor_canonico_id', v.sabor_canonico_id) order by v.sabor_original) from proveedores.variante v where v.producto_id = m.producto_id and v.estado <> 'descontinuada'), '[]'::jsonb),
      'costo_vigente', (select jsonb_build_object('costo_cent', c.costo_cent, 'desde', c.vigente_desde) from catalogo.costo_proveedor c join catalogo.proveedor pr on pr.id = c.proveedor_id
                          where m.canonico_id is not null and c.modelo_id = m.canonico_id::bigint and pr.nombre = 'Karen' and c.vigente_hasta is null limit 1),
      'existencia_propia', coalesce((select e.piezas from operacion.existencia_modelo e where m.canonico_id is not null and e.modelo_id = m.canonico_id::bigint), 0))
      order by m.marca, m.titulo) from proveedores.modelo m where m.estado <> 'descontinuado'), '[]'::jsonb);
end $$;

create function proveedores.promociones_vigentes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('clave', p.clave, 'tipo', p.tipo, 'pct', p.pct, 'etiqueta', p.etiqueta, 'inicio', p.inicio, 'fin', p.fin, 'estado', p.estado,
      'modelos', coalesce((select jsonb_agg(m.titulo order by m.titulo) from proveedores.modelo m where m.producto_id = any (p.alcance)), '[]'::jsonb)) order by p.fin nulls last, p.clave)
    from proveedores.promocion p where p.estado in ('activa', 'anunciada')), '[]'::jsonb);
end $$;

create function proveedores.eventos_recientes(p_limite int default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('clave', e.clave, 'tipo', e.tipo, 'en', e.en, 'antes', e.antes, 'despues', e.despues, 'datos', e.datos,
      'modelo', (select m.titulo from proveedores.modelo m where m.producto_id = e.producto_id)) order by e.en desc) from (select * from proveedores.evento order by en desc limit least(greatest(p_limite, 1), 200)) e), '[]'::jsonb);
end $$;

create function proveedores.cola_confirmacion() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('tipo', c.tipo, 'texto', c.texto_original, 'sugerencia_id', c.sugerencia_id, 'similitud', c.similitud, 'creada', c.creada) order by c.creada) from proveedores.cola c), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- api.* para la pantalla (rol socio)
-- ---------------------------------------------------------------------------
create function api.prov_inventario() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return jsonb_build_object('frescura', proveedores.frescura(), 'modelos', proveedores.inventario(), 'promociones', proveedores.promociones_vigentes(),
  'eventos', proveedores.eventos_recientes(30), 'cola', proveedores.cola_confirmacion()); end $$;
create function api.prov_contexto_normalizacion() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.contexto_normalizacion(); end $$;
create function api.prov_contexto_socios() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.contexto_socios(); end $$;
create function api.prov_cargar_estado() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.cargar_estado(); end $$;
create function api.prov_precio_tabulador(p_cliente bigint, p_modelo bigint) returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return jsonb_build_object('precio_cent', proveedores.precio_tabulador(p_cliente, p_modelo)); end $$;
create function api.prov_existencia_propia() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.existencia_propia(); end $$;

revoke execute on all functions in schema proveedores from public, anon, authenticated;
grant execute on all functions in schema proveedores to servidor;
revoke execute on function api.prov_inventario(), api.prov_contexto_normalizacion(), api.prov_contexto_socios(), api.prov_cargar_estado(), api.prov_precio_tabulador(bigint, bigint), api.prov_existencia_propia() from public, anon;
grant execute on function api.prov_inventario(), api.prov_contexto_normalizacion(), api.prov_contexto_socios(), api.prov_cargar_estado(), api.prov_precio_tabulador(bigint, bigint), api.prov_existencia_propia() to authenticated;
