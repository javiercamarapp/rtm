// Plantillas de mensajes. Todo texto con cifras se arma aqui, SOLO con valores del servidor registrados en un RegistroCifras;
// el comunicador audita el texto final antes de enviarlo. Sin emojis.
import { LISTA_COMANDOS } from '@/dominio/agente/comandos';
import { VENTANA_DESHACER_MIN } from '@/dominio/agente/deshacer';
import { RegistroCifras } from '@/dominio/agente/cifras';
import type { Intencion } from '@/dominio/agente/intenciones';
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

export function ecoEjecutado(res: ResultadoEjecutado, autor: Miembro, confirmadoPor: Persona | null = null): MensajeListo {
  const r = new RegistroCifras();
  const quien = confirmadoPor !== null && confirmadoPor !== autor.persona ? `${nombrePersona(autor.persona)}, confirmado por ${nombrePersona(confirmadoPor)}` : nombrePersona(autor.persona);
  const partes: string[] = [`Registrado ${r.folio(res.folio)} por ${quien}`, r.servidor(res.titulo), ...listar(r, res.lineas)];
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

/** Pregunta por un dato que falta. Solo texto del servidor: sin cifras ni nombres del modelo. */
export function faltaDato(dato: string): MensajeListo {
  return { texto: `Falta un dato antes de registrar: ${dato}. No registre nada; mandalo de nuevo con ese dato.`, registro: new RegistroCifras() };
}

const TITULO_RESUMEN: Readonly<Partial<Record<Intencion['tipo'], string>>> = {
  pedido: 'Pedido de cliente',
  pago: 'Cobro a cliente',
  pago_proveedor: 'Pago a proveedor',
  gasto: 'Gasto',
  aportacion: 'Aportacion de un socio',
  reembolso_socio: 'Reembolso a un socio',
  retiro_utilidad: 'Retiro de utilidad',
  devolucion: 'Devolucion de un cliente',
  paquete_perdido: 'Paquete perdido o danado',
  compra: 'Compra a proveedor',
  orden_compra: 'Orden de compra',
};

export interface DatosResumen {
  autor: Miembro;
  cliente: string | null;
  proveedor: string | null;
  /** Nombre de catalogo de cada linea, en el orden de la intencion. */
  lineas: readonly string[];
  horas: number;
}

const NOMBRE_SOCIO: Readonly<Record<'angelo' | 'javier', string>> = { angelo: 'Angelo', javier: 'Javier' };
const nombreProveedor = (p: string | null): string => (p === 'karen' ? 'Karen' : p === 'isaac' ? 'Isaac' : 'el proveedor');
const nombreQuien = (q: 'angelo' | 'javier' | 'sociedad'): string => (q === 'sociedad' ? 'la sociedad' : NOMBRE_SOCIO[q]);

/**
 * Resumen previo a registrar un movimiento. NO calcula nada: cada importe y cada cantidad es la que el socio escribio (el codigo ya
 * verifico que aparece en su mensaje) y el resto son nombres del catalogo. El total y los saldos los entrega el servidor DESPUES de registrar.
 */
export function resumenConfirmacion(i: Intencion, d: DatosResumen): MensajeListo {
  const r = new RegistroCifras();
  const l: string[] = [`Resumen para confirmar. Todavia no se registro nada. Lo pidio ${nombrePersona(d.autor.persona)}.`, `Movimiento: ${TITULO_RESUMEN[i.tipo] ?? i.tipo}`];
  const monto = (c: number) => `Monto: ${r.pesos(BigInt(c))}`;
  const lineasDe = (ls: readonly { piezas: number }[]) => ls.map((x, n) => `- ${r.servidor(d.lineas[n] ?? 'modelo')}: ${r.piezas(x.piezas)} piezas`);
  switch (i.tipo) {
    case 'pago':
      l.push(`Cliente: ${r.servidor(d.cliente ?? i.cliente_texto)}`, monto(i.monto_centavos), `Cuenta donde entro: ${r.citaUsuario(i.cuenta_destino_texto ?? '')}`);
      if (i.pedido_folio !== null) l.push(`Pedido: ${r.citaUsuario(i.pedido_folio)}`);
      break;
    case 'pago_proveedor':
      l.push(`Proveedor: ${nombreProveedor(d.proveedor)}`, monto(i.monto_centavos), `Lo pago: ${nombreQuien(i.pagado_por)}`);
      if (d.cliente !== null) l.push(`Por cuenta del cliente: ${r.servidor(d.cliente)}`);
      break;
    case 'gasto':
      l.push(`Concepto: ${i.gasto}`, monto(i.monto_centavos), `Lo pago: ${nombreQuien(i.pagado_por)} (queda como reembolso pendiente a ese socio)`);
      if (i.descripcion !== null) l.push(`Nota: ${r.citaUsuario(i.descripcion)}`);
      break;
    case 'aportacion':
      l.push(`Socio: ${NOMBRE_SOCIO[i.socio]}`, monto(i.monto_centavos), i.intencion === 'capital' ? 'Tipo: capital que declaro el socio (inversion)' : 'Tipo: reembolso, cuenta por pagar al socio (no es capital porque no se declaro como capital)');
      if (i.motivo !== null) l.push(`Motivo: ${r.citaUsuario(i.motivo)}`);
      break;
    case 'reembolso_socio':
      l.push(`Socio que recibe: ${NOMBRE_SOCIO[i.socio]}`, monto(i.monto_centavos), `Via: ${i.via ?? ''}`);
      break;
    case 'retiro_utilidad':
      l.push(`Socio que retira: ${NOMBRE_SOCIO[i.socio]}`, monto(i.monto_centavos), `Via: ${i.via ?? ''}`, 'La base rechaza el retiro si excede la utilidad ya asignada.');
      break;
    case 'devolucion':
      l.push(`Cliente: ${r.servidor(d.cliente ?? i.cliente_texto)}`, `Pedido: ${r.citaUsuario(i.pedido_folio ?? '')}`, ...lineasDe(i.lineas), `Destino de las piezas: ${i.destino ?? 'el que defina el servidor'}`);
      if (i.motivo !== null) l.push(`Motivo: ${r.citaUsuario(i.motivo)}`);
      break;
    case 'paquete_perdido':
      l.push(`Pedido: ${r.citaUsuario(i.pedido_folio ?? '')}`, `Incidente: ${i.incidente === 'perdido' ? 'perdido' : 'danado'}`);
      if (i.detalle !== null) l.push(`Detalle: ${r.citaUsuario(i.detalle)}`);
      break;
    case 'compra':
    case 'orden_compra':
      l.push(`Proveedor: ${nombreProveedor(d.proveedor)}`, ...lineasDe(i.lineas));
      break;
    case 'pedido':
      l.push(`Cliente: ${r.servidor(d.cliente ?? i.cliente_texto)}`, ...lineasDe(i.lineas));
      break;
    default:
      break;
  }
  l.push(`Confirma con el boton o cancela. La tarjeta caduca en ${r.config(d.horas)} horas.`);
  return { texto: l.join('\n'), registro: r };
}
