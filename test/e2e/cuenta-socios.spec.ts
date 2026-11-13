// Cuenta de socios por valuacion, TU VALUACION del Inicio y capital por socio del Balance, de punta a punta (Chromium) con la base local cargada con los datos reales PRIVADOS del dueno.
// Las cifras esperadas NO viven en el repo: salen del archivo privado E2E_OBJETIVO (objetivo.json del cargador). Sin el archivo, la prueba se salta.
// PRECONDICION: supabase db reset + semilla local + `node scripts/cargador/cargar.mjs --archivos <privada> --hasta-lote 5` (docs/cargador.md) y `next dev -p $E2E_PUERTO` ya levantado.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

type Mapa = Record<'Javier' | 'Angelo', number>;
const ruta = process.env.E2E_OBJETIVO;
const obj = ruta ? (JSON.parse(readFileSync(ruta, 'utf8')) as { valuacion_personal: Mapa; utilidad_por_socio: Mapa; aportacion_neta: Mapa; fondos_en_poder: Partial<Mapa>; diferencia_a_igualar: number }) : null;
const SALIDA = process.env.E2E_CAPTURAS ?? join(process.cwd(), 'test-results', 'cuenta-socios');
const peso = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function sesion(page: Page, socio: 'Angelo' | 'Javier', destino: string) {
  const correo = correoUnico('cs');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, destino);
}

test.skip(!obj, 'Falta E2E_OBJETIVO (archivo privado con las cifras reales)');

for (const socio of ['Javier', 'Angelo'] as const) {
  const otro = socio === 'Javier' ? 'Angelo' : 'Javier';
  test(`${socio}: Inicio muestra TU VALUACION con la comparacion contra ${otro}`, async ({ page }) => {
    const o = obj!;
    await sesion(page, socio, '/');
    const celda = page.getByTestId('inicio-valuacion');
    await expect(celda).toBeVisible();
    await expect(celda).toContainText('TU VALUACIÓN', { ignoreCase: true });
    await expect(page.getByTestId('inicio-valuacion-cifra')).toContainText(peso(o.valuacion_personal[socio]));
    const dif = peso(Math.abs(o.valuacion_personal.Javier - o.valuacion_personal.Angelo));
    if (socio === 'Javier') {
      await expect(page.getByTestId('inicio-valuacion-comparacion')).toHaveText(`Tienes ${dif} más que Angelo`);
      await expect(page.getByTestId('inicio-valuacion-accion')).toHaveText('Angelo debe igualar');
    } else {
      await expect(page.getByTestId('inicio-valuacion-comparacion')).toHaveText(`Tienes ${dif} menos que Javier`);
      await expect(page.getByTestId('inicio-valuacion-accion')).toHaveText(`Te toca aportar ${dif} para igualar`);
    }
    await celda.click();
    await expect(page).toHaveURL(/\/socios$/);
  });

  test(`${socio}: /socios muestra valuaciones, rubros, retirado 0.00 y el panel Cuadra en verde`, async ({ page }) => {
    const o = obj!;
    await sesion(page, socio, '/socios');
    for (const s of ['Javier', 'Angelo'] as const) {
      await expect(page.getByTestId(`valuacion-cifra-${s}`)).toContainText(peso(o.valuacion_personal[s]));
      await expect(page.getByTestId(`utilidades-${s}`)).toContainText(peso(o.utilidad_por_socio[s]));
      await expect(page.getByTestId(`retirado-${s}`)).toContainText('$0.00');
      const capital = o.aportacion_neta[s] + (o.fondos_en_poder[s] ?? 0);
      await expect(page.getByTestId(`capital-${s}`)).toContainText(peso(capital));
    }
    await expect(page.getByTestId('fondos-Angelo')).toContainText(peso(o.fondos_en_poder.Angelo ?? 0));
    await expect(page.getByTestId('dif-valuacion')).toContainText(peso(o.diferencia_a_igualar));
    await expect(page.getByTestId('le-toca')).toContainText(socio === 'Angelo' ? 'Te toca a ti' : 'Angelo');
    await expect(page.getByTestId('texto-sube')).toContainText('baja solo cuando te pagas un retiro');
    for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']) await expect(page.getByTestId(`cuadra-${id}`)).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('conciliacion-capital')).toContainText('Suma por socio');
    await expect(page.getByTestId('alerta-retiros')).toHaveCount(0);
    // La tarjeta confusa ya no esta en la cabecera: vive colapsada en Comprobaciones.
    await expect(page.getByText('Diferencia por la compra (informativa)')).toHaveCount(0);
    await expect(page.getByTestId('comprobaciones')).toBeVisible();
    await expect(page.getByTestId('prov-empresa')).toBeVisible();
    await expect(page.getByText('se debe todavía a proveedores')).toHaveCount(0);
  });
}

test('Balance: capital contable desglosado por socio y la suma cuadra con el libro', async ({ page }) => {
  const o = obj!;
  await sesion(page, 'Javier', '/contabilidad/balance');
  const t = page.getByTestId('balance-capital-socios');
  await expect(t).toContainText('Utilidades acumuladas - Javier');
  await expect(t).toContainText('Utilidades acumuladas - Angelo');
  await expect(t).toContainText('Capital aportado - Javier');
  await expect(t).toContainText('Retiros - Angelo');
  await expect(t).toContainText(peso(o.utilidad_por_socio.Javier));
  await expect(t).toContainText(peso(o.valuacion_personal.Javier));
  await expect(t).toContainText(peso(o.valuacion_personal.Angelo));
  await expect(page.getByTestId('balance-conciliacion-socios')).toContainText('Cuadra');
});

test('capturas 1440 y 390, claro y oscuro', async ({ browser }) => {
  test.setTimeout(400_000);
  mkdirSync(SALIDA, { recursive: true });
  for (const socio of ['Javier', 'Angelo'] as const) {
    for (const [vp, nombre] of [[{ width: 1440, height: 900 }, '1440'], [{ width: 390, height: 844 }, '390']] as const) {
      for (const tema of ['claro', 'oscuro'] as const) {
        const ctx = await browser.newContext({ viewport: vp, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
        const page = await ctx.newPage();
        await sesion(page, socio, '/');
        for (const [url, etiqueta] of [['/', 'inicio'], ['/socios', 'socios'], ['/contabilidad/balance', 'balance']] as const) {
          await page.goto(url);
          await page.waitForLoadState('networkidle');
          await page.screenshot({ path: join(SALIDA, `${socio}-${nombre}-${tema}-${etiqueta}.png`), fullPage: etiqueta !== 'inicio' });
        }
        await ctx.close();
      }
    }
  }
});

test('Omar no ve la cuenta de socios', async ({ page }) => {
  const correo = correoUnico('cs-omar');
  await altaUsuario({ correo, rol: 'omar', activo: true });
  await entrarComo(page, correo, '/').catch(() => undefined);
  await page.goto('/socios');
  await expect(page.getByTestId('valuaciones')).toHaveCount(0);
});
