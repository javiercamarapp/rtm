import { describe, expect, it } from 'vitest';
import type { LoteEntrega, MiembroLote } from '@/aplicacion/notificaciones/despachador';
import { AlmacenTokensMemoria, EnviadorTelegramMemoria } from '@/infra/agente/memoria';
import { ErrorTelegram } from '@/infra/agente/telegram_api';
import { enviadorTelegramDeLotes, textoDeMiembro } from '@/infra/notificaciones/telegram_lotes';

const miembro = (o: Partial<MiembroLote> = {}): MiembroLote => ({ entrega_id: 1, notificacion_id: 1, tipo: 'proveedor_modelo_nuevo', severidad: 'I', version: 1, titulo: 'Modelo nuevo en Karen: Modelo S', payload: {}, entidad_tipo: null, entidad_id: null, conteo: 1, requiere_accion: false, botones: [], reenvio: false, ...o });
const lote = (ms: MiembroLote[], o: Partial<LoteEntrega> = {}): LoteEntrega => ({ canal: 'telegram', destino: 'grupo_socios', grupo_clave: null, silencioso: false, telegram_chat_id: -100200, miembros: ms, ...o });

describe('envio de lotes por Telegram', () => {
  it('manda el aviso al grupo de socios con contenido protegido y sin sonido en horario silencioso', async () => {
    const tg = new EnviadorTelegramMemoria();
    const r = await enviadorTelegramDeLotes(tg, null, null).enviar(lote([miembro()], { silencioso: true }));
    expect(r.resultado).toBe('ok');
    expect(tg.enviados[0]).toMatchObject({ chatId: -100200, texto: 'Modelo nuevo en Karen: Modelo S', protegido: true, silencioso: true });
  });
  it('un reporte lleva su enlace autenticado y nunca un adjunto', async () => {
    const m = miembro({ tipo: 'reporte_semanal', titulo: 't', payload: { texto: 'Reporte semanal 9 a 15 nov', clave: 'semanal:2026-11-09', version: 1 } });
    expect(textoDeMiembro(m, 'http://127.0.0.1:3100')).toBe('Reporte semanal 9 a 15 nov\nVer el reporte (con tu sesión): http://127.0.0.1:3100/reportes/semanal%3A2026-11-09/1');
    const tg = new EnviadorTelegramMemoria();
    await enviadorTelegramDeLotes(tg, null, 'http://127.0.0.1:3100').enviar(lote([m]));
    expect(Object.keys(tg.enviados[0]!)).not.toContain('adjunto');
  });
  it('agrupa varios avisos en un solo mensaje', async () => {
    const tg = new EnviadorTelegramMemoria();
    await enviadorTelegramDeLotes(tg, null, null).enviar(lote([miembro({ titulo: 'a' }), miembro({ titulo: 'b', conteo: 3 })]));
    expect(tg.enviados[0]!.texto).toBe('2 avisos agrupados\n- a\n- b (3 veces)');
  });
  it('una toma pendiente sale con Autorizar y Rechazar de un solo uso, que se invalidan entre si', async () => {
    const tg = new EnviadorTelegramMemoria();
    const tokens = new AlmacenTokensMemoria();
    await enviadorTelegramDeLotes(tg, tokens, null, () => new Date('2026-11-10T18:00:00Z')).enviar(lote([miembro({ tipo: 'toma_omar_pendiente', requiere_accion: true, payload: { folio: 'T-0001' } })]));
    const botones = tg.enviados[0]!.botones!.flat();
    expect(botones.map((b) => b.texto)).toEqual(['Autorizar', 'Rechazar']);
    for (const b of botones) expect(Buffer.byteLength(b.callbackData)).toBeLessThanOrEqual(64);
    const ok = await tokens.consumir({ token: botones[0]!.callbackData, rol: 'socio', chatId: -100200, ahora: new Date('2026-11-10T18:05:00Z') });
    expect(ok.estado).toBe('ok');
    expect((await tokens.consumir({ token: botones[1]!.callbackData, rol: 'socio', chatId: -100200, ahora: new Date('2026-11-10T18:06:00Z') })).estado).toBe('usado');
  });
  it('traduce las fallas: 429 espera, 403 sin destino, 5xx reintenta, red queda incierta; sin chat registrado no sale', async () => {
    const falla = (e: unknown) => ({ ...new EnviadorTelegramMemoria(), enviar: async () => { throw e; } }) as never;
    const l = lote([miembro()]);
    expect(await enviadorTelegramDeLotes(falla(new ErrorTelegram('rate_limit', 429, 7)), null, null).enviar(l)).toEqual({ resultado: '429', retryAfter: 7 });
    expect(await enviadorTelegramDeLotes(falla(new ErrorTelegram('sin_destino', 403)), null, null).enviar(l)).toMatchObject({ resultado: '403' });
    expect(await enviadorTelegramDeLotes(falla(new ErrorTelegram('servidor', 502)), null, null).enviar(l)).toMatchObject({ resultado: '5xx' });
    expect(await enviadorTelegramDeLotes(falla(new Error('x')), null, null).enviar(l)).toEqual({ resultado: 'red', incierto: true });
    expect(await enviadorTelegramDeLotes(new EnviadorTelegramMemoria(), null, null).enviar(lote([miembro()], { telegram_chat_id: null }))).toMatchObject({ resultado: '403' });
  });
});
