# Puente contable del efectivo (migraciones 20261112400000 y 20261112400100)

Los eventos `movimiento_efectivo` (saldo inicial, ajuste de conteo y traspaso) ya generan asiento. Las reglas son PROPUESTAS del orquestador a falta de decision del dueno; viven como parametros y se cambian sin tocar el patron de asientos.

## Patron
Igual que f3b (0018): `contabilidad.lineas_de_evento` es una proyeccion determinista de los hechos del evento; `asentar_evento` calcula folio, hash encadenado y periodo; el trigger diferido al COMMIT lo crea. La funcion original pasa a `lineas_de_evento_base` (intacta) y la nueva solo agrega la rama de los eventos `movimiento_efectivo` y `movimiento_efectivo_anulado`. Los movimientos ya existentes sin asiento se enlazan al aplicar la migracion (idempotente).

## Reglas aplicadas
| Movimiento | Asiento | Parametro |
|---|---|---|
| Saldo inicial de una cuenta de efectivo | Cargo a 1101 (1102 si la cuenta es banco) y abono a la cuenta de apertura | `puente_efectivo_contra_saldo_inicial`, por omision 3990 |
| Sobrante de conteo | Cargo a la caja, abono a 7200 Sobrante o faltante de caja | `puente_efectivo_cuenta_diferencia_conteo`, por omision 7200 |
| Faltante de conteo | Cargo a 7200, abono a la caja | igual |
| Traspaso entre cuentas de efectivo | Solo las dos lineas de caja (1101 y 1102; el socio custodio va como dimension `socio_id`) | ninguno |
| Deshacer (`operacion.anular_movimiento_efectivo`) | Evento `movimiento_efectivo_anulado` con renglones inversos; mismas reglas con signo contrario | ninguno |

La cuenta 7200 (resultados, deudora) es nueva: entra a "otros" del estado de resultados y a la comprobacion C16.

## Desviaciones de la propuesta (decision pendiente del dueno)
1. Saldo inicial NO abona a capital aportado (3110 y 3120): C4 (bloqueante) compara esas cuentas contra las aportaciones operativas y fallaria, porque el saldo inicial no crea una aportacion. Se abona a 3990, el puente de saldos de apertura que C20 vigila hasta firmar el cuadre. Para la caja de la empresa tampoco existe una cuenta de capital de la sociedad. Si el dueno prefiere capital, hay que decidir tambien su efecto operativo (aportacion registrada) y cambiar el parametro.
2. Traspaso a un socio NO crea cuenta por pagar: `efectivo_sociedad` cuenta el efectivo a cargo de un socio como efectivo de la sociedad, de modo que solo cambia de custodio. Un pago real al socio ya se asienta con `registrar_pago_a_socio` (reembolso o retiro).

## Comprobacion C23 y explicacion
C23 compara `operacion.saldo_efectivo()` (suma de las cuentas de efectivo) con las cuentas 1101 y 1102 del libro. No es bloqueante: el efectivo de pagos de clientes y los pagos de la sociedad a proveedores ya se asientan en 1101 sin pasar por el libro de efectivo, y C23 los senala. Cuando esos flujos se unan al libro de efectivo conviene volverla bloqueante.
`api.explicar_cifra('conta:efectivo')` explica la diferencia evento por evento (efectivo operativo contra libro, con las cuentas de efectivo) y la comprueba por dos vias. En la pagina Comprobaciones, la fila C23 abre esa explicacion.

## Cajas por persona y flujos unidos al libro de efectivo (migracion 20261112400100)
Antes, C23 era solo aviso porque varios flujos movian 1101 sin pasar por el libro de efectivo. Ahora cada uno crea su renglon con disparadores AFTER INSERT (no se reescribe ninguna funcion publicada):
| Flujo | Renglon de efectivo |
|---|---|
| Cobro de cliente en efectivo (cuenta "Efectivo") y su anulacion | entra a la caja de cobros (parametro `puente_efectivo_caja_cobros`, por omision Caja de la empresa); la anulacion lo contra-asienta |
| Pago de la sociedad a un proveedor y su reversa | sale de la Caja de la empresa |
| Pago de Omar en efectivo de la sociedad (sin socio) | entra a la Caja de la empresa |
| Entrega de un socio a la sociedad y su reversa (no las de liquidacion entre socios) | entra a la Caja de la empresa |
| Reembolso pagado en el acta de corte y su contra-acta | sale de la Caja de la empresa; la compensacion del acta (lo que el socio ya tenia en su poder) regresa el mismo importe, de modo que la caja baja solo el neto, igual que 1101 |
| Caja por persona de la apertura | saldo inicial en "Efectivo de <socio>" con el evento del asiento de apertura; la reversa de la apertura lo contra-asienta |
Las contra-anotaciones no exigen saldo: si el efectivo ya se gasto, la diferencia debe verse (C24 y el conteo), no impedir la anulacion.
`contabilidad.lineas_de_evento` asigna a 1101 la dimension de la caja que recibe o entrega (la empresa = sin dimension), no la de quien deposita o entrega, cuando el evento mueve una sola caja y su efecto neto coincide con el del asiento base; si no coincide deja el asiento base y C23 y C24 lo senalan.
**C24 Cajas por persona**: `contabilidad.efectivo_por_caja()` compara cada caja con su dimension en 1101 (1102 para bancos) e incluye dimensiones del libro sin cuenta de efectivo. No bloquea (un asiento manual a 1101 la pondria en rojo; es lo esperado).
**Identidad** suma de saldos de los socios (mas lo que tienen en su poder y su deuda no efectiva) = efectivo repartido: la cascada ya la calculaba por dos vias; pgTAP 028 prueba que el efectivo del que parte es el de 1101 y 1102 del libro, y 029 prueba el acta y la contra-acta.

## Decisiones que requieren a Javier (no se inventaron)
1. En que caja entra el efectivo que cobra un cliente (hoy: Caja de la empresa; parametro). Si lo guarda quien cobra, cambiar el parametro a "Efectivo de <socio>".
2. Pagos de la sociedad a proveedores y reembolsos del acta ya NO exigen saldo de caja (a diferencia del gasto de la empresa y el pago a un socio). Con la caja en cero y sin saldo inicial el efectivo puede quedar negativo y la cascada lo rechaza ("el efectivo de la caja no puede ser negativo"). Decidir si esos pagos deben bloquearse sin saldo. Orden obligado al cargar la apertura: primero el efectivo (caja por persona), despues pagos.
3. El acta de corte da por pagado el reembolso al firmar y lo descuenta de la caja (neto de compensacion): confirmar que asi se vive en la practica.
4. Saldo inicial contra 3990 (no a capital) y traspaso a un socio sin cuenta por pagar: pendientes de la propuesta original, sin cambio.
5. Los fondos en poder de un socio de la apertura (categoria fondos_en_poder) asientan 1150 pero no crean el libro operativo de fondos (cuenta_socio_mov); no es de este carril, verificar con la apertura real.

## Pendientes
- Flujo de efectivo: el saldo inicial se clasifica en "otros movimientos de operacion" en el metodo directo y como financiamiento en el indirecto; los totales cuadran.
- Una API web para deshacer movimientos de efectivo (hoy solo la funcion SQL).
- C23 y C24 siguen sin bloquear (un asiento manual a 1101 las pondria en rojo).
