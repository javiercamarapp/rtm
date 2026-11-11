import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { etiquetaFechaHora } from '@/dominio/formato';
import { DataTable } from '@/ui/componentes/data-table';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';
import { SEVERIDAD } from '../operacion/etiquetas';
import { BotonLeido } from './boton-leido';

export const metadata: Metadata = { title: 'Avisos' };

function destino(tipo: string | null, id: number | null): string | null {
  if (id === null) return null;
  if (tipo === 'pedido') return `/pedidos/${id}`;
  if (tipo === 'compra') return `/proveedores/compras/${id}`;
  if (tipo === 'compra_diferencia') return '/proveedores';
  if (tipo === 'pago') return '/cuentas-por-cobrar';
  return null;
}

export default async function Pagina({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const ver = estado === 'todos' ? null : 'abierta';
  const lista = await (await operacionDeSocio()).avisos(ver);
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Avisos · ${etiquetaHoy()}`}
        antes={lista.avisos.length === 0 ? 'No hay' : 'Tienes'}
        enfasis={lista.avisos.length === 0 ? 'avisos pendientes' : `${lista.avisos.length} ${lista.avisos.length === 1 ? 'aviso' : 'avisos'}`}
        contexto="Por ahora los avisos se muestran solo aquí, en el software. Cada aviso nace en la misma operación que lo provoca y se resuelve solo cuando la condición deja de existir."
      />
      <div className="rtm-barra-filtros" aria-label="Filtros">
        <Link className="rtm-chip-filtro" href="/avisos" aria-current={ver === 'abierta'}>Pendientes</Link>
        <Link className="rtm-chip-filtro" href="/avisos?estado=todos" aria-current={ver === null}>Todos</Link>
        <span className="rtm-nota">Sin leer: {lista.sin_leer}</span>
      </div>
      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Lista de avisos">
        <DataTable
          etiqueta="Avisos"
          clave={(a) => a.id}
          filas={lista.avisos}
          vacio={{ titulo: 'Sin avisos', texto: 'Los avisos aparecen cuando una operación necesita atención: una diferencia de recepción, un paquete por empacar, un pago sin identificar...' }}
          columnas={[
            { id: 's', titulo: 'Severidad', celda: (a) => <EstadoTexto tono={SEVERIDAD[a.severidad]!.tono}>{SEVERIDAD[a.severidad]!.texto}</EstadoTexto> },
            { id: 't', titulo: 'Aviso', celda: (a) => { const d = destino(a.entidad_tipo, a.entidad_id); return <>{d ? <Link href={d}>{a.titulo}</Link> : a.titulo}<br /><span className="rtm-nota">{a.nt}{a.conteo > 1 ? ` · ${a.conteo} veces` : ''}</span></>; } },
            { id: 'h', titulo: 'Cuándo', secundaria: true, celda: (a) => etiquetaFechaHora(a.creado_at) },
            { id: 'e', titulo: 'Estado', secundaria: true, celda: (a) => (a.estado === 'abierta' ? 'Pendiente' : a.estado === 'resuelta' ? 'Resuelto' : a.estado) },
            { id: 'a', titulo: 'Acción', celda: (a) => (a.leido ? <span className="rtm-nota">Leído</span> : <BotonLeido avisoId={a.id} />) },
          ]}
        />
      </section>
    </>
  );
}
