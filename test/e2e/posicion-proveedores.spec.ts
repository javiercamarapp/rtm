// Una sola verdad por proveedor en pantalla: Proveedores (Karen e Isaac), hoja semanal, pedidos de Angelo aparte e Inicio.
// Con el escenario SINTETICO del cargador (por omision) o con otro cargado en la base local: las cifras esperadas llegan en POSICION_ESPERADA (JSON) y nunca se versionan.
// POSICION_CAPTURAS=<carpeta fuera del repo> guarda capturas a 1440 y 390, claro y oscuro.
import { expect, test, type BrowserContextOptions } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, entrarComo, ipFalsa } from './ayudas';

interface Esperado { empresa: string; libro: string; conciliacion: string | null; pendienteSocio: string; separacionHoja: string | null }
const SINTETICO: Record<'Karen' | 'Isaac', Esperado> = {
  Karen: { empresa: '$1,333.33', libro: '$1,333.33', conciliacion: 'Total con Karen según el libro $1,333.33 = deuda de la empresa $1,333.33 + pedidos de Angelo pendientes $0.00', pendienteSocio: '$0.00', separacionHoja: null },
  Isaac: {
    empresa: '$1,699.50', libro: '$5,699.50', pendienteSocio: '$4,000.00', separacionHoja: 'Falta por saldar $5,699.50 = deuda de la empresa $1,699.50 + pedidos de Angelo pendientes $4,000.00',
    conciliacion: 'Total con Isaac según el libro $5,699.50 = deuda de la empresa $1,699.50 + pedidos de Angelo pendientes $4,000.00',
  },
};
const ESPERADO: Record<'Karen' | 'Isaac', Esperado> = process.env.POSICION_ESPERADA ? JSON.parse(process.env.POSICION_ESPERADA) : SINTETICO;
const CAPTURAS = process.env.POSICION_CAPTURAS ?? '';
const VISTAS = [{ n: '1440', ancho: 1440, alto: 2300, movil: false }, { n: '390', ancho: 390, alto: 4600, movil: true }];

test.describe.configure({ mode: 'serial' });
let estado: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;

test.beforeAll(async ({ browser }) => {
  const correo = correoUnico('posicion');
  await altaUsuario({ correo, socio: 'Javier' });
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  await entrarComo(page, correo, '/proveedores');
  estado = await ctx.storageState();
  await ctx.close();
});

for (const prov of ['Karen', 'Isaac'] as const) {
  test(`${prov}: una sola cifra de deuda de la empresa, el total del libro y los pedidos de Angelo aparte`, async ({ browser }) => {
    const e = ESPERADO[prov];
    const ctx = await browser.newContext({ storageState: estado, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
    const page = await ctx.newPage();
    await page.goto(`/proveedores?p=${prov}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Cuenta con ${prov}`);
    // Encabezado, KPI y tarjeta dicen la misma cifra.
    const cuerpo = page.locator('main');
    await expect(cuerpo).toContainText(`Deuda de la empresa con ${prov} ${e.empresa}`);
    await expect(page.getByTestId('posicion-proveedor')).toContainText(e.empresa);
    await expect(page.getByTestId('posicion-cifra')).toContainText(e.empresa);
    await expect(page.getByTestId('etiqueta-saldo')).toContainText('Deuda de la empresa');
    await expect(page.getByTestId('etiqueta-saldo')).not.toContainText(/prepago/i);
    // El desglose del libro y la conciliacion con los pedidos de Angelo.
    await expect(page.getByTestId('posicion-desglose')).toContainText(`total con ${prov} según el libro se le debe ${e.libro}`);
    if (e.conciliacion) await expect(page.getByTestId('conciliacion-libro')).toHaveText(e.conciliacion);
    // Nada del lenguaje anterior que mezclaba cifras.
    await expect(cuerpo).not.toContainText('A favor de la sociedad +');
    await expect(cuerpo).not.toContainText('Se le debe al proveedor');
    await expect(cuerpo).not.toContainText('Saldo de la cuenta con');
    // Pedidos de Angelo: bloque separado con su desglose y enlace.
    const bloque = page.getByRole('table', { name: `Pedidos de Angelo con ${prov}` });
    await expect(bloque).toBeVisible();
    await expect(page.getByText(`Pedidos de Angelo (a su cuenta, no son deuda de la empresa)`)).toBeVisible();
    await expect(page.getByTestId('ir-menudeo')).toHaveAttribute('href', `/menudeo?proveedor=${prov}`);
    await expect(page.getByTestId('pedidos-socio-linea')).toContainText(e.pendienteSocio);
    // Hoja semanal: cuadra con el libro y su saldo al corte es el mismo total.
    await expect(page.getByTestId('hoja-cuadra')).toContainText('Cuadra');
    await expect(page.getByTestId('hoja-nota-libro')).toContainText(e.libro);
    if (e.separacionHoja) await expect(page.getByTestId('hoja-separacion')).toContainText(e.separacionHoja);
    // Explicar este numero: libro y auxiliar cuadran.
    await page.getByTestId('posicion-proveedor').getByRole('button').click();
    await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
    await expect(page.getByTestId('explicar-cajon')).toContainText(`Deuda de la empresa con ${prov}`);
    await page.keyboard.press('Escape');
    // Movimientos de la cuenta: rotulados como cuenta corriente y reconciliados con el total del libro.
    await page.goto(`/proveedores?p=${prov}&vista=cuenta`);
    await expect(page.getByText('Solo movimientos de cuenta (pagos y compras).').first()).toBeVisible();
    await expect(page.getByTestId('reconciliacion-cuenta')).toContainText(`total según el libro`);
    await ctx.close();
  });
}

test('Inicio: Por pagar a Isaac es la deuda de la empresa y los pedidos de Angelo van aparte', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: estado, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  await page.goto('/');
  const chip = page.getByTestId('pulso-isaac').first();
  await expect(chip).toContainText(ESPERADO.Isaac.empresa);
  await expect(chip).toContainText('deuda de la empresa');
  if (ESPERADO.Isaac.pendienteSocio !== '$0.00') await expect(chip).toContainText(`aparte ${ESPERADO.Isaac.pendienteSocio}`);
  await ctx.close();
});

test('detalle de la liquidacion: la hoja arranca de la posicion y cuadra con el libro', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: estado, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  for (const prov of ['Karen', 'Isaac'] as const) {
    await page.goto(`/proveedores/liquidacion?p=${prov}`);
    await expect(page.getByTestId('comprobacion')).toContainText('Cuadra');
    await expect(page.getByText('Saldo de la hoja = saldo del libro al corte', { exact: false }).first()).toBeVisible();
  }
  await ctx.close();
});

test('Dropshipping, pagos al proveedor: la misma deuda de la empresa con el pedido de Angelo aparte', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: estado, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  for (const prov of ['Karen', 'Isaac'] as const) {
    await page.goto(`/dropshipping/pagos?proveedor=${prov}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Cuenta con ${prov}: deuda de la empresa ${ESPERADO[prov].empresa}`);
    await expect(page.getByTestId('ds-saldo')).toContainText(ESPERADO[prov].empresa);
  }
  await ctx.close();
});

test('Contabilidad y Proyecciones: el libro sigue tal cual y el pago del viernes es la deuda de la empresa', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: estado, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  await page.goto('/contabilidad/balance');
  await expect(page.locator('main')).toContainText(`Proveedor Isaac`);
  await expect(page.locator('main')).toContainText(ESPERADO.Isaac.libro);
  await page.goto('/contabilidad/proyecciones');
  await expect(page.locator('main')).toContainText('Aparte: pedidos del socio de menudeo pendientes');
  await ctx.close();
});

test('capturas de Karen e Isaac a 1440 y 390, claro y oscuro', async ({ browser }) => {
  test.skip(!CAPTURAS, 'sin POSICION_CAPTURAS');
  mkdirSync(CAPTURAS, { recursive: true });
  for (const v of VISTAS) {
    for (const tema of ['claro', 'oscuro'] as const) {
      const opciones: BrowserContextOptions = { storageState: estado, viewport: { width: v.ancho, height: v.alto }, deviceScaleFactor: v.movil ? 2 : 1, isMobile: v.movil, hasTouch: v.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } };
      const ctx = await browser.newContext(opciones);
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      const page = await ctx.newPage();
      for (const prov of ['Karen', 'Isaac'] as const) {
        await page.goto(`/proveedores?p=${prov}`);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(CAPTURAS, `${prov}-${v.n}-${tema}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
});
