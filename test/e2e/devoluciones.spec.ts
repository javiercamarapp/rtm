// Devoluciones y recepcion parcial de punta a punta (Chromium): llegada parcial de una orden, cierre con faltante, devolucion de un cliente con nota de credito (PDF de huella
// estable), devolucion a un proveedor y la identidad contable al final. Datos ILUSTRATIVOS de ayudas.ts.  Las capturas las toma test/capturas/devoluciones.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, conDb, consultar, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E, type DatosF3a } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosF3a;
let compraA = 0;
let compraB = 0;

async function compra(sufijo: string, clave: string, lineas: object[]): Promise<number> {
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const r = await c.query("select (operacion.crear_compra($1,'Isaac',$2::jsonb,6000)->>'compra_id')::bigint as id", [`dev:${clave}:${sufijo}`, JSON.stringify(lineas)]);
    const id = Number(r.rows[0].id);
    await c.query('select operacion.confirmar_compra($1,$2)', [`dev:${clave}c:${sufijo}`, id]);
    await c.query('select operacion.marcar_llego_merida($1,$2)', [`dev:${clave}m:${sufijo}`, id]);
    await c.query('commit');
    return id;
  });
}

test.beforeAll(async () => {
  d = await sembrarCuentasE2E();
  compraA = await compra(d.sufijo, 'A', [{ modelo: d.modeloA, sabor: 'Fresa', pagadas: 40 }, { modelo: d.modeloA, sabor: 'Mango', pagadas: 20 }]);
  compraB = await compra(d.sufijo, 'B', [{ modelo: d.modeloA, sabor: 'Fresa', pagadas: 30 }]);
});

async function sesion(page: Page, ruta: string) {
  const correo = correoUnico('dev');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, ruta);
}

async function existencia(sabor: string): Promise<number> {
  const r = await consultar<{ n: number }>("select coalesce(u.piezas, 0)::int as n from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id join catalogo.modelo m on m.id = k.modelo_id left join operacion.existencia_sku_ubicacion u on u.sku_id = k.id and u.ubicacion = 'bodega_omar' where m.nombre_canonico = $1 and s.nombre_canonico = $2", [d.modeloA, sabor]);
  return r[0]!.n;
}

test('recepcion parcial: llegan 25 de 40, luego lo que falta y la orden se cierra sola', async ({ page }) => {
  const nativos: string[] = [];
  page.on('dialog', (x) => { nativos.push(x.message()); void x.dismiss(); });
  await sesion(page, `/proveedores/compras/${compraA}`);
  const f0 = await existencia('Fresa');
  await expect(page.getByTestId('estado-oc')).toContainText('Llegó a Mérida');
  await page.getByLabel(/Piezas que llegaron de .* 1$/).fill('25');
  await page.getByTestId('registrar-llegada').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida en parte');
  await expect(page.getByText('Llegadas de la orden')).toBeVisible();
  expect(await existencia('Fresa')).toBe(f0 + 25);

  await page.getByLabel(/Piezas que llegaron de .* 1$/).fill('15');
  await page.getByLabel(/Piezas que llegaron de .* 2$/).fill('20');
  await page.getByTestId('registrar-llegada').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida', { timeout: 30_000 });
  await expect(page.getByTestId('estado-oc')).not.toContainText('en parte');
  const dif = await consultar<{ n: number }>('select count(*)::int as n from operacion.compra_diferencia where compra_id = $1', [compraA]);
  expect(dif[0]!.n).toBe(0);
  const lotes = await consultar<{ suma: string }>("select sum(lo.valor_entrada_cent)::text as suma from operacion.lote lo join operacion.compra_linea l on l.id = lo.compra_linea_id where l.compra_id = $1", [compraA]);
  expect(Number(lotes[0]!.suma)).toBe(60 * 10000 + 6000); // 60 pz a 100.00 mas la guia de 60.00: el costo puesto se reparte sin residuo entre llegadas
  expect(nativos).toEqual([]);
});

test('recepcion parcial: se cierra con faltante, exige motivo y deja la diferencia asignable', async ({ page }) => {
  await sesion(page, `/proveedores/compras/${compraB}`);
  await page.getByLabel(/Piezas que llegaron de .* 1$/).fill('10');
  await page.getByTestId('registrar-llegada').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida en parte');
  await page.getByTestId('cerrar-recepcion').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Escribe el motivo');
  await page.getByRole('dialog').getByLabel('Motivo').fill('el proveedor no mando el resto');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida');
  await expect(page.getByText('Diferencias de recepción')).toBeVisible();
  await expect(page.getByText('Faltante', { exact: true })).toBeVisible();
});

test('devolucion de un cliente: tope de piezas, nota de credito con PDF estable, saldo del pedido y anulacion', async ({ page }) => {
  await sesion(page, `/pedidos/${d.pedidoBodegaId}`);
  await expect(page.getByTestId('seccion-devoluciones')).toBeVisible();
  await page.getByTestId('devolver-mercancia').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel(/Piezas a devolver de/).first().fill('31');
  await dialogo.getByLabel('Motivo de la devolución').fill('producto equivocado');
  await page.getByTestId('confirmar').click();
  await expect(dialogo.getByRole('alert')).toContainText('solo se pueden devolver 30');
  await dialogo.getByLabel(/Piezas a devolver de/).first().fill('10');
  await page.getByTestId('confirmar').click();
  const seccion = page.getByTestId('seccion-devoluciones');
  await expect(seccion).toContainText('DV-', { timeout: 30_000 });
  await expect(seccion).toContainText('$1,500.00');
  await expect(page.getByText('Devuelto (crédito)')).toBeVisible();
  await expect(page.getByText('$3,000.00').first()).toBeVisible(); // 30 pz a 150.00 = 4,500.00 menos 1,500.00

  const href = await seccion.getByRole('link', { name: /DV-/ }).getAttribute('href');
  const a = await page.context().request.get(href!);
  const b = await page.context().request.get(href!);
  expect(a.status()).toBe(200);
  expect(a.headers()['content-type']).toBe('application/pdf');
  expect((await a.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(a.headers()['x-huella-sha256']).toBe(b.headers()['x-huella-sha256']);
  const guardado = await consultar<{ n: number }>("select count(*)::int as n from operacion.devolucion_documento where tipo = 'cliente' and variante = 'pdf' and devolucion_id = $1", [Number(href!.split('/')[3])]);
  expect(guardado[0]!.n).toBe(1);

  await page.getByTestId(/anular-dev-/).first().click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('se capturó mal');
  await page.getByTestId('confirmar').click();
  await expect(seccion).toContainText('Anulada', { timeout: 30_000 });
  await expect(page.getByText('Devuelto (crédito)')).toHaveCount(0);
  const saldo = await consultar<{ s: string }>('select operacion.pedido_saldo($1)::text as s', [d.pedidoBodegaId]);
  expect(Number(saldo[0]!.s)).toBe(450000);

  // Una devolucion nueva que se queda: sirve de insumo de la pagina Devoluciones.
  await page.getByTestId('devolver-mercancia').click();
  await page.getByRole('dialog').getByLabel(/Piezas a devolver de/).first().fill('4');
  await page.getByRole('dialog').getByLabel('Motivo de la devolución').fill('empaque dañado');
  await page.getByRole('dialog').getByLabel(/Destino de/).first().selectOption('merma');
  await page.getByTestId('confirmar').click();
  await expect(seccion).toContainText('$600.00', { timeout: 30_000 });
});

test('devolucion a un proveedor: sale del inventario, sube la cuenta del proveedor y se puede anular', async ({ page }) => {
  await sesion(page, '/devoluciones');
  await expect(page.getByRole('heading', { name: 'Devoluciones', level: 1 })).toBeVisible();
  await expect(page.getByText('Devoluciones de clientes')).toBeVisible();
  const f0 = await existencia('Fresa');
  const antes = await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))::text as s");
  await page.getByTestId('devolver-proveedor').click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Buscar producto').fill(`${d.modeloA} Fresa`);
  await dialogo.getByLabel(`Piezas a devolver de ${d.modeloA} Fresa`).fill('3');
  await dialogo.getByLabel('Motivo de la devolución').fill('sabor equivocado');
  await page.getByTestId('confirmar').click();
  await expect.poll(() => existencia('Fresa'), { timeout: 30_000 }).toBe(f0 - 3);
  const nueva = (await consultar<{ id: number; folio: string }>('select id, folio from operacion.devolucion_proveedor order by id desc limit 1'))[0]!;
  const despues = await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))::text as s");
  expect(Number(despues[0]!.s)).toBeGreaterThan(Number(antes[0]!.s));
  await page.reload();
  const fila = page.getByRole('row', { name: new RegExp(nueva.folio) });
  await expect(fila).toBeVisible();

  const href = await fila.getByRole('link', { name: nueva.folio }).getAttribute('href');
  const pdf = await page.context().request.get(href!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  await page.getByTestId(`anular-devp-${nueva.id}`).click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('se devolvió por error');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row', { name: new RegExp(nueva.folio) })).toContainText('Anulada', { timeout: 30_000 });
  expect(await existencia('Fresa')).toBe(f0);
  const final = await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))::text as s");
  expect(final[0]!.s).toBe(antes[0]!.s);
});

test('la identidad contable cuadra por dos vias tras todo el recorrido', async () => {
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query('select contabilidad.asentar_pendientes()');
    const r = await c.query("select codigo, via_a_cent::text as a, via_b_cent::text as b from contabilidad.comprobaciones() where not ok and codigo in ('C3','C4','C5','C10','C14','C16','C18','CU1','CU2','CU3')");
    await c.query('rollback');
    expect(r.rows, JSON.stringify(r.rows)).toEqual([]);
  });
});
