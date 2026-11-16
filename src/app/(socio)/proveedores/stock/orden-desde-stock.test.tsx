// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, escribir, porTestid } from '@/ui/graficas/pruebas/formularios';
import type { ModeloOrden } from '@/dominio/proveedores/orden';
import { OrdenDesdeStock } from './orden-desde-stock';

const push = vi.fn();
const refresh = vi.fn();
const ejecutar = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('../../operacion/acciones', () => ({ ejecutar: (a: string, args: Record<string, unknown>) => ejecutar(a, args) }));

const MODELOS: ModeloOrden[] = [
  { clave: 'nexa ultra 50k', marca: 'NEXA', modelo: 'NEXA ULTRA 50K', disponibles: 2, sabores: [
    { skuId: 1, sabor: 'Mango Oasis', disponible: true, costoCent: 9000n }, { skuId: 2, sabor: 'Blue Razz Ice', disponible: true, costoCent: 9000n },
    { skuId: 3, sabor: 'Triple Berry', disponible: false, costoCent: 9000n }, { skuId: 4, sabor: 'Sin Costo', disponible: true, costoCent: null }] },
];
const montajes: Montaje[] = [];
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); push.mockClear(); ejecutar.mockReset(); });
const abrir = async () => { const m = montar(<OrdenDesdeStock proveedor="Karen" modelos={MODELOS} conLectura />, 'off'); montajes.push(m); await clic(m.cont.querySelector('.rtm-os-cabecera')); return m; };

describe('OrdenDesdeStock', () => {
  it('por omision solo muestra lo disponible; sin cantidades no se puede generar', async () => {
    const m = await abrir();
    expect(m.cont.querySelector('[data-testid="os-cant-1"]')).not.toBeNull();
    expect(m.cont.querySelector('[data-testid="os-cant-3"]')).toBeNull(); // agotado oculto
    expect((porTestid(m.cont, 'os-generar') as HTMLButtonElement).disabled).toBe(true);
  });
  it('el sabor sin costo vigente no admite cantidad', async () => {
    const m = await abrir();
    expect((porTestid(m.cont, 'os-cant-4') as HTMLInputElement).disabled).toBe(true);
  });
  it('suma piezas y genera la orden con sku y cantidad (sin dinero)', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: { compra_id: 7 } });
    vi.stubGlobal('open', vi.fn());
    const m = await abrir();
    escribir(porTestid(m.cont, 'os-cant-1'), '40');
    escribir(porTestid(m.cont, 'os-cant-2'), '25');
    expect(porTestid(m.cont, 'os-piezas')?.textContent).toContain('65');
    await clic(porTestid(m.cont, 'os-generar'));
    expect(ejecutar).toHaveBeenCalledTimes(1);
    const [accion, args] = ejecutar.mock.calls[0]!;
    expect(accion).toBe('crear_compra');
    expect(args).toMatchObject({ p_proveedor: 'Karen', p_guia_cent: 0, p_seguro_cent: 0, p_lineas: [{ sku_id: 1, pagadas: 40 }, { sku_id: 2, pagadas: 25 }] });
    expect(push).toHaveBeenCalledWith('/proveedores/compras/7');
  });
});
