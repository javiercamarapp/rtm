# Fondos de la sociedad en poder de un socio: aportación neta o cuenta por cobrar (decisión contable PENDIENTE del dueño)

Pedido del dueño (13-nov): no presentar los fondos en poder de un socio como que el socio "debe"; presentarlos como reducción de su aportación/valuación neta, con la regla de que ambos socios siguen metiendo dinero y deben aportar equitativamente.

## Qué se implementó (solo presentación, sin tocar el libro)

- `api.socios_aportacion_neta()` (solo lectura) y una tarjeta en Cuenta de socios: por socio `Aportado`, `Fondos de la sociedad en su poder`, `Aportación neta` (aportado menos fondos) y `Diferencia a igualar` (lo que le falta a su aportación neta para alcanzar la mayor).
- "Aportado" = capital (apertura, declarado, reinversión por acta) + dinero propio puesto como reembolso (`operacion.aportado_socio`). No incluye pagos directos a compras ni partidas fuera de la sociedad.
- Los textos de la página ya no dicen "él debe" ni "la sociedad le debe" para los fondos: dicen "A su favor" y "Fondos de la sociedad en su poder".
- El libro NO cambia: sigue la cuenta 1150 "Fondos de la sociedad en poder de socios" (activo) con su auxiliar `cuenta_socio_mov`; `Libro conciliado` y el auxiliar contra mayor siguen en verde (probado en `033_dropshipping_a_costo_socio_aportacion_neta.test.sql`).

## Comparación contable (para decidir)

| | A. Cuenta por cobrar al socio (hoy en el libro) | B. Reducción de aportación neta (contra capital) |
|---|---|---|
| Asiento al cobrar en la cuenta del socio | Debe 1150 fondos en poder; Haber 1210 clientes | Debe 3150 (nueva, contra-capital del socio); Haber 1210 clientes |
| Balance | El activo sigue contando el dinero (1150) | El activo ya no incluye ese dinero; el capital del socio baja lo mismo |
| Valuación total (V01) | Igual: cuenta 1150 como activo | Baja por los fondos en poder (el dinero está fuera de la sociedad) |
| Valuación por socio | No cambia hasta que entregue | Baja la del socio que tiene los fondos |
| Cuando el socio entrega a la caja | Haber 1150, Debe 1101 | Haber 3150, Debe 1101 |
| Alertas "fondos sin entregar" | Se conservan tal cual | Habría que reexpresarlas |
| Riesgo | Lenguaje de deuda | Cambia el significado del capital contable y de la identidad I-1/I-2 de la valuación; exige migrar auxiliares |

Recomendación técnica (no decisión): mantener A en el libro y usar B solo como PRESENTACIÓN, como está hoy. B en el libro es un cambio de diseño que toca asientos, comprobaciones C1..C24, la identidad I-1 y el auxiliar de fondos; se haría en un lote aparte con pgTAP propio.

DECISIÓN DEL DUEÑO pendiente: ¿se queda A con presentación B (hoy), o se migra el libro a B?
