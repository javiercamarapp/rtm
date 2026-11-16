// Rol bodega y pantalla Cuentas de punta a punta. Flujo: un socio da de alta un correo de bodega desde Cuentas (sin correos reales: el acceso se crea con
// `acceso:cuentas` y el enlace se genera con la API de administracion local), bodega entra a SU vista (hoy a preparar y llegadas) sin ver dinero ni otras pantallas,
// y el socio lo desactiva y bloquea el acceso. Capturas claro y oscuro en docs/capturas/bodega/. Datos sinteticos con sufijo propio (los hechos de negocio no se borran).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, entrarComo, estado, ipFalsa } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

const SUF = Date.now().toString(36).slice(-5).toUpperCase();
const CLIENTE_A = `Tienda Norte ${SUF}`;
const CLIENTE_B = `Vapes Centro ${SUF}`;
const MODELO = `Modelo Bodega ${SUF} 50K`;
const correoBodega = correoUnico('bodega');
const DIR = 'docs/capturas/bodega';
const MAILPIT = process.env.MAILPIT ?? estado().MAILPIT_URL;

async function sembrar() {
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("update catalogo.config set vigente_desde = '2026-10-01' where vigente_desde > '2026-10-01'");
    const hay = (await c.query('select count(*)::int n from catalogo.persona_bodega')).rows[0].n;
    if (!hay) {
      await c.query("select catalogo.asegurar_cliente('Bodega Merida (socios)', 'Javier', 'credito_interno')");
      await c.query("select catalogo.asegurar_persona_bodega('Bodega Merida (socios)', 'Bodega Merida (socios)')");
    }
    await c.query("select catalogo.asegurar_modelo($1,$2,50000,'ambas')", [`Marca ${SUF}`, MODELO]);
    for (const s of ['Mango', 'Uva', 'Sandía']) await c.query('select catalogo.asegurar_sku($1,$2)', [MODELO, s]);
    await c.query("select catalogo.fijar_costo($1,'Isaac',$2,10000,'2026-11-01','e2e')", [`bd:c:${SUF}`, MODELO]);
    for (const [cl, d] of [[CLIENTE_A, 'Angelo'], [CLIENTE_B, 'Javier']] as const) {
      await c.query('select catalogo.asegurar_cliente($1,$2)', [cl, d]);
      await c.query("select catalogo.fijar_precio($1,$2,$3,15000,'2026-11-01','chat')", [`bd:p:${cl}`, cl, MODELO]);
    }
    await c.query("select operacion.registrar_movimiento($1,$2,'Mango','bodega_omar','entrada_compra',40,400000,'2026-11-01')", [`bd:m1:${SUF}`, MODELO]);
    await c.query("select operacion.registrar_movimiento($1,$2,'Uva','bodega_omar','entrada_compra',20,200000,'2026-11-01')", [`bd:m2:${SUF}`, MODELO]);
    const ped = async (clave: string, cliente: string, lineas: unknown[], fecha: string) => {
      const id = (await c.query("select (operacion.crear_pedido($1,(select id from catalogo.cliente where nombre_canonico = $2),$3::jsonb,'bodega_omar',null,12000,0,0,$4::date)->>'pedido_id')::bigint as id", [`bd:${clave}:${SUF}`, cliente, JSON.stringify(lineas), fecha])).rows[0].id;
      await c.query('select operacion.confirmar_pedido($1,$2)', [`bd:${clave}c:${SUF}`, id]);
      return id;
    };
    await ped('a', CLIENTE_A, [{ modelo: MODELO, sabor: 'Mango', piezas: 25 }, { modelo: MODELO, sabor: 'Uva', piezas: 10 }], '2026-11-12');
    await ped('b', CLIENTE_B, [{ modelo: MODELO, sabor: 'Mango', piezas: 20 }, { modelo: MODELO, sabor: 'Sandía', piezas: 6 }], '2026-11-13');
    const compra = (await c.query("select (operacion.crear_compra($1,'Isaac',$2::jsonb,5000,0,'2026-11-22','bodega','sociedad','Angelo')->>'compra_id')::bigint as id", [`bd:oc:${SUF}`, JSON.stringify([{ modelo: MODELO, sabor: 'Mango', pagadas: 60 }, { modelo: MODELO, sabor: 'Uva', pagadas: 30 }])])).rows[0].id;
    await c.query('select operacion.confirmar_compra($1,$2)', [`bd:occ:${SUF}`, compra]);
    await c.query("select operacion.marcar_compra_enviada($1,$2,$3::jsonb,'2026-11-22','2026-11-13')", [`bd:oce:${SUF}`, compra, JSON.stringify([{ paqueteria: 'Estafeta', numero: `E2E-${SUF}` }])]);
    await c.query('commit');
  });
}

async function modo(page: Page, tema: 'claro' | 'oscuro') {
  await page.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); } catch { /* sin almacenamiento */ } }, tema);
}
async function captura(page: Page, proyecto: string, tema: string, nombre: string) {
  mkdirSync(DIR, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/${proyecto}-${tema}-${nombre}.png`, fullPage: true });
}
const SIN_DINERO = /\$\s?\d|precio|costo|margen|saldo|tel[eé]fono|direcci[oó]n/i;

test('sin sesion no hay vista de bodega ni cuentas', async ({ page }) => {
  for (const ruta of ['/bodega', '/bodega/llegadas', '/cuentas']) {
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/login/);
  }
});

test('el socio da de alta un correo de bodega desde Cuentas y el acceso se crea sin correos', async ({ page }, info) => {
  await sembrar();
  const correoSocio = correoUnico('socio-bd');
  await altaUsuario({ correo: correoSocio, socio: 'Javier' });
  await entrarComo(page, correoSocio, '/cuentas');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('cuenta');
  // Solo se ofrecen tipos de bajo privilegio (bodega y Omar): nunca socio.
  const opciones = await page.getByTestId('campo-tipo-cuenta').locator('option').allTextContents();
  expect(opciones).toEqual(['Bodega', 'Omar']);
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByText('Escribe el correo.')).toBeVisible();
  await page.getByTestId('campo-correo').fill(correoBodega);
  await page.getByTestId('campo-nombre-cuenta').fill('Turno matutino');
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByTestId('eco-cuenta')).toContainText('Falta crear su acceso');
  await expect(page.getByRole('row').filter({ hasText: correoBodega })).toContainText('Activa');
  await expect(page.getByTestId('aviso-sin-acceso')).toBeVisible();
  await captura(page, info.project.name, 'claro', 'cuentas');
  await page.evaluate(() => { document.documentElement.dataset.tema = 'oscuro'; });
  await captura(page, info.project.name, 'oscuro', 'cuentas');
  await page.evaluate(() => { document.documentElement.dataset.tema = 'claro'; });
  // Repetir el mismo alta no duplica.
  await page.getByTestId('campo-correo').fill(correoBodega);
  await page.getByTestId('crear-cuenta').click();
  await expect(page.getByTestId('eco-cuenta')).toContainText('no se duplicó');
  expect((await conDb((c) => c.query('select count(*)::int n from seguridad.correo_permitido where correo = $1', [correoBodega]))).rows[0].n).toBe(1);
  // El script crea el acceso (sin mandar correos).
  const antes = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json()).then((j: { total?: number }) => j.total ?? 0);
  const salida = execFileSync('node', ['scripts/acceso/sincronizar-cuentas.mjs'], { encoding: 'utf8' });
  expect(salida).toMatch(/acceso\(s\) creado\(s\)/);
  expect(salida).not.toContain('@');
  const despues = await fetch(`${MAILPIT}/api/v1/messages`).then((r) => r.json()).then((j: { total?: number }) => j.total ?? 0);
  expect(despues).toBe(antes);
  await page.reload();
  await expect(page.getByTestId('aviso-sin-acceso')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: correoBodega })).toContainText('Sin ingresos aún');
});

for (const tema of ['claro', 'oscuro'] as const) {
  test(`bodega entra a su vista (${tema}): hoy a preparar y llegadas, sin dinero`, async ({ page }, info) => {
    await modo(page, tema);
    await page.goto(await enlaceConfirmacion(correoBodega, '/pedidos'));
    await page.getByTestId('confirmar-acceso').click();
    // Aunque el enlace pida /pedidos, bodega aterriza en SU vista.
    await expect(page).toHaveURL(/\/bodega$/);
    await expect(page.getByTestId('vista-previa')).toHaveCount(0);
    // La base local conserva corridas anteriores (los hechos no se borran): se verifica lo de ESTA corrida.
    const a = page.getByTestId('bodega-cliente').filter({ hasText: CLIENTE_A });
    const b = page.getByTestId('bodega-cliente').filter({ hasText: CLIENTE_B });
    await expect(a).toHaveCount(1);
    await expect(a.getByTestId('bodega-cliente-piezas')).toContainText('35');
    await expect(a).toContainText('Mango');
    await expect(a).toContainText('De 12 nov');
    await expect(b.getByTestId('bodega-cliente-piezas')).toContainText('26');
    await expect(page.getByTestId('bodega-kpi-piezas')).toBeVisible();
    const texto = await page.locator('main').innerText();
    expect(texto).not.toMatch(SIN_DINERO);
    // Sin desbordes a 390.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await captura(page, info.project.name, tema, 'hoy');
    if (tema === 'claro') {
      // Bodega marca empacado el pedido del cliente A; el estado cambia y el boton desaparece. Repetir el clic no duplica.
      await expect(a.getByTestId('marcar-empacado')).toHaveCount(1);
      await a.getByTestId('marcar-empacado').click();
      await expect(a).toContainText('Empacado');
      await expect(a.getByTestId('marcar-empacado')).toHaveCount(0);
    }
    await page.getByRole('link', { name: 'Llegadas' }).click();
    await expect(page).toHaveURL(/\/bodega\/llegadas$/);
    const compra = page.getByTestId('bodega-compra').filter({ hasText: `E2E-${SUF}` });
    await expect(compra).toHaveCount(1);
    await expect(compra).not.toContainText(/Isaac|Karen/);
    await expect(compra).toContainText('Compra');
    await expect(compra).toContainText('90');
    await expect(compra).toContainText('Mango');
    expect(await page.locator('main').innerText()).not.toMatch(SIN_DINERO);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await captura(page, info.project.name, tema, 'llegadas');
  });
}

test('el script de acceso continua con la siguiente cuenta ante un 400 y reporta solo conteos', async () => {
  const bueno = correoUnico('sync-ok');
  const malo = `\u00f1and\u00fa.${SUF.toLowerCase()}@example.test`; // pasa el CHECK de la tabla, pero GoTrue lo rechaza
  await conDb(async (c) => {
    await c.query("insert into seguridad.correo_permitido (correo, rol, activo) values ($1,'bodega',true), ($2,'bodega',true) on conflict do nothing", [malo, bueno]);
  });
  const r = spawnSync('node', ['scripts/acceso/sincronizar-cuentas.mjs'], { encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stdout + r.stderr).not.toContain('@');
  expect(r.stderr).toMatch(/1 cuenta\(s\) fallaron/);
  const n = (await conDb((c) => c.query('select count(*)::int n from auth.users where email = $1', [bueno]))).rows[0].n;
  expect(n).toBe(1);
  await conDb((c) => c.query('delete from seguridad.correo_permitido where correo = $1', [malo]));
});

test('bodega no entra a ninguna otra pantalla ni lee otras funciones por la API', async ({ page, request }) => {
  await entrarComo(page, correoBodega, '/bodega');
  for (const ruta of ['/', '/pedidos', '/clientes', '/inventario', '/proveedores', '/socios', '/contabilidad', '/cuentas', '/contactos', '/catalogo', '/reportes', '/mi-bodega']) {
    await page.goto(ruta);
    await expect(page).toHaveURL(/\/bodega$/);
  }
  // La API REST con la sesion de bodega: solo sus dos lecturas; el resto, 42501.
  const e = (await import('./ayudas')).estado();
  const tokenDe = async () => {
    const cookies = await page.context().cookies();
    const c = cookies.find((k) => /auth-token/.test(k.name));
    if (!c) return null;
    const bruto = decodeURIComponent(c.value).replace(/^base64-/, '');
    const json = JSON.parse(Buffer.from(bruto, 'base64').toString('utf8')) as { access_token: string };
    return json.access_token;
  };
  const token = await tokenDe();
  expect(token).toBeTruthy();
  const llamar = (fn: string, cuerpo: unknown = {}) => request.post(`${e.API_URL}/rest/v1/rpc/${fn}`, { headers: { apikey: e.ANON_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-profile': 'api', 'accept-profile': 'api' }, data: cuerpo });
  expect((await llamar('bodega_hoy_a_preparar')).status()).toBe(200);
  expect((await llamar('bodega_llegadas')).status()).toBe(200);
  for (const fn of ['clientes_lista', 'catalogo_modelos', 'cuentas_lista', 'pedidos_lista', 'inventario_existencia']) expect((await llamar(fn)).status(), fn).toBe(403);
  expect((await llamar('cuenta_alta', { p_clave_idem: 'x', p_correo: 'otro@example.test', p_tipo: 'bodega' })).status()).toBe(403);
  const tabla = await request.get(`${e.API_URL}/rest/v1/cliente?select=*`, { headers: { apikey: e.ANON_KEY, authorization: `Bearer ${token}`, 'accept-profile': 'catalogo' } });
  expect([401, 403, 404, 406]).toContain(tabla.status());
});

test('un socio ve la vista tal como la ve bodega (vista previa) y Omar no entra', async ({ page }) => {
  const socio = correoUnico('socio-prev');
  await altaUsuario({ correo: socio, socio: 'Angelo' });
  await entrarComo(page, socio, '/cuentas');
  await page.getByTestId('ver-vista-bodega').click();
  await expect(page).toHaveURL(/\/bodega$/);
  await expect(page.getByTestId('vista-previa')).toBeVisible();
  await page.getByTestId('salir-vista-previa').click();
  await expect(page).toHaveURL(/\/cuentas$/);
  const omar = correoUnico('omar-bd');
  await altaUsuario({ correo: omar, rol: 'omar', activo: true });
  const p2 = await page.context().browser()!.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const pg = await p2.newPage();
  await entrarComo(pg, omar, '/mi-bodega');
  await pg.goto('/bodega');
  await expect(pg).toHaveURL(/\/mi-bodega$/);
  await p2.close();
});

test('el socio desactiva la cuenta: bodega pierde el acceso; reactivarla lo devuelve', async ({ page, browser }, info) => {
  const socio = correoUnico('socio-off');
  await altaUsuario({ correo: socio, socio: 'Javier' });
  await entrarComo(page, socio, '/cuentas');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const b = await ctx.newPage();
  await entrarComo(b, correoBodega, '/bodega');
  const fila = page.getByRole('row').filter({ hasText: correoBodega });
  await fila.getByTestId('desactivar-cuenta').click();
  await expect(page.getByRole('dialog')).toContainText('dejará de poder entrar');
  await page.getByTestId('confirmar').click();
  await expect(fila).toContainText('Desactivada');
  // La sesion abierta de bodega ya no sirve: cualquier recarga la manda al login.
  await b.goto('/bodega');
  await expect(b).toHaveURL(/\/login/);
  // Y no puede volver a entrar con un enlace nuevo.
  await b.goto(await enlaceConfirmacion(correoBodega, '/bodega'));
  await b.getByTestId('confirmar-acceso').click();
  await expect(b).toHaveURL(/\/login\?error=desactivada/);
  await captura(page, info.project.name, 'claro', 'cuentas-desactivada');
  await fila.getByTestId('reactivar-cuenta').click();
  await expect(fila).toContainText('Activa');
  await entrarComo(b, correoBodega, '/bodega');
  await expect(b.getByTestId('bodega-cliente').first()).toBeVisible();
  await ctx.close();
  const aud = await conDb((c) => c.query("select count(*)::int n from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and accion = 'UPDATE'"));
  expect(aud.rows[0].n).toBeGreaterThanOrEqual(2);
});

test('cambiar el correo: el acceso anterior se desactiva, el nuevo entra a su vista y la auditoria no trae correos', async ({ page, browser }, info) => {
  const socio = correoUnico('socio-cc');
  await altaUsuario({ correo: socio, socio: 'Angelo' });
  const provisional = correoUnico('provisional');
  const definitivo = correoUnico('definitivo');
  await altaUsuario({ correo: provisional, rol: 'bodega', activo: true });
  await entrarComo(page, socio, '/cuentas');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
  const b = await ctx.newPage();
  await entrarComo(b, provisional, '/bodega');
  const fila = page.getByRole('row').filter({ hasText: provisional });
  await fila.getByTestId('cambiar-correo').click();
  await expect(page.getByRole('dialog')).toContainText('dejará de poder entrar');
  await page.getByTestId('campo-correo-nuevo').fill('no es correo');
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('dialog')).toContainText('correo nuevo válido');
  await page.getByTestId('campo-correo-nuevo').fill(definitivo);
  await page.getByTestId('confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: definitivo })).toContainText('Activa');
  await expect(page.getByRole('row').filter({ hasText: provisional })).toContainText('Desactivada');
  await captura(page, info.project.name, 'claro', 'cuentas-correo-cambiado');
  // La sesion del correo anterior ya no sirve.
  await b.goto('/bodega');
  await expect(b).toHaveURL(/\/login/);
  // El acceso del correo nuevo lo crea `acceso:cuentas` (aqui, el mismo alta de usuario de las pruebas) y entra a SU vista.
  await altaUsuario({ correo: definitivo, rol: 'bodega', activo: true });
  await entrarComo(b, definitivo, '/bodega');
  await expect(b).toHaveURL(/\/bodega$/);
  await ctx.close();
  const aud = await conDb((c) => c.query("select count(*)::int n from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and (coalesce(antes::text,'') || coalesce(despues::text,'') || coalesce(registro_id,'')) ilike '%@%'"));
  expect(aud.rows[0].n).toBe(0);
});
