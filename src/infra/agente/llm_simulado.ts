// LLM SIMULADO: ninguna llamada real. Dos dobles:
//  - LlmGuionado: devuelve respuestas programadas (pruebas); cuenta llamadas y costo.
//  - LlmHeuristico: interpreta frases tipicas en espanol con reglas deterministas (simulador local de conversaciones).
import { centavosDesdeTexto } from '@/dominio/dinero';
import type { Intencion, RespuestaExtractor } from '@/dominio/agente/intenciones';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { ErrorLlm, type ClienteLlm, type PeticionLlm, type RespuestaLlm } from '@/aplicacion/agente/puertos';

export type SalidaGuionada = unknown | Error | ((p: PeticionLlm) => unknown);

export class LlmGuionado implements ClienteLlm {
  readonly peticiones: PeticionLlm[] = [];
  private i = 0;

  constructor(
    private readonly salidas: SalidaGuionada[],
    private readonly costoMicroUsd: bigint = 120n,
  ) {}

  get llamadas(): number {
    return this.peticiones.length;
  }

  async extraer(p: PeticionLlm): Promise<RespuestaLlm> {
    this.peticiones.push(p);
    const s = this.salidas[Math.min(this.i, this.salidas.length - 1)];
    this.i++;
    if (s instanceof Error) throw s;
    const contenido = typeof s === 'function' ? (s as (p: PeticionLlm) => unknown)(p) : s;
    return { contenido, modeloUsado: p.modelos[0] ?? 'simulado', tokensEntrada: 1200, tokensSalida: 150, costoMicroUsd: this.costoMicroUsd };
  }
}

/** Construye una respuesta valida del extractor. */
export function respuesta(acciones: Intencion[], extra: Partial<Pick<RespuestaExtractor, 'sospecha_inyeccion' | 'baja_certeza'>> = {}): RespuestaExtractor {
  return { acciones, sospecha_inyeccion: false, baja_certeza: false, ...extra };
}

const NUM = '(\\d[\\d.,]*\\s*(?:k|mil)?)';

function aCentavos(t: string): number | null {
  const limpio = t.trim().toLowerCase();
  const m = /^(\d[\d.,]*)\s*(k|mil)?$/.exec(limpio);
  if (!m) return null;
  try {
    const base = centavosDesdeTexto(m[1]!);
    const c = m[2] ? base * 1000n : base;
    return c > 0n && c <= 100_000_000n ? Number(c) : null;
  } catch {
    return null;
  }
}

function lineasDe(texto: string): Array<{ modelo: string; piezas: number }> {
  const salida: Array<{ modelo: string; piezas: number }> = [];
  for (const parte of texto.split(/[,;]|\sy\s/)) {
    const p = parte.trim();
    const delante = /^(\d{1,4})\s*(?:pz|piezas)?\s+(\D.*)$/i.exec(p);
    const detras = /^(.*\D)\s+(\d{1,4})\s*(?:pz|piezas)?$/i.exec(p);
    if (delante) salida.push({ modelo: delante[2]!.trim(), piezas: Number(delante[1]) });
    else if (detras) salida.push({ modelo: detras[1]!.trim(), piezas: Number(detras[2]) });
  }
  return salida.filter((l) => l.piezas >= 1 && l.piezas <= 2000);
}

/** Un entero inicia una linea si le sigue una palabra ("28 jupiter 24 dm"); un entero seguido de otro numero es parte del modelo ("waka 50 24 dm"). */
function lineasPedido(cuerpo: string): Array<{ modelo: string; piezas: number }> {
  const porComas = lineasDe(cuerpo);
  if (/[,;]/.test(cuerpo) && porComas.length > 0) return porComas;
  const inicios = [...cuerpo.matchAll(/(?:^|\s)(\d{1,4})(?=\s+[A-Za-zÁÉÍÓÚáéíóúñ])/g)];
  const salida: Array<{ modelo: string; piezas: number }> = [];
  inicios.forEach((x, i) => {
    const desde = x.index! + x[0].length;
    const hasta = i + 1 < inicios.length ? inicios[i + 1]!.index! : cuerpo.length;
    const modelo = cuerpo.slice(desde, hasta).trim();
    const piezas = Number(x[1]);
    if (modelo !== '' && piezas >= 1 && piezas <= 2000) salida.push({ modelo, piezas });
  });
  return salida.length > 0 ? salida : porComas;
}

function partirSabor(t: string): { modelo_texto: string; sabor_texto: string | null } {
  const i = t.indexOf('/');
  return i > 0 ? { modelo_texto: t.slice(0, i).trim(), sabor_texto: t.slice(i + 1).trim() || null } : { modelo_texto: t, sabor_texto: null };
}

const NINGUNA: Intencion = { tipo: 'ninguna' };

/** Interpretacion determinista de frases tipicas. No es un modelo: solo sirve para ensayar conversaciones sin gastar. */
export function interpretarHeuristico(autor: 'angelo' | 'javier' | 'omar', texto: string): RespuestaExtractor {
  const t = texto.trim();
  const n = normalizar(t);
  // Minusculas sin acentos pero CON puntuacion: los montos llevan comas y puntos.
  const s = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const cita = t.slice(0, 120);
  let m: RegExpExecArray | null;

  if (/^(deshaz|deshacer|anula lo ultimo)/.test(n)) return respuesta([{ tipo: 'deshacer', folio: null }]);

  if (autor === 'omar' || /^(tome|tomo|toma)\b/.test(n)) {
    m = /^(?:tome|tomo|toma|me lleve)?\s*(.+)$/i.exec(t);
    const ls = lineasDe(m?.[1] ?? t);
    if (ls.length > 0 && !/saldo|cuanto|stock/.test(n)) {
      return respuesta([
        {
          tipo: 'toma_omar',
          lineas: ls.map((l) => {
            const [modelo = l.modelo, ...resto] = l.modelo.split(/\s+/);
            return { modelo_texto: modelo, sabor_texto: resto.length > 0 ? resto.join(' ') : null, piezas: l.piezas };
          }),
          fuente_cita: cita,
        },
      ]);
    }
  }

  if ((m = new RegExp(`^(?:cuanto|cuantas?|que)\\s+(?:hay|queda|tengo)\\s+(?:de\\s+)?(.+?)\\??$`, 'i').exec(t))) {
    return respuesta([{ tipo: 'consulta', consulta: 'inventario', modelo_texto: m[1]!, sabor_texto: null, sujeto_texto: null, folio: null, periodo: null }]);
  }
  if ((m = /^(?:cuanto|cual es el) saldo (?:tengo )?(?:con|de)\s+(.+?)\??$/i.exec(t)) || (m = /^saldo (?:de|con)\s+(.+?)\??$/i.exec(t))) {
    const sujeto = m[1]!.trim();
    const prov = /^(isaac|karen|vapemate)$/i.test(sujeto);
    return respuesta([{ tipo: 'consulta', consulta: prov ? 'saldo_proveedor' : 'saldo', modelo_texto: null, sabor_texto: null, sujeto_texto: sujeto, folio: null, periodo: null }]);
  }
  if (/^(cuanto )?saldo( tengo)?$/.test(n)) {
    return respuesta([{ tipo: 'consulta', consulta: 'saldo', modelo_texto: null, sabor_texto: null, sujeto_texto: autor === 'omar' ? 'omar' : null, folio: null, periodo: null }]);
  }
  if (/^(resumen|como vamos)/.test(n)) {
    return respuesta([{ tipo: 'consulta', consulta: 'resumen', modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null, periodo: 'hoy' }]);
  }

  // "Angel mando 30,500 a Karen" / "Pague 12,000 a Isaac desde mi cuenta"
  if ((m = new RegExp(`^(.+?)\\s+mando\\s+${NUM}\\s+a\\s+(karen|vapemate|isaac)`, 'i').exec(s))) {
    const monto = aCentavos(m[2]!);
    if (monto !== null) return respuesta([{ tipo: 'pago_proveedor', proveedor_texto: m[3]!, monto_centavos: monto, pagado_por: 'sociedad', cliente_texto: m[1]!.trim(), fuente_cita: cita }]);
  }
  if ((m = new RegExp(`^pague\\s+${NUM}\\s+a\\s+(karen|vapemate|isaac)`, 'i').exec(s)) && (autor === 'angelo' || autor === 'javier')) {
    const monto = aCentavos(m[1]!);
    if (monto !== null) return respuesta([{ tipo: 'pago_proveedor', proveedor_texto: m[2]!, monto_centavos: monto, pagado_por: autor, cliente_texto: null, fuente_cita: cita }]);
  }

  const socioDe = (x: string): 'angelo' | 'javier' | null => (/angelo/.test(x) ? 'angelo' : /javier/.test(x) ? 'javier' : null);
  const viaDe = (x: string): 'transferencia' | 'efectivo' | null => (/transferencia|spei/.test(x) ? 'transferencia' : /efectivo/.test(x) ? 'efectivo' : null);

  // Reembolso a un socio: "le pague a Javier 1,000 de reembolso por transferencia" / "reembolso a Angelo 2000 en efectivo"
  if (autor !== 'omar' && /reembolso/.test(s) && (m = new RegExp(`(angelo|javier)\\D*?${NUM}`, 'i').exec(s))) {
    const monto = aCentavos(m[2]!);
    if (monto !== null) return respuesta([{ tipo: 'reembolso_socio', socio: socioDe(m[1]!)!, monto_centavos: monto, via: viaDe(s), fuente_cita: cita }]);
  }

  // Retiro de utilidad: "retiro 5,000 de utilidad en efectivo" (el socio es quien escribe) / "retiro de utilidad de Angelo 5000"
  if (autor !== 'omar' && /^(?:retiro|retire|saque|se retiro)\b/.test(s) && /utilidad/.test(s) && (m = new RegExp(NUM, 'i').exec(s.replace(/[a-z]+/g, ' ')))) {
    const monto = aCentavos(m[1]!);
    const quien = socioDe(s) ?? autor;
    if (monto !== null) return respuesta([{ tipo: 'retiro_utilidad', socio: quien, monto_centavos: monto, via: viaDe(s), fuente_cita: cita }]);
  }

  // Devolucion de un cliente: "Cliente Norte devolvio 5 jupiter del pedido P-0001 a inventario"
  if ((m = /^(.+?)\s+devolvio\s+(.+)$/.exec(s)) && autor !== 'omar') {
    const folio = /\bp-?\d{1,6}\b/i.exec(m[2]!);
    const destino = /merma/.test(m[2]!) ? 'merma' : /inventario/.test(m[2]!) ? 'inventario' : null;
    const cuerpo = m[2]!.replace(/del pedido\s+p-?\d+/i, '').replace(/\b(a|en)\s+(inventario|merma)\b/i, '').replace(/\bmerma\b/i, '').trim();
    const ls = lineasDe(cuerpo);
    if (ls.length > 0) {
      return respuesta([{ tipo: 'devolucion', cliente_texto: m[1]!.trim(), pedido_folio: folio ? folio[0].toUpperCase().replace(/^P(\d)/, 'P-$1') : null, lineas: ls.map((l) => ({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas })), destino, motivo: null, fuente_cita: cita }]);
    }
  }

  // Paquete perdido o danado: "el paquete del pedido P-0003 se perdio" / "llego danado el paquete P-0003"
  if (autor !== 'omar' && /paquete/.test(s) && /(perdio|extravio|danado)/.test(s)) {
    const folio = /\bp-?\d{1,6}\b/i.exec(s);
    return respuesta([{ tipo: 'paquete_perdido', pedido_folio: folio ? folio[0].toUpperCase().replace(/^P(\d)/, 'P-$1') : null, cliente_texto: null, incidente: /danado/.test(s) ? 'danado' : 'perdido', detalle: null, fuente_cita: cita }]);
  }

  const folio = (pref: string): string | null => {
    const f = new RegExp(`\\b${pref}-?(\\d{1,6})\\b`, 'i').exec(s);
    return f ? `${pref.toUpperCase()}-${f[1]!.padStart(4, '0')}` : null;
  };
  const sinCons = { modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null } as const;
  if (autor !== 'omar') {
    if (/(se envio|enviado|envie)\b.*\bp-?\d/.test(s) || /^(envie|enviamos) el pedido/.test(s)) return respuesta([{ tipo: 'pedido_envio', pedido_folio: folio('p'), estado: 'enviado', paqueteria_texto: null, guia_texto: null, fuente_cita: cita }]);
    if (/(entregado|se entrego)\b.*\bp-?\d/.test(s)) return respuesta([{ tipo: 'pedido_envio', pedido_folio: folio('p'), estado: 'entregado', paqueteria_texto: null, guia_texto: null, fuente_cita: cita }]);
    if ((m = /^cancela(?:r)? el pedido\s+p-?\d+\s*(?:porque|por|motivo)?\s*(.*)$/.exec(s))) return respuesta([{ tipo: 'pedido_cancelar', pedido_folio: folio('p'), motivo: m[1] ? m[1].slice(0, 100) : null, fuente_cita: cita }]);
    if (/^(recibi|llego)\b.*\bc-?\d/.test(s)) return respuesta([{ tipo: 'compra_recepcion', compra_folio: folio('c'), lineas: [], fuente_cita: cita }]);
    if (/^aprueba(?:n)?\b.*\bc-?\d/.test(s)) return respuesta([{ tipo: 'compra_aprobar', compra_folio: folio('c'), fuente_cita: cita }]);
    if ((m = new RegExp(`^pague\\s+${NUM}\\s*(?:usd|dolares)\\s+de\\s+(openrouter|vercel|supabase)`, 'i').exec(s))) {
      const monto = aCentavos(m[1]!);
      if (monto !== null) return respuesta([{ tipo: 'gasto_servicio', servicio_texto: m[2]!, monto_usd_centavos: monto, monto_mxn_centavos: null, tipo_cambio_micro: null, pagado_por: autor, fuente_cita: cita }]);
    }
    if (/^(cuadra|cuadran las cuentas|las cuentas cuadran)\??$/.test(n)) return respuesta([{ tipo: 'consulta', consulta: 'cuadra', ...sinCons, periodo: null }]);
    if (/^(que falta|pendientes|que falta por hacer)/.test(n)) return respuesta([{ tipo: 'consulta', consulta: 'pendientes', ...sinCons, periodo: null }]);
    if (/^(reporte|dame el reporte)/.test(n)) return respuesta([{ tipo: 'consulta', consulta: 'reporte', ...sinCons, periodo: /mes/.test(n) ? 'mes' : 'semana' }]);
    if (/^(saldo de los socios|saldos de socios|como van los socios)/.test(n)) return respuesta([{ tipo: 'consulta', consulta: 'saldos_socios', ...sinCons, periodo: null }]);
  }

  // Consultas de los socios
  if (/estado de cuenta/.test(n) && (m = /(angelo|javier)/.exec(s))) {
    return respuesta([{ tipo: 'consulta', consulta: 'estado_cuenta_socio', modelo_texto: null, sabor_texto: null, sujeto_texto: m[1]!, folio: null, periodo: null }]);
  }
  if (/utilidad/.test(n) && /(mes|semana|hoy)/.test(n) && !/retir|puse/.test(n)) {
    const periodo = /semana/.test(n) ? 'semana' : /hoy/.test(n) ? 'hoy' : 'mes';
    return respuesta([{ tipo: 'consulta', consulta: 'utilidad', modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null, periodo }]);
  }
  if (/(cuanto debe cada cliente|quien me debe|cartera|cuentas por cobrar)/.test(n)) {
    return respuesta([{ tipo: 'consulta', consulta: 'cartera', modelo_texto: null, sabor_texto: null, sujeto_texto: null, folio: null, periodo: null }]);
  }

  // Orden de compra: "pidele a Karen 100 nexa 50k y 50 waka icon"
  if ((m = /^(?:pidele|pide)\s+a\s+(karen|vapemate|isaac)\s+(.+)$/i.exec(s))) {
    const ls = lineasDe(m[2]!);
    if (ls.length > 0) {
      return respuesta([{ tipo: 'orden_compra', proveedor_texto: m[1]!, lineas: ls.map((l) => ({ ...partirSabor(l.modelo), piezas: l.piezas })), aplicar_saldo: /saldo/.test(n), fuente_cita: cita }]);
    }
  }

  // Aportacion: "puse 1,000 mas de capital" (capital solo si lo dice) / "puse 1,000 para cubrir gastos" (sin declarar: reembolso por omision)
  if ((m = new RegExp(`^(?:puse|aporte|meti)\\s+${NUM}`, 'i').exec(s)) && autor !== 'omar') {
    const monto = aCentavos(m[1]!);
    const intencion = /\bcapital\b|invertir|inversion/.test(n) ? 'capital' : null;
    if (monto !== null) return respuesta([{ tipo: 'aportacion', socio: autor, monto_centavos: monto, motivo: null, intencion, fuente_cita: cita }]);
  }

  // Gasto: "pague 500 de guia"
  if ((m = new RegExp(`^pague\\s+${NUM}\\s+de\\s+(guia|envio|uber|servicio)`, 'i').exec(s)) && autor !== 'omar') {
    const monto = aCentavos(m[1]!);
    if (monto !== null) return respuesta([{ tipo: 'gasto', gasto: m[2]!.toLowerCase() as 'guia', monto_centavos: monto, pagado_por: autor, descripcion: null, fuente_cita: cita }]);
  }

  // Pago de cliente: "pago Villa 7,000" / "Villa pago 7,000"
  const CUENTA = '(?:\\s+(?:a|en|con)\\s+(?:la cuenta de\\s+)?(angelo|javier|isaac|karen|efectivo))?';
  if ((m = new RegExp(`^pago\\s+(.+?)\\s+${NUM}${CUENTA}$`, 'i').exec(s)) || (m = new RegExp(`^(.+?)\\s+pago\\s+${NUM}${CUENTA}$`, 'i').exec(s))) {
    const monto = aCentavos(m[2]!);
    if (monto !== null) return respuesta([{ tipo: 'pago', cliente_texto: m[1]!.trim(), monto_centavos: monto, cuenta_destino_texto: m[3] ?? null, pedido_folio: null, fuente_cita: cita }]);
  }

  // Pedido: "Cliente 28 jupiter 24 dm", "Cliente 28 waka 50" o "Cliente: jupiter 28, dm 24"
  if ((m = /^([^\d:]+?):\s*(.+)$/.exec(t)) || (m = /^([^\d:]+?)[:,]?\s+(\d.*)$/.exec(t))) {
    const ls = lineasPedido(m[2]!);
    if (ls.length > 0) {
      return respuesta([
        {
          tipo: 'pedido',
          cliente_texto: m[1]!.trim(),
          destino_texto: null,
          lineas: ls.map((l) => ({ ...partirSabor(l.modelo), piezas: l.piezas, precio_texto: null, fuente_cita: cita })),
          envio_cobrado_centavos: null,
          fuente_cita: cita,
        },
      ]);
    }
  }
  return respuesta([NINGUNA]);
}

export class LlmHeuristico implements ClienteLlm {
  readonly peticiones: PeticionLlm[] = [];

  async extraer(p: PeticionLlm): Promise<RespuestaLlm> {
    this.peticiones.push(p);
    const m = /<mensaje autor="(angelo|javier|omar)" fuente="[^"]*">([\s\S]*?)<\/mensaje>/.exec(p.usuario);
    if (!m) throw new ErrorLlm('respuesta_invalida', 'sin mensaje');
    const contenido = interpretarHeuristico(m[1] as 'angelo' | 'javier' | 'omar', m[2]!.replace(/‹/g, '<').replace(/›/g, '>'));
    return { contenido, modeloUsado: 'simulado/heuristico', tokensEntrada: 900, tokensSalida: 100, costoMicroUsd: 90n };
  }
}
