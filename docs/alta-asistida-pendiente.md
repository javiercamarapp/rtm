# Alta asistida en el bot (tareas 8 y 9): lo que falta

Entregado (verificado): `catalogo.nombre_alta_valido`, `catalogo.distancia_edicion`, `catalogo.parecido`, `catalogo.sabores_parecidos`, `catalogo.alta_sabor`, `api.conteo_agregar_sabor` (migración `20261114500200`), pgTAP `a11_003`, botón «Crear sabor nuevo» en `/inventario/conteo`.

Pendiente, sin código activo en el bot:
1. Detección en el flujo del agente (pedido, compra, conteo, existencia) de modelo, sabor, marca o cliente sin coincidencia, y tarjeta con hasta 3 parecidos y botones (`Crear`, uno de los parecidos, `Cancelar`), una sola tarjeta por lote.
2. Funciones `catalogo.alta_modelo` (marca obligatoria; puffs por omisión documentado; sin costo de lista: el bot avisa «falta costo de lista») y `catalogo.alta_cliente_asistida` (solo nombre y tipo mayoreo o menudeo; `asegurar_cliente`), con los mismos topes, idempotencia y auditoría `origen = telegram`.
3. Pulsar `Crear`: solo un socio (Omar y bodega no), con la identidad del socio que pulsa; el otro socio ve el aviso; reanudar el pedido o cobro original al crear.
4. Privacidad: un teléfono en el mensaje se enmascara antes del modelo (regla `redactarContactos`, ya existe; falta la prueba con un alta de cliente) y los datos de contacto se capturan por la web.
5. Pruebas: pgTAP de modelo y cliente, vitest de resolución y tarjeta, guion del simulador (desconocido, tarjeta, Crear, línea resuelta; typo; inyección en el nombre; Omar rechazado) y e2e.

## Notas de la verificación (migración 20261114500300)

- Umbral de «parecido» (solo sugiere, el socio confirma): sobre el nombre normalizado, distancia de edición <= min(2, max(1, 30 % de la longitud del más largo)), o el nombre MÁS CORTO (por longitud, mínimo 3 caracteres) contenido en el otro como palabras completas («uva» en «uva verde»). Nunca el mismo nombre.
- El filtro de instrucciones de `catalogo.nombre_alta_valido` es una LISTA DE PALABRAS más una lista blanca de caracteres: defensa de primera línea para tratar el nombre como dato, no una garantía. `catalogo.alta_sabor` NO debe cablearse al bot de Telegram sin otra defensa (por ejemplo, el nombre nunca se interpola en un prompt, tarjeta con la cita literal del socio y confirmación de otro socio).
- Los topes por actor (10 por hora, 30 por día) se cuentan bajo un `pg_advisory_xact_lock` por actor: dos altas simultáneas ya no pasan las dos.
