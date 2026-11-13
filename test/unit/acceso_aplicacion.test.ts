import { describe, it, expect } from 'vitest';
import { completarAcceso, completarConfirmacion } from '@/aplicacion/acceso/completar_acceso';
import { correoExcedeTopes, TOPE_GLOBAL, TOPE_IP, TOPE_POR_CORREO } from '@/aplicacion/acceso/limites';
import { LimitadorNoDisponible, type Autenticador, type DepsAcceso, type EstadoSesion, type LimitadorIntentos, type TipoClave } from '@/aplicacion/acceso/puertos';
import { reenviarEnlaceCaducado } from '@/aplicacion/acceso/reenvio';
import { claveDeLimite } from '@/infra/limite/limitador_postgres';
import { ipDeCabeceras } from '@/infra/web/ip';

// Puertos falsos: la aplicacion se prueba sin red ni base.
function limitadorEnMemoria(): LimitadorIntentos & { cuentas: Map<string, number> } {
  const cuentas = new Map<string, number>();
  return {
    cuentas,
    async excede(tipo: TipoClave, valor, tope) {
      const k = `${tipo}:${valor}`;
      const n = (cuentas.get(k) ?? 0) + 1;
      cuentas.set(k, n);
      return n > tope.limite;
    },
  };
}

function armar(over: { estado?: EstadoSesion; canje?: { code?: string; message?: string } | null; correo?: string | null; espera?: boolean } = {}) {
  const enviados: { correo: string; redirectTo: string }[] = [];
  const eventos: string[] = [];
  let cerrada = false;
  let espera = over.espera ?? false;
  const autenticador: Autenticador = {
    async enviarEnlace(correo, redirectTo) {
      enviados.push({ correo, redirectTo });
      return { error: null };
    },
    async canjearCodigo() {
      return { error: over.canje ?? null };
    },
    async canjearTokenHash() {
      return { error: over.canje ?? null };
    },
    async sesion() {
      return over.estado ?? { autenticado: false };
    },
    async cerrarSesion() {
      cerrada = true;
    },
  };
  const deps: DepsAcceso = {
    autenticador,
    limitador: limitadorEnMemoria(),
    reenvio: {
      async guardarCorreo() {},
      async correoRecordado() {
        return over.correo === undefined ? 'alguien@example.test' : over.correo;
      },
      async hayEspera() {
        return espera;
      },
      async marcarEspera() {
        espera = true;
      },
    },
    rastro: { fallo: (p, m) => eventos.push(`${p}:${m}`), aviso: (e) => eventos.push(e) },
    urlApp: 'http://app.example.test',
  };
  return { deps, enviados, eventos, cerrada: () => cerrada };
}

const activo: EstadoSesion = { autenticado: true, perfil: { rol: 'socio', socio_nombre: 'Angelo', activo: true } };

describe('topes del enlace magico', () => {
  it('los topes son los de la especificacion: IP 10/5 min, correo 3/10 min, global 60/10 min', () => {
    expect(TOPE_IP).toEqual({ limite: 10, ventanaSeg: 300 });
    expect(TOPE_POR_CORREO).toEqual({ limite: 3, ventanaSeg: 600 });
    expect(TOPE_GLOBAL).toEqual({ limite: 60, ventanaSeg: 600 });
  });
  it('el cuarto intento al mismo correo (sin importar mayusculas) excede', async () => {
    const l = limitadorEnMemoria();
    const r = [] as boolean[];
    for (const c of ['A@example.test', 'a@example.test', ' a@EXAMPLE.test', 'a@example.test']) r.push(await correoExcedeTopes(l, c));
    expect(r).toEqual([false, false, false, true]);
  });
});

describe('completar el acceso (callback)', () => {
  it('cuenta activa con rol socio entra al destino pedido', async () => {
    const { deps } = armar({ estado: activo });
    expect(await completarAcceso(deps, { code: 'c', next: '/pedidos', errorCode: null, ip: '1.1.1.1' })).toEqual({ destino: '/pedidos' });
  });
  it('un next externo cae a la raiz', async () => {
    const { deps } = armar({ estado: activo });
    expect((await completarAcceso(deps, { code: 'c', next: 'https://externo.example.test', errorCode: null, ip: '1.1.1.1' })).destino).toBe('/');
  });
  it('cuenta inactiva u omar: cierra la sesion y avisa', async () => {
    const omar: EstadoSesion = { autenticado: true, perfil: { rol: 'omar', socio_nombre: null, activo: false } };
    const a = armar({ estado: omar });
    expect((await completarAcceso(a.deps, { code: 'c', next: null, errorCode: null, ip: '1.1.1.1' })).destino).toBe('/login?error=desactivada');
    expect(a.cerrada()).toBe(true);
    const b = armar({ estado: { autenticado: true, perfil: null } });
    expect((await completarAcceso(b.deps, { code: 'c', next: null, errorCode: null, ip: '1.1.1.1' })).destino).toBe('/login?error=desactivada');
  });
  it('sin code y otp_expired: reenvia uno nuevo al correo recordado', async () => {
    const a = armar();
    const r = await completarAcceso(a.deps, { code: null, next: '/socios', errorCode: 'otp_expired', ip: '1.1.1.1' });
    expect(r.destino).toBe('/login?enviado=1&reenviado=1');
    expect(a.enviados).toEqual([{ correo: 'alguien@example.test', redirectTo: 'http://app.example.test/auth/callback?next=%2Fsocios' }]);
  });
  it('segundo caducado en menos de 5 min no reenvia: manda a la bandeja', async () => {
    const a = armar({ espera: true });
    const r = await completarAcceso(a.deps, { code: null, next: null, errorCode: 'otp_expired', ip: '1.1.1.1' });
    expect(r.destino).toBe('/login?error=caducado_reciente');
    expect(a.enviados).toHaveLength(0);
  });
  it('sin cookie del correo (otro navegador) no reenvia y dice el motivo', async () => {
    const a = armar({ correo: null });
    const r = await completarAcceso(a.deps, { code: null, next: null, errorCode: 'otp_expired', ip: '1.1.1.1' });
    expect(r.destino).toBe('/login?error=caducado');
  });
  it('canje fallido por code verifier ausente = otro navegador', async () => {
    const a = armar({ canje: { message: 'both auth code and code verifier should be non-empty' } });
    const r = await completarAcceso(a.deps, { code: 'c', next: null, errorCode: null, ip: '1.1.1.1' });
    expect(r.destino).toBe('/login?error=navegador');
  });
  it('error generico sin code', async () => {
    const a = armar();
    expect((await completarAcceso(a.deps, { code: null, next: null, errorCode: null, ip: '1.1.1.1' })).destino).toBe('/login?error=1');
  });
});

describe('confirmar el acceso (plan alterno token_hash)', () => {
  const ent = { tokenHash: 'abc', tipo: 'magiclink', next: '/catalogo', ip: '1.1.1.1' };
  it('cuenta activa con rol socio entra al destino', async () => {
    const { deps } = armar({ estado: activo });
    expect(await completarConfirmacion(deps, ent)).toEqual({ destino: '/catalogo' });
  });
  it('un next externo cae a la raiz', async () => {
    const { deps } = armar({ estado: activo });
    expect((await completarConfirmacion(deps, { ...ent, next: 'https://externo.example.test' })).destino).toBe('/');
  });
  it('sin token o con tipo desconocido no intenta nada', async () => {
    const { deps } = armar({ estado: activo });
    expect((await completarConfirmacion(deps, { ...ent, tokenHash: null })).destino).toBe('/login?error=enlace');
    expect((await completarConfirmacion(deps, { ...ent, tipo: 'recovery' })).destino).toBe('/login?error=enlace');
  });
  it('token caducado o usado manda al login con el motivo', async () => {
    const { deps } = armar({ canje: { code: 'otp_expired', message: 'Email link is invalid or has expired' } });
    expect((await completarConfirmacion(deps, ent)).destino).toBe('/login?error=caducado');
  });
  it('cuenta inactiva (Omar): cierra la sesion', async () => {
    const { deps, cerrada } = armar({ estado: { autenticado: true, perfil: { rol: 'omar', socio_nombre: null, activo: false } } });
    expect((await completarConfirmacion(deps, ent)).destino).toBe('/login?error=desactivada');
    expect(cerrada()).toBe(true);
  });
});

describe('reenvio con frenos', () => {
  it('respeta el tope por IP', async () => {
    const a = armar();
    for (let i = 0; i < 10; i += 1) await a.deps.limitador.excede('ip', '9.9.9.9', TOPE_IP);
    expect(await reenviarEnlaceCaducado(a.deps, '/', '9.9.9.9')).toBe('no');
    expect(a.enviados).toHaveLength(0);
  });
});

describe('limitador caido: falla CERRADO', () => {
  const caido: LimitadorIntentos = { async excede() { throw new LimitadorNoDisponible('ECONNREFUSED'); } };

  it('el tope por correo propaga el fallo (no lo toma por «no excede»)', async () => {
    await expect(correoExcedeTopes(caido, 'a@example.test')).rejects.toBeInstanceOf(LimitadorNoDisponible);
  });
  it('el reenvio no manda nada, responde «no» (igual que un correo sin cuenta) y deja un aviso sin datos personales', async () => {
    const a = armar();
    a.deps.limitador = caido;
    expect(await reenviarEnlaceCaducado(a.deps, '/', '9.9.9.9')).toBe('no');
    expect(a.enviados).toHaveLength(0);
    expect(a.eventos).toContain('login.limitador_no_disponible');
    expect(a.eventos.join(' ')).not.toMatch(/example|@/);
  });
  it('otros errores no se disfrazan: solo LimitadorNoDisponible se degrada', async () => {
    const a = armar();
    a.deps.limitador = { async excede() { throw new Error('otro'); } };
    await expect(reenviarEnlaceCaducado(a.deps, '/', '9.9.9.9')).rejects.toThrow('otro');
  });
});

describe('infra: clave de limite e IP', () => {
  it('la clave es un HMAC: ni el correo ni la IP en claro, estable y dependiente de la pimienta', () => {
    const k = claveDeLimite('pimienta-de-prueba-123456', 'correo', 'a@example.test');
    expect(k).toMatch(/^correo:[0-9a-f]{32}$/);
    expect(k).not.toContain('example');
    expect(claveDeLimite('pimienta-de-prueba-123456', 'correo', 'a@example.test')).toBe(k);
    expect(claveDeLimite('otra-pimienta-de-prueba-9', 'correo', 'a@example.test')).not.toBe(k);
    expect(k).toMatch(/^[a-z]{2,16}:[0-9A-Za-z]{8,64}$/); // mismo formato que el CHECK de la tabla
  });
  it('toma la IP que agrego el proxy de confianza (la ultima), no la que escribe el cliente', () => {
    const h = (v: string) => ({ get: (n: string) => (n === 'x-forwarded-for' ? v : null) });
    expect(ipDeCabeceras(h('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
    expect(ipDeCabeceras(h('203.0.113.9'))).toBe('203.0.113.9');
    expect(ipDeCabeceras({ get: () => null })).toBe('desconocida');
    expect(ipDeCabeceras(h('no-es-ip'))).toBe('desconocida');
  });
});
