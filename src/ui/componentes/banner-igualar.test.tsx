// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { auditar, montar, type Montaje } from '../graficas/pruebas/ayudas';
import { ExplicarProvider } from './explicar';
import { BannerIgualar } from './banner-igualar';
import type { BannerIgualacion } from '@/dominio/socios/banner-igualar';

const montajes: Montaje[] = [];
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });
const explicar = () => Promise.reject(new Error('no se usa'));
const vacio = { dias_fondos: null, desde: null, entregado_cent: 0n, entrega_total_cent: 0n, progreso_bp: null, entregas: [] };
const banner = (over: Partial<BannerIgualacion> = {}): BannerIgualacion => ({
  activo: true, igualados: false, exacto: false, tolerancia_cent: 1n, faltan_cent: 4792191n, mayor: 'Javier', menor: 'Angelo', neteo_cent: 0n, cuadra: true, regla: '',
  por_socio: { Angelo: { ...vacio, entregar_cent: 3547500n, aportar_cent: 1244691n, dias_fondos: 4, desde: '2026-11-10', entregado_cent: 1000000n, entrega_total_cent: 3547500n, progreso_bp: 2819, entregas: [{ fecha: '2026-11-12', monto_cent: 1000000n }] }, Javier: { ...vacio, entregar_cent: 0n, aportar_cent: 0n } },
  ...over,
});
const m = (b: BannerIgualacion | null, yo: 'Angelo' | 'Javier' | null) => { const x = montar(<ExplicarProvider explicar={explicar}><BannerIgualar banner={b} yo={yo} /></ExplicarProvider>); montajes.push(x); return x.cont; };

describe('BannerIgualar', () => {
  it('socio por debajo: role alert, rotulo textual, dos partidas con enlaces y progreso accesible', async () => {
    const cont = m(banner(), 'Angelo');
    const s = cont.querySelector('[data-testid="banner-igualar"]')!;
    expect(s.getAttribute('role')).toBe('alert');
    expect(s.getAttribute('aria-labelledby')).toBe('bi-titulo');
    expect(cont.querySelector('[data-testid="banner-rotulo"]')!.textContent).toBe('Acción requerida');
    expect(cont.querySelector('[data-testid="banner-titulo"]')!.textContent).toBe('Debes reponer $47,921.91 para igualar valuación');
    expect(cont.querySelector('[data-testid="banner-entregar"]')!.textContent).toContain('$35,475.00');
    expect(cont.querySelector('[data-testid="banner-aportar"]')!.textContent).toContain('$12,446.91');
    expect(cont.querySelector('[data-testid="banner-ir-entregar"]')!.getAttribute('href')).toBe('/cuentas-por-cobrar?vista=socios');
    expect(cont.querySelector('[data-testid="banner-ir-aportar"]')!.getAttribute('href')).toBe('/socios');
    const barra = cont.querySelector('[role="progressbar"]')!;
    expect(barra.getAttribute('aria-valuenow')).toBe('28.19');
    expect(cont.querySelector('[data-testid="banner-antiguedad"]')!.textContent).toContain('desde hace 4 días');
    expect(cont.querySelector('[data-testid="banner-explica"]')!.textContent).toContain('no es aportación de capital');
    expect(await auditar(cont)).toEqual([]);
  });
  it('el otro socio: role status, informativo y sin botones de accion', async () => {
    const cont = m(banner(), 'Javier');
    expect(cont.querySelector('[data-testid="banner-igualar"]')!.getAttribute('role')).toBe('status');
    expect(cont.querySelector('[data-testid="banner-rotulo"]')!.textContent).toBe('Para tu información');
    expect(cont.querySelector('[data-testid="banner-titulo"]')!.textContent).toContain('Angelo debe reponer $47,921.91');
    expect(cont.querySelector('[data-testid^="banner-ir-"]')).toBeNull();
    expect(await auditar(cont)).toEqual([]);
  });
  it('igualados o sin banner: no pinta nada', () => {
    expect(m(banner({ activo: false, igualados: true, faltan_cent: 1n }), 'Angelo').querySelector('[data-testid="banner-igualar"]')).toBeNull();
    expect(m(null, 'Angelo').querySelector('[data-testid="banner-igualar"]')).toBeNull();
  });
});
