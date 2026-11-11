// Pantallas de F3c en laptop 1440 (Chromium): asistente de apertura de diez pasos con vista previa, ensayo, firma de los dos socios y reversa; y zona Movimientos.
// Todos los datos son ILUSTRATIVOS y los crea la propia prueba (nombres "E2E Apertura ..."). Cierra la sesion revirtiendola: la base queda sin apertura vigente.
import { expect, test, type Page } from '@playwright/test';
import { altaUsuario, conDb, consultar, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

const SUF = Date.now().toString(36);
const MODELO = `E2E Apertura Uno ${SUF}`;
const CLIENTE = `E2E Apertura Cliente ${SUF}`;
const CLIENTE_MOV = `E2E Mov Cliente ${SUF}`;

test.beforeAll(async () => {
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_modelo('E2E Apertura Marca', $1, 50000, 'ambas')", [MODELO]);
    await c.query("select catalogo.asegurar_sku($1, 'Fresa')", [MODELO]);
    await c.query("select catalogo.asegurar_cliente($1, 'Javier')", [CLIENTE]);
    await c.query("select catalogo.asegurar_cliente($1, 'Javier')", [CLIENTE_MOV]);
    await c.query('commit');
  });
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

test('apertura: diez pasos, identidad contable, vista previa, ensayo, firma de los dos socios y reversa', async ({ page, browser }) => {
  const angelo = correoUnico('f3c-ang');
  const javier = correoUnico('f3c-jav');
  await altaUsuario({ correo: angelo, socio: 'Angelo' });
  await altaUsuario({ correo: javier, socio: 'Javier' });
  await entrarComo(page, angelo, '/apertura');

  // La cuenta puente puede traer saldo de otras pruebas de la misma corrida: se compara contra el valor de antes, no contra cero.
  const puenteAntes = (await consultar<{ p: string }>("select contabilidad.saldo('3990')::text as p"))[0]!.p;

  // Sin sesion
  await expect(page.getByTestId('apertura-vacia')).toBeVisible();
  await expect(page.getByTestId('lista-pasos').getByRole('listitem')).toHaveCount(10);
  await page.getByTestId('apertura-crear').click();
  await page.getByRole('button', { name: 'Abrir sesión' }).click();
  await expect(page.getByTestId('apertura-estado')).toContainText('Borrador');

  // Paso 1 y 2
  await page.goto('/apertura/paso/1');
  await expect(page.getByTestId('corte')).toBeVisible();
  await page.goto('/apertura/paso/2');
  await expect(page.getByTestId('catalogo-conteo')).toContainText('Modelos');

  // Pasos 3 a 8: partidas ilustrativas
  await agregar(page, 3, 'aportacion', { socio: 'Angelo', monto: '84615' });
  await agregar(page, 3, 'aportacion', { socio: 'Javier', monto: '56000' });
  await expect(page.getByTestId('total-paso')).toContainText('$140,615.00');
  await agregar(page, 4, 'inventario', { modelo: `E2E Apertura Marca ${MODELO}`, sabor: 'Fresa', piezas: '100', costo: '91.55' });
  await expect(page.getByTestId('total-paso')).toContainText('$9,155.00');
  await agregar(page, 5, 'caja', { socio: 'Angelo', monto: '500' });
  await agregar(page, 5, 'fondos_en_poder', { socio: 'Javier', monto: '9000' });
  await agregar(page, 6, 'cxc', { cliente: CLIENTE, monto: '7500', fecha: '2026-10-20' });
  await agregar(page, 7, 'proveedor_a_favor', { proveedor: 'Karen', monto: '30500' });
  await agregar(page, 7, 'proveedor_debemos', { proveedor: 'Isaac', monto: '3000' });
  await agregar(page, 8, 'utilidad_no_repartida', { socio: 'Javier', monto: '2000' });
  await agregar(page, 8, 'retiro_previo', { socio: 'Angelo', monto: '1000' });
  await agregar(page, 8, 'deuda_faltante_socio', { socio: 'Angelo', piezas: '12', monto: '1098.55' });

  // Resumen: identidad contable con la diferencia en la cuenta puente
  await page.goto('/apertura');
  await expect(page.getByTestId('id-activo')).toHaveText('$27,253.55');
  await expect(page.getByTestId('id-pasivo')).toHaveText(/27,500\.00/);
  await expect(page.getByTestId('id-capital')).toHaveText('$141,615.00');
  await expect(page.getByTestId('id-puente')).toHaveText(/86,861\.45/);
  await expect(page.getByTestId('alertas')).toContainText('cuenta puente 3990');

  // Paso 9: vista previa sin escribir y ensayo
  const asientosAntes = (await consultar<{ n: string }>('select count(*)::text as n from contabilidad.asiento'))[0]!.n;
  await page.goto('/apertura/paso/9');
  await expect(page.getByTestId('previa-cuadra')).toContainText('el asiento cuadra');
  await page.getByTestId('apertura-ensayo').click();
  await expect(page.getByTestId('ensayo-resultado')).toContainText('comprobaciones bloqueantes en rojo: 0');
  await expect(page.getByTestId('ensayo-resultado')).toContainText('cadena de hash sana');
  expect((await consultar<{ n: string }>('select count(*)::text as n from contabilidad.asiento'))[0]!.n).toBe(asientosAntes);
  expect((await consultar<{ n: string }>("select count(*)::text as n from operacion.movimiento_inventario where tipo = 'apertura'"))[0]!.n).toBe('0');

  // Resolver la diferencia: repartirla al capital exige justificacion escrita (supera el 0.5 % del activo)
  await page.getByTestId('apertura-resolucion').click();
  await page.getByTestId('campo-p_resolucion').selectOption('capital_50_50');
  await page.getByRole('button', { name: 'Guardar resolución' }).click();
  await expect(page.getByText('repartirla al capital 50/50')).toBeVisible();
  await page.goto('/apertura/paso/10');
  await expect(page.getByTestId('no-lista')).toContainText('justificación');
  await page.goto('/apertura/paso/9');
  await page.getByTestId('apertura-resolucion').click();
  await page.getByTestId('campo-p_resolucion').selectOption('capital_50_50');
  await page.getByTestId('campo-p_justificacion').fill('Diferencia entre el capital declarado y los saldos de la prueba ilustrativa');
  await page.getByRole('button', { name: 'Guardar resolución' }).click();
  await expect.poll(async () => page.getByTestId('apertura-ensayo').count()).toBe(1);

  // Paso 10: firma de Angelo; con firma ya no se edita
  await page.goto('/apertura/paso/10');
  await page.getByTestId('apertura-firmar').click();
  await page.getByRole('button', { name: 'Firmar', exact: true }).click();
  await expect(page.getByTestId('estado-firma')).toContainText('Falta la firma de Javier');
  await page.goto('/apertura/paso/5');
  await expect(page.getByTestId('form-caja')).toHaveCount(0);

  // Firma de Javier en otra sesion: la segunda firma publica
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, viewport: { width: 1440, height: 900 } });
  const pj = await ctx.newPage();
  await entrarComo(pj, javier, '/apertura/paso/10');
  await pj.getByTestId('apertura-firmar').click();
  await pj.getByRole('button', { name: 'Firmar', exact: true }).click();
  await expect(pj.getByTestId('estado-firma')).toContainText('Publicada');
  await ctx.close();

  // Publicada: inventario en el kardex, diferencia resuelta en cero, comprobaciones sin bloqueantes
  const s = (await consultar<{ p: string; inv: string; kardex: string; ap: string }>(
    "select contabilidad.saldo('3990')::text as p, contabilidad.saldo('1310')::text as inv, coalesce((select sum(valor_cent) from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0)::text as kardex, (select count(*)::text from operacion.movimiento_inventario where tipo = 'apertura') as ap", [MODELO]))[0]!;
  expect(s.p).toBe(puenteAntes);
  expect(s.kardex).toBe('915500');
  expect(Number(s.inv)).toBeGreaterThanOrEqual(915500);
  expect(s.ap).toBe('1');
  await page.goto('/contabilidad/comprobaciones');
  await expect(page.getByTestId('resumen-comprobaciones')).toBeVisible();
  await expect(page.getByText('comprobación bloqueante falla')).toHaveCount(0);
  await page.goto('/apertura/paso/10');
  await expect(page.getByTestId('estado-firma')).toContainText('Publicada');

  // Reversa con motivo
  await page.getByTestId('apertura-reversar').click();
  await page.getByTestId('campo-p_motivo').fill('Cierre de la prueba ilustrativa');
  await page.getByRole('button', { name: 'Revertir', exact: true }).click();
  await expect(page.locator('.rtm-error')).toHaveCount(0);
  await expect(page.getByTestId('apertura-reversar')).toHaveCount(0);
  await page.goto('/apertura');
  await expect(page.getByTestId('apertura-vacia')).toContainText('revertida');
  const r = (await consultar<{ p: string; kardex: string }>(
    "select contabilidad.saldo('3990')::text as p, coalesce((select sum(valor_cent) from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1), 0)::text as kardex", [MODELO]))[0]!;
  expect(r.p).toBe(puenteAntes);
  expect(r.kardex).toBe('0');
});

test('movimientos: pegar, contar sin escribir, importar, reimportar da cero, clasificar y conciliar', async ({ page }) => {
  const correo = correoUnico('f3c-mov');
  await altaUsuario({ correo, socio: 'Javier' });
  await entrarComo(page, correo, '/movimientos/importar');
  const centavos = String(10 + (Date.now() % 80)).padStart(2, '0');
  const texto = [
    `2026-11-01\t10000.00\tCuenta ilustrativa\tCliente ilustrativo\tCobro ${SUF}`,
    `2026-11-02\t-2500.00\tCuenta ilustrativa\tProveedor ilustrativo\tPago ${SUF}`,
    `02/11/2026\t4321.${centavos}\tCuenta ilustrativa\tSocio\tDeposito ${SUF}`,
    `no es fecha\t100\tx\tx\tFila mala ${SUF}`,
  ].join('\n');
  await page.getByTestId('pegado').fill(texto);
  await expect(page.getByTestId('errores')).toContainText('Fecha no válida');
  await page.getByTestId('contar').click();
  await expect(page.getByTestId('conteo')).toContainText('Ensayo, no se escribió nada: 3 nuevas, 0 ya existían');
  expect((await consultar<{ n: string }>('select count(*)::text as n from operacion.movimiento_crudo where mensaje_original like $1', [`%${SUF}`]))[0]!.n).toBe('0');
  await page.getByTestId('importar').click();
  await expect(page.getByTestId('conteo')).toContainText('3 nuevas, 0 ya existían');
  await page.getByTestId('importar').click();
  await expect(page.getByTestId('conteo')).toContainText('0 nuevas, 3 ya existían');
  expect((await consultar<{ n: string }>('select count(*)::text as n from operacion.movimiento_crudo where mensaje_original like $1', [`%${SUF}`]))[0]!.n).toBe('3');

  // Bandeja: las filas entran sin clasificar y no afectan ningun saldo
  await page.goto('/movimientos?estado=sin_clasificar');
  const cobro = page.getByRole('row').filter({ hasText: `Cobro ${SUF}` });
  await expect(cobro).toContainText('Sin clasificar');
  await cobro.getByRole('button', { name: 'Clasificar' }).click();
  await page.getByTestId('campo-cliente').selectOption({ label: CLIENTE_MOV });
  await page.getByRole('button', { name: 'Guardar clasificación' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/movimientos?estado=clasificado');
  await expect(page.getByRole('row').filter({ hasText: `Cobro ${SUF}` })).toContainText('Clasificado');

  // Deposito: se clasifica como aportacion y concilia con la aportacion registrada en la cuenta de socios (misma suma)
  await page.goto('/socios');
  await page.getByTestId('aportacion').click();
  await page.getByTestId('campo-p_monto_cent').fill(`4321.${centavos}`);
  await page.getByTestId('campo-p_concepto').fill(`Aportacion ilustrativa ${SUF}`);
  await page.getByRole('button', { name: 'Registrar aportación', exact: true }).last().click();
  await expect(page.getByText(`Aportacion ilustrativa ${SUF}`).first()).toBeVisible();
  await page.goto('/movimientos?estado=sin_clasificar');
  const dep = page.getByRole('row').filter({ hasText: `Deposito ${SUF}` });
  await dep.getByRole('button', { name: 'Clasificar' }).click();
  await page.getByTestId('campo-tipo').selectOption('aportacion');
  await page.getByRole('button', { name: 'Guardar clasificación' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/movimientos?estado=clasificado');
  await page.getByRole('row').filter({ hasText: `Deposito ${SUF}` }).getByRole('button', { name: 'Conciliar' }).click();
  await expect(page.getByTestId('campo-contraparte')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Conciliar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/movimientos?estado=conciliado');
  await expect(page.getByRole('row').filter({ hasText: `Deposito ${SUF}` })).toContainText('Conciliado');

  // Agrupar y desglosar: solo cuentan los clasificados o conciliados
  await page.goto('/movimientos/resumen?dim=cliente');
  const grupo = page.getByRole('row').filter({ hasText: CLIENTE_MOV });
  await expect(grupo).toContainText('$10,000.00');
  await grupo.getByRole('link', { name: CLIENTE_MOV }).click();
  await expect(page.getByTestId('desglose')).toContainText(`Cobro ${SUF}`);
  await page.getByTestId('dim-proveedor').click();
  await expect(page.getByText(`Pago ${SUF}`)).toHaveCount(0);
  await expect(page.getByTestId('quien-debe')).toBeVisible();
  await expect(page.getByTestId('utilidad-total')).toContainText('Utilidad total acumulada');
});
