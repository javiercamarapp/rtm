import type { Metadata } from 'next';
import Link from 'next/link';
import { EncabezadoPagina, EstadoVacio } from '@/ui/componentes/pagina';
import { etiquetaHoy } from './contexto';

export const metadata: Metadata = { title: 'Inicio' };

const PASOS = [
  { n: 1, titulo: 'Elegir el acento', texto: 'Compara neutro y lila lado a lado y elige uno.', enlace: { href: '/diseno', texto: 'Ver acentos' } },
  { n: 2, titulo: 'Confirmar el nombre y el logo', texto: 'El nombre RTM y su logo son provisionales y viven en una sola constante.' },
  { n: 3, titulo: 'Cargar catálogo, costos y precios', texto: 'Modelos, sabores, costos de Isaac y Karen y el tabulador de cada cliente. Llega con la fase 1.' },
] as const;

export default function Inicio() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Inicio · ${etiquetaHoy()}`}
        antes="La bodega está lista para su"
        enfasis="primer pedido"
        contexto="Todavía no hay datos: el pulso de arriba dice “Sin dato” en vez de inventar ceros. Aquí aparecerá lo que requiere tu turno."
      />
      <section className="rtm-tarjeta rtm-entra rtm-i-1" aria-labelledby="primeros-pasos">
        <h2 id="primeros-pasos">Primeros pasos</h2>
        <ol className="rtm-pasos">
          {PASOS.map((p) => (
            <li key={p.n} className="rtm-paso">
              <span className="rtm-paso-n" aria-hidden="true">{p.n}</span>
              <p>
                <strong>{p.titulo}.</strong> {p.texto}
              </p>
              {'enlace' in p && (
                <Link href={p.enlace.href} className="rtm-boton rtm-estado">{p.enlace.texto}</Link>
              )}
            </li>
          ))}
        </ol>
      </section>
      <EstadoVacio indice={2} titulo="Nada que atender" texto="Aquí verás los avisos sin resolver, las diferencias de recepción abiertas y las tomas pendientes de autorización." />
    </>
  );
}
