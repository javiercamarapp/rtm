// Flujo de cuentas de la campana maestra: alta por la pantalla /cuentas (socio), acceso local sin correos, bodega entra, desactivar corta la sesion,
// reactivar la devuelve y el tope de 20 cuentas activas (alta y reactivacion). Usa la sesion del socio guardada y el enlace magico local.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { enlaceConfirmacion, conDb } from '../ayudas';

const SS = process.env.MAESTRO_SS!;
const BODEGA = 'maestro.bodega@example.test';
test.describe.configure({ mode: 'serial' });
test.use({ storageState: `${SS}/socio_a.json` });

test('alta de bodega por /cuentas, acceso local sin correos y sesion de bodega', async ({ page, browser }) => {
  await page.goto('/cuentas');
  const opciones = await page.getByTestId('campo-tipo-cuenta').locator('option').allTextContents();
  expect(opciones).toEqual(['Bodega']);
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByText('Escribe el correo.')).toBeVisible();
  await page.getByTestId('campo-correo').fill(BODEGA);
  await page.getByTestId('campo-nombre-cuenta').fill('Turno maestro');
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByTestId('eco-cuenta')).toContainText('Falta crear su acceso');
  const salida = execFileSync('node', ['scripts/acceso/sincronizar-cuentas.mjs'], { encoding: 'utf8' });
  expect(salida).toMatch(/1 acceso\(s\) creado\(s\)/);
  expect(salida).not.toContain('@');
  await page.reload();
  const ctx = await browser.newContext({ baseURL: page.url().split('/cuentas')[0] });
  const b = await ctx.newPage();
  await b.goto(await enlaceConfirmacion(BODEGA, '/bodega'));
  await b.getByTestId('confirmar-acceso').click();
  await b.waitForURL(/\/bodega/);
  await ctx.storageState({ path: `${SS}/bodega.json` });
  // desactivar corta la sesion
  const fila = page.getByRole('row').filter({ hasText: BODEGA });
  await fila.getByTestId('desactivar-cuenta').click();
  await page.getByTestId('confirmar').click();
  await expect(fila).toContainText('Desactivada');
  await b.goto('/bodega');
  await expect(b).toHaveURL(/\/login/);
  await fila.getByTestId('reactivar-cuenta').click();
  await expect(fila).toContainText('Activa');
  await b.goto(await enlaceConfirmacion(BODEGA, '/bodega'));
  await b.getByTestId('confirmar-acceso').click();
  await b.waitForURL(/\/bodega/);
  await ctx.storageState({ path: `${SS}/bodega.json` });
  await ctx.close();
});

test('tope de 20 cuentas activas: el alta 21 se rechaza y la reactivacion tambien', async ({ page }) => {
  const activas = async () => Number((await conDb((c) => c.query("select count(*)::int n from seguridad.correo_permitido c join seguridad.tipo_cuenta t on t.rol = c.rol where t.creable_web and c.activo"))).rows[0].n);
  let n = await activas();
  await page.goto('/cuentas');
  for (let i = 0; n < 20; i += 1, n += 1) {
    await page.getByTestId('campo-correo').fill(`maestro.relleno${i}@example.test`);
    await page.getByTestId('crear-cuenta').click();
    await expect(page.getByTestId('eco-cuenta')).toBeVisible();
  }
  expect(await activas()).toBe(20);
  await page.getByTestId('campo-correo').fill('maestro.excedente@example.test');
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByRole('alert').filter({ hasText: /tope/i })).toBeVisible();
  expect(await activas()).toBe(20);
  // desactivar una y reactivar bajo el tope; con 20 activas otra desactivada no se reactiva
  const fila = page.getByRole('row').filter({ hasText: 'maestro.relleno0@example.test' });
  await fila.getByTestId('desactivar-cuenta').click();
  await page.getByTestId('confirmar').click();
  await expect(fila).toContainText('Desactivada');
  await page.getByTestId('campo-correo').fill('maestro.excedente@example.test');
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByRole('alert').filter({ hasText: /tope/i })).toHaveCount(0);
  expect(await activas()).toBe(20);
  await fila.getByTestId('reactivar-cuenta').click();
  await expect(fila).toContainText('Desactivada');
  expect(await activas()).toBe(20);
});
