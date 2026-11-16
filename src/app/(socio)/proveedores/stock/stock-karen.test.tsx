// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { porTestid } from '@/ui/graficas/pruebas/formularios';
import type { ModeloTablero } from '@/dominio/proveedores/tablero';
import { StockKaren, type PropsStockKaren } from './stock-karen';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const montajes: Montaje[] = [];
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });

// Datos ficticios.
const sab = (n: string, d: boolean) => ({ variante_id: `v-${n}`, sabor: n, disponible: d, inestable: false, sabor_canonico_id: '1', ventas_60d: 0, existencia_propia: 0, cambio_en: '2026-11-14T10:00:00Z', cambio_tipo: d ? 'sabor_regreso' : 'sabor_agotado' });
const M = (id: string, o: Partial<ModeloTablero> = {}): ModeloTablero => ({
  producto_id: id, handle: `modelo-${id}`, marca: id === '1' ? 'Marca A' : 'Marca B', titulo: id === '1' ? 'Alfa 8000' : 'Beta', puffs: 8000, estado: 'activo', primera_vez: id === '2' ? '2026-11-14T09:00:00Z' : '2026-11-13T00:00:00Z', nuevo_semana: id === '2', mapeo: 'confirmado',
  canonico_id: id === '1' ? '1' : null, canonico_nombre: id === '1' ? 'Alfa' : null, sin_sabores: false, nuevo_sin_costo: false, ventas_60d: 0, ventas_30d: 0, vendemos: false, existencia_propia: id === '1' ? 3 : 0, cobertura_dias: null,
  sabores: id === '1' ? [sab('Sandía', true), sab('Mango', false)] : [sab('Uva', false)], eventos: [], ...o,
});
const props = (o: Partial<PropsStockKaren> = {}): PropsStockKaren => ({
  modelos: [M('1'), M('2')], eventos: [{ clave: 'g1', tipo: 'modelo_nuevo', en: '2026-11-14T10:00:00Z', antes: null, despues: null, modelo: 'Beta' }],
  ultimaLecturaOk: '2026-11-14T11:30:00Z', desactualizado: false, lecturaActiva: true, ahoraIso: '2026-11-14T12:00:00Z', busqueda: {}, ...o,
});
const render = (p: PropsStockKaren) => { const m = montar(<StockKaren {...p} />); montajes.push(m); return m; };

describe('StockKaren con el catalogo de Isaac', () => {
  it('usa el mismo formato y nombra a Isaac, con sabores disponibles y agotados', () => {
    const m = render(props({ proveedor: 'Isaac', eventos: [], ultimaLecturaOk: null }));
    const t = m.cont.textContent ?? '';
    expect(t).toContain('ALFA 8000');
    expect(t).toContain('SANDÍA');
    expect(porTestid(m.cont, 'kpis-stock')?.getAttribute('aria-label')).toBe('Resumen del stock de Isaac');
  });
  it('sin modelos dice que no hay catalogo de Isaac', () => {
    expect(render(props({ proveedor: 'Isaac', modelos: [], eventos: [] })).cont.textContent).toContain('Todavía no hay catálogo de Isaac');
  });
});

describe('StockKaren', () => {
  it('agrupa por marca en MAYUSCULAS, muestra bodega, grafica y linea de tiempo, sin violaciones de axe', async () => {
    const m = render(props());
    const t = m.cont.textContent ?? '';
    expect(t).toContain('MARCA A');
    expect(t).toContain('ALFA 8000');
    expect(t).toContain('SANDÍA');
    expect(t).toContain('Lo tienes en bodega: 3 pz');
    expect(t).toContain('Sin ligar a tu catálogo');
    expect(porTestid(m.cont, 'grafica-marcas')).toBeTruthy();
    expect(porTestid(m.cont, 'linea-tiempo-stock')?.textContent).toContain('Modelo nuevo');
    expect(m.cont.querySelector('[data-testid="inv-1"]')?.getAttribute('href')).toBe('/inventario?q=Alfa');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('filtra por marca, disponibilidad y nuevos desde la URL', () => {
    expect(render(props({ busqueda: { marca: 'Marca B' } })).cont.textContent).not.toContain('ALFA 8000');
    expect(render(props({ busqueda: { disp: 'agotados' } })).cont.querySelectorAll('[data-testid^="stock-"]').length).toBe(1);
    expect(render(props({ busqueda: { nuevos: '1' } })).cont.querySelectorAll('[data-testid^="stock-"]').length).toBe(1);
    expect(render(props({ busqueda: { q: 'zzz' } })).cont.querySelector('[data-testid="vacio-sin-resultados-stock"]')).toBeTruthy();
  });
  it('la linea base (primera lectura) no cuenta como nuevo ni aparece en cambios', () => {
    const base = (id: string) => M(id, { primera_vez: '2026-11-13T00:00:00Z', nuevo_semana: true });
    const m = render(props({ modelos: [base('1'), base('2')], eventos: [{ clave: 'g0', tipo: 'modelo_nuevo', en: '2026-11-13T00:00:00Z', antes: null, despues: null, modelo: 'Beta' }] }));
    const kpi = [...m.cont.querySelectorAll('.rtm-st-kpi')].find((x) => x.textContent?.startsWith('Nuevos esta semana'));
    expect(kpi?.querySelector('b')?.textContent).toBe('0');
    expect(porTestid(m.cont, 'linea-base-stock')?.textContent).toContain('Línea base cargada el');
    expect(m.cont.querySelector('[data-testid="linea-tiempo-stock"]')).toBeNull();
    expect(m.cont.textContent).toContain('Sin cambios todavía');
    expect(m.cont.querySelector('.rtm-kr-insignia')).toBeNull();
  });
  it('sin lecturas muestra el estado vacio; sin dato donde falta', () => {
    expect(render(props({ modelos: [] })).cont.querySelector('[data-testid="vacio-karen"]')).toBeTruthy();
    expect(render(props({ ultimaLecturaOk: null })).cont.textContent).toContain('Visto por última vez Sin dato');
    expect(render(props({ modelos: [M('1', { sabores: [], sin_sabores: true })] })).cont.textContent).toContain('Sin dato');
  });
});
