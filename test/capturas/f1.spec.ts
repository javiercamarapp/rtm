// Capturas de F1: Catalogo y precios, Clientes, ficha de cliente, Inventario, "Explicar este numero", ConfirmDialog y /auth/confirm.
// Claro y oscuro, 1440x900 y 402x874 (iPhone 16 Pro), Chromium y WebKit. Datos ILUSTRATIVOS (fixtures); ver scripts/capturas/capturas-f1.mjs.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/f1');
const BASE = 'http://127.0.0.1:3100';

interface Perfil { nombre: string; ancho: number; alto: number; movil: boolean }
const PERFILES: Perfil[] = [
  { nombre: '1440x900', ancho: 1440, alto: 900, movil: false },
  { nombre: '402x874', ancho: 402, alto: 874, movil: true },
];
const TEMAS = ['claro', 'oscuro'] as const;
type Tema = (typeof TEMAS)[number];

function opciones(p: Perfil, tema: Tema, extra: BrowserContextOptions = {}): BrowserContextOptions {
  return {
    viewport: { width: p.ancho, height: p.alto },
    deviceScaleFactor: p.movil ? 2 : 1,
    isMobile: p.movil,
    hasTouch: p.movil,
    colorScheme: tema === 'oscuro' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() },
    ...extra,
  };
}

async function fijar(ctx: Awaited<ReturnType<Browser['newContext']>>, tema: Tema) {
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('rtm-tema', t);
      localStorage.setItem('rtm-acento', 'neutro'); // acento NEUTRO ESTRICTO por defecto
      localStorage.setItem('rtm-movimiento', 'off');
    } catch { /* sin almacenamiento */ }
  }, tema);
}

test('capturas de F1', async ({ browser, browserName }) => {
  mkdirSync(SALIDA, { recursive: true });
  const ids = await conDb(async (c) => {
    const cli = await c.query("select id from catalogo.cliente where nombre_canonico = 'Cliente Costa'");
    const mod = await c.query("select id from catalogo.modelo where nombre_canonico = 'Alfa Uno 50K'");
    return { cliente: Number(cli.rows[0].id), modelo: Number(mod.rows[0].id) };
  });

  // Sesion por el plan alterno (token_hash + boton), una por navegador.
  const correo = correoUnico(`f1-${browserName}`);
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/catalogo')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/catalogo`);
  const estado = await entrada.storageState();
  await entrada.close();

  async function tomar(p: Perfil, tema: Tema, nombre: string, ruta: string, preparar?: (page: Page) => Promise<void>, conSesion = true) {
    const ctx = await browser.newContext(opciones(p, tema, conSesion ? { storageState: estado } : {}));
    await fijar(ctx, tema);
    const page = await ctx.newPage();
    await page.goto(`${BASE}${ruta}`);
    await page.evaluate(() => document.fonts.ready);
    if (preparar) await preparar(page);
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(SALIDA, `${browserName}-${p.nombre}-${tema}-${nombre}.png`), fullPage: false });
    await ctx.close();
  }

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'catalogo-y-precios', `/catalogo?modelo=${ids.modelo}`);
      await tomar(p, tema, 'clientes', '/clientes');
      await tomar(p, tema, 'ficha-de-cliente', `/clientes/${ids.cliente}`);
      await tomar(p, tema, 'inventario', '/inventario');
      await tomar(p, tema, 'explicar-existencia', '/inventario', async (page) => {
        await page.getByRole('button', { name: /Explicar este número/ }).first().click();
        await page.getByTestId('explicar-cajon').waitFor();
      });
      await tomar(p, tema, 'explicar-margen', `/clientes/${ids.cliente}`, async (page) => {
        await page.getByRole('table', { name: /Tabulador/ }).getByRole('button', { name: /Explicar este número/ }).first().click();
        await page.getByTestId('explicar-cajon').waitFor();
      });
      await tomar(p, tema, 'dialogo-de-confirmacion', '/catalogo', async (page) => {
        await page.getByRole('button', { name: /Marcar sin disponibilidad: Alfa Uno 50K/ }).click();
        await page.getByRole('dialog').waitFor();
      });
      await tomar(p, tema, 'auth-confirm', `/auth/confirm?token_hash=ejemplo_de_captura&type=magiclink&next=%2Fcatalogo`, undefined, false);
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
      '# Capturas de F1',
      '',
      'Generadas con `npm run capturas:f1`: base local reiniciada, fixtures ILUSTRATIVOS (Cliente Alfa, Alfa Uno 50K, etc.; ningun dato real) y Playwright contra un servidor de produccion local.',
      '',
      '- Escritorio 1440x900 a escala 1; telefono 402x874 (iPhone 16 Pro) con `isMobile` y toque, escala 2.',
      '- Temas claro y oscuro; acento neutro estricto (por omision); movimiento apagado para que la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Pantallas: Catalogo y precios (con el detalle de un modelo), Clientes, Ficha de cliente (tabulador, margenes, historial y linea de precio), Inventario (existencia por modelo y sabor, Sin dato donde no hay movimientos), cajon "Explicar este numero" (existencia y margen), dialogo de confirmacion propio y /auth/confirm.',
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
