import { DESTINO_DEL_DINERO, razonamientoDe, textoCuotaBase } from '@/dominio/costos/razonamiento';
import type { ServicioVista } from '@/dominio/costos/vista';
import { LogoServicio } from '@/ui/componentes/logo-servicio';

/** Una linea por servicio: por que se atribuye a RTM y como se calcula; abajo, a donde llega el dinero (igual para todos). Solo texto: las cifras salen de la base. */
export function RazonamientoServicios({ servicios }: { servicios: ServicioVista[] }) {
  return (
    <>
      <ul className="rtm-razon" data-testid="costos-razonamiento">
        {servicios.filter((s) => s.activo).map((s) => {
          const r = razonamientoDe(s.slug);
          const cuota = textoCuotaBase(s.cuota_base);
          return (
            <li key={s.slug} data-testid={`razon-${s.slug}`}>
              <LogoServicio slug={s.slug} logoSlug={s.logo_slug} nombre={s.nombre} />
              <span className="rtm-razon-nombre">{s.nombre}</span>
              <span className="rtm-razon-texto"><strong>Por qué:</strong> {r.porQue} <strong>Cómo:</strong> {r.comoSeCalcula}{cuota ? ` ${cuota}` : ''}</span>
            </li>
          );
        })}
      </ul>
      <p className="rtm-nota" data-testid="costos-destino"><strong>A dónde llega el dinero:</strong> {DESTINO_DEL_DINERO}</p>
    </>
  );
}
