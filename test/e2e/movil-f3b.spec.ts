// Version movil de la seccion Contabilidad: iPhone 16 Pro (WebKit, 402x874) y plegable (Chromium, cerrado 344 y abierto 880).
// Sin scroll horizontal, objetivos tactiles de 44 px y campos de 16 px.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

test.beforeAll(async () => {
  await sembrarCuentasE2E();
});

async function sinScrollHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function objetivosTactiles(page: Page) {
  const chicos = await page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-cifra, main .rtm-dt-celda a, main .rtm-subnav a, main .rtm-rango a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`${el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return mal;
  });
  expect(chicos).toEqual([]);
}

test('las pantallas de Contabilidad no tienen scroll horizontal y tienen objetivos de 44 px', async ({ page }) => {
  const correo = correoUnico('movil-f3b');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/contabilidad');
  for (const ruta of ['/contabilidad', '/contabilidad/diario', '/contabilidad/mayor', '/contabilidad/mayor?cuenta=1310', '/contabilidad/estado-de-resultados', '/contabilidad/balance', '/contabilidad/flujo', '/contabilidad/comprobaciones', '/contabilidad/proyecciones']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosTactiles(page);
  }
});

test('el cajon Explicar este numero cabe en pantalla en la valuacion', async ({ page }) => {
  const correo = correoUnico('movil-f3b-c');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, '/contabilidad');
  await page.getByTestId('v01').getByRole('button').click();
  const ancho = page.viewportSize()!.width;
  // El cajon entra deslizando: se espera a que termine la animacion antes de medir.
  await expect.poll(async () => {
    const caja = await page.getByTestId('explicar-cajon').boundingBox();
    return caja ? caja.x + caja.width : Infinity;
  }, { timeout: 5000 }).toBeLessThanOrEqual(ancho + 1);
  const caja = await page.getByTestId('explicar-cajon').boundingBox();
  expect(caja!.x).toBeGreaterThanOrEqual(-1);
});
