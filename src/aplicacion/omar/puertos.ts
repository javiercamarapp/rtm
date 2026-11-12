// Puertos de la vista de Omar. La aplicacion habla con estas interfaces; infra/omar las implementa (Supabase con la sesion de Omar, o memoria en pruebas).
import type { ConfiguracionOmar, LiquidacionOmar, Lectura, LineaSolicitud, MovimientoCuenta, PaqueteOmar, PiezaDisponible, ResultadoSolicitud, Solicitud } from '@/dominio/omar/tipos';

/** Solo lectura. Cada metodo lee de una vista del esquema `omar` o de una funcion `omar.*`; nunca de otro esquema. */
export interface LectorOmar {
  /** omar.v_mercancia */
  disponible(): Promise<Lectura<PiezaDisponible[]>>;
  /** omar.v_mi_cuenta */
  cuenta(): Promise<Lectura<MovimientoCuenta[]>>;
  /** omar.mis_solicitudes (pendiente de SQL) */
  solicitudes(): Promise<Lectura<Solicitud[]>>;
  /** omar.mis_liquidaciones (pendiente de SQL) */
  liquidaciones(): Promise<Lectura<LiquidacionOmar[]>>;
  /** omar.mis_paquetes (pendiente de SQL) */
  paquetes(): Promise<Lectura<PaqueteOmar[]>>;
  /** omar.mi_configuracion (pendiente de SQL); sin ella se usan los valores por omision. */
  configuracion(): Promise<Lectura<ConfiguracionOmar>>;
}

/**
 * Cola de solicitudes hacia el flujo de autorizacion de Telegram. Idempotente por `clave`: el mismo envio no crea dos solicitudes ni dos tarjetas.
 * Implementaciones: SQL (omar.solicitar_toma, que tambien valida existencia neta de reservas) y el puente al agente de Telegram (pruebas / simulador).
 */
export interface ColaSolicitudes {
  solicitar(clave: string, linea: LineaSolicitud): Promise<ResultadoSolicitud>;
}
