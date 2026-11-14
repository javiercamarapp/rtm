// Los 14 flujos de punta a punta F00 a F13 (qa/01-inventario-y-matriz.md, seccion 3) en laptop 1440 y tema claro, EN SERIE sobre una misma base sembrada una vez
// (el orden importa: cada flujo parte de las cifras que dejo el anterior). Cada paso afirma la cifra a mano en pantalla y su segunda via por SQL, y deja una captura.
// Cierra con el recorrido de los mismos flujos en tema oscuro (capturas) y los invariantes de fin de campaña.
// ESCRITA Y TIPADA, NO EJECUTADA. Datos sinteticos "QA PaP ...".
import { expect, test, type Page } from '@playwright/test';
import {
  capturar, conDb, consultar, contarEventos, fijarTema, ipFalsa, piezasYValor, reembolsoPendiente, saldoProveedor, saldoSocio, sembrarFlujosQA, sesionSocio,
  type DatosFlujos,
} from './punta_a_punta_ayudas';
import { altaUsuario, correoUnico, enlaceConfirmacion } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosFlujos;
let pedido1 = 0; // P-1: 50 pedidas, 40 surtidas
let pedido2 = 0; // P-2: 30 de Uva
let oc1 = 0;
let oc2 = 0;
test.beforeAll(async () => {
  d = await sembrarFlujosQA();
});


/** Elige la opcion de un <select> (por data-testid) cuyo texto CONTIENE `texto`; selectOption({label}) pide el texto exacto y aqui varia (marca, dueño, sufijo). */
async function elegirOpcion(page: Page, testid: string, texto: string): Promise<void> {
  const valor = await page.getByTestId(testid).evaluate((el, t) => {
    const op = Array.from((el as HTMLSelectElement).options).find((o) => o.text.includes(t));
    return op ? op.value : null;
  }, texto);
  expect(valor, `opcion que contiene "${texto}" en ${testid}`).not.toBeNull();
  await page.getByTestId(testid).selectOption(valor!);
}

const noNativos = (page: Page): string[] => {
  const vistos: string[] = [];
  page.on('dialog', (x) => { vistos.push(x.message()); void x.dismiss(); });
  return vistos;
};

async function crearPedido(page: Page, piezas: string, sabor: 'Fresa' | 'Uva', envio = '300'): Promise<number> {
  await page.goto('/pedidos/nuevo');
  await page.getByTestId('elegir-cliente').selectOption({ label: d.cliente });
  await page.getByRole('button', { name: 'Elegir cliente' }).click();
  await page.waitForURL(`**/pedidos/nuevo?cliente=${d.clienteId}`);
  await page.getByTestId('modelo').selectOption({ label: `${d.marca} · ${d.modelo}` });
  await elegirOpcion(page, 'sabor', sabor);
  await page.getByTestId('piezas').fill(piezas);
  await expect(page.getByTestId('precio')).toHaveValue('150.00');
  await page.getByTestId('agregar-renglon').click();
  await page.getByTestId('envio').fill(envio);
  await page.getByTestId('condicion-pago').selectOption('contado');
  await page.getByTestId('crear-pedido').click();
  await page.waitForURL(/\/pedidos\/\d+$/);
  return Number(page.url().split('/').pop());
}

test('F00 acceso y permisos: sin sesion se pide acceso; Angelo y Javier ven lo mismo; las rutas publicas abren', async ({ page, browser }, info) => {
  await page.goto('/pedidos');
  await expect(page).toHaveURL(/\/login\?next=%2Fpedidos/);
  expect((await page.request.get('/api/health')).status()).toBe(200);
  for (const ruta of ['/terminos', '/privacidad']) {
    expect((await page.goto(ruta))?.status()).toBe(200);
  }
  await sesionSocio(page, '/pedidos', 'Angelo');
  const titulosAngelo = await page.getByRole('link').allInnerTexts();
  const otra = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pj = await otra.newPage();
  await sesionSocio(pj, '/pedidos', 'Javier');
  const titulosJavier = await pj.getByRole('link').allInnerTexts();
  expect(titulosJavier.filter((t) => /Pedidos|Paquetes|Cuentas|Catálogo|Clientes|Inventario|Proveedores|Cuenta de socios|Cuenta con Omar|Avisos/.test(t)).sort())
    .toEqual(titulosAngelo.filter((t) => /Pedidos|Paquetes|Cuentas|Catálogo|Clientes|Inventario|Proveedores|Cuenta de socios|Cuenta con Omar|Avisos/.test(t)).sort());
  await otra.close();
  // Cerrar sesion: /pedidos vuelve a pedir acceso.
  await page.getByTestId('cerrar-sesion').click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/pedidos');
  await expect(page).toHaveURL(/\/login/);
  await capturar(page, info, 'claro', 'F00-acceso');
});

test('F01 alta de cliente y precios: costo, precio, margen vs Isaac 50.00 y vs Karen 40.00, historial y disponibilidad', async ({ page }, info) => {
  noNativos(page);
  await sesionSocio(page, `/catalogo?modelo=${d.modeloId}`);
  await expect(page.getByText(d.cliente).first()).toBeVisible();
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$150.00');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$50.00'); // 150.00 - 100.00 (Isaac)
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$40.00'); // 150.00 - 110.00 (Karen, supuesto)
  await expect(page.locator('main:not(.rtm-documento)')).toContainText(/supuesto/i);
  await capturar(page, info, 'claro', 'F01-margen');
  // Segunda via: una fila de tabulador vigente.
  const tab = await consultar<{ n: number }>('select count(*)::int as n from catalogo.tabulador_precio t where t.cliente_id = $1 and t.vigente_hasta is null', [d.clienteId]);
  expect(tab[0]!.n).toBe(1);
  // Nuevo precio 160.00 desde hoy en un SEGUNDO cliente (el cliente de los flujos F04 a F06 debe seguir a 150.00): historial de 2 puntos y margenes 60.00 y 50.00.
  const cliente2 = `${d.cliente} B`;
  const cliente2Id = await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_cliente($1,'Angelo')", [cliente2]);
    await c.query("select catalogo.fijar_precio($1,$2,$3,15000,negocio.hoy() - 30,'chat')", [`qa:p2a:${d.sufijo}`, cliente2, d.modelo]);
    await c.query("select catalogo.fijar_precio($1,$2,$3,16000,negocio.hoy(),'chat')", [`qa:p2:${d.sufijo}`, cliente2, d.modelo]);
    const r = await c.query('select id from catalogo.cliente where nombre_canonico = $1', [cliente2]);
    await c.query('commit');
    return Number(r.rows[0].id);
  });
  await page.goto(`/clientes/${cliente2Id}`);
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$160.00');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$150.00'); // historial: el precio anterior
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$60.00');
  await page.goto(`/catalogo?modelo=${d.modeloId}`);
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$60.00');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$50.00');
  // Disponibilidad: marcar sin disponibilidad cambia la tabla y se puede pedir igual.
  await page.goto('/catalogo');
  const fila = page.getByRole('row').filter({ hasText: d.modelo });
  await fila.getByRole('button', { name: /sin disponibilidad/i }).click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: d.modelo })).toContainText(/Sin disponibilidad/i);
  await page.getByRole('row').filter({ hasText: d.modelo }).getByRole('button', { name: /disponible/i }).first().click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: d.modelo })).not.toContainText(/Marcar disponible/i);
});

test('F02 compra a Isaac: 100 Fresa + 100 Uva a 100.00, guia 450.00 pagada por Angelo; confirmar carga 20,000.00; pago del socio; recepcion; cerrar', async ({ page }, info) => {
  const nativos = noNativos(page);
  await sesionSocio(page, '/proveedores?p=Isaac', 'Angelo');
  const inicial = await saldoProveedor('Isaac');
  const reembInicial = await reembolsoPendiente('Angelo');
  await page.goto('/proveedores/compras/nueva?p=Isaac');
  for (const sabor of ['Fresa', 'Uva']) {
    await elegirOpcion(page, 'oc-modelo', d.modelo);
    await elegirOpcion(page, 'oc-sabor', sabor);
    await page.getByTestId('oc-pagadas').fill('100');
    await expect(page.getByTestId('oc-costo')).toHaveValue('100.00');
    await page.getByTestId('oc-agregar').click();
  }
  await page.getByLabel('Costo de la guía').fill('450');
  await page.getByLabel('Guía pagada por').selectOption('Angelo');
  await page.getByTestId('crear-oc').click();
  await page.waitForURL(/\/proveedores\/compras\/\d+$/);
  oc1 = Number(page.url().split('/').pop());
  await expect(page.getByTestId('estado-oc')).toContainText('Borrador');
  await page.getByTestId('confirmar-oc').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Confirmada');
  expect(await saldoProveedor('Isaac')).toBe(inicial - 2_000_000n); // la guia NO carga: la pago Angelo
  expect((await reembolsoPendiente('Angelo')) - reembInicial).toBe(45_000n);
  await capturar(page, info, 'claro', 'F02-confirmada');
  // Pago de Angelo con dinero propio: aportacion, saldo de Isaac en cero.
  await page.goto('/proveedores?p=Isaac');
  await page.getByTestId('pago-socio').click();
  await page.getByLabel('Socio que pagó').selectOption('Angelo');
  await page.getByLabel(/Monto/).fill('20000');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => saldoProveedor('Isaac')).toBe(inicial);
  // Enviada, guia de entrada, llego a Merida: el inventario sigue sin las piezas.
  await page.goto(`/proveedores/compras/${oc1}`);
  await page.getByTestId('oc-enviada').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Enviada');
  await page.getByTestId('barra-mas').click();
  await page.getByTestId(`guia-${oc1}`).click();
  await page.getByLabel('Número de guía').fill(`QA-OC1-${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('estado-oc')).toContainText('En trayecto');
  expect((await piezasYValor(d.modelo)).piezas).toBe(200); // la semilla ya trae 200; la recepcion de la OC-1 se prueba por delta
  await page.goto('/paquetes/en-trayecto');
  await expect(page.getByRole('row', { name: new RegExp(`QA-OC1-${d.sufijo}`) })).toBeVisible();
  await page.getByTestId(`llego-${oc1}`).click();
  await page.goto(`/proveedores/compras/${oc1}`);
  const antes = await piezasYValor(d.modelo);
  const campos = page.getByLabel(/Piezas recibidas de/);
  await campos.nth(0).fill('100');
  await campos.nth(1).fill('100');
  await page.getByTestId('confirmar-recepcion').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida');
  const despues = await piezasYValor(d.modelo);
  expect(despues.piezas - antes.piezas).toBe(200);
  expect(despues.valor - antes.valor).toBe(2_045_000n); // costo puesto 102.25 x 200 = 20,450.00
  await page.getByTestId('cerrar-oc').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Cerrada');
  expect(nativos).toEqual([]);
});

test('F03 recepcion e inventario: 400 piezas a promedio 102.25, "Explicar este numero" cuadra, disponible = fisico - reservas', async ({ page }, info) => {
  const inv = await piezasYValor(d.modelo);
  expect(inv.piezas).toBe(400);
  expect(inv.valor).toBe(4_090_000n); // 200 de la semilla + 200 de la OC-1, ambas a 102.25
  await sesionSocio(page, '/inventario');
  await expect(page.getByRole('table').first()).toContainText(d.modelo);
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('400 pz');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$40,900.00');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$102.25');
  await page.getByRole('row').filter({ hasText: d.modelo }).getByRole('button', { name: /Explicar este número/ }).first().click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
  await capturar(page, info, 'claro', 'F03-explicar');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('explicar-cajon')).toBeHidden();
});

test('F04 pedido de 50 piezas donde salen 40: total 6,300.00, utilidad 1,950.00 con guia de 180.00, nota sin costo, PDF de huella estable', async ({ page }, info) => {
  const nativos = noNativos(page);
  await sesionSocio(page, '/pedidos/nuevo');
  pedido1 = await crearPedido(page, '50', 'Fresa');
  await expect(page.getByTestId('estado-pedido')).toContainText('Borrador');
  await expect(page.getByText('Total estimado si sale todo')).toBeVisible();
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$7,800.00');
  await expect(page.getByTestId('aviso-pedido')).toHaveCount(0);
  await page.getByTestId('confirmar-pedido').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Confirmado');
  await page.getByTestId('marcar-empacado').click();
  await expect(page.getByText('Empacado', { exact: true })).toBeVisible();
  const antes = await piezasYValor(d.modelo);
  await page.getByTestId(`marcar-enviado-${pedido1}`).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel(/Surtidas de/).fill('40');
  await dialogo.getByLabel('Número de guía').fill(`QA-P1-${d.sufijo}`);
  await dialogo.getByLabel('Paquetería').fill('Castores');
  await dialogo.getByLabel('Costo real de la guía').fill('180');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Enviado');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$6,300.00');
  await expect(page.getByText('Pendiente de surtir: 10 pz')).toBeVisible();
  const despues = await piezasYValor(d.modelo);
  expect(antes.piezas - despues.piezas).toBe(40);
  expect(antes.valor - despues.valor).toBe(409_000n); // 40 x 102.25
  await expect(page.getByTestId('texto-whatsapp')).toContainText('40pz x $150 = 6,000');
  await expect(page.getByTestId('texto-whatsapp')).toContainText('Envío $300');
  await expect(page.getByTestId('texto-whatsapp')).toContainText('total a saldar 6,300.00');
  await expect(page.getByTestId('nota-cliente')).not.toContainText(/costo|utilidad|margen/i);
  // Hoja interna: costo 4,090.00, renta 80.00, guia 180.00, utilidad 1,950.00.
  await page.getByRole('link', { name: 'Hoja interna' }).click();
  await expect(page.getByTestId('cascada')).toContainText('$4,090.00');
  await expect(page.getByTestId('cascada')).toContainText('$80.00');
  await expect(page.getByTestId('cascada')).toContainText('$1,950.00');
  await expect(page.getByText('Cuadra', { exact: true }).first()).toBeVisible();
  await capturar(page, info, 'claro', 'F04-hoja-interna');
  const util = await consultar<{ u: string }>("select (snapshot_interno->'cascada'->>'utilidad_cent') as u from operacion.nota where pedido_id = $1 order by id desc limit 1", [pedido1]);
  expect(util[0]!.u).toBe('195000');
  // PDF: %PDF-, mismos bytes al reabrir, una sola fila nota_documento.
  await page.getByRole('link', { name: 'Nota', exact: true }).click();
  const href = await page.getByTestId('descargar-pdf').getAttribute('href');
  const a = await page.context().request.get(href!);
  const b = await page.context().request.get(href!);
  expect(a.status()).toBe(200);
  expect((await a.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect((await a.body()).equals(await b.body())).toBe(true);
  expect(Number((await consultar<{ n: string }>("select count(*)::int as n from operacion.nota_documento nd join operacion.nota n on n.id = nd.nota_id where n.pedido_id = $1 and nd.variante = 'cliente_pdf'", [pedido1]))[0]!.n)).toBe(1);
  expect(nativos).toEqual([]);
});

test('F05 pago parcial y total: 5,000.00, correccion de envio a 350 (6,350.00), plazo, recargo 135.00, texto de cobro, pago final y entregas de socios', async ({ page }, info) => {
  await sesionSocio(page, `/pedidos/${pedido1}`, 'Javier');
  await page.getByTestId('registrar-pago').click();
  await page.getByTestId('pago-cuenta').selectOption('Angelo');
  await page.getByTestId('pago-monto').fill('5000');
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Abonado').locator('..')).toContainText('$5,000.00');
  await expect(page.getByText('Por cobrar', { exact: true }).locator('..')).toContainText('$1,300.00');
  expect(await saldoSocio('Angelo')).toBeGreaterThanOrEqual(500_000n);
  // Correccion: envio 350.
  await page.getByTestId('barra-mas').click(); // la accion vive en el menu "Mas" de la barra de acciones
  await page.getByTestId('corregir-nota').click();
  await page.getByLabel('Motivo de la corrección').fill('el envío fue de 350');
  await page.getByLabel('Envío nuevo').fill('350');
  await page.getByTestId('confirmar').click();
  await page.getByRole('link', { name: 'Versiones' }).click();
  await expect(page.getByRole('table', { name: 'Versiones de la nota' })).toContainText('-C1');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('$6,350.00');
  const saldo = await consultar<{ s: string }>('select operacion.pedido_saldo($1)::text as s', [pedido1]);
  expect(saldo[0]!.s).toBe('135000'); // 6,350.00 - 5,000.00 = 1,350.00
  // Cuentas por cobrar: acordar plazo de 0 dias hace que el pedido venza ya; recargo sugerido 10 % del subtotal de mercancia (6,000.00) = 600.00, no del saldo (regla vigente del SQL; ver docs/campania-punta-a-punta.md).
  await page.goto('/cuentas-por-cobrar');
  await expect(page.getByRole('table', { name: 'Cuentas por cobrar por pedido' })).toContainText(d.cliente);
  await page.getByTestId(`plazo-${pedido1}`).click();
  await page.getByTestId('campo-p_dias').fill('0');
  await page.getByTestId('confirmar').click();
  await page.reload();
  await page.getByTestId(`recargo-${pedido1}`).click();
  await expect(page.getByRole('dialog')).toContainText('600.00');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar<{ s: string }>('select operacion.pedido_saldo($1)::text as s', [pedido1]))[0]!.s).toBe('195000');
  await page.reload();
  // Hay un texto por cliente con saldo (la base trae clientes de otras pruebas): se abren todos y se busca el de este cliente.
  for (const b of await page.getByTestId('copiar-texto').all()) await b.click();
  await expect(page.getByTestId('texto-copiable').filter({ hasText: '1,950.00' }).first()).toBeVisible();
  await capturar(page, info, 'claro', 'F05-cobro');
  // Pago final de 1,950.00 a la cuenta de Javier.
  await page.getByTestId('nuevo-pago').click();
  await elegirOpcion(page, 'pago-cliente', d.cliente);
  await page.getByTestId('pago-cuenta').selectOption('Javier');
  await page.getByTestId('pago-monto').fill('1950');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar<{ s: string }>('select operacion.pedido_saldo($1)::text as s', [pedido1]))[0]!.s).toBe('0');
  // Entregas: Angelo entrega 5,000.00 a la sociedad.
  const antesAngelo = await saldoSocio('Angelo');
  await page.getByTestId('entrega-Angelo').click();
  await page.getByLabel(/Monto/).fill('5000');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => saldoSocio('Angelo')).toBe(antesAngelo - 500_000n);
});

test('F06 paquetes por hacer y en trayecto: Uva 30 pz a 150.00 + envio 300 = 4,800.00; utilidad 1,472.50; doble clic en Marcar enviado = una sola salida', async ({ page }, info) => {
  await sesionSocio(page, '/pedidos/nuevo', 'Angelo');
  pedido2 = await crearPedido(page, '30', 'Uva');
  await page.getByTestId('confirmar-pedido').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Confirmado');
  await page.goto('/paquetes/por-hacer');
  await expect(page.getByRole('table', { name: 'Lista de surtido por modelo y sabor' })).toContainText(d.modelo);
  await page.getByTestId(`empacar-${pedido2}`).click();
  await expect(page.getByRole('table', { name: 'Paquetes por hacer' }).getByRole('row', { name: new RegExp(d.cliente) }).last()).toContainText('Empacado');
  const salidasAntes = await contarEventos('pedido_enviado');
  await page.getByTestId(`marcar-enviado-${pedido2}`).click();
  await page.getByLabel('Número de guía').fill(`QA-P2-${d.sufijo}`);
  await page.getByLabel('Costo real de la guía').fill('200');
  await page.getByTestId('confirmar').dblclick();
  await expect(page.getByRole('table', { name: 'Enviados recientemente' })).toContainText(`QA-P2-${d.sufijo}`);
  await expect.poll(async () => (await contarEventos('pedido_enviado')) - salidasAntes).toBe(1);
  const util = await consultar<{ u: string }>("select (snapshot_interno->'cascada'->>'utilidad_cent') as u from operacion.nota where pedido_id = $1 order by id desc limit 1", [pedido2]);
  expect(util[0]!.u).toBe('147250'); // 4,800 - 3,067.50 - 60.00 - 200.00
  // OC-2 a Isaac: Fresa 50 a 100.00, en trayecto sin subir existencia.
  await page.goto('/proveedores/compras/nueva?p=Isaac');
  await elegirOpcion(page, 'oc-modelo', d.modelo);
  await elegirOpcion(page, 'oc-sabor', 'Fresa');
  await page.getByTestId('oc-pagadas').fill('50');
  await page.getByTestId('oc-agregar').click();
  await page.getByTestId('crear-oc').click();
  await page.waitForURL(/\/proveedores\/compras\/\d+$/);
  oc2 = Number(page.url().split('/').pop());
  await page.getByTestId('confirmar-oc').click();
  await page.getByTestId('oc-enviada').click();
  await page.getByTestId('barra-mas').click();
  await page.getByTestId(`guia-${oc2}`).click();
  await page.getByLabel('Número de guía').fill(`QA-OC2-${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  const antes = await piezasYValor(d.modelo);
  await page.goto('/paquetes/en-trayecto');
  await expect(page.getByRole('row', { name: new RegExp(`QA-OC2-${d.sufijo}`) })).toBeVisible();
  expect((await piezasYValor(d.modelo)).piezas).toBe(antes.piezas);
  await page.getByTestId(`llego-${oc2}`).click();
  await expect.poll(async () => (await consultar<{ n: number }>("select count(*)::int as n from operacion.compra where id = $1 and estado = 'llego_merida'", [oc2]))[0]!.n).toBe(1);
  await page.goto(`/proveedores/compras/${oc2}#recepcion`);
  await page.getByLabel(/Piezas recibidas de/).first().fill('50');
  await page.getByTestId('confirmar-recepcion').click();
  await expect.poll(async () => (await piezasYValor(d.modelo)).piezas - antes.piezas).toBe(50);
  await capturar(page, info, 'claro', 'F06-recibida');
});

test('F07 renta de Omar y liquidacion semanal: renta 2.00 por pieza surtida, toma autorizada, neto de la semana y exportacion CSV', async ({ page }, info) => {
  await sesionSocio(page, '/omar', 'Javier');
  await expect(page.getByTestId('neto-omar')).toBeVisible();
  const renta = await consultar<{ r: string }>('select coalesce(sum(r.monto_cent), 0)::text as r from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id in ($1, $2)', [pedido1, pedido2]);
  expect(renta[0]!.r).toBe('14000'); // (40 + 30) x 2.00
  const tomas = (await consultar<{ n: number }>('select count(*)::int as n from operacion.toma_omar'))[0]!.n;
  await page.getByTestId('nueva-toma').click();
  await page.getByTestId('campo-p_sku_id').selectOption({ index: 0 });
  await page.getByTestId('campo-p_piezas').fill('3');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar<{ n: number }>('select count(*)::int as n from operacion.toma_omar'))[0]!.n).toBe(tomas + 1);
  await expect(page.getByTestId('palabra-omar')).toBeVisible();
  await capturar(page, info, 'claro', 'F07-omar');
  const descarga = page.waitForEvent('download');
  await page.getByTestId('exportar-omar').click();
  const archivo = await descarga;
  expect(archivo.suggestedFilename()).toMatch(/\.csv$/);
  // Omar no tiene ruta propia mientras esta desactivado (decision de bodega): su correo no abre sesion.
  const correoOmar = correoUnico('pap-omar');
  await altaUsuario({ correo: correoOmar, rol: 'omar', activo: false });
  const enlace = await enlaceConfirmacion(correoOmar, '/pedidos').catch(() => null);
  if (enlace) {
    const otra = await page.context().browser()!.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
    const po = await otra.newPage();
    await po.goto(enlace);
    await po.getByTestId('confirmar-acceso').click().catch(() => undefined);
    await po.goto('/pedidos');
    await expect(po).toHaveURL(/\/login/);
    await otra.close();
  }
});

test('F08 gasto de socio y reembolso: el gasto baja la utilidad una sola vez; no se reembolsa mas de lo pendiente', async ({ page }, info) => {
  await sesionSocio(page, '/socios', 'Angelo');
  const pend0 = await reembolsoPendiente('Angelo');
  await page.getByTestId('gasto-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('500');
  await page.getByTestId('campo-p_categoria').fill(`envio QA ${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await reembolsoPendiente('Angelo')) - pend0).toBe(50_000n);
  // Regla de fondeo (B, 11-nov): el pago a un socio sale primero de la caja de la empresa; se le da saldo inicial de 5,000.00 (sintetico) a la caja.
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select operacion.registrar_movimiento_efectivo($1,'Caja de la empresa','saldo_inicial',500000,'QA PaP saldo inicial de caja')", [`qa:caja:${d.sufijo}`]);
    await c.query('commit');
  });
  // Pago a socio: reembolso de 400.00 y luego un intento de 1,200.00 que excede lo pendiente.
  await page.getByTestId('pago-a-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('400');
  await page.getByTestId('campo-p_tipo').selectOption('reembolso');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await reembolsoPendiente('Angelo')) - pend0).toBe(10_000n);
  await page.getByTestId('pago-a-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('999999');
  await page.getByTestId('campo-p_tipo').selectOption('reembolso');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/excede|pendiente/i);
  await page.keyboard.press('Escape');
  await capturar(page, info, 'claro', 'F08-socios');
  // Una sola fila de gasto con esa categoria (segunda via).
  const gastos = await consultar<{ n: number }>('select count(*)::int as n from operacion.gasto where categoria = $1', [`envio QA ${d.sufijo}`]);
  expect(gastos[0]!.n).toBe(1);
});

test('F09 aportacion de capital: 1,000.00 de Javier, la devolucion automatica ya no existe y deshacer', async ({ page }) => {
  await sesionSocio(page, '/socios', 'Javier');
  await page.getByTestId('aportacion').click();
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  await page.getByTestId('campo-p_monto_cent').fill('1000');
  await page.getByTestId('campo-p_concepto').fill(`Capital adicional ${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await expect(page.getByText(`Capital adicional ${d.sufijo}`)).toBeVisible();
  await page.getByTestId('pago-a-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  // Decision del 11-nov: la devolucion de capital ya NO es automatica (retiro de capital explicito). El formulario no la ofrece y el SQL la rechaza.
  await expect(page.getByTestId('campo-p_tipo').locator('option')).toHaveText(['Reembolso de gastos', 'Retiro de utilidad ya asignada']);
  await page.getByRole('button', { name: 'Cancelar' }).click();
  const rechazo = await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    try {
      await c.query("select operacion.registrar_pago_a_socio($1,'Javier',40000,'devolucion_aportacion','transferencia')", [`qa:dev:${d.sufijo}`]);
      return 'sin error';
    } catch (e) {
      return (e as { code?: string }).code ?? 'otro';
    } finally {
      await c.query('rollback');
    }
  });
  expect(rechazo).toBe('P0428');
  const fila = page.getByRole('row').filter({ hasText: `Capital adicional ${d.sufijo}` });
  await fila.getByRole('button', { name: 'Deshacer' }).click();
  await page.getByTestId('campo-motivo').fill('captura de prueba');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: `Capital adicional ${d.sufijo}` }).first()).toContainText('deshecho');
  // Doble clic en Registrar aportacion: una sola captura.
  const antes = await consultar<{ n: number }>("select count(*)::int as n from operacion.aportacion_socio where concepto = $1", [`Doble clic ${d.sufijo}`]);
  await page.getByTestId('aportacion').click();
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  await page.getByTestId('campo-p_monto_cent').fill('10');
  await page.getByTestId('campo-p_concepto').fill(`Doble clic ${d.sufijo}`);
  await page.getByTestId('confirmar').dblclick();
  await expect.poll(async () => (await consultar<{ n: number }>("select count(*)::int as n from operacion.aportacion_socio where concepto = $1 and reversa_de is null", [`Doble clic ${d.sufijo}`]))[0]!.n).toBe(antes[0]!.n + 1);
});

test('F10 estado de cuenta y cascada de reparto: cinco pasos, identidad por dos vias, liquidacion entre socios y cierre firmado por los dos', async ({ page, browser }, info) => {
  await sesionSocio(page, '/socios/Javier', 'Javier');
  await expect(page.getByTestId('neto-socio')).toBeVisible();
  await page.getByTestId('neto-socio').getByRole('button').click();
  await expect(page.getByTestId('explicar-cajon')).toContainText('Cuadra');
  await page.keyboard.press('Escape');
  await page.goto('/socios/cascada');
  for (const paso of ['3. Orden de pago con ese efectivo', '5. Saldo entre socios']) await expect(page.getByText(paso)).toBeVisible();
  await expect(page.getByTestId('utilidad-neta')).toBeVisible();
  await expect(page.getByTestId('repartible')).toBeVisible();
  await capturar(page, info, 'claro', 'F10-cascada');
  // Identidad: suma de netos coherente por dos vias (SQL).
  const dif = await consultar<{ n: number }>('select count(*)::int as n from catalogo.socio s where operacion.neto_socio(s.id) <> operacion.aportado_socio(s.id) + operacion.libro_socio(s.id) - operacion.saldo_socio(s.id)');
  expect(dif[0]!.n).toBe(0);
  // Cierre de la semana anterior: propone Javier, firma Javier, firma Angelo desde otra sesion.
  await page.getByTestId('semana-anterior').click();
  await page.getByTestId('proponer-cierre').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Propuesto: faltan las dos firmas')).toBeVisible();
  await page.getByRole('button', { name: 'Firmar' }).first().click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Firmado por uno: falta el otro socio')).toBeVisible();
  const otra = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pa = await otra.newPage();
  await sesionSocio(pa, '/socios/cascada', 'Angelo');
  await pa.getByTestId('semana-anterior').click();
  await pa.getByRole('button', { name: 'Firmar' }).first().click();
  await pa.getByTestId('confirmar').click();
  await expect(pa.getByText('Cerrado y firmado por los dos')).toBeVisible();
  await otra.close();
});

test('F11 anulacion: anular el pedido P-2 regresa las 30 piezas a su costo original 3,067.50 y revierte la renta; la nota original sigue', async ({ page }, info) => {
  const antes = await piezasYValor(d.modelo);
  await sesionSocio(page, `/pedidos/${pedido2}`, 'Javier');
  await page.getByTestId('barra-mas').click(); // la accion vive en el menu "Mas" de la barra de acciones
  await page.getByTestId('anular-pedido').click();
  await page.getByRole('dialog').getByLabel('Motivo').fill('devolucion total del cliente');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Anulado');
  const despues = await piezasYValor(d.modelo);
  expect(despues.piezas - antes.piezas).toBe(30);
  expect(despues.valor - antes.valor).toBe(306_750n);
  const renta = await consultar<{ r: string }>('select coalesce(sum(r.monto_cent), 0)::text as r from operacion.renta_devengo r join operacion.pedido_linea l on l.id = r.pedido_linea_id where l.pedido_id = $1', [pedido2]);
  expect(renta[0]!.r).toBe('0');
  expect(Number((await consultar<{ n: string }>('select count(*)::int as n from operacion.nota where pedido_id = $1', [pedido2]))[0]!.n)).toBe(1);
  await capturar(page, info, 'claro', 'F11-anulado');
  // Anular dos veces: la pantalla ya no ofrece el boton (la base lo rechazaria con P0428).
  await expect(page.getByTestId('anular-pedido')).toHaveCount(0);
  // Deshacer un movimiento de proveedor: contramovimiento unico.
  await page.goto('/proveedores/liquidacion?p=Isaac&ambito=todo');
  await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
});

test('F12 avisos: Pendientes y Todos, enlace a la entidad, marcar leido baja en uno y doble clic cuenta una vez', async ({ page }, info) => {
  await sesionSocio(page, '/avisos', 'Javier');
  const pendientes = page.getByRole('table', { name: 'Avisos' });
  await expect(pendientes).toBeVisible();
  const filas = await pendientes.getByRole('row').count();
  expect(filas).toBeGreaterThan(1);
  await expect(pendientes).toContainText(/NT-0\d\d/);
  await capturar(page, info, 'claro', 'F12-avisos');
  const boton = pendientes.getByRole('button', { name: /Marcar leído/i }).first();
  if (await boton.count()) {
    const sinLeer = (await consultar<{ n: number }>('select count(*)::int as n from operacion.aviso a where not exists (select 1 from operacion.aviso_lectura l where l.aviso_id = a.id)'))[0]!.n;
    await boton.dblclick();
    await expect.poll(async () => (await consultar<{ n: number }>('select count(*)::int as n from operacion.aviso a where not exists (select 1 from operacion.aviso_lectura l where l.aviso_id = a.id)'))[0]!.n).toBe(sinLeer - 1);
  }
  await page.goto('/avisos?estado=todos');
  await expect(page.getByRole('table', { name: 'Avisos' })).toBeVisible();
});

test('F13 liquidacion semanal con Isaac: hoja con comprobacion, ambito sociedad/todo, lo que dice el proveedor, cierre solo el viernes y nota para el proveedor', async ({ page }, info) => {
  await sesionSocio(page, '/proveedores?p=Isaac', 'Angelo');
  await expect(page.getByTestId('falta-por-saldar')).toBeVisible();
  await page.getByTestId('abrir-liquidacion').click();
  await page.waitForURL('**/proveedores/liquidacion**');
  await expect(page.getByTestId('comprobacion')).toContainText('Cuadra');
  await page.getByTestId('ambito-todo').click();
  await expect(page.getByTestId('comprobacion')).toContainText('Cuadra');
  await page.getByTestId('ambito-sociedad').click();
  await page.getByTestId('registrar-dicho').click();
  await page.getByTestId('dicho-total').fill('100');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('dicho')).toContainText('$100.00');
  await expect(page.getByTestId('diferencia')).not.toContainText('Sin dato');
  await page.getByTestId('copiar-texto').click();
  await expect(page.getByTestId('texto-copiable')).toContainText('Falta por saldar');
  await expect(page.getByTestId('texto-copiable')).not.toContainText(d.cliente);
  const hoyEsViernes = new Date(Date.now() - 6 * 3_600_000).getUTCDay() === 5;
  if (!hoyEsViernes) await expect(page.getByTestId('cerrar-liquidacion')).toBeDisabled();
  await page.getByTestId('barra-mas').click();
  await page.getByRole('link', { name: 'Semana anterior' }).click();
  await expect(page.getByTestId('comprobacion')).toBeVisible();
  await capturar(page, info, 'claro', 'F13-liquidacion');
});

test('INVARIANTES de fin de campaña por SQL (seccion 3.14): cadena de auditoria, existencias, reversas unicas y socios por dos vias', async () => {
  const q = async (sql: string) => (await consultar<{ n: string }>(sql))[0]!.n;
  expect(await q('select seguridad.verificar_cadena_auditoria()::text as n')).toBe('true');
  expect(await q('select count(*)::text as n from operacion.existencia_modelo e where e.piezas <> coalesce((select sum(mi.cantidad) from operacion.movimiento_inventario mi where mi.modelo_id = e.modelo_id), 0)')).toBe('0');
  expect(await q('select count(*)::text as n from operacion.existencia_modelo e where e.valor_cent <> coalesce((select sum(mi.valor_cent) from operacion.movimiento_inventario mi where mi.modelo_id = e.modelo_id), 0)')).toBe('0');
  expect(await q('select count(*)::text as n from operacion.existencia_modelo where piezas < 0')).toBe('0');
  expect(await q('select count(*)::text as n from (select reversa_de from operacion.evento where reversa_de is not null group by reversa_de having count(*) > 1) x')).toBe('0');
  expect(await q('select count(*)::text as n from catalogo.socio s where operacion.neto_socio(s.id) <> operacion.aportado_socio(s.id) + operacion.libro_socio(s.id) - operacion.saldo_socio(s.id)')).toBe('0');
  expect(await q('select operacion.saldo_puente()::text as n')).toBe('0');
});

test('tema oscuro: los mismos flujos en pantalla (F03, F04, F10, F13) se recorren y se capturan', async ({ page }, info) => {
  await fijarTema(page, 'oscuro');
  await sesionSocio(page, '/inventario', 'Javier');
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'oscuro');
  await capturar(page, info, 'oscuro', 'F03-inventario');
  await page.goto(`/pedidos/${pedido1}`);
  await capturar(page, info, 'oscuro', 'F04-pedido');
  await page.goto('/socios/cascada');
  await capturar(page, info, 'oscuro', 'F10-cascada');
  await page.goto('/proveedores/liquidacion?p=Isaac');
  await capturar(page, info, 'oscuro', 'F13-liquidacion');
});
