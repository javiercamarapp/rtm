// Anonimizacion de EJEMPLOS propios (solo de operaciones que no se deshicieron en 10 minutos). El ejemplo conserva la ESTRUCTURA y la jerga, nunca nombres, cifras ni contactos:
//   * toda coincidencia con un nombre del catalogo (clientes, modelos, sabores, alias) pasa a una etiqueta (CLIENTE, MODELO, SABOR);
//   * todo digito se elimina (cantidades, montos, folios, telefonos);
//   * toda palabra que no sea de un vocabulario cerrado (conectores, verbos del negocio y la jerga del diccionario) se sustituye por "_".
// Asi un nombre propio que el catalogo no conozca tampoco se filtra. La base vuelve a rechazar cualquier ejemplo con digitos, arrobas o enlaces.
import { normalizar } from '../catalogo/normalizar';

export interface EntidadesEjemplo {
  clientes: readonly string[];
  modelos: readonly string[];
  sabores: readonly string[];
}

const PALABRAS_SEGURAS: ReadonlySet<string> = new Set([
  'a', 'al', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'en', 'por', 'para', 'con', 'sin', 'y', 'o', 'que', 'me', 'te', 'le', 'se', 'lo', 'ya', 'hoy', 'ayer', 'manana',
  'pedido', 'pedidos', 'pedir', 'pidio', 'piezas', 'pieza', 'pz', 'pzs', 'pago', 'pagos', 'pagó', 'pago', 'pagar', 'cobro', 'cobrar', 'cayo', 'deposito', 'deposite', 'depositaron', 'transferencia', 'transfer', 'efectivo', 'efvo',
  'credito', 'contado', 'fiado', 'plazo', 'dias', 'dia', 'semana', 'semanas', 'viernes', 'lunes', 'martes', 'miercoles', 'jueves', 'sabado', 'domingo', 'envio', 'gasto', 'guia', 'compra', 'apuntale', 'pasale', 'mandale',
  'registra', 'registrar', 'cuenta', 'debe', 'saldo', 'dame', 'dime', 'cuanto', 'cuantas', 'cuantos', 'sabor', 'modelo', 'marca', 'cliente', 'proveedor', 'nuevo', 'nueva', 'alta', 'es', 'son', 'lana', 'luz',
]);

const ETIQUETAS: Array<[keyof EntidadesEjemplo, string]> = [['clientes', 'CLIENTE'], ['modelos', 'MODELO'], ['sabores', 'SABOR']];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `jerga`: terminos normalizados del diccionario (se conservan). Devuelve null si el resultado no aporta estructura (casi todo "_") o sigue trayendo algo que parezca un dato real.
 */
export function anonimizarEjemplo(texto: string, ent: EntidadesEjemplo, jerga: readonly string[] = []): string | null {
  let t = ` ${normalizar(texto)} `;
  const seguras = new Set<string>([...PALABRAS_SEGURAS, ...jerga.flatMap((j) => normalizar(j).split(' '))]);
  for (const [clave, etiqueta] of ETIQUETAS) {
    const nombres = [...ent[clave]].map((n) => normalizar(n)).filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
    for (const n of nombres) t = t.replace(new RegExp(` ${esc(n)} `, 'g'), ` ${etiqueta} `);
    // Tambien por palabra suelta (un nombre de pila, un sabor sin su modelo): cualquier token que forme parte de un nombre conocido.
    const tokens = new Set(nombres.flatMap((n) => n.split(' ')).filter((w) => w.length >= 3 && !seguras.has(w)));
    t = t.split(' ').map((w) => (tokens.has(w) ? etiqueta : w)).join(' ');
  }
  const palabras = t.split(' ').filter(Boolean).map((w) => {
    if (/^(CLIENTE|MODELO|SABOR)$/.test(w)) return w;
    if (/\d/.test(w)) return '';
    return seguras.has(w) ? w : '_';
  }).filter((w) => w !== '');
  // Colapsa corridas de "_" y etiquetas repetidas.
  const colapsado: string[] = [];
  for (const w of palabras) if (colapsado[colapsado.length - 1] !== w || (w !== '_' && !/^(CLIENTE|MODELO|SABOR)$/.test(w))) colapsado.push(w);
  const util = colapsado.filter((w) => w !== '_').length;
  const salida = colapsado.join(' ').trim();
  if (util < 2 || salida.length < 5 || salida.length > 200 || /[0-9@]/.test(salida)) return null;
  return salida;
}
