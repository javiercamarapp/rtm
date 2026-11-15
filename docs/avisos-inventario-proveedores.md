# Avisos de inventario, compras, proveedores, clientes y pedidos (carril bot/inventario-proveedores)

Todo nace APAGADO y no se envia nada real. Destinatario unico: el grupo de los socios. El modelo de IA no interviene; cada cifra sale de SQL y TypeScript solo redacta.

## Interruptores
- General: `seguridad.interruptor.avisos_inventario` (apagado). Cada regla: `agente.aviso_regla.activo` (todas apagadas). Un socio los cambia con `/avisos encender|apagar` y `/avisos regla CODIGO encender|apagar` (`agente.avisos_fijar`, identidad verificada).
- La lectura del sitio de Karen sigue en `lectura_proveedores` (apagada); la direccion vive solo en la variable privada. Isaac no tiene fuente viva: `agente.lista_proveedor_diff(proveedor, lista, emitir)` compara una lista cargada a mano (nombres; el costo solo como sentido y porcentaje entero).

## Reglas (codigo, canal, enfriamiento)
inv_reponer (M, 72 h; I si urge en el top 5), inv_agotado (M, 168 h), oc_llega (M), oc_atraso (M; I desde 2 dias), oc_sin_fecha (M), oc_faltante (M), oc_llego (I, una vez por recepcion; sabores nuevos y reposiciones cerradas), prv_llego (M; I si es top 3), prv_costo (M; I si algun cliente queda bajo 5 % de margen; solo sentido y porcentaje, nunca el importe), prv_puente, prv_lista, cli_sin_comprar (S), cli_vencido_pide (I), cli_concentracion (S), ped_pendiente_envio (M), ped_guia_pendiente (M), ped_sin_entrega (M; I a los 10 dias), din_descuento (I), cli_pago_dup (I). Umbrales en `agente.aviso_regla.umbral`.
- Reposicion: con 28 dias de historia usa `operacion.cobertura` mas el transito; sin ellos usa el minimo manual por modelo y sabor (`agente.minimo_manual`, comando `/minimo`) y sale etiquetada Estimado.
- Puente del monitor: `prv_puente` toma los avisos YA confirmados del monitor (su ciclo ya deduplica, aplica umbral de confianza y detecta candidato a confirmado) y decide el canal por relevancia (vendemos el modelo, hay existencia o transito, marca vendida, puffs). Al ENCENDERLA, los tipos de aviso del monitor pasan a canal SW (solo campana) para que Telegram reciba una sola version; al apagarla se restauran a ST.

## Cola, limitador y cableado con el reloj
- `agente.aviso_encolar(codigo, clave, payload, canal, estado)` es la unica puerta de la cola (clave estable + enfriamiento; enfriamiento 0 = hecho unico). `notificacion.emitir(codigo, clave, payload, canal)` es la interfaz generica: se crea SOLO si el carril de reloj no la definio.
- `agente.avisos_inventario_evaluar(hoy, modo)`: `emitir` (reglas activas), `silencioso` (carga todo lo vigente como historico: hacerlo ANTES de encender cada regla) y `simular` (solo lista).
- `agente.avisos_digest_armar(ventana, ahora)` / `avisos_digest_confirmar(...)`: silencio 21 a 07, 3 inmediatos al dia, 6 mensajes al dia (criticos saltan el tope pero cuentan), 12 lineas por mensaje.
- Cableado pendiente de la ola de reloj (NO se hizo aqui): en cada latido llamar `avisos_inventario_evaluar(null,'emitir')` y luego `ejecutarRelojAvisos(puerto, transporte, ahora)` (`src/aplicacion/agente/avisos_inventario.ts`) con un `TransporteGrupo` que mande al grupo de los socios. Si el reloj ya trae su digest, basta con leer `agente.aviso_cola` pendientes.

## Comandos del bot (solo socios)
`/vende` (mas vendidos 28 dias y disponibilidad en Karen), `/reponer`, `/minimo [modelo sabor piezas]` (pregunta lo que falte; cifra completa, sin k ni mil), `/avisos`. Tambien frases como "que se vende" y "que reponer".

## Pruebas
pgTAP `supabase/tests/database/iv_001_avisos_inventario.test.sql` (97 aserciones), vitest `test/unit/agente/avisos_inventario.test.ts` (reloj simulado, transporte falso, conversaciones) y e2e `test/integracion/avisos_inventario_e2e.test.ts` (variable `RTM_DB_URL_INVENTARIO`).

## No incluido
PRV-8 (cambio de precio visto en la pagina de Karen): exige abrir la guarda de importes del monitor y requiere decision explicita del dueno. Tampoco: venta sin stock al crear el pedido, punto de reorden formal, ranking semanal, silenciar por clave, hook sincrono de cliente vencido al confirmar el pedido (hoy sale por el reloj).
