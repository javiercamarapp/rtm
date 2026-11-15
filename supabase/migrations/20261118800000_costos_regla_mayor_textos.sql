-- Costos: los textos sembrados de Vercel y Supabase decian "lo menor entre la cuota base y el consumo real", pero la decision del dueño es el MAYOR
-- (la cuota base es el piso) y la migracion 20261118200000 ya sembro la regla 'mayor'. Migracion aditiva e idempotente: solo corrige texto, no toca montos,
-- cargos ni reglas. Re-ejecutarla no cambia nada porque los filtros solo alcanzan filas con el texto viejo.

update costos.servicio set
  metodo_atribucion = 'Participación por consumo en el equipo compartido; se cobra lo MAYOR entre la cuota base (editable, es el piso) y el consumo real; sin consumo declarado vale 0'
  where slug = 'vercel' and metodo_atribucion like '%lo menor entre la cuota base%';

update costos.servicio set
  metodo_atribucion = 'Participación por horas de cómputo en la organización compartida; se cobra lo MAYOR entre la cuota base (editable, es el piso) y el consumo real; sin consumo declarado vale 0'
  where slug = 'supabase' and metodo_atribucion like '%lo menor entre la cuota base%';

update costos.cuota_base set
  nota = 'Cuota del documento inicial; regla: se cobra lo MAYOR entre esta cuota (editable, es el piso) y el consumo real (decision del dueño, 14-nov)'
  where regla = 'mayor' and nota like '%lo menor entre esta cuota y el consumo real%';
