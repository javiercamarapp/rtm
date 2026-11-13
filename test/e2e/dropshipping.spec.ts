// Recorrido de dropshipping (datos SINTETICOS; ninguna persona, direccion, telefono ni correo reales):
// capturar un pedido, copiar la orden para Karen, registrar el folio y pagos parciales, ver el desglose por origen y que /pedidos filtra bien.
// Capturas en docs/capturas/dropshipping (claro y oscuro; 1440 y 390 segun el proyecto).
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, conDb, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

const SUFIJO = Date.now().toString(36);
const MARCA = 'E2E DS Marca';
const MODELO = `E2E DS Modelo ${SUFIJO}`;
const CLIENTE = `E2E DS Cliente ${SUFIJO}`;
const CLIENTE_B = `E2E DS Cliente B ${SUFIJO}`;
const FOLIO = String(70000 + Math.floor(Math.random() * 29999));
const DIR = 'docs/capturas/dropshipping';
mkdirSync(DIR, { recursive: true });

test.beforeAll(async () => {
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [`E2E DS Persona Bodega ${SUFIJO}`]);
    await c.query('select catalogo.asegurar_persona_bodega($1,$1)', [`E2E DS Persona Bodega ${SUFIJO}`]);
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [CLIENTE]);
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [CLIENTE_B]);
    await c.query("select catalogo.asegurar_modelo($1,$2,25000,'ambas')", [MARCA, MODELO]);
    for (const s of ['Fresa', 'Mango', 'Uva']) await c.query('select catalogo.asegurar_sku($1,$2)', [MODELO, s]);
    await c.query("select catalogo.fijar_costo($1,'Karen',$2,8929,'2026-11-01','e2e')", [`e2eds:ck:${SUFIJO}`, MODELO]);
    await c.query("select catalogo.fijar_costo($1,'Isaac',$2,9000,'2026-11-01','e2e')", [`e2eds:ci:${SUFIJO}`, MODELO]);
    await c.query("select catalogo.fijar_precio($1,$2,$3,10480,'2026-11-01','chat')", [`e2eds:p:${SUFIJO}`, CLIENTE, MODELO]);
    await c.query("select catalogo.fijar_precio($1,$2,$3,10480,'2026-11-01','chat')", [`e2eds:pb:${SUFIJO}`, CLIENTE_B, MODELO]);
    // Un pedido de inventario en Merida (borrador) para ver las dos columnas y el filtro de /pedidos.
    await c.query("select operacion.crear_pedido($1,(select id from catalogo.cliente where nombre_canonico = $2),$3::jsonb,'bodega_omar')", [`e2eds:inv:${SUFIJO}`, CLIENTE_B, JSON.stringify([{ modelo: MODELO, sabor: 'Fresa', piezas: 20 }])]);
    await c.query('commit');
  });
});

async function sesion(page: Page, ruta: string, socio: 'Angelo' | 'Javier' = 'Javier') {
  const correo = correoUnico('ds');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, ruta);
}
async function tema(page: Page, t: 'claro' | 'oscuro') {
  await page.evaluate((x) => { localStorage.setItem('rtm-tema', x); document.documentElement.dataset.tema = x; }, t);
}
async function capturar(page: Page, nombre: string, testInfo: { project: { name: string } }) {
  // La app desplaza dentro de su panel: se alarga la ventana para que la captura muestre la pagina completa.
  const original = page.viewportSize();
  if (original) await page.setViewportSize({ width: original.width, height: original.width > 800 ? 2600 : 3600 });
  await page.waitForTimeout(300);
  for (const t of ['claro', 'oscuro'] as const) {
    await tema(page, t);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${DIR}/${nombre}-${testInfo.project.name}-${t}.png`, fullPage: true });
  }
  await tema(page, 'claro');
  if (original) await page.setViewportSize(original);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const celdasSurtido = (page: Page) => page.$$eval('[data-testid^="surtido-"]', (els) => els.filter((e) => /^surtido-\d+$/.test(e.getAttribute('data-testid') ?? '')).map((e) => e.textContent ?? ''));
const num = (s: string) => Number(s.replace(/[^0-9.-]/g, ''));

test('captura el pedido, copia la orden, registra el folio de Karen, paga en parcialidades y ve el desglose', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await sesion(page, '/dropshipping');
  await expect(page.getByRole('navigation', { name: 'Navegacion principal' }).or(page.getByLabel('Navegación principal')).getByText('Dropshipping', { exact: true })).toBeVisible();

  // Nuevo pedido
  await page.goto('/dropshipping/nuevo');
  await page.getByTestId('ds-elegir-cliente').selectOption({ label: CLIENTE });
  await page.getByTestId('ds-elegir').click();
  await page.waitForURL(/cliente=\d+/);
  await page.getByTestId('ds-modelo').selectOption({ label: `${MARCA} · ${MODELO}` });
  await page.getByTestId('ds-pegado').fill('Fresa 40\nMango 35\nUva 25');
  await page.getByTestId('ds-agregar-pegado').click();
  await expect(page.getByTestId('ds-renglones').locator('li')).toHaveCount(3);
  await expect(page.getByTestId('prev-piezas')).toHaveText('100 pz');
  await expect(page.getByTestId('prev-costo')).toHaveText('$8,929.00');
  await expect(page.getByTestId('prev-venta')).toHaveText('$10,480.00');
  await expect(page.getByTestId('prev-margen')).toContainText('$1,551.00');
  await expect(page.getByTestId('ds-orden-previa')).toContainText('Fresa x 40');
  await page.getByTestId('dest-nombre').fill('Persona Sintetica Uno');
  await page.getByTestId('dest-calle').fill('Calle Ficticia 123');
  await page.getByTestId('dest-colonia').fill('Colonia Imaginaria');
  await page.getByTestId('dest-cp').fill('97000');
  await page.getByTestId('dest-municipio').fill('Municipio Ejemplo');
  await page.getByTestId('dest-estado').fill('Estado Ejemplo');
  await page.getByTestId('dest-telefono').fill('9990001111');
  await page.getByTestId('dest-correo').fill('destino.sintetico@example.test');
  // Credito: 10 % de una semana sobre la mercancia (interes simple)
  await page.getByTestId('ds-credito').check();
  await expect(page.getByTestId('prev-interes')).toHaveText('$1,048.00');
  await expect(page.getByTestId('prev-total')).toHaveText('$11,528.00');
  await page.getByTestId('ds-credito').uncheck();
  await expect(page.getByTestId('prev-interes')).toHaveText('$0.00');
  await capturar(page, 'nuevo-pedido', testInfo);
  await page.getByTestId('ds-crear').click();
  await expect(page.getByTestId('ds-creado')).toBeVisible();
  await expect(page.getByTestId('orden-texto')).toContainText('*** ** 11');
  await page.getByTestId('copiar-orden').click();
  await expect(page.getByTestId('orden-copiada')).toBeVisible();
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toContain('Entregar a:\nPersona Sintetica Uno');
  expect(copiado).toContain('Tel: 9990001111');
  expect(copiado).not.toMatch(/10,?480|89\.29/);
  await page.getByTestId('ir-ficha').click();
  await page.waitForURL(/\/dropshipping\/pedidos\/\d+$/);
  const idPedido = Number(page.url().split('/').pop());

  // Ficha: destinatario protegido con Revelar auditado, folio de Karen, confirmar y enviar
  await expect(page.getByTestId('telefono-valor')).toHaveText('*** ** 11');
  await expect(page.getByTestId('correo-valor')).toHaveText('d***@***');
  await page.getByTestId('revelar-telefono').click();
  await expect(page.getByTestId('telefono-valor')).toHaveText('9990001111');
  const rev = await conDb((c) => c.query("select count(*)::int n from entrega.revelacion where pedido_id = $1 and accion in ('telefono','orden')", [idPedido]));
  expect(Number(rev.rows[0].n)).toBeGreaterThanOrEqual(2);
  await page.getByTestId('folio-externo-campo').fill(FOLIO);
  await page.getByTestId('folio-externo-guardar').click();
  await expect(page.getByTestId('ds-folio-ext-etiqueta')).toContainText(FOLIO);
  await page.getByTestId('ds-confirmar').click();
  await expect(page.getByTestId('ds-estado')).toContainText('Confirmado');
  await page.getByTestId('ds-enviado').click();
  await expect(page.getByTestId('ds-estado')).toContainText('Enviado');
  await capturar(page, 'ficha-pedido', testInfo);

  // Pagos parciales a Karen (amortizaciones)
  await page.goto('/dropshipping/pagos?proveedor=Karen');
  for (const [fuente, monto, socio] of [['socio_propio', '3000', 'Angelo'], ['socio_propio', '2000', 'Javier']] as const) {
    await page.getByTestId('ds-nuevo-pago').click();
    await page.getByTestId('ds-pago-fuente').selectOption(fuente);
    await page.getByTestId('ds-pago-socio').selectOption(socio);
    await page.getByTestId('ds-pago-pedido').selectOption({ index: 1 });
    await page.getByTestId('ds-pago-monto').fill(monto);
    await page.getByTestId('confirmar').click();
    await expect(page.getByTestId('ds-pago-monto')).toHaveCount(0);
  }
  const amort = await conDb((c) => c.query('select coalesce(sum(monto_cent),0)::bigint s from operacion.ds_amortizacion where pedido_id = $1', [idPedido]));
  expect(Number(amort.rows[0].s)).toBe(500000);
  await expect(page.getByText('PG', { exact: false }).or(page.getByText('Pago de un socio')).first()).toBeVisible();
  // el cliente paga directo a la cuenta de Karen: el resto del costo y el excedente (utilidad reinvertida)
  await page.getByTestId('ds-nuevo-pago').click();
  await page.getByTestId('ds-pago-fuente').selectOption('cliente_a_proveedor');
  await page.getByTestId('ds-pago-cliente').selectOption({ label: CLIENTE });
  await page.getByTestId('ds-pago-pedido').selectOption({ index: 1 });
  await page.getByTestId('ds-pago-monto').fill('10480');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId('ds-pago-monto')).toHaveCount(0);
  await capturar(page, 'pagos-karen', testInfo);

  // Buscar por folio de Karen
  await page.goto('/dropshipping/pedidos');
  await page.getByTestId('ds-buscar').fill(FOLIO);
  await page.getByTestId('ds-filtrar').click();
  await expect(page.getByTestId(`folio-ext-${idPedido}`)).toHaveText(FOLIO);
  await capturar(page, 'pedidos-ds', testInfo);

  // Utilidad: 1,551.00 en total, 775.50 por socio, todo reinvertido; Explicar este numero cuadra
  await page.goto('/dropshipping/utilidad');
  await expect(page.getByTestId('kpi-utilidad')).toContainText('$1,551.00');
  await expect(page.getByText('$775.50').first()).toBeVisible();
  await page.getByTestId('kpi-utilidad').getByRole('button').first().click();
  await expect(page.getByText('Utilidad de dropshipping').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await capturar(page, 'utilidad', testInfo);

  // Resumen: desglose por origen y piezas movidas
  await page.goto('/dropshipping');
  await expect(page.getByTestId('kpi-piezas-movidas')).toContainText('100');
  await expect(page.getByText('Dropshipping frente a inventario en Mérida')).toBeVisible();
  await page.getByTestId('ds-dim-modelo').click();
  await expect(page.getByText(MODELO).first()).toBeVisible();
  await capturar(page, 'resumen', testInfo);

  // /pedidos: filtro de origen de surtido
  await page.goto('/pedidos');
  await expect(page.getByTestId(`surtido-${idPedido}`)).toHaveText('Dropshipping');
  await page.getByTestId('surtido-dropshipping').click();
  await page.waitForURL(/surtido=dropshipping/);
  await expect(page.getByTestId(`surtido-${idPedido}`)).toBeVisible();
  const filasDs = await celdasSurtido(page);
  expect(filasDs.every((t) => t === 'Dropshipping')).toBe(true);
  await page.getByTestId('surtido-inventario').click();
  await page.waitForURL(/surtido=inventario_merida/);
  const filasInv = await celdasSurtido(page);
  expect(filasInv.length).toBeGreaterThanOrEqual(1);
  expect(filasInv.every((t) => t === 'Inventario en Mérida')).toBe(true);
  await expect(page.getByTestId(`surtido-${idPedido}`)).toHaveCount(0);
  await capturar(page, 'pedidos-filtro-inventario', testInfo);
  await page.getByTestId('surtido-todos').click();
  await page.waitForURL((u) => !u.searchParams.has('surtido'));
  await capturar(page, 'pedidos-todos', testInfo);
  expect(num('0')).toBe(0);
});

test('Pedidos menudeo Angelo: solo Angelo los mete y los paga, Javier los supervisa; compromiso, vencido y recordatorios; credito, costo distinto y Cuenta de socios', async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  const mas3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  // Angelo (socio de menudeo) mete el pedido a costo con fecha comprometida
  await sesion(page, '/dropshipping/nuevo', 'Angelo');
  await page.getByTestId('ds-elegir-cliente').selectOption({ label: CLIENTE_B });
  await page.getByTestId('ds-elegir').click();
  await page.waitForURL(/cliente=\d+/);
  await page.getByTestId('ds-tipo').selectOption('socio_a_costo');
  await expect(page.getByTestId('ds-socio')).toHaveText('Angelo');
  await page.getByTestId('ds-fecha-compromiso').fill(mas3);
  await page.getByTestId('ds-modelo').selectOption({ label: `${MARCA} · ${MODELO}` });
  await page.getByTestId('ds-pegado').fill('Fresa 30');
  await page.getByTestId('ds-agregar-pegado').click();
  await expect(page.getByTestId('prev-margen')).toContainText('$0.00');
  await expect(page.getByTestId('prev-utilidad')).toHaveText('$0.00');
  await page.getByTestId('ds-crear').click();
  await expect(page.getByTestId('ds-creado')).toBeVisible();
  await page.getByTestId('ir-ficha').click();
  await page.waitForURL(/\/dropshipping\/pedidos\/\d+$/);
  await page.getByTestId('ds-confirmar').click();
  await expect(page.getByTestId('ds-estado')).toContainText('Confirmado');
  await page.getByTestId('ds-acepto-avisos').check();
  await page.getByTestId('ds-enviado').click();
  await expect(page.getByTestId('ds-estado')).toContainText('Enviado');
  await page.goto('/dropshipping');
  await expect(page.getByTestId('kpi-piezas-movidas')).toContainText('130');

  // Credito (10 % de una semana) y costo distinto del catalogo (95.00 por pieza) antes de enviar
  await page.goto('/dropshipping/nuevo');
  await page.getByTestId('ds-elegir-cliente').selectOption({ label: CLIENTE });
  await page.getByTestId('ds-elegir').click();
  await page.waitForURL(/cliente=\d+/);
  await page.getByTestId('ds-modelo').selectOption({ label: `${MARCA} · ${MODELO}` });
  await page.getByTestId('ds-pegado').fill('Mango 10');
  await page.getByTestId('ds-agregar-pegado').click();
  await page.getByTestId('ds-credito').check();
  await page.getByTestId('ds-crear').click();
  await expect(page.getByTestId('ds-creado')).toBeVisible();
  await page.getByTestId('ir-ficha').click();
  await page.waitForURL(/\/dropshipping\/pedidos\/\d+$/);
  await page.getByTestId('ds-confirmar').click();
  await expect(page.getByTestId('ds-estado')).toContainText('Confirmado');
  const idCred = Number(page.url().split('/').pop());
  await page.getByTestId('capturar-costo').click();
  await page.getByTestId('costo-unico').fill('95');
  await page.getByTestId('costo-motivo').fill('sobrecobro en disputa con el proveedor (sintetico)');
  await page.getByTestId('costo-evidencia').setInputFiles({ name: 'factura-sintetica.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('costo-guardar').click();
  await expect(page.getByTestId('costo-diferencia')).toContainText('$57.10');
  await expect(page.getByTestId('costos-pedido')).toContainText('Costo distinto del catálogo');
  await expect(page.getByTestId('costos-pedido')).toContainText('factura-sintetica.png');
  await capturar(page, 'ficha-costo-distinto', testInfo);
  await page.goto('/dropshipping/pedidos');
  await expect(page.getByTestId(`costo-${idCred}`)).toContainText('distinto del catálogo');
  await page.goto('/dropshipping/pagos?proveedor=Karen');
  const botonResolver = page.locator('[data-testid^="dif-resolver-"]').first();
  await expect(botonResolver).toBeVisible();
  await capturar(page, 'diferencias-disputa', testInfo);
  await page.locator('[data-testid^="dif-nota-"]').first().fill('el proveedor ajusto la factura (sintetico)');
  await botonResolver.click();
  await expect(page.locator('[data-testid^="dif-estado-"]').first()).toHaveText('Resuelta');
  await page.goto('/dropshipping/por-cobrar');
  await expect(page.getByText('Por enviar').first()).toBeVisible();
  await expect(page.getByText('10.00 % x 1 sem. (simple)').first()).toBeVisible();
  await capturar(page, 'por-cobrar', testInfo);

  // Pedidos menudeo Angelo: pendiente de pago con su fecha comprometida
  await page.goto('/menudeo');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pedidos menudeo de Angelo');
  await expect(page.getByTestId('menudeo-pendiente')).toContainText('$2,678.70');
  const idCosto = Number((await conDb((c) => c.query("select p.id from operacion.pedido p join operacion.pedido_ds d on d.pedido_id = p.id where d.tipo_venta = 'socio_a_costo' order by p.id desc limit 1"))).rows[0].id);
  await expect(page.getByTestId(`estado-pago-${idCosto}`)).toContainText('Pendiente de pago');
  await expect(page.getByTestId(`compromiso-${idCosto}`)).toContainText('Angelo');
  await page.getByTestId(`renglones-${idCosto}`).locator('summary').click();
  await expect(page.getByTestId(`renglones-${idCosto}`)).toContainText('$89.29');
  await capturar(page, 'menudeo-pendiente', testInfo);
  await page.goto('/');
  await expect(page.getByTestId('inicio-menudeo-propio')).toBeVisible();
  await expect(page.getByTestId('inicio-pedidos-Angelo')).toContainText('$2,678.70');
  await expect(page.getByTestId('inicio-vencidos-Angelo')).toContainText('Ninguno vencido');

  // Javier solo supervisa: ve todo, no registra pagos, no mete pedidos a costo
  const ctxJ = await browser.newContext({ viewport: page.viewportSize() ?? undefined, baseURL: testInfo.project.use.baseURL, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pj = await ctxJ.newPage();
  await sesion(pj, '/menudeo', 'Javier');
  await expect(pj.getByRole('heading', { level: 1 })).toContainText('Pedidos menudeo de Angelo');
  await expect(pj.getByText('Solo lectura').first()).toBeVisible();
  await expect(pj.getByTestId(`estado-pago-${idCosto}`)).toContainText('Pendiente de pago');
  await expect(pj.getByTestId(`marcar-pagado-${idCosto}`)).toHaveCount(0);
  await expect(pj.getByTestId(`reprogramar-${idCosto}`)).toHaveCount(0);
  await pj.goto('/');
  await expect(pj.getByText('Pedidos menudeo de Angelo pendientes')).toBeVisible();
  await expect(pj.getByTestId('inicio-menudeo-otro')).toBeVisible();
  await expect(pj.getByTestId('inicio-pedidos-Angelo')).toContainText('$2,678.70');
  await pj.goto('/dropshipping/nuevo');
  await pj.getByTestId('ds-elegir-cliente').selectOption({ label: CLIENTE_B });
  await pj.getByTestId('ds-elegir').click();
  await pj.waitForURL(/cliente=\d+/);
  await expect(pj.getByTestId('ds-tipo').locator('option[value="socio_a_costo"]')).toHaveCount(0);

  // Compromiso vencido (3 dias) -> VENCIDO con dias de atraso; Angelo lo reprograma con motivo y queda en el historial
  await conDb((c) => c.query("insert into operacion.ds_pedido_compromiso (pedido_id, fecha_compromiso, comprometido_por, tipo, motivo, evento_id) select $1, negocio.hoy() - 3, (select id from catalogo.socio where nombre = 'Angelo'), 'reprogramacion', 'compromiso historico sintetico', evento_id from operacion.pedido where id = $1", [idCosto]));
  await pj.goto('/menudeo');
  await expect(pj.getByTestId(`estado-pago-${idCosto}`)).toContainText('Vencido');
  await expect(pj.getByTestId(`atraso-${idCosto}`)).toContainText('3 días de atraso');
  await expect(pj.getByTestId('alerta-vencidos')).toBeVisible();
  await pj.goto('/');
  await expect(pj.getByTestId('inicio-vencidos-Angelo')).toContainText('1 vencido');
  await capturar(pj, 'menudeo-vencido-otro-socio', testInfo);
  await page.goto('/menudeo');
  await page.getByTestId(`reprogramar-${idCosto}`).click();
  await page.getByTestId('compromiso-fecha').fill(mas3);
  await page.getByTestId('compromiso-motivo').fill('el proveedor tardo en entregar (sintetico)');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId(`estado-pago-${idCosto}`)).toContainText('Pendiente de pago');
  await expect(page.getByTestId(`atraso-${idCosto}`)).toHaveCount(0);
  await page.getByTestId(`compromiso-${idCosto}`).locator('summary').click();
  await expect(page.getByTestId(`compromiso-${idCosto}`)).toContainText('el proveedor tardo en entregar (sintetico)');
  // El canal del agente (sistema) lee los recordatorios: a 10 h de vencer el compromiso reprogramado esta por vencer
  const recs = await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const r = await c.query("select jsonb_array_length(x->'recordatorios') as n from (select operacion.ds_recordatorios_pago_menudeo(operacion.ds_vence_en($1::date, null) - interval '10 hours') as x) q", [mas3]);
    await c.query('rollback');
    return r;
  });
  expect(Number(recs.rows[0].n)).toBeGreaterThanOrEqual(1);

  // Pago: Angelo avisa un pago parcial SIN evidencia -> Pago reportado; sigue pendiente hasta que Javier confirme
  await page.getByTestId(`marcar-pagado-${idCosto}`).click();
  await page.getByTestId('menudeo-monto').fill('1000');
  await page.getByTestId('menudeo-referencia').fill('CLAVE-SINTETICA-001');
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId(`estado-pago-${idCosto}`)).toContainText('Pago reportado');
  await expect(page.getByTestId('menudeo-pendiente')).toContainText('$2,678.70');
  await expect(page.getByTestId('menudeo-reportado')).toContainText('$1,000.00');
  await expect(page.getByTestId(`confirmar-recibido-${idCosto}`)).toHaveCount(0);
  await pj.goto('/menudeo');
  await pj.getByTestId(`reportes-${idCosto}`).locator('summary').click();
  await expect(pj.getByText('CLAVE-SINTETICA-001')).toBeVisible();
  await capturar(pj, 'menudeo-pago-reportado', testInfo);
  await pj.locator('[data-testid^="confirmar-recibido-"]').first().click();
  await expect(pj.getByTestId(`estado-pago-${idCosto}`)).toContainText('Pendiente de pago');
  await expect(pj.getByTestId('menudeo-pendiente')).toContainText('$1,678.70');
  // Angelo paga el resto CON evidencia (PNG): basta registrar; queda Pagado y la evidencia lleva huella
  await page.goto('/menudeo');
  await page.getByTestId(`marcar-pagado-${idCosto}`).click();
  await page.getByTestId('menudeo-metodo').selectOption('deposito');
  await page.getByTestId('menudeo-referencia').fill('FOLIO-DEP-002');
  await page.getByTestId('menudeo-evidencia').setInputFiles({ name: 'ticket-sintetico.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('confirmar').click();
  await expect(page.getByTestId(`estado-pago-${idCosto}`)).toContainText('Pagado');
  await expect(page.getByTestId('menudeo-pendiente')).toContainText('$0.00');
  await page.getByTestId(`reportes-${idCosto}`).locator('summary').click();
  const evid = await conDb((c) => c.query("select sha256 from entrega.evidencia_pago order by id desc limit 1"));
  expect(String(evid.rows[0].sha256)).toMatch(/^[0-9a-f]{64}$/);
  await expect(page.getByText(`huella ${String(evid.rows[0].sha256).slice(0, 10)}`)).toBeVisible();
  await capturar(page, 'menudeo-pagado-con-evidencia', testInfo);
  await page.goto('/');
  await expect(page.getByTestId('inicio-pedidos-Angelo')).toContainText('Sin pedidos pendientes');

  // Fondos de la sociedad cobrados en la cuenta de Angelo (renglon aparte; si restan de su aportacion neta)
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select operacion.registrar_pago($1,'Angelo',3547500,(select id from catalogo.cliente where nombre_canonico = $2),null,false,'anticipo')", [`e2eds:fondos:${SUFIJO}`, CLIENTE]);
    await c.query('commit');
  });
  await page.goto('/');
  await expect(page.getByTestId('inicio-fondos-Angelo')).toContainText('$35,475.00');
  await page.goto('/menudeo');
  await expect(page.getByTestId('fondos-pendiente')).toContainText('$35,475.00');
  await expect(page.getByText(CLIENTE).first()).toBeVisible();
  await capturar(page, 'menudeo-fondos', testInfo);
  await page.goto('/');
  await capturar(page, 'inicio-pendientes', testInfo);
  await pj.goto('/');
  await capturar(pj, 'inicio-otro-socio', testInfo);
  await ctxJ.close();

  // Cuenta de socios: aportacion neta, turno y sin lenguaje de deuda
  await page.goto('/socios');
  await expect(page.getByText('Aportación neta y diferencia a igualar')).toBeVisible();
  await expect(page.getByTestId('aportacion-neta-Javier')).toBeVisible();
  await expect(page.getByTestId('turno-aportar')).toContainText('Le toca aportar el siguiente pago: Angelo');
  await expect(page.getByTestId('aportacion-neta-Angelo')).toContainText('32,475.00');
  await capturar(page, 'socios-aportacion-neta', testInfo);
  // el menu lleva el nombre del socio de menudeo
  await expect(page.getByRole('link', { name: 'Pedidos menudeo Angelo' })).toBeVisible();
});

test('Omar no entra a las paginas de dropshipping (solo socios)', async ({ page }) => {
  const correo = correoUnico('dsomar');
  await altaUsuario({ correo, rol: 'omar' });
  await page.goto('/login');
  const r = await page.request.get('/dropshipping', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(r.status());
});
