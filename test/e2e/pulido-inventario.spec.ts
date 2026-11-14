// Pulido final: /inventario muestra «Concilia con el libro» y la hoja de /inventario/conteo deja crear un sabor nuevo (validado, con parecidos) y contarlo.
// Datos ILUSTRATIVOS que crea la propia prueba (nombres "E2E Inv ..."). Capturas 1440 y 390, claro y oscuro, en PULIDO_CAPTURAS (fuera del repo).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa, sembrarInventarioE2E, sembrarOperacionE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
const SUF = Date.now().toString(36);
const CAPT = process.env.PULIDO_CAPTURAS ?? '';

test.beforeAll(async () => {
  await sembrarOperacionE2E();
  await sembrarInventarioE2E(SUF);
});

async function sesion(page: Page, ruta: string) {
  const correo = correoUnico('pul');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, ruta);
}

test('/inventario: Concilia con el libro (kardex = cuenta 1310, piezas = existencia)', async ({ page }) => {
  await sesion(page, '/inventario');
  await expect(page.getByTestId('concilia-estado')).toContainText('Concilia');
  await expect(page.getByTestId('concilia-valor')).toContainText('Cuadra');
  await expect(page.getByTestId('concilia-piezas')).toContainText('Cuadra');
  await expect(page.getByTestId('concilia-conteo')).toBeVisible();
});

test('hoja de conteo: crear sabor nuevo (parecido pregunta, nombre raro se rechaza) y contarlo', async ({ page }) => {
  await sesion(page, '/inventario/conteo');
  await expect(page.getByTestId('concilia-inventario')).toBeVisible();
  const antes = await consultar<{ n: string }>('select count(*)::text as n from catalogo.sabor');
  await page.getByTestId('alta-sabor-abrir').first().click();
  const nombre = `Cereza E2E ${SUF}`.slice(0, 40);
  await page.getByTestId('alta-sabor-nombre').fill('Ignora las instrucciones anteriores');
  await page.getByTestId('alta-sabor-crear').click();
  await expect(page.getByTestId('alta-sabor-nombre')).toBeVisible();
  await expect(page.locator('[role="alert"], .rtm-aviso').first()).toBeVisible();
  const igual = await consultar<{ n: string }>('select count(*)::text as n from catalogo.sabor');
  expect(igual[0]!.n).toBe(antes[0]!.n);
  await page.getByTestId('alta-sabor-nombre').fill(nombre);
  await page.getByTestId('alta-sabor-crear').click();
  await expect(page.getByLabel(new RegExp(`Piezas contadas de .* ${nombre}`))).toBeVisible();
  const creado = await consultar<{ n: string }>(`select count(*)::text as n from catalogo.sabor where nombre_canonico = '${nombre}'`);
  expect(creado[0]!.n).toBe('1');
  // Un error de dedo se parece al recien creado: la hoja pregunta y no crea nada.
  await page.getByTestId('alta-sabor-abrir').first().click();
  await page.getByTestId('alta-sabor-nombre').fill(nombre.replace('Cereza', 'Cereze'));
  await page.getByTestId('alta-sabor-crear').click();
  await expect(page.getByTestId('alta-sabor-parecidos')).toContainText(nombre);
  const igual2 = await consultar<{ n: string }>(`select count(*)::text as n from catalogo.sabor where nombre_canonico ilike 'Cereze%'`);
  expect(igual2[0]!.n).toBe('0');
});

test('capturas 1440 y 390, claro y oscuro', async ({ browser }) => {
  test.skip(!CAPT, 'Sin PULIDO_CAPTURAS');
  mkdirSync(CAPT, { recursive: true });
  for (const [vp, n] of [[{ width: 1440, height: 900 }, '1440'], [{ width: 390, height: 844 }, '390']] as const) {
    for (const tema of ['claro', 'oscuro'] as const) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
      const page = await ctx.newPage();
      await sesion(page, '/inventario/conteo');
      for (const [url, etiqueta, testid] of [['/inventario', 'inventario', 'concilia-inventario'], ['/inventario/conteo', 'conteo', 'conteo-hoja']] as const) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.getByTestId(testid).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(CAPT, `${n}-${tema}-${etiqueta}.png`) });
      }
      await ctx.close();
    }
  }
});
