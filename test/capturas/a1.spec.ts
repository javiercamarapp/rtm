// Capturas del rediseno A1 (inicio, pedidos, clientes, catalogo, paquetes, avisos): 1440x900 y 390x844 (iPhone 16 Pro), claro y oscuro.
// Datos ILUSTRATIVOS de la base local. RUTAS="inicio,pedidos" limita la corrida. Verifica que en 390 no haya scroll horizontal de pagina.
import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/rediseno-a1');
const BASE = 'http://127.0.0.1:3101';
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 900, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

test('capturas A1', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const [pedido, cliente, modelo] = await conDb(async (c) => [
    (await c.query('select id from operacion.pedido order by id desc limit 1')).rows[0]?.id,
    (await c.query('select id from catalogo.cliente where activo order by id limit 1')).rows[0]?.id,
    (await c.query('select id from catalogo.modelo order by id limit 1')).rows[0]?.id,
  ]);
  const todas: [string, string][] = [
    ['inicio', '/'], ['pedidos', '/pedidos'], ['pedido-detalle', `/pedidos/${pedido}?vista=interna`], ['pedido-nuevo', `/pedidos/nuevo?cliente=${cliente}`],
    ['clientes', '/clientes'], ['cliente-ficha', `/clientes/${cliente}`], ['catalogo', `/catalogo?modelo=${modelo}`], ['paquetes-por-hacer', '/paquetes/por-hacer'],
    ['paquetes-en-trayecto', '/paquetes/en-trayecto'], ['avisos', '/avisos'],
  ];
  const filtro = (process.env.RUTAS ?? '').split(',').filter(Boolean);
  const rutas = filtro.length ? todas.filter(([n]) => filtro.includes(n)) : todas;

  const correo = correoUnico('a1');
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
      for (const [nombre, ruta] of rutas) {
        await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const desborde = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, ...[...document.querySelectorAll('.rtm-pagina-v2, .rtm-pagina-v2 > *, .rtm-tarjeta-v2, .rtm-kpi-linea')].map((e) => Math.round(e.getBoundingClientRect().right - window.innerWidth))));
        if (p.movil && desborde > 1) informe.push(`DESBORDE ${nombre} ${tema} ${p.nombre}: ${desborde}px`);
        // La pagina hace scroll dentro del armazon: se alarga la ventana hasta el alto del contenido para ver la pagina entera.
        const alto = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight).map((e) => e.scrollHeight)));
        await page.setViewportSize({ width: p.ancho, height: Math.min(Math.max(alto + 120, p.alto), 7000) });
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}.png`) });
        await page.setViewportSize({ width: p.ancho, height: p.alto });
      }
      await ctx.close();
    }
  }
  writeFileSync(join(SALIDA, '.desbordes.txt'), informe.join('\n') + '\n');
});
