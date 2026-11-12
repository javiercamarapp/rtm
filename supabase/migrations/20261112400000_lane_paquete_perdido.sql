-- Carril paquete-perdido / 0001: flujo de paquete perdido o danado (salida a un cliente o entrada desde un proveedor).
-- Solo aditivo: tablas nuevas de solo insercion, funciones nuevas, tipos de aviso nuevos y envoltorios; ninguna tabla con datos se toca.
-- Reglas (CLAUDE.md y adendas 21, 27, 29, 31): lo que un paquete perdido cuesta lo absorbe la sociedad (perdida 50/50 por la utilidad), o se cobra a un socio
-- (cuenta por cobrar al socio, adenda 29) o al proveedor (reclamo); el gasto se registra UNA sola vez; la guia original nunca se vuelve a contar como perdida y la
-- guia de una reposicion es un gasto real nuevo, contado una sola vez. Nada se edita: se resuelve con hechos nuevos.
--   ENTRADA (orden de compra en camino): reportar el incidente confirma la recepcion con lo que llego sano (cero si se perdio todo); lo que falta nace como
--   diferencia de recepcion y se resuelve con las funciones que ya existen (castigar = la sociedad absorbe; asignar al socio; reclamo al proveedor).
--   SALIDA (pedido ya enviado): reponer (sale de la existencia como merma y se registra la guia del reenvio) o bonificar (el cliente no paga esas piezas:
--   correccion de nota con descuento y reclasificacion del costo a perdida); responsable: sociedad, un socio (le queda por cobrar) o el cliente (no cambia nada).

create table operacion.paquete_incidente (
  id bigint generated always as identity primary key,
  folio text generated always as ('PQ-' || lpad(id::text, 4, '0')) stored,
  sentido text not null check (sentido in ('salida', 'entrada')),
  tipo text not null check (tipo in ('perdido', 'danado')),
  pedido_id bigint references operacion.pedido (id),
  compra_id bigint references operacion.compra (id),
  detalle text not null check (nullif(btrim(detalle), '') is not null),
  fecha_neg date not null,
  reportado_por uuid,
  reportado_at timestamptz not null default now(),
  evento_id bigint not null references operacion.evento (id),
  check ((sentido = 'salida') = (pedido_id is not null) and (sentido = 'entrada') = (compra_id is not null))
);
create unique index paquete_incidente_folio_uq on operacion.paquete_incidente (folio);
create unique index paquete_incidente_una_por_compra on operacion.paquete_incidente (compra_id) where compra_id is not null;
create index paquete_incidente_pedido_idx on operacion.paquete_incidente (pedido_id) where pedido_id is not null;

create table operacion.paquete_incidente_linea (
  id bigint generated always as identity primary key,
  incidente_id bigint not null references operacion.paquete_incidente (id),
  sku_id bigint not null references catalogo.sku (id),
  modelo_id bigint not null references catalogo.modelo (id),
  piezas int not null check (piezas > 0),
  valor_cent bigint not null check (valor_cent >= 0),
  pedido_linea_id bigint references operacion.pedido_linea (id),
  compra_linea_id bigint references operacion.compra_linea (id),
  diferencia_id bigint references operacion.compra_diferencia (id)
);
create index paquete_incidente_linea_inc_idx on operacion.paquete_incidente_linea (incidente_id);
create index paquete_incidente_linea_dif_idx on operacion.paquete_incidente_linea (diferencia_id) where diferencia_id is not null;

-- Una resolucion por incidente. En una entrada el responsable vigente se lee de la asignacion de la diferencia (puede reasignarse con las funciones de compras).
create table operacion.paquete_incidente_resolucion (
  id bigint generated always as identity primary key,
  incidente_id bigint not null unique references operacion.paquete_incidente (id),
  responsable text not null check (responsable in ('sociedad', 'socio', 'proveedor', 'cliente')),
  socio_id bigint references catalogo.socio (id),
  accion text not null check (accion in ('reponer', 'bonificar', 'castigar', 'asignar', 'reclamar', 'ninguna')),
  absorbe_sociedad_cent bigint not null default 0 check (absorbe_sociedad_cent >= 0),
  recuperable_cent bigint not null default 0 check (recuperable_cent >= 0),
  bonificacion_cent bigint not null default 0 check (bonificacion_cent >= 0),
  -- Con signo: lo que se suma a la utilidad operativa del periodo porque la nota no lo recoge (negativo = perdida; positivo = perdida recuperada de un socio).
  ajuste_utilidad_cent bigint not null default 0,
  reposicion_guia_id bigint references operacion.guia (id),
  nota_id bigint references operacion.nota (id),
  motivo text not null check (nullif(btrim(motivo), '') is not null),
  fecha_neg date not null,
  resuelto_por uuid,
  resuelto_at timestamptz not null default now(),
  evento_id bigint not null references operacion.evento (id),
  check ((responsable = 'socio') = (socio_id is not null))
);

do $$
declare t text;
begin
  foreach t in array array['paquete_incidente', 'paquete_incidente_linea', 'paquete_incidente_resolucion'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on operacion.%I from postgres', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Tipos de aviso (el catalogo manda; operacion.avisar rechaza todo codigo desconocido). Se entregan por el flujo existente: nada real se envia sin token del bot.
insert into notificacion.tipo (codigo, nt, titulo, severidad, requiere_accion, no_silenciable, canal, dominio, agrupable, ttl_horas, fase, botones, campos_permitidos, activo) values
  ('paquete_incidente_reportado', 'NT-080', 'Paquete perdido o danado: falta decidir quien absorbe la perdida', 'I', true, false, 'ST', 'PAQ', false, 720, 'F2', array['Resolver', 'Abrir en el software']::text[], array['folio', 'tipo', 'sentido', 'piezas']::text[], true),
  ('paquete_incidente_resuelto', 'NT-081', 'Paquete perdido o danado resuelto: responsable y efecto registrados', 'F', false, false, 'ST', 'PAQ', false, 720, 'F2', array['Ver detalle']::text[], array['folio', 'responsable', 'sentido']::text[], true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- Ayudas
-- ---------------------------------------------------------------------------
-- Resuelto: salida = hay resolucion; entrada = toda diferencia vinculada tiene una asignacion vigente (castigo, reposicion, socio o proveedor).
create function operacion.paquete_incidente_resuelto(p_incidente bigint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case i.sentido
    when 'salida' then exists (select 1 from operacion.paquete_incidente_resolucion r where r.incidente_id = i.id)
    else not exists (
      select 1 from operacion.paquete_incidente_linea l
       where l.incidente_id = i.id and l.diferencia_id is not null
         and not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = l.diferencia_id and x.cancela_a is null
                           and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id)))
  end
  from operacion.paquete_incidente i where i.id = p_incidente
$$;

-- Lo que las perdidas de paquetes suman a la utilidad operativa del periodo y las notas NO recogen (la cascada 50/50 la usa).
--   salida: el ajuste con signo de cada resolucion + la guia de una reposicion mientras ninguna nota posterior la haya contado;
--   entrada: faltantes castigados por la sociedad (resueltos por este flujo o por la pantalla de la compra).
create function operacion.ajuste_utilidad_paquetes(p_ini date, p_fin date) returns bigint
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(r.ajuste_utilidad_cent) from operacion.paquete_incidente_resolucion r join operacion.paquete_incidente i on i.id = r.incidente_id
               where i.sentido = 'salida' and r.fecha_neg between p_ini and p_fin), 0)
    - coalesce((select sum(l.valor_cent) from operacion.paquete_incidente_linea l join operacion.paquete_incidente i on i.id = l.incidente_id
                  join operacion.diferencia_asignacion a on a.diferencia_id = l.diferencia_id and a.responsable = 'castigo'
                 where i.sentido = 'entrada' and negocio.fecha_neg(a.creado_at) between p_ini and p_fin), 0)
    - coalesce((select sum(g.costo_cent) from operacion.paquete_incidente_resolucion r join operacion.guia g on g.id = r.reposicion_guia_id
                 where g.costo_cent is not null and g.fecha_neg between p_ini and p_fin
                   and not exists (select 1 from operacion.nota n where n.pedido_id = g.pedido_id and n.evento_id > g.evento_id)), 0)
  )::bigint
$$;

-- La cascada y su 'Explicar este numero' leen operacion.utilidad_periodo: se envuelve (mismo patron que explicar_cifra) para que las perdidas entren a la
-- utilidad del periodo (y por tanto se reparten 50/50 y se arrastran). El ajuste va dentro de los gastos para que 'pedidos + tomas - gastos' siga cuadrando.
alter function operacion.utilidad_periodo(date, date) rename to utilidad_periodo_sin_paquetes;
create function operacion.utilidad_periodo(p_ini date, p_fin date) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb := operacion.utilidad_periodo_sin_paquetes(p_ini, p_fin); v_aj bigint := operacion.ajuste_utilidad_paquetes(p_ini, p_fin);
begin
  return v || jsonb_build_object('ajuste_paquetes_cent', v_aj, 'gastos_cent', (v->>'gastos_cent')::bigint - v_aj, 'utilidad_cent', (v->>'utilidad_cent')::bigint + v_aj);
end $$;

-- ---------------------------------------------------------------------------
-- Reportar: SALIDA (pedido ya enviado). p_lineas = [{linea_id, sku_id?, piezas}] con las piezas surtidas que se perdieron o llegaron danadas.
-- ---------------------------------------------------------------------------
create function operacion.reportar_paquete_salida(p_clave_idem text, p_pedido bigint, p_tipo text, p_detalle text, p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; ped operacion.pedido; v_ev bigint; v_id bigint; x jsonb; v_linea bigint; v_sku bigint; v_pz int; v_surt int; v_costo bigint; v_ya int; v_modelo bigint; v_val bigint;
  v_total_pz int := 0; v_total_val bigint := 0; v_folio text; v_res jsonb; v_cli text;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reportar_paquete_salida', 'p', p_pedido, 't', p_tipo, 'd', p_detalle, 'l', p_lineas));
  if v_prev is not null then return v_prev; end if;
  if p_tipo not in ('perdido', 'danado') then raise exception 'tipo invalido: perdido o danado' using errcode = '22023'; end if;
  if nullif(btrim(p_detalle), '') is null then raise exception 'el reporte exige un detalle (que paso)' using errcode = '23502'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'indica las piezas afectadas' using errcode = '22023'; end if;
  select * into ped from operacion.pedido where id = p_pedido for update;
  if not found then raise exception 'pedido desconocido' using errcode = '22023'; end if;
  if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: solo un pedido enviado puede reportar un paquete perdido o danado', ped.folio, ped.estado using errcode = 'P0428'; end if;
  if not operacion.origen_es_bodega(ped.origen) then raise exception 'el pedido % sale directo del proveedor: el reclamo se hace con el proveedor, no con la bodega', ped.folio using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('paquete_incidente', negocio.hoy(), p_clave_idem, jsonb_build_object('pedido', ped.folio, 'tipo', p_tipo, 'sentido', 'salida'));
  insert into operacion.paquete_incidente (sentido, tipo, pedido_id, detalle, fecha_neg, reportado_por, evento_id) values ('salida', p_tipo, ped.id, btrim(p_detalle), negocio.hoy(), auth.uid(), v_ev)
    returning id, folio into v_id, v_folio;
  for x in select * from jsonb_array_elements(p_lineas) loop
    v_linea := (x->>'linea_id')::bigint; v_pz := (x->>'piezas')::int;
    if v_linea is null or v_pz is null or v_pz <= 0 then raise exception 'cada renglon necesita linea y piezas positivas' using errcode = '22023'; end if;
    select coalesce((x->>'sku_id')::bigint, l.sku_id), l.modelo_id into v_sku, v_modelo from operacion.pedido_linea l where l.id = v_linea and l.pedido_id = ped.id;
    if v_sku is null then raise exception 'el renglon % no es de este pedido', v_linea using errcode = '22023'; end if;
    select coalesce(sum(s.piezas), 0)::int, coalesce(sum(s.costo_valor_cent), 0)::bigint into v_surt, v_costo from operacion.pedido_surtido s where s.pedido_linea_id = v_linea and s.sku_id = v_sku;
    select coalesce(sum(il.piezas), 0)::int into v_ya from operacion.paquete_incidente_linea il join operacion.paquete_incidente i on i.id = il.incidente_id
      where il.pedido_linea_id = v_linea and il.sku_id = v_sku and il.incidente_id <> v_id;
    if v_surt = 0 then raise exception 'de ese renglon y sabor no salio ninguna pieza' using errcode = '22023'; end if;
    if exists (select 1 from operacion.paquete_incidente_linea il where il.incidente_id = v_id and il.pedido_linea_id = v_linea and il.sku_id = v_sku) then raise exception 'renglon repetido en el reporte' using errcode = '22023'; end if;
    if v_pz + v_ya > v_surt then raise exception 'solo salieron % pz de ese renglon y ya hay % reportadas', v_surt, v_ya using errcode = '23514'; end if;
    v_val := negocio.redondear_medio_arriba(v_costo * v_pz, v_surt);
    insert into operacion.paquete_incidente_linea (incidente_id, sku_id, modelo_id, piezas, valor_cent, pedido_linea_id) values (v_id, v_sku, v_modelo, v_pz, v_val, v_linea);
    v_total_pz := v_total_pz + v_pz; v_total_val := v_total_val + v_val;
  end loop;
  select nombre_canonico into v_cli from catalogo.cliente where id = ped.cliente_id;
  perform operacion.avisar('paquete_incidente_reportado', 'NT-080', 'paquete_incidente:' || v_id, 'I',
    'Paquete ' || case p_tipo when 'perdido' then 'perdido' else 'danado' end || ' ' || v_folio || ': ' || v_total_pz || ' pz del pedido ' || ped.folio || ' (' || v_cli || ')',
    'paquete_incidente', v_id, jsonb_build_object('folio', v_folio, 'tipo', p_tipo, 'sentido', 'salida', 'piezas', v_total_pz), ped.duenio_id, v_ev, false, array['software', 'telegram']);
  v_res := jsonb_build_object('incidente_id', v_id, 'folio', v_folio, 'sentido', 'salida', 'piezas', v_total_pz, 'valor_cent', v_total_val);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Reportar: ENTRADA (orden de compra en camino). p_recibido = lo que llego sano [{linea_id, sabor, piezas}]; vacio = no llego nada.
-- ---------------------------------------------------------------------------
create function operacion.reportar_paquete_entrada(p_clave_idem text, p_compra bigint, p_tipo text, p_detalle text, p_recibido jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; c operacion.compra; v_rec jsonb; v_ev bigint; v_id bigint; v_folio text; d record; v_pz int := 0; v_val bigint := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'reportar_paquete_entrada', 'c', p_compra, 't', p_tipo, 'd', p_detalle, 'r', p_recibido));
  if v_prev is not null then return v_prev; end if;
  if p_tipo not in ('perdido', 'danado') then raise exception 'tipo invalido: perdido o danado' using errcode = '22023'; end if;
  if nullif(btrim(p_detalle), '') is null then raise exception 'el reporte exige un detalle (que paso)' using errcode = '23502'; end if;
  if jsonb_typeof(coalesce(p_recibido, '[]'::jsonb)) <> 'array' then raise exception 'recepcion invalida' using errcode = '22023'; end if;
  select * into c from operacion.compra where id = p_compra for update;
  if not found then raise exception 'compra desconocida' using errcode = '22023'; end if;
  if c.estado not in ('confirmada', 'enviada', 'en_trayecto', 'llego_merida') or c.destino <> 'bodega' then
    raise exception 'la compra % esta %: solo una orden en camino a la bodega puede reportar un paquete perdido o danado', c.folio, c.estado using errcode = 'P0428';
  end if;
  -- Confirma la recepcion con lo sano; lo que falta nace como diferencia de recepcion (con su aviso) y se vincula al incidente.
  v_rec := operacion.recibir_compra(p_clave_idem || ':recibir', c.id, coalesce(p_recibido, '[]'::jsonb));
  if (v_rec->>'diferencias')::int = 0 then raise exception 'no hay piezas afectadas: lo que llego sano iguala lo facturado' using errcode = '23514'; end if;
  v_ev := operacion.crear_evento('paquete_incidente', negocio.hoy(), p_clave_idem, jsonb_build_object('compra', c.folio, 'tipo', p_tipo, 'sentido', 'entrada'));
  insert into operacion.paquete_incidente (sentido, tipo, compra_id, detalle, fecha_neg, reportado_por, evento_id) values ('entrada', p_tipo, c.id, btrim(p_detalle), negocio.hoy(), auth.uid(), v_ev)
    returning id, folio into v_id, v_folio;
  for d in select df.id, df.piezas, df.valor_cent, cl.id as linea_id, cl.sku_id, cl.modelo_id from operacion.compra_diferencia df join operacion.compra_linea cl on cl.id = df.compra_linea_id
            where df.compra_id = c.id and df.tipo = 'faltante' order by df.id loop
    insert into operacion.paquete_incidente_linea (incidente_id, sku_id, modelo_id, piezas, valor_cent, compra_linea_id, diferencia_id) values (v_id, d.sku_id, d.modelo_id, d.piezas, d.valor_cent, d.linea_id, d.id);
    perform operacion.resolver_avisos('diferencia_recepcion_abierta', 'compra_diferencia', d.id);
    v_pz := v_pz + d.piezas; v_val := v_val + d.valor_cent;
  end loop;
  if v_pz = 0 then raise exception 'no hay faltantes que reportar: solo hubo sobrantes' using errcode = '23514'; end if;
  perform operacion.avisar('paquete_incidente_reportado', 'NT-080', 'paquete_incidente:' || v_id, 'I',
    'Paquete ' || case p_tipo when 'perdido' then 'perdido' else 'danado' end || ' ' || v_folio || ': ' || v_pz || ' pz de la orden ' || c.folio,
    'paquete_incidente', v_id, jsonb_build_object('folio', v_folio, 'tipo', p_tipo, 'sentido', 'entrada', 'piezas', v_pz), null, v_ev, false, array['software', 'telegram']);
  v_res := jsonb_build_object('incidente_id', v_id, 'folio', v_folio, 'sentido', 'entrada', 'piezas', v_pz, 'valor_cent', v_val, 'piezas_sanas', (v_rec->>'piezas_recibidas')::int);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Resolver: quien absorbe la perdida y que pasa con el cliente.
--   p_responsable: sociedad | socio (p_socio) | proveedor (solo entrada) | cliente (solo salida).
--   p_accion (solo salida con responsable sociedad o socio): reponer | bonificar. p_guia (solo reponer): {paqueteria, numero, costo_cent?, pagada_por?}.
-- ---------------------------------------------------------------------------
create function operacion.resolver_paquete_incidente(p_clave_idem text, p_incidente bigint, p_responsable text, p_socio text default null, p_accion text default null,
                                                     p_motivo text default null, p_guia jsonb default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; i operacion.paquete_incidente; ped operacion.pedido; ult operacion.nota; ln record; d record; v_socio bigint; v_ev bigint; v_res jsonb; v_valor bigint; v_accion text;
  v_absorbe bigint := 0; v_recup bigint := 0; v_bonif bigint := 0; v_ajuste bigint := 0; v_l bigint := 0; v_mov bigint; v_guia bigint; v_nota bigint; v_folio_compra text; v_estado_compra text;
  v_lineas jsonb; v_csm bigint := 0;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'resolver_paquete_incidente', 'i', p_incidente, 'r', p_responsable, 's', p_socio, 'a', p_accion, 'm', p_motivo, 'g', p_guia));
  if v_prev is not null then return v_prev; end if;
  if p_responsable not in ('sociedad', 'socio', 'proveedor', 'cliente') then raise exception 'responsable invalido (sociedad, socio, proveedor o cliente)' using errcode = '22023'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'resolver exige un motivo' using errcode = '23502'; end if;
  select * into i from operacion.paquete_incidente where id = p_incidente for update;
  if not found then raise exception 'incidente desconocido' using errcode = '22023'; end if;
  if exists (select 1 from operacion.paquete_incidente_resolucion r where r.incidente_id = i.id) or operacion.paquete_incidente_resuelto(i.id) then
    raise exception 'el incidente % ya tiene resolucion', i.folio using errcode = 'P0428';
  end if;
  if p_responsable = 'socio' then
    select id into v_socio from catalogo.socio where nombre = p_socio;
    if v_socio is null then raise exception 'indica el socio responsable' using errcode = '22023'; end if;
  end if;
  select coalesce(sum(valor_cent), 0)::bigint into v_valor from operacion.paquete_incidente_linea where incidente_id = i.id;

  if i.sentido = 'entrada' then
    if p_responsable = 'cliente' then raise exception 'un paquete que viene del proveedor no tiene cliente responsable' using errcode = '22023'; end if;
    for d in select l.diferencia_id from operacion.paquete_incidente_linea l where l.incidente_id = i.id and l.diferencia_id is not null order by l.id loop
      if p_responsable = 'sociedad' then perform operacion.resolver_diferencia(p_clave_idem || ':d' || d.diferencia_id, d.diferencia_id, 'castigar', p_motivo);
      elsif p_responsable = 'socio' then perform operacion.asignar_diferencia(p_clave_idem || ':d' || d.diferencia_id, d.diferencia_id, 'socio', p_socio, p_motivo);
      else perform operacion.asignar_diferencia(p_clave_idem || ':d' || d.diferencia_id, d.diferencia_id, 'proveedor', null, p_motivo); end if;
    end loop;
    v_accion := case p_responsable when 'sociedad' then 'castigar' when 'socio' then 'asignar' else 'reclamar' end;
    v_absorbe := case when p_responsable = 'sociedad' then v_valor else 0 end;
    v_recup := case when p_responsable = 'sociedad' then 0 else v_valor end;
    v_ajuste := 0; -- el castigo de una entrada se lee de la asignacion de la diferencia (ajuste_utilidad_paquetes)
    select co.estado into v_estado_compra from operacion.compra co where co.id = i.compra_id;
    if v_estado_compra = 'recibida' then perform operacion.cerrar_compra(p_clave_idem || ':cerrar', i.compra_id); end if;
    v_ev := operacion.crear_evento('paquete_incidente_resuelto', negocio.hoy(), p_clave_idem, jsonb_build_object('incidente', i.folio, 'responsable', p_responsable, 'sentido', 'entrada'));
  else
    if p_responsable = 'proveedor' then raise exception 'un paquete que sale de la bodega no se reclama al proveedor: el responsable es la sociedad, un socio o el cliente' using errcode = '22023'; end if;
    select * into ped from operacion.pedido where id = i.pedido_id for update;
    if ped.estado <> 'enviado' then raise exception 'el pedido % esta %: ya no se puede resolver el paquete', ped.folio, ped.estado using errcode = 'P0428'; end if;
    if p_responsable = 'cliente' then
      if coalesce(p_accion, 'ninguna') <> 'ninguna' or p_guia is not null then raise exception 'si el cliente asume la perdida no hay reposicion, guia ni bonificacion' using errcode = '22023'; end if;
      v_accion := 'ninguna';
    else
      if p_accion is null or p_accion not in ('reponer', 'bonificar') then raise exception 'elige que pasa con el cliente: reponer o bonificar' using errcode = '22023'; end if;
      if p_accion = 'bonificar' and p_guia is not null then raise exception 'la guia solo aplica a una reposicion' using errcode = '22023'; end if;
      v_accion := p_accion;
    end if;
    v_ev := operacion.crear_evento('paquete_incidente_resuelto', negocio.hoy(), p_clave_idem, jsonb_build_object('incidente', i.folio, 'responsable', p_responsable, 'sentido', 'salida', 'accion', v_accion));

    if v_accion = 'reponer' then
      -- La reposicion sale de la existencia como merma al costo promedio: es la perdida real (no se vuelve a contar el costo de la venta original).
      for ln in select l.sku_id, l.modelo_id, sum(l.piezas)::int as piezas from operacion.paquete_incidente_linea l where l.incidente_id = i.id group by l.sku_id, l.modelo_id order by l.sku_id loop
        insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, evento_id, nota)
          values (negocio.hoy(), ln.sku_id, ln.modelo_id, 'bodega_omar', 'merma', -ln.piezas, v_ev, 'Reposicion de ' || i.folio) returning -valor_cent into v_mov;
        v_l := v_l + v_mov;
      end loop;
      if p_guia is not null then
        if nullif(btrim(p_guia->>'numero'), '') is null then raise exception 'la guia de la reposicion necesita su numero' using errcode = '23502'; end if;
        insert into operacion.guia (sentido, paqueteria, numero, pedido_id, fecha_neg, evento_id)
          values ('salida', coalesce(nullif(btrim(p_guia->>'paqueteria'), ''), 'Paqueteria'), btrim(p_guia->>'numero'), ped.id, negocio.hoy(), v_ev) returning id into v_guia;
        -- La guia del reenvio es un gasto real nuevo, UNA sola vez (costear_guia exige null -> valor). La guia original no se toca ni se cuenta como perdida.
        if (p_guia->>'costo_cent') is not null then perform operacion.costear_guia(v_guia, (p_guia->>'costo_cent')::bigint, p_guia->>'pagada_por', v_ev); end if;
      end if;
      v_absorbe := case when p_responsable = 'sociedad' then v_l else 0 end;
      v_recup := case when p_responsable = 'socio' then v_l else 0 end;
      v_ajuste := case when p_responsable = 'sociedad' then -v_l else 0 end;
      v_csm := case when p_responsable = 'socio' then v_l else 0 end;
      v_lineas := case when p_responsable = 'socio' then jsonb_build_array(
        jsonb_build_object('cuenta', '1340', 'debe_cent', v_l, 'nota', 'Faltante de ' || i.folio || ' que paga ' || p_socio),
        jsonb_build_object('cuenta', '5200', 'haber_cent', v_l, 'nota', 'La perdida de ' || i.folio || ' se cobra a ' || p_socio)) end;
    elsif v_accion = 'bonificar' then
      -- El cliente no paga esas piezas: la nota se corrige con un descuento (la nota original no cambia). El costo ya salio como costo de ventas: se reclasifica a perdida.
      select * into ult from operacion.nota where pedido_id = ped.id order by id desc limit 1;
      select coalesce(sum(l.piezas * coalesce((ult.ajustes->'precios'->>(pl.id::text))::bigint, pl.precio_cent)), 0)::bigint into v_bonif
        from operacion.paquete_incidente_linea l join operacion.pedido_linea pl on pl.id = l.pedido_linea_id where l.incidente_id = i.id;
      perform operacion.emitir_correccion(p_clave_idem || ':nota', ped.id, 'Bonificacion por ' || i.folio || ' (paquete ' || case i.tipo when 'perdido' then 'perdido' else 'danado' end || '): ' || btrim(p_motivo), null, null,
        coalesce((ult.ajustes->>'descuento_cent')::bigint, ped.descuento_cent) + v_bonif, null);
      select max(id) into v_nota from operacion.nota where pedido_id = ped.id;
      v_absorbe := case when p_responsable = 'sociedad' then v_valor else 0 end;
      v_recup := case when p_responsable = 'socio' then v_valor else 0 end;
      v_ajuste := case when p_responsable = 'socio' then v_valor else 0 end; -- la nota ya resta el costo; si lo paga un socio se devuelve a la utilidad
      v_csm := case when p_responsable = 'socio' then v_valor else 0 end;
      v_lineas := case when v_valor = 0 then null
                       when p_responsable = 'socio' then jsonb_build_array(
                         jsonb_build_object('cuenta', '1340', 'debe_cent', v_valor, 'nota', 'Faltante de ' || i.folio || ' que paga ' || p_socio),
                         jsonb_build_object('cuenta', '5100', 'haber_cent', v_valor, 'nota', 'Costo de lo perdido en ' || i.folio))
                       else jsonb_build_array(
                         jsonb_build_object('cuenta', '5200', 'debe_cent', v_valor, 'nota', 'Merma por ' || i.folio || ' absorbida por la sociedad'),
                         jsonb_build_object('cuenta', '5100', 'haber_cent', v_valor, 'nota', 'Costo de lo perdido en ' || i.folio)) end;
    end if;

    if v_csm > 0 then
      -- Cuenta por cobrar al socio (adenda 29): baja cuando el socio la liquida o se compensa en la cascada.
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
        values (v_socio, negocio.hoy(), 'diferencia_recepcion', 'diferencia', v_csm, 'Paquete ' || i.folio || ' perdido o danado', v_ev);
    end if;
    if v_lineas is not null then
      perform contabilidad.registrar_asiento_manual(p_clave_idem || ':asiento', negocio.hoy(), 'Paquete ' || i.folio || ': ' || btrim(p_motivo), v_lineas);
    end if;
  end if;

  insert into operacion.paquete_incidente_resolucion (incidente_id, responsable, socio_id, accion, absorbe_sociedad_cent, recuperable_cent, bonificacion_cent, ajuste_utilidad_cent,
                                                     reposicion_guia_id, nota_id, motivo, fecha_neg, resuelto_por, evento_id)
    values (i.id, p_responsable, v_socio, v_accion, v_absorbe, v_recup, v_bonif, v_ajuste, v_guia, v_nota, btrim(p_motivo), negocio.hoy(), auth.uid(), v_ev);
  perform operacion.resolver_avisos('paquete_incidente_reportado', 'paquete_incidente', i.id);
  perform operacion.avisar('paquete_incidente_resuelto', 'NT-081', 'paquete_incidente_resuelto:' || i.id, 'F',
    'Paquete ' || i.folio || ' resuelto: ' || case p_responsable when 'sociedad' then 'lo absorbe la sociedad (50/50)' when 'socio' then 'lo paga ' || p_socio when 'proveedor' then 'reclamo al proveedor' else 'lo asume el cliente' end,
    'paquete_incidente', i.id, jsonb_build_object('folio', i.folio, 'responsable', p_responsable, 'sentido', i.sentido), null, v_ev, false, array['software', 'telegram']);
  v_res := jsonb_build_object('incidente_id', i.id, 'folio', i.folio, 'responsable', p_responsable, 'accion', v_accion, 'absorbe_sociedad_cent', v_absorbe, 'recuperable_cent', v_recup,
                              'bonificacion_cent', v_bonif, 'ajuste_utilidad_cent', v_ajuste);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Si la diferencia se asigna desde la pantalla de la compra (sin pasar por este flujo), el aviso del incidente tambien se cierra al quedar todo resuelto.
create function operacion.t_paquete_incidente_aviso() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select distinct l.incidente_id from operacion.paquete_incidente_linea l where l.diferencia_id = new.diferencia_id loop
    if operacion.paquete_incidente_resuelto(r.incidente_id) then perform operacion.resolver_avisos('paquete_incidente_reportado', 'paquete_incidente', r.incidente_id); end if;
  end loop;
  return null;
end $$;
create trigger diferencia_asignacion_paquete_aviso after insert on operacion.diferencia_asignacion for each row execute function operacion.t_paquete_incidente_aviso();

-- ---------------------------------------------------------------------------
-- Lecturas para la web (rol socio)
-- ---------------------------------------------------------------------------
create function api.paquetes_incidentes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_filas jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  select coalesce(jsonb_agg(q.x order by (q.x->>'estado') = 'resuelto', q.id desc), '[]'::jsonb) into v_filas from (
    select i.id, jsonb_build_object(
      'id', i.id, 'folio', i.folio, 'sentido', i.sentido, 'tipo', i.tipo, 'estado', case when operacion.paquete_incidente_resuelto(i.id) then 'resuelto' else 'abierto' end,
      'detalle', i.detalle, 'fecha_neg', i.fecha_neg, 'reportado_at', i.reportado_at, 'horas', greatest(floor(extract(epoch from now() - i.reportado_at) / 3600), 0)::int,
      'pedido_id', i.pedido_id, 'pedido_folio', pe.folio, 'compra_id', i.compra_id, 'compra_folio', co.folio,
      'cliente', cl.nombre_canonico, 'proveedor', pv.nombre,
      'piezas', (select sum(l.piezas) from operacion.paquete_incidente_linea l where l.incidente_id = i.id)::int,
      'valor_cent', (select sum(l.valor_cent) from operacion.paquete_incidente_linea l where l.incidente_id = i.id)::bigint,
      'renglones', (select jsonb_agg(jsonb_build_object('modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', l.piezas, 'valor_cent', l.valor_cent) order by m.nombre_canonico, sa.nombre_canonico)
                      from operacion.paquete_incidente_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.incidente_id = i.id),
      'resolucion', (select jsonb_build_object('responsable', r.responsable, 'socio', s.nombre, 'accion', r.accion, 'absorbe_sociedad_cent', r.absorbe_sociedad_cent, 'recuperable_cent', r.recuperable_cent,
                                                 'bonificacion_cent', r.bonificacion_cent, 'ajuste_utilidad_cent', r.ajuste_utilidad_cent, 'motivo', r.motivo, 'fecha_neg', r.fecha_neg,
                                                 'guia', (select jsonb_build_object('paqueteria', g.paqueteria, 'numero', g.numero, 'costo_cent', g.costo_cent) from operacion.guia g where g.id = r.reposicion_guia_id))
                       from operacion.paquete_incidente_resolucion r left join catalogo.socio s on s.id = r.socio_id where r.incidente_id = i.id),
      -- Entrada: responsable VIGENTE leido de la asignacion de la diferencia (puede haberse reasignado desde la compra).
      'responsable_vigente', (select case when count(distinct v.resp) = 1 then min(v.resp) when count(*) = 0 then null else 'mixto' end
                                from (select case a.responsable when 'castigo' then 'sociedad' when 'reposicion' then 'proveedor' else a.responsable end as resp
                                        from operacion.paquete_incidente_linea l join operacion.diferencia_asignacion a on a.diferencia_id = l.diferencia_id and a.cancela_a is null
                                         and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = a.id)
                                       where l.incidente_id = i.id) v),
      'guias', coalesce((select jsonb_agg(jsonb_build_object('paqueteria', g.paqueteria, 'numero', g.numero) order by g.id) from operacion.guia g where (g.pedido_id = i.pedido_id and i.pedido_id is not null) or (g.compra_id = i.compra_id and i.compra_id is not null)), '[]'::jsonb)
    ) as x
    from operacion.paquete_incidente i
    left join operacion.pedido pe on pe.id = i.pedido_id left join catalogo.cliente cl on cl.id = pe.cliente_id
    left join operacion.compra co on co.id = i.compra_id left join catalogo.proveedor pv on pv.id = co.proveedor_id) q;
  return jsonb_build_object('incidentes', v_filas);
end $$;

-- Renglones de un pedido enviado para reportar el paquete: surtido por sabor, menos lo ya reportado.
create function api.paquete_salida_lineas(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('linea_id', q.linea_id, 'sku_id', q.sku_id, 'modelo', q.modelo, 'sabor', q.sabor, 'surtidas', q.surtidas, 'reportadas', q.reportadas) order by q.modelo, q.sabor)
    from (select s.pedido_linea_id as linea_id, s.sku_id, m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(s.piezas)::int as surtidas,
                 coalesce((select sum(il.piezas) from operacion.paquete_incidente_linea il where il.pedido_linea_id = s.pedido_linea_id and il.sku_id = s.sku_id), 0)::int as reportadas
            from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id join catalogo.sku k on k.id = s.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
           where l.pedido_id = p_pedido group by s.pedido_linea_id, s.sku_id, m.nombre_canonico, sa.nombre_canonico) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Envoltorios api.* de las tres funciones de escritura (rol socio) y permisos
-- ---------------------------------------------------------------------------
do $$
declare f record; v_call text;
begin
  for f in
    select p.proname, pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as ident, p.proargnames
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'operacion' and p.proname = any (array['reportar_paquete_salida', 'reportar_paquete_entrada', 'resolver_paquete_incidente'])
  loop
    v_call := (select string_agg(format('%1$I => %1$I', n), ', ') from unnest(f.proargnames) n);
    execute format('create function api.%I(%s) returns jsonb language plpgsql security definer set search_path = '''' as $f$ begin perform seguridad.exigir_rol(array[''socio'']); return operacion.%I(%s); end $f$',
                   f.proname, f.args, f.proname, v_call);
    execute format('revoke execute on function api.%I(%s) from public, anon', f.proname, f.ident);
    execute format('grant execute on function api.%I(%s) to authenticated', f.proname, f.ident);
  end loop;
end $$;
revoke execute on function api.paquetes_incidentes(), api.paquete_salida_lineas(bigint) from public, anon;
grant execute on function api.paquetes_incidentes(), api.paquete_salida_lineas(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 'Explicar este numero': paquete:valor:<id> (costo de lo perdido) y paquete:absorbe:<id> (lo que absorbe la sociedad). Dos vias independientes.
-- ---------------------------------------------------------------------------
alter function api.explicar_cifra(text) rename to explicar_cifra_sin_paquetes;
create function api.explicar_cifra(p_cifra text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  partes text[] := string_to_array(p_cifra, ':'); i operacion.paquete_incidente; r operacion.paquete_incidente_resolucion; v_rengs jsonb; v_via1 bigint; v_via2 bigint; v_tit text;
begin
  if partes[1] <> 'paquete' then return api.explicar_cifra_sin_paquetes(p_cifra); end if;
  perform seguridad.exigir_rol(array['socio']);
  select * into i from operacion.paquete_incidente where id = nullif(partes[3], '')::bigint;
  if not found then raise exception 'incidente desconocido' using errcode = '22023'; end if;
  if partes[2] = 'valor' then
    select coalesce(jsonb_agg(jsonb_build_object('concepto', m.nombre_canonico || ' ' || sa.nombre_canonico || ': ' || l.piezas || ' pz', 'monto_cent', l.valor_cent) order by l.id), '[]'::jsonb), coalesce(sum(l.valor_cent), 0)::bigint
      into v_rengs, v_via1
      from operacion.paquete_incidente_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where l.incidente_id = i.id;
    -- Segunda via: se recalcula desde el hecho de origen (el surtido del pedido o la diferencia de recepcion), sin leer lo guardado en el incidente.
    if i.sentido = 'salida' then
      select coalesce(sum(negocio.redondear_medio_arriba(q.costo * l.piezas, q.surtidas)), 0)::bigint into v_via2
        from operacion.paquete_incidente_linea l
        join lateral (select sum(s.piezas)::bigint as surtidas, sum(s.costo_valor_cent)::bigint as costo from operacion.pedido_surtido s where s.pedido_linea_id = l.pedido_linea_id and s.sku_id = l.sku_id) q on true
       where l.incidente_id = i.id;
    else
      select coalesce(sum(df.valor_cent), 0)::bigint into v_via2 from operacion.paquete_incidente_linea l join operacion.compra_diferencia df on df.id = l.diferencia_id where l.incidente_id = i.id;
    end if;
    return jsonb_build_object('cifra', p_cifra, 'titulo', 'Costo de lo perdido o danado en ' || i.folio, 'valor', v_via1, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Suma de los renglones del incidente', 'via1_valor', v_via1,
                                         'via2', case when i.sentido = 'salida' then 'Costo del surtido del pedido, pieza por pieza' else 'Diferencia de recepcion de la orden' end, 'via2_valor', v_via2, 'cuadra', v_via1 = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  elsif partes[2] = 'absorbe' then
    select * into r from operacion.paquete_incidente_resolucion where incidente_id = i.id;
    if not found then raise exception 'el incidente aun no tiene resolucion' using errcode = '22023'; end if;
    v_tit := 'Lo que absorbe la sociedad por ' || i.folio || ' (se reparte 50/50 en la utilidad)';
    v_rengs := jsonb_build_array(jsonb_build_object('concepto', 'Responsable: ' || case r.responsable when 'sociedad' then 'la sociedad' when 'socio' then 'socio (se le cobra)' when 'proveedor' then 'proveedor (reclamo)' else 'cliente' end, 'monto_cent', r.absorbe_sociedad_cent),
                                 jsonb_build_object('concepto', 'Por cobrar al responsable', 'monto_cent', r.recuperable_cent));
    -- Segunda via: valor del incidente si lo absorbe la sociedad (bonificacion/castigo) o costo de las mermas del evento de resolucion (reposicion).
    v_via2 := case when r.responsable <> 'sociedad' then 0
                   when r.accion = 'reponer' then coalesce((select -sum(mi.valor_cent) from operacion.movimiento_inventario mi where mi.evento_id = r.evento_id and mi.tipo = 'merma'), 0)::bigint
                   else coalesce((select sum(l.valor_cent) from operacion.paquete_incidente_linea l where l.incidente_id = i.id), 0)::bigint end;
    return jsonb_build_object('cifra', p_cifra, 'titulo', v_tit, 'valor', r.absorbe_sociedad_cent, 'unidad', 'mxn',
      'comprobacion', jsonb_build_object('via1', 'Resolucion registrada', 'via1_valor', r.absorbe_sociedad_cent, 'via2', 'Recalculado desde los hechos de la resolucion', 'via2_valor', v_via2, 'cuadra', r.absorbe_sociedad_cent = v_via2),
      'renglones', v_rengs, 'movimientos', '[]'::jsonb);
  end if;
  raise exception 'cifra de paquete desconocida' using errcode = '22023';
end $$;
revoke execute on function api.explicar_cifra(text) from public, anon;
grant execute on function api.explicar_cifra(text) to authenticated;
revoke execute on function api.explicar_cifra_sin_paquetes(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Vista de Omar (mi-bodega): un paquete por recibir con incidente abierto se ve como 'incidente' (solo modelo, sabor y piezas; sin dinero ni proveedor).
-- Misma funcion de omar.mis_paquetes con una rama mas; el resto no cambia.
-- ---------------------------------------------------------------------------
create or replace function omar.mis_paquetes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['omar']);
  return coalesce((
    select jsonb_agg(x order by (case x->>'tipo' when 'salida' then 0 else 1 end), (x->>'consecutivo')::int) from (
      select jsonb_build_object('consecutivo', row_number() over (order by b.base, b.id), 'tipo', 'salida',
                                'estado', case when b.empacado then 'empacado' else 'por_empacar' end,
                                'horas', greatest(floor(extract(epoch from now() - b.base) / 3600), 0)::int, 'llegada_estimada', null,
                                'renglones', coalesce((select jsonb_agg(jsonb_build_object('modelo', g.modelo, 'sabor', g.sabor, 'piezas', g.piezas) order by g.modelo, g.sabor)
                                                         from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_pedidas)::int as piezas
                                                                 from operacion.pedido_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                                                                where l.pedido_id = b.id group by m.nombre_canonico, sa.nombre_canonico) g), '[]'::jsonb)) as x
      from (select pe.id, pe.empacado_at is not null as empacado,
                   coalesce((select min(a.creado_at) from operacion.aviso a where a.codigo = 'paquete_por_empacar' and a.entidad_tipo = 'pedido' and a.entidad_id = pe.id), pe.creado_at) as base
              from operacion.pedido pe where pe.estado = 'confirmado' and operacion.origen_es_bodega(pe.origen)) b
      union all
      select jsonb_build_object('consecutivo', row_number() over (order by b.base, b.id), 'tipo', 'entrada',
                                'estado', case when b.incidente then 'incidente' when b.estado = 'llego_merida' then 'llego' else 'en_trayecto' end,
                                'horas', null, 'llegada_estimada', b.llegada_estimada,
                                'renglones', coalesce((select jsonb_agg(jsonb_build_object('modelo', g.modelo, 'sabor', g.sabor, 'piezas', g.piezas) order by g.modelo, g.sabor)
                                                         from (select m.nombre_canonico as modelo, sa.nombre_canonico as sabor, sum(l.piezas_facturadas)::int as piezas
                                                                 from operacion.compra_linea l join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id
                                                                where l.compra_id = b.id group by m.nombre_canonico, sa.nombre_canonico) g), '[]'::jsonb))
      from (select c.id, c.estado, c.llegada_estimada, coalesce(c.enviada_fecha::timestamptz, c.creado_at) as base, false as incidente
              from operacion.compra c where c.destino = 'bodega' and c.estado in ('enviada', 'en_trayecto', 'llego_merida')
            union all
            select c.id, c.estado, c.llegada_estimada, coalesce(c.enviada_fecha::timestamptz, c.creado_at), true
              from operacion.compra c join operacion.paquete_incidente i on i.compra_id = c.id
             where c.destino = 'bodega' and not operacion.paquete_incidente_resuelto(i.id)) b) q), '[]'::jsonb);
end $$;

revoke execute on all functions in schema operacion from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function api.explicar_cifra(text), api.paquetes_incidentes(), api.paquete_salida_lineas(bigint) to authenticated;
revoke execute on function omar.mis_paquetes() from public, anon;
grant execute on function omar.mis_paquetes() to authenticated;
