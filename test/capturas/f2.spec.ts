// Capturas de F2: pedidos y notas, hoja interna, paquetes por hacer y en trayecto, cuentas por cobrar, proveedores con su cuenta, orden de compra con
// diferencias, avisos y los cajones/dialogos nuevos. Claro y oscuro, 1440x900 y 402x874 (iPhone 16 Pro), Chromium y WebKit.
// Datos ILUSTRATIVOS (scripts/capturas/datos-demo-f2.mjs sobre los fixtures); ningun dato real de ventas, compras ni pagos.
import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/f2');
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

test('capturas de F2', async ({ browser, browserName }) => {
  mkdirSync(SALIDA, { recursive: true });
  const ids = await conDb(async (c) => {
    const ped = (await c.query('select id from operacion.pedido order by id')).rows.map((r) => Number(r.id));
    const oc = (await c.query('select id, p.nombre from operacion.compra co join catalogo.proveedor p on p.id = co.proveedor_id order by co.id')).rows.map((r) => ({ id: Number(r.id), proveedor: String(r.nombre) }));
    const cli = Number((await c.query("select id from catalogo.cliente where nombre_canonico = 'Cliente Beta'")).rows[0].id);
    const prov = Number((await c.query("select id from catalogo.proveedor where nombre = 'Isaac'")).rows[0].id);
    return { ped, oc, cli, prov };
  });
  const [pEnviado, pParcial, pPorEnviar, pBorrador] = ids.ped as [number, number, number, number];
  const ocKaren = ids.oc.find((o) => o.proveedor === 'Karen')!.id;
  const ocIsaac = ids.oc.find((o) => o.proveedor === 'Isaac')!.id;

  const correo = correoUnico(`f2-${browserName}`);
  await altaUsuario({ correo, socio: 'Javier' });
  const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p0 = await entrada.newPage();
  await p0.goto(BASE + (await enlaceConfirmacion(correo, '/pedidos')));
  await p0.getByTestId('confirmar-acceso').click();
  await p0.waitForURL(`${BASE}/pedidos`);
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

  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      await tomar(p, tema, 'pedidos-lista', '/pedidos');
      await tomar(p, tema, 'pedido-nuevo', `/pedidos/nuevo?cliente=${ids.cli}`, async (page) => {
        await page.getByTestId('modelo').selectOption({ index: 1 });
        await page.getByTestId('sabor').selectOption({ index: 1 });
        await page.getByTestId('piezas').fill('40');
        await page.getByTestId('agregar-renglon').click();
      });
      await tomar(p, tema, 'pedido-nota-cliente', `/pedidos/${pEnviado}`, desplazar('[data-testid=nota-cliente]'));
      await tomar(p, tema, 'pedido-parcial-50-sale-40', `/pedidos/${pParcial}`);
      await tomar(p, tema, 'pedido-hoja-interna', `/pedidos/${pEnviado}?vista=interna`, desplazar('[data-testid=cascada]'));
      await tomar(p, tema, 'pedido-versiones', `/pedidos/${pEnviado}?vista=versiones`);
      await tomar(p, tema, 'pedido-por-enviar-con-faltante', `/pedidos/${pPorEnviar}`);
      await tomar(p, tema, 'pedido-borrador-con-avisos', `/pedidos/${pBorrador}`);
      await tomar(p, tema, 'dialogo-marcar-enviado', `/pedidos/${pPorEnviar}`, async (page) => {
        await page.getByTestId(`marcar-enviado-${pPorEnviar}`).click();
        await page.getByRole('dialog').waitFor();
      });
      await tomar(p, tema, 'paquetes-por-hacer', '/paquetes/por-hacer');
      await tomar(p, tema, 'paquetes-en-trayecto', '/paquetes/en-trayecto');
      await tomar(p, tema, 'cuentas-por-cobrar', '/cuentas-por-cobrar');
      await tomar(p, tema, 'explicar-deuda-del-socio', '/cuentas-por-cobrar', async (page) => {
        await page.getByRole('table', { name: 'Deuda de los socios con la sociedad' }).getByRole('button', { name: /Explicar este número/ }).first().click();
        await page.getByTestId('explicar-cajon').waitFor();
      });
      await tomar(p, tema, 'proveedores-isaac', '/proveedores?p=Isaac');
      await tomar(p, tema, 'proveedores-karen', '/proveedores?p=Karen');
      await tomar(p, tema, 'explicar-saldo-del-proveedor', '/proveedores?p=Karen', async (page) => {
        await page.getByRole('button', { name: /Explicar este número/ }).first().click();
        await page.getByTestId('explicar-cajon').waitFor();
      });
      await tomar(p, tema, 'oc-nueva-karen', '/proveedores/compras/nueva?p=Karen');
      await tomar(p, tema, 'oc-en-trayecto-con-recepcion', `/proveedores/compras/${ocKaren}`, desplazar('#recepcion'));
      await tomar(p, tema, 'oc-recibida-con-diferencia-asignada', `/proveedores/compras/${ocIsaac}`, desplazar('[aria-label="Diferencias de recepción"]'));
      await tomar(p, tema, 'avisos', '/avisos?estado=todos');
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
      '# Capturas de F2',
      '',
      'Generadas con `npm run capturas:f2`: base local reiniciada, fixtures ILUSTRATIVOS (Cliente Alfa, Alfa Uno 50K, etc.) con compras, recepcion con diferencia, pedidos y pagos inventados (ningun dato real de ventas, compras ni pagos) y Playwright contra un servidor de produccion local.',
      '',
      '- Escritorio 1440x900 a escala 1; telefono 402x874 (iPhone 16 Pro) con `isMobile` y toque, escala 2.',
      '- Temas claro y oscuro; acento neutro estricto; movimiento apagado para que la captura sea estable.',
      '- Navegadores: Chromium y WebKit (Playwright).',
      '- Pantallas: lista de pedidos; nuevo pedido; pedido enviado con la nota para el cliente; pedido de 50 piezas donde salen 40; hoja interna con cascada y comprobaciones C1 y C2; versiones de la nota; pedido por enviar con sabor faltante; borrador con avisos; dialogo de marcar enviado (surtido por pieza, guia y costo real); Paquetes por hacer; Paquetes en trayecto; Cuentas por cobrar; cajon "Explicar este numero" de la deuda de un socio y del saldo de un proveedor; Proveedores (Isaac y Karen, con su cuenta); nueva orden de compra; orden en trayecto con el formulario de recepcion por sabor; orden recibida con diferencia asignada a un socio; Avisos.',
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
