// Modulo unico de movimiento. El CSS (estilos/movimiento.css) obedece al atributo data-movimiento de <html>:
//   full = animaciones completas; reduced = fundido lineal de 120 ms; off = sin animacion.
// Por omision sigue la preferencia del sistema (prefers-reduced-motion). Las duraciones viven aqui y en las variables --rtm-mov-*.

export type ModoMovimiento = 'full' | 'reduced' | 'off';

export const CLAVE_MOVIMIENTO = 'rtm-movimiento';

export const DURACIONES_MS = {
  entrada: 360,
  maximo: 600,
  trazoLinea: 900,
  reducido: 120,
} as const;

/** Escalonado de entrada: como maximo 6 elementos se retrasan; del septimo en adelante entran juntos. */
export function indiceEscalonado(i: number): number {
  return Math.min(Math.max(0, Math.floor(i)), 6);
}

export function esModo(v: unknown): v is ModoMovimiento {
  return v === 'full' || v === 'reduced' || v === 'off';
}

export function modoInicial(guardado: string | null, sistemaPrefiereReducido: boolean): ModoMovimiento {
  if (esModo(guardado)) return guardado;
  return sistemaPrefiereReducido ? 'reduced' : 'full';
}

export function aplicarModoMovimiento(modo: ModoMovimiento): void {
  document.documentElement.dataset.movimiento = modo;
  try {
    localStorage.setItem(CLAVE_MOVIMIENTO, modo);
  } catch {
    /* sin almacenamiento: el modo vale solo para esta visita */
  }
}
