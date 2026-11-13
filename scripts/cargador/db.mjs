// Acceso a la base para el cargador. Cada paso corre en UNA transaccion con la identidad de un socio (como las pruebas pgTAP): request.jwt.claim.sub.
// La llave del destinatario (si se cargan destinatarios) solo vive en la transaccion (rtm.llave_destinatario); nunca se imprime.
import pg from 'pg';

export async function conectar(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return c;
}

export async function uuidsSocios(client) {
  const r = await client.query("select socio_nombre, id from seguridad.usuario where rol = 'socio' and activo and socio_nombre is not null");
  return new Map(r.rows.map((x) => [x.socio_nombre, x.id]));
}

export function crearContexto() {
  return { cliente: new Map(), pedido: new Map(), compra: new Map() };
}

/** Ejecuta un paso: transaccion propia, identidad del actor. Devuelve { cambio } (si agrego eventos u operaciones) o lanza con contexto. */
export async function ejecutarPaso(client, paso, ctx, { socios, llave, exigirSinCambio = false }) {
  const uuid = socios.get(paso.actor);
  if (!uuid) throw new Error(`no hay un usuario socio activo para ${paso.actor}`);
  const cache = new Map();
  const db = {
    q: (sql, params = []) => client.query(sql, params),
    // Fecha de negocio de la operacion historica (negocio.hoy() la respeta solo con conexion propietaria y nunca en el futuro): rtm.fecha_negocio.
    fecha: (d) => client.query("select set_config('rtm.fecha_negocio', $1, true)", [d ?? '']),
    async normalizar(textos) {
      const falta = [...new Set(textos)].filter((t) => !cache.has(t));
      if (falta.length) {
        const r = await client.query('select t, catalogo.normalizar(t) as n from unnest($1::text[]) t', [falta]);
        for (const x of r.rows) cache.set(x.t, x.n);
      }
      return cache;
    },
  };
  await client.query('begin');
  try {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uuid]);
    if (llave) await client.query("select set_config('rtm.llave_destinatario', $1, true)", [llave]);
    const antes = (await client.query('select ((select count(*) from seguridad.operacion) + (select count(*) from operacion.evento) + (select count(*) from catalogo.modelo) + (select count(*) from catalogo.sku) + (select count(*) from catalogo.cliente) + (select count(*) from catalogo.costo_proveedor))::int as n')).rows[0].n;
    await paso.run(db, ctx);
    // Fuerza las comprobaciones diferidas del libro dentro del paso (si el libro no cuadra, el paso falla y no queda nada).
    await client.query('set constraints all immediate');
    const despues = (await client.query('select ((select count(*) from seguridad.operacion) + (select count(*) from operacion.evento) + (select count(*) from catalogo.modelo) + (select count(*) from catalogo.sku) + (select count(*) from catalogo.cliente) + (select count(*) from catalogo.costo_proveedor))::int as n')).rows[0].n;
    if (exigirSinCambio && despues !== antes) throw new Error('un lote anterior no estaba cargado: carga los lotes en orden');
    await client.query('commit');
    return { cambio: despues !== antes };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    e.paso = paso.desc;
    throw e;
  }
}

/** Estado de la base destino (solo lectura). */
export async function estadoBase(client) {
  const q = async (sql) => Number((await client.query(sql)).rows[0].n);
  return {
    pedidos: await q('select count(*) n from operacion.pedido'),
    asientos: await q('select count(*) n from contabilidad.asiento'),
    compras: await q('select count(*) n from operacion.compra'),
    pagos: await q('select count(*) n from operacion.pago'),
    cuentaProveedorMov: await q('select count(*) n from operacion.cuenta_proveedor_mov'),
    movimientosInventario: await q('select count(*) n from operacion.movimiento_inventario'),
    operacionesCarga: await q("select count(*) n from seguridad.operacion where clave like 'carga:%'"),
    modelos: await q('select count(*) n from catalogo.modelo'),
    clientes: await q('select count(*) n from catalogo.cliente'),
    sociosActivos: await q("select count(*) n from seguridad.usuario where rol = 'socio' and activo"),
  };
}

/** Prerrequisitos de la base destino (solo lectura): socios activos, proveedores, persona de bodega y que no haya pedidos ni asientos ajenos. */
export async function prerrequisitos(client, plan) {
  const est = await estadoBase(client);
  const q = async (sql, p = []) => (await client.query(sql, p)).rows;
  const socios = (await q("select socio_nombre from seguridad.usuario where rol = 'socio' and activo")).map((x) => x.socio_nombre);
  const provs = (await q('select nombre from catalogo.proveedor')).map((x) => x.nombre);
  const bodega = Number((await q('select count(*) n from catalogo.persona_bodega'))[0].n);
  const necesitaBodega = plan.pasos.some((p) => p.tipo === 'pedido.inventario');
  const modelosPlan = plan.pasos.filter((p) => p.tipo === 'catalogo.modelo').map((p) => p.id);
  const existentes = new Set((await q('select nombre_canonico from catalogo.modelo')).map((x) => x.nombre_canonico.toLowerCase()));
  const faltantes = modelosPlan.filter((m) => !existentes.has(m.toLowerCase())).length;
  const items = [
    { ok: ['Angelo', 'Javier'].every((s) => socios.includes(s)), texto: 'los dos socios tienen usuario activo' },
    { ok: ['Karen', 'Isaac'].every((s) => provs.includes(s)), texto: 'existen los proveedores Karen e Isaac' },
    { ok: !necesitaBodega || bodega > 0, texto: 'hay persona de bodega configurada (las ventas desde Merida la exigen)' },
    { ok: (est.pedidos === 0 && est.asientos === 0) || est.operacionesCarga > 0, texto: 'sin pedidos ni asientos ajenos a esta carga (0 pedidos, 0 asientos, o ya cargada por este cargador)' },
  ];
  return { est, items, modelosNuevos: faltantes, modelosPlan: modelosPlan.length, ok: items.every((i) => i.ok) };
}
