// Captura rapida de muchos sabores: una linea por sabor ("Fresa 8", "Mango x 12", "Uva: 10"). Sin I/O; lo que no se reconoce se devuelve como error, nunca se adivina.
export interface RenglonPegado { sabor: string; piezas: number }
export interface ResultadoPegado { renglones: RenglonPegado[]; errores: string[] }

const LINEA = /^\s*(.+?)\s*(?:x|×|:|-|=)?\s*(\d{1,4})\s*(?:pzas?|pz|piezas?)?\s*$/i;

export function parsearPegado(texto: string, saboresValidos?: string[]): ResultadoPegado {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  const mapa = saboresValidos ? new Map(saboresValidos.map((s) => [norm(s), s])) : null;
  const acumulado = new Map<string, number>();
  const errores: string[] = [];
  for (const cruda of texto.split(/\r?\n/)) {
    if (!cruda.trim()) continue;
    const m = LINEA.exec(cruda);
    if (!m || !m[1] || !m[2]) { errores.push(`No entiendo: "${cruda.trim()}"`); continue; }
    const piezas = Number(m[2]);
    if (!Number.isInteger(piezas) || piezas <= 0) { errores.push(`Piezas inválidas en: "${cruda.trim()}"`); continue; }
    const nombre = mapa ? mapa.get(norm(m[1])) : m[1].trim();
    if (!nombre) { errores.push(`El sabor "${m[1].trim()}" no está en el catálogo de ese modelo`); continue; }
    acumulado.set(nombre, (acumulado.get(nombre) ?? 0) + piezas);
  }
  return { renglones: [...acumulado.entries()].map(([sabor, piezas]) => ({ sabor, piezas })), errores };
}
