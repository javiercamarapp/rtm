// La fila de totales se acomoda por id de columna: una clave que no existe como columna deja la suma en otra columna o la pierde.
import { describe, expect, it } from 'vitest';
import { clavesTotalesHuerfanas } from '@/ui/componentes/data-table';

describe('clavesTotalesHuerfanas', () => {
  const columnas = [{ id: 'f' }, { id: 'p' }, { id: 'u' }, { id: 'p2' }, { id: 'r' }, { id: 'i' }];
  it('todas las claves son columnas: sin huerfanas', () => {
    expect(clavesTotalesHuerfanas(columnas, { u: 1, p2: 2, r: 3, i: 4 })).toEqual([]);
  });
  it('detecta la clave que no es columna (el caso de la linea de tiempo: Su parte sumaba bajo Periodo)', () => {
    expect(clavesTotalesHuerfanas(columnas.filter((c) => c.id !== 'p2'), { u: 1, p2: 2 })).toEqual(['p2']);
  });
});
