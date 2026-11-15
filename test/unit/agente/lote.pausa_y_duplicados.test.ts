// Comportamiento definido de un lote (varias operaciones que escriben en un mensaje), 19-nov:
//   - nunca se registra en silencio una parte: si algo no se resuelve ANTES de escribir, el lote se pausa COMPLETO y se dice que nada quedo registrado;
//   - si una pregunta de la conversacion aparece a media ejecucion, las operaciones siguientes se PAUSAN y el aviso final las cuenta;
//   - renglones iguales: UNA sola pregunta por lote, no una por renglon.
import { describe, it, expect } from 'vitest';
import type { Intencion } from '@/dominio/agente/intenciones';
import { respuesta } from '@/infra/agente/llm_simulado';
import { escenario, pedido, pago, IDS } from './ayudas';

const gasto = (centavos: number): Intencion => ({ tipo: 'gasto', gasto: 'uber', monto_centavos: centavos, pagado_por: 'angelo', descripcion: null, fuente_cita: 'cita' });

describe('lote con un dato que el catalogo no resuelve: pausa COMPLETA antes de escribir', () => {
  it('no registra ninguna operacion y dice cuales fallan', async () => {
    const e = escenario([respuesta([gasto(10_000), pedido('Cliente Fantasma', [['jupiter', 28]]), gasto(20_000)])]);
    await e.socio('angelo', 'gasto uber 100\nCliente Fantasma 28 jupiter\ngasto uber 200');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    const t = e.ultimoGrupo().texto;
    expect(t).toContain('Pause el lote completo');
    expect(t).toContain('no registre ninguna de las 3 operaciones');
    expect(t).toContain('operacion 2');
    expect(t).toContain('nada quedo registrado');
  });
  it('reenviado completo y corregido, se registra completo', async () => {
    const e = escenario([respuesta([gasto(10_000), pedido('Cliente Fantasma', [['jupiter', 28]]), gasto(20_000)]), respuesta([gasto(10_000), pedido('Cliente Norte', [['jupiter', 28]]), gasto(20_000)])]);
    await e.socio('angelo', 'gasto uber 100\nCliente Fantasma 28 jupiter\ngasto uber 200');
    await e.socio('angelo', 'gasto uber 100\nCliente Norte 28 jupiter\ngasto uber 200');
    expect(e.negocio.numeroDeHechos()).toBe(3);
    expect(e.ultimoGrupo().texto).toContain('registre 3');
  });
  it('una pregunta del modelo (aclarar) dentro del lote tambien pausa todo', async () => {
    const e = escenario([respuesta([gasto(10_000), { tipo: 'aclarar', pregunta: 'cual cliente' }, gasto(20_000)])]);
    await e.socio('angelo', 'gasto uber 100\nel de ayer\ngasto uber 200');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().texto).toContain('Pause el lote completo');
  });
});

describe('pregunta abierta a media ejecucion: lo que sigue se pausa y se cuenta', () => {
  it('cobro sin cuenta en el renglon 2 de 3: el 1 se registra, el 3 queda pausado y el aviso lo dice', async () => {
    const e = escenario([respuesta([gasto(10_000), pago('Cliente Norte', 100_000, null), gasto(20_000)])]);
    await e.socio('angelo', 'gasto uber 100\nNorte pago 1,000\ngasto uber 200');
    expect(e.negocio.numeroDeHechos()).toBe(1);
    const pregunta = e.grupo().find((m) => m.texto.toLowerCase().includes('cuenta'));
    expect(pregunta).toBeDefined();
    const resumen = e.ultimoGrupo().texto;
    expect(resumen).toContain('Recibi 3 lineas');
    expect(resumen).toContain('registre 1');
    expect(resumen).toContain('Pause 1 operaciones sin registrar');
    expect(resumen).toContain('la operacion 2 tiene una pregunta abierta');
  });
});

describe('renglones iguales: una sola pregunta por lote', () => {
  it('tres gastos iguales: se registra uno, UNA pregunta para los otros dos, y el si registra los tres', async () => {
    const e = escenario([respuesta([gasto(15_000), gasto(15_000), gasto(15_000)])]);
    e.negocio.guardas.duplicados = true;
    await e.socio('angelo', 'gasto uber 150\ngasto uber 150\ngasto uber 150');
    expect(e.negocio.numeroDeHechos()).toBe(1);
    const preguntas = e.grupo().filter((m) => (m.botones ?? []).some((f) => f.some((b) => b.texto === 'Si, son distintos')));
    expect(preguntas).toHaveLength(1);
    expect(e.grupo().filter((m) => m.texto.includes('Ya se registro un movimiento igual'))).toHaveLength(0);
    expect(preguntas[0]!.texto).toContain('2 renglones iguales');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, preguntas[0]!, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(3);
  });
  it('"No, cancelar" deja solo el primero', async () => {
    const e = escenario([respuesta([gasto(15_000), gasto(15_000)])]);
    e.negocio.guardas.duplicados = true;
    await e.socio('angelo', 'gasto uber 150\ngasto uber 150');
    const q = e.grupo().find((m) => (m.botones ?? []).some((f) => f.some((b) => b.texto === 'Si, son distintos')))!;
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0, 1);
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
  it('un solo renglon repetido (sin lote) conserva su pregunta de duplicado de siempre', async () => {
    const e = escenario([respuesta([gasto(15_000)]), respuesta([gasto(15_000)])]);
    e.negocio.guardas.duplicados = true;
    await e.socio('angelo', 'gasto uber 150');
    await e.socio('angelo', 'gasto uber 150 otra vez');
    expect(e.ultimoGrupo().texto).toContain('Ya se registro un movimiento igual');
  });
});
