// Llave de cifrado de los destinatarios (dropshipping). NO vive en la base ni en el repo: variable de entorno PRIVADA del servidor (DS_LLAVE_DESTINATARIO, minimo 32 caracteres).
// Se entrega a la base en cada llamada por cabecera (la base solo la ve dentro de la transaccion). Sin llave no se manda cabecera y la base falla cerrada (nunca texto plano).
export const CABECERA_LLAVE = 'x-rtm-llave';
export const CABECERA_LLAVE_ANTERIOR = 'x-rtm-llave-anterior';
export const CABECERA_LLAVE_VERSION = 'x-rtm-llave-version';

export function cabecerasLlave(entorno: Record<string, string | undefined> = process.env): Record<string, string> {
  const llave = entorno['DS_LLAVE_DESTINATARIO']?.trim();
  if (!llave) return {};
  if (llave.length < 32) throw new Error('DS_LLAVE_DESTINATARIO debe tener al menos 32 caracteres');
  const cab: Record<string, string> = { [CABECERA_LLAVE]: llave };
  const ant = entorno['DS_LLAVE_DESTINATARIO_ANTERIOR']?.trim();
  if (ant) {
    if (ant.length < 32) throw new Error('DS_LLAVE_DESTINATARIO_ANTERIOR debe tener al menos 32 caracteres');
    cab[CABECERA_LLAVE_ANTERIOR] = ant;
  }
  const ver = entorno['DS_LLAVE_DESTINATARIO_VERSION']?.trim();
  if (ver && /^\d{1,4}$/.test(ver)) cab[CABECERA_LLAVE_VERSION] = ver;
  return cab;
}
