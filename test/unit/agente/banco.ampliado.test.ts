// El banco de pruebas anonimizado (scripts/agente/banco/*.json) es parte del contrato del interprete: estructura, cobertura de las intenciones nuevas y cero datos reales.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGO_AMPLIADO } from '@/dominio/agente/catalogo_ampliado';
import { CATALOGO_INTENCIONES } from '@/dominio/agente/catalogo_intenciones';

const DIR = path.resolve(__dirname, '../../../scripts/agente/banco');
const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
type Caso = { id: string; categoria: string; autor: string; texto: string; pendiente?: string; fuente?: string; esperado: { acciones: Array<{ tipo: string }>; alternativas?: Array<Array<{ tipo: string }>>; inyeccion?: boolean } };
const todos: Caso[] = archivos.flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as Caso[]);
const nuevos = archivos.filter((f) => f.startsWith('ampliado-')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as Caso[]);

describe('banco anonimizado ampliado', () => {
  it('trae al menos 120 frases NUEVAS y los ids no se repiten en todo el banco', () => {
    expect(nuevos.length).toBeGreaterThanOrEqual(120);
    const ids = todos.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('estructura valida: autor socio, intenciones del catalogo, fuente conocida', () => {
    for (const c of todos) {
      expect(['angelo', 'javier'], c.id).toContain(c.autor);
      expect(c.texto.length, c.id).toBeGreaterThan(0);
      for (const a of [...c.esperado.acciones, ...(c.esperado.alternativas ?? []).flat()]) expect(Object.keys(CATALOGO_INTENCIONES), `${c.id} ${a.tipo}`).toContain(a.tipo);
      if (c.fuente !== undefined) expect(['texto', 'reenviado', 'audio']).toContain(c.fuente);
    }
  });

  it('cubre TODAS las intenciones nuevas al menos una vez como resultado esperado principal', () => {
    const vistas = new Set(nuevos.flatMap((c) => c.esperado.acciones.map((a) => a.tipo)));
    for (const t of Object.keys(CATALOGO_AMPLIADO)) expect(vistas.has(t), t).toBe(true);
  });

  it('incluye lotes de varios pedidos, mensajes incompletos que deben preguntar, correcciones, respuestas con pregunta pendiente y adversarios', () => {
    const cat = (c: string) => nuevos.filter((x) => x.categoria === c).length;
    expect(nuevos.some((c) => c.esperado.acciones.length >= 4)).toBe(true);
    expect(nuevos.some((c) => c.esperado.acciones.length >= 8)).toBe(true);
    expect(cat('incompletos')).toBeGreaterThanOrEqual(10);
    expect(nuevos.filter((c) => c.esperado.acciones.some((a) => a.tipo === 'correccion')).length).toBeGreaterThanOrEqual(4);
    expect(nuevos.filter((c) => c.pendiente !== undefined).length).toBeGreaterThanOrEqual(10);
    expect(cat('adversos')).toBeGreaterThanOrEqual(10);
    expect(nuevos.filter((c) => c.esperado.inyeccion === true).length).toBeGreaterThanOrEqual(3);
    expect(nuevos.some((c) => c.fuente === 'reenviado')).toBe(true);
  });

  it('sin datos reales: ni correos, ni telefonos reales, ni nombres propios fuera de la lista ficticia', () => {
    for (const c of nuevos) {
      const t = `${c.texto} ${c.pendiente ?? ''}`;
      expect(t, c.id).not.toMatch(/@/);
      const diez = [...t.replace(/[\s-]/g, '').matchAll(/\d{10,}/g)].map((m) => m[0]);
      // el unico telefono permitido es el de relleno 1234567 de la prueba de redaccion de contactos
      for (const d of diez) expect(d, c.id).toBe('9991234567');
    }
    const nombres = new Set<string>();
    for (const c of nuevos) for (const m of c.texto.matchAll(/\b(?:Cliente|Tienda|Vapes) [A-Z][a-z]+(?: [A-Z][a-z]+)*|\b[A-Z][a-z]+ (?:Ficticio|Muestra|Ejemplo|Demo|Prueba)\b/g)) nombres.add(m[0]);
    expect(nombres.size).toBeGreaterThan(5);
  });
});
