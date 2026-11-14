import Link from 'next/link';
import '@/ui/estilos/barrido-c.css';
import { atajos } from '@/dominio/contabilidad/rangos';
import { etiquetaFecha } from '@/dominio/formato';

/** Atajos de periodo (enlaces) y el rango en uso. Sin formularios: la URL manda. */
export function SelectorRango({ base, hoy, ini, fin }: { base: string; hoy: string; ini: string; fin: string }) {
  return (
    <div className="rtm-bc-rango" aria-label="Periodo del estado">
      <nav aria-label="Atajos de periodo">
        {atajos(hoy).map((a) => (
          <Link key={a.etiqueta} href={`${base}?ini=${a.ini}&fin=${a.fin}`} aria-current={a.ini === ini && a.fin === fin ? 'true' : undefined}>{a.etiqueta}</Link>
        ))}
      </nav>
      <p className="rtm-nota">Del {etiquetaFecha(ini)} al {etiquetaFecha(fin)}</p>
    </div>
  );
}
