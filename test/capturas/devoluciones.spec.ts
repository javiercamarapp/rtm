// Capturas del carril de devoluciones: pagina Devoluciones, pedido con devolucion y dialogo de captura, orden recibida en parte. 1440x900 y 390x844, claro y oscuro.
// Verifica que en 390 no haya scroll horizontal de pagina. Datos ILUSTRATIVOS de la base local (corre despues de test/e2e/devoluciones.spec.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type Page } from '@playwright/test';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/devoluciones');
const BASE = process.env.APP_URL_E2E ?? 'http://127.0.0.1:3109';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 1300, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

test('capturas de devoluciones', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const [pedido, compraParcial, compraCerrada] = await conDb(async (c) => {
    const ped = (await c.query('select d.pedido_id as id from operacion.devolucion_cliente d where not exists (select 1 from operacion.devolucion_cliente_anulacion a where a.devolucion_id = d.id) order by d.id desc limit 1')).rows[0]?.id;
    // Una orden recibida en parte para ver el avance (se crea y se recibe parcialmente por la via de importacion).
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const m = (await c.query("select nombre_canonico as n from catalogo.modelo where nombre_canonico like 'E2E F2 Alfa%' order by id desc limit 1")).rows[0].n as string;
    const s = Date.now().toString(36);
    const id = Number((await c.query("select (operacion.crear_compra($1,'Isaac',$2::jsonb,6000)->>'compra_id')::bigint as id", [`cap:oc:${s}`, JSON.stringify([{ modelo: m, sabor: 'Fresa', pagadas: 80 }, { modelo: m, sabor: 'Mango', pagadas: 40 }])])).rows[0].id);
    await c.query('select operacion.confirmar_compra($1,$2)', [`cap:occ:${s}`, id]);
    await c.query('select operacion.marcar_llego_merida($1,$2)', [`cap:ocm:${s}`, id]);
    const lineas = (await c.query('select l.id, l.sku_id from operacion.compra_linea l where l.compra_id = $1 order by l.id', [id])).rows;
    await c.query('select operacion.recibir_compra_parcial($1,$2,$3::jsonb)', [`cap:ocr:${s}`, id, JSON.stringify([{ linea_id: lineas[0].id, sku_id: lineas[0].sku_id, piezas: 50 }, { linea_id: lineas[1].id, sku_id: lineas[1].sku_id, piezas: 40 }])]);
    await c.query('commit');
    const cer = (await c.query("select id from operacion.compra where estado = 'recibida' and exists (select 1 from operacion.compra_diferencia d where d.compra_id = compra.id) order by id desc limit 1")).rows[0]?.id;
    return [ped, id, cer];
  });
  const rutas: [string, string, 'detalle' | 'dialogo'][] = [
    ['devoluciones', '/devoluciones', 'detalle'], ['pedido-con-devolucion', `/pedidos/${pedido}`, 'detalle'], ['pedido-dialogo-devolver', `/pedidos/${pedido}`, 'dialogo'],
    ['compra-recibida-en-parte', `/proveedores/compras/${compraParcial}`, 'detalle'], ['compra-cerrada-con-faltante', `/proveedores/compras/${compraCerrada}`, 'detalle'],
  ];

  const correo = correoUnico('capdev');
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/`);
  const estado = await entrada.storageState();
  await entrada.close();

  const informe: string[] = [];
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      const ctx = await browser.newContext({
        viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: p.movil ? 2 : 1, isMobile: p.movil, hasTouch: p.movil,
        colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado,
      });
      await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
      const page: Page = await ctx.newPage();
      for (const [nombre, ruta, modo] of rutas) {
        await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        if (modo === 'dialogo') {
          await page.getByTestId('devolver-mercancia').click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}.png`) });
          await page.keyboard.press('Escape');
          continue;
        }
        await page.waitForTimeout(500);
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (p.movil && desborde > 1) informe.push(`DESBORDE ${nombre} ${tema} ${p.nombre}: ${desborde}px`);
        if (p.movil) {
          // En vertical el armazon es el movil: se alarga la ventana hasta el alto del contenido para ver la pagina entera.
          const alto = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight).map((e) => e.scrollHeight)));
          await page.setViewportSize({ width: p.ancho, height: Math.min(Math.max(alto + 120, p.alto), 7000) });
          await page.waitForTimeout(250);
          await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}.png`) });
        } else {
          // Una ventana mas alta que ancha activa el armazon movil: en 1440 se captura por tramos desplazando el contenedor.
          const paso = await page.evaluate(() => {
            const el = [...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight).sort((x, y) => y.scrollHeight - x.scrollHeight)[0];
            (window as unknown as { __sc: Element | undefined }).__sc = el;
            return el ? { total: el.scrollHeight, vista: el.clientHeight } : { total: 0, vista: 900 };
          });
          const tramos = Math.min(4, Math.max(1, Math.ceil((paso.total - 80) / (paso.vista - 80))));
          for (let i = 0; i < tramos; i++) {
            await page.evaluate((y) => { (window as unknown as { __sc?: Element }).__sc?.scrollTo({ top: y }); }, i * (paso.vista - 80));
            await page.waitForTimeout(250);
            await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}${tramos > 1 ? `-${i + 1}` : ''}.png`) });
          }
        }
        await page.setViewportSize({ width: p.ancho, height: p.alto });
      }
      await ctx.close();
    }
  }
  writeFileSync(join(SALIDA, '.desbordes.txt'), informe.join('\n') + '\n');
});
