// Permisos de la vista de Omar: sin sesion o desactivado no ve nada; un socio no entra por aqui; Omar nunca recibe costos, margenes ni clientes.
import { describe, expect, it } from 'vitest';
import { cargarBodega, cargarCuenta, cargarPaquetes, explicarOmar, SinAccesoOmar, solicitarPiezas, type DepsOmar } from '@/aplicacion/omar/casos';
import { ACCIONES_OMAR, puede, puedeOmar } from '@/dominio/capacidades';
import { parsearCuenta, parsearDisponible, parsearLiquidaciones, parsearPaquetes, parsearSolicitudes } from '@/dominio/omar/lectura';
import { LLAVES_PROHIBIDAS } from '@/dominio/omar/tipos';
import { OmarMemoria } from '@/infra/omar/memoria';
import { CUENTA, DISPONIBLE, LIQUIDACIONES, PAQUETES } from './fixtures';

const CLAVE = 'web:3f2a9c1e-1111-4222-8333-444455556666';
const omarActivo = { rol: 'omar', socio_nombre: null, activo: true } as const;

function deps(perfil: DepsOmar['perfil']): DepsOmar & { mem: OmarMemoria } {
  const mem = new OmarMemoria({ disponible: structuredClone(DISPONIBLE), cuenta: CUENTA, liquidaciones: LIQUIDACIONES, paquetes: PAQUETES }, () => new Date('2026-11-11T18:00:00Z'));
  return { perfil, lector: mem, cola: mem, mem };
}

describe('tabla de capacidades', () => {
  it('solo omar activo tiene las acciones de su vista; socio, anonimo y omar desactivado no', () => {
    for (const a of ACCIONES_OMAR) {
      expect(puedeOmar('omar', true, a)).toBe(true);
      expect(puedeOmar('omar', false, a)).toBe(false);
      expect(puedeOmar('omar', null, a)).toBe(false);
      expect(puedeOmar('socio', true, a)).toBe(false);
      expect(puedeOmar(null, true, a)).toBe(false);
    }
  });
  it('Omar sigue sin ninguna accion de socio', () => {
    expect(puede('omar', 'ver_inicio')).toBe(false);
    expect(puede('omar', 'ver_cuenta_omar')).toBe(false);
  });
});

describe('casos de uso exigen acceso antes de tocar un puerto', () => {
  const sinAcceso: Array<[string, DepsOmar['perfil']]> = [
    ['sin sesion', null],
    ['omar desactivado (hasta M2)', { ...omarActivo, activo: false }],
    ['socio', { rol: 'socio', socio_nombre: 'Javier', activo: true }],
  ];
  for (const [nombre, perfil] of sinAcceso) {
    it(`${nombre}: nada de lectura ni escritura`, async () => {
      const d = deps(perfil);
      const llamadas: string[] = [];
      const espiar = <T extends object>(o: T): T => new Proxy(o, { get: (t, k) => (typeof (t as Record<string | symbol, unknown>)[k] === 'function' ? (...a: unknown[]) => { llamadas.push(String(k)); return ((t as Record<string | symbol, (...x: unknown[]) => unknown>)[k])!(...a); } : (t as Record<string | symbol, unknown>)[k]) });
      const e = { ...d, lector: espiar(d.lector), cola: espiar(d.cola) };
      await expect(cargarBodega(e)).rejects.toBeInstanceOf(SinAccesoOmar);
      await expect(cargarCuenta(e, '2026-11-11')).rejects.toBeInstanceOf(SinAccesoOmar);
      await expect(cargarPaquetes(e)).rejects.toBeInstanceOf(SinAccesoOmar);
      await expect(solicitarPiezas(e, { clave: CLAVE, modelo: 'Elux Legend 3.5K', sabor: 'Sandía', piezas: 1 })).rejects.toBeInstanceOf(SinAccesoOmar);
      await expect(explicarOmar(e, 'omar:saldo')).rejects.toBeInstanceOf(SinAccesoOmar);
      expect(llamadas).toEqual([]);
      expect(d.mem.solicitudesCreadas).toHaveLength(0);
    });
  }
  it('omar activo si lee y solicita', async () => {
    const d = deps(omarActivo);
    expect((await cargarBodega(d)).disponible.estado).toBe('ok');
    expect(await solicitarPiezas(d, { clave: CLAVE, modelo: 'Elux Legend 3.5K', sabor: 'Sandía', piezas: 2 })).toMatchObject({ ok: true, estado: 'pendiente' });
  });
});

describe('Omar nunca recibe costos, margenes, clientes ni folios de pedido', () => {
  const basura = { modelo: 'Elux', sabor: 'Uva', piezas: 3, costo_cent: 6000, margen_cent: 100, utilidad: 5, cliente: 'Villa', proveedor: 'Isaac', socio: 'Angelo', duenio: 'Javier', precio_venta: 99, reservado: 7 };
  const llaves = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(llaves) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...llaves(x)]) : []);

  it('los parsers de lista blanca descartan cualquier columna de mas', () => {
    const filas = [basura];
    for (const salida of [parsearDisponible(filas), parsearSolicitudes(filas), parsearLiquidaciones(filas), parsearPaquetes([{ ...basura, renglones: [basura] }]), parsearCuenta([{ ...basura, concepto: 'toma', fecha: '2026-11-10', importe: 1 }])]) {
      expect(llaves(salida).filter((k) => LLAVES_PROHIBIDAS.test(k))).toEqual([]);
      expect(JSON.stringify(salida, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))).not.toMatch(/Villa|Isaac|Angelo|Javier/);
    }
  });
  it('la renta pierde el folio del pedido: se renumera R-001', () => {
    const c = parsearCuenta([
      { concepto: 'renta', fecha: '2026-11-10', referencia: 'P-0102', modelo: 'X', piezas: 5, tarifa: 200, importe: 1000 },
      { concepto: 'renta', fecha: '2026-11-09', referencia: 'P-0101', modelo: 'X', piezas: 5, tarifa: 200, importe: 1000 },
    ]);
    expect(c.map((m) => m.referencia)).toEqual(['R-001', 'R-002']);
  });
  it('lo que carga cada vista no contiene llaves prohibidas ni folios de pedido', async () => {
    const d = deps(omarActivo);
    const todo = [await cargarBodega(d), await cargarCuenta(d, '2026-11-11'), await cargarPaquetes(d)];
    const json = JSON.stringify(todo, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
    expect(llaves(todo).filter((k) => LLAVES_PROHIBIDAS.test(k))).toEqual([]);
    expect(json).not.toMatch(/costo|margen|utilidad/i);
  });
});
