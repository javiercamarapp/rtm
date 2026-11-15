// Plantillas del carril interprete (archivo propio para no tocar plantillas.ts). Texto con cifras SOLO desde el RegistroCifras: el monto que se muestra lo formatea el servidor.
import type { MontoARepetir } from '@/dominio/agente/guardia_ampliada';
import type { MensajeListo } from './plantillas';
import { RegistroCifras } from '@/dominio/agente/cifras';

/** Un monto dicho con k, mil, letra o de forma aproximada: se repite completo y se pide la cifra con todos sus digitos. No registra nada. */
export function montoARepetir(montos: readonly MontoARepetir[]): MensajeListo {
  const r = new RegistroCifras();
  const partes = montos.map((m) => `${r.citaUsuario(m.dicho)} -> ${r.pesos(m.centavos)}`);
  return {
    texto: `Entendi ${partes.join('; ')}. Para no equivocarme con el dinero no registre nada: escribe la cifra completa con todos sus digitos (por ejemplo ${r.pesos(montos[0]!.centavos)}) y lo registro de una vez.`,
    registro: r,
  };
}

const RESPUESTAS_SIN_PENDIENTE: ReadonlySet<string> = new Set(['slot_respuesta', 'sabor_respuesta', 'alias_respuesta', 'correccion', 'cancelar']);

/** El mensaje se entendio y paso las guardias, pero su puerta de ejecucion aun no esta conectada (o no hay pregunta pendiente a la que responda). No registra nada. */
export function textoExtraidoSinPuerta(tipo: string): MensajeListo {
  const nombre = tipo.replace(/_/g, ' ');
  return {
    texto: RESPUESTAS_SIN_PENDIENTE.has(tipo)
      ? `Entendi "${nombre}", pero no tengo ninguna pregunta ni operacion pendiente a la que responda ese mensaje. No registre nada; escribe la operacion completa.`
      : `Entendi la operacion "${nombre}", pero todavia no esta conectada a este chat. No registre nada; hazla desde el software.`,
    registro: new RegistroCifras(),
  };
}
