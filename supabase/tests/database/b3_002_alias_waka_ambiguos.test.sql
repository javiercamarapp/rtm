-- pgTAP: alias Waka AMBIGUOS (respuestas del dueno, 14-nov). Datos sinteticos.
-- Comprueba: pares aprobados corregidos, alias ambiguo con candidatos, y que el agente no ofrece como opcion el modelo generico sin existencia.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);

-- Uniones aprobadas: salen los pares con destino ambiguo; entran Icon -> Waka Icon 50K y Waka Burst 36K -> Waka 36K.
select is((select count(*)::int from catalogo.unificacion_modelo_aprobada where destino_norm in ('waka 50k', 'waka 15k', 'waka sopro 30k')), 0, 'ningun par aprobado apunta a un destino ambiguo');
select is((select destino_norm from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = 'waka icon'), 'waka icon 50k', 'Waka Icon se une a su modelo propio');
select is((select destino_norm from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = 'icon'), 'waka icon 50k', 'Icon a secas tambien');
select is((select destino_norm from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = 'waka burst 36k'), 'waka 36k', 'Waka Burst 36K se une a Waka 36K');
select is((select destino_norm from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm = 'burst'), 'waka 36k', 'Burst a secas sigue apuntando a Waka 36K');
select is((select count(*)::int from catalogo.unificacion_modelo_aprobada where regla = 'alias-waka-2026-11-14' and origen_norm in ('waka sopro', 'waka so pro')), 0, 'SoPro ya no se une a un destino ambiguo');

-- Escenario sintetico: un modelo generico "Zk 50K" (sin existencia) y dos variantes; el alias "zk 50k" es ambiguo entre las dos variantes.
select catalogo.asegurar_marca('Marca Zk');
select catalogo.asegurar_modelo('Marca Zk', 'Zk 50K', 50000, 'ambas');
select catalogo.asegurar_modelo('Marca Zk', 'Zk Uno 50K', 50000, 'ambas');
select catalogo.asegurar_modelo('Marca Zk', 'Zk Dos 50K', 50000, 'ambas');
select is(catalogo.agregar_alias('zk-a1', 'modelo', 'Zk 50K', array['Zk Uno 50K', 'Zk Dos 50K']) ->> 'ambiguo', 'true', 'el alias con dos destinos nace ambiguo');
select is(catalogo.resolver_modelo('zk 50k') ->> 'tipo', 'ambiguo', 'el resolver del catalogo tambien lo trata como ambiguo');
select ok(catalogo.resolver_modelo('zk 50k') -> 'ids' @> to_jsonb(array[(select id from catalogo.modelo where nombre_norm = 'zk uno 50k'), (select id from catalogo.modelo where nombre_norm = 'zk dos 50k')]), 'con las dos variantes entre los candidatos');
select ok(exists (select 1 from catalogo.modelo where nombre_norm = 'zk 50k'), 'el modelo generico existe (la prueba no es vacia)');
select is((select ambiguo and modelo_id is null and cardinality(candidatos) = 2 from catalogo.modelo_alias where alias_norm = 'zk 50k'), true, 'ambiguo con dos candidatos y sin modelo directo');

set local session_authorization = postgres;
select ok(not exists (select 1 from jsonb_array_elements(agente.catalogo_modelos()) x where x ->> 'nombre' = 'Zk 50K'), 'el agente no ofrece el modelo generico sin existencia');
select is((select count(*)::int from jsonb_array_elements(agente.catalogo_modelos()) x where x ->> 'nombre' in ('Zk Uno 50K', 'Zk Dos 50K') and x -> 'alias' @> '"zk 50k"'), 2, 'las dos variantes comparten el alias ambiguo: el agente pregunta entre ellas');

-- Con existencia el generico SI se ofrece (nunca queda stock invisible).
select catalogo.asegurar_sku('Zk 50K', 'Fresa');
select operacion.registrar_movimiento('zk:m', 'Zk 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 5, 100000, negocio.hoy() - 1);
select ok(exists (select 1 from jsonb_array_elements(agente.catalogo_modelos()) x where x ->> 'nombre' = 'Zk 50K'), 'con existencia el generico se sigue ofreciendo');
select * from finish();
rollback;
