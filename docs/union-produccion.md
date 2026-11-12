# Union de main con produccion (rama integracion/union-produccion)

Merges `--no-ff`, en orden: integracion/ola-b1, integracion/ola-b2 (sin conflictos nuevos), ajuste/sin-division-por-duenio y feat/contactos-menudeo (ya contenidas en ola-b1 y ola-b2: sin cambios) y deploy/d0 (herramientas de despliegue sin builds, humo, respaldos, encabezados y ajustes de login que ya estan en produccion).

## Choques de migraciones (main 20261110002100 a 2800 contra produccion 20261111*)

Produccion aplico 30 migraciones; las 8 de main (2100 a 2800) llevan fecha anterior a varias ya aplicadas. En produccion se aplican fuera de orden (`supabase db push --include-all` o equivalente); en una base nueva se aplican por nombre. Se probaron los dos ordenes en una base local propia: aplican limpio y dan el mismo resultado de pgTAP.

| Objeto | Choque | Correccion (migracion nueva, las ya aplicadas no se editan) |
|---|---|---|
| api.cuentas_por_cobrar | 2300 (apertura) y 20261111007000 (orden estable) la redefinen; gana la ultima en aplicarse y se pierde lo de la otra | 20261112000200: definicion final con ambas cosas |
| catalogo notificacion.tipo | retiro_capital_por_confirmar y toma_pendiente (de produccion) no existen en el catalogo de 2100 y operacion.avisar rechaza codigos desconocidos | 20261112000100: dos filas nuevas |
| agente.ejecutar | pasaba 'reembolsable' a registrar_aportacion, que ahora exige intencion capital o reembolso | 20261112000300: por omision reembolso; capital solo si se declara |
| api.explicar_cifra | las dos cadenas de renombres (explicar_cifra_base y explicar_cifra_f3b) se componen bien en ambos ordenes | sin cambio |

## Cambios de comportamiento a conocer

- Un reembolso de costos del sistema (api.costos_registrar_reembolso) paga a un socio con la regla nueva de fondeo: sale primero del efectivo de la caja de la empresa y se rechaza con "la caja de la empresa solo tiene N centavos" si no alcanza. La prueba 023_integracion_costos siembra efectivo en la caja antes del reembolso.
- Los scripts de capturas datos-demo-f3a.mjs y datos-demo-f3b.mjs llaman a registrar_aportacion sin intencion (firma anterior) y fallarian contra la base actual; no se tocaron.
- Prueba 024_omar_cuenta_sin_folio (#13) usa fechas fijas (10 y 11 de noviembre) y supone que hoy es el 11; falla desde el 12 de noviembre tambien en deploy/d0 solo. No es de la union.
