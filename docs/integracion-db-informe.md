# Informe del paso integracion-db: reportes, proveedores, costos y agente de Telegram contra la base de datos

Fecha: 12-nov-2026. Rama `main` de `/Users/javiercamaraportepetit/rtm`, sin push, sin remotos nuevos, sin tocar Vercel ni Supabase en la nube. **No se cargo ningun dato real de ventas, compras, pagos ni existencias**: pruebas, capturas y demostracion usan fixtures ilustrativos. Ningun servicio externo se llamo en las pruebas: Telegram, IA, la fuente del inventario de proveedores y el reloj son dobles; no se leyo `~/.bodega-secrets`, correos, tokens ni llaves.

## Lo que se hizo

Cuatro migraciones nuevas (0025 a 0028), todas con RLS forzada, sin privilegios para `anon` ni `authenticated`, escritura solo por funciones `SECURITY DEFINER` idempotentes y lecturas por `api.*`. El rol `servidor` (sin BYPASSRLS) ejecuta solo lo que se le concede.

1. **Costos del sistema (0025, esquemas `costos` e `ia`).** Servicios sembrados con su metodo de atribucion, tipo de cambio fechado, cargos y reembolsos de solo insercion, parametros, dato faltante, conciliacion, presupuesto, uso de Claude y libro de llamadas de IA. El cargo es un **gasto de la sociedad pagado por Javier**: `costos.registrar_cargo` llama a `operacion.registrar_gasto_socio`, asi que el asiento (Dr 62xx / Cr 2320), la cuenta por pagar y la cascada salen de la ruta de siempre; el reembolso llama a `operacion.registrar_pago_a_socio('reembolso')`. La base **recalcula** el monto con las gemelas del techo (`costos.techo`, numeric) y rechaza cualquier cifra distinta de la del dominio TypeScript (P0452). Anular = reversa enlazada (la original no se toca). Pagina `/costos` con resumen exacto y redondeado por separado, tarjetas por servicio con logos oficiales, cargos con "Explicar este numero" y comprobacion por dos vias, cuenta con Javier con reembolso en dos pasos, formulario con vista previa del efecto y tipo de cambio.
2. **Inventario actual de proveedores (0026, esquema `proveedores`).** Estado vigente en tablas (modelo, variante, promocion, cola), solo cambios como eventos, foto diaria idempotente, presupuesto con tope de 40 peticiones al dia por `INSERT ... ON CONFLICT DO UPDATE ... WHERE usadas < 40`, y avisos P-01 a P-20 y V-1 traducidos a los tipos del catalogo de notificaciones con `operacion.avisar`. Ninguna columna es un importe y `guardar_estado` rechaza claves de importe (P0461). Pagina `/proveedores/inventario` (estado de la fuente, promociones, modelos con sabores, nombres por confirmar, cambios recientes), **Copiar lista para cliente** (filtros, precios del tabulador del cliente elegido, combinar con existencia propia, bloqueada con dato de mas de 3 horas, sin nombrar al proveedor) y **Crear orden de compra a Karen** (lleva al formulario de compras con el modelo elegido y los sabores agotados bloqueados). La tarea de lectura horaria existe y solo corre con el interruptor `lectura_proveedores` encendido y con la fuente configurada por variable privada; en pruebas usa un puerto simulado.
3. **Agente de Telegram (0027, esquema `agente`).** Miembros por id de Telegram y chats cargados desde configuracion privada (script `scripts/agente/registrar-miembros.mjs`, sin ids en el repo), reclamo por `update_id` y por (chat, mensaje), presupuesto de IA con la logica de `presupuesto.ts` (reserva, liquidacion, liberacion, alerta al 80 %), tokens de un solo uso para botones (rol, chat, caducidad, un solo uso, grupo exclusivo), modo sin IA, corridas del modelo sin texto de usuarios y eventos sin contenido. El webhook `/api/telegram/webhook` valida el secreto en tiempo constante (sin secreto configurado rechaza todo) y llama al nucleo del agente con adaptadores de Postgres. Las indicaciones de un socio se ejecutan directo con las funciones de negocio de siempre (gasto, aportacion) con eco y deshacer; las tomas de Omar quedan **pendientes** (reserva, sin kardex ni saldo) hasta que un socio autoriza con boton. El bot manda al grupo de los dos socios; Omar solo recibe su lista cerrada. Los avisos de M1 (campana) y M2 (Telegram) llegan al grupo por el despachador existente, con un enviador de lotes nuevo.
4. **Reportes (0028, esquema `rep`).** Publicacion de solo insercion por clave y version, PDF y HTML por sha256, entrega registrada por canal, configuracion con vigencia, `rep.insumos_semanal` y `rep.insumos_mensual` (pedidos con lineas, historia de 12 semanas, clientes, inventario por modelo, cartera, gastos, comprobaciones C1 a C22, estado de resultados, costos del sistema, series de 24 meses). Paginas `/reportes` (preparar, historial con estados DEFINITIVO, PRELIMINAR, PARCIAL y borrador), vista previa con el HTML guardado en un marco sin scripts y PDF con la sesion. **El correo va sin adjunto y con enlace autenticado**; el grupo recibe el resumen con el enlace. El PDF no se adjunta a Telegram (interruptor `telegram_adjuntar_pdf` apagado).
5. **Latido y tareas (0027 y `src/config/tareas.ts`).** Tablas `notificacion.programacion` y `notificacion.ejecucion` (una fila por tarea y ventana), reclamo idempotente, `cron_pausado`, y la **lista de cron en un solo archivo**. `/api/tareas/latido` (secreto en cabecera) despacha avisos, reintenta, caduca tomas y ejecuta las tareas debidas; `vercel.json` no existe (solo el latido iria ahi, y no se creo nada de Vercel).

## Pruebas

| Prueba | Resultado |
|---|---|
| pgTAP nuevos (023 costos, 024 proveedores, 025 agente, 026 reportes) | 24 + 31 + 68 + 33 afirmaciones |
| vitest | ver cierre del informe |
| Integracion contra la base (transaccion revertida) | 14: paridad del techo SQL y TypeScript en 600 casos, paridad del presupuesto de IA en 100 secuencias, webhook con secreto, idempotencia por `update_id`, indicacion de Javier con canal telegram y reserva de IA liquidada, toma de Omar pendiente y autorizada una sola vez, latido con proveedores, semanal con Chromium real y despacho por Telegram simulado |
| Playwright | ver cierre del informe |

## Desviaciones (la spec 14, las adendas 18 a 29 y los documentos 25 y 26 mandan sobre lo anterior)

1. **Correo con enlace, sin adjunto.** `CLAUDE.md` dice "reportes por correo CON PDF adjunto" (decision del 11-nov); la instruccion de este paso, la spec 26 (R4) y el documento 16 dicen sin adjunto y con enlace autenticado. Se siguio la instruccion de este paso y se cambio el puerto `EntregaReportes.correoDuenos(correo, enlace)`, el texto del correo y los dorados. **Pregunta 1.**
2. **Costos sin tipos de evento nuevos.** El informe 17 y la lane pedian `costo_cargo_registrado`, `reembolso_costos`, etc. Se reutilizan `gasto_socio` y `pago_a_socio` porque el plan de cuentas ya trae 6210 a 6250 y 2320 = "Pagos de Javier por cuenta de la sociedad" (esto cierra el pendiente de reconciliar 2320). Sin `v_costos_a_cargo_de_angelo`: el reembolso es de la sociedad (adenda 20 y 21).
3. **Un solo aviso para Telegram y correo de un reporte** (tipo STC): la entrega de correo queda registrada y `omitida` mientras `correo_envio` este apagado. **El envio real por Resend no esta construido** (necesita llave): pendiente.
4. **Avisos "de resumen" de proveedores** (P-03 y P-05 de poca importancia, P-07, P-10, P-12, P-19, P-20) usan el tipo del catalogo, que fija el canal; los que son ST salen a Telegram aunque el modulo los marco "resumen". El resumen de las 20:00 no esta construido.
5. **`rep.insumos_*` omite lo que la base aun no puede derivar** (no se inventa): liquidacion con la hoja del proveedor, flujo con cobros prometidos, comparativo de la cuenta entre socios, conteo ciego, comparacion Isaac y Karen y la tendencia de cartera. Salen como "sin datos"; los vacios reales de captura (guias sin costear, conteo semanal sin hacer) marcan el reporte PARCIAL. Piezas por caja y plazos de proveedor son parametros en `catalogo.config` (por caja = 1 hasta que el dueno lo defina). **Pregunta 2.**
6. **PDF y HTML en `rep.blob`** (bytea) y no en un almacenamiento de archivos: no hay servicio de archivos local. El paquete de cifras no se guarda completo (el HTML si).
7. **Agente: negocio parcial.** `NegocioAgente` en Postgres soporta gasto, aportacion, toma de Omar (con autorizar, rechazar y caducar), deshacer de gasto y de toma, y consultas de existencia, cuenta entre socios, saldo de cliente y de proveedor. Pedido, pago de cliente, compra, orden de compra y pago a proveedor devuelven "eso todavia no lo registro desde Telegram" y se hacen en el software. Un gasto de la caja de la sociedad (sin socio que lo pague) pide aclarar.
8. **Las tomas escritas por un socio tambien quedan pendientes** (spec 14 y 26, como el modulo del agente). La caducidad de tomas corre en cada latido.
9. **El latido de proveedores y los demas lectores externos** (Vercel, OpenRouter, Banxico) no estan construidos: el tipo de cambio se captura a mano y los cargos automaticos quedan para la ola de despliegue.
10. **Los logos son los oficiales sin alterar**, uno por tema (negro en claro, blanco en oscuro). Telegram solo con su nombre en texto (su logo es azul y no hay variante monocroma); Higgsfield con su icono y el nombre. La licencia es declaracion del dueno, no verificada.

## Problemas encontrados y corregidos en el camino

- Los asientos nacen al COMMIT (trigger diferido): una prueba de integracion que genera un reporte dentro de una transaccion revertida veia las comprobaciones C4, C5 y C12 en rojo. Se adelantan con `set constraints all immediate`; en produccion el reporte corre despues del commit.
- `nuevo_sin_costo` (bandera booleana del modelo de proveedores) coincidia con el patron de "costo": la defensa de privacidad de la base compara claves exactas, como la del dominio.
- Una sola conexion no admite sentencias intercaladas con savepoints: la prueba de integracion serializa sus consultas.
- Cargar Chromium y las fuentes desde la ruta del webhook hacia que Turbopack rastreara todo el proyecto: la preparacion de reportes vive aparte (`composicion/reportes_sistema.ts`) y se carga solo al generar.
- La lista de rutas seguras del login no incluia `/reportes` ni `/costos` (la sesion caia en `/`).

## Preguntas para el dueno

1. El correo de reportes: este paso lo quiere sin adjunto y con enlace autenticado, pero `CLAUDE.md` del 11-nov dice con PDF adjunto. ¿Cual manda? (Hoy: sin adjunto.)
2. ¿Cuantas piezas trae una caja por modelo y que plazo de entrega usa cada proveedor? Hoy: 1 pieza por caja, 7 dias con Isaac y 10 con Karen (supuestos de la spec 26).
3. ¿Se enciende `telegram_envio` y se registra el grupo en M2, o se deja la campana hasta el despliegue? Los interruptores nacen apagados.
4. ¿Autorizan la lectura real de promociones (`promociones_lectura`) despues de validar el parser con una lectura autorizada? Los fixtures HTML son sinteticos.
5. ¿Que lista de proyectos de Claude cuenta para el prorrateo? El patron por omision es la carpeta del repo (incluye worktrees).
6. Las tomas de Omar pendientes caducan a las 72 horas (spec 26): ¿esa ventana es la correcta?

## Pendientes reales

- Envio por Resend (correo corto), lectores de Vercel, OpenRouter y Banxico, topes de IA por rol en la pantalla de costos y "Discrepo" de Angelo.
- Resumen diario de las 20:00, vigilancia de membresia del grupo, comandos `/tope`, `/anular`, `/explicar`, lectura de fotos y audios, fusion de mensajes cortos y outbox con reintentos del agente.
- Confirmar nombres de la cola de proveedores desde la pantalla (hoy solo se muestran), sugerencia de reposicion y avisos P-13 a P-16 de stock propio.
- Pedido, pago, compra y orden de compra por Telegram; version de Omar del reporte; liquidacion con el proveedor y flujo de caja en los insumos de reportes; axe real y linea base de pixeles del reporte.
- Probar con un telefono real y con el bot real (token, grupo y webhook se configuran con variables privadas en el despliegue).

## Consumo y estado

Builds de Vercel: 0. Despliegues: 0. Paquetes npm agregados: ninguno. Base local: una (Supabase de RTM), detenida al terminar; sin servidor de la app ni Chromium en marcha. Variables privadas que el despliegue debe definir: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_MIEMBROS` (solo para el script de alta), `OPENROUTER_API_KEY`, `TAREAS_SECRETO`, `INVENTARIO_PROVEEDORES_FUENTE`, `INVENTARIO_PROVEEDORES_CONTACTO` (nombres en `.env.example`, sin valores).
