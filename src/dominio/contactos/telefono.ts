// Normalizacion de telefonos a E.164 (Mexico por omision). Funciones puras.

export type MotivoTelefonoInvalido = 'vacio' | 'corto' | 'largo' | 'patron_falso' | 'sin_lada';

export type ResultadoTelefono = { ok: true; e164: string; extranjero: boolean } | { ok: false; motivo: MotivoTelefonoInvalido };

/** Separa varios telefonos en una celda: ' ::: ' (Google), punto y coma, barra, salto de linea, coma o ' y '. */
export function separarTelefonos(celda: string): string[] {
  return celda
    .split(/\s*:::\s*|[;\n\r|/]+|,|\s+y\s+/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

function esPatronFalso(diez: string): boolean {
  if (/^(\d)\1{9}$/.test(diez)) return true; // 0000000000, 5555555555
  if (diez === '1234567890' || diez === '0123456789' || diez === '9876543210') return true;
  const cuerpo = diez.slice(3);
  return /^(\d)\1{6}$/.test(cuerpo); // lada valida con siete digitos iguales
}

/** Normaliza un telefono suelto. Acepta +52, 52, 521, prefijos 01/044/045/00, parentesis, guiones y espacios. */
export function normalizarTelefono(crudo: string): ResultadoTelefono {
  const texto = (crudo ?? '').trim().replace(/^[a-z]+:\s*/i, '');
  if (texto === '') return { ok: false, motivo: 'vacio' };
  // Quitar extensiones ("ext. 12", "x12").
  const sinExt = texto.replace(/\s*(ext\.?|extension|x)\s*\d+\s*$/i, '');
  const explicitoMas = sinExt.startsWith('+') || /^00\d/.test(sinExt);
  let d = sinExt.replace(/\D/g, '');
  if (d === '') return { ok: false, motivo: 'vacio' };
  if (/^00/.test(sinExt.replace(/[^\d+]/g, ''))) d = d.slice(2);

  if (explicitoMas && !d.startsWith('52')) {
    if (d.length < 8) return { ok: false, motivo: 'corto' };
    if (d.length > 15) return { ok: false, motivo: 'largo' };
    if (/^(\d)\1+$/.test(d)) return { ok: false, motivo: 'patron_falso' };
    return { ok: true, e164: `+${d}`, extranjero: true };
  }

  // Prefijos mexicanos antiguos y de marcacion.
  if (d.startsWith('521') && d.length === 13) d = d.slice(3);
  else if (d.startsWith('52') && d.length === 12) d = d.slice(2);
  else if ((d.startsWith('044') || d.startsWith('045')) && d.length === 13) d = d.slice(3);
  else if ((d.startsWith('01') || d.startsWith('044') || d.startsWith('045')) && d.length === 12) d = d.slice(2);
  else if ((d.startsWith('044') || d.startsWith('045')) && d.length === 12) d = d.slice(3);

  if (d.length < 7) return { ok: false, motivo: 'corto' };
  if (d.length < 10) return { ok: false, motivo: d.length === 7 || d.length === 8 ? 'sin_lada' : 'corto' };
  if (d.length > 10) return { ok: false, motivo: 'largo' };
  if (!/^[2-9]/.test(d) || esPatronFalso(d)) return { ok: false, motivo: 'patron_falso' };
  return { ok: true, e164: `+52${d}`, extranjero: false };
}

/** Ultimos 2 digitos para mostrar al agente de IA y en vistas enmascaradas. */
export function enmascararTelefono(e164: string): string {
  const d = e164.replace(/\D/g, '');
  return d.length < 2 ? '**' : `+** **** **${d.slice(-2)}`;
}
