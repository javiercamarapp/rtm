// Contrato: la migracion de autolimpieza es aditiva y la bandeja solo cuenta lo vigente.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIG = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261116200000_avisos_autolimpieza.sql'), 'utf8').replace(/--[^\n]*/g, '');

describe('autolimpieza de avisos: migracion', () => {
  it('es aditiva: no borra tablas, columnas ni filas', () => {
    expect(MIG).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(MIG).not.toMatch(/\bdelete\s+from\b/i);
    expect(MIG).not.toMatch(/\btruncate\b/i);
  });
  it('los contadores y la lista salen de la condicion vigente', () => {
    for (const fn of ['api.contar_no_leidas', 'api.mis_notificaciones', 'api.tu_turno']) {
      const cuerpo = MIG.slice(MIG.indexOf(`function ${fn}`));
      expect(cuerpo.slice(0, 4000)).toContain('notificacion.condicion(a)');
    }
  });
  it('el barrido y la condicion no se exponen a la web; solo el envoltorio api', () => {
    expect(MIG).toMatch(/revoke execute on function notificacion\.condicion\(operacion\.aviso\), notificacion\.depurar\(boolean\), notificacion\.reabrir\(bigint\) from public, anon, authenticated/);
    expect(MIG).toMatch(/grant execute on function api\.depurar_avisos\(\) to authenticated/);
  });
  it('lo resuelto por el sistema deja motivo, referencia y canal; nada se borra', () => {
    expect(MIG).toContain("resuelta_canal = 'sistema'");
    expect(MIG).toContain('resuelto_motivo');
    expect(MIG).toContain('resuelto_ref');
  });
});
