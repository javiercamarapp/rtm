-- Auditoria web 14-nov (H9): el alta de usuario o cambio de rol/lista de acceso es rutina, no critica. Baja a informativa (I): el aviso ya no dice "atiendelas primero".
-- Aditivo: redefine la funcion del disparador y el tipo del catalogo; los avisos ya emitidos de ese tipo pasan a informativos con la vigencia normal de 30 dias.
create or replace function notificacion.t_correo_permitido() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.rol is distinct from old.rol or new.activo is distinct from old.activo then
    perform operacion.avisar('usuario_alta_o_rol', null, 'usuario:' || substr(encode(sha256(convert_to(new.correo, 'UTF8')), 'hex'), 1, 12) || ':' || new.rol || ':' || new.activo, 'I', 'Alta de usuario o cambio de rol o de la lista de acceso', 'usuario', null,
                             jsonb_build_object('rol', new.rol, 'activo', new.activo));
  end if;
  return new;
end $$;

update notificacion.tipo set severidad = 'I', ttl_horas = 720 where codigo = 'usuario_alta_o_rol';
update operacion.aviso set severidad = 'I', caduca_at = coalesce(caduca_at, creado_at + interval '30 days') where codigo = 'usuario_alta_o_rol' and severidad = 'C';
