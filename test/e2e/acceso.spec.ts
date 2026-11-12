// Las ocho pruebas locales del flujo de acceso con el buzon local (Mailpit), mas las de refuerzo de la especificacion.
// Contra el Supabase local y un servidor de desarrollo local. Correos ficticios (@example.test).
import { expect, test, type Browser, type Page } from '@playwright/test';
import { altaUsuario, conDb, contarUsuariosAuth, correoUnico, enlaceDe, esperarMensajes, estado, ipFalsa, mensajesPara } from './ayudas';

// Puerto del servidor de las pruebas (E2E_PUERTO permite correr en un puerto propio si el 3100 esta ocupado por otra sesion).
const BASE = process.env.APP_URL_E2E ?? `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3100'}`;

const TARJETA_ENVIADO = 'Te mandamos un enlace a tu correo.';

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': ipFalsa() });
});

async function pedirEnlace(page: Page, correo: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Tu correo').fill(correo);
  await page.getByRole('button', { name: 'Continuar con correo' }).click();
}

async function entrar(page: Page, correo: string, next?: string) {
  await pedirEnlace(page, correo, next);
  await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible();
  const [m] = await esperarMensajes(correo, 1);
  expect(m).toBeTruthy();
  await page.goto(await enlaceDe(correo));
}

test.describe('acceso por enlace magico', () => {
  test('1. envio del enlace: un correo permitido ve la tarjeta de enviado y recibe el mensaje con su enlace', async ({ page }) => {
    const correo = correoUnico('envio');
    await altaUsuario({ correo });
    await pedirEnlace(page, correo);
    await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible();
    await expect(page.getByText(correo)).toBeVisible();
    const msgs = await esperarMensajes(correo, 1);
    expect(msgs).toHaveLength(1);
    expect(await enlaceDe(correo)).toContain('/auth/v1/verify');
  });

  test('2. uso del enlace: abre sesion, aterriza en el armazon y muestra el socio', async ({ page }) => {
    const correo = correoUnico('uso');
    await altaUsuario({ correo, socio: 'Angelo' });
    await entrar(page, correo);
    await expect(page).toHaveURL(`${BASE}/`);
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    await expect(page.getByText('Sesión de Angelo')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tu turno' })).toBeVisible();
  });

  test('3. rechazo de un correo no permitido: misma pantalla, ningun mensaje, auth.users sin cambios y piso de 1.5 s en ambas ramas', async ({ page }) => {
    const permitido = correoUnico('perm');
    const intruso = correoUnico('intruso');
    await altaUsuario({ correo: permitido });
    const antes = await contarUsuariosAuth();

    const t0 = Date.now();
    await pedirEnlace(page, intruso);
    await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible();
    const msIntruso = Date.now() - t0;
    expect(msIntruso).toBeGreaterThanOrEqual(1400);

    const t1 = Date.now();
    await pedirEnlace(page, permitido);
    await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible();
    const msPermitido = Date.now() - t1;
    expect(msPermitido).toBeGreaterThanOrEqual(1400);

    expect(await esperarMensajes(permitido, 1)).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1000));
    expect(await mensajesPara(intruso)).toHaveLength(0);
    expect(await contarUsuariosAuth()).toBe(antes);
  });

  test('4. limite de intentos: tope por correo (3 por 10 min, sin mas correos y misma respuesta) y por IP (10 por 5 min, error generico)', async ({ page }) => {
    // Determinista: el limite es de ventana deslizante exacta, asi que da igual en que minuto del reloj caigan los intentos.
    // Claves propias de esta corrida: correo unico e IP falsa unica (beforeEach). El tope GLOBAL es compartido por todas las
    // pruebas: se vacia aqui para que lo gastado por las demas no le reste correos a esta.
    await conDb((c) => c.query(`delete from seguridad.limite_intento_evento where clave like 'global:%'`));
    const correo = correoUnico('tope');
    await altaUsuario({ correo });
    for (let i = 0; i < 4; i += 1) {
      await pedirEnlace(page, correo);
      await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible(); // la respuesta es la de siempre, aun cuando ya no se manda nada
    }
    // Espera hasta que lleguen los 3 permitidos (la maquina puede ir lenta) y luego un margen para comprobar que NO llega un cuarto.
    expect(await esperarMensajes(correo, 3, 60_000)).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 3000));
    expect(await mensajesPara(correo)).toHaveLength(3);

    // Tope por IP: con 4 intentos ya contados, el undecimo de esta IP recibe el error generico.
    let visto = false;
    for (let i = 0; i < 9 && !visto; i += 1) {
      await pedirEnlace(page, correoUnico('otro'));
      await page.waitForURL(/\/login\?.*(enviado|error)=1/);
      visto = await page.locator('.login-error').isVisible();
    }
    expect(visto).toBe(true);
    await expect(page.locator('.login-error')).toHaveText('Algo falló. Intenta otra vez.');
  });

  test('5. enlace caducado: avisa el motivo y manda solo un enlace nuevo al correo de ESTE navegador', async ({ page }) => {
    const correo = correoUnico('caduca');
    const id = await altaUsuario({ correo });
    await pedirEnlace(page, correo);
    await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible();
    await esperarMensajes(correo, 1);
    const enlace = await enlaceDe(correo);
    // Se vence el enlace desde la base (otp_expiry es de una hora): el reloj del token queda dos horas atras.
    await conDb(async (c) => {
      await c.query(`update auth.users set recovery_sent_at = now() - interval '2 hours', confirmation_sent_at = now() - interval '2 hours' where id = $1`, [id]);
      await c.query(`update auth.one_time_tokens set created_at = now() - interval '2 hours' where user_id = $1`, [id]);
    });
    await page.goto(enlace);
    await expect(page).toHaveURL(/\/login\?.*(enviado=1&reenviado=1|error=caducado)/);
    await expect(page.getByText('Ese enlace ya se había usado o caducado — te mandamos uno nuevo.')).toBeVisible();
    expect(await esperarMensajes(correo, 2)).toHaveLength(2);
    // Y el enlace nuevo si funciona.
    await page.goto(await enlaceDe(correo, 0));
    await expect(page).toHaveURL(`${BASE}/`);
  });

  test('6. doble uso: el segundo uso del mismo enlace falla con su motivo y no abre sesion', async ({ page, browser }: { page: Page; browser: Browser }) => {
    const correo = correoUnico('doble');
    await altaUsuario({ correo });
    await entrar(page, correo);
    await expect(page).toHaveURL(`${BASE}/`);
    const enlace = await enlaceDe(correo);

    const otro = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
    const p2 = await otro.newPage();
    await p2.goto(enlace);
    await expect(p2).toHaveURL(/\/login\?error=(caducado|1|navegador)/);
    await expect(p2.locator('.login-error')).toBeVisible();
    await p2.goto('/pedidos');
    await expect(p2).toHaveURL(/\/login/);
    await otro.close();
  });

  test('7. cierre de sesion: vuelve al acceso y las rutas protegidas dejan de abrir', async ({ page }) => {
    const correo = correoUnico('salida');
    await altaUsuario({ correo });
    await entrar(page, correo);
    await expect(page.getByTestId('cerrar-sesion')).toBeVisible();
    await page.getByTestId('cerrar-sesion').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('8. ruta protegida: sin sesion manda al acceso con next, y tras entrar aterriza en esa ruta', async ({ page }) => {
    const correo = correoUnico('ruta');
    await altaUsuario({ correo });
    await page.goto('/pedidos');
    await expect(page).toHaveURL(/\/login\?next=%2Fpedidos/);
    await page.getByLabel('Tu correo').fill(correo);
    await page.getByRole('button', { name: 'Continuar con correo' }).click();
    await expect(page.getByText(TARJETA_ENVIADO)).toBeVisible();
    await esperarMensajes(correo, 1);
    await page.goto(await enlaceDe(correo));
    await expect(page).toHaveURL(`${BASE}/pedidos`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('pedidos');
  });
});

test.describe('refuerzos de la especificacion', () => {
  test('9. alta directa: POST /auth/v1/otp con create_user:true y /signup son rechazados por el GoTrue real', async () => {
    const e = estado();
    const intruso = correoUnico('directo');
    const antes = await contarUsuariosAuth();
    const cab = { apikey: e.ANON_KEY, 'content-type': 'application/json' };
    const otp = await fetch(`${e.API_URL}/auth/v1/otp`, { method: 'POST', headers: cab, body: JSON.stringify({ email: intruso, create_user: true }) });
    expect(otp.status).toBeGreaterThanOrEqual(400);
    const signup = await fetch(`${e.API_URL}/auth/v1/signup`, { method: 'POST', headers: cab, body: JSON.stringify({ email: intruso, password: 'una-clave-larga-1234' }) });
    expect(signup.status).toBeGreaterThanOrEqual(400);
    expect(await contarUsuariosAuth()).toBe(antes);
  });

  test('10. cuenta inactiva (Omar hasta M2) con enlace valido no entra; y next externo cae a la raiz', async ({ page }) => {
    const omar = correoUnico('omar');
    await altaUsuario({ correo: omar, rol: 'omar', activo: false });
    await entrar(page, omar);
    await expect(page).toHaveURL(/\/login\?error=desactivada/);
    await expect(page.locator('.login-error')).toContainText('no está activo');
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);

    const socio = correoUnico('socio');
    await altaUsuario({ correo: socio });
    await entrar(page, socio, 'https://externo.example.test/robo');
    await expect(page).toHaveURL(`${BASE}/`);
  });

  test('11. con movimiento reducido el arte pinta un solo cuadro (sin ciclo de animacion)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __raf: number }).__raf = 0;
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        (window as unknown as { __raf: number }).__raf += 1;
        return original(cb);
      };
    });
    await page.goto('/login');
    await expect(page.locator('.login-artwork[data-listo]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    const raf = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    expect(raf).toBeLessThanOrEqual(2);
    const pintado = await page.evaluate(() => {
      const c = document.querySelector('.login-artwork canvas') as HTMLCanvasElement;
      return c.width > 0 && c.toDataURL().length > 3000;
    });
    expect(pintado).toBe(true);
    await ctx.close();
  });
});
