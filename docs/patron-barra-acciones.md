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

Aplicada en: Cuenta de socios (`src/app/(socio)/socios`) y Cliente (`clientes/[id]`). Pendiente del barrido: Clientes (lista), Dropshipping, Movimientos, Menudeo, Pedidos y las filas `rtm-acciones-fila` de cuentas por cobrar, pedido, apertura y cascada. Los e2e que hacian clic en una accion que ahora vive en "Mas" deben abrir primero `data-testid="barra-mas"`.

## Espaciado vertical compacto (`tokens.css`)

`--rtm-ritmo` 10 px (entre secciones), `--rtm-pad-tarjeta` 12 px, `--rtm-v-gap-tarjeta` 6 px, `--rtm-v-encabezado` 6px 16px, `--rtm-v-acciones` 6 px. Cualquier hueco nuevo debe usar estos tokens.

## Filtro compartido (`src/ui/componentes/filtro-catalogo.tsx`)

Una barra: buscador en vivo (pausa de 250 ms, sin boton), estado segmentado opcional, hasta 5 marcas destacadas y desplegable de marcas con multiseleccion, buscador interno y conteo; chips solo de las marcas elegidas. Estado en la URL: `?q=`, `?estado=`, `?marca=Waka,Geek%20Bar` (ayudas en `src/dominio/catalogo/filtro.ts`). Aplicado en Catalogo e Inventario; las demas pantallas con filas de marcas (no hay otras con chips de marca hoy) deben reusarlo.

## Modelos (`src/ui/componentes/modelo.tsx`)

`ModeloMiniatura` (xs, s, m) y `ModeloTarjeta` son la unica forma de mostrar un modelo: proporcion 4:5, fondo neutro, foto en escala de grises que recupera el color al pasar el cursor, carga diferida, estado vacio con monograma. Las fotos se declaran en `src/dominio/catalogo/fotos-modelos.ts` y su procedencia en `docs/fotos-modelos.md`.
