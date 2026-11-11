// De eventos confirmados a solicitudes de aviso (catalogo P-xx del informe 25b) y su redaccion en espanol sobrio, sin emojis.
// Un evento con varios sabores del mismo modelo es UN aviso por lectura. El payload lleva nombres de modelo y sabor, fechas y
// porcentajes enteros: jamas importes ni la direccion de la fuente. Las cifras de dinero no existen en este modulo.

import { etiquetaFechaHora } from '@/dominio/formato';
import type { CodigoAviso, DatoEvento, ElementoCola, EventoCambio, Incidente, Instante, Severidad, SolicitudAviso, TipoIncidente } from './tipos';

export interface AvisosConstruidos {
  avisos: SolicitudAviso[];
  /** Claves de aviso que dejan de ser ciertas (el aviso pasa a "resuelto solo"). */
  resueltos: string[];
}

function texto(d: DatoEvento | undefined): string {
  return typeof d === 'string' ? d : '';
}
function lista(d: DatoEvento | undefined): string[] {
  return Array.isArray(d) ? d : [];
}
function numero(d: DatoEvento | undefined): number {
  return typeof d === 'number' ? d : 0;
}

function solicitud(codigo: CodigoAviso, severidad: Severidad, destino: 'inmediato' | 'resumen', entidadTipo: SolicitudAviso['entidadTipo'], entidadId: string, claveDedupe: string, payload: SolicitudAviso['payload'], creada: Instante): SolicitudAviso {
  return { codigo, severidad, destino, claveDedupe, entidadTipo, entidadId, payload, creada };
}

export function construirAvisos(eventos: EventoCambio[], colaNueva: ElementoCola[], en: Instante): AvisosConstruidos {
  const avisos: SolicitudAviso[] = [];
  const resueltos: string[] = [];
  const modelosAgotados = new Set(eventos.filter((e) => e.tipo === 'modelo_agotado').map((e) => e.productoId));
  const lecturaDe = eventos[0]?.lectura ?? en;

  // Sabores agrupados por modelo y lectura.
  const nuevos = new Map<string, { modelo: string; activo: boolean; sabores: string[] }>();
  const agotadosSocios = new Map<string, { modelo: string; sabores: string[] }>();
  const agotadosOtros = new Map<string, { modelo: string; sabores: string[] }>();
  const regresosSocios = new Map<string, { modelo: string; sabores: string[] }>();
  const regresosOtros = new Map<string, { modelo: string; sabores: string[] }>();
  const inestables: string[] = [];
  const meter = (m: Map<string, { modelo: string; sabores: string[] }>, e: EventoCambio): void => {
    const id = e.productoId ?? '';
    const g = m.get(id) ?? { modelo: texto(e.datos['modelo']), sabores: [] };
    g.sabores.push(texto(e.datos['sabor']));
    m.set(id, g);
  };

  for (const e of eventos) {
    const id = e.productoId ?? '';
    switch (e.tipo) {
      case 'modelo_nuevo':
        avisos.push(solicitud('P-01', 'media', 'inmediato', 'modelo', id, `P-01|${id}`, { modelo: texto(e.datos['modelo']), disponibles: numero(e.datos['disponibles']), sabores: numero(e.datos['sabores']) }, e.en));
        break;
      case 'sabor_nuevo': {
        const g = nuevos.get(id) ?? { modelo: texto(e.datos['modelo']), activo: e.datos['activo'] === true, sabores: [] };
        g.sabores.push(texto(e.datos['sabor']));
        nuevos.set(id, g);
        break;
      }
      case 'sabor_agotado':
        if (e.datos['inestable'] === true || modelosAgotados.has(e.productoId)) break;
        meter(e.datos['deSocios'] === true ? agotadosSocios : agotadosOtros, e);
        break;
      case 'sabor_regreso':
        if (e.datos['inestable'] === true) break;
        meter(e.datos['deSocios'] === true ? regresosSocios : regresosOtros, e);
        break;
      case 'modelo_agotado':
        avisos.push(solicitud('P-04', 'media', e.datos['activo'] === true ? 'inmediato' : 'resumen', 'modelo', id, `P-04|${id}`, { modelo: texto(e.datos['modelo']), activo: e.datos['activo'] === true }, e.en));
        break;
      case 'renombrado':
        if (e.datos['entidad'] === 'modelo' && e.datos['rompeMapeo'] === true) {
          avisos.push(solicitud('P-07', 'baja', 'resumen', 'modelo', id, `P-07|${id}|${e.lectura}`, { modeloAnterior: texto(e.datos['modeloAnterior']), modeloNuevo: texto(e.datos['modeloNuevo']) }, e.en));
        }
        break;
      case 'modelo_descontinuado':
        avisos.push(solicitud('P-08', 'media', 'inmediato', 'modelo', id, `P-08|${id}`, { modelo: texto(e.datos['modelo']), regreso: false }, e.en));
        break;
      case 'modelo_regreso_catalogo':
        avisos.push(solicitud('P-08', 'baja', 'resumen', 'modelo', id, `P-08|${id}`, { modelo: texto(e.datos['modelo']), regreso: true }, e.en));
        break;
      case 'inestable':
        inestables.push(`${texto(e.datos['modelo'])} ${texto(e.datos['sabor'])}`.trim());
        break;
      case 'poca_variedad':
        avisos.push(solicitud('V-1', 'media', 'inmediato', 'modelo', id, `V-1|${id}`, { modelo: texto(e.datos['modelo']), disponibles: numero(e.datos['disponibles']), base: numero(e.datos['base']) }, e.en));
        break;
      case 'variedad_recuperada':
        resueltos.push(`V-1|${id}`);
        break;
      case 'lectura_retenida':
        avisos.push(solicitud('P-18', 'alta', 'inmediato', 'fuente', 'lectura', 'P-18|retenida', { detalle: texto(e.datos['detalle']) }, e.en));
        break;
      case 'promocion_nueva':
        avisos.push(solicitud('P-09', 'media', 'inmediato', 'promocion', texto(e.datos['clave']), `P-09|${texto(e.datos['clave'])}`, promoPayload(e), e.en));
        break;
      case 'promocion_anunciada':
        avisos.push(solicitud('P-10', 'baja', 'resumen', 'promocion', texto(e.datos['clave']), `P-10|${texto(e.datos['clave'])}`, promoPayload(e), e.en));
        break;
      case 'promocion_por_terminar':
        avisos.push(solicitud('P-11', 'media', 'inmediato', 'promocion', texto(e.datos['clave']), `P-11|${texto(e.datos['clave'])}`, { ...promoPayload(e), condicion: 'existencia_propia_baja' }, e.en));
        break;
      case 'promocion_terminada':
        avisos.push(solicitud('P-12', 'baja', 'resumen', 'promocion', texto(e.datos['clave']), `P-12|${texto(e.datos['clave'])}`, promoPayload(e), e.en));
        resueltos.push(`P-09|${texto(e.datos['clave'])}`);
        break;
      case 'sabor_descontinuado':
        break;
    }
  }

  for (const [id, g] of nuevos) {
    avisos.push(solicitud('P-02', g.activo ? 'media' : 'baja', g.activo ? 'inmediato' : 'resumen', 'modelo', id, `P-02|${id}`, { modelo: g.modelo, sabores: g.sabores }, en));
  }
  for (const [id, g] of agotadosSocios) avisos.push(solicitud('P-03', 'media', 'inmediato', 'modelo', id, `P-03|${id}|socios`, { modelo: g.modelo, sabores: g.sabores }, en));
  for (const [id, g] of agotadosOtros) avisos.push(solicitud('P-03', 'baja', 'resumen', 'modelo', id, `P-03|${id}|otros`, { modelo: g.modelo, sabores: g.sabores }, en));
  for (const [id, g] of regresosSocios) avisos.push(solicitud('P-05', 'media', 'inmediato', 'modelo', id, `P-05|${id}|socios`, { modelo: g.modelo, sabores: g.sabores }, en));
  for (const [id, g] of regresosOtros) avisos.push(solicitud('P-05', 'baja', 'resumen', 'modelo', id, `P-05|${id}|otros`, { modelo: g.modelo, sabores: g.sabores }, en));
  if (inestables.length > 0) avisos.push(solicitud('P-20', 'baja', 'resumen', 'fuente', 'inestables', `P-20|inestables|${lecturaDe}`, { inestables }, en));
  if (colaNueva.length > 0) avisos.push(solicitud('P-19', 'baja', 'resumen', 'cola', 'confirmacion', `P-19|${lecturaDe}`, { cantidad: colaNueva.length }, en));
  return { avisos, resueltos };
}

function promoPayload(e: EventoCambio): Record<string, DatoEvento> {
  return {
    etiqueta: texto(e.datos['etiqueta']),
    pct: typeof e.datos['pct'] === 'number' ? e.datos['pct'] : null,
    tipo: texto(e.datos['tipo']),
    modelos: lista(e.datos['modelos']),
    inicio: typeof e.datos['inicio'] === 'string' ? e.datos['inicio'] : null,
    fin: typeof e.datos['fin'] === 'string' ? e.datos['fin'] : null,
  };
}

// ---------------------------------------------------------------- avisos de la fuente (P-17)

const TEXTO_INCIDENTE: Record<TipoIncidente, string> = {
  sin_lectura: 'no se actualiza',
  bloqueada: 'dejó de responder a las lecturas automáticas',
  formato: 'cambió de formato',
  vacia: 'devolvió un catálogo vacío',
};

export function avisoFuente(incidente: Incidente, horasSinLectura: number | null, ultimaLectura: Instante | null, recordatorio: boolean, en: Instante): SolicitudAviso {
  return solicitud(
    'P-17',
    'alta',
    'inmediato',
    'fuente',
    'inventario',
    `P-17|${incidente.desde}${recordatorio ? '|recordatorio' : ''}`,
    { incidente: incidente.tipo, horas: horasSinLectura, ultimaLectura, recordatorio },
    en,
  );
}

// ---------------------------------------------------------------- redaccion

function enumerar(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

function etiquetaIncidente(t: string): string {
  return t in TEXTO_INCIDENTE ? TEXTO_INCIDENTE[t as TipoIncidente] : TEXTO_INCIDENTE.sin_lectura;
}

/** Texto para campana y Telegram. Sin emojis, sin dirección de la fuente, sin importes. */
export function redactarAviso(a: SolicitudAviso): string {
  const p = a.payload;
  switch (a.codigo) {
    case 'P-01': {
      const n = numero(p['disponibles']);
      return `Modelo nuevo en el Inventario de Karen: ${texto(p['modelo'])}, ${n} ${plural(n, 'sabor disponible', 'sabores disponibles')}. Ya se agregó al Inventario actual de proveedores como "nuevo, sin costo". Para pasar al catálogo propio hace falta el costo y la confirmación de un socio.`;
    }
    case 'P-02': {
      const s = lista(p['sabores']);
      return `${plural(s.length, 'Sabor nuevo', 'Sabores nuevos')} en ${texto(p['modelo'])}: ${enumerar(s)}.`;
    }
    case 'P-03': {
      const s = lista(p['sabores']);
      return `Se ${plural(s.length, 'agotó', 'agotaron')} en Karen ${s.length} ${plural(s.length, 'sabor', 'sabores')} de ${texto(p['modelo'])}: ${enumerar(s)}.`;
    }
    case 'P-04':
      return `Karen no tiene ningún sabor disponible de ${texto(p['modelo'])}.`;
    case 'P-05': {
      const s = lista(p['sabores']);
      return `${plural(s.length, 'Regresó', 'Regresaron')} en Karen ${s.length} ${plural(s.length, 'sabor', 'sabores')} de ${texto(p['modelo'])}: ${enumerar(s)}.`;
    }
    case 'P-07':
      return `Karen cambió "${texto(p['modeloAnterior'])}" a "${texto(p['modeloNuevo'])}". Se conservó el vínculo con tu modelo; confirma.`;
    case 'P-08':
      return p['regreso'] === true
        ? `Regresó al catálogo de Karen: ${texto(p['modelo'])}.`
        : `Hace más de 24 horas que Karen no publica ${texto(p['modelo'])} (3 lecturas seguidas). Se marcó como descontinuado.`;
    case 'P-09': {
      const m = lista(p['modelos']);
      const pct = typeof p['pct'] === 'number' ? p['pct'] : null;
      const cuerpo = pct !== null ? `${pct} % de descuento anunciado en ${enumerar(m)}` : `${texto(p['etiqueta'])} en ${enumerar(m)}`;
      return `Promoción vista en el Inventario de Karen: ${cuerpo}. Confirma con Karen si aplica a mayoreo. No cambia ningún costo.`;
    }
    case 'P-10': {
      const m = lista(p['modelos']);
      const fechas = typeof p['inicio'] === 'string' && typeof p['fin'] === 'string' ? ` del ${etiquetaFechaHora(p['inicio'])} al ${etiquetaFechaHora(p['fin'])}` : '';
      return `Karen anuncia ${texto(p['etiqueta'])} con ${m.length} ${plural(m.length, 'modelo', 'modelos')}${fechas}: ${enumerar(m)}. Confirma condiciones antes de pedir. No cambia ningún costo.`;
    }
    case 'P-11': {
      const fin = typeof p['fin'] === 'string' ? etiquetaFechaHora(p['fin']) : 'pronto';
      return `La promoción de Karen (${texto(p['etiqueta'])}) termina el ${fin}.`;
    }
    case 'P-12':
      return `Terminó la promoción de Karen: ${texto(p['etiqueta'])}.`;
    case 'P-17': {
      const h = typeof p['horas'] === 'number' ? ` desde hace ${Math.round(p['horas'])} horas` : '';
      const ultima = typeof p['ultimaLectura'] === 'string' ? ` Los datos son del ${etiquetaFechaHora(p['ultimaLectura'])}.` : '';
      return `El Inventario de Karen ${etiquetaIncidente(texto(p['incidente']))}${h}.${ultima} Si persiste, el plan alterno es pedir la lista a Karen.`;
    }
    case 'P-18':
      return `Lectura retenida: ${texto(p['detalle'])}. No se publicó ningún aviso de cambio. Revisa antes de confiar en estos datos.`;
    case 'P-19': {
      const n = numero(p['cantidad']);
      return `${n} ${plural(n, 'nombre', 'nombres')} del Inventario de Karen por confirmar contra tu catálogo.`;
    }
    case 'P-20': {
      const s = lista(p['inestables']);
      return `${s.length} ${plural(s.length, 'sabor inestable', 'sabores inestables')} en Karen (cambian de estado varias veces al día): ${enumerar(s)}. Se silencian sus avisos 48 horas.`;
    }
    case 'V-1':
      return `Poca variedad en Karen: ${texto(p['modelo'])} tiene ${numero(p['disponibles'])} sabores disponibles (su base reciente es ${numero(p['base'])}).`;
  }
}
