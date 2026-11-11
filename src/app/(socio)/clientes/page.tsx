import type { Metadata } from 'next';
import Link from 'next/link';
import { lectorDeSocio } from '@/composicion/catalogo';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { DataTable } from '@/ui/componentes/data-table';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { etiquetaHoy } from '../contexto';

export const metadata: Metadata = { title: 'Clientes' };

const TIPOS: Record<string, string> = { mayoreo: 'Mayoreo', credito_interno: 'Crédito interno', ocasional: 'Ocasional' };

export default async function Pagina() {
  const clientes = await (await lectorDeSocio()).clientes();
  return (
    <>
      <EncabezadoPagina
        eyebrow={`Clientes · ${etiquetaHoy()}`}
        antes="Tus"
        enfasis={`${clientes.length} clientes`}
        contexto="Cada cliente tiene un tabulador por modelo con su historial. Solo se guardan nombre y precios: sin teléfonos ni direcciones."
        acciones={<Link className="rtm-boton rtm-boton-primario" href="/clientes/nuevo" data-testid="nuevo-cliente">Nuevo cliente</Link>}
      />
      <DataTable
        etiqueta="Clientes"
        clave={(c) => c.id}
        filas={clientes}
        vacio={{ titulo: 'Sin clientes', texto: 'Todavía no hay clientes registrados.' }}
        columnas={[
          { id: 'n', titulo: 'Cliente', celda: (c) => <Link href={`/clientes/${c.id}`}>{c.nombre}</Link> },
          { id: 't', titulo: 'Tipo', secundaria: true, celda: (c) => <>{TIPOS[c.tipo] ?? c.tipo}{c.esBodega && <> · <EstadoTexto tono="neutro">presta la bodega</EstadoTexto></>}</> },
          { id: 'p', titulo: 'Modelos con precio', numerica: true, celda: (c) => c.precios },
          { id: 'a', titulo: 'También se le dice', secundaria: true, celda: (c) => (c.alias.length === 0 ? '—' : c.alias.map((a) => (a.porConfirmar ? `${a.alias} (por confirmar)` : a.alias)).join(', ')) },
        ]}
      />
    </>
  );
}
