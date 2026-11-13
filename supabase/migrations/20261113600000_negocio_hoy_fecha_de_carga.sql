-- Fecha de negocio para CARGAS HISTORICAS (cargador de asientos y pedidos).
-- Varias funciones fechan sus eventos con negocio.hoy() y no reciben fecha (confirmar pedido o compra, capturar costo...). Al cargar historia, esos eventos quedaban en el dia de la carga
-- y no en el de la operacion (p. ej. una compra "confirmada" despues de recibida). Con la variable de sesion transaccional rtm.fecha_negocio, negocio.hoy() devuelve esa fecha.
-- Garantias: (1) sin la variable el comportamiento es IDENTICO al anterior; (2) solo se respeta si la conexion es del rol propietario (session_user = postgres: el cargador y las pruebas;
-- la web entra como authenticator y nunca lo respeta); (3) nunca puede ser una fecha futura (se topa con la fecha real); (4) un texto que no sea AAAA-MM-DD se ignora.
-- ADITIVA: create or replace (conserva permisos y dependientes), sin DROP, sin GRANT nuevo.
create or replace function negocio.hoy() returns date
language sql stable set search_path = ''
as $$
  select coalesce(
    (select least(o.f, negocio.fecha_neg(now()))
       from (select case when session_user = 'postgres' and current_setting('rtm.fecha_negocio', true) ~ '^\d{4}-\d{2}-\d{2}$' then current_setting('rtm.fecha_negocio', true)::date end as f) o
      where o.f is not null),
    negocio.fecha_neg(now()))
$$;
