import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import fc from 'fast-check';
import { armarPaquete, cifraDe, type Paquete } from '@/dominio/reportes/paquete';
import { construirReporte, reporteATexto } from '@/dominio/reportes/paginas';
import { renderHtml } from '@/dominio/reportes/html';
import { construirCorreo, construirTelegram } from '@/dominio/reportes/entrega';
import { palabras } from '@/dominio/reportes/texto';
import { PARAMETROS } from '@/dominio/reportes/parametros';
import type { InsumosSemanal, PedidoInsumo } from '@/dominio/reportes/insumos';
import { PEDIDOS_SEMANA, PEDIDOS_SEMANA_ANTERIOR, insumosMensualDorado, insumosSemanalDorado } from '../../fixtures/reportes/datos';

const DIR = join(__dirname, '../../fixtures/reportes');
const ACTUALIZAR = process.env.ACTUALIZAR_DORADOS === '1';

function dorado(nombre: string, actual: string): void {
  const ruta = join(DIR, nombre);
  if (ACTUALIZAR || !existsSync(ruta)) {
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, `${actual}\n`);
  }
  expect(actual).toBe(readFileSync(ruta, 'utf8').replace(/\n$/, ''));
}

// ---------- verificador independiente: aritmetica directa sobre los pedidos, sin usar el dominio de reportes ----------
function verificador(pedidos: readonly PedidoInsumo[]) {
  let ventas = 0n;
  let costo = 0n;
  let guias = 0n;
  let mensajeros = 0n;
  let piezas = 0;
  let piezasBodega = 0;
  let cobrado = 0n;
  const porCliente: Record<string, bigint> = {};
  for (const p of pedidos) {
    guias += p.guiaCent;
    mensajeros += p.mensajeroCent;
    cobrado += p.cobradoCent;
    for (const l of p.lineas) {
      ventas += l.precioCent * BigInt(l.piezas);
      costo += l.costoCent * BigInt(l.piezas);
      piezas += l.piezas;
      if (p.origen === 'bodega') piezasBodega += l.piezas;
      porCliente[p.clienteId] = (porCliente[p.clienteId] ?? 0n) + l.precioCent * BigInt(l.piezas);
    }
  }
  const renta = BigInt(piezasBodega) * 200n;
  const contrib = ventas - costo - guias - renta - mensajeros;
  const orden = Object.values(porCliente).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  return { ventas, costo, guias, mensajeros, renta, contrib, piezas, cobrado, top2: (orden[0] ?? 0n) + (orden[1] ?? 0n), n: Object.keys(porCliente).length };
}

const valor = (p: Paquete, id: string): bigint => cifraDe(p, id)!.valor;

describe('reporte dorado semanal: cifras de la maqueta A', () => {
  const p = armarPaquete(insumosSemanalDorado());
  const v = verificador(PEDIDOS_SEMANA);
  it('las cifras de la maqueta se reproducen exactas: 463,900 / 2,310 / 415,570 / 7,098 / 360 / 450 / 40,422', () => {
    expect(v.ventas).toBe(46_390_000n);
    expect(v.piezas).toBe(2310);
    expect(v.costo).toBe(41_557_000n);
    expect(v.guias).toBe(709_800n);
    expect(v.renta).toBe(36_000n);
    expect(v.mensajeros).toBe(45_000n);
    expect(v.contrib).toBe(4_042_200n);
    // 463,900 - 415,570 = 48,330; - 7,098 - 360 - 450 = 40,422; / 2,310 pz = $17.50
    expect(46_390_000n - 41_557_000n).toBe(4_833_000n);
    expect(v.cobrado).toBe(39_820_000n);
  });
  it('el paquete coincide campo por campo con el verificador independiente', () => {
    expect(valor(p, 'ventas')).toBe(v.ventas);
    expect(valor(p, 'piezas')).toBe(BigInt(v.piezas));
    expect(valor(p, 'mercancia')).toBe(v.costo);
    expect(valor(p, 'guias')).toBe(v.guias);
    expect(valor(p, 'renta')).toBe(v.renta);
    expect(valor(p, 'mensajeros')).toBe(v.mensajeros);
    expect(valor(p, 'contrib')).toBe(v.contrib);
    expect(valor(p, 'cobrado')).toBe(v.cobrado);
    expect(valor(p, 'pedidosN')).toBe(14n);
    // $17.50 por pieza y 8.7 % de las ventas
    expect(valor(p, 'contribPz')).toBe(1750n);
    expect(valor(p, 'contribPct')).toBe(871n);
    expect(valor(p, 'cli.n')).toBe(BigInt(v.n));
    expect(valor(p, 'cli.top2Pct')).toBe((v.top2 * 10_000n + v.ventas / 2n) / v.ventas);
  });
  it('contra el promedio de 4 semanas: 9 % menos de utilidad, 2 % mas de ventas, 5 % menos de piezas', () => {
    expect(valor(p, 'refContrib')).toBe(4_440_000n);
    expect(Number(valor(p, 'varContrib'))).toBeLessThan(-890);
    expect(Number(valor(p, 'varContrib'))).toBeGreaterThan(-900);
    expect(valor(p, 'refVentas')).toBe(45_500_000n);
    expect(valor(p, 'refPiezas')).toBe(2431n);
  });
  it('cobertura del viernes 1.3 y por pagar 422,668; cartera 183,400 con 22 % de mas de 30 dias', () => {
    expect(valor(p, 'liq.porPagar')).toBe(42_266_800n);
    expect(valor(p, 'liq.cobertura')).toBe(1300n);
    expect(valor(p, 'age.total')).toBe(18_340_000n);
    expect(valor(p, 'age.vencida')).toBe(4_034_800n);
    expect(valor(p, 'age.vencidaPct')).toBe(2200n);
  });
  it('estado DEFINITIVO, todas las comprobaciones en verde y huella estable de 6 caracteres', () => {
    expect(p.estado.etiquetas).toEqual(['DEFINITIVO']);
    expect(p.comprobaciones.every((c) => c.ok)).toBe(true);
    expect(p.huella).toMatch(/^[0-9a-f]{6}$/);
    expect(armarPaquete(insumosSemanalDorado()).huella).toBe(p.huella);
  });
  it('toda cifra del paquete trae sus dos vias iguales y su clase', () => {
    for (const c of p.cifras) {
      expect(c.comprobacion.igual, c.id).toBe(true);
      expect(['Observado', 'Calculado', 'Estimado', 'Escenario', 'Declarado']).toContain(c.clase);
    }
  });
  it('el puente de la semana suma exactamente la diferencia con la semana anterior', () => {
    const prev = verificador(PEDIDOS_SEMANA_ANTERIOR);
    const suma = ['volumen', 'mezcla', 'precio', 'costo', 'guia', 'otros'].reduce((a, k) => a + valor(p, `puente.${k}`), 0n);
    expect(suma).toBe(v.contrib - prev.contrib);
    expect(valor(p, 'puente.inicio')).toBe(prev.contrib);
    expect(valor(p, 'puente.fin')).toBe(v.contrib);
    expect(valor(p, 'puente.suma')).toBe(v.contrib - prev.contrib);
  });
  it('texto dorado semanal, resumen de Telegram y correo', () => {
    dorado('dorado-semanal.txt', reporteATexto(construirReporte(p)));
    dorado('dorado-semanal-telegram.txt', construirTelegram(p));
    const c = construirCorreo(p);
    dorado('dorado-semanal-correo.txt', `Asunto: ${c.asunto}\n\n${c.cuerpo}`);
  });
  it('el resumen de Telegram cabe en 900 caracteres y empieza por estado y comprobaciones', () => {
    const t = construirTelegram(p);
    expect(t.length).toBeLessThanOrEqual(PARAMETROS.maxCaracteresTelegram);
    expect(t.split('\n')[0]).toContain('DEFINITIVO');
    expect(t.split('\n')[0]).toContain('de 14 comprobaciones');
    expect(t).toContain('$40,422');
    expect(t).toContain('2,310 pz');
    expect(t).toContain('$17.50');
    expect(t.split('\n').pop()).toContain(`huella ${p.huella}`);
  });
  it('el correo no lleva cifras sensibles (ni un solo signo de pesos) y no se dirige a Omar', () => {
    const c = construirCorreo(p);
    expect(c.cuerpo).not.toMatch(/\$/);
    expect(c.asunto).not.toMatch(/\$/);
    expect(c.asunto).toBe('RTM · Reporte semanal · 2 al 8 nov 2026 · Definitivo');
    expect(c.cuerpo).toContain(`Huella: ${p.huella}`);
    expect(`${c.asunto}${c.cuerpo}`.toLowerCase()).not.toContain('omar');
  });
  it('el correo PRELIMINAR lo dice en el asunto y en el cuerpo', () => {
    const pre = armarPaquete(insumosSemanalDorado({ comprobaciones: [...insumosSemanalDorado().comprobaciones.filter((c) => c.id !== 'C7'), { id: 'C7', nombre: 'Saldo del proveedor', via1: 1n, via2: 2n, ok: false }] }));
    const c = construirCorreo(pre);
    expect(c.asunto.startsWith('[PRELIMINAR] ')).toBe(true);
    expect(c.cuerpo).toContain('No lo uses para decidir: falla la comprobación C7.');
    expect(construirTelegram(pre).split('\n')[0]).toContain('falla: C7');
  });
});

describe('reporte dorado mensual', () => {
  const p = armarPaquete(insumosMensualDorado());
  it('la utilidad neta sale de las lineas con signo y coincide con el cierre contable', () => {
    expect(valor(p, 'res.utilidadNeta')).toBe(insumosMensualDorado().utilidadNetaCent);
    expect(cifraDe(p, 'res.utilidadNeta')!.comprobacion.igual).toBe(true);
  });
  it('un mes con el estado de resultados descuadrado no cuadra (la via 2 detecta el error)', () => {
    const m = insumosMensualDorado();
    const roto = armarPaquete({ ...m, utilidadNetaCent: m.utilidadNetaCent + 100n });
    expect(roto.estado.sale).toBe(false);
    expect(roto.estado.bloqueantes).toContain('R.CIFRAS');
  });
  it('costos del sistema: cargo, como seria, como deberia ser, bolsillo, reembolsado y pendiente', () => {
    expect(valor(p, 'sis.pendiente')).toBe(80_000n);
    expect(valor(p, 'sis.cargo') - valor(p, 'sis.reembolsado')).toBe(valor(p, 'sis.pendiente'));
  });
  it('texto dorado mensual y correo mensual', () => {
    dorado('dorado-mensual.txt', reporteATexto(construirReporte(p)));
    const c = construirCorreo(p);
    dorado('dorado-mensual-correo.txt', `Asunto: ${c.asunto}\n\n${c.cuerpo}`);
    expect(c.asunto).toBe('RTM · Reporte mensual · Octubre 2026 · Definitivo');
  });
  it('tiene 12 paginas y un anexo', () => {
    const r = construirReporte(p);
    expect(r.paginas).toHaveLength(12);
    expect(r.anexo.length).toBeGreaterThan(2);
  });
});

describe('diseno de las paginas', () => {
  const cases: [string, Paquete, number][] = [
    ['semanal', armarPaquete(insumosSemanalDorado()), 7],
    ['mensual', armarPaquete(insumosMensualDorado()), 12],
  ];
  it.each(cases)('%s: numero de paginas, titular de accion de maximo 22 palabras, Implicacion, Siguiente paso y procedencia en cada una', (_n, p, n) => {
    const r = construirReporte(p);
    expect(r.paginas).toHaveLength(n);
    for (const pg of r.paginas) {
      expect(pg.titular.length, pg.id).toBeGreaterThan(10);
      expect(palabras(pg.titular), `${pg.id}: ${pg.titular}`).toBeLessThanOrEqual(PARAMETROS.maxPalabrasTitular);
      expect(pg.implicacion.length, pg.id).toBeGreaterThan(5);
      expect(pg.siguiente.length, pg.id).toBeGreaterThan(5);
      expect(pg.procedencia, pg.id).toMatch(/^Fuente: .*corte .* Mérida.*Clase: (Observado|Calculado|Estimado)\.$/);
      for (const t of pg.tablas) expect(t.filas.length, `${pg.id}/${t.id}`).toBeLessThanOrEqual(Math.max(PARAMETROS.maxRenglonesTabla, p.comprobaciones.length));
    }
  });
  it.each(cases)('%s: el HTML es blanco y negro (sin colores ni hex), con idioma, titulo y graficas accesibles', (_n, p) => {
    const html = renderHtml(construirReporte(p), { cssFuentes: '' });
    expect(html).toContain('<html lang="es">');
    expect(html).toMatch(/<title>RTM · Reporte/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/hsl\(|hwb\(|lab\(|lch\(|oklch\(|color\(/);
    for (const m of html.matchAll(/rgb\((\d+) (\d+) (\d+)\)/g)) expect(m[1] === m[2] && m[2] === m[3], m[0]).toBe(true);
    const svgs = html.match(/<svg role="img"/g) ?? [];
    const conTitulo = html.match(/<svg role="img" aria-labelledby="[^"]+"[^>]*><title id=/g) ?? [];
    expect(svgs.length).toBeGreaterThan(3);
    expect(conTitulo.length).toBe(svgs.length);
  });
});

describe('propiedades del paquete: dinero y cifras', () => {
  const arbLinea = fc.record({ modelo: fc.constantFrom('Nexa', 'Jupiter', 'Elux', 'Icon'), piezas: fc.integer({ min: 1, max: 300 }), precio: fc.integer({ min: 8_000, max: 30_000 }), costo: fc.integer({ min: 5_000, max: 28_000 }) });
  const arbPedido = (i: number) =>
    fc.record({ origen: fc.constantFrom('bodega', 'directo') as fc.Arbitrary<'bodega' | 'directo'>, lineas: fc.array(arbLinea, { minLength: 1, maxLength: 4 }), guia: fc.integer({ min: 0, max: 90_000 }), mens: fc.integer({ min: 0, max: 20_000 }), cobrado: fc.integer({ min: 0, max: 5_000_000 }), cli: fc.integer({ min: 1, max: 6 }) }).map(
      (x): PedidoInsumo => ({ folio: `P-${i}`, fecha: '2026-11-03', clienteId: `c${x.cli}`, cliente: `Cliente ${x.cli}`, origen: x.origen, cobradoCent: BigInt(x.cobrado), guiaCent: BigInt(x.guia), mensajeroCent: BigInt(x.mens), lineas: x.lineas.map((l) => ({ modelo: l.modelo, piezas: l.piezas, precioCent: BigInt(l.precio), costoCent: BigInt(l.costo) })) }),
    );
  const arbPedidos = fc.integer({ min: 1, max: 8 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => arbPedido(i))));
  const base = (ped: PedidoInsumo[], prev: PedidoInsumo[]): InsumosSemanal => insumosSemanalDorado({ pedidos: ped, pedidosSemanaAnterior: prev });
  it('para cualquier semana: cada cifra por dos vias coincide, el puente suma exacto y el reporte sale', () => {
    fc.assert(
      fc.property(arbPedidos, arbPedidos, (ped, prev) => {
        const p = armarPaquete(base(ped, prev));
        const v = verificador(ped);
        expect(valor(p, 'ventas')).toBe(v.ventas);
        expect(valor(p, 'contrib')).toBe(v.contrib);
        expect(valor(p, 'piezas')).toBe(BigInt(v.piezas));
        expect(p.cifras.every((c) => c.comprobacion.igual)).toBe(true);
        const vp = verificador(prev);
        expect(valor(p, 'puente.suma')).toBe(v.contrib - vp.contrib);
        expect(['volumen', 'mezcla', 'precio', 'costo', 'guia', 'otros'].reduce((a, k) => a + valor(p, `puente.${k}`), 0n)).toBe(v.contrib - vp.contrib);
        expect(p.comprobaciones.filter((c) => c.id.startsWith('R.')).every((c) => c.ok)).toBe(true);
      }),
      { numRuns: 120 },
    );
  });
  it('mismos insumos, misma huella; un centavo de diferencia, otra huella', () => {
    const a = armarPaquete(insumosSemanalDorado());
    const b = armarPaquete(insumosSemanalDorado());
    expect(a.huella).toBe(b.huella);
    const otro = armarPaquete(insumosSemanalDorado({ pedidos: PEDIDOS_SEMANA.map((x, i) => (i === 0 ? { ...x, mensajeroCent: x.mensajeroCent + 1n } : x)) }));
    expect(otro.huella).not.toBe(a.huella);
  });
});
