import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composicion, repartir } from './composicion';

const seg = (id: string, valor: number | null) => ({ id, etiqueta: id, valor, texto: String(valor) });

describe('Composicion', () => {
  it('reparte porcentajes que suman 100 y omite lo que no aporta', () => {
    const r = repartir([seg('a', 30), seg('b', 70), seg('c', 0), seg('d', null)])!;
    expect(r.map((p) => p.seg.id)).toEqual(['a', 'b']);
    expect(r.reduce((a, p) => a + p.pct, 0)).toBeCloseTo(100);
    expect(r[1]!.x).toBeCloseTo(30);
  });
  it('sin aporte alguno dice Sin dato en vez de inventar una barra', () => {
    expect(repartir([seg('a', 0), seg('b', null)])).toBeNull();
    const html = renderToStaticMarkup(<Composicion etiquetaAria="x" grupos={[{ id: 'g', titulo: 'Grupo', segmentos: [seg('a', null)] }]} />);
    expect(html).toContain('Sin dato');
    expect(html).not.toContain('rtm-comp-seg');
  });
});
