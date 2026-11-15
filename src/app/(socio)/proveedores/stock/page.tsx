import type { Metadata } from 'next';
import Link from 'next/link';
import { proveedoresDeSocio, tableroDeSocio } from '@/composicion/proveedores';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';
import { StockKaren } from './stock-karen';

export const metadata: Metadata = { title: 'Stock disponible de proveedores' };
export const dynamic = 'force-dynamic';

type Busqueda = Record<string, string | string[] | undefined>;

const PROVEEDORES = [{ id: 'karen', nombre: 'Karen' }, { id: 'isaac', nombre: 'Isaac' }] as const;

/** Stock que hay ahora en cada proveedor. Karen con lectura de su tienda; Isaac sin lectura hasta que exista una fuente. Sin precios del proveedor. */
export default async function PaginaStockProveedores({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const activo = sp['p'] === 'isaac' ? 'isaac' : 'karen';
  const [p, tablero] = activo === 'karen' ? await Promise.all([proveedoresDeSocio(), tableroDeSocio()]) : [null, null];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        migaja={{ href: '/proveedores', texto: 'Proveedores' }}
        eyebrow="Inventario de proveedores"
        titulo="Stock disponible de proveedores"
        descripcion="Qué modelos y sabores hay ahora con cada proveedor. Sin precios: los costos los da Javier."
      />
      <nav className="rtm-st-pestanas" aria-label="Proveedor">
        {PROVEEDORES.map((x) => <Link key={x.id} href={x.id === 'karen' ? '/proveedores/stock' : `/proveedores/stock?p=${x.id}`} aria-current={activo === x.id ? 'page' : undefined} data-testid={`prov-${x.id}`}>{x.nombre}</Link>)}
      </nav>
      {activo === 'karen' && p && tablero ? (
        <StockKaren modelos={tablero.modelos} eventos={p.eventos} ultimaLecturaOk={p.frescura.ultima_lectura_ok} desactualizado={p.frescura.desactualizado} lecturaActiva={p.frescura.lectura_activa} ahoraIso={new Date().toISOString()} busqueda={sp} />
      ) : (
        <section className="rtm-kr-vacio" data-testid="vacio-isaac">
          <span aria-hidden="true" className="rtm-kr-vacio-marca">I</span>
          <h2>Isaac todavía no tiene lectura de stock</h2>
          <p>Cuando Isaac tenga una fuente que se pueda leer, aquí aparecerá su stock con el mismo formato que Karen. Mientras tanto, su existencia se consulta con él y se captura en compras.</p>
          <Link className="rtm-boton" href="/proveedores">Ir a Proveedores</Link>
        </section>
      )}
    </Pagina>
  );
}
