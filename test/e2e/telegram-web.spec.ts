// Lo que registra el bot de Telegram aparece en la web. El pedido entra por la MISMA puerta SQL que usa el webhook (agente.ejecutar_ext, canal telegram,
// autor = el socio) y se comprueba en /pedidos y en su detalle con una sesion de socio. Datos ficticios; ningun Telegram real.
import { expect, test } from '@playwright/test';
import { altaUsuario, conDb, correoUnico, entrarComo, ipFalsa } from './ayudas';

test.use({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });

const SUF = Date.now().toString(36);
const CLIENTE = `Cliente Tg ${SUF}`;
const MODELO = `Modelo Tg ${SUF} 20K`;

test('un pedido creado desde el chat aparece en la web con el precio del tabulador y su folio', async ({ page }) => {
  const folio = await conDb(async (c) => {
    await c.query("select set_config('rtm.canal', 'importacion', false)");
    await c.query("select catalogo.asegurar_cliente($1, 'Javier')", [CLIENTE]);
    await c.query("select catalogo.asegurar_modelo('Marca Tg', $1, 20000, 'ambas')", [MODELO]);
    await c.query("select catalogo.asegurar_sku($1, 'Mango')", [MODELO]);
    await c.query("select catalogo.fijar_costo($1, 'Isaac', $2, 12000, negocio.hoy() - 30, 'prueba')", [`tgw:k:${SUF}`, MODELO]);
    await c.query("select catalogo.fijar_precio($1, $2, $3, 27000, negocio.hoy() - 30, 'chat')", [`tgw:p:${SUF}`, CLIENTE, MODELO]);
    await c.query("select operacion.registrar_movimiento($1, $2, 'Mango', 'bodega_omar', 'entrada_compra', 60, 720000, negocio.hoy() - 3)", [`tgw:m:${SUF}`, MODELO]);
    const ids = (await c.query('select (select id from catalogo.cliente where nombre_canonico = $1) as c, (select id from catalogo.modelo where nombre_canonico = $2) as m, (select id from catalogo.sabor where nombre_canonico = $3) as s', [CLIENTE, MODELO, 'Mango'])).rows[0] as { c: string; m: string; s: string };
    // Endurecimiento ALTO-1 (lane telegram-agente): la base exige un remitente verificado y registrado.
    await c.query("select agente.registrar_miembro(5000099, 'javier')");
    const r = await c.query("select agente.ejecutar_ext($1, 'pedido_crear', $2::jsonb) as j", [`tgw:pedido:${SUF}`, JSON.stringify({ plazo_dias: 0, autor: 'javier', telegram_user_id: 5000099, origen: 'e2e web', cliente_id: Number(ids.c), lineas: [{ modelo_id: Number(ids.m), sabor_id: Number(ids.s), piezas: 24 }] })]);
    return (r.rows[0] as { j: { folio: string } }).j.folio;
  });
  expect(folio).toMatch(/^P-\d+/);
  await entrarComo(page, await altaYCorreo(), '/pedidos');
  await expect(page.getByText(folio).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(CLIENTE).first()).toBeVisible();
  await page.getByText(folio).first().click();
  // 24 pz x 270.00 = 6,480.00, el importe sale del tabulador del servidor
  await expect(page.locator('body')).toContainText('6,480.00');
});

async function altaYCorreo(): Promise<string> {
  const correo = correoUnico('tgw');
  await altaUsuario({ correo, rol: 'socio', socio: 'Javier' });
  return correo;
}
