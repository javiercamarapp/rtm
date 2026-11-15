import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calcularCargoMes, declaradoDeArgs, instantaneaDeFilas, parsearArgs, planificar, ceilDiv, argsRegistrar, ejecutar, parsearCuota } from '../../../scripts/costos/cargar-mes.mjs';
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
  it('sin tipo de cambio nada se convierte ni se inventa: Claude Max queda en USD 20 pendiente y no hay datos faltantes', () => {
    const a = plan(snap(), decl(), null);
    expect(a.filter((x) => x.tipo === 'cargo')).toHaveLength(0);
    const p = a.filter((x) => x.tipo === 'pendiente_tc');
    expect(p.map((x) => x.slug)).toEqual(['claude_max']);
    expect(p[0].usdMicro).toBe(20_000_000n);
    expect(p[0].motivo).toContain('Sin tipo de cambio: falta capturarlo');
    expect(a.filter((x) => x.tipo === 'faltante')).toHaveLength(0);
  });
  it('Claude Max es fijo de USD 20 por mes (no 200)', () => {
    const c = plan().find((x) => x.slug === 'claude_max' && x.tipo === 'cargo')!.cargo;
    expect(c.baseOrigMicro).toBe(20_000_000n);
    expect(c.montoCent).toBe(40_000n);
  });
  it('vercel y supabase valen 0 sin consumo real: sin cargo y sin dato faltante', () => {
    const a = plan();
    for (const slug of ['vercel', 'supabase']) {
      expect(a.some((x) => x.slug === slug && (x.tipo === 'cargo' || x.tipo === 'faltante'))).toBe(false);
      expect(a.find((x) => x.slug === slug)!.tipo).toBe('sin_cargo');
    }
  });
  it('dominio, openrouter sin libro y el resto valen 0 sin dato faltante', () => {
    const a = plan();
    for (const slug of ['dominio', 'openrouter', 'higgsfield', 'resend', 'telegram', 'github', 'transcripcion']) expect(a.find((x) => x.slug === slug)!.tipo).toBe('sin_cargo');
    expect(a.filter((x) => x.tipo === 'faltante')).toHaveLength(0);
  });
  it('dominio con costo anual declarado devenga un doceavo', () => {
    const c = plan(snap(), decl(['--dominio-anual-usd', '12']))!.find((x) => x.slug === 'dominio' && x.tipo === 'cargo')!.cargo;
    expect(c.baseOrigMicro).toBe(1_000_000n);
  });
  it('regla menor: la cuota base es el tope del consumo real (cuota 20, consumo real 50 -> 20; consumo real 5 -> 5)', () => {
    const snapMenor = snap({ cuotas: [{ slug: 'vercel', q: { regla: 'menor', cuota_orig_micro: 20_000_000 } }] });
    const alto = plan(snapMenor, decl(['--vercel-consumo', '1:1', '--vercel-factura-usd', '50'])).find((x) => x.slug === 'vercel' && x.tipo === 'cargo')!.cargo;
    expect(alto.baseOrigMicro).toBe(20_000_000n);
    expect(alto.comoSeriaCent).toBe(40_000n);
    expect(alto.comoDeberiaCent).toBe(100_000n);
    const bajo = plan(snapMenor, decl(['--vercel-consumo', '1:10', '--vercel-factura-usd', '50'])).find((x) => x.slug === 'vercel' && x.tipo === 'cargo')!.cargo;
    expect(bajo.baseOrigMicro).toBe(50_000_000n);
    expect(bajo.pctAplicadoPpm).toBe(100_000n);
    expect(bajo.montoCent).toBe(10_000n);
  });
  it('regla mayor (cuota base como piso) con la fila vigente de la base', () => {
    const s = snap({ cuotas: [{ slug: 'supabase', q: { regla: 'mayor', cuota_orig_micro: 25_000_000 } }] });
    const c = plan(s, decl(['--supabase-horas', '1:10', '--supabase-factura-usd', '50'])).find((x) => x.slug === 'supabase' && x.tipo === 'cargo')!.cargo;
    expect(c.baseOrigMicro).toBe(25_000_000n);
    expect(c.montoCent).toBe(50_000n);
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
  it('claude max: fijo en 20 USD declarados, directa, construccion, sin tokens', () => {
    const c = plan().find((x) => x.slug === 'claude_max')!;
    expect([c.tipo, c.cargo.baseOrigMicro, c.cargo.pctAplicadoPpm, c.cargo.fase, c.cargo.etiqueta, c.cargo.evidenciaTipo]).toEqual(['cargo', 20_000_000n, 1_000_000n, 'construccion', 'capturado', 'captura']);
    expect(c.cargo.montoCent).toBe(40_000n);
    expect(c.cargo.nota).toContain('declarado por el dueno: 20.00 USD de 200 prorrateados');
    expect(plan(snap(), decl(['--claude-usd', '25'])).find((x) => x.slug === 'claude_max')!.cargo.baseOrigMicro).toBe(25_000_000n);
  });
  it('idempotente: un cargo vivo igual se omite y uno distinto es conflicto', () => {
    const base = plan().find((x) => x.slug === 'claude_max' && x.tipo === 'cargo')!.cargo;
    const vivo = (monto: string) => ({ id: '7', folio: 'K-0007', slug: 'claude_max', base: base.baseOrigMicro.toString(), pct: base.pctAplicadoPpm.toString(), tc: base.tcMicro.toString(), monto });
    expect(plan(snap({ cargos: [vivo('40000')] })).find((x) => x.slug === 'claude_max' && x.tipo === 'cargo')!.estadoPrevio).toBe('ya_registrado');
    expect(plan(snap({ cargos: [vivo('60000')] })).find((x) => x.slug === 'claude_max' && x.tipo === 'cargo')!.estadoPrevio).toBe('conflicto');
  });
  it('los argumentos de registrar_cargo son los 24 de la funcion oficial', () => {
    expect(argsRegistrar('2026-11', plan().find((x) => x.slug === 'claude_max' && x.tipo === 'cargo')!.cargo)).toHaveLength(24);
  });
});

describe('cargar-mes: linea de comandos', () => {
  it('valida argumentos', () => {
    expect(() => parsearArgs([])).toThrow(/--mes/);
    expect(() => parsearArgs(['--mes', '2026-11', '--verificar', '--aplicar'])).toThrow();
    expect(() => parsearArgs(['--mes', '2026-11', '--aplicar', '--datos', 'x'])).toThrow();
    expect(() => declaradoDeArgs(parsearArgs(['--mes', '2026-11', '--supabase-horas', '1:2']))).toThrow(/factura/);
    expect(() => declaradoDeArgs(parsearArgs(['--mes', '2026-11', '--vercel-consumo', '1:2']))).toThrow(/factura/);
    expect(parsearCuota('vercel:menor:20:2026-12-01')).toEqual({ slug: 'vercel', regla: 'menor', cuotaMicro: 20_000_000n, desde: '2026-12-01' });
    expect(() => parsearCuota('vercel:medio:20:2026-12-01')).toThrow(/--fijar-cuota/);
  });
  it('--verificar con instantanea no escribe y no imprime secretos', async () => {
    const out: string[] = [];
    const code = await ejecutar(['--mes', '2026-11', '--verificar', '--datos', 'snap.json', '--tc', '20'], { log: (t: string) => out.push(t), error: (t: string) => out.push(t) }, { leerArchivo: () => JSON.stringify(filas), ahora: new Date('2026-11-14T18:00:00Z') });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('no se escribio nada');
    expect(out.join('\n')).toContain('Aportacion de capital de Javier');
  });
  it('--tc-sugerido solo imprime la instruccion', async () => {
    const out: string[] = [];
    expect(await ejecutar(['--tc-sugerido'], { log: (t: string) => out.push(t), error: (t: string) => out.push(t) })).toBe(0);
    expect(out.join(' ')).toContain('--tc N --tc-fecha');
  });
});
