// Resolucion de una intencion (textos del modelo) a ids del catalogo. Pura sobre el catalogo: sin IA.
// Cualquier ambiguedad, ausencia o duda devuelve una PREGUNTA; nunca un valor por omision.
import type { ILineaCompraTexto, Intencion, IConsulta } from '@/dominio/agente/intenciones';
import {
  ID_TOMA_OMAR_BODEGA,
  resolverCliente,
  resolverModelo,
  resolverProveedor,
  resolverSabor,
  type Candidato,
  type EntradaCatalogo,
  type IdProveedor,
} from '@/dominio/agente/resolutor';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { Miembro } from '@/dominio/agente/tipos';
import type { AccionResuelta, CatalogoAgente, Resoluciones } from './puertos';

export type Overrides = Readonly<Record<string, string>>;

export type PreguntaAbierta =
  | { tipo: 'elegir'; clave: string; campo: string; textoUsuario: string; candidatos: Candidato[] }
  | { tipo: 'no_encontrado'; clave: string; campo: string; textoUsuario: string; sugerencias: Candidato[] };

export type SalidaResolucion = { ok: true; resuelta: AccionResuelta } | { ok: false; pregunta: PreguntaAbierta };

const KEYWORDS_SUJETO = new Set(['omar', 'isaac', 'karen', 'vapemate', 'socios', 'socio', 'angelo', 'javier']);

type ResultadoCampo = { ok: true; id: string } | { ok: false; pregunta: PreguntaAbierta };

function desdeResolucion(
  clave: string,
  campo: string,
  textoUsuario: string,
  r: ReturnType<typeof resolverModelo>,
): ResultadoCampo {
  switch (r.estado) {
    case 'unico':
      return { ok: true, id: r.id };
    case 'varios':
      return { ok: false, pregunta: { tipo: 'elegir', clave, campo, textoUsuario, candidatos: r.candidatos } };
    case 'ninguno':
      return { ok: false, pregunta: { tipo: 'no_encontrado', clave, campo, textoUsuario, sugerencias: r.sugerencias } };
    case 'vacio':
      return { ok: false, pregunta: { tipo: 'no_encontrado', clave, campo, textoUsuario, sugerencias: [] } };
  }
}

async function cliente(texto: string, autor: Miembro, catalogo: CatalogoAgente, overrides: Overrides): Promise<ResultadoCampo> {
  const previo = overrides.cliente;
  if (previo !== undefined) return { ok: true, id: previo };
  const r = resolverCliente(texto, await catalogo.clientes(), autor);
  if (r.estado === 'toma_propia') return { ok: true, id: ID_TOMA_OMAR_BODEGA };
  return desdeResolucion('cliente', 'cliente', texto, r);
}

function proveedor(texto: string, overrides: Overrides): { ok: true; id: IdProveedor } | { ok: false; pregunta: PreguntaAbierta } {
  const previo = overrides.proveedor;
  if (previo === 'isaac' || previo === 'karen') return { ok: true, id: previo };
  const r = resolverProveedor(texto);
  if (r.estado === 'unico') return { ok: true, id: r.id };
  if (r.estado === 'varios') return { ok: false, pregunta: { tipo: 'elegir', clave: 'proveedor', campo: 'proveedor', textoUsuario: texto, candidatos: r.candidatos } };
  return { ok: false, pregunta: { tipo: 'no_encontrado', clave: 'proveedor', campo: 'proveedor', textoUsuario: texto, sugerencias: [] } };
}

async function modeloYSabor(
  i: number,
  l: Pick<ILineaCompraTexto, 'modelo_texto' | 'sabor_texto'>,
  catalogo: CatalogoAgente,
  modelos: readonly EntradaCatalogo[],
  overrides: Overrides,
  exigirSabor = false,
): Promise<{ ok: true; modeloId: string; saborId: string | null } | { ok: false; pregunta: PreguntaAbierta }> {
  const claveModelo = `lineas.${i}.modelo`;
  const previo = overrides[claveModelo];
  let modeloId: string;
  if (previo !== undefined) {
    modeloId = previo;
  } else {
    const m = desdeResolucion(claveModelo, 'modelo', l.modelo_texto, resolverModelo(l.modelo_texto, modelos));
    if (!m.ok) return m;
    modeloId = m.id;
  }
  const claveSabor = `lineas.${i}.sabor`;
  if (l.sabor_texto === null) {
    if (!exigirSabor) return { ok: true, modeloId, saborId: null };
    const previoS = overrides[claveSabor];
    if (previoS !== undefined) return { ok: true, modeloId, saborId: previoS };
    const opciones = (await catalogo.saboresEnExistencia(modeloId)).slice(0, 4).map((e) => ({ id: e.id, nombre: e.nombre }));
    return opciones.length > 0
      ? { ok: false, pregunta: { tipo: 'elegir', clave: claveSabor, campo: 'sabor', textoUsuario: '(sin sabor)', candidatos: opciones } }
      : { ok: false, pregunta: { tipo: 'no_encontrado', clave: claveSabor, campo: 'sabor', textoUsuario: '(sin sabor)', sugerencias: [] } };
  }

  const saborPrevio = overrides[claveSabor];
  if (saborPrevio !== undefined) return { ok: true, modeloId, saborId: saborPrevio };
  const enExistencia = await catalogo.saboresEnExistencia(modeloId);
  const s = resolverSabor(l.sabor_texto, enExistencia);
  if (s.estado === 'unico') return { ok: true, modeloId, saborId: s.id };
  if (s.estado === 'ninguno' || s.estado === 'vacio') {
    // Se pregunta con los sabores EN EXISTENCIA de ese modelo; si no hay ninguno, no se puede ofrecer nada.
    const opciones = enExistencia.slice(0, 4).map((e) => ({ id: e.id, nombre: e.nombre }));
    return opciones.length > 0
      ? { ok: false, pregunta: { tipo: 'elegir', clave: claveSabor, campo: 'sabor', textoUsuario: l.sabor_texto, candidatos: opciones } }
      : { ok: false, pregunta: { tipo: 'no_encontrado', clave: claveSabor, campo: 'sabor', textoUsuario: l.sabor_texto, sugerencias: [] } };
  }
  return { ok: false, pregunta: { tipo: 'elegir', clave: claveSabor, campo: 'sabor', textoUsuario: l.sabor_texto, candidatos: s.candidatos } };
}

const VACIAS = (): Resoluciones => ({ clienteId: null, proveedorId: null, lineas: [], modeloId: null });

async function lineas(
  ls: readonly Pick<ILineaCompraTexto, 'modelo_texto' | 'sabor_texto'>[],
  catalogo: CatalogoAgente,
  overrides: Overrides,
  exigirSabor = false,
): Promise<{ ok: true; lineas: Resoluciones['lineas'] } | { ok: false; pregunta: PreguntaAbierta }> {
  const modelos = await catalogo.modelos();
  const salida: Resoluciones['lineas'] = [];
  for (let i = 0; i < ls.length; i++) {
    const r = await modeloYSabor(i, ls[i]!, catalogo, modelos, overrides, exigirSabor);
    if (!r.ok) return r;
    salida.push({ modeloId: r.modeloId, saborId: r.saborId });
  }
  return { ok: true, lineas: salida };
}

async function consulta(c: IConsulta, autor: Miembro, catalogo: CatalogoAgente, overrides: Overrides): Promise<SalidaResolucion> {
  const res = VACIAS();
  if (c.modelo_texto !== null && (c.consulta === 'inventario' || c.consulta === 'precio' || c.consulta === 'cobertura')) {
    const previo = overrides.modelo;
    if (previo !== undefined) {
      res.modeloId = previo;
    } else {
      const m = desdeResolucion('modelo', 'modelo', c.modelo_texto, resolverModelo(c.modelo_texto, await catalogo.modelos()));
      if (!m.ok) return m;
      res.modeloId = m.id;
    }
  }
  if (c.sujeto_texto !== null && (c.consulta === 'saldo' || c.consulta === 'precio' || c.consulta === 'pedido') && !KEYWORDS_SUJETO.has(normalizar(c.sujeto_texto))) {
    const k = await cliente(c.sujeto_texto, autor, catalogo, overrides);
    if (!k.ok) return k;
    res.clienteId = k.id;
  }
  return { ok: true, resuelta: { intencion: c, resoluciones: res } };
}

/**
 * Resuelve una intencion de escritura o de consulta. `overrides` trae las respuestas a preguntas anteriores (clave -> id elegido).
 * Un pedido cuyo cliente resulta ser la toma de la bodega de Omar se convierte en toma (queda pendiente de autorizacion).
 */
export async function resolverAccion(intencion: Intencion, autor: Miembro, catalogo: CatalogoAgente, overrides: Overrides = {}, exigirSabor = false): Promise<SalidaResolucion> {
  const res = VACIAS();
  switch (intencion.tipo) {
    case 'pedido': {
      const k = await cliente(intencion.cliente_texto, autor, catalogo, overrides);
      if (!k.ok) return k;
      if (k.id === ID_TOMA_OMAR_BODEGA) {
        const toma: Intencion = {
          tipo: 'toma_omar',
          fuente_cita: intencion.fuente_cita,
          lineas: intencion.lineas.map((l) => ({ modelo_texto: l.modelo_texto, sabor_texto: l.sabor_texto, piezas: l.piezas })),
        };
        return resolverAccion(toma, autor, catalogo, overrides);
      }
      const ls = await lineas(intencion.lineas, catalogo, overrides, exigirSabor);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, clienteId: k.id, lineas: ls.lineas } } };
    }
    case 'pago': {
      const k = await cliente(intencion.cliente_texto, autor, catalogo, overrides);
      if (!k.ok) return k;
      if (k.id === ID_TOMA_OMAR_BODEGA) {
        return { ok: false, pregunta: { tipo: 'no_encontrado', clave: 'cliente', campo: 'cliente', textoUsuario: intencion.cliente_texto, sugerencias: [] } };
      }
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, clienteId: k.id } } };
    }
    case 'pago_proveedor': {
      const p = proveedor(intencion.proveedor_texto, overrides);
      if (!p.ok) return p;
      let clienteId: string | null = null;
      if (intencion.cliente_texto !== null) {
        const k = await cliente(intencion.cliente_texto, autor, catalogo, overrides);
        if (!k.ok) return k;
        clienteId = k.id;
      }
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, proveedorId: p.id, clienteId } } };
    }
    case 'compra':
    case 'orden_compra': {
      const p = proveedor(intencion.proveedor_texto, overrides);
      if (!p.ok) return p;
      const ls = await lineas(intencion.lineas, catalogo, overrides, exigirSabor);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, proveedorId: p.id, lineas: ls.lineas } } };
    }
    case 'devolucion': {
      const k = await cliente(intencion.cliente_texto, autor, catalogo, overrides);
      if (!k.ok) return k;
      if (k.id === ID_TOMA_OMAR_BODEGA) {
        return { ok: false, pregunta: { tipo: 'no_encontrado', clave: 'cliente', campo: 'cliente', textoUsuario: intencion.cliente_texto, sugerencias: [] } };
      }
      const ls = await lineas(intencion.lineas, catalogo, overrides);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, clienteId: k.id, lineas: ls.lineas } } };
    }
    case 'paquete_perdido': {
      if (intencion.cliente_texto === null) return { ok: true, resuelta: { intencion, resoluciones: res } };
      const k = await cliente(intencion.cliente_texto, autor, catalogo, overrides);
      if (!k.ok) return k;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, clienteId: k.id === ID_TOMA_OMAR_BODEGA ? null : k.id } } };
    }
    case 'toma_omar': {
      const ls = await lineas(intencion.lineas, catalogo, overrides);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, lineas: ls.lineas } } };
    }
    case 'compra_recepcion': {
      if (intencion.lineas.length === 0) return { ok: true, resuelta: { intencion, resoluciones: res } };
      const ls = await lineas(intencion.lineas, catalogo, overrides, true);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, lineas: ls.lineas } } };
    }
    case 'conteo': {
      const ls = await lineas(intencion.lineas, catalogo, overrides, true);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, lineas: ls.lineas } } };
    }
    case 'merma': {
      const ls = await lineas([intencion], catalogo, overrides, true);
      if (!ls.ok) return ls;
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, lineas: ls.lineas } } };
    }
    case 'cliente_precio': {
      const k = await cliente(intencion.cliente_texto, autor, catalogo, overrides);
      if (!k.ok) return k;
      if (k.id === ID_TOMA_OMAR_BODEGA) return { ok: false, pregunta: { tipo: 'no_encontrado', clave: 'cliente', campo: 'cliente', textoUsuario: intencion.cliente_texto, sugerencias: [] } };
      const previo = overrides.modelo;
      let modeloId: string;
      if (previo !== undefined) modeloId = previo;
      else {
        const m = desdeResolucion('modelo', 'modelo', intencion.modelo_texto, resolverModelo(intencion.modelo_texto, await catalogo.modelos()));
        if (!m.ok) return m;
        modeloId = m.id;
      }
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, clienteId: k.id, modeloId } } };
    }
    case 'lote_historico': {
      const clientes: Record<string, string> = {};
      for (const [i, r] of intencion.renglones.entries()) {
        if (r.tipo !== 'cobro' || r.cliente_texto === null) continue;
        const previo = overrides[`renglon.${i}.cliente`];
        if (previo !== undefined) { clientes[String(i)] = previo; continue; }
        const rc = resolverCliente(r.cliente_texto, await catalogo.clientes(), autor);
        const d = desdeResolucion(`renglon.${i}.cliente`, 'cliente', r.cliente_texto, rc.estado === 'toma_propia' ? { estado: 'ninguno', sugerencias: [] } : rc);
        if (!d.ok) return d;
        clientes[String(i)] = d.id;
      }
      return { ok: true, resuelta: { intencion, resoluciones: { ...res, clientesLote: clientes } } };
    }
    case 'consulta':
      return consulta(intencion, autor, catalogo, overrides);
    case 'pedido_envio':
    case 'pedido_cancelar':
    case 'compra_aprobar':
    case 'compra_estado':
    case 'gasto_servicio':
    case 'cliente_alta':
    case 'acta_propuesta':
    case 'acta_firma':
    case 'gasto':
    case 'aportacion':
    case 'reembolso_socio':
    case 'retiro_utilidad':
    case 'deshacer':
    case 'aclarar':
    case 'ninguna':
      return { ok: true, resuelta: { intencion, resoluciones: res } };
  }
}
