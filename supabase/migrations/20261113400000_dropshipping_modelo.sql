-- Dropshipping (decision del dueno, 13-nov): el proveedor (Karen/Vapemate, tambien Isaac) envia directo de SU stock al cliente; no entra inventario a la bodega de Merida.
-- Esta migracion es ADITIVA: no borra ni reescribe nada existente. Reutiliza el modelo de pedidos directos (origen karen_directo, karen_via_isaac, isaac_directo), la cuenta del
-- proveedor (operacion.cuenta_proveedor_mov), los fondos en poder del socio, los pagos de socio a proveedor (reembolso por omision) y los asientos que ya registran
-- venta, costo de venta y cuenta por pagar al proveedor para los pedidos directos.
--
--  * origen_surtido = 'dropshipping' | 'inventario_merida', DERIVADO del origen existente (operacion.origen_surtido): no cambia ningun pedido actual.
--  * Datos del destinatario en el esquema aparte `entrega` (RLS forzada sin politicas, sin privilegios para la web): solo funciones SECURITY DEFINER de rol socio los tocan;
--    telefono y correo salen enmascarados y revelarlos queda auditado. Nada de esto pasa por el agente de IA, por Telegram ni por Omar, y nunca entra a payloads de eventos.
--  * Folio externo del proveedor (por ejemplo el numero de pedido de Karen), buscable.
--  * Terminos de credito por venta (porcentaje semanal, semanas o fecha de pago, interes simple por omision) con calculo determinista en SQL; el interes se aplica como el recargo
--    por credito que ya existe en el pedido (pedido.recargo_cent), asi que nota, asientos y cuentas por cobrar lo recogen sin cambios.
--  * Funcion que arma la orden para el proveedor (texto, sin ninguna E/S externa): el sistema NO escribe a Karen ni a clientes.
--  * Amortizaciones: cada pago al proveedor puede ligarse a un pedido (informativo; la cuenta corriente sigue siendo operacion.saldo_proveedor).

-- ---------------------------------------------------------------------------
-- Dimension origen_surtido
-- ---------------------------------------------------------------------------
create function operacion.origen_surtido(p_origen text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select case when p_origen in ('bodega_omar', 'castores') then 'inventario_merida' else 'dropshipping' end $$;

-- ---------------------------------------------------------------------------
-- Extension 1:1 del pedido directo
-- ---------------------------------------------------------------------------
create table operacion.pedido_ds (
  pedido_id bigint primary key references operacion.pedido (id),
  proveedor_id bigint not null references catalogo.proveedor (id),
  tipo_venta text not null default 'cliente' check (tipo_venta in ('cliente', 'socio_a_costo')),
  socio_id bigint references catalogo.socio (id),
  folio_externo text check (folio_externo is null or length(btrim(folio_externo)) between 1 and 60),
  folio_externo_norm text generated always as (nullif(regexp_replace(lower(btrim(folio_externo)), '\s+', '', 'g'), '')) stored,
  folio_externo_at timestamptz,
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now(),
  check ((tipo_venta = 'socio_a_costo') = (socio_id is not null))
);
create unique index pedido_ds_folio_externo_uq on operacion.pedido_ds (proveedor_id, folio_externo_norm) where folio_externo_norm is not null;
create index pedido_ds_folio_externo_idx on operacion.pedido_ds (folio_externo_norm text_pattern_ops);

create function operacion.t_pedido_ds() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'el pedido de dropshipping no se borra' using errcode = '42501'; end if;
  if (to_jsonb(new) - array['folio_externo', 'folio_externo_norm', 'folio_externo_at']) is distinct from (to_jsonb(old) - array['folio_externo', 'folio_externo_norm', 'folio_externo_at']) then
    raise exception 'del pedido de dropshipping solo cambia el folio externo' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pedido_ds_t before update or delete on operacion.pedido_ds for each row execute function operacion.t_pedido_ds();
create trigger pedido_ds_t_trunc before truncate on operacion.pedido_ds for each statement execute function seguridad.t1_solo_insercion();

-- ---------------------------------------------------------------------------
-- Credito por venta: interes semanal SIMPLE por omision (el dueno no ha confirmado simple vs compuesto; 'compuesto' queda disponible como opcion explicita).
-- ---------------------------------------------------------------------------
-- interes simple    = base x tasa_semanal x semanas
-- interes compuesto = base x ((1 + tasa_semanal) ^ semanas - 1)
-- Redondeo medio hacia arriba al centavo. Ejemplo del dueno: 200 pzas x 130.00 = 26,000.00 a una semana al 10 % => interes 2,600.00 y total 28,600.00.
create function operacion.interes_credito(p_base_cent bigint, p_tasa_bp int, p_semanas int, p_modo text default 'simple') returns bigint
language plpgsql immutable parallel safe set search_path = ''
as $$
begin
  if p_base_cent is null or p_base_cent < 0 then raise exception 'la base del credito no puede ser negativa' using errcode = '23514'; end if;
  if p_tasa_bp is null or p_tasa_bp < 0 or p_tasa_bp > 10000 then raise exception 'porcentaje semanal invalido (0 a 100 %%)' using errcode = '23514'; end if;
  if p_semanas is null or p_semanas < 0 or p_semanas > 260 then raise exception 'semanas invalidas (0 a 260)' using errcode = '23514'; end if;
  if p_modo not in ('simple', 'compuesto') then raise exception 'modo de interes invalido' using errcode = '22023'; end if;
  if p_modo = 'simple' then
    return negocio.redondear_medio_arriba(p_base_cent * p_tasa_bp::bigint * p_semanas, 10000);
  end if;
  return round(p_base_cent::numeric * (power(1 + p_tasa_bp::numeric / 10000, p_semanas) - 1))::bigint;
end $$;

create table operacion.pedido_credito (
  pedido_id bigint primary key references operacion.pedido (id),
  tasa_semanal_bp int not null check (tasa_semanal_bp between 0 and 10000),
  semanas int not null check (semanas between 0 and 260),
  fecha_pago_pactada date not null,
  modo text not null default 'simple' check (modo in ('simple', 'compuesto', 'fijo')),  -- 'fijo' = monto pactado a mano para esa venta
  base_cent bigint not null check (base_cent >= 0),
  interes_cent bigint not null check (interes_cent >= 0),
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Amortizaciones de pagos al proveedor (por pedido). Informativas: la cuenta corriente es la suma de operacion.cuenta_proveedor_mov.
-- ---------------------------------------------------------------------------
create table operacion.ds_amortizacion (
  id bigint generated always as identity primary key,
  movimiento_id bigint not null references operacion.cuenta_proveedor_mov (id),
  pedido_id bigint not null references operacion.pedido (id),
  monto_cent bigint not null check (monto_cent > 0),
  evento_id bigint not null references operacion.evento (id),
  creado_at timestamptz not null default now()
);
create index ds_amortizacion_pedido_idx on operacion.ds_amortizacion (pedido_id);
create index ds_amortizacion_mov_idx on operacion.ds_amortizacion (movimiento_id);

do $$
declare t text;
begin
  foreach t in array array['pedido_credito', 'ds_amortizacion'] loop
    execute format('create trigger %I before update or delete on operacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on operacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
  end loop;
  foreach t in array array['pedido_ds', 'pedido_credito', 'ds_amortizacion'] loop
    execute format('alter table operacion.%I enable row level security', t);
    execute format('alter table operacion.%I force row level security', t);
    execute format('revoke all on operacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema operacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Esquema `entrega`: destinatarios protegidos
-- ---------------------------------------------------------------------------
create schema if not exists entrega;
revoke all on schema entrega from public, anon, authenticated;

create table entrega.destinatario (
  pedido_id bigint primary key references operacion.pedido (id),
  nombre text not null check (length(btrim(nombre)) between 2 and 120),
  calle_numero text not null check (length(btrim(calle_numero)) between 3 and 160),
  colonia text not null default '' check (length(colonia) <= 120),
  cp text not null check (cp ~ '^[0-9]{5}$'),
  municipio text not null check (length(btrim(municipio)) between 2 and 120),
  estado text not null check (length(btrim(estado)) between 2 and 80),
  telefono text not null default '' check (length(telefono) <= 30),
  correo text not null default '' check (length(correo) <= 160),
  referencias text not null default '' check (length(referencias) <= 400),
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

-- Cada vez que un socio revela telefono o correo, o copia la orden con el bloque completo del destinatario, queda registrado (quien, cuando, por que). Solo insercion.
create table entrega.revelacion (
  id bigint generated always as identity primary key,
  pedido_id bigint not null,
  accion text not null check (accion in ('telefono', 'correo', 'completo', 'orden')),
  actor uuid not null,
  motivo text,
  en timestamptz not null default now()
);
create index entrega_revelacion_idx on entrega.revelacion (pedido_id, id);
create trigger revelacion_t1 before update or delete on entrega.revelacion for each row execute function seguridad.t1_solo_insercion();
create trigger revelacion_t1_trunc before truncate on entrega.revelacion for each statement execute function seguridad.t1_solo_insercion();

do $$
declare t text;
begin
  foreach t in array array['destinatario', 'revelacion'] loop
    execute format('alter table entrega.%I enable row level security', t);
    execute format('alter table entrega.%I force row level security', t);
    execute format('revoke all on entrega.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema entrega from public, anon, authenticated;

-- Mascaras (solo presentacion).
create function entrega.mascara_telefono(p text) returns text
language sql immutable set search_path = ''
as $$ select case when coalesce(p, '') = '' then '' else '*** ** ' || right(regexp_replace(p, '\D', '', 'g'), 2) end $$;
create function entrega.mascara_correo(p text) returns text
language sql immutable set search_path = ''
as $$ select case when coalesce(p, '') = '' then '' else left(p, 1) || '***@***' end $$;

-- Valida y normaliza el JSON del destinatario (sin tocar la base). Llaves: nombre, calle_numero, colonia, cp, municipio, estado, telefono, correo, referencias.
create function entrega.normalizar(p jsonb) returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'el destinatario debe ser un objeto' using errcode = '22023'; end if;
  v := jsonb_build_object(
    'nombre', btrim(coalesce(p->>'nombre', '')), 'calle_numero', btrim(coalesce(p->>'calle_numero', '')), 'colonia', btrim(coalesce(p->>'colonia', '')),
    'cp', btrim(coalesce(p->>'cp', '')), 'municipio', btrim(coalesce(p->>'municipio', '')), 'estado', btrim(coalesce(p->>'estado', '')),
    'telefono', btrim(coalesce(p->>'telefono', '')), 'correo', lower(btrim(coalesce(p->>'correo', ''))), 'referencias', btrim(coalesce(p->>'referencias', '')));
  if length(v->>'nombre') < 2 then raise exception 'el destinatario necesita nombre' using errcode = '23502'; end if;
  if length(v->>'calle_numero') < 3 then raise exception 'el destinatario necesita calle y numero' using errcode = '23502'; end if;
  if (v->>'cp') !~ '^[0-9]{5}$' then raise exception 'el codigo postal debe tener 5 digitos' using errcode = '23514'; end if;
  if length(v->>'municipio') < 2 or length(v->>'estado') < 2 then raise exception 'el destinatario necesita municipio y estado' using errcode = '23502'; end if;
  if (v->>'correo') <> '' and (v->>'correo') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'el correo del destinatario no es valido' using errcode = '23514'; end if;
  if (v->>'telefono') <> '' and regexp_replace(v->>'telefono', '\D', '', 'g') !~ '^[0-9]{8,15}$' then raise exception 'el telefono del destinatario no es valido' using errcode = '23514'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Vistas internas (sin privilegios para la web; solo las leen las funciones api.ds_* de rol socio)
-- ---------------------------------------------------------------------------
-- Base: una fila por pedido (cualquier origen). v_ds_pedido le agrega la utilidad total y el costo total del pedido.
create view operacion.v_ds_pedido_b with (security_barrier = true) as
select pe.id as pedido_id, pe.folio, pe.fecha_neg, pe.fecha_envio, pe.estado, pe.origen, operacion.origen_surtido(pe.origen) as origen_surtido,
       case when pe.origen = 'isaac_directo' then 'Isaac' when pe.origen in ('karen_directo', 'karen_via_isaac') then 'Karen' end as proveedor,
       pd.proveedor_id, pd.folio_externo, pd.tipo_venta, pd.socio_id as socio_venta_id,
       c.id as cliente_id, c.nombre_canonico as cliente,
       (select coalesce(sum(l.piezas_pedidas), 0) from operacion.pedido_linea l where l.pedido_id = pe.id)::int as piezas_pedidas,
       (select coalesce(sum(l.piezas_surtidas), 0) from operacion.pedido_linea l where l.pedido_id = pe.id)::int as piezas_surtidas,
       (pe.estado = 'enviado') as real,
       case when pe.estado = 'enviado' then operacion.pedido_cobrado(pe.id)
            else (select coalesce(sum(l.piezas_pedidas * l.precio_cent), 0) from operacion.pedido_linea l where l.pedido_id = pe.id) + pe.envio_cent + pe.recargo_cent - pe.descuento_cent end as venta_cent,
       case when pe.estado = 'enviado' then (select coalesce(sum(s.costo_valor_cent), 0) from operacion.pedido_surtido s join operacion.pedido_linea l on l.id = s.pedido_linea_id where l.pedido_id = pe.id)
            else (select coalesce(sum(l.piezas_pedidas * coalesce(operacion.costo_ref_pedido(pe.origen, l.modelo_id, pe.fecha_neg), 0)), 0) from operacion.pedido_linea l where l.pedido_id = pe.id) end::bigint as costo_cent,
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

-- UTILIDAD (definicion del dueno, 13-nov): precio de venta (con el envio cobrado al cliente como ingreso) MENOS todo lo que cuesta el pedido: producto, seguro de reenvio,
-- envio del proveedor (guia) y cualquier costo directo (renta de bodega en pedidos de inventario). Es la misma que sale en la nota interna (cascada) y en el Estado de resultados.
-- Sin nota (pedido aun no enviado) es un ESTIMADO: venta - costo de referencia - seguro.
create view operacion.v_ds_pedido with (security_barrier = true) as
select b.*,
       coalesce(b.utilidad_cent, b.venta_cent - b.costo_cent - b.seguro_cent)::bigint as utilidad_total_cent,
       (b.venta_cent - coalesce(b.utilidad_cent, b.venta_cent - b.costo_cent - b.seguro_cent))::bigint as costo_total_cent
from operacion.v_ds_pedido_b b;

-- Una fila por lo surtido (marca, modelo, sabor): venta de mercancia = piezas x precio del renglon; costo = costo del surtido.
create view operacion.v_ds_surtido with (security_barrier = true) as
select pe.id as pedido_id, pe.fecha_envio, pe.cliente_id, operacion.origen_surtido(pe.origen) as origen_surtido, ma.nombre as marca, m.nombre_canonico as modelo, sa.nombre_canonico as sabor,
       s.piezas, (s.piezas * l.precio_cent)::bigint as venta_cent, s.costo_valor_cent as costo_cent
from operacion.pedido_surtido s
join operacion.pedido_linea l on l.id = s.pedido_linea_id
join operacion.pedido pe on pe.id = l.pedido_id and pe.estado = 'enviado'
join catalogo.sku k on k.id = s.sku_id
join catalogo.modelo m on m.id = k.modelo_id
join catalogo.marca ma on ma.id = m.marca_id
join catalogo.sabor sa on sa.id = k.sabor_id;

revoke all on operacion.v_ds_pedido_b, operacion.v_ds_pedido, operacion.v_ds_surtido from public, anon, authenticated;
