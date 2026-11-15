import Link from 'next/link';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { IncidentePaquete } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { ModelosSabores } from '@/ui/componentes/modelos-sabores';
import { ChipEstado } from '@/ui/componentes/controles';
import { Tarjeta } from '@/ui/componentes/pagina';
import { DialogoResolver } from './dialogos-incidente';

const RESPONSABLE = { sociedad: 'Sociedad', socio: 'Socio', proveedor: 'Proveedor', cliente: 'Cliente', mixto: 'Varios' } as const;
const ACCION = { reponer: 'Reposición', bonificar: 'Bonificación', castigar: 'Castigo', asignar: 'Cobro al socio', reclamar: 'Reclamo', mixta: 'Varias', ninguna: 'Sin cambio' } as const;

/** Incidentes de paquetes perdidos o dañados de un sentido: estado, piezas, costo, quién absorbe y efecto. Cifras con "Explicar este número". */
export function TablaIncidentes({ incidentes, sentido, testid }: { incidentes: IncidentePaquete[]; sentido: 'salida' | 'entrada'; testid: string }) {
  const filas = incidentes.filter((i) => i.sentido === sentido);
  const abiertos = filas.filter((i) => i.estado === 'abierto');
  const piezas = filas.reduce((a, i) => a + i.piezas, 0);
  const valor = filas.reduce((a, i) => a + i.valor_cent, 0n);
  const absorbido = filas.reduce((a, i) => a + (i.resolucion?.absorbe_sociedad_cent ?? 0n), 0n);
  const porCobrar = filas.reduce((a, i) => a + (i.resolucion?.recuperable_cent ?? 0n), 0n);
  return (
    <Tarjeta plana titulo={sentido === 'salida' ? 'Paquetes perdidos o dañados en el envío a clientes' : 'Paquetes perdidos o dañados en camino desde proveedores'} descripcion={`${abiertos.length} por resolver · ${filas.length} en total`}>
      <DataTable
        etiqueta={sentido === 'salida' ? 'Incidentes de paquetes enviados' : 'Incidentes de paquetes en trayecto'} densidad="densa" plana primeraFija interactiva={{ busqueda: sentido === 'salida' ? 'Buscar folio o pedido' : 'Buscar folio u orden', exportar: `incidentes-${sentido}` }}
        totales={filas.length ? { etiqueta: 'Totales', celdas: { z: formatearPiezas(piezas), v: formatearMoneda(valor), a: formatearMoneda(absorbido), k: formatearMoneda(porCobrar) } } : undefined}
        clave={(i) => i.id}
        filas={filas}
        vacio={{ titulo: 'Sin incidentes', texto: sentido === 'salida' ? 'Un paquete enviado que se pierde o llega dañado se reporta desde Enviados recientes.' : 'Una orden en camino que se pierde o llega dañada se reporta desde su renglón.' }}
        columnas={[
          { id: 'f', titulo: 'Folio', ancho: 'm', celda: (i) => <span className="rtm-mono rtm-a2-nowrap" data-testid={`${testid}-folio`}>{i.folio}</span> },
          { id: 'o', titulo: sentido === 'salida' ? 'Pedido' : 'Orden', ancho: 'm', celda: (i) => (sentido === 'salida' ? <Link className="rtm-mono rtm-a2-nowrap" href={`/pedidos/${i.pedido_id}`}>{i.pedido_folio}</Link> : <Link className="rtm-mono rtm-a2-nowrap" href={`/proveedores/compras/${i.compra_id}`}>{i.compra_folio}</Link>) },
          { id: 'c', titulo: sentido === 'salida' ? 'Cliente' : 'Proveedor', secundaria: true, truncar: 's', celda: (i) => (sentido === 'salida' ? i.cliente : i.proveedor) },
          { id: 'r', titulo: 'Tipo, modelo y sabor', secundaria: true, ancho: 'xl', celda: (i) => <><span className="rtm-nota">{i.tipo === 'perdido' ? 'Perdido' : 'Dañado'}</span><ModelosSabores variante="celda" testid={`${testid}-ms-${i.id}`} renglones={i.renglones.map((r) => ({ modelo: r.modelo, sabor: r.sabor, piezas: r.piezas }))} /></> },
          { id: 'z', titulo: 'Piezas', numerica: true, celda: (i) => formatearPiezas(i.piezas) },
          { id: 'v', titulo: 'Costo de lo perdido', numerica: true, celda: (i) => <CifraComprobada texto={formatearMoneda(i.valor_cent)} cifra={`paquete:valor:${i.id}`} comprobacion="cuadra" /> },
          { id: 'q', titulo: 'Quién absorbe', celda: (i) => {
            // En entrada manda el responsable vigente (puede haberse reasignado desde la compra); en salida, el de la resolucion.
            const r = i.sentido === 'entrada' ? (i.responsable_vigente ?? i.resolucion?.responsable) : i.resolucion?.responsable;
            const socio = r === 'socio' ? i.resolucion?.socio : null;
            return <span className="rtm-nowrap">{r ? `${RESPONSABLE[r]}${socio ? ` (${socio})` : ''}` : 'Por decidir'}</span>;
          } },
          { id: 'e', titulo: 'Efecto', secundaria: true, celda: (i) => (i.resolucion ? ACCION[i.resolucion.accion] : 'Pendiente') },
          { id: 'a', titulo: 'Absorbe la sociedad', numerica: true, celda: (i) => (i.resolucion ? <CifraComprobada texto={formatearMoneda(i.resolucion.absorbe_sociedad_cent)} cifra={`paquete:absorbe:${i.id}`} comprobacion="cuadra" /> : 'Pendiente') },
          { id: 'k', titulo: 'Por cobrar', numerica: true, secundaria: true, celda: (i) => (i.resolucion ? formatearMoneda(i.resolucion.recuperable_cent) : 'Pendiente') },
          { id: 's', titulo: 'Estado', celda: (i) => <ChipEstado tono={i.estado === 'abierto' ? 'atencion' : 'ok'}>{i.estado === 'abierto' ? 'Por resolver' : 'Resuelto'}</ChipEstado> },
          { id: 'x', titulo: 'Acciones', celda: (i) => (i.estado === 'abierto' ? <DialogoResolver incidente={i} /> : null) },
        ]}
      />
    </Tarjeta>
  );
}
