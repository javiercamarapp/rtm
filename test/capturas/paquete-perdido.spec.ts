// Capturas del flujo de paquete perdido o danado (por-hacer, en-trayecto y vista de Omar): 1440x900 y 390x844, claro y oscuro.
// Datos ILUSTRATIVOS de la base local: la propia prueba crea pedidos, ordenes e incidentes en varios estados con los nombres "E2E F2 ...".
import { test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { altaUsuario, conDb, correoUnico, enlaceConfirmacion, ipFalsa, sembrarOperacionE2E } from '../e2e/ayudas';

const SALIDA = join(__dirname, '../../docs/capturas/paquete-perdido');
const BASE = `http://127.0.0.1:${process.env.E2E_PUERTO ?? '3140'}`;
const PERFILES = [{ nombre: '1440', ancho: 1440, alto: 900, movil: false }, { nombre: '390', ancho: 390, alto: 844, movil: true }];
const TEMAS = ['claro', 'oscuro'] as const;

test('capturas paquete perdido', async ({ browser }) => {
  mkdirSync(SALIDA, { recursive: true });
  const d = await sembrarOperacionE2E();
  const correo = correoUnico('paqc');
  const socioId = await altaUsuario({ correo, socio: 'Javier' });
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [socioId]);
    const k = `cap-pq:${d.sufijo}`;
    const pedido = async (n: string, piezas: number, guia: string, costo: number) => {
      const p = await c.query("select (operacion.crear_pedido($1,$2,$3::jsonb,'bodega_omar',null,0,0,0)->>'pedido_id')::bigint as id", [`${k}:p${n}`, d.clienteId, JSON.stringify([{ modelo: d.modeloA, sabor: n === 'c' ? 'Fresa' : 'Mango', piezas }])]);
      const id = Number(p.rows[0].id);
      await c.query('select operacion.confirmar_pedido($1,$2)', [`${k}:pc${n}`, id]);
      await c.query("select operacion.enviar_pedido($1,$2,null,$3::jsonb,negocio.hoy(),true)", [`${k}:pe${n}`, id, JSON.stringify({ paqueteria: 'Castores', numero: guia, costo_cent: costo })]);
      return id;
    };
    const lin = async (id: number, n: number) => JSON.stringify([{ linea_id: Number((await c.query('select id from operacion.pedido_linea where pedido_id = $1', [id])).rows[0].id), piezas: n }]);
    const inc = async (clave: string, id: number, tipo: string, n: number, detalle: string) =>
      Number((await c.query("select (operacion.reportar_paquete_salida($1,$2,$3,$4,$5::jsonb)->>'incidente_id')::bigint as i", [clave, id, tipo, detalle, await lin(id, n)])).rows[0].i);
    const pa = await pedido('a', 20, 'CAP-G1', 18000); const pb = await pedido('b', 14, 'CAP-G2', 15000); const pc = await pedido('c', 16, 'CAP-G3', 12000); const pd = await pedido('d', 10, 'CAP-G4', 14000);
    await inc(`${k}:ia`, pa, 'perdido', 6, 'La paquetería no encuentra la caja');
    const ib = await inc(`${k}:ib`, pb, 'danado', 4, 'Llegó mojada');
    const ic = await inc(`${k}:ic`, pc, 'perdido', 3, 'Extraviada en la ruta');
    const id2 = await inc(`${k}:id`, pd, 'perdido', 5, 'Se entregó en otra dirección');
    await c.query("select operacion.resolver_paquete_incidente($1,$2,'sociedad',null,'bonificar','La sociedad absorbe la pérdida')", [`${k}:rb`, ib]);
    await c.query("select operacion.resolver_paquete_incidente($1,$2,'sociedad',null,'reponer','Se repone con envío nuevo',$3::jsonb)", [`${k}:rc`, ic, JSON.stringify({ paqueteria: 'Castores', numero: 'CAP-R1', costo_cent: 9000 })]);
    await c.query("select operacion.resolver_paquete_incidente($1,$2,'socio','Angelo','bonificar','Angelo capturó mal la dirección')", [`${k}:rd`, id2]);
    const oc = async (n: string, sabor: string, pz: number) => {
      const o = await c.query("select (operacion.crear_compra($1,'Isaac',$2::jsonb)->>'compra_id')::bigint as id", [`${k}:o${n}`, JSON.stringify([{ modelo: d.modeloA, sabor, pagadas: pz }])]);
      const id = Number(o.rows[0].id);
      await c.query('select operacion.confirmar_compra($1,$2)', [`${k}:oc${n}`, id]);
      await c.query("select operacion.registrar_guia_compra($1,$2,'Castores',$3)", [`${k}:og${n}`, id, `CAP-E${n}`]);
      return id;
    };
    const o1 = await oc('1', 'Fresa', 40); const o2 = await oc('2', 'Mango', 30); const o3 = await oc('3', 'Fresa', 25); await oc('4', 'Mango', 60);
    await c.query("select operacion.reportar_paquete_entrada($1,$2,'perdido','La caja nunca llegó a Mérida','[]'::jsonb)", [`${k}:e1`, o1]);
    await c.query("select operacion.reportar_paquete_entrada($1,$2,'danado','Llegaron 12 piezas mojadas',$3::jsonb)", [`${k}:e2`, o2, JSON.stringify([{ linea_id: Number((await c.query('select id from operacion.compra_linea where compra_id = $1', [o2])).rows[0].id), sabor: 'Mango', piezas: 18 }])]);
    await c.query("select operacion.reportar_paquete_entrada($1,$2,'perdido','Extraviada por la paquetería','[]'::jsonb)", [`${k}:e3`, o3]);
    const i2 = Number((await c.query('select id from operacion.paquete_incidente where compra_id = $1', [o2])).rows[0].id);
    const i3 = Number((await c.query('select id from operacion.paquete_incidente where compra_id = $1', [o3])).rows[0].id);
    await c.query("select operacion.resolver_paquete_incidente($1,$2,'sociedad',null,null,'Pérdida absorbida por la sociedad')", [`${k}:re2`, i2]);
    await c.query("select operacion.resolver_paquete_incidente($1,$2,'proveedor',null,null,'Reclamo abierto con el proveedor')", [`${k}:re3`, i3]);
    await c.query('commit');
  });
  const omar = correoUnico('paqo');
  await altaUsuario({ correo: omar, rol: 'omar' });

  const abrirSesion = async (mail: string, destino: string) => {
    const entrada = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() } });
    const p0 = await entrada.newPage();
    await p0.goto(BASE + (await enlaceConfirmacion(mail, destino)));
    await p0.getByTestId('confirmar-acceso').click();
    await p0.waitForURL((u) => !u.pathname.startsWith('/auth/'));
    const estado = await entrada.storageState();
    await entrada.close();
    return estado;
  };
  const estadoSocio = await abrirSesion(correo, '/paquetes/por-hacer');
  const estadoOmar = await abrirSesion(omar, '/mi-bodega/paquetes');
  const rutas: [string, string, typeof estadoSocio][] = [['por-hacer', '/paquetes/por-hacer', estadoSocio], ['en-trayecto', '/paquetes/en-trayecto', estadoSocio], ['mi-bodega-paquetes', '/mi-bodega/paquetes', estadoOmar]];
  const informe: string[] = [];
  for (const p of PERFILES) {
    for (const tema of TEMAS) {
      for (const [nombre, ruta, estado] of rutas) {
        const ctx = await browser.newContext({
          viewport: { width: p.ancho, height: p.alto }, deviceScaleFactor: p.movil ? 2 : 1, isMobile: p.movil, hasTouch: p.movil,
          colorScheme: tema === 'oscuro' ? 'dark' : 'light', reducedMotion: 'reduce', extraHTTPHeaders: { 'x-forwarded-for': ipFalsa() }, storageState: estado,
        });
        await ctx.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); localStorage.setItem('rtm-acento', 'neutro'); localStorage.setItem('rtm-movimiento', 'off'); } catch { /* sin almacenamiento */ } }, tema);
        const page: Page = await ctx.newPage();
        await page.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (p.movil && desborde > 1) informe.push(`DESBORDE ${nombre} ${tema} ${p.nombre}: ${desborde}px`);
        const alto = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight).map((e) => e.scrollHeight)));
        await page.setViewportSize({ width: p.ancho, height: Math.min(Math.max(alto + 120, p.alto), 7000) });
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(SALIDA, `${p.nombre}-${tema}-${nombre}.png`) });
        await ctx.close();
      }
    }
  }
  writeFileSync(join(SALIDA, '.desbordes.txt'), informe.join('\n') + '\n');
});
