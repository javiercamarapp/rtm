// Capturas y METRICAS de la etapa 3 (pulido) de todas las paginas de A1, A2 y A3, con datos ILUSTRATIVOS del Supabase local propio.
// Mide por pagina: tablas con columnas cortadas, tarjetas hermanas con huecos verticales, vacio antes del pie y scroll horizontal de pagina.
// Variables: E3_PERFIL (1440|1280|390), E3_TEMA (claro|oscuro), E3_SOLO (regex de nombre), E3_SALIDA (carpeta), E3_SIN_FOTO=1 (solo metricas).
import { test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas', process.env.E3_SALIDA ?? 'rediseno-etapa3');
const BASE = 'http://127.0.0.1:3104';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 900, movil: false }, { nombre: '1280', ancho: 1280, alto: 800, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

test('capturas y metricas E3', async ({ browser }: { browser: Browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const [pedido, cliente, modelo, compra] = await conDb(async (c) => [
    (await c.query('select id from operacion.pedido order by id desc limit 1')).rows[0]?.id,
    (await c.query('select id from catalogo.cliente where activo order by id limit 1')).rows[0]?.id,
    (await c.query('select id from catalogo.modelo order by id limit 1')).rows[0]?.id,
    (await c.query('select id from operacion.compra order by id limit 1')).rows[0]?.id,
  ]);
  const correo = correoUnico('e3');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/socios')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/socios`);
  const estado = await entrada.storageState();
  await entrada.close();

  const rutas: [string, string][] = [
    ['inicio', '/'], ['pedidos', '/pedidos'], ['pedido-detalle', `/pedidos/${pedido}?vista=interna`], ['pedido-nuevo', `/pedidos/nuevo?cliente=${cliente}`],
    ['clientes', '/clientes'], ['cliente-ficha', `/clientes/${cliente}`], ['catalogo', `/catalogo?modelo=${modelo}`], ['paquetes-por-hacer', '/paquetes/por-hacer'],
    ['paquetes-en-trayecto', '/paquetes/en-trayecto'], ['avisos', '/avisos'],
    ['inventario', '/inventario'], ['inventario-por-reponer', '/inventario?estado=reponer'], ['kardex', '/inventario/kardex'], ['kardex-modelo', `/inventario/kardex?modelo=${modelo}`],
    ['kardex-sabor', '/inventario/kardex/sabor'], ['marcas', '/inventario/marcas'], ['antiguedad', '/inventario/antiguedad'], ['mermas', '/inventario/mermas'],
    ['valuacion', '/contabilidad/valuacion'], ['valuacion-historial', '/contabilidad/valuacion/historial'], ['caja', '/contabilidad/caja'], ['libro', '/movimientos/libro'], ['conteo', '/inventario/conteo'],
    ['cxc', '/cuentas-por-cobrar'], ['cxc-clientes', '/cuentas-por-cobrar?vista=cliente'], ['cxc-socios', '/cuentas-por-cobrar?vista=socios'],
    ['proveedores', '/proveedores?p=Isaac'], ['proveedores-hoja', '/proveedores?p=Isaac&vista=hoja'], ['proveedores-karen', '/proveedores?p=Karen'], ['liquidacion', '/proveedores/liquidacion?p=Isaac&ambito=todo'],
    ...(compra ? [['compra', `/proveedores/compras/${compra}`] as [string, string]] : []),
    ['socios', '/socios'], ['socio-angelo', '/socios/Angelo'], ['cascada', '/socios/cascada'], ['omar', '/omar'],
    ['conta-valuacion', '/contabilidad'], ['conta-diario', '/contabilidad/diario'], ['conta-mayor', '/contabilidad/mayor'], ['conta-mayor-cuenta', '/contabilidad/mayor?cuenta=1310'],
    ['conta-resultados', '/contabilidad/estado-de-resultados'], ['conta-balance', '/contabilidad/balance'], ['conta-flujo', '/contabilidad/flujo'],
    ['conta-comprobaciones', '/contabilidad/comprobaciones'], ['conta-proyecciones', '/contabilidad/proyecciones'],
  ];
  const filtro = process.env.E3_SOLO ? new RegExp(process.env.E3_SOLO) : null;
  const lineas: string[] = [];
  for (const p of PERFILES.filter((x) => !process.env.E3_PERFIL || x.nombre === process.env.E3_PERFIL)) {
    for (const tema of TEMAS.filter((x) => !process.env.E3_TEMA || x === process.env.E3_TEMA)) {
      const op: BrowserContextOptions = { viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado };
      const ctx = await browser.newContext(op);
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      for (const [nombre, ruta] of rutas) {
        if (filtro && !filtro.test(nombre)) continue;
        const page = await ctx.newPage();
        const errores: string[] = [];
        page.on('pageerror', (e) => errores.push(String(e.message)));
        await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>('.rtm-panel-scroll');
          const tablas = [...document.querySelectorAll<HTMLElement>('.rtm-dt-caja')].map((c) => {
            const t = c.querySelector('[role=table]');
            const ancho = c.clientWidth;
            const desborda = c.scrollWidth - c.clientWidth;
            // columnas de datos cuyo borde derecho queda fuera de la caja visible
            const cab = [...c.querySelectorAll<HTMLElement>('[role=columnheader]')];
            const cr = c.getBoundingClientRect();
            const cortadas = cab.filter((h) => h.getBoundingClientRect().right > cr.right + 1).map((h) => (h.textContent ?? '').trim());
            const cols = cab.map((h) => `${(h.textContent ?? '').trim().slice(0, 14)}:${Math.round(h.getBoundingClientRect().width)}`).join(' ');
            return { etiqueta: t?.getAttribute('aria-label') ?? '?', ancho, desborda, cortadas, cols, indicador: !!c.parentElement?.querySelector('[data-scroll-h]') || c.hasAttribute('data-scroll-h') };
          }).filter((x) => x.desborda > 1);
          const huecos: string[] = [];
          for (const g of document.querySelectorAll<HTMLElement>('.rtm-rejilla')) {
            for (const card of [...g.children] as HTMLElement[]) {
              const r = card.getBoundingClientRect();
              let fondo = r.top;
              for (const h of [...card.querySelectorAll<HTMLElement>('*')]) {
                if (h.offsetParent === null) continue;
                const hr = h.getBoundingClientRect();
                if (hr.height > 0 && hr.width > 0) fondo = Math.max(fondo, hr.bottom);
              }
              const vacio = Math.round(r.bottom - fondo);
              if (vacio > 56) huecos.push(`${(card.getAttribute('aria-label') ?? card.querySelector('h2')?.textContent ?? card.className).toString().slice(0, 40)} (+${vacio}px)`);
            }
          }
          let colaVacia = 0;
          if (scroller) {
            let fondo = 0;
            for (const h of [...scroller.querySelectorAll<HTMLElement>('*')]) { if (h.offsetParent === null) continue; fondo = Math.max(fondo, h.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop); }
            colaVacia = Math.round(scroller.scrollHeight - fondo);
          }
          const colCeros = [...document.querySelectorAll<SVGElement>('figure.rtm-g svg.rtm-g-svg-real')].map((s) => ({ alto: Math.round(s.getBoundingClientRect().height), barras: s.querySelectorAll('.rtm-g-col-barra').length, cero: [...s.querySelectorAll<SVGRectElement>('.rtm-g-col-barra')].filter((r) => r.getBoundingClientRect().height <= 3).length })).filter((x) => x.barras > 3 && x.cero / x.barras > 0.5);
          return { tablas, huecos, colaVacia, scrollH: document.documentElement.scrollWidth - window.innerWidth, colCeros };
        });
        const tag = `${p.nombre}-${tema}-${nombre}`;
        if (m.tablas.length) lineas.push(`TABLA ${tag}: ${m.tablas.map((t) => `${t.etiqueta} +${t.desborda}px cortadas[${t.cortadas.join(', ')}] cols(${t.cols}) caja=${t.ancho}`).join(' ; ')}`);
        if (m.huecos.length) lineas.push(`HUECO ${tag}: ${m.huecos.join(' ; ')}`);
        if (m.colaVacia > 24) lineas.push(`COLA ${tag}: ${m.colaVacia}px vacios al final`);
        if (m.scrollH > 1) lineas.push(`SCROLLH ${tag}: +${m.scrollH}px`);
        if (m.colCeros.length) lineas.push(`CEROS ${tag}: ${JSON.stringify(m.colCeros)}`);
        if (errores.length) lineas.push(`ERROR ${tag}: ${errores.join(' | ')}`);
        if (!process.env.E3_SIN_FOTO) {
          const extra = await page.evaluate(() => { const s = document.querySelector<HTMLElement>('.rtm-panel-scroll'); return s ? Math.max(0, s.scrollHeight - s.clientHeight) : 0; });
          if (extra > 0) { await page.setViewportSize({ width: p.ancho, height: Math.min(p.alto + extra + 8, 9000) }); await page.waitForTimeout(300); }
          await page.screenshot({ path: join(SALIDA, `${tag}.png`), fullPage: true });
        }
        await page.close();
      }
      await ctx.close();
    }
  }
  writeFileSync(join(SALIDA, process.env.E3_METRICAS ?? 'metricas.txt'), lineas.join('\n') + '\n');
});
