import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Decision del dueno (11-nov-2026): RTM es un solo negocio. Las pantallas ignoran ?duenio= y no muestran chips ni columnas de dueno.
const clientes = [
  { id: 1, nombre: 'Cliente Alfa', duenio: 'Angelo', tipo: 'mayoreo', activo: true, precios: 3, esBodega: false, alias: [] },
  { id: 2, nombre: 'Cliente Beta', duenio: 'Javier', tipo: 'mayoreo', activo: true, precios: 2, esBodega: false, alias: [] },
];
const pedido = (id: number, cliente: string, duenio: 'Angelo' | 'Javier') => ({
  id, folio: `P-${id}`, fecha_neg: '2026-11-10', cliente_id: id, cliente, duenio, origen: 'chat', estado: 'borrador',
  piezas_pedidas: 10, piezas_surtidas: 0, cobrado_cent: 0n, saldo_cent: null, utilidad_cent: null, utilidad_provisional: false, avisos: 0,
});
const fila = (id: number, cliente: string, duenio: 'Angelo' | 'Javier') => ({
  pedido_id: id, folio: `P-${id}`, cliente_id: id, cliente, duenio, fecha_envio: '2026-11-01', plazo_dias: 7, vence: '2026-11-08',
  original_cent: 100n, abonos_cent: 0n, saldo_cent: 100n, dias_atraso: 2, estado: 'vencido', recargo_sugerido_cent: 0n,
});

vi.mock('@/composicion/catalogo', () => ({ lectorDeSocio: async () => ({ clientes: async () => clientes }) }));
vi.mock('@/composicion/operacion', () => ({
  operacionDeSocio: async () => ({
    pedidos: async () => [pedido(1, 'Cliente Alfa', 'Angelo'), pedido(2, 'Cliente Beta', 'Javier')],
    contextoPagos: async () => ({ cuentas: [], clientes: [] }),
    cuentasPorCobrar: async () => ({
      hoy: '2026-11-10', filas: [fila(1, 'Cliente Alfa', 'Angelo'), fila(2, 'Cliente Beta', 'Javier')], total_cent: 200n, vencido_cent: 200n,
      antiguedad_cent: { '0_7': 200n, '8_14': 0n, '15_30': 0n, mas_30: 0n }, saldos_a_favor: [{ cliente_id: 1, cliente: 'Cliente Alfa', duenio: 'Angelo', monto_cent: 5n }],
      pagos_sin_identificar: [], socios: [], recargo_bp: 0, por_cliente: [{ cliente_id: 1, cliente: 'Cliente Alfa', duenio: 'Angelo', saldo_cent: 100n, vencido_cent: 100n, pedidos: 1, dias_max: 2, proximo_vence: null }],
    }),
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined }), notFound: () => { throw new Error('notFound'); } }));
vi.mock('@/ui/componentes/explicar', () => ({ useExplicar: () => ({ abrir: () => undefined }) }));
vi.mock('@/composicion/acceso', () => ({ exigirSocio: async () => undefined }));

const PROHIBIDO = [/Dueño/, /De Angelo/, /De Javier/, /de Angelo/, /de Javier/, /duenio/];

async function pagina(cargar: () => Promise<{ default: (p: never) => Promise<React.ReactNode> | React.ReactNode }>, sp: Record<string, string>) {
  const { default: P } = await cargar();
  return renderToStaticMarkup((await (P as (p: unknown) => Promise<React.ReactNode>)({ searchParams: Promise.resolve(sp) })) as React.ReactElement);
}

describe('sin division por dueno: la URL con ?duenio= se ignora', () => {
  for (const duenio of ['Angelo', 'Javier', 'cualquier-cosa']) {
    it(`clientes?duenio=${duenio} muestra a todos y sin chips ni columna de dueno`, async () => {
      const html = await pagina(() => import('@/app/(socio)/clientes/page'), { duenio });
      expect(html).toContain('Cliente Alfa');
      expect(html).toContain('Cliente Beta');
      for (const r of PROHIBIDO) expect(html).not.toMatch(r);
    });
    it(`pedidos?duenio=${duenio} muestra todos los pedidos`, async () => {
      const html = await pagina(() => import('@/app/(socio)/pedidos/page'), { duenio });
      expect(html).toContain('Cliente Alfa');
      expect(html).toContain('Cliente Beta');
      for (const r of PROHIBIDO) expect(html).not.toMatch(r);
    });
    it(`cuentas-por-cobrar?duenio=${duenio} muestra todas las filas y no genera enlaces con duenio`, async () => {
      const html = await pagina(() => import('@/app/(socio)/cuentas-por-cobrar/page'), { duenio });
      expect(html).toContain('Cliente Alfa');
      expect(html).toContain('Cliente Beta');
      for (const r of PROHIBIDO) expect(html).not.toMatch(r);
    });
  }
});
