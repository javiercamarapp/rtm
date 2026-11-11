// IP del cliente a partir de las cabeceras del proxy. `proxies` = cuantos proxies de confianza hay delante:
// se toma la entrada x-forwarded-for que ellos agregaron (la N-esima desde la derecha), nunca la que el cliente pueda escribir.
const ES_IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,45})$/;

export function ipDeCabeceras(h: { get(nombre: string): string | null }, proxies = 1): string {
  const xff = (h.get('x-forwarded-for') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  const candidata = xff.length ? xff[Math.max(0, xff.length - proxies)]! : (h.get('x-real-ip') ?? '').trim();
  return ES_IP.test(candidata) ? candidata : 'desconocida';
}
