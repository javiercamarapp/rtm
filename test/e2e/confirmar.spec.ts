// Plan alterno del enlace magico (/auth/confirm con token_hash), en TODOS los perfiles de pantalla de la matriz:
//   laptop 1440 (Chromium), iPhone 16 Pro 402x874 (WebKit), Samsung plegable cerrado 344 y abierto 880 (Chromium movil).
// Falta probarlo en un telefono real con la app instalada (ver docs/F1-informe.md).
import { expect, test } from '@playwright/test';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from './ayudas';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

test('el GET no consume el enlace; el boton entra y respeta next', async ({ page, context }) => {
  const correo = correoUnico('confirmar');
  await altaUsuario({ correo, socio: 'Javier' });
  const ruta = await enlaceConfirmacion(correo, '/catalogo');

  // Un escaner de correo que solo abre el enlace (dos veces) no lo gasta.
  await page.goto(ruta);
  await expect(page.getByRole('heading', { name: /Entrar a RTM/ })).toBeVisible();
  await page.goto(ruta);
  const boton = page.getByTestId('confirmar-acceso');
  await expect(boton).toBeVisible();
  const caja = await boton.boundingBox();
  expect(caja!.height).toBeGreaterThanOrEqual(44);
  expect(caja!.width).toBeGreaterThanOrEqual(44);
  // Sin scroll horizontal de pagina.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await boton.click();
  await page.waitForURL('**/catalogo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Catálogo');

  // Usado una vez: el mismo enlace en otra sesion ya no sirve y avisa que caduco.
  const otra = await context.browser()!.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p2 = await otra.newPage();
  await p2.goto(new URL(ruta, (process.env.APP_URL_E2E ?? (process.env.APP_URL_E2E ?? 'http://127.0.0.1:3100'))).toString());
  await p2.getByTestId('confirmar-acceso').click();
  await p2.waitForURL('**/login**');
  await expect(p2.locator('.login-error')).toContainText(/ya se usó|caducó/);
  await otra.close();
});

test('un enlace incompleto o con tipo desconocido no entra', async ({ page }) => {
  await page.goto('/auth/confirm');
  await expect(page.getByRole('heading', { name: /incompleto/ })).toBeVisible();
  await page.goto('/auth/confirm?token_hash=abc&type=recovery');
  await expect(page.getByRole('heading', { name: /incompleto/ })).toBeVisible();
});

test('cuenta desactivada (Omar): el enlace valido no abre sesion', async ({ page }) => {
  const correo = correoUnico('omar-confirmar');
  await altaUsuario({ correo, rol: 'omar', activo: false });
  await page.goto(await enlaceConfirmacion(correo, '/catalogo'));
  await page.getByTestId('confirmar-acceso').click();
  await page.waitForURL('**/login**');
  await expect(page.locator('.login-error')).toContainText('no está activo');
  await page.goto('/catalogo');
  await expect(page).toHaveURL(/\/login/);
});

test('un next externo cae a la raiz', async ({ page }) => {
  const correo = correoUnico('confirmar-next');
  await altaUsuario({ correo, socio: 'Angelo' });
  await page.goto(await enlaceConfirmacion(correo, 'https://externo.example.test'));
  await page.getByTestId('confirmar-acceso').click();
  await page.waitForURL((process.env.APP_URL_E2E ?? 'http://127.0.0.1:3100') + '/');
});
