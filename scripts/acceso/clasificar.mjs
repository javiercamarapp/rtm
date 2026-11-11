// Clasifica la lista de permitidos por NOMBRE en la parte local del correo (javier, angelo, omar). Funcion pura: no imprime nada.
// Exige exactamente una direccion por persona; si una linea no encaja o se repite, se detiene (nunca adivina).

const PERSONAS = [
  { clave: 'javier', rol: 'socio', socio: 'Javier', activo: true },
  { clave: 'angelo', rol: 'socio', socio: 'Angelo', activo: true },
  // Omar queda con acceso desactivado hasta que exista su vista (M2).
  { clave: 'omar', rol: 'omar', socio: null, activo: false },
];

export function clasificar(texto) {
  const lineas = texto.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const correos = lineas.map((l) => l.toLowerCase());
  for (const c of correos) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) throw new Error('una linea de la lista no es un correo valido');
  }
  const salida = [];
  for (const p of PERSONAS) {
    const coinciden = correos.filter((c) => c.split('@')[0].includes(p.clave));
    if (coinciden.length !== 1) throw new Error(`se esperaba exactamente un correo para ${p.clave} y hay ${coinciden.length}`);
    salida.push({ correo: coinciden[0], rol: p.rol, socio: p.socio, activo: p.activo, persona: p.clave });
  }
  if (new Set(salida.map((s) => s.correo)).size !== salida.length) throw new Error('un mismo correo coincide con dos personas');
  if (correos.length !== salida.length) throw new Error(`la lista tiene ${correos.length} correos y se esperaban ${salida.length}`);
  return salida;
}
