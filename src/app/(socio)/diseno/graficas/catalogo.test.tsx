// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import CatalogoGraficas, { metadata } from './page';

import { auditar, cuadrosManuales, fijarModo, montar, sinAtributoDeModo, type Montaje } from '@/ui/graficas/pruebas/ayudas';

const montajes: Montaje[] = [];
afterEach(() => {
  while (montajes.length) montajes.pop()!.desmontar();
  fijarModo(null);
  vi.unstubAllGlobals();
});

describe('catalogo /diseno/graficas', () => {
  it('muestra los 12 tipos, las tarjetas de insight y los tres estados', () => {
    const m = montar(<CatalogoGraficas />, 'reduced');
    montajes.push(m);
    const formas = [...m.cont.querySelectorAll('figure[data-grafica]')].map((f) => f.getAttribute('data-grafica'));
    for (const f of ['barras', 'linea', 'cascada', 'pareto', 'calor', 'burbujas', 'treemap', 'radar', 'bump', 'apilada', 'cobertura']) expect(formas).toContain(f);
    expect(m.cont.querySelectorAll('article.rtm-g-insight')).toHaveLength(3);
    expect(m.cont.querySelectorAll('.rtm-g-spark')).toHaveLength(1);
    expect(m.cont.querySelector('figure[data-estado="cargando"]')).not.toBeNull();
    expect(m.cont.textContent).toContain('Pocos datos para hablar de esto');
    expect(m.cont.querySelector('[role="alert"]')).not.toBeNull();
    for (const p of ['Observado', 'Estimado', 'Inferido']) expect(m.cont.textContent).toContain(p);
    expect(m.cont.querySelectorAll('figure details.rtm-grafica-tabla').length).toBeGreaterThanOrEqual(11);
    expect(metadata.title).toBe('Gráficas');
  });
  it('no contiene datos reales: solo etiquetas genericas y el aviso de datos ilustrativos', () => {
    const m = montar(<CatalogoGraficas />, 'reduced');
    montajes.push(m);
    expect(m.cont.textContent).toContain('Datos ilustrativos');
    expect(m.cont.textContent).not.toMatch(/Karen|Vapemate|Angelo|Omar/);
  });
  it('axe sin violaciones en toda la pagina', async () => {
    const m = montar(<CatalogoGraficas />, 'reduced');
    montajes.push(m);
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('con movimiento reducido la pagina completa no tiene nada animado y es igual a la de modo completo salvo el atributo', () => {
    const cuadros = cuadrosManuales();
    const a = montar(<CatalogoGraficas />, 'full');
    cuadros.avanzar(0);
    cuadros.avanzar(5000);
    const completa = sinAtributoDeModo(a.html()).replace(/ rtm-entra rtm-i-\d/g, '');
    a.desmontar();
    const b = montar(<CatalogoGraficas />, 'reduced');
    montajes.push(b);
    expect(b.cont.querySelector('[data-anim="on"]')).toBeNull();
    expect(sinAtributoDeModo(b.html()).replace(/ rtm-entra rtm-i-\d/g, '')).toBe(completa);
  });
});
