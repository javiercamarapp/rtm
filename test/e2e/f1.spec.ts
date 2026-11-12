// Pantallas de F1 en laptop 1440 (Chromium): Catalogo y precios, Clientes y ficha, Inventario, "Explicar este numero", ConfirmDialog.
// La prueba crea y limpia sus propios datos ILUSTRATIVOS ("E2E Prueba ...").
import { expect, test } from '@playwright/test';
import { altaUsuario, correoUnico, entrarComo, ipFalsa, limpiarCatalogoE2E, sembrarCatalogoE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

test.beforeAll(async () => {
  await limpiarCatalogoE2E();
  await sembrarCatalogoE2E();
});
test.afterAll(async () => {
  await limpiarCatalogoE2E();
});

test('catalogo: filtra, muestra costos con "supuesto" y precios por cliente; el dialogo propio confirma la disponibilidad', async ({ page }) => {
  const dialogosNativos: string[] = [];
  page.on('dialog', (d) => { dialogosNativos.push(d.message()); void d.dismiss(); });
  const correo = correoUnico('f1-catalogo');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/catalogo');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('en el catálogo');
  await page.getByLabel('Buscar en el catálogo').fill('e2e prueba modelo');
  await page.getByRole('button', { name: 'Buscar' }).click();
  const fila = page.getByRole('row', { name: /E2E Prueba Modelo 50K/ });
  await expect(fila).toBeVisible();
  await expect(fila).toContainText('$200.00');
  await expect(fila).toContainText('$150.00');
  await expect(fila).toContainText('supuesto');
  await expect(fila).toContainText('Disponible');

  // Precios por cliente del modelo.
  await page.getByRole('region', { name: 'Modelos' }).getByRole('link', { name: 'E2E Prueba Modelo 50K' }).click();
  await expect(page.getByRole('heading', { name: /Precios por cliente: E2E Prueba Modelo 50K/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E Prueba Cliente/ })).toContainText('$260.00');

  // Disponibilidad reversible con ConfirmDialog propio: cancelar no cambia nada.
  const boton = page.getByRole('button', { name: /Marcar sin disponibilidad: E2E Prueba Modelo 50K/ });
  await boton.click();
  await expect(page.getByRole('dialog')).toContainText('Marcar sin disponibilidad ahora');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('row', { name: /E2E Prueba Modelo 50K/ })).toContainText('Disponible');
  await boton.click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row', { name: /E2E Prueba Modelo 50K/ }).first()).toContainText('Sin disponibilidad');
  // Los precios del cliente se conservan.
  await expect(page.getByRole('row', { name: /E2E Prueba Cliente/ })).toContainText('$260.00');
  // Y vuelve.
  await page.getByRole('button', { name: /Marcar disponible: E2E Prueba Modelo 50K/ }).click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row', { name: /E2E Prueba Modelo 50K/ }).first()).toContainText('Disponible');
  expect(dialogosNativos).toEqual([]);
});

test('clientes: lista sin dueno y ficha con tabulador, historial, grafica y "Explicar este numero"', async ({ page }) => {
  const correo = correoUnico('f1-clientes');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(page, correo, '/clientes');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/\d+ clientes?/);
  await expect(page.getByRole('link', { name: /De (Angelo|Javier)/ })).toHaveCount(0);
  await expect(page.getByText(/Dueño/)).toHaveCount(0);
  await page.getByRole('link', { name: 'E2E Prueba Cliente' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Prueba Cliente');
  const tab = page.getByRole('table', { name: /Tabulador de E2E Prueba Cliente/ });
  await expect(tab).toContainText('$260.00');
  // Margen = precio - costo: 260 - 200 = 60 (Isaac) y 260 - 150 = 110 (Karen, supuesto).
  await expect(tab).toContainText('$60.00');
  await expect(tab).toContainText('$110.00');
  // Historial: el precio anterior quedo "Reemplazado" y el nuevo "Vigente".
  const hist = page.getByRole('table', { name: /Historial de precios de E2E Prueba Cliente/ });
  await expect(hist).toContainText('Vigente');
  await expect(hist).toContainText('Reemplazado');
  await expect(page.getByRole('img', { name: /Precio de E2E Prueba Modelo 50K a lo largo del tiempo/ })).toBeVisible();

  // Explicar este numero: cajon con la comprobacion y cierre con Escape.
  await tab.getByRole('button', { name: /\$60\.00\. Explicar este número/ }).click();
  const cajon = page.getByTestId('explicar-cajon');
  await expect(cajon).toBeVisible();
  await expect(cajon).toContainText('Precio menos costo');
  await expect(cajon).toContainText('Isaac');
  await expect(cajon.getByText('Sí').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(cajon).toBeHidden();
});

test('inventario: sin movimientos muestra "Sin dato", nunca un cero', async ({ page }) => {
  const correo = correoUnico('f1-inv');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/inventario');
  const fila = page.getByRole('row', { name: /E2E Prueba Modelo 50K/ });
  await expect(fila).toContainText('Sin dato');
  await expect(fila).not.toContainText('0 pz');
  await expect(page.getByText('Bodega Omar').first()).toBeVisible();
});

test('el sidebar trae las secciones de F1 y el acento por omision es neutro', async ({ page }) => {
  const correo = correoUnico('f1-nav');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/catalogo');
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav.getByRole('link', { name: 'Catálogo y precios' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Clientes' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.acento ?? 'neutro')).toBe('neutro');
});
