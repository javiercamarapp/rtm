// Recorrido completo de "cuadrar cuentas" por la interfaz real, sobre una base local VACIA (solo catalogo ilustrativo). Nada real.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, consultar, correoUnico, entrarComo, ipFalsa } from '../e2e/ayudas';
import { cap, sembrarCatalogo, elegirOpcion, type Demo } from './ayuda';

test.describe.configure({ mode: 'serial' });
let d: Demo;
let angelo: Page;
let javier: Page;

test.beforeAll(async ({ browser }) => {
  d = await sembrarCatalogo();
  const ca = correoUnico('cuadre-ang');
  const cj = correoUnico('cuadre-jav');
  await altaUsuario({ correo: ca, socio: 'Angelo' });
  await altaUsuario({ correo: cj, socio: 'Javier' });
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const ctxJ = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  angelo = await ctxA.newPage();
  javier = await ctxJ.newPage();
  await entrarComo(angelo, ca, '/apertura');
  await entrarComo(javier, cj, '/apertura');
});

async function agregar(page: Page, paso: number, categoria: string, campos: Record<string, string>) {
  await page.goto(`/apertura/paso/${paso}`);
  const form = page.getByTestId(`form-${categoria}`);
  for (const [id, valor] of Object.entries(campos)) {
    const campo = form.getByTestId(`campo-${id}`);
    if ((await campo.evaluate((e) => e.tagName)) === 'SELECT') await campo.selectOption({ label: valor }); else await campo.fill(valor);
  }
  const antes = await page.getByRole('row').count();
  await form.getByTestId('agregar-partida').click();
  await expect.poll(async () => page.getByRole('row').count()).toBeGreaterThan(antes);
}

test('0 salud: /api/health y /api/salud publicas; otra ruta de API sin sesion da 401 JSON, no 307', async ({ request }) => {
  expect((await request.get('/api/health')).status()).toBe(200);
  expect((await request.get('/api/salud')).status()).toBe(200);
  const r = await request.get('/api/no-existe', { maxRedirects: 0 });
  expect(r.status()).toBe(401);
});

test('1 apertura: saldos iniciales, inventario, cuentas por cobrar y por pagar, cajas de efectivo; firman los dos socios', async () => {
  const page = angelo;
  await page.goto('/apertura');
  await cap(page, 'apertura-vacia');
  await page.getByTestId('apertura-crear').click();
  await page.getByRole('button', { name: 'Abrir sesión' }).click();
  await expect(page.getByTestId('apertura-estado')).toContainText('Borrador');
  await agregar(page, 3, 'aportacion', { socio: 'Angelo', monto: '84615' });
  await agregar(page, 3, 'aportacion', { socio: 'Javier', monto: '56000' });
  await agregar(page, 4, 'inventario', { modelo: d.modeloCompleto, sabor: 'Fresa', piezas: '100', costo: '102.25' });
  await agregar(page, 4, 'inventario', { modelo: d.modeloCompleto, sabor: 'Uva', piezas: '60', costo: '102.25' });
  await agregar(page, 5, 'caja', { socio: 'Angelo', monto: '5000' });
  await agregar(page, 5, 'caja', { socio: 'Javier', monto: '3000' });
  await agregar(page, 6, 'cxc', { cliente: d.clienteA, monto: '7500', fecha: '2026-10-20' });
  await agregar(page, 7, 'proveedor_debemos', { proveedor: 'Isaac', monto: '3000' });
  await cap(page, 'apertura-paso-7');
  await page.goto('/apertura');
  await cap(page, 'apertura-resumen');
  await page.goto('/apertura/paso/9');
  await expect(page.getByTestId('previa-cuadra')).toContainText('el asiento cuadra');
  await cap(page, 'apertura-validacion');
  await page.getByTestId('apertura-resolucion').click();
  await page.getByTestId('campo-p_resolucion').selectOption('capital_50_50');
  await page.getByTestId('campo-p_justificacion').fill('Diferencia entre el capital declarado y los saldos de la demostracion');
  await page.getByRole('button', { name: 'Guardar resolución' }).click();
  // La resolucion debe quedar guardada ANTES de firmar: si no, la diferencia de apertura se queda en la cuenta puente 3990 y C20 sale en rojo.
  await expect.poll(async () => (await consultar<{ r: string }>('select resolucion_puente as r from apertura.sesion order by id desc limit 1'))[0]!.r, { timeout: 15_000 }).toBe('capital_50_50');
  await page.goto('/apertura/paso/10');
  await page.getByTestId('apertura-firmar').click();
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await expect(page.getByTestId('estado-firma')).toContainText('Falta la firma de Javier');
  await javier.goto('/apertura/paso/10');
  await javier.getByTestId('apertura-firmar').click();
  await javier.getByRole('button', { name: 'Firmar', exact: true }).click();
  await expect(javier.getByTestId('estado-firma')).toContainText('Publicada');
  await cap(javier, 'apertura-publicada');
});

test('2 despues de la apertura: Cuentas por cobrar, proveedor, socios y Contabilidad muestran los saldos iniciales', async () => {
  const page = angelo;
  await page.goto('/cuentas-por-cobrar');
  await cap(page, 'cxc-tras-apertura');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('7,500.00');
  await page.goto('/proveedores?p=Isaac');
  await cap(page, 'isaac-tras-apertura');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText('3,000.00');
  await page.goto('/socios');
  await cap(page, 'socios-tras-apertura');
  await page.goto('/contabilidad/comprobaciones');
  await cap(page, 'comprobaciones-tras-apertura');
  await page.goto('/contabilidad/balance');
  await cap(page, 'balance-tras-apertura');
  await page.goto('/inventario');
  await cap(page, 'inventario-tras-apertura');
});

test('3 importar movimientos: pegar, ensayo sin escribir, importar, reimportar da cero, clasificar', async () => {
  const page = angelo;
  const SUF = d.sufijo;
  await page.goto('/movimientos/importar');
  await page.getByTestId('pegado').fill([
    `2026-11-03\t7500.00\tEfectivo\t${d.clienteA}\tCobro ${SUF}`,
    `2026-11-04\t-3000.00\tEfectivo\tIsaac\tPago ${SUF}`,
  ].join('\n'));
  await page.getByTestId('contar').click();
  await expect(page.getByTestId('conteo')).toContainText('2 nuevas');
  await cap(page, 'movimientos-ensayo');
  await page.getByTestId('importar').click();
  await expect(page.getByTestId('conteo')).toContainText('2 nuevas, 0 ya existían');
  await page.getByTestId('importar').click();
  await expect(page.getByTestId('conteo')).toContainText('0 nuevas, 2 ya existían');
  await page.goto('/movimientos?estado=sin_clasificar');
  const cobro = page.getByRole('row').filter({ hasText: `Cobro ${SUF}` });
  await cobro.getByRole('button', { name: 'Clasificar' }).click();
  await page.getByTestId('campo-cliente').selectOption({ label: d.clienteA });
  await page.getByRole('button', { name: 'Guardar clasificación' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/movimientos');
  await cap(page, 'movimientos-bandeja');
});

test('4 compra a Isaac: orden, confirmar, enviada, guia, llego, recepcion', async () => {
  const page = angelo;
  await page.goto('/proveedores/compras/nueva?p=Isaac');
  await cap(page, 'compra-nueva');
  await elegirOpcion(page, 'oc-modelo', d.modelo);
  await elegirOpcion(page, 'oc-sabor', 'Fresa');
  await page.getByTestId('oc-pagadas').fill('50');
  await expect(page.getByTestId('oc-costo')).toHaveValue('100.00');
  await page.getByTestId('oc-agregar').click();
  await page.getByLabel('Costo de la guía').fill('250');
  await page.getByLabel('Guía pagada por').selectOption('Angelo');
  await page.getByTestId('crear-oc').click();
  await page.waitForURL(/\/proveedores\/compras\/\d+$/);
  const oc = Number(page.url().split('/').pop());
  await page.getByTestId('confirmar-oc').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Confirmada');
  await page.getByTestId('oc-enviada').click();
  await page.getByTestId(`guia-${oc}`).click();
  await page.getByLabel('Número de guía').fill(`CUADRE-OC-${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await page.goto('/paquetes/en-trayecto');
  await page.getByTestId(`llego-${oc}`).click();
  await page.goto(`/proveedores/compras/${oc}#recepcion`);
  await page.getByLabel(/Piezas recibidas de/).first().fill('50');
  await page.getByTestId('confirmar-recepcion').click();
  await expect(page.getByTestId('estado-oc')).toContainText('Recibida');
  await cap(page, 'compra-recibida');
});

test('4b persona de bodega: se da de alta desde la ficha del cliente (sin ella, Marcar enviado falla)', async () => {
  const page = angelo;
  await page.goto('/clientes');
  await page.getByRole('link', { name: d.omar }).first().click();
  await page.waitForURL(/\/clientes\/\d+$/);
  await cap(page, 'persona-bodega-antes');
  await page.getByTestId('alta-persona-bodega').click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('alta-persona-bodega')).toHaveCount(0);
  await expect.poll(async () => (await consultar<{ n: string }>('select count(*)::text as n from catalogo.persona_bodega'))[0]!.n).toBe('1');
  await cap(page, 'persona-bodega-despues');
});

let pedido = Number(process.env.CUADRE_PEDIDO ?? 0);
test('5 venta: pedido con nota, empacar, enviar con guia', async () => {
  const page = angelo;
  await page.goto('/pedidos/nuevo');
  await page.getByTestId('elegir-cliente').selectOption({ label: d.clienteB });
  await page.getByRole('button', { name: 'Elegir cliente' }).click();
  await page.waitForURL(/pedidos\/nuevo\?cliente=/);
  await elegirOpcion(page, 'modelo', d.modelo);
  await elegirOpcion(page, 'sabor', 'Fresa');
  await page.getByTestId('piezas').fill('20');
  await page.getByTestId('agregar-renglon').click();
  await page.getByTestId('envio').fill('300');
  await cap(page, 'pedido-nuevo');
  await page.getByTestId('crear-pedido').click();
  await page.waitForURL(/\/pedidos\/\d+$/);
  pedido = Number(page.url().split('/').pop());
  await page.getByTestId('confirmar-pedido').click();
  await expect(page.getByTestId('estado-pedido')).toContainText('Confirmado');
  await page.getByTestId('marcar-empacado').click();
  await expect(page.getByText('Empacado', { exact: true })).toBeVisible();
  await page.getByTestId(`marcar-enviado-${pedido}`).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel(/Surtidas de/).fill('20');
  await dialogo.getByLabel('Número de guía').fill(`CUADRE-P-${d.sufijo}`);
  await dialogo.getByLabel('Paquetería').fill('Castores');
  await dialogo.getByLabel('Costo real de la guía').fill('180');
  await page.getByTestId('confirmar').click();
  await page.waitForTimeout(2500);
  await cap(page, 'pedido-envio-resultado');
  await expect(page.getByTestId('estado-pedido')).toContainText('Enviado');
  await expect(page.getByTestId('nota-cliente')).not.toContainText(/costo|utilidad|margen/i);
  await cap(page, 'pedido-enviado');
});

test('6 cobro: pago parcial y final del pedido, a la caja de un socio', async () => {
  const page = angelo;
  await page.goto(`/pedidos/${pedido}`);
  await page.getByTestId('registrar-pago').click();
  await page.getByTestId('pago-cuenta').selectOption('Angelo');
  await page.getByTestId('pago-monto').fill('1000');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('region', { name: 'Cifras del pedido' }).getByText('Abonado').locator('..')).toContainText('$1,000.00');
  await cap(page, 'cobro-parcial');
  const saldo = (await consultar<{ s: string }>('select operacion.pedido_saldo($1)::text as s', [pedido]))[0]!.s;
  await page.goto('/cuentas-por-cobrar');
  await page.getByTestId('nuevo-pago').click();
  await elegirOpcion(page, 'pago-cliente', d.clienteB);
  await page.getByTestId('pago-cuenta').selectOption('Javier');
  await page.getByTestId('pago-monto').fill((Number(saldo) / 100).toFixed(2));
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => (await consultar<{ s: string }>('select operacion.pedido_saldo($1)::text as s', [pedido]))[0]!.s).toBe('0');
  await page.reload();
  await cap(page, 'cxc-tras-cobro');
});

test('7 pago a proveedor: pago de la sociedad a Isaac y pago de un socio', async () => {
  const page = angelo;
  await page.goto('/proveedores?p=Isaac');
  await page.getByTestId('pago-sociedad').click();
  await page.getByLabel(/Monto/).fill('1000');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await cap(page, 'pago-isaac-sociedad');
  await page.getByTestId('pago-socio').click();
  await page.getByLabel('Socio que pagó').selectOption('Javier');
  await page.getByLabel(/Monto/).fill('500');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))::text as s"))[0]!.s).toBe('-650000');
  await page.reload();
  await cap(page, 'isaac-tras-pagos');
  // Cada socio registra lo que pago de su bolsillo a Isaac (dinero propio), con montos distintos y SIN buscar que nada "cuadre": la salud de Socios es el libro conciliado,
  // no que los socios pongan todo el costo. Es dinero de los socios, no de la caja de la sociedad: el efectivo (8,600) no cambia. Regla del dueno: dinero propio = REEMBOLSO
  // (cuenta por pagar al socio); solo es capital si el socio lo declara con la casilla (aqui NO se marca).
  for (const [socio, monto] of [['Angelo', '1234.56'], ['Javier', '2345.67']] as const) {
    await page.getByTestId('pago-socio').click();
    await page.getByLabel('Socio que pagó').selectOption(socio);
    await page.getByLabel(/Monto/).fill(monto);
    await page.getByLabel('Con qué dinero').selectOption('dinero_propio');
    await expect(page.getByTestId('declara-capital')).not.toBeChecked();
    await page.getByTestId('confirmar').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect.poll(async () => (await consultar<{ s: string }>("select operacion.saldo_proveedor(catalogo.proveedor_id('Isaac'))::text as s"))[0]!.s).toBe('-291977');
  const pagosPropios = await consultar<{ clasificacion: string; n: string; total: string }>("select clasificacion, count(*)::text as n, sum(monto_cent)::text as total from operacion.aportacion_socio where ref_tipo = 'cuenta_proveedor' group by clasificacion");
  expect(pagosPropios.find((r) => r.clasificacion === 'capital')).toBeUndefined();
  expect(pagosPropios.find((r) => r.clasificacion === 'reembolsable')).toMatchObject({ n: '2', total: '358023' });
  await page.reload();
  await cap(page, 'isaac-tras-pagos-de-socios');
});

test('8 socios: aportacion, gasto de socio y reembolso', async () => {
  const page = javier;
  await page.goto('/socios');
  await page.getByTestId('aportacion').click();
  await page.getByTestId('campo-p_socio').selectOption('Javier');
  await page.getByTestId('campo-p_monto_cent').fill('2000');
  await page.getByTestId('campo-p_concepto').fill(`Aportacion demo ${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await expect(page.getByText(`Aportacion demo ${d.sufijo}`).first()).toBeVisible();
  await page.getByTestId('gasto-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('400');
  await page.getByTestId('campo-p_categoria').fill(`envio demo ${d.sufijo}`);
  await page.getByTestId('confirmar').click();
  await page.reload();
  await cap(page, 'socios-tras-gasto');
  await page.getByTestId('pago-a-socio').click();
  await page.getByTestId('campo-p_socio').selectOption('Angelo');
  await page.getByTestId('campo-p_monto_cent').fill('400');
  await page.getByTestId('campo-p_tipo').selectOption('reembolso');
  await page.getByTestId('confirmar').click();
  await page.reload();
  await cap(page, 'socios-tras-reembolso');
});

test('9 todo cuadra: comprobaciones, Contabilidad, Cuentas por cobrar, Socios y Reportes', async () => {
  const page = angelo;
  for (const [ruta, nombre] of [['/contabilidad/comprobaciones', 'final-comprobaciones'], ['/contabilidad', 'final-contabilidad'], ['/contabilidad/balance', 'final-balance'], ['/contabilidad/diario', 'final-diario'], ['/contabilidad/caja', 'final-caja'], ['/cuentas-por-cobrar', 'final-cxc'], ['/socios', 'final-socios'], ['/socios/cascada', 'final-cascada'], ['/reportes', 'final-reportes'], ['/inventario', 'final-inventario']] as const) {
    await page.goto(ruta);
    await cap(page, nombre);
  }
  await page.goto('/reportes');
  await page.getByRole('button', { name: 'Preparar reporte' }).click();
  await page.waitForTimeout(4000);
  await cap(page, 'final-reporte-preparado');
  await page.goto('/contabilidad/comprobaciones');
  await expect(page.getByText('comprobación bloqueante falla')).toHaveCount(0);
  // Sin .catch: si la consulta falla, la prueba falla. Ninguna comprobacion (C1..C22, CU1..CU3, CA1 ni CA2) puede estar en rojo en este recorrido.
  const rojas = await consultar<{ codigo: string }>('select c.codigo from contabilidad.comprobaciones() c where not c.ok order by 1');
  expect(rojas.map((r) => r.codigo)).toEqual([]);
  const total = await consultar<{ n: string }>('select count(*)::text as n from contabilidad.comprobaciones()');
  expect(total[0]!.n).toBe('27');

  // Efectivo: cajas de la apertura (8,000) + aportacion capturada (2,000) - reembolso pagado a Angelo (400) - pago de la sociedad a Isaac (1,000) = 8,600.
  // El libro (1101), Caja y liquidez y la Cascada dicen lo mismo; el pago de la sociedad descuenta el efectivo total (no decide de que caja sale).
  const ef = (await consultar<{ e: string; t: string; l: string; lt: string }>(
    "select operacion.saldo_efectivo()::text as e, (operacion.efectivo_sociedad()->>'total_cent') as t, contabilidad.apertura_saldo('1101')::text as l, contabilidad.saldo_deudor('1101')::text as lt"))[0]!;
  expect(ef.e).toBe('860000');
  expect(ef.lt).toBe(ef.e);
  expect(ef.l).toBe('800000');
  const dinero = (c: string) => `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await page.goto('/socios/cascada');
  await expect(page.getByTestId('efectivo-calculado')).toContainText(dinero(ef.t));
  await expect(page.getByTestId('efectivo-calculado')).toContainText(dinero('860000'));
  await expect(page.getByText('Identidad por dos vías').locator('..')).toContainText('Cuadra');
  await page.goto('/contabilidad/caja');
  await expect(page.locator('main:not(.rtm-documento)')).toContainText(dinero(ef.lt));
  await page.goto('/contabilidad/comprobaciones');
  await expect(page.getByTestId('comprobacion-CA2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Todo cuadra' })).toBeVisible();

  // Socios: la senal es "Libro conciliado" (identidades del libro). Todavia se debe a Isaac (apertura y compra), asi que dice "pendiente de pago al proveedor"; la diferencia por la
  // compra (via 1 y via 2) es informativa y NO tiene que coincidir. El desglose del costo explica de donde salio cada centavo.
  await page.goto('/socios');
  const principal = page.locator('main:not(.rtm-documento)');
  await expect(principal).toContainText('Libro conciliado');
  await expect(principal).toContainText('Pendiente de pago al proveedor');
  await expect(principal).not.toContainText('Revisar el libro');
  await expect(principal).not.toContainText('No cuadra');
  await page.getByTestId('libro-socios').getByRole('button').click();
  await expect(page.getByRole('dialog')).toContainText('Identidades que se cumplen');
  await cap(page, 'final-socios-libro-conciliado');
  await page.keyboard.press('Escape');
  const cs = (await consultar<{ lc: string; estado: string; otros: string; costo: string; suma: string }>(
    "select (x->'cuadre'->>'libro_conciliado') as lc, (x->'cuadre'->>'estado') as estado, (x->>'otros_cent') as otros, (x->>'costo_cent') as costo, ((x->>'directo_socios_cent')::bigint + (x->>'pagado_por_sociedad_cent')::bigint + (x->>'pagado_con_fondos_cent')::bigint + (x->>'pendiente_proveedor_cent')::bigint + (x->>'otros_cent')::bigint)::text as suma from (select operacion.cuenta_socios() as x) q"))[0]!;
  expect(cs.lc).toBe('true');
  expect(cs.estado).toBe('pendiente_proveedor');
  expect(cs.suma).toBe(cs.costo);
  expect((await consultar<{ n: string }>('select seguridad.verificar_cadena_auditoria()::text as n'))[0]!.n).toBe('true');
});
