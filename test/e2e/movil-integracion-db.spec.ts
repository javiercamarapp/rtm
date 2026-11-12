// Version movil de la integracion con base de datos: iPhone 16 Pro (WebKit, 402x874) y plegable (Chromium, cerrado 344 y abierto 880).
// Sin scroll horizontal, objetivos tactiles de 44 px y formularios de 16 px en Reportes, Costos y el Inventario actual de proveedores.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

async function sinScrollHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function objetivosYFormularios(page: Page) {
  const malos = await page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-dt-celda a, main .rtm-filtros-estado a, main select, main input:not([type=checkbox]):not([type=file]), main textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`alto ${el.textContent?.trim().slice(0, 30) || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && parseFloat(getComputedStyle(el).fontSize) < 15.9) mal.push(`fuente ${el.tagName} ${getComputedStyle(el).fontSize}`);
    }
    return mal;
  });
  expect(malos).toEqual([]);
}

test('reportes, costos e inventario de proveedores: sin scroll horizontal, objetivos de 44 px y formularios de 16 px', async ({ page }) => {
  const correo = correoUnico('movil-intdb');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/costos');
  for (const ruta of ['/costos', '/reportes', '/proveedores/inventario']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosYFormularios(page);
  }
  // Con el formulario de cargo en modo participacion (campos extra) tampoco hay desborde
  await page.goto('/costos');
  await page.getByTestId('cargo-modo').selectOption('participacion');
  await sinScrollHorizontal(page);
  await objetivosYFormularios(page);
});
