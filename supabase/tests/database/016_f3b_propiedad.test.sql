-- pgTAP F3b, prueba de propiedad: tras CUALQUIER secuencia de eventos aleatorios (compras con faltantes, pedidos de bodega y directos, cobros a cinco destinos,
-- gastos y aportaciones de socios, tomas de Omar, mermas, ajustes, correcciones y anulaciones) la suma de debitos es igual a la de creditos, el balance
-- cuadra, y cada auxiliar operativo coincide con su cuenta de control. La semilla es fija: la secuencia es reproducible.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3b.propiedad@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('74444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3b.propiedad@example.test');
select set_config('request.jwt.claim.sub', '74444444-4444-4444-4444-444444444444', true);

select catalogo.asegurar_cliente('F3P Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('F3P Omar Persona', 'F3P Omar Persona');
select catalogo.asegurar_cliente('F3P Cliente 1', 'Javier');
select catalogo.asegurar_cliente('F3P Cliente 2', 'Angelo');
select catalogo.asegurar_cliente('F3P Cliente 3', 'Javier');
select catalogo.asegurar_modelo('F3P Marca', 'F3P A', 50000, 'ambas');
select catalogo.asegurar_modelo('F3P Marca', 'F3P B', 15000, 'ambas');
select catalogo.asegurar_modelo('F3P Marca', 'F3P C', 40000, 'ambas');
select catalogo.asegurar_sku(m, s) from unnest(array['F3P A', 'F3P B', 'F3P C']) m cross join unnest(array['Uno', 'Dos']) s;
select catalogo.fijar_costo('p1' || p || m, p, m, c, '2026-11-01', 'prueba') from (values ('F3P A', 9000), ('F3P B', 11000), ('F3P C', 12000)) v(m, c) cross join unnest(array['Isaac', 'Karen']) p;
select catalogo.fijar_precio('q' || c || m, c, m, pr, '2026-11-01', 'chat') from (values ('F3P A', 15000), ('F3P B', 19000), ('F3P C', 21000)) v(m, pr) cross join unnest(array['F3P Cliente 1', 'F3P Cliente 2', 'F3P Cliente 3', 'F3P Omar Persona']) c;
select contabilidad.asentar_pendientes();

create temp table _fallos (i int, op int, codigo text, detalle text);
create temp table _bitacora (i int, op int, ok boolean, error text);

do $prop$
declare
  i int; op int; k text; v_c bigint; v_m text; v_cli bigint; v_ped bigint; v_n int; v_cuentas text[] := array['Angelo', 'Javier', 'Efectivo', 'Isaac', 'Karen'];
  v_socios text[] := array['Angelo', 'Javier']; v_origenes text[] := array['bodega_omar', 'isaac_directo', 'karen_directo', 'karen_via_isaac'];
  v_modelos text[] := array['F3P A', 'F3P B', 'F3P C']; r record; v_ok boolean; v_err text; v_s text; v_total bigint;
begin
  perform setseed(0.4137);
  for i in 1..90 loop
    op := 1 + floor(random() * 18)::int;
    k := 'pr' || i;
    v_m := v_modelos[1 + floor(random() * 3)::int];
    v_s := v_socios[1 + floor(random() * 2)::int];
    v_ok := true; v_err := null;
    begin
      if op in (1, 2) then   -- compra a Isaac, a veces con faltante al recibir
        perform operacion.crear_compra(k || 'a', 'Isaac', jsonb_build_array(jsonb_build_object('modelo', v_m, 'sabor', 'Uno', 'pagadas', 20 + floor(random() * 80)::int)), (floor(random() * 4)::int) * 5000, 0, negocio.hoy(), 'bodega', 'sociedad', case when random() < 0.3 then v_s end);
        select id into v_c from operacion.compra where folio = (select resultado->>'folio' from seguridad.operacion where clave = k || 'a');
        perform operacion.confirmar_compra(k || 'b', v_c);
        perform operacion.marcar_llego_merida(k || 'c', v_c);
        perform operacion.recibir_compra(k || 'd', v_c, (select jsonb_build_array(jsonb_build_object('linea_id', cl.id, 'sabor', case when random() < 0.5 then 'Uno' else 'Dos' end, 'piezas', greatest(cl.piezas_facturadas - (case when random() < 0.35 then 1 + floor(random() * 3)::int else 0 end), 1)))
                                           from operacion.compra_linea cl where cl.compra_id = v_c), now());
      elsif op = 3 then      -- cobro de un cliente a uno de cinco destinos, identificado o no
        perform operacion.registrar_pago(k, v_cuentas[1 + floor(random() * 5)::int], (5 + floor(random() * 400)::int) * 1000,
          case when random() < 0.8 then (select id from catalogo.cliente where nombre_canonico = 'F3P Cliente ' || (1 + floor(random() * 3)::int)) end);
      elsif op in (4, 5, 6) then   -- pedido de bodega, directo o por Karen via Isaac
        select id into v_cli from catalogo.cliente where nombre_canonico = 'F3P Cliente ' || (1 + floor(random() * 3)::int);
        if op = 4 then
          select m.nombre_canonico into v_m from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico like 'F3P %' and e.piezas >= 4 order by random() limit 1;
          select least(e.piezas, 4 + floor(random() * 20)::int) into v_n from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = v_m;
          perform operacion.crear_pedido(k || 'a', v_cli, jsonb_build_array(jsonb_build_object('modelo', v_m, 'sabor', 'Uno', 'piezas', 1), jsonb_build_object('modelo', v_m, 'sabor', 'Dos', 'piezas', 1)), 'bodega_omar', null, (floor(random() * 3)::int) * 10000, (floor(random() * 2)::int) * 5000, (floor(random() * 2)::int) * 3000, negocio.hoy());
        else
          perform operacion.crear_pedido(k || 'a', v_cli, jsonb_build_array(jsonb_build_object('modelo', v_m, 'sabor', 'Uno', 'piezas', 10 + floor(random() * 15)::int)), case op when 5 then 'isaac_directo' else 'karen_via_isaac' end, null, 0, 0, 0, negocio.hoy());
        end if;
        v_ped := (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = k || 'a');
        perform operacion.confirmar_pedido(k || 'b', v_ped);
        perform operacion.enviar_pedido(k || 'c', v_ped, null, case when random() < 0.7 then jsonb_build_object('paqueteria', 'Castores', 'numero', 'G' || i, 'costo_cent', (5 + floor(random() * 20)::int) * 1000, 'pagada_por', case when random() < 0.6 then v_s end) end, negocio.hoy(), true);
      elsif op = 7 then      -- gasto pagado por un socio
        perform operacion.registrar_gasto_socio(k, v_s, (1 + floor(random() * 90)::int) * 1000, (array['uber', 'vercel', 'openrouter', 'mantenimiento_sistema', 'otro'])[1 + floor(random() * 5)::int], 'variable');
      elsif op = 8 then      -- aportacion capital o reembolsable
        perform operacion.registrar_aportacion(k, v_s, (1 + floor(random() * 300)::int) * 1000, 'prueba', case when random() < 0.5 then 'capital' else 'reembolsable' end);
      elsif op = 9 then      -- toma de Omar autorizada por un socio
        select m.nombre_canonico into v_m from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico like 'F3P %' and e.piezas >= 3 order by random() limit 1;
        perform operacion.registrar_toma_omar(k, jsonb_build_object('modelo', v_m, 'sabor', 'Uno'), 1 + floor(random() * 3)::int);
      elsif op = 10 then     -- retiro, reembolso o devolucion de aportacion
        perform operacion.registrar_pago_a_socio(k, v_s, (1 + floor(random() * 30)::int) * 1000, (array['retiro', 'reembolso', 'devolucion_aportacion'])[1 + floor(random() * 3)::int]);
      elsif op = 11 then     -- anular un pedido enviado
        select id into v_ped from operacion.pedido where estado = 'enviado' and folio is not null order by random() limit 1;
        perform operacion.anular_pedido(k, v_ped, 'prueba');
      elsif op = 12 then     -- anular un pago
        perform operacion.anular_pago(k, (select id from operacion.pago p where not exists (select 1 from operacion.pago_anulacion a where a.pago_id = p.id) order by random() limit 1), 'prueba');
      elsif op = 13 then     -- merma
        select m.nombre_canonico into v_m from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico like 'F3P %' and e.piezas >= 2 order by random() limit 1;
        perform operacion.registrar_movimiento(k, v_m, 'Uno', 'bodega_omar', 'merma', -1);
      elsif op = 14 then     -- pago de un socio a un proveedor con su dinero o con fondos de la sociedad
        perform operacion.pago_proveedor_de_socio(k, (array['Isaac', 'Karen'])[1 + floor(random() * 2)::int], (1 + floor(random() * 200)::int) * 1000, v_s, (array['auto', 'aportacion'])[1 + floor(random() * 2)::int]);
      elsif op = 15 then     -- ajuste con el proveedor
        perform operacion.registrar_ajuste_proveedor(k, (array['Isaac', 'Karen'])[1 + floor(random() * 2)::int], (case when random() < 0.5 then 1 else -1 end) * (1 + floor(random() * 50)::int) * 1000, (array['error_bodega', 'descuento_proveedor', 'saldo_a_favor'])[1 + floor(random() * 3)::int], 'prueba');
      elsif op = 16 then     -- asignar o reasignar una diferencia de recepcion
        perform operacion.asignar_diferencia(k, (select id from operacion.compra_diferencia order by random() limit 1), (array['socio', 'proveedor', 'sociedad'])[1 + floor(random() * 3)::int], v_s, 'prueba');
      elsif op = 17 then     -- correccion de nota
        select id into v_ped from operacion.pedido where estado = 'enviado' order by random() limit 1;
        perform operacion.emitir_correccion(k, v_ped, 'prueba', null, (floor(random() * 4)::int) * 10000, (floor(random() * 3)::int) * 2000, (floor(random() * 3)::int) * 1000);
      else                   -- cierre de reparto del periodo ya terminado (si no hay) y firma de los dos no aplica: se usa liquidacion entre socios
        perform operacion.registrar_liquidacion_entre_socios(k, v_s, case v_s when 'Angelo' then 'Javier' else 'Angelo' end, (1 + floor(random() * 20)::int) * 1000);
      end if;
    exception when others then
      v_ok := false; v_err := sqlerrm;
    end;
    insert into _bitacora values (i, op, v_ok, v_err);
    -- Fuera del bloque que traga errores: el asiento de lo que si se hizo debe generarse y todo debe cuadrar.
    perform contabilidad.asentar_pendientes();
    for r in select c.codigo, c.via_a_cent, c.via_b_cent, c.nombre from contabilidad.comprobaciones() c where c.codigo in ('C3', 'C4', 'C5', 'C10', 'C12', 'C18', 'CU1', 'CU2', 'CU3', 'C19', 'C14') and not c.ok loop
      insert into _fallos values (i, op, r.codigo, r.nombre || ': ' || r.via_a_cent || ' contra ' || r.via_b_cent);
    end loop;
    for r in select s.clave, s.mayor_cent, s.operativo_cent from contabilidad.reproducir_saldos() s where not s.ok loop
      insert into _fallos values (i, op, 'aux:' || r.clave, r.mayor_cent || ' contra ' || r.operativo_cent);
    end loop;
  end loop;
end
$prop$;

select cmp_ok((select count(*)::int from _bitacora where ok), '>=', 35, 'la secuencia aleatoria ejecuto al menos 35 operaciones validas de 90');
select cmp_ok((select count(*)::int from contabilidad.asiento), '>=', 35, 'y dejo al menos 35 asientos');
select is((select count(*)::int from _fallos), 0, 'ninguna comprobacion fallo en ninguno de los 90 pasos' || coalesce(': ' || (select i || '/op' || op || ' ' || codigo || ' ' || detalle from _fallos order by i limit 1), ''));
select is((select coalesce(sum(debe_cent), 0) - coalesce(sum(haber_cent), 0) from contabilidad.asiento_linea), 0::numeric, 'la suma de debitos es igual a la de creditos');
select is((select count(*)::int from (select asiento_id from contabilidad.asiento_linea group by asiento_id having sum(debe_cent) <> sum(haber_cent)) q), 0, 'cada asiento cuadra por separado');
select is(((contabilidad.balance_general(negocio.hoy()))->>'diferencia_cent')::bigint, 0::bigint, 'el balance cuadra');
select is(contabilidad.verificar_cadena(), null::bigint, 'la cadena de hash esta integra');
select is((select count(*)::int from contabilidad.asiento a where not contabilidad.coincide_recalculo(a.id)), 0, 'recalcular las lineas de cada evento reproduce todo lo guardado');
select ok(((contabilidad.valuacion())->'identidades'->'i1'->>'cuadra')::boolean and ((contabilidad.valuacion())->'identidades'->'i2'->>'cuadra')::boolean, 'las identidades I-1 e I-2 siguen en cero de diferencia');
select ok(((contabilidad.flujo_efectivo(negocio.hoy() - 1, negocio.hoy()))->'comprobacion'->>'cuadra')::boolean, 'el flujo directo, el indirecto y los saldos coinciden');

select * from finish();
rollback;
