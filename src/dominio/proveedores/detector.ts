// Detector de cambios del catalogo del proveedor. Funcion pura: recibe el estado vigente, una lectura valida y un instante; devuelve
// el estado nuevo y los eventos confirmados.
//
// Reglas (informe 25b, seccion 2, y adenda 24):
//  - La primera lectura valida fija la base y es SILENCIOSA: cero eventos y cero avisos.
//  - Todo cambio nace CANDIDATO y se confirma al verse en una lectura valida posterior (la de confirmacion a los 10 minutos o la
//    siguiente). Un cambio que se revierte antes de confirmarse (parpadeo) se descarta sin avisar.
//  - Descontinuado: ausente en 3 lecturas validas consecutivas Y al menos 24 horas desde la primera ausencia.
//  - Un sabor que cambia 3 o mas veces en 24 horas se marca "inestable" 48 horas y deja de avisar de forma individual.
//  - Una lectura con caida anomala se retiene; "Es real" la publica una vez, "Ignorar" la descarta.
// Se identifica siempre por id del proveedor, nunca por nombre.

import { evaluarAnomalia } from './validacion';
import { evaluarVariedad } from './variedad';
import { derivarMarcaYPuffs, elementoDeCola, encolar, mapeoDeModelo, mapeoDeSabor, normalizarModelo, normalizarSabor, resolverModelo, resolverSabor } from './normalizador';
import type { ContextoNormalizacion } from './normalizador';
import { MS_HORA, horasEntre, sumarMs } from './tipos';
import type {
  Candidato,
  DatoEvento,
  ElementoCola,
  EstadoProveedor,
  EventoCambio,
  Instante,
  LecturaCatalogo,
  ModeloProveedor,
  ProductoLeido,
  TipoCandidato,
  TipoEvento,
  VarianteLeida,
  VarianteProveedor,
} from './tipos';

export const LECTURAS_PARA_CONFIRMAR = 2;
export const LECTURAS_PARA_DESCONTINUAR = 3;
export const HORAS_PARA_DESCONTINUAR = 24;
export const CAMBIOS_PARA_INESTABLE = 3;
export const HORAS_VENTANA_INESTABLE = 24;
export const HORAS_INESTABLE = 48;

export interface ContextoSocios {
  /** "Modelo activo para los socios": ventas en 60 dias o existencia propia mayor que 0. */
  modeloActivo(m: ModeloProveedor): boolean;
  /** Sabor que los socios venden (ventas en 60 dias o existencia propia mayor que 0). */
  saborDeSocios(v: VarianteProveedor, m: ModeloProveedor): boolean;
}

export const SOCIOS_NINGUNO: ContextoSocios = { modeloActivo: () => false, saborDeSocios: () => false };

export interface ContextoDeteccion {
  normalizacion: ContextoNormalizacion;
  socios: ContextoSocios;
}

export interface EntradaLectura {
  /** Clave unica de la lectura (`fuente|fecha|hora`). */
  clave: string;
  en: Instante;
  lectura: LecturaCatalogo;
}

export interface OpcionesProceso {
  /** Un socio confirmo "Es real": se publica sin esperar segunda lectura ni revisar la anomalia. */
  confirmarDirecto?: boolean;
}

export interface ResultadoProceso {
  estado: EstadoProveedor;
  eventos: EventoCambio[];
  resultado: 'inicial' | 'ok' | 'sospechosa';
  /** Quedan candidatos por confirmar: conviene una lectura de confirmacion a los 10 minutos. */
  hayCandidatos: boolean;
  /** Elementos que entraron a la cola de confirmacion en esta lectura (para P-19). */
  colaNueva: ElementoCola[];
}

function clavesDelEvento(tipo: TipoEvento, productoId: string | null, varianteId: string | null, lectura: string): string {
  return `${tipo}|${productoId ?? ''}|${varianteId ?? ''}|${lectura}`;
}

// ---------------------------------------------------------------- construccion de entidades

function crearModelo(p: ProductoLeido, en: Instante, ctx: ContextoNormalizacion, nuevo: boolean): { modelo: ModeloProveedor; cola: ElementoCola | null } {
  const { marca, puffs } = derivarMarcaYPuffs(p.titulo);
  const resolucion = resolverModelo(p.titulo, ctx);
  const map = mapeoDeModelo(resolucion);
  let cola: ElementoCola | null = null;
  if (resolucion.tipo === 'sugerido') cola = elementoDeCola('modelo', p.titulo, en, resolucion.canonicoId, resolucion.similitud);
  else if (resolucion.tipo === 'grupo') cola = elementoDeCola('modelo', p.titulo, en, null, null);
  const modelo: ModeloProveedor = {
    id: p.id,
    handle: p.handle,
    titulo: p.titulo,
    tituloNorm: normalizarModelo(p.titulo),
    aliasTitulos: [],
    marca,
    puffs,
    estado: 'activo',
    primeraVez: en,
    ultimaVez: en,
    ausencias: 0,
    primeraAusencia: null,
    sinSabores: !p.variantes.some((v) => v.disponible),
    nuevoSinCosto: nuevo && map.canonicoId === null,
    mapeo: map.mapeo,
    canonicoId: map.canonicoId,
    gruposCandidatos: map.gruposCandidatos,
  };
  return { modelo, cola };
}

function crearVariante(v: VarianteLeida, en: Instante, ctx: ContextoNormalizacion): { variante: VarianteProveedor; cola: ElementoCola | null } {
  const resolucion = resolverSabor(v.sabor, ctx);
  const map = mapeoDeSabor(resolucion);
  const cola = resolucion.tipo === 'por_confirmar' ? elementoDeCola('sabor', v.sabor, en, resolucion.saborId, resolucion.similitud) : null;
  return {
    variante: {
      id: v.id,
      productoId: v.productoId,
      saborOriginal: v.sabor,
      saborNorm: normalizarSabor(v.sabor),
      disponible: v.disponible,
      estado: 'activa',
      ausencias: 0,
      primeraAusencia: null,
      mapeo: map.mapeo,
      saborCanonicoId: map.saborCanonicoId,
      cambios: [],
      inestableHasta: null,
      primeraVez: en,
      ultimaVez: en,
    },
    cola,
  };
}

function agregarCola(estado: EstadoProveedor, elemento: ElementoCola | null, nuevos: ElementoCola[]): void {
  if (!elemento) return;
  const r = encolar(estado.cola, elemento);
  estado.cola = r.cola;
  if (r.agregado) nuevos.push(elemento);
}

// ---------------------------------------------------------------- carga inicial

function cargaInicial(previo: EstadoProveedor, entrada: EntradaLectura, ctx: ContextoDeteccion): ResultadoProceso {
  const estado = structuredClone(previo);
  const ignorados: ElementoCola[] = [];
  for (const p of entrada.lectura.productos) {
    const { modelo, cola } = crearModelo(p, entrada.en, ctx.normalizacion, false);
    estado.modelos[p.id] = modelo;
    agregarCola(estado, cola, ignorados);
    for (const v of p.variantes) {
      const r = crearVariante(v, entrada.en, ctx.normalizacion);
      estado.variantes[v.id] = r.variante;
      agregarCola(estado, r.cola, ignorados);
    }
  }
  estado.inicializado = true;
  evaluarVariedad(estado, entrada.en, entrada.clave, ctx.socios);
  // Silenciosa: ni eventos ni elementos nuevos de cola para avisar.
  return { estado, eventos: [], resultado: 'inicial', hayCandidatos: false, colaNueva: [] };
}

// ---------------------------------------------------------------- proceso principal

export function procesarLectura(previo: EstadoProveedor, entrada: EntradaLectura, ctx: ContextoDeteccion, opciones: OpcionesProceso = {}): ResultadoProceso {
  if (!previo.inicializado) return cargaInicial(previo, entrada, ctx);

  if (!opciones.confirmarDirecto) {
    const veredicto = evaluarAnomalia(previo, entrada.lectura);
    if (veredicto.estado === 'sospechosa') return retener(previo, entrada, veredicto.razon, veredicto.detalle);
  }

  const estado = structuredClone(previo);
  estado.retenida = null;
  const { en, clave } = entrada;
  const eventos: EventoCambio[] = [];
  const colaNueva: ElementoCola[] = [];
  const evento = (tipo: TipoEvento, productoId: string | null, varianteId: string | null, antes: string | null, despues: string | null, datos: Record<string, DatoEvento>): void => {
    eventos.push({ clave: clavesDelEvento(tipo, productoId, varianteId, clave), tipo, productoId, varianteId, lectura: clave, en, antes, despues, datos });
  };

  const productosVistos = new Map<string, ProductoLeido>();
  const variantesVistas = new Map<string, VarianteLeida>();
  for (const p of entrada.lectura.productos) {
    productosVistos.set(p.id, p);
    for (const v of p.variantes) variantesVistas.set(v.id, v);
  }

  // --- 1. Observacion: candidatos y presencia
  const observados = new Map<string, Omit<Candidato, 'primeraVista' | 'lecturasVistas' | 'ultimaLectura'>>();
  const observar = (tipo: TipoCandidato, entidadId: string, productoId: string, valor: string): void => {
    const c = `${tipo}|${entidadId}|${valor}`;
    observados.set(c, { clave: c, tipo, entidadId, productoId, valor });
  };

  for (const p of entrada.lectura.productos) {
    const m = estado.modelos[p.id];
    if (!m) {
      if (p.variantes.length > 0) observar('modelo_nuevo', p.id, p.id, '');
      continue;
    }
    if (m.estado !== 'activo') {
      const eraDescontinuado = m.estado === 'descontinuado';
      m.estado = 'activo';
      if (eraDescontinuado) evento('modelo_regreso_catalogo', m.id, null, null, null, { modelo: m.titulo });
    }
    m.ausencias = 0;
    m.primeraAusencia = null;
    m.ultimaVez = en;
    m.handle = p.handle || m.handle;
    const normNueva = normalizarModelo(p.titulo);
    if (normNueva !== m.tituloNorm) observar('renombrado_modelo', m.id, m.id, p.titulo);
    else m.titulo = p.titulo;

    for (const v of p.variantes) {
      const vv = estado.variantes[v.id];
      if (!vv) {
        observar('sabor_nuevo', v.id, p.id, v.sabor);
        continue;
      }
      vv.ausencias = 0;
      vv.primeraAusencia = null;
      vv.estado = 'activa';
      vv.ultimaVez = en;
      if (vv.disponible !== v.disponible) observar(v.disponible ? 'regreso' : 'agotado', v.id, p.id, String(v.disponible));
      if (normalizarSabor(v.sabor) !== vv.saborNorm) observar('renombrado_sabor', v.id, p.id, v.sabor);
      else vv.saborOriginal = v.sabor;
    }
  }

  // --- 2. Ausencias (descontinuado: 3 lecturas validas y 24 horas)
  for (const m of Object.values(estado.modelos)) {
    if (productosVistos.has(m.id) || m.estado === 'descontinuado') continue;
    m.ausencias += 1;
    if (m.primeraAusencia === null) m.primeraAusencia = en;
    if (m.estado === 'activo') m.estado = 'no_visto';
    if (m.ausencias >= LECTURAS_PARA_DESCONTINUAR && horasEntre(m.primeraAusencia, en) >= HORAS_PARA_DESCONTINUAR) {
      m.estado = 'descontinuado';
      for (const v of Object.values(estado.variantes)) if (v.productoId === m.id) v.estado = 'descontinuada';
      evento('modelo_descontinuado', m.id, null, null, null, { modelo: m.titulo, activo: ctx.socios.modeloActivo(m) });
    }
  }
  for (const v of Object.values(estado.variantes)) {
    if (variantesVistas.has(v.id) || v.estado === 'descontinuada') continue;
    const m = estado.modelos[v.productoId];
    if (!m || !productosVistos.has(m.id)) continue;
    v.ausencias += 1;
    if (v.primeraAusencia === null) v.primeraAusencia = en;
    v.estado = 'no_vista';
    if (v.ausencias >= LECTURAS_PARA_DESCONTINUAR && horasEntre(v.primeraAusencia, en) >= HORAS_PARA_DESCONTINUAR) {
      v.estado = 'descontinuada';
      evento('sabor_descontinuado', m.id, v.id, null, null, { modelo: m.titulo, sabor: v.saborOriginal });
    }
  }

  // --- 3. Candidatos: se descartan los que ya no se ven (parpadeo) y se confirman los vistos en una lectura posterior
  const confirmados: Candidato[] = [];
  const siguientes: Record<string, Candidato> = {};
  for (const [c, obs] of observados) {
    const previoC = estado.candidatos[c];
    if (!previoC) {
      const nuevo: Candidato = { ...obs, primeraVista: en, lecturasVistas: 1, ultimaLectura: clave };
      if (opciones.confirmarDirecto) confirmados.push(nuevo);
      else siguientes[c] = nuevo;
      continue;
    }
    const vistas = previoC.ultimaLectura === clave ? previoC.lecturasVistas : previoC.lecturasVistas + 1;
    const actualizado: Candidato = { ...previoC, lecturasVistas: vistas, ultimaLectura: clave };
    if (actualizado.lecturasVistas >= LECTURAS_PARA_CONFIRMAR) confirmados.push(actualizado);
    else siguientes[c] = actualizado;
  }
  estado.candidatos = siguientes;

  // Orden estable: modelos nuevos primero (sus sabores nacen con ellos), luego sabores nuevos y el resto.
  const orden: TipoCandidato[] = ['modelo_nuevo', 'sabor_nuevo', 'renombrado_modelo', 'renombrado_sabor', 'agotado', 'regreso'];
  confirmados.sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo));

  for (const c of confirmados) aplicarConfirmado(c, estado, productosVistos, variantesVistas, ctx, en, evento, colaNueva);

  // --- 4. Modelos que se quedaron sin sabores (V-2) y regreso de sabores al modelo
  for (const m of Object.values(estado.modelos)) {
    if (m.estado === 'descontinuado') continue;
    const activos = Object.values(estado.variantes).filter((v) => v.productoId === m.id && v.estado !== 'descontinuada');
    const hayDisponible = activos.some((v) => v.disponible);
    if (!hayDisponible && !m.sinSabores && activos.length > 0) {
      m.sinSabores = true;
      evento('modelo_agotado', m.id, null, null, null, { modelo: m.titulo, activo: ctx.socios.modeloActivo(m) });
    } else if (hayDisponible && m.sinSabores) {
      m.sinSabores = false;
    }
  }

  // --- 5. Variedad (V-1)
  eventos.push(...evaluarVariedad(estado, en, clave, ctx.socios));

  return { estado, eventos, resultado: 'ok', hayCandidatos: Object.keys(estado.candidatos).length > 0, colaNueva };
}

// ---------------------------------------------------------------- aplicar un candidato confirmado

type Registrar = (tipo: TipoEvento, productoId: string | null, varianteId: string | null, antes: string | null, despues: string | null, datos: Record<string, DatoEvento>) => void;

function aplicarConfirmado(
  c: Candidato,
  estado: EstadoProveedor,
  productos: Map<string, ProductoLeido>,
  variantes: Map<string, VarianteLeida>,
  ctx: ContextoDeteccion,
  en: Instante,
  evento: Registrar,
  colaNueva: ElementoCola[],
): void {
  switch (c.tipo) {
    case 'modelo_nuevo': {
      const p = productos.get(c.entidadId);
      if (!p || estado.modelos[p.id]) return;
      const { modelo, cola } = crearModelo(p, en, ctx.normalizacion, true);
      estado.modelos[p.id] = modelo;
      agregarCola(estado, cola, colaNueva);
      for (const v of p.variantes) {
        const r = crearVariante(v, en, ctx.normalizacion);
        estado.variantes[v.id] = r.variante;
        agregarCola(estado, r.cola, colaNueva);
      }
      const disponibles = p.variantes.filter((v) => v.disponible).length;
      evento('modelo_nuevo', p.id, null, null, null, { modelo: p.titulo, marca: modelo.marca, sabores: p.variantes.length, disponibles });
      return;
    }
    case 'sabor_nuevo': {
      const v = variantes.get(c.entidadId);
      const m = estado.modelos[c.productoId];
      if (!v || !m || estado.variantes[v.id]) return;
      const r = crearVariante(v, en, ctx.normalizacion);
      estado.variantes[v.id] = r.variante;
      agregarCola(estado, r.cola, colaNueva);
      m.sinSabores = m.sinSabores && !v.disponible;
      evento('sabor_nuevo', m.id, v.id, null, v.sabor, { modelo: m.titulo, sabor: v.sabor, disponible: v.disponible, activo: ctx.socios.modeloActivo(m) });
      return;
    }
    case 'agotado':
    case 'regreso': {
      const vv = estado.variantes[c.entidadId];
      const m = estado.modelos[c.productoId];
      if (!vv || !m) return;
      const disponible = c.tipo === 'regreso';
      if (vv.disponible === disponible) return;
      vv.disponible = disponible;
      const desde = Date.parse(en) - HORAS_VENTANA_INESTABLE * MS_HORA;
      vv.cambios = [...vv.cambios.filter((t) => Date.parse(t) > desde), en];
      let inestable = vv.inestableHasta !== null && Date.parse(vv.inestableHasta) > Date.parse(en);
      if (!inestable && vv.cambios.length >= CAMBIOS_PARA_INESTABLE) {
        vv.inestableHasta = sumarMs(en, HORAS_INESTABLE * MS_HORA);
        inestable = true;
        evento('inestable', m.id, vv.id, null, null, { modelo: m.titulo, sabor: vv.saborOriginal });
      }
      evento(disponible ? 'sabor_regreso' : 'sabor_agotado', m.id, vv.id, String(!disponible), String(disponible), {
        modelo: m.titulo,
        sabor: vv.saborOriginal,
        deSocios: ctx.socios.saborDeSocios(vv, m),
        inestable,
      });
      return;
    }
    case 'renombrado_modelo': {
      const p = productos.get(c.entidadId);
      const m = estado.modelos[c.entidadId];
      if (!p || !m) return;
      const antes = m.titulo;
      const canonAntes = m.canonicoId;
      m.aliasTitulos = [...m.aliasTitulos, antes];
      m.titulo = p.titulo;
      m.tituloNorm = normalizarModelo(p.titulo);
      const { marca, puffs } = derivarMarcaYPuffs(p.titulo);
      m.marca = marca;
      m.puffs = puffs;
      const resolucion = resolverModelo(p.titulo, ctx.normalizacion);
      const nuevo = mapeoDeModelo(resolucion);
      let rompeMapeo = false;
      if (canonAntes !== null && nuevo.canonicoId !== canonAntes) {
        // Se conserva el vinculo con el modelo propio, pero queda por confirmar.
        rompeMapeo = true;
        m.mapeo = 'pendiente';
        agregarCola(estado, elementoDeCola('modelo', p.titulo, en, canonAntes, null), colaNueva);
      } else if (canonAntes === null) {
        m.mapeo = nuevo.mapeo;
        m.canonicoId = nuevo.canonicoId;
        m.gruposCandidatos = nuevo.gruposCandidatos;
      }
      evento('renombrado', m.id, null, antes, p.titulo, { entidad: 'modelo', modeloAnterior: antes, modeloNuevo: p.titulo, rompeMapeo });
      return;
    }
    case 'renombrado_sabor': {
      const v = variantes.get(c.entidadId);
      const vv = estado.variantes[c.entidadId];
      const m = estado.modelos[c.productoId];
      if (!v || !vv || !m) return;
      const antes = vv.saborOriginal;
      vv.saborOriginal = v.sabor;
      vv.saborNorm = normalizarSabor(v.sabor);
      const r = resolverSabor(v.sabor, ctx.normalizacion);
      const map = mapeoDeSabor(r);
      vv.mapeo = map.mapeo;
      vv.saborCanonicoId = map.saborCanonicoId;
      if (r.tipo === 'por_confirmar') agregarCola(estado, elementoDeCola('sabor', v.sabor, en, r.saborId, r.similitud), colaNueva);
      evento('renombrado', m.id, vv.id, antes, v.sabor, { entidad: 'sabor', modelo: m.titulo, rompeMapeo: false });
      return;
    }
  }
}

// ---------------------------------------------------------------- retencion de lecturas sospechosas

function retener(previo: EstadoProveedor, entrada: EntradaLectura, razon: string, detalle: string): ResultadoProceso {
  const estado = structuredClone(previo);
  const eventos: EventoCambio[] = [];
  const ya = estado.retenida;
  estado.retenida = { desde: ya?.desde ?? entrada.en, veces: (ya?.veces ?? 0) + 1, razon: detalle, avisado: true, clave: entrada.clave, lectura: entrada.lectura };
  if (!ya) {
    eventos.push({
      clave: clavesDelEvento('lectura_retenida', null, null, entrada.clave),
      tipo: 'lectura_retenida',
      productoId: null,
      varianteId: null,
      lectura: entrada.clave,
      en: entrada.en,
      antes: null,
      despues: razon,
      datos: { detalle },
    });
  }
  return { estado, eventos, resultado: 'sospechosa', hayCandidatos: false, colaNueva: [] };
}

/** Decision de un socio sobre una lectura retenida: "Es real" la publica una vez; "Ignorar" la descarta. */
export function resolverRetencion(previo: EstadoProveedor, decision: 'es_real' | 'ignorar', en: Instante, ctx: ContextoDeteccion): ResultadoProceso {
  const retenida = previo.retenida;
  if (!retenida) return { estado: previo, eventos: [], resultado: 'ok', hayCandidatos: Object.keys(previo.candidatos).length > 0, colaNueva: [] };
  const sinRetencion = structuredClone(previo);
  sinRetencion.retenida = null;
  if (decision === 'ignorar') return { estado: sinRetencion, eventos: [], resultado: 'ok', hayCandidatos: Object.keys(sinRetencion.candidatos).length > 0, colaNueva: [] };
  return procesarLectura(sinRetencion, { clave: `${retenida.clave}|confirmada`, en, lectura: retenida.lectura }, ctx, { confirmarDirecto: true });
}
