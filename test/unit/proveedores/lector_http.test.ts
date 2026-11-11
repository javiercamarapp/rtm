import { describe, it, expect } from 'vitest';
import { crearLectorHttp, lectorDesdeEntorno } from '@/infra/proveedores/lector_http';
import { ErrorProveedor } from '@/dominio/proveedores/errores';
import { PAUSA_ENTRE_PETICIONES_MS } from '@/dominio/proveedores/politica';
import { ORIGEN_SECRETO } from './ayudas';

interface Llamada {
  url: string;
  init: RequestInit;
}

function falso(respuestas: (Response | Error)[]): { fetchFn: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    const r = respuestas.shift();
    if (!r) throw new Error('sin respuesta');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fetchFn, llamadas };
}

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });

describe('lector HTTP (sin red: fetch simulado)', () => {
  it('pide solo rutas publicas del catalogo, con agente honesto y sin credenciales', async () => {
    const { fetchFn, llamadas } = falso([json({}), new Response('<html></html>', { headers: { 'content-type': 'text/html' } }), json({}), new Response('User-agent: *', { headers: { 'content-type': 'text/plain' } })]);
    const lector = crearLectorHttp({ base: ORIGEN_SECRETO, contacto: 'contacto@example.test', fetchFn, dormir: async () => {}, ahoraMs: () => 0 });
    await lector.leerCatalogo(1);
    await lector.leerInicio();
    await lector.leerColeccion('buen-fin-3x2');
    await lector.leerRobots();
    expect(llamadas.map((l) => new URL(l.url).pathname + new URL(l.url).search)).toEqual(['/products.json?limit=250&page=1', '/', '/collections/buen-fin-3x2/products.json?limit=250', '/robots.txt']);
    for (const l of llamadas) {
      const h = l.init.headers as Record<string, string>;
      expect(h['User-Agent']).toMatch(/^RTM-InventarioProveedores\/1\.0/);
      expect(h['User-Agent']).toContain('contacto: contacto@example.test');
      expect(l.init.credentials).toBe('omit');
      expect(l.init.method).toBe('GET');
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('cookie');
      expect(Object.keys(h).map((k) => k.toLowerCase())).not.toContain('authorization');
    }
  });

  it('respeta la pausa de 3 segundos entre peticiones', async () => {
    const { fetchFn } = falso([json({}), json({}), json({})]);
    let ahora = 1_000;
    const esperas: number[] = [];
    const lector = crearLectorHttp({ base: ORIGEN_SECRETO, fetchFn, dormir: async (ms) => void esperas.push(ms), ahoraMs: () => ahora });
    await lector.leerCatalogo(1); // la primera no espera
    ahora += 500;
    await lector.leerCatalogo(2); // 2.5 s mas
    ahora += 10_000;
    await lector.leerCatalogo(3); // ya paso la pausa
    expect(esperas).toEqual([PAUSA_ENTRE_PETICIONES_MS - 500]);
  });

  it('un error de red se vuelve "sin respuesta" y nunca filtra la direccion', async () => {
    const { fetchFn } = falso([new Error(`getaddrinfo ENOTFOUND ${ORIGEN_SECRETO}`)]);
    const lector = crearLectorHttp({ base: ORIGEN_SECRETO, fetchFn, dormir: async () => {}, ahoraMs: () => 0 });
    const r = await lector.leerCatalogo(1);
    expect(r).toEqual({ estado: 0, tipoContenido: '', cuerpo: '' });
    expect(JSON.stringify(r)).not.toContain('origen-secreto');
  });

  it('devuelve estado, tipo de contenido y cuerpo tal cual (403 incluido: no reintenta)', async () => {
    const { fetchFn, llamadas } = falso([json({ error: 'x' }, 403)]);
    const lector = crearLectorHttp({ base: ORIGEN_SECRETO, fetchFn, dormir: async () => {}, ahoraMs: () => 0 });
    const r = await lector.leerCatalogo(1);
    expect(r.estado).toBe(403);
    expect(r.tipoContenido).toContain('json');
    expect(llamadas).toHaveLength(1);
  });

  it('pagina invalida se corrige a 1; un identificador de coleccion raro se rechaza', async () => {
    const { fetchFn, llamadas } = falso([json({})]);
    const lector = crearLectorHttp({ base: ORIGEN_SECRETO, fetchFn, dormir: async () => {}, ahoraMs: () => 0 });
    await lector.leerCatalogo(-4);
    expect(llamadas[0]!.url).toContain('page=1');
    expect(() => lector.leerColeccion('../admin')).toThrow(ErrorProveedor);
  });

  it('configuracion invalida: error tipado que no revela el valor', () => {
    for (const base of ['no es una direccion', 'ftp://algo.example']) {
      try {
        crearLectorHttp({ base });
        throw new Error('deberia fallar');
      } catch (e) {
        expect(e).toBeInstanceOf(ErrorProveedor);
        expect((e as ErrorProveedor).codigo).toBe('configuracion');
        expect((e as Error).message).not.toContain(base);
      }
    }
  });

  it('la direccion sale solo de la variable de entorno privada', () => {
    expect(() => lectorDesdeEntorno({})).toThrow(ErrorProveedor);
    const { lector, origen } = lectorDesdeEntorno({ INVENTARIO_PROVEEDORES_FUENTE: ORIGEN_SECRETO, INVENTARIO_PROVEEDORES_CONTACTO: 'contacto@example.test' });
    expect(origen).toBe(ORIGEN_SECRETO);
    expect(typeof lector.leerCatalogo).toBe('function');
    const sin = lectorDesdeEntorno({ INVENTARIO_PROVEEDORES_FUENTE: ORIGEN_SECRETO });
    expect(sin.origen).toBe(ORIGEN_SECRETO);
  });
});
