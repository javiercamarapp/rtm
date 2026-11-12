// Recorrido de TODAS las pantallas (22 rutas del socio + 3 publicas) en claro y oscuro, en el viewport del proyecto Playwright
// (laptop 1440, iPhone 16 Pro 402x874, plegable cerrado 344x880 y abierto 880x860), con captura como evidencia.
// Cubre T08 (temas), T09 (viewports), T13 (vacios), H-32 a H-61. ESCRITA Y TIPADA, NO EJECUTADA.
import { expect, test } from '@playwright/test';
import {
  TEMAS, camposChicos, capturar, contrasteDeBordesDeCampo, contrasteDeTextos, fijarTema, huecosMuertos, ipFalsa, objetivosDe44, rutasSocio, RUTAS_PUBLICAS,
  sembrarQA, sesionSocio, sinScrollHorizontal, vigilarErrores, type DatosQA,
} from './punta_a_punta_ayudas';

// Las pantallas y los botones no dependen unos de otros: un fallo no debe ocultar el resto (cada prueba abre su propia sesion).
test.describe.configure({ mode: 'default' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosQA;
test.beforeAll(async () => {
  d = await sembrarQA();
});

for (const tema of TEMAS) {
  test.describe(`tema ${tema}: rutas publicas`, () => {
    for (const { id, ruta } of RUTAS_PUBLICAS) {
      test(`${id} ${ruta}`, async ({ page }, info) => {
        await fijarTema(page, tema);
        const vigia = vigilarErrores(page);
        const r = await page.goto(ruta);
        expect(r?.status() ?? 0).toBeLessThan(400);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
        await sinScrollHorizontal(page);
        if ((page.viewportSize()?.width ?? 1440) < 1024) expect(await camposChicos(page)).toEqual([]);
        expect(await contrasteDeTextos(page)).toEqual([]);
        expect(vigia.errores).toEqual([]);
        await capturar(page, info, tema, id);
      });
    }
  });

  test.describe(`tema ${tema}: rutas del socio`, () => {
    test.beforeEach(async ({ page }) => {
      await fijarTema(page, tema);
    });

    test('el tema se conserva al navegar y al recargar', async ({ page }) => {
      await sesionSocio(page, '/pedidos');
      await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
      await page.goto('/inventario');
      await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
    });

    for (const idx of Array.from({ length: 25 }, (_, i) => i)) {
      test(`ruta ${idx + 1} de 25`, async ({ page }, info) => {
        const ruta = rutasSocio(d)[idx]!;
        await sesionSocio(page, '/');
        const vigia = vigilarErrores(page);
        const r = await page.goto(ruta.ruta);
        expect(r?.status() ?? 0, `${ruta.id}: estado HTTP`).toBeLessThan(400);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
        await expect(page.getByRole('heading').first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
        await expect(page.locator('body')).not.toContainText(/Application error|Internal Server Error|This page could not be found/i);

        // T09: sin scroll horizontal, campos de 16 px; objetivos de 44 px en pantallas tactiles.
        await sinScrollHorizontal(page);
        // La letra de 16 px evita el zoom de iOS al enfocar: aplica a pantallas tactiles y angostas (menos de 1024), igual que los objetivos de 44 px.
        if ((page.viewportSize()?.width ?? 1440) < 1024) expect(await camposChicos(page), `${ruta.id}: campos con letra menor de 16 px`).toEqual([]);
        if ((page.viewportSize()?.width ?? 1440) < 1024) expect(await objetivosDe44(page), `${ruta.id}: objetivos tactiles menores de 44 px`).toEqual([]);

        // T08: contraste real de cada texto visible (4.5; 3 para texto grande).
        expect(await contrasteDeTextos(page), `${ruta.id}: textos con contraste insuficiente en tema ${tema}`).toEqual([]);

        // H-42 a H-48: espacios muertos.
        expect(await huecosMuertos(page), `${ruta.id}: bloques con mas de 160 px de espacio vacio`).toEqual([]);
        expect(vigia.errores, `${ruta.id}: errores de consola o de pagina`).toEqual([]);
        await capturar(page, info, tema, ruta.id);
      });
    }

    test('H-53 (corregido en la integracion): el contorno de los campos llega a 3:1 en /pedidos/nuevo', async ({ page }) => {
      await sesionSocio(page, `/pedidos/nuevo?cliente=${d.clienteId}`);
      expect(await contrasteDeBordesDeCampo(page)).toEqual([]);
    });

    test('H-17 (corregido en la integracion): sin chips ni columnas por dueño (Angelo o Javier) en Pedidos, Clientes y Paquetes por hacer', async ({ page }) => {
      await sesionSocio(page, '/pedidos');
      await expect(page.getByRole('link', { name: /^De Angelo$/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /^De Javier$/ })).toHaveCount(0);
      await page.goto('/clientes');
      await expect(page.getByRole('link', { name: /^De Angelo$/ })).toHaveCount(0);
      await page.goto('/paquetes/por-hacer');
      await expect(page.locator('main:not(.rtm-documento)')).not.toContainText(/Dueño:/);
    });

    test('H-32 (corregido en la integracion): una ruta inexistente muestra una pagina propia con salida, no la de Next', async ({ page }) => {
      await sesionSocio(page, '/');
      await page.goto('/pedidos/99999999');
      await expect(page.getByRole('link', { name: /Pedidos|Inicio/ }).first()).toBeVisible();
      await expect(page.locator('body')).not.toContainText('This page could not be found');
    });
  });
}

test('menu movil: se abre, navega a cada seccion y se cierra (solo anchos menores de 768)', async ({ page }, info) => {
  test.skip((page.viewportSize()?.width ?? 1440) >= 768, 'desde 768 px la barra lateral es fija (shell.css)');
  await sesionSocio(page, '/');
  const secciones = ['Pedidos y notas', 'Paquetes por hacer', 'Paquetes en trayecto', 'Cuentas por cobrar', 'Catálogo y precios', 'Clientes', 'Inventario', 'Proveedores', 'Cuenta de socios', 'Cuenta con Omar', 'Avisos'];
  for (const nombre of secciones) {
    await page.getByRole('button', { name: /Abrir menú/i }).click();
    await expect(page.getByRole('button', { name: /Abrir menú/i })).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('link', { name: nombre }).first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /Abrir menú/i })).toHaveAttribute('aria-expanded', 'false');
  }
  await capturar(page, info, 'sin-tema', 'menu-movil-final');
});

test('plegado a desplegado en vivo: lo escrito en un formulario largo se conserva (solo plegable)', async ({ page }) => {
  test.skip(!/^fold/.test(test.info().project.name), 'solo aplica al plegable');
  await sesionSocio(page, `/pedidos/nuevo?cliente=${d.clienteId}`);
  await page.getByTestId('piezas').fill('37');
  await page.getByTestId('envio').fill('425');
  const alto = page.viewportSize()!.height;
  await page.setViewportSize({ width: 880, height: 860 });
  await page.setViewportSize({ width: 344, height: alto });
  await expect(page.getByTestId('piezas')).toHaveValue('37');
  await expect(page.getByTestId('envio')).toHaveValue('425');
  await sinScrollHorizontal(page);
});
