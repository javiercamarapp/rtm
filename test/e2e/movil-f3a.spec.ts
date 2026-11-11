// Version movil de las pantallas de F3a: iPhone 16 Pro (WebKit, 402x874) y plegable (Chromium, cerrado 344 y abierto 880).
// Sin scroll horizontal, objetivos tactiles de 44 px, campos de 16 px y dialogos que caben en pantalla.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E, type DatosF3a } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosF3a;
test.beforeAll(async () => {
  d = await sembrarCuentasE2E();
});

async function sinScrollHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function objetivosTactiles(page: Page) {
  const chicos = await page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-chip-filtro, main .rtm-cifra, main .rtm-dt-celda a, main button[type=submit], main .rtm-segmentado a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`${el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return mal;
  });
  expect(chicos).toEqual([]);
}

test('las pantallas de F3a no tienen scroll horizontal, tienen objetivos de 44 px y campos de 16 px', async ({ page }) => {
  const correo = correoUnico('movil-f3a');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/socios');
  for (const ruta of ['/socios', '/socios/Angelo', '/socios/cascada', '/omar', '/cuentas-por-cobrar', '/proveedores?p=Isaac', '/proveedores/liquidacion?p=Isaac&ambito=todo', '/proveedores/liquidacion?p=Karen']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosTactiles(page);
    for (const campo of await page.locator('main input:visible, main select:visible, main textarea:visible').all()) {
      expect(await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
  }
  expect(d.pedidoBodegaId).toBeGreaterThan(0);
});

test('los dialogos de captura caben en pantalla', async ({ page }) => {
  const correo = correoUnico('movil-f3a-dlg');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, '/socios');
  for (const id of ['aportacion', 'gasto-socio', 'pago-a-socio', 'liquidacion-socios']) {
    await page.getByTestId(id).click();
    const caja = await page.getByRole('dialog').boundingBox();
    const ancho = page.viewportSize()!.width;
    expect(caja!.x).toBeGreaterThanOrEqual(-0.5);
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(ancho + 0.5);
    for (const campo of await page.getByRole('dialog').locator('input:visible, select:visible').all()) {
      expect(await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
});
