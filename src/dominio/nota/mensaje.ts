import { nombreVape } from '@/dominio/formato';

/**
 * Mensaje de la nota tal como se le muestra y comparte al cliente: el texto que guarda la base (`operacion.texto_nota`, inmutable) con el
 * nombre del modelo en MAYUSCULAS en cada renglon ("Waka Blade 10pz x $243.42 = 2,434.20" -> "WAKA BLADE 10pz x $243.42 = 2,434.20").
 * Solo es presentacion: no toca el texto guardado ni su oraculo (`textoNota`).
 */
export function mensajeNotaCliente(texto: string): string {
  return texto
    .split('\n')
    .map((l) => l.replace(/^(.+?)( \d+pz x \$)/, (_t, modelo: string, resto: string) => `${nombreVape(modelo)}${resto}`))
    .join('\n');
}

/** Enlace para abrir WhatsApp con el mensaje ya escrito y SIN numero: la persona elige el contacto en WhatsApp. */
export function enlaceWhatsApp(mensaje: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
}
