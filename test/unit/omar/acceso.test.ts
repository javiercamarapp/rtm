// Acceso de Omar: el interruptor (cuenta activa) manda. Desactivado, el enlace canjea pero no hay sesion usable (comportamiento de hoy, hasta M2).
import { describe, expect, it } from 'vitest';
import { completarAcceso, completarConfirmacion } from '@/aplicacion/acceso/completar_acceso';
import type { Autenticador, DepsAcceso, EstadoSesion } from '@/aplicacion/acceso/puertos';
import { destinoSeguro, DESTINO_OMAR, rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';

function armar(estado: EstadoSesion) {
  let cerrada = false;
  const autenticador: Autenticador = {
    async enviarEnlace() { return { error: null }; },
    async canjearCodigo() { return { error: null }; },
    async canjearTokenHash() { return { error: null }; },
    async sesion() { return estado; },
    async cerrarSesion() { cerrada = true; },
  };
  const deps = {
    autenticador,
    limitador: { async excede() { return false; } },
    reenvio: { async guardarCorreo() {}, async correoRecordado() { return null; }, async hayEspera() { return false; }, async marcarEspera() {} },
    rastro: { fallo() {}, aviso() {} },
    urlApp: 'https://app.example.test',
  } satisfies DepsAcceso;
  return { deps, cerrada: () => cerrada };
}
const omar = (activo: boolean): EstadoSesion => ({ autenticado: true, perfil: { rol: 'omar', socio_nombre: null, activo } });

describe('acceso de Omar', () => {
  it('cuenta ACTIVA: el enlace lo lleva a su vista, sin importar el next pedido', async () => {
    const { deps, cerrada } = armar(omar(true));
    expect(await completarAcceso(deps, { code: 'c', next: '/pedidos', errorCode: null, ip: '1.1.1.1' })).toEqual({ destino: DESTINO_OMAR });
    expect(await completarConfirmacion(deps, { tokenHash: 'h', tipo: 'magiclink', next: '/socios', ip: '1.1.1.1' })).toEqual({ destino: DESTINO_OMAR });
    expect(cerrada()).toBe(false);
  });
  it('cuenta DESACTIVADA (hasta M2): cierra la sesion y avisa; no ve nada', async () => {
    for (const via of ['callback', 'confirm'] as const) {
      const { deps, cerrada } = armar(omar(false));
      const r = via === 'callback'
        ? await completarAcceso(deps, { code: 'c', next: null, errorCode: null, ip: '1.1.1.1' })
        : await completarConfirmacion(deps, { tokenHash: 'h', tipo: 'magiclink', next: null, ip: '1.1.1.1' });
      expect(r.destino).toBe('/login?error=desactivada');
      expect(cerrada()).toBe(true);
    }
  });
  it('un socio sigue entrando a su destino', async () => {
    const { deps } = armar({ autenticado: true, perfil: { rol: 'socio', socio_nombre: 'Javier', activo: true } });
    expect(await completarAcceso(deps, { code: 'c', next: '/pedidos', errorCode: null, ip: '1.1.1.1' })).toEqual({ destino: '/pedidos' });
  });
  it('/mi-bodega es una ruta propia valida para next', () => {
    expect(rutaPropiaSegura('/mi-bodega')).toBe(true);
    expect(rutaPropiaSegura('/mi-bodega/cuenta?x=1')).toBe(true);
    expect(rutaPropiaSegura('/mi-bodega/../socios')).toBe(false);
    expect(destinoSeguro('//evil.test')).toBe('/');
  });
});
