// Modelo de vista de "Explicar este numero": convierte la Explicacion que entrega la base (o el armador de Omar/capital/cuadre) en secciones ya formateadas.
// Aqui solo se ordena, se nombra y se da formato: NINGUN importe se calcula en TypeScript. Una seccion sin datos no existe (sin secciones vacias).
import type { Explicacion } from '@/dominio/catalogo/tipos';
import { etiquetaFecha, etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { enlaceDePartida, fichaDe, nombreDeCuenta, periodoDe, type Enlace, type Ficha } from './fichas';
import { terminosDe, type Termino } from './glosario';

export type IdSeccion = 'definicion' | 'origen' | 'visual' | 'comprobacion' | 'detalle' | 'supuestos' | 'historial' | 'cuentas' | 'glosario';
export type Modo = 'socio' | 'omar';

export const TITULOS: Readonly<Record<IdSeccion, string>> = {
  definicion: 'Definición y fórmula', origen: 'De dónde sale', visual: 'Visual', comprobacion: 'Comprobación por dos vías', detalle: 'Detalle de movimientos',
  supuestos: 'Supuestos y estados', historial: 'Historial', cuentas: 'Cuentas del libro involucradas', glosario: 'Glosario',
};

export type ClaveEstado = 'cuadra' | 'no_cuadra' | 'sin_comprobar' | 'estimado';
export interface Partida { id: string; concepto: string; monto: number; montoTexto: string; origen: string; enlace: Enlace | null }
export interface Margen { proveedor: string; costoTexto: string; margenTexto: string; cuadra: boolean; supuesto: boolean; desde: string; fuente: string }
export interface FilaDetalle { id: string; folio: string; fecha: string | null; fechaTexto: string; concepto: string; monto: number; montoTexto: string; saldoTexto: string | null; origen: string; nota: string | null }
export interface PuntoSerie { id: string; etiqueta: string; valor: number; texto: string }
export interface PasoVisual { id: string; etiqueta: string; valor: number; texto: string; tipo: 'delta' | 'total' }
export type Visual =
  | { tipo: 'cascada'; titulo: string; pasos: PasoVisual[]; unidad: string }
  | { tipo: 'barras'; titulo: string; datos: { id: string; etiqueta: string; valor: number; texto: string }[]; unidad: string; nota: string | null }
  | { tipo: 'tendencia'; titulo: string; puntos: PuntoSerie[]; unidad: string; conNegativos: boolean };
export interface CuentaVista { codigo: string; nombre: string; saldoTexto: string | null; enlace: Enlace | null }

export interface Vista {
  cifra: string;
  titulo: string;
  valorTexto: string | null;
  unidad: Explicacion['unidad'];
  definicion: string | null;
  periodo: string | null;
  corte: string | null;
  estado: { clave: ClaveEstado; texto: string };
  formula: Ficha['formula'];
  fuenteTexto: string | null;
  fuenteEnlace: Enlace | null;
  partidas: Partida[];
  margenes: Margen[];
  precioTexto: string | null;
  resumenOrigen: string | null;
  visual: Visual | null;
  comprobacion: { via1: string; via1Texto: string; via2: string; via2Texto: string; cuadra: boolean; diferenciaTexto: string | null } | null;
  detalle: FilaDetalle[];
  supuestos: string[];
  serie: PuntoSerie[];
  cuentas: CuentaVista[];
  glosario: Termino[];
  secciones: IdSeccion[];
}

const MAX_PASOS_CASCADA = 8;
const MAX_PUNTOS_SERIE = 60;

function formateador(unidad: Explicacion['unidad']): (n: number) => string {
  return (n) => (unidad === 'pz' ? formatearPiezas(n) : unidad === 'ident' ? `${n} ident.` : formatearMoneda(BigInt(n)));
}
const dinero = (c: bigint) => formatearMoneda(c);
const num = (c: bigint) => Number(c);

function origenDe(r: { canal: string | null; autor: string | null; evento: string | null; mensajeOrigen: string | null }, ficha: Ficha | null): string {
  const partes = [r.autor ?? r.canal, r.evento].filter((x): x is string => !!x);
  if (partes.length) return partes.join(' · ');
  return ficha?.fuente?.texto ?? 'Cálculo de la base';
}

function periodoTexto(cifra: string, corte: Explicacion['corte']): string | null {
  const p = periodoDe(cifra);
  if (p) return p.inicio ? `Del ${etiquetaFecha(p.inicio)} al ${etiquetaFecha(p.fin)}` : `Al ${etiquetaFecha(p.fin)}`;
  return corte ? `Al ${etiquetaFecha(corte.fecha)}` : null;
}

export function armarVista(d: Explicacion, modo: Modo = 'socio'): Vista {
  const fmt = formateador(d.unidad);
  const ficha = fichaDe(d.cifra);
  const esSocio = modo === 'socio';
  const fuenteEnlace = esSocio ? ficha?.fuente ?? null : null;

  // Detalle: movimientos de piezas y renglones con marca de tiempo (libro). Los renglones sin hora son partidas de composicion.
  const detalle: FilaDetalle[] = [
    ...d.movimientos.map((m, i): FilaDetalle => ({
      id: `m-${m.evento}-${i}`, folio: m.evento, fecha: m.hora, fechaTexto: etiquetaFechaHora(m.hora),
      concepto: `${m.tipo.replaceAll('_', ' ')} · ${m.sabor} · ${m.ubicacion}`, monto: m.cantidad, montoTexto: formatearPiezas(m.cantidad), saldoTexto: formatearPiezas(m.saldo),
      origen: m.autor ? `${m.autor} · ${m.canal}` : m.canal, nota: m.mensajeOrigen,
    })),
    ...d.renglones.filter((r) => r.hora !== null).map((r, i): FilaDetalle => ({
      id: `r-${r.evento ?? ''}-${i}`, folio: r.evento ?? '', fecha: r.hora, fechaTexto: etiquetaFechaHora(r.hora!), concepto: r.concepto, monto: num(r.montoCent), montoTexto: dinero(r.montoCent),
      saldoTexto: r.saldoCent === null ? null : dinero(r.saldoCent), origen: r.autor ?? r.canal ?? 'Libro de movimientos', nota: r.mensajeOrigen,
    })),
  ];

  const partidas: Partida[] = d.renglones.filter((r) => r.hora === null).map((r, i) => ({
    id: `p-${i}`, concepto: r.concepto, monto: num(r.montoCent), montoTexto: dinero(r.montoCent), origen: origenDe(r, ficha), enlace: esSocio ? enlaceDePartida(r.concepto) : null,
  }));

  // Margen por proveedor (solo socio: Omar y bodega nunca reciben costos, y aqui tampoco se pintarian).
  const margenes: Margen[] = esSocio ? d.costos.map((c) => ({ proveedor: c.proveedor, costoTexto: dinero(c.costoCent), margenTexto: dinero(c.margenCent), cuadra: c.cuadra, supuesto: c.supuesto, desde: etiquetaFecha(c.desde), fuente: c.fuente })) : [];

  // Serie: historial mensual de la base; si no hay, el saldo corrido de los movimientos (solo si el saldo viene del libro).
  let serie: PuntoSerie[] = (d.historial ?? []).map((h) => ({ id: h.periodo, etiqueta: h.periodo, valor: num(h.valorCent), texto: dinero(h.valorCent) }));
  if (serie.length < 2) {
    const ord = [...d.movimientos].sort((a, b) => a.hora.localeCompare(b.hora));
    serie = ord.map((m, i) => ({ id: `s-${i}`, etiqueta: etiquetaFechaHora(m.hora), valor: m.saldo, texto: formatearPiezas(m.saldo) }));
    if (serie.length < 2) {
      const libro = d.renglones.filter((r) => r.hora !== null && r.saldoCent !== null).sort((a, b) => a.hora!.localeCompare(b.hora!));
      serie = libro.map((r, i) => ({ id: `s-${i}`, etiqueta: etiquetaFechaHora(r.hora!), valor: num(r.saldoCent!), texto: dinero(r.saldoCent!) }));
    }
  }
  if (serie.length > MAX_PUNTOS_SERIE) serie = serie.slice(serie.length - MAX_PUNTOS_SERIE);
  if (serie.length < 2) serie = [];

  // Visual: puente de composicion si hay partidas; si no, la tendencia.
  let visual: Visual | null = null;
  if (partidas.length >= 2 && d.unidad === 'mxn') {
    if (partidas.length <= MAX_PASOS_CASCADA && d.valor !== null) {
      visual = {
        tipo: 'cascada', unidad: 'Monto', titulo: 'De las partidas a la cifra',
        pasos: [...partidas.map((p): PasoVisual => ({ id: p.id, etiqueta: p.concepto, valor: p.monto, texto: formatearMoneda(BigInt(p.monto), { conSigno: true }), tipo: 'delta' })), { id: 'total', etiqueta: 'Cifra', valor: d.valor, texto: fmt(d.valor), tipo: 'total' }],
      };
    } else if (partidas.every((p) => p.monto >= 0)) {
      const top = [...partidas].sort((a, b) => b.monto - a.monto).slice(0, MAX_PASOS_CASCADA);
      visual = { tipo: 'barras', unidad: 'Monto', titulo: 'Partidas principales', datos: top.map((p) => ({ id: p.id, etiqueta: p.concepto, valor: p.monto, texto: p.montoTexto })), nota: partidas.length > top.length ? `Se muestran las ${top.length} mayores de ${partidas.length} partidas; la tabla trae todas.` : null };
    }
  }
  if (!visual && serie.length >= 2) visual = { tipo: 'tendencia', titulo: 'Cómo ha cambiado', puntos: serie, unidad: d.unidad === 'pz' ? 'Piezas' : 'Saldo', conNegativos: serie.some((p) => p.valor < 0) };

  const comprobacion = d.comprobacion ? {
    via1: d.comprobacion.via1, via1Texto: fmt(d.comprobacion.via1Valor), via2: d.comprobacion.via2, via2Texto: fmt(d.comprobacion.via2Valor), cuadra: d.comprobacion.cuadra,
    diferenciaTexto: typeof d.comprobacion.diferencia === 'number' ? fmt(d.comprobacion.diferencia) : null,
  } : null;

  const supuestos: string[] = [];
  if (/estimad/i.test(d.titulo)) supuestos.push('Cifra estimada: es una proyección con un modelo, no un hecho registrado. Se muestra con su rango y la muestra mínima; sin historia suficiente no se emite.');
  if (d.valor === null) supuestos.push('Sin dato: la base no tiene con qué calcular esta cifra. No es cero.');
  if (/provisional/i.test(d.titulo)) supuestos.push('Provisional: hay guías o costos todavía sin confirmar; la cifra puede cambiar.');
  for (const c of margenes) if (c.supuesto) supuestos.push(`El costo de ${c.proveedor} es un supuesto (${c.fuente}); aún no lo confirma una compra.`);
  if (d.renglones.length === 0 && d.movimientos.length === 0 && d.costos.length === 0 && d.valor !== null) supuestos.push('Esta cifra no trae partidas ni movimientos desde la base; solo se muestra su valor.');
  if (!d.comprobacion && d.valor !== null) supuestos.push('Sin segunda vía de comprobación para esta cifra.');

  // Cuentas del libro: las que reporta la base (con saldo) o, si no, las de la ficha. Omar nunca ve cuentas.
  const cuentasBase = esSocio ? (d.cuentas ?? []).map((c): CuentaVista => ({ codigo: c.codigo, nombre: c.nombre, saldoTexto: c.saldoCent === null ? null : dinero(c.saldoCent), enlace: { href: `/contabilidad/mayor?cuenta=${c.codigo}`, texto: 'Mayor' } })) : [];
  const cuentas: CuentaVista[] = cuentasBase.length ? cuentasBase : esSocio ? (ficha?.cuentas ?? []).map((c) => ({ codigo: c.codigo, nombre: nombreDeCuenta(c.codigo) ?? c.nombre, saldoTexto: null, enlace: { href: `/contabilidad/mayor?cuenta=${c.codigo}`, texto: 'Mayor' } })) : [];

  const claves = [...(ficha?.glosario ?? [])];
  if (comprobacion && !claves.includes('dos_vias')) claves.push('dos_vias');
  const glosario = terminosDe(claves);

  const estado: Vista['estado'] = /estimad/i.test(d.titulo) ? { clave: 'estimado', texto: 'Estimado' }
    : comprobacion ? (comprobacion.cuadra ? { clave: 'cuadra', texto: 'Cuadra' } : { clave: 'no_cuadra', texto: 'No cuadra' })
      : { clave: 'sin_comprobar', texto: 'Sin segunda vía' };

  const hayOrigen = partidas.length > 0 || margenes.length > 0 || !!d.fuente || detalle.length > 0 || d.precioCent !== null;
  const secciones: IdSeccion[] = [];
  if (ficha) secciones.push('definicion');
  if (hayOrigen) secciones.push('origen');
  if (visual) secciones.push('visual');
  if (comprobacion) secciones.push('comprobacion');
  if (detalle.length > 0) secciones.push('detalle');
  if (supuestos.length > 0) secciones.push('supuestos');
  if (serie.length >= 2) secciones.push('historial');
  if (cuentas.length > 0) secciones.push('cuentas');
  if (glosario.length > 0) secciones.push('glosario');

  return {
    cifra: d.cifra, titulo: d.titulo, valorTexto: d.valor === null ? null : fmt(d.valor), unidad: d.unidad, definicion: ficha?.definicion ?? null,
    periodo: periodoTexto(d.cifra, d.corte), corte: d.corte ? etiquetaFechaHora(d.corte.hora) : null, estado, formula: ficha?.formula ?? null,
    fuenteTexto: d.fuente ?? null, fuenteEnlace, partidas, margenes, precioTexto: d.precioCent === null ? null : dinero(d.precioCent),
    resumenOrigen: detalle.length > 0 && partidas.length === 0 ? `Se forma con ${detalle.length} ${detalle.length === 1 ? 'movimiento' : 'movimientos'} registrados; el detalle está más abajo.` : null,
    visual, comprobacion, detalle, supuestos, serie, cuentas, glosario, secciones,
  };
}

/** Sentido de los puntos de la tendencia para el pie de la grafica. */
export function descripcionSerie(serie: readonly PuntoSerie[]): string {
  const a = serie[0];
  const z = serie[serie.length - 1];
  return a && z ? `De ${a.texto} (${a.etiqueta}) a ${z.texto} (${z.etiqueta}) en ${serie.length} puntos` : 'Sin puntos';
}
