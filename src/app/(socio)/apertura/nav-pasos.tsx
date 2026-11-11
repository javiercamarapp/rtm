'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PASOS } from '@/dominio/apertura/pasos';

/** Los diez pasos del asistente de apertura. */
export function NavPasos() {
  const ruta = usePathname();
  return (
    <nav className="rtm-subnav" aria-label="Pasos de la apertura">
      <ul>
        <li>
          <Link href="/apertura" aria-current={ruta === '/apertura' ? 'page' : undefined} data-testid="apertura-resumen">Resumen</Link>
        </li>
        {PASOS.map((p) => (
          <li key={p.n}>
            <Link href={`/apertura/paso/${p.n}`} aria-current={ruta === `/apertura/paso/${p.n}` ? 'page' : undefined} data-testid={`apertura-paso-${p.n}`}>{p.n}. {p.corto}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
