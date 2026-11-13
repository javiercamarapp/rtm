import { describe, expect, it, vi } from 'vitest';
import {
  decidirRollback, extraerMarcador, extraerUrlDespliegue, hostDe, leerArgumentos, mismoDespliegue, mismoMarcador, parsearInspect, planDeDespliegue, publicarConAlias,
} from '../../scripts/despliegue/alias.mjs';

const PROD = 'https://rtm-nu.vercel.app';
const VIEJO = { id: 'dpl_viejo', host: 'rtm-91943idbf-likida.vercel.app', estado: 'READY' };
const NUEVO_URL = 'https://rtm-abc123xyz-likida.vercel.app';
const html = (...assets: string[]) => assets.map((a) => `<script src="/_next/static/${a}"></script>`).join('');
const inspectJson = (id: string, host: string) => JSON.stringify({ id, url: host, readyState: 'READY' });

describe('parseo de la salida de vercel', () => {
  it('extrae la URL unica de stdout y, si falta, de stderr', () => {
    expect(extraerUrlDespliegue(`${NUEVO_URL}\n`, 'Production: https://rtm-zzz-otra.vercel.app')).toBe(NUEVO_URL);
    expect(extraerUrlDespliegue('', `Inspect: https://vercel.com/x\nProduction: ${NUEVO_URL} [3s]`)).toBe(NUEVO_URL);
    expect(extraerUrlDespliegue('nada', 'nada')).toBeNull();
  });
  it('hostDe quita protocolo, ruta y mayusculas', () => { expect(hostDe('HTTPS://Rtm-Nu.vercel.app/login?x=1')).toBe('rtm-nu.vercel.app'); });
  it('parsea inspect en JSON (con ruido alrededor) y en texto', () => {
    expect(parsearInspect(`Fetching...\n${inspectJson('dpl_1', 'https://rtm-a1-likida.vercel.app')}\n`)).toEqual({ id: 'dpl_1', host: 'rtm-a1-likida.vercel.app', estado: 'READY' });
    const texto = `  id     dpl_9Zx\n  status READY\n  url    https://rtm-q1-likida.vercel.app\n`;
    expect(parsearInspect(texto)).toEqual({ id: 'dpl_9Zx', host: 'rtm-q1-likida.vercel.app', estado: 'READY' });
    expect(parsearInspect('Error: not found')).toBeNull();
  });
  it('mismoDespliegue compara por id y, sin id, por host', () => {
    expect(mismoDespliegue({ id: 'a', host: 'x' }, { id: 'a', host: 'y' })).toBe(true);
    expect(mismoDespliegue({ id: 'a', host: 'x' }, { id: 'b', host: 'x' })).toBe(false);
    expect(mismoDespliegue({ id: null, host: 'x' }, { id: 'b', host: 'x' })).toBe(true);
    expect(mismoDespliegue(null, { id: 'b', host: 'x' })).toBe(false);
  });
  it('marcador del build: assets ordenados; vacio nunca coincide', () => {
    const a = extraerMarcador(html('chunks/b.js', 'chunks/a.js', 'css/z.css', 'chunks/a.js'));
    expect(a).toEqual(['/_next/static/chunks/a.js', '/_next/static/chunks/b.js', '/_next/static/css/z.css']);
    expect(mismoMarcador(a, extraerMarcador(html('css/z.css', 'chunks/a.js', 'chunks/b.js')))).toBe(true);
    expect(mismoMarcador(a, extraerMarcador(html('chunks/a.js')))).toBe(false);
    expect(mismoMarcador([], [])).toBe(false);
  });
});

describe('decision de rollback', () => {
  it('no restaura si el alias sigue en el previo', () => { expect(decidirRollback({ previo: VIEJO, aliasActual: { ...VIEJO } })).toBe('ninguna'); });
  it('restaura si el alias esta en otro despliegue o no se pudo consultar', () => {
    expect(decidirRollback({ previo: VIEJO, aliasActual: { id: 'dpl_n', host: 'n.vercel.app' } })).toBe('restaurar');
    expect(decidirRollback({ previo: VIEJO, aliasActual: null })).toBe('restaurar');
  });
  it('es imposible sin previo conocido', () => { expect(decidirRollback({ previo: null, aliasActual: { id: 'x', host: 'x' } })).toBe('imposible'); });
});

describe('argumentos y plan', () => {
  it('rechaza opciones desconocidas y exige URL unica en --solo-alias', () => {
    expect(leerArgumentos(['--dry-runn']).errores).toHaveLength(1);
    expect(leerArgumentos(['--solo-alias']).errores).toHaveLength(1);
    expect(leerArgumentos(['--solo-alias', 'https://rtm-nu.vercel.app']).errores).toHaveLength(1);
    const ok = leerArgumentos(['--solo-alias', NUEVO_URL, '--dry-run']);
    expect(ok.errores).toEqual([]);
    expect(ok.valores['--solo-alias']).toBe(NUEVO_URL);
    expect(ok.banderas.has('--dry-run')).toBe(true);
  });
  it('el plan menciona alias set y la restauracion, y no ejecuta nada', () => {
    const plan = planDeDespliegue({ banderas: new Set(['--dry-run']), valores: {}, urlProd: PROD, scope: 'likida' }).join('\n');
    expect(plan).toContain('vercel alias set');
    expect(plan).toContain('restaurar');
    expect(plan).toContain('URL unica');
    const solo = planDeDespliegue({ banderas: new Set(['--dry-run', '--solo-alias']), valores: { '--solo-alias': NUEVO_URL }, urlProd: PROD, scope: 'likida' }).join('\n');
    expect(solo).toContain(`vercel alias set ${NUEVO_URL} rtm-nu.vercel.app`);
    expect(solo).not.toContain('vercel build');
  });
});

// Simulador de Vercel: el alias apunta a `estado.alias`; `alias set` lo mueve; las paginas dependen del despliegue servido.
function simulador(opts: { humoUnica?: boolean; humoAlias?: boolean; setFalla?: boolean; aliasNoPropaga?: boolean; restauracionFalla?: boolean; statusUnica?: number } = {}) {
  const estado = { alias: { ...VIEJO } as { id: string; host: string; estado?: string }, llamadas: [] as string[][] };
  const NUEVO = { id: 'dpl_nuevo', host: hostDe(NUEVO_URL) };
  const deploys: Record<string, { id: string; host: string }> = { [NUEVO.host]: NUEVO, [VIEJO.host]: VIEJO };
  const run = vi.fn((cmd: string, a: string[]) => {
    estado.llamadas.push([cmd, ...a]);
    if (a[0] === 'inspect') {
      const d = a[1] === hostDe(PROD) ? estado.alias : deploys[a[1] as string];
      return d ? { status: 0, stdout: inspectJson(d.id, d.host), stderr: '' } : { status: 1, stdout: '', stderr: 'no existe' };
    }
    if (a[0] === 'alias' && a[1] === 'set') {
      const hacia = a[2] as string;
      if (hacia === NUEVO.host && opts.setFalla) return { status: 1, stdout: '', stderr: 'boom' };
      if (hacia === VIEJO.host && opts.restauracionFalla) return { status: 1, stdout: '', stderr: 'boom' };
      if (!(hacia === NUEVO.host && opts.aliasNoPropaga)) estado.alias = deploys[hacia] as typeof estado.alias;
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'comando inesperado' };
  });
  const pedirPagina = vi.fn(async (u: string) => {
    const host = hostDe(u);
    const sirve = host === hostDe(PROD) ? estado.alias.host : host;
    if (sirve === NUEVO.host && opts.statusUnica && host === NUEVO.host) return { status: opts.statusUnica, html: '' };
    return { status: 200, html: sirve === NUEVO.host ? html('chunks/nuevo-1.js', 'css/n.css') : html('chunks/viejo-1.js', 'css/v.css') };
  });
  const humo = vi.fn(async (u: string) => (hostDe(u) === hostDe(PROD) ? opts.humoAlias ?? true : opts.humoUnica ?? true));
  const base = { nuevo: NUEVO_URL, urlProd: PROD, scope: 'likida', previo: { ...VIEJO }, run, pedirPagina, humo, dormir: async () => {}, log: () => {}, intentos: 2 };
  return { estado, run, humo, base };
}
const sets = (s: ReturnType<typeof simulador>) => s.estado.llamadas.filter((l) => l[1] === 'alias').map((l) => l.slice(3, 5).join(' '));

describe('publicarConAlias con comandos simulados', () => {
  it('camino feliz: humo en URL unica, alias movido, verificado y humo en el alias', async () => {
    const s = simulador();
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: true, etapa: 'listo', previo: VIEJO.host });
    expect(s.estado.alias.host).toBe(hostDe(NUEVO_URL));
    expect(s.humo.mock.calls.map((c) => hostDe(c[0]))).toEqual([hostDe(NUEVO_URL), 'rtm-nu.vercel.app']);
    expect(sets(s)).toEqual([`${hostDe(NUEVO_URL)} rtm-nu.vercel.app`]);
  });
  it('si el humo falla en la URL unica, no toca el alias', async () => {
    const s = simulador({ humoUnica: false });
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: false, etapa: 'humo-url-unica' });
    expect(sets(s)).toEqual([]);
    expect(s.estado.alias.host).toBe(VIEJO.host);
  });
  it('URL unica protegida (302/401): omite el humo previo, mueve el alias, verifica y hace humo en el alias', async () => {
    for (const status of [302, 401]) {
      const s = simulador({ statusUnica: status });
      const r = await publicarConAlias(s.base);
      expect(r).toMatchObject({ ok: true, etapa: 'listo' });
      expect(s.humo.mock.calls.map((c) => hostDe(c[0]))).toEqual(['rtm-nu.vercel.app']);
      expect(s.estado.alias.host).toBe(hostDe(NUEVO_URL));
    }
  });
  it('URL unica protegida y humo del alias falla: restaura el alias anterior', async () => {
    const s = simulador({ statusUnica: 302, humoAlias: false });
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: false, etapa: 'alias', restaurado: true });
    expect(s.estado.alias.host).toBe(VIEJO.host);
  });
  it('URL unica con otro estado (500): error claro y alias intacto', async () => {
    const s = simulador({ statusUnica: 500 });
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: false, etapa: 'url-unica' });
    expect(r.detalle).toContain('500');
    expect(s.humo).not.toHaveBeenCalled();
    expect(sets(s)).toEqual([]);
  });
  it('si el humo falla en el alias, restaura el alias anterior', async () => {
    const s = simulador({ humoAlias: false });
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: false, etapa: 'alias', restaurado: true });
    expect(s.estado.alias.host).toBe(VIEJO.host);
    expect(sets(s)).toEqual([`${hostDe(NUEVO_URL)} rtm-nu.vercel.app`, `${VIEJO.host} rtm-nu.vercel.app`]);
  });
  it('si el alias no sirve lo nuevo tras reintentos (marcador/inspect), falla y restaura', async () => {
    const s = simulador({ aliasNoPropaga: true });
    const r = await publicarConAlias(s.base);
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain('no sirve el despliegue nuevo');
    expect(r.detalle).toContain('no hizo falta restaurar');
    expect(r.restaurado).toBeNull();
    expect(s.humo).toHaveBeenCalledTimes(1);
  });
  it('si alias set falla y el alias sigue en el previo, no restaura', async () => {
    const s = simulador({ setFalla: true });
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: false, etapa: 'alias', restaurado: null });
    expect(sets(s)).toHaveLength(1);
  });
  it('reporta con claridad si la restauracion tambien falla', async () => {
    const s = simulador({ humoAlias: false, restauracionFalla: true });
    const r = await publicarConAlias(s.base);
    expect(r).toMatchObject({ ok: false, restaurado: false });
    expect(r.detalle).toContain(`vercel alias set ${VIEJO.host} rtm-nu.vercel.app --scope likida`);
  });
  it('sin previo conocido y fallo posterior al alias: marca restauracion imposible', async () => {
    const s = simulador({ humoAlias: false });
    const r = await publicarConAlias({ ...s.base, previo: null });
    expect(r).toMatchObject({ ok: false, restaurado: false });
    expect(r.detalle).toContain('NO hay despliegue anterior');
  });
});
