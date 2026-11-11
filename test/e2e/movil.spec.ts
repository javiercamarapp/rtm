// Version movil basica de las pantallas de F1, en iPhone 16 Pro (WebKit, 402x874) y Samsung plegable (Chromium, cerrado 344 y abierto 880).
// Reglas: sin scroll horizontal de pagina, objetivos tactiles >= 44 px, campos >= 16 px, y el cambio de plegado a desplegado NO recarga ni pierde estado.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa, limpiarCatalogoE2E, sembrarCatalogoE2E, type DatosE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let datos: DatosE2E;
test.beforeAll(async () => {
  await limpiarCatalogoE2E();
  datos = await sembrarCatalogoE2E();
});
test.afterAll(async () => {
  await limpiarCatalogoE2E();
});

async function sinScrollHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function objetivosTactiles(page: Page) {
  const chicos = await page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-chip-filtro, main .rtm-cifra, main .rtm-dt-celda a, main button[type=submit]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`${el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return mal;
  });
  expect(chicos).toEqual([]);
}

for (const ruta of ['/catalogo', '/clientes', '/inventario']) {
  test(`${ruta}: sin scroll horizontal, objetivos de 44 px y campos de 16 px`, async ({ page }) => {
    const correo = correoUnico('movil');
    await altaUsuario({ correo, socio: 'Javier' });
    await entrarComo(page, correo, ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosTactiles(page);
    for (const campo of await page.locator('input:visible, select:visible, textarea:visible').all()) {
      expect(await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    }
  });
}

test('ficha de cliente: sin scroll horizontal y el cajon cabe en pantalla', async ({ page }) => {
  const correo = correoUnico('movil-ficha');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, `/clientes/${datos.clienteId}`);
  await sinScrollHorizontal(page);
  await objetivosTactiles(page);
  await page.getByRole('table', { name: /Tabulador/ }).getByRole('button', { name: /Explicar este número/ }).first().click();
  await page.waitForTimeout(450); // termina la entrada del cajon
  const caja = await page.getByTestId('explicar-cajon').boundingBox();
  expect(caja!.x).toBeGreaterThanOrEqual(-0.5);
  expect(caja!.x + caja!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 0.5);
  await page.keyboard.press('Escape');
});

test('plegado a desplegado en vivo: sin recarga y sin perder lo escrito', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('fold'), 'solo aplica al plegable');
  const correo = correoUnico('movil-fold');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/catalogo');
  await page.getByLabel('Buscar en el catálogo').fill('texto escrito');
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__marca = 'sigo aqui'; });
  const antes = page.viewportSize()!;
  const nuevo = antes.width < 500 ? { width: 880, height: 860 } : { width: 344, height: 882 };
  await page.setViewportSize(nuevo);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__marca)).toBe('sigo aqui');
  await expect(page.getByLabel('Buscar en el catálogo')).toHaveValue('texto escrito');
  await sinScrollHorizontal(page);
  await page.setViewportSize(antes);
  await page.waitForTimeout(300);
  await expect(page.getByLabel('Buscar en el catálogo')).toHaveValue('texto escrito');
  await sinScrollHorizontal(page);
});
