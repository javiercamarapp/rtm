import { describe, expect, it } from 'vitest';
import { generarDemo, sumarDias } from '../../../scripts/demo/generador.mjs';
import { armarEstadoStock } from '../../../scripts/demo/stock-proveedor.mjs';

const HOY = '2026-11-15';
const plan = generarDemo({ hoy: HOY });

describe('demo: generador determinista', () => {
  it('el mismo parametro produce el mismo plan, byte a byte', () => {
    expect(JSON.stringify(generarDemo({ hoy: HOY }))).toBe(JSON.stringify(plan));
  });
  it('otra semilla u otra fecha produce otro plan', () => {
    expect(JSON.stringify(generarDemo({ hoy: HOY, semilla: 'otra' }))).not.toBe(JSON.stringify(plan));
    expect(JSON.stringify(generarDemo({ hoy: '2026-11-20' }))).not.toBe(JSON.stringify(plan));
  });
  it('parametriza el volumen: 250 por omision y exacto en otros valores', () => {
    expect(plan.meta.movimientos).toBe(250);
    for (const n of [120, 400]) expect(generarDemo({ hoy: HOY, movimientos: n }).meta.movimientos).toBe(n);
  });
  it('rechaza parametros invalidos', () => {
    expect(() => generarDemo({ hoy: 'ayer' })).toThrow();
    expect(() => generarDemo({ hoy: HOY, movimientos: 5 })).toThrow();
  });
});

describe('demo: volumen y cobertura de la presentacion', () => {
  it('cubre 12 semanas, sin fechas futuras ni del dia de hoy', () => {
    expect(plan.meta.semanas).toBe(12);
    expect(plan.meta.inicio).toBe(sumarDias(HOY, -83));
    for (const o of plan.ops) {
      expect(o.fecha >= plan.meta.inicio).toBe(true);
      expect(o.fecha < HOY).toBe(true);
    }
  });
  it('queda en orden cronologico con numeracion consecutiva', () => {
    plan.ops.forEach((o: { n: number; fecha: string }, i: number) => {
      expect(o.n).toBe(i + 1);
      if (i > 0) expect(o.fecha >= plan.ops[i - 1].fecha).toBe(true);
    });
  });
  it('tiene volumen enterprise: decenas de clientes, 25 a 40 modelos con muchos sabores', () => {
    expect(plan.clientes.length).toBeGreaterThanOrEqual(24);
    expect(plan.catalogo.modelos.length).toBeGreaterThanOrEqual(25);
    expect(plan.catalogo.modelos.length).toBeLessThanOrEqual(40);
    for (const m of plan.catalogo.modelos) expect(m.sabores.length).toBeGreaterThanOrEqual(6);
  });
  it('incluye todos los tipos de movimiento que se presentan', () => {
    const t = plan.meta.porTipo;
    for (const k of ['aportacion', 'compra', 'recepcion', 'pago_proveedor', 'venta', 'cobro', 'ds_venta', 'ds_cobro', 'ds_cobro_menudeo', 'devolucion_cliente', 'devolucion_proveedor', 'gasto_socio', 'gasto_empresa', 'renta_pago', 'merma', 'acta', 'costos_mes']) {
      expect(t[k], k).toBeGreaterThan(0);
    }
  });
  it('usa las cuatro paqueterias con guias y los dos proveedores', () => {
    const paq = new Set(plan.ops.filter((o: { tipo: string }) => o.tipo === 'venta').map((o: { paqueteria: string }) => o.paqueteria));
    expect([...paq].sort()).toEqual(['Castores', 'DHL', 'Estafeta', 'Pitic']);
    expect(new Set(plan.ops.filter((o: { tipo: string }) => o.tipo === 'compra').map((o: { proveedor: string }) => o.proveedor))).toEqual(new Set(['Isaac', 'Karen']));
  });
  it('el ritmo semanal crece con picos y semanas flojas', () => {
    const semana: number[] = Array.from({ length: 12 }, () => 0);
    for (const o of plan.ops.filter((x: { tipo: string }) => x.tipo === 'venta') as { fecha: string }[]) semana[Math.min(11, Math.floor((Date.parse(`${o.fecha}T00:00:00Z`) - Date.parse(`${plan.meta.inicio}T00:00:00Z`)) / 86400000 / 7))]! += 1;
    const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
    expect(sum(semana.slice(8))).toBeGreaterThan(sum(semana.slice(0, 4)) * 1.5);
    expect(semana.some((v, i) => i > 0 && v < (semana[i - 1] as number))).toBe(true);
  });
  it('hay pedidos en todos los estados de partida: borrador, por enviar, enviado y entregado', () => {
    const v = plan.ops.filter((o: { tipo: string }) => o.tipo === 'venta') as { estado: string; entregado: boolean }[];
    expect(v.some((x) => x.estado === 'borrador')).toBe(true);
    expect(v.some((x) => x.estado === 'confirmado')).toBe(true);
    expect(v.some((x) => x.estado === 'enviado' && x.entregado)).toBe(true);
    expect(v.some((x) => x.estado === 'enviado' && !x.entregado)).toBe(true);
  });
});

describe('demo: coherencia del dinero (el generador nunca cobra mas de lo debido)', () => {
  it('los cobros por pedido no superan su monto neto', () => {
    const pedidos = new Map<string, { total: number; costoTotal?: number; tipo: string }>();
    for (const o of plan.ops) if (o.tipo === 'venta' || o.tipo === 'ds_venta') pedidos.set(o.ref, o);
    const pagado = new Map<string, number>();
    for (const o of plan.ops) if (['cobro', 'ds_cobro', 'ds_cobro_menudeo'].includes(o.tipo)) pagado.set(o.ref, (pagado.get(o.ref) ?? 0) + o.monto);
    for (const [ref, p] of pagado) {
      const v = pedidos.get(ref) as { total: number; costoTotal?: number; tipo: string };
      expect(p, ref).toBeLessThanOrEqual(v.costoTotal ?? v.total);
    }
  });
  it('todo importe es un entero en centavos', () => {
    for (const o of plan.ops) for (const [k, v] of Object.entries(o)) if (/monto|cent$|total/i.test(k) && typeof v === 'number') expect(Number.isInteger(v), `${o.n} ${k}`).toBe(true);
  });
  it('un cobro nunca precede al envio de su pedido', () => {
    const envio = new Map<string, string>();
    for (const o of plan.ops) if (o.tipo === 'venta' || o.tipo === 'ds_venta') envio.set(o.ref, o.fecha);
    for (const o of plan.ops) if (['cobro', 'ds_cobro', 'ds_cobro_menudeo'].includes(o.tipo)) expect(o.fecha >= (envio.get(o.ref) as string)).toBe(true);
  });
});

describe('demo: stock de proveedor', () => {
  it('arma un estado de Karen con cambios recientes y sin importes', () => {
    const modelos = plan.catalogo.modelos.map((m: { nombre: string; marca: string; puffs: number; sabores: string[] }, i: number) => ({ id: i + 1, nombre: m.nombre, marca: m.marca, puffs: m.puffs, skus: m.sabores.map((s, j) => ({ id: i * 100 + j, sabor: s })) }));
    const a = armarEstadoStock({ modelos, hoy: '2026-11-14', semilla: 's' });
    const b = armarEstadoStock({ modelos, hoy: '2026-11-14', semilla: 's' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(Object.keys(a.estado.modelos).length).toBe(modelos.length);
    expect(a.eventos.length).toBeGreaterThan(10);
    expect(JSON.stringify(a)).not.toMatch(/precio|price|monto|_cent/i);
  });
});
