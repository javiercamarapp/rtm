import { formatearMoneda } from '@/dominio/formato';
import type { Desglose, LineaDesglose } from '@/dominio/operacion/desglose_socio';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';

function Importe({ l }: { l: LineaDesglose }) {
  if (l.cent === null) return <SinDato />;
  const texto = formatearMoneda(l.cent, l.conSigno ? { conSigno: true } : undefined);
  if (l.cifra) return <CifraComprobada texto={texto} cifra={l.cifra} comprobacion={l.comprobacion} />;
  return <span className="rtm-num">{texto}</span>;
}

/** Desglose completo de la cuenta de un socio: grupos en orden, cada cifra con su explicacion y su comprobacion. */
export function DesgloseSocio({ d }: { d: Desglose }) {
  return (
    <div className="rtm-desglose" data-testid={`desglose-${d.socio}`}>
      {d.grupos.map((g) => (
        <section key={g.id} className="rtm-seccion rtm-desglose-grupo" aria-label={g.titulo}>
          <h2>{g.titulo}</h2>
          <ul className="rtm-desglose-lista">
            {g.lineas.map((l) => (
              <li key={l.id} data-linea={l.id}>
                <span className="rtm-desglose-etiqueta">{l.etiqueta}</span>
                <strong className="rtm-desglose-importe"><Importe l={l} /></strong>
                <details className="rtm-desglose-explica">
                  <summary>Explicar este número</summary>
                  <p className="rtm-nota">{l.explicacion}</p>
                  {l.id === 'neto' && <p className="rtm-nota"><EstadoTexto tono={d.cuadra ? 'ok' : 'atencion'}>{d.cuadra ? 'Cuadra: la posición neta es igual a la suma de sus partes' : `No cuadra: hay ${formatearMoneda(d.residuo_cent, { conSigno: true })} sin explicar`}</EstadoTexto></p>}
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
