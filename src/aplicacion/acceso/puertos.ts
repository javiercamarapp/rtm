// Puertos del acceso. La aplicacion habla con estas interfaces; la infraestructura las implementa.
import type { Rol } from '@/dominio/capacidades';

export interface ErrorOtp {
  code?: string;
  message?: string;
  status?: number;
}

export interface Perfil {
  rol: Rol;
  socio_nombre: 'Angelo' | 'Javier' | null;
  activo: boolean;
}

/** `perfil` es null si el usuario autenticado no tiene fila en seguridad.usuario. */
export type EstadoSesion = { autenticado: false } | { autenticado: true; perfil: Perfil | null };

export interface Autenticador {
  /** Pide el enlace magico. Nunca crea usuarios (shouldCreateUser: false). */
  enviarEnlace(correo: string, redirectTo: string): Promise<{ error: ErrorOtp | null }>;
  canjearCodigo(code: string): Promise<{ error: ErrorOtp | null }>;
  sesion(): Promise<EstadoSesion>;
  cerrarSesion(): Promise<void>;
}

export type TipoClave = 'ip' | 'correo' | 'global' | 'reenvio';

export interface Tope {
  limite: number;
  ventanaSeg: number;
}

export interface LimitadorIntentos {
  /** Cuenta un intento y dice si ya se paso del tope. Cada llamada cuenta. Falla ABIERTO: es la unica via de entrada. */
  excede(tipo: TipoClave, valor: string, tope: Tope): Promise<boolean>;
}

export interface AlmacenReenvio {
  guardarCorreo(correo: string): Promise<void>;
  correoRecordado(): Promise<string | null>;
  hayEspera(): Promise<boolean>;
  marcarEspera(): Promise<void>;
}

export interface Rastro {
  /** Evento de seguridad sin el correo en claro. */
  fallo(puerta: string, motivo: string, ip: string): void;
  aviso(evento: string, datos?: Record<string, string | number | undefined>): void;
}

export interface DepsAcceso {
  autenticador: Autenticador;
  limitador: LimitadorIntentos;
  reenvio: AlmacenReenvio;
  rastro: Rastro;
  urlApp: string;
}
