// Capturas de Capital por socio (claro y oscuro, 1440 y 390): pagina de capital, cajon "Explicar este numero", Balance y reporte mensual (HTML). Datos ILUSTRATIVOS
// (scripts/capturas/datos-demo-capital.mjs); ningun dato real. El HTML del reporte lo arma scripts/capturas/reporte-capital.mts (CAPITAL_REPORTE_HTML=/ruta).
import { test, type BrowserContextOptions } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/capital');
const BASE = 'http://127.0.0.1:3187';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 2300, movil: false }, { nombre: '390', ancho: 390, alto: 4600, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;
const RANGO = 'desde=2026-10-01&hasta=2026-11-30';

test('capturas de capital por socio', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correo = correoUnico('capcap');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/contabilidad')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/contabilidad`);
  const estado = await entrada.storageState();
  await entrada.close();
  const rutas: [string, string][] = [['capital', `/contabilidad/capital?${RANGO}`], ['balance', '/contabilidad/balance?hasta=2026-11-30']];
  const html = process.env.CAPITAL_REPORTE_HTML && existsSync(process.env.CAPITAL_REPORTE_HTML) ? readFileSync(process.env.CAPITAL_REPORTE_HTML, 'utf8') : null;
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
        if (nombre === 'capital') {
          await page.getByRole('table', { name: 'Fondos de la sociedad en poder de socios' }).getByRole('button', { name: /Explicar este número/ }).first().click();
          await page.getByTestId('explicar-cajon').getByRole('heading', { level: 2 }).waitFor();
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-explicar-fondos.png`), fullPage: false });
        }
        await page.close();
      }
      if (html) {
        const page = await ctx.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForTimeout(300);
        // La pagina de capital del reporte (la 3.a), recortada a su hoja.
        await page.locator('section[aria-label$=": capital"]').screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-reporte-mensual.png`) });
        await page.close();
      }
      await ctx.close();
    }
  }
});
