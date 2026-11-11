# Informe del paso F3b-1: contabilidad de partida doble, estados y comprobaciones (clave f3b-asientos)

Fecha: 11-nov-2026. Alcance: plan de cuentas completo, asiento de partida doble generado por cada evento en la misma transaccion, periodos con reversas, cadena de hash, comprobaciones C1 a C22 por dos vias, estado de resultados con tres utilidades, balance, flujo de efectivo, valuacion/liquidez/deudas como identidad contable, funcion que explica cualquier saldo movimiento por movimiento y la seccion Contabilidad completa en el sidebar. Todo local sobre `main`: sin push, sin remoto, sin Vercel, sin Supabase en la nube. **No se cargo ningun dato real de ventas, compras, pagos ni existencias**: pruebas, capturas y demostracion usan fixtures ilustrativos y los casos dorados de los documentos 02, 10b y 18.

## Lo que se hizo

1. **Migracion 0018 (base).** Esquema `contabilidad` con plan de cuentas (58 cuentas, incluidas 3210/3220, 3310/3320, 3900, 1101/1102, 4120, 5110, 1150/1160, 2310/2320, 1340, 3990 y la de Costos de mantenimiento del sistema, 6250), `periodo`, `asiento` y `asiento_linea` de solo insercion, `comprobacion` y `reapertura`. `contabilidad.lineas_de_evento(evento)` es una funcion pura STABLE que deriva las lineas de los hechos inmutables del evento (inventario, cuentas con proveedor y socios, aportaciones, gastos, pagos, pedidos y notas, renta, tomas de Omar, libro de socios, pagado de mas fuera de la sociedad, manuales y reversas). Un trigger de restriccion **diferido al COMMIT** sobre `operacion.evento` genera el asiento cuando el evento ya tiene todos sus hechos; otro trigger diferido exige debe = haber por asiento. Cada asiento guarda `hash_anterior` y `hash` (sha256 del contenido canonico mas el anterior); los folios `A-0001...` salen del contador sin huecos. Un asiento con fecha de un periodo aprobado o publicado se registra en el primer periodo abierto con marca de periodo afectado: el reporte viejo no cambia.
2. **Migracion 0019 (estados).** `reproducir_saldos()` (libro contra cada auxiliar operativo), `comprobaciones()` con C1 a C22 mas CU1 a CU3, `estado_resultados`, `balance_general`, `flujo_efectivo` (directo, con conciliacion indirecta), `valuacion` (V01 a V06, L01 a L04c e identidades I-1 e I-2), `movimientos_cuenta` y `verificar_asiento` (cuadre, determinismo, cadena de hash, saldos), `verificar_cadena`, ciclo de periodo (`preparar`, `aprobar`, `publicar`, `reabrir`), asiento manual con motivo y reversa de asientos manuales, funciones `api.conta_*`, y la extension de `api.explicar_cifra` con `conta:saldo`, `conta:v01..v06`, `conta:l01/l02` y `conta:utilidad`. Termina enlazando los eventos existentes con su asiento (`asentar_pendientes`, idempotente).
3. **Seccion Contabilidad.** Primer nivel del sidebar con ocho paginas: Valuacion, Diario (con boton Verificar), Mayor (por cuenta, con saldo corrido y cajon), Estado de resultados, Balance general, Flujo de efectivo, Comprobaciones (con auxiliares y ciclo de periodos) y Proyecciones (sin dato). Cada cifra abre "Explicar este numero" con su comprobacion por dos vias; sin movimientos dicen "Sin dato".
4. **Dominio TypeScript.** `validarAsiento` (validacion pura, la misma regla que el trigger) y `rangos` de fechas, con pruebas de propiedad.

## Casos dorados y propiedad

| Prueba | Resultado |
|---|---|
| Compra inicial: confirmar, pagar, recibir 1,524 de 1,536 (guia 2,375.00, 1,552 pagadas) | Dr 1320 140,615.00; los 1,440.00 de mas salen del capital de Angelo; recibir: Dr 1310 139,516.45, Dr 1340 1,098.55, Cr 1320 140,615.00; costo promedio 9,154.6224 centavos |
| Puente de 12 piezas asignado a Angelo | Dr 1170 1,098.55 / Cr 1340 1,098.55; puente del libro igual al puente operativo |
| E1 a E4 del documento 18 (GU-3) | V01 166,460.38; V02 20,200.00; V03 146,260.38; V04 5,645.38; V06 140,615.00; V05 0.00; I-1 e I-2 en cero |
| GU-6 liquidez | L01 6,000.00 |
| GU-4 retiro de 3,000.00 | la utilidad no cambia, la diferencia y la liquidez bajan 3,000.00 |
| Estado de resultados del ejemplo | bruta 5,845.38, contribucion 5,645.38, neta 5,645.38 |
| Anular un pedido enviado | libro y auxiliares vuelven juntos; todos los auxiliares coinciden |
| GU-9 asientos | UPDATE y DELETE fallan; una linea suelta descuadra; si se altera una linea, `verificar_cadena` devuelve exactamente ese asiento |
| Periodos | preparar, aprobar, asiento tardio que cae en el periodo abierto con marca de afectado, publicar, reabrir con motivo y registro |
| Propiedad | 90 pasos aleatorios con semilla fija (compras con faltantes, pedidos de bodega y directos, cobros a cinco destinos, gastos, aportaciones, tomas de Omar, mermas, ajustes, correcciones, anulaciones): tras cada paso C3, C4, C5, C10, C12, C14, C18, C19, CU1, CU2 y CU3 en verde y cada auxiliar coincide; 84 asientos generados |
| Commit real con el rol de la web | `test/integracion/contabilidad_commit.test.ts`: tres escrituras con rol `authenticated` confirman y dejan su asiento cuadrado |

## Como se verifico

```
OK     Tipos (tsc)
OK     Lint y fronteras entre capas (eslint)
OK     Guardas estaticas de diseno y dominio
OK     Escaner de secretos y correos
OK     Pruebas unitarias y de contratos (vitest)                 1206 pruebas en 66 archivos
OK     Entorno local (.env.local y rol servidor)
OK     Pruebas de base de datos (pgTAP)                          738 afirmaciones en 17 archivos
OK     Pruebas de integracion con la base local                  4 pruebas (dos son de asientos al confirmar)
OK     Importador: idempotencia con fixtures
OK     Importador sobre las fuentes reales (43 costos, 19 clientes, 179 lineas, 12 en cero, 17 de Karen)
OK     Reinicio de la base local
OK     Entorno local tras el reinicio
OK     Pruebas de pantallas y acceso (Playwright)                83 pasadas
VERIFICAR: OK (13 pasos, 344.3 s)
```

Capturas: 224 en `docs/capturas/f3b-asientos/` (Chromium y WebKit, claro y oscuro, 1440x900, 402x874, 344x882 y 880x860, 14 pantallas) con `manifest.md`; se regeneran con `npm run capturas:f3b`.

## Defectos encontrados y corregidos en el camino

- **El trigger de cuadre corria con el rol de la web** y no podia leer el esquema `contabilidad`: tumbaba cualquier escritura confirmada (dos pantallas de F2 y F3a fallaron en Playwright). pgTAP no lo ve porque corre en una transaccion que nunca confirma. Corregido (`security definer`) y agregada una prueba de integracion que confirma de verdad con el rol `authenticated` y falla sin la correccion.
- La ruta `/contabilidad` no estaba en la lista de rutas propias de `next` del login: el acceso con enlace volvia a la raiz. Agregada con su prueba.
- Un asiento con varias lineas de 2410 no se netea cuando difieren las dimensiones (cobro sin pedido contra aplicacion al pedido): es correcto, la prueba ahora compara debe contra haber.

## Desviaciones y decisiones propias

1. **Donde nace el asiento.** Por un trigger diferido sobre `operacion.evento`, no dentro de cada funcion de negocio de F2 y F3a: asi ningun evento existente cambio de codigo y cualquier ruta de escritura queda cubierta. Un evento sin efecto contable (por ejemplo, cambiar un estado) no genera asiento. El ordenamiento de la cadena es el del COMMIT.
2. **Plan de cuentas.** Se aceptaron las cuentas de 02, 10b y 18 y se agregaron: 1170/1180 (faltantes de recepcion por cobrar a un socio, adenda 29), 5400 (ajustes con proveedores: descuentos, errores y seguros pactados) y 6250 (mantenimiento del sistema). Las tomas de Omar van a 4120 (18, A-2) y la renta a 6110, las guias de salida a 6120 y las de pedido directo a 5110 (02). Para los costos del sistema se usaron 6210 nube, 6220 IA y transcripcion, 6230 software, 6240 dominio (doc 17), distinto de 02 que pone la transcripcion en 6230: queda por confirmar.
3. **3900 no es transitoria de cierre.** Es la contrapartida de la utilidad asignada a los socios en un cierre firmado; el resultado no asignado se calcula siempre de las cuentas 4 a 7 y el balance lo muestra como "resultado acumulado". La identidad es V03 = V06 + V05 + V04.
4. **Lista C1 a C22.** Los documentos no la dan completa: 14 manda a 02 para C13 a C22, 02 llega a C13 y 10b agrega C16 a C22; ademas C10 y C11 significan cosas distintas en 02 (balance y resultado) y en 14 (asientos cuadrados y periodo cerrado). Se uso la numeracion de 14 y 10b, se llevaron el balance y el resultado a CU1 y CU2 (doc 18) y se definieron C14 (ventas por cliente contra ingresos del libro) y C15 (salidas del kardex contra piezas de notas y tomas). Bloqueantes: C3, C4, C5, C10, C11, C12, C18, C21 y CU1 a CU3.
5. **Pedidos directos.** Su costo se acredita a 2110 o 2120 al enviar (con el seguro de reenvio de Karen via Isaac a 5110 y 2110), aunque F2 no lo registra en la cuenta con el proveedor sino en la hoja de F3a. C7 compara el libro contra la cuenta del proveedor mas esos costos mas lo pagado de mas fuera de la sociedad.
6. **Pagado de mas fuera de la sociedad (los 1,440.00).** Se reclasifica al confirmar la orden: Dr capital del socio / Cr proveedor, igual que `cuenta_socios()` que ya lo resta; el memorando del balance lo lista.
7. **Pagos a socios sin compensacion** (retiro, reembolso, devolucion de aportacion por pantalla) salen de 1101 (caja de la sociedad), que puede quedar negativa porque hoy no hay caja registrada; la devolucion de capital y el retiro debitan 3210/3220 (contra capital), el reembolso 2310/2320. La cascada firmada compensa primero contra lo que el socio tiene en su poder y el resto sale de 1101.
8. **Reparto 50/50 del estado de resultados:** el residuo de un centavo se asigna siempre a Angelo (regla de 02), no "a favor de quien paga".
9. **Aprobar el periodo.** Se permite desde el lunes siguiente al fin de la semana (hoy >= fin + 1), no solo en lunes. Preparar con comprobaciones bloqueantes en rojo no cambia el estado y devuelve la lista de las que fallan (la corrida queda guardada).
10. **Reversa de asientos solo para asientos manuales.** Un asiento de negocio se corrige anulando la operacion que lo genero (anular pedido, pago, compra), que ya hace su contramovimiento.
11. **Flujo de efectivo.** El directo clasifica por tipo de evento; la conciliacion indirecta usa las cuentas de capital de trabajo y financiamiento. Se comparan los totales (variacion de fondos) y el saldo final menos el inicial; el reparto operacion/financiamiento entre ambos metodos no se exige igual.
12. **Liquidez.** L01 dice "Sin dato" mientras ningun asiento toque 1101, 1102, 1150 o 1160. L03 es la falta por saldar con Isaac de la semana de liquidacion vigente; no se construyeron L05 ni el simulador de pedido (B-1, M2).
13. **No hay formulario en pantalla para el asiento manual ni para la reversa**: existen la funcion SQL y la accion (lista cerrada), que es la herramienta para los saldos de apertura que cargara el dueno.
14. **Sin avisos NT.** No se emiten avisos de periodo aprobado ni de comprobaciones en rojo (matrices 25 y 26): pertenecen al paso de notificaciones.

## Hallazgos sobre pasos anteriores (no se cambiaron)

- `anular_compra` (F2) revierte el cargo con el proveedor pero **no** la guia pagada por un socio: el libro conserva esa guia en 1320 y en 2310/2320, y `reproducir_saldos` la cuenta aparte para que C4 no falle. Convendria revertirla.
- `anular_pedido` no revierte el gasto de guia del pedido: el libro lo conserva (y C7 lo cuenta), la hoja de proveedor de F3a excluye el pedido anulado completo. Pueden diferir cuando se anula un pedido con guia.
- El script de demostracion de F1 registra una salida de 30 piezas "de pedido" sin pedido: C15 y C16 la marcan correctamente como fuga y C20 muestra el cuadre inicial pendiente; en las capturas esas tres comprobaciones aparecen en rojo a proposito.
- Reparacion de la ronda 1: las resoluciones de una diferencia de recepcion ya tienen funcion operativa y asiento (migracion 0020): castigar (Dr 5300 / Cr 1340), reponer (Dr 1310 / Cr 1340, con entrada al kardex) y acreditar (`asignar_diferencia` al proveedor, Dr 2110 / Cr 1340); la comision de terminal entra por `registrar_gasto_socio` con categoria `terminal` (Dr 6140). Siguen sin funcion operativa y por tanto sin asiento: devoluciones de dinero (4220), cruce entre clientes (1330), incobrables (6310), ganancia o perdida cambiaria y gastos pagados por anticipado (1410). Las cuentas existen, inactivas donde corresponde; cada una necesita antes su efecto en el estado de cuenta del cliente o del proveedor. Los costos del sistema entran por `registrar_gasto_socio` con categoria vercel, supabase, openrouter, claude, dominio o mantenimiento_sistema.

## Problemas y avisos

- Mientras trabajaba, otra sesion mantuvo un Supabase de otro worktree de RTM encendido; espere a que lo apagara antes de levantar el mio (maximo una base local). Al terminar deje detenido el mio y sin servidor de la app.
- No se probo en un telefono real.
- La base local queda con las listas reales importadas (75 modelos) y sin hechos de negocio, como al final de F3a.

## Consumo

Builds de Vercel: 0. Despliegues: 0. Paquetes npm agregados: ninguno. Commits atomicos: 8.

## Preguntas para el dueno

1. ¿La aprobacion semanal debe ser exactamente en lunes o desde el lunes en adelante (hoy es lo segundo)? ¿Se aprueban tambien los meses, o solo las semanas?
2. Un retiro o reembolso pagado sin cascada sale hoy de la caja de la sociedad (1101, que puede quedar negativa). ¿Debe salir de lo que el socio tiene en su poder (1150/1160) cuando alcanza, como en el ejemplo GU-4 del documento 18?
3. ¿Los costos del sistema van en 6210 a 6240 por servicio, o todo en la cuenta unica de Costos de mantenimiento del sistema (6250)? Hoy las categorias conocidas van por servicio y lo demas a 6250.
4. ¿Aceptas que el residuo de un centavo del reparto 50/50 vaya siempre a Angelo?
5. Saldos de apertura: ¿construimos ya la pantalla guiada del cuadre inicial (hoy solo existe el asiento manual de apertura por funcion)?
6. ¿Revertimos la guia pagada por un socio al anular una orden de compra, y el gasto de guia al anular un pedido (hallazgos de arriba)?
7. Las devoluciones de dinero, el cruce entre clientes, los incobrables, la ganancia o perdida cambiaria y los gastos pagados por anticipado necesitan primero su funcion operativa (nota de credito al cliente, ajuste en dolares con el proveedor, devengo mensual): ¿en que ola?
