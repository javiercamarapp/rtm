// Hallazgos de la campana E2E maestra (13-nov) comprobados en el navegador contra la base LOCAL con la carga real:
//  - Omar y bodega reciben 307 a su inicio bajo rutas del socio (no un 200 que sirve otra pantalla).
//  - Las casillas miden 24 px o mas en movil (390) y 20 px o mas en escritorio.
//  - Un cobro mayor que el saldo pide confirmacion en la pantalla del pedido y no registra nada hasta confirmarla.
// Variables: MAESTRO_SS (carpeta de sesiones: socio_a.json, omar.json, bodega.json), E2E_PUERTO. El ultimo test ESCRIBE un cobro: restaurar la base despues (restaurar.sh).
import { expect, request, test } from '@playwright/test';
import { conDb } from '../ayudas';

const SS = process.env.MAESTRO_SS!;
const PUERTO = process.env.E2E_PUERTO ?? '3290';

for (const [rol, propia, ajenas] of [['omar', '/mi-bodega', ['/', '/pedidos', '/contabilidad', '/socios']], ['bodega', '/bodega', ['/', '/pedidos', '/cuentas', '/mi-bodega']]] as const) {
  test(`${rol}: las rutas del socio responden 307 a su inicio y la propia 200`, async () => {
    const ctx = await request.newContext({ baseURL: `http://127.0.0.1:${PUERTO}`, storageState: `${SS}/${rol}.json`, maxRedirects: 0 });
    for (const r of ajenas) {
      const res = await ctx.get(r);
      expect(res.status(), r).toBe(307);
      expect(new URL(res.headers()['location']!, 'http://x').pathname, r).toBe(propia);
    }
    expect((await ctx.get(propia)).status()).toBe(200);
    await ctx.dispose();
  });
}

test.describe('casillas y cobros del socio', () => {
  test.use({ storageState: `${SS}/socio_a.json` });

  test('las casillas son un objetivo tactil suficiente', async ({ page }, info) => {
    const minimo = info.project.name.startsWith('movil') ? 24 : 20;
    let vistas = 0;
    for (const ruta of ['/catalogo/costos', '/clientes/1/editar', '/proveedores/inventario']) {
      await page.goto(ruta);
      for (const c of await page.locator('input[type="checkbox"]:visible').all()) {
        const caja = (await c.boundingBox())!;
        expect(caja.width, `${ruta} ancho`).toBeGreaterThanOrEqual(minimo);
        expect(caja.height, `${ruta} alto`).toBeGreaterThanOrEqual(minimo);
        vistas++;
      }
    }
    expect(vistas).toBeGreaterThan(0);
  });

  test('un cobro mayor que el saldo pide confirmacion y no se registra sin ella', async ({ page }, info) => {
    test.skip(info.project.name.startsWith('movil'), 'el flujo se prueba una sola vez (escritorio)');
    const pedido = (await conDb((c) => c.query("select pe.id, operacion.pedido_saldo(pe.id)::bigint saldo from operacion.pedido pe where pe.estado = 'enviado' and operacion.pedido_saldo(pe.id) > 0 order by 2 limit 1"))).rows[0] as { id: string; saldo: string };
    const pagos = async () => Number((await conDb((c) => c.query('select count(*)::int n from operacion.pago'))).rows[0].n);
    const antes = await pagos();
    const saldo = Number(pedido.saldo) / 100;
    await page.goto(`/pedidos/${pedido.id}`);
    await page.getByTestId('registrar-pago').click();
    await page.getByTestId('pago-monto').fill(String(saldo * 100));
    await page.getByTestId('confirmar').click();
    await expect(page.locator('p.rtm-error')).toContainText('mayor que lo que debe el cliente');
    await expect(page.getByTestId('pago-confirmo-exceso')).toBeVisible();
    expect(await pagos()).toBe(antes);
    await page.getByTestId('pago-confirmo-exceso').getByRole('checkbox').check();
    await page.getByTestId('confirmar').click();
    await expect(page.getByTestId('pago-monto')).toBeHidden();
    expect(await pagos()).toBe(antes + 1);
  });
});
