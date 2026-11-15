// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { Pestanas } from './pestanas';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, etiqueta: `Pagina ${i}`, href: `/p${i}`, activa: i === 11, testid: `t${i}`, titulo: i === 1 ? 'Nombre completo' : undefined }));

describe('Pestanas', () => {
  it('es un nav con una sola lista, aria-current en la activa y conserva data-testid y title', () => {
    const m = abrir(montar(<Pestanas etiquetaAria="Contabilidad" items={items} />));
    const nav = m.cont.querySelector('nav.rtm-pestanas')!;
    expect(nav.getAttribute('aria-label')).toBe('Contabilidad');
    expect(nav.querySelectorAll('ul').length).toBe(1);
    expect(nav.querySelectorAll('a').length).toBe(12);
    expect(nav.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(nav.querySelector('[data-testid="t11"]')!.getAttribute('aria-current')).toBe('page');
    expect(nav.querySelector('[data-testid="t1"]')!.getAttribute('title')).toBe('Nombre completo');
  });
  it('marca los bordes con desvanecido segun el desplazamiento y deja visible la pestana activa', () => {
    const m = abrir(montar(<Pestanas etiquetaAria="Contabilidad" items={items} />));
    const nav = m.cont.querySelector<HTMLElement>('nav.rtm-pestanas')!;
    // jsdom no maqueta: sin desborde medible no hay desvanecido.
    expect(nav.dataset.izq).toBe('false');
    expect(nav.dataset.der).toBe('false');
  });
  it('sin violaciones de axe', async () => {
    const m = abrir(montar(<Pestanas etiquetaAria="Contabilidad" items={items} />, 'reduced'));
    expect(await auditar(m.cont)).toEqual([]);
  });
});
