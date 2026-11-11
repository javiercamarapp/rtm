// Senal derivada "poca variedad" (V-1). El catalogo del proveedor solo dice disponible o agotado por sabor, nunca cuantas piezas:
// no existe "stock bajo de Karen". Lo unico fiable es cuantos sabores de un modelo siguen disponibles frente a su base reciente.

import { fechaNeg } from '@/dominio/calendario';
import { sumarMs, MS_HORA } from './tipos';
import type { EstadoProveedor, EstadoVariedad, EventoCambio, Instante, ModeloProveedor } from './tipos';

export const DIAS_BASE = 7;
export const MAX_SABORES_POCA_VARIEDAD = 5;
export const FRACCION_POCA_VARIEDAD = 0.5;
export const FRACCION_RECUPERACION = 0.6;
export const MIN_SABORES_RECUPERACION = 8;
export const LECTURAS_SOSTENIDAS = 2;
export const REARME_HORAS = 24;

export function saboresDisponibles(estado: EstadoProveedor, productoId: string): number {
  let n = 0;
  for (const v of Object.values(estado.variantes)) if (v.productoId === productoId && v.estado !== 'descontinuada' && v.disponible) n++;
  return n;
}

function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  return orden.length % 2 === 1 ? orden[mitad]! : (orden[mitad - 1]! + orden[mitad]!) / 2;
}

/** Base: mediana de los ultimos 7 dias; con menos de 7 dias de historia, el maximo observado. */
export function baseDeVariedad(puntos: { dia: string; n: number }[]): number {
  if (puntos.length === 0) return 0;
  if (puntos.length < DIAS_BASE) return Math.max(...puntos.map((p) => p.n));
  return mediana(puntos.slice(-DIAS_BASE).map((p) => p.n));
}

export interface PoliticaVariedad {
  /** Modelos "activos para los socios" (ventas en 60 dias o existencia propia mayor que 0). */
  modeloActivo(m: ModeloProveedor): boolean;
}

/**
 * Actualiza el historial diario y evalua V-1 sobre una lectura valida. Muta el estado (ya clonado por quien llama)
 * y devuelve los eventos nuevos. V-2 (modelo sin sabores) es el evento `modelo_agotado` del detector.
 */
export function evaluarVariedad(estado: EstadoProveedor, en: Instante, lectura: string, politica: PoliticaVariedad): EventoCambio[] {
  const eventos: EventoCambio[] = [];
  const dia = fechaNeg(new Date(en));
  for (const m of Object.values(estado.modelos)) {
    if (m.estado === 'descontinuado') continue;
    const n = saboresDisponibles(estado, m.id);
    const hist = estado.historialVariedad[m.id] ?? [];
    const ultimo = hist[hist.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.n = Math.max(ultimo.n, n);
    else hist.push({ dia, n });
    while (hist.length > DIAS_BASE + 1) hist.shift();
    estado.historialVariedad[m.id] = hist;

    if (!politica.modeloActivo(m)) continue;
    const base = baseDeVariedad(hist);
    const ev: EstadoVariedad = estado.variedad[m.id] ?? { lecturasBajas: 0, lecturasAltas: 0, activa: false, rearmaEn: null };
    estado.variedad[m.id] = ev;

    if (!ev.activa) {
      const baja = n >= 1 && n <= MAX_SABORES_POCA_VARIEDAD && n <= FRACCION_POCA_VARIEDAD * base;
      ev.lecturasBajas = baja ? ev.lecturasBajas + 1 : 0;
      const rearmado = ev.rearmaEn === null || Date.parse(ev.rearmaEn) <= Date.parse(en);
      if (ev.lecturasBajas >= LECTURAS_SOSTENIDAS && rearmado) {
        ev.activa = true;
        ev.lecturasAltas = 0;
        eventos.push({ clave: `poca_variedad|${m.id}||${lectura}`, tipo: 'poca_variedad', productoId: m.id, varianteId: null, lectura, en, antes: String(base), despues: String(n), datos: { modelo: m.titulo, disponibles: n, base } });
      }
    } else {
      const alta = n >= FRACCION_RECUPERACION * base || n >= MIN_SABORES_RECUPERACION;
      ev.lecturasAltas = alta ? ev.lecturasAltas + 1 : 0;
      if (ev.lecturasAltas >= LECTURAS_SOSTENIDAS) {
        ev.activa = false;
        ev.lecturasBajas = 0;
        ev.rearmaEn = sumarMs(en, REARME_HORAS * MS_HORA);
        eventos.push({ clave: `variedad_recuperada|${m.id}||${lectura}`, tipo: 'variedad_recuperada', productoId: m.id, varianteId: null, lectura, en, antes: String(base), despues: String(n), datos: { modelo: m.titulo, disponibles: n, base } });
      }
    }
  }
  return eventos;
}
