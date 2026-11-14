# Patron de botones, barra de acciones, filtros y modelos (sistema de diseno)

Para el barrido por todas las paginas. Todo vive en componentes y CSS compartido; no se ajusta pagina por pagina.

## Botones (`src/ui/estilos/controles.css`, seccion Botones)

- Variantes por clase: `rtm-boton` (secundaria, contorno fino), `rtm-boton rtm-boton-primario` (negro solido), `rtm-boton rtm-boton-terciario` (texto), `rtm-boton rtm-boton-peligro` (destructiva sobria), `rtm-boton-item` (fila dentro de un menu), `rtm-boton-chico`.
- Alto 32 px (token `--rtm-boton-alto`), radio `--rtm-ctl-r`, 13 px con peso medio. En pantallas tactiles se conserva el minimo de 44 px (regla de accesibilidad del proyecto).
- Estados: hover, `:focus-visible` (contorno de 2 px), `:active`, `:disabled` y cargando con `aria-busy="true"` (el texto se oculta y aparece un indicador). Respeta `prefers-reduced-motion` y `data-movimiento`.
- Iconos opcionales: un `<svg>` de 14 px dentro del boton.

## BarraAcciones (`src/ui/componentes/barra-acciones.tsx`)

Una sola fila siempre (sin `flex-wrap`). Reglas:

1. Maximo 1 o 2 acciones primarias visibles (`primarias`), con etiqueta corta; el texto largo va en `title` (ejemplo: "Registrar deposito", title "Registrar deposito de un socio").
2. Las demas acciones van agrupadas en el menu "Mas" (`secundarias`, hijos con clase `rtm-boton-item` o `variante="item"` en `FormularioAccion`). El menu abre con clic o Enter, se recorre con flechas arriba y abajo, cierra con Escape y devuelve el foco al boton. Los dialogos de sus acciones siguen funcionando porque el panel permanece montado.
3. La navegacion entre vistas relacionadas (`vistas`) es un segmentado compacto; con menos de 1100 px pasa al menu y en movil el menu queda como icono.
4. Uso: `<EncabezadoPagina acciones={<BarraAcciones primarias={...} secundarias={...} vistas={[...]} />} />`.

Aplicada en: Cuenta de socios (`socios`), historial de socio, acta de reparto, Cliente (`clientes/[id]`), Pedido (`pedidos/[id]`, acciones primarias visibles y el resto en "Mas"), Proveedores (`proveedores`), orden de compra (`proveedores/compras/[id]`), liquidacion semanal, Inventario (CSV y exportar PDF; el panel de exportar flota) y Contactos (exportacion). Pendiente: las filas `rtm-acciones-fila` de cuentas por cobrar, apertura y cascada. Los e2e que hacian clic en una accion que ahora vive en "Mas" abren primero `data-testid="barra-mas"`.

Dentro de "Mas" todo debe ser una fila de menu: usa `variante="item"` en `FormularioAccion`, `DialogoSimple`, `BotonAccion` (ambos), `FormularioGuia`, o un enlace/boton con `rtm-boton-item`. No se envuelve el contenido en clases propias. `controles.css` conserva una red de seguridad para un `.rtm-boton` suelto dentro del panel, pero es respaldo, no el camino. `PagoSocioProveedor` se queda como accion primaria de Proveedores (sus e2e lo pulsan directo), por eso no usa la variante.

## Filtros plegables (`src/ui/componentes/filtros-plegables.tsx`)

`FiltrosPlegables` agrupa campos de formulario en un desplegable flotante de una sola linea (no ocupa alto en la pagina). Los campos siguen montados al cerrar (un formulario que los contiene los envia igual), el contador de `activos` no se pierde, cierra con Escape o al pulsar fuera. Aplicado en Pedidos, Libro de movimientos, Dropshipping (lista, pedidos y utilidad) y Menudeo. `FiltrosUrl` (`_a2/filtros-url.tsx`, formulario GET con la URL como fuente de verdad) acepta `plegable` y se envuelve solo: Inventario (existencias, marcas, antiguedad, mermas, kardex) y Contabilidad (valuacion, historial, capital, caja).

## MenuFiltro (`src/ui/componentes/menu-filtro.tsx`) y por que no se unifica

`MenuFiltro` es un desplegable de ENLACES de una sola opcion (navega con `href`, marca `aria-current`, flechas arriba y abajo recorren). Se usa en el estado de Inventario. No se fusiona con `FiltrosPlegables` ni con `FiltroCatalogo`: `FiltrosPlegables` es un contenedor de campos que deben seguir montados y `FiltroCatalogo` es un buscador en vivo con multiseleccion de marcas por estado en la URL; los tres resuelven necesidades distintas (opciones por enlace, campos de formulario, busqueda con marcas) y mezclarlos obligaria a cambiar su teclado y sus selectores e2e. Regla: opciones excluyentes por enlace = `MenuFiltro`; campos de formulario = `FiltrosPlegables`; marcas + buscador = `FiltroCatalogo`.

## Encabezado de pagina y ayuda (`src/ui/componentes/pagina.tsx`, `ayuda.tsx`)

La descripcion de `EncabezadoPagina` es de una sola linea (120 caracteres como maximo). Lo que no cabe va en la prop `ayuda` (con `ayudaResumen` opcional), que muestra el componente `Ayuda` en un `details` cerrado: nada de texto se pierde. Aplicado en Comprobaciones, Valuacion, Historial de valuacion, Reportes, Avisos, Apertura, Cascada, Balance y Capital. Quedan descripciones dinamicas largas en otras paginas (devoluciones, contactos, movimientos, catalogo, clientes, etc.) pendientes de pasar al mismo patron.

## Estados vacios compartidos

`.rtm-vacio`, `.rtm-dt-aviso`, `.rtm-kr-vacio`, `.a3-grafica-vacia` y `.rtm-a1-estado-vacio` tienen relleno de 12 px o menos y ocupan una o dos lineas; se definen una sola vez en su hoja base (no hay parches `rtm-bb-compacto`). Las hojas `barrido-a/b/c.css` solo conservan reglas con prefijo propio; las reglas sin prefijo viven en `controles.css`, `componentes.css`, `operacion.css` y `karen.css`, de modo que ganan por especificidad y no por orden de carga.

## Espaciado vertical compacto (`tokens.css`)

`--rtm-ritmo` 10 px (entre secciones), `--rtm-pad-tarjeta` 12 px, `--rtm-v-gap-tarjeta` 6 px, `--rtm-v-encabezado` 6px 16px, `--rtm-v-acciones` 6 px. Cualquier hueco nuevo debe usar estos tokens.

## Filtro compartido (`src/ui/componentes/filtro-catalogo.tsx`)

Una barra: buscador en vivo (pausa de 250 ms, sin boton), estado segmentado opcional, hasta 5 marcas destacadas y desplegable de marcas con multiseleccion, buscador interno y conteo; chips solo de las marcas elegidas. Estado en la URL: `?q=`, `?estado=`, `?marca=Waka,Geek%20Bar` (ayudas en `src/dominio/catalogo/filtro.ts`). Aplicado en Catalogo e Inventario; las demas pantallas con filas de marcas (no hay otras con chips de marca hoy) deben reusarlo.

## Modelos (`src/ui/componentes/modelo.tsx`)

`ModeloMiniatura` (xs, s, m) y `ModeloTarjeta` son la unica forma de mostrar un modelo: proporcion 4:5, fondo neutro, foto en escala de grises que recupera el color al pasar el cursor, carga diferida, estado vacio con monograma. Las fotos se declaran en `src/dominio/catalogo/fotos-modelos.ts` y su procedencia en `docs/fotos-modelos.md`.
