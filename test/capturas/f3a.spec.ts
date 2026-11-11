// Capturas de F3a: liquidacion con el proveedor, cuenta de socios, estado de cuenta, cascada de reparto, cuenta con Omar y cuentas por cobrar completa.
// Claro y oscuro, 1440x900, 402x874 (iPhone 16 Pro), plegable cerrado 344x882 y abierto 880x860, Chromium y WebKit.
// Datos ILUSTRATIVOS (scripts/capturas/datos-demo-f3a.mjs sobre los fixtures); ningun dato real de ventas, compras ni pagos.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/f3a');
const BASE = 'http://127.0.0.1:3100';

interface Perfil { nombre: string; ancho: number; alto: number; movil: boolean }
const PERFILES: Perfil[] = [
  { nombre: '1440x900', ancho: 1440, alto: 900, movil: false },
  { nombre: '402x874', ancho: 402, alto: 874, movil: true },
  { nombre: '344x882', ancho: 344, alto: 882, movil: true },
  { nombre: '880x860', ancho: 880, alto: 860, movil: true },
];
const TEMAS = ['claro', 'oscuro'] as const;
type Tema = (typeof TEMAS)[number];

function opciones(p: Perfil, tema: Tema, extra: BrowserContextOptions = {}): BrowserContextOptions {
  return {
    viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: p.movil ? 2 : 1, isMobile: p.movil, hasTouch: p.movil,
    colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, ...extra,
  };
}

async function fijar(ctx: Awaited<ReturnType<Browser['newContext']>>, tema: Tema) {
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('rtm-tema', t);
      localStorage.setItem('rtm-acento', 'neutro');
      localStorage.setItem('rtm-movimiento', 'off');
    } catch { /* sin almacenamiento */ }
  }, tema);
}

test('capturas de F3a', async ({ browser, browserName }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correo = correoUnico(`f3a-${browserName}`);
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/socios')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/socios`);
  const estado = await entrada.storageState();
  await entrada.close();

  async function tomar(p: Perfil, tema: Tema, nombre: string, ruta: string, preparar?: (page: Page) => Promise<void>) {
    const ctx = await browser.newContext(opciones(p, tema, { storageState: estado }));
    await fijar(ctx, tema);
    const page = await ctx.newPage();
    await page.goto(`${BASE}${ruta}`);
    await page.evaluate(() => document.fonts.ready);
    if (preparar) await preparar(page);
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SALIDA, `${browserName}-${p.nombre}-${tema}-${nombre}.png`), fullPage: false });
    await ctx.close();
  }
  const desplazar = (selector: string) => async (page: Page) => { await page.locator(selector).first().scrollIntoViewIfNeeded(); };
  const abrirDialogo = (testid: string) => async (page: Page) => { await page.getByTestId(testid).first().click(); await page.getByRole('dialog').waitFor(); };
  const abrirExplicar = (selector: string) => async (page: Page) => { await page.locator(selector).first().getByRole('button').first().click(); await page.getByTestId('explicar-cajon').waitFor(); };

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'proveedor-liquidacion-isaac', '/proveedores/liquidacion?p=Isaac&ambito=todo');
      await tomar(p, tema, 'proveedor-liquidacion-hoja', '/proveedores/liquidacion?p=Isaac&ambito=todo', desplazar('[aria-label="Nota por pedido a costo"]'));
      await tomar(p, tema, 'proveedor-liquidacion-karen', '/proveedores/liquidacion?p=Karen');
      await tomar(p, tema, 'proveedor-explicar-falta', '/proveedores/liquidacion?p=Isaac&ambito=todo', abrirExplicar('[data-testid=falta-por-saldar]'));
      await tomar(p, tema, 'proveedor-dialogo-dicho', '/proveedores/liquidacion?p=Isaac&ambito=todo', abrirDialogo('registrar-dicho'));
      await tomar(p, tema, 'proveedor-cuenta-con-ajuste', '/proveedores?p=Isaac');
      await tomar(p, tema, 'socios-cuenta', '/socios');
      await tomar(p, tema, 'socios-libro', '/socios', desplazar('[aria-label="Libro de movimientos entre socios"]'));
      await tomar(p, tema, 'socios-dialogo-aportacion', '/socios', abrirDialogo('aportacion'));
      await tomar(p, tema, 'socios-explicar-diferencia', '/socios', abrirExplicar('[data-testid=diferencia-socios]'));
      await tomar(p, tema, 'socio-estado-de-cuenta', '/socios/Angelo');
      await tomar(p, tema, 'cascada-en-vivo', '/socios/cascada');
      await tomar(p, tema, 'cascada-pasos-3-a-5', '/socios/cascada', desplazar('[aria-label="Paso 4: resultado por socio"]'));
      await tomar(p, tema, 'cascada-cierre-propuesto', '/socios/cascada', desplazar('[aria-label="Cierre del periodo"]'));
      await tomar(p, tema, 'omar-cuenta', '/omar');
      await tomar(p, tema, 'omar-pendientes-y-movimientos', '/omar', desplazar('[aria-label="Pendientes de autorización"]'));
      await tomar(p, tema, 'omar-dialogo-toma', '/omar', abrirDialogo('nueva-toma'));
      await tomar(p, tema, 'cxc-completa', '/cuentas-por-cobrar');
      await tomar(p, tema, 'cxc-concentracion', '/cuentas-por-cobrar', desplazar('[aria-label="Concentración por cliente"]'));
      await tomar(p, tema, 'cxc-dialogo-recargo', '/cuentas-por-cobrar', async (page) => { const b = page.getByRole('button', { name: 'Registrar recargo' }).first(); await b.click(); await page.getByRole('dialog').waitFor(); });
    }
  }

  const todas = readdirSync(SALIDA).filter((f) => f.endsWith('.png')).sort();
  const filas = todas.map((f) => {
    const [navegador, perfil, tema, ...resto] = f.replace('.png', '').split('-');
    const bytes = statSync(join(SALIDA, f)).size;
    const sha = createHash('sha256').update(readFileSync(join(SALIDA, f))).digest('hex').slice(0, 12);
    return `| ${f} | ${navegador} | ${perfil} | ${tema} | ${resto.join('-')} | ${(bytes / 1024).toFixed(0)} KB | ${sha} |`;
  });
  writeFileSync(
    join(SALIDA, 'manifest.md'),
    [
      '# Capturas de F3a',
      '',
      'Generadas con `npm run capturas:f3a`: base local reiniciada, fixtures ILUSTRATIVOS y datos inventados de F1, F2 y F3a (ningun dato real de ventas, compras ni pagos) y Playwright contra un servidor de produccion local.',
      '',
      '- Escritorio 1440x900 (escala 1); telefono 402x874 (iPhone 16 Pro, escala 2); plegable cerrado 344x882 y abierto 880x860 (escala 2); con `isMobile` y toque en los tres moviles.',
      '- Temas claro y oscuro; acento neutro estricto; movimiento apagado para que la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Pantallas: liquidacion con Isaac (hero con comprobacion, hoja de tres bloques, conciliacion y dialogo de lo que dice el proveedor), liquidacion con Karen, cajon "Explicar este numero" de la falta por saldar, cuenta con el proveedor y su ajuste; cuenta de socios (diferencia, libro, dialogo de aportacion, cajon de la diferencia), estado de cuenta por socio; cascada de reparto en vivo, pasos 3 a 5 y cierre propuesto; cuenta con Omar (neto, pendientes de autorizacion, movimientos, dialogo de toma); cuentas por cobrar completa (plazo, recargo, concentracion por cliente, dialogo de recargo).',
      '',
      '| Archivo | Navegador | Perfil | Tema | Pantalla | Peso | sha256 (12) |',
      '|---|---|---|---|---|---|---|',
      ...filas,
      '',
      `Total: ${todas.length} capturas.`,
      '',
    ].join('\n'),
  );
});
