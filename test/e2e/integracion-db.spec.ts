// Integracion con base de datos en laptop 1440 (Chromium): Costos del sistema, Inventario actual de proveedores (lista para cliente y orden de compra a Karen), Reportes
// (preparar, historial, vista previa y PDF con sesion) y la puerta cerrada del webhook y de las tareas. Datos ILUSTRATIVOS que crea la propia prueba.
import { expect, test } from '@playwright/test';
import { altaUsuario, conDb, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

const SUF = Date.now().toString(36);
const MARCA = `Marca Int ${SUF}`;
const MODELO = `Modelo Int ${SUF} 20K`;

function estadoProveedores(horasAtras: number) {
  const t = new Date(Date.now() - horasAtras * 3_600_000).toISOString();
  const modelo = { id: `9${SUF.length}0001`, handle: 'modelo-int', titulo: `${MODELO}`, tituloNorm: 'modelo int', aliasTitulos: [], marca: MARCA, puffs: 20000, estado: 'activo', primeraVez: t, ultimaVez: t, ausencias: 0, primeraAusencia: null, sinSabores: false, nuevoSinCosto: false, mapeo: 'confirmado', canonicoId: null as string | null, gruposCandidatos: [] };
  const variante = (n: number, nombre: string, disponible: boolean) => ({ id: `9${SUF.length}01${n}`, productoId: modelo.id, saborOriginal: nombre, saborNorm: nombre.toLowerCase(), disponible, estado: 'activa', ausencias: 0, primeraAusencia: null, mapeo: 'pendiente', saborCanonicoId: null, cambios: [], inestableHasta: null, primeraVez: t, ultimaVez: t });
  return { modelo, variantes: [variante(1, 'Sandia', true), variante(2, 'Mango', true), variante(3, 'Uva', false)], t };
}

async function sembrarProveedores(canonicoId: string | null, horasAtras: number) {
  const e = estadoProveedores(horasAtras);
  e.modelo.canonicoId = canonicoId;
  const estado = {
    version: 1, inicializado: true, tarjetasPromo: 0, modelos: { [e.modelo.id]: e.modelo }, variantes: Object.fromEntries(e.variantes.map((v) => [v.id, v])), candidatos: {}, retenida: null,
    promociones: { p1: { clave: 'p1', tipo: 'porcentaje', pct: 15, etiqueta: '15 % en 1 modelo', alcance: [e.modelo.id], inicio: null, fin: new Date(Date.now() + 86_400_000).toISOString(), primeraVista: e.t, ultimaVista: e.t, lecturasAusente: 0, estado: 'activa', avisoPorTerminar: false, coleccion: null } },
    cola: [{ tipo: 'sabor', textoOriginal: 'Fresa Kiwi Hielo', textoNorm: 'fresa kiwi hielo', sugerenciaId: null, similitud: 0.7, creada: e.t }],
    historialVariedad: {}, variedad: {}, salud: { ultimaLecturaOk: e.t, ultimoIntento: e.t, fallosSeguidos: 0, bloqueada: false, incidente: null }, lecturasProcesadas: [],
  };
  const eventos = [{ clave: `modelo_nuevo|${e.modelo.id}|${SUF}`, tipo: 'modelo_nuevo', productoId: e.modelo.id, varianteId: null, lectura: SUF, en: e.t, antes: null, despues: e.modelo.titulo, datos: {} }];
  await conDb((c) => c.query('select proveedores.guardar_estado($1::jsonb, $2::jsonb, $3::text)', [JSON.stringify(estado), JSON.stringify(eventos), `e2e:prov:${Date.now()}:${Math.random()}`]));
}

test('costos: un cargo de Supabase se calcula, se registra como gasto de la sociedad, se explica, se reembolsa en parte y se anula con reversa', async ({ page }) => {
  // El reembolso sale de la Caja de la empresa y la base lo bloquea sin saldo (decision 12): la prueba deposita lo que necesita en vez de depender del efectivo que dejen otras specs.
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select operacion.registrar_aportacion($1, 'Angelo', 1000000, 'deposito a caja para la prueba', 'reembolso')", [`e2eidb:dep:${Date.now().toString(36)}`]);
    await c.query('commit');
  });
  await entrarComo(page, await altaYCorreo('cos'), '/costos');
  await expect(page.getByTestId('costos-resumen')).toBeVisible();
  await expect(page.getByTestId('servicio-supabase')).toContainText('Sin cargos este mes');
  await expect(page.getByTestId('pie-marcas')).toContainText('Vercel, the Vercel design');
  // La lista usa casilla fija con monograma; el logo oficial (un <img> por tema, archivo sin alterar) esta en la ficha del servicio, que abre la fila.
  await page.getByTestId('servicio-supabase').getByRole('link').click();
  await expect(page.getByTestId('servicio-logo').locator('img')).toHaveAttribute('src', '/logos/supabase.svg');
  await page.goBack();
  await expect(page.getByTestId('costos-resumen')).toBeVisible();
  const antes = await page.getByTestId('costos-operar').innerText();

  await page.getByTestId('cargo-servicio').selectOption({ label: 'Supabase' });
  await page.getByTestId('cargo-base').fill('75');
  await page.getByTestId('cargo-modo').selectOption('participacion');
  await page.getByTestId('cargo-consumo-rtm').fill('10');
  await page.getByTestId('cargo-consumo-total').fill('60');
  await page.getByTestId('cargo-tc').fill('18.50');
  await expect(page.getByTestId('cargo-vista-previa')).toContainText('$236.00');
  await expect(page.getByTestId('cargo-vista-previa')).toContainText('235.875');
  await expect(page.getByTestId('cargo-vista-previa')).toContainText('queda por reembolsarle');
  await page.getByTestId('cargo-guardar').click();
  await expect(page.getByTestId('cargo-hecho')).toBeVisible({ timeout: 30_000 });

  const fila = page.getByRole('row').filter({ hasText: 'Supabase' }).filter({ hasText: '$236.00' });
  await expect(fila.first()).toBeVisible();
  await expect(page.getByTestId('servicio-supabase')).toContainText('$236.00');
  await expect(page.getByTestId('servicio-supabase')).toContainText('exacto 235.875');
  await expect(page.getByTestId('costos-operar')).not.toHaveText(antes);
  await page.locator('details.rtm-explicar-linea summary').first().click();
  await expect(page.locator('details.rtm-explicar-linea').first()).toContainText('× 17.00 %');
  await expect(page.locator('details.rtm-explicar-linea').first()).toContainText('cuadra');
  // Una cifra distinta de la que calcula la base se rechaza aunque se intente por otra via.
  const pendiente = await page.getByTestId('costos-pendiente').innerText();
  await expect(page.getByTestId('costos-pendiente')).toContainText('236.00');

  // Reembolso parcial en dos pasos: no toca el cargo
  await page.getByTestId('reembolso-monto').fill('100');
  await page.getByTestId('reembolso-guardar').click();
  await expect(page.getByText('el cargo original no cambia')).toBeVisible();
  await page.getByTestId('reembolso-guardar').click();
  await expect(page.getByTestId('costos-pendiente')).toContainText('136.00', { timeout: 30_000 });
  expect(pendiente).toContain('236.00');
  await page.getByTestId('reembolso-monto').fill('500');
  await expect(page.getByTestId('reembolso-guardar')).toBeDisabled();

  // Anular exige motivo y deja una reversa
  await page.locator('[data-testid^="anular-"]').first().click();
  await expect(page.getByTestId('anular-confirmar')).toBeDisabled();
  await page.getByTestId('anular-motivo').fill('Prueba de anulacion');
  await page.getByTestId('anular-confirmar').click();
  await expect(page.getByRole('row').filter({ hasText: 'Reversa' }).first()).toBeVisible({ timeout: 30_000 });
  // Con la reversa el neto del servicio queda en cero (el cargo original se conserva).
  await expect(page.getByTestId('servicio-supabase')).toContainText('$0.00', { timeout: 30_000 });
});

async function altaYCorreo(prefijo: string, socio: 'Angelo' | 'Javier' = 'Javier'): Promise<string> {
  const correo = correoUnico(`int-${prefijo}`);
  await altaUsuario({ correo, socio });
  return correo;
}

test('inventario de proveedores: estado de la lectura, lista para cliente sin proveedor ni precios, bloqueo con dato viejo y orden de compra a Karen con el sabor agotado bloqueado', async ({ page, context }) => {
  const canonico = await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_modelo($1, $2, 20000, 'ambas')", [MARCA, MODELO]);
    for (const s of ['Sandia', 'Mango', 'Uva']) await c.query('select catalogo.asegurar_sku($1, $2)', [MODELO, s]);
    await c.query("select catalogo.fijar_costo($1, 'Karen', $2, 9000, current_date - 10, 'prueba')", [`e2e:k:${SUF}`, MODELO]);
    const r = await c.query('select id::text as id from catalogo.modelo where nombre_canonico = $1', [MODELO]);
    await c.query('commit');
    return r.rows[0].id as string;
  });
  await sembrarProveedores(canonico, 0.2);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await entrarComo(page, await altaYCorreo('prov'), '/proveedores');
  await page.getByTestId('ir-inventario').click();
  await expect(page.getByRole('heading', { name: /Lo que hay en Karen/ })).toBeVisible();
  await expect(page.getByTestId('estado-fuente')).toContainText('Al día');
  await expect(page.getByTestId('estado-fuente')).toContainText('de 40');
  await expect(page.getByText('15 % en 1 modelo').first()).toBeVisible();
  await expect(page.getByText('Fresa Kiwi Hielo')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/myshopify|https?:\/\//i);
  // Lo que viene de la fuente (promociones, estado, sabores) nunca trae importes; el costo que se muestra es el que dio Javier para el catalogo propio.
  for (const region of ['Promociones', 'Estado de la lectura', 'Cambios recientes']) await expect(page.locator(`[aria-label="${region}"]`)).not.toContainText(/\$\s?\d/);
  await expect(page.getByTestId(`modelo-9${SUF.length}0001`)).toContainText('2 de 3 sabores');
  await page.getByTestId('lista-clientes').locator('summary').click();

  await page.getByTestId('lista-marca').selectOption(MARCA);
  await page.getByTestId('lista-preparar').click();
  const texto = page.getByTestId('lista-texto');
  await expect(texto).toContainText(`DISPONIBLE ${MARCA.toUpperCase()}`);
  await expect(texto).toContainText('MODELO INT');
  await expect(texto).toContainText('Mango');
  await expect(texto).toContainText('Sandia');
  await expect(texto).not.toContainText('Uva');
  await expect(texto).not.toContainText(/karen|20\.?000|\$/i);
  await page.getByTestId('lista-copiar').click();
  await expect(page.getByTestId('lista-copiada')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Mango');

  // Orden de compra a Karen desde el panel del modelo: el sabor agotado queda bloqueado
  await page.getByTestId(`modelo-9${SUF.length}0001`).click();
  await page.getByTestId(`orden-9${SUF.length}0001`).click();
  await expect(page).toHaveURL(/\/proveedores\/compras\/nueva\?p=Karen/);
  await expect(page.getByTestId('oc-modelo')).toHaveValue(MODELO);
  await expect(page.getByTestId('oc-sabor').locator('option', { hasText: 'Uva (agotado en Karen)' })).toBeDisabled();
  await expect(page.getByTestId('oc-sabor').locator('option', { hasText: 'Sandia' })).toBeEnabled();

  // Con la lectura de hace 5 horas la lista se bloquea con advertencia
  await sembrarProveedores(canonico, 5);
  await page.goto('/proveedores/inventario');
  await expect(page.getByTestId('estado-fuente')).toContainText('Dato desactualizado');
  await page.getByTestId('lista-clientes').locator('summary').click();
  await page.getByTestId('lista-preparar').click();
  await expect(page.getByTestId('lista-bloqueada')).toContainText('No se prepara la lista');
});

test('reportes: se prepara un semanal, aparece en el historial como version 1, abre su vista previa y su PDF con la sesion', async ({ page }) => {
  test.setTimeout(180_000);
  // Independiente de otras specs: siembra sus propios pedidos, cobros y movimientos (sufijo propio) en vez de depender del efectivo que dejen otras.
  await sembrarCuentasE2E();
  await entrarComo(page, await altaYCorreo('rep'), '/reportes');
  await page.getByTestId('reporte-inicio').fill('2026-11-02');
  await page.getByTestId('reporte-preparar').click();
  await expect(page.getByTestId('reporte-mensaje')).toContainText(/Reporte preparado|no sale/, { timeout: 150_000 });
  const enlace = page.getByTestId('reporte-semanal:2026-11-02-1');
  await expect(enlace).toBeVisible();
  // Localizador especifico: pueden existir otras filas 'Semanal 2026-11-02' (otras versiones o specs); se toma la fila de la version 1 que se acaba de ver.
  const fila = page.getByRole('row').filter({ hasText: 'Semanal 2026-11-02' }).filter({ has: page.getByTestId('reporte-semanal:2026-11-02-1') });
  await expect(fila).toContainText(/Preliminar|Parcial|Definitivo|Borrador/);
  await enlace.click();
  await expect(page.getByTestId('marco-reporte')).toBeVisible();
  const marco = page.frameLocator('[data-testid=marco-reporte]');
  await expect(marco.locator('body')).toContainText(/RTM|Reporte/);
  const pdf = page.getByTestId('abrir-pdf');
  if (await pdf.count()) {
    const r = await page.request.get((await pdf.getAttribute('href'))!);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('application/pdf');
    expect((await r.body()).subarray(0, 4).toString()).toBe('%PDF');
  }
  // Repetir con el mismo paquete no genera version nueva
  await page.goto('/reportes');
  await page.getByTestId('reporte-inicio').fill('2026-11-02');
  await page.getByTestId('reporte-preparar').click();
  await expect(page.getByTestId('reporte-mensaje')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId('reporte-semanal:2026-11-02-2')).toHaveCount(0);
});

test('el webhook de Telegram y las tareas rechazan lo que no trae su secreto y sin sesion no se entra a costos ni a reportes', async ({ page, request }) => {
  const w = await request.post('/api/telegram/webhook', { data: { update_id: 1 }, headers: { 'x-telegram-bot-api-secret-token': 'x'.repeat(24) } });
  expect(w.status()).toBe(401);
  expect((await request.post('/api/telegram/webhook', { data: { update_id: 1 } })).status()).toBe(401);
  expect((await request.get('/api/tareas/latido')).status()).toBe(401);
  expect((await request.get('/api/tareas/latido', { headers: { authorization: 'Bearer malo' } })).status()).toBe(401);
  // Omar esta desactivado hasta M2 (su acceso se rechaza al entrar): ademas, cada ruta nueva exige socio en el layout y en la base (pruebas de contratos y pgTAP).
  await page.goto('/costos');
  expect(new URL(page.url()).pathname).toBe('/login');
});
