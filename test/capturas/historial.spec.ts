// Capturas del Historial personal y del acta (claro y oscuro, 1440 y 390). Datos ILUSTRATIVOS (scripts/capturas/datos-demo-historial.mjs); ningun dato real.
import { test, type BrowserContextOptions } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/historial-acta');
const BASE = 'http://127.0.0.1:3184';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 2200, movil: false }, { nombre: '390', ancho: 390, alto: 3800, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

test('capturas del historial y el acta', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correo = correoUnico('histcap');
  await altaUsuario({ correo, socio: 'Angelo' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/socios')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/socios`);
  const estado = await entrada.storageState();
  const html = await p0.request.get(`${BASE}/socios/Angelo/historial`).then((r) => r.text());
  const idActa = /\/socios\/actas\/(\d+)/.exec(html)?.[1] ?? '1';
  await entrada.close();
  const rutas: [string, string][] = [
    ['historial-angelo', '/socios/Angelo/historial'], ['historial-javier', '/socios/Javier/historial'], ['historial-semanas', '/socios/Angelo/historial?vista=semana'],
    ['historial-dias', '/socios/Angelo/historial?vista=dia'], ['acta', `/socios/actas/${idActa}`], ['cascada', '/socios/cascada?ini=2026-10-01&fin=2026-10-31'], ['socios', '/socios'],
  ];
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      const op: BrowserContextOptions = { viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado };
      const ctx = await browser.newContext(op);
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      for (const [nombre, ruta] of rutas) {
        const page = await ctx.newPage();
        await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 180_000 });
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
});
