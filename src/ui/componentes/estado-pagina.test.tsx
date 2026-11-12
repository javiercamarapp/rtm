import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorConReintento } from './error-con-reintento';
import { PaginaCargando, PaginaError, PaginaNoEncontrada } from './estado-pagina';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('PaginaCargando', () => {
  it('anuncia la carga a lectores de pantalla y marca aria-busy', () => {
    const html = renderToStaticMarkup(<PaginaCargando etiqueta="Cargando pedidos" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Cargando pedidos');
  });
});

describe('PaginaError', () => {
  it('es una alerta con boton Reintentar, salida al inicio y referencia sin mensaje interno', () => {
    const html = renderToStaticMarkup(<PaginaError referencia="abc123" onReintentar={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Reintentar');
    expect(html).toContain('href="/"');
    expect(html).toContain('Referencia: abc123');
  });
  it('sin referencia no inventa una', () => {
    expect(renderToStaticMarkup(<PaginaError onReintentar={() => undefined} />)).not.toContain('Referencia');
  });
  it('el limite de Next muestra el digest pero jamas el mensaje del error', () => {
    const e = Object.assign(new Error('select * from secreto'), { digest: 'd-42' });
    const html = renderToStaticMarkup(<ErrorConReintento error={e} reset={() => undefined} />);
    expect(html).toContain('d-42');
    expect(html).not.toContain('secreto');
  });
});

describe('PaginaNoEncontrada', () => {
  it('lleva al inicio por defecto y acepta otro destino', () => {
    expect(renderToStaticMarkup(<PaginaNoEncontrada />)).toContain('href="/"');
    const html = renderToStaticMarkup(<PaginaNoEncontrada volver={{ href: '/clientes', texto: 'Ver clientes' }} />);
    expect(html).toContain('href="/clientes"');
    expect(html).toContain('Ver clientes');
  });
});

describe('cobertura de estados por seccion', () => {
  const raiz = join(process.cwd(), 'src', 'app');
  it('la raiz y la zona de socio tienen error, loading y not-found', () => {
    for (const base of ['', '(socio)']) for (const f of ['error.tsx', 'loading.tsx', 'not-found.tsx']) expect(existsSync(join(raiz, base, f)), `${base}/${f}`).toBe(true);
    expect(existsSync(join(raiz, 'global-error.tsx'))).toBe(true);
  });
  it('cada seccion principal tiene loading y error propios', () => {
    for (const s of ['pedidos', 'clientes', 'catalogo', 'proveedores', 'socios', 'cuentas-por-cobrar', 'paquetes', 'inventario', 'omar', 'avisos']) {
      for (const f of ['loading.tsx', 'error.tsx']) expect(existsSync(join(raiz, '(socio)', s, f)), `${s}/${f}`).toBe(true);
    }
  });
});
