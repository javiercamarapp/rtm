import { describe, it, expect } from 'vitest';
import { destinoSeguro, redireccionPorRol, rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';

describe('ruta propia segura (next)', () => {
  it.each(['/', '/pedidos', '/pedidos/nuevo', '/catalogo?modelo=3', '/clientes/7', '/inventario?x=1', '/socios#a', '/omar', '/devoluciones', '/movimientos', '/movimientos/importar', '/apertura', '/apertura/paso/4', '/contabilidad', '/contabilidad/estado-de-resultados?ini=2026-11-01', '/proveedores/', '/paquetes/por-hacer', '/paquetes/en-trayecto', '/cuentas-por-cobrar', '/avisos?estado=todos'])('acepta %s', (r) => {
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

describe('redireccion por rol (Omar y bodega no ven rutas del socio)', () => {
  it('Omar activo: cualquier ruta de pagina ajena redirige a /mi-bodega; la suya, el login y las API no', () => {
    for (const r of ['/', '/pedidos', '/contabilidad/balance', '/bodega', '/socios']) expect(redireccionPorRol('omar', true, r)).toBe('/mi-bodega');
    for (const r of ['/mi-bodega', '/mi-bodega/algo', '/login', '/auth/callback', '/api/health', '/terminos', '/privacidad']) expect(redireccionPorRol('omar', true, r)).toBeNull();
  });
  it('bodega activa: solo /bodega', () => {
    for (const r of ['/', '/pedidos', '/mi-bodega', '/cuentas']) expect(redireccionPorRol('bodega', true, r)).toBe('/bodega');
    expect(redireccionPorRol('bodega', true, '/bodega')).toBeNull();
    expect(redireccionPorRol('bodega', true, '/bodega/llegadas')).toBeNull();
  });
  it('un prefijo parecido no cuenta como la zona propia', () => {
    expect(redireccionPorRol('omar', true, '/mi-bodega-falsa')).toBe('/mi-bodega');
    expect(redireccionPorRol('bodega', true, '/bodegas')).toBe('/bodega');
  });
  it('socio, cuenta inactiva o sin rol: no redirige (los layouts deciden)', () => {
    expect(redireccionPorRol('socio', true, '/pedidos')).toBeNull();
    expect(redireccionPorRol('omar', false, '/pedidos')).toBeNull();
    expect(redireccionPorRol(undefined, true, '/pedidos')).toBeNull();
  });
});
