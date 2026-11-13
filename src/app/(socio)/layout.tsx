import type { ReactNode } from 'react';
import { exigirSocio } from '@/composicion/acceso';
import { notificacionesDeSocio } from '@/composicion/inventario';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { leerPulso } from '@/composicion/pulso';
import { ExplicarProvider } from '@/ui/componentes/explicar';
import { Armazon } from '@/ui/shell/armazon';
import { cargarCampana, explicarCifra, marcarLeidaAccion, marcarTodasLeidasAccion, salir } from './acciones';

export const dynamic = 'force-dynamic';

export default async function LayoutSocio({ children }: { children: ReactNode }) {
  // La autoridad es la tabla: sin cuenta activa con rol socio no se renderiza nada de esta zona.
  const { perfil } = await exigirSocio();
  // El pulso y la campana nunca tumban la pagina: si la lectura falla se muestra "Sin dato" y cero avisos.
  const lector = await notificacionesDeSocio();
  const [pulso, noLeidas, socioMenudeo] = await Promise.all([leerPulso(), lector.contarNoLeidas().catch(() => 0), dropshippingDeSocio().then((d) => d.socioMenudeo()).catch(() => 'Angelo')]);
  // El proveedor del cajon envuelve TODO el armazon: el pulso de la barra tambien explica sus cifras.
  return (
    <ExplicarProvider explicar={explicarCifra}>
      <Armazon nombreSocio={perfil.socio_nombre ?? 'socio'} accionSalir={salir} pulso={pulso} socioMenudeo={socioMenudeo} noLeidas={noLeidas} cargarCampana={cargarCampana} marcarLeida={marcarLeidaAccion} marcarTodasLeidas={marcarTodasLeidasAccion}>
        {children}
      </Armazon>
    </ExplicarProvider>
  );
}
