import { describe, expect, it } from 'vitest';
import { DEF_INTENCION_SABOR, interpretarRespuesta, REGLAS_PROMPT_SABORES, textoPreguntaBot } from '@/dominio/agente/sabores';

describe('interpretarRespuesta (si / no en lenguaje natural)', () => {
  it.each(['si', 'Sí', 'sí, es lo mismo', 'sip', 'claro', 'son iguales', 'es el mismo sabor', 'dale, únelos', 'Simón', 'asi es'])('%s -> si', (t) => {
    expect(interpretarRespuesta(t)).toBe('si');
  });
  it.each(['no', 'No.', 'no, son distintos', 'no es lo mismo', 'son diferentes', 'nel', 'no son iguales', 'para nada', 'no, es otro sabor distinto'])('%s -> no', (t) => {
    expect(interpretarRespuesta(t)).toBe('no');
  });
  it.each(['no sé', 'no es distinto', 'no son diferentes', 'no, es lo mismo', 'no estoy seguro', 'quizá', 'depende', 'déjalo así', '', 'hola buenas', 'si pero no es lo mismo', 'cuanto debe Villa', 'x'.repeat(10) + ' ' + 'palabra '.repeat(15)])('%s -> no_se', (t) => {
    expect(interpretarRespuesta(t)).toBe('no_se');
  });
});

describe('textos y reglas', () => {
  it('pregunta del bot', () => {
    expect(textoPreguntaBot('Passion Fruit', 'Passionfruit')).toBe('¿"Passion Fruit" es lo mismo que "Passionfruit"? Responde sí o no.');
    expect(textoPreguntaBot('Peach Blue Razz', 'Peach Blue Raspberry', true, 3)).toContain('Hay 2 más por revisar');
  });
  it('el modelo solo extrae: ninguna regla le deja decidir', () => {
    expect(REGLAS_PROMPT_SABORES.join(' ')).toContain('SOLO el lector');
    expect(REGLAS_PROMPT_SABORES.join(' ')).toContain('no decides');
  });
  it('contrato sin tarjeta y con reversa', () => {
    expect(DEF_INTENCION_SABOR.confirmacion).toBe('ninguna');
    expect(DEF_INTENCION_SABOR.reversa).toBe('directa');
    expect(DEF_INTENCION_SABOR.quien).toBe('socios');
  });
});
