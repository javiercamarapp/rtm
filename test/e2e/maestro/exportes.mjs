// Descarga exportes (CSV/PDF) con la sesion del socio y comprueba estado, tipo, firma PDF y tamano. Uso: node exportes.mjs <sesion.json> <puerto> <ruta>...
import { chromium } from '@playwright/test';
const [ss, puerto, ...rutas] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: ss, baseURL: `http://127.0.0.1:${puerto}` });
for (const r of rutas) {
  const t0 = Date.now();
  const res = await ctx.request.get(r, { maxRedirects: 0 }).catch((e) => ({ status: () => 0, headers: () => ({}), body: async () => Buffer.alloc(0), err: e }));
  const body = await res.body();
  const ct = res.headers()['content-type'] ?? '';
  const pdf = body.subarray(0, 5).toString() === '%PDF-';
  const lineas = /csv|text/.test(ct) ? body.toString().split('\n').length : '';
  console.log(`${res.status()} ${r} | ${ct.split(';')[0]} | ${body.length} bytes | ${pdf ? 'PDF valido' : ''}${lineas ? lineas + ' lineas' : ''} | ${Date.now() - t0} ms | disp=${(res.headers()['content-disposition'] ?? '').slice(0, 50)}`);
}
await b.close();
