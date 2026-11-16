import type { Metadata } from 'next';
import Link from 'next/link';
import { operacionDeSocio } from '@/composicion/operacion';
import { proveedoresDeSocio, tableroDeSocio, tableroIsaacDeSocio } from '@/composicion/proveedores';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { armarModelosOrden } from '@/dominio/proveedores/orden';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';
import '@/ui/estilos/orden-stock.css';
import { OrdenDesdeStock } from './orden-desde-stock';
import { StockKaren } from './stock-karen';

export const metadata: Metadata = { title: 'Stock disponible de proveedores' };
export const dynamic = 'force-dynamic';

type Busqueda = Record<string, string | string[] | undefined>;

const PROVEEDORES = [{ id: 'karen', nombre: 'Karen' }, { id: 'isaac', nombre: 'Isaac' }] as const;

/** Stock que hay ahora en cada proveedor. Karen con lectura de su tienda; Isaac con su catálogo Remate (sin lectura en vivo). Sin precios del proveedor. */
export default async function PaginaStockProveedores({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const sp = await searchParams;
  const activo = sp['p'] === 'isaac' ? 'isaac' : 'karen';
  const [p, tablero] = activo === 'karen' ? await Promise.all([proveedoresDeSocio(), tableroDeSocio()]) : [null, null];
  const isaac = activo === 'isaac' ? await tableroIsaacDeSocio() : null;
  // Orden de compra: sabores del catalogo de compra del proveedor (con su costo vigente), marcando los disponibles segun la lectura de Karen o el catalogo de Isaac (sin catalogo cargado: por confirmar).
  const proveedorOrden = activo === 'karen' ? 'Karen' : 'Isaac';
  const catalogo = await (await operacionDeSocio()).catalogoCompra(proveedorOrden).catch(() => null);
  const fuente = tablero ?? (isaac && isaac.modelos.length > 0 ? isaac : null);
  const disponibilidad = fuente ? new Map(fuente.modelos.filter((m) => m.canonico_nombre).map((m) => [normalizar(m.canonico_nombre!), new Set(m.sabores.filter((s) => s.disponible).map((s) => normalizar(s.sabor)))] as const)) : null;
  const modelosOrden = catalogo ? armarModelosOrden(catalogo.skus, disponibilidad) : [];

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
      ) : isaac && isaac.modelos.length > 0 ? (
        <StockKaren modelos={isaac.modelos} eventos={[]} ultimaLecturaOk={null} desactualizado={false} lecturaActiva={false} ahoraIso={new Date().toISOString()} busqueda={sp} proveedor="Isaac" />
      ) : (
        <section className="rtm-kr-vacio" data-testid="vacio-isaac">
          <span aria-hidden="true" className="rtm-kr-vacio-marca">I</span>
          <h2>Isaac todavía no tiene catálogo cargado</h2>
          <p>Cuando se cargue el catálogo de Isaac, aquí aparecerá su stock con el mismo formato que Karen. Mientras tanto, su existencia se consulta con él y se captura en compras.</p>
          <Link className="rtm-boton" href="/proveedores">Ir a Proveedores</Link>
        </section>
      )}
      {catalogo && <OrdenDesdeStock proveedor={proveedorOrden} modelos={modelosOrden} conLectura={disponibilidad !== null} />}
    </Pagina>
  );
}
