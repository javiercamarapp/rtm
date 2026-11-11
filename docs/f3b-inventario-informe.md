# Informe del paso F3b-2: inventario, kardex, semaforo de cobertura, campana de avisos, PDF y exportacion (clave f3b-inventario)

Fecha: 11-nov-2026. Todo local sobre `main`: sin push, sin remoto, sin Vercel, sin Supabase en la nube. **No se cargo ningun dato real de ventas, compras, pagos ni existencias**: pruebas y capturas usan fixtures ilustrativos y los datos inventados de F1 a F3b.

## Lo que se hizo

1. **Base (migracion 0021, notificaciones).** Esquema `notificacion` con el catalogo de 123 tipos (matriz 25 y spec 26), destinatarios con leida/silenciada, entregas con estados (reintentos por 429 y 5xx con backoff, 403, migracion de chat, incierta, lease), presupuesto de 12 informativos por hora, freno de tormenta, ventana de agrupacion de 15 min, horario silencioso, respaldo por correo, tokens de 10 caracteres de un solo uso con grupo exclusivo y auditoria de pulsaciones. `operacion.avisar()` conserva su firma, valida contra el catalogo y crea destinatarios y entregas en la misma transaccion del hecho. Evaluadores de comprobaciones, cuenta con proveedor y posicion entre socios; triggers de periodos y altas de acceso. Funciones `api.*` para la campana, Tu turno y el pulso.
2. **Base (migracion 0022, inventario).** Cobertura por modelo y sabor con la demanda de la ventana medida solo en los dias con existencia, tiempo de entrega por proveedor y estados URGE, BREVEDAD, SIGUIENTE, BUENA, EXCELENTE, SOBRESTOCK, SIN HISTORIA y SIN MOVIMIENTO (casos GU-5 del doc 18). Inventario completo con valor por sabor por mayor residuo (CU3), kardex con costo promedio y comprobacion CU6, conteo ciego con previsualizacion y aviso, documentos del inventario (clientes e interna) con folio INV y huella, y cifras explicables `inventario:valor` y `cobertura:modelo`.
3. **Dominio y PDF.** Tipos de inventario, kardex y conteo; palabras del semaforo; CSV con las columnas del Excel que neutraliza formulas; texto sugerido para WhatsApp sin cifras sensibles. Motor de PDF Carta en una sola tinta: version para clientes (sin costos, utilidad ni proveedor; solo Disponible o Agotado; precios del tabulador opcionales) e interna (piezas, costo promedio, valor y semaforo). El caso de uso reserva el folio en la base, genera el PDF una vez y lo guarda con su huella: reabrir entrega los mismos bytes.
4. **Pantallas.** Inventario (valor, piezas y apartado explicables, filtros del semaforo, grafica de cobertura de `src/ui/graficas`, mapa de calor modelo por sabor, tres cantidades de compra, documentos exportados, modelos sin movimientos con "Sin dato"); Kardex por modelo y sabor con comprobacion por dos vias, reversas discontinuas y CSV; Conteo ciego con diferencias explicadas; Exportar PDF con el boton Compartir (hoja nativa del sistema con el archivo; en laptop, descarga mas texto y enlace a WhatsApp). Campana con pestanas Todas y Sin leer y marcar leido; pagina de avisos sobre el mismo nucleo; inicio con los cuatro indicadores del pulso, la cola Tu turno y lo que se acaba primero. Paquetes por hacer y en trayecto con resumen, antiguedad con tono, guia pendiente, piezas en transito (que no son existencia), llegadas sin confirmar y demorados contra el plazo del proveedor mas dias de gracia; se quita el dueno del cliente.
5. **Despachador.** `despacharUnaVez` (TypeScript, con puertos) y `scripts/latido-local.mjs` con fecha inyectada para probar ventanas, silencio y reintentos sin esperar.

## Cierre de este paso (correcciones encontradas al verificar)

- El pulso esperaba la clave `cent` en `entre_socios` y la base emitia otra forma: la clave queda unica (`diferencia_cent`) en la migracion, el tipo y el lector, con una prueba de los textos de los cuatro indicadores (`test/unit/pulso_chips.test.ts`). Se edito la migracion 0021 en lugar de agregar una nueva porque ninguna base fuera de la local la ha aplicado.
- Los modelos del catalogo sin movimientos no aparecian: ahora tienen su tabla "Sin movimientos registrados" y dicen "Sin dato", nunca cero.
- Se quito el sufijo "pz" repetido en celdas y se cambio el pie "Corte: sin datos todavia" por "Corte: al cargar la pagina".
- Las pruebas e2e de acceso y F2 se actualizaron a la nueva portada (Tu turno) y a que el dueno del cliente ya no se muestra.

## Como se verifico

```
OK     Tipos (tsc)
OK     Lint y fronteras entre capas (eslint)
OK     Guardas estaticas de diseno y dominio
OK     Escaner de secretos y correos
OK     Pruebas unitarias y de contratos (vitest)                 1225 pruebas en 69 archivos
OK     Entorno local (.env.local y rol servidor)
OK     Pruebas de base de datos (pgTAP)                          956 afirmaciones en 19 archivos
OK     Pruebas de integracion con la base local                  4 pruebas
OK     Importador: idempotencia con fixtures
OK     Importador sobre las fuentes reales
OK     Reinicio de la base local
OK     Entorno local tras el reinicio
OK     Pruebas de pantallas y acceso (Playwright)                101 pasadas (laptop 1440, iPhone 16 Pro, plegable cerrado y abierto)
VERIFICAR: OK (13 pasos, 332.0 s)
```

Capturas: 240 imagenes en `docs/capturas/f3b-inventario/` (Chromium y WebKit, claro y oscuro, 1440x900, 402x874, 344x882 y 880x860, 15 pantallas) con `manifest.md` (sha256 por archivo); se regeneran con `npm run capturas:f3b-inventario`. Nota: los perfiles moviles de las capturas usan 344x882 y 880x860 para el plegable (la spec del paso decia 344 y 880 de ancho).

## Desviaciones y decisiones propias

1. **Entrega por canal.** El nucleo registra las entregas y el despachador envia mediante puertos; en este paso no se conecta ningun adaptador real de Telegram ni de correo (requeriria llaves y red). La campana del software es la fuente de verdad, como pide la spec 26; Telegram sera espejo cuando se conecte.
2. **Migracion editada.** Ver arriba: se corrigio 0021 en sitio por ser local y no publicada.
3. **Conteo y diferencias.** La diferencia explicada se registra con motivo y emite aviso; el ajuste contable sigue el flujo existente de F3b-1, sin cambiar el plan de cuentas.
4. **Cobertura con pocos datos.** Un modelo con menos historia que la ventana minima queda en SIN HISTORIA (nunca "Urge" ni "Sobrestock" inventados), conforme al doc 18.
5. **Semaforo por modelo y por sabor.** Las dos vistas existen; el numero de cobertura se explica por dos vias en el cajon "Explicar este numero".

## Problemas

- La maquina estuvo cargada por otros procesos ajenos (servidor Next del repo de Likida en el puerto 3000, bases de Likida): no se tocaron; solo la base de RTM se uso y se detiene al final.
- Un intento anterior de este paso se interrumpio con el trabajo sin commitear; se retomo desde ese estado, se verifico completo y se commitearon los cambios en cuatro commits por causa raiz.

## Preguntas para el dueno

1. ¿Cuantos dias minimos de historia exige SIN HISTORIA (hoy el valor por omision de la spec)? Confirmar con datos reales cuando existan.
2. ¿Los precios del tabulador en la version para clientes deben salir por defecto apagados (hoy: apagados, opcionales)?
3. Para conectar Telegram y el correo de respaldo hace falta el token del bot y el remitente: ¿se hace en el paso de despliegue?
4. Nombre de la cuenta de la transcripcion (6220 o 6230), heredado de F3b-1.

## Builds y despliegues provocados

Cero builds y cero despliegues en Vercel; ningun push.
