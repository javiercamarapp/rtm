// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { clic, escribir, porTestid, simularDialogo } from '@/ui/graficas/pruebas/formularios';
import { PagoSocioProveedor, TEXTO_CAPITAL } from './pago-socio';

const refresh = vi.fn();
const ejecutar = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../operacion/acciones', () => ({ ejecutar: (a: string, args: Record<string, unknown>) => ejecutar(a, args) }));

const montajes: Montaje[] = [];
beforeAll(simularDialogo);
afterEach(() => { while (montajes.length) montajes.pop()!.desmontar(); refresh.mockClear(); ejecutar.mockReset(); });

async function abrir() {
  const m = montar(<PagoSocioProveedor proveedor="Isaac" />, 'reduced');
  montajes.push(m);
  await clic(porTestid(m.cont, 'pago-socio'));
  return m;
}
const campo = (m: Montaje, etiqueta: string) => m.cont.querySelector(`[aria-label="${etiqueta}"]`);

describe('PagoSocioProveedor: dinero propio = reembolso salvo declaracion expresa', () => {
  it('por omision NO declara capital: manda p_declara_capital false', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: {} });
    const m = await abrir();
    escribir(campo(m, 'Monto del pago'), '2900');
    escribir(campo(m, 'Con qué dinero'), 'dinero_propio');
    expect((porTestid(m.cont, 'declara-capital') as HTMLInputElement).checked).toBe(false);
    expect(m.cont.textContent).toContain('queda como reembolso');
    expect(m.cont.textContent).not.toContain('Se registrará como aportación de capital');
    await clic(porTestid(m.cont, 'confirmar'));
    const [accion, args] = ejecutar.mock.calls[0]!;
    expect(accion).toBe('pago_proveedor_de_socio');
    expect(args).toMatchObject({ p_proveedor: 'Isaac', p_monto_cent: 290000, p_socio: 'Angelo', p_fuente: 'dinero_propio', p_declara_capital: false });
  });

  it('la opcion de dinero propio ya no se llama aportacion de capital', async () => {
    const m = await abrir();
    expect(m.cont.textContent).not.toContain('Dinero propio (aportación de capital)');
    expect(m.cont.textContent).toContain('Dinero propio (reembolso');
  });

  it('con la casilla marcada muestra el texto de confirmacion y manda p_declara_capital true', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: {} });
    const m = await abrir();
    escribir(campo(m, 'Monto del pago'), '100');
    expect(m.cont.textContent).toContain(TEXTO_CAPITAL);
    await clic(porTestid(m.cont, 'declara-capital'));
    expect(porTestid(m.cont, 'aviso-capital')?.textContent).toContain('Se registrará como aportación de capital, no como reembolso');
    await clic(porTestid(m.cont, 'confirmar'));
    expect(ejecutar.mock.calls[0]![1]).toMatchObject({ p_declara_capital: true, p_fuente: 'auto' });
  });

  it('con solo fondos de la sociedad no hay declaracion posible y nunca viaja capital', async () => {
    ejecutar.mockResolvedValue({ ok: true, datos: {} });
    const m = await abrir();
    await clic(porTestid(m.cont, 'declara-capital'));
    escribir(campo(m, 'Con qué dinero'), 'fondos_sociedad');
    expect(porTestid(m.cont, 'declara-capital')).toBeNull();
    escribir(campo(m, 'Monto del pago'), '50');
    await clic(porTestid(m.cont, 'confirmar'));
    expect(ejecutar.mock.calls[0]![1]).toMatchObject({ p_fuente: 'fondos_sociedad', p_declara_capital: false });
  });

  it('cancelar limpia la declaracion: la siguiente vez vuelve a reembolso', async () => {
    const m = await abrir();
    await clic(porTestid(m.cont, 'declara-capital'));
    const cancelar = Array.from(m.cont.querySelectorAll('button')).find((b) => b.textContent === 'Cancelar')!;
    await clic(cancelar);
    await clic(porTestid(m.cont, 'descartar')); // el dialogo pide descartar lo escrito
    await clic(porTestid(m.cont, 'pago-socio'));
    expect((porTestid(m.cont, 'declara-capital') as HTMLInputElement).checked).toBe(false);
  });
});
