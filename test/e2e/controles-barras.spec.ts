// Contrato de controles: en las barras de filtros, barras de tabla, paginadores y filas de formulario NINGUN control se monta sobre otro y
// todos los controles de un mismo renglon miden lo mismo de alto. Se mide en el DOM, en 1440 y 390 px, en tema claro y oscuro.
// CONTROLES_FOTOS=<carpeta> guarda ademas la captura de pantalla completa de cada pagina para revision visual.
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa, sembrarCuentasE2E } from './ayudas';
import { CONTENEDORES, medirControles, medirRecortes, type HallazgoControles } from './medida_controles';

const FOTOS = process.env.CONTROLES_FOTOS;
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 900, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

async function abrirSesion(browser: Browser, base: string) {
  // Datos ILUSTRATIVOS propios: operacion y cuentas (pedidos enviados, pagos, asientos) y un modelo de nombre corto y real para el selector de precios
  // (los nombres largos de relleno de las pruebas E2E no son datos reales y desbordarian cualquier selector).
  const d = await sembrarCuentasE2E();
  const sufijo = Date.now().toString(36);
  const modelo = await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_modelo('Marca Z', $1, 50000, 'ambas')", [`Zeta ${sufijo}`]);
    const r = await c.query('select id from catalogo.modelo where nombre_canonico = $1', [`Zeta ${sufijo}`]);
    await c.query('commit');
    return Number(r.rows[0].id);
  });
  const cliente = d.clienteId;
  const correo = correoUnico('ctl');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(base + (await enlaceConfirmacion(correo, '/socios')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${base}/socios`);
  const estado = await entrada.storageState();
  await entrada.close();
  return { estado, cliente, modelo };
}

test('ningun control se monta sobre otro y el alto es uniforme por renglon', async ({ browser, baseURL }: { browser: Browser; baseURL: string | undefined }) => {
  test.setTimeout(900_000);
  const base = baseURL ?? 'http://127.0.0.1:3100';
  const { estado, cliente, modelo } = await abrirSesion(browser, base);
  const rutas: [string, string][] = [
    ['contactos', '/contactos'], ['kardex', '/inventario/kardex'], ['libro', '/movimientos/libro'], ['clientes', '/clientes'], ['pedidos', '/pedidos'],
    ['cxc', '/cuentas-por-cobrar'], ['diario', '/contabilidad/diario'], ['reportes', '/reportes'], ['liquidacion', '/proveedores/liquidacion'],
    ['socios', '/socios'], ['avisos', '/avisos'], ['movimientos', '/movimientos'], ['proveedores', '/proveedores'], ['costos', '/costos'],
    ['catalogo-costos', `/catalogo/costos?modelo=${modelo}`], ['cliente-precios', `/clientes/${cliente}/precios?modelo=${modelo}`], ['compra-nueva', '/proveedores/compras/nueva?p=Karen'],
    ['pedido-nuevo', '/pedidos/nuevo'], ['inventario-conteo', '/inventario/conteo'], ['mayor', '/contabilidad/mayor'],
  ];
  const fallos: string[] = [];
  const hallazgos: HallazgoControles[] = [];
  if (FOTOS) mkdirSync(FOTOS, { recursive: true });
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      const ctx = await browser.newContext({ viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado });
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      for (const [nombre, ruta] of rutas) {
        const page = await ctx.newPage();
        const resp = await page.goto(`${base}${ruta}`, { waitUntil: 'networkidle' });
        if (!resp || resp.status() >= 400) { fallos.push(`${nombre} ${p.nombre} ${tema}: HTTP ${resp?.status()}`); await page.close(); continue; }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const h = await page.evaluate(medirControles, CONTENEDORES);
        h.push(...(await page.evaluate(medirRecortes)));
        for (const x of h) hallazgos.push({ ...x, contenedor: `${nombre} ${p.nombre} ${tema} ${x.contenedor}` });
        if (FOTOS) await page.screenshot({ path: join(FOTOS, `${nombre}-${tema}-${p.nombre}.png`), fullPage: true });
        await page.close();
      }
      await ctx.close();
    }
  }
  const texto = hallazgos.map((x) => `${x.tipo.toUpperCase()} ${x.contenedor}: ${x.detalle}`);
  expect([...fallos, ...texto], [...fallos, ...texto].join('\n')).toEqual([]);
});

test('diario: Debe y Haber caen en la misma vertical en todos los asientos y la tabla mide lo mismo', async ({ browser, baseURL }: { browser: Browser; baseURL: string | undefined }) => {
  const base = baseURL ?? 'http://127.0.0.1:3100';
  const { estado } = await abrirSesion(browser, base);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado });
  const page = await ctx.newPage();
  await page.goto(`${base}/contabilidad/diario`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.a3-diario-lineas .rtm-dt')].map((t) => {
    const cab = [...t.querySelectorAll<HTMLElement>('.rtm-dt-cabecera .rtm-dt-celda')].map((c) => c.getBoundingClientRect());
    const tr = t.getBoundingClientRect();
    const debe = cab[2]!, haber = cab[3]!;
    return { ancho: Math.round(tr.width), debe: Math.round(debe.left - tr.left), haber: Math.round(haber.left - tr.left), finHaber: Math.round(haber.right - tr.left) };
  }));
  expect(m.length).toBeGreaterThan(1);
  for (const f of m) expect(f).toEqual(m[0]);
  await ctx.close();
});

test('costos: los servicios con logo oficial en el repositorio lo muestran en la lista', async ({ browser, baseURL }: { browser: Browser; baseURL: string | undefined }) => {
  const base = baseURL ?? 'http://127.0.0.1:3100';
  const { estado } = await abrirSesion(browser, base);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado });
  const page = await ctx.newPage();
  await page.goto(`${base}/costos`, { waitUntil: 'networkidle' });
  const conLogo = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.rtm-serv-fila')].filter((f) => f.querySelector('img')).map((f) => f.closest('li')?.getAttribute('data-testid')));
  for (const esperado of ['servicio-supabase', 'servicio-vercel', 'servicio-resend', 'servicio-github', 'servicio-openrouter', 'servicio-higgsfield']) expect(conLogo).toContain(esperado);
  await ctx.close();
});
