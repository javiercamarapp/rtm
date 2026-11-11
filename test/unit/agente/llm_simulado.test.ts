import { describe, it, expect } from 'vitest';
import { LlmGuionado, LlmHeuristico, interpretarHeuristico } from '@/infra/agente/llm_simulado';
import { validarRespuesta } from '@/aplicacion/agente/esquemas';
import { ErrorLlm } from '@/aplicacion/agente/puertos';

const tipos = (autor: 'angelo' | 'javier' | 'omar', texto: string) => interpretarHeuristico(autor, texto).acciones.map((a) => a.tipo);

describe('LLM heuristico del simulador (sin red): produce siempre un objeto valido del esquema', () => {
  it.each([
    ['angelo', 'Cliente Norte 28 jupiter 24 nexa', 'pedido'],
    ['angelo', 'Cliente Norte: jupiter 28, nexa 24', 'pedido'],
    ['angelo', 'pago Cliente Norte 7,000', 'pago'],
    ['angelo', 'Cliente Norte pago 7 mil', 'pago'],
    ['angelo', 'Cliente Norte mando 30,500 a Karen', 'pago_proveedor'],
    ['javier', 'pague 12,000 a Isaac desde mi cuenta', 'pago_proveedor'],
    ['angelo', 'pidele a Karen 100 nexa y 50 sopro', 'orden_compra'],
    ['javier', 'puse 1,000 mas de capital', 'aportacion'],
    ['angelo', 'pague 500 de guia', 'gasto'],
    ['angelo', 'cuanto hay de jupiter?', 'consulta'],
    ['angelo', 'cuanto saldo tengo con Karen', 'consulta'],
    ['angelo', 'saldo de Cliente Norte', 'consulta'],
    ['angelo', 'resumen de hoy', 'consulta'],
    ['angelo', 'deshaz lo ultimo', 'deshacer'],
    ['omar', '3 elux sandia, 2 elux mango', 'toma_omar'],
    ['angelo', 'tome 5 elux', 'toma_omar'],
    ['angelo', 'hola buen dia', 'ninguna'],
  ] as const)('%s: "%s" -> %s', (autor, texto, esperado) => {
    const r = interpretarHeuristico(autor, texto);
    expect(r.acciones[0]!.tipo).toBe(esperado);
    expect(validarRespuesta(r).ok).toBe(true);
  });

  it('separa modelo y sabor en la toma de Omar y entiende las cifras con k y mil', () => {
    const r = interpretarHeuristico('omar', '3 elux sandia');
    expect(r.acciones[0]).toMatchObject({ tipo: 'toma_omar', lineas: [{ modelo_texto: 'elux', sabor_texto: 'sandia', piezas: 3 }] });
    const p = interpretarHeuristico('angelo', 'pago Cliente Norte 7k').acciones[0];
    expect(p).toMatchObject({ tipo: 'pago', monto_centavos: 700_000 });
  });

  it('Omar preguntando algo no se interpreta como toma', () => {
    expect(tipos('omar', 'cuanto saldo tengo')).toEqual(['consulta']);
  });

  it('un monto imposible no genera accion', () => {
    expect(tipos('angelo', 'pago Cliente Norte 0')).toEqual(['ninguna']);
  });

  it('el doble LlmHeuristico lee el mensaje del prompt; sin mensaje falla con error tipado', async () => {
    const llm = new LlmHeuristico();
    const r = await llm.extraer({ rol: 'texto', modelos: ['x'], sistema: 's', usuario: '<mensaje autor="angelo" fuente="texto">pago Cliente Norte 1,000</mensaje>', maxTokensSalida: 10, esquemaJson: {} });
    expect(validarRespuesta(r.contenido).ok).toBe(true);
    expect(r.costoMicroUsd).toBeGreaterThan(0n);
    await expect(llm.extraer({ rol: 'texto', modelos: ['x'], sistema: 's', usuario: 'sin etiqueta', maxTokensSalida: 10, esquemaJson: {} })).rejects.toBeInstanceOf(ErrorLlm);
  });

  it('LlmGuionado repite la ultima salida y lanza los errores programados', async () => {
    const llm = new LlmGuionado([{ a: 1 }, new Error('x')]);
    const p = { rol: 'texto' as const, modelos: [], sistema: '', usuario: '', maxTokensSalida: 1, esquemaJson: {} };
    expect((await llm.extraer(p)).modeloUsado).toBe('simulado');
    await expect(llm.extraer(p)).rejects.toThrow('x');
    await expect(llm.extraer(p)).rejects.toThrow('x');
    expect(llm.llamadas).toBe(3);
  });
});
