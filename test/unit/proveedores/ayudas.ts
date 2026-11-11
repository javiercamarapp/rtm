// Ayudas de prueba del inventario de proveedores. Todo es sintetico: ningun dato real, ninguna direccion real, ninguna peticion de red.
import type { PuertoAvisos, PuertoContextoNegocio, PuertoLecturaProveedor } from '@/aplicacion/proveedores/puertos';
import type { DepsCiclo } from '@/aplicacion/proveedores/ciclo';
import type { RespuestaCruda } from '@/dominio/proveedores/catalogo_json';
import { SOCIOS_NINGUNO } from '@/dominio/proveedores/detector';
import type { ContextoDeteccion, ContextoSocios } from '@/dominio/proveedores/detector';
import { contextoVacio } from '@/dominio/proveedores/normalizador';
import type { ContextoNormalizacion } from '@/dominio/proveedores/normalizador';
import { AvisosMemoria, RepositorioMemoria } from '@/infra/proveedores/memoria';

/** Direccion inventada con la que se comprueba que jamas aparece en ninguna salida. */
export const ORIGEN_SECRETO = 'https://origen-secreto-de-prueba.invalid';
/** Precios y precios de comparacion sinteticos: nunca deben aparecer en nada que se persista. */
export const PRECIO_CENTINELA = 7312.45;
export const COMPARACION_CENTINELA = 9988.77;

export interface SaborSpec {
  id: number;
  nombre: string;
  disponible: boolean;
}
export interface ModeloSpec {
  id: number;
  titulo: string;
  handle?: string;
  sabores: SaborSpec[];
}

export function catalogoJson(modelos: ModeloSpec[]): Record<string, unknown> {
  return {
    products: modelos.map((m) => ({
      id: m.id,
      title: m.titulo,
      handle: m.handle ?? `modelo-${m.id}`,
      vendor: 'Proveedor de prueba',
      product_type: 'Electronic Cigarettes',
      tags: ['promo sintetica'],
      body_html: '<p>Texto de mercadotecnia sintetico $999 MXN</p>',
      options: [{ name: 'Sabor' }],
      images: [],
      variants: m.sabores.map((s) => ({
        id: s.id,
        title: s.nombre,
        option1: s.nombre,
        sku: `SKU-${s.id}`,
        available: s.disponible,
        price: String(PRECIO_CENTINELA),
        compare_at_price: String(COMPARACION_CENTINELA),
      })),
    })),
  };
}

export function respuestaJson(valor: unknown, estado = 200): RespuestaCruda {
  return { estado, tipoContenido: 'application/json; charset=utf-8', cuerpo: JSON.stringify(valor) };
}
export function respuestaHtml(html: string, estado = 200): RespuestaCruda {
  return { estado, tipoContenido: 'text/html; charset=utf-8', cuerpo: html };
}

/** Modelo con `n` sabores de los cuales `disp` estan disponibles; ids estables a partir de `base`. */
export function modeloConSabores(id: number, titulo: string, n: number, disp: number, base = id * 1000): ModeloSpec {
  return {
    id,
    titulo,
    sabores: Array.from({ length: n }, (_, i) => ({ id: base + i + 1, nombre: `Sabor ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`, disponible: i < disp })),
  };
}

export function copiaConDisponibilidad(modelos: ModeloSpec[], cambios: Record<number, boolean>): ModeloSpec[] {
  return modelos.map((m) => ({ ...m, sabores: m.sabores.map((s) => (s.id in cambios ? { ...s, disponible: cambios[s.id]! } : s)) }));
}

// ---------------------------------------------------------------- reloj

export const T0 = Date.parse('2026-11-10T12:00:00.000Z'); // 06:00 en Merida
export const MIN = 60_000;
export const HORA = 3_600_000;
export function en(ms: number): string {
  return new Date(T0 + ms).toISOString();
}

// ---------------------------------------------------------------- contexto

export function ctxDeteccion(normalizacion: ContextoNormalizacion = contextoVacio(), socios: ContextoSocios = SOCIOS_NINGUNO): ContextoDeteccion {
  return { normalizacion, socios };
}
export const SOCIOS_TODOS: ContextoSocios = { modeloActivo: () => true, saborDeSocios: () => true };

// ---------------------------------------------------------------- lector simulado

export class LectorSimulado implements PuertoLecturaProveedor {
  catalogo: RespuestaCruda[] = [];
  inicio: RespuestaCruda | null = null;
  colecciones: Record<string, RespuestaCruda> = {};
  robots: RespuestaCruda = { estado: 200, tipoContenido: 'text/plain', cuerpo: 'User-agent: *\nDisallow: /admin\nDisallow: /cart/\n' };
  falloRed = false;
  peticiones = { catalogo: 0, inicio: 0, coleccion: 0, robots: 0 };
  paginasPedidas: number[] = [];

  /** Responde siempre lo mismo hasta que se cambie. */
  poner(modelos: ModeloSpec[]): void {
    this.catalogo = [respuestaJson(catalogoJson(modelos))];
  }

  async leerCatalogo(pagina: number): Promise<RespuestaCruda> {
    this.peticiones.catalogo++;
    this.paginasPedidas.push(pagina);
    if (this.falloRed) throw new Error(`fallo de red hacia ${ORIGEN_SECRETO}`);
    const r = this.catalogo[pagina - 1] ?? this.catalogo[this.catalogo.length - 1];
    if (!r) throw new Error('sin respuesta simulada');
    return r;
  }
  async leerInicio(): Promise<RespuestaCruda> {
    this.peticiones.inicio++;
    if (this.falloRed) throw new Error('red');
    if (!this.inicio) throw new Error('sin inicio simulado');
    return this.inicio;
  }
  async leerColeccion(handle: string): Promise<RespuestaCruda> {
    this.peticiones.coleccion++;
    const r = this.colecciones[handle];
    if (!r) throw new Error('sin coleccion simulada');
    return r;
  }
  async leerRobots(): Promise<RespuestaCruda> {
    this.peticiones.robots++;
    return this.robots;
  }
}

export function entorno(modelos: ModeloSpec[], opciones: { contexto?: Partial<PuertoContextoNegocio>; promociones?: boolean } = {}): { deps: DepsCiclo; lector: LectorSimulado; repo: RepositorioMemoria; avisos: AvisosMemoria; reloj: { ms: number }; avanzar(ms: number): void } {
  const lector = new LectorSimulado();
  lector.poner(modelos);
  const repo = new RepositorioMemoria();
  const avisos = new AvisosMemoria();
  const reloj = { ms: T0 };
  const contexto: PuertoContextoNegocio = {
    normalizacion: opciones.contexto?.normalizacion ?? (async () => contextoVacio()),
    socios: opciones.contexto?.socios ?? (async () => SOCIOS_NINGUNO),
  };
  const avisosPuerto: PuertoAvisos = avisos;
  const deps: DepsCiclo = { lector, repo, contexto, avisos: avisosPuerto, reloj: () => new Date(reloj.ms), promocionesActivas: opciones.promociones ?? true };
  return { deps, lector, repo, avisos, reloj, avanzar: (ms) => (reloj.ms += ms) };
}

/** Todos los textos y claves que el modulo pudo producir: sirve para buscar fugas de direccion, precios o texto de mercadotecnia. */
export function volcadoCompleto(repo: RepositorioMemoria, avisos: AvisosMemoria): string {
  return JSON.stringify({ estado: repo.estado, eventos: [...repo.eventos.values()], avisos: avisos.emitidos, fotos: [...repo.fotos.entries()] });
}
