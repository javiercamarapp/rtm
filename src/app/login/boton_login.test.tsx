import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { BotonLogin } from './boton-login';

describe('BotonLogin (R08)', () => {
  it('en reposo dice «Continuar con correo», es submit y no está ocupado', () => {
    const html = renderToStaticMarkup(<BotonLogin className="login-btn login-btn-tinta" ocupado="Solicitando…">Continuar con correo</BotonLogin>);
    expect(html).toContain('Continuar con correo');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('disabled');
  });
  it('usa useFormStatus: deshabilita, marca aria-busy y cambia el texto a «Solicitando…» (contrato del código)', () => {
    const src = readFileSync(join(__dirname, 'boton-login.tsx'), 'utf8');
    expect(src).toContain('useFormStatus');
    expect(src).toContain('disabled={pending}');
    expect(src).toContain('aria-busy={pending || undefined}');
  });
  it('la página usa el botón para correo y reenvío (sin Google), y login.css lo estiliza', () => {
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(page.match(/<BotonLogin /g)).toHaveLength(2);
    expect(page).toContain('ocupado="Solicitando…"');
    expect(page).not.toMatch(/<button type="submit" className="login-btn/);
  });
});
