import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { DataTable } from '@/ui/componentes/data-table';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Clientes' };

const TIPOS: Record<string, string> = { mayoreo: 'Mayoreo', credito_interno: 'Crédito interno', ocasional: 'Ocasional' };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ duenio?: string }> }) {
  const sp = await searchParams;
  const todos = await (await lectorDeSocio()).clientes();
  const duenio = sp.duenio === 'Angelo' || sp.duenio === 'Javier' ? sp.duenio : null;
  const clientes = duenio ? todos.filter((c) => c.duenio === duenio) : todos;
  const de = (n: string) => todos.filter((c) => c.duenio === n).length;
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Clientes · ${etiquetaHoy()}`}
        antes="Tus"
        enfasis={`${todos.length} clientes`}
        despues={`: ${de('Angelo')} de Angelo y ${de('Javier')} de Javier`}
        contexto="Cada cliente tiene dueño y un tabulador por modelo con su historial. Solo se guardan nombre y precios: sin teléfonos ni direcciones."
        acciones={<Link className="rtm-boton rtm-boton-primario" href="/clientes/nuevo" data-testid="nuevo-cliente">Nuevo cliente</Link>}
      />
      <nav className="rtm-barra-filtros" aria-label="Filtrar por dueño">
        <Link className="rtm-chip-filtro" href="/clientes" aria-current={!duenio}>Todos</Link>
        <Link className="rtm-chip-filtro" href="/clientes?duenio=Angelo" aria-current={duenio === 'Angelo'}>De Angelo</Link>
        <Link className="rtm-chip-filtro" href="/clientes?duenio=Javier" aria-current={duenio === 'Javier'}>De Javier</Link>
      </nav>
      <DataTable
        etiqueta="Clientes"
        clave={(c) => c.id}
        filas={clientes}
        vacio={{ titulo: 'Sin clientes', texto: 'Todavía no hay clientes con este filtro.', accion: <Link className="rtm-boton" href="/clientes">Ver todos</Link> }}
        columnas={[
          { id: 'n', titulo: 'Cliente', celda: (c) => <Link href={`/clientes/${c.id}`}>{c.nombre}</Link> },
          { id: 'd', titulo: 'Dueño', celda: (c) => c.duenio },
          { id: 't', titulo: 'Tipo', secundaria: true, celda: (c) => <>{TIPOS[c.tipo] ?? c.tipo}{c.esBodega && <> · <EstadoTexto tono="neutro">presta la bodega</EstadoTexto></>}</> },
          { id: 'p', titulo: 'Modelos con precio', numerica: true, celda: (c) => c.precios },
          { id: 'a', titulo: 'También se le dice', secundaria: true, celda: (c) => (c.alias.length === 0 ? '—' : c.alias.map((a) => (a.porConfirmar ? `${a.alias} (por confirmar)` : a.alias)).join(', ')) },
        ]}
      />
    </>
  );
}
