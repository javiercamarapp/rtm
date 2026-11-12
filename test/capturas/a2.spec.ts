// Capturas de la etapa 2 (A2): inventario, kardex consolidado y por sabor, marcas, antiguedad, mermas, valuacion, historial, caja y libro.
// Claro y oscuro, 1440 y 390 de ancho con ventana alta (el contenido se desplaza dentro del armazon). Datos ILUSTRATIVOS (scripts/capturas/datos-demo-a2.mjs); ningun dato real.
import { test, type BrowserContextOptions } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/rediseno-a2');
const BASE = 'http://127.0.0.1:3102';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 2000, movil: false }, { nombre: '390', ancho: 390, alto: 3400, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;
const RUTAS: [string, string][] = [
  ['inventario', '/inventario'], ['inventario-por-reponer', '/inventario?estado=reponer'], ['kardex', '/inventario/kardex'], ['kardex-modelo', '/inventario/kardex?modelo=MODELO'],
  ['kardex-sabor', '/inventario/kardex/sabor'], ['marcas', '/inventario/marcas'], ['antiguedad', '/inventario/antiguedad'], ['mermas', '/inventario/mermas'],
  ['valuacion', '/contabilidad/valuacion'], ['valuacion-historial', '/contabilidad/valuacion/historial'], ['caja', '/contabilidad/caja'], ['libro', '/movimientos/libro'],
  ['conteo', '/inventario/conteo'],
];

test('capturas de A2', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correo = correoUnico('a2');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/inventario')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/inventario`);
  const estado = await entrada.storageState();
  const modeloId = await p0.request.get(`${BASE}/inventario`).then(async (r) => /kardex\?modelo=(\d+)/.exec(await r.text())?.[1] ?? '1');
  await entrada.close();
  for (const p of PERFILES.filter((x) => !process.env.A2_PERFIL || x.nombre.startsWith(process.env.A2_PERFIL))) {
    for (const tema of TEMAS.filter((x) => !process.env.A2_TEMA || x === process.env.A2_TEMA)) {
      const op: BrowserContextOptions = { viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado };
      const ctx = await browser.newContext(op);
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      for (const [nombre, ruta] of RUTAS.filter(([n]) => !process.env.A2_SOLO || new RegExp(process.env.A2_SOLO).test(n))) {
        const page = await ctx.newPage();
        await page.goto(`${BASE}${ruta.replace('MODELO', modeloId)}`, { waitUntil: 'networkidle', timeout: 180_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
        await page.waitForTimeout(400);
        const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}${ancho > 1 ? '-SCROLLH' : ''}.png`), fullPage: false });
        await page.close();
      }
      await ctx.close();
    }
  }
  const todas = readdirSync(SALIDA).filter((f) => f.endsWith('.png')).sort();
  const filas = todas.map((f) => { const [perfil, tema, ...resto] = f.replace('.png', '').split('-'); return `| ${f} | ${perfil} | ${tema} | ${resto.join('-')} | ${(statSync(join(SALIDA, f)).size / 1024).toFixed(0)} KB | ${createHash('sha256').update(readFileSync(join(SALIDA, f))).digest('hex').slice(0, 12)} |`; });
  writeFileSync(join(SALIDA, 'manifest.md'), ['# Capturas de la etapa 2 (A2)', '', 'Chromium, claro y oscuro, 1440 y 390 de ancho con ventana alta (el contenido se desplaza dentro del armazon). Datos ilustrativos (datos-demo-a2.mjs). Un sufijo SCROLLH en el nombre marca scroll horizontal de pagina (debe ser ninguno).', '', '| Archivo | Perfil | Tema | Pagina | Tamano | Huella |', '|---|---|---|---|---|---|', ...filas, ''].join('\n'));
});
