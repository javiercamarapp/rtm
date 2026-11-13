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

  it('con la base caida, login falla CERRADO (decision del dueno, 13-nov): el limitador lanza y nunca devuelve false por un error', () => {
    expect(LIMITADOR).toMatch(/FALLA CERRADO/);
    expect(LIMITADOR).not.toMatch(/Falla ABIERTO/);
    expect(LIMITADOR).toMatch(/if \(!Number\.isFinite\(n\)\) throw new LimitadorNoDisponible/);
    expect(LIMITADOR).not.toMatch(/catch \{\s*return false;/);
    expect(LIMITADOR).toMatch(/query_timeout/);
    // Ya no usa la llave anon: se conecta con el rol servidor.
    expect(LIMITADOR).not.toMatch(/ANON_KEY|createClient/);
    expect(LIMITADOR).toMatch(/SERVIDOR_DATABASE_URL/);
  });

  it('la decision enviado/error pasa por respuestaOtp y el piso de tiempo', () => {
    expect(PAGINA).toMatch(/return respuestaOtp\(error\)/);
    expect(PAGINA).toMatch(/salida !== 'enviado'/);
    expect(PAGINA).toMatch(/conPisoDeTiempo\(async \(\) =>/);
    expect(PAGINA).toMatch(/pedirEnlace\(email, dest, limiteIp === 'no_disponible'\)/);
    expect(PAGINA).not.toMatch(/esCorreoSinCuenta/);
    expect(PAGINA).not.toMatch(/otp_disabled/);
  });
});
