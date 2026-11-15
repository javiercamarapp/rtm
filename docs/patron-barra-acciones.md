# Patron de botones, barra de acciones, filtros y modelos (sistema de diseno)

Para el barrido por todas las paginas. Todo vive en componentes y CSS compartido; no se ajusta pagina por pagina.

## Botones (`src/ui/estilos/controles.css`, seccion Botones)

- Variantes por clase: `rtm-boton` (secundaria, contorno fino), `rtm-boton rtm-boton-primario` (negro solido), `rtm-boton rtm-boton-terciario` (texto), `rtm-boton rtm-boton-peligro` (destructiva sobria), `rtm-boton-item` (fila dentro de un menu de filtro), `rtm-boton-chico`.
- Alto 32 px (token `--rtm-boton-alto`), radio `--rtm-ctl-r`, 13 px con peso medio. En pantallas tactiles se conserva el minimo de 44 px (regla de accesibilidad del proyecto).
- Variante DENSA dentro de `BarraAcciones` (hijos directos de `.rtm-ba-sec` y `.rtm-ba-primarias`): 28 px (`--rtm-ba-alto`), relleno de 10 px, 12.5 px, gap de 4 px. El alto visual no crece en tactil; el area de 44 px sale de un `::before` invisible (`inset: -8px -2px`). Los botones de los dialogos que cuelgan de la barra conservan su tamano normal.
- Estados: hover, `:focus-visible` (contorno de 2 px), `:active`, `:disabled` y cargando con `aria-busy="true"` (el texto se oculta y aparece un indicador). Respeta `prefers-reduced-motion` y `data-movimiento`.
- Iconos opcionales: un `<svg>` de 14 px dentro del boton.

## BarraAcciones (`src/ui/componentes/barra-acciones.tsx`)

Una sola fila siempre, SIN menu desplegable ni boton "Mas" (pedido del dueno, 14-nov: "quita el boton de Mas"). Orden de izquierda a derecha: `vistas` (segmentado), `secundarias` (botones terciarios) y `primarias`. Reglas:

1. Maximo 1 o 2 acciones primarias (`primarias`), con etiqueta corta; el texto largo va en `title` (ejemplo: "Deposito", title "Registrar deposito de un socio").
2. Las demas acciones (`secundarias`) se muestran visibles como botones densos terciarios de 28 px, unidos en UN solo grupo (pastilla con filetes finos entre botones y esquinas redondeadas solo en los extremos), con la primaria separada a la derecha: clase `rtm-boton rtm-boton-terciario`, o `variante="terciario"` en `FormularioAccion`, `DialogoSimple`, `BotonAccion` (ambos), `FormularioGuia`. Etiqueta corta ("Gasto", "Pago", "Anular") y descripcion larga en `title` (`descripcion` en los componentes). Los dialogos siguen funcionando igual: el boton y su dialogo se montan en la misma fila.
3. Si una barra reune mas de 5 acciones, la navegacion entre vistas va como segmentado (`vistas`) y las acciones de registro como terciarias con etiqueta corta (Cuenta de socios: 4 vistas, Gasto, Pago, Liquidacion y la primaria Deposito).
4. Cuenta de socios (4 vistas, Gasto, Pago, Liquidacion, Deposito) mide unos 530 px estimados por CSS: cabe en una fila a 1024 px y mas. Si una barra futura no cupiera, acortar etiquetas antes que partir la fila. La fila no se parte: `flex-wrap: nowrap` en `.rtm-ba`, `.rtm-ba-sec` y `.rtm-ba-primarias`. En escritorio el encabezado baja la barra completa a su propia linea si no cabe junto al titular. Con 1100 px o menos, si ni sola cabe, se desliza en horizontal con la barra de desplazamiento oculta y un desvanecido en el borde derecho (`controles.css`). La barra con un panel flotante (Inventario, `.rtm-exportar`) queda sin recorte.
5. Uso: `<EncabezadoPagina acciones={<BarraAcciones primarias={...} secundarias={...} vistas={[...]} />} />`.
6. No existe `data-testid="barra-mas"`: los e2e pulsan la accion directo por su `data-testid`. El contrato `test/contratos/barra_acciones_sin_mas.test.ts` falla si reaparece `barra-mas`, las clases del menu retirado o un boton rotulado "Mas".

Aplicada en: Cuenta de socios (`socios`), historial de socio, acta de reparto, Cliente (`clientes/[id]`), Pedido (`pedidos/[id]`), Proveedores (`proveedores`), orden de compra (`proveedores/compras/[id]`), liquidacion semanal, Inventario (CSV y exportar PDF; el panel de exportar flota) y Contactos (exportacion). Pendiente: las filas `rtm-acciones-fila` de cuentas por cobrar, apertura y cascada.

Contrato `test/contratos/una_linea.test.ts`: prohibe `flex-wrap: wrap` en `.rtm-ba*`, `.rtm-pestanas`, `.rtm-subnav` y `.rtm-encabezado-acciones`, y fija los tokens densos.

## Pestanas y subnavegacion (`src/ui/componentes/pestanas.tsx`)

Una sola linea SIEMPRE (`flex-wrap: nowrap`), 13 px, relleno horizontal de 9 px. Si no caben, la tira desliza en horizontal con la barra oculta y un desvanecido en el borde con mas contenido (`data-izq`/`data-der`); al montar la pestana activa queda centrada (sin `scrollIntoView`, que movia la pagina). Contabilidad usa etiquetas cortas (Detalle, Historial, Capital, Caja, Resultados, Balance, Flujo) con el nombre completo en `title`; los `data-testid` no cambian. Todo el software usa este mismo componente (Contabilidad, Inventario, Movimientos, Dropshipping, Apertura, pedido, costos, kardex).

Pendiente de revisar en navegador: que en telefono (<= 767 px) las secundarias se vuelvan iconos. Hoy no hay un icono por accion; la fila se desliza en horizontal con el mismo texto corto.

`rtm-boton-item` sigue existiendo solo para las filas de `MenuFiltro` (desplegable de enlaces de filtro), no para acciones.

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
