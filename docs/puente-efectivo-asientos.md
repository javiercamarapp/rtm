# Puente contable del efectivo (migracion 20261111008000)

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

## Pendientes
- Flujo de efectivo: el saldo inicial se clasifica en "otros movimientos de operacion" en el metodo directo y como financiamiento en el indirecto; los totales cuadran.
- Una API web para deshacer movimientos de efectivo (hoy solo la funcion SQL).
- Revisar si el pago de clientes en efectivo y el pago de la sociedad a proveedores deben crear renglones del libro de efectivo.
