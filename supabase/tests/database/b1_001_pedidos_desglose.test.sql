-- pgTAP: api.pedidos_desglose() (Bodega / Dropshipping) y la llave tipo_venta de api.pedidos_lista(). Datos SINTETICOS.
-- Verifica: solo socio activo; los niveles cuadran entre si; las cifras salen de la misma fuente que la lista; un pedido de bodega nuevo mueve solo el grupo de bodega.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('pd.socio@example.test', 'socio', 'Javier', true), ('pd.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('61111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pd.socio@example.test'),
  ('62222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pd.omar@example.test');

select set_config('rtm.canal', 'importacion', true);
select catalogo.asegurar_cliente('Pd Cliente', 'Javier');
-- Enviar un pedido de bodega devenga renta a la persona de bodega: en una base limpia hay que darla de alta (como en 903).
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('Pd Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('Pd Omar Cliente', 'Pd Omar');
  end if;
end $$;
select catalogo.asegurar_modelo('Pd Marca', 'Pd Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('Pd Modelo 50K', 'Fresa');
select catalogo.fijar_costo('pdc1', 'Isaac', 'Pd Modelo 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_costo('pdc2', 'Karen', 'Pd Modelo 50K', 9000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('pdp1', 'Pd Cliente', 'Pd Modelo 50K', 15000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('pdm1', 'Pd Modelo 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 100, 1000000, '2026-11-08');
select set_config('rtm.canal', '', true);

-- Lo que habia antes (la base de prueba puede traer pedidos): se compara por diferencias.
create temp table _antes as select nivel, clave, pedidos, piezas, enviados from operacion.pedidos_desglose_filas();
grant select on _antes to authenticated;

-- Socio activo
select set_config('request.jwt.claim.sub', '61111111-1111-1111-1111-111111111111', true);
set local role authenticated;
select ok((api.crear_pedido('pdx1', (select (x->>'id')::bigint from jsonb_array_elements(api.clientes_lista()) x where x->>'nombre' = 'Pd Cliente'),
  '[{"modelo":"Pd Modelo 50K","sabor":"Fresa","piezas":40}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-10', null, 30)->>'folio') ~ '^P-\d{4}$', 'se crea un pedido de bodega');
select lives_ok($$select api.confirmar_pedido('pdx1c', (select (x->>'id')::bigint from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Pd Cliente' limit 1))$$, 'confirmar');
select lives_ok($$select api.enviar_pedido('pdx1s', (select (x->>'id')::bigint from jsonb_array_elements(api.pedidos_lista()) x where x->>'cliente' = 'Pd Cliente' limit 1), null, null, '2026-11-10', true)$$, 'enviar');
create temp table _d as select api.pedidos_desglose() as d;
grant select on _d to authenticated;

select is((select count(*)::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'total'), 1, 'una fila total');
select ok((select count(*) between 1 and 2 and bool_and(x->>'clave' in ('inventario_merida', 'dropshipping')) from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'surtido'), 'filas de surtido: solo bodega y/o dropshipping (solo las que tienen pedidos)');
select is((select (x->>'pedidos')::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'total'), jsonb_array_length(api.pedidos_lista()), 'el total cuenta todos los pedidos de la lista');
select is((select sum((x->>'pedidos')::int)::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'surtido'), jsonb_array_length(api.pedidos_lista()), 'bodega + dropshipping = total');
select is((select sum((x->>'pedidos')::int)::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'proveedor'), jsonb_array_length(api.pedidos_lista()), 'la suma por proveedor = total');
select is((select sum((x->>'facturado_cent')::bigint)::bigint from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'surtido'),
          (select (x->>'facturado_cent')::bigint from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'total'), 'facturado: surtidos suman el total');
select is((select (x->>'facturado_cent')::bigint from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'total'),
          (select coalesce(sum((p->>'cobrado_cent')::bigint), 0)::bigint from jsonb_array_elements(api.pedidos_lista()) p where p->>'estado' = 'enviado'), 'facturado = lo cobrado de los enviados de la lista');
select is((select (x->>'por_cobrar_cent')::bigint from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'total'),
          (select coalesce(sum(greatest((p->>'saldo_cent')::bigint, 0)), 0)::bigint from jsonb_array_elements(api.pedidos_lista()) p where p->>'estado' = 'enviado'), 'por cobrar = saldos positivos de la lista');
select is((select sum((x->>'pedidos')::int)::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'tipo'),
          (select (x->>'pedidos')::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'surtido' and x->>'clave' = 'dropshipping'), 'por tipo de venta suma el total de dropshipping');
select is((select (x->>'pedidos')::int - coalesce((select a.pedidos from _antes a where a.nivel = 'proveedor' and a.clave = 'bodega_omar'), 0) from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'proveedor' and x->>'clave' = 'bodega_omar'), 1, 'el pedido nuevo suma 1 a Bodega Omar');
select is(coalesce((select (x->>'pedidos')::int from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'proveedor' and x->>'clave' = 'karen'), 0) - coalesce((select a.pedidos from _antes a where a.nivel = 'proveedor' and a.clave = 'karen'), 0), 0, '... y 0 a Karen');
select is((select (x->>'piezas')::int - coalesce((select a.piezas from _antes a where a.nivel = 'surtido' and a.clave = 'inventario_merida'), 0) from jsonb_array_elements((select d from _d)) x where x->>'nivel' = 'surtido' and x->>'clave' = 'inventario_merida'), 40, '... con 40 piezas en bodega');
select ok((select bool_and(p ? 'tipo_venta') from jsonb_array_elements(api.pedidos_lista()) p), 'la lista trae la llave tipo_venta');
reset role;

-- Omar y sin sesion no entran
select set_config('request.jwt.claim.sub', '62222222-2222-2222-2222-222222222222', true);
set local role authenticated;
select throws_ok($$select api.pedidos_desglose()$$, '42501', null, 'omar: sin desglose de pedidos');
select throws_ok($$select operacion.pedidos_desglose_filas()$$, '42501', null, 'la funcion de operacion no es ejecutable desde la API');
reset role;
set local role anon;
select throws_ok($$select api.pedidos_desglose()$$, '42501', null, 'anon: sin desglose de pedidos');
reset role;

select * from finish();
rollback;
