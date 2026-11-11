// Hojas SIN cabeceras y desordenadas: se detectan por contenido las columnas de telefono (celdas de 10 digitos o mas), las de texto (nombres o notas)
// y se ignoran los contadores (enteros cortos). Devuelve la tabla estandar que lee `leerTabla`. Puro.

const DIGITOS_TELEFONO = /^\+?[\d\s().-]{10,}$/;
const tieneLetras = (s: string) => /\p{L}/u.test(s);

export function tablaSinCabecera(filas: string[][]): string[][] {
  const ancho = Math.max(0, ...filas.map((f) => f.length));
  const telefonos: number[] = [];
  const textos: number[] = [];
  for (let c = 0; c < ancho; c++) {
    const celdas = filas.map((f) => (f[c] ?? '').trim()).filter((v) => v !== '');
    if (celdas.length === 0) continue;
    const comoTel = celdas.filter((v) => DIGITOS_TELEFONO.test(v) && v.replace(/\D/g, '').length >= 10).length;
    // Telefonos: una parte apreciable de la columna parece telefono (los contadores 1..N nunca llegan a 10 digitos).
    if (comoTel >= 3 && comoTel / celdas.length >= 0.3) telefonos.push(c);
    else if (celdas.some(tieneLetras)) textos.push(c);
  }
  const nombres = textos.slice(0, 3);
  const cab = [...nombres.map((_, i) => ['First Name', 'Middle Name', 'Last Name'][i]!), ...telefonos.map((_, i) => `Phone ${i + 1} - Value`)];
  const cuerpo = filas.map((f) => [
    ...nombres.map((c) => {
      const v = (f[c] ?? '').trim();
      return tieneLetras(v) ? v : '';
    }),
    ...telefonos.map((c) => (f[c] ?? '').trim()),
  ]);
  return [cab, ...cuerpo];
}
