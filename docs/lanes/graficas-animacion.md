# Biblioteca de gráficas y animación (graficas-animacion)

Rama `lane/graficas-animacion`. Componentes SVG propios, sin dependencias de gráficas ni de animación, en `src/ui/graficas/`. Estilos en `src/ui/estilos/graficas.css` (solo tokens). Catálogo en `/diseno/graficas` con datos ilustrativos.

## Qué contiene

| Tipo | Componente | Notas |
|---|---|---|
| Barras con delta y ranking | `BarrasDelta` | Eje en cero, orden por valor, un solo destacado en el acento, delta con flecha, signo y palabra |
| Línea con anotación y banda de proyección | `LineaProyeccion` | Observado en trazo continuo y círculo; estimado en trazo discontinuo y rombo; banda con trama |
| Cascada | `Cascada` | Inicio, escalones y total; el total dice si cuadra; negativos con trama y signo escrito |
| Pareto | `Pareto` | Acumulado, umbral, llave "Primeros N" y lectura en palabras |
| Mapa de calor | `MapaCalor` | Un matiz en 5 niveles, número exacto en cada celda, celda sin dato punteada |
| Burbujas | `Burbujas` | Área proporcional; cada grupo con su trama y su palabra |
| Treemap | `Treemap` | Squarify; el área conserva la proporción exacta |
| Radar | `Radar` | Hasta 8 ejes y 2 series (círculo continuo / cuadrado discontinuo) |
| Bump chart | `Bump` | Forma de marcador por serie, nombre y lugar en los dos extremos |
| Sparkline | `Sparkline` | En línea; su tabla viaja para lectores de pantalla |
| Antigüedad de saldos | `AntiguedadSaldos` | Tramos de la adenda 22: 0 a 7, 8 a 14, 15 a 30, más de 30 días |
| Cobertura en días | `CoberturaDias` | Barra contra umbrales; estado en palabra y medidor de 5 segmentos |
| Insight | `TarjetaInsight` | Etiqueta, cifra héroe, frase, delta, procedencia, severidad en texto, evidencia |
| Procedencia | `MarcaProcedencia` | Observado (círculo lleno), Estimado (círculo discontinuo), Inferido (rombo vacío) |
| Contador | `Contador` | A05; valor final siempre para lectores de pantalla |

Piezas comunes: `MarcoGrafica` (título, procedencia, estados, tabla alterna, pie de corte y fuente), `EsqueletoGrafica` (12 formas), `TablaDeGrafica`, `Delta`. Geometría pura y probada en `geo.ts`. Texto de cifras en `formato.ts` (reutiliza `dominio/formato`).

## Contrato de uso

Todos los componentes son de cliente (`'use client'`) y reciben solo datos serializables, así que se usan directo desde páginas de servidor.

```tsx
import { BarrasDelta } from '@/ui/graficas';

<BarrasDelta
  titulo="¿Qué modelo se vende más?"       // pregunta o conclusión
  descripcion="Cinco modelos por piezas…"  // aria-label
  datos={[{ id, etiqueta, valor, texto, delta?, destacado? }]}
  unidad="Piezas"                          // encabezado de la tabla alterna
  procedencia="observado"                  // opcional
  pie="Corte: 10 nov 19:12 · Fuente: libro de movimientos"
  estado="listo" | "cargando" | "error"
  muestra={{ actual: 2, requerida: 4, unidad: 'pedidos' }}  // sin muestra: estado vacío honesto
/>
```

Reglas que el llamador debe respetar:

- Las cifras llegan ya calculadas y formateadas (`texto`) por el servidor con `dominio/formato`. La gráfica solo coloca; no calcula negocio ni dinero. `valor` es un número solo para la geometría. `Contador` recibe centavos enteros para `moneda`.
- Clasificaciones (Estrella, Vaca, Nicho, Revisar), posiciones del ranking del bump y estados de cobertura los decide el servidor; la gráfica los pinta.
- Los datos inválidos (negativos donde no caben, longitudes distintas, más de 8 ejes, menos de 2 puntos) no lanzan: el componente muestra el estado de error con el mensaje del `ErrorGrafica` tipado.
- Máximo 4 gráficas grandes por página real y ninguna en la ruta de Omar (no carga librería, pero tampoco debe cargar este módulo).

## Movimiento

Usa el módulo único `src/ui/movimiento`. Se añadió `cliente.ts` (`useModoMovimiento`, `useAnimacionActiva`) que lee el mismo atributo `data-movimiento` de `<html>` que el CSS y, sin él, `prefers-reduced-motion`.

- Solo el modo `full` anima. El marco pone `data-anim="on"` y el CSS anima únicamente bajo `[data-anim='on']`: barras que crecen (`scaleX/scaleY`), líneas que se trazan (`stroke-dashoffset`, 900 ms), entrada escalonada (máximo 6), contador (600 ms).
- Con `reduced` u `off` no hay ninguna animación (ni siquiera fundido) y el DOM final es idéntico salvo el atributo `data-anim`. El CSS además anula `animation` y `transition` bajo `data-movimiento='reduced'|'off'` como defensa en profundidad.
- Estados cargando, error y muestra insuficiente nunca se animan.

## Accesibilidad y color

- `svg role="group"` con `aria-label` de resumen; cada marca es `g role="img"` con `aria-label` ("Etiqueta: cifra, contexto") y un único `tabindex=0` itinerante: flechas, Inicio y Fin (mapa de calor también arriba y abajo).
- Tabla alterna ("Ver como tabla") con los mismos datos, con roles ARIA vía `DataTable` (nunca `<table>`).
- El color nunca va solo: etiqueta directa, valor escrito, trama por categoría (rayas, puntos, cuadros, cruz), forma de marcador por serie (círculo, cuadrado, triángulo, rombo), trazo discontinuo para lo estimado, punteado para lo desconocido, palabra de estado. El delta no usa semáforo. Rojo solo en la severidad "Acción" de la tarjeta.
- Una serie = gris tinta con el foco en `--rtm-accent`. Paleta de datos de 8 matices en `.rtm-g-s0..s7` en el orden de la especificación.

## Pruebas

`npm test` (todas) y `npm run cobertura:graficas`. Archivos: `geo.test.ts` (propiedades con fast-check), `graficas.test.tsx` (axe, movimiento, tabla alterna, color, teclado, estados, contraste de tokens), `contador.test.tsx`, y `src/app/(socio)/diseno/graficas/catalogo.test.tsx`. Ayudas en `pruebas/`. Axe corre en jsdom con la regla de contraste desactivada (jsdom no calcula estilos); el contraste de marcas (3:1) y de texto (4,5:1) se comprueba aparte contra `tokens.css` en los dos temas.

## Integración

1. `src/app/layout.tsx` importa `graficas.css` (una línea).
2. Páginas de F3 en adelante: `import { Cascada, … } from '@/ui/graficas'` y pasar datos de los lectores de aplicación.
3. `GraficaBarras` y `GraficaLinea` de F1 siguen donde están (`barras.tsx`, `linea.tsx`); migrarlas a `BarrasDelta` y `LineaProyeccion` es opcional y queda para el módulo de cada página.
4. Faltan en el menú lateral el enlace a `/diseno/graficas` (el shell es de otra área).
