-- pgTAP: tablero de la pagina "Lo que hay en Karen". Datos sinteticos. Solo piezas, dias y conteos: ningun dinero.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('karen.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('99999999-9999-9999-9999-999999999992', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'karen.javier@example.test');

-- Catalogo y operacion sinteticos (se omiten los disparadores solo para sembrar).
set local session_replication_role = replica;
insert into catalogo.marca (id, nombre) overriding system value values (880001, 'Marca Tablero');
insert into catalogo.modelo (id, marca_id, nombre_canonico, puffs, lista_origen) overriding system value values (880001, 880001, 'Modelo Tablero 8K', 8000, 'ambas');
insert into catalogo.sabor (id, nombre_canonico) overriding system value values (880001, 'Sandia Tablero'), (880002, 'Mango Tablero');
insert into catalogo.sku (id, modelo_id, sabor_id) overriding system value values (880001, 880001, 880001), (880002, 880001, 880002);
insert into operacion.existencia_modelo (modelo_id, piezas, valor_cent) values (880001, 2, 0);
insert into operacion.existencia_sku_ubicacion (sku_id, ubicacion, piezas) values (880001, 'Bodega Omar', 2);
insert into operacion.pedido (id, folio, cliente_id, duenio_id, fecha_neg, estado, evento_id, fecha_envio) overriding system value
  values (880001, 'TAB-1', 1, 1, negocio.hoy() - 5, 'enviado', 1, negocio.hoy() - 5);
insert into operacion.pedido_linea (id, pedido_id, sku_id, modelo_id, piezas_pedidas, piezas_surtidas, precio_cent) overriding system value values (880001, 880001, 880001, 880001, 10, 10, 100);
insert into operacion.pedido_surtido (pedido_linea_id, sku_id, piezas, costo_valor_cent, evento_id) values (880001, 880001, 10, 0, 1);
set local session_replication_role = origin;

-- Estado de Karen: un modelo ligado al canonico (con dos sabores) y otro sin ligar.
select proveedores.guardar_estado(jsonb_build_object(
  'version', 1, 'inicializado', true, 'tarjetasPromo', 0,
  'modelos', jsonb_build_object(
    '900000000000000501', jsonb_build_object('id', '900000000000000501', 'handle', 'modelo-tablero-8k', 'titulo', 'Modelo Tablero 8000', 'tituloNorm', 'modelo tablero 8k', 'aliasTitulos', '[]'::jsonb,
      'marca', 'Marca Tablero', 'puffs', 8000, 'estado', 'activo', 'primeraVez', now(), 'ultimaVez', now(), 'ausencias', 0, 'primeraAusencia', null, 'sinSabores', false,
      'nuevoSinCosto', false, 'mapeo', 'confirmado', 'canonicoId', '880001', 'gruposCandidatos', '[]'::jsonb),
    '900000000000000502', jsonb_build_object('id', '900000000000000502', 'handle', 'otro-modelo', 'titulo', 'Otro Modelo', 'tituloNorm', 'otro modelo', 'aliasTitulos', '[]'::jsonb,
      'marca', 'Marca Tablero', 'puffs', null, 'estado', 'activo', 'primeraVez', now() - interval '30 days', 'ultimaVez', now(), 'ausencias', 0, 'primeraAusencia', null, 'sinSabores', true,
      'nuevoSinCosto', true, 'mapeo', 'pendiente', 'canonicoId', null, 'gruposCandidatos', '[]'::jsonb)),
  'variantes', jsonb_build_object(
    '900000000000000601', jsonb_build_object('id', '900000000000000601', 'productoId', '900000000000000501', 'saborOriginal', 'Sandia', 'saborNorm', 'sandia', 'disponible', true, 'estado', 'activa', 'ausencias', 0,
      'primeraAusencia', null, 'mapeo', 'confirmado', 'saborCanonicoId', '880001', 'cambios', '[]'::jsonb, 'inestableHasta', null, 'primeraVez', now(), 'ultimaVez', now()),
    '900000000000000602', jsonb_build_object('id', '900000000000000602', 'productoId', '900000000000000501', 'saborOriginal', 'Mango', 'saborNorm', 'mango', 'disponible', false, 'estado', 'activa', 'ausencias', 0,
      'primeraAusencia', null, 'mapeo', 'confirmado', 'saborCanonicoId', '880002', 'cambios', '[]'::jsonb, 'inestableHasta', null, 'primeraVez', now(), 'ultimaVez', now())),
  'candidatos', '{}'::jsonb, 'retenida', null, 'promociones', '{}'::jsonb, 'cola', '[]'::jsonb, 'historialVariedad', '{}'::jsonb, 'variedad', '{}'::jsonb,
  'salud', jsonb_build_object('ultimaLecturaOk', now(), 'ultimoIntento', now(), 'fallosSeguidos', 0, 'bloqueada', false, 'incidente', null), 'lecturasProcesadas', '[]'::jsonb),
  jsonb_build_array(jsonb_build_object('clave', 'sabor_regreso|900000000000000601|T1', 'tipo', 'sabor_regreso', 'productoId', '900000000000000501', 'varianteId', '900000000000000601', 'lectura', 'T1', 'en', now(), 'antes', null, 'despues', 'Sandia', 'datos', '{}'::jsonb)),
  'tab:1');

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999992', true);

select is(jsonb_array_length(api.prov_tablero() -> 'modelos'), 2, 'el tablero trae los dos modelos');
select is((api.prov_tablero() -> 'modelos' -> 0 ->> 'ventas_60d')::int, 10, 'ventas propias de 60 dias en piezas');
select is((api.prov_tablero() -> 'modelos' -> 0 ->> 'cobertura_dias')::int, 12, 'cobertura = existencia * 60 / ventas, en dias');
select is((api.prov_tablero() -> 'modelos' -> 0 ->> 'vendemos')::boolean, true, 'vendemos el modelo');
select is(api.prov_tablero() #>> '{modelos,0,sabores,1,sabor}', 'Sandia', 'sabores en orden');
select is((api.prov_tablero() #>> '{modelos,0,sabores,1,existencia_propia}')::int, 2, 'existencia propia por sabor');
select is(api.prov_tablero() #>> '{modelos,0,sabores,1,cambio_tipo}', 'sabor_regreso', 'ultimo cambio del sabor');
select is((api.prov_tablero() #>> '{modelos,1,nuevo_semana}')::boolean, false, 'un modelo de hace 30 dias no es nuevo');
select is((api.prov_tablero() #>> '{modelos,0,nuevo_semana}')::boolean, true, 'un modelo recien visto es nuevo esta semana');
select is(api.prov_tablero() #>> '{modelos,1,cobertura_dias}', null, 'sin ventas no hay cobertura (no se inventa)');
select is(jsonb_array_length(api.prov_tablero() -> 'recomendaciones'), 1, 'una recomendacion: solo el modelo que vendemos y que Karen tiene');
select ok(api.prov_tablero() #> '{recomendaciones,0,motivos}' ? 'reponer', 'motivo reponer (12 dias de cobertura)');
select ok(api.prov_tablero() #> '{recomendaciones,0,motivos}' ? 'llego_y_vendemos', 'motivo llego un sabor que vendemos');
select is(api.prov_tablero() #>> '{recomendaciones,0,sabores_sugeridos,0}', 'Sandia', 'sabor sugerido: el que vendemos y Karen tiene');
select is(jsonb_array_length(api.prov_tablero() #> '{recomendaciones,0,sabores_sugeridos}'), 1, 'el sabor agotado en Karen no se sugiere');
select is(replace(api.prov_tablero()::text, '"nuevo_sin_costo"', '"x"') ~* '"[a-z_]*(precio|price|costo|monto|importe|_cent)[a-z_]*":', false, 'ninguna clave del tablero es un importe (nuevo_sin_costo es una bandera)');
select is(has_function_privilege('authenticated', 'proveedores.tablero_karen()', 'EXECUTE'), false, 'la web solo entra por api.prov_tablero');
select is(has_function_privilege('authenticated', 'api.prov_tablero()', 'EXECUTE'), true, 'api.prov_tablero la ejecuta el socio');
select is(has_function_privilege('anon', 'api.prov_tablero()', 'EXECUTE'), false, 'anon no');
select is((select activo from seguridad.interruptor where clave = 'lectura_proveedores'), false, 'la migracion no enciende la lectura');
select * from finish();
rollback;
