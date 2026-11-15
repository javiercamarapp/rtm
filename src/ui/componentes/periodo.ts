/** Atajos del filtro de periodo: fechas locales en formato AAAA-MM-DD (lo que envia un input date). Sin dependencias del servidor. */
export interface AtajoPeriodo { id: 'hoy' | '7d' | '30d' | 'mes'; etiqueta: string; desde: string; hasta: string }

const dos = (n: number) => String(n).padStart(2, '0');
export const fechaLocalIso = (d: Date): string => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

export function atajosPeriodo(hoy: Date): AtajoPeriodo[] {
  const atras = (n: number) => { const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - n); return fechaLocalIso(d); };
  const h = fechaLocalIso(hoy);
  return [
    { id: 'hoy', etiqueta: 'Hoy', desde: h, hasta: h },
    { id: '7d', etiqueta: '7 días', desde: atras(6), hasta: h },
    { id: '30d', etiqueta: '30 días', desde: atras(29), hasta: h },
    { id: 'mes', etiqueta: 'Este mes', desde: `${hoy.getFullYear()}-${dos(hoy.getMonth() + 1)}-01`, hasta: h },
  ];
}
