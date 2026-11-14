import { describe, expect, it } from 'vitest';
import catalogo from '../fixtures/sabores_catalogo.json';
import { candidatosDuplicado, compararNombres, decisionAlta, distanciaEdicion, prefijoDePalabras, textoPregunta } from '@/dominio/catalogo/duplicados';

const cmp = (a: string, b: string) => compararNombres('sabor', a, b);

describe('distancia de edicion propia', () => {
  it('casos conocidos', () => {
    expect(distanciaEdicion('', 'abc')).toBe(3);
    expect(distanciaEdicion('kitten', 'sitting')).toBe(3);
    expect(distanciaEdicion('spash', 'splash')).toBe(1);
    expect(distanciaEdicion('igual', 'igual')).toBe(0);
  });
});

describe('pares aprobados por el dueno: IGUAL_NORMALIZADO', () => {
  it.each([
    ['Kiwi Dragonfruit', 'Kiwi Dragon Fruit'],
    ['Passionfruit', 'Passion Fruit'],
    ['Piña Colada', 'pina  colada'],
    ['Kiwi Dragón', 'kiwi-dragon'],
    ['Mixed Berries', 'Mixed Berry'],
    ['COOL MINT', 'cool mint'],
  ])('%s = %s', (a, b) => {
    const r = cmp(a, b);
    expect(r.clase).toBe('IGUAL_NORMALIZADO');
    expect(r.puntaje).toBe(100);
    expect(r.ambiguo).toBe(false);
  });
});

describe('pares parecidos por prefijo: se PREGUNTAN, nunca IGUAL', () => {
  it.each([
    ['Black Blue Razz', 'Black Blue'],
    ['Blackberry', 'Black Berry Ice'],
    ['Blueberry Raspberry', 'Blueberry Raspberry Ice'],
    ['Cherry Watermelon', 'Cherry Watermelon Ice'],
    ['Lychee', 'Lychee Ice'],
    ['Lychee', 'Lychee Burst'],
    ['Peach Blue', 'Peach Blueberry'],
    ['Peach Blue Raspberry', 'Peach Blue'],
    ['Peach Blue Razz', 'Peach Blue'],
    ['Peach Mango Watermelon', 'Peach Mango'],
    ['Sour Watermelon', 'Sour Watermelon Peach'],
  ])('%s ~ %s', (a, b) => {
    const r = cmp(a, b);
    expect(r.clase).toBe('POSIBLE');
    expect(r.puntaje).toBeLessThan(80);
    expect(r.puntaje).toBeGreaterThanOrEqual(50);
    expect(cmp(b, a)).toEqual(r);
  });

  it('Grape Strawberry / Grape Straw: abreviatura conocida, MUY_PROBABLE (se pregunta)', () => {
    const r = cmp('Grape Strawberry', 'Grape Straw');
    expect(r.clase).toBe('MUY_PROBABLE');
    expect(r.motivo).toContain('straw = strawberry');
  });
});

describe('equivalencias ambiguas: nunca se asumen', () => {
  it('razz = raspberry solo llega a POSIBLE y se marca ambiguo', () => {
    const r = cmp('Peach Blue Razz', 'Peach Blue Raspberry');
    expect(r.clase).toBe('POSIBLE');
    expect(r.ambiguo).toBe(true);
    expect(r.motivo).toContain('NO es segura');
  });
  it('icy / ice ambiguo', () => {
    const r = cmp('Icy Peach', 'Peach Ice');
    expect(r.ambiguo).toBe(true);
    expect(r.clase).toBe('POSIBLE');
  });
  it('sigla BP', () => {
    const r = cmp('BP', 'Blue Pop');
    expect(r.clase).toBe('POSIBLE');
    expect(r.ambiguo).toBe(true);
  });
});

describe('errores de dedo y orden', () => {
  it('una letra: MUY_PROBABLE', () => {
    expect(cmp('Blueberry Spash', 'Blueberry Splash').clase).toBe('MUY_PROBABLE');
    expect(cmp('Cereza Nuevo', 'Cereza Nueva').clase).toBe('MUY_PROBABLE');
  });
  it('mismas palabras en otro orden: MUY_PROBABLE', () => {
    const r = cmp('Strawberry Grape', 'Grape Strawberry');
    expect(r.clase).toBe('MUY_PROBABLE');
    expect(r.motivo).toContain('otro orden');
  });
  it('traduccion conocida: MUY_PROBABLE, no IGUAL', () => {
    expect(cmp('Sandia', 'Watermelon').clase).toBe('MUY_PROBABLE');
    expect(cmp('Maracuya', 'Passion Fruit').clase).toBe('MUY_PROBABLE');
  });
});

describe('sabores distintos', () => {
  it.each([
    ['Cool Mint', 'Fresh Mint'],
    ['Peach Ice', 'Watermelon Ice'],
    ['Mint', 'Cool Mint'],
    ['Strawberry Kiwi', 'Watermelon Kiwi'],
    ['Tulum', 'Miami'],
  ])('%s != %s', (a, b) => {
    expect(cmp(a, b).clase).toBe('DISTINTO');
  });
  it('vacios', () => {
    expect(cmp('', 'x').clase).toBe('DISTINTO');
  });
  it('digitos no se tratan como error de dedo', () => {
    expect(cmp('Mint 2', 'Mint 3').clase).toBe('DISTINTO');
  });
});

describe('prefijoDePalabras', () => {
  it('frontera y mitad de palabra', () => {
    expect(prefijoDePalabras(['peach', 'blue'], ['peach', 'blueberry'])).toBe(1);
    expect(prefijoDePalabras(['blackberry'], ['black', 'berry', 'ice'])).toBe(1);
    expect(prefijoDePalabras(['lychee'], ['lychee'])).toBe(-1);
    expect(prefijoDePalabras(['pea'], ['peach', 'ice'])).toBe(-1); // menos de 4 letras
  });
});

describe('catalogo real de 128 sabores', () => {
  const cat = catalogo as { id: number; nombre: string }[];
  it('son 128', () => expect(cat).toHaveLength(128));
  it('ningun par distinto del catalogo sale IGUAL salvo los dos aprobados', () => {
    const iguales: string[] = [];
    for (let i = 0; i < cat.length; i++) {
      for (let j = i + 1; j < cat.length; j++) {
        if (compararNombres('sabor', cat[i]!.nombre, cat[j]!.nombre).clase === 'IGUAL_NORMALIZADO') iguales.push(`${cat[i]!.nombre} | ${cat[j]!.nombre}`);
      }
    }
    expect(iguales.map((x) => x.split(' | ').sort().join(' | ')).sort()).toEqual(['Kiwi Dragon Fruit | Kiwi Dragonfruit', 'Passion Fruit | Passionfruit']);
  });
  it('candidatos de un nombre nuevo', () => {
    const c = candidatosDuplicado('sabor', 'Passion Fruit', cat.map((x) => ({ id: x.id, nombre: x.nombre })), { excluirId: cat.find((x) => x.nombre === 'Passion Fruit')!.id });
    expect(c[0]!.nombre).toBe('Passionfruit');
    expect(c[0]!.comparacion.clase).toBe('IGUAL_NORMALIZADO');
  });
});

describe('decision del alta', () => {
  const cat = [{ id: 1, nombre: 'Passionfruit' }, { id: 2, nombre: 'Lychee' }];
  it('IGUAL bloquea', () => expect(decisionAlta(candidatosDuplicado('sabor', 'Passion Fruit', cat))).toBe('preguntar_antes'));
  it('POSIBLE crea y deja pregunta', () => expect(decisionAlta(candidatosDuplicado('sabor', 'Lychee Burst', cat))).toBe('crear_y_dejar_pregunta'));
  it('sin parecido crea', () => expect(decisionAlta(candidatosDuplicado('sabor', 'Mango Tango', cat))).toBe('crear'));
  it('un negativo no vuelve a preguntar', () => {
    expect(decisionAlta(candidatosDuplicado('sabor', 'Passion Fruit', cat, { negativos: new Set([1]) }))).toBe('crear');
  });
});

describe('modelos y clientes usan el mismo motor sin diccionario de sabores', () => {
  it('modelo', () => {
    expect(compararNombres('modelo', 'Waka Blade', 'Waka Blade 50K').clase).toBe('POSIBLE');
    expect(compararNombres('modelo', 'Waka Blade', 'wakablade').clase).toBe('IGUAL_NORMALIZADO');
  });
  it('cliente: la traduccion de sabores no aplica', () => {
    expect(compararNombres('cliente', 'Sandia', 'Watermelon').clase).toBe('DISTINTO');
  });
});

it('texto de la pregunta', () => {
  expect(textoPregunta('Passion Fruit', 'Passionfruit')).toBe('¿"Passion Fruit" es lo mismo que "Passionfruit"?');
});
