import { describe, expect, it } from 'vitest';
import { centavosDeUsdMicro, conciliarEnVivo, microDeUsd, parsearLlave } from '@/dominio/costos/en_vivo';
import { leerUsoDeLaLlave } from '@/infra/costos/openrouter_en_vivo';

describe('OpenRouter en vivo', () => {
  it('convierte dolares a millonesimas y descarta lo no numerico', () => {
    expect(microDeUsd(0.002169)).toBe(2169n);
    expect(microDeUsd(12.5)).toBe(12_500_000n);
    for (const v of [-1, NaN, '3', null, undefined]) expect(microDeUsd(v)).toBe(0n);
  });
  it('interpreta la respuesta de /key', () => {
    const l = parsearLlave({ data: { usage: 40.5, usage_monthly: 12.25, usage_daily: 0.5, usage_weekly: 3, limit: 100 } }, '2026-11-16T00:00:00.000Z');
    expect(l).toMatchObject({ usoMesUsdMicro: 12_250_000n, usoDiaUsdMicro: 500_000n, usoSemanaUsdMicro: 3_000_000n, usoTotalUsdMicro: 40_500_000n, limiteUsdMicro: 100_000_000n });
    expect(parsearLlave({ data: {} }, 'x')).toBeNull();
    expect(parsearLlave(null, 'x')).toBeNull();
  });
  it('concilia con tolerancia relativa y piso de 5 centavos de dolar', () => {
    expect(conciliarEnVivo(2169n, 2169n).estado).toBe('cuadra');
    expect(conciliarEnVivo(2169n, 40_000n).estado).toBe('cuadra'); // 4 centavos de diferencia: piso absoluto
    expect(conciliarEnVivo(10_000_000n, 10_150_000n).estado).toBe('cuadra'); // 1.5 %
    expect(conciliarEnVivo(10_000_000n, 11_000_000n).estado).toBe('fuera_de_tolerancia'); // 10 %
  });
  it('pasa dolares a centavos de peso con el tipo de cambio', () => {
    expect(centavosDeUsdMicro(20_000_000n, 18_536_300n)).toBe(37073n); // USD 20 x 18.5363 = 370.726 -> 370.73
  });
  it('sin llave o con falla de red no inventa nada (null)', async () => {
    expect(await leerUsoDeLaLlave(undefined)).toBeNull();
    expect(await leerUsoDeLaLlave('x'.repeat(30), (async () => { throw new Error('red'); }) as unknown as typeof fetch)).toBeNull();
    expect(await leerUsoDeLaLlave('x'.repeat(30), (async () => new Response('no', { status: 401 })) as unknown as typeof fetch)).toBeNull();
    const ok = (async () => new Response(JSON.stringify({ data: { usage: 1, usage_monthly: 0.5 } }), { status: 200 })) as unknown as typeof fetch;
    expect((await leerUsoDeLaLlave('x'.repeat(30), ok, () => new Date('2026-11-16T12:00:00Z')))?.usoMesUsdMicro).toBe(500_000n);
  });
});
