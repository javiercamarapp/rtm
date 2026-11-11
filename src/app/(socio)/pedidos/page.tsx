import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { EstadoPedido } from '@/dominio/operacion/tipos';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';
import { ESTADO_PEDIDO, ORIGEN } from '../operacion/etiquetas';

export const metadata: Metadata = { title: 'Pedidos y notas' };

const ESTADOS: { clave: string; texto: string }[] = [
  { clave: '', texto: 'Todos' }, { clave: 'borrador', texto: 'Borradores' }, { clave: 'confirmado', texto: 'Por enviar' }, { clave: 'enviado', texto: 'Enviados' }, { clave: 'anulado', texto: 'Anulados' },
];

export default async function Pagina({ searchParams }: { searchParams: Promise<{ estado?: string; duenio?: string; aviso?: string }> }) {
  const { estado = '', duenio = '', aviso = '' } = await searchParams;
  const todos = await (await operacionDeSocio()).pedidos();
  const filas = todos.filter((p) => (!estado || p.estado === (estado as EstadoPedido)) && (!duenio || p.duenio === duenio) && (!aviso || p.avisos > 0));
  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(duenio ? { duenio } : {}), ...(aviso ? { aviso } : {}), ...cambios });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return s ? `/pedidos?${s}` : '/pedidos';
  };

  return (
    <>
      <EncabezadoPagina
        eyebrow={`Pedidos y notas · ${etiquetaHoy()}`}
        antes={todos.length === 0 ? 'Aún no hay' : 'Tienes'}
        enfasis={todos.length === 0 ? 'pedidos' : `${todos.length} pedidos`}
        despues={todos.length === 0 ? '' : 'en el libro'}
        contexto="Se cobra solo lo surtido: lo que no sale queda como entrega diferida o como saldo a favor del cliente. Cada pedido tiene su nota para el cliente y su hoja interna, y se comprueba por dos vías."
        acciones={<Link className="rtm-boton rtm-boton-primario" href="/pedidos/nuevo">Nuevo pedido</Link>}
      />
      <div className="rtm-barra-filtros" aria-label="Filtros">
        {ESTADOS.map((e) => <Link key={e.clave} className="rtm-chip-filtro" href={enlace({ estado: e.clave })} aria-current={estado === e.clave}>{e.texto}</Link>)}
        <Link className="rtm-chip-filtro" href={enlace({ duenio: duenio === 'Angelo' ? '' : 'Angelo' })} aria-current={duenio === 'Angelo'}>De Angelo</Link>
        <Link className="rtm-chip-filtro" href={enlace({ duenio: duenio === 'Javier' ? '' : 'Javier' })} aria-current={duenio === 'Javier'}>De Javier</Link>
        <Link className="rtm-chip-filtro" href={enlace({ aviso: aviso ? '' : '1' })} aria-current={aviso === '1'}>Con aviso</Link>
      </div>
      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Lista de pedidos">
        <DataTable
          etiqueta="Pedidos"
          clave={(p) => p.id}
          filas={filas}
          vacio={{ titulo: 'Sin pedidos', texto: todos.length === 0 ? 'Crea el primer pedido: eliges el cliente, los modelos y sabores, y el sistema toma el precio del tabulador.' : 'Ningún pedido coincide con los filtros.', accion: <Link className="rtm-boton" href="/pedidos/nuevo">Nuevo pedido</Link> }}
          columnas={[
            { id: 'f', titulo: 'Folio', celda: (p) => <Link className="rtm-mono" href={`/pedidos/${p.id}`}>{p.folio}</Link> },
            { id: 'd', titulo: 'Fecha', secundaria: true, celda: (p) => etiquetaFecha(p.fecha_neg) },
            { id: 'c', titulo: 'Cliente', celda: (p) => p.cliente },
            { id: 'o', titulo: 'Dueño', secundaria: true, celda: (p) => p.duenio },
            { id: 'r', titulo: 'Origen', secundaria: true, celda: (p) => ORIGEN[p.origen] },
            { id: 'z', titulo: 'Piezas', numerica: true, celda: (p) => (p.estado === 'enviado' || p.estado === 'anulado' ? `${formatearPiezas(p.piezas_surtidas)} de ${p.piezas_pedidas}` : formatearPiezas(p.piezas_pedidas)) },
            { id: 'b', titulo: 'Cobrado', numerica: true, celda: (p) => (p.estado === 'enviado' ? <CifraComprobada texto={formatearMoneda(p.cobrado_cent)} cifra={`pedido:total:${p.id}`} comprobacion="cuadra" /> : <SinDato />) },
            { id: 'u', titulo: 'Utilidad', numerica: true, secundaria: true, celda: (p) => (p.utilidad_cent === null ? <SinDato /> : <>{formatearMoneda(p.utilidad_cent)}{p.utilidad_provisional ? <> <EstadoTexto tono="atencion">provisional</EstadoTexto></> : null}</>) },
            { id: 'e', titulo: 'Estado', celda: (p) => <EstadoTexto tono={ESTADO_PEDIDO[p.estado].tono}>{ESTADO_PEDIDO[p.estado].texto}</EstadoTexto> },
            { id: 'p', titulo: 'Pago', secundaria: true, celda: (p) => (p.estado !== 'enviado' || p.saldo_cent === null ? '' : p.saldo_cent === 0n ? <EstadoTexto tono="ok">Saldado</EstadoTexto> : p.saldo_cent < 0n ? <EstadoTexto tono="neutro">A favor</EstadoTexto> : <EstadoTexto tono="atencion">Por cobrar</EstadoTexto>) },
            { id: 'a', titulo: 'Avisos', secundaria: true, celda: (p) => (p.avisos > 0 ? <EstadoTexto tono="atencion">{p.avisos} {p.avisos === 1 ? 'aviso' : 'avisos'}</EstadoTexto> : '') },
          ]}
        />
      </section>
    </>
  );
}
