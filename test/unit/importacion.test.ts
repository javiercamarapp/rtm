// Importador: lectura de las listas, plan y verificaciones. Fixtures ILUSTRATIVOS (test/fixtures/importacion); ningun dato real.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leerListaAngelo } from '@/dominio/importacion/lista_angelo';
import { leerCostosKaren, leerListaJavier } from '@/dominio/importacion/lista_javier';
import { construirPlan } from '@/dominio/importacion/plan';
import { normalizar } from '@/dominio/catalogo/normalizar';
import type { ReglaAlias } from '@/dominio/importacion/alias_angelo';
import type { Decisiones } from '@/dominio/importacion/tipos';

const dir = join(__dirname, '../fixtures/importacion');
const leer = (n: string) => readFileSync(join(dir, n), 'utf8');
const archivo = (p: string) => { try { return readFileSync(join(dir, 'tabuladores', `${p}-1.txt`), 'utf8'); } catch { return null; } };
const REGLAS: ReglaAlias[] = [
  { alias: 'Alfa 50', destinos: ['Alfa Uno 50K', 'Alfa Dos 50K'], nota: 'grupo' },
  { alias: 'Modelo Propio', destinos: ['Alfa Uno 50K'], nota: 'choca con un modelo de la otra lista' },
  { alias: 'Betita', destinos: ['Beta Tres 15K'], nota: 'alias normal' },
];
const DEC: Decisiones = { nombre_completo: { 'Cliente Alfa': 'Cliente Alfa Completo' }, mismo_tabulador: { 'Cliente Lago': 'Cliente Sierra' }, alias_confirmados: [], equivalencias: [{ nombre: 'Uno Basico', modelo: 'Alfa Uno 50K' }], persona_bodega: 'Cliente Mar' };

function armar(dec: Decisiones = DEC) {
  const angelo = leerListaAngelo(leer('angelo.md'));
  const javier = leerListaJavier(leer('javier.md'), archivo);
  const karen = leerCostosKaren(leer('javier.md'));
  return { angelo, javier, karen, ...construirPlan(angelo, javier, karen, dec, REGLAS) };
}

describe('lectura de la lista de Angelo', () => {
  const { angelo, verificacion: v } = armar();
  it('cuenta costos, clientes y lineas', () => {
    expect(angelo.costos).toHaveLength(5);
    expect(angelo.clientes).toHaveLength(4);
    expect(v.lineasAngelo).toBe(6);
  });
  it('verifica con codigo que cada margen es precio menos costo y cuenta los margenes en cero', () => {
    expect(v.margenesQueNoCuadran).toEqual([]);
    expect(v.costosQueNoCoinciden).toEqual([]);
    expect(v.margenesCero).toBe(1);
  });
  it('lee alias, destinos y ocasionales', () => {
    expect(angelo.aliasCliente).toEqual([{ alias: 'Lupita', destino: 'Cliente Beta' }]);
    expect(angelo.destinosCliente).toEqual([{ cliente: 'Cliente Gamma', etiquetas: ['Gamma Norte', 'Gamma Sur'] }]);
    expect(angelo.ocasionales).toEqual(['Cliente Delta']);
  });
  it('detecta un margen mal escrito', () => {
    const roto = leer('angelo.md').replace('| Alfa Uno 50K | $250 | $200 | $50 |', '| Alfa Uno 50K | $250 | $200 | $55 |');
    const r = construirPlan(leerListaAngelo(roto), leerListaJavier(leer('javier.md'), archivo), leerCostosKaren(leer('javier.md')), DEC, REGLAS);
    expect(r.verificacion.margenesQueNoCuadran).toHaveLength(1);
  });
});

describe('plan: sin equivalencias inventadas entre listas', () => {
  const { plan } = armar();
  const nombres = plan.modelos.map((m) => normalizar(m.nombre));
  it('un nombre identico tras normalizar es un solo modelo; los demas son distintos', () => {
    expect(plan.modelos.filter((m) => normalizar(m.nombre) === 'nexa ilustrativo 50k')).toHaveLength(2); // una por lista; el SQL las une
    expect(nombres).toContain('modelo propio');
    expect(nombres).toContain('uno 10'.replace('uno 10', 'alfa uno 50k'));
  });
  it('la equivalencia solo existe si el dueno la decidio una por una', () => {
    const sin = armar({ ...DEC, equivalencias: [] }).plan;
    expect(sin.modelos.some((m) => normalizar(m.nombre) === 'uno basico')).toBe(true);
    expect(plan.modelos.some((m) => normalizar(m.nombre) === 'uno basico')).toBe(false);
  });
  it('informa como conflicto el mismo nombre con costos distintos', () => {
    expect(plan.conflictos.join('\n')).toContain('Nexa Ilustrativo 50K');
  });
  it('un alias que choca con un modelo de la otra lista se vuelve ambiguo', () => {
    expect(plan.aliasModelo.find((a) => a.alias === 'Alfa 50')?.destinos).toHaveLength(2);
    const choque = plan.aliasModelo.find((a) => a.alias === 'Modelo Propio')!;
    expect(choque.destinos).toEqual(['Alfa Uno 50K', 'Modelo Propio']);
    expect(plan.aliasModelo.find((a) => a.alias === 'Betita')?.destinos).toEqual(['Beta Tres 15K']);
  });
});

describe('plan: disponibilidad, clientes y tabuladores', () => {
  const { plan } = armar();
  it('fuera de catalogo = sin disponibilidad ahora (el modelo y sus precios se conservan)', () => {
    expect(plan.sinDisponibilidad.sort()).toEqual(['Alfa Dos 50K', 'Zeta Mini 10K']);
    expect(plan.precios.some((p) => p.modelo === 'Alfa Dos 50K')).toBe(true);
  });
  it('cada cliente tiene dueno; el nombre completo decidido genera alias', () => {
    expect(plan.clientes.find((c) => c.nombre === 'Cliente Alfa Completo')?.duenio).toBe('Angelo');
    expect(plan.clientes.find((c) => c.nombre === 'Cliente Sierra')?.duenio).toBe('Javier');
    expect(plan.aliasCliente.some((a) => a.alias === 'Cliente Alfa' && a.destinos[0] === 'Cliente Alfa Completo')).toBe(true);
    expect(plan.clientes.find((c) => c.nombre === 'Cliente Delta')?.tipo).toBe('ocasional');
  });
  it('la lista descartada no se importa como vigente y deja una nota', () => {
    const sierra = plan.precios.filter((p) => p.cliente === 'Cliente Sierra');
    expect(sierra.map((p) => p.centavos).sort((a, b) => (a < b ? -1 : 1))).toEqual([9000n, 20000n, 27000n]);
    expect(plan.clientes.find((c) => c.nombre === 'Cliente Sierra')?.nota).toContain('DESCARTADA');
    expect(plan.aliasCliente.filter((a) => a.destinos[0] === 'Cliente Sierra').map((a) => a.alias).sort()).toEqual(['Sierra Norte', 'el serrano']);
  });
  it('"mismo tabulador que" es una copia con origen marcado', () => {
    const lago = plan.precios.filter((p) => p.cliente === 'Cliente Lago');
    expect(lago).toHaveLength(plan.precios.filter((p) => p.cliente === 'Cliente Sierra').length);
    expect(lago.every((p) => p.nota?.includes('Mismo tabulador que Cliente Sierra'))).toBe(true);
  });
  it('un cliente que copia a otro (Happy Spot con Fer) trae sus mismos precios', () => {
    const costa = plan.precios.filter((p) => p.cliente === 'Cliente Costa').map((p) => p.centavos);
    expect(plan.precios.filter((p) => p.cliente === 'Cliente Eco').map((p) => p.centavos)).toEqual(costa);
  });
  it('el archivo sin dueno queda como lista de referencia, no vigente', () => {
    expect(plan.listasSinDuenio).toHaveLength(1);
    expect(plan.listasSinDuenio[0]!.referencia).toBe('text-BBBB');
    expect(plan.precios.some((p) => p.centavos === 99900n)).toBe(false);
  });
  it('Karen: costos con marca de supuesto', () => {
    const k = plan.costos.filter((c) => c.proveedor === 'Karen');
    expect(k).toHaveLength(4);
    expect(k.every((c) => c.supuesto && c.desde === '2026-11-10' && c.fuente.endsWith('_supuesto'))).toBe(true);
  });
  it('es determinista: mismo insumo, mismo plan', () => {
    const otra = armar().plan;
    expect(JSON.stringify(otra, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(JSON.stringify(plan, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  });
});
