import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// El login se ve como el de Likida Bitacoras (panel oscuro con el arte animado a la izquierda, formulario a la derecha), con textos RTM.
// Cambios cerrados respecto al original: sin Google ni separador «o»; marca y textos de RTM.
describe('login: copia fiel de Likida Bitacoras con las reglas de RTM', () => {
  const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, 'login.css'), 'utf8');

  it('dos columnas: el panel del arte a la izquierda (columna 1) y el formulario a la derecha (columna 2) desde 1024 px, y el panel se oculta debajo', () => {
    expect(css).toMatch(/\.login-visual \{ display: none; \}/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[^@]*\.login \{ display: grid; grid-template-columns: 1fr 1fr; \}/);
    expect(css).toMatch(/\.login-column \{ grid-column: 2;/);
    expect(css).toMatch(/\.login-visual \{ display: flex; grid-column: 1;/);
    for (const clase of ['login-column', 'login-inner', 'login-copy', 'login-visual', 'login-story-surface', 'login-story-copy']) expect(src).toContain(clase);
    expect(src).toContain('<LoginArtwork />');
  });

  it('el panel lleva la etiqueta, el titular y la linea de apoyo de RTM', () => {
    expect(src).toContain('MARCA.nombre');
    expect(src).toContain('MARCA.eslogan');
    expect(src).toContain('login-story-description');
  });

  it('el formulario conserva TODOS sus textos funcionales (RTM)', () => {
    for (const t of ['Acceso', 'Bienvenido a', 'Continuar con correo', 'Solicitando…', 'tu@correo.com', 'Pídele a un socio que te dé de alta.', 'Términos de Servicio', 'Aviso de Privacidad', 'Reenviar el enlace', 'Usar otro correo']) expect(src).toContain(t);
    expect(src).not.toMatch(/idioma|Language|invitación/i);
  });

  it('sin Google ni separador «o»: la rama no existe (no esta apagada por variable)', () => {
    expect(src).not.toMatch(/google|Google|login-o\b|login-o-letra|entrarConGoogle|signInWithOAuth/);
    expect(css).not.toMatch(/\.login-google|\.login-o\b|\.login-o-letra/);
  });

  it('sin `style=` ni <style> en la pagina: los retardos de entrada viven en login.css', () => {
    expect(src).not.toMatch(/\sstyle=|<style/);
    for (const d of ['login-d0', 'login-d4', 'login-d8']) expect(css).toContain(`.${d} {`);
  });

  it('login.css: ventanas bajas aprietan el alto (sin scroll en laptops)', () => {
    expect(css).toMatch(/@media \(min-width: 1024px\) and \(max-height: 860px\)/);
    expect(src).toContain("import './login.css';");
  });

  it('el boton principal es de tinta, el foco usa --foco; el panel es de tinta', () => {
    expect(css).toMatch(/\.login-btn-tinta \{ background: var\(--ink\); color: var\(--bg\); \}/);
    expect(css).toMatch(/\.login-btn-borde \{ background: var\(--surface\);/);
    expect(css).toMatch(/\.login-campo:focus-visible \{[^}]*outline: 2px solid var\(--foco\)/);
    expect(css).toMatch(/\.login-story-surface \{[^}]*var\(--ink\)/);
  });

  it('solo enlace magico y «enviado» es una sola tarjeta', () => {
    expect(src).not.toMatch(/8 dígitos|Entrar con el código/);
    expect(src).toMatch(/sp\?\.enviado \?/);
  });
});
