// Capturas de F0: login y armazon vacio, claro y oscuro, a 1440x900 y a 402x874 (iPhone 16 Pro), en Chromium y WebKit.
// Mas: login a 1280x800 (paridad con Likida) y la vista de acentos neutro | lila lado a lado. Escribe docs/capturas/f0 y su manifest.md.
import { test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, correoUnico, enlaceDe, esperarMensajes, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/f0');
const BASE = 'http://127.0.0.1:3100';

interface Perfil { nombre: string; ancho: number; alto: number; movil: boolean }
const PERFILES: Perfil[] = [
  { nombre: '1440x900', ancho: 1440, alto: 900, movil: false },
  { nombre: '402x874', ancho: 402, alto: 874, movil: true },
];
const TEMAS = ['claro', 'oscuro'] as const;

interface Captura { archivo: string; navegador: string; perfil: string; tema: string; pantalla: string; dpr: number }

function opciones(p: Perfil, tema: (typeof TEMAS)[number], extra: BrowserContextOptions = {}): BrowserContextOptions {
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

async function fijarPreferencias(ctx: Awaited<ReturnType<Browser['newContext']>>, tema: string, acento = 'neutro') {
  await ctx.addInitScript(([t, a]) => {
    try {
      localStorage.setItem('rtm-tema', t!);
      localStorage.setItem('rtm-acento', a!);
      localStorage.setItem('rtm-movimiento', 'off');
    } catch {
      /* sin almacenamiento */
    }
  }, [tema, acento]);
}

test('capturas de F0', async ({ browser, browserName }) => {
  mkdirSync(SALIDA, { recursive: true });
  const hechas: Captura[] = [];

  // Una sesion por navegador, por el enlace magico real del buzon local.
  const correo = correoUnico(`captura-${browserName}`);
  await altaUsuario({ correo, socio: 'Angelo' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(`${BASE}/login`);
  await p0.getByLabel('Tu correo').fill(correo);
  await p0.getByRole('button', { name: 'Continuar con correo' }).click();
  await p0.getByText('Te mandamos un enlace a tu correo.').waitFor();
  await esperarMensajes(correo, 1);
  await p0.goto(await enlaceDe(correo));
  await p0.waitForURL(`${BASE}/`);
  const estado = await entrada.storageState();
  await entrada.close();

  async function tomar(p: Perfil, tema: (typeof TEMAS)[number], pantalla: string, ruta: string, nombreArchivo: string, acento = 'neutro', conSesion = true) {
    const ctx = await browser.newContext(opciones(p, tema, conSesion ? { storageState: estado } : {}));
    await fijarPreferencias(ctx, tema, acento);
    const page = await ctx.newPage();
    await page.goto(`${BASE}${ruta}`);
    await page.evaluate(() => document.fonts.ready);
    if (pantalla === 'login' && p.ancho >= 1024) await page.locator('.login-artwork[data-listo]').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    const archivo = `${browserName}-${p.nombre}-${tema}-${nombreArchivo}.png`;
    await page.screenshot({ path: join(SALIDA, archivo), fullPage: false });
    hechas.push({ archivo, navegador: browserName, perfil: p.nombre, tema, pantalla, dpr: p.movil ? 2 : 1 });
    await ctx.close();
  }

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'login', '/login', 'login', 'neutro', false);
      await tomar(p, tema, 'armazon vacio (Inicio)', '/', 'armazon');
    }
  }
  // Paridad con Likida: el login tambien a 1280x800 (solo Chromium, claro y oscuro).
  if (browserName === 'chromium') {
    for (const tema of TEMAS) await tomar({ nombre: '1280x800', ancho: 1280, alto: 800, movil: false }, tema, 'login', '/login', 'login', 'neutro', false);
  }
  // Los dos acentos lado a lado (primer entregable de pantallas) y el armazon con acento lila.
  for (const tema of TEMAS) {
    await tomar(PERFILES[0]!, tema, 'acentos neutro | lila lado a lado', '/diseno', 'acentos-lado-a-lado');
    await tomar(PERFILES[0]!, tema, 'armazon vacio con acento lila', '/', 'armazon-lila', 'lila');
  }

  // Manifest (se acumula entre navegadores: se reescribe leyendo lo que haya en la carpeta).
  const { readdirSync } = await import('node:fs');
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
      '# Capturas de F0',
      '',
      'Generadas con `npm run capturas` contra el Supabase local (enlace magico real por Mailpit) y un servidor local de produccion. Datos: ninguno (estados vacios).',
      '',
      '- Escritorio: 1440x900 a escala 1 (y el login tambien a 1280x800, solo Chromium).',
      '- Telefono: 402x874 (iPhone 16 Pro) con `isMobile` y toque, escala 2 (la especificacion pide 3; se uso 2 para mantener ligeros los archivos).',
      '- Temas claro y oscuro; movimiento reducido para que el arte pinte un solo cuadro y la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Las zonas seguras del iPhone no se simulan en F0 (llegan con la fase movil).',
      '',
      '| Archivo | Navegador | Perfil | Tema | Pantalla | Peso | sha256 (12) |',
      '|---|---|---|---|---|---|---|',
      ...filas,
      '',
      `Total: ${todas.length} capturas.`,
      '',
    ].join('\n'),
  );
  console.log(`capturas de ${browserName}: ${hechas.length}`);
});
