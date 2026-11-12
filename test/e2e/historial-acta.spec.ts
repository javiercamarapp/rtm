// Historial personal y acta de corte de punta a punta (Chromium 1440, base local con scripts/capturas/datos-demo-historial.mjs sembrada: actas de agosto y septiembre firmadas).
// PRECONDICION: la prueba 2 consume el periodo de octubre (un acta firmada no se borra), asi que SOLO pasa completa en una base recien sembrada
// (supabase db reset + node scripts/capturas/datos-demo-historial.mjs). En una segunda corrida sin re-sembrar, las pruebas 2 y 3 se SALTAN con ese aviso (no fallan) y 4 y 5 usan el acta ya cerrada.
// Flujo: Angelo propone el acta de octubre con retiro y reinversion, la firma; Javier la firma y se cierra con sello; los dos ven su historial y exportan los PDF.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let actaId = '';
let octubreConsumido = false;
const AVISO_RESEMBRAR = 'El periodo de octubre ya tiene acta: re-sembrar con supabase db reset y scripts/capturas/datos-demo-historial.mjs para correr el flujo completo';

test.beforeAll(async () => {
  octubreConsumido = (await consultar<{ n: number }>("select count(*)::int as n from operacion.cierre_reparto where tipo = 'periodo' and periodo_fin = '2026-10-31'"))[0]!.n > 0;
});

async function sesion(page: Page, socio: 'Angelo' | 'Javier', ruta: string) {
  const correo = correoUnico('hist');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, ruta);
}

test('sin sesion no hay historial ni PDF del acta', async ({ page, request }) => {
  await page.goto('/socios/Angelo/historial');
  await expect(page).toHaveURL(/\/login/);
  const r = await request.get('/socios/actas/1/pdf', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(r.status());
});

test('Angelo propone el acta de octubre con retiro y reinversion y la firma', async ({ page }) => {
  test.skip(octubreConsumido, AVISO_RESEMBRAR);
  await sesion(page, 'Angelo', '/socios/cascada?ini=2026-10-01&fin=2026-10-31');
  await expect(page.getByTestId('proponer-cierre')).toBeVisible();
  await page.getByTestId('proponer-cierre').click();
  await page.getByTestId('campo-a_retira').fill('500');
  await page.getByTestId('campo-a_reinvierte').fill('300');
  await page.getByTestId('campo-j_reinvierte').fill('400');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 30_000 });
  const enlace = page.getByRole('row').filter({ hasText: 'Propuesto: faltan las dos firmas' }).getByRole('link', { name: /^CR-\d+$/ });
  await expect(enlace).toBeVisible({ timeout: 30_000 });
  await enlace.click();
  await page.waitForURL(/\/socios\/actas\/\d+$/);
  actaId = /\/socios\/actas\/(\d+)$/.exec(page.url())![1]!;
  await expect(page.getByText('Propuesta: faltan las dos firmas')).toBeVisible();
  const fila = page.getByRole('row').filter({ hasText: 'Angelo' }).first();
  await expect(fila).toContainText('$500.00');
  await expect(fila).toContainText('$300.00');
  await page.getByTestId('firmar-acta').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Firmada por uno: falta el otro socio')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('firmar-acta')).toHaveCount(0);
});

test('Javier firma, el acta se cierra con sello y se descarga el PDF', async ({ page }) => {
  test.skip(octubreConsumido, AVISO_RESEMBRAR);
  await sesion(page, 'Javier', `/socios/actas/${actaId}`);
  await expect(page.getByText('Firmada por uno: falta el otro socio')).toBeVisible();
  await page.getByTestId('firmar-acta').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Cerrada y firmada por los dos')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('acta-huella')).toContainText('…');
  const pdf = await page.request.get(`/socios/actas/${actaId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // La cifra "Disponible" se explica por dos vias.
  await page.getByRole('row').filter({ hasText: 'Angelo' }).first().getByRole('button', { name: /Explicar este número/ }).click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
});

test('Historial personal: cabecera, ratios, linea de tiempo con el acta nueva, estadisticas y PDF', async ({ page }) => {
  await sesion(page, 'Javier', '/socios/Angelo/historial');
  await expect(page.getByRole('heading', { name: 'Historial de Angelo' })).toBeVisible();
  await expect(page.getByTestId('h-invertido')).toContainText('$');
  await expect(page.getByTestId('h-invertido')).toContainText('Aportaciones $40,000.00');
  await expect(page.getByTestId('h-valor')).toContainText('Estimado');
  await expect(page.getByRole('region', { name: 'Ratios de rendimiento' }).or(page.getByLabel('Ratios de rendimiento'))).toContainText('ROI');
  const tl = page.getByRole('table', { name: 'Actas de Angelo' });
  await expect(tl.getByRole('row').filter({ hasText: 'Firmada por los dos' })).toHaveCount(3);
  await expect(tl).toContainText('$500.00');
  // La fila Total alinea cada suma bajo su columna: Periodo (2.a) sin cifra, Utilidad (3.a) y Su parte (4.a) con cifra.
  const celdasTotal = tl.getByRole('row').filter({ hasText: 'Total (' }).getByRole('cell');
  await expect(celdasTotal.nth(1)).toHaveText('');
  await expect(celdasTotal.nth(2)).toContainText('$');
  await expect(celdasTotal.nth(3)).toContainText('$');
  // Cada cifra de dinero se explica y cuadra.
  await page.getByTestId('h-invertido').getByRole('button').click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
  await page.keyboard.press('Escape');
  // Vista semanal y diaria.
  await page.getByTestId('vista-semana').click();
  await page.waitForURL('**vista=semana**');
  await expect(page.getByRole('table', { name: 'Historial semanal de Angelo' })).toBeVisible();
  await page.getByTestId('vista-dia').click();
  await page.waitForURL('**vista=dia**');
  await expect(page.getByRole('table', { name: 'Historial diario de Angelo' })).toBeVisible();
  // PDF del estado de cuenta personal.
  const pdf = await page.request.get('/socios/Angelo/historial/pdf');
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // El otro socio se ve con el mismo detalle (50/50 transparente).
  await page.getByTestId('ver-historial-Javier').click();
  await page.waitForURL('**/socios/Javier/historial');
  await expect(page.getByRole('heading', { name: 'Historial de Javier' })).toBeVisible();
  await expect(page.getByTestId('h-invertido')).toContainText('Aportaciones $30,000.00');
});

test('en movil 390 el historial no tiene scroll horizontal de pagina', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  await sesion(page, 'Angelo', '/socios/Angelo/historial');
  await expect(page.getByRole('heading', { name: 'Historial de Angelo' })).toBeVisible();
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(extra).toBeLessThanOrEqual(1);
  await ctx.close();
});
