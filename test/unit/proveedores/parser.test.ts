import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { clasificarRespuesta, parsearCatalogo, unirPaginas } from '@/dominio/proveedores/catalogo_json';
import { handlesDeColeccion, parsearPromociones } from '@/dominio/proveedores/promociones_html';
import { COMPARACION_CENTINELA, PRECIO_CENTINELA, catalogoJson, modeloConSabores, respuestaHtml, respuestaJson } from './ayudas';

describe('parser del catalogo de datos', () => {
  it('lee modelos y sabores con su disponibilidad', () => {
    const r = parsearCatalogo(catalogoJson([modeloConSabores(1, 'Waka Steel 60,000', 3, 2)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lectura.productos).toHaveLength(1);
    expect(r.lectura.productos[0]!.variantes.map((v) => v.disponible)).toEqual([true, true, false]);
    expect(r.lectura.productos[0]!.handle).toBe('modelo-1');
  });

  it('descarta precios, precios de comparacion y texto de mercadotecnia: no sobreviven en ningun campo', () => {
    const r = parsearCatalogo(catalogoJson([modeloConSabores(1, 'Waka Steel 60,000', 2, 2)]));
    expect(r.ok).toBe(true);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(String(PRECIO_CENTINELA));
    expect(texto).not.toContain(String(COMPARACION_CENTINELA));
    expect(texto).not.toMatch(/price|compare|mercadotecnia|\$999/i);
  });

  it('conserva identificadores gigantes como texto', () => {
    const r = parsearCatalogo({ products: [{ id: '9007199254740993123', title: 'Modelo', variants: [{ id: '9007199254740993456', available: true, option1: 'Uva' }] }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lectura.productos[0]!.id).toBe('9007199254740993123');
  });

  it('usa el titulo de la variante cuando no hay opcion de sabor', () => {
    const r = parsearCatalogo({ products: [{ id: 1, title: 'M', variants: [{ id: 2, available: false, option1: null, title: 'Mango' }] }] });
    expect(r.ok && r.lectura.productos[0]!.variantes[0]!.sabor).toBe('Mango');
  });

  it('rechaza un catalogo vacio', () => {
    expect(parsearCatalogo({ products: [] })).toMatchObject({ ok: false, motivo: 'catalogo_vacio' });
  });

  it.each([
    ['sin lista products', { items: [] }],
    ['raiz que no es objeto', [1, 2]],
    ['producto sin id', { products: [{ title: 'M', variants: [] }] }],
    ['producto sin titulo', { products: [{ id: 1, variants: [] }] }],
    ['producto sin variantes', { products: [{ id: 1, title: 'M' }] }],
    ['variante sin available booleano', { products: [{ id: 1, title: 'M', variants: [{ id: 2, available: 'si', option1: 'x' }] }] }],
    ['variante sin id', { products: [{ id: 1, title: 'M', variants: [{ available: true, option1: 'x' }] }] }],
    ['variante sin sabor', { products: [{ id: 1, title: 'M', variants: [{ id: 2, available: true }] }] }],
    ['variante que no es objeto', { products: [{ id: 1, title: 'M', variants: ['x'] }] }],
    ['producto que no es objeto', { products: ['x'] }],
    ['id negativo', { products: [{ id: -1, title: 'M', variants: [] }] }],
  ])('rechaza por formato: %s', (_nombre, crudo) => {
    expect(parsearCatalogo(crudo)).toMatchObject({ ok: false, motivo: 'formato' });
  });

  it('rechaza identificadores duplicados', () => {
    const a = { id: 1, title: 'A', variants: [{ id: 5, available: true, option1: 'x' }] };
    expect(parsearCatalogo({ products: [a, { ...a, variants: [] }] })).toMatchObject({ ok: false, motivo: 'duplicados' });
    expect(parsearCatalogo({ products: [a, { id: 2, title: 'B', variants: [{ id: 5, available: true, option1: 'y' }] }] })).toMatchObject({ ok: false, motivo: 'duplicados' });
  });

  it('une paginas y detecta duplicados entre ellas', () => {
    const p1 = parsearCatalogo(catalogoJson([modeloConSabores(1, 'A', 1, 1)]));
    const p2 = parsearCatalogo(catalogoJson([modeloConSabores(2, 'B', 1, 1)]));
    if (!p1.ok || !p2.ok) throw new Error('fixture');
    const u = unirPaginas([p1.lectura, p2.lectura]);
    expect(u.ok && u.lectura.productos).toHaveLength(2);
    expect(unirPaginas([p1.lectura, p1.lectura])).toMatchObject({ ok: false, motivo: 'duplicados' });
  });

  it('propiedad: nunca devuelve ni un solo precio, sean cuales sean los valores', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9_999_999 }), fc.integer({ min: 1, max: 9_999_999 }), fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (precio, comparacion, disp) => {
        const crudo = {
          products: [
            {
              id: 1,
              title: 'M',
              variants: disp.map((d, i) => ({ id: i + 1, available: d, option1: `S${i}`, price: `${precio}.37`, compare_at_price: `${comparacion}.91` })),
            },
          ],
        };
        const r = parsearCatalogo(crudo);
        expect(r.ok).toBe(true);
        const s = JSON.stringify(r);
        expect(s).not.toContain(`${precio}.37`);
        expect(s).not.toContain(`${comparacion}.91`);
        expect(s).not.toMatch(/price|compare/);
      }),
    );
  });
});

describe('clasificacion de la respuesta cruda', () => {
  const json = respuestaJson({ products: [] });
  it('200 con JSON valido', () => {
    expect(clasificarRespuesta(json)).toEqual({ tipo: 'json', valor: { products: [] } });
  });
  it('403 y 429 bloquean y no se insiste', () => {
    expect(clasificarRespuesta({ ...json, estado: 403 })).toEqual({ tipo: 'bloqueada', motivo: '403' });
    expect(clasificarRespuesta({ ...json, estado: 429 })).toEqual({ tipo: 'bloqueada', motivo: '429' });
  });
  it('captcha en el cuerpo bloquea aunque el estado sea 200', () => {
    expect(clasificarRespuesta(respuestaHtml('<html>Just a moment... captcha</html>'))).toEqual({ tipo: 'bloqueada', motivo: 'captcha' });
  });
  it('pagina de verificacion de edad bloquea', () => {
    expect(clasificarRespuesta(respuestaHtml('<h1>Verificación de edad</h1>'))).toEqual({ tipo: 'bloqueada', motivo: 'pagina_de_edad' });
  });
  it('HTML ordinario donde se esperaba JSON es no_json', () => {
    expect(clasificarRespuesta(respuestaHtml('<html>hola</html>'))).toEqual({ tipo: 'no_json' });
  });
  it('JSON truncado es no_json', () => {
    expect(clasificarRespuesta({ estado: 200, tipoContenido: 'application/json', cuerpo: '{"products":[{"id":' })).toEqual({ tipo: 'no_json' });
  });
  it('errores del servidor y de red', () => {
    expect(clasificarRespuesta({ ...json, estado: 500 })).toEqual({ tipo: 'error', motivo: 'http' });
    expect(clasificarRespuesta({ ...json, estado: 301 })).toEqual({ tipo: 'error', motivo: 'http' });
    expect(clasificarRespuesta({ estado: 0, tipoContenido: '', cuerpo: '' })).toEqual({ tipo: 'error', motivo: 'red' });
  });
});

const TARJETA = (handle: string, titulo: string, insignia = ''): string =>
  `<li class="grid__item product-card"><a href="/products/${handle}">${titulo}</a>${insignia ? `<span class="badge">${insignia}</span><small>Se aplica al agregar al carrito</small>` : ''}</li>`;

describe('parser de senales de promocion (HTML sintetico)', () => {
  it('lee la insignia de porcentaje junto al enlace del producto', () => {
    const html = `<ul>${TARJETA('elf-bar-te6000', 'Elf Bar TE6000', '15 % de descuento')}${TARJETA('orion-bar', 'Orion Bar', '15% de descuento')}${TARJETA('fifty-bar', 'Fifty Bar')}</ul>`;
    const s = parsearPromociones(html);
    expect(s.tarjetas).toBe(3);
    expect(s.descuentos).toEqual([
      { handle: 'elf-bar-te6000', pct: 15 },
      { handle: 'orion-bar', pct: 15 },
    ]);
  });

  it('ignora el menu que repite el porcentaje y los porcentajes fuera de rango', () => {
    const html = `<nav><a href="/collections/todo">Modelos con 15 % de descuento</a></nav>${TARJETA('a', 'A', '100 % de descuento')}${TARJETA('b', 'B', '0 % de descuento')}`;
    const s = parsearPromociones(html);
    expect(s.descuentos).toEqual([]);
    expect(s.tarjetas).toBe(2);
  });

  it('una tarjeta sin enlace de producto no cuenta', () => {
    expect(parsearPromociones('<li class="product-card"><span>vacia</span></li>').tarjetas).toBe(0);
  });

  it('lee la campana con su cuenta regresiva y detecta la mecanica 3x2', () => {
    const html = `<section data-countdown-start="2026-11-13T00:00:00-06:00" data-countdown-end="2026-11-17T23:59:00-06:00"><a href="/collections/buen-fin-3x2">Buen Fin 3x2</a></section>`;
    const s = parsearPromociones(html);
    expect(s.campanas).toEqual([{ coleccion: 'buen-fin-3x2', mecanica: 'multicompra', inicio: '2026-11-13T06:00:00.000Z', fin: '2026-11-18T05:59:00.000Z' }]);
  });

  it('una coleccion con nombre de oferta cuenta aunque no tenga fechas; una coleccion comun no', () => {
    const s = parsearPromociones('<a href="/collections/ofertas-de-temporada">x</a><a href="/collections/lo-mas-nuevo">y</a><a href="/collections/final-feliz">z</a>');
    expect(s.campanas.map((c) => c.coleccion)).toEqual(['ofertas-de-temporada']);
    expect(s.campanas[0]).toMatchObject({ mecanica: 'campana', inicio: null, fin: null });
  });

  it('fechas ilegibles quedan nulas', () => {
    const s = parsearPromociones('<div data-countdown-start="manana" data-countdown-end="2026-11-17 23:59"><a href="/collections/ofertas">x</a></div>');
    expect(s.campanas[0]).toMatchObject({ inicio: null, fin: null });
  });

  it('el mismo enlace repetido no duplica la campana', () => {
    const s = parsearPromociones('<a href="/collections/ofertas">x</a><a href="/collections/ofertas">y</a>');
    expect(s.campanas).toHaveLength(1);
  });

  it('no extrae ningun importe ni texto de mercadotecnia', () => {
    const s = parsearPromociones(`${TARJETA('a', 'A', '15 % de descuento')}<p>Antes $1,999 ahora $999 MXN</p>`);
    expect(JSON.stringify(s)).not.toMatch(/\$|MXN|Antes|ahora/);
  });
});

describe('coleccion de campana', () => {
  it('devuelve los handles de los productos', () => {
    expect(handlesDeColeccion({ products: [{ handle: 'Fifty-Bar' }, { handle: 'snowwolf' }] })).toEqual(['fifty-bar', 'snowwolf']);
  });
  it.each([[null], [[]], [{}], [{ products: [null] }], [{ products: [{ id: 1 }] }]])('formato invalido: %j', (crudo) => {
    expect(handlesDeColeccion(crudo)).toBeNull();
  });
});
