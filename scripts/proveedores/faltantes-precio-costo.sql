-- SOLO LECTURA. Lista exacta de lo que falta de costo y precio para los modelos que vienen de Isaac y Karen. No inventa cifras: lo que falta se pone en 0 / pendiente y lo completa el dueno.
--   psql "$DATABASE_URL" -f scripts/proveedores/faltantes-precio-costo.sql        (en produccion, con el rol propietario)
-- Bloque 1: modelos de Isaac (catalogo Remate) sin costo de lista vigente de Isaac, o con costo SUPUESTO (de palabra) por confirmar.
select '1 costo Isaac' as bloque, ma.nombre as marca, mo.nombre_canonico as modelo,
       case when c.id is null then 'FALTA costo de lista de Isaac' else 'costo supuesto (de palabra): confirmar' end as estado
  from proveedores.stock_isaac_modelo si
  join catalogo.modelo mo on mo.id = si.modelo_id
  join catalogo.marca ma on ma.id = mo.marca_id
  left join catalogo.costo_proveedor c on c.modelo_id = mo.id and c.proveedor_id = catalogo.proveedor_id('Isaac') and c.vigente_hasta is null
 where c.id is null or c.supuesto
 order by 2, 3;
-- Bloque 2: modelos de Karen (leidos por el vigilante y ligados al catalogo) sin costo vigente de Karen. El monitor NUNCA lee precios de la tienda: el costo lo da el dueno.
select '2 costo Karen' as bloque, ma.nombre as marca, mo.nombre_canonico as modelo, 'FALTA costo de lista de Karen' as estado
  from proveedores.modelo pm
  join catalogo.modelo mo on mo.id = pm.canonico_id::bigint
  join catalogo.marca ma on ma.id = mo.marca_id
  left join catalogo.costo_proveedor c on c.modelo_id = mo.id and c.proveedor_id = catalogo.proveedor_id('Karen') and c.vigente_hasta is null
 where pm.canonico_id is not null and c.id is null
 order by 2, 3;
-- Bloque 3: precio por cliente. Modelos de Isaac o Karen sin precio vigente para cada cliente activo de mayoreo o credito interno (modelo x cliente).
with modelos as (
  select si.modelo_id from proveedores.stock_isaac_modelo si
  union select pm.canonico_id::bigint from proveedores.modelo pm where pm.canonico_id is not null)
select '3 precio cliente' as bloque, cl.nombre_canonico as cliente, ma.nombre || ' / ' || mo.nombre_canonico as modelo, 'FALTA precio en el tabulador' as estado
  from modelos m
  join catalogo.modelo mo on mo.id = m.modelo_id
  join catalogo.marca ma on ma.id = mo.marca_id
  cross join catalogo.cliente cl
  left join catalogo.tabulador_precio t on t.cliente_id = cl.id and t.modelo_id = mo.id and t.vigente_hasta is null
 where cl.activo and cl.tipo in ('mayoreo', 'credito_interno') and t.id is null
 order by 2, 3;
-- Bloque 4: parametros de socios sin valor definido (no se inventan).
select '4 socios' as bloque, 'caja_sociedad_cuenta_puesto_pct' as parametro,
       coalesce((select valor::text from catalogo.config where clave = 'caja_sociedad_cuenta_puesto_pct' order by vigente_desde desc limit 1), 'SIN FILA: pendiente del dueno') as valor;
