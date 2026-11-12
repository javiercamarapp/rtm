import type { Metadata } from 'next';
import { bodegaDeOmar } from '@/composicion/omar';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { ListaDisponible, ListaSolicitudes } from '@/ui/omar/bodega';
import { FormularioSolicitud } from '@/ui/omar/formulario-solicitud';
import { solicitarPiezas } from '../acciones';

export const metadata: Metadata = { title: 'Mi bodega' };

export default async function Pagina() {
  const b = await bodegaDeOmar();
  const ahoraIso = new Date().toISOString();
  return (
    <>
      <EncabezadoPagina eyebrow="Tu bodega · ahora" antes="Lo que hay" enfasis="en tu bodega" contexto="Existencia por modelo y sabor. Para llevarte piezas, haz una solicitud: los socios la autorizan desde su grupo." />
      <div className="omar-rejilla">
        <section className="rtm-seccion rtm-entra rtm-i-1" aria-label="Disponible en tu bodega">
          <h2>Disponible</h2>
          <ListaDisponible lectura={b.disponible} />
        </section>
        <div className="rtm-seccion rtm-entra rtm-i-2">
          <section className="rtm-seccion" aria-label="Solicitar piezas">
            <h2>Solicitar piezas</h2>
            {b.disponible.estado === 'ok'
              ? <FormularioSolicitud disponible={b.disponible.datos} tope={b.config.tope_toma_piezas} caducaHoras={b.config.caduca_horas} enviar={solicitarPiezas} />
              : <p className="rtm-error" role="alert">No se pudo leer tu bodega, así que no se puede solicitar ahora.</p>}
          </section>
          <section className="rtm-seccion" aria-label="Últimas solicitudes">
            <h2>Últimas solicitudes</h2>
            <ListaSolicitudes lectura={b.solicitudes} ahoraIso={ahoraIso} />
          </section>
        </div>
      </div>
    </>
  );
}
