// Plantillas PURAS de los mensajes programados al grupo de socios: resumen diario (20:00) y pendientes (09:00).
// Reciben las cifras que entregan las funciones SQL agente.rep_* (centavos y conteos ya calculados) y SOLO dan formato: ninguna cifra se calcula aqui ni la calcula el modelo de IA.
// Sin emojis, espanol neutro; marcas, modelos y sabores en MAYUSCULAS; nada de costos de Omar ni contactos (el destino es el grupo de los socios).
import { formatearMoneda, formatearEntero } from '../formato';

type Cent = number | string | null | undefined;
const m = (c: Cent): string => (c === null || c === undefined ? 'sin dato' : formatearMoneda(BigInt(c)));
const may = (t: string): string => t.toUpperCase();
const pl = (n: number, uno: string, varios: string): string => `${formatearEntero(n)} ${n === 1 ? uno : varios}`;

export interface RepVentas { pedidos: number; piezas: number; facturado_cent: number }
export interface RepEnviado { cliente: string; pedidos: number; folios: string[]; piezas: number; modelos: { modelo: string; piezas: number }[] }
export interface RepResumen {
  hoy: string;
  ventas: RepVentas;
  cobrado_cent: number;
  por_cobrar_cent: number;
  vencidos_cent: number;
  por_pagar: { total_cent: number; renglones: { clave: string; etiqueta: string; monto_cent: number }[] };
  valuacion: { socios: { socio: string; valuacion_cent: number }[] | null; diferencia_retiros_cent?: number | null } | null;
  igualacion: { igualados: boolean; le_toca_aportar: string | null; lleva_mas: string | null; diferencia_cent: number } | null;
  fondos_en_poder: { total_cent: number; socios: { socio: string; cent: number; dias: number | null }[] };
  pedidos_enviados: RepEnviado[];
  concentracion: { mayor_bp: number; top: { cliente: string; bp: number }[]; sobre_umbral: boolean; total_cent: number };
  margen: { minimo_bp: number; pedidos: { folio: string; cliente: string; margen_bp: number }[] };
  libro: { rojas: string[]; total: number };
}

const pct = (bp: number): string => `${formatearEntero(Math.floor(bp / 100))}.${String(Math.abs(bp % 100)).padStart(2, '0')}`;
const fechaCorta = (f: string): string => `${f.slice(8, 10)}-${f.slice(5, 7)}`;

/** Resumen diario: lineas cortas, cifras del servidor, pedidos agrupados por cliente. Siempre trae las cifras base, aunque sean cero. */
export function textoResumenDiario(r: RepResumen): string {
  const L: string[] = [];
  L.push(`Resumen del ${fechaCorta(r.hoy)}`);
  L.push(`Ventas del dia: ${pl(r.ventas.pedidos, 'pedido', 'pedidos')}, ${pl(r.ventas.piezas, 'pieza', 'piezas')}, ${m(r.ventas.facturado_cent)}.`);
  L.push(`Cobrado hoy: ${m(r.cobrado_cent)}.`);
  L.push(`Por cobrar: ${m(r.por_cobrar_cent)}; vencidos: ${m(r.vencidos_cent)}.`);
  const deuda = r.por_pagar.renglones.filter((x) => x.clave !== 'renta_omar').map((x) => `${x.etiqueta} ${m(x.monto_cent)}`);
  const renta = r.por_pagar.renglones.find((x) => x.clave === 'renta_omar');
  L.push(`Por pagar: ${deuda.join(', ')}${renta ? `; renta de Omar ${m(renta.monto_cent)}` : ''}; total ${m(r.por_pagar.total_cent)}.`);
  if (r.valuacion?.socios && r.valuacion.socios.length > 0) {
    L.push(`Valuacion: ${r.valuacion.socios.map((s) => `${s.socio} ${m(s.valuacion_cent)}`).join(', ')}.`);
  }
  if (r.igualacion) {
    L.push(r.igualacion.igualados ? 'Igualacion: los socios estan igualados.' : `Igualacion: ${r.igualacion.lleva_mas ?? 'un socio'} lleva ${m(r.igualacion.diferencia_cent)} mas; le toca aportar a ${r.igualacion.le_toca_aportar ?? 'el otro socio'}.`);
  }
  L.push(r.fondos_en_poder.total_cent > 0
    ? `Fondos en poder de socios: ${m(r.fondos_en_poder.total_cent)} (${r.fondos_en_poder.socios.map((s) => `${s.socio} ${m(s.cent)}${s.dias === null ? '' : `, ${pl(s.dias, 'dia', 'dias')}`}`).join('; ')}).`
    : 'Fondos en poder de socios: ninguno.');
  if (r.pedidos_enviados.length > 0) {
    L.push('Pedidos enviados:');
    for (const e of r.pedidos_enviados) {
      const mod = e.modelos.map((x) => `${formatearEntero(x.piezas)} ${may(x.modelo)}`).join(', ');
      L.push(`- ${may(e.cliente)}: ${pl(e.pedidos, 'pedido', 'pedidos')} (${e.folios.join(', ')}), ${pl(e.piezas, 'pieza', 'piezas')}${mod ? `: ${mod}` : ''}.`);
    }
  } else L.push('Pedidos enviados: ninguno.');
  if (r.margen.pedidos.length > 0) L.push(`Margen menor a ${pct(r.margen.minimo_bp)} por ciento: ${r.margen.pedidos.map((p) => `${p.folio} ${pct(p.margen_bp)}`).join(', ')}.`);
  if (r.concentracion.top.length > 0) {
    const t = r.concentracion.top[0]!;
    L.push(`Concentracion: ${may(t.cliente)} es el ${pct(t.bp)} por ciento de la cartera${r.concentracion.sobre_umbral ? ' (arriba del limite)' : ''}.`);
  }
  L.push(r.libro.rojas.length === 0 ? 'Libro: cuadra.' : `Libro: NO cuadra (${r.libro.rojas.join(', ')}).`);
  return L.join('\n');
}

export interface RepPendientes {
  hoy: string;
  cartera: {
    dias: number;
    vencidos: { cliente: string; saldo_cent: number; pedidos: number; dias_atraso_max: number }[];
    vencen_manana: { cliente: string; saldo_cent: number; pedidos: number }[];
    proximos: { cliente: string; saldo_cent: number; pedidos: number; vence: string }[];
    sin_plazo_cent: number;
  };
  proveedores: { dias: number; proveedores: { proveedor: string; plazo_dias: number; deuda_cent: number; vencido_cent: number; proximo_cent: number; proximo_vence: string | null; sin_fecha_cent: number }[] };
  liquidez: { pagable_cent: number; cobrable_cent: number; cobertura_centesimas: number | null; fecha_pago: string; bajo_uno: boolean };
  tareas: { avisos_con_accion: number; diferencias_abiertas: number; tomas_omar_pendientes: number };
}

/** Pendientes de las 09:00: un solo mensaje. Si no hay nada accionable lo dice en una linea. */
export function textoPendientes(r: RepPendientes): string {
  const L: string[] = [`Pendientes del ${fechaCorta(r.hoy)}`];
  const c = r.cartera;
  if (c.vencidos.length > 0) L.push(`Vencidos: ${c.vencidos.map((x) => `${may(x.cliente)} ${m(x.saldo_cent)} (${pl(x.dias_atraso_max, 'dia', 'dias')} de atraso)`).join('; ')}.`);
  if (c.vencen_manana.length > 0) L.push(`Vencen manana: ${c.vencen_manana.map((x) => `${may(x.cliente)} ${m(x.saldo_cent)}`).join('; ')}.`);
  const otros = c.proximos.filter((x) => !c.vencen_manana.some((v) => v.cliente === x.cliente && x.vence === r.hoy));
  if (otros.length > 0) L.push(`Vencen en los proximos ${c.dias} dias: ${otros.map((x) => `${may(x.cliente)} ${m(x.saldo_cent)} (${fechaCorta(x.vence)})`).join('; ')}.`);
  if (c.sin_plazo_cent > 0) L.push(`Sin plazo acordado: ${m(c.sin_plazo_cent)}.`);
  for (const p of r.proveedores.proveedores) {
    if (p.deuda_cent === 0) continue;
    const partes: string[] = [];
    if (p.vencido_cent > 0) partes.push(`vencido ${m(p.vencido_cent)}`);
    if (p.proximo_cent > 0 && p.proximo_vence) partes.push(`${m(p.proximo_cent)} vence el ${fechaCorta(p.proximo_vence)}`);
    if (p.sin_fecha_cent > 0) partes.push(`${m(p.sin_fecha_cent)} sin fecha`);
    L.push(`Pago a ${p.proveedor} (plazo ${p.plazo_dias} dias): debemos ${m(p.deuda_cent)}${partes.length ? `; ${partes.join('; ')}` : ''}.`);
  }
  if (r.liquidez.cobertura_centesimas !== null) {
    L.push(`Cobertura de pagos a proveedores: ${pct(r.liquidez.cobertura_centesimas)}${r.liquidez.bajo_uno ? ' (menor a 1.00)' : ''}; cobrable hasta el ${fechaCorta(r.liquidez.fecha_pago)}: ${m(r.liquidez.cobrable_cent)} contra ${m(r.liquidez.pagable_cent)} por pagar.`);
  }
  const t = r.tareas;
  const tareas: string[] = [];
  if (t.avisos_con_accion > 0) tareas.push(pl(t.avisos_con_accion, 'aviso con accion', 'avisos con accion'));
  if (t.diferencias_abiertas > 0) tareas.push(pl(t.diferencias_abiertas, 'diferencia de recepcion abierta', 'diferencias de recepcion abiertas'));
  if (t.tomas_omar_pendientes > 0) tareas.push(pl(t.tomas_omar_pendientes, 'toma de Omar por autorizar', 'tomas de Omar por autorizar'));
  if (tareas.length > 0) L.push(`Tareas abiertas: ${tareas.join(', ')}.`);
  if (L.length === 1) L.push('Nada pendiente para hoy.');
  return L.join('\n');
}
