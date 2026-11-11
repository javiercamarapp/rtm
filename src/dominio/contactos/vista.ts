// Tipos y reglas de presentacion de la pantalla de contactos de menudeo. Puro.

export interface ContactoFila {
  id: number;
  nombre: string;
  /** Siempre enmascarado: el telefono completo solo sale al revelarlo (con registro). */
  telefonoMascara: string;
  telefonos: number;
  correo: string | null;
  origenes: string[];
  anuncios: string[];
  etiquetas: string[];
}

export interface ListaContactos {
  total: number;
  limite: number;
  desplazamiento: number;
  filas: ContactoFila[];
}

export interface ResumenContactos {
  total: number;
  conCorreo: number;
  porOrigen: Array<{ origen: string; contactos: number }>;
  porAnuncio: Array<{ anuncio: string; formulario: string; contactos: number }>;
}

export interface FiltroContactos {
  busqueda: string;
  origen: string;
  anuncio: string;
}

export interface FilaExportada {
  nombre: string;
  telefono: string;
  telefonos: string[];
  correo: string | null;
  origenes: string[];
  anuncios: string[];
}

/** "google-lote:importado-el-9-10" -> "Google · importado el 9 10"; 'meta' -> 'Meta'. */
export function etiquetaOrigen(origen: string): string {
  if (origen.startsWith('google-lote:')) return `Google · ${origen.slice('google-lote:'.length).replace(/-/g, ' ')}`;
  if (origen === 'google-lote') return 'Google (todos los lotes)';
  return origen === '' ? 'Todos los orígenes' : origen.charAt(0).toUpperCase() + origen.slice(1);
}

/** Celda CSV segura: comillas dobles escapadas y sin ejecucion de formulas al abrir en una hoja de calculo (prefijo apostrofo). */
function celdaCsv(valor: string, telefono = false): string {
  const seguro = !telefono && /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[",\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** CSV de la seleccion exportada, con BOM para que Excel lea los acentos. Todos los telefonos van en una celda separados por ' ; '. */
export function aCsv(filas: FilaExportada[]): string {
  const cab = ['nombre', 'telefono', 'otros_telefonos', 'correo', 'origenes', 'anuncios'];
  const lineas = filas.map((f) =>
    [f.nombre, f.telefono, f.telefonos.filter((t) => t !== f.telefono).join(' ; '), f.correo ?? '', f.origenes.join(' ; '), f.anuncios.join(' ; ')].map((v, i) => celdaCsv(v, i === 1 || i === 2)).join(','),
  );
  return `${String.fromCharCode(0xfeff)}${[cab.join(','), ...lineas].join('\r\n')}\r\n`;
}

/** Normaliza el parametro de pagina (empieza en 1) a un desplazamiento. */
export function desplazamientoDePagina(pagina: string | undefined, limite: number): number {
  const n = Number(pagina);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? (n - 1) * limite : 0;
}
