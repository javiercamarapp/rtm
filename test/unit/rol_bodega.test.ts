import { describe, it, expect } from 'vitest';
import { completarAcceso, completarConfirmacion } from '@/aplicacion/acceso/completar_acceso';
import type { Autenticador, DepsAcceso, EstadoSesion } from '@/aplicacion/acceso/puertos';
import { cambiarEstado, darDeAlta, ErrorCuentas, type PuertoCuentas } from '@/aplicacion/cuentas/cuentas';
import { ACCIONES, ACCIONES_BODEGA, CAPACIDADES, puede, puedeBodega, puedeOmar } from '@/dominio/capacidades';
import { destinoSeguro, rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';
import { parsearHoy, parsearLlegadas } from '@/dominio/bodega/bodega';
import { normalizarCorreo, parsearCuentas, validarAlta } from '@/dominio/cuentas/cuentas';

describe('capacidades del rol bodega', () => {
  it('bodega no tiene ninguna accion de socio ni de Omar', () => {
    for (const a of ACCIONES) expect(puede('bodega', a)).toBe(false);
    expect(puedeOmar('bodega', true, 'omar_ver_bodega')).toBe(false);
  });
  it('solo bodega ACTIVA ve su vista; desactivada, nada', () => {
    for (const a of ACCIONES_BODEGA) {
      expect(puedeBodega('bodega', true, a)).toBe(true);
      expect(puedeBodega('bodega', false, a)).toBe(false);
      expect(puedeBodega('omar', true, a)).toBe(false);
      expect(puedeBodega(null, true, a)).toBe(false);
    }
  });
  it('administrar cuentas es solo de socio', () => {
    expect(CAPACIDADES.gestionar_cuentas).toEqual(['socio']);
  });
});

describe('rutas propias', () => {
  it('acepta /bodega y /cuentas como destino y no confunde /cuentas-por-cobrar', () => {
    for (const r of ['/bodega', '/bodega/llegadas', '/cuentas', '/cuentas?x=1', '/cuentas-por-cobrar']) expect(rutaPropiaSegura(r)).toBe(true);
    expect(destinoSeguro('/cuentasx')).toBe('/');
    expect(destinoSeguro('//bodega')).toBe('/');
  });
});

function armar(estado: EstadoSesion) {
  let cerrada = false;
  const autenticador: Autenticador = {
    async enviarEnlace() { return { error: null }; },
    async canjearCodigo() { return { error: null }; },
    async canjearTokenHash() { return { error: null }; },
    async sesion() { return estado; },
    async cerrarSesion() { cerrada = true; },
  };
  const deps: DepsAcceso = {
    autenticador,
    limitador: { async excede() { return false; } },
    reenvio: { async guardarCorreo() {}, async correoRecordado() { return null; }, async hayEspera() { return false; }, async marcarEspera() {} },
    rastro: { fallo() {}, aviso() {} },
    urlApp: 'http://127.0.0.1:3197',
  };
  return { deps, cerrada: () => cerrada };
}

describe('acceso de bodega por enlace magico', () => {
  it('bodega activa aterriza en /bodega (callback y confirmacion)', async () => {
    const { deps } = armar({ autenticado: true, perfil: { rol: 'bodega', socio_nombre: null, activo: true } });
    expect(await completarAcceso(deps, { code: 'c', next: '/pedidos', errorCode: null, ip: '1.1.1.1' })).toEqual({ destino: '/bodega' });
    expect(await completarConfirmacion(deps, { tokenHash: 'h', tipo: 'magiclink', next: '/', ip: '1.1.1.1' })).toEqual({ destino: '/bodega' });
  });
  it('bodega DESACTIVADA no entra: se cierra la sesion', async () => {
    const { deps, cerrada } = armar({ autenticado: true, perfil: { rol: 'bodega', socio_nombre: null, activo: false } });
    expect(await completarAcceso(deps, { code: 'c', next: null, errorCode: null, ip: '1.1.1.1' })).toEqual({ destino: '/login?error=desactivada' });
    expect(cerrada()).toBe(true);
  });
});

describe('parsers de bodega: lista blanca', () => {
  it('una columna de mas (precio, nota, telefono, direccion) no cruza la frontera', () => {
    const hoy = parsearHoy({
      fecha: '2026-11-14', precio_cent: 15000, telefono: '999',
      clientes: [{ cliente: 'Cliente A', piezas: 5, saldo_cent: 100, pedidos: [{ folio: 'P-0001', fecha: '2026-11-14', de_hoy: true, empacado: false, zona: 'merida', piezas: 5, nota: 'x', direccion: 'calle', envio_cent: 3, lineas: [{ modelo: 'M', sabor: 'S', piezas: 5, precio_cent: 9 }] }] }],
      surtido: [{ modelo: 'M', sabor: 'S', piezas: 5, existencia: 3, falta: 2, costo_cent: 7 }],
      resumen: { pedidos: 1, clientes: 1, por_empacar: 1, empacados: 0, de_dias_anteriores: 0, piezas: 5, total_cent: 5 },
    });
    expect(JSON.stringify(hoy)).not.toMatch(/precio|saldo|nota|direccion|telefono|envio|costo|total|999/);
    expect(hoy.clientes[0]!.pedidos[0]!.zona).toBe('Mérida');
    expect(hoy.surtido[0]!.falta).toBe(2);
  });
  it('llegadas: solo estados validos y sin costos', () => {
    const l = parsearLlegadas({ fecha: '2026-11-14', compras: [
      { folio: 'C-1', proveedor: 'Isaac', estado: 'en_trayecto', llegada_estimada: '2026-11-20', dias_en_camino: 1, atrasada: false, piezas: 10, total_cent: 99, guias: [{ paqueteria: 'Castores', numero: 'G1', costo_cent: 5 }], lineas: [{ modelo: 'M', sabor: 'S', piezas: 10, costo_unit_cent: 4 }] },
      { folio: 'C-2', proveedor: 'Isaac', estado: 'borrador', piezas: 1, lineas: [] },
    ], por_guardar: [{ modelo: 'M', sabor: 'S', piezas: 10 }] });
    expect(l.compras).toHaveLength(1);
    expect(JSON.stringify(l)).not.toMatch(/total|costo|99/);
    expect(parsearHoy(null).clientes).toEqual([]);
  });
});

describe('cuentas: validacion y casos de uso', () => {
  it('normaliza y valida el correo y el tipo', () => {
    expect(normalizarCorreo('  A@Example.test ')).toBe('a@example.test');
    expect(validarAlta({ correo: 'no', tipo: 'bodega', nombre: '' }, ['bodega']).ok).toBe(false);
    expect(validarAlta({ correo: 'a@example.test', tipo: 'socio', nombre: '' }, ['bodega']).ok).toBe(false);
    const v = validarAlta({ correo: ' A@Example.test ', tipo: 'bodega', nombre: ' Turno ' }, ['bodega']);
    expect(v.ok && v.valor).toEqual({ correo: 'a@example.test', tipo: 'bodega', nombre: 'Turno' });
  });
  it('el parser copia solo los campos conocidos', () => {
    const l = parsearCuentas({ tipos: [{ rol: 'bodega', etiqueta: 'Bodega', descripcion: 'd', creable_web: true, secreto: 'x' }], cuentas: [{ correo: 'a@example.test', rol: 'bodega', tipo: 'Bodega', nombre: null, activo: true, gestionable: true, acceso_creado: false, ultimo_ingreso: null, hash: 'zz' }] });
    expect(JSON.stringify(l)).not.toMatch(/secreto|zz/);
    expect(l.cuentas[0]!.accesoCreado).toBe(false);
  });
  const puerto = (alta: PuertoCuentas['alta'], estado?: PuertoCuentas['cambiarEstado']): PuertoCuentas => ({ listar: async () => ({ tipos: [], cuentas: [] }), alta, cambiarEstado: estado ?? (async () => ({ estado: 'sin_cambio' as const })) });
  const CLAVE = 'web:12345678-1234-1234-1234-123456789abc';
  it('el alta valida antes de llamar al puerto y sin clave no hace nada', async () => {
    let llamadas = 0;
    const p = puerto(async () => { llamadas += 1; return { estado: 'creada', accesoCreado: false }; });
    expect((await darDeAlta(p, CLAVE, { correo: 'x', tipo: 'bodega', nombre: '' }, ['bodega'])).ok).toBe(false);
    expect((await darDeAlta(p, 'sin-clave', { correo: 'a@example.test', tipo: 'bodega', nombre: '' }, ['bodega'])).ok).toBe(false);
    expect((await darDeAlta(p, CLAVE, { correo: 'a@example.test', tipo: 'socio', nombre: '' }, ['bodega'])).ok).toBe(false);
    expect(llamadas).toBe(0);
    const r = await darDeAlta(p, CLAVE, { correo: 'a@example.test', tipo: 'bodega', nombre: '' }, ['bodega']);
    expect(r.ok && r.eco).toMatch(/acceso:cuentas/);
    expect(llamadas).toBe(1);
  });
  it('traduce el rechazo de la base a un mensaje en palabras (sin texto tecnico)', async () => {
    const p = puerto(async () => { throw new ErrorCuentas('permission denied for function', '42501'); });
    const r = await darDeAlta(p, CLAVE, { correo: 'a@example.test', tipo: 'bodega', nombre: '' }, ['bodega']);
    expect(!r.ok && r.mensaje).toMatch(/solo un socio/);
    expect(!r.ok && r.mensaje).not.toMatch(/permission denied/);
    const e = await cambiarEstado(puerto(async () => ({ estado: 'creada', accesoCreado: true }), async () => { throw new ErrorCuentas('x', '42501'); }), CLAVE, 'a@example.test', false, null);
    expect(e.ok).toBe(false);
  });
  it('desactivar manda el motivo recortado y reactivar lo confirma', async () => {
    let visto: { activo: boolean; motivo: string | null } | null = null;
    const p = puerto(async () => ({ estado: 'creada', accesoCreado: true }), async (_c, _co, activo, motivo) => { visto = { activo, motivo }; return { estado: activo ? 'reactivada' : 'desactivada' }; });
    const r = await cambiarEstado(p, CLAVE, 'A@Example.test', false, '  ya no trabaja  ');
    expect(r.ok && r.eco).toMatch(/desactivada/);
    expect(visto).toEqual({ activo: false, motivo: 'ya no trabaja' });
  });
});
