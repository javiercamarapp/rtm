// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditar, montar, type Montaje } from '../graficas/pruebas/ayudas';
import { escribir } from '../graficas/pruebas/formularios';
import { Campo, Casilla, EcoResultado } from './campo';

const montajes: Montaje[] = [];
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });
const m = (el: React.ReactElement) => { const x = montar(el); montajes.push(x); return x; };

describe('Campo', () => {
  it('asocia la etiqueta al control y marca requerido', () => {
    const { cont } = m(<Campo etiqueta="Nombre" requerido valor="" onCambio={() => undefined} />);
    const input = cont.querySelector('input')!;
    expect(cont.querySelector('label')!.getAttribute('for')).toBe(input.id);
    expect(cont.querySelector('label')!.textContent).toBe('Nombre *');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
  it('con error: aria-invalid, mensaje anunciado y descrito por el control', () => {
    const { cont } = m(<Campo etiqueta="Precio" valor="x" onCambio={() => undefined} error="Precio no válido." ayuda="Pesos" />);
    const input = cont.querySelector('input')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const error = cont.querySelector('[role="alert"]')!;
    expect(error.textContent).toBe('Precio no válido.');
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(error.id);
  });
  it('llama a onCambio al escribir; el monto usa teclado decimal y la clase numerica', () => {
    const onCambio = vi.fn();
    const { cont } = m(<Campo etiqueta="Monto" control="monto" valor="" onCambio={onCambio} />);
    const input = cont.querySelector('input')!;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.className).toContain('rtm-campo-num');
    escribir(input, '150.5');
    expect(onCambio).toHaveBeenCalledWith('150.5');
  });
  it('selector, area y fecha', () => {
    const { cont } = m(<><Campo etiqueta="Tipo" control="seleccion" opciones={[{ valor: 'a', texto: 'A' }, { valor: 'b', texto: 'B' }]} valor="b" onCambio={() => undefined} /><Campo etiqueta="Nota" control="area" valor="" onCambio={() => undefined} /><Campo etiqueta="Desde" control="fecha" valor="2026-11-11" onCambio={() => undefined} /></>);
    expect(cont.querySelector('select')!.value).toBe('b');
    expect(cont.querySelector('textarea')).not.toBeNull();
    expect(cont.querySelector('input')!.getAttribute('type')).toBe('date');
  });
  it('deshabilitado se propaga', () => {
    const { cont } = m(<Campo etiqueta="X" disabled valor="" onCambio={() => undefined} />);
    expect(cont.querySelector('input')!.disabled).toBe(true);
  });
  it('sin violaciones de accesibilidad (axe)', async () => {
    const { cont } = m(<><Campo etiqueta="Nombre" requerido valor="" onCambio={() => undefined} error="Falta." /><Casilla etiqueta="Activo" marcada onCambio={() => undefined} ayuda="Ayuda" /></>);
    expect(await auditar(cont)).toEqual([]);
  });
});

describe('Casilla y EcoResultado', () => {
  it('la casilla notifica el cambio', () => {
    const onCambio = vi.fn();
    const { cont } = m(<Casilla etiqueta="Activo" marcada={false} onCambio={onCambio} />);
    cont.querySelector('input')!.click();
    expect(onCambio).toHaveBeenCalledWith(true);
  });
  it('el eco de error es una alerta y el de exito un estado', () => {
    const e = m(<EcoResultado tono="error">Falló</EcoResultado>);
    expect(e.cont.querySelector('[role="alert"]')).not.toBeNull();
    const o = m(<EcoResultado tono="ok">Guardado</EcoResultado>);
    expect(o.cont.querySelector('[role="status"]')!.textContent).toBe('Guardado');
  });
});
