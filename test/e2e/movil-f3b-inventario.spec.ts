// Version movil de F3b-2: iPhone 16 Pro (WebKit, 402x874) y plegable (Chromium, cerrado 344 y abierto 880).
// Sin scroll horizontal, objetivos tactiles de 44 px, la campana cabe y la hoja de compartir se abre con el PDF.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa, sembrarInventarioE2E, sembrarOperacionE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

test.beforeAll(async () => {
  await sembrarOperacionE2E();
  await sembrarInventarioE2E(Date.now().toString(36));
});

async function sinScrollHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function objetivosTactiles(page: Page) {
  const chicos = await page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-cifra, main .rtm-dt-celda a, main .rtm-pestanas a, main .rtm-chip-filtro, .rtm-campana-boton, main select, main input:not([type=checkbox])')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`${el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return mal;
  });
  expect(chicos).toEqual([]);
}

test('las pantallas de inventario, avisos, inicio y paquetes no tienen scroll horizontal y tienen objetivos de 44 px', async ({ page }) => {
  const correo = correoUnico('movil-f3bi');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/inventario');
  for (const ruta of ['/', '/inventario', '/inventario?estado=reponer', '/inventario/kardex', '/inventario/conteo', '/avisos', '/avisos?pestana=sin_leer', '/paquetes/por-hacer', '/paquetes/en-trayecto']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosTactiles(page);
  }
});

test('la campana abre su panel dentro de la pantalla', async ({ page }) => {
  const correo = correoUnico('movil-f3bi-c');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, '/');
  await page.getByTestId('campana').click();
  const panel = page.getByTestId('campana-panel');
  await expect(panel).toBeVisible();
  const caja = (await panel.boundingBox())!;
  const ancho = page.viewportSize()!.width;
  expect(caja.x).toBeGreaterThanOrEqual(-1);
  expect(caja.x + caja.width).toBeLessThanOrEqual(ancho + 1);
});

test('exportar y compartir: la hoja nativa recibe el PDF', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__compartido = null;
    Object.defineProperty(navigator, 'canShare', { value: (d: { files?: File[] }) => Boolean(d.files?.length), configurable: true });
    Object.defineProperty(navigator, 'share', { value: async (d: { files: File[]; text: string }) => { (window as unknown as Record<string, unknown>).__compartido = { archivos: d.files.length, tipo: d.files[0]?.type, bytes: d.files[0]?.size }; }, configurable: true });
  });
  const correo = correoUnico('movil-f3bi-s');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/inventario');
  await page.getByTestId('exportar-abrir').click();
  await page.getByTestId('exportar-generar').click();
  await page.getByTestId('exportar-resultado').waitFor();
  await sinScrollHorizontal(page);
  await page.getByTestId('exportar-compartir').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__compartido)).not.toBeNull();
  const c = (await page.evaluate(() => (window as unknown as Record<string, unknown>).__compartido)) as { archivos: number; tipo: string; bytes: number };
  expect(c).toMatchObject({ archivos: 1, tipo: 'application/pdf' });
  expect(c.bytes).toBeGreaterThan(1000);
});
