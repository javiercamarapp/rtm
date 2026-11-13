// El parametro `next` (login y callback del enlace magico) solo puede nombrar una ruta PROPIA de la app:
// la raiz o una de las secciones, tal cual o seguida de `/...`, `?...` o `#...`. Se rechazan segmentos `..`/`.`
// (tambien codificados), barras invertidas, caracteres de control, `//` y rutas absurdamente largas.

// Secciones propias (agregar aqui las nuevas, p. ej. pago-renta, sin quitar las demas).
const PROPIA = /^\/(?:(?:pedidos|paquetes|cuentas-por-cobrar|avisos|catalogo|clientes|inventario|proveedores|socios|omar|pago-renta|mi-bodega|bodega|cuentas|devoluciones|contabilidad|movimientos|apertura|reportes|costos|diseno|dropshipping|menudeo)(?:[/?#]|$)|(?:[?#]|$))/;
// eslint-disable-next-line no-control-regex -- detectar caracteres de control es justo el proposito
const CONTROL = /[\u0000-\u001f\u007f\\]/;

export function rutaPropiaSegura(valor: string | null | undefined): valor is string {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 2048) return false;
  if (!PROPIA.test(valor)) return false;
  if (CONTROL.test(valor)) return false;
  let decodificado = valor;
  for (let i = 0; i < 3; i++) {
    try {
      const siguiente = decodeURIComponent(decodificado);
      if (siguiente === decodificado) break;
      decodificado = siguiente;
    } catch {
      return false;
    }
  }
  if (CONTROL.test(decodificado)) return false;
  const ruta = decodificado.split(/[?#]/)[0]!;
  if (ruta.split('/').some((segmento) => segmento === '..' || segmento === '.')) return false;
  if (ruta.includes('//')) return false;
  return true;
}

export const DESTINO_POR_OMISION = '/';
/** Unica pantalla de la cuenta con rol omar. */
export const DESTINO_OMAR = '/mi-bodega';
/** Unica zona de la cuenta con rol bodega. */
export const DESTINO_BODEGA = '/bodega';

export function destinoSeguro(valor: string | null | undefined): string {
  return rutaPropiaSegura(valor) ? valor : DESTINO_POR_OMISION;
}

/**
 * Zona propia de un rol restringido: una cuenta ACTIVA de Omar o de bodega solo recorre su carpeta. Cualquier otra ruta de pagina (las del socio) se redirige a su inicio
 * ANTES de renderizar (307 real, no un 200 que se redirige despues en el navegador). Devuelve el destino o null si la ruta es suya, publica o de API.
 */
export function redireccionPorRol(rol: string | null | undefined, activo: boolean, ruta: string): string | null {
  if (!activo || (rol !== 'omar' && rol !== 'bodega')) return null;
  const propia = rol === 'omar' ? DESTINO_OMAR : DESTINO_BODEGA;
  if (ruta === propia || ruta.startsWith(`${propia}/`)) return null;
  if (/^\/(?:login|auth|api|terminos|privacidad)(?:\/|$)/.test(ruta)) return null;
  return propia;
}
