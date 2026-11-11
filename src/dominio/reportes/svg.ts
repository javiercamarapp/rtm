// Graficas SVG en blanco y negro (spec 16, sec. 3.1). Funciones puras: la misma para web y PDF. Sin color: grises por variables CSS
// (--rep-g0 .. --rep-g4) definidas en la hoja de estilo del documento; el sentido nunca depende del color (trama, forma y rotulo directo).
// Invariante del puente: si inicio + suma de pasos no es el final, no se dibuja.
import { formatearValor, pesosEnteros, porcentaje0 } from './formato';
import type { CeldaCalor, CubetaAntiguedad, FilaCobertura, GraficasPaquete, ItemPareto, Mancuerna, PasoCascada, PuntoTendencia, SegmentoGasto } from './paquete';
import type { DatosFlujo } from './proyecciones';
import { type Puente, puenteCuadra } from './puente';
import { sumaBig } from './util';

export const ANCHO = 516; // Carta menos margenes de 48 pt
const G = ['var(--rep-g0)', 'var(--rep-g1)', 'var(--rep-g2)', 'var(--rep-g3)', 'var(--rep-g4)'] as const;
const NEGRO = G[4];
const BLANCO = G[0];

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Definiciones de tramas (rayados) compartidas; se incluyen una vez por documento. */
export function defsTramas(): string {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<pattern id="rep-rayado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${NEGRO}" stroke-width="1.4"/></pattern>
<pattern id="rep-rayado-fino" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="${NEGRO}" stroke-width="0.8"/></pattern>
<pattern id="rep-punteado" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1" fill="${NEGRO}"/></pattern>
<pattern id="rep-cruz" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0L6 6M6 0L0 6" stroke="${NEGRO}" stroke-width="0.9"/></pattern>
</defs></svg>`;
}

function marco(titulo: string, desc: string, alto: number, cuerpo: string): string {
  const id = `s${(titulo.length * 31 + desc.length * 17 + alto) % 99991}`;
  return `<svg role="img" aria-labelledby="${id}t ${id}d" viewBox="0 0 ${ANCHO} ${alto}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Figtree, sans-serif" font-size="9.5"><title id="${id}t">${esc(titulo)}</title><desc id="${id}d">${esc(desc)}</desc>${cuerpo}</svg>`;
}
const texto = (x: number, y: number, t: string, o: { anchor?: 'start' | 'middle' | 'end'; peso?: number; fill?: string; size?: number } = {}) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${o.anchor ?? 'start'}" font-weight="${o.peso ?? 400}" fill="${o.fill ?? NEGRO}"${o.size ? ` font-size="${o.size}"` : ''}>${esc(t)}</text>`;
const rect = (x: number, y: number, w: number, h: number, fill: string, stroke?: string, sw = 1) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`;
const linea = (x1: number, y1: number, x2: number, y2: number, o: { dash?: string; w?: number; stroke?: string } = {}) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${o.stroke ?? NEGRO}" stroke-width="${o.w ?? 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const num = Number;
const money = (c: bigint) => pesosEnteros(c);

// ---------- Cascada / puente (barras flotantes) ----------

interface ItemFlotante {
  readonly etiqueta: string;
  /** Si es total, valor absoluto y se dibuja desde cero; si no, delta. */
  readonly valor: bigint;
  readonly total: boolean;
}

function flotante(titulo: string, desc: string, items: readonly ItemFlotante[]): string {
  const fila = 22;
  const alto = 30 + items.length * fila;
  const izq = 150;
  const der = 70;
  // acumulados
  let acc = 0n;
  const tramos = items.map((it) => {
    const desde = it.total ? 0n : acc;
    const hasta = it.total ? it.valor : acc + it.valor;
    acc = it.total ? it.valor : hasta;
    return { it, desde, hasta };
  });
  const todos = tramos.flatMap((t) => [t.desde, t.hasta, 0n]);
  const min = todos.reduce((a, b) => (a < b ? a : b), 0n);
  const max = todos.reduce((a, b) => (a > b ? a : b), 1n);
  const rango = num(max - min) || 1;
  const x = (v: bigint) => izq + (num(v - min) / rango) * (ANCHO - izq - der);
  let cuerpo = linea(x(0n), 14, x(0n), alto - 8, { stroke: G[2] });
  tramos.forEach((t, i) => {
    const y = 22 + i * fila;
    const a = Math.min(x(t.desde), x(t.hasta));
    const w = Math.abs(x(t.hasta) - x(t.desde));
    const baja = t.hasta < t.desde;
    cuerpo += texto(izq - 8, y + 11, t.it.etiqueta, { anchor: 'end', peso: t.it.total ? 700 : 400 });
    cuerpo += t.it.total ? rect(a, y, w, 15, BLANCO, NEGRO, 2) : rect(a, y, w, 15, baja ? NEGRO : G[1]);
    const val = t.it.total ? money(t.it.valor) : `${t.it.valor > 0n ? '+' : ''}${money(t.it.valor)}`;
    cuerpo += texto(Math.max(a, a + w) + 5, y + 11, val, { peso: 600 });
  });
  return marco(titulo, desc, alto, cuerpo);
}

export function svgPuente(p: Puente): string {
  if (!puenteCuadra(p)) return '';
  const items: ItemFlotante[] = [{ etiqueta: 'Utilidad anterior', valor: p.inicioCent, total: true }, ...p.pasos.map((s) => ({ etiqueta: s.etiqueta, valor: s.deltaCent, total: false })), { etiqueta: 'Utilidad actual', valor: p.finCent, total: true }];
  return flotante('Puente de utilidad', `De ${money(p.inicioCent)} a ${money(p.finCent)} por volumen, mezcla, precio, costo, guía y otros.`, items);
}

export function svgCascada(pasos: readonly PasoCascada[]): string {
  if (pasos.length === 0) return '';
  // Los subtotales son totales acumulados; las hojas entran con su signo.
  let acc = 0n;
  const items: ItemFlotante[] = [];
  for (const p of pasos) {
    if (p.subtotal) {
      items.push({ etiqueta: p.etiqueta, valor: acc, total: true });
    } else {
      const d = BigInt(p.signo) * p.montoCent;
      items.push({ etiqueta: p.etiqueta, valor: d, total: false });
      acc += d;
    }
  }
  const ultimo = items[items.length - 1]!;
  return flotante('Cascada del estado de resultados', `De ventas netas a ${money(ultimo.valor)} de utilidad.`, items);
}

// ---------- Pareto ----------

export function svgPareto(items: readonly ItemPareto[], totalCent: bigint): string {
  if (items.length === 0 || totalCent <= 0n) return '';
  const alto = 150;
  const base = alto - 36;
  const top = 14;
  const ancho = ANCHO - 50;
  const n = Math.min(items.length, 8);
  const paso = ancho / n;
  const maxV = num(items[0]!.valorCent) || 1;
  let c = '';
  const pts: string[] = [];
  items.slice(0, n).forEach((it, i) => {
    const h = (num(it.valorCent) / maxV) * (base - top - 14);
    const x = 40 + i * paso + paso * 0.15;
    c += rect(x, base - h, paso * 0.7, h, i === 0 ? NEGRO : G[2]);
    c += texto(x + paso * 0.35, base - h - 4, money(it.valorCent), { anchor: 'middle', size: 8.5 });
    c += texto(x + paso * 0.35, base + 12, it.etiqueta.length > 11 ? `${it.etiqueta.slice(0, 10)}.` : it.etiqueta, { anchor: 'middle', size: 8.5 });
    pts.push(`${(x + paso * 0.35).toFixed(1)},${(base - (num(it.pctAcumBp) / 10_000) * (base - top)).toFixed(1)}`);
  });
  c += `<polyline points="${pts.join(' ')}" fill="none" stroke="${NEGRO}" stroke-width="1.4"/>`;
  c += linea(40, base - 0.8 * (base - top), ANCHO - 10, base - 0.8 * (base - top), { dash: '3 3', stroke: G[3] });
  c += texto(ANCHO - 10, base - 0.8 * (base - top) - 3, '80 %', { anchor: 'end', size: 8.5 });
  c += linea(40, base, ANCHO - 10, base);
  const acum = items.slice(0, n).map((i) => porcentaje0(i.pctAcumBp)).join(', ');
  return marco('Pareto de clientes', `Ventas por cliente con porcentaje acumulado: ${acum}.`, alto, c);
}

// ---------- Cobertura en dias ----------

export function svgCobertura(filas: readonly FilaCobertura[]): string {
  const validas = filas.filter((f) => f.dias !== null).slice(0, 10);
  if (validas.length === 0) return '';
  const fila = 24;
  const alto = 34 + validas.length * fila;
  const izq = 120;
  const maxD = Math.max(60, ...validas.map((f) => f.dias ?? 0));
  const x = (d: number) => izq + (d / maxD) * (ANCHO - izq - 90);
  let c = '';
  for (const [i, f] of validas.entries()) {
    const y = 20 + i * fila;
    const d = f.dias ?? 0;
    const extremo = d < 7 || d > 56;
    c += texto(izq - 8, y + 11, f.modelo, { anchor: 'end' });
    c += rect(izq, y, x(d) - izq, 15, extremo ? NEGRO : G[2]);
    c += texto(x(d) + 5, y + 11, `${d} d (${f.existencia} pz)`, { peso: 600 });
  }
  c += linea(x(7), 12, x(7), alto - 10, { dash: '3 3' });
  c += linea(x(28), 12, x(28), alto - 10, { dash: '3 3' });
  c += texto(x(7), 10, '7 d', { anchor: 'middle', size: 8.5 }) + texto(x(28), 10, '28 d', { anchor: 'middle', size: 8.5 });
  return marco('Cobertura en días', `Días de existencia por modelo; líneas en 7 y 28 días. ${validas.map((f) => `${f.modelo}: ${f.dias} días`).join('; ')}.`, alto, c);
}

// ---------- Antiguedad de saldos ----------

export function svgAntiguedad(cubetas: readonly CubetaAntiguedad[]): string {
  const total = sumaBig(cubetas.map((c) => c.montoCent));
  if (total <= 0n) return '';
  const fills = [BLANCO, 'url(#rep-punteado)', 'url(#rep-rayado-fino)', 'url(#rep-rayado)', NEGRO];
  const alto = 92;
  const ancho = ANCHO - 20;
  let c = '';
  let x = 10;
  cubetas.forEach((b, i) => {
    const w = (num(b.montoCent) / num(total)) * ancho;
    c += rect(x, 24, w, 24, fills[i] ?? G[2], NEGRO, 1);
    if (w > 0.5) {
      c += texto(x + w / 2, 62, b.etiqueta, { anchor: 'middle', size: 8.5 });
      c += texto(x + w / 2, 74, money(b.montoCent), { anchor: 'middle', size: 8.5, peso: 600 });
    }
    x += w;
  });
  c += texto(10, 14, `Por cobrar ${money(total)}: más rayado, más viejo`, { size: 9 });
  return marco('Antigüedad de saldos', `Cartera por antigüedad: ${cubetas.map((b) => `${b.etiqueta} ${money(b.montoCent)}`).join('; ')}.`, alto, c);
}

// ---------- Flujo de caja ----------

export function svgFlujo(f: DatosFlujo): string {
  if (f.semanas.length === 0) return '';
  const alto = 160;
  const medio = 78;
  const todos = f.semanas.flatMap((s) => [s.cobrosCent, -(s.pagosProvCent + s.omarCent + s.gastosCent), s.saldoCent, s.saldoLoCent, s.saldoHiCent]);
  const maxA = Math.max(1, ...todos.map((v) => Math.abs(num(v))));
  const y = (v: bigint) => medio - (num(v) / maxA) * 58;
  const paso = (ANCHO - 60) / f.semanas.length;
  let c = linea(40, medio, ANCHO - 10, medio, { stroke: G[3] });
  const linSaldo: string[] = [];
  const banda: string[] = [];
  const bandaBaja: string[] = [];
  f.semanas.forEach((s, i) => {
    const x = 50 + i * paso;
    const w = paso * 0.5;
    const salidas = s.pagosProvCent + s.omarCent + s.gastosCent;
    c += rect(x, y(s.cobrosCent), w, medio - y(s.cobrosCent), s.clase === 'Observado' ? G[2] : 'url(#rep-rayado-fino)', NEGRO, 1);
    c += rect(x, medio, w, y(-salidas) - medio, G[4]);
    c += texto(x + w / 2, alto - 14, `Sem ${s.semana}`, { anchor: 'middle', size: 8.5 });
    c += texto(x + w / 2, alto - 3, s.clase === 'Observado' ? 'Observado' : s.clase, { anchor: 'middle', size: 8 });
    linSaldo.push(`${(x + w / 2).toFixed(1)},${y(s.saldoCent).toFixed(1)}`);
    banda.push(`${(x + w / 2).toFixed(1)},${y(s.saldoHiCent).toFixed(1)}`);
    bandaBaja.unshift(`${(x + w / 2).toFixed(1)},${y(s.saldoLoCent).toFixed(1)}`);
    c += texto(x + w / 2, y(s.saldoCent) - 5, money(s.saldoCent), { anchor: 'middle', size: 8.5, peso: 600 });
  });
  c = `<polygon points="${[...banda, ...bandaBaja].join(' ')}" fill="url(#rep-rayado-fino)" opacity="0.55"/>${c}<polyline points="${linSaldo.join(' ')}" fill="none" stroke="${NEGRO}" stroke-width="1.6" stroke-dasharray="5 3"/>`;
  c += texto(40, 12, 'Entradas arriba, salidas abajo; saldo en línea discontinua; banda rayada = rango', { size: 8.5 });
  return marco('Flujo de caja a 4 semanas (Estimado)', `Saldo proyectado: ${f.semanas.map((s) => `semana ${s.semana} ${money(s.saldoCent)}`).join('; ')}.`, alto, c);
}

// ---------- Barra 100 % segmentada y bullet ----------

export function svgBarraSegmentada(segs: readonly SegmentoGasto[]): string {
  const total = sumaBig(segs.map((s) => s.montoCent));
  if (total <= 0n) return '';
  const fills = [NEGRO, G[1], 'url(#rep-rayado)', 'url(#rep-punteado)'];
  let c = '';
  let x = 10;
  segs.forEach((s, i) => {
    const w = (num(s.montoCent) / num(total)) * (ANCHO - 20);
    c += rect(x, 14, w, 24, fills[i] ?? G[2], NEGRO, 1);
    if (w > 1) c += texto(x + w / 2, 54, `${s.etiqueta} ${money(s.montoCent)}`, { anchor: 'middle', size: 9 });
    x += w;
  });
  return marco('Composición del gasto', `Gasto total ${money(total)}: ${segs.map((s) => `${s.etiqueta} ${money(s.montoCent)}`).join('; ')}.`, 66, c);
}

export function svgBullet(titulo: string, valorCent: bigint, topeCent: bigint): string {
  if (topeCent <= 0n) return '';
  const max = Math.max(num(topeCent), num(valorCent)) * 1.05;
  const x = (v: bigint) => 10 + (num(v) / max) * (ANCHO - 20);
  let c = rect(10, 14, x(topeCent) - 10, 16, G[1]);
  c += rect(10, 19, x(valorCent) - 10, 6, NEGRO);
  c += linea(x(topeCent), 10, x(topeCent), 34, { w: 2 });
  c += linea(x((topeCent * 80n) / 100n), 12, x((topeCent * 80n) / 100n), 32, { dash: '2 2' });
  c += texto(10, 48, `${titulo}: ${money(valorCent)} de ${money(topeCent)}`, { size: 9 });
  return marco(titulo, `${money(valorCent)} contra un tope de ${money(topeCent)}; alerta al 80 %.`, 56, c);
}

// ---------- Barra divergente (socios) ----------

export function svgDivergente(pasos: readonly { etiqueta: string; deltaCent: bigint }[]): string {
  if (pasos.length === 0) return '';
  const max = Math.max(1, ...pasos.map((p) => Math.abs(num(p.deltaCent))));
  const medio = ANCHO / 2 + 40;
  const alto = 20 + pasos.length * 24;
  let c = linea(medio, 8, medio, alto - 4);
  pasos.forEach((p, i) => {
    const y = 14 + i * 24;
    const w = (Math.abs(num(p.deltaCent)) / max) * (ANCHO / 2 - 110);
    c += texto(100, y + 11, p.etiqueta, { anchor: 'end' });
    c += p.deltaCent >= 0n ? rect(medio, y, w, 15, G[2], NEGRO, 1) : rect(medio - w, y, w, 15, NEGRO);
    c += texto(p.deltaCent >= 0n ? medio + w + 5 : medio - w - 5, y + 11, money(p.deltaCent), { anchor: p.deltaCent >= 0n ? 'start' : 'end', peso: 600 });
  });
  return marco('Posición entre socios', pasos.map((p) => `${p.etiqueta}: ${money(p.deltaCent)}`).join('; ') + '.', alto, c);
}

// ---------- Mapa de calor ----------

export function svgCalor(calor: NonNullable<GraficasPaquete['calor']>): string {
  const celda = Math.min(46, (ANCHO - 130) / Math.max(1, calor.cols.length));
  const alto = 40 + calor.filas.length * 22;
  const niv = (bpv: bigint) => (bpv >= 4000n ? 4 : bpv >= 2500n ? 3 : bpv >= 1200n ? 2 : bpv > 0n ? 1 : 0);
  let c = '';
  calor.cols.forEach((col, j) => {
    c += texto(120 + j * celda + celda / 2, 24, col.length > 7 ? `${col.slice(0, 6)}.` : col, { anchor: 'middle', size: 8.5 });
  });
  calor.filas.forEach((fila, i) => {
    const y = 32 + i * 22;
    c += texto(112, y + 14, fila, { anchor: 'end' });
    calor.cols.forEach((col, j) => {
      const ce: CeldaCalor | undefined = calor.celdas.find((q) => q.fila === fila && q.col === col);
      const n = ce ? niv(ce.pctFilaBp) : 0;
      c += rect(120 + j * celda, y, celda - 2, 20, G[n]!, G[3]);
      if (ce) c += texto(120 + j * celda + celda / 2 - 1, y + 14, String(ce.piezas), { anchor: 'middle', size: 9, fill: n >= 3 ? BLANCO : NEGRO, peso: 600 });
    });
  });
  return marco('Mapa de calor cliente por sabor', `Piezas por cliente y sabor; más oscuro, más participación del cliente.`, alto, c);
}

// ---------- Bump chart ----------

export function svgBump(b: NonNullable<GraficasPaquete['bump']>): string {
  const alto = 28 + b.series.length * 16;
  const x = (i: number) => 110 + (i / Math.max(1, b.periodos - 1)) * (ANCHO - 200);
  const y = (r: number) => 14 + (r - 1) * 16;
  let c = '';
  b.series.forEach((s, k) => {
    const foco = k === 0;
    c += `<polyline points="${s.rank.map((r, i) => `${x(i).toFixed(1)},${y(r).toFixed(1)}`).join(' ')}" fill="none" stroke="${foco ? NEGRO : G[3]}" stroke-width="${foco ? 2.4 : 1.2}"/>`;
    s.rank.forEach((r, i) => {
      c += k % 2 === 0 ? `<circle cx="${x(i).toFixed(1)}" cy="${y(r).toFixed(1)}" r="3" fill="${foco ? NEGRO : G[3]}"/>` : `<rect x="${(x(i) - 3).toFixed(1)}" y="${(y(r) - 3).toFixed(1)}" width="6" height="6" fill="${G[3]}"/>`;
    });
    c += texto(104, y(s.rank[0]!) + 3, s.cliente, { anchor: 'end', peso: foco ? 700 : 400, size: 8.5 });
    c += texto(x(b.periodos - 1) + 8, y(s.rank[s.rank.length - 1]!) + 3, s.cliente, { size: 8.5, peso: foco ? 700 : 400 });
  });
  return marco('Posición de clientes por semana', `Ranking semanal de los ${b.series.length} mejores clientes en ${b.periodos} semanas.`, alto, c);
}

// ---------- Burbujas margen-rotacion ----------

export function svgBurbujas(b: NonNullable<GraficasPaquete['burbujas']>): string {
  const alto = 230;
  const maxX = Math.max(1, ...b.puntos.map((p) => num(p.rotacionMilesimas))) * 1.1;
  const maxY = Math.max(1, ...b.puntos.map((p) => num(p.contribPzCent))) * 1.15;
  const maxT = Math.max(1, ...b.puntos.map((p) => Math.abs(num(p.contribTotalCent))));
  const px = (v: bigint) => 50 + (num(v) / maxX) * (ANCHO - 70);
  const py = (v: bigint) => alto - 34 - (num(v) / maxY) * (alto - 60);
  let c = linea(px(b.medianaRotacionMilesimas), 10, px(b.medianaRotacionMilesimas), alto - 30, { dash: '4 3' });
  c += linea(50, py(b.medianaContribPzCent), ANCHO - 10, py(b.medianaContribPzCent), { dash: '4 3' });
  c += linea(50, alto - 30, ANCHO - 10, alto - 30);
  c += texto(ANCHO - 12, 18, 'Estrella', { anchor: 'end', peso: 700 }) + texto(52, 18, 'Vaca', { peso: 700 }) + texto(ANCHO - 12, alto - 36, 'Revisar', { anchor: 'end', peso: 700 }) + texto(52, alto - 36, 'Cola', { peso: 700 });
  for (const p of b.puntos) {
    const r = 4 + (Math.abs(num(p.contribTotalCent)) / maxT) * 14;
    c += `<circle cx="${px(p.rotacionMilesimas).toFixed(1)}" cy="${py(p.contribPzCent).toFixed(1)}" r="${r.toFixed(1)}" fill="${p.cuadrante === 'Revisar' ? NEGRO : G[2]}" stroke="${NEGRO}" stroke-width="1" fill-opacity="0.85"/>`;
    c += texto(px(p.rotacionMilesimas) + r + 3, py(p.contribPzCent) + 3, p.modelo.length > 14 ? `${p.modelo.slice(0, 13)}.` : p.modelo, { size: 8.5 });
  }
  c += texto(ANCHO / 2, alto - 6, 'Rotación (eje horizontal) y contribución por pieza (eje vertical); tamaño = contribución total', { anchor: 'middle', size: 8.5 });
  return marco('Margen y rotación por modelo', `Cuadrantes Estrella, Vaca, Revisar y Cola para ${b.puntos.length} modelos.`, alto, c);
}

// ---------- Mancuernas ----------

export function svgMancuernas(ms: readonly Mancuerna[]): string {
  if (ms.length === 0) return '';
  const todos = ms.flatMap((m) => [num(m.costoIsaacCent), num(m.costoKarenCent)]);
  const min = Math.min(...todos) * 0.9;
  const max = Math.max(...todos) * 1.05;
  const x = (v: bigint) => 130 + ((num(v) - min) / (max - min || 1)) * (ANCHO - 200);
  const alto = 34 + ms.length * 24;
  let c = '';
  ms.forEach((m, i) => {
    const y = 22 + i * 24;
    c += texto(122, y + 4, m.modelo, { anchor: 'end' });
    c += linea(x(m.costoIsaacCent), y, x(m.costoKarenCent), y, { w: 1.6 });
    c += `<circle cx="${x(m.costoIsaacCent).toFixed(1)}" cy="${y}" r="4.5" fill="${NEGRO}"/>`;
    c += rect(x(m.costoKarenCent) - 4, y - 4, 8, 8, BLANCO, NEGRO, 2);
    c += texto(Math.max(x(m.costoIsaacCent), x(m.costoKarenCent)) + 9, y + 4, `${money(m.costoIsaacCent)} / ${money(m.costoKarenCent)}`, { size: 8.5 });
  });
  c += texto(130, 12, 'Círculo = Isaac; cuadro = Karen', { size: 8.5 });
  return marco('Costo por proveedor', `Costo por pieza con Isaac y con Karen: ${ms.map((m) => `${m.modelo} ${money(m.costoIsaacCent)} y ${money(m.costoKarenCent)}`).join('; ')}.`, alto, c);
}

// ---------- Tendencia con banda ----------

export function svgTendencia(t: NonNullable<GraficasPaquete['tendencia']>): string {
  const alto = 200;
  const todos = [...t.observados, ...t.proyectados.flatMap((p) => [p.loCent, p.hiCent])];
  const min = Math.min(...todos.map(num));
  const max = Math.max(...todos.map(num));
  const rango = max - min || 1;
  const n = t.observados.length + t.proyectados.length;
  const x = (i: number) => 50 + (i / Math.max(1, n - 1)) * (ANCHO - 70);
  const y = (v: bigint) => alto - 34 - ((num(v) - min) / rango) * (alto - 70);
  let c = linea(50, alto - 30, ANCHO - 10, alto - 30);
  const obs = t.observados.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  c += `<polyline points="${obs.join(' ')}" fill="none" stroke="${NEGRO}" stroke-width="1.8"/>`;
  const ini = t.observados.length;
  const top = t.proyectados.map((p, i) => `${x(ini + i).toFixed(1)},${y(p.hiCent).toFixed(1)}`);
  const bajo = [...t.proyectados].reverse().map((p) => `${x(ini + t.proyectados.indexOf(p)).toFixed(1)},${y(p.loCent).toFixed(1)}`);
  c += `<polygon points="${[...top, ...bajo].join(' ')}" fill="url(#rep-rayado-fino)" opacity="0.6" stroke="${NEGRO}" stroke-width="0.6"/>`;
  c += `<polyline points="${t.proyectados.map((p, i) => `${x(ini + i).toFixed(1)},${y(p.centralCent).toFixed(1)}`).join(' ')}" fill="none" stroke="${NEGRO}" stroke-width="1.8" stroke-dasharray="5 3"/>`;
  c += linea(x(ini - 0.5), 12, x(ini - 0.5), alto - 30, { dash: '2 3' });
  c += texto(x(ini - 0.5) - 4, 20, 'Observado', { anchor: 'end', size: 8.5 }) + texto(x(ini - 0.5) + 4, 20, 'Estimado', { size: 8.5 });
  const p0 = t.proyectados[0] as PuntoTendencia;
  c += texto(ANCHO - 12, alto - 8, `Central ${money(p0.centralCent)} por semana; banda al 80 %`, { anchor: 'end', size: 8.5 });
  return marco('Proyección de utilidad (Estimado)', `${t.metodo}; ventana de ${t.ventanaN} semanas; central ${money(p0.centralCent)} por semana, rango ${money(p0.loCent)} a ${money(p0.hiCent)}.`, alto, c);
}

// ---------- Tornado y sparkline ----------

export function svgTornado(barras: readonly { etiqueta: string; deltaCent: bigint }[]): string {
  if (barras.length === 0) return '';
  const orden = [...barras].sort((a, b) => Math.abs(num(b.deltaCent)) - Math.abs(num(a.deltaCent)));
  return svgDivergenteConTitulo('Sensibilidad de la utilidad (Escenario)', orden);
}
function svgDivergenteConTitulo(titulo: string, pasos: readonly { etiqueta: string; deltaCent: bigint }[]): string {
  const max = Math.max(1, ...pasos.map((p) => Math.abs(num(p.deltaCent))));
  const medio = ANCHO / 2 + 70;
  const alto = 20 + pasos.length * 24;
  let c = linea(medio, 8, medio, alto - 4);
  pasos.forEach((p, i) => {
    const y = 14 + i * 24;
    const w = (Math.abs(num(p.deltaCent)) / max) * (ANCHO / 2 - 150);
    c += texto(medio - 8 - (p.deltaCent < 0n ? w : 0) - 4, y + 11, p.etiqueta, { anchor: 'end' });
    c += p.deltaCent >= 0n ? rect(medio, y, w, 15, G[2], NEGRO, 1) : rect(medio - w, y, w, 15, NEGRO);
    c += texto(p.deltaCent >= 0n ? medio + w + 5 : medio + 5, y + 11, money(p.deltaCent), { peso: 600 });
  });
  return marco(titulo, pasos.map((p) => `${p.etiqueta}: ${money(p.deltaCent)}`).join('; ') + '. Escenario: supuesto explícito, sin probabilidad.', alto, c);
}

export function svgSparkline(titulo: string, valores: readonly bigint[]): string {
  if (valores.length < 2) return '';
  const min = Math.min(...valores.map(num));
  const max = Math.max(...valores.map(num));
  const r = max - min || 1;
  const pts = valores.map((v, i) => `${(10 + (i / (valores.length - 1)) * 160).toFixed(1)},${(30 - ((num(v) - min) / r) * 24).toFixed(1)}`);
  const ultimo = pts[pts.length - 1]!.split(',');
  const c = `<polyline points="${pts.join(' ')}" fill="none" stroke="${NEGRO}" stroke-width="1.6"/><circle cx="${ultimo[0]}" cy="${ultimo[1]}" r="3" fill="${NEGRO}"/>${texto(178, 20, `${formatearValor(valores[valores.length - 1]!, 'bp', 'pct0')} hoy`, { size: 9, peso: 600 })}`;
  return marco(titulo, `${titulo}: de ${formatearValor(valores[0]!, 'bp', 'pct0')} a ${formatearValor(valores[valores.length - 1]!, 'bp', 'pct0')} en ${valores.length} semanas.`, 40, c);
}
