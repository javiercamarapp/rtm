// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { BarraAcciones } from './barra-acciones';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

const barra = () => (
  <BarraAcciones
    vistas={[{ href: '/a', etiqueta: 'Angelo', titulo: 'Historial de Angelo' }, { href: '/b', etiqueta: 'Cascada', titulo: 'Cascada y actas' }]}
    primarias={<button type="button" className="rtm-boton rtm-boton-primario" title="Registrar depósito de un socio">Depósito</button>}
    secundarias={<><button type="button" className="rtm-boton rtm-boton-terciario" title="Registrar gasto pagado por un socio">Gasto</button><button type="button" className="rtm-boton rtm-boton-terciario" title="Registrar pago a un socio">Pago</button></>}
  />
);

describe('BarraAcciones', () => {
  it('es una sola fila: vistas, secundarias y primarias en un contenedor sin envoltura ni estilos en linea', () => {
    const m = abrir(montar(barra()));
    const ba = m.cont.querySelector('.rtm-ba')!;
    expect([...ba.children].map((c) => c.className)).toEqual(['rtm-ba-vistas', 'rtm-ba-sec', 'rtm-ba-primarias']);
    expect(m.cont.querySelector('[style]')).toBeNull();
  });
  it('las acciones secundarias estan visibles como botones, sin menu ni boton Mas', () => {
    const m = abrir(montar(barra()));
    const secundarias = [...m.cont.querySelectorAll<HTMLButtonElement>('.rtm-ba-sec button')];
    expect(secundarias.map((b) => b.textContent)).toEqual(['Gasto', 'Pago']);
    expect(secundarias.every((b) => b.classList.contains('rtm-boton-terciario') && Boolean(b.title))).toBe(true);
    expect(m.cont.querySelector('[data-testid="barra-mas"], [aria-haspopup], [aria-expanded], .rtm-ba-panel')).toBeNull();
    expect(m.cont.textContent).not.toMatch(/\bM[aá]s\b/);
  });
  it('las vistas son enlaces con su descripcion larga en title y aria-label', () => {
    const m = abrir(montar(barra()));
    const enlaces = [...m.cont.querySelectorAll<HTMLAnchorElement>('.rtm-ba-vistas a')];
    expect(enlaces.map((a) => a.getAttribute('aria-label'))).toEqual(['Historial de Angelo', 'Cascada y actas']);
  });
  it('sin secundarias ni vistas solo queda la fila de primarias', () => {
    const m = abrir(montar(<BarraAcciones primarias={<button type="button" className="rtm-boton">Exportar</button>} />));
    expect(m.cont.querySelectorAll('.rtm-ba > *').length).toBe(1);
  });
  it('sin violaciones de axe', async () => {
    const m = abrir(montar(barra(), 'reduced'));
    expect(await auditar(m.cont)).toEqual([]);
  });
});
