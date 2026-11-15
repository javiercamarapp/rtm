// Contrato: la migracion que cierra el aviso "sin precio de catalogo" con el precio de lista vigente es aditiva y no toca hechos inmutables.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261118600000_avisos_precio_tabulador_vigente.sql'), 'utf8').replace(/--[^\n]*/g, '');
const ORIGINAL = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261116200000_avisos_autolimpieza.sql'), 'utf8').replace(/--[^\n]*/g, '');

describe('avisos: precio de lista vigente', () => {
  it('es aditiva: no borra ni edita lineas, notas ni tablas', () => {
    expect(MIG).not.toMatch(/\bdrop\s+(table|column|schema|function)\b/i);
    expect(MIG).not.toMatch(/\bdelete\s+from\b/i);
    expect(MIG).not.toMatch(/\btruncate\b/i);
    expect(MIG).not.toMatch(/\b(update|insert\s+into|alter\s+table)\b/i);
  });
  it('redefine la condicion con create or replace y la nueva version es posterior a la ya aplicada', () => {
    expect(MIG).toContain('create or replace function notificacion.condicion(p_a operacion.aviso');
    expect('20261118600000' > '20261116200000').toBe(true);
  });
  it('para sin_precio_catalogo consulta la lista vigente y compara con lo cobrado; conserva bajo costo y cierre al cobrar', () => {
    expect(MIG).toContain('notificacion.precio_lista_vigente(v_ped.cliente_id, l.modelo_id)');
    expect(MIG).toContain('l.precio_tabulador_cent is null');
    expect(MIG).toContain('aviso_excepcion_cierra_al_cobrar');
    expect(MIG).toContain("when 'venta_bajo_costo'");
  });
  it('sigue modelo.unificado_en y no expone los ayudantes a la web', () => {
    expect(MIG).toContain('unificado_en');
    expect(MIG).toMatch(/revoke execute on function catalogo\.modelo_vigente\(bigint\), notificacion\.precio_lista_vigente\(bigint, bigint\) from public, anon, authenticated/);
  });
  it('la migracion original no se edita: sigue definiendo la condicion sin consultar la lista', () => {
    expect(ORIGINAL).not.toContain('precio_lista_vigente');
  });
});
