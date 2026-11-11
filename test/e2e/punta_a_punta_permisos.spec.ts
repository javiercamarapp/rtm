// T07 permisos: sin sesion, Angelo y Javier (un solo negocio), Omar, correo fuera de la lista, cuenta inactiva, `next` externo y llamadas directas a la API REST.
// Laptop 1440. ESCRITA Y TIPADA, NO EJECUTADA.
import { expect, test } from '@playwright/test';
import { altaUsuario, correoUnico, ipFalsa, sembrarQA, sesionSocio, rutasSocio, type DatosQA } from './punta_a_punta_ayudas';
import { contarUsuariosAuth, enlaceConfirmacion, estado } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosQA;
test.beforeAll(async () => {
  d = await sembrarQA();
});

test.describe('sin sesion', () => {
  for (const idx of Array.from({ length: 25 }, (_, i) => i)) {
    test(`ruta protegida ${idx + 1} de 25 pide acceso y conserva el destino`, async ({ page }) => {
      const ruta = rutasSocio(d)[idx]!;
      await page.goto(ruta.ruta);
      await expect(page).toHaveURL(/\/login/);
      const next = new URL(page.url()).searchParams.get('next');
      expect(next, `${ruta.id}: next`).toBeTruthy();
      expect(next!.startsWith('/')).toBe(true);
    });
  }

  test('las rutas publicas abren y /api/health responde ok', async ({ page }) => {
    for (const ruta of ['/login', '/terminos', '/privacidad']) expect((await page.goto(ruta))?.status()).toBe(200);
    const h = await page.request.get('/api/health');
    expect(h.status()).toBe(200);
    expect((await h.json()) as { ok: boolean }).toMatchObject({ ok: true });
  });
});

test('Angelo y Javier ven las mismas pantallas y los mismos datos (un solo negocio)', async ({ page, browser }) => {
  await sesionSocio(page, '/', 'Angelo');
  const otra = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pj = await otra.newPage();
  await sesionSocio(pj, '/', 'Javier');
  for (const ruta of ['/pedidos', '/catalogo', '/inventario', '/clientes', '/cuentas-por-cobrar', '/proveedores?p=Isaac', '/socios', '/socios/cascada', '/avisos']) {
    await page.goto(ruta);
    await pj.goto(ruta);
    const a = await page.locator('main').innerText();
    const j = await pj.locator('main').innerText();
    expect(j, `${ruta}: mismo contenido para los dos socios`).toBe(a);
  }
  await otra.close();
});

test('Omar (rol omar, desactivado hasta M2) no entra a ninguna pantalla de socio', async ({ page }) => {
  const correo = correoUnico('pap-omar');
  await altaUsuario({ correo, rol: 'omar', activo: true });
  const enlace = await enlaceConfirmacion(correo, '/pedidos');
  await page.goto(enlace);
  await page.getByTestId('confirmar-acceso').click().catch(() => undefined);
  for (const ruta of ['/pedidos', '/socios', '/omar', '/inventario']) {
    await page.goto(ruta);
    await expect(page.locator('body')).not.toContainText('Pedidos y notas');
  }
});

test('cuenta de socio inactiva con enlace valido no abre sesion', async ({ page }) => {
  const correo = correoUnico('pap-inactivo');
  await altaUsuario({ correo, socio: 'Javier', activo: false });
  const enlace = await enlaceConfirmacion(correo, '/pedidos').catch(() => null);
  if (enlace) {
    await page.goto(enlace);
    await page.getByTestId('confirmar-acceso').click().catch(() => undefined);
  }
  await page.goto('/pedidos');
  await expect(page).toHaveURL(/\/login/);
});

test('un `next` externo cae a la raiz despues de entrar', async ({ page }) => {
  const correo = correoUnico('pap-next');
  await altaUsuario({ correo, socio: 'Angelo' });
  await page.goto(await enlaceConfirmacion(correo, 'https://malo.example/robo'));
  await page.getByTestId('confirmar-acceso').click();
  await page.waitForLoadState('networkidle');
  expect(new URL(page.url()).origin).toBe((process.env.APP_URL_E2E ?? 'http://127.0.0.1:3100'));
  expect(new URL(page.url()).pathname).toBe('/');
});

test('correo fuera de la lista: misma respuesta, ninguna fila nueva en auth.users', async ({ page }) => {
  const antes = await contarUsuariosAuth();
  await page.goto('/login');
  await page.getByLabel(/correo/i).fill(correoUnico('pap-intruso'));
  await page.getByRole('button', { name: /Entrar con correo/i }).click();
  await expect(page.locator('main')).toContainText(/enviado|revisa/i);
  expect(await contarUsuariosAuth()).toBe(antes);
});

test('llamada directa a la API REST con el rol anonimo: ninguna funcion de negocio responde datos', async ({ request }) => {
  const e = estado();
  for (const fn of ['pedidos_lista', 'socios_cuenta', 'cuentas_por_cobrar', 'catalogo_modelos', 'inventario_existencia', 'avisos_lista', 'cascada_proyeccion', 'omar_cuenta']) {
    const r = await request.post(`${e.API_URL}/rest/v1/rpc/${fn}`, {
      headers: { apikey: e.ANON_KEY, authorization: `Bearer ${e.ANON_KEY}`, 'content-type': 'application/json', 'content-profile': 'api', 'accept-profile': 'api' },
      data: {},
    });
    expect([401, 403, 404], `${fn}: el rol anonimo no debe leer (estado ${r.status()})`).toContain(r.status());
  }
  // Las tablas tampoco se leen directo.
  const t = await request.get(`${e.API_URL}/rest/v1/pedido?select=*`, { headers: { apikey: e.ANON_KEY, authorization: `Bearer ${e.ANON_KEY}`, 'accept-profile': 'operacion' } });
  expect([401, 403, 404, 406]).toContain(t.status());
});
