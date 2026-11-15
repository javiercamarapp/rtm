// Un mensaje largo (o un lote pegado) NO se recorta en silencio: se parte por lineas y cada parte va al modelo por separado.
export interface Parte {
  texto: string;
  /** Lineas no vacias que trae esta parte. */
  lineas: number;
}

/** Parte por lineas, nunca a mitad de una linea (salvo una linea mas larga que el tope, que se corta por caracteres). Conserva el orden. */
export function partirMensaje(texto: string, maxLineas: number, maxCaracteres: number): Parte[] {
  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const partes: Parte[] = [];
  let actual: string[] = [];
  let largo = 0;
  const cerrar = (): void => {
    if (actual.length > 0) partes.push({ texto: actual.join('\n'), lineas: actual.length });
    actual = [];
    largo = 0;
  };
  for (const l of lineas) {
    const trozos = l.length > maxCaracteres ? l.match(new RegExp(`.{1,${maxCaracteres}}`, 'g')) ?? [l] : [l];
    for (const t of trozos) {
      if (actual.length >= maxLineas || (actual.length > 0 && largo + t.length + 1 > maxCaracteres)) cerrar();
      actual.push(t);
      largo += t.length + 1;
    }
  }
  cerrar();
  return partes;
}
