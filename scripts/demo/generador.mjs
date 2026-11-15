// Generador DETERMINISTA y 100 % FICTICIO del conjunto demo. Funcion pura: (hoy, movimientos, semilla) -> plan declarativo. No lee archivos, no toca la red ni la base.
// Mismo parametro, mismo plan (byte a byte). El ejecutor (ejecutor.mjs) lo carga SOLO con las funciones oficiales api.* y operacion.*.
// Dinero siempre en centavos enteros. Nada de datos reales: nombres con la palabra "Demo", correos @example.test, telefonos 555-01xx, guias DEMO-.
import { crearAzar } from './prng.mjs';
import { MODELOS, SABORES, TIPOS_NEGOCIO, PALABRAS_NEGOCIO, CONTACTOS, PAQUETERIAS, PREFIJO_GUIA, USUARIOS } from './datos-base.mjs';

export const SEMILLA_DEFECTO = 'rtm-demo-v1';
export const SEMANAS = 12;
/** Ritmo semanal creciente y variado: picos, semanas flojas. */
const PESO_SEMANA = [0.55, 0.7, 0.8, 0.62, 0.95, 1.1, 1.3, 0.98, 1.45, 1.7, 1.22, 1.9];
const PESO_DIA = [0.12, 1, 1, 1, 1, 1, 0.5]; // domingo..sabado
const TIPOS_CONFIGURACION = new Set(['aportacion_inicial']);
const RANGO = { aportacion: 0, pago_proveedor: 0.5, compra: 1, recepcion: 3, venta: 4, ds_venta: 4, merma: 5, devolucion_cliente: 6, devolucion_proveedor: 6, cobro: 7, ds_cobro: 7, ds_cobro_menudeo: 7, gasto_socio: 8, gasto_empresa: 8, traspaso: 8, pago_a_socio: 9, renta_pago: 9, costos_mes: 10, acta: 11 };

export const sumarDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diaSemana = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const finDeMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10); // mes 1..12
const centenas = (n) => Math.round(n / 100) * 100;

/** Reparte `total` en `dias.length` cuentas con pesos, por mayor residuo (determinista, sin azar). */
function repartir(total, pesos) {
  const suma = pesos.reduce((s, p) => s + p, 0);
  const base = pesos.map((p) => (total * p) / suma);
  const piso = base.map(Math.floor);
  let resto = total - piso.reduce((s, x) => s + x, 0);
  const orden = base.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of orden) {
    if (resto <= 0) break;
    piso[o.i] += 1;
    resto -= 1;
  }
  return piso;
}

/**
 * @param {{ hoy?: string, movimientos?: number, semilla?: string }} [parametros]
 * @returns {any}
 */
export function generarDemo({ hoy, movimientos = 250, semilla = SEMILLA_DEFECTO } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(hoy))) throw new Error('hoy debe ser AAAA-MM-DD');
  if (!Number.isInteger(movimientos) || movimientos < 60 || movimientos > 2000) throw new Error('movimientos debe ser un entero entre 60 y 2000');
  const az = crearAzar(`${semilla}|${hoy}|${movimientos}`);
  const N = movimientos;
  const dias = SEMANAS * 7;
  const inicio = sumarDias(hoy, -(dias - 1));
  const ultimo = sumarDias(hoy, -1); // nunca se registra nada en el dia de hoy ni en el futuro
  const fechas = Array.from({ length: dias }, (_, i) => sumarDias(inicio, i));
  const pesosDia = fechas.map((f, i) => PESO_SEMANA[Math.floor(i / 7)] * PESO_DIA[diaSemana(f)]);

  // ---------------- Catalogo ----------------
  const popular = az.barajar(MODELOS.map((_, i) => i));
  const peso = new Map(popular.map((idx, rango) => [idx, 1 / (rango + 1) ** 0.85]));
  const modelos = MODELOS.map(([marca, nombre, puffs, cIsaac, cKaren], idx) => {
    const sabores = az.barajar(SABORES).slice(0, az.entre(6, 10));
    return { marca, nombre, puffs, costo: { Isaac: cIsaac, Karen: cKaren }, precioBase: Math.max(centenas(cIsaac * 1.3), cIsaac + 500), sabores, peso: peso.get(idx) };
  });
  const porNombre = new Map(modelos.map((m) => [m.nombre, m]));
  const elegirModelo = (lista) => {
    const total = lista.reduce((s, m) => s + m.peso, 0);
    let x = az.r() * total;
    for (const m of lista) {
      x -= m.peso;
      if (x <= 0) return m;
    }
    return lista[lista.length - 1];
  };

  // ---------------- Clientes ----------------
  const nClientes = Math.min(PALABRAS_NEGOCIO.length, Math.max(12, Math.round(N / 7)));
  const palabras = az.barajar(PALABRAS_NEGOCIO).slice(0, nClientes);
  const clientes = palabras.map((p, i) => {
    const cartera = az.barajar(modelos).slice(0, az.entre(8, 14));
    const factor = az.de([0.95, 1, 1, 1.03, 1.06]);
    return {
      nombre: `${az.de(TIPOS_NEGOCIO)} Demo ${p}`,
      tipo: 'mayoreo',
      dueno: i % 2 === 0 ? 'Javier' : 'Angelo',
      plazo: az.de([0, 0, 7, 14, 14, 21]),
      nota: `Contacto demo: ${CONTACTOS[i % CONTACTOS.length]} ${p}, tel. 555 010 ${String(1000 + i).slice(-4)}, ${p.toLowerCase()}@example.test`,
      precios: Object.fromEntries(cartera.map((m) => [m.nombre, centenas(m.precioBase * factor)])),
      peso: 1 / (i + 1) ** 0.5,
    };
  });
  // Cliente del socio de menudeo (pedidos a costo).
  const clienteSocio = { nombre: 'Menudeo Demo Socio A', tipo: 'mayoreo', dueno: 'Angelo', plazo: 0, nota: 'Cliente interno de demostracion para pedidos a costo del socio de menudeo.', precios: {}, peso: 0 };
  const todosClientes = [...clientes, clienteSocio];
  const elegirCliente = () => {
    const total = clientes.reduce((s, c) => s + c.peso, 0);
    let x = az.r() * total;
    for (const c of clientes) {
      x -= c.peso;
      if (x <= 0) return c;
    }
    return clientes[0];
  };

  // ---------------- Presupuesto de movimientos ----------------
  const n = (f, min = 1) => Math.max(min, Math.round(N * f));
  const cuentas = {
    ventas: n(0.27, 8), ds: n(0.075, 3), compras: n(0.044, 3), pagosProv: n(0.044, 3), gastos: n(0.05, 3), devol: n(0.02, 2), merma: n(0.012, 1), renta: n(0.016, 2),
  };
  const ops = [];
  const meter = (o) => ops.push(o);

  // ---------------- Capital inicial (movimientos de partida) ----------------
  const capitalA = 30000000 + az.entre(0, 8) * 1000000;
  const capitalB = 24000000 + az.entre(0, 8) * 1000000;
  meter({ fecha: inicio, actor: 'A', tipo: 'aportacion', socio: 'Angelo', monto: capitalA, concepto: 'Capital inicial de demostracion', intencion: 'capital' });
  meter({ fecha: inicio, actor: 'B', tipo: 'aportacion', socio: 'Javier', monto: capitalB, concepto: 'Capital inicial de demostracion', intencion: 'capital' });
  let caja = capitalA + capitalB;

  // ---------------- Simulacion dia a dia (compras, ventas, devoluciones, mermas) ----------------
  const diasCompra = (() => {
    const k = cuentas.compras;
    const idx = new Set([0]);
    for (let j = 1; j < k; j += 1) idx.add(Math.min(dias - 8, Math.round((j * (dias - 9)) / k) + az.entre(-2, 2)));
    return [...idx].sort((a, b) => a - b);
  })();
  const ventasPorDia = repartir(cuentas.ventas, pesosDia.map((p, i) => (i < 2 ? 0 : p)));
  const dsPorDia = repartir(cuentas.ds, pesosDia.map((p, i) => (i < 6 ? 0 : p)));
  const devolDias = new Set(Array.from({ length: cuentas.devol }, (_, j) => Math.round(((j + 1) * (dias - 12)) / (cuentas.devol + 1)) + 6));
  const mermaDias = new Set(Array.from({ length: cuentas.merma }, (_, j) => Math.round(((j + 1) * (dias - 14)) / (cuentas.merma + 1)) + 10));

  const devolProvPorDia = new Map();
  const stock = new Map();
  const llave = (m, s) => `${m}|${s}`;
  const llegadas = new Map(); // dia -> [{lineas}]
  const ventas = []; // todas las ventas con cobro pendiente de planear (bodega y dropshipping)
  const compras = [];
  let totalCompraPiezas = 0;
  let nVenta = 0;
  let nDs = 0;
  let nReciente = 0;
  let rentaDevengada = 0;

  const piezasEsperadas = cuentas.ventas * 62;
  const planCompra = (diaIdx, esPrimera) => {
    const proveedor = compras.length % 2 === 0 ? 'Isaac' : 'Karen';
    const objetivo = esPrimera ? Math.round(piezasEsperadas * 0.34) : Math.round((piezasEsperadas * 1.15 - piezasEsperadas * 0.34) / Math.max(1, cuentas.compras - 1));
    const lineas = [];
    let acum = 0;
    const lista = esPrimera ? modelos : az.barajar(modelos).slice(0, Math.max(8, Math.round(modelos.length * 0.55)));
    let guard = 0;
    while (acum < objetivo && guard < 4000) {
      guard += 1;
      const m = elegirModelo(lista);
      const sabor = az.de(m.sabores);
      if (lineas.some((l) => l.modelo === m.nombre && l.sabor === sabor)) continue;
      const piezas = az.de([20, 30, 40, 50, 60, 80]);
      lineas.push({ modelo: m.nombre, sabor, piezas, costo: m.costo[proveedor] });
      acum += piezas;
    }
    const fecha = fechas[diaIdx];
    const llegada = Math.min(dias - 1, diaIdx + az.entre(3, 5));
    const guiaCent = az.entre(8, 30) * 1000;
    const paq = az.de(PAQUETERIAS);
    const mercancia = lineas.reduce((s, l) => s + l.piezas * l.costo, 0);
    const ref = `C${compras.length + 1}`;
    const c = { ref, proveedor, fecha, lineas, guiaCent, paqueteria: paq, guia: `DEMO-${PREFIJO_GUIA[paq]}-${String(300 + compras.length * 7).padStart(6, '0')}`, llegada: fechas[llegada], total: mercancia + guiaCent, diaLlegada: llegada };
    compras.push(c);
    if (compras.length <= 2) { const dd = llegada + 6 + compras.length; if (dd < dias - 1) devolProvPorDia.set(dd, c); }
    totalCompraPiezas += acum;
    llegadas.set(llegada, [...(llegadas.get(llegada) ?? []), c]);
    meter({ fecha, actor: az.de(['A', 'B']), tipo: 'compra', ...c });
    meter({ fecha: fechas[llegada], actor: 'B', tipo: 'recepcion', ref, faltante: llegada % 5 === 0 ? { indice: 0, piezas: 2 } : null });
    return c;
  };

  const sinStock = () => [...stock.values()].every((v) => v < 5);
  for (let d = 0; d < dias; d += 1) {
    const fecha = fechas[d];
    if (diasCompra.includes(d)) planCompra(d, d === 0);
    for (const c of llegadas.get(d) ?? []) {
      c.lineas.forEach((l, i) => {
        const falta = i === 0 && d % 5 === 0 ? 2 : 0;
        stock.set(llave(l.modelo, l.sabor), (stock.get(llave(l.modelo, l.sabor)) ?? 0) + l.piezas - falta);
      });
    }
    const cdev = devolProvPorDia.get(d);
    if (cdev) {
      const l = cdev.lineas[cdev.lineas.length - 1];
      if ((stock.get(llave(l.modelo, l.sabor)) ?? 0) >= 3) {
        stock.set(llave(l.modelo, l.sabor), stock.get(llave(l.modelo, l.sabor)) - 3);
        meter({ fecha, actor: 'B', tipo: 'devolucion_proveedor', proveedor: cdev.proveedor, compra: cdev.ref, modelo: l.modelo, sabor: l.sabor, piezas: 3, motivo: 'Sabor equivocado en el surtido (demo)' });
      }
    }
    if (sinStock()) continue;
    const reciente = d >= dias - 4;
    // --- ventas de bodega ---
    for (let v = 0; v < ventasPorDia[d]; v += 1) {
      for (let intento = 0; intento < 8; intento += 1) {
        const cliente = elegirCliente();
        const cartera = Object.keys(cliente.precios).map((nm) => porNombre.get(nm));
        const lineas = [];
        let piezas = 0;
        const nLin = az.entre(1, 4);
        for (let j = 0; j < nLin; j += 1) {
          const m = elegirModelo(cartera);
          const disp = m.sabores.filter((s) => (stock.get(llave(m.nombre, s)) ?? 0) >= 10 && !lineas.some((l) => l.modelo === m.nombre && l.sabor === s));
          if (!disp.length) continue;
          const sabor = az.de(disp);
          const maximo = Math.min(stock.get(llave(m.nombre, sabor)), 60);
          const p = Math.min(maximo, az.de([10, 15, 20, 25, 30, 40, 50, 60]));
          lineas.push({ modelo: m.nombre, sabor, piezas: p, precio: cliente.precios[m.nombre] });
          piezas += p;
        }
        const conAviso = nVenta % 23 === 17;
        if (!lineas.length || (!conAviso && piezas < 20)) continue;
        for (const l of lineas) stock.set(llave(l.modelo, l.sabor), stock.get(llave(l.modelo, l.sabor)) - l.piezas);
        nVenta += 1;
        const estado = reciente ? ['borrador', 'confirmado', 'enviado', 'enviado'][nReciente++ % 4] : 'enviado';
        const envio = d + (az.prob(0.3) ? 1 : 0);
        const fechaEnvio = fechas[Math.min(envio, dias - 1)];
        const paq = az.de(PAQUETERIAS);
        const venta = {
          ref: `V${nVenta}`, fecha, cliente: cliente.nombre, plazo: cliente.plazo, lineas, estado, fechaEnvio, paqueteria: paq,
          guia: `DEMO-${PREFIJO_GUIA[paq]}-${String(1000 + nVenta * 3).padStart(6, '0')}`, guiaCostoCent: az.entre(9, 38) * 1000,
          excepcion: conAviso ? 'Cliente nuevo: primer pedido de prueba por debajo del minimo' : null,
          entregado: estado === 'enviado' && d <= dias - 6 && az.prob(0.85),
          total: lineas.reduce((s, l) => s + l.piezas * l.precio, 0), devuelto: 0, minCobro: null, origen: 'bodega',
        };
        if (estado === 'enviado') rentaDevengada += piezas * 200;
        ventas.push(venta);
        meter({ actor: az.de(['A', 'B']), tipo: 'venta', ...venta });
        break;
      }
    }
    // --- dropshipping ---
    for (let v = 0; v < dsPorDia[d]; v += 1) {
      nDs += 1;
      const aCosto = nDs % 4 === 0;
      const proveedor = nDs % 3 === 0 ? 'Isaac' : 'Karen';
      const cliente = aCosto ? clienteSocio : elegirCliente();
      const lista = aCosto ? modelos : Object.keys(cliente.precios).map((nm) => porNombre.get(nm));
      const lineas = [];
      const nLin = az.entre(1, 2);
      for (let j = 0; j < nLin; j += 1) {
        const m = elegirModelo(lista);
        const sabor = az.de(m.sabores);
        if (lineas.some((l) => l.modelo === m.nombre && l.sabor === sabor)) continue;
        lineas.push({ modelo: m.nombre, sabor, piezas: az.de([30, 40, 50, 60, 80, 100]), precio: aCosto ? null : cliente.precios[m.nombre], costo: m.costo[proveedor] });
      }
      const costoTotal = lineas.reduce((s, l) => s + l.piezas * l.costo, 0);
      const total = aCosto ? costoTotal : lineas.reduce((s, l) => s + l.piezas * l.precio, 0);
      const venta = { ref: `D${nDs}`, fecha, cliente: cliente.nombre, origen: proveedor, lineas, tipoVenta: aCosto ? 'socio_a_costo' : 'cliente', socio: aCosto ? 'Angelo' : null, costoTotal, total, devuelto: 0, plazo: 0, fechaEnvio: fecha, fechaCompromiso: aCosto ? sumarDias(fecha, 14) : null, minCobro: null };
      ventas.push({ ...venta, origen: 'ds', proveedor });
      meter({ actor: aCosto ? 'A' : az.de(['A', 'B']), tipo: 'ds_venta', ...venta });
    }
    // --- devoluciones ---
    if (devolDias.has(d)) {
      const cand = ventas.filter((x) => x.origen === 'bodega' && x.estado === 'enviado' && sumarDias(x.fechaEnvio, 2) <= fecha && x.devuelto === 0);
      if (cand.length) {
        const venta = cand[az.entre(0, cand.length - 1)];
        const idx = az.entre(0, venta.lineas.length - 1);
        const piezas = Math.min(az.entre(1, 5), venta.lineas[idx].piezas);
        venta.devuelto = piezas * venta.lineas[idx].precio;
        venta.minCobro = sumarDias(fecha, 1);
        stock.set(llave(venta.lineas[idx].modelo, venta.lineas[idx].sabor), (stock.get(llave(venta.lineas[idx].modelo, venta.lineas[idx].sabor)) ?? 0) + piezas);
        rentaDevengada -= piezas * 200;
        meter({ fecha, actor: 'B', tipo: 'devolucion_cliente', ref: venta.ref, indice: idx, piezas, motivo: 'Producto con defecto de fabrica (demo)' });
      }
    }
    if (mermaDias.has(d)) {
      const mayor = [...stock.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (mayor && mayor[1] > 12) {
        const [modelo, sabor] = mayor[0].split('|');
        const piezas = az.entre(2, 6);
        stock.set(mayor[0], mayor[1] - piezas);
        meter({ fecha, actor: 'B', tipo: 'merma', modelo, sabor, piezas, motivo: 'Merma por humedad en bodega (demo)' });
      }
    }
  }

  // ---------------- Pagos a proveedores ----------------
  const pagosPlan = [...compras];
  const viernesSiguiente = (iso) => {
    const dow = diaSemana(iso);
    return sumarDias(iso, (5 - dow + 7) % 7 || 7);
  };
  let nPago = 0;
  for (const c of pagosPlan) {
    nPago += 1;
    const fechaPago = c.proveedor === 'Karen' ? c.fecha : viernesSiguiente(c.llegada);
    if (fechaPago > ultimo) continue;
    const parcial = c.proveedor === 'Isaac' && nPago % 5 === 4;
    const monto = parcial ? centenas(Math.round(c.total * 0.6)) : c.total;
    const desdeCaja = caja >= monto + 2000000 && nPago % 2 === 1;
    if (desdeCaja) caja -= monto;
    meter({ fecha: fechaPago, actor: az.de(['A', 'B']), tipo: 'pago_proveedor', proveedor: c.proveedor, monto, via: desdeCaja ? 'sociedad' : 'socio', socio: nPago % 2 === 0 ? 'Angelo' : 'Javier', ref: c.ref });
  }

  // ---------------- Cobros (reparto del presupuesto restante) ----------------
  const fijos = ops.filter((o) => !TIPOS_CONFIGURACION.has(o.tipo)).length;
  const prevGastos = cuentas.gastos + cuentas.renta + 1; // + el corte mensual (se completa abajo)
  const presupuestoCobros = Math.max(8, N - fijos - prevGastos - 8);
  const elegibles = ventas.filter((v) => (v.origen === 'ds' ? true : v.estado === 'enviado')).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ref.localeCompare(b.ref));
  const cobros = [];
  const neto = (v) => (v.origen === 'ds' ? (v.tipoVenta === 'socio_a_costo' ? v.costoTotal : v.costoTotal) : v.total - v.devuelto);
  for (const v of elegibles) {
    v.pagado = 0;
    v.cobros = 0;
    v.plan = az.r();
  }
  const cuentaCobro = () => az.de(['Efectivo', 'Efectivo', 'Efectivo', 'Angelo', 'Javier']);
  const intentar = (v, pasada) => {
    if (cobros.length >= presupuestoCobros) return false;
    const restante = neto(v) - v.pagado;
    if (restante <= 0) return false;
    const edad = (Date.parse(`${ultimo}T00:00:00Z`) - Date.parse(`${v.fechaEnvio}T00:00:00Z`)) / 86400000;
    if (pasada === 1) {
      // Primera pasada: el 80 % de lo vencido o por vencer se cobra; lo muy viejo se queda sin cobrar para que haya antiguedad.
      const umbral = edad > 60 ? 0.45 : edad > 30 ? 0.12 : 0.05;
      if (v.plan < umbral) return false;
    } else if (v.pagado === 0) return false;
    const dias0 = pasada === 1 ? v.plazo + az.entre(-1, Math.min(18, 3 + Math.floor(edad / 5))) : az.entre(6, 22);
    const base = pasada === 1 ? v.fechaEnvio : v.ultimaFecha;
    let fecha = sumarDias(base, Math.max(0, dias0));
    if (v.minCobro && fecha < v.minCobro) fecha = v.minCobro;
    if (fecha > ultimo) return false;
    const final = pasada === 1 ? az.prob(0.4) : az.prob(0.5);
    const monto = final ? restante : Math.max(1000, centenas(Math.round(restante * az.de([0.35, 0.5, 0.65]))));
    if (monto <= 0 || monto > restante) return false;
    v.pagado += monto;
    v.cobros += 1;
    v.ultimaFecha = fecha;
    const tipo = v.origen === 'ds' ? (v.tipoVenta === 'socio_a_costo' ? 'ds_cobro_menudeo' : 'ds_cobro') : 'cobro';
    const o = { fecha, actor: tipo === 'ds_cobro_menudeo' ? 'A' : az.de(['A', 'B']), tipo, ref: v.ref, monto, cuenta: cuentaCobro(), proveedor: v.proveedor };
    cobros.push(o);
    return true;
  };
  for (let pasada = 1; pasada <= 3; pasada += 1) {
    for (const v of elegibles) intentar(v, pasada);
    // Si sobra presupuesto, otra vuelta de abonos parciales sobre lo que ya tiene algun cobro.
    if (pasada === 3) for (let extra = 0; extra < 8; extra += 1) for (const v of elegibles) if (v.pagado > 0) intentar(v, 3);
  }
  for (const c of cobros) meter(c);

  // ---------------- Gastos, depositos, retiros, traspasos, renta, costos ----------------
  const fechaAleatoria = (desde = 3) => fechas[az.entre(desde, dias - 3)];
  for (let j = 0; j < cuentas.gastos; j += 1) {
    const fecha = fechaAleatoria(4);
    const k = j % 6;
    if (k === 0) meter({ fecha, actor: 'A', tipo: 'gasto_socio', socio: 'Angelo', monto: az.entre(6, 28) * 1000, categoria: 'envio', naturaleza: 'variable', nota: 'Guias del periodo (demo)' });
    else if (k === 1) meter({ fecha, actor: 'B', tipo: 'gasto_socio', socio: 'Javier', monto: az.entre(4, 20) * 1000, categoria: 'papeleria', naturaleza: 'fijo', nota: 'Papeleria y empaque (demo)' });
    else if (k === 2) meter({ fecha, actor: 'B', tipo: 'gasto_empresa', monto: az.entre(3, 15) * 1000, categoria: 'papeleria', naturaleza: 'variable', nota: 'Gasto de caja (demo)' });
    else if (k === 3) meter({ fecha, actor: az.de(['A', 'B']), tipo: 'aportacion', socio: az.de(['Angelo', 'Javier']), monto: az.entre(20, 80) * 10000, concepto: 'Deposito a la caja para pagar proveedores (demo)', intencion: 'reembolso', cuenta: 'Caja de la empresa' });
    else if (k === 4) meter({ fecha, actor: 'B', tipo: 'traspaso', origen: 'Caja de la empresa', destino: 'Efectivo de Angelo', monto: az.entre(5, 20) * 1000 });
    else meter({ fecha, actor: 'A', tipo: 'gasto_socio', socio: 'Angelo', monto: az.entre(5, 18) * 1000, categoria: 'envio', naturaleza: 'variable', nota: 'Guias adicionales (demo)' });
  }
  // Renta de Omar: pagos de una parte de lo devengado, espaciados.
  const rentaTotal = Math.max(0, rentaDevengada);
  for (let j = 0; j < cuentas.renta; j += 1) {
    const dia = Math.round(((j + 1) * (dias - 6)) / (cuentas.renta + 1)) + 2;
    meter({ fecha: fechas[dia], actor: az.de(['A', 'B']), tipo: 'renta_pago', socio: az.de(['Angelo', 'Javier']), monto: Math.max(200, centenas(Math.round((rentaTotal * 0.75) / (cuentas.renta + 1) * ((dia + 1) / dias)))), via: 'efectivo' });
  }
  // Costos del sistema (se cargan en el mes siguiente; solo meses ya terminados dentro de la ventana).
  const [ay, am] = hoy.split('-').map(Number);
  const meses = [];
  for (let k = 1; k <= 3; k += 1) {
    let a = ay;
    let m = am - k;
    while (m < 1) { m += 12; a -= 1; }
    const fin = finDeMes(a, m);
    if (sumarDias(fin, 1) > ultimo || fin < inicio) continue;
    meses.push({ mes: `${a}-${String(m).padStart(2, '0')}`, ini: `${a}-${String(m).padStart(2, '0')}-01`, fin });
  }
  meses.sort((a, b) => a.mes.localeCompare(b.mes));
  // Costos del sistema: el mantenimiento arranca el 2026-11-01 (regla de scripts/costos); se carga el mes en curso al ultimo dia del plan.
  if (ultimo.slice(0, 7) >= '2026-11') meter({ fecha: ultimo, actor: 'B', tipo: 'costos_mes', mes: ultimo.slice(0, 7) });
  // Corte mensual (acta): meses ya completos con ventas; propuesta y firma de los dos.
  const mesesActa = meses.filter((m) => m.ini >= inicio && sumarDias(m.fin, 3) <= ultimo).slice(-2);
  for (const m of mesesActa) meter({ fecha: sumarDias(m.fin, 3), actor: 'A', tipo: 'acta', ini: m.ini, fin: m.fin });

  // ---------------- Relleno exacto hasta `movimientos` (abonos adicionales y gastos pequenos) ----------------
  const contar = () => ops.filter((o) => !TIPOS_CONFIGURACION.has(o.tipo)).length + ops.filter((o) => o.tipo === 'acta').length * 2;
  let relleno = 0;
  while (contar() < N && relleno < 400) {
    relleno += 1;
    const fecha = fechas[az.entre(Math.floor(dias / 3), dias - 2)];
    meter({ fecha, actor: 'B', tipo: 'gasto_empresa', monto: az.entre(2, 9) * 1000, categoria: 'papeleria', naturaleza: 'variable', nota: 'Gasto menor de caja (demo)' });
  }
  while (contar() > N) {
    const i = ops.map((o, k) => ({ o, k })).reverse().find((x) => x.o.tipo === 'gasto_empresa' || x.o.tipo === 'gasto_socio')?.k;
    if (i === undefined) break;
    ops.splice(i, 1);
  }

  // ---------------- Orden cronologico estable y claves ----------------
  const orden = ops.map((o, i) => ({ o, i })).sort((a, b) => a.o.fecha.localeCompare(b.o.fecha) || RANGO[a.o.tipo] - RANGO[b.o.tipo] || a.i - b.i).map((x) => x.o);
  orden.forEach((o, i) => { o.n = i + 1; });

  const porTipo = {};
  for (const o of orden) porTipo[o.tipo] = (porTipo[o.tipo] ?? 0) + 1;
  return {
    meta: { semilla, hoy, inicio, ultimo, movimientos: contar(), operaciones: orden.length, semanas: SEMANAS, porTipo, piezasCompradas: totalCompraPiezas },
    usuarios: USUARIOS,
    catalogo: { modelos, proveedores: ['Isaac', 'Karen'] },
    clientes: todosClientes,
    personaBodega: 'Bodega Demo (socios)',
    ops: orden,
  };
}
