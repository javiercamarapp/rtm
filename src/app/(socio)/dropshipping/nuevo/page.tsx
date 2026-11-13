import type { Metadata } from 'next';
import { exigirSocio } from '@/composicion/acceso';
import { lectorDeSocio } from '@/composicion/catalogo';
import { dropshippingDeSocio } from '@/composicion/dropshipping';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { PestanasDs } from '../comun';
import { FormularioDs } from './formulario-ds';

export const metadata: Metadata = { title: 'Nuevo pedido de dropshipping' };
const ORIGENES = ['karen_directo', 'karen_via_isaac', 'isaac_directo'];

export default async function PaginaNuevoDs({ searchParams }: { searchParams: Promise<{ cliente?: string; origen?: string }> }) {
  const sp = await searchParams;
  const { perfil } = await exigirSocio();
  const origen = ORIGENES.includes(sp.origen ?? '') ? (sp.origen as string) : 'karen_directo';
  const clientes = (await (await lectorDeSocio()).clientes()).filter((c) => c.activo && !c.esBodega);
  const elegido = sp.cliente ? clientes.find((c) => c.id === Number(sp.cliente)) : undefined;
  const ds = await dropshippingDeSocio();
  const [catalogo, resumen, socioMenudeo] = await Promise.all([elegido ? ds.catalogo(elegido.id, origen) : Promise.resolve(null), ds.resumen(), ds.socioMenudeo()]);
  return (
    <Pagina ancho="formulario">
      <EncabezadoPagina
        eyebrow={`Dropshipping · Nuevo pedido · ${etiquetaHoy()}`}
        titulo={elegido ? `Pedido de ${elegido.nombre}` : 'Nuevo pedido de dropshipping'}
        descripcion="Captura el pedido y el destinatario; el sistema calcula costo, margen e interés y arma la orden para copiarla."
      />
      <PestanasDs activa="nuevo" sinFolio={resumen.sin_folio_externo} />
      <Tarjeta titulo="Cliente">
        <form className="rtm-form" method="get" aria-label="Elegir cliente">
          <div className="rtm-form-fila">
            <label className="rtm-etiqueta-campo rtm-campo-ancho">Cliente
              <select name="cliente" className="rtm-campo" defaultValue={elegido?.id ?? ''} data-testid="ds-elegir-cliente">
                <option value="" disabled>Elige un cliente</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label className="rtm-etiqueta-campo">Surte
              <select name="origen" className="rtm-campo" defaultValue={origen} data-testid="ds-origen">
                <option value="karen_directo">Karen directo</option><option value="karen_via_isaac">Karen vía Isaac</option><option value="isaac_directo">Isaac directo</option>
              </select>
            </label>
            <button type="submit" className="rtm-boton" data-testid="ds-elegir">Elegir</button>
          </div>
        </form>
      </Tarjeta>
      {elegido && catalogo && <FormularioDs key={`${elegido.id}-${origen}`} clienteId={elegido.id} clienteNombre={elegido.nombre} origen={origen} catalogo={catalogo} socioMenudeo={socioMenudeo} puedeMenudeo={perfil.socio_nombre === socioMenudeo} />}
    </Pagina>
  );
}
