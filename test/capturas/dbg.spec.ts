import { test } from '@playwright/test';
import { altaUsuario, correoUnico, enlaceConfirmacion } from '/Users/javiercamaraportepetit/rtm-lane-historial/test/e2e/ayudas';
test('dbg', async ({ page }) => {
  const correo = correoUnico('dbg'); await altaUsuario({ correo, socio: 'Angelo' });
  await page.setViewportSize({ width: 1440, height: 2200 });
  await page.goto('http://127.0.0.1:3184' + (await enlaceConfirmacion(correo, '/socios')));
  await page.getByTestId('confirmar-acceso').click(); await page.waitForURL('**/socios'); await page.waitForLoadState('networkidle');
  const r = await page.evaluate(() => ['.rtm-app', '.rtm-lateral', '.rtm-region', '.rtm-barra', '.rtm-panel'].map((s) => { const e = document.querySelector(s); if (!e) return s + ' none'; const b = e.getBoundingClientRect(); const c = getComputedStyle(e); return `${s} x${b.x} y${b.y} w${b.width} h${b.height} disp=${c.display} cols=${c.gridTemplateColumns}`; }));
  console.log(r.join('\n'));
  console.log(await page.evaluate(() => [...document.styleSheets].map((s) => s.href).join('\n')));
});
