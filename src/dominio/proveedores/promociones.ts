// Estado de las promociones del proveedor. Informativas: no cambian ningun costo ni se usan para calcular utilidad.
// Solo se guarda: bandera (existe o no), tipo, porcentaje entero, modelos incluidos, fechas y una etiqueta corta redactada por el sistema.
// Reglas (informe 25b, 2.2 y 2.3):
//  - Nueva: vista en dos lecturas de promociones separadas por al menos 1 hora. Con fecha de inicio futura queda "anunciada".
//  - Terminada: ausente en 2 lecturas de promociones consecutivas, o fecha de fin vencida mas 1 hora.
//  - Una plantilla con menos de la mitad de las tarjetas anteriores se descarta: no cuenta como ausencia.

import { HORAS_CONFIRMACION_PROMOCION, HORAS_FIN_VENCIDO, HORAS_POR_TERMINAR, LECTURAS_AUSENTE_TERMINA, DIAS_CONSERVAR_TERMINADAS } from './politica';
import { horasEntre, MS_HORA } from './tipos';
import type { CampanaDetectada, SenalesPromocion } from './promociones_html';
import type { DatoEvento, EstadoProveedor, EventoCambio, Instante, Promocion, TipoEvento } from './tipos';

export interface EntradaPromociones {
  clave: string;
  en: Instante;
  senales: SenalesPromocion;
  /** Handles de producto por coleccion de campana (solo de las colecciones leidas en esta pasada). */
  alcanceColecciones: Record<string, string[]>;
}

export interface ResultadoPromociones {
  estado: EstadoProveedor;
  eventos: EventoCambio[];
  /** La lectura se descarto por plantilla rota: no cuenta como ausencia ni como presencia. */
  descartada: boolean;
}

/** Campanas cuya coleccion hace falta leer: nuevas, o con fechas distintas a las guardadas. */
export function campanasPorLeer(estado: EstadoProveedor, senales: SenalesPromocion): CampanaDetectada[] {
  return senales.campanas.filter((c) => {
    const previa = estado.promociones[`campana|${c.coleccion}`];
    return !previa || previa.estado === 'terminada' || previa.inicio !== c.inicio || previa.fin !== c.fin || previa.alcance.length === 0;
  });
}

function etiquetaPct(pct: number, n: number): string {
  return `${pct} % en ${n} ${n === 1 ? 'modelo' : 'modelos'}`;
}

function etiquetaCampana(c: CampanaDetectada): string {
  if (c.mecanica === 'multicompra') {
    const m = /(\d)x(\d)/.exec(c.coleccion);
    return m ? `Campaña ${m[1]}x${m[2]}` : 'Campaña multicompra';
  }
  return 'Campaña';
}

function esFuturo(inicio: Instante | null, en: Instante): boolean {
  return inicio !== null && Date.parse(inicio) > Date.parse(en);
}

export function procesarPromociones(previo: EstadoProveedor, entrada: EntradaPromociones): ResultadoPromociones {
  const { en, clave, senales } = entrada;
  if (previo.tarjetasPromo > 0 && senales.tarjetas < previo.tarjetasPromo / 2) {
    return { estado: previo, eventos: [], descartada: true };
  }
  const estado = structuredClone(previo);
  const eventos: EventoCambio[] = [];
  const registrar = (tipo: TipoEvento, p: Promocion): void => {
    const modelos = p.alcance.map((id) => estado.modelos[id]?.titulo ?? '').filter((t) => t !== '');
    const datos: Record<string, DatoEvento> = { clave: p.clave, etiqueta: p.etiqueta, pct: p.pct, tipo: p.tipo, modelos, inicio: p.inicio, fin: p.fin };
    eventos.push({ clave: `${tipo}|${p.clave}|${clave}`, tipo, productoId: null, varianteId: null, lectura: clave, en, antes: null, despues: p.estado, datos });
  };

  const idPorHandle = new Map<string, string>();
  for (const m of Object.values(estado.modelos)) if (m.handle !== '') idPorHandle.set(m.handle.toLowerCase(), m.id);
  const idsDe = (handles: string[]): string[] => [...new Set(handles.map((h) => idPorHandle.get(h)).filter((id): id is string => id !== undefined))].sort();

  // --- Observadas en esta lectura
  const observadas = new Map<string, Omit<Promocion, 'primeraVista' | 'ultimaVista' | 'lecturasAusente' | 'estado' | 'avisoPorTerminar'>>();
  const porPct = new Map<number, string[]>();
  for (const d of senales.descuentos) porPct.set(d.pct, [...(porPct.get(d.pct) ?? []), d.handle]);
  const idsConPct = new Set<string>();
  for (const [pct, handles] of porPct) {
    const alcance = idsDe(handles);
    if (alcance.length === 0) continue;
    alcance.forEach((id) => idsConPct.add(id));
    const k = `porcentaje|${pct}`;
    observadas.set(k, { clave: k, tipo: 'porcentaje', pct, etiqueta: etiquetaPct(pct, alcance.length), alcance, inicio: null, fin: null, coleccion: null });
  }
  for (const c of senales.campanas) {
    const k = `campana|${c.coleccion}`;
    const previa = estado.promociones[k];
    const leidos = entrada.alcanceColecciones[c.coleccion];
    const alcance = leidos !== undefined ? idsDe(leidos) : previa && previa.estado !== 'terminada' ? previa.alcance : [];
    // Una coleccion generica sin fechas cuyos modelos ya estan cubiertos por una insignia de porcentaje no es otra promocion.
    if (c.inicio === null && c.fin === null && alcance.length > 0 && alcance.every((id) => idsConPct.has(id))) continue;
    if (alcance.length === 0 && leidos !== undefined) continue;
    observadas.set(k, { clave: k, tipo: c.mecanica, pct: null, etiqueta: etiquetaCampana(c), alcance, inicio: c.inicio, fin: c.fin, coleccion: c.coleccion });
  }

  // --- Altas y actualizaciones
  for (const [k, obs] of observadas) {
    const previa = estado.promociones[k];
    if (!previa || previa.estado === 'terminada') {
      estado.promociones[k] = { ...obs, primeraVista: en, ultimaVista: en, lecturasAusente: 0, estado: 'candidata', avisoPorTerminar: false };
      continue;
    }
    const p = { ...previa, ...obs, primeraVista: previa.primeraVista, ultimaVista: en, lecturasAusente: 0, avisoPorTerminar: previa.avisoPorTerminar };
    if (previa.estado === 'candidata') {
      if (horasEntre(previa.primeraVista, en) >= HORAS_CONFIRMACION_PROMOCION) {
        p.estado = esFuturo(p.inicio, en) ? 'anunciada' : 'activa';
        estado.promociones[k] = p;
        registrar(p.estado === 'anunciada' ? 'promocion_anunciada' : 'promocion_nueva', p);
      } else {
        p.estado = 'candidata';
        p.ultimaVista = previa.ultimaVista;
        estado.promociones[k] = p;
      }
      continue;
    }
    p.estado = previa.estado === 'anunciada' && !esFuturo(p.inicio, en) ? 'activa' : previa.estado;
    estado.promociones[k] = p;
  }

  // --- Ausencias, fin vencido y por terminar
  for (const [k, p] of Object.entries(estado.promociones)) {
    if (p.estado === 'terminada') continue;
    if (!observadas.has(k)) {
      if (p.estado === 'candidata') {
        delete estado.promociones[k];
        continue;
      }
      p.lecturasAusente += 1;
    }
    const finVencido = p.fin !== null && Date.parse(en) >= Date.parse(p.fin) + HORAS_FIN_VENCIDO * MS_HORA;
    if (p.estado !== 'candidata' && (p.lecturasAusente >= LECTURAS_AUSENTE_TERMINA || finVencido)) {
      p.estado = 'terminada';
      registrar('promocion_terminada', p);
      continue;
    }
    if (p.estado === 'activa' && p.fin !== null && !p.avisoPorTerminar) {
      const faltan = (Date.parse(p.fin) - Date.parse(en)) / MS_HORA;
      if (faltan > 0 && faltan <= HORAS_POR_TERMINAR) {
        p.avisoPorTerminar = true;
        registrar('promocion_por_terminar', p);
      }
    }
  }

  // --- Limpieza de terminadas viejas
  for (const [k, p] of Object.entries(estado.promociones)) {
    if (p.estado === 'terminada' && horasEntre(p.ultimaVista, en) > DIAS_CONSERVAR_TERMINADAS * 24) delete estado.promociones[k];
  }

  estado.tarjetasPromo = senales.tarjetas;
  return { estado, eventos, descartada: false };
}
