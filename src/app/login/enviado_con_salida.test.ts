import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// `/login?enviado=1` — la pantalla de confirmacion del enlace magico: UNA tarjeta (a que correo se mando) con sus dos salidas,
// sin el formulario repetido debajo y SIN campo de codigo. `enviado=1` no puede ser un callejon sin salida: «Usar otro correo» y «Reenviar el enlace».
// Se lee el fuente (la pagina es un server component y no se monta suelta). Adaptado de Likida Bitacoras: sin la rama de Google.
const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');

describe('/login?enviado=1: la tarjeta de enviado tiene salida y el formulario sigue en la rama contraria', () => {
  it('«enviado» es una rama (? :) cuya otra mitad es el formulario de entrada por correo', () => {
    const rama = PAGINA.indexOf('{sp?.enviado ? (');
    const otra = PAGINA.indexOf(') : (', rama);
    expect(rama).toBeGreaterThan(-1);
    expect(otra).toBeGreaterThan(rama);
    expect(PAGINA.indexOf('action={entrarConEmail}')).toBeGreaterThan(otra);
  });

  it('la tarjeta dice a que correo se mando y ofrece reenviar o usar otro correo', () => {
    expect(PAGINA).toContain('correoEnviado');
    expect(PAGINA).toContain('Reenviar el enlace');
    expect(PAGINA).toContain('Usar otro correo');
  });

  it('el login NO tiene campo de codigo ni «Entrar con el codigo»', () => {
    expect(PAGINA).not.toMatch(/login-codigo|Entrar con el código|one-time-code|entrarConCodigo/);
  });
});
