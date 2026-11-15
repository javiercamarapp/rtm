// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditar, montar, teclear, type Montaje } from '../graficas/pruebas/ayudas';
import { clic, escribir, simularDialogo } from '../graficas/pruebas/formularios';
import { CampoMonto, PanelEfecto, Segmentado, TarjetasOpcion, formatearMontoTexto } from './campos-dialogo';
import { ConfirmDialog } from './confirm-dialog';
import { esDestructivo, iconoDeDialogo } from './dialogo-enterprise';

const montajes: Montaje[] = [];
beforeAll(() => { simularDialogo(); });
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); });
const m = (el: React.ReactElement, modo: 'full' | 'reduced' | 'off' = 'off') => { const x = montar(el, modo); montajes.push(x); return x; };
const noop = () => undefined;

describe('DialogoEnterprise (base)', () => {
  it('es un dialogo modal con nombre, descripcion, cerrar y pie con data-testid confirmar', () => {
    const { cont } = m(<ConfirmDialog abierto titulo="Dinero que un socio deposita" subtitulo="Una linea" confirmar="Registrar" onConfirmar={noop} onCancelar={noop}><label>Monto<input /></label></ConfirmDialog>);
    const d = cont.querySelector('dialog')!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Dinero que un socio deposita');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe('Una linea');
    expect(cont.querySelector('[aria-label="Cerrar"]')).not.toBeNull();
    expect(cont.querySelector('[data-testid="confirmar"]')!.textContent).toBe('Registrar');
  });
  it('enfoca el primer campo; con peligro o sin campos enfoca Cancelar', () => {
    const a = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={noop} onCancelar={noop}><input data-testid="uno" /></ConfirmDialog>);
    expect(document.activeElement).toBe(a.cont.querySelector('[data-testid="uno"]'));
    a.desmontar(); montajes.pop();
    const b = m(<ConfirmDialog abierto titulo="Anular pago" confirmar="Anular pago" onConfirmar={noop} onCancelar={noop}><p>Se anula.</p></ConfirmDialog>);
    expect(document.activeElement!.textContent).toBe('Cancelar');
    expect(b.cont.querySelector('dialog')!.hasAttribute('data-compacta')).toBe(true);
    expect(b.cont.querySelector('dialog')!.getAttribute('data-tono')).toBe('peligro');
    expect(b.cont.querySelector('[data-testid="confirmar"]')!.className).toContain('rtm-boton-peligro');
  });
  it('Escape cierra sin cambios; con cambios pide descartar y Escape vuelve a editar', () => {
    const cerrar = vi.fn();
    const { cont } = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={noop} onCancelar={cerrar}><input data-testid="uno" /></ConfirmDialog>);
    const d = cont.querySelector('dialog')!;
    const esc = () => act(() => { d.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })); });
    esc();
    expect(cerrar).toHaveBeenCalledTimes(1);
    escribir(cont.querySelector('[data-testid="uno"]'), 'x');
    esc();
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(cont.textContent).toContain('¿Descartar lo que escribiste?');
    esc();
    expect(cont.textContent).not.toContain('¿Descartar');
  });
  it('descartar confirma el cierre', async () => {
    const cerrar = vi.fn();
    const { cont } = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={noop} onCancelar={cerrar}><input data-testid="uno" /></ConfirmDialog>);
    escribir(cont.querySelector('[data-testid="uno"]'), 'x');
    await clic(cont.querySelector('[aria-label="Cerrar"]'));
    await clic(cont.querySelector('[data-testid="descartar"]'));
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it('clic en el fondo cierra; clic dentro no', async () => {
    const cerrar = vi.fn();
    const { cont } = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={noop} onCancelar={cerrar}><p>Hola</p></ConfirmDialog>);
    const d = cont.querySelector('dialog')!;
    await clic(cont.querySelector('.rtm-hoja-titulo'));
    expect(cerrar).not.toHaveBeenCalled();
    act(() => { d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await clic(d);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it('Tab desde el ultimo control vuelve al primero (trampa de foco)', () => {
    const { cont } = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={noop} onCancelar={noop}><input /></ConfirmDialog>);
    (cont.querySelector('[data-testid="confirmar"]') as HTMLElement).focus();
    teclear(cont.querySelector('[data-testid="confirmar"]')!, 'Tab');
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Cerrar');
  });
  it('Enter en un campo confirma; ocupado bloquea y muestra Guardando; error y exito visibles', () => {
    const ok = vi.fn();
    const a = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={ok} onCancelar={noop} error="La base dijo no."><input data-testid="uno" /></ConfirmDialog>);
    expect(a.cont.querySelector('[role="alert"]')!.textContent).toBe('La base dijo no.');
    teclear(a.cont.querySelector('[data-testid="uno"]')!, 'Enter');
    expect(ok).toHaveBeenCalledTimes(1);
    a.desmontar(); montajes.pop();
    const b = m(<ConfirmDialog abierto titulo="Registrar" confirmar="Ok" onConfirmar={ok} onCancelar={noop} ocupado exito><input /></ConfirmDialog>);
    expect(b.cont.querySelector<HTMLButtonElement>('[data-testid="confirmar"]')!.disabled).toBe(true);
    expect(b.cont.querySelector('[role="status"]')!.textContent).toBe('Listo');
  });
  it('sin violaciones de accesibilidad (axe)', async () => {
    const { cont } = m(<ConfirmDialog abierto titulo="Dinero que un socio deposita" subtitulo="Una linea" confirmar="Registrar" onConfirmar={noop} onCancelar={noop} efecto={<PanelEfecto filas={[{ id: 'a', etiqueta: 'Valuación de Angelo', valor: '$1.00', barra: 40 }]} textos={['Texto']} />}><label>Monto<input className="rtm-campo" /></label></ConfirmDialog>);
    expect(await auditar(cont)).toEqual([]);
  });
  it('infiere destructivo e icono', () => {
    expect(esDestructivo('Anular pago')).toBe(true);
    expect(esDestructivo('Cancelar pedido')).toBe(true);
    expect(esDestructivo('Registrar pago')).toBe(false);
    expect(iconoDeDialogo('Pago de renta')).not.toBeNull();
  });
});

describe('campos del dialogo', () => {
  it('formatea miles solo como formato', () => {
    expect(formatearMontoTexto('9000')).toBe('9,000');
    expect(formatearMontoTexto('1234567.891')).toBe('1,234,567.89');
    expect(formatearMontoTexto('$ 1,234.5')).toBe('1,234.5');
    expect(formatearMontoTexto('.5')).toBe('0.5');
    expect(formatearMontoTexto('')).toBe('');
  });
  it('el monto muestra prefijo $ y formatea al escribir', () => {
    let v = '';
    const { cont } = m(<><label htmlFor="mm">Monto</label><CampoMonto id="mm" valor={v} onCambio={(x) => { v = x; }} /></>);
    expect(cont.querySelector('.rtm-hoja-prefijo')!.textContent).toBe('$');
    escribir(cont.querySelector('input'), '12000');
    expect(v).toBe('12,000');
  });
  it('segmentado y tarjetas son radios nativos con grupo nombrado y sin violaciones axe', async () => {
    const cambio = vi.fn();
    const ops = [{ valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }];
    const { cont } = m(<><Segmentado nombre="s" etiqueta="Socio" valor="Angelo" opciones={ops} avatar onCambio={cambio} testid="campo-p_socio" /><TarjetasOpcion nombre="t" etiqueta="Intencion" valor="reembolso" opciones={[{ valor: 'reembolso', texto: 'Reembolso', descripcion: 'Se regresa.' }, { valor: 'capital', texto: 'Capital', descripcion: 'Se invierte.' }]} onCambio={cambio} testid="campo-p_intencion" /></>);
    expect(cont.querySelectorAll('[role="radiogroup"]')).toHaveLength(2);
    expect((cont.querySelector('[data-testid="campo-p_socio-Angelo"]') as HTMLInputElement).checked).toBe(true);
    await clic(cont.querySelector('[data-testid="campo-p_socio-Javier"]'));
    expect(cambio).toHaveBeenCalledWith('Javier');
    expect(await auditar(cont)).toEqual([]);
  });
});
