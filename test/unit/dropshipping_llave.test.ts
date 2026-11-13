import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cabecerasLlave } from '@/config/llave_destinatario';

const LLAVE = 'prueba-llave-de-32-caracteres-xxxxxxxx'; // llave de PRUEBA, no es de ningun entorno

describe('llave de cifrado de destinatarios (variable de entorno privada)', () => {
  it('sin llave no manda cabecera: la base falla cerrada', () => expect(cabecerasLlave({})).toEqual({}));
  it('con llave manda solo la cabecera de la llave', () => expect(cabecerasLlave({ DS_LLAVE_DESTINATARIO: LLAVE })).toEqual({ 'x-rtm-llave': LLAVE }));
  it('durante la rotacion manda la anterior y la version', () => {
    expect(cabecerasLlave({ DS_LLAVE_DESTINATARIO: LLAVE, DS_LLAVE_DESTINATARIO_ANTERIOR: `${LLAVE}2`, DS_LLAVE_DESTINATARIO_VERSION: '2' })).toEqual({ 'x-rtm-llave': LLAVE, 'x-rtm-llave-anterior': `${LLAVE}2`, 'x-rtm-llave-version': '2' });
  });
  it('rechaza una llave de menos de 32 caracteres', () => {
    expect(() => cabecerasLlave({ DS_LLAVE_DESTINATARIO: 'corta' })).toThrow();
    expect(() => cabecerasLlave({ DS_LLAVE_DESTINATARIO: LLAVE, DS_LLAVE_DESTINATARIO_ANTERIOR: 'corta' })).toThrow();
  });
  it('ignora una version que no es un entero corto', () => expect(cabecerasLlave({ DS_LLAVE_DESTINATARIO: LLAVE, DS_LLAVE_DESTINATARIO_VERSION: 'x1' })).toEqual({ 'x-rtm-llave': LLAVE }));
});

describe('la llave no vive en el repo', () => {
  const archivos = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return n === 'node_modules' || n === '.next' || n === '.git' ? [] : statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx|mjs|sql|md|json)$/.test(n) ? [p] : []; });
  it('ningun archivo versionado asigna un valor a DS_LLAVE_DESTINATARIO', () => {
    const malos = archivos(join(process.cwd(), 'src')).concat(archivos(join(process.cwd(), 'scripts')), archivos(join(process.cwd(), 'supabase'))).filter((f) => /DS_LLAVE_DESTINATARIO\s*=\s*['"]?[A-Za-z0-9+/=_-]{16,}/.test(readFileSync(f, 'utf8')));
    expect(malos).toEqual([]);
  });
});
