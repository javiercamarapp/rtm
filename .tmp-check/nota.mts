import { chromium } from '@playwright/test';
import { altaUsuario, correoUnico, enlaceConfirmacion } from '../test/e2e/ayudas';
const correo = correoUnico('ver');
await altaUsuario({ correo, socio: 'Javier' });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3100' + (await enlaceConfirmacion(correo, '/pedidos')));
await page.getByTestId('confirmar-acceso').click();
await page.waitForURL('**/pedidos');
for (const [ruta, sel, nombre] of [['/pedidos/1', '[data-testid=nota-cliente]', 'nota'], ['/pedidos/1?vista=interna', '[data-testid=cascada]', 'cascada'], ['/paquetes/por-hacer', 'main', 'porhacer'], ['/proveedores/compras/2', 'main', 'oc2']] as const) {
  await page.goto('http://127.0.0.1:3100' + ruta);
  await page.waitForTimeout(300);
  await page.locator(sel).first().screenshot({ path: `.tmp-check/el_${nombre}.png` });
}
await b.close();
