// Pantallas de F2 en laptop 1440 (Chromium): pedido surtido pieza por pieza con nota y PDF, pagos y cuentas por cobrar, orden de compra con cuenta del
// proveedor, recepcion con diferencia asignada, paquetes por hacer y en trayecto, y avisos. Datos ILUSTRATIVOS de ayudas.ts (sufijo propio por corrida).
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa, pedidoConfirmadoE2E, sembrarOperacionE2E, type DatosF2 } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosF2;
test.beforeAll(async () => {
  d = await sembrarOperacionE2E();
});

async function sesion(page: Page, ruta: string, socio: 'Angelo' | 'Javier' = 'Javier') {
  const correo = correoUnico('f2');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, ruta);
}

test('pedido de 50 piezas donde salen 40: cobra solo 40, con nota, texto de WhatsApp y PDF de huella estable', async ({ page }) => {
  const nativos: string[] = [];
  page.on('dialog', (x) => { nativos.push(x.message()); void x.dismiss(); });
  await sesion(page, '/pedidos/nuevo');
  await page.getByTestId('elegir-cliente').selectOption({ label: `${d.cliente} (Angelo)` });
  await page.getByRole('button', { name: 'Elegir cliente' }).click();
  await page.waitForURL(`**/pedidos/nuevo?cliente=${d.clienteId}`);

  await page.getByTestId('modelo').selectOption({ label: `${d.marca} · ${d.modeloA}` });
  await page.getByTestId('sabor').selectOption({ index: 1 });
  await page.getByTestId('piezas').fill('50');
  await expect(page.getByTestId('precio')).toHaveValue('150.00');
  await page.getByTestId('agregar-renglon').click();
  await expect(page.getByRole('list', { name: 'Renglones agregados' })).toContainText('50 pz a $150.00');
  await expect(page.getByTestId('envio')).toHaveValue('300.00');
  await page.getByTestId('crear-pedido').click();
  await page.waitForURL(/\/pedidos\/\d+$/);
  const idPedido = Number(page.url().split('/').pop());

  await expect(page.getByTestId('estado-pedido')).toContainText('Borrador');
  await expect(page.getByText('Total estimado si sale todo')).toBeVisible();
  await expect(page.getByTestId('aviso-pedido')).toHaveCount(0);
  await page.getByTestId('confirmar-pedido').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Confirmado');
  await page.getByTestId('marcar-empacado').click();
  await expect(page.getByText('Empacado', { exact: true })).toBeVisible();

  // Marcar enviado: salen 40 de 50; la guia con su costo real.
  await page.getByTestId(`marcar-enviado-${idPedido}`).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel(/Surtidas de/).fill('40');
  await dialogo.getByLabel('Número de guía').fill('GUIA-E2E-1');
  await dialogo.getByLabel('Paquetería').fill('Castores');
  await dialogo.getByLabel('Costo real de la guía').fill('180');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Enviado');

  // Quien actua queda en el evento y en la nota (la sesion del socio llega a la base).
  const quien = await consultar<{ autor: string | null }>("select u.socio_nombre as autor from operacion.evento e left join seguridad.usuario u on u.id = e.actor_id where e.tipo = 'pedido_enviado' order by e.id desc limit 1");
  expect(quien[0]!.autor).toBe('Javier');
  await expect(page.getByTestId('texto-whatsapp')).toContainText('pz x $150 = 6,000');
  await expect(page.getByTestId('texto-whatsapp')).toContainText('Envío $300');
  await expect(page.getByTestId('texto-whatsapp')).toContainText('total a saldar 6,300.00');
  await expect(page.getByText('Pendiente de surtir: 10 pz')).toBeVisible();
  const nota = page.getByTestId('nota-cliente');
  await expect(nota).toContainText('40 piezas');
  await expect(nota).not.toContainText(/costo|utilidad|margen/i);

  // PDF: se genera una vez y reabrir da los mismos bytes.
  const href = await page.getByTestId('descargar-pdf').getAttribute('href');
  const a = await page.context().request.get(href!);
  const b = await page.context().request.get(href!);
  expect(a.status()).toBe(200);
  expect(a.headers()['content-type']).toBe('application/pdf');
  expect((await a.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(a.headers()['x-huella-sha256']).toBe(b.headers()['x-huella-sha256']);
  expect((await a.body()).equals(await b.body())).toBe(true);
  const guardado = await consultar<{ n: string }>("select count(*)::int as n from operacion.nota_documento nd join operacion.nota n on n.id = nd.nota_id where n.pedido_id = $1 and nd.variante = 'cliente_pdf'", [idPedido]);
  expect(Number(guardado[0]!.n)).toBe(1);

  // Hoja interna (solo socios) con cascada y comprobaciones.
  await page.getByRole('link', { name: 'Hoja interna' }).click();
  await expect(page.getByTestId('cascada')).toContainText('Utilidad');
  await expect(page.getByText('C1 · renglón por renglón')).toBeVisible();
  await expect(page.getByText('C2 · pedidas, salidas, en nota y cobradas')).toBeVisible();
  await expect(page.getByText('Cuadra', { exact: true }).first()).toBeVisible();

  // Pago de 5,000 a la cuenta de Angelo: baja lo por cobrar y Angelo debe a la sociedad.
  await page.getByRole('link', { name: 'Nota', exact: true }).click();
  await page.getByTestId('registrar-pago').click();
  await page.getByTestId('pago-cuenta').selectOption('Angelo');
  await page.getByTestId('pago-monto').fill('5000');
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Abonado').locator('..')).toContainText('$5,000.00');
  await expect(page.getByText('Por cobrar', { exact: true }).locator('..')).toContainText('$1,300.00');

  // Correccion enlazada.
  await page.getByTestId('corregir-nota').click();
  await page.getByLabel('Motivo de la corrección').fill('el envío fue de 350');
  await page.getByLabel('Envío nuevo').fill('350');
  await page.getByTestId('confirmar').click();
  await page.getByRole('link', { name: 'Versiones' }).click();
  await expect(page.getByRole('table', { name: 'Versiones de la nota' })).toContainText('-C1');
  await expect(page.getByRole('table', { name: 'Versiones de la nota' })).toContainText('Corregida por');
  expect(nativos).toEqual([]);

  // Cuentas por cobrar: el saldo del pedido y la deuda de Angelo con la sociedad, con "Explicar este numero".
  await page.goto('/cuentas-por-cobrar');
  await expect(page.getByRole('table', { name: 'Cuentas por cobrar por pedido' })).toContainText(d.cliente);
  const deuda = page.getByRole('table', { name: 'Deuda de los socios con la sociedad' });
  await deuda.getByRole('row', { name: /Angelo/ }).getByRole('button', { name: /Explicar este número/ }).last().click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Lo que Angelo debe a la sociedad');
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
  await page.keyboard.press('Escape');
});

test('orden de compra a Karen: el saldo a favor se aplica, la recepcion por sabor suma al inventario y la diferencia se asigna a un socio', async ({ page }) => {
  const saldoAntes = Number((await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Karen'))::bigint as s"))[0]!.s);
  await sesion(page, '/proveedores?p=Karen', 'Angelo');
  await expect(page.getByTestId('etiqueta-saldo')).toBeVisible();

  await page.getByTestId('nueva-oc').click();
  await page.getByTestId('oc-modelo').selectOption({ label: `${d.marca} · ${d.modeloB}` });
  await page.getByTestId('oc-sabor').selectOption({ index: 1 });
  await page.getByTestId('oc-pagadas').fill('200');
  await expect(page.getByTestId('oc-costo')).toHaveValue('110.00');
  await page.getByTestId('oc-agregar').click();
  await page.getByTestId('crear-oc').click();
  await page.waitForURL(/\/proveedores\/compras\/\d+$/);
  const idOc = Number(page.url().split('/').pop());
  await expect(page.getByTestId('estado-oc')).toContainText('Borrador');

  await page.getByTestId('confirmar-oc').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Confirmada');
  const saldoDespues = Number((await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Karen'))::bigint as s"))[0]!.s);
  expect(saldoDespues).toBe(saldoAntes - 2_200_000); // 22,000.00 de la orden
  // Las piezas en transito NO son existencia.
  const antes = await consultar<{ p: string | null }>("select piezas as p from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1", [d.modeloB]);
  expect(antes.length).toBe(0);

  await page.getByTestId('oc-enviada').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Enviada');
  await page.getByTestId(`guia-${idOc}`).click();
  await page.getByLabel('Número de guía').fill('TRAYECTO-E2E');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('estado-oc')).toContainText('En trayecto');

  await page.goto('/paquetes/en-trayecto');
  const fila = page.getByRole('row', { name: /TRAYECTO-E2E/ });
  await expect(fila).toContainText('En trayecto');
  await expect(fila).toContainText('Karen');
  await page.getByTestId(`llego-${idOc}`).click();
  await expect(page.getByRole('row', { name: /TRAYECTO-E2E/ })).toContainText('Llegó a Mérida');

  // Recepcion: llegaron 195 de 200; la existencia sube solo ahora y quedan 5 en diferencias.
  await page.goto(`/proveedores/compras/${idOc}`);
  await page.getByLabel(/Piezas recibidas de/).first().fill('195');
  await page.getByTestId('confirmar-recepcion').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida');
  const despues = await consultar<{ p: string }>("select piezas::int as p from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1", [d.modeloB]);
  expect(Number(despues[0]!.p)).toBe(195);
  const tabla = page.getByRole('table', { name: 'Diferencias de recepción' });
  await expect(tabla).toContainText('Faltante');
  await expect(tabla).toContainText('5 pz');
  await expect(page.getByRole('table', { name: /Renglones de/ })).toContainText('195 pz');

  const idDif = Number((await consultar<{ id: string }>('select max(id) as id from operacion.compra_diferencia where compra_id = $1', [idOc]))[0]!.id);
  await page.getByTestId(`resp-${idDif}`).selectOption('socio:Angelo');
  await page.getByTestId(`asignar-${idDif}`).click();
  await expect.poll(async () => Number((await consultar<{ s: string }>("select operacion.saldo_socio(id, 'diferencia')::bigint as s from catalogo.socio where nombre = 'Angelo'"))[0]!.s)).toBeGreaterThan(0);
  await page.getByTestId('cerrar-oc').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Cerrada');
  const puente = await consultar<{ s: string }>('select operacion.saldo_puente()::bigint as s');
  expect(Number(puente[0]!.s)).toBe(0);
});

test('paquetes por hacer: lista de surtido, empacar y enviar desde la lista; los enviados quedan con su guia', async ({ page }) => {
  const idPedido = await pedidoConfirmadoE2E(d, 30, 'paq');
  await sesion(page, '/paquetes/por-hacer');
  const porHacer = page.getByRole('table', { name: 'Paquetes por hacer' });
  const fila = porHacer.getByRole('row', { name: new RegExp(d.cliente) });
  await expect(fila).toContainText('Por empacar');
  await expect(fila).toContainText('Dueño: Angelo');
  await expect(page.getByRole('table', { name: 'Lista de surtido por modelo y sabor' })).toContainText(d.modeloA);
  await page.getByTestId(`empacar-${idPedido}`).click();
  await expect(porHacer.getByRole('row', { name: new RegExp(d.cliente) })).toContainText('Empacado');
  await page.getByTestId(`marcar-enviado-${idPedido}`).click();
  await page.getByLabel('Número de guía').fill('PAQ-E2E-1');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('table', { name: 'Enviados recientemente' })).toContainText('PAQ-E2E-1');
  // Omar nunca recibe aviso de que despachar: no existe esa notificacion.
  const avisos = await consultar<{ n: string }>("select count(*)::int as n from operacion.aviso where codigo ilike '%omar%' and codigo ilike '%despach%'");
  expect(Number(avisos[0]!.n)).toBe(0);
});

test('avisos: el nucleo muestra en el software lo que las operaciones emitieron y se marca como leido', async ({ page }) => {
  await sesion(page, '/avisos?estado=todos', 'Javier');
  const tabla = page.getByRole('table', { name: 'Avisos' });
  await expect(tabla).toContainText('NT-014');
  await expect(tabla).toContainText('NT-017');
  await expect(tabla.getByRole('row', { name: /NT-014/ }).first()).toBeVisible();
  const antes = await page.getByRole('button', { name: 'Marcar leído' }).count();
  expect(antes).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Marcar leído' }).first().click();
  await expect(page.getByRole('button', { name: 'Marcar leído' })).toHaveCount(antes - 1);
});
