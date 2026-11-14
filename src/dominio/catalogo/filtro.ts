// Estado del filtro compartido (buscador + estado + marcas) en la URL. Las marcas van en UN parametro separado por coma: ?marca=Waka,Geek%20Bar.
export const PARAM_MARCA = 'marca';

export function marcasDeParam(v: string | string[] | undefined | null): string[] {
  const t = Array.isArray(v) ? v.join(',') : (v ?? '');
  return [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 40);
}

export const marcasAParam = (m: readonly string[]): string => [...m].join(',');

/** Marcas con mayor demanda primero (pesos dados por la pagina: clientes con precio, valor, piezas...). Maximo `n` atajos, desempate alfabetico. */
export function atajosDeMarcas(pesos: ReadonlyMap<string, number>, n = 5): string[] {
  return [...pesos.entries()].filter(([m, p]) => p > 0 && m !== 'Sin marca').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).slice(0, Math.min(n, 5)).map(([m]) => m);
}
