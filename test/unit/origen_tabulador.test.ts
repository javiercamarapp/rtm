import { describe, expect, it } from 'vitest';
import { etiquetaOrigen } from '../../src/app/(socio)/clientes/[id]/origen';

describe('origen del tabulador en la ficha del cliente', () => {
  it('usa exactamente Precio pactado por Angelo / Javier', () => {
    expect(etiquetaOrigen('documento')).toBe('Precio pactado por Angelo');
    expect(etiquetaOrigen('lista_javier')).toBe('Precio pactado por Javier');
    expect(etiquetaOrigen('chat')).toBe('Indicación de un socio');
  });
});
