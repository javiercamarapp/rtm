# Guía de primeros movimientos: cuadrar cuentas con datos reales

Para Angelo y Javier. Está escrita en el orden en que conviene hacerlo. Cada paso dice qué pantalla abrir, qué dato capturar, a quién pedírselo y qué debe verse al terminar. Todo se hace desde la propia aplicación; no hace falta tocar la base de datos.

Las cifras de las capturas de esta guía (`docs/capturas/cuadre/`) son de demostración y no tienen relación con los datos reales.

## Reglas que conviene recordar antes de empezar

1. RTM se opera como un solo negocio. Los socios solo aparecen en sus cuentas (aportaciones, reembolsos, fondos en su poder, retiros).
2. Los saldos de arranque se cargan una sola vez, en la pantalla **Apertura**, con una fecha de corte. Todo lo que ocurra después del corte se captura como operación normal (compra, pedido, cobro, pago).
3. Lo que ocurrió antes del corte (historial de movimientos de dinero) se puede pegar en **Movimientos**: sirve para consultar y comparar, pero no mueve ningún saldo. Los saldos salen únicamente de la apertura y de la operación posterior.
4. Aportación de capital solo si el socio declara que es capital o reinversión. Todo lo demás que un socio pone o paga es un reembolso (cuenta por pagar al socio).
5. La apertura se firma entre los dos socios, cada uno desde su propia sesión. Una apertura firmada no se edita; se revierte con un motivo escrito y se vuelve a cargar.
6. La inteligencia artificial nunca calcula dinero ni escribe a clientes. Omar no ve costos, márgenes, clientes ni contactos.

## Paso 0. Antes de la apertura (una sola vez)

| Qué verificar | Dónde | A quién se le pide |
|---|---|---|
| Que existan en el catálogo todos los modelos y sabores que hay en bodega, con su costo de Isaac y de Karen | Catálogo y precios | Isaac y Karen: lista vigente de modelos, sabores y costos |
| Que existan todos los clientes con saldo pendiente y su precio por modelo | Clientes | Javier y Angelo: lista de clientes que hoy deben algo |
| Que exista la persona de bodega (Omar) configurada. Sin ella la aplicación no deja marcar un pedido como enviado y responde "no hay persona de bodega configurada (Omar Yacaman)" | **Clientes**: abre la ficha del cliente que presta la bodega (Omar; si no existe, créalo con "Nuevo cliente") y pulsa **Marcar como persona de bodega**, luego Confirmar. El botón solo aparece mientras no haya una configurada y es idempotente. El importador (`npm run importar:nube`, ver `docs/DESPLIEGUE.md`) también la da de alta | Javier |
| Que los dos socios tengan acceso (correo en la lista de permitidos) | Inicio de sesión | Javier |

Si un modelo, sabor o cliente no existe, la apertura no lo deja cargar: primero se da de alta en el catálogo (el paso 2 de la apertura muestra cuántos hay).

## Paso 1. Reunir los datos de apertura

Definan una fecha de corte (un día en que se pueda contar la bodega y cerrar cuentas) y reúnan esto. Nada de esto se inventa ni se estima: si un dato no está, se deja sin cargar y se anota como pendiente.

| Dato | Quién lo entrega | Cómo se obtiene |
|---|---|---|
| Fecha de corte | Angelo y Javier | Acuerdo entre los dos |
| Aportaciones de capital de cada socio | Angelo y Javier, cada uno la suya | Lo que cada uno declara haber puesto como capital |
| Gastos pagados de bolsillo por un socio y aún no reembolsados | Cada socio | Comprobantes o mensajes de lo que pagó |
| Existencias por modelo y sabor (piezas contadas) | Omar cuenta en bodega; un socio anota | Conteo físico el día del corte |
| Costo puesto por pieza de cada sabor | Isaac y Karen (costo) más la guía y seguros que pagaron los socios | Facturas, notas de compra y guías. Omar no interviene en costos |
| Efectivo de la sociedad por persona (cajas) | Cada socio | Conteo de efectivo el día del corte |
| Dinero de la sociedad en poder de un socio (cobros que cayeron en su cuenta personal) | Cada socio | Estado de su cuenta o sus mensajes de cobro |
| Cuentas por cobrar: cliente, monto y fecha del adeudo | Javier y Angelo; confirmar con cada cliente por mensaje | Notas enviadas y pagos recibidos hasta la fecha |
| Lo que se debe a Isaac y lo que se debe a Karen, o saldo a favor de la sociedad (anticipos) | Isaac y Karen | Su estado de cuenta al corte, por separado |
| Utilidades asignadas y no retiradas, y retiros anteriores | Angelo y Javier | Lo que acordaron entre ellos |
| Faltante de piezas de la compra inicial (deuda de un socio) | Angelo y Javier | Recepción contra factura |

## Paso 2. Cargar la apertura (pantalla Apertura)

Abre **Apertura** y pulsa "Abrir la apertura" (una sola sesión vigente a la vez). Después, en este orden:

1. **Alcance:** confirma la fecha de corte. No debe ser futura (la validación lo avisa).
2. **Catálogo:** revisa que los conteos de modelos, clientes y proveedores sean los esperados.
3. **Socios:** una partida "Aportación" por socio y una "Gasto pagado por un socio" por cada reembolso pendiente.
4. **Inventario:** una partida por modelo y sabor, con piezas y costo puesto por pieza (o valor total del sabor). Un sabor no se carga dos veces en la misma sesión.
5. **Caja y fondos:** "Caja" por cada persona que tenga efectivo de la sociedad; "Fondos en poder" por el dinero de la sociedad en la cuenta personal de un socio.
6. **Por cobrar:** una partida por cliente con su monto y la fecha del adeudo. Los pagos futuros del cliente se aplican primero a esta deuda, la más antigua.
7. **Proveedores:** "Lo que se debe" a Isaac o a Karen, o "Saldo a favor" si hay un anticipo. Cada proveedor por separado.
8. **Utilidades y deuda:** utilidad no repartida, retiros previos y faltantes por cobrar a un socio.
9. **Validación:** revisa la identidad (activo, pasivo y capital), la vista previa y el ensayo. Ninguno de los dos escribe nada. La diferencia contra la identidad queda en la cuenta puente 3990. Elige "Mantenerla en la cuenta puente 3990" mientras investigan la diferencia (C20 queda en rojo hasta resolverla), o "Repartirla al capital 50/50 (el centavo impar a Angelo)" cuando la diferencia ya esté explicada (si supera 0.5 % del activo se exige una justificación escrita).
10. **Firma:** firma el primer socio; el segundo firma desde su propia sesión y la segunda firma publica la apertura.

Qué debe verse al terminar:

- En Apertura: estado "Publicada" con las dos firmas.
- En el encabezado: "Por pagar a Isaac" y "Por cobrar" con las cifras cargadas, y "En bodega" con las piezas contadas.
- En **Cuentas por cobrar**: el total por cobrar, la antigüedad de cada saldo y la tarjeta "Saldos de apertura por cobrar".
- En **Proveedores**: la cuenta con Isaac o Karen con su saldo inicial.
- En **Contabilidad > Comprobaciones**: "Todo cuadra" solo si NO elegiste "Mantenerla en la cuenta puente 3990" con una diferencia distinta de cero. En ese caso la comprobación C20 (cuadre inicial, no bloqueante) queda en rojo a propósito mientras la diferencia exista, y el título dice "N de 27 comprobaciones no cuadran (ninguna bloquea reportes)". Se pone en verde al repartir la diferencia al capital.

Si algo está mal después de firmar: Apertura > paso 10 > "Revertir la apertura", con el motivo. Falla si ya salió mercancía de esos modelos; en ese caso se corrige con un movimiento normal.

## Paso 3. Importar movimientos históricos (opcional, no mueve saldos)

Pantalla **Movimientos > Pegar o subir**. Pega las filas (de una hoja de cálculo o CSV) con estas columnas, en este orden si no hay encabezado: fecha, monto, cuenta, origen, mensaje. Entradas positivas y salidas negativas. También se reconocen encabezados como fecha, entrada, salida, cuenta, origen, mensaje.

1. Pulsa "Contar" para un ensayo: dice cuántas filas son nuevas y cuáles tienen error (con su número de línea). No escribe nada.
2. Pulsa "Importar". Volver a importar el mismo contenido da cero filas nuevas.
3. En la **Bandeja**, cada fila entra "Sin clasificar". Pulsa Clasificar para asignarla a un cliente, pedido, socio o proveedor, y Conciliar cuando exista el hecho con la misma suma (un cobro, un pago o una aportación ya registrados).

Clasificar y conciliar describen y comprueban, pero no crean cobros ni pagos: un movimiento sin clasificar no afecta ningún saldo.

## Paso 4. Operar con normalidad después del corte

### Registrar una compra a Isaac o Karen

**Proveedores > Nueva orden de compra**: modelo, sabor, piezas pagadas y costo (sale del catálogo). Costo y pagador de la guía. Después: Confirmar > Marcar enviada > guía de entrada > en **Paquetes en trayecto** pulsa "Llegó" > en la orden, captura las piezas recibidas y confirma la recepción. El inventario sube solo cuando se confirma la recepción.

### Registrar una venta con su nota

**Pedidos y notas > Nuevo pedido**: elige el cliente, modelo, sabor, piezas y el envío. Confirmar > Empacar > Marcar enviado (piezas realmente surtidas, número de guía, paquetería y costo real de la guía). La nota para el cliente no muestra costos ni utilidad. La hoja interna sí.

### Registrar un cobro

En el pedido: "Registrar pago" y elige en qué caja cayó (la de Angelo o la de Javier). O desde **Cuentas por cobrar > Registrar pago**, eligiendo el cliente. El pago se aplica primero a la deuda de apertura (la más antigua) y después a los pedidos.

### Registrar un pago a proveedor

**Proveedores**: "Pago de la sociedad" si se pagó con efectivo de la sociedad, o "Registrar pago de un socio" si un socio pagó con su dinero (queda como reembolso pendiente al socio).

### Aportación, gasto o reembolso de un socio

**Cuenta de socios**:

- "Registrar depósito de un socio": dinero que el socio pone. Es capital solo si declara que es inversión; si no, es un reembolso.
- "Registrar gasto pagado por un socio": baja la utilidad una sola vez y deja un reembolso pendiente.
- "Registrar pago a un socio": reembolso o retiro de utilidad. Primero se usa el efectivo de la sociedad; no se reembolsa más de lo pendiente.

## Paso 5. Comprobar que todo cuadra

Revisa, en este orden:

1. **Contabilidad > Comprobaciones**: debe decir "Todo cuadra". Si una comprobación falla, el renglón muestra las dos vías de cálculo para ver dónde está la diferencia.
2. **Contabilidad > Balance general**: "Activo igual a pasivo más capital: cuadra" y diferencia de cero.
3. **Cuentas por cobrar**: el total coincide con el chip "Por cobrar" del encabezado.
4. **Proveedores**: el saldo con Isaac y Karen coincide con su estado de cuenta.
5. **Cuenta de socios y Cascada de reparto**. Son dos identidades distintas y no tienen por qué coincidir:
   - **Cascada, "Identidad por dos vías"**: debe decir "Cuadra". El efectivo que muestra ("calculado de las cajas") incluye el efectivo de la apertura por persona; debe ser igual a lo que dice Contabilidad > Caja y liquidez en efectivo. La comprobación CA2 lo vigila (libro 1101 contra Cascada) y se pone en rojo si algún día difieren.
   - **Cuenta de socios, "Diferencia por la compra"**: compara lo que pusieron los socios con la mitad del costo de la compra y cuadra (via 1 = via 2) cuando los socios ponen entre los dos TODO el costo, neto de los fondos de la sociedad que tienen en su poder. En la demostración la compra costó 5,250.00 y la sociedad pagó 1,000.00 de su caja; hasta que cada socio registra su pago de bolsillo (**Proveedores > Registrar pago de un socio > Dinero propio**, 2,900.00 cada uno en la demostración) Socios dice "No cuadra" y el aviso "Parte del costo no la pusieron los socios" da la cifra exacta (5,800.00 en la demostración), que es justo la diferencia entre las dos vías. Con esos pagos queda en cero, el aviso desaparece y Socios dice "Cuadra" (probado en pgTAP `a4_005`, y en el recorrido de Playwright). Lo que salió de la caja de la sociedad no se puede reclasificar; si en la vida real esa salida debe contarse como puesta por los socios es una decisión pendiente del dueño, no se cambió la regla.
   - **Pago de la sociedad a un proveedor**: descuenta el efectivo total de la Cascada y de Caja y liquidez por igual (CA2 en verde). Todavía no mueve ninguna caja por persona: de qué caja sale el pago es decisión pendiente del dueño.
6. **Reportes**: "Preparar reporte". El reporte sale como definitivo solo cuando el periodo está aprobado y las comprobaciones pasan; en caso contrario sale "Preliminar" o "Parcial" y lo dice.

## Errores frecuentes

| Mensaje o síntoma | Causa | Qué hacer |
|---|---|---|
| "no hay persona de bodega configurada (Omar Yacaman)" al marcar un pedido enviado | No está dada de alta la persona de bodega | Ficha del cliente que presta la bodega > Marcar como persona de bodega (ver Paso 0) |
| "Ese paso ya no aplica al estado actual. Recarga la página." | Otra persona cambió el estado, o falta un dato de configuración (ver el texto entre paréntesis) | Recargar; si el paréntesis dice otra cosa, resolver eso primero |
| La apertura no deja agregar un sabor | Ese sabor ya está cargado en la sesión o no existe en el catálogo | Revisar el paso 4 o dar de alta el sabor |
| Diferencia en la cuenta puente 3990 | Los saldos cargados no cuadran con el capital declarado | Mantenerla mientras se investiga; resolver en el paso 9 |
| Una ruta de la API responde 401 | No hay sesión; es lo esperado | `/api/health` y `/api/salud` son públicas y responden 200 |

## Lo que debe pedirse a cada persona (resumen)

- **Isaac:** estado de cuenta al corte (qué se le debe o anticipo), costos vigentes por modelo, compras en camino con su guía.
- **Karen:** igual que Isaac, por separado. Sus costos se marcan como supuesto hasta tener factura.
- **Clientes:** confirmación de su saldo y de la fecha del adeudo.
- **Omar:** conteo físico por modelo y sabor el día del corte. No se le piden ni se le muestran costos.
- **Angelo y Javier:** aportaciones, efectivo de sus cajas, fondos de la sociedad en su poder, gastos de bolsillo pendientes, retiros previos y utilidades no repartidas.
