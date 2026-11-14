// Construye el PLAN de carga: una lista ordenada de pasos. Cada paso llama SOLO funciones existentes del sistema (api.* u operacion.* con la identidad de un socio);
// nunca inserta en tablas de negocio. La clave de idempotencia de cada operacion sale de la clave de identidad del pedido o asiento (proveedor|folio|cliente|fecha|consecutivo).
import { claveOperacion, repartirExacto, sumaRenglones, fmt } from './lib.mjs';

export const LOTES = {
  1: 'Catalogo y clientes',
  2: 'Capital de los socios, compra de Nexa y mercancia pedida por recibir',
  3: 'Pedidos de Karen y sus cobros',
  4: 'Pedidos con Isaac y sus cobros',
  5: 'Ventas de inventario de Merida, cobros y obsequio',
};

const MOTIVO_COSTO = 'Costo real del pedido segun estado de cuenta del proveedor (carga historica)';

/** Costos de catalogo por proveedor y modelo. Isaac: el mas repetido (empate: el mayor). Karen: promedio por pieza de sus pedidos; un pedido a costo manda. */
export function costosCatalogo(dominio, alias) {
  const res = new Map(); // "Proveedor|modelo" -> { proveedor, modelo, marca, puffs, cent, supuesto }
  const reg = (prov, l, cent, supuesto) => {
    const k = `${prov}|${l.modelo}`;
    const e = res.get(k) ?? { proveedor: prov, modelo: l.modelo, marca: l.marca, puffs: l.puffs, cuentas: new Map(), supuesto, pz: 0, total: 0, fijo: null };
    if (supuesto) {
      e.pz += l.piezas;
      e.total += cent * l.piezas;
    } else e.cuentas.set(cent, (e.cuentas.get(cent) ?? 0) + 1);
    res.set(k, e);
    return e;
  };
  for (const p of dominio.pedidos) {
    if (p.origen === 'Isaac') for (const l of p.lineas) reg('Isaac', l, l.costoCent, false);
    if (p.origen === 'Karen') {
      const unit = p.costoCent / p.lineas.reduce((s, l) => s + l.piezas, 0);
      for (const l of p.lineas) {
        const e = reg('Karen', l, Math.round(unit), true);
        if (p.tipo === 'socio_a_costo') e.fijo = Math.round(unit);
      }
    }
  }
  for (const c of dominio.compras) for (const l of c.lineas) reg(c.proveedor, l, l.costoCent, false);
  const out = [];
  for (const [k, e] of res) {
    let cent;
    if (e.supuesto) cent = e.fijo ?? Math.round(e.total / e.pz);
    else cent = [...e.cuentas.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    if (alias?.costos?.[k] != null) cent = Math.round(alias.costos[k] * 100);
    out.push({ proveedor: e.proveedor, modelo: e.modelo, marca: e.marca, puffs: e.puffs, cent, supuesto: e.supuesto });
  }
  return out;
}

/**
 * Renglones finales de un pedido con precio y costo por pieza, de modo que las sumas den EXACTAMENTE los totales de la fuente. Un renglon puede partirse en dos del mismo SKU
 * cuando el total no se puede repartir de otra forma. Devuelve { renglones: [{ linea, piezas, precio, costo, catalogo }], piezas }.
 */
export function valoresRenglones(p, catalogo) {
  const q = p.lineas.map((l) => l.piezas);
  const piezas = q.reduce((s, x) => s + x, 0);
  const productoCent = p.ventaCent - p.envioCent - p.interesCent;
  const precioDado = p.tipo !== 'socio_a_costo' && p.lineas.every((l) => l.precioCent != null) && sumaRenglones(q, p.lineas.map((l) => l.precioCent)) === productoCent;
  const aPrecio = p.tipo !== 'socio_a_costo' && !precioDado;
  const costoTotal = p.origen === 'Karen' && p.tipo !== 'socio_a_costo' ? p.costoCent : null;
  let partes;
  if (aPrecio || costoTotal != null) {
    partes = repartirExacto({ precioTotal: aPrecio ? productoCent : null, costoTotal, cantidades: q });
  } else partes = q.map((x, i) => ({ indice: i, piezas: x, precio: null, costo: null }));
  const clave = `${p.origen === 'Isaac' ? 'Isaac' : 'Karen'}`;
  const renglones = partes.map((x) => {
    const l = p.lineas[x.indice];
    return {
      linea: l, piezas: x.piezas,
      precio: p.tipo === 'socio_a_costo' ? null : precioDado ? l.precioCent : x.precio,
      costo: p.origen === 'Isaac' ? l.costoCent : x.costo,
      catalogo: catalogo.get(`${clave}|${l.modelo}`)?.cent ?? null,
    };
  });
  return { renglones, piezas };
}

export function construirPlan(dominio, alias, opciones = {}) {
  const o = { actor: 'Javier', duenio: 'Javier', prefijo: 'carga', desde: '2026-10-01', conDestinatarios: false, saborObsequioPendiente: null, ...opciones };
  const pasos = [];
  const adv = [...dominio.advertencias];
  const cat = costosCatalogo(dominio, alias);
  const catMap = new Map(cat.map((c) => [`${c.proveedor}|${c.modelo}`, c]));
  const k = (id, paso) => claveOperacion(o.prefijo, id, paso);
  const add = (p) => pasos.push(p);

  // ---------------- Lote 1: catalogo y clientes ----------------
  const modelos = new Map();
  const skus = new Map();
  const vistas = [...dominio.pedidos.flatMap((p) => p.lineas), ...dominio.compras.flatMap((c) => c.lineas), ...dominio.bajas.map((b) => ({ ...b.modelo, sabor: b.sabor }))];
  for (const l of vistas) {
    if (!modelos.has(l.modelo)) modelos.set(l.modelo, { marca: l.marca, modelo: l.modelo, puffs: l.puffs });
    if (l.sabor) skus.set(`${l.modelo}|${l.sabor}`, { modelo: l.modelo, sabor: l.sabor });
  }
  for (const m of modelos.values()) {
    add({ lote: 1, tipo: 'catalogo.modelo', id: m.modelo, desc: `modelo ${m.modelo}`, actor: o.actor, run: (db) => db.q('select catalogo.asegurar_modelo($1,$2,$3,$4) as id', [m.marca, m.modelo, m.puffs, 'ambas']) });
  }
  for (const s of skus.values()) {
    add({ lote: 1, tipo: 'catalogo.sku', id: `${s.modelo}|${s.sabor}`, desc: `sku ${s.modelo} / ${s.sabor}`, actor: o.actor, run: (db) => db.q('select catalogo.asegurar_sku($1,$2) as id', [s.modelo, s.sabor]) });
  }
  for (const c of cat) {
    add({
      lote: 1, tipo: 'catalogo.costo', id: `${c.proveedor}|${c.modelo}`, desc: `costo ${c.proveedor} ${c.modelo} ${fmt(c.cent)}${c.supuesto ? ' (supuesto: promedio por pieza del pedido)' : ''}`, actor: o.actor,
      run: (db) => db.q(`select case when exists (select 1 from catalogo.costo_proveedor c where c.proveedor_id = catalogo.proveedor_id($2) and c.modelo_id = (select id from catalogo.modelo where nombre_norm = catalogo.normalizar($3))
                          and c.vigente_hasta is null and c.vigente_desde >= $5::date and c.costo_cent <> $4)
                  then jsonb_build_object('sin_cambio', true, 'conservado', 'costo de lista vigente mas reciente')
                  else catalogo.fijar_costo($1,$2,$3,$4,$5::date,$6,$7,$8,$9) end as r`, [k(`${c.proveedor}|${c.modelo}`, 'costo'), c.proveedor, c.modelo, c.cent, o.desde, 'carga historica', c.supuesto ? 'Supuesto: promedio por pieza del pedido (el proveedor no desglosa el costo por modelo)' : 'Costo por pieza de la nota del pedido', c.supuesto, true]),
    });
  }
  for (const c of dominio.clientes.values()) {
    add({ lote: 1, tipo: 'cliente', id: c.slug, desc: `cliente ${c.slug.slice(0, 2)}***`, actor: o.actor, run: async (db, ctx) => { ctx.cliente.set(c.slug, (await db.q('select catalogo.asegurar_cliente($1,$2,$3) as id', [c.nombre, o.duenio, 'mayoreo'])).rows[0].id); } });
  }

  // ---------------- Lote 2: capital, compra de Nexa y mercancia por recibir ----------------
  for (const c of dominio.capital) {
    const nota = `Capital declarado por ${c.socio}${c.socio !== o.actor ? ' (cargado por ' + o.actor + '; confirmacion del socio pendiente)' : ''} - carga historica`;
    add({
      lote: 2, tipo: 'capital', id: c.id, desc: `capital ${c.socio} ${fmt(c.montoCent)} a ${c.proveedor} (asiento ${c.numero})`, actor: o.actor,
      run: async (db) => { await db.fecha(c.fecha ?? '2026-11-12'); return db.q('select api.pago_proveedor_de_socio($1,$2,$3,$4,$5,$6::date,$7,null,true)', [k(c.id, 'capital'), c.proveedor, c.montoCent, c.socio, 'dinero_propio', c.fecha ?? '2026-11-12', nota]); },
    });
  }
  for (const c of dominio.compras) {
    add({
      lote: 2, tipo: c.estado === 'recibida' ? 'compra' : 'compra_por_recibir', id: c.id, desc: `compra ${c.numero} a ${c.proveedor} (${c.lineas.reduce((s, l) => s + l.piezas, 0)} pzas, ${c.estado === 'recibida' ? 'recibida' : 'por recibir'})`, actor: o.actor,
      run: async (db, ctx) => {
        await db.fecha(c.fecha ?? '2026-11-12');
        for (const a of c.aportes) {
          await db.q('select api.pago_proveedor_de_socio($1,$2,$3,$4,$5,$6::date,$7,null,true)', [k(c.id, `aporte:${a.socio}`), c.proveedor, a.montoCent, a.socio, 'dinero_propio', c.fecha ?? '2026-11-12', `Capital declarado por ${a.socio} para la compra ${c.numero} (carga historica)`]);
        }
        const lineas = c.lineas.map((l) => ({ modelo: l.modelo, sabor: l.sabor, pagadas: l.piezas, costo_cent: l.costoCent, motivo_costo: 'Costo de la nota del proveedor (carga historica)' }));
        const cr = (await db.q('select api.crear_compra($1,$2,$3::jsonb,$4,0,$5::date,$6,$7,null,null,$8) as r', [k(c.id, 'compra'), c.proveedor, JSON.stringify(lineas), c.guiaCent, c.fecha ?? '2026-11-12', 'bodega', 'sociedad', c.nota])).rows[0].r;
        await db.q('select api.confirmar_compra($1,$2)', [k(c.id, 'confirmar'), cr.compra_id]);
        ctx.compra.set(c.id, cr.compra_id);
        if (c.estado === 'recibida') {
          const lin = (await db.q('select l.id from operacion.compra_linea l where l.compra_id = $1 order by l.id', [cr.compra_id])).rows;
          if (lin.length !== c.lineas.length) throw new Error('los renglones de la compra no corresponden al plan');
          const recibido = c.lineas.map((l, i) => ({ linea_id: lin[i].id, sabor: l.sabor, piezas: l.piezas }));
          await db.q('select api.recibir_compra($1,$2,$3::jsonb,$4::timestamptz)', [k(c.id, 'recibir'), cr.compra_id, JSON.stringify(recibido), `${c.fecha ?? '2026-11-12'}T12:00:00-06:00`]);
        }
      },
    });
  }

  // ---------------- Lotes 3, 4 y 5: pedidos y cobros ----------------
  const ordenados = [...dominio.pedidos].sort((a, b) => (a.fecha + a.numero).localeCompare(b.fecha + b.numero));
  for (const p of ordenados) {
    const v = valoresRenglones(p, catMap);
    if (p.tipo !== 'socio_a_costo') {
      const venta = sumaRenglones(v.renglones.map((r) => r.piezas), v.renglones.map((r) => r.precio)) + p.envioCent + p.interesCent;
      if (venta !== p.ventaCent) throw new Error(`pedido ${p.numero}: la venta repartida no cuadra`);
    }
    if (v.renglones.some((r) => r.costo != null) && p.origen === 'Karen' && sumaRenglones(v.renglones.map((r) => r.piezas), v.renglones.map((r) => r.costo ?? 0)) !== p.costoCent) throw new Error(`pedido ${p.numero}: el costo repartido no cuadra`);
    if (o.conDestinatarios && p.tieneDest && !p.dest) adv.push(`pedido ${p.numero}: el destinatario no cumple el formato del sistema (nombre, calle, CP de 5 digitos, municipio, estado): no se carga`);
    const lote = p.origen === 'inventario' ? 5 : p.origen === 'Karen' ? 3 : 4;
    const actorPedido = p.tipo === 'socio_a_costo' ? p.socio : o.actor;
    const desc = `pedido ${p.numero} ${p.origen}${p.folio ? ' folio ' + p.folio : ''} (${v.piezas} pzas, venta ${fmt(p.ventaCent)}${p.costoCent ? ', costo ' + fmt(p.costoCent) : ''}, ${p.tipo}${p.credito ? ', credito al ' + p.credito.fechaPago : ''}, ${p.cobros.length} cobro(s))`;
    add({
      lote, tipo: `pedido.${p.tipo}`, id: p.id, desc, actor: actorPedido,
      run: async (db, ctx) => {
        const cli = ctx.cliente.get(p.cliente);
        await db.fecha(p.fecha);
        const lineasSql = v.renglones.map((r) => ({ modelo: r.linea.modelo, sabor: r.linea.sabor, piezas: r.piezas, ...(r.precio != null ? { precio_cent: r.precio } : {}) }));
        let pedidoId;
        if (p.origen === 'inventario') {
          const plazo = p.credito ? Math.round((Date.parse(p.credito.fechaPago) - Date.parse(p.fecha)) / 86400000) : 0; // contado = plazo 0 (api.crear_pedido exige plazo desde 14-nov)
          const cr = (await db.q('select api.crear_pedido($1,$2,$3::jsonb,$4,null,0,0,$5,$6::date,null,$7,null,$8,null) as r', [k(p.id, 'pedido'), cli, JSON.stringify(lineasSql), 'bodega_omar', p.interesCent, p.fecha, plazo, 'Venta de inventario de Merida (carga historica)'])).rows[0].r;
          pedidoId = cr.pedido_id;
          await db.q('select api.confirmar_pedido($1,$2)', [k(p.id, 'confirmar'), pedidoId]);
          await db.q('select api.enviar_pedido($1,$2,null,null,$3::date,true)', [k(p.id, 'enviar'), pedidoId, p.fecha]);
        } else {
          const credito = p.credito ? { fecha_pago: p.credito.fechaPago, modo: 'fijo', interes_cent: p.interesCent } : null;
          const cr = (await db.q('select api.ds_crear_pedido($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,0,$11::date,$12,null,null,null) as r', [
            k(p.id, 'pedido'), cli, JSON.stringify(lineasSql), p.origen === 'Isaac' ? 'isaac_directo' : 'karen_directo', null, credito ? JSON.stringify(credito) : null,
            p.tipo, p.socio, p.folio, p.envioCent, p.fecha, 'Carga historica',
          ])).rows[0].r;
          pedidoId = cr.pedido_id;
          // El destinatario va en su propio paso idempotente (cifrado en reposo): correr con o sin --con-destinatarios no cambia la clave del pedido.
          if (o.conDestinatarios && p.dest) await db.q('select api.ds_capturar_destinatario($1,$2,$3::jsonb)', [k(p.id, 'destinatario'), pedidoId, JSON.stringify(p.dest)]);
          if (p.tipo !== 'socio_a_costo' && v.renglones.every((r) => r.costo != null)) {
            // Los renglones se insertaron en el orden del arreglo: el id ascendente corresponde al indice.
            const lin = (await db.q('select l.id, coalesce(l.costo_unit_cent, operacion.costo_ref_pedido(pe.origen, l.modelo_id, pe.fecha_neg)) as costo_unit_cent from operacion.pedido_linea l join operacion.pedido pe on pe.id = l.pedido_id where l.pedido_id = $1 order by l.id', [pedidoId])).rows;
            if (lin.length !== v.renglones.length) throw new Error('los renglones del pedido no corresponden al plan');
            const costos = [];
            v.renglones.forEach((r, i) => {
              // Se compara contra el costo que la base usara para la linea (el fijado, o el de referencia del catalogo a la fecha del pedido), no contra el del plan: si el catalogo ya tenia un costo de lista distinto, se corrige igual.
              if (Number(lin[i].costo_unit_cent) !== r.costo) costos.push({ linea_id: lin[i].id, costo_unit_cent: r.costo });
            });
            if (costos.length) await db.q('select api.ds_capturar_costo($1,$2,$3::jsonb,$4)', [k(p.id, 'costo'), pedidoId, JSON.stringify(costos), MOTIVO_COSTO]);
          }
          await db.q('select api.confirmar_pedido($1,$2)', [k(p.id, 'confirmar'), pedidoId]);
          await db.q('select api.enviar_pedido($1,$2,null,null,$3::date,true)', [k(p.id, 'enviar'), pedidoId, p.fecha]);
        }
        ctx.pedido.set(p.id, pedidoId);
        for (const c of p.cobros) {
          const clave = k(c.id, 'cobro');
          await db.fecha(c.fecha ?? p.fecha);
          if (c.via === 'proveedor' && p.origen !== 'inventario') {
            if (p.tipo === 'socio_a_costo') await db.q('select api.ds_pagar_pedido_menudeo($1,$2,$3,$4,$5::date,$6)', [clave, pedidoId, 'proveedor', c.montoCent, c.fecha, 'Pago del socio al proveedor (carga historica)']);
            else await db.q('select api.ds_pagar_proveedor($1,$2,$3,$4,null,$5,$6,$7::date,$8)', [clave, c.proveedor, c.montoCent, 'cliente_a_proveedor', cli, pedidoId, c.fecha, 'Cobro del cliente depositado en la cuenta del proveedor (carga historica)']);
          } else {
            const cuenta = c.via === 'socio' ? c.socio : c.proveedor;
            await db.q('select api.registrar_pago($1,$2,$3,$4,$5::jsonb,true,$6,$7::date,null,$8,null)', [clave, cuenta, c.montoCent, cli, JSON.stringify([{ pedido_id: pedidoId, monto_cent: c.montoCent }]), 'abono', c.fecha, `Cobro en la cuenta de ${cuenta} (carga historica)`]);
          }
        }
      },
    });
  }
  // Los cobros de socio de Angelo y los pagos del socio de menudeo exigen su identidad: ya se ejecutan con el actor del pedido; los cobros de pedidos del socio se hacen como el.
  for (const c of dominio.cobros.filter((c) => c.omitido)) adv.push(`cobro ${c.numero} omitido`);

  // ---------------- Lote 5: obsequio ----------------
  for (const b of dominio.bajas) {
    add({
      lote: 5, tipo: 'baja', id: b.id, desc: `baja por obsequio ${b.piezas} pza(s) ${b.modelo.modelo} / ${b.sabor ?? 'sabor pendiente'}`, actor: o.actor,
      run: async (db) => {
        await db.fecha(b.fecha ?? '2026-11-12');
        let sabor = b.sabor ?? o.saborObsequioPendiente;
        if (!sabor) {
          const r = (await db.q("select sa.nombre_canonico as s from operacion.movimiento_inventario mi join catalogo.sku k on k.id = mi.sku_id join catalogo.modelo m on m.id = k.modelo_id join catalogo.sabor sa on sa.id = k.sabor_id where m.nombre_norm = catalogo.normalizar($1) group by sa.nombre_canonico order by sum(mi.cantidad) desc limit 1", [b.modelo.modelo])).rows[0];
          sabor = r.s;
        }
        await db.q('select operacion.registrar_movimiento($1,$2,$3,$4,$5,$6,null,$7::date,$8)', [k(b.id, 'baja'), b.modelo.modelo, sabor, 'bodega_omar', 'merma', -b.piezas, b.fecha ?? '2026-11-12', b.motivo]);
      },
    });
  }

  pasos.sort((a, b) => a.lote - b.lote);
  return { pasos, advertencias: adv, catalogo: cat, opciones: o };
}

export function resumenPlan(plan) {
  const lotes = {};
  for (const p of plan.pasos) lotes[p.lote] = (lotes[p.lote] ?? 0) + 1;
  return { lotes, total: plan.pasos.length };
}
