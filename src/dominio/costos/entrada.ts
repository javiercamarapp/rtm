// Lectura y presentacion de cifras de costos escritas o mostradas por personas. Enteros bigint, sin flotantes.

/** "75.5" o "1,234.123456" -> millonesimas (75500000n). null si no es un monto valido, es negativo o trae mas de 6 decimales. */
export function microDeTexto(texto: string): bigint | null {
  const t = texto.trim().replace(/,/g, '').replace(/^\$/, '');
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(t);
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}

/** "17", "16.67" -> ppm (170000n). Entre 0 y 100. */
export function ppmDeTexto(texto: string): bigint | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(texto.trim());
  if (!m) return null;
  const ppm = BigInt(m[1]!) * 10_000n + BigInt((m[2] ?? '').padEnd(4, '0'));
  return ppm > 1_000_000n ? null : ppm;
}

/** Millonesimas a texto con dos decimales como minimo ("75.50"), sin redondear mentiras: muestra hasta 6 decimales si hacen falta. */
export function textoMicro(micro: bigint, minimo = 2): string {
  const neg = micro < 0n;
  const a = neg ? -micro : micro;
  const ent = a / 1_000_000n;
  let dec = (a % 1_000_000n).toString().padStart(6, '0');
  while (dec.length > minimo && dec.endsWith('0')) dec = dec.slice(0, -1);
  return `${neg ? '-' : ''}${ent.toLocaleString('en-US')}.${dec}`;
}

/** Centavos x 1e6 (el "exacto") a pesos con hasta 4 decimales significativos: 23587500000n -> "235.875". */
export function pesosDeExactoE6(e6: bigint): string {
  const neg = e6 < 0n;
  const a = neg ? -e6 : e6;
  const ent = a / 100_000_000n;
  let dec = (a % 100_000_000n).toString().padStart(8, '0');
  while (dec.length > 2 && dec.endsWith('0')) dec = dec.slice(0, -1);
  return `${neg ? '-' : ''}${ent.toLocaleString('en-US')}.${dec}`;
}

/** Participacion en ppm a porcentaje: 166666n -> "16.67" (solo para mostrar). */
export function textoPct(ppm: bigint): string {
  const cent = (ppm + 50n) / 100n;
  return `${cent / 100n}.${(cent % 100n).toString().padStart(2, '0')}`;
}

/** AAAA-MM de una fecha de negocio AAAA-MM-DD. */
export const mesDe = (fecha: string): string => fecha.slice(0, 7);

export const ETIQUETA_COSTO: Record<string, string> = {
  medido: 'Medido', recibo: 'Recibo', capturado: 'Capturado', atribuido: 'Atribuido', estimado_prorrateado: 'Estimado, prorrateado', proyeccion: 'Proyección',
};
