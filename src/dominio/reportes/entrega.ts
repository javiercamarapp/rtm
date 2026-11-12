// Textos de entrega (spec 16, sec. 8): resumen corto de Telegram (maximo 900 caracteres, con cifras, al grupo de socios) y correo SIN cifras
// sensibles (asunto y cuerpo). Todo pasa por la guardia de numeros. Omar nunca es destinatario de estos textos.
import { etiquetaRango } from '../formato';
import { variacionTexto, pesosEnteros } from './formato';
import { renderizarVerificado } from './paginas';
import type { Paquete } from './paquete';
import { PARAMETROS } from './parametros';
import { resumenComprobaciones } from './estado';

const M = (id: string, mod?: string): string => `{{cifra:${id}${mod ? `|${mod}` : ''}}}`;
const tiene = (p: Paquete, id: string): boolean => p.cifras.some((c) => c.id === id && c.estado === 'ok');
const valor = (p: Paquete, id: string): bigint => p.cifras.find((c) => c.id === id)!.valor;

const NOMBRE_ESTADO: Record<string, string> = { DEFINITIVO: 'Definitivo', PRELIMINAR: 'Preliminar', PARCIAL: 'Parcial' };

function rangoCorto(p: Paquete): string {
  return p.tipo === 'semanal' ? etiquetaRango(p.periodo.inicio, p.periodo.fin) : p.periodo.etiqueta;
}

/** Resumen corto para el grupo de socios; el PDF va adjunto. Recorta por abajo hasta caber en el limite. */
export function construirTelegram(p: Paquete): string {
  const { ok, total } = resumenComprobaciones(p.comprobaciones);
  const estado = p.estado.etiquetas.join(' · ');
  const falla = p.estado.fallas.length ? ` · falla: ${p.estado.fallas.join(', ')}` : '';
  const lineas: string[] = [`Reporte ${p.tipo} ${rangoCorto(p)} · ${estado} · ${ok} de ${total} comprobaciones${falla}`];
  const ref = p.tipo === 'semanal' ? 'el promedio de cuatro semanas' : 'el mes anterior';
  const idUtil = p.tipo === 'mensual' && tiene(p, 'res.utilidadNeta') ? 'res.utilidadNeta' : 'contrib';
  const nombreUtil = idUtil === 'contrib' ? 'Utilidad de contribución' : 'Utilidad neta';
  const comp = tiene(p, 'varContrib') ? ` (${variacionTexto(valor(p, 'varContrib'))} que ${ref})` : '';
  lineas.push(`${nombreUtil}: ${M(idUtil)}${comp}`);
  lineas.push(`Ventas ${M('ventas')} · ${M('piezas')}${tiene(p, 'contribPz') ? ` · ${M('contribPz')} por pieza` : ''}`);
  if (tiene(p, 'age.total')) lineas.push(`Por cobrar ${M('age.total')}${tiene(p, 'age.vencidaPct') ? ` (${M('age.vencidaPct')} con más de treinta días)` : ''}`);
  if (tiene(p, 'liq.porPagar')) lineas.push(`Por pagar al proveedor el viernes: ${M('liq.porPagar')}${tiene(p, 'liq.cobertura') ? ` · cobertura ${M('liq.cobertura')}` : ''}`);
  const h = p.insights.insights.find((i) => !i.hipotesis);
  if (h) lineas.push(`Hallazgo: ${h.frase}`);
  p.insights.recomendaciones.slice(0, 3).forEach((r, i) => lineas.push(`Acción ${i + 1}: ${r.titulo}`));
  const pie = `PDF adjunto · huella ${p.huella}`;
  const armar = (ls: string[]) => renderizarVerificado(p, [...ls, pie].join('\n'));
  let texto = armar(lineas);
  // Recorta de abajo hacia arriba (acciones, hallazgo) manteniendo cabecera y primeras cifras.
  while (texto.length > PARAMETROS.maxCaracteresTelegram && lineas.length > 3) {
    lineas.pop();
    texto = armar(lineas);
  }
  return texto;
}

/** Aviso de una linea cuando el reporte no sale (falla una comprobacion bloqueante). */
export function construirAvisoNoSale(p: Paquete): string {
  const partes: string[] = [];
  const extra: string[] = [];
  for (const id of p.estado.bloqueantes) {
    const c = p.comprobaciones.find((x) => x.id === id);
    if (c && c.unidad === 'cent') {
      const dif = c.via1 > c.via2 ? c.via1 - c.via2 : c.via2 - c.via1;
      partes.push(`${id} difiere ${pesosEnteros(dif)}`);
      extra.push(pesosEnteros(dif));
    } else partes.push(`falla ${id}`);
  }
  return renderizarVerificado(p, `El reporte ${p.tipo} no salió: ${partes.join('; ')}. Corrijan y escriban 'reintentar reporte'.`, extra);
}

export interface Correo {
  readonly asunto: string;
  readonly cuerpo: string;
}

/** Correo para los dos dueños (nunca para Omar), sin cifras sensibles: solo periodo, estado, conteos y huella. */
export function construirCorreo(p: Paquete): Correo {
  const { ok, total } = resumenComprobaciones(p.comprobaciones);
  const est = p.estado.etiquetas.map((e) => NOMBRE_ESTADO[e]!).join(' · ');
  const prefijo = p.estado.etiquetas.filter((e) => e !== 'DEFINITIVO').map((e) => `[${e}] `).join('');
  const anio = p.periodo.fin.slice(0, 4);
  const asuntoPeriodo = p.tipo === 'semanal' ? `${etiquetaRango(p.periodo.inicio, p.periodo.fin).replace(' a ', ' al ')} ${anio}` : p.periodo.etiqueta;
  const asunto = renderizarVerificado(p, `${prefijo}RTM · Reporte ${p.tipo} · ${asuntoPeriodo} · ${est}`);
  const nRec = Math.min(3, p.insights.recomendaciones.length);
  const lineas = [`El reporte ${p.tipo} ${p.tipo === 'semanal' ? 'del' : 'de'} ${p.periodo.etiqueta} está listo: ábrelo con tu sesión en el enlace de abajo (el correo no lleva archivo adjunto).`, `Estado: ${est.toLowerCase()}.`, `Comprobaciones: ${ok} de ${total}.`, `Hay ${nRec} recomendaciones en la primera página.`, `Huella: ${p.huella}.`];
  if (p.estado.fallas.length) lineas.push(`No lo uses para decidir: falla la comprobación ${p.estado.fallas.join(', ')}.`);
  return { asunto, cuerpo: renderizarVerificado(p, lineas.join(' '), [String(nRec)]) };
}
