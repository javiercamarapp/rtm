// El parametro `next` (login y callback del enlace magico) solo puede nombrar una ruta PROPIA de la app:
// la raiz o una de las secciones, tal cual o seguida de `/...`, `?...` o `#...`. Se rechazan segmentos `..`/`.`
// (tambien codificados), barras invertidas, caracteres de control, `//` y rutas absurdamente largas.

const PROPIA = /^\/(?:(?:pedidos|paquetes|cuentas-por-cobrar|avisos|catalogo|clientes|inventario|proveedores|socios|omar|mi-bodega|contabilidad|movimientos|apertura|reportes|costos|diseno)(?:[/?#]|$)|(?:[?#]|$))/;
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

export function destinoSeguro(valor: string | null | undefined): string {
  return rutaPropiaSegura(valor) ? valor : DESTINO_POR_OMISION;
}
