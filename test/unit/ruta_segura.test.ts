import { describe, it, expect } from 'vitest';
import { destinoSeguro, rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';

describe('ruta propia segura (next)', () => {
  it.each(['/', '/pedidos', '/pedidos/nuevo', '/catalogo?modelo=3', '/clientes/7', '/inventario?x=1', '/socios#a', '/omar', '/movimientos', '/movimientos/importar', '/apertura', '/apertura/paso/4', '/contabilidad', '/contabilidad/estado-de-resultados?ini=2026-11-01', '/proveedores/', '/paquetes/por-hacer', '/paquetes/en-trayecto', '/cuentas-por-cobrar', '/avisos?estado=todos'])('acepta %s', (r) => {
    expect(rutaPropiaSegura(r)).toBe(true);
  });
  it.each([
    'https://externo.test', '//externo.test', '/\\externo', '/../x', '/pedidos/../../x', '/pedidos/%2e%2e/x', '/pedidosX', '/pedidos.evil.test', '/paquetesX', '/avisos.evil.test', '/cuentas-por-cobrarX',
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
