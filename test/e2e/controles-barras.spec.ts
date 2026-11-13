// Contrato de controles: en las barras de filtros, barras de tabla, paginadores y filas de formulario NINGUN control se monta sobre otro y
// todos los controles de un mismo renglon miden lo mismo de alto. Se mide en el DOM, en 1440 y 390 px, en tema claro y oscuro.
// CONTROLES_FOTOS=<carpeta> guarda ademas la captura de pantalla completa de cada pagina para revision visual.
import { test, expect, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa, sembrarCuentasE2E } from './ayudas';
import { CONTENEDORES, CONTENEDORES_FUERA, medirControles, medirFueraDeContenedor, medirRecortes, type HallazgoControles } from './medida_controles';

const FOTOS = process.env.CONTROLES_FOTOS;
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 900, movil: false }, { nombre: '768', ancho: 768, alto: 1024, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;
// CONTROLES_SOLO=cxc,diario limita la corrida a esas paginas (revision visual rapida); sin ella corren todas.
const SOLO = process.env.CONTROLES_SOLO?.split(',').filter(Boolean);

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
  // Contactos ILUSTRATIVOS (telefonos 555 y correos example.test): sin ellos /contactos solo muestra el estado vacio y la barra de filtros no existe.
  await conDb(async (c) => {
    const contactos = Array.from({ length: 12 }, (_, i) => ({
      nombre: `Contacto ilustrativo ${i + 1}`, telefonos: [`+5299955${String(60000 + i).slice(-5)}`], correos: i % 4 === 0 ? [`demo${i}@example.test`] : [],
      colonias: i % 3 ? ['Centro'] : [], origenes: [i % 2 ? { origen: 'meta', anuncio: 'Anuncio ilustrativo 1', formulario: 'Formulario A' } : { origen: 'toocloudy' }],
    }));
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query('select contactos.cargar_lote($1, $2::jsonb)', ['e2e-controles', JSON.stringify(contactos)]);
    await c.query('commit');
  });
  const correo = correoUnico('ctl');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(base + (await enlaceConfirmacion(correo, '/socios')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${base}/socios`);
  const estado = await entrada.storageState();
  await entrada.close();
  // Un reporte ya preparado (otra semana que la de integracion-db): sin filas, /reportes no muestra la tabla de historial y no habria tarjetas que medir.
  const rep = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado });
  const pr = await rep.newPage();
  await pr.goto(`${base}/reportes`);
  await pr.getByTestId('reporte-inicio').fill('2026-10-26');
  await pr.getByTestId('reporte-preparar').click();
  await expect(pr.getByTestId('reporte-mensaje')).toBeVisible({ timeout: 150_000 });
  await rep.close();
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
    ['pedido-nuevo', '/pedidos/nuevo'], ['inventario-conteo', '/inventario/conteo'], ['mayor', '/contabilidad/mayor'], ['balance', '/contabilidad/balance'],
    ['contabilidad', '/contabilidad'], ['kardex-sabor', '/inventario/kardex/sabor'], ['catalogo', '/catalogo'], ['costos-servicio', '/costos/supabase'],
  ];
  const fallos: string[] = [];
  const medidos = new Map<string, number>();
  const hallazgos: HallazgoControles[] = [];
  if (FOTOS) mkdirSync(FOTOS, { recursive: true });
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      const ctx = await browser.newContext({ viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado });
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      for (const [nombre, ruta] of rutas) {
        if (SOLO && !SOLO.includes(nombre)) continue;
        const page = await ctx.newPage();
        const resp = await page.goto(`${base}${ruta}`, { waitUntil: 'networkidle' });
        if (!resp || resp.status() >= 400) { fallos.push(`${nombre} ${p.nombre} ${tema}: HTTP ${resp?.status()}`); await page.close(); continue; }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        medidos.set(`${nombre} ${p.nombre}`, await page.evaluate((sel) => document.querySelectorAll(sel).length, CONTENEDORES));
        const h = await page.evaluate(medirControles, CONTENEDORES);
        h.push(...(await page.evaluate(medirRecortes)));
        h.push(...(await page.evaluate(medirFueraDeContenedor, CONTENEDORES_FUERA)));
        for (const x of h) hallazgos.push({ ...x, contenedor: `${nombre} ${p.nombre} ${tema} ${x.contenedor}` });
        if (FOTOS) {
          await page.screenshot({ path: join(FOTOS, `${nombre}-${tema}-${p.nombre}.png`) });
          // Cada barra de controles (con su tarjeta) por separado: la pagina desplaza dentro de su propio panel y la captura completa no la alcanza.
          const barras = page.locator(CONTENEDORES);
          for (let i = 0; i < Math.min(await barras.count(), 4); i++) {
            const el = barras.nth(i);
            if (await el.isVisible()) await el.screenshot({ path: join(FOTOS, `barra-${nombre}-${i}-${tema}-${p.nombre}.png`) }).catch(() => undefined);
          }
          // Tarjetas moviles, pie de totales, franja de pulso y pestanas: lo que recortaba el contenedor tambien se revisa a ojo.
          for (const [clave, sel] of [['tarjeta', '.rtm-dt-caja[data-tarjeta-movil] .rtm-dt-fila[data-fila]'], ['totales', '.rtm-dt-pie'], ['pulso', '.rtm-pulso-movil, .rtm-pulso'], ['pestanas', '.rtm-pestanas'], ['kpi', '.rtm-kpi-linea']] as const) {
            const el = page.locator(sel).filter({ visible: true }).first();
            if (await el.count()) await el.screenshot({ path: join(FOTOS, `${clave}-${nombre}-${tema}-${p.nombre}.png`) }).catch(() => undefined);
          }
        }
        await page.close();
      }
      await ctx.close();
    }
  }
  // Una pagina vacia no tiene barras que medir: estas DEBEN tener al menos una, o la prueba no estaria midiendo nada.
  for (const [nombre] of SOLO ? [] : [['contactos'], ['clientes'], ['pedidos'], ['cxc'], ['diario'], ['balance'], ['mayor'], ['liquidacion'], ['reportes'], ['kardex'], ['libro']] as const) {
    for (const p of PERFILES) if (!(medidos.get(`${nombre} ${p.nombre}`)! > 0)) fallos.push(`${nombre} ${p.nombre}: sin barras de controles que medir`);
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
