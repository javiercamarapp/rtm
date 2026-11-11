import { describe, it, expect } from 'vitest';
import { destinoSeguro, rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';

describe('ruta propia segura (next)', () => {
  it.each(['/', '/pedidos', '/pedidos/nuevo', '/inventario?x=1', '/socios#a', '/omar', '/proveedores/'])('acepta %s', (r) => {
    expect(rutaPropiaSegura(r)).toBe(true);
  });
  it.each([
    'https://externo.test', '//externo.test', '/\\externo', '/../x', '/pedidos/../../x', '/pedidos/%2e%2e/x', '/pedidosX', '/pedidos.evil.test',
    '', '/otra', 'pedidos', '/%0d%0a', '/pedidos\u0000', 'javascript:alert(1)',
  ])('rechaza %s', (r) => {
    expect(rutaPropiaSegura(r)).toBe(false);
  });
  it('rechaza nulos y rutas absurdamente largas', () => {
    expect(rutaPropiaSegura(null)).toBe(false);
    expect(rutaPropiaSegura(undefined)).toBe(false);
    expect(rutaPropiaSegura('/pedidos?' + 'a'.repeat(3000))).toBe(false);
  });
  it('destinoSeguro cae a la raiz', () => {
    expect(destinoSeguro('https://externo.test')).toBe('/');
    expect(destinoSeguro(undefined)).toBe('/');
    expect(destinoSeguro('/pedidos')).toBe('/pedidos');
  });
});
