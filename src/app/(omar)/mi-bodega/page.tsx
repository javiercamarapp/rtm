import type { Metadata } from 'next';
import { bodegaDeOmar } from '@/composicion/omar';
import { Aviso } from '@/ui/componentes/controles';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ListaDisponible, ListaSolicitudes } from '@/ui/omar/bodega';
import { FormularioSolicitud } from '@/ui/omar/formulario-solicitud';
import { solicitarPiezas } from '../acciones';

export const metadata: Metadata = { title: 'Mi bodega' };

export default async function PaginaMiBodega() {
  const b = await bodegaDeOmar();
  const ahoraIso = new Date().toISOString();
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Tu bodega · ahora" titulo="Lo que hay en tu bodega" descripcion="Existencia por modelo y sabor. Para llevarte piezas, haz una solicitud: los socios la autorizan desde su grupo." />
      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo="Disponible" descripcion="Existencia por modelo y sabor">
          <ListaDisponible lectura={b.disponible} />
        </Tarjeta>
        <div className="rtm-pila-llena">
          <Tarjeta titulo="Solicitar piezas" descripcion="Los socios la autorizan desde su grupo">
            {b.disponible.estado === 'ok'
              ? <FormularioSolicitud disponible={b.disponible.datos} tope={b.config.tope_toma_piezas} caducaHoras={b.config.caduca_horas} enviar={solicitarPiezas} />
              : <Aviso tono="error">No se pudo leer tu bodega, así que no se puede solicitar ahora.</Aviso>}
          </Tarjeta>
          <Tarjeta plana titulo="Últimas solicitudes" descripcion="Las diez más recientes">
            <ListaSolicitudes lectura={b.solicitudes} ahoraIso={ahoraIso} />
          </Tarjeta>
        </div>
      </Rejilla>
    </Pagina>
  );
}
