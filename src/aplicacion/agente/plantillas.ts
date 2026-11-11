// Plantillas de mensajes. Todo texto con cifras se arma aqui, SOLO con valores del servidor registrados en un RegistroCifras;
// el comunicador audita el texto final antes de enviarlo. Sin emojis.
import { LISTA_COMANDOS } from '@/dominio/agente/comandos';
import { VENTANA_DESHACER_MIN } from '@/dominio/agente/deshacer';
import { RegistroCifras } from '@/dominio/agente/cifras';
import type { CifraServidor, Miembro, Persona } from '@/dominio/agente/tipos';
import type { RespuestaConsulta, ResultadoEjecutado } from './puertos';

export interface MensajeListo {
  texto: string;
  registro: RegistroCifras;
}

const NOMBRE: Readonly<Record<Persona, string>> = { angelo: 'Angelo', javier: 'Javier', omar: 'Omar' };

export function nombrePersona(p: Persona): string {
  return NOMBRE[p];
}

function listar(r: RegistroCifras, cifras: readonly CifraServidor[]): string[] {
  return cifras.map((c) => `- ${r.servidor(c.etiqueta)}: ${r.cifra(c)}`);
}

export function ecoEjecutado(res: ResultadoEjecutado, autor: Miembro): MensajeListo {
  const r = new RegistroCifras();
  const partes: string[] = [`Registrado ${r.folio(res.folio)} por ${nombrePersona(autor.persona)}`, r.servidor(res.titulo), ...listar(r, res.lineas)];
  if (res.comprobacion.length > 0) partes.push('Comprobacion:', ...listar(r, res.comprobacion));
  if (res.saldos.length > 0) partes.push('Saldo resultante:', ...listar(r, res.saldos));
  for (const a of res.advertencias) partes.push(`Aviso: ${r.servidor(a)}`);
  partes.push(`Deshacer disponible por ${r.config(VENTANA_DESHACER_MIN)} minutos.`);
  return { texto: partes.join('\n'), registro: r };
}

export function ecoDeshecho(titulo: string, folioContra: string, lineas: readonly CifraServidor[]): MensajeListo {
  const r = new RegistroCifras();
  const partes = [`Deshecho con el contramovimiento ${r.folio(folioContra)}`, r.servidor(titulo), ...listar(r, lineas)];
  return { texto: partes.join('\n'), registro: r };
}

export function preguntaResolucion(entrada: { campo: string; textoUsuario: string; cita: string }): MensajeListo {
  const r = new RegistroCifras();
  return {
    texto: `En "${r.citaUsuario(entrada.cita)}", ¿cual ${entrada.campo} es "${r.citaUsuario(entrada.textoUsuario)}"?`,
    registro: r,
  };
}

export function preguntaNoEncontrado(entrada: { campo: string; textoUsuario: string; cita: string; sugerencias: readonly string[] }): MensajeListo {
  const r = new RegistroCifras();
  const base = `En "${r.citaUsuario(entrada.cita)}", no encontre ${entrada.campo} "${r.citaUsuario(entrada.textoUsuario)}".`;
  const sug = entrada.sugerencias.length > 0 ? ` ¿Quisiste decir ${entrada.sugerencias.map((s) => r.servidor(s)).join(' o ')}?` : ' Escribe el nombre completo.';
  return { texto: base + sug, registro: r };
}

export function preguntaNegocio(texto: string, cifras: readonly CifraServidor[]): MensajeListo {
  const r = new RegistroCifras();
  return { texto: [r.servidor(texto), ...listar(r, cifras)].join('\n'), registro: r };
}

export function rechazo(texto: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor(texto), registro: r };
}

export function tarjetaToma(folio: string, titulo: string, lineas: readonly CifraServidor[], resumen: readonly CifraServidor[], autor: Miembro): MensajeListo {
  const r = new RegistroCifras();
  const partes = [`Toma ${r.folio(folio)} pendiente de autorizacion (solicitada por ${nombrePersona(autor.persona)})`, r.servidor(titulo), ...listar(r, lineas), ...listar(r, resumen)];
  return { texto: partes.join('\n'), registro: r };
}

export function tarjetaTomaResuelta(folio: string, estado: 'autorizada' | 'rechazada', por: Miembro): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Toma ${r.folio(folio)} ${estado} por ${nombrePersona(por.persona)}.`, registro: r };
}

export function consulta(res: RespuestaConsulta): MensajeListo {
  const r = new RegistroCifras();
  return { texto: [r.servidor(res.titulo), ...listar(r, res.lineas)].join('\n'), registro: r };
}

export function ayuda(): MensajeListo {
  return { texto: `Comandos: ${LISTA_COMANDOS}. Tambien puedes escribir el pedido o el pago con tus palabras.`, registro: new RegistroCifras() };
}

export function avisoModoSinIa(): MensajeListo {
  return { texto: `Modo sin IA activo. Uso: ${LISTA_COMANDOS}`, registro: new RegistroCifras() };
}

export function avisoSinIaMensaje(): MensajeListo {
  return { texto: 'No pude interpretarlo con IA; escribelo con /pedido, /pago, /gasto o /compra.', registro: new RegistroCifras() };
}

export function alertaPresupuesto(tipo: 'dia' | 'mes', porcentaje: number): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Alerta: el gasto de IA del ${tipo === 'dia' ? 'dia' : 'mes'} llego al ${r.config(porcentaje)} % del tope.`, registro: r };
}

export function textoSimple(texto: string): MensajeListo {
  return { texto, registro: new RegistroCifras() };
}

// ---- Omar: lista cerrada (recibido, autorizado, rechazado, caduco, saldo semanal, "eso lo registran los duenos").

export function omarRecibido(folio: string, lineas: readonly CifraServidor[]): MensajeListo {
  const r = new RegistroCifras();
  return { texto: [`Recibido ${r.folio(folio)}, pendiente de autorizacion.`, ...listar(r, lineas)].join('\n'), registro: r };
}

export function omarAutorizado(folio: string, saldoSemanal: CifraServidor | null): MensajeListo {
  const r = new RegistroCifras();
  const extra = saldoSemanal ? ` ${r.servidor(saldoSemanal.etiqueta)}: ${r.cifra(saldoSemanal)}.` : '';
  return { texto: `Autorizado ${r.folio(folio)}.${extra}`, registro: r };
}

export function omarRechazado(folio: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Rechazado ${r.folio(folio)}.`, registro: r };
}

export function omarCaducado(folio: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Caduco ${r.folio(folio)} sin autorizacion.`, registro: r };
}

export function omarFueraDeAlcance(): MensajeListo {
  return { texto: 'Eso lo registran los duenos, ya les avise.', registro: new RegistroCifras() };
}

export function avisoOmarAlGrupo(tipo: string): MensajeListo {
  return { texto: `Omar escribio algo que solo registran los socios (${tipo}). No se ejecuto nada.`, registro: new RegistroCifras() };
}

export function uso(texto: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Formato: ${r.servidor(texto)}`, registro: r };
}

/** Pregunta redactada por el modelo: solo pasa si sus numeros salen del propio mensaje del socio. */
export function aclaracion(pregunta: string, mensajeFuente: string): MensajeListo {
  const r = new RegistroCifras();
  r.citaUsuario(mensajeFuente);
  return { texto: pregunta, registro: r };
}

export function cifraSinProcedencia(cita: string, campos: readonly string[]): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `En "${r.citaUsuario(cita)}" no encuentro la cifra de ${campos.map((c) => r.servidor(c)).join(', ')}. No ejecute nada; escribela de nuevo o usa el comando.`, registro: r };
}

export function tomaCaducadaGrupo(folio: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `La toma ${r.folio(folio)} caduco sin autorizacion y se libero la reserva.`, registro: r };
}
