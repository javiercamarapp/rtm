// Tipos y view-models de api.cuenta_socios_valuacion (migracion 20261114300000). La base ya calculo cada cifra; aqui solo se nombran y se redactan los textos
// (comparacion entre socios, accion para igualar). Nada aqui calcula reglas de dinero: solo elige que frase corresponde a lo que la base entrego.

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
  balance: { total_activo_cent: bigint; total_pasivo_cent: bigint; capital_contable_cent: bigint; cuadra: boolean };
  identidades: IdentidadSocios[];
  comprobaciones_libro: { id: string; nombre: string; a_nombre: string; a_cent: bigint; b_nombre: string; b_cent: bigint; ok: boolean; unidad?: 'n' }[];
  serie: MesSerie[];
  proveedores: {
    detalle: { proveedor: string; saldo_cent: bigint }[];
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
  accion: string | null;
  otro: Socio;
}

/** Tarjeta personal del Inicio para el socio con sesion. Criterio: la accion es la que IGUALA VALUACIONES (aportar X, la diferencia de valuacion);
 *  la diferencia de aportaciones netas del libro (Y) solo difiere de X por retiros desiguales o por el centavo impar de la utilidad, y se explica en /socios. */
export function tarjetaValuacion(c: CuentaSociosValuacion, yo: Socio, formato: Formato): TarjetaValuacion | null {
  const mia = c.socios.find((s) => s.socio === yo);
  if (!mia) return null;
  const otro = otroSocio(yo);
  const x = c.comparacion.diferencia_valuacion_cent;
  const base = { titulo: 'TU VALUACIÓN' as const, valorCent: mia.valuacion_cent, valorTexto: formato(mia.valuacion_cent), otro };
  if (c.comparacion.igualados || c.comparacion.mayor === null) return { ...base, estado: 'igual', comparacion: `Estás igualado con ${otro}`, accion: null };
  if (c.comparacion.mayor === yo) return { ...base, estado: 'mas', comparacion: `Tienes ${formato(x)} más que ${otro}`, accion: `${otro} debe igualar` };
  return { ...base, estado: 'menos', comparacion: `Tienes ${formato(x)} menos que ${otro}`, accion: `Te toca aportar ${formato(c.comparacion.aportar_para_igualar_cent)} para igualar` };
}

export interface FraseIgualar { texto: string; tono: 'ok' | 'atencion' }

/** Frase de la cabecera de /socios y del agente: quien tiene mas y quien debe igualar. */
export function fraseIgualar(c: CuentaSociosValuacion, formato: Formato): FraseIgualar {
  const x = c.comparacion.diferencia_valuacion_cent;
  if (c.comparacion.igualados || !c.comparacion.mayor || !c.comparacion.menor) return { texto: 'Valuaciones iguales: los dos están igualados.', tono: 'ok' };
  return { texto: `${c.comparacion.mayor} tiene ${formato(x)} más que ${c.comparacion.menor}. Le toca aportar ${formato(c.comparacion.aportar_para_igualar_cent)} a ${c.comparacion.menor} para igualar valuaciones.`, tono: 'atencion' };
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
