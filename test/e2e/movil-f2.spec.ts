// Version movil de las pantallas de F2, en iPhone 16 Pro (WebKit, 402x874) y Samsung plegable (Chromium, cerrado 344 y abierto 880).
// Reglas: sin scroll horizontal de pagina, objetivos tactiles >= 44 px, campos >= 16 px, dialogos que caben en pantalla y el cambio de plegado a
// desplegado NO recarga ni pierde lo escrito.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, compraBorradorE2E, correoUnico, entrarComo, ipFalsa, pedidoConfirmadoE2E, sembrarOperacionE2E, type DatosF2 } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosF2;
let idPedido: number;
let idCompra: number;
test.beforeAll(async () => {
  d = await sembrarOperacionE2E();
  idPedido = await pedidoConfirmadoE2E(d, 30, 'mov');
  idCompra = await compraBorradorE2E(d, 'mov');
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

async function camposDe16(page: Page) {
  for (const campo of await page.locator('main input:visible, main select:visible, main textarea:visible').all()) {
    expect(await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  }
}

const rutas = (): string[] => ['/pedidos', `/pedidos/nuevo?cliente=${d.clienteId}`, `/pedidos/${idPedido}`, '/paquetes/por-hacer', '/paquetes/en-trayecto', '/cuentas-por-cobrar', '/avisos', '/proveedores', '/proveedores?p=Karen', '/proveedores/compras/nueva?p=Karen', `/proveedores/compras/${idCompra}`];

test('las pantallas de F2 no tienen scroll horizontal, tienen objetivos de 44 px y campos de 16 px', async ({ page }) => {
  const correo = correoUnico('movil-f2');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/pedidos');
  for (const ruta of rutas()) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await sinScrollHorizontal(page);
    await objetivosTactiles(page);
    await camposDe16(page);
  }
});

test('el dialogo de Marcar enviado cabe en pantalla y sus campos son de 16 px', async ({ page }) => {
  const correo = correoUnico('movil-f2-dlg');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, `/pedidos/${idPedido}`);
  await page.getByTestId(`marcar-enviado-${idPedido}`).click();
  const caja = await page.getByRole('dialog').boundingBox();
  const ancho = page.viewportSize()!.width;
  expect(caja!.x).toBeGreaterThanOrEqual(-0.5);
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(ancho + 0.5);
  for (const campo of await page.getByRole('dialog').locator('input:visible, select:visible').all()) {
    expect(await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  }
  await sinScrollHorizontal(page);
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

test('plegado a desplegado en vivo con un renglon a medio escribir: sin recarga y sin perder lo escrito', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('fold'), 'solo aplica al plegable');
  const correo = correoUnico('movil-f2-fold');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, `/pedidos/nuevo?cliente=${d.clienteId}`);
  await page.getByTestId('piezas').fill('42');
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__marca = 'sigo aqui'; });
  const antes = page.viewportSize()!;
  await page.setViewportSize(antes.width < 500 ? { width: 880, height: 860 } : { width: 344, height: 882 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__marca)).toBe('sigo aqui');
  await expect(page.getByTestId('piezas')).toHaveValue('42');
  await sinScrollHorizontal(page);
  await page.setViewportSize(antes);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('piezas')).toHaveValue('42');
  await sinScrollHorizontal(page);
});
