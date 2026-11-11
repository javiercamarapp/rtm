import { chromium } from '@playwright/test';
import { altaUsuario, correoUnico, enlaceConfirmacion, conDb } from '../test/e2e/ayudas';

const rutas = process.argv.slice(2);
const correo = correoUnico('ver');
await altaUsuario({ correo, socio: 'Javier' });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3100' + (await enlaceConfirmacion(correo, '/pedidos')));
await page.getByTestId('confirmar-acceso').click();
await page.waitForURL('**/pedidos');
const ids = await conDb(async (c) => ({ ped: (await c.query("select id from operacion.pedido order by id")).rows.map((r) => Number(r.id)), oc: (await c.query('select id from operacion.compra order by id')).rows.map((r) => Number(r.id)) }));
console.log(JSON.stringify(ids));
for (const r of rutas) {
  const res = await page.goto('http://127.0.0.1:3100' + r);
  await page.waitForTimeout(400);
  const nombre = r.replace(/[^a-z0-9]+/gi, '_');
  await page.screenshot({ path: `.tmp-check/${nombre}.png`, fullPage: true });
  console.log(r, res?.status(), await page.title());
}
await b.close();
