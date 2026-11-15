import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { TEXTOS_AMBIGUOS_MODELO, textoAmbiguo } from '@/dominio/agente/alias_ambiguos';

const dic = JSON.parse(readFileSync(new URL('../../../scripts/catalogo/alias-waka.json', import.meta.url), 'utf8')) as {
  ambiguos: { texto: string; alias: string[]; opciones: { modelo: string; etiqueta?: string }[] }[];
};

describe('textos ambiguos del agente = diccionario de alias Waka', () => {
  it('cada grupo del diccionario esta en el codigo con las mismas opciones y alias', () => {
    expect(TEXTOS_AMBIGUOS_MODELO).toHaveLength(dic.ambiguos.length);
    for (const g of dic.ambiguos) {
      const codigo = textoAmbiguo(g.texto);
      expect(codigo, g.texto).not.toBeNull();
      expect(codigo!.opciones).toEqual(g.opciones);
      expect([...codigo!.textos].sort()).toEqual(g.alias.map(normalizar).sort());
    }
  });
  it('un texto ambiguo nunca es el destino de una union', () => {
    const destinos = (JSON.parse(readFileSync(new URL('../../../scripts/catalogo/alias-waka.json', import.meta.url), 'utf8')) as { alias: { destino: string | null }[] }).alias
      .map((a) => a.destino).filter((d): d is string => !!d).map(normalizar);
    for (const g of TEXTOS_AMBIGUOS_MODELO) for (const t of g.textos) expect(destinos).not.toContain(t);
  });
  it('un texto que no es ambiguo no pregunta por regla', () => {
    expect(textoAmbiguo('waka 30k')).toBeNull();
    expect(textoAmbiguo('waka titan 30k')).toBeNull();
  });
});
