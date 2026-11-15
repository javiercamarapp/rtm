import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { TEXTOS_AMBIGUOS_MODELO, textoAmbiguo } from '@/dominio/agente/alias_ambiguos';
import { ALIAS_MODELOS_ANGELO } from '@/dominio/importacion/alias_angelo';

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
  it('el alias historico de la lista de Angelo ("Waka 50") ofrece las mismas opciones que el agente: Jupiter o Icon, nunca Blast', () => {
    const regla = ALIAS_MODELOS_ANGELO.find((r) => normalizar(r.alias) === 'waka 50')!;
    const grupo = textoAmbiguo(regla.alias)!;
    expect([...regla.destinos].sort()).toEqual(grupo.opciones.map((o) => o.modelo).sort());
    expect(regla.destinos.join(' ')).not.toContain('Blast');
  });
  it('todo alias de Angelo con varios destinos que el agente trata como ambiguo coincide con sus opciones', () => {
    for (const r of ALIAS_MODELOS_ANGELO.filter((x) => x.destinos.length > 1)) {
      const g = textoAmbiguo(r.alias);
      if (g) expect([...r.destinos].sort(), r.alias).toEqual(g.opciones.map((o) => o.modelo).sort());
    }
  });
});
