// Casos transversales T01 a T16 por patron (un formulario representativo por patron, no todos): campos vacios, montos, doble clic, idempotencia con corte de red,
// teclado y foco, navegacion con rutas invalidas y sesion vencida. Laptop 1440. ESCRITA Y TIPADA, NO EJECUTADA.
import { expect, test } from '@playwright/test';
import { consultar, contarEventos, ipFalsa, sembrarQA, sesionSocio, type DatosQA } from './punta_a_punta_ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosQA;
test.beforeAll(async () => {
  d = await sembrarQA();
});

async function abrirAportacion(page: import('@playwright/test').Page) {
  await page.getByTestId('aportacion').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test('T01 campos vacios en FormularioAccion: mensaje local "Falta:" y ninguna llamada a la base', async ({ page }) => {
  await sesionSocio(page, '/socios');
  const antes = await contarEventos('aportacion_socio');
  await abrirAportacion(page);
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toContainText(/Falta:/);
  expect(await contarEventos('aportacion_socio')).toBe(antes);
  // Con monto pero sin motivo (la intencion del deposito) sigue faltando el motivo.
  await page.getByTestId('campo-p_monto_cent').fill('10');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toContainText(/Falta: motivo/i);
  expect(await contarEventos('aportacion_socio')).toBe(antes);
});

test('T01 pedido sin renglones: "Agrega al menos un renglón." y DialogoSimple sin motivo: "Escribe el motivo."', async ({ page }) => {
  await sesionSocio(page, `/pedidos/nuevo?cliente=${d.clienteId}`);
  const antes = await contarEventos('pedido_creado');
  await page.getByTestId('crear-pedido').click();
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('Agrega al menos un renglón.');
  expect(await contarEventos('pedido_creado')).toBe(antes);
  await page.goto(`/pedidos/${d.pedidoBodegaId}`);
  const anulados = await contarEventos('pedido_anulado');
  await page.getByTestId('anular-pedido').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toContainText('Escribe el motivo.');
  expect(await contarEventos('pedido_anulado')).toBe(anulados);
});

test('T02 montos invalidos en el formulario de aportacion: 0, 0.00, -5, 9000.505, abc, 1e3, 9., .5 y 16 digitos muestran "Escribe un monto válido"', async ({ page }) => {
  await sesionSocio(page, '/socios');
  const antes = await contarEventos('aportacion_socio');
  await abrirAportacion(page);
  await page.getByTestId('campo-p_concepto').fill('Prueba de montos');
  for (const malo of ['0', '0.00', '-5', '9000.505', 'abc', '1e3', '9.', '.5', '9999999999999999']) {
    await page.getByTestId('campo-p_monto_cent').fill(malo);
    await page.getByTestId('confirmar').click();
    await expect(page.getByRole('dialog'), `monto ${malo}`).toContainText(/Escribe un monto válido/);
  }
  expect(await contarEventos('aportacion_socio')).toBe(antes);
});

test('T02 H-29 (corregido): "9,5" es ambiguo y se rechaza en vez de leerse como $95.00', async ({ page }) => {
  await sesionSocio(page, '/socios');
  await abrirAportacion(page);
  await page.getByTestId('campo-p_concepto').fill('Coma ambigua');
  await page.getByTestId('campo-p_monto_cent').fill('9,5');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toContainText(/Escribe un monto válido/);
});

test('T04 doble clic en Crear pedido y Enter repetido: un solo evento', async ({ page }) => {
  await sesionSocio(page, `/pedidos/nuevo?cliente=${d.clienteId}`);
  const antes = await contarEventos('pedido_creado');
  await page.getByTestId('modelo').selectOption((await page.locator('[data-testid=modelo] option', { hasText: d.modeloA }).getAttribute('value'))!);
  await page.getByTestId('sabor').selectOption({ index: 1 });
  await page.getByTestId('piezas').fill('25');
  await page.getByTestId('agregar-renglon').click();
  await page.getByTestId('crear-pedido').dblclick();
  await page.waitForURL(/\/pedidos\/\d+$/);
  expect((await contarEventos('pedido_creado')) - antes).toBe(1);
});

test('T05(c) corte de red tras el exito: la respuesta se pierde, el usuario reintenta con la MISMA clave y queda un solo asiento', async ({ page }) => {
  await sesionSocio(page, '/socios');
  const concepto = `Corte de red ${d.sufijo}`;
  let perdida = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!perdida && req.method() === 'POST' && req.headers()['next-action']) {
      perdida = true;
      await route.fetch(); // la base SI recibe y guarda la captura...
      await route.abort('connectionreset'); // ...pero la respuesta nunca llega al navegador
      return;
    }
    await route.continue();
  });
  await abrirAportacion(page);
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  await page.getByTestId('campo-p_monto_cent').fill('12');
  await page.getByTestId('campo-p_concepto').fill(concepto);
  await page.getByTestId('confirmar').click();
  await expect.poll(() => perdida).toBe(true);
  await page.getByTestId('confirmar').click(); // reintento: misma clave `web:<uuid>` porque el exito no se registro en el cliente
  await expect.poll(async () => Number((await consultar<{ n: string }>('select count(*)::int as n from operacion.aportacion_socio where concepto = $1 and reversa_de is null', [concepto]))[0]!.n)).toBe(1);
});

test('T05(d) repetir la MISMA intencion a proposito tras un exito crea dos asientos (no hay deteccion semantica de duplicados; ver GD-19 y H6)', async ({ page }) => {
  await sesionSocio(page, '/socios');
  const concepto = `Repetida a proposito ${d.sufijo}`;
  for (let i = 0; i < 2; i++) {
    await abrirAportacion(page);
    await page.getByTestId('campo-p_socio').selectOption('Angelo');
    await page.getByTestId('campo-p_monto_cent').fill('7');
    await page.getByTestId('campo-p_concepto').fill(concepto);
    await page.getByTestId('confirmar').click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  const n = Number((await consultar<{ n: string }>('select count(*)::int as n from operacion.aportacion_socio where concepto = $1 and reversa_de is null', [concepto]))[0]!.n);
  expect(n).toBe(2);
});

test('T10 teclado en los dialogos: foco inicial en Cancelar, el foco queda atrapado con Tab/Shift+Tab, Esc cierra y devuelve el foco al boton', async ({ page }) => {
  await sesionSocio(page, '/socios');
  const boton = page.getByTestId('aportacion');
  await boton.click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  // En Chromium un <dialog> modal cicla por la interfaz del navegador (activeElement = body): lo prohibido es que el foco llegue a la pagina de fondo.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialogo.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body), `Tab ${i + 1} sigue dentro del dialogo`).toBe(true);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await dialogo.evaluate((el) => el.contains(document.activeElement) || document.activeElement === document.body), `Shift+Tab ${i + 1} sigue dentro del dialogo`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(boton).toBeFocused();
});

test('T10 error de la base anunciado: un fallo aparece en un elemento con role=alert dentro del dialogo', async ({ page }) => {
  await sesionSocio(page, '/socios');
  await page.getByTestId('pago-a-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('99999999');
  await page.getByTestId('campo-p_tipo').selectOption('reembolso');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
});

test('T15 rutas invalidas: nunca un 500 ni la pantalla generica de error', async ({ page }) => {
  await sesionSocio(page, '/');
  const rutas = [
    '/pedidos/abc', '/pedidos/0', '/pedidos/99999999', '/pedidos/-1', '/clientes/abc', '/clientes/99999999', '/socios/Omar', '/socios/angelo ',
    '/proveedores?p=otro', '/proveedores/liquidacion?semana=basura', '/proveedores/liquidacion?p=Isaac&semana=2027-02-31', '/proveedores/compras/abc', '/proveedores/compras/99999999',
    '/catalogo?modelo=9999999', '/catalogo?q=%25%27%22', '/pedidos?estado=zzz', '/cuentas-por-cobrar?desde=hoy', '/socios/cascada?caja=abc', '/omar?semana=basura', '/avisos?estado=zzz',
    '/notas/99999999/pdf',
  ];
  for (const ruta of rutas) {
    const r = await page.goto(ruta);
    expect(r?.status() ?? 0, `${ruta}: estado HTTP`).toBeLessThan(500);
    await expect(page.locator('body'), `${ruta}: pantalla generica de error`).not.toContainText(/Application error|Internal Server Error/i);
  }
});

test('T15 H-30 (corregido por diseno): la cascada ya no acepta una caja tecleada; ?caja=-500 se ignora y el efectivo sale de las cajas', async ({ page }) => {
  await sesionSocio(page, '/socios/cascada');
  const base = await page.getByTestId('efectivo-calculado').innerText();
  await page.goto('/socios/cascada?caja=-500');
  await expect(page.getByTestId('efectivo-calculado')).toHaveText(base);
  await expect(page.locator('main:not(.rtm-documento)')).not.toContainText(/-\$500\.00|−\$500\.00/);
});

test('T15 atras y adelante despues de una accion y F5 con el dialogo abierto no repiten ni rompen nada', async ({ page }) => {
  await sesionSocio(page, '/socios');
  await abrirAportacion(page);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.goto('/inventario');
  await page.goBack();
  await expect(page).toHaveURL(/\/socios$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/inventario$/);
});

test('T16 sesion vencida con un dialogo abierto: confirmar no pierde nada en silencio (redirige al acceso o avisa) y no escribe', async ({ page, context }) => {
  await sesionSocio(page, '/socios');
  const antes = await contarEventos('aportacion_socio');
  await abrirAportacion(page);
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  await page.getByTestId('campo-p_monto_cent').fill('5');
  await page.getByTestId('campo-p_concepto').fill(`Sesion vencida ${d.sufijo}`);
  await context.clearCookies();
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => /\/login/.test(page.url()) || (await page.getByRole('dialog').getByRole('alert').count()) > 0).toBe(true);
  expect(await contarEventos('aportacion_socio')).toBe(antes);
});

test('T13 H-33 (PENDIENTE): una lectura que falla muestra "No se pudo cargar" con una accion, no la pantalla de Next', async ({ page }) => {
  // error.tsx ya existe, pero esta simulacion (fulfill 500 del documento) devuelve texto plano y nunca llega al limite de error de la app: hace falta
  // forzar una falla de api.* en la base (por ejemplo revocando el permiso de la funcion dentro de una transaccion de prueba) para ejercer error.tsx.
  test.fixme(true, 'H-33: falta un mecanismo para fallar una lectura del servidor sin tocar produccion; error.tsx existe y se ve en pantalla (ver F00/H-32)');
  await sesionSocio(page, '/pedidos');
  // Se simula el fallo de la lectura interceptando la peticion de datos del servidor para la ruta.
  await page.route('**/pedidos?*', (route) => route.fulfill({ status: 500, body: 'fallo simulado' }));
  await page.goto('/pedidos?estado=borrador');
  await expect(page.getByText(/No se pudo cargar/i)).toBeVisible();
});

test('M-06 despues de cerrar sesion, Atras no muestra datos protegidos', async ({ page }) => {
  await sesionSocio(page, '/pedidos');
  await page.getByTestId('cerrar-sesion').click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await page.reload();
  // Atras puede dejar en la pantalla publica de confirmacion del enlace ya usado o en el acceso; nunca en la pagina protegida ni con sus datos.
  await expect(page).toHaveURL(/\/(login|auth\/confirm)/);
  await expect(page.getByTestId('cerrar-sesion')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Por cobrar|Pedidos y notas/);
  await page.goto('/pedidos');
  await expect(page).toHaveURL(/\/login/);
});
