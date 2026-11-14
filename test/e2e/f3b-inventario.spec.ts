// Pantallas de F3b-2 en laptop 1440 (Chromium): inventario con semaforo de cobertura, exportar PDF y Compartir, kardex, conteo ciego, campana y avisos, inicio y paquetes.
// Todos los datos son ILUSTRATIVOS y los crea la propia prueba (nombres "E2E Inv ...").
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa, sembrarInventarioE2E, sembrarOperacionE2E } from './ayudas';

// Puerto del servidor de las pruebas (E2E_PUERTO permite correr en un puerto propio si el 3100 esta ocupado por otra sesion).
const BASE = process.env.APP_URL_E2E ?? `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3100'}`;

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

const SUF = Date.now().toString(36);
const URGE = `E2E Inv Urge ${SUF}`;
const SOBRE = `E2E Inv Sobre ${SUF}`;

test.beforeAll(async () => {
  await sembrarOperacionE2E();
  await sembrarInventarioE2E(SUF);
});

async function sesion(page: Page, ruta: string) {
  const correo = correoUnico('f3bi');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, ruta);
}

test('inventario: el semaforo de cobertura habla en palabras y la cobertura se explica por dos vias', async ({ page }) => {
  await sesion(page, '/inventario');
  await expect(page.getByTestId('inv-valor')).not.toContainText('Sin dato');
  const fila = page.getByRole('row').filter({ hasText: URGE }).first();
  await expect(fila).toContainText('Urge pedir');
  await expect(page.getByRole('row').filter({ hasText: SOBRE }).first()).toContainText('Sobrestock');
  await fila.getByRole('button', { name: /d\. Explicar este número/ }).click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
  await page.keyboard.press('Escape');
  await page.getByTestId('filtro-estado').click();
  await page.getByRole('link', { name: /Por reponer/ }).click();
  await expect(page.getByRole('row').filter({ hasText: URGE }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: SOBRE })).toHaveCount(0);
});

test('exportar PDF: version clientes e interna con folio, huella y reapertura identica', async ({ page }) => {
  await sesion(page, '/inventario');
  await page.getByTestId('exportar-abrir').click();
  await page.getByTestId('exportar-generar').click();
  const res = page.getByTestId('exportar-resultado');
  await expect(res).toContainText(/INV-\d{4}/);
  const href = (await page.getByTestId('exportar-ver').getAttribute('href'))!;
  const a = await page.request.get(href);
  expect(a.status()).toBe(200);
  expect(a.headers()['content-type']).toBe('application/pdf');
  const cuerpo = await a.body();
  expect(cuerpo.subarray(0, 5).toString()).toBe('%PDF-');
  const b = await page.request.get(href);
  expect(b.headers()['x-huella-sha256']).toBe(a.headers()['x-huella-sha256']);
  expect((await b.body()).equals(cuerpo)).toBe(true);
  await page.getByTestId('exportar-version').selectOption('interna');
  await page.getByTestId('exportar-generar').click();
  await expect(res).toContainText(/INV-\d{4}/);
  const hrefInterna = (await page.getByTestId('exportar-ver').getAttribute('href'))!;
  expect(hrefInterna).not.toBe(href);
  const guardado = await consultar<{ version: string; n: string }>("select version, count(*)::text as n from operacion.documento_inventario where contenido is not null group by 1 order by 1");
  expect(guardado.map((g) => g.version)).toEqual(['clientes', 'interna']);
  // el PDF de clientes no se puede pedir sin sesion
  const anonimo = await page.context().browser()!.newContext();
  const r = await anonimo.request.get(`${BASE}${href}`, { maxRedirects: 0 });
  expect([307, 308, 401, 403, 404]).toContain(r.status());
  await anonimo.close();
});

test('compartir: en laptop descarga el PDF y ofrece abrir WhatsApp con el texto escrito', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await sesion(page, '/inventario');
  await page.getByTestId('exportar-abrir').click();
  await page.getByTestId('exportar-generar').click();
  await page.getByTestId('exportar-resultado').waitFor();
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.getByTestId('exportar-compartir').click()]);
  expect(descarga.suggestedFilename()).toMatch(/^INV-\d{4}-disponible\.pdf$/);
  await expect(page.getByTestId('exportar-aviso')).toContainText('Se descargó el PDF');
  const wa = await page.getByTestId('exportar-whatsapp').getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/\?text=/);
  expect(decodeURIComponent(wa!)).not.toMatch(/\$|costo|utilidad/i);
});

test('compartir: con la hoja nativa se entrega el PDF como archivo', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__compartido = null;
    Object.defineProperty(navigator, 'canShare', { value: (d: { files?: File[] }) => Boolean(d.files?.length), configurable: true });
    Object.defineProperty(navigator, 'share', { value: async (d: { files: File[]; text: string }) => { (window as unknown as Record<string, unknown>).__compartido = { archivos: d.files.length, tipo: d.files[0]?.type, nombre: d.files[0]?.name, bytes: d.files[0]?.size, texto: d.text }; }, configurable: true });
  });
  await sesion(page, '/inventario');
  await page.getByTestId('exportar-abrir').click();
  await page.getByTestId('exportar-generar').click();
  await page.getByTestId('exportar-resultado').waitFor();
  await page.getByTestId('exportar-compartir').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Record<string, unknown>).__compartido)).not.toBeNull();
  const c = (await page.evaluate(() => (window as unknown as Record<string, unknown>).__compartido)) as { archivos: number; tipo: string; nombre: string; bytes: number; texto: string };
  expect(c.archivos).toBe(1);
  expect(c.tipo).toBe('application/pdf');
  expect(c.nombre).toMatch(/\.pdf$/);
  expect(c.bytes).toBeGreaterThan(1000);
  expect(c.texto).not.toMatch(/\$|costo|utilidad/i);
});

test('kardex: movimientos con saldo y costo promedio, comprobacion por dos vias y CSV', async ({ page }) => {
  const id = (await consultar<{ id: string }>('select id::text from catalogo.modelo where nombre_canonico = $1', [URGE]))[0]!.id;
  await sesion(page, `/inventario/kardex?modelo=${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(URGE);
  await expect(page.getByTestId('kardex-comprobacion')).toContainText('Cuadra');
  await expect(page.getByRole('row').filter({ hasText: 'Entrada de compra' }).first()).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Salida de pedido' }).first()).toBeVisible();
  const csv = await page.request.get(await page.getByTestId('kardex-exportar').getAttribute('href') as string);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('Entra piezas,Entra unitario,Entra total');
});

test('conteo ciego: se cuenta, se ve la diferencia, se explica, se cierra y avisa', async ({ page }) => {
  await sesion(page, '/inventario/conteo');
  const campos = page.locator('[data-testid^="contado-"]');
  await expect(page.getByTestId('conteo-hoja')).not.toContainText('esperado');
  await campos.first().waitFor();
  const total = await campos.count();
  for (let i = 0; i < total; i += 1) await campos.nth(i).fill('0');
  await expect(page.getByTestId('conteo-ver')).toBeEnabled();
  await page.getByTestId('conteo-ver').click();
  const rev = page.getByTestId('conteo-revision');
  await expect(rev).toContainText('Diferencias contra el sistema');
  await expect(rev).toContainText('En la bodega');
  const primero = rev.locator('select').first();
  await primero.selectOption('merma');
  await page.getByTestId('conteo-cerrar').click();
  await expect(page.getByTestId('conteo-cerrado')).toContainText('Conteo cerrado');
  const avisos = await consultar<{ n: string }>("select count(*)::text as n from operacion.aviso where codigo = 'conteo_con_diferencia' and estado = 'abierta'");
  expect(Number(avisos[0]!.n)).toBeGreaterThanOrEqual(1);
});

test('campana: pestañas Todas y Sin leer, marcar leido y avisos', async ({ page }) => {
  await sesion(page, '/');
  const cuenta = page.getByTestId('campana-cuenta');
  await expect(cuenta).toBeVisible();
  await page.getByTestId('campana').click();
  await expect(page.getByTestId('campana-panel')).toBeVisible();
  await expect(page.getByTestId('campana-sin_leer')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('campana-item').first()).toBeVisible();
  await page.getByTestId('campana-todas').click();
  await expect(page.getByTestId('campana-todas')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Marcar todo como leído' }).click();
  await expect(page.getByTestId('campana-cuenta')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/avisos?pestana=sin_leer');
  await expect(page.getByText('No tienes avisos sin leer')).toBeVisible();
  await page.goto('/avisos?pestana=todas');
  await expect(page.getByRole('row').filter({ hasText: 'Conteo cerrado' }).first()).toBeVisible();
  await expect(page.getByText(/cliente de /)).toHaveCount(0);
});

test('inicio: los cuatro indicadores del pulso con datos reales y Tu turno', async ({ page }) => {
  await sesion(page, '/');
  await expect(page.getByTestId('inicio-bodega')).not.toContainText('Sin dato');
  await expect(page.getByTestId('inicio-isaac')).toBeVisible();
  await expect(page.getByTestId('inicio-cobrar')).toBeVisible();
  await expect(page.getByTestId(/^inicio-(socios|valuacion)$/)).toBeVisible();
  await expect(page.getByTestId('pulso-bodega').first()).not.toContainText('Sin dato');
  await expect(page.getByRole('heading', { name: 'Tu turno' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Por reponer' })).toBeVisible();
});

test('paquetes por hacer y en trayecto: resumen, sin dueño y con antiguedad', async ({ page }) => {
  await sesion(page, '/paquetes/por-hacer');
  await expect(page.getByTestId('ph-por-empacar')).toBeVisible();
  await expect(page.getByTestId('ph-atrasados')).toBeVisible();
  await expect(page.getByText(/Dueño:/)).toHaveCount(0);
  await page.goto('/paquetes/en-trayecto');
  await expect(page.getByTestId('pt-ordenes')).toBeVisible();
  await expect(page.getByTestId('pt-piezas')).toContainText('(no son existencia)');
});
