// Capital por mes y por socio, de punta a punta (Chromium 1440 y 390). PRECONDICION: base local sembrada con scripts/capturas/datos-demo-capital.mjs
// (octubre y noviembre de 2026, cifras ILUSTRATIVAS). Verifica lo que ve cada socio, la etiqueta de fondos en segunda persona, el renglon "Por clasificar",
// "Explicar este numero" y que no haya scroll horizontal de pagina.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
const RUTA = '/contabilidad/capital?desde=2026-10-01&hasta=2026-11-30';

async function sesion(page: Page, socio: 'Angelo' | 'Javier', ruta = RUTA) {
  const correo = correoUnico('cap');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, ruta);
}

test('sin sesion la pagina de capital manda al login', async ({ page }) => {
  await page.goto(RUTA);
  await expect(page).toHaveURL(/\/login/);
});

test('el submenu de Contabilidad trae Capital por socio', async ({ page }) => {
  await sesion(page, 'Javier', '/contabilidad');
  await expect(page.getByTestId('conta-capital')).toBeVisible();
  await page.getByTestId('conta-capital').click();
  await expect(page).toHaveURL(/\/contabilidad\/capital/);
});

test('Javier ve dos meses, el acumulado y sus fondos en segunda persona', async ({ page }) => {
  await sesion(page, 'Javier');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Valuación de $239,062.64');
  const mensual = page.getByRole('table', { name: 'Capital por mes y por socio' });
  await expect(mensual).toContainText('octubre 2026');
  await expect(mensual).toContainText('noviembre 2026');
  await expect(mensual).toContainText('$118,161.91');
  await expect(mensual).toContainText('$105,715.00');
  await expect(mensual).toContainText('Javier (tú)');
  const acum = page.getByRole('table', { name: 'Capital acumulado por socio' });
  await expect(acum).toContainText('$53,660.73');
  const fondos = page.getByRole('table', { name: 'Fondos de la sociedad en poder de socios' });
  await expect(fondos).toContainText('Fondos de la sociedad retirados por ti');
  await expect(fondos).toContainText('$35,475.00');
  await expect(fondos).not.toContainText('Fondos de la sociedad retirados por Javier');
  await expect(page.getByRole('table', { name: 'Aportación neta y diferencia a igualar' })).toContainText('Para igualar');
  const prov = page.getByRole('table', { name: 'Cuenta con proveedores' });
  await expect(prov).toContainText('Se le debe');
  await expect(prov).toContainText('Saldo a favor');
  await expect(prov).toContainText('Isaac · Por clasificar');
  await expect(prov).toContainText('$62,161.91');
  await expect(page.locator('body')).not.toContainText(/\bdebe\b a la sociedad|adeuda/i);
  await expect(page.getByTestId('turno-aportar')).toContainText('Le toca aportar el siguiente pago: Angelo por $11,240.00');
  await expect(page.getByTestId('nota-igualacion')).toContainText('no da más participación');
  await expect(page.getByTestId('reinversion-desigual')).toContainText('Reinversión distinta en el acta');
  await expect(page.locator('body')).not.toContainText(/% en libros|% de aportaciones/);
  await expect(page.getByRole('table', { name: 'Valuación y participación por socio' })).toContainText('50 %');
});

test('Angelo ve la linea de fondos con el nombre del otro socio', async ({ page }) => {
  await sesion(page, 'Angelo');
  const fondos = page.getByRole('table', { name: 'Fondos de la sociedad en poder de socios' });
  await expect(fondos).toContainText('Fondos de la sociedad retirados por Javier');
  await expect(fondos).not.toContainText('Fondos de la sociedad retirados por ti');
  await expect(page.getByRole('table', { name: 'Capital por mes y por socio' })).toContainText('Angelo (tú)');
});

test('Explicar este numero: fuente, comprobacion por dos vias y renglones', async ({ page }) => {
  await sesion(page, 'Javier');
  const acum = page.getByRole('table', { name: 'Capital acumulado por socio' });
  await acum.getByRole('button', { name: /\$53,660\.73\. Explicar este número|Explicar este número/ }).nth(1).click();
  const cajon = page.getByTestId('explicar-cajon');
  await expect(cajon).toBeVisible();
  await expect(cajon.getByTestId('explicar-fuente')).toContainText('Estado de resultados');
  await expect(cajon.getByRole('region', { name: 'Comprobación por dos vías' })).toContainText('Cuadra');
  await page.keyboard.press('Escape');
  const fondos = page.getByRole('table', { name: 'Fondos de la sociedad en poder de socios' });
  await fondos.getByRole('button', { name: /Explicar este número/ }).first().click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Fondos de la sociedad retirados por ti');
  await expect(page.getByTestId('explicar-cajon')).toContainText('Pago PG-');
});

test('todas las comprobaciones cuadran y la pagina no desborda', async ({ page }) => {
  await sesion(page, 'Javier');
  await expect(page.getByTestId('capital-aviso')).toHaveCount(0);
  const tabla = page.getByRole('table', { name: 'Comprobaciones de capital' });
  await expect(tabla).toContainText('K1');
  await expect(tabla).not.toContainText('No cuadra');
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde).toBeLessThanOrEqual(1);
});

test('un rango sin movimientos muestra el estado vacio honesto', async ({ page }) => {
  await sesion(page, 'Javier', '/contabilidad/capital?desde=2026-08-01&hasta=2026-08-31');
  await expect(page.getByText('Sin movimientos todavía')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Todavía no hay capital que mostrar');
});
