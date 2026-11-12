import type { Metadata } from 'next';
import { lectorDeSocio } from '@/composicion/catalogo';
import { operacionDeSocio } from '@/composicion/operacion';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina as Contenedor, Tarjeta } from '@/ui/componentes/pagina';
import { formatearMoneda } from '@/dominio/formato';
import '@/ui/estilos/paginas-a1.css';
import { etiquetaHoy } from '../../contexto';
import { FormularioPedido } from './formulario-pedido';

export const metadata: Metadata = { title: 'Nuevo pedido' };

export default async function PaginaNuevoPedido({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const { cliente } = await searchParams;
  const clientes = (await (await lectorDeSocio()).clientes()).filter((c) => c.activo && !c.esBodega);
  const elegido = cliente ? clientes.find((c) => c.id === Number(cliente)) : undefined;
  const catalogo = elegido ? await (await operacionDeSocio()).catalogoPedido(elegido.id) : null;

  const disponibles = catalogo ? catalogo.skus.filter((k) => k.disponible > 0) : [];
  const conPrecio = catalogo ? catalogo.skus.filter((k) => k.precio_cent !== null).length : 0;
  return (
    <Contenedor ancho="formulario">
      <EncabezadoPagina
        migaja={{ href: '/pedidos', texto: 'Volver a pedidos' }}
        eyebrow={`Nuevo pedido · ${etiquetaHoy()}`}
        titulo={elegido ? `Pedido de ${elegido.nombre}` : 'Nuevo pedido'}
        descripcion="Elige el cliente, los modelos y sabores. El precio sale del tabulador del cliente; si cobras otro, el sistema avisa pero no te bloquea."
      />
      {elegido && catalogo && (
        <KpiLinea
          etiquetaAria="Datos del catálogo para este cliente"
          celdas={[
            { id: 'skus', etiqueta: 'Sabores con existencia', valor: String(disponibles.length), categoria: 1, nota: `${catalogo.skus.length} en el catálogo` },
            { id: 'precio', etiqueta: 'Con precio en su tabulador', valor: String(conPrecio), categoria: 3, nota: conPrecio < catalogo.skus.length ? 'Los demás avisan: sin precio de catálogo' : undefined },
            { id: 'min', etiqueta: 'Mínimo por pedido', valor: `${catalogo.minimo_piezas} pz`, categoria: 6 },
            { id: 'envio', etiqueta: 'Envío por omisión', valor: formatearMoneda(catalogo.envio_default_cent), categoria: 8 },
          ]}
        />
      )}
      <Tarjeta titulo="Cliente">
        <form className="rtm-form" method="get" aria-label="Elegir cliente">
          <div className="rtm-form-fila">
            <label className="rtm-etiqueta-campo rtm-campo-ancho">Cliente
              <select name="cliente" className="rtm-campo" defaultValue={elegido?.id ?? ''} data-testid="elegir-cliente">
                <option value="" disabled>Elige un cliente</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <button type="submit" className="rtm-boton">Elegir cliente</button>
          </div>
        </form>
      </Tarjeta>
      {elegido && catalogo && <FormularioPedido key={elegido.id} clienteId={elegido.id} clienteNombre={elegido.nombre} catalogo={catalogo} />}
    </Contenedor>
  );
}
