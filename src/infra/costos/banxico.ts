// Adaptador del FIX de Banxico (serie SF43718, SIE API REST) detras de `PuertoTipoCambio`.
// El token y la funcion de red entran como parametros: este archivo no lee el entorno ni hace red por si solo.
// Si el dia es inhabil se usa el ultimo FIX publicado y se devuelve su fecha efectiva. No se inventa tipo de cambio.

import type { PuertoTipoCambio } from '@/aplicacion/costos/puertos';
import { sumarDias } from '@/dominio/calendario';
import type { TipoCambioFechado } from '@/dominio/costos/cargo';
import { ErrorCostos } from '@/dominio/costos/errores';

export const SERIE_FIX = 'SF43718';
export const URL_BASE_BANXICO = 'https://www.banxico.org.mx/SieAPIRest/service/v1';
/** Dias hacia atras que se piden para cubrir fines de semana y festivos. */
const VENTANA_DIAS = 10;

export type FetchBanxico = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface OpcionesBanxico {
  token: string;
  fetchFn: FetchBanxico;
  urlBase?: string;
}

/** "18.5000" -> 18_500_000n (millonesimas). Rechaza formatos raros y mas de 6 decimales significativos. */
export function microDesdeTexto(texto: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(texto.trim());
  if (!m) throw new ErrorCostos('tipo_cambio_invalido', 'Dato de tipo de cambio ilegible.');
  const dec = m[2] ?? '';
  if (/[1-9]/.test(dec.slice(6))) throw new ErrorCostos('tipo_cambio_invalido', 'El tipo de cambio trae mas de 6 decimales significativos.');
  return BigInt(m[1]!) * 1_000_000n + BigInt(dec.slice(0, 6).padEnd(6, '0'));
}

/** "dd/MM/yyyy" -> "yyyy-MM-dd". */
export function fechaDesdeBanxico(texto: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!m) throw new ErrorCostos('tipo_cambio_invalido', 'Fecha de Banxico ilegible.');
  return `${m[3]}-${m[2]}-${m[1]}`;
}

interface Dato {
  fecha: string;
  dato: string;
}

/** Extrae los datos publicados de la respuesta SIE, ignorando "N/E" (sin dato). */
export function datosDeRespuesta(cuerpo: unknown): Dato[] {
  const series = (cuerpo as { bmx?: { series?: Array<{ datos?: Dato[] }> } } | null)?.bmx?.series;
  const datos = series?.[0]?.datos;
  if (!Array.isArray(datos)) return [];
  return datos.filter((d) => typeof d?.fecha === 'string' && typeof d?.dato === 'string' && /^\d/.test(d.dato));
}

export function crearTipoCambioBanxico(op: OpcionesBanxico): PuertoTipoCambio {
  const base = op.urlBase ?? URL_BASE_BANXICO;
  return {
    async delDia(fechaNeg: string): Promise<TipoCambioFechado | null> {
      const desde = sumarDias(fechaNeg, -VENTANA_DIAS);
      const url = `${base}/series/${SERIE_FIX}/datos/${desde}/${fechaNeg}`;
      const r = await op.fetchFn(url, { headers: { 'Bmx-Token': op.token, Accept: 'application/json' } });
      if (!r.ok) return null;
      const publicados = datosDeRespuesta(await r.json())
        .map((d) => ({ fecha: fechaDesdeBanxico(d.fecha), tc: microDesdeTexto(d.dato) }))
        .filter((d) => d.fecha <= fechaNeg)
        .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
      const ultimo = publicados.at(-1);
      return ultimo ? { tcMicro: ultimo.tc, fecha: ultimo.fecha, fuente: 'banxico_fix' } : null;
    },
  };
}
