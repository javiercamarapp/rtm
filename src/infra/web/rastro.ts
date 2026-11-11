import { createHash } from 'node:crypto';
import type { Rastro } from '@/aplicacion/acceso/puertos';

/** Rastro de seguridad a la bitacora del servidor: nunca el correo (solo una huella corta) ni la IP completa. */
export function rastroConsola(): Rastro {
  const huella = (ip: string) => createHash('sha256').update(ip, 'utf8').digest('hex').slice(0, 10);
  return {
    fallo(puerta, motivo, ip) {
      console.warn(JSON.stringify({ evento: 'acceso.fallo', puerta, motivo, ip: huella(ip) }));
    },
    aviso(evento, datos) {
      console.info(JSON.stringify({ evento, ...datos }));
    },
  };
}
