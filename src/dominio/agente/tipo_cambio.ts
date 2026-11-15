// Tipo de cambio dicho por el socio ("18.50", "18,5", "$18.5") a micro-pesos por dolar, solo con texto exacto: no hay aritmetica de dinero con decimales flotantes.
// "el del dia" (o sin cifra) devuelve null: la base usa el tipo de cambio registrado del dia o rechaza si no lo hay (agente.ejecutar_ext gasto_servicio).
export function tipoCambioMicro(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const m = /(\d{1,3})(?:[.,](\d{1,6}))?/.exec(texto.replace(/\s+/g, ''));
  if (!m) return null;
  const micro = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0') || '0');
  return micro > 0 ? micro : null;
}
