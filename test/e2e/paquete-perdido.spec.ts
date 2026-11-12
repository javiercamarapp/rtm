// Carril paquete-perdido en laptop 1440 (Chromium): reportar y resolver un paquete perdido o danado desde Paquetes por hacer (salida)
// y Paquetes en trayecto (entrada). Datos ILUSTRATIVOS que crea la propia prueba ("E2E F2 ..." con sufijo propio).
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, conDb, consultar, correoUnico, entrarComo, ipFalsa, sembrarOperacionE2E, type DatosF2 } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosF2;
let pedidoId = 0;
let folioPedido = '';
let compraId = 0;
let folioCompra = '';

test.beforeAll(async () => {
  d = await sembrarOperacionE2E();
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const p = await c.query("select (operacion.crear_pedido($1,$2,$3::jsonb,'bodega_omar',null,0,0,0)->>'pedido_id')::bigint as id", [`e2e-pq:p:${d.sufijo}`, d.clienteId, JSON.stringify([{ modelo: d.modeloA, sabor: 'Mango', piezas: 20 }])]);
    pedidoId = Number(p.rows[0].id);
    await c.query('select operacion.confirmar_pedido($1,$2)', [`e2e-pq:pc:${d.sufijo}`, pedidoId]);
    await c.query("select operacion.enviar_pedido($1,$2,null,'{\"paqueteria\":\"Castores\",\"numero\":\"E2E-PQ-1\",\"costo_cent\":18000}'::jsonb,negocio.hoy(),true)", [`e2e-pq:pe:${d.sufijo}`, pedidoId]);
    const f = await c.query('select folio from operacion.pedido where id = $1', [pedidoId]);
    folioPedido = String(f.rows[0].folio);
    const o = await c.query("select (operacion.crear_compra($1,'Isaac',$2::jsonb)->>'compra_id')::bigint as id", [`e2e-pq:o:${d.sufijo}`, JSON.stringify([{ modelo: d.modeloA, sabor: 'Fresa', pagadas: 40 }])]);
    compraId = Number(o.rows[0].id);
    await c.query('select operacion.confirmar_compra($1,$2)', [`e2e-pq:oc:${d.sufijo}`, compraId]);
    await c.query("select operacion.registrar_guia_compra($1,$2,'Castores','E2E-PQ-E1')", [`e2e-pq:og:${d.sufijo}`, compraId]);
    const fc = await c.query('select folio from operacion.compra where id = $1', [compraId]);
    folioCompra = String(fc.rows[0].folio);
    await c.query('commit');
  });
});

async function sesion(page: Page, ruta: string) {
  const correo = correoUnico('paq');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, ruta);
}

test('salida: reportar piezas perdidas y resolver con bonificacion absorbida por la sociedad', async ({ page }) => {
  await sesion(page, '/paquetes/por-hacer');
  await page.getByTestId(`reportar-salida-${pedidoId}`).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByLabel(/Piezas afectadas de/).fill('5');
  await dlg.getByLabel('Detalle del incidente').fill('La paquetería extravió la caja');
  await dlg.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar('select 1 from operacion.paquete_incidente where pedido_id = $1', [pedidoId])).length).toBe(1);
  const folioInc = (await consultar<{ folio: string }>('select folio from operacion.paquete_incidente where pedido_id = $1', [pedidoId]))[0]!.folio;
  const fila = page.getByRole('row').filter({ hasText: folioInc }).first();
  await expect(fila).toContainText('Por resolver');
  await expect(fila).toContainText(folioPedido);
  await expect(fila).toContainText('Por decidir');
  const inc = (await consultar<{ id: string; piezas: number }>('select i.id, sum(l.piezas)::int as piezas from operacion.paquete_incidente i join operacion.paquete_incidente_linea l on l.incidente_id = i.id where i.pedido_id = $1 group by i.id', [pedidoId]))[0]!;
  expect(inc.piezas).toBe(5);
  expect((await consultar<{ n: string }>("select count(*)::int as n from operacion.aviso where codigo = 'paquete_incidente_reportado' and entidad_id = $1 and estado = 'abierta'", [inc.id]))[0]!.n).toBe(1);

  await page.getByTestId(`resolver-${inc.id}`).click();
  const r = page.locator('dialog[open]');
  await r.getByLabel('Motivo').fill('La sociedad absorbe la pérdida');
  await r.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: folioInc }).first()).toContainText('Resuelto');
  await expect(page.getByRole('row').filter({ hasText: folioInc }).first()).toContainText('La sociedad (50/50)');
  const res = (await consultar<{ absorbe: string; bonif: string }>('select absorbe_sociedad_cent::text as absorbe, bonificacion_cent::text as bonif from operacion.paquete_incidente_resolucion where incidente_id = $1', [inc.id]))[0]!;
  expect(res.absorbe).toBe('50000');
  expect(res.bonif).toBe('75000');
  // Explicar este numero: costo de lo perdido, dos vias.
  await page.getByRole('row').filter({ hasText: folioInc }).getByRole('button', { name: /\$500\.00\. Explicar este número/ }).first().click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
  await page.keyboard.press('Escape');
});

test('entrada: orden en camino perdida, la pantalla la saca de en trayecto y la sociedad castiga', async ({ page }) => {
  await sesion(page, '/paquetes/en-trayecto');
  const antes = (await consultar<{ n: string }>("select coalesce(sum(u.piezas),0)::int as n from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id where m.nombre_canonico = $1", [d.modeloA]))[0]!.n;
  await expect(page.getByRole('row').filter({ hasText: folioCompra }).first()).toBeVisible();
  await page.getByTestId(`reportar-entrada-${compraId}`).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByLabel('Detalle del incidente').fill('La caja nunca llegó a Mérida');
  await dlg.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar('select 1 from operacion.paquete_incidente where compra_id = $1', [compraId])).length).toBe(1);
  const folioInc = (await consultar<{ folio: string }>('select folio from operacion.paquete_incidente where compra_id = $1', [compraId]))[0]!.folio;
  const fila = page.getByRole('row').filter({ hasText: folioInc }).first();
  await expect(fila).toContainText('Por resolver');
  await expect(fila).toContainText(folioCompra);
  const despues = (await consultar<{ n: string }>("select coalesce(sum(u.piezas),0)::int as n from operacion.existencia_sku_ubicacion u join catalogo.sku k on k.id = u.sku_id join catalogo.modelo m on m.id = k.modelo_id where m.nombre_canonico = $1", [d.modeloA]))[0]!.n;
  expect(despues).toBe(antes); // lo perdido no entra a la existencia
  const inc = (await consultar<{ id: string }>('select id from operacion.paquete_incidente where compra_id = $1', [compraId]))[0]!;
  await page.getByTestId(`resolver-${inc.id}`).click();
  const r = page.locator('dialog[open]');
  await r.getByLabel('Motivo').fill('Pérdida absorbida por la sociedad');
  await r.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: folioInc }).first()).toContainText('Resuelto');
  const est = (await consultar<{ estado: string }>('select estado from operacion.compra where id = $1', [compraId]))[0]!;
  expect(est.estado).toBe('cerrada');
  const ajuste = (await consultar<{ a: string }>('select operacion.ajuste_utilidad_paquetes(negocio.hoy(), negocio.hoy())::text as a'))[0]!;
  expect(BigInt(ajuste.a) <= -400000n).toBe(true);
});
