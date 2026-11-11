import { describe, expect, it } from 'vitest';
import { anularCargo, estadoDeCostos, registrarCargo, registrarReembolso, type ComandoCargoConTc, type Dependencias } from '@/aplicacion/costos/casos_de_uso';
import type { PuertoTipoCambio } from '@/aplicacion/costos/puertos';
import { ErrorCostos } from '@/dominio/costos/errores';
import { RepositorioCostosEnMemoria, idsSecuenciales } from '@/infra/costos/repositorio_memoria';
import { crearTipoCambioBanxico, datosDeRespuesta, fechaDesdeBanxico, microDesdeTexto, type FetchBanxico } from '@/infra/costos/banxico';

const TC_FIJO: PuertoTipoCambio = { delDia: async () => ({ tcMicro: 18_500_000n, fecha: '2026-11-10', fuente: 'banxico_fix' }) };
const SIN_TC: PuertoTipoCambio = { delDia: async () => null };
const usd = (d: number, c = 0) => BigInt(d) * 1_000_000n + BigInt(c) * 10_000n;
const SHA = (c: string) => c.repeat(64);

function entorno(tipoCambio: PuertoTipoCambio = TC_FIJO) {
  const repo = new RepositorioCostosEnMemoria();
  const deps: Dependencias = { repo, tipoCambio, ids: idsSecuenciales() };
  return { repo, deps };
}

function comando(parcial: Partial<ComandoCargoConTc> & Pick<ComandoCargoConTc, 'claveIdem' | 'servicioSlug' | 'baseOrigMicro' | 'atribucion'>): ComandoCargoConTc {
  return {
    categoria: 'nube',
    mes: '2026-11',
    fechaNeg: '2026-11-10',
    fase: 'mantenimiento',
    moneda: 'USD',
    pagadoPor: 'javier',
    cobrable: true,
    etiqueta: 'atribuido',
    evidenciaTipo: 'recibo',
    evidenciaSha256: SHA('b'),
    nota: '',
    ...parcial,
  };
}

async function tresCargos(deps: Dependencias) {
  await registrarCargo(deps, comando({ claveIdem: 'v', servicioSlug: 'vercel', baseOrigMicro: usd(32), evidenciaSha256: SHA('1'), atribucion: { tipo: 'participacion', consumoRtm: 60n, consumoTotal: 1200n } }));
  await registrarCargo(deps, comando({ claveIdem: 's', servicioSlug: 'supabase', baseOrigMicro: usd(75), evidenciaSha256: SHA('2'), atribucion: { tipo: 'participacion', consumoRtm: 10n, consumoTotal: 60n } }));
  await registrarCargo(deps, comando({ claveIdem: 'o', servicioSlug: 'openrouter', categoria: 'ia', baseOrigMicro: usd(4, 20), evidenciaSha256: SHA('3'), atribucion: { tipo: 'directa' } }));
}

describe('registrarCargo', () => {
  it('crea el cargo con folio K, evento con asiento y queda confirmado con evidencia', async () => {
    const { deps, repo } = entorno();
    const r = await registrarCargo(deps, comando({ claveIdem: 's', servicioSlug: 'supabase', baseOrigMicro: usd(75), atribucion: { tipo: 'participacion', consumoRtm: 10n, consumoTotal: 60n } }));
    expect(r.duplicado).toBe(false);
    expect(r.cargo.folio).toBe('K-0001');
    expect(r.cargo.montoCent).toBe(23_600n);
    expect(r.cargo.estado).toBe('confirmado');
    expect(r.evento?.folio).toBe('E-0001');
    expect(r.evento?.lineas).toHaveLength(2);
    expect(repo.eventos()).toHaveLength(1);
  });

  it('es idempotente por clave y por evidencia (servicio, mes, sha256)', async () => {
    const { deps, repo } = entorno();
    const c = comando({ claveIdem: 'a', servicioSlug: 'dominio', categoria: 'dominio', baseOrigMicro: usd(1, 25), atribucion: { tipo: 'directa' } });
    const uno = await registrarCargo(deps, c);
    const dos = await registrarCargo(deps, c);
    const tres = await registrarCargo(deps, { ...c, claveIdem: 'b' });
    expect(dos.duplicado).toBe(true);
    expect(tres.duplicado).toBe(true);
    expect(dos.cargo.id).toBe(uno.cargo.id);
    expect(tres.cargo.id).toBe(uno.cargo.id);
    expect((await repo.listarCargos()).length).toBe(1);
  });

  it('la misma clave con otro contenido es un error tipado', async () => {
    const { deps } = entorno();
    const c = comando({ claveIdem: 'a', servicioSlug: 'dominio', categoria: 'dominio', baseOrigMicro: usd(1, 25), atribucion: { tipo: 'directa' } });
    await registrarCargo(deps, c);
    await expect(registrarCargo(deps, { ...c, baseOrigMicro: usd(2) })).rejects.toMatchObject({ codigo: 'clave_idem_reutilizada' });
  });

  it('sin tipo de cambio no se inventa uno y no se consume folio; el recibo (manual) gana sobre Banxico', async () => {
    const { deps, repo } = entorno(SIN_TC);
    const c = comando({ claveIdem: 'a', servicioSlug: 'x', baseOrigMicro: usd(1), atribucion: { tipo: 'directa' } });
    await expect(registrarCargo(deps, c)).rejects.toMatchObject({ codigo: 'sin_dato' });
    const r = await registrarCargo(deps, { ...c, tcManual: { tcMicro: 20_000_000n, fecha: '2026-11-10', fuente: 'manual' } });
    expect(r.cargo.folio).toBe('K-0001'); // el intento fallido no dejo hueco
    expect(r.cargo.tcFuente).toBe('manual');
    expect(r.cargo.montoCent).toBe(2_000n);
    expect((await repo.listarCargos()).length).toBe(1);
  });

  it('si Banxico lanza una excepcion de red se trata como dato faltante', async () => {
    const roto: PuertoTipoCambio = { delDia: async () => { throw new Error('red caida'); } };
    const { deps } = entorno(roto);
    await expect(registrarCargo(deps, comando({ claveIdem: 'a', servicioSlug: 'x', baseOrigMicro: usd(1), atribucion: { tipo: 'directa' } }))).rejects.toBeInstanceOf(ErrorCostos);
  });

  it('en MXN no consulta tipo de cambio', async () => {
    const { deps } = entorno(SIN_TC);
    const r = await registrarCargo(deps, comando({ claveIdem: 'a', servicioSlug: 'x', moneda: 'MXN', baseOrigMicro: 101_000_000n, atribucion: { tipo: 'directa' } }));
    expect(r.cargo.montoCent).toBe(10_100n);
  });

  it('un cargo no cobrable no genera lineas de asiento', async () => {
    const { deps } = entorno();
    const r = await registrarCargo(deps, comando({ claveIdem: 'a', servicioSlug: 'x', cobrable: false, baseOrigMicro: usd(1), atribucion: { tipo: 'directa' } }));
    expect(r.evento?.lineas).toEqual([]);
  });
});

describe('anularCargo', () => {
  it('inserta una reversa enlazada y deja el original intacto', async () => {
    const { deps, repo } = entorno();
    const o = await registrarCargo(deps, comando({ claveIdem: 'a', servicioSlug: 'x', baseOrigMicro: usd(10), atribucion: { tipo: 'directa' } }));
    const antes = JSON.stringify(o.cargo, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
    const r = await anularCargo(deps, { cargoId: o.cargo.id, claveIdem: 'rev', fechaNeg: '2026-11-11', nota: 'duplicado' });
    expect(r.cargo.reversaDe).toBe(o.cargo.id);
    expect(r.cargo.montoCent).toBe(-o.cargo.montoCent);
    const despues = JSON.stringify(await repo.cargoPorId(o.cargo.id), (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
    expect(despues).toBe(antes);
    const estado = await estadoDeCostos(deps, '2026-11');
    expect(estado.resumen.total.redondeadoCent).toBe(0n);
    expect(estado.saldoJavier.pendienteCent).toBe(0n);
  });

  it('no se anula dos veces, es idempotente por clave y rechaza cargos inexistentes', async () => {
    const { deps } = entorno();
    const o = await registrarCargo(deps, comando({ claveIdem: 'a', servicioSlug: 'x', baseOrigMicro: usd(10), atribucion: { tipo: 'directa' } }));
    const r1 = await anularCargo(deps, { cargoId: o.cargo.id, claveIdem: 'rev', fechaNeg: '2026-11-11', nota: '' });
    const r2 = await anularCargo(deps, { cargoId: o.cargo.id, claveIdem: 'rev', fechaNeg: '2026-11-11', nota: '' });
    expect(r2.duplicado).toBe(true);
    expect(r2.cargo.id).toBe(r1.cargo.id);
    await expect(anularCargo(deps, { cargoId: o.cargo.id, claveIdem: 'rev2', fechaNeg: '2026-11-11', nota: '' })).rejects.toMatchObject({ codigo: 'cargo_ya_anulado' });
    await expect(anularCargo(deps, { cargoId: 'nada', claveIdem: 'rev3', fechaNeg: '2026-11-11', nota: '' })).rejects.toMatchObject({ codigo: 'cargo_no_encontrado' });
    await expect(anularCargo(deps, { cargoId: 'otro', claveIdem: 'rev', fechaNeg: '2026-11-11', nota: '' })).rejects.toMatchObject({ codigo: 'clave_idem_reutilizada' });
    await expect(anularCargo(deps, { cargoId: r1.cargo.id, claveIdem: 'rev4', fechaNeg: '2026-11-11', nota: '' })).rejects.toMatchObject({ codigo: 'cargo_ya_anulado' });
  });
});

describe('reembolso: movimiento aparte, idempotente, nunca edita el cargo', () => {
  it('caso 2: tres cargos (344.00), reembolso a Javier cancela la cuenta por pagar y no toca ningun cargo', async () => {
    const { deps, repo } = entorno();
    await tresCargos(deps);
    const cargosAntes = await repo.listarCargos();
    const fotoAntes = JSON.stringify(cargosAntes, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
    const estado = await estadoDeCostos(deps, '2026-11');
    expect(estado.resumen.total.redondeadoCent).toBe(34_400n);
    expect(estado.saldoJavier.pendienteCent).toBe(34_400n);

    const r = await registrarReembolso(deps, { claveIdem: 'reemb-1', aSocio: 'javier', fondosDe: 'javier', montoCent: 34_400n, fechaNeg: '2026-11-12', medio: 'transferencia', comprobanteSha256: SHA('c') });
    expect(r.duplicado).toBe(false);
    expect(r.reembolso.folio).toBe('R-0001');
    expect(r.saldo).toEqual({ socio: 'javier', cargadoCent: 34_400n, reembolsadoCent: 34_400n, pendienteCent: 0n });
    expect(r.evento?.lineas).toHaveLength(2);

    const cargosDespues = await repo.listarCargos();
    expect(JSON.stringify(cargosDespues, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v))).toBe(fotoAntes);
    expect(cargosDespues.every((c) => Object.isFrozen(c))).toBe(true);
    expect(cargosDespues.length).toBe(3);
    expect(cargosDespues.every((c) => c.reversaDe === null && c.estado === 'confirmado')).toBe(true);
    // El resumen de gasto no cambia: el reembolso no es un gasto.
    expect((await estadoDeCostos(deps, '2026-11')).resumen.total.redondeadoCent).toBe(34_400n);
  });

  it('reenviar la misma clave no cambia nada', async () => {
    const { deps, repo } = entorno();
    await tresCargos(deps);
    const c = { claveIdem: 'reemb-1', aSocio: 'javier' as const, fondosDe: 'javier' as const, montoCent: 17_200n, fechaNeg: '2026-11-12', medio: 'efectivo', comprobanteSha256: null };
    const a = await registrarReembolso(deps, c);
    const b = await registrarReembolso(deps, c);
    expect(b.duplicado).toBe(true);
    expect(b.reembolso.id).toBe(a.reembolso.id);
    expect(b.saldo.pendienteCent).toBe(17_200n);
    expect((await repo.listarReembolsos()).length).toBe(1);
    await expect(registrarReembolso(deps, { ...c, montoCent: 100n })).rejects.toMatchObject({ codigo: 'clave_idem_reutilizada' });
  });

  it('pagos parciales y rechazo de excesos o montos no positivos', async () => {
    const { deps } = entorno();
    await tresCargos(deps);
    const base = { aSocio: 'javier' as const, fondosDe: 'angelo' as const, fechaNeg: '2026-11-12', medio: 'transferencia', comprobanteSha256: null };
    await registrarReembolso(deps, { ...base, claveIdem: 'p1', montoCent: 10_000n });
    const r = await registrarReembolso(deps, { ...base, claveIdem: 'p2', montoCent: 24_400n });
    expect(r.saldo.pendienteCent).toBe(0n);
    await expect(registrarReembolso(deps, { ...base, claveIdem: 'p3', montoCent: 1n })).rejects.toMatchObject({ codigo: 'reembolso_invalido' });
    await expect(registrarReembolso(deps, { ...base, claveIdem: 'p4', montoCent: 0n })).rejects.toMatchObject({ codigo: 'reembolso_invalido' });
  });

  it('los folios K y R no tienen huecos aunque un reembolso falle', async () => {
    const { deps } = entorno();
    await tresCargos(deps);
    const base = { aSocio: 'javier' as const, fondosDe: 'javier' as const, fechaNeg: '2026-11-12', medio: 'x', comprobanteSha256: null };
    await expect(registrarReembolso(deps, { ...base, claveIdem: 'mal', montoCent: 99_999_999n })).rejects.toBeInstanceOf(ErrorCostos);
    const ok = await registrarReembolso(deps, { ...base, claveIdem: 'bien', montoCent: 100n });
    expect(ok.reembolso.folio).toBe('R-0001');
  });
});

describe('adaptador de Banxico (respuestas grabadas, sin red)', () => {
  const grabada = (datos: Array<{ fecha: string; dato: string }>) => ({ bmx: { series: [{ idSerie: 'SF43718', titulo: 'Tipo de cambio', datos }] } });
  const fetchCon = (cuerpo: unknown, ok = true, registro: string[] = []): FetchBanxico => async (url, init) => {
    registro.push(`${url}|${init.headers['Bmx-Token']}`);
    return { ok, status: ok ? 200 : 500, json: async () => cuerpo };
  };

  it('devuelve el FIX del dia', async () => {
    const urls: string[] = [];
    const p = crearTipoCambioBanxico({ token: 'token-de-prueba', fetchFn: fetchCon(grabada([{ fecha: '09/11/2026', dato: '18.4000' }, { fecha: '10/11/2026', dato: '18.5000' }]), true, urls) });
    expect(await p.delDia('2026-11-10')).toEqual({ tcMicro: 18_500_000n, fecha: '2026-11-10', fuente: 'banxico_fix' });
    expect(urls[0]).toContain('/series/SF43718/datos/2026-10-31/2026-11-10');
    expect(urls[0]).toContain('|token-de-prueba');
  });

  it('dia inhabil: usa el ultimo publicado y muestra su fecha efectiva; ignora N/E y fechas posteriores', async () => {
    const p = crearTipoCambioBanxico({ token: 't', fetchFn: fetchCon(grabada([{ fecha: '06/11/2026', dato: '18.3000' }, { fecha: '07/11/2026', dato: 'N/E' }, { fecha: '09/11/2026', dato: '18.9000' }])) });
    expect(await p.delDia('2026-11-08')).toEqual({ tcMicro: 18_300_000n, fecha: '2026-11-06', fuente: 'banxico_fix' });
  });

  it('error HTTP o respuesta vacia: null (no se inventa)', async () => {
    expect(await crearTipoCambioBanxico({ token: 't', fetchFn: fetchCon({}, false) }).delDia('2026-11-10')).toBeNull();
    expect(await crearTipoCambioBanxico({ token: 't', fetchFn: fetchCon({ bmx: { series: [{}] } }) }).delDia('2026-11-10')).toBeNull();
    expect(datosDeRespuesta(null)).toEqual([]);
  });

  it('analiza decimales y fechas con rigor', () => {
    expect(microDesdeTexto('18.5')).toBe(18_500_000n);
    expect(microDesdeTexto('18.123456000')).toBe(18_123_456n);
    expect(() => microDesdeTexto('18.1234567')).toThrowError(ErrorCostos);
    expect(() => microDesdeTexto('abc')).toThrowError(ErrorCostos);
    expect(fechaDesdeBanxico('03/11/2026')).toBe('2026-11-03');
    expect(() => fechaDesdeBanxico('2026-11-03')).toThrowError(ErrorCostos);
  });

  it('con el adaptador conectado al caso de uso, un cargo en USD usa el FIX y queda confirmado', async () => {
    const repo = new RepositorioCostosEnMemoria();
    const tipoCambio = crearTipoCambioBanxico({ token: 't', fetchFn: fetchCon(grabada([{ fecha: '10/11/2026', dato: '18.5000' }])) });
    const r = await registrarCargo({ repo, tipoCambio, ids: idsSecuenciales() }, comando({ claveIdem: 'a', servicioSlug: 'x', baseOrigMicro: usd(75), atribucion: { tipo: 'participacion', consumoRtm: 10n, consumoTotal: 60n } }));
    expect(r.cargo.tcFuente).toBe('banxico_fix');
    expect(r.cargo.montoCent).toBe(23_600n);
    expect(r.cargo.estado).toBe('confirmado');
  });
});
