// Plantillas de mensajes. Todo texto con cifras se arma aqui, SOLO con valores del servidor registrados en un RegistroCifras;
// el comunicador audita el texto final antes de enviarlo. Sin emojis.
import { LISTA_COMANDOS } from '@/dominio/agente/comandos';
import { VENTANA_DESHACER_MIN } from '@/dominio/agente/deshacer';
import { RegistroCifras } from '@/dominio/agente/cifras';
import type { Intencion } from '@/dominio/agente/intenciones';
import type { CifraServidor, Miembro, Persona } from '@/dominio/agente/tipos';
import type { Reversa } from '@/dominio/agente/catalogo_intenciones';
import { formatearFechaPago, type OpcionFecha } from '@/dominio/agente/fecha_pago';
import type { Igualacion, RecordatorioMenudeo, RespuestaConsulta, ResultadoEjecutado, ResultadoSimulacion } from './puertos';

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
  return {
    texto: `Comandos: ${LISTA_COMANDOS}. Tambien puedes escribir con tus palabras (pedidos, cobros, compras, gastos, mermas, conteos, clientes, actas). Todo movimiento muestra un resumen y NO se registra hasta que un socio pulse Confirmar; /deshacer revierte lo que tiene reversa; /pendientes dice que falta por hacer. El bot nunca escribe a clientes y nunca calcula dinero.`,
    registro: new RegistroCifras(),
  };
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

/** La suma que dicto el socio no cuadra con sus renglones: se bloquea y se pide correccion. Ambas cifras las calcula el codigo, no el modelo. */
export function sumaNoCuadra(sumaRenglones: bigint, dictado: bigint): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `La suma de los renglones es ${r.pesos(sumaRenglones)} y dijiste ${r.pesos(dictado)}. No registre nada: corrige el total o los renglones y mandalo de nuevo.`, registro: r };
}

export function faltaDatoConOpciones(dato: string): MensajeListo {
  return { texto: `Falta un dato antes de registrar: ${dato}. Elige una opcion; no registre nada todavia.`, registro: new RegistroCifras() };
}

const TEXTO_REVERSA: Readonly<Record<Reversa, string>> = {
  directa: 'Se puede deshacer despues con /deshacer.',
  software: 'NO tiene deshacer directo por Telegram: si hay error, se corrige desde el software.',
  ninguna: 'NO se puede deshacer por Telegram: queda registrado y solo se corrige desde el software con un movimiento nuevo.',
};

/** Segunda confirmacion de las acciones reforzadas: dice antes si hay o no deshacer. */
export function refuerzo(tipo: string, reversa: Reversa): MensajeListo {
  return { texto: `Confirmacion reforzada (${tipo.replace(/_/g, ' ')}). ${TEXTO_REVERSA[reversa]} ¿Seguro que lo registro?`, registro: new RegistroCifras() };
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
  orden_compra: 'Orden de compra (borrador que los socios aprueban)',
  pedido_envio: 'Cambio de estado de un pedido',
  pedido_cancelar: 'Cancelacion de un pedido',
  compra_recepcion: 'Recepcion de una compra',
  compra_estado: 'Paquete de una compra',
  compra_aprobar: 'Aprobacion de una orden de compra',
  gasto_servicio: 'Cargo de un servicio del sistema',
  merma: 'Merma de inventario',
  conteo: 'Conteo fisico de inventario',
  cliente_alta: 'Alta de cliente',
  cliente_precio: 'Precio de un cliente',
  acta_propuesta: 'Propuesta de acta de corte',
  acta_firma: 'Firma del acta de corte',
  lote_historico: 'Lote de movimientos historicos (fecha pasada)',
  pedido_menudeo: 'Pedido a costo de menudeo (para ti, con fecha comprometida de pago)',
  pago_pedido_menudeo: 'Aviso de pago de un pedido de menudeo',
};

export interface DatosResumen {
  autor: Miembro;
  cliente: string | null;
  proveedor: string | null;
  /** Nombre de catalogo de cada linea, en el orden de la intencion. */
  lineas: readonly string[];
  horas: number;
  /** Efecto calculado por el servidor al simular (null si el negocio no simula). */
  efecto?: Extract<ResultadoSimulacion, { tipo: 'simulado' }> | null;
  reversa?: Reversa;
  reforzada?: boolean;
  modelo?: string | null;
  clientesLote?: Record<string, string> | null;
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
      else if (i.pagado_por !== 'sociedad') {
        l.push(i.intencion === 'capital'
          ? `Declaracion del socio: capital, con sus palabras ("${r.citaUsuario(i.fuente_cita)}"). Si no es lo que quisiste decir, cancela.`
          : 'Declaracion del socio: ninguna de capital (por omision es reembolso). Abajo se muestra como lo registrara el sistema.');
      }
      break;
    case 'gasto':
      l.push(`Concepto: ${i.gasto}`, monto(i.monto_centavos), `Lo pago: ${nombreQuien(i.pagado_por)} (queda como reembolso pendiente a ese socio)`);
      if (i.descripcion !== null) l.push(`Nota: ${r.citaUsuario(i.descripcion)}`);
      break;
    case 'aportacion':
      l.push(`Socio: ${NOMBRE_SOCIO[i.socio]}`, monto(i.monto_centavos), i.intencion === 'capital' ? 'Declaracion del socio: capital (inversion), con sus palabras' : 'Declaracion del socio: ninguna de capital (por omision es reembolso)');
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
      if (i.plazo_dias !== undefined && i.plazo_dias !== null) {
        l.push(i.plazo_dias === 0 ? 'Plazo: de contado' : r.servidor(`Plazo: ${i.plazo_dias} dias a credito, contados desde el ENVIO del pedido`));
        if (i.plazo_fecha_dicha) l.push(r.servidor(`Dijiste el ${formatearFechaPago(i.plazo_fecha_dicha, null).replace(' (sin hora)', '')}: ese dia solo vence si el pedido se envia hoy; si se envia despues, vence ${i.plazo_dias} dias despues del envio`));
      }
      break;
    case 'pedido_envio':
      l.push(`Pedido: ${r.citaUsuario(i.pedido_folio ?? '')}`, `Nuevo estado: ${i.estado}`);
      if (i.guia_texto !== null) l.push(`Guia: ${r.citaUsuario(i.guia_texto)}`);
      break;
    case 'pedido_cancelar':
      l.push(`Pedido: ${r.citaUsuario(i.pedido_folio ?? '')}`, `Motivo: ${r.citaUsuario(i.motivo ?? '')}`);
      break;
    case 'compra_aprobar':
      l.push(`Compra: ${r.citaUsuario(i.compra_folio ?? '')}`);
      break;
    case 'compra_estado':
      l.push(`Compra: ${r.citaUsuario(i.compra_folio ?? '')}`, `Estado: ${i.estado === 'enviada' ? 'enviada (en trayecto)' : 'llego a Merida'}`);
      break;
    case 'compra_recepcion':
      l.push(`Compra: ${r.citaUsuario(i.compra_folio ?? '')}`, ...(i.lineas.length === 0 ? ['Recepcion TOTAL de lo pedido (si la compra ya recibio parte, se recibe solo el saldo pendiente)'] : ['Recepcion PARCIAL (la compra queda abierta hasta que llegue todo o se cierre la recepcion en el software):', ...lineasDe(i.lineas)]));
      break;
    case 'gasto_servicio':
      l.push(`Servicio: ${r.citaUsuario(i.servicio_texto)}`, ...(i.monto_usd_centavos !== null ? [`Cargo en dolares: ${r.pesos(BigInt(i.monto_usd_centavos))} USD`] : [monto(i.monto_mxn_centavos ?? 0)]), `Lo pago: ${nombreQuien(i.pagado_por)} (queda como reembolso pendiente a ese socio)`);
      if (i.tipo_cambio_micro !== null) l.push(`Tipo de cambio dicho: ${r.citaUsuario(String(i.tipo_cambio_micro / 1_000_000))}`);
      break;
    case 'merma':
      l.push(`Modelo: ${r.servidor(d.lineas[0] ?? 'modelo')}`, `Sabor: ${r.citaUsuario(i.sabor_texto ?? '')}`, `Piezas: ${r.piezas(i.piezas)}`, `Motivo: ${r.citaUsuario(i.motivo ?? '')}`);
      break;
    case 'conteo':
      l.push('Piezas contadas (el sistema ajusta la existencia a este conteo):', ...lineasDe(i.lineas));
      break;
    case 'cliente_alta':
      l.push(`Nombre: ${r.citaUsuario(i.nombre)}`, 'Sin telefonos: los contactos viven aparte.');
      break;
    case 'cliente_precio':
      l.push(`Cliente: ${r.servidor(d.cliente ?? i.cliente_texto)}`, `Modelo: ${r.servidor(d.modelo ?? i.modelo_texto)}`, `Precio nuevo: ${r.pesos(BigInt(i.precio_centavos))}`);
      break;
    case 'acta_propuesta':
      l.push(`Periodo: ${r.citaUsuario(i.mes ?? 'el mes anterior')}`);
      for (const [k, v] of Object.entries(i)) if (k.endsWith('_centavos') && typeof v === 'number') l.push(`${k.startsWith('retira') ? 'Retira' : 'Reinvierte'} ${k.includes('angelo') ? 'Angelo' : 'Javier'}: ${r.pesos(BigInt(v))}`);
      l.push('Las cifras del acta las calcula la base. Despues la firma CADA socio, personalmente, desde su Telegram.');
      break;
    case 'acta_firma':
      l.push(`Acta: ${r.citaUsuario(i.acta_folio ?? 'la pendiente de tu firma')}`, 'Firmas con tu propio Telegram; el bot nunca firma por ti.');
      break;
    case 'lote_historico':
      l.push(`Lote: ${r.citaUsuario(i.etiqueta ?? 'sin etiqueta')} (${r.config(i.renglones.length)} renglones, todos con fecha pasada)`);
      i.renglones.forEach((x, n) => {
        const quien = x.tipo === 'cobro' ? `${r.servidor(d.clientesLote?.[String(n)] ?? x.cliente_texto ?? 'cliente')} a ${r.citaUsuario(x.cuenta_texto ?? '')}` : x.socio === 'angelo' ? 'Angelo' : 'Javier';
        const decl = x.tipo === 'aportacion' ? (x.intencion === 'capital' ? ' [declaro capital]' : ' [sin declarar capital: reembolso]') : '';
        l.push(`- ${r.citaUsuario(x.fecha)} ${x.tipo} ${quien} ${r.pesos(BigInt(x.monto_centavos))}${x.concepto ? ` (${r.citaUsuario(x.concepto)})` : ''}${decl}`);
      });
      break;
    case 'pedido_menudeo':
      l.push(`Proveedor de origen: ${i.proveedor_origen === 'isaac_directo' ? 'Isaac' : i.proveedor_origen === 'karen_via_isaac' ? 'Karen via Isaac' : 'Karen'}`, ...lineasDe(i.lineas));
      l.push(i.fecha_compromiso ? `Fecha comprometida de pago: ${r.servidor(formatearFechaPago(i.fecha_compromiso, i.hora_compromiso ?? null))}` : 'Fecha comprometida de pago: ninguna (quedara como pedido sin fecha comprometida, con alerta)');
      l.push('Es un pedido a costo para ti: sin utilidad y sin destinatario. Los datos de entrega se capturan en la web, nunca por Telegram.');
      break;
    case 'pago_pedido_menudeo':
      l.push(`Pedido: ${r.citaUsuario(i.pedido_folio ?? '')}`, monto(i.monto_centavos ?? 0), `Metodo: ${i.metodo ?? 'transferencia (por omision)'}`, `Se pago: ${i.via === 'sociedad' ? 'abono a la sociedad' : 'directo al proveedor'}`);
      if (i.referencia !== null) l.push(`Referencia: ${r.citaUsuario(i.referencia)}`);
      if (i.fecha_pago) l.push(`Fecha del pago: ${r.servidor(formatearFechaPago(i.fecha_pago, null).replace(' (sin hora)', ''))}`);
      l.push('Si mandaste el comprobante (foto) justo antes, se guarda solo como evidencia (su huella): nadie lo lee. Sin comprobante queda como Pago reportado hasta que el otro socio lo confirme.');
      break;
    default:
      break;
  }
  if (d.efecto) {
    if (d.efecto.lineas.length > 0) l.push('Efecto calculado por el sistema:', ...listar(r, d.efecto.lineas));
    // Lo que la base registraria (leido de sus filas, no de una plantilla).
    for (const c of d.efecto.clasificaciones ?? []) l.push(`El sistema lo registrara como ${c.clasificacion === 'capital' ? 'CAPITAL' : 'reembolso (cuenta por pagar al socio)'}: ${r.pesos(BigInt(c.montoCent))} de ${r.servidor(c.socio)}`);
    for (const a of d.efecto.advertencias) l.push(`Aviso: ${r.servidor(a)}`);
    l.push(d.efecto.cuadra ? 'Cuadre por dos vias despues de registrar: cuadra (debe = haber y saldos de socios = efectivo repartido).' : `Cuadre por dos vias despues de registrar: NO cuadra (${r.servidor(d.efecto.rojas.join('; '))}).`);
  }
  if (d.reversa !== undefined) l.push(TEXTO_REVERSA[d.reversa]);
  if (d.reforzada) l.push('Pedire una segunda confirmacion antes de registrar.');
  l.push(`Confirma con el boton o cancela. La tarjeta caduca en ${r.config(d.horas)} horas.`);
  return { texto: l.join('\n'), registro: r };
}

// ------------------------------------------------------------------ igualacion de aportaciones (cifras de la base; sin lenguaje de deuda)

/** "Javier lleva $47,921.91 más aportado; el siguiente pago le toca a Angelo." o "Aportaciones igualadas." Los datos son los que entrego la base. */
export function comentarioIgualacion(ig: Igualacion): MensajeListo {
  const r = new RegistroCifras();
  if (ig.igualados || ig.leTocaAportar === null || ig.llevaMas === null) return { texto: 'Aportaciones igualadas.', registro: r };
  return { texto: `${r.servidor(ig.llevaMas)} lleva ${r.pesos(ig.diferenciaCent)} más aportado; el siguiente pago le toca a ${r.servidor(ig.leTocaAportar)}.`, registro: r };
}

// ------------------------------------------------------------------ menudeo: fecha comprometida, comprobantes, decision del otro socio y recordatorios

export function preguntaCuandoPagas(): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor('¿Cuándo pagas este pedido? Escribe la fecha y la hora, por ejemplo «el viernes», «mañana a las 5 de la tarde» o «20 de noviembre». Si todavía no hay fecha, escribe «sin fecha». (Hora de Mérida.)'), registro: r };
}

export function fechaObligatoria(): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor('Todo pedido necesita fecha de pago, y no lo registro sin ella. Dime cuándo paga, por ejemplo «el viernes», «mañana a las 5 de la tarde» o «20 de noviembre». (Hora de Mérida.)'), registro: r };
}

export function preguntaPlazoPedido(): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor('Falta el plazo de pago de este pedido, y no lo registro sin él. ¿Es de contado o a cuántos días paga? Escribe por ejemplo «de contado», «a 15 días» o «el viernes».'), registro: r };
}

export function plazoNoEntendido(): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor('No entendí el plazo. Dime «de contado», un número de días (por ejemplo «a 15 días», de 1 a 365) o una fecha como «el viernes».'), registro: r };
}

export function preguntaCuandoReprogramas(folio: string): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `¿Para cuándo reprogramas el pago del pedido ${r.folio(folio)}? ${r.servidor('Escribe la fecha y la hora, por ejemplo «el lunes» o «mañana a las 10 de la mañana». (Hora de Mérida.)')}`, registro: r };
}

export function fechaNoEntendida(motivo: 'no_entendi' | 'pasada' | 'futura'): MensajeListo {
  const r = new RegistroCifras();
  const texto = motivo === 'pasada' ? 'Esa fecha ya pasó. Dime una fecha que todavía no llegue, por ejemplo «el viernes» o «mañana a las 5 de la tarde».'
    : motivo === 'futura' ? 'La fecha de un pago no puede ser futura. Dime cuándo fue, por ejemplo «ayer» o «10 de noviembre».'
      : 'No entendí la fecha. Dime por ejemplo «el viernes», «mañana a las 5 de la tarde» o «20 de noviembre».';
  return { texto: r.servidor(texto), registro: r };
}

export function fechaAmbigua(motivo: 'am_pm' | 'dia'): MensajeListo {
  return { texto: motivo === 'am_pm' ? 'La hora puede ser de la mañana o de la tarde. Elige cuál es; no registro nada todavía.' : 'Ese día de la semana es hoy: elige si es hoy o la semana siguiente; no registro nada todavía.', registro: new RegistroCifras() };
}

export function textoOpcionFecha(o: OpcionFecha): string {
  return formatearFechaPago(o.fecha, o.hora);
}

export function soloSocioMenudeo(socio: 'angelo' | 'javier'): MensajeListo {
  const nombre = NOMBRE[socio];
  const otro = socio === 'angelo' ? 'Javier' : 'Angelo';
  return { texto: `Solo ${nombre}, que lleva el menudeo, mete pedidos a costo y avisa sus pagos. ${otro} los supervisa y confirma o rechaza los pagos reportados. No ejecuté nada.`, registro: new RegistroCifras() };
}

export function comprobanteGuardado(): MensajeListo {
  const r = new RegistroCifras();
  return { texto: r.servidor('Guardé el comprobante solo como evidencia (su huella; nadie lo lee ni lo ve la IA). Ahora avisa el pago con /pagopedido P-0001 | monto, o escríbelo con tus palabras, y lo asocio (vale 30 minutos).'), registro: r };
}

export function confirmarReprogramacion(folio: string, fecha: string, hora: string | null): MensajeListo {
  const r = new RegistroCifras();
  return { texto: `¿Reprogramo el pago del pedido ${r.folio(folio)} para el ${r.servidor(formatearFechaPago(fecha, hora))}? Queda en el historial de reprogramaciones.`, registro: r };
}

const NOMBRE_PERSONA = (p: string): string => (p === 'angelo' ? 'Angelo' : p === 'javier' ? 'Javier' : p);

/** Tarjeta para el OTRO socio: pago reportado de un pedido de menudeo. Confirma recibido o rechaza con botones. */
export function tarjetaPagoReportado(e: { folio: string; reportadoPor: string; monto: bigint | null; aplicado: boolean; pendiente: bigint | null; conComprobante: boolean }): MensajeListo {
  const r = new RegistroCifras();
  const l = [`Pago reportado por ${r.servidor(NOMBRE_PERSONA(e.reportadoPor))} del pedido ${r.folio(e.folio)}${e.monto === null ? '' : `: ${r.pesos(e.monto)}`}.`];
  l.push(e.aplicado
    ? `Pago aplicado con comprobante; puedes rechazarlo${e.conComprobante ? ' (el comprobante se guardó solo como huella)' : ''}.`
    : 'Todavía NO está aplicado: el pedido sigue pendiente de pago hasta que lo confirmes. Confirma si ya lo recibiste o recházalo.');
  if (e.pendiente !== null) l.push(`Pendiente de pago del pedido: ${r.pesos(e.pendiente)}`);
  return { texto: l.join('\n'), registro: r };
}

export function ecoDecisionPago(e: { folio: string; decision: 'confirmado' | 'rechazado'; por: string; pendiente: bigint | null }): MensajeListo {
  const r = new RegistroCifras();
  const l = [`Pago del pedido ${r.folio(e.folio)} ${e.decision === 'confirmado' ? 'confirmado como recibido' : 'rechazado'} por ${r.servidor(NOMBRE_PERSONA(e.por))}.`];
  if (e.pendiente !== null) l.push(`Pendiente de pago del pedido: ${r.pesos(e.pendiente)}`);
  return { texto: l.join('\n'), registro: r };
}

const ETIQUETA_RECORDATORIO: Readonly<Record<'por_vencer' | 'vence_hoy' | 'vencido', string>> = {
  por_vencer: 'vence pronto',
  vence_hoy: 'vence hoy',
  vencido: 'ya venció',
};

/** Recordatorio de pago al GRUPO de socios (nunca a terceros). Solo folio, socio, proveedor, monto pendiente y fechas: ningun dato de clientes ni de entrega. */
export function recordatorioPago(f: RecordatorioMenudeo & { tipo: 'por_vencer' | 'vence_hoy' | 'vencido' }): MensajeListo {
  const r = new RegistroCifras();
  const l = [`Recordatorio de pago: el pedido ${r.folio(f.folio)} de ${r.servidor(NOMBRE_PERSONA(f.socio.toLowerCase()))} con ${r.servidor(f.proveedor)} ${ETIQUETA_RECORDATORIO[f.tipo]}.`];
  l.push(`Pendiente de pago: ${r.pesos(f.pendienteCent)}`);
  if (f.fechaCompromiso !== null) l.push(`Fecha comprometida: ${r.servidor(formatearFechaPago(f.fechaCompromiso, f.horaCompromiso))}`);
  if (f.tipo === 'vencido' && f.diasAtraso > 0) l.push(`Días de atraso: ${r.config(f.diasAtraso)}`);
  if (f.tipo !== 'por_vencer') l.push('¿Ya pagaste?');
  return { texto: l.join('\n'), registro: r };
}

export function ecoRespuestaRecordatorio(e: { folio: string; accion: 'pagado' | 'posponer'; fecha?: string; hora?: string | null }): MensajeListo {
  const r = new RegistroCifras();
  return { texto: e.accion === 'pagado' ? `Pago del pedido ${r.folio(e.folio)} reportado: falta que el otro socio lo confirme.` : `Pago del pedido ${r.folio(e.folio)} reprogramado para el ${r.servidor(formatearFechaPago(e.fecha ?? '', e.hora ?? null))}.`, registro: r };
}
