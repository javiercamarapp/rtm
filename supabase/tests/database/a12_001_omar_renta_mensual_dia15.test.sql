-- pgTAP a12_001: renta de Omar mensual con compensacion en el corte de la semana del dia 15 (decision del dueno, 16-nov). Ejemplo del dueno: la renta del periodo se
-- compensa contra lo que Omar debia por stock en la semana de pago; si la renta es mayor, los socios pagan la diferencia; si las tomas son mayores, la renta se anula y Omar paga la diferencia.
-- Renta $2.00 por pieza. Periodo 1: 300 pz (150 el 2-mar + 150 el 10-mar) = 600.00; semana de pago 15 a 21 mar (contiene el 15). Periodo 2: 100 pz el 25-mar = 200.00; semana de pago 12 a 18 abr. Datos sinteticos "A12".
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a12.socio@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('a1200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a12.socio@example.test');
select set_config('request.jwt.claim.sub', 'a1200000-0000-0000-0000-000000000001', true);
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('A12 Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('A12 Omar Cliente', 'A12 Omar');
  end if;
end $$;
create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.envio(p_clave text, p_piezas int, p_fecha date) returns bigint language plpgsql as $$
begin
  perform operacion.crear_pedido('a12' || p_clave, pg_temp.cid('A12 Cliente'), jsonb_build_array(jsonb_build_object('modelo', 'A12 Modelo 50K', 'sabor', 'Fresa', 'piezas', p_piezas)), 'bodega_omar', null, 0, 0, 0, p_fecha);
  perform operacion.confirmar_pedido('a12' || p_clave || 'c', pg_temp.pid('a12' || p_clave));
  return (operacion.enviar_pedido('a12' || p_clave || 's', pg_temp.pid('a12' || p_clave), null, null, p_fecha)->>'renta_cent')::bigint;
end $$;

select catalogo.asegurar_cliente('A12 Cliente', 'Angelo');
select catalogo.asegurar_modelo('A12 Marca', 'A12 Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('A12 Modelo 50K', 'Fresa');
select catalogo.fijar_costo('a12c', 'Isaac', 'A12 Modelo 50K', 10000, '2027-03-01', 'prueba');
select catalogo.fijar_precio('a12p', 'A12 Cliente', 'A12 Modelo 50K', 15000, '2027-03-01', 'chat');
select operacion.registrar_movimiento('a12m', 'A12 Modelo 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 600, 6000000, '2027-03-01');

select is((catalogo.config_valor('omar_renta_dia_compensacion'))::text, '15', 'parametro: dia 15');
select is(pg_temp.envio('p1', 150, '2027-03-02'), 30000::bigint, 'P-1: renta 150 x 2.00 = 300.00 (se devenga al enviar)');
select operacion.registrar_toma_omar('a12t1', '{"modelo":"A12 Modelo 50K","sabor":"Fresa"}'::jsonb, 2, 15000, '2027-03-03');
select is(pg_temp.envio('p2', 150, '2027-03-10'), 30000::bigint, 'P-2: renta 150 x 2.00 = 300.00');
select is((select sum(monto_cent)::bigint from operacion.renta_devengo where devengada_fecha between '2027-03-01' and '2027-03-31'), 60000::bigint, 'devengado del periodo: 600.00');

-- Libro: con renta devengada y SIN compensar (modo mensual) la comprobacion C17 (Omar contra el libro) sigue cuadrando.
select contabilidad.asentar_pendientes();
select is((select ok from contabilidad.comprobaciones() where codigo = 'C17'), true, 'C17 cuadra con renta devengada sin compensar (modo mensual)');

-- Semanas SIN el dia 15: la renta no se compensa; Omar paga cada semana lo que toma.
select is(operacion.renta_a_compensar_omar('2027-03-01'), 0::bigint, 'semana 1-7 mar (sin dia 15): renta a compensar 0 aunque hubo envios');
select is((operacion.saldo_omar_semana('2027-03-01')->>'renta_cent')::bigint, 0::bigint, 'saldo de esa semana: renta 0');
select is((operacion.saldo_omar_semana('2027-03-01')->>'tomas_cent')::bigint, 30000::bigint, 'tomas 300.00');
select is((operacion.saldo_omar_semana('2027-03-01')->>'neto_cent')::bigint, -30000::bigint, 'neto -300.00: Omar paga su stock de la semana');
select is((operacion.saldo_omar_semana('2027-03-01')->>'compensado_cent')::bigint, 0::bigint, 'compensado 0');
select is(operacion.renta_a_compensar_omar('2027-03-08'), 0::bigint, 'semana 8-14 mar: 0');
select is((operacion.cerrar_liquidacion_omar('a12l1', '2027-03-01', false, '2027-03-08')->>'renta_cent')::bigint, 0::bigint, 'el corte de la semana 1 no compensa renta');

-- Semana del 15 (15 a 21 mar): renta acumulada 600.00 contra tomas de 300.00 -> renta mayor: los socios pagan la diferencia.
select operacion.registrar_toma_omar('a12t2', '{"modelo":"A12 Modelo 50K","sabor":"Fresa"}'::jsonb, 2, 15000, '2027-03-16');
select is(operacion.renta_a_compensar_omar('2027-03-15'), 60000::bigint, 'semana de pago: renta acumulada 600.00');
select is((operacion.saldo_omar_semana('2027-03-15')->>'tomas_cent')::bigint, 30000::bigint, 'tomas de la semana de pago: 300.00');
select is((operacion.saldo_omar_semana('2027-03-15')->>'compensado_cent')::bigint, 30000::bigint, 'compensado: el menor (300.00)');
select is((operacion.saldo_omar_semana('2027-03-15')->>'neto_cent')::bigint, 30000::bigint, 'neto +300.00: le debemos 300.00 de renta (solo se paga lo no compensado)');
select is(operacion.cerrar_liquidacion_omar('a12l2', '2027-03-15', false, '2027-03-22')->>'palabra', 'Le debemos', 'la palabra: Le debemos');
select is((select renta_cent from operacion.liquidacion_omar where semana_ini = '2027-03-15'), 60000::bigint, 'liquidacion registra la renta del periodo: 600.00');
select is(operacion.renta_a_compensar_omar('2027-03-22'), 0::bigint, 'la semana siguiente no vuelve a compensar');

-- Periodo 2: renta 200.00 (100 pz) contra tomas de 450.00 en la semana del 15 de abril (12 a 18) -> las tomas son mayores: la renta se anula y Omar paga la diferencia.
select is(pg_temp.envio('p3', 100, '2027-03-25'), 20000::bigint, 'P-3: renta 100 x 2.00 = 200.00');
select operacion.registrar_toma_omar('a12t3', '{"modelo":"A12 Modelo 50K","sabor":"Fresa"}'::jsonb, 3, 15000, '2027-04-13');
select is(operacion.renta_a_compensar_omar('2027-04-12'), 20000::bigint, 'semana del 15 de abril: renta del periodo 200.00 (la anterior ya se compensó)');
select is((operacion.saldo_omar_semana('2027-04-12')->>'compensado_cent')::bigint, 20000::bigint, 'compensado: toda la renta (200.00), la renta se anula');
select is((operacion.saldo_omar_semana('2027-04-12')->>'neto_cent')::bigint, -25000::bigint, 'neto -250.00: Omar paga la diferencia (450.00 de stock - 200.00 de renta)');
select is(operacion.cerrar_liquidacion_omar('a12l3', '2027-04-12', false, '2027-04-19')->>'palabra', 'Omar debe', 'la palabra: Omar debe');
-- Cuadre: devengado = compensado + pendiente; la cuenta 2210 sigue siendo devengado - compensado - pagado.
select is((select sum(monto_cent)::bigint from operacion.renta_devengo) - (select sum(compensado_cent)::bigint from operacion.liquidacion_omar), 30000::bigint, 'por pagar a Omar tras las dos liquidaciones: 800.00 devengados - 500.00 compensados = 300.00 (se le pagan aparte)');
select contabilidad.asentar_pendientes();
select is((select ok from contabilidad.comprobaciones() where codigo = 'C17'), true, 'C17 cuadra tras las dos compensaciones mensuales');
-- Con el parametro en null vuelve a la compensacion semanal de la renta de esa semana.
update catalogo.config set valor = 'null'::jsonb where clave = 'omar_renta_dia_compensacion';
select is(operacion.renta_a_compensar_omar('2027-03-08'), 30000::bigint, 'sin parametro: la renta de la semana 8-14 mar (150 pz) entra en su propio corte');
select * from finish();
rollback;
