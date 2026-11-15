// Generador pseudoaleatorio DETERMINISTA (mismo texto semilla, misma secuencia). Sin azar ni reloj del sistema: el demo debe poder reproducirse byte a byte.
function xmur3(texto) {
  let h = 1779033703 ^ texto.length;
  for (let i = 0; i < texto.length; i += 1) {
    h = Math.imul(h ^ texto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function crearAzar(semilla) {
  let a = xmur3(String(semilla))();
  const siguiente = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    /** Real en [0, 1). */
    r: siguiente,
    /** Entero en [min, max]. */
    entre: (min, max) => min + Math.floor(siguiente() * (max - min + 1)),
    /** Elemento de la lista. */
    de: (lista) => lista[Math.floor(siguiente() * lista.length)],
    /** true con probabilidad p. */
    prob: (p) => siguiente() < p,
    /** Copia barajada (Fisher-Yates). */
    barajar: (lista) => {
      const c = [...lista];
      for (let i = c.length - 1; i > 0; i -= 1) {
        const j = Math.floor(siguiente() * (i + 1));
        [c[i], c[j]] = [c[j], c[i]];
      }
      return c;
    },
  };
}
