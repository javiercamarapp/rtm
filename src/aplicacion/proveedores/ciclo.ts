// Casos de uso del inventario actual de proveedores: lectura horaria, lectura de confirmacion a los 10 minutos, lectura de promociones,
// decision sobre una lectura retenida y reanudacion tras un bloqueo.
//
// Orden de cada lectura: pedir (con presupuesto) -> clasificar -> validar -> detectar -> emitir avisos -> guardar.
// Los avisos salen ANTES de guardar y son idempotentes por `claveDedupe`: si guardar falla, reintentar la misma lectura no duplica avisos;
// si fuera al reves, un fallo despues de guardar perderia el aviso sin que nadie lo notara.
// No hay IA en la ruta normal y nada aqui calcula dinero.

import { fechaNeg } from '@/dominio/calendario';
import { clasificarRespuesta, parsearCatalogo, TAMANO_PAGINA, unirPaginas } from '@/dominio/proveedores/catalogo_json';
import { construirAvisos } from '@/dominio/proveedores/avisos';
import { procesarLectura, resolverRetencion } from '@/dominio/proveedores/detector';
import { ErrorProveedor } from '@/dominio/proveedores/errores';
import { claveDeLectura, presupuestoDelDia, puedePedir, registrarPeticion, robotsPermite, RUTAS_DE_LECTURA } from '@/dominio/proveedores/fuente';
import type { PresupuestoDia, TipoPeticion } from '@/dominio/proveedores/fuente';
import { MINUTOS_CONFIRMACION } from '@/dominio/proveedores/politica';
import { exigirSinImportes } from '@/dominio/proveedores/privacidad';
import { campanasPorLeer, procesarPromociones } from '@/dominio/proveedores/promociones';
import { handlesDeColeccion, parsearPromociones } from '@/dominio/proveedores/promociones_html';
import { recordatorioPendiente, registrarExito, registrarFallo, registrarIntento, reanudarFuente } from '@/dominio/proveedores/salud';
import { sumarMs } from '@/dominio/proveedores/tipos';
import type { EstadoProveedor, EventoCambio, Instante, LecturaCatalogo, SolicitudAviso, TipoIncidente } from '@/dominio/proveedores/tipos';
import type { FilaFoto, PuertoAvisos, PuertoContextoNegocio, PuertoLecturaProveedor, Reloj, RepositorioInventarioProveedor } from './puertos';

export interface DepsCiclo {
  lector: PuertoLecturaProveedor;
  repo: RepositorioInventarioProveedor;
  contexto: PuertoContextoNegocio;
  avisos: PuertoAvisos;
  reloj: Reloj;
  /** Interruptor `promociones_lectura`: sin la autorizacion del dueno las promociones quedan desactivadas y todo lo demas sigue igual. */
  promocionesActivas: boolean;
}

export type EstadoCiclo = 'ok' | 'inicial' | 'sospechosa' | 'rechazada' | 'bloqueada' | 'error' | 'omitida' | 'duplicada';

export interface ResultadoCiclo {
  estado: EstadoCiclo;
  motivo: string | null;
  eventos: number;
  avisos: number;
  peticiones: number;
  /** Cuando hay cambios candidatos: instante en que conviene correr `ejecutarConfirmacion`. */
  programarConfirmacionEn: Instante | null;
}

function resultado(estado: EstadoCiclo, motivo: string | null, extra: Partial<ResultadoCiclo> = {}): ResultadoCiclo {
  return { estado, motivo, eventos: 0, avisos: 0, peticiones: 0, programarConfirmacionEn: null, ...extra };
}

async function emitirTodo(deps: DepsCiclo, avisos: SolicitudAviso[], resueltos: string[]): Promise<void> {
  for (const a of avisos) await deps.avisos.emitir(a);
  for (const r of resueltos) await deps.avisos.resolver(r);
}

async function guardar(deps: DepsCiclo, estado: EstadoProveedor, eventos: EventoCambio[], avisos: SolicitudAviso[]): Promise<void> {
  // Defensa en profundidad: ni el estado, ni los eventos, ni los avisos pueden llevar un importe.
  exigirSinImportes(estado);
  exigirSinImportes(eventos);
  exigirSinImportes(avisos);
  await deps.repo.guardarEstado(estado, eventos);
}

function fotoDe(estado: EstadoProveedor): FilaFoto[] {
  return Object.values(estado.variantes)
    .filter((v) => v.estado !== 'descontinuada')
    .map((v) => ({ varianteId: v.id, disponible: v.disponible }));
}

async function pedir(deps: DepsCiclo, presupuesto: PresupuestoDia, tipo: TipoPeticion): Promise<PresupuestoDia> {
  const nuevo = registrarPeticion(presupuesto, tipo);
  await deps.repo.guardarPresupuesto(nuevo);
  return nuevo;
}

// ---------------------------------------------------------------- lectura del catalogo (horaria y de confirmacion)

async function leerCatalogoCompleto(
  deps: DepsCiclo,
  inicial: PresupuestoDia,
  tipo: 'catalogo' | 'confirmacion',
): Promise<{ presupuesto: PresupuestoDia; peticiones: number } & ({ ok: true; lectura: LecturaCatalogo } | { ok: false; causa: TipoIncidente; motivo: string })> {
  let presupuesto = inicial;
  let peticiones = 0;
  const paginas: LecturaCatalogo[] = [];
  for (let pagina = 1; pagina <= 4; pagina++) {
    if (pagina > 1 && !puedePedir(presupuesto, tipo)) break;
    presupuesto = await pedir(deps, presupuesto, tipo);
    peticiones++;
    let cruda;
    try {
      cruda = await deps.lector.leerCatalogo(pagina);
    } catch (e) {
      // El mensaje de un error de red puede traer la direccion: solo se conserva el codigo.
      const codigo = e instanceof ErrorProveedor ? e.codigo : 'red';
      return { presupuesto, peticiones, ok: false, causa: 'sin_lectura', motivo: codigo };
    }
    const c = clasificarRespuesta(cruda);
    if (c.tipo === 'bloqueada') return { presupuesto, peticiones, ok: false, causa: 'bloqueada', motivo: c.motivo };
    if (c.tipo === 'error') return { presupuesto, peticiones, ok: false, causa: 'sin_lectura', motivo: c.motivo };
    if (c.tipo === 'no_json') return { presupuesto, peticiones, ok: false, causa: 'formato', motivo: 'respuesta_no_json' };
    const p = parsearCatalogo(c.valor);
    if (!p.ok) return { presupuesto, peticiones, ok: false, causa: p.motivo === 'catalogo_vacio' ? 'vacia' : 'formato', motivo: p.motivo };
    paginas.push(p.lectura);
    if (p.lectura.productos.length < TAMANO_PAGINA) break;
  }
  const unida = unirPaginas(paginas);
  if (!unida.ok) return { presupuesto, peticiones, ok: false, causa: 'formato', motivo: unida.motivo };
  return { presupuesto, peticiones, ok: true, lectura: unida.lectura };
}

async function ejecutarCatalogo(deps: DepsCiclo, tipo: 'catalogo' | 'confirmacion'): Promise<ResultadoCiclo> {
  const ahora = deps.reloj();
  const en = ahora.toISOString();
  const dia = fechaNeg(ahora);
  const estado = await deps.repo.cargarEstado();
  const clave = claveDeLectura(en, tipo);
  if (estado.lecturasProcesadas.includes(clave)) return resultado('duplicada', 'lectura_ya_procesada');
  if (estado.salud.bloqueada) {
    const recordatorio = revisarRecordatorio(estado, en);
    if (recordatorio.avisos.length > 0) {
      await emitirTodo(deps, recordatorio.avisos, []);
      await guardar(deps, recordatorio.estado, [], recordatorio.avisos);
    }
    return resultado('omitida', 'fuente_bloqueada');
  }
  if (tipo === 'confirmacion' && Object.keys(estado.candidatos).length === 0) return resultado('omitida', 'sin_candidatos');
  const presupuesto = presupuestoDelDia(await deps.repo.cargarPresupuesto(dia), dia);
  if (!puedePedir(presupuesto, tipo)) return resultado('omitida', 'presupuesto_agotado');

  const lectura = await leerCatalogoCompleto(deps, presupuesto, tipo);

  if (!lectura.ok) {
    const fallo = registrarFallo(estado, en, lectura.causa);
    await emitirTodo(deps, fallo.avisos, []);
    await guardar(deps, fallo.estado, [], fallo.avisos);
    return resultado(lectura.causa === 'bloqueada' ? 'bloqueada' : lectura.causa === 'sin_lectura' ? 'error' : 'rechazada', lectura.motivo, { avisos: fallo.avisos.length, peticiones: lectura.peticiones });
  }

  const ctx = { normalizacion: await deps.contexto.normalizacion(), socios: await deps.contexto.socios() };
  const proceso = procesarLectura(estado, { clave, en, lectura: lectura.lectura }, ctx);
  const construidos = construirAvisos(proceso.eventos, proceso.resultado === 'inicial' ? [] : proceso.colaNueva, en);

  if (proceso.resultado === 'sospechosa') {
    const siguiente = registrarIntento(proceso.estado, en);
    await emitirTodo(deps, construidos.avisos, construidos.resueltos);
    await guardar(deps, siguiente, proceso.eventos, construidos.avisos);
    return resultado('sospechosa', proceso.estado.retenida?.razon ?? null, { eventos: proceso.eventos.length, avisos: construidos.avisos.length, peticiones: lectura.peticiones });
  }

  const siguiente = registrarExito(proceso.estado, en, clave);
  const recordatorio = revisarRecordatorio(siguiente, en);
  await emitirTodo(deps, construidos.avisos, construidos.resueltos);
  await guardar(deps, recordatorio.estado, proceso.eventos, construidos.avisos);
  await deps.repo.guardarFotoDiaria(dia, fotoDe(recordatorio.estado));
  return resultado(proceso.resultado, null, {
    eventos: proceso.eventos.length,
    avisos: construidos.avisos.length,
    peticiones: lectura.peticiones,
    programarConfirmacionEn: proceso.hayCandidatos ? sumarMs(en, MINUTOS_CONFIRMACION * 60_000) : null,
  });
}

function revisarRecordatorio(previo: EstadoProveedor, en: Instante): { estado: EstadoProveedor; avisos: SolicitudAviso[] } {
  const estado = structuredClone(previo);
  return { estado, avisos: recordatorioPendiente(estado, en) };
}

/** Lectura horaria del catalogo de datos (24 al dia). */
export function ejecutarLecturaHoraria(deps: DepsCiclo): Promise<ResultadoCiclo> {
  return ejecutarCatalogo(deps, 'catalogo');
}

/** Lectura de confirmacion a los 10 minutos de un cambio candidato (hasta 6 al dia); si no se hace, confirma la lectura siguiente. */
export function ejecutarConfirmacion(deps: DepsCiclo): Promise<ResultadoCiclo> {
  return ejecutarCatalogo(deps, 'confirmacion');
}

// ---------------------------------------------------------------- lectura de promociones (cada 3 horas)

export async function ejecutarLecturaPromociones(deps: DepsCiclo): Promise<ResultadoCiclo> {
  if (!deps.promocionesActivas) return resultado('omitida', 'promociones_desactivadas');
  const ahora = deps.reloj();
  const en = ahora.toISOString();
  const dia = fechaNeg(ahora);
  const estado = await deps.repo.cargarEstado();
  const clave = claveDeLectura(en, 'promociones');
  if (estado.lecturasProcesadas.includes(clave)) return resultado('duplicada', 'lectura_ya_procesada');
  if (estado.salud.bloqueada) return resultado('omitida', 'fuente_bloqueada');
  if (!estado.inicializado) return resultado('omitida', 'sin_carga_inicial');
  let presupuesto = presupuestoDelDia(await deps.repo.cargarPresupuesto(dia), dia);
  if (!puedePedir(presupuesto, 'inicio')) return resultado('omitida', 'presupuesto_agotado');

  presupuesto = await pedir(deps, presupuesto, 'inicio');
  let peticiones = 1;
  let cruda;
  try {
    cruda = await deps.lector.leerInicio();
  } catch (e) {
    return resultado('error', e instanceof ErrorProveedor ? e.codigo : 'red', { peticiones });
  }
  const c = clasificarRespuesta({ ...cruda, tipoContenido: cruda.tipoContenido || 'text/html' });
  if (c.tipo === 'bloqueada' && c.motivo !== 'pagina_de_edad') {
    const fallo = registrarFallo(estado, en, 'bloqueada');
    await emitirTodo(deps, fallo.avisos, []);
    await guardar(deps, fallo.estado, [], fallo.avisos);
    return resultado('bloqueada', c.motivo, { avisos: fallo.avisos.length, peticiones });
  }
  if (cruda.estado !== 200) return resultado('error', 'http', { peticiones });

  const senales = parsearPromociones(cruda.cuerpo);
  const alcanceColecciones: Record<string, string[]> = {};
  for (const camp of campanasPorLeer(estado, senales)) {
    if (!puedePedir(presupuesto, 'coleccion')) break;
    presupuesto = await pedir(deps, presupuesto, 'coleccion');
    peticiones++;
    try {
      const col = clasificarRespuesta(await deps.lector.leerColeccion(camp.coleccion));
      if (col.tipo !== 'json') continue;
      const handles = handlesDeColeccion(col.valor);
      if (handles) alcanceColecciones[camp.coleccion] = handles;
    } catch {
      // Sin la coleccion no se conoce el alcance de la campana; se reintenta en la proxima lectura.
    }
  }

  const proceso = procesarPromociones(estado, { clave, en, senales, alcanceColecciones });
  if (proceso.descartada) return resultado('rechazada', 'plantilla_con_menos_tarjetas', { peticiones });
  const construidos = construirAvisos(proceso.eventos, [], en);
  const siguiente = structuredClone(proceso.estado);
  siguiente.lecturasProcesadas = [...siguiente.lecturasProcesadas.filter((k) => k !== clave), clave].slice(-200);
  await emitirTodo(deps, construidos.avisos, construidos.resueltos);
  await guardar(deps, siguiente, proceso.eventos, construidos.avisos);
  return resultado('ok', null, { eventos: proceso.eventos.length, avisos: construidos.avisos.length, peticiones });
}

// ---------------------------------------------------------------- robots.txt (semanal)

/** Si el robots.txt prohibe la ruta de lectura, el flujo se detiene y se avisa. Nunca se lee la fuente "a pesar" del robots. */
export async function verificarRobots(deps: DepsCiclo): Promise<ResultadoCiclo> {
  const ahora = deps.reloj();
  const en = ahora.toISOString();
  const dia = fechaNeg(ahora);
  const estado = await deps.repo.cargarEstado();
  const presupuesto = presupuestoDelDia(await deps.repo.cargarPresupuesto(dia), dia);
  if (!puedePedir(presupuesto, 'robots')) return resultado('omitida', 'presupuesto_agotado');
  await pedir(deps, presupuesto, 'robots');
  let cruda;
  try {
    cruda = await deps.lector.leerRobots();
  } catch (e) {
    return resultado('error', e instanceof ErrorProveedor ? e.codigo : 'red', { peticiones: 1 });
  }
  if (cruda.estado !== 200) return resultado('omitida', 'robots_no_disponible', { peticiones: 1 });
  const prohibida = RUTAS_DE_LECTURA.some((ruta) => !robotsPermite(cruda.cuerpo, ruta));
  if (!prohibida) return resultado('ok', null, { peticiones: 1 });
  const fallo = registrarFallo(estado, en, 'bloqueada');
  await emitirTodo(deps, fallo.avisos, []);
  await guardar(deps, fallo.estado, [], fallo.avisos);
  return resultado('bloqueada', 'robots_prohibe', { avisos: fallo.avisos.length, peticiones: 1 });
}

// ---------------------------------------------------------------- decisiones de un socio

/** Botones "Es real, publicar" y "Descartar lectura" del aviso P-18. */
export async function decidirLecturaRetenida(deps: DepsCiclo, decision: 'es_real' | 'ignorar'): Promise<ResultadoCiclo> {
  const en = deps.reloj().toISOString();
  const estado = await deps.repo.cargarEstado();
  if (!estado.retenida) return resultado('omitida', 'sin_lectura_retenida');
  const ctx = { normalizacion: await deps.contexto.normalizacion(), socios: await deps.contexto.socios() };
  const proceso = resolverRetencion(estado, decision, en, ctx);
  const construidos = construirAvisos(proceso.eventos, proceso.colaNueva, en);
  const siguiente = decision === 'es_real' ? registrarExito(proceso.estado, en, `${estado.retenida.clave}|confirmada`) : proceso.estado;
  await emitirTodo(deps, construidos.avisos, [...construidos.resueltos, 'P-18|retenida']);
  await guardar(deps, siguiente, proceso.eventos, construidos.avisos);
  return resultado('ok', decision, { eventos: proceso.eventos.length, avisos: construidos.avisos.length });
}

/** Un socio reanuda la fuente tras un bloqueo. Nunca se reanuda sola. */
export async function reanudarLectura(deps: DepsCiclo): Promise<void> {
  const estado = await deps.repo.cargarEstado();
  await deps.repo.guardarEstado(reanudarFuente(estado), []);
}
