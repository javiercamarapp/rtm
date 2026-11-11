import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Acentos' };

function Muestra({ acento, titulo }: { acento: 'neutro' | 'lila'; titulo: string }) {
  return (
    <section className="rtm-acento-muestra" data-acento={acento} aria-label={`Acento ${titulo}`}>
      <h3>{titulo}</h3>
      <span className="rtm-seleccion">Selección activa</span>
      <p className="rtm-contexto">
        <span className="rtm-punto" aria-hidden="true" /> Punto de no leído y foco usan el acento.
      </p>
      <div className="rtm-barra-muestra" role="img" aria-label="Elemento destacado de una gráfica">
        <span />
      </div>
      <button type="button" className="rtm-boton rtm-boton-primario">Botón primario (siempre tinta)</button>
    </section>
  );
}

export default function Acentos() {
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Diseño · ${etiquetaHoy()}`}
        antes="Dos acentos, lado a"
        enfasis="lado"
        contexto="El acento sirve para foco, selección, el elemento destacado de una gráfica y el punto de no leído; nunca para texto largo ni fondo de botón. Puedes cambiarlo en cualquier momento desde Apariencia."
      />
      <div className="rtm-acentos rtm-entra rtm-i-1">
        <Muestra acento="neutro" titulo="Neutro estricto" />
        <Muestra acento="lila" titulo="Lila" />
      </div>
    </>
  );
}
