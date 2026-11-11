// Permisos por rol. La identidad es el id de Telegram (no el nombre mostrado). Omar solo toma piezas y consulta lo suyo.
import { normalizar } from '../catalogo/normalizar';
import type { Intencion } from './intenciones';
import { esEscritura } from './intenciones';
import type { RolMiembro } from './tipos';

export type DecisionPermiso =
  | { permitido: true }
  /** Omar intento registrar algo que solo registran los duenos: no se ejecuta, se avisa al grupo de socios. */
  | { permitido: false; motivo: 'omar_no_registra' }
  /** Consulta fuera de lo que Omar puede ver. */
  | { permitido: false; motivo: 'fuera_de_alcance' };

export function permisoParaIntencion(rol: RolMiembro, intencion: Intencion): DecisionPermiso {
  if (rol === 'socio') return { permitido: true };

  switch (intencion.tipo) {
    case 'toma_omar':
    case 'ninguna':
    case 'aclarar':
      return { permitido: true };
    case 'consulta': {
      if (intencion.consulta === 'ayuda' || intencion.consulta === 'inventario') return { permitido: true };
      if (intencion.consulta === 'saldo') {
        const sujeto = intencion.sujeto_texto === null ? '' : normalizar(intencion.sujeto_texto);
        return sujeto === '' || sujeto === 'omar' ? { permitido: true } : { permitido: false, motivo: 'fuera_de_alcance' };
      }
      return { permitido: false, motivo: 'fuera_de_alcance' };
    }
    default:
      return esEscritura(intencion.tipo)
        ? { permitido: false, motivo: 'omar_no_registra' }
        : { permitido: false, motivo: 'fuera_de_alcance' };
  }
}

/** Solo un socio puede pulsar botones de tarjetas de socios (Autorizar, Rechazar, Deshacer, aclaraciones). */
export function puedePulsar(rol: RolMiembro, rolesPermitidos: readonly RolMiembro[]): boolean {
  return rolesPermitidos.includes(rol);
}
