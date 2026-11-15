// Mensajes del carril de FRENOS (interruptor de escritura, antiduplicado, eco rico, lotes, webhook). Espanol neutro, sin emojis.
// Cada cifra sale del servidor y se registra en el RegistroCifras: la guardia de salida bloquea cualquier numero que no lo sea.
import { RegistroCifras } from '@/dominio/agente/cifras';
import type { Persona } from '@/dominio/agente/tipos';
import type { EcoRico, EstadoEscritura } from './puertos';
import type { MensajeListo } from './plantillas';

const NOMBRE: Readonly<Record<string, string>> = { angelo: 'Angelo', javier: 'Javier', sistema: 'el sistema' };
const nombre = (p: string | null): string => (p === null ? 'un socio' : (NOMBRE[p] ?? p));

/** Hora local de Merida (HH:MM) para "desde las ...". */
export function horaMerida(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Merida' }).format(d);
}

/** Lineas del eco rico: a que cliente, cuenta, pedido y proveedor se aplico y como quedan los saldos (todo de la base). */
export function lineasEco(r: RegistroCifras, e: EcoRico | undefined): string[] {
  if (!e) return [];
  const l: string[] = [];
  if (e.cliente) l.push(`- Cliente: ${r.servidor(e.cliente)}`);
  if (e.proveedor) l.push(`- Proveedor: ${r.servidor(e.proveedor)}`);
  if (e.socio) l.push(`- Socio: ${r.servidor(e.socio)}`);
  if (e.cuenta) l.push(`- Cuenta: ${r.servidor(e.cuenta)}`);
  if (e.via) l.push(`- Via: ${r.servidor(e.via)}`);
  for (const p of e.pedidosAplicados ?? []) l.push(`- Aplicado al pedido ${r.folio(p.folio)}: ${r.pesos(p.montoCent)}`);
  if (e.saldoAntesCent !== undefined) l.push(`- Saldo del cliente antes: ${r.pesos(e.saldoAntesCent)}`);
  if (e.saldoDespuesCent !== undefined) l.push(`- Saldo del cliente despues: ${r.pesos(e.saldoDespuesCent)}`);
  if (e.aFavorCent !== undefined && e.aFavorCent > 0n) l.push(`- Anticipo a favor del cliente: ${r.pesos(e.aFavorCent)}`);
  return l;
}

export function soloLectura(estado: EstadoEscritura): MensajeListo {
  const r = new RegistroCifras();
  const desde = estado.desde ? ` desde las ${r.servidor(horaMerida(estado.desde))}` : '';
  const quien = estado.por ? ` (lo dejo ${nombre(estado.por)})` : '';
  return { texto: `Estoy en solo lectura${desde}${quien}: no registre nada. Puedo consultar y deshacer. Un socio me activa con /escritura.`, registro: r };
}

export function escrituraCambiada(activa: boolean, por: string, hubo: boolean): MensajeListo {
  const r = new RegistroCifras();
  if (!hubo) return { texto: activa ? 'La escritura ya estaba activa.' : 'Ya estaba en solo lectura.', registro: r };
  return {
    texto: activa
      ? `Escritura ACTIVADA por ${nombre(por)}. Desde ahora registro los movimientos que me digan, sin tarjeta de confirmacion; todo se puede deshacer durante diez minutos.`
      : `Solo lectura activado por ${nombre(por)}. No registro movimientos nuevos; sigo con consultas y con deshacer. /escritura vuelve a activarme.`,
    registro: r,
  };
}

export function escrituraApagadaPorAnomalia(motivo: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `Apague la escritura por seguridad: ${r.servidor(motivo)}. Estoy en solo lectura; un socio revisa y me activa con /escritura.`, registro: r };
}

export function soloSociosEscritura(): MensajeListo {
  return { texto: 'Solo los socios cambian entre lectura y escritura.', registro: new RegistroCifras() };
}

/** Aviso obligatorio de lote: nunca se pierde una linea en silencio. `pausadas` = operaciones que NO se procesaron porque una anterior dejo una pregunta abierta. */
export function resumenLote(n: { lineas: number; registradas: number; preguntadas: number; sinEntender: number; partes: number; pausadas?: number; desdeOperacion?: number }): MensajeListo {
  const r = new RegistroCifras();
  const partes = n.partes > 1 ? ` Lo procese en ${r.config(n.partes)} partes.` : '';
  const pausa =
    n.pausadas !== undefined && n.pausadas > 0 && n.desdeOperacion !== undefined
      ? ` Pause ${r.config(n.pausadas)} operaciones sin registrar porque la operacion ${r.config(n.desdeOperacion)} tiene una pregunta abierta: contestala o cancelala y reenvia esas operaciones.`
      : '';
  return {
    texto: `Recibi ${r.config(n.lineas)} lineas: registre ${r.config(n.registradas)}, pregunte ${r.config(n.preguntadas)}, no entendi ${r.config(n.sinEntender)}.${partes}${pausa}`,
    registro: r,
  };
}

/** Lote pausado COMPLETO antes de escribir: a alguna operacion le falta un dato. No se registro ninguna, asi que reenviarlo no duplica nada. */
export function lotePausado(n: { operaciones: number; faltantes: ReadonlyArray<{ operacion: number; datos: string }> }): MensajeListo {
  const r = new RegistroCifras();
  const lista = n.faltantes.slice(0, 10).map((f) => `- operacion ${r.config(f.operacion)}: falta ${r.servidor(f.datos)}`);
  const mas = n.faltantes.length > 10 ? [`- y ${r.config(n.faltantes.length - 10)} mas`] : [];
  return {
    texto: [`Pause el lote completo: no registre ninguna de las ${r.config(n.operaciones)} operaciones porque a ${r.config(n.faltantes.length)} les falta un dato.`, ...lista, ...mas, 'Completa esos datos y reenvia el lote completo (nada quedo registrado, no se duplica), o mandalas una por una.'].join('\n'),
    registro: r,
  };
}

/** UNA sola pregunta por lote para los renglones iguales (o iguales a un movimiento reciente). */
export function preguntaLoteDuplicado(n: { renglones: number }): MensajeListo {
  const r = new RegistroCifras();
  return {
    texto: `En este mensaje hay ${r.config(n.renglones)} renglones iguales a un movimiento que ya registre (o iguales entre si) y no los registre todavia. ¿Son movimientos distintos y los registro?`,
    registro: r,
  };
}

export function chatMigrado(): MensajeListo {
  return { texto: 'El grupo paso a supergrupo y Telegram le cambio el identificador. Ya actualice el registro; sigo aqui y no cambia nada mas.', registro: new RegistroCifras() };
}

export function updateAbandonado(hora: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `No pude procesar el mensaje de las ${r.servidor(hora)} despues de varios intentos. Reenvialo, por favor. No registre nada de ese mensaje.`, registro: r };
}

export function pasaronDiezMinutos(texto: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor(texto), registro: r };
}

export function deshechoConEco(titulo: string, folioContra: string, eco: EcoRico | undefined, lineas: ReadonlyArray<{ etiqueta: string }>): MensajeListo {
  const r = new RegistroCifras();
  const partes = [`Deshecho con el contramovimiento ${r.folio(folioContra)}`, r.servidor(titulo), ...(eco ? ['Efecto revertido:', ...(eco.montoCent !== undefined ? [`- Monto: ${r.pesos(eco.montoCent)}`] : []), ...lineasEco(r, eco)] : [])];
  void lineas;
  return { texto: partes.join('\n'), registro: r };
}

export type { Persona };

export function repiteMontoCompleto(cita: string): MensajeListo {
  const r = new RegistroCifras();
  return {
    texto: `No registre nada: el monto esta escrito abreviado en "${r.citaUsuario(cita)}". Mandalo otra vez con la cifra completa (por ejemplo ${r.servidor('20,000')}) para que no haya duda.`,
    registro: r,
  };
}
