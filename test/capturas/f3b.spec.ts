// Capturas de F3b (asientos contables): valuacion, diario con verificacion, mayor, estado de resultados, balance, flujo, comprobaciones con periodos y proyecciones.
// Claro y oscuro, 1440x900, 402x874 (iPhone 16 Pro), plegable cerrado 344x882 y abierto 880x860, Chromium y WebKit.
// Datos ILUSTRATIVOS (scripts/capturas/datos-demo-f3b.mjs sobre los fixtures); ningun dato real de ventas, compras ni pagos.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/f3b-asientos');
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

test('capturas de F3b', async ({ browser, browserName }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correo = correoUnico(`f3b-${browserName}`);
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/contabilidad')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/contabilidad`);
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
  const abrirExplicar = (selector: string) => async (page: Page) => { await page.locator(selector).first().getByRole('button').first().click(); await page.getByTestId('explicar-cajon').waitFor(); };

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'valuacion', '/contabilidad');
      await tomar(p, tema, 'valuacion-explicar-diferencia', '/contabilidad', abrirExplicar('[data-testid=v03]'));
      await tomar(p, tema, 'diario', '/contabilidad/diario');
      await tomar(p, tema, 'diario-asiento-verificado', '/contabilidad/diario', async (page) => {
        const a = page.locator('[data-testid^="asiento-A-"]').first();
        await a.getByRole('button', { name: 'Verificar' }).click();
        await a.locator('[data-testid^="verificacion-"]').waitFor();
        await a.scrollIntoViewIfNeeded();
      });
      await tomar(p, tema, 'mayor-cuentas', '/contabilidad/mayor');
      await tomar(p, tema, 'mayor-inventario', '/contabilidad/mayor?cuenta=1310');
      await tomar(p, tema, 'mayor-explicar-saldo', '/contabilidad/mayor?cuenta=1310', async (page) => { await page.getByRole('main').getByRole('button', { name: /Explicar este número/ }).first().click(); await page.getByTestId('explicar-cajon').waitFor(); });
      await tomar(p, tema, 'estado-de-resultados', '/contabilidad/estado-de-resultados?ini=2026-11-01&fin=2026-11-30');
      await tomar(p, tema, 'estado-de-resultados-utilidad-neta', '/contabilidad/estado-de-resultados?ini=2026-11-01&fin=2026-11-30', abrirExplicar('[data-testid=utilidad-neta]'));
      await tomar(p, tema, 'balance-general', '/contabilidad/balance');
      await tomar(p, tema, 'flujo-de-efectivo', '/contabilidad/flujo?ini=2026-11-01&fin=2026-11-30');
      await tomar(p, tema, 'comprobaciones', '/contabilidad/comprobaciones');
      await tomar(p, tema, 'comprobaciones-periodos', '/contabilidad/comprobaciones', desplazar('[aria-label="Periodos"]'));
      await tomar(p, tema, 'proyecciones', '/contabilidad/proyecciones');
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
      '# Capturas de F3b (asientos contables)',
      '',
      'Generadas con `npm run capturas:f3b`: base local reiniciada, fixtures ILUSTRATIVOS y datos inventados de F1, F2, F3a y F3b (ningun dato real de ventas, compras ni pagos) y Playwright contra un servidor de produccion local.',
      '',
      '- Escritorio 1440x900 (escala 1); telefono 402x874 (iPhone 16 Pro, escala 2); plegable cerrado 344x882 y abierto 880x860 (escala 2); con `isMobile` y toque en los tres moviles.',
      '- Temas claro y oscuro; acento neutro estricto; movimiento apagado para que la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Pantallas: valuacion con liquidez e identidades I-1 e I-2 y el cajon de la diferencia; diario con el boton Verificar (cuadre, determinismo, cadena de hash y saldos); mayor por cuenta con saldo corrido y el cajon de un saldo; estado de resultados con las tres utilidades y su cajon; balance general; flujo de efectivo directo e indirecto; comprobaciones C1 a C22 con auxiliares y periodos (preparado, aprobado y ajuste del periodo afectado); proyecciones sin dato.',
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
