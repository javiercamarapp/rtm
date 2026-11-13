// "Explicar este numero" por la interfaz: abre cada cifra (button.rtm-cifra) de las pantallas dadas y revisa que el cajon traiga contenido sin error. Uso: node explicar-ui.mjs <sesion> <puerto> <maxPorPagina> <ruta>...
import { chromium } from '@playwright/test';
const [ss, puerto, max, ...rutas] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: ss, baseURL: `http://127.0.0.1:${puerto}`, viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
let total = 0, malos = 0;
for (const r of rutas) {
  await p.goto(r, { waitUntil: 'networkidle' }).catch(() => {}); await p.waitForTimeout(800);
  const claves = await p.evaluate(() => [...new Set([...document.querySelectorAll('button.rtm-cifra[data-cifra]')].map((e) => e.getAttribute('data-cifra')))]);
  const probar = claves.slice(0, Number(max));
  let fallos = [];
  for (const k of probar) {
    total += 1;
    const el = p.locator(`button.rtm-cifra[data-cifra="${k.replace(/"/g, '\\"')}"]`).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(900);
    const txt = await p.evaluate(() => { const d = document.querySelector('[role=dialog], aside.rtm-explicar, .rtm-explicar'); return d ? d.innerText : ''; });
    const malo = !txt || txt.length < 40 || /desconocida|no se pudo|algo fall|error|undefined|NaN/i.test(txt);
    if (malo) { malos += 1; fallos.push(`${k} (${txt.replace(/\s+/g, ' ').slice(0, 70)})`); }
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  }
  console.log(`${r}: ${claves.length} cifras, probadas ${probar.length}, fallos ${fallos.length}${fallos.length ? ' -> ' + fallos.join(' ; ') : ''}`);
}
console.log(`TOTAL ${total} probadas, ${malos} con problema`);
await b.close();
