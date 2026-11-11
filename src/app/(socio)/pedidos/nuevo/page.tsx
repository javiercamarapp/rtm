import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { operacionDeSocio } from '@/composicion/operacion';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../../contexto';
import { FormularioPedido } from './formulario-pedido';

export const metadata: Metadata = { title: 'Nuevo pedido' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams;
  const clientes = (await (await lectorDeSocio()).clientes()).filter((c) => c.activo && !c.esBodega);
  const elegido = cliente ? clientes.find((c) => c.id === Number(cliente)) : undefined;
  const catalogo = elegido ? await (await operacionDeSocio()).catalogoPedido(elegido.id) : null;

  return (
    <>
      <p className="rtm-migaja"><Link href="/pedidos">Pedidos y notas</Link> / Nuevo</p>
      <EncabezadoPagina
        eyebrow={`Nuevo pedido · ${etiquetaHoy()}`}
        antes="Pedido de"
        enfasis={elegido ? elegido.nombre : 'un cliente'}
        contexto="Eliges el cliente, los modelos y sabores. El precio sale del tabulador del cliente; si cobras otro, el sistema avisa pero no te bloquea."
      />
      <form className="rtm-form" method="get" aria-label="Elegir cliente">
        <div className="rtm-form-fila">
          <label className="rtm-etiqueta-campo rtm-campo-ancho">Cliente
            <select name="cliente" className="rtm-campo" defaultValue={elegido?.id ?? ''} data-testid="elegir-cliente">
              <option value="" disabled>Elige un cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.duenio})</option>)}
            </select>
          </label>
          <button type="submit" className="rtm-boton">Elegir cliente</button>
        </div>
      </form>
      {elegido && catalogo && <FormularioPedido key={elegido.id} clienteId={elegido.id} clienteNombre={elegido.nombre} catalogo={catalogo} />}
    </>
  );
}
