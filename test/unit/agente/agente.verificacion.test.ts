// Verificacion independiente sobre e942121: la tarjeta lee la clasificacion REAL de la base, capital propio, capital por renglon del lote,
// telefonos con parentesis, montos ambiguos en toda intencion y resolver_toma con el socio verificado.
import { describe, expect, it } from 'vitest';
import { escenario, pago, unaAccion } from './ayudas';
import { capitalAjeno } from '@/aplicacion/agente/agente';
import { esMontoAmbiguo } from '@/dominio/agente/cifras';
import { redactarContactos } from '@/dominio/agente/entrada';
import type { Intencion } from '@/dominio/agente/intenciones';
import { NegocioAgenteDb } from '@/infra/agente/postgres';
import type { Miembro } from '@/dominio/agente/tipos';
import type { AccionResuelta, ContextoEjecucion } from '@/aplicacion/agente/puertos';
import type { Sql } from '@/infra/postgres/servidor';

const ESTRICTO = { config: { confirmarMovimientos: true } };
const javier: Miembro = { telegramUserId: 6_000_002, persona: 'javier', rol: 'socio' };
const angelo: Miembro = { telegramUserId: 6_000_001, persona: 'angelo', rol: 'socio' };
const lote = (renglones: Array<{ tipo: 'aportacion'; socio: 'angelo' | 'javier'; intencion: 'capital' | 'reembolso' | null; fecha: string }>): Intencion => ({
  tipo: 'lote_historico', etiqueta: 'octubre', total_dictado_centavos: null, fuente_cita: 'lote',
  renglones: renglones.map((r) => ({ tipo: r.tipo, fecha: r.fecha, monto_centavos: 50_000, socio: r.socio, cliente_texto: null, cuenta_texto: null, concepto: 'x', intencion: r.intencion, via: null })),
});
const pp = (por: 'angelo' | 'javier', intencion: 'capital' | 'reembolso' | null): Intencion => ({ tipo: 'pago_proveedor', proveedor_texto: 'Karen', monto_centavos: 1_000_000, pagado_por: por, cliente_texto: null, intencion, fuente_cita: 'c' });
const aport = (socio: 'angelo' | 'javier', intencion: 'capital' | 'reembolso' | null): Intencion => ({ tipo: 'aportacion', socio, monto_centavos: 100_000, motivo: null, intencion, fuente_cita: 'c' });

describe('MEDIO-D: telefonos', () => {
  it.each(['cel (999) 123-4567', 'cel 999 - 123 - 4567', 'tel (999)1234567', '9991234567', '999.123.4567', '+52 999 123 4567', 'llama al 999-123-4567 hoy'])('%s se oculta', (t) => {
    expect(redactarContactos(t)).toContain('[telefono oculto]');
    expect(redactarContactos(t)).not.toMatch(/\d{3}[\s-]*\d{4}/);
  });
  it.each(['pague 1,250.50 a Isaac', '1,250.50 y 2,000.00 de 3,500.25', 'cobre 1250.50 2000.00 pesos', 'folio P-0001 por 12345', '28 piezas a 250.00', 'total 12,345,678.90'])('%s conserva los montos', (t) => {
    expect(redactarContactos(t)).toBe(t);
  });
  it('un correo tambien', () => expect(redactarContactos('prueba@example.test')).toBe('[correo oculto]'));
});

describe('privacidad: domicilios y usuarios de Telegram', () => {
  it('oculta calle y numero conservando el resto de la frase', () => {
    expect(redactarContactos('su tel 9991234567 entregar en Calle 5 numero 123')).toBe('su tel [telefono oculto] entregar en [domicilio oculto]');
    expect(redactarContactos('enviar a Calle 21 #305 por 30 y 32, pago 1,500.00')).toBe('enviar a [domicilio oculto], pago 1,500.00');
    expect(redactarContactos('Av. Itzaes 120 colonia Centro 28 piezas')).toBe('[domicilio oculto] 120 [domicilio oculto] 28 piezas');
    expect(redactarContactos('C.P. 97000 Merida')).toBe('[domicilio oculto] Merida');
  });
  it('oculta @usuarios pero no correos ya cubiertos ni montos', () => {
    expect(redactarContactos('mandaselo a @pedro_mx hoy')).toBe('mandaselo a [usuario oculto] hoy');
    expect(redactarContactos('prueba@example.test')).toBe('[correo oculto]');
    expect(redactarContactos('cobre 2,000.00 de Pedro por 28 piezas')).toBe('cobre 2,000.00 de Pedro por 28 piezas');
  });
});

describe('BAJO-1: montos ambiguos en TODAS las intenciones', () => {
  it('esMontoAmbiguo', () => {
    expect(esMontoAmbiguo('pago 1.250 en efectivo', 125_000n)).toBe(true);
    expect(esMontoAmbiguo('pago 1.250 en efectivo', 125n)).toBe(true);
    expect(esMontoAmbiguo('pago 1,250.50', 125_050n)).toBe(false);
    expect(esMontoAmbiguo('pago 1250', 125_000n)).toBe(false);
    expect(esMontoAmbiguo('pago 1.250 o sea mil doscientos cincuenta', 125_000n)).toBe(false);
  });
  it.each([
    ['pago', pago('Cliente Norte', 125_000), 'Cliente Norte pago 1.250 en efectivo'],
    ['gasto', { tipo: 'gasto', gasto: 'guia', monto_centavos: 125_000, pagado_por: 'javier', descripcion: null, fuente_cita: 'c' } as Intencion, 'pague 1.250 de guia'],
    ['aportacion', { ...aport('javier', null), monto_centavos: 100_000 } as Intencion, 'puse 1.000 para gastos'],
    ['pago_proveedor', pp('javier', null), 'pague 10.000 a Karen'],
  ])('%s con 1.250 pide aclarar y no registra', async (_n, intencion, texto) => {
    const e = escenario([unaAccion(intencion)], ESTRICTO);
    await e.socio('javier', texto);
    expect(e.ultimoGrupo().texto).toContain('sin ambiguedad');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().botones ?? []).toHaveLength(0);
  });
  it('el mismo monto en formato claro (1,250.50) pasa al resumen', async () => {
    const e = escenario([unaAccion({ ...pago('Cliente Norte', 125_050), cuenta_destino_texto: 'efectivo' } as Intencion)], ESTRICTO);
    await e.socio('javier', 'Cliente Norte pago 1,250.50 en efectivo');
    expect(e.ultimoGrupo().texto).toContain('Resumen para confirmar');
  });
});

describe('BAJO-4: el capital lo declara cada socio por si mismo', () => {
  it('capitalAjeno', () => {
    expect(capitalAjeno(aport('angelo', 'capital'), 'javier')).toBe(true);
    expect(capitalAjeno(aport('javier', 'capital'), 'javier')).toBe(false);
    expect(capitalAjeno(aport('angelo', null), 'javier')).toBe(false);
    expect(capitalAjeno(pp('angelo', 'capital'), 'javier')).toBe(true);
    expect(capitalAjeno(pp('javier', 'capital'), 'javier')).toBe(false);
    expect(capitalAjeno(lote([{ tipo: 'aportacion', socio: 'angelo', intencion: 'capital', fecha: '2026-10-03' }]), 'javier')).toBe(true);
  });
  it('Javier no registra capital de Angelo: ni por IA ni por comando', async () => {
    const e = escenario([unaAccion(aport('angelo', 'capital'))], ESTRICTO);
    await e.socio('javier', 'Angelo meti 1,000 de capital para invertir');
    expect(e.ultimoGrupo().texto).toContain('El capital lo declara cada socio por si mismo');
    expect(e.ultimoGrupo().botones ?? []).toHaveLength(0);
    await e.socio('javier', '/aporte angelo 1000 capital');
    expect(e.ultimoGrupo().texto).toContain('El capital lo declara cada socio por si mismo');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });
  it('el deposito del otro sin declarar capital si se registra (reembolso)', async () => {
    const e = escenario([unaAccion(aport('angelo', null))], ESTRICTO);
    await e.socio('javier', 'Angelo puso 1,000 para gastos');
    expect(e.ultimoGrupo().texto).toContain('Resumen para confirmar');
  });
});

describe('MEDIO-C: capital por renglon del lote', () => {
  const f1 = '2026-10-03';
  const f2 = '2026-10-04';
  it('un renglon de capital que el socio no dijo se baja a reembolso y la tarjeta lo muestra por renglon', async () => {
    const e = escenario([unaAccion(lote([{ tipo: 'aportacion', socio: 'javier', intencion: 'capital', fecha: f1 }, { tipo: 'aportacion', socio: 'javier', intencion: 'capital', fecha: f2 }]))], ESTRICTO);
    await e.socio('javier', `lote historico octubre\n${f1} puse 500 para gastos\n${f2} meti 500 de capital para invertir`);
    const t = e.ultimoGrupo().texto;
    const l1 = t.split('\n').find((x) => x.includes(f1))!;
    const l2 = t.split('\n').find((x) => x.includes(f2))!;
    expect(l1).toContain('[sin declarar capital: reembolso]');
    expect(l2).toContain('[declaro capital]');
  });
  it('sin declaracion en todo el mensaje, ningun renglon queda como capital', async () => {
    const e = escenario([unaAccion(lote([{ tipo: 'aportacion', socio: 'javier', intencion: 'capital', fecha: f1 }]))], ESTRICTO);
    await e.socio('javier', `lote historico ${f1} javier puso 500 para gastos`);
    expect(e.ultimoGrupo().texto).toContain('[sin declarar capital: reembolso]');
    expect(e.ultimoGrupo().texto).not.toContain('[declaro capital]');
  });
});

describe('ALTO-A / MEDIO-B: la tarjeta lee la clasificacion real que devuelve la base', () => {
  const ctx = (autor: Miembro): ContextoEjecucion => ({ autor, claveIdem: 'tg:1:0', origen: { updateId: 1, chatId: 1, messageId: 1 }, ahora: new Date('2026-11-13T12:00:00Z'), confirmado: false });
  const res = (i: Intencion): AccionResuelta => ({ intencion: i, resoluciones: { clienteId: null, proveedorId: 'karen', lineas: [], modeloId: null } });
  const sqlCon = (j: unknown): Sql => (async () => [{ j }]) as unknown as Sql;
  const sim = (clasificaciones: unknown[], extra: Record<string, unknown> = {}) => ({ resultado: { monto_cent: 1_000_000 }, efecto: {}, efecto_hash: 'h', cuadra: true, comprobaciones_rojas: [], clasificaciones, ...extra });
  const capital = [{ clasificacion: 'capital', monto_cent: 1_000_000, socio: 'Javier' }];
  const reemb = [{ clasificacion: 'reembolsable', monto_cent: 1_000_000, socio: 'Javier' }];

  it('si la base registraria CAPITAL sin que el socio lo declarara, la vista previa lo rechaza (regla de main antes de integrar cuadrar-cuentas)', async () => {
    const r = await new NegocioAgenteDb(sqlCon(sim(capital))).simular!(res(pp('javier', null)), ctx(javier));
    expect(r).toMatchObject({ tipo: 'rechazado', codigo: 'capital_sin_declarar' });
  });
  it('si la base dice reembolso, la vista previa trae la clasificacion real y el hash', async () => {
    const r = await new NegocioAgenteDb(sqlCon(sim(reemb))).simular!(res(pp('javier', null)), ctx(javier));
    expect(r).toMatchObject({ tipo: 'simulado', efectoHash: 'h', clasificaciones: [{ clasificacion: 'reembolsable', montoCent: 1_000_000, socio: 'Javier' }] });
  });
  it('capital declarado y la base lo registra como capital: pasa', async () => {
    const r = await new NegocioAgenteDb(sqlCon(sim(capital))).simular!(res(pp('javier', 'capital')), ctx(javier));
    expect(r.tipo).toBe('simulado');
  });
  it('el resultado dice lo que la base registro (no una plantilla)', async () => {
    const r = await new NegocioAgenteDb(sqlCon({ folio: 'E-0001', monto_cent: 1_000_000, clasificaciones: capital })).ejecutar(res(pp('javier', null)), ctx(javier));
    expect(r).toMatchObject({ tipo: 'ejecutado' });
    if (r.tipo === 'ejecutado') expect(r.lineas.some((l) => l.etiqueta.includes('Registrado como capital') && l.tipo === 'pesos')).toBe(true);
  });
  it('la tarjeta imprime la clasificacion de la base, con ambas posibilidades', async () => {
    for (const [cl, texto] of [[capital, 'CAPITAL'], [reemb, 'reembolso (cuenta por pagar al socio)']] as const) {
      const negocio = { simular: async () => ({ tipo: 'simulado', lineas: [], advertencias: [], cuadra: true, rojas: [], efectoHash: 'h', clasificaciones: cl.map((c) => ({ clasificacion: c.clasificacion, montoCent: c.monto_cent, socio: c.socio })) }) };
      const e = escenario([unaAccion(pp('javier', null))], ESTRICTO);
      (e.negocio as unknown as { simular: unknown }).simular = negocio.simular;
      await e.socio('javier', 'pague 10,000 a Karen');
      expect(e.ultimoGrupo().texto).toContain(`El sistema lo registrara como ${texto}`);
    }
  });
});

describe('MEDIO-E: resolver_toma con el socio verificado', () => {
  it('manda a la base la persona y el id de Telegram de quien pulso', async () => {
    const llamadas: { texto: string; params: readonly unknown[] }[] = [];
    const sql = (async (texto: string, params: readonly unknown[] = []) => { llamadas.push({ texto, params }); return [{ j: { estado: 'autorizada' } }]; }) as unknown as Sql;
    await new NegocioAgenteDb(sql).autorizarToma({ folio: 'T-0001', socio: angelo, autorizar: true, claveIdem: 'tg:cb:1' });
    expect(llamadas[0]!.texto).toContain('agente.resolver_toma($1::text, $2::text, $3::text, $4::text, $5::bigint)');
    expect(llamadas[0]!.params).toEqual(['tg:cb:1', 'T-0001', 'autorizar', 'angelo', 6_000_001]);
  });
  it('deshacer tambien manda al solicitante verificado', async () => {
    const llamadas: { params: readonly unknown[] }[] = [];
    const sql = (async (_t: string, params: readonly unknown[] = []) => { llamadas.push({ params }); return [{ j: {} }]; }) as unknown as Sql;
    await new NegocioAgenteDb(sql).deshacer({ folio: 'E-0001', autor: javier, claveIdem: 'k' });
    expect(llamadas[0]!.params).toEqual(['k', 'E-0001', 'javier', 6_000_002]);
  });
});
