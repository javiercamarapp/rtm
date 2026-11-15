import Link from 'next/link';
import type { ReactNode } from 'react';

export interface VistaAccion { href: string; etiqueta: string; /** Texto largo para title y lectores de pantalla. */ titulo?: string; testid?: string }

interface Props {
  /** Una o dos acciones primarias, siempre visibles (botones o enlaces con etiqueta corta). */
  primarias?: ReactNode;
  /** Acciones secundarias: botones compactos terciarios en la misma fila (clase "rtm-boton rtm-boton-terciario" o variante="terciario"), con etiqueta corta y la descripcion larga en title. No hay menu desplegable. */
  secundarias?: ReactNode;
  /** Navegacion entre vistas: control segmentado compacto. */
  vistas?: VistaAccion[];
  etiquetaAria?: string;
}

/** Barra de acciones de una sola fila: vistas en segmentado, acciones secundarias terciarias y 1 o 2 primarias. Nunca se parte en dos filas ni lleva un boton "Mas". */
export function BarraAcciones({ primarias, secundarias, vistas = [], etiquetaAria = 'Acciones de la página' }: Props) {
  const hayExtra = secundarias !== undefined && secundarias !== null && secundarias !== false;
  return (
    <div className="rtm-ba" role="group" aria-label={etiquetaAria}>
      {vistas.length > 0 && (
        <nav className="rtm-ba-vistas" aria-label="Vistas relacionadas">
          {vistas.map((v) => <Link key={v.href} href={v.href} title={v.titulo} aria-label={v.titulo} data-testid={v.testid}>{v.etiqueta}</Link>)}
        </nav>
      )}
      {hayExtra && <div className="rtm-ba-sec">{secundarias}</div>}
      {primarias && <div className="rtm-ba-primarias">{primarias}</div>}
    </div>
  );
}
