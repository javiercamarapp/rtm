-- Carril AVISOS DE INVENTARIO, MODELOS, SABORES Y PROVEEDORES (bot de Telegram). ADITIVA: tablas, interruptor y funciones nuevas en el esquema agente.
-- Reglas de este carril:
--  * TODO nace APAGADO: interruptor general `avisos_inventario` (seguridad.interruptor) y cada regla en agente.aviso_regla (activo = false). Nada se enciende en produccion desde aqui.
--  * Solo se AVISA: ningun evaluador escribe costos, precios, inventario ni dinero. El texto lo arma TypeScript con cifras de SQL; el modelo de IA no interviene.
--  * Destinatario unico: el grupo de los socios (nunca clientes, proveedores ni Omar). Esta migracion no envia nada: deja la COLA (agente.aviso_cola) y el limitador.
--  * Clave estable + enfriamiento por regla: un hecho = una fila; reintentos no duplican; un hecho que se repite no vuelve a salir antes de su enfriamiento.
--  * Interfaz con el carril de reloj: notificacion.emitir (clave estable y enfriamiento) se define aqui SOLO si no existe; el reloj arma los digest con agente.avisos_digest_armar.

-- ------------------------------------------------------------------ interruptor general (apagado)
insert into seguridad.interruptor (clave, activo) values ('avisos_inventario', false) on conflict (clave) do nothing;

-- ------------------------------------------------------------------ reglas (umbrales editables sin desplegar; todas apagadas)
create table agente.aviso_regla (
  codigo text primary key,
  familia text not null check (familia in ('INV', 'OC', 'PRV', 'CLI', 'PED', 'DIN', 'SIS')),
  titulo text not null,
  canal text not null check (canal in ('I', 'M', 'R', 'S')),
  severidad text not null default 'I' check (severidad in ('C', 'I', 'F')),
  activo boolean not null default false,
  enfriamiento_h int not null default 24 check (enfriamiento_h >= 0),
  umbral jsonb not null default '{}'::jsonb,
  descripcion text not null default ''
);
alter table agente.aviso_regla force row level security;
revoke all on agente.aviso_regla from public, anon, authenticated;

insert into agente.aviso_regla (codigo, familia, titulo, canal, severidad, enfriamiento_h, umbral, descripcion) values
  ('_tope', 'SIS', 'Tope de mensajes y digest', 'M', 'F', 0, '{"tope_dia": 6, "inmediatos_dia": 3, "max_lineas": 12, "silencio_ini": 21, "silencio_fin": 7, "hora_pendientes": 9, "hora_resumen": 20, "dia_semanal": 1, "hora_semanal": 7}', 'Parametros del limitador y de las ventanas de digest (America/Merida). No es una regla de aviso.'),
  ('inv_reponer', 'INV', 'Reposicion por sabor (incluye transito)', 'M', 'I', 72, '{"urge_top": 5}', 'Cobertura baja por sabor con la compra en transito; sin 28 dias de historia usa el minimo manual por modelo y sabor.'),
  ('inv_agotado', 'INV', 'Sabor agotado con venta reciente', 'M', 'I', 168, '{}', 'Existencia cero, vendio en la ventana de demanda y no hay compra en transito.'),
  ('oc_llega', 'OC', 'Llegada esperada hoy o manana', 'M', 'I', 20, '{}', 'Compra confirmada o en camino con llegada estimada hoy o manana.'),
  ('oc_atraso', 'OC', 'Compra atrasada', 'M', 'I', 48, '{"escalar_dias": 2, "holgura_sin_fecha": 2}', 'Pasada la llegada estimada, o sin fecha y pasado el plazo del proveedor mas la holgura. Desde 2 dias de atraso sale como inmediato.'),
  ('oc_sin_fecha', 'OC', 'Compra sin fecha de llegada o de envio', 'M', 'F', 72, '{}', 'Sin esta fecha no existen la llegada esperada ni el atraso.'),
  ('oc_faltante', 'OC', 'Recepcion parcial pendiente y faltantes por reclamar', 'M', 'I', 72, '{"dias_min": 3, "antigua_dias": 7}', 'Faltantes registrados o piezas por llegar de una recepcion parcial.'),
  ('oc_llego', 'OC', 'Resumen de llegada de una compra', 'I', 'I', 0, '{}', 'Una vez por recepcion: piezas, sabores nuevos y reposiciones que se cierran.'),
  ('prv_llego', 'PRV', 'Mas vendidos que ya llegaron con el proveedor', 'M', 'I', 168, '{"top": 10, "min_piezas_28d": 6, "ventana_dias": 7}', 'Sabores o modelos del proveedor (monitor) que son de los mas vendidos.'),
  ('prv_costo', 'PRV', 'Cambio de costo de lista registrado y efecto en margen', 'M', 'I', 0, '{"margen_min_pct": 5, "ventana_dias": 3}', 'Solo avisa: sentido, porcentaje entero y clientes que quedan bajo el margen minimo. Nunca cambia costos ni precios.'),
  ('prv_puente', 'PRV', 'Puente del monitor de proveedores', 'M', 'I', 0, '{"ventana_dias": 3, "puffs_interes": 15000}', 'Reenvia al grupo los avisos del monitor (ya confirmados) filtrados por relevancia; al encenderla, el monitor deja de mandar a Telegram por su cuenta.'),
  ('prv_lista', 'PRV', 'Cambios en la lista cargada de un proveedor sin fuente viva', 'M', 'F', 0, '{}', 'Diff manual (Isaac): modelos nuevos, ausentes, sabores nuevos y cambio de costo solo con sentido y porcentaje.'),
  ('cli_sin_comprar', 'CLI', 'Cliente sin comprar respecto a su ritmo', 'S', 'F', 168, '{"min_pedidos": 3, "ventana_dias": 90, "factor": 2, "piso_dias": 21}', 'Con 3 o mas pedidos en 90 dias: mas de dos veces su intervalo habitual y al menos 21 dias.'),
  ('cli_vencido_pide', 'CLI', 'Cliente con saldo vencido que pide mas', 'I', 'I', 0, '{}', 'Pedido nuevo de un cliente con saldo vencido en otros pedidos. El socio decide si se surte.'),
  ('cli_concentracion', 'CLI', 'Concentracion de cartera y de ventas', 'S', 'F', 0, '{"top1_pct": 40, "top2_pct": 70, "min_clientes": 2}', 'Un cliente con mas de 40 por ciento de la cartera, o dos con mas de 70. Sale solo al cambiar de banda.'),
  ('ped_pendiente_envio', 'PED', 'Pedidos sin empacar o sin enviar', 'M', 'I', 24, '{"horas_empacar": 4, "horas_enviar": 24}', 'Pedido de bodega confirmado sin empacar, o empacado sin enviar.'),
  ('ped_guia_pendiente', 'PED', 'Guias pendientes (flujo en dos tiempos)', 'M', 'I', 24, '{"horas": 24}', 'Pedido enviado con paqueteria y sin guia de salida registrada.'),
  ('ped_sin_entrega', 'PED', 'Pedidos enviados sin entrega confirmada', 'M', 'I', 72, '{"dias": 4, "escalar_dias": 10, "solo_bodega": true}', 'Enviado y sin fecha de entrega; solo bodega mientras Isaac y Karen no confirmen entrega.'),
  ('din_descuento', 'DIN', 'Descuento inusual', 'I', 'I', 0, '{"pct": 5, "ventana_dias": 2}', 'Descuento mayor al 5 por ciento del importe de las lineas.'),
  ('cli_pago_dup', 'CLI', 'Posible pago duplicado', 'I', 'C', 0, '{"horas": 48}', 'Mismo cliente, mismo monto y misma cuenta en menos de 48 horas.');

-- ------------------------------------------------------------------ minimo manual por modelo y sabor (mientras no haya 28 dias de historia)
create table agente.minimo_manual (
  id bigint generated always as identity primary key,
  sku_id bigint not null references catalogo.sku (id),
  min_pz int not null check (min_pz >= 0),
  fuente text not null default 'telegram',
  fijado_por text not null,
  creado_at timestamptz not null default clock_timestamp(),
  vigente_hasta timestamptz
);
create unique index minimo_manual_vigente_idx on agente.minimo_manual (sku_id) where vigente_hasta is null;
alter table agente.minimo_manual force row level security;
revoke all on agente.minimo_manual from public, anon, authenticated;

-- Pregunta abierta de /minimo (el bot pregunta lo que falte; caduca a los 15 minutos).
create table agente.minimo_pendiente (
  chat_id bigint not null,
  autor text not null,
  modelo_id bigint,
  sabor_id bigint,
  piezas int,
  creado_at timestamptz not null default clock_timestamp(),
  primary key (chat_id, autor)
);
alter table agente.minimo_pendiente force row level security;
revoke all on agente.minimo_pendiente from public, anon, authenticated;

-- ------------------------------------------------------------------ cola de avisos y digest enviados
create table agente.aviso_cola (
  id bigint generated always as identity primary key,
  codigo text not null references agente.aviso_regla (codigo),
  clave text not null,
  canal text not null check (canal in ('I', 'M', 'R', 'S')),
  severidad text not null default 'I' check (severidad in ('C', 'I', 'F')),
  payload jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'historico', 'resuelto')),
  creado_at timestamptz not null default clock_timestamp(),
  enviado_at timestamptz,
  digest_id bigint
);
create index aviso_cola_clave_idx on agente.aviso_cola (clave, creado_at desc);
create index aviso_cola_estado_idx on agente.aviso_cola (estado, canal, id);
alter table agente.aviso_cola force row level security;
revoke all on agente.aviso_cola from public, anon, authenticated;

create table agente.aviso_digest (
  id bigint generated always as identity primary key,
  dia date not null,
  ventana text not null check (ventana in ('I', 'M', 'R', 'S')),
  items int not null check (items > 0),
  enviado_at timestamptz not null default clock_timestamp()
);
create index aviso_digest_dia_idx on agente.aviso_digest (dia);
alter table agente.aviso_digest force row level security;
revoke all on agente.aviso_digest from public, anon, authenticated;

alter table agente.aviso_cola add constraint aviso_cola_digest_fk foreign key (digest_id) references agente.aviso_digest (id);

-- ------------------------------------------------------------------ encolar: UNICA puerta de la cola (clave estable + enfriamiento)
-- Devuelve el id nuevo, o null si la regla esta apagada, el interruptor general esta apagado, o la clave sigue en enfriamiento.
-- p_estado 'historico' es la CARGA SILENCIOSA: registra el hecho como ya conocido para que, al encender la regla, no salga el pasado.
create function agente.aviso_encolar(p_codigo text, p_clave text, p_payload jsonb, p_canal text default null, p_estado text default 'pendiente') returns bigint
language plpgsql security definer set search_path = ''
as $$
declare r agente.aviso_regla; v_id bigint; v_canal text;
begin
  perform notificacion.exigir_sistema();
  select * into r from agente.aviso_regla where codigo = p_codigo and codigo <> '_tope';
  if not found then raise exception 'regla de aviso desconocida: %', p_codigo using errcode = '22023'; end if;
  if p_estado not in ('pendiente', 'historico') then raise exception 'estado de cola invalido' using errcode = '22023'; end if;
  if p_estado = 'pendiente' and not (r.activo and coalesce((select i.activo from seguridad.interruptor i where i.clave = 'avisos_inventario'), false)) then return null; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'el payload debe ser un objeto' using errcode = '22023'; end if;
  v_canal := coalesce(p_canal, r.canal);
  if v_canal not in ('I', 'M', 'R', 'S') then raise exception 'canal de aviso invalido' using errcode = '22023'; end if;
  -- Una clave ya vista en su enfriamiento (o ya cargada como historica) no vuelve a entrar; con enfriamiento 0 la clave es de un solo uso (hecho unico).
  if exists (select 1 from agente.aviso_cola q where q.clave = p_clave and (q.estado = 'historico' or r.enfriamiento_h = 0 or q.creado_at > clock_timestamp() - make_interval(hours => r.enfriamiento_h))) then return null; end if;
  insert into agente.aviso_cola (codigo, clave, canal, severidad, payload, estado) values (p_codigo, p_clave, v_canal, r.severidad, p_payload, p_estado) returning id into v_id;
  return v_id;
end $$;

-- Interfaz generica con el carril de reloj: solo se crea si el reloj aun no la definio (create or replace de este nombre queda para quien integre).
do $emitir$
begin
  if not exists (select 1 from pg_proc p where p.pronamespace = 'notificacion'::regnamespace and p.proname = 'emitir') then
    execute $f$
      create function notificacion.emitir(p_codigo text, p_clave text, p_payload jsonb, p_canal text default null) returns bigint
      language sql security definer set search_path = ''
      as 'select agente.aviso_encolar(p_codigo, p_clave, p_payload, p_canal, ''pendiente'')'
    $f$;
    execute 'revoke all on function notificacion.emitir(text, text, jsonb, text) from public, anon, authenticated';
    execute 'grant execute on function notificacion.emitir(text, text, jsonb, text) to servidor';
  end if;
end $emitir$;

-- ------------------------------------------------------------------ encender o apagar (solo un socio verificado; queda en el registro del agente)
create function agente.avisos_fijar(p_activo boolean, p_autor text, p_telegram_user_id bigint, p_regla text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_socio text; v_antes boolean; v_ids text[];
begin
  perform notificacion.exigir_sistema();
  v_socio := agente._autor(jsonb_build_object('autor', p_autor, 'telegram_user_id', p_telegram_user_id));
  if p_regla is null then
    v_antes := coalesce((select activo from seguridad.interruptor where clave = 'avisos_inventario'), false);
    insert into seguridad.interruptor (clave, activo) values ('avisos_inventario', p_activo) on conflict (clave) do update set activo = excluded.activo;
    insert into agente.evento (tipo, miembro, detalle) values (case when p_activo then 'avisos_inventario_encendidos' else 'avisos_inventario_apagados' end, p_telegram_user_id, left('cambio de ' || v_socio, 300));
    return jsonb_build_object('general', true, 'activo', p_activo, 'cambio', v_antes is distinct from p_activo, 'por', v_socio);
  end if;
  if not exists (select 1 from agente.aviso_regla where codigo = p_regla and codigo <> '_tope') then raise exception 'regla de aviso desconocida: %', p_regla using errcode = '22023'; end if;
  update agente.aviso_regla set activo = p_activo where codigo = p_regla returning activo into v_antes;
  -- El puente reemplaza el camino directo del monitor a Telegram: encendido, los avisos del monitor quedan en la campana y solo salen por el filtro.
  if p_regla = 'prv_puente' then
    update notificacion.tipo set canal = case when p_activo then 'SW' else 'ST' end
     where codigo in ('proveedor_modelo_nuevo', 'proveedor_sabor_nuevo', 'proveedor_sabor_agotado', 'proveedor_modelo_agotado', 'proveedor_regreso', 'proveedor_descontinuado',
                      'inventario_proveedores_degradado', 'lectura_retenida', 'promocion_nueva', 'promocion_anunciada', 'promocion_por_terminar');
  end if;
  insert into agente.evento (tipo, miembro, detalle) values ('aviso_regla_' || case when p_activo then 'encendida' else 'apagada' end, p_telegram_user_id, left(v_socio || ': ' || p_regla, 300));
  return jsonb_build_object('regla', p_regla, 'activo', p_activo, 'por', v_socio);
end $$;

-- ------------------------------------------------------------------ permisos
revoke all on function agente.aviso_encolar(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function agente.aviso_encolar(text, text, jsonb, text, text) to servidor;
revoke all on function agente.avisos_fijar(boolean, text, bigint, text) from public, anon, authenticated;
grant execute on function agente.avisos_fijar(boolean, text, bigint, text) to servidor;
