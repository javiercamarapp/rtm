import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { armarPulso, type EntradasPulso } from '@/dominio/operacion/pulso';
import type { Existencia } from '@/dominio/catalogo/tipos';
import type { CuentaProveedor, CuentaSocios, CuentasPorCobrar } from '@/dominio/operacion/tipos';
import type { CuentaSociosValuacion } from '@/dominio/socios/valuacion';
import { ExplicarProvider } from '@/ui/componentes/explicar';
import { Pulso } from '@/ui/shell/pulso';

const vacio: EntradasPulso = { isaac: null, cxc: null, socios: null, existencia: null };
const mov = { evento: 'e', canal: 'web', hora: '2026-11-10T10:00:00Z', mensaje_origen: null, autor: null, id: 1, fecha_neg: '2026-11-10', concepto: 'x', monto_cent: 1n, saldo_corrido_cent: 1n, compra: null, pago: null, cliente: null, cuenta_origen: null, nota: null };
const isaac = (posicion: bigint, movimientos: unknown[] = [mov], saldo = 0n, pendienteSocio = 0n) => ({ id: 7, proveedor: 'Isaac', modalidad: 'semanal_viernes', saldo_cent: saldo, posicion_cent: posicion, etiqueta: 'Se debe', puente_cent: 0n, movimientos, posicion: { posicion_cent: posicion, posicion_empresa_cent: posicion + pendienteSocio, menudeo_pendiente_cent: pendienteSocio } }) as unknown as CuentaProveedor;
const cxc = (total: bigint, filas = 1) => ({ hoy: '2026-11-11', filas: new Array(filas).fill({}), total_cent: total, saldos_a_favor: [], pagos_sin_identificar: [] }) as unknown as CuentasPorCobrar;
const socios = (d: bigint, hayMovs = true) => ({ hoy: '2026-11-11', costo_cent: hayMovs ? 100n : 0n, javier_debe_a_angelo_cent: d, movimientos: hayMovs ? [{}] : [] }) as unknown as CuentaSocios;
const bodega = (piezas: (number | null)[]): Existencia => ({ modelos: piezas.map((p, i) => ({ modeloId: i, marca: 'm', modelo: `m${i}`, estado: 'disponible', piezas: p, valorCent: null, costoPromCent: null, ultimoMovimiento: null })), sabores: [] });

const cuentaVal = {
  hay_movimientos: true,
  socios: [{ socio: 'Angelo', valuacion_cent: 10691039n }, { socio: 'Javier', valuacion_cent: 15483230n }],
  comparacion: { mayor: 'Javier', menor: 'Angelo', igualados: false, diferencia_valuacion_cent: 4792191n, aportar_para_igualar_cent: 4792191n },
} as unknown as CuentaSociosValuacion;

describe('armarPulso', () => {
  it('sin valuacion el chip personal dice Sin dato y nunca la diferencia informativa por la compra', () => {
    const c = armarPulso({ ...vacio, socios: socios(-5758250n) }).chips[2]!;
    expect(c.texto).toBeNull();
    expect(c.etiqueta).toBe('Tu valuación');
  });
  it('Javier ve cuanto tiene de mas', () => {
    const c = armarPulso({ ...vacio, valuacion: { cuenta: cuentaVal, yo: 'Javier' } }).chips[2]!;
    expect(c.texto).toBe('$154,832.30');
    expect(c.detalle).toBe('+$47,921.91 vs Angelo');
  });
  it('sin ninguna lectura todo es "Sin dato" y el corte tambien', () => {
    const p = armarPulso(vacio);
    expect(p.chips.map((c) => c.texto)).toEqual([null, null, null, null]);
    expect(p.chips.map((c) => c.etiqueta)).toEqual(['Por pagar a Isaac', 'Por cobrar', 'Tu valuación', 'En bodega']);
    expect(p.corte).toBeNull();
  });
  it('cuentas vacias (sin movimientos) siguen siendo Sin dato, no un cero inventado', () => {
    const p = armarPulso({ isaac: isaac(0n, []), cxc: cxc(0n, 0), socios: socios(0n, false), existencia: bodega([null, null]) });
    expect(p.chips.every((c) => c.texto === null)).toBe(true);
  });
  it('por cobrar con solo la apertura firmada (sin pedidos) ya tiene dato', () => {
    const soloApertura = { hoy: '2026-11-11', filas: [], apertura: [{}], total_cent: 750000n, saldos_a_favor: [], pagos_sin_identificar: [] } as unknown as CuentasPorCobrar;
    const c = armarPulso({ ...vacio, cxc: soloApertura }).chips[1]!;
    expect(c.texto).toBe('$7,500.00');
    expect(c.cifra).toBe('cxc:total');
  });
  it('Isaac: saldo negativo se muestra como lo que se debe, con su cifra explicable', () => {
    const c = armarPulso({ ...vacio, isaac: isaac(-123450n) }).chips[0]!;
    expect(c.texto).toBe('$1,234.50');
    expect(c.detalle).toBe('deuda de la empresa');
    expect(c.cifra).toBe('proveedor:deuda:Isaac');
  });
  it('Isaac: la cifra es la posicion completa (Mayor), no el saldo de la cuenta corriente', () => {
    const c = armarPulso({ ...vacio, isaac: isaac(-29440309n, [mov], -206809n) }).chips[0]!;
    expect(c.texto).toBe('$294,403.09');
  });
  it('Isaac: el pedido de Angelo pendiente NO suma a la deuda de la empresa y va aparte', () => {
    const c = armarPulso({ ...vacio, isaac: isaac(-29447809n, [mov], -206809n, 6680000n) }).chips[0]!;
    expect(c.texto).toBe('$227,678.09');
    expect(c.detalle).toBe('deuda de la empresa · aparte $66,800.00 de pedidos del socio');
    expect(c.cifra).toBe('proveedor:deuda:Isaac');
  });
  it('Isaac: saldo a favor y saldo cero reales', () => {
    expect(armarPulso({ ...vacio, isaac: isaac(5000n) }).chips[0]!.detalle).toBe('a favor');
    const cero = armarPulso({ ...vacio, isaac: isaac(0n) }).chips[0]!;
    expect(cero.texto).toBe('$0.00');
    expect(cero.detalle).toBe('saldo cero');
  });
  it('por cobrar, tu valuacion y bodega con cifra real', () => {
    const p = armarPulso({ isaac: null, cxc: cxc(980000n), socios: socios(-250000n), existencia: bodega([10, null, 5]), valuacion: { cuenta: cuentaVal, yo: 'Angelo' } });
    expect(p.chips[1]!.texto).toBe('$9,800.00');
    expect(p.chips[1]!.cifra).toBe('cxc:total');
    expect(p.chips[2]!.cifra).toBe('historial:valor:Angelo');
    expect(p.chips[2]!.texto).toBe('$106,910.39');
    expect(p.chips[2]!.detalle).toBe('-$47,921.91 vs Javier');
    expect(p.chips[3]!.texto).toBe('15 pz');
    expect(p.chips[3]!.cifra).toBeNull();
    expect(p.chips[3]!.href).toBe('/inventario');
    expect(p.corte).toBe('11 nov 2026');
  });
});

describe('Pulso (componente)', () => {
  const explicar = () => Promise.reject(new Error('no se usa'));
  it('escribe "Sin dato" con enlace al detalle cuando no hay datos', () => {
    const html = renderToStaticMarkup(<ExplicarProvider explicar={explicar}><Pulso chips={armarPulso(vacio).chips} /></ExplicarProvider>);
    expect(html.match(/Sin dato/g)).toHaveLength(4);
    expect(html).toContain('href="/cuentas-por-cobrar"');
  });
  it('con datos muestra la cifra como boton "Explicar este número"', () => {
    const html = renderToStaticMarkup(<ExplicarProvider explicar={explicar}><Pulso chips={armarPulso({ ...vacio, cxc: cxc(980000n) }).chips} /></ExplicarProvider>);
    expect(html).toContain('$9,800.00. Explicar este número');
    expect(html).toContain('data-testid="pulso-cobrar"');
  });
});
