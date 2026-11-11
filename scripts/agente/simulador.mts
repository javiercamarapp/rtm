// Simulador local de conversaciones del agente de Telegram. Sin red, sin base de datos, sin modelos de pago.
//   npx tsx scripts/agente/simulador.mts                      modo interactivo (una linea por turno)
//   npx tsx scripts/agente/simulador.mts scripts/agente/guion-ejemplo.txt   reproduce un guion
// Sintaxis: ver src/composicion/simulador_agente.ts. Todos los datos son ilustrativos.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { crearAgenteEnMemoria } from '@/composicion/agente';
import { ejecutarGuion } from '@/composicion/simulador_agente';

const ruta = process.argv[2];
if (ruta) {
  const lineas = readFileSync(ruta, 'utf8').split('\n');
  for (const l of await ejecutarGuion(lineas)) process.stdout.write(`${l}\n`);
} else {
  const h = crearAgenteEnMemoria();
  process.stdout.write('Simulador del agente. Escribe "angelo> Cliente Norte 28 jupiter", "boton angelo 1", "reloj +10m", "caducar". Ctrl+D para salir.\n');
  const rl = createInterface({ input: process.stdin });
  for await (const linea of rl) {
    for (const l of await ejecutarGuion([linea], h)) process.stdout.write(`${l}\n`);
  }
}
