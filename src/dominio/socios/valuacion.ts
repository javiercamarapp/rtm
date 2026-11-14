// Tipos y view-models de api.cuenta_socios_valuacion (migracion 20261114300000). La base ya calculo cada cifra; aqui solo se nombran y se redactan los textos
// (comparacion entre socios, accion para igualar). Nada aqui calcula reglas de dinero: solo elige que frase corresponde a lo que la base entrego.

import { fraseBannerAgente, type BannerIgualacion } from './banner-igualar';

export type Socio = 'Angelo' | 'Javier';

export interface FilaSocioValuacion {
  socio: Socio;
  capital_aportado_cent: bigint;
  utilidades_acumuladas_cent: bigint;
  retirado_cent: bigint;
  retirado_utilidad_cent: bigint;
  devoluciones_capital_cent: bigint;
  fondos_en_poder_cent: bigint;
  /** capital + utilidades - retirado (antes de restar fondos en su poder): la suma de los dos es el capital contable del Balance. */
  subtotal_cent: bigint;
  valuacion_cent: bigint;
  utilidad_generada_cent: bigint;
  reinvertida_acta_cent: bigint;
  aportado_cent: bigint;
  aportacion_neta_cent: bigint;
  diferencia_a_igualar_cent: bigint;
  participacion_bp: number;
  /** Cobros de clientes (y otros movimientos) que explican los fondos de la sociedad en su poder. */
  fondos_detalle?: FondoDetalle[];
}

export interface FondoDetalle {
  fecha: string;
  monto_cent: bigint;
  motivo: string | null;
  cliente: string | null;
  concepto: string | null;
  fuente: string;
}

export type IdComponente = 'capital' | 'fondos' | 'retiros' | 'utilidades';

/** Un renglon del desglose de la diferencia de valuacion, siempre desde la perspectiva del que tiene menos (monto positivo = lo separa mas del otro). */
export interface ComponenteDiferencia {
  id: IdComponente;
  nombre: string;
  menor_cent: bigint;
  mayor_cent: bigint;
  monto_cent: bigint;
}

export interface PasoSocio {
  entregar_cent: bigint;
  valuacion_tras_entregar_cent: bigint;
  aportar_cent: bigint;
}

/** Bloque `igualacion` de la base (migracion 20261114500000): desglose y pasos para estar identicos. */
export interface IgualacionValuacion {
  igualados: boolean;
  faltan_cent: bigint;
  mayor: Socio | null;
  menor: Socio | null;
  componentes: ComponenteDiferencia[];
  suma_componentes_cent: bigint;
  por_socio: Partial<Record<Socio, PasoSocio>>;
  diferencia_libro_cent: bigint;
  coincide_con_libro: boolean;
  regla: string;
}

export interface IdentidadSocios {
  id: string;
  tipo: 'identidad' | 'alerta';
  nombre: string;
  a_nombre: string;
  a_cent: bigint;
  b_nombre: string;
  b_cent: bigint;
  ok: boolean;
}

export interface MesSerie {
  mes: string;
  fin: string;
  parcial: boolean;
  socios: { socio: Socio; valuacion_cent: bigint; capital_aportado_cent: bigint; retirado_cent: bigint; utilidades_acumuladas_cent: bigint; fondos_en_poder_cent: bigint }[];
}

export interface ComparacionSocios {
  mayor: Socio | null;
  menor: Socio | null;
  diferencia_valuacion_cent: bigint;
  diferencia_aportacion_cent: bigint;
  igualados: boolean;
  le_toca_aportar: Socio | null;
  aportar_para_igualar_cent: bigint;
  turno_aportacion_neta: Socio | null;
  retiros_desiguales: boolean;
  diferencia_retiros_cent: bigint;
  retiro_mas: Socio | null;
}

export interface CuentaSociosValuacion {
  hasta: string;
  hoy: string;
  primera_fecha: string;
  hay_movimientos: boolean;
  socios: FilaSocioValuacion[];
  total: { capital_aportado_cent: bigint; utilidades_acumuladas_cent: bigint; retirado_cent: bigint; fondos_en_poder_cent: bigint; subtotal_cent: bigint; valuacion_cent: bigint };
  comparacion: ComparacionSocios;
  igualacion: IgualacionValuacion;
  /** Banner de igualacion (migracion 20261114800000): null con un corte historico; ausente en bases anteriores. */
  banner?: BannerIgualacion | null;
  balance: { total_activo_cent: bigint; total_pasivo_cent: bigint; capital_contable_cent: bigint; cuadra: boolean };
  identidades: IdentidadSocios[];
  comprobaciones_libro: { id: string; nombre: string; a_nombre: string; a_cent: bigint; b_nombre: string; b_cent: bigint; ok: boolean; unidad?: 'n' }[];
  serie: MesSerie[];
  proveedores: {
    detalle: { proveedor: string; saldo_cent: bigint; se_debe_cent: bigint; a_favor_cent: bigint; pedidos_socio_a_costo_cent: bigint | null; deuda_empresa_cent: bigint | null }[];
    se_debe_cent: bigint;
    a_favor_cent: bigint;
    /** null = el corte no es hoy (el auxiliar de pedidos no tiene corte por fecha). */
    pedidos_socio_a_costo_cent: bigint | null;
    deuda_empresa_cent: bigint | null;
    nota: string;
  };
  definicion: string;
}

export const otroSocio = (s: Socio): Socio => (s === 'Angelo' ? 'Javier' : 'Angelo');

export const TEXTO_VALUACION_SUBE = 'Tu valuación sube con cada utilidad (siempre 50 % y 50 %) y baja solo cuando te pagas un retiro.';

type Formato = (c: bigint) => string;

export interface TarjetaValuacion {
  titulo: 'TU VALUACIÓN';
  valorCent: bigint;
  valorTexto: string;
  /** 'mas' | 'menos' | 'igual': la linea de comparacion contra el otro socio. */
  estado: 'mas' | 'menos' | 'igual';
  comparacion: string;
  /** Primera indicacion (la mas importante); `indicaciones` trae todas. */
  accion: string | null;
  indicaciones: string[];
  /** 'Faltan $X para estar idénticos' o 'Igualados'. */
  faltan: string;
  otro: Socio;
}

/** Texto de cuanto falta: "Faltan $X para estar idénticos" o "Igualados". */
export function textoFaltan(c: Pick<CuentaSociosValuacion, 'igualacion'>, formato: Formato): string {
  return c.igualacion.igualados ? 'Igualados' : `Faltan ${formato(c.igualacion.faltan_cent)} para estar idénticos`;
}

/** Indicaciones para que las valuaciones queden identicas, para el socio `yo` (todo sale de c.igualacion, calculado por la base):
 *  - quien tiene menos: "Para igualar: entrega a la sociedad los $F que tienes cobrados y aporta $A con el siguiente pago";
 *  - quien tiene mas: "<otro> debe igualar: faltan $X (entregar $F + aportar $A)". */
export function indicacionesSocio(c: Pick<CuentaSociosValuacion, 'igualacion'>, yo: Socio, formato: Formato): string[] {
  const ig = c.igualacion;
  if (ig.igualados || !ig.mayor || !ig.menor) return [];
  const salida: string[] = [];
  const mio = ig.por_socio[yo];
  const partes: string[] = [];
  if (mio && mio.entregar_cent > 0n) partes.push(`entrega a la sociedad los ${formato(mio.entregar_cent)} que tienes cobrados`);
  if (mio && mio.aportar_cent > 0n) partes.push(`aporta ${formato(mio.aportar_cent)} con el siguiente pago`);
  if (partes.length > 0) salida.push(`Para igualar: ${partes.join(' y ')}`);
  if (ig.mayor === yo) {
    const otro = otroSocio(yo);
    const p = ig.por_socio[otro];
    const detalle: string[] = [];
    if (p && p.entregar_cent > 0n) detalle.push(`entregar ${formato(p.entregar_cent)}`);
    if (p && p.aportar_cent > 0n) detalle.push(`aportar ${formato(p.aportar_cent)}`);
    const suma = (p?.entregar_cent ?? 0n) + (p?.aportar_cent ?? 0n);
    salida.push(`${otro} debe igualar: faltan ${formato(ig.faltan_cent)}${detalle.length > 0 && suma === ig.faltan_cent ? ` (${detalle.join(' + ')})` : ''}`);
  }
  return salida;
}

/** Renglones del desglose de por que uno vale menos que el otro. Solo los que no son cero; el monto lleva signo (negativo = acerca a los dos). */
export function desgloseDiferencia(c: CuentaSociosValuacion, formato: Formato): { id: IdComponente; texto: string; montoCent: bigint }[] {
  const ig = c.igualacion;
  if (ig.igualados || !ig.menor || !ig.mayor) return [];
  const menor = ig.menor;
  const mayor = ig.mayor;
  return ig.componentes.filter((k) => k.monto_cent !== 0n).map((k) => {
    const pos = k.monto_cent > 0n;
    const texto =
      k.id === 'capital' ? `${menor} aportó menos capital (${formato(k.menor_cent)} contra ${formato(k.mayor_cent)})`
      : k.id === 'fondos' ? (pos ? `Fondos de la sociedad cobrados en la cuenta de ${menor}, pendientes de entregar` : `Fondos de la sociedad cobrados en la cuenta de ${mayor}, pendientes de entregar`)
      : k.id === 'retiros' ? (pos ? `${menor} se ha pagado más en retiros (${formato(k.menor_cent)} contra ${formato(k.mayor_cent)})` : `${mayor} se ha pagado más en retiros (${formato(k.mayor_cent)} contra ${formato(k.menor_cent)})`)
      : 'Centavo suelto del reparto 50/50 de la utilidad';
    return { id: k.id, texto, montoCent: k.monto_cent };
  });
}

/** Tarjeta personal del Inicio para el socio con sesion. Criterio: la accion es la que IGUALA VALUACIONES (la diferencia de valuacion X); el desglose de X
 *  (aporto menos, fondos por entregar, retiros) y los pasos salen de la base (c.igualacion). La diferencia de aportaciones netas del libro (Y) solo difiere de X
 *  por retiros desiguales o por el centavo impar de la utilidad, y se explica en /socios. */
export function tarjetaValuacion(c: CuentaSociosValuacion, yo: Socio, formato: Formato): TarjetaValuacion | null {
  const mia = c.socios.find((s) => s.socio === yo);
  if (!mia) return null;
  const otro = otroSocio(yo);
  const x = c.comparacion.diferencia_valuacion_cent;
  const faltan = textoFaltan(c, formato);
  const base = { titulo: 'TU VALUACIÓN' as const, valorCent: mia.valuacion_cent, valorTexto: formato(mia.valuacion_cent), otro, faltan };
  if (c.comparacion.igualados || c.comparacion.mayor === null) return { ...base, estado: 'igual', comparacion: `Estás igualado con ${otro}`, accion: null, indicaciones: [] };
  const ind = indicacionesSocio(c, yo, formato);
  if (c.comparacion.mayor === yo) return { ...base, estado: 'mas', comparacion: `Tienes ${formato(x)} más que ${otro}`, accion: ind[0] ?? `${otro} debe igualar`, indicaciones: ind };
  return { ...base, estado: 'menos', comparacion: `Tienes ${formato(x)} menos que ${otro}`, accion: ind[0] ?? `Te toca aportar ${formato(c.comparacion.aportar_para_igualar_cent)} para igualar`, indicaciones: ind };
}

/** 'Faltan $X: entregar $F y aportar $A' del que tiene menos (misma fuente que los pasos: c.igualacion). Con retiros desiguales o fondos del otro, solo se nombran los pasos que existen. */
export function textoFaltanPasos(c: Pick<CuentaSociosValuacion, 'igualacion'>, formato: Formato): string {
  const ig = c.igualacion;
  const p = ig.menor ? ig.por_socio[ig.menor] : undefined;
  const partes: string[] = [];
  if (p && p.entregar_cent > 0n) partes.push(`entregar ${formato(p.entregar_cent)}`);
  if (p && p.aportar_cent > 0n) partes.push(`aportar ${formato(p.aportar_cent)}`);
  return `Faltan ${formato(ig.faltan_cent)}${partes.length > 0 ? `: ${partes.join(' y ')}` : ''}`;
}

export interface FraseIgualar { texto: string; tono: 'ok' | 'atencion' }

/** Frase de la cabecera de /socios y del agente: quien tiene mas y quien debe igualar. */
export function fraseIgualar(c: CuentaSociosValuacion, formato: Formato): FraseIgualar {
  const x = c.comparacion.diferencia_valuacion_cent;
  if (c.comparacion.igualados || !c.comparacion.mayor || !c.comparacion.menor) return { texto: 'Valuaciones iguales: los dos están igualados.', tono: 'ok' };
  return { texto: `${c.comparacion.mayor} tiene ${formato(x)} más que ${c.comparacion.menor}. ${textoFaltanPasos(c, formato)} para igualar valuaciones.`, tono: 'atencion' };
}

/** Alerta de retiro desigual ('siempre nos pagamos lo mismo'). null si son iguales. */
export function alertaRetiros(c: CuentaSociosValuacion, formato: Formato): string | null {
  const k = c.comparacion;
  if (!k.retiros_desiguales || !k.retiro_mas) return null;
  return `Retiro desigual: ${k.retiro_mas} se ha pagado ${formato(k.diferencia_retiros_cent)} más que ${otroSocio(k.retiro_mas)}. Para igualar retiros, ${otroSocio(k.retiro_mas)} se paga esa diferencia.`;
}

/** Por que X (valuacion) y Y (aportacion neta) pueden diferir; null cuando coinciden. */
export function notaDiferencias(c: CuentaSociosValuacion, formato: Formato): string | null {
  const x = c.comparacion.diferencia_valuacion_cent;
  const y = c.comparacion.diferencia_aportacion_cent;
  if (x === y) return null;
  const d = y > x ? y - x : x - y;
  return c.comparacion.retiros_desiguales
    ? `La diferencia de valuación (${formato(x)}) y la de aportaciones (${formato(y)}) se separan ${formato(d)} por los retiros desiguales.`
    : `La diferencia de valuación (${formato(x)}) y la de aportaciones (${formato(y)}) se separan ${formato(d)}: es el centavo suelto de la utilidad impar (redondeo a favor de quien aporta).`;
}

/** Puntos de la grafica de la valuacion por mes (centavos como number, solo para dibujar). */
export function puntosSerie(c: CuentaSociosValuacion, socio: Socio): { mes: string; valor: number }[] {
  return c.serie.flatMap((m) => {
    const f = m.socios.find((s) => s.socio === socio);
    return f ? [{ mes: m.mes, valor: Number(f.valuacion_cent) }] : [];
  });
}

/** Lo que lee el agente de Telegram (agente.valuacion_socios): las mismas cifras que la web, sin serie ni detalle. */
export interface VistaValuacionAgente {
  socios: { socio: Socio; valuacion_cent: bigint; fondos_en_poder_cent: bigint; capital_aportado_cent: bigint }[];
  igualacion: IgualacionValuacion;
  banner?: BannerIgualacion | null;
  retiros_desiguales: boolean;
  diferencia_retiros_cent: bigint;
  retiro_mas: Socio | null;
}

/** Respuesta determinista de 'mi valuacion' / 'como estamos' para el socio que pregunta: "Tu valuacion $X · Tienes $Y mas/menos que <otro> · <instruccion>".
 *  Solo redacta lo que la base entrego; el modelo nunca calcula dinero. */
export function respuestaValuacionAgente(v: VistaValuacionAgente, yo: Socio, formato: Formato): { valuacionCent: bigint; textos: { etiqueta: string; texto: string }[] } | null {
  const mia = v.socios.find((s) => s.socio === yo);
  const otra = v.socios.find((s) => s.socio === otroSocio(yo));
  if (!mia || !otra) return null;
  const ig = v.igualacion;
  const textos: { etiqueta: string; texto: string }[] = [];
  if (ig.igualados) textos.push({ etiqueta: 'Contra ' + otra.socio, texto: `Estás igualado con ${otra.socio}` });
  else {
    const menos = mia.valuacion_cent < otra.valuacion_cent;
    textos.push({ etiqueta: 'Contra ' + otra.socio, texto: `Tienes ${formato(ig.faltan_cent)} ${menos ? 'menos' : 'más'} que ${otra.socio}` });
    textos.push({ etiqueta: 'Estado', texto: textoFaltan({ igualacion: ig }, formato) });
    const ind = indicacionesSocio({ igualacion: ig }, yo, formato);
    ind.forEach((t, i) => textos.push({ etiqueta: i === 0 ? 'Cómo igualar' : 'Además', texto: t }));
    const frase = fraseBannerAgente(v.banner, yo, formato);
    if (frase) textos.push({ etiqueta: 'Igualar valuación', texto: frase });
  }
  if (v.retiros_desiguales && v.retiro_mas) textos.push({ etiqueta: 'Retiros', texto: `${v.retiro_mas} se ha pagado ${formato(v.diferencia_retiros_cent)} más que ${otroSocio(v.retiro_mas)}` });
  return { valuacionCent: mia.valuacion_cent, textos };
}
