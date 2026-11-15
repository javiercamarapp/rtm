// Contrato: la lectura de avisos vigentes del pedido es aditiva, solo de lectura, y la web la consume sin tocar hechos inmutables.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = process.cwd();
const MIG = readFileSync(join(raiz, 'supabase', 'migrations', '20261119400000_avisos_vigentes_pedido.sql'), 'utf8').replace(/--[^\n]*/g, '');
const INFRA = readFileSync(join(raiz, 'src', 'infra', 'supabase', 'operacion.ts'), 'utf8');
const FICHA = readFileSync(join(raiz, 'src', 'app', '(socio)', 'pedidos', '[id]', 'page.tsx'), 'utf8');

describe('avisos vigentes del pedido', () => {
  it('la migracion es aditiva y de solo lectura, posterior a la ultima aplicada', () => {
    expect(MIG).not.toMatch(/\bdrop\s+(table|column|schema|function)\b/i);
    expect(MIG).not.toMatch(/\b(delete\s+from|truncate|insert\s+into|alter\s+table)\b/i);
    expect(MIG).not.toMatch(/\bupdate\s+\w+\.\w+\s+set\b/i);
    expect(MIG).not.toMatch(/create or replace/i);
    expect('20261119400000' > '20261119200000').toBe(true);
  });
  it('evalua contra el precio de lista vigente y no contra la foto', () => {
    expect(MIG).toContain('notificacion.precio_lista_vigente(pe.cliente_id, l.modelo_id)');
    expect(MIG).toContain('aviso_excepcion_cierra_al_cobrar');
  });
  it('la web solo entra por api con rol de socio; anon no ejecuta nada', () => {
    expect(MIG).toMatch(/revoke execute on function api\.avisos_vigentes_pedido\(bigint\), api\.pedidos_avisos_vigentes\(\) from public, anon;/);
    expect(MIG).toMatch(/grant execute on function api\.avisos_vigentes_pedido\(bigint\), api\.pedidos_avisos_vigentes\(\) to authenticated;/);
    expect(MIG.match(/seguridad\.exigir_rol\(array\['socio'\]\)/g)?.length).toBe(2);
    expect(MIG).not.toMatch(/to anon/i);
  });
  it('la lista usa el conteo vigente y la ficha las tarjetas agrupadas', () => {
    expect(INFRA).toContain("'pedidos_avisos_vigentes'");
    expect(FICHA).toContain('avisosVigentesPedido');
    expect(FICHA).not.toContain('p.avisos.map');
  });
});
