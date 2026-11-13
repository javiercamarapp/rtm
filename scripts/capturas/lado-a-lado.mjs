// Une las muestras PNG de la carpeta `vieja` y `nueva` en comparativas lado a lado: node scripts/capturas/lado-a-lado.mjs docs/capturas/geist-muestras
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const raiz = resolve(process.argv[2]);
const nuevos = readdirSync(join(raiz, 'nueva')).filter((f) => f.endsWith('.png')).sort();
const b64 = (r) => `data:image/png;base64,${readFileSync(r).toString('base64')}`;
const nav = await chromium.launch();
for (const f of nuevos) {
  const v = join(raiz, 'vieja', f);
  if (!existsSync(v)) continue;
  const pag = await nav.newPage({ viewport: { width: 1400, height: 900 } });
  await pag.setContent(`<body style="margin:0;background:#888;font:14px sans-serif"><div style="display:flex;gap:12px;padding:12px;width:max-content">
    <figure style="margin:0"><figcaption style="color:#fff;padding:0 0 4px">Fuente vieja (Figtree / EB Garamond)</figcaption><img style="display:block" src="${b64(v)}"></figure>
    <figure style="margin:0"><figcaption style="color:#fff;padding:0 0 4px">Geist</figcaption><img style="display:block" src="${b64(join(raiz, 'nueva', f))}"></figure></div></body>`);
  await pag.screenshot({ path: join(raiz, `lado-a-lado-${f}`), fullPage: true });
  await pag.close();
}
await nav.close();
