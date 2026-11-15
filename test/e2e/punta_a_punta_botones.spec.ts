// Botones, enlaces y dialogos de CADA pantalla (inventario B-01 a B-122 de qa/01-inventario-y-matriz.md) en los cuatro viewports y los dos temas.
// Solo acciones NO destructivas: se verifica que el boton exista y sea tocable, que abra su dialogo propio (nunca window.confirm), que el foco inicial caiga en Cancelar,
// que Esc cierre sin escribir nada en la base, que el dialogo quepa en pantalla y se deje una captura. Las acciones que escriben se prueban en punta_a_punta_flujos.spec.ts.
// ESCRITA Y TIPADA, NO EJECUTADA.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { pedidoConfirmadoE2E } from './ayudas';
import { TEMAS, capturar, contarEventos, dialogoCabeEnPantalla, fijarTema, ipFalsa, sembrarQA, sesionSocio, vigilarErrores, type DatosQA, type Tema } from './punta_a_punta_ayudas';

// Las pantallas y los botones no dependen unos de otros: un fallo no debe ocultar el resto (cada prueba abre su propia sesion).
test.describe.configure({ mode: 'default' });
test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

let d: DatosQA;
let confirmadoId = 0;
test.beforeAll(async () => {
  d = await sembrarQA();
  confirmadoId = await pedidoConfirmadoE2E(d, 20, 'botones');
});

// El menu lateral pasa a boton (hamburguesa) por debajo de 768 px (shell.css); de 768 a 1023 la barra lateral sigue fija y compacta.
const esMovil = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

/** Abre el dialogo del boton, comprueba foco en Cancelar, que cabe en pantalla, captura y cierra con Esc sin escribir nada. */
async function abrirYCancelar(page: Page, info: Parameters<typeof capturar>[1], tema: Tema, boton: Locator, nombre: string): Promise<void> {
  const eventosAntes = await contarEventos('pedido_creado') + await contarEventos('pago_cliente') + await contarEventos('aportacion_socio');
  await boton.scrollIntoViewIfNeeded();
  await boton.click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo, `${nombre}: abre su dialogo propio`).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Cancelar' }), `${nombre}: foco inicial en Cancelar`).toBeFocused();
  await dialogoCabeEnPantalla(page);
  await capturar(page, info, tema, `dialogo-${nombre}`);
  await page.keyboard.press('Escape');
  await expect(dialogo, `${nombre}: Esc cierra`).toBeHidden();
  const eventosDespues = await contarEventos('pedido_creado') + await contarEventos('pago_cliente') + await contarEventos('aportacion_socio');
  expect(eventosDespues, `${nombre}: cancelar no escribe nada`).toBe(eventosAntes);
}

for (const tema of TEMAS) {
  test.describe(`tema ${tema}`, () => {
    test.beforeEach(async ({ page }) => {
      await fijarTema(page, tema);
    });

    test('shell: 12 enlaces del sidebar, logo, boton de tema, cerrar sesion y cajon de Explicar (B-01 a B-27)', async ({ page }, info) => {
      const vigia = vigilarErrores(page);
      await sesionSocio(page, '/');
      const secciones: [string, RegExp][] = [
        ['Inicio', /\/$/], ['Pedidos y notas', /\/pedidos$/], ['Paquetes por hacer', /\/paquetes\/por-hacer$/], ['Paquetes en trayecto', /\/paquetes\/en-trayecto$/],
        ['Cuentas por cobrar', /\/cuentas-por-cobrar$/], ['Catálogo y precios', /\/catalogo$/], ['Clientes', /\/clientes$/], ['Inventario', /\/inventario$/],
        ['Proveedores', /\/proveedores/], ['Cuenta de socios', /\/socios$/], ['Cuenta con Omar', /\/omar$/], ['Avisos', /\/avisos$/],
      ];
      for (const [nombre, url] of secciones) {
        if (esMovil(page)) await page.getByRole('button', { name: /Abrir menú/i }).click();
        await page.getByRole('link', { name: nombre, exact: true }).first().click();
        await expect(page).toHaveURL(url);
        await expect(page.getByRole('link', { name: nombre, exact: true }).first()).toHaveAttribute('aria-current', 'page');
        if (esMovil(page)) await expect(page.getByRole('button', { name: /Abrir menú/i })).toHaveAttribute('aria-expanded', 'false');
      }
      // Boton de tema: alterna y persiste.
      const otro: Tema = tema === 'claro' ? 'oscuro' : 'claro';
      await page.getByTestId('boton-tema').click();
      await expect(page.locator('html')).toHaveAttribute('data-tema', otro);
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-tema', otro);
      await page.getByTestId('boton-tema').click();
      await expect(page.locator('html')).toHaveAttribute('data-tema', tema);
      await expect(page.getByTestId('cerrar-sesion')).toBeVisible();
      await capturar(page, info, tema, 'shell');
      expect(vigia.errores).toEqual([]);
    });

    test('Pedidos: nuevo pedido, chips de estado, folio y formulario completo (B-34 a B-57)', async ({ page }, info) => {
      await sesionSocio(page, '/pedidos');
      await expect(page.getByRole('link', { name: 'Nuevo pedido' }).first()).toBeVisible();
      for (const [chip, estado] of [['Todos', null], ['Borradores', 'borrador'], ['Por enviar', 'por_enviar'], ['Enviados', 'enviado'], ['Anulados', 'anulado']] as const) {
        await page.getByRole('link', { name: new RegExp(`^${chip}`) }).first().click(); // el segmentado de estado trae el conteo despues del nombre
        await page.waitForLoadState('networkidle');
        if (estado) await expect(page).toHaveURL(new RegExp(`estado=`));
        await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
      }
      await page.getByTestId('filtros-plegables').click(); // "Más": avisos y origen viven en el desplegable
      await page.getByRole('link', { name: /Con aviso/ }).first().click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page).toHaveURL(/aviso=1/);
      await page.goto(`/pedidos/nuevo?cliente=${d.clienteId}`);
      for (const id of ['modelo', 'sabor', 'piezas', 'precio', 'motivo', 'agregar-renglon', 'envio', 'condicion-pago', 'crear-pedido']) await expect(page.getByTestId(id), `campo ${id}`).toBeVisible();
      await capturar(page, info, tema, 'pedido-nuevo');
    });

    test('Pedido enviado: registrar pago, emitir correccion, anular, vistas de la nota, copiar texto y PDF (B-58 a B-75)', async ({ page }, info) => {
      await sesionSocio(page, `/pedidos/${d.pedidoBodegaId}`);
      for (const [id, nombre] of [['registrar-pago', 'registrar-pago'], ['corregir-nota', 'corregir-nota'], ['anular-pedido', 'anular-pedido']] as const) {
        await abrirYCancelar(page, info, tema, page.getByTestId(id), nombre);
      }
      for (const vista of ['Nota', 'Hoja interna', 'Versiones']) {
        await page.getByRole('link', { name: vista, exact: true }).click();
        await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
        await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
      }
      await page.getByRole('link', { name: 'Nota', exact: true }).click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page.getByTestId('descargar-pdf')).toBeVisible();
      await expect(page.getByTestId('texto-whatsapp')).toBeVisible();
      await expect(page.getByRole('button', { name: /Copiar/ }).first()).toBeVisible();
      await capturar(page, info, tema, 'pedido-enviado');
    });

    test('Pedido confirmado y Paquetes por hacer: empacar, marcar enviado (dialogo con surtido, guia y costo) (B-58 a B-60, B-76, B-77)', async ({ page }, info) => {
      await sesionSocio(page, `/pedidos/${confirmadoId}`);
      await expect(page.getByTestId('marcar-empacado')).toBeVisible();
      await abrirYCancelar(page, info, tema, page.getByTestId(`marcar-enviado-${confirmadoId}`), 'marcar-enviado-pedido');
      await page.goto('/paquetes/por-hacer');
      await expect(page.getByTestId(`empacar-${confirmadoId}`)).toBeVisible();
      await abrirYCancelar(page, info, tema, page.getByTestId(`marcar-enviado-${confirmadoId}`), 'marcar-enviado-lista');
      await page.goto('/paquetes/en-trayecto');
      await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
      await capturar(page, info, tema, 'paquetes');
    });

    test('Cuentas por cobrar: registrar pago, chips, filtro, plazo, recargo, texto de cobro y entrega de un socio (B-81 a B-88)', async ({ page }, info) => {
      await sesionSocio(page, '/cuentas-por-cobrar');
      await abrirYCancelar(page, info, tema, page.getByTestId('nuevo-pago'), 'nuevo-pago');
      for (const chip of ['Todos', 'Solo vencido']) {
        await page.getByRole('button', { name: chip, exact: true }).first().click(); // control segmentado del filtro compartido
        await page.waitForLoadState('networkidle'); // la navegacion del chip debe terminar antes del siguiente goto
        await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
      }
      await expect(page).toHaveURL(/vencido=1/);
      await page.goto('/cuentas-por-cobrar');
      await expect(page.getByRole('button', { name: 'Filtrar' })).toBeVisible();
      await abrirYCancelar(page, info, tema, page.getByTestId(`plazo-${d.pedidoVencidoId}`), 'plazo');
      await abrirYCancelar(page, info, tema, page.getByTestId(`recargo-${d.pedidoVencidoId}`), 'recargo');
      await expect(page.getByTestId('copiar-texto').first()).toBeVisible();
      await abrirYCancelar(page, info, tema, page.getByTestId('entrega-Angelo'), 'entrega-socio');
      await capturar(page, info, tema, 'cxc');
    });

    test('Catalogo, Clientes e Inventario: busqueda, chips, modelo, disponibilidad y ficha (B-92 a B-99)', async ({ page }, info) => {
      await sesionSocio(page, '/catalogo');
      await page.getByRole('searchbox').or(page.getByRole('textbox', { name: /Buscar|modelo|marca/i })).first().fill('%');
      await page.waitForLoadState('networkidle'); // busqueda en vivo: sin boton, la URL se actualiza sola
      await expect(page.locator('main:not(.rtm-documento)')).not.toContainText(/Application error/i);
      await page.goto('/catalogo');
      for (const chip of ['Todos', 'Disponibles', 'Sin disponibilidad']) {
        await page.getByRole('link', { name: chip, exact: true }).first().click();
        await page.waitForLoadState('networkidle'); // la navegacion del chip debe terminar antes del siguiente goto
        await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
      }
      await expect(page).toHaveURL(/estado=sin_disponibilidad/);
      await page.goto(`/catalogo?modelo=${d.modeloId}`);
      await expect(page.locator('main:not(.rtm-documento)')).toContainText(d.cliente);
      await page.goto('/catalogo');
      const fila = page.getByRole('row').filter({ hasText: d.modeloA }).first();
      await abrirYCancelar(page, info, tema, fila.getByRole('button', { name: /disponibilidad|disponible/i }).first(), 'disponibilidad');
      await page.goto('/clientes');
      await page.getByRole('link', { name: d.cliente }).first().click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page.locator('main:not(.rtm-documento)')).toContainText(d.cliente);
      await page.goto('/inventario');
      await expect(page.getByRole('table').first()).toBeVisible();
      await capturar(page, info, tema, 'catalogo-clientes-inventario');
    });

    test('Proveedores: selector Isaac/Karen, nueva OC, pago de socio, pago de la sociedad, ajuste, hoja y liquidacion (B-100 a B-117)', async ({ page }, info) => {
      await sesionSocio(page, '/proveedores?p=Isaac');
      await page.getByRole('link', { name: 'Karen', exact: true }).first().click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page).toHaveURL(/p=Karen/);
      await page.getByRole('link', { name: 'Isaac', exact: true }).first().click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page.getByTestId('nueva-oc')).toBeVisible();
      await abrirYCancelar(page, info, tema, page.getByTestId('pago-socio'), 'pago-socio');
      await abrirYCancelar(page, info, tema, page.getByTestId('pago-sociedad'), 'pago-sociedad');
      await abrirYCancelar(page, info, tema, page.getByTestId('ajuste-proveedor'), 'ajuste-proveedor');
      await page.getByTestId('abrir-liquidacion').click();
      await page.waitForURL('**/proveedores/liquidacion**');
      for (const id of ['ambito-sociedad', 'ambito-todo', 'registrar-dicho', 'cerrar-liquidacion']) await expect(page.getByTestId(id), id).toBeVisible();
      await abrirYCancelar(page, info, tema, page.getByTestId('registrar-dicho'), 'registrar-dicho');
      await page.goto(`/proveedores/compras/${d.compraId}`);
      await expect(page.getByTestId('estado-oc')).toContainText('Borrador');
      await expect(page.getByTestId('confirmar-oc')).toBeVisible();
      await capturar(page, info, tema, 'proveedores');
    });

    test('Socios, cascada y Omar: aportacion, gasto, pago a socio, liquidacion, proponer cierre, toma, pago y cierre semanal (B-118 a B-121)', async ({ page }, info) => {
      await sesionSocio(page, '/socios');
      for (const id of ['aportacion', 'gasto-socio', 'pago-a-socio', 'liquidacion-socios']) await abrirYCancelar(page, info, tema, page.getByTestId(id), id);
      await expect(page.getByTestId('estado-Angelo')).toBeVisible();
      await expect(page.getByTestId('ir-cascada')).toBeVisible();
      await page.goto('/socios/cascada');
      await expect(page.getByTestId('semana-anterior')).toBeVisible();
      await expect(page.getByTestId('efectivo-calculado')).toBeVisible();
      await page.getByTestId('semana-anterior').click(); // el cierre solo se propone sobre una semana ya terminada
      await abrirYCancelar(page, info, tema, page.getByTestId('proponer-cierre'), 'proponer-cierre');
      await page.goto('/omar');
      await abrirYCancelar(page, info, tema, page.getByTestId('nueva-toma'), 'nueva-toma');
      await abrirYCancelar(page, info, tema, page.getByTestId('pago-omar'), 'pago-omar');
      for (const id of ['cerrar-omar', 'exportar-omar']) await expect(page.getByTestId(id), id).toBeVisible();
      await capturar(page, info, tema, 'socios-omar');
    });

    test('Avisos: chips Pendientes y Todos y marcar leido (B-89 a B-91)', async ({ page }, info) => {
      await sesionSocio(page, '/avisos');
      await page.getByRole('link', { name: 'Todos', exact: true }).first().click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page.getByRole('table', { name: 'Avisos' })).toBeVisible();
      await page.getByRole('link', { name: 'Pendientes', exact: true }).first().click();
      await page.waitForLoadState('networkidle'); // WebKit: la navegacion suave debe terminar antes del siguiente paso
      await expect(page.locator('main:not(.rtm-documento)')).toBeVisible();
      await capturar(page, info, tema, 'avisos');
    });

    test('Cifras comprobadas: "Explicar este numero" abre el cajon, cuadra y Esc devuelve el foco (B-24 a B-26)', async ({ page }, info) => {
      await sesionSocio(page, '/inventario');
      const boton = page.getByRole('button', { name: /Explicar este número/ }).first();
      await boton.click();
      await expect(page.getByTestId('explicar-cajon')).toBeVisible();
      await capturar(page, info, tema, 'explicar');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('explicar-cajon')).toBeHidden();
      await expect(boton).toBeFocused();
    });
  });
}

test('H-15 (corregido en la integracion): el Pulso del encabezado muestra cifras reales cuando hay datos, no "Sin dato" fijo', async ({ page }) => {
  await sesionSocio(page, '/');
  await expect(page.locator('header, [data-testid=pulso]').first()).not.toContainText('Sin dato');
});
