import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dos propiedades del acceso que un cambio de una linea puede deshacer sin que ninguna otra prueba se entere.
//  · `shouldCreateUser: false`: el default de Supabase es `true`, y sin esa opcion CUALQUIER correo tecleado crea un auth.users real.
//  · El limite de intentos antes de llamar a Supabase (cada intento gasta cuota de envio, la unica via de entrada).
// En RTM la logica vive en capas: pagina (server action) -> composicion -> aplicacion/infra. Se lee el fuente de cada una.
const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
const PAGINA = leer('./page.tsx');
const AUTENTICADOR = leer('../../infra/supabase/autenticador.ts');
const LIMITADOR = leer('../../infra/limite/limitador_postgres.ts');

describe('/login no se autoregistra ni se queda sin limite', () => {
  it('pide shouldCreateUser: false al mandar el enlace magico', () => {
    expect(AUTENTICADOR).toMatch(/shouldCreateUser:\s*false/);
  });

  it('limita por IP antes de pedir el enlace, y el limite vive en Postgres (sin Redis ni Upstash)', () => {
    expect(PAGINA).toMatch(/ipDentroDelLimite\(\)/);
    expect(PAGINA.indexOf('ipDentroDelLimite()')).toBeLessThan(PAGINA.indexOf('pedirEnlace('));
    expect(LIMITADOR).toMatch(/registrar_intento_login/);
    for (const f of [PAGINA, LIMITADOR, AUTENTICADOR]) expect(f).not.toMatch(/redis|upstash/i);
  });

  it('con la base caida, login falla ABIERTO (valvula de escape): es la unica via de entrada', () => {
    expect(LIMITADOR).toMatch(/Falla ABIERTO/);
    expect(LIMITADOR).toMatch(/if \(error \|\| typeof data !== 'number'\) return false/);
  });

  it('la decision enviado/error pasa por respuestaOtp y el piso de tiempo', () => {
    expect(PAGINA).toMatch(/respuestaOtp\(error\) === 'error'/);
    expect(PAGINA).toMatch(/conPisoDeTiempo\(\(\) => pedirEnlace/);
    expect(PAGINA).not.toMatch(/esCorreoSinCuenta/);
    expect(PAGINA).not.toMatch(/otp_disabled/);
  });
});
