-- Lane telegram-ampliacion (4/4): lectura del socio de menudeo para el agente. ADITIVA: una funcion de lectura nueva, solo servidor.
-- El agente verifica en TypeScript quien manda un pedido a costo o un aviso de pago ANTES de mostrar el resumen; la base lo vuelve a exigir (agente._exigir_socio_menudeo).
create function agente.socio_menudeo() returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform notificacion.exigir_sistema();
  return (select lower(s.nombre) from catalogo.socio s where s.id = operacion.ds_socio_menudeo());
end $$;

revoke all on function agente.socio_menudeo() from public, anon, authenticated;
grant execute on function agente.socio_menudeo() to servidor;
