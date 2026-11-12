// Capturas de la integracion con base de datos: Reportes (vacio, historial y vista previa), Inventario actual de proveedores (con lectura, lista para cliente, dato viejo y sin lectura)
// y Costos del sistema (resumen con logos oficiales, cargos con 'Explicar este numero', cuenta con Javier y formulario).
// Claro y oscuro, 1440x900, 402x874 (iPhone 16 Pro), plegable cerrado 344x882 y abierto 880x860, Chromium y WebKit (un navegador por corrida de base).
// Datos ILUSTRATIVOS (scripts/capturas/datos-demo-integracion.mjs); ningun dato real de ventas, compras, pagos ni saldos.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/integracion-db');
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

test.use({ actionTimeout: 30_000, navigationTimeout: 60_000 });

test('capturas de la integracion con base de datos', async ({ browser, browserName }) => {
  test.setTimeout(2_400_000);
  mkdirSync(SALIDA, { recursive: true });
  async function iniciarSesion(ctx: Awaited<ReturnType<Browser['newContext']>>) {
    let correo = correoUnico(`integracion-${browserName}`);
    for (let intento = 1; ; intento += 1) {
      try {
        await altaUsuario({ correo, socio: 'Javier' });
        break;
      } catch (e) {
        if (intento >= 6) throw e;
        await new Promise((r) => setTimeout(r, 20_000));
        correo = correoUnico(`integracion-${browserName}`);
      }
    }
    const pg = await ctx.newPage();
    await pg.goto(BASE + (await enlaceConfirmacion(correo, '/costos')));
    await pg.getByTestId('confirmar-acceso').click();
    await pg.waitForURL(`${BASE}/costos`);
    await pg.close();
  }
  const contextos = new Map<string, Awaited<ReturnType<Browser['newContext']>>>();
  async function contexto(p: Perfil, tema: Tema) {
    const clave = `${p.nombre}-${tema}`;
    let ctx = contextos.get(clave);
    if (!ctx) {
      ctx = await browser.newContext({ ...opciones(p, tema), permissions: browserName === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] });
      await fijar(ctx, tema);
      await iniciarSesion(ctx);
      contextos.set(clave, ctx);
    }
    return ctx;
  }
  async function cerrarContextos() {
    for (const c of contextos.values()) await c.close();
    contextos.clear();
  }
  async function tomar(p: Perfil, tema: Tema, nombre: string, ruta: string, preparar?: (page: Page) => Promise<void>) {
    for (let intento = 1; ; intento += 1) {
      const page = await (await contexto(p, tema)).newPage();
      try {
        await page.goto(`${BASE}${ruta}`);
        if (new URL(page.url()).pathname !== new URL(`${BASE}${ruta}`).pathname) throw new Error(`redirigida a ${page.url()}`);
        await page.evaluate(() => document.fonts.ready);
        if (preparar) await preparar(page);
        await page.waitForTimeout(450);
        if (new URL(page.url()).pathname !== new URL(`${BASE}${ruta}`).pathname) throw new Error(`redirigida a ${page.url()}`);
        await page.screenshot({ path: join(SALIDA, `${browserName}-${p.nombre}-${tema}-${nombre}.png`), fullPage: false });
        await page.close();
        await new Promise((r) => setTimeout(r, 900));
        return;
      } catch (e) {
        console.log(`REINTENTO ${intento} ${p.nombre} ${tema} ${nombre}: url=${page.url()} error=${String(e).split('\n')[0]}`);
        await page.close().catch(() => {});
        await contextos.get(`${p.nombre}-${tema}`)?.close().catch(() => {});
        contextos.delete(`${p.nombre}-${tema}`);
        if (intento >= 5) throw e;
        await new Promise((r) => setTimeout(r, 20_000));
      }
    }
  }

  const lista = async (page: Page) => { await page.getByTestId('lista-marca').selectOption({ index: 1 }); await page.getByTestId('lista-preparar').click(); await page.getByTestId('lista-texto').waitFor(); await page.getByTestId('lista-texto').scrollIntoViewIfNeeded(); };
  const formularioCargo = async (page: Page) => {
    await page.getByTestId('cargo-servicio').selectOption({ label: 'Supabase' });
    await page.getByTestId('cargo-base').fill('75');
    await page.getByTestId('cargo-modo').selectOption('participacion');
    await page.getByTestId('cargo-consumo-rtm').fill('10');
    await page.getByTestId('cargo-consumo-total').fill('60');
    await page.getByTestId('cargo-vista-previa').scrollIntoViewIfNeeded();
  };
  const cargos = async (page: Page) => { await page.locator('details.rtm-explicar-linea summary').first().click(); await page.getByRole('region', { name: 'Cargos' }).scrollIntoViewIfNeeded(); };
  const cuenta = async (page: Page) => { await page.getByRole('region', { name: 'Cuenta de costos entre socios' }).scrollIntoViewIfNeeded(); };

  // Antes de generar ningun reporte: historial vacio.
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'reportes-vacio', '/reportes');
      await tomar(p, tema, 'inventario-proveedores', '/proveedores/inventario');
      await tomar(p, tema, 'inventario-lista', '/proveedores/inventario', lista);
      await tomar(p, tema, 'costos-resumen', '/costos');
      await tomar(p, tema, 'costos-cargos', '/costos', cargos);
      await tomar(p, tema, 'costos-cuenta', '/costos', cuenta);
      await tomar(p, tema, 'costos-formulario', '/costos', formularioCargo);
    }
  }
  await cerrarContextos();

  // Se preparan dos reportes semanales por la propia pantalla (Chromium en el servidor; un trabajo a la vez).
  const generador = await browser.newContext(opciones(PERFILES[0]!, 'claro'));
  await iniciarSesion(generador);
  const pg = await generador.newPage();
  for (const inicio of ['2026-11-02', '2026-11-09']) {
    await pg.goto(`${BASE}/reportes`);
    await pg.getByTestId('reporte-inicio').fill(inicio);
    await pg.getByTestId('reporte-preparar').click();
    await pg.getByTestId('reporte-mensaje').waitFor({ timeout: 240_000 });
  }
  await generador.close();

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'reportes-historial', '/reportes');
      await tomar(p, tema, 'reportes-vista-previa', '/reportes/semanal%3A2026-11-09/1', async (page) => { await page.frameLocator('[data-testid=marco-reporte]').locator('body').waitFor(); });
    }
  }
  await cerrarContextos();

  // Con la ultima lectura de hace 5 horas: advertencia y lista bloqueada. Y sin ninguna lectura.
  await conDb((c) => c.query("select proveedores.guardar_estado(jsonb_set(proveedores.cargar_estado(), '{salud,ultimaLecturaOk}', to_jsonb((now() - interval '5 hours')::text)), '[]'::jsonb, 'cap:viejo:' || clock_timestamp()::text)"));
  const bloqueada = async (page: Page) => { await page.getByTestId('lista-preparar').click(); await page.getByTestId('lista-bloqueada').waitFor(); await page.getByTestId('lista-bloqueada').scrollIntoViewIfNeeded(); };
  for (const p of PERFILES) {
    for (const tema of TEMAS) await tomar(p, tema, 'inventario-dato-viejo', '/proveedores/inventario', bloqueada);
  }
  await cerrarContextos();

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
      '# Capturas de la integracion con base de datos',
      '',
      'Generadas con `npm run capturas:integracion-db`: por cada navegador se reinicia la base local, se cargan fixtures ILUSTRATIVOS y `scripts/capturas/datos-demo-integracion.mjs` (ningun dato real de ventas, compras, pagos ni saldos; ninguna llamada a un servicio externo) y Playwright corre contra un servidor de produccion local.',
      '',
      '- Escritorio 1440x900 (escala 1); telefono 402x874 (iPhone 16 Pro, escala 2); plegable cerrado 344x882 y abierto 880x860 (escala 2); con `isMobile` y toque en los tres moviles.',
      '- Temas claro y oscuro; acento neutro estricto; movimiento apagado para que la captura sea estable. Navegadores: Chromium y WebKit.',
      '- Reportes: historial vacio, historial con dos semanales preparados por la propia pantalla (estado Preliminar o Parcial segun las comprobaciones y los datos) y la vista previa con el HTML guardado.',
      '- Inventario actual de proveedores: lectura de hace 20 minutos con promocion, nombres por confirmar y cambios recientes; lista para cliente preparada (sin proveedor ni importes); y la advertencia con el dato de 5 horas que bloquea la lista.',
      '- Costos del sistema: resumen del mes con logos oficiales (negro en tema claro, blanco en oscuro; Higgsfield solo icono y nombre), cargos con Explicar este numero, cuenta con Javier y el formulario de cargo con vista previa del efecto.',
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
