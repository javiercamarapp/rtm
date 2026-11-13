// Lectura y normalizacion de las fuentes privadas (asientos del PDF y pedidos con Isaac) al modelo de dominio del cargador.
// Ningun dato real vive en este archivo: todo se lee de la ruta indicada con --archivos. No imprime nombres, direcciones ni telefonos.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { aCentavos, norm, titulo, sabor as limpiarSabor, nombreDeSlug, minFecha } from './lib.mjs';

const SOCIOS = ['Angelo', 'Javier'];
export const FECHA_PAGO_DEFECTO = '2026-11-20';

const leerJson = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'));

/** Alias de modelos: { modelos: { "<texto normalizado>": { marca, modelo, puffs? } }, sabores?: { "<texto normalizado>": "Nombre" } }. Opcional. */
export function leerAlias(dir) {
  const ruta = join(dir, 'alias-modelos.json');
  return existsSync(ruta) ? leerJson(ruta) : { modelos: {}, sabores: {} };
}

export function resolverModelo(rawMarcaModelo, rawMarca, alias, fuente = '') {
  const texto = rawMarca ? `${rawMarca} ${rawMarcaModelo}` : String(rawMarcaModelo);
  const k = norm(texto).replace(/[,.]/g, '');
  const hit = alias.modelos?.[`${fuente}:${k}`] ?? alias.modelos?.[k] ?? alias.modelos?.[norm(texto)];
  if (hit) return { marca: hit.marca, modelo: hit.modelo, puffs: hit.puffs ?? null };
  const limpio = titulo(texto.replace(/\bpuff\b/gi, '').replace(/(\d),(\d{3})/g, '$1$2').replace(/\s+/g, ' '));
  const marca = limpio.split(' ')[0];
  const m = /(\d{2,3})\s*k\b/i.exec(limpio);
  return { marca, modelo: limpio, puffs: m ? Number(m[1]) * 1000 : null };
}

const mapSabor = (s, alias) => {
  const limpio = limpiarSabor(s);
  return alias.sabores?.[norm(limpio)] ?? limpio;
};

/** Une renglones con el mismo modelo y sabor (un SKU aparece una sola vez por pedido). */
function unirRenglones(lineas) {
  const m = new Map();
  for (const l of lineas) {
    const k = `${l.modelo}|${l.sabor}`;
    const prev = m.get(k);
    if (prev) {
      prev.piezas += l.piezas;
      if (prev.precioCent != null && l.precioCent != null && prev.precioCent !== l.precioCent) prev.precioCent = null;
      if (prev.costoCent != null && l.costoCent != null && prev.costoCent !== l.costoCent) prev.costoCent = null;
    } else m.set(k, { ...l });
  }
  return [...m.values()];
}

function destinatario(d) {
  if (!d || typeof d !== 'object') return null;
  const calle = d.calle_numero ?? [d.calle, d.numero].filter(Boolean).join(' ');
  const out = {
    nombre: d.nombre ?? '',
    calle_numero: calle ?? '',
    colonia: d.colonia ?? '',
    cp: String(d.cp ?? d.codigo_postal ?? '').trim(),
    municipio: d.municipio ?? d.ciudad ?? '',
    estado: d.estado ?? '',
    telefono: String(d.telefono ?? d.celular ?? '').trim(),
    correo: d.correo ?? '',
    referencias: d.referencias ?? d.referencia ?? '',
  };
  return /^\d{5}$/.test(out.cp) && out.nombre.length >= 2 && out.calle_numero.length >= 3 && out.municipio.length >= 2 && out.estado.length >= 2 ? out : null;
}

const socioDe = (texto) => SOCIOS.find((s) => norm(texto).startsWith(norm(s))) ?? null;
const slugCrudo = (clave) => String(clave).split('|')[2];

/**
 * Devuelve el dominio: { clientes, pedidos, cobros, capital, compras, bajas, advertencias }.
 * pedidos[].origen: 'Karen' | 'Isaac' | 'inventario'; tipo: 'cliente' | 'socio_a_costo' | 'inventario'.
 */
export function normalizarFuentes({ asientos, isaac, alias }) {
  const adv = [];
  // Clientes que son el mismo aunque la fuente los escriba distinto: alias.clientes = { "<slug>": "<slug unico>" }; alias.nombres = { "<slug unico>": "Nombre visible" }. La clave de identidad no cambia.
  const slugDe = (clave) => alias.clientes?.[slugCrudo(clave)] ?? slugCrudo(clave);
  const clientes = new Map();
  const pedidos = [];
  const cobros = [];
  const capital = [];
  const compras = [];
  const bajas = [];
  const cliente = (slug) => {
    if (!clientes.has(slug)) clientes.set(slug, { slug, nombre: alias.nombres?.[slug] ?? nombreDeSlug(slug) });
    return slug;
  };

  // ---------- Karen y compra / ventas de inventario (asientos) ----------
  for (const x of asientos.asientos) {
    const fecha = x.fecha ?? null;
    const id = x.clave_identidad;
    if (x.tipo === 'pedido_dropshipping' || x.tipo === 'venta_interna_a_costo') {
      const slug = slugDe(id);
      const aCosto = x.tipo === 'venta_interna_a_costo';
      const costoCent = aCentavos(x.utilidad?.costo ?? x.montos.find((m) => /costo/i.test(m.columna_origen))?.monto);
      const ventaCent = aCentavos(x.utilidad?.venta_deposito ?? x.utilidad?.venta ?? costoCent);
      const envioTxt = x.montos.map((m) => /(\d[\d,.]*)\s*de\s*envio/i.exec(m.concepto ?? '')).find(Boolean);
      const lineas = unirRenglones(
        x.renglones.map((r) => {
          const mm = resolverModelo(r.marca_modelo, null, alias, 'asientos');
          return { ...mm, sabor: mapSabor(r.sabor, alias), piezas: r.cantidad, precioCent: typeof r.precio_unitario === 'number' ? aCentavos(r.precio_unitario) : null, costoCent: null };
        }),
      );
      pedidos.push({
        id, numero: x.id, origen: 'Karen', tipo: aCosto ? 'socio_a_costo' : 'cliente', socio: aCosto ? socioDe(slug) : null, cliente: cliente(slug), folio: x.folio_externo, fecha,
        lineas, ventaCent, costoCent, envioCent: envioTxt ? aCentavos(envioTxt[1].replace(/,/g, '')) : 0, interesCent: 0,
        vencimiento: x.terminos_credito?.fecha_vencimiento ?? null, dest: destinatario(x.destinatario_protegido), tieneDest: Boolean(x.destinatario_protegido),
      });
    } else if (x.tipo === 'cobro_aplicado_a_cuenta_proveedor') {
      cobros.push({ id, numero: x.id, via: 'proveedor', proveedor: x.proveedor, montoCent: aCentavos(x.montos[0].monto), fecha, folio: x.folio_externo, cliente: cliente(slugDe(id)) });
    } else if (x.tipo === 'cobro_cliente') {
      cobros.push({ id, numero: x.id, via: 'socio', socio: 'Angelo', montoCent: aCentavos(x.montos[0].monto), fecha, folio: x.folio_externo, cliente: cliente(slugDe(id)) });
    } else if (x.tipo.startsWith('inversion_socio')) {
      const socio = socioDe(x.quien_pone_el_dinero);
      if (!socio) throw new Error(`asiento ${x.id}: no se identifica el socio que invierte`);
      capital.push({ id, numero: x.id, socio, proveedor: x.proveedor, montoCent: aCentavos(x.montos[0].monto), fecha });
    } else if (x.tipo === 'compra_inventario') {
      const lineas = x.renglones.map((r) => ({ ...resolverModelo(r.marca_modelo, null, alias, 'asientos'), sabor: mapSabor(r.sabor_normalizado ?? r.sabor, alias), piezas: r.cantidad, costoCent: aCentavos(r.precio_unitario) }));
      const c = x.costeo ?? {};
      compras.push({
        id, numero: x.id, proveedor: x.proveedor, fecha, lineas: unirRenglones(lineas), guiaCent: aCentavos(c.envio ?? 0), estado: 'recibida',
        aportes: (x.aportes_socios ?? []).map((a) => ({ socio: a.socio, montoCent: aCentavos(a.monto) })),
        nota: `Isaac facturo ${x.datos_recepcion?.compradas ?? '?'} piezas y llegaron ${x.datos_recepcion?.llegadas ?? '?'}; faltantes ${x.datos_recepcion?.faltantes ?? 0} a ${x.datos_recepcion?.costo_unitario ?? '?'} quedan a favor en la cuenta del proveedor (carga historica).`,
        faltantesCent: aCentavos(x.datos_recepcion?.valor_faltantes ?? 0),
      });
    } else if (x.tipo === 'venta_inventario' || x.tipo === 'venta_inventario_credito') {
      const slug = slugDe(id);
      const lineas = unirRenglones(
        x.renglones.map((r) => ({ ...resolverModelo(r.marca_modelo.replace(/\s*\(.*$/, ''), null, alias, 'asientos'), sabor: mapSabor(r.sabor_normalizado ?? r.sabor, alias), piezas: r.cantidad, precioCent: aCentavos(r.precio_unitario) })),
      );
      const cr = x.terminos_credito;
      const interes = cr?.interes != null ? aCentavos(cr.interes) : 0;
      pedidos.push({
        id, numero: x.id, origen: 'inventario', tipo: 'inventario', cliente: cliente(slug), folio: x.folio_externo, fecha, lineas,
        ventaCent: lineas.reduce((s, l) => s + l.piezas * l.precioCent, 0) + interes, costoCent: null, envioCent: 0, interesCent: interes,
        vencimiento: cr?.fecha_vencimiento ?? null, tieneDest: false, dest: null,
      });
      if (cr?.abono && /cuenta de angelo/i.test(JSON.stringify(x.montos))) {
        cobros.push({ id: `${id}|abono`, numero: `${x.id}-abono`, via: 'socio', socio: 'Angelo', montoCent: aCentavos(cr.abono), fecha, folio: null, cliente: slug, pedidoId: id });
      }
    } else if (x.tipo === 'obsequio') {
      for (const r of x.renglones) {
        bajas.push({ id: `${id}|${r.sabor}`, numero: x.id, fecha, modelo: resolverModelo(r.marca_modelo, null, alias, 'asientos'), sabor: r.sabor_normalizado ? mapSabor(r.sabor_normalizado, alias) : null, piezas: r.cantidad, motivo: 'Obsequio a costo (carga historica)' });
      }
    } else adv.push(`asiento ${x.id}: tipo sin tratamiento (${x.tipo})`);
  }

  // ---------- Isaac ----------
  for (const p of isaac.pedidos) {
    if (!p.pedido_numero || !p.renglones?.length) continue;
    const id = p.clave_identidad;
    const slug = slugDe(id);
    const lineas = unirRenglones(
      p.renglones.map((r) => ({ ...resolverModelo(r.modelo, r.marca, alias, 'isaac'), sabor: mapSabor(r.sabor, alias), piezas: r.cantidad, costoCent: aCentavos(r.costo_unitario_lista), precioCent: null })),
    );
    const costoCent = lineas.reduce((s, l) => s + l.piezas * l.costoCent, 0);
    const mc = p.monto_conocido ?? {};
    const fecha = p.fecha ?? slugFecha(id);
    if (/recibir/i.test(p.tipo_propuesto)) {
      compras.push({ id, numero: `I${p.pedido_numero}`, proveedor: 'Isaac', fecha, lineas, guiaCent: 0, estado: 'por_recibir', aportes: [], llegada: p.fecha_llegada_esperada ?? null, nota: 'Mercancia pedida por recibir (carga historica); el envio esta pendiente y no se ha cargado.' });
      continue;
    }
    const aCosto = /costo/i.test(p.tipo_propuesto) && /angelo/i.test(p.tipo_propuesto);
    const ventaTexto = p.precio_cliente ?? mc.precio_pactado ?? mc.pendiente_de_pago ?? mc.total_texto ?? null;
    const interes = mc.interes_10pct != null ? aCentavos(mc.interes_10pct) : 0;
    const ventaCent = aCosto ? costoCent : aCentavos(ventaTexto);
    if (!aCosto && ventaTexto == null) throw new Error(`pedido ${p.pedido_numero} con Isaac: no hay monto de venta`);
    pedidos.push({
      id, numero: `I${p.pedido_numero}`, origen: 'Isaac', tipo: aCosto ? 'socio_a_costo' : 'cliente', socio: aCosto ? 'Angelo' : null, cliente: cliente(slug), folio: null, fecha, lineas,
      ventaCent, costoCent, envioCent: 0, interesCent: interes, vencimiento: null, dest: destinatario(p.destinatario_protegido), tieneDest: Boolean(p.destinatario_protegido && typeof p.destinatario_protegido === 'object'),
    });
    for (const [i, c] of (p.pagos_a_cuenta_isaac ?? []).entries()) {
      cobros.push({ id: `${id}|cobro${i}`, numero: `I${p.pedido_numero}-cobro`, via: 'proveedor', proveedor: 'Isaac', montoCent: aCentavos(c.monto), fecha: c.fecha, folio: null, cliente: slug, pedidoId: id });
    }
  }

  casiDuplicados({ clientes, pedidos, cobros, adv });
  asignarCobros({ pedidos, cobros, adv });
  asignarFechasYCreditos({ pedidos, cobros });
  return { clientes, pedidos, cobros, capital, compras, bajas, advertencias: adv };
}

/** Distancia de edicion corta (para detectar nombres casi iguales). */
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Avisa de clientes con nombre casi igual (tokens contenidos o distancia de edicion <= 2). Sin nombres: solo los documentos donde aparecen. */
function casiDuplicados({ clientes, pedidos, cobros, adv }) {
  const docs = new Map();
  for (const x of [...pedidos, ...cobros]) docs.set(x.cliente, [...(docs.get(x.cliente) ?? []), x.numero]);
  const slugs = [...clientes.keys()];
  for (let i = 0; i < slugs.length; i += 1) {
    for (let j = i + 1; j < slugs.length; j += 1) {
      const a = slugs[i], b = slugs[j];
      const ta = new Set(a.split('-')), tb = new Set(b.split('-'));
      const contenido = (x, y) => x.size >= 2 && [...x].every((t) => y.has(t));
      if (contenido(ta, tb) || contenido(tb, ta) || (Math.min(a.length, b.length) >= 5 && distancia(a, b) <= 2)) {
        adv.push(`clientes con nombre casi igual (revisar si son el mismo): documentos ${[...new Set(docs.get(a) ?? [])].join(',')} y ${[...new Set(docs.get(b) ?? [])].join(',')}`);
      }
    }
  }
}

const slugFecha = (clave) => String(clave).split('|')[3];

/** Cada cobro se aplica a un pedido: por folio del proveedor o, si no hay, por cliente y monto pendiente. */
function asignarCobros({ pedidos, cobros, adv }) {
  const pendiente = new Map(pedidos.map((p) => [p.id, p.ventaCent]));
  for (const c of cobros) {
    if (c.pedidoId) {
      pendiente.set(c.pedidoId, pendiente.get(c.pedidoId) - c.montoCent);
      continue;
    }
    let cand = c.folio ? pedidos.filter((p) => p.folio && p.folio === c.folio && (c.via === 'socio' || p.origen === c.proveedor)) : [];
    if (cand.length === 0) cand = pedidos.filter((p) => p.cliente === c.cliente && p.tipo === 'inventario' && pendiente.get(p.id) >= c.montoCent);
    if (cand.length !== 1) {
      adv.push(`cobro ${c.numero}: ${cand.length === 0 ? 'no se encontro el pedido' : 'mas de un pedido posible'}; no se carga`);
      c.omitido = true;
      continue;
    }
    c.pedidoId = cand[0].id;
    pendiente.set(c.pedidoId, pendiente.get(c.pedidoId) - c.montoCent);
  }
}

/** Fecha del pedido: la del primer abono si es anterior; credito si queda saldo (fecha de pago explicita, la del mismo cliente o la de omision). */
function asignarFechasYCreditos({ pedidos, cobros }) {
  const porPedido = new Map();
  for (const c of cobros) if (c.pedidoId && !c.omitido) porPedido.set(c.pedidoId, [...(porPedido.get(c.pedidoId) ?? []), c]);
  const vencCliente = new Map();
  for (const p of pedidos) if (p.vencimiento) vencCliente.set(p.cliente, minFecha(vencCliente.get(p.cliente), p.vencimiento));
  for (const p of pedidos) {
    const cs = porPedido.get(p.id) ?? [];
    p.cobros = cs;
    p.fecha = minFecha(p.fecha, ...cs.map((c) => c.fecha)) ?? p.fecha;
    const cobrado = cs.reduce((s, c) => s + c.montoCent, 0);
    p.saldoCent = p.ventaCent - cobrado;
    if (p.tipo === 'socio_a_costo') p.credito = null;
    else if (p.saldoCent > 0) p.credito = { fechaPago: p.vencimiento ?? vencCliente.get(p.cliente) ?? FECHA_PAGO_DEFECTO };
    else p.credito = null;
  }
}

export function leerFuentes(dir) {
  const asientos = leerJson(join(dir, 'asientos.json'));
  const isaac = leerJson(join(dir, 'pedidos-isaac.json'));
  return normalizarFuentes({ asientos, isaac, alias: leerAlias(dir) });
}
