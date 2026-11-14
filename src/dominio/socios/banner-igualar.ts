// Banner de igualacion de valuacion (decision del dueno, 14-nov). La base ya calculo cada cifra (api.cuenta_socios_valuacion -> clave `banner`,
// migracion 20261114800000); aqui solo se elige que variante corresponde y se redactan los textos. Nada aqui calcula dinero.
import type { Socio } from './valuacion';

export interface EntregaParcial { fecha: string; monto_cent: bigint }

export interface BannerPorSocio {
  entregar_cent: bigint;
  aportar_cent: bigint;
  /** Dias del tramo mas viejo de fondos aun sin entregar; null si no hay fondos o no hay fecha. */
  dias_fondos: number | null;
  desde: string | null;
  entregado_cent: bigint;
  entrega_total_cent: bigint;
  /** Puntos base (10000 = entregado todo); null si aun no hay entregas desde esa fecha. */
  progreso_bp: number | null;
  entregas: EntregaParcial[];
}

/** Bloque `banner` de la base. `igualados` ya incluye la tolerancia de `tolerancia_cent` (1 centavo: centavo suelto del reparto 50/50). */
export interface BannerIgualacion {
  activo: boolean;
  igualados: boolean;
  exacto: boolean;
  tolerancia_cent: bigint;
  faltan_cent: bigint;
  mayor: Socio | null;
  menor: Socio | null;
  por_socio: Partial<Record<Socio, BannerPorSocio>>;
  /** Fondos que el socio con mas valuacion tambien debe entregar: se netean contra lo que falta. */
  neteo_cent: bigint;
  cuadra: boolean;
  regla: string;
}

type Formato = (c: bigint) => string;
type FormatoFecha = (f: string) => string;

export interface PartidaBanner { id: 'entregar' | 'aportar' | 'reponer'; texto: string; monto: string; montoCent: bigint; href: string }

export interface VistaBanner {
  /** 'repone' = el socio esta por debajo (accion); 'informa' = el otro esta por debajo (sin accion). */
  variante: 'repone' | 'informa';
  /** Rotulo que no depende del color: 'Acción requerida' o 'Para tu información'. */
  rotulo: string;
  titulo: string;
  faltanCent: bigint;
  faltanTexto: string;
  deudor: Socio;
  partidas: PartidaBanner[];
  neteo: string | null;
  antiguedad: string | null;
  entregas: { texto: string; monto: string }[];
  progreso: { pct: number; texto: string } | null;
  /** Por que la entrega no es capital y la aportacion solo lo es si el socio lo declara. */
  explicacion: string;
  /** Rol ARIA: alert si hay accion para quien lo ve, status si es informativo. */
  rol: 'alert' | 'status';
}

export const HREF_ENTREGA = '/cuentas-por-cobrar?vista=socios';
export const HREF_APORTACION = '/socios';

export const EXPLICACION_BANNER =
  'Entregar a la sociedad los fondos que cobraste en tu cuenta personal no es aportación de capital: solo baja los fondos de la sociedad en tu poder y por eso sube tu valuación. '
  + 'Lo que además se aporta es capital únicamente si lo declaras al registrarlo; si no, es reembolso. La regla es igualar valuaciones, no cada partida.';

export function textoAntiguedad(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias <= 0) return 'desde hoy';
  return `desde hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** Variante del banner para quien mira (`yo`; null = socio sin nombre conocido, ve la variante informativa). null = no mostrar nada (igualados o sin dato). */
export function vistaBanner(b: BannerIgualacion | null | undefined, yo: Socio | null, formato: Formato, fecha: FormatoFecha): VistaBanner | null {
  if (!b || !b.activo || !b.menor || !b.mayor) return null;
  const deudor = b.menor;
  const p = b.por_socio[deudor];
  const repone = yo === deudor;
  const quien = repone ? 'tu cuenta personal' : `la cuenta personal de ${deudor}`;
  const partidas: PartidaBanner[] = [];
  if (p && p.entregar_cent > 0n) {
    partidas.push({ id: 'entregar', texto: `Entregar a la sociedad los fondos recibidos en ${quien}`, monto: formato(p.entregar_cent), montoCent: p.entregar_cent, href: HREF_ENTREGA });
  }
  if (p && p.aportar_cent > 0n) {
    partidas.push({ id: 'aportar', texto: 'Aportar a la sociedad', monto: formato(p.aportar_cent), montoCent: p.aportar_cent, href: HREF_APORTACION });
  }
  if (partidas.length === 0) {
    partidas.push({ id: 'reponer', texto: 'Reponer a la sociedad la diferencia', monto: formato(b.faltan_cent), montoCent: b.faltan_cent, href: HREF_APORTACION });
  }
  const falta = formato(b.faltan_cent);
  const titulo = repone
    ? `Debes reponer ${falta} para igualar valuación`
    : `${deudor} debe reponer ${falta} para igualar valuación${partidas.length > 0 && partidas[0]!.id !== 'reponer' ? ` (${partidas.map((x) => `${x.id === 'entregar' ? 'entregar' : 'aportar'} ${x.monto}`).join(' y ')})` : ''}`;
  const otro: Socio = deudor === 'Angelo' ? 'Javier' : 'Angelo';
  const neteo = b.neteo_cent > 0n
    ? `${otro} también tiene ${formato(b.neteo_cent)} de la sociedad por entregar. Las dos entregas se netean: la regla es igualar valuaciones, no cada partida.`
    : null;
  const ant = textoAntiguedad(p?.dias_fondos ?? null);
  const antiguedad = p && p.entregar_cent > 0n && ant ? `Fondos en ${repone ? 'tu' : 'su'} poder ${ant}${p.desde ? ` (${fecha(p.desde)})` : ''}` : null;
  const entregas = (p?.entregas ?? []).map((e) => ({ texto: fecha(e.fecha), monto: formato(e.monto_cent) }));
  const progreso = p && p.progreso_bp !== null && p.entregado_cent > 0n
    ? { pct: Math.round(p.progreso_bp) / 100, texto: `Entregado ${formato(p.entregado_cent)} de ${formato(p.entrega_total_cent)}` }
    : null;
  return {
    variante: repone ? 'repone' : 'informa',
    rotulo: repone ? 'Acción requerida' : 'Para tu información',
    titulo, faltanCent: b.faltan_cent, faltanTexto: falta, deudor, partidas, neteo, antiguedad, entregas, progreso,
    explicacion: EXPLICACION_BANNER,
    rol: repone ? 'alert' : 'status',
  };
}

/** Frase del bot de Telegram: mismas cifras que el banner. Para quien debe: "Debes reponer ... (entregar ... y aportar ...)"; para el otro: informativa. null si estan igualados. */
export function fraseBannerAgente(b: BannerIgualacion | null | undefined, yo: Socio, formato: Formato): string | null {
  if (!b) return null;
  if (!b.activo || !b.menor) return 'Valuaciones igualadas';
  const p = b.por_socio[b.menor];
  const partes: string[] = [];
  if (p && p.entregar_cent > 0n) partes.push(`entregar ${formato(p.entregar_cent)}`);
  if (p && p.aportar_cent > 0n) partes.push(`aportar ${formato(p.aportar_cent)}`);
  const det = partes.length > 0 ? ` (${partes.join(' y ')})` : '';
  const ant = p && p.entregar_cent > 0n ? textoAntiguedad(p.dias_fondos) : null;
  const cola = ant ? `; los fondos están en su cuenta personal ${ant}` : '';
  if (b.menor === yo) return `Debes reponer ${formato(b.faltan_cent)} para igualar valuación${det}${ant ? `; los fondos están en tu cuenta personal ${ant}` : ''}`;
  return `${b.menor} debe reponer ${formato(b.faltan_cent)} para igualar valuación${det}${cola}`;
}
