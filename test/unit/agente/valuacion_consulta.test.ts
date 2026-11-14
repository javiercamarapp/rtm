import { describe, expect, it } from 'vitest';
import { debeProcesarConIa } from '@/dominio/agente/entrada';
import { permisoParaIntencion } from '@/dominio/agente/permisos';
import { interpretarHeuristico } from '@/infra/agente/llm_simulado';
import { NegocioSimulado } from '@/infra/agente/negocio_simulado';
import type { Intencion } from '@/dominio/agente/intenciones';

describe('consulta "mi valuacion" / "como estamos" del bot', () => {
  it('el prefiltro ya no la deja en silencio', () => {
    for (const t of ['mi valuacion', 'como estamos', 'Cómo estamos', 'valuación']) expect(debeProcesarConIa(t)).toBe(true);
  });
  it('se entiende como consulta valuacion', () => {
    for (const t of ['mi valuacion', 'como estamos']) expect(interpretarHeuristico('angelo', t).acciones[0]).toMatchObject({ tipo: 'consulta', consulta: 'valuacion' });
  });
  it('Omar queda rechazado', () => {
    const c = interpretarHeuristico('angelo', 'mi valuacion').acciones[0] as Intencion;
    expect(permisoParaIntencion('omar', c)).toEqual({ permitido: false, motivo: 'fuera_de_alcance' });
    expect(permisoParaIntencion('socio', c)).toEqual({ permitido: true });
  });
  it('texto determinista con las cifras del dueno y sin telefonos', async () => {
    const n = new NegocioSimulado();
    const c = interpretarHeuristico('angelo', 'mi valuacion').acciones[0] as Extract<Intencion, { tipo: 'consulta' }>;
    const r = await n.consultar(c, {} as never, { persona: 'angelo', rol: 'socio', telegramUserId: 1 } as never, new Date(0));
    const texto = JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(texto).toContain('10691039');
    expect(texto).toContain('Tienes $47,921.91 menos que Javier');
    expect(texto).toContain('entrega a la sociedad los $35,475.00 que tienes cobrados y aporta $12,446.91 con el siguiente pago');
    expect(texto).not.toMatch(/tel[eé]fono|whatsapp/i);
    const o = await n.consultar(c, {} as never, { persona: 'omar', rol: 'omar', telegramUserId: 2 } as never, new Date(0));
    expect(o.lineas).toEqual([]);
  });
});
