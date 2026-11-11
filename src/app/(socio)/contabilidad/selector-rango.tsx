import Link from 'next/link';
import { atajos } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha } from '@/dominio/formato';

/** Atajos de periodo (enlaces) y el rango en uso. Sin formularios: la URL manda. */
export function SelectorRango({ base, hoy, ini, fin }: { base: string; hoy: string; ini: string; fin: string }) {
  return (
    <div className="rtm-rango" aria-label="Periodo del estado">
      <ul>
        {atajos(hoy).map((a) => (
          <li key={a.etiqueta}>
            <Link href={`${base}?ini=${a.ini}&fin=${a.fin}`} aria-current={a.ini === ini && a.fin === fin ? 'true' : undefined}>{a.etiqueta}</Link>
          </li>
        ))}
      </ul>
      <p className="rtm-nota">Del {etiquetaFecha(ini)} al {etiquetaFecha(fin)}</p>
    </div>
  );
}
