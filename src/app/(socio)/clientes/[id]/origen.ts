/** Origen de un precio del tabulador. Decision del dueno: el texto es 'Precio pactado por Angelo' o 'Precio pactado por Javier' y nada mas. */
const ORIGEN: Record<string, string> = { documento: 'Precio pactado por Angelo', chat: 'Indicación de un socio', lista_javier: 'Precio pactado por Javier' };

export function etiquetaOrigen(origen: string): string {
  return ORIGEN[origen] ?? origen;
}
