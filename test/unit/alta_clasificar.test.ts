import { describe, it, expect } from 'vitest';
import { clasificar } from '../../scripts/acceso/clasificar.mjs';

// Solo correos ficticios: la lista real vive fuera del repo.
describe('clasificar la lista de permitidos por nombre', () => {
  const ok = 'javier.uno@example.test\nangelo.dos@example.test\nomar.tres@example.test\n';
  it('asigna rol por el nombre; Omar tiene acceso desde el 14-nov', () => {
    const r = clasificar(ok) as { persona: string; rol: string; activo: boolean; socio: string | null }[];
    expect(r.map((x) => [x.persona, x.rol, x.activo, x.socio])).toEqual([
      ['javier', 'socio', true, 'Javier'],
      ['angelo', 'socio', true, 'Angelo'],
      ['omar', 'omar', true, null],
    ]);
  });
  it('guarda el texto exacto en minusculas (Gmail con puntos es otra cuenta)', () => {
    const r = clasificar('Javier.Uno@Example.Test\nangelo@example.test\nomar@example.test') as { correo: string }[];
    expect(r[0]!.correo).toBe('javier.uno@example.test');
  });
  it('se detiene si falta una persona, sobra una linea o hay un duplicado ambiguo', () => {
    expect(() => clasificar('javier@example.test\nangelo@example.test')).toThrow();
    expect(() => clasificar(`${ok}extra@example.test`)).toThrow();
    expect(() => clasificar('javier@example.test\njavier2@example.test\nangelo@example.test\nomar@example.test')).toThrow();
    expect(() => clasificar('no-es-correo\nangelo@example.test\nomar@example.test')).toThrow();
  });
  it('ignora lineas vacias y comentarios', () => {
    expect(clasificar(`# lista\n\n${ok}`)).toHaveLength(3);
  });
});
