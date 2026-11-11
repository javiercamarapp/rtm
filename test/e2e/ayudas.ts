// Ayudas de las pruebas contra el Supabase local. Solo local: usan las llaves de `supabase status` (no se versionan ni se imprimen).
// Todos los correos son ficticios (@example.test).
import { execFileSync } from 'node:child_process';
import pg from 'pg';

export interface EstadoSupabase {
  API_URL: string;
  DB_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  MAILPIT_URL: string;
}

let cache: EstadoSupabase | null = null;
export function estado(): EstadoSupabase {
  if (!cache) {
    cache = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as EstadoSupabase;
  }
  return cache;
}

export async function conDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: estado().DB_URL });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export const DOMINIO = '@example.test';
let contador = 0;
export function correoUnico(prefijo: string): string {
  contador += 1;
  return `${prefijo}.${Date.now().toString(36)}${contador}${DOMINIO}`;
}

/** IP falsa distinta por prueba: el limite por IP no debe contaminar a las demas pruebas. */
export function ipFalsa(): string {
  return `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
}

export async function altaUsuario(opts: { correo: string; rol?: 'socio' | 'omar'; socio?: 'Angelo' | 'Javier'; activo?: boolean }): Promise<string> {
  const rol = opts.rol ?? 'socio';
  const socio = rol === 'socio' ? (opts.socio ?? 'Angelo') : null;
  const activo = opts.activo ?? true;
  await conDb((c) => c.query('insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ($1,$2,$3,$4) on conflict (correo) do nothing', [opts.correo, rol, socio, activo]));
  const e = estado();
  const r = await fetch(`${e.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: opts.correo, email_confirm: true }),
  });
  if (!r.ok) throw new Error(`alta de usuario fallo: ${r.status}`);
  const u = (await r.json()) as { id: string };
  return u.id;
}

export async function contarUsuariosAuth(): Promise<number> {
  return conDb(async (c) => Number((await c.query('select count(*)::int as n from auth.users')).rows[0].n));
}

interface ResumenCorreo { ID: string; To: { Address: string }[]; Subject: string }

export async function limpiarBuzon(): Promise<void> {
  await fetch(`${estado().MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

export async function mensajesPara(correo: string): Promise<ResumenCorreo[]> {
  const r = await fetch(`${estado().MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${correo}`)}`);
  const j = (await r.json()) as { messages?: ResumenCorreo[] };
  return j.messages ?? [];
}

export async function esperarMensajes(correo: string, cuantos: number, msMax = 15_000): Promise<ResumenCorreo[]> {
  const fin = Date.now() + msMax;
  for (;;) {
    const m = await mensajesPara(correo);
    if (m.length >= cuantos || Date.now() > fin) return m;
    await new Promise((res) => setTimeout(res, 250));
  }
}

/** Enlace de verificacion del correo mas reciente (o del indice dado, 0 = el mas reciente). */
export async function enlaceDe(correo: string, indice = 0): Promise<string> {
  const msgs = await mensajesPara(correo);
  const m = msgs[indice];
  if (!m) throw new Error('sin mensaje para el correo de prueba');
  const r = await fetch(`${estado().MAILPIT_URL}/api/v1/message/${m.ID}`);
  const j = (await r.json()) as { Text?: string; HTML?: string };
  const cuerpo = `${j.Text ?? ''}\n${j.HTML ?? ''}`.replace(/&amp;/g, '&');
  const hit = /https?:\/\/[^\s"'<>)]*\/auth\/v1\/verify[^\s"'<>)]*/.exec(cuerpo);
  if (!hit) throw new Error('el correo no trae enlace de verificacion');
  return hit[0];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// F1: enlace por token_hash (plan alterno) y datos ILUSTRATIVOS de prueba que la propia prueba crea y limpia.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Enlace de /auth/confirm con token_hash, generado por la API de administracion LOCAL (sin correo). Es el enlace del plan alterno. */
export async function enlaceConfirmacion(correo: string, next = '/catalogo'): Promise<string> {
  const e = estado();
  const r = await fetch(`${e.API_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: e.SERVICE_ROLE_KEY, authorization: `Bearer ${e.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: correo }),
  });
  if (!r.ok) throw new Error(`generate_link fallo: ${r.status}`);
  const j = (await r.json()) as { hashed_token?: string; properties?: { hashed_token?: string } };
  const token = j.hashed_token ?? j.properties?.hashed_token;
  if (!token) throw new Error('generate_link no devolvio token_hash');
  return `/auth/confirm?token_hash=${encodeURIComponent(token)}&type=magiclink&next=${encodeURIComponent(next)}`;
}

const PREFIJO = 'E2E Prueba';
export interface DatosE2E { clienteId: number; cliente: string; modelo: string; modeloId: number }

/** Crea un cliente, un modelo, costos y dos precios (para tener historial) con nombres claramente ficticios. */
export async function sembrarCatalogoE2E(): Promise<DatosE2E> {
  const modelo = `${PREFIJO} Modelo 50K`;
  const cliente = `${PREFIJO} Cliente`;
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_modelo($1,$2,50000,'angelo')", [`${PREFIJO} Marca`, modelo]);
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [cliente]);
    await c.query("select catalogo.fijar_costo('e2e:c1','Isaac',$1,20000,'2026-11-01','e2e')", [modelo]);
    await c.query("select catalogo.fijar_costo('e2e:c2','Karen',$1,15000,'2026-11-01','e2e',null,true)", [modelo]);
    await c.query("select catalogo.fijar_precio('e2e:p1',$1,$2,24000,'2026-11-01','chat')", [cliente, modelo]);
    await c.query("select catalogo.fijar_precio('e2e:p2',$1,$2,26000,'2026-11-08','chat')", [cliente, modelo]);
    const ids = await c.query('select (select id from catalogo.cliente where nombre_canonico = $1) as c, (select id from catalogo.modelo where nombre_canonico = $2) as m', [cliente, modelo]);
    await c.query('commit');
    return { clienteId: Number(ids.rows[0].c), cliente, modelo, modeloId: Number(ids.rows[0].m) };
  });
}

export async function limpiarCatalogoE2E(): Promise<void> {
  await conDb(async (c) => {
    await c.query('begin');
    const m = `${PREFIJO}%`;
    await c.query('delete from catalogo.precio_historico_externo where cliente_id in (select id from catalogo.cliente where nombre_canonico like $1)', [m]);
    await c.query('delete from catalogo.tabulador_precio where cliente_id in (select id from catalogo.cliente where nombre_canonico like $1)', [m]);
    await c.query('delete from catalogo.costo_proveedor where modelo_id in (select id from catalogo.modelo where nombre_canonico like $1)', [m]);
    await c.query('delete from catalogo.cliente_alias where cliente_id in (select id from catalogo.cliente where nombre_canonico like $1)', [m]);
    await c.query('delete from catalogo.cliente where nombre_canonico like $1', [m]);
    await c.query('delete from catalogo.modelo_alias where modelo_id in (select id from catalogo.modelo where nombre_canonico like $1)', [m]);
    await c.query('delete from catalogo.sku where modelo_id in (select id from catalogo.modelo where nombre_canonico like $1)', [m]);
    await c.query('delete from catalogo.modelo where nombre_canonico like $1', [m]);
    await c.query('delete from catalogo.marca where nombre like $1', [m]);
    await c.query("delete from seguridad.operacion where clave like 'e2e:%'");
    await c.query('commit');
  });
}

/** Entra por el plan alterno (token_hash + boton) y espera la ruta destino. */
export async function entrarComo(page: import('@playwright/test').Page, correo: string, destino: string): Promise<void> {
  await page.goto(await enlaceConfirmacion(correo, destino));
  await page.getByTestId('confirmar-acceso').click();
  await page.waitForURL(`**${destino.split('?')[0]}**`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// F2: datos ILUSTRATIVOS de operacion (modelos, cliente, existencias y un pago redirigido a Karen). Los hechos de negocio son de solo
// insercion y no se pueden borrar: cada corrida usa un sufijo propio ("E2E F2 ... <sufijo>") y `verificar` reinicia la base antes y despues.
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DatosF2 {
  sufijo: string; cliente: string; clienteId: number; pagador: string; modeloA: string; modeloB: string; marca: string;
}

export async function sembrarOperacionE2E(): Promise<DatosF2> {
  const sufijo = Date.now().toString(36);
  const marca = 'E2E F2 Marca';
  const modeloA = `E2E F2 Alfa ${sufijo}`;
  const modeloB = `E2E F2 Beta ${sufijo}`;
  const cliente = `E2E F2 Cliente ${sufijo}`;
  const pagador = `E2E F2 Pagador ${sufijo}`;
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [`E2E F2 Omar ${sufijo}`]);
    await c.query('select catalogo.asegurar_persona_bodega($1,$1)', [`E2E F2 Omar ${sufijo}`]);
    await c.query("select catalogo.asegurar_cliente($1,'Angelo')", [cliente]);
    await c.query("select catalogo.asegurar_cliente($1,'Javier')", [pagador]);
    await c.query("select catalogo.asegurar_modelo($1,$2,50000,'ambas')", [marca, modeloA]);
    await c.query("select catalogo.asegurar_modelo($1,$2,15000,'ambas')", [marca, modeloB]);
    for (const s of ['Fresa', 'Mango']) await c.query('select catalogo.asegurar_sku($1,$2)', [modeloA, s]);
    await c.query('select catalogo.asegurar_sku($1,$2)', [modeloB, 'Uva']);
    await c.query("select catalogo.fijar_costo($1,'Isaac',$2,10000,'2026-11-01','e2e')", [`e2e2:ci:${sufijo}`, modeloA]);
    await c.query("select catalogo.fijar_costo($1,'Karen',$2,11000,'2026-11-01','e2e')", [`e2e2:ck:${sufijo}`, modeloB]);
    await c.query("select catalogo.fijar_costo($1,'Isaac',$2,12000,'2026-11-01','e2e')", [`e2e2:cib:${sufijo}`, modeloB]);
    await c.query("select catalogo.fijar_precio($1,$2,$3,15000,'2026-11-01','chat')", [`e2e2:p:${sufijo}`, cliente, modeloA]);
    await c.query("select operacion.registrar_movimiento($1,$2,'Fresa','bodega_omar','entrada_compra',100,1000000,negocio.hoy(),'Entrada ilustrativa')", [`e2e2:m1:${sufijo}`, modeloA]);
    await c.query("select operacion.registrar_movimiento($1,$2,'Mango','bodega_omar','entrada_compra',60,600000,negocio.hoy(),'Entrada ilustrativa')", [`e2e2:m2:${sufijo}`, modeloA]);
    // Un cliente le manda 30,500 directo a Karen: saldo a favor de la sociedad con ese proveedor.
    const id = await c.query('select id from catalogo.cliente where nombre_canonico = $1', [pagador]);
    await c.query("select operacion.registrar_pago($1,'Karen',3050000,$2,null,false,'anticipo',negocio.hoy(),null,'Pago ilustrativo redirigido a Karen')", [`e2e2:pk:${sufijo}`, Number(id.rows[0].id)]);
    const cid = await c.query('select id from catalogo.cliente where nombre_canonico = $1', [cliente]);
    await c.query('commit');
    return { sufijo, cliente, clienteId: Number(cid.rows[0].id), pagador, modeloA, modeloB, marca };
  });
}

export async function consultar<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  return conDb(async (c) => (await c.query(sql, args)).rows as T[]);
}

/** Crea y confirma un pedido por la via de importacion (para probar Paquetes por hacer sin pasar otra vez por el formulario). */
export async function pedidoConfirmadoE2E(d: DatosF2, piezas: number, clave: string): Promise<number> {
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const r = await c.query("select (operacion.crear_pedido($1,$2,$3::jsonb,'bodega_omar',null,0,0,0)->>'pedido_id')::bigint as id", [`e2e2:${clave}:${d.sufijo}`, d.clienteId, JSON.stringify([{ modelo: d.modeloA, sabor: 'Mango', piezas }])]);
    const id = Number(r.rows[0].id);
    await c.query('select operacion.confirmar_pedido($1,$2)', [`e2e2:${clave}c:${d.sufijo}`, id]);
    await c.query('commit');
    return id;
  });
}

/** Una orden de compra en borrador a Karen (por la via de importacion) para recorrer su pantalla en movil. */
export async function compraBorradorE2E(d: DatosF2, clave: string): Promise<number> {
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const r = await c.query("select (operacion.crear_compra($1,'Karen',$2::jsonb)->>'compra_id')::bigint as id", [`e2e2:oc-${clave}:${d.sufijo}`, JSON.stringify([{ modelo: d.modeloB, sabor: 'Uva', pagadas: 120 }])]);
    await c.query('commit');
    return Number(r.rows[0].id);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// F3a: cuentas con proveedores, socios y Omar. Datos ILUSTRATIVOS encima de los de F2 (renta, toma, pedidos directos de Isaac y un saldo vencido).
// ---------------------------------------------------------------------------------------------------------------------------------
export interface DatosF3a extends DatosF2 { pedidoBodegaId: number; pedidoVencidoId: number; pedidoDirectoId: number; folioDirecto: string }

export async function sembrarCuentasE2E(): Promise<DatosF3a> {
  const d = await sembrarOperacionE2E();
  const s = d.sufijo;
  return conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    const ped = async (clave: string, origen: string, piezas: number, fecha: string, plazo: number | null, guia: object | null) => {
      const r = await c.query("select (operacion.crear_pedido($1,$2,$3::jsonb,$4,null,0,0,0,$5::date,null,$6)->>'pedido_id')::bigint as id", [`e2e3:${clave}:${s}`, d.clienteId, JSON.stringify([{ modelo: d.modeloA, sabor: 'Mango', piezas, precio_cent: 15000, motivo_precio: 'prueba' }]), origen, fecha, plazo]);
      const id = Number(r.rows[0].id);
      await c.query('select operacion.confirmar_pedido($1,$2)', [`e2e3:${clave}c:${s}`, id]);
      await c.query('select operacion.enviar_pedido($1,$2,null,$3::jsonb,$4::date,true)', [`e2e3:${clave}s:${s}`, id, guia ? JSON.stringify(guia) : null, fecha]);
      return id;
    };
    const hoy = (await c.query('select negocio.hoy()::text as h')).rows[0].h as string;
    const hace10 = (await c.query("select (negocio.hoy() - 8)::text as h")).rows[0].h as string;
    const pedidoBodegaId = await ped('bod', 'bodega_omar', 30, hoy, null, null);
    const pedidoVencidoId = await ped('venc', 'isaac_directo', 25, hace10, 5, { paqueteria: 'Castores', numero: `E2E3-V-${s}`, costo_cent: 18000 });
    const pedidoDirectoId = await ped('dir', 'isaac_directo', 40, hoy, null, { paqueteria: 'Castores', numero: `E2E3-D-${s}`, costo_cent: 30700 });
    await c.query("select operacion.registrar_toma_omar($1,$2::jsonb,2,15000,negocio.hoy())", [`e2e3:toma:${s}`, JSON.stringify({ modelo: d.modeloA, sabor: 'Fresa' })]);
    const folio = (await c.query('select folio from operacion.pedido where id = $1', [pedidoDirectoId])).rows[0].folio as string;
    await c.query('commit');
    return { ...d, pedidoBodegaId, pedidoVencidoId, pedidoDirectoId, folioDirecto: folio };
  });
}

// F3b-2
/** Dos modelos ILUSTRATIVOS con 40 dias de historia: uno que se acaba (Urge pedir) y uno con mucho (Sobrestock). */
export async function sembrarInventarioE2E(SUF: string): Promise<void> {
  const URGE = `E2E Inv Urge ${SUF}`;
  const SOBRE = `E2E Inv Sobre ${SUF}`;
  await conDb(async (c) => {
    await c.query('begin');
    await c.query("select set_config('rtm.canal', 'importacion', true)");
    for (const m of [URGE, SOBRE]) {
      await c.query("select catalogo.asegurar_modelo('E2E Inv Marca', $1, 50000, 'ambas')", [m]);
      for (const s of ['Fresa', 'Mango']) await c.query('select catalogo.asegurar_sku($1,$2)', [m, s]);
    }
    for (const [m, cant, valor] of [[URGE, 100, 1000000], [SOBRE, 400, 4000000]] as const) {
      for (const s of ['Fresa', 'Mango']) await c.query("select operacion.registrar_movimiento($1,$2,$3,'bodega_omar','entrada_compra',$4::int,$5::bigint,negocio.hoy() - 40,'Compra ilustrativa')", [`e2einv:${SUF}:${m}:${s}:e`, m, s, cant, valor]);
      const dias = [20, 15, 10, 5];
      for (let i = 0; i < 4; i += 1) for (const s of ['Fresa', 'Mango']) await c.query("select operacion.registrar_movimiento($1,$2,$3,'bodega_omar','salida_pedido',-21,null,negocio.hoy() - $4::int,'Pedido ilustrativo')", [`e2einv:${SUF}:${m}:${s}:s${i}`, m, s, dias[i]]);
    }
    await c.query('commit');
  });
}

