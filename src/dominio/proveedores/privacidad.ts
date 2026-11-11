// Guardas de privacidad del modulo: ningun importe se persiste y la direccion de la fuente no aparece en ningun texto.
// Son defensa en profundidad: el parser ya construye objetos con lista blanca; esto lo comprueba antes de guardar y en las pruebas.

import { ErrorProveedor } from './errores';

const CLAVE_PROHIBIDA = /^(price|prices|compare_at_price|compare|precio|precios|importe|importes|monto|montos|costo|costos|amount|subtotal|total_cent|body_html|description|descripcion|marketing|banner|texto_promocional)$/i;
const CLAVE_CON_SUFIJO_CENTAVOS = /_cent$/i;
const TEXTO_CON_DINERO = /\$\s*\d|\bMXN\b|\bUSD\b/;

/** Rutas de claves o valores de texto que parecen un importe. Lista vacia = limpio. */
export function hallarImportes(valor: unknown, ruta = ''): string[] {
  const hallazgos: string[] = [];
  if (typeof valor === 'string') {
    if (TEXTO_CON_DINERO.test(valor)) hallazgos.push(`${ruta || '(raiz)'} (texto con importe)`);
    return hallazgos;
  }
  if (typeof valor === 'bigint') return [`${ruta || '(raiz)'} (bigint)`];
  if (Array.isArray(valor)) {
    valor.forEach((x, i) => hallazgos.push(...hallarImportes(x, `${ruta}[${i}]`)));
    return hallazgos;
  }
  if (typeof valor === 'object' && valor !== null) {
    for (const [k, v] of Object.entries(valor)) {
      const r = ruta === '' ? k : `${ruta}.${k}`;
      if (CLAVE_PROHIBIDA.test(k) || CLAVE_CON_SUFIJO_CENTAVOS.test(k)) hallazgos.push(r);
      hallazgos.push(...hallarImportes(v, r));
    }
  }
  return hallazgos;
}

/** Se llama antes de persistir cualquier estado, evento o aviso. */
export function exigirSinImportes(valor: unknown): void {
  const h = hallarImportes(valor);
  if (h.length > 0) throw new ErrorProveedor('importe_en_estado', `se intento persistir un importe en: ${h.slice(0, 3).join(', ')}`);
}

const PARECE_DIRECCION = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|mx|net|org|io|shop|store|app|co)\b/i;

/** Verdadero si el texto contiene algo con forma de direccion web o el origen privado configurado. */
export function contieneDireccion(texto: string, origen?: string): boolean {
  if (PARECE_DIRECCION.test(texto)) return true;
  const o = origen?.trim().toLowerCase();
  if (!o) return false;
  const anfitrion = o.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return anfitrion !== '' && texto.toLowerCase().includes(anfitrion);
}
