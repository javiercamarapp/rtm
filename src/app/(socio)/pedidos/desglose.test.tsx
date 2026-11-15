import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DesglosePedidos } from '@/dominio/operacion/tipos';
import { DesglosePedidosTabla, filasDeGrupo } from './desglose';

const f = (nivel: DesglosePedidos['nivel'], surtido: DesglosePedidos['surtido'], clave: string, pedidos: number, extra: Partial<DesglosePedidos> = {}): DesglosePedidos => ({
  nivel, surtido, clave, pedidos, enviados: pedidos, piezas: pedidos * 10, facturado_cent: BigInt(pedidos) * 100000n, por_cobrar_cent: 5000n, utilidad_cent: 12345n, utilidad_provisional: false, con_avisos: 0, ...extra,
});
const DATOS: DesglosePedidos[] = [
  f('total', null, 'todos', 9),
  f('surtido', 'inventario_merida', 'inventario_merida', 3), f('surtido', 'dropshipping', 'dropshipping', 6),
  f('proveedor', 'inventario_merida', 'bodega_omar', 3),
  f('proveedor', 'dropshipping', 'karen', 4), f('proveedor', 'dropshipping', 'isaac', 2, { utilidad_cent: null }),
  f('tipo', 'dropshipping', 'cliente', 5, { utilidad_provisional: true }), f('tipo', 'dropshipping', 'socio_a_costo', 1),
];
const enlace = (c: Record<string, string>) => `/pedidos?${new URLSearchParams(Object.fromEntries(Object.entries(c).filter(([, v]) => v))).toString()}`;

describe('desglose de pedidos', () => {
  it('lista proveedores y tipos de venta solo cuando existen', () => {
    expect(filasDeGrupo(DATOS, 'dropshipping').map((r) => r.texto)).toEqual(['Karen', 'Isaac', 'Venta de cliente', 'A costo para socio']);
    expect(filasDeGrupo(DATOS, 'inventario_merida').map((r) => r.texto)).toEqual(['Bodega Omar']);
    expect(filasDeGrupo([], 'dropshipping')).toEqual([]);
  });
  it('muestra ambos grupos con filtros clicables, cifras ya formateadas y accesibles (roles ARIA, sin table)', () => {
    const html = renderToStaticMarkup(<DesglosePedidosTabla desglose={DATOS} surtido="" prov="" tipo="" enlace={enlace} />);
    for (const t of ['Bodega', 'Dropshipping', 'Karen', 'Isaac', 'Bodega Omar', 'A costo para socio', 'provisional', 'Sin dato']) expect(html).toContain(t);
    expect(html).toContain('href="/pedidos?surtido=dropshipping&amp;prov=karen"');
    expect(html).toContain('href="/pedidos?surtido=dropshipping&amp;tipo=socio_a_costo"');
    expect(html).not.toMatch(/<(table|tfoot|caption)/);
    expect(html).toContain('role="table"');
    expect(html).toContain('aria-label="Desglose de pedidos');
    expect(html).toContain('role="columnheader"');
    expect(html).toContain('role="rowheader"');
    expect(html).toContain('role="rowgroup"');
    expect(html.match(/role="row"/g)?.length).toBe(1 + 2 + 5);
    expect(html).toContain('data-testid="desglose-dropshipping"');
    expect(html).not.toContain('NaN');
  });
  it('con un grupo elegido muestra solo ese; el activo queda marcado y se apaga con otro clic', () => {
    const html = renderToStaticMarkup(<DesglosePedidosTabla desglose={DATOS} surtido="dropshipping" prov="karen" tipo="" enlace={enlace} />);
    expect(html).not.toContain('Bodega Omar');
    expect(html).toMatch(/href="\/pedidos\?surtido=dropshipping"[^>]*aria-current="true"|aria-current="true"[^>]*>Karen/);
    expect(html).toContain('href="/pedidos?surtido=dropshipping"');
  });
  it('sin datos de la base no revienta: dice Sin dato', () => {
    const html = renderToStaticMarkup(<DesglosePedidosTabla desglose={[]} surtido="" prov="" tipo="" enlace={enlace} />);
    expect(html).toContain('Sin dato');
  });
});

vi.mock('@/composicion/operacion', () => {
  const p = (id: number, origen: string, tipo: string | null, estado = 'enviado') => ({ id, folio: `P-${id}`, fecha_neg: '2026-11-10', cliente_id: id, cliente: `Cliente ${id}`, duenio: 'Javier', origen, estado, tipo_venta: tipo, piezas_pedidas: 10, piezas_surtidas: 10, cobrado_cent: 1000n, saldo_cent: 0n, utilidad_cent: 100n, utilidad_provisional: false, avisos: id === 3 ? 1 : 0 });
  return { operacionDeSocio: async () => ({ pedidos: async () => [p(1, 'bodega_omar', null), p(2, 'karen_directo', 'cliente'), p(3, 'isaac_directo', 'socio_a_costo'), p(4, 'karen_via_isaac', 'cliente')], pedidosDesglose: async () => DATOS_PAGINA }) };
});
vi.mock('@/composicion/acceso', () => ({ exigirSocio: async () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/ui/componentes/explicar', () => ({ useExplicar: () => ({ abrir: () => undefined }) }));
const DATOS_PAGINA = DATOS;

async function pagina(sp: Record<string, string>) {
  const { default: P } = await import('./page');
  return renderToStaticMarkup((await (P as unknown as (p: unknown) => Promise<React.ReactNode>)({ searchParams: Promise.resolve(sp) })) as React.ReactElement);
}
// Solo el libro: la mini lista de ultimos pedidos de la tarjeta Estados y surtido repite folios a proposito.
const folios = (html: string) => [...html.replace(/<ul class="rtm-a1-ultimos"[\s\S]*?<\/ul>/, '').matchAll(/href="\/pedidos\/\d+">(P-\d+)</g)].map((m) => m[1]);

describe('pagina de pedidos: Bodega / Dropshipping', () => {
  it('ya no trae el desplegable "Mas" ni chips de origen; trae el segmentado y el conmutador de avisos', async () => {
    const html = await pagina({});
    expect(html).not.toContain('filtros-plegables');
    expect(html).not.toContain('origen=');
    for (const id of ['surtido-todos', 'surtido-inventario', 'surtido-dropshipping', 'filtro-avisos', 'desglose-pedidos']) expect(html).toContain(`data-testid="${id}"`);
    expect(folios(html).sort()).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
    for (const t of ['Por estado', 'Surtido de piezas', 'Origen del pedido', 'Clientes con más facturado', 'Últimos pedidos']) expect(html).toContain(t);
  });
  it('filtra por grupo, proveedor y tipo desde la URL', async () => {
    expect(folios(await pagina({ surtido: 'inventario_merida' }))).toEqual(['P-1']);
    expect(folios(await pagina({ surtido: 'dropshipping' })).sort()).toEqual(['P-2', 'P-3', 'P-4']);
    expect(folios(await pagina({ surtido: 'dropshipping', prov: 'karen' })).sort()).toEqual(['P-2', 'P-4']);
    expect(folios(await pagina({ surtido: 'dropshipping', prov: 'isaac' }))).toEqual(['P-3']);
    expect(folios(await pagina({ surtido: 'dropshipping', tipo: 'socio_a_costo' }))).toEqual(['P-3']);
    expect(folios(await pagina({ aviso: '1' }))).toEqual(['P-3']);
  });
  it('ignora un proveedor que no pertenece al grupo y el parametro viejo origen', async () => {
    expect(folios(await pagina({ surtido: 'inventario_merida', prov: 'karen' }))).toEqual(['P-1']);
    expect(folios(await pagina({ origen: 'karen_directo' })).length).toBe(4);
  });
});
