// B3: el webhook valida el secreto ANTES de leer el cuerpo y limita su tamano.
import { describe, expect, it } from 'vitest';
import { leerCuerpoAcotado, manejarWebhook, MAX_CUERPO_BYTES } from '@/infra/agente/telegram_webhook';

describe('B3: webhook, secreto antes del cuerpo y tope de tamano', () => {
  const upd = JSON.stringify({ update_id: 1 });
  it('con secreto invalido NO se lee el cuerpo', async () => {
    let leido = false;
    const r = await manejarWebhook({ cabeceraSecreto: 'malo', secretoEsperado: 'bueno-bueno-bueno', cuerpo: async () => { leido = true; return upd; }, procesar: async () => ({ estado: 'procesado', acciones: 0 }) });
    expect(r).toEqual({ status: 401, detalle: 'secreto_invalido' });
    expect(leido).toBe(false);
  });

  it('con secreto valido se lee y procesa; un cuerpo que excede el limite se ignora con 200 sin procesar', async () => {
    let n = 0;
    const procesar = async () => { n++; return { estado: 'procesado', acciones: 0 } as const; };
    expect((await manejarWebhook({ cabeceraSecreto: 'bueno-bueno-bueno', secretoEsperado: 'bueno-bueno-bueno', cuerpo: async () => upd, procesar })).detalle).toBe('procesado');
    expect(await manejarWebhook({ cabeceraSecreto: 'bueno-bueno-bueno', secretoEsperado: 'bueno-bueno-bueno', cuerpo: async () => null, procesar })).toEqual({ status: 200, detalle: 'ignorado' });
    expect(n).toBe(1);
  });

  it('leerCuerpoAcotado: rechaza por Content-Length sin leer, corta la lectura al pasar el tope y lee un cuerpo normal', async () => {
    const flujo = (trozos: Uint8Array[]) => new ReadableStream<Uint8Array>({ pull(c) { const t = trozos.shift(); if (t) c.enqueue(t); else c.close(); } });
    const h = (cl?: string) => ({ get: (n: string) => (n === 'content-length' ? (cl ?? null) : null) });
    const sinLeer = { getReader: () => { throw new Error('no debe leerse'); } } as unknown as ReadableStream<Uint8Array>;
    expect(await leerCuerpoAcotado({ headers: h(String(MAX_CUERPO_BYTES + 1)), body: sinLeer })).toBeNull();
    expect(await leerCuerpoAcotado({ headers: h(), body: flujo([new Uint8Array(600), new Uint8Array(600)]) }, 1000)).toBeNull();
    expect(await leerCuerpoAcotado({ headers: h('2'), body: flujo([new TextEncoder().encode('{}')]) })).toBe('{}');
    expect(await leerCuerpoAcotado({ headers: h(), body: null })).toBe('');
  });
});
