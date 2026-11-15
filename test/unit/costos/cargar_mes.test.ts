import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calcularCargoMes, declaradoDeArgs, instantaneaDeFilas, parsearArgs, planificar, totales, ceilDiv, argsRegistrar, ejecutar } from '../../../scripts/costos/cargar-mes.mjs';
import { calcularCargo } from '@/dominio/costos/registro';
import { ceilDiv as ceilDivDominio } from '@/dominio/dinero/techo';

const TC = { tcMicro: 20_000_000n, fecha: '2026-11-14', fuente: 'manual' as const };
const filas = {
  servicios: [
    ['openrouter', 'mantenimiento', false, null], ['openrouter_comision', 'mantenimiento', false, null], ['vercel', 'mantenimiento', false, '20000000'], ['supabase', 'mantenimiento', false, '25000000'],
    ['transcripcion', 'mantenimiento', false, null], ['resend', 'mantenimiento', false, null], ['dominio', 'mantenimiento', false, null], ['telegram', 'mantenimiento', false, null],
    ['github', 'mantenimiento', false, null], ['higgsfield', 'mantenimiento', true, null], ['claude_max', 'construccion', true, null],
  ].map(([slug, fase, opcional, cuota]) => ({ slug, fase, moneda: 'USD', activo: true, opcional, cobrable: true, cuota })),
  parametros: [{ clave: 'openrouter_comision_ppm', valor: 55000 }, { clave: 'openrouter_incluir_comision', valor: true }, { clave: 'fecha_inicio_mantenimiento', valor: '2026-11-01' }],
  ledger: [], tc: null, cargos: [], faltantes: [],
};
const snap = (extra: Record<string, unknown> = {}) => instantaneaDeFilas({ ...filas, ...extra });
const decl = (a: string[] = []) => declaradoDeArgs(parsearArgs(['--mes', '2026-11', ...a]));
const plan = (s = snap(), d = decl(), tc: typeof TC | null = TC): any[] => planificar({ mes: '2026-11', fecha: '2026-11-14', snap: s, declarado: d, tc });

describe('cargar-mes: aritmetica igual a la del dominio', () => {
  it('ceilDiv', () => fc.assert(fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), fc.bigInt({ min: 1n, max: 10n ** 9n }), (a, b) => ceilDiv(a, b) === ceilDivDominio(a, b))));
  it('calcularCargoMes coincide con calcularCargo (directa, tasa, participacion, mayor)', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 500_000_000n }), fc.bigInt({ min: 1n, max: 60n }), fc.bigInt({ min: 0n, max: 60n }), fc.bigInt({ min: 15_000_000n, max: 25_000_000n }), (base, total, rtm0, tc) => {
      const rtm = rtm0 > total ? total : rtm0;
      const comun = { servicioSlug: 'x', categoria: 'nube' as const, mes: '2026-11', fechaNeg: '2026-11-14', fase: 'mantenimiento' as const, baseOrigMicro: base, moneda: 'USD' as const, pagadoPor: 'javier' as const, cobrable: true, etiqueta: 'atribuido' as const, evidenciaTipo: 'captura' as const, evidenciaSha256: null, nota: '', claveIdem: 'k' };
      const t = { tcMicro: tc, fecha: '2026-11-14', fuente: 'manual' as const };
      const pares: [object, object][] = [
        [{ tipo: 'directa' }, { tipo: 'directa' }], [{ tipo: 'tasa', ppm: 55_000n }, { tipo: 'tasa', ppm: 55_000n }],
        [{ tipo: 'participacion', consumoRtm: rtm, consumoTotal: total }, { tipo: 'participacion', consumoRtm: rtm, consumoTotal: total }],
        [{ tipo: 'mayor', cuotaOrigMicro: 20_000_000n, consumoRtm: rtm, consumoTotal: total }, { tipo: 'mayor', cuotaDocumentoOrigMicro: 20_000_000n, consumoRtm: rtm, consumoTotal: total }],
      ];
      for (const [mio, dom] of pares) {
        const a = calcularCargoMes({ slug: 'x', fase: 'mantenimiento', mes: '2026-11', fecha: '2026-11-14', baseOrigMicro: base, moneda: 'USD', atribucion: mio, etiqueta: 'atribuido', evidenciaTipo: 'captura', evidenciaSha256: null, nota: '', cobrable: true }, t);
        const b = calcularCargo({ ...comun, atribucion: dom as never }, t);
        expect([a.montoCent, a.exactoMxnE6, a.exactoPuroMxnE6, a.pctAplicadoPpm, a.pctExactoPpm, a.baseOrigMicro, a.comoSeriaCent, a.comoDeberiaCent, a.estado])
          .toEqual([b.montoCent, b.exactoMxnE6, b.exactoPuroMxnE6, b.pctAplicadoPpm, b.pctExactoPpm, b.baseOrigMicro, b.comoSeriaCent, b.comoDeberiaCent, b.estado]);
      }
    }), { numRuns: 200 });
  });
});

describe('cargar-mes: plan del mes', () => {
  it('con la base vacia y sin tipo de cambio todo lo que cuesta queda como dato faltante y nada se inventa', () => {
    const a = plan(snap(), decl(), null);
    expect(a.filter((x) => x.tipo === 'cargo')).toHaveLength(0);
    expect(a.filter((x) => x.tipo === 'faltante').map((x) => x.slug).sort()).toEqual(['claude_max', 'dominio', 'openrouter', 'supabase', 'vercel']);
    expect(totales(a, snap().servicios).alMenos).toBe(true);
  });
  it('vercel y supabase cobran la cuota del documento como minimo y abren el faltante', () => {
    const a = plan();
    const v = a.find((x) => x.tipo === 'cargo' && x.slug === 'vercel')!;
    expect(v.cargo.montoCent).toBe(40_000n);
    expect(v.cargo.comoSeriaCent).toBe(40_000n);
    expect(v.cargo.comoDeberiaCent).toBeNull();
    expect(a.some((x) => x.tipo === 'faltante' && x.slug === 'supabase')).toBe(true);
  });
  it('libro con llamadas: openrouter medido (sin audio), comision 5.5 %, transcripcion aparte, evidencia con sha', () => {
    const a = plan(snap({ ledger: [{ rol: 'texto', n: 3, micro: '1000000' }, { rol: 'audio', n: 1, micro: '500000' }] }));
    const o = a.find((x) => x.slug === 'openrouter')!;
    const c = a.find((x) => x.slug === 'openrouter_comision')!;
    const t = a.find((x) => x.slug === 'transcripcion')!;
    expect(o.cargo.baseOrigMicro).toBe(1_000_000n);
    expect(o.cargo.etiqueta).toBe('medido');
    expect(o.cargo.estado).toBe('confirmado');
    expect(c.cargo.pctAplicadoPpm).toBe(55_000n);
    expect(t.cargo.baseOrigMicro).toBe(500_000n);
  });
  it('--openrouter-usd queda capturado y provisional', () => {
    const o = plan(snap(), decl(['--openrouter-usd', '1.23'])).find((x) => x.slug === 'openrouter')!;
    expect([o.cargo.etiqueta, o.cargo.estado, o.cargo.baseOrigMicro]).toEqual(['capturado', 'provisional', 1_230_000n]);
    expect(o.cargo.montoCent).toBe(2500n);
  });
  it('claude: sin precio es faltante; 0 tokens de RTM no se cobra; con precio usa el techo al punto', () => {
    const json = (rtm: number) => JSON.stringify({ mes: '2026-11', script_version: '1.0.0', metricas: Object.fromEntries(['entrada_salida_escritura_cache', 'solo_salida', 'todo_con_lectura_cache'].map((k) => [k, { tokens_rtm: rtm, tokens_cuenta: 60, pct_exacto_ppm: 0, pct_aplicado_ppm: 0 }])), rtm: { sesiones: 2 } });
    const con = (rtm: number, extra: string[] = []) => declaradoDeArgs(parsearArgs(['--mes', '2026-11', '--claude-json', 'x.json', ...extra]), () => json(rtm));
    expect(plan(snap(), con(10)).find((x) => x.slug === 'claude_max')!.tipo).toBe('faltante');
    expect(plan(snap(), con(0, ['--claude-plan-usd', '100'])).find((x) => x.slug === 'claude_max')!.tipo).toBe('faltante');
    const c = plan(snap(), con(10, ['--claude-plan-usd', '100'])).find((x) => x.slug === 'claude_max')!;
    expect(c.cargo.pctAplicadoPpm).toBe(170_000n);
    expect(c.cargo.pctExactoPpm).toBe(166_666n);
    expect(c.cargo.fase).toBe('construccion');
    expect(c.cargo.evidenciaTipo).toBe('script_local');
  });
  it('idempotente: un cargo vivo igual se omite y uno distinto es conflicto', () => {
    const base = plan().find((x) => x.slug === 'vercel')!.cargo;
    const vivo = (monto: string) => ({ id: '7', folio: 'K-0007', slug: 'vercel', base: base.baseOrigMicro.toString(), pct: base.pctAplicadoPpm.toString(), tc: base.tcMicro.toString(), monto });
    expect(plan(snap({ cargos: [vivo('40000')] })).find((x) => x.slug === 'vercel' && x.tipo === 'cargo')!.estadoPrevio).toBe('ya_registrado');
    expect(plan(snap({ cargos: [vivo('50000')] })).find((x) => x.slug === 'vercel' && x.tipo === 'cargo')!.estadoPrevio).toBe('conflicto');
  });
  it('los argumentos de registrar_cargo son los 24 de la funcion oficial', () => {
    expect(argsRegistrar('2026-11', plan().find((x) => x.slug === 'vercel')!.cargo)).toHaveLength(24);
  });
});

describe('cargar-mes: linea de comandos', () => {
  it('valida argumentos', () => {
    expect(() => parsearArgs([])).toThrow(/--mes/);
    expect(() => parsearArgs(['--mes', '2026-11', '--verificar', '--aplicar'])).toThrow();
    expect(() => parsearArgs(['--mes', '2026-11', '--aplicar', '--datos', 'x'])).toThrow();
    expect(() => declaradoDeArgs(parsearArgs(['--mes', '2026-11', '--vercel-consumo', '1:2']))).toThrow(/factura/);
  });
  it('--verificar con instantanea no escribe y no imprime secretos', async () => {
    const out: string[] = [];
    const code = await ejecutar(['--mes', '2026-11', '--verificar', '--datos', 'snap.json', '--tc', '20'], { log: (t: string) => out.push(t), error: (t: string) => out.push(t) }, { leerArchivo: () => JSON.stringify(filas), ahora: new Date('2026-11-14T18:00:00Z') });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('no se escribio nada');
    expect(out.join('\n')).toContain('al menos');
  });
});
