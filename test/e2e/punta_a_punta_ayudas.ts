// Ayudas compartidas de la campaña de punta a punta. Solo datos SINTETICOS ("QA PaP ..."); nada real. ESCRITAS Y TIPADAS, NO EJECUTADAS.
import { expect, type Page, type TestInfo } from '@playwright/test';
import { altaUsuario, conDb, consultar, correoUnico, entrarComo, ipFalsa, sembrarCuentasE2E, compraBorradorE2E, type DatosF3a } from './ayudas';

export type Tema = 'claro' | 'oscuro';
export const TEMAS: readonly Tema[] = ['claro', 'oscuro'];

/** Fija el tema ANTES de que cargue cualquier pagina (el script bloqueante lee localStorage `rtm-tema`). */
export async function fijarTema(page: Page, tema: Tema): Promise<void> {
  await page.addInitScript((t) => { try { localStorage.setItem('rtm-tema', t); } catch { /* sin almacenamiento: la visita usa el tema del sistema */ } }, tema);
}

/** Sesion de un socio por el plan alterno (token_hash). Devuelve el correo usado. */
export async function sesionSocio(page: Page, ruta: string, socio: 'Angelo' | 'Javier' = 'Javier'): Promise<string> {
  const correo = correoUnico('pap');
  await altaUsuario({ correo, socio });
  await entrarComo(page, correo, ruta);
  return correo;
}

export { ipFalsa, consultar, conDb, altaUsuario, correoUnico, entrarComo };

/** Captura de evidencia: test-results/punta-a-punta/<proyecto>/<tema>/<nombre>.png (la carpeta esta en .gitignore). */
export async function capturar(page: Page, info: TestInfo, tema: Tema | 'sin-tema', nombre: string): Promise<void> {
  const limpio = nombre.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  const ruta = info.outputPath(`${info.project.name}__${tema}__${limpio}.png`);
  await page.screenshot({ path: ruta, fullPage: true });
  await info.attach(`${tema}-${limpio}`, { path: ruta, contentType: 'image/png' });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Siembra del flujo de demostracion QA (cifras a mano de qa/01-inventario-y-matriz.md, flujos F01 a F13)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DatosQA extends DatosF3a { compraId: number; modeloId: number }

/** Reutiliza la siembra de F3a (cliente, modelos A y B, existencias 100 Fresa + 60 Mango, saldo a favor con Karen, pedidos de bodega, vencido y directo,
 *  una toma de Omar) y agrega una orden de compra en borrador a Karen. Sufijo propio por corrida. */
export async function sembrarQA(): Promise<DatosQA> {
  const d = await sembrarCuentasE2E();
  const compraId = await compraBorradorE2E(d, 'qa');
  const modeloId = Number((await consultar<{ id: string }>('select id from catalogo.modelo where nombre_canonico = $1', [d.modeloA]))[0]!.id);
  return { ...d, compraId, modeloId };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rutas del socio (22) y publicas (6)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface RutaQA { id: string; ruta: string; titulo: RegExp; vacia?: boolean }

export function rutasSocio(d: DatosQA): RutaQA[] {
  return [
    { id: 'R07-inicio', ruta: '/', titulo: /Inicio|bodega|Primeros pasos/i },
    { id: 'R08-pedidos', ruta: '/pedidos', titulo: /Pedidos/i },
    { id: 'R09-pedido-nuevo', ruta: `/pedidos/nuevo?cliente=${d.clienteId}`, titulo: /Nuevo pedido/i },
    { id: 'R10-pedido', ruta: `/pedidos/${d.pedidoBodegaId}`, titulo: /P-\d{4}/ },
    { id: 'R12-por-hacer', ruta: '/paquetes/por-hacer', titulo: /Paquetes por hacer/i },
    { id: 'R13-en-trayecto', ruta: '/paquetes/en-trayecto', titulo: /en trayecto/i },
    { id: 'R14-cxc', ruta: '/cuentas-por-cobrar', titulo: /Cuentas por cobrar/i },
    { id: 'R15-catalogo', ruta: '/catalogo', titulo: /Cat[aá]logo/i },
    { id: 'R15b-catalogo-modelo', ruta: `/catalogo?modelo=${d.modeloId}`, titulo: /Cat[aá]logo/i },
    { id: 'R16-clientes', ruta: '/clientes', titulo: /Clientes/i },
    { id: 'R17-cliente', ruta: `/clientes/${d.clienteId}`, titulo: new RegExp(d.cliente) },
    { id: 'R18-inventario', ruta: '/inventario', titulo: /Inventario/i },
    { id: 'R19-proveedores-isaac', ruta: '/proveedores?p=Isaac', titulo: /Proveedores|Isaac/i },
    { id: 'R19b-proveedores-karen', ruta: '/proveedores?p=Karen', titulo: /Proveedores|Karen/i },
    { id: 'R20-compra-nueva', ruta: '/proveedores/compras/nueva?p=Karen', titulo: /Nueva orden|orden de compra/i },
    { id: 'R21-compra', ruta: `/proveedores/compras/${d.compraId}`, titulo: /OC-|orden/i },
    { id: 'R22-liquidacion', ruta: '/proveedores/liquidacion?p=Isaac', titulo: /Liquidaci[oó]n|Hoja/i },
    { id: 'R23-socios', ruta: '/socios', titulo: /socios/i },
    { id: 'R24-socio-angelo', ruta: '/socios/Angelo', titulo: /Angelo/ },
    { id: 'R24b-socio-javier', ruta: '/socios/Javier', titulo: /Javier/ },
    { id: 'R25-cascada', ruta: '/socios/cascada', titulo: /Cascada|reparto/i },
    { id: 'R26-omar', ruta: '/omar', titulo: /Omar/ },
    { id: 'R27-avisos', ruta: '/avisos', titulo: /Avisos/i },
    { id: 'R28-diseno', ruta: '/diseno', titulo: /Dise[nñ]o|acento/i },
    { id: 'R29-diseno-graficas', ruta: '/diseno/graficas', titulo: /Gr[aá]ficas/i },
  ];
}

export const RUTAS_PUBLICAS: readonly { id: string; ruta: string }[] = [
  { id: 'R01-login', ruta: '/login' },
  { id: 'R05-privacidad', ruta: '/privacidad' },
  { id: 'R06-terminos', ruta: '/terminos' },
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Mediciones dentro de la pagina (T08, T09, H-42 a H-61)
// ---------------------------------------------------------------------------------------------------------------------------------
export async function sinScrollHorizontal(page: Page): Promise<void> {
  const r = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, body: document.body.scrollWidth - window.innerWidth }));
  expect(r.doc, 'scroll horizontal del documento').toBeLessThanOrEqual(1);
  expect(r.body, 'scroll horizontal del cuerpo').toBeLessThanOrEqual(1);
}

/** Botones, chips y enlaces de tabla de la zona principal: altura minima 44 px (se toleran 43.5 por redondeo). Solo en pantallas tactiles. */
export async function objetivosDe44(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main .rtm-boton, main .rtm-chip-filtro, main .rtm-cifra, main .rtm-dt-celda a, main button[type=submit], main .rtm-segmentado a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 43.5) mal.push(`${(el.textContent ?? '').trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return mal;
  });
}

/** Campos visibles con letra menor de 16 px (provoca zoom automatico en iPhone). */
export async function camposChicos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main input, main select, main textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 16) mal.push(`${el.tagName.toLowerCase()}[${el.getAttribute('name') ?? el.getAttribute('data-testid') ?? ''}] ${px}px`);
    }
    return mal;
  });
}

export interface FallaContraste { texto: string; razon: number; minimo: number; fg: string; bg: string }

/** Contraste WCAG real (getComputedStyle) de cada texto visible contra su primer fondo opaco. Umbral 4.5 (3 si es texto grande: >= 24 px o >= 18.66 px en negrita). */
export async function contrasteDeTextos(page: Page): Promise<FallaContraste[]> {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 1];
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const lum = (r: number, g: number, b: number) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fondo = (el: Element | null): [number, number, number] => {
      let acum: [number, number, number] = [255, 255, 255];
      const capas: [number, number, number, number][] = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) capas.push(c);
        if (c[3] >= 1) break;
      }
      for (const c of capas.reverse()) acum = [c[0] * c[3] + acum[0] * (1 - c[3]), c[1] * c[3] + acum[1] * (1 - c[3]), c[2] * c[3] + acum[2] * (1 - c[3])];
      return acum;
    };
    const fallas: { texto: string; razon: number; minimo: number; fg: string; bg: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vistos = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || vistos.has(el) || !(n.textContent ?? '').trim()) continue;
      vistos.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"], script, style, noscript, svg')) continue;
      const fg = parse(cs.color);
      const bg = fondo(el);
      const fgm: [number, number, number] = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
      const l1 = lum(...fgm);
      const l2 = lum(...bg);
      const razon = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const grande = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      if (razon + 0.01 < minimo) fallas.push({ texto: (n.textContent ?? '').trim().slice(0, 40), razon: Math.round(razon * 100) / 100, minimo, fg: cs.color, bg: `rgb(${bg.map(Math.round).join(',')})` });
    }
    return fallas;
  });
}

/** Contraste del contorno de los campos (WCAG 1.4.11 pide 3:1). H-53: hoy falla en claro (1.44:1) y en oscuro (1.57:1). */
export async function contrasteDeBordesDeCampo(page: Page): Promise<{ campo: string; razon: number }[]> {
  return page.evaluate(() => {
    const parse = (c: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return [0, 0, 0, 1];
      const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    };
    const lum = (c: [number, number, number, number]) => {
      const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const fondoOpaco = (el: Element | null): [number, number, number, number] => {
      for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] >= 1) return c; }
      return [255, 255, 255, 1];
    };
    const mal: { campo: string; razon: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main input:not([type=hidden]), main select, main textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopWidth) === 0) continue;
      const borde = parse(cs.borderTopColor);
      const bg = fondoOpaco(el.parentElement);
      const l1 = lum(borde);
      const l2 = lum(bg);
      const razon = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (razon + 0.01 < 3) mal.push({ campo: el.getAttribute('data-testid') ?? el.getAttribute('name') ?? el.tagName, razon: Math.round(razon * 100) / 100 });
    }
    return mal;
  });
}

/** Heuristica de espacio muerto (H-42 a H-48): bloques de la zona principal con mas de 160 px de alto vacio por debajo de su ultimo hijo visible. */
export async function huecosMuertos(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const mal: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('main section, main .rtm-bloque, main .rtm-tarjeta, main form')) {
      const r = el.getBoundingClientRect();
      if (r.height < 200 || r.width === 0) continue;
      let fondo = r.top;
      for (const h of Array.from(el.children)) { const b = h.getBoundingClientRect(); if (b.height > 0) fondo = Math.max(fondo, b.bottom); }
      if (r.bottom - fondo > 160) mal.push(`${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} hueco ${Math.round(r.bottom - fondo)} px`);
    }
    return mal;
  });
}

/** Errores de consola y de pagina durante la navegacion (React #418 de hidratacion incluido). */
export function vigilarErrores(page: Page): { errores: string[] } {
  const estado = { errores: [] as string[] };
  page.on('pageerror', (e) => estado.errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') estado.errores.push(`console: ${m.text()}`); });
  return estado;
}

export async function dialogoCabeEnPantalla(page: Page): Promise<void> {
  const caja = await page.getByRole('dialog').boundingBox();
  const vp = page.viewportSize();
  expect(caja, 'el dialogo existe').not.toBeNull();
  expect(caja!.x, 'dialogo: borde izquierdo').toBeGreaterThanOrEqual(-1);
  expect(caja!.x + caja!.width, 'dialogo: borde derecho').toBeLessThanOrEqual(vp!.width + 1);
  expect(caja!.y, 'dialogo: borde superior').toBeGreaterThanOrEqual(-1);
}

/** Cuenta los eventos de un tipo (segunda via por SQL para el doble clic y la idempotencia). */
export async function contarEventos(tipo: string): Promise<number> {
  return Number((await consultar<{ n: string }>('select count(*)::int as n from operacion.evento where tipo = $1', [tipo]))[0]!.n);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Semilla de los flujos F01 a F13 (qa/01-inventario-y-matriz.md, 3.0): modelo con Fresa y Uva, 200 piezas a costo puesto 102.25
// (20,450.00 en total), Isaac 100.00, Karen 110.00 supuesto, cliente con precio 150.00. Sufijo propio por corrida.
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DatosFlujos { sufijo: string; marca: string; modelo: string; modeloId: number; cliente: string; clienteId: number; pagador: string; pagadorId: number }

export async function sembrarFlujosQA(): Promise<DatosFlujos> {
  const sufijo = Date.now().toString(36);
  const marca = 'QA PaP Marca';
  const modelo = `QA PaP Modelo 50K ${sufijo}`;
  const cliente = `QA PaP Cliente 1 ${sufijo}`;
  const pagador = `QA PaP Pagador ${sufijo}`;
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [`QA PaP Omar ${sufijo}`]);
    await c.query('select catalogo.asegurar_persona_bodega($1,$1)', [`QA PaP Omar ${sufijo}`]);
    await c.query("select catalogo.asegurar_cliente($1,'Angelo')", [cliente]);
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [pagador]);
    await c.query("select catalogo.asegurar_modelo($1,$2,50000,'ambas')", [marca, modelo]);
    for (const s of ['Fresa', 'Uva']) await c.query('select catalogo.asegurar_sku($1,$2)', [modelo, s]);
    await c.query("select catalogo.fijar_costo($1,'Isaac',$2,10000,negocio.hoy() - 30,'qa')", [`qa:ci:${sufijo}`, modelo]);
    await c.query("select catalogo.fijar_costo($1,'Karen',$2,11000,negocio.hoy() - 30,'qa',null,true)", [`qa:ck:${sufijo}`, modelo]);
    await c.query("select catalogo.fijar_precio($1,$2,$3,15000,negocio.hoy() - 30,'chat')", [`qa:p:${sufijo}`, cliente, modelo]);
    // 100 Fresa + 100 Uva con costo puesto 102.25 = 1,022,500 centavos por sabor.
    await c.query("select operacion.registrar_movimiento($1,$2,'Fresa','bodega_omar','entrada_compra',100,1022500,negocio.hoy() - 20,'Entrada de la semilla QA')", [`qa:m1:${sufijo}`, modelo]);
    await c.query("select operacion.registrar_movimiento($1,$2,'Uva','bodega_omar','entrada_compra',100,1022500,negocio.hoy() - 20,'Entrada de la semilla QA')", [`qa:m2:${sufijo}`, modelo]);
    const ids = await c.query('select (select id from catalogo.cliente where nombre_canonico = $1) as c, (select id from catalogo.cliente where nombre_canonico = $2) as p, (select id from catalogo.modelo where nombre_canonico = $3) as m', [cliente, pagador, modelo]);
    await c.query('commit');
    return { sufijo, marca, modelo, modeloId: Number(ids.rows[0].m), cliente, clienteId: Number(ids.rows[0].c), pagador, pagadorId: Number(ids.rows[0].p) };
  });
}

/** Saldo, piezas y valor desde la base: la "segunda via" de cada flujo. */
export async function piezasYValor(modelo: string): Promise<{ piezas: number; valor: bigint }> {
  const r = await consultar<{ piezas: number; valor: string }>('select e.piezas::int as piezas, e.valor_cent::text as valor from operacion.existencia_modelo e join catalogo.modelo m on m.id = e.modelo_id where m.nombre_canonico = $1', [modelo]);
  return r.length === 0 ? { piezas: 0, valor: 0n } : { piezas: r[0]!.piezas, valor: BigInt(r[0]!.valor) };
}

export async function saldoProveedor(nombre: 'Isaac' | 'Karen'): Promise<bigint> {
  return BigInt((await consultar<{ s: string }>('select operacion.saldo_proveedor(catalogo.proveedor_id($1))::text as s', [nombre]))[0]!.s);
}

export async function saldoSocio(nombre: 'Angelo' | 'Javier', aplicaA: string | null = null): Promise<bigint> {
  return BigInt((await consultar<{ s: string }>('select operacion.saldo_socio(id, $2)::text as s from catalogo.socio where nombre = $1', [nombre, aplicaA]))[0]!.s);
}

export async function reembolsoPendiente(nombre: 'Angelo' | 'Javier'): Promise<bigint> {
  return BigInt((await consultar<{ s: string }>('select operacion.reembolso_pendiente(id)::text as s from catalogo.socio where nombre = $1', [nombre]))[0]!.s);
}
