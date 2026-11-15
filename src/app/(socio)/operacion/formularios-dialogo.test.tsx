// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditar, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, escribir, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { AccionesSocios, type EfectosSocios } from '../socios/formularios';
import { BotonAccion, FormularioAccion } from './formulario-accion';
import { DialogoSimple } from './dialogo-simple';

const ejecutar = vi.fn();
vi.mock('./acciones', () => ({ ejecutar: (...a: unknown[]) => ejecutar(...a) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/socios', useSearchParams: () => new URLSearchParams() }));

const montajes: Montaje[] = [];
beforeAll(() => { simularDialogo(); });
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); ejecutar.mockReset(); });
const m = (el: React.ReactElement) => { const x = montar(el, 'off'); montajes.push(x); return x; };
const t = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

const efectos: EfectosSocios = {
  faltan: 'Faltan $500.00 para estar idénticos', igualados: false,
  socios: [
    { socio: 'Angelo', valuacion: '$10,000.00', participacionPct: 55, reembolsoPendiente: '$0.00', fondos: '$0.00' },
    { socio: 'Javier', valuacion: '$9,500.00', participacionPct: 45, reembolsoPendiente: '$1,200.00', fondos: '$0.00' },
  ],
};

describe('aportacion (Dinero que un socio deposita)', () => {
  it('socio segmentado, monto con $, intencion en tarjetas con reembolso por omision y panel Asi quedara', async () => {
    const { cont } = m(<AccionesSocios efectos={efectos} />);
    await clic(t(cont, 'aportacion'));
    const d = cont.querySelector('dialog')!;
    expect(d.querySelectorAll('[role="radiogroup"]')).toHaveLength(2);
    expect((t(d, 'campo-p_socio-Angelo') as HTMLInputElement).checked).toBe(true);
    expect((t(d, 'campo-p_intencion-reembolso') as HTMLInputElement).checked).toBe(true);
    expect((t(d, 'campo-p_intencion-capital') as HTMLInputElement).checked).toBe(false);
    expect(d.querySelector('.rtm-hoja-prefijo')!.textContent).toBe('$');
    expect(d.textContent).toContain('Solo es capital si el socio lo declara.');
    const panel = t(d, 'panel-efecto');
    expect(panel.textContent).toContain('$10,000.00');
    expect(panel.textContent).toContain('Faltan $500.00 para estar idénticos');
    expect(panel.textContent).toContain('reembolso');
    await clic(t(d, 'campo-p_intencion-capital'));
    expect(t(d, 'panel-efecto').textContent).toContain('capital');
    expect(await auditar(cont)).toEqual([]);
  });
  it('valida inline, manda centavos enteros y la intencion elegida', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: {} });
    const { cont } = m(<AccionesSocios efectos={efectos} />);
    await clic(t(cont, 'aportacion'));
    await clic(t(cont, 'confirmar'));
    expect(cont.querySelectorAll('.rtm-hoja-campo-error').length).toBeGreaterThan(0);
    expect(ejecutar).not.toHaveBeenCalled();
    escribir(t(cont, 'campo-p_monto_cent'), '9000.5');
    expect((t(cont, 'campo-p_monto_cent') as HTMLInputElement).value).toBe('9,000.5');
    escribir(t(cont, 'campo-p_concepto'), 'Deposito a caja');
    await clic(t(cont, 'confirmar'));
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar.mock.calls[0]![1]).toMatchObject({ p_socio: 'Angelo', p_monto_cent: 900050, p_intencion: 'reembolso', p_concepto: 'Deposito a caja' });
  });
  it('error del servidor visible en el dialogo', async () => {
    ejecutar.mockResolvedValue({ ok: false, mensaje: 'La base rechazo la aportacion.', codigo: 'x' });
    const { cont } = m(<AccionesSocios efectos={efectos} />);
    await clic(t(cont, 'aportacion'));
    escribir(t(cont, 'campo-p_monto_cent'), '10');
    escribir(t(cont, 'campo-p_concepto'), 'x');
    await clic(t(cont, 'confirmar'));
    expect(t(cont, 'error-dialogo').textContent).toBe('La base rechazo la aportacion.');
  });
});

describe('gasto de un socio', () => {
  it('muestra la regla y el reembolso pendiente del socio elegido, sin cifras inventadas', async () => {
    const { cont } = m(
      <FormularioAccion boton="Registrar gasto" titulo="Gasto pagado por un socio" confirmar="Registrar gasto" accion="registrar_gasto_socio" testid="gasto-socio"
        campos={[{ nombre: 'p_socio', etiqueta: 'Socio que pagó', tipo: 'seleccion', presentacion: 'segmentado', avatar: true, opciones: [{ valor: 'Angelo', texto: 'Angelo' }, { valor: 'Javier', texto: 'Javier' }] }, { nombre: 'p_monto_cent', etiqueta: 'Monto', tipo: 'monto', requerido: true }]}
        efecto={(v) => <div data-testid="efecto-prueba">{v.p_socio}</div>} />,
    );
    await clic(t(cont, 'gasto-socio'));
    await clic(t(cont, 'campo-p_socio-Javier'));
    expect(t(cont, 'efecto-prueba').textContent).toBe('Javier');
    expect(await auditar(cont)).toEqual([]);
  });
});

describe('confirmacion compacta', () => {
  it('anular: variante compacta, tono de peligro, Cancelar enfocado y axe limpio', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: {} });
    const { cont } = m(<DialogoSimple boton="Anular pago" titulo="Anular pago" accion="anular_pago" args={{ p_id: 1 }} texto={<p>El pago deja de contar y se puede rehacer.</p>} testid="anular" />);
    await clic(t(cont, 'anular'));
    const d = cont.querySelector('dialog')!;
    expect(d.hasAttribute('data-compacta')).toBe(true);
    expect(d.getAttribute('data-tono')).toBe('peligro');
    expect(document.activeElement!.textContent).toBe('Cancelar');
    expect(await auditar(cont)).toEqual([]);
    await clic(t(cont, 'confirmar'));
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
  it('BotonAccion sin motivo usa la misma hoja compacta', async () => {
    const { cont } = m(<BotonAccion texto="Firmar" accion="firmar" args={{}} testid="firmar" />);
    await clic(t(cont, 'firmar'));
    expect(cont.querySelector('dialog')!.hasAttribute('data-compacta')).toBe(true);
  });
});
