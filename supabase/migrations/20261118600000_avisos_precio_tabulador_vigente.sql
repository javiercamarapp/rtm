-- Avisos: el precio de lista cargado despues cierra el aviso de "sin precio de catalogo" (pedido del dueño, 14-nov): "que se borren las notificaciones una vez se solucionen; que unicamente sigan si sigue el problema".
-- ADITIVA: no edita la migracion 20261116200000 (ya aplicada); redefine notificacion.condicion y agrega un ayudante de solo lectura. No toca lineas, notas ni tablas inmutables.
-- Causa: pedido_linea.precio_tabulador_cent es una FOTO inmutable del renglon al capturarlo. Si el precio de lista se cargo despues (catalogo.tabulador_precio), la foto sigue vacia y la regla nunca cerraba.
-- Regla nueva solo para 'sin_precio_catalogo' (dentro de 'pedido_enviado_con_excepcion'), cuando la foto esta vacia:
--   * hay precio de lista vigente hoy para el cliente y el modelo (siguiendo modelo.unificado_en) y lo cobrado es igual o mayor: la causa ya no existe.
--   * hay precio de lista y lo cobrado es menor: sigue (es "precio bajo tabulador", otro motivo que persiste).
--   * no hay precio de lista: sigue sin precio de catalogo.
-- 'precio_distinto_tabulador', 'venta_bajo_costo', existencia, minimo y el parametro aviso_excepcion_cierra_al_cobrar quedan tal cual.

-- Modelo vigente tras una o varias unificaciones (modelo.unificado_en); el mismo modelo si no se unifico.
create function catalogo.modelo_vigente(p_modelo bigint) returns bigint
language sql stable set search_path = ''
as $$
  with recursive cadena (id, siguiente, n) as (
    select m.id, m.unificado_en, 0 from catalogo.modelo m where m.id = p_modelo
    union all
    select m.id, m.unificado_en, c.n + 1 from cadena c join catalogo.modelo m on m.id = c.siguiente where c.n < 10
  )
  select id from cadena where siguiente is null order by n desc limit 1
$$;

-- Precio de lista vigente hoy del cliente para un modelo (el de la linea o, si se unifico, el vigente); null si no hay.
create function notificacion.precio_lista_vigente(p_cliente bigint, p_modelo bigint) returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(catalogo.precio_vigente(p_cliente, catalogo.modelo_vigente(p_modelo)), catalogo.precio_vigente(p_cliente, p_modelo))
$$;

revoke execute on function catalogo.modelo_vigente(bigint), notificacion.precio_lista_vigente(bigint, bigint) from public, anon, authenticated;
grant execute on function catalogo.modelo_vigente(bigint), notificacion.precio_lista_vigente(bigint, bigint) to servidor;

create or replace function notificacion.condicion(p_a operacion.aviso, out clase text, out vigente boolean, out motivo text, out ref text) returns record
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_req boolean; v_e bigint := p_a.entidad_id; v_x bigint; v_t text; v_cierra boolean; v_ubic text; v_cont_at timestamptz; v_ped operacion.pedido;
begin
  clase := 'externo'; vigente := null; motivo := null; ref := null;
  select t.requiere_accion into v_req from notificacion.tipo t where t.codigo = p_a.codigo;

  if p_a.codigo = 'conteo_con_diferencia' then
    clase := 'condicion';
    select c.ubicacion, c.contado_at into v_ubic, v_cont_at from operacion.conteo c where c.id = v_e;
    -- Sigue mientras haya una diferencia sin explicar que ningun conteo posterior de esa ubicacion haya confirmado (cuadre en cero para ese SKU).
    vigente := exists (select 1 from operacion.conteo_linea l
                        where l.conteo_id = v_e and l.diferencia <> 0 and l.explicacion_tipo is null
                          and not exists (select 1 from operacion.conteo c2 join operacion.conteo_linea l2 on l2.conteo_id = c2.id
                                           where c2.ubicacion = v_ubic and c2.estado = 'cerrado' and c2.contado_at > v_cont_at and l2.sku_id = l.sku_id and l2.diferencia = 0));
    if not vigente then
      select max(c2.id) into v_x from operacion.conteo c2 where c2.ubicacion = v_ubic and c2.estado = 'cerrado' and c2.contado_at > v_cont_at;
      motivo := 'las diferencias quedaron explicadas o un conteo posterior las confirmo';
      ref := 'conteo:' || coalesce(v_x, v_e);
    end if;

  elsif p_a.codigo = 'pedido_enviado_con_excepcion' then
    clase := 'condicion';
    select * into v_ped from operacion.pedido where id = v_e;
    v_cierra := coalesce(catalogo.config_num('aviso_excepcion_cierra_al_cobrar') = 1, true);
    if v_ped.id is null or v_ped.estado <> 'enviado' then
      vigente := false; motivo := 'el pedido ya no esta enviado (anulado o cancelado)'; ref := 'pedido:' || v_e;
    else
      -- El precio vigente de cada renglon es el de la ultima nota (la correccion lo cambia), si no el del pedido.
      -- La referencia es la foto del tabulador del renglon; si la foto esta vacia (el precio de lista se cargo despues), se usa el precio de lista VIGENTE hoy del cliente y modelo.
      --   precio_distinto_tabulador: solo cuenta con foto (igual que antes).
      --   venta_bajo_costo: sin cambio.
      --   sin_precio_catalogo: sigue si no hay foto ni lista vigente; si hay lista y lo cobrado es menor, sigue como "precio bajo tabulador"; si es igual o mayor, la causa ya no existe.
      vigente := exists (
        select 1 from operacion.pedido_aviso pa join operacion.pedido_linea l on l.id = pa.pedido_linea_id
         where pa.pedido_id = v_e and pa.codigo in ('precio_distinto_tabulador', 'venta_bajo_costo', 'sin_precio_catalogo')
           and case pa.codigo
                 when 'precio_distinto_tabulador' then coalesce((select (n.ajustes -> 'precios' ->> l.id::text)::bigint from operacion.nota n where n.pedido_id = v_e order by n.id desc limit 1), l.precio_cent) is distinct from l.precio_tabulador_cent
                 when 'venta_bajo_costo' then coalesce((select (n.ajustes -> 'precios' ->> l.id::text)::bigint from operacion.nota n where n.pedido_id = v_e order by n.id desc limit 1), l.precio_cent) <= coalesce(l.costo_unit_cent, 0)
                 else l.precio_tabulador_cent is null
                      and coalesce((select (n.ajustes -> 'precios' ->> l.id::text)::bigint from operacion.nota n where n.pedido_id = v_e order by n.id desc limit 1), l.precio_cent)
                          < coalesce(notificacion.precio_lista_vigente(v_ped.cliente_id, l.modelo_id), 9223372036854775807) end);
      if vigente and v_cierra and operacion.pedido_saldo(v_e) <= 0 then
        vigente := false; motivo := 'el pedido ya esta cobrado por completo'; ref := 'pago_aplicacion:' || coalesce((select max(pa2.id) from operacion.pago_aplicacion pa2 where pa2.pedido_id = v_e), 0);
      elsif not vigente then
        motivo := 'la nota se corrigio, el precio ya no difiere del tabulador (o ya hay precio de lista vigente y lo cobrado no es menor) y no queda bajo costo';
        ref := 'nota:' || coalesce((select max(n.id) from operacion.nota n where n.pedido_id = v_e), 0);
      end if;
    end if;

  elsif p_a.codigo = 'pieza_no_llego_saldo' then
    clase := 'condicion';
    select * into v_ped from operacion.pedido where id = v_e;
    vigente := v_ped.id is not null and operacion.saldo_cliente(v_ped.cliente_id) < 0;
    if not vigente then motivo := 'el saldo a favor del cliente ya se aplico o se devolvio'; ref := 'pedido:' || v_e; end if;

  elsif p_a.codigo = 'paquete_por_empacar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pedido p where p.id = v_e and p.estado = 'confirmado' and p.empacado_at is null);
    if not vigente then motivo := 'el pedido ya se empaco, se envio o se cancelo'; ref := 'pedido:' || v_e; end if;

  elsif p_a.codigo = 'sabor_faltante_antes_empacar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pedido p where p.id = v_e and p.estado = 'confirmado' and p.empacado_at is null)
      and exists (select 1 from operacion.pedido_linea l where l.pedido_id = v_e
                    and l.piezas_pedidas > coalesce((select u.piezas from operacion.existencia_sku_ubicacion u where u.sku_id = l.sku_id and u.ubicacion = 'bodega_omar'), 0));
    if not vigente then motivo := 'ya hay existencia del sabor o el pedido ya no espera empaque'; ref := 'pedido:' || v_e; end if;

  elsif p_a.codigo = 'llegada_pendiente_confirmar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.compra c where c.id = v_e and c.estado = 'llego_merida');
    if not vigente then motivo := 'la recepcion de la compra ya se confirmo'; ref := 'compra:' || v_e; end if;

  elsif p_a.codigo = 'diferencia_recepcion_abierta' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.compra_diferencia d where d.id = v_e)
      and not exists (select 1 from operacion.diferencia_asignacion x where x.diferencia_id = v_e and x.cancela_a is null
                        and not exists (select 1 from operacion.diferencia_asignacion y where y.cancela_a = x.id));
    if not vigente then
      motivo := 'la diferencia de recepcion ya tiene responsable asignado';
      ref := 'diferencia_asignacion:' || coalesce((select max(x.id) from operacion.diferencia_asignacion x where x.diferencia_id = v_e), 0);
    end if;

  elsif p_a.codigo = 'pago_sin_identificar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pago p where p.id = v_e and p.identificacion = 'sin_identificar')
      and not exists (select 1 from operacion.pago_identificacion i where i.pago_id = v_e);
    if not vigente then motivo := 'el pago ya se identifico'; ref := 'pago_identificacion:' || coalesce((select i.id from operacion.pago_identificacion i where i.pago_id = v_e), 0); end if;

  elsif p_a.codigo in ('cascada_lista_firma', 'utilidad_mayor_que_efectivo') then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.cierre_reparto c where c.id = v_e)
      and not exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = v_e)
      and (select count(distinct f.socio_id) from operacion.cierre_reparto_firma f where f.cierre_id = v_e) < 2;
    if not vigente then
      if exists (select 1 from operacion.cierre_reparto_anulacion a where a.cierre_id = v_e) then
        motivo := 'el cierre se anulo'; ref := 'cierre_reparto_anulacion:' || (select max(a.id) from operacion.cierre_reparto_anulacion a where a.cierre_id = v_e);
      else
        motivo := 'el cierre ya lo firmaron los dos socios'; ref := 'cierre_reparto_firma:' || coalesce((select max(f.id) from operacion.cierre_reparto_firma f where f.cierre_id = v_e), 0);
      end if;
    end if;

  elsif p_a.codigo = 'retiro_capital_por_confirmar' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.retiro_capital r where r.id = v_e) and not exists (select 1 from operacion.retiro_capital_confirmacion c where c.retiro_id = v_e);
    if not vigente then motivo := 'el retiro de capital ya lo confirmo el otro socio'; ref := 'retiro_capital_confirmacion:' || coalesce((select c.id from operacion.retiro_capital_confirmacion c where c.retiro_id = v_e), 0); end if;

  elsif p_a.codigo = 'toma_pendiente' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.toma_omar t where t.id = v_e and t.estado = 'pendiente');
    if not vigente then motivo := 'la toma ya se autorizo, se rechazo o caduco'; ref := 'toma_omar:' || v_e; end if;

  elsif p_a.codigo = 'toma_sin_precio' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.toma_omar t where t.id = v_e and t.precio_cent is null and t.estado in ('pendiente', 'autorizada'));
    if not vigente then motivo := 'la toma ya tiene precio o dejo de estar vigente'; ref := 'toma_omar:' || v_e; end if;

  elsif p_a.codigo = 'cobranza_vence_manana' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.pedido p where p.id = v_e and p.estado = 'enviado') and operacion.pedido_saldo(v_e) > 0;
    if not vigente then motivo := 'la cuenta por cobrar ya esta saldada'; ref := 'pago_aplicacion:' || coalesce((select max(pa.id) from operacion.pago_aplicacion pa where pa.pedido_id = v_e), 0); end if;

  elsif p_a.codigo = 'fondos_en_poder_socio' then
    clase := 'condicion';
    vigente := coalesce(operacion.dias_fondos_en_poder(v_e) > coalesce(catalogo.config_num('fondos_alerta_dias'), 7), false);
    if not vigente then motivo := 'los fondos de la sociedad ya no pasan del plazo en poder del socio'; ref := 'socio:' || v_e; end if;

  elsif p_a.codigo = 'paquete_incidente_reportado' then
    clase := 'condicion';
    vigente := exists (select 1 from operacion.paquete_incidente i where i.id = v_e) and not operacion.paquete_incidente_resuelto(v_e);
    if not vigente then motivo := 'el incidente del paquete ya tiene responsable y efecto registrados'; ref := 'paquete_incidente:' || v_e; end if;

  elsif p_a.codigo = 'saldo_negativo_karen' then
    clase := 'condicion';
    vigente := operacion.saldo_proveedor(v_e) < 0;
    if not vigente then motivo := 'el saldo con la proveedora ya no es negativo'; ref := 'proveedor:' || v_e; end if;

  elsif p_a.codigo = 'tarea_falla' then
    clase := 'condicion';
    v_t := p_a.payload ->> 'tarea';
    vigente := coalesce((select e.estado = 'error' from notificacion.ejecucion e where e.tarea = v_t and e.estado <> 'en_curso' order by e.inicio desc, e.id desc limit 1), false);
    if not vigente then
      motivo := 'la tarea volvio a correr sin error';
      ref := 'ejecucion:' || coalesce((select e.id from notificacion.ejecucion e where e.tarea = v_t and e.estado = 'ok' order by e.inicio desc, e.id desc limit 1), 0);
    end if;

  elsif p_a.codigo = 'telegram_entrega_muerta' then
    clase := 'condicion';
    -- Sigue mientras al mismo destino no haya salido un mensaje despues de la entrega muerta.
    vigente := exists (select 1 from notificacion.entrega m where m.id = v_e and m.estado = 'muerta')
      and not exists (select 1 from notificacion.entrega m join notificacion.entrega o on o.destino_clave = m.destino_clave and o.canal = m.canal
                       where m.id = v_e and o.estado in ('enviada', 'entregada') and coalesce(o.enviada_at, o.creada_at) > m.creada_at);
    if not vigente then
      motivo := 'Telegram volvio a entregar al mismo destino';
      ref := 'entrega:' || coalesce((select o.id from notificacion.entrega m join notificacion.entrega o on o.destino_clave = m.destino_clave and o.canal = m.canal
                                      where m.id = v_e and o.estado in ('enviada', 'entregada') order by o.id desc limit 1), v_e);
    end if;

  elsif p_a.codigo in ('comprobacion_dinero_falla', 'cuenta_proveedor_no_cuadra') then
    clase := 'externo'; -- lo resuelve notificacion.evaluar() (comprobaciones() es costoso por aviso)

  elsif p_a.codigo = 'pago_posible_duplicado' or coalesce(v_req, true) then
    clase := 'externo'; -- pide una decision de una persona y no tiene entidad: se cierra con su boton

  else
    clase := 'informativo';
  end if;
end $$;

