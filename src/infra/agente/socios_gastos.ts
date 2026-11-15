// Carril SOCIOS Y GASTOS (infra): traduce las intenciones de dinero entre socios, renta de Omar, gasto de caja y firma del acta a las indicaciones de agente.ejecutar_ext,
// interpreta lo que la base contesto (pregunta de anticipo, retiro de capital en dos pasos, firmas del acta) y lee los saldos de ambos socios y el ticket del gasto.
// Aqui NO se calcula ningun importe: los montos son los que el socio escribio (validados contra su mensaje) y todo lo demas lo calcula SQL.
import type { Intencion } from '@/dominio/agente/intenciones';
import { centavosABigint } from '@/dominio/operacion/json';
import type { ResultadoNegocio } from '@/aplicacion/agente/puertos';
import type { CifraServidor } from '@/dominio/agente/tipos';
import type { VistaSaldosSocios } from '@/aplicacion/agente/socios_gastos';
import type { Sql } from '@/infra/postgres/servidor';

const fn = (sql: Sql, nombre: string, args: readonly unknown[] = [], casts: readonly string[] = []) => {
  const marcas = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ''}`).join(', ');
  return sql<{ j: unknown }>(`select agente.${nombre}(${marcas}) as j`, args).then((r) => r[0]?.j);
};

export type PreparadaSocios = { hub: 'ejecutar_ext'; tipo: string; args: Record<string, unknown>; titulo: string };

const nombre = (s: string): string => (s === 'angelo' ? 'Angelo' : s === 'javier' ? 'Javier' : s === 'isaac' ? 'Isaac' : s === 'karen' ? 'Karen' : s === 'sociedad' ? 'la sociedad' : s);
const CATEGORIA_GASTO: Record<string, string> = { guia: 'guia_envio', envio: 'mensajeria', uber: 'uber', comision_terminal: 'terminal', servicio: 'servicio', otro: 'otro' };

/** null = esta intencion no es de este carril. `base` ya trae autor, telegram_user_id, origen y las banderas de los frenos. `cita` es el mensaje real del socio. */
export function prepararSocios(i: Intencion, base: Record<string, unknown>, cita: string | undefined): PreparadaSocios | null {
  switch (i.tipo) {
    case 'entrega_fondos':
      return { hub: 'ejecutar_ext', tipo: 'entrega_fondos', titulo: `Entrega de fondos de ${nombre(i.socio)} a ${nombre(i.destino)} registrada`, args: { ...base, socio: i.socio, destino: i.destino, monto_cent: i.monto_centavos, via: i.via } };
    case 'liquidacion_socios':
      return { hub: 'ejecutar_ext', tipo: 'liquidacion_socios', titulo: `Liquidación de ${nombre(i.de_socio)} a ${nombre(i.a_socio)} registrada`, args: { ...base, de_socio: i.de_socio, a_socio: i.a_socio, monto_cent: i.monto_centavos, via: i.via } };
    case 'retiro_capital':
      return { hub: 'ejecutar_ext', tipo: 'retiro_capital', titulo: `Retiro de capital de ${nombre(i.socio)}`, args: { ...base, socio: i.socio, monto_cent: i.monto_centavos } };
    case 'renta_omar':
      return { hub: 'ejecutar_ext', tipo: 'renta_omar', titulo: 'Pago de la renta de Omar registrado', args: { ...base, pagado_por: i.pagado_por, monto_cent: i.monto_centavos, via: i.via, nota: i.nota } };
    case 'gasto':
      // Gasto pagado con el efectivo de la sociedad (caja): un gasto de la empresa sin reembolso a nadie.
      return i.pagado_por === 'sociedad'
        ? { hub: 'ejecutar_ext', tipo: 'gasto_caja', titulo: `Gasto de caja registrado (${i.gasto})`, args: { ...base, monto_cent: i.monto_centavos, categoria: CATEGORIA_GASTO[i.gasto] ?? 'otro', nota: i.descripcion } }
        : null;
    case 'acta_firma':
      // La firma del acta es de cada socio con su PROPIO mensaje: el texto real del socio queda registrado en SQL (sin boton generico).
      return { hub: 'ejecutar_ext', tipo: 'acta_confirmar', titulo: 'Firma del acta registrada', args: { ...base, cierre_folio: i.acta_folio, confirmacion_texto: cita ?? i.fuente_cita } };
    default:
      return null;
  }
}

/** Respuestas de la base que no son un registro: el pago de renta mayor a lo que se debe se PREGUNTA (anticipo), no se topa. */
export function respuestaDeSocios(j: Record<string, unknown>): ResultadoNegocio | null {
  if (j.pregunta_exceso_renta === true) {
    const monto = BigInt(j.monto_cent as number);
    const debe = BigInt(j.debe_cent as number);
    const cifras: CifraServidor[] = [{ tipo: 'pesos', etiqueta: 'Pago dicho', centavos: monto }, { tipo: 'pesos', etiqueta: 'Lo que se debe a Omar de renta', centavos: debe }];
    return { tipo: 'pregunta', motivo: 'cobro_mayor_a_lo_que_debe', clave: 'exceso', texto: 'El pago es mayor que la renta que se debe a Omar. ¿Es un anticipo a su favor?', cifras };
  }
  return null;
}

/** Lineas del resultado propias de este carril (todo viene de la base). */
export function lineasSocios(tipo: string, j: Record<string, unknown>): CifraServidor[] {
  const l: CifraServidor[] = [];
  const pesos = (k: string, etiqueta: string) => { if (typeof j[k] === 'number') l.push({ tipo: 'pesos', etiqueta, centavos: BigInt(j[k] as number) }); };
  if (tipo === 'renta_omar') {
    pesos('saldo_antes_cent', 'Renta por pagar antes');
    pesos('saldo_despues_cent', 'Renta por pagar después');
    pesos('exceso_cent', 'Anticipo a favor de Omar');
  }
  if (tipo === 'retiro_capital' && typeof j.modo === 'string') l.push({ tipo: 'texto', etiqueta: 'Estado', texto: j.modo === 'propuesto' ? 'Propuesto: falta que el otro socio lo confirme con su propio mensaje' : 'Confirmado por el segundo socio' });
  if (tipo === 'acta_confirmar') {
    if (typeof j.acta === 'string') l.push({ tipo: 'folio', etiqueta: 'Acta', folio: j.acta });
    if (typeof j.faltan_firmas === 'number') l.push({ tipo: 'texto', etiqueta: 'Firmas', texto: j.faltan_firmas === 0 ? 'Firmada por los dos: el corte queda cerrado' : 'Falta la firma del otro socio (con su propio mensaje)' });
  }
  if (tipo === 'entrega_fondos' && typeof j.destino === 'string') l.push({ tipo: 'texto', etiqueta: 'Destino', texto: nombre(j.destino) });
  pesos('deuda_socio_cent', 'Fondos de la sociedad que aún tiene en su poder');
  return l;
}

/** Ambos saldos y la frase de igualacion (agente.saldos_socios_aviso). */
export async function leerSaldosSocios(sql: Sql): Promise<VistaSaldosSocios> {
  return centavosABigint<VistaSaldosSocios>(await fn(sql, 'saldos_socios_aviso'));
}

/** Liga la ultima foto sin ligar del socio al gasto recien registrado; devuelve el aviso para el grupo (o null si no habia foto). */
export async function ligarTicket(sql: Sql, telegramUserId: number, folio: string): Promise<{ ligada: boolean; duplicada: boolean; gastoPrevio: string | null }> {
  const j = (await fn(sql, 'evidencia_ligar_gasto', [telegramUserId, folio], ['bigint', 'text'])) as { ligada?: boolean; duplicada?: boolean; gasto_previo?: string };
  return { ligada: j.ligada === true, duplicada: j.duplicada === true, gastoPrevio: j.gasto_previo ?? null };
}

/** El cierre mensual en consulta: periodo sugerido, lo disponible para repartir y las actas pendientes de firma (cifras de la base). */
export async function leerCierreMensual(sql: Sql): Promise<{ titulo: string; lineas: CifraServidor[] }> {
  const j = (await fn(sql, 'consulta_cierre_mensual')) as { periodo?: { ini?: string; fin?: string } | null; disponible?: Record<string, unknown> | null; actas_pendientes?: Array<{ folio: string; firmas: number }> };
  const lineas: CifraServidor[] = [];
  if (j.periodo?.ini && j.periodo?.fin) lineas.push({ tipo: 'texto', etiqueta: 'Periodo sugerido', texto: `${j.periodo.ini} a ${j.periodo.fin}` });
  const d = (j.disponible ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(d)) if (k.endsWith('_cent') && typeof v === 'number') lineas.push({ tipo: 'pesos', etiqueta: k.replace(/_cent$/, '').replace(/_/g, ' '), centavos: BigInt(v) });
  for (const a of j.actas_pendientes ?? []) lineas.push({ tipo: 'texto', etiqueta: `Acta ${a.folio}`, texto: a.firmas === 0 ? 'sin firmas' : 'falta la firma del otro socio' });
  if (lineas.length === 0) lineas.push({ tipo: 'texto', etiqueta: 'Cierre mensual', texto: 'Todavía no hay un periodo por cerrar.' });
  return { titulo: 'Cierre mensual', lineas };
}
