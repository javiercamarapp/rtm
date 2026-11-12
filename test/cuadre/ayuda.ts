// Ayudas del recorrido de "cuadrar cuentas": datos ILUSTRATIVOS de catalogo (nada real) y capturas numeradas.
import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { conDb } from '../e2e/ayudas';

export const SALIDA = join(__dirname, '../../docs/capturas/cuadre');
mkdirSync(SALIDA, { recursive: true });
let n = 0;
export async function cap(page: Page, nombre: string, completa = false): Promise<void> {
  n += 1;
  await page.locator('main:not(.rtm-documento)').first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => undefined);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(SALIDA, `${String(n).padStart(2, '0')}-${nombre}.png`), fullPage: completa });
}

export interface Demo { sufijo: string; marca: string; modelo: string; modeloCompleto: string; clienteA: string; clienteB: string }

/** Catalogo minimo de demostracion: un modelo con dos sabores, costos de Isaac y Karen, dos clientes con precio. Es el "catalogo ya cargado" de produccion. */
export async function sembrarCatalogo(): Promise<Demo> {
  const sufijo = process.env.CUADRE_SUFIJO ?? Date.now().toString(36);
  const marca = 'Marca Demo';
  const modelo = `Demo 25K ${sufijo}`;
  const clienteA = `Cliente Demo Uno ${sufijo}`;
  const clienteB = `Cliente Demo Dos ${sufijo}`;
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [clienteA]);
    await c.query("select catalogo.asegurar_cliente($1,'Angelo')", [clienteB]);
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [`Omar Demo ${sufijo}`]);
    await c.query('select catalogo.asegurar_persona_bodega($1,$1)', [`Omar Demo ${sufijo}`]);
    await c.query("select catalogo.asegurar_modelo($1,$2,50000,'ambas')", [marca, modelo]);
    for (const s of ['Fresa', 'Uva']) await c.query('select catalogo.asegurar_sku($1,$2)', [modelo, s]);
    await c.query("select catalogo.fijar_costo($1,'Isaac',$2,10000,negocio.hoy() - 60,'demo')", [`cd:ci:${sufijo}`, modelo]);
    await c.query("select catalogo.fijar_costo($1,'Karen',$2,11000,negocio.hoy() - 60,'demo',null,true)", [`cd:ck:${sufijo}`, modelo]);
    for (const cl of [clienteA, clienteB]) await c.query("select catalogo.fijar_precio($1,$2,$3,15000,negocio.hoy() - 60,'chat')", [`cd:p:${cl}`, cl, modelo]);
    await c.query('commit');
  });
  return { sufijo, marca, modelo, modeloCompleto: `${marca} ${modelo}`, clienteA, clienteB };
}

export async function elegirOpcion(page: Page, testid: string, texto: string): Promise<void> {
  const valor = await page.getByTestId(testid).evaluate((el, t) => {
    const op = Array.from((el as HTMLSelectElement).options).find((o) => o.text.includes(t));
    return op ? op.value : null;
  }, texto);
  expect(valor, `opcion que contiene "${texto}" en ${testid}`).not.toBeNull();
  await page.getByTestId(testid).selectOption(valor!);
}
