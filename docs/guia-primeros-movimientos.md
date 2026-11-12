# Guía de primeros movimientos para cuadrar cuentas

Para Javier y Angelo. Todo se hace en la app, en este orden. No se cargan datos hasta tenerlos confirmados por quien corresponde. Cada paso indica qué dato pedir y a quién.

## Antes de empezar: qué pedir a quién

| Dato | A quién | Para qué paso |
|---|---|---|
| Fecha de corte (el día desde el que se cuenta) | Entre los dos socios | Apertura, paso 1 |
| Cuánto puso cada socio en total (aportaciones) y cuánto gastó de su bolsillo sin reembolso | Cada socio | Apertura, paso 3 |
| Conteo físico por modelo y sabor, con costo puesto por pieza | Omar (conteo en bodega) y la última factura o nota de Isaac y Karen para el costo | Apertura, paso 4 |
| Efectivo en cada caja (por persona) y dinero de la sociedad en poder de cada socio | Cada socio | Apertura, paso 5 |
| Cuánto debe cada cliente, con la fecha del adeudo | Revisar notas y chats de cada cliente; cada socio confirma los suyos | Apertura, paso 6 |
| Cuánto se le debe a Isaac, y saldo a favor con Karen (si hay) | Isaac y Karen: pedirles su estado de cuenta | Apertura, paso 7 |
| Utilidades no repartidas y retiros previos | Entre los dos socios | Apertura, paso 8 |
| Historial de depósitos y pagos (si se quiere conservar) | Cada socio, copia de su banco o libreta | Movimientos (importar) |

Omar solo da el conteo de piezas. Omar nunca ve costos, márgenes ni clientes.

## Paso 1. Apertura (saldos iniciales)

Menú Apertura. Un socio abre la sesión con la fecha de corte y captura las partidas paso a paso (3 a 8): aportaciones, inventario por modelo y sabor, cajas y fondos en poder de socios, cuentas por cobrar por cliente con fecha, deuda con Isaac y saldo a favor con Karen, utilidades y retiros previos.
En el paso 9 revisa la validación: debe decir que el asiento cuadra. Si hay diferencia queda en la cuenta puente 3990; se puede dejar así o repartirla al capital 50/50 (pide justificación escrita si supera 0.5 % del activo).
En el paso 10 firma un socio y luego el otro desde su propia sesión. Con la segunda firma se publica. Después de firmar no se edita; para corregir hay que revertir con motivo.
Resultado esperado: Cuentas por cobrar, Proveedores, Cuenta de socios, Inventario y Contabilidad muestran los saldos iniciales.

## Paso 2. Importar movimientos históricos (opcional)

Menú Movimientos, Pegar o subir. Pega filas con fecha, monto (entrada positiva, salida negativa), cuenta, contraparte y mensaje. "Contar" hace el ensayo sin escribir. "Importar" guarda; repetir la importación da 0 nuevas. Después clasifica cada fila (cobro, pago a proveedor, aportación, etc.) y concilia contra el hecho registrado con la misma suma. Clasificar y conciliar no cambian saldos: solo describen y comprueban.

## Paso 3. Registrar una compra

Proveedores, elegir Isaac o Karen, Nueva orden de compra: modelo, sabor, piezas y costo; costo de la guía y quién la pagó. Confirmar, marcar enviada, capturar la guía, marcar "llegó" en Paquetes en trayecto y capturar las piezas recibidas en la recepción. Solo la recepción sube el inventario.

## Paso 4. Venta o pedido con nota

Pedidos y notas, Nuevo pedido: cliente, modelo, sabor, piezas y envío. Confirmar, empacar y "Marcar enviado" con las piezas realmente surtidas, guía, paquetería y costo real de la guía. La nota para el cliente no muestra costo ni utilidad.

## Paso 5. Cobro

En el pedido, Registrar pago (monto y a qué caja entró), o en Cuentas por cobrar, Registrar pago. Un pago parcial deja saldo. Si el cliente tiene deuda de apertura, el pago se aplica primero a esa deuda, la más antigua.

## Paso 6. Pago a proveedor

Proveedores, "Pago de la sociedad" (sale del efectivo de la empresa) o "Registrar pago de un socio" (el socio pagó con su dinero; queda como reembolso por pagar al socio). Primero se usa el efectivo de la caja de la empresa.

## Paso 7. Aportación o reembolso de socio

Cuenta de socios. "Registrar depósito de un socio" es aportación de capital solo si el socio declara que invierte; todo lo demás es reembolso. "Registrar gasto pagado por un socio" crea el gasto de la empresa una sola vez y el reembolso pendiente. "Registrar pago a un socio" liquida el reembolso. Las aportaciones desiguales no cambian el reparto 50/50.

## Paso 8. Verificar que todo cuadra

1. Contabilidad, Comprobaciones: debe decir "Todo cuadra" y ninguna bloqueante en rojo.
2. Contabilidad, Caja y liquidez: la suma por lugar o persona coincide con la liquidez total.
3. Cuentas por cobrar: el total coincide con el encabezado "Por cobrar".
4. Cuenta de socios: si dice "No cuadra", falta registrar algo (por ejemplo, el dinero que salió de la sociedad). Corrige el registro, no la cifra.
5. Reportes: Preparar reporte; el PDF solo sale si pasan las bloqueantes.
Cada cifra de dinero tiene "Explicar este número".

## Orden recomendado del primer día

Datos confirmados, Apertura completa y firmada, comprobaciones en verde, luego operación diaria (compras, ventas, cobros, pagos). Importar el historial al final.

## Estado de salud del sitio

La ruta pública es `/api/health`; `/api/salud` es un alias. Otras rutas `/api/*` sin sesión responden 401.
