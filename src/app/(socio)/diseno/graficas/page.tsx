import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import {
  AntiguedadSaldos, BarrasDelta, Bump, Burbujas, Cascada, CoberturaDias, LineaProyeccion, MapaCalor, Pareto, Radar, Sparkline, TarjetaInsight, Treemap,
} from '@/ui/graficas';
import {
  EJ_ANTIGUEDAD, EJ_BARRAS, EJ_BUMP, EJ_BUMP_PERIODOS, EJ_BURBUJAS, EJ_CALOR, EJ_CALOR_COLUMNAS, EJ_CALOR_FILAS, EJ_CASCADA, EJ_COBERTURA, EJ_GRUPOS_BURBUJA,
  EJ_LINEA, EJ_PARETO, EJ_RADAR, EJ_RADAR_EJES, EJ_SPARK, EJ_TREEMAP, EJ_TREEMAP_GRUPOS, EJ_UMBRALES,
} from '@/ui/graficas/ejemplos';

export const metadata: Metadata = { title: 'Gráficas' };

const PIE = 'Datos ilustrativos del catálogo de diseño; no son cifras del negocio.';

/** Catalogo de la biblioteca de graficas. Es una galeria: muestra todos los tipos juntos, a diferencia de una pagina real (maximo 4 graficas grandes). */
export default function CatalogoGraficas() {
  return (
    <>
      <EncabezadoPagina
        eyebrow="Diseño · Gráficas"
        antes="Doce tipos de gráfica, una sola"
        enfasis="familia"
        contexto="SVG propio, blanco y negro con el acento como token. Cada gráfica trae su tabla equivalente, navegación por teclado y no depende solo del color. Con movimiento reducido todo se pinta ya en su estado final."
      />

      <h2 className="rtm-g-subtitulo">Tarjetas de insight</h2>
      <section className="rtm-g-insights rtm-entra rtm-i-1" aria-label="Tarjetas de insight">
        <TarjetaInsight
          etiqueta="Piezas de la semana"
          cifra={{ valor: 1524, tipo: 'piezas' }}
          frase="Subió frente a la semana anterior; el Modelo A explica la mayor parte."
          delta={{ texto: '+12 %', sentido: 'sube' }}
          procedencia="observado"
          severidad="Informa"
          minigrafica={<Sparkline titulo="Piezas por semana" descripcion="De 12 a 24 piezas en 8 semanas" etiquetas={EJ_SPARK.etiquetas} valores={EJ_SPARK.valores} textos={EJ_SPARK.textos} />}
          evidencia={{ href: '/inventario' }}
          indice={0}
        />
        <TarjetaInsight
          etiqueta="Venta de la próxima semana"
          cifra={{ valor: 6700000, tipo: 'moneda' }}
          frase="Proyección con el ritmo de las últimas 8 semanas; el rango es amplio."
          delta={{ texto: '+5 %', sentido: 'sube' }}
          procedencia="estimado"
          severidad="Atención"
          indice={1}
        />
        <TarjetaInsight
          etiqueta="Clientes que bajan"
          cifra={{ valor: 3, tipo: 'entero' }}
          frase="Pidieron menos del 70 % de su promedio de las últimas 12 semanas."
          delta={{ texto: '−1', sentido: 'baja' }}
          procedencia="inferido"
          severidad="Acción"
          indice={2}
        />
      </section>

      <h2 className="rtm-g-subtitulo">Los doce tipos</h2>
      <div className="rtm-g-catalogo rtm-entra rtm-i-2">
        <BarrasDelta titulo="¿Qué modelo se vende más?" descripcion="Cinco modelos por piezas; el Modelo A va primero con 420 piezas." datos={EJ_BARRAS} unidad="Piezas" procedencia="observado" pie={PIE} />
        <LineaProyeccion
          titulo="¿Hacia dónde va la venta semanal?"
          descripcion="Siete semanas observadas de 41 a 61 piezas y tres semanas estimadas con rango."
          puntos={EJ_LINEA}
          unidad="Piezas"
          anotacion={{ id: 's5', texto: 'Mayor caída' }}
          procedencia="estimado"
          pie={PIE}
        />
        <Cascada titulo="¿Qué se comió la utilidad del pedido?" descripcion="De una venta de 12,000 pesos a una utilidad de 3,000 pesos restando descuento, costo, renta y guía." pasos={EJ_CASCADA} unidad="Importe" procedencia="observado" pie={PIE} />
        <Pareto titulo="¿Quién concentra la utilidad?" descripcion="Siete clientes ordenados por utilidad con el porcentaje acumulado." datos={EJ_PARETO} unidad="Utilidad" sustantivo="clientes" procedencia="observado" pie={PIE} />
        <MapaCalor titulo="¿Qué sabor mueve cada modelo?" descripcion="Piezas por modelo y sabor; una celda sin dato." filas={EJ_CALOR_FILAS} columnas={EJ_CALOR_COLUMNAS} celdas={EJ_CALOR} unidad="Piezas" procedencia="observado" pie={PIE} />
        <Burbujas titulo="¿Qué modelos dan volumen y margen?" descripcion="Cinco modelos por piezas, margen y venta, clasificados en cuatro grupos." puntos={EJ_BURBUJAS} ejeX="Piezas" ejeY="Margen" ejeTamano="Venta" grupos={EJ_GRUPOS_BURBUJA} umbralX={200} umbralY={20} procedencia="inferido" pie={PIE} />
        <Treemap titulo="¿En qué se va el gasto?" descripcion="Seis conceptos de gasto, fijos y variables, con su participación." nodos={EJ_TREEMAP} grupos={EJ_TREEMAP_GRUPOS} unidad="Gasto" procedencia="observado" pie={PIE} />
        <Radar titulo="¿Qué marcas compra este cliente frente al promedio?" descripcion="Ocho marcas; el cliente concentra 60 % en la Marca A contra 30 % del promedio." ejes={EJ_RADAR_EJES} series={EJ_RADAR} maximo={70} procedencia="inferido" pie={PIE} />
        <Bump titulo="¿Quién sube y quién baja en el ranking?" descripcion="Cuatro clientes durante cuatro meses; el Cliente 1 se mantiene primero." periodos={EJ_BUMP_PERIODOS} series={EJ_BUMP} procedencia="observado" pie={PIE} />
        <AntiguedadSaldos titulo="¿Cuánto llevan sin pagar?" descripcion="Saldo por cliente en cuatro tramos de antigüedad." filas={EJ_ANTIGUEDAD} procedencia="observado" pie={PIE} />
        <CoberturaDias titulo="¿Cuántos días alcanza cada modelo?" descripcion="Seis modelos con días de cobertura contra el tiempo de entrega, el siguiente pedido y el objetivo." filas={EJ_COBERTURA} umbrales={EJ_UMBRALES} procedencia="estimado" pie={PIE} />
      </div>

      <h2 className="rtm-g-subtitulo">Estados</h2>
      <div className="rtm-g-catalogo">
        <BarrasDelta titulo="Cargando: esqueleto con la forma final" descripcion="Cargando" datos={[]} unidad="Piezas" estado="cargando" />
        <Pareto titulo="Sin muestra suficiente" descripcion="Muestra insuficiente" datos={EJ_PARETO} unidad="Utilidad" sustantivo="clientes" muestra={{ actual: 2, requerida: 4, unidad: 'pedidos' }} />
        <LineaProyeccion titulo="Con error" descripcion="Un solo punto" puntos={[EJ_LINEA[0]!]} unidad="Piezas" />
      </div>
    </>
  );
}
