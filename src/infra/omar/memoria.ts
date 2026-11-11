// Implementacion en memoria de la vista de Omar (pruebas y simulador). Reproduce las reglas de la funcion SQL pendiente omar.solicitar_toma:
// tope, existencia NETA de reservas de pedidos confirmados y de solicitudes pendientes, e idempotencia por clave. El aviso al grupo de socios
// (la tarjeta de Telegram) sale por un callback, que en la composicion con agente es el puente real al agente.
import type { ColaSolicitudes, LectorOmar } from '@/aplicacion/omar/puertos';
import { caducaEn, CONFIG_POR_OMISION } from '@/dominio/omar/solicitud';
import type { ConfiguracionOmar, LiquidacionOmar, Lectura, LineaSolicitud, MovimientoCuenta, PaqueteOmar, PiezaDisponible, ResultadoSolicitud, Solicitud } from '@/dominio/omar/tipos';

export interface DatosOmarMemoria {
  disponible?: PiezaDisponible[];
  cuenta?: MovimientoCuenta[];
  liquidaciones?: LiquidacionOmar[];
  paquetes?: PaqueteOmar[];
  solicitudes?: Solicitud[];
  config?: ConfiguracionOmar;
  /** Piezas comprometidas por pedidos confirmados, por "modelo|sabor" en minusculas. Omar nunca las ve. */
  reservadoPedidos?: Record<string, number>;
  /** Que lecturas faltan en la base (simula funciones sin migrar). */
  sinSql?: Array<'solicitudes' | 'liquidaciones' | 'paquetes' | 'configuracion'>;
  /** Falla de lectura de las vistas. */
  fallaVistas?: boolean;
}

export type AvisoAlGrupo = (s: { folio: string; linea: LineaSolicitud; clave: string }) => Promise<void>;

const llave = (modelo: string, sabor: string) => `${modelo.trim().toLowerCase()}|${sabor.trim().toLowerCase()}`;

export class OmarMemoria implements LectorOmar, ColaSolicitudes {
  readonly solicitudesCreadas: Solicitud[] = [];
  private readonly porClave = new Map<string, ResultadoSolicitud>();
  private n = 0;

  constructor(private readonly d: DatosOmarMemoria = {}, private readonly ahora: () => Date = () => new Date(0), private readonly avisar: AvisoAlGrupo = async () => {}) {
    this.solicitudesCreadas.push(...(d.solicitudes ?? []));
  }

  private falta(n: 'solicitudes' | 'liquidaciones' | 'paquetes' | 'configuracion'): boolean {
    return this.d.sinSql?.includes(n) ?? false;
  }

  async disponible(): Promise<Lectura<PiezaDisponible[]>> {
    return this.d.fallaVistas ? { estado: 'error' } : { estado: 'ok', datos: (this.d.disponible ?? []).map((p) => ({ ...p })) };
  }
  async cuenta(): Promise<Lectura<MovimientoCuenta[]>> {
    return this.d.fallaVistas ? { estado: 'error' } : { estado: 'ok', datos: this.d.cuenta ?? [] };
  }
  async solicitudes(): Promise<Lectura<Solicitud[]>> {
    return this.falta('solicitudes') ? { estado: 'pendiente_sql' } : { estado: 'ok', datos: [...this.solicitudesCreadas].sort((a, b) => b.solicitada_at.localeCompare(a.solicitada_at)) };
  }
  async liquidaciones(): Promise<Lectura<LiquidacionOmar[]>> {
    return this.falta('liquidaciones') ? { estado: 'pendiente_sql' } : { estado: 'ok', datos: this.d.liquidaciones ?? [] };
  }
  async paquetes(): Promise<Lectura<PaqueteOmar[]>> {
    return this.falta('paquetes') ? { estado: 'pendiente_sql' } : { estado: 'ok', datos: this.d.paquetes ?? [] };
  }
  async configuracion(): Promise<Lectura<ConfiguracionOmar>> {
    return this.falta('configuracion') ? { estado: 'pendiente_sql' } : { estado: 'ok', datos: this.d.config ?? CONFIG_POR_OMISION };
  }

  /** Existencia neta: fisica menos reservas de pedidos menos solicitudes pendientes. */
  disponibleNeto(modelo: string, sabor: string): number {
    const fisico = (this.d.disponible ?? []).find((p) => llave(p.modelo, p.sabor) === llave(modelo, sabor))?.piezas ?? 0;
    const pedidos = this.d.reservadoPedidos?.[llave(modelo, sabor)] ?? 0;
    const pendientes = this.solicitudesCreadas.filter((s) => s.estado === 'pendiente' && llave(s.modelo, s.sabor) === llave(modelo, sabor)).reduce((a, s) => a + s.piezas, 0);
    return fisico - pedidos - pendientes;
  }

  async solicitar(clave: string, linea: LineaSolicitud): Promise<ResultadoSolicitud> {
    const previa = this.porClave.get(clave);
    if (previa) return previa.ok ? { ...previa, repetido: true } : previa;
    const cfg = this.d.config ?? CONFIG_POR_OMISION;
    let r: ResultadoSolicitud;
    if (linea.piezas > cfg.tope_toma_piezas) r = { ok: false, motivo: 'tope', mensaje: `Cada solicitud admite hasta ${cfg.tope_toma_piezas} piezas.` };
    else if (linea.piezas > this.disponibleNeto(linea.modelo, linea.sabor)) r = { ok: false, motivo: 'sin_disponible', mensaje: 'Esa pieza ya no está disponible para tomar. Revisa tu bodega.' };
    else {
      const ahora = this.ahora().toISOString();
      const folio = `T-${String(++this.n).padStart(4, '0')}`;
      const s: Solicitud = { folio, modelo: linea.modelo, sabor: linea.sabor, piezas: linea.piezas, estado: 'pendiente', solicitada_at: ahora, caduca_at: caducaEn(ahora, cfg.caduca_horas), resuelta_at: null };
      this.solicitudesCreadas.push(s);
      await this.avisar({ folio, linea, clave });
      r = { ok: true, folio, estado: 'pendiente', caduca_at: s.caduca_at, repetido: false };
    }
    this.porClave.set(clave, r);
    return r;
  }

  /** Simula la decision del grupo de socios (autorizar, rechazar o caducar) sobre una solicitud. */
  resolver(folio: string, estado: 'autorizada' | 'rechazada' | 'caducada'): void {
    const s = this.solicitudesCreadas.find((x) => x.folio === folio);
    if (!s || s.estado !== 'pendiente') return;
    s.estado = estado;
    s.resuelta_at = this.ahora().toISOString();
    if (estado === 'autorizada') {
      const p = this.d.disponible?.find((x) => llave(x.modelo, x.sabor) === llave(s.modelo, s.sabor));
      if (p) p.piezas -= s.piezas;
    }
  }
}
