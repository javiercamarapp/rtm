import { describe, expect, it } from 'vitest';
import { marcaMayus, nombreVape, nombreVapeCompleto, saborMayus } from '@/dominio/formato';

describe('mayusculas de marcas, modelos y sabores', () => {
  it('conserva numeros y la K de puffs', () => {
    expect(nombreVape('Waka 15K')).toBe('WAKA 15K');
    expect(nombreVape('Geek Bar Somax 80K')).toBe('GEEK BAR SOMAX 80K');
    expect(nombreVape('Fasta Burst 37K')).toBe('FASTA BURST 37K');
  });
  it('sube las minusculas de una marca escrita en camel o minuscula', () => {
    expect(marcaMayus('iPlay')).toBe('IPLAY');
    expect(marcaMayus('IPLAY')).toBe('IPLAY');
    expect(marcaMayus('Sin marca')).toBe('SIN MARCA');
  });
  it('conserva los acentos y la enie', () => {
    expect(saborMayus('Piña Colada')).toBe('PIÑA COLADA');
    expect(saborMayus('Kiwi Dragón')).toBe('KIWI DRAGÓN');
    expect(saborMayus('Peña')).toBe('PEÑA');
    expect(saborMayus('maracuyá')).toBe('MARACUYÁ');
  });
  it('no toca siglas ni cifras ya en mayuscula', () => {
    expect(nombreVape('Waka DM 15K')).toBe('WAKA DM 15K');
    expect(nombreVape('Waka GO Mundialista 10K')).toBe('WAKA GO MUNDIALISTA 10K');
    expect(nombreVape('IPLAY Box Pro Max 50K')).toBe('IPLAY BOX PRO MAX 50K');
  });
  it('es idempotente y no cambia el tipo de null o undefined', () => {
    expect(saborMayus(saborMayus('Cherry Ice'))).toBe('CHERRY ICE');
    expect(saborMayus(null)).toBeNull();
    expect(saborMayus(undefined)).toBeUndefined();
    expect(saborMayus('')).toBe('');
  });
  it('recorta los espacios de los extremos pero no toca los de en medio', () => {
    expect(saborMayus('  Cool Mint ')).toBe('COOL MINT');
  });
  it('nombreVapeCompleto no repite la marca ni antepone Sin marca', () => {
    expect(nombreVapeCompleto('Waka Blade 33K', 'Waka')).toBe('WAKA BLADE 33K');
    expect(nombreVapeCompleto('Blade 33K', 'Waka')).toBe('WAKA BLADE 33K');
    expect(nombreVapeCompleto('Blade 33K', 'Sin marca')).toBe('BLADE 33K');
    expect(nombreVapeCompleto('Elux 50K', null)).toBe('ELUX 50K');
  });
});
