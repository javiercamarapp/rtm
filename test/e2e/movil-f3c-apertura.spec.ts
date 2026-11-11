// Version movil de F3c: iPhone 16 Pro (WebKit, 402x874) y plegable (Chromium, cerrado 344 y abierto 880).
// Sin scroll horizontal, objetivos tactiles de 44 px y formularios de 16 px en las pantallas de apertura y movimientos. La sesion de apertura se descarta al terminar.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

async function sinScrollHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function objetivosYFormularios(page: Page) {
  const malos = await page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-dt-celda a, main .rtm-subnav a, main .rtm-filtros-estado a, main select, main input:not([type=checkbox]):not([type=file]), main textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`alto ${el.textContent?.trim().slice(0, 30) || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 15.9) mal.push(`fuente ${el.tagName} ${getComputedStyle(el).fontSize}`);
    }
    return mal;
  });
  expect(malos).toEqual([]);
}

test('apertura y movimientos: sin scroll horizontal, objetivos de 44 px y formularios de 16 px', async ({ page }) => {
  const correo = correoUnico('movil-f3c');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, '/apertura');
  await page.getByTestId('apertura-crear').click();
  await page.getByRole('button', { name: 'Abrir sesión' }).click();
  await expect(page.getByTestId('apertura-estado')).toContainText('Borrador');
  // una partida para que las tablas tengan filas
  await page.goto('/apertura/paso/3');
  await page.getByTestId('form-aportacion').getByTestId('campo-monto').fill('1000');
  await page.getByTestId('form-aportacion').getByTestId('agregar-partida').click();
  await expect(page.getByRole('row').filter({ hasText: 'Aportación de capital' })).toBeVisible();
  const rutas = ['/apertura', ...Array.from({ length: 10 }, (_, i) => `/apertura/paso/${i + 1}`), '/movimientos', '/movimientos?estado=sin_clasificar', '/movimientos/importar', '/movimientos/resumen'];
  for (const ruta of rutas) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosYFormularios(page);
  }
  // descartar la sesion para no dejar una apertura vigente
  await page.goto('/apertura/paso/10');
  await page.getByTestId('apertura-descartar').click();
  await page.getByTestId('campo-p_motivo').fill('Prueba movil');
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.goto('/apertura');
  await expect(page.getByTestId('apertura-vacia')).toBeVisible();
});
