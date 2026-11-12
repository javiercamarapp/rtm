// Capturas del lote A3 (cuentas por cobrar, proveedores, socios, Omar y contabilidad) con datos ILUSTRATIVOS del Supabase local propio.
// 1440x900 y 390x844, claro y oscuro, pagina completa. Reporta si hay scroll horizontal de pagina en movil.
import { test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/rediseno-a3');
const BASE = 'http://127.0.0.1:3103';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 900, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

function opciones(p: (typeof PERFILES)[number], tema: (typeof TEMAS)[number], extra: BrowserContextOptions = {}): BrowserContextOptions {
  return { viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: p.movil ? 2 : 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, ...extra };
}

test('capturas A3', async ({ browser }: { browser: Browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const compra = await conDb(async (c) => (await c.query('select id from operacion.compra order by id limit 1')).rows[0]?.id as number | undefined);
  const correo = correoUnico('a3');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/socios')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/socios`);
  const estado = await entrada.storageState();
  await entrada.close();

  const rutas: [string, string][] = [
    ['cxc', '/cuentas-por-cobrar'], ['cxc-clientes', '/cuentas-por-cobrar?vista=cliente'], ['cxc-socios', '/cuentas-por-cobrar?vista=socios'],
    ['proveedores', '/proveedores?p=Isaac'], ['proveedores-hoja', '/proveedores?p=Isaac&vista=hoja'], ['proveedores-karen', '/proveedores?p=Karen'],
    ['liquidacion', '/proveedores/liquidacion?p=Isaac&ambito=todo'],
    ...(compra ? [['compra', `/proveedores/compras/${compra}`] as [string, string]] : []),
    ['socios', '/socios'], ['socio-angelo', '/socios/Angelo'], ['cascada', '/socios/cascada'], ['omar', '/omar'],
    ['conta-valuacion', '/contabilidad'], ['conta-diario', '/contabilidad/diario'], ['conta-mayor', '/contabilidad/mayor'], ['conta-mayor-cuenta', '/contabilidad/mayor?cuenta=1310'],
    ['conta-resultados', '/contabilidad/estado-de-resultados'], ['conta-balance', '/contabilidad/balance'], ['conta-flujo', '/contabilidad/flujo'],
    ['conta-comprobaciones', '/contabilidad/comprobaciones'], ['conta-proyecciones', '/contabilidad/proyecciones'],
  ];
  const filtro = process.env.A3_SOLO ? new RegExp(process.env.A3_SOLO) : null;
  const avisos: string[] = [];
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      const ctx = await browser.newContext(opciones(p, tema, { storageState: estado }));
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      for (const [nombre, ruta] of rutas) {
        if (filtro && !filtro.test(nombre)) continue;
        const page = await ctx.newPage();
        const errores: string[] = [];
        page.on('pageerror', (e) => errores.push(String(e.message)));
        await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const extra = await page.evaluate(() => {
          let mejor = 0;
          for (const el of document.querySelectorAll<HTMLElement>('*')) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 20) mejor = Math.max(mejor, el.scrollHeight - el.clientHeight);
          }
          return mejor;
        });
        if (extra > 0) { await page.setViewportSize({ width: p.ancho, height: Math.min(p.alto + extra + 8, 9000) }); await page.waitForTimeout(500); }
        const desborda = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (p.movil && desborda > 1) avisos.push(`${nombre} ${tema}: scroll horizontal de pagina (+${desborda}px)`);
        if (errores.length) avisos.push(`${nombre} ${p.nombre} ${tema}: ${errores.join(' | ')}`);
        await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}.png`), fullPage: true });
        await page.close();
      }
      await ctx.close();
    }
  }
  writeFileSync(join(SALIDA, 'avisos.txt'), avisos.join('\n') + '\n');
  const todas = readdirSync(SALIDA).filter((f) => f.endsWith('.png')).sort();
  const filas = todas.map((f) => {
    const [perfil, tema, ...resto] = f.replace('.png', '').split('-');
    return `| ${f} | ${perfil} | ${tema} | ${resto.join('-')} | ${(statSync(join(SALIDA, f)).size / 1024).toFixed(0)} KB | ${createHash('sha256').update(readFileSync(join(SALIDA, f))).digest('hex').slice(0, 12)} |`;
  });
  writeFileSync(join(SALIDA, 'manifest.md'), ['# Capturas del lote A3 (rediseno etapa 2)', '', 'Chromium, pagina completa, claro y oscuro, 1440x900 y 390x844, datos ILUSTRATIVOS del Supabase local (fixtures y demos de F1 a F3b). Sin datos reales.', '', '| Archivo | Ancho | Tema | Pagina | Peso | SHA-256 (12) |', '|---|---|---|---|---|---|', ...filas, ''].join('\n'));
});
