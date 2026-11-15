// Cobranza: flujo del modulo del bot (preguntas, confirmacion de cifras con k o mil, atajos, rechazos de la base) y reloj, con un puerto GUIONADO y transporte falso de Telegram.
// Las reglas de dinero y de fechas se prueban contra SQL real en pgTAP (cb_001, cb_002) y en la prueba E2E de integracion; aqui solo se prueba lo que decide TypeScript.
import { describe, expect, it } from 'vitest';
import { ModuloCobranza, RechazoCobranza, type EsperaCobranza, type PuertoCobranza, type RespCobranza } from '@/aplicacion/agente/cobranza';
import { ejecutarRelojCobranza, type PuertoRelojCobranza } from '@/aplicacion/agente/cobranza_reloj';
import type { EnviadorTelegram, MensajeSalida } from '@/aplicacion/agente/puertos';
import type { ICobranzaRespuesta } from '@/dominio/agente/intenciones_ampliadas';
import type { Miembro } from '@/dominio/agente/tipos';

const javier: Miembro = { telegramUserId: 1, persona: 'javier', rol: 'socio' };

class PuertoGuionado implements PuertoCobranza {
  llamadas: Array<{ clave: string; args: Record<string, unknown> }> = [];
  espera: EsperaCobranza | null = null;
  cerradas = 0;
  constructor(private readonly respuestas: RespCobranza[] | ((args: Record<string, unknown>) => RespCobranza)) {}
  async responder(clave: string, _a: Miembro, args: Record<string, unknown>) {
    this.llamadas.push({ clave, args });
    return typeof this.respuestas === 'function' ? this.respuestas(args) : (this.respuestas.shift() ?? {});
  }
  async deshacer(_c: string, _a: Miembro, folio: string): Promise<RespCobranza> {
    if (folio === 'COB-0099') throw new RechazoCobranza('pasaron más de 10 minutos desde el folio COB-0099', 'P0464');
    return { estado: 'ok', aviso_grupo: `Javier deshizo ${folio}.` };
  }
  async esperaVigente() { return this.espera; }
  async esperaGuardar(_c: number, _a: Miembro, e: EsperaCobranza) { this.espera = e; }
  async esperaCerrar() { this.espera = null; this.cerradas++; }
}

const CLIENTES = [{ id: '7', nombre: 'Cliente Beta', alias: [] }, { id: '8', nombre: 'Cliente Gama', alias: [] }];
const ahora = () => new Date('2026-11-17T16:00:00Z'); // martes 17-nov, 10:00 Merida
const nuevo = (p: PuertoGuionado) => new ModuloCobranza(p, async () => CLIENTES, ahora);
const e = (texto: string, n = 1) => ({ chatId: -100, autor: javier, texto, clave: `tg:${n}` });
const intencion = (x: Partial<ICobranzaRespuesta>): ICobranzaRespuesta => ({ tipo: 'cobranza_respuesta', accion: 'aun_no', cliente_texto: 'Cliente Beta', pedidos_texto: [], monto_texto: null, cuenta: null, cuando_texto: null, duracion_texto: null, motivo: null, fuente_cita: 'x', ...x });

describe('modulo de cobranza', () => {
  it('"pago 20 mil": un monto con mil se REPITE y se pregunta antes de registrar; con el si, registra', async () => {
    const p = new PuertoGuionado([{ estado: 'ok', aviso_grupo: 'Registrado COB-0001: pago de $20,000 de Cliente Beta.' }]);
    const m = nuevo(p);
    const s = await m.manejarIntencion(intencion({ accion: 'pago_parcial', monto_texto: '20 mil', cuenta: 'javier' }), e('Beta me depositó 20 mil a mi cuenta'));
    expect(s.textos).toEqual(['¿Son $20,000.00? Responde sí o no antes de registrarlo.']);
    expect(p.llamadas).toHaveLength(0);
    expect(p.espera).toMatchObject({ clienteId: '7', falta: 'confirmar_monto' });
    const r = await m.interceptar(e('sí', 2));
    expect(r?.textos).toEqual(['Registrado COB-0001: pago de $20,000 de Cliente Beta.']);
    expect(p.llamadas[0]!.args).toMatchObject({ cliente_id: 7, accion: 'pago_parcial', cuenta: 'javier', monto_cent: 2_000_000 });
    expect(p.espera).toBeNull();
  });

  it('una cifra escrita completa se registra sin preguntar; el monto sale del texto del socio, no del modelo', async () => {
    const p = new PuertoGuionado([{ estado: 'ok', aviso_grupo: 'Registrado.' }]);
    await nuevo(p).manejarIntencion(intencion({ accion: 'pago_parcial', monto_texto: '20,000', cuenta: 'isaac' }), e('Beta le pago directo a Isaac 20,000'));
    expect(p.llamadas[0]!.args).toMatchObject({ monto_cent: 2_000_000, cuenta: 'isaac' });
  });

  it('un monto que el modelo inventa (no esta en el mensaje) no se manda: el servidor pregunta cuanto fue', async () => {
    const p = new PuertoGuionado([{ estado: 'pregunta', falta: 'monto', texto: '¿Cuánto pagó Cliente Beta?' }]);
    const s = await nuevo(p).manejarIntencion(intencion({ accion: 'pago_parcial', monto_texto: '50,000', cuenta: 'javier' }), e('Beta ya me pagó algo'));
    expect(p.llamadas[0]!.args.monto_cent).toBeUndefined();
    expect(s.textos).toEqual(['¿Cuánto pagó Cliente Beta?']);
    expect(p.espera).toMatchObject({ falta: 'monto' });
  });

  it('con "no" a la cifra repetida no registra nada y vuelve a preguntar cuanto fue', async () => {
    const p = new PuertoGuionado([]);
    const m = nuevo(p);
    await m.manejarIntencion(intencion({ accion: 'pago_parcial', monto_texto: '20k', cuenta: 'javier' }), e('Beta depositó 20k'));
    const r = await m.interceptar(e('no', 2));
    expect(r?.textos[0]).toContain('No registré nada. ¿Cuánto fue?');
    expect(p.llamadas).toHaveLength(0);
    expect(p.espera).toMatchObject({ falta: 'monto' });
  });

  it('falta la cuenta: la base pregunta, el socio contesta "a Isaac" y se registra con la cuenta', async () => {
    const p = new PuertoGuionado([{ estado: 'pregunta', falta: 'cuenta', texto: '¿A qué cuenta entró el pago de Cliente Beta?' }, { estado: 'ok', aviso_grupo: 'Registrado COB-0002.' }]);
    const m = nuevo(p);
    const a = await m.manejarIntencion(intencion({ accion: 'pago_total' }), e('Beta ya pagó todo'));
    expect(a.textos).toEqual(['¿A qué cuenta entró el pago de Cliente Beta?']);
    const b = await m.interceptar(e('le pagó directo a Isaac', 2));
    expect(b?.textos).toEqual(['Registrado COB-0002.']);
    expect(p.llamadas[1]!.args).toMatchObject({ accion: 'pago_total', cuenta: 'isaac', cliente_id: 7 });
  });

  it('"dice que paga el jueves": la fecha la resuelve el codigo (ISO) y el aviso trae la pregunta de extender', async () => {
    const p = new PuertoGuionado([{ estado: 'ok', aviso_grupo: 'Anotado COB-0003 ... ¿Solo cambio mi recordatorio o le extiendo el plazo?', siguiente: 'extender', promesa_fecha: '2026-11-19' }, { estado: 'ok', aviso_grupo: 'Plazo extendido COB-0004.' }]);
    const m = nuevo(p);
    await m.manejarIntencion(intencion({ accion: 'prometio', cuando_texto: 'el jueves' }), e('Beta dice que paga el jueves'));
    expect(p.llamadas[0]!.args).toMatchObject({ accion: 'prometio', fecha: '2026-11-19' });
    expect(p.espera).toMatchObject({ falta: 'extender', datos: { promesa_fecha: '2026-11-19' } });
    const r = await m.interceptar(e('extender plazo', 2));
    expect(r?.textos).toEqual(['Plazo extendido COB-0004.']);
    expect(p.llamadas[1]!.args).toMatchObject({ accion: 'extender_plazo', fecha: '2026-11-19' });
  });

  it('"solo recordatorio" cierra la pregunta sin tocar plazo ni recargo y no llama a la base', async () => {
    const p = new PuertoGuionado([{ estado: 'ok', aviso_grupo: 'Anotado.', siguiente: 'extender', promesa_fecha: '2026-11-19' }]);
    const m = nuevo(p);
    await m.manejarIntencion(intencion({ accion: 'prometio', cuando_texto: 'el jueves' }), e('Beta paga el jueves'));
    const r = await m.interceptar(e('solo recordatorio', 2));
    expect(r?.textos).toEqual(['Listo: queda solo como recordatorio. El plazo y el recargo no cambian.']);
    expect(p.llamadas).toHaveLength(1);
    expect(p.espera).toBeNull();
  });

  it('"se atrasa una semana": manda los dias (la suma la hace SQL), nunca una fecha calculada por el modelo', async () => {
    const p = new PuertoGuionado([{ estado: 'ok', aviso_grupo: 'Anotado COB-0005.' }]);
    await nuevo(p).manejarIntencion(intencion({ accion: 'se_atrasa', duracion_texto: 'una semana' }), e('Beta se atrasa una semana'));
    expect(p.llamadas[0]!.args).toMatchObject({ accion: 'se_atrasa', dias: 7 });
    expect(p.llamadas[0]!.args.fecha).toBeUndefined();
  });

  it('una fecha en el pasado o ilegible se pregunta de nuevo; no se manda nada a la base', async () => {
    const p = new PuertoGuionado([]);
    const s = await nuevo(p).manejarIntencion(intencion({ accion: 'prometio', cuando_texto: 'ayer' }), e('Beta prometió pagar ayer'));
    expect(s.textos).toEqual(['Esa fecha ya pasó. ¿Para qué fecha?']);
    expect(p.llamadas).toHaveLength(0);
    expect(p.espera).toMatchObject({ falta: 'fecha', accion: 'prometio' });
  });

  it('disputa sin motivo: pregunta el motivo y con la respuesta registra', async () => {
    const p = new PuertoGuionado([{ estado: 'pregunta', falta: 'motivo', texto: '¿Cuál es el motivo de la disputa de Cliente Beta?' }, { estado: 'ok', aviso_grupo: 'En disputa COB-0006.' }]);
    const m = nuevo(p);
    await m.manejarIntencion(intencion({ accion: 'disputa' }), e('Beta disputa el pedido'));
    const r = await m.interceptar(e('dice que le faltaron 5 piezas', 2));
    expect(r?.textos).toEqual(['En disputa COB-0006.']);
    expect(p.llamadas[1]!.args).toMatchObject({ accion: 'disputa', motivo: 'dice que le faltaron 5 piezas' });
  });

  it('"silenciar Cliente Gama 7 dias" es un atajo del servidor: no usa IA y llama a pausa con los dias', async () => {
    const p = new PuertoGuionado([{ estado: 'ok', aviso_grupo: 'Pausa COB-0007.' }]);
    const r = await nuevo(p).interceptar(e('silenciar Cliente Gama 7 días'));
    expect(r?.textos).toEqual(['Pausa COB-0007.']);
    expect(p.llamadas[0]!.args).toMatchObject({ accion: 'pausa', dias: 7, cliente_id: 8 });
  });

  it('pago repetido (antiduplicado): pregunta si es otro pago y con el si lo registra confirmado', async () => {
    const p = new PuertoGuionado([{ estado: 'duplicado', falta: 'confirmar_duplicado', texto: 'Ya registré un pago igual hace unos minutos (COB-0001). ¿Es otro pago?' }, { estado: 'ok', aviso_grupo: 'Registrado COB-0008.' }]);
    const m = nuevo(p);
    await m.manejarIntencion(intencion({ accion: 'pago_parcial', monto_texto: '5,000', cuenta: 'javier' }), e('Beta depositó 5,000'));
    expect(p.espera).toMatchObject({ falta: 'confirmar_duplicado' });
    const r = await m.interceptar(e('sí, es otro', 2));
    expect(r?.textos).toEqual(['Registrado COB-0008.']);
    expect(p.llamadas[1]!.args).toMatchObject({ confirmo_duplicado: true });
  });

  it('un rechazo de la base (solo lectura) se le dice tal cual al socio, sin romper', async () => {
    const p = new PuertoGuionado(() => { throw new RechazoCobranza('el agente esta en solo lectura desde 09:00: un socio lo reactiva con /escritura', 'P0463'); });
    const s = await nuevo(p).manejarIntencion(intencion({ accion: 'aun_no' }), e('Beta todavía no'));
    expect(s.textos).toEqual(['el agente esta en solo lectura desde 09:00: un socio lo reactiva con /escritura']);
  });

  it('deshacer fuera de la ventana de 10 minutos devuelve el mensaje claro', async () => {
    const s = await nuevo(new PuertoGuionado([])).interceptar(e('deshacer COB-0099'));
    expect(s?.textos).toEqual(['pasaron más de 10 minutos desde el folio COB-0099']);
  });

  it('cliente que no existe o ambiguo: pregunta, no inventa; sin pregunta abierta un texto cualquiera pasa de largo', async () => {
    const p = new PuertoGuionado([]);
    const m = nuevo(p);
    expect((await m.manejarIntencion(intencion({ cliente_texto: 'Zutano' }), e('Zutano ya pagó'))).textos[0]).toContain('No encontré al cliente "Zutano"');
    expect(await m.interceptar(e('hola, ¿cómo vamos hoy?'))).toBeNull();
    expect(p.llamadas).toHaveLength(0);
  });

  it('con una pregunta abierta, una frase corta que no se entiende la repite; una instruccion larga se deja pasar', async () => {
    const p = new PuertoGuionado([{ estado: 'pregunta', falta: 'cuenta', texto: '¿A qué cuenta?' }]);
    const m = nuevo(p);
    await m.manejarIntencion(intencion({ accion: 'pago_total' }), e('Beta pagó todo'));
    expect((await m.interceptar(e('mmm', 2)))?.textos).toEqual(['¿A qué cuenta entró el pago? Angelo, Javier, Isaac, Karen o Efectivo.']);
    expect(await m.interceptar(e('mejor dime cuánto debe Gama en total y cuándo vencen todos sus pedidos del mes', 3))).toBeNull();
  });
});

describe('reloj de la cobranza (apagado por la base; transporte falso)', () => {
  const enviador = () => {
    const enviados: MensajeSalida[] = [];
    const t = { enviar: async (m: MensajeSalida) => { enviados.push(m); return { messageId: 4242 }; } } as unknown as EnviadorTelegram;
    return { enviados, t };
  };
  const puerto = (estado: string, fallaEnvio = false) => {
    const registros: Array<{ ok: boolean; id: number | null; error: string | null }> = [];
    const p: PuertoRelojCobranza = {
      tick: async () => (estado === 'reclamado' ? { estado, digest_id: 9, texto: 'Cobranza de hoy, martes 17-nov' } : { estado }),
      registrarEnvio: async (_d, ok, id, error) => void registros.push({ ok, id, error }),
      chats: async () => ({ grupoSocios: -100777, privadoOmar: 555 }),
    };
    return { p, registros, fallaEnvio };
  };

  it('apagado, temprano o sin contenido: NO se envia nada', async () => {
    for (const estado of ['apagado', 'sin_envio', 'cron_pausado', 'temprano', 'sin_contenido', 'ya_enviado', 'reclamado_sin_confirmar']) {
      const { enviados, t } = enviador();
      const { p, registros } = puerto(estado);
      const r = await ejecutarRelojCobranza('am', p, t);
      expect(r).toEqual({ estado, enviado: false });
      expect(enviados).toHaveLength(0);
      expect(registros).toHaveLength(0);
    }
  });

  it('reclamado: se envia UNA vez, solo al grupo de los socios (nunca al privado de Omar) y se registra el mensaje', async () => {
    const { enviados, t } = enviador();
    const { p, registros } = puerto('reclamado');
    const r = await ejecutarRelojCobranza('am', p, t);
    expect(r).toEqual({ estado: 'enviado', enviado: true, messageId: 4242 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ chatId: -100777, protegido: true });
    expect(enviados[0]!.chatId).not.toBe(555);
    expect(registros).toEqual([{ ok: true, id: 4242, error: null }]);
  });

  it('si el envio falla se registra el fallo (y solo entonces la base permite reintentar)', async () => {
    const registros: Array<{ ok: boolean; error: string | null }> = [];
    const p: PuertoRelojCobranza = { tick: async () => ({ estado: 'reclamado', digest_id: 3, texto: 'x' }), registrarEnvio: async (_d, ok, _i, error) => void registros.push({ ok, error }), chats: async () => ({ grupoSocios: -1, privadoOmar: 2 }) };
    const t = { enviar: async () => { throw new Error('telegram 502'); } } as unknown as EnviadorTelegram;
    const r = await ejecutarRelojCobranza('am', p, t);
    expect(r).toEqual({ estado: 'fallido', enviado: false });
    expect(registros).toEqual([{ ok: false, error: 'telegram 502' }]);
  });
});
