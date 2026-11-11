// Despachador: recorrido del latido (resultados por miembro, fallos, sin enviador). El repositorio es un doble en memoria; las reglas de
// estados, reintentos, tokens y limites se prueban contra las funciones SQL en pgTAP.
import { describe, expect, it } from 'vitest';
import { despacharUnaVez, type EnviadorCanal, type LoteEntrega, type RepositorioEntregas, type ResultadoEnvio } from '@/aplicacion/notificaciones/despachador';

function lote(ids: number[], canal: 'telegram' | 'correo' = 'telegram'): LoteEntrega {
  return {
    canal, destino: 'grupo_socios', grupo_clave: ids.length > 1 ? 'g' : null, silencioso: false, telegram_chat_id: null,
    miembros: ids.map((id) => ({ entrega_id: id, notificacion_id: id, tipo: 'paquete_por_empacar', severidad: 'I' as const, version: 1, titulo: 't', payload: {}, entidad_tipo: null, entidad_id: null, conteo: 1, requiere_accion: false, botones: [], reenvio: false })),
  };
}

function repo(lotes: LoteEntrega[], estadoDe: (r: ResultadoEnvio) => string): RepositorioEntregas & { registrados: [number, ResultadoEnvio][] } {
  const registrados: [number, ResultadoEnvio][] = [];
  return { registrados, reclamar: async () => lotes, registrar: async (id, r) => { registrados.push([id, r]); return estadoDe(r); } };
}

describe('despachador', () => {
  it('registra el mismo resultado en cada miembro de un lote agrupado', async () => {
    const r = repo([lote([1, 2, 3])], () => 'enviada');
    const env: EnviadorCanal = { enviar: async () => ({ resultado: 'ok', mensajeId: '99' }) };
    const res = await despacharUnaVez(r, { telegram: env });
    expect(res).toEqual({ lotes: 1, enviadas: 3, reintentos: 0, muertas: 0 });
    expect(r.registrados.map(([id]) => id)).toEqual([1, 2, 3]);
  });
  it('un fallo del enviador se registra como red incierta, no se pierde', async () => {
    const r = repo([lote([5])], (x) => (x.resultado === 'red' ? 'pendiente' : 'enviada'));
    const res = await despacharUnaVez(r, { telegram: { enviar: async () => { throw new Error('boom'); } } });
    expect(res.reintentos).toBe(1);
    expect(r.registrados[0]![1]).toEqual({ resultado: 'red', incierto: true });
  });
  it('sin enviador del canal (M1) la entrega espera sin gastar intento', async () => {
    const r = repo([lote([7], 'correo')], () => 'pendiente');
    await despacharUnaVez(r, { telegram: { enviar: async () => ({ resultado: 'ok' }) } });
    expect(r.registrados[0]![1]).toEqual({ resultado: '429', retryAfter: 300 });
  });
  it('cuenta las muertas', async () => {
    const r = repo([lote([9])], () => 'muerta');
    const res = await despacharUnaVez(r, { telegram: { enviar: async () => ({ resultado: '403' }) } });
    expect(res.muertas).toBe(1);
  });
});
