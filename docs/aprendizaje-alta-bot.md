# Aprendizaje, alta asistida, sabores por chat y recargo semanal (bot de Telegram)

Carril `bot/aprendizaje-alta`. Reglas del dueno que mandan: el modelo de IA nunca calcula dinero ni decide; el bot nunca escribe a clientes, proveedores ni Omar (todo va al grupo de los socios); sin topes ni tarjeta: el bot pregunta lo que falte; el interruptor `agente_escritura` arranca apagado (solo lectura); deshacer 10 minutos.

## Que aprende y como
- El modelo NO se entrena. Se aprenden DATOS: alias (cliente, sabor, modelo, marca, proveedor), jerga y abreviaturas, correcciones y ejemplos anonimizados.
- Un alias solo se guarda con el si de un socio (`agente.alias_proponer` pregunta; `agente.alias_responder` guarda con auditoria o registra el negativo). Deshacer alias: 10 minutos (`deshacer alias`).
- La pregunta abierta de cada chat vive en `agente.pregunta_pendiente` (una por chat, caduca a las 12 h). El id NUNCA lo pone el modelo. "si", "ok", "ya", "dale" cuentan como respuesta solo si hay una pregunta abierta en ese chat.
- Contexto del prompt (`agente.aprendizaje_contexto`): por BUSQUEDA, solo los alias y la jerga que el mensaje menciona, hasta 8 clientes recientes con sus alias y hasta 4 ejemplos; tope de 1,500 caracteres. Nunca el catalogo completo.
- Ejemplos: `src/dominio/agente/anonimizar.ts` deja solo estructura y vocabulario cerrado (sin nombres, cifras ni contactos); SQL vuelve a rechazar digitos, arrobas y enlaces; un ejemplo solo entra al contexto pasados 10 minutos y si su operacion no se deshizo.
- Correcciones: al corregir un cliente en una conversacion, `agente.correccion_registrar` cuenta (dicho -> correcto). A la segunda igual el bot SUGIERE el alias (pregunta); nunca lo guarda solo.
- Jerga propia: `jerga: el guero = el cliente del norte` o `abreviatura: efvo = efectivo` (`agente.jerga_agregar`). La semilla (ya cayo, apuntale, fiado...) es neutra.
- Revision semanal: `agente.aprendizaje_resumen` y `textoRevisionSemanal` (atajo `que aprendiste`). NO esta programada: el reloj y los avisos estan apagados.

## Altas asistidas (conversacion + `agente.alta_*`)
- Cliente: nombre, tipo, socio dueno, plazo habitual (`catalogo.cliente_plazo_habitual`, solo se sugiere). IGUAL o MUY PROBABLE a otro cliente: se pregunta antes de crear; POSIBLE: se crea y queda la pregunta en la cola. La union de clientes NO se implementa.
- Sabor: `catalogo.alta_sabor` (detecta parecidos) con modelo resuelto por nombre o alias. Se muestra en MAYUSCULAS.
- Modelo: marca, puffs y costo de lista OPCIONAL: solo con proveedor y cifra que dicta el socio; "Sin costo por ahora" no inventa nada.
- Un alta no se deshace desde Telegram (se corrige desde el software); alias y union de sabores si, 10 minutos.

## Sabores por Telegram
`duplicados pendientes` -> `agente.sabor_preguntar_chat`; la respuesta (`agente.sabor_responder_chat`) toma el `pregunta_id` de la memoria del servidor, avisa al grupo y ofrece la siguiente. `deshacer union` solo dentro de 10 minutos (`agente.sabor_deshacer` envuelto).

## Recargo de credito
`operacion.recargo_sugerido(pedido, fecha)`: 10 % simple (config `recargo_credito_bp`) de la base de la nota por cada semana COMPLETA de atraso, redondeado hacia arriba. `api.cuentas_por_cobrar` agrega por fila `semanas_atraso`, `recargo_sugerido_atraso_cent` y `recargo_pendiente_cent` (nada existente cambia; `recargo_sugerido_cent` sigue siendo el sugerido anterior de una sola vez). El bot solo SUGIERE (`agente.recargo_preguntar`) y lo aplica unicamente el socio DUENO del cliente con un si (`agente.recargo_responder` -> `operacion.registrar_recargo_credito` con el monto de SQL). `agente.recargo_menciones` entrega las lineas que los recordatorios de cobranza pueden citar; este carril NO envia recordatorios.

## Migraciones (20261116500000 a 20261116500400, todas aditivas)
tablas, alias y sabores, contexto/jerga/ejemplos, altas, recargo. `api.cuentas_por_cobrar` y `agente.sabor_deshacer` se envuelven (rename + wrap sobre la definicion vigente).

## Pruebas
pgTAP `supabase/tests/database/c5_001_aprendizaje_alta.test.sql`; vitest `test/unit/agente/aprendizaje.*.test.ts` (conversaciones simuladas con transporte falso); `test/integracion/aprendizaje_e2e.test.ts` (variable `RTM_DB_URL_APRENDIZAJE`).
