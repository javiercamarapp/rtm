import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { MARCA } from '@/config/marca';
import { clasesTipografia } from '@/ui/tipografia';
import { ScriptTema } from '@/ui/tema/script-tema';
import '@/ui/estilos/tokens.css';
import '@/ui/estilos/base.css';
import '@/ui/estilos/movimiento.css';
import '@/ui/estilos/shell.css';
import '@/ui/estilos/componentes.css';
import '@/ui/estilos/operacion.css';
import '@/ui/estilos/graficas.css';
import '@/ui/estilos/apertura.css';
import '@/ui/estilos/premium.css';
import '@/ui/estilos/omar.css';
import '@/ui/estilos/bodega.css';
import '@/ui/estilos/controles.css';
import '@/ui/estilos/modelo.css';
import '@/ui/estilos/filtros.css';

export const metadata: Metadata = {
  title: { default: MARCA.nombre, template: `%s · ${MARCA.nombre}` },
  description: `${MARCA.nombre}: ${MARCA.descripcion}`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-tema, data-acento y data-movimiento los fija el script bloqueante antes del primer pintado.
    <html lang="es" suppressHydrationWarning className={clasesTipografia}>
      <head>
        <ScriptTema />
      </head>
      <body>{children}</body>
    </html>
  );
}
