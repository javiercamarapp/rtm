-- Dinero propio de un socio que paga a un proveedor: REEMBOLSO por omision; CAPITAL solo si el socio lo declara expresamente.
-- Decision del dueno (13-nov, que confirma la del 11-nov): lo que un socio pone o paga de su bolsillo es cuenta por pagar al socio (financiamiento temporal)
-- salvo que declare que reinvierte, invierte o mete mas lana. Antes, operacion.pago_proveedor_de_socio registraba SIEMPRE el excedente como clasificacion 'capital'
-- (la unica captura que aun asumia capital sin declaracion; las demas capturas ya exigen intencion o usan 'reembolsable').
--
-- Aditiva: no reescribe asientos ni filas historicas. En produccion aun no hay movimientos reales (se verifico por conteos: cero filas en operacion.aportacion_socio).
-- Las filas que existieran como 'capital' por esta via NO se tocan; si hiciera falta corregir una, se hace con anular_movimiento_socio (reversa enlazada) y un nuevo pago.
--
-- Ademas deja como PARAMETRO la pregunta pendiente del dueno: cuanto de lo pagado desde la caja de la sociedad cuenta como "puesto por los socios" en Cuenta de socios.
-- Clave catalogo.config 'caja_sociedad_cuenta_puesto_pct' (0 a 100, por omision 0 = nada, la lectura conservadora: toda la parte pagada por la sociedad se muestra
-- como "financiado por la sociedad"). No se decide aqui; el dueno lo fija con los primeros movimientos reales (insertar una fila nueva con vigente_desde y cerrar la anterior).

insert into catalogo.config (clave, valor, vigente_desde) values ('caja_sociedad_cuenta_puesto_pct', '0', '2026-11-10');

-- ---------------------------------------------------------------------------
-- Pago de un socio a un proveedor con declaracion explicita de capital
-- ---------------------------------------------------------------------------
drop function api.pago_proveedor_de_socio(text, text, bigint, text, text, date, text, text);
drop function operacion.pago_proveedor_de_socio(text, text, bigint, text, text, date, text, text);

-- fuente: 'auto' (baja primero lo que el socio debe a la sociedad; el resto es dinero propio), 'fondos_sociedad' (solo lo que tiene en su poder) o
-- 'dinero_propio' ('aportacion' se acepta como sinonimo antiguo). El dinero propio es REEMBOLSO (cuenta por pagar al socio) salvo p_declara_capital = true.
create function operacion.pago_proveedor_de_socio(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_socio text, p_fuente text default 'auto',
                                                  p_fecha date default null, p_nota text default null, p_mensaje_origen text default null,
                                                  p_declara_capital boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_prev jsonb; v_prov bigint; v_socio bigint; v_cuenta bigint; v_fecha date := coalesce(p_fecha, negocio.hoy()); v_ev bigint; v_deuda bigint; v_fondos bigint; v_desde_fondos bigint;
  v_aport bigint; v_a_fondos bigint; v_a_dif bigint; v_declara boolean := coalesce(p_declara_capital, false); v_clasif text; v_res jsonb;
begin
  perform seguridad.exigir_rol(array['socio', 'importacion']);
  v_prev := seguridad.iniciar_operacion(p_clave_idem, jsonb_build_object('fn', 'pago_proveedor_de_socio', 'p', p_proveedor, 'm', p_monto_cent, 's', p_socio, 'u', p_fuente, 'f', p_fecha, 'n', p_nota, 'c', v_declara));
  if v_prev is not null then return v_prev; end if;
  if p_monto_cent is null or p_monto_cent <= 0 then raise exception 'el pago debe ser positivo' using errcode = '23514'; end if;
  if p_fuente not in ('auto', 'fondos_sociedad', 'dinero_propio', 'aportacion') then raise exception 'fuente invalida' using errcode = '22023'; end if;
  v_prov := catalogo.proveedor_id(p_proveedor);
  select id into v_socio from catalogo.socio where nombre = p_socio;
  select id into v_cuenta from operacion.cuenta_dinero where nombre = p_socio;
  if v_prov is null or v_socio is null then raise exception 'proveedor o socio desconocido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cuenta_proveedor:' || v_prov, 0));
  v_deuda := greatest(operacion.saldo_socio(v_socio), 0);
  v_desde_fondos := case when p_fuente in ('dinero_propio', 'aportacion') then 0 else least(p_monto_cent, v_deuda) end;
  if p_fuente = 'fondos_sociedad' and p_monto_cent > v_deuda then raise exception 'el socio solo tiene % centavos de la sociedad en su poder', v_deuda using errcode = '23514'; end if;
  v_aport := p_monto_cent - v_desde_fondos;
  if v_declara and v_aport = 0 then raise exception 'no hay dinero propio que declarar como capital: el pago salio por completo de fondos de la sociedad' using errcode = '23514'; end if;
  v_clasif := case when v_declara then 'capital' else 'reembolsable' end;
  v_ev := operacion.crear_evento('pago_proveedor_socio', v_fecha, p_clave_idem,
            jsonb_build_object('proveedor', p_proveedor, 'socio', p_socio, 'monto_cent', p_monto_cent, 'clasificacion', case when v_aport > 0 then v_clasif else null end), p_mensaje_origen);
  insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, cuenta_origen_id, socio_id, nota, evento_id)
    values (v_prov, v_fecha, 'pago_socio', p_monto_cent, v_cuenta, v_socio, coalesce(p_nota, 'Pago de ' || p_socio || ' a ' || p_proveedor), v_ev);
  if v_desde_fondos > 0 then
    v_fondos := operacion.saldo_socio(v_socio, 'fondos');
    v_a_fondos := least(v_desde_fondos, greatest(v_fondos, 0)); v_a_dif := v_desde_fondos - v_a_fondos;
    if v_a_fondos > 0 then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, proveedor_id, nota, evento_id)
        values (v_socio, v_fecha, 'entrega_a_proveedor', 'fondos', -v_a_fondos, v_prov, 'Pago a ' || p_proveedor || ' con fondos de la sociedad', v_ev);
    end if;
    if v_a_dif > 0 then
      insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, proveedor_id, nota, evento_id)
        values (v_socio, v_fecha, 'entrega_a_proveedor', 'general', -v_a_dif, v_prov, 'Pago a ' || p_proveedor || ' con lo que debia a la sociedad', v_ev);
    end if;
  end if;
  if v_aport > 0 then
    insert into operacion.aportacion_socio (socio_id, monto_cent, concepto, clasificacion, fecha_neg, ref_tipo, evento_id)
      values (v_socio, v_aport, 'Pago a ' || p_proveedor || ' con dinero propio' || case when v_declara then ' (capital declarado)' else ' (reembolso)' end, v_clasif, v_fecha, 'cuenta_proveedor', v_ev);
  end if;
  v_res := jsonb_build_object('proveedor', p_proveedor, 'monto_cent', p_monto_cent, 'baja_deuda_cent', v_desde_fondos, 'aportacion_cent', v_aport,
                              'clasificacion', case when v_aport > 0 then v_clasif else null end,
                              'deuda_socio_cent', operacion.saldo_socio(v_socio), 'saldo_proveedor_cent', operacion.saldo_proveedor(v_prov));
  perform seguridad.terminar_operacion(p_clave_idem, v_res);
  return v_res;
end $$;

create function api.pago_proveedor_de_socio(p_clave_idem text, p_proveedor text, p_monto_cent bigint, p_socio text, p_fuente text default 'auto',
                                            p_fecha date default null, p_nota text default null, p_mensaje_origen text default null,
                                            p_declara_capital boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$ begin
  perform seguridad.exigir_rol(array['socio']);
  return operacion.pago_proveedor_de_socio(p_clave_idem => p_clave_idem, p_proveedor => p_proveedor, p_monto_cent => p_monto_cent, p_socio => p_socio, p_fuente => p_fuente,
                                           p_fecha => p_fecha, p_nota => p_nota, p_mensaje_origen => p_mensaje_origen, p_declara_capital => p_declara_capital);
end $$;

revoke execute on function operacion.pago_proveedor_de_socio(text, text, bigint, text, text, date, text, text, boolean) from public, anon, authenticated;
revoke execute on function api.pago_proveedor_de_socio(text, text, bigint, text, text, date, text, text, boolean) from public, anon;
grant execute on function api.pago_proveedor_de_socio(text, text, bigint, text, text, date, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Cuenta de socios: parametro 'caja_sociedad_cuenta_puesto_pct' (por omision 0: sin cambio de comportamiento)
-- ---------------------------------------------------------------------------
-- Con p % > 0, esa fraccion de lo que la sociedad financio (costo - lo puesto por los socios) se atribuye por mitades iguales a los dos socios como "puesto por ellos".
-- La mitad igual preserva A - J (via 2) y el total se redondea a un numero par para no abrir un centavo entre las vias.
create or replace function operacion.cuenta_socios() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_costo bigint; v_mitad bigint; v_a bigint; v_j bigint; v_ida bigint; v_idj bigint; v_via1_a bigint; v_via2_dobles bigint; v_total bigint; v_fuera jsonb;
  v_pct numeric; v_pc bigint := 0;
begin
  select id into v_ida from catalogo.socio where nombre = 'Angelo';
  select id into v_idj from catalogo.socio where nombre = 'Javier';
  select coalesce(sum(total_cent), 0)::bigint into v_costo from operacion.compra where ambito = 'sociedad' and estado not in ('borrador', 'anulada');
  v_a := operacion.aportado_compra_socio(v_ida) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0) - operacion.saldo_socio(v_ida);
  v_j := operacion.aportado_compra_socio(v_idj) - coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0) - operacion.saldo_socio(v_idj);
  v_pct := least(greatest(coalesce(catalogo.config_num('caja_sociedad_cuenta_puesto_pct'), 0), 0), 100);
  if v_pct > 0 and v_costo - (v_a + v_j) > 0 then
    v_pc := (floor((v_costo - (v_a + v_j)) * v_pct / 100)::bigint / 2) * 2;
  end if;
  v_a := v_a + v_pc / 2; v_j := v_j + v_pc / 2;
  v_mitad := (v_costo + 1) / 2;                     -- hacia arriba, a favor de quien aporta
  v_total := v_a + v_j;
  v_via1_a := v_a - v_mitad;                        -- via 1: lo puesto menos la mitad del costo
  v_via2_dobles := v_a - v_j;                       -- via 2: (A - J) / 2, comparada sin redondeo como 2 x via 1 = A - J
  select coalesce(jsonb_agg(jsonb_build_object('socio', s.nombre, 'monto_cent', p.monto_cent, 'concepto', p.concepto, 'estado', p.estado, 'piezas', p.piezas) order by p.id), '[]'::jsonb) into v_fuera
    from operacion.partida_fuera_sociedad p join catalogo.socio s on s.id = p.socio_id;
  return jsonb_build_object(
    'costo_cent', v_costo, 'mitad_cent', v_mitad,
    'angelo', jsonb_build_object('aportado_cent', v_a, 'puso_capital_cent', operacion.aportado_socio(v_ida, 'capital'), 'puso_reembolsable_cent', operacion.aportado_socio(v_ida, 'reembolsable'),
                                 'fuera_sociedad_cent', coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_ida and estado = 'abierta'), 0), 'debe_cent', operacion.saldo_socio(v_ida),
                                 'diferencia_cent', v_via1_a),
    'javier', jsonb_build_object('aportado_cent', v_j, 'puso_capital_cent', operacion.aportado_socio(v_idj, 'capital'), 'puso_reembolsable_cent', operacion.aportado_socio(v_idj, 'reembolsable'),
                                 'fuera_sociedad_cent', coalesce((select sum(monto_cent) from operacion.partida_fuera_sociedad where socio_id = v_idj and estado = 'abierta'), 0), 'debe_cent', operacion.saldo_socio(v_idj),
                                 'diferencia_cent', v_j - v_mitad),
    -- Signo: > 0 Javier debe a Angelo; < 0 Angelo debe a Javier.
    'javier_debe_a_angelo_cent', v_via1_a,
    'via1_cent', v_via1_a, 'via2_cent', v_via2_dobles / 2, 'via2_resto_cent', v_via2_dobles % 2,
    'financiado_por_sociedad_cent', v_costo - v_total,
    'caja_cuenta_puesto_pct', v_pct, 'puesto_por_caja_cent', v_pc,
    'cuadra', (2 * v_via1_a = v_via2_dobles) or (v_costo % 2 = 1 and abs(2 * v_via1_a - v_via2_dobles) = 1),
    'partidas_fuera_sociedad', v_fuera);
end $$;
