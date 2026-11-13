// E2E y capturas del Pago de renta (claro y oscuro, 1440 y 390). Datos ILUSTRATIVOS que la propia prueba siembra en la base local; ningun dato real.
// Recorrido: estado vacio, muestra chica (3 dias), historia completa (octubre y noviembre), registrar un pago (parcial, exceso rechazado, anticipo confirmado),
// vista de Omar (solo lo suyo) y cerrojos por rol.
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/pago-renta');
const BASE = `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3190'}`;
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 1900, movil: false }, { nombre: '390', ancho: 390, alto: 3600, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;
const dia = (hoy: string, n: number): string => new Date(Date.parse(`${hoy}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function sesion(browser: Browser, correo: string, destino: string): Promise<Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const p = await ctx.newPage();
  await p.goto(BASE + (await enlaceConfirmacion(correo, destino)));
  await p.getByTestId('confirmar-acceso').click();
  await p.waitForURL((u) => !u.pathname.startsWith("/auth/confirm"));
  const estado = await ctx.storageState();
  await ctx.close();
  return estado;
}

async function ejecutarComo<T>(uid: string, fn: (q: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
  return conDb(async (c) => {
    await c.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
    return fn((sql, args) => c.query(sql, args));
  });
}

let n = 0;
async function enviarDia(q: Parameters<Parameters<typeof ejecutarComo>[1]>[0], fecha: string, piezas: number, modelo = 'Demo Nube 25K', sabor = 'Mango'): Promise<void> {
  n += 1;
  const k = `rcap${n}`;
  const cli = (await q("select id from catalogo.cliente where nombre_canonico = 'Demo Cliente Alfa'")).rows[0]!['id'];
  await q("select operacion.crear_pedido($1, $2, $3::jsonb, 'bodega_omar', null, 0, 0, 0, $4::date)", [`${k}p`, cli, JSON.stringify([{ modelo, sabor, piezas }]), fecha]);
  const id = (await q("select (resultado->>'pedido_id')::bigint as id from seguridad.operacion where clave = $1", [`${k}p`])).rows[0]!['id'];
  await q('select operacion.confirmar_pedido($1, $2)', [`${k}c`, id]);
  await q('select operacion.enviar_pedido($1, $2, null, null, $3::date, true)', [`${k}s`, id, fecha]);
}

async function prepararCatalogo(uid: string): Promise<void> {
  await ejecutarComo(uid, async (q) => {
    await q("select catalogo.asegurar_cliente('Demo Cliente Bodega', 'Javier')");
    await q("select catalogo.asegurar_persona_bodega('Demo Cliente Bodega', 'Demo Omar')");
    await q("select catalogo.asegurar_cliente('Demo Cliente Alfa', 'Angelo')");
    await q("select catalogo.asegurar_modelo('Demo Marca Uno', 'Demo Nube 25K', 25000, 'ambas')");
    await q("select catalogo.asegurar_sku('Demo Nube 25K', 'Mango')");
    await q("select catalogo.fijar_costo('rcap-c', 'Isaac', 'Demo Nube 25K', 9000, '2026-09-01', 'demo')");
    await q("select catalogo.fijar_precio('rcap-p', 'Demo Cliente Alfa', 'Demo Nube 25K', 17000, '2026-09-01', 'chat')");
    await q("select operacion.registrar_movimiento('rcap-m', 'Demo Nube 25K', 'Mango', 'bodega_omar', 'entrada_compra', 6000, 54000000, '2026-09-28')");
    // Segundo modelo para la historia: el kardex no admite movimientos retroactivos de un modelo que ya salio despues.
    await q("select catalogo.asegurar_modelo('Demo Marca Uno', 'Demo Brisa 15K', 15000, 'ambas')");
    await q("select catalogo.asegurar_sku('Demo Brisa 15K', 'Fresa')");
    await q("select catalogo.fijar_costo('rcap-c2', 'Isaac', 'Demo Brisa 15K', 6500, '2026-09-01', 'demo')");
    await q("select catalogo.fijar_precio('rcap-p2', 'Demo Cliente Alfa', 'Demo Brisa 15K', 12500, '2026-09-01', 'chat')");
    await q("select operacion.registrar_movimiento('rcap-m2', 'Demo Brisa 15K', 'Fresa', 'bodega_omar', 'entrada_compra', 6000, 39000000, '2026-09-28')");
  });
}

test('pago de renta: estados, registro de pagos, vista de Omar y capturas', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const correoSocio = correoUnico('rentasoc');
  const correoOmar = correoUnico('rentaomar');
  const uidSocio = await altaUsuario({ correo: correoSocio, socio: 'Angelo' });
  await altaUsuario({ correo: correoOmar, rol: 'omar' });
  const hoy = (await conDb((c) => c.query('select negocio.hoy()::text as h'))).rows[0]!.h as string;
  const sSocio = await sesion(browser, correoSocio, '/pago-renta');
  const sOmar = await sesion(browser, correoOmar, '/mi-bodega/pago-renta');

  const capturar = async (etapa: string, rutas: [string, string, 'socio' | 'omar'][]) => {
    for (const p of PERFILES) {
      for (const tema of TEMAS) {
        for (const [nombre, ruta, quien] of rutas) {
          const op: BrowserContextOptions = { viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: 1, isMobile: p.movil, hasTouch: p.movil, colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: quien === 'socio' ? sSocio : sOmar };
          const ctx = await browser.newContext(op);
          await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
          const page = await ctx.newPage();
          await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 180_000 });
          await page.evaluate(() => document.fonts.ready);
          await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
          await page.waitForTimeout(500);
          const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(desborde, `${etapa} ${nombre} ${p.nombre} ${tema}: sin scroll horizontal`).toBeLessThanOrEqual(1);
          await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${etapa}-${nombre}.png`), fullPage: true });
          await ctx.close();
        }
      }
    }
  };

  // 1. Estado vacio: sin envios.
  await capturar('1-vacio', [['socio', '/pago-renta', 'socio'], ['omar', '/mi-bodega/pago-renta', 'omar']]);
  const ctxV = await browser.newContext({ storageState: sSocio, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pv = await ctxV.newPage();
  await pv.goto(`${BASE}/pago-renta`);
  await expect(pv.getByTestId('renta-vacio')).toBeVisible();
  await ctxV.close();

  // 2. Muestra chica: tres dias con envio (las tarifas valen desde el 10-nov, asi que solo esos tres dias existen antes de hoy).
  await prepararCatalogo(uidSocio);
  await ejecutarComo(uidSocio, async (q) => { for (const [i, pz] of [40, 56, 40].entries()) await enviarDia(q, dia(hoy, -3 + i), pz); });
  await capturar('2-muestra-chica', [['socio', '/pago-renta', 'socio']]);
  const ctxC = await browser.newContext({ storageState: sSocio, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pc = await ctxC.newPage();
  await pc.goto(`${BASE}/pago-renta`);
  await expect(pc.getByTestId('renta-sin-proyeccion')).toContainText('Muestra chica');
  await expect(pc.getByTestId('renta-proyeccion')).toHaveCount(0);
  await expect(pc.getByTestId('renta-por-pagar')).toContainText('$272.00'); // (40+56+40) x 2.00
  await ctxC.close();

  // 3. Historia completa: la tarifa se retrocede en la base LOCAL de prueba para sembrar octubre y noviembre.
  await conDb(async (c) => {
    await c.query("set session_replication_role = replica");
    await c.query("update catalogo.config set vigente_desde = '2026-09-01' where clave = 'renta_por_pieza_cent'");
  });
  await ejecutarComo(uidSocio, async (q) => {
    for (let i = -43; i <= -4; i++) {
      const f = dia(hoy, i);
      if (new Date(`${f}T00:00:00Z`).getUTCDay() === 0) continue;
      const piezas = 38 + ((i * i * 7 + 13) % 29) + (i > -20 ? 6 : 0);
      await enviarDia(q, f, piezas, 'Demo Brisa 15K', 'Fresa');
    }
    await enviarDia(q, hoy, 31, 'Demo Brisa 15K', 'Fresa');
  });
  const total = (await conDb((c) => c.query("select sum(piezas)::int as p, sum(monto_cent)::bigint as m from operacion.renta_devengo"))).rows[0]!;
  expect(Number(total.m)).toBe(Number(total.p) * 200);
  await ejecutarComo(uidSocio, async (q) => {
    await q("select api.registrar_pago_renta('rcap-pago1', 150000, 'Angelo', 'transferencia', $1::date, 'Abono de octubre', 'SPEI demo 001', false)", [dia(hoy, -30)]);
    await q("select api.registrar_pago_renta('rcap-pago2', 90000, 'Javier', 'efectivo', $1::date, 'Abono parcial de noviembre', null, false)", [dia(hoy, -9)]);
  });
  await capturar('3-completo', [['socio', '/pago-renta', 'socio'], ['socio-dias', '/pago-renta?paso=dia', 'socio'], ['socio-meses', '/pago-renta?paso=mes', 'socio'], ['omar', '/mi-bodega/pago-renta', 'omar']]);

  // 4. Registrar pagos desde la interfaz.
  const ctx = await browser.newContext({ storageState: sSocio, viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/pago-renta`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('renta-proyeccion')).toContainText('Estimado');
  await expect(page.getByTestId('renta-regla')).toContainText('piezas × $2.00');
  const antes = await conDb((c) => c.query("select (operacion.renta_estado(negocio.hoy())->>'por_pagar_cent')::bigint as x"));
  const debe = Number(antes.rows[0]!.x);
  expect(debe).toBeGreaterThan(0);
  // Parcial de 400.00.
  await page.getByTestId('pago-renta').click();
  await page.getByLabel('Monto').fill('400');
  await page.getByLabel('Referencia del comprobante (opcional)').fill('SPEI demo 002');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SALIDA, '1440-claro-4-formulario-pago.png') });
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => Number((await conDb((c) => c.query("select (operacion.renta_estado(negocio.hoy())->>'por_pagar_cent')::bigint as x"))).rows[0]!.x), { timeout: 20_000 }).toBe(debe - 40000);
  // Exceso sin confirmar: se rechaza con aviso y no deja nada.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('pago-renta').click();
  await page.getByLabel('Monto').fill('900000');
  await expect(page.getByText('Es más de lo que se debe.')).toBeVisible();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SALIDA, '1440-claro-4-formulario-exceso.png') });
  await page.getByTestId('confirmar').click();
  await expect(page.getByText(/mayor que lo que se debe a Omar/)).toBeVisible({ timeout: 20_000 });
  const tras = Number((await conDb((c) => c.query("select count(*)::int as n from operacion.pago_omar where sentido = 'a_omar'"))).rows[0]!.n);
  expect(tras).toBe(3);
  // Confirmado como anticipo: queda a favor de Omar.
  await page.getByLabel('¿Es un anticipo mayor que lo que se debe?').selectOption('si');
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => Number((await conDb((c) => c.query("select (operacion.renta_estado(negocio.hoy())->>'a_favor_cent')::bigint as x"))).rows[0]!.x), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('Anticipo.')).toBeVisible();
  await page.screenshot({ path: join(SALIDA, '1440-claro-4-anticipo-completa.png'), fullPage: true });
  await capturar('4-anticipo', [['socio', '/pago-renta', 'socio']]);
  // Reversa: el anticipo se registro por error. Motivo obligatorio, confirmacion en dialogo y el por pagar vuelve exacto.
  const folioAnticipo = String((await conDb((c) => c.query("select folio from operacion.pago_omar where reversa_de is null and sentido = 'a_omar' order by id desc limit 1"))).rows[0]!['folio']);
  await page.getByTestId(`anular-${folioAnticipo}`).click();
  await page.getByTestId('confirmar').click();
  await expect(page.getByText('Falta: motivo (obligatorio).')).toBeVisible();
  await page.getByLabel('Motivo (obligatorio)').fill('Captura duplicada por error');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(SALIDA, '1440-claro-5-formulario-anular.png') });
  await page.getByTestId('confirmar').click();
  await expect.poll(async () => Number((await conDb((c) => c.query("select (operacion.renta_estado(negocio.hoy())->>'saldo_cent')::bigint as x"))).rows[0]!.x), { timeout: 20_000 }).toBe(debe - 40000);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText(/reversa de/).first()).toBeVisible();
  await expect(page.getByText(/pz piezas/)).toHaveCount(0);
  await expect(page.getByText('Ritmo diario · 7 días')).toBeVisible();
  await page.screenshot({ path: join(SALIDA, '1440-claro-5-reversa-completa.png'), fullPage: true });
  await capturar('5-reversa', [['socio', '/pago-renta', 'socio'], ['omar', '/mi-bodega/pago-renta', 'omar']]);
  // Formulario de pago a 390 px.
  const movil = await browser.newContext({ storageState: sSocio, viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pm = await movil.newPage();
  await pm.goto(`${BASE}/pago-renta`, { waitUntil: 'networkidle' });
  await pm.getByTestId('pago-renta').click();
  await pm.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await pm.waitForTimeout(900);
  await pm.screenshot({ path: join(SALIDA, '390-claro-4-formulario-pago.png') });
  await movil.close();
  await ctx.close();

  // 5. Vista de Omar: solo lo suyo, solo lectura.
  const ctxO = await browser.newContext({ storageState: sOmar, viewport: { width: 1440, height: 1200 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const po = await ctxO.newPage();
  await po.goto(`${BASE}/mi-bodega/pago-renta`, { waitUntil: 'networkidle' });
  await expect(po.getByTestId('renta-heroe')).toBeVisible();
  const texto = await po.locator('main').innerText();
  for (const prohibido of ['Angelo', 'Javier', 'Abono', 'SPEI', 'Registrar pago', 'Captura duplicada', 'Anular', 'Contabilidad', 'margen', 'costo']) expect(texto, `Omar no debe ver "${prohibido}"`).not.toContain(prohibido);
  await expect(po.getByTestId('pago-renta')).toHaveCount(0);
  const r = await po.goto(`${BASE}/pago-renta`);
  await po.waitForURL((u) => !u.pathname.startsWith('/pago-renta'), { timeout: 20_000 });
  expect(po.url(), 'Omar vuelve a su zona').toContain('/mi-bodega');
  await expect(po.getByTestId('renta-heroe')).toHaveCount(0);
  expect(r?.status() ?? 200).toBeLessThan(500);
  await ctxO.close();
  // El socio no entra a la zona de Omar.
  const ctxS = await browser.newContext({ storageState: sSocio, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const ps = await ctxS.newPage();
  await ps.goto(`${BASE}/mi-bodega/pago-renta`);
  await ps.waitForURL((u) => !u.pathname.startsWith('/mi-bodega'), { timeout: 20_000 });
  await expect(ps.getByTestId('renta-heroe')).toHaveCount(0);
  await ctxS.close();

  // 6. Estado de resultados: la renta sale como renglon propio.
  const ctxE = await browser.newContext({ storageState: sSocio, viewport: { width: 1440, height: 1500 }, extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pe = await ctxE.newPage();
  await conDb((c) => c.query('select contabilidad.asentar_pendientes()'));
  await pe.goto(`${BASE}/contabilidad/estado-de-resultados?ini=${dia(hoy, -60)}&fin=${hoy}`, { waitUntil: 'networkidle' });
  await expect(pe.getByText('6110 Renta de bodega').first()).toBeVisible();
  await pe.screenshot({ path: join(SALIDA, '1440-claro-5-estado-de-resultados.png'), fullPage: true });
  await ctxE.close();
});
