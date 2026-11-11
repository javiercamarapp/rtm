// Lector HTTP del inventario de proveedores. La direccion de la fuente vive SOLO en la variable de entorno privada
// INVENTARIO_PROVEEDORES_FUENTE: no se escribe en codigo, textos, registros ni mensajes de error.
//
// Reglas de cortesia (informe 05 y adenda 24): agente de usuario honesto, sin inicio de sesion, sin cookies, sin carrito, sin rotar IP,
// pausa minima entre peticiones y parada ante 403, 429 o captcha (eso lo decide el caso de uso con la respuesta; aqui nunca se reintenta).
// Solo se piden las rutas publicas del catalogo: productos en JSON, inicio en HTML y colecciones en JSON.

import type { PuertoLecturaProveedor } from '@/aplicacion/proveedores/puertos';
import type { RespuestaCruda } from '@/dominio/proveedores/catalogo_json';
import { ErrorProveedor } from '@/dominio/proveedores/errores';
import { agenteUsuario } from '@/dominio/proveedores/fuente';
import { PAUSA_ENTRE_PETICIONES_MS } from '@/dominio/proveedores/politica';
import { TAMANO_PAGINA } from '@/dominio/proveedores/catalogo_json';

export interface OpcionesLectorHttp {
  /** Direccion base de la fuente (viene del entorno privado). */
  base: string;
  /** Correo o telefono de contacto del negocio (entorno privado) para el agente de usuario. */
  contacto?: string;
  fetchFn?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  ahoraMs?: () => number;
  tiempoMaximoMs?: number;
}

const HANDLE = /^[a-z0-9][a-z0-9-]*$/;

function dormirReal(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function crearLectorHttp(op: OpcionesLectorHttp): PuertoLecturaProveedor {
  let base: URL;
  try {
    base = new URL(op.base);
  } catch {
    throw new ErrorProveedor('configuracion', 'la direccion de la fuente configurada no es valida');
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new ErrorProveedor('configuracion', 'la direccion de la fuente configurada no es valida');
  const fetchFn = op.fetchFn ?? fetch;
  const dormir = op.dormir ?? dormirReal;
  const ahoraMs = op.ahoraMs ?? ((): number => Date.now());
  const ua = agenteUsuario(op.contacto);
  let ultima: number | null = null;

  async function pedir(ruta: string, aceptar: string): Promise<RespuestaCruda> {
    if (ultima !== null) {
      const espera = PAUSA_ENTRE_PETICIONES_MS - (ahoraMs() - ultima);
      if (espera > 0) await dormir(espera);
    }
    ultima = ahoraMs();
    try {
      const r = await fetchFn(new URL(ruta, base).toString(), {
        method: 'GET',
        headers: { 'User-Agent': ua, Accept: aceptar },
        credentials: 'omit',
        redirect: 'follow',
        signal: AbortSignal.timeout(op.tiempoMaximoMs ?? 20_000),
      });
      return { estado: r.status, tipoContenido: r.headers.get('content-type') ?? '', cuerpo: await r.text() };
    } catch {
      // El mensaje de una falla de red puede contener la direccion: se descarta y solo queda "sin respuesta".
      return { estado: 0, tipoContenido: '', cuerpo: '' };
    }
  }

  return {
    leerCatalogo: (pagina) => pedir(`/products.json?limit=${TAMANO_PAGINA}&page=${Math.max(1, Math.trunc(pagina))}`, 'application/json'),
    leerInicio: () => pedir('/', 'text/html'),
    leerColeccion: (handle) => {
      if (!HANDLE.test(handle)) throw new ErrorProveedor('configuracion', 'identificador de coleccion invalido');
      return pedir(`/collections/${handle}/products.json?limit=${TAMANO_PAGINA}`, 'application/json');
    },
    leerRobots: () => pedir('/robots.txt', 'text/plain'),
  };
}

/** Construye el lector con la configuracion privada del servidor. Falla sin revelar el valor. */
export function lectorDesdeEntorno(entorno: Record<string, string | undefined> = process.env): { lector: PuertoLecturaProveedor; origen: string } {
  const origen = entorno['INVENTARIO_PROVEEDORES_FUENTE'];
  if (!origen) throw new ErrorProveedor('configuracion', 'falta la variable privada INVENTARIO_PROVEEDORES_FUENTE');
  const contacto = entorno['INVENTARIO_PROVEEDORES_CONTACTO'];
  return { lector: crearLectorHttp({ base: origen, ...(contacto ? { contacto } : {}) }), origen };
}
