// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { EnSubnav, RanuraSubnav } from './ranura-subnav';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });

describe('ranura de la subnavegacion', () => {
  it('los filtros de la pagina viajan a la ranura que el layout dejo junto a las pestanas', async () => {
    const m = abrir(montar(<><RanuraSubnav /><main><EnSubnav><input data-testid="filtro" /></EnSubnav></main></>));
    await act(async () => {});
    const ranura = m.cont.querySelector('.rtm-subnav-ranura')!;
    expect(ranura.querySelector('[data-testid="filtro"]')).not.toBeNull();
    expect(m.cont.querySelector('main [data-testid="filtro"]')).toBeNull();
  });
  it('sin ranura en el layout, los filtros quedan en la pagina (no se pierden)', async () => {
    const m = abrir(montar(<main><EnSubnav><input data-testid="filtro" /></EnSubnav></main>));
    await act(async () => {});
    expect(m.cont.querySelector('main [data-testid="filtro"]')).not.toBeNull();
  });
});
