// Recorrido MAESTRO: visita cada ruta del rol con su sesion guardada (storageState) y mide: HTTP, consola/hydration, peticiones fallidas, scroll horizontal,
// texto cortado, emojis, nombres accesibles, foco visible, contraste, contadores animados, tiempos de carga y graficas. Escribe un JSONL por corrida.
// Variables: MAESTRO_SS (carpeta de sesiones), MAESTRO_OUT (carpeta de salida), MAESTRO_ROL (socio_a|socio_b|omar|bodega), MAESTRO_RUTAS (archivo JSON con rutas).
import { test } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { camposChicos, contrasteDeTextos, fijarTema, huecosMuertos, objetivosDe44, vigilarErrores } from '../punta_a_punta_ayudas';

const SS = process.env.MAESTRO_SS!;
const OUT = process.env.MAESTRO_OUT!;
const ROL = process.env.MAESTRO_ROL ?? 'socio_a';
const RUTAS: { id: string; ruta: string }[] = JSON.parse(readFileSync(process.env.MAESTRO_RUTAS!, 'utf8'));
const TEMAS = (process.env.MAESTRO_TEMAS ?? 'claro,oscuro').split(',') as ('claro' | 'oscuro')[];

test.use({ storageState: `${SS}/${ROL}.json` });
test.describe.configure({ mode: 'serial' });
test.setTimeout(3_000_000);

const EMOJI = /\p{Extended_Pictographic}/u;

for (const tema of TEMAS) {
  test(`recorrido ${ROL} ${tema}`, async ({ page }, info) => {
    const vp = `${page.viewportSize()?.width}`;
    const base = `${OUT}/${ROL}-${tema}-${vp}`;
    mkdirSync(`${OUT}/cap`, { recursive: true });
    const archivo = `${base}.jsonl`;
    await fijarTema(page, tema);
    for (const r of RUTAS) {
      const res: Record<string, unknown> = { id: r.id, ruta: r.ruta, rol: ROL, tema, vp };
      const vigia = vigilarErrores(page);
      const falladas: string[] = [];
      const onResp = (resp: import('@playwright/test').Response) => {
        const s = resp.status();
        const u = new URL(resp.url());
        if (s >= 400 && !/\/_next\/static\//.test(u.pathname)) falladas.push(`${s} ${u.pathname}`);
      };
      const onReqFail = (req: import('@playwright/test').Request) => {
        const f = req.failure()?.errorText ?? '';
        if (!/ERR_ABORTED/.test(f)) falladas.push(`FAIL ${new URL(req.url()).pathname} ${f}`);
      };
      page.on('response', onResp);
      page.on('requestfailed', onReqFail);
      const t0 = Date.now();
      try {
        const resp = await page.goto(r.ruta, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        res.http = resp?.status() ?? 0;
        res.url_final = new URL(page.url()).pathname;
        res.ms_dcl = Date.now() - t0;
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
        res.ms_idle = Date.now() - t0;
        await page.waitForTimeout(900); // contadores y graficas terminan su animacion (600 ms)
        res.tema_ok = (await page.locator('html').getAttribute('data-tema')) === tema;
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const body = document.body;
          const txt = body.innerText ?? '';
          const visible = (e: Element) => {
            const cs = getComputedStyle(e);
            const b = e.getBoundingClientRect();
            return cs.visibility !== 'hidden' && cs.display !== 'none' && b.width > 0 && b.height > 0;
          };
          // texto cortado: overflow oculto con contenido mas ancho, sin puntos suspensivos
          const cortados: string[] = [];
          for (const e of Array.from(document.querySelectorAll('main *, aside *, header *'))) {
            if (cortados.length >= 6) break;
            const he = e as HTMLElement;
            if (!visible(he) || !he.childNodes.length) continue;
            const cs = getComputedStyle(he);
            const tieneTexto = Array.from(he.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1);
            if (!tieneTexto) continue;
            if (he.scrollWidth > he.clientWidth + 2 && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis' && he.clientWidth > 0) {
              cortados.push(`${he.tagName.toLowerCase()}.${String(he.className).slice(0, 40)} "${(he.textContent ?? '').trim().slice(0, 30)}"`);
            }
          }
          // elementos fuera del ancho de pantalla (no dentro de un contenedor con scroll propio)
          const fuera: string[] = [];
          const enScroll = (e: Element) => {
            for (let p = e.parentElement; p; p = p.parentElement) {
              const cs = getComputedStyle(p);
              if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) return true;
            }
            return false;
          };
          for (const e of Array.from(document.querySelectorAll('main *'))) {
            if (fuera.length >= 6) break;
            if (!visible(e)) continue;
            const b = e.getBoundingClientRect();
            if ((b.right > vw + 1 || b.left < -1) && !enScroll(e)) fuera.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 40)} r=${Math.round(b.right)}`);
          }
          const sinNombre: string[] = [];
          for (const e of Array.from(document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]'))) {
            if (sinNombre.length >= 8) break;
            if (!visible(e)) continue;
            const he = e as HTMLElement;
            const nombre = (he.getAttribute('aria-label') ?? '') || (he.getAttribute('title') ?? '') || (he.textContent ?? '').trim() || (he as HTMLInputElement).placeholder || '';
            const lbl = he.id ? document.querySelector(`label[for="${he.id}"]`) : null;
            const lblby = he.getAttribute('aria-labelledby');
            const envuelto = he.closest('label');
            if (!nombre && !lbl && !lblby && !envuelto && !he.querySelector('img[alt]:not([alt=""]), svg title')) sinNombre.push(`${he.tagName.toLowerCase()}${he.className ? '.' + String(he.className).slice(0, 30) : ''}`);
          }
          const sinAlt = Array.from(document.querySelectorAll('img')).filter((i) => !i.hasAttribute('alt')).length;
          const contadores = Array.from(document.querySelectorAll('.rtm-g-contador')).map((c) => {
            const a = (c.querySelector('[aria-hidden]')?.textContent ?? '').trim();
            const f = (c.querySelector('.rtm-solo-lectores')?.textContent ?? '').trim();
            return { a, f };
          });
          const malContador = contadores.filter((c) => c.a !== c.f).slice(0, 4);
          const svgs = Array.from(document.querySelectorAll('main svg')).filter((s) => visible(s) && s.getBoundingClientRect().width > 80);
          const graficasVacias = svgs.filter((s) => s.querySelectorAll('path, rect, circle, line, polyline').length < 3).length;
          const titulo = (document.querySelector('main h1')?.textContent ?? '').trim().slice(0, 60);
          const palabras = ['undefined', 'NaN', '[object Object]', 'null'].filter((w) => new RegExp(`(^|[^A-Za-z])${w.replace(/[[\]]/g, '\\$&')}([^A-Za-z]|$)`).test(txt));
          return {
            scrollH: document.documentElement.scrollWidth > vw + 1, scrollW: document.documentElement.scrollWidth, vw,
            emojis: Array.from(txt.matchAll(/\p{Extended_Pictographic}/gu)).map((x) => x[0]).slice(0, 5),
            cortados, fuera, sinNombre, sinAlt, nContadores: contadores.length, malContador, nGraficas: svgs.length, graficasVacias, titulo,
            palabras, nChars: txt.length, mainOk: !!document.querySelector('main'),
          };
        });
        Object.assign(res, m);
        // foco visible: Tab una vez y revisar contorno o sombra del elemento activo
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        res.foco = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          if (!a || a === document.body) return 'sin_foco';
          const cs = getComputedStyle(a);
          const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
          return visible ? 'ok' : `sin_indicador:${a.tagName.toLowerCase()}.${String(a.className).slice(0, 30)}`;
        });
        res.contraste = (await contrasteDeTextos(page)).slice(0, 4).map((c) => `${c.texto.slice(0, 20)} ${c.razon.toFixed(2)}<${c.minimo} ${c.fg}/${c.bg}`);
        if (Number(page.viewportSize()?.width) < 1024) {
          res.camposChicos = (await camposChicos(page)).slice(0, 4);
          res.objetivos44 = (await objetivosDe44(page)).slice(0, 5);
        }
        res.huecos = (await huecosMuertos(page).catch(() => [])).slice(0, 3);
        const texto = (await page.locator('body').innerText()).slice(0, 4000);
        res.esVacio = /sin dato|sin datos|aun no hay|todavia no|no hay /i.test(texto);
        await page.screenshot({ path: `${OUT}/cap/${ROL}-${tema}-${vp}-${r.id}.png`, fullPage: true }).catch(() => undefined);
      } catch (e) {
        res.excepcion = String((e as Error).message).slice(0, 200);
      }
      page.off('response', onResp);
      page.off('requestfailed', onReqFail);
      res.errores = vigia.errores.slice(0, 5).map((x) => x.slice(0, 220));
      res.hidratacion = vigia.errores.some((x) => /418|hydrat/i.test(x));
      res.falladas = falladas.slice(0, 6);
      appendFileSync(archivo, `${JSON.stringify(res)}\n`);
      info.annotations.push({ type: 'ruta', description: String(r.id) });
    }
  });
}
