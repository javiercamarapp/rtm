import type { Metadata } from 'next';
import { SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Proyecciones y estimaciones' };

const BLOQUES = [
  { titulo: 'Flujo de caja a 4 semanas', texto: 'Cobros esperados contra pagos esperados (liquidación del viernes a Isaac, Karen por adelantado y la renta de Omar).' },
  { titulo: 'Utilidad proyectada', texto: 'Con rango y muestra mínima, a partir de las semanas ya cerradas.' },
  { titulo: 'Punto de reorden', texto: 'Cuánto y cuándo reponer cada modelo según su rotación y el tiempo de entrega.' },
  { titulo: 'Sensibilidad al costo de Isaac y Karen', texto: 'Escenarios: qué pasa con la utilidad si sube o baja el costo de cada proveedor.' },
] as const;

export default function Pagina() {
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow="Contabilidad · proyecciones y estimaciones"
        antes="Sin historia no hay"
        enfasis="proyección"
        contexto="Todo lo que se estime aparecerá etiquetado «Estimado», con su rango y la muestra mínima que lo respalda. Con un solo día de ventas no se inventa un futuro."
      />
      {BLOQUES.map((b) => (
        <section key={b.titulo} className="rtm-seccion" aria-label={b.titulo} data-testid="proyeccion-bloque">
          <h2>{b.titulo}: <SinDato /></h2>
          <p className="rtm-nota">{b.texto} Se activa cuando haya historia suficiente en el libro de asientos.</p>
        </section>
      ))}
    </>
  );
}
