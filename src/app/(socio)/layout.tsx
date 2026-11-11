import type { ReactNode } from 'react';
import { exigirSocio } from '@/composicion/acceso';
import { notificacionesDeSocio } from '@/composicion/inventario';
import { ExplicarProvider } from '@/ui/componentes/explicar';
import { Armazon } from '@/ui/shell/armazon';
import { cargarCampana, explicarCifra, marcarLeidaAccion, marcarTodasLeidasAccion, salir } from './acciones';

export const dynamic = 'force-dynamic';

export default async function LayoutSocio({ children }: { children: ReactNode }) {
  // La autoridad es la tabla: sin cuenta activa con rol socio no se renderiza nada de esta zona.
  const { perfil } = await exigirSocio();
  // El pulso y la campana nunca tumban la pagina: si la lectura falla se muestra "Sin dato" y cero avisos.
  const lector = await notificacionesDeSocio();
  const [pulso, noLeidas] = await Promise.all([lector.pulso().catch(() => null), lector.contarNoLeidas().catch(() => 0)]);
  return (
    <Armazon nombreSocio={perfil.socio_nombre ?? 'socio'} accionSalir={salir} pulso={pulso} noLeidas={noLeidas} cargarCampana={cargarCampana} marcarLeida={marcarLeidaAccion} marcarTodasLeidas={marcarTodasLeidasAccion}>
      <ExplicarProvider explicar={explicarCifra}>{children}</ExplicarProvider>
    </Armazon>
  );
}
