// Casos de uso de la vista de Omar. El control de acceso va PRIMERO: sin sesion activa con rol omar no se toca ningun puerto.
import { puedeOmar, type AccionOmar } from '@/dominio/capacidades';
import { cifraExplicable, explicarCifraOmar, proyectarSemana, type ResultadoProyeccion } from '@/dominio/omar/cuenta';
import { CONFIG_POR_OMISION, claveValida, validarSolicitud } from '@/dominio/omar/solicitud';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import type { ConfiguracionOmar, Lectura, LiquidacionOmar, MovimientoCuenta, PaqueteOmar, PiezaDisponible, ResultadoSolicitud, Solicitud } from '@/dominio/omar/tipos';
import type { Perfil } from '@/aplicacion/acceso/puertos';
import type { ColaSolicitudes, LectorOmar } from './puertos';

export interface DepsOmar {
  perfil: Perfil | null;
  lector: LectorOmar;
  cola: ColaSolicitudes;
}

export class SinAccesoOmar extends Error {
  constructor() {
    super('sin acceso');
    this.name = 'SinAccesoOmar';
  }
}

function exigir(d: DepsOmar, accion: AccionOmar): void {
  if (!d.perfil || !puedeOmar(d.perfil.rol, d.perfil.activo, accion)) throw new SinAccesoOmar();
}

const dato = <T>(l: Lectura<T>, defecto: T): T => (l.estado === 'ok' ? l.datos : defecto);

export async function configuracionDe(d: DepsOmar): Promise<ConfiguracionOmar> {
  return dato(await d.lector.configuracion(), CONFIG_POR_OMISION);
}

export interface VistaBodega {
  disponible: Lectura<PiezaDisponible[]>;
  solicitudes: Lectura<Solicitud[]>;
  config: ConfiguracionOmar;
}

export async function cargarBodega(d: DepsOmar): Promise<VistaBodega> {
  exigir(d, 'omar_ver_bodega');
  const [disponible, solicitudes, config] = await Promise.all([d.lector.disponible(), d.lector.solicitudes(), configuracionDe(d)]);
  return { disponible, solicitudes, config };
}

export interface VistaCuenta {
  movimientos: Lectura<MovimientoCuenta[]>;
  liquidaciones: Lectura<LiquidacionOmar[]>;
  proyeccion: ResultadoProyeccion;
  config: ConfiguracionOmar;
}

export async function cargarCuenta(d: DepsOmar, hoy: string): Promise<VistaCuenta> {
  exigir(d, 'omar_ver_cuenta');
  const [movimientos, liquidaciones, paquetes, config] = await Promise.all([d.lector.cuenta(), d.lector.liquidaciones(), d.lector.paquetes(), configuracionDe(d)]);
  const proyeccion: ResultadoProyeccion = movimientos.estado === 'ok'
    ? proyectarSemana({ movs: movimientos.datos, paquetes: paquetes.estado === 'ok' ? paquetes.datos : null, cfg: config, hoy })
    : { tipo: 'sin_dato', motivo: 'sin_historia' };
  return { movimientos, liquidaciones, proyeccion, config };
}

export async function cargarPaquetes(d: DepsOmar): Promise<Lectura<PaqueteOmar[]>> {
  exigir(d, 'omar_ver_paquetes');
  return d.lector.paquetes();
}

/** Solicitud de piezas: valida acceso, clave de idempotencia, tope y existencia visible; despues la cola (la base valida de nuevo, neto de reservas). */
export async function solicitarPiezas(d: DepsOmar, entrada: { clave: unknown; modelo: string; sabor: string; piezas: unknown }): Promise<ResultadoSolicitud> {
  exigir(d, 'omar_solicitar_piezas');
  if (!claveValida(entrada.clave)) return { ok: false, motivo: 'clave', mensaje: 'Falta la clave de la solicitud. Recarga la página.' };
  const [disp, config] = await Promise.all([d.lector.disponible(), configuracionDe(d)]);
  if (disp.estado !== 'ok') return { ok: false, motivo: 'desactivado', mensaje: 'No se pudo leer tu bodega. Intenta de nuevo en un momento.' };
  const v = validarSolicitud({ modelo: entrada.modelo, sabor: entrada.sabor, piezas: entrada.piezas }, disp.datos, config);
  if (!v.ok) return v;
  return d.cola.solicitar(entrada.clave, v.linea);
}

export async function explicarOmar(d: DepsOmar, cifra: string): Promise<Explicacion> {
  exigir(d, 'omar_ver_cuenta');
  if (!cifraExplicable(cifra)) throw new Error('cifra no explicable');
  const [m, l] = await Promise.all([d.lector.cuenta(), d.lector.liquidaciones()]);
  const e = explicarCifraOmar(cifra, dato(m, []), dato(l, []));
  if (!e) throw new Error('cifra no explicable');
  return e;
}
