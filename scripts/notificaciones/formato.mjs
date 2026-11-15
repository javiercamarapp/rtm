// Formato puro del informe de resolver-vigentes (sin base de datos: se prueba con datos ficticios).
const ACCION = { resolver: 'Se resolveria', retirar: 'Se retiraria', reabrir: 'Se reabriria' };

export function parsearArgs(argv) {
  const aplicar = argv.includes('--aplicar');
  const verificar = argv.includes('--verificar');
  if (aplicar && verificar) return { error: 'Usa --verificar o --aplicar, no los dos.' };
  const desconocido = argv.find((a) => a !== '--aplicar' && a !== '--verificar');
  if (desconocido) return { error: `Opcion desconocida: ${desconocido}` };
  return { aplicar };
}

/** Lineas del informe a partir del resultado de notificacion.depurar(). `aplicado` cambia el tiempo del verbo. */
export function informe(res) {
  const lineas = [];
  const verbo = (a) => (res.aplicado ? { resolver: 'Resuelto', retirar: 'Retirado', reabrir: 'Reabierto' }[a] : ACCION[a]);
  for (const d of res.detalle ?? []) {
    lineas.push(`${verbo(d.accion)}: #${d.id} ${d.codigo} - ${d.titulo}${d.accion === 'resolver' ? ` | ${d.motivo}${d.ref ? ` | ref ${d.ref}` : ''}` : d.accion === 'retirar' ? ` | ${d.motivo}` : ''}`);
  }
  lineas.push(`${res.aplicado ? 'Aplicado' : 'Solo lectura'}: ${res.resueltos} por resolver, ${res.retirados} informativos por retirar, ${res.reabiertos} por reabrir.`);
  return lineas;
}
