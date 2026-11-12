// Pantallas de F3a en laptop 1440 (Chromium): hoja y liquidacion con el proveedor, cuenta de socios con aportacion, gasto y deshacer, estado de cuenta,
// cascada con cierre firmado por los dos, cuenta con Omar y cuentas por cobrar con recargo y texto de cobro. Datos ILUSTRATIVOS de ayudas.ts.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E, type DatosF3a } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosF3a;
test.beforeAll(async () => {
  d = await sembrarCuentasE2E();
});

async function sesion(page: Page, ruta: string, socio: 'Angelo' | 'Javier' = 'Javier') {
  const correo = correoUnico('f3a');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, ruta);
}

test('hoja de Isaac: falta por saldar con comprobacion, lo que dice el proveedor y el texto para el proveedor', async ({ page }) => {
  await sesion(page, '/proveedores?p=Isaac');
  await expect(page.getByTestId('falta-por-saldar')).toBeVisible();
  await page.getByTestId('abrir-liquidacion').click();
  await page.waitForURL('**/proveedores/liquidacion**');
  await expect(page.getByTestId('comprobacion')).toContainText('Cuadra');
  await expect(page.getByText(d.folioDirecto).first()).toBeVisible();
  // Guias del dia: 307.00 de la guia del pedido directo se cuentan en la hoja.
  await page.getByTestId('ambito-todo').click();
  await page.waitForURL('**ambito=todo**');
  await expect(page.getByTestId('ambito-todo')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('comprobacion')).toContainText('Cuadra');
  await page.getByTestId('registrar-dicho').click();
  await page.getByTestId('dicho-total').fill('100');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('dicho')).toContainText('$100.00', { timeout: 20_000 });
  await expect(page.getByTestId('diferencia')).not.toContainText('Sin dato');
  await page.getByTestId('copiar-texto').click();
  await expect(page.getByTestId('texto-copiable')).toContainText('Falta por saldar');
  await expect(page.getByTestId('texto-copiable')).not.toContainText(d.cliente);
  await page.getByTestId('falta-por-saldar').getByRole('button').click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
});

test('cuenta de socios: aportacion con eco, gasto pagado por un socio, deshacer y estado de cuenta', async ({ page }) => {
  await sesion(page, '/socios');
  await page.getByTestId('aportacion').click();
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  await page.getByTestId('campo-p_monto_cent').fill('1000');
  await page.getByTestId('campo-p_concepto').fill(`Capital E2E ${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await expect(page.getByText(`Capital E2E ${d.sufijo}`)).toBeVisible();
  await page.getByTestId('gasto-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('500');
  await page.getByTestId('campo-p_categoria').fill(`envio E2E ${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await expect(page.getByText(`envio E2E ${d.sufijo}`, { exact: false }).first()).toBeVisible();
  // Deshacer la aportacion.
  const fila = page.getByRole('row').filter({ hasText: `Capital E2E ${d.sufijo}` });
  await fila.getByRole('button', { name: 'Deshacer' }).click();
  await page.getByTestId('campo-motivo').fill('captura de prueba');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: `Capital E2E ${d.sufijo}` }).first()).toContainText('deshecho');
  const quien = await consultar<{ autor: string | null }>("select u.socio_nombre as autor from operacion.evento e left join seguridad.usuario u on u.id = e.actor_id where e.tipo = 'gasto_socio' order by e.id desc limit 1");
  expect(quien[0]!.autor).toBe('Javier');
  await page.getByTestId('estado-Angelo').click();
  await page.waitForURL('**/socios/Angelo');
  await expect(page.getByTestId('neto-socio')).toBeVisible();
  await page.getByTestId('neto-socio').getByRole('button').click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
});

test('cascada de reparto: cinco pasos, proyeccion y cierre firmado por los dos socios', async ({ page, browser }) => {
  await sesion(page, '/socios/cascada');
  await expect(page.getByText('3. Orden de pago con ese efectivo')).toBeVisible();
  await expect(page.getByText('5. Saldo entre socios')).toBeVisible();
  await expect(page.getByTestId('utilidad-neta')).toBeVisible();
  // Periodo ya terminado (semana anterior): se propone el cierre y firman los dos.
  await page.getByTestId('semana-anterior').click();
  await page.getByTestId('proponer-cierre').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Propuesto: faltan las dos firmas')).toBeVisible();
  await page.getByRole('button', { name: 'Firmar' }).first().click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Firmado por uno: falta el otro socio')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Firmar' })).toHaveCount(0);
  // El otro socio firma desde su propia sesion.
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const otra = await ctx.newPage();
  const correo = correoUnico('f3a-otro');
  await altaUsuario({ correo, socio: 'Angelo' });
  await entrarComo(otra, correo, '/socios/cascada');
  await otra.getByTestId('semana-anterior').click();
  await otra.getByRole('button', { name: 'Firmar' }).first().click();
  await otra.getByTestId('confirmar').click();
  await expect(otra.getByText('Cerrado y firmado por los dos')).toBeVisible();
  await ctx.close();
});

test('cuenta con Omar: neto de la semana, toma por un socio y pendientes', async ({ page }) => {
  await sesion(page, '/omar');
  await expect(page.getByText('Omar (bodega) ≠ Omar Aguilar (cliente)')).toBeVisible();
  await expect(page.getByTestId('neto-omar')).toBeVisible();
  await expect(page.getByTestId('palabra-omar')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Renta' }).first().or(page.getByText('Renta por pieza surtida'))).toBeVisible();
  const antes = (await consultar<{ n: number }>('select count(*)::int as n from operacion.toma_omar'))[0]!.n;
  await page.getByTestId('nueva-toma').click();
  await page.getByTestId('campo-p_sku_id').selectOption({ index: 0 });
  await page.getByTestId('campo-p_piezas').fill('1');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar<{ n: number }>('select count(*)::int as n from operacion.toma_omar'))[0]!.n).toBe(antes + 1);
  const quien = await consultar<{ estado: string }>('select estado from operacion.toma_omar order by id desc limit 1');
  expect(quien[0]!.estado).toBe('autorizada');
});

test('cuentas por cobrar: vencido, plazo, recargo por credito y texto de cobro', async ({ page }) => {
  await sesion(page, '/cuentas-por-cobrar');
  await expect(page.getByText('Vencido').first()).toBeVisible();
  await page.getByTestId(`recargo-${d.pedidoVencidoId}`).click();
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar<{ n: number }>("select count(*)::int as n from operacion.nota where pedido_id = $1 and tipo = 'correccion'", [d.pedidoVencidoId]))[0]!.n).toBe(1);
  await page.reload();
  // El recordatorio de cobro vive en la tabla por cliente (vista=cliente) del rediseno.
  await page.goto('/cuentas-por-cobrar?vista=cliente');
  await page.getByTestId('copiar-texto').first().click();
  await expect(page.getByTestId('texto-copiable').first()).toContainText('Total por pagar');
});
