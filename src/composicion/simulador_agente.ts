// Simulador local de conversaciones del agente: sin red, sin base, sin modelos de pago (LLM heuristico + servidor simulado).
// Sintaxis de cada linea (las vacias y las que empiezan con # se ignoran):
//   angelo> texto            un socio escribe en el grupo        javier> texto
//   omar> texto              Omar escribe en su chat privado
//   boton <quien> <n>        <quien> pulsa el boton n (desde 1) del ultimo mensaje con botones
//   reloj +10m | +2h         avanza el reloj
//   caducar                  corre el cron de tomas vencidas
import { crearAgenteEnMemoria, type AgenteEnMemoria } from './agente';
import { updateBoton, updateTexto } from '@/infra/agente/updates';
import type { Enviado } from '@/infra/agente/memoria';

type Quien = 'angelo' | 'javier' | 'omar';

function esQuien(s: string): s is Quien {
  return s === 'angelo' || s === 'javier' || s === 'omar';
}

function imprimir(m: Enviado, etiqueta: string): string[] {
  const salida = m.texto.split('\n').map((l, i) => (i === 0 ? `[${etiqueta}] ${l}` : `        ${l}`));
  let n = 0;
  for (const fila of m.botones ?? []) for (const b of fila) salida.push(`        (${++n}) [${b.texto}]`);
  return salida;
}

export async function ejecutarGuion(lineas: readonly string[], h: AgenteEnMemoria = crearAgenteEnMemoria()): Promise<string[]> {
  const transcripcion: string[] = [];
  let vistos = h.telegram.enviados.length;
  let editados = h.telegram.ediciones.length;
  const volcar = () => {
    for (const m of h.telegram.enviados.slice(vistos)) transcripcion.push(...imprimir(m, m.chatId === h.ids.grupoSocios ? 'grupo' : 'omar'));
    vistos = h.telegram.enviados.length;
    for (const ed of h.telegram.ediciones.slice(editados)) transcripcion.push(`[editado ${ed.chatId === h.ids.grupoSocios ? 'grupo' : 'omar'}] ${ed.texto.split('\n')[0]}`);
    editados = h.telegram.ediciones.length;
  };

  for (const cruda of lineas) {
    const linea = cruda.trim();
    if (linea === '' || linea.startsWith('#')) continue;
    transcripcion.push(`> ${linea}`);

    const mensaje = /^(angelo|javier|omar)>\s*(.*)$/.exec(linea);
    const boton = /^boton\s+(angelo|javier|omar)\s+(\d+)$/.exec(linea);
    const reloj = /^reloj\s+\+(\d+)(m|h)$/.exec(linea);
    if (mensaje && esQuien(mensaje[1]!)) {
      const quien = mensaje[1] as Quien;
      const chat = quien === 'omar' ? h.ids.privadoOmar : h.ids.grupoSocios;
      await h.agente.procesarUpdate(updateTexto(h.contador, { de: h.ids[quien], chat, texto: mensaje[2]! }));
    } else if (boton) {
      const quien = boton[1] as Quien;
      const n = Number(boton[2]);
      const conBotones = [...h.telegram.enviados].reverse().find((m) => m.botones && m.botones.length > 0);
      const plano = conBotones?.botones?.flat() ?? [];
      const elegido = plano[n - 1];
      if (!conBotones || !elegido) {
        transcripcion.push('  (no hay ese boton)');
      } else {
        await h.agente.procesarUpdate(updateBoton(h.contador, { de: h.ids[quien], chat: conBotones.chatId, messageId: conBotones.messageId, data: elegido.callbackData }));
        const alerta = h.telegram.callbacks.at(-1);
        if (alerta?.alerta && alerta.texto) transcripcion.push(`  (alerta de pantalla: ${alerta.texto})`);
      }
    } else if (reloj) {
      if (reloj[2] === 'm') h.reloj.avanzarMin(Number(reloj[1]));
      else h.reloj.avanzarHoras(Number(reloj[1]));
    } else if (linea === 'caducar') {
      const folios = await h.agente.caducarTomasVencidas();
      transcripcion.push(`  (tomas caducadas: ${folios.length})`);
    } else {
      transcripcion.push('  (linea no entendida)');
    }
    volcar();
  }
  return transcripcion;
}
