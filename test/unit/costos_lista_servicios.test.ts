import { describe, expect, it } from 'vitest';
import { categoriaDe, inicialesServicio, ordenarServicios } from '@/dominio/costos/lista-servicios';

const s = (servicio: string, fase: 'mantenimiento' | 'construccion', opcional = false) => ({ servicio, fase, opcional });

describe('lista de servicios de costos', () => {
  it('categoria: construccion gana a opcional y el resto es mantenimiento', () => {
    expect(categoriaDe(s('A', 'construccion', true))).toBe('construccion');
    expect(categoriaDe(s('A', 'mantenimiento', true))).toBe('opcional');
    expect(categoriaDe(s('A', 'mantenimiento'))).toBe('mantenimiento');
  });
  it('orden estable: Mantenimiento, Opcional, Construccion y alfabetico dentro de cada una', () => {
    const r = ordenarServicios([s('Claude Max', 'construccion', true), s('Higgsfield', 'mantenimiento', true), s('Vercel', 'mantenimiento'), s('Dominio', 'mantenimiento'), s('Álgebra', 'mantenimiento')]);
    expect(r.map((x) => x.servicio)).toEqual(['Álgebra', 'Dominio', 'Vercel', 'Higgsfield', 'Claude Max']);
  });
  it('el orden no depende del de entrada ni muta el arreglo', () => {
    const e = [s('B', 'mantenimiento'), s('A', 'mantenimiento')];
    expect(ordenarServicios(e).map((x) => x.servicio)).toEqual(ordenarServicios([...e].reverse()).map((x) => x.servicio));
    expect(e[0]!.servicio).toBe('B');
  });
  it('iniciales de dos letras para el monograma', () => {
    expect(inicialesServicio('Transcripción de audio')).toBe('TD');
    expect(inicialesServicio('Dominio')).toBe('DO');
    expect(inicialesServicio('OpenRouter, comisión de recarga')).toBe('OC');
  });
});
