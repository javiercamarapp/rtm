// Capturas de la apertura (diez pasos, validacion, vista previa, ensayo, firma y publicacion) y de la zona Movimientos (bandeja, importar, agrupar y utilidad).
// Claro y oscuro, 1440x900, 402x874 (iPhone 16 Pro), plegable cerrado 344x882 y abierto 880x860, Chromium y WebKit (un navegador por corrida de base).
// Datos ILUSTRATIVOS (scripts/capturas/datos-demo-apertura.mjs); ningun dato real de ventas, compras, pagos ni saldos.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, consultar, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/apertura');
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

test('capturas de la apertura y de Movimientos', async ({ browser, browserName }) => {
  test.setTimeout(2_400_000);
  mkdirSync(SALIDA, { recursive: true });
  // Cada contexto inicia su propia sesion: compartir un mismo estado entre contextos hace que la rotacion de tokens de Supabase invalide a los demas.
  async function iniciarSesion(ctx: Awaited<ReturnType<Browser['newContext']>>) {
    let correo = correoUnico(`apertura-${browserName}`);
    // El servicio de Auth local puede quedarse sin puertos efimeros hacia su base si se le piden muchas paginas seguidas: se reintenta con espera.
    for (let intento = 1; ; intento += 1) {
      try {
        await altaUsuario({ correo, socio: 'Javier' });
        break;
      } catch (e) {
        if (intento >= 6) throw e;
        console.log(`ALTA REINTENTO ${intento}: ${String(e).split('\n')[0]}`);
        await new Promise((r) => setTimeout(r, 20_000));
        correo = correoUnico(`apertura-${browserName}`);
      }
    }
    const pg = await ctx.newPage();
    await pg.goto(BASE + (await enlaceConfirmacion(correo, '/apertura')));
    await pg.getByTestId('confirmar-acceso').click();
    await pg.waitForURL(`${BASE}/apertura`);
    await pg.close();
  }

  // Un contexto por perfil y tema (se reutiliza entre pantallas: mucho mas rapido que abrir uno por captura).
  const contextos = new Map<string, Awaited<ReturnType<Browser['newContext']>>>();
  async function contexto(p: Perfil, tema: Tema) {
    const clave = `${p.nombre}-${tema}`;
    let ctx = contextos.get(clave);
    if (!ctx) {
      ctx = await browser.newContext(opciones(p, tema));
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
    // Hasta tres intentos: si una pagina no responde (equipo cargado), se descarta el contexto y se reintenta con uno nuevo. Cada fallo se imprime con su URL.
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
        console.log(`REINTENTO ${intento} ${p.nombre} ${tema} ${nombre}: url=${page.url()} titulo=${await page.title().catch(() => '?')} error=${String(e).split('\n')[0]}`);
        await page.close().catch(() => {});
        const clave = `${p.nombre}-${tema}`;
        await contextos.get(clave)?.close().catch(() => {});
        contextos.delete(clave);
        if (intento >= 5) throw e;
        await new Promise((r) => setTimeout(r, 20_000));
      }
    }
  }

  const ensayo = async (page: Page) => { await page.getByTestId('apertura-ensayo').click(); await page.getByTestId('ensayo-resultado').waitFor(); await page.getByTestId('ensayo').scrollIntoViewIfNeeded(); };
  const pegar = async (page: Page) => {
    await page.getByTestId('pegado').fill(['Fecha\tMonto\tCuenta\tOrigen\tMensaje', '2026-11-03\t12,500.00\tCuenta ilustrativa A\tCliente uno\tCobro de prueba', '04/11/2026\t-3,200.00\tCuenta ilustrativa A\tProveedor\tPago de prueba', '2026-11-05\tmonto malo\tx\tx\tFila con error'].join('\n'));
    await page.getByTestId('contar').click();
    await page.getByTestId('conteo').waitFor();
  };
  const conciliar = async (page: Page) => {
    await page.getByRole('button', { name: 'Conciliar' }).first().click();
    await page.getByRole('dialog').waitFor();
  };
  const clasificar = async (page: Page) => {
    await page.getByRole('button', { name: 'Clasificar' }).first().click();
    await page.getByRole('dialog').waitFor();
  };
  const desglose = async (page: Page) => { await page.locator('[data-testid^="grupo-"]').first().click(); await page.getByTestId('desglose').waitFor(); await page.getByTestId('desglose').scrollIntoViewIfNeeded(); };

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'resumen', '/apertura');
      for (let n = 1; n <= 10; n += 1) await tomar(p, tema, `paso-${n}`, `/apertura/paso/${n}`);
      await tomar(p, tema, 'paso-9-ensayo', '/apertura/paso/9', ensayo);
      await tomar(p, tema, 'movimientos-bandeja', '/movimientos');
      await tomar(p, tema, 'movimientos-sin-clasificar', '/movimientos?estado=sin_clasificar');
      await tomar(p, tema, 'movimientos-clasificar', '/movimientos?estado=sin_clasificar', clasificar);
      await tomar(p, tema, 'movimientos-conciliar', '/movimientos?estado=clasificado', conciliar);
      await tomar(p, tema, 'movimientos-importar', '/movimientos/importar', pegar);
      await tomar(p, tema, 'movimientos-agrupar-cliente', '/movimientos/resumen?dim=cliente');
      await tomar(p, tema, 'movimientos-desglose', '/movimientos/resumen?dim=cliente', desglose);
      await tomar(p, tema, 'movimientos-agrupar-proveedor', '/movimientos/resumen?dim=proveedor');
      await tomar(p, tema, 'movimientos-utilidad', '/movimientos/resumen?dim=socio', async (page) => { await page.getByTestId('utilidad-total').scrollIntoViewIfNeeded(); });
    }
  }

  await cerrarContextos();
  // La segunda firma (Javier) publica la apertura: de aqui en adelante las pantallas muestran la apertura publicada.
  const firmante = await browser.newContext(opciones(PERFILES[0]!, 'claro'));
  await iniciarSesion(firmante);
  const pf = await firmante.newPage();
  await pf.goto(`${BASE}/apertura/paso/10`);
  await pf.getByTestId('apertura-firmar').click();
  await pf.getByRole('button', { name: 'Firmar', exact: true }).click();
  await pf.getByTestId('estado-firma').getByText('Publicada').waitFor();
  await firmante.close();
  const modelo = (await consultar<{ id: string }>("select modelo_id::text as id from operacion.movimiento_inventario where tipo = 'apertura' order by id limit 1"))[0]!.id;
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'publicada-resumen', '/apertura');
      await tomar(p, tema, 'publicada-firmas', '/apertura/paso/10');
      await tomar(p, tema, 'publicada-diario', '/contabilidad/diario');
      await tomar(p, tema, 'publicada-comprobaciones', '/contabilidad/comprobaciones');
      await tomar(p, tema, 'publicada-kardex', `/inventario/kardex?modelo=${modelo}`);
    }
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
      '# Capturas de la apertura y de la zona Movimientos',
      '',
      'Generadas con `npm run capturas:apertura`: por cada navegador se reinicia la base local, se cargan fixtures ILUSTRATIVOS y datos inventados de F1 a F3b y de la apertura (ningun dato real de ventas, compras, pagos ni saldos) y Playwright corre contra un servidor de produccion local. Durante la corrida Javier firma y la apertura de demostracion se publica; las capturas `publicada-*` se toman despues.',
      '',
      '- Escritorio 1440x900 (escala 1); telefono 402x874 (iPhone 16 Pro, escala 2); plegable cerrado 344x882 y abierto 880x860 (escala 2); con `isMobile` y toque en los tres moviles.',
      '- Temas claro y oscuro; acento neutro estricto; movimiento apagado para que la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Apertura: resumen con la identidad contable y la diferencia en la cuenta puente 3990, los diez pasos, el ensayo sobre una copia, la firma (falta la de Javier) y la apertura publicada (resumen, firmas, diario, comprobaciones y kardex con el movimiento de apertura).',
      '- Movimientos: bandeja (todos y sin clasificar), clasificar, conciliar, pegar o subir (con lectura previa y conteo sin escribir), agrupar por cliente y por proveedor, desglose y utilidad por pedido y por socio con quien debe a quien.',
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
