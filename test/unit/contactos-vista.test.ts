// Presentacion y exportacion de contactos (datos sinteticos).
import { describe, expect, it } from 'vitest';
import { aCsv, desplazamientoDePagina, etiquetaOrigen } from '@/dominio/contactos/vista';
import { formatearEntero } from '@/dominio/formato';

describe('vista de contactos', () => {
  it('etiqueta los origenes', () => {
    expect(etiquetaOrigen('meta')).toBe('Meta');
    expect(etiquetaOrigen('google-lote:importado-el-9-10')).toBe('Google · importado el 9 10');
    expect(etiquetaOrigen('')).toBe('Todos los orígenes');
  });

  it('exporta CSV con BOM, comillas escapadas y sin formulas ejecutables', () => {
    const csv = aCsv([{ nombre: '=SUMA(1)', telefono: '+529995550101', telefonos: ['+529995550101', '+529995550102'], correo: null, colonia: 'Centro', origenes: ['meta', 'vapeunion'], anuncios: ['Anuncio "A", uno'] }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lineas = csv.slice(1).split('\r\n');
    expect(lineas[0]).toBe('nombre,telefono,otros_telefonos,correo,colonia,origenes,anuncios');
    expect(lineas[1]).toBe(`'=SUMA(1),+529995550101,+529995550102,,Centro,meta ; vapeunion,"Anuncio ""A"", uno"`);
  });

  it('pagina desde 1 y tolera basura', () => {
    expect(desplazamientoDePagina(undefined, 50)).toBe(0);
    expect(desplazamientoDePagina('3', 50)).toBe(100);
    expect(desplazamientoDePagina('-1', 50)).toBe(0);
    expect(desplazamientoDePagina('abc', 50)).toBe(0);
  });

  it('formatea enteros con separador de miles', () => {
    expect(formatearEntero(7934)).toBe('7,934');
    expect(formatearEntero(12)).toBe('12');
  });
});
