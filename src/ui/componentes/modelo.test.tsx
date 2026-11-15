// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { ModeloMiniatura, ModeloTarjeta, nombreCompletoModelo } from './modelo';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); fijarModo(null); });

describe('ModeloMiniatura y ModeloTarjeta', () => {
  it('con foto: imagen con alt, carga diferida y proporcion fija', () => {
    const m = abrir(montar(<ModeloMiniatura modelo="Geek Bar Somax 80K" marca="Geek Bar" tam="m" />));
    const img = m.cont.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/modelos/geek-bar-somax-80k.webp');
    expect(img.getAttribute('alt')).toBe('Foto de Geek Bar Somax 80K');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(m.cont.querySelector('[style]')).toBeNull();
  });
  it('sin foto: estado vacio con monograma y etiqueta accesible', () => {
    const m = abrir(montar(<ModeloMiniatura modelo="Waka Modelo Nuevo 99K" marca="Waka" tam="m" />));
    expect(m.cont.querySelector('img')).toBeNull();
    const v = m.cont.querySelector('[data-vacia]')!;
    expect(v.getAttribute('aria-label')).toBe('Sin foto de Waka Modelo Nuevo 99K');
    expect(v.textContent).toContain('WA');
  });
  it('el nombre no repite la marca', () => {
    expect(nombreCompletoModelo('Blade', 'Sin marca')).toBe('Blade');
    expect(nombreCompletoModelo('Slim', 'Waka')).toBe('Waka Slim');
    expect(nombreCompletoModelo('Waka Slim', 'Waka')).toBe('Waka Slim');
  });
  it('sin violaciones de axe, con y sin foto', async () => {
    const m = abrir(montar(<div><ModeloTarjeta modelo="Lost Mary Ultrasonic" marca="Lost Mary" detalle="120 piezas" /><ModeloTarjeta modelo="Waka Slim 12K" marca="Waka" tam="m" /><ModeloTarjeta modelo="Blade" marca="Sin marca" tam="xs" /></div>, 'reduced'));
    expect(await auditar(m.cont)).toEqual([]);
  });
});
