-- Dropshipping / 0500: COSTO DISTINTO DEL CATALOGO por pedido (decision del dueno, 13-nov).
-- El catalogo del proveedor sigue siendo el valor por omision. Antes de enviar, un socio puede capturar el costo real por pieza de un renglon (o el mismo para todos los renglones del pedido)
-- con motivo obligatorio y evidencia opcional (misma evidencia con huella sha256 del esquema cerrado `entrega`). Queda marcado como "costo distinto del catalogo" con su diferencia y su motivo,
-- y alimenta el registro de DIFERENCIAS EN DISPUTA CON EL PROVEEDOR (abierta -> resuelta o descartada). La utilidad, la nota y los asientos usan el costo capturado: el costo del surtido se fija
-- al insertar el renglon surtido (trigger), asi enviar_pedido y el libro no cambian. Capturas insert-only: la vigente es la ultima por renglon; capturar el costo del catalogo la revierte.
-- Despues de enviar el costo queda fijo; una diferencia que se descubre despues se corrige con el ajuste de proveedor existente (registrar_ajuste_proveedor, tipo descuento_proveedor).

create table operacion.ds_costo_captura (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references operacion.pedido (id),
  pedido_linea_id bigint not null references operacion.pedido_linea (id),
  costo_unit_cent bigint not null check (costo_unit_cent > 0),
  costo_catalogo_cent bigint not null check (costo_catalogo_cent > 0),
  motivo text not null check (length(btrim(motivo)) >= 5),
  evidencia_id bigint references entrega.evidencia_pago (id),
  capturado_por bigint not null references catalogo.socio (id),
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);
create index ds_costo_captura_linea_idx on operacion.ds_costo_captura (pedido_linea_id, id desc);
create table operacion.ds_costo_resolucion (
  captura_id bigint primary key references operacion.ds_costo_captura (id),
  estado text not null check (estado in ('resuelta', 'descartada')),
  nota text not null check (length(btrim(nota)) >= 3),
  decidido_por bigint not null references catalogo.socio (id),
  evento_id bigint not null references operacion.evento (id),
  decidido_at timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['ds_costo_captura', 'ds_costo_resolucion'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- Costo capturado vigente de un renglon (null = usa el catalogo).
create function operacion.ds_costo_capturado(p_linea bigint) returns bigint
language sql stable security definer set search_path = ''
as $$ select costo_unit_cent from operacion.ds_costo_captura where pedido_linea_id = p_linea order by id desc limit 1 $$;

-- Costo unitario efectivo que le toca a un renglon (con el seguro de reenvio si es Karen via Isaac): el capturado o, por omision, el del catalogo.
create function operacion.ds_costo_ref_linea(p_linea bigint, p_origen text, p_modelo bigint, p_fecha date) returns bigint
language plpgsql stable security definer set search_path = ''
as $$
declare v_c bigint := operacion.ds_costo_capturado(p_linea);
begin
  if v_c is null then return operacion.costo_ref_pedido(p_origen, p_modelo, p_fecha); end if;
  return v_c + case when p_origen = 'karen_via_isaac' then coalesce((catalogo.config_valor('seguro_reenvio_cent', p_fecha))::text::bigint, 0) else 0 end;
end $$;

-- El costo del surtido de un renglon con costo capturado se fija al insertarlo (el kardex y la nota lo toman de aqui).
create function operacion.t_ds_costo_surtido() returns trigger
language plpgsql set search_path = ''
as $$
declare v_c bigint; v_origen text; v_fecha date;
begin
  v_c := operacion.ds_costo_capturado(new.pedido_linea_id);
  if v_c is null then return new; end if;
  select pe.origen into v_origen from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id where l.id = new.pedido_linea_id;
  if operacion.origen_es_bodega(v_origen) then return new; end if;
  select e.fecha_neg into v_fecha from operacion.evento e where e.id = new.evento_id;
  new.costo_valor_cent := new.piezas * (v_c + case when v_origen = 'karen_via_isaac' then coalesce((catalogo.config_valor('seguro_reenvio_cent', v_fecha))::text::bigint, 0) else 0 end);
  return new;
end $$;
create trigger pedido_surtido_costo_ds before insert on operacion.pedido_surtido for each row execute function operacion.t_ds_costo_surtido();
revoke execute on function operacion.t_ds_costo_surtido() from public, anon, authenticated;

create or replace view operacion.v_ds_pedido_b with (security_barrier = true) as
select pe.id as pedido_id, pe.folio, pe.fecha_neg, pe.fecha_envio, pe.estado, pe.origen, operacion.origen_surtido(pe.origen) as origen_surtido,
       case when pe.origen = 'isaac_directo' then 'Isaac' when pe.origen in ('karen_directo', 'karen_via_isaac') then 'Karen' end as proveedor,
       pd.proveedor_id, pd.folio_externo, pd.tipo_venta, pd.socio_id as socio_venta_id,
       c.id as cliente_id, c.nombre_canonico as cliente,
       (select coalesce(sum(l.piezas_pedidas), 0) from operacion.pedido_linea l where l.pedido_id = pe.id)::int as piezas_pedidas,
       (select coalesce(sum(l.piezas_surtidas), 0) from operacion.pedido_linea l where l.pedido_id = pe.id)::int as piezas_surtidas,
       (pe.estado = 'enviado') as real,
       case when pe.estado = 'enviado' then operacion.pedido_cobrado(pe.id)
            else (select coalesce(sum(l.piezas_pedidas * l.precio_cent), 0) from operacion.pedido_linea l where l.pedido_id = pe.id) + pe.envio_cent + pe.recargo_cent - pe.descuento_cent end::bigint as venta_cent,
       case when pe.estado = 'enviado' then (select coalesce(sum(s.costo_valor_cent), 0) from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id where l.pedido_id = pe.id)
            else (select coalesce(sum(l.piezas_pedidas * coalesce(operacion.ds_costo_ref_linea(l.id, pe.origen, l.modelo_id, pe.fecha_neg), 0)), 0) from operacion.pedido_linea l where l.pedido_id = pe.id) end::bigint as costo_cent,
       -- Seguro de reenvio que se debe a Isaac cuando Karen manda via Isaac (no es costo de mercancia de Karen).
       case when pe.origen = 'karen_via_isaac' then coalesce((catalogo.config_valor('seguro_reenvio_cent', coalesce(pe.fecha_envio, pe.fecha_neg)))::text::bigint, 0)
                                                   * (select coalesce(sum(l.piezas_surtidas), 0) from operacion.pedido_linea l where l.pedido_id = pe.id) else 0 end::bigint as seguro_cent,
       (nn.c->>'utilidad_cent')::bigint as utilidad_cent,
       (nn.c->>'guia_cent')::bigint as guia_cent,
       coalesce((nn.c->>'renta_cent')::bigint, 0) as renta_nota_cent,
       coalesce((nn.c->>'utilidad_provisional')::boolean, false) as utilidad_provisional,
       case when pe.estado = 'enviado' then operacion.pedido_saldo(pe.id) end as saldo_cliente_cent,
       pe.recargo_cent, pe.plazo_dias,
       cr.tasa_semanal_bp, cr.semanas, cr.fecha_pago_pactada, cr.modo as modo_interes, cr.interes_cent, cr.base_cent as base_credito_cent,
       coalesce((select sum(a.monto_cent) from operacion.ds_amortizacion a where a.pedido_id = pe.id
                  and not exists (select 1 from operacion.cuenta_proveedor_mov r where r.reversa_de = a.movimiento_id)), 0)::bigint as amortizado_cent,
       (select count(*) from operacion.pedido_aviso a where a.pedido_id = pe.id)::int as avisos,
       exists (select 1 from entrega.destinatario d where d.pedido_id = pe.id) as tiene_destinatario
from operacion.pedido pe
join catalogo.cliente c on c.id = pe.cliente_id
left join operacion.pedido_ds pd on pd.pedido_id = pe.id
left join operacion.pedido_credito cr on cr.pedido_id = pe.id
left join lateral (select n.snapshot_interno->'cascada' as c from operacion.nota n where n.pedido_id = pe.id order by n.id desc limit 1) nn on true;

-- Diferencia contra el catalogo de un pedido (capturado menos catalogo, por las piezas que cuentan). 0 si no hay costo distinto.
create function operacion.ds_diferencia_pedido(p_pedido bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum((c.costo_unit_cent - c.costo_catalogo_cent) * (case when pe.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end)), 0)::bigint
  from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id
  join lateral (select x.costo_unit_cent, x.costo_catalogo_cent from operacion.ds_costo_captura x where x.pedido_linea_id = l.id order by x.id desc limit 1) c on true
  where l.pedido_id = p_pedido
$$;

-- Guarda evidencia (imagen PNG o JPEG, o PDF, de hasta 2 MB) en el esquema cerrado y devuelve su id. Misma validacion que la del pago.
create function entrega.guardar_evidencia(p_b64 text, p_mime text, p_nombre text, p_socio bigint) returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare v_bytes bytea := decode(p_b64, 'base64'); v_id bigint;
begin
  if length(v_bytes) < 1 or length(v_bytes) > 2097152 then raise exception 'la evidencia debe pesar entre 1 byte y 2 MB' using errcode = '23514'; end if;
  if p_mime not in ('image/png', 'image/jpeg', 'application/pdf') then raise exception 'la evidencia debe ser imagen PNG o JPEG, o PDF' using errcode = '22023'; end if;
  if not ((p_mime = 'image/png' and substring(v_bytes from 1 for 4) = '\x89504e47'::bytea) or (p_mime = 'image/jpeg' and substring(v_bytes from 1 for 3) = '\xffd8ff'::bytea)
          or (p_mime = 'application/pdf' and substring(v_bytes from 1 for 4) = '\x25504446'::bytea)) then raise exception 'el archivo no corresponde a su tipo' using errcode = '22023'; end if;
  insert into entrega.evidencia_pago (sha256, mime, nombre, tam_bytes, contenido, subido_por) values (encode(sha256(v_bytes), 'hex'), p_mime, coalesce(nullif(btrim(p_nombre), ''), 'evidencia'), length(v_bytes), v_bytes, p_socio) returning id into v_id;
  return v_id;
end $$;

-- Captura el costo real por pieza de uno o varios renglones de un pedido de dropshipping antes de enviarlo.
-- p_costos: [{"linea_id": n, "costo_unit_cent": n}]. Motivo obligatorio (por ejemplo sobrecobro en disputa); evidencia opcional.
create function operacion.ds_capturar_costo(p_clave_idem text, p_pedido bigint, p_costos jsonb, p_motivo text, p_evidencia_b64 text default null, p_evidencia_mime text default null,
                                            p_evidencia_nombre text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; pe operacion.pedido; v_soc bigint := operacion.actor_socio(); x jsonb; l operacion.pedido_linea; v_cat bigint; v_unit bigint; v_evid bigint; v_ev bigint; v_n int := 0; v_dif bigint := 0; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_capturar_costo', 'p', p_pedido, 'c', p_costos, 'm', p_motivo, 'h', case when p_evidencia_b64 is null then null else encode(sha256(convert_to(p_evidencia_b64, 'UTF8')), 'hex') end));
  if v_prev is not null then return v_prev; end if;
  if v_soc is null then raise exception 'solo un socio captura el costo' using errcode = '42501'; end if;
  select * into pe from operacion.pedido where id = p_pedido for update;
  if not found or not exists (select 1 from operacion.pedido_ds where pedido_id = p_pedido) then raise exception 'pedido de dropshipping desconocido' using errcode = '22023'; end if;
  if pe.estado not in ('borrador', 'confirmado') then raise exception 'el costo solo se captura antes de enviar; despues se corrige con un ajuste de proveedor' using errcode = 'P0428'; end if;
  if nullif(btrim(p_motivo), '') is null or length(btrim(p_motivo)) < 5 then raise exception 'el costo distinto del catalogo exige un motivo (minimo 5 caracteres)' using errcode = '23502'; end if;
  if jsonb_typeof(p_costos) <> 'array' or jsonb_array_length(p_costos) = 0 then raise exception 'indica el costo de al menos un renglon' using errcode = '22023'; end if;
  if p_evidencia_b64 is not null then v_evid := entrega.guardar_evidencia(p_evidencia_b64, p_evidencia_mime, p_evidencia_nombre, v_soc); end if;
  v_ev := operacion.crear_evento('ds_costo_capturado', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('pedido', pe.folio, 'renglones', jsonb_array_length(p_costos), 'con_evidencia', v_evid is not null));
  for x in select * from jsonb_array_elements(p_costos) loop
    select * into l from operacion.pedido_linea where id = (x->>'linea_id')::bigint and pedido_id = p_pedido;
    if not found then raise exception 'un renglon no pertenece al pedido' using errcode = '22023'; end if;
    v_unit := (x->>'costo_unit_cent')::bigint;
    if v_unit is null or v_unit <= 0 then raise exception 'el costo por pieza debe ser positivo' using errcode = '23514'; end if;
    v_cat := catalogo.costo_vigente(catalogo.proveedor_id(case when pe.origen = 'isaac_directo' then 'Isaac' else 'Karen' end), l.modelo_id, pe.fecha_neg);
    if v_cat is null then raise exception 'el modelo no tiene costo vigente de catalogo para comparar' using errcode = '23502'; end if;
    insert into operacion.ds_costo_captura (pedido_id, pedido_linea_id, costo_unit_cent, costo_catalogo_cent, motivo, evidencia_id, capturado_por, evento_id)
      values (p_pedido, l.id, v_unit, v_cat, btrim(p_motivo), v_evid, v_soc, v_ev);
    v_n := v_n + 1; v_dif := v_dif + (v_unit - v_cat) * l.piezas_pedidas;
  end loop;
  v_res := jsonb_build_object('pedido_id', p_pedido, 'renglones', v_n, 'diferencia_cent', v_dif, 'diferencia_pedido_cent', operacion.ds_diferencia_pedido(p_pedido), 'con_evidencia', v_evid is not null);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

-- Detalle de costos de un pedido para la ficha: catalogo, capturado (si lo hay), diferencia y motivo por renglon.
create function api.ds_costos_pedido(p_pedido bigint) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('pedido_id', p_pedido, 'diferencia_cent', operacion.ds_diferencia_pedido(p_pedido),
    'renglones', coalesce((select jsonb_agg(jsonb_build_object('linea_id', l.id, 'marca', ma.nombre, 'modelo', m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', case when pe.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end,
        'costo_catalogo_cent', catalogo.costo_vigente(catalogo.proveedor_id(case when pe.origen = 'isaac_directo' then 'Isaac' else 'Karen' end), l.modelo_id, pe.fecha_neg),
        'costo_capturado_cent', c.costo_unit_cent, 'diferencia_unit_cent', c.costo_unit_cent - c.costo_catalogo_cent, 'motivo', c.motivo, 'captura_id', c.id,
        'evidencia', case when e.id is null then null else jsonb_build_object('sha256', e.sha256, 'mime', e.mime, 'nombre', e.nombre) end,
        'resolucion', (select jsonb_build_object('estado', r.estado, 'nota', r.nota) from operacion.ds_costo_resolucion r where r.captura_id = c.id)) order by l.id)
      from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
      left join lateral (select x.* from operacion.ds_costo_captura x where x.pedido_linea_id = l.id order by x.id desc limit 1) c on true left join entrega.evidencia_pago e on e.id = c.evidencia_id
      where l.pedido_id = p_pedido), '[]'::jsonb));
end $$;

-- Registro de diferencias en disputa con el proveedor: una fila por renglon con costo distinto del catalogo (captura vigente).
create function api.ds_diferencias(p_estado text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_estado is not null and p_estado not in ('abierta', 'resuelta', 'descartada') then raise exception 'estado invalido' using errcode = '22023'; end if;
  return jsonb_build_object('filas', coalesce((select jsonb_agg(q.fila order by q.id desc) from (
    select c.id, jsonb_build_object('captura_id', c.id, 'pedido_id', pe.id, 'folio', pe.folio, 'fecha', c.creado_at::date, 'proveedor', case when pe.origen = 'isaac_directo' then 'Isaac' else 'Karen' end,
        'modelo', ma.nombre || ' ' || m.nombre_canonico, 'sabor', sa.nombre_canonico, 'piezas', case when pe.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end,
        'costo_catalogo_cent', c.costo_catalogo_cent, 'costo_capturado_cent', c.costo_unit_cent, 'diferencia_unit_cent', c.costo_unit_cent - c.costo_catalogo_cent,
        'diferencia_cent', (c.costo_unit_cent - c.costo_catalogo_cent) * (case when pe.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end), 'estado_pedido', pe.estado,
        'motivo', c.motivo, 'estado', coalesce(r.estado, 'abierta'), 'resolucion', r.nota, 'capturado_por', (select s.nombre from catalogo.socio s where s.id = c.capturado_por),
        'evidencia', case when e.id is null then null else jsonb_build_object('sha256', e.sha256, 'mime', e.mime, 'nombre', e.nombre) end) as fila, coalesce(r.estado, 'abierta') as est
    from operacion.ds_costo_captura c
    join lateral (select max(x.id) as id from operacion.ds_costo_captura x where x.pedido_linea_id = c.pedido_linea_id) ult on ult.id = c.id
    join operacion.pedido_linea l on l.id = c.pedido_linea_id join operacion.pedido pe on pe.id = c.pedido_id and pe.estado not in ('cancelado', 'anulado')
    join catalogo.sku k on k.id = l.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.marca ma on ma.id = m.marca_id join catalogo.sabor sa on sa.id = k.sabor_id
    left join operacion.ds_costo_resolucion r on r.captura_id = c.id left join entrega.evidencia_pago e on e.id = c.evidencia_id
    where c.costo_unit_cent <> c.costo_catalogo_cent) q where p_estado is null or q.est = p_estado), '[]'::jsonb),
    'abiertas', (select count(*) from operacion.ds_costo_captura c join lateral (select max(x.id) as id from operacion.ds_costo_captura x where x.pedido_linea_id = c.pedido_linea_id) u on u.id = c.id
                 join operacion.pedido pe on pe.id = c.pedido_id and pe.estado not in ('cancelado', 'anulado') where c.costo_unit_cent <> c.costo_catalogo_cent and not exists (select 1 from operacion.ds_costo_resolucion r where r.captura_id = c.id)),
    'monto_abierto_cent', coalesce((select sum((c.costo_unit_cent - c.costo_catalogo_cent) * (case when pe.estado = 'enviado' then l.piezas_surtidas else l.piezas_pedidas end))
                 from operacion.ds_costo_captura c join lateral (select max(x.id) as id from operacion.ds_costo_captura x where x.pedido_linea_id = c.pedido_linea_id) u on u.id = c.id
                 join operacion.pedido_linea l on l.id = c.pedido_linea_id join operacion.pedido pe on pe.id = c.pedido_id and pe.estado not in ('cancelado', 'anulado')
                 where c.costo_unit_cent <> c.costo_catalogo_cent and not exists (select 1 from operacion.ds_costo_resolucion r where r.captura_id = c.id)), 0)::bigint);
end $$;

create function operacion.ds_resolver_diferencia(p_clave_idem text, p_captura bigint, p_estado text, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; v_soc bigint := operacion.actor_socio(); c operacion.ds_costo_captura; v_ev bigint; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'ds_resolver_diferencia', 'c', p_captura, 'e', p_estado, 'n', p_nota));
  if v_prev is not null then return v_prev; end if;
  if p_estado not in ('resuelta', 'descartada') then raise exception 'estado invalido' using errcode = '22023'; end if;
  if nullif(btrim(p_nota), '') is null or length(btrim(p_nota)) < 3 then raise exception 'indica como se resolvio' using errcode = '23502'; end if;
  select * into c from operacion.ds_costo_captura where id = p_captura;
  if not found then raise exception 'captura desconocida' using errcode = '22023'; end if;
  if exists (select 1 from operacion.ds_costo_resolucion where captura_id = p_captura) then raise exception 'esa diferencia ya esta resuelta' using errcode = 'P0428'; end if;
  v_ev := operacion.crear_evento('ds_diferencia_resuelta', negocio.hoy(), p_clave_idem || ':ev', jsonb_build_object('captura', c.id, 'estado', p_estado));
  insert into operacion.ds_costo_resolucion (captura_id, estado, nota, decidido_por, evento_id) values (c.id, p_estado, btrim(p_nota), v_soc, v_ev);
  v_res := jsonb_build_object('captura_id', c.id, 'estado', p_estado);
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.ds_capturar_costo(p_clave_idem text, p_pedido bigint, p_costos jsonb, p_motivo text, p_evidencia_b64 text default null, p_evidencia_mime text default null, p_evidencia_nombre text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_capturar_costo(p_clave_idem, p_pedido, p_costos, p_motivo, p_evidencia_b64, p_evidencia_mime, p_evidencia_nombre); end $$;
create function api.ds_resolver_diferencia(p_clave_idem text, p_captura bigint, p_estado text, p_nota text) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return operacion.ds_resolver_diferencia(p_clave_idem, p_captura, p_estado, p_nota); end $$;

revoke execute on function operacion.ds_costo_capturado(bigint), operacion.ds_costo_ref_linea(bigint, text, bigint, date), operacion.ds_diferencia_pedido(bigint), entrega.guardar_evidencia(text, text, text, bigint),
  operacion.ds_capturar_costo(text, bigint, jsonb, text, text, text, text), operacion.ds_resolver_diferencia(text, bigint, text, text) from public, anon, authenticated;
revoke execute on function api.ds_costos_pedido(bigint), api.ds_diferencias(text), api.ds_capturar_costo(text, bigint, jsonb, text, text, text, text), api.ds_resolver_diferencia(text, bigint, text, text) from public, anon;
-- GRANT a authenticated (cada una exige rol socio dentro):
grant execute on function api.ds_costos_pedido(bigint), api.ds_diferencias(text), api.ds_capturar_costo(text, bigint, jsonb, text, text, text, text), api.ds_resolver_diferencia(text, bigint, text, text) to authenticated;
