import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prueba 7 de la especificacion: paridad con Likida Bitacoras. Los archivos copiados deben ser IDENTICOS al repo de referencia
// (huella sha256 tomada del original), salvo la lista cerrada de cambios de login.css. Las capturas a 1440 y 1280 estan en docs/capturas/f0.
const raiz = join(__dirname, '../..');
const sha = (ruta: string) => createHash('sha256').update(readFileSync(join(raiz, ruta))).digest('hex');

// Huellas del original (likida-bitacoras, 10-nov-2026).
const ORIGINAL = {
  'src/ui/login/artwork.tsx': '7b91c4982e58a3bea20720157fd701a579fdbe80f0e41b9bbdef9b1733eec882',
  'src/ui/login/particle-engine.js': 'fb0f5d105d9ce33a68fb9edd548549c2c34fdce05104844d8007f38dde9f1149',
  'src/ui/login/particle-engine.d.ts': '4d89df21a7b219bbd4b0c4093e02d84d93a50974d6af997c46ebb23b451e96cf',
  'src/app/login/boton-login.tsx': '22f13c385320371f61586911c158df6ef1d9872a99f4f9d684ea0aaa0dd77c0c',
  'src/app/login/respuesta_otp.ts': '1751486235ca646799f2a5c39ef2f4fb461667624688dbb3ad06d79d735d1cd2',
} as const;

describe('paridad con Likida Bitacoras (copia fiel)', () => {
  for (const [ruta, huella] of Object.entries(ORIGINAL)) {
    it(`${ruta} es identico al original`, () => {
      expect(sha(ruta)).toBe(huella);
    });
  }

  it('login.css difiere del original SOLO por la lista cerrada de cambios: se borra Google y el separador «o»', () => {
    const original = readFileSync(join(raiz, 'test/fixtures/referencia-likida/login.css.ref'), 'utf8').split('\n');
    const mio = readFileSync(join(raiz, 'src/app/login/login.css'), 'utf8').split('\n');
    const conjuntoMio = new Set(mio);
    const conjuntoOriginal = new Set(original);
    const quitadas = original.filter((l) => !conjuntoMio.has(l));
    const agregadas = mio.filter((l) => !conjuntoOriginal.has(l));
    // Toda linea quitada o agregada habla de Google / «o» (o es la misma regla sin `.login-google`).
    // Cambio adicional aprobado: el campo del correo pasa de 15 px a 16 px (iOS no amplia la pagina al enfocarlo).
    for (const l of quitadas) expect(l).toMatch(/\.login-google|\.login-o\b|\.login-o-letra|\.login-o >/);
    for (const l of agregadas) expect(l).toMatch(/^\s*\.login-divider, \.login-email-solo \{ margin-top: (20|24)px; \}$|^\s*font-size: 16px; \/\* >= 16 px: iOS no amplia la pagina al enfocar el campo \*\/$/);
    expect(quitadas.length).toBe(8); // la linea de 15 px sigue existiendo en otras reglas: el conjunto de quitadas no cambia
    expect(agregadas.length).toBe(3);
    // Ningun selector nuevo, ninguna propiedad cambiada: el resto del archivo es linea por linea el original.
    expect(mio.length).toBe(original.length - 6);
  });
});
