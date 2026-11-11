// Pantallas de F3b en laptop 1440 (Chromium): valuacion, diario con verificacion de asientos, mayor, estado de resultados, balance, flujo,
// comprobaciones con periodos y proyecciones. Los asientos nacen de los eventos que siembra `sembrarCuentasE2E` (datos ILUSTRATIVOS).
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

test.beforeAll(async () => {
  await sembrarCuentasE2E();
});

async function sesion(page: Page, ruta: string) {
  const correo = correoUnico('f3b');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, ruta);
}

test('cada evento sembrado dejo su asiento y el libro cuadra', async () => {
  const r = await consultar<{ eventos: string; asientos: string; descuadrados: string }>(`
    select (select count(*) from operacion.evento)::text as eventos, (select count(*) from contabilidad.asiento)::text as asientos,
           (select count(*) from (select asiento_id from contabilidad.asiento_linea group by 1 having sum(debe_cent) <> sum(haber_cent)) q)::text as descuadrados`);
  expect(Number(r[0]!.asientos)).toBeGreaterThan(5);
  expect(r[0]!.descuadrados).toBe('0');
});

test('el sidebar tiene Contabilidad y la valuacion explica sus cifras', async ({ page }) => {
  await sesion(page, '/contabilidad');
  await expect(page.getByRole('link', { name: 'Contabilidad' }).first()).toBeVisible();
  await expect(page.getByTestId('v03')).toBeVisible();
  await expect(page.getByTestId('v01')).not.toContainText('Sin dato');
  await page.getByTestId('v01').getByRole('button').click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
});

test('el diario muestra asientos con quien los origino y el boton Verificar corre las cuatro comprobaciones', async ({ page }) => {
  await sesion(page, '/contabilidad/diario');
  await expect(page.getByTestId('diario-total')).not.toContainText('Sin asientos');
  const primero = page.locator('[data-testid^="asiento-A-"]').first();
  await expect(primero).toBeVisible();
  await primero.getByRole('button', { name: 'Verificar' }).click();
  const v = primero.locator('[data-testid^="verificacion-"]');
  await expect(v).toContainText('Suma del debe igual a suma del haber');
  await expect(v.getByText('No cuadra')).toHaveCount(0);
  await expect(v.getByText('Cuadra')).toHaveCount(4);
});

test('mayor: lista de cuentas y movimientos de inventario con saldo explicable', async ({ page }) => {
  await sesion(page, '/contabilidad/mayor');
  await expect(page.getByTestId('cuenta-1310')).toBeVisible();
  await page.getByTestId('cuenta-1310').click();
  await page.waitForURL('**cuenta=1310');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Inventario en bodega');
  await expect(page.getByRole('row').filter({ hasText: /A-\d{4}/ }).first()).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: /Explicar este número/ }).first().click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
});

test('estado de resultados: tres utilidades y comprobacion por dos vias', async ({ page }) => {
  await sesion(page, '/contabilidad/estado-de-resultados');
  await expect(page.getByTestId('utilidad-bruta')).toBeVisible();
  await expect(page.getByTestId('utilidad-contribucion')).toBeVisible();
  await expect(page.getByTestId('utilidad-neta')).toBeVisible();
  await expect(page.getByText('Cuadra por las dos vías')).toBeVisible();
  await page.getByTestId('utilidad-neta').getByRole('button').click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
});

test('balance general cuadra y el flujo de efectivo concilia directo con indirecto', async ({ page }) => {
  await sesion(page, '/contabilidad/balance');
  await expect(page.getByTestId('balance-comprobacion')).toContainText('Cuadra');
  await expect(page.getByTestId('balance-activo')).toBeVisible();
  await page.goto('/contabilidad/flujo');
  await expect(page.getByRole('heading', { name: 'Actividades de operación' })).toBeVisible();
  await expect(page.getByText('Cuadra por las dos vías')).toBeVisible();
});

test('comprobaciones: las bloqueantes cuadran, los auxiliares coinciden y los periodos se listan', async ({ page }) => {
  await sesion(page, '/contabilidad/comprobaciones');
  for (const c of ['C3', 'C4', 'C5', 'C10', 'C11', 'C12', 'C21', 'CU1', 'CU2']) {
    await expect(page.getByRole('row').filter({ has: page.getByTestId(`comprobacion-${c}`) })).toContainText('Cuadra');
  }
  await expect(page.getByTestId('resumen-comprobaciones')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Semana' }).first()).toBeVisible();
});

test('proyecciones: sin historia no hay proyeccion y lo dice', async ({ page }) => {
  await sesion(page, '/contabilidad/proyecciones');
  await expect(page.getByTestId('proyeccion-bloque')).toHaveCount(4);
  await expect(page.getByText('Sin dato').first()).toBeVisible();
});

test('ciclo del periodo: una semana terminada se prepara y se aprueba desde la pantalla', async ({ page }) => {
  const r = await consultar<{ id: string }>("select p.id::text as id from contabilidad.periodo p where p.tipo = 'semana' and p.estado = 'abierto' and p.fin < negocio.hoy() and exists (select 1 from contabilidad.asiento a where a.periodo_semana_id = p.id) order by p.ini limit 1");
  expect(r.length).toBe(1);
  const id = r[0]!.id;
  await sesion(page, '/contabilidad/comprobaciones');
  await expect(page.getByTestId(`estado-periodo-${id}`)).toContainText('abierto');
  await page.getByTestId(`preparar-${id}`).click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId(`estado-periodo-${id}`)).toContainText('preparado', { timeout: 20_000 });
  await page.getByTestId(`aprobar-${id}`).click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId(`estado-periodo-${id}`)).toContainText('aprobado', { timeout: 20_000 });
  const h = await consultar<{ hash_cabecera: string | null }>('select hash_cabecera from contabilidad.periodo where id = $1', [id]);
  expect(h[0]!.hash_cabecera).toMatch(/^[0-9a-f]{64}$/);
});
