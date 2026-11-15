// Redaccion de los avisos de inventario, compras, proveedores, clientes y pedidos que el bot manda AL GRUPO DE LOS SOCIOS (nunca a clientes, proveedores ni Omar).
// Cada cifra viene de SQL (agente.avisos_digest_armar); aqui solo se extraen campos y se da formato. Nada calcula dinero. Espanol neutro, sin emojis;
// marcas, modelos y sabores en MAYUSCULAS; el importe de un proveedor jamas aparece (solo sentido y porcentaje entero).
import { formatearMoneda } from '@/dominio/formato';

export type VentanaAviso = 'I' | 'M' | 'R' | 'S';

export interface ItemAviso {
  id: number;
  codigo: string;
  canal: VentanaAviso;
  severidad: 'C' | 'I' | 'F';
  payload: Record<string, unknown>;
}

export interface DigestArmado {
  estado: 'ok' | 'apagado' | 'fusionado' | 'sin_fusion';
  items: ItemAviso[];
  restantes: number;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const U = (v: unknown): string => s(v).toUpperCase();
const pz = (v: unknown): string => `${n(v)} pz`;
const cent = (v: unknown): string => formatearMoneda(BigInt(Math.round(n(v))));
const plural = (c: number, uno: string, varios: string): string => (c === 1 ? uno : varios);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => s(x)) : []);
const fechaCorta = (v: unknown): string => {
  const t = s(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
};

/** Hora de Merida (UTC-6 sin horario de verano). */
export function horaMerida(ahora: Date): { hora: number; diaSemana: number } {
  const d = new Date(ahora.getTime() - 6 * 3_600_000);
  return { hora: d.getUTCHours(), diaSemana: d.getUTCDay() };
}

/** Ventanas que corresponden a este instante: los inmediatos en cada pasada; pendientes a las 09, resumen a las 20 y semanal el lunes a las 07 (la hora entera: repetir no duplica porque lo enviado sale de la cola). */
export function ventanasDelMomento(ahora: Date): VentanaAviso[] {
  const { hora, diaSemana } = horaMerida(ahora);
  const v: VentanaAviso[] = ['I'];
  if (hora === 9) v.push('M');
  if (hora === 20) v.push('R');
  if (diaSemana === 1 && hora === 7) v.push('S');
  return v;
}

const TITULO: Record<VentanaAviso, string> = { I: 'Aviso', M: 'Pendientes de hoy', R: 'Resumen del dia', S: 'Semanal' };

function lineaItem(it: ItemAviso): string | null {
  const p = it.payload;
  switch (it.codigo) {
    case 'inv_agotado':
      return `Agotado: ${U(p['modelo'])} ${U(p['sabor'])} (vendio ${pz(p['vendidas_ventana'])} en 28 dias y no hay compra en camino).`;
    case 'oc_llega':
      return `${p['es_hoy'] === true ? 'Hoy' : 'Manana'} llega ${s(p['folio'])} de ${s(p['proveedor'])} (${pz(p['piezas'])}). Prepara el conteo de recepcion con Omar.`;
    case 'oc_atraso': {
      const d = n(p['dias_atraso']);
      return p['sin_fecha'] === true
        ? `${s(p['folio'])} de ${s(p['proveedor'])} lleva ${d} ${plural(d, 'dia', 'dias')} mas del plazo habitual y no tiene fecha de llegada. Valor pagado ${cent(p['valor_cent'])}.`
        : `${s(p['folio'])} de ${s(p['proveedor'])} lleva ${d} ${plural(d, 'dia', 'dias')} de atraso (esperada el ${fechaCorta(p['esperada'])}). Valor pagado ${cent(p['valor_cent'])}.`;
    }
    case 'oc_sin_fecha':
      return `${s(p['folio'])} (${s(p['proveedor'])}, ${pz(p['piezas'])}) no tiene fecha de ${s(p['falta'])}. Sin ella no hay aviso de llegada ni de atraso: responde con la fecha o usa /enviada ${s(p['folio'])}.`;
    case 'oc_faltante':
      return p['tipo'] === 'parcial'
        ? `${s(p['folio'])} (${s(p['proveedor'])}): llegaron partes y faltan ${pz(p['piezas'])} por recibir; la ultima recepcion fue hace ${n(p['dias'])} dias.`
        : `${s(p['folio'])} (${s(p['proveedor'])}): faltan ${pz(p['piezas'])} por reclamar (${cent(p['valor_cent'])}); abierto hace ${n(p['dias'])} dias${p['antigua'] === true ? ' (antiguo)' : ''}.`;
    case 'oc_llego': {
      const nuevos = Array.isArray(p['sabores_nuevos']) ? (p['sabores_nuevos'] as Array<Record<string, unknown>>) : [];
      const repone = lista(p['repone']);
      const partes = [`Llego ${s(p['folio'])} (${s(p['proveedor'])}): ${pz(p['recibidas'])} de ${pz(p['facturadas'])}${p['parcial'] === true ? ', recepcion parcial' : ''}.`];
      if (nuevos.length > 0) partes.push(`${nuevos.length} ${plural(nuevos.length, 'sabor nuevo', 'sabores nuevos')} para el catalogo propio: ${nuevos.slice(0, 6).map((x) => `${U(x['modelo'])} ${U(x['sabor'])} ${n(x['piezas'])}`).join(', ')}.`);
      if (repone.length > 0) partes.push(`Salen de reposicion: ${repone.map((x) => x.toUpperCase()).join(', ')}.`);
      partes.push(n(p['diferencias']) > 0 ? `Diferencias abiertas: ${n(p['diferencias'])}.` : 'Diferencias: ninguna.');
      return partes.join(' ');
    }
    case 'prv_llego': {
      const sab = lista(p['sabores']).map((x) => x.toUpperCase());
      return `${U(p['modelo'])} (puesto ${n(p['posicion'])} en ventas, ${pz(p['piezas_28d'])} en 28 dias): ${p['modelo_nuevo'] === true ? 'regreso o llego con ' : 'llegaron sabores con '}${s(p['proveedor'])}${sab.length > 0 ? `: ${sab.join(', ')}` : ''}.`;
    }
    case 'prv_costo': {
      const bajo = n(p['clientes_bajo_minimo']);
      return `Costo de lista de ${s(p['proveedor'])} para ${U(p['modelo'])} ${s(p['sentido'])} cerca de ${n(p['pct'])} por ciento (registrado por un socio). ${bajo > 0 ? `Con el tabulador actual, ${bajo} ${plural(bajo, 'cliente queda', 'clientes quedan')} por debajo de ${n(p['margen_min_pct'])} por ciento de margen (el peor, ${n(p['peor_margen_pct'])} por ciento). Revisa precios.` : 'Ningun cliente queda bajo el margen minimo.'} El sistema no cambia costos ni precios solo.`;
    }
    case 'prv_puente':
      return s(p['texto']) === '' ? null : s(p['texto']);
    case 'prv_lista': {
      const c = n(p['cambios']);
      return `La lista cargada de ${s(p['proveedor'])} trae ${c} ${plural(c, 'cambio', 'cambios')}: ${lista(p['modelos_nuevos']).length} modelos nuevos, ${lista(p['modelos_ausentes']).length} ausentes, ${lista(p['sabores_nuevos']).length} sabores nuevos y ${Array.isArray(p['costos']) ? (p['costos'] as unknown[]).length : 0} costos distintos. Revisalos en la web.`;
    }
    case 'cli_sin_comprar':
      return `${s(p['cliente'])} lleva ${n(p['dias'])} dias sin comprar (su intervalo habitual es de ${n(p['intervalo'])} dias; ${n(p['pedidos'])} pedidos en 90 dias).`;
    case 'cli_vencido_pide':
      return `${s(p['cliente'])} tiene ${cent(p['vencido_cent'])} vencidos (hasta ${n(p['dias_vencido'])} dias) y acaba de pedir ${pz(p['piezas'])} (${cent(p['importe_cent'])}), pedido ${s(p['folio'])}. Confirma si se surte.`;
    case 'cli_concentracion':
      return `Cartera concentrada: ${s(p['cliente'])} tiene ${n(p['pct_top1'])} por ciento de lo que se debe (${cent(p['cartera_cent'])} en total); los dos primeros suman ${n(p['pct_top2'])} por ciento.${p['ventas_top_pct'] === null || p['ventas_top_pct'] === undefined ? '' : ` En ventas de 28 dias, ${s(p['ventas_top_cliente'])} lleva ${n(p['ventas_top_pct'])} por ciento.`}`;
    case 'cli_pago_dup':
      return `Posible pago duplicado de ${s(p['cliente'])}: ${cent(p['monto_cent'])} en ${s(p['folio'])} y en ${s(p['folio_previo'])}, misma cuenta y menos de 48 horas. Confirma si es otro pago.`;
    case 'din_descuento':
      return `Descuento inusual en ${s(p['folio'])} (${s(p['cliente'])}): ${cent(p['descuento_cent'])}, cerca de ${n(p['pct'])} por ciento del importe.`;
    default:
      return null;
  }
}

/** Lineas agrupadas (mas de un sabor del mismo modelo, pedidos pendientes por etapa) para no mandar un mensaje por renglon. */
function lineasAgrupadas(items: ItemAviso[]): string[] {
  const out: string[] = [];
  const repo = items.filter((i) => i.codigo === 'inv_reponer');
  const porModelo = new Map<string, ItemAviso[]>();
  for (const i of repo) porModelo.set(U(i.payload['modelo']), [...(porModelo.get(U(i.payload['modelo'])) ?? []), i]);
  for (const [modelo, g] of porModelo) {
    const estimado = g.some((i) => i.payload['estado'] === 'estimado');
    const det = g.map((i) => {
      const p = i.payload;
      const base = `${U(p['sabor'])} ${pz(p['disponible'])}`;
      const extra = [p['dias'] !== null && p['dias'] !== undefined && p['estado'] === 'firme' ? `${n(p['dias'])} dias de venta` : '', n(p['transito']) > 0 ? `en camino ${pz(p['transito'])}${p['llega'] ? `, llega ${fechaCorta(p['llega'])}` : ''}` : '', p['estado'] === 'estimado' && p['minimo'] !== null ? `minimo ${pz(p['minimo'])}` : '']
        .filter((x) => x !== '').join('; ');
      return extra === '' ? base : `${base} (${extra})`;
    });
    out.push(`Reposicion ${modelo}: ${det.join(', ')}.${estimado ? ' Estimado: todavia no hay 28 dias de historia; se usa el minimo que fijaron los socios.' : ''}`);
  }
  const ped = items.filter((i) => i.codigo === 'ped_pendiente_envio');
  for (const etapa of ['empacar', 'enviar'] as const) {
    const g = ped.filter((i) => i.payload['etapa'] === etapa);
    if (g.length > 0) out.push(`${g.length} ${plural(g.length, 'pedido por', 'pedidos por')} ${etapa === 'empacar' ? 'empacar' : 'enviar'}: ${g.map((i) => `${s(i.payload['folio'])} (${pz(i.payload['piezas'])}, ${n(i.payload['horas'])} h)`).join(', ')}.`);
  }
  const guias = items.filter((i) => i.codigo === 'ped_guia_pendiente');
  if (guias.length > 0) out.push(`${guias.length} ${plural(guias.length, 'pedido enviado sin guia', 'pedidos enviados sin guia')}: ${guias.map((i) => `${s(i.payload['folio'])} (${s(i.payload['paqueteria'])})`).join(', ')}. Captura las guias en lote.`);
  const ent = items.filter((i) => i.codigo === 'ped_sin_entrega');
  if (ent.length > 0) out.push(`${ent.length} ${plural(ent.length, 'pedido enviado sin entrega confirmada', 'pedidos enviados sin entrega confirmada')}: ${ent.map((i) => `${s(i.payload['folio'])} (${n(i.payload['dias'])} dias)`).join(', ')}. Confirma con /entregado.`);
  return out;
}

const AGRUPADOS: ReadonlySet<string> = new Set(['inv_reponer', 'ped_pendiente_envio', 'ped_guia_pendiente', 'ped_sin_entrega']);

/** Un solo mensaje por ventana. Null si no hay nada que decir. Con restantes > 0 avisa que el resto sale en el siguiente. */
export function redactarMensaje(ventana: VentanaAviso, items: ItemAviso[], restantes = 0): string | null {
  if (items.length === 0) return null;
  const lineas = [...lineasAgrupadas(items)];
  for (const it of items) {
    if (AGRUPADOS.has(it.codigo)) continue;
    const l = lineaItem(it);
    if (l) lineas.push(l);
  }
  if (lineas.length === 0) return null;
  const cuerpo = lineas.length === 1 && ventana === 'I' ? lineas[0]! : lineas.map((l, i) => `${i + 1}. ${l}`).join('\n');
  const pie = restantes > 0 ? `\nY ${restantes} ${plural(restantes, 'aviso mas', 'avisos mas')} en el siguiente resumen.` : '';
  return `${TITULO[ventana]}\n${cuerpo}${pie}`;
}
