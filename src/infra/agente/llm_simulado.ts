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

  // Orden de compra: "pidele a Karen 100 nexa 50k y 50 waka icon"
  if ((m = /^(?:pidele|pide)\s+a\s+(karen|vapemate|isaac)\s+(.+)$/i.exec(s))) {
    const ls = lineasDe(m[2]!);
    if (ls.length > 0) {
      return respuesta([{ tipo: 'orden_compra', proveedor_texto: m[1]!, lineas: ls.map((l) => ({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas })), aplicar_saldo: /saldo/.test(n), fuente_cita: cita }]);
    }
  }

  // Aportacion: "puse 1,000 mas de capital"
  if ((m = new RegExp(`^(?:puse|aporte|meti)\\s+${NUM}`, 'i').exec(s)) && autor !== 'omar') {
    const monto = aCentavos(m[1]!);
    if (monto !== null) return respuesta([{ tipo: 'aportacion', socio: autor, monto_centavos: monto, motivo: null, fuente_cita: cita }]);
  }

  // Gasto: "pague 500 de guia"
  if ((m = new RegExp(`^pague\\s+${NUM}\\s+de\\s+(guia|envio|uber|servicio)`, 'i').exec(s)) && autor !== 'omar') {
    const monto = aCentavos(m[1]!);
    if (monto !== null) return respuesta([{ tipo: 'gasto', gasto: m[2]!.toLowerCase() as 'guia', monto_centavos: monto, pagado_por: autor, descripcion: null, fuente_cita: cita }]);
  }

  // Pago de cliente: "pago Villa 7,000" / "Villa pago 7,000"
  if ((m = new RegExp(`^pago\\s+(.+?)\\s+${NUM}$`, 'i').exec(s)) || (m = new RegExp(`^(.+?)\\s+pago\\s+${NUM}$`, 'i').exec(s))) {
    const monto = aCentavos(m[2]!);
    if (monto !== null) return respuesta([{ tipo: 'pago', cliente_texto: m[1]!.trim(), monto_centavos: monto, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: cita }]);
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
          lineas: ls.map((l) => ({ modelo_texto: l.modelo, sabor_texto: null, piezas: l.piezas, precio_texto: null, fuente_cita: cita })),
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
