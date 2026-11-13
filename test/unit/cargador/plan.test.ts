import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { leerFuentes, normalizarFuentes } from '../../../scripts/cargador/fuentes.mjs';
import { construirPlan, costosCatalogo, valoresRenglones } from '../../../scripts/cargador/plan.mjs';
import { sumaRenglones } from '../../../scripts/cargador/lib.mjs';

const DIR = join(process.cwd(), 'test/fixtures/cargador');
const alias = JSON.parse(readFileSync(join(DIR, 'alias-modelos.json'), 'utf8'));
const dom = (): any => leerFuentes(DIR);

describe('cargador: fuentes sinteticas', () => {
  it('normaliza pedidos, compras, capital, cobros y bajas', () => {
    const d = dom();
    expect(d.pedidos.map((p: any) => p.numero)).toEqual(expect.arrayContaining(['s1', 's3', 's7', 's9', 'I1', 'I2', 'I4']));
    expect(d.compras.map((c: any) => [c.numero, c.estado])).toEqual([['s6', 'recibida'], ['I3', 'por_recibir']]);
    expect(d.capital).toHaveLength(1);
    expect(d.capital[0]).toMatchObject({ socio: 'Javier', proveedor: 'Isaac', montoCent: 1000050, fecha: null });
    expect(d.bajas).toHaveLength(2);
    expect(d.advertencias).toEqual([]);
  });

  it('une renglones del mismo modelo y sabor y aplica los alias de modelo', () => {
    const p = dom().pedidos.find((x: any) => x.numero === 's1')!;
    expect(p.lineas.map((l: { modelo: string }) => l.modelo)).toEqual(['Sint A 10K', 'Sint A 10K', 'Sint B 20K']);
    expect(p.lineas.reduce((s: number, l: { piezas: number }) => s + l.piezas, 0)).toBe(40);
  });

  it('el pedido toma la fecha de su primer abono si es anterior y el credito cubre el saldo con su fecha de pago', () => {
    const d = dom();
    const s3 = d.pedidos.find((p: any) => p.numero === 's3')!;
    expect(s3.fecha).toBe('2026-11-05');
    expect(s3.envioCent).toBe(30000);
    expect(s3.saldoCent).toBe(420000 - 100000);
    expect(s3.credito).toEqual({ fechaPago: '2026-11-16' });
    const s1 = d.pedidos.find((p: any) => p.numero === 's1')!;
    expect(s1.credito).toBeNull();
    expect(s1.cobros).toHaveLength(1);
  });

  it('la venta de inventario a credito lleva interes y su abono a cuenta del socio; el pedido a costo no tiene credito', () => {
    const d = dom();
    const s7 = d.pedidos.find((p: any) => p.numero === 's7')!;
    expect(s7).toMatchObject({ origen: 'inventario', interesCent: 40000, ventaCent: 440000 });
    expect(s7.cobros[0]).toMatchObject({ via: 'socio', socio: 'Angelo', montoCent: 100000 });
    expect(s7.credito).toEqual({ fechaPago: '2026-11-20' });
    const a = d.pedidos.find((p: any) => p.numero === 's9')!;
    expect(a).toMatchObject({ tipo: 'socio_a_costo', socio: 'Angelo', credito: null, saldoCent: 0 });
  });

  it('un pedido de Isaac sin pago con fecha pendiente toma la fecha por omision', () => {
    const i4 = dom().pedidos.find((p: any) => p.numero === 'I4')!;
    expect(i4).toMatchObject({ interesCent: 50000, ventaCent: 550000 });
    expect(i4.credito).toEqual({ fechaPago: '2026-11-20' });
  });
});

describe('cargador: plan', () => {
  const plan = () => construirPlan(dom(), alias, {});
  it('ordena por lotes y cubre cada documento una sola vez', () => {
    const p = plan();
    const lotes = p.pasos.map((x: { lote: number }) => x.lote);
    expect([...lotes].sort((a, b) => a - b)).toEqual(lotes);
    const pedidos = p.pasos.filter((x: { tipo: string }) => x.tipo.startsWith('pedido.'));
    expect(pedidos).toHaveLength(dom().pedidos.length);
    const ids = pedidos.map((x: { id: string }) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('el costo de catalogo de Isaac es el mas repetido y el de Karen un supuesto por pieza que respeta al pedido a costo', () => {
    const c = costosCatalogo(dom(), alias);
    const porClave = new Map(c.map((x: { proveedor: string; modelo: string; cent: number; supuesto: boolean }) => [`${x.proveedor}|${x.modelo}`, x]));
    expect(porClave.get('Isaac|Sint C 30K')).toMatchObject({ cent: 5000, supuesto: false });
    expect(porClave.get('Karen|Sint A 10K')).toMatchObject({ cent: 10000, supuesto: true });
  });
  it('reparte venta y costo por renglon con totales exactos, partiendo un renglon si el total no se puede repartir de otra forma', () => {
    const d = dom();
    const cat = new Map(costosCatalogo(d, alias).map((x: { proveedor: string; modelo: string }) => [`${x.proveedor}|${x.modelo}`, x]));
    const s3 = d.pedidos.find((p: any) => p.numero === 's3')!;
    const v = valoresRenglones(s3, cat);
    const q = v.renglones.map((r: { piezas: number }) => r.piezas);
    expect(sumaRenglones(q, v.renglones.map((r: { precio: number }) => r.precio))).toBe(s3.ventaCent - s3.envioCent);
    expect(sumaRenglones(q, v.renglones.map((r: { costo: number }) => r.costo))).toBe(s3.costoCent);
    expect(q.reduce((a: number, b: number) => a + b, 0)).toBe(30);
    // 333,333 centavos entre 15 + 15 piezas no es multiplo de 15: el renglon mas grande se parte en dos del mismo SKU.
    expect(v.renglones.length).toBeGreaterThan(s3.lineas.length);
  });
  it('lleva la clave de idempotencia en cada paso con efecto y nunca expone el nombre de un cliente', () => {
    const texto = plan().pasos.map((p: { desc: string }) => p.desc).join('\n');
    expect(texto).not.toMatch(/Sintetico/);
    expect(texto).toContain('cl***');
  });
});

describe('cargador: solo funciones del sistema, nada directo a las tablas', () => {
  const dir = join(process.cwd(), 'scripts/cargador');
  const codigo = readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
  it('ningun script del cargador escribe con INSERT, UPDATE o DELETE', () => {
    for (const [f, txt] of codigo) {
      const sql = (txt.match(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g) ?? []).filter((s) => /\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/i.test(s));
      for (const s of sql) expect(s, f).not.toMatch(/\b(insert\s+into|update\s+[\w.]+\s+set|delete\s+from|truncate)\b/i);
    }
  });
  it('el cuadre corre en una transaccion de solo lectura', () => {
    expect(codigo.find(([f]) => f === 'cuadre.mjs')![1]).toContain("begin read only");
  });
});

describe('cargador: clientes unificados y casi duplicados', () => {
  const asientos = JSON.parse(readFileSync(join(DIR, 'asientos.json'), 'utf8'));
  const isaac = JSON.parse(readFileSync(join(DIR, 'pedidos-isaac.json'), 'utf8'));
  it('avisa de clientes con nombre casi igual sin imprimir nombres', () => {
    const a = JSON.parse(JSON.stringify(asientos));
    a.asientos[2].clave_identidad = 'Karen|F101|cliente-sintetico-dos|2026-11-12|3';
    a.asientos[0].clave_identidad = 'Karen|F100|sintetico-dos|2026-10-15|1';
    const d = normalizarFuentes({ asientos: a, isaac, alias });
    const aviso = d.advertencias.find((w: string) => w.includes('casi igual'));
    expect(aviso).toBeTruthy();
    expect(aviso).not.toMatch(/sintetico/);
  });
  it('el alias de clientes une dos escrituras del mismo cliente sin cambiar la clave de identidad', () => {
    const a = JSON.parse(JSON.stringify(asientos));
    a.asientos[0].clave_identidad = 'Karen|F100|cliente-x|2026-10-15|1';
    a.asientos[1].clave_identidad = 'Karen|F100|x|2026-10-16|2';
    const d: any = normalizarFuentes({ asientos: a, isaac, alias: { ...alias, clientes: { 'cliente-x': 'x' }, nombres: { x: 'XX' } } });
    expect(d.clientes.get('x')).toMatchObject({ nombre: 'XX' });
    expect(d.clientes.has('cliente-x')).toBe(false);
    const p = d.pedidos.find((q: { numero: string }) => q.numero === 's1')!;
    expect(p.id).toBe('Karen|F100|cliente-x|2026-10-15|1');
    expect(p.cliente).toBe('x');
    expect(p.cobros).toHaveLength(1);
  });
});
