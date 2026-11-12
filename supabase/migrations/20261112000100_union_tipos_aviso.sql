-- Union de las ramas de produccion con la integracion de notificaciones (20261110002100).
-- Dos funciones que ya estan en produccion (retiro de capital por confirmar, toma de Omar pedida desde su vista) emiten avisos con codigos que el catalogo
-- de tipos de 20261110002100 no conoce, y operacion.avisar rechaza todo codigo desconocido: sin estas filas, proponer un retiro de capital o que Omar solicite
-- una toma fallaria con 'tipo de notificacion desconocido'. Solo se agregan filas al catalogo; ninguna funcion cambia.
-- Nota: las funciones pasan sus propios numeros NT (NT-048 y NT-052) que chocan con los del catalogo de main; el numero NT de cada aviso se guarda tal como lo pasa la funcion.
insert into notificacion.tipo (codigo, nt, titulo, severidad, requiere_accion, no_silenciable, canal, dominio, agrupable, ttl_horas, fase, botones, campos_permitidos, activo) values
  ('retiro_capital_por_confirmar', 'NT-048', 'Retiro de capital propuesto, por confirmar por el otro socio', 'I', true, false, 'ST', 'SOC', false, 720, 'M2d', array['Confirmar retiro']::text[], array['socio', 'monto_cent']::text[], true),
  ('toma_pendiente', 'NT-052', 'Omar pidio una toma desde su vista: pendiente de autorizacion', 'I', true, true, 'ST', 'OMA', false, 720, 'M2a', array['Autorizar', 'Rechazar']::text[], array['folio', 'piezas']::text[], true)
on conflict (codigo) do nothing;
