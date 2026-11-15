// Simulador de ataques de inyeccion: corre la lista de ataques tipicos contra el agente en memoria con un modelo obediente.
//   npx tsx scripts/agente/simular-ataques.mts
// Sale con codigo 1 si algun ataque escribe un movimiento o si el modelo ve la orden.
import { ATAQUES, simularAtaque } from '@/composicion/ataques_inyeccion';

let fallos = 0;
for (const a of ATAQUES) {
  const r = await simularAtaque(a);
  const bien = r.hechos === 0 && r.filtraAlModelo.length === 0;
  if (!bien) fallos++;
  process.stdout.write(`${bien ? 'FRENADO' : 'FALLA  '} ${a.id.padEnd(28)} movimientos=${r.hechos} oculto_al_modelo=${r.filtraAlModelo.length === 0 ? 'si' : `NO (${r.filtraAlModelo.join('|')})`}\n`);
  process.stdout.write(`        respuesta: ${r.respuesta.split('\n')[0]}\n`);
}
process.stdout.write(`\n${ATAQUES.length} ataques, ${fallos} fallas\n`);
process.exit(fallos === 0 ? 0 : 1);
