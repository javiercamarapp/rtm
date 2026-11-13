// Lee el texto visible de rutas con una sesion guardada. Uso: node leer.mjs <sesion.json> <puerto> <ruta> [<ruta>...] ; MAXC=chars
import { chromium } from '@playwright/test';
const [ss, puerto, ...rutas] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: ss, baseURL: `http://127.0.0.1:${puerto}`, viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
for (const r of rutas) {
  await p.goto(r, { waitUntil: 'networkidle' }).catch(() => {});
  await p.waitForTimeout(900);
  const t = await p.evaluate(() => (document.querySelector('main')?.innerText ?? document.body.innerText));
  console.log(`#### ${r} -> ${new URL(p.url()).pathname}\n${t.replace(/\n{2,}/g, '\n').slice(0, Number(process.env.MAXC ?? 2500))}`);
}
await b.close();
