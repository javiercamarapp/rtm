// Capturas de F3b-2: inicio, inventario con semaforo de cobertura, exportar PDF, kardex, conteo, avisos y campana, paquetes por hacer y en trayecto.
// Claro y oscuro, 1440x900, 402x874 (iPhone 16 Pro), plegable cerrado 344x882 y abierto 880x860, Chromium y WebKit.
// Datos ILUSTRATIVOS (scripts/capturas/datos-demo-f3b-inventario.mjs sobre los fixtures); ningun dato real de ventas, compras ni pagos.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/f3b-inventario');
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

test('capturas de F3b-2 (inventario)', async ({ browser, browserName }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correo = correoUnico(`f3bi-${browserName}`);
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/inventario')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/inventario`);
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

  const abrirCampana = async (page: Page) => { await page.getByTestId('campana').click(); await page.getByTestId('campana-panel').waitFor(); };
  const exportar = (version: 'clientes' | 'interna') => async (page: Page) => {
    await page.getByTestId('exportar-abrir').click();
    await page.getByTestId('exportar-version').selectOption(version);
    await page.getByTestId('exportar-generar').click();
    await page.getByTestId('exportar-resultado').waitFor();
    await page.getByTestId('exportar-resultado').scrollIntoViewIfNeeded();
  };
  const llenarConteo = async (page: Page) => {
    const campos = page.locator('[data-testid^="contado-"]');
    const n = Math.min(await campos.count(), 6);
    for (let i = 0; i < n; i += 1) await campos.nth(i).fill(String(i === 1 ? 17 : i === 3 ? 40 : 60 + i));
  };

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'inicio', '/');
      await tomar(p, tema, 'inventario', '/inventario');
      await tomar(p, tema, 'inventario-por-reponer', '/inventario?estado=reponer');
      await tomar(p, tema, 'inventario-explicar-cobertura', '/inventario', async (page) => { await page.locator('[aria-label*="Explicar este número"]').filter({ hasText: / d$/ }).first().click(); await page.getByTestId('explicar-cajon').waitFor(); });
      await tomar(p, tema, 'inventario-grafica-cobertura', '/inventario', desplazar('[aria-label="¿A quién le toca reponer primero?"], figure'));
      await tomar(p, tema, 'inventario-exportar-clientes', '/inventario', exportar('clientes'));
      await tomar(p, tema, 'inventario-exportar-interna', '/inventario', exportar('interna'));
      await tomar(p, tema, 'kardex', '/inventario/kardex');
      await tomar(p, tema, 'conteo-hoja', '/inventario/conteo');
      await tomar(p, tema, 'conteo-diferencias', '/inventario/conteo', async (page) => { await llenarConteo(page); await page.getByTestId('conteo-ver').click(); await page.getByTestId('conteo-revision').waitFor(); });
      await tomar(p, tema, 'avisos-todas', '/avisos?pestana=todas');
      await tomar(p, tema, 'avisos-sin-leer', '/avisos?pestana=sin_leer');
      await tomar(p, tema, 'campana-abierta', '/', abrirCampana);
      await tomar(p, tema, 'paquetes-por-hacer', '/paquetes/por-hacer');
      await tomar(p, tema, 'paquetes-en-trayecto', '/paquetes/en-trayecto');
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
      '# Capturas de F3b-2 (inventario, kardex, conteo, avisos y exportacion)',
      '',
      'Generadas con `npm run capturas:f3b`: base local reiniciada, fixtures ILUSTRATIVOS y datos inventados de F1, F2, F3a y F3b (ningun dato real de ventas, compras ni pagos) y Playwright contra un servidor de produccion local.',
      '',
      '- Escritorio 1440x900 (escala 1); telefono 402x874 (iPhone 16 Pro, escala 2); plegable cerrado 344x882 y abierto 880x860 (escala 2); con `isMobile` y toque en los tres moviles.',
      '- Temas claro y oscuro; acento neutro estricto; movimiento apagado para que la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Pantallas: inicio con pulso y Tu turno; inventario con semaforo de cobertura, graficas y tres cantidades; cajon Explicar este numero de la cobertura; exportar PDF (version clientes e interna) con Compartir; kardex; conteo ciego y su revision de diferencias; avisos Todas y Sin leer; campana abierta; paquetes por hacer y en trayecto.',
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
