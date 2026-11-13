-- Puente del efectivo / 2: todos los flujos que mueven efectivo en el libro (1101) tambien lo mueven en el libro de efectivo (cuentas de efectivo), de modo que el efectivo
-- de la empresa y las cajas por persona cuadran con el libro (C23 y C24). Hasta ahora quedaban fuera del libro de efectivo: el cobro de clientes en efectivo y su anulacion,
-- el pago de la sociedad a un proveedor, el pago de Omar en efectivo de la sociedad, la entrega de un socio a la sociedad, el reembolso pagado en el acta de corte (neto de la
-- compensacion con lo que el socio ya tiene en su poder) y la caja por persona de la apertura. Ver docs/puente-efectivo-asientos.md.
-- ADITIVA: amplia la lista de conceptos del libro de efectivo, agrega disparadores AFTER INSERT (no tocan las funciones ya publicadas) y redefine solo apertura.publicar y
-- apertura.reversar (mismo cuerpo mas el renglon de la caja de apertura). Ningun dato existente cambia.
-- Decision pendiente del dueno (no se inventa): en que caja entra el efectivo que cobra un cliente. Parametro puente_efectivo_caja_cobros, por omision 'Caja de la empresa'.

alter table operacion.cuenta_efectivo_mov drop constraint cuenta_efectivo_mov_concepto_check;
alter table operacion.cuenta_efectivo_mov add constraint cuenta_efectivo_mov_concepto_check check (concepto in
  ('saldo_inicial', 'deposito_socio', 'pago_reembolso', 'retiro_utilidad', 'retiro_capital', 'gasto_empresa', 'traspaso', 'ajuste_conteo', 'reversa',
   'cobro_cliente', 'pago_proveedor', 'cobro_omar', 'entrega_socio', 'pago_acta', 'compensacion_acta'));

insert into catalogo.config (clave, valor, vigente_desde) values ('puente_efectivo_caja_cobros', '"Caja de la empresa"', '2026-11-11');

-- Caja donde entra el efectivo cobrado a clientes (parametro; si el nombre no existe, la caja de la empresa).
create function operacion.cuenta_efectivo_cobros(p_fecha date) returns bigint
language sql stable security definer set search_path = ''
as $$ select coalesce(operacion.cuenta_efectivo_id(catalogo.config_valor('puente_efectivo_caja_cobros', p_fecha) #>> '{}'), operacion.cuenta_efectivo_id('Caja de la empresa')) $$;

-- Deshace los movimientos de efectivo de una captura. A diferencia de revertir_efectivo no exige saldo: el efectivo ya pudo gastarse y la diferencia debe verse, no impedir
-- la anulacion (C24 la senala y el conteo la corrige).
create function operacion.contra_efectivo_de(p_ref_tipo text, p_ref_id bigint, p_evento bigint, p_nota text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id, reversa_de)
    select m.cuenta_id, negocio.hoy(), 'reversa', -m.monto_cent, p_nota, m.ref_tipo, m.ref_id, p_evento, m.id
      from operacion.cuenta_efectivo_mov m where m.ref_tipo = p_ref_tipo and m.ref_id = p_ref_id and m.concepto <> 'reversa'
       and not exists (select 1 from operacion.cuenta_efectivo_mov r where r.reversa_de = m.id) order by m.id;
end $$;

create function operacion.t_efectivo_cobro() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select cd.titular_tipo from operacion.cuenta_dinero cd where cd.id = new.cuenta_destino_id) = 'efectivo' then
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
      values (operacion.cuenta_efectivo_cobros(new.fecha_neg), new.fecha_neg, 'cobro_cliente', new.monto_cent, 'Cobro en efectivo ' || new.folio, 'pago', new.id, new.evento_id);
  end if;
  return null;
end $$;
create trigger pago_efectivo_t after insert on operacion.pago for each row execute function operacion.t_efectivo_cobro();

create function operacion.t_efectivo_cobro_anulado() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform operacion.contra_efectivo_de('pago', new.pago_id, new.evento_id, 'Pago anulado: ' || new.motivo);
  return null;
end $$;
create trigger pago_anulacion_efectivo_t after insert on operacion.pago_anulacion for each row execute function operacion.t_efectivo_cobro_anulado();

-- Pago de la sociedad a un proveedor (sale de la caja de la empresa) y su reversa.
create function operacion.t_efectivo_pago_proveedor() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.concepto = 'pago_sociedad' then
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
      values (operacion.cuenta_efectivo_id('Caja de la empresa'), new.fecha_neg, 'pago_proveedor', -new.monto_cent, coalesce(new.nota, 'Pago de la sociedad a un proveedor'), 'proveedor_mov', new.id, new.evento_id);
  elsif new.concepto = 'reversa' and exists (select 1 from operacion.cuenta_proveedor_mov o where o.id = new.reversa_de and o.concepto = 'pago_sociedad') then
    perform operacion.contra_efectivo_de('proveedor_mov', new.reversa_de, new.evento_id, coalesce(new.nota, 'Se deshace un pago a proveedor'));
  end if;
  return null;
end $$;
create trigger cuenta_proveedor_mov_efectivo_t after insert on operacion.cuenta_proveedor_mov for each row execute function operacion.t_efectivo_pago_proveedor();

-- Pago de Omar en efectivo de la sociedad (el libro lo asienta en 1101 cuando no lo recibe un socio).
create function operacion.t_efectivo_pago_omar() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.sentido = 'de_omar' and new.socio_id is null then
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
      values (operacion.cuenta_efectivo_id('Caja de la empresa'), new.fecha_neg, 'cobro_omar', new.monto_cent, 'Pago de Omar ' || new.folio, 'pago_omar', new.id, new.evento_id);
  end if;
  return null;
end $$;
create trigger pago_omar_efectivo_t after insert on operacion.pago_omar for each row execute function operacion.t_efectivo_pago_omar();

-- Entrega de un socio a la sociedad (entra a la caja de la empresa) y la compensacion del acta (el socio conserva lo que ya tenia en su poder: ese efectivo no sale de la caja).
create function operacion.t_efectivo_cuenta_socio() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_orig operacion.cuenta_socio_mov; v_tipo text;
begin
  if new.concepto = 'reversa' then
    select * into v_orig from operacion.cuenta_socio_mov where id = new.reversa_de;
    if v_orig.concepto = 'entrega_a_sociedad' then
      perform operacion.contra_efectivo_de('entrega_socio', v_orig.id, new.evento_id, coalesce(new.nota, 'Se deshace una entrega'));
    elsif v_orig.concepto = 'compensacion_reparto' then
      perform operacion.contra_efectivo_de('compensacion_acta', v_orig.id, new.evento_id, coalesce(new.nota, 'Contra-acta'));
    end if;
  elsif new.concepto = 'entrega_a_sociedad' then
    select e.tipo into v_tipo from operacion.evento e where e.id = new.evento_id;
    if v_tipo <> 'liquidacion_entre_socios' then
      insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
        values (operacion.cuenta_efectivo_id('Caja de la empresa'), new.fecha_neg, 'entrega_socio', -new.monto_cent, coalesce(new.nota, 'Entrega a la sociedad'), 'entrega_socio', new.id, new.evento_id);
    end if;
  elsif new.concepto = 'compensacion_reparto' then
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
      values (operacion.cuenta_efectivo_id('Caja de la empresa'), new.fecha_neg, 'compensacion_acta', -new.monto_cent, coalesce(new.nota, 'Compensacion del acta'), 'compensacion_acta', new.id, new.evento_id);
  end if;
  return null;
end $$;
create trigger cuenta_socio_mov_efectivo_t after insert on operacion.cuenta_socio_mov for each row execute function operacion.t_efectivo_cuenta_socio();

-- Reembolso pagado en el acta de corte (renglon del libro del socio con via 'cascada') y su contra-acta.
create function operacion.t_efectivo_acta() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_orig operacion.socio_libro;
begin
  if new.via <> 'cascada' then return null; end if;
  if new.concepto = 'pago_reembolso' then
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
      values (operacion.cuenta_efectivo_id('Caja de la empresa'), new.fecha_neg, 'pago_acta', new.monto_cent, coalesce(new.nota, 'Reembolso pagado en el acta'), 'acta_pago', new.id, new.evento_id);
  elsif new.concepto = 'reversa' then
    select * into v_orig from operacion.socio_libro where id = new.reversa_de;
    if v_orig.concepto = 'pago_reembolso' and v_orig.via = 'cascada' then
      perform operacion.contra_efectivo_de('acta_pago', v_orig.id, new.evento_id, coalesce(new.nota, 'Contra-acta'));
    end if;
  end if;
  return null;
end $$;
create trigger socio_libro_efectivo_t after insert on operacion.socio_libro for each row execute function operacion.t_efectivo_acta();

revoke execute on function operacion.cuenta_efectivo_cobros(date), operacion.contra_efectivo_de(text, bigint, bigint, text), operacion.t_efectivo_cobro(), operacion.t_efectivo_cobro_anulado(),
  operacion.t_efectivo_pago_proveedor(), operacion.t_efectivo_pago_omar(), operacion.t_efectivo_cuenta_socio(), operacion.t_efectivo_acta() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Apertura: la caja por persona tambien entra al libro de efectivo
-- ---------------------------------------------------------------------------
create or replace function apertura.publicar(p_sesion bigint, p_clave text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare s apertura.sesion; v_ev_inv bigint; v_ev bigint; r record; v_val jsonb;
begin
  select * into s from apertura.sesion where id = p_sesion for update;
  v_val := apertura.validar(p_sesion);
  if not (v_val->>'listo_para_firma')::boolean then raise exception 'la apertura no está lista: %', v_val->'alertas' using errcode = 'P0442'; end if;
  if exists (select 1 from apertura.partida where sesion_id = p_sesion and categoria = 'inventario') then
    v_ev_inv := operacion.crear_evento('apertura_inventario', s.fecha_corte, p_clave || ':inventario', jsonb_build_object('sesion_id', p_sesion), 'apertura');
    for r in select p.* from apertura.partida p where p.sesion_id = p_sesion and p.categoria = 'inventario' order by p.id loop
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, nota)
      values (s.fecha_corte, r.sku_id, r.modelo_id, 'bodega_omar', 'apertura', r.piezas, r.monto_cent, v_ev_inv, 'Apertura al ' || s.fecha_corte);
    end loop;
  end if;
  v_ev := operacion.crear_evento('asiento_manual', s.fecha_corte, p_clave || ':asiento',
            jsonb_build_object('motivo', 'Asiento de apertura al ' || s.fecha_corte, 'lineas', apertura.lineas(p_sesion, false), 'apertura', true, 'sesion_id', p_sesion), 'apertura');
  -- La caja por persona de la apertura tambien entra al libro de efectivo (saldo inicial en 'Efectivo de <socio>', con el mismo evento del asiento de apertura): el efectivo
  -- operativo, el fondeo y la cascada parten del mismo saldo que el libro, y C23 y C24 cuadran desde el primer dia.
  for r in select p.id, p.monto_cent, p.socio_id from apertura.partida p where p.sesion_id = p_sesion and p.categoria = 'caja' and p.monto_cent > 0 order by p.id loop
    insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id)
    values ((select c.id from operacion.cuenta_efectivo c where c.titular = 'socio' and c.socio_id = r.socio_id and c.tipo = 'caja' order by c.id limit 1), s.fecha_corte, 'saldo_inicial', r.monto_cent,
            'Apertura al ' || s.fecha_corte, 'apertura', r.id, v_ev);
  end loop;
  update apertura.sesion set estado = 'firmada', evento_id = v_ev, evento_inventario_id = v_ev_inv, hash_firmado = apertura.huella(p_sesion), firmada_at = clock_timestamp() where id = p_sesion;
  return jsonb_build_object('evento_id', v_ev, 'evento_inventario_id', v_ev_inv);
end $$;

create or replace function apertura.reversar(p_clave text, p_sesion bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_prev jsonb; s apertura.sesion; v_ev_rev bigint; v_asiento bigint; m record; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio']);
  v_prev := seguridad.iniciar_operacion(p_clave, jsonb_build_object('fn', 'apertura_reversar', 's', p_sesion, 'm', p_motivo));
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'la reversa exige motivo' using errcode = '23502'; end if;
  select * into s from apertura.sesion where id = p_sesion for update;
  if s.estado <> 'firmada' then raise exception 'solo se revierte una apertura firmada' using errcode = 'P0441'; end if;
  -- No se revierte si ya salio mercancia de un modelo de la apertura (la reversa dejaria un costo promedio que no corresponde a ningun costo real) ni si ya se cobro una cuenta por cobrar de la apertura.
  if exists (select 1 from operacion.movimiento_inventario mi join operacion.movimiento_inventario xi on xi.modelo_id = mi.modelo_id and xi.id > mi.id and xi.cantidad < 0
              where mi.evento_id = s.evento_inventario_id and mi.tipo = 'apertura') then
    raise exception 'ya salió mercancía de un modelo de la apertura: no se puede revertir; corrige con un ajuste de inventario' using errcode = 'P0423';
  end if;
  if exists (select 1 from operacion.pago_aplicacion_apertura x where x.reversa_de is null and not exists (select 1 from operacion.pago_aplicacion_apertura r where r.reversa_de = x.id)) then
    raise exception 'ya se cobraron cuentas por cobrar de la apertura: anula esos pagos antes de revertirla' using errcode = 'P0441';
  end if;
  if s.evento_inventario_id is not null then
    v_ev_rev := operacion.crear_evento('apertura_reversa_inventario', negocio.hoy(), p_clave || ':inventario', jsonb_build_object('sesion_id', p_sesion), p_motivo, s.evento_inventario_id, p_motivo);
    for m in select * from operacion.movimiento_inventario where evento_id = s.evento_inventario_id and tipo = 'apertura' order by id loop
      insert into operacion.movimiento_inventario (fecha_neg, sku_id, modelo_id, ubicacion, tipo, cantidad, valor_cent, evento_id, reversa_de, nota)
      values (negocio.hoy(), m.sku_id, m.modelo_id, m.ubicacion, 'reversa', -m.cantidad, -m.valor_cent, v_ev_rev, m.id, 'Reversa de la apertura: ' || p_motivo);
    end loop;
  end if;
  select id into v_asiento from contabilidad.asiento where evento_id = s.evento_id;
  if v_asiento is null then perform contabilidad.asentar_evento(s.evento_id); select id into v_asiento from contabilidad.asiento where evento_id = s.evento_id; end if;
  -- Una apertura solo de inventario no produce asiento manual (el inventario y su contrapartida 3990 salen del movimiento 'apertura', que se deshace arriba con
  -- su contramovimiento): no hay asiento que reversar. Si el asiento manual traia lineas y no existe, es un error real y se detiene.
  if v_asiento is not null then
    perform set_config('rtm.reversa_apertura', 'si', true);
    perform contabilidad.reversar_asiento(p_clave || ':asiento', v_asiento, p_motivo);
    perform set_config('rtm.reversa_apertura', '', true);
  elsif jsonb_array_length(coalesce((select e.payload->'lineas' from operacion.evento e where e.id = s.evento_id), '[]'::jsonb)) > 0 then
    raise exception 'la apertura tiene líneas de asiento pero no se encontró su asiento' using errcode = 'P0441';
  end if;
  -- Contramovimientos de la caja de apertura (los renglones del libro de efectivo que publicar creo con el evento del asiento).
  insert into operacion.cuenta_efectivo_mov (cuenta_id, fecha_neg, concepto, monto_cent, nota, ref_tipo, ref_id, evento_id, reversa_de)
    select x.cuenta_id, negocio.hoy(), 'reversa', -x.monto_cent, 'Reversa de la apertura: ' || p_motivo, x.ref_tipo, x.ref_id, coalesce(v_ev_rev, s.evento_id), x.id
      from operacion.cuenta_efectivo_mov x where x.ref_tipo = 'apertura' and x.evento_id = s.evento_id and x.concepto = 'saldo_inicial'
       and not exists (select 1 from operacion.cuenta_efectivo_mov r where r.reversa_de = x.id) order by x.id;
  update apertura.sesion set estado = 'reversada', motivo_reversa = p_motivo, reversada_at = clock_timestamp(), evento_reversa_id = v_ev_rev where id = p_sesion;
  v_res := jsonb_build_object('sesion_id', p_sesion, 'reversada', true);
  perform seguridad.terminar_operacion(p_clave, v_res);
  return v_res;
end $$;
