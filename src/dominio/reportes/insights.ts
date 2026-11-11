// Motor de insights por reglas deterministas (spec 16, sec. 5): 25 plantillas con umbral, muestra minima, severidad y frase con marcadores.
// El codigo calcula, el texto solo lleva marcadores {{cifra:id}} que se sustituyen desde el paquete. Nada de IA.
// Los umbrales son [CAL]: se recalibran con 8 a 12 semanas de datos reales.
import type { LibroCifras } from './cifras';
import type { HistoriaCliente, InsumosSemanal, ModeloInventario, PedidoInsumo } from './insumos';
import { PARAMETROS } from './parametros';
import { type AgregadoModelo, agregarPorModelo, contribucionModelo } from './puente';
import { coberturaViernes, diasEntre, puntoReorden } from './proyecciones';
import type { Clase, FormatoCifra, Severidad, Unidad } from './tipos';
import { bp, cmpTexto, medianaNum, sumaBig } from './util';

export interface ValorInsight {
  readonly valor: bigint;
  readonly unidad: Unidad;
  readonly formato?: FormatoCifra;
  readonly clase?: Clase;
  readonly n?: number;
  readonly via2?: bigint;
}

export type TipoAccion = 'reponer' | 'renegociar' | 'cobrar' | 'dejar_de_surtir';
export interface AccionSugerida {
  readonly tipo: TipoAccion;
  /** Texto con marcadores locales {{clave}} (de los valores del disparo). */
  readonly titulo: string;
  readonly dinero4semCent: bigint;
  readonly rangoCent?: { readonly lo: bigint; readonly hi: bigint };
  readonly vencePorDias: number;
  readonly confianza: 'observado' | 'estimado_doble' | 'estimado_minimo';
  readonly quien?: string;
  readonly porque: string;
}

export interface Disparo {
  readonly entidad: string;
  readonly severidad: Severidad;
  readonly dineroCent: bigint;
  readonly v: Readonly<Record<string, ValorInsight>>;
  /** Frase con marcadores locales {{clave}}; el nombre de la entidad va como texto. */
  readonly texto: string;
  readonly hipotesis?: boolean;
  readonly accion?: AccionSugerida;
}

export interface PocosDatos {
  readonly tema: string;
  readonly n: number;
  readonly m: number;
}
export interface ResultadoRegla {
  readonly disparos: readonly Disparo[];
  readonly pocosDatos: readonly PocosDatos[];
}

export interface PlantillaInsight {
  readonly id: string;
  readonly nombre: string;
  readonly regla: string;
  readonly umbral: string;
  readonly muestraMin: string;
  readonly evaluar: (c: Contexto) => ResultadoRegla;
}

export interface ClientePeriodo {
  readonly clienteId: string;
  readonly cliente: string;
  readonly piezas: number;
  readonly ventasCent: bigint;
  readonly contribCent: bigint;
  readonly pedidos: number;
}

export interface Contexto {
  readonly ins: InsumosSemanal;
  readonly clientes: readonly ClientePeriodo[];
  readonly modelos: readonly AgregadoModelo[];
  readonly ventasCent: bigint;
  readonly costoCent: bigint;
  readonly contribCent: bigint;
}

export const contribPedido = (p: PedidoInsumo): bigint => {
  const v = p.lineas.reduce((a, l) => a + l.precioCent * BigInt(l.piezas), 0n);
  const c = p.lineas.reduce((a, l) => a + l.costoCent * BigInt(l.piezas), 0n);
  const pz = p.lineas.reduce((a, l) => a + l.piezas, 0);
  const renta = p.origen === 'bodega' ? PARAMETROS.rentaBodegaCentPorPz * BigInt(pz) : 0n;
  return v - c - p.guiaCent - p.mensajeroCent - renta;
};

export function clientesDelPeriodo(pedidos: readonly PedidoInsumo[]): ClientePeriodo[] {
  const m = new Map<string, { cliente: string; piezas: number; ventas: bigint; contrib: bigint; pedidos: number }>();
  for (const p of pedidos) {
    const a = m.get(p.clienteId) ?? { cliente: p.cliente, piezas: 0, ventas: 0n, contrib: 0n, pedidos: 0 };
    a.piezas += p.lineas.reduce((s, l) => s + l.piezas, 0);
    a.ventas += p.lineas.reduce((s, l) => s + l.precioCent * BigInt(l.piezas), 0n);
    a.contrib += contribPedido(p);
    a.pedidos += 1;
    m.set(p.clienteId, a);
  }
  return [...m.entries()].map(([clienteId, a]) => ({ clienteId, cliente: a.cliente, piezas: a.piezas, ventasCent: a.ventas, contribCent: a.contrib, pedidos: a.pedidos })).sort((x, y) => (x.ventasCent === y.ventasCent ? cmpTexto(x.cliente, y.cliente) : x.ventasCent > y.ventasCent ? -1 : 1));
}

export function crearContexto(ins: InsumosSemanal): Contexto {
  const modelos = agregarPorModelo(ins.pedidos);
  return {
    ins,
    clientes: clientesDelPeriodo(ins.pedidos),
    modelos,
    ventasCent: sumaBig(modelos.map((m) => m.ventaCent)),
    costoCent: sumaBig(modelos.map((m) => m.costoCent)),
    contribCent: sumaBig(modelos.map(contribucionModelo)),
  };
}

// ---------- helpers ----------
const ok = (disparos: Disparo[] = [], pocosDatos: PocosDatos[] = []): ResultadoRegla => ({ disparos, pocosDatos });
const abs = (x: bigint): bigint => (x < 0n ? -x : x);
const semanaDe = (fecha: string, fin: string): number => Math.floor(diasEntre(fecha, fin) / 7);
const num = Number;

function serieSemanal(h: HistoriaCliente, fin: string, desde: number, hasta: number, campo: 'piezas' | 'ventasCent'): number[] {
  const out: number[] = [];
  for (let k = desde; k <= hasta; k++) out.push(h.pedidos.filter((p) => semanaDe(p.fecha, fin) === k).reduce((a, p) => a + num(p[campo]), 0));
  return out;
}

const sev3 = (x: number, nota: number, atencion: number, alerta: number): Severidad | null => (x < alerta ? 'alerta' : x < atencion ? 'atencion' : x < nota ? 'nota' : null);
const sevAlta = (x: number, atencion: number, alerta: number): Severidad | null => (x > alerta ? 'alerta' : x > atencion ? 'atencion' : null);

const modeloReorden = (m: ModeloInventario) => puntoReorden({ ventasSemanales: m.ventasSemanales, existencia: m.existencia, enTransito: m.enTransito, leadTime: m.leadTime, piezasPorCaja: m.piezasPorCaja });

// ---------- las 25 plantillas ----------

const I01: PlantillaInsight = {
  id: 'I01',
  nombre: 'Cliente compra menos que su ritmo',
  regla: 'Piezas del cliente en 4 semanas / mediana de sus 8 semanas previas',
  umbral: '< 0.9 nota, < 0.8 atención, < 0.6 alerta',
  muestraMin: '4 pedidos',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const pocos: PocosDatos[] = [];
    for (const h of c.ins.clientes) {
      const fin = c.ins.fin;
      if (h.pedidos.length < 4) {
        const cp = c.clientes.find((x) => x.clienteId === h.clienteId);
        if (h.declarado && cp) {
          const previo = h.declarado.ventasSemanaCent;
          const piso = previo - (previo * BigInt(h.declarado.rangoPct)) / 100n;
          if (cp.ventasCent < piso) {
            const pct = bp(previo - cp.ventasCent, previo);
            disparos.push({ entidad: h.cliente, severidad: 'nota', dineroCent: previo - cp.ventasCent, hipotesis: true, v: { pct: { valor: pct, unidad: 'bp', formato: 'pct0', clase: 'Calculado' }, actual: { valor: cp.ventasCent, unidad: 'cent', clase: 'Observado', n: cp.pedidos }, previo: { valor: previo, unidad: 'cent', clase: 'Declarado' } }, texto: `${h.cliente} compra {{pct}} menos que el ritmo declarado ({{actual}} contra {{previo}} por semana; Declarado, no observado).` });
          }
        } else pocos.push({ tema: `el ritmo de ${h.cliente}`, n: h.pedidos.length, m: 4 });
        continue;
      }
      const rec = serieSemanal(h, fin, 0, 3, 'piezas');
      const prev = serieSemanal(h, fin, 4, 11, 'piezas');
      const medPrev = medianaNum(prev) * 4;
      if (medPrev <= 0) continue;
      const ratio = rec.reduce((a, b) => a + b, 0) / medPrev;
      const sev = sev3(ratio, 0.9, 0.8, 0.6);
      if (!sev) continue;
      const vRec = serieSemanal(h, fin, 0, 3, 'ventasCent').reduce((a, b) => a + b, 0) / 4;
      const vPrev = medianaNum(serieSemanal(h, fin, 4, 11, 'ventasCent'));
      const actual = BigInt(Math.round(vRec));
      const previo = BigInt(Math.round(vPrev));
      if (previo <= 0n) continue;
      disparos.push({ entidad: h.cliente, severidad: sev, dineroCent: previo > actual ? (previo - actual) * 4n : 0n, v: { pct: { valor: bp(previo - actual, previo), unidad: 'bp', formato: 'pct0', clase: 'Calculado' }, actual: { valor: actual, unidad: 'cent', clase: 'Observado', n: h.pedidos.length }, previo: { valor: previo, unidad: 'cent', clase: 'Calculado' } }, texto: `${h.cliente} compra {{pct}} menos que su promedio ({{actual}} contra {{previo}} por semana).` });
    }
    return ok(disparos, pocos);
  },
};

const I02: PlantillaInsight = {
  id: 'I02',
  nombre: 'Recencia de compra',
  regla: 'Días desde el último pedido / mediana de sus intervalos',
  umbral: '> 1.5 atención, > 2.5 alerta',
  muestraMin: '4 pedidos',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const pocos: PocosDatos[] = [];
    for (const h of c.ins.clientes) {
      if (h.pedidos.length < 4) {
        pocos.push({ tema: `la recencia de ${h.cliente}`, n: h.pedidos.length, m: 4 });
        continue;
      }
      const fechas = h.pedidos.map((p) => p.fecha).sort();
      const intervalos = fechas.slice(1).map((f, i) => diasEntre(fechas[i]!, f));
      const med = medianaNum(intervalos);
      const dias = diasEntre(fechas[fechas.length - 1]!, c.ins.fin);
      if (med <= 0) continue;
      const sev = sevAlta(dias / med, 1.5, 2.5);
      if (!sev) continue;
      const ticket = BigInt(Math.round(medianaNum(h.pedidos.map((p) => num(p.ventasCent)))));
      disparos.push({ entidad: h.cliente, severidad: sev, dineroCent: ticket, v: { dias: { valor: BigInt(dias), unidad: 'dias', clase: 'Observado' }, ritmo: { valor: BigInt(Math.round(med)), unidad: 'dias', clase: 'Calculado' } }, texto: `${h.cliente} lleva {{dias}}; su ritmo es {{ritmo}}.` });
    }
    return ok(disparos, pocos);
  },
};

const I03: PlantillaInsight = {
  id: 'I03',
  nombre: 'Concentración de clientes',
  regla: 'Participación del cliente mayor y HHI de ventas',
  umbral: 'mayor > 30 % atención, > 40 % alerta; HHI > 2,500',
  muestraMin: '5 clientes',
  evaluar: (c) => {
    if (c.clientes.length < 5) return ok([], [{ tema: 'la concentración de clientes', n: c.clientes.length, m: 5 }]);
    const total = c.ventasCent;
    if (total <= 0n) return ok();
    const mayor = c.clientes[0]!;
    const top2 = c.clientes[0]!.ventasCent + c.clientes[1]!.ventasCent;
    const hhi = c.clientes.reduce((a, x) => a + (x.ventasCent * x.ventasCent * 10_000n) / (total * total), 0n);
    const pctMayor = num(bp(mayor.ventasCent, total)) / 100;
    const sev: Severidad | null = pctMayor > 40 ? 'alerta' : pctMayor > 30 || hhi > 2500n ? 'atencion' : null;
    if (!sev) return ok();
    return ok([{ entidad: 'cartera', severidad: sev, dineroCent: mayor.ventasCent, v: { top2: { valor: bp(top2, total), unidad: 'bp', formato: 'pct0', clase: 'Calculado' }, hhi: { valor: hhi, unidad: 'n', clase: 'Calculado' } }, texto: 'Dos clientes son {{top2}} de las ventas; HHI {{hhi}}.' }]);
  },
};

const I04: PlantillaInsight = {
  id: 'I04',
  nombre: 'Cliente de más piezas que no es de más utilidad',
  regla: 'El cliente #1 en piezas queda fuera del top 3 en utilidad',
  umbral: 'fuera del top 3',
  muestraMin: '3 clientes',
  evaluar: (c) => {
    if (c.clientes.length < 3) return ok([], [{ tema: 'el ranking de clientes', n: c.clientes.length, m: 3 }]);
    const porPiezas = [...c.clientes].sort((a, b) => b.piezas - a.piezas || cmpTexto(a.cliente, b.cliente));
    const porUtilidad = [...c.clientes].sort((a, b) => (a.contribCent === b.contribCent ? cmpTexto(a.cliente, b.cliente) : a.contribCent > b.contribCent ? -1 : 1));
    const primero = porPiezas[0]!;
    const rango = porUtilidad.findIndex((x) => x.clienteId === primero.clienteId) + 1;
    if (rango <= 3) return ok();
    return ok([{ entidad: primero.cliente, severidad: 'atencion', dineroCent: porUtilidad[0]!.contribCent - primero.contribCent, v: { rango: { valor: BigInt(rango), unidad: 'n', clase: 'Calculado' } }, texto: `${primero.cliente} es el #1 en piezas y el #{{rango}} en utilidad.` }]);
  },
};

const I05: PlantillaInsight = {
  id: 'I05',
  nombre: 'Cambio de la posición entre socios',
  regla: 'Variación de la diferencia entre socios en el periodo',
  umbral: '> $5,000 o 20 %',
  muestraMin: '1 periodo',
  evaluar: (c) => {
    const s = c.ins.socios;
    if (!s) return ok([], [{ tema: 'la posición entre socios', n: 0, m: 1 }]);
    const d = abs(s.diferenciaCent - s.diferenciaAnteriorCent);
    const rel = s.diferenciaAnteriorCent === 0n ? 0n : bp(d, abs(s.diferenciaAnteriorCent));
    if (d <= 500_000n && rel <= 2000n) return ok();
    return ok([{ entidad: 'socios', severidad: 'atencion', dineroCent: d, v: { antes: { valor: s.diferenciaAnteriorCent, unidad: 'cent', clase: 'Calculado' }, ahora: { valor: s.diferenciaCent, unidad: 'cent', clase: 'Calculado' } }, texto: 'La posición entre socios pasó de {{antes}} a {{ahora}}.' }]);
  },
};

const I06: PlantillaInsight = {
  id: 'I06',
  nombre: 'Ticket bajo',
  regla: 'Ticket del último pedido / mediana de sus 13 semanas',
  umbral: '< 70 %',
  muestraMin: '4 pedidos',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const pocos: PocosDatos[] = [];
    for (const h of c.ins.clientes) {
      if (h.pedidos.length < 4) {
        pocos.push({ tema: `el ticket de ${h.cliente}`, n: h.pedidos.length, m: 4 });
        continue;
      }
      const ultimo = h.pedidos[h.pedidos.length - 1]!;
      if (ultimo.fecha < c.ins.inicio) continue;
      const med = BigInt(Math.round(medianaNum(h.pedidos.map((p) => num(p.ventasCent)))));
      if (med <= 0n || ultimo.ventasCent * 100n >= med * 70n) continue;
      disparos.push({ entidad: h.cliente, severidad: 'atencion', dineroCent: med - ultimo.ventasCent, v: { ticket: { valor: ultimo.ventasCent, unidad: 'cent', clase: 'Observado' }, mediana: { valor: med, unidad: 'cent', clase: 'Calculado', n: h.pedidos.length } }, texto: `${h.cliente} pidió {{ticket}}; su mediana es {{mediana}}.` });
    }
    return ok(disparos, pocos);
  },
};

const I07: PlantillaInsight = {
  id: 'I07',
  nombre: 'Sabor abandonado',
  regla: 'Sabor con más de 15 % del cliente cae a menos de la mitad en 8 semanas, con existencia',
  umbral: 'participación reciente < mitad de la previa',
  muestraMin: '3 pedidos y 60 pz',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const pocos: PocosDatos[] = [];
    const conExistencia = new Set(c.ins.inventario.flatMap((m) => m.sabores.filter((s) => s.existencia > 0).map((s) => s.sabor)));
    for (const h of c.ins.clientes) {
      const pz = h.pedidos.reduce((a, p) => a + p.piezas, 0);
      if (h.pedidos.length < 3 || pz < 60) {
        pocos.push({ tema: `los gustos de ${h.cliente}`, n: pz, m: 60 });
        continue;
      }
      const previos = h.pedidos.filter((p) => semanaDe(p.fecha, c.ins.fin) >= 8);
      const recientes = h.pedidos.filter((p) => semanaDe(p.fecha, c.ins.fin) < 8);
      const suma = (ps: typeof h.pedidos, sabor: string) => ps.reduce((a, p) => a + (p.sabores?.[sabor] ?? 0), 0);
      const totalPrev = previos.reduce((a, p) => a + p.piezas, 0);
      const totalRec = recientes.reduce((a, p) => a + p.piezas, 0);
      if (totalPrev === 0 || totalRec === 0) continue;
      const sabores = new Set(previos.flatMap((p) => Object.keys(p.sabores ?? {})));
      for (const s of [...sabores].sort(cmpTexto)) {
        const shPrev = suma(previos, s) / totalPrev;
        const shRec = suma(recientes, s) / totalRec;
        if (shPrev > 0.15 && shRec < shPrev / 2 && conExistencia.has(s)) {
          const ultima = recientes.filter((p) => (p.sabores?.[s] ?? 0) > 0).map((p) => p.fecha).sort().pop();
          const semanas = ultima ? semanaDe(ultima, c.ins.fin) : 8;
          disparos.push({ entidad: `${h.cliente}:${s}`, severidad: 'atencion', dineroCent: 0n, v: { semanas: { valor: BigInt(semanas), unidad: 'n', clase: 'Observado' } }, texto: `${h.cliente} dejó ${s} hace {{semanas}} semanas.` });
        }
      }
    }
    return ok(disparos, pocos);
  },
};

const I08: PlantillaInsight = {
  id: 'I08',
  nombre: 'Modelo de más piezas que no es de más utilidad',
  regla: 'El modelo #1 en piezas queda fuera del top 3 en utilidad',
  umbral: 'fuera del top 3',
  muestraMin: '20 pz',
  evaluar: (c) => {
    const pz = c.modelos.reduce((a, m) => a + m.piezas, 0);
    if (pz < 20 || c.modelos.length < 4) return ok([], [{ tema: 'el ranking de modelos', n: pz, m: 20 }]);
    const porPiezas = [...c.modelos].sort((a, b) => b.piezas - a.piezas || cmpTexto(a.modelo, b.modelo));
    const porUtilidad = [...c.modelos].sort((a, b) => (contribucionModelo(a) === contribucionModelo(b) ? cmpTexto(a.modelo, b.modelo) : contribucionModelo(a) > contribucionModelo(b) ? -1 : 1));
    const primero = porPiezas[0]!;
    if (porUtilidad.findIndex((m) => m.modelo === primero.modelo) < 3) return ok();
    return ok([{ entidad: primero.modelo, severidad: 'nota', dineroCent: contribucionModelo(porUtilidad[0]!) - contribucionModelo(primero), v: {}, texto: `${primero.modelo} vende más piezas; ${porUtilidad[0]!.modelo} deja más utilidad.` }]);
  },
};

const I09: PlantillaInsight = {
  id: 'I09',
  nombre: 'Caída de margen por cambio de costo',
  regla: 'Contribución por pieza cae >= $10 o >= 30 % contra su mediana tras un cambio de costo registrado',
  umbral: '>= $10 o >= 30 %',
  muestraMin: '1 cambio de costo registrado',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    for (const m of c.ins.inventario) {
      if (!m.cambioCosto || m.contribMedianaPorPiezaCent === undefined) continue;
      const caida = m.contribMedianaPorPiezaCent - m.contribPorPiezaCent;
      if (caida < 1000n && !(m.contribMedianaPorPiezaCent > 0n && caida * 100n >= m.contribMedianaPorPiezaCent * 30n)) continue;
      const semanales = BigInt(Math.round(medianaNum(m.ventasSemanales.length ? m.ventasSemanales : [0])));
      const mejor = caida * semanales;
      disparos.push({
        entidad: m.modelo,
        severidad: 'atencion',
        dineroCent: mejor * 4n,
        v: { caida: { valor: caida, unidad: 'cent', clase: 'Calculado' }, clientes: { valor: BigInt(m.cambioCosto.clientesAlMismoPrecio), unidad: 'n', clase: 'Observado' }, semanal: { valor: mejor, unidad: 'cent', clase: 'Estimado', n: m.ventasSemanales.length } },
        texto: `El margen de ${m.modelo} cayó {{caida}} por pieza por el nuevo costo; {{clientes}} clientes siguen al mismo precio.`,
        accion: { tipo: 'renegociar', titulo: `Renegociar el precio de ${m.modelo} con {{clientes}} clientes: recupera cerca de {{semanal}} por semana.`, dinero4semCent: mejor * 4n, rangoCent: { lo: (mejor * 3n) / 4n, hi: (mejor * 5n) / 4n }, vencePorDias: 7, confianza: m.ventasSemanales.length >= 8 ? 'estimado_doble' : 'estimado_minimo', quien: 'Javier', porque: 'costo nuevo registrado y margen por pieza' },
      });
    }
    return ok(disparos);
  },
};

const I10: PlantillaInsight = {
  id: 'I10',
  nombre: 'Líneas bajo el piso de margen',
  regla: 'Precio - costo de reposición < guía esperada + $2',
  umbral: 'precio - reposición < guía esperada + $2',
  muestraMin: '1 línea',
  evaluar: (c) => {
    const rep = new Map(c.ins.inventario.map((m) => [m.modelo, m.costoReposicionCent]));
    let lineas = 0;
    let piezas = 0;
    let perdida = 0n;
    for (const p of c.ins.pedidos) {
      const pz = p.lineas.reduce((a, l) => a + l.piezas, 0);
      if (pz === 0) continue;
      const guiaPz = p.guiaCent / BigInt(pz);
      for (const l of p.lineas) {
        const r = rep.get(l.modelo);
        if (r === undefined) continue;
        const piso = guiaPz + PARAMETROS.rentaBodegaCentPorPz;
        if (l.precioCent - r < piso) {
          lineas += 1;
          piezas += l.piezas;
          perdida += (piso - (l.precioCent - r)) * BigInt(l.piezas);
        }
      }
    }
    if (lineas === 0) return ok();
    const porPieza = perdida / BigInt(piezas);
    return ok([{ entidad: 'lineas', severidad: porPieza > 300n ? 'alerta' : 'atencion', dineroCent: perdida, v: { lineas: { valor: BigInt(lineas), unidad: 'n', clase: 'Observado' }, piezas: { valor: BigInt(piezas), unidad: 'pz', clase: 'Observado' }, porPieza: { valor: porPieza, unidad: 'cent', clase: 'Calculado' } }, texto: '{{lineas}} líneas bajo el piso: {{piezas}}, pérdida de {{porPieza}} por pieza.', accion: { tipo: 'renegociar', titulo: 'Subir el precio de {{lineas}} líneas bajo el piso hasta cubrir guía y renta.', dinero4semCent: perdida * 4n, vencePorDias: 7, confianza: 'observado', quien: 'Angelo', porque: 'precio menos costo de reposición contra guía esperada' } }]);
  },
};

const I11: PlantillaInsight = {
  id: 'I11',
  nombre: 'Precio distinto del tabulador',
  regla: 'Precio distinto del tabulador sin excepción',
  umbral: 'diferencia sin excepción',
  muestraMin: '1 línea',
  evaluar: (c) => {
    const notas = new Set<string>();
    let dif = 0n;
    for (const p of c.ins.pedidos)
      for (const l of p.lineas) {
        if (l.precioTabuladorCent === undefined || l.conExcepcion || l.precioTabuladorCent === l.precioCent) continue;
        notas.add(p.folio);
        dif += (l.precioTabuladorCent - l.precioCent) * BigInt(l.piezas);
      }
    if (notas.size === 0) return ok();
    return ok([{ entidad: 'tabulador', severidad: 'atencion', dineroCent: abs(dif), v: { notas: { valor: BigInt(notas.size), unidad: 'n', clase: 'Observado' }, dif: { valor: abs(dif), unidad: 'cent', clase: 'Calculado' } }, texto: '{{notas}} notas con {{dif}} de diferencia contra el tabulador sin excepción.' }]);
  },
};

const I12: PlantillaInsight = {
  id: 'I12',
  nombre: 'Modelo en cuadrante Revisar',
  regla: 'Rotación alta y margen bajo la mediana, 3 semanas seguidas',
  umbral: '3 semanas seguidas',
  muestraMin: '8 modelos',
  evaluar: (c) => {
    if (c.ins.inventario.length < 8) return ok([], [{ tema: 'el cuadrante Revisar', n: c.ins.inventario.length, m: 8 }]);
    const disparos: Disparo[] = [];
    for (const m of c.ins.inventario) {
      if (!m.revisar || m.revisar.semanasSeguidas < 3) continue;
      disparos.push({ entidad: m.modelo, severidad: 'atencion', dineroCent: 0n, v: { veces: { valor: m.revisar.rotacionMilesimas, unidad: 'milesimas', clase: 'Calculado' }, porPieza: { valor: m.contribPorPiezaCent, unidad: 'cent', clase: 'Calculado' } }, texto: `${m.modelo} rota {{veces}} veces la mediana con {{porPieza}} por pieza.` });
    }
    return ok(disparos);
  },
};

const I13: PlantillaInsight = {
  id: 'I13',
  nombre: 'Se acaba pronto',
  regla: 'Cobertura menor a 7 días con demanda estable',
  umbral: '< 7 días atención, < 3 días alerta',
  muestraMin: '4 semanas del modelo',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const pocos: PocosDatos[] = [];
    for (const m of c.ins.inventario) {
      const r = modeloReorden(m);
      if (!r.emite) {
        pocos.push({ tema: `la cobertura de ${m.modelo}`, n: m.ventasSemanales.length, m: PARAMETROS.reorden.minSemanasModelo });
        continue;
      }
      const dias = r.datos.coberturaDias;
      if (dias === null || dias >= PARAMETROS.cobertura.minimo) continue;
      const dd = BigInt(Math.round(dias));
      const faltante = Math.max(0, m.leadTime.dias + PARAMETROS.reorden.revisionDias - dias);
      const perdida = BigInt(Math.round(r.datos.demandaDiaria * faltante)) * m.contribPorPiezaCent;
      const pedir = BigInt(r.datos.pedir);
      disparos.push({
        entidad: m.modelo,
        severidad: dias < 3 ? 'alerta' : 'atencion',
        dineroCent: perdida,
        v: { dias: { valor: dd, unidad: 'dias', clase: 'Estimado', n: r.ventana.n }, pedir: { valor: pedir, unidad: 'pz', clase: 'Estimado' }, costo: { valor: pedir * m.costoReposicionCent, unidad: 'cent', clase: 'Estimado' } },
        texto: `${m.modelo} se acaba en {{dias}}.`,
        accion: { tipo: 'reponer', titulo: `Reponer ${m.modelo}: cobertura {{dias}}; pedir {{pedir}} por cerca de {{costo}}.`, dinero4semCent: perdida, vencePorDias: Math.max(1, Math.round(dias)), confianza: r.ventana.n >= 2 * PARAMETROS.reorden.minSemanasModelo ? 'estimado_doble' : 'estimado_minimo', quien: 'Angelo', porque: 'cobertura, promedio móvil y rango de demanda' },
      });
    }
    return ok(disparos, pocos);
  },
};

const I14: PlantillaInsight = {
  id: 'I14',
  nombre: 'Capital parado',
  regla: 'Existencia > 0 y (cobertura > 56 días, o 21 días sin venta con valor > 1 caja)',
  umbral: '> 56 d o 21 d sin venta',
  muestraMin: '4 semanas del modelo',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    for (const m of c.ins.inventario) {
      if (m.existencia <= 0 || m.ventasSemanales.length < PARAMETROS.reorden.minSemanasModelo) continue;
      const r = modeloReorden(m);
      const cobAlta = r.emite && r.datos.coberturaDias !== null && r.datos.coberturaDias > PARAMETROS.cobertura.maximo;
      const valor = BigInt(m.existencia) * m.costoPromCent;
      const sinVenta = m.diasSinVenta >= 21 && m.existencia > m.piezasPorCaja;
      if (!cobAlta && !sinVenta) continue;
      disparos.push({
        entidad: m.modelo,
        severidad: 'atencion',
        dineroCent: valor,
        v: { dias: { valor: BigInt(m.diasSinVenta), unidad: 'dias', clase: 'Observado' }, valor: { valor, unidad: 'cent', clase: 'Calculado' } },
        texto: `${m.modelo}: {{dias}} sin venta, {{valor}} parados.`,
        accion: { tipo: 'dejar_de_surtir', titulo: `Ofrecer ${m.modelo} a quien lo compró y no reponer: libera {{valor}}.`, dinero4semCent: valor, vencePorDias: 28, confianza: 'observado', quien: 'Angelo', porque: 'días sin venta y capital inmovilizado' },
      });
    }
    return ok(disparos);
  },
};

const I15: PlantillaInsight = {
  id: 'I15',
  nombre: 'Sabor sobrestockeado',
  regla: 'Sabor con más de 20 % del stock del modelo y menos de 5 % de la demanda',
  umbral: '> 20 % del stock y < 5 % de la demanda',
  muestraMin: '28 d y 20 pz',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    for (const m of c.ins.inventario) {
      const demanda = m.sabores.reduce((a, s) => a + s.vendidas28, 0);
      const stock = m.sabores.reduce((a, s) => a + s.existencia, 0);
      if (demanda < 20 || stock === 0) continue;
      const exceso = m.sabores.find((s) => s.existencia * 100 > stock * 20 && s.vendidas28 * 100 < demanda * 5);
      const mejor = [...m.sabores].sort((a, b) => b.vendidas28 - a.vendidas28)[0]!;
      if (!exceso) continue;
      const diasExceso = exceso.vendidas28 > 0 ? Math.round((exceso.existencia / exceso.vendidas28) * 28) : 999;
      const diasMejor = mejor.vendidas28 > 0 ? Math.round((mejor.existencia / mejor.vendidas28) * 28) : 0;
      disparos.push({ entidad: `${m.modelo}:${exceso.sabor}`, severidad: 'nota', dineroCent: BigInt(exceso.existencia) * m.costoPromCent, v: { diasExceso: { valor: BigInt(diasExceso), unidad: 'dias', clase: 'Estimado' }, diasMejor: { valor: BigInt(diasMejor), unidad: 'dias', clase: 'Estimado' } }, texto: `${exceso.sabor} tiene {{diasExceso}} de cobertura; ${mejor.sabor}, {{diasMejor}}.` });
    }
    return ok(disparos);
  },
};

const I16: PlantillaInsight = {
  id: 'I16',
  nombre: 'Venta perdida por sabor agotado',
  regla: 'Sabor agotado con 10 o más piezas vendidas en 4 semanas: venta perdida = v x días x contribución',
  umbral: '>= 10 pz en 4 semanas',
  muestraMin: '28 d',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    for (const m of c.ins.inventario)
      for (const s of m.sabores) {
        if (s.existencia > 0 || s.vendidas28 < 10 || s.diasAgotado <= 0) continue;
        const pz = Math.round((s.vendidas28 / 28) * s.diasAgotado);
        disparos.push({ entidad: `${m.modelo}:${s.sabor}`, severidad: 'atencion', dineroCent: BigInt(pz) * m.contribPorPiezaCent, v: { dias: { valor: BigInt(s.diasAgotado), unidad: 'dias', clase: 'Observado' }, pz: { valor: BigInt(pz), unidad: 'pz', clase: 'Estimado' } }, texto: `${s.sabor}, {{dias}} agotado: unas {{pz}} (Estimado).` });
      }
    return ok(disparos);
  },
};

const I17: PlantillaInsight = {
  id: 'I17',
  nombre: 'Exactitud del conteo',
  regla: 'Exactitud < 98 % o error de valor > 0.5 %; puente abierto',
  umbral: '< 98 % de líneas cuadran',
  muestraMin: '1 conteo',
  evaluar: (c) => {
    const k = c.ins.conteo;
    if (!k) return ok([], [{ tema: 'el conteo de inventario', n: 0, m: 1 }]);
    const exacto = k.lineasTotal === 0 ? 10_000n : bp(BigInt(k.lineasCuadran), BigInt(k.lineasTotal));
    if (exacto >= 9800n && k.piezasPuente === 0) return ok();
    return ok([{ entidad: 'conteo', severidad: exacto < 9800n ? 'atencion' : 'nota', dineroCent: abs(k.valorPuenteCent), v: { cuadran: { valor: BigInt(k.lineasCuadran), unidad: 'n', clase: 'Observado' }, total: { valor: BigInt(k.lineasTotal), unidad: 'n', clase: 'Observado' }, pz: { valor: BigInt(k.piezasPuente), unidad: 'pz', clase: 'Observado' }, valor: { valor: k.valorPuenteCent, unidad: 'cent', formato: 'centavos', clase: 'Calculado' } }, texto: '{{cuadran}} de {{total}} líneas cuadran; {{pz}} ({{valor}}) en puente.' }]);
  },
};

const I18: PlantillaInsight = {
  id: 'I18',
  nombre: 'Fuga de piezas',
  regla: 'Salidas - cobradas - autorizadas distinto de cero',
  umbral: '<> 0',
  muestraMin: '1 pedido',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    for (const p of c.ins.pedidos) {
      if (!p.control) continue;
      const dif = p.control.salieron - p.control.cobradas - p.control.autorizadas;
      if (dif === 0) continue;
      const pz = p.lineas.reduce((a, l) => a + l.piezas, 0);
      const precio = pz > 0 ? p.lineas.reduce((a, l) => a + l.precioCent * BigInt(l.piezas), 0n) / BigInt(pz) : 0n;
      disparos.push({ entidad: p.folio, severidad: 'alerta', dineroCent: abs(BigInt(dif)) * precio, v: { sal: { valor: BigInt(p.control.salieron), unidad: 'pz', clase: 'Observado' }, cob: { valor: BigInt(p.control.cobradas), unidad: 'pz', clase: 'Observado' } }, texto: `${p.folio}: salieron {{sal}}, se cobraron {{cob}}.` });
    }
    return ok(disparos);
  },
};

const I19: PlantillaInsight = {
  id: 'I19',
  nombre: 'Cartera vencida',
  regla: 'Cartera mayor a 30 días > 20 %, o una partida mayor a 60 días',
  umbral: '> 20 % atención, partida > 60 d alerta',
  muestraMin: 'cartera > 0',
  evaluar: (c) => {
    const total = sumaBig(c.ins.cartera.map((p) => p.saldoCent));
    if (total <= 0n) return ok();
    const vencida = sumaBig(c.ins.cartera.filter((p) => p.dias > 30).map((p) => p.saldoCent));
    const pct = bp(vencida, total);
    const mayor60 = c.ins.cartera.some((p) => p.dias > 60 && p.saldoCent > 0n);
    if (pct <= 2000n && !mayor60) return ok();
    return ok([{ entidad: 'cartera', severidad: mayor60 ? 'alerta' : 'atencion', dineroCent: vencida, v: { pct: { valor: pct, unidad: 'bp', formato: 'pct0', clase: 'Calculado' }, vencida: { valor: vencida, unidad: 'cent', clase: 'Calculado' } }, texto: '{{pct}} de la cartera pasa de treinta días ({{vencida}}).', accion: { tipo: 'cobrar', titulo: 'Cobrar {{vencida}} de cartera vencida: llamar esta semana.', dinero4semCent: vencida, vencePorDias: 7, confianza: 'observado', quien: 'Javier', porque: 'días de antigüedad de la cartera' } }]);
  },
};

const I20: PlantillaInsight = {
  id: 'I20',
  nombre: 'Riesgo de cobro por cliente',
  regla: 'Puntos: saldo > 3 tickets (2), > 30 días (2), > 60 días (4), pagos más lentos (1)',
  umbral: '>= 3 puntos atención, >= 6 alerta',
  muestraMin: '4 pedidos',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const pocos: PocosDatos[] = [];
    for (const p of c.ins.cartera) {
      if (p.saldoCent <= 0n) continue;
      if (p.pedidosHistoria < 4) {
        pocos.push({ tema: `el riesgo de cobro de ${p.cliente}`, n: p.pedidosHistoria, m: 4 });
        continue;
      }
      const tickets = p.ticketMedianoCent > 0n ? (p.saldoCent * 1000n) / p.ticketMedianoCent : 0n;
      let pts = 0;
      if (tickets > 3000n) pts += 2;
      if (p.dias > 30) pts += 2;
      if (p.dias > 60) pts += 4;
      if (p.pagosMasLentos) pts += 1;
      if (pts < 3) continue;
      disparos.push({ entidad: p.cliente, severidad: pts >= 6 ? 'alerta' : 'atencion', dineroCent: p.saldoCent, v: { saldo: { valor: p.saldoCent, unidad: 'cent', clase: 'Observado' }, dias: { valor: BigInt(p.dias), unidad: 'dias', clase: 'Observado' }, tickets: { valor: tickets, unidad: 'milesimas', clase: 'Calculado' } }, texto: `${p.cliente}: {{saldo}}, {{dias}}, {{tickets}} tickets.`, accion: { tipo: 'cobrar', titulo: `Cobrar {{saldo}} a ${p.cliente} con {{dias}}: llamar esta semana.`, dinero4semCent: p.saldoCent, vencePorDias: 7, confianza: 'observado', quien: 'Javier', porque: 'saldo, días y tickets del cliente' } });
    }
    return ok(disparos, pocos);
  },
};

const I21: PlantillaInsight = {
  id: 'I21',
  nombre: 'Cobertura del viernes',
  regla: '(fondos + cobros esperados hasta el viernes) / saldo por pagar al proveedor',
  umbral: '< 1.2 atención, < 1.0 alerta',
  muestraMin: 'fondos y saldo',
  evaluar: (c) => {
    const l = c.ins.liquidacion;
    if (!l) return ok([], [{ tema: 'la cobertura del viernes', n: 0, m: 1 }]);
    const saldo = l.mercanciaCent + l.guiasCent - l.pagadoCent;
    const cob = coberturaViernes(l.fondosDisponiblesCent, l.cobrosEsperadosHastaViernesCent, saldo);
    if (cob === null || cob >= PARAMETROS.coberturaViernesVerde) return ok();
    const faltan = saldo - (l.fondosDisponiblesCent + l.cobrosEsperadosHastaViernesCent);
    return ok([{ entidad: l.proveedor, severidad: cob < 1000n ? 'alerta' : 'atencion', dineroCent: faltan > 0n ? faltan : 0n, v: { cob: { valor: cob, unidad: 'milesimas', clase: 'Calculado' }, faltan: { valor: faltan > 0n ? faltan : 0n, unidad: 'cent', clase: 'Calculado' } }, texto: 'Cobertura {{cob}}: faltan {{faltan}}.', accion: { tipo: 'cobrar', titulo: 'Cobrar antes del viernes: faltan {{faltan}} para liquidar al proveedor.', dinero4semCent: faltan > 0n ? faltan : 0n, vencePorDias: 3, confianza: 'observado', quien: 'Javier', porque: 'cobertura del viernes contra saldo por pagar' } }]);
  },
};

const I22: PlantillaInsight = {
  id: 'I22',
  nombre: 'Proveedor más caro sin causa',
  regla: 'El mismo modelo cuesta menos con el otro proveedor y se compró el caro sin causa registrada',
  umbral: 'diferencia de costo > 0 con pedidos al caro',
  muestraMin: 'ambos costos',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    for (const k of c.ins.comparacionProveedores) {
      if (k.pedidosCaroSinCausa <= 0) continue;
      const dif = abs(k.costoIsaacCent - k.costoKarenCent);
      if (dif === 0n) continue;
      const caro = k.costoIsaacCent > k.costoKarenCent ? 'Isaac' : 'Karen';
      const barato = caro === 'Isaac' ? 'Karen' : 'Isaac';
      disparos.push({ entidad: k.modelo, severidad: 'atencion', dineroCent: dif * BigInt(k.piezasCaroSinCausa), v: { dif: { valor: dif, unidad: 'cent', clase: 'Calculado' }, pedidos: { valor: BigInt(k.pedidosCaroSinCausa), unidad: 'n', clase: 'Observado' } }, texto: `${k.modelo} cuesta {{dif}} menos con ${barato}; {{pedidos}} pedidos con ${caro}.`, accion: { tipo: 'renegociar', titulo: `Pedir ${k.modelo} a ${barato}: ahorra {{dif}} por pieza.`, dinero4semCent: dif * BigInt(k.piezasCaroSinCausa) * 4n, vencePorDias: 14, confianza: 'observado', quien: 'Angelo', porque: 'costo de ambos proveedores' } });
    }
    return ok(disparos);
  },
};

const I23: PlantillaInsight = {
  id: 'I23',
  nombre: 'Margen bruto bajo',
  regla: 'Margen bruto = (ventas - costo) / ventas',
  umbral: '< 8 % atención, < 5 % alerta',
  muestraMin: '2 semanas',
  evaluar: (c) => {
    if (c.ins.historia.length < 1 || c.ventasCent <= 0n) return ok([], [{ tema: 'el margen bruto', n: c.ins.historia.length + 1, m: 2 }]);
    const margen = bp(c.ventasCent - c.costoCent, c.ventasCent);
    const sev: Severidad | null = margen < 500n ? 'alerta' : margen < 800n ? 'atencion' : null;
    if (!sev) return ok();
    return ok([{ entidad: 'margen', severidad: sev, dineroCent: (c.ventasCent * (800n - margen)) / 10_000n, v: { margen: { valor: margen, unidad: 'bp', clase: 'Calculado' }, umbral: { valor: 800n, unidad: 'bp', formato: 'pct0', clase: 'Declarado' } }, texto: 'El margen fue {{margen}}, bajo el umbral de {{umbral}}.' }]);
  },
};

const I24: PlantillaInsight = {
  id: 'I24',
  nombre: 'Gasto variable o plataforma altos',
  regla: 'Gasto variable por pieza > 20 % sobre su mediana, o plataforma > 80 % del tope',
  umbral: '> 20 % sobre la mediana; > 80 % del tope',
  muestraMin: '4 semanas',
  evaluar: (c) => {
    const disparos: Disparo[] = [];
    const piezas = c.modelos.reduce((a, m) => a + m.piezas, 0);
    const mediana = c.ins.gastoVariablePorPiezaMedianaCent;
    if (mediana !== undefined && c.ins.historia.length >= 4 && piezas > 0) {
      const variable = sumaBig(c.ins.gastos.filter((g) => g.categoria === 'variable').map((g) => g.montoCent));
      const porPieza = variable / BigInt(piezas);
      if (mediana > 0n && porPieza * 100n > mediana * 120n) disparos.push({ entidad: 'gasto variable', severidad: 'atencion', dineroCent: (porPieza - mediana) * BigInt(piezas), v: { pct: { valor: bp(porPieza - mediana, mediana), unidad: 'bp', formato: 'pct0', clase: 'Calculado' }, porPieza: { valor: porPieza, unidad: 'cent', clase: 'Calculado' } }, texto: 'Los gastos variables suben {{pct}}: {{porPieza}} por pieza.' });
    } else if (mediana !== undefined) return ok([], [{ tema: 'el gasto variable', n: c.ins.historia.length, m: 4 }]);
    const pl = c.ins.plataforma;
    if (pl && pl.topeCent > 0n && pl.gastoCent * 100n > pl.topeCent * 80n) disparos.push({ entidad: 'plataforma', severidad: pl.gastoCent >= pl.topeCent ? 'alerta' : 'atencion', dineroCent: pl.gastoCent, v: { pct: { valor: bp(pl.gastoCent, pl.topeCent), unidad: 'bp', formato: 'pct0', clase: 'Calculado' } }, texto: 'La plataforma lleva {{pct}} de su tope mensual.' });
    return ok(disparos);
  },
};

const I25: PlantillaInsight = {
  id: 'I25',
  nombre: 'Cuenta de Omar',
  regla: 'Neto negativo, o toma pendiente de decisión más de 72 horas',
  umbral: 'neto < 0 o toma pendiente > 72 h',
  muestraMin: '1 semana',
  evaluar: (c) => {
    const s = c.ins.socios;
    if (!s) return ok([], [{ tema: 'la cuenta de Omar', n: 0, m: 1 }]);
    const disparos: Disparo[] = [];
    if (s.omarNetoCent < 0n) disparos.push({ entidad: 'omar', severidad: 'atencion', dineroCent: -s.omarNetoCent, v: { debe: { valor: -s.omarNetoCent, unidad: 'cent', clase: 'Calculado' }, renta: { valor: s.omarRentaCent, unidad: 'cent', clase: 'Calculado' }, tomas: { valor: s.omarTomasCent, unidad: 'cent', clase: 'Calculado' } }, texto: 'Omar debe {{debe}}: renta {{renta}}, tomas {{tomas}}.' });
    if (s.omarTomaPendienteHoras > 72) disparos.push({ entidad: 'omar_pendiente', severidad: 'atencion', dineroCent: 0n, v: { horas: { valor: BigInt(s.omarTomaPendienteHoras), unidad: 'n', clase: 'Observado' } }, texto: 'Hay una toma sin decisión desde hace {{horas}} horas.' });
    return ok(disparos);
  },
};

export const PLANTILLAS: readonly PlantillaInsight[] = [I01, I02, I03, I04, I05, I06, I07, I08, I09, I10, I11, I12, I13, I14, I15, I16, I17, I18, I19, I20, I21, I22, I23, I24, I25];

// ---------- motor ----------

export interface Insight {
  readonly id: string;
  readonly nombre: string;
  readonly entidad: string;
  readonly severidad: Severidad;
  readonly dineroCent: bigint;
  /** Frase con marcadores {{cifra:id}} ya namespaced. */
  readonly frase: string;
  readonly cifras: readonly string[];
  readonly hipotesis: boolean;
}

export interface Recomendacion {
  readonly orden: number;
  readonly tipo: TipoAccion;
  readonly origen: string;
  readonly titulo: string;
  readonly dinero4semCent: bigint;
  readonly prioridad: bigint;
  readonly quien: string;
  readonly porque: string;
  readonly cifras: readonly string[];
}

export interface ResultadoInsights {
  readonly insights: readonly Insight[];
  readonly pocosDatos: readonly (PocosDatos & { readonly id: string; readonly frase: string })[];
  readonly recomendaciones: readonly Recomendacion[];
}

export const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

const RANGO_SEV: Record<Severidad, number> = { alerta: 3, atencion: 2, nota: 1 };
const URGENCIA = (d: number): bigint => (d <= 7 ? 3n : d <= 28 ? 2n : 1n);
const CONFIANZA: Record<AccionSugerida['confianza'], bigint> = { observado: 10n, estimado_doble: 7n, estimado_minimo: 5n };

export function evaluarInsights(c: Contexto, libro: LibroCifras, periodo: string): ResultadoInsights {
  const insights: Insight[] = [];
  const pocos: (PocosDatos & { id: string; frase: string })[] = [];
  const candidatas: { id: string; accion: AccionSugerida; mapa: Record<string, string>; cifras: string[]; entidad: string }[] = [];
  for (const p of PLANTILLAS) {
    const r = p.evaluar(c);
    for (const [i, d] of r.disparos.entries()) {
      const base = `ins.${p.id}.${slug(d.entidad) || 'x'}${i > 0 && r.disparos.slice(0, i).some((x) => slug(x.entidad) === slug(d.entidad)) ? `_${i}` : ''}`;
      const mapa: Record<string, string> = {};
      const ids: string[] = [];
      for (const [k, v] of Object.entries(d.v)) {
        const id = `${base}.${k}`;
        libro.agregar(id, `${p.nombre}: ${k}`, v.valor, v.unidad, { clase: v.clase ?? 'Calculado', fuente: `regla ${p.id}`, periodo, n: v.n ?? 0, ...(v.via2 !== undefined ? { via2: v.via2 } : {}), ...(v.formato ? { formato: v.formato } : {}) });
        mapa[k] = `{{cifra:${id}}}`;
        ids.push(id);
      }
      const sust = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => mapa[k] ?? `{{${k}}}`);
      insights.push({ id: p.id, nombre: p.nombre, entidad: d.entidad, severidad: d.severidad, dineroCent: d.dineroCent, frase: sust(d.texto), cifras: ids, hipotesis: d.hipotesis ?? false });
      if (d.accion) candidatas.push({ id: p.id, accion: d.accion, mapa, cifras: ids, entidad: d.entidad });
    }
    for (const q of r.pocosDatos) pocos.push({ ...q, id: p.id, frase: `Pocos datos para hablar de ${q.tema} (${q.n} de ${q.m}).` });
  }
  insights.sort((a, b) => RANGO_SEV[b.severidad] - RANGO_SEV[a.severidad] || (a.dineroCent === b.dineroCent ? cmpTexto(a.id + a.entidad, b.id + b.entidad) : a.dineroCent > b.dineroCent ? -1 : 1));
  const recs = candidatas
    .map((x) => ({ ...x, prioridad: x.accion.dinero4semCent * URGENCIA(x.accion.vencePorDias) * CONFIANZA[x.accion.confianza] }))
    .sort((a, b) => (a.prioridad === b.prioridad ? (a.accion.dinero4semCent === b.accion.dinero4semCent ? cmpTexto(a.entidad, b.entidad) : a.accion.dinero4semCent > b.accion.dinero4semCent ? -1 : 1) : a.prioridad > b.prioridad ? -1 : 1));
  const recomendaciones: Recomendacion[] = recs.slice(0, 5).map((x, i) => ({
    orden: i + 1,
    tipo: x.accion.tipo,
    origen: x.id,
    titulo: x.accion.titulo.replace(/\{\{(\w+)\}\}/g, (_, k: string) => x.mapa[k] ?? `{{${k}}}`),
    dinero4semCent: x.accion.dinero4semCent,
    prioridad: x.prioridad,
    quien: x.accion.quien ?? 'Socios',
    porque: x.accion.porque,
    cifras: x.cifras,
  }));
  return { insights, pocosDatos: pocos, recomendaciones };
}

/** Texto del anexo: umbrales y reglas vigentes. */
export const anexoUmbrales = (): readonly { id: string; nombre: string; regla: string; umbral: string; muestra: string }[] => PLANTILLAS.map((p) => ({ id: p.id, nombre: p.nombre, regla: p.regla, umbral: p.umbral, muestra: p.muestraMin }));
