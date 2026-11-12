import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { Chip } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Tarjeta } from '@/ui/componentes/pagina';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Dos, Estado, m } from '../_a3/util';
import { AnularDevolucionCliente } from '../pedidos/[id]/devolucion-pedido';
import { AnularDevolucionProveedor, DevolverAProveedor } from './formulario-proveedor';

export const metadata: Metadata = { title: 'Devoluciones' };

export default async function PaginaDevoluciones() {
  const lector = await operacionDeSocio();
  const [d, cat] = await Promise.all([lector.devoluciones(), lector.catalogoDevolucionProveedor()]);
  const vigC = d.clientes.filter((x) => !x.anulada);
  const vigP = d.proveedores.filter((x) => !x.anulada);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Operación"
        titulo="Devoluciones"
        descripcion="Mercancía que regresa de un cliente (nota de crédito) o que se devuelve a Isaac o Karen. Cada una mueve el kárdex, la cuenta por cobrar o por pagar y el libro contable por su cuenta."
        acciones={<DevolverAProveedor catalogo={cat} />}
      />
      <KpiLinea
        etiquetaAria="Cifras de devoluciones"
        celdas={[
          { id: 'cc', etiqueta: 'Crédito a clientes (vigente)', valor: m(d.credito_clientes_cent), categoria: 1, nota: `${vigC.length} notas de crédito · ${formatearPiezas(vigC.reduce((a, x) => a + x.piezas, 0))} pz` },
          { id: 'cl', etiqueta: 'Pagos liberados a saldo a favor', valor: m(vigC.reduce((a, x) => a + x.liberado_cent, 0n)), categoria: 2, nota: 'Dinero que el cliente ya había pagado' },
          { id: 'cp', etiqueta: 'Crédito con proveedores (vigente)', valor: m(d.credito_proveedores_cent), categoria: 3, nota: `${vigP.length} devoluciones · ${formatearPiezas(vigP.reduce((a, x) => a + x.piezas, 0))} pz` },
          { id: 'co', etiqueta: 'Costo de lo devuelto por clientes', valor: m(vigC.reduce((a, x) => a + x.costo_cent, 0n)), categoria: 5, nota: 'Vuelve al inventario o se va a merma' },
        ]}
      />
      <Tarjeta plana titulo="Devoluciones de clientes" descripcion="Se registran desde el pedido enviado: Devolver mercancía">
        <DataTable
          etiqueta="Devoluciones de clientes" densidad="densa" plana primeraFija clave={(x) => x.id} filas={d.clientes}
          vacio={{ titulo: 'Sin devoluciones de clientes', texto: 'Todavía no hay devoluciones de clientes.' }}
          totales={{ etiqueta: 'Vigentes', celdas: { p: formatearPiezas(vigC.reduce((a, x) => a + x.piezas, 0)), c: m(d.credito_clientes_cent) } }}
          columnas={[
            { id: 'f', titulo: 'Nota de crédito', ancho: 'm', celda: (x) => <a href={`/devoluciones/cliente/${x.id}/pdf`} target="_blank" rel="noreferrer">{x.folio}</a> },
            { id: 'fe', titulo: 'Fecha', ancho: 's', celda: (x) => etiquetaFecha(x.fecha_neg) },
            { id: 'cl', titulo: 'Cliente · pedido', ancho: 'l', celda: (x) => <Dos a={x.cliente} b={<Link href={`/pedidos/${x.pedido_id}`}>{x.pedido}</Link>} /> },
            { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => formatearPiezas(x.piezas) },
            { id: 'c', titulo: 'Crédito', numerica: true, ancho: 'm', celda: (x) => <CifraComprobada texto={formatearMoneda(x.monto_cent)} cifra={`devolucion:cliente:${x.id}`} comprobacion="cuadra" /> },
            { id: 'l', titulo: 'Liberado a favor', numerica: true, ancho: 'm', secundaria: true, celda: (x) => m(x.liberado_cent) },
            { id: 'mo', titulo: 'Motivo', ancho: 'l', celda: (x) => x.motivo },
            { id: 'e', titulo: 'Estado', ancho: 's', celda: (x) => <Estado tono={x.anulada ? 'atencion' : 'ok'}>{x.anulada ? 'Anulada' : 'Vigente'}</Estado> },
            { id: 'a', titulo: '', ancho: 's', celda: (x) => (x.anulada ? '' : <AnularDevolucionCliente id={x.id} folio={x.folio} />) },
          ]}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Devoluciones a proveedores" descripcion="Sale de Bodega Omar al costo promedio y sube la cuenta con el proveedor">
        <DataTable
          etiqueta="Devoluciones a proveedores" densidad="densa" plana primeraFija clave={(x) => x.id} filas={d.proveedores}
          vacio={{ titulo: 'Sin devoluciones a proveedores', texto: 'Todavía no hay devoluciones a proveedores.' }}
          totales={{ etiqueta: 'Vigentes', celdas: { p: formatearPiezas(vigP.reduce((a, x) => a + x.piezas, 0)), v: m(d.credito_proveedores_cent) } }}
          columnas={[
            { id: 'f', titulo: 'Devolución', ancho: 'm', celda: (x) => <a href={`/devoluciones/proveedor/${x.id}/pdf`} target="_blank" rel="noreferrer">{x.folio}</a> },
            { id: 'fe', titulo: 'Fecha', ancho: 's', celda: (x) => etiquetaFecha(x.fecha_neg) },
            { id: 'pr', titulo: 'Proveedor · orden', ancho: 'l', celda: (x) => <Dos a={x.proveedor} b={x.compra ?? 'Sin orden'} /> },
            { id: 'p', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => formatearPiezas(x.piezas) },
            { id: 'v', titulo: 'Crédito', numerica: true, ancho: 'm', celda: (x) => <CifraComprobada texto={formatearMoneda(x.valor_cent)} cifra={`devolucion:proveedor:${x.id}`} comprobacion="cuadra" /> },
            { id: 'mo', titulo: 'Motivo', ancho: 'l', celda: (x) => x.motivo },
            { id: 'e', titulo: 'Estado', ancho: 's', celda: (x) => <Estado tono={x.anulada ? 'atencion' : 'ok'}>{x.anulada ? 'Anulada' : 'Vigente'}</Estado> },
            { id: 'a', titulo: '', ancho: 's', celda: (x) => (x.anulada ? '' : <AnularDevolucionProveedor id={x.id} folio={x.folio} />) },
          ]}
        />
      </Tarjeta>
      <p className="rtm-nota"><Chip>Nota</Chip> El crédito de un cliente es piezas por el precio de su nota (sin envío ni descuento; parámetro pendiente del dueño). El del proveedor es el valor en libros: una diferencia pactada se captura como ajuste de proveedor.</p>
    </Pagina>
  );
}
