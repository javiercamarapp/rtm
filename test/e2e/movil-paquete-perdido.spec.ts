// Carril paquete-perdido en movil: las dos pantallas de paquetes con el bloque de incidentes no desbordan en horizontal.
import { expect, test } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

for (const ruta of ['/paquetes/por-hacer', '/paquetes/en-trayecto']) {
  test(`${ruta}: sin desborde horizontal y con el bloque de incidentes`, async ({ page }) => {
    const correo = correoUnico('paqm');
    await altaUsuario({ correo, socio: 'Angelo' });
    await entrarComo(page, correo, ruta);
    await expect(page.getByText(/perdidos o dañados/i).first()).toBeVisible();
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra).toBeLessThanOrEqual(1);
  });
}
