# Sistema unico de controles, tablas y formularios

Rama `rediseno/premium`. Tokens `--rtm-ctl-*` en `tokens.css` (alto 32 px; 44 px y 16 px de texto en tactil o <= 767 px; radio 8; borde 1 px `--rtm-campo-borde`; relleno 10 px; etiqueta 12 px). Regla base de campo en `componentes.css` (`.rtm-campo` y los campos de filtro A2); todo lo demas (etiquetas, selector con flecha propia, fecha, busqueda, barras de filtro, rejilla de formularios, avisos de efecto, estados deshabilitados) en `controles.css`, cargado al final.

- Barras de filtro: flex con hueco de 8 px y alineacion al pie; en movil, rejilla de dos columnas (selector y busqueda a todo el ancho).
- Formularios: `.rtm-form-fila` es rejilla autoajustable; selector y campo ancho ocupan dos partes, fecha y monto una, area la fila completa; una columna a <= 767 px.
- Tablas: encabezado con `--rtm-th-fondo`/`--rtm-th-texto` (>= 4.5:1, probado en `contraste_tokens.test.ts`), celdas con relleno vertical simetrico y `vertical-align: middle`.
- Costos del sistema: lista de servicios ordenada por categoria (Mantenimiento, Opcional, Construccion) y luego alfabetico (`ordenarServicios`); casilla de logo fija de 28 px (icono oficial o monograma); ficha en `/costos/[slug]` con cargos, total del mes y acumulado (suma de montos ya redondeados de la base) y formulario con el servicio preseleccionado. Los logotipos horizontales se ven en la ficha.
